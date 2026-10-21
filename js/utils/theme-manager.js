/**
 * utils/theme-manager.js - Theme Management
 * Path: js/utils/theme-manager.js
 *
 * Manages theme switching with persistence.
 *
 * THEMES:
 *   - dark          (default; deep green)
 *   - light         (soft cream)
 *   - vaporwave     (neon pink + cyan on violet night)
 *   - pastel        (soft pastel 80s)
 *   - carnival      (gothic carnival; "The Ringmaster")
 *   - maximal       (tacky 90s sticker UI; shocking light)
 *   - gits          (cyberpunk abyss; Ghost in the Shell)
 *   - stained-glass (luminous fractured light)
 *   - art-deco      (1920s metallic luxury)
 *
 * The toggle button cycles through the themes in the order
 * above. setTheme() accepts any of the nine explicitly.
 *
 * PERSISTENCE:
 *   The preference is stored in localStorage under
 *   'hollow-manager-theme'. It is NOT part of window.data, so it
 *   is not included in any export or backup of application data.
 *
 *   Priority on load: stored preference > system preference (light
 *   or dark only) > dark.
 *
 *   clearPreference() removes the stored preference and reapplies
 *   the system preference. After clearing, the media-query
 *   listener resumes following OS changes.
 *
 * FLASH OF THE WRONG THEME:
 *   This module's init runs at DOM-ready, after the first paint.
 *   Users on non-dark themes will see the dark theme briefly on
 *   every load unless an inline script applies data-theme BEFORE
 *   the stylesheet paints. Add this to <head>, before your CSS
 *   <link> or <style>:
 *
 *     <script>
 *       (function() {
 *         try {
 *           var t = localStorage.getItem('hollow-manager-theme');
 *           if (t === 'light' || t === 'vaporwave' || 
 *               t === 'pastel' || t === 'carnival' || 
 *               t === 'maximal' || t === 'gits' ||
 *               t === 'stained-glass' || t === 'art-deco') {
 *             document.documentElement.setAttribute('data-theme', t);
 *           }
 *         } catch (e) {}
 *       })();
 *     </script>
 *
 *   This module will then apply the correct theme on init without
 *   a visible transition. The inline script does not need to know
 *   which themes exist beyond the list of attribute-based ones.
 *
 * DARK THEME AND data-theme:
 *   The dark theme is the default and is applied by REMOVING the
 *   data-theme attribute, not by setting it to "dark". Any CSS
 *   that targets `[data-theme="dark"]` will never match. If you
 *   need a dark-specific selector, target the absence of the
 *   attribute or use a body-level class.
 *
 * TOGGLE BUTTON:
 *   The toggle button (`#theme-toggle-btn`) displays the icon of
 *   the NEXT theme in the cycle. Its aria-label describes the
 *   action: "Switch to <theme> mode".
 *
 *   Button icons include VARIATION SELECTOR-15 (\uFE0E) to force
 *   text presentation on platforms that would otherwise render
 *   them as colour emoji.
 *
 * <meta name="theme-color">:
 *   When present, this meta tag is updated to match the current
 *   theme so mobile browser chrome stays consistent.
 *
 * USAGE:
 *   ThemeManager.init();          // idempotent
 *   ThemeManager.toggle();
 *   ThemeManager.setTheme('carnival');
 *   ThemeManager.getTheme();
 *   ThemeManager.clearPreference();
 */

