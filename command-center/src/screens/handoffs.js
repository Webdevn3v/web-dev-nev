// Handoffs (AI Desk) — PHASE1-SPEC.md §9.6. Manual creation/viewing of Handoff records between
// Nev/ChatGPT/Claude/Claude Code — no auto-routing in Phase 1.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { listHandoffs } from '../lib/queries.js';
import { CreateHandoff, UpdateHandoffStatus, SubmitForAudit, RecordAuditResult, ApproveChange, RejectChange } from '../lib/actions.js';

const WORKER_LABEL = { nev: 'Nev', chatgpt: 'ChatGPT', claude: 'Claude', claude_code: 'Claude Code', claude_cowork: 'Claude Cowork' };
const WORKERS = Object.keys(WORKER_LABEL);

function view() { return document.getElementById('view'); }
function workerOptions(selected) {
  return WORKERS.map((w) => `<option value="${w}" ${w === selected ? 'selected' : ''}>${WORKER_LABEL[w]}</option>`).join('');
}

export async function renderHandoffs() {
  setHeader('ONE DESK. MULTIPLE BRAINS.', 'AI Desk');
  const handoffs = await listHandoffs();

  view().innerHTML = `
    <div class="card glow">
      <div class="big">STRUCTURED HANDOFFS</div>
      <p class="muted">No external AI credentials are stored or called here. This is a structured record of a work request between Nev/ChatGPT/Claude/Claude Code — no auto-routing yet.</p>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">NEW HANDOFF</div>
      <div class="grid two">
        <div class="field"><label>FROM</label><select id="hFrom">${workerOptions('nev')}</select></div>
        <div class="field"><label>TO</label><select id="hTo">${workerOptions('claude_code')}</select></div>
      </div>
      <div class="field"><label>OBJECTIVE</label><input id="hObjective" placeholder="What outcome does this handoff need to produce?"></div>
      <div class="grid two">
        <div class="field"><label>CONTEXT</label><textarea id="hContext" placeholder="What the receiving worker needs to know."></textarea></div>
        <div class="field"><label>CONSTRAINTS</label><textarea id="hConstraints" placeholder="What must not change / not be done."></textarea></div>
        <div class="field"><label>INPUTS</label><textarea id="hInputs" placeholder="Links, files, prior artifacts."></textarea></div>
        <div class="field"><label>ACCEPTANCE CRITERIA</label><textarea id="hAccept" placeholder="How to know this is done."></textarea></div>
      </div>
      <div class="actions"><button class="btn primary" id="addHandoff">CREATE HANDOFF</button></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">ALL HANDOFFS</div>
      ${handoffs.length ? handoffs.map((h) => `
        <div class="inventory-row">
          <div>
            <div class="kicker">${WORKER_LABEL[h.from_worker] || h.from_worker} → ${WORKER_LABEL[h.to_worker] || h.to_worker}</div>
            <strong>${esc(h.objective)}</strong>
            <div class="muted">${esc(h.context || '')}</div>
          </div>
          <div class="actions">
            <span class="status ${h.status === 'accepted' ? 'ready' : ''}">${esc(h.status.toUpperCase())}</span>
            ${h.status === 'pending' ? `<button class="btn" data-progress="${esc(h.id)}">MARK IN PROGRESS</button>` : ''}
            ${h.status === 'in_progress' ? `<button class="btn" data-submit-audit="${esc(h.id)}">SUBMIT FOR AUDIT</button>` : ''}
            ${h.status === 'returned' ? `
              <button class="btn" data-audit-pass="${esc(h.id)}">RECORD PASS</button>
              <button class="btn" data-audit-fix="${esc(h.id)}">RECORD FIX NEEDED</button>
              <button class="btn primary" data-approve="${esc(h.id)}">APPROVE</button>
              <button class="btn" data-reject="${esc(h.id)}">REJECT</button>
            ` : ''}
          </div>
        </div>`).join('') : '<p class="muted">No handoffs yet.</p>'}
    </div>`;

  document.getElementById('addHandoff').onclick = () => withErrorToast(async () => {
    const objective = document.getElementById('hObjective').value.trim();
    if (!objective) return;
    await CreateHandoff({
      fromWorker: document.getElementById('hFrom').value,
      toWorker: document.getElementById('hTo').value,
      objective,
      context: document.getElementById('hContext').value.trim(),
      constraints: document.getElementById('hConstraints').value.trim(),
      inputs: document.getElementById('hInputs').value.trim(),
      acceptanceCriteria: document.getElementById('hAccept').value.trim(),
    });
    renderHandoffs();
  });
  view().querySelectorAll('[data-progress]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await UpdateHandoffStatus({ id: b.dataset.progress, status: 'in_progress' });
    renderHandoffs();
  }));
  view().querySelectorAll('[data-submit-audit]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await SubmitForAudit({ handoffId: b.dataset.submitAudit });
    renderHandoffs();
  }));
  view().querySelectorAll('[data-audit-pass]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await RecordAuditResult({ handoffId: b.dataset.auditPass, verdict: 'pass' });
    renderHandoffs();
  }));
  view().querySelectorAll('[data-audit-fix]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await RecordAuditResult({ handoffId: b.dataset.auditFix, verdict: 'fix_required' });
    renderHandoffs();
  }));
  view().querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await ApproveChange({ handoffId: b.dataset.approve });
    renderHandoffs();
  }));
  view().querySelectorAll('[data-reject]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await RejectChange({ handoffId: b.dataset.reject });
    renderHandoffs();
  }));
}
