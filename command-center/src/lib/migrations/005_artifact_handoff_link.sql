-- 005_artifact_handoff_link.sql
-- RecordAuditResult (actions.js) creates an audit_report Artifact about a Handoff being audited,
-- but Artifact previously had no way to link back to the Handoff it concerns (only to a Task or
-- Project). This closes that gap so the atomic per-mutation ActivityEvent trigger added in 006
-- can link the audit event to the handoff being audited via NEW.related_handoff_id, instead of
-- losing that link. Verified against a real SQLite engine that ADD COLUMN with a nullable FK
-- reference enforces the constraint correctly on subsequent writes.
ALTER TABLE artifact ADD COLUMN related_handoff_id TEXT REFERENCES handoff(id);
CREATE INDEX IF NOT EXISTS idx_artifact_handoff ON artifact(related_handoff_id);
