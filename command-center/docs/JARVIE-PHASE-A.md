# Jarvie — Phase A Scoping Spec

**Status:** Approved 2026-09-06. Built the same day — see `docs/DECISIONS.md`
("Jarvie Phase A") and the acceptance run in §9. One deviation from this text was taken during
the build: evidence-link `goTo` targets are any valid nav id (`inbox`/`health` included), not
only the five in §6's example enum — otherwise untriaged-inbox evidence couldn't link anywhere.
**Scope discipline:** Everything here must be finishable in one build session. Anything past
that is flagged as deferred at the bottom — do not pull it forward.
**Naming:** the product name is **Jarvie**. `PHASE1-SPEC.md` §1/§4 calls the same thing
"Jarvis" (the seam). This doc standardizes on *Jarvie* for the feature and keeps *the action
layer* as the untouched seam it already is.

---

## 1. What Phase A is

Phase A makes Jarvie a **read-only question answerer over the system of record**. It answers,
from live data only:

- *What changed?* (today / last 7 days / last 30 days)
- *What needs me?*
- *Why is `<X>` blocked?* / *What is `<X>` waiting on?*
- *Where does `<X>` stand?*
- *What's stalled or at risk?*

Nothing else. It is the first concrete cut of the capability `PHASE1-SPEC.md` §8 describes
("what later powers Jarvis answering 'what changed,' 'why is this blocked,' 'what needs me'"),
with **no inference beyond deterministic rules** and **no mutation of any kind**.

Phase A is explicitly *not* a chat interface, not NL-via-LLM, not action-taking. Those are
Phase B+ (§10).

---

## 2. Non-negotiable constraints

1. **Read-only.** Jarvie never writes to SQLite, never calls `src/lib/actions.js`, never emits
   an `ActivityEvent`. Asking a question is a *Safe read* (`PHASE1-SPEC.md` §5 → approval:
   None) and, like every other read, is not logged. A build that "helpfully" logs questions is
   wrong.
2. **Local-first, no new integrations.** No Claude API, no OpenAI API, no network. No
   Stronghold/secret work, no new `#[tauri::command]` handlers, no capability changes. (All
   still deferred per `docs/DECISIONS.md`.)
3. **Retrieval is deterministic.** Answers are built by fixed rules from query results. Jarvie
   does not generate free-form text about system state in Phase A. If a later phase adds an LLM,
   it may only *phrase* facts that deterministic retrieval already pulled — never fetch state
   itself (§6).
4. **No persona.** No voice, mascot, animation, "Come Alive" polish, or character behavior
   (`PHASE1-SPEC.md` §11 still holds). Plain answer text.
5. **No schema change, no new dependency.**

---

## 3. Where Jarvie sits

```
src/screens/jarvie.js   (NEW)  UI: question box, suggested questions, answer panel
        │  imports
        ▼
src/lib/jarvie.js       (NEW)  intent match + answer builders (pure, deterministic)
        │  imports  (ONLY)
        ▼
src/lib/queries.js             read-only query layer  ── getDb().select ──▶ SQLite
```

- `src/lib/jarvie.js` imports **only** from `src/lib/queries.js`. It must not import
  `actions.js`, must not import `db.js`, must contain no `.execute(`.
- `src/screens/jarvie.js` follows the existing screen pattern (`setHeader`, `view().innerHTML`,
  handlers wired after render) and uses the existing `goTo(id)` router for evidence links. It
  imports `jarvie.js` + `ui.js` only.
- `src/lib/queries.js` gains small read-only helpers (§4). No writes, no schema change.
- `src/main.js` adds one nav entry `['jarvie', 'ASK JARVIE']` in the **PHASE 1** group (next to
  Activity Log) and `jarvie: () => renderJarvie(goTo)` to `SCREENS`.

---

## 4. The Phase A question set

Each intent is a fixed rule with a named data source. "`<X>`" is an optional entity reference
resolved by §5.

