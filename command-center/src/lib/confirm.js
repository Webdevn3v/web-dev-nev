import { TIER, TIER_LABEL } from './risk.js';

// UI approval gate for PHASE1-SPEC.md §5. External/write actions need a plain confirm; high-impact
// actions need the same confirm plus a typed "APPROVE" — the extra friction is deliberate for
// "Explicit approval step" (ApproveChange, launch-stage transitions, anything touching a live
// client asset).

let els = null;

function bind() {
  els = {
    backdrop: document.getElementById('confirmBackdrop'),
    tier: document.getElementById('confirmTier'),
    title: document.getElementById('confirmTitle'),
    detail: document.getElementById('confirmDetail'),
    typeWrap: document.getElementById('confirmTypeWrap'),
    typeInput: document.getElementById('confirmTypeInput'),
    cancel: document.getElementById('confirmCancel'),
    ok: document.getElementById('confirmOk'),
  };
}

export function confirmGate({ tier, title, detail }) {
  if (!els) bind();
  const requireTyped = tier === TIER.HIGH_IMPACT;

  return new Promise((resolve) => {
    els.tier.textContent = TIER_LABEL[tier] || tier;
    els.title.textContent = title;
    els.detail.textContent = detail || '';
    els.typeWrap.hidden = !requireTyped;
    els.typeInput.value = '';
    els.ok.disabled = requireTyped;
    els.backdrop.hidden = false;

    const cleanup = () => {
      els.backdrop.hidden = true;
      els.ok.onclick = null;
      els.cancel.onclick = null;
      els.typeInput.oninput = null;
    };

    if (requireTyped) {
      els.typeInput.oninput = () => {
        els.ok.disabled = els.typeInput.value.trim().toUpperCase() !== 'APPROVE';
      };
    }

    els.ok.onclick = () => {
      if (requireTyped && els.typeInput.value.trim().toUpperCase() !== 'APPROVE') return;
      cleanup();
      resolve(true);
    };
    els.cancel.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}
