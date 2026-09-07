# Jarvie — Phase D Scoping Spec (DRAFT for approval)

**Status:** Draft. Not approved for build. Written for Nev to review, then hand to a build
session the way A/B/C were.
**Scope discipline:** one build session. **Pure deterministic deepening — no model, no network,
no key, no new dependency, no migration.** Phase C stays exactly as it is: optional, off by
default, untouched.
**Builds on:** `docs/JARVIE-PHASE-A.md` (5 read-only intents), `-B.md` (command grammar +
propose → confirm → execute), `-C.md` (optional Claude layer). Everything in A/B/C keeps
working unchanged.

---

## 1. What Phase D adds

Jarvie gets **wider and deeper**, entirely from the local database:

1. **Reasoning depth** — `why is X blocked?` traces the actual blocking chain (a paused parent,
   a gating stage, open child tasks, an audit verdict) instead of naming one transition.
   `where does X stand?` gives an exhaustive descendant rollup.
2. **Two new intents** — `whats_next` (what's due / on deck this week) and `quiet_clients`
   (active clients with no activity in a while).
3. **Seven new commands** — `create project`, `hand off … to …`, `triage <inbox> as …`,
   `dismiss <inbox>`, `set <task> priority …`, `set <task> due …`, `rename <task> to …`.
4. **A Jarvie brief on Today** — one deterministic headline + the single most important next
   action, synthesised from the same builders.

If Phase C happens to be enabled, the new intents and verbs are automatically part of its
fuzzy-routing vocabulary (`capabilityManifest()` / `grammarManifest()`); if it's disabled — the
default — none of this touches it.

---

## 2. Non-negotiables

1. **Deterministic and local.** No LLM call, no `fetch`, no key, no paid service. Every answer
   is template-filled from `queries.js` results.
2. **Questions stay read-only and unlogged** (`PHASE1-SPEC.md` §5, Safe read).
3. **Commands stay propose → confirm → execute** through the existing action layer, with the
   action layer's own `confirmGate` unchanged. Every new verb maps to an action that already
   has a risk tier in `risk.js` — no `risk.js` change.
4. **No new dependency, migration, Rust code, capability, or CSP change.**
5. **Phase C is not modified.** `jarvie_llm*.rs`, `jarvieLLM.js`, and the Ask-Jarvie Claude card
   are untouched; Phase C remains off unless a key *and* the toggle are both set by hand.
6. **`jarvie.js` still imports only `queries.js`.** `jarvieAct.js` stays the only writer.
7. **No persona.** Plain text.

---

## 3. Architecture

| File | Change |
|---|---|
| `src/lib/jarvie.js` | + `INTENT_RULES` entries and builders for `whats_next` / `quiet_clients`; deeper `buildWhyBlocked` / `buildWhereStands`; `inbox_item` added to `KIND_META`; new `todayBrief()` export; `FORCEABLE_INTENTS` / `capabilityManifest()` gain the two names. Still `queries.js`-only. |
| `src/lib/jarvieAct.js` | + grammar rules for the seven verbs; `grammarManifest()` + `commandObjectToString()` extended; a small worker-name matcher. |
| `src/lib/queries.js` | + `listTasksDueBetween({ from, to, includeDone })` — one read-only `SELECT`. |
| `src/screens/today.js` | + a "JARVIE" card (headline + top action + "ASK JARVIE" button) from `todayBrief()`. |
| `src/screens/jarvie.js` | one extra suggested-question chip. |
| `docs/DECISIONS.md` | "Jarvie Phase D" entry. |

Not touched: migrations, `risk.js`, `actions.js`, `confirm.js`, anything under `src-tauri/`,
`package.json`, capabilities, the CSP, and all of Phase C.

---

## 4. Deeper reasoning

### 4.1 `why is X blocked?` — the blocking chain

Given a resolved entity, build an **ordered list of "blocked by" reasons**, most-proximate
first. Each is a rule over columns that already exist.

| Entity | Chain (stop at the first that applies, then add context) |
|---|---|
| **task** | `done` → not blocked. Parent project `paused` → "its project *P* is paused". Overdue → "overdue since *date* — needs you". `doing` → "in progress — needs finishing". else → "not started". |
| **project** | `complete` → done. `paused` → "you paused it". else the gate is the **next `production_stage`** — and add: (a) open/doing tasks under it (`listTasks`), named; (b) if the next stage is `qa_audit` / `client_approval` / `launch` and a linked handoff is `returned`, "a handoff is back for your review"; (c) if the next stage is `digital_door` / `owner_digital_key` and no artifact of the matching `type` is linked (`listArtifacts({relatedProjectId})`), "no *type* artifact recorded yet". |
| **door_brief** | `complete` → done. else next `planning_step`, plus which of that step's fields are still blank (reuse the field map from `where_stands`). |
| **handoff** | `accepted`/`rejected` → closed. `pending` → "not picked up yet". `in_progress` → "work in progress, then Submit for audit". `returned` → look for a linked `audit_report` artifact (`listArtifacts` by `related_handoff_id`): surface its verdict — "audit: FIX REQUIRED — *notes*" or "audit passed — waiting on your Approve / Reject". |
| **client** | `prospect` → "move it to active". else roll up its projects: "*k* of *n* projects are blocked" + the blocked ones as evidence rows. |

`title` = "*label* — blocked by *top reason*". `summary` = the chain in a sentence.
`evidence` = one linkable row per hop.

### 4.2 `where does X stand?` — exhaustive rollup

| Entity | Rollup |
|---|---|
| **client** | status · projects by status · total open tasks across them · door briefs by step · handoffs by status · "last activity *date*" (most recent `activity_event` on the client or any descendant). Every project/brief/handoff as an evidence row. |
| **project** | status · production stage · tasks open/doing/done · linked artifact count · handoffs by status · last activity. |
| **door_brief** | planning step · *k*/*n* fields filled · the blank fields named · linked client. |
| **handoff** / **task** | as today, plus last-activity date. |

"Last activity" is computed from `listActivityEventsForEntity` for the entity, plus its
children's ids — deterministic, one extra read per rollup.

---

## 5. New intents

### 5.1 `whats_next`
- **phrases:** "what's next", "what's coming up", "what's due", "what's on deck", "what should
  I do next", "anything due this week", "this week".
- **data:** `listTasksDueBetween({ from: today, to: today+7, includeDone: false })` sorted by
  `due_date`; **excludes overdue** (those belong to `needs_me` / `whats_stalled`). Plus door
  briefs with `updated_at` in the last 3 days and `planning_step != complete` ("in motion").
- **answer:** "*n* things due in the next 7 days" / "Nothing due this week." + the rows.

### 5.2 `quiet_clients`
- **phrases:** "which clients are quiet", "who needs a check-in", "quiet clients", "who have I
  been ignoring", "stale relationships", "anyone I've been neglecting".
- **data:** `listActivityEventsSince({ since: now-14d })` → the set of entity ids touched →
  map each to its client (`related_entity_id` → entity → `client_id`). **Active** clients
  (`status='active'`) not in that set are "quiet".
- **answer:** "*n* active clients have had no activity in 14+ days" / "Every active client has
  recent activity." + the client rows, each showing days since last touch.

Both names are added to `FORCEABLE_INTENTS` and `capabilityManifest()`.

---

## 6. New commands

Case-insensitive; `<X>` resolved by the Phase A matcher (with the kind filter shown). Each maps
to an action that already has a `risk.js` tier.

| Command | Action · tier |
|---|---|
| `create project "<title>" for <client> [type <type>]` | `CreateProject` · reversible local |
| `hand off "<objective>" to <worker> [from <worker>]` | `CreateHandoff` · external/write (confirmGate) |
| `triage <inbox item> as task [for <project>]` · `as project [for <client>]` · `as client` | `ConvertInboxItem` · reversible local |
| `dismiss <inbox item>` | `DismissInboxItem` · reversible local |
| `set <task> priority low\|normal\|high\|urgent` | `UpdateTask` · reversible local |
| `set <task> due YYYY-MM-DD` | `UpdateTask` · reversible local |
| `rename <task> to "<title>"` | `UpdateTask` · reversible local |

- `<worker>` fuzzy-maps to the `WORKERS` enum: "claude code" → `claude_code`, "chatgpt" →
  `chatgpt`, "cowork" → `claude_cowork`, "claude" → `claude`, "nev" → `nev`. Unknown → error
  listing the workers.
- `<inbox item>` resolves against `inbox_item.raw_text` (new `KIND_META` entry, `goTo: 'inbox'`).
- The Phase B `set … status …` rule stays; Phase D's `set … priority/due …` is additional.
- Invalid worker / priority / date / missing quotes → a helpful message, no proposal, no write
  (same as Phase B).

`grammarManifest()` and `commandObjectToString()` gain these verbs so Phase C fuzzy-routing
can reach them when it's on.

---

## 7. The Jarvie brief on Today

A new card at the top of the Today screen (above the three metric cards):

- **`jarvie.js` exports `todayBrief()`** → `{ headline, top }` built by running `buildNeedsMe`,
  `buildWhatsNext`, `buildQuietClients`, `buildWhatsStalled` and composing counts into one
  sentence, then picking the single highest-priority item by this fixed order:
  **returned handoff → overdue task → task due within 2 days → quiet client → mid-stage brief**.
- **Render:** the headline sentence, "Start with: *item*", and an `ASK JARVIE` button
  (`goTo('jarvie')`). If everything is clear: "Nothing is waiting on you and nothing is due
  this week."
- Pure read, no writes, no LLM. `today.js` imports `todayBrief` from `jarvie.js`.

Redundancy note: Today already lists high-priority tasks / mid-stage briefs / awaiting
approval. The brief adds the one-sentence synthesis and the *single* first action — it does not
duplicate the lists.

---

## 8. Files touched

`src/lib/jarvie.js`, `src/lib/jarvieAct.js`, `src/lib/queries.js` (one helper),
`src/screens/today.js`, `src/screens/jarvie.js` (one chip), `docs/DECISIONS.md`.
**Nothing under `src-tauri/`. No `package.json`, `risk.js`, migration, or capability change.**

---

## 9. Explicit Acceptance Criteria

- [ ] `why is X blocked?` returns an ordered chain: a paused parent, the gating stage with its
      open child tasks named, and a `returned` handoff's audit verdict when there is one.
- [ ] `where does X stand?` for a client rolls up every project, brief, and handoff plus a
      last-activity date.
- [ ] `whats_next` lists only not-yet-overdue tasks due within 7 days, sorted; `quiet_clients`
      lists only `active` clients with no activity in 14+ days; both handle the empty case.
- [ ] Each of the seven new commands produces a correct proposal and executes the right action
      on confirm; CANCEL / declining the gate writes nothing; `hand off …` still hits the
      external/write gate; bad worker / priority / date → a message, no write.
- [ ] The Today "JARVIE" card shows a correct one-sentence synthesis + the single top action,
      and reads nothing but the database.
- [ ] Phase A/B regression: all existing intents, commands, conversation, and "since I last
      looked" unchanged.
- [ ] **Phase C untouched:** with no key and the toggle off (the default), behaviour is
      identical to a build without Phase C; `grep` shows no new `fetch`/network in `src/`.
- [ ] `npm run build` passes; verified on a seeded DB via the headless harness. No `cargo`
      build needed (no Rust change).
- [ ] No new dependency, migration, `risk.js` entry, capability, or CSP change.

---

## 10. Deferred (Phase E+ / never)

- A local-model backend for the Phase C prose / fuzzy-intent layer (Ollama / llama.cpp) — the
  free alternative to the Claude API, a phase of its own.
- Any Claude-API deepening (streaming, multi-turn, cross-question summary) — Phase C+, and
  paid; out of scope while "no paid-service integrations" holds.
- `keyring` for the Phase C key file.
- Voice, tray, persona, proactive/scheduled Jarvie — still `PHASE1-SPEC.md` §11.
- New commands beyond the seven here (e.g. `CreateArtifact`, `RecordAuditResult`,
  multi-field task edits in one command) — add later with a written note.

---

**Reconciliation note.** Phase D is the same shape as A and B — deterministic builders over
`queries.js`, commands through the existing action layer and risk gates — just more of it, plus
a synthesis card on Today. It adds no entity, action, migration, dependency, or network call,
and it leaves the optional Phase C layer exactly as it is.
