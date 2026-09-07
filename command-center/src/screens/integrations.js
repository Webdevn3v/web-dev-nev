// Integrations registry — PHASE1-SPEC.md §9.9. Explicit list of what's connected (automated) vs
// manual. Read-only in Phase 1: rows are seeded honestly (migrations/002_seed_integrations.sql)
// and there is no UI to fake a service into "connected" — that would violate §10's acceptance
// criterion directly.

import { esc, setHeader } from '../lib/ui.js';
import { listIntegrations } from '../lib/queries.js';
import { llmStatus, modelLabel, layerLive } from '../lib/jarvieLLM.js';

export async function renderIntegrations() {
  setHeader('WHAT IS ACTUALLY CONNECTED', 'Integrations');
  const [integrations, llm] = await Promise.all([listIntegrations(), llmStatus(true).catch(() => null)]);
  const view = document.getElementById('view');

  // The Jarvie language layer's real state comes from the Ask Jarvie screen (backend + enabled).
  // Only the Claude API backend is a paid integration; a local model is the user's own software.
  const live = !!(llm && layerLive(llm));
  const rows = integrations.map((i) => {
    if (i.service_name !== 'Claude') return i;
    if (live && llm.backend === 'claude') {
      return { ...i, status: 'connected', notes: `Jarvie language layer: Claude API, key stored native-side, calls from Rust. Model: ${modelLabel(llm.model)}.` };
    }
    if (live && llm.backend === 'local') {
      return { ...i, notes: `Jarvie language layer is ON but running a LOCAL model (${llm.localModel} at ${llm.localUrl}) — the Claude API is not in use.` };
    }
    if (llm && llm.hasKey) {
      return { ...i, notes: 'Jarvie Claude key is stored but the language layer is off (Ask Jarvie → language layer).' };
    }
    return i;
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
