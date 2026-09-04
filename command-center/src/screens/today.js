// Today — PHASE1-SPEC.md §9.1. Derived view: open high-priority tasks, active Door briefs
// mid-stage, anything awaiting approval. No dedicated storage — computed at read time.

import { esc, setHeader } from '../lib/ui.js';
import { getTodayView } from '../lib/queries.js';

export async function renderToday(goTo) {
  setHeader('DAILY BRIEFING', 'Today');
  const view = document.getElementById('view');
  const { highPriorityTasks, midStageBriefs, awaitingApproval } = await getTodayView();

  view.innerHTML = `
    <div class="grid three">
      <div class="card glow"><div class="kicker">HIGH-PRIORITY TASKS</div><div class="metric">${highPriorityTasks.length}</div><div class="muted">Open, priority high or urgent.</div></div>
      <div class="card"><div class="kicker">DOOR BRIEFS MID-STAGE</div><div class="metric">${midStageBriefs.length}</div><div class="muted">Between outcome and complete.</div></div>
      <div class="card"><div class="kicker">AWAITING APPROVAL</div><div class="metric">${awaitingApproval.length}</div><div class="muted">Handoffs returned, waiting on you.</div></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">HIGH-PRIORITY TASKS</div>
      ${highPriorityTasks.length ? highPriorityTasks.map((t) => `
        <div class="status-row"><span>${esc(t.title)} <span class="muted">· ${esc(t.priority)}</span></span><span class="status">${esc(t.due_date || 'no due date')}</span></div>
      `).join('') : '<p class="muted">Nothing urgent open right now.</p>'}
      <div class="actions"><button class="btn primary" data-go="tasks">GO TO TASKS</button></div>
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="card">
        <div class="kicker">DOOR BRIEFS MID-STAGE</div>
        ${midStageBriefs.length ? midStageBriefs.map((b) => `<div class="status-row"><span>${esc(b.business || b.id)}</span><span class="status">${esc(b.stage.toUpperCase())}</span></div>`).join('') : '<p class="muted">No briefs in progress.</p>'}
        <div class="actions"><button class="btn" data-go="door">GO TO DOOR WORKFLOW</button></div>
      </div>
      <div class="card">
        <div class="kicker">AWAITING APPROVAL</div>
        ${awaitingApproval.length ? awaitingApproval.map((h) => `<div class="status-row"><span>${esc(h.objective)}</span><span class="status ready">${esc(h.to_worker)} → ${esc(h.from_worker)}</span></div>`).join('') : '<p class="muted">Nothing waiting on a decision.</p>'}
        <div class="actions"><button class="btn" data-go="ai">GO TO AI DESK</button></div>
      </div>
    </div>`;

  view.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => goTo(b.dataset.go));
}
