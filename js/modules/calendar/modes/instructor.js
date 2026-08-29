/**
 * js/modules/calendar/modes/instructor.js - Instructor Calendar Mode
 * Full implementation of instructor calendar
 * Path: js/modules/calendar/modes/instructor.js
 * 
 * This module is responsible for:
 *   - Rendering instructor calendar grid
 *   - Displaying instructor's class templates and blocks
 *   - Showing which students are assigned to each class
 *   - Managing student assignments (delegated to core)
 * 
 * IMPORTANT:
 *   - This module uses core functions for ALL mutations
 *   - NO direct window.data mutations
 *   - Student schedules are the canonical source of truth for assignments
 *   - Instructor templates define the instructor's scheduled teaching slots
 *   - All assignment changes go through updateInstructorClassAssignments()
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUtils) {
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__instructorModeLoaded) {
        return;
    }
    window.__instructorModeLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CalendarUtils = window.CalendarUtils;

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Query functions
        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getAvailableDisciplines !== 'function') {
            missing.push('getAvailableDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.getClassInstructor !== 'function') {
            missing.push('getClassInstructor');
        }

        if (typeof window.getClassDuration !== 'function') {
            missing.push('getClassDuration');
        }

        if (typeof window.getClassLabel !== 'function') {
            missing.push('getClassLabel');
        }

        if (typeof window.getClassGroupLabel !== 'function') {
            missing.push('getClassGroupLabel');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        // Persistence
        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        // Core mutation functions
        if (typeof window.addInstructorClassTemplate !== 'function') {
            missing.push('addInstructorClassTemplate');
        }

        if (typeof window.removeInstructorClassTemplate !== 'function') {
            missing.push('removeInstructorClassTemplate');
        }

        if (typeof window.removeInstructorBlock !== 'function') {
            missing.push('removeInstructorBlock');
        }

        if (typeof window.updateInstructorClassAssignments !== 'function') {
            missing.push('updateInstructorClassAssignments');
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getInstructors() {
        return typeof window.getInstructors === 'function' ? window.getInstructors() : [];
    }

    function getSchedule(state) {
        var data = window.data || {};
        var schedule = {};

        if (state && state.selectedId) {
            var instructorId = state.selectedId;
            var week = state.week;

            // Get instructor class templates.
            // Templates define the instructor's scheduled teaching slots.
            // Student schedules remain authoritative for actual assignments.
            if (data.curriculum && data.curriculum.instructorTemplates) {
                var templateKey = instructorId + '_' + week;
                var templates = data.curriculum.instructorTemplates[templateKey] || {};

                for (var classKey in templates) {
                    if (!Object.prototype.hasOwnProperty.call(templates, classKey)) continue;
                    var parts = classKey.split('_');
                    var day = parseInt(parts[0], 10);
                    var hour = parseInt(parts[1], 10);
                    var template = templates[classKey];

                    if (!schedule[day]) schedule[day] = {};
                    schedule[day][hour] = {
                        disciplineId: template.disciplineId,
                        label: template.label || '',
                        groupLabel: template.groupLabel || '',
                        duration: template.duration || 1,
                        isTemplate: true
                    };
                }
            }

            // Get instructor blocks
            if (data.curriculum && data.curriculum.instructorBlocks) {
                var blockKey = instructorId + '_' + week;
                var blocks = data.curriculum.instructorBlocks[blockKey] || {};

                for (var day in blocks) {
                    if (!Object.prototype.hasOwnProperty.call(blocks, day)) continue;
                    var dayBlocks = blocks[day];
                    for (var hour in dayBlocks) {
                        if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) continue;
                        var block = dayBlocks[hour];
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][hour] = {
                            isBlock: true,
                            label: block.label || 'Blocked Time',
                            groupLabel: block.groupLabel || null,
                            duration: block.duration || 1,
                            disciplineId: block.disciplineId || null
                        };
                    }
                }
            }

            // Get student schedules (canonical source of truth for assignments)
            var students = window.getStudents() || [];
            for (var s = 0; s < students.length; s++) {
                var student = students[s];
                var studentSchedule = window.getStudentSchedule(student.id, week) || {};

                for (var day in studentSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) continue;
                    var daySchedule = studentSchedule[day];
                    if (!daySchedule || typeof daySchedule !== 'object') continue;

                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                        var disciplineId = daySchedule[hour];
                        if (!disciplineId) continue;

                        var classInstructorId = window.getClassInstructor(student.id, week, parseInt(day, 10), parseInt(hour, 10));
                        if (classInstructorId && String(classInstructorId) === String(instructorId)) {
                            if (!schedule[day]) schedule[day] = {};

                            var duration = window.getClassDuration(student.id, week, parseInt(day, 10), parseInt(hour, 10)) || 1;
                            var label = window.getClassLabel(student.id, week, parseInt(day, 10), parseInt(hour, 10));
                            var groupLabel = window.getClassGroupLabel(student.id, week, parseInt(day, 10), parseInt(hour, 10));

                            if (schedule[day][hour] && schedule[day][hour].isTemplate) {
                                if (!schedule[day][hour].students) schedule[day][hour].students = [];
                                var alreadyExists = false;
                                for (var a = 0; a < schedule[day][hour].students.length; a++) {
                                    if (String(schedule[day][hour].students[a].studentId) === String(student.id)) {
                                        alreadyExists = true;
                                        break;
                                    }
                                }
                                if (!alreadyExists) {
                                    schedule[day][hour].students.push({
                                        studentId: student.id,
                                        studentName: window.getDisplayName(student),
                                        groupLabel: groupLabel
                                    });
                                }
                            } else if (!schedule[day][hour] || schedule[day][hour].isBlock) {
                                if (!schedule[day][hour]) {
                                    schedule[day][hour] = {
                                        disciplineId: disciplineId,
                                        students: [],
                                        label: label || '',
                                        duration: duration,
                                        groupLabel: groupLabel || '',
                                        isTemplate: false
                                    };
                                }

                                if (schedule[day][hour] && !schedule[day][hour].isBlock) {
                                    if (!schedule[day][hour].students) schedule[day][hour].students = [];
                                    var alreadyExists2 = false;
                                    for (var b = 0; b < schedule[day][hour].students.length; b++) {
                                        if (String(schedule[day][hour].students[b].studentId) === String(student.id)) {
                                            alreadyExists2 = true;
                                            break;
                                        }
                                    }
                                    if (!alreadyExists2) {
                                        schedule[day][hour].students.push({
                                            studentId: student.id,
                                            studentName: window.getDisplayName(student),
                                            groupLabel: groupLabel
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return schedule;
    }

    function render(container, state) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Instructor calendar dependencies not loaded.</p>';
            return;
        }

        if (!state || !state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select an instructor to view their calendar</div>';
            return;
        }

        renderInstructorCalendar(container, state);
    }

    // ============================================================
    // RENDER INSTRUCTOR CALENDAR
    // ============================================================

    function renderInstructorCalendar(container, state) {
        var instructorId = state.selectedId;
        var week = state.week;

        var schedule = getSchedule(state);
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var html = '<div class="instructor-calendar">';
        html += '<div class="instructor-header"><h3>' + escapeHtml(instructorName) + ' - Week ' + week + '</h3></div>';
        html += getCalendarGridHTML(schedule, instructorId, week);
        html += '</div>';

        container.innerHTML = html;

        bindInstructorEvents(container, instructorId, week);
    }

    // ============================================================
    // CALENDAR GRID HTML
    // ============================================================

    function getCalendarGridHTML(schedule, instructorId, week) {
        var hours = [];
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }

        var html = '<div class="schedule-grid">';

        for (var day = 1; day <= 7; day++) {
            var dayName = DAY_NAMES[day];

            html += '<div class="day-column" data-day="' + day + '">';
            html += '<div class="day-header">' + dayName + '</div>';
            html += '<div class="day-slots">';

            var occupiedHours = {};

            for (var i = 0; i < hours.length; i++) {
                var hour = hours[i];

                if (occupiedHours[hour]) {
                    continue;
                }

                var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

                if (slotData) {
                    var duration = slotData.duration || 1;

                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        occupiedHours[h] = true;
                    }

                    var isBlock = slotData.isBlock || false;
                    var discipline = window.getDiscipline(slotData.disciplineId);
                    var studentCount = slotData.students ? slotData.students.length : 0;
                    var labelDisplay = slotData.label ? ' [' + escapeHtml(slotData.label) + ']' : '';
                    var groupDisplay = slotData.groupLabel ? ' (G' + escapeHtml(slotData.groupLabel) + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var templateDisplay = slotData.isTemplate && studentCount === 0 ? ' (template)' : '';
                    var blockDisplay = isBlock ? ' [B]' : '';
                    var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

                    var classNames = 'time-slot occupied';
                    if (isBlock) classNames += ' blocked';

                    html += '<div class="' + classNames + '" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + disciplineName + labelDisplay + groupDisplay + durationDisplay + blockDisplay + (studentCount > 0 ? ' - ' + studentCount + ' students' : '') + templateDisplay + '</span>';
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

        return html;
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindInstructorEvents(container, instructorId, week) {
        var emptySlots = container.querySelectorAll('.time-slot.empty');
        for (var i = 0; i < emptySlots.length; i++) {
            var slot = emptySlots[i];
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showAddInstructorClassModal(instructorId, week, day, hour, container);
            });
        }

        var occupiedSlots = container.querySelectorAll('.time-slot.occupied:not(.blocked)');
        for (var j = 0; j < occupiedSlots.length; j++) {
            var occSlot = occupiedSlots[j];
            occSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showInstructorClassDetailsModal(instructorId, week, day, hour, container);
            });

            occSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (confirm('Remove this class?')) {
                    removeInstructorClass(instructorId, week, day, hour, container);
                }
            });
        }

        var blockedSlots = container.querySelectorAll('.time-slot.blocked');
        for (var k = 0; k < blockedSlots.length; k++) {
            var blockSlot = blockedSlots[k];
            blockSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showBlockDetailsModal(instructorId, week, day, hour, container);
            });

            blockSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (confirm('Remove this blocked time?')) {
                    removeBlockedTime(instructorId, week, day, hour, container);
                }
            });
        }
    }

    // ============================================================
    // ADD CLASS MODAL
    // ============================================================

    function showAddInstructorClassModal(instructorId, week, day, hour, container) {
        var disciplines = window.getAvailableDisciplines(week) || [];
        var availableDisciplines = [];
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d.instructorIds) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === String(instructorId)) {
                        availableDisciplines.push(d);
                        break;
                    }
                }
            }
        }

        if (availableDisciplines.length === 0) {
            showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:450px;">' +
                '<div class="modal-header">' +
                    '<h3>Add Class - ' + DAY_NAMES[day] + ' at ' + hourDisplay + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="add-class-discipline" style="width:100%;padding:8px;">' +
                            getDisciplineOptionsHTML(availableDisciplines) +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Class Label (optional):</label>' +
                        '<input type="text" id="add-class-label" placeholder="e.g., A, B, Group 1..." style="width:100%;padding:8px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Group Label (optional):</label>' +
                        '<input type="text" id="add-class-group" placeholder="e.g., 1, 2, 3..." style="width:100%;padding:8px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Duration (hours):</label>' +
                        '<select id="add-class-duration" style="width:100%;padding:8px;">' +
                            '<option value="1">1 hour</option>' +
                            '<option value="2">2 hours</option>' +
                            '<option value="3">3 hours</option>' +
                            '<option value="4">4 hours</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:16px;">' +
                        '<button type="button" id="cancel-add-class" class="secondary">Cancel</button>' +
                        '<button type="button" id="confirm-add-class" class="primary">Add Class</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#cancel-add-class').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#confirm-add-class').onclick = function() {
            var disciplineSelect = document.getElementById('add-class-discipline');
            var disciplineId = disciplineSelect ? disciplineSelect.value : null;
            var duration = parseInt(document.getElementById('add-class-duration').value, 10) || 1;
            var label = document.getElementById('add-class-label').value.trim();
            var groupLabel = document.getElementById('add-class-group').value.trim();

            if (!disciplineId) {
                showNotification('Please select a discipline.', 'error');
                return;
            }

            if (hour + duration > CALENDAR_END_HOUR + 1) {
                showNotification('Class extends beyond the calendar boundary.', 'error');
                return;
            }

            if (typeof window.addInstructorClassTemplate === 'function') {
                var result = window.addInstructorClassTemplate(instructorId, week, day, hour, {
                    disciplineId: disciplineId,
                    label: label,
                    groupLabel: groupLabel,
                    duration: duration,
                    assignedStudents: []
                });

                if (result && result.success) {
                    modal.remove();
                    window.saveData()
                        .then(function() {
                            showNotification('Class template added.', 'success');
                            render(container, { selectedId: instructorId, week: week });
                        })
                        .catch(function() {
                            showNotification('Class added in memory, but persistence failed.', 'error');
                            render(container, { selectedId: instructorId, week: week });
                        });
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to add class template.', 'error');
                }
            } else {
                showNotification('addInstructorClassTemplate not available.', 'error');
            }
        };
    }

    function getDisciplineOptionsHTML(disciplines) {
        var html = '';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        return html;
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    function showInstructorClassDetailsModal(instructorId, week, day, hour, container) {
        var schedule = getSchedule({ selectedId: instructorId, week: week });
        var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slotData) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(slotData.disciplineId);
        var hourDisplay = CalendarUtils.formatHour(hour);
        var duration = slotData.duration || 1;
        var studentCount = slotData.students ? slotData.students.length : 0;

        var studentNames = 'None';
        if (slotData.students && slotData.students.length > 0) {
            var names = [];
            for (var i = 0; i < slotData.students.length; i++) {
                names.push(slotData.students[i].studentName);
            }
            studentNames = names.join(', ');
        }

        var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:500px;">' +
                '<div class="modal-header">' +
                    '<h3>' + disciplineName + (slotData.label ? ' [' + escapeHtml(slotData.label) + ']' : '') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="label">Day/Time:</span> <span>' + escapeHtml(DAY_NAMES[day]) + ' at ' + escapeHtml(hourDisplay) + '</span></div>' +
                    '<div class="detail-row"><span class="label">Duration:</span> <span><strong>' + duration + ' hour' + (duration > 1 ? 's' : '') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Group:</span> <span><strong>' + (slotData.groupLabel ? escapeHtml(slotData.groupLabel) : 'None') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Students:</span> <span><strong>' + studentCount + '</strong> - ' + escapeHtml(studentNames) + '</span></div>' +
                    '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button type="button" id="manage-students-btn" class="primary small">Manage Students</button>' +
                        '<button type="button" id="remove-class-btn" class="danger small">Remove Class</button>' +
                        '<button type="button" id="close-detail" class="secondary small">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#close-detail').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#remove-class-btn').onclick = function() {
            if (confirm('Remove this class?')) {
                modal.remove();
                removeInstructorClass(instructorId, week, day, hour, container);
            }
        };

        modal.querySelector('#manage-students-btn').onclick = function() {
            modal.remove();
            showManageStudentsModal(instructorId, week, day, hour, container);
        };
    }

    // ============================================================
    // MANAGE STUDENTS MODAL - Uses Core Function
    // ============================================================

    function showManageStudentsModal(instructorId, week, day, hour, container) {
        var schedule = getSchedule({ selectedId: instructorId, week: week });
        var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slotData) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(slotData.disciplineId);
        var allStudents = window.getStudents() || [];
        var assignedStudentIds = [];
        if (slotData.students) {
            for (var i = 0; i < slotData.students.length; i++) {
                assignedStudentIds.push(slotData.students[i].studentId);
            }
        }

        var modal = document.createElement('div');
        modal.className = 'modal';

        var studentsHTML = '';
        for (var s = 0; s < allStudents.length; s++) {
            var student = allStudents[s];
            var name = window.getDisplayName(student);
            var isAssigned = false;
            for (var a = 0; a < assignedStudentIds.length; a++) {
                if (String(assignedStudentIds[a]) === String(student.id)) {
                    isAssigned = true;
                    break;
                }
            }
            studentsHTML += (
                '<label style="display:block;padding:4px 0;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--border-soft);">' +
                    '<input type="checkbox" class="assign-student-checkbox" value="' + escapeHtml(student.id) + '" ' + (isAssigned ? 'checked' : '') + '> ' +
                    escapeHtml(name) +
                    (isAssigned ? ' <span style="color:var(--accent);font-size:0.7rem;">[assigned]</span>' : '') +
                '</label>'
            );
        }

        var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:550px;">' +
                '<div class="modal-header">' +
                    '<h3>Manage Students - ' + disciplineName + '</h3>' +
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

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#cancel-manage').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#update-assignments').onclick = function() {
            var selectedStudents = [];
            var checkboxes = modal.querySelectorAll('.assign-student-checkbox:checked');
            for (var c = 0; c < checkboxes.length; c++) {
                selectedStudents.push(checkboxes[c].value);
            }

            if (typeof window.updateInstructorClassAssignments === 'function') {
                var result = window.updateInstructorClassAssignments(
                    instructorId,
                    week,
                    day,
                    hour,
                    selectedStudents
                );

                if (result && result.success) {
                    modal.remove();
                    window.saveData()
                        .then(function() {
                            var msg = 'Student assignments updated.';
                            if (result.added && result.added > 0) {
                                msg += ' Added ' + result.added + ' student(s).';
                            }
                            if (result.removed && result.removed > 0) {
                                msg += ' Removed ' + result.removed + ' student(s).';
                            }
                            if (result.conflicts && result.conflicts.length > 0) {
                                msg += ' Conflicts: ' + result.conflicts.join(', ');
                            }
                            showNotification(msg, 'success');
                            render(container, { selectedId: instructorId, week: week });
                        })
                        .catch(function() {
                            showNotification('Assignments updated in memory, but persistence failed.', 'error');
                            render(container, { selectedId: instructorId, week: week });
                        });
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to update assignments.', 'error');
                }
            } else {
                showNotification('updateInstructorClassAssignments not available.', 'error');
            }
        };
    }

    // ============================================================
    // REMOVE CLASS - Uses Core Function
    // ============================================================

    function removeInstructorClass(instructorId, week, day, hour, container) {
        if (typeof window.removeInstructorClassTemplate === 'function') {
            var result = window.removeInstructorClassTemplate(instructorId, week, day, hour);

            if (result && result.success) {
                window.saveData()
                    .then(function() {
                        showNotification('Class removed.', 'success');
                        render(container, { selectedId: instructorId, week: week });
                    })
                    .catch(function() {
                        showNotification('Class removed in memory, but persistence failed.', 'error');
                        render(container, { selectedId: instructorId, week: week });
                    });
            } else {
                showNotification(result && result.message ? result.message : 'Failed to remove class.', 'error');
            }
        } else {
            showNotification('removeInstructorClassTemplate not available.', 'error');
        }
    }

    // ============================================================
    // BLOCKED TIME
    // ============================================================

    function showBlockDetailsModal(instructorId, week, day, hour, container) {
        var data = window.data || {};
        var blockKey = instructorId + '_' + week;
        var block = null;

        if (data.curriculum && data.curriculum.instructorBlocks &&
            data.curriculum.instructorBlocks[blockKey] &&
            data.curriculum.instructorBlocks[blockKey][day] &&
            data.curriculum.instructorBlocks[blockKey][day][hour]) {
            block = data.curriculum.instructorBlocks[blockKey][day][hour];
        }

        if (!block) {
            showNotification('Block not found.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:400px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(block.label || 'Blocked Time') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="label">Day/Time:</span> <span>' + escapeHtml(DAY_NAMES[day]) + ' at ' + escapeHtml(hourDisplay) + '</span></div>' +
                    '<div class="detail-row"><span class="label">Duration:</span> <span>' + (block.duration || 1) + ' hour(s)</span></div>' +
                    '<div class="detail-row"><span class="label">Group:</span> <span>' + (block.groupLabel ? escapeHtml(block.groupLabel) : 'None') + '</span></div>' +
                    '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button type="button" id="remove-block" class="danger small">Remove Block</button>' +
                        '<button type="button" id="close-block" class="secondary small">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#close-block').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#remove-block').onclick = function() {
            modal.remove();
            removeBlockedTime(instructorId, week, day, hour, container);
        };
    }

    function removeBlockedTime(instructorId, week, day, hour, container) {
        if (typeof window.removeInstructorBlock === 'function') {
            var result = window.removeInstructorBlock(instructorId, week, day, hour);

            if (result && result.success) {
                window.saveData()
                    .then(function() {
                        showNotification('Block removed.', 'success');
                        render(container, { selectedId: instructorId, week: week });
                    })
                    .catch(function() {
                        showNotification('Block removed in memory, but persistence failed.', 'error');
                        render(container, { selectedId: instructorId, week: week });
                    });
            } else {
                showNotification(result && result.message ? result.message : 'Failed to remove block.', 'error');
            }
        } else {
            showNotification('removeInstructorBlock not available.', 'error');
        }
    }

    // ============================================================
    // HELPERS
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

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('instructor', {
            label: 'Instructor',
            hint: 'Click a slot to add class | Right-click to remove | Click class to manage students',
            render: render,
            getEntities: getInstructors,
            getEntityDisplayName: function(entity) {
                return typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(entity)
                    : (entity.name || 'Unknown');
            },
            getData: getSchedule
        });
    }

})();
