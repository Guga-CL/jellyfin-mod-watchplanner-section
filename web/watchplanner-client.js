// watchplanner-client.js — adapted to work with the Injector
(function () {
  console.log("watchplanner-injected");

  // --- Utilities and API helpers (keep original behavior) ---
  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  // small debug helper
  const WP_DEBUG = true;
  function debug(...args){ if (WP_DEBUG && console && console.debug) console.debug('[watchplanner]', ...args); }

  // --- DOM builder (same structure you had) ---
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
    // Keep this short — your watchplanner-styles.css will normally be loaded by the injector
    // but keep local fallback styles for safety
    const css = `
#watchplanner-root { margin: 12px 0; padding: 10px; background: var(--theme-background); border-radius: 8px; }
.wp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.wp-title { font-weight:600; }
.wp-days { display:grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.wp-day { background: var(--theme-background-alt); border-radius:6px; padding:6px; }
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
      const items = schedule?.serverWeekGrid?.[day] ? [schedule.serverWeekGrid[day]] : (schedule?.schedule?.[day] || []);
      list.innerHTML = items.map(s => `
        <div class="wp-item" data-id="${s?.id || ''}">
          <img src="${s?.thumb || s?.img || ''}" alt="">
          <div class="wp-meta"><div class="wp-name">${s?.name || ''}</div></div>
        </div>`).join('');
    });
  }

  // --- API helpers (use ApiClient when available) ---
  function apiGetImageUrl(id){ // helper when ApiClient is present
    try {
      if (window.ApiClient && typeof window.ApiClient.getImageUrl === 'function') {
        return window.ApiClient.getImageUrl(id, { type: 'Primary', maxHeight: 120 });
      }
    } catch(e){}
    return '/web/images/placeholder.png';
  }

  async function searchSeries(term) {
    try {
      // Prefer ApiClient if available
      if (window.ApiClient) {
        const uid = window.ApiClient.getCurrentUserId();
        const p = { SearchTerm: term, IncludeItemTypes: 'Series', Limit: 12, Recursive: true };
        const res = await window.ApiClient.getItems(uid, p);
        const items = res?.Items || [];
        return items.map(it => ({ id: it.Id, name: it.Name, img: window.ApiClient.getImageUrl(it.Id, { type: 'Primary', maxHeight: 120 }) || '' }));
      } else {
        // fallback to server search endpoint (if any)
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

  async function getConfigFromServer(){
    try {
      const r = await fetch('/watchplanner/config', { credentials: 'include' });
      if (!r.ok) throw new Error('no config');
      return await r.json();
    } catch(e){ return null; }
  }

  async function saveConfigToServer(payload){
    try {
      const r = await fetch('/watchplanner/config', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('save failed');
      return true;
    } catch(e){ console.warn('saveConfig failed', e); return false; }
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

  function attachEventHandlers(root, schedule, saveHandler){
    // header cell clicks: open modal if admin
    root.querySelectorAll('.watchplanner-header-cell').forEach(h => {
      h.addEventListener('click', (ev) => {
        const day = h.textContent.trim();
        const isAdmin = window.__watchplanner_is_admin || false;
        if (!isAdmin) return;
        root.__wp_currentDay = day;
        openModal(root);
      });
    });

    root.querySelector('.wp-close').addEventListener('click', ()=> closeModal(root));

    const input = root.querySelector('.wp-search-input');
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const term = input.value.trim();
        const results = await searchSeries(term);
        const resultsEl = root.querySelector('.wp-results');
        resultsEl.innerHTML = results.map(r => `<div class="wp-result" data-id="${r.id}" data-name="${r.name}" data-img="${r.img}"><img src="${r.img}" alt=""><div>${r.name}</div></div>`).join('');
        // attach click listeners
        resultsEl.querySelectorAll('.wp-result').forEach(rs => {
          rs.addEventListener('click', async () => {
            const id = rs.dataset.id;
            const name = rs.dataset.name;
            const img = rs.dataset.img;
            const day = root.__wp_currentDay;
            // add UI item
            const list = root.querySelector(`.wp-day-list[data-day="${day}"]`);
            if (list) {
              const el = document.createElement('div');
              el.className = 'wp-item';
              el.dataset.id = id;
              el.innerHTML = `<img src="${img}" alt=""><div class="wp-meta"><div class="wp-name">${name}</div></div>`;
              list.appendChild(el);
            }
            closeModal(root);
            // update server-side config if possible
            if (typeof saveHandler === 'function') {
              try {
                await saveHandler();
              } catch(e){ console.warn('saveHandler error', e); }
            }
          });
        });
      }
    });
  }

  // --- initialization / bootstrap (listens to injector events) ---
  async function startWithConfig(root, providedConfig){
    debug('startWithConfig', !!root, providedConfig);
    if (!root) return;
    injectStyles(); // ensure fallback styles loaded if injector failed
    // If server provided config object format includes serverWeekGrid vs schedule, normalize
    const cfg = providedConfig || (await getConfigFromServer()) || {};
    // prefer schedule at cfg.schedule or cfg.serverWeekGrid
    const schedule = cfg.schedule || cfg.serverWeekGrid || {};
    renderSchedule(root, { schedule, serverWeekGrid: cfg.serverWeekGrid });

    // detect admin via ApiClient if possible
    try {
      if (window.ApiClient) {
        const uid = window.ApiClient.getCurrentUserId();
        const user = await window.ApiClient.getUser(uid);
        window.__watchplanner_is_admin = !!(user && user.Policy && user.Policy.IsAdministrator);
      } else {
        // if no ApiClient, assume non-admin
        window.__watchplanner_is_admin = false;
      }
    } catch(e){ window.__watchplanner_is_admin = false; }

    attachEventHandlers(root, schedule, async ()=>{
      // build payload from DOM
      const out = { schedule: {} };
      root.querySelectorAll('.wp-day-list').forEach(list => {
        const day = list.dataset.day;
        const items = Array.from(list.children).map(ch => {
          const id = ch.dataset.id || '';
          const name = ch.querySelector('.wp-name')?.textContent || '';
          const img = ch.querySelector('img')?.src || '';
          return { id, name, img };
        });
        out.schedule[day] = items;
      });
      // try server save, fallback to static write not possible from client
      const ok = await saveConfigToServer(out).catch(()=>false);
      if (!ok) debug('saveConfig not available on server; changes not persisted to server');
    });
  }

  // Listen to injector events
  window.addEventListener('watchplanner:config', (ev) => {
    try {
      const cfg = ev?.detail?.config;
      const root = ev?.detail?.root || document.getElementById('watchplanner-root');
      debug('received watchplanner:config event', !!root, !!cfg);
      if (!root) return;
      // ensure DOM structure exists (some injector code may have only created root)
      if (!root.querySelector('.wp-days')) {
        const built = buildRoot();
        root.innerHTML = built.innerHTML;
      }
      startWithConfig(root, cfg);
    } catch(e){ console.error('watchplanner:config handler error', e); }
  });

  window.addEventListener('watchplanner:ready', (ev) => {
    try {
      const root = ev?.detail?.root || document.getElementById('watchplanner-root');
      const cfg = ev?.detail?.config || null;
      debug('received watchplanner:ready', !!root);
      if (!root) return;
      if (!root.querySelector('.wp-days')) {
        const built = buildRoot();
        root.innerHTML = built.innerHTML;
      }
      // run startup (prefer config passed in event)
      startWithConfig(root, cfg);
    } catch(e){ console.error('watchplanner:ready handler error', e); }
  });

  // If injector didn't dispatch events, run a fallback bootstrap after a short delay:
  setTimeout(async () => {
    if (document.getElementById('watchplanner-root') && !window.__watchplanner_initialized) {
      debug('fallback bootstrap');
      const root = document.getElementById('watchplanner-root');
      if (!root.querySelector('.wp-days')) {
        const built = buildRoot();
        root.innerHTML = built.innerHTML;
      }
      const cfg = await getConfigFromServer().catch(()=>null) || (await (async ()=>{
        try {
          const r = await fetch('/web/plugins/jellyfin-mod-watchplanner-section/watchplanner-config.json', { cache: 'no-store' });
          if (r.ok) return r.json();
        } catch(e){}
        return null;
      })()) || { schedule: {} };
      startWithConfig(root, cfg);
      window.__watchplanner_initialized = true;
    }
  }, 800);

  // Also re-run on hash change to handle SPA route changes
  window.addEventListener('hashchange', () => setTimeout(() => {
    try { const root = document.getElementById('watchplanner-root'); if (root) startWithConfig(root); } catch(e){}
  }, 250));
})();
