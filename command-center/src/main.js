import { initDb } from './lib/db.js';
import { loadLegacyState } from './lib/legacyState.js';
import { listIntegrations } from './lib/queries.js';
import { withErrorToast } from './lib/ui.js';

import { renderToday } from './screens/today.js';
import { renderDoor } from './screens/door.js';
import { renderClients } from './screens/clients.js';
import { renderTasks } from './screens/tasks.js';
import { renderInbox } from './screens/inbox.js';
import { renderHandoffs } from './screens/handoffs.js';
import { renderActivity } from './screens/activity.js';
import { renderHealth } from './screens/health.js';
import { renderIntegrations } from './screens/integrations.js';
import { renderBackup } from './screens/backupScreen.js';
import { renderSearch } from './screens/search.js';
import { renderInventory, renderJobs, renderRunway, renderWatch, renderMoney } from './screens/legacyScreens.js';

// Groups map to PHASE1-SPEC.md §9 (Phase 1) and the pre-existing screens preserved as working
// functionality but not part of the spec (see docs/DECISIONS.md).
const NAV = [
  { group: 'PHASE 1' },
  ['today', 'TODAY'],
  ['door', 'DOOR WORKFLOW'],
  ['clients', 'CLIENTS'],
  ['tasks', 'TASKS'],
  ['inbox', 'INBOX'],
  ['ai', 'AI DESK'],
  ['activity', 'ACTIVITY LOG'],
  ['health', 'BUSINESS HEALTH'],
  ['integrations', 'INTEGRATIONS'],
  ['backup', 'BACKUP'],
  ['search', 'SEARCH'],
  { group: 'LEGACY' },
  ['jobs', 'CLIENT JOBS'],
  ['inventory', 'INVENTORY'],
  ['runway', 'RUNWAY'],
  ['watch', 'WATCHTOWER'],
  ['money', 'MONEY'],
];

const SCREENS = {
  today: () => renderToday(goTo),
  door: renderDoor,
  clients: renderClients,
  tasks: renderTasks,
  inbox: renderInbox,
  ai: renderHandoffs,
  activity: renderActivity,
  health: renderHealth,
  integrations: renderIntegrations,
  backup: renderBackup,
  search: renderSearch,
  jobs: renderJobs,
  inventory: renderInventory,
  runway: renderRunway,
  watch: renderWatch,
  money: renderMoney,
};

let active = 'today';

function goTo(id) { active = id; render(); }

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map((entry) => {
    if (entry.group) return `<div class="navgroup">${entry.group}</div>`;
    const [id, label] = entry;
    return `<button class="navbtn ${active === id ? 'active' : ''}" data-nav="${id}"><span>${label}</span><span>›</span></button>`;
  }).join('');
  nav.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => goTo(b.dataset.nav));
}

async function renderSystems() {
  const strip = document.getElementById('systemStrip');
  try {
    const integrations = await listIntegrations();
    strip.innerHTML = integrations
      .map((i) => `<span class="chip ${i.connection_type === 'automated' && i.status === 'connected' ? 'on' : ''}">${i.service_name} · ${i.status.toUpperCase()}</span>`)
      .join('');
  } catch {
    strip.innerHTML = '';
  }
}

async function render() {
  renderNav();
  await renderSystems();
  const fn = SCREENS[active] || SCREENS.today;
  await withErrorToast(() => fn());
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  document.getElementById('offlineState').classList.toggle('off', !navigator.onLine);
}

async function boot() {
  try {
    await initDb();
    await loadLegacyState();
  } catch (err) {
    console.error(err);
    document.getElementById('offlineState')?.classList.add('off');
  }
  await render();
  tick();
  setInterval(tick, 30000);
  document.getElementById('shell').hidden = false;
  setTimeout(() => {
    document.getElementById('boot').classList.add('is-done');
    setTimeout(() => document.getElementById('boot').remove(), 600);
  }, 750);
}

boot();
