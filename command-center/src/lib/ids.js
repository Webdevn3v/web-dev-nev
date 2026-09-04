// Small id helper. Uses the platform's crypto.randomUUID (available in the Tauri webview and
// every modern browser) so ids never collide without pulling in a dependency.
export function newId(prefix) {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

export function nowIso() {
  return new Date().toISOString();
}
