// ui-renderer.js
(function () {
    'use strict';

    const { el, debounce, log: utilLog, warn: utilWarn } = window.WPUtils || {};
    if (!el) console.warn('[WatchPlanner] ui-renderer: WPUtils.el missing');

    // Fallback logging if WPUtils not available
    const log = utilLog || ((msg) => { try { if (window.__watchplanner_debug) console.log('[WatchPlanner] ui-renderer:', msg); } catch (e) { } });
    const warn = utilWarn || ((msg) => { try { console.warn('[WatchPlanner] ui-renderer:', msg); } catch (e) { } });

    function buildImageUrl(path) {
        try {
            if (window.WatchplannerAPI && typeof window.WatchplannerAPI.buildImageUrl === 'function') {
                return window.WatchplannerAPI.buildImageUrl(path || '');
            }
        } catch (e) { }
        if (!path) return '';
        return (window.location.origin || '') + path;
    }

    function createItemElement(item, dayKey, onClick) {
        const imgUrl = buildImageUrl(item && item.img ? item.img : '');
        // create elements; always set name via textContent to avoid el() race
        const img = (typeof el === 'function') ? el('img', { src: '', alt: item && item.name ? item.name : '', class: 'wp-thumb' }) : (() => { const i = document.createElement('img'); i.src = ''; i.alt = item && item.name ? item.name : ''; i.className = 'wp-thumb'; return i; })();
        const name = (typeof el === 'function') ? el('div', { class: 'wp-name' }, '') : (() => { const d = document.createElement('div'); d.className = 'wp-name'; return d; })();
        // ensure name text is explicitly set (avoid empty nodes when el is flaky)
        try { name.textContent = item && item.name ? item.name : ''; } catch (e) { try { name.innerText = item && item.name ? item.name : ''; } catch (e2) { /* ignore */ } }
        const wrapper = (typeof el === 'function') ? el('div', { class: 'wp-item', dataset: { id: item && item.id ? item.id : '', seriesId: item && item.seriesId ? item.seriesId : '' } }, img, name) : (() => { const w = document.createElement('div'); w.className = 'wp-item'; w.dataset.id = item && item.id ? item.id : ''; w.dataset.seriesId = item && item.seriesId ? item.seriesId : ''; w.appendChild(img); w.appendChild(name); return w; })();

        // set src after insertion to reduce race conditions on some mobile clients
        setTimeout(() => {
            try { img.src = imgUrl || ''; } catch (e) { /* ignore */ }
        }, 20);

        // graceful fallback if image fails to load
        try {
            img.onerror = function () {
                try { img.classList.add('wp-thumb-error'); } catch (e) { /* ignore */ }
            };
        } catch (e) { /* ignore */ }

        // Handle image click to play next unwatched episode
        try {
            img.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                try {
                    const seriesId = wrapper.dataset.seriesId || item.seriesId;
                    console.log('[WatchPlanner] Image clicked, seriesId:', seriesId);

                    if (!seriesId) {
                        console.warn('[WatchPlanner] No seriesId available for playback', { item });
                        return;
                    }

                    // Check if API is available
                    if (!window.WatchplannerAPI) {
                        console.warn('[WatchPlanner] WatchplannerAPI not available');
                        return;
                    }

                    // Add loading state
                    try { img.style.opacity = '0.6'; } catch (e) { /* ignore */ }

                    console.log('[WatchPlanner] Fetching next episode for seriesId:', seriesId);

                    // Fetch next episode
                    const nextRes = await window.WatchplannerAPI.getNextEpisode(seriesId);
                    console.log('[WatchPlanner] getNextEpisode response:', nextRes);

                    if (!nextRes.ok) {
                        console.log('[WatchPlanner] getNextEpisode failed, trying fallback', nextRes);
                        const fallbackRes = await window.WatchplannerAPI.getNextEpisodeFallback(seriesId);
                        console.log('[WatchPlanner] getNextEpisodeFallback response:', fallbackRes);

                        if (!fallbackRes.ok) {
                            console.warn('[WatchPlanner] Failed to fetch next episode', fallbackRes);
                            try { img.style.opacity = '1'; } catch (e) { /* ignore */ }
                            return;
                        }
                        // Proceed with fallback episode
                        console.log('[WatchPlanner] Starting playback with fallback episode:', fallbackRes.episode);
                        const playRes = await window.WatchplannerAPI.startPlayback(fallbackRes.episode.id);
                        console.log('[WatchPlanner] startPlayback response:', playRes);

                        if (playRes.ok) {
                            console.log('[WatchPlanner] Started playback (fallback)', fallbackRes.episode);
                        } else {
                            console.warn('[WatchPlanner] Failed to start playback', playRes);
                        }
                        try { img.style.opacity = '1'; } catch (e) { /* ignore */ }
                        return;
                    }

                    // Start playback
                    console.log('[WatchPlanner] Starting playback with episode:', nextRes.episode);
                    const playRes = await window.WatchplannerAPI.startPlayback(nextRes.episode.id);
                    console.log('[WatchPlanner] startPlayback response:', playRes);

                    if (playRes.ok) {
                        console.log('[WatchPlanner] Started playback', nextRes.episode);
                    } else {
                        console.warn('[WatchPlanner] Failed to start playback', playRes);
                    }

                    try { img.style.opacity = '1'; } catch (e) { /* ignore */ }
                } catch (e) {
                    console.warn('[WatchPlanner] Image click handler error', e);
                    try { img.style.opacity = '1'; } catch (e2) { /* ignore */ }
                }
            });
        } catch (e) { /* ignore */ }

        if (typeof onClick === 'function') {
            wrapper.addEventListener('click', () => onClick(dayKey, item));
        }

        // debug: warn if item lacks name or img (helps track mobile-only failures)
        try {
            if (window.__watchplanner_debug && (!item || (!item.name && !item.img))) {
                console.warn('[WatchPlanner] createItemElement: missing fields', { dayKey, item });
            }
        } catch (e) { /* ignore */ }

        return wrapper;
    }

    function renderDayColumn(container, dayKey, items = [], onItemClick) {
        if (!container) return;
        const list = container.querySelector('.wp-day-list');
        if (!list) return;
        list.innerHTML = '';

        const first = Array.isArray(items) && items.length ? items[0] : null;
        if (!first) {
            const placeholder = el ? el('div', { class: 'wp-item' }, el('div', { class: 'wp-name' }, '—')) : (() => { const p = document.createElement('div'); p.className = 'wp-item'; const n = document.createElement('div'); n.className = 'wp-name'; n.textContent = '—'; p.appendChild(n); return p; })();
            list.appendChild(placeholder);
            return;
        }
        const itemEl = createItemElement(first, dayKey, onItemClick);
        // defensive: ensure name node has text (covers rare el() failures)
        try {
            const nameNode = itemEl.querySelector && itemEl.querySelector('.wp-name');
            if (nameNode && (!nameNode.textContent || nameNode.textContent.trim() === '')) {
                nameNode.textContent = first && first.name ? first.name : '';
            }
        } catch (e) { /* ignore */ }
        list.appendChild(itemEl);
    }

    function renderGrid(parent, schedule = {}, onItemClick) {
        if (!parent) return;
        parent.innerHTML = '';
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        days.forEach(d => {
            const header = el ? el('div', { class: 'watchplanner-header-cell' }, d) : (() => { const h = document.createElement('div'); h.className = 'watchplanner-header-cell'; h.textContent = d; return h; })();

            header.addEventListener('click', () => {
                try {
                    if (typeof onItemClick === 'function') {
                        onItemClick(d, (schedule && schedule[d] && schedule[d][0]) || null);
                        return;
                    }
                    if (window.WPModal && typeof window.WPModal.openModal === 'function') {
                        window.WPModal.openModal(d, (schedule && schedule[d] && schedule[d][0]) || null);
                    }
                } catch (e) { console.warn('[WatchPlanner] open modal error', e); }
            });

            header.dataset.day = d;
            const list = el ? el('div', { class: 'wp-day-list' }) : (() => { const l = document.createElement('div'); l.className = 'wp-day-list'; return l; })();
            const col = el ? el('div', { class: 'wp-day', dataset: { day: d } }, header, list) : (() => { const c = document.createElement('div'); c.className = 'wp-day'; c.dataset.day = d; c.appendChild(header); c.appendChild(list); return c; })();
            parent.appendChild(col);
            const items = schedule && schedule[d] ? schedule[d] : [];
            renderDayColumn(col, d, items, onItemClick);
        });
    }

    function updateDayInDom(root, dayKey, items, onItemClick) {
        if (!root) return;
        const col = root.querySelector(`.wp-day[data-day="${dayKey}"]`);
        if (!col) return;
        renderDayColumn(col, dayKey, items, onItemClick);
    }

    window.WPRenderer = window.WPRenderer || {};
    Object.assign(window.WPRenderer, {
        buildImageUrl,
        createItemElement,
        renderDayColumn,
        renderGrid,
        updateDayInDom
    });

    console.log('[WatchPlanner] ui-renderer.js initialized');
})();
