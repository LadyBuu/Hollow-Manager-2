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

    // Student mode
    registerMode('student', {
        label: 'Student',
        render: function(container, state) {
            if (window.StudentMode && typeof window.StudentMode.render === 'function') {
                window.StudentMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Student calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.StudentMode && typeof window.StudentMode.getStudents === 'function') {
                return window.StudentMode.getStudents();
            }
            return typeof window.getStudents === 'function' ? window.getStudents() : [];
        },
        getEntityDisplayName: function(entity) {
            return typeof window.getDisplayName === 'function' ? window.getDisplayName(entity) : (entity.name || 'Unknown');
        },
        getData: function(state) {
            if (window.StudentMode && typeof window.StudentMode.getSchedule === 'function') {
                return window.StudentMode.getSchedule(state);
            }
            return typeof window.getStudentSchedule === 'function'
                ? window.getStudentSchedule(state.selectedId, state.week)
                : {};
        }
    });

    // Instructor mode
    registerMode('instructor', {
        label: 'Instructor',
        render: function(container, state) {
            if (window.InstructorMode && typeof window.InstructorMode.render === 'function') {
                window.InstructorMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Instructor calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.InstructorMode && typeof window.InstructorMode.getInstructors === 'function') {
                return window.InstructorMode.getInstructors();
            }
            return typeof window.getInstructors === 'function' ? window.getInstructors() : [];
        },
        getEntityDisplayName: function(entity) {
            return typeof window.getDisplayName === 'function' ? window.getDisplayName(entity) : (entity.name || 'Unknown');
        },
        getData: function(state) {
            if (window.InstructorMode && typeof window.InstructorMode.getSchedule === 'function') {
                return window.InstructorMode.getSchedule(state);
            }
            return {};
        }
    });

    // Location mode
    registerMode('location', {
        label: 'Location',
        render: function(container, state) {
            if (window.LocationMode && typeof window.LocationMode.render === 'function') {
                window.LocationMode.render(container, state);
            } else {
                container.innerHTML = '<p class="empty-state">Location calendar mode not loaded.</p>';
            }
        },
        getEntities: function() {
            if (window.LocationMode && typeof window.LocationMode.getLocations === 'function') {
                return window.LocationMode.getLocations();
            }
            return typeof window.getLocations === 'function' ? window.getLocations() : [];
        },
        getEntityDisplayName: function(entity) {
            return entity.name || 'Unknown';
        },
        getData: function(state) {
            if (window.LocationMode && typeof window.LocationMode.getSchedule === 'function') {
                return window.LocationMode.getSchedule(state);
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