| # | Question forms | Data source (all read-only) | Answer |
|---|---|---|---|
| **1. What changed** | "what changed", "what happened", "recent activity", "what's new" (+ optional "today" / "this week" / "this month") | `activity_event` in the time window (new `listActivityEventsSince`) | Digest: total count + a breakdown by `event_type`, then the events newest-first, each linking to its entity's screen. Default window: last 7 days. |
| **2. What needs me** | "what needs me", "what's waiting on me", "my queue", "what should I do" | `getTodayView()` (`highPriorityTasks`, `awaitingApproval`) + `getBusinessHealth()` (`untriagedInbox`, `overdueTasks`) | Prioritized list: (a) handoffs `returned` — blocking approvals, (b) overdue tasks, (c) open high/urgent tasks, (d) untriaged inbox. Counts + rows + links. "Nothing is waiting on you." when empty. |
| **3. Why is `<X>` blocked** | "why is `<X>` blocked", "what is `<X>` waiting on", "why is `<X>` stuck" | entity record + its `activity_event` history (new `listActivityEventsForEntity`) | Current status/stage, the last few events with timestamps, and the **next transition it's waiting on**, derived by rule (§4.1). If `<X>` isn't found or is ambiguous → §5 behavior. |
| **4. Where does `<X>` stand** | "where does `<X>` stand", "status of `<X>`", "how is `<X>` going", "catch me up on `<X>`" | entity record + linked children via `queries.js` + last 3 events | Key fields, child rollup (Project → tasks open/done; Client → project count by status; Door brief → planning step + filled vs empty fields), last 3 events. |
| **5. What's stalled** | "what's stalled", "what's at risk", "what's slipping", "anything overdue" | `getBusinessHealth()` verbatim | Narrated passthrough: overdue tasks, Door briefs idle 7+ days, handoffs stale 3+ days, untriaged inbox — counts + rows + links. |
| **fallback** | anything unmatched | — | "I can answer these:" + the five suggested questions as clickable chips. Never a guess, never a fabricated answer. |

### 4.1 "Waiting on" rules (intent 3), deterministic

| Entity | State | Waiting on |
|---|---|---|
| Handoff | `pending` | being picked up → "Mark in progress" on AI Desk |
| Handoff | `in_progress` | work + "Submit for audit" |
| Handoff | `returned` | **your** Approve / Reject (this is a *needs-me* item too) |
| Handoff | `accepted` / `rejected` | nothing — closed |
| Project | `production_stage` ≠ `launch` | next stage advance (name the next stage) |
| Project | `status` = `paused` | you to un-pause it |
| Door brief | `planning_step` ≠ `complete` | next planning step (name it) |
| Task | `status` = `open` / `doing`, past `due_date` | it's overdue — you |
| Task | blocked by no rule | "not blocked — just not started/finished yet" |

---

## 5. Intent resolution (Phase A: deterministic)

1. **Normalize** the question (lowercase, trim).
2. **Match intent** by keyword/phrase against the table in §4 (ordered; first match wins).
3. **Extract `<X>`** for intents 3–4: take the text after "is"/"of"/"on"/"about"/quotes and do a
   case-insensitive *contains* match against, in order: client `name`, project `title`, door
   brief `business`, handoff `objective`, task `title`.
   - exactly one hit → use it.
   - multiple hits → answer "Did you mean:" + the candidates as chips (each re-asks the question
     bound to that id).
   - zero hits → "I couldn't find anything called '`<X>`'." + suggested questions.
4. **No intent match** → fallback row in §4.

No fuzzy/semantic matching, no spell-correction, no LLM in Phase A.

---

## 6. Answer shape + the LLM seam (seam only — not built in Phase A)

Every builder in `jarvie.js` returns one shape:

```js
{
  intent: 'what_changed' | 'needs_me' | 'why_blocked' | 'where_stands' | 'whats_stalled' | 'unknown',
  title:   string,                 // deterministic headline, e.g. "3 things are waiting on you"
  summary: string,                 // deterministic, template-filled from counts/names
  evidence: [                      // the records the answer is built from
    { kind: 'task'|'handoff'|'client'|'project'|'door_brief'|'event',
      id: string, label: string, goTo: 'tasks'|'ai'|'clients'|'door'|'activity' }
  ],
  records: object                  // the raw query results, untouched
}
```

The screen renders `title` + `summary` + `evidence` (as links via `goTo`).

**Phase B seam (do not build now):** a later `jarvieAnswerer` could take
`{ question, intent, records }` and replace `summary` with prose / re-rank `evidence`. It would
receive **only `records`** (already-retrieved, deterministic, read-only) and may not issue its
own queries. Retrieval stays deterministic and local; the LLM, if it ever exists here, is a
phraser of retrieved facts, nothing more. This mirrors the single-writer discipline
(`PHASE1-SPEC.md` §2), applied to reads.

---

## 7. The read-only boundary — how it's enforced

