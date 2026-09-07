// Jarvie — the visual shell (placeholder). Spec: docs/JARVIE-PERSONA.md "Jarvie's Home".
//
// A small ghost sitting in an orb, mounted once in the app shell. This is a STATE PLACEHOLDER,
// deliberately NOT:
//   - an animation system (just CSS transitions + one subtle pulse for `urgent`)
//   - a wake word / microphone (none of that here)
//   - anything that reaches the network or a paid API
//
// Clicking the orb opens the Ask Jarvie screen (the "wake / open" action). States are only ever
// set from real, just-retrieved data by the screens — Jarvie must never look like it is
// monitoring or has "found something" when it hasn't.

import { JARVIE_STATES, JARVIE_STATE_NAMES, DEFAULT_JARVIE_STATE } from './jarviePersona.js';

let current = 'sleeping';
let onOpen = null;

export function mountJarvieOrb({ onOpen: cb } = {}) {
  onOpen = cb || null;
  if (document.getElementById('jarvieOrb')) return;
  const el = document.createElement('button');
  el.id = 'jarvieOrb';
  el.className = 'jarvie-orb';
  el.type = 'button';
  el.setAttribute('aria-label', 'Open Ask Jarvie');
  el.innerHTML = `
    <span class="jarvie-orb__ring" aria-hidden="true"></span>
    <span class="jarvie-ghost" aria-hidden="true">
      <span class="jarvie-ghost__face">
        <span class="jarvie-ghost__eye"></span><span class="jarvie-ghost__eye"></span>
      </span>
    </span>
    <span class="jarvie-orb__tip" aria-hidden="true"></span>`;
  el.addEventListener('click', () => { if (onOpen) onOpen(); });
  document.body.appendChild(el);
  setJarvieState(DEFAULT_JARVIE_STATE);
}

export function setJarvieState(state) {
  if (!JARVIE_STATE_NAMES.includes(state)) state = DEFAULT_JARVIE_STATE;
  current = state;
  const el = document.getElementById('jarvieOrb');
  if (!el) return;
  el.dataset.state = state;
  const meta = JARVIE_STATES[state];
  const tip = el.querySelector('.jarvie-orb__tip');
  if (tip) tip.textContent = `Jarvie · ${meta.label}`;
  el.title = `Jarvie — ${meta.blurb}`;
}

export function getJarvieState() { return current; }
