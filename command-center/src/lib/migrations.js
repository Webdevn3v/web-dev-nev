// Versioned SQL migration runner. PHASE1-SPEC.md §6: numbered SQL files, applied in order,
// tracked in a schema_version table. No manual schema edits outside a migration file.
//
// Migrations live as literal numbered .sql files in ./migrations and are pulled in as raw text
// by Vite (`?raw`). Each is split into individual statements (via the quote/comment/BEGIN-END
// aware splitter in sqlSplit.js — see docs/DECISIONS.md for why a plain `.split(';')` isn't safe)
// and executed in order inside its own version row so a fresh install and an upgrade both
// converge on the same schema.
//
// Robustness note: this does NOT wrap a migration's statements in an explicit BEGIN/COMMIT.
// tauri-plugin-sql's execute()/select() acquire a connection from its pool per call (verified
// against the plugin's source), so a JS-driven multi-call transaction isn't reliably atomic —
// a COMMIT could land on a different physical connection than the BEGIN. Instead, robustness
// comes from every statement being idempotent (CREATE TABLE/INDEX IF NOT EXISTS, INSERT OR
// IGNORE for seed data) and from only recording a migration as applied in schema_version *after*
// every one of its statements succeeds — so a migration that fails partway through is retried in
// full on next launch, and the already-applied statements are safely skipped rather than erroring.

import m001 from './migrations/001_init.sql?raw';
import m002 from './migrations/002_seed_integrations.sql?raw';
import m003 from './migrations/003_rename_stage_to_planning_step.sql?raw';
import m004 from './migrations/004_add_production_stage.sql?raw';
import m005 from './migrations/005_artifact_handoff_link.sql?raw';
import m006 from './migrations/006_activity_event_triggers.sql?raw';
import { splitSqlStatements } from './sqlSplit.js';

const MIGRATIONS = [
  { version: 1, description: 'init: core Phase 1 entity schema', sql: m001 },
  { version: 2, description: 'seed: honest starting integrations registry', sql: m002 },
  { version: 3, description: 'corrective patch: rename digital_door_brief.stage to planning_step', sql: m003 },
  { version: 4, description: 'corrective patch: add project.production_stage (12-stage pipeline)', sql: m004 },
  { version: 5, description: 'link artifact to handoff for audit-result events', sql: m005 },
  { version: 6, description: 'atomic activity_event triggers per entity mutation', sql: m006 },
];

export async function runMigrations(db) {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`
  );

  const rows = await db.select('SELECT COALESCE(MAX(version), 0) as current FROM schema_version');
  const current = rows[0]?.current ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    for (const statement of splitSqlStatements(migration.sql)) {
      await db.execute(statement);
    }
    await db.execute(
      'INSERT INTO schema_version (version, description, applied_at) VALUES ($1, $2, $3)',
      [migration.version, migration.description, new Date().toISOString()]
    );
  }

  return { appliedFrom: current, appliedTo: pending.length ? pending[pending.length - 1].version : current };
}
