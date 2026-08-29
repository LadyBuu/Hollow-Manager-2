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
 * 
 * LIFECYCLE:
 *   TabManager registers 'calendar' → renderCalendar() → CalendarUI.init()
 *   Tab switching → renderCalendar() → CalendarUI.render()
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCIES (MUST BE CHECKED FIRST)
    // ============================================================

    if (!window.CalendarUI) {
        return;
    }

    if (typeof window.TabManager === 'undefined') {
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
            window.ensureCurriculum();
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
                if (parsed.mode && hasValidMode(parsed.mode)) {
                    options.mode = parsed.mode;
                }
                if (parsed.week) {
                    var week = parseInt(parsed.week, 10);
                    if (!isNaN(week) && week >= 1 && week <= 52) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId) {
                    options.selectedId = parsed.selectedId;
                }
            }
        } catch (_) {
            // Ignore storage errors
        }

        // Priority 2: URL hash (overrides session)
        var hash = window.location.hash;
        if (hash) {
            var params = hash.split('?');
            if (params.length > 1) {
                var query = params[1];
                var pairs = query.split('&');
                for (var i = 0; i < pairs.length; i++) {
                    var pair = pairs[i];
                    var separator = pair.indexOf('=');
                    if (separator === -1) continue;
                    var key = pair.substring(0, separator);
                    var value = decodeURIComponent(pair.substring(separator + 1));
                    if (key === 'mode' && hasValidMode(value)) {
                        options.mode = value;
                    }
                    if (key === 'week') {
                        var week = parseInt(value, 10);
                        if (!isNaN(week) && week >= 1 && week <= 52) {
                            options.week = week;
                        }
                    }
                    if (key === 'id') {
                        options.selectedId = value;
                    }
                }
            }
        }

        // Priority 3: auto-select first available
        if (!options.selectedId) {
            var firstId = getFirstAvailableId(options.mode);
            if (firstId) {
                options.selectedId = firstId;
            }
        }

        return options;
    }

    function hasValidMode(mode) {
        if (!window.CalendarModes) return false;
        if (typeof window.CalendarModes.hasMode === 'function') {
            return window.CalendarModes.hasMode(mode);
        }
        return mode === 'student' || mode === 'instructor' || mode === 'location';
    }

    function getFirstAvailableId(mode) {
        switch (mode) {
            case 'student': {
                var students = getStudents();
                return students.length > 0 ? students[0].id : null;
            }
            case 'instructor': {
                var instructors = getInstructors();
                return instructors.length > 0 ? instructors[0].id : null;
            }
            case 'location': {
                var locations = getLocations();
                return locations.length > 0 ? locations[0].id : null;
            }
            default:
                return null;
        }
    }

    // ============================================================
    // DATA ACCESS
    // ============================================================

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }
        return [];
    }

    function getInstructors() {
        if (typeof window.getInstructors === 'function') {
            return window.getInstructors();
        }
        return [];
    }

    function getLocations() {
        if (typeof window.getLocations === 'function') {
            return window.getLocations();
        }
        return [];
    }

    // ============================================================
    // SAVE STATE
    // ============================================================

    function saveState() {
        if (!window.CalendarUI || typeof window.CalendarUI.getState !== 'function') {
            return;
        }

        var state = window.CalendarUI.getState();

        try {
            sessionStorage.setItem('calendar_state', JSON.stringify(state));
        } catch (_) {
            // Ignore storage errors
        }

        try {
            var base = window.location.hash.split('?')[0];
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

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-calendar');
        if (container && container.style.display !== 'none') {
            renderCalendar(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'calendar') {
            var container = document.getElementById('tab-calendar');
            if (container) {
                renderCalendar(container);
            }
        } else {
            saveState();
        }
    });

    window.addEventListener('beforeunload', function() {
        saveState();
    });

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
