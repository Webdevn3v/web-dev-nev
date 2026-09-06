// Integrations registry — PHASE1-SPEC.md §9.9. Explicit list of what's connected (automated) vs
// manual. Read-only in Phase 1: rows are seeded honestly (migrations/002_seed_integrations.sql)
// and there is no UI to fake a service into "connected" — that would violate §10's acceptance
// criterion directly.

import { esc, setHeader } from '../lib/ui.js';
import { listIntegrations } from '../lib/queries.js';
import { llmStatus, modelLabel } from '../lib/jarvieLLM.js';

export async function renderIntegrations() {
  setHeader('WHAT IS ACTUALLY CONNECTED', 'Integrations');
  const [integrations, llm] = await Promise.all([listIntegrations(), llmStatus(true).catch(() => null)]);
  const view = document.getElementById('view');

  // Phase C: the Claude row's real state comes from whether a key is stored + the layer enabled
  // (set on the Ask Jarvie screen). Still honest — nothing is shown "connected" that isn't.
  const claudeLive = !!(llm && llm.hasKey && llm.enabled);
  const rows = integrations.map((i) => {
    if (i.service_name !== 'Claude') return i;
    return claudeLive
      ? { ...i, status: 'connected', notes: `Jarvie Phase C: key stored native-side, calls made from Rust. Model: ${modelLabel(llm.model)}.` }
      : { ...i, notes: llm && llm.hasKey ? 'Jarvie Phase C key stored but the layer is off (Ask Jarvie → Claude API).' : i.notes };
  });

  view.innerHTML = `
    <div class="card">
      <div class="kicker">AUTOMATED</div>
      ${rows.filter((i) => i.connection_type === 'automated').map((i) => `
        <div class="status-row"><span>${esc(i.service_name)}<div class="muted">${esc(i.notes || '')}</div></span><span class="status ready">${esc(i.status.toUpperCase())}</span></div>
      `).join('') || '<p class="muted">Nothing automated yet.</p>'}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">MANUAL / PLANNED</div>
      ${rows.filter((i) => i.connection_type === 'manual').map((i) => `
        <div class="status-row"><span>${esc(i.service_name)}<div class="muted">${esc(i.notes || '')}</div></span><span class="status ${i.status === 'connected' ? 'ready' : ''}">${esc(i.status.toUpperCase())}</span></div>
      `).join('') || '<p class="muted">Nothing tracked yet.</p>'}
    </div>`;
}
