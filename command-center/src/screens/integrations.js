// Integrations registry — PHASE1-SPEC.md §9.9. Explicit list of what's connected (automated) vs
// manual. Read-only in Phase 1: rows are seeded honestly (migrations/002_seed_integrations.sql)
// and there is no UI to fake a service into "connected" — that would violate §10's acceptance
// criterion directly.

import { esc, setHeader } from '../lib/ui.js';
import { listIntegrations } from '../lib/queries.js';

export async function renderIntegrations() {
  setHeader('WHAT IS ACTUALLY CONNECTED', 'Integrations');
  const integrations = await listIntegrations();
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="card">
      <div class="kicker">AUTOMATED</div>
      ${integrations.filter((i) => i.connection_type === 'automated').map((i) => `
        <div class="status-row"><span>${esc(i.service_name)}<div class="muted">${esc(i.notes || '')}</div></span><span class="status ready">${esc(i.status.toUpperCase())}</span></div>
      `).join('') || '<p class="muted">Nothing automated yet.</p>'}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">MANUAL / PLANNED</div>
      ${integrations.filter((i) => i.connection_type === 'manual').map((i) => `
        <div class="status-row"><span>${esc(i.service_name)}<div class="muted">${esc(i.notes || '')}</div></span><span class="status">${esc(i.status.toUpperCase())}</span></div>
      `).join('') || '<p class="muted">Nothing tracked yet.</p>'}
    </div>`;
}
