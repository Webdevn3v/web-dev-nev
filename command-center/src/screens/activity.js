// Activity Log — PHASE1-SPEC.md §9.7. Plain chronological view, filterable by entity type.

import { esc, setHeader, fmtDate, withErrorToast } from '../lib/ui.js';
import { listActivityEvents } from '../lib/queries.js';

const ENTITY_TYPES = ['client', 'project', 'task', 'digital_door_brief', 'artifact', 'handoff', 'inbox_item', 'legacy_state'];

let filter = '';

function view() { return document.getElementById('view'); }

export async function renderActivity() {
  setHeader('SYSTEM OF RECORD', 'Activity Log');
  const events = await listActivityEvents(filter ? { entityType: filter } : {});

  view().innerHTML = `
    <div class="card">
      <div class="kicker">FILTER BY ENTITY</div>
      <select id="filterEntity">
        <option value="">All entities</option>
        ${ENTITY_TYPES.map((t) => `<option value="${t}" ${filter === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">${events.length} EVENT${events.length === 1 ? '' : 'S'}</div>
      ${events.length ? events.map((e) => `
        <div class="status-row">
          <span><strong>${esc(e.event_type)}</strong> <span class="muted">${esc(e.actor)}${e.related_entity_type ? ` · ${esc(e.related_entity_type)}#${esc((e.related_entity_id || '').slice(0, 12))}` : ''}</span></span>
          <span class="status">${fmtDate(e.created_at)}</span>
        </div>`).join('') : '<p class="muted">No events yet.</p>'}
    </div>`;

  document.getElementById('filterEntity').onchange = (e) => withErrorToast(async () => {
    filter = e.target.value;
    renderActivity();
  });
}
