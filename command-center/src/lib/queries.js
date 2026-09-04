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

export async function listArtifacts({ relatedTaskId, relatedProjectId } = {}) {
  if (relatedTaskId) return getDb().select('SELECT * FROM artifact WHERE related_task_id = $1 ORDER BY created_at DESC', [relatedTaskId]);
  if (relatedProjectId) return getDb().select('SELECT * FROM artifact WHERE related_project_id = $1 ORDER BY created_at DESC', [relatedProjectId]);
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
    "SELECT * FROM digital_door_brief WHERE stage NOT IN ('outcome','complete') ORDER BY updated_at DESC"
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
    "SELECT * FROM digital_door_brief WHERE stage NOT IN ('complete') AND updated_at < $1",
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
