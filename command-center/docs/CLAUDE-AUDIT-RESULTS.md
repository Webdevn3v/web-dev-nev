# Claude Audit Results — Command Center Phase 1

Reviewed on branch `command-center-phase1` against `docs/CLAUDE-AUDIT.md`.

## Verdict: FIX REQUIRED (one blocking bug), otherwise solid

The scaffold is a sound Phase 1 foundation. One real data-loss bug was found and fixed in this pass. Everything else is either correct as written or a documented Phase 2 gap — nothing else blocks using this as-is.

## Blocking issue — fixed in this pass

**Field-key collision silently overwrites user answers in the Digital Door wizard.**

- File: `command-center/src/main.js`
- Step 0 (`stepBody`, was line 95) and Step 1 (`stepBody`, was line 96) both bound a textarea to `state.doorDraft.urgentNeed` — one for "what would make this project a win?", the other for "what are they trying to do?". Answering step 0, then step 1, silently overwrote the step 0 answer with unrelated text, and the two questions kept swapping each other's saved value every time the user revisited either step.
- Fix: step 1's "what are they trying to do?" field now writes to a new key, `customerIntent`, added to the `seed.doorDraft` shape. Step 0 keeps `urgentNeed`.
- Follow-on fix: `renderDoorSummary` (the final "Digital Door Brief") was only surfacing `client`, `primaryGoal`, `customer`, `tone`, `paths`, `destinations`, `handoff` — silently dropping `urgentNeed`, `customerIntent`, `deliverables` (build pieces), and `notes`, even though `docs/DIGITAL-DOOR-WORKFLOW.md`'s "Workflow output" section lists all of these as required brief contents. Added the missing fields to the summary view so the brief actually matches the documented spec.

No other correctness bugs found in `main.js`; `initDb`/`persist` (SQLite KV read/write) and the render/nav/step-navigation logic are otherwise sound.

## Repo hygiene — fixed in this pass

- `command-center/` had no `.gitignore`. `npm install` and a future `cargo build`/`tauri build` would create `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`, and `dist/` — all large and disposable — with nothing stopping a broad `git add` from committing them. Added `command-center/.gitignore` covering all four, plus `*.log`.
- `command-center/package-lock.json` did not exist/was not committed, so `npm install` had no pinned dependency graph — every fresh install could silently resolve different transitive versions of `vite`, the Tauri JS packages, etc. Ran `npm install` and committed the generated lockfile.

## Per-item findings

1. **Tauri 2 correctness (Windows).** `tauri.conf.json` is valid Tauri v2 schema; window config, `identifier`, `productName`, `build` block (devUrl/beforeDevCommand/frontendDist) are all correct and internally consistent with `package.json`'s `vite --port 1420 --strictPort`. No Windows-specific misconfiguration found. PASS.

2. **SQLite plugin setup and persistence.** `tauri-plugin-sql` is registered in Rust (`lib.rs`), granted via `sql:default` capability, added as a JS dependency, and used correctly from the frontend (`Database.load('sqlite:tds-command-center.db')`, parameterized queries, `ON CONFLICT ... DO UPDATE` upsert). The one real bug here was the `urgentNeed` collision above — fixed. PASS otherwise.

3. **Stronghold initialization/permissions.** `with_argon2(&salt_path)` in `lib.rs` resolves the salt path via `app_local_data_dir()` and registers the plugin in `.setup()` — this is the correct Tauri v2 pattern. `stronghold:default` is granted. No secrets are read, stored, or referenced anywhere in the renderer (`main.js`/`index.html`) — the plugin is present but genuinely unused in Phase 1, which matches `docs/DECISIONS.md`'s "scaffold now, wire later" decision. PASS. Note for Phase 2: there are no Rust `#[tauri::command]` handlers yet for reading/writing secrets — that native boundary still needs to be built before any AI/API key work starts.

