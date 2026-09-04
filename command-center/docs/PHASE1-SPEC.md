# The Digital Side Command Center — Phase 1 Technical Specification
**Status:** Approved for build. Hand directly to Claude Code.
**Scope discipline:** Everything in this doc must be finishable in one build session. Anything tempting beyond this is explicitly flagged as deferred at the bottom — do not pull it forward.

---

## 1. Core Principle

Nev → Command Center → correct worker/tool → work → audit → approval → deploy

The Command Center is the only source of truth. Jarvis does not exist yet in Phase 1 — but the **seam** Jarvis will later plug into gets built now, so nothing has to be re-architected later.

---

## 2. Single-Writer Boundary (locked wording)

> Only the Command Center application's data layer may mutate Command Center state. External AI/tools (ChatGPT, Claude, Claude Code, Claude Cowork) can propose actions and return results, but never directly edit the SQLite database.

Claude Code builds/edits source code. It does not hand-edit `.db` files, write raw SQL against the live database outside the app's own data layer, or bypass the action layer described below.

---

## 3. Entities & Relationships

| Entity | Purpose | Key fields |
|---|---|---|
| **Client** | A business/person Nev works with | id, name, contact info, status (prospect/active/archived), created_at |
| **Project** | A body of work for a Client | id, client_id (FK), title, type, status, created_at |
| **Task** | A unit of work under a Project (or standalone) | id, project_id (FK, nullable), title, status, priority, due_date, created_at |
| **DigitalDoorBrief** | One Digital Door production run | id, client_id (FK), stage (enum matching the 12 pipeline stages), fields per stage (urgentNeed, customerIntent, build pieces, notes, etc.), created_at, updated_at |
| **Artifact** | Something work *produced* | id, type (repo/branch/file/screenshot/live_url/digital_door/owner_key/proposal/audit_report), reference (path/URL), related_task_id (FK, nullable), related_project_id (FK, nullable), created_at |
| **Handoff** | Structured work request between workers | id, from_worker, to_worker, objective, context, constraints, inputs, outputs, acceptance_criteria, status (pending/in_progress/returned/accepted/rejected), created_at, updated_at |
| **ActivityEvent** | Append-only log of meaningful system events | id, event_type, related_entity_type, related_entity_id, actor (nev/chatgpt/claude/claude_code/system), payload (JSON), created_at |
| **IntegrationRecord** | What's actually connected | id, service_name, connection_type (automated/manual), status, notes |
| **InboxItem** | Raw capture before triage | id, raw_text, status (untriaged/converted/dismissed), converted_to_entity_type, converted_to_entity_id, created_at |

**Relationships:** Client → many Projects → many Tasks. Project/Task → many Artifacts. Task/Project can spawn Handoffs. Every entity mutation emits an ActivityEvent. `Today` and `BusinessHealth` are **views**, not tables — computed from the entities above at read time, never written to directly.

---

## 4. Action Layer (the Jarvis seam)

All state mutation goes through named, validated actions — never direct DB writes from UI or elsewhere. This is the single most important piece of Phase 1 for future-proofing.

**Phase 1 action set (minimum):**
- `CreateClient`, `UpdateClient`
- `CreateProject`, `UpdateProjectStatus`
- `CreateTask`, `UpdateTask`, `CompleteTask`
- `AdvanceDoorStage`, `UpdateDoorBriefField`
- `CreateArtifact`
- `CreateHandoff`, `UpdateHandoffStatus`
- `SubmitForAudit`, `RecordAuditResult`
- `ApproveChange`, `RejectChange`
- `CaptureInboxItem`, `ConvertInboxItem`, `DismissInboxItem`

Each action: (1) validates input against the entity schema, (2) performs the mutation via the data layer, (3) emits an `ActivityEvent`. Regular UI calls these actions directly. Later, Jarvis calls the *exact same* actions after interpreting natural language — no separate mutation path is ever built for it.

---

## 5. Approval / Risk Model

Every action is tagged with a risk tier, enforced at the action layer:

| Tier | Examples | Approval needed |
|---|---|---|
| **Safe read** | View Today, view Client, search | None |
| **Reversible local** | CreateTask, CaptureInboxItem, UpdateTask | None — logged, undoable |
| **External/write** | AdvanceDoorStage, CreateArtifact, CreateHandoff | Confirm in UI |
| **High-impact** | ApproveChange, Launch-stage transitions, anything touching a live client asset | Explicit approval step, logged as its own ActivityEvent |

