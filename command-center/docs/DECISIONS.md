# Command Center Decision Log

## 2026-09-03 — Local-first desktop architecture

**Decision:** The Command Center is a local Windows desktop application, not a hosted business dashboard.

**Why:** Business state should remain primarily on Nev's laptop. Cloud services are integrations the app calls when needed, not the place where the Command Center itself lives.

## 2026-09-03 — Tauri 2 foundation

**Decision:** Use Tauri 2 for the desktop shell.

**Why:** It provides a native desktop container with a small footprint and a clear native permission boundary while allowing reuse of existing web UI skills.

## 2026-09-03 — SQLite for primary application state

**Decision:** Replace prototype/browser storage with a local SQLite database.

**Why:** Client/project/business state needs durable structured persistence that does not disappear when browser storage is cleared.

## 2026-09-03 — Secrets stay outside renderer code

**Decision:** Scaffold Stronghold/native secret storage. Do not put API keys in frontend JavaScript.

**Why:** Claude, OpenAI, Stripe, Spaceship and other credentials must eventually cross a protected native boundary.

## 2026-09-03 — One AI Desk, multiple brains

**Decision:** The eventual user experience is one TDS AI Router rather than separate permanent Ask-Claude / Ask-ChatGPT interfaces.

**Why:** Nev should ask for an outcome; Command Center should decide which model/tool is appropriate.

## 2026-09-03 — Explicit computer permissions

**Decision:** Future local automation is capability-based. Routine approved TDS reads/writes may be allowed; deletion, publishing, DNS, sending email, money movement and account changes require confirmation.

## 2026-09-03 — Digital Door Workflow is a core product workflow

**Decision:** Door planning is built into Command Center as a guided mission: Outcome → Customer → Paths → Destinations → Build → Handoff.

**Why:** The system should help Nev translate a client's messy goal into an actionable Digital Door brief without requiring her to hold the entire design process in her head.

## 2026-09-04 — Phase 1 build decisions

Built against `docs/PHASE1-SPEC.md` (approved build contract). Several judgment calls were
required where the spec was silent, ambiguous, or where this sandbox's tooling limits forced a
choice. Recorded here rather than made silently.

**Migrations run from JS, not `tauri-plugin-sql`'s built-in `add_migrations`.**
Verified against the plugin's source (`plugins-workspace/v2/plugins/sql`) that its migration
tracking is delegated to `sqlx`'s internal migrator, whose tracking-table name/schema isn't
documented by the plugin itself. §6 explicitly locks the wording "tracked in a schema_version
table," so `src/lib/migrations.js` implements its own runner: numbered `.sql` files under
`src/lib/migrations/`, pulled in via Vite `?raw` imports, executed statement-by-statement, with
an explicit `schema_version(version, description, applied_at)` table. This also avoids relying on
Rust-side plugin wiring that could not be compile-checked in the build environment (no Rust
toolchain — see "Environment limits" below). One real bug this caught: the naive `;`-based
statement splitter breaks if a seeded string value contains a literal semicolon — found and fixed
in `002_seed_integrations.sql` (a note originally read "...directly; does not call..."). Anyone
adding a migration must avoid `;` inside string values, or the splitter needs to become
string-literal-aware.

**RESOLVED by approved corrective patch (2026-09-04, `docs/PHASE1-CORRECTIVE-PATCH.md`) — see the
"Corrective patch" section below.** The paragraph immediately below is kept for the record of what
was actually wrong with the original build, not as current guidance.

~~Digital Door stage count: spec says "12 pipeline stages," the built workflow has 6.~~
§3's DigitalDoorBrief row says `stage (enum matching the 12 pipeline stages)`, but the only
stage sequence that exists anywhere in this repo is the 6-step Outcome → Customer → Paths →
Destinations → Build → Handoff sequence in `docs/DIGITAL-DOOR-WORKFLOW.md`, and §9.4 explicitly
says to "bring [the workflow] that's already partly built into this schema." Treated the "12" as
inaccurate wording rather than a hidden requirement to invent 6 more stages with no source of
truth for what they'd be. `digital_door_brief.stage` is a 7-value enum: the 6 documented stages
plus a `complete` bookend for the launched/handed-off state. Flagged for Nev to confirm — if a
real 12-stage list exists elsewhere, the schema/action layer will need a follow-up migration.

