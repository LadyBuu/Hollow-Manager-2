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

    // Guard against duplicate loading
    if (window.__calendarModuleLoaded) {
        return;
    }
    window.__calendarModuleLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    if (!window.CalendarUI) {
        console.error('Calendar module: CalendarUI is not available.');
        return;
    }

    if (typeof window.TabManager === 'undefined') {
        console.error('Calendar module: TabManager is not available.');
        return;
    }

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
            console.error('Calendar: No container found.');
            return;
        }

        // Check data
        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading calendar data...</p>';
            return;
        }

        // Ensure curriculum structure exists
        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        // Check if we need to reinitialize or just re-render
        if (!_initialized || _container !== container) {
            _container = container;
            _initialized = true;

            // Build container HTML
            container.innerHTML = getCalendarContainerHTML();

            // Initialize CalendarUI
            var options = getInitialOptions();
            CalendarUI.init(container, options);
        } else {
            // Just re-render
            CalendarUI.render();
        }
    }

    // ============================================================
    // CALENDAR CONTAINER HTML
    // ============================================================

    function getCalendarContainerHTML() {
        return `
            <div class="calendar-container">
                <div id="calendar-content">
                    <p class="empty-state">Loading calendar...</p>
                </div>
            </div>
        `;
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

        // Try to restore from URL hash
        var hash = window.location.hash;
        if (hash) {
            var params = hash.split('?');
            if (params.length > 1) {
                var query = params[1];
                var pairs = query.split('&');
                pairs.forEach(function(pair) {
                    var parts = pair.split('=');
                    if (parts.length === 2) {
                        var key = parts[0];
                        var value = decodeURIComponent(parts[1]);
                        if (key === 'mode' && ['student', 'instructor', 'location'].indexOf(value) !== -1) {
                            options.mode = value;
                        }
                        if (key === 'week') {
                            var week = parseInt(value);
                            if (!isNaN(week) && week >= 1 && week <= 52) {
                                options.week = week;
                            }
                        }
                        if (key === 'id') {
                            options.selectedId = value;
                        }
                    }
                });
            }
        }

        // Try to restore from session storage
        try {
            var saved = sessionStorage.getItem('calendar_state');
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed.mode && ['student', 'instructor', 'location'].indexOf(parsed.mode) !== -1) {
                    options.mode = parsed.mode;
                }
                if (parsed.week) {
                    var week = parseInt(parsed.week);
                    if (!isNaN(week) && week >= 1 && week <= 52) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId) {
                    options.selectedId = parsed.selectedId;
                }
            }
        } catch (e) {
            // Ignore
        }

        // Auto-select first available item if no ID
        if (!options.selectedId) {
            var firstId = getFirstAvailableId(options.mode);
            if (firstId) {
                options.selectedId = firstId;
            }
        }

        return options;
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
        if (!CalendarUI || typeof CalendarUI.getState !== 'function') {
            return;
        }

        var state = CalendarUI.getState();
        try {
            sessionStorage.setItem('calendar_state', JSON.stringify(state));
        } catch (e) {
            // Ignore
        }

        // Update URL hash
        try {
            var base = window.location.hash.split('?')[0];
            var query = 'mode=' + state.mode + '&week=' + state.week;
            if (state.selectedId) {
                query += '&id=' + encodeURIComponent(state.selectedId);
            }
            var newHash = base + '?' + query;
            if (window.location.hash !== newHash) {
                window.history.replaceState(null, '', '#' + newHash);
            }
        } catch (e) {
            // Ignore
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

    // Save state on page unload
    window.addEventListener('beforeunload', function() {
        saveState();
    });

    // Auto-render if data already loaded
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
