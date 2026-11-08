// utils.js
// Small utility helpers for Watchplanner UI
(function () {
    'use strict';

    const LOG_PREFIX = '[WatchPlanner] utils:';
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

    async function addUnplayedCountBadge(imageContainer, seriesId) {
        if (!imageContainer || !seriesId || !window.WatchplannerAPI ||
            typeof window.WatchplannerAPI.getUnplayedEpisodeCount !== 'function') return;

        const result = await window.WatchplannerAPI.getUnplayedEpisodeCount(seriesId);
        if (!result.ok) {
            safeWarn('Unable to load unplayed episode count', { seriesId, result });
            return;
        }
        if (result.count <= 0 || !imageContainer.isConnected) return;

        const label = `${result.count} unplayed episode${result.count === 1 ? '' : 's'}`;
        const indicators = el('div', { class: 'cardIndicators', 'aria-label': label },
            el('div', { class: 'countIndicator indicator', title: label }, result.count)
        );
        imageContainer.appendChild(indicators);
    }

    async function addNextEpisodeLabel(itemContainer, seriesId) {
        if (!itemContainer || !seriesId || !window.WatchplannerAPI ||
            typeof window.WatchplannerAPI.getNextEpisode !== 'function') return;

        try {
            let result = await window.WatchplannerAPI.getNextEpisode(seriesId);
            if ((!result || !result.ok) && typeof window.WatchplannerAPI.getNextEpisodeFallback === 'function') {
                result = await window.WatchplannerAPI.getNextEpisodeFallback(seriesId);
            }
            if (!result || !result.ok) {
                safeWarn('Unable to load next unwatched episode', { seriesId, result });
                return;
            }

            const episode = result.episode;
            if (!episode || !Number.isInteger(episode.seasonNumber) || episode.seasonNumber < 0 ||
                !Number.isInteger(episode.episodeNumber) || episode.episodeNumber < 0) {
                safeWarn('Next unwatched episode is missing season or episode number', { seriesId, episode });
                return;
            }
            if (!itemContainer.isConnected) return;

            const label = `S${String(episode.seasonNumber).padStart(2, '0')}:E${String(episode.episodeNumber).padStart(2, '0')}`;
            itemContainer.appendChild(el('div', {
                class: 'wp-next-episode',
                title: 'Next unwatched episode',
                'aria-label': `Next unwatched episode: ${label}`
            }, label));
        } catch (e) {
            safeWarn('Failed to add next unwatched episode label', { seriesId, error: e });
        }
    }

    // Expose minimal API
    window.WPUtils = window.WPUtils || {};
    Object.assign(window.WPUtils, {
        el,
        debounce,
        tryParseJson,
        addUnplayedCountBadge,
        addNextEpisodeLabel,
        log: safeLog,
        warn: safeWarn,
        error: safeErr
    });

    // safeLog('utils.js initialized');
    console.log('[WatchPlanner] utils.js initialized');
})();
