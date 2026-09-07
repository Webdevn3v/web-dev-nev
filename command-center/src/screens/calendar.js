// Calendar — migration 007. Nev's personal day + family/school + The Digital Side, in one place.
//
// Storage: calendar_event, written only through src/lib/actions.js (single-writer boundary — no
// `.execute(` lives outside actions.js). starts_at / ends_at are naive local wall-clock strings
// 'YYYY-MM-DDTHH:MM' (NOT ISO/UTC) so month-bucketing and Jarvie's day/week filters are plain
// string comparisons with no timezone drift. created_at / updated_at stay ISO-UTC like the rest
// of the app's audit fields.
//
// Personal calendar data deliberately never reaches the Activity Log or any client/project
// record: calendar_event has no activity_event trigger (docs/JARVIE-PERSONA.md "Two Worlds").
//
// Desktop-first month grid + selected-day panel + add/edit panel + upcoming list, collapsing to
// a single column on narrow layouts. The sidebar shell is untouched.

import { esc, setHeader, withErrorToast, toast } from '../lib/ui.js';
import { listCalendarEventsBetween, listUpcomingCalendarEvents } from '../lib/queries.js';
import { CreateCalendarEvent, UpdateCalendarEvent, DeleteCalendarEvent } from '../lib/actions.js';
import { confirmGate } from '../lib/confirm.js';
import { TIER } from '../lib/risk.js';

