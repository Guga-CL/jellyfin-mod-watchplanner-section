// WatchPlanner Injector (mods path) — final
(function watchPlannerInjector(){
  try {
    if (window.__watchPlannerInjected) return console.log('WatchPlanner: already injected');
    window.__watchPlannerInjected = true;
    console.log('WatchPlanner: injector start');

    // base path under the server's /web/mods mapping
    const base = '/web/mods/jellyfin-mod-watchplanner-section';
    const clientJs = base + '/watchplanner-client.js';
    const css = base + '/watchplanner-styles.css';
    const staticConfig = base + '/watchplanner-config.json';

    function addCss(href){
      if (document.querySelector('link[data-from="watchplanner"][href="'+href+'"]')) return Promise.resolve();
      return new Promise(res=>{
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.setAttribute('data-from','watchplanner');
        l.onload = ()=>{ console.log('WatchPlanner: CSS loaded', href); res(true); };
        l.onerror = ()=>{ console.warn('WatchPlanner: CSS load failed', href); res(false); };
        document.head.appendChild(l);
      });
    }

    function addScript(src, isModule=false){
      return new Promise(res=>{
        if (document.querySelector('script[data-from="watchplanner"][src="'+src+'"]')) return res(true);
        const s = document.createElement('script');
        if (isModule) s.type = 'module';
        s.src = src;
        s.setAttribute('data-from','watchplanner');
        s.onload = ()=>{ console.log('WatchPlanner: script loaded', src); res(true); };
        s.onerror = (e)=>{ console.warn('WatchPlanner: script failed', src, e); res(false); };
        document.head.appendChild(s);
      });
    }

    function firstElementChildOf(container){
      return Array.from(container.childNodes).find(n => n.nodeType === 1) || null;
    }

    function attachRootAfterFirstChild(){
      const container = document.querySelector('div.homeSectionsContainer');
      if (!container) {
        console.warn('WatchPlanner: homeSectionsContainer not found; abort attach');
        return null;
      }

      let existingRoot = container.querySelector('#watchplanner-root') || container.querySelector('.watchplanner-root');
      const firstChild = firstElementChildOf(container);

      if (existingRoot) {
        if (firstChild && firstChild.nextElementSibling !== existingRoot) {
          try {
            container.insertBefore(existingRoot, firstChild.nextElementSibling);
            console.log('WatchPlanner: moved existing root to after first child');
          } catch(e) {
            console.warn('WatchPlanner: failed moving existing root', e);
          }
        } else {
          console.log('WatchPlanner: existing root in correct place');
        }
        return existingRoot;
      }

      const root = document.createElement('div');
      root.id = 'watchplanner-root';
      root.className = 'watchplanner-root';

      if (firstChild) {
        if (firstChild.nextElementSibling) container.insertBefore(root, firstChild.nextElementSibling);
        else container.appendChild(root);
        console.log('WatchPlanner: injected root after first child element');
      } else {
        container.prepend(root);
        console.log('WatchPlanner: injected root at container start (no first child found)');
      }

      return root;
    }

    async function loadConfig(){
      try {
        const r = await fetch('/watchplanner/config', { cache: 'no-store', credentials: 'include' });
        if (r.ok) {
          console.log('WatchPlanner: loaded server config');
          return r.json();
        }
        console.warn('WatchPlanner: server config not found (status ' + r.status + '), trying static config');
      } catch(e){
        console.warn('WatchPlanner: server config fetch error', e);
      }

      try {
        const r2 = await fetch(staticConfig, { cache: 'no-store' });
        if (r2.ok) {
          console.log('WatchPlanner: loaded static config from', staticConfig);
          return r2.json();
        }
        console.warn('WatchPlanner: static config not found (status ' + (r2 ? r2.status : 'n/a') + ')');
      } catch(e){
        console.warn('WatchPlanner: static config fetch error', e);
      }

      console.log('WatchPlanner: using default fallback config');
      return { enabled: true, exampleOption: true, schedule: {} };
    }

    function waitForContainerAndAttach(timeoutMs = 20000){
      let tries = 0;
      const poll = setInterval(async ()=>{
        tries++;
        const container = document.querySelector('div.homeSectionsContainer');
        if (container) {
          clearInterval(poll);
          const root = attachRootAfterFirstChild();
          if (!root) return;
          const cfg = await loadConfig();
          window.dispatchEvent(new CustomEvent('watchplanner:config', { detail: { config: cfg, root } }));
          window.dispatchEvent(new CustomEvent('watchplanner:ready', { detail: { root, config: cfg } }));
          console.log('WatchPlanner: dispatched config and ready events');
          return;
        }
        if (tries * 250 > timeoutMs) {
          clearInterval(poll);
          const c = document.querySelector('div.homeSectionsContainer');
          if (c) {
            console.warn('WatchPlanner: container found late; proceeding to attach');
            const root = attachRootAfterFirstChild();
            if (!root) return;
            const cfg = await loadConfig();
            window.dispatchEvent(new CustomEvent('watchplanner:config', { detail: { config: cfg, root } }));
            window.dispatchEvent(new CustomEvent('watchplanner:ready', { detail: { root, config: cfg } }));
            console.log('WatchPlanner: dispatched config and ready events (late attach)');
          } else {
            console.warn('WatchPlanner: container not found; abort attach');
          }
        }
      }, 250);
    }

    addCss(css).then(async ()=>{
      await addScript(clientJs, false);
      waitForContainerAndAttach(20000);
    });

  } catch(err){
    console.error('WatchPlanner injector fatal', err);
  }
})();