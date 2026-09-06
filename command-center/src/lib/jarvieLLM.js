// Jarvie — Phase C: the LLM seam (renderer side). Spec: docs/JARVIE-PHASE-C.md.
//
// This module NEVER makes a network request and NEVER holds the API key — it calls the
// Rust command `jarvie_llm_ask` (src-tauri/src/jarvie_llm.rs), which owns the key and the
// HTTPS call. It NEVER executes a mutation — a routed command is handed back to parseCommand()
// exactly like a typed one. Every path returns null on any problem so the caller falls back to
// the deterministic Phase A/B answer.

import { invoke } from '@tauri-apps/api/core';
import { capabilityManifest, FORCEABLE_INTENTS } from './jarvie.js';
import { grammarManifest, commandObjectToString } from './jarvieAct.js';

let _status = null;

function normStatus(s) {
  return {
    hasKey: !!(s && (s.hasKey ?? s.has_key)),
    model: (s && s.model) || 'haiku',
    enabled: !!(s && s.enabled),
  };
}

export async function llmStatus(force = false) {
  if (_status && !force) return _status;
  try { _status = normStatus(await invoke('jarvie_llm_status')); }
  catch { _status = { hasKey: false, model: 'haiku', enabled: false }; }
  return _status;
}
export function invalidateStatus() { _status = null; }

// Config passthrough for the Integrations screen.
export async function llmSetKey(key) { await invoke('jarvie_llm_set_key', { key }); invalidateStatus(); }
export async function llmClearKey() { await invoke('jarvie_llm_clear_key'); invalidateStatus(); }
export async function llmSetModel(model) { await invoke('jarvie_llm_set_model', { model }); invalidateStatus(); }
export async function llmSetEnabled(enabled) { await invoke('jarvie_llm_set_enabled', { enabled }); invalidateStatus(); }

const MODEL_LABEL = { haiku: 'Claude Haiku 4.5', sonnet: 'Claude Sonnet 5', opus: 'Claude Opus 5' };
export function modelLabel(short) { return MODEL_LABEL[short] || MODEL_LABEL.haiku; }

async function ask(req) {
  try { return await invoke('jarvie_llm_ask', { req }); }
  catch { return null; }
}
const badText = (t) => typeof t !== 'string' || !t.trim();

// ---------------------------------------------------------------- prose (§4.1)

export async function llmProse(question, det) {
  const st = await llmStatus();
  if (!st.enabled || !st.hasKey) return null;

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

export async function llmRoute(question) {
  const st = await llmStatus();
  if (!st.enabled || !st.hasKey) return null;

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
    `Valid step/stage/status values: ${JSON.stringify(grammar.enums)}`,
    '',
    'Rules:',
    '- Never invent an entity name, step, stage, status, or verb.',
    '- For a command, copy the entity name the user referred to into "target" verbatim; do NOT resolve or correct it.',
    '- Chit-chat, unclear, or anything outside the lists above => {"route":"none"}.',
    '',
    'Reply with ONLY a JSON object, no prose, of this shape:',
    '{"route":"intent"|"command"|"none","intent"?:"<intent name>","command"?:{"verb":"<verb>","target"?:"","to"?:"","title"?:"","priority"?:"","due"?:"","status"?:"","text"?:""}}',
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
  const i = usage.input_tokens ?? 0;
  const o = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;
  return `Claude · ${i + cached} in${cached ? ` (${cached} cached)` : ''}, ${o} out`;
}