**This turned out to be wrong** — there is a real, independent 12-stage production pipeline; see
below for how it was corrected.

**Pre-Phase-1 screens (Inventory, Client Jobs, Runway, Watchtower, Money) preserved, not rebuilt.**
None of these are in §9's Phase 1 screen list; Watchtower and Money are explicitly deferred by
§11. Per the instruction to preserve existing working functionality without expanding scope,
their UI and data shape are unchanged, but persistence now goes through one new action,
`SaveLegacyState` (`src/lib/actions.js`), into a new `legacy_state` KV table — instead of the old
ad-hoc `app_state` table written to directly from the UI — so every code path still goes through
the action layer (§2, §10's "no code path bypasses the action layer" criterion). The old Today
screen (business missions + quick stats) and the old ad-hoc Clients list are gone — they're
superseded by the two Phase 1 screens the spec explicitly asks for (Today, Clients+Projects), not
kept in parallel. The "Active Missions" cards moved onto the legacy Runway screen since Today's
slot is now the spec-defined derived view. The old static "systems" chip strip (top bar) now
reads live from `integration_record` instead of a separate hand-maintained list, so there's one
honest source of truth instead of two that could drift apart.

**Backup export/restore, two new native plugins.**
§7 requires a real, exit-the-laptop backup/restore round trip. Reading/writing an arbitrary file
the user picks (a save/open dialog) isn't possible with `core`/`sql`/`stronghold` permissions
alone, so `tauri-plugin-fs` and `tauri-plugin-dialog` were added (both official Tauri plugins).
Capability grants are scoped narrowly — `fs:scope-appconfig` / `fs:scope-applocaldata` (to read
the live db file and the vault) plus `fs:scope-desktop-recursive` / `-document-` / `-download-`
(realistic places to save/restore a backup) — not a blanket filesystem grant, consistent with
`docs/CLAUDE-AUDIT.md`'s "no broad filesystem/admin permissions" constraint. A backup saved to an
arbitrary external-drive mount point outside those three folders will currently fail with a scope
error; broadening this (or copying via an intermediate Documents-scoped step) is a Phase 2 call
if that turns out to matter in practice.

Encryption design: rather than add a new crypto dependency, the live SQLite file's raw bytes are
stored as a record in the Stronghold vault's `Store` (confirmed against
`plugins-workspace/v2/plugins/stronghold/guest-js/index.ts`) before the vault snapshot is saved.
The recovery passphrase is never stored by the app; §7's "cannot be silently skipped"
acknowledgment gate lives on the new Backup screen, and is enforced a second time inside
`exportBackup()` itself, not just as a disabled button, so re-enabling the button via devtools
can't bypass it.

**Corrective patch (2026-09-04) — backup completeness and non-destructive restore.** Ferried by
ChatGPT's audit, two real bugs were found and fixed in this design:

1. *Missing recovery-key material.* Verified against the plugin's Rust source (`kdf.rs`) that the
   passphrase alone doesn't derive the Stronghold encryption key — it's combined with a random
   salt cached once per machine at a *fixed* path (`with_argon2`'s `salt_path`,
   `app_local_data_dir()/stronghold-salt.txt`), generated automatically the first time anything
   touches the vault. An export that only contained the vault snapshot would be **unrestorable on
   a fresh machine even with the correct passphrase**, since the fresh machine would silently
   generate a different salt. Fixed by changing the exported artifact from a raw `.stronghold`
   file to a small JSON envelope (`{format, version, timestamp, saltBase64, vaultBase64}`,
   extension `.tdsbackup`) that bundles the salt alongside the vault snapshot. No new crypto
   dependency — both are just base64-encoded bytes.
2. *Destructive restore.* The original `restoreBackup()` wrote the imported file straight over the
   live vault, then *tried* to decrypt it — a wrong passphrase or a corrupt/unrelated file would
   already have overwritten the live vault by the time that failure was detected. Fixed: restore
   now decodes the envelope, writes the imported vault to a **staging** path
   (`.restore-staging.stronghold`, same app-local-data directory, no new fs scope needed), and
   validates it there (`loadClient` + `store.get` + a raw SQLite-file-header check on the payload)
   before touching anything live. Only on success are the live vault and db files overwritten (the
   live sqlite connection is closed first). On any failure, the live vault and db are never opened
   for writing. The one unavoidable exception is the salt file itself: since the Argon2 salt path
   is fixed globally at Rust app-startup (not something a JS `Stronghold.load()` call can point
   elsewhere per invocation), attempting decryption at all requires temporarily writing the
   imported salt to that real path. This is saved beforehand and reverted byte-for-byte (or
   removed, if no salt file existed yet) if validation fails, so it's fully undone on any failure
   path — see `src/lib/backup.js` for the exact revert logic. Added `fs:allow-exists` and
   `fs:allow-remove` to the capability set for this (both scoped by the existing
   `fs:scope-applocaldata`/`fs:scope-appconfig` grants, no new directories opened up).

