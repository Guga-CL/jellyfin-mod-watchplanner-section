// client-api.js (cleaned) — Endpoint Exposer integration without internal backup logic
// - Removes internal backup creation/rotation (Endpoint Exposer handles backups)
// - Keeps read/write/load/save helpers and robust ApiClient/fetch fallbacks

(function () {
    'use strict';

    const LOG_PREFIX = 'Watchplanner-API:';
    function log(...args) { try { console.log(LOG_PREFIX, ...args); } catch (e) { } }
    function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (e) { } }
    function err(...args) { try { console.error(LOG_PREFIX, ...args); } catch (e) { } }

    const CONFIG = {
        folderName: 'watchplanner',
        fileName: 'watchplanner-config.json',
        endpointBase: '/Plugins/EndpointExposer',
        backupPrefix: 'watchplanner_backup_',
        useLocalFallback: true
    };

    function buildFolderFilesUrl() {
        const base = CONFIG.endpointBase.replace(/\/$/, '');
        return `${base}/FolderFiles?folder=${encodeURIComponent(CONFIG.folderName)}`;
    }
    function buildFolderFileUrl(name) {
        const base = CONFIG.endpointBase.replace(/\/$/, '');
        return `${base}/FolderFile?folder=${encodeURIComponent(CONFIG.folderName)}&name=${encodeURIComponent(name)}`;
    }
    function buildFolderWriteUrl(name) {
        const base = CONFIG.endpointBase.replace(/\/$/, '');
        return `${base}/FolderWrite?folder=${encodeURIComponent(CONFIG.folderName)}&name=${encodeURIComponent(name)}`;
    }

    // Low-level fetch wrapper returning structured result
    // Prefers Jellyfin's ApiClient.fetch when available so requests include auth
    async function doFetch(url, options = {}) {
        try {
            if (window.ApiClient && typeof window.ApiClient.fetch === 'function') {
                try {
                    const apiOpts = {
                        url: window.ApiClient.getUrl ? window.ApiClient.getUrl(url.replace(/^\//, '')) : url,
                        type: options.method || 'GET',
                        dataType: 'text'
                    };
                    if (options.body) apiOpts.body = options.body;
                    if (options.headers) apiOpts.headers = options.headers;
                    const text = await window.ApiClient.fetch(apiOpts);
                    if (text && typeof text === 'string' && text.trim().toLowerCase().startsWith('<!doctype')) {
                        return { ok: false, status: 0, statusText: 'html-redirect', text, error: 'server-returned-html' };
                    }
                    let json = null;
                    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
                    return { ok: true, status: 200, statusText: 'ok', text, json };
                } catch (e) {
                    warn('[WatchPlanner] doFetch: ApiClient.fetch failed, falling back to fetch', e);
                }
            }

            const res = await fetch(url, options);
            const text = await res.text().catch(() => null);

            const contentType = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
            if ((contentType && contentType.toLowerCase().includes('text/html')) || (text && text.trim().toLowerCase().startsWith('<!doctype'))) {
                return { ok: false, status: res.status, statusText: 'html-redirect', text, error: 'server-returned-html' };
            }

            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }

            return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
        } catch (e) {
            return { ok: false, error: e, status: 0, statusText: 'network-error' };
        }
    }

    // Try a request, and if 401/403 and admin token is available, retry with token
    async function fetchWithOptionalAdminRetry(url, opts = {}) {
        const res = await doFetch(url, opts);
        if ((res.status === 401 || res.status === 403) && window.WATCHPLANNER_ADMIN_TOKEN) {
            const headers = Object.assign({}, opts.headers || {}, { 'X-Emby-Token': window.WATCHPLANNER_ADMIN_TOKEN });
            const retry = await doFetch(url, Object.assign({}, opts, { headers }));
            return retry;
        }
        return res;
    }

    async function listFiles() {
        const url = buildFolderFilesUrl();
        const res = await fetchWithOptionalAdminRetry(url, { method: 'GET', credentials: 'same-origin' });
        if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText, text: res.text };
        return { ok: true, files: res.json || [] };
    }

    async function readConfig() {
        const url = buildFolderFileUrl(CONFIG.fileName);
        const res = await fetchWithOptionalAdminRetry(url, { method: 'GET', credentials: 'same-origin' });
        if (res.ok) {
            if (res.json) return { ok: true, data: res.json };
            try { const parsed = res.text ? JSON.parse(res.text) : null; return { ok: true, data: parsed }; } catch (e) { return { ok: true, data: res.text }; }
        }

        if (CONFIG.useLocalFallback) {
            try {
                const raw = localStorage.getItem(CONFIG.fileName);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    log('[WatchPlanner] readConfig: falling back to localStorage');
                    return { ok: true, data: parsed, fallback: 'localStorage' };
                }
            } catch (e) { /* ignore */ }
        }

        return { ok: false, status: res.status, statusText: res.statusText, text: res.text, error: res.error };
    }

    async function writeConfig(payload, options = {}) {
        const rel = buildFolderWriteUrl(CONFIG.fileName); // returns "/Plugins/EndpointExposer/FolderWrite?folder=...&name=..."
        const body = JSON.stringify(payload, null, 2);

        try { log('[WatchPlanner] writeConfig: outgoing body length', body ? body.length : 0); } catch (e) { }

        // 1) Prefer ApiClient.fetch with `data` (some ApiClient variants expect `data` not `body`)
        if (window.ApiClient && typeof window.ApiClient.fetch === 'function') {
            try {
                const apiUrl = window.ApiClient.getUrl ? window.ApiClient.getUrl(rel.replace(/^\//, '')) : rel;
                const apiOpts = {
                    url: apiUrl,
                    type: 'PUT',
                    dataType: 'text',
                    data: body,            // <-- use `data` (works in your environment)
                    contentType: 'application/octet-stream'
                };
                const text = await window.ApiClient.fetch(apiOpts);
                // treat HTML redirect as failure; otherwise parse JSON if present
                if (text && typeof text === 'string' && !text.trim().toLowerCase().startsWith('<!doctype')) {
                    try { localStorage.setItem(CONFIG.fileName, body); } catch (e) { /* ignore */ }
                    let json = null;
                    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
                    return { ok: true, text, json };
                } else {
                    warn('[WatchPlanner] writeConfig: ApiClient.fetch returned HTML or redirect, falling back', text && text.slice(0, 200));
                }
            } catch (e) {
                warn('[WatchPlanner] writeConfig: ApiClient.fetch threw, falling back', e);
            }
        }

        // 2) Fallback to doFetch (ApiClient.fetch or native fetch fallback)
        try {
            const res = await doFetch(rel, { method: 'PUT', credentials: 'same-origin', body });
            if (res && res.ok) {
                try { localStorage.setItem(CONFIG.fileName, body); } catch (e) { /* ignore */ }
                return { ok: true, text: res.text, json: res.json };
            }
            warn('[WatchPlanner] writeConfig: doFetch returned non-ok', res && res.status, res && res.statusText);
            return { ok: false, status: res && res.status, statusText: res && res.statusText, text: res && res.text, error: res && res.error };
        } catch (e) {
            warn('[WatchPlanner] writeConfig: final fallback failed', e);
            return { ok: false, error: e };
        }
    }

    function validatePayload(payload) {
        if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload-not-object' };
        if (!payload.schedule || typeof payload.schedule !== 'object') return { ok: false, reason: 'missing-schedule' };
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (const d of days) {
            if (!Array.isArray(payload.schedule[d])) payload.schedule[d] = [];
        }
        return { ok: true, payload };
    }

    async function save(schedule, opts = {}) {
        const payload = { schedule };
        const v = validatePayload(payload);
        if (!v.ok) return { ok: false, reason: v.reason };
        const makeBackup = opts.makeBackup !== undefined ? !!opts.makeBackup : true;
        // writeConfig will skip internal backups; Endpoint Exposer handles backups
        return await writeConfig(payload, { makeBackup });
    }

    async function load() {
        const res = await readConfig();
        if (!res.ok) return res;
        const data = res.data;
        if (data && typeof data === 'object' && data.schedule) return { ok: true, data: data.schedule };
        if (data && typeof data === 'object') return { ok: true, data };
        return { ok: true, data: data };
    }

    function buildImageUrl(itemImgPath) {
        if (!itemImgPath) return '';
        const configured = (window.WATCHPLANNER_SERVER_BASE && String(window.WATCHPLANNER_SERVER_BASE).length) ? String(window.WATCHPLANNER_SERVER_BASE).replace(/\/$/, '') : null;
        if (configured) return `${configured}${itemImgPath}`;
        try {
            const p = window.location.pathname || '';
            const idx = p.indexOf('/web/');
            if (idx > 0) {
                const prefix = p.substring(0, idx);
                return `${window.location.origin}${prefix}${itemImgPath}`;
            }
        } catch (e) { }
        return `${window.location.origin}${itemImgPath}`;
    }

    window.WatchplannerAPI = {
        listFiles,
        readConfig,
        writeConfig,
        save,
        load,
        validatePayload,
        buildImageUrl,
        _internal: { CONFIG, buildFolderFileUrl, buildFolderWriteUrl, buildFolderFilesUrl, doFetch }
    };

    log('[WatchPlanner] client-api.js (cleaned) initialized');
})();
