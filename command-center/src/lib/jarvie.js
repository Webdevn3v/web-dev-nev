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
  listTasksDueBetween, getTodayView, getBusinessHealth, listCalendarEventsBetween,
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
  // Combined daily briefing (calendar + tasks + approvals). Before needs_me/calendar_lookup so
  // "what's happening today" / "what's on today" get the rollup, but "what do I have today"
  // stays calendar-only (no "have" here).
  { intent: 'whats_today', patterns: [
    /what(?:'s| is)\s+(?:happening|going on|on|up|the plan|the story)\s+(?:today|right now|this morning|this afternoon)\b/,
    /what(?:'s| is)\s+(?:my\s+)?(?:day|today)\s+(?:look|looking|shaping)/,
    /how(?:'s| is)\s+(?:my\s+)?(?:day|today)\s+(?:look|shaping)/,
    /\b(?:brief me|daily brief(?:ing)?|morning brief(?:ing)?|my briefing|the briefing)\b/,
    /catch me up on (?:today|my day|the day)/,
    /what(?:'s| is)\s+(?:on\s+)?(?:my\s+)?(?:plate|agenda)\s+today/,
    /what do i need to know (?:today|this morning|right now)/,
  ] },
  // Approvals / client work waiting on Nev. Before needs_me so "what client work is waiting on
  // me" isn't swallowed by needs_me's generic "waiting on me".
  { intent: 'awaiting_approval', patterns: [
    /awaiting (?:your |my )?(?:approval|sign[- ]?off|decision|review)/,
    /(?:waiting|pending)\s+(?:for |on )?(?:your |my )?(?:approval|sign[- ]?off)/,
    /(?:what|anything|which)\b[^?]{0,30}\b(?:needs?|for|up for)\s+(?:approv|sign(?:ing)?[- ]?off)/,
    /needs? (?:your |my )?sign[- ]?off/,
    /what(?:'s| is)\s+(?:up )?for approval/,
    /(?:what|anything)\b[^?]{0,30}\bto approve\b/,
    /what client work is waiting on me/,
    /(?:what|which)\s+(?:client|customer)\s+work\b/,
    /what do (?:my |the )?clients?\s+need\b/,
  ] },
  { intent: 'business_overview', patterns: [
    /how(?:'s| is| are)\s+(?:the\s+)?(?:business|digital[\s\-]side|company|things|it all|everything)\b/,
    /\bhow are things\b/,
    /(?:state|status|health|overview|pulse|snapshot|shape)\s+of\s+(?:the\s+)?(?:business|digital[\s\-]side|company)/,
    /(?:business|company|digital[\s\-]side)\s+(?:overview|status|health|update|pulse|snapshot|summary)\b/,
    /what(?:'s| is)\s+(?:happening|going on|the story|new)\s+(?:with|at|for|in)\s+(?:the\s+)?(?:business|digital[\s\-]side|company)/,
    /\bbig picture\b/,
    /where do (?:things|we)\s+stand\s+overall/,
  ] },
  { intent: 'needs_me', patterns: [
    /what needs me/, /needs? my attention/, /waiting on me/, /waiting for me/, /my queue/,
    /what should i (?:do|work on)(?! next)/, /what do i need to do/, /on my plate/, /needs? a decision/,
  ] },
  // Calendar (migration 007). Tight phrasing so it can't swallow "what changed today" (which is
  // matched first, above) or "what's due this week" (whats_next, below). "What's coming up this
  // week?" lands here; buildWhatsNext also folds in the week's events for the plain "what's next".
  { intent: 'calendar_lookup', patterns: [
    /what(?:'s| is| do i have| have i got| am i doing)\s+(?:on\s+)?(?:today|tomorrow|this week|this weekend)\b/,
    /what(?:'s| is| do i have)\s+(?:on\s+)?(?:coming up|planned|scheduled|happening)\s+(?:today|tomorrow|this week|this weekend)/,
    /what(?:'s| is)\s+(?:on|in)\s+(?:my|the)\s+(?:calendar|schedule|agenda|diary)/,
    /what do i have (?:on (?:my )?(?:calendar|the calendar|the schedule)|scheduled|planned|going on)/,
    /\b(?:my|the)\s+(?:calendar|schedule|agenda|diary)\b/,
    /(?:do i have|have i got|is there)\s+(?:anything|any events?|any plans?|any appointments?)\s+(?:on\s+)?(?:today|tomorrow|this week|this weekend)/,
    /what(?:'s| is)\s+(?:coming up|happening)\s+this week/,
    // "what does Zen have this week", "what is Zoe doing tomorrow"
    /what\s+(?:does|do|is|are|has|have|will)\s+[a-z][a-z'’.\-]+\s+(?:have|has|got|get|getting|doing|do|scheduled|planned|on|up to|going on)\b/,
    /(?:what(?:'s| is)?|when(?:'s| is)?)\s+(?:on\s+|in\s+)?[a-z][a-z'’.\-]+'s\s+(?:calendar|schedule|agenda|day|week|diary|plate|plans?)/,
    // "what Digital Side things are coming up", "anything for the family this week"
    /\bdigital[\s\-]side\b.*\b(?:coming up|this week|this weekend|next|soon|scheduled|planned|events?|things|stuff|deadlines?|happening)\b/,
    /(?:coming up|scheduled|planned|anything|events?)\b.*\bfor\s+(?:the\s+)?(?:family|kids?|personal|digital[\s\-]side)\b/,
    /what(?:'s| is| are)?\s+(?:the\s+)?(?:family|personal|digital[\s\-]side)\s+(?:events?|calendar|schedule|things?)\b/,
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
  // After why_blocked / where_stands so an entity-named question ("why is the high-priority
  // task blocked", "the active door mission") isn't captured here.
  { intent: 'high_priority_tasks', patterns: [
    /(?:what|which|list|show|any)\b[^?]{0,30}\bhigh[- ]?priority (?:tasks?|work|items?)\b/,
    /(?:what|which|list|show|any)\b[^?]{0,30}\burgent tasks?\b/,
    /what(?:'s| is)\s+urgent\b/,
    /\bmy (?:top )?priorit(?:y|ies)\b/,
    /(?:most|top) (?:important|urgent) tasks?/,
  ] },
  { intent: 'active_doors', patterns: [
    /(?:what|which|list|show|any|are there)\b[^?]{0,40}\b(?:digital\s+)?door\s+(?:projects?|briefs?|missions?)\b/,
    /(?:what|which|list|show|any|are there)\b[^?]{0,20}\b(?:active|open|running|ongoing)\s+(?:digital\s+)?door\b/,
    /(?:what(?:'s| is)?|which)\s+(?:in|going on in|happening in)\s+the\s+door\s+(?:workflow|pipeline)/,
    /\bdoor (?:pipeline|workflow)\b[^?]{0,30}\b(?:active|open|status|missions?|going|progress)\b/,
    /(?:what|which)\s+missions?\s+(?:are\s+)?(?:active|open|running|in motion|on the go|going)/,
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

// Calendar (migration 007) works in naive local wall-clock strings, not ISO/UTC — matching how
// src/screens/calendar.js stores starts_at — so "today" for the calendar is the user's local
// day, not a UTC slice.
function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const CAL_CATEGORY_LABEL = { personal: 'Personal', family: 'Family', digital_side: 'Digital Side' };

function calTime(startsAt) {
  const s = String(startsAt || '');
  try {
    const d = new Date(s.replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { /* fall through */ }
  return s.length >= 16 ? s.slice(11, 16) : 'all day';
}

// today | tomorrow | this weekend | this week (default: today)
function calendarWindow(q) {
  const s = q.toLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (/tomorrow/.test(s)) {
    const from = addDays(today, 1);
    return { from: localDateStr(from), to: localDateStr(addDays(from, 1)), label: 'tomorrow' };
  }
  if (/this weekend|the weekend/.test(s)) {
    const daysToSat = (6 - today.getDay() + 7) % 7;
    const sat = addDays(today, daysToSat);
    return { from: localDateStr(sat), to: localDateStr(addDays(sat, 2)), label: 'this weekend' };
  }
  if (/this week|coming up|next 7 days|next week|the week/.test(s)) {
    return { from: localDateStr(today), to: localDateStr(addDays(today, 7)), label: 'the next 7 days' };
  }
  return { from: localDateStr(today), to: localDateStr(addDays(today, 1)), label: 'today' };
}

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

const plural = (n) => (n === 1 ? '' : 's');
function joinAnd(parts) {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] || '';
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(', ')}, and ${p[p.length - 1]}`;
}
const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// One shared read of "the day", reused by the Today screen (todayBrief) and the whats_today
// Jarvie answer so both tell the same story from the same live data. Pure read.
async function gatherDay() {
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrowStr = localDateStr(addDays(now, 1));
  const in4Str = localDateStr(addDays(now, 4));
  const todayIso = now.toISOString().slice(0, 10);
  const in7Iso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [calToday, calSoon, view, health, dueWeek] = await Promise.all([
    listCalendarEventsBetween({ from: todayStr, to: tomorrowStr }),
    listCalendarEventsBetween({ from: tomorrowStr, to: in4Str }),
    getTodayView(),
    getBusinessHealth(),
    listTasksDueBetween({ from: todayIso, to: in7Iso, includeDone: false }),
  ]);
  const overdue = health.overdueTasks || [];
  const overdueIds = new Set(overdue.map((t) => t.id));
  const highPri = (view.highPriorityTasks || []).filter((t) => !overdueIds.has(t.id));
  const approvals = view.awaitingApproval || [];
  const midBriefs = view.midStageBriefs || [];
  const dueToday = dueWeek.filter((t) => t.due_date === todayIso && !overdueIds.has(t.id));
  const dueSoon = dueWeek.filter((t) => t.due_date > todayIso);
  return { todayIso, calToday, calSoon, overdue, highPri, approvals, midBriefs, dueToday, dueSoon, dueWeek };
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
  const calFrom = localDateStr(new Date());
  const calTo = localDateStr(addDays(new Date(), 7));
  const [due, briefs, calEvents] = await Promise.all([
    listTasksDueBetween({ from: today, to: in7, includeDone: false }),
    listDoorBriefs(),
    listCalendarEventsBetween({ from: calFrom, to: calTo }),
  ]);
  const since = daysAgo(3);
  const inMotion = briefs.filter((b) => b.planning_step !== 'complete' && b.updated_at >= since);
  const parts = [];
  if (due.length) parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due in the next 7 days`);
  if (calEvents.length) parts.push(`${calEvents.length} calendar event${calEvents.length === 1 ? '' : 's'} this week`);
  if (inMotion.length) parts.push(`${inMotion.length} Door mission${inMotion.length === 1 ? '' : 's'} in motion`);
  return {
    intent: 'whats_next',
    title: due.length || calEvents.length
      ? [
          due.length ? `${due.length} task${due.length === 1 ? '' : 's'} due` : '',
          calEvents.length ? `${calEvents.length} event${calEvents.length === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(', ') + ' · next 7 days'
      : 'Nothing due this week',
    summary: parts.length ? parts.join(', ') + '.' : 'No tasks due in the next 7 days, no calendar events, and no Door missions touched in the last 3 days.',
    evidence: [
      ...due.map((t) => ({ kind: 'task', id: t.id, label: `Due ${t.due_date}: ${t.title} (${t.priority})`, goTo: 'tasks' })),
      ...calEvents.map((e) => ({ kind: 'calendar_event', id: e.id, label: `${e.starts_at.slice(0, 10)} ${calTime(e.starts_at)} — ${e.title} · ${CAL_CATEGORY_LABEL[e.category] || e.category}`, goTo: 'calendar' })),
      ...inMotion.map((b) => ({ kind: 'door_brief', id: b.id, label: `In motion: ${b.business || 'Untitled mission'} — ${b.planning_step}`, goTo: 'door' })),
    ],
    records: { due, inMotion, calEvents },
  };
}

// An optional category and/or person the question narrows to. `name` is matched literally
// against the stored title / notes / location — it never invents an attendee the data doesn't
// have (there is no attendee column; "Zen" only matches because an event literally mentions it).
function calendarFilter(q) {
  const s = ` ${q.toLowerCase()} `;
  let category = null;
  if (/digital[\s\-]side/.test(s)) category = 'digital_side';
  else if (/\bfamily\b|\bkids?\b|\bschool\b/.test(s)) category = 'family';
  else if (/\bpersonal\b/.test(s)) category = 'personal';

  const STOP = new Set(['i', 'we', 'you', 'they', 'the', 'my', 'our', 'it', 'that', 'this',
    'digital', 'side', 'family', 'personal', 'everyone', 'anyone', 'someone', 'kids']);
  let name = null;
  let m = s.match(/(?:what(?:'s| is)?|when(?:'s| is)?)\s+(?:on\s+|in\s+)?([a-z][a-z'’.\-]+)'s\s+(?:calendar|schedule|agenda|day|week|diary|plate|plans?)/);
  if (!m) m = s.match(/what\s+(?:does|do|is|are|has|have|will)\s+([a-z][a-z'’.\-]+)\s+(?:have|has|got|get|getting|doing|do|scheduled|planned|on|up to|going)/);
  if (m && !STOP.has(m[1])) name = m[1].replace(/[.'’\-]+$/, '');
  return { category, name };
}
const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

// Calendar (migration 007) — "what do I have today / tomorrow / this week / this weekend", plus
// optional narrowing by category ("what Digital Side things are coming up") or by a name that
// literally appears in an event ("what does Zen have this week"). Reads calendar_event only;
// pure read — never writes, never touches a client/project record, never fabricates an event.
async function buildCalendarLookup(question) {
  const win = calendarWindow(question);
  const { category, name } = calendarFilter(question);
  let events = await listCalendarEventsBetween({ from: win.from, to: win.to });
  if (category) events = events.filter((e) => e.category === category);
  if (name) {
    const n = name.toLowerCase();
    events = events.filter((e) => `${e.title} ${e.notes || ''} ${e.location || ''}`.toLowerCase().includes(n));
  }
  const scopeBits = [name ? cap(name) : null, category ? CAL_CATEGORY_LABEL[category] : null].filter(Boolean);
  const scopeLabel = scopeBits.length ? `${scopeBits.join(' · ')} · ${win.label}` : win.label;
  const datePrefix = (win.label === 'today' || win.label === 'tomorrow') ? '' : true;
  const byCat = tally(events, (e) => e.category);
  const label = (e) => {
    const cat = CAL_CATEGORY_LABEL[e.category] || e.category;
    const day = datePrefix ? `${e.starts_at.slice(0, 10)} ` : '';
    return `${day}${calTime(e.starts_at)} — ${e.title} · ${cat}${e.location ? ` · ${e.location}` : ''}`;
  };
  const nothing = scopeBits.length
    ? `Nothing on the calendar for ${scopeBits.join(' · ')} ${win.label}.`
    : `Nothing on your calendar for ${win.label}.`;
  return {
    intent: 'calendar_lookup',
    title: events.length
      ? `${events.length} event${events.length === 1 ? '' : 's'} · ${scopeLabel}`
      : `Calendar clear · ${scopeLabel}`,
    summary: events.length
      ? byCat.map(([c, n]) => `${n} ${(CAL_CATEGORY_LABEL[c] || c).toLowerCase()}`).join(', ') + '.'
      : nothing,
    evidence: events.map((e) => ({ kind: 'calendar_event', id: e.id, label: label(e), goTo: 'calendar' })),
    records: { window: win.label, from: win.from, to: win.to, category, name, byCategory: byCat, events },
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

// "What's happening today?" — the daily briefing as an answer. Combines calendar, overdue /
// due-today tasks, high-priority tasks, and approvals from the same read the Today screen uses.
async function buildWhatsToday() {
  const d = await gatherDay();
  const bits = [];
  if (d.calToday.length) bits.push(`${d.calToday.length} event${plural(d.calToday.length)} today`);
  if (d.overdue.length) bits.push(`${d.overdue.length} overdue task${plural(d.overdue.length)}`);
  if (d.dueToday.length) bits.push(`${d.dueToday.length} task${plural(d.dueToday.length)} due today`);
  if (d.highPri.length) bits.push(`${d.highPri.length} high-priority task${plural(d.highPri.length)}`);
  if (d.approvals.length) bits.push(`${d.approvals.length} awaiting your approval`);
  const count = d.calToday.length + d.overdue.length + d.dueToday.length + d.highPri.length + d.approvals.length;
  return {
    intent: 'whats_today',
    title: count ? `Today — ${count} thing${plural(count)} to know` : 'Today — all clear',
    summary: bits.length
      ? 'You have ' + joinAnd(bits) + '.'
      : 'Your day is clear — nothing on the calendar, nothing overdue, and nothing waiting on you.',
    evidence: [
      ...d.calToday.map((e) => ({ kind: 'calendar_event', id: e.id, label: `${calTime(e.starts_at)} — ${e.title} · ${CAL_CATEGORY_LABEL[e.category] || e.category}${e.location ? ` · ${e.location}` : ''}`, goTo: 'calendar' })),
      ...d.overdue.map((t) => ({ kind: 'task', id: t.id, label: `Overdue: ${t.title} (was due ${t.due_date})`, goTo: 'tasks' })),
      ...d.dueToday.map((t) => ({ kind: 'task', id: t.id, label: `Due today: ${t.title} (${t.priority})`, goTo: 'tasks' })),
      ...d.highPri.map((t) => ({ kind: 'task', id: t.id, label: `${t.priority === 'urgent' ? 'Urgent' : 'High-priority'}: ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`, goTo: 'tasks' })),
      ...d.approvals.map((h) => ({ kind: 'handoff', id: h.id, label: `Awaiting approval: “${h.objective}” (${h.from_worker} → ${h.to_worker})`, goTo: 'ai' })),
    ],
    records: { ...d },
  };
}

// "What's awaiting approval?" / "What client work is waiting on me?" — returned handoffs plus
// the two other places work sits waiting on Nev: Door missions parked at the handoff step and
// paused projects.
async function buildAwaitingApproval() {
  const [handoffs, briefs, projects, clients] = await Promise.all([
    listHandoffs(), listDoorBriefs(), listProjects(), listClients(),
  ]);
  const clientName = (id) => clients.find((c) => c.id === id)?.name;
  const returned = handoffs.filter((h) => h.status === 'returned');
  const doorHandoff = briefs.filter((b) => b.planning_step === 'handoff');
  const paused = projects.filter((p) => p.status === 'paused');
  const total = returned.length + doorHandoff.length + paused.length;
  const parts = [];
  if (returned.length) parts.push(`${returned.length} handoff${plural(returned.length)} returned for your approve/reject`);
  if (doorHandoff.length) parts.push(`${doorHandoff.length} Door mission${plural(doorHandoff.length)} at the handoff step`);
  if (paused.length) parts.push(`${paused.length} project${plural(paused.length)} paused and waiting on you`);
  return {
    intent: 'awaiting_approval',
    title: total ? `${total} thing${plural(total)} waiting on your decision` : 'Nothing is waiting on your approval',
    summary: total
      ? upperFirst(joinAnd(parts)) + '.'
      : 'No returned handoffs, no Door missions at the handoff step, and no paused projects.',
    evidence: [
      ...returned.map((h) => ({ kind: 'handoff', id: h.id, label: `Approve / reject: “${h.objective}” (${h.from_worker} → ${h.to_worker})`, goTo: 'ai' })),
      ...doorHandoff.map((b) => ({ kind: 'door_brief', id: b.id, label: `At handoff: ${b.business || 'Untitled mission'}${b.client_id && clientName(b.client_id) ? ` · ${clientName(b.client_id)}` : ''}`, goTo: 'door' })),
      ...paused.map((p) => ({ kind: 'project', id: p.id, label: `Paused: ${p.title}${p.client_id && clientName(p.client_id) ? ` · ${clientName(p.client_id)}` : ''}`, goTo: 'clients' })),
    ],
    records: { returned, doorHandoff, paused },
  };
}

// "What Door projects are active?" — every Digital Door mission not marked complete, with its
// planning step and client.
async function buildActiveDoors() {
  const [briefs, clients] = await Promise.all([listDoorBriefs(), listClients()]);
  const clientName = (id) => clients.find((c) => c.id === id)?.name;
  const active = briefs.filter((b) => b.planning_step !== 'complete');
  const started = active.filter((b) => b.planning_step !== 'outcome');
  const byStep = tally(active, (b) => b.planning_step);
  return {
    intent: 'active_doors',
    title: active.length
      ? `${active.length} Door mission${plural(active.length)} open${started.length !== active.length ? ` (${started.length} past intake)` : ''}`
      : 'No Door missions open',
    summary: active.length
      ? byStep.map(([s, n]) => `${n} at "${s.replace(/_/g, ' ')}"`).join(', ') + '.'
      : 'Every Digital Door mission is complete or not yet created. Start one from the Door Workflow screen.',
    evidence: active.map((b) => ({
      kind: 'door_brief', id: b.id,
      label: `${b.business || 'Untitled mission'} — ${b.planning_step}${b.client_id && clientName(b.client_id) ? ` · ${clientName(b.client_id)}` : ''}`,
      goTo: 'door',
    })),
    records: { active, byStep },
  };
}

// "What are my high-priority tasks?" — open tasks marked high or urgent, urgent first, then by
// due date, overdue flagged.
async function buildHighPriorityTasks() {
  const [tasks, projects] = await Promise.all([listTasks(), listProjects()]);
  const projTitle = (id) => projects.find((p) => p.id === id)?.title;
  const todayIso = new Date().toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status !== 'done' && (t.priority === 'high' || t.priority === 'urgent'));
  const urgent = open.filter((t) => t.priority === 'urgent');
  const overdue = open.filter((t) => t.due_date && t.due_date < todayIso);
  const sorted = [...open].sort((a, b) => {
    const u = (b.priority === 'urgent' ? 1 : 0) - (a.priority === 'urgent' ? 1 : 0);
    if (u) return u;
    return (a.due_date || '9999-99-99') < (b.due_date || '9999-99-99') ? -1 : 1;
  });
  const parts = [];
  if (urgent.length) parts.push(`${urgent.length} urgent`);
  if (open.length - urgent.length) parts.push(`${open.length - urgent.length} high`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  return {
    intent: 'high_priority_tasks',
    title: open.length ? `${open.length} high-priority task${plural(open.length)}` : 'No high-priority tasks',
    summary: open.length ? joinAnd(parts) + '.' : 'Nothing open is marked high or urgent.',
    evidence: sorted.map((t) => ({
      kind: 'task', id: t.id,
      label: `${t.priority === 'urgent' ? 'Urgent' : 'High'}: ${t.title}${t.due_date ? ` · due ${t.due_date}${t.due_date < todayIso ? ' (overdue)' : ''}` : ''}${t.project_id && projTitle(t.project_id) ? ` · ${projTitle(t.project_id)}` : ''}`,
      goTo: 'tasks',
    })),
    records: { open, urgent, overdue },
  };
}

// "What's happening with The Digital Side?" — a business rollup from the entities already in
// Command Center. Personal/family calendar rows are excluded on purpose (only digital_side
// events count toward the business view).
async function buildBusinessOverview() {
  const now = new Date();
  const [clients, projects, briefs, handoffs, health, weekEvents] = await Promise.all([
    listClients(), listProjects(), listDoorBriefs(), listHandoffs(), getBusinessHealth(),
    listCalendarEventsBetween({ from: localDateStr(now), to: localDateStr(addDays(now, 7)) }),
  ]);
  const activeClients = clients.filter((c) => c.status === 'active');
  const prospects = clients.filter((c) => c.status === 'prospect');
  const activeProjects = projects.filter((p) => p.status === 'active');
  const missionsInMotion = briefs.filter((b) => b.planning_step !== 'complete');
  const approvals = handoffs.filter((h) => h.status === 'returned');
  const dsWeek = weekEvents.filter((e) => e.category === 'digital_side');
  const overdue = health.overdueTasks || [];
  const stale = (health.stalledBriefs || []).length + (health.staleHandoffs || []).length;

  const parts = [
    `${activeClients.length} active client${plural(activeClients.length)}`,
    `${activeProjects.length} active project${plural(activeProjects.length)}`,
    `${missionsInMotion.length} Door mission${plural(missionsInMotion.length)} in motion`,
  ];
  const flags = [];
  if (approvals.length) flags.push(`${approvals.length} awaiting approval`);
  if (overdue.length) flags.push(`${overdue.length} overdue task${plural(overdue.length)}`);
  if (stale) flags.push(`${stale} item${plural(stale)} going stale`);
  if (dsWeek.length) flags.push(`${dsWeek.length} Digital Side event${plural(dsWeek.length)} this week`);

  return {
    intent: 'business_overview',
    title: 'The Digital Side — right now',
    summary: upperFirst(joinAnd(parts)) + '.'
      + (prospects.length ? ` ${prospects.length} prospect${plural(prospects.length)} in the pipeline.` : '')
      + (flags.length ? ` Flags: ${flags.join(', ')}.` : ' Nothing flagged.'),
    evidence: [
      ...approvals.map((h) => ({ kind: 'handoff', id: h.id, label: `Awaiting approval: “${h.objective}”`, goTo: 'ai' })),
      ...missionsInMotion.map((b) => ({ kind: 'door_brief', id: b.id, label: `Mission: ${b.business || 'Untitled mission'} — ${b.planning_step}`, goTo: 'door' })),
      ...activeProjects.map((p) => ({ kind: 'project', id: p.id, label: `Project: ${p.title} — ${(p.production_stage || 'intake').replace(/_/g, ' ')}`, goTo: 'clients' })),
      ...dsWeek.map((e) => ({ kind: 'calendar_event', id: e.id, label: `${e.starts_at.slice(0, 10)} ${calTime(e.starts_at)} — ${e.title}`, goTo: 'calendar' })),
    ],
    records: { activeClients, activeProjects, missionsInMotion, approvals, dsWeek, overdue, prospects },
  };
}

function buildCapabilities() {
  return {
    intent: 'unknown',
    title: "That's not something I can answer from your data",
    summary: 'I only answer from what\'s saved in Command Center — your calendar, tasks, clients, projects, Door missions, handoffs, inbox and activity log. I can tell you what\'s happening today, what needs you, what\'s awaiting approval, where a client or mission stands, what\'s on the calendar, and how The Digital Side is doing overall. Try one of the suggested questions.',
    evidence: [],
    records: {},
  };
}

// ---------------------------------------------------------------- public entry points

export async function suggestedQuestions() {
  const base = [
    "What's happening today?",
    'What do I have tomorrow?',
    'What needs my attention?',
    "What's awaiting approval?",
    'What are my high-priority tasks?',
    'What Door projects are active?',
    "What's happening with The Digital Side?",
  ];
  try {
    const clients = await listClients();
    const name = clients.find((c) => c.status === 'active')?.name || clients[0]?.name;
    if (name) base.push(`Where does ${name} stand?`);
  } catch { /* no clients yet — the fixed list is still useful */ }
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
    case 'calendar_lookup': return buildCalendarLookup(text);
    case 'quiet_clients': return buildQuietClients();
    case 'whats_today': return buildWhatsToday();
    case 'awaiting_approval': return buildAwaitingApproval();
    case 'high_priority_tasks': return buildHighPriorityTasks();
    case 'active_doors': return buildActiveDoors();
    case 'business_overview': return buildBusinessOverview();
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
    { name: 'calendar_lookup', when: 'the user asks what is on their calendar / schedule for today, tomorrow, this week or this weekend — including narrowed to one category (personal / family / Digital Side) or to a person or thing named in an event (e.g. "what does Zen have this week")' },
    { name: 'quiet_clients', when: 'the user asks which active clients have gone quiet / need a check-in / have had no recent activity' },
    { name: 'whats_today', when: 'the user asks what is happening today / to be briefed on their day / what is on their plate today — a combined view of calendar, overdue and due-today tasks, high-priority tasks and approvals' },
    { name: 'awaiting_approval', when: 'the user asks what is awaiting approval / needs their sign-off / what client work is waiting on them' },
    { name: 'high_priority_tasks', when: 'the user asks for their high-priority or urgent tasks' },
    { name: 'active_doors', when: 'the user asks which Digital Door projects / missions are active or in progress' },
    { name: 'business_overview', when: 'the user asks how the business / The Digital Side is doing overall' },
  ];
}

export const FORCEABLE_INTENTS = ['what_changed', 'needs_me', 'why_blocked', 'where_stands', 'whats_stalled', 'whats_next', 'calendar_lookup', 'quiet_clients', 'whats_today', 'awaiting_approval', 'high_priority_tasks', 'active_doors', 'business_overview'];

// Deterministic daily briefing for the Today screen: a one-line synthesis, the single most
// important next action, an orb pressure level, and the raw sections the screen renders. Same
// live read (gatherDay) the "what's happening today" Jarvie answer uses. Pure read, no writes.
export async function todayBrief() {
  const d = await gatherDay();
  const nowHM = new Date().toTimeString().slice(0, 5);

  const bits = [];
  if (d.calToday.length) bits.push(`${d.calToday.length} event${plural(d.calToday.length)} today`);
  if (d.overdue.length) bits.push(`${d.overdue.length} overdue`);
  if (d.dueToday.length) bits.push(`${d.dueToday.length} due today`);
  if (d.highPri.length) bits.push(`${d.highPri.length} high-priority task${plural(d.highPri.length)}`);
  if (d.approvals.length) bits.push(`${d.approvals.length} awaiting approval`);
  const headline = bits.length
    ? 'You have ' + joinAnd(bits) + '.'
    : 'Nothing urgent is waiting on you and nothing is scheduled today.';
  // Drives the Jarvie orb — honest, straight from the retrieved data.
  const pressure = (d.approvals.length || d.overdue.length) ? 'urgent' : (bits.length ? 'attention' : 'clear');

  const nextEvt = d.calToday.find((e) => (e.starts_at.slice(11, 16) || '') >= nowHM) || d.calToday[0];
  let top = null;
  if (d.approvals[0]) top = { label: `Approve or reject “${d.approvals[0].objective}”`, goTo: 'ai' };
  else if (d.overdue[0]) top = { label: `Finish the overdue task “${d.overdue[0].title}”`, goTo: 'tasks' };
  else if (d.dueToday[0]) top = { label: `“${d.dueToday[0].title}” is due today`, goTo: 'tasks' };
  else if (nextEvt) top = { label: `${calTime(nextEvt.starts_at)} — ${nextEvt.title}`, goTo: 'calendar' };
  else if (d.highPri[0]) top = { label: `Start the high-priority task “${d.highPri[0].title}”`, goTo: 'tasks' };
  else if (d.midBriefs[0]) top = { label: `Move “${d.midBriefs[0].business || 'Untitled mission'}” forward`, goTo: 'door' };

  return { headline, top, pressure, day: d };
}

export const __INTERNAL__ = { classify, extractEntityPhrase, matchByName, waitingOn, windowFromQuestion, calendarWindow, calendarFilter, context };
