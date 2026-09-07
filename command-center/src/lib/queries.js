// Read-only query helpers. Nothing in this file writes to SQLite — mutations only ever happen
// through src/lib/actions.js (the Single-Writer Boundary, PHASE1-SPEC.md §2).
//
// Today and BusinessHealth are views, not tables — computed here at read time from the entities
// below, never written to directly (§3).

import { getDb } from './db.js';

export async function listClients() {
  return getDb().select('SELECT * FROM client ORDER BY created_at DESC');
}

export async function getClient(id) {
  const rows = await getDb().select('SELECT * FROM client WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listProjects({ clientId } = {}) {
  if (clientId) return getDb().select('SELECT * FROM project WHERE client_id = $1 ORDER BY created_at DESC', [clientId]);
  return getDb().select('SELECT * FROM project ORDER BY created_at DESC');
}

export async function listTasks({ projectId, status } = {}) {
  const clauses = [];
  const params = [];
  if (projectId !== undefined) { params.push(projectId); clauses.push(`project_id = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().select(`SELECT * FROM task ${where} ORDER BY created_at DESC`, params);
}

export async function listDoorBriefs() {
  return getDb().select('SELECT * FROM digital_door_brief ORDER BY updated_at DESC');
}

export async function getDoorBrief(id) {
  const rows = await getDb().select('SELECT * FROM digital_door_brief WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listInboxItems({ status } = {}) {
  if (status) return getDb().select('SELECT * FROM inbox_item WHERE status = $1 ORDER BY created_at DESC', [status]);
  return getDb().select('SELECT * FROM inbox_item ORDER BY created_at DESC');
}

export async function listHandoffs({ status } = {}) {
  if (status) return getDb().select('SELECT * FROM handoff WHERE status = $1 ORDER BY updated_at DESC', [status]);
  return getDb().select('SELECT * FROM handoff ORDER BY updated_at DESC');
}

export async function listArtifacts({ relatedTaskId, relatedProjectId, relatedHandoffId } = {}) {
  if (relatedTaskId) return getDb().select('SELECT * FROM artifact WHERE related_task_id = $1 ORDER BY created_at DESC', [relatedTaskId]);
  if (relatedProjectId) return getDb().select('SELECT * FROM artifact WHERE related_project_id = $1 ORDER BY created_at DESC', [relatedProjectId]);
  if (relatedHandoffId) return getDb().select('SELECT * FROM artifact WHERE related_handoff_id = $1 ORDER BY created_at DESC', [relatedHandoffId]);
  return getDb().select('SELECT * FROM artifact ORDER BY created_at DESC');
}

export async function listIntegrations() {
  return getDb().select('SELECT * FROM integration_record ORDER BY connection_type ASC, service_name ASC');
}

export async function listActivityEvents({ entityType, limit = 200 } = {}) {
  if (entityType) {
    return getDb().select(
      'SELECT * FROM activity_event WHERE related_entity_type = $1 ORDER BY created_at DESC LIMIT $2',
      [entityType, limit]
    );
  }
  return getDb().select('SELECT * FROM activity_event ORDER BY created_at DESC LIMIT $1', [limit]);
}

// Read-only helpers added for Jarvie Phase A (docs/JARVIE-PHASE-A.md §4/§8). Plain SELECTs —
// no schema change, no writes. created_at is stored as an ISO-8601 string, so a lexicographic
// >= comparison is a correct chronological filter.
export async function listActivityEventsSince({ since, limit = 200 } = {}) {
  return getDb().select(
    'SELECT * FROM activity_event WHERE created_at >= $1 ORDER BY created_at DESC LIMIT $2',
    [since, limit]
  );
}

export async function listActivityEventsForEntity({ relatedEntityId, limit = 20 } = {}) {
  return getDb().select(
    'SELECT * FROM activity_event WHERE related_entity_id = $1 ORDER BY created_at DESC LIMIT $2',
    [relatedEntityId, limit]
  );
}

// Jarvie Phase D (docs/JARVIE-PHASE-D.md §5.1): tasks with a due date inside a window.
// `from`/`to` are 'YYYY-MM-DD' strings (task.due_date is stored that way); lexicographic
// comparison is correct. Read-only, no schema change.
export async function listTasksDueBetween({ from, to, includeDone = false } = {}) {
  const done = includeDone ? '' : " AND status != 'done'";
  return getDb().select(
    `SELECT * FROM task WHERE due_date IS NOT NULL AND due_date >= $1 AND due_date <= $2${done} ORDER BY due_date ASC`,
    [from, to]
  );
}

// ---------------------------------------------------------------- Calendar (migration 007)
// Personal + family + Digital Side events. `starts_at` / `ends_at` are stored as naive local
// wall-clock strings 'YYYY-MM-DDTHH:MM' (no timezone) — see src/screens/calendar.js for why —
// so day-bucketing and "today / tomorrow / this week" filters are plain lexicographic string
// comparisons. Read-only, like everything else in this file. calendar_event has no
// activity_event trigger by design: personal calendar data stays out of the business audit
// trail (docs/JARVIE-PERSONA.md "Two Worlds"; docs/DECISIONS.md).
export async function listCalendarEvents({ limit = 500 } = {}) {
  return getDb().select('SELECT * FROM calendar_event ORDER BY starts_at ASC LIMIT $1', [limit]);
}

// `from` inclusive, `to` exclusive — both 'YYYY-MM-DD' or a full local datetime string.
export async function listCalendarEventsBetween({ from, to, limit = 500 } = {}) {
  return getDb().select(
    'SELECT * FROM calendar_event WHERE starts_at >= $1 AND starts_at < $2 ORDER BY starts_at ASC LIMIT $3',
    [from, to, limit]
  );
}

// Everything at or after `from` (a 'YYYY-MM-DD' string), oldest first — the Calendar screen's
// upcoming list. Pass the start of today so events earlier today still show.
export async function listUpcomingCalendarEvents({ from, limit = 200 } = {}) {
  return getDb().select(
    'SELECT * FROM calendar_event WHERE starts_at >= $1 ORDER BY starts_at ASC LIMIT $2',
    [from, limit]
  );
}

export async function getLegacyState(key, fallback) {
  const rows = await getDb().select('SELECT value FROM legacy_state WHERE key = $1', [key]);
  if (!rows.length) return fallback;
  try { return JSON.parse(rows[0].value); } catch { return fallback; }
}

// ---------------------------------------------------------------- Today (derived view, §9.1)

export async function getTodayView() {
  const db = getDb();
  const highPriorityTasks = await db.select(
    "SELECT * FROM task WHERE status != 'done' AND priority IN ('high','urgent') ORDER BY due_date IS NULL, due_date ASC"
  );
  const midStageBriefs = await db.select(
    "SELECT * FROM digital_door_brief WHERE planning_step NOT IN ('outcome','complete') ORDER BY updated_at DESC"
  );
  const awaitingApproval = await db.select("SELECT * FROM handoff WHERE status = 'returned' ORDER BY updated_at DESC");
  return { highPriorityTasks, midStageBriefs, awaitingApproval };
}

// ---------------------------------------------------------------- Business Health (derived view, §9.8)

export async function getBusinessHealth() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = await db.select(
    "SELECT * FROM task WHERE status != 'done' AND due_date IS NOT NULL AND due_date < $1", [today]
  );
  const stalledBriefs = await db.select(
    "SELECT * FROM digital_door_brief WHERE planning_step NOT IN ('complete') AND updated_at < $1",
    [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()]
  );
  const untriagedInbox = await db.select("SELECT * FROM inbox_item WHERE status = 'untriaged'");
  const staleHandoffs = await db.select(
    "SELECT * FROM handoff WHERE status IN ('pending','in_progress') AND updated_at < $1",
    [new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()]
  );
  return { overdueTasks, stalledBriefs, untriagedInbox, staleHandoffs };
}

// ---------------------------------------------------------------- Search (§9.11)

export async function search(term) {
  if (!term || !term.trim()) return { clients: [], projects: [], tasks: [], artifacts: [] };
  const db = getDb();
  const like = `%${term.trim()}%`;
  const [clients, projects, tasks, artifacts] = await Promise.all([
    db.select('SELECT * FROM client WHERE name LIKE $1 OR contact_info LIKE $1', [like]),
    db.select('SELECT * FROM project WHERE title LIKE $1 OR type LIKE $1', [like]),
    db.select('SELECT * FROM task WHERE title LIKE $1', [like]),
    db.select('SELECT * FROM artifact WHERE reference LIKE $1', [like]),
  ]);
  return { clients, projects, tasks, artifacts };
}
