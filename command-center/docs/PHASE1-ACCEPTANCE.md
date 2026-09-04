# Phase 1 Acceptance — Verification Report

Checked against `docs/PHASE1-SPEC.md` §10, in order. Status legend:

- **VERIFIED** — checked directly in this environment (grep/read the actual code, ran it, or both).
- **BUILT, NOT RUNTIME-VERIFIED** — the code exists and was reviewed by inspection against
  documented APIs, but could not be executed here (see "Why some things couldn't run," below).
- **BLOCKED** — cannot be completed in this environment at all; exact remaining steps given.

---

1. **All entities above exist in schema with migrations, version-tracked.**
   VERIFIED. `src/lib/migrations/001_init.sql` creates all 9 §3 entities (client, project, task,
   digital_door_brief, artifact, handoff, activity_event, integration_record, inbox_item) plus
   `legacy_state` and `schema_version`. `src/lib/migrations.js` tracks applied versions in
   `schema_version`. The statement-splitting logic was run directly against both real `.sql`
   files under plain Node (not inside Tauri) and confirmed to produce well-formed CREATE/INSERT
   statements — this is how the semicolon-in-a-string-literal bug below was caught and fixed.
   Not yet confirmed: actually executing these statements against a live SQLite connection
   (needs a running Tauri app — see "Why some things couldn't run").

2. **No UI or code path mutates SQLite except through the named action layer.**
   VERIFIED by grep: `grep -rn "\.execute(" src` outside `src/lib/actions.js`, `db.js`, and
   `migrations.js` (schema setup only) returns nothing, and no screen file references `getDb` or
   `db.execute` directly. The pre-existing Inventory/Client Jobs/Runway/Watchtower/Money screens,
   which used to write straight to a KV table, now go through the new `SaveLegacyState` action —
   see `docs/DECISIONS.md`.

3. **Every action in §4 is implemented, validated, and emits an ActivityEvent.**
   VERIFIED for implementation + validation by direct code read: all 19 named actions from §4
   exist in `src/lib/actions.js`, each calls `required()`/`oneOf()`/`assertExists()` before
   mutating, and every one routes through the shared `runAction()` wrapper, which always calls
   `emitEvent()` after the mutation succeeds. BUILT, NOT RUNTIME-VERIFIED: never actually run
   against a live DB, so this is a static-code guarantee, not an observed one.

4. **Approval tiers in §5 are enforced (external/write and high-impact require confirmation).**
   VERIFIED by code read: `src/lib/risk.js` tags every action; `runAction()` in `actions.js` calls
   `confirmGate()` before mutating whenever `requiresConfirmation(tier)` is true, and high-impact
   additionally requires typing "APPROVE" (`src/lib/confirm.js`). `AdvanceDoorStage`'s tier is
   resolved dynamically so only the launch transition to `complete` is high-impact, matching §5's
   "Launch-stage transitions" example. BUILT, NOT RUNTIME-VERIFIED: the modal has never actually
   been clicked through in a browser/webview.

5. **Today and Business Health are computed views with no dedicated storage/duplication.**
   VERIFIED: `getTodayView()` and `getBusinessHealth()` in `src/lib/queries.js` are pure `SELECT`
   functions over the entity tables — no `legacy_state`/dedicated table backs either screen.

6. **Digital Door wizard uses distinct state keys per step (regression check).**
   VERIFIED by design: `digital_door_brief` has separate `urgent_need` and `customer_intent`
   columns, and `DOOR_FIELD_COLUMN` in `actions.js` maps each wizard field to its own column —
   the exact collision `docs/CLAUDE-AUDIT-RESULTS.md` found and fixed (two fields both writing
   `urgentNeed`) is structurally impossible to reintroduce without deliberately reusing a column
   name. Not runtime-clicked-through.

7. **Backup export → restore round-trip tested successfully once.**
   BLOCKED here. `src/lib/backup.js` implements export (SQLite bytes → Stronghold `Store` record
   → snapshot saved → copied to a chosen path) and restore (copy back → reopen vault → read the
   record → overwrite the live db → reload), built against the plugin APIs verified via WebFetch
   against `plugins-workspace` source. It has never actually run — this sandbox has no Rust
   toolchain, no webkit2gtk, and no Windows target (same limitation `docs/CLAUDE-AUDIT-RESULTS.md`
   hit). **To actually satisfy this criterion:** on a real Windows/dev machine with the Tauri
   prerequisites installed, run `npm install && npm run tauri dev`, go to the Backup screen,
   acknowledge the recovery-passphrase step, export a backup, then either wipe the app's local
   data directory or use a second machine, restore from the exported file, and confirm the data
   (a client, a task, a door brief) is intact.

