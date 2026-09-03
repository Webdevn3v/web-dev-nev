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
