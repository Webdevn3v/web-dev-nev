// Jarvie — visual presence. Spec: docs/JARVIE-PERSONA.md "Jarvie's Home" + the game-feel passes.
//
// Jarvie is ONE persistent white companion — a "signal wisp" with a rounded head, curled tail,
// expressive eyes, tiny mitts and a floating system crest. His body is ALWAYS white; his
// reactions to the system (crest glow, aura, scan sweep, pulse, ring) are Digital Lime — the one
// system accent. No external assets, no network, no wake word, no microphone.
//
// He lives in the dock (bottom-right). When a screen wants him to present (Today, Ask Jarvie) a
// single fixed "courier" element visibly TRAVELS from the dock to that screen's figure slot, then
// the inline figure takes over; leaving, he travels back and settles into the dock. One element
// moves — not a crossfade of two copies. Reduced-motion skips the trip.
//
// State feedback — each look is distinct at a glance (styles.css):
//   sleeping · idle · attention · working · speaking · found_something · urgent
// `speaking` is driven live by the TTS lifecycle (jarvieVoice.js) via setJarvieSpeaking().
// `muted` is an orthogonal, persisted user preference: subdues him visually AND silences his
// voice. `listening` (mic/wake-word) is deliberately not here yet.

import { JARVIE_STATES, JARVIE_STATE_NAMES, DEFAULT_JARVIE_STATE } from './jarviePersona.js';

const MUTED_KEY = 'jarvie:muted';
const COURIER_BASE = 54; // px — the courier's intrinsic size; travel scales it to each rect

let current = 'sleeping';
let muted = false;
let onOpen = null;
let reactTimer = null;
let stateBeforeSpeaking = null;
let traveling = false;
let out = false;             // is Jarvie currently away from the dock, presenting?
let travelFrom = null;       // last known figure position, for the trip home
let safetyTimer = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// The character — inline SVG so it scales cleanly and every part is styleable.
function ghostSvg() {
  return `
    <svg class="jghost" viewBox="0 0 40 42" aria-hidden="true" focusable="false">
      <circle class="jghost__crest" cx="30" cy="5" r="2.1"/>
      <path class="jghost__arm jghost__arm--l" d="M8 23.5c-3 0-5 1.8-4.8 3.8.15 1.6 1.7 2.3 3.3 1.6 2-.9 3.4-2.7 3.7-4.4.15-.8-.6-1-2.2-1z"/>
      <path class="jghost__arm jghost__arm--r" d="M32 20c3-.8 5.2.3 5.3 2.3.1 1.6-1.4 2.6-3.1 2-2-.7-3.4-2.4-3.7-4.1-.15-.8.7-1 1.5-1.2z"/>
      <path class="jghost__body" d="M19.5 4.6 C10.5 4.6 5 11.3 5 19 C5 24 6.6 28 9.1 31.4 C10.7 33.6 11.3 35.5 10.4 37.7 C9.9 38.9 11 40 12.2 39.3 C15.6 37.5 18.1 34.7 19.5 31.3 C26.6 30.5 34 25.2 34 18.4 C34 10.6 28.6 4.6 19.5 4.6 Z"/>
      <g class="jghost__eyes">
        <ellipse class="jghost__eye" cx="14" cy="18.6" rx="2.6" ry="3.4"/>
        <ellipse class="jghost__eye" cx="23" cy="17.7" rx="2.9" ry="3.7"/>
        <circle class="jghost__spark" cx="12.7" cy="16.9" r="1"/>
        <circle class="jghost__spark" cx="21.5" cy="15.9" r="1.1"/>
      </g>
      <path class="jghost__mouth" d="M15 25.4q3.4 2.3 6.8 0"/>
      <g class="jghost__lids"><path d="M11.4 18.6q2.6 2 5.2 0"/><path d="M20.1 17.7q2.9 2 5.8 0"/></g>
    </svg>`;
}

// Markup a screen drops in where it wants Jarvie to present. `size` px. `echo:true` renders him
// as a faint placeholder (he's still in his orb) until jarviePresent() brings him over.
export function jarvieFigureHTML({ size = 44, echo = false } = {}) {
  const e = echo ? ' data-echo="1"' : '';
  return `<span class="jarvie-figure" data-jarvie="figure" data-state="${current}" data-muted="${muted ? 1 : 0}"${e} style="--jsize:${size}px">`
    + `<span class="jarvie-figure__aura" aria-hidden="true"></span>${ghostSvg()}</span>`;
}

