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
 *   - USES DomUtils.escapeHtml() - SINGLE SOURCE OF TRUTH
 *   - USES NotificationSystem for notifications
 *   - USES CalendarUtils for formatting
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

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CalendarUtils) {
        return;
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        return;
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        return;
    }

    window.__calendarRendererLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CalendarUtils = window.CalendarUtils;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = CalendarUtils.DAY_NAMES || ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR || 5;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR || 23;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // FORMAT HOUR - Delegates to CalendarUtils
    // ============================================================

    function formatHour(hour, includeMinutes) {
        return CalendarUtils.formatHour(hour, includeMinutes);
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

        var html = '';
        html += '<div class="calendar-grid-container">';
        html += '<div class="calendar-grid-wrapper">';
        html += '<div class="calendar-header">';
        html += '<h3 class="calendar-title">' + escapeHtml(entityName) + ' - Week ' + state.week + '</h3>';
        html += '</div>';

        html += '<div class="schedule-grid">';

        // Header row
        html += '<div class="schedule-cell schedule-time schedule-header">Time</div>';
        for (var day = 1; day <= 7; day++) {
            var isRestDay = restDays.indexOf(day) !== -1;
            var dayName = DAY_NAMES[day] || 'Day ' + day;
            var restClass = isRestDay ? ' schedule-rest-day' : '';
            html += '<div class="schedule-cell schedule-day schedule-header' + restClass + '">' + escapeHtml(dayName) + (isRestDay ? ' [R]' : '') + '</div>';
        }

        // Body rows
        for (var row = 0; row < hours.length; row++) {
            var hour = hours[row];
            var hourDisplay = formatHour(hour);

            html += '<div class="schedule-cell schedule-time">' + escapeHtml(hourDisplay) + '</div>';

            for (var day = 1; day <= 7; day++) {
                var isRestDay = restDays.indexOf(day) !== -1;
                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                var isOccupied = !!disciplineId;

                var classes = 'schedule-cell schedule-slot';
                if (isOccupied) {
                    classes += ' schedule-occupied';
                } else {
                    classes += ' schedule-empty';
                }
                if (isRestDay) {
                    classes += ' schedule-rest-day';
                }
                if (data.isBlock && data.isBlock(day, hour)) {
                    classes += ' schedule-blocked';
                }

                var dataAttrs = 'data-day="' + day + '" data-hour="' + hour + '"';
                if (isOccupied) {
                    dataAttrs += ' data-discipline="' + escapeAttribute(disciplineId) + '"';
                    var duration = data.getDuration ? data.getDuration(day, hour) : 1;
                    dataAttrs += ' data-duration="' + duration + '"';
                }

                html += '<div class="' + classes + '" ' + dataAttrs + '>';

                if (isOccupied && !isRestDay) {
                    var discipline = data.getDiscipline ? data.getDiscipline(disciplineId) : null;
                    var disciplineName = discipline ? discipline.name : 'Unknown';
                    var label = data.getLabel ? data.getLabel(day, hour) : '';
                    var duration = data.getDuration ? data.getDuration(day, hour) : 1;
                    var instructorName = data.getInstructorName ? data.getInstructorName(day, hour) : '';
                    var isBlock = data.isBlock ? data.isBlock(day, hour) : false;

                    html += '<div class="schedule-discipline-name">' + escapeHtml(disciplineName) + '</div>';
                    if (label) {
                        html += '<div class="schedule-label">[' + escapeHtml(label) + ']</div>';
                    }
                    if (instructorName) {
                        html += '<div class="schedule-instructor">' + escapeHtml(instructorName) + '</div>';
                    }
                    if (duration > 1) {
                        html += '<div class="schedule-duration">' + duration + 'h</div>';
                    }
                    if (isBlock) {
                        html += '<div class="schedule-blocked-label">[BLOCKED]</div>';
                    }

                    if (data.slotMetadata) {
                        var meta = data.slotMetadata(day, hour);
                        if (meta) {
                            html += '<div class="schedule-metadata">' + escapeHtml(meta) + '</div>';
                        }
                    }

                    html += '<div class="schedule-remove-slot" data-day="' + day + '" data-hour="' + hour + '">×</div>';

                } else if (!isRestDay) {
                    html += '<div class="schedule-empty-label">+</div>';
                }

                html += '</div>';
            }
        }

        html += '</div>';
        html += '</div>'; // end calendar-grid-wrapper

        // Sidebar
        html += getSidebarHTML(data, state);

        html += '</div>'; // end calendar-grid-container

        container.innerHTML = html;
    }

    // ============================================================
    // SIDEBAR RENDERER
    // ============================================================

    function getSidebarHTML(data, state) {
        var html = '';
        html += '<div class="schedule-sidebar">';

        // Rest Days
        if (data.restDays !== undefined) {
            html += '<div class="sidebar-section">';
            html += '<h4 class="sidebar-section-title">Rest Days</h4>';
            html += '<div class="rest-day-controls">';
            for (var d = 1; d <= 7; d++) {
                var checked = data.restDays.indexOf(d) !== -1 ? 'checked' : '';
                html += '<label class="rest-day-label">';
                html += '<input type="checkbox" class="rest-day-check" data-day="' + d + '" ' + checked + '>';
                html += DAY_NAMES[d];
                html += '</label>';
            }
            html += '</div>';
            html += '<button id="save-rest-days-btn" class="small primary">Save Rest Days</button>';
            html += '</div>';
        }

        // Available Items
        if (data.availableItems && data.availableItems.length > 0) {
            html += '<div class="sidebar-section">';
            html += '<h4 class="sidebar-section-title">' + (data.availableLabel || 'Available Items') + '</h4>';
            html += '<div id="available-items" class="available-items-list">';
            for (var i = 0; i < data.availableItems.length; i++) {
                var item = data.availableItems[i];
                html += '<div class="available-item" data-id="' + escapeAttribute(item.id) + '">';
                html += escapeHtml(item.label);
                if (item.subtitle) {
                    html += ' <span class="available-item-subtitle">' + escapeHtml(item.subtitle) + '</span>';
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
     * @param {function} callbacks.onRemoveSlot - Called when remove slot (X) is clicked
     * @returns {object} Cleanup function to remove all listeners
     */
    function bindEvents(container, state, callbacks) {
        if (!container) {
            return function() {};
        }

        callbacks = callbacks || {};
        var listeners = [];

        function addListener(element, eventName, handler) {
            if (!element) {
                return;
            }
            element.addEventListener(eventName, handler);
            listeners.push({ element: element, eventName: eventName, handler: handler });
        }

        // Empty slots - Click to add
        var emptySlots = container.querySelectorAll('.schedule-slot.schedule-empty:not(.schedule-rest-day)');
        for (var i = 0; i < emptySlots.length; i++) {
            var slot = emptySlots[i];
            addListener(slot, 'click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotClick) {
                    callbacks.onSlotClick(day, hour);
                }
            });
        }

        // Occupied slots - Click for details, Right-click to remove
        var occupiedSlots = container.querySelectorAll('.schedule-slot.schedule-occupied:not(.schedule-blocked)');
        for (var j = 0; j < occupiedSlots.length; j++) {
            var occSlot = occupiedSlots[j];
            addListener(occSlot, 'click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotDetails) {
                    callbacks.onSlotDetails(day, hour);
                }
            });

            addListener(occSlot, 'contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onSlotRightClick) {
                    callbacks.onSlotRightClick(day, hour);
                }
            });
        }

        // Remove slot buttons (X)
        var removeBtns = container.querySelectorAll('.schedule-remove-slot');
        for (var r = 0; r < removeBtns.length; r++) {
            var btn = removeBtns[r];
            addListener(btn, 'click', function(e) {
                e.stopPropagation();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onRemoveSlot) {
                    callbacks.onRemoveSlot(day, hour);
                } else if (callbacks.onSlotRightClick) {
                    callbacks.onSlotRightClick(day, hour);
                }
            });
        }

        // Blocked slots - Click for details, Right-click to remove
        var blockedSlots = container.querySelectorAll('.schedule-slot.schedule-blocked');
        for (var k = 0; k < blockedSlots.length; k++) {
            var blockSlot = blockedSlots[k];
            addListener(blockSlot, 'click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (callbacks.onBlockClick) {
                    callbacks.onBlockClick(day, hour);
                }
            });

            addListener(blockSlot, 'contextmenu', function(e) {
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
            addListener(saveRestBtn, 'click', function() {
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
            addListener(item, 'click', function() {
                var id = this.dataset.id;
                if (callbacks.onAvailableItemClick) {
                    callbacks.onAvailableItemClick(id);
                }
            });
        }

        // Clear week button
        var clearBtn = container.querySelector('#clear-week-btn');
        if (clearBtn && callbacks.onClearWeek) {
            addListener(clearBtn, 'click', function() {
                if (callbacks.onClearWeek) {
                    callbacks.onClearWeek();
                }
            });
        }

        // Return cleanup function
        return function() {
            for (var i = 0; i < listeners.length; i++) {
                var item = listeners[i];
                try {
                    item.element.removeEventListener(item.eventName, item.handler);
                } catch (e) {
                    // Ignore errors during cleanup
                }
            }
            listeners = [];
        };
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
            optionsHTML += '<option value="' + escapeAttribute(d.id) + '">' + escapeHtml(label) + '</option>';
        }

        var durationOptionsHTML = '';
        for (var h = 1; h <= maxDuration; h++) {
            durationOptionsHTML += '<option value="' + h + '">' + h + ' hour' + (h > 1 ? 's' : '') + '</option>';
        }

        modal.innerHTML = (
            '<div class="modal-content modal-form-content">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Add Class') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-class-select" class="modal-select">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration:</label>' +
                        '<select id="add-class-duration" class="modal-select">' +
                            durationOptionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Label (optional):</label>' +
                        '<input type="text" id="add-class-label" class="modal-input" placeholder="e.g., A, B, Group 1...">' +
                    '</div>' +
                    '<div class="form-actions">' +
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

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.onclick = closeModal;
        }

        var cancelBtn = modal.querySelector('#cancel-add-class');
        if (cancelBtn) {
            cancelBtn.onclick = closeModal;
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        var confirmBtn = modal.querySelector('#confirm-add-class');
        if (confirmBtn) {
            confirmBtn.onclick = function() {
                var select = document.getElementById('add-class-select');
                var disciplineId = select ? select.value : null;
                var duration = parseInt(document.getElementById('add-class-duration').value, 10) || 1;
                var label = document.getElementById('add-class-label').value.trim();

                if (!disciplineId) {
                    showNotification('Please select a discipline.', 'error');
                    return;
                }

                if (options.onConfirm) {
                    options.onConfirm(disciplineId, duration, label, closeModal);
                }
            };
        }

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
            detailsHTML += '<div class="detail-row"><span class="detail-label">' + escapeHtml(d.label) + ':</span> <span class="detail-value"><strong>' + escapeHtml(d.value) + '</strong></span></div>';
        }

        var actionsHTML = '';
        for (var j = 0; j < actions.length; j++) {
            var a = actions[j];
            actionsHTML += '<button type="button" id="action-' + j + '" class="' + escapeAttribute(a.className || 'secondary') + ' small">' + escapeHtml(a.label) + '</button>';
        }
        actionsHTML += '<button type="button" id="close-detail" class="secondary small">Close</button>';

        modal.innerHTML = (
            '<div class="modal-content modal-detail-content">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Details') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    detailsHTML +
                    '<div class="detail-actions">' +
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

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.onclick = closeModal;
        }

        var closeDetailBtn = modal.querySelector('#close-detail');
        if (closeDetailBtn) {
            closeDetailBtn.onclick = closeModal;
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        for (var k = 0; k < actions.length; k++) {
            var btn = modal.querySelector('#action-' + k);
            if (btn && actions[k].handler) {
                btn.addEventListener('click', (function(handler) {
                    return function() {
                        handler(closeModal);
                    };
                })(actions[k].handler));
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
            var checked = s.assigned ? 'checked' : '';
            studentsHTML += (
                '<label class="student-checkbox-label">' +
                    '<input type="checkbox" class="student-checkbox" value="' + escapeAttribute(s.id) + '" ' + checked + '> ' +
                    escapeHtml(s.name) +
                    (s.assigned ? ' <span class="student-assigned-badge">[assigned]</span>' : '') +
                '</label>'
            );
        }

        modal.innerHTML = (
            '<div class="modal-content modal-manage-content">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Manage Students') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="student-list">' +
                        studentsHTML +
                    '</div>' +
                    '<div class="form-actions">' +
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

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.onclick = closeModal;
        }

        var cancelBtn = modal.querySelector('#cancel-manage');
        if (cancelBtn) {
            cancelBtn.onclick = closeModal;
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        var updateBtn = modal.querySelector('#update-assignments');
        if (updateBtn) {
            updateBtn.onclick = function() {
                var selected = [];
                var checkboxes = modal.querySelectorAll('.student-checkbox:checked');
                for (var j = 0; j < checkboxes.length; j++) {
                    selected.push(checkboxes[j].value);
                }
                if (options.onConfirm) {
                    options.onConfirm(selected, closeModal);
                }
            };
        }

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
                if (!daySchedule[hour]) {
                    continue;
                }

                var startHour = parseInt(hour, 10);
                var duration = getDuration ? getDuration(parseInt(day, 10), startHour) : 1;

                if (!occupied[day]) {
                    occupied[day] = {};
                }

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
        escapeAttribute: escapeAttribute,
        showNotification: showNotification,
        formatHour: formatHour,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        DAY_NAMES: DAY_NAMES
    };

})();
