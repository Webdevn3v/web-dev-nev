-- 006_activity_event_triggers.sql
-- Fixes the ChatGPT-audit blocker: "make each state mutation + required ActivityEvent logging
-- atomic so state cannot change without its audit event." The previous design had actions.js
-- run the mutating statement, then a separate INSERT into activity_event as a second, independent
-- statement/round-trip — if the app crashed or the second call failed in between, a real state
-- change could exist with no audit trail entry at all.
--
-- These triggers make the event write part of the SAME statement execution as the mutation
-- itself (a single SQL statement, including any trigger it fires, is one atomic unit in SQLite —
-- this holds regardless of tauri-plugin-sql's connection pooling, which is what ruled out a
-- JS-driven BEGIN/mutate/INSERT-event/COMMIT sequence: verified against the plugin's source that
-- execute()/select() acquire a pooled connection per call, so multi-call transactions spanning
-- separate execute() calls are not reliably atomic — see docs/DECISIONS.md).
--
-- Payloads here are plain descriptive text, not JSON — nothing in this app parses
-- activity_event.payload as structured data, and depending on the SQLite build's JSON1
-- extension being compiled in (unverifiable without a live build here) was an avoidable risk.
-- actor is hardcoded 'nev': Phase 1 has no other caller of the action layer (§1/§2).
--
-- One exception stays outside these triggers: the high-impact 'approval_granted' event (emitted
-- by actions.js *before* the mutating statement runs, since it records the approval step itself,
-- not a row change) and CaptureInboxItem/CreateHandoff-style ordinary creations, which the
-- INSERT triggers below already cover.

-- ---------------------------------------------------------------- client
CREATE TRIGGER trg_client_created AFTER INSERT ON client BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'client_created', 'client', NEW.id, 'nev',
    'name=' || NEW.name || ' status=' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_client_updated AFTER UPDATE ON client BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'client_updated', 'client', NEW.id, 'nev',
    'status=' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- project
CREATE TRIGGER trg_project_created AFTER INSERT ON project BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'project_created', 'project', NEW.id, 'nev',
    'title=' || NEW.title, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_project_status_updated AFTER UPDATE OF status ON project
WHEN NEW.status IS NOT OLD.status BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'project_status_updated', 'project', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_production_stage_advanced AFTER UPDATE OF production_stage ON project
WHEN NEW.production_stage IS NOT OLD.production_stage BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'production_stage_advanced', 'project', NEW.id, 'nev',
    'stage=' || OLD.production_stage || '->' || NEW.production_stage, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- task
CREATE TRIGGER trg_task_created AFTER INSERT ON task BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'task_created', 'task', NEW.id, 'nev',
    'title=' || NEW.title, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_task_completed AFTER UPDATE OF status ON task
WHEN NEW.status = 'done' AND OLD.status IS NOT 'done' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'task_completed', 'task', NEW.id, 'nev',
    'title=' || NEW.title, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_task_updated AFTER UPDATE ON task
WHEN NOT (NEW.status = 'done' AND OLD.status IS NOT 'done') BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'task_updated', 'task', NEW.id, 'nev',
    'status=' || NEW.status || ' priority=' || NEW.priority, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- digital_door_brief
CREATE TRIGGER trg_door_brief_created AFTER INSERT ON digital_door_brief BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'door_brief_created', 'digital_door_brief', NEW.id, 'nev',
    'business=' || COALESCE(NEW.business, ''), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_door_stage_advanced AFTER UPDATE OF planning_step ON digital_door_brief
WHEN NEW.planning_step IS NOT OLD.planning_step BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'door_stage_advanced', 'digital_door_brief', NEW.id, 'nev',
    'step=' || OLD.planning_step || '->' || NEW.planning_step, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_door_field_updated AFTER UPDATE ON digital_door_brief
WHEN NEW.planning_step IS OLD.planning_step BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'door_field_updated', 'digital_door_brief', NEW.id, 'nev',
    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- artifact
CREATE TRIGGER trg_artifact_created AFTER INSERT ON artifact
WHEN NEW.type IS NOT 'audit_report' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'artifact_created', 'artifact', NEW.id, 'nev',
    'type=' || NEW.type || ' ref=' || NEW.reference, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_audit_result_recorded AFTER INSERT ON artifact
WHEN NEW.type IS 'audit_report' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'audit_result_recorded', 'handoff',
    COALESCE(NEW.related_handoff_id, NEW.id), 'nev', NEW.reference, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- handoff
CREATE TRIGGER trg_handoff_created AFTER INSERT ON handoff BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_created', 'handoff', NEW.id, 'nev',
    'objective=' || NEW.objective, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_handoff_pending AFTER UPDATE OF status ON handoff
WHEN NEW.status = 'pending' AND OLD.status IS NOT 'pending' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_status_updated', 'handoff', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_handoff_in_progress AFTER UPDATE OF status ON handoff
WHEN NEW.status = 'in_progress' AND OLD.status IS NOT 'in_progress' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_status_updated', 'handoff', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_handoff_returned AFTER UPDATE OF status ON handoff
WHEN NEW.status = 'returned' AND OLD.status IS NOT 'returned' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_returned', 'handoff', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_handoff_accepted AFTER UPDATE OF status ON handoff
WHEN NEW.status = 'accepted' AND OLD.status IS NOT 'accepted' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_accepted', 'handoff', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_handoff_rejected AFTER UPDATE OF status ON handoff
WHEN NEW.status = 'rejected' AND OLD.status IS NOT 'rejected' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'handoff_rejected', 'handoff', NEW.id, 'nev',
    'status=' || OLD.status || '->' || NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- inbox_item
CREATE TRIGGER trg_inbox_captured AFTER INSERT ON inbox_item BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'inbox_item_captured', 'inbox_item', NEW.id, 'nev',
    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_inbox_converted AFTER UPDATE OF status ON inbox_item
WHEN NEW.status = 'converted' AND OLD.status IS NOT 'converted' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'inbox_item_converted', 'inbox_item', NEW.id, 'nev',
    'to=' || COALESCE(NEW.converted_to_entity_type, '?'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_inbox_dismissed AFTER UPDATE OF status ON inbox_item
WHEN NEW.status = 'dismissed' AND OLD.status IS NOT 'dismissed' BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'inbox_item_dismissed', 'inbox_item', NEW.id, 'nev',
    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ---------------------------------------------------------------- legacy_state
CREATE TRIGGER trg_legacy_saved_insert AFTER INSERT ON legacy_state BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'legacy_state_saved', 'legacy_state', NEW.key, 'nev',
    'key=' || NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER trg_legacy_saved_update AFTER UPDATE ON legacy_state BEGIN
  INSERT INTO activity_event (id, event_type, related_entity_type, related_entity_id, actor, payload, created_at)
  VALUES ('evt-' || lower(hex(randomblob(16))), 'legacy_state_saved', 'legacy_state', NEW.key, 'nev',
    'key=' || NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
