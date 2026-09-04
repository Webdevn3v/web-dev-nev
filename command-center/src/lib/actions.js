// The Action Layer — PHASE1-SPEC.md §4.
//
// This is the ONLY place SQLite is written to for the core entities. Regular UI calls these
// functions directly today; later, Jarvis calls the exact same functions after interpreting
// natural language — no separate mutation path is ever built for it (§1, §2).
//
// Every action: (1) validates input, (2) performs the mutation via getDb(), (3) emits an
// ActivityEvent. Risk-tiered actions (external/write, high-impact) gate on confirmGate() first —
// see src/lib/risk.js for the tier table and src/lib/confirm.js for the UI gate.

import { getDb } from './db.js';
import { newId, nowIso } from './ids.js';
import { resolveTier, requiresConfirmation, TIER } from './risk.js';
import { confirmGate } from './confirm.js';

export class ActionDeclinedError extends Error {
  constructor(actionName) {
    super(`${actionName} was not approved`);
    this.name = 'ActionDeclinedError';
    this.actionName = actionName;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
}

async function assertExists(table, id, label) {
  const db = getDb();
  const rows = await db.select(`SELECT id FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new ValidationError(`${label} "${id}" does not exist`);
}

async function emitEvent({ eventType, entityType, entityId, actor = 'nev', payload }) {
  const db = getDb();
  await db.execute(
    `INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('evt'), eventType, entityType ?? null, entityId ?? null, actor, payload ? JSON.stringify(payload) : null, nowIso()]
  );
}

// Runs one named action end-to-end: risk gate -> mutation -> ActivityEvent.
// `tierArgs` is passed to resolveTier() so dynamically-tiered actions (AdvanceDoorStage) can
// look at the call's arguments to decide safe/external/high-impact.
async function runAction(actionName, { title, detail, entityType, entityId, eventType, payload, tierArgs, mutate }) {
  const tier = resolveTier(actionName, tierArgs);
  if (requiresConfirmation(tier)) {
    const approved = await confirmGate({ tier, title, detail });
    if (!approved) throw new ActionDeclinedError(actionName);
    if (tier === TIER.HIGH_IMPACT) {
      await emitEvent({ eventType: 'approval_granted', entityType, entityId, payload: { action: actionName } });
    }
  }
  const result = await mutate();
  await emitEvent({ eventType, entityType, entityId, payload });
  return result;
}

// ---------------------------------------------------------------- Client

export async function CreateClient({ name, contactInfo = '', status = 'prospect' }) {
  required(name, 'name');
  oneOf(status, ['prospect', 'active', 'archived'], 'status');
  const id = newId('client');
  return runAction('CreateClient', {
    entityType: 'client', entityId: id, eventType: 'client_created', payload: { name, status },
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO client (id, name, contact_info, status, created_at) VALUES ($1,$2,$3,$4,$5)',
        [id, name, contactInfo, status, nowIso()]
      );
      return id;
    },
  });
}

export async function UpdateClient({ id, name, contactInfo, status }) {
  required(id, 'id');
  await assertExists('client', id, 'Client');
  if (status) oneOf(status, ['prospect', 'active', 'archived'], 'status');
  return runAction('UpdateClient', {
    entityType: 'client', entityId: id, eventType: 'client_updated', payload: { name, contactInfo, status },
    mutate: async () => {
      const db = getDb();
      if (name !== undefined) await db.execute('UPDATE client SET name = $1 WHERE id = $2', [name, id]);
      if (contactInfo !== undefined) await db.execute('UPDATE client SET contact_info = $1 WHERE id = $2', [contactInfo, id]);
      if (status !== undefined) await db.execute('UPDATE client SET status = $1 WHERE id = $2', [status, id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Project

export async function CreateProject({ clientId, title, type = '', status = 'active' }) {
  required(clientId, 'clientId');
  required(title, 'title');
  await assertExists('client', clientId, 'Client');
  const id = newId('project');
  return runAction('CreateProject', {
    entityType: 'project', entityId: id, eventType: 'project_created', payload: { clientId, title },
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO project (id, client_id, title, type, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, clientId, title, type, status, nowIso()]
      );
      return id;
    },
  });
}

export async function UpdateProjectStatus({ id, status }) {
  required(id, 'id');
  required(status, 'status');
  await assertExists('project', id, 'Project');
  return runAction('UpdateProjectStatus', {
    entityType: 'project', entityId: id, eventType: 'project_status_updated', payload: { status },
    mutate: async () => {
      await getDb().execute('UPDATE project SET status = $1 WHERE id = $2', [status, id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Task

export async function CreateTask({ projectId = null, title, priority = 'normal', dueDate = null }) {
  required(title, 'title');
  oneOf(priority, ['low', 'normal', 'high', 'urgent'], 'priority');
  if (projectId) await assertExists('project', projectId, 'Project');
  const id = newId('task');
  return runAction('CreateTask', {
    entityType: 'task', entityId: id, eventType: 'task_created', payload: { title, projectId, priority },
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO task (id, project_id, title, status, priority, due_date, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, projectId, title, 'open', priority, dueDate, nowIso()]
      );
      return id;
    },
  });
}

export async function UpdateTask({ id, title, status, priority, dueDate }) {
  required(id, 'id');
  await assertExists('task', id, 'Task');
  if (status) oneOf(status, ['open', 'doing', 'done'], 'status');
  if (priority) oneOf(priority, ['low', 'normal', 'high', 'urgent'], 'priority');
  return runAction('UpdateTask', {
    entityType: 'task', entityId: id, eventType: 'task_updated', payload: { title, status, priority, dueDate },
    mutate: async () => {
      const db = getDb();
      if (title !== undefined) await db.execute('UPDATE task SET title = $1 WHERE id = $2', [title, id]);
      if (status !== undefined) await db.execute('UPDATE task SET status = $1 WHERE id = $2', [status, id]);
      if (priority !== undefined) await db.execute('UPDATE task SET priority = $1 WHERE id = $2', [priority, id]);
      if (dueDate !== undefined) await db.execute('UPDATE task SET due_date = $1 WHERE id = $2', [dueDate, id]);
      return id;
    },
  });
}

export async function CompleteTask({ id }) {
  required(id, 'id');
  await assertExists('task', id, 'Task');
  return runAction('CompleteTask', {
    entityType: 'task', entityId: id, eventType: 'task_completed', payload: {},
    mutate: async () => {
      await getDb().execute("UPDATE task SET status = 'done' WHERE id = $1", [id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Digital Door Brief

const DOOR_STAGES = ['outcome', 'customer', 'paths', 'destinations', 'build', 'handoff', 'complete'];
const DOOR_FIELDS = [
  'business', 'primaryGoal', 'customer', 'urgentNeed', 'customerIntent',
  'tone', 'paths', 'destinations', 'deliverables', 'handoff', 'notes',
];
const DOOR_FIELD_COLUMN = {
  primaryGoal: 'primary_goal', urgentNeed: 'urgent_need', customerIntent: 'customer_intent',
};

export async function CreateDoorBrief({ clientId = null, business = '' }) {
  if (clientId) await assertExists('client', clientId, 'Client');
  const id = newId('door');
  const ts = nowIso();
  return runAction('UpdateDoorBriefField', {
    entityType: 'digital_door_brief', entityId: id, eventType: 'door_brief_created', payload: { clientId },
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO digital_door_brief (id, client_id, stage, business, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, clientId, 'outcome', business, ts, ts]
      );
      return id;
    },
  });
}

export async function UpdateDoorBriefField({ id, field, value }) {
  required(id, 'id');
  required(field, 'field');
  oneOf(field, DOOR_FIELDS, 'field');
  await assertExists('digital_door_brief', id, 'Digital Door brief');
  const column = DOOR_FIELD_COLUMN[field] || field;
  return runAction('UpdateDoorBriefField', {
    entityType: 'digital_door_brief', entityId: id, eventType: 'door_field_updated', payload: { field },
    mutate: async () => {
      await getDb().execute(
        `UPDATE digital_door_brief SET ${column} = $1, updated_at = $2 WHERE id = $3`,
        [value, nowIso(), id]
      );
      return id;
    },
  });
}

export async function AdvanceDoorStage({ id, toStage }) {
  required(id, 'id');
  oneOf(toStage, DOOR_STAGES, 'toStage');
  await assertExists('digital_door_brief', id, 'Digital Door brief');
  return runAction('AdvanceDoorStage', {
    entityType: 'digital_door_brief', entityId: id, eventType: 'door_stage_advanced', payload: { toStage },
    tierArgs: { toStage },
    title: toStage === 'complete' ? 'Launch this Digital Door brief' : `Advance Door brief to "${toStage}"`,
    detail: toStage === 'complete'
      ? 'This marks the brief handed off and complete — the launch-stage transition. This step is logged as its own approval event.'
      : 'This is an external/write action and will be logged.',
    mutate: async () => {
      await getDb().execute(
        'UPDATE digital_door_brief SET stage = $1, updated_at = $2 WHERE id = $3',
        [toStage, nowIso(), id]
      );
      return id;
    },
  });
}

// ---------------------------------------------------------------- Artifact

const ARTIFACT_TYPES = ['repo', 'branch', 'file', 'screenshot', 'live_url', 'digital_door', 'owner_key', 'proposal', 'audit_report'];

export async function CreateArtifact({ type, reference, relatedTaskId = null, relatedProjectId = null }) {
  oneOf(type, ARTIFACT_TYPES, 'type');
  required(reference, 'reference');
  if (relatedTaskId) await assertExists('task', relatedTaskId, 'Task');
  if (relatedProjectId) await assertExists('project', relatedProjectId, 'Project');
  const id = newId('artifact');
  return runAction('CreateArtifact', {
    entityType: 'artifact', entityId: id, eventType: 'artifact_created', payload: { type, reference },
    title: `Create ${type} artifact`,
    detail: reference,
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO artifact (id, type, reference, related_task_id, related_project_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, type, reference, relatedTaskId, relatedProjectId, nowIso()]
      );
      return id;
    },
  });
}

// ---------------------------------------------------------------- Handoff

const WORKERS = ['nev', 'chatgpt', 'claude', 'claude_code', 'claude_cowork'];
const HANDOFF_STATUSES = ['pending', 'in_progress', 'returned', 'accepted', 'rejected'];

export async function CreateHandoff({ fromWorker, toWorker, objective, context = '', constraints = '', inputs = '', outputs = '', acceptanceCriteria = '' }) {
  oneOf(fromWorker, WORKERS, 'fromWorker');
  oneOf(toWorker, WORKERS, 'toWorker');
  required(objective, 'objective');
  const id = newId('handoff');
  const ts = nowIso();
  return runAction('CreateHandoff', {
    entityType: 'handoff', entityId: id, eventType: 'handoff_created', payload: { fromWorker, toWorker, objective },
    title: `Hand off "${objective}" to ${toWorker}`,
    detail: `From ${fromWorker} to ${toWorker}.`,
    mutate: async () => {
      await getDb().execute(
        `INSERT INTO handoff (id, from_worker, to_worker, objective, context, constraints, inputs, outputs, acceptance_criteria, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, fromWorker, toWorker, objective, context, constraints, inputs, outputs, acceptanceCriteria, 'pending', ts, ts]
      );
      return id;
    },
  });
}

export async function UpdateHandoffStatus({ id, status }) {
  required(id, 'id');
  oneOf(status, ['pending', 'in_progress', 'returned'], 'status'); // terminal states go through ApproveChange/RejectChange
  await assertExists('handoff', id, 'Handoff');
  return runAction('UpdateHandoffStatus', {
    entityType: 'handoff', entityId: id, eventType: 'handoff_status_updated', payload: { status },
    title: `Move handoff to "${status}"`,
    mutate: async () => {
      await getDb().execute('UPDATE handoff SET status = $1, updated_at = $2 WHERE id = $3', [status, nowIso(), id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Audit (works via Handoff + Artifact)

export async function SubmitForAudit({ handoffId, note = '' }) {
  required(handoffId, 'handoffId');
  await assertExists('handoff', handoffId, 'Handoff');
  return runAction('SubmitForAudit', {
    entityType: 'handoff', entityId: handoffId, eventType: 'submitted_for_audit', payload: { note },
    title: 'Submit this handoff for audit',
    detail: note,
    mutate: async () => {
      await getDb().execute("UPDATE handoff SET status = 'returned', updated_at = $1 WHERE id = $2", [nowIso(), handoffId]);
      return handoffId;
    },
  });
}

export async function RecordAuditResult({ handoffId, verdict, notes = '' }) {
  required(handoffId, 'handoffId');
  oneOf(verdict, ['pass', 'fix_required'], 'verdict');
  await assertExists('handoff', handoffId, 'Handoff');
  const artifactId = newId('artifact');
  return runAction('RecordAuditResult', {
    entityType: 'handoff', entityId: handoffId, eventType: 'audit_result_recorded', payload: { verdict, notes },
    title: `Record audit result: ${verdict.toUpperCase()}`,
    detail: notes,
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO artifact (id, type, reference, related_task_id, related_project_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [artifactId, 'audit_report', `${verdict.toUpperCase()}: ${notes}`, null, null, nowIso()]
      );
      return { handoffId, artifactId };
    },
  });
}

// ---------------------------------------------------------------- Approve / Reject (Handoff terminal states)

export async function ApproveChange({ handoffId, note = '' }) {
  required(handoffId, 'handoffId');
  await assertExists('handoff', handoffId, 'Handoff');
  return runAction('ApproveChange', {
    entityType: 'handoff', entityId: handoffId, eventType: 'handoff_accepted', payload: { note },
    title: 'Approve this change',
    detail: note || 'This accepts the handoff and closes the review loop.',
    mutate: async () => {
      await getDb().execute("UPDATE handoff SET status = 'accepted', updated_at = $1 WHERE id = $2", [nowIso(), handoffId]);
      return handoffId;
    },
  });
}

export async function RejectChange({ handoffId, note = '' }) {
  required(handoffId, 'handoffId');
  await assertExists('handoff', handoffId, 'Handoff');
  return runAction('RejectChange', {
    entityType: 'handoff', entityId: handoffId, eventType: 'handoff_rejected', payload: { note },
    title: 'Reject this change',
    detail: note || 'This rejects the handoff and sends it back.',
    mutate: async () => {
      await getDb().execute("UPDATE handoff SET status = 'rejected', updated_at = $1 WHERE id = $2", [nowIso(), handoffId]);
      return handoffId;
    },
  });
}

// ---------------------------------------------------------------- Inbox

export async function CaptureInboxItem({ rawText }) {
  required(rawText, 'rawText');
  const id = newId('inbox');
  return runAction('CaptureInboxItem', {
    entityType: 'inbox_item', entityId: id, eventType: 'inbox_item_captured', payload: {},
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO inbox_item (id, raw_text, status, created_at) VALUES ($1,$2,$3,$4)',
        [id, rawText, 'untriaged', nowIso()]
      );
      return id;
    },
  });
}

export async function ConvertInboxItem({ id, toEntityType, clientId = null, projectId = null, title = null }) {
  required(id, 'id');
  oneOf(toEntityType, ['task', 'project', 'client'], 'toEntityType');
  const db = getDb();
  const rows = await db.select('SELECT * FROM inbox_item WHERE id = $1', [id]);
  if (!rows.length) throw new ValidationError(`Inbox item "${id}" does not exist`);
  const item = rows[0];

  return runAction('ConvertInboxItem', {
    entityType: 'inbox_item', entityId: id, eventType: 'inbox_item_converted', payload: { toEntityType },
    mutate: async () => {
      let newEntityId;
      if (toEntityType === 'task') {
        newEntityId = await CreateTask({ projectId, title: title || item.raw_text });
      } else if (toEntityType === 'project') {
        newEntityId = await CreateProject({ clientId, title: title || item.raw_text });
      } else {
        newEntityId = await CreateClient({ name: title || item.raw_text });
      }
      await db.execute(
        "UPDATE inbox_item SET status = 'converted', converted_to_entity_type = $1, converted_to_entity_id = $2 WHERE id = $3",
        [toEntityType, newEntityId, id]
      );
      return newEntityId;
    },
  });
}

export async function DismissInboxItem({ id }) {
  required(id, 'id');
  await assertExists('inbox_item', id, 'Inbox item');
  return runAction('DismissInboxItem', {
    entityType: 'inbox_item', entityId: id, eventType: 'inbox_item_dismissed', payload: {},
    mutate: async () => {
      await getDb().execute("UPDATE inbox_item SET status = 'dismissed' WHERE id = $1", [id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Legacy screens (pre-Phase-1)
// Inventory / Client Jobs / Runway / Watchtower / Money predate PHASE1-SPEC.md and are not part
// of it (Watchtower and Money are explicitly deferred, §11). They are preserved as working
// functionality but funneled through this one action so nothing bypasses the action layer.

export async function SaveLegacyState({ key, value }) {
  required(key, 'key');
  return runAction('SaveLegacyState', {
    entityType: 'legacy_state', entityId: key, eventType: 'legacy_state_saved', payload: { key },
    mutate: async () => {
      await getDb().execute(
        `INSERT INTO legacy_state (key, value, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), nowIso()]
      );
      return key;
    },
  });
}

export { DOOR_STAGES, DOOR_FIELDS, ARTIFACT_TYPES, WORKERS, HANDOFF_STATUSES };
