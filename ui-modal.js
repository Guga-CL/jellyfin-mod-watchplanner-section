// ui-modal.js - modal UI for Watchplanner
// Minimal inline styles to guarantee visibility; modal layout delegated to CSS classes.

(function () {
    'use strict';

    const __wp_autosave = { timer: null, delay: 600 };
    function scheduleAutosave() {
        return new Promise((resolve) => {
            try {
                if (__wp_autosave.timer) clearTimeout(__wp_autosave.timer);
                __wp_autosave.timer = setTimeout(async () => {
                    __wp_autosave.timer = null;
                    let result = null;
                    try {
                        if (window.WatchplannerUI && typeof window.WatchplannerUI.saveSchedule === 'function') {
                            result = await window.WatchplannerUI.saveSchedule();
                            console.log('debounced autosave result', result);
                        } else if (window.WatchplannerAPI && typeof window.WatchplannerAPI.save === 'function') {
                            const schedule = (window.STATE && window.STATE.schedule) ? window.STATE.schedule : null;
                            if (schedule) {
                                result = await window.WatchplannerAPI.save(schedule, { makeBackup: true });
                                console.log('debounced API.save result', result);
                            }
                        }
                    } catch (e) {
                        console.warn('debounced autosave error', e);
                    }
                    resolve(result);
                }, __wp_autosave.delay);
            } catch (e) {
                console.warn('scheduleAutosave failed', e);
                resolve(null);
            }
        });
    }

    window.scheduleAutosave = scheduleAutosave;

    const { el, debounce, log, warn } = window.WPUtils || {};
    if (!el) console.warn('ui-modal: WPUtils.el missing');

    let modalOverlay = null;
    let currentDay = null;
    let currentExisting = null;

    function buildImageUrl(path) {
        try {
            if (window.WPRenderer && typeof window.WPRenderer.buildImageUrl === 'function') {
                return window.WPRenderer.buildImageUrl(path || '');
            }
        } catch (e) { }
        return (window.location.origin || '') + (path || '');
    }

    function closeModal() {
        if (!modalOverlay) return;
        try { modalOverlay.remove(); } catch (e) { }
        modalOverlay = null;
        currentDay = null;
        currentExisting = null;
    }

    function selectAndAssign(item) {
        if (!item || !currentDay) return;
        if (window.WatchplannerUI && typeof window.WatchplannerUI.assignItemToDay === 'function') {
            try { window.WatchplannerUI.assignItemToDay(currentDay, item); } catch (e) { console.warn('assignItemToDay failed', e); }
        } else {
            console.warn('assignItemToDay not implemented');
        }
        try {
            scheduleAutosave().then(r => {
                console.log('Watchplanner autosave completed', r);
            }).catch(e => console.warn('Watchplanner autosave error', e));
        } catch (e) {
            console.warn('autosave attempt failed', e);
        }
        closeModal();
    }

    function renderResultRow(it) {
        const thumb = buildImageUrl(it.img || (`/Items/${it.Id}/Images/Primary?maxHeight=200&quality=90`));
        const r = el ? el('div', { class: 'wp-result' },
            el('img', { src: thumb, alt: it.Name || it.name || '' }),
            el('div', {}, el('div', {}, it.Name || it.name || ''), el('div', { style: { fontSize: '0.85rem', color: 'var(--secondaryText)' } }, it.ProductionYear || ''))
        ) : (() => {
            const row = document.createElement('div'); row.className = 'wp-result';
            const img = document.createElement('img'); img.src = thumb; img.alt = it.Name || it.name || '';
            const info = document.createElement('div');
            const title = document.createElement('div'); title.textContent = it.Name || it.name || '';
            const meta = document.createElement('div'); meta.style.fontSize = '0.85rem'; meta.style.color = 'var(--secondaryText)'; meta.textContent = it.ProductionYear || '';
            info.appendChild(title); info.appendChild(meta);
            row.appendChild(img); row.appendChild(info);
            return row;
        })();

        try { r.dataset.id = it.Id || it.id || ''; } catch (e) { /* ignore */ }

        r.addEventListener('click', () => {
            const item = { id: it.Id || it.id || '', name: it.Name || it.name || '', img: it.Img || it.img || `/Items/${it.Id || it.id}/Images/Primary?maxHeight=300&quality=90` };
            selectAndAssign(item);
        });
        return r;
    }

    async function doSearch(term, resultsEl) {
        resultsEl.innerHTML = '';
        if (!term || term.trim().length < 2) {
            resultsEl.innerHTML = '<div style="color:var(--secondaryText)">Type at least 2 characters</div>';
            return;
        }

        try {
            const q = encodeURIComponent(term);
            const itemsUrl = `Items?SearchTerm=${q}&IncludeItemTypes=Series&Limit=20&Recursive=true`;

            try {
                if (window.ApiClient && typeof window.ApiClient.fetch === 'function') {
                    const text = await window.ApiClient.fetch({
                        url: window.ApiClient.getUrl ? window.ApiClient.getUrl(itemsUrl) : itemsUrl,
                        type: 'GET',
                        dataType: 'text'
                    });
                    let json = null;
                    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
                    const items = (json && json.Items) ? json.Items : (Array.isArray(json) ? json : []);
                    if (items && items.length) {
                        items.forEach(it => resultsEl.appendChild(renderResultRow(it)));
                        return;
                    }
                } else {
                    const url = `/${itemsUrl}`.replace(/\/{2,}/, '/');
                    const resp = await fetch(url, { method: 'GET', credentials: 'same-origin' });
                    if (resp.ok) {
                        let json = null;
                        try { json = await resp.json().catch(() => null); } catch (e) { json = null; }
                        const items = (json && json.Items) ? json.Items : (Array.isArray(json) ? json : []);
                        if (items && items.length) {
                            items.forEach(it => resultsEl.appendChild(renderResultRow(it)));
                            return;
                        }
                    }
                }
            } catch (e) { /* ignore and fallback */ }
        } catch (e) { /* ignore */ }

        try {
            if (window.WatchplannerAPI && typeof window.WatchplannerAPI.listFiles === 'function') {
                const listRes = await window.WatchplannerAPI.listFiles();
                if (listRes && listRes.ok && Array.isArray(listRes.files)) {
                    const matches = listRes.files.filter(f => (f.Name || '').toLowerCase().includes(term.toLowerCase()));
                    if (!matches.length) {
                        resultsEl.innerHTML = '<div style="color:var(--secondaryText)">No results</div>';
                        return;
                    }
                    matches.forEach(m => {
                        const mapped = { id: m.Name || '', name: m.Name || '', img: m.ThumbnailPath || m.Path || '' };
                        resultsEl.appendChild(renderResultRow(mapped));
                    });
                    return;
                }
            }
        } catch (e) { /* ignore */ }

        resultsEl.innerHTML = '<div style="color:var(--secondaryText)">No results</div>';
    }

    function openModal(dayKey, existingItem) {
        closeModal();
        currentDay = dayKey;
        currentExisting = existingItem || null;

        modalOverlay = el ? el('div', { class: 'wp-modal-overlay' }) : (() => { const o = document.createElement('div'); o.className = 'wp-modal-overlay'; return o; })();
        const modal = el ? el('div', { class: 'wp-modal' }) : (() => { const m = document.createElement('div'); m.className = 'wp-modal'; return m; })();

        // Minimal inline overlay styles to ensure visibility and stacking
        try {
            modalOverlay.style.position = 'fixed';
            modalOverlay.style.inset = '0';
            modalOverlay.style.display = 'flex';
            modalOverlay.style.alignItems = 'center';
            modalOverlay.style.justifyContent = 'center';
            modalOverlay.style.zIndex = '99999';
            modalOverlay.style.background = 'rgba(0,0,0,0.35)';
            modalOverlay.style.pointerEvents = 'auto';
        } catch (e) { /* ignore */ }

        // Let CSS classes control modal layout; only ensure it's above overlay
        try {
            modal.style.zIndex = '100000';
            modal.style.boxSizing = 'border-box';
        } catch (e) { /* ignore */ }

        const header = el ? el('div', { class: 'wp-modal-header' }, el('div', {}, `Select item for ${dayKey}`), el('button', { class: 'wp-close', onclick: closeModal }, '✕')) : (() => {
            const h = document.createElement('div'); h.className = 'wp-modal-header';
            const t = document.createElement('div'); t.textContent = `Select item for ${dayKey}`;
            const b = document.createElement('button'); b.className = 'wp-close'; b.textContent = '✕'; b.onclick = closeModal;
            h.appendChild(t); h.appendChild(b); return h;
        })();

        const body = el ? el('div', { class: 'wp-modal-body' }) : (() => { const b = document.createElement('div'); b.className = 'wp-modal-body'; return b; })();
        const searchInput = el ? el('input', { class: 'wp-search-input', placeholder: 'Search series...' }) : (() => { const i = document.createElement('input'); i.className = 'wp-search-input'; i.placeholder = 'Search series...'; return i; })();
        const results = el ? el('div', { class: 'wp-results' }) : (() => { const r = document.createElement('div'); r.className = 'wp-results'; return r; })();

        if (existingItem && (existingItem.name || existingItem.id)) {
            const cur = el ? el('div', { class: 'wp-result' }, el('img', { src: buildImageUrl(existingItem.img || ''), alt: existingItem.name || '' }), el('div', {}, el('div', {}, existingItem.name || ''), el('div', { style: { fontSize: '0.85rem', color: 'var(--secondaryText)' } }, 'Current'))) : null;
            if (cur) {
                cur.addEventListener('click', () => selectAndAssign(existingItem));
                results.appendChild(cur);
            }
        }

        body.appendChild(searchInput);
        body.appendChild(results);
        modal.appendChild(header);
        modal.appendChild(body);
        modalOverlay.appendChild(modal);

        try {
            document.body.appendChild(modalOverlay);
        } catch (e) {
            try { document.documentElement.appendChild(modalOverlay); } catch (e2) { console.warn('ui-modal: failed to append overlay to body', e2); }
        }

        setTimeout(() => { try { searchInput.focus(); } catch (e) { } }, 40);

        const deb = debounce ? debounce((v) => doSearch(v, results), 300) : ((v) => { doSearch(v, results); });
        searchInput.addEventListener('input', (e) => deb(e.target.value));

        if (existingItem && existingItem.name) {
            doSearch(existingItem.name, results);
            searchInput.value = existingItem.name;
        } else {
            searchInput.focus();
        }
    }

    window.WPModal = window.WPModal || {};
    Object.assign(window.WPModal, { openModal, closeModal });

    log('ui-modal.js initialized');
})();
