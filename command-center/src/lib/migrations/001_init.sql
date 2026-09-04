-- 001_init.sql
-- Core Phase 1 entity schema per docs/PHASE1-SPEC.md §3 and §6 (Migration Approach).
-- Additive only. Applied once, in order, tracked in schema_version (see src/lib/migrations.js).

CREATE TABLE IF NOT EXISTS client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_info TEXT,
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','active','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES client(id),
  title TEXT NOT NULL,
  type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES project(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date TEXT,
  created_at TEXT NOT NULL
);

-- stage enum: the 6 documented Digital Door Workflow stages (docs/DIGITAL-DOOR-WORKFLOW.md)
-- plus a 'complete' bookend for the launched/handed-off state. See docs/DECISIONS.md for the
-- note reconciling this against PHASE1-SPEC.md's "12 pipeline stages" wording.
CREATE TABLE IF NOT EXISTS digital_door_brief (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES client(id),
  stage TEXT NOT NULL DEFAULT 'outcome'
    CHECK (stage IN ('outcome','customer','paths','destinations','build','handoff','complete')),
  business TEXT,
  primary_goal TEXT,
  customer TEXT,
  urgent_need TEXT,
  customer_intent TEXT,
  tone TEXT,
  paths TEXT,
  destinations TEXT,
  deliverables TEXT,
  handoff TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'repo','branch','file','screenshot','live_url','digital_door','owner_key','proposal','audit_report'
  )),
  reference TEXT NOT NULL,
  related_task_id TEXT REFERENCES task(id),
  related_project_id TEXT REFERENCES project(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS handoff (
  id TEXT PRIMARY KEY,
  from_worker TEXT NOT NULL,
  to_worker TEXT NOT NULL,
  objective TEXT NOT NULL,
  context TEXT,
  constraints TEXT,
  inputs TEXT,
  outputs TEXT,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','returned','accepted','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_event (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('nev','chatgpt','claude','claude_code','system')),
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_record (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('automated','manual')),
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS inbox_item (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'untriaged' CHECK (status IN ('untriaged','converted','dismissed')),
  converted_to_entity_type TEXT,
  converted_to_entity_id TEXT,
  created_at TEXT NOT NULL
);

-- Holds the pre-existing, pre-Phase-1 screens (Inventory, Client Jobs, Runway, Watchtower, Money)
-- that predate this spec and are not part of it. Kept only so working functionality is not lost;
-- still only ever written through the SaveLegacyState action (src/lib/actions.js) so no code path
-- bypasses the action layer, per the Single-Writer Boundary (PHASE1-SPEC.md §2, §10).
CREATE TABLE IF NOT EXISTS legacy_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_client ON project(client_id);
CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_artifact_task ON artifact(related_task_id);
CREATE INDEX IF NOT EXISTS idx_artifact_project ON artifact(related_project_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_event(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_door_client ON digital_door_brief(client_id);
CREATE INDEX IF NOT EXISTS idx_handoff_status ON handoff(status);
