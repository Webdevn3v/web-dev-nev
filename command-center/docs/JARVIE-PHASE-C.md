# Jarvie — Phase C Scoping Spec

**Status:** Approved 2026-09-06 (scope: prose answers **+** fuzzy intent; model configurable,
default Haiku 4.5; spec-first then build). Built the same day — see `docs/DECISIONS.md`
("Jarvie Phase C") and §10. **Deviations taken during the build** (also in DECISIONS.md):
key-entry UI lives on the Ask Jarvie screen (a collapsible card), not Integrations (which now
only *reflects* the status); the fuzzy-intent call asks for JSON in the prompt and parses
defensively instead of using the structured-output `format` param (the Rust command still
passes `format` through for later); `reqwest` uses the `native-tls` feature (SChannel on the
Windows target, OS OpenSSL elsewhere) — lighter than `rustls` + `aws-lc-sys`.
**Scope discipline:** one build session. Phase C is an **enhancement layer** — every path still
works with no key, offline, or with the feature off, and is then byte-identical to Phase A/B.
**Builds on:** `docs/JARVIE-PHASE-A.md` (read-only Q&A) and `docs/JARVIE-PHASE-B.md`
(confirmed actions). Nothing in A or B changes behaviour; the deterministic layer is the
source of truth and the fallback.

---

## 1. What Phase C adds

The Claude API, used for two things and nothing else:

1. **Prose answers** — the LLM rewrites a deterministic answer's `summary` into 1–3 natural
   sentences, grounded **only** in the `records` that deterministic retrieval already pulled.
   `title` and `evidence` stay deterministic.
2. **Fuzzy intent** — the LLM maps a free-form question that the Phase A/B matchers didn't
   recognise onto **one existing intent** or **one Phase B command** (with structured args).
   Its output is re-validated against the same enums / grammar / entity resolver before
   anything runs; off-grammar output is discarded and Jarvie falls back to the deterministic
   "I can answer / I can do these" list.

Retrieval, entity resolution, the command grammar, and both risk gates are **unchanged and
still deterministic**. The LLM never reads the database, never sees more than `records`, and
never executes anything.

---

## 2. Non-negotiables

1. **Retrieval stays deterministic and read-only.** `jarvie.js` still imports only
   `queries.js`. The LLM is handed `{question, intent, title, summary, records}` — already
   retrieved — and can query nothing itself.
2. **The LLM never executes.** For fuzzy intent it emits a *route* (`intent` name, or a
   command `{verb,args}`); the renderer then runs that through the **same** `parseCommand` /
   intent builders as a typed request — so the LLM's args are re-resolved and re-validated,
   never trusted, and a command still produces a proposal card + the action-layer
   `confirmGate`. No autonomous action, ever.
3. **Offline-first is preserved.** No key, no network, a non-200, a timeout, malformed output,
   a validation failure, or the feature toggled off → Jarvie returns the exact Phase A/B
   deterministic answer, with a small "answered locally" note. The LLM is never on the
   critical path.
4. **The key never touches renderer persistence or the bundle.** It is typed once into the
   Integrations form (transits JS memory for that one call), handed to a Rust command, and
   stored by the native side. Every *use* — the actual `POST /v1/messages` — happens in Rust.
   It is never in `localStorage`, the SQLite DB, git, or a `.tdsbackup`.
5. **The API call is Rust-side.** The renderer makes no external request, so its CSP is
   unchanged — no `connect-src` for `api.anthropic.com`. `reqwest` (already in the dependency
   tree via Tauri) gains a TLS feature; no other new capability.
6. **No proactive / background / batched LLM calls.** One call per question the user typed,
   and only when the deterministic layer couldn't answer well on its own (fuzzy intent) or the
   user has prose mode on.
7. **Cost is visible.** The active model is shown in Integrations and on the Ask Jarvie screen;
   each call's token usage is surfaced under the answer.
8. **No persona.** Prose is plain and factual. `PHASE1-SPEC.md` §11 still holds.

---

## 3. Architecture

```
src/screens/jarvie.js
  ├─ jarvie.js       deterministic retrieval + answer builders   (unchanged: queries.js only)
  ├─ jarvieAct.js    command grammar + proposals + execute        (unchanged)
  └─ jarvieLLM.js    NEW — the LLM seam (renderer side)
        status()                       → invoke('jarvie_llm_status')   {hasKey, model, enabled}
        prose(question, det)           → invoke('jarvie_llm_ask', {mode:'prose', …})
        route(question, manifest)      → invoke('jarvie_llm_ask', {mode:'route', …})
        — validates every response here; on any problem returns null → caller uses deterministic
src-tauri/src/jarvie_llm.rs  NEW — #[tauri::command]
   jarvie_llm_status()        → { has_key, model, enabled }
   jarvie_llm_set_key(key)    → write app_local_data_dir()/jarvie-anthropic.key, mode 0600
   jarvie_llm_clear_key()
   jarvie_llm_set_model(m)    → write …/jarvie-model.txt   (haiku|sonnet|opus)
   jarvie_llm_set_enabled(b)  → write …/jarvie-enabled.txt
   jarvie_llm_ask(req)        → POST https://api.anthropic.com/v1/messages (reqwest + native-tls),
                                returns { ok, text?, route?, usage?, error? }
src-tauri/src/lib.rs          + .invoke_handler(tauri::generate_handler![ jarvie_llm_* ])
src/screens/integrations.js   + a "Jarvie / Claude API" card: key field, model select,
                                enable toggle, "answered N calls" note. Renders the existing
                                integration_record row for Claude as "connected (manual key)"
                                only when has_key.
```

