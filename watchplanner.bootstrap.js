// watchplanner.bootstrap.js - Cleaned, consolidated, and hardened bootstrap for Watchplanner
// - Robust insertion: first visible child (excluding our wrapper), retries, wrapper reuse, reposition observer
// - Preloads client scripts and CSS
// - Debug gated via window.__watchplanner_debug and window.__watchplanner_debug_verbose

(function () {
  'use strict';

  // ---------- Config ----------
  const LOG_PREFIX = 'Watchplanner-bootstrap:';
  window.__watchplanner_debug = window.__watchplanner_debug === true;
  // enable verbose container snapshots with: window.__watchplanner_debug_verbose = true
  const MICRO_RETRY_MS = 60;

  const TRY_COOLDOWN_MS = 120;
  const POLL_INTERVAL_MS = 80;
  const POLL_MAX_ATTEMPTS = 12;
  const SCRIPT_FILES = ['utils.js', 'client-api.js', 'ui-renderer.js', 'ui-modal.js', 'client-ui.js'];
  const CSS_FILENAME = 'watchplanner-styles.css?v=20251218';
  const MODULE_BASE_DEFAULT = '/web/mods/jellyfin-mod-watchplanner-section';

  // ---------- Logging ----------
  function log(...args) { try { if (window.__watchplanner_debug) console.log(LOG_PREFIX, ...args); } catch (e) { /* ignore */ } }
  function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (e) { /* ignore */ } }

  // ---------- State ----------
  window.__watchplanner_state = window.__watchplanner_state || {};
  const STATE = window.__watchplanner_state;
  STATE.lastAttempt = STATE.lastAttempt || {};
  STATE.loadedScripts = STATE.loadedScripts || new Set();
  STATE.scriptsLoadingPromise = STATE.scriptsLoadingPromise || null;
  STATE.scriptsLoaded = !!STATE.scriptsLoaded;

  // ---------- Utilities ----------
  function now() { return Date.now(); }

  function debounce(fn, wait) {
    let t = null;
    return function () { const args = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, args), wait); };
  }

  function isElementVisible(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (el.hasAttribute('hidden')) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
      if (el.offsetParent === null && style.position !== 'fixed') return false;
      if (el.closest && el.closest('.playback, .video-player, .playbackOverlay, .jwplayer')) return false;
      return true;
    } catch (e) { return false; }
  }

  function getModuleBase() {
    try {
      if (window.WATCHPLANNER_SERVER_BASE && String(window.WATCHPLANNER_SERVER_BASE).length) {
        return String(window.WATCHPLANNER_SERVER_BASE).replace(/\/$/, '') + '/web/mods/jellyfin-mod-watchplanner-section';
      }
      const p = window.location.pathname || '';
      const idx = p.indexOf('/web/');
      if (idx > 0) {
        const prefix = p.substring(0, idx);
        return `${prefix}/web/mods/jellyfin-mod-watchplanner-section`;
      }
    } catch (e) { /* ignore */ }
    return MODULE_BASE_DEFAULT;
  }

  // ---------- DOM helpers ----------
  function findHomeSectionsContainerStrict() {
    const candidates = Array.from(document.querySelectorAll('.sections.homeSectionsContainer'));
    if (!candidates.length) return null;
    for (const c of candidates) if (isElementVisible(c)) return c;
    for (const c of candidates) {
      try { if (!c.closest('.playback, .video-player, .playbackOverlay, .jwplayer')) return c; } catch (e) { /* ignore */ }
    }
    return candidates[0] || null;
  }

  function createRootIfMissing() {
    let root = document.getElementById('watchplanner-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'watchplanner-root';
    root.className = 'watchplanner-root';
    root.setAttribute('data-wp-root', '1');
    return root;
  }

  // canonical wrapper finder (single helper)
  function getWrapper(container) {
    try {
      if (!container) return null;
      return container.querySelector('.verticalSection[data-wp-id="watchplanner"], .verticalSection[data-wp-injected="1"]');
    } catch (e) { return null; }
  }

  function createSectionWrapper() {
    const wrapper = document.createElement('div');
    wrapper.className = 'verticalSection section0 emby-scroller-container';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.setAttribute('data-wp-injected', '1');
    wrapper.setAttribute('data-wp-id', 'watchplanner'); // unique marker
    return wrapper;
  }

  function createSectionTitle(titleText, moreHref) {
    const titleContainer = document.createElement('div');
    titleContainer.className = 'sectionTitleContainer sectionTitleContainer-cards padded-left';
    const link = document.createElement('a');
    link.className = 'more button-flat button-flat-mini sectionTitleTextButton emby-button';
    if (moreHref) link.setAttribute('href', moreHref);
    link.setAttribute('is', 'emby-linkbutton');
    const h2 = document.createElement('h2');
    h2.className = 'sectionTitle sectionTitle-cards';
    h2.textContent = titleText || 'Watchplanner';
    const chev = document.createElement('span');
    chev.className = 'material-icons chevron_right';
    chev.setAttribute('aria-hidden', 'true');
    link.appendChild(h2);
    link.appendChild(chev);
    titleContainer.appendChild(link);
    return titleContainer;
  }

  function createScrollerContainer() {
    const scrollerWrap = document.createElement('div');
    scrollerWrap.setAttribute('is', 'emby-scroller');
    scrollerWrap.className = 'padded-top-focusscale padded-bottom-focusscale emby-scroller';
    scrollerWrap.setAttribute('data-centerfocus', 'true');
    scrollerWrap.setAttribute('data-scroll-mode-x', 'custom');
    const itemsContainer = document.createElement('div');
    itemsContainer.setAttribute('is', 'emby-itemscontainer');
    itemsContainer.className = 'itemsContainer scrollSlider focuscontainer-x animatedScrollX';
    itemsContainer.style.whiteSpace = 'nowrap';
    itemsContainer.style.willChange = 'transform';
    scrollerWrap.appendChild(itemsContainer);
    return { scrollerWrap, itemsContainer };
  }

  // ---------- insertion helpers with bounded retry ----------
  const INSERT_RETRY_DELAY = 60; // ms
  const INSERT_MAX_RETRIES = 12; // tuned for initial load

  function isPlaceholderNode(el) {
    try {
      if (!el) return false;
      if (el.id && /loading|indicator/i.test(el.id)) return true;
      if (el.className && /loading|placeholder|skeleton|spinner/i.test(String(el.className))) return true;
      return false;
    } catch (e) { return false; }
  }

  function isOurWrapper(el) {
    try {
      if (!el) return false;
      if (el.getAttribute && (el.getAttribute('data-wp-id') === 'watchplanner' || el.getAttribute('data-wp-injected') === '1')) return true;
      return false;
    } catch (e) { return false; }
  }

  function findVisibleChildren(container) {
    if (!container) return [];
    const children = Array.from(container.children || []);
    const visible = [];
    for (const c of children) {
      try {
        if (isOurWrapper(c)) continue; // skip our wrapper entirely
        if (isPlaceholderNode(c)) continue;
        if (typeof isElementVisible === 'function') {
          if (isElementVisible(c)) visible.push(c);
        } else {
          const style = window.getComputedStyle(c);
          if (style && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0) {
            if (c.offsetParent !== null || style.position === 'fixed') visible.push(c);
          }
        }
      } catch (e) { /* ignore */ }
    }
    return visible;
  }

  function findExistingInjectedWrapper(container) {
    try {
      if (!container) return null;
      // prefer explicit marker
      const byId = container.querySelector('.verticalSection[data-wp-id="watchplanner"]');
      if (byId) return byId;
      const existing = container.querySelector('.verticalSection[data-wp-injected="1"]');
      if (!existing) return null;
      if (existing.querySelector && (existing.querySelector('#watchplanner-root') || existing.querySelector('.watchplanner-slot'))) return existing;
      if (isElementVisible(existing)) return existing;
    } catch (e) { /* ignore */ }
    return null;
  }

  function ensureRootInWrapper(wrapper, root) {
    try {
      if (!wrapper || !root) return false;
      let slot = wrapper.querySelector('.watchplanner-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'watchplanner-slot inlineItem';
        const scroller = wrapper.querySelector('[is="emby-scroller"], .emby-scroller, .itemsContainer');
        if (scroller && scroller.appendChild) scroller.appendChild(slot);
        else wrapper.appendChild(slot);
      }
      if (!slot.contains(root)) slot.appendChild(root);
      return true;
    } catch (e) { return false; }
  }

  function normalizeOrderIfNeeded(container) {
    try {
      const children = Array.from(container.children || []);
      let needs = false;
      for (let i = 0; i < children.length; i++) {
        if ((children[i].style && children[i].style.order) !== String(i)) { needs = true; break; }
      }
      if (needs) children.forEach((el, idx) => { try { el.style.order = String(idx); } catch (e) { } });
    } catch (e) { /* ignore */ }
  }

  function insertRootAfterAnchor(container, root, anchor) {
    try {
      if (!container || !root) return false;
      if (container.contains(root)) return true;

      if (anchor && anchor.insertAdjacentElement) {
        anchor.insertAdjacentElement('afterend', root);
      } else {
        container.prepend(root);
      }

      // immediate normalization to reduce CSS order surprises (only if needed)
      normalizeOrderIfNeeded(container);

      // micro-check: wait one frame + short timeout to catch Jellyfin micro-reorders,
      // then ensure wrapper is after the first visible anchor and re-normalize
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            const wrapper = getWrapper(container);
            if (wrapper) {
              const children = Array.from(container.children || []);
              let firstVisible = null;
              for (const c of children) {
                try {
                  if (isOurWrapper(c)) continue;
                  if (isPlaceholderNode(c)) continue;
                  if (isElementVisible(c)) { firstVisible = c; break; }
                } catch (e) { /* ignore */ }
              }
              if (firstVisible && firstVisible.nextElementSibling !== wrapper) {
                try { firstVisible.insertAdjacentElement('afterend', wrapper); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { /* ignore */ }
          // final normalization if needed
          normalizeOrderIfNeeded(container);
        }, MICRO_RETRY_MS);
      });

      return true;
    } catch (e) { console.warn('insertRootAfterAnchor failed', e); return false; }
  }

  async function insertRootAfterFirstVisibleChildWithRetry(container, root) {
    if (!container || !root) return false;

    // 1) Reuse existing wrapper if present
    const existingWrapper = findExistingInjectedWrapper(container);
    if (existingWrapper) {
      if (ensureRootInWrapper(existingWrapper, root)) {
        normalizeOrderIfNeeded(container);
        return true;
      }
    }

    // 2) Try to find a visible anchor, retrying briefly if none found
    for (let attempt = 0; attempt <= INSERT_MAX_RETRIES; attempt++) {
      const visible = findVisibleChildren(container); // excludes our wrapper
      log('[WatchPlanner] visible anchors (attempt)', attempt, visible.map(v => (v.id || v.className || v.tagName).toString()));
      if (visible.length > 0) {
        const anchor = visible[0];
        insertRootAfterAnchor(container, root, anchor);
        return true;
      }
      // wait one animation frame then a short timeout to catch micro-inserts
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, INSERT_RETRY_DELAY)));
    }

    // 3) As a safer fallback, find first non-hidden candidate (not raw firstElementChild)
    const children = Array.from(container.children || []);
    for (const c of children) {
      try {
        if (isOurWrapper(c)) continue;
        const style = window.getComputedStyle(c);
        if (!style) continue;
        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0) {
          insertRootAfterAnchor(container, root, c);
          return true;
        }
      } catch (e) { /* ignore */ }
    }

    // 4) Last resort: prepend
    try { container.prepend(root); normalizeOrderIfNeeded(container); } catch (e) { /* ignore */ }
    return true;
  }

  // Backwards-compatible alias
  function insertRootAfterFirstVisibleChild(container, root) {
    try {
      if (!container || !root) return false;
      if (container.contains(root)) return true;
      insertRootAfterFirstVisibleChildWithRetry(container, root).catch(e => {
        try { console.warn('insertRootAfterFirstVisibleChild (async) failed', e); } catch (err) { /* ignore */ }
      });
      return true;
    } catch (e) {
      try { console.warn('insertRootAfterFirstVisibleChild wrapper failed', e); } catch (err) { /* ignore */ }
      return false;
    }
  }

  // ---------- Script & CSS loading ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      try {
        if (Array.from(document.scripts).some(s => (s.getAttribute('src') || '') === src)) { resolve(); return; }
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = () => { log('[WatchPlanner] loaded', src); resolve(); };
        script.onerror = (e) => { warn('failed to load', src, e); reject(new Error('failed to load ' + src)); };
        document.head.appendChild(script);
      } catch (e) { reject(e); }
    });
  }

  function injectCss(href) {
    return new Promise((resolve) => {
      try {
        if (Array.from(document.styleSheets).some(s => s.href && s.href.indexOf('watchplanner-styles.css') !== -1)) { resolve(true); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve(true);
        link.onerror = () => { try { link.remove(); } catch (e) { } resolve(false); };
        document.head.appendChild(link);
      } catch (e) { resolve(false); }
    });
  }

  async function ensureClientScripts() {
    if (STATE.scriptsLoaded) return true;
    if (STATE.scriptsLoadingPromise) return STATE.scriptsLoadingPromise;

    STATE.scriptsLoadingPromise = (async () => {
      const base = getModuleBase();
      try { await injectCss(`${base}/${CSS_FILENAME}`); } catch (e) { /* ignore */ }
      for (const f of SCRIPT_FILES) {
        const src = `${base}/${f}`;
        try {
          if (!STATE.loadedScripts.has(src)) {
            log('[WatchPlanner] loading', src);
            await loadScript(src);
            STATE.loadedScripts.add(src);
          }
        } catch (e) { warn('Failed to load', src, e); }
      }
      STATE.scriptsLoaded = true;
      STATE.scriptsLoadingPromise = null;
      return true;
    })();

    return STATE.scriptsLoadingPromise;
  }

  // ---------- Injection lifecycle ----------
  function removeOrphanWrappers(container) {
    try {
      const orphans = container ? Array.from(container.querySelectorAll('.verticalSection[data-wp-injected="1"]')) : [];
      for (const w of orphans) {
        try {
          if (!w.querySelector('#watchplanner-root')) {
            try { w.removeAttribute && w.removeAttribute('data-wp-mounted'); } catch (e) { /* ignore */ }
            w.remove();
            log('[WatchPlanner] Removed orphan wrapper');
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  function markInjectedForRoute(routeKey) {
    try { window.__watchplanner_injected = window.__watchplanner_injected || {}; window.__watchplanner_injected[routeKey] = true; } catch (e) { /* ignore */ }
  }

  function injectedForRoute(routeKey) {
    try { return !!(window.__watchplanner_injected && window.__watchplanner_injected[routeKey]); } catch (e) { return false; }
  }

  async function callUiMountAndAwait(rootEl, routeKey) {
    try {
      if (!rootEl) return false;
      if (window.WatchplannerUI && typeof window.WatchplannerUI.mount === 'function') {
        try {
          const res = window.WatchplannerUI.mount(rootEl);
          if (res && typeof res.then === 'function') await res;
          log('[WatchPlanner] WatchplannerUI.mount resolved', routeKey);
        } catch (e) { warn('WatchplannerUI.mount threw', e); }
      } else if (window.WatchplannerUI && typeof window.WatchplannerUI.loadAndRender === 'function') {
        try {
          const res = window.WatchplannerUI.loadAndRender();
          if (res && typeof res.then === 'function') await res;
          log('[WatchPlanner] WatchplannerUI.loadAndRender resolved', routeKey);
        } catch (e) { warn('WatchplannerUI.loadAndRender threw', e); }
      } else if (typeof loadAndRender === 'function') {
        try {
          const res = loadAndRender();
          if (res && typeof res.then === 'function') await res;
          log('[WatchPlanner] global loadAndRender resolved', routeKey);
        } catch (e) { warn('global loadAndRender threw', e); }
      } else {
        log('[WatchPlanner] No UI mount/load function available', routeKey);
      }

      let attempts = 0;
      while (attempts < POLL_MAX_ATTEMPTS) {
        attempts++;
        if (rootEl.childElementCount && rootEl.childElementCount > 0) return true;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
      return false;
    } catch (e) { warn('callUiMountAndAwait failed', e); return false; }
  }

  // --- robust wrapper reuse + repositioning ---
  async function ensureWrapperAndPosition(container, root) {
    if (!container || !root) return false;

    function findFirstVisibleAnchor() {
      const visible = findVisibleChildren(container); // excludes our wrapper
      return visible.length ? visible[0] : null;
    }

    function moveWrapperAfter(wrapperEl, anchor) {
      try {
        if (!wrapperEl) return false;
        if (!anchor) {
          if (!container.contains(wrapperEl)) container.prepend(wrapperEl);
          return true;
        }
        const next = anchor.nextElementSibling;
        if (next === wrapperEl) return true;
        anchor.insertAdjacentElement('afterend', wrapperEl);
        return true;
      } catch (e) { return false; }
    }

    // 1) If wrapper exists, reuse it and ensure root inside
    let wrapper = getWrapper(container);
    if (wrapper) {
      ensureRootInWrapper(wrapper, root);
      const anchor = findFirstVisibleAnchor();
      if (anchor && anchor !== wrapper) moveWrapperAfter(wrapper, anchor);
      else {
        // schedule a short retry to reposition if Jellyfin inserts the real first section shortly after
        setTimeout(() => {
          try {
            const laterAnchor = findFirstVisibleAnchor();
            if (laterAnchor && laterAnchor !== wrapper) moveWrapperAfter(wrapper, laterAnchor);
          } catch (e) { /* ignore */ }
        }, 120);
      }
      installRepositionObserver(container, root);
      return true;
    }

    // 2) No wrapper yet: insert root after first visible child (with retry)
    await insertRootAfterFirstVisibleChildWithRetry(container, root);

    // After insertion, ensure wrapper exists and root is inside
    wrapper = findExistingInjectedWrapper(container);
    if (wrapper) ensureRootInWrapper(wrapper, root);

    // 3) Install reposition observer to handle later reorders
    installRepositionObserver(container, root);
    return true;
  }

  function installRepositionObserver(container, root) {
    try {
      if (!container || !root) return;
      if (container.__wp_reposition_observer) return;

      const wrapperSelector = '.verticalSection[data-wp-id="watchplanner"], .verticalSection[data-wp-injected="1"]';
      let stableCount = 0;
      const MAX_STABLE = 6;

      const obs = new MutationObserver((mutations) => {
        try {
          const wrapper = container.querySelector(wrapperSelector);
          if (!wrapper) {
            ensureWrapperAndPosition(container, root).catch(() => { /* ignore */ });
            return;
          }

          const firstVisible = (function () {
            const children = Array.from(container.children || []);
            for (const c of children) {
              try {
                if (isOurWrapper(c)) continue;
                if (isPlaceholderNode(c)) continue;
                if (isElementVisible(c)) return c;
              } catch (e) { /* ignore */ }
            }
            return null;
          })();

          if (firstVisible && firstVisible.nextElementSibling !== wrapper) {
            try { firstVisible.insertAdjacentElement('afterend', wrapper); } catch (e) { /* ignore */ }
            stableCount = 0;
          } else {
            stableCount++;
          }

          if (stableCount >= MAX_STABLE) {
            try { obs.disconnect(); } catch (e) { /* ignore */ }
            container.__wp_reposition_observer = null;
          }
        } catch (e) { /* ignore */ }
      });

      obs.observe(container, { childList: true, subtree: false });
      container.__wp_reposition_observer = obs;

      setTimeout(() => {
        try { if (container.__wp_reposition_observer) { container.__wp_reposition_observer.disconnect(); container.__wp_reposition_observer = null; } } catch (e) { /* ignore */ }
      }, 2000);
    } catch (e) { /* ignore */ }
  }

  // ---------- Main injection routine ----------
  async function tryInjectWhenReady() {
    const routeKey = location.pathname + location.hash;
    log('[WatchPlanner] tryInjectWhenReady invoked', { route: routeKey, rootExists: !!document.getElementById('watchplanner-root') });

    try {
      const nowTs = now();
      const last = STATE.lastAttempt[routeKey] || 0;
      const rootExists = !!document.getElementById('watchplanner-root');
      if (!rootExists) {
        try { delete STATE.lastAttempt[routeKey]; } catch (e) { /* ignore */ }
      } else if (nowTs - last < TRY_COOLDOWN_MS) {
        log('[WatchPlanner] tryInjectWhenReady: throttled', routeKey);
        return false;
      }
      STATE.lastAttempt[routeKey] = nowTs;
    } catch (e) { /* ignore */ }

    if (!(window.location.hash || '').startsWith('#/home')) return false;

    const container = findHomeSectionsContainerStrict();
    if (!container) {
      log('[WatchPlanner] tryInjectWhenReady: home sections container not found');
      return false;
    }

    removeOrphanWrappers(container);

    if (injectedForRoute(routeKey)) {
      const existingRoot = document.getElementById('watchplanner-root');

      if (existingRoot && container.contains(existingRoot)) {
        log('[WatchPlanner] already injected for route and root still present; verifying position', routeKey);

        const wrapper = getWrapper(container);
        if (wrapper) {
          // find first visible anchor (excluding our wrapper)
          const firstVisible = (function () {
            const children = Array.from(container.children || []);
            for (const c of children) {
              try {
                if (isOurWrapper(c)) continue;
                if (isPlaceholderNode(c)) continue;
                if (isElementVisible(c)) return c;
              } catch (e) { /* ignore */ }
            }
            return null;
          })();

          // If wrapper is not after the anchor in DOM, move it
          if (firstVisible && firstVisible.nextElementSibling !== wrapper) {
            try { firstVisible.insertAdjacentElement('afterend', wrapper); log('[WatchPlanner] moved existing wrapper after first visible anchor'); } catch (e) { warn('reposition failed', e); }
          }

          // Normalize order values for all children to prevent CSS order from overriding DOM order
          normalizeOrderIfNeeded(container);
          log('[WatchPlanner] normalized order after reposition');

          // schedule a micro-check to catch immediate Jellyfin reorders
          setTimeout(() => {
            try {
              const firstVisibleNow = (function () {
                const children = Array.from(container.children || []);
                for (const c of children) {
                  try {
                    if (isOurWrapper(c)) continue;
                    if (isPlaceholderNode(c)) continue;
                    if (isElementVisible(c)) return c;
                  } catch (e) { /* ignore */ }
                }
                return null;
              })();
              if (firstVisibleNow && firstVisibleNow.nextElementSibling !== wrapper) {
                try { firstVisibleNow.insertAdjacentElement('afterend', wrapper); log('[WatchPlanner] micro-corrected wrapper position'); } catch (e) { /* ignore */ }
                normalizeOrderIfNeeded(container);
              }
            } catch (e) { /* ignore */ }
          }, 80);
        } else {
          // no wrapper found: ensure wrapper/slot exists and position it
          try { await ensureWrapperAndPosition(container, existingRoot); log('[WatchPlanner] ensured wrapper for existing root'); } catch (e) { warn('ensureWrapperAndPosition failed', e); }
        }

        // continue the flow (do not return early) so mount logic runs if needed
      } else {
        try { delete window.__watchplanner_injected[routeKey]; } catch (e) { /* ignore */ }
        log('[WatchPlanner] previous injection marker cleared because root missing', routeKey);
      }
    }

    if (!container.childElementCount || container.childElementCount < 3) {
      log('[WatchPlanner] container found but not populated yet; observing for children');
      const obs = new MutationObserver((mutations, observer) => {
        if (container.childElementCount && container.childElementCount > 2) {
          observer.disconnect();
          setTimeout(() => tryInjectWhenReady(), 80);
        }
      });
      obs.observe(container, { childList: true, subtree: false });
      setTimeout(() => { try { obs.disconnect(); } catch (e) { } tryInjectWhenReady(); }, 5000);
      return false;
    }

    const root = createRootIfMissing();
    await ensureWrapperAndPosition(container, root);

    try {
      if (window.WPSectionize && typeof window.WPSectionize.wrapRootAsSection === 'function') {
        window.WPSectionize.wrapRootAsSection(root, 'Watchplanner', '#');
      } else {
        const existingWrapper = getWrapper(container);
        if (!existingWrapper) {
          const wrapper = createSectionWrapper();
          const title = createSectionTitle('Watchplanner', '#');
          const scroller = createScrollerContainer();
          const itemSlot = document.createElement('div');
          itemSlot.className = 'watchplanner-slot inlineItem';
          container.appendChild(wrapper);
          itemSlot.appendChild(root);
          scroller.itemsContainer.appendChild(itemSlot);
          wrapper.appendChild(title);
          wrapper.appendChild(scroller.scrollerWrap);
        } else {
          ensureRootInWrapper(existingWrapper, root);
        }
      }
    } catch (e) { /* ignore */ }

    ensureClientScripts()
      .catch(e => warn('ensureClientScripts error', e))
      .then(async () => {
        try {
          const wrapperEl = root.parentElement && root.parentElement.classList && root.parentElement.classList.contains('verticalSection') ? root.parentElement : null;

          if (root.childElementCount && root.childElementCount > 0) {
            if (wrapperEl && wrapperEl.setAttribute) wrapperEl.setAttribute('data-wp-mounted', '1');
            markInjectedForRoute(routeKey);
            log('[WatchPlanner] root already populated; marked wrapper mounted', routeKey);
            return;
          }

          if (wrapperEl && !wrapperEl.__wp_fast_vis) {
            wrapperEl.__wp_fast_vis = true;
            const visObs = new MutationObserver(() => {
              try {
                if (isElementVisible(wrapperEl)) {
                  try { wrapperEl.removeAttribute && wrapperEl.removeAttribute('data-wp-mounted'); } catch (e) { /* ignore */ }
                  setTimeout(async () => {
                    try {
                      const rootNow = document.getElementById('watchplanner-root');
                      if (rootNow) {
                        const ok = await callUiMountAndAwait(rootNow, routeKey);
                        if (ok && wrapperEl.setAttribute) wrapperEl.setAttribute('data-wp-mounted', '1');
                        if (ok) markInjectedForRoute(routeKey);
                      }
                    } catch (e) { warn('fast-visibility mount failed', e); }
                  }, 40);
                  visObs.disconnect();
                  wrapperEl.__wp_fast_vis = null;
                }
              } catch (e) { /* ignore */ }
            });
            visObs.observe(document.documentElement || document.body, { childList: true, subtree: true });
            wrapperEl.__wp_fast_vis_observer = visObs;
          }

          const mounted = await callUiMountAndAwait(root, routeKey);
          if (mounted) {
            if (wrapperEl && wrapperEl.setAttribute) wrapperEl.setAttribute('data-wp-mounted', '1');
            markInjectedForRoute(routeKey);
            log('[WatchPlanner] root populated; marked wrapper mounted', routeKey);
          } else {
            log('[WatchPlanner] mount attempt finished but root still empty', routeKey);
          }
        } catch (e) { warn('mount after insertion failed', e); }
      });

    return true;
  }

  // ---------- SPA detection & watchers ----------
  const triggerInjectDebounced = debounce(() => { try { tryInjectWhenReady(); } catch (e) { /* ignore */ } }, 120);

  (function enableSpaNavigationDetection() {
    try {
      const wrapHistory = (name) => {
        const orig = history[name];
        history[name] = function () {
          const res = orig.apply(this, arguments);
          try { window.dispatchEvent(new Event('watchplanner-history-change')); } catch (e) { /* ignore */ }
          return res;
        };
      };

      window.addEventListener('watchplanner-history-change', () => {
        try {
          const routeKey = location.pathname + location.hash;
          if (window.__watchplanner_state && window.__watchplanner_state.lastAttempt) {
            try { delete window.__watchplanner_state.lastAttempt[routeKey]; } catch (e) { /* ignore */ }
          }
          setTimeout(() => tryInjectWhenReady(), 80);
        } catch (e) { /* ignore */ }
      });

      wrapHistory('pushState');
      wrapHistory('replaceState');
      window.addEventListener('popstate', () => { try { window.dispatchEvent(new Event('watchplanner-history-change')); } catch (e) { /* ignore */ } });

      window.addEventListener('watchplanner-history-change', () => { try { setTimeout(triggerInjectDebounced, 80); } catch (e) { /* ignore */ } });

      function ensureBodyObserver() {
        try {
          if (STATE.bodyObserver) return;
          const target = document.body || document.documentElement;
          if (!target) { setTimeout(ensureBodyObserver, 120); return; }

          function likelyHomeContainerAdded(mutation) {
            if (!mutation || !mutation.addedNodes || mutation.addedNodes.length === 0) return false;
            for (const n of mutation.addedNodes) {
              try {
                if (n.nodeType !== 1) continue;
                const el = n;
                if (el.matches && el.matches('.sections.homeSectionsContainer')) return true;
                if (el.querySelector && el.querySelector('.sections.homeSectionsContainer')) return true;
                if (el.childElementCount && el.childElementCount > 6) return true;
              } catch (e) { /* ignore */ }
            }
            return false;
          }

          const bodyObs = new MutationObserver((mutations) => {
            try {
              for (const m of mutations) {
                if (likelyHomeContainerAdded(m)) { triggerInjectDebounced(); return; }
              }
            } catch (e) { /* ignore */ }
          });

          bodyObs.observe(target, { childList: true, subtree: true });
          STATE.bodyObserver = bodyObs;
        } catch (e) { warn('body observer init failed', e); }
      }

      ensureBodyObserver();
    } catch (e) { warn('SPA detection init failed', e); }
  })();

  // Logo / anchor click watcher
  (function watchLogoAnchors() {
    try {
      document.addEventListener('click', (ev) => {
        try {
          const a = ev.target.closest && ev.target.closest('a[href]');
          if (!a) return;
          const href = (a.getAttribute && a.getAttribute('href')) || '';
          if (!href) return;
          if (href.indexOf('#/') !== -1 || href.indexOf('#/home') !== -1) {
            try { if (window.__watchplanner_state && window.__watchplanner_state.lastAttempt) delete window.__watchplanner_state.lastAttempt[location.pathname + '#/home']; } catch (e) { /* ignore */ }
            setTimeout(() => tryInjectWhenReady(), 140);
          }
        } catch (e) { /* ignore */ }
      }, true);
    } catch (e) { /* ignore */ }
  })();

  // Header home button watcher
  (function watchHeaderHomeClicks() {
    try {
      document.addEventListener('click', (ev) => {
        try {
          const btn = ev.target.closest && ev.target.closest('.headerHomeButton, .headerHome, .header-home, .headerButton.headerHomeButton');
          if (!btn) return;
          setTimeout(() => { tryInjectWhenReady(); }, 120);
        } catch (e) { /* ignore */ }
      }, true);
    } catch (e) { /* ignore */ }
  })();

  // ---------- Startup ----------
  function startWatcher() {
    try { ensureClientScripts().catch(e => warn('preload ensureClientScripts failed', e)); } catch (e) { /* ignore */ }
    tryInjectWhenReady();
    window.addEventListener('hashchange', () => { setTimeout(() => tryInjectWhenReady(), 150); });
    window.addEventListener('popstate', () => { setTimeout(() => tryInjectWhenReady(), 150); });

    const docObserver = new MutationObserver((mutations, obs) => {
      if (findHomeSectionsContainerStrict()) {
        tryInjectWhenReady();
        try { obs.disconnect(); } catch (e) { /* ignore */ }
      }
    });
    docObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });

    let attempts = 0;
    const maxAttempts = 20;
    const retryInterval = setInterval(() => {
      attempts++;
      tryInjectWhenReady();
      if (attempts >= maxAttempts) {
        clearInterval(retryInterval);
        try { docObserver.disconnect(); } catch (e) { /* ignore */ }
        log('[WatchPlanner] stopped retrying injection after attempts');
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startWatcher, { once: true });
  } else {
    startWatcher();
  }

  // ---------- Public helpers ----------
  window.WatchplannerBootstrap = window.WatchplannerBootstrap || {};

  window.WatchplannerBootstrap.mount = function () {
    try {
      try { delete window.__watchplanner_injected[location.pathname + location.hash]; } catch (e) { /* ignore */ }
      tryInjectWhenReady();
      log('[WatchPlanner] WatchplannerBootstrap.mount invoked');
    } catch (e) { warn('WatchplannerBootstrap.mount failed', e); }
  };

  window.WatchplannerBootstrap.unmount = function () {
    try {
      const root = document.getElementById('watchplanner-root');
      if (root) try { root.remove(); } catch (e) { /* ignore */ }
      Array.from(document.querySelectorAll('.verticalSection[data-wp-id="watchplanner"], .verticalSection[data-wp-injected="1"]')).forEach(w => { try { w.remove(); } catch (e) { /* ignore */ } });
      try { window.__watchplanner_injected = {}; } catch (e) { /* ignore */ }
      log('[WatchPlanner] WatchplannerBootstrap.unmount invoked');
    } catch (e) { warn('WatchplannerBootstrap.unmount failed', e); }
  };

  window.WatchplannerBootstrap.destroy = function () {
    try {
      try { STATE.bodyObserver && STATE.bodyObserver.disconnect(); } catch (e) { /* ignore */ }
      try { delete window.__watchplanner_state; } catch (e) { /* ignore */ }
      log('[WatchPlanner] WatchplannerBootstrap.destroy invoked');
    } catch (e) { warn('WatchplannerBootstrap.destroy failed', e); }
  };

  log('[WatchPlanner] watchplanner.bootstrap initialized');
})();
