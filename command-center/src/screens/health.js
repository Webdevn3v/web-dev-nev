// Business Health — PHASE1-SPEC.md §9.8. Derived view: read-only checks against real entity
// data. No dedicated storage.

import { esc, setHeader } from '../lib/ui.js';
import { getBusinessHealth } from '../lib/queries.js';

export async function renderHealth() {
  setHeader('READ-ONLY CHECKS', 'Business Health');
  const { overdueTasks, stalledBriefs, untriagedInbox, staleHandoffs } = await getBusinessHealth();
  const view = document.getElementById('view');

  const row = (label, count, warn) => `<div class="card ${warn ? 'glow' : ''}"><div class="kicker">${label}</div><div class="metric">${count}</div></div>`;

  view.innerHTML = `
    <div class="grid two">
      ${row('OVERDUE TASKS', overdueTasks.length, overdueTasks.length > 0)}
      ${row('STALLED DOOR BRIEFS (7+ DAYS)', stalledBriefs.length, stalledBriefs.length > 0)}
      ${row('UNTRIAGED INBOX', untriagedInbox.length, untriagedInbox.length > 0)}
      ${row('STALE HANDOFFS (3+ DAYS)', staleHandoffs.length, staleHandoffs.length > 0)}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">OVERDUE TASKS</div>
      ${overdueTasks.length ? overdueTasks.map((t) => `<div class="status-row"><span>${esc(t.title)}</span><span class="status">due ${esc(t.due_date)}</span></div>`).join('') : '<p class="muted">Nothing overdue.</p>'}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">STALLED DOOR BRIEFS</div>
      ${stalledBriefs.length ? stalledBriefs.map((b) => `<div class="status-row"><span>${esc(b.business || b.id)}</span><span class="status">${esc(b.planning_step.toUpperCase())} · idle since ${esc(new Date(b.updated_at).toLocaleDateString())}</span></div>`).join('') : '<p class="muted">Nothing stalled.</p>'}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">STALE HANDOFFS</div>
      ${staleHandoffs.length ? staleHandoffs.map((h) => `<div class="status-row"><span>${esc(h.objective)}</span><span class="status">${esc(h.status.toUpperCase())}</span></div>`).join('') : '<p class="muted">Nothing stale.</p>'}
    </div>`;
}