- `grep -nE "from '(\./|\.\./lib/)actions|\.execute\(|getDb\(" src/lib/jarvie.js src/screens/jarvie.js`
  → **nothing**. (The bare word "actions" also appears as the shared CSS class `class="actions"`
  and in explanatory comments — the check is on the mutation surface: the `actions.js` import and
  any direct DB call.)
- `jarvie.js` imports exactly `./queries.js`; `screens/jarvie.js` imports exactly
  `../lib/jarvie.js` and `../lib/ui.js`.
- Harness test: snapshot `SELECT count(*) FROM activity_event` and every entity table before and
  after asking each of the five questions → **all unchanged**.
- The existing acceptance grep ("no `.execute(` outside `actions.js`/`db.js`/`migrations.js`")
  keeps passing.

Because retrieval is deterministic, the whole feature is unit-testable with the existing headless
harness (bundled real `src/` + jsdom + a seeded better-sqlite3 DB — see the team's verification
notes). No Tauri runtime needed to verify Phase A.

---

## 8. Files touched

| File | Change |
|---|---|
| `src/lib/jarvie.js` | **NEW** — intent matcher + 5 answer builders + entity resolver. Pure, deterministic, imports only `queries.js`. |
| `src/screens/jarvie.js` | **NEW** — Ask Jarvie screen: question `<input>`, 5 suggested-question chips, answer panel with `goTo` evidence links. |
| `src/lib/queries.js` | Add `listActivityEventsSince({ since, limit })` and `listActivityEventsForEntity({ relatedEntityId, limit })`. Read-only `SELECT`s, no schema change. |
| `src/main.js` | Add `['jarvie', 'ASK JARVIE']` to `NAV` (PHASE 1 group) and `jarvie: () => renderJarvie(goTo)` to `SCREENS`. |
| `docs/DECISIONS.md` | New entry: Jarvie Phase A scope; why read-only; why deterministic-first; why questions are not logged. |

**Not touched:** any migration, `actions.js`, `risk.js`, `db.js`, `confirm.js`, Rust, capabilities,
`package.json`. No new dependency.

---

## 9. Explicit Acceptance Criteria

- [ ] "ASK JARVIE" appears in the nav (PHASE 1 group) and opens a screen with a question box,
      five suggested-question chips, and an answer area.
- [ ] Each of the five intents returns a correct answer built **only** from live query results,
      verified on a seeded DB via the headless harness.
- [ ] Intent 3/4 entity resolution: exact match works; ambiguous match offers candidates; no
      match says so — never fabricates.
- [ ] Unrecognized questions return the capability list + suggested questions, never a guessed
      answer.
- [ ] Every answer lists its evidence, and each evidence item links to the right screen via
      `goTo`.
- [ ] Asking any question writes nothing: `activity_event` count and all entity-table counts are
      identical before and after.
- [ ] `src/lib/jarvie.js` and `src/screens/jarvie.js` import no `actions.js` and make no
      `.execute(` / `getDb(` call (grep in §7); `jarvie.js` imports only `queries.js`.
- [ ] No new migration, dependency, Rust code, or capability change. `npm run build` passes.
- [ ] No persona/voice/mascot/animation; plain answer text.

---

## 10. Explicitly Deferred (Phase B+ — do not build in Phase A)

- **Any LLM / Claude API call** — prose answers, fuzzy or semantic intent matching. Needs the
  deferred Stronghold key handling + Rust command boundary first (`docs/DECISIONS.md`).
- **Conversation** — multi-turn, follow-up questions, chat history, "ask again about that".
- **"Since I last looked"** windows — requires storing a last-seen timestamp, which is a write.
- **Jarvie proposing or taking actions** — that is the action-layer integration
  (`PHASE1-SPEC.md` §4/§5), a later phase; Phase A never touches `actions.js`.
- **Answering over anything not in SQLite** — email, calendar, GitHub status, domains, money.
- **Voice, tray panel, ambient presence, persona, mascot** — still `PHASE1-SPEC.md` §11.

---

**Reconciliation note.** Phase A is consistent with `PHASE1-SPEC.md`: §1 (the seam is the action
layer, untouched here), §4 (no new mutation path), §5 (Safe read, no gate, not logged), §8 (this
is the first read-only cut of "what changed / why blocked / what needs me", with deterministic
rules and no inference). It adds no entity, no action, no migration. The only new runtime code
reads through the existing query layer.
