// ui-renderer.js
(function () {
    'use strict';

    const { el, debounce, log, warn } = window.WPUtils || {};
    if (!el) console.warn('[WatchPlanner] ui-renderer: WPUtils.el missing');

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
        const wrapper = (typeof el === 'function') ? el('div', { class: 'wp-item', dataset: { id: item && item.id ? item.id : '' } }, img, name) : (() => { const w = document.createElement('div'); w.className = 'wp-item'; w.dataset.id = item && item.id ? item.id : ''; w.appendChild(img); w.appendChild(name); return w; })();

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
