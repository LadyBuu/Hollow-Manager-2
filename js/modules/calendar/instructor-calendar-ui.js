/**
 * js/modules/calendar/instructor-calendar-ui.js - Instructor Calendar UI
 * Thin UI layer for instructor calendar - templates, blocks, student assignments
 * Path: js/modules/calendar/instructor-calendar-ui.js
 * 
 * This module provides:
 *   - Instructor calendar rendering (via CalendarRenderer)
 *   - Event binding for instructor calendar interactions
 *   - Add template modal
 *   - Add block modal
 *   - Template/block details modal
 *   - Manage students modal
 *   - Template and block removal
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
 *   var ui = window.InstructorCalendarUI;
 *   ui.render(container, { selectedId: 'instructor_123', week: 5 });
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__instructorCalendarUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.renderGrid !== 'function') {
        missing.push('CalendarRenderer.renderGrid');
    }

    // CalendarQueries - READ operations
    if (!window.CalendarQueries || typeof window.CalendarQueries.getInstructorSchedule !== 'function') {
        missing.push('CalendarQueries.getInstructorSchedule');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getInstructorTemplates !== 'function') {
        missing.push('CalendarQueries.getInstructorTemplates');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getInstructorBlocks !== 'function') {
        missing.push('CalendarQueries.getInstructorBlocks');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getAssignedStudents !== 'function') {
        missing.push('CalendarQueries.getAssignedStudents');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getInstructorAvailableDisciplines !== 'function') {
        missing.push('CalendarQueries.getInstructorAvailableDisciplines');
    }

    // ScheduleCore - WRITE operations
    if (!window.ScheduleCore || typeof window.ScheduleCore.setInstructorTemplate !== 'function') {
        missing.push('ScheduleCore.setInstructorTemplate');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeInstructorTemplate !== 'function') {
        missing.push('ScheduleCore.removeInstructorTemplate');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.setInstructorBlock !== 'function') {
        missing.push('ScheduleCore.setInstructorBlock');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeInstructorBlock !== 'function') {
        missing.push('ScheduleCore.removeInstructorBlock');
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
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
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
        throw new Error('[InstructorCalendarUI] Missing dependencies: ' + missing.join(', '));
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
    // GET INSTRUCTORS
    // ============================================================

    function getInstructors() {
        return CharacterQueries.getInstructors() || [];
    }

    function getInstructorName(instructorId) {
        var instructor = CharacterQueries.getCharacterById(instructorId);
        return instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';
    }

    // ============================================================
    // GET SCHEDULE DATA - Uses CalendarQueries for reads
    // ============================================================

    function getScheduleData(instructorId, week) {
        if (!instructorId) {
            return {};
        }

        var schedule = CalendarQueries.getInstructorSchedule(instructorId, week);
        var templates = CalendarQueries.getInstructorTemplates(instructorId, week);
        var blocks = CalendarQueries.getInstructorBlocks(instructorId, week);
        var disciplines = CalendarQueries.getInstructorAvailableDisciplines(instructorId, week);

        return {
            schedule: schedule,
            templates: templates,
            blocks: blocks,
            availableDisciplines: disciplines
        };
    }

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(container, state) {
        if (!container) {
            container = document.getElementById('instructor-calendar');
        }

        if (!container) {
            console.warn('[InstructorCalendarUI] Container not found');
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

        // Check if instructor is selected
        if (!_state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select an instructor to view their calendar</div>';
            return;
        }

        var instructor = CharacterQueries.getCharacterById(_state.selectedId);
        if (!instructor) {
            container.innerHTML = '<div class="empty-state">Instructor not found</div>';
            return;
        }

        var data = getScheduleData(_state.selectedId, _state.week);
        var instructorName = CharacterQueries.getDisplayName(instructor);

        // Build schedule for renderer
        var renderSchedule = {};

        // Add templates to schedule
        for (var key in data.templates) {
            if (!Object.prototype.hasOwnProperty.call(data.templates, key)) {
                continue;
            }
            var parts = key.split('_');
            if (parts.length !== 2) {
                continue;
            }
            var day = parseInt(parts[0], 10);
            var hour = parseInt(parts[1], 10);
            if (isNaN(day) || isNaN(hour)) {
                continue;
            }
            var template = data.templates[key];
            if (!template) {
                continue;
            }
            if (!renderSchedule[day]) {
                renderSchedule[day] = {};
            }
            renderSchedule[day][hour] = template.disciplineId;
        }

        // Add blocks to schedule (mark them differently)
        for (var day in data.blocks) {
            if (!Object.prototype.hasOwnProperty.call(data.blocks, day)) {
                continue;
            }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) {
                continue;
            }
            var dayBlocks = data.blocks[day];
            if (!dayBlocks || typeof dayBlocks !== 'object') {
                continue;
            }
            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) {
                    continue;
                }
                var block = dayBlocks[hour];
                if (!block) {
                    continue;
                }
                if (!renderSchedule[dayNum]) {
                    renderSchedule[dayNum] = {};
                }
                // Use a special marker for blocks - the renderer will check isBlock
                renderSchedule[dayNum][hourNum] = '__blocked__';
            }
        }

        // Prepare data for renderer
        var renderData = {
            schedule: renderSchedule,
            restDays: [],
            entityName: instructorName,
            modeLabel: 'Instructor Schedule',
            getDiscipline: DisciplineQueries.getDiscipline,
            getDuration: function(day, hour) {
                var key = day + '_' + hour;
                if (data.templates[key]) {
                    return data.templates[key].duration || 1;
                }
                if (data.blocks[day] && data.blocks[day][hour]) {
                    return data.blocks[day][hour].duration || 1;
                }
                return 1;
            },
            getLabel: function(day, hour) {
                var key = day + '_' + hour;
                if (data.templates[key]) {
                    return data.templates[key].label || '';
                }
                if (data.blocks[day] && data.blocks[day][hour]) {
                    return data.blocks[day][hour].label || 'Blocked';
                }
                return '';
            },
            getInstructorName: function() {
                return '';
            },
            isBlock: function(day, hour) {
                return data.blocks[day] && data.blocks[day][hour];
            },
            slotMetadata: function(day, hour) {
                var key = day + '_' + hour;
                var metadata = [];

                if (data.templates[key]) {
                    var template = data.templates[key];
                    metadata.push('template');
                    if (template.assignedStudents && template.assignedStudents.length > 0) {
                        metadata.push(template.assignedStudents.length + ' students');
                    }
                }

                if (data.blocks[day] && data.blocks[day][hour]) {
                    metadata.push('blocked');
                }

                if (metadata.length > 0) {
                    return ' [' + metadata.join(' | ') + ']';
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
            showEmptySlots: true,
            showRestDays: false,
            extraSidebar: getInstructorSidebarHTML(_state.selectedId, _state.week, data)
        };

        var html = CalendarRenderer.renderGrid(_state, renderData);
        container.innerHTML = html;

        // Bind events
        bindEvents();
    }

    // ============================================================
    // SIDEBAR - Instructor Stats
    // ============================================================

    function getInstructorSidebarHTML(instructorId, week, data) {
        var templateCount = 0;
        var blockCount = 0;
        var studentCount = 0;

        for (var key in data.templates) {
            if (Object.prototype.hasOwnProperty.call(data.templates, key)) {
                templateCount++;
                var template = data.templates[key];
                if (template.assignedStudents) {
                    studentCount += template.assignedStudents.length;
                }
            }
        }

        for (var day in data.blocks) {
            if (Object.prototype.hasOwnProperty.call(data.blocks, day)) {
                var dayBlocks = data.blocks[day];
                if (dayBlocks && typeof dayBlocks === 'object') {
                    blockCount += Object.keys(dayBlocks).length;
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
        html += '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Click a slot to add template | Right-click to remove';
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

            // Empty slot - click to add template
            if (slot.classList.contains('schedule-empty')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleAddTemplate(d, h);
                });
            }

            // Occupied slot - click for details
            if (slot.classList.contains('schedule-occupied')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleTemplateDetails(d, h);
                });

                // Right-click to remove
                addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this template/block?')) {
                        handleRemoveSlot(d, h);
                    }
                });
            }

            // Blocked slot - click for details
            if (slot.classList.contains('schedule-blocked')) {
                addEventListener(slot, 'click', function() {
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    handleBlockDetails(d, h);
                });

                // Right-click to remove block
                addEventListener(slot, 'contextmenu', function(e) {
                    e.preventDefault();
                    var d = parseInt(this.dataset.day, 10);
                    var h = parseInt(this.dataset.hour, 10);
                    if (confirm('Remove this block?')) {
                        handleRemoveBlock(d, h);
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
    // HANDLERS - Add Template (Uses ScheduleCore for write)
    // ============================================================

    function handleAddTemplate(day, hour) {
        if (!_state.selectedId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var disciplines = CalendarQueries.getInstructorAvailableDisciplines(_state.selectedId, _state.week);

        if (disciplines.length === 0) {
            notify('No disciplines available for this instructor this week.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        showAddTemplateModal({
            title: 'Add Class Template - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_CLASS_DURATION,
            onConfirm: function(disciplineId, duration, label, closeModal) {
                if (hour + duration > CALENDAR_END_HOUR + 1) {
                    notify('Template extends beyond the calendar boundary.', 'error');
                    return;
                }

                // Use ScheduleCore for mutation
                var result = ScheduleCore.setInstructorTemplate(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    disciplineId,
                    duration,
                    label
                );

                if (result && result.success) {
                    closeModal();
                    notify('Template added successfully.', 'success');
                    refresh();
                } else {
                    notify(result ? result.message : 'Failed to add template.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // HANDLERS - Template Details (Uses CalendarQueries for read)
    // ============================================================

    function handleTemplateDetails(day, hour) {
        if (!_state.selectedId) {
            return;
        }

        var key = day + '_' + hour;
        var templates = CalendarQueries.getInstructorTemplates(_state.selectedId, _state.week);
        var template = templates[key];

        if (!template) {
            notify('Template not found.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(template.disciplineId);
        var disciplineName = discipline ? discipline.name : 'Unknown';

        // Get assigned students using CalendarQueries
        var assignedStudents = CalendarQueries.getAssignedStudents(_state.selectedId, _state.week, day, hour);

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        var studentNames = [];
        if (assignedStudents && assignedStudents.length > 0) {
            for (var i = 0; i < assignedStudents.length; i++) {
                var student = assignedStudents[i];
                var studentChar = CharacterQueries.getCharacterById(student.studentId);
                if (studentChar) {
                    studentNames.push(CharacterQueries.getDisplayName(studentChar));
                }
            }
        }

        var studentList = studentNames.length > 0 ? studentNames.join(', ') : 'None';

        showDetailsModal({
            title: disciplineName + (template.label ? ' [' + template.label + ']' : ''),
            details: [
                { label: 'Day/Time', value: dayName + ' at ' + hourDisplay },
                { label: 'Duration', value: (template.duration || 1) + ' hour(s)' },
                { label: 'Group', value: template.groupLabel || 'None' },
                { label: 'Students', value: assignedStudents ? assignedStudents.length + ' - ' + studentList : '0' },
                { label: 'Week', value: _state.week }
            ],
            actions: [
                {
                    label: 'Manage Students',
                    className: 'primary',
                    handler: function(closeModal) {
                        closeModal();
                        handleManageStudents(day, hour);
                    }
                },
                {
                    label: 'Remove Template',
                    className: 'danger',
                    handler: function(closeModal) {
                        closeModal();
                        if (confirm('Remove this template?')) {
                            handleRemoveSlot(day, hour);
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
    // HANDLERS - Block Details (Uses CalendarQueries for read)
    // ============================================================

    function handleBlockDetails(day, hour) {
        if (!_state.selectedId) {
            return;
        }

        var blocks = CalendarQueries.getInstructorBlocks(_state.selectedId, _state.week);
        var block = blocks[day] && blocks[day][hour];

        if (!block) {
            notify('Block not found.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarConstants.formatHour(hour);

        showDetailsModal({
            title: block.label || 'Blocked Time',
            details: [
                { label: 'Day/Time', value: dayName + ' at ' + hourDisplay },
                { label: 'Duration', value: (block.duration || 1) + ' hour(s)' },
                { label: 'Group', value: block.groupLabel || 'None' },
                { label: 'Week', value: _state.week }
            ],
            actions: [
                {
                    label: 'Remove Block',
                    className: 'danger',
                    handler: function(closeModal) {
                        closeModal();
                        if (confirm('Remove this block?')) {
                            handleRemoveBlock(day, hour);
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
    // HANDLERS - Manage Students (Uses ScheduleCore for write)
    // ============================================================

    function handleManageStudents(day, hour) {
        if (!_state.selectedId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var assignedStudents = CalendarQueries.getAssignedStudents(_state.selectedId, _state.week, day, hour);
        var allStudents = CharacterQueries.getStudents() || [];

        var assignedIds = {};
        for (var i = 0; i < assignedStudents.length; i++) {
            assignedIds[assignedStudents[i].studentId] = true;
        }

        var students = allStudents.map(function(student) {
            return {
                id: student.id,
                name: CharacterQueries.getDisplayName(student),
                assigned: !!assignedIds[student.id]
            };
        });

        var key = day + '_' + hour;
        var templates = CalendarQueries.getInstructorTemplates(_state.selectedId, _state.week);
        var template = templates[key];
        var disciplineName = template ? DisciplineQueries.getDiscipline(template.disciplineId) : 'Unknown';

        showManageStudentsModal({
            title: 'Manage Students - ' + (disciplineName.name || 'Unknown'),
            students: students,
            onConfirm: function(selectedStudents, closeModal) {
                // Use ScheduleCore to update template with selected students
                var updateResult = ScheduleCore.setInstructorTemplate(
                    _state.selectedId,
                    _state.week,
                    day,
                    hour,
                    template.disciplineId,
                    template.duration,
                    template.label,
                    selectedStudents
                );

                if (updateResult && updateResult.success) {
                    closeModal();
                    notify('Student assignments updated.', 'success');
                    refresh();
                } else {
                    notify(updateResult ? updateResult.message : 'Failed to update student assignments.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // HANDLERS - Remove Slot (Uses ScheduleCore for write)
    // ============================================================

    function handleRemoveSlot(day, hour) {
        if (!_state.selectedId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeInstructorTemplate(_state.selectedId, _state.week, day, hour);

        if (result && result.success) {
            notify('Template removed successfully.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to remove template.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Remove Block (Uses ScheduleCore for write)
    // ============================================================

    function handleRemoveBlock(day, hour) {
        if (!_state.selectedId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var result = ScheduleCore.removeInstructorBlock(_state.selectedId, _state.week, day, hour);

        if (result && result.success) {
            notify('Block removed successfully.', 'success');
            refresh();
        } else {
            notify(result ? result.message : 'Failed to remove block.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Available Item Click (Uses ScheduleCore for write)
    // ============================================================

    function handleAvailableItemClick(disciplineId) {
        if (!_state.selectedId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            notify('Discipline not found.', 'error');
            return;
        }

        // Find an available slot using CalendarQueries
        var schedule = CalendarQueries.getInstructorSchedule(_state.selectedId, _state.week);
        var foundSlot = false;

        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            for (var hour = CALENDAR_START_HOUR; hour <= CALENDAR_END_HOUR; hour++) {
                if (!schedule[day] || !schedule[day][hour]) {
                    var result = ScheduleCore.setInstructorTemplate(
                        _state.selectedId,
                        _state.week,
                        day,
                        hour,
                        disciplineId,
                        1,
                        ''
                    );

                    if (result && result.success) {
                        notify('Template added at ' + CalendarConstants.getDayName(day) + ' ' + CalendarConstants.formatHour(hour), 'success');
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
    // MODALS - Add Template
    // ============================================================

    function showAddTemplateModal(options) {
        options = options || {};
        var disciplines = options.disciplines || [];
        var maxDuration = options.maxDuration || MAX_CLASS_DURATION;

        var modal = Modal.createModal('add-template-modal');

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
                    '<h3>' + escapeHtml(options.title || 'Add Class Template') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-template-select" class="modal-select">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration:</label>' +
                        '<select id="add-template-duration" class="modal-select">' +
                            durationOptionsHTML +
                        '</select>' +
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

        var cancelBtn = modal.querySelector('#cancel-add-template');
        if (cancelBtn) {
            cancelBtn.onclick = closeModal;
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
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

    // ============================================================
    // MODALS - Manage Students
    // ============================================================

    function showManageStudentsModal(options) {
        options = options || {};
        var students = options.students || [];

        var modal = Modal.createModal('manage-students-modal');

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

    window.__instructorCalendarUILoaded = true;

    window.InstructorCalendarUI = {
        // Main
        render: render,
        refresh: refresh,
        destroy: destroy,

        // State
        getState: getState,
        setState: setState,

        // Helpers
        getInstructors: getInstructors,
        getInstructorName: getInstructorName
    };

})();
