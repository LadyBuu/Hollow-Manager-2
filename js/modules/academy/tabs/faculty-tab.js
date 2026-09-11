/**
 * modules/academy/tabs/faculty-tab.js - Faculty Sub-Tab
 * Handles instructor management, schedules, locations, and auto-groups
 * 
 * This module is responsible for:
 *   - Instructor list filtered by class
 *   - Instructor schedule (templates + blocks)
 *   - Location schedule
 *   - Auto-groups (discipline + instructor)
 *   - Discipline/curriculum management
 * 
 * IMPORTANT:
 *   - UI-ONLY - all mutations delegate to domain cores
 *   - Uses AcademyDisciplines DIRECTLY for discipline CRUD
 *   - Uses AcademyLocations DIRECTLY for location CRUD
 *   - Uses AcademyUI for state management
 *   - Uses AcademyAggregator for projections
 *   - Uses AcademySchedule for schedule operations
 *   - Uses CalendarQueries for schedule reads
 *   - Uses AcademyQueries for read-only access
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * PROMISE CONTRACT:
 *   - AcademyDisciplines.create / update / delete return PLAIN OBJECTS
 *     (not Promises). They follow the candidate-based pattern and are
 *     synchronous from the caller's perspective.
 *   - AcademyLocations.create / update / delete return PLAIN OBJECTS
 *     (not Promises). Same.
 *   - AcademySchedule schedule reads are synchronous.
 *   - ScheduleCore writes are synchronous (return result objects).
 * 
 * KNOWN STUBS:
 *   The following handlers are currently stubs and show an informational
 *   notification instead of performing their intended operation. They
 *   will be wired to AcademySchedule / ScheduleCore when the schedule
 *   UI is properly implemented:
 *     - handleAddSchedule
 *     - handleRemoveSchedule
 *     - handleAddBlock
 *     - handleRemoveBlock
 *     - location class assignment (bindLocationModalEvents)
 *   These are NOT v15 data-model regressions. They were stubs before the
 *   v15 pass and remain stubs after it.
 * 
 * DEPENDENCIES:
 *   - window.AcademyUI (from academy-ui.js) - MANDATORY
 *   - window.AcademyAggregator (from academy-aggregator.js) - MANDATORY
 *   - window.AcademyDisciplines (from academy-disciplines.js) - MANDATORY
 *   - window.AcademyLocations (from academy-locations.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.AcademySchedule (from academy-schedule.js) - MANDATORY
 *   - window.AcademyGroups (from academy-groups.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CalendarQueries (from calendar-queries.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 * 
 * USAGE:
 *   var tab = window.FacultyTab;
 *   var html = tab.render(state);
 *   tab.bindEvents(container);
 */

