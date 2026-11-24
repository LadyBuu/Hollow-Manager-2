/**
 * utils/theme-manager.js - Theme Management
 * Path: js/utils/theme-manager.js
 *
 * Explicit theme selection is the primary control. The adjacent toggle
 * remains a quick Dark/Light switch; it no longer cycles through every theme.
 */
(function() {
    'use strict';

    if (window.__themeManagerLoaded) return;
    window.__themeManagerLoaded = true;

    var STORAGE_KEY = 'hollow-manager-theme';
    var THEME_COLOR_META = 'theme-color';

    var THEME_TABLE = [
        { value: 'dark', label: 'Dark', isAttribute: false, themeColor: '#0a1505' },
        { value: 'light', label: 'Light', isAttribute: true, themeColor: '#ece9df' },
        { value: 'vaporwave', label: 'Vaporwave', isAttribute: true, themeColor: '#100b24' },
        { value: 'pastel', label: 'Pastel', isAttribute: true, themeColor: '#f8e8f0' },
        { value: 'carnival', label: 'Carnival', isAttribute: true, themeColor: '#1a0a0a' },
        { value: 'maximal', label: 'Maximal', isAttribute: true, themeColor: '#fff0fb' },
        { value: 'gits', label: 'GITS', isAttribute: true, themeColor: '#07080c' },
        { value: 'stained-glass', label: 'Stained Glass', isAttribute: true, themeColor: '#0a1520' },
        { value: 'stained-glass-dark', label: 'Stained Glass Dark', isAttribute: true, themeColor: '#0a1520' },
        { value: 'deco-nouveau', label: 'Deco Nouveau', isAttribute: true, themeColor: '#f4f0e6' },
        { value: 'grotesque', label: 'Grotesque', isAttribute: true, themeColor: '#0d0a0a' },
        { value: 'illuminated', label: 'Illuminated', isAttribute: true, themeColor: '#f4ebd5' },
        { value: 'discowing', label: 'Discowing', isAttribute: true, themeColor: '#f8a342' },
        { value: 'choc-cake', label: 'Choc Cake', isAttribute: true, themeColor: '#2a0b1f' },
        { value: 'dada', label: 'Dada', isAttribute: true, themeColor: '#e8e5df' },
        { value: 'ukiyo-e', label: 'Ukiyo-e', isAttribute: true, themeColor: '#f4ead5' },
        { value: 'brutalist', label: 'Brutalist', isAttribute: true, themeColor: '#e6e6e6' },
        { value: 'orchestrion', label: 'Orchestrion', isAttribute: true, themeColor: '#1f1410' },
        { value: 'rococo', label: 'Rococo', isAttribute: true, themeColor: '#e8f0f2' },
        { value: 'nautical-tile', label: 'Nautical Tile', isAttribute: true, themeColor: '#e4eaf0' }
    ];

    var THEME_BY_VALUE = Object.create(null);
    THEME_TABLE.forEach(function(entry) { THEME_BY_VALUE[entry.value] = entry; });

    var _currentTheme = 'dark';
    var _initialized = false;
    var _mediaQueryList = null;
    var _mediaQueryListener = null;
    var _themeSelect = null;
    var _themeSelectListener = null;

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

    function updateControls() {
        var entry = THEME_BY_VALUE[_currentTheme];
        var select = document.getElementById('theme-select');
        if (select && select.value !== _currentTheme) select.value = _currentTheme;

        var button = document.getElementById('theme-toggle-btn');
        if (button) {
            var target = _currentTheme === 'dark' ? 'light' : 'dark';
            button.textContent = target === 'light' ? '\u263c\uFE0E' : '\u263e\uFE0E';
            button.title = 'Switch to ' + target + ' theme';
            button.setAttribute('aria-label', 'Switch to ' + target + ' theme');
        }

        var meta = document.querySelector('meta[name="' + THEME_COLOR_META + '"]');
        if (meta && entry && entry.themeColor) meta.setAttribute('content', entry.themeColor);
    }

    function applyTheme(theme) {
        if (!isValidTheme(theme)) return;
        _currentTheme = theme;
        var root = document.documentElement;
        var entry = THEME_BY_VALUE[theme];

        if (entry.isAttribute) root.setAttribute('data-theme', theme);
        else root.removeAttribute('data-theme');

        updateControls();

        try {
            document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: _currentTheme } }));
        } catch (e) {}
    }

    function attachMediaQueryListener() {
        if (!window.matchMedia || _mediaQueryList) return;
        _mediaQueryList = window.matchMedia('(prefers-color-scheme: light)');
        _mediaQueryListener = function(event) {
            if (loadThemePreference()) return;
            if (_currentTheme !== 'dark' && _currentTheme !== 'light') return;
            applyTheme(event.matches ? 'light' : 'dark');
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
        if (!isValidTheme(theme)) return false;
        applyTheme(theme);
        saveThemePreference(theme);
        return true;
    }

    function nextTheme() {
        return _currentTheme === 'dark' ? 'light' : 'dark';
    }

    function toggle() {
        setTheme(nextTheme());
    }

    function getTheme() {
        return _currentTheme;
    }

    function getThemes() {
        return THEME_TABLE.map(function(entry) {
            return { value: entry.value, label: entry.label };
        });
    }

    function clearPreference() {
        clearStoredPreference();
        applyTheme(getSystemPreference());
    }

    function onThemeSelectChange() {
        if (_themeSelect && isValidTheme(_themeSelect.value)) {
            setTheme(_themeSelect.value);
        }
    }

    function init() {
        if (_initialized) return;

        var stored = loadThemePreference();
        applyTheme(stored || getSystemPreference());

        var button = document.getElementById('theme-toggle-btn');
        if (button && !button._themeManagerBound) {
            button._themeManagerBound = true;
            button.addEventListener('click', toggle);
        }

        _themeSelect = document.getElementById('theme-select');
        if (_themeSelect) {
            _themeSelectListener = onThemeSelectChange;
            _themeSelect.addEventListener('change', _themeSelectListener);
            _themeSelect.value = _currentTheme;
        }

        attachMediaQueryListener();
        _initialized = true;
    }

    function destroy() {
        detachMediaQueryListener();

        var button = document.getElementById('theme-toggle-btn');
        if (button && button._themeManagerBound) {
            button.removeEventListener('click', toggle);
            button._themeManagerBound = false;
        }

        if (_themeSelect && _themeSelectListener) {
            _themeSelect.removeEventListener('change', _themeSelectListener);
        }
        _themeSelect = null;
        _themeSelectListener = null;
        _initialized = false;
    }

    window.ThemeManager = Object.freeze({
        init: init,
        destroy: destroy,
        toggle: toggle,
        setTheme: setTheme,
        getTheme: getTheme,
        getThemes: getThemes,
        clearPreference: clearPreference,
        nextTheme: nextTheme,
        THEMES: Object.freeze({
            DARK: 'dark', LIGHT: 'light', VAPORWAVE: 'vaporwave', PASTEL: 'pastel',
            CARNIVAL: 'carnival', MAXIMAL: 'maximal', GITS: 'gits',
            STAINED_GLASS: 'stained-glass', STAINED_GLASS_DARK: 'stained-glass-dark',
            DECO_NOUVEAU: 'deco-nouveau', GROTESQUE: 'grotesque',
            ILLUMINATED: 'illuminated', DISCOWING: 'discowing',
            CHOC_CAKE: 'choc-cake', DADA: 'dada', UKIYO_E: 'ukiyo-e',
            BRUTALIST: 'brutalist', ORCHESTRION: 'orchestrion',
            ROCOCO: 'rococo', NAUTICAL_TILE: 'nautical-tile'
        })
    });

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
