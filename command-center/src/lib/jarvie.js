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
  listClients, listProjects, listTasks, listDoorBriefs, listHandoffs, listInboxItems,
  listArtifacts, listActivityEvents, listActivityEventsSince, listActivityEventsForEntity,
  listTasksDueBetween, getTodayView, getBusinessHealth,
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
    /what should i (?:do|work on)(?! next)/, /what do i need to do/, /on my plate/, /needs? a decision/,
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
  // Phase D
  { intent: 'whats_next', patterns: [
    /what(?:'s| is)?\s+next\b/, /what(?:'s| is)?\s+(?:coming up|on deck)\b/, /\bon deck\b/,
    /what should i do next/, /(?:anything |what(?:'s| is) )?due (?:this week|soon)/,
    /what(?:'s| is)? (?:up )?(?:this|next) week/, /coming due/, /what(?:'s| is)?\s+due\b/,
  ] },
  { intent: 'quiet_clients', patterns: [
    /which clients? (?:are |have been )?quiet/, /quiet clients?/, /who (?:needs?|need) a check.?in/,
    /who have i been ignoring/, /stale (?:relationship|client)/,
    /(?:any|which) clients? .*(?:neglect|quiet|ignor)/, /been neglecting/,
    /who haven'?t i (?:heard from|talked to|contacted|touched)/,
    /clients? .*(?:no|without) (?:recent )?activity/,
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
  // Phase D — only reachable when a command passes kinds:['inbox_item'] (triage/dismiss);
  // never in the default question-resolution order (DEFAULT_KINDS below).
  inbox_item: { field: 'raw_text',  goTo: 'inbox' },
};
const DEFAULT_KINDS = ['client', 'project', 'door_brief', 'handoff', 'task'];

function refOf(kind, rec) {
  const field = KIND_META[kind].field;
  const label = kind === 'door_brief' ? (rec.business || 'Untitled mission')
    : kind === 'inbox_item' ? ((rec.raw_text || '(empty note)').slice(0, 60))
    : (rec[field] || '(untitled)');
  return { kind, id: rec.id, label, goTo: KIND_META[kind].goTo };
}

async function loadEntities() {
  const [clients, projects, briefs, handoffs, tasks, inbox] = await Promise.all([
    listClients(), listProjects(), listDoorBriefs(), listHandoffs(), listTasks(),
    listInboxItems({ status: 'untriaged' }),
  ]);
  return { clients, projects, briefs, handoffs, tasks, inbox };
}

function entityList(all, kind) {
  return { client: all.clients, project: all.projects, door_brief: all.briefs, handoff: all.handoffs, task: all.tasks, inbox_item: all.inbox }[kind];
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
  const order = (kinds && kinds.length ? kinds : DEFAULT_KINDS);
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

// Phase D §4.1 — an ordered list of { reason?, ev? } for "why is X blocked". `reason` strings
// (most-proximate first) become the answer; `ev` items become linkable evidence rows.
async function blockingChain(ref, rec, all) {
  const chain = [];
  const say = (reason, ev) => chain.push({ reason, ev });
  const today = new Date().toISOString().slice(0, 10);

  if (ref.kind === 'task') {
    if (rec.status === 'done') { say('nothing — this task is done'); return chain; }
    const proj = all.projects.find((p) => p.id === rec.project_id);
    if (proj && proj.status === 'paused') say(`its project “${proj.title}” is paused`, { kind: 'project', id: proj.id, label: `Open ${proj.title}`, goTo: 'clients' });
    if (rec.due_date && rec.due_date < today) say(`it is overdue (was due ${rec.due_date}) — needs you`);
    else say(rec.status === 'doing' ? 'it is in progress — needs finishing' : 'it has not been started');
    return chain;
  }

  if (ref.kind === 'handoff') {
    if (rec.status === 'accepted' || rec.status === 'rejected') { say(`nothing — this handoff is ${rec.status} and closed`); return chain; }
    if (rec.status === 'pending') { say('it has not been picked up yet'); return chain; }
    if (rec.status === 'in_progress') { say('work is in progress — then “Submit for audit”'); return chain; }
    const audit = (await listArtifacts({ relatedHandoffId: ref.id })).find((a) => a.type === 'audit_report');
    if (audit) {
      const passed = /^PASS/i.test(audit.reference || '');
      say(passed ? 'audit passed — waiting on your Approve / Reject' : `audit said FIX REQUIRED — ${audit.reference}`,
        { kind: 'artifact', id: audit.id, label: audit.reference, goTo: 'activity' });
    } else say('it is back for your review — record an audit result, then Approve / Reject');
    return chain;
  }

  if (ref.kind === 'project') {
    if (rec.status === 'complete') { say('nothing — this project is complete'); return chain; }
    if (rec.status === 'paused') { say('you paused it'); return chain; }
    const next = nextInList(PRODUCTION_STAGES, rec.production_stage || 'intake');
    if (next) say(`the next production stage (${rec.production_stage || 'intake'} → ${next})`);
    const openTasks = all.tasks.filter((t) => t.project_id === ref.id && t.status !== 'done');
    if (openTasks.length) {
      say(`${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}: ${openTasks.slice(0, 4).map((t) => t.title).join(', ')}${openTasks.length > 4 ? ', …' : ''}`);
      for (const t of openTasks.slice(0, 5)) chain.push({ ev: { kind: 'task', id: t.id, label: `Task: ${t.title} (${t.status})`, goTo: 'tasks' } });
    }
    if (['qa_audit', 'client_approval', 'launch'].includes(next)) {
      const gate = all.handoffs.find((h) => h.status === 'returned');
      if (gate) say(`a handoff is back for your review: “${gate.objective}”`, { kind: 'handoff', id: gate.id, label: `Open ${gate.objective}`, goTo: 'ai' });
    }
    return chain;
  }

  if (ref.kind === 'door_brief') {
    if (rec.planning_step === 'complete') { say('nothing — planning is complete'); return chain; }
    const next = nextInList(DOOR_STEPS, rec.planning_step);
    say(`the next planning step (${rec.planning_step}${next ? ` → ${next}` : ''})`);
    const stepFields = { outcome: ['primary_goal', 'urgent_need'], customer: ['customer', 'customer_intent', 'tone'], paths: ['paths'], destinations: ['destinations'], build: ['deliverables'], handoff: ['handoff'] };
    const blanks = (stepFields[rec.planning_step] || []).filter((f) => !(rec[f] || '').trim());
    if (blanks.length) say(`step “${rec.planning_step}” still has blank fields: ${blanks.join(', ')}`);
    return chain;
  }

  if (ref.kind === 'client') {
    if (rec.status === 'prospect') { say('you to move it from prospect to active'); return chain; }
    const projs = all.projects.filter((p) => p.client_id === ref.id);
    const open = projs.filter((p) => p.status !== 'complete');
    if (open.length) {
      say(`${open.length} of ${projs.length} project${projs.length === 1 ? '' : 's'} still open`);
      for (const p of open) chain.push({ ev: { kind: 'project', id: p.id, label: `Project: ${p.title} — ${p.status}`, goTo: 'clients' } });
    } else say(projs.length ? 'nothing specific — all its projects are complete' : 'nothing specific — no projects yet');
    return chain;
  }

  say('no rule matched');
  return chain;
}

// Phase D §4.2 — most recent activity across a set of entity ids. One read, filter client-side.
async function lastActivityAcross(ids) {
  const set = new Set(ids.filter(Boolean));
  const events = await listActivityEvents({ limit: 400 });
  const hit = events.find((e) => set.has(e.related_entity_id)); // DESC by created_at
  return hit ? fmtWhen(hit.created_at) : 'nothing logged';
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
  const { ref, rec, all } = r;
  const chain = await blockingChain(ref, rec, all);
  const reasons = chain.filter((c) => c.reason).map((c) => c.reason);
  const evs = chain.filter((c) => c.ev).map((c) => c.ev);
  const events = await listActivityEventsForEntity({ relatedEntityId: ref.id, limit: 3 });
  const top = reasons[0] || 'not blocked';
  return {
    intent: 'why_blocked',
    title: `${ref.label} — ${top}`,
    summary: (reasons.length ? reasons.join('; ') + '.' : 'Not blocked by any rule.')
      + (events.length ? ` Last activity ${fmtWhen(events[0].created_at)}.` : ''),
    evidence: [
      { kind: ref.kind, id: ref.id, label: `Open ${ref.label}`, goTo: ref.goTo },
      ...evs,
    ],
    records: { ref, rec, chain: reasons },
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
  let rollup = '';
  const extra = [];

  if (ref.kind === 'client') {
    const projects = all.projects.filter((p) => p.client_id === ref.id);
    const cbriefs = all.briefs.filter((b) => b.client_id === ref.id);
    const projIds = new Set(projects.map((p) => p.id));
    const ctasks = all.tasks.filter((t) => projIds.has(t.project_id));
    const openTasks = ctasks.filter((t) => t.status !== 'done').length;
    const pByStatus = tally(projects, (p) => p.status);
    const bByStep = tally(cbriefs, (b) => b.planning_step);
    const last = await lastActivityAcross([ref.id, ...projects.map((p) => p.id), ...cbriefs.map((b) => b.id), ...ctasks.map((t) => t.id)]);
    rollup = `Status ${rec.status}. ${projects.length} project${projects.length === 1 ? '' : 's'}`
      + (pByStatus.length ? ` (${pByStatus.map(([s, n]) => `${n} ${s}`).join(', ')})` : '')
      + `, ${ctasks.length} task${ctasks.length === 1 ? '' : 's'} (${openTasks} open)`
      + (cbriefs.length ? `, ${cbriefs.length} Door mission${cbriefs.length === 1 ? '' : 's'} (${bByStep.map(([s, n]) => `${n} ${s}`).join(', ')})` : '')
      + `. Last activity: ${last}.`;
    extra.push(...projects.map((p) => ({ kind: 'project', id: p.id, label: `Project: ${p.title} — ${p.status} · ${p.production_stage || 'intake'}`, goTo: 'clients' })));
    extra.push(...cbriefs.map((b) => ({ kind: 'door_brief', id: b.id, label: `Mission: ${b.business || 'Untitled mission'} — ${b.planning_step}`, goTo: 'door' })));
  } else if (ref.kind === 'project') {
    const tasks = all.tasks.filter((t) => t.project_id === ref.id);
    const byStatus = tally(tasks, (t) => t.status);
    const arts = await listArtifacts({ relatedProjectId: ref.id });
    const last = await lastActivityAcross([ref.id, ...tasks.map((t) => t.id)]);
    rollup = `Status ${rec.status}, production stage “${rec.production_stage || 'intake'}”. `
      + `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
      + (byStatus.length ? ` (${byStatus.map(([s, n]) => `${n} ${s}`).join(', ')})` : '')
      + `, ${arts.length} artifact${arts.length === 1 ? '' : 's'}. Last activity: ${last}.`;
    extra.push(...tasks.filter((t) => t.status !== 'done').map((t) => ({ kind: 'task', id: t.id, label: `Task: ${t.title} (${t.status}${t.due_date ? `, due ${t.due_date}` : ''})`, goTo: 'tasks' })));
  } else if (ref.kind === 'door_brief') {
    const fields = ['primary_goal', 'customer', 'urgent_need', 'customer_intent', 'tone', 'paths', 'destinations', 'deliverables', 'handoff', 'notes'];
    const blank = fields.filter((f) => !(rec[f] || '').trim());
    const client = all.clients.find((c) => c.id === rec.client_id);
    rollup = `Planning step “${rec.planning_step}”. ${fields.length - blank.length}/${fields.length} fields filled`
      + (blank.length ? `; still blank: ${blank.join(', ')}` : '')
      + (client ? `. Client: ${client.name}.` : '.');
  } else if (ref.kind === 'handoff') {
    const last = await lastActivityAcross([ref.id]);
    rollup = `${rec.from_worker} → ${rec.to_worker}, status “${rec.status}”. Objective: ${rec.objective}. Last activity: ${last}.`;
  } else if (ref.kind === 'task') {
    const proj = all.projects.find((p) => p.id === rec.project_id);
    const last = await lastActivityAcross([ref.id]);
    rollup = `Status ${rec.status}, priority ${rec.priority}${rec.due_date ? `, due ${rec.due_date}` : ''}${proj ? `, under ${proj.title}` : ', standalone'}. Last activity: ${last}.`;
  }

  return {
    intent: 'where_stands',
    title: `${ref.label}`,
    summary: rollup,
    evidence: [
      { kind: ref.kind, id: ref.id, label: `Open ${ref.label}`, goTo: ref.goTo },
      ...extra,
    ],
    records: { ref, rec },
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

// Phase D §5.1
async function buildWhatsNext() {
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [due, briefs] = await Promise.all([
    listTasksDueBetween({ from: today, to: in7, includeDone: false }),
    listDoorBriefs(),
  ]);
  const since = daysAgo(3);
  const inMotion = briefs.filter((b) => b.planning_step !== 'complete' && b.updated_at >= since);
  const parts = [];
  if (due.length) parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due in the next 7 days`);
  if (inMotion.length) parts.push(`${inMotion.length} Door mission${inMotion.length === 1 ? '' : 's'} in motion`);
  return {
    intent: 'whats_next',
    title: due.length ? `${due.length} task${due.length === 1 ? '' : 's'} due this week` : 'Nothing due this week',
    summary: parts.length ? parts.join(', ') + '.' : 'No tasks due in the next 7 days and no Door missions touched in the last 3 days.',
    evidence: [
      ...due.map((t) => ({ kind: 'task', id: t.id, label: `Due ${t.due_date}: ${t.title} (${t.priority})`, goTo: 'tasks' })),
      ...inMotion.map((b) => ({ kind: 'door_brief', id: b.id, label: `In motion: ${b.business || 'Untitled mission'} — ${b.planning_step}`, goTo: 'door' })),
    ],
    records: { due, inMotion },
  };
}

// Phase D §5.2
async function buildQuietClients() {
  const [clients, projects, briefs, tasks, events] = await Promise.all([
    listClients(), listProjects(), listDoorBriefs(), listTasks(),
    listActivityEventsSince({ since: daysAgo(14), limit: 500 }),
  ]);
  const projClient = new Map(projects.map((p) => [p.id, p.client_id]));
  const briefClient = new Map(briefs.map((b) => [b.id, b.client_id]));
  const taskClient = new Map(tasks.map((t) => [t.id, projClient.get(t.project_id) || null]));
  const touched = new Set();
  for (const e of events) {
    const t = e.related_entity_type; const id = e.related_entity_id;
    if (t === 'client') touched.add(id);
    else if (t === 'project') touched.add(projClient.get(id));
    else if (t === 'digital_door_brief') touched.add(briefClient.get(id));
    else if (t === 'task') touched.add(taskClient.get(id));
  }
  const active = clients.filter((c) => c.status === 'active');
  const quiet = active.filter((c) => !touched.has(c.id));
  return {
    intent: 'quiet_clients',
    title: quiet.length ? `${quiet.length} active client${quiet.length === 1 ? '' : 's'} quiet 14+ days`
      : (active.length ? 'Every active client has recent activity' : 'No active clients'),
    summary: quiet.length ? `No logged activity in the last 14 days for: ${quiet.map((c) => c.name).join(', ')}.`
      : (active.length ? `All ${active.length} active client${active.length === 1 ? '' : 's'} had activity in the last 14 days.` : 'There are no active clients.'),
    evidence: quiet.map((c) => ({ kind: 'client', id: c.id, label: `${c.name} — no activity in 14+ days`, goTo: 'clients' })),
    records: { quiet, activeCount: active.length },
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
  const base = ['What changed today?', 'What needs me?', "What's stalled?", "What's due this week?", 'Which clients are quiet?'];
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
    case 'whats_next': return buildWhatsNext();
    case 'quiet_clients': return buildQuietClients();
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
    { name: 'whats_next', when: 'the user asks what is next / coming up / due this week / on deck / what to do next' },
    { name: 'quiet_clients', when: 'the user asks which active clients have gone quiet / need a check-in / have had no recent activity' },
  ];
}

export const FORCEABLE_INTENTS = ['what_changed', 'needs_me', 'why_blocked', 'where_stands', 'whats_stalled', 'whats_next', 'quiet_clients'];

// Phase D §7 — a deterministic one-line synthesis + the single most important next action, for
// the Today screen. Reuses the intent builders; pure read, no writes.
export async function todayBrief() {
  const [needs, next, quiet, stalled] = await Promise.all([
    buildNeedsMe(), buildWhatsNext(), buildQuietClients(), buildWhatsStalled(),
  ]);
  const approvals = needs.records.approvals || [];
  const overdue = needs.records.overdue || [];
  const dueSoon = next.records.due || [];
  const quietC = quiet.records.quiet || [];
  const midBriefs = stalled.records.briefs || [];

  const bits = [];
  if (approvals.length) bits.push(`${approvals.length} awaiting approval`);
  if (overdue.length) bits.push(`${overdue.length} overdue`);
  if (dueSoon.length) bits.push(`${dueSoon.length} due this week`);
  if (quietC.length) bits.push(`${quietC.length} quiet client${quietC.length === 1 ? '' : 's'}`);
  const headline = bits.length ? bits.join(', ') + '.' : 'Nothing is waiting on you and nothing is due this week.';

  const in2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  let top = null;
  if (approvals[0]) top = { label: `Approve or reject “${approvals[0].objective}”`, goTo: 'ai' };
  else if (overdue[0]) top = { label: `Finish the overdue task “${overdue[0].title}”`, goTo: 'tasks' };
  else if (dueSoon.find((t) => t.due_date <= in2)) { const t = dueSoon.find((x) => x.due_date <= in2); top = { label: `“${t.title}” is due ${t.due_date}`, goTo: 'tasks' }; }
  else if (quietC[0]) top = { label: `Check in with ${quietC[0].name} — quiet 14+ days`, goTo: 'clients' };
  else if (midBriefs[0]) top = { label: `Move “${midBriefs[0].business || 'Untitled mission'}” forward`, goTo: 'door' };

  return { headline, top };
}

export const __INTERNAL__ = { classify, extractEntityPhrase, matchByName, waitingOn, windowFromQuestion, context };