This model exists in Phase 1 for the regular UI already — it's not Jarvis-specific, but it's the exact gate Jarvis will have to respect later.

---

## 6. Migration Approach

- Versioned, numbered SQL migration files (`001_init.sql`, `002_...`), applied in order, tracked in a `schema_version` table.
- No manual schema edits outside a migration file — including by Claude Code.
- Each migration is additive where possible; destructive changes require a written note in the migration file explaining why.

---

## 7. Backup & Recovery

Encrypted export alone is insufficient — needs a recovery path that survives the laptop dying:

- **Export:** manual "Export Backup" action produces an encrypted archive (SQLite file + Stronghold vault) with a timestamp.
- **Recovery key handling:** the recovery key/passphrase must be stored *outside* the laptop — explicitly surfaced to Nev on first run with instructions to save it somewhere physically separate (password manager, printed, etc.). The app should not let backup be treated as "done" without this step being acknowledged.
- **Restore:** a "Restore from Backup" flow that rebuilds the DB + vault from an exported archive on a fresh machine.
- Phase 1 acceptance requires this round-trip to actually be tested once (export → wipe/reinstall → restore → data intact).

---

## 8. Activity/Event Log

Append-only. Every action emits an event: task created, build started, artifact created, submitted for audit, audit failed, revision requested, approved, deployed, integration failed, backup created, etc. This is what later powers Jarvis answering "what changed," "why is this blocked," "what needs me" — but in Phase 1 it's just a plain log view, no inference yet.

---

## 9. Phase 1 Screens/Features

1. **Today** — derived view: open high-priority tasks, active Door briefs mid-stage, anything awaiting approval
2. **Clients + Projects** — CRUD, list/detail
3. **Tasks** — CRUD, linked to project or standalone
4. **Digital Door pipeline** — the 12-stage workflow, using AdvanceDoorStage/UpdateDoorBriefField actions (already partly built — bring into this schema)
5. **Inbox** — capture raw text, manually triage/convert to Task/Project/etc.
6. **Handoffs (AI Desk)** — manual creation/viewing of Handoff records between Nev/ChatGPT/Claude/Claude Code — no auto-routing
7. **Activity Log** — plain chronological view, filterable by entity
8. **Business Health** — derived view: read-only checks against real entity data (e.g., overdue tasks, stalled Door briefs)
9. **Integrations registry** — explicit list of what's connected (automated) vs. manual, per IntegrationRecord
10. **Backup/Restore** — export, recovery key acknowledgment, restore flow
11. **Search** — basic entity search across Clients/Projects/Tasks/Artifacts

---

## 10. Explicit Acceptance Criteria

- [ ] All entities above exist in schema with migrations, version-tracked
- [ ] No UI or code path mutates SQLite except through the named action layer
- [ ] Every action in §4 is implemented, validated, and emits an ActivityEvent
- [ ] Approval tiers in §5 are enforced (external/write and high-impact actions require confirmation)
- [ ] Today and Business Health are computed views with no dedicated storage/duplication
- [ ] Digital Door wizard uses distinct state keys per step (regression check on the bug already fixed)
- [ ] Backup export → restore round-trip tested successfully once
- [ ] Recovery key acknowledgment step exists and cannot be silently skipped
- [ ] Activity Log displays real events from real actions, chronological, filterable
- [ ] App icons exist and a Windows installer builds successfully
- [ ] `.gitignore` and `package-lock.json` remain in place (already done — verify not regressed)
- [ ] No integration is shown as "connected" unless it is genuinely automated (per IntegrationRecord)

---

## 11. Explicitly Deferred (do not build in Phase 1)

- Jarvis itself — no NL interpretation, no routing suggestions, no chat interface
- Voice, tray panel, ambient presence, any persona/character behavior
- Autonomous dispatch of actions without a human in the loop
- Any visual mascot, animation, or "Come Alive"-style UI polish
- Automated integrations beyond what's on the explicit automatable list (define that list separately before Phase 2)
- IP Vault, Watchtower monitoring, Money/Launch Fund, Goals/Runway — real features, later phases
- Multi-user/cloud sync of any kind — stays local-first and single-user

---

**Reconciliation note:** This spec fully incorporates ChatGPT's seven additions (action layer, single-writer wording, Artifact/Handoff entities, broadened event log, derived views, backup+recovery pairing, risk-tiered approval) on top of the original foundation review (locked data model, migrations, single-writer rule, structured handoffs, audit trail, explicit integration list). No disagreements remain between the two reviews — this is the merged version.