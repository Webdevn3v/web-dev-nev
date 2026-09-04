// The Action Layer — PHASE1-SPEC.md §4.
//
// This is the ONLY place SQLite is written to for the core entities. Regular UI calls these
// functions directly today; later, Jarvis calls the exact same functions after interpreting
// natural language — no separate mutation path is ever built for it (§1, §2).
//
// Every action: (1) validates input, (2) performs the mutation via getDb(), (3) has an
// ActivityEvent recorded. Step 3 is no longer a second JS-driven `emitEvent()` call after the
// mutation — the ChatGPT-audit fix for "atomic mutation + event" moved that into SQL triggers
// (src/lib/migrations/006_activity_event_triggers.sql), so the event is written by the SAME
// statement execution as the mutation itself and can't go missing independently. See
// docs/DECISIONS.md for why (tauri-plugin-sql's execute()/select() acquire a pooled connection
// per call, which ruled out a JS-driven BEGIN/mutate/insert-event/COMMIT sequence). Every mutating
// statement below is exactly one `db.execute()` call for this reason — an action that issued
// several separate UPDATEs would let its trigger fire multiple times for one logical action.
//
// The one event still emitted directly from JS is 'approval_granted' for high-impact actions: it
// records the approval step itself, which has no corresponding row mutation to hang a trigger on.
//
// Risk-tiered actions (external/write, high-impact) gate on confirmGate() first — see
// src/lib/risk.js for the tier table and src/lib/confirm.js for the UI gate.

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

async function emitApprovalGranted(actionName, entityType, entityId) {
  await getDb().execute(
    `INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('evt'), 'approval_granted', entityType ?? null, entityId ?? null, 'nev', `action=${actionName}`, nowIso()]
  );
}

// Runs one named action end-to-end: risk gate -> single mutating statement. The mutating
// statement's own trigger records the ActivityEvent atomically (see file header) — this wrapper
// no longer writes one itself.
async function runAction(actionName, { title, detail, entityType, entityId, tierArgs, mutate }) {
  const tier = resolveTier(actionName, tierArgs);
  if (requiresConfirmation(tier)) {
    const approved = await confirmGate({ tier, title, detail });
    if (!approved) throw new ActionDeclinedError(actionName);
    if (tier === TIER.HIGH_IMPACT) {
      await emitApprovalGranted(actionName, entityType, entityId);
    }
  }
  return mutate();
}

// ---------------------------------------------------------------- Client

export async function CreateClient({ name, contactInfo = '', status = 'prospect' }) {
  required(name, 'name');
  oneOf(status, ['prospect', 'active', 'archived'], 'status');
  const id = newId('client');
  return runAction('CreateClient', {
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
    mutate: async () => {
      // One statement, not one per changed field: a partial-update loop here would let the
      // client_updated trigger fire more than once for a single logical UpdateClient call.
      await getDb().execute(
        `UPDATE client SET
           name = COALESCE($1, name),
           contact_info = COALESCE($2, contact_info),
           status = COALESCE($3, status)
         WHERE id = $4`,
        [name ?? null, contactInfo ?? null, status ?? null, id]
      );
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
    mutate: async () => {
      await getDb().execute('UPDATE project SET status = $1 WHERE id = $2', [status, id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Production pipeline (Project)
// Corrective patch (docs/PHASE1-CORRECTIVE-PATCH.md): independent of the Digital Door planning
// flow below. 12-stage client-delivery pipeline lives on Project.production_stage.

const PRODUCTION_STAGES = [
  'intake', 'brand_understanding', 'assets', 'digital_door', 'customer_paths',
  'mobile_optimization', 'full_site_handoff', 'owner_digital_key', 'qa_audit',
  'client_approval', 'launch', 'support_cleanup',
];

export async function AdvanceProductionStage({ id, toStage }) {
  required(id, 'id');
  oneOf(toStage, PRODUCTION_STAGES, 'toStage');
  await assertExists('project', id, 'Project');
  return runAction('AdvanceProductionStage', {
    entityType: 'project', entityId: id,
    tierArgs: { toStage },
    title: toStage === 'launch' ? 'Launch this project' : `Advance production stage to "${toStage}"`,
    detail: toStage === 'launch'
      ? 'This marks the project launched — a high-impact, live-client-asset transition. Logged as its own approval event.'
      : 'This is an external/write action and will be logged.',
    mutate: async () => {
      await getDb().execute('UPDATE project SET production_stage = $1 WHERE id = $2', [toStage, id]);
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
    mutate: async () => {
      await getDb().execute(
        `UPDATE task SET
           title = COALESCE($1, title),
           status = COALESCE($2, status),
           priority = COALESCE($3, priority),
           due_date = COALESCE($4, due_date)
         WHERE id = $5`,
        [title ?? null, status ?? null, priority ?? null, dueDate ?? null, id]
      );
      return id;
    },
  });
}

export async function CompleteTask({ id }) {
  required(id, 'id');
  await assertExists('task', id, 'Task');
  return runAction('CompleteTask', {
    mutate: async () => {
      await getDb().execute("UPDATE task SET status = 'done' WHERE id = $1", [id]);
      return id;
    },
  });
}

// ---------------------------------------------------------------- Digital Door planning flow
// Corrective patch: this is the planning dimension only (independent of production_stage above).
// Column is digital_door_brief.planning_step (renamed from `stage` by migration 003 — see
// docs/DECISIONS.md). Action names/behavior are unchanged, only the underlying column moved.

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
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO digital_door_brief (id, client_id, planning_step, business, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
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
    entityType: 'digital_door_brief', entityId: id,
    tierArgs: { toStage },
    title: toStage === 'complete' ? 'Launch this Digital Door brief' : `Advance Door brief to "${toStage}"`,
    detail: toStage === 'complete'
      ? 'This marks the brief handed off and complete — the launch-stage transition. This step is logged as its own approval event.'
      : 'This is an external/write action and will be logged.',
    mutate: async () => {
      await getDb().execute(
        'UPDATE digital_door_brief SET planning_step = $1, updated_at = $2 WHERE id = $3',
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
    title: `Record audit result: ${verdict.toUpperCase()}`,
    detail: notes,
    mutate: async () => {
      await getDb().execute(
        'INSERT INTO artifact (id, type, reference, related_task_id, related_project_id, related_handoff_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [artifactId, 'audit_report', `${verdict.toUpperCase()}: ${notes}`, null, null, handoffId, nowIso()]
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
    entityType: 'handoff', entityId: handoffId,
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
    entityType: 'handoff', entityId: handoffId,
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
    mutate: async () => {
      // Each nested Create* call is its own single-statement action with its own trigger-backed
      // event; the inbox_item UPDATE below is a separate one. Two real state changes happen here
      // (a new entity created, this inbox item marked converted), so two events is correct.
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

export { DOOR_STAGES, DOOR_FIELDS, ARTIFACT_TYPES, WORKERS, HANDOFF_STATUSES, PRODUCTION_STAGES };
