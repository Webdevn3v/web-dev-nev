// Jarvie — the LLM seam (renderer side). Specs: docs/JARVIE-PHASE-C.md (Claude backend),
// docs/JARVIE-PHASE-E.md (local-model backend).
//
// This module NEVER makes a network request and NEVER holds the API key — it calls the
// Rust command `jarvie_llm_ask` (src-tauri/src/jarvie_llm.rs), which owns the key and makes the
// call (Claude over HTTPS, or a user-run local model over HTTP). It NEVER executes a mutation —
// a routed command is handed back to parseCommand() exactly like a typed one. Every path returns
// null on any problem so the caller falls back to the deterministic Phase A–D answer.

import { invoke } from '@tauri-apps/api/core';
import { capabilityManifest, FORCEABLE_INTENTS } from './jarvie.js';
import { grammarManifest, commandObjectToString } from './jarvieAct.js';

// Persona foundation lives in ./jarviePersona.js (docs/JARVIE-PERSONA.md). PERSONA_PREAMBLE there
// is the hook a later phase turns on to let this layer phrase answers in Jarvie's voice. It is
// deliberately NOT wired into llmProse() yet: the "use ONLY the given facts, no persona" guard
// below is the current safety stance and stays until persona phrasing is its own reviewed pass.

let _status = null;
const OFF = { hasKey: false, model: 'haiku', enabled: false, backend: 'off', localUrl: 'http://localhost:11434/v1', localModel: 'llama3.2' };

function normStatus(s) {
  s = s || {};
  return {
    hasKey: !!(s.hasKey ?? s.has_key),
    model: s.model || 'haiku',
    enabled: !!s.enabled,
    backend: s.backend || (s.hasKey || s.has_key ? 'claude' : 'off'),
    localUrl: (s.localUrl ?? s.local_url) || OFF.localUrl,
    localModel: (s.localModel ?? s.local_model) || OFF.localModel,
  };
}

export async function llmStatus(force = false) {
  if (_status && !force) return _status;
  try { _status = normStatus(await invoke('jarvie_llm_status')); }
  catch { _status = { ...OFF }; }
  return _status;
}
export function invalidateStatus() { _status = null; }

// True when the layer is on AND the selected backend is actually usable.
export function layerLive(st) {
  if (!st.enabled) return false;
  if (st.backend === 'claude') return st.hasKey;
  if (st.backend === 'local') return !!st.localUrl;
  return false;
}

// Config passthrough for the settings card.
export async function llmSetKey(key) { await invoke('jarvie_llm_set_key', { key }); invalidateStatus(); }
export async function llmClearKey() { await invoke('jarvie_llm_clear_key'); invalidateStatus(); }
export async function llmSetModel(model) { await invoke('jarvie_llm_set_model', { model }); invalidateStatus(); }
export async function llmSetEnabled(enabled) { await invoke('jarvie_llm_set_enabled', { enabled }); invalidateStatus(); }
export async function llmSetBackend(backend) { await invoke('jarvie_llm_set_backend', { backend }); invalidateStatus(); }
export async function llmSetLocal(url, model) { await invoke('jarvie_llm_set_local', { url, model }); invalidateStatus(); }
export async function llmPingLocal() { try { return await invoke('jarvie_llm_ping_local'); } catch (e) { return { ok: false, error: String(e) }; } }

const MODEL_LABEL = { haiku: 'Claude Haiku 4.5', sonnet: 'Claude Sonnet 5', opus: 'Claude Opus 5' };
export function modelLabel(short) { return MODEL_LABEL[short] || MODEL_LABEL.haiku; }

// A loopback / private-range endpoint is "local"; anything else gets a UI notice (Phase E §2).
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
      || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
  } catch { return false; }
}

async function ask(req) {
  try { return await invoke('jarvie_llm_ask', { req }); }
  catch { return null; }
}
const badText = (t) => typeof t !== 'string' || !t.trim();

// ---------------------------------------------------------------- prose (§4.1)

