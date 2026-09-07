// Today — the daily command center. A derived view (no storage of its own): the Jarvie briefing
// plus real data pulled together from calendar, tasks, Business Health and the Digital Door flow.
// Everything here comes from todayBrief() -> gatherDay() in src/lib/jarvie.js, which reads the
// same live queries the rest of the app uses. Empty states are truthful — a card only claims
// something when its list is non-empty.

import { esc, setHeader } from '../lib/ui.js';
import { todayBrief } from '../lib/jarvie.js';
import { setJarvieState, jarvieFigureHTML, jarviePresent } from '../lib/jarvieOrb.js';

const CAT = { personal: 'Personal', family: 'Family', digital_side: 'Digital Side' };
function hhmm(s) {
  try {
    const d = new Date(String(s).replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { /* fall through */ }
  return String(s).slice(11, 16) || '';
}
const mdy = (s) => new Date(`${String(s).slice(0, 10)}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const row = (a, b) => `<div class="status-row"><span>${a}</span>${b ? `<span class="status">${b}</span>` : ''}</div>`;

export async function renderToday(goTo) {
  setHeader('DAILY BRIEFING', 'Today');
  const view = document.getElementById('view');
  const brief = await todayBrief();
  const d = brief.day;
  const jState = { urgent: 'urgent', attention: 'found_something', clear: 'idle' }[brief.pressure] || 'idle';

  const { calToday, calSoon, overdue, highPri, approvals, dueSoon, midBriefs } = d;
  const priorityCount = overdue.length + highPri.length;

  view.innerHTML = `
    <div class="card glow jarvie-brief" data-jarvie-host>
      <div class="jarvie-brief__figure">${jarvieFigureHTML({ size: 66 })}</div>
      <div class="jarvie-brief__body">
        <div class="kicker">JARVIE · DAILY BRIEFING</div>
        <div class="jarvie-brief__say">${esc(brief.headline)}</div>
        ${brief.top ? `<p class="muted" style="margin-top:7px">Start with <strong style="color:var(--off)">${esc(brief.top.label)}</strong></p>` : ''}
        <div class="actions">
          ${brief.top ? `<button class="btn primary" data-go="${esc(brief.top.goTo)}">OPEN →</button>` : ''}
          <button class="btn" data-go="jarvie">ASK JARVIE</button>
        </div>
      </div>
    </div>

    <div class="grid three" style="margin-top:14px">
      <div class="card ${calToday.length ? 'glow' : ''}">
        <div class="kicker">EVENTS TODAY</div><div class="metric">${calToday.length}</div>
        <div class="muted">${calToday.length ? esc(`${hhmm(calToday[0].starts_at)} · ${calToday[0].title}`) : 'Calendar is clear today.'}</div>
      </div>
      <div class="card ${priorityCount ? 'glow' : ''}">
        <div class="kicker">PRIORITY TASKS</div><div class="metric">${priorityCount}</div>
        <div class="muted">${overdue.length ? `${overdue.length} overdue, ` : ''}${highPri.length} high-priority.</div>
      </div>
      <div class="card ${approvals.length ? 'glow' : ''}">
        <div class="kicker">AWAITING YOU</div><div class="metric">${approvals.length}</div>
        <div class="muted">Handoffs returned for approve / reject.</div>
      </div>
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="card">
        <div class="kicker">TODAY'S CALENDAR</div>
        ${calToday.length
          ? calToday.map((e) => row(
              `${esc(hhmm(e.starts_at))} · ${esc(e.title)} <span class="muted">· ${esc(CAT[e.category] || e.category)}</span>`,
              e.location ? esc(e.location) : ''
            )).join('')
          : '<p class="muted">Nothing on the calendar today.</p>'}
        <div class="actions"><button class="btn" data-go="calendar">OPEN CALENDAR</button></div>
      </div>
      <div class="card">
        <div class="kicker">COMING UP · NEXT FEW DAYS</div>
        ${calSoon.length
          ? calSoon.map((e) => row(`${esc(mdy(e.starts_at))} ${esc(hhmm(e.starts_at))} · ${esc(e.title)}`, esc(CAT[e.category] || e.category))).join('')
          : '<p class="muted">Nothing on the calendar in the next few days.</p>'}
        ${dueSoon.length ? `<div class="kicker" style="margin-top:12px">TASKS DUE THIS WEEK</div>${dueSoon.map((t) => row(`${esc(t.title)} <span class="muted">· ${esc(t.priority)}</span>`, `due ${esc(t.due_date)}`)).join('')}` : ''}
      </div>
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="card ${priorityCount ? 'glow' : ''}">
        <div class="kicker">PRIORITY & OVERDUE TASKS</div>
        ${overdue.map((t) => row(`<span style="color:var(--red)">⚠ ${esc(t.title)}</span>`, `was due ${esc(t.due_date)}`)).join('')}
        ${highPri.map((t) => row(`${esc(t.title)} <span class="muted">· ${esc(t.priority)}</span>`, esc(t.due_date || 'no due date'))).join('')}
        ${!priorityCount ? '<p class="muted">Nothing urgent open right now.</p>' : ''}
        <div class="actions"><button class="btn" data-go="tasks">GO TO TASKS</button></div>
      </div>
      <div class="card ${approvals.length ? 'glow' : ''}">
        <div class="kicker">NEEDS A DECISION</div>
        ${approvals.length
          ? approvals.map((h) => row(esc(h.objective), `${esc(h.from_worker)} → ${esc(h.to_worker)}`)).join('')
          : '<p class="muted">Nothing waiting on your approval.</p>'}
        ${midBriefs.length ? `<div class="kicker" style="margin-top:12px">DOOR WORK IN PROGRESS</div>${midBriefs.map((b) => row(esc(b.business || 'Untitled mission'), esc((b.planning_step || '').toUpperCase()))).join('')}` : ''}
        <div class="actions"><button class="btn" data-go="ai">AI DESK</button><button class="btn" data-go="door">DOOR WORKFLOW</button></div>
      </div>
    </div>`;

  view.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => goTo(b.dataset.go));
  // Jarvie reflects the day's real pressure; no performance just for arriving here.
  setJarvieState(jState, { react: false });
  jarviePresent(); // he travels over from the dock to deliver the briefing
}
