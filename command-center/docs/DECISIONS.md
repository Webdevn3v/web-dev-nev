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

**Digital Door stage count: spec says "12 pipeline stages," the built workflow has 6.**
§3's DigitalDoorBrief row says `stage (enum matching the 12 pipeline stages)`, but the only
stage sequence that exists anywhere in this repo is the 6-step Outcome → Customer → Paths →
Destinations → Build → Handoff sequence in `docs/DIGITAL-DOOR-WORKFLOW.md`, and §9.4 explicitly
says to "bring [the workflow] that's already partly built into this schema." Treated the "12" as
inaccurate wording rather than a hidden requirement to invent 6 more stages with no source of
truth for what they'd be. `digital_door_brief.stage` is a 7-value enum: the 6 documented stages
plus a `complete` bookend for the launched/handed-off state. Flagged for Nev to confirm — if a
real 12-stage list exists elsewhere, the schema/action layer will need a follow-up migration.

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
`plugins-workspace/v2/plugins/stronghold/guest-js/index.ts`) before the vault snapshot is saved
and copied to the export destination. The one file that leaves the machine — the Stronghold
snapshot — is already password-protected (`with_argon2`, `src-tauri/src/lib.rs`) and now also
contains the database, so "encrypted archive (SQLite file + Stronghold vault)" per §7 is literally
one encrypted file. The recovery passphrase is never stored by the app; §7's "cannot be silently
skipped" acknowledgment gate lives on the new Backup screen.

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

## Environment limits on this build (verify manually — see docs/PHASE1-ACCEPTANCE.md)

This build was done in a sandboxed Linux container with **no Rust/Cargo toolchain, no
webkit2gtk/gtk3, and no Windows target** — the same constraint `docs/CLAUDE-AUDIT-RESULTS.md`
already hit. That means `cargo check`, `tauri dev`, and `tauri build` could not be run here, so
the Rust changes (`lib.rs`, `Cargo.toml`, `capabilities/default.json`) and the live app (SQLite
writes, Stronghold vault operations, the actual backup/restore round trip) were not executed —
only reviewed by inspection against plugin source verified via WebFetch, and, on the JS side,
syntax-checked, exercised with a real Vite production build, and spot-tested where pure logic
(migration SQL splitting) could run under plain Node. See docs/PHASE1-ACCEPTANCE.md for exactly
which acceptance criteria that leaves unverified and what running them for real requires.

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
