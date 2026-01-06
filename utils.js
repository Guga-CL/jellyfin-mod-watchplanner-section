// utils.js
// Small utility helpers for Watchplanner UI
(function () {
    'use strict';

    const LOG_PREFIX = 'WP-Utils:';
    function safeLog(...a) { try { console.log(LOG_PREFIX, ...a); } catch (e) { } }
    function safeWarn(...a) { try { console.warn(LOG_PREFIX, ...a); } catch (e) { } }
    function safeErr(...a) { try { console.error(LOG_PREFIX, ...a); } catch (e) { } }

    // Create element helper: tag, attrs, children
    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const k in attrs) {
            if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
            const v = attrs[k];
            if (k === 'style' && v && typeof v === 'object') {
                Object.assign(node.style, v);
            } else if (k === 'class') {
                node.className = v;
            } else if (k === 'dataset' && v && typeof v === 'object') {
                for (const d in v) node.dataset[d] = v[d];
            } else if (k.startsWith('on') && typeof v === 'function') {
                node.addEventListener(k.substring(2), v);
            } else if (k === 'html') {
                node.innerHTML = v;
            } else {
                node.setAttribute(k, String(v));
            }
        }
        for (const c of children) {
            if (c == null) continue;
            if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
            else node.appendChild(c);
        }
        return node;
    }

    // Debounce helper
    function debounce(fn, wait = 250) {
        let t = null;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // Safe JSON parse
    function tryParseJson(text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    // Expose minimal API
    window.WPUtils = window.WPUtils || {};
    Object.assign(window.WPUtils, {
        el,
        debounce,
        tryParseJson,
        log: safeLog,
        warn: safeWarn,
        error: safeErr
    });

    safeLog('utils.js initialized');
})();
