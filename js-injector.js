// js-injector.js - insert #watchplanner-root after the first child of .sections.homeSectionsContainer
// and set CSS order so it appears visually after the first child
(function () {
  'use strict';

  const LOG_PREFIX = 'Watchplanner-injector:';
  function log(...a) { try { console.log(LOG_PREFIX, ...a); } catch (e) { } }
  function warn(...a) { try { console.warn(LOG_PREFIX, ...a); } catch (e) { } }

  function isHomeRoute() {
    const h = window.location.hash || '';
    return h.startsWith('#/home');
  }

  function findSectionsContainer() {
    return document.querySelector('.sections.homeSectionsContainer');
  }

  function createRootIfMissing() {
    let root = document.getElementById('watchplanner-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'watchplanner-root';
    root.className = 'watchplanner-root';
    return root;
  }

  // Insert root after first child and set CSS order so it renders after the first child
  function insertRootAfterFirstChild(container, root) {
    if (!container || !root) return false;
    if (container.contains(root)) return true;
    try {
      const first = container.firstElementChild;
      if (first) {
        // compute numeric order of the first child (use computed style if inline not present)
        let firstOrder = 0;
        try {
          const cs = window.getComputedStyle(first);
          firstOrder = parseInt(cs.order, 10);
          if (Number.isNaN(firstOrder)) firstOrder = 0;
        } catch (e) {
          firstOrder = 0;
        }

        // choose an order value that places root after the first child.
        // Use firstOrder + 1 unless that collides with the next sibling's order,
        // in which case we bump to firstOrder + 2.
        let desiredOrder = firstOrder + 1;

        // check next sibling (the element that will come after root visually)
        const nextSibling = first.nextElementSibling;
        if (nextSibling) {
          try {
            const cs2 = window.getComputedStyle(nextSibling);
            const nextOrder = parseInt(cs2.order, 10);
            if (!Number.isNaN(nextOrder) && desiredOrder >= nextOrder) {
              desiredOrder = nextOrder + 1;
            }
          } catch (e) {
            // ignore and keep desiredOrder
          }
        }

        // set the order on the root element (inline style)
        root.style.order = String(desiredOrder);

        // physically insert after the first element
        first.insertAdjacentElement('afterend', root);
      } else {
        // fallback: prepend if no children
        container.prepend(root);
      }
      return true;
    } catch (e) {
      warn('failed to insert root', e);
      return false;
    }
  }

  function ensureClientScriptLoaded() {
    // helper to find existing script by substring
    const hasScript = (substr) => Array.from(document.scripts).some(s => (s.getAttribute('src') || '').includes(substr));

    // if combined legacy file exists, prefer it (keeps backward compatibility)
    if (hasScript('watchplanner-client.js')) {
      return;
    }

    // if both new files already present, nothing to do
    if (hasScript('client-api.js') && hasScript('client-ui.js')) return;

    // create-and-append helper that returns a Promise
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        // avoid inserting duplicates
        if (Array.from(document.scripts).some(s => (s.getAttribute('src') || '') === src)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = () => { log(`${src} loaded`); resolve(); };
        script.onerror = (e) => { warn(`failed to load ${src}`); reject(new Error(`failed to load ${src}`)); };
        document.head.appendChild(script);
      });
    }

    // relative paths (works behind proxies and on localhost)
    const base = '/web/mods/jellyfin-mod-watchplanner-section';
    const apiSrc = `${base}/client-api.js`;
    const uiSrc = `${base}/client-ui.js`;
    const legacySrc = `${base}/watchplanner-client.js`;

    // If legacy file is available on server but not yet in DOM, try to load it first
    // (quick check by attempting to fetch its HEAD; if not available, proceed with split files)
    (async () => {
      try {
        // quick existence check for legacy file (no CORS issues for same-origin)
        const head = await fetch(legacySrc, { method: 'HEAD', credentials: 'same-origin' });
        if (head.ok) {
          // load legacy combined file and return
          await loadScript(legacySrc);
          return;
        }
      } catch (e) {
        // ignore and continue to load split files
      }

      // Load API then UI in sequence
      try {
        if (!hasScript('client-api.js')) await loadScript(apiSrc);
        if (!hasScript('client-ui.js')) await loadScript(uiSrc);
      } catch (e) {
        warn('One or more watchplanner scripts failed to load', e);
      }
    })();
  }


  function tryInjectWhenReady() {
    if (!isHomeRoute()) return false;
    const container = findSectionsContainer();
    if (!container) return false;

    const root = createRootIfMissing();

    if (container.firstElementChild) {
      const ok = insertRootAfterFirstChild(container, root);
      if (ok) {
        log('#watchplanner-root inserted after first child of .sections.homeSectionsContainer (with order)');
        ensureClientScriptLoaded();
        return true;
      }
      return false;
    }

    // wait for first child to appear
    const obs = new MutationObserver((mutations, observer) => {
      if (container.firstElementChild) {
        const ok = insertRootAfterFirstChild(container, root);
        if (ok) {
          log('#watchplanner-root inserted after first child (observed) with order');
          ensureClientScriptLoaded();
          observer.disconnect();
        } else {
          warn('observed first child but failed to insert root');
        }
      }
    });
    obs.observe(container, { childList: true, subtree: false });

    // safety retry loop
    let tries = 0;
    const maxTries = 20;
    const interval = setInterval(() => {
      tries++;
      if (container.firstElementChild) {
        const ok = insertRootAfterFirstChild(container, root);
        if (ok) {
          log('#watchplanner-root inserted after first child (interval) with order');
          ensureClientScriptLoaded();
          clearInterval(interval);
          try { obs.disconnect(); } catch { }
        }
      }
      if (tries >= maxTries) {
        clearInterval(interval);
        try { obs.disconnect(); } catch { }
        warn('gave up waiting for first child after retries');
      }
    }, 300);

    return false;
  }

  function startWatcher() {
    tryInjectWhenReady();

    window.addEventListener('hashchange', () => {
      setTimeout(() => tryInjectWhenReady(), 150);
    });

    const docObserver = new MutationObserver((mutations, obs) => {
      if (findSectionsContainer()) {
        tryInjectWhenReady();
        obs.disconnect();
      }
    });
    docObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });

    let attempts = 0;
    const maxAttempts = 20;
    const retryInterval = setInterval(() => {
      attempts++;
      if (tryInjectWhenReady() || attempts >= maxAttempts) {
        clearInterval(retryInterval);
        try { docObserver.disconnect(); } catch { }
        if (attempts >= maxAttempts) log('stopped retrying injection after attempts');
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startWatcher, { once: true });
  } else {
    startWatcher();
  }
})();
