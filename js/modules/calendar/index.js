/**
 * js/modules/calendar/index.js - Unified Calendar Entry Point
 * Single entry point for all calendar functionality
 * Path: js/modules/calendar/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the calendar container
 *   - Initializing the CalendarUI controller
 *   - Managing calendar lifecycle
 *   - Restoring state from sessionStorage and URL hash
 * 
 * LIFECYCLE:
 *   TabManager registers 'calendar' -> renderCalendar() -> CalendarUI.init()
 *   Tab switching -> renderCalendar() -> CalendarUI.render()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for calendar
 *   - All calendar logic lives in calendar/ subdirectory
 *   - This module does NOT implement calendar logic directly
 *   - It uses CalendarModes registry for ALL mode validation
 *   - TabManager is the single source of truth for lifecycle
 * 
 * DEPENDENCIES:
 *   - window.CalendarUI (from calendar-ui.js)
 *   - window.CalendarModes (from modes/index.js)
 *   - window.CalendarUtils (from calendar-utils.js)
 *   - window.CalendarRenderer (from calendar-renderer.js)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CalendarUI || typeof window.CalendarUI.init !== 'function') {
        return;
    }

    if (!window.CalendarModes || typeof window.CalendarModes.hasMode !== 'function') {
        return;
    }

    if (!window.CalendarUtils) {
        return;
    }

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.renderGrid !== 'function') {
        return;
    }

    if (!window.TabManager || typeof window.TabManager.register !== 'function') {
        return;
    }

    window.__calendarModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CalendarUI = window.CalendarUI;
    var CalendarModes = window.CalendarModes;
    var CalendarUtils = window.CalendarUtils;
    var CalendarRenderer = window.CalendarRenderer;
    var TabManager = window.TabManager;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarUtils.MIN_WEEK || 1;
    var MAX_WEEK = CalendarUtils.MAX_WEEK || 52;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;

    // ============================================================
    // RENDER CALENDAR - Public API
    // ============================================================

    function renderCalendar(container) {
        if (!container) {
            container = document.getElementById('tab-calendar');
        }

        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading calendar data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                // Ensure curriculum is non-critical for display
            }
        }

        if (!_initialized || _container !== container) {
            _container = container;
            _initialized = true;

            container.innerHTML = getCalendarContainerHTML();

            var options = getInitialOptions();

            CalendarUI.init(container, options, {
                onStateChange: function() {
                    saveState();
                }
            });
        } else {
            CalendarUI.render();
        }
    }

    // ============================================================
    // DESTROY CALENDAR - Clean up event listeners
    // ============================================================

    function destroyCalendar() {
        if (CalendarUI && typeof CalendarUI.destroy === 'function') {
            CalendarUI.destroy();
        }
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // CALENDAR CONTAINER HTML
    // ============================================================

    function getCalendarContainerHTML() {
        return (
            '<div class="calendar-container">' +
                '<div id="calendar-content">' +
                    '<p class="empty-state">Loading calendar...</p>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // MODE VALIDATION - REGISTRY IS THE SOURCE OF TRUTH
    // ============================================================

    function isValidMode(mode) {
        if (!CalendarModes) {
            return false;
        }
        return CalendarModes.hasMode(mode);
    }

    // ============================================================
    // SELECTED ID VALIDATION
    // ============================================================

    function isValidSelectedId(modeName, id) {
        if (id === null || id === undefined) {
            return false;
        }

        if (!CalendarModes) {
            return false;
        }

        var mode = CalendarModes.getMode(modeName);
        if (!mode || typeof mode.getEntities !== 'function') {
            return false;
        }

        var entities = mode.getEntities() || [];
        for (var i = 0; i < entities.length; i++) {
            if (String(entities[i].id) === String(id)) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // GET FIRST AVAILABLE ID
    // ============================================================

    function getFirstAvailableId(modeName) {
        if (!CalendarModes) {
            return null;
        }

        var mode = CalendarModes.getMode(modeName);
        if (!mode || typeof mode.getEntities !== 'function') {
            return null;
        }

        var entities = mode.getEntities() || [];
        return entities.length > 0 ? entities[0].id : null;
    }

    // ============================================================
    // INITIAL OPTIONS
    // ============================================================

    function getInitialOptions() {
        var options = {
            mode: 'student',
            week: 1,
            selectedId: null
        };

        // Priority 1: sessionStorage (user's last session)
        try {
            var saved = sessionStorage.getItem('calendar_state');
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed.mode && isValidMode(parsed.mode)) {
                    options.mode = parsed.mode;
                }
                if (parsed.week !== undefined && parsed.week !== null) {
                    var week = parseInt(parsed.week, 10);
                    if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId !== undefined && parsed.selectedId !== null) {
                    options.selectedId = parsed.selectedId;
                }
            }
        } catch (_) {
            // Ignore storage errors
        }

        // Priority 2: URL hash (overrides session)
        try {
            var hash = window.location.hash;
            if (hash) {
                var queryIndex = hash.indexOf('?');
                if (queryIndex !== -1) {
                    var params = new URLSearchParams(hash.substring(queryIndex + 1));
                    var modeParam = params.get('mode');
                    if (modeParam && isValidMode(modeParam)) {
                        options.mode = modeParam;
                    }
                    var weekParam = params.get('week');
                    if (weekParam !== null) {
                        var week = parseInt(weekParam, 10);
                        if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                            options.week = week;
                        }
                    }
                    var idParam = params.get('id');
                    if (idParam !== null) {
                        options.selectedId = idParam;
                    }
                }
            }
        } catch (_) {
            // Ignore URL parsing errors
        }

        // Priority 3: validate selectedId against current mode
        if (options.selectedId !== null && options.selectedId !== undefined) {
            if (!isValidSelectedId(options.mode, options.selectedId)) {
                options.selectedId = null;
            }
        }

        // Priority 4: auto-select first available
        if (!options.selectedId) {
            var firstId = getFirstAvailableId(options.mode);
            if (firstId) {
                options.selectedId = firstId;
            }
        }

        return options;
    }

    // ============================================================
    // SAVE STATE
    // ============================================================

    function saveState() {
        if (!CalendarUI || typeof CalendarUI.getState !== 'function') {
            return;
        }

        var state = CalendarUI.getState();

        try {
            sessionStorage.setItem('calendar_state', JSON.stringify(state));
        } catch (_) {
            // Ignore storage errors
        }

        try {
            var hash = window.location.hash || '';
            var base = hash.split('?')[0];
            if (base.charAt(0) === '#') {
                base = base.substring(1);
            }

            var query = 'mode=' + encodeURIComponent(state.mode) +
                        '&week=' + encodeURIComponent(state.week);

            if (state.selectedId) {
                query += '&id=' + encodeURIComponent(state.selectedId);
            }

            var newHash = '#' + base + '?' + query;

            if (window.location.hash !== newHash) {
                window.history.replaceState(null, '', newHash);
            }
        } catch (_) {
            // Ignore history errors
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    TabManager.register('calendar', renderCalendar);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderCalendar = renderCalendar;
    window.destroyCalendar = destroyCalendar;

})();
