#!/usr/bin/env bash
# Opens "The Digital Side — Command Center" from the ChromeOS / Crostini app launcher.
#
# Runs the ALREADY-BUILT Tauri binary directly. It never calls `tauri dev` and never invokes
# cargo, so it cannot get stuck compiling — the window opens in a few seconds.
#
#   - Standalone binary (frontend embedded): run it as-is.
#   - Dev binary (loads http://127.0.0.1:1420): make sure the Vite dev server is up first
#     (start it detached if nothing is serving that port), then run the binary.
#
# Absolute interpreter paths are used because the launcher environment has a minimal PATH.
# If `npm run tauri dev` is already running, this attaches to that Vite server instead of
# starting a second one, so it does not disturb the dev workflow.

set -u

NODE="/usr/bin/node"
PORT=1420
HOST=127.0.0.1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$APP_DIR/src-tauri/target/debug/tds-command-center"
VITE="$APP_DIR/node_modules/vite/bin/vite.js"
LOG="$SCRIPT_DIR/launch.log"

log() { printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG"; }
: > "$LOG"
cd "$APP_DIR" || { log "FATAL: cannot cd to $APP_DIR"; exit 1; }
log "launch: APP_DIR=$APP_DIR"

if [ ! -x "$BIN" ]; then
  log "FATAL: app binary not found at $BIN"
  log "Build it once:  cd \"$APP_DIR\" && npm run tauri build -- --debug --no-bundle"
  exit 1
fi

# TCP probe with no external tools (bash /dev/tcp). Returns 0 if something accepts on the port.
port_open() { (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null && exec 3>&- 2>/dev/null; }
# Does the running Vite have Jarvie's TTS endpoint (i.e. was it started with the current
# vite.config.js)? An old Vite from before this config won't — restart it so Jarvie gets a voice.
tts_ready() {
  command -v curl >/dev/null 2>&1 || return 0   # can't check → assume fine
  curl -sf -m 2 "http://${HOST}:${PORT}/jarvie-tts/health" 2>/dev/null | grep -q '"ok":true'
}
start_vite() {
  [ -f "$VITE" ] && [ -x "$NODE" ] || { log "FATAL: dev build needs $NODE + $VITE"; exit 1; }
  log "starting Vite dev server on ${PORT}"
  setsid nohup "$NODE" "$VITE" --port "$PORT" --strictPort --host "$HOST" > "$SCRIPT_DIR/vite.log" 2>&1 &
  for _ in $(seq 1 60); do port_open && { log "Vite is up"; sleep 1; return 0; }; sleep 0.5; done
  log "FATAL: Vite did not open ${HOST}:${PORT} within 30s (see $SCRIPT_DIR/vite.log)"
  exit 1
}

# A dev build contains the literal dev-server URL; a standalone build does not.
if grep -qa "localhost:${PORT}\|127.0.0.1:${PORT}" "$BIN"; then
  if port_open && tts_ready; then
    log "dev server already on ${HOST}:${PORT} (with TTS) — reusing it"
  elif port_open; then
    log "Vite is up but has no TTS endpoint — restarting it for Jarvie's voice"
    VPID="$(ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
    [ -n "${VPID:-}" ] && kill "$VPID" 2>/dev/null && sleep 2
    start_vite
  else
    start_vite
  fi
else
  log "standalone binary — no dev server needed"
fi

log "exec $BIN"
exec "$BIN" >> "$LOG" 2>&1