(function() {
    'use strict';

    if (window.__themeManagerLoaded) return;
    window.__themeManagerLoaded = true;

    var STORAGE_KEY = 'hollow-manager-theme';
    var THEME_COLOR_META = 'theme-color';

    // ============================================================
    // THEME DEFINITIONS - single source of truth
    // ============================================================
    //
    // Each entry describes one theme completely:
    //   - value:      the data-theme attribute value (null = dark
    //                 is applied by removing the attribute)
    //   - isAttribute: whether setTheme should SET the attribute
    //                 (false for dark, which removes it)
    //   - icon:       the toggle icon that represents the theme
    //   - title:      the toggle tooltip
    //   - ariaLabel:  the toggle's accessible label
    //   - themeColor: the value for <meta name="theme-color">
    //
    // Adding a new theme means adding one entry here and, if it is
    // attribute-based, ensuring the CSS handles it. Nothing else
    // needs to change.

    var THEME_TABLE = [
        {
            value: 'dark',
            isAttribute: false,
            icon: '\u263E\uFE0E',           // ☾ text presentation
            title: 'Switch to dark mode',
            ariaLabel: 'Switch to dark mode',
            themeColor: '#1a1f1a'
        },
        {
            value: 'light',
            isAttribute: true,
            icon: '\u2600\uFE0E',           // ☀ text presentation
            title: 'Switch to light mode',
            ariaLabel: 'Switch to light mode',
            themeColor: '#f5f1e8'
        },
        {
            value: 'vaporwave',
            isAttribute: true,
            icon: '\u25C8\uFE0E',           // ◈ text presentation
            title: 'Switch to vaporwave mode',
            ariaLabel: 'Switch to vaporwave mode',
            themeColor: '#2d1b4e'
        },
        {
            value: 'pastel',
            isAttribute: true,
            icon: '\u273F\uFE0E',           // ✿ text presentation
            title: 'Switch to pastel mode',
            ariaLabel: 'Switch to pastel mode',
            themeColor: '#f8e8f0'
        },
        {
            value: 'carnival',
            isAttribute: true,
            icon: '\u2620\uFE0E',           // ☠ text presentation
            title: 'Switch to carnival mode',
            ariaLabel: 'Switch to carnival mode',
            themeColor: '#1a0a0a'
        },
        {
            value: 'maximal',
            isAttribute: true,
            icon: '\u2726\uFE0E',           // ✦ text presentation (four-pointed star)
            title: 'Switch to maximal mode',
            ariaLabel: 'Switch to maximal mode',
            themeColor: '#fff0fb'
        },
        {
            value: 'gits',
            isAttribute: true,
            icon: '\u25C9\uFE0E',           // ◉ text presentation (fisheye / cyber eye)
            title: 'Switch to GITS mode',
            ariaLabel: 'Switch to GITS mode',
            themeColor: '#04101a'
        },
        {
            value: 'stained-glass',
            isAttribute: true,
            icon: '\u26EA\uFE0E',           // ⛪ text presentation (Church / Cathedral)
            title: 'Switch to Stained Glass mode',
            ariaLabel: 'Switch to Stained Glass mode',
            themeColor: '#f2f7fd'
        },
        {
            value: 'art-deco',
            isAttribute: true,
            icon: '\u25C6\uFE0E',           // ◆ text presentation (Diamond / Gem)
            title: 'Switch to Art Deco mode',
            ariaLabel: 'Switch to Art Deco mode',
            themeColor: '#f4f0e6'
        }
    ];

    var THEME_BY_VALUE = Object.create(null);
    THEME_TABLE.forEach(function(entry) {
        THEME_BY_VALUE[entry.value] = entry;
    });

    var THEMES = Object.freeze({
        DARK: 'dark',
        LIGHT: 'light',
        VAPORWAVE: 'vaporwave',
        PASTEL: 'pastel',
        CARNIVAL: 'carnival',
        MAXIMAL: 'maximal',
        GITS: 'gits',
        STAINED_GLASS: 'stained-glass',
        ART_DECO: 'art-deco'
    });

    var CYCLE = THEME_TABLE.map(function(e) { return e.value; });

    // ============================================================
    // STATE
    // ============================================================

    var _currentTheme = THEMES.DARK;
    var _initialized = false;
    var _mediaQueryList = null;
    var _mediaQueryListener = null;

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function isValidTheme(theme) {
        return typeof theme === 'string' &&
               Object.prototype.hasOwnProperty.call(THEME_BY_VALUE, theme);
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

    function clearStoredPreference() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            // localStorage unavailable
        }
    }

    function getSystemPreference() {
        if (window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: light)').matches) {
            return THEMES.LIGHT;
        }
        return THEMES.DARK;
    }

    // ============================================================
    // THEME APPLICATION
    // ============================================================

    function applyTheme(theme) {
        if (!isValidTheme(theme)) {
            return;
        }

        _currentTheme = theme;
        var root = document.documentElement;
        var entry = THEME_BY_VALUE[theme];

        if (entry.isAttribute) {
            root.setAttribute('data-theme', theme);
        } else {
            root.removeAttribute('data-theme');
        }

        updateThemeColorMeta(entry);
        updateToggleButton();
        dispatchThemeChange();
    }

    function updateThemeColorMeta(entry) {
        var meta = document.querySelector('meta[name="' + THEME_COLOR_META + '"]');
        if (!meta) return;
        if (entry && entry.themeColor) {
            meta.setAttribute('content', entry.themeColor);
        }
    }

    function updateToggleButton() {
        var btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;

        var next = nextTheme();
        var entry = THEME_BY_VALUE[next];
        if (!entry) return;

        btn.textContent = entry.icon;
        btn.title = entry.title;
        btn.setAttribute('aria-label', entry.ariaLabel);
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
    // MEDIA QUERY LISTENER
    // ============================================================

    function attachMediaQueryListener() {
        if (!window.matchMedia) return;
        if (_mediaQueryList) return;

        _mediaQueryList = window.matchMedia('(prefers-color-scheme: light)');

        _mediaQueryListener = function(e) {
            // Only react if there is no stored preference; a user
            // who has toggled keeps their choice.
            if (loadThemePreference()) return;
            // Only react while we are still in a light/dark state;
            // don't clobber an opt-in theme.
            if (_currentTheme !== THEMES.DARK &&
                _currentTheme !== THEMES.LIGHT) {
                return;
            }
            applyTheme(e.matches ? THEMES.LIGHT : THEMES.DARK);
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

    /**
     * Remove the stored preference and reapply the system
     * preference. After this call, the media-query listener will
     * react to OS changes again.
     */
    function clearPreference() {
        clearStoredPreference();
        applyTheme(getSystemPreference());
    }

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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ThemeManager = Object.freeze({
        init: init,
        destroy: destroy,
        toggle: toggle,
        setTheme: setTheme,
        getTheme: getTheme,
        clearPreference: clearPreference,
        nextTheme: nextTheme,
        THEMES: THEMES
    });

    // Auto-init on DOM ready
    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
