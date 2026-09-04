// Digital Door pipeline — PHASE1-SPEC.md §9.4. Uses AdvanceDoorStage/UpdateDoorBriefField.
// Rebuilt onto the digital_door_brief table (was a KV blob); the 6-step sequence itself
// (Outcome → Customer → Paths → Destinations → Build → Handoff) is unchanged from
// docs/DIGITAL-DOOR-WORKFLOW.md and the field-collision fix from docs/CLAUDE-AUDIT-RESULTS.md
// (distinct urgentNeed/customerIntent keys) is preserved by construction — see actions.js
// DOOR_FIELDS / DOOR_FIELD_COLUMN.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { listDoorBriefs, listClients } from '../lib/queries.js';
import { CreateDoorBrief, UpdateDoorBriefField, AdvanceDoorStage } from '../lib/actions.js';

const STAGES = ['outcome', 'customer', 'paths', 'destinations', 'build', 'handoff'];
const DOOR_STEPS = [
  ['1. OUTCOME', 'What does this business actually need to accomplish?'],
  ['2. CUSTOMER', 'Who is arriving and what are they trying to do?'],
  ['3. PATHS', 'Turn those needs into the shortest useful routes.'],
  ['4. DESTINATIONS', 'Where should each path end? No dead ends.'],
  ['5. BUILD', 'Choose the pieces required to make the route real.'],
  ['6. HANDOFF', "Define the purposeful next step into the client's ecosystem."],
];

let activeBriefId = null;
let activeStep = 0;
let showSummary = false;

function view() { return document.getElementById('view'); }

export async function renderDoor() {
  setHeader('GUIDED PRODUCT WORKFLOW', 'Digital Door Mission');
  if (!activeBriefId) return renderList();
  if (showSummary) return renderSummary();
  return renderWizard();
}

async function renderList() {
  const [briefs, clients] = await Promise.all([listDoorBriefs(), listClients()]);
  const clientName = (id) => clients.find((c) => c.id === id)?.name;

  view().innerHTML = `
    <div class="card">
      <div class="kicker">START A NEW DOOR MISSION</div>
      <div class="field"><label>CLIENT (OPTIONAL)</label>
        <select id="newBriefClient"><option value="">No client yet</option>${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>PROJECT / BUSINESS NAME</label><input id="newBriefBusiness" placeholder="Frederick Legacy Law"></div>
      <div class="actions"><button class="btn primary" id="startBrief">START MISSION</button></div>
    </div>
    <div class="grid two" style="margin-top:14px">
      ${briefs.length ? briefs.map((b) => `
        <div class="card ${b.stage !== 'complete' ? 'glow' : ''}" data-open="${esc(b.id)}" style="cursor:pointer">
          <div class="kicker">${esc((clientName(b.client_id) || 'NO CLIENT').toUpperCase())}</div>
          <div class="big">${esc(b.business || 'Untitled mission')}</div>
          <div class="muted">Stage: ${esc(b.stage.toUpperCase())}</div>
        </div>`).join('') : '<p class="muted">No Door missions yet — start one above.</p>'}
    </div>`;

  document.getElementById('startBrief').onclick = () => withErrorToast(async () => {
    const id = await CreateDoorBrief({
      clientId: document.getElementById('newBriefClient').value || null,
      business: document.getElementById('newBriefBusiness').value.trim(),
    });
    activeBriefId = id; activeStep = 0; showSummary = false;
    renderDoor();
  });
  view().querySelectorAll('[data-open]').forEach((el) => el.onclick = () => {
    const b = briefs.find((x) => x.id === el.dataset.open);
    activeBriefId = el.dataset.open;
    activeStep = Math.max(0, STAGES.indexOf(b?.stage));
    if (activeStep < 0) activeStep = 0;
    showSummary = false;
    renderDoor();
  });
}

function doorField(brief, label, key, placeholder, kind = 'textarea') {
  const val = brief[key] || '';
  return `<div class="field"><label>${label}</label>${kind === 'input'
    ? `<input data-field="${key}" value="${esc(val)}" placeholder="${esc(placeholder)}">`
    : `<textarea data-field="${key}" placeholder="${esc(placeholder)}">${esc(val)}</textarea>`}</div>`;
}

function stepBody(brief, step) {
  if (step === 0) return `${doorField(brief, 'PRIMARY BUSINESS GOAL', 'primary_goal', 'Example: make it effortless for a mobile visitor to choose the right next action.')}${doorField(brief, 'WHAT WOULD MAKE THIS PROJECT A WIN?', 'urgent_need', 'What must be better after this is built?')}`;
  if (step === 1) return `${doorField(brief, 'WHO IS ARRIVING?', 'customer', 'Describe the actual people, not a marketing persona.')}${doorField(brief, 'WHAT ARE THEY TRYING TO DO?', 'customer_intent', 'Book, call, understand services, get directions, submit info, etc.')}${doorField(brief, 'BRAND VOICE / FEEL', 'tone', 'How should the client sound and feel?')}`;
  if (step === 2) return doorField(brief, 'CUSTOMER PATHS', 'paths', 'One per line. Example:\nI know what I need\nI need help choosing\nI’m already a client');
  if (step === 3) return doorField(brief, 'PATH DESTINATIONS', 'destinations', 'Map each path to a useful destination/action. Every route must resolve somewhere useful.');
  if (step === 4) return `${doorField(brief, 'BUILD PIECES', 'deliverables', 'Digital Key\nDigital Door\nCustomer Paths\nMobile Rescue\nFull-site handoff')}${doorField(brief, 'BUILD NOTES', 'notes', 'Special interactions, assets, constraints, deadlines.')}`;
  return `${doorField(brief, 'FULL-SITE / NEXT-STEP HANDOFF', 'handoff', 'Write the purposeful handoff in the CLIENT’S brand voice. Never generic “View Full Site.”')}${doorField(brief, 'FINAL NOTES', 'notes', 'Anything another AI or builder needs to know.')}`;
}

