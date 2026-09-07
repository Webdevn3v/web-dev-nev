// Vite config — its one job is Jarvie's local text-to-speech dev endpoint.
//
// Jarvie speaks with Piper (https://github.com/rhasspy/piper): a small, fully offline neural TTS.
// The renderer can't spawn a process, and adding a Tauri/Rust command would mean a slow native
// rebuild + a CSP change baked into the binary — so instead the Vite dev server (which the
// launcher already runs) exposes `/jarvie-tts/say?text=…`, which shells out to Piper and streams
// back a WAV. Same origin as the app → `connect-src 'self'` covers it, no CSP change, no Rust.
// The renderer plays the WAV through Web Audio (`decodeAudioData`), so the orb's speaking state
// is driven by the real playback lifecycle. If Piper isn't installed or fails, the renderer
// falls back to the browser's speechSynthesis. `vite build` is unaffected (dev-only middleware).
//
// Install (one-off, ~102 MB, done outside the repo):
//   ~/.local/share/org.thedigitalside.commandcenter/piper/piper/piper           (Piper 1.2.0)
//   ~/.local/share/org.thedigitalside.commandcenter/piper/voices/en_GB-alan-medium.onnx(.json)

import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PIPER_DIR = path.join(os.homedir(), '.local/share/org.thedigitalside.commandcenter/piper');
const PIPER_BIN = path.join(PIPER_DIR, 'piper', 'piper');
const PIPER_LIB = path.join(PIPER_DIR, 'piper');
const VOICE = path.join(PIPER_DIR, 'voices', 'en_GB-alan-medium.onnx');
const VOICE_ID = 'en_GB-alan-medium';

const piperReady = () => existsSync(PIPER_BIN) && existsSync(VOICE);

// TTS-only text cleanup. Does NOT touch what's shown on screen — this is the spoken copy.
function forSpeech(raw) {
  return String(raw || '')
    .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'")
    .replace(/\s*[→▸▾⚙⚠]\s*/g, ' ')   // → ▸ ▾ ⚙ ⚠
    .replace(/\s*[·•]\s*/g, ', ')                     // · •
    .replace(/\s*[—–]\s*/g, ', ')                     // — –
    .replace(/\s*;\s*/g, ', ')
    .replace(/\be\.g\.\s*/gi, 'for example ')
    .replace(/\bi\.e\.\s*/gi, 'that is ')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\bQA\b/g, 'Q A')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function jarvieTts() {
  return {
    name: 'jarvie-tts',
    configureServer(server) {
      server.middlewares.use('/jarvie-tts', (req, res) => {
        const u = new URL(req.url || '/', 'http://localhost');

        if (u.pathname === '/' || u.pathname === '/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: piperReady(), engine: 'piper', voice: VOICE_ID }));
          return;
        }
        if (u.pathname !== '/say') { res.statusCode = 404; res.end(); return; }
        if (!piperReady()) { res.statusCode = 503; res.end('piper not installed'); return; }

        const text = forSpeech(u.searchParams.get('text') || '');
        if (!text) { res.statusCode = 400; res.end('no text'); return; }

        const p = spawn(PIPER_BIN, [
          '--model', VOICE,
          '--output_file', '-',
          '--length_scale', '0.96',      // conversational pace (1.0 = default, higher = slower)
          '--sentence_silence', '0.16',  // tight but natural gap between sentences
          '--noise_scale', '0.6',
          '--noise_w', '0.75',
        ], { env: { ...process.env, LD_LIBRARY_PATH: `${PIPER_LIB}:${process.env.LD_LIBRARY_PATH || ''}` } });

        const chunks = [];
        let err = '';
        p.stdout.on('data', (d) => chunks.push(d));
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', () => { if (!res.headersSent) { res.statusCode = 500; res.end('spawn failed'); } });
        p.on('close', (code) => {
          const wav = Buffer.concat(chunks);
          if (code === 0 && wav.length > 44) {
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Content-Length', String(wav.length));
            res.setHeader('Cache-Control', 'no-store');
            res.end(wav);
          } else if (!res.headersSent) {
            res.statusCode = 500;
            res.end(`piper failed (${code}): ${err.slice(0, 300)}`);
          }
        });
        req.on('close', () => { try { p.kill('SIGKILL'); } catch { /* ignore */ } });
        p.stdin.on('error', () => { /* client went away */ });
        p.stdin.end(text);
      });
    },
  };
}

export default defineConfig({
  plugins: [jarvieTts()],
});