4. **CSP and capability configuration.** `default-src 'self'` with no `script-src` override, `style-src 'unsafe-inline'` (required because the UI sets inline `style="width:…%"` on progress bars — not gratuitous), `font-src`/`style-src` scoped only to Google Fonts, and `connect-src` explicitly allowing `ipc:`/`http://ipc.localhost` (required for the SQL plugin's IPC to function under CSP on desktop). Capability file grants only `core:default`, `sql:default`, `stronghold:default` — no filesystem, shell, or HTTP permissions. This matches the "no broad filesystem/admin permissions" and "no external APIs yet" constraints exactly. PASS.

5. **Build/dev-server mistakes.** Dev port alignment between Vite and `tauri.conf.json` is correct. `npm install` in a clean checkout resolves cleanly (verified). One real gap: **no app icons exist anywhere in `src-tauri/`**, and `tauri.conf.json`'s `bundle` block has no `icon` array (schema default is `[]`, so this doesn't fail config validation or `tauri dev` — but a Windows installer build (`tauri build`, `targets: "all"`) needs real icon files to produce an .exe/.msi with a proper icon rather than a blank/default one). **FIX REQUIRED before first production build, not before continuing Phase 1 dev work.** Recommended patch: once a square TDS app-icon source image is chosen (the marketing `tds-logo.webp` at the repo root is not necessarily the right asset — that's a product decision for Nev, not something to guess), run `npx tauri icon <path-to-square-source.png>` from `command-center/` to generate the full icon set into `src-tauri/icons/`, then it auto-populates `bundle.icon` in the config.

6. **Frontend runtime errors.** No undefined references or exceptions found by inspection. The only functional bug was the `urgentNeed` collision, now fixed. Minor style nit (not fixed, not blocking): several render functions reference bare globals like `nav`, `view`, `clock` that work only because their matching `id="..."` elements exist in `index.html` (implicit DOM-id-to-global binding) — functionally fine in a webview, but relies on non-obvious browser behavior; worth switching to explicit `document.getElementById` in Phase 2 for clarity.

7. **Offline behavior.** Core data path (SQLite) is fully local and has a graceful in-memory fallback if `initDb()` throws (`boot()` catches and still renders with seed data). The one non-local dependency is the two Google Fonts loaded from `fonts.googleapis.com`/`fonts.gstatic.com` at every launch — if offline (including first run), these fail silently and the UI falls back to generic `sans-serif`/`monospace`, so nothing breaks, but it's a rough edge for an app whose README calls itself "offline-first." Recommendation for Phase 2: self-host Inter/Space Mono `woff2` files under `src/fonts/` and drop the CSP's Google Fonts allowance entirely, tightening `default-src 'self'` to a true single-origin CSP. Not blocking.

8. **Data-loss risks.** The `urgentNeed` collision (fixed) was the only concrete data-loss bug. Every step transition in the wizard persists to SQLite immediately, so there's no window where in-progress work is only in memory. No export/backup of a completed brief exists yet (e.g., copy-to-clipboard or save-as-text) — worth adding in Phase 2 since `docs/DIGITAL-DOOR-WORKFLOW.md` frames the brief as something "the next builder or AI" needs, implying it should leave the app.

9. **Local-first boundary.** No `fetch`/`XHR`/`WebSocket` calls anywhere in `main.js`. All business state lives in the local SQLite file. The only network traffic is the Google Fonts stylesheet/font requests (cosmetic, not business data). PASS.

10. **Future AI/integration hooks without exposing secrets in the renderer.** Nothing in the current code stores or calls any credential. The architecture (native Stronghold + capability-gated Tauri commands) is scaffolded correctly for keeping secrets out of the renderer in later phases; there simply aren't any Rust commands yet to call, which is expected at this stage. PASS.

11. **Digital Door Workflow UX.** The six wizard steps map exactly to Outcome → Customer → Paths → Destinations → Build → Handoff from `docs/DIGITAL-DOOR-WORKFLOW.md`, each step keeps 2–3 fields visible, and the step rail plus back/next/save controls make the sequence easy to follow. The field-collision bug was actively undermining this goal (the wrong question showing an old answer); fixing it removes the main UX defect. No inference/prefill exists yet, but the doc itself defers that to "Later intelligence" — not a Phase 1 gap.

12. **Visual quality.** Charcoal/graphite base with a single lime accent, Space Mono reserved for labels/kickers and Inter for body text, restrained 1px borders and subtle glow rather than heavy neon — reads as command-deck/refined-tech, not generic SaaS and not cheesy sci-fi. PASS, no changes made.

## What should become Phase 2

- Real app icon set (`npx tauri icon`) once a source image is chosen, before the first `tauri build`.
- Self-hosted fonts to fully close the offline gap.
- Rust-side `#[tauri::command]` handlers + Stronghold read/write wiring before any AI/API key work begins (per `docs/DECISIONS.md`'s deferred list: Claude API, OpenAI API, GitHub live status, Spaceship, Gmail/Calendar, Stripe/bank integrations).
- Export/copy for a completed Digital Door brief so it can actually leave the app for a builder or another AI, per the workflow doc's stated purpose.
- "Later intelligence" prefill/inference for the Door Workflow, as already scoped in `docs/DIGITAL-DOOR-WORKFLOW.md`.

## What was not attempted, and why

`cargo check`/`cargo build` on `src-tauri` was not run. This sandbox has no `webkit2gtk-4.1`/`gtk3` system libraries (this is a headless Linux container, not the Windows target this app ships for), so a build attempt here would fail on missing system dependencies unrelated to the actual Rust code and would not be a meaningful correctness signal. The Rust source (`lib.rs`, `main.rs`, `build.rs`, `Cargo.toml`) was reviewed by inspection instead; nothing in it looks incorrect for Tauri v2's documented SQL + Stronghold setup pattern.
