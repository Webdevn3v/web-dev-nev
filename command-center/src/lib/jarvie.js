// Jarvie — read-only question answering over the system of record.
// Specs: docs/JARVIE-PHASE-A.md (this module), docs/JARVIE-PHASE-B.md (adds the conversation
// context + resolveEntity export + "since I last looked" window used by the act path in
// src/lib/jarvieAct.js — which is the ONLY Jarvie file allowed to mutate).
//
// HARD RULES (enforced by acceptance grep, see JARVIE-PHASE-A.md §7 / JARVIE-PHASE-B.md §2):
//   - This module imports ONLY from ./queries.js. It never imports ./actions.js or ./db.js.
//   - It performs NO writes and emits NO ActivityEvent. Asking a question is a Safe read
//     (PHASE1-SPEC.md §5) and, like every read, is not logged.
//   - Retrieval is deterministic. There is no LLM here and nothing generates free-form claims
//     about system state — answers are template-filled from query results. The `records` field
//     on every answer is the raw retrieval, kept so a future phase could re-phrase it without
//     ever re-querying (JARVIE-PHASE-A.md §6, JARVIE-PHASE-B.md §11).

import {
  listClients, listProjects, listTasks, listDoorBriefs, listHandoffs,
  listActivityEventsSince, listActivityEventsForEntity,
  getTodayView, getBusinessHealth,
} from './queries.js';

// Ordered stage lists — domain facts, duplicated here (not imported) to keep the queries-only
// import boundary clean. Sources of truth: actions.js DOOR_STAGES / PRODUCTION_STAGES.
const DOOR_STEPS = ['outcome', 'customer', 'paths', 'destinations', 'build', 'handoff', 'complete'];
const PRODUCTION_STAGES = [
  'intake', 'brand_understanding', 'assets', 'digital_door', 'customer_paths',
  'mobile_optimization', 'full_site_handoff', 'owner_digital_key', 'qa_audit',
  'client_approval', 'launch', 'support_cleanup',
];

// ---------------------------------------------------------------- intent matching

