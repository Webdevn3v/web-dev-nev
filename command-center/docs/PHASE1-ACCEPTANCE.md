# Phase 1 Acceptance — Verification Report

Checked against `docs/PHASE1-SPEC.md` §10, `docs/PHASE1-CORRECTIVE-PATCH.md`'s acceptance
criteria, and the ChatGPT-audit fixes (atomic events, non-destructive restore, backup
completeness, migration robustness), in that order. Status legend:

- **VERIFIED** — checked directly in this environment: grep/read the actual code, ran it against
  a real SQLite engine, ran a real Vite build, or some combination.
- **BUILT, NOT RUNTIME-VERIFIED** — the code exists and was reviewed by inspection against
  documented APIs (and, where the logic is pure SQL/JS, tested against a real engine outside
  Tauri), but the actual Tauri/Stronghold/fs/dialog runtime path was not executed (see "Why some
  things couldn't run," below).
- **BLOCKED** — cannot be completed in this environment at all; exact remaining steps given.

This update session installed `better-sqlite3` (a real, native SQLite engine) into a scratch
directory purely for local testing — not a project dependency, not committed anywhere in
`command-center/`. Every migration file was actually executed against it, and every one of the 19
named actions' mutating SQL was simulated and asserted to produce the correct trigger-driven
`activity_event` row. This is real verification of the SQL/migration/trigger layer that last
session's report did not have. It still can't exercise `tauri-plugin-sql`'s specific connection
pooling, Stronghold, or the `fs`/`dialog` plugins — those need the actual Tauri runtime.

---

## PHASE1-SPEC.md §10

1. **All entities above exist in schema with migrations, version-tracked.**
   VERIFIED. `001_init.sql`–`006_activity_event_triggers.sql` (6 migrations, up from 2) create all
   9 §3 entities, `project.production_stage` (corrective patch), `artifact.related_handoff_id`,
   and the atomicity triggers. All 6 were run in order against a real SQLite engine
   (better-sqlite3) via the exact same `splitSqlStatements()` splitter `migrations.js` uses;
   `schema_version` reached 6 as expected. Not yet confirmed: running this inside the actual
   `tauri-plugin-sql` connection (needs a running Tauri app).

2. **No UI or code path mutates SQLite except through the named action layer.**
   VERIFIED by grep, re-run after this session's changes: `grep -rn "\.execute(" src` outside
   `actions.js`/`db.js`/`migrations.js` returns nothing.

3. **Every action in §4 is implemented, validated, and emits an ActivityEvent.**
   VERIFIED, and the "emits an ActivityEvent" half is now atomic (see the atomicity fix below,
   which is itself directly tested). All 19 named actions plus `AdvanceProductionStage`
   (corrective patch) exist in `actions.js`; a script cross-checked every exported action has a
   matching entry in `risk.js`'s tier table. Each of the 19 original actions' exact mutating SQL
   was executed against a real SQLite database and asserted to produce exactly one
   correctly-typed, correctly-linked `activity_event` row — CHECK-constraint rejection
   (`planning_step`, `production_stage`) and foreign-key rejection were also exercised and pass.
   BUILT, NOT RUNTIME-VERIFIED: the actual `tauri-plugin-sql` IPC round-trip (as opposed to the
   SQL itself) has not run.

4. **Approval tiers in §5 are enforced (external/write and high-impact require confirmation).**
   VERIFIED by code read: unchanged from last session's design, plus `AdvanceProductionStage` now
   follows the same dynamic-tier pattern as `AdvanceDoorStage` (external/write by default,
   high-impact + typed APPROVE only for the `launch` transition — corrective patch item 4).
   BUILT, NOT RUNTIME-VERIFIED: the confirm modal has never been clicked through in a real webview.

5. **Today and Business Health are computed views with no dedicated storage/duplication.**
   VERIFIED: `getTodayView()`/`getBusinessHealth()` are pure `SELECT`s; both were updated to read
   `planning_step` instead of the old `stage` column name and still contain no writes.

6. **Digital Door wizard uses distinct state keys per step (regression check).**
   VERIFIED, now on real SQLite too: `digital_door_brief.urgent_need`/`customer_intent` are
   separate columns (unchanged), and the rename to `planning_step` (corrective patch) was itself
   tested against a real engine — `ALTER TABLE ... RENAME COLUMN` was confirmed to correctly
   rewrite the table's CHECK constraint to the new column name and keep it enforced.

7. **Backup export → restore round-trip tested successfully once.**
   BLOCKED here, same as last session — no Tauri/Stronghold runtime in this sandbox. What changed:
   `src/lib/backup.js` was substantially rewritten to fix two real bugs the ChatGPT audit
   correctly flagged (see below) — non-destructive restore (validates a staging copy before
   touching any live file) and backup completeness (the exported `.tdsbackup` envelope now
   includes the Stronghold Argon2 salt, not just the vault snapshot, since the salt is
   machine-local material required to re-derive the same key from the same passphrase — verified
   against the plugin's Rust source, `kdf.rs`). **To actually satisfy this criterion:** on a real
   Windows/dev machine, `npm install && npm run tauri dev`, acknowledge the recovery-passphrase
   step, export a backup, wipe (or use a second machine for) the app's local data directory,
   restore from the exported `.tdsbackup` file, confirm the data is intact. Additionally worth
   testing there: restoring with a *wrong* passphrase or a *corrupted* file and confirming the
   live vault/db are genuinely untouched afterward (the specific bug this session fixed).

8. **Recovery key acknowledgment step exists and cannot be silently skipped.**
   VERIFIED, unchanged from last session: enforced both by the disabled Export button and inside
   `exportBackup()` itself.

9. **Activity Log displays real events from real actions, chronological, filterable.**
   VERIFIED, and now backed by real trigger-tested events rather than JS-constructed ones.
   `listActivityEvents()` is unchanged; every event it will ever display now comes from a
   `CREATE TRIGGER` fired atomically with its mutation (see atomicity fix below), not a second,
   separable `INSERT` from JS.

10. **App icons exist and a Windows installer builds successfully.**
    Unchanged from last session: icon set genuinely generated via `npx tauri icon` and
    `bundle.icon` added by hand; the actual Windows build remains BLOCKED here (no Rust toolchain,
    no Windows target). See last session's notes in `docs/DECISIONS.md` for detail.

11. **`.gitignore` and `package-lock.json` remain in place (verify not regressed).**
    VERIFIED: unchanged this session (no new dependencies were added — the corrective patch and
    audit fixes needed only new `.sql` files, new `.js` files, and two new `fs:*` permission
    strings, no new packages).

12. **No integration is shown as "connected" unless it is genuinely automated.**
    VERIFIED, unchanged.

## docs/PHASE1-CORRECTIVE-PATCH.md acceptance criteria

- **`digital_door_brief.planning_step` exists; old `stage` references are gone where they refer to
  this field.** VERIFIED: `003_rename_stage_to_planning_step.sql` renames the column;
  `grep -rn '\.stage\b' src` finds no remaining references to it as a digital-door-brief property
  (the `AdvanceDoorStage`/`DOOR_STAGES` *names* are unchanged, per the patch's explicit
  instruction not to rename those — only the column moved). `actions.js`, `queries.js`, and
  `screens/door.js` were all updated and re-tested.
- **`project.production_stage` exists with exactly 12 allowed values and defaults to `intake`.**
  VERIFIED against a real SQLite engine: `004_add_production_stage.sql` adds the column with a
  12-value CHECK constraint; an existing row backfilled to `intake` correctly; all 12 values were
  set in sequence and accepted; a 13th, invalid value was rejected with a CHECK-constraint error.
- **`AdvanceProductionStage` is validated, risk-tiered, and emits ActivityEvent.** VERIFIED:
  implemented in `actions.js` with `oneOf()`/`assertExists()` validation, tiered via `risk.js`,
  and its mutating statement fires `trg_production_stage_advanced`
  (`006_activity_event_triggers.sql`) — tested directly, including that a no-op "advance" to the
  already-current stage correctly logs nothing (the trigger's `WHEN NEW IS NOT OLD` guard).
- **`launch` requires HIGH_IMPACT typed APPROVE; other production transitions use EXTERNAL_WRITE
  confirmation.** VERIFIED by code read: `risk.js`'s `resolveTier()` returns `HIGH_IMPACT` only
  when `toStage === 'launch'`, matching the identical pattern already used and tested for
  `AdvanceDoorStage`'s `complete` transition. BUILT, NOT RUNTIME-VERIFIED: the confirm modal
  itself hasn't been clicked through.
- **Project detail shows current production stage and advance control.** VERIFIED by code read:
  `screens/clients.js`'s project detail view now shows `PRODUCTION: <STAGE>` and an
  "ADVANCE → <NEXT STAGE>" button per project (or "PRODUCTION COMPLETE" at `launch`); no new
  screen was added, per the patch's explicit "out of scope" list.
- **`npm run build` passes.** VERIFIED — ran clean after every change in this session, most
  recently after the corrective patch and all four audit fixes together (40 modules transformed).
- **`DECISIONS.md` and `DIGITAL-DOOR-WORKFLOW.md` updated.** VERIFIED — both updated; the old
  "12 vs 6" decision entry is struck through and annotated as resolved rather than deleted, so the
  history of what was actually wrong is still visible.
- **Existing planning flow behavior has no regression.** VERIFIED: the 6-step wizard, its field
  mapping, and the `urgentNeed`/`customerIntent` collision fix are all structurally unchanged —
  only the underlying column name moved, confirmed both by code read and by the real-engine
  `RENAME COLUMN` test above.

## ChatGPT-audit blockers

- **Atomic state mutation + required ActivityEvent logging.** VERIFIED, and this is the
  strongest-tested part of this session's work: every entity table now has `AFTER INSERT`/
  `AFTER UPDATE` triggers (`006_activity_event_triggers.sql`) that write the corresponding
  `activity_event` row as part of the same statement execution as the mutation — not a second,
  separately-failable JS call. All 19 actions' mutating SQL were run against a real SQLite engine
  and each was confirmed to produce exactly one correctly-typed, correctly-linked event; a
  redundant no-op call (re-completing an already-done task) was confirmed to log a relabeled event
  rather than either duplicating or silently vanishing. See `docs/DECISIONS.md` for why a literal
  JS-driven `BEGIN`/`COMMIT` sequence was rejected (verified against `tauri-plugin-sql` source that
  it can't guarantee connection affinity across calls) in favor of this DB-trigger design, which
  doesn't depend on that guarantee at all. BUILT, NOT RUNTIME-VERIFIED: the real
  `tauri-plugin-sql` IPC path (as opposed to the SQL/trigger logic itself) hasn't executed.
- **Non-destructive restore.** BUILT, NOT RUNTIME-VERIFIED (no Stronghold runtime here).
  `restoreBackup()` now parses and shape-checks the backup envelope, writes the imported vault to
  a *staging* path, and validates it there (open the vault, load the backup client, fetch the
  record, check it starts with the real SQLite file header) — the live vault and db are opened for
  writing only after all of that succeeds. On any failure, the one file that must be touched to
  even attempt decryption (the global Argon2 salt file, whose path is fixed at Rust app-startup —
  verified via source, not assumed) is reverted to its exact prior bytes, or removed if it didn't
  exist before. Reviewed line-by-line against the plugin's actual API surface; not executed.
- **Backup completeness (recovery-key salt).** BUILT, NOT RUNTIME-VERIFIED. Verified via the
  plugin's Rust source (`kdf.rs`) that the passphrase alone doesn't derive the encryption key — a
  per-machine Argon2 salt does, cached at a fixed path and auto-generated on first use. The
  exported `.tdsbackup` file is now a JSON envelope containing both the vault snapshot and that
  salt (both base64), not just the snapshot — the previous version would have been unrestorable on
  a fresh machine even with the exact right passphrase. This is the fix most in need of an actual
  fresh-machine restore test (item 7 above) once real Tauri tooling is available, since it's the
  one most directly about surviving a machine that no longer has anything cached locally.
- **Migrations transactional/robust, not the fragile semicolon splitter.** VERIFIED. The splitter
  (`src/lib/sqlSplit.js`) was rewritten as a quote/comment/`BEGIN`-`END`-depth-aware tokenizer and
  unit-tested against 11 cases including the exact original bug (semicolon inside a string),
  escaped quotes, line/block comments, multi-trigger files, and a false-positive check (a column
  literally named `beginning`). It was then exercised against every real migration file via
  better-sqlite3. On "transactional": literal cross-statement `BEGIN`/`COMMIT` was deliberately
  **not** implemented — verified against `tauri-plugin-sql` source that `execute()`/`select()`
  acquire a pooled connection per call, so a JS-driven multi-call transaction can't be guaranteed
  atomic and would be false confidence. Robustness instead comes from every `CREATE` being
  `IF NOT EXISTS`, every seed `INSERT` being `OR IGNORE`, and `schema_version` only recording a
  migration as applied after every one of its statements succeeds — so a partial failure is
  retried in full, safely, on next launch. This is documented in `docs/DECISIONS.md` as a
  deliberate, honest choice over a literal transaction this environment's plugin can't safely
  provide from JS.

---

## Why some things couldn't run here

Same sandbox constraint as last session: **no Rust/Cargo toolchain, no webkit2gtk/gtk3, no
Windows target** (`rustc`/`cargo`/`pkg-config` all absent, checked directly). `cargo check`,
`tauri dev`, and `tauri build` cannot run here.

New this session: `better-sqlite3` was installed into a scratch directory (not the project) to get
a real SQLite engine for testing. This meaningfully raised the verification bar for anything that
lives in `.sql` files or in `db.execute()`/`db.select()` call arguments — migrations, triggers,
CHECK constraints, foreign keys, and the exact mutating statement each action runs were all
actually executed and asserted against, not just read. It does not touch, and can't substitute
for, anything that only exists inside the real Tauri runtime: `tauri-plugin-sql`'s IPC path and
connection pooling specifically, `tauri-plugin-stronghold`'s vault encryption, or the `fs`/`dialog`
plugins used by backup/restore.

What genuinely remains, requiring a real Windows/Tauri dev environment:
- The backup/restore round trip (§10 criterion 7) — now with an extra scenario worth testing
  specifically because of this session's fix: restoring with a wrong passphrase or a corrupted
  file, and confirming the live vault/db are untouched.
- The Windows-installer half of §10 criterion 10.
- A first real `npm run tauri dev` pass to catch anything a real-engine-but-not-Tauri test can't:
  whether `PRAGMA foreign_keys = ON` actually holds across `tauri-plugin-sql`'s connection pool
  the way `src/lib/db.js` assumes (the JS-side `assertExists` checks in `actions.js` remain a
  deliberate backstop for exactly this uncertainty), and whether the confirm-gate modal and the
  full Backup/Restore UI flow behave as designed when actually clicked through.
