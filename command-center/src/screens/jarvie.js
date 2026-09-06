// Ask Jarvie — screen. Phase A (read-only Q&A) + Phase B (typed commands: propose → you
// confirm → Jarvie executes; light conversation memory; "since I last looked").
// Specs: docs/JARVIE-PHASE-A.md, docs/JARVIE-PHASE-B.md.
// Imports the read module (jarvie.js) and the act module (jarvieAct.js) and ui.js — nothing else.

import { esc, setHeader, withErrorToast, toast } from '../lib/ui.js';
import { answerQuestion, suggestedQuestions, clearContext } from '../lib/jarvie.js';
import { parseCommand, executeProposal } from '../lib/jarvieAct.js';

const LAST_SEEN_KEY = 'jarvie:lastSeen';

let lastQuestion = '';
let lastRender = null; // { fn } — re-render the current result after an action

function view() { return document.getElementById('view'); }

function readLastSeen() {
  try { return localStorage.getItem(LAST_SEEN_KEY) || null; } catch { return null; }
}
function stampLastSeen() {
  try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* private mode / disabled — fine */ }
}

export async function renderJarvie(goTo) {
  setHeader('READ-ONLY ANSWERS + CONFIRMED ACTIONS', 'Ask Jarvie');
  clearContext(); // fresh visit → fresh "it"/"that"
  const sinceLastSeen = readLastSeen();
  stampLastSeen();
  const suggestions = await suggestedQuestions();

  view().innerHTML = `
    <div class="card">
      <div class="kicker">ASK OR TELL JARVIE</div>
      <div class="field">
        <label>QUESTION OR COMMAND</label>
        <input id="jarvieQ" placeholder="What needs me?  ·  advance Frederick to paths" value="${esc(lastQuestion)}" autocomplete="off">
      </div>
      <div class="actions"><button class="btn primary" id="jarvieAsk">SEND</button></div>
      <div class="actions">
        ${suggestions.map((q) => `<button class="btn" data-suggest="${esc(q)}">${esc(q)}</button>`).join('')}
        <button class="btn" data-suggest="What changed since I last looked?">What changed since I last looked?</button>
      </div>
      <p class="muted" style="margin-top:10px">Questions are read-only and unlogged. Commands are shown for your OK before anything changes — and still hit the normal approval step.</p>
    </div>
    <div id="jarvieAnswer" style="margin-top:14px"></div>`;

  const box = document.getElementById('jarvieAnswer');
  const input = document.getElementById('jarvieQ');

  const send = (q, entityId) => withErrorToast(async () => {
    lastQuestion = q;
    input.value = q;
    const proposal = await parseCommand(q, entityId || null);
    if (proposal) { renderCommand(box, goTo, proposal, q); return; }
    const a = await answerQuestion(q, { entityId: entityId || null, sinceLastSeen });
    renderAnswer(box, goTo, a);
  });

  document.getElementById('jarvieAsk').onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    send(q);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('jarvieAsk').click(); } };
  view().querySelectorAll('[data-suggest]').forEach((b) => b.onclick = () => send(b.dataset.suggest));

  if (lastRender) lastRender.fn(box, goTo);
}

// ---------------------------------------------------------------- read answers (Phase A)

function renderAnswer(box, goTo, a) {
  lastRender = { fn: (b, g) => renderAnswer(b, g, a) };
  box.innerHTML = `
    <div class="card glow">
      <div class="kicker">${esc(String(a.intent || 'answer').replace(/_/g, ' ').toUpperCase())}</div>
      <div class="big">${esc(a.title)}</div>
      <p class="muted">${esc(a.summary)}</p>
      ${a.evidence && a.evidence.length ? `
        <div class="kicker" style="margin-top:14px">EVIDENCE · ${a.evidence.length}</div>
        ${a.evidence.map((ev) => `
          <div class="status-row">
            <span>${esc(ev.label)}</span>
            <span class="actions" style="margin-top:0">
              ${ev.reask ? `<button class="btn" data-reask="${esc(ev.reask)}" data-eid="${esc(ev.id)}">THIS ONE</button>` : ''}
              ${ev.goTo ? `<button class="btn" data-goto="${esc(ev.goTo)}">OPEN →</button>` : ''}
            </span>
          </div>`).join('')}
      ` : '<p class="muted" style="margin-top:12px">No supporting records.</p>'}
    </div>`;
  wireLinks(box, goTo);
  box.querySelectorAll('[data-reask]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    const q = document.getElementById('jarvieQ').value.trim();
    const a2 = await answerQuestion(q, { entityId: b.dataset.eid });
    renderAnswer(box, goTo, a2);
  }));
}

// ---------------------------------------------------------------- commands (Phase B)

function renderCommand(box, goTo, p, command) {
  if (p.type === 'error') {
    lastRender = null;
    box.innerHTML = `<div class="card"><div class="kicker">JARVIE</div><p class="muted" style="white-space:pre-wrap">${esc(p.message)}</p></div>`;
    return;
  }
  if (p.type === 'disambiguation') {
    lastRender = null;
    box.innerHTML = `
      <div class="card">
        <div class="kicker">WHICH ONE?</div>
        <p class="muted">${esc(p.message)}</p>
        <div class="actions">
          ${p.candidates.map((c) => `<button class="btn" data-pick="${esc(c.id)}">${esc(c.label)} · ${esc(c.kind.replace('_', ' '))}</button>`).join('')}
        </div>
      </div>`;
    box.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => withErrorToast(async () => {
      const p2 = await parseCommand(p.command || command, b.dataset.pick);
      renderCommand(box, goTo, p2, p.command || command);
    }));
    return;
  }

  // proposal
  lastRender = null;
  box.innerHTML = `
    <div class="card glow">
      <div class="kicker">PROPOSED ACTION · ${esc(p.tierLabel)}</div>
      <div class="big">${esc(p.title)}</div>
      ${(p.lines || []).map((l) => `<p class="muted">${esc(l)}</p>`).join('')}
      <div class="actions">
        <button class="btn primary" id="jarviePropose">DO IT</button>
        <button class="btn" id="jarvieCancel">CANCEL</button>
        ${p.entityRef?.goTo ? `<button class="btn" data-goto="${esc(p.entityRef.goTo)}">OPEN ${esc(p.entityRef.label)} →</button>` : ''}
      </div>
    </div>`;
  wireLinks(box, goTo);
  document.getElementById('jarvieCancel').onclick = () => {
    box.innerHTML = `<div class="card"><div class="kicker">JARVIE</div><p class="muted">Cancelled — nothing changed.</p></div>`;
  };
  document.getElementById('jarviePropose').onclick = () => withErrorToast(async () => {
    const res = await executeProposal(p);
    if (!res.ok) {
      toast(res.message, true);
      box.innerHTML = `<div class="card"><div class="kicker">JARVIE</div><p class="muted">${esc(res.message)}</p></div>`;
      return;
    }
    toast(res.message);
    box.innerHTML = `
      <div class="card glow">
        <div class="kicker">DONE</div>
        <div class="big">${esc(res.message)}</div>
        <p class="muted">Logged to the activity feed like any other action.</p>
        <div class="actions">
          ${res.entityRef?.goTo ? `<button class="btn" data-goto="${esc(res.entityRef.goTo)}">OPEN ${esc(res.entityRef.label)} →</button>` : ''}
          <button class="btn" data-goto="activity">OPEN ACTIVITY LOG →</button>
        </div>
      </div>`;
    wireLinks(box, goTo);
  });
}

function wireLinks(box, goTo) {
  box.querySelectorAll('[data-goto]').forEach((b) => b.onclick = () => goTo(b.dataset.goto));
}