// Field keys in the DOM (snake_case, matching table columns) -> action field keys (camelCase,
// matching DOOR_FIELDS in actions.js).
const FIELD_KEY_MAP = { primary_goal: 'primaryGoal', urgent_need: 'urgentNeed', customer_intent: 'customerIntent' };

async function captureFields(brief) {
  const inputs = [...view().querySelectorAll('[data-field]')];
  for (const el of inputs) {
    const domKey = el.dataset.field;
    const val = el.value.trim();
    if ((brief[domKey] || '') === val) continue;
    const field = FIELD_KEY_MAP[domKey] || domKey;
    await UpdateDoorBriefField({ id: brief.id, field, value: val });
    brief[domKey] = val;
  }
}

async function renderWizard() {
  const briefs = await listDoorBriefs();
  const brief = briefs.find((b) => b.id === activeBriefId);
  if (!brief) { activeBriefId = null; return renderDoor(); }
  const s = Math.max(0, Math.min(5, activeStep));
  const persistedStep = brief.stage === 'complete' ? 6 : Math.max(0, STAGES.indexOf(brief.stage));

  view().innerHTML = `<div class="workflow">
    <div class="steps">${DOOR_STEPS.map((x, i) => `<button class="step ${i === s ? 'active' : ''} ${i < persistedStep ? 'done' : ''}" data-step="${i}">${x[0]}</button>`).join('')}</div>
    <div class="card glow">
      <div class="kicker">STEP ${s + 1} OF 6 · BRIEF STAGE: ${esc(brief.stage.toUpperCase())}</div>
      <div class="big">${DOOR_STEPS[s][0].replace(/^\d\. /, '')}</div>
      <div class="muted">${DOOR_STEPS[s][1]}</div>
      ${stepBody(brief, s)}
      <div class="actions">
        <button class="btn" data-prev ${s === 0 ? 'disabled' : ''}>BACK</button>
        <button class="btn primary" data-next>${s === 5 ? (brief.stage === 'complete' ? 'ALREADY LAUNCHED' : 'LAUNCH MISSION') : 'SAVE + NEXT'}</button>
        <button class="btn" data-summary>MISSION SUMMARY</button>
        <button class="btn" data-back-list>← ALL MISSIONS</button>
      </div>
    </div>
  </div>`;

  view().querySelectorAll('[data-step]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await captureFields(brief);
    activeStep = Number(b.dataset.step);
    renderDoor();
  }));
  view().querySelector('[data-prev]').onclick = () => withErrorToast(async () => {
    await captureFields(brief);
    activeStep = Math.max(0, s - 1);
    renderDoor();
  });
  view().querySelector('[data-next]').onclick = () => withErrorToast(async () => {
    await captureFields(brief);
    if (brief.stage === 'complete') return;
    const nextStageName = s === 5 ? 'complete' : STAGES[s + 1];
    await AdvanceDoorStage({ id: brief.id, toStage: nextStageName });
    activeStep = Math.min(5, s + 1);
    renderDoor();
  });
  view().querySelector('[data-summary]').onclick = () => withErrorToast(async () => {
    await captureFields(brief);
    showSummary = true;
    renderDoor();
  });
  view().querySelector('[data-back-list]').onclick = () => withErrorToast(async () => {
    await captureFields(brief);
    activeBriefId = null;
    renderDoor();
  });
}

async function renderSummary() {
  const briefs = await listDoorBriefs();
  const d = briefs.find((b) => b.id === activeBriefId);
  if (!d) { activeBriefId = null; return renderDoor(); }
  const nl = (v) => esc(v || 'Not defined').replace(/\n/g, '<br>');

  view().innerHTML = `<div class="card glow">
    <div class="kicker">${esc(d.business || 'UNTITLED PROJECT')} · ${esc(d.stage.toUpperCase())}</div>
    <div class="big">DOOR MISSION BRIEF</div>
    <div class="grid two" style="margin-top:16px">
      <div>
        <div class="kicker">OUTCOME</div><p class="muted">${nl(d.primary_goal)}</p>
        <div class="kicker">CUSTOMER</div><p class="muted">${nl(d.customer)}</p>
        <div class="kicker">CUSTOMER INTENT</div><p class="muted">${nl(d.customer_intent)}</p>
        <div class="kicker">URGENT / HIGH-VALUE NEED</div><p class="muted">${nl(d.urgent_need)}</p>
        <div class="kicker">VOICE</div><p class="muted">${nl(d.tone)}</p>
      </div>
      <div>
        <div class="kicker">PATHS</div><p class="muted">${nl(d.paths)}</p>
        <div class="kicker">DESTINATIONS</div><p class="muted">${nl(d.destinations)}</p>
        <div class="kicker">BUILD PIECES</div><p class="muted">${nl(d.deliverables)}</p>
        <div class="kicker">HANDOFF</div><p class="muted">${nl(d.handoff)}</p>
        <div class="kicker">NOTES</div><p class="muted">${nl(d.notes)}</p>
      </div>
    </div>
    <div class="actions">
      <button class="btn primary" data-edit>EDIT WORKFLOW</button>
      <button class="btn" data-back-list>← ALL MISSIONS</button>
    </div>
  </div>`;

  view().querySelector('[data-edit]').onclick = () => { showSummary = false; renderDoor(); };
  view().querySelector('[data-back-list]').onclick = () => { activeBriefId = null; showSummary = false; renderDoor(); };
}
