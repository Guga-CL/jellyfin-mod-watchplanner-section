// client-api.js
// API utilities for Watchplanner mod
// - talk to Endpoint Exposer using same-origin relative URLs
// - provide read, write, and backup helpers
// - minimal, dependency-free, safe for injection into Jellyfin UI

(function () {
    'use strict';

    const LOG_PREFIX = 'Watchplanner-API:';
    function log(...args) { try { console.log(LOG_PREFIX, ...args); } catch (e) { } }
    function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (e) { } }
    function err(...args) { try { console.error(LOG_PREFIX, ...args); } catch (e) { } }

    // Configuration
    const CONFIG = {
        fileName: 'watchplanner', // name used by Endpoint Exposer ?name=
        endpointBase: '/Plugins/EndpointExposer', // relative base
        backupPrefix: 'watchplanner_backup_', // used only for in-memory/local backups if needed
        useLocalFallback: true // if read fails, optionally fallback to localStorage
    };

    // Utility: build endpoint URL
    function buildUrl(path, qs) {
        const base = CONFIG.endpointBase.replace(/\/$/, '');
        const url = `${base}/${path.replace(/^\/+/, '')}`;
        if (!qs) return url;
        const params = new URLSearchParams(qs).toString();
        return `${url}?${params}`;
    }

    // Low-level fetch wrapper with structured result
    async function doFetch(url, options = {}) {
        try {
            const res = await fetch(url, options);
            const text = await res.text().catch(() => null);
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
            return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
        } catch (e) {
            return { ok: false, error: e, status: 0, statusText: 'network-error' };
        }
    }

    // Public: read current config from Endpoint Exposer (GET /Read?name=...)
    async function readConfig() {
        const url = buildUrl('Read', { name: CONFIG.fileName });
        const res = await doFetch(url, { method: 'GET', credentials: 'same-origin' });
        if (res.ok) {
            // prefer JSON body if available
            if (res.json) return { ok: true, data: res.json };
            try {
                const parsed = res.text ? JSON.parse(res.text) : null;
                return { ok: true, data: parsed };
            } catch (e) {
                // return raw text if not JSON
                return { ok: true, data: res.text };
            }
        }

        // fallback to localStorage if enabled
        if (CONFIG.useLocalFallback) {
            try {
                const raw = localStorage.getItem(CONFIG.fileName);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    log('readConfig: falling back to localStorage');
                    return { ok: true, data: parsed, fallback: 'localStorage' };
                }
            } catch (e) { /* ignore */ }
        }

        return { ok: false, status: res.status, statusText: res.statusText, text: res.text, error: res.error };
    }

    // Public: write config to Endpoint Exposer (PUT /Write?name=...)
    // payload should be a JS object (will be JSON.stringified)
    // options: { makeBackup: true/false, apiKey: '...' } - apiKey optional for testing
    async function writeConfig(payload, options = {}) {
        const url = buildUrl('Write', { name: CONFIG.fileName });
        const body = JSON.stringify(payload);

        // Optionally create a backup before writing
        if (options.makeBackup) {
            try {
                await createBackup(payload);
            } catch (e) {
                warn('writeConfig: backup failed', e);
            }
        }

        const headers = { 'Content-Type': 'application/json' };
        if (options.apiKey) headers['X-EndpointExposer-Key'] = options.apiKey;

        const res = await doFetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers,
            body
        });

        if (res.ok) {
            // persist a local copy for fallback
            try { localStorage.setItem(CONFIG.fileName, body); } catch (e) { /* ignore */ }
            return { ok: true, text: res.text, json: res.json };
        }

        return { ok: false, status: res.status, statusText: res.statusText, text: res.text, error: res.error };
    }

    // Create a timestamped backup by calling the same Write endpoint with a different name,
    // or store in localStorage if server backup not desired/available.
    // This function attempts server-side backup first (Write?name=watchplanner_backup_<ts>),
    // and falls back to localStorage backup.
    async function createBackup(currentPayload) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `${CONFIG.fileName}_backup_${ts}`;
        const url = buildUrl('Write', { name: backupName });
        const body = JSON.stringify(currentPayload);

        // Try server backup
        const res = await doFetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body
        });

        if (res.ok) {
            log('createBackup: server backup saved as', backupName);
            return { ok: true, method: 'server', name: backupName };
        }

        // Fallback: localStorage backup
        try {
            const key = CONFIG.backupPrefix + ts;
            localStorage.setItem(key, body);
            log('createBackup: localStorage backup saved as', key);
            return { ok: true, method: 'localStorage', name: key };
        } catch (e) {
            warn('createBackup: failed to save local backup', e);
            return { ok: false, error: e };
        }
    }

    // Utility: validate payload shape (basic)
    function validatePayload(payload) {
        if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload-not-object' };
        if (!payload.schedule || typeof payload.schedule !== 'object') return { ok: false, reason: 'missing-schedule' };
        // ensure days exist
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (const d of days) {
            if (!Array.isArray(payload.schedule[d])) payload.schedule[d] = [];
        }
        return { ok: true, payload };
    }

    // Convenience: save(schedule) where schedule is the inner object { Mon: [...], ... }
    async function save(schedule, opts = {}) {
        const payload = { schedule };
        const v = validatePayload(payload);
        if (!v.ok) return { ok: false, reason: v.reason };

        // create a backup of the current server config before overwriting
        const makeBackup = opts.makeBackup !== undefined ? !!opts.makeBackup : true;

        return await writeConfig(payload, { makeBackup, apiKey: opts.apiKey });
    }

    // Convenience: load() returns the schedule object or null
    async function load() {
        const res = await readConfig();
        if (!res.ok) return res;
        // If the server returns an object with schedule, return it
        const data = res.data;
        if (data && typeof data === 'object' && data.schedule) return { ok: true, data: data.schedule };
        // If raw JSON is the schedule itself, return it
        if (data && typeof data === 'object') return { ok: true, data };
        return { ok: true, data: data };
    }

    // Expose API on window for client-ui.js to use
    window.WatchplannerAPI = {
        readConfig,
        writeConfig,
        createBackup,
        save,
        load,
        validatePayload,
        _internal: { buildUrl, doFetch, CONFIG } // exposed for debugging only
    };

    log('client-api.js initialized');
})();
