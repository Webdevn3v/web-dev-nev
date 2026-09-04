# Phase 1 Corrective Patch — Digital Door: Planning Step vs. Production Stage

**Status:** Approved. Apply before Phase 1 is called locked. This is a correction, not a redesign.

## Model
Two independent dimensions:
- Planning step: existing 6-value Digital Door thinking flow: outcome, customer, paths, destinations, build, handoff, complete.
- Production stage: 12-stage client-delivery pipeline on Project: intake, brand_understanding, assets, digital_door, customer_paths, mobile_optimization, full_site_handoff, owner_digital_key, qa_audit, client_approval, launch, support_cleanup.

## Required changes

### 1. Rename digital_door_brief.stage to planning_step
Use a new append-only migration 003_rename_stage_to_planning_step.sql. Do not edit 001_init.sql. Update all code/query/UI references. Keep AdvanceDoorStage name and behavior unchanged.

### 2. Add project.production_stage
Use new migration 004_add_production_stage.sql. TEXT NOT NULL DEFAULT 'intake' with CHECK restricted to the 12 production stages above. Add idx_project_production_stage.

### 3. Add AdvanceProductionStage
Validate project existence and toStage against the 12 values. Run through the existing action layer. Entity type project; event type production_stage_advanced. Update project.production_stage.

### 4. Risk tier
AdvanceProductionStage defaults to EXTERNAL_WRITE. Transition to launch is HIGH_IMPACT and must require typed APPROVE confirmation.

### 5. Minimal UI
On existing Clients + Projects Project detail view, display production_stage and provide an Advance to next stage control. No new production-pipeline screen.

### 6. Documentation
Update DECISIONS.md to resolve 12-vs-6 as two independent dimensions. Update DIGITAL-DOOR-WORKFLOW.md to say it documents the planning flow and point to the production pipeline documentation.

## Out of scope
No new pipeline screen. No behavior changes to the 6-step planning flow. No backfill beyond DEFAULT intake. No relationship changes.

## Acceptance criteria
- digital_door_brief.planning_step exists; old stage references are gone where they refer to this field.
- project.production_stage exists with exactly 12 allowed values and defaults to intake.
- AdvanceProductionStage is validated, risk-tiered, and emits ActivityEvent.
- launch requires HIGH_IMPACT typed APPROVE; other production transitions use EXTERNAL_WRITE confirmation.
- Project detail shows current production stage and advance control.
- npm run build passes.
- DECISIONS.md and DIGITAL-DOOR-WORKFLOW.md updated.
- Existing planning flow behavior has no regression.
