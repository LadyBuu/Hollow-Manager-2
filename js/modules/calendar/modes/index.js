/**
 * js/modules/calendar/modes/index.js - Calendar Mode Registry
 * Registers all calendar modes and provides factory functions
 * Path: js/modules/calendar/modes/index.js
 */

(function() {
    'use strict';

    // Prevent duplicate loading
    if (window.__calendarModesLoaded) {
        return;
    }
    window.__calendarModesLoaded = true;

    // ============================================================
    // MODE REGISTRY
    // ============================================================

    var modes = {};

    function registerMode(name, mode) {
        if (modes[name]) {
            console.warn('[CalendarModes] Mode "' + name + '" already registered. Overwriting.');
        }
        modes[name] = mode;
    }

    function getMode(name) {
        return modes[name] || null;
    }

    function getModeNames() {
        return Object.keys(modes);
    }

    function getModeOptions() {
        var options = [];
        for (var name in modes) {
            if (Object.prototype.hasOwnProperty.call(modes, name)) {
                options.push({
                    value: name,
                    label: modes[name].label || name.charAt(0).toUpperCase() + name.slice(1)
                });
            }
        }
        return options;
    }

    // ============================================================
    // REGISTER MODES
    // ============================================================

    // Student mode (from schedule.js)
    registerMode('student', {
        label: 'Student',
        render: function(container, state) {
            if (window.StudentCalendarMode && typeof window.StudentCalendarMode.render === 'function') {
                window.StudentCalendarMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Student calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.StudentCalendarMode && typeof window.StudentCalendarMode.getStudents === 'function') {
                return window.StudentCalendarMode.getStudents();
            }
            return typeof window.getStudents === 'function' ? window.getStudents() : [];
        },
        getEntityDisplayName: function(entity) {
            return typeof window.getDisplayName === 'function' ? window.getDisplayName(entity) : (entity.name || 'Unknown');
        },
        getData: function(state) {
            if (window.StudentCalendarMode && typeof window.StudentCalendarMode.getSchedule === 'function') {
                return window.StudentCalendarMode.getSchedule(state);
            }
            return typeof window.getStudentSchedule === 'function'
                ? window.getStudentSchedule(state.selectedId, state.week)
                : {};
        }
    });

    // Instructor mode (from instructor-calendar.js)
    registerMode('instructor', {
        label: 'Instructor',
        render: function(container, state) {
            if (window.InstructorCalendarMode && typeof window.InstructorCalendarMode.render === 'function') {
                window.InstructorCalendarMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Instructor calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.InstructorCalendarMode && typeof window.InstructorCalendarMode.getInstructors === 'function') {
                return window.InstructorCalendarMode.getInstructors();
            }
            return typeof window.getInstructors === 'function' ? window.getInstructors() : [];
        },
        getEntityDisplayName: function(entity) {
            return typeof window.getDisplayName === 'function' ? window.getDisplayName(entity) : (entity.name || 'Unknown');
        },
        getData: function(state) {
            if (window.InstructorCalendarMode && typeof window.InstructorCalendarMode.getSchedule === 'function') {
                return window.InstructorCalendarMode.getSchedule(state);
            }
            return {};
        }
    });

    // Location mode (from location-schedule.js)
    registerMode('location', {
        label: 'Location',
        render: function(container, state) {
            if (window.LocationCalendarMode && typeof window.LocationCalendarMode.render === 'function') {
                window.LocationCalendarMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Location calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.LocationCalendarMode && typeof window.LocationCalendarMode.getLocations === 'function') {
                return window.LocationCalendarMode.getLocations();
            }
            return typeof window.getLocations === 'function' ? window.getLocations() : [];
        },
        getEntityDisplayName: function(entity) {
            return entity.name || 'Unknown';
        },
        getData: function(state) {
            if (window.LocationCalendarMode && typeof window.LocationCalendarMode.getSchedule === 'function') {
                return window.LocationCalendarMode.getSchedule(state);
            }
            return typeof window.getLocationSchedule === 'function'
                ? window.getLocationSchedule(state.selectedId, state.week)
                : {};
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarModes = {
        registerMode: registerMode,
        getMode: getMode,
        getModeNames: getModeNames,
        getModeOptions: getModeOptions
    };

})();
