/**
 * modules/calendar/instructor-calendar-ui.js - Instructor Calendar UI
 * Thin UI layer for instructor calendar
 * 
 * IMPORTANT:
 *   - THIN - orchestrates interaction only
 *   - Uses CalendarAggregator for reads
 *   - Uses ScheduleCore for mutations
 *   - Uses CalendarRenderer for HTML
 *   - No direct external domain access
 * 
 * DEPENDENCIES:
 *   - CalendarUIBase
 *   - CalendarAggregator
 *   - CalendarRenderer
 *   - ScheduleCore
 *   - CalendarConstants
 */

(function() {
    'use strict';

    if (window.__instructorCalendarUILoaded) { return; }
    window.__instructorCalendarUILoaded = true;

    var UIBase = window.CalendarUIBase;
    var Aggregator = window.CalendarAggregator;
    var Renderer = window.CalendarRenderer;
    var ScheduleCore = window.ScheduleCore;
    var CC = window.CalendarConstants;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;

    // ============================================================
    // STATE
    // ============================================================

    var _state = { selectedId: null, week: 1 };
    var _container = null;
    var _listeners = [];

    // ============================================================
    // HELPERS
    // ============================================================

    function getInstructors() {
        return CharacterQueries.getInstructors() || [];
    }

    function getInstructorName(instructorId) {
        return CharacterQueries.getCharacterNameById(instructorId);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container, state) {
        if (!container) { container = document.getElementById('instructor-calendar'); }
        if (!container) { return; }

        _container = container;
        if (state) {
            if (state.selectedId !== undefined) { _state.selectedId = state.selectedId; }
            if (state.week !== undefined) { _state.week = state.week; }
        }

        UIBase.removeAllEventListeners(_listeners);
        _listeners = [];

        if (!_state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select an instructor to view their calendar</div>';
            bindEntitySelector();
            return;
        }

        var instructor = CharacterQueries.getCharacterById(_state.selectedId);
        if (!instructor) {
            container.innerHTML = '<div class="empty-state">Instructor not found</div>';
            bindEntitySelector();
            return;
        }

        var calendar = Aggregator.getInstructorCalendar(_state.selectedId, _state.week);
        var viewModel = {
            schedule: calendar.templates,
            restDays: [],
            entityName: calendar.instructorName,
            modeLabel: 'Instructor Schedule',
            showEmptySlots: true,
            showRestDays: false,
            hours: getAvailableHours()
        };

        var html = Renderer.renderGrid({ selectedId: _state.selectedId, week: _state.week }, viewModel);
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

            if (slot.classList.contains('schedule-empty')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleAddTemplate(d, h);
                });
                if (listener) { _listeners.push(listener); }
            }

            if (slot.classList.contains('schedule-occupied')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleTemplateDetails(d, h);
                });
                if (listener) { _listeners.push(listener); }

                var listener2 = UIBase.addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this template?')) {
                        handleRemoveTemplate(d, h);
                    }
                });
                if (listener2) { _listeners.push(listener2); }
            }

            if (slot.classList.contains('schedule-blocked')) {
                var listener = UIBase.addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleBlockDetails(d, h);
                });
                if (listener) { _listeners.push(listener); }

                var listener2 = UIBase.addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this block?')) {
                        handleRemoveBlock(d, h);
                    }
                });
                if (listener2) { _listeners.push(listener2); }
            }
        }
    }

    // ============================================================
    // ENTITY SELECTOR
    // ============================================================

    function bindEntitySelector() {
        if (!_container) { return; }
        var select = _container.querySelector('.instructor-select');
        if (!select) { return; }

        var instructors = getInstructors();
        UIBase.populateSelect(select, instructors, function(s) { return s.id; }, function(s) {
            return CharacterQueries.getDisplayName(s);
        }, _state.selectedId);

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

    function handleAddTemplate(day, hour) {
        if (!_state.selectedId) {
            UIBase.notify('No instructor selected.', 'error');
            return;
        }

        var disciplines = Aggregator.getInstructorAvailableDisciplines(_state.selectedId, _state.week);
        if (disciplines.length === 0) {
            UIBase.notify('No disciplines available for this instructor this week.', 'error');
            return;
        }

        var dayName = CC.getDayName(day);
        var hourDisplay = CC.formatHour(hour);

        var modal = UIBase.createModal('add-template-modal');
        if (!modal) { UIBase.notify('Could not create modal.', 'error'); return; }

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
                    '<h3>Add Template - ' + UIBase.escapeHtml(dayName) + ' at ' + UIBase.escapeHtml(hourDisplay) + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-template-select" class="modal-select">' + optionsHTML + '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration:</label>' +
                        '<select id="add-template-duration" class="modal-select">' + durationOptionsHTML + '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Label (optional):</label>' +
                        '<input type="text" id="add-template-label" class="modal-input" placeholder="e.g., A, B, Group 1...">' +
                    '</div>' +
                    '<div class="form-actions">' +
                        '<button type="button" id="cancel-add-template" class="secondary">Cancel</button>' +
                        '<button type="button" id="confirm-add-template" class="primary">Add Template</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);
        UIBase.modalSetup(modal, function() { if (modal.parentNode) { modal.parentNode.removeChild(modal); } });

        var closeModal = function() {
            if (modal.parentNode) { modal.parentNode.removeChild(modal); }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.onclick = closeModal; }

        var cancelBtn = modal.querySelector('#cancel-add-template');
        if (cancelBtn) { cancelBtn.onclick = closeModal; }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { closeModal(); }
        });

        var confirmBtn = modal.querySelector('#confirm-add-template');
        if (confirmBtn) {
            confirmBtn.onclick = function() {
                var select = document.getElementById('add-template-select');
                var disciplineId = select ? select.value : null;
                var durationSelect = document.getElementById('add-template-duration');
                var duration = durationSelect ? parseInt(durationSelect.value, 10) || 1 : 1;
                var label = document.getElementById('add-template-label');
                var labelValue = label ? label.value.trim() : '';

                if (!disciplineId) {
                    UIBase.notify('Please select a discipline.', 'error');
                    return;
                }

                if (hour + duration > CC.CALENDAR_END_HOUR + 1) {
                    UIBase.notify('Template extends beyond the calendar boundary.', 'error');
                    return;
                }

                var result = ScheduleCore.setInstructorTemplate(_state.selectedId, _state.week, day, hour, disciplineId, duration, labelValue);
                if (result && result.success) {
                    closeModal();
                    UIBase.notify('Template added successfully.', 'success');
                    render(_container, _state);
                } else {
                    UIBase.notify(result ? result.message : 'Failed to add template.', 'error');
                }
            };
        }
    }

    function handleTemplateDetails(day, hour) {
        if (!_state.selectedId) { return; }

        var templates = window.CalendarQueries.getInstructorTemplates(_state.selectedId, _state.week);
        var key = String(day) + '_' + String(hour);
        var template = templates[key];

        if (!template) {
            UIBase.notify('Template not found.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(template.disciplineId);
        var disciplineName = discipline ? discipline.name : 'Unknown';
        var dayName = CC.getDayName(day);
        var hourDisplay = CC.formatHour(hour);

        var assignedStudents = Aggregator.getAssignedStudents(_state.selectedId, _state.week, day, hour);
        var studentNames = assignedStudents.map(function(s) { return s.studentName; }).join(', ') || 'None';

        var modal = UIBase.createModal('details-modal');
        if (!modal) { UIBase.notify('Could not create modal.', 'error'); return; }

        modal.innerHTML = (
            '<div class="modal-content modal-detail-content">' +
                '<div class="modal-header">' +
                    '<h3>' + UIBase.escapeHtml(disciplineName) + (template.label ? ' [' + UIBase.escapeHtml(template.label) + ']' : '') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="detail-label">Day/Time:</span> <span class="detail-value"><strong>' +
                        UIBase.escapeHtml(dayName + ' at ' + hourDisplay) + '</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Duration:</span> <span class="detail-value"><strong>' +
                        (template.duration || 1) + ' hour(s)</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Students:</span> <span class="detail-value"><strong>' +
                        assignedStudents.length + ' - ' + UIBase.escapeHtml(studentNames) + '</strong></span></div>' +
                    '<div class="detail-row"><span class="detail-label">Week:</span> <span class="detail-value"><strong>' +
                        _state.week + '</strong></span></div>' +
                    '<div class="detail-actions">' +
                        '<button type="button" id="remove-template-btn" class="danger small">Remove</button>' +
                        '<button type="button" id="close-detail" class="secondary small">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);
        UIBase.modalSetup(modal, function() { if (modal.parentNode) { modal.parentNode.removeChild(modal); } });

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

        var removeBtn = modal.querySelector('#remove-template-btn');
        if (removeBtn) {
            removeBtn.onclick = function() {
                closeModal();
                if (confirm('Remove this template?')) {
                    handleRemoveTemplate(day, hour);
                }
            };
        }
    }

    function handleRemoveTemplate(day, hour) {
        if (!_state.selectedId) {
            UIBase.notify('No instructor selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeInstructorTemplate(_state.selectedId, _state.week, day, hour);
        if (result && result.success) {
            UIBase.notify('Template removed successfully.', 'success');
            render(_container, _state);
        } else {
            UIBase.notify(result ? result.message : 'Failed to remove template.', 'error');
        }
    }

    function handleBlockDetails(day, hour) {
        UIBase.notify('This time is blocked.', 'info');
    }

    function handleRemoveBlock(day, hour) {
        if (!_state.selectedId) {
            UIBase.notify('No instructor selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeInstructorBlock(_state.selectedId, _state.week, day, hour);
        if (result && result.success) {
            UIBase.notify('Block removed successfully.', 'success');
            render(_container, _state);
        } else {
            UIBase.notify(result ? result.message : 'Failed to remove block.', 'error');
        }
    }

    function getAvailableHours() {
        var hours = [];
        for (var h = CC.CALENDAR_START_HOUR; h <= CC.CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }
        return hours;
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

    window.InstructorCalendarUI = {
        render: render,
        destroy: destroy,
        getState: getState,
        setState: setState,
        getInstructors: getInstructors,
        getInstructorName: getInstructorName
    };

})();
