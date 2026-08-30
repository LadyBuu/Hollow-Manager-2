/**
 * modules/calendar/index.js - Unified Calendar Entry Point
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
 *   TabManager registers 'calendar' → renderCalendar() → CalendarUI.init()
 *   Tab switching → renderCalendar() → CalendarUI.render()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for calendar
 *   - All calendar logic lives in calendar/ subdirectory
 *   - This module does NOT implement calendar logic directly
 *   - It uses CalendarModes registry for ALL mode validation
 *   - All core functions are from the curriculum modules
 *   - This module delegates to curriculum modules for data operations
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCIES (MUST BE CHECKED FIRST)
    // ============================================================

    if (!window.CalendarUI) {
        console.error('CalendarModule: CalendarUI not loaded.');
        return;
    }

    if (typeof window.TabManager === 'undefined') {
        console.error('CalendarModule: TabManager not loaded.');
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING (AFTER DEPENDENCIES)
    // ============================================================

    if (window.__calendarModuleLoaded) {
        return;
    }
    window.__calendarModuleLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CalendarUI = window.CalendarUI;
    var CalendarModes = window.CalendarModes;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Core curriculum dependencies
        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getLocations !== 'function') {
            missing.push('getLocations');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (missing.length > 0) {
            console.warn('CalendarModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _stateRestored = false;

    // ============================================================
    // RENDER CALENDAR - Public API
    // ============================================================

    function renderCalendar(container) {
        if (!container) {
            container = document.getElementById('tab-calendar');
        }

        if (!container) {
            console.warn('CalendarModule: Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading calendar data...</p>';
            return;
        }

        // Ensure curriculum schema exists
        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        // Validate dependencies
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Calendar dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Initialize or re-render
        if (!_initialized || _container !== container) {
            _container = container;
            _initialized = true;

            container.innerHTML = getCalendarContainerHTML();

            // Get initial state from sessionStorage and URL
            var options = getInitialOptions();

            // Initialize CalendarUI with callbacks
            CalendarUI.init(container, options, {
                onStateChange: function() {
                    saveState();
                }
            });
        } else {
            // Just re-render the existing UI
            CalendarUI.render();
        }
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
    // INITIAL OPTIONS - Restore from sessionStorage and URL
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
                    if (!isNaN(week) && week >= 1 && week <= 52) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId !== undefined && parsed.selectedId !== null) {
                    options.selectedId = parsed.selectedId;
                }
                _stateRestored = true;
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
                        if (!isNaN(week) && week >= 1 && week <= 52) {
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
    // MODE VALIDATION - REGISTRY IS THE SOURCE OF TRUTH
    // ============================================================

    function isValidMode(mode) {
        if (!CalendarModes) {
            return false;
        }
        if (typeof CalendarModes.hasMode === 'function') {
            return CalendarModes.hasMode(mode);
        }
        return false;
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
    // SAVE STATE - Persist to sessionStorage and URL
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
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('calendar', renderCalendar);
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    // When data is ready, render the calendar if it's visible
    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-calendar');
        if (container && container.style.display !== 'none') {
            renderCalendar(container);
        }
    });

    // When tab changes, render or save state
    document.addEventListener('tabChanged', function(e) {
        if (!e || !e.detail) {
            return;
        }

        if (e.detail.tab === 'calendar') {
            var container = document.getElementById('tab-calendar');
            if (container) {
                renderCalendar(container);
            }
        } else if (_initialized) {
            saveState();
        }
    });

    // Save state before unloading
    window.addEventListener('beforeunload', function() {
        if (_initialized) {
            saveState();
        }
    });

    // Handle hash changes - update state without saving
    window.addEventListener('hashchange', function() {
        if (!_initialized) {
            return;
        }

        var hash = window.location.hash;
        if (hash) {
            var queryIndex = hash.indexOf('?');
            if (queryIndex !== -1) {
                var params = new URLSearchParams(hash.substring(queryIndex + 1));
                var modeParam = params.get('mode');
                var weekParam = params.get('week');
                var idParam = params.get('id');

                var newState = {};
                var changed = false;

                if (modeParam && isValidMode(modeParam) && modeParam !== CalendarUI.getState().mode) {
                    newState.mode = modeParam;
                    changed = true;
                }

                if (weekParam !== null) {
                    var week = parseInt(weekParam, 10);
                    if (!isNaN(week) && week >= 1 && week <= 52 && week !== CalendarUI.getState().week) {
                        newState.week = week;
                        changed = true;
                    }
                }

                if (idParam !== null && idParam !== CalendarUI.getState().selectedId) {
                    if (isValidSelectedId(modeParam || CalendarUI.getState().mode, idParam)) {
                        newState.selectedId = idParam;
                        changed = true;
                    }
                }

                if (changed) {
                    CalendarUI.setState(newState);
                }
            }
        }
    });

    // ============================================================
    // AUTO-INITIALIZE IF DATA ALREADY AVAILABLE
    // ============================================================

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-calendar');
            if (container && container.style.display !== 'none') {
                renderCalendar(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderCalendar = renderCalendar;

})();
