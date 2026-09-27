/**
 * utils/theme-manager.js - Theme Management
 * Path: js/utils/theme-manager.js
 *
 * Manages light/dark theme switching with persistence.
 *
 * FEATURES:
 *   - Toggle between light and dark themes
 *   - Persists preference to localStorage
 *   - Respects system preference on first visit
 *   - Updates all UI elements that need to know the theme
 *
 * USAGE:
 *   ThemeManager.init();
 *   ThemeManager.toggle();
 *   ThemeManager.setTheme('light');
 *   ThemeManager.getTheme(); // 'light' | 'dark'
 */

(function() {
    'use strict';

    if (window.__themeManagerLoaded) return;
    window.__themeManagerLoaded = true;

    var STORAGE_KEY = 'hollow-manager-theme';
    var THEMES = { LIGHT: 'light', DARK: 'dark' };
    var _currentTheme = THEMES.DARK;

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function loadThemePreference() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored === THEMES.LIGHT || stored === THEMES.DARK) {
                return stored;
            }
        } catch (e) {
            // localStorage unavailable
        }
        return null;
    }

    function saveThemePreference(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {
            // localStorage unavailable
        }
    }

    function getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return THEMES.LIGHT;
        }
        return THEMES.DARK;
    }

    // ============================================================
    // THEME APPLICATION
    // ============================================================

    function applyTheme(theme) {
        _currentTheme = theme;
        var root = document.documentElement;

        if (theme === THEMES.LIGHT) {
            root.setAttribute('data-theme', 'light');
        } else {
            root.removeAttribute('data-theme');
        }

        updateToggleButton();
        dispatchThemeChange();
    }

    function updateToggleButton() {
        var btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;

        if (_currentTheme === THEMES.LIGHT) {
            btn.textContent = '☾';
            btn.title = 'Switch to dark mode';
            btn.setAttribute('aria-label', 'Switch to dark mode');
        } else {
            btn.textContent = '☀';
            btn.title = 'Switch to light mode';
            btn.setAttribute('aria-label', 'Switch to light mode');
        }
    }

    function dispatchThemeChange() {
        try {
            document.dispatchEvent(new CustomEvent('themeChanged', {
                detail: { theme: _currentTheme }
            }));
        } catch (e) {
            // Ignore
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function setTheme(theme) {
        if (theme !== THEMES.LIGHT && theme !== THEMES.DARK) {
            return;
        }
        applyTheme(theme);
        saveThemePreference(theme);
    }

    function toggle() {
        var next = _currentTheme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
        setTheme(next);
    }

    function getTheme() {
        return _currentTheme;
    }

    function init() {
        // Priority: stored preference > system preference > dark
        var stored = loadThemePreference();
        var theme = stored || getSystemPreference();
        applyTheme(theme);

        // Bind toggle button
        var btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.addEventListener('click', toggle);
        }

        // Listen for system preference changes (only if no stored preference)
        if (window.matchMedia) {
            var mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
            mediaQuery.addEventListener('change', function(e) {
                if (!loadThemePreference()) {
                    applyTheme(e.matches ? THEMES.LIGHT : THEMES.DARK);
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ThemeManager = {
        init: init,
        toggle: toggle,
        setTheme: setTheme,
        getTheme: getTheme,
        THEMES: THEMES
    };

    // Auto-init on DOM ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
