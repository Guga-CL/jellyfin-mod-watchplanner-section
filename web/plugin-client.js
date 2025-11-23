(function () {
  console.log("watchplanner-injected")
  // Detect if we are on Jellyfin home page
  function isHome() {
    return location.hash.startsWith('#/home') || location.hash === '' || location.hash === '#';
  }

  // Wait for home DOM to be ready
  function waitForHomeSection(maxTries = 60) {
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        const container = document.querySelector('.homeSection, .dashboardSection, #app');
        if (container) {
          clearInterval(iv);
          resolve(container);
        }
        if (--maxTries <= 0) {
          clearInterval(iv);
          resolve(null);
        }
      }, 250);
    });
  }

  // Admin check via ApiClient
  async function isAdmin(api) {
    try {
      const uid = api.getCurrentUserId();
      const user = await api.getUser(uid);
      return user?.Policy?.IsAdministrator === true;
    } catch {
      return false;
    }
  }

  // GET config from backend
  async function getConfig() {
    try {
      const res = await fetch('/watchplanner/config', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      return data?.schedule || {};
    } catch {
      return {};
    }
  }

  // POST config (admins only)
  async function saveConfig(schedule) {
    const body = JSON.stringify({ schedule });
    const res = await fetch('/watchplanner/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body
    });
    if (!res.ok) throw new Error('Failed to save config');
  }

  // Search series via Jellyfin API
  async function searchSeries(api, term) {
    const uid = api.getCurrentUserId();
    const p = {
      SearchTerm: term,
      IncludeItemTypes: 'Series',
      Limit: 12,
      Recursive: true
    };
    const res = await api.getItems(uid, p);
    const items = res?.Items || [];
    return items.map(it => ({
      id: it.Id,
      name: it.Name,
      img: api.getImageUrl(it.Id, { type: 'Primary', maxHeight: 120 }) || ''
    }));
  }

  // Build root container
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
    const css = `
      #watchplanner-root { margin: 12px 0; padding: 10px; background: var(--theme-background); border-radius: 8px; }
      .wp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
      .wp-title { font-weight:600; }
      .wp-days { display:grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
      .wp-day { background: var(--theme-background-alt); border-radius:6px; padding:6px; }
      .watchplanner-header-cell { font-weight:600; margin-bottom:6px; cursor:pointer; }
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
    root.querySelectorAll('.wp-day-list').forEach(list => {
      const day = list.dataset.day;
      const items = schedule[day] || [];
      list.innerHTML = items.map(s => `
        <div class="wp-item">
          <img src="${s.img}" alt="">
          <div class="wp-meta">
            <div class="wp-name">${s.name}</div>
          </div>
        </div>`).join('');
    });
  }

  function openModal(root) {
    root.querySelector('.wp-modal-overlay').style.display = 'flex';
    root.querySelector('.wp-search-input').value = '';
    root.querySelector('.wp-results').innerHTML = '';
    root.querySelector('.wp-search-input').focus();
  }

  function closeModal(root) {
    root.querySelector('.wp-modal-overlay').style.display = 'none';
  }


  const WP_DEBUG = true;

  function debug(...args) {
    if (WP_DEBUG && console && console.debug) console.debug('[watchplanner]', ...args);
  }

// --- replace your existing findHomeContainer + waitForHomeContainer + robustBootstrap with this block ---

function debug(...args) {
  if (console && console.debug) console.debug('[watchplanner]', ...args);
}

function findHomeContainer() {
  // broad selector attempts (ordered)
  const selectors = [
    '.verticalSection',
    '#app', // common root
    '.homeSection',
    '.dashboardSection',
    '#root',
    '[data-view="home"]',
    '[data-view="Dashboard"]',
    '[data-testid="home"]',
    '.main', // fallback
  ];

  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el) {
        debug('findHomeContainer: matched', s);
        return el;
      }
    } catch (e) {
      // ignore invalid selector
    }
  }

  // heuristic: find an element that contains the typical home sections
  try {
    const candidates = Array.from(document.querySelectorAll('div'));
    for (const c of candidates) {
      if (c.innerText && c.innerText.length < 300 && /Recently|Continue|Continue Watching|recommended|Recommended/i.test(c.innerText)) {
        debug('findHomeContainer: heuristic matched a div containing home text');
        return c;
      }
    }
  } catch (e) { /* ignore */ }

  return null;
}

async function waitForHomeContainer(timeoutMs = 45000) {
  const start = Date.now();
  const found = findHomeContainer();
  if (found) return found;

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const c = findHomeContainer();
      if (c) {
        observer.disconnect();
        debug('waitForHomeContainer: observer found container');
        resolve(c);
      } else if (Date.now() - start >= timeoutMs) {
        observer.disconnect();
        debug('waitForHomeContainer: observer timed out');
        resolve(null);
      }
    });

    observer.observe(document.documentElement || document, { childList: true, subtree: true });

    // fallback polling (less aggressive)
    (function poll(delay = 200) {
      const c = findHomeContainer();
      if (c) {
        observer.disconnect();
        debug('waitForHomeContainer: poll found container');
        return resolve(c);
      }
      if (Date.now() - start >= timeoutMs) {
        debug('waitForHomeContainer: poll timed out');
        observer.disconnect();
        return resolve(null);
      }
      setTimeout(() => poll(Math.min(2000, delay * 1.5)), delay);
    })();
  });
}

async function robustBootstrap() {
  try {
    debug('robustBootstrap: start; hash=', location.hash, 'ApiClient=', !!window.ApiClient);
    // allow injection on home or when called directly
    const isHome = () => location.hash.startsWith('#/home') || location.hash === '' || location.hash === '#';
    // still attempt even if not strictly on home, to support PluginPages direct injection
    debug('robustBootstrap: waiting for home container (45s)');
    const container = await waitForHomeContainer(45000);

    let root = document.getElementById('watchplanner-root');

    if (!container && !root) {
      debug('robustBootstrap: no container found after wait, will fallback to document.body');
      try {
        injectStyles();
        root = buildRoot();
        document.body.prepend(root);
        debug('robustBootstrap: appended root to document.body fallback');
      } catch (e) {
        console.error('watchplanner: fallback injection failed', e);
        return;
      }
    } else {
      if (!root) {
        injectStyles();
        root = buildRoot();
        // prefer prepend into container if found, else body
        (container || document.body).prepend(root);
        debug('robustBootstrap: injected root into', container ? 'container' : 'body');
      } else {
        debug('robustBootstrap: root already present');
      }
    }

    // rest of your startup: wait for ApiClient then render
    const apiWaitStart = Date.now();
    while (!window.ApiClient && Date.now() - apiWaitStart < 10000) {
      debug('robustBootstrap: waiting for ApiClient...');
      await new Promise(r => setTimeout(r, 200));
    }
    if (!window.ApiClient) {
      debug('robustBootstrap: ApiClient missing, continuing — some features may be disabled');
    }

    // safe render call
    try {
      const schedule = await getConfig().catch(e => { debug('getConfig failed', e); return {}; });
      renderSchedule(document.getElementById('watchplanner-root'), schedule);
    } catch (e) {
      console.error('watchplanner: renderSchedule error', e);
    }

    // observe root removal and re-inject if necessary
    const bodyObserver = new MutationObserver(() => {
      if (!document.getElementById('watchplanner-root')) {
        debug('robustBootstrap: root removed, re-injecting');
        try {
          const c = findHomeContainer();
          const r = buildRoot();
          (c || document.body).prepend(r);
        } catch (e) { debug('re-inject error', e); }
      }
    });
    bodyObserver.observe(document.documentElement || document, { childList: true, subtree: true });

  } catch (err) {
    console.error('watchplanner bootstrap top-level error', err);
  }
}

// Run (and on hashchange)
try {
  robustBootstrap();
  window.addEventListener('hashchange', () => setTimeout(robustBootstrap, 200));
} catch (e) {
  console.error('watchplanner: bootstrap launch error', e);
}


  // run; also re-run on route/hashchange to support SPA navigation
  robustBootstrap();
  window.addEventListener('hashchange', () => {
    // delay a tick to allow Jellyfin router to settle
    setTimeout(() => robustBootstrap(), 200);
  });
})();