**Key storage (design finding).** Stronghold does not fit here: the vault has no always-on
password — `Stronghold.load(path, passphrase)` needs the user's recovery passphrase, which is
only entered during backup/restore. Requiring it on every Jarvie call is unacceptable. Phase C
stores the key as a **mode-0600 file in `app_local_data_dir()`**, read and written only by
Rust. This meets the real threat model (never in renderer/bundle/git/DB/cloud-synced backup).
**Follow-up hardening (not Phase C):** move to the OS credential manager via the `keyring`
crate (Windows Credential Manager / macOS Keychain / libsecret) — deferred only because its
Linux backend complicates this build; the Rust seam (`set_key`/`clear_key`/read-on-use) is
written so swapping the storage impl touches one function.

---

## 4. The two LLM jobs

### 4.1 Prose (`mode: "prose"`)

Rust builds:
- **system** (frozen, `cache_control: ephemeral`): "You rewrite a status answer into 1–3 plain
  sentences. Use ONLY the facts in the JSON. Do not add, infer, or soften. No greeting, no
  persona. If the JSON is empty, say so."
- **user**: `{ question, title, summary, records }` as JSON.
- `max_tokens: 400`, no thinking, `output_config.effort: "low"` where supported.

Renderer replaces the card `summary` with the returned text; everything else deterministic.
Empty/short/over-long/refusal → keep the deterministic `summary`.

### 4.2 Fuzzy intent (`mode: "route"`)

Only runs when `classify()` returned `unknown` **and** `parseCommand()` returned `null`.
- **system** (frozen, cacheable): the capability manifest — the five intent names with one-line
  descriptions, and the Phase B command verbs with their argument shapes and the valid
  enum values (`DOOR_STEPS`, `PRODUCTION_STAGES`, statuses, priorities). "Return the single
  best route or `none`. Never invent an entity, a step, or a verb."
- **user**: the question.
- **structured output** (`output_config: { format: {...} }`, `strict`): 
  ```
  { route: "intent" | "command" | "none",
    intent?: one of the five names,
    command?: { verb: string, target?: string, to?: string, title?: string,
                priority?: string, due?: string, status?: string, text?: string } }
  ```
- `max_tokens: 300`.

Renderer then:
- `route:"intent"` → run that deterministic builder (`answerQuestion` with the forced intent).
- `route:"command"` → **rebuild the command string** from `command` and run it through
  `parseCommand()` unchanged → a proposal card (or a deterministic error / disambiguation).
  The LLM's `target` etc. are re-resolved by the real entity matcher; nothing is trusted.
- `route:"none"` or any validation failure → deterministic capability list.

---

## 5. Request to Anthropic (Rust)

- `POST https://api.anthropic.com/v1/messages`
- headers: `x-api-key: <file>`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- `model`: from `jarvie-model.txt` → `claude-haiku-4-5` (default) / `claude-sonnet-5` /
  `claude-opus-5`. (The `claude-api` skill's default is Opus 5; overridden here per the
  approved decision — the workload is rephrasing + 6-way classification.)
- `max_tokens`: 400 (prose) / 300 (route).
- system prompt carries `cache_control: {type:"ephemeral"}` — it's frozen, so repeat calls
  read it from cache.
- 10-second client timeout. Non-2xx, timeout, transport error, or `stop_reason:"refusal"` →
  `{ ok: false, error }` → renderer falls back.
