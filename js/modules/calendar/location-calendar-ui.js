/**
 * js/modules/calendar/location-calendar-ui.js - Location Calendar UI
 * Thin UI layer for location calendar - class assignments, location management
 * Path: js/modules/calendar/location-calendar-ui.js
 * 
 * This module provides:
 *   - Location calendar rendering (via CalendarRenderer)
 *   - Event binding for location calendar interactions
 *   - Add class to location modal
 *   - Location class details modal
 *   - Location usage view
 *   - Class removal from location
 * 
 * IMPORTANT:
 *   - THIN UI LAYER - no domain logic
 *   - Uses CalendarRenderer for HTML generation
 *   - Uses ScheduleCore for mutations
 *   - Uses CalendarQueries for read operations
 *   - Uses NotificationSystem for user feedback
 *   - Uses Modal for modal lifecycle
 *   - No direct window.data access
 *   - No saveData() calls
 *   - No persistence logic
 * 
 * DEPENDENCIES:
 *   - window.CalendarRenderer (from calendar-renderer.js)
 *   - window.CalendarQueries (from calendar-queries.js)
 *   - window.ScheduleCore (from schedule-core.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.Modal (from modal.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 * 
 * USAGE:
 *   var ui = window.LocationCalendarUI;
 *   ui.render(container, { selectedId: 'location_123', week: 5 });
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__locationCalendarUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.renderGrid !== 'function') {
        missing.push('CalendarRenderer.renderGrid');
    }

    if (!window.CalendarQueries || typeof window.CalendarQueries.getLocationSchedule !== 'function') {
        missing.push('CalendarQueries.getLocationSchedule');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getLocationClassDetails !== 'function') {
        missing.push('CalendarQueries.getLocationClassDetails');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getStudentsAtLocation !== 'function') {
        missing.push('CalendarQueries.getStudentsAtLocation');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getLocationUsage !== 'function') {
        missing.push('CalendarQueries.getLocationUsage');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getLocationDisciplineAvailability !== 'function') {
        missing.push('CalendarQueries.getLocationDisciplineAvailability');
    }

    if (!window.ScheduleCore || typeof window.ScheduleCore.setLocationClass !== 'function') {
        missing.push('ScheduleCore.setLocationClass');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeLocationClass !== 'function') {
        missing.push('ScheduleCore.removeLocationClass');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.clearLocationSchedule !== 'function') {
        missing.push('ScheduleCore.clearLocationSchedule');
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        missing.push('NotificationSystem.notify');
    }

    if (!window.Modal || typeof window.Modal.createModal !== 'function') {
        missing.push('Modal.createModal');
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }
    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getAvailableDisciplines !== 'function') {
        missing.push('DisciplineQueries.getAvailableDisciplines');
    }

    if (!window.LocationQueries || typeof window.LocationQueries.getLocation !== 'function') {
        missing.push('LocationQueries.getLocation');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocations !== 'function') {
        missing.push('LocationQueries.getLocations');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseSlot !== 'function') {
        missing.push('CalendarValidation.parseSlot');
    }

    if (missing.length > 0) {
        throw new Error('[LocationCalendarUI] Missing dependencies: ' + missing.join(', '));
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CalendarRenderer = window.CalendarRenderer;
    var CalendarQueries = window.CalendarQueries;
    var ScheduleCore = window.ScheduleCore;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;
    var DomUtils = window.DomUtils;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_CLASS_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute ? DomUtils.escapeAttribute(value) : String(value == null ? '' : value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // STATE
    // ============================================================

    var _state = {
        selectedId: null,
        week: 1
    };

    var _container = null;
    var _eventListeners = [];
    var _cleanup = null;

    // ============================================================
    // GET LOCATIONS
    // ============================================================

    function getLocations() {
        return LocationQueries.getLocations() || [];
    }

    function getLocationName(locationId) {
        var location = LocationQueries.getLocation(locationId);
        return location ? location.name : 'Unknown';
    }

    // ============================================================
    // GET SCHEDULE DATA
    // ============================================================

    function getScheduleData(locationId, week) {
        if (!locationId) {
            return {};
        }

        var schedule = CalendarQueries.getLocationSchedule(locationId, week);
        var usage = CalendarQueries.getLocationUsage(locationId, week);
        var disciplineAvailability = CalendarQueries.getLocationDisciplineAvailability(locationId, week);

        return {
            schedule: schedule,
            usage: usage,
            disciplineAvailability: disciplineAvailability
        };
    }

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(container, state) {
        if (!container) {
            container = document.getElementById('location-calendar');
        }

        if (!container) {
            console.warn('[LocationCalendarUI] Container not found');
            return;
        }

        _container = container;

        if (state) {
            if (state.selectedId !== undefined) {
                _state.selectedId = state.selectedId;
            }
            if (state.week !== undefined) {
                _state.week = state.week;
            }
        }

        // Clean up previous listeners
        removeAllEventListeners();

        // Check if location is selected
        if (!_state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a location to view its schedule</div>';
            return;
        }

        var location = LocationQueries.getLocation(_state.selectedId);
        if (!location) {
            container.innerHTML = '<div class="empty-state">Location not found</div>';
            return;
        }

        var data = getScheduleData(_state.selectedId, _state.week);
        var locationName = location.name || 'Unknown';

        // Build schedule for renderer
        var renderSchedule = {};

        for (var day in data.schedule) {
            if (!Object.prototype.hasOwnProperty.call(data.schedule, day)) {
                continue;
            }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) {
                continue;
            }
            var daySchedule = data.schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) {
                    continue;
                }
                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }
                if (!renderSchedule[dayNum]) {
                    renderSchedule[dayNum] = {};
                }
                renderSchedule[dayNum][hourNum] = disciplineId;
            }
        }

        // Prepare available items from discipline availability
        var availableItems = [];
        if (data.disciplineAvailability && data.disciplineAvailability.length > 0) {
            for (var i = 0; i < data.disciplineAvailability.length; i++) {
                var d = data.disciplineAvailability[i];
                if (d && d.available) {
                    availableItems.push({
                        id: d.id,
                        label: d.name + ' (' + (d.usedCount || 0) + '/' + (d.maxSlots || '∞') + ')',
                        subtitle: d.canHost ? 'Available' : 'Not available at this location'
                    });
                }
            }
        }

        // Prepare data for renderer
        var renderData = {
            schedule: renderSchedule,
            restDays: [],
            entityName: locationName,
            modeLabel: 'Location Schedule',
            getDiscipline: DisciplineQueries.getDiscipline,
            getDuration: function(day, hour) {
                var details = CalendarQueries.getLocationClassDetails(_state.selectedId, _state.week, day, hour);
                return details ? details.duration || 1 : 1;
            },
            getLabel: function(day, hour) {
                var details = CalendarQueries.getLocationClassDetails(_state.selectedId, _state.week, day, hour);
                return details ? details.label || '' : '';
            },
            getInstructorName: function(day, hour) {
                var details = CalendarQueries.getLocationClassDetails(_state.selectedId, _state.week, day, hour);
                if (details && details.instructorId) {
                    var instructor = CharacterQueries.getCharacterById(details.instructorId);
                    return instructor ? CharacterQueries.getDisplayName(instructor) : '';
                }
                return '';
            },
            slotMetadata: function(day, hour) {
                var students = CalendarQueries.getStudentsAtLocation(_state.selectedId, _state.week, day, hour);
                if (students && students.length > 0) {
                    return ' [' + students.length + ' student' + (students.length > 1 ? 's' : '') + ']';
                }
                return '';
            },
            availableItems: availableItems,
            availableLabel: 'Available Disciplines',
            showEmptySlots: true,
            showRestDays: false,
            extraSidebar: getLocationSidebarHTML(_state.selectedId, _state.week, data)
        };

        var html = CalendarRenderer.renderGrid(_state, renderData);
        container.innerHTML = html;

        // Bind events
        bindEvents();
    }

    // ============================================================
    // SIDEBAR - Location Stats
    // ============================================================

    function getLocationSidebarHTML(locationId, week, data) {
        var usage = data.usage || {};

        var html = '';
        html += '<div class="sidebar-section">';
        html += '<h4>Location Stats</h4>';
        html += '<div style="font-size:0.8rem;color:var(--text-dim);">';
        html += '<div>Total Slots: <strong>' + (usage.totalSlots || 0) + '</strong></div>';
        html += '<div>Unique Disciplines: <strong>' + (usage.uniqueDisciplines || 0) + '</strong></div>';
        html += '<div>Total Students: <strong>' + (usage.totalStudents || 0) + '</strong></div>';
        html += '<div>Utilization: <strong>' + (usage.utilization || 0) + '%</strong></div>';

        if (usage.busiestDay) {
            html += '<div>Busiest Day: <strong>' + escapeHtml(usage.busiestDay) + '</strong></div>';
        }
        if (usage.busiestHour) {
            html += '<div>Busiest Hour: <strong>' + escapeHtml(usage.busiestHour) + '</strong></div>';
        }

        html += '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Click a slot to assign class | Right-click to remove';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindEvents() {
        if (!_container) {
            return;
        }

        var scheduleSlots = _container.querySelectorAll('.schedule-slot');

        for (var i = 0; i < scheduleSlots.length; i++) {
            var slot = scheduleSlots[i];
            var day = parseInt(slot.dataset.day, 10);
            var hour = parseInt(slot.dataset.hour, 10);

            if (isNaN(day) || isNaN(hour)) {
                continue;
            }

            // Empty slot - click to add class
            if (slot.classList.contains('schedule-empty')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleAddClass(d, h);
                });
            }

            // Occupied slot - click for details
            if (slot.classList.contains('schedule-occupied')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleClassDetails(d, h);
                });

                // Right-click to remove
                addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this class from the location?')) {
                        handleRemoveClass(d, h);
                    }
                });
            }
        }

        // Available items
        var availItems = _container.querySelectorAll('.available-item');
        for (var j = 0; j < availItems.length; j++) {
            var item = availItems[j];
            addEventListener(item, 'click', function() {
                var disciplineId = this.dataset.id;
                if (disciplineId) {
                    handleAvailableItemClick(disciplineId);
                }
            });
        }

        // Clear schedule button (if present)
        var clearBtn = _container.querySelector('#clear-location-schedule');
        if (clearBtn) {
            addEventListener(clearBtn, 'click', function() {
                if (confirm('Clear all classes from this location for week ' + _state.week + '?')) {
                    handleClearSchedule();
                }
            });
        }
    }

    // ============================================================
    // EVENT LISTENER MANAGEMENT
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _eventListeners = [];

        if (_cleanup) {
            _cleanup();
            _cleanup = null;
        }
    }

    // ============================================================
    // HANDLERS - Add Class
    // ============================================================

    function handleAddClass(day, hour) {
        if (!_state.selectedId) {
            notify('No location selected.', 'error');
            return;
        }

        var disciplineAvailability = CalendarQueries.getLocationDisciplineAvailability(_state.selectedId, _state.week);

        if (!disciplineAvailability || disciplineAvailability.length === 0) {
            notify('No disciplines available for this location this week.', 'error');
            return;
        }

        // Filter to only available disciplines
        var availableDisciplines = disciplineAvailability.filter(function(d) {
            return d && d.available && d.canHost;
        });

        if (availableDisciplines.length === 0) {
            notify('No disciplines currently available at this location.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        showAddClassModal({
            title: 'Assign Class to Location - ' + dayName + ' at ' + hourDisplay,
            disciplines: availableDisciplines,
            onConfirm: function(disciplineId, closeModal) {
                var result = ScheduleCore.setLocationClass(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    disciplineId,
                    1
                );

                if (result && result.success) {
                    closeModal();
                    notify('Class assigned to location successfully.', 'success');
                    refresh();
                } else {
                    notify(result ? result.message : 'Failed to assign class.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // HANDLERS - Class Details
    // ============================================================

    function handleClassDetails(day, hour) {
        if (!_state.selectedId) {
            return;
        }

        var details = CalendarQueries.getLocationClassDetails(_state.selectedId, _state.week, day, hour);

        if (!details) {
            notify('Class not found.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(details.disciplineId);
        var disciplineName = discipline ? discipline.name : 'Unknown';

        var instructorName = 'Not assigned';
        if (details.instructorId) {
            var instructor = CharacterQueries.getCharacterById(details.instructorId);
            if (instructor) {
                instructorName = CharacterQueries.getDisplayName(instructor);
            }
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        // Get students at this location
        var students = CalendarQueries.getStudentsAtLocation(_state.selectedId, _state.week, day, hour);

        var studentNames = [];
        if (students && students.length > 0) {
            for (var i = 0; i < students.length; i++) {
                var student = students[i];
                var studentChar = CharacterQueries.getCharacterById(student.studentId);
                if (studentChar) {
                    studentNames.push(CharacterQueries.getDisplayName(studentChar));
                }
            }
        }

        var studentList = studentNames.length > 0 ? studentNames.join(', ') : 'None';

        showDetailsModal({
            title: disciplineName + ' at ' + getLocationName(_state.selectedId),
            details: [
                { label: 'Day/Time', value: dayName + ' at ' + hourDisplay },
                { label: 'Instructor', value: instructorName },
                { label: 'Students', value: students ? students.length + ' - ' + studentList : '0' },
                { label: 'Week', value: _state.week }
            ],
            actions: [
                {
                    label: 'Remove from Location',
                    className: 'danger',
                    handler: function(closeModal) {
                        closeModal();
                        if (confirm('Remove this class from the location?')) {
                            handleRemoveClass(day, hour);
                        }
                    }
                }
            ],
            onClose: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // HANDLERS - Remove Class
    // ============================================================

    function handleRemoveClass(day, hour) {
        if (!_state.selectedId) {
            notify('No location selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeLocationClass(_state.selectedId, _state.week, day, hour);

        if (result && result.success) {
            notify('Class removed from location successfully.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to remove class.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Clear Schedule
    // ============================================================

    function handleClearSchedule() {
        if (!_state.selectedId) {
            notify('No location selected.', 'error');
            return;
        }

        var result = ScheduleCore.clearLocationSchedule(_state.selectedId, _state.week);

        if (result && result.success) {
            notify('Location schedule cleared.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to clear schedule.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Available Item Click
    // ============================================================

    function handleAvailableItemClick(disciplineId) {
        if (!_state.selectedId) {
            notify('No location selected.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            notify('Discipline not found.', 'error');
            return;
        }

        // Find an available slot
        var schedule = CalendarQueries.getLocationSchedule(_state.selectedId, _state.week);
        var foundSlot = false;

        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            for (var hour = CALENDAR_START_HOUR; hour <= CALENDAR_END_HOUR; hour++) {
                if (!schedule[day] || !schedule[day][hour]) {
                    var result = ScheduleCore.setLocationClass(
                        _state.selectedId,
                        _state.week,
                        day,
                        hour,
                        disciplineId,
                        1
                    );

                    if (result && result.success) {
                        notify('Class assigned at ' + CalendarConstants.getDayName(day) + ' ' + CalendarConstants.formatHour(hour), 'success');
                        refresh();
                        foundSlot = true;
                        break;
                    }
                }
            }
            if (foundSlot) {
                break;
            }
        }

        if (!foundSlot) {
            notify('No available slots found for this discipline.', 'warning');
        }
    }

    // ============================================================
    // MODALS - Add Class
    // ============================================================

    function showAddClassModal(options) {
        options = options || {};
        var disciplines = options.disciplines || [];

        var modal = Modal.createModal('add-location-class-modal');

        var optionsHTML = '';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var label = d.label || d.name || d.id;
            var subtitle = d.subtitle ? ' (' + d.subtitle + ')' : '';
            optionsHTML += '<option value="' + escapeAttribute(d.id) + '">' + escapeHtml(label) + subtitle + '</option>';
        }

        modal.innerHTML = (
            '<div class="modal-content modal-form-content">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(options.title || 'Assign Class to Location') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-location-class-select" class="modal-select">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-actions">' +
                        '<button type="button" id="cancel-add-location-class" class="secondary">Cancel</button>' +
                        '<button type="button" id="confirm-add-location-class" class="primary">Assign Class</button>' +
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

        var cancelBtn = modal.querySelector('#cancel-add-location-class');
        if (cancelBtn) {
            cancelBtn.onclick = closeModal;
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        var confirmBtn = modal.querySelector('#confirm-add-location-class');
        if (confirmBtn) {
            confirmBtn.onclick = function() {
                var select = document.getElementById('add-location-class-select');
                var disciplineId = select ? select.value : null;

                if (!disciplineId) {
                    notify('Please select a discipline.', 'error');
                    return;
                }

                if (options.onConfirm) {
                    options.onConfirm(disciplineId, closeModal);
                }
            };
        }

        return modal;
    }

    // ============================================================
    // MODALS - Details
    // ============================================================

    function showDetailsModal(options) {
        options = options || {};
        var details = options.details || [];
        var actions = options.actions || [];

        var modal = Modal.createModal('details-modal');

        var detailsHTML = '';
        for (var i = 0; i < details.length; i++) {
            var d = details[i];
            var valueHtml = typeof d.value === 'string' && d.value.indexOf('<') !== -1
                ? d.value
                : escapeHtml(d.value);
            detailsHTML += '<div class="detail-row"><span class="detail-label">' + escapeHtml(d.label) + ':</span> <span class="detail-value"><strong>' + valueHtml + '</strong></span></div>';
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
                    '<h3>' + escapeHtml(options.title || 'Class Details') + '</h3>' +
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

    // ============================================================
    // REFRESH
    // ============================================================

    function refresh() {
        if (_container) {
            render(_container, _state);
        }
    }

    // ============================================================
    // DESTROY
    // ============================================================

    function destroy() {
        removeAllEventListeners();
        _container = null;
        _state.selectedId = null;
        _state.week = 1;
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function getState() {
        return {
            selectedId: _state.selectedId,
            week: _state.week
        };
    }

    function setState(newState) {
        var changed = false;

        if (newState.selectedId !== undefined && newState.selectedId !== _state.selectedId) {
            _state.selectedId = newState.selectedId;
            changed = true;
        }

        if (newState.week !== undefined && newState.week !== _state.week) {
            var week = parseInt(newState.week, 10);
            if (!isNaN(week) && week >= CalendarConstants.MIN_WEEK && week <= CalendarConstants.MAX_WEEK) {
                _state.week = week;
                changed = true;
            }
        }

        if (changed && _container) {
            refresh();
        }

        return changed;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.__locationCalendarUILoaded = true;

    window.LocationCalendarUI = {
        // Main
        render: render,
        refresh: refresh,
        destroy: destroy,

        // State
        getState: getState,
        setState: setState,

        // Helpers
        getLocations: getLocations,
        getLocationName: getLocationName
    };

})();