(function() {
    'use strict';

    if (window.__facultyTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - DIRECT (no lazy loading for these)
    // ============================================================
    // AcademyDisciplines and AcademyLocations load before this file
    // in the current script order. They are captured directly.

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var AcademyQueries = window.AcademyQueries;
    var AcademySchedule = window.AcademySchedule;
    var AcademyGroups = window.AcademyGroups;
    var CharacterQueries = window.CharacterQueries;
    var CalendarQueries = window.CalendarQueries;
    var CalendarConstants = window.CalendarConstants;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY RESOLUTION - LAZY (defensive)
    // ============================================================
    // Accessors for modules that could conceivably load after this
    // file if script order is ever changed. Cheap insurance.

    function getAcademyDisciplines() { return window.AcademyDisciplines || null; }
    function getAcademyLocations() { return window.AcademyLocations || null; }
    function getAcademySchedule() { return window.AcademySchedule || null; }
    function getTeamCore() { return window.TeamCore || null; }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
            missing.push('AcademyUI.getSelectedClassId');
        }
        if (!AcademyUI || typeof AcademyUI.getSelectedInstructorId !== 'function') {
            missing.push('AcademyUI.getSelectedInstructorId');
        }
        if (!AcademyUI || typeof AcademyUI.selectInstructor !== 'function') {
            missing.push('AcademyUI.selectInstructor');
        }
        if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
            missing.push('AcademyUI.getDisplayWeek');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getInstructorViewModel !== 'function') {
            missing.push('AcademyAggregator.getInstructorViewModel');
        }

        // AcademyDisciplines replaces AcademyCore.createDiscipline etc.
        if (!AcademyDisciplines || typeof AcademyDisciplines.create !== 'function') {
            missing.push('AcademyDisciplines.create');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.update !== 'function') {
            missing.push('AcademyDisciplines.update');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.delete !== 'function') {
            missing.push('AcademyDisciplines.delete');
        }

        // AcademyLocations replaces AcademyCore.createLocation etc.
        if (!AcademyLocations || typeof AcademyLocations.create !== 'function') {
            missing.push('AcademyLocations.create');
        }
        if (!AcademyLocations || typeof AcademyLocations.update !== 'function') {
            missing.push('AcademyLocations.update');
        }
        if (!AcademyLocations || typeof AcademyLocations.delete !== 'function') {
            missing.push('AcademyLocations.delete');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDisciplines !== 'function') {
            missing.push('AcademyQueries.getDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getLocations !== 'function') {
            missing.push('AcademyQueries.getLocations');
        }
        if (!AcademyQueries || typeof AcademyQueries.getInstructors !== 'function') {
            missing.push('AcademyQueries.getInstructors');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassInstructors !== 'function') {
            missing.push('AcademyQueries.getClassInstructors');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getLocation !== 'function') {
            missing.push('AcademyQueries.getLocation');
        }

        if (!AcademySchedule || typeof AcademySchedule.getStudentSchedule !== 'function') {
            missing.push('AcademySchedule.getStudentSchedule');
        }

        if (!AcademyGroups || typeof AcademyGroups.getAllAutoGroups !== 'function') {
            missing.push('AcademyGroups.getAllAutoGroups');
        }
        if (!AcademyGroups || typeof AcademyGroups.createGroup !== 'function') {
            missing.push('AcademyGroups.createGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.deleteGroup !== 'function') {
            missing.push('AcademyGroups.deleteGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.addStudentToGroup !== 'function') {
            missing.push('AcademyGroups.addStudentToGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.removeStudentFromGroup !== 'function') {
            missing.push('AcademyGroups.removeStudentFromGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.addSlotToGroup !== 'function') {
            missing.push('AcademyGroups.addSlotToGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.removeSlotFromGroup !== 'function') {
            missing.push('AcademyGroups.removeSlotFromGroup');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!CalendarQueries || typeof CalendarQueries.getInstructorSchedule !== 'function') {
            missing.push('CalendarQueries.getInstructorSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getLocationSchedule !== 'function') {
            missing.push('CalendarQueries.getLocationSchedule');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }
        if (!CalendarConstants || typeof CalendarConstants.MAX_WEEK !== 'number') {
            missing.push('CalendarConstants.MAX_WEEK');
        }
        if (!CalendarConstants || typeof CalendarConstants.DAY_NAMES_SHORT !== 'object') {
            missing.push('CalendarConstants.DAY_NAMES_SHORT');
        }
        if (!CalendarConstants || typeof CalendarConstants.CALENDAR_START_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_START_HOUR');
        }
        if (!CalendarConstants || typeof CalendarConstants.CALENDAR_END_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_END_HOUR');
        }
        if (!CalendarConstants || typeof CalendarConstants.MIN_CLASS_DURATION !== 'number') {
            missing.push('CalendarConstants.MIN_CLASS_DURATION');
        }
        if (!CalendarConstants || typeof CalendarConstants.MAX_CLASS_DURATION !== 'number') {
            missing.push('CalendarConstants.MAX_CLASS_DURATION');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn('[FacultyTab] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // REFRESH HELPER
    // ============================================================

    var _currentContainer = null;

    /**
     * Ask the Academy shell to re-render the current sub-tab.
     * Falls back to a local re-render if the shell isn't available.
     */
    function requestRefresh() {
        if (window.AcademyEvents && typeof window.AcademyEvents.refreshUI === 'function') {
            window.AcademyEvents.refreshUI();
        } else if (_currentContainer) {
            var html = render({
                selectedClassId: AcademyUI.getSelectedClassId(),
                selectedInstructorId: AcademyUI.getSelectedInstructorId(),
                displayWeek: AcademyUI.getDisplayWeek()
            });
            _currentContainer.innerHTML = html;
            bindEvents(_currentContainer);
        }
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;
    var DAY_NAMES_SHORT = CalendarConstants.DAY_NAMES_SHORT || ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR || 8;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR || 18;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION || 1;
    var MAX_CLASS_DURATION = CalendarConstants.MAX_CLASS_DURATION || 4;

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(state) {
        if (!checkDependencies()) {
            return '<p class="empty-state">Faculty tab dependencies not loaded.</p>';
        }

        state = state || {};
        var selectedClassId = state.selectedClassId || null;
        var selectedInstructorId = state.selectedInstructorId || null;
        var week = state.displayWeek || 1;

        var selectedClass = selectedClassId ? AcademyQueries.getClass(selectedClassId) : null;
        var instructors = selectedClassId ? AcademyQueries.getClassInstructors(selectedClassId) : [];
        var instructorVM = selectedInstructorId ? AcademyAggregator.getInstructorViewModel(selectedInstructorId, {
            week: week,
            includeSchedule: true,
            includeGroups: false
        }) : null;

        var html = '';

        // Header
        html += '<div class="faculty-tab-header">';
        html += '<div class="faculty-tab-title">';
        html += '<h3>Faculty</h3>';
        if (selectedClass) {
            html += '<span class="faculty-tab-class">' + escapeHtml(selectedClass.name) + '</span>';
        } else {
            html += '<span class="faculty-tab-class muted">No class selected</span>';
        }
        html += '</div>';
        html += '<div class="faculty-tab-controls">';
        html += '<div class="week-selector">';
        html += '<label>Week:</label>';
        html += '<input type="number" id="faculty-week-input" value="' + week + '" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" class="small">';
        html += '<button id="faculty-week-apply" class="small secondary">Apply</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        // Navigation
        html += '<div class="faculty-tab-nav">';
        html += '<button class="faculty-nav-btn active" data-view="instructors">Instructors</button>';
        html += '<button class="faculty-nav-btn" data-view="locations">Locations</button>';
        html += '<button class="faculty-nav-btn" data-view="autogroups">Auto-Groups</button>';
        html += '<button class="faculty-nav-btn" data-view="disciplines">Disciplines</button>';
        html += '</div>';

        // View panels
        html += '<div class="faculty-view-container">';

        // Instructors view
        html += '<div class="faculty-view-panel active" data-view="instructors">';
        html += renderInstructorsView(selectedClass, instructors, selectedInstructorId, instructorVM, week);
        html += '</div>';

        // Locations view
        html += '<div class="faculty-view-panel" data-view="locations" style="display:none;">';
        html += renderLocationsView(week);
        html += '</div>';

        // Auto-Groups view
        html += '<div class="faculty-view-panel" data-view="autogroups" style="display:none;">';
        html += renderAutoGroupsView(week);
        html += '</div>';

        // Disciplines view
        html += '<div class="faculty-view-panel" data-view="disciplines" style="display:none;">';
        html += renderDisciplinesView();
        html += '</div>';

        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTORS VIEW
    // ============================================================

    function renderInstructorsView(selectedClass, instructors, selectedInstructorId, instructorVM, week) {
        var html = '';

        html += '<div class="instructors-layout">';
        html += '<div class="instructors-sidebar">';
        html += '<div class="instructors-list-header">';
        html += '<h4>Instructors</h4>';
        html += '<span class="instructors-count">' + instructors.length + '</span>';
        html += '</div>';

        // Filter
        html += '<div class="instructors-filters">';
        html += '<input type="text" id="instructor-filter-input" class="academy-filter-input small" ' +
            'data-tab="faculty" data-key="search" placeholder="Filter instructors..." value="' +
            escapeHtml((AcademyUI.getFilter('faculty') || {}).search || '') + '">';
        html += '</div>';

        if (instructors.length === 0) {
            html += '<p class="empty-state small">No instructors in this class.</p>';
        } else {
            html += '<div class="instructors-list">';
            for (var i = 0; i < instructors.length; i++) {
                var instructor = instructors[i];
                if (!instructor) { continue; }
                var name = CharacterQueries.getDisplayName(instructor);
                var isSelected = selectedInstructorId === instructor.id;

                html += '<div class="instructor-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(instructor.id) + '">';
                html += '<span class="instructor-name">' + escapeHtml(name) + '</span>';
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';

        // Detail
        html += '<div class="instructors-detail">';
        if (instructorVM) {
            html += renderInstructorDetail(instructorVM, week);
        } else if (selectedInstructorId) {
            html += '<p class="empty-state">Instructor not found.</p>';
        } else {
            html += '<p class="empty-state">Select an instructor to view details.</p>';
        }
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTOR DETAIL
    // ============================================================

    function renderInstructorDetail(instructorVM, week) {
        if (!instructorVM) {
            return '<p class="empty-state">Instructor not found.</p>';
        }

        var schedule = instructorVM.schedule || [];
        var html = '';

        // Header
        html += '<div class="instructor-detail-header">';
        html += '<h4>' + escapeHtml(instructorVM.name) + '</h4>';
        html += '<span class="instructor-detail-week">Week ' + week + '</span>';
        html += '</div>';

        // Tabs
        html += '<div class="instructor-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="schedule">Schedule</button>';
        html += '<button class="detail-tab-btn" data-tab="blocks">Blocks</button>';
        html += '</div>';

        // Schedule
        html += '<div class="detail-tab-panel active" data-tab="schedule">';
        html += renderInstructorSchedule(instructorVM, schedule, week);
        html += '</div>';

        // Blocks
        html += '<div class="detail-tab-panel" data-tab="blocks" style="display:none;">';
        html += renderInstructorBlocks(instructorVM, week);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTOR SCHEDULE
    // ============================================================

    function renderInstructorSchedule(instructorVM, schedule, week) {
        var startHour = CALENDAR_START_HOUR;
        var endHour = CALENDAR_END_HOUR;
        var dayNames = DAY_NAMES_SHORT.slice(1);

        var html = '';

        // Add form
        var disciplines = AcademyQueries.getAvailableDisciplines(week);
        html += '<div class="schedule-add-form">';
        html += '<select id="schedule-discipline-select" class="small">';
        html += '<option value="">Select discipline...</option>';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-day-select" class="small">';
        for (var d2 = 0; d2 < dayNames.length; d2++) {
            html += '<option value="' + (d2 + 1) + '">' + dayNames[d2] + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-hour-select" class="small">';
        for (var h = startHour; h <= endHour; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="schedule-duration-select" class="small">';
        for (var dur = MIN_CLASS_DURATION; dur <= MAX_CLASS_DURATION; dur++) {
            html += '<option value="' + dur + '">' + dur + ' hour' + (dur > 1 ? 's' : '') + '</option>';
        }
        html += '</select>';
        html += '<button id="schedule-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Grid
        html += '<div class="schedule-grid-container">';
        html += '<table class="schedule-grid">';
        html += '<thead>';
        html += '<tr><th>Time</th>';
        for (var d3 = 1; d3 <= 7; d3++) {
            html += '<th>' + dayNames[d3 - 1] + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        // Build lookup
        var scheduleLookup = {};
        for (var i = 0; i < schedule.length; i++) {
            var entry = schedule[i];
            var key = entry.day + '_' + entry.hour;
            scheduleLookup[key] = entry;
        }

        for (var h2 = startHour; h2 <= endHour; h2++) {
            html += '<tr>';
            html += '<td class="schedule-time">' + h2 + ':00</td>';

            for (var d4 = 1; d4 <= 7; d4++) {
                var key = d4 + '_' + h2;
                var entry = scheduleLookup[key] || null;
                var display = '';
                var className = 'schedule-empty';

                if (entry) {
                    display = entry.disciplineName || 'Unknown';
                    className = 'schedule-class';
                    if (entry.students && entry.students > 0) {
                        display += ' (' + entry.students + ' students)';
                    }
                } else {
                    display = '\u00b7';
                    className = 'schedule-empty';
                }

                html += '<td class="' + className + '" data-day="' + d4 + '" data-hour="' + h2 + '"';
                if (entry) {
                    html += ' data-discipline="' + escapeAttribute(entry.disciplineId || '') + '"';
                    html += ' data-duration="' + escapeAttribute(entry.duration || 1) + '"';
                }
                html += '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (entry) {
                    html += '<button class="schedule-remove-btn small danger" data-day="' + d4 + '" data-hour="' + h2 + '">x</button>';
                }
                html += '</td>';
            }

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTOR BLOCKS
    // ============================================================

    function renderInstructorBlocks(instructorVM, week) {
        var blocks = {};
        if (CalendarQueries && typeof CalendarQueries.getInstructorBlocks === 'function') {
            blocks = CalendarQueries.getInstructorBlocks(instructorVM.id, week) || {};
        }

        var dayNames = DAY_NAMES_SHORT.slice(1);

        var html = '';

        html += '<div class="blocks-add-form">';
        html += '<select id="block-day-select" class="small">';
        for (var d = 0; d < dayNames.length; d++) {
            html += '<option value="' + (d + 1) + '">' + dayNames[d] + '</option>';
        }
        html += '</select>';
        html += '<select id="block-hour-select" class="small">';
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="block-duration-select" class="small">';
        for (var dur = MIN_CLASS_DURATION; dur <= MAX_CLASS_DURATION; dur++) {
            html += '<option value="' + dur + '">' + dur + ' hour' + (dur > 1 ? 's' : '') + '</option>';
        }
        html += '</select>';
        html += '<input type="text" id="block-label-input" placeholder="Label (optional)" class="small">';
        html += '<button id="block-add-btn" class="warning small">Add Block</button>';
        html += '</div>';

        // List blocks
        var blockEntries = [];
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) { continue; }
            var dayBlocks = blocks[day];
            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) { continue; }
                var block = dayBlocks[hour];
                blockEntries.push({
                    day: parseInt(day, 10),
                    hour: parseInt(hour, 10),
                    duration: block.duration || 1,
                    label: block.label || 'Blocked'
                });
            }
        }

        if (blockEntries.length === 0) {
            html += '<p class="empty-state small">No blocks set.</p>';
        } else {
            blockEntries.sort(function(a, b) {
                if (a.day !== b.day) { return a.day - b.day; }
                return a.hour - b.hour;
            });

            html += '<div class="blocks-list">';
            for (var i = 0; i < blockEntries.length; i++) {
                var b = blockEntries[i];
                var dayName = dayNames[b.day - 1];
                html += '<div class="block-item">';
                html += '<span class="block-day">' + dayName + '</span>';
                html += '<span class="block-time">' + b.hour + ':00 - ' + (b.hour + b.duration) + ':00</span>';
                html += '<span class="block-label">' + escapeHtml(b.label) + '</span>';
                html += '<button class="block-remove-btn small danger" data-day="' + b.day + '" data-hour="' + b.hour + '">x</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER LOCATIONS VIEW
    // ============================================================

    function renderLocationsView(week) {
        var locations = AcademyQueries.getLocations();
        var dayNames = DAY_NAMES_SHORT.slice(1);

        var html = '';

        html += '<div class="locations-view-header">';
        html += '<h4>Location Schedule</h4>';
        html += '<span class="locations-week">Week ' + week + '</span>';
        html += '<button id="location-add-btn" class="primary small">+ Add Location</button>';
        html += '</div>';

        if (locations.length === 0) {
            html += '<p class="empty-state">No locations available.</p>';
        } else {
            html += '<div class="locations-grid">';
            for (var i = 0; i < locations.length; i++) {
                var loc = locations[i];
                var schedule = CalendarQueries.getLocationSchedule(loc.id, week) || {};

                html += '<div class="location-card">';
                html += '<div class="location-card-header">';
                html += '<h5>' + escapeHtml(loc.name) + '</h5>';
                html += '<span class="location-type">' + escapeHtml(loc.type || 'other') + '</span>';
                if (loc.capacity) {
                    html += '<span class="location-capacity">Cap: ' + escapeHtml(loc.capacity) + '</span>';
                }
                html += '<div class="location-actions">';
                html += '<button class="location-edit-btn small" data-id="' + escapeHtml(loc.id) + '">Edit</button>';
                html += '<button class="location-manage-btn small" data-location="' + escapeHtml(loc.id) + '">Manage</button>';
                html += '</div>';
                html += '</div>';

                // Schedule
                var hasClasses = false;
                for (var day in schedule) {
                    if (!Object.prototype.hasOwnProperty.call(schedule, day)) { continue; }
                    var daySchedule = schedule[day];
                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) { continue; }
                        if (daySchedule[hour]) {
                            hasClasses = true;
                            break;
                        }
                    }
                    if (hasClasses) { break; }
                }

                if (hasClasses) {
                    html += '<div class="location-schedule">';
                    for (var d = 1; d <= 7; d++) {
                        if (!schedule[d]) { continue; }
                        var daySchedule2 = schedule[d];
                        var dayEntries = [];
                        for (var h in daySchedule2) {
                            if (!Object.prototype.hasOwnProperty.call(daySchedule2, h)) { continue; }
                            if (daySchedule2[h]) {
                                var disc = AcademyQueries.getDiscipline ? AcademyQueries.getDiscipline(daySchedule2[h]) : null;
                                dayEntries.push({
                                    hour: parseInt(h, 10),
                                    name: disc ? disc.name : 'Unknown'
                                });
                            }
                        }
                        if (dayEntries.length > 0) {
                            html += '<div class="location-day">';
                            html += '<span class="location-day-name">' + dayNames[d - 1] + '</span>';
                            for (var j = 0; j < dayEntries.length; j++) {
                                html += '<span class="location-class">' + escapeHtml(dayEntries[j].hour) + ':00 - ' + escapeHtml(dayEntries[j].name) + '</span>';
                            }
                            html += '</div>';
                        }
                    }
                    html += '</div>';
                } else {
                    html += '<p class="empty-state small">No classes scheduled</p>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER AUTO-GROUPS VIEW
    // ============================================================

    function renderAutoGroupsView(week) {
        var groups = AcademyGroups.getAllAutoGroups() || {};
        var dayNames = DAY_NAMES_SHORT.slice(1);

        var html = '';

        html += '<div class="autogroups-header">';
        html += '<h4>Auto-Groups</h4>';
        html += '<button id="autogroup-rebuild-btn" class="secondary small">Rebuild from Schedules</button>';
        html += '</div>';

        html += '<div class="autogroups-add-form">';
        html += '<select id="autogroup-discipline-select" class="small">';
        html += '<option value="">Select discipline...</option>';
        var disciplines = AcademyQueries.getDisciplines();
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        html += '</select>';
        html += '<select id="autogroup-instructor-select" class="small">';
        html += '<option value="">Select instructor...</option>';
        var instructors = AcademyQueries.getInstructors();
        for (var j = 0; j < instructors.length; j++) {
            var inst = instructors[j];
            var name = CharacterQueries.getDisplayName(inst);
            html += '<option value="' + escapeHtml(inst.id) + '">' + escapeHtml(name) + '</option>';
        }
        html += '</select>';
        html += '<button id="autogroup-create-btn" class="primary small">Create Group</button>';
        html += '</div>';

        if (Object.keys(groups).length === 0) {
            html += '<p class="empty-state">No auto-groups created.</p>';
        } else {
            html += '<div class="autogroups-list">';
            for (var key in groups) {
                if (!Object.prototype.hasOwnProperty.call(groups, key)) { continue; }
                var group = groups[key];
                var disc = AcademyQueries.getDiscipline ? AcademyQueries.getDiscipline(group.disciplineId) : null;
                var instructor = CharacterQueries.getCharacterById(group.instructorId);
                var discName = disc ? disc.name : 'Unknown';
                var instName = instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';

                html += '<div class="autogroup-item">';
                html += '<div class="autogroup-header">';
                html += '<span class="autogroup-name"><strong>' + escapeHtml(discName) + '</strong> - ' + escapeHtml(instName) + '</span>';
                html += '<span class="autogroup-count">' + (group.students ? group.students.length : 0) + ' students</span>';
                html += '<button class="autogroup-delete-btn small danger" data-key="' + escapeHtml(key) + '">x</button>';
                html += '</div>';

                // Slots
                if (group.slots && group.slots.length > 0) {
                    html += '<div class="autogroup-slots">';
                    for (var k = 0; k < group.slots.length; k++) {
                        var slot = group.slots[k];
                        var dayName = dayNames[(slot.day || 1) - 1] || '?';
                        html += '<span class="autogroup-slot">' + dayName + ' ' + (slot.hour || 0) + ':00 - ' + ((slot.hour || 0) + (slot.duration || 1)) + ':00</span>';
                    }
                    html += '</div>';
                }

                // Students
                if (group.students && group.students.length > 0) {
                    html += '<div class="autogroup-students">';
                    for (var s = 0; s < group.students.length; s++) {
                        var student = CharacterQueries.getCharacterById(group.students[s]);
                        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
                        html += '<span class="autogroup-student">' + escapeHtml(studentName) + '</span>';
                    }
                    html += '</div>';
                }

                // Add student
                html += '<div class="autogroup-add-student">';
                html += '<select class="autogroup-student-select small">';
                html += '<option value="">Add student...</option>';
                var availableStudents = CharacterQueries.getStudents();
                var currentStudents = group.students || [];
                for (var a = 0; a < availableStudents.length; a++) {
                    var stu = availableStudents[a];
                    if (currentStudents.indexOf(stu.id) === -1) {
                        var stuName = CharacterQueries.getDisplayName(stu);
                        html += '<option value="' + escapeHtml(stu.id) + '">' + escapeHtml(stuName) + '</option>';
                    }
                }
                html += '</select>';
                html += '<button class="autogroup-add-student-btn small primary" data-key="' + escapeHtml(key) + '">Add</button>';
                html += '</div>';

                // Add slot
                html += '<div class="autogroup-add-slot">';
                html += '<select class="autogroup-slot-day small">';
                for (var d2 = 0; d2 < dayNames.length; d2++) {
                    html += '<option value="' + (d2 + 1) + '">' + dayNames[d2] + '</option>';
                }
                html += '</select>';
                html += '<select class="autogroup-slot-hour small">';
                for (var h2 = CALENDAR_START_HOUR; h2 <= CALENDAR_END_HOUR; h2++) {
                    html += '<option value="' + h2 + '">' + h2 + ':00</option>';
                }
                html += '</select>';
                html += '<select class="autogroup-slot-duration small">';
                for (var dur = MIN_CLASS_DURATION; dur <= MAX_CLASS_DURATION; dur++) {
                    html += '<option value="' + dur + '">' + dur + 'h</option>';
                }
                html += '</select>';
                html += '<button class="autogroup-add-slot-btn small primary" data-key="' + escapeHtml(key) + '">Add Slot</button>';
                html += '</div>';

                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER DISCIPLINES VIEW
    // ============================================================

    function renderDisciplinesView() {
        var disciplines = AcademyQueries.getDisciplines();

        var html = '';

        html += '<div class="disciplines-header">';
        html += '<h4>Disciplines / Curriculum</h4>';
        html += '<button id="discipline-add-btn" class="primary small">+ Add Discipline</button>';
        html += '</div>';

        if (disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines defined.</p>';
        } else {
            html += '<div class="disciplines-list">';
            for (var i = 0; i < disciplines.length; i++) {
                var d = disciplines[i];
                var instructors = d.instructorIds || [];
                var instructorNames = instructors.map(function(id) {
                    var inst = CharacterQueries.getCharacterById(id);
                    return inst ? CharacterQueries.getDisplayName(inst) : 'Unknown';
                });

                html += '<div class="discipline-item">';
                html += '<div class="discipline-header">';
                html += '<span class="discipline-name"><strong>' + escapeHtml(d.name) + '</strong></span>';
                html += '<span class="discipline-type">' + escapeHtml(d.type || 'mandatory') + '</span>';
                html += '<span class="discipline-week">Wk ' + escapeHtml(d.startWeek || '?') + ' - ' + escapeHtml(d.endWeek || '?') + '</span>';
                html += '</div>';
                html += '<div class="discipline-details">';
                if (instructorNames.length > 0) {
                    html += '<span class="discipline-instructors">Instructors: ' + escapeHtml(instructorNames.join(', ')) + '</span>';
                }
                if (d.weight) {
                    html += '<span class="discipline-weight">Weight: ' + escapeHtml(d.weight) + '</span>';
                }
                if (d.weeklyHours) {
                    html += '<span class="discipline-hours">Weekly: ' + escapeHtml(d.weeklyHours) + 'h</span>';
                }
                html += '</div>';
                html += '<div class="discipline-actions">';
                html += '<button class="discipline-edit-btn small" data-id="' + escapeHtml(d.id) + '">Edit</button>';
                html += '<button class="discipline-delete-btn small danger" data-id="' + escapeHtml(d.id) + '">x</button>';
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // MODALS HTML
    // ============================================================

    function getModalsHTML() {
        return [
            '<!-- Location Manage Modal -->',
            '<div id="faculty-location-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="faculty-location-modal-title">Manage Location</h3>',
                        '<button class="close-modal" id="faculty-location-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div id="faculty-location-content"></div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Location Form Modal -->',
            '<div id="faculty-location-form-modal" class="modal hidden">',
                '<div class="modal-content small">',
                    '<div class="modal-header">',
                        '<h3 id="faculty-location-form-title">Add Location</h3>',
                        '<button class="close-modal" id="faculty-location-form-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="faculty-location-form">',
                            '<div class="form-group">',
                                '<label>Name *</label>',
                                '<input type="text" id="location-name" required>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Type</label>',
                                '<select id="location-type">',
                                    '<option value="classroom">Classroom</option>',
                                    '<option value="lab">Lab</option>',
                                    '<option value="gym">Gymnasium</option>',
                                    '<option value="field">Field</option>',
                                    '<option value="hall">Hall</option>',
                                    '<option value="other">Other</option>',
                                '</select>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Capacity</label>',
                                '<input type="number" id="location-capacity" placeholder="Optional" min="1" max="1000">',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="faculty-location-form-cancel" class="secondary">Cancel</button>',
                                '<button type="submit" id="faculty-location-form-save" class="primary">Save</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Discipline Form Modal -->',
            '<div id="faculty-discipline-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="faculty-discipline-modal-title">Add Discipline</h3>',
                        '<button class="close-modal" id="faculty-discipline-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="faculty-discipline-form">',
                            '<div class="form-group">',
                                '<label>Name *</label>',
                                '<input type="text" id="discipline-name" required>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Type</label>',
                                '<select id="discipline-type">',
                                    '<option value="mandatory">Mandatory</option>',
                                    '<option value="optional">Optional</option>',
                                '</select>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Instructors</label>',
                                '<select id="discipline-instructors" multiple class="small">',
                                '</select>',
                                '<span class="field-hint">Hold Ctrl/Cmd to select multiple</span>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Start Week</label>',
                                '<input type="number" id="discipline-start-week" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" value="' + MIN_WEEK + '">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>End Week</label>',
                                '<input type="number" id="discipline-end-week" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Weekly Hours</label>',
                                '<input type="number" id="discipline-weekly-hours" min="0" max="40" step="0.5" value="1">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Weight</label>',
                                '<input type="number" id="discipline-weight" min="0.1" max="10" step="0.1" value="1">',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="faculty-discipline-cancel" class="secondary">Cancel</button>',
                                '<button type="submit" id="faculty-discipline-save" class="primary">Save</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // BIND EVENTS - Main entry point for event binding
    // ============================================================

    function bindEvents(container) {
        if (!container) {
            return;
        }

        _currentContainer = container;

        // ---- Week apply ----
        var weekApply = container.querySelector('#faculty-week-apply');
        if (weekApply) {
            weekApply.addEventListener('click', function() {
                var input = container.querySelector('#faculty-week-input');
                if (input) {
                    var week = parseInt(input.value, 10);
                    if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                        AcademyUI.setDisplayWeek(week);
                        requestRefresh();
                    } else {
                        notify('Please enter a valid week (' + MIN_WEEK + '-' + MAX_WEEK + ').', 'error');
                    }
                }
            });
        }

        // ---- Week input enter ----
        var weekInput = container.querySelector('#faculty-week-input');
        if (weekInput) {
            weekInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var applyBtn = container.querySelector('#faculty-week-apply');
                    if (applyBtn) { applyBtn.click(); }
                }
            });
        }

        // ---- Navigation ----
        var navBtns = container.querySelectorAll('.faculty-nav-btn');
        for (var i = 0; i < navBtns.length; i++) {
            navBtns[i].addEventListener('click', function() {
                var view = this.dataset.view;
                if (!view) { return; }

                var allBtns = container.querySelectorAll('.faculty-nav-btn');
                for (var b = 0; b < allBtns.length; b++) {
                    allBtns[b].classList.remove('active');
                }
                this.classList.add('active');

                var panels = container.querySelectorAll('.faculty-view-panel');
                for (var p = 0; p < panels.length; p++) {
                    var panel = panels[p];
                    var isActive = panel.dataset.view === view;
                    panel.style.display = isActive ? 'block' : 'none';
                    panel.classList.toggle('active', isActive);
                }
            });
        }

        // ---- Instructor selection ----
        var listContainer = container.querySelector('.instructors-list');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.instructor-list-item');
                if (!item) { return; }
                var id = item.dataset.id;
                if (id) {
                    AcademyUI.selectInstructor(id);
                    requestRefresh();
                }
            });
        }

        // ---- Instructor filter ----
        var filterInput = container.querySelector('#instructor-filter-input');
        if (filterInput) {
            filterInput.addEventListener('input', function() {
                var tab = this.dataset.tab || 'faculty';
                var key = this.dataset.key || 'search';
                AcademyUI.setFilter(tab, key, this.value);
                requestRefresh();
            });
        }

        // ---- Detail tab switching ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.detail-tab-btn');
            if (btn) {
                var tab = btn.dataset.tab;
                var parent = btn.closest('.instructor-detail-tabs');
                if (parent) {
                    var detailContainer = parent.closest('.instructors-detail');
                    if (detailContainer) {
                        switchInstructorDetailTab(detailContainer, tab);
                    }
                }
            }
        });

        // ---- Schedule add ----
        var scheduleAddBtn = container.querySelector('#schedule-add-btn');
        if (scheduleAddBtn) {
            scheduleAddBtn.addEventListener('click', function() {
                handleAddSchedule(container);
            });
        }

        // ---- Schedule remove ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.schedule-remove-btn');
            if (btn) {
                var day = btn.dataset.day;
                var hour = btn.dataset.hour;
                if (day && hour) {
                    handleRemoveSchedule(container, parseInt(day, 10), parseInt(hour, 10));
                }
            }
        });

        // ---- Block add ----
        var blockAddBtn = container.querySelector('#block-add-btn');
        if (blockAddBtn) {
            blockAddBtn.addEventListener('click', function() {
                handleAddBlock(container);
            });
        }

        // ---- Block remove ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.block-remove-btn');
            if (btn) {
                var day = btn.dataset.day;
                var hour = btn.dataset.hour;
                if (day && hour) {
                    handleRemoveBlock(container, parseInt(day, 10), parseInt(hour, 10));
                }
            }
        });

        // ---- Location manage ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.location-manage-btn');
            if (btn) {
                var locationId = btn.dataset.location;
                if (locationId) {
                    showLocationModal(locationId);
                }
            }
        });

        // ---- Location edit ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.location-edit-btn');
            if (btn) {
                var locationId = btn.dataset.id;
                if (locationId) {
                    showLocationForm(locationId);
                }
            }
        });

        // ---- Location add ----
        var locationAddBtn = container.querySelector('#location-add-btn');
        if (locationAddBtn) {
            locationAddBtn.addEventListener('click', function() {
                showLocationForm(null);
            });
        }

        // ---- Auto-group create ----
        var agCreateBtn = container.querySelector('#autogroup-create-btn');
        if (agCreateBtn) {
            agCreateBtn.addEventListener('click', function() {
                handleCreateAutoGroup(container);
            });
        }

        // ---- Auto-group delete ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.autogroup-delete-btn');
            if (btn) {
                var key = btn.dataset.key;
                if (key && confirm('Delete this auto-group?')) {
                    handleDeleteAutoGroup(key);
                }
            }
        });

        // ---- Auto-group add student ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.autogroup-add-student-btn');
            if (btn) {
                var key = btn.dataset.key;
                var select = btn.parentElement.querySelector('.autogroup-student-select');
                if (key && select && select.value) {
                    handleAddStudentToAutoGroup(key, select.value);
                }
            }
        });

        // ---- Auto-group add slot ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.autogroup-add-slot-btn');
            if (btn) {
                var key = btn.dataset.key;
                var daySelect = btn.parentElement.querySelector('.autogroup-slot-day');
                var hourSelect = btn.parentElement.querySelector('.autogroup-slot-hour');
                var durationSelect = btn.parentElement.querySelector('.autogroup-slot-duration');
                if (key && daySelect && hourSelect && durationSelect) {
                    handleAddSlotToAutoGroup(key,
                        parseInt(daySelect.value, 10),
                        parseInt(hourSelect.value, 10),
                        parseInt(durationSelect.value, 10)
                    );
                }
            }
        });

        // ---- Auto-group rebuild ----
        var rebuildBtn = container.querySelector('#autogroup-rebuild-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                if (confirm('Rebuild auto-groups from schedules? This will replace all existing groups.')) {
                    handleRebuildAutoGroups();
                }
            });
        }

        // ---- Discipline add ----
        var discAddBtn = container.querySelector('#discipline-add-btn');
        if (discAddBtn) {
            discAddBtn.addEventListener('click', function() {
                showDisciplineForm(null);
            });
        }

        // ---- Discipline edit ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.discipline-edit-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id) {
                    showDisciplineForm(id);
                }
            }
        });

        // ---- Discipline delete ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.discipline-delete-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id && confirm('Delete this discipline?')) {
                    handleDeleteDiscipline(id);
                }
            }
        });

        // ---- Location modal events ----
        bindLocationModalEvents(container);

        // ---- Location form events ----
        bindLocationFormEvents(container);

        // ---- Discipline form events ----
        bindDisciplineFormEvents(container);

        return function() {
            // Cleanup
        };
    }

    // ============================================================
    // SWITCH INSTRUCTOR DETAIL TAB
    // ============================================================

    function switchInstructorDetailTab(container, tab) {
        var btns = container.querySelectorAll('.detail-tab-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].dataset.tab === tab);
        }

        var panels = container.querySelectorAll('.detail-tab-panel');
        for (var j = 0; j < panels.length; j++) {
            var panel = panels[j];
            var isActive = panel.dataset.tab === tab;
            panel.style.display = isActive ? 'block' : 'none';
            panel.classList.toggle('active', isActive);
        }
    }

    // ============================================================
    // HANDLERS - Schedule (STUBS)
    // ============================================================
    // 
    // These handlers are stubs. They were stubs before the v15 pass
    // and remain stubs after it. They are NOT data-model regressions.
    // 
    // Wiring them requires:
    //   - A discipline picker that reads the current instructor
    //   - AcademySchedule.setInstructorTemplate / setInstructorBlock
    //   - Refresh after mutation
    // 
    // That's UI work, not data-model work.

    function handleAddSchedule(container) {
        var instructorId = AcademyUI.getSelectedInstructorId();
        if (!instructorId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var discSelect = container.querySelector('#schedule-discipline-select');
        var daySelect = container.querySelector('#schedule-day-select');
        var hourSelect = container.querySelector('#schedule-hour-select');
        var durationSelect = container.querySelector('#schedule-duration-select');

        var disciplineId = discSelect ? discSelect.value : '';
        var day = daySelect ? parseInt(daySelect.value, 10) : 1;
        var hour = hourSelect ? parseInt(hourSelect.value, 10) : CALENDAR_START_HOUR;
        var duration = durationSelect ? parseInt(durationSelect.value, 10) : 1;

        if (!disciplineId) {
            notify('Please select a discipline.', 'error');
            return;
        }

        // STUB — wire to AcademySchedule when the schedule UI is ready.
        notify('Schedule operation: ' + disciplineId + ' at ' + day + ':' + hour + ' for ' + duration + 'h', 'info');
    }

    function handleRemoveSchedule(container, day, hour) {
        var instructorId = AcademyUI.getSelectedInstructorId();
        if (!instructorId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        // STUB — wire to AcademySchedule when the schedule UI is ready.
        notify('Remove schedule: instructor ' + instructorId + ' week ' + week + ' day ' + day + ' hour ' + hour, 'info');
    }

    // ============================================================
    // HANDLERS - Blocks (STUBS)
    // ============================================================

    function handleAddBlock(container) {
        var instructorId = AcademyUI.getSelectedInstructorId();
        if (!instructorId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var daySelect = container.querySelector('#block-day-select');
        var hourSelect = container.querySelector('#block-hour-select');
        var durationSelect = container.querySelector('#block-duration-select');
        var labelInput = container.querySelector('#block-label-input');

        var day = daySelect ? parseInt(daySelect.value, 10) : 1;
        var hour = hourSelect ? parseInt(hourSelect.value, 10) : CALENDAR_START_HOUR;
        var duration = durationSelect ? parseInt(durationSelect.value, 10) : 1;
        var label = labelInput ? labelInput.value.trim() : 'Blocked';

        // STUB — wire to AcademySchedule when the schedule UI is ready.
        notify('Add block: ' + label + ' at ' + day + ':' + hour + ' for ' + duration + 'h', 'info');
    }

    function handleRemoveBlock(container, day, hour) {
        var instructorId = AcademyUI.getSelectedInstructorId();
        if (!instructorId) {
            notify('No instructor selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        // STUB — wire to AcademySchedule when the schedule UI is ready.
        notify('Remove block: instructor ' + instructorId + ' week ' + week + ' day ' + day + ' hour ' + hour, 'info');
    }

    // ============================================================
    // HANDLERS - Location - Using AcademyLocations directly
    // ============================================================

    function bindLocationModalEvents(container) {
        var modal = document.getElementById('faculty-location-modal');
        var closeBtn = document.getElementById('faculty-location-close');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });

            modal.addEventListener('click', function(e) {
                var btn = e.target.closest('.location-add-class-btn');
                if (btn) {
                    var locationId = btn.dataset.location;
                    var day = parseInt(btn.dataset.day, 10);
                    var hour = parseInt(btn.dataset.hour, 10);
                    var select = document.getElementById('location-class-select');

                    if (locationId && select && select.value) {
                        var week = AcademyUI.getDisplayWeek();
                        // STUB — wire to AcademySchedule when the schedule UI is ready.
                        notify('Assign class to location: ' + locationId + ' at ' + day + ':' + hour + ' - ' + select.value, 'info');
                        refreshLocationModal(locationId);
                    }
                }
            });

            modal.addEventListener('click', function(e) {
                var btn = e.target.closest('.location-remove-class-btn');
                if (btn) {
                    var locationId = btn.dataset.location;
                    var day = parseInt(btn.dataset.day, 10);
                    var hour = parseInt(btn.dataset.hour, 10);
                    if (locationId && confirm('Remove this class from location?')) {
                        var week = AcademyUI.getDisplayWeek();
                        // STUB — wire to AcademySchedule when the schedule UI is ready.
                        notify('Remove class from location: ' + locationId + ' day ' + day + ' hour ' + hour, 'info');
                        refreshLocationModal(locationId);
                    }
                }
            });
        }
    }

    function bindLocationFormEvents(container) {
        var modal = document.getElementById('faculty-location-form-modal');
        var form = document.getElementById('faculty-location-form');
        var closeBtn = document.getElementById('faculty-location-form-close');
        var cancelBtn = document.getElementById('faculty-location-form-cancel');
        var titleEl = document.getElementById('faculty-location-form-title');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                handleSaveLocation(form);
            });
        }
    }

    function showLocationModal(locationId) {
        var modal = document.getElementById('faculty-location-modal');
        var title = document.getElementById('faculty-location-modal-title');

        if (!modal) {
            notify('Modal not found.', 'error');
            return;
        }

        var loc = AcademyQueries.getLocation(locationId);
        if (loc && title) {
            title.textContent = 'Manage: ' + loc.name;
        }

        modal.dataset.locationId = locationId;
        refreshLocationModal(locationId);
        modal.classList.remove('hidden');
    }

    function refreshLocationModal(locationId) {
        var content = document.getElementById('faculty-location-content');
        if (!content) { return; }

        var loc = AcademyQueries.getLocation(locationId);
        if (!loc) {
            content.innerHTML = '<p class="empty-state">Location not found.</p>';
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        var schedule = CalendarQueries.getLocationSchedule(locationId, week) || {};
        var disciplines = AcademyQueries.getAvailableDisciplines(week);
        var dayNames = DAY_NAMES_SHORT.slice(1);

        var html = '';
        html += '<div class="location-modal-info">';
        html += '<p><strong>' + escapeHtml(loc.name) + '</strong> - ' + escapeHtml(loc.type || 'other') + '</p>';
        html += '<p>Week ' + week + '</p>';
        html += '</div>';

        html += '<div class="location-modal-schedule">';
        for (var d = 1; d <= 7; d++) {
            html += '<div class="location-modal-day">';
            html += '<span class="location-modal-day-name">' + dayNames[d - 1] + '</span>';
            var daySchedule = schedule[d] || {};

            for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                var classId = daySchedule[h] || null;
                var display = '';
                var className = 'location-modal-slot empty';

                if (classId) {
                    var disc = AcademyQueries.getDiscipline ? AcademyQueries.getDiscipline(classId) : null;
                    display = disc ? disc.name : 'Unknown';
                    className = 'location-modal-slot occupied';
                } else {
                    display = '\u00b7';
                }

                html += '<div class="' + className + '" data-day="' + d + '" data-hour="' + h + '">';
                html += '<span class="slot-time">' + h + ':00</span>';
                html += '<span class="slot-content">' + escapeHtml(display) + '</span>';
                if (!classId) {
                    html += '<select class="location-class-select small" style="display:none;">';
                    html += '<option value="">Add class...</option>';
                    for (var i = 0; i < disciplines.length; i++) {
                        var disc2 = disciplines[i];
                        html += '<option value="' + escapeHtml(disc2.id) + '">' + escapeHtml(disc2.name) + '</option>';
                    }
                    html += '</select>';
                    html += '<button class="location-add-class-btn small" data-location="' + escapeHtml(locationId) + '" data-day="' + d + '" data-hour="' + h + '">+</button>';
                } else {
                    html += '<button class="location-remove-class-btn small danger" data-location="' + escapeHtml(locationId) + '" data-day="' + d + '" data-hour="' + h + '">x</button>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';

        content.innerHTML = html;

        var slots = content.querySelectorAll('.location-modal-slot.empty');
        for (var s = 0; s < slots.length; s++) {
            var slot = slots[s];
            slot.addEventListener('click', function(e) {
                var select = this.querySelector('.location-class-select');
                var btn = this.querySelector('.location-add-class-btn');
                if (select && btn) {
                    var isVisible = select.style.display !== 'none';
                    select.style.display = isVisible ? 'none' : 'inline-block';
                    btn.style.display = isVisible ? 'inline-block' : 'none';
                    if (!isVisible) {
                        select.focus();
                    }
                }
            });
        }
    }

    function showLocationForm(editId) {
        var modal = document.getElementById('faculty-location-form-modal');
        var form = document.getElementById('faculty-location-form');
        var titleEl = document.getElementById('faculty-location-form-title');
        var nameInput = document.getElementById('location-name');
        var typeSelect = document.getElementById('location-type');
        var capacityInput = document.getElementById('location-capacity');

        if (!modal || !form) {
            notify('Form elements not found.', 'error');
            return;
        }

        if (editId) {
            var loc = AcademyQueries.getLocation(editId);
            if (!loc) {
                notify('Location not found.', 'error');
                return;
            }
            titleEl.textContent = 'Edit Location';
            if (nameInput) { nameInput.value = loc.name || ''; }
            if (typeSelect) { typeSelect.value = loc.type || 'other'; }
            if (capacityInput) { capacityInput.value = loc.capacity || ''; }
            form.dataset.editId = editId;
        } else {
            titleEl.textContent = 'Add Location';
            if (nameInput) { nameInput.value = ''; }
            if (typeSelect) { typeSelect.value = 'classroom'; }
            if (capacityInput) { capacityInput.value = ''; }
            delete form.dataset.editId;
        }

        modal.classList.remove('hidden');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }

    function handleSaveLocation(form) {
        var nameInput = document.getElementById('location-name');
        var typeSelect = document.getElementById('location-type');
        var capacityInput = document.getElementById('location-capacity');

        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            notify('Location name is required.', 'error');
            return;
        }

        var data = {
            name: name,
            type: typeSelect ? typeSelect.value : 'other',
            capacity: capacityInput ? parseInt(capacityInput.value, 10) || null : null
        };

        var editId = form.dataset.editId;
        var AcademyLocations = getAcademyLocations();
        if (!AcademyLocations) {
            notify('AcademyLocations not available.', 'error');
            return;
        }

        // AcademyLocations.create / update return PLAIN OBJECTS,
        // not Promises. They follow the candidate-based pattern and
        // are synchronous from the caller's perspective.
        var result = editId
            ? AcademyLocations.update(editId, data)
            : AcademyLocations.create(data);

        if (result && result.success) {
            notify(editId ? 'Location updated successfully.' : 'Location created successfully.', 'success');
            var modal = document.getElementById('faculty-location-form-modal');
            if (modal) { modal.classList.add('hidden'); }
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to save location.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Auto-Groups
    // ============================================================

    function handleCreateAutoGroup(container) {
        var discSelect = container.querySelector('#autogroup-discipline-select');
        var instSelect = container.querySelector('#autogroup-instructor-select');

        var disciplineId = discSelect ? discSelect.value : '';
        var instructorId = instSelect ? instSelect.value : '';

        if (!disciplineId || !instructorId) {
            notify('Please select both discipline and instructor.', 'error');
            return;
        }

        var result = AcademyGroups.createGroup(disciplineId, instructorId);

        if (result && result.success) {
            notify('Auto-group created successfully.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to create auto-group.', 'error');
        }
    }

    function handleDeleteAutoGroup(key) {
        var result = AcademyGroups.deleteGroup(key);

        if (result && result.success) {
            notify('Auto-group deleted successfully.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to delete auto-group.', 'error');
        }
    }

    function handleAddStudentToAutoGroup(key, studentId) {
        var result = AcademyGroups.addStudentToGroup(key, studentId);

        if (result && result.success) {
            notify('Student added to auto-group.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to add student.', 'error');
        }
    }

    function handleAddSlotToAutoGroup(key, day, hour, duration) {
        var week = AcademyUI.getDisplayWeek();

        var result = AcademyGroups.addSlotToGroup(key, week, day, hour, duration);

        if (result && result.success) {
            notify('Slot added to auto-group.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to add slot.', 'error');
        }
    }

    function handleRebuildAutoGroups() {
        notify('Rebuild from schedules not yet implemented.', 'info');
    }

    // ============================================================
    // HANDLERS - Disciplines - Using AcademyDisciplines directly
    // ============================================================

    function bindDisciplineFormEvents(container) {
        var modal = document.getElementById('faculty-discipline-modal');
        var form = document.getElementById('faculty-discipline-form');
        var closeBtn = document.getElementById('faculty-discipline-close');
        var cancelBtn = document.getElementById('faculty-discipline-cancel');
        var titleEl = document.getElementById('faculty-discipline-modal-title');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                handleSaveDiscipline(form);
            });
        }
    }

    function showDisciplineForm(editId) {
        var modal = document.getElementById('faculty-discipline-modal');
        var form = document.getElementById('faculty-discipline-form');
        var titleEl = document.getElementById('faculty-discipline-modal-title');
        var nameInput = document.getElementById('discipline-name');
        var typeSelect = document.getElementById('discipline-type');
        var instSelect = document.getElementById('discipline-instructors');
        var startWeek = document.getElementById('discipline-start-week');
        var endWeek = document.getElementById('discipline-end-week');
        var weeklyHours = document.getElementById('discipline-weekly-hours');
        var weightInput = document.getElementById('discipline-weight');

        if (!modal || !form) {
            notify('Form elements not found.', 'error');
            return;
        }

        if (instSelect) {
            var instructors = AcademyQueries.getInstructors();
            instSelect.innerHTML = '';
            for (var i = 0; i < instructors.length; i++) {
                var inst = instructors[i];
                var name = CharacterQueries.getDisplayName(inst);
                var option = document.createElement('option');
                option.value = inst.id;
                option.textContent = name;
                instSelect.appendChild(option);
            }
        }

        if (editId) {
            var disc = AcademyQueries.getDiscipline(editId);
            if (!disc) {
                notify('Discipline not found.', 'error');
                return;
            }
            titleEl.textContent = 'Edit Discipline';
            if (nameInput) { nameInput.value = disc.name || ''; }
            if (typeSelect) { typeSelect.value = disc.type || 'mandatory'; }
            if (instSelect && disc.instructorIds) {
                for (var j = 0; j < instSelect.options.length; j++) {
                    var opt = instSelect.options[j];
                    opt.selected = disc.instructorIds.indexOf(opt.value) !== -1;
                }
            }
            if (startWeek) { startWeek.value = disc.startWeek || MIN_WEEK; }
            if (endWeek) { endWeek.value = disc.endWeek || ''; }
            if (weeklyHours) { weeklyHours.value = disc.weeklyHours || 1; }
            if (weightInput) { weightInput.value = disc.weight || 1; }
            form.dataset.editId = editId;
        } else {
            titleEl.textContent = 'Add Discipline';
            if (nameInput) { nameInput.value = ''; }
            if (typeSelect) { typeSelect.value = 'mandatory'; }
            if (instSelect) {
                for (var k = 0; k < instSelect.options.length; k++) {
                    instSelect.options[k].selected = false;
                }
            }
            if (startWeek) { startWeek.value = MIN_WEEK; }
            if (endWeek) { endWeek.value = ''; }
            if (weeklyHours) { weeklyHours.value = 1; }
            if (weightInput) { weightInput.value = 1; }
            delete form.dataset.editId;
        }

        modal.classList.remove('hidden');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }

    function handleSaveDiscipline(form) {
        var nameInput = document.getElementById('discipline-name');
        var typeSelect = document.getElementById('discipline-type');
        var instSelect = document.getElementById('discipline-instructors');
        var startWeek = document.getElementById('discipline-start-week');
        var endWeek = document.getElementById('discipline-end-week');
        var weeklyHours = document.getElementById('discipline-weekly-hours');
        var weightInput = document.getElementById('discipline-weight');

        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            notify('Discipline name is required.', 'error');
            return;
        }

        var data = {
            name: name,
            type: typeSelect ? typeSelect.value : 'mandatory',
            instructorIds: instSelect ? Array.from(instSelect.selectedOptions).map(function(o) { return o.value; }) : [],
            startWeek: startWeek ? parseInt(startWeek.value, 10) || MIN_WEEK : MIN_WEEK,
            endWeek: endWeek ? parseInt(endWeek.value, 10) || '' : '',
            weeklyHours: weeklyHours ? parseFloat(weeklyHours.value) || 1 : 1,
            weight: weightInput ? parseFloat(weightInput.value) || 1 : 1
        };

        var editId = form.dataset.editId;
        var AcademyDisciplines = getAcademyDisciplines();
        if (!AcademyDisciplines) {
            notify('AcademyDisciplines not available.', 'error');
            return;
        }

        // AcademyDisciplines.create / update return PLAIN OBJECTS,
        // not Promises.
        var result = editId
            ? AcademyDisciplines.update(editId, data)
            : AcademyDisciplines.create(data);

        if (result && result.success) {
            notify(editId ? 'Discipline updated successfully.' : 'Discipline created successfully.', 'success');
            var modal = document.getElementById('faculty-discipline-modal');
            if (modal) { modal.classList.add('hidden'); }
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to save discipline.', 'error');
        }
    }

    function handleDeleteDiscipline(id) {
        var AcademyDisciplines = getAcademyDisciplines();
        if (!AcademyDisciplines) {
            notify('AcademyDisciplines not available.', 'error');
            return;
        }

        var result = AcademyDisciplines.delete(id);

        if (result && result.success) {
            notify('Discipline deleted successfully.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to delete discipline.', 'error');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FacultyTab = {
        render: render,
        bindEvents: bindEvents,
        switchInstructorDetailTab: switchInstructorDetailTab,
        showLocationModal: showLocationModal,
        refreshLocationModal: refreshLocationModal,
        showLocationForm: showLocationForm,
        showDisciplineForm: showDisciplineForm
    };

    window.__facultyTabLoaded = true;

})();
