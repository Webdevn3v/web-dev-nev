// Jarvie's spoken voice.
//
// PRIMARY: Piper — a small, fully-offline neural TTS. The renderer can't spawn a process, so the
// Vite dev server (which the launcher already runs) exposes `/jarvie-tts/say?text=…`, shells out
// to Piper, and streams back a WAV; the renderer plays it through Web Audio. See vite.config.js.
//   Voice: en_GB-alan-medium — a natural British male. Fully local: no network, no paid/cloud
//   service, no Claude/OpenAI, no microphone, no wake word.
//
// FALLBACK: window.speechSynthesis (WebKitGTK's Flite voices) — only if Piper is unreachable or
// errors. Chunked per sentence, voice scored toward a natural male (rms), rate 1.04.
//
// In BOTH paths the orb's "speaking" state is driven by the REAL playback lifecycle
// (BufferSource start/ended, or utterance onstart/onend) — never a timer. Muted → nothing plays.
// When playback ends, Jarvie travels back to his dock (jarvieTravelHome). Every failure is quiet.

import { setJarvieSpeaking, isJarvieMuted, jarvieTravelHome, isJarviePresenting } from './jarvieOrb.js';

// ---------------------------------------------------------------- shared

let piperHealthy = null;   // null=unprobed, then true/false
let usingEngine = null;    // 'piper' | 'synth' | null — what the last speech actually used

function finishSpeech() {
  try { if (isJarviePresenting()) jarvieTravelHome(); } catch { /* ignore */ }
}

