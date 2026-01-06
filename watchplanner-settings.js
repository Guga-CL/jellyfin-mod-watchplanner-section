// watchplanner-settings.js
// Tiny settings panel injected into the Watchplanner header for local testing
(function () {
    'use strict';

    const ROOT_ID = 'watchplanner-root';
    function getRoot() { return document.getElementById(ROOT_ID); }

    function readLocal() {
        return {
            base: localStorage.getItem('WATCHPLANNER_SERVER_BASE') || '',
            token: localStorage.getItem('WATCHPLANNER_ADMIN_TOKEN') || ''
        };
    }
    function saveLocal(base, token) {
        if (base != null) localStorage.setItem('WATCHPLANNER_SERVER_BASE', base);
        if (token != null) localStorage.setItem('WATCHPLANNER_ADMIN_TOKEN', token);
        // also set globals for immediate use
        window.WATCHPLANNER_SERVER_BASE = base || '';
        window.WATCHPLANNER_ADMIN_TOKEN = token || '';
    }

    function createSettingsButton() {
        const root = getRoot();
        if (!root) return;
        const header = root.querySelector('.wp-header');
        if (!header) return;
        if (header.querySelector('.wp-settings-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'wp-settings-btn wp-btn';
        btn.textContent = 'Settings';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', openSettingsPanel);
        header.querySelector('div:last-child').appendChild(btn);
    }

    function openSettingsPanel() {
        const root = getRoot();
        if (!root) return;
        // simple prompt-based UI to avoid extra DOM complexity
        const cur = readLocal();
        const base = prompt('Server Base URL (leave blank to use current origin):', cur.base || '');
        if (base === null) return; // cancelled
        const token = prompt('Admin token for testing (leave blank to disable):', cur.token || '');
        if (token === null) return;
        saveLocal(base.trim(), token.trim());
        alert('Settings saved. Reload the page or re-open the Watchplanner to apply.');
    }

    // expose a small initializer
    window.WatchplannerSettings = {
        init: function () {
            // set globals from localStorage immediately
            const cur = readLocal();
            window.WATCHPLANNER_SERVER_BASE = cur.base || '';
            window.WATCHPLANNER_ADMIN_TOKEN = cur.token || '';
            // try to add button (if UI already present)
            createSettingsButton();
            // also observe for header to appear later
            const root = getRoot();
            if (root) {
                const obs = new MutationObserver(() => createSettingsButton());
                obs.observe(root, { childList: true, subtree: true });
            }
        }
    };

    // auto-init after a short delay (safe if injector loads this file last)
    setTimeout(() => {
        try { window.WatchplannerSettings.init(); } catch (e) { /* ignore */ }
    }, 500);
})();
