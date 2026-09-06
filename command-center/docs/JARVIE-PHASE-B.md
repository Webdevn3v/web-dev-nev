# Jarvie — Phase B Scoping Spec

**Status:** Approved 2026-09-06 (scope: "local now, Claude API after"; action model:
propose → you confirm → Jarvie executes). Built the same day — see `docs/DECISIONS.md`
("Jarvie Phase B") and the acceptance run in §10. **Phase C (Claude API) is scoped in §11 but
not built.**
**Scope discipline:** Phase B must be finishable in one build session and stays fully local —
no network, no Claude API, no Stronghold/Rust work. Those are Phase C.
**Builds on:** `docs/JARVIE-PHASE-A.md` (read-only Q&A). Everything in Phase A is unchanged.

---

## 1. What Phase B adds

On top of Phase A's five read-only intents, Jarvie gains three local capabilities:

1. **Act** — Jarvie can carry out a small set of typed commands ("advance Frederick to paths",
   "mark handoff … in progress", "create task …") by **proposing** the exact action, waiting for
   your confirmation, then calling the **existing action layer** — the same functions the normal
   UI calls (`PHASE1-SPEC.md` §4, "the Jarvis seam"). No new mutation path is created.
2. **Remember (within a visit)** — light multi-turn context. After Jarvie resolves an entity you
   can say "why is *it* blocked", "and *its* tasks", "advance *that* to the next step". Context
   is session-only and cleared when you leave the screen.
3. **Since I last looked** — a "what changed since I last checked" window, backed by a
   renderer-local timestamp (not database state).

Retrieval is still 100% deterministic and read-only. The **act** path is new, explicit, and
gated twice (§6).

---

## 2. Non-negotiables

1. **Retrieval stays read-only and deterministic.** `src/lib/jarvie.js` is unchanged in
   character: it imports only `queries.js`, never `actions.js`, never writes, never logs. All of
   Phase A's guarantees hold.
2. **The act path is the existing action layer, unchanged.** `src/lib/jarvieAct.js` (new) is the
   *only* Jarvie file allowed to import `actions.js`/`risk.js`. It never mutates except inside
   `executeProposal()`, which is only reachable after an explicit user confirmation. Every action
   it runs validates, risk-gates, and emits its `ActivityEvent` exactly as if you had clicked the
   button yourself — because it *is* the same function.
3. **Two gates, never fewer.** (a) Jarvie always shows the parsed action as a proposal card you
   must accept. (b) The action layer's own `confirmGate` still fires for external/write and
   high-impact actions (`PHASE1-SPEC.md` §5) — including the typed `APPROVE` for high-impact.
   Declining at either gate does nothing.
4. **No autonomous action.** Jarvie never executes without a fresh, explicit confirmation for
   that specific proposal. No queuing, no "do all of these", no "and while you're at it".
5. **Still local-first.** No network, no Claude/OpenAI API, no Stronghold, no Rust changes, no
   new dependency, no schema/migration. (Phase C, §11.)
6. **Deterministic command parsing.** A fixed grammar (§5). Anything imperative that doesn't
   match is met with "I can do these:" — never a guessed action.
7. **No persona.** Plain confirmation text. `PHASE1-SPEC.md` §11 still holds.

---

## 3. Architecture

```
src/screens/jarvie.js
  ├─ imports jarvie.js      → answerQuestion(text, {since, context})   [read, Phase A + §7/§8]
  └─ imports jarvieAct.js   → parseCommand(text, context) → proposal | null
                              describeProposal(proposal)   → card model
                              executeProposal(proposal)    → runs the real action  [§6]
src/lib/jarvie.js      unchanged import boundary (queries.js only). + conversation-context
                       accessors (§7), + "since" window handling (§8). Still no writes.
src/lib/jarvieAct.js   NEW. imports actions.js + risk.js + jarvie.js's entity resolver.
                       parseCommand(text, entityId?) → a proposal / error / disambiguation
                       object with the card model (title, lines, tier) already filled in
                       (describeProposal is folded into it). executeProposal(proposal) is the
                       only mutating call and only runs when handed a proposal token the user
                       has confirmed; stale/replayed tokens are rejected.
```

- `src/lib/jarvie.js` exports a small conversation context (`getContext()`, `noteEntity(ref)`,
  `noteIntent(name)`, `clearContext()`) — module-level state, session-scoped, no persistence.
- `src/lib/jarvie.js` exports `resolveEntity(phraseOrRef, context)` so `jarvieAct.js` reuses the
  exact same name-matching rules as Phase A (§5.3 of `JARVIE-PHASE-A.md`).
- `src/screens/jarvie.js` owns the "since I last looked" timestamp in `localStorage`
  (`jarvie:lastSeen`) — renderer-local, per-machine, **not** Command Center state, so the
  Single-Writer Boundary (`PHASE1-SPEC.md` §2) is untouched.

No new migration, dependency, capability, or Rust code.

---

## 4. Ask flow (Phase B)

