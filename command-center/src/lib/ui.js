export function esc(v = '') {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function setHeader(eyebrow, title) {
  document.querySelector('#sectionEyebrow').textContent = eyebrow;
  document.querySelector('#sectionTitle').textContent = title;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

export function toast(message, isError = false) {
  const el = document.querySelector('#toast');
  if (!el) { if (isError) console.error(message); return; }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

export async function withErrorToast(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === 'ActionDeclinedError') {
      toast('Cancelled — no changes were made.');
      return undefined;
    }
    console.error(err);
    toast(err?.message || String(err), true);
    return undefined;
  }
}
