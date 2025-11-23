// watchplanner-client.js — patched to fix duplicate bootstrap, consistent mod path, robust save fallback
// WATCHPLANNER_MOD_BASE must match your /web/mods mapping
const WATCHPLANNER_MOD_BASE = '/web/mods/jellyfin-mod-watchplanner-section';
const LOCAL_SAVE_KEY = 'watchplanner.local';

(function () {
  console.log("watchplanner-injected");

  // --- Utilities ---
  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
  const WP_DEBUG = true;
  function debug(...args){ if (WP_DEBUG && console && console.debug) console.debug('[watchplanner]', ...args); }

  // --- DOM builder ---
  function buildRoot() {
    const root = document.createElement('div');
    root.id = 'watchplanner-root';
    root.className = 'watchplanner';

    root.innerHTML = `
<div class="wp-header">
  <span class="wp-title">Watch Planner</span>
  <button class="wp-config-btn" style="display:none">Config</button>
</div>
<div class="wp-days">
  ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `
    <div class="wp-day">
      <div class="watchplanner-header-cell">${d}</div>
      <div class="wp-day-list" data-day="${d}"></div>
    </div>`).join('')}
</div>
<div class="wp-modal-overlay" style="display:none">
  <div class="wp-modal">
    <div class="wp-modal-header">
      <span>Search series</span>
      <button class="wp-close">×</button>
    </div>
    <div class="wp-modal-body">
      <input class="wp-search-input" type="text" placeholder="Type series name..." />
      <div class="wp-results"></div>
    </div>
  </div>
</div>
`;
    return root;
  }

  function injectStyles() {
    // Injector already loads your CSS; keep fallback CSS to avoid broken layout
    const css = `
#watchplanner-root { margin: 12px 0; padding: 10px; background: var(--theme-background); border-radius: 8px; }
.wp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.wp-title { font-weight:600; }
.wp-days { display:grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.wp-day { background: var(--theme-background-alt); border-radius:6px; padding:6px; min-height: 100px; }
.watchplanner-header-cell { font-weight:600; margin-bottom:6px; cursor:pointer; user-select:none; }
.wp-day-list { display:flex; flex-direction:column; gap:6px; min-height: 80px; }
.wp-item { display:flex; align-items:center; gap:8px; }
.wp-item img { width:40px; height:60px; object-fit:cover; border-radius:4px; }
.wp-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9999; }
.wp-modal { width:480px; background:var(--theme-background); border-radius:8px; box-shadow:0 4px 22px rgba(0,0,0,0.35); }
.wp-modal-header { display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--theme-text-invert); }
.wp-modal-body { padding:10px; }
.wp-search-input { width:100%; padding:8px; border-radius:6px; border:1px solid var(--theme-text-invert); margin-bottom:8px; }
.wp-results { display:flex; flex-direction:column; gap:6px; max-height:300px; overflow:auto; }
.wp-result { display:flex; align-items:center; gap:10px; cursor:pointer; padding:6px; border-radius:6px; }
.wp-result:hover { background:var(--theme-background-alt); }
.wp-close { background:none; border:none; font-size:18px; cursor:pointer; }
`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderSchedule(root, schedule) {
    if (!root) return;
    root.querySelectorAll('.wp-day-list').forEach(list => {
      const day = list.dataset.day;
      const items = schedule?.serverWeekGrid?.[day] ? [schedule.serverWeekGrid[day]] : (schedule?.[day] || []);
      list.innerHTML = items.map(s => `
        <div class="wp-item" data-id="${s?.id || ''}">
          <img src="${s?.thumb || s?.img || ''}" alt="">
          <div class="wp-meta"><div class="wp-name">${s?.name || ''}</div></div>
        </div>`).join('');
    });
  }

  // --- API helpers ---
  function apiGetImageUrl(id){ 
    try {
      if (window.ApiClient && typeof window.ApiClient.getImageUrl === 'function') {
        return window.ApiClient.getImageUrl(id, { type: 'Primary', maxHeight: 120 });
      }
    } catch(e){}
    return '/web/images/placeholder.png';
  }

  async function searchSeries(term) {
    try {
      if (window.ApiClient) {
        const uid = window.ApiClient.getCurrentUserId();
        const p = { SearchTerm: term, IncludeItemTypes: 'Series', Limit: 12, Recursive: true };
        const res = await window.ApiClient.getItems(uid, p);
        const items = res?.Items || [];
        return items.map(it => ({ id: it.Id, name: it.Name, img: window.ApiClient.getImageUrl(it.Id, { type: 'Primary', maxHeight: 120 }) || '' }));
      } else {
        const r = await fetch(`/Items?SearchTerm=${encodeURIComponent(term)}&IncludeItemTypes=Series&Limit=12`, { credentials: 'include' });
        if (!r.ok) return [];
        const data = await r.json();
        const items = data?.Items || [];
        return items.map(it => ({ id: it.Id, name: it.Name, img: `/Items/${it.Id}/Images/Primary` }));
      }
    } catch(e){
      console.warn('watchplanner search error', e);
      return [];
    }
  }

  // --- CONFIG helpers (consistent + localStorage fallback) ---
  function loadLocalSave() {
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      console.log('watchplanner: loaded local saved config (localStorage)');
      return obj;
    } catch (e) {
      console.warn('watchplanner: localStorage parse error', e);
      return null;
    }
  }

  async function fetchServerConfigOnce() {
    try {
      const r = await fetch('/watchplanner/config', { cache: 'no-store', credentials: 'include' });
      if (r.ok) {
        console.log('watchplanner: fetched server config');
        return await r.json();
      }
      console.warn('watchplanner: server config not found (status ' + r.status + ')');
    } catch (e) {
      console.warn('watchplanner: server config fetch error', e);
    }
    return null;
  }

  async function fetchStaticConfig(modBasePath) {
    const url = (modBasePath || WATCHPLANNER_MOD_BASE) + '/watchplanner-config.json';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        console.log('watchplanner: loaded static config from', url);
        return await r.json();
      }
      console.warn('watchplanner: static config not found at', url, '(status ' + r.status + ')');
    } catch (e) {
      console.warn('watchplanner: static config fetch error', e);
    }
    return null;
  }

  async function loadConfigPreferEventOrFallback(modBasePath, providedConfig) {
    if (providedConfig) {
      console.log('watchplanner: using provided config from injector/event');
      return providedConfig;
    }
    const local = loadLocalSave();
    if (local) return local;
    const srv = await fetchServerConfigOnce();
    if (srv) return srv;
    const stat = await fetchStaticConfig(modBasePath);
    if (stat) return stat;
    console.log('watchplanner: using built-in default config');
    return { enabled: true, schedule: {} };
  }

  function saveLocal(payload) {
    try {
      localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(payload));
      console.log('watchplanner: saved config to localStorage');
      return true;
    } catch (e) {
      console.warn('watchplanner: localStorage save error', e);
      return false;
    }
  }

  async function saveConfig(payload) {
    // Try POST once, but never throw — always save to localStorage as fallback
    try {
      const r = await fetch('/watchplanner/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        console.log('watchplanner: saved config to server');
        saveLocal(payload);
        return { ok: true, backend: 'server' };
      }
      console.warn('watchplanner: server save failed (status ' + r.status + '), falling back to localStorage');
    } catch (e) {
      console.warn('watchplanner: server save error', e, 'falling back to localStorage');
    }
    saveLocal(payload);
    return { ok: false, backend: 'local' };
  }

  // --- modal / UI interactions ---
  function openModal(root){
    const overlay = root.querySelector('.wp-modal-overlay');
    overlay.style.display = 'flex';
    const input = root.querySelector('.wp-search-input');
    input.value = '';
    input.focus();
    root.querySelector('.wp-results').innerHTML = '';
  }
  function closeModal(root){
    const overlay = root.querySelector('.wp-modal-overlay');
    overlay.style.display = 'none';
  }

  function attachEventHandlers(root, schedule) {
    root.querySelectorAll('.watchplanner-header-cell').forEach(h => {
      h.addEventListener('click', (ev) => {
        const day = h.textContent.trim();
        const isAdmin = window.__watchplanner_is_admin || false;
        if (!isAdmin) return;
        root.__wp_currentDay = day;
        openModal(root);
      });
    });

    const closeBtn = root.querySelector('.wp-close');
    if (closeBtn) closeBtn.addEventListener('click', ()=> closeModal(root));

    const input = root.querySelector('.wp-search-input');
    if (!input) return;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const term = input.value.trim();
        const results = await searchSeries(term);
        const resultsEl = root.querySelector('.wp-results');
        resultsEl.innerHTML = results.map(r => `<div class="wp-result" data-id="${r.id}" data-name="${r.name}" data-img="${r.img}"><img src="${r.img}" alt=""><div>${r.name}</div></div>`).join('');
        resultsEl.querySelectorAll('.wp-result').forEach(rs => {
          rs.addEventListener('click', async () => {
            const id = rs.dataset.id;
            const name = rs.dataset.name;
            const img = rs.dataset.img;
            const day = root.__wp_currentDay;
            const list = root.querySelector(`.wp-day-list[data-day="${day}"]`);
            
            if (list) {
              // create a single item element and replace existing children (so the day holds exactly one series)
              const el = document.createElement('div');
              el.className = 'wp-item';
              el.dataset.id = id;
              el.innerHTML = `<img src="${img}" alt=""><div class="wp-meta"><div class="wp-name">${name}</div></div>`;

              // remove existing items and insert the new one
              list.innerHTML = '';
              list.appendChild(el);
            }

            closeModal(root);

            // build payload and save
            try {
              const out = { schedule: {} };
              root.querySelectorAll('.wp-day-list').forEach(l => {
                const d = l.dataset.day;
                out.schedule[d] = Array.from(l.children).map(ch => {
                  return {
                    id: ch.dataset.id || '',
                    name: ch.querySelector('.wp-name')?.textContent || '',
                    img: ch.querySelector('img')?.src || ''
                  };
                });
              });
              const res = await saveConfig(out);
              debug('save result', res);
            } catch(e){ console.warn('saveHandler error', e); }
          });
        });
      }
    });
  }

  // --- initialization / bootstrap ---
  async function startWithConfig(root, providedConfig) {
    if (!root) return;
    if (root.__watchplanner_started) return;
    root.__watchplanner_started = true;
    // mark global initialized so fallback won't re-run
    window.__watchplanner_initialized = true;
    debug('startWithConfig', !!root, !!providedConfig);

    injectStyles();

    const cfg = providedConfig || await loadConfigPreferEventOrFallback(WATCHPLANNER_MOD_BASE, null);
    const schedule = cfg.schedule || cfg.serverWeekGrid || {};
    renderSchedule(root, { schedule, serverWeekGrid: cfg.serverWeekGrid });

    try {
      if (window.ApiClient) {
        const uid = window.ApiClient.getCurrentUserId();
        const user = await window.ApiClient.getUser(uid);
        window.__watchplanner_is_admin = !!(user && user.Policy && user.Policy.IsAdministrator);
      } else {
        window.__watchplanner_is_admin = false;
      }
    } catch(e){ window.__watchplanner_is_admin = false; }

    attachEventHandlers(root, schedule);
  }

  // Listen to injector events
  window.addEventListener('watchplanner:config', async (ev) => {
    try {
      if (window.__watchplanner_initialized) return;
      const providedConfig = ev?.detail?.config || null;
      const root = ev?.detail?.root || document.getElementById('watchplanner-root');
      debug('received watchplanner:config event', !!root, !!providedConfig);
      if (!root) return;
      if (!root.querySelector('.wp-days')) {
        const built = buildRoot();
        root.innerHTML = built.innerHTML;
      }
      const cfg = await loadConfigPreferEventOrFallback(WATCHPLANNER_MOD_BASE, providedConfig);
      startWithConfig(root, cfg);
    } catch(e){ console.error('watchplanner:config handler error', e); }
  });

  window.addEventListener('watchplanner:ready', async (ev) => {
    try {
      if (window.__watchplanner_initialized) return;
      const root = ev?.detail?.root || document.getElementById('watchplanner-root');
      const providedConfig = ev?.detail?.config || null;
      debug('received watchplanner:ready', !!root);
      if (!root) return;
      if (!root.querySelector('.wp-days')) {
        const built = buildRoot();
        root.innerHTML = built.innerHTML;
      }
      const cfg = await loadConfigPreferEventOrFallback(WATCHPLANNER_MOD_BASE, providedConfig);
      startWithConfig(root, cfg);
    } catch(e){ console.error('watchplanner:ready handler error', e); }
  });

  // Fallback bootstrap (only if injector didn't run): guarded and uses WATCHPLANNER_MOD_BASE
  setTimeout(async () => {
    if (window.__watchplanner_initialized) return;
    const root = document.getElementById('watchplanner-root');
    if (!root) return;
    if (!root.querySelector('.wp-days')) {
      const built = buildRoot();
      root.innerHTML = built.innerHTML;
    }
    const cfg = await (async ()=>{
      const srv = await fetchServerConfigOnce(); if (srv) return srv;
      try {
        const r = await fetch(WATCHPLANNER_MOD_BASE + '/watchplanner-config.json', { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch(e){}
      return { schedule: {} };
    })();
    startWithConfig(root, cfg);
    window.__watchplanner_initialized = true;
  }, 800);

  // Re-run on SPA navigation
  window.addEventListener('hashchange', () => setTimeout(() => {
    try {
      const root = document.getElementById('watchplanner-root');
      if (root) startWithConfig(root);
    } catch(e){}
  }, 250));
})();
