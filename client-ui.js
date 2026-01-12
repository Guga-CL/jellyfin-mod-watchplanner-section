// client-ui.js - Watchplanner UI (refactored)
// - Promise-based mount/load API for robust injector integration
// - Minimal public surface, idempotent init, debug gated

(function () {
    'use strict';

    // ---------- Config / Debug ----------
    const LOG_PREFIX = '[WatchPlanner] client-ui:';
    // Enable debug logs at runtime: window.__watchplanner_debug = true;
    window.__watchplanner_debug = window.__watchplanner_debug === true; // default false

    function log(...args) { try { if (window.__watchplanner_debug) console.log(LOG_PREFIX, ...args); } catch (e) { } }
    function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (e) { } }

    // ---------- Utilities (use WPUtils when available) ----------
    const WPUtils = window.WPUtils || {};
    const el = WPUtils.el || function (tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const k in attrs) {
            if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
            const v = attrs[k];
            if (k === 'style' && v && typeof v === 'object') Object.assign(node.style, v);
            else if (k === 'class') node.className = v;
            else if (k === 'dataset' && v && typeof v === 'object') for (const d in v) node.dataset[d] = v[d];
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.substring(2), v);
            else if (k === 'html') node.innerHTML = v;
            else node.setAttribute(k, String(v));
        }
        for (const c of children) {
            if (c == null) continue;
            if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
            else node.appendChild(c);
        }
        return node;
    };

    const debounce = WPUtils.debounce || function (fn, wait = 250) {
        let t = null;
        return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
    };

    // ---------- Local state ----------
    window.STATE = window.STATE || { schedule: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] } };

    // ---------- Helpers ----------
    function buildImageUrl(path) {
        if (!path) return '';
        try {
            if (window.WatchplannerAPI && typeof window.WatchplannerAPI.buildImageUrl === 'function') {
                return window.WatchplannerAPI.buildImageUrl(path);
            }
        } catch (e) { /* ignore */ }
        return (window.location.origin || '') + path;
    }

    async function ensureWatchplannerCss() {
        try {
            const found = Array.from(document.styleSheets).some(s => s.href && s.href.indexOf('watchplanner-styles.css') !== -1);
            if (found) return true;
            const href = (window.WATCHPLANNER_SERVER_BASE && String(window.WATCHPLANNER_SERVER_BASE).length)
                ? `${String(window.WATCHPLANNER_SERVER_BASE).replace(/\/$/, '')}/web/mods/jellyfin-mod-watchplanner-section/watchplanner-styles.css?v=20251218`
                : '/web/mods/jellyfin-mod-watchplanner-section/watchplanner-styles.css?v=20251218';
            return new Promise((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.onload = () => resolve(true);
                link.onerror = () => { try { link.remove(); } catch (e) { } resolve(false); };
                document.head.appendChild(link);
            });
        } catch (e) { return false; }
    }

    // canonical day keys used across the UI
    const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // small helper to return the common watchplanner DOM scope
    function getWatchplannerScope() {
        const wrapper = document.querySelector('.verticalSection[data-wp-id="watchplanner"], .verticalSection[data-wp-injected="1"]');
        const root = document.getElementById('watchplanner-root') || (wrapper && wrapper.querySelector('#watchplanner-root'));
        const container = (wrapper && wrapper.querySelector('.watchplanner-slot')) || root || wrapper;
        const scroller = (wrapper && wrapper.querySelector('.itemsContainer')) || (container && container.querySelector('.wp-days')) || container;
        return { wrapper, root, container, scroller };
    }

    // ---------- DOM building ----------
    function findContainer() {
        const rootEl = document.getElementById('watchplanner-root');
        const wrapper = rootEl && rootEl.parentElement && rootEl.parentElement.classList && rootEl.parentElement.classList.contains('verticalSection')
            ? rootEl.parentElement
            : null;
        const slot = wrapper ? wrapper.querySelector('.watchplanner-slot') : null;
        return { rootEl, wrapper, slot, container: slot || rootEl };
    }

    function buildRootContent() {
        // Find the container and any existing root element
        const { rootEl: foundRootEl, slot, container: foundContainer } = findContainer();
        if (!foundContainer) return null;

        // Determine canonical insertion point: reuse existing #watchplanner-root if present,
        // otherwise create it once and append to the container/slot.
        let rootEl = (foundRootEl && foundContainer.contains(foundRootEl)) ? foundRootEl : null;
        let container = foundContainer;

        if (!rootEl) {
            // create a single root element and append it once
            rootEl = document.createElement('div');
            rootEl.id = 'watchplanner-root';
            rootEl.className = 'watchplanner-root';
            rootEl.dataset.wpRoot = '1';
            // append into the slot (foundContainer) or the root location
            container.appendChild(rootEl);
            // use the newly created root as the canonical container for dynamic content
            container = rootEl;
        } else {
            // reuse existing root: clear only its dynamic content
            rootEl.innerHTML = '';
            // ensure we render into the existing root
            container = rootEl;
        }

        // Controls only when rendering directly into root (no slot)
        if (!slot) {
            const controls = el('div', { class: 'wp-controls' },
                el('button', {
                    class: 'wp-refresh',
                    onclick: async () => {
                        try { await ensureWatchplannerCss(); } catch (e) { /* ignore */ }
                        if (window.WatchplannerUI && typeof window.WatchplannerUI.loadAndRender === 'function') {
                            window.WatchplannerUI.loadAndRender();
                        } else {
                            loadAndRender();
                        }
                    }
                }, 'Refresh')
            );
            container.appendChild(controls);
        }

        const days = el('div', { class: 'wp-days' });
        DAY_KEYS.forEach(k => {
            const header = el('div', { class: 'watchplanner-header-cell' }, k);
            const dayCell = el('div', { class: 'wp-day', dataset: { day: k } }, header, el('div', { class: 'wp-day-list' }));
            days.appendChild(dayCell);
        });
        container.appendChild(days);

        // placeholder for modal
        container.appendChild(el('div', { class: 'wp-modal-placeholder' }));

        // If a slot appears later, hide controls rendered into root
        if (foundRootEl) {
            try {
                if (foundRootEl.__wp_slot_observer) {
                    try { foundRootEl.__wp_slot_observer.disconnect(); } catch (e) { /* ignore */ }
                    foundRootEl.__wp_slot_observer = null;
                }
                const observer = new MutationObserver(() => {
                    const { slot: newSlot } = findContainer();
                    if (newSlot) {
                        try {
                            const c = foundRootEl.querySelector('.wp-controls');
                            if (c) c.remove();
                            foundRootEl.style.display = 'none';
                        } catch (e) { /* ignore */ }
                        try { observer.disconnect(); } catch (e) { /* ignore */ }
                        foundRootEl.__wp_slot_observer = null;
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                foundRootEl.__wp_slot_observer = observer;
            } catch (e) { /* ignore */ }
        }

        return container;
    }

    // ---------- Delegated clicks ----------
    function installDelegatedClicks() {
        const { container } = findContainer();
        if (!container) return;
        if (container.__wp_delegation_installed) return;

        function tryOpen(dayKey, existing) {
            try {
                if (window.WPModal && typeof window.WPModal.openModal === 'function') {
                    window.WPModal.openModal(dayKey, existing);
                    return true;
                }
                // poll briefly if not ready
                let attempts = 0;
                const id = setInterval(() => {
                    attempts++;
                    if (window.WPModal && typeof window.WPModal.openModal === 'function') {
                        clearInterval(id);
                        try { window.WPModal.openModal(dayKey, existing); } catch (e) { /* ignore */ }
                    } else if (attempts > 20) {
                        clearInterval(id);
                    }
                }, 100);
            } catch (e) { /* ignore */ }
            return false;
        }

        const handler = (ev) => {
            try {
                const header = ev.target.closest && ev.target.closest('.watchplanner-header-cell');
                if (header) {
                    const dayKey = header.textContent && header.textContent.trim();
                    const existing = (window.STATE && window.STATE.schedule && window.STATE.schedule[dayKey] && window.STATE.schedule[dayKey][0]) ? window.STATE.schedule[dayKey][0] : null;
                    tryOpen(dayKey, existing);
                    ev.stopPropagation();
                    ev.preventDefault();
                    return;
                }
                const item = ev.target.closest && ev.target.closest('.wp-item');
                if (item) {
                    const col = item.closest && item.closest('.wp-day');
                    const dayKey = col && col.dataset && col.dataset.day ? col.dataset.day : null;
                    const existing = (dayKey && window.STATE && window.STATE.schedule && window.STATE.schedule[dayKey] && window.STATE.schedule[dayKey][0]) ? window.STATE.schedule[dayKey][0] : null;
                    if (dayKey) tryOpen(dayKey, existing);
                }
            } catch (e) { /* ignore */ }
        };

        container.addEventListener('click', handler, true);
        container.__wp_delegation_installed = true;
    }

    // ---------- Rendering ----------
    function renderSchedule() {
        const { container } = findContainer();
        if (!container) return;
        const daysContainer = container.querySelector('.wp-days');
        if (!daysContainer) return;

        DAY_KEYS.forEach(k => {
            const cell = daysContainer.querySelector(`.wp-day[data-day="${k}"]`);
            if (!cell) return;
            const list = cell.querySelector('.wp-day-list');
            list.innerHTML = '';
            const items = (window.STATE && window.STATE.schedule && window.STATE.schedule[k]) ? window.STATE.schedule[k] : [];
            if (!items || !items.length) {
                list.appendChild(el('div', { class: 'wp-empty' }, '—'));
            } else {
                items.forEach(it => {
                    const itemEl = el('div', { class: 'wp-item', dataset: { id: it.id || '' } },
                        el('img', { src: buildImageUrl(it.img || ''), alt: it.name || '', width: 140 }),
                        el('div', { class: 'wp-name' }, it.name || '')
                    );
                    list.appendChild(itemEl);
                });
            }
        });

        // ensure delegated clicks are installed
        installDelegatedClicks();

        // #region test
        (function () {
            const STORAGE_KEY = 'watchplanner.dayDelayMinutes';

            function loadDayDelayMinutes() {
                try {
                    const stored = localStorage.getItem(STORAGE_KEY);
                    const fallback = (typeof window.WATCHPLANNER_DAY_DELAY_MINUTES === 'number') ? window.WATCHPLANNER_DAY_DELAY_MINUTES : 0;
                    const v = stored !== null ? Number(stored) : fallback;
                    const n = Number.isFinite(v) ? v : 0;
                    window.WATCHPLANNER_DAY_DELAY_MINUTES = n;
                    return n;
                } catch (e) {
                    window.WATCHPLANNER_DAY_DELAY_MINUTES = 0;
                    return 0;
                }
            }

            // returns { ok: true } or { ok: false, error: 'msg' }
            function saveDayDelayMinutes(value) {
                const n = Number(value);
                if (!Number.isFinite(n)) return { ok: false, error: 'Invalid number' };
                if (n < -1440 || n > 1440) return { ok: false, error: 'Value out of allowed range (-1440..1440)' };
                try {
                    localStorage.setItem(STORAGE_KEY, String(n));
                    window.WATCHPLANNER_DAY_DELAY_MINUTES = n;
                    // Reapply markToday and center once via the wrapper
                    if (typeof markTodayWithDelayAndCenter === 'function') {
                        try { markTodayWithDelayAndCenter(); } catch (e) { /* ignore */ }
                    } else if (typeof markTodayWithDelay === 'function') {
                        try { markTodayWithDelay(); } catch (e) { /* ignore */ }
                    }
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: 'Storage error' };
                }
            }

            // default (can be overridden before this script runs)
            if (typeof window.WATCHPLANNER_DAY_DELAY_MINUTES !== 'number') {
                window.WATCHPLANNER_DAY_DELAY_MINUTES = 120;
            }

            function getAdjustedDateByMinutes() {
                const delayMinutes = Number(window.WATCHPLANNER_DAY_DELAY_MINUTES);
                const delay = Number.isFinite(delayMinutes) ? delayMinutes : 0;
                return new Date(Date.now() - delay * 60 * 1000);
            }

            function markTodayWithDelay(container) {
                try {
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const adjustedDate = getAdjustedDateByMinutes();
                    const todayKey = dayNames[adjustedDate.getDay()];
                    const root = container || document;
                    const dayEls = Array.from(root.querySelectorAll('.wp-day[data-day]'));
                    const keys = dayEls.map(el => el.getAttribute('data-day')).filter(Boolean);
                    keys.forEach(k => {
                        const cell = root.querySelector(`.wp-day[data-day="${k}"]`);
                        if (!cell) return;
                        if (k === todayKey) cell.classList.add('today');
                        else cell.classList.remove('today');
                    });
                } catch (e) { /* ignore */ }
            }

            // Expose helpers for later use (modal, console)
            window.WatchplannerDayDelay = {
                load: loadDayDelayMinutes,
                save: saveDayDelayMinutes,
                apply: markTodayWithDelay,
                getAdjustedDate: getAdjustedDateByMinutes
            };

            setTimeout(() => {
                try { markTodayWithDelay(); } catch (e) { /* ignore */ }
                try {
                    // run the existing auto-scroll logic after .today is applied
                    // (re-use the same scroller code block or call a helper)
                    (function attemptCenter(attemptsLeft = 6) {
                        requestAnimationFrame(() => setTimeout(() => {
                            try {
                                const { wrapper, container, scroller } = getWatchplannerScope();
                                const sc = scroller;
                                const todayEl = (container && container.querySelector('.wp-day.today')) || document.querySelector('.wp-day.today');
                                if (!sc || !todayEl) {
                                    if (attemptsLeft > 0) return attemptCenter(attemptsLeft - 1);
                                    return;
                                }
                                const scRect = sc.getBoundingClientRect();
                                const elRect = todayEl.getBoundingClientRect();
                                const offsetLeft = (typeof todayEl.offsetLeft === 'number' ? todayEl.offsetLeft : (elRect.left - scRect.left + (sc.scrollLeft || 0)));
                                const viewport = sc.clientWidth || scRect.width || 0;
                                const elWidth = todayEl.clientWidth || elRect.width || 0;
                                const target = Math.max(0, Math.round(offsetLeft - Math.round((viewport - elWidth) / 2)));
                                try {
                                    if (typeof sc.scrollTo === 'function') sc.scrollTo({ left: target, behavior: 'smooth' });
                                    else sc.scrollLeft = target;
                                } catch (e) { try { sc.scrollLeft = target; } catch (e2) { /* ignore */ } }
                                if (attemptsLeft > 0) {
                                    setTimeout(() => {
                                        const cur = sc.scrollLeft || 0;
                                        if (Math.abs(cur - target) > 4) attemptCenter(attemptsLeft - 1);
                                    }, 120);
                                }
                            } catch (e) {
                                if (attemptsLeft > 0) setTimeout(() => attemptCenter(attemptsLeft - 1), 120);
                            }
                        }, 40));
                    })();
                } catch (e) { /* ignore */ }
            }, 40);

        })();


        // # endregion mark today
        // Helper: mark today then center (centralized to avoid duplicate calls)
        function markTodayWithDelayAndCenter(container) {
            try { markTodayWithDelay(container); } catch (e) { /* ignore */ }
        }

        // auto-scroll on small screens
        try {
            const MOBILE_BREAKPOINT = 720;
            if (window.innerWidth <= MOBILE_BREAKPOINT) {
                const scroller = (container.closest('.verticalSection') && container.closest('.verticalSection').querySelector('.itemsContainer')) || container.querySelector('.wp-days') || container;
                const todayEl = container.querySelector('.wp-day.today');

                if (scroller && todayEl) {
                    (function attemptCenter(attemptsLeft = 6) {
                        // wait a frame so custom elements and layout settle
                        requestAnimationFrame(() => setTimeout(() => {
                            try {
                                // re-query in case DOM changed
                                const sc = (scroller && scroller.nodeType) ? scroller : document.querySelector('.itemsContainer') || scroller;
                                const today = (todayEl && todayEl.nodeType) ? todayEl : sc.querySelector('.wp-day.today');
                                if (!sc || !today) {
                                    if (attemptsLeft > 0) return attemptCenter(attemptsLeft - 1);
                                    return;
                                }

                                const scRect = sc.getBoundingClientRect();
                                const elRect = today.getBoundingClientRect();

                                // offset relative to scroller viewport plus current scrollLeft
                                const offsetLeft = (typeof today.offsetLeft === 'number' ? today.offsetLeft : (elRect.left - scRect.left + (sc.scrollLeft || 0)));
                                const viewport = sc.clientWidth || scRect.width || 0;
                                const elWidth = today.clientWidth || elRect.width || 0;
                                const target = Math.max(0, Math.round(offsetLeft - Math.round((viewport - elWidth) / 2)));

                                // prefer smooth scroll if available, fallback to scrollLeft
                                try {
                                    if (typeof sc.scrollTo === 'function') sc.scrollTo({ left: target, behavior: 'smooth' });
                                    else sc.scrollLeft = target;
                                } catch (e) {
                                    try { sc.scrollLeft = target; } catch (e2) { /* ignore */ }
                                }

                                // if scroller still not centered and we have retries, try again
                                if (attemptsLeft > 0) {
                                    // small delay to allow scroller internals to settle
                                    setTimeout(() => {
                                        const cur = sc.scrollLeft || 0;
                                        if (Math.abs(cur - target) > 4) attemptCenter(attemptsLeft - 1);
                                    }, 120);
                                }
                            } catch (e) {
                                if (attemptsLeft > 0) setTimeout(() => attemptCenter(attemptsLeft - 1), 120);
                            }
                        }, 40));
                    })();
                }
            }
        } catch (e) { /* ignore */ }

    }

    // ---------- Public API functions ----------
    function assignItemToDay(dayKey, item) {
        try {
            if (!dayKey || !item) return false;
            if (!window.STATE) window.STATE = { schedule: {} };
            if (!window.STATE.schedule) window.STATE.schedule = {};
            if (!Array.isArray(window.STATE.schedule[dayKey])) window.STATE.schedule[dayKey] = [];
            window.STATE.schedule[dayKey] = [{ id: item.id || '', name: item.name || '', img: item.img || '' }];
            renderSchedule();
            return true;
        } catch (e) { warn('assignItemToDay failed', e); return false; }
    }

    async function saveSchedule() {
        try {
            if (!window.WatchplannerAPI || typeof window.WatchplannerAPI.save !== 'function') {
                warn('saveSchedule: WatchplannerAPI.save not available');
                return { ok: false, reason: 'api-missing' };
            }
            const res = await window.WatchplannerAPI.save(window.STATE.schedule, { makeBackup: true });
            log('saveSchedule result', res);
            return res;
        } catch (e) { warn('saveSchedule error', e); return { ok: false, error: e }; }
    }

    async function loadAndRender() {
        try {
            if (!window.WatchplannerAPI || typeof window.WatchplannerAPI.load !== 'function') {
                warn('loadAndRender: WatchplannerAPI.load not available');
                buildRootContent();
                renderSchedule();
                return Promise.resolve(true);
            }
            const res = await window.WatchplannerAPI.load();
            if (res && res.ok && res.data) {
                if (res.data.schedule) window.STATE.schedule = res.data.schedule;
                else window.STATE.schedule = res.data;
            } else {
                log('loadAndRender: load returned not-ok', res);
            }
        } catch (e) { warn('loadAndRender failed', e); }
        try { buildRootContent(); } catch (e) { /* ignore */ }
        try { renderSchedule(); } catch (e) { /* ignore */ }
        return Promise.resolve(true);
    }

    // mount returns a promise that resolves when UI is rendered (or false on failure)
    function mount(root) {
        try {
            const target = root || document.getElementById('watchplanner-root');
            if (!target) return Promise.resolve(false);
            // build shell immediately
            buildRootContent();
            // If we already have schedule data, render synchronously and resolve
            if (window.STATE && window.STATE.schedule && Object.keys(window.STATE.schedule).length) {
                try { renderSchedule(); } catch (e) { warn('mount renderSchedule failed', e); }
                return Promise.resolve(true);
            }
            // Otherwise return the loadAndRender promise so callers can await readiness
            return loadAndRender().then(() => true).catch(() => false);
        } catch (e) { console.warn('WatchplannerUI.mount failed', e); return Promise.resolve(false); }
    }

    // ---------- Init (idempotent) ----------
    let __wp_initialized = false;
    function init() {
        if (__wp_initialized) return;
        __wp_initialized = true;
        try {
            buildRootContent();
            loadAndRender();
        } catch (e) { warn('WatchplannerUI.init failed', e); }
    }

    try {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            setTimeout(init, 50);
        }
    } catch (e) { /* ignore */ }

    // ---------- Export public API ----------
    window.WatchplannerUI = {
        assignItemToDay,
        saveSchedule,
        loadAndRender,
        renderSchedule,
        buildRootContent,
        mount
    };

    log('client-ui.js initialized');
})();

// Initialize from storage and apply once (safe short delay)
loadDayDelayMinutes();
// mark today and center after the short delay; use wrapper to ensure centering runs after .today is applied
setTimeout(() => { try { markTodayWithDelayAndCenter(); } catch (e) { /* ignore */ } }, 40);