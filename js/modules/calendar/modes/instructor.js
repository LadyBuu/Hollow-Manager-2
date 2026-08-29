/**
 * js/modules/calendar/modes/instructor.js - Instructor Calendar Mode
 * Full implementation of instructor calendar
 * Path: js/modules/calendar/modes/instructor.js
 * 
 * This module is responsible for:
 *   - Rendering instructor calendar grid
 *   - Displaying instructor's class templates and blocks
 *   - Showing which students are assigned to each class
 *   - Managing student assignments
 */

(function() {
    'use strict';

    if (window.__instructorModeLoaded) {
        return;
    }
    window.__instructorModeLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            { name: 'getInstructors', fn: window.getInstructors },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline },
            { name: 'getStudentSchedule', fn: window.getStudentSchedule },
            { name: 'getCharacterById', fn: window.getCharacterById },
            { name: 'getClassInstructor', fn: window.getClassInstructor },
            { name: 'getClassDuration', fn: window.getClassDuration },
            { name: 'getClassLabel', fn: window.getClassLabel },
            { name: 'getClassGroupLabel', fn: window.getClassGroupLabel },
            { name: 'saveData', fn: window.saveData }
        ];

        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function') {
                missing.push(required[i].name);
            }
        }

        if (missing.length > 0) {
            console.warn('[InstructorMode] Missing dependencies:', missing.join(', '));
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

            // Get instructor templates
            if (data.curriculum && data.curriculum.instructorTemplates) {
                var templateKey = instructorId + '_' + week;
                var templates = data.curriculum.instructorTemplates[templateKey] || {};
                
                for (var classKey in templates) {
                    if (Object.prototype.hasOwnProperty.call(templates, classKey)) {
                        var parts = classKey.split('_');
                        var day = parseInt(parts[0]);
                        var hour = parseInt(parts[1]);
                        var template = templates[classKey];
                        
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][hour] = {
                            disciplineId: template.disciplineId,
                            label: template.label,
                            groupLabel: template.groupLabel,
                            duration: template.duration || 1,
                            assignedStudents: template.assignedStudents || [],
                            isTemplate: true
                        };
                    }
                }
            }

            // Get instructor blocks
            if (data.curriculum && data.curriculum.instructorBlocks) {
                var blockKey = instructorId + '_' + week;
                var blocks = data.curriculum.instructorBlocks[blockKey] || {};
                
                for (var day in blocks) {
                    if (Object.prototype.hasOwnProperty.call(blocks, day)) {
                        var dayBlocks = blocks[day];
                        for (var hour in dayBlocks) {
                            if (Object.prototype.hasOwnProperty.call(dayBlocks, hour)) {
                                var block = dayBlocks[hour];
                                if (!schedule[day]) schedule[day] = {};
                                schedule[day][hour] = {
                                    isBlock: true,
                                    label: block.label || 'Blocked Time',
                                    groupLabel: block.groupLabel,
                                    duration: block.duration || 1,
                                    disciplineId: block.disciplineId || null
                                };
                            }
                        }
                    }
                }
            }

            // Get student schedules for this instructor
            var students = window.getStudents();
            students.forEach(function(student) {
                var studentSchedule = window.getStudentSchedule(student.id, week);
                
                for (var day in studentSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) continue;
                    var daySchedule = studentSchedule[day];
                    
                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                        var disciplineId = daySchedule[hour];
                        if (!disciplineId) continue;
                        
                        var classInstructorId = window.getClassInstructor(student.id, week, parseInt(day), parseInt(hour));
                        if (classInstructorId && String(classInstructorId) === String(instructorId)) {
                            if (!schedule[day]) schedule[day] = {};
                            
                            var duration = window.getClassDuration(student.id, week, parseInt(day), parseInt(hour)) || 1;
                            var label = window.getClassLabel(student.id, week, parseInt(day), parseInt(hour));
                            var groupLabel = window.getClassGroupLabel(student.id, week, parseInt(day), parseInt(hour));
                            
                            if (schedule[day][hour] && schedule[day][hour].isTemplate) {
                                if (!schedule[day][hour].students) schedule[day][hour].students = [];
                                if (!schedule[day][hour].students.some(function(s) { return String(s.studentId) === String(student.id); })) {
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
                                        label: label,
                                        duration: duration,
                                        groupLabel: groupLabel,
                                        isTemplate: false
                                    };
                                }
                                
                                if (schedule[day][hour] && !schedule[day][hour].isBlock) {
                                    if (!schedule[day][hour].students) schedule[day][hour].students = [];
                                    if (!schedule[day][hour].students.some(function(s) { return String(s.studentId) === String(student.id); })) {
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
            });
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
        html += '<div class="instructor-header"><h3>' + instructorName + ' - Week ' + week + '</h3></div>';
        html += getCalendarGridHTML(schedule, instructorId, week);
        html += '</div>';

        container.innerHTML = html;

        // Bind events
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

            hours.forEach(function(hour) {
                if (occupiedHours[hour]) return;

                var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

                if (slotData) {
                    var duration = slotData.duration || 1;
                    var discipline = window.getDiscipline(slotData.disciplineId);
                    
                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        occupiedHours[h] = true;
                    }

                    var isBlock = slotData.isBlock;
                    var studentCount = slotData.students ? slotData.students.length : 0;
                    var studentNames = slotData.students ? slotData.students.map(function(s) { return s.studentName; }).join(', ') : '';
                    var labelDisplay = slotData.label ? ' [' + slotData.label + ']' : '';
                    var groupDisplay = slotData.groupLabel ? ' (G' + slotData.groupLabel + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var templateDisplay = slotData.isTemplate && studentCount === 0 ? ' (template)' : '';
                    var blockDisplay = isBlock ? ' ■' : '';

                    html += '<div class="time-slot occupied' + (isBlock ? ' blocked' : '') + '" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + (discipline ? discipline.name : 'Unknown') + labelDisplay + groupDisplay + durationDisplay + blockDisplay + (studentCount > 0 ? ' - ' + studentCount + ' students' : '') + templateDisplay + '</span>';
                    html += '</div>';

                } else {
                    html += '<div class="time-slot empty" data-day="' + day + '" data-hour="' + hour + '">';
                    html += '<span class="slot-time">' + formatHour(hour) + '</span>';
                    html += '<span class="slot-label">+</span>';
                    html += '</div>';
                }
            });

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
        // Empty slots - click to add class
        container.querySelectorAll('.time-slot.empty').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showAddInstructorClassModal(instructorId, week, day, hour, container);
            });
        });

        // Occupied slots - click for details
        container.querySelectorAll('.time-slot.occupied:not(.blocked)').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showInstructorClassDetailsModal(instructorId, week, day, hour, container);
            });

            slot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                if (confirm('Remove this class?')) {
                    removeInstructorClass(instructorId, week, day, hour, container);
                }
            });
        });

        // Blocked slots - click for details
        container.querySelectorAll('.time-slot.blocked').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showBlockDetailsModal(instructorId, week, day, hour, container);
            });

            slot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                if (confirm('Remove this blocked time?')) {
                    removeBlockedTime(instructorId, week, day, hour, container);
                }
            });
        });
    }

    // ============================================================
    // ADD CLASS MODAL
    // ============================================================

    function showAddInstructorClassModal(instructorId, week, day, hour, container) {
        var disciplines = window.getAvailableDisciplines(week);
        var availableDisciplines = disciplines.filter(function(d) {
            return d.instructorIds && d.instructorIds.some(function(id) { return String(id) === String(instructorId); });
        });

        if (availableDisciplines.length === 0) {
            showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>Add Class - ${DAY_NAMES[day]} at ${hourDisplay}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Discipline *:</label>
                        <select id="add-class-discipline" style="width:100%;padding:8px;">
                            ${availableDisciplines.map(function(d) {
                                return '<option value="' + d.id + '">' + d.name + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Class Label (optional):</label>
                        <input type="text" id="add-class-label" placeholder="e.g., A, B, Group 1..." style="width:100%;padding:8px;">
                    </div>
                    <div class="form-group">
                        <label>Group Label (optional):</label>
                        <input type="text" id="add-class-group" placeholder="e.g., 1, 2, 3..." style="width:100%;padding:8px;">
                    </div>
                    <div class="form-group">
                        <label>Duration (hours):</label>
                        <select id="add-class-duration" style="width:100%;padding:8px;">
                            <option value="1">1 hour</option>
                            <option value="2">2 hours</option>
                            <option value="3">3 hours</option>
                            <option value="4">4 hours</option>
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-add-class" class="secondary">Cancel</button>
                        <button type="button" id="confirm-add-class" class="primary">Add Class</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-add-class').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-add-class').onclick = function() {
            var disciplineId = document.getElementById('add-class-discipline').value;
            var duration = parseInt(document.getElementById('add-class-duration').value) || 1;
            var label = document.getElementById('add-class-label').value.trim();
            var groupLabel = document.getElementById('add-class-group').value.trim();

            if (!disciplineId) {
                showNotification('Please select a discipline.', 'error');
                return;
            }

            // Store as instructor template
            var data = window.data || {};
            if (!data.curriculum) data.curriculum = {};
            if (!data.curriculum.instructorTemplates) data.curriculum.instructorTemplates = {};
            
            var templateKey = instructorId + '_' + week;
            if (!data.curriculum.instructorTemplates[templateKey]) {
                data.curriculum.instructorTemplates[templateKey] = {};
            }
            
            var classKey = day + '_' + hour;
            data.curriculum.instructorTemplates[templateKey][classKey] = {
                disciplineId: disciplineId,
                label: label,
                groupLabel: groupLabel,
                duration: duration,
                assignedStudents: []
            };

            modal.remove();
            window.saveData()
                .then(function() {
                    showNotification('Class template added!', 'success');
                    render(container, { selectedId: instructorId, week: week });
                })
                .catch(function(err) {
                    console.error('Failed to save class template:', err);
                    showNotification('Class added in memory, but persistence failed.', 'error');
                    render(container, { selectedId: instructorId, week: week });
                });
        };
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
        var hourDisplay = formatHour(hour);
        var duration = slotData.duration || 1;
        var studentCount = slotData.students ? slotData.students.length : 0;
        var studentNames = slotData.students ? slotData.students.map(function(s) { return s.studentName; }).join(', ') : 'None';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3>${discipline ? discipline.name : 'Unknown'} ${slotData.label ? '[' + slotData.label + ']' : ''}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${DAY_NAMES[day]} at ${hourDisplay}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span><strong>${duration} hour${duration > 1 ? 's' : ''}</strong></span></div>
                    <div class="detail-row"><span class="label">Group:</span> <span><strong>${slotData.groupLabel || 'None'}</strong></span></div>
                    <div class="detail-row"><span class="label">Students:</span> <span><strong>${studentCount}</strong> - ${studentNames}</span></div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="manage-students-btn" class="primary small">Manage Students</button>
                        <button type="button" id="remove-class-btn" class="danger small">✕ Remove Class</button>
                        <button type="button" id="close-detail" class="secondary small">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-detail').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
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
    // MANAGE STUDENTS MODAL
    // ============================================================

    function showManageStudentsModal(instructorId, week, day, hour, container) {
        var schedule = getSchedule({ selectedId: instructorId, week: week });
        var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slotData) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(slotData.disciplineId);
        var allStudents = window.getStudents();
        var assignedStudentIds = slotData.students ? slotData.students.map(function(s) { return s.studentId; }) : [];
        var duration = slotData.duration || 1;

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:550px;">
                <div class="modal-header">
                    <h3>Manage Students - ${discipline ? discipline.name : 'Unknown'}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="max-height:300px;overflow-y:auto;">
                        ${allStudents.map(function(s) {
                            var name = window.getDisplayName(s);
                            var isAssigned = assignedStudentIds.some(function(id) { return String(id) === String(s.id); });
                            return '<label style="display:block;padding:4px 0;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--border-soft);">' +
                                '<input type="checkbox" class="assign-student-checkbox" value="' + s.id + '" ' + (isAssigned ? 'checked' : '') + '> ' +
                                name +
                                (isAssigned ? ' <span style="color:var(--accent);font-size:0.7rem;">✓ assigned</span>' : '') +
                            '</label>';
                        }).join('')}
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-manage" class="secondary">Cancel</button>
                        <button type="button" id="update-assignments" class="primary">Update Assignments</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-manage').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#update-assignments').onclick = function() {
            var selectedStudents = [];
            modal.querySelectorAll('.assign-student-checkbox:checked').forEach(function(cb) {
                selectedStudents.push(cb.value);
            });

            // Update assignments in the data store
            var data = window.data || {};
            if (!data.curriculum) data.curriculum = {};
            if (!data.curriculum.instructorTemplates) data.curriculum.instructorTemplates = {};
            
            var templateKey = instructorId + '_' + week;
            var classKey = day + '_' + hour;
            
            if (data.curriculum.instructorTemplates[templateKey] &&
                data.curriculum.instructorTemplates[templateKey][classKey]) {
                data.curriculum.instructorTemplates[templateKey][classKey].assignedStudents = selectedStudents;
            }

            // Also update student schedules
            var allStudentsList = window.getStudents();
            allStudentsList.forEach(function(student) {
                var schedule = window.getStudentSchedule(student.id, week);
                var isAssigned = selectedStudents.some(function(id) { return String(id) === String(student.id); });
                var wasAssigned = assignedStudentIds.some(function(id) { return String(id) === String(student.id); });

                if (isAssigned && !wasAssigned) {
                    // Add student to class
                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][h] = slotData.disciplineId;
                    }
                    if (typeof window.setClassInstructor === 'function') {
                        window.setClassInstructor(student.id, week, day, hour, instructorId);
                    }
                    if (slotData.label && typeof window.setClassLabel === 'function') {
                        window.setClassLabel(student.id, week, day, hour, slotData.label);
                    }
                    if (slotData.groupLabel && typeof window.setClassGroupLabel === 'function') {
                        window.setClassGroupLabel(student.id, week, day, hour, slotData.groupLabel);
                    }
                    if (typeof window.setClassDuration === 'function') {
                        window.setClassDuration(student.id, week, day, hour, duration);
                    }
                } else if (!isAssigned && wasAssigned) {
                    // Remove student from class
                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        if (schedule[day] && schedule[day][h] === slotData.disciplineId) {
                            delete schedule[day][h];
                        }
                    }
                    if (typeof window.setClassInstructor === 'function') {
                        window.setClassInstructor(student.id, week, day, hour, null);
                    }
                    if (typeof window.setClassLabel === 'function') {
                        window.setClassLabel(student.id, week, day, hour, null);
                    }
                    if (typeof window.setClassGroupLabel === 'function') {
                        window.setClassGroupLabel(student.id, week, day, hour, null);
                    }
                    if (typeof window.setClassDuration === 'function') {
                        window.setClassDuration(student.id, week, day, hour, null);
                    }
                }
            });

            modal.remove();
            window.saveData()
                .then(function() {
                    showNotification('Student assignments updated!', 'success');
                    render(container, { selectedId: instructorId, week: week });
                })
                .catch(function(err) {
                    console.error('Failed to save assignments:', err);
                    showNotification('Assignments updated in memory, but persistence failed.', 'error');
                    render(container, { selectedId: instructorId, week: week });
                });
        };
    }

    // ============================================================
    // REMOVE CLASS
    // ============================================================

    function removeInstructorClass(instructorId, week, day, hour, container) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.instructorTemplates) {
            showNotification('No class templates found.', 'error');
            return;
        }

        var templateKey = instructorId + '_' + week;
        var classKey = day + '_' + hour;

        if (data.curriculum.instructorTemplates[templateKey] &&
            data.curriculum.instructorTemplates[templateKey][classKey]) {
            
            // Remove assigned students from schedules
            var template = data.curriculum.instructorTemplates[templateKey][classKey];
            var assignedStudents = template.assignedStudents || [];
            var duration = template.duration || 1;
            var disciplineId = template.disciplineId;

            assignedStudents.forEach(function(studentId) {
                var schedule = window.getStudentSchedule(studentId, week);
                for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                    if (schedule[day] && schedule[day][h] === disciplineId) {
                        delete schedule[day][h];
                    }
                }
                if (typeof window.setClassInstructor === 'function') {
                    window.setClassInstructor(studentId, week, day, hour, null);
                }
                if (typeof window.setClassLabel === 'function') {
                    window.setClassLabel(studentId, week, day, hour, null);
                }
                if (typeof window.setClassGroupLabel === 'function') {
                    window.setClassGroupLabel(studentId, week, day, hour, null);
                }
                if (typeof window.setClassDuration === 'function') {
                    window.setClassDuration(studentId, week, day, hour, null);
                }
            });

            // Remove template
            delete data.curriculum.instructorTemplates[templateKey][classKey];
            if (Object.keys(data.curriculum.instructorTemplates[templateKey]).length === 0) {
                delete data.curriculum.instructorTemplates[templateKey];
            }
        }

        window.saveData()
            .then(function() {
                showNotification('Class removed!', 'success');
                render(container, { selectedId: instructorId, week: week });
            })
            .catch(function(err) {
                console.error('Failed to save class removal:', err);
                showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: instructorId, week: week });
            });
    }

    // ============================================================
    // BLOCKED TIME
    // ============================================================

    function showBlockDetailsModal(instructorId, week, day, hour, container) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.instructorBlocks) {
            showNotification('No blocks found.', 'error');
            return;
        }

        var blockKey = instructorId + '_' + week;
        var block = data.curriculum.instructorBlocks[blockKey] &&
                    data.curriculum.instructorBlocks[blockKey][day] &&
                    data.curriculum.instructorBlocks[blockKey][day][hour]
                    ? data.curriculum.instructorBlocks[blockKey][day][hour]
                    : null;

        if (!block) {
            showNotification('Block not found.', 'error');
            return;
        }

        var hourDisplay = formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <div class="modal-header">
                    <h3>${block.label || 'Blocked Time'}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${DAY_NAMES[day]} at ${hourDisplay}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span>${block.duration || 1} hour(s)</span></div>
                    <div class="detail-row"><span class="label">Group:</span> <span>${block.groupLabel || 'None'}</span></div>
                    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-block" class="danger small">✕ Remove Block</button>
                        <button type="button" id="close-block" class="secondary small">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-block').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#remove-block').onclick = function() {
            modal.remove();
            removeBlockedTime(instructorId, week, day, hour, container);
        };
    }

    function removeBlockedTime(instructorId, week, day, hour, container) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.instructorBlocks) {
            showNotification('No blocks found.', 'error');
            return;
        }

        var blockKey = instructorId + '_' + week;
        if (data.curriculum.instructorBlocks[blockKey] &&
            data.curriculum.instructorBlocks[blockKey][day]) {
            delete data.curriculum.instructorBlocks[blockKey][day][hour];
            if (Object.keys(data.curriculum.instructorBlocks[blockKey][day]).length === 0) {
                delete data.curriculum.instructorBlocks[blockKey][day];
            }
            if (Object.keys(data.curriculum.instructorBlocks[blockKey]).length === 0) {
                delete data.curriculum.instructorBlocks[blockKey];
            }
        }

        window.saveData()
            .then(function() {
                showNotification('Block removed!', 'success');
                render(container, { selectedId: instructorId, week: week });
            })
            .catch(function(err) {
                console.error('Failed to save block removal:', err);
                showNotification('Block removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: instructorId, week: week });
            });
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function formatHour(hour) {
        if (hour === undefined || hour === null || hour < 0 || hour > 23) {
            return '?';
        }
        var h = hour % 12 || 12;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        return h + ':00 ' + ampm;
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
        } else {
            console.log('[InstructorMode]', message);
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('instructor', {
            label: 'Instructor',
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.InstructorMode = {
        render: render,
        getInstructors: getInstructors,
        getSchedule: getSchedule
    };

})();