On each question the screen does, in order:

1. `parseCommand(text, context)` → if it returns a **proposal**, render the proposal card
   (§6) and stop.
2. otherwise `answerQuestion(text, { since, context })` → render the answer (Phase A), and if it
   resolved an entity, `noteEntity()` it for follow-ups.
3. a proposal that needs disambiguation ("advance frederick to paths" when "frederick" matches
   several) renders the same "did you mean" candidate chips Phase A uses; picking one re-runs the
   command bound to that id.

---

## 5. Command grammar (Phase B)

Case-insensitive. `<entity>` is resolved by the Phase A matcher (or the conversation context for
"it"/"that"/"this"/"that one"/"them"). Unmatched → capability list.

| Command | Action called | Tier |
|---|---|---|
| `advance <door mission> to <step>` · `move <mission> to <step>` · `advance <mission>` (→ next step) | `AdvanceDoorStage` | external/write (high-impact for `complete`) |
| `advance <project> to <stage>` · `advance <project>` (→ next stage) | `AdvanceProductionStage` | external/write (high-impact for `launch`) |
| `mark <handoff> in progress` · `start <handoff>` | `UpdateHandoffStatus` (`in_progress`) | external/write |
| `submit <handoff> for audit` | `SubmitForAudit` | external/write |
| `approve <handoff>` | `ApproveChange` | high-impact (typed APPROVE) |
| `reject <handoff>` | `RejectChange` | high-impact (typed APPROVE) |
| `create task "<title>" [for <project>] [priority low\|normal\|high\|urgent] [due YYYY-MM-DD]` · `add task …` | `CreateTask` | reversible local |
| `complete task <task>` · `finish <task>` · `mark <task> done` | `CompleteTask` | reversible local |
| `capture <free text>` · `note: <free text>` | `CaptureInboxItem` | reversible local |
| `add client "<name>" [status prospect\|active\|archived]` | `CreateClient` | reversible local |
| `set <client> status prospect\|active\|archived` | `UpdateClient` | reversible local |
| `pause <project>` · `resume <project>` · `set <project> status active\|paused\|complete` | `UpdateProjectStatus` | reversible local |

Step / stage names accept spaces or underscores and are validated against the real enums
(`DOOR_STEPS`, `PRODUCTION_STAGES`). An invalid step/stage → "valid steps are: …", no proposal.
`create task` requires the title in quotes; unquoted → "put the task title in quotes".

Not in Phase B (still §11 / Phase A deferral): `CreateProject`, `CreateHandoff`,
`ConvertInboxItem`, `UpdateDoorBriefField`, `CreateArtifact`, `RecordAuditResult`,
`DismissInboxItem`, `UpdateTask` (beyond complete). Add later only with a written note.

---

## 6. Proposal → confirm → execute

`parseCommand` returns:

```js
{
  type: 'proposal',
  actionName: 'AdvanceDoorStage',
  args: { id: 'door-…', toStage: 'paths' },
  tier: 'external_write', tierLabel: 'External / write',
  title: 'Advance “Frederick Legacy Law” to PATHS',
  lines: ['Digital Door planning step: customer → paths', 'This is an external/write action and will be logged.'],
  entityRef: { kind:'door_brief', id:'door-…', label:'Frederick Legacy Law', goTo:'door' },
}
```

The screen renders it as a card: title, the `lines`, the tier badge, and **PROPOSE** / **CANCEL**.

- **CANCEL** → discard, nothing happens.
- **PROPOSE** → `executeProposal(proposal)`:
  - calls the named function in `actions.js` with `args`.
  - that function runs its own validation + `confirmGate` (for external/write and high-impact —
    the second gate, unchanged) + the single mutating statement whose trigger writes the
    `ActivityEvent`.
  - if the action's own gate is declined → `ActionDeclinedError` → Jarvie shows
    "Cancelled — no changes were made." (same as the rest of the app).
  - on success → Jarvie shows a confirmation ("Done. …") and a link to the affected screen, and
    updates conversation context.

`executeProposal` refuses any object it did not itself produce this session (it holds proposals
in a private map keyed by a random token; the card carries the token, not a live closure) so a
stale card can't be replayed after data changed underneath it.

---

## 7. Conversation context (deterministic, session-only)

- `context = { lastEntityRef, lastIntent }`, module state in `jarvie.js`.
- Set whenever a question or command successfully resolves an entity.
- `resolveEntity` treats `it` / `that` / `this` / `that one` / `them` / `the same` as
  `context.lastEntityRef`; if context is empty → "I don't have a 'that' yet — name it once."
- `and its tasks` / `and its projects` / `what about its …` → pivot from `lastEntityRef` to the
  matching *where does X stand* rollup.
- Cleared on `goTo` away from the screen and on app reload. Never persisted, never logged.

No pronoun resolution beyond this list. No coreference model, no history replay.

---

## 8. "Since I last looked"