export function mountJarvieOrb({ onOpen: cb } = {}) {
  onOpen = cb || null;
  if (document.getElementById('jarvieOrb')) return;
  muted = lsGet(MUTED_KEY) === '1';

  const el = document.createElement('div');
  el.id = 'jarvieOrb';
  el.className = 'jarvie-orb jarvie-orb--dock';
  el.dataset.jarvie = 'orb';
  el.dataset.state = current;
  el.dataset.home = 'home';
  el.dataset.muted = muted ? '1' : '0';
  el.innerHTML = `
    <button type="button" class="jarvie-orb__open" aria-label="Open Ask Jarvie">
      <span class="jarvie-orb__frame" aria-hidden="true"></span>
      <span class="jarvie-orb__glow" aria-hidden="true"></span>
      <span class="jarvie-orb__ring" aria-hidden="true"></span>
      <span class="jarvie-orb__aura" aria-hidden="true"></span>
      <span class="jarvie-orb__scan" aria-hidden="true"></span>
      ${ghostSvg()}
    </button>
    <button type="button" class="jarvie-orb__mute" aria-label="Mute Jarvie"></button>
    <span class="jarvie-orb__tag" aria-hidden="true"></span>`;
  el.querySelector('.jarvie-orb__open').addEventListener('click', () => { if (onOpen) onOpen(); });
  el.querySelector('.jarvie-orb__mute').addEventListener('click', (e) => { e.stopPropagation(); setJarvieMuted(!muted); });
  document.body.appendChild(el);

  const courier = document.createElement('span');
  courier.id = 'jarvieCourier';
  courier.className = 'jarvie-courier';
  courier.dataset.jarvie = 'courier';
  courier.dataset.state = current;
  courier.dataset.muted = muted ? '1' : '0';
  courier.setAttribute('aria-hidden', 'true');
  courier.innerHTML = `<span class="jarvie-figure__aura"></span>${ghostSvg()}`;
  document.body.appendChild(courier);

  setJarvieState(DEFAULT_JARVIE_STATE, { react: false });
}

// ---------------------------------------------------------------- movement (one element travels)

function orb() { return document.getElementById('jarvieOrb'); }
function courierEl() { return document.getElementById('jarvieCourier'); }
function setDockAway(away) { const o = orb(); if (o) o.dataset.home = away ? 'away' : 'home'; }

function centerRectOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width || COURIER_BASE };
}
function xform(spot, flightBoost) {
  const s = Math.max(0.45, (spot.w / COURIER_BASE) * (flightBoost ? 1.5 : 1.35));
  return `translate(${spot.x - COURIER_BASE / 2}px, ${spot.y - COURIER_BASE / 2}px) scale(${s})`;
}
function orbGhostSpot() { const o = orb(); return centerRectOf((o && o.querySelector('.jghost')) || o); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
let currentFlight = null;

// Fly the courier from `from` to `to`, then run `after`. ONE visible element, a real trip across
// the viewport via the Web Animations API (no transition/reflow/rAF fragility). A mid keyframe
// arcs it upward so it reads like a small floating companion, not a slide. The courier stays
// fully visible for the whole trip; the destination is only revealed in `after` (on arrival).
function flyCourier(from, to, after) {
  const c = courierEl();
  if (!c) { after(); return; }
  if (currentFlight) { try { currentFlight.cancel(); } catch { /* ignore */ } currentFlight = null; }

  const d = dist(from, to);
  const ms = Math.round(Math.min(820, Math.max(560, d * 0.66)));
  const lift = Math.min(64, Math.max(20, d * 0.1));
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift, w: (from.w + to.w) / 2 };

  traveling = true;
  c.classList.add('is-flying');
  c.style.opacity = '1';
  c.style.transform = xform(from, true);

  // 3 position keyframes make the arc; one overall easing paces it like a drifting companion —
  // moving from the first moment, gliding, settling gently.
  const anim = c.animate(
    [
      { transform: xform(from, true), offset: 0 },
      { transform: xform(mid, true), offset: 0.5 },
      { transform: xform(to, true), offset: 1 },
    ],
    { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.42,0,.4,1)' }
  );
  currentFlight = anim;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(safetyTimer);
    currentFlight = null;
    c.style.transform = xform(to, false);
    try { anim.cancel(); } catch { /* ignore */ }
    traveling = false;
    c.classList.remove('is-flying');
    after();               // reveal the destination Jarvie…
    // …then, a beat later (same spot & size), retire the courier so there's no visible swap
    setTimeout(() => { c.style.opacity = '0'; }, 40);
  };
  anim.onfinish = finish;
  anim.oncancel = () => { /* superseded by a newer flight; leave cleanup to that one */ };
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(finish, ms + 400);
  return ms;
}