8. **Recovery key acknowledgment step exists and cannot be silently skipped.**
   VERIFIED at two layers: the Backup screen disables the Export button until the acknowledgment
   checkbox is saved, and `exportBackup()` itself (`src/lib/backup.js`) independently re-checks
   `firstRunAcknowledgementNeeded()` and throws if it's missing — so re-enabling the button via
   devtools would still fail the export. Not runtime-clicked-through.

9. **Activity Log displays real events from real actions, chronological, filterable.**
   VERIFIED by code read: `listActivityEvents()` reads `activity_event` ordered by `created_at
   DESC`, filterable by `related_entity_type`; the screen wires a `<select>` to that filter. Every
   action-layer mutation writes exactly one row here (see #3). Not runtime-observed.

10. **App icons exist and a Windows installer builds successfully.**
    PARTIALLY VERIFIED, PARTIALLY BLOCKED. `npx tauri icon <source>` was actually run in this
    environment (the CLI's own binary doesn't need a Rust toolchain) and genuinely generated the
    full icon set into `src-tauri/icons/`, including `icon.ico`/`icon.icns`; `tauri.conf.json`'s
    `bundle.icon` was then added by hand after confirming the CLI does **not** auto-populate it
    (contradicting the prior audit's assumption — checked directly here). The icon itself is a
    plain placeholder mark, not a real brand decision — see `docs/DECISIONS.md`. BLOCKED: actually
    running `tauri build` to produce a Windows `.msi`/`.exe` requires a Windows machine (or a
    properly configured cross-build) with the Rust + MSVC + WiX/NSIS toolchain, none of which
    exist here. **To finish this criterion:** replace the placeholder icon with a real TDS asset,
    then on a Windows dev machine (or Windows CI runner) run
    `npm install && npm run tauri build` and confirm an installer is produced under
    `src-tauri/target/release/bundle/`.

11. **`.gitignore` and `package-lock.json` remain in place (verify not regressed).**
    VERIFIED: both files are unchanged in kind (still present, `.gitignore` untouched) and
    `package-lock.json` was regenerated by a real `npm install` run in this session (adding
    `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog`), not hand-edited.

12. **No integration is shown as "connected" unless it is genuinely automated.**
    VERIFIED: `002_seed_integrations.sql` marks only Local SQLite and the Stronghold vault as
    `automated`/`connected` — everything external (GitHub, Claude, Claude Code, ChatGPT,
    Watchtower, Spaceship, Gmail/Calendar, Stripe) is `manual`/`planned`. The Integrations screen
    and the top-bar chip strip both read live from `integration_record`, so there's one source of
    truth, not a separate hand-maintained list that could say something different.

---

## Why some things couldn't run here

This build happened in a headless Linux sandbox with **no Rust/Cargo, no webkit2gtk/gtk3, and no
Windows target** — `rustc`/`cargo`/`pkg-config` are all absent (checked directly). That rules out
`cargo check`, `tauri dev`, and `tauri build` entirely; it's the identical constraint the prior
Claude audit (`docs/CLAUDE-AUDIT-RESULTS.md`) already documented for this same reason.

What **was** actually possible and was done, not skipped:
- `npm install` — ran clean, regenerated `package-lock.json` for real.
- `npm run build` (Vite) — ran clean after every source change, catching real import/bundling
  errors along the way.
- `node --check` on every new/changed JS file.
- Direct Node execution of the migration statement-splitter against the real `.sql` files —
  caught and fixed a real bug (a semicolon inside a seeded string broke the splitter).
- A grep-based cross-check that every `document.getElementById` call in every screen targets an
  id that actually exists, and that every `data-*` attribute used as a JS hook is read with the
  correct camelCase `dataset` property.
- `npx tauri icon` — genuinely generated the icon set; this doesn't need a Rust toolchain since
  it's the CLI's own bundled binary, not a build of the app.
- Every Rust/plugin API this build depends on (`tauri-plugin-sql`'s path resolution,
  `tauri-plugin-stronghold`'s JS `Store` API, `tauri-plugin-fs`/`tauri-plugin-dialog`'s function
  signatures and permission identifiers, both plugins' Rust `init()` functions) was checked
  against the actual `plugins-workspace` source before being used, not assumed from memory.

What genuinely remains, and requires a real Windows/Tauri dev environment:
- Criterion 7 (backup/restore round-trip) and the Windows-build half of criterion 10, exactly as
  described above.
- A first real `npm run tauri dev` pass to catch anything a static read can't — e.g. Stronghold's
  first-run vault-creation behavior, or SQLite `PRAGMA foreign_keys` actually taking effect on
  tauri-plugin-sql's connection pool the way `src/lib/db.js` assumes (the JS-side `assertExists`
  checks in `actions.js` are a deliberate backstop for exactly this uncertainty).
