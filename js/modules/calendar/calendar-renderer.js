/**
 * js/modules/calendar/calendar-renderer.js - Shared Calendar Renderer
 * Single source of truth for all calendar grid rendering
 * Path: js/modules/calendar/calendar-renderer.js
 * 
 * This module provides:
 *   - Calendar grid rendering (shared across all modes)
 *   - Time slot generation
 *   - Day column rendering
 *   - Occupied/empty slot display
 *   - Event binding utilities
 *   - Modal generation helpers
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no data mutation
 *   - All rendering is based on provided data
 *   - All event handlers are delegated to callbacks
 *   - No direct window.data access
 *   - No hardcoded dependencies on specific entity types
 * 
 * USAGE:
 *   var renderer = window.CalendarRenderer;
 *   renderer.renderGrid(container, state, data);
 *   renderer.bindEvents(container, state, callbacks);
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarRendererLoaded) {
        return;
    }
    window.__calendarRendererLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUtils) {
        console.error('CalendarRenderer: CalendarUtils not loaded.');
        return;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CalendarUtils = window.CalendarUtils;

    var DAY_NAMES = CalendarUtils.DAY_NAMES || ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR || 5;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR || 23;

    // ============================================================
    // HTML ESCAPING (Single Source of Truth)
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION (Single Source of Truth)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        }
    }

    // ============================================================
    // CALENDAR GRID RENDERER
    // ============================================================

    /**
     * Render a calendar grid.
     * 
     * @param {HTMLElement} container - Container element
     * @param {object} state - Calendar state { mode, week, selectedId }
     * @param {object} data - Calendar data
     * @param {object} data.schedule - Schedule data { day: { hour: disciplineId } }
     * @param {array} data.restDays - Array of rest day numbers (1-7)
     * @param {function} data.getDiscipline - Function to get discipline by ID
     * @param {function} data.getDuration - Function to get class duration
     * @param {function} data.getLabel - Function to get class label
     * @param {function} data.getGroupLabel - Function to get class group label
     * @param {function} data.getInstructorName - Function to get instructor name
     * @param {function} data.getEntityDisplayName - Function to get entity display name
     * @param {array} data.availableItems - Available items for sidebar (optional)
     * @param {string} data.entityName - Entity name for display (optional)
     * @param {string} data.slotLabelField - Field name for slot label (default: 'label')
     * @param {object} data.extraSidebar - Extra sidebar content (optional)
     * @param {object} data.slotMetadata - Additional slot metadata (optional)
     * @param {array} data.hours - Custom hours array (optional)
     */
    function renderGrid(container, state, data) {
        if (!container) {
            return;
        }

        if (!state || !state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select an entity to view its schedule</div>';
            return;
        }

        var schedule = data.schedule || {};
        var restDays = data.restDays || [];
        var entityName = data.entityName || 'Entity';

        var hours = data.hours || [];
        if (hours.length === 0) {
            for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                hours.push(h);
            }
        }

        var html = '<div class="calendar-grid-container">';
        html += '<div class="calendar-header">';
        html += '<h3>' + escapeHtml(entityName) + ' - Week ' + state.week + '</h3>';
        html += '</div>';

        html += '<div class="schedule-grid">';

        for (var day = 1; day <= 7; day++) {
            var isRestDay = restDays.indexOf(day) !== -1;
            var dayName = DAY_NAMES[day] || 'Day ' + day;

            html += '<div class="day-column' + (isRestDay ? ' rest-day' : '') + '" data-day="' + day + '">';
            html += '<div class="day-header">' + escapeHtml(dayName) + (isRestDay ? ' [R]' : '') + '</div>';
            html += '<div class="day-slots">';

            var occupiedHours = {};

            for (var i = 0; i < hours.length; i++) {
                var hour = hours[i];

                if (occupiedHours[hour]) {
                    continue;
                }

                var disciplineId = null;
                if (schedule[day] && schedule[day][hour]) {
                    disciplineId = schedule[day][hour];
                }

                if (disciplineId) {
                    var duration = data.getDuration ? data.getDuration(day, hour) : 1;
                    var label = data.getLabel ? data.getLabel(day, hour) : '';
                    var groupLabel = data.getGroupLabel ? data.getGroupLabel(day, hour) : '';
                    var instructorName = data.getInstructorName ? data.getInstructorName(day, hour) : '';
                    var isBlock = data.isBlock ? data.isBlock(day, hour) : false;
                    var discipline = data.getDiscipline ? data.getDiscipline(disciplineId) : null;
                    var disciplineName = discipline ? discipline.name : 'Unknown';

                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        occupiedHours[h] = true;
                    }

                    var labelDisplay = label ? ' [' + escapeHtml(label) + ']' : '';
                    var groupDisplay = groupLabel ? ' (G' + escapeHtml(groupLabel) + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var blockDisplay = isBlock ? ' [B]' : '';
                    var instructorDisplay = instructorName ? ' (' + escapeHtml(instructorName) + ')' : '';

                    var classNames = 'time-slot occupied';
                    if (isBlock) classNames += ' blocked';

                    // Additional metadata for slot
                    var extraMetadata = '';
                    if (data.slotMetadata) {
                        var meta = data.slotMetadata(day, hour);
                        if (meta) {
                            extraMetadata = meta;
                        }
                    }

                    html += '<div class="' + classNames + '" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + escapeHtml(disciplineName) + labelDisplay + groupDisplay + durationDisplay + blockDisplay + instructorDisplay + extraMetadata + '</span>';
                    html += '</div>';

                } else if (isRestDay) {
                    html += '<div class="time-slot empty rest-slot" data-day="' + day + '" data-hour="' + hour + '">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '</div>';

                } else {
                    html += '<div class="time-slot empty" data-day="' + day + '" data-hour="' + hour + '">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '<span class="slot-label">+</span>';
                    html += '</div>';
                }
            }

            html += '</div>';
            html += '</div>';
        }

        html += '</div>';

        // Sidebar
        html += getSidebarHTML(data, state);

        html += '</div>';

        container.innerHTML = html;
    }

    // ============================================================
    // SIDEBAR RENDERER
    // ============================================================

    function getSidebarHTML(data, state) {
        var html = '<div class="schedule-sidebar">';

        // Rest Days
        if (data.restDays !== undefined) {
            html += '<div class="sidebar-section">';
            html += '<h4>Rest Days</h4>';
            html += '<div class="rest-day-controls">';
            for (var d = 1; d <= 7; d++) {
                var checked = data.restDays.indexOf(d) !== -1 ? 'checked' : '';
                html += '<label><input type="checkbox" class="rest-day-check" data-day="' + d + '" ' + checked + '> ' + DAY_NAMES[d] + '</label>';
            }
            html += '</div>';
            html += '<button id="save-rest-days-btn" class="small primary">Save Rest Days</button>';
            html += '</div>';
        }

        // Available Items
        if (data.availableItems && data.availableItems.length > 0) {
            html += '<div class="sidebar-section">';
            html += '<h4>' + (data.availableLabel || 'Available Items') + '</h4>';
            html += '<div id="available-items">';
            for (var i = 0; i < data.availableItems.length; i++) {
                var item = data.availableItems[i];
                html += '<div class="available-item" data-id="' + escapeHtml(item.id) + '">';
                html += escapeHtml(item.label);
                if (item.subtitle) {
                    html += ' <span style="font-size:0.6rem;color:var(--text-dim);">' + escapeHtml(item.subtitle) + '</span>';
                }
                html += '</div>';
            }
            html += '</div>';
            html += '</div>';
        }

        // Extra sidebar content
        if (data.extraSidebar) {
            html += data.extraSidebar;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    /**
     * Bind common calendar events.
     * 
     * @param {HTMLElement} container - Container element
     * @param {object} state - Calendar state { mode, week, selectedId }
     * @param {object} callbacks - Callback functions
     * @param {function} callbacks.onSlotClick - Called when empty slot is clicked
     * @param {function} callbacks.onSlotRightClick - Called when occupied slot is right-clicked
     * @param {function} callbacks.onSlotDetails - Called when occupied slot is clicked for details
     * @param {function} callbacks.onRestDaySave - Called when rest days are saved
     * @param {function} callbacks.onAvailableItemClick - Called when available item is clicked
     * @param {function} callbacks.onBlockClick - Called when block is clicked
     * @param {function} callbacks.onBlockRightClick - Called when block is right-clicked
     * @param {function} callbacks.onClearWeek - Called when clear week button is clicked
     */
    function bindEvents(container, state, callbacks) {
        if (!container) {
            return;
        }

        callbacks = callbacks || {};

        // Empty slots - Click to add
        var emptySlots = container.querySelectorAll('.time-slot.empty:not(.rest-slot)');
        for (var i = 0; i < emptySlots.length; i++) {
            var slot = emptySlots[i];
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotClick) {
                    callbacks.onSlotClick(day, hour);
                }
            });
        }

        // Occupied slots - Click for details, Right-click to remove
        var occupiedSlots = container.querySelectorAll('.time-slot.occupied:not(.blocked)');
        for (var j = 0; j < occupiedSlots.length; j++) {
            var occSlot = occupiedSlots[j];
            occSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotDetails) {
                    callbacks.onSlotDetails(day, hour);
                }
            });

            occSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotRightClick) {
                    callbacks.onSlotRightClick(day, hour);
                }
            });
        }

        // Blocked slots - Click for details, Right-click to remove
        var blockedSlots = container.querySelectorAll('.time-slot.blocked');
        for (var k = 0; k < blockedSlots.length; k++) {
            var blockSlot = blockedSlots[k];
            blockSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onBlockClick) {
                    callbacks.onBlockClick(day, hour);
                }
            });

            blockSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onBlockRightClick) {
                    callbacks.onBlockRightClick(day, hour);
                }
            });
        }

        // Save Rest Days
        var saveRestBtn = container.querySelector('#save-rest-days-btn');
        if (saveRestBtn && callbacks.onRestDaySave) {
            saveRestBtn.addEventListener('click', function() {
                var checkboxes = container.querySelectorAll('.rest-day-check');
                var days = [];
                for (var i = 0; i < checkboxes.length; i++) {
                    var cb = checkboxes[i];
                    if (cb.checked) {
                        days.push(parseInt(cb.dataset.day, 10));
                    }
                }
                callbacks.onRestDaySave(days);
            });
        }

        // Available items
        var availItems = container.querySelectorAll('.available-item');
        for (var l = 0; l < availItems.length; l++) {
            var item = availItems[l];
            item.addEventListener('click', function() {
                var id = this.dataset.id;
                if (callbacks.onAvailableItemClick) {
                    callbacks.onAvailableItemClick(id);
                }
            });
        }

        // Clear week button
        var clearBtn = container.querySelector('#clear-week-btn');
        if (clearBtn && callbacks.onClearWeek) {
            clearBtn.addEventListener('click', function() {
                if (confirm('Clear all classes for this week?')) {
                    callbacks.onClearWeek();
                }
            });
        }
    }

    // ============================================================
    // MODAL GENERATORS - Shared Modal Creation
    // ============================================================

    /**
     * Create a modal for adding a class.
     * 
     * @param {object} options - Modal options
     * @param {string} options.title - Modal title
     * @param {array} options.disciplines - Array of discipline objects
     * @param {function} options.getDisciplineLabel - Function to get discipline label
     * @param {number} options.maxDuration - Maximum duration (default: 4)
     * @param {function} options.onConfirm - Called when confirm button is clicked
     * @param {function} options.onCancel - Called when cancel button is clicked
     * @returns {HTMLElement} The modal element
     */
    function createAddClassModal(options) {
        options = options || {};
        var disciplines = options.disciplines || [];
        var maxDuration = options.maxDuration || 4;

        var modal = document.createElement('div');
        modal.className = 'modal';

        var optionsHTML = '';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var label = options.getDisciplineLabel ? options.getDisciplineLabel(d) : d.name;
            optionsHTML += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(label) + '</option>';
        }

        var durationOptionsHTML = '';
        for (var h = 1; h <= maxDuration; h++) {
            durationOptionsHTML += '<option value="' + h + '">' + h + ' hour' + (h > 1 ? 's' : '') + '</option>';
        }

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:500px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Add Class') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-class-select" style="width:100%;padding:8px;margin-bottom:8px;">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration:</label>' +
                        '<select id="add-class-duration" style="width:100%;padding:8px;">' +
                            durationOptionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Label (optional):</label>' +
                        '<input type="text" id="add-class-label" placeholder="e.g., A, B, Group 1..." style="width:100%;padding:8px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Group Label (optional):</label>' +
                        '<input type="text" id="add-class-group" placeholder="e.g., 1, 2, 3..." style="width:100%;padding:8px;">' +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:16px;">' +
                        '<button type="button" id="cancel-add-class" class="secondary">Cancel</button>' +
                        '<button type="button" id="confirm-add-class" class="primary">Add Class</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            if (options.onCancel) {
                options.onCancel();
            }
        };

        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#cancel-add-class').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        modal.querySelector('#confirm-add-class').onclick = function() {
            var select = document.getElementById('add-class-select');
            var disciplineId = select ? select.value : null;
            var duration = parseInt(document.getElementById('add-class-duration').value, 10) || 1;
            var label = document.getElementById('add-class-label').value.trim();
            var groupLabel = document.getElementById('add-class-group').value.trim();

            if (!disciplineId) {
                showNotification('Please select a discipline.', 'error');
                return;
            }

            if (options.onConfirm) {
                options.onConfirm(disciplineId, duration, label, groupLabel, closeModal);
            }
        };

        return modal;
    }

    /**
     * Create a modal for displaying class details.
     * 
     * @param {object} options - Modal options
     * @param {string} options.title - Modal title
     * @param {array} options.details - Array of { label, value } detail rows
     * @param {array} options.actions - Array of { label, className, handler } action buttons
     * @param {function} options.onClose - Called when modal is closed
     * @returns {HTMLElement} The modal element
     */
    function createDetailsModal(options) {
        options = options || {};
        var details = options.details || [];
        var actions = options.actions || [];

        var modal = document.createElement('div');
        modal.className = 'modal';

        var detailsHTML = '';
        for (var i = 0; i < details.length; i++) {
            var d = details[i];
            detailsHTML += '<div class="detail-row"><span class="label">' + escapeHtml(d.label) + ':</span> <span><strong>' + escapeHtml(d.value) + '</strong></span></div>';
        }

        var actionsHTML = '';
        for (var j = 0; j < actions.length; j++) {
            var a = actions[j];
            actionsHTML += '<button type="button" id="action-' + j + '" class="' + escapeHtml(a.className || 'secondary') + ' small">' + escapeHtml(a.label) + '</button>';
        }
        actionsHTML += '<button type="button" id="close-detail" class="secondary small">Close</button>';

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:450px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Details') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    detailsHTML +
                    '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        actionsHTML +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            if (options.onClose) {
                options.onClose();
            }
        };

        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#close-detail').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        for (var k = 0; k < actions.length; k++) {
            var btn = modal.querySelector('#action-' + k);
            if (btn && actions[k].handler) {
                btn.addEventListener('click', function(handler) {
                    return function() {
                        handler(closeModal);
                    };
                }(actions[k].handler));
            }
        }

        return modal;
    }

    /**
     * Create a modal for managing students.
     * 
     * @param {object} options - Modal options
     * @param {string} options.title - Modal title
     * @param {array} options.students - Array of { id, name, assigned } objects
     * @param {function} options.onConfirm - Called when confirm button is clicked
     * @param {function} options.onCancel - Called when cancel button is clicked
     * @returns {HTMLElement} The modal element
     */
    function createManageStudentsModal(options) {
        options = options || {};
        var students = options.students || [];

        var modal = document.createElement('div');
        modal.className = 'modal';

        var studentsHTML = '';
        for (var i = 0; i < students.length; i++) {
            var s = students[i];
            studentsHTML += (
                '<label style="display:block;padding:4px 0;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--border-soft);">' +
                    '<input type="checkbox" class="student-checkbox" value="' + escapeHtml(s.id) + '" ' + (s.assigned ? 'checked' : '') + '> ' +
                    escapeHtml(s.name) +
                    (s.assigned ? ' <span style="color:var(--accent);font-size:0.7rem;">[assigned]</span>' : '') +
                '</label>'
            );
        }

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:550px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Manage Students') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div style="max-height:300px;overflow-y:auto;">' +
                        studentsHTML +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:16px;">' +
                        '<button type="button" id="cancel-manage" class="secondary">Cancel</button>' +
                        '<button type="button" id="update-assignments" class="primary">Update Assignments</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            if (options.onCancel) {
                options.onCancel();
            }
        };

        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#cancel-manage').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        modal.querySelector('#update-assignments').onclick = function() {
            var selected = [];
            var checkboxes = modal.querySelectorAll('.student-checkbox:checked');
            for (var j = 0; j < checkboxes.length; j++) {
                selected.push(checkboxes[j].value);
            }
            if (options.onConfirm) {
                options.onConfirm(selected, closeModal);
            }
        };

        return modal;
    }

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    /**
     * Build an occupied hour map from a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {function} getDuration - Function to get class duration
     * @returns {object} Occupied map { day: { hour: true } }
     */
    function buildOccupiedMap(schedule, getDuration) {
        var occupied = {};

        if (!schedule) {
            return occupied;
        }

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                if (!daySchedule[hour]) continue;

                var startHour = parseInt(hour, 10);
                var duration = getDuration ? getDuration(parseInt(day, 10), startHour) : 1;

                if (!occupied[day]) occupied[day] = {};

                for (var h = startHour; h < startHour + duration && h <= CALENDAR_END_HOUR; h++) {
                    occupied[day][h] = true;
                }
            }
        }

        return occupied;
    }

    /**
     * Check if a range overlaps with an occupied map.
     * 
     * @param {object} occupiedMap - Occupied map { day: { hour: true } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is an overlap
     */
    function hasOverlap(occupiedMap, day, startHour, duration) {
        if (!occupiedMap[day]) {
            return false;
        }

        var requestedEnd = startHour + duration;

        for (var h = startHour; h < requestedEnd && h <= CALENDAR_END_HOUR; h++) {
            if (occupiedMap[day][h]) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get a list of available hours for a day.
     * 
     * @param {object} occupiedMap - Occupied map { day: { hour: true } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour (optional)
     * @param {number} endHour - End hour (optional)
     * @returns {array} Array of available hours
     */
    function getAvailableHours(occupiedMap, day, startHour, endHour) {
        startHour = startHour || CALENDAR_START_HOUR;
        endHour = endHour || CALENDAR_END_HOUR;

        var available = [];

        if (!occupiedMap[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!occupiedMap[day][h]) {
                available.push(h);
            }
        }

        return available;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarRenderer = {
        // Rendering
        renderGrid: renderGrid,
        getSidebarHTML: getSidebarHTML,

        // Events
        bindEvents: bindEvents,

        // Modals
        createAddClassModal: createAddClassModal,
        createDetailsModal: createDetailsModal,
        createManageStudentsModal: createManageStudentsModal,

        // Utilities
        buildOccupiedMap: buildOccupiedMap,
        hasOverlap: hasOverlap,
        getAvailableHours: getAvailableHours,
        escapeHtml: escapeHtml,
        showNotification: showNotification,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        DAY_NAMES: DAY_NAMES
    };

})();