Neither fix could be exercised end-to-end here — no Stronghold/Tauri runtime in this sandbox (see
"Environment limits" below) — but the envelope format, the validate-before-write ordering, and the
salt save/revert logic were all reviewed line-by-line against the plugin source actually confirmed
in this session, not assumed from memory.

**Placeholder app icon.** `docs/CLAUDE-AUDIT-RESULTS.md` correctly flagged that no icon existed
and that choosing the real TDS app icon source image is Nev's call, not something to guess. A
build blocker existed either way (no icon = no valid installer config), so a plain
charcoal-and-lime placeholder mark was generated purely to unblock `tauri build` and to prove the
`npx tauri icon` → `src-tauri/icons/` → `tauri.conf.json bundle.icon` pipeline actually works end
to end — it does, and `bundle.icon` needed to be added to `tauri.conf.json` by hand (the prior
audit's assumption that the config schema auto-populates it was checked here and is incorrect for
this CLI version; there's no `icon` key by default and it must be listed explicitly). **This
placeholder must be replaced with a real brand icon before shipping** — it is not a design
decision, just a way to keep the build unblocked.

## 2026-09-04 — Corrective patch: planning step vs. production stage

Applied `docs/PHASE1-CORRECTIVE-PATCH.md` exactly as specified — a narrow correction, not a
redesign. Two independent dimensions now exist where there was one ambiguous one:

- **Planning step** (unchanged behavior): the existing 6-value Digital Door thinking flow —
  outcome, customer, paths, destinations, build, handoff, complete. Column renamed from
  `digital_door_brief.stage` to `digital_door_brief.planning_step` via an additive migration
  (`003_rename_stage_to_planning_step.sql` — `001_init.sql` itself was not touched, per the
  patch). `AdvanceDoorStage`/`UpdateDoorBriefField` keep their names and behavior; only the
  underlying column moved. Verified against a real SQLite engine (better-sqlite3) that
  `ALTER TABLE ... RENAME COLUMN` correctly rewrites the table's CHECK constraint to reference the
  new name and that it's still enforced afterward. A `grep -rn '\.stage\b' src` pass after the
  rename initially still found two live bugs it would have been easy to miss by inspection alone —
  `screens/health.js` and `screens/today.js` both read `b.stage` on rows returned by queries that
  already used `SELECT *` against the renamed column, so they'd have rendered `undefined` at
  runtime. Fixed to read `b.planning_step`; the grep came back clean afterward.
- **Production stage** (new): a 12-stage client-delivery pipeline on `project.production_stage`
  (intake → brand_understanding → assets → digital_door → customer_paths → mobile_optimization →
  full_site_handoff → owner_digital_key → qa_audit → client_approval → launch → support_cleanup),
  added via `004_add_production_stage.sql` (`ADD COLUMN ... NOT NULL DEFAULT 'intake' CHECK (...)`,
  verified to backfill existing rows and stay enforced). A new action, `AdvanceProductionStage`,
  validates the target stage and the project's existence, updates the column, and is risk-tiered
  external/write by default — except the transition to `launch`, which is high-impact and requires
  the typed APPROVE confirmation (a live-client-asset change, matching §5's "Launch-stage
  transitions" example, exactly like `AdvanceDoorStage`'s transition to `complete`).
- **Minimal UI**: no new pipeline screen. The existing Clients + Projects → Project detail view
  gained a production-stage readout and a single "Advance → next stage" button per project; when
  a project is already at `launch`, it shows "PRODUCTION COMPLETE" instead.
- `docs/DIGITAL-DOOR-WORKFLOW.md` now states up front that it documents the planning flow only,
  with a pointer to `docs/PHASE1-CORRECTIVE-PATCH.md` for the production pipeline.

This closes the "12 vs 6" ambiguity noted above without inventing an unsourced 12-item planning
list — the 12 stages were a real, separate thing the original build conflated with the Door
workflow's step count.

## 2026-09-04 — ChatGPT-audit fix: atomic mutation + ActivityEvent logging

The action layer previously ran the mutating statement, then a *second*, independent
`db.execute()` call to insert the ActivityEvent. If the app crashed or that second call failed for
any reason, a real state change could exist with no audit trail entry — exactly what §2/§8 are
supposed to make impossible.

A literal JS-driven `BEGIN; mutate; INSERT event; COMMIT;` sequence was considered and rejected:
verified against `tauri-plugin-sql`'s Rust source (`wrapper.rs`) that `execute()`/`select()`
acquire a connection from an unconfigured (default) `sqlx` pool **per call** — there is no
guarantee a `COMMIT` issued from a later JS call lands on the same physical connection as an
earlier `BEGIN`, so that approach would only *look* transactional.

Instead, every entity table now has SQL triggers
(`src/lib/migrations/006_activity_event_triggers.sql`) that insert the corresponding
`activity_event` row as part of the *same statement execution* as the mutation — a single SQL
statement, including any trigger it fires, is one atomic unit in SQLite regardless of connection
pooling. This is a stronger guarantee than the old two-call design, not a weaker one: the event
literally cannot be separated from the mutation. Consequences of this design, all deliberate:

- Every action's mutation is now exactly one `db.execute()` call. `UpdateClient` and `UpdateTask`
  previously issued one `UPDATE` per changed field (up to 3–4 separate statements); they were
  rewritten as a single `UPDATE ... SET x = COALESCE($1, x), ...` statement each, both to fix this
  and because multiple statements would have fired their trigger multiple times for one logical
  action call.
- `activity_event.payload` is now a plain descriptive string built from the trigger's `NEW`/`OLD`
  row values (e.g. `'status=' || OLD.status || '->' || NEW.status`), not the ad-hoc JSON-shaped
  dict the JS layer used to pass. Nothing in the app parses `payload` as JSON — the Activity Log
  screen never even rendered it — and building real `json_object(...)` payloads from a trigger
  would depend on the SQLite build's JSON1 extension being compiled in, which isn't verifiable
  without a live build here. `related_entity_type`/`related_entity_id` still fully identify the
  row, so anyone auditing can look up its current state.
- `RecordAuditResult` creates an `audit_report` Artifact; there was no way for a trigger on
  `artifact` to know which Handoff that report is about, since Artifact only linked to
  Task/Project. Added `artifact.related_handoff_id` (`005_artifact_handoff_link.sql`, nullable FK)
  so the audit-result trigger can link the event to the handoff being audited, not just the
  artifact record.
- The one event that still can't come from a trigger is `approval_granted` (high-impact actions):
  it records the approval step itself, which has no row mutation to hang a trigger on. It's still
  emitted directly by the action layer, *before* the mutating statement runs.
- A handoff status trigger fires on any transition into a given status regardless of which JS
  action caused it (e.g. `UpdateHandoffStatus('returned')` and `SubmitForAudit` both transition to
  `returned` and now produce the same `handoff_returned` event, where they previously had two
  slightly different labels). This is treated as a correctness improvement, not a regression: the
  event is keyed to the actual state change, not to which code path happened to cause it.
- A redundant call that sets a column to the value it already has (e.g. calling `CompleteTask`
  twice) still logs an event — SQLite fires an `UPDATE` trigger whenever the statement runs,
  whether or not the value actually changed. This is accepted as a minor, documented cost: the
  audit's requirement is that a real mutation can't happen silently, not that a no-op can never
  log anything.

Verified for real, not just reviewed: a full migration-and-trigger test suite was run against
better-sqlite3 (a real SQLite engine, installed for this session), simulating the exact SQL every
one of the 19 named actions executes, asserting exactly one correctly-typed `activity_event` row
per mutation with correct entity linkage, plus CHECK-constraint and foreign-key rejection tests
and a `created_at` format check. All passed. This is not a substitute for running the actual
Tauri/tauri-plugin-sql stack (still not possible in this sandbox — see below), but it is real
verification of the SQL and trigger logic itself, on the same engine tauri-plugin-sql embeds.

## 2026-09-04 — ChatGPT-audit fix: migration robustness

Two real bugs were found in the original semicolon-splitting migration runner, both caught by
testing against a real SQLite engine rather than by inspection:

1. A semicolon inside a seeded string value broke the naive `sql.split(';')` splitter (documented
   above, already fixed last session).
2. `CREATE TRIGGER ... BEGIN ... END;` bodies — needed for the atomicity fix above — contain their
   own internal statements ending in `;`, which are not top-level statement boundaries. The same
   naive splitter broke every trigger definition into unterminated fragments.

Fixed by replacing the splitter with a real quote/comment/`BEGIN`-`END`-depth-aware tokenizer
(`src/lib/sqlSplit.js`) — not a full SQL parser, but enough lexical state (single- and
double-quoted strings with `''`/`""` escaping, `--` and `/* */` comments, and `BEGIN`/`END`
nesting depth via whole-word matching) to find real statement boundaries. Unit-tested directly
(11 cases: quoted semicolons, escaped quotes, comments, multi-trigger files, and an identifier
literally named `beginning`/`ending` to confirm word-boundary matching doesn't misfire), then
exercised against the real migration files via better-sqlite3.

**On "transactional":** literal cross-statement `BEGIN`/`COMMIT` wrapping of a migration's
statements was considered and rejected for the same reason as the action-layer atomicity fix —
`tauri-plugin-sql` acquires a connection per `execute()`/`select()` call, so a JS-driven
transaction spanning multiple calls isn't reliably atomic; wrapping migrations in it would be
false confidence, not real safety. Robustness instead comes from two properties, both true of
every migration file here and enforced by convention going forward: every `CREATE
TABLE`/`CREATE INDEX` uses `IF NOT EXISTS`, and every seed `INSERT` uses `OR IGNORE`
(`002_seed_integrations.sql`) — so a migration that fails partway through (schema_version is only
written *after* every one of its statements succeeds) is safely retried in full on next launch:
already-applied statements are no-ops, and only the genuinely missing ones execute. This is a
self-healing runner rather than a transactional one, and is the honest, verifiable claim for what
this environment and this plugin's API actually allow — a stricter guarantee would need a
dedicated Rust-side command opening its own single-connection pool, which is a real Phase 2 option
if it's ever needed, not something to fake here.

## Environment limits on this build (verify manually — see docs/PHASE1-ACCEPTANCE.md)

This build was done in a sandboxed Linux container with **no Rust/Cargo toolchain, no
webkit2gtk/gtk3, and no Windows target** — the same constraint `docs/CLAUDE-AUDIT-RESULTS.md`
already hit. That means `cargo check`, `tauri dev`, and `tauri build` could not be run here, so
the Rust changes (`lib.rs`, `Cargo.toml`, `capabilities/default.json`) and the parts of the app
that only the real Tauri/Stronghold/fs/dialog runtime can exercise (the actual backup/restore
round trip; whether `PRAGMA foreign_keys = ON` really holds across `tauri-plugin-sql`'s connection
pool) were not executed — only reviewed by inspection against plugin source verified via WebFetch.

This update session additionally installed `better-sqlite3` (a real, native SQLite engine) purely
for local testing — not a project dependency, not committed, used only from this sandbox's shell.
That materially raised the bar for the SQL/migration/trigger layer specifically: every migration
file was actually executed against a real SQLite database, and every one of the 19 actions'
mutating statements was simulated and asserted to produce exactly the right atomic
`activity_event` row, with CHECK-constraint, foreign-key, and `RENAME COLUMN`/`ADD COLUMN`
behavior all confirmed against the real engine rather than assumed. It does not, and can't,
substitute for running the actual Tauri app — it has no IPC layer, no Stronghold, no `fs`/`dialog`
plugins, and tauri-plugin-sql's specific connection-pooling behavior isn't something a separate
SQLite engine can observe. See docs/PHASE1-ACCEPTANCE.md for exactly which acceptance criteria
that leaves unverified and what running them for real requires.

## Deferred from Phase 1

- Claude API
- OpenAI API
- GitHub live status
- Spaceship
- Gmail / Calendar
- Stripe / bank integrations
- native Watchtower background monitoring
- system tray Jarvis panel
- music / sound
- voice
- unrestricted local file access (explicitly not desired)