// TTS-only cleanup. Never touches what's shown on screen.
function forSpeech(raw) {
  return String(raw || '')
    .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'")
    .replace(/\s*[→▸▾⚙⚠]\s*/g, ' ')
    .replace(/\s*[·•]\s*/g, ', ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*;\s*/g, ', ')
    .replace(/\be\.g\.\s*/gi, 'for example ')
    .replace(/\bi\.e\.\s*/gi, 'that is ')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

// ---------------------------------------------------------------- Piper (primary)

let audioCtx = null;
let currentSource = null;

function ctx() {
  if (!audioCtx) {
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { audioCtx = new AC(); } catch { return null; }
  }
  return audioCtx;
}
// Call from a user gesture so the context is running before the first answer.
export function primeJarvieAudio() {
  const c = ctx();
  if (c && c.state === 'suspended') { try { c.resume(); } catch { /* ignore */ } }
}

async function probePiper() {
  try {
    const r = await fetch('/jarvie-tts/health', { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    piperHealthy = !!(j && j.ok);
    return piperHealthy;
  } catch {
    piperHealthy = false;
    return false;
  }
}

function speakViaPiper(text) {
  return new Promise((resolve, reject) => {
    const c = ctx();
    if (!c) { reject(new Error('no AudioContext')); return; }
    if (c.state === 'suspended') { c.resume().catch(() => {}); }

    fetch('/jarvie-tts/say?text=' + encodeURIComponent(text), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('piper http ' + r.status); return r.arrayBuffer(); })
      .then((ab) => {
        if (!ab || ab.byteLength < 128) throw new Error('piper: empty audio');
        return c.decodeAudioData(ab.slice(0));
      })
      .then((audio) => {
        const src = c.createBufferSource();
        src.buffer = audio;
        src.connect(c.destination);
        currentSource = src;
        src.onended = () => {
          if (currentSource === src) {
            currentSource = null;
            setJarvieSpeaking(false);
            finishSpeech();
          }
          resolve(true);
        };
        piperHealthy = true;
        usingEngine = 'piper';
        setJarvieSpeaking(true);        // real audio begins here
        src.start();
      })
      .catch(reject);
  });
}

// ---------------------------------------------------------------- speechSynthesis (fallback)

let queue = [];
let pickedVoice = null;
let voicesReady = false;

function synth() {
  return (typeof window !== 'undefined' && 'speechSynthesis' in window) ? window.speechSynthesis : null;
}
function synthSupported() {
  return !!synth() && typeof window.SpeechSynthesisUtterance === 'function';
}

const FEMALE = /\b(slt|female|woman|zira|hazel|susan|samantha|victoria|karen|tessa|fiona|moira|serena|amelie|anna|catherine|kate)\b/i;
const BRITISH = /\b(gb|uk|british|england|scottish|scotland|welsh|wales|received[-_ ]?pronunciation|\brp\b|awb)\b/i;
const KNOWN_MALE = /\b(daniel|oliver|george|arthur|ryan|james|alex|fred|david|mark|guy|christopher|eric|aaron|tom|reed|rishi|brian|jamie|alan|rms)\b/i;
const NATURAL = /\b(natural|neural|enhanced|premium|online|wavenet|studio|google|microsoft|siri|polly|piper)\b/i;
const ROBOTIC = /\b(kal|kal16|espeak|e-speak|pico|festival|mbrola|compact|robo|classic)\b/i;

function label(v) { return `${v.name || ''} ${v.lang || ''} ${v.voiceURI || ''}`; }
function isFemale(v) { return FEMALE.test(label(v)); }
function score(v) {
  if (isFemale(v)) return -1000;
  const s = label(v);
  let n = 0;
  if (/^en[-_]?gb/i.test(v.lang || '')) n += 120;
  else if (/^en[-_]?(au|ie|nz|za)/i.test(v.lang || '')) n += 35;
  else if (/^en/i.test(v.lang || '')) n += 10;
  if (KNOWN_MALE.test(s)) n += 60;
  if (NATURAL.test(s)) n += 45;
  if (BRITISH.test(s)) n += 22;
  if (ROBOTIC.test(s)) n -= 40;
  if (v.localService) n += 3;
  return n;
}
function chooseVoice() {
  const voices = ((synth() && synth().getVoices()) || []).slice();
  if (!voices.length) return null;
  voices.sort((a, b) => score(b) - score(a));
  return score(voices[0]) > -1000 ? voices[0] : (voices.find((v) => v.default) || voices[0]);
}
function primeVoices() {
  const s = synth();
  if (!s) return;
  const load = () => { pickedVoice = chooseVoice(); voicesReady = !!(s.getVoices() || []).length; };
  load();
  if (!voicesReady) { try { s.addEventListener('voiceschanged', load); } catch { /* older impls */ } }
}

function speakViaSynth(text) {
  const s = synth();
  if (!s) { setJarvieSpeaking(false); finishSpeech(); return; }
  try { s.cancel(); } catch { /* ignore */ }
  queue = [];
  if (!pickedVoice) pickedVoice = chooseVoice();

  let t = text;
  if (t && !/[.!?]$/.test(t)) t += '.';
  const parts = t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) { setJarvieSpeaking(false); finishSpeech(); return; }

  usingEngine = 'synth';
  let started = false;
  parts.forEach((chunk, i) => {
    const u = new window.SpeechSynthesisUtterance(chunk);
    if (pickedVoice) u.voice = pickedVoice;
    u.lang = (pickedVoice && pickedVoice.lang) || 'en-GB';
    u.rate = 1.04; u.pitch = 1.0; u.volume = 1.0;
    u.onstart = () => { if (!started) { started = true; setJarvieSpeaking(true); } };
    if (i === parts.length - 1) {
      u.onend = () => { setJarvieSpeaking(false); queue = []; finishSpeech(); };
      u.onerror = () => { setJarvieSpeaking(false); queue = []; finishSpeech(); };
    } else {
      u.onerror = () => { /* skip a bad chunk */ };
    }
    queue.push(u);
  });
  try {
    queue.forEach((u) => s.speak(u));
    setTimeout(() => {
      if (!started && !s.speaking && !s.pending) { setJarvieSpeaking(false); queue = []; finishSpeech(); }
    }, 1600);
  } catch {
    setJarvieSpeaking(false); queue = []; finishSpeech();
  }
}

// ---------------------------------------------------------------- public API

export function voiceSupported() {
  return piperHealthy === true || synthSupported() || piperHealthy === null;
}

export function initJarvieVoice() {
  primeVoices();
  probePiper();          // warm the health flag; fire-and-forget
  ctx();                 // create the AudioContext early
}

// Speak the real, already-generated answer text. Tries Piper; falls back to speechSynthesis.
export function speakJarvie(title, summary) {
  if (isJarvieMuted()) { finishSpeech(); return; }
  const text = forSpeech([title, summary].filter(Boolean).join('. '));
  if (!text) { finishSpeech(); return; }
  stopJarvieVoice();     // cut off anything current (no travel-home — the caller's flow owns that)

  if (piperHealthy === false && synthSupported()) { speakViaSynth(text); return; }

  speakViaPiper(text).catch(() => {
    piperHealthy = false;
    if (synthSupported()) speakViaSynth(text);
    else { setJarvieSpeaking(false); finishSpeech(); }
  });
}

export function stopJarvieVoice() {
  const src = currentSource;
  currentSource = null;
  if (src) { try { src.onended = null; src.stop(); } catch { /* ignore */ } }
  queue = [];
  try { const s = synth(); if (s) s.cancel(); } catch { /* ignore */ }
  setJarvieSpeaking(false);
}

export function isJarvieSpeaking() {
  if (currentSource) return true;
  const s = synth();
  return !!(s && (s.speaking || s.pending));
}

// For the report / a future settings screen.
export function voiceReport() {
  if (!pickedVoice) pickedVoice = chooseVoice();
  const fallback = ((synth() && synth().getVoices()) || [])
    .map((v) => ({ name: v.name, lang: v.lang, female: isFemale(v), score: score(v) }))
    .sort((a, b) => b.score - a.score);
  return {
    engine: piperHealthy ? 'piper' : (piperHealthy === false ? 'speechSynthesis (piper unavailable)' : 'probing'),
    piperVoice: 'en_GB-alan-medium',
    lastUsed: usingEngine,
    fallbackVoiceSelected: pickedVoice ? { name: pickedVoice.name, lang: pickedVoice.lang } : null,
    fallbackCandidates: fallback,
  };
}