- `localStorage['jarvie:lastSeen']` — ISO timestamp, renderer-local.
- On each mount of the Ask Jarvie screen: read it as `prev`, then immediately write `now`.
  For the rest of that visit, "what changed since I last looked" / "since last time" / "while I
  was gone" use `prev` as the window start.
- `prev` missing (first run) → behave as the 7-day window and say so.
- This is the only new persisted value and it is **not** database state — it never crosses the
  action layer and is invisible to `activity_event`, backup, and every other viewer.

---

## 9. Files touched

| File | Change |
|---|---|
| `src/lib/jarvieAct.js` | **new** — command grammar, proposal builder, `executeProposal`. The only Jarvie file that imports `actions.js`/`risk.js`. |
| `src/lib/jarvie.js` | + conversation-context accessors, + `resolveEntity` export, + "since" window in `windowFromQuestion`, + `it/that` handling. Still imports only `queries.js`; still no writes. |
| `src/screens/jarvie.js` | ask flow tries `parseCommand` first; renders proposal cards with PROPOSE/CANCEL; tracks context; owns `jarvie:lastSeen`; adds a "What changed since I last looked?" chip. |
| `docs/DECISIONS.md` | "Jarvie Phase B" entry. |

**Not touched:** any migration, `actions.js`, `risk.js`, `db.js`, `queries.js` write surface,
Rust, capabilities, `package.json`.

---

## 10. Explicit Acceptance Criteria

- [ ] Every Phase A intent still works unchanged; `jarvie.js` still imports only `queries.js`.
- [ ] Each command in §5 produces a correct proposal (right `actionName`, right `args`, right
      tier) on a seeded DB, and executes the real action on confirm — verified by the ActivityEvent
      the action's trigger writes.
- [ ] **CANCEL, or declining the action layer's own gate, writes nothing** (row counts + event
      count unchanged).
- [ ] A proposal card left un-confirmed writes nothing; a stale/replayed proposal token is
      rejected.
- [ ] High-impact commands (`approve`, `reject`, `advance … to complete/launch`) still hit the
      typed-`APPROVE` gate.
- [ ] Invalid step/stage/status, missing quotes, or unknown entity → a helpful message, no
      proposal, no write.
- [ ] "why is it blocked" after resolving an entity uses the remembered entity; leaving the
      screen clears it.
- [ ] "what changed since I last looked" uses the stored timestamp; first run falls back to 7
      days; the timestamp is `localStorage`, not the DB.
- [ ] No network call anywhere; no new migration/dependency/Rust/capability change.
- [ ] `npm run build` passes; verified with the headless harness on a seeded DB.
- [ ] No persona/voice/mascot.

---

## 11. Phase C — Claude API (SCOPED, NOT BUILT)

Phase C makes Jarvie's *phrasing* and *intent understanding* smarter with the Claude API, without
loosening any safety property.

**Prerequisites (the real cost — this is the secrets-boundary phase):**
- Stronghold read/write wiring + Rust `#[tauri::command]` handlers so the API key is set and used
  behind the native boundary and never reaches renderer JS (`docs/DECISIONS.md` "Secrets stay
  outside renderer code").
- `tauri.conf.json` CSP `connect-src` += `https://api.anthropic.com`; a capability grant for the
  new command(s); a key-entry UI in Integrations.
- Model per `claude-api` guidance at build time; sensible default to the latest Claude model.

**What Phase C changes:**
- **Prose answers** — `jarvieLLM.js` (renderer) sends `{ question, intent, records }` — the
  facts Phase A/B *already retrieved* — to a Rust command that calls Claude, and swaps the
  deterministic `summary` for the model's phrasing. It never gets raw DB access and never issues
  queries; retrieval stays deterministic and local.
- **Fuzzy intent** — the model maps a free-form question to one of the existing deterministic
  intents *or* to one command in the §5 grammar with structured args. Its output is validated
  against the same enums/resolvers; anything off-grammar is refused, not executed.
- **Still propose → confirm → execute.** The model may *fill in* a proposal; it can never
  execute one. No autonomous action, ever.

**What Phase C still defers:** voice, tray panel, persona/mascot, multi-user, autonomous
dispatch, any action beyond the §5 grammar, background/proactive Jarvie.

---

## 12. Still deferred (Phase D+ / never)

- Voice, tray panel, ambient/proactive presence, persona, mascot, animation (`PHASE1-SPEC.md`
  §11).
- Autonomous or batched action execution without a per-action human confirmation.
- Multi-user / cloud sync.
- Jarvie reading/acting on anything outside SQLite (email, calendar, GitHub, domains, money)
  until those integrations exist.

---

**Reconciliation note.** Phase B keeps every Phase A guarantee and adds acting *through the
existing action layer* — the seam `PHASE1-SPEC.md` §1/§4 was built for. It introduces one new
file that may write, one localStorage key that is not DB state, and no schema/dependency/Rust
change. The risk model (§5) is unchanged and now gates Jarvie exactly as it gates the UI. Phase C
(§11) is the Claude-API/secrets-boundary phase and is deliberately separate.
