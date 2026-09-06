/**
 * modules/calendar/views/instructor-view.js - Instructor View
 * Instructor-specific rendering and modal content
 * Path: js/modules/calendar/views/instructor-view.js
 * 
 * This module provides:
 *   - renderInstructorSidebar - Instructor sidebar HTML
 *   - renderClassDetailsModal - Class details modal content
 *   - renderBlockDetailsModal - Block details modal content
 *   - renderManageStudentsModal - Manage students modal content
 *   - renderAddClassModal - Add class modal content
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses query modules
 *   - Uses DomUtils for safe DOM operations
 *   - Uses CalendarRenderer for shared modal creation
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to InstructorMode)
 * 
 * DEPENDENCIES:
 *   - window.InstructorQueries (from queries/instructor-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CalendarRenderer (from calendar-renderer.js) - MANDATORY
 *   - window.CalendarUtils (from calendar-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var IV = window.InstructorView;
 *   var html = IV.renderInstructorSidebar(instructorId, week);
 *   IV.renderClassDetailsModal(data, callbacks);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__instructorViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.InstructorQueries || typeof window.InstructorQueries.getInstructorSchedule !== 'function') {
        missing.push('InstructorQueries.getInstructorSchedule');
    }
    if (!window.InstructorQueries || typeof window.InstructorQueries.getInstructorUsage !== 'function') {
        missing.push('InstructorQueries.getInstructorUsage');
    }
    if (!window.InstructorQueries || typeof window.InstructorQueries.getAvailableDisciplines !== 'function') {
        missing.push('InstructorQueries.getAvailableDisciplines');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.createDetailsModal !== 'function') {
        missing.push('CalendarRenderer.createDetailsModal');
    }
    if (!window.CalendarRenderer || typeof window.CalendarRenderer.createManageStudentsModal !== 'function') {
        missing.push('CalendarRenderer.createManageStudentsModal');
    }
    if (!window.CalendarRenderer || typeof window.CalendarRenderer.showNotification !== 'function') {
        missing.push('CalendarRenderer.showNotification');
    }

    if (!window.CalendarUtils || typeof window.CalendarUtils.formatHour !== 'function') {
        missing.push('CalendarUtils.formatHour');
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        console.error('[InstructorView] Missing dependencies:', missing.join(', '));
        return;
    }

    window.__instructorViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var InstructorQueries = window.InstructorQueries;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarRenderer = window.CalendarRenderer;
    var CalendarUtils = window.CalendarUtils;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // SIDEBAR RENDER
    // ============================================================

    /**
     * Render instructor sidebar HTML.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {string} Sidebar HTML
     */
    function renderInstructorSidebar(instructorId, week) {
        var usage = InstructorQueries.getInstructorUsage(instructorId, week);
        var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);

        var templateCount = 0;
        var blockCount = 0;
        var studentCount = 0;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var slot = daySchedule[hour];
                if (!slot) {
                    continue;
                }

                if (slot.isBlock) {
                    blockCount++;
                } else {
                    templateCount++;
                    if (slot.students) {
                        studentCount += slot.students.length;
                    }
                }
            }
        }

        var html = '';
        html += '<div class="sidebar-section">';
        html += '<h4>Instructor Stats</h4>';
        html += '<div style="font-size:0.8rem;color:var(--text-dim);">';
        html += '<div>Class Templates: <strong>' + templateCount + '</strong></div>';
        html += '<div>Blocked Time: <strong>' + blockCount + '</strong> slots</div>';
        html += '<div>Assigned Students: <strong>' + studentCount + '</strong></div>';
        html += '<div>Total Hours: <strong>' + usage.totalHours + '</strong></div>';
        html += '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Right-click a slot to remove it.';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    /**
     * Render class details modal.
     * 
     * @param {object} data - Class data from InstructorQueries.getClassDetails
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onEdit - Called when edit button is clicked
     * @param {function} callbacks.onRemove - Called when remove button is clicked
     * @param {function} callbacks.onManageStudents - Called when manage students button is clicked
     * @param {function} callbacks.onClose - Called when modal is closed
     */
    function renderClassDetailsModal(data, callbacks) {
        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        callbacks = callbacks || {};

        var details = [
            { label: 'Day/Time', value: data.dayName + ' at ' + data.hourDisplay },
            { label: 'Duration', value: data.duration + ' hour' + (data.duration > 1 ? 's' : '') },
            { label: 'Type', value: data.isTemplate ? 'Template' : 'Class' },
            { label: 'Group', value: data.groupLabel || 'None' }
        ];

        if (data.label) {
            details.splice(2, 0, { label: 'Label', value: data.label });
        }

        if (data.disciplineName) {
            details.splice(2, 0, { label: 'Discipline', value: data.disciplineName });
        }

        // Student list
        var studentCount = data.students ? data.students.length : 0;
        var studentNames = 'None';
        if (data.students && data.students.length > 0) {
            var names = [];
            for (var i = 0; i < data.students.length; i++) {
                names.push(data.students[i].studentName || 'Unknown');
            }
            studentNames = names.join(', ');
        }

        details.push({ label: 'Students', value: studentCount + ' - ' + studentNames });

        var actions = [];

        if (!data.isBlock) {
            actions.push({
                label: 'Manage Students',
                className: 'primary',
                handler: function(closeModal) {
                    if (callbacks.onManageStudents) {
                        callbacks.onManageStudents(closeModal);
                    }
                }
            });

            actions.push({
                label: 'Edit',
                className: 'secondary',
                handler: function(closeModal) {
                    if (callbacks.onEdit) {
                        callbacks.onEdit(closeModal);
                    }
                }
            });

            actions.push({
                label: 'Remove',
                className: 'danger',
                handler: function(closeModal) {
                    if (callbacks.onRemove) {
                        callbacks.onRemove(closeModal);
                    }
                }
            });
        } else {
            actions.push({
                label: 'Remove Block',
                className: 'danger',
                handler: function(closeModal) {
                    if (callbacks.onRemove) {
                        callbacks.onRemove(closeModal);
                    }
                }
            });
        }

        var title = data.disciplineName || data.blockLabel || 'Class Details';

        CalendarRenderer.createDetailsModal({
            title: title + (data.label ? ' [' + data.label + ']' : ''),
            details: details,
            actions: actions,
            onClose: callbacks.onClose || null
        });
    }

    // ============================================================
    // BLOCK DETAILS MODAL
    // ============================================================

    /**
     * Render block details modal.
     * 
     * @param {object} data - Block data
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onRemove - Called when remove button is clicked
     * @param {function} callbacks.onClose - Called when modal is closed
     */
    function renderBlockDetailsModal(data, callbacks) {
        if (!data) {
            CalendarRenderer.showNotification('Block not found.', 'error');
            return;
        }

        callbacks = callbacks || {};

        var details = [
            { label: 'Day/Time', value: data.dayName + ' at ' + data.hourDisplay },
            { label: 'Duration', value: (data.duration || 1) + ' hour(s)' },
            { label: 'Group', value: data.groupLabel || 'None' }
        ];

        if (data.label) {
            details.splice(2, 0, { label: 'Label', value: data.label });
        }

        var actions = [
            {
                label: 'Remove Block',
                className: 'danger',
                handler: function(closeModal) {
                    if (callbacks.onRemove) {
                        callbacks.onRemove(closeModal);
                    }
                }
            }
        ];

        CalendarRenderer.createDetailsModal({
            title: data.label || 'Blocked Time',
            details: details,
            actions: actions,
            onClose: callbacks.onClose || null
        });
    }

    // ============================================================
    // MANAGE STUDENTS MODAL
    // ============================================================

    /**
     * Render manage students modal.
     * 
     * @param {object} data - Student management data
     * @param {string} data.instructorId - Instructor ID
     * @param {number} data.week - Week number
     * @param {number} data.day - Day number
     * @param {number} data.hour - Hour number
     * @param {Array} data.students - Array of { id, name, assigned }
     * @param {string} data.disciplineName - Discipline name for title
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onConfirm - Called when confirm button is clicked
     * @param {function} callbacks.onCancel - Called when cancel button is clicked
     */
    function renderManageStudentsModal(data, callbacks) {
        if (!data || !data.students) {
            CalendarRenderer.showNotification('No students available.', 'error');
            return;
        }

        callbacks = callbacks || {};

        CalendarRenderer.createManageStudentsModal({
            title: 'Manage Students - ' + (data.disciplineName || 'Class'),
            students: data.students,
            onConfirm: function(selectedStudents, closeModal) {
                if (callbacks.onConfirm) {
                    callbacks.onConfirm(selectedStudents, closeModal);
                }
            },
            onCancel: callbacks.onCancel || null
        });
    }

    // ============================================================
    // ADD CLASS MODAL
    // ============================================================

    /**
     * Render add class modal.
     * 
     * @param {object} data - Add class data
     * @param {string} data.instructorId - Instructor ID
     * @param {number} data.week - Week number
     * @param {number} data.day - Day number (optional)
     * @param {number} data.hour - Hour number (optional)
     * @param {Array} data.disciplines - Array of discipline objects
     * @param {string} data.title - Modal title
     * @param {number} data.maxDuration - Maximum duration (default: 4)
     * @param {string} data.preSelectedDisciplineId - Pre-selected discipline ID (optional)
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onConfirm - Called when confirm button is clicked
     * @param {function} callbacks.onCancel - Called when cancel button is clicked
     * @returns {HTMLElement} The modal element
     */
    function renderAddClassModal(data, callbacks) {
        data = data || {};
        callbacks = callbacks || {};

        var disciplines = data.disciplines || [];
        var maxDuration = data.maxDuration || MAX_DURATION;

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available.', 'error');
            return null;
        }

        var modal = CalendarRenderer.createAddClassModal({
            title: data.title || 'Add Class Template',
            disciplines: disciplines,
            maxDuration: maxDuration,
            getDisciplineLabel: function(d) {
                return d.name || d.label || d.id;
            },
            onConfirm: function(disciplineId, duration, label, closeModal) {
                if (callbacks.onConfirm) {
                    callbacks.onConfirm(disciplineId, duration, label, closeModal);
                }
            },
            onCancel: callbacks.onCancel || null
        });

        // Pre-select discipline if provided
        if (data.preSelectedDisciplineId && modal) {
            var select = modal.querySelector('#add-class-select');
            if (select) {
                select.value = data.preSelectedDisciplineId;
            }
        }

        return modal;
    }

    // ============================================================
    // AVAILABLE SLOTS VIEW
    // ============================================================

    /**
     * Render available slots for a day.
     * 
     * @param {object} data - Available slots data
     * @param {number} data.day - Day number
     * @param {number} data.duration - Duration in hours
     * @param {Array} data.availableSlots - Array of available hours
     * @param {HTMLElement} container - Container element
     */
    function renderAvailableSlots(data, container) {
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!data || !data.availableSlots || data.availableSlots.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'No available slots for this duration.';
            container.appendChild(empty);
            return;
        }

        var dayName = CalendarConstants.getDayName(data.day);

        var header = document.createElement('div');
        header.style.cssText = 'font-size:0.75rem;color:var(--text-dim);margin-bottom:8px;';
        header.textContent = 'Available slots on ' + dayName + ' (' + data.duration + 'h duration):';
        container.appendChild(header);

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

        for (var i = 0; i < data.availableSlots.length; i++) {
            var slot = document.createElement('button');
            slot.className = 'available-slot-btn';
            slot.dataset.hour = data.availableSlots[i];
            slot.style.cssText = 'padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.7rem;';
            slot.textContent = CalendarUtils.formatHour(data.availableSlots[i]);
            list.appendChild(slot);
        }

        container.appendChild(list);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.InstructorView = {
        // Sidebar
        renderInstructorSidebar: renderInstructorSidebar,

        // Modals
        renderClassDetailsModal: renderClassDetailsModal,
        renderBlockDetailsModal: renderBlockDetailsModal,
        renderManageStudentsModal: renderManageStudentsModal,
        renderAddClassModal: renderAddClassModal,

        // Available slots
        renderAvailableSlots: renderAvailableSlots,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        MAX_DURATION: MAX_DURATION
    };

})();