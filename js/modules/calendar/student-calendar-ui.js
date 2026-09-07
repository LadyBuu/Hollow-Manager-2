/**
 * js/modules/calendar/student-calendar-ui.js - Student Calendar UI
 * Thin UI layer for student calendar - event binding, modals, notifications
 * Path: js/modules/calendar/student-calendar-ui.js
 * 
 * This module provides:
 *   - Student calendar rendering (via CalendarRenderer)
 *   - Event binding for student calendar interactions
 *   - Add class modal
 *   - Class details modal
 *   - Rest day management
 *   - Time slot selection
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
 *   - window.CalendarConstants (from calendar-constants.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 * 
 * USAGE:
 *   var ui = window.StudentCalendarUI;
 *   ui.render(container, { selectedId: 'student_123', week: 5 });
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__studentCalendarUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.renderGrid !== 'function') {
        missing.push('CalendarRenderer.renderGrid');
    }

    if (!window.CalendarQueries || typeof window.CalendarQueries.getStudentSchedule !== 'function') {
        missing.push('CalendarQueries.getStudentSchedule');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getStudentRestDays !== 'function') {
        missing.push('CalendarQueries.getStudentRestDays');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getClassDetails !== 'function') {
        missing.push('CalendarQueries.getClassDetails');
    }

    if (!window.ScheduleCore || typeof window.ScheduleCore.setStudentSlot !== 'function') {
        missing.push('ScheduleCore.setStudentSlot');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeStudentSlot !== 'function') {
        missing.push('ScheduleCore.removeStudentSlot');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.setRestDays !== 'function') {
        missing.push('ScheduleCore.setRestDays');
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

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseSlot !== 'function') {
        missing.push('CalendarValidation.parseSlot');
    }

    if (missing.length > 0) {
        throw new Error('[StudentCalendarUI] Missing dependencies: ' + missing.join(', '));
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
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_CLASS_DURATION = CalendarConstants.MAX_CLASS_DURATION;

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
    // GET STUDENTS
    // ============================================================

    function getStudents() {
        return CharacterQueries.getStudents() || [];
    }

    function getStudentName(studentId) {
        var student = CharacterQueries.getCharacterById(studentId);
        return student ? CharacterQueries.getDisplayName(student) : 'Unknown';
    }

    // ============================================================
    // GET SCHEDULE DATA
    // ============================================================

    function getScheduleData(studentId, week) {
        if (!studentId) {
            return {};
        }

        var schedule = CalendarQueries.getStudentSchedule(studentId, week);
        var restDays = CalendarQueries.getStudentRestDays(studentId, week);
        var disciplines = DisciplineQueries.getAvailableDisciplines(week);

        return {
            schedule: schedule,
            restDays: restDays,
            availableDisciplines: disciplines
        };
    }

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(container, state) {
        if (!container) {
            container = document.getElementById('student-calendar');
        }

        if (!container) {
            console.warn('[StudentCalendarUI] Container not found');
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

        // Check if student is selected
        if (!_state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a student to view their schedule</div>';
            return;
        }

        var student = CharacterQueries.getCharacterById(_state.selectedId);
        if (!student) {
            container.innerHTML = '<div class="empty-state">Student not found</div>';
            return;
        }

        var data = getScheduleData(_state.selectedId, _state.week);
        var studentName = CharacterQueries.getDisplayName(student);

        // Prepare data for renderer
        var renderData = {
            schedule: data.schedule,
            restDays: data.restDays,
            entityName: studentName,
            modeLabel: 'Student Schedule',
            getDiscipline: DisciplineQueries.getDiscipline,
            getDuration: function(day, hour) {
                var details = CalendarQueries.getClassDetails(_state.selectedId, _state.week, day, hour);
                return details ? details.duration || 1 : 1;
            },
            getLabel: function(day, hour) {
                var details = CalendarQueries.getClassDetails(_state.selectedId, _state.week, day, hour);
                return details ? details.label || '' : '';
            },
            getInstructorName: function(day, hour) {
                var details = CalendarQueries.getClassDetails(_state.selectedId, _state.week, day, hour);
                if (details && details.instructorId) {
                    var instructor = CharacterQueries.getCharacterById(details.instructorId);
                    return instructor ? CharacterQueries.getDisplayName(instructor) : '';
                }
                return '';
            },
            availableItems: data.availableDisciplines.map(function(d) {
                return {
                    id: d.id,
                    label: d.name,
                    subtitle: 'Available'
                };
            }),
            availableLabel: 'Available Disciplines',
            restDays: data.restDays,
            showEmptySlots: true,
            showRestDays: true
        };

        var html = CalendarRenderer.renderGrid(_state, renderData);
        container.innerHTML = html;

        // Bind events
        bindEvents();
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

            // Empty slot - click to add
            if (slot.classList.contains('schedule-empty') && !slot.classList.contains('schedule-rest-day')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleAddClass(d, h);
                });
            }

            // Occupied slot - click for details
            if (slot.classList.contains('schedule-occupied') && !slot.classList.contains('schedule-blocked')) {
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
                    if (confirm('Remove this class from the schedule?')) {
                        handleRemoveClass(d, h);
                    }
                });
            }

            // Blocked slot - click for details
            if (slot.classList.contains('schedule-blocked')) {
                addEventListener(slot, 'click', function() {
                    notify('This time is blocked.', 'info');
                });
            }
        }

        // Save rest days
        var saveRestBtn = _container.querySelector('#save-rest-days-btn');
        if (saveRestBtn) {
            addEventListener(saveRestBtn, 'click', function() {
                handleSaveRestDays();
            });
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

        // Rest day checkboxes
        var restCheckboxes = _container.querySelectorAll('.rest-day-check');
        for (var k = 0; k < restCheckboxes.length; k++) {
            addEventListener(restCheckboxes[k], 'change', function() {
                // Just update UI - save button handles persistence
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
            notify('No student selected.', 'error');
            return;
        }

        var disciplines = DisciplineQueries.getAvailableDisciplines(_state.week);

        if (disciplines.length === 0) {
            notify('No disciplines available for this week.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        showAddClassModal({
            title: 'Add Class - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_CLASS_DURATION,
            onConfirm: function(disciplineId, duration, label, closeModal) {
                if (hour + duration > CALENDAR_END_HOUR + 1) {
                    notify('Class extends beyond the calendar boundary.', 'error');
                    return;
                }

                // Check for conflicts
                var schedule = CalendarQueries.getStudentSchedule(_state.selectedId, _state.week);
                if (hasRangeOverlap(schedule, _state.selectedId, _state.week, day, hour, duration)) {
                    notify('This would overlap with an existing class.', 'error');
                    return;
                }

                var result = ScheduleCore.setStudentSlot(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    disciplineId,
                    duration
                );

                if (result && result.success) {
                    closeModal();
                    notify('Class added successfully.', 'success');
                    refresh();
                } else {
                    notify(result ? result.message : 'Failed to add class.', 'error');
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

        var details = CalendarQueries.getClassDetails(_state.selectedId, _state.week, day, hour);

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

        showDetailsModal({
            title: disciplineName + (details.label ? ' [' + details.label + ']' : ''),
            details: [
                { label: 'Instructor', value: instructorName },
                { label: 'Day/Time', value: dayName + ' at ' + hourDisplay },
                { label: 'Duration', value: (details.duration || 1) + ' hour(s)' },
                { label: 'Group', value: details.groupLabel || 'None' },
                { label: 'Week', value: _state.week }
            ],
            actions: [
                {
                    label: 'Remove',
                    className: 'danger',
                    handler: function(closeModal) {
                        closeModal();
                        if (confirm('Remove this class from the schedule?')) {
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
            notify('No student selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeStudentSlot(_state.selectedId, _state.week, day, hour);

        if (result && result.success) {
            notify('Class removed from schedule.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to remove class.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Save Rest Days
    // ============================================================

    function handleSaveRestDays() {
        if (!_state.selectedId) {
            notify('No student selected.', 'error');
            return;
        }

        var checkboxes = _container.querySelectorAll('.rest-day-check');
        var days = [];

        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                var day = parseInt(checkboxes[i].dataset.day, 10);
                if (!isNaN(day)) {
                    days.push(day);
                }
            }
        }

        var result = ScheduleCore.setRestDays(_state.selectedId, _state.week, days);

        if (result && result.success) {
            notify('Rest days saved.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Available Item Click
    // ============================================================

    function handleAvailableItemClick(disciplineId) {
        if (!_state.selectedId) {
            notify('No student selected.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            notify('Discipline not found.', 'error');
            return;
        }

        // Find an available slot
        var schedule = CalendarQueries.getStudentSchedule(_state.selectedId, _state.week);
        var restDays = CalendarQueries.getStudentRestDays(_state.selectedId, _state.week);
        var occupiedMap = CalendarRenderer.buildOccupiedMap(schedule);

        var foundSlot = false;

        for (var day = CalendarConstants.MIN_DAY; day <= CalendarConstants.MAX_DAY; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            var availableHours = CalendarRenderer.getAvailableStartHours(occupiedMap, day, 1);
            if (availableHours.length > 0) {
                var hour = availableHours[0];

                var result = ScheduleCore.setStudentSlot(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    disciplineId,
                    1
                );

                if (result && result.success) {
                    notify('Class added at ' + CalendarConstants.getDayName(day) + ' ' + CalendarConstants.formatHour(hour), 'success');
                    refresh();
                    foundSlot = true;
                    break;
                }
            }
        }

        if (!foundSlot) {
            notify('No available slots found for this discipline.', 'warning');
        }
    }

    // ============================================================
    // OVERLAP CHECK
    // ============================================================

    function hasRangeOverlap(schedule, studentId, week, day, startHour, duration) {
        var daySchedule = schedule[day] || {};

        for (var existingHour in daySchedule) {
            if (!Object.prototype.hasOwnProperty.call(daySchedule, existingHour)) {
                continue;
            }

            var disciplineId = daySchedule[existingHour];
            if (!disciplineId) {
                continue;
            }

            var existingStart = parseInt(existingHour, 10);
            if (isNaN(existingStart)) {
                continue;
            }

            var existingDuration = 1;
            var details = CalendarQueries.getClassDetails(studentId, week, day, existingStart);
            if (details) {
                existingDuration = details.duration || 1;
            }

            var existingEnd = existingStart + existingDuration;
            var requestedEnd = startHour + duration;

            if (startHour < existingEnd && requestedEnd > existingStart) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // MODALS - Add Class
    // ============================================================

    function showAddClassModal(options) {
        options = options || {};
        var disciplines = options.disciplines || [];
        var maxDuration = options.maxDuration || MAX_CLASS_DURATION;

        var modal = Modal.createModal('add-class-modal');

        var optionsHTML = '';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            optionsHTML += '<option value="' + escapeAttribute(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }

        var durationOptionsHTML = '';
        for (var h = MIN_CLASS_DURATION; h <= maxDuration; h++) {
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
                var durationSelect = document.getElementById('add-class-duration');
                var duration = durationSelect ? parseInt(durationSelect.value, 10) || 1 : 1;
                var label = document.getElementById('add-class-label');
                var labelValue = label ? label.value.trim() : '';

                if (!disciplineId) {
                    notify('Please select a discipline.', 'error');
                    return;
                }

                if (options.onConfirm) {
                    options.onConfirm(disciplineId, duration, labelValue, closeModal);
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

    window.__studentCalendarUILoaded = true;

    window.StudentCalendarUI = {
        // Main
        render: render,
        refresh: refresh,
        destroy: destroy,

        // State
        getState: getState,
        setState: setState,

        // Helpers
        getStudents: getStudents,
        getStudentName: getStudentName
    };

})();