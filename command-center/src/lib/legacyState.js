// In-memory state for the pre-Phase-1 screens (Inventory, Client Jobs, Runway/Missions,
// Watchtower, Money) that predate PHASE1-SPEC.md and aren't part of it. Preserved as working
// functionality (per the build instructions) but now persisted only through the SaveLegacyState
// action (src/lib/actions.js) instead of the old ad-hoc app_state KV writes, so nothing bypasses
// the action layer. See docs/DECISIONS.md.

import { SaveLegacyState } from './actions.js';
import { getLegacyState } from './queries.js';

const SEED = {
  missions: [
    { id: 'legit', name: 'MAKE TDS LEGIT', tag: 'BUSINESS', progress: 40, status: 'active', note: 'LLC → EIN → bank → developer infrastructure' },
    { id: 'product', name: 'LOCK THE DIGITAL DOOR SYSTEM', tag: 'PRODUCT', progress: 72, status: 'active', note: 'Door + Key + Customer Paths + purposeful handoff' },
    { id: 'sales', name: 'TURN DEMOS INTO CLIENTS', tag: 'SALES', progress: 18, status: 'warn', note: 'Portfolio → outreach → consult → deposit' },
  ],
  runway: [
    ['NOW / LEGIT', 40], ['SELLING', 18], ['PRODUCT', 72], ['PROTECTED', 8], ['DISCOVERABLE', 12], ['SCALING', 0],
  ],
  inventory: [],
  events: [{ id: 'event-2026-09-05', name: 'September 5 Event', date: '2026-09-05', clientId: 'stone-stardust', status: 'prep' }],
  customOrders: [],
  photoIntake: [],
  reconciliation: [],
  clientJobs: [
    { id: 'SS-JOB-001', clientId: 'stone-stardust', title: 'Build Inspo page', area: 'WEBSITE', status: 'next', priority: 'TONIGHT', note: 'Show the many ways strands can be displayed using the new lifestyle photos.' },
    { id: 'SS-JOB-002', clientId: 'stone-stardust', title: 'Replace Moonstone & Muse references', area: 'BRAND', status: 'next', priority: 'TONIGHT', note: 'Audit the site and update stale business-name copy to Stone & Stardust.' },
    { id: 'SS-JOB-003', clientId: 'stone-stardust', title: 'Add custom-order path', area: 'SALES', status: 'next', priority: 'TONIGHT', note: 'Make it easy for an event visitor to request a custom piece later.' },
    { id: 'SS-JOB-004', clientId: 'stone-stardust', title: 'Event follow-up path', area: 'SALES', status: 'queued', priority: 'EVENT', note: "Give tomorrow's visitors a clear way to find available work after the event." },
  ],
};

export const legacy = structuredClone(SEED);

export async function loadLegacyState() {
  for (const key of Object.keys(SEED)) {
    legacy[key] = await getLegacyState(key, SEED[key]);
  }
}

export async function saveLegacy(key) {
  await SaveLegacyState({ key, value: legacy[key] });
}
