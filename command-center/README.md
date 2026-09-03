# The Digital Side Command Center — Phase 1

Local-first desktop foundation for The Digital Side.

## Goal

This is not a hosted dashboard. It is the beginning of a Windows desktop command environment: local data first, cloud integrations second, and AI access through explicit capabilities rather than unrestricted machine access.

## Phase 1 scope

- Tauri 2 desktop shell
- Local SQLite persistence
- Offline-first core UI
- Mission-style Today view
- Business runway / system status
- Guided Digital Door Workflow
- Integration registry with honest online/offline/planned states
- Architecture hooks for AI Router, Watchtower, native notifications, secure secrets and local workspace automation

## Run locally

Prerequisites: Node.js, Rust and Tauri's Windows prerequisites.

```bash
cd command-center
npm install
npm run tauri dev
```

## Important

No production credentials belong in frontend JavaScript. External integrations are intentionally not wired in Phase 1. The renderer should request privileged actions through the native layer in later phases.

See `docs/DECISIONS.md` and `docs/DIGITAL-DOOR-WORKFLOW.md`.
