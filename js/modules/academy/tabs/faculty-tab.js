/**
 * js/modules/academy/tabs/faculty-tab.js - Faculty Sub-Tab
 * Handles instructor management, schedules, locations, and auto-groups
 * Path: js/modules/academy/tabs/faculty-tab.js
 * 
 * This module is responsible for:
 *   - Instructor list filtered by class
 *   - Instructor schedule (templates + blocks)
 *   - Location schedule
 *   - Auto-groups (discipline + instructor)
 *   - Discipline/curriculum management
 * 
 * IMPORTANT:
 *   - All mutations delegate to AcademyCore
 *   - This module is RENDER-ONLY + event delegation
 *   - No direct data mutation
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 *   - All modals use Modal system
 *   - Calendar grid reuses CalendarRenderer when available
 * 
 * DEPENDENCIES:
 *   - window.AcademyCore (from academy-core.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyViews (from academy-views.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.Modal (from modal.js)
 *   - window.CalendarRenderer (from calendar-renderer.js) - optional
 *   - window.CalendarUtils (from calendar-utils.js) - optional
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__facultyTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyCore = window.AcademyCore;
    var AcademyQueries = window.AcademyQueries;
    var AcademyViews = window.AcademyViews;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var CalendarRenderer = window.CalendarRenderer;
    var CalendarUtils = window.CalendarUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyCore || typeof AcademyCore.getInstructorTemplates !== 'function') {
            missing.push('AcademyCore.getInstructorTemplates');
        }
        if (!AcademyCore || typeof AcademyCore.addInstructorClassTemplate !== 'function') {
            missing.push('AcademyCore.addInstructorClassTemplate');
        }
        if (!AcademyCore || typeof AcademyCore.removeInstructorClassTemplate !== 'function') {
            missing.push('AcademyCore.removeInstructorClassTemplate');
        }
        if (!AcademyCore || typeof AcademyCore.getInstructorBlocks !== 'function') {
            missing.push('AcademyCore.getInstructorBlocks');
        }
        if (!AcademyCore || typeof AcademyCore.addInstructorBlock !== 'function') {
            missing.push('AcademyCore.addInstructorBlock');
        }
        if (!AcademyCore || typeof AcademyCore.removeInstructorBlock !== 'function') {
            missing.push('AcademyCore.removeInstructorBlock');
        }
        if (!AcademyCore || typeof AcademyCore.getLocationSchedule !== 'function') {
            missing.push('AcademyCore.getLocationSchedule');
        }
        if (!AcademyCore || typeof AcademyCore.setLocationClass !== 'function') {
            missing.push('AcademyCore.setLocationClass');
        }
        if (!AcademyCore || typeof AcademyCore.removeLocationClass !== 'function') {
            missing.push('AcademyCore.removeLocationClass');
        }
        if (!AcademyCore || typeof AcademyCore.getAllAutoGroups !== 'function') {
            missing.push('AcademyCore.getAllAutoGroups');
        }
        if (!AcademyCore || typeof AcademyCore.createAutoGroup !== 'function') {
            missing.push('AcademyCore.createAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.deleteAutoGroup !== 'function') {
            missing.push('AcademyCore.deleteAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.addStudentToAutoGroup !== 'function') {
            missing.push('AcademyCore.addStudentToAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.removeStudentFromAutoGroup !== 'function') {
            missing.push('AcademyCore.removeStudentFromAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.addSlotToAutoGroup !== 'function') {
            missing.push('AcademyCore.addSlotToAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.removeSlotFromAutoGroup !== 'function') {
            missing.push('AcademyCore.removeSlotFromAutoGroup');
        }
        if (!AcademyCore || typeof AcademyCore.rebuildAutoGroups !== 'function') {
            missing.push('AcademyCore.rebuildAutoGroups');
        }
        if (!AcademyCore || typeof AcademyCore.getDisciplines !== 'function') {
            missing.push('AcademyCore.getDisciplines');
        }
        if (!AcademyCore || typeof AcademyCore.createDiscipline !== 'function') {
            missing.push('AcademyCore.createDiscipline');
        }
        if (!AcademyCore || typeof AcademyCore.updateDiscipline !== 'function') {
            missing.push('AcademyCore.updateDiscipline');
        }
        if (!AcademyCore || typeof AcademyCore.deleteDiscipline !== 'function') {
            missing.push('AcademyCore.deleteDiscipline');
        }
        if (!AcademyCore || typeof AcademyCore.getLocations !== 'function') {
            missing.push('AcademyCore.getLocations');
        }
        if (!AcademyCore || typeof AcademyCore.getInstructors !== 'function') {
            missing.push('AcademyCore.getInstructors');
        }
        if (!AcademyCore || typeof AcademyCore.getStudents !== 'function') {
            missing.push('AcademyCore.getStudents');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
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
            console.warn('FacultyTab: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__facultyTabLoaded = true;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    // ============================================================
    // CALENDAR HELPERS
    // ============================================================

    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;
    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    function formatHour(hour, includeMinutes) {
        if (CalendarUtils && typeof CalendarUtils.formatHour === 'function') {
            return CalendarUtils.formatHour(hour, includeMinutes);
        }
        includeMinutes = includeMinutes !== false;
        var num = parseInt(hour, 10);
        if (isNaN(num) || num < 0 || num > 23) {
            return String(hour);
        }
        var displayHour = num > 12 ? num - 12 : num;
        if (num === 0) displayHour = 12;
        var ampm = num >= 12 ? 'PM' : 'AM';
        return displayHour + (includeMinutes ? ':00 ' : ' ') + ampm;
    }

    // ============================================================
    // RENDER FACULTY TAB
    // ============================================================

    function renderFacultyTab(state) {
        var selectedClassId = state.selectedClassId;
        var selectedInstructorId = state.selectedInstructorId;
        var week = state.selectedWeek || 1;

        var selectedClass = selectedClassId ? AcademyCore.getClass(selectedClassId) : null;
        var selectedInstructor = selectedInstructorId ? AcademyCore.getCharacterById(selectedInstructorId) : null;

        var instructors = selectedClassId ? AcademyCore.getClassInstructors(selectedClassId) : [];

        var html = '';

        // Header with class filter info and week selector
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
        html += '<input type="number" id="faculty-week-input" value="' + week + '" min="1" max="52" class="small">';
        html += '<button id="faculty-week-apply" class="small secondary">Apply</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        // Faculty tabs
        html += '<div class="faculty-tab-nav">';
        html += '<button class="faculty-nav-btn active" data-view="instructors">Instructors</button>';
        html += '<button class="faculty-nav-btn" data-view="locations">Locations</button>';
        html += '<button class="faculty-nav-btn" data-view="autogroups">Auto-Groups</button>';
        html += '<button class="faculty-nav-btn" data-view="disciplines">Disciplines</button>';
        html += '</div>';

        // View containers
        html += '<div class="faculty-view-container">';

        // Instructors view
        html += '<div class="faculty-view-panel active" data-view="instructors">';
        html += renderInstructorsView(state, instructors);
        html += '</div>';

        // Locations view
        html += '<div class="faculty-view-panel" data-view="locations" style="display:none;">';
        html += renderLocationsView(state);
        html += '</div>';

        // Auto-groups view
        html += '<div class="faculty-view-panel" data-view="autogroups" style="display:none;">';
        html += renderAutoGroupsView(state);
        html += '</div>';

        // Disciplines view
        html += '<div class="faculty-view-panel" data-view="disciplines" style="display:none;">';
        html += renderDisciplinesView(state);
        html += '</div>';

        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTORS VIEW
    // ============================================================

    function renderInstructorsView(state, instructors) {
        var selectedInstructorId = state.selectedInstructorId;
        var week = state.selectedWeek || 1;

        var html = '';

        html += '<div class="instructors-layout">';
        html += '<div class="instructors-sidebar">';
        html += '<div class="instructors-list-header">';
        html += '<h4>Instructors</h4>';
        html += '<span class="instructors-count">' + instructors.length + '</span>';
        html += '</div>';

        if (instructors.length === 0) {
            html += '<p class="empty-state small">No instructors in this class.</p>';
        } else {
            html += '<div class="instructors-list">';
            for (var i = 0; i < instructors.length; i++) {
                var instructor = instructors[i];
                var name = CharacterQueries.getDisplayName(instructor);
                var isSelected = selectedInstructorId === instructor.id;

                html += '<div class="instructor-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(instructor.id) + '">';
                html += '<span class="instructor-name">' + escapeHtml(name) + '</span>';
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';

        // Instructor detail
        html += '<div class="instructors-detail">';
        if (selectedInstructorId) {
            var instructor = AcademyCore.getCharacterById(selectedInstructorId);
            if (instructor) {
                html += renderInstructorDetail(state, instructor);
            } else {
                html += '<p class="empty-state">Instructor not found.</p>';
            }
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

    function renderInstructorDetail(state, instructor) {
        var instructorId = instructor.id;
        var week = state.selectedWeek || 1;
        var name = CharacterQueries.getDisplayName(instructor);

        var templates = AcademyCore.getInstructorTemplates(instructorId, week);
        var blocks = AcademyCore.getInstructorBlocks(instructorId, week);

        var html = '';

        // Header
        html += '<div class="instructor-detail-header">';
        html += '<h4>' + escapeHtml(name) + '</h4>';
        html += '<span class="instructor-detail-week">Week ' + week + '</span>';
        html += '</div>';

        // Tabs
        html += '<div class="instructor-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="schedule">Schedule</button>';
        html += '<button class="detail-tab-btn" data-tab="blocks">Blocks</button>';
        html += '</div>';

        // Schedule tab
        html += '<div class="detail-tab-panel active" data-tab="schedule">';
        html += renderInstructorSchedule(state, instructor, templates);
        html += '</div>';

        // Blocks tab
        html += '<div class="detail-tab-panel" data-tab="blocks" style="display:none;">';
        html += renderInstructorBlocks(state, instructor, blocks);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER INSTRUCTOR SCHEDULE
    // ============================================================

    function renderInstructorSchedule(state, instructor, templates) {
        var html = '';

        // Add template form
        html += '<div class="schedule-add-form">';
        html += '<select id="schedule-discipline-select" class="small">';
        html += '<option value="">Select discipline...</option>';
        var disciplines = AcademyQueries.getAvailableDisciplines(state.selectedWeek || 1);
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-day-select" class="small">';
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (var d2 = 0; d2 < days.length; d2++) {
            html += '<option value="' + (d2 + 1) + '">' + days[d2] + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-hour-select" class="small">';
        for (var h = 8; h <= 18; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="schedule-duration-select" class="small">';
        html += '<option value="1">1 hour</option>';
        html += '<option value="2">2 hours</option>';
        html += '<option value="3">3 hours</option>';
        html += '<option value="4">4 hours</option>';
        html += '</select>';
        html += '<button id="schedule-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Schedule grid
        html += '<div class="schedule-grid-container">';
        html += '<table class="schedule-grid">';
        html += '<thead>';
        html += '<tr><th>Time</th>';
        for (var d3 = 1; d3 <= 7; d3++) {
            html += '<th>' + days[d3 - 1] + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var h2 = 8; h2 <= 18; h2++) {
            html += '<tr>';
            html += '<td class="schedule-time">' + h2 + ':00</td>';

            for (var d4 = 1; d4 <= 7; d4++) {
                var key = d4 + '_' + h2;
                var template = templates[key] || null;
                var display = '';
                var className = 'schedule-empty';

                if (template) {
                    var disc = AcademyCore.getDiscipline(template.disciplineId);
                    display = disc ? disc.name : 'Unknown';
                    className = 'schedule-class';
                    if (template.assignedStudents && template.assignedStudents.length > 0) {
                        display += ' (' + template.assignedStudents.length + ')';
                    }
                } else {
                    display = '·';
                    className = 'schedule-empty';
                }

                html += '<td class="' + className + '" data-day="' + d4 + '" data-hour="' + h2 + '"';
                if (template) {
                    html += ' data-discipline="' + escapeHtml(template.disciplineId) + '"';
                    html += ' data-duration="' + escapeHtml(template.duration) + '"';
                }
                html += '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (template) {
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

    function renderInstructorBlocks(state, instructor, blocks) {
        var html = '';

        // Add block form
        html += '<div class="blocks-add-form">';
        html += '<select id="block-day-select" class="small">';
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (var d = 0; d < days.length; d++) {
            html += '<option value="' + (d + 1) + '">' + days[d] + '</option>';
        }
        html += '</select>';
        html += '<select id="block-hour-select" class="small">';
        for (var h = 8; h <= 18; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="block-duration-select" class="small">';
        html += '<option value="1">1 hour</option>';
        html += '<option value="2">2 hours</option>';
        html += '<option value="3">3 hours</option>';
        html += '<option value="4">4 hours</option>';
        html += '</select>';
        html += '<input type="text" id="block-label-input" placeholder="Label (optional)" class="small">';
        html += '<button id="block-add-btn" class="warning small">Add Block</button>';
        html += '</div>';

        // Blocks list
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
                var dayName = days[b.day - 1];
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

    function renderLocationsView(state) {
        var week = state.selectedWeek || 1;
        var locations = AcademyCore.getLocations();

        var html = '';

        html += '<div class="locations-view-header">';
        html += '<h4>Location Schedule</h4>';
        html += '<span class="locations-week">Week ' + week + '</span>';
        html += '</div>';

        if (locations.length === 0) {
            html += '<p class="empty-state">No locations available.</p>';
        } else {
            html += '<div class="locations-grid">';
            for (var i = 0; i < locations.length; i++) {
                var loc = locations[i];
                var schedule = AcademyCore.getLocationSchedule(loc.id, week);

                html += '<div class="location-card">';
                html += '<div class="location-card-header">';
                html += '<h5>' + escapeHtml(loc.name) + '</h5>';
                html += '<span class="location-type">' + escapeHtml(loc.type || 'other') + '</span>';
                if (loc.capacity) {
                    html += '<span class="location-capacity">Cap: ' + escapeHtml(loc.capacity) + '</span>';
                }
                html += '</div>';

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
                    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                    for (var d = 1; d <= 7; d++) {
                        if (!schedule[d]) { continue; }
                        var daySchedule2 = schedule[d];
                        var dayEntries = [];
                        for (var h in daySchedule2) {
                            if (!Object.prototype.hasOwnProperty.call(daySchedule2, h)) { continue; }
                            if (daySchedule2[h]) {
                                var disc = AcademyCore.getDiscipline(daySchedule2[h]);
                                dayEntries.push({
                                    hour: parseInt(h, 10),
                                    name: disc ? disc.name : 'Unknown'
                                });
                            }
                        }
                        if (dayEntries.length > 0) {
                            html += '<div class="location-day">';
                            html += '<span class="location-day-name">' + days[d - 1] + '</span>';
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

                html += '<div class="location-actions">';
                html += '<button class="location-manage-btn small" data-location="' + escapeHtml(loc.id) + '">Manage</button>';
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER AUTO-GROUPS VIEW
    // ============================================================

    function renderAutoGroupsView(state) {
        var week = state.selectedWeek || 1;
        var groups = AcademyCore.getAllAutoGroups();

        var html = '';

        // Create group form
        html += '<div class="autogroups-header">';
        html += '<h4>Auto-Groups</h4>';
        html += '<button id="autogroup-rebuild-btn" class="secondary small">Rebuild from Schedules</button>';
        html += '</div>';

        html += '<div class="autogroups-add-form">';
        html += '<select id="autogroup-discipline-select" class="small">';
        html += '<option value="">Select discipline...</option>';
        var disciplines = AcademyCore.getDisciplines();
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        html += '</select>';
        html += '<select id="autogroup-instructor-select" class="small">';
        html += '<option value="">Select instructor...</option>';
        var instructors = AcademyCore.getInstructors();
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
                var disc = AcademyCore.getDiscipline(group.disciplineId);
                var instructor = AcademyCore.getCharacterById(group.instructorId);
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
                    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                    for (var k = 0; k < group.slots.length; k++) {
                        var slot = group.slots[k];
                        var dayName = days[(slot.day || 1) - 1] || '?';
                        html += '<span class="autogroup-slot">' + dayName + ' ' + (slot.hour || 0) + ':00 - ' + ((slot.hour || 0) + (slot.duration || 1)) + ':00</span>';
                    }
                    html += '</div>';
                }

                // Students
                if (group.students && group.students.length > 0) {
                    html += '<div class="autogroup-students">';
                    for (var s = 0; s < group.students.length; s++) {
                        var student = AcademyCore.getCharacterById(group.students[s]);
                        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
                        html += '<span class="autogroup-student">' + escapeHtml(studentName) + '</span>';
                    }
                    html += '</div>';
                }

                // Add student form
                html += '<div class="autogroup-add-student">';
                html += '<select class="autogroup-student-select small">';
                html += '<option value="">Add student...</option>';
                var availableStudents = AcademyCore.getStudents();
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

                // Add slot form
                html += '<div class="autogroup-add-slot">';
                html += '<select class="autogroup-slot-day small">';
                for (var d2 = 0; d2 < days.length; d2++) {
                    html += '<option value="' + (d2 + 1) + '">' + days[d2] + '</option>';
                }
                html += '</select>';
                html += '<select class="autogroup-slot-hour small">';
                for (var h2 = 8; h2 <= 18; h2++) {
                    html += '<option value="' + h2 + '">' + h2 + ':00</option>';
                }
                html += '</select>';
                html += '<select class="autogroup-slot-duration small">';
                html += '<option value="1">1h</option>';
                html += '<option value="2">2h</option>';
                html += '<option value="3">3h</option>';
                html += '<option value="4">4h</option>';
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

    function renderDisciplinesView(state) {
        var disciplines = AcademyCore.getDisciplines();

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
                    var inst = AcademyCore.getCharacterById(id);
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
                                '<input type="number" id="discipline-start-week" min="1" max="52" value="1">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>End Week</label>',
                                '<input type="number" id="discipline-end-week" min="1" max="52">',
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
    // EVENT BINDING
    // ============================================================

    function bindFacultyTabEvents(container) {
        // Week selector
        var weekApply = container.querySelector('#faculty-week-apply');
        if (weekApply) {
            weekApply.addEventListener('click', function() {
                var input = container.querySelector('#faculty-week-input');
                if (input) {
                    var week = parseInt(input.value, 10);
                    if (!isNaN(week) && week >= 1 && week <= 52) {
                        if (window.academyState && typeof window.academyState.selectWeek === 'function') {
                            window.academyState.selectWeek(week);
                            if (typeof window.refreshAcademy === 'function') {
                                window.refreshAcademy();
                            }
                        }
                    } else {
                        showNotification('Please enter a valid week (1-52).', 'error');
                    }
                }
            });
        }

        var weekInput = container.querySelector('#faculty-week-input');
        if (weekInput) {
            weekInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var applyBtn = container.querySelector('#faculty-week-apply');
                    if (applyBtn) { applyBtn.click(); }
                }
            });
        }

        // Navigation tabs
        var navBtns = container.querySelectorAll('.faculty-nav-btn');
        for (var i = 0; i < navBtns.length; i++) {
            navBtns[i].addEventListener('click', function() {
                var view = this.dataset.view;
                if (!view) { return; }

                // Update nav buttons
                var allBtns = container.querySelectorAll('.faculty-nav-btn');
                for (var b = 0; b < allBtns.length; b++) {
                    allBtns[b].classList.remove('active');
                }
                this.classList.add('active');

                // Show corresponding panel
                var panels = container.querySelectorAll('.faculty-view-panel');
                for (var p = 0; p < panels.length; p++) {
                    var panel = panels[p];
                    var isActive = panel.dataset.view === view;
                    panel.style.display = isActive ? 'block' : 'none';
                    panel.classList.toggle('active', isActive);
                }
            });
        }

        // Instructor list click
        var listContainer = container.querySelector('.instructors-list');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.instructor-list-item');
                if (!item) { return; }
                var id = item.dataset.id;
                if (id && window.academyState && typeof window.academyState.selectInstructor === 'function') {
                    window.academyState.selectInstructor(id);
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                }
            });
        }

        // Instructor detail tabs
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

        // Schedule add
        var scheduleAddBtn = container.querySelector('#schedule-add-btn');
        if (scheduleAddBtn) {
            scheduleAddBtn.addEventListener('click', function() {
                handleAddSchedule(container);
            });
        }

        // Schedule remove (delegated)
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

        // Block add
        var blockAddBtn = container.querySelector('#block-add-btn');
        if (blockAddBtn) {
            blockAddBtn.addEventListener('click', function() {
                handleAddBlock(container);
            });
        }

        // Block remove (delegated)
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

        // Location manage (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.location-manage-btn');
            if (btn) {
                var locationId = btn.dataset.location;
                if (locationId) {
                    showLocationModal(locationId);
                }
            }
        });

        // Auto-group create
        var agCreateBtn = container.querySelector('#autogroup-create-btn');
        if (agCreateBtn) {
            agCreateBtn.addEventListener('click', function() {
                handleCreateAutoGroup(container);
            });
        }

        // Auto-group delete (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.autogroup-delete-btn');
            if (btn) {
                var key = btn.dataset.key;
                if (key && confirm('Delete this auto-group?')) {
                    handleDeleteAutoGroup(key);
                }
            }
        });

        // Auto-group add student (delegated)
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

        // Auto-group add slot (delegated)
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

        // Auto-group rebuild
        var rebuildBtn = container.querySelector('#autogroup-rebuild-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                if (confirm('Rebuild auto-groups from schedules? This will replace all existing groups.')) {
                    handleRebuildAutoGroups();
                }
            });
        }

        // Discipline add
        var discAddBtn = container.querySelector('#discipline-add-btn');
        if (discAddBtn) {
            discAddBtn.addEventListener('click', function() {
                showDisciplineForm(null);
            });
        }

        // Discipline edit (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.discipline-edit-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id) {
                    showDisciplineForm(id);
                }
            }
        });

        // Discipline delete (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.discipline-delete-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id && confirm('Delete this discipline?')) {
                    handleDeleteDiscipline(id);
                }
            }
        });

        // Location modal
        bindLocationModalEvents(container);

        // Discipline form
        bindDisciplineFormEvents(container);
    }

    // ============================================================
    // INSTRUCTOR DETAIL TAB SWITCHING
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
    // SCHEDULE HANDLERS
    // ============================================================

    function handleAddSchedule(container) {
        var instructorId = window.academyState ? window.academyState.getSelectedInstructorId() : null;
        if (!instructorId) {
            showNotification('No instructor selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var discSelect = container.querySelector('#schedule-discipline-select');
        var daySelect = container.querySelector('#schedule-day-select');
        var hourSelect = container.querySelector('#schedule-hour-select');
        var durationSelect = container.querySelector('#schedule-duration-select');

        var disciplineId = discSelect ? discSelect.value : '';
        var day = daySelect ? parseInt(daySelect.value, 10) : 1;
        var hour = hourSelect ? parseInt(hourSelect.value, 10) : 8;
        var duration = durationSelect ? parseInt(durationSelect.value, 10) : 1;

        if (!disciplineId) {
            showNotification('Please select a discipline.', 'error');
            return;
        }

        var result = AcademyCore.addInstructorClassTemplate(instructorId, week, day, hour, {
            disciplineId: disciplineId,
            duration: duration,
            label: '',
            groupLabel: 'auto-group'
        });

        if (result && result.success) {
            showNotification('Schedule added successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Schedule added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add schedule.', 'error');
        }
    }

    function handleRemoveSchedule(container, day, hour) {
        var instructorId = window.academyState ? window.academyState.getSelectedInstructorId() : null;
        if (!instructorId) {
            showNotification('No instructor selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var result = AcademyCore.removeInstructorClassTemplate(instructorId, week, day, hour);

        if (result && result.success) {
            showNotification('Schedule removed successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Schedule removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove schedule.', 'error');
        }
    }

    // ============================================================
    // BLOCK HANDLERS
    // ============================================================

    function handleAddBlock(container) {
        var instructorId = window.academyState ? window.academyState.getSelectedInstructorId() : null;
        if (!instructorId) {
            showNotification('No instructor selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var daySelect = container.querySelector('#block-day-select');
        var hourSelect = container.querySelector('#block-hour-select');
        var durationSelect = container.querySelector('#block-duration-select');
        var labelInput = container.querySelector('#block-label-input');

        var day = daySelect ? parseInt(daySelect.value, 10) : 1;
        var hour = hourSelect ? parseInt(hourSelect.value, 10) : 8;
        var duration = durationSelect ? parseInt(durationSelect.value, 10) : 1;
        var label = labelInput ? labelInput.value.trim() : 'Blocked';

        var result = AcademyCore.addInstructorBlock(instructorId, week, day, hour, {
            duration: duration,
            label: label
        });

        if (result && result.success) {
            showNotification('Block added successfully.', 'success');
            if (labelInput) { labelInput.value = ''; }
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Block added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add block.', 'error');
        }
    }

    function handleRemoveBlock(container, day, hour) {
        var instructorId = window.academyState ? window.academyState.getSelectedInstructorId() : null;
        if (!instructorId) {
            showNotification('No instructor selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var result = AcademyCore.removeInstructorBlock(instructorId, week, day, hour);

        if (result && result.success) {
            showNotification('Block removed successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Block removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove block.', 'error');
        }
    }

    // ============================================================
    // LOCATION MODAL
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
        }

        // Add class to location (delegated)
        modal.addEventListener('click', function(e) {
            var btn = e.target.closest('.location-add-class-btn');
            if (btn) {
                var locationId = btn.dataset.location;
                var day = parseInt(btn.dataset.day, 10);
                var hour = parseInt(btn.dataset.hour, 10);
                var select = document.getElementById('location-class-select');
                
                if (locationId && select && select.value) {
                    var week = window.academyState ? window.academyState.getSelectedWeek() : 1;
                    var result = AcademyCore.setLocationClass(locationId, week, day, hour, select.value);
                    if (result && result.success) {
                        showNotification('Class assigned to location.', 'success');
                        refreshLocationModal(locationId);
                        persistMutation(null, 'Class assigned in memory, but persistence failed.');
                    } else {
                        showNotification(result ? result.message : 'Failed to assign class.', 'error');
                    }
                }
            }
        });

        // Remove class from location (delegated)
        modal.addEventListener('click', function(e) {
            var btn = e.target.closest('.location-remove-class-btn');
            if (btn) {
                var locationId = btn.dataset.location;
                var day = parseInt(btn.dataset.day, 10);
                var hour = parseInt(btn.dataset.hour, 10);
                if (locationId && confirm('Remove this class from location?')) {
                    var week = window.academyState ? window.academyState.getSelectedWeek() : 1;
                    var result = AcademyCore.removeLocationClass(locationId, week, day, hour);
                    if (result && result.success) {
                        showNotification('Class removed from location.', 'success');
                        refreshLocationModal(locationId);
                        persistMutation(null, 'Class removed in memory, but persistence failed.');
                    } else {
                        showNotification(result ? result.message : 'Failed to remove class.', 'error');
                    }
                }
            }
        });
    }

    function showLocationModal(locationId) {
        var modal = document.getElementById('faculty-location-modal');
        var title = document.getElementById('faculty-location-modal-title');

        if (!modal) {
            showNotification('Modal not found.', 'error');
            return;
        }

        var loc = AcademyCore.getLocation(locationId);
        if (loc) {
            title.textContent = 'Manage: ' + loc.name;
        }

        modal.dataset.locationId = locationId;
        refreshLocationModal(locationId);
        modal.classList.remove('hidden');
    }

    function refreshLocationModal(locationId) {
        var content = document.getElementById('faculty-location-content');
        if (!content) { return; }

        var loc = AcademyCore.getLocation(locationId);
        if (!loc) {
            content.innerHTML = '<p class="empty-state">Location not found.</p>';
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;
        var schedule = AcademyCore.getLocationSchedule(locationId, week);
        var disciplines = AcademyQueries.getAvailableDisciplines(week);

        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        var html = '';
        html += '<div class="location-modal-info">';
        html += '<p><strong>' + escapeHtml(loc.name) + '</strong> - ' + escapeHtml(loc.type || 'other') + '</p>';
        html += '<p>Week ' + week + '</p>';
        html += '</div>';

        html += '<div class="location-modal-schedule">';
        for (var d = 1; d <= 7; d++) {
            html += '<div class="location-modal-day">';
            html += '<span class="location-modal-day-name">' + days[d - 1] + '</span>';
            var daySchedule = schedule[d] || {};
            
            for (var h = 8; h <= 18; h++) {
                var classId = daySchedule[h] || null;
                var display = '';
                var className = 'location-modal-slot empty';

                if (classId) {
                    var disc = AcademyCore.getDiscipline(classId);
                    display = disc ? disc.name : 'Unknown';
                    className = 'location-modal-slot occupied';
                } else {
                    display = '·';
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

        // Add click handlers for show/hide class select
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

    // ============================================================
    // AUTO-GROUP HANDLERS
    // ============================================================

    function handleCreateAutoGroup(container) {
        var discSelect = container.querySelector('#autogroup-discipline-select');
        var instSelect = container.querySelector('#autogroup-instructor-select');

        var disciplineId = discSelect ? discSelect.value : '';
        var instructorId = instSelect ? instSelect.value : '';

        if (!disciplineId || !instructorId) {
            showNotification('Please select both discipline and instructor.', 'error');
            return;
        }

        var result = AcademyCore.createAutoGroup(disciplineId, instructorId);

        if (result && result.success) {
            showNotification('Auto-group created successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Auto-group created in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to create auto-group.', 'error');
        }
    }

    function handleDeleteAutoGroup(key) {
        var result = AcademyCore.deleteAutoGroup(key);

        if (result && result.success) {
            showNotification('Auto-group deleted successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Auto-group deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete auto-group.', 'error');
        }
    }

    function handleAddStudentToAutoGroup(key, studentId) {
        var result = AcademyCore.addStudentToAutoGroup(key, studentId);

        if (result && result.success) {
            showNotification('Student added to auto-group.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Student added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add student.', 'error');
        }
    }

    function handleAddSlotToAutoGroup(key, day, hour, duration) {
        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var result = AcademyCore.addSlotToAutoGroup(key, week, day, hour, duration);

        if (result && result.success) {
            showNotification('Slot added to auto-group.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Slot added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add slot.', 'error');
        }
    }

    function handleRebuildAutoGroups() {
        var result = AcademyCore.rebuildAutoGroups();

        if (result && result.success) {
            var count = result.count || 0;
            showNotification('Rebuilt ' + count + ' auto-groups from schedules.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Auto-groups rebuilt in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to rebuild auto-groups.', 'error');
        }
    }

    // ============================================================
    // DISCIPLINE HANDLERS
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

        // Populate instructor select when modal opens
        // This is triggered by showDisciplineForm
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
            showNotification('Form elements not found.', 'error');
            return;
        }

        // Populate instructor select
        if (instSelect) {
            var instructors = AcademyCore.getInstructors();
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
            var disc = AcademyCore.getDiscipline(editId);
            if (!disc) {
                showNotification('Discipline not found.', 'error');
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
            if (startWeek) { startWeek.value = disc.startWeek || 1; }
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
            if (startWeek) { startWeek.value = 1; }
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
            showNotification('Discipline name is required.', 'error');
            return;
        }

        var data = {
            name: name,
            type: typeSelect ? typeSelect.value : 'mandatory',
            instructorIds: instSelect ? Array.from(instSelect.selectedOptions).map(function(o) { return o.value; }) : [],
            startWeek: startWeek ? startWeek.value : 1,
            endWeek: endWeek ? endWeek.value : '',
            weeklyHours: weeklyHours ? parseFloat(weeklyHours.value) || 1 : 1,
            weight: weightInput ? parseFloat(weightInput.value) || 1 : 1
        };

        var editId = form.dataset.editId;
        var result;

        if (editId) {
            result = AcademyCore.updateDiscipline(editId, data);
        } else {
            result = AcademyCore.createDiscipline(data);
        }

        if (result && result.success) {
            showNotification(editId ? 'Discipline updated successfully.' : 'Discipline created successfully.', 'success');
            var modal = document.getElementById('faculty-discipline-modal');
            if (modal) { modal.classList.add('hidden'); }
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Discipline changes in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to save discipline.', 'error');
        }
    }

    function handleDeleteDiscipline(id) {
        var result = AcademyCore.deleteDiscipline(id);

        if (result && result.success) {
            showNotification('Discipline deleted successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Discipline deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete discipline.', 'error');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FacultyTab = {
        render: renderFacultyTab,
        renderInstructorsView: renderInstructorsView,
        renderInstructorDetail: renderInstructorDetail,
        renderLocationsView: renderLocationsView,
        renderAutoGroupsView: renderAutoGroupsView,
        renderDisciplinesView: renderDisciplinesView,
        bindEvents: bindFacultyTabEvents,
        showLocationModal: showLocationModal,
        refreshLocationModal: refreshLocationModal,
        showDisciplineForm: showDisciplineForm
    };

})();