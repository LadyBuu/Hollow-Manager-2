/**
 * modules/calendar/student-calendar-ui.js - Student Calendar UI
 * Thin UI layer for the student calendar
 * Path: js/modules/calendar/student-calendar-ui.js
 * 
 * IMPORTANT:
 *   - THIN UI LAYER - orchestrates interaction only
 *   - Uses CalendarAggregator for reads (cross-domain resolved view models)
 *   - Uses ScheduleCore for mutations
 *   - Uses CalendarRenderer for HTML generation
 *   - Uses CalendarUIBase for shared UI helpers
 *   - Persists changes via window.saveData() after every ScheduleCore mutation
 *   - No direct external domain access
 *   - No direct window.data access
 * 
 * DEPENDENCIES:
 *   - window.CalendarUIBase
 *   - window.CalendarAggregator
 *   - window.CalendarRenderer
 *   - window.ScheduleCore
 *   - window.CalendarConstants
 *   - window.CharacterQueries
 *   - window.DisciplineQueries
 *   - window.CalendarQueries (for class details lookup)
 * 
 * USAGE:
 *   var ui = window.StudentCalendarUI;
 *   ui.render(container, { selectedId: 'char_123', week: 5 });
 */

(function() {
    'use strict';

    // ============================================================
    // LOAD GUARD - set immediately so re-inclusion is a no-op
    // ============================================================

    if (window.__studentCalendarUILoaded) { return; }
    window.__studentCalendarUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var UIBase = window.CalendarUIBase;
    var Aggregator = window.CalendarAggregator;
    var Renderer = window.CalendarRenderer;
    var ScheduleCore = window.ScheduleCore;
    var CC = window.CalendarConstants;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarQueries = window.CalendarQueries;

    // ============================================================
    // STATE
    // ============================================================

    var _state = { selectedId: null, week: 1 };
    var _container = null;
    var _listeners = [];

    // ============================================================
    // HELPERS
    // ============================================================

    function getStudents() {
        return CharacterQueries.getStudents() || [];
    }

    function getStudentName(studentId) {
        var student = CharacterQueries.getCharacterById(studentId);
        return student ? CharacterQueries.getDisplayName(student) : 'Unknown';
    }

    function getAvailableHours() {
        var hours = [];
        for (var h = CC.CALENDAR_START_HOUR; h <= CC.CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }
        return hours;
    }

    /**
     * Persist the current data state after a ScheduleCore mutation.
     * ScheduleCore mutates window.data.curriculum synchronously and does
     * NOT persist. Callers must invoke saveData() themselves.
     */
    function persist() {
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                UIBase.notify('Changes applied but failed to save.', 'error');
            });
        }
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container, state) {
        if (!container) { container = document.getElementById('student-calendar'); }
        if (!container) { return; }

        _container = container;
        if (state) {
            if (state.selectedId !== undefined) { _state.selectedId = state.selectedId; }
            if (state.week !== undefined) { _state.week = state.week; }
        }

        UIBase.removeAllEventListeners(_listeners);
        _listeners = [];

        if (!_state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a student to view their schedule</div>';
            bindEntitySelector();
            return;
        }

        var student = CharacterQueries.getCharacterById(_state.selectedId);
        if (!student) {
            container.innerHTML = '<div class="empty-state">Student not found</div>';
            bindEntitySelector();
            return;
        }

        var calendar = Aggregator.getStudentCalendar(_state.selectedId, _state.week);
        var viewModel = {
            schedule: calendar.schedule,
            restDays: calendar.restDays,
            entityName: calendar.studentName,
            modeLabel: 'Student Schedule',
            showEmptySlots: true,
            showRestDays: true,
            hours: getAvailableHours()
        };

        var html = Renderer.renderGrid(
            { selectedId: _state.selectedId, week: _state.week },
            viewModel
        );
        container.innerHTML = html;

        bindEvents();
        bindEntitySelector();
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents() {
        if (!_container) { return; }

        var slots = _container.querySelectorAll('.schedule-slot');
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            var day = parseInt(slot.dataset.day, 10);
            var hour = parseInt(slot.dataset.hour, 10);
            if (isNaN(day) || isNaN(hour)) { continue; }

            if (slot.classList.contains('schedule-empty') && !slot.classList.contains('schedule-rest-day')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleAddClass(d, h);
                });
                if (listener) { _listeners.push(listener); }
            }

            if (slot.classList.contains('schedule-occupied') && !slot.classList.contains('schedule-blocked')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleClassDetails(d, h);
                });
                if (listener) { _listeners.push(listener); }

                var listener2 = UIBase.addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this class from the schedule?')) {
                        handleRemoveClass(d, h);
                    }
                });
                if (listener2) { _listeners.push(listener2); }
            }

            if (slot.classList.contains('schedule-blocked')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    UIBase.notify('This time is blocked.', 'info');
                });
                if (listener) { _listeners.push(listener); }
            }
        }
    }

    // ============================================================
    // ENTITY SELECTOR
    // ============================================================

    function bindEntitySelector() {
        if (!_container) { return; }
        var select = _container.querySelector('.student-select');
        if (!select) { return; }

        var students = getStudents();
        UIBase.populateSelect(
            select,
            students,
            function(s) { return s.id; },
            function(s) { return CharacterQueries.getDisplayName(s); },
            _state.selectedId
        );

        var listener = UIBase.addEventListener(select, 'change', function() {
            var id = this.value;
            if (id) { selectEntity(id); }
        });
        if (listener) { _listeners.push(listener); }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function selectEntity(id) {
        if (id === _state.selectedId) { return; }
        _state.selectedId = id;
        render(_container, _state);
    }

    function handleAddClass(day, hour) {
        if (!_state.selectedId) {
            UIBase.notify('No student selected.', 'error');
            return;
        }

        var disciplines = DisciplineQueries.getAvailableDisciplines(_state.week);
        if (disciplines.length === 0) {
            UIBase.notify('No disciplines available for this week.', 'error');
            return;
        }

        var dayName = CC.getDayName(day);
        var hourDisplay = CC.formatHour(hour);

        var modal = UIBase.createModal('add-class-modal');
        if (!modal) {
            UIBase.notify('Could not create modal.', 'error');
            return;
        }

        var optionsHTML = '';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            optionsHTML += '<option value="' + UIBase.escapeAttribute(d.id) + '">' + UIBase.escapeHtml(d.name) + '</option>';
        }

        var durationOptionsHTML = '';
        for (var h = CC.MIN_CLASS_DURATION; h <= CC.MAX_CLASS_DURATION; h++) {
            durationOptionsHTML += '<option value="' + h + '">' + h + ' hour' + (h > 1 ? 's' : '') + '</option>';
        }

        modal.innerHTML = (
            '<div class="modal-content modal-form-content">' +
                '<div class="modal-header">' +
                    '<h3>Add Class - ' + UIBase.escapeHtml(dayName) + ' at ' + UIBase.escapeHtml(hourDisplay) + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-class-select" class="modal-select">' + optionsHTML + '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration:</label>' +
                        '<select id="add-class-duration" class="modal-select">' + durationOptionsHTML + '</select>' +
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
        UIBase.modalSetup(modal, function() {
            if (modal.parentNode) { modal.parentNode.removeChild(modal); }
        });

        var closeModal = function() {
            if (modal.parentNode) { modal.parentNode.removeChild(modal); }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.onclick = closeModal; }

        var cancelBtn = modal.querySelector('#cancel-add-class');
        if (cancelBtn) { cancelBtn.onclick = closeModal; }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { closeModal(); }
        });

        var confirmBtn = modal.querySelector('#confirm-add-class');
        if (confirmBtn) {
            confirmBtn.onclick = function() {
                var select = document.getElementById('add-class-select');
                var disciplineId = select ? select.value : null;
                var durationSelect = document.getElementById('add-class-duration');
                var duration = durationSelect ? parseInt(durationSelect.value, 10) || 1 : 1;
                var labelInput = document.getElementById('add-class-label');
                var labelValue = labelInput ? labelInput.value.trim() : '';

                if (!disciplineId) {
                    UIBase.notify('Please select a discipline.', 'error');
                    return;
                }

                if (hour + duration > CC.CALENDAR_END_HOUR + 1) {
                    UIBase.notify('Class extends beyond the calendar boundary.', 'error');
                    return;
                }

                var metadata = {};
                if (labelValue) { metadata.label = labelValue; }

                var result = ScheduleCore.setStudentSlot(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    disciplineId,
                    duration,
                    metadata
                );

                if (result && result.success) {
                    persist();
                    closeModal();
                    UIBase.notify('Class added successfully.', 'success');
                    render(_container, _state);
                } else {
                    UIBase.notify(result ? result.message : 'Failed to add class.', 'error');
                }
            };
        }
    }

    function handleClassDetails(day, hour) {
        if (!_state.selectedId) { return; }

        var details = Aggregator.getClassDetails(_state.selectedId, _state.week, day, hour);
        if (!details) {
            UIBase.notify('Class not found.', 'error');
            return;
        }

        var dayName = CC.getDayName(day);
        var hourDisplay = CC.formatHour(hour);

        var modal = UIBase.createModal('details-modal');
        if (!modal) {
            UIBase.notify('Could not create modal.', 'error');
            return;
        }

        modal.innerHTML = (
            '<div class="modal-content modal-detail-content">' +
                '<div class="modal-header">' +
                    '<h3>' + UIBase.escapeHtml(details.disciplineName) + (details.label ? ' [' + UIBase.escapeHtml(details.label) + ']' : '') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="detail-label">Instructor:</span> <span class="detail-value"><strong>' +
                        UIBase.escapeHtml(details.instructorName || 'Not assigned') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Day/Time:</span> <span class="detail-value"><strong>' +
                        UIBase.escapeHtml(dayName + ' at ' + hourDisplay) + '</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Duration:</span> <span class="detail-value"><strong>' +
                        (details.duration || 1) + ' hour(s)</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Group:</span> <span class="detail-value"><strong>' +
                        UIBase.escapeHtml(details.groupLabel || 'None') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Week:</span> <span class="detail-value"><strong>' +
                        _state.week + '</strong></span></div>' +
                    '<div class="detail-actions">' +
                        '<button type="button" id="remove-class-btn" class="danger small">Remove</button>' +
                        '<button type="button" id="close-detail" class="secondary small">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);
        UIBase.modalSetup(modal, function() {
            if (modal.parentNode) { modal.parentNode.removeChild(modal); }
        });

        var closeModal = function() {
            if (modal.parentNode) { modal.parentNode.removeChild(modal); }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.onclick = closeModal; }

        var closeDetailBtn = modal.querySelector('#close-detail');
        if (closeDetailBtn) { closeDetailBtn.onclick = closeModal; }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { closeModal(); }
        });

        var removeBtn = modal.querySelector('#remove-class-btn');
        if (removeBtn) {
            removeBtn.onclick = function() {
                closeModal();
                if (confirm('Remove this class from the schedule?')) {
                    handleRemoveClass(day, hour);
                }
            };
        }
    }

    function handleRemoveClass(day, hour) {
        if (!_state.selectedId) {
            UIBase.notify('No student selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeStudentSlot(_state.selectedId, _state.week, day, hour);
        if (result && result.success) {
            persist();
            UIBase.notify('Class removed from schedule.', 'success');
            render(_container, _state);
        } else {
            UIBase.notify(result ? result.message : 'Failed to remove class.', 'error');
        }
    }

    function handleSaveRestDays() {
        if (!_state.selectedId) {
            UIBase.notify('No student selected.', 'error');
            return;
        }

        var checkboxes = _container.querySelectorAll('.rest-day-check');
        var days = [];

        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                var day = parseInt(checkboxes[i].dataset.day, 10);
                if (!isNaN(day)) { days.push(day); }
            }
        }

        var result = ScheduleCore.setRestDays(_state.selectedId, _state.week, days);
        if (result && result.success) {
            persist();
            UIBase.notify('Rest days saved.', 'success');
            render(_container, _state);
        } else {
            UIBase.notify(result ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getState() { return { selectedId: _state.selectedId, week: _state.week }; }

    function setState(newState) {
        var changed = false;

        if (newState.selectedId !== undefined && newState.selectedId !== _state.selectedId) {
            _state.selectedId = newState.selectedId;
            changed = true;
        }

        if (newState.week !== undefined && newState.week !== _state.week) {
            var week = parseInt(newState.week, 10);
            if (!isNaN(week) && week >= CC.MIN_WEEK && week <= CC.MAX_WEEK) {
                _state.week = week;
                changed = true;
            }
        }

        if (changed && _container) { render(_container, _state); }
        return changed;
    }

    function destroy() {
        UIBase.removeAllEventListeners(_listeners);
        _container = null;
        _state.selectedId = null;
        _state.week = 1;
    }

    window.StudentCalendarUI = {
        render: render,
        destroy: destroy,
        getState: getState,
        setState: setState,
        getStudents: getStudents,
        getStudentName: getStudentName
    };

})();
