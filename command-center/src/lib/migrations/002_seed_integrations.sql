-- 002_seed_integrations.sql
-- Seeds the Integrations registry (PHASE1-SPEC.md §9.9) with an honest starting state.
-- Nothing here is marked 'connected' unless it is genuinely automated right now (§10 acceptance
-- criterion). Everything external stays 'planned'/'manual' until real wiring exists — see
-- docs/DECISIONS.md "Deferred from Phase 1".
--
-- OR IGNORE: makes this statement idempotent so a retry (if a later statement in the same
-- migration run ever failed and this migration re-ran from the top) doesn't error on the
-- already-seeded rows' primary keys. See docs/DECISIONS.md, "Migration robustness."

INSERT OR IGNORE INTO integration_record (id, service_name, connection_type, status, notes)
VALUES
  ('int-local-db', 'Local SQLite', 'automated', 'connected',
   'Primary Command Center storage via tauri-plugin-sql. Fully local, no network.'),
  ('int-stronghold', 'Stronghold Vault', 'automated', 'connected',
   'Local encrypted secret/backup store via tauri-plugin-stronghold. No secrets stored yet in Phase 1.'),
  ('int-github', 'GitHub', 'manual', 'planned',
   'Repo links are stored as plain text on Client/Project records. No live API call exists yet.'),
  ('int-claude', 'Claude', 'manual', 'planned',
   'No API key wired into the app. Claude work happens outside the Command Center in Phase 1.'),
  ('int-claude-code', 'Claude Code', 'manual', 'planned',
   'Builds/edits source code directly, does not call into the app or its database.'),
  ('int-chatgpt', 'ChatGPT', 'manual', 'planned',
   'No API key wired into the app in Phase 1.'),
  ('int-watchtower', 'Watchtower monitoring', 'manual', 'planned',
   'Explicitly deferred to a later phase per PHASE1-SPEC.md §11.'),
  ('int-spaceship', 'Spaceship (domains)', 'manual', 'planned', 'Not wired in Phase 1.'),
  ('int-gmail', 'Gmail / Calendar', 'manual', 'planned', 'Not wired in Phase 1.'),
  ('int-stripe', 'Stripe / banking', 'manual', 'planned', 'Not wired in Phase 1.');
