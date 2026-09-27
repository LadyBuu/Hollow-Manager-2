/**
 * utils/theme-manager.js - Theme Management
 * Path: js/utils/theme-manager.js
 *
 * Manages theme switching with persistence.
 *
 * THEMES:
 *   - dark       (default; deep green)
 *   - light      (soft cream; easy on the eyes)
 *   - vaporwave  (neon pink + cyan on violet night)
 *   - pastel     (pastel 80s magical girl; soft pink/lavender)
 *   - carnival   (demented gothic carnival; "The Ringmaster")
 *
 * The toggle button cycles dark -> light -> vaporwave -> pastel
 * -> carnival -> dark. setTheme() accepts any of the five
 * explicitly.
 *
 * FEATURES:
 *   - Cycles through all five themes
 *   - Persists preference to localStorage
 *   - Respects system preference on first visit
 *   - Updates all UI elements that need to know the theme
 *
 * USAGE:
 *   ThemeManager.init();
 *   ThemeManager.toggle();
 *   ThemeManager.setTheme('carnival');
 *   ThemeManager.getTheme(); // 'light' | 'dark' | 'vaporwave' | 'pastel' | 'carnival'
 */

(function() {
    'use strict';

    if (window.__themeManagerLoaded) return;
    window.__themeManagerLoaded = true;

    var STORAGE_KEY = 'hollow-manager-theme';
    var THEMES = {
        LIGHT: 'light',
        DARK: 'dark',
        VAPORWAVE: 'vaporwave',
        PASTEL: 'pastel',
        CARNIVAL: 'carnival'
    };
    // Order the toggle cycles through.
    var CYCLE = [
        THEMES.DARK,
        THEMES.LIGHT,
        THEMES.VAPORWAVE,
        THEMES.PASTEL,
        THEMES.CARNIVAL
    ];

    // Themes that are applied via the `data-theme` attribute.
    // 'dark' is the default and is applied by REMOVING the attribute.
    var ATTRIBUTE_THEMES = [
        THEMES.LIGHT,
        THEMES.VAPORWAVE,
        THEMES.PASTEL,
        THEMES.CARNIVAL
    ];

    var _currentTheme = THEMES.DARK;

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function isValidTheme(theme) {
        return theme === THEMES.LIGHT ||
               theme === THEMES.DARK ||
               theme === THEMES.VAPORWAVE ||
               theme === THEMES.PASTEL ||
               theme === THEMES.CARNIVAL;
    }

    function loadThemePreference() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (isValidTheme(stored)) {
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
        // Only meaningful for the dark/light binary; vaporwave,
        // pastel, and carnival are opt-in and never chosen from
        // system preference.
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

        if (ATTRIBUTE_THEMES.indexOf(theme) !== -1) {
            root.setAttribute('data-theme', theme);
        } else {
            root.removeAttribute('data-theme');
        }

        updateToggleButton();
        dispatchThemeChange();
    }

    function updateToggleButton() {
        var btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;

        // The icon previews the NEXT theme in the cycle.
        var next = nextTheme();
        if (next === THEMES.LIGHT) {
            btn.textContent = '☀';
            btn.title = 'Switch to light mode';
            btn.setAttribute('aria-label', 'Switch to light mode');
        } else if (next === THEMES.VAPORWAVE) {
            btn.textContent = '◈';
            btn.title = 'Switch to vaporwave mode';
            btn.setAttribute('aria-label', 'Switch to vaporwave mode');
        } else if (next === THEMES.PASTEL) {
            btn.textContent = '✿';
            btn.title = 'Switch to pastel mode';
            btn.setAttribute('aria-label', 'Switch to pastel mode');
        } else if (next === THEMES.CARNIVAL) {
            btn.textContent = '☠';
            btn.title = 'Switch to carnival mode';
            btn.setAttribute('aria-label', 'The Ringmaster');
        } else {
            btn.textContent = '☾';
            btn.title = 'Switch to dark mode';
            btn.setAttribute('aria-label', 'Switch to dark mode');
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
        if (!isValidTheme(theme)) {
            return;
        }
        applyTheme(theme);
        saveThemePreference(theme);
    }

    function nextTheme() {
        var idx = CYCLE.indexOf(_currentTheme);
        if (idx === -1) idx = 0;
        return CYCLE[(idx + 1) % CYCLE.length];
    }

    function toggle() {
        setTheme(nextTheme());
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