const CATEGORIES = [
  { value: 'personal', label: 'Personal' },
  { value: 'family', label: 'Family' },
  { value: 'digital_side', label: 'Digital Side' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Screen-local view state. Persists while the app is open; the DB is always the source of truth.
const state = { year: null, month: null, selected: null, filter: 'all', editingId: null };

function view() { return document.getElementById('view'); }
function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function parseLocal(s) { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d.getTime()) ? null : d; }

function fmtTime(s) {
  const d = parseLocal(s);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : (String(s).slice(11, 16) || '');
}
function fmtRange(e) {
  const start = fmtTime(e.starts_at);
  const end = e.ends_at ? fmtTime(e.ends_at) : '';
  return end ? `${start} – ${end}` : start;
}
function fmtDayHeading(dateStr) {
  const d = parseLocal(`${dateStr}T00:00`);
  if (!d) return dateStr;
  const rel = dateStr === localDateStr() ? 'Today · '
    : dateStr === localDateStr(addDays(new Date(), 1)) ? 'Tomorrow · ' : '';
  return rel + d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
function shownBy(filter) { return (e) => filter === 'all' || e.category === filter; }

export async function renderCalendar(goTo) {
  setHeader('PERSONAL + BUSINESS', 'Calendar');

  const now = new Date();
  const todayStr = localDateStr(now);
  if (state.year == null) { state.year = now.getFullYear(); state.month = now.getMonth(); }
  if (!state.selected) state.selected = todayStr;

  // 6-week grid window covering the visible month
  const gridStart = startOfWeek(new Date(state.year, state.month, 1));
  const gridEndExclusive = addDays(gridStart, 42);
  const [monthEvents, upcomingAll] = await Promise.all([
    listCalendarEventsBetween({ from: localDateStr(gridStart), to: localDateStr(gridEndExclusive) }),
    listUpcomingCalendarEvents({ from: todayStr }),
  ]);

  const pass = shownBy(state.filter);
  const byDay = new Map();
  for (const e of monthEvents.filter(pass)) {
    const day = e.starts_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));

  const selectedEvents = (byDay.get(state.selected) || []);
  const upcoming = upcomingAll.filter(pass).slice(0, 8);
  const editing = state.editingId ? upcomingAll.concat(monthEvents).find((e) => e.id === state.editingId) : null;
  if (state.editingId && !editing) state.editingId = null;

  view().innerHTML = `
    <div class="cal-screen">
      ${toolbarHtml()}
      <div class="grid two cal-main">
        ${monthHtml(gridStart, byDay, todayStr)}
        ${selectedDayHtml(selectedEvents)}
      </div>
      <div class="grid two cal-lower">
        ${formHtml(editing)}
        ${upcomingHtml(upcoming)}
      </div>
    </div>`;

  wire(goTo);
}

// ---------------------------------------------------------------- markup

function toolbarHtml() {
  const chip = (value, label) => {
    const active = state.filter === value ? ' is-active' : '';
    const dot = value === 'all' ? '' : `<i class="cal-dot cal-dot--${value}"></i>`;
    return `<button class="cal-chip cal-chip--${value}${active}" data-filter="${value}">${dot}${label}</button>`;
  };
  return `
    <div class="card cal-bar">
      <div class="cal-nav">
        <button class="btn cal-icon" data-mv="-1" aria-label="Previous month">‹</button>
        <strong class="cal-monthlabel">${MONTHS[state.month]} ${state.year}</strong>
        <button class="btn cal-icon" data-mv="1" aria-label="Next month">›</button>
        <button class="btn" data-mv="today">Today</button>
      </div>
      <div class="cal-filters">
        ${chip('all', 'All')}
        ${chip('personal', 'Personal')}
        ${chip('family', 'Family')}
        ${chip('digital_side', 'Digital Side')}
      </div>
    </div>`;
}

function monthHtml(gridStart, byDay, todayStr) {
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const ds = localDateStr(d);
    const out = d.getMonth() !== state.month ? ' is-out' : '';
    const isToday = ds === todayStr ? ' is-today' : '';
    const isSel = ds === state.selected ? ' is-selected' : '';
    const evs = byDay.get(ds) || [];
    const dots = evs.slice(0, 4).map((e) => `<i class="cal-dot cal-dot--${e.category}"></i>`).join('');
    const more = evs.length > 4 ? `<span class="cal-more">+${evs.length - 4}</span>` : '';
    cells += `
      <button class="cal-cell${out}${isToday}${isSel}" data-day="${ds}">
        <span class="cal-cell__num">${d.getDate()}</span>
        <span class="cal-cell__dots">${dots}${more}</span>
      </button>`;
  }
  return `
    <div class="card cal-month">
      <div class="cal-weekhead">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
}

function eventRowHtml(e) {
  const meta = [e.location ? esc(e.location) : '', e.notes ? esc(e.notes) : ''].filter(Boolean).join(' — ');
  return `
    <div class="cal-event">
      <div class="cal-event__body">
        <div class="cal-event__top">
          <span class="cal-time">${esc(fmtRange(e) || 'all day')}</span>
          <span class="cal-tag cal-tag--${esc(e.category)}">${esc(CATEGORY_LABEL[e.category] || e.category)}</span>
        </div>
        <strong>${esc(e.title)}</strong>
        ${meta ? `<div class="muted">${meta}</div>` : ''}
      </div>
      <div class="cal-event__actions">
        <button class="btn cal-icon" data-edit="${esc(e.id)}" aria-label="Edit">✎</button>
        <button class="btn cal-icon" data-del="${esc(e.id)}" data-title="${esc(e.title)}" aria-label="Delete">✕</button>
      </div>
    </div>`;
}

function selectedDayHtml(events) {
  return `
    <div class="card cal-day">
      <div class="kicker">SELECTED DAY</div>
      <div class="cal-day__head">${esc(fmtDayHeading(state.selected))}</div>
      ${events.length
        ? events.map(eventRowHtml).join('')
        : `<p class="muted">Nothing scheduled${state.filter === 'all' ? '' : ` in ${esc(CATEGORY_LABEL[state.filter])}`}.</p>`}
      <div class="actions">
        <button class="btn primary" data-newday>+ Add on this day</button>
      </div>
    </div>`;
}

function formHtml(editing) {
  const v = (k, d = '') => esc(editing ? (editing[k] ?? '') : d);
  const date = editing ? editing.starts_at.slice(0, 10) : state.selected;
  const start = editing ? editing.starts_at.slice(11, 16) : '09:00';
  const end = editing && editing.ends_at ? editing.ends_at.slice(11, 16) : '';
  const cat = editing ? editing.category : (state.filter === 'all' ? 'personal' : state.filter);
  const catOpts = CATEGORIES.map((c) => `<option value="${c.value}" ${c.value === cat ? 'selected' : ''}>${c.label}</option>`).join('');
  return `
    <div class="card cal-form">
      <div class="kicker">${editing ? 'EDIT EVENT' : 'ADD EVENT'}</div>
      <div class="cal-form__grid">
        <label class="field cal-span2"><span>Title</span><input id="calTitle" value="${v('title')}" placeholder="Dentist · Zen's football · Client call" autocomplete="off"></label>
        <label class="field"><span>Category</span><select id="calCategory">${catOpts}</select></label>
        <label class="field"><span>Date</span><input id="calDate" type="date" value="${esc(date)}"></label>
        <label class="field"><span>Start</span><input id="calStart" type="time" value="${esc(start)}"></label>
        <label class="field"><span>End <em>(optional)</em></span><input id="calEnd" type="time" value="${esc(end)}"></label>
        <label class="field cal-span2"><span>Location <em>(optional)</em></span><input id="calLocation" value="${v('location')}" placeholder="Address · link · room" autocomplete="off"></label>
        <label class="field cal-span2"><span>Notes <em>(optional)</em></span><textarea id="calNotes" placeholder="Anything Jarvie should know.">${v('notes')}</textarea></label>
      </div>
      <div class="actions">
        <button class="btn primary" data-save>${editing ? 'Save changes' : 'Add event'}</button>
        ${editing ? '<button class="btn" data-canceledit>Cancel edit</button>' : ''}
        <button class="btn" data-go="jarvie">Ask Jarvie about my day →</button>
      </div>
    </div>`;
}

function upcomingHtml(events) {
  const scope = state.filter === 'all' ? '' : ` · ${esc(CATEGORY_LABEL[state.filter])}`;
  if (!events.length) {
    return `<div class="card"><div class="kicker">UPCOMING${scope}</div><p class="muted">Nothing ahead. Add an event and Jarvie will keep track.</p></div>`;
  }
  let html = '';
  let lastDay = null;
  for (const e of events) {
    const day = e.starts_at.slice(0, 10);
    if (day !== lastDay) { html += `<div class="cal-up__day">${esc(fmtDayHeading(day))}</div>`; lastDay = day; }
    html += `
      <button class="cal-up__row" data-day="${esc(day)}">
        <span class="cal-time">${esc(fmtTime(e.starts_at))}</span>
        <span class="cal-up__title">${esc(e.title)}</span>
        <span class="cal-tag cal-tag--${esc(e.category)}">${esc(CATEGORY_LABEL[e.category] || e.category)}</span>
      </button>`;
  }
  return `<div class="card cal-up"><div class="kicker">UPCOMING${scope}</div>${html}</div>`;
}

// ---------------------------------------------------------------- behaviour

function wire(goTo) {
  const root = view();
  const rerender = () => renderCalendar(goTo);

  root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => goTo(b.dataset.go));

  root.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
    const mv = b.dataset.mv;
    if (mv === 'today') {
      const t = new Date();
      state.year = t.getFullYear(); state.month = t.getMonth(); state.selected = localDateStr(t);
    } else {
      const m = state.month + Number(mv);
      state.year += Math.floor(m / 12);
      state.month = ((m % 12) + 12) % 12;
    }
    rerender();
  });

  root.querySelectorAll('[data-filter]').forEach((b) => b.onclick = () => { state.filter = b.dataset.filter; rerender(); });

  root.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => {
    state.selected = b.dataset.day;
    const d = parseLocal(`${b.dataset.day}T00:00`);
    if (d) { state.year = d.getFullYear(); state.month = d.getMonth(); }
    rerender();
  });

  root.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { state.editingId = b.dataset.edit; rerender(); });
  const cancelEdit = root.querySelector('[data-canceledit]');
  if (cancelEdit) cancelEdit.onclick = () => { state.editingId = null; rerender(); };

  const newDay = root.querySelector('[data-newday]');
  if (newDay) newDay.onclick = () => withErrorToast(async () => {
    state.editingId = null;
    await rerender();
    const t = document.getElementById('calTitle');
    if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); }
  });

  const save = root.querySelector('[data-save]');
  if (save) save.onclick = () => withErrorToast(async () => {
    const title = document.getElementById('calTitle').value.trim();
    const date = document.getElementById('calDate').value;
    const start = document.getElementById('calStart').value;
    const end = document.getElementById('calEnd').value;
    const category = document.getElementById('calCategory').value;
    if (!title) { toast('Give the event a title first.', true); return; }
    if (!date) { toast('Pick a date.', true); return; }
    if (!start) { toast('Set a start time.', true); return; }
    const startsAt = `${date}T${start}`;
    const endsAt = end ? `${date}T${end}` : null;
    if (endsAt && endsAt < startsAt) { toast('End time is before the start time.', true); return; }
    const payload = {
      title, category, startsAt, endsAt,
      location: document.getElementById('calLocation').value.trim() || null,
      notes: document.getElementById('calNotes').value.trim() || null,
    };
    if (state.editingId) {
      await UpdateCalendarEvent({ id: state.editingId, ...payload });
      toast('Event updated.');
    } else {
      await CreateCalendarEvent(payload);
      toast('Event added.');
    }
    state.editingId = null;
    state.selected = date;
    const d = parseLocal(`${date}T00:00`);
    if (d) { state.year = d.getFullYear(); state.month = d.getMonth(); }
    rerender();
  });

  root.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const ok = await confirmGate({
      tier: TIER.REVERSIBLE_LOCAL,
      title: 'Delete this event?',
      detail: `“${b.dataset.title}” will be removed from your calendar.`,
    });
    if (!ok) { toast('Kept it.'); return; }
    await DeleteCalendarEvent({ id: b.dataset.del });
    if (state.editingId === b.dataset.del) state.editingId = null;
    toast('Event deleted.');
    rerender();
  }));
}
