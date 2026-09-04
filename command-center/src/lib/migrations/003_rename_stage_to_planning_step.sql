-- 003_rename_stage_to_planning_step.sql
-- Corrective patch (docs/PHASE1-CORRECTIVE-PATCH.md): "planning step" and "production stage" are
-- two independent dimensions. This migration renames the existing 6-step Digital Door planning
-- flow's column so it can no longer be confused with the new project.production_stage added in
-- 004. Additive/renaming only — 001_init.sql is untouched, per the patch's instruction not to
-- edit it. Verified against a real SQLite engine (better-sqlite3) that RENAME COLUMN correctly
-- rewrites the table's CHECK constraint to reference the new column name and that the constraint
-- stays enforced afterward.
ALTER TABLE digital_door_brief RENAME COLUMN stage TO planning_step;
