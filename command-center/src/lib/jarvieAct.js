// Jarvie — the ACT path. Spec: docs/JARVIE-PHASE-B.md §5/§6.
//
// This is the ONLY Jarvie module permitted to import actions.js / risk.js, and the ONLY one
// that mutates. It never mutates except inside executeProposal(), which src/screens/jarvie.js
// calls only after the user has confirmed the proposal card. Every action it runs is a plain
// call into the existing action layer — same validation, same risk gate (confirmGate still
// fires for external/write + high-impact, including the typed APPROVE), same trigger-written
// ActivityEvent. No new mutation path is created (PHASE1-SPEC.md §4, "the Jarvis seam").

import {
  AdvanceDoorStage, AdvanceProductionStage, UpdateHandoffStatus, SubmitForAudit,
  ApproveChange, RejectChange, CreateTask, CompleteTask, CaptureInboxItem,
  CreateClient, UpdateClient, UpdateProjectStatus,
  ActionDeclinedError, DOOR_STAGES, PRODUCTION_STAGES,
} from './actions.js';
import { resolveTier, requiresConfirmation, TIER, TIER_LABEL } from './risk.js';
import { resolveEntity, noteEntity } from './jarvie.js';

const ACTION_FNS = {
  AdvanceDoorStage, AdvanceProductionStage, UpdateHandoffStatus, SubmitForAudit,
  ApproveChange, RejectChange, CreateTask, CompleteTask, CaptureInboxItem,
  CreateClient, UpdateClient, UpdateProjectStatus,
};

const CLIENT_STATUS = ['prospect', 'active', 'archived'];
const PROJECT_STATUS = ['active', 'paused', 'complete'];
const IMPERATIVE = /^(advance|move|mark|start|submit|approve|reject|create|add|complete|finish|capture|note|set|pause|resume|delete|remove)\b/;

// ---- proposals held by token so a stale card can't be replayed after data shifts (§6) ----
const pending = new Map();
function stash(actionName, args, entityRef, meta) {
  const token = 'act-' + Math.random().toString(36).slice(2, 12);
  pending.set(token, { actionName, args, entityRef });
  return { type: 'proposal', token, actionName, args, entityRef, ...meta };
}

const err = (message) => ({ type: 'error', message });
const disambig = (phrase, hits, command) => ({
  type: 'disambiguation',
  message: `“${phrase}” matches ${hits.length} records — which one?`,
  candidates: hits,
  command,
});

