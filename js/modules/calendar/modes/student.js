/**
 * js/modules/calendar/modes/student.js - Student Calendar Mode
 * Wraps the existing schedule.js functionality
 * Path: js/modules/calendar/modes/student.js
 */

(function() {
    'use strict';

    if (window.__studentCalendarModeLoaded) {
        return;
    }
    window.__studentCalendarModeLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            { name: 'getStudentSchedule', fn: window.getStudentSchedule },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline }
        ];

        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function') {
                missing.push(required[i].name);
            }
        }

        if (missing.length > 0) {
            console.warn('[StudentCalendarMode] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getStudents() {
        return typeof window.getStudents === 'function' ? window.getStudents() : [];
    }

    function getSchedule(state) {
        if (!state || !state.selectedId) {
            return {};
        }
        return typeof window.getStudentSchedule === 'function'
            ? window.getStudentSchedule(state.selectedId, state.week)
            : {};
    }

    function render(container, state) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Student calendar dependencies not loaded.</p>';
            return;
        }

        // This is the core rendering logic from schedule.js
        // We'll gradually move it here, keeping the existing schedule.js
        // as a temporary wrapper until all functionality is migrated.
        // For now, use the existing renderStudentScheduleView function.
        if (typeof window.renderStudentScheduleView === 'function') {
            // We need to render into the container, but the existing function
            // expects to find its own containers. We'll pass the container
            // and let it render.
            window.renderStudentScheduleView(container);
        } else {
            container.innerHTML = '<p class="empty-state">Student schedule view not available.</p>';
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('student', {
            label: 'Student',
            render: render,
            getEntities: getStudents,
            getEntityDisplayName: function(entity) {
                return typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(entity)
                    : (entity.name || 'Unknown');
            },
            getData: getSchedule
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.StudentCalendarMode = {
        render: render,
        getStudents: getStudents,
        getSchedule: getSchedule
    };

})();
