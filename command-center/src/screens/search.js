// Search — PHASE1-SPEC.md §9.11. Basic entity search across Clients/Projects/Tasks/Artifacts.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { search } from '../lib/queries.js';

function view() { return document.getElementById('view'); }

function section(title, rows, render) {
  return `<div class="card" style="margin-top:14px"><div class="kicker">${title} · ${rows.length}</div>${
    rows.length ? rows.map(render).join('') : '<p class="muted">No matches.</p>'
  }</div>`;
}

export async function renderSearch() {
  setHeader('FIND ANYTHING', 'Search');
  view().innerHTML = `
    <div class="card">
      <div class="field"><label>SEARCH TERM</label><input id="searchTerm" placeholder="Client name, project title, task, artifact reference…"></div>
      <div class="actions"><button class="btn primary" id="runSearch">SEARCH</button></div>
    </div>
    <div id="searchResults"></div>`;

  const run = () => withErrorToast(async () => {
    const term = document.getElementById('searchTerm').value.trim();
    const { clients, projects, tasks, artifacts } = await search(term);
    document.getElementById('searchResults').innerHTML = [
      section('CLIENTS', clients, (c) => `<div class="status-row"><span>${esc(c.name)}</span><span class="status">${esc(c.status)}</span></div>`),
      section('PROJECTS', projects, (p) => `<div class="status-row"><span>${esc(p.title)}</span><span class="status">${esc(p.status)}</span></div>`),
      section('TASKS', tasks, (t) => `<div class="status-row"><span>${esc(t.title)}</span><span class="status">${esc(t.status)}</span></div>`),
      section('ARTIFACTS', artifacts, (a) => `<div class="status-row"><span>${esc(a.reference)}</span><span class="status">${esc(a.type)}</span></div>`),
    ].join('');
  });

  document.getElementById('runSearch').onclick = run;
  document.getElementById('searchTerm').onkeydown = (e) => { if (e.key === 'Enter') run(); };
}
