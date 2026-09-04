-- 004_add_production_stage.sql
-- Corrective patch (docs/PHASE1-CORRECTIVE-PATCH.md): the 12-stage client-delivery production
-- pipeline lives on Project, independent of the Digital Door planning_step column (003). Existing
-- rows backfill to 'intake' via the column default. Verified against a real SQLite engine that
-- ADD COLUMN with NOT NULL DEFAULT and a CHECK constraint in one statement both backfills
-- existing rows and stays enforced on later writes.
ALTER TABLE project ADD COLUMN production_stage TEXT NOT NULL DEFAULT 'intake' CHECK (production_stage IN (
  'intake',
  'brand_understanding',
  'assets',
  'digital_door',
  'customer_paths',
  'mobile_optimization',
  'full_site_handoff',
  'owner_digital_key',
  'qa_audit',
  'client_approval',
  'launch',
  'support_cleanup'
));

CREATE INDEX IF NOT EXISTS idx_project_production_stage ON project(production_stage);
