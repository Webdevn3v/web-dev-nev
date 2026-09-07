// Ask Jarvie — screen.
//   Phase A: read-only Q&A over the system of record.
//   Phase B: typed commands — propose → you confirm → Jarvie executes.
//   Phase C: optional Claude API layer — prose + fuzzy routing, deterministic fallback.
//   Phase D: wider/deeper deterministic answers + more commands + a Today brief.
//   Phase E: the language layer can run against a local model instead of the Claude API.
// Specs: docs/JARVIE-PHASE-A.md .. -E.md.

import { esc, setHeader, withErrorToast, toast } from '../lib/ui.js';
import { answerQuestion, suggestedQuestions, clearContext } from '../lib/jarvie.js';
import { setJarvieState } from '../lib/jarvieOrb.js';
import { LINES } from '../lib/jarviePersona.js';
import { parseCommand, executeProposal } from '../lib/jarvieAct.js';
import {
  llmStatus, llmRoute, llmProse, modelLabel, usageNote, layerLive, isLocalUrl,
  llmSetKey, llmClearKey, llmSetModel, llmSetEnabled, llmSetBackend, llmSetLocal, llmPingLocal,
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
  const llmOn = layerLive(st);
  const backendName = st.backend === 'claude' ? modelLabel(st.model)
    : st.backend === 'local' ? `local model (${st.localModel})` : 'off';

  view().innerHTML = `
    <div class="card">
      <div class="kicker">ASK OR TELL JARVIE</div>
      <p class="muted" style="margin-top:4px">${esc(LINES.greeting)}</p>
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
          ? `<br>Language layer <span class="status ready">ON</span> · ${esc(backendName)} — it phrases answers and understands vague requests; the deterministic answer is always the fallback.
             <label style="margin-left:8px"><input type="checkbox" id="proseToggle" ${proseMode ? 'checked' : ''} style="width:auto;margin-right:5px">prose answers</label>`
          : 'Language layer <span class="status">OFF</span> — everything works locally without it. Turn it on below to add phrasing and fuzzy understanding.'}
      </p>
    </div>
    <div id="jarvieAnswer" style="margin-top:14px"></div>

    <details class="card" style="margin-top:14px" ${llmOn ? '' : 'open'}>
      <summary class="kicker" style="cursor:pointer">JARVIE LANGUAGE LAYER — ${llmOn ? esc(backendName.toUpperCase()) : 'OFF'}</summary>
      <p class="muted" style="margin-top:8px">
        Optional. The call is always made from the native side (never the browser layer) and every failure falls back to the
        deterministic answer. Turn it off and Jarvie is exactly as it was — local, offline-capable.
      </p>
      <div class="field"><label>BACKEND</label>
        <select id="llmBackend">
          <option value="off" ${st.backend === 'off' ? 'selected' : ''}>Off — deterministic only</option>
          <option value="claude" ${st.backend === 'claude' ? 'selected' : ''}>Claude API (paid, needs a key)</option>
          <option value="local" ${st.backend === 'local' ? 'selected' : ''}>Local model (free — you run it)</option>
        </select>
      </div>

      <div id="llmClaudeCfg" ${st.backend === 'claude' ? '' : 'hidden'}>
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
        ${st.hasKey ? '<div class="actions"><button class="btn" id="llmClear">REMOVE KEY</button></div>' : ''}
      </div>

      <div id="llmLocalCfg" ${st.backend === 'local' ? '' : 'hidden'}>
        <div class="grid two">
          <div class="field"><label>ENDPOINT (OpenAI-compatible)</label>
            <input id="llmLocalUrl" value="${esc(st.localUrl)}" placeholder="http://localhost:11434/v1" autocomplete="off"></div>
          <div class="field"><label>MODEL NAME</label>
            <input id="llmLocalModel" value="${esc(st.localModel)}" placeholder="llama3.2" autocomplete="off"></div>
        </div>
        <p class="muted" style="font-size:.7rem">Run Ollama (<code>ollama pull llama3.2 &amp;&amp; ollama serve</code>), llama.cpp, or LM Studio yourself. Nothing is downloaded or installed by this app.</p>
        <div id="llmLocalWarn" class="muted" style="font-size:.7rem;color:var(--amber)" ${isLocalUrl(st.localUrl) ? 'hidden' : ''}>That endpoint is not a local address — it may reach an external service.</div>
        <div class="actions"><button class="btn" id="llmPing">TEST CONNECTION</button><span id="llmPingResult" class="muted" style="font-size:.72rem"></span></div>
      </div>

      <div class="field"><label><input type="checkbox" id="llmEnabled" ${st.enabled ? 'checked' : ''} style="width:auto;margin-right:8px">Enable the language layer</label></div>
      <div class="actions"><button class="btn primary" id="llmSave">SAVE</button></div>
    </details>`;

  const box = document.getElementById('jarvieAnswer');
  const input = document.getElementById('jarvieQ');
  const toggle = document.getElementById('proseToggle');
  if (toggle) toggle.onchange = () => { proseMode = toggle.checked; lsSet(PROSE_KEY, proseMode ? '1' : '0'); };

  const backendSel = document.getElementById('llmBackend');
  backendSel.onchange = () => {
    const b = backendSel.value;
    document.getElementById('llmClaudeCfg').hidden = b !== 'claude';
    document.getElementById('llmLocalCfg').hidden = b !== 'local';
  };
  const urlInput = document.getElementById('llmLocalUrl');
  if (urlInput) urlInput.oninput = () => {
    document.getElementById('llmLocalWarn').hidden = isLocalUrl(urlInput.value.trim());
  };
  const pingBtn = document.getElementById('llmPing');
  if (pingBtn) pingBtn.onclick = () => withErrorToast(async () => {
    const out = document.getElementById('llmPingResult');
    out.textContent = 'testing…';
    await llmSetLocal(urlInput.value.trim(), document.getElementById('llmLocalModel').value.trim());
    const r = await llmPingLocal();
    out.textContent = r.ok ? '✓ reachable' : `✗ ${r.error || 'not reachable'}`;
  });

  document.getElementById('llmSave').onclick = () => withErrorToast(async () => {
    const b = backendSel.value;
    await llmSetBackend(b);
    if (b === 'claude') {
      const key = document.getElementById('llmKey').value.trim();
      if (key) await llmSetKey(key);
      await llmSetModel(document.getElementById('llmModel').value);
    } else if (b === 'local') {
      await llmSetLocal(document.getElementById('llmLocalUrl').value.trim(), document.getElementById('llmLocalModel').value.trim());
    }
    await llmSetEnabled(document.getElementById('llmEnabled').checked && b !== 'off');
    toast('Language-layer settings saved.');
    renderJarvie(goTo);
  });
  const clearBtn = document.getElementById('llmClear');
  if (clearBtn) clearBtn.onclick = () => withErrorToast(async () => {
    await llmClearKey();
    toast('Key removed.');
    renderJarvie(goTo);
  });

  const send = (q, entityId) => withErrorToast(async () => {
    lastQuestion = q;
    input.value = q;
    setJarvieState('working');

    // 1 — is it a command?
    const proposal = await parseCommand(q, entityId || null);
    if (proposal) { renderCommand(box, goTo, proposal, q); setJarvieState('idle'); return; }

    // 2 — deterministic intent
    let a = await answerQuestion(q, { entityId: entityId || null, sinceLastSeen });
    let note = null;

    // 3 — unrecognised → ask the model to route it (still validated + re-parsed by parseCommand)
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
    setJarvieState(a.evidence && a.evidence.length ? 'found_something' : 'idle');
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
    box.innerHTML = `<div class="card"><div class="kicker">JARVIE</div><p class="muted">${esc(LINES.cancelled)}</p></div>`;
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
