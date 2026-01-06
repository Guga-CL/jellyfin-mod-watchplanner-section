// Tiny loader used in Javascript Injector jellyfin plugin, used to call: watchplanner.bootstrap.js
// Have to manually add this as a script in the plugin settings
(function () {
    'use strict';
    const SRC = '/jelly/web/mods/jellyfin-mod-watchplanner-section/watchplanner.bootstrap.js'; // confirmed reachable
    if (!SRC) return;
    if (document.querySelector('script[data-wp-injector-src="' + SRC + '"]')) return;
    const s = document.createElement('script');
    s.src = SRC + '?v=20251220'; // bump this value when you update the file
    s.async = false;
    s.setAttribute('data-wp-injector-src', SRC);
    s.onload = () => console.log('watchplanner: injector loaded from', SRC);
    s.onerror = (e) => console.warn('watchplanner: failed to load injector', SRC, e);
    document.head.appendChild(s);
})();