export async function llmProse(question, det) {
  const st = await llmStatus();
  if (!layerLive(st)) return null;

  const system = [
    'You rewrite a short status answer into 1 to 3 plain sentences for the person who runs this business.',
    'Use ONLY the facts in the JSON below. Do not add numbers, names, dates, or conclusions that are not present.',
    'No greeting, no persona, no advice, no follow-up questions.',
    'If the records are empty, say plainly there is nothing to report.',
  ].join(' ');
  const user = JSON.stringify({ question, title: det.title, summary: det.summary, records: det.records ?? {} });

  const res = await ask({ system, user, max_tokens: 400 });
  if (!res || !res.ok || badText(res.text)) return null;
  const text = res.text.trim();
  if (text.length > 700) return null;

  // Cheap hallucination guard: every 1-4 digit integer in the prose must appear in the source.
  const src = `${det.summary || ''} ${JSON.stringify(det.records ?? {})}`;
  const nums = text.match(/\b\d{1,4}\b/g) || [];
  if (nums.some((n) => !src.includes(n))) return null;

  return { text, usage: res.usage || null };
}

// ---------------------------------------------------------------- fuzzy intent (§4.2)

function parseLoose(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const ROUTE_EXAMPLES = [
  '',
  'Examples:',
  'Q: "how are things slipping" → {"route":"intent","intent":"whats_stalled"}',
  'Q: "push the frederick mission forward" → {"route":"command","command":{"verb":"advance","target":"frederick mission"}}',
  'Q: "what is the weather" → {"route":"none"}',
].join('\n');

export async function llmRoute(question) {
  const st = await llmStatus();
  if (!layerLive(st)) return null;

  const intents = capabilityManifest();
  const grammar = grammarManifest();
  const system = [
    'Route ONE user request to exactly one known INTENT, one known COMMAND, or "none".',
    '',
    'INTENTS (read-only questions):',
    ...intents.map((i) => `  ${i.name} — ${i.when}`),
    '',
    'COMMANDS (change requests; the user still confirms before anything runs):',
    ...grammar.verbs.map((v) => `  ${v.verb} — args: ${v.args}`),
    '',
    `Valid step/stage/status/worker values: ${JSON.stringify(grammar.enums)}`,
    '',
    'Rules:',
    '- Never invent an entity name, step, stage, status, or verb.',
    '- For a command, copy the entity name the user referred to into "target" verbatim; do NOT resolve or correct it.',
    '- Chit-chat, unclear, or anything outside the lists above => {"route":"none"}.',
    '',
    'Reply with ONLY a JSON object, no prose, of this shape:',
    '{"route":"intent"|"command"|"none","intent"?:"<intent name>","command"?:{"verb":"<verb>","target"?:"","to"?:"","for"?:"","title"?:"","priority"?:"","due"?:"","status"?:"","text"?:"","type"?:"","from"?:""}}',
    // Phase E §4 — a small local model needs the format shown, not just described.
    st.backend === 'local' ? ROUTE_EXAMPLES : '',
  ].join('\n');

  const res = await ask({ system, user: question, max_tokens: 300 });
  if (!res || !res.ok || badText(res.text)) return null;

  const p = parseLoose(res.text);
  if (!p || typeof p !== 'object') return null;
  const usage = res.usage || null;

  if (p.route === 'intent' && FORCEABLE_INTENTS.includes(p.intent)) {
    return { kind: 'intent', intent: p.intent, usage };
  }
  if (p.route === 'command' && p.command && typeof p.command === 'object') {
    const cmdString = commandObjectToString(p.command);
    if (cmdString) return { kind: 'command', cmdString, usage };
  }
  return { kind: 'none', usage };
}

export function usageNote(usage) {
  if (!usage) return '';
  // Claude: input_tokens / output_tokens / cache_read_input_tokens.
  // OpenAI-compat (local): prompt_tokens / completion_tokens.
  const i = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const o = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;
  if (!i && !o) return '';
  return `${i + cached} in${cached ? ` (${cached} cached)` : ''}, ${o} out`;
}