function nextInList(list, cur) { const i = list.indexOf(cur); return i >= 0 && i < list.length - 1 ? list[i + 1] : null; }
function norm(s) { return s.trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function tierMeta(actionName, args) {
  const tier = resolveTier(actionName, args);
  const tierLines = [];
  if (tier === TIER.HIGH_IMPACT) tierLines.push('High-impact — you will also be asked to type APPROVE.');
  else if (tier === TIER.EXTERNAL_WRITE) tierLines.push('External/write — logged, and you will confirm once more.');
  else tierLines.push('Reversible local change — logged.');
  return { tier, tierLabel: TIER_LABEL[tier] || tier, tierLines, needsSecondGate: requiresConfirmation(tier) };
}

// ---------------------------------------------------------------- grammar

// Each rule: { re } tested against lowercased text; build(m, rawText, resolve) → proposal|error|
// disambiguation. `resolve(phrase)` yields { status, ref, rec, hits } using the shared resolver.
const RULES = [
  { // submit <handoff> for audit
    re: /^submit\s+(.+?)\s+for\s+audit\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[1], ['handoff']); const bad = kindGuard(r, 'handoff', m[1]); if (bad) return bad;
      const meta = tierMeta('SubmitForAudit');
      return stash('SubmitForAudit', { handoffId: r.ref.id }, r.ref, {
        title: `Submit “${r.ref.label}” for audit`, lines: [`Handoff → returned for review.`, ...meta.tierLines], ...meta,
      });
    },
  },
  { // approve / reject <handoff>
    re: /^(approve|reject)\s+(.+?)\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[2], ['handoff']); const bad = kindGuard(r, 'handoff', m[2]); if (bad) return bad;
      const verb = m[1]; const actionName = verb === 'approve' ? 'ApproveChange' : 'RejectChange';
      const meta = tierMeta(actionName);
      return stash(actionName, { handoffId: r.ref.id }, r.ref, {
        title: `${verb === 'approve' ? 'Approve' : 'Reject'} “${r.ref.label}”`,
        lines: [`Handoff → ${verb === 'approve' ? 'accepted' : 'rejected'} and closed.`, ...meta.tierLines], ...meta,
      });
    },
  },
  { // complete / finish <task> · mark <task> done
    re: /^(?:complete|finish)\s+(?:task\s+)?(.+?)\s*$|^mark\s+(.+?)\s+(?:as\s+)?done\s*$/,
    async build(m, _raw, resolve) {
      const phrase = m[1] || m[2];
      const r = await resolve(phrase, ['task']); const bad = kindGuard(r, 'task', phrase); if (bad) return bad;
      if (r.rec.status === 'done') return err(`“${r.ref.label}” is already done.`);
      const meta = tierMeta('CompleteTask');
      return stash('CompleteTask', { id: r.ref.id }, r.ref, {
        title: `Complete task “${r.ref.label}”`, lines: ['Task → done.', ...meta.tierLines], ...meta,
      });
    },
  },
  { // mark <handoff> in progress · start <handoff>
    re: /^(?:mark\s+)?(.+?)\s+in\s+progress\s*$|^start\s+(.+?)\s*$/,
    async build(m, _raw, resolve) {
      const phrase = m[1] || m[2];
      const r = await resolve(phrase, ['handoff']); const bad = kindGuard(r, 'handoff', phrase); if (bad) return bad;
      const meta = tierMeta('UpdateHandoffStatus');
      return stash('UpdateHandoffStatus', { id: r.ref.id, status: 'in_progress' }, r.ref, {
        title: `Mark “${r.ref.label}” in progress`, lines: [`Handoff ${r.rec.status} → in_progress.`, ...meta.tierLines], ...meta,
      });
    },
  },
  { // advance / move <entity> to <step|stage>
    re: /^(?:advance|move)\s+(.+?)\s+to\s+([a-z0-9 _-]+?)\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[1], ['door_brief', 'project']);
      if (r.status === 'many') return disambig(m[1], r.hits, `advance ${m[1]} to ${m[2]}`);
      const bad = emptyOrNone(r, m[1]); if (bad) return bad;
      const target = norm(m[2]);
      if (r.ref.kind === 'door_brief') {
        if (!DOOR_STAGES.includes(target)) return err(`“${target}” isn’t a planning step. Valid: ${DOOR_STAGES.join(', ')}.`);
        const meta = tierMeta('AdvanceDoorStage', { toStage: target });
        return stash('AdvanceDoorStage', { id: r.ref.id, toStage: target }, r.ref, {
          title: `Advance “${r.ref.label}” to ${target.toUpperCase()}`,
          lines: [`Digital Door planning step: ${r.rec.planning_step} → ${target}.`, ...meta.tierLines], ...meta,
        });
      }
      if (r.ref.kind === 'project') {
        if (!PRODUCTION_STAGES.includes(target)) return err(`“${target}” isn’t a production stage. Valid: ${PRODUCTION_STAGES.join(', ')}.`);
        const meta = tierMeta('AdvanceProductionStage', { toStage: target });
        return stash('AdvanceProductionStage', { id: r.ref.id, toStage: target }, r.ref, {
          title: `Advance “${r.ref.label}” to ${target.toUpperCase()}`,
          lines: [`Production stage: ${r.rec.production_stage || 'intake'} → ${target}.`, ...meta.tierLines], ...meta,
        });
      }
      return err(`“advance … to …” works on a Door mission or a project, not a ${r.ref.kind.replace('_', ' ')}.`);
    },
  },
  { // advance <entity>  (→ next step/stage)
    re: /^advance\s+(.+?)\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[1], ['door_brief', 'project']);
      if (r.status === 'many') return disambig(m[1], r.hits, `advance ${m[1]}`);
      const bad = emptyOrNone(r, m[1]); if (bad) return bad;
      if (r.ref.kind === 'door_brief') {
        const next = nextInList(DOOR_STAGES, r.rec.planning_step);
        if (!next) return err(`“${r.ref.label}” is already at the last planning step.`);
        const meta = tierMeta('AdvanceDoorStage', { toStage: next });
        return stash('AdvanceDoorStage', { id: r.ref.id, toStage: next }, r.ref, {
          title: `Advance “${r.ref.label}” to ${next.toUpperCase()}`,
          lines: [`Digital Door planning step: ${r.rec.planning_step} → ${next}.`, ...meta.tierLines], ...meta,
        });
      }
      if (r.ref.kind === 'project') {
        const next = nextInList(PRODUCTION_STAGES, r.rec.production_stage || 'intake');
        if (!next) return err(`“${r.ref.label}” is already at the last production stage.`);
        const meta = tierMeta('AdvanceProductionStage', { toStage: next });
        return stash('AdvanceProductionStage', { id: r.ref.id, toStage: next }, r.ref, {
          title: `Advance “${r.ref.label}” to ${next.toUpperCase()}`,
          lines: [`Production stage: ${r.rec.production_stage || 'intake'} → ${next}.`, ...meta.tierLines], ...meta,
        });
      }
      return err(`“advance …” works on a Door mission or a project, not a ${r.ref.kind.replace('_', ' ')}.`);
    },
  },
  { // pause / resume <project>
    re: /^(pause|resume)\s+(.+?)\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[2], ['project']); const bad = kindGuard(r, 'project', m[2]); if (bad) return bad;
      const status = m[1] === 'pause' ? 'paused' : 'active';
      const meta = tierMeta('UpdateProjectStatus');
      return stash('UpdateProjectStatus', { id: r.ref.id, status }, r.ref, {
        title: `${m[1] === 'pause' ? 'Pause' : 'Resume'} “${r.ref.label}”`,
        lines: [`Project status → ${status}.`, ...meta.tierLines], ...meta,
      });
    },
  },
  { // set <entity> status <value>
    re: /^set\s+(.+?)\s+status\s+([a-z]+)\s*$/,
    async build(m, _raw, resolve) {
      const r = await resolve(m[1], ['client', 'project']);
      if (r.status === 'many') return disambig(m[1], r.hits, `set ${m[1]} status ${m[2]}`);
      const bad = emptyOrNone(r, m[1]); if (bad) return bad;
      const value = m[2];
      if (r.ref.kind === 'client') {
        if (!CLIENT_STATUS.includes(value)) return err(`Client status must be one of: ${CLIENT_STATUS.join(', ')}.`);
        const meta = tierMeta('UpdateClient');
        return stash('UpdateClient', { id: r.ref.id, status: value }, r.ref, {
          title: `Set client “${r.ref.label}” status → ${value}`, lines: meta.tierLines, ...meta,
        });
      }
      if (r.ref.kind === 'project') {
        if (!PROJECT_STATUS.includes(value)) return err(`Project status must be one of: ${PROJECT_STATUS.join(', ')}.`);
        const meta = tierMeta('UpdateProjectStatus');
        return stash('UpdateProjectStatus', { id: r.ref.id, status: value }, r.ref, {
          title: `Set project “${r.ref.label}” status → ${value}`, lines: meta.tierLines, ...meta,
        });
      }
      return err(`“set … status …” works on a client or a project, not a ${r.ref.kind.replace('_', ' ')}.`);
    },
  },
  { // create task "<title>" [for <project>] [priority <p>] [due <date>]
    re: /^(?:create|add)\s+task\b/,
    async build(_m, raw, resolve) {
      const q = raw.match(/["“]([^"”]+)["”]/);
      if (!q) return err('Put the task title in quotes — e.g. create task "Write the copy" for Frederick full site.');
      const title = q[1].trim();
      const low = raw.toLowerCase();
      const pr = low.match(/\bpriority\s+(low|normal|high|urgent)\b/);
      const due = low.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/);
      const forM = low.match(/\bfor\s+(.+?)(?:\s+priority\s+|\s+due\s+|\s*$)/);
      let projectId = null; let projLabel = null; let entityRef = null;
      if (forM) {
        const r = await resolve(forM[1].replace(/["“”]/g, '').trim(), ['project']);
        if (r.status === 'many') return disambig(forM[1], r.hits, raw);
        const bad = emptyOrNone(r, forM[1]); if (bad) return bad;
        if (r.ref.kind !== 'project') return err(`“${r.ref.label}” is a ${r.ref.kind.replace('_', ' ')}, not a project.`);
        projectId = r.ref.id; projLabel = r.ref.label; entityRef = r.ref;
      }
      const args = { title, projectId, priority: pr ? pr[1] : 'normal', dueDate: due ? due[1] : null };
      const meta = tierMeta('CreateTask');
      return stash('CreateTask', args, entityRef, {
        title: `Create task “${title}”`,
        lines: [
          projLabel ? `Under project “${projLabel}”.` : 'Standalone (no project).',
          `Priority ${args.priority}${args.dueDate ? `, due ${args.dueDate}` : ''}.`, ...meta.tierLines,
        ], ...meta,
      });
    },
  },
  { // add client "<name>" [status <s>]
    re: /^add\s+client\b/,
    async build(_m, raw) {
      const q = raw.match(/["“]([^"”]+)["”]/);
      if (!q) return err('Put the client name in quotes — e.g. add client "Frederick Legacy Law".');
      const name = q[1].trim();
      const st = raw.toLowerCase().match(/\bstatus\s+(prospect|active|archived)\b/);
      const args = { name, status: st ? st[1] : 'prospect' };
      const meta = tierMeta('CreateClient');
      return stash('CreateClient', args, null, {
        title: `Add client “${name}”`, lines: [`Status ${args.status}.`, ...meta.tierLines], ...meta,
      });
    },
  },
  { // capture <text> · note: <text>
    re: /^(?:capture|note)\b/,
    async build(_m, raw) {
      const body = raw.replace(/^(?:capture|note)\s*:?\s*/i, '').trim();
      if (!body) return err('Give me something to capture — e.g. capture Call Northline back tomorrow.');
      const meta = tierMeta('CaptureInboxItem');
      return stash('CaptureInboxItem', { rawText: body }, null, {
        title: 'Capture to inbox', lines: [`“${body}”`, ...meta.tierLines], ...meta,
      });
    },
  },
];

function kindGuard(r, wantKind, phrase) {
  const e = emptyOrNone(r, phrase);
  if (e) return e;
  if (r.ref.kind !== wantKind) return err(`“${r.ref.label}” is a ${r.ref.kind.replace('_', ' ')}, not a ${wantKind.replace('_', ' ')}.`);
  return null;
}
function emptyOrNone(r, phrase) {
  if (r.status === 'wrongkind') return err(`“${r.ref.label}” is a ${r.ref.kind.replace('_', ' ')} — that command doesn’t apply to it.`);
  if (r.status === 'empty') return err('I don’t have a “that” yet — name it once, then you can say "it".');
  if (r.status === 'none') return err(`I couldn’t find anything called “${phrase.trim()}”.`);
  if (r.status === 'many') return err(`“${phrase.trim()}” is ambiguous — be more specific.`);
  return null;
}

// ---------------------------------------------------------------- public

// Returns a proposal / error / disambiguation object, or null when the text isn't a command
// (the screen then falls through to the read-only answerer).
export async function parseCommand(rawText, entityId = null) {
  const raw = String(rawText || '').trim();
  if (!raw) return null;
  const t = raw.toLowerCase();
  const resolve = (phrase, kinds) => resolveEntity(entityId ? '' : phrase, { entityId, kinds });
  for (const rule of RULES) {
    const m = t.match(rule.re);
    if (m) return rule.build(m, raw, resolve);
  }
  if (IMPERATIVE.test(t)) return err(capabilityText());
  return null;
}

export function capabilityText() {
  return [
    'I can do these (I’ll show you the exact change and wait for your OK):',
    '• advance <mission|project> to <step|stage>   • advance <mission|project>',
    '• mark <handoff> in progress   • submit <handoff> for audit   • approve/reject <handoff>',
    '• create task "<title>" [for <project>] [priority <p>] [due YYYY-MM-DD]',
    '• complete task <task>   • capture <text>   • add client "<name>"',
    '• set <client|project> status <value>   • pause/resume <project>',
  ].join('\n');
}

// Runs a proposal the user has confirmed. The action's own risk gate (confirmGate) still fires
// for external/write + high-impact. Never called without a fresh, confirmed proposal token.
export async function executeProposal(proposal) {
  const token = proposal && proposal.token;
  const rec = token && pending.get(token);
  if (!rec) return { ok: false, stale: true, message: 'That proposal is stale — ask again.' };
  pending.delete(token);
  const fn = ACTION_FNS[rec.actionName];
  if (!fn) return { ok: false, message: `Unknown action ${rec.actionName}.` };
  try {
    const result = await fn(rec.args);
    if (rec.entityRef) noteEntity(rec.entityRef);
    return { ok: true, result, entityRef: rec.entityRef, actionName: rec.actionName, message: successMessage(rec) };
  } catch (e) {
    if (e instanceof ActionDeclinedError || e?.name === 'ActionDeclinedError') {
      return { ok: false, declined: true, message: 'Cancelled at the approval step — no changes were made.' };
    }
    throw e;
  }
}

function successMessage(rec) {
  const L = rec.entityRef?.label;
  switch (rec.actionName) {
    case 'AdvanceDoorStage': return `Advanced “${L}” to ${rec.args.toStage}.`;
    case 'AdvanceProductionStage': return `Advanced “${L}” to ${rec.args.toStage}.`;
    case 'UpdateHandoffStatus': return `“${L}” is now ${rec.args.status}.`;
    case 'SubmitForAudit': return `“${L}” submitted for audit.`;
    case 'ApproveChange': return `Approved “${L}”.`;
    case 'RejectChange': return `Rejected “${L}”.`;
    case 'CompleteTask': return `Completed “${L}”.`;
    case 'CreateTask': return `Task “${rec.args.title}” created.`;
    case 'CaptureInboxItem': return 'Captured to inbox.';
    case 'CreateClient': return `Client “${rec.args.name}” added.`;
    case 'UpdateClient': return `“${L}” status set to ${rec.args.status}.`;
    case 'UpdateProjectStatus': return `“${L}” status set to ${rec.args.status}.`;
    default: return 'Done.';
  }
}

export const __INTERNAL__ = { RULES, pending };