// A screen has rendered its `.jarvie-figure` and wants Jarvie there. He visibly travels from the
// dock (or wherever he currently is) to it. Muted → he stays home, the figure is a faint echo.
export function jarviePresent() {
  const fig = document.querySelector('.jarvie-figure');
  const c = courierEl();
  const o = orb();
  if (!fig || !c || !o) return;
  const figGhost = fig.querySelector('.jghost') || fig;

  if (muted) { fig.dataset.echo = '1'; fig.style.opacity = '.14'; return; }
  delete fig.dataset.echo;

  const to = centerRectOf(figGhost);
  const from = (out && travelFrom) ? travelFrom : orbGhostSpot();
  setDockAway(true);
  out = true;

  if (reducedMotion() || dist(from, to) < 14) {
    fig.style.transition = 'opacity .2s ease';
    fig.style.opacity = '1';
    travelFrom = to;
    return;
  }

  fig.style.transition = 'none';
  fig.style.opacity = '0';
  flyCourier(from, to, () => {
    fig.style.transition = 'opacity .25s ease';
    fig.style.opacity = '1';
    travelFrom = centerRectOf((document.querySelector('.jarvie-figure .jghost')) || fig);
  });
}

// Jarvie heads back to his dock and settles into idle. Called after speech ends and on nav away.
export function jarvieTravelHome() {
  const c = courierEl();
  const o = orb();
  if (!c || !o || !out) return;
  out = false;

  const to = orbGhostSpot();
  const from = travelFrom || { x: window.innerWidth * 0.6, y: window.innerHeight * 0.45, w: COURIER_BASE };
  const done = () => { travelFrom = null; setDockAway(false); setJarvieState('idle', { react: false }); };

  // fade any inline figure he's leaving behind to a faint echo (not counted as "present")
  document.querySelectorAll('.jarvie-figure').forEach((f) => {
    f.dataset.echo = '1'; f.style.transition = 'opacity .25s ease'; f.style.opacity = '';
  });

  if (reducedMotion() || dist(from, to) < 14) { traveling = false; done(); return; }
  flyCourier(from, to, done);
}
export { jarvieTravelHome as jarvieRest };

// Safety net only: if a screen without a live figure is showing and Jarvie somehow still reads
// as "out" with no trip in flight, quietly reset him home. Presence is otherwise managed
// exclusively by jarviePresent() / jarvieTravelHome() — nothing else touches `out`.
export function syncPresence() {
  const o = orb();
  if (!o || traveling) return;
  const live = [...document.querySelectorAll('.jarvie-figure')].some((f) => f.dataset.echo !== '1');
  if (!live && out) { out = false; o.dataset.home = 'home'; }
}

// ---------------------------------------------------------------- state

function applyMeta() {
  const meta = JARVIE_STATES[current] || JARVIE_STATES[DEFAULT_JARVIE_STATE];
  document.querySelectorAll('[data-jarvie]').forEach((el) => {
    el.dataset.state = current;
    el.dataset.muted = muted ? '1' : '0';
    if (el.dataset.jarvie === 'orb') {
      const tag = el.querySelector('.jarvie-orb__tag');
      if (tag) tag.textContent = muted ? 'Muted' : meta.label;
      el.title = muted ? 'Jarvie — muted (click the dot to unmute)' : `Jarvie — ${meta.blurb}`;
      const mute = el.querySelector('.jarvie-orb__mute');
      if (mute) mute.setAttribute('aria-label', muted ? 'Unmute Jarvie' : 'Mute Jarvie');
    }
  });
}

export function setJarvieState(state, { react = true } = {}) {
  if (!JARVIE_STATE_NAMES.includes(state)) state = DEFAULT_JARVIE_STATE;
  const prev = current;
  current = state;
  applyMeta();
  if (react && !muted && state !== prev && (state === 'found_something' || state === 'urgent')) {
    const els = document.querySelectorAll('[data-jarvie]');
    els.forEach((el) => el.classList.add('is-reacting'));
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => {
      document.querySelectorAll('[data-jarvie].is-reacting').forEach((el) => el.classList.remove('is-reacting'));
    }, 720);
  }
}

// User preference: keep Jarvie visibly quiet AND silent. Persists across sessions.
export function setJarvieMuted(on) {
  muted = !!on;
  lsSet(MUTED_KEY, muted ? '1' : '0');
  applyMeta();
}
export function isJarvieMuted() { return muted; }

// Driven live by the TTS lifecycle (jarvieVoice.js) — never a timer. Enters the "speaking"
// state on playback start and restores the prior state on end.
export function setJarvieSpeaking(on) {
  if (on) {
    if (current !== 'speaking') stateBeforeSpeaking = current;
    setJarvieState('speaking', { react: false });
  } else {
    if (current === 'speaking') {
      const back = (stateBeforeSpeaking && stateBeforeSpeaking !== 'speaking') ? stateBeforeSpeaking : 'idle';
      setJarvieState(back, { react: false });
    }
    stateBeforeSpeaking = null;
  }
}

export function getJarvieState() { return current; }
export function isJarviePresenting() { return out; }