- `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) passed back for the
  cost note.

No streaming (responses are tiny). No tools. No thinking config for Haiku; adaptive optional
for Sonnet/Opus but off by default for latency.

---

## 6. Failure & fallback matrix

| Condition | Result |
|---|---|
| Feature toggle off | Pure Phase A/B. `jarvieLLM` short-circuits. |
| No key stored | Pure Phase A/B. Integrations shows "add a key to enable". |
| Network down / DNS / TLS / timeout | Deterministic answer + "answered locally (Claude unreachable)". |
| HTTP 401 / 429 / 5xx | Deterministic answer + "answered locally (Claude error 4xx/5xx)". Integrations flags a bad key on repeated 401. |
| `stop_reason: "refusal"` | Deterministic answer, no note beyond "answered locally". |
| Malformed / empty / schema-invalid output | Deterministic answer. |
| `route` names an unknown intent / verb / entity | Discarded → deterministic capability list. |
| Prose longer than ~600 chars or adds a number not in `records` (cheap guard) | Keep deterministic `summary`. |

Jarvie never shows an error *instead of* an answer because of the LLM.

---

## 7. Files touched

| File | Change |
|---|---|
| `src/lib/jarvieLLM.js` | **new** — renderer seam: `status`, `prose`, `route`; validates every response; returns `null` on any problem. Imports `@tauri-apps/api/core` (`invoke`) + `jarvie.js`/`jarvieAct.js` for the grammar/manifest + enums. Never calls the network itself. |
| `src/lib/jarvie.js` | + `capabilityManifest()` (the intent + command catalogue as data) and `forceIntent` support in `answerQuestion`. Still deterministic, still `queries.js`-only. |
| `src/screens/jarvie.js` | after `parseCommand` returns null and `classify` is `unknown`, try `jarvieLLM.route`; when prose mode is on, post-process a rendered answer's `summary` through `jarvieLLM.prose`. Shows the "answered locally" / token note. A per-visit "prose" toggle (localStorage). |
| `src/screens/integrations.js` | + Jarvie/Claude card: key input (write-only), model `<select>`, enable toggle, call-count + last-error note. |
| `src-tauri/src/jarvie_llm.rs` | **new** — the six commands above. |
| `src-tauri/src/lib.rs` | `mod jarvie_llm;` + `.invoke_handler(generate_handler![...])`. |
| `src-tauri/Cargo.toml` | `reqwest` promoted to a direct dep with `["json","native-tls","http2"]` — SChannel on Windows, no rustls/aws-lc build. |
| `docs/DECISIONS.md` | "Jarvie Phase C" entry. |

**Not touched:** migrations, the action layer, `risk.js`, `queries.js` write surface, the CSP,
capability permissions, `package.json`.

---

## 8. What can't be verified in this environment

- The real `POST /v1/messages` round-trip — needs a live API key. (`api.anthropic.com` *is*
  reachable from the build host, but no key is used.)
- `jarvie_llm_set_key` writing to the real `app_local_data_dir()` under a running Tauri app.
- The Integrations key-entry flow clicked through in the webview.

**Verified here:** `cargo build` of the new Rust (including the `reqwest` + native-tls addition);
the `jarvieLLM` seam and every fallback path via the jsdom harness with `invoke` mocked
(success, 401, timeout, malformed, good route, bad route); deterministic answers unchanged
when the feature is off; `npm run build`.

**To finish on your machine:** `npm run tauri dev`, open Integrations → Jarvie/Claude, paste a
key, pick a model, enable. Ask a vague question ("what's slipping with the law firm?") and a
vague command ("push the frederick mission forward") and confirm the prose + the proposal card.
Pull the network and confirm Jarvie still answers.

---

## 9. Explicit Acceptance Criteria

- [ ] Feature off / no key → Jarvie is byte-identical to Phase A/B (harness diff).
- [ ] Prose mode rewrites `summary` only; `title` and `evidence` unchanged; empty `records` →
      deterministic text kept.
- [ ] A vague question routes to the right intent; a vague command routes through
      `parseCommand` and produces the **same** proposal card a typed command would, with the
      action-layer gate intact.
- [ ] An LLM route naming a bad intent / verb / entity / step is discarded → capability list.
- [ ] Every failure in §6 yields a deterministic answer, never a thrown error on screen.
- [ ] The key is never written to `localStorage`, the DB, or the backup envelope; `status`
      never returns it; it lives only in the 0600 file.
- [ ] The LLM never triggers a mutation without the proposal card + `confirmGate`.
- [ ] `cargo build` and `npm run build` pass.
- [ ] Model selectable (Haiku 4.5 / Sonnet 5 / Opus 5), default Haiku 4.5, shown in the UI.
- [ ] No CSP / capability / migration / dependency-manifest change beyond `reqwest`'s feature.

---

## 10. Deferred (Phase D+ / never)

- OS credential manager for the key (`keyring`) — the intended hardening, deferred for this
  build only (Linux backend friction).
- Streaming responses, multi-turn LLM conversation, an LLM that summarises across many
  questions, prompt-cache warming.
- The LLM proposing *new* commands beyond the Phase B grammar, or acting autonomously.
- Any other provider; any use of the key outside `jarvie_llm_ask`.
- Voice, tray, persona, proactive Jarvie — still `PHASE1-SPEC.md` §11.

---

**Reconciliation note.** Phase C keeps every Phase A and B guarantee. The deterministic layer
is unchanged and is the fallback for every failure. The LLM is fenced to two jobs — rephrasing
already-retrieved facts and classifying an unrecognised question into the existing
intent/command vocabulary — and its output is re-validated by the same deterministic code
before it reaches the user or the action layer. The one genuinely new thing is an outbound
HTTPS call, and it is made by Rust with a key the renderer never persists.
