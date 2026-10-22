/**
 * utils/theme-manager.js - Theme Management
 * Path: js/utils/theme-manager.js
 *
 * Manages theme switching with persistence.
 *
 * THEME CYCLE (Alternating Dark/Light):
 *   dark -> light -> vaporwave -> pastel -> carnival -> maximal 
 *   -> gits -> stained-glass -> stained-glass-dark -> deco-nouveau 
 *   -> grotesque -> illuminated -> discowing -> choc-cake 
 *   -> dada -> ukiyo-e -> brutalist -> orchestrion -> rococo 
 *   -> nautical-tile
 *
 * PERSISTENCE:
 *   The preference is stored in localStorage under
 *   'hollow-manager-theme'. Priority on load: 
 *   stored preference > system preference (light or dark only) > dark.
 */

(function() {
    'use strict';

    if (window.__themeManagerLoaded) return;
    window.__themeManagerLoaded = true;

    var STORAGE_KEY = 'hollow-manager-theme';
    var THEME_COLOR_META = 'theme-color';

    var THEME_TABLE = [
        { value: 'dark', isAttribute: false, icon: '\u263E\uFE0E', title: 'Switch to dark mode', ariaLabel: 'Switch to dark mode', themeColor: '#1a1f1a' },
        { value: 'light', isAttribute: true, icon: '\u2600\uFE0E', title: 'Switch to light mode', ariaLabel: 'Switch to light mode', themeColor: '#f5f1e8' },
        { value: 'vaporwave', isAttribute: true, icon: '\u25C8\uFE0E', title: 'Switch to vaporwave mode', ariaLabel: 'Switch to vaporwave mode', themeColor: '#2d1b4e' },
        { value: 'pastel', isAttribute: true, icon: '\u273F\uFE0E', title: 'Switch to pastel mode', ariaLabel: 'Switch to pastel mode', themeColor: '#f8e8f0' },
        { value: 'carnival', isAttribute: true, icon: '\u2620\uFE0E', title: 'Switch to carnival mode', ariaLabel: 'Switch to carnival mode', themeColor: '#1a0a0a' },
        { value: 'maximal', isAttribute: true, icon: '\u2726\uFE0E', title: 'Switch to maximal mode', ariaLabel: 'Switch to maximal mode', themeColor: '#fff0fb' },
        { value: 'gits', isAttribute: true, icon: '\u25C9\uFE0E', title: 'Switch to GITS mode', ariaLabel: 'Switch to GITS mode', themeColor: '#04101a' },
        { value: 'stained-glass', isAttribute: true, icon: '\u26EA\uFE0E', title: 'Switch to Stained Glass mode', ariaLabel: 'Switch to Stained Glass mode', themeColor: '#f2f7fd' },
        { value: 'stained-glass-dark', isAttribute: true, icon: '\u26EF\uFE0E', title: 'Switch to Stained Glass Dark mode', ariaLabel: 'Switch to Stained Glass Dark mode', themeColor: '#0a1520' },
        { value: 'deco-nouveau', isAttribute: true, icon: '\u25C6\uFE0E', title: 'Switch to Deco Nouveau mode', ariaLabel: 'Switch to Deco Nouveau mode', themeColor: '#f4f0e6' },
        { value: 'grotesque', isAttribute: true, icon: '\uD83D\uDC41\uFE0E', title: 'Switch to Grotesque mode', ariaLabel: 'Switch to Grotesque mode', themeColor: '#0d0a0a' },
        { value: 'illuminated', isAttribute: true, icon: '\uD83D\uDCD6\uFE0E', title: 'Switch to Illuminated mode', ariaLabel: 'Switch to Illuminated mode', themeColor: '#F4EBD5' },
        { value: 'discowing', isAttribute: true, icon: '\uD83D\uDCAB\uFE0E', title: 'Switch to Discowing mode', ariaLabel: 'Switch to Discowing mode', themeColor: '#F8A342' },
        { value: 'choc-cake', isAttribute: true, icon: '\uD83C\uDF70\uFE0E', title: 'Switch to Choc Cake mode', ariaLabel: 'Switch to Choc Cake mode', themeColor: '#2A0B1F' },
        { value: 'dada', isAttribute: true, icon: '\u2702\uFE0E', title: 'Switch to Dada mode', ariaLabel: 'Switch to Dada mode', themeColor: '#E8E5DF' },
        { value: 'ukiyo-e', isAttribute: true, icon: '\u6D77\uFE0E', title: 'Switch to Ukiyo-e mode', ariaLabel: 'Switch to Ukiyo-e mode', themeColor: '#F4EAD5' },
        { value: 'brutalist', isAttribute: true, icon: '\u25A0\uFE0E', title: 'Switch to Brutalist mode', ariaLabel: 'Switch to Brutalist mode', themeColor: '#E6E6E6' },
        { value: 'orchestrion', isAttribute: true, icon: '\u2699\uFE0E', title: 'Switch to Orchestrion mode', ariaLabel: 'Switch to Orchestrion mode', themeColor: '#1F1410' },
        { value: 'rococo', isAttribute: true, icon: '\u269C\uFE0E', title: 'Switch to Rococo mode', ariaLabel: 'Switch to Rococo mode', themeColor: '#E8F0F2' },
        { value: 'nautical-tile', isAttribute: true, icon: '\u2693\uFE0E', title: 'Switch to Nautical Tile mode', ariaLabel: 'Switch to Nautical Tile mode', themeColor: '#E4EAF0' }
    ];

    var THEME_BY_VALUE = Object.create(null);
    THEME_TABLE.forEach(function(entry) { THEME_BY_VALUE[entry.value] = entry; });

    var CYCLE = THEME_TABLE.map(function(e) { return e.value; });
    var _currentTheme = 'dark';
    var _initialized = false;
    var _mediaQueryList = null;
    var _mediaQueryListener = null;

    function isValidTheme(theme) {
        return typeof theme === 'string' && Object.prototype.hasOwnProperty.call(THEME_BY_VALUE, theme);
    }

    function loadThemePreference() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (isValidTheme(stored)) return stored;
        } catch (e) {}
        return null;
    }

    function saveThemePreference(theme) {
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
    }

    function clearStoredPreference() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    function getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
        return 'dark';
    }

    function applyTheme(theme) {
        if (!isValidTheme(theme)) return;
        _currentTheme = theme;
        var root = document.documentElement;
        var entry = THEME_BY_VALUE[theme];

        if (entry.isAttribute) {
            root.setAttribute('data-theme', theme);
        } else {
            root.removeAttribute('data-theme');
        }

        // Update meta theme-color
        var meta = document.querySelector('meta[name="' + THEME_COLOR_META + '"]');
        if (meta && entry.themeColor) meta.setAttribute('content', entry.themeColor);

        // Update Toggle Button (next theme icon)
        var btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            var next = nextTheme();
            var nextEntry = THEME_BY_VALUE[next];
            if (nextEntry) {
                btn.textContent = nextEntry.icon;
                btn.title = nextEntry.title;
                btn.setAttribute('aria-label', nextEntry.ariaLabel);
            }
        }

        // Update Text Indicator (current theme name)
        var label = document.getElementById('theme-label');
        if (label) {
            // Format 'stained-glass' -> 'Stained Glass'
            var displayName = theme.split('-').map(function(word) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join(' ');
            label.textContent = displayName;
        }

        try {
            document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: _currentTheme } }));
        } catch (e) {}
    }

    function attachMediaQueryListener() {
        if (!window.matchMedia || _mediaQueryList) return;
        _mediaQueryList = window.matchMedia('(prefers-color-scheme: light)');
        _mediaQueryListener = function(e) {
            if (loadThemePreference()) return;
            if (_currentTheme !== 'dark' && _currentTheme !== 'light') return;
            applyTheme(e.matches ? 'light' : 'dark');
        };
        if (typeof _mediaQueryList.addEventListener === 'function') {
            _mediaQueryList.addEventListener('change', _mediaQueryListener);
        } else if (typeof _mediaQueryList.addListener === 'function') {
            _mediaQueryList.addListener(_mediaQueryListener);
        }
    }

    function detachMediaQueryListener() {
        if (!_mediaQueryList || !_mediaQueryListener) return;
        if (typeof _mediaQueryList.removeEventListener === 'function') {
            _mediaQueryList.removeEventListener('change', _mediaQueryListener);
        } else if (typeof _mediaQueryList.removeListener === 'function') {
            _mediaQueryList.removeListener(_mediaQueryListener);
        }
        _mediaQueryList = null;
        _mediaQueryListener = null;
    }

    function setTheme(theme) {
        if (!isValidTheme(theme)) return;
        applyTheme(theme);
        saveThemePreference(theme);
    }

    function nextTheme() {
        var idx = CYCLE.indexOf(_currentTheme);
        if (idx === -1) idx = 0;
        return CYCLE[(idx + 1) % CYCLE.length];
    }

    function toggle() { setTheme(nextTheme()); }
    function getTheme() { return _currentTheme; }
    function clearPreference() { clearStoredPreference(); applyTheme(getSystemPreference()); }

    function init() {
        if (_initialized) return;
        var stored = loadThemePreference();
        var theme = stored || getSystemPreference();
        applyTheme(theme);
        var btn = document.getElementById('theme-toggle-btn');
        if (btn && !btn._themeManagerBound) {
            btn._themeManagerBound = true;
            btn.addEventListener('click', toggle);
        }
        attachMediaQueryListener();
        _initialized = true;
    }

    function destroy() {
        detachMediaQueryListener();
        var btn = document.getElementById('theme-toggle-btn');
        if (btn && btn._themeManagerBound) {
            btn.removeEventListener('click', toggle);
            btn._themeManagerBound = false;
        }
        _initialized = false;
    }

    window.ThemeManager = Object.freeze({
        init: init,
        destroy: destroy,
        toggle: toggle,
        setTheme: setTheme,
        getTheme: getTheme,
        clearPreference: clearPreference,
        nextTheme: nextTheme,
        THEMES: {
            DARK: 'dark', LIGHT: 'light', VAPORWAVE: 'vaporwave', PASTEL: 'pastel',
            CARNIVAL: 'carnival', MAXIMAL: 'maximal', GITS: 'gits',
            STAINED_GLASS: 'stained-glass', STAINED_GLASS_DARK: 'stained-glass-dark',
            DECO_NOUVEAU: 'deco-nouveau', GROTESQUE: 'grotesque',
            ILLUMINATED: 'illuminated', DISCOWING: 'discowing', 
            CHOC_CAKE: 'choc-cake', DADA: 'dada', UKIYO_E: 'ukiyo-e',
            BRUTALIST: 'brutalist', ORCHESTRION: 'orchestrion',
            ROCOCO: 'rococo', NAUTICAL_TILE: 'nautical-tile'
        }
    });

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
