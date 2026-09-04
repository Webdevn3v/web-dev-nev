// Pre-Phase-1 screens, preserved as working functionality. Not part of PHASE1-SPEC.md §9 — two
// of these (Watchtower, Money) are explicitly deferred by §11, so they stay exactly as static
// placeholders and are not expanded. Inventory and Client Jobs are real, working features that
// predate the spec; their behavior is unchanged, only their persistence now goes through
// SaveLegacyState instead of a raw KV write. See docs/DECISIONS.md.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { legacy, saveLegacy } from '../lib/legacyState.js';

function view() { return document.getElementById('view'); }

export function renderRunway() {
  setHeader('BUSINESS LEVEL MAP', 'Goal Runway');
  view().innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="kicker">ACTIVE MISSIONS</div>
      ${legacy.missions.map((m) => `
        <div class="mission ${m.status}">
          <div class="mission__top">
            <div><div class="mission__name">${esc(m.name)}</div><div class="muted">${esc(m.note)}</div></div>
            <div class="mission__tag">${esc(m.tag)}</div>
          </div>
          <div class="progress"><span style="width:${m.progress}%"></span></div>
        </div>`).join('')}
    </div>
    <div class="grid two">
      ${legacy.runway.map(([name, pct], i) => `
        <div class="card ${i === 0 ? 'glow' : ''}">
          <div class="kicker">LEVEL ${String(i + 1).padStart(2, '0')}</div>
          <div class="big">${esc(name)}</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="muted" style="margin-top:8px">${pct}% complete</div>
        </div>`).join('')}
    </div>`;
}

export function renderWatch() {
  setHeader('MONITORING', 'Watchtower');
  view().innerHTML = `
    <div class="card">
      <div class="big">WATCH REGISTRY READY</div>
      <p class="muted">Phase 1 keeps monitoring offline. Later monitors plug into this system without pretending to be connected — see PHASE1-SPEC.md §11 (deferred).</p>
      ${['Website health', 'Deployments', 'Domains / SSL / DNS', 'Forms', 'Client inactivity', 'Payments', 'Deadlines', 'Backups']
        .map((x) => `<div class="status-row"><span>${x}</span><span class="status">PLANNED</span></div>`).join('')}
    </div>`;
}

export function renderMoney() {
  setHeader('TDS LAUNCH FUND', 'Money');
  view().innerHTML = `
    <div class="grid two">
      <div class="card glow">
        <div class="kicker">NEXT INFRASTRUCTURE GOAL</div>
        <div class="big">BUSINESS FORMATION + BANKING</div>
        <p class="muted">Real budget tracking is deferred to a later phase — see PHASE1-SPEC.md §11.</p>
      </div>
      <div class="card">
        <div class="kicker">RULE</div>
        <div class="big">MONEY GETS A JOB FIRST.</div>
        <p class="muted">Every future expense will carry priority, dependency, target, saved, remaining and funding source.</p>
      </div>
    </div>`;
}

export function renderJobs() {
  setHeader('STONE & STARDUST', 'Client Job Board');
  const jobs = legacy.clientJobs.filter((j) => j.clientId === 'stone-stardust');
  const order = { doing: 0, next: 1, queued: 2, done: 3 };
  jobs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  view().innerHTML = `
    <div class="grid three">
      <div class="card glow"><div class="kicker">TONIGHT</div><div class="metric">${jobs.filter((j) => j.priority === 'TONIGHT' && j.status !== 'done').length}</div><div class="muted">launch-critical jobs</div></div>
      <div class="card"><div class="kicker">IN PROGRESS</div><div class="metric">${jobs.filter((j) => j.status === 'doing').length}</div></div>
      <div class="card"><div class="kicker">DONE</div><div class="metric">${jobs.filter((j) => j.status === 'done').length}</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">CLIENT #1 · WEBSITE + SALES</div>
      ${jobs.map((j) => `
        <div class="inventory-row">
          <div><div class="kicker">${esc(j.area)} · ${esc(j.priority)}</div><strong>${esc(j.title)}</strong><div class="muted">${esc(j.note)}</div></div>
          <div class="actions"><button class="btn ${j.status === 'doing' ? 'primary' : ''}" data-job="${esc(j.id)}">${j.status === 'done' ? 'DONE ✓' : j.status === 'doing' ? 'MARK DONE' : 'START'}</button></div>
        </div>`).join('')}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">ADD CLIENT JOB</div>
      <div class="grid two">
        <div class="field"><label>JOB</label><input id="jobTitle" placeholder="Update event banner"></div>
        <div class="field"><label>AREA</label><input id="jobArea" placeholder="WEBSITE"></div>
      </div>
      <div class="actions"><button class="btn primary" id="addJob">ADD JOB</button></div>
    </div>`;

  view().querySelectorAll('[data-job]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const j = legacy.clientJobs.find((x) => x.id === b.dataset.job);
    if (!j) return;
    j.status = j.status === 'doing' ? 'done' : 'doing';
    j.updatedAt = new Date().toISOString();
    await saveLegacy('clientJobs');
    renderJobs();
  }));
  document.getElementById('addJob').onclick = () => withErrorToast(async () => {
    const title = document.getElementById('jobTitle').value.trim();
    if (!title) return;
    legacy.clientJobs.push({
      id: `SS-JOB-${String(legacy.clientJobs.filter((j) => j.clientId === 'stone-stardust').length + 1).padStart(3, '0')}`,
      clientId: 'stone-stardust', title, area: document.getElementById('jobArea').value.trim().toUpperCase() || 'GENERAL',
      status: 'queued', priority: 'NORMAL', note: '', createdAt: new Date().toISOString(),
    });
    await saveLegacy('clientJobs');
    renderJobs();
  });
}

function photoProposalCard(p) {
  return `<div class="card" style="margin-top:10px">
    <div class="kicker">PHOTO BATCH · ${esc(p.collection || 'UNASSIGNED')}</div>
    <div class="big">${esc(p.label || 'Collection photo')}</div>
    <p class="muted">${p.count || 0} proposed pieces · REVIEW REQUIRED</p>
    <div class="actions">
      <button class="btn primary" data-approve-photo="${esc(p.id)}">APPROVE TO INVENTORY</button>
      <button class="btn" data-remove-photo="${esc(p.id)}">DISCARD</button>
    </div>
  </div>`;
}

export function renderInventory() {
  setHeader('STONE & STARDUST', 'Inventory + Event Prep');
  const items = legacy.inventory.filter((i) => i.clientId === 'stone-stardust');
  const event = legacy.events.find((e) => e.clientId === 'stone-stardust' && e.status === 'prep');
  const going = items.filter((i) => i.eventId === event?.id);
  const sold = going.filter((i) => i.status === 'sold');
  const available = items.filter((i) => i.status === 'available' || i.status === 'returned');
  const projected = going.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const actual = sold.reduce((sum, i) => sum + (Number(i.salePrice ?? i.price) || 0) * (Number(i.qty) || 1), 0);
  const rows = (list, mode) => list.length ? list.map((i) => `
    <div class="inventory-row">
      <div><strong>${esc(i.id)} · ${esc(i.collection)} · ${esc(i.type)}</strong><div class="muted">${esc(i.size || '')} · $${Number(i.price || 0).toFixed(0)} · qty ${i.qty}</div></div>
      <div class="actions">${mode === 'event' && i.status !== 'sold' ? `<button class="btn primary" data-sold="${esc(i.id)}">SOLD</button><button class="btn" data-returned="${esc(i.id)}">RETURNED</button>` : ''}${mode === 'online' ? `<span class="status ready">ONLINE QUEUE</span>` : ''}</div>
    </div>`).join('') : '<p class="muted">Nothing here yet.</p>';
  const photoBatches = legacy.photoIntake.filter((p) => p.clientId === 'stone-stardust' && p.status === 'review');

  view().innerHTML = `
    <div class="grid three">
      <div class="card glow"><div class="kicker">EVENT</div><div class="big">${esc(event?.name || 'NO EVENT')}</div><div class="muted">${esc(event?.date || '')}</div></div>
      <div class="card"><div class="kicker">PROJECTED VALUE</div><div class="metric">$${projected.toFixed(0)}</div></div>
      <div class="card"><div class="kicker">SALES LOGGED</div><div class="metric">$${actual.toFixed(0)}</div><div class="muted">${sold.length} item records sold</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">PHOTO-ASSISTED INTAKE</div>
      <div class="big">PHOTO → PROPOSAL → CONFIRM → INVENTORY</div>
      <p class="muted">Add a photo/AI analysis as a proposal batch, review it, then approve it into real inventory.</p>
      <div class="grid two">
        <div class="field"><label>COLLECTION</label><input id="photoCollection" placeholder="Water Colors"></div>
        <div class="field"><label>BATCH LABEL</label><input id="photoLabel" placeholder="Blue window strands · photo 1"></div>
        <div class="field"><label>PROPOSED PIECES</label><textarea id="photoPieces" placeholder="One per line: Window Strand | 48 in | 40"></textarea></div>
      </div>
      <div class="actions"><button class="btn primary" id="stagePhoto">STAGE PHOTO PROPOSAL</button></div>
      ${photoBatches.map(photoProposalCard).join('')}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">QUICK ADD · CONFIRM AFTER PHOTO REVIEW</div>
      <div class="grid two">
        <div class="field"><label>COLLECTION</label><input id="invCollection" placeholder="Water Colors"></div>
        <div class="field"><label>TYPE</label><input id="invType" placeholder="Window Strand"></div>
        <div class="field"><label>SIZE / LENGTH</label><input id="invSize" placeholder='48"'></div>
        <div class="field"><label>PRICE</label><input id="invPrice" type="number" min="0" step="1" placeholder="40"></div>
        <div class="field"><label>QUANTITY</label><input id="invQty" type="number" min="1" value="1"></div>
      </div>
      <div class="actions"><button class="btn primary" id="addInventory">ADD TO TOMORROW'S EVENT</button></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">POST-EVENT PHOTO RECONCILIATION</div>
      <div class="big">WHAT CAME HOME?</div>
      <p class="muted">Nothing is marked returned or sold until you confirm.</p>
      <div class="grid two">
        <div class="field"><label>COLLECTION / BATCH</label><input id="reconLabel" placeholder="Water Colors · returned photo 1"></div>
        <div class="field"><label>RETURNED ITEM IDS</label><textarea id="reconIds" placeholder="S&S-001&#10;S&S-004&#10;S&S-007"></textarea></div>
      </div>
      <div class="actions"><button class="btn primary" id="stageRecon">STAGE RETURN PHOTO</button></div>
      ${legacy.reconciliation.filter((r) => r.clientId === 'stone-stardust' && r.status === 'review').map((r) => `
        <div class="inventory-row">
          <div><strong>${esc(r.label)}</strong><div class="muted">${r.returnedIds.length} proposed returned · ${going.filter((i) => !r.returnedIds.includes(i.id) && i.status !== 'sold').length} potentially sold/unaccounted</div></div>
          <div class="actions"><button class="btn primary" data-confirm-recon="${esc(r.id)}">CONFIRM RETURNS</button><button class="btn" data-discard-recon="${esc(r.id)}">DISCARD</button></div>
        </div>`).join('')}
    </div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><div class="kicker">EVENT INVENTORY · SOLD / RETURNED</div>${rows(going, 'event')}</div>
      <div class="card"><div class="kicker">AFTER EVENT · ONLINE QUEUE</div><p class="muted">Returned and available pieces stay sellable between events.</p>${rows(available, 'online')}</div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">CUSTOM ORDERS</div>
      <div class="grid two">
        <div class="field"><label>CUSTOMER</label><input id="customCustomer" placeholder="Name or contact"></div>
        <div class="field"><label>REQUEST</label><input id="customRequest" placeholder="Colors, length, style, deadline…"></div>
      </div>
      <div class="actions"><button class="btn primary" id="addCustom">ADD CUSTOM ORDER</button></div>
      ${legacy.customOrders.length ? legacy.customOrders.map((o) => `<div class="status-row"><span>${esc(o.customer)} · ${esc(o.request)}</span><span class="status">${esc(o.status.toUpperCase())}</span></div>`).join('') : '<p class="muted">No custom orders yet.</p>'}
    </div>`;

  document.getElementById('stageRecon').onclick = () => withErrorToast(async () => {
    const label = document.getElementById('reconLabel').value.trim() || 'Returned inventory photo';
    const returnedIds = [...new Set(document.getElementById('reconIds').value.split(/\n|,/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
    if (!returnedIds.length) return;
    legacy.reconciliation.push({ id: `RC-${String(legacy.reconciliation.length + 1).padStart(3, '0')}`, clientId: 'stone-stardust', eventId: event?.id || '', label, returnedIds, status: 'review', createdAt: new Date().toISOString() });
    await saveLegacy('reconciliation');
    renderInventory();
  });
  view().querySelectorAll('[data-confirm-recon]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const r = legacy.reconciliation.find((x) => x.id === b.dataset.confirmRecon);
    if (!r) return;
    const valid = new Set(r.returnedIds);
    legacy.inventory.filter((i) => i.eventId === r.eventId && valid.has(i.id) && i.status !== 'sold').forEach((i) => { i.status = 'returned'; i.returnedAt = new Date().toISOString(); i.reconciliationId = r.id; });
    r.status = 'confirmed'; r.confirmedAt = new Date().toISOString();
    await saveLegacy('inventory'); await saveLegacy('reconciliation');
    renderInventory();
  }));
  view().querySelectorAll('[data-discard-recon]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const r = legacy.reconciliation.find((x) => x.id === b.dataset.discardRecon);
    if (!r) return;
    r.status = 'discarded';
    await saveLegacy('reconciliation');
    renderInventory();
  }));
  document.getElementById('stagePhoto').onclick = () => withErrorToast(async () => {
    const collection = document.getElementById('photoCollection').value.trim();
    const label = document.getElementById('photoLabel').value.trim();
    const lines = document.getElementById('photoPieces').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!collection || !lines.length) return;
    const pieces = lines.map((line) => { const [type = '', size = '', price = ''] = line.split('|').map((x) => x.trim()); return { type, size, price: Number(price) || 0, qty: 1 }; });
    legacy.photoIntake.push({ id: `PB-${String(legacy.photoIntake.length + 1).padStart(3, '0')}`, clientId: 'stone-stardust', collection, label: label || 'Collection photo', count: pieces.length, pieces, status: 'review', createdAt: new Date().toISOString() });
    await saveLegacy('photoIntake');
    renderInventory();
  });
  view().querySelectorAll('[data-approve-photo]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const p = legacy.photoIntake.find((x) => x.id === b.dataset.approvePhoto);
    if (!p) return;
    for (const piece of p.pieces) {
      const id = `S&S-${String(legacy.inventory.filter((x) => x.clientId === 'stone-stardust').length + 1).padStart(3, '0')}`;
      legacy.inventory.push({ id, clientId: 'stone-stardust', collection: p.collection, type: piece.type || 'Unclassified piece', size: piece.size || '', price: Number(piece.price) || 0, qty: Number(piece.qty) || 1, status: 'available', eventId: event?.id || '', sourcePhotoBatch: p.id });
    }
    p.status = 'approved'; p.approvedAt = new Date().toISOString();
    await saveLegacy('inventory'); await saveLegacy('photoIntake');
    renderInventory();
  }));
  view().querySelectorAll('[data-remove-photo]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const p = legacy.photoIntake.find((x) => x.id === b.dataset.removePhoto);
    if (!p) return;
    p.status = 'discarded';
    await saveLegacy('photoIntake');
    renderInventory();
  }));
  document.getElementById('addInventory').onclick = () => withErrorToast(async () => {
    const collection = document.getElementById('invCollection').value.trim();
    const type = document.getElementById('invType').value.trim();
    if (!collection || !type) return;
    const id = `S&S-${String(items.length + 1).padStart(3, '0')}`;
    legacy.inventory.push({ id, clientId: 'stone-stardust', collection, type, size: document.getElementById('invSize').value.trim(), price: Number(document.getElementById('invPrice').value) || 0, qty: Number(document.getElementById('invQty').value) || 1, status: 'available', eventId: event?.id || '' });
    await saveLegacy('inventory');
    renderInventory();
  });
  view().querySelectorAll('[data-sold]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const i = legacy.inventory.find((x) => x.id === b.dataset.sold);
    if (!i) return;
    const entered = prompt('Sale price', String(i.price || 0));
    if (entered === null) return;
    i.salePrice = Number(entered) || 0; i.status = 'sold'; i.soldAt = new Date().toISOString();
    await saveLegacy('inventory');
    renderInventory();
  }));
  view().querySelectorAll('[data-returned]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const i = legacy.inventory.find((x) => x.id === b.dataset.returned);
    if (!i) return;
    i.status = 'returned'; i.returnedAt = new Date().toISOString();
    await saveLegacy('inventory');
    renderInventory();
  }));
  document.getElementById('addCustom').onclick = () => withErrorToast(async () => {
    const customer = document.getElementById('customCustomer').value.trim();
    const request = document.getElementById('customRequest').value.trim();
    if (!request) return;
    legacy.customOrders.push({ id: `CO-${String(legacy.customOrders.length + 1).padStart(3, '0')}`, clientId: 'stone-stardust', customer: customer || 'Walk-up customer', request, status: 'requested', createdAt: new Date().toISOString() });
    await saveLegacy('customOrders');
    renderInventory();
  });
}
