# Jarvie — Phase E Scoping Spec

**Status:** Approved 2026-09-06 (OpenAI-compatible endpoint, Llama 3.2 3B default, single
Off/Claude/Local selector, Test-connection button). Built the same day — see `docs/DECISIONS.md`
("Jarvie Phase E") and §8. Minor note: `usageNote()` now reads OpenAI (`prompt_tokens` /
`completion_tokens`) as well as Claude usage keys, and drops the "Claude ·" prefix.
**Scope discipline:** one build session. **Adds no paid service.** Phase E lets Jarvie's Phase C
language layer run against a **local model you host yourself** (Ollama / llama.cpp / LM Studio /
any OpenAI-compatible server) instead of the Claude API — free, offline, on your own hardware.
**Builds on:** `docs/JARVIE-PHASE-C.md` (the LLM seam) and `-D.md` (deterministic deepening).
Everything in A–D is unchanged. The language layer stays **optional and off by default**.

---

## 1. What Phase E adds

Phase C built the seam for exactly two jobs — **prose** (rewrite a deterministic answer) and
**fuzzy intent** (route an unrecognised question onto an existing intent or Phase B/D command).
Phase E adds a **second backend** for that seam:

| Backend | Endpoint | Auth | Cost |
|---|---|---|---|
| `claude` (Phase C) | `https://api.anthropic.com/v1/messages` | API key | paid per call |
| **`local` (Phase E)** | a user-run OpenAI-compatible server, default `http://localhost:11434/v1` | none | **free** |

The renderer seam (`jarvieLLM.js`), the deterministic fallback for every failure, the
"never executes / re-parsed by `parseCommand`" rule, and the risk gates are **identical** for
both backends. Phase E is a Rust branch in one function plus a few config fields.

---

## 2. Non-negotiables

1. **No paid service.** The local backend talks only to a server **you run**. The app does not
   bundle, download, or manage a model runtime — you install Ollama (or equivalent) yourself.
   If the local URL is pointed at a paid hosted endpoint that's your call, but the UI labels it
   "local model" and the default is loopback.
2. **Local by default, and flagged if not.** The endpoint defaults to `http://localhost:11434`.
   A non-loopback / non-private-range host shows a one-line "this is not a local address"
   notice in the settings card (no block — LAN Ollama on another machine is legitimate).
3. **Still an enhancement layer, off by default.** No backend selected, server unreachable, a
   non-2xx, a timeout, malformed output, or a failed validation → Jarvie returns the exact
   Phase A–D deterministic answer, with an "answered locally (model)" note. Never on the
   critical path.
4. **Retrieval stays deterministic and read-only.** `jarvie.js` still imports only `queries.js`.
   The model is handed `{question, intent, title, summary, records}` — already retrieved — and
   can query nothing.
5. **The model never executes.** A routed command is rebuilt and re-parsed by `parseCommand()`;
   its args are re-resolved and re-validated; it still produces a proposal card + `confirmGate`.
6. **The request is Rust-side.** Same reasons as Phase C: one code path, and the renderer's CSP
   stays unchanged (no `connect-src` for `localhost`). `reqwest` already has what it needs — no
   `Cargo.toml` change.
7. **No new dependency, migration, capability, or CSP change. No persona.**

---

## 3. Architecture

```
src/screens/jarvie.js  — the "CLAUDE API" card becomes "JARVIE LANGUAGE LAYER":
    Backend:  ( ) Off   ( ) Claude API   ( ) Local model
      Claude API →  key field + model select        (Phase C, unchanged)
      Local model → endpoint URL + model name + [Test connection]
src/lib/jarvieLLM.js   — status()/prose()/route() unchanged in shape; carries the extra
                         config through; the route prompt gains two few-shot examples when
                         backend === 'local' (small models need them).
src-tauri/src/jarvie_llm.rs
    + jarvie_llm_set_backend(b)        → "off" | "claude" | "local"
    + jarvie_llm_set_local(url, model) → …/jarvie-local-url.txt, …/jarvie-local-model.txt
    + jarvie_llm_ping_local()          → GET <url>/models (or a 1-token chat), for the UI test
    ~ jarvie_llm_status()  → { backend, hasKey, model, enabled, localUrl, localModel }
    ~ jarvie_llm_ask(req)  → branch on backend:
        claude → POST https://api.anthropic.com/v1/messages          (Phase C, unchanged)
        local  → POST <localUrl>/chat/completions  (OpenAI chat format, stream:false)
                 body: { model, messages:[{role:"system",…},{role:"user",…}], temperature:0 }
                 read: choices[0].message.content
src-tauri/src/lib.rs   — register the new commands.
src/screens/integrations.js — the Claude row reflects backend = local ("connected · local model").
```

