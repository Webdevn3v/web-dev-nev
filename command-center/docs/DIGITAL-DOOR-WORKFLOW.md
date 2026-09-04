# Digital Door Workflow — Guided Mission Model

**Scope note (corrective patch, 2026-09-04):** this document describes the **planning flow**
only — the 6-step thinking sequence below (`digital_door_brief.planning_step` in the schema). It
is a separate, independent dimension from the **12-stage production pipeline**
(`project.production_stage`: intake → brand_understanding → assets → digital_door →
customer_paths → mobile_optimization → full_site_handoff → owner_digital_key → qa_audit →
client_approval → launch → support_cleanup), which tracks actual client-delivery progress on a
Project. See `docs/PHASE1-CORRECTIVE-PATCH.md` for the production pipeline's authoritative
definition and `docs/DECISIONS.md` ("Corrective patch: planning step vs. production stage") for
why these were originally conflated and how they were separated.

The workflow exists to remove the need for Nev to mentally design every project from scratch.

## Principle

Start with the customer's real goal, not with pages or features.

The system should guide planning in this order:

1. **Outcome** — What must be better for the business after this project exists?
2. **Customer** — Who is arriving and what are they actually trying to do?
3. **Paths** — What are the shortest, clearest routes for those needs?
4. **Destinations** — Where does each route end? Every path must resolve somewhere useful.
5. **Build** — Which Digital Side components are required to make those routes real?
6. **Handoff** — What is the purposeful next step into the client's own ecosystem, written in the client's brand voice?

## Workflow output

Each completed mission should produce a structured brief containing:

- client / project
- primary business outcome
- customer groups / intents
- urgent or high-value need
- brand voice / feel
- customer paths
- destination/action for every path
- required build pieces
- special interactions / assets / constraints
- purposeful full-site or next-step handoff
- notes for the next builder or AI

## Digital Side rules

- The wording belongs to the client's brand, not The Digital Side.
- No generic `View Full Site` handoffs when a purposeful brand-voice handoff can be written.
- No dead ends. Every Customer Path resolves to an action, destination, or useful loop.
- Keep threshold screens minimal; put details after the user chooses a path.
- The workflow should infer and prefill wherever possible instead of making Nev fill out more fields.

## Later intelligence

Future versions should be able to take a client intake, notes, existing site, and known business context and automatically propose:

- likely primary goal
- customer intents
- 3–5 recommended paths
- destination for each path
- missing assets
- recommended service/build pieces
- risks / unresolved questions
- suggested handoff language

Nev should then approve/edit the proposed mission instead of building it manually.
