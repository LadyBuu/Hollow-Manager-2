/**
 * js/modules/calendar/modes/instructor.js - Instructor Calendar Mode
 * Full implementation of instructor calendar
 * Path: js/modules/calendar/modes/instructor.js
 * 
 * This module is responsible for:
 *   - Rendering instructor calendar grid (using shared renderer)
 *   - Displaying instructor's class templates and blocks
 *   - Showing which students are assigned to each class
 *   - Managing student assignments (delegated to core)
 *   - Adding/removing class templates and blocks
 * 
 * IMPORTANT:
 *   - This module uses core functions for ALL mutations
 *   - NO direct window.data mutations
 *   - Student schedules are the canonical source of truth for assignments
 *   - Instructor templates define the instructor's scheduled teaching slots
 *   - All assignment changes go through updateInstructorClassAssignments()
 *   - All core functions are from the curriculum modules
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUtils) {
        console.error('InstructorMode: CalendarUtils not loaded.');
        return;
    }

    if (!window.CalendarRenderer) {
        console.error('InstructorMode: CalendarRenderer not loaded.');
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
    var CalendarRenderer = window.CalendarRenderer;

    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR || 5;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR || 23;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Query functions from curriculum modules
        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
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

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        // Metadata functions from curriculum modules
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

        // Instructor-specific functions from curriculum modules
        if (typeof window.getInstructorTemplates !== 'function') {
            missing.push('getInstructorTemplates');
        }

        if (typeof window.getInstructorBlocks !== 'function') {
            missing.push('getInstructorBlocks');
        }

        // Mutation functions from curriculum modules
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

        // Persistence
        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (missing.length > 0) {
            console.warn('InstructorMode: Missing dependencies:', missing.join(', '));
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
        if (!state || !state.selectedId) {
            return {};
        }

        var data = window.data || {};
        var schedule = {};
        var instructorId = state.selectedId;
        var week = state.week;

        // Get instructor class templates from curriculum module
        if (typeof window.getInstructorTemplates === 'function') {
            var templates = window.getInstructorTemplates(instructorId, week) || {};

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
                    isTemplate: true,
                    assignedStudents: template.assignedStudents || []
                };
            }
        }

        // Get instructor blocks from curriculum module
        if (typeof window.getInstructorBlocks === 'function') {
            var blocks = window.getInstructorBlocks(instructorId, week) || {};

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

                        // If this is a template slot, add student to it
                        var slotKey = hour;
                        if (schedule[day][slotKey] && schedule[day][slotKey].isTemplate) {
                            if (!schedule[day][slotKey].students) schedule[day][slotKey].students = [];
                            var alreadyExists = false;
                            for (var a = 0; a < schedule[day][slotKey].students.length; a++) {
                                if (String(schedule[day][slotKey].students[a].studentId) === String(student.id)) {
                                    alreadyExists = true;
                                    break;
                                }
                            }
                            if (!alreadyExists) {
                                schedule[day][slotKey].students.push({
                                    studentId: student.id,
                                    studentName: window.getDisplayName(student),
                                    groupLabel: groupLabel
                                });
                            }
                        } else if (!schedule[day][slotKey] || schedule[day][slotKey].isBlock) {
                            // This is a standalone class (not from a template)
                            if (!schedule[day][slotKey]) {
                                schedule[day][slotKey] = {
                                    disciplineId: disciplineId,
                                    students: [],
                                    label: label || '',
                                    duration: duration,
                                    groupLabel: groupLabel || '',
                                    isTemplate: false
                                };
                            }

                            if (schedule[day][slotKey] && !schedule[day][slotKey].isBlock) {
                                if (!schedule[day][slotKey].students) schedule[day][slotKey].students = [];
                                var alreadyExists2 = false;
                                for (var b = 0; b < schedule[day][slotKey].students.length; b++) {
                                    if (String(schedule[day][slotKey].students[b].studentId) === String(student.id)) {
                                        alreadyExists2 = true;
                                        break;
                                    }
                                }
                                if (!alreadyExists2) {
                                    schedule[day][slotKey].students.push({
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
    // RENDER INSTRUCTOR CALENDAR - Using Shared Renderer
    // ============================================================

    function renderInstructorCalendar(container, state) {
        var instructorId = state.selectedId;
        var week = state.week;

        var schedule = getSchedule(state);
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var allStudents = window.getStudents() || [];

        // Prepare data for shared renderer
        var data = {
            schedule: schedule,
            restDays: [], // Instructors don't have rest days
            entityName: instructorName,
            getDiscipline: function(id) {
                return window.getDiscipline(id);
            },
            getDuration: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                return slot ? slot.duration || 1 : 1;
            },
            getLabel: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                return slot ? slot.label || '' : '';
            },
            getGroupLabel: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                return slot ? slot.groupLabel || '' : '';
            },
            getInstructorName: function(day, hour) {
                // For instructor view, we don't need to show the instructor name
                return '';
            },
            isBlock: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                return slot ? slot.isBlock || false : false;
            },
            slotMetadata: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (!slot) return '';

                var metadata = [];

                if (slot.isTemplate) {
                    metadata.push('template');
                }

                if (slot.isBlock) {
                    metadata.push('blocked');
                }

                if (slot.students && slot.students.length > 0) {
                    metadata.push(slot.students.length + ' student' + (slot.students.length > 1 ? 's' : ''));
                }

                if (metadata.length > 0) {
                    return ' [' + metadata.join(' | ') + ']';
                }

                return '';
            },
            extraSidebar: getInstructorSidebarHTML(instructorId, week),
            availableItems: getAvailableDisciplinesForInstructor(instructorId, week),
            availableLabel: 'Available Disciplines'
        };

        // Use shared renderer
        CalendarRenderer.renderGrid(container, state, data);

        // Bind events with instructor-specific callbacks
        CalendarRenderer.bindEvents(container, state, {
            onSlotClick: function(day, hour) {
                showAddInstructorClassModal(instructorId, week, day, hour, container);
            },
            onSlotRightClick: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (slot && slot.isBlock) {
                    if (confirm('Remove this blocked time?')) {
                        removeBlockedTime(instructorId, week, day, hour, container);
                    }
                } else if (slot && slot.isTemplate) {
                    if (confirm('Remove this class template?')) {
                        removeInstructorClass(instructorId, week, day, hour, container);
                    }
                } else if (slot) {
                    if (confirm('Remove this class?')) {
                        removeInstructorClass(instructorId, week, day, hour, container);
                    }
                }
            },
            onSlotDetails: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (slot && slot.isBlock) {
                    showBlockDetailsModal(instructorId, week, day, hour, container);
                } else if (slot) {
                    showInstructorClassDetailsModal(instructorId, week, day, hour, container);
                }
            },
            onBlockClick: function(day, hour) {
                showBlockDetailsModal(instructorId, week, day, hour, container);
            },
            onBlockRightClick: function(day, hour) {
                if (confirm('Remove this blocked time?')) {
                    removeBlockedTime(instructorId, week, day, hour, container);
                }
            },
            onAvailableItemClick: function(disciplineId) {
                showAddInstructorClassModalWithDiscipline(instructorId, week, null, null, container, disciplineId);
            }
        });

        // Add clear week button if needed (instructors don't typically clear all)
        // But we can add a "Clear All" for templates if desired
    }

    // ============================================================
    // INSTRUCTOR SIDEBAR
    // ============================================================

    function getInstructorSidebarHTML(instructorId, week) {
        var templates = typeof window.getInstructorTemplates === 'function'
            ? window.getInstructorTemplates(instructorId, week) || {}
            : {};

        var blocks = typeof window.getInstructorBlocks === 'function'
            ? window.getInstructorBlocks(instructorId, week) || {}
            : {};

        var templateCount = Object.keys(templates).length;
        var blockCount = 0;
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) continue;
            blockCount += Object.keys(blocks[day]).length;
        }

        var html = '<div class="sidebar-section">';
        html += '<h4>Instructor Stats</h4>';
        html += '<div style="font-size:0.8rem;color:var(--text-dim);">';
        html += '<div>Class Templates: <strong>' + templateCount + '</strong></div>';
        html += '<div>Blocked Time: <strong>' + blockCount + '</strong> slots</div>';
        html += '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Right-click a slot to remove it.';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // AVAILABLE DISCIPLINES FOR INSTRUCTOR
    // ============================================================

    function getAvailableDisciplinesForInstructor(instructorId, week) {
        var disciplines = window.getAvailableDisciplines(week) || [];
        var available = [];

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d.instructorIds) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === String(instructorId)) {
                        available.push({
                            id: d.id,
                            label: d.name,
                            subtitle: 'Available'
                        });
                        break;
                    }
                }
            }
        }

        return available;
    }

    // ============================================================
    // ADD CLASS MODAL - Using Shared Renderer
    // ============================================================

    function showAddInstructorClassModal(instructorId, week, day, hour, container) {
        var disciplines = getAvailableDisciplinesForInstructor(instructorId, week);

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        CalendarRenderer.createAddClassModal({
            title: 'Add Class Template - ' + CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay,
            disciplines: disciplines.map(function(item) {
                return window.getDiscipline(item.id);
            }),
            maxDuration: 4,
            getDisciplineLabel: function(d) {
                return d.name;
            },
            onConfirm: function(disciplineId, duration, label, groupLabel, closeModal) {
                // Validate calendar boundary
                if (hour + duration > CALENDAR_END_HOUR + 1) {
                    CalendarRenderer.showNotification('Class extends beyond the calendar boundary.', 'error');
                    return;
                }

                // Re-read schedule at commit time (defensive)
                var currentSchedule = getSchedule({ selectedId: instructorId, week: week });

                // Check if slot is already occupied
                if (currentSchedule[day] && currentSchedule[day][hour]) {
                    var existing = currentSchedule[day][hour];
                    if (existing.isBlock) {
                        CalendarRenderer.showNotification('This time is blocked.', 'error');
                        return;
                    } else if (existing.isTemplate) {
                        CalendarRenderer.showNotification('A class template already exists at this time.', 'error');
                        return;
                    } else {
                        CalendarRenderer.showNotification('This slot is already occupied.', 'error');
                        return;
                    }
                }

                // Use the curriculum module function
                if (typeof window.addInstructorClassTemplate === 'function') {
                    var result = window.addInstructorClassTemplate(instructorId, week, day, hour, {
                        disciplineId: disciplineId,
                        label: label,
                        groupLabel: groupLabel,
                        duration: duration,
                        assignedStudents: []
                    });

                    if (result && result.success) {
                        closeModal();
                        window.saveData()
                            .then(function() {
                                CalendarRenderer.showNotification('Class template added.', 'success');
                                render(container, { selectedId: instructorId, week: week });
                            })
                            .catch(function() {
                                CalendarRenderer.showNotification('Class added in memory, but persistence failed.', 'error');
                                render(container, { selectedId: instructorId, week: week });
                            });
                    } else {
                        CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to add class template.', 'error');
                    }
                } else {
                    CalendarRenderer.showNotification('addInstructorClassTemplate not available.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    function showAddInstructorClassModalWithDiscipline(instructorId, week, day, hour, container, preSelectedDisciplineId) {
        var disciplines = getAvailableDisciplinesForInstructor(instructorId, week);

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = day !== null && hour !== null ? CalendarUtils.formatHour(hour) : 'any slot';
        var dayDisplay = day !== null ? CalendarRenderer.DAY_NAMES[day] : 'any day';

        var modal = CalendarRenderer.createAddClassModal({
            title: 'Add Class Template - ' + dayDisplay + ' at ' + hourDisplay,
            disciplines: disciplines.map(function(item) {
                return window.getDiscipline(item.id);
            }),
            maxDuration: 4,
            getDisciplineLabel: function(d) {
                return d.name;
            },
            onConfirm: function(disciplineId, duration, label, groupLabel, closeModal) {
                // For "any slot" mode, find an available slot
                if (day === null || hour === null) {
                    // Find first available slot
                    var schedule = getSchedule({ selectedId: instructorId, week: week });

                    for (var d = 1; d <= 7; d++) {
                        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                            if (!schedule[d] || !schedule[d][h]) {
                                if (typeof window.addInstructorClassTemplate === 'function') {
                                    var result = window.addInstructorClassTemplate(instructorId, week, d, h, {
                                        disciplineId: disciplineId,
                                        label: label,
                                        groupLabel: groupLabel,
                                        duration: duration,
                                        assignedStudents: []
                                    });

                                    if (result && result.success) {
                                        closeModal();
                                        window.saveData()
                                            .then(function() {
                                                CalendarRenderer.showNotification('Class template added.', 'success');
                                                render(container, { selectedId: instructorId, week: week });
                                            })
                                            .catch(function() {
                                                CalendarRenderer.showNotification('Class added in memory, but persistence failed.', 'error');
                                                render(container, { selectedId: instructorId, week: week });
                                            });
                                        return;
                                    }
                                }
                            }
                        }
                    }

                    CalendarRenderer.showNotification('No available slots found.', 'error');
                    return;
                }

                // Specific slot assignment
                // Validate calendar boundary
                if (hour + duration > CALENDAR_END_HOUR + 1) {
                    CalendarRenderer.showNotification('Class extends beyond the calendar boundary.', 'error');
                    return;
                }

                // Re-read schedule at commit time (defensive)
                var currentSchedule = getSchedule({ selectedId: instructorId, week: week });

                // Check if slot is already occupied
                if (currentSchedule[day] && currentSchedule[day][hour]) {
                    var existing = currentSchedule[day][hour];
                    if (existing.isBlock) {
                        CalendarRenderer.showNotification('This time is blocked.', 'error');
                        return;
                    } else if (existing.isTemplate) {
                        CalendarRenderer.showNotification('A class template already exists at this time.', 'error');
                        return;
                    } else {
                        CalendarRenderer.showNotification('This slot is already occupied.', 'error');
                        return;
                    }
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
                        closeModal();
                        window.saveData()
                            .then(function() {
                                CalendarRenderer.showNotification('Class template added.', 'success');
                                render(container, { selectedId: instructorId, week: week });
                            })
                            .catch(function() {
                                CalendarRenderer.showNotification('Class added in memory, but persistence failed.', 'error');
                                render(container, { selectedId: instructorId, week: week });
                            });
                    } else {
                        CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to add class template.', 'error');
                    }
                } else {
                    CalendarRenderer.showNotification('addInstructorClassTemplate not available.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });

        // Pre-select the discipline if provided
        if (preSelectedDisciplineId) {
            var select = modal.querySelector('#add-class-select');
            if (select) {
                select.value = preSelectedDisciplineId;
            }
        }

        return modal;
    }

    // ============================================================
    // CLASS DETAILS MODAL - Using Shared Renderer
    // ============================================================

    function showInstructorClassDetailsModal(instructorId, week, day, hour, container) {
        var schedule = getSchedule({ selectedId: instructorId, week: week });
        var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slotData) {
            CalendarRenderer.showNotification('Class not found.', 'error');
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

        var disciplineName = discipline ? discipline.name : 'Unknown';
        var isTemplate = slotData.isTemplate || false;
        var typeLabel = isTemplate ? 'Template' : 'Class';

        var details = [
            { label: 'Type', value: typeLabel },
            { label: 'Day/Time', value: CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay },
            { label: 'Duration', value: duration + ' hour' + (duration > 1 ? 's' : '') },
            { label: 'Group', value: slotData.groupLabel || 'None' },
            { label: 'Students', value: studentCount + ' - ' + studentNames }
        ];

        if (slotData.label) {
            details.splice(1, 0, { label: 'Label', value: slotData.label });
        }

        var actions = [];

        if (isTemplate) {
            actions.push({
                label: 'Manage Students',
                className: 'primary',
                handler: function(closeModal) {
                    closeModal();
                    showManageStudentsModal(instructorId, week, day, hour, container);
                }
            });

            actions.push({
                label: 'Remove Template',
                className: 'danger',
                handler: function(closeModal) {
                    if (confirm('Remove this class template?')) {
                        closeModal();
                        removeInstructorClass(instructorId, week, day, hour, container);
                    }
                }
            });
        } else {
            actions.push({
                label: 'Remove Class',
                className: 'danger',
                handler: function(closeModal) {
                    if (confirm('Remove this class?')) {
                        closeModal();
                        removeInstructorClass(instructorId, week, day, hour, container);
                    }
                }
            });
        }

        CalendarRenderer.createDetailsModal({
            title: disciplineName + (slotData.label ? ' [' + slotData.label + ']' : ''),
            details: details,
            actions: actions,
            onClose: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // MANAGE STUDENTS MODAL - Using Shared Renderer
    // ============================================================

    function showManageStudentsModal(instructorId, week, day, hour, container) {
        var schedule = getSchedule({ selectedId: instructorId, week: week });
        var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slotData) {
            CalendarRenderer.showNotification('Class not found.', 'error');
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

        var students = allStudents.map(function(student) {
            var isAssigned = false;
            for (var a = 0; a < assignedStudentIds.length; a++) {
                if (String(assignedStudentIds[a]) === String(student.id)) {
                    isAssigned = true;
                    break;
                }
            }
            return {
                id: student.id,
                name: window.getDisplayName(student),
                assigned: isAssigned
            };
        });

        var disciplineName = discipline ? discipline.name : 'Unknown';

        CalendarRenderer.createManageStudentsModal({
            title: 'Manage Students - ' + disciplineName,
            students: students,
            onConfirm: function(selectedStudents, closeModal) {
                if (typeof window.updateInstructorClassAssignments === 'function') {
                    var result = window.updateInstructorClassAssignments(
                        instructorId,
                        week,
                        day,
                        hour,
                        selectedStudents
                    );

                    if (result && result.success) {
                        closeModal();
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
                                CalendarRenderer.showNotification(msg, 'success');
                                render(container, { selectedId: instructorId, week: week });
                            })
                            .catch(function() {
                                CalendarRenderer.showNotification('Assignments updated in memory, but persistence failed.', 'error');
                                render(container, { selectedId: instructorId, week: week });
                            });
                    } else {
                        CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to update assignments.', 'error');
                    }
                } else {
                    CalendarRenderer.showNotification('updateInstructorClassAssignments not available.', 'error');
                }
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // BLOCK DETAILS MODAL - Using Shared Renderer
    // ============================================================

    function showBlockDetailsModal(instructorId, week, day, hour, container) {
        var blocks = typeof window.getInstructorBlocks === 'function'
            ? window.getInstructorBlocks(instructorId, week) || {}
            : {};

        var block = null;
        if (blocks[day] && blocks[day][hour]) {
            block = blocks[day][hour];
        }

        if (!block) {
            CalendarRenderer.showNotification('Block not found.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        CalendarRenderer.createDetailsModal({
            title: block.label || 'Blocked Time',
            details: [
                { label: 'Day/Time', value: CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay },
                { label: 'Duration', value: (block.duration || 1) + ' hour(s)' },
                { label: 'Group', value: block.groupLabel || 'None' }
            ],
            actions: [
                {
                    label: 'Remove Block',
                    className: 'danger',
                    handler: function(closeModal) {
                        if (confirm('Remove this blocked time?')) {
                            closeModal();
                            removeBlockedTime(instructorId, week, day, hour, container);
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
    // REMOVE CLASS - Uses Core Function
    // ============================================================

    function removeInstructorClass(instructorId, week, day, hour, container) {
        if (typeof window.removeInstructorClassTemplate === 'function') {
            var result = window.removeInstructorClassTemplate(instructorId, week, day, hour);

            if (result && result.success) {
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Class removed.', 'success');
                        render(container, { selectedId: instructorId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Class removed in memory, but persistence failed.', 'error');
                        render(container, { selectedId: instructorId, week: week });
                    });
            } else {
                CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to remove class.', 'error');
            }
        } else {
            CalendarRenderer.showNotification('removeInstructorClassTemplate not available.', 'error');
        }
    }

    // ============================================================
    // REMOVE BLOCKED TIME - Uses Core Function
    // ============================================================

    function removeBlockedTime(instructorId, week, day, hour, container) {
        if (typeof window.removeInstructorBlock === 'function') {
            var result = window.removeInstructorBlock(instructorId, week, day, hour);

            if (result && result.success) {
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Block removed.', 'success');
                        render(container, { selectedId: instructorId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Block removed in memory, but persistence failed.', 'error');
                        render(container, { selectedId: instructorId, week: week });
                    });
            } else {
                CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to remove block.', 'error');
            }
        } else {
            CalendarRenderer.showNotification('removeInstructorBlock not available.', 'error');
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('instructor', {
            label: 'Instructor',
            hint: 'Click a slot to add class template | Right-click to remove | Click class to manage students',
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
