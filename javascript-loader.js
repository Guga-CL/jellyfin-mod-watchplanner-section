// Tiny loader used in Javascript Injector jellyfin plugin, used to call: watchplanner.bootstrap.js
// This script is used inside Jellyfin's JavaScript Injector Plugin to load this mod. 
(function () {
    'use strict';
    const SRC = '/jelly/web/mods/jellyfin-mod-watchplanner-section/watchplanner.bootstrap.js'; // confirmed reachable
    if (!SRC) return;
    if (document.querySelector('script[data-wp-injector-src="' + SRC + '"]')) return;
    const s = document.createElement('script');
    s.src = SRC + '?v=20251220'; // bump this value when you update the file
    s.async = false;
    s.setAttribute('data-wp-injector-src', SRC);
    s.onload = () => console.log('[WatchPlanner] injector loaded from', SRC);
    s.onerror = (e) => console.warn('[WatchPlanner] failed to load injector', SRC, e);
    document.head.appendChild(s);
})();
