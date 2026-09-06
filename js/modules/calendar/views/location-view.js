/**
 * modules/calendar/views/location-view.js - Location View
 * Location-specific rendering and modal content
 * Path: js/modules/calendar/views/location-view.js
 * 
 * This module provides:
 *   - renderLocationSidebar - Location sidebar HTML
 *   - renderLocationDetailsModal - Location class details modal content
 *   - renderAddClassModal - Add class to location modal content
 *   - renderLocationStudentsModal - Students at location modal content
 *   - renderLocationUsageView - Location usage view
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses query modules
 *   - Uses DomUtils for safe DOM operations
 *   - Uses CalendarRenderer for shared modal creation
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to LocationMode)
 * 
 * DEPENDENCIES:
 *   - window.LocationQueries (from queries/location-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CalendarRenderer (from calendar-renderer.js) - MANDATORY
 *   - window.CalendarUtils (from calendar-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var LV = window.LocationView;
 *   var html = LV.renderLocationSidebar(locationId, week);
 *   LV.renderLocationDetailsModal(data, callbacks);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__locationViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.LocationQueries || typeof window.LocationQueries.getLocationSchedule !== 'function') {
        missing.push('LocationQueries.getLocationSchedule');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocationUsage !== 'function') {
        missing.push('LocationQueries.getLocationUsage');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocationDisciplineAvailability !== 'function') {
        missing.push('LocationQueries.getLocationDisciplineAvailability');
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
    if (!window.CalendarRenderer || typeof window.CalendarRenderer.createAddClassModal !== 'function') {
        missing.push('CalendarRenderer.createAddClassModal');
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
        console.error('[LocationView] Missing dependencies:', missing.join(', '));
        return;
    }

    window.__locationViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var LocationQueries = window.LocationQueries;
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
    var DAY_NAMES = CalendarConstants.DAY_NAMES;

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
     * Render location sidebar HTML.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @returns {string} Sidebar HTML
     */
    function renderLocationSidebar(locationId, week) {
        var usage = LocationQueries.getLocationUsage(locationId, week);

        var html = '';
        html += '<div class="sidebar-section">';
        html += '<h4>Location Stats</h4>';
        html += '<div style="font-size:0.8rem;color:var(--text-dim);">';
        html += '<div>Total Slots: <strong>' + usage.totalSlots + '</strong></div>';
        html += '<div>Unique Disciplines: <strong>' + usage.uniqueDisciplines + '</strong></div>';
        html += '<div>Total Students: <strong>' + usage.totalStudents + '</strong></div>';
        html += '<div>Utilization: <strong>' + usage.utilization + '%</strong></div>';

        if (usage.busiestDay) {
            html += '<div>Busiest Day: <strong>' + escapeHtml(usage.busiestDay) + '</strong></div>';
        }
        if (usage.busiestHour) {
            html += '<div>Busiest Hour: <strong>' + escapeHtml(usage.busiestHour) + '</strong></div>';
        }

        html += '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Right-click a slot to remove it.';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // LOCATION DETAILS MODAL
    // ============================================================

    /**
     * Render location class details modal.
     * 
     * @param {object} data - Class data from LocationQueries.getLocationClassDetails
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onRemove - Called when remove button is clicked
     * @param {function} callbacks.onEdit - Called when edit button is clicked
     * @param {function} callbacks.onClose - Called when modal is closed
     */
    function renderLocationDetailsModal(data, callbacks) {
        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        callbacks = callbacks || {};

        var details = [
            { label: 'Day/Time', value: data.dayName + ' at ' + data.hourDisplay },
            { label: 'Duration', value: data.duration + ' hour' + (data.duration > 1 ? 's' : '') },
            { label: 'Group', value: data.groupLabel || 'None' }
        ];

        if (data.label) {
            details.splice(1, 0, { label: 'Label', value: data.label });
        }

        if (data.disciplineName) {
            details.splice(1, 0, { label: 'Discipline', value: data.disciplineName });
        }

        if (data.instructorId) {
            var instructor = CharacterQueries.getCharacterById(data.instructorId);
            var instructorName = instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';
            details.push({ label: 'Instructor', value: instructorName });
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

        var title = data.disciplineName || 'Class Details';

        CalendarRenderer.createDetailsModal({
            title: title + (data.label ? ' [' + data.label + ']' : ''),
            details: details,
            actions: actions,
            onClose: callbacks.onClose || null
        });
    }

    // ============================================================
    // ADD CLASS MODAL
    // ============================================================

    /**
     * Render add class to location modal.
     * 
     * @param {object} data - Add class data
     * @param {string} data.locationId - Location ID
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
            CalendarRenderer.showNotification('No disciplines available for this location.', 'error');
            return null;
        }

        var modal = CalendarRenderer.createAddClassModal({
            title: data.title || 'Assign Class to Location',
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
    // LOCATION STUDENTS MODAL
    // ============================================================

    /**
     * Render students at location modal.
     * 
     * @param {object} data - Students data
     * @param {string} data.locationId - Location ID
     * @param {number} data.week - Week number
     * @param {number} data.day - Day number
     * @param {number} data.hour - Hour number
     * @param {Array} data.students - Array of student objects
     * @param {string} data.title - Modal title
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onClose - Called when modal is closed
     */
    function renderLocationStudentsModal(data, callbacks) {
        if (!data || !data.students) {
            CalendarRenderer.showNotification('No students found.', 'error');
            return;
        }

        callbacks = callbacks || {};

        var details = [
            { label: 'Day/Time', value: CalendarConstants.getDayName(data.day) + ' at ' + CalendarUtils.formatHour(data.hour) },
            { label: 'Total Students', value: data.students.length }
        ];

        if (data.students.length > 0) {
            var studentList = '';
            for (var i = 0; i < data.students.length; i++) {
                var s = data.students[i];
                var disciplineName = s.disciplineName || 'Unknown';
                var groupLabel = s.groupLabel ? ' (' + s.groupLabel + ')' : '';
                studentList += '<div style="padding:3px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;font-size:0.75rem;display:flex;justify-content:space-between;">';
                studentList += '<span>' + escapeHtml(s.studentName || 'Unknown') + '</span>';
                studentList += '<span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(disciplineName) + groupLabel + '</span>';
                studentList += '</div>';
            }
            details.push({ label: 'Students', value: studentList });
        }

        var actions = [
            {
                label: 'Close',
                className: 'secondary',
                handler: function(closeModal) {
                    closeModal();
                }
            }
        ];

        CalendarRenderer.createDetailsModal({
            title: data.title || 'Students at Location',
            details: details,
            actions: actions,
            onClose: callbacks.onClose || null
        });
    }

    // ============================================================
    // LOCATION USAGE VIEW
    // ============================================================

    /**
     * Render location usage view.
     * 
     * @param {object} usage - Usage data from LocationQueries.getLocationUsage
     * @param {HTMLElement} container - Container element
     */
    function renderLocationUsageView(usage, container) {
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!usage) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No usage data available.';
            container.appendChild(empty);
            return;
        }

        // Stats grid
        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;';

        var stats = [
            { label: 'Total Slots', value: usage.totalSlots },
            { label: 'Unique Disciplines', value: usage.uniqueDisciplines },
            { label: 'Total Students', value: usage.totalStudents },
            { label: 'Utilization', value: usage.utilization + '%' }
        ];

        for (var i = 0; i < stats.length; i++) {
            var stat = stats[i];
            var statDiv = document.createElement('div');
            statDiv.style.cssText = 'background:var(--bg);padding:8px;border-radius:4px;border:1px solid var(--border-soft);text-align:center;';
            
            var valueSpan = document.createElement('div');
            valueSpan.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--accent);';
            valueSpan.textContent = stat.value;
            statDiv.appendChild(valueSpan);

            var labelSpan = document.createElement('div');
            labelSpan.style.cssText = 'font-size:0.65rem;color:var(--text-dim);';
            labelSpan.textContent = stat.label;
            statDiv.appendChild(labelSpan);

            grid.appendChild(statDiv);
        }

        container.appendChild(grid);

        // Busy details
        var detailsDiv = document.createElement('div');
        detailsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;padding:8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);font-size:0.75rem;';

        var detailItems = [];
        if (usage.busiestDay) {
            detailItems.push({ label: 'Busiest Day', value: usage.busiestDay });
        }
        if (usage.busiestHour) {
            detailItems.push({ label: 'Busiest Hour', value: usage.busiestHour });
        }
        if (usage.daysWithClasses !== undefined) {
            detailItems.push({ label: 'Days with Classes', value: usage.daysWithClasses });
        }

        for (var i = 0; i < detailItems.length; i++) {
            var item = detailItems[i];
            var itemDiv = document.createElement('div');
            itemDiv.style.cssText = 'display:flex;gap:4px;';
            
            var labelSpan = document.createElement('span');
            labelSpan.style.cssText = 'color:var(--text-dim);';
            labelSpan.textContent = item.label + ':';
            itemDiv.appendChild(labelSpan);

            var valueSpan = document.createElement('span');
            valueSpan.style.cssText = 'font-weight:600;';
            valueSpan.textContent = item.value;
            itemDiv.appendChild(valueSpan);

            detailsDiv.appendChild(itemDiv);
        }

        container.appendChild(detailsDiv);
    }

    // ============================================================
    // DISCIPLINE AVAILABILITY VIEW
    // ============================================================

    /**
     * Render discipline availability view.
     * 
     * @param {Array} disciplines - Discipline availability data
     * @param {HTMLElement} container - Container element
     */
    function renderDisciplineAvailabilityView(disciplines, container) {
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!disciplines || disciplines.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No disciplines available.';
            container.appendChild(empty);
            return;
        }

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) {
                continue;
            }

            var item = document.createElement('div');
            item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + (d.available ? 'var(--accent)' : 'var(--danger)') + ';';
            item.style.cssText += 'font-size:0.75rem;';

            var nameSpan = document.createElement('span');
            nameSpan.textContent = d.name || d.label || 'Unknown';
            item.appendChild(nameSpan);

            var statusSpan = document.createElement('span');
            statusSpan.style.cssText = 'font-size:0.65rem;color:' + (d.available ? 'var(--accent)' : 'var(--danger)') + ';';
            
            if (d.canHost === false) {
                statusSpan.textContent = 'Not available for this location';
            } else if (d.available) {
                statusSpan.textContent = d.maxSlots > 0 ? d.usedCount + '/' + d.maxSlots + ' slots used' : 'Available';
            } else {
                statusSpan.textContent = 'Full (' + d.usedCount + '/' + d.maxSlots + ')';
            }
            
            item.appendChild(statusSpan);

            list.appendChild(item);
        }

        container.appendChild(list);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.LocationView = {
        // Sidebar
        renderLocationSidebar: renderLocationSidebar,

        // Modals
        renderLocationDetailsModal: renderLocationDetailsModal,
        renderAddClassModal: renderAddClassModal,
        renderLocationStudentsModal: renderLocationStudentsModal,

        // Views
        renderLocationUsageView: renderLocationUsageView,
        renderDisciplineAvailabilityView: renderDisciplineAvailabilityView,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        MAX_DURATION: MAX_DURATION
    };

})();