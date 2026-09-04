// Approval / Risk Model — PHASE1-SPEC.md §5.
// Every mutating action is tagged with a risk tier here. This is the one place the tier list
// lives; src/lib/actions.js looks it up instead of deciding per-call, so the gate can't be
// silently skipped by a screen that forgets to check.

export const TIER = {
  SAFE_READ: 'safe_read',
  REVERSIBLE_LOCAL: 'reversible_local',
  EXTERNAL_WRITE: 'external_write',
  HIGH_IMPACT: 'high_impact',
};

export const TIER_LABEL = {
  [TIER.SAFE_READ]: 'Safe read',
  [TIER.REVERSIBLE_LOCAL]: 'Reversible local',
  [TIER.EXTERNAL_WRITE]: 'External / write',
  [TIER.HIGH_IMPACT]: 'High-impact',
};

// Static tier per action name. AdvanceDoorStage is resolved dynamically (see resolveTier below)
// because only the final "launch" transition into 'complete' is high-impact — every other stage
// advance is external/write, matching PHASE1-SPEC.md §5's plain listing of AdvanceDoorStage.
export const ACTION_TIERS = {
  CreateClient: TIER.REVERSIBLE_LOCAL,
  UpdateClient: TIER.REVERSIBLE_LOCAL,
  CreateProject: TIER.REVERSIBLE_LOCAL,
  UpdateProjectStatus: TIER.REVERSIBLE_LOCAL,
  CreateTask: TIER.REVERSIBLE_LOCAL,
  UpdateTask: TIER.REVERSIBLE_LOCAL,
  CompleteTask: TIER.REVERSIBLE_LOCAL,
  AdvanceDoorStage: TIER.EXTERNAL_WRITE,
  UpdateDoorBriefField: TIER.REVERSIBLE_LOCAL,
  CreateArtifact: TIER.EXTERNAL_WRITE,
  CreateHandoff: TIER.EXTERNAL_WRITE,
  UpdateHandoffStatus: TIER.EXTERNAL_WRITE,
  SubmitForAudit: TIER.EXTERNAL_WRITE,
  RecordAuditResult: TIER.EXTERNAL_WRITE,
  ApproveChange: TIER.HIGH_IMPACT,
  RejectChange: TIER.HIGH_IMPACT,
  CaptureInboxItem: TIER.REVERSIBLE_LOCAL,
  ConvertInboxItem: TIER.REVERSIBLE_LOCAL,
  DismissInboxItem: TIER.REVERSIBLE_LOCAL,
  SaveLegacyState: TIER.REVERSIBLE_LOCAL,
};

export function resolveTier(actionName, args) {
  if (actionName === 'AdvanceDoorStage' && args?.toStage === 'complete') {
    return TIER.HIGH_IMPACT;
  }
  const tier = ACTION_TIERS[actionName];
  if (!tier) throw new Error(`No risk tier defined for action "${actionName}"`);
  return tier;
}

export function requiresConfirmation(tier) {
  return tier === TIER.EXTERNAL_WRITE || tier === TIER.HIGH_IMPACT;
}
