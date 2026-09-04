// Clients + Projects — PHASE1-SPEC.md §9.2. CRUD, list/detail.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { listClients, listProjects } from '../lib/queries.js';
import { CreateClient, UpdateClient, CreateProject, UpdateProjectStatus } from '../lib/actions.js';

let selectedClientId = null;

function view() { return document.getElementById('view'); }

export async function renderClients() {
  setHeader('CLIENT WORKSPACES', 'Clients');
  if (selectedClientId) return renderDetail();

  const clients = await listClients();
  view().innerHTML = `
    <div class="card">
      <div class="kicker">NEW CLIENT</div>
      <div class="grid two">
        <div class="field"><label>NAME</label><input id="newClientName" placeholder="Frederick Legacy Law"></div>
        <div class="field"><label>CONTACT INFO</label><input id="newClientContact" placeholder="email / phone"></div>
      </div>
      <div class="field"><label>STATUS</label>
        <select id="newClientStatus"><option value="prospect">Prospect</option><option value="active">Active</option><option value="archived">Archived</option></select>
      </div>
      <div class="actions"><button class="btn primary" id="addClient">ADD CLIENT</button></div>
    </div>
    <div class="grid two" style="margin-top:14px">
      ${clients.length ? clients.map((c) => `
        <div class="card ${c.status === 'active' ? 'glow' : ''}" data-open="${esc(c.id)}" style="cursor:pointer">
          <div class="kicker">${esc(c.status.toUpperCase())}</div>
          <div class="big">${esc(c.name)}</div>
          <p class="muted">${esc(c.contact_info || 'No contact info yet.')}</p>
        </div>`).join('') : '<p class="muted">No clients yet — add the first one above.</p>'}
    </div>`;

  document.getElementById('addClient').onclick = () => withErrorToast(async () => {
    const name = document.getElementById('newClientName').value.trim();
    if (!name) return;
    await CreateClient({
      name,
      contactInfo: document.getElementById('newClientContact').value.trim(),
      status: document.getElementById('newClientStatus').value,
    });
    renderClients();
  });
  view().querySelectorAll('[data-open]').forEach((el) => el.onclick = () => { selectedClientId = el.dataset.open; renderClients(); });
}

async function renderDetail() {
  const clients = await listClients();
  const client = clients.find((c) => c.id === selectedClientId);
  if (!client) { selectedClientId = null; return renderClients(); }
  const projects = await listProjects({ clientId: client.id });

  view().innerHTML = `
    <div class="card glow">
      <div class="kicker">${esc(client.status.toUpperCase())}</div>
      <div class="big">${esc(client.name)}</div>
      <p class="muted">${esc(client.contact_info || 'No contact info yet.')}</p>
      <div class="field"><label>STATUS</label>
        <select id="clientStatus">
          <option value="prospect" ${client.status === 'prospect' ? 'selected' : ''}>Prospect</option>
          <option value="active" ${client.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="archived" ${client.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select>
      </div>
      <div class="actions">
        <button class="btn primary" id="saveClientStatus">SAVE STATUS</button>
        <button class="btn" id="backToClients">← ALL CLIENTS</button>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">NEW PROJECT FOR ${esc(client.name).toUpperCase()}</div>
      <div class="grid two">
        <div class="field"><label>TITLE</label><input id="newProjectTitle" placeholder="Full site rebuild"></div>
        <div class="field"><label>TYPE</label><input id="newProjectType" placeholder="Digital Door / Website / Brand"></div>
      </div>
      <div class="actions"><button class="btn primary" id="addProject">ADD PROJECT</button></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">PROJECTS</div>
      ${projects.length ? projects.map((p) => `
        <div class="status-row">
          <span>${esc(p.title)} <span class="muted">· ${esc(p.type || 'general')}</span></span>
          <select data-project-status="${esc(p.id)}">
            <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="paused" ${p.status === 'paused' ? 'selected' : ''}>Paused</option>
            <option value="complete" ${p.status === 'complete' ? 'selected' : ''}>Complete</option>
          </select>
        </div>`).join('') : '<p class="muted">No projects yet for this client.</p>'}
    </div>`;

  document.getElementById('backToClients').onclick = () => { selectedClientId = null; renderClients(); };
  document.getElementById('saveClientStatus').onclick = () => withErrorToast(async () => {
    await UpdateClient({ id: client.id, status: document.getElementById('clientStatus').value });
    renderClients();
  });
  document.getElementById('addProject').onclick = () => withErrorToast(async () => {
    const title = document.getElementById('newProjectTitle').value.trim();
    if (!title) return;
    await CreateProject({ clientId: client.id, title, type: document.getElementById('newProjectType').value.trim() });
    renderClients();
  });
  view().querySelectorAll('[data-project-status]').forEach((sel) => sel.onchange = () => withErrorToast(async () => {
    await UpdateProjectStatus({ id: sel.dataset.projectStatus, status: sel.value });
    renderClients();
  }));
}