// First match wins. Kept in the order docs/JARVIE-PHASE-A.md §4 lists them, with precise
// phrases so the generic ones (what changed) can't swallow the specific ones.
const INTENT_RULES = [
  { intent: 'what_changed', patterns: [
    /\bwhat(?:'s| is| has| had)?\s+chang/, /\bwhat\s+happened/, /\bwhat(?:'s| is)\s+new\b/,
    /recent (?:activity|events|changes)/, /\bwhat(?:'s| has)?\s+been happening/, /anything new\b/,
  ] },
  { intent: 'needs_me', patterns: [
    /what needs me/, /needs? my attention/, /waiting on me/, /waiting for me/, /my queue/,
    /what should i (?:do|work on)/, /what do i need to do/, /on my plate/, /needs? a decision/,
  ] },
  { intent: 'why_blocked', patterns: [
    /why is .+ (?:blocked|stuck|stalled)/, /why(?:'s| is) .+ not (?:moving|done|finished)/,
    /what(?:'s| is) .+ waiting on/, /what(?:'s| is) .+ blocked on/, /why .+ (?:blocked|stuck)/,
    /(?:is |are )?anything blocked/, /what(?:'s| is) blocked/,
  ] },
  { intent: 'where_stands', patterns: [
    /where does .+ stand/, /where(?:'s| is) .+ (?:at|now)/, /status (?:of|on|for) /,
    /how(?:'s| is) .+ (?:going|coming|progressing)/, /catch me up on /, /update on /,
    /where do .+ stand/, /how are .+ doing/,
    /^\s*(?:and )?(?:its|their)\s+\w/, /what about (?:it|that|its|their)/, /tell me about (?:it|that)/,
    /^\s*(?:it|that|this|that one)\s*\??\s*$/,
  ] },
  { intent: 'whats_stalled', patterns: [
    /what(?:'s| is) stalled/, /what(?:'s| is) at risk/, /what(?:'s| is) slipping/,
    /what(?:'s| is) (?:falling behind|behind)/, /anything (?:overdue|stale|slipping)/,
    /what needs chasing/,
  ] },
];

function classify(question) {
  const q = ` ${question.toLowerCase().trim()} `;
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(q))) return rule.intent;
  }
  return 'unknown';
}

// ---------------------------------------------------------------- entity reference extraction

const FRAME_WORDS = /\b(why|whys|what|whats|where|hows|how|is|are|does|do|did|has|have|the|a|an|of|on|about|for|it|this|that|currently|right|now|status|update|catch|me|up|to|my|our|their|there|something|anything|everything|some|any)\b/g;
const TAIL_WORDS = /\b(blocked|stuck|stalled|waiting|wait|stand|standing|stands|going|coming|progressing|doing|at|slipping|behind)\b/g;
const TYPE_NOISE = /\b(project|projects|mission|missions|brief|briefs|client|clients|task|tasks|handoff|handoffs|job|jobs)\b/g;

// Returns the best-guess name the user typed, or '' if the question names nothing specific.
export function extractEntityPhrase(question) {
  const quoted = question.match(/["'‘’“”]([^"'‘’“”]{2,})["'‘’“”]/);
  if (quoted) return quoted[1].trim();
  let s = ` ${question.toLowerCase()} `
    .replace(/[?.!,;:]/g, ' ')
    .replace(FRAME_WORDS, ' ')
    .replace(TAIL_WORDS, ' ')
    .replace(TYPE_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

const KIND_META = {
  client:     { field: 'name',      goTo: 'clients' },
  project:    { field: 'title',     goTo: 'clients' },
  door_brief: { field: 'business',  goTo: 'door' },
  handoff:    { field: 'objective', goTo: 'ai' },
  task:       { field: 'title',     goTo: 'tasks' },
};

function refOf(kind, rec) {
  const field = KIND_META[kind].field;
  const label = kind === 'door_brief' ? (rec.business || 'Untitled mission') : (rec[field] || '(untitled)');
  return { kind, id: rec.id, label, goTo: KIND_META[kind].goTo };
}

async function loadEntities() {
  const [clients, projects, briefs, handoffs, tasks] = await Promise.all([
    listClients(), listProjects(), listDoorBriefs(), listHandoffs(), listTasks(),
  ]);
  return { clients, projects, briefs, handoffs, tasks };
}

function entityList(all, kind) {
  return { client: all.clients, project: all.projects, door_brief: all.briefs, handoff: all.handoffs, task: all.tasks }[kind];
}

function findById(all, id) {
  for (const kind of Object.keys(KIND_META)) {
    const hit = entityList(all, kind).find((r) => r.id === id);
    if (hit) return refOf(kind, hit);
  }
  return null;
}

// Case-insensitive "name contains the typed phrase" match (docs/JARVIE-PHASE-A.md §5.3), one
// entity kind at a time in the documented order — the first kind with any hit wins, and
// ambiguity is only ever within that kind. One-directional on purpose: the field contains the
// phrase, not vice versa (no fuzzy/abbreviation matching). `kinds` (optional) restricts the
// search — the act path passes the kinds a given command can operate on so e.g.
// "advance Frederick Legacy Law to paths" finds the Door mission, not the same-named client.
function matchByName(all, needleRaw, kinds = null) {
  const needle = needleRaw.toLowerCase().trim();
  if (!needle) return { status: 'empty' };
  const order = (kinds && kinds.length ? kinds : Object.keys(KIND_META));
  for (const kind of order) {
    const meta = KIND_META[kind];
    if (!meta) continue;
    const hits = entityList(all, kind)
      .filter((r) => (r[meta.field] || '').toLowerCase().includes(needle))
      .map((r) => refOf(kind, r));
    if (hits.length === 1) return { status: 'one', ref: hits[0] };
    if (hits.length > 1) return { status: 'many', hits };
  }
  return { status: 'none' };
}

// ---------------------------------------------------------------- conversation context (Phase B §7)
// Session-only, in-memory. Never persisted, never logged. Cleared when the screen is left.

const context = { lastEntityRef: null, lastIntent: null };
const PRONOUN = /\b(it|that|this|them|those|that one|the same|the last one)\b/i;

export function getContext() { return { ...context }; }
export function noteEntity(ref) { if (ref && ref.id) context.lastEntityRef = { kind: ref.kind, id: ref.id, label: ref.label, goTo: ref.goTo }; }
export function noteIntent(name) { context.lastIntent = name || null; }
export function clearContext() { context.lastEntityRef = null; context.lastIntent = null; }

// Unified entity resolver, shared with src/lib/jarvieAct.js so the act path uses the exact same
// name-matching rules (JARVIE-PHASE-A.md §5.3). Returns { status, ref?, rec?, hits? }.
export async function resolveEntity(phraseOrPronoun, { entityId = null, kinds = null } = {}) {
  const all = await loadEntities();
  const withRec = (ref) => ({ status: 'one', ref, rec: entityList(all, ref.kind).find((r) => r.id === ref.id) });
  if (entityId) {
    const ref = findById(all, entityId);
    if (!ref) return { status: 'none' };
    if (kinds && kinds.length && !kinds.includes(ref.kind)) return { status: 'wrongkind', ref };
    return withRec(ref);
  }
  const phrase = String(phraseOrPronoun || '').trim();
  if (!phrase || new RegExp(`^${PRONOUN.source}$`, 'i').test(phrase)) {
    if (!context.lastEntityRef) return { status: 'empty' };
    if (kinds && kinds.length && !kinds.includes(context.lastEntityRef.kind)) return { status: 'wrongkind', ref: context.lastEntityRef, fromContext: true };
    return { ...withRec(context.lastEntityRef), fromContext: true };
  }
  const m = matchByName(all, phrase, kinds);
  if (m.status === 'one') return withRec(m.ref);
  // Kinds-filtered miss, but the name matches something of another kind → say what it is,
  // instead of a bare "not found".
  if (m.status === 'none' && kinds && kinds.length) {
    const wide = matchByName(all, phrase, null);
    if (wide.status === 'one') return { status: 'wrongkind', ref: wide.ref };
  }
  return m;
}

// ---------------------------------------------------------------- shared helpers

// `opts.sinceLastSeen` is the localStorage timestamp the screen owns (Phase B §8) — only used
// when the question actually asks for "since I last looked".
function windowFromQuestion(q, opts = {}) {
  const s = q.toLowerCase();
  if (/since (i )?last|since last time|while i was (gone|away)|what did i miss/.test(s)) {
    if (opts.sinceLastSeen) return { key: 'since_last_seen', label: 'since you last checked', since: opts.sinceLastSeen };
    return { key: 'week', label: 'the last 7 days (no earlier check on record)', since: daysAgo(7) };
  }
  if (/\btoday\b|last 24|past day/.test(s)) return { key: 'today', label: 'today', since: startOfToday() };
  if (/\bmonth\b|30 day|last 30/.test(s)) return { key: 'month', label: 'the last 30 days', since: daysAgo(30) };
  return { key: 'week', label: 'the last 7 days', since: daysAgo(7) };
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
function daysAgo(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString(); }

export function humanizeEventType(t) {
  return String(t || 'event').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso || '—'; }
}

function tally(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const EVENT_ENTITY_SCREEN = {
  client: 'clients', project: 'clients', task: 'tasks', digital_door_brief: 'door',
  artifact: 'activity', handoff: 'ai', inbox_item: 'inbox', legacy_state: 'activity',
};

// ---------------------------------------------------------------- answer builders

async function buildWhatChanged(question, opts) {
  const win = windowFromQuestion(question, opts);
  const events = await listActivityEventsSince({ since: win.since, limit: 200 });
  const byType = tally(events, (e) => e.event_type);
  const summary = events.length
    ? byType.slice(0, 6).map(([t, n]) => `${n} ${humanizeEventType(t).toLowerCase()}`).join(', ')
      + (byType.length > 6 ? ', …' : '') + '.'
    : `Nothing has been logged ${win.label.startsWith('the ') ? 'in ' + win.label : win.label}.`;
  return {
    intent: 'what_changed',
    title: events.length ? `${events.length} event${events.length === 1 ? '' : 's'} · ${win.label}` : `No activity · ${win.label}`,
    summary,
    evidence: events.slice(0, 30).map((e) => ({
      kind: 'event',
      id: e.id,
      label: `${humanizeEventType(e.event_type)}${e.payload ? ` — ${e.payload}` : ''} · ${fmtWhen(e.created_at)}`,
      goTo: EVENT_ENTITY_SCREEN[e.related_entity_type] || 'activity',
    })),
    records: { window: win.key, since: win.since, count: events.length, byType, events },
  };
}

async function buildNeedsMe() {
  const [today, health] = await Promise.all([getTodayView(), getBusinessHealth()]);
  const approvals = today.awaitingApproval || [];
  const overdue = health.overdueTasks || [];
  const overdueIds = new Set(overdue.map((t) => t.id));
  const highPri = (today.highPriorityTasks || []).filter((t) => !overdueIds.has(t.id));
  const untriaged = health.untriagedInbox || [];

  const evidence = [
    ...approvals.map((h) => ({ kind: 'handoff', id: h.id, label: `Approve or reject: “${h.objective}” (${h.from_worker} → ${h.to_worker})`, goTo: 'ai' })),
    ...overdue.map((t) => ({ kind: 'task', id: t.id, label: `Overdue task: ${t.title} (due ${t.due_date})`, goTo: 'tasks' })),
    ...highPri.map((t) => ({ kind: 'task', id: t.id, label: `${t.priority === 'urgent' ? 'Urgent' : 'High-priority'} task: ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`, goTo: 'tasks' })),
    ...untriaged.map((i) => ({ kind: 'inbox_item', id: i.id, label: `Triage: ${i.raw_text}`, goTo: 'inbox' })),
  ];
  const total = evidence.length;
  const parts = [];
  if (approvals.length) parts.push(`${approvals.length} awaiting your approval`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (highPri.length) parts.push(`${highPri.length} high-priority`);
  if (untriaged.length) parts.push(`${untriaged.length} to triage`);

  return {
    intent: 'needs_me',
    title: total ? `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} you` : 'Nothing is waiting on you',
    summary: total ? parts.join(', ') + '.' : 'No approvals, overdue work, high-priority tasks, or untriaged inbox items.',
    evidence,
    records: { approvals, overdue, highPri, untriaged },
  };
}

function nextInList(list, current) {
  const i = list.indexOf(current);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

function waitingOn(ref, rec) {
  if (ref.kind === 'handoff') {
    return {
      pending: 'being picked up — “Mark in progress” on the AI Desk',
      in_progress: 'the work, then “Submit for audit”',
      returned: 'your Approve / Reject decision',
      accepted: 'nothing — this handoff is accepted and closed',
      rejected: 'nothing — this handoff was rejected and closed',
    }[rec.status] || `an unknown state (${rec.status})`;
  }
  if (ref.kind === 'door_brief') {
    if (rec.planning_step === 'complete') return 'nothing — this mission’s planning is complete';
    const next = nextInList(DOOR_STEPS, rec.planning_step);
    return next ? `the next planning step (${rec.planning_step} → ${next})` : 'the next planning step';
  }
  if (ref.kind === 'project') {
    if (rec.status === 'paused') return 'you to un-pause it';
    if (rec.status === 'complete') return 'nothing — this project is complete';
    const next = nextInList(PRODUCTION_STAGES, rec.production_stage || 'intake');
    return next ? `the next production stage (${rec.production_stage || 'intake'} → ${next})` : 'the next production stage';
  }
  if (ref.kind === 'task') {
    if (rec.status === 'done') return 'nothing — this task is done';
    const overdue = rec.due_date && rec.due_date < new Date().toISOString().slice(0, 10);
    if (overdue) return `you — it is overdue (was due ${rec.due_date})`;
    return rec.status === 'doing' ? 'it to be finished' : 'it to be started';
  }
  if (ref.kind === 'client') {
    return rec.status === 'prospect' ? 'you to move it from prospect to active' : `nothing specific — client is ${rec.status}`;
  }
  return 'no rule matched';
}

async function resolveOrExplain(question, entityId, intent) {
  const all = await loadEntities();
  if (entityId) {
    const ref = findById(all, entityId);
    if (ref) { noteEntity(ref); return { ref, all, rec: entityList(all, ref.kind).find((r) => r.id === entityId) }; }
    return { answer: notFound(intent, entityId) };
  }
  const phrase = extractEntityPhrase(question);
  if (!phrase) {
    // "why is it blocked", "where does that stand", "and its tasks" → the entity from context.
    if ((PRONOUN.test(question) || /\b(its|their)\s+\w/i.test(question)) && context.lastEntityRef) {
      const fresh = entityList(all, context.lastEntityRef.kind).find((r) => r.id === context.lastEntityRef.id);
      if (fresh) return { ref: context.lastEntityRef, all, rec: fresh, fromContext: true };
    }
    return { needPhrase: true, all };
  }
  const m = matchByName(all, phrase);
  if (m.status === 'one') { noteEntity(m.ref); return { ref: m.ref, all, rec: entityList(all, m.ref.kind).find((r) => r.id === m.ref.id) }; }
  if (m.status === 'many') {
    return { answer: {
      intent,
      title: 'Did you mean one of these?',
      summary: `“${phrase}” matches ${m.hits.length} records. Pick one.`,
      evidence: m.hits.map((h) => ({ ...h, reask: intent })),
      records: { phrase, candidates: m.hits },
    } };
  }
  return { answer: notFound(intent, phrase) };
}

function notFound(intent, phrase) {
  return {
    intent,
    title: 'Nothing found',
    summary: `I couldn’t find a client, project, mission, handoff, or task matching “${phrase}”.`,
    evidence: [],
    records: { phrase },
  };
}

async function buildWhyBlocked(question, entityId) {
  const r = await resolveOrExplain(question, entityId, 'why_blocked');
  if (r.answer) return r.answer;
  if (r.needPhrase) return buildWhatsStalled(); // "what's blocked?" with no name → the stalled view
  const { ref, rec } = r;
  const events = await listActivityEventsForEntity({ relatedEntityId: ref.id, limit: 8 });
  const wait = waitingOn(ref, rec);
  const statusBit = ref.kind === 'door_brief' ? `planning step “${rec.planning_step}”`
    : ref.kind === 'project' ? `status “${rec.status}”, production stage “${rec.production_stage || 'intake'}”`
    : `status “${rec.status}”`;
  return {
    intent: 'why_blocked',
    title: `${ref.label} — waiting on ${wait}`,
    summary: `Currently ${statusBit}. ${events.length ? `Last activity ${fmtWhen(events[0].created_at)}.` : 'No activity logged yet.'}`,
    evidence: [
      { kind: ref.kind, id: ref.id, label: `Open ${ref.label}`, goTo: ref.goTo },
      ...events.map((e) => ({ kind: 'event', id: e.id, label: `${humanizeEventType(e.event_type)}${e.payload ? ` — ${e.payload}` : ''} · ${fmtWhen(e.created_at)}`, goTo: 'activity' })),
    ],
    records: { ref, rec, events },
  };
}

async function buildWhereStands(question, entityId) {
  const r = await resolveOrExplain(question, entityId, 'where_stands');
  if (r.answer) return r.answer;
  if (r.needPhrase) {
    return {
      intent: 'where_stands',
      title: 'Which one?',
      summary: 'Name a client, project, mission, handoff, or task — e.g. “where does Frederick Legacy Law stand?”.',
      evidence: [],
      records: {},
    };
  }
  const { ref, rec, all } = r;
  const events = await listActivityEventsForEntity({ relatedEntityId: ref.id, limit: 3 });
  let rollup = '';
  const extra = [];

  if (ref.kind === 'client') {
    const projects = all.projects.filter((p) => p.client_id === ref.id);
    const byStatus = tally(projects, (p) => p.status);
    rollup = `Status ${rec.status}. ${projects.length} project${projects.length === 1 ? '' : 's'}${byStatus.length ? ` (${byStatus.map(([s, n]) => `${n} ${s}`).join(', ')})` : ''}.`;
    extra.push(...projects.map((p) => ({ kind: 'project', id: p.id, label: `Project: ${p.title} — ${p.status}`, goTo: 'clients' })));
  } else if (ref.kind === 'project') {
    const tasks = await listTasks({ projectId: ref.id });
    const open = tasks.filter((t) => t.status !== 'done').length;
    rollup = `Status ${rec.status}, production stage “${rec.production_stage || 'intake'}”. ${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${open} open.`;
  } else if (ref.kind === 'door_brief') {
    const fields = ['primary_goal', 'customer', 'urgent_need', 'customer_intent', 'tone', 'paths', 'destinations', 'deliverables', 'handoff', 'notes'];
    const filled = fields.filter((f) => (rec[f] || '').trim()).length;
    rollup = `Planning step “${rec.planning_step}”. ${filled}/${fields.length} brief fields filled.`;
  } else if (ref.kind === 'handoff') {
    rollup = `${rec.from_worker} → ${rec.to_worker}, status “${rec.status}”. Objective: ${rec.objective}`;
  } else if (ref.kind === 'task') {
    const proj = all.projects.find((p) => p.id === rec.project_id);
    rollup = `Status ${rec.status}, priority ${rec.priority}${rec.due_date ? `, due ${rec.due_date}` : ''}${proj ? `, under ${proj.title}` : ', standalone'}.`;
  }

  return {
    intent: 'where_stands',
    title: `${ref.label}`,
    summary: rollup,
    evidence: [
      { kind: ref.kind, id: ref.id, label: `Open ${ref.label}`, goTo: ref.goTo },
      ...extra,
      ...events.map((e) => ({ kind: 'event', id: e.id, label: `${humanizeEventType(e.event_type)} · ${fmtWhen(e.created_at)}`, goTo: 'activity' })),
    ],
    records: { ref, rec, events },
  };
}

async function buildWhatsStalled() {
  const h = await getBusinessHealth();
  const overdue = h.overdueTasks || [];
  const briefs = h.stalledBriefs || [];
  const handoffs = h.staleHandoffs || [];
  const inbox = h.untriagedInbox || [];
  const total = overdue.length + briefs.length + handoffs.length + inbox.length;
  const parts = [];
  if (overdue.length) parts.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`);
  if (briefs.length) parts.push(`${briefs.length} Door brief${briefs.length === 1 ? '' : 's'} idle 7+ days`);
  if (handoffs.length) parts.push(`${handoffs.length} handoff${handoffs.length === 1 ? '' : 's'} stale 3+ days`);
  if (inbox.length) parts.push(`${inbox.length} untriaged inbox item${inbox.length === 1 ? '' : 's'}`);

  return {
    intent: 'whats_stalled',
    title: total ? `${total} thing${total === 1 ? '' : 's'} look stalled` : 'Nothing looks stalled',
    summary: total ? parts.join(', ') + '.' : 'No overdue tasks, idle Door briefs, stale handoffs, or untriaged inbox items.',
    evidence: [
      ...overdue.map((t) => ({ kind: 'task', id: t.id, label: `Overdue: ${t.title} (due ${t.due_date})`, goTo: 'tasks' })),
      ...briefs.map((b) => ({ kind: 'door_brief', id: b.id, label: `Idle: ${b.business || 'Untitled mission'} — ${b.planning_step}`, goTo: 'door' })),
      ...handoffs.map((h2) => ({ kind: 'handoff', id: h2.id, label: `Stale: “${h2.objective}” — ${h2.status}`, goTo: 'ai' })),
      ...inbox.map((i) => ({ kind: 'inbox_item', id: i.id, label: `Untriaged: ${i.raw_text}`, goTo: 'inbox' })),
    ],
    records: { overdue, briefs, handoffs, inbox },
  };
}

function buildCapabilities() {
  return {
    intent: 'unknown',
    title: 'Ask me about the system of record',
    summary: 'I answer from live data only — what changed, what needs you, why something is blocked, where something stands, and what looks stalled. Try one of the suggested questions.',
    evidence: [],
    records: {},
  };
}

// ---------------------------------------------------------------- public entry points

export async function suggestedQuestions() {
  const base = ['What changed today?', 'What changed this week?', 'What needs me?', "What's stalled?"];
  try {
    const [clients, projects, briefs] = await Promise.all([listClients(), listProjects(), listDoorBriefs()]);
    const name = clients[0]?.name || projects[0]?.title || briefs[0]?.business;
    base.push(name ? `Where does ${name} stand?` : 'Where does … stand? (name a client, project, or mission)');
  } catch {
    base.push('Where does … stand? (name a client, project, or mission)');
  }
  return base;
}

// Answer one question. `opts.entityId` forces resolution to a specific record (used when the
// user picks from a "did you mean" list). `opts.sinceLastSeen` is the screen-owned localStorage
// timestamp for "since I last looked" (Phase B §8). Never writes, never logs.
// Back-compat: a string second arg is treated as `entityId`.
export async function answerQuestion(question, opts = {}) {
  if (typeof opts === 'string') opts = { entityId: opts };
  const text = String(question || '').trim();
  const entityId = opts.entityId || null;
  if (!text && !entityId) return buildCapabilities();
  // opts.forceIntent — Phase C: the LLM classified a question the deterministic matcher didn't
  // recognise. The answer is still built by the deterministic builder; only the routing decision
  // came from the model, and it's constrained to these five names (validated by the caller).
  const intent = opts.forceIntent && INTENT_RULES.some((r) => r.intent === opts.forceIntent)
    ? opts.forceIntent
    : (entityId ? classifyForReask(text) : classify(text));
  noteIntent(intent);
  switch (intent) {
    case 'what_changed': return buildWhatChanged(text, opts);
    case 'needs_me': return buildNeedsMe();
    case 'why_blocked': return buildWhyBlocked(text, entityId);
    case 'where_stands': return buildWhereStands(text, entityId);
    case 'whats_stalled': return buildWhatsStalled();
    default: return buildCapabilities();
  }
}

// When re-asking bound to an entity id, keep the original intent if it was entity-shaped,
// otherwise treat it as "where does this stand".
function classifyForReask(text) {
  const c = classify(text);
  return c === 'why_blocked' || c === 'where_stands' ? c : 'where_stands';
}

// The five deterministic intents, as data — Phase C hands this to the LLM as the closed set it
// may classify an unrecognised question into (docs/JARVIE-PHASE-C.md §4.2). Names must match
// INTENT_RULES.
export function capabilityManifest() {
  return [
    { name: 'what_changed', when: 'the user asks what changed / happened / is new (optionally today, this week, this month, or since they last looked)' },
    { name: 'needs_me', when: 'the user asks what needs them / is waiting on them / is on their plate / needs a decision' },
    { name: 'why_blocked', when: 'the user asks why a specific named thing is blocked/stuck or what it is waiting on' },
    { name: 'where_stands', when: 'the user asks the status of / where a specific named thing stands / to be caught up on it' },
    { name: 'whats_stalled', when: 'the user asks what is stalled / at risk / slipping / overdue / needs chasing (no specific name)' },
  ];
}

export const FORCEABLE_INTENTS = ['what_changed', 'needs_me', 'why_blocked', 'where_stands', 'whats_stalled'];

export const __INTERNAL__ = { classify, extractEntityPhrase, matchByName, waitingOn, windowFromQuestion, context };
