/* Remember each history entry's position and popup, without storing form data. */
(() => {
  const stateKey = 'tdsNavigation';
  let restoring = false;
  let timer;
  let lastDialogs = '';
  let restoreVersion = 0;
  const panels = ['routeSheet', 'famSheet', 'panel'];
  const panelTriggers = new Map();
  let lastTrigger = null;
  const overlays = ['door', 'gate', 'doorEntry', 'airlock', 'entry'];

  function snapshot() {
    return {
      url: location.href,
      x: window.scrollX,
      y: window.scrollY,
      bodyClass: document.body.className,
      bodyOverflow: document.body.style.overflow,
      overlays: overlays.map(id => document.getElementById(id)).filter(Boolean)
        .map(element => ({ id: element.id, className: element.className })),
      panels: panels.map(id => document.getElementById(id)).filter(element => element?.classList.contains('open'))
        .map(element => ({ id: element.id, trigger: panelTriggers.get(element.id), top: element.scrollTop })),
      dialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => ({
        id: dialog.id,
        top: dialog.scrollTop,
        frames: [...dialog.querySelectorAll('iframe')].map(frame => frame.getAttribute('src'))
      })),
      details: [...document.querySelectorAll('details')].map(element => element.open),
      scrollers: [...document.querySelectorAll('[id]')]
        .filter(element => element.scrollLeft || element.scrollTop)
        .map(element => ({ id: element.id, left: element.scrollLeft, top: element.scrollTop })),
      finishes: [...document.querySelectorAll('.product-row')].map(row =>
        row.querySelector('[data-finish][aria-pressed="true"]')?.dataset.finish || null),
      focus: document.activeElement?.id || null
    };
  }

  function save() {
    if (restoring) return;
    try {
      history.replaceState({ ...history.state, [stateKey]: snapshot() }, '');
    } catch {
      history.scrollRestoration = 'auto';
    }
  }

  function dialogKey() {
    return [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.id)
      .concat(panels.filter(id => document.getElementById(id)?.classList.contains('open'))).join('|');
  }

  function restore(saved) {
    if (!saved || saved.url !== location.href) return;
    restoring = true;
    const version = ++restoreVersion;
    document.body.className = saved.bodyClass;
    saved.overlays.forEach(item => {
      const element = document.getElementById(item.id);
      if (element) element.className = item.className;
    });
    document.querySelectorAll('details').forEach((element, index) => {
      element.open = Boolean(saved.details[index]);
    });
    document.querySelectorAll('.product-row').forEach((row, index) => {
      const finish = saved.finishes[index];
      const button = row.querySelector(`[data-finish="${finish}"]`);
      if (button && button.getAttribute('aria-pressed') !== 'true') button.click();
    });
    panels.forEach(id => {
      const panel = document.getElementById(id);
      const savedPanel = saved.panels?.find(item => item.id === id);
      if (savedPanel?.trigger && !panel?.classList.contains('open')) {
        document.querySelector(savedPanel.trigger)?.click();
      } else if (!savedPanel && panel?.classList.contains('open')) {
        panel.querySelector('button[aria-label^="Close"], #routeClose, #famClose, #closePanel, .close')?.click();
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
      }
    });
    const wanted = new Set(saved.dialogs.map(item => item.id));
    document.querySelectorAll('dialog[open]').forEach(dialog => {
      if (!wanted.has(dialog.id)) dialog.close();
    });
    saved.dialogs.forEach(item => {
      const dialog = document.getElementById(item.id);
      if (!dialog) return;
      dialog.querySelectorAll('iframe').forEach((frame, index) => {
        if (item.frames[index] && frame.getAttribute('src') !== item.frames[index]) {
          frame.src = item.frames[index];
        }
      });
      if (!dialog.open) dialog.showModal();
    });
    function position() {
      if (version !== restoreVersion) return;
      document.body.style.overflow = saved.bodyOverflow;
      saved.scrollers.forEach(item => {
        document.getElementById(item.id)?.scrollTo({ left: item.left, top: item.top, behavior: 'instant' });
      });
      saved.panels?.forEach(item => {
        const panel = document.getElementById(item.id);
        if (panel) panel.scrollTop = item.top;
      });
      saved.dialogs.forEach(item => {
        const dialog = document.getElementById(item.id);
        if (dialog) dialog.scrollTop = item.top;
      });
      document.getElementById(saved.focus)?.focus({ preventScroll: true });
      window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    }
    position();
    // Existing close handlers and entrance scripts finish before the final positioning.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      position();
      lastDialogs = dialogKey();
      restoring = false;
    }));
  }

  function trackDialogs() {
    if (restoring) return;
    const current = dialogKey();
    if (current === lastDialogs) return;
    if (!current && lastDialogs && history.state?.tdsPopup) {
      lastDialogs = current;
      history.back();
      return;
    }
    panels.forEach(id => {
      if (document.getElementById(id)?.classList.contains('open') && !lastDialogs.split('|').includes(id)) {
        panelTriggers.set(id, lastTrigger);
      }
    });
    lastDialogs = current;
    if (current) {
      history.pushState({ ...history.state, [stateKey]: snapshot(), tdsPopup: true }, '');
    } else {
      save();
    }
  }

  const isReturn = performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
  const initialState = history.state?.[stateKey];
  lastDialogs = dialogKey();
  if (isReturn && initialState) restore(initialState);
  else save();
  history.scrollRestoration = 'manual';

  // Save before link handlers navigate or change a hash.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('a, button, [role="button"], [data-person], [data-path]');
    if (!trigger) return;
    save();
    const path = [];
    let element = trigger;
    while (element && element !== document.body) {
      path.unshift(element.tagName.toLowerCase() + ':nth-child(' + ([...element.parentElement.children].indexOf(element) + 1) + ')');
      element = element.parentElement;
    }
    lastTrigger = 'body > ' + path.join(' > ');
  }, true);
  document.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(save, 120);
  }, true);
  document.addEventListener('toggle', save, true);
  window.addEventListener('pagehide', save);
  window.addEventListener('pageshow', event => {
    if (event.persisted || isReturn) restore(history.state?.[stateKey]);
  });
  window.addEventListener('popstate', () => restore(history.state?.[stateKey]));
  new MutationObserver(trackDialogs).observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ['open', 'class']
  });
})();
