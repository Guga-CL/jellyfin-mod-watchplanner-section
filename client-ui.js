// client-ui.js - Watchplanner UI with modal live search and per-day selection
// Requires: js-injector.js created #watchplanner-root and client-api.js exposed as window.WatchplannerAPI
(function () {
    'use strict';

    const LOG = (...a) => { try { console.log('Watchplanner-UI:', ...a); } catch (e) { } };
    const WARN = (...a) => { try { console.warn('Watchplanner-UI:', ...a); } catch (e) { } };

    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // --- Helpers ---
    function getRoot() { return document.getElementById('watchplanner-root'); }
    function getModContainer() { return document.getElementById('watchplanner-mod') || document.querySelector('.sections.homeSectionsContainer'); }
    function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function debounce(fn, wait = 250) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    // --- UI render ---
    function renderUI() {
        const root = getRoot();
        if (!root) return null;
        if (root.dataset.wpUiRendered === '1') return root;

        root.innerHTML = `
      <div class="wp-ui" style="font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial; padding:8px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="wp-save" type="button" style="padding:6px 10px; border-radius:6px; background:#0b5fff; color:#fff; border:none; cursor:pointer;">Save selection to Watchplanner</button>
          <span id="wp-status" aria-live="polite" style="font-size:0.95em; color:#666;"></span>
        </div>
        <div id="wp-summary" style="margin-top:8px; font-size:0.95em; color:#444;"></div>
      </div>
    `;

        root.dataset.wpUiRendered = '1';
        bindUiHandlers(root);
        return root;
    }

    function setStatus(root, text, isError) {
        const s = root.querySelector('#wp-status');
        if (!s) return;
        s.textContent = text;
        s.style.color = isError ? '#b00' : '#080';
    }

    function updateSummary(root, schedule) {
        const summary = root.querySelector('#wp-summary');
        if (!summary) return;
        if (!schedule || typeof schedule !== 'object') {
            summary.textContent = 'No schedule loaded.';
            return;
        }
        const parts = DAYS.map(d => {
            const arr = schedule[d] || [];
            return `${d}: ${arr.length}`;
        });
        summary.textContent = parts.join(' · ');
    }

    // --- Selection parsing and schedule building ---
    function parseSelectedItems() {
        const mod = getModContainer() || document;
        let items = Array.from(mod.querySelectorAll('.wp-item.selected'));
        if (items.length === 0) items = Array.from(mod.querySelectorAll('.wp-item'));
        if (items.length === 0) {
            items = Array.from(mod.querySelectorAll('.item.selected'));
            if (items.length === 0) items = Array.from(mod.querySelectorAll('.item'));
        }

        return items.map(el => {
            const id = el.dataset.itemId || el.getAttribute('data-id') || (el.querySelector('a') && el.querySelector('a').href.split('/').pop()) || '';
            const name = (el.querySelector('.wp-name') && el.querySelector('.wp-name').textContent.trim()) ||
                (el.querySelector('.name') && el.querySelector('.name').textContent.trim()) ||
                (el.querySelector('a') && el.querySelector('a').textContent.trim()) || '';
            const imgEl = el.querySelector('img') || el.querySelector('.thumb img');
            const img = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
            const day = el.dataset.day || el.closest('[data-day]')?.dataset.day || null;
            return { id, name, img, day };
        });
    }

    function buildScheduleFromItems(items) {
        const schedule = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
        items.forEach(it => {
            const dayKey = (it.day && DAYS.includes(it.day)) ? it.day : 'Mon';
            schedule[dayKey].push({ id: it.id || '', name: it.name || '', img: it.img || '' });
        });
        return schedule;
    }

    // --- Save flow used by Save button (keeps backward compatibility) ---
    async function handleSave(root) {
        setStatus(root, 'Saving...', false);
        try {
            const items = parseSelectedItems();
            if (!items || items.length === 0) {
                setStatus(root, 'No selection found', true);
                return;
            }
            const schedule = buildScheduleFromItems(items);

            if (!window.WatchplannerAPI || typeof window.WatchplannerAPI.save !== 'function') {
                setStatus(root, 'API not available', true);
                WARN('WatchplannerAPI.save not found');
                return;
            }

            const res = await window.WatchplannerAPI.save(schedule, { makeBackup: true });
            if (res && res.ok) {
                setStatus(root, 'Saved ✓', false);
                LOG('save success', res);
                updateSummary(root, schedule);
            } else {
                const msg = res && (res.text || res.statusText || res.reason) ? (res.text || res.statusText || res.reason) : 'Save failed';
                setStatus(root, `Failed: ${msg}`, true);
                WARN('save failed', res);
            }
        } catch (e) {
            setStatus(root, 'Network error', true);
            WARN('save exception', e);
        }
    }

    // --- Load existing schedule and show summary ---
    async function loadAndShow(root) {
        if (!window.WatchplannerAPI || typeof window.WatchplannerAPI.load !== 'function') {
            setStatus(root, 'API not available', true);
            return;
        }
        setStatus(root, 'Loading...', false);
        try {
            const res = await window.WatchplannerAPI.load();
            if (res && res.ok) {
                const schedule = res.data || {};
                updateSummary(root, schedule);
                setStatus(root, 'Loaded', false);
                LOG('loaded schedule', schedule);
                // render per-day UI if day containers exist
                renderDaysFromSchedule(schedule);
            } else {
                setStatus(root, 'No config found', false);
                LOG('load returned', res);
            }
        } catch (e) {
            setStatus(root, 'Load error', true);
            WARN('load exception', e);
        }
    }

    // Render saved series into day containers if present
    function renderDaysFromSchedule(schedule) {
        if (!schedule || typeof schedule !== 'object') return;
        DAYS.forEach(day => {
            const dayContainer = document.querySelector(`.watchplanner-day[data-day="${day}"]`);
            if (!dayContainer) return;
            const arr = schedule[day] || [];
            if (!arr.length) {
                dayContainer.innerHTML = '';
                return;
            }
            const it = arr[0];
            dayContainer.innerHTML = `
        <div class="wp-day-thumb" style="text-align:center;">
          <img src="${escapeHtml(it.img)}" style="width:160px;height:240px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'"/>
        </div>
        <div class="wp-name" style="text-align:center;margin-top:6px;font-weight:600;">${escapeHtml(it.name)}</div>
      `;
        });
    }

    // --- Modal search and selection flow ---
    function openSearchModal(day) {
        if (!day) return;
        let modal = document.getElementById('wp-search-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'wp-search-modal';
            modal.style = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;background:#fff;padding:12px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.3);max-width:720px;width:90%;';
            modal.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="wp-search-input" placeholder="Search series..." style="flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;" />
          <button id="wp-search-close" style="padding:6px 10px;border-radius:6px;">Close</button>
        </div>
        <div id="wp-search-results" style="margin-top:8px;max-height:360px;overflow:auto;"></div>
      `;
            document.body.appendChild(modal);
            modal.querySelector('#wp-search-close').addEventListener('click', () => modal.remove());
        }

        modal.dataset.targetDay = day;
        modal.querySelector('#wp-search-input').value = '';
        modal.querySelector('#wp-search-results').innerHTML = '';
        modal.querySelector('#wp-search-input').focus();

        const input = modal.querySelector('#wp-search-input');
        const resultsEl = modal.querySelector('#wp-search-results');

        const doSearch = debounce(async (term) => {
            if (!term || term.trim().length < 2) {
                resultsEl.innerHTML = '<div style="color:#666">Type at least 2 characters</div>';
                return;
            }
            resultsEl.innerHTML = '<div style="color:#666">Searching…</div>';
            try {
                const q = encodeURIComponent(term);
                const url = `/Items?SearchTerm=${q}&IncludeItemTypes=Series&Limit=20&Recursive=true`;
                const resp = await fetch(url, { credentials: 'same-origin' });
                const text = await resp.text();
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
                const items = (json && json.Items) ? json.Items : [];
                if (!items.length) {
                    resultsEl.innerHTML = '<div style="color:#666">No results</div>';
                    return;
                }
                resultsEl.innerHTML = items.map(it => {
                    const thumb = it.PrimaryImageTag ? `/Items/${it.Id}/Images/Primary?maxWidth=160` : '';
                    const title = escapeHtml(it.Name || it.SeriesName || it.OriginalTitle || 'Unknown');
                    return `<div class="wp-search-item" data-id="${it.Id}" style="display:flex;gap:8px;padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
            <img src="${thumb}" style="width:64px;height:90px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'"/>
            <div style="flex:1">
              <div style="font-weight:600">${title}</div>
              <div style="font-size:0.9em;color:#666">${it.ProductionYear || ''}</div>
            </div>
          </div>`;
                }).join('');
                Array.from(resultsEl.querySelectorAll('.wp-search-item')).forEach(el => {
                    el.addEventListener('click', () => {
                        const id = el.dataset.id;
                        const item = items.find(x => x.Id === id);
                        if (item) selectSeriesForDay(item, modal.dataset.targetDay);
                        modal.remove();
                    });
                });
            } catch (e) {
                resultsEl.innerHTML = '<div style="color:#b00">Search error</div>';
                console.warn('search error', e);
            }
        }, 300);

        input.oninput = (e) => doSearch(e.target.value);
    }

    async function selectSeriesForDay(item, day) {
        if (!item || !day) return;
        const img = item.PrimaryImageTag ? `/Items/${item.Id}/Images/Primary?maxWidth=400` : '';
        const seriesObj = { id: item.Id, name: item.Name || item.SeriesName || '', img };

        const dayContainer = document.querySelector(`.watchplanner-day[data-day="${day}"]`);
        if (dayContainer) {
            dayContainer.innerHTML = `
        <div class="wp-day-thumb" style="text-align:center;">
          <img src="${escapeHtml(seriesObj.img)}" style="width:160px;height:240px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'"/>
        </div>
        <div class="wp-name" style="text-align:center;margin-top:6px;font-weight:600;">${escapeHtml(seriesObj.name)}</div>
      `;
        }

        const api = window.WatchplannerAPI;
        if (!api) {
            console.warn('WatchplannerAPI missing');
            return;
        }
        const loaded = await api.load();
        let schedule = (loaded && loaded.ok && loaded.data) ? loaded.data : { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
        schedule[day] = [{ id: seriesObj.id, name: seriesObj.name, img: seriesObj.img }];

        const res = await api.save(schedule, { makeBackup: true });
        if (res && res.ok) {
            LOG('Saved watchplanner for', day);
            const root = getRoot();
            if (root) updateSummary(root, schedule);
        } else {
            WARN('Save failed', res);
        }
    }

    // --- UI bindings ---
    function bindUiHandlers(root) {
        const btn = root.querySelector('#wp-save');
        if (btn) btn.addEventListener('click', () => handleSave(root));

        document.addEventListener('click', (e) => {
            const item = e.target.closest('.wp-item');
            if (!item) return;
            const mod = getModContainer();
            if (mod && !mod.contains(item)) return;
            item.classList.toggle('selected');
            const parsed = parseSelectedItems();
            updateSummary(root, buildScheduleFromItems(parsed));
        }, true);

        // Wire header cells to open modal if they exist
        Array.from(document.querySelectorAll('.watchplanner-header-cell')).forEach(el => {
            el.addEventListener('click', () => {
                const day = el.dataset.day;
                if (day) openSearchModal(day);
            });
        });
    }

    // --- Init and watchers ---
    function initWhenReady() {
        const root = getRoot();
        if (!root) return false;
        renderUI();
        const r = getRoot();
        loadAndShow(r);
        return true;
    }

    function start() {
        if (initWhenReady()) return;

        const docObs = new MutationObserver((mutations, obs) => {
            if (initWhenReady()) obs.disconnect();
        });
        docObs.observe(document.documentElement || document.body, { childList: true, subtree: true });

        let tries = 0;
        const maxTries = 20;
        const interval = setInterval(() => {
            tries++;
            if (initWhenReady() || tries >= maxTries) {
                clearInterval(interval);
                try { docObs.disconnect(); } catch (e) { }
                if (tries >= maxTries) LOG('stopped retrying UI init after attempts');
            }
        }, 400);
    }

    window.WatchplannerUI = { parseSelectedItems, buildScheduleFromItems, handleSave, loadAndShow, openSearchModal };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

})();
