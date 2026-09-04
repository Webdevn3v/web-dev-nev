// Versioned SQL migration runner. PHASE1-SPEC.md §6: numbered SQL files, applied in order,
// tracked in a schema_version table. No manual schema edits outside a migration file.
//
// Migrations live as literal numbered .sql files in ./migrations and are pulled in as raw text
// by Vite (`?raw`). Each is split into individual statements and executed in order inside its
// own version row so a fresh install and an upgrade both converge on the same schema.

import m001 from './migrations/001_init.sql?raw';
import m002 from './migrations/002_seed_integrations.sql?raw';

const MIGRATIONS = [
  { version: 1, description: 'init: core Phase 1 entity schema', sql: m001 },
  { version: 2, description: 'seed: honest starting integrations registry', sql: m002 },
];

// Splits on top-level ';' — migration files must not contain a literal ';' inside a string
// value (e.g. in a seeded note), since this splitter has no SQL string-literal awareness.
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

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
    for (const statement of splitStatements(migration.sql)) {
      await db.execute(statement);
    }
    await db.execute(
      'INSERT INTO schema_version (version, description, applied_at) VALUES ($1, $2, $3)',
      [migration.version, migration.description, new Date().toISOString()]
    );
  }

  return { appliedFrom: current, appliedTo: pending.length ? pending[pending.length - 1].version : current };
}
