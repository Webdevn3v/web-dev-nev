// Ask Jarvie — screen.
//   Phase A: read-only Q&A over the system of record.
//   Phase B: typed commands — propose → you confirm → Jarvie executes.
//   Phase C: optional Claude API layer — prose answers + fuzzy routing of unrecognised input,
//            with the deterministic layer as the fallback for every failure.
// Specs: docs/JARVIE-PHASE-A.md, -B.md, -C.md.

import { esc, setHeader, withErrorToast, toast } from '../lib/ui.js';
import { answerQuestion, suggestedQuestions, clearContext } from '../lib/jarvie.js';
import { parseCommand, executeProposal } from '../lib/jarvieAct.js';
import {
  llmStatus, llmRoute, llmProse, modelLabel, usageNote,
  llmSetKey, llmClearKey, llmSetModel, llmSetEnabled,
} from '../lib/jarvieLLM.js';

const LAST_SEEN_KEY = 'jarvie:lastSeen';
const PROSE_KEY = 'jarvie:prose';

let lastQuestion = '';
let lastRender = null;

function view() { return document.getElementById('view'); }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

export async function renderJarvie(goTo) {
  setHeader('READ-ONLY ANSWERS + CONFIRMED ACTIONS', 'Ask Jarvie');
  clearContext();
  const sinceLastSeen = lsGet(LAST_SEEN_KEY);
  lsSet(LAST_SEEN_KEY, new Date().toISOString());
  let proseMode = lsGet(PROSE_KEY) === '1';

  const [suggestions, st] = await Promise.all([suggestedQuestions(), llmStatus(true)]);
  const llmOn = st.enabled && st.hasKey;

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
      <p class="muted" style="margin-top:10px">
        Questions are read-only and unlogged. Commands are shown for your OK before anything changes.
        ${llmOn
          ? `<br>Claude is <span class="status ready">ON</span> (${esc(modelLabel(st.model))}) — it phrases answers and understands vague requests; the deterministic answer is always the fallback.
             <label style="margin-left:8px"><input type="checkbox" id="proseToggle" ${proseMode ? 'checked' : ''} style="width:auto;margin-right:5px">prose answers</label>`
          : 'Claude is <span class="status">OFF</span> — add a key in Integrations to enable phrasing and fuzzy understanding.'}
      </p>
    </div>
    <div id="jarvieAnswer" style="margin-top:14px"></div>

    <details class="card" style="margin-top:14px" ${llmOn ? '' : 'open'}>
      <summary class="kicker" style="cursor:pointer">CLAUDE API (JARVIE PHASE C) — ${llmOn ? 'ON' : 'OFF'}</summary>
      <p class="muted" style="margin-top:8px">
        The key is stored by the native side (a private file, mode 0600), never in the browser layer, the database, or a backup.
        Every call is made from Rust. Turn this off or remove the key and Jarvie is exactly as it was — deterministic, local, offline-capable.
      </p>
      <div class="grid two">
        <div class="field"><label>ANTHROPIC API KEY ${st.hasKey ? '(stored — leave blank to keep)' : ''}</label>
          <input id="llmKey" type="password" placeholder="sk-ant-..." autocomplete="off"></div>
        <div class="field"><label>MODEL</label>
          <select id="llmModel">
            <option value="haiku" ${st.model === 'haiku' ? 'selected' : ''}>Claude Haiku 4.5 — cheapest, recommended</option>
            <option value="sonnet" ${st.model === 'sonnet' ? 'selected' : ''}>Claude Sonnet 5</option>
            <option value="opus" ${st.model === 'opus' ? 'selected' : ''}>Claude Opus 5 — priciest</option>
          </select>
        </div>
      </div>
      <div class="field"><label><input type="checkbox" id="llmEnabled" ${st.enabled ? 'checked' : ''} style="width:auto;margin-right:8px">Enable the Claude layer</label></div>
      <div class="actions">
        <button class="btn primary" id="llmSave">SAVE</button>
        ${st.hasKey ? '<button class="btn" id="llmClear">REMOVE KEY</button>' : ''}
      </div>
    </details>`;

  const box = document.getElementById('jarvieAnswer');
  const input = document.getElementById('jarvieQ');
  const toggle = document.getElementById('proseToggle');
  if (toggle) toggle.onchange = () => { proseMode = toggle.checked; lsSet(PROSE_KEY, proseMode ? '1' : '0'); };

  document.getElementById('llmSave').onclick = () => withErrorToast(async () => {
    const key = document.getElementById('llmKey').value.trim();
    if (key) await llmSetKey(key);
    await llmSetModel(document.getElementById('llmModel').value);
    await llmSetEnabled(document.getElementById('llmEnabled').checked);
    toast('Claude settings saved.');
    renderJarvie(goTo);
  });
  const clearBtn = document.getElementById('llmClear');
  if (clearBtn) clearBtn.onclick = () => withErrorToast(async () => {
    await llmClearKey();
    await llmSetEnabled(false);
    toast('Key removed. Jarvie is fully local again.');
    renderJarvie(goTo);
  });

  const send = (q, entityId) => withErrorToast(async () => {
    lastQuestion = q;
    input.value = q;

    // 1 — is it a command?
    const proposal = await parseCommand(q, entityId || null);
    if (proposal) { renderCommand(box, goTo, proposal, q); return; }

    // 2 — deterministic intent
    let a = await answerQuestion(q, { entityId: entityId || null, sinceLastSeen });
    let note = null;

    // 3 — unrecognised → ask Claude to route it (still validated + re-parsed)
    if (a.intent === 'unknown') {
      const r = await llmRoute(q).catch(() => null);
      if (r?.kind === 'intent') {
        a = await answerQuestion(q, { forceIntent: r.intent, sinceLastSeen });
        note = `Read as “${r.intent.replace(/_/g, ' ')}”. ${usageNote(r.usage)}`.trim();
      } else if (r?.kind === 'command') {
        const p2 = await parseCommand(r.cmdString);
        if (p2 && p2.type !== 'error') {
          renderCommand(box, goTo, p2, r.cmdString, `Read as a command: ${r.cmdString}. ${usageNote(r.usage)}`.trim());
          return;
        }
      }
      // r null / none / unparseable → keep the capability answer
    }

    // 4 — prose rewrite of a real answer
    if (proseMode && a.intent !== 'unknown') {
      const pr = await llmProse(q, a).catch(() => null);
      if (pr) { a = { ...a, summary: pr.text }; note = [note, usageNote(pr.usage)].filter(Boolean).join(' · '); }
      else if (llmOn) { note = [note, 'answered locally'].filter(Boolean).join(' · '); }
    }

    renderAnswer(box, goTo, a, note);
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

// ---------------------------------------------------------------- read answers

function renderAnswer(box, goTo, a, note) {
  lastRender = { fn: (b, g) => renderAnswer(b, g, a, note) };
  box.innerHTML = `
    <div class="card glow">
      <div class="kicker">${esc(String(a.intent || 'answer').replace(/_/g, ' ').toUpperCase())}</div>
      <div class="big">${esc(a.title)}</div>
      <p class="muted">${esc(a.summary)}</p>
      ${note ? `<p class="muted" style="font-size:.68rem;opacity:.75">${esc(note)}</p>` : ''}
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
    renderAnswer(box, goTo, a2, null);
  }));
}

// ---------------------------------------------------------------- commands

function renderCommand(box, goTo, p, command, note) {
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
      renderCommand(box, goTo, p2, p.command || command, note);
    }));
    return;
  }

  lastRender = null;
  box.innerHTML = `
    <div class="card glow">
      <div class="kicker">PROPOSED ACTION · ${esc(p.tierLabel)}</div>
      <div class="big">${esc(p.title)}</div>
      ${(p.lines || []).map((l) => `<p class="muted">${esc(l)}</p>`).join('')}
      ${note ? `<p class="muted" style="font-size:.68rem;opacity:.75">${esc(note)}</p>` : ''}
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
