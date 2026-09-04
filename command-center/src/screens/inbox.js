// Inbox — PHASE1-SPEC.md §9.5. Capture raw text, manually triage/convert to Task/Project/Client.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { listInboxItems } from '../lib/queries.js';
import { CaptureInboxItem, ConvertInboxItem, DismissInboxItem } from '../lib/actions.js';

function view() { return document.getElementById('view'); }

export async function renderInbox() {
  setHeader('CAPTURE & TRIAGE', 'Inbox');
  const [untriaged, triaged] = await Promise.all([
    listInboxItems({ status: 'untriaged' }),
    listInboxItems(),
  ]);
  const resolved = triaged.filter((i) => i.status !== 'untriaged').slice(0, 15);

  view().innerHTML = `
    <div class="card">
      <div class="kicker">CAPTURE</div>
      <div class="field"><label>RAW NOTE</label><textarea id="inboxText" placeholder="Anything you don't want to lose — triage it later."></textarea></div>
      <div class="actions"><button class="btn primary" id="capture">CAPTURE</button></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">UNTRIAGED · ${untriaged.length}</div>
      ${untriaged.length ? untriaged.map((i) => `
        <div class="inventory-row">
          <div><strong>${esc(i.raw_text)}</strong><div class="muted">captured ${esc(new Date(i.created_at).toLocaleString())}</div></div>
          <div class="actions">
            <button class="btn primary" data-convert="${esc(i.id)}" data-type="task">→ TASK</button>
            <button class="btn" data-convert="${esc(i.id)}" data-type="project">→ PROJECT</button>
            <button class="btn" data-convert="${esc(i.id)}" data-type="client">→ CLIENT</button>
            <button class="btn" data-dismiss="${esc(i.id)}">DISMISS</button>
          </div>
        </div>`).join('') : '<p class="muted">Inbox is clear.</p>'}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">RECENTLY TRIAGED</div>
      ${resolved.length ? resolved.map((i) => `<div class="status-row"><span>${esc(i.raw_text)}</span><span class="status">${esc(i.status.toUpperCase())}${i.converted_to_entity_type ? ` → ${esc(i.converted_to_entity_type)}` : ''}</span></div>`).join('') : '<p class="muted">Nothing triaged yet.</p>'}
    </div>`;

  document.getElementById('capture').onclick = () => withErrorToast(async () => {
    const rawText = document.getElementById('inboxText').value.trim();
    if (!rawText) return;
    await CaptureInboxItem({ rawText });
    renderInbox();
  });
  view().querySelectorAll('[data-convert]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await ConvertInboxItem({ id: b.dataset.convert, toEntityType: b.dataset.type });
    renderInbox();
  }));
  view().querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await DismissInboxItem({ id: b.dataset.dismiss });
    renderInbox();
  }));
}