Config files (mode 0600 where they hold anything sensitive; these don't, but keep the pattern):
`jarvie-backend.txt`, `jarvie-local-url.txt`, `jarvie-local-model.txt`, alongside the existing
`jarvie-enabled.txt` / `jarvie-anthropic.key` / `jarvie-model.txt`.

`enabled` still gates everything: the layer is live only when `enabled == "1"` **and** the
selected backend is usable (`claude` with a key, or `local` with a URL).

---

## 4. The local request (Rust)

- `POST <localUrl>/chat/completions` — the OpenAI chat-completions shape, which Ollama
  (`:11434/v1`), llama.cpp server (`:8080/v1`), LM Studio (`:1234/v1`), vLLM, and text-gen-webui
  all speak. `localUrl` is the base ending in `/v1`; Rust appends `/chat/completions`.
- body: `{ "model": <localModel>, "messages": [ {system}, {user} ], "temperature": 0, "stream": false, "max_tokens": 400|300 }`
- no `cache_control` (local servers don't have it), no `anthropic-version` header, no auth
  header.
- 20-second timeout (local models are slower than Haiku; still bounded).
- parse `choices[0].message.content`; on any shape mismatch → `{ ok:false }` → fallback.
- `stop_reason`-style refusal handling is Claude-only; for local, an empty/short/garbled
  response just falls through the existing validators to the deterministic answer.

**Prompt tweak for `local`:** the fuzzy-route system prompt appends two worked examples (one
`intent`, one `command`, one `none`) — a 3B model needs the format shown, not just described.
The prose prompt is unchanged (rephrasing is easy). Both are still built in `jarvieLLM.js`;
Rust is a dumb proxy.

**Recommended local model** (documented, not enforced): a small instruct model is plenty for
rephrasing + 6-way classification — e.g. `llama3.2` (3B), `qwen2.5:3b`, or `phi3.5`. Default the
model field to `llama3.2`.

---

## 5. Failure & fallback matrix (local backend)

| Condition | Result |
|---|---|
| Backend `off` / not selected | Pure Phase A–D. `jarvieLLM` short-circuits. |
| `local` selected, no URL | Settings card says "set an endpoint"; layer inert. |
| Server not running / connection refused / DNS | Deterministic answer + "answered locally (model unreachable)". |
| Timeout (20s) | Deterministic answer + "answered locally (model timed out)". |
| Non-2xx / model not found on the server | Deterministic answer + the server's error in the Integrations note. |
| Empty / malformed / schema-invalid output | Deterministic answer. |
| Route names an unknown intent / verb / entity / step | Discarded → deterministic capability list. |
| Prose adds a number not in `records` | Keep the deterministic `summary`. |

Identical to Phase C's matrix — the only new failure strings are "unreachable" / "timed out".

---

## 6. Files touched

`src-tauri/src/jarvie_llm.rs` (backend branch + 3 commands), `src-tauri/src/lib.rs` (register),
`src/lib/jarvieLLM.js` (config passthrough + local few-shot), `src/screens/jarvie.js` (backend
selector), `src/screens/integrations.js` (reflect local state), `docs/DECISIONS.md`.

**Not touched:** `Cargo.toml`/`Cargo.lock`, migrations, `risk.js`, `actions.js`, `jarvie.js`,
`jarvieAct.js`, the deterministic builders, `package.json`, capabilities, the CSP.

---

## 7. What can't be verified in this environment

- A running Ollama / local server (not installed; models aren't downloaded here).
- The real `POST /chat/completions` round-trip against a local model.

**Verified here:** `cargo build` including the backend branch; the exact local request shape by
inspection against the OpenAI chat-completions schema; `jarvieLLM` + every fallback path via the
jsdom harness with `invoke` mocked (backend off / local-unreachable / local-ok-prose /
local-ok-route / local-bad-route / timeout); Phase A–D unchanged when the layer is off;
`npm run build`.

**To finish on your machine:** `ollama pull llama3.2 && ollama serve`, then Ask Jarvie →
language layer → Local model → `http://localhost:11434/v1`, model `llama3.2`, Test connection,
Enable. Ask a vague question and a vague command; stop Ollama and confirm the deterministic
fallback.

---

## 8. Explicit Acceptance Criteria

- [ ] Backend selector offers Off / Claude API / Local model; Local shows URL + model + a
      working "Test connection".
- [ ] With backend `local` + a reachable server: prose rewrites `summary` only; a vague
      question routes to the right intent; a vague command routes through `parseCommand` to the
      **same proposal card + gate** a typed command produces.
- [ ] Server unreachable / timeout / bad output → a deterministic answer, never a thrown error
      on screen; the note says the model was unreachable.
- [ ] Non-loopware endpoint shows the "not a local address" notice.
- [ ] The model never triggers a mutation without the proposal card + `confirmGate`.
- [ ] Backend `off` (default) → byte-identical to Phase A–D; no request made.
- [ ] No `Cargo.toml`/lock change, no migration, no dependency, no capability/CSP change; the
      renderer still makes no outbound request (grep).
- [ ] `cargo build` and `npm run build` pass; harness (mocked `invoke`) green.

---

## 9. Deferred (Phase F+ / never)

- Streaming responses; the app installing or downloading a model runtime.
- Embeddings / RAG / semantic search over the entities.
- Multi-backend routing (try local, fall back to Claude) — keep it one selected backend.
- Any Claude-API deepening (still paid; out of scope while "no paid-service integrations"
  holds).
- `keyring` for the Phase C key file.
- Voice, tray, persona, proactive Jarvie — still `PHASE1-SPEC.md` §11.

---

**Reconciliation note.** Phase E reuses the Phase C seam wholesale and changes one Rust function
plus a few config fields. It adds no paid service, no dependency, no migration, and no network
call the renderer can see. The deterministic layer (A–D) is unchanged and remains the fallback
for every failure. The language layer is still off until you turn it on and point it at a model
you run.
