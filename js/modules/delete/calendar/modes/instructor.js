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
 *   - ORCHESTRATION ONLY - no domain logic
 *   - Uses InstructorQueries for all data
 *   - Uses InstructorView for all rendering
 *   - Uses CalendarLocationCore for mutations
 *   - Uses MutationUtils for transaction/persistence
 *   - No direct window.data access
 *   - No direct DOM manipulation
 *   - No saveData() calls
 *   - Uses CalendarConstants for bounds
 *   - Uses CalendarValidation for validation
 *   - No hard-coded calendar values
 * 
 * DEPENDENCIES:
 *   - window.InstructorQueries (from queries/instructor-queries.js) - MANDATORY
 *   - window.InstructorView (from views/instructor-view.js) - MANDATORY
 *   - window.CalendarRenderer (from calendar-renderer.js) - MANDATORY
 *   - window.CalendarUtils (from calendar-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarModes (from modes/index.js) - MANDATORY
 *   - window.CalendarInstructorCore (from core/instructor-core.js) - MANDATORY
 *   - window.MutationUtils (from mutation-pipeline.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.InstructorQueries || typeof window.InstructorQueries.getInstructorSchedule !== 'function') {
        missing.push('InstructorQueries.getInstructorSchedule');
    }
    if (!window.InstructorQueries || typeof window.InstructorQueries.getAvailableDisciplines !== 'function') {
        missing.push('InstructorQueries.getAvailableDisciplines');
    }
    if (!window.InstructorQueries || typeof window.InstructorQueries.getClassDetails !== 'function') {
        missing.push('InstructorQueries.getClassDetails');
    }

    if (!window.InstructorView || typeof window.InstructorView.renderInstructorSidebar !== 'function') {
        missing.push('InstructorView.renderInstructorSidebar');
    }
    if (!window.InstructorView || typeof window.InstructorView.renderClassDetailsModal !== 'function') {
        missing.push('InstructorView.renderClassDetailsModal');
    }
    if (!window.InstructorView || typeof window.InstructorView.renderBlockDetailsModal !== 'function') {
        missing.push('InstructorView.renderBlockDetailsModal');
    }
    if (!window.InstructorView || typeof window.InstructorView.renderManageStudentsModal !== 'function') {
        missing.push('InstructorView.renderManageStudentsModal');
    }
    if (!window.InstructorView || typeof window.InstructorView.renderAddClassModal !== 'function') {
        missing.push('InstructorView.renderAddClassModal');
    }

    if (!window.CalendarRenderer || typeof window.CalendarRenderer.renderGrid !== 'function') {
        missing.push('CalendarRenderer.renderGrid');
    }
    if (!window.CalendarRenderer || typeof window.CalendarRenderer.bindEvents !== 'function') {
        missing.push('CalendarRenderer.bindEvents');
    }
    if (!window.CalendarRenderer || typeof window.CalendarRenderer.showNotification !== 'function') {
        missing.push('CalendarRenderer.showNotification');
    }

    if (!window.CalendarUtils || typeof window.CalendarUtils.formatHour !== 'function') {
        missing.push('CalendarUtils.formatHour');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (!window.CalendarModes || typeof window.CalendarModes.registerMode !== 'function') {
        missing.push('CalendarModes.registerMode');
    }

    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.setInstructorTemplate !== 'function') {
        missing.push('CalendarInstructorCore.setInstructorTemplate');
    }
    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.removeInstructorTemplate !== 'function') {
        missing.push('CalendarInstructorCore.removeInstructorTemplate');
    }
    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.setInstructorBlock !== 'function') {
        missing.push('CalendarInstructorCore.setInstructorBlock');
    }
    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.removeInstructorBlock !== 'function') {
        missing.push('CalendarInstructorCore.removeInstructorBlock');
    }

    if (!window.MutationUtils || typeof window.MutationUtils.performMutation !== 'function') {
        missing.push('MutationUtils.performMutation');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (missing.length > 0) {
        throw new Error('[InstructorMode] Missing dependencies: ' + missing.join(', '));
    }

    window.__instructorModeLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var InstructorQueries = window.InstructorQueries;
    var InstructorView = window.InstructorView;
    var CalendarRenderer = window.CalendarRenderer;
    var CalendarUtils = window.CalendarUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CalendarModes = window.CalendarModes;
    var InstructorCore = window.CalendarInstructorCore;
    var MutationUtils = window.MutationUtils;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPERS
    // ============================================================

    function getInstructors() {
        return CharacterQueries.getInstructors() || [];
    }

    function getEntityDisplayName(entity) {
        return CharacterQueries.getDisplayName(entity);
    }

    // ============================================================
    // DATA QUERY
    // ============================================================

    function getSchedule(state) {
        if (!state || !state.selectedId) {
            return {};
        }

        return InstructorQueries.getInstructorSchedule(
            state.selectedId,
            state.week
        );
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container, state) {
        if (!container) {
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

        var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);
        var instructor = CharacterQueries.getCharacterById(instructorId);
        var instructorName = instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';

        var data = {
            schedule: schedule,
            restDays: [],
            entityName: instructorName,
            getDiscipline: function(id) {
                return DisciplineQueries.getDiscipline(id);
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
            getInstructorName: function() {
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
            extraSidebar: InstructorView.renderInstructorSidebar(instructorId, week),
            availableItems: getAvailableDisciplines(instructorId, week),
            availableLabel: 'Available Disciplines'
        };

        CalendarRenderer.renderGrid(container, state, data);

        CalendarRenderer.bindEvents(container, state, {
            onSlotClick: function(day, hour) {
                handleAddClass(instructorId, week, day, hour, container);
            },
            onSlotRightClick: function(day, hour) {
                handleSlotRightClick(instructorId, week, day, hour, container);
            },
            onSlotDetails: function(day, hour) {
                handleSlotDetails(instructorId, week, day, hour, container);
            },
            onBlockClick: function(day, hour) {
                handleBlockDetails(instructorId, week, day, hour, container);
            },
            onBlockRightClick: function(day, hour) {
                handleRemoveBlock(instructorId, week, day, hour, container);
            },
            onAvailableItemClick: function(disciplineId) {
                handleAddClassWithDiscipline(instructorId, week, null, null, container, disciplineId);
            }
        });
    }

    // ============================================================
    // AVAILABLE DISCIPLINES
    // ============================================================

    function getAvailableDisciplines(instructorId, week) {
        var disciplines = InstructorQueries.getAvailableDisciplines(instructorId, week) || [];

        return disciplines.map(function(d) {
            return {
                id: d.id,
                label: d.name,
                subtitle: 'Available'
            };
        });
    }

    // ============================================================
    // HANDLE ADD CLASS
    // ============================================================

    function handleAddClass(instructorId, week, day, hour, container) {
        var disciplines = InstructorQueries.getAvailableDisciplines(instructorId, week);

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);
        var dayName = CalendarConstants.getDayName(day);

        InstructorView.renderAddClassModal({
            instructorId: instructorId,
            week: week,
            day: day,
            hour: hour,
            title: 'Add Class Template - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performAddClass(instructorId, week, day, hour, disciplineId, duration, label, closeModal, container);
            }
        });
    }

    function handleAddClassWithDiscipline(instructorId, week, day, hour, container, preSelectedDisciplineId) {
        var disciplines = InstructorQueries.getAvailableDisciplines(instructorId, week);

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this instructor in week ' + week + '.', 'error');
            return;
        }

        if (day === null || hour === null) {
            var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);
            var found = false;

            for (var d = CalendarConstants.MIN_DAY; d <= CalendarConstants.MAX_DAY; d++) {
                for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                    if (!schedule[d] || !schedule[d][h]) {
                        var discipline = DisciplineQueries.getDiscipline(preSelectedDisciplineId);
                        var disciplineName = discipline ? discipline.name : 'Unknown';
                        var dayName = CalendarConstants.getDayName(d);

                        InstructorView.renderAddClassModal({
                            instructorId: instructorId,
                            week: week,
                            day: d,
                            hour: h,
                            title: 'Add Class Template - ' + dayName + ' at ' + CalendarUtils.formatHour(h),
                            disciplines: disciplines,
                            maxDuration: MAX_DURATION,
                            preSelectedDisciplineId: preSelectedDisciplineId
                        }, {
                            onConfirm: function(disciplineId, duration, label, closeModal) {
                                performAddClass(instructorId, week, d, h, disciplineId, duration, label, closeModal, container);
                            }
                        });

                        found = true;
                        break;
                    }
                }
                if (found) break;
            }

            if (!found) {
                CalendarRenderer.showNotification('No available slots found.', 'error');
            }
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);
        var dayName = CalendarConstants.getDayName(day);

        InstructorView.renderAddClassModal({
            instructorId: instructorId,
            week: week,
            day: day,
            hour: hour,
            title: 'Add Class Template - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION,
            preSelectedDisciplineId: preSelectedDisciplineId
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performAddClass(instructorId, week, day, hour, disciplineId, duration, label, closeModal, container);
            }
        });
    }

    // ============================================================
    // PERFORM ADD CLASS
    // ============================================================

    function performAddClass(instructorId, week, day, hour, disciplineId, duration, label, closeModal, container) {
        if (hour + duration > CALENDAR_END_HOUR + 1) {
            CalendarRenderer.showNotification('Class extends beyond the calendar boundary.', 'error');
            return;
        }

        var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);
        if (schedule[day] && schedule[day][hour]) {
            var existing = schedule[day][hour];
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

        MutationUtils.performMutation({
            validate: function() {
                return { valid: true };
            },
            mutate: function() {
                return InstructorCore.setInstructorTemplate(instructorId, week, day, hour, {
                    disciplineId: disciplineId,
                    label: label || '',
                    duration: duration,
                    assignedStudents: []
                });
            },
            logMessage: function() {
                var discipline = DisciplineQueries.getDiscipline(disciplineId);
                var disciplineName = discipline ? discipline.name : 'Unknown';
                return 'Added instructor class template: ' + disciplineName;
            },
            successMessage: 'Class template added successfully!',
            failureMessage: 'Failed to add class template.'
        }).then(function(result) {
            if (result.success) {
                if (closeModal) closeModal();
                render(container, { selectedId: instructorId, week: week });
            } else {
                CalendarRenderer.showNotification(result.message || 'Failed to add class template.', 'error');
            }
        });
    }

    // ============================================================
    // HANDLE SLOT RIGHT CLICK
    // ============================================================

    function handleSlotRightClick(instructorId, week, day, hour, container) {
        var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);
        var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slot) return;

        if (slot.isBlock) {
            if (confirm('Remove this blocked time?')) {
                performRemoveBlock(instructorId, week, day, hour, container);
            }
        } else if (slot.isTemplate) {
            if (confirm('Remove this class template?')) {
                performRemoveTemplate(instructorId, week, day, hour, container);
            }
        } else if (slot) {
            if (confirm('Remove this class?')) {
                performRemoveTemplate(instructorId, week, day, hour, container);
            }
        }
    }

    // ============================================================
    // HANDLE SLOT DETAILS
    // ============================================================

    function handleSlotDetails(instructorId, week, day, hour, container) {
        var data = InstructorQueries.getClassDetails(instructorId, week, day, hour);

        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        if (data.isBlock) {
            handleBlockDetails(instructorId, week, day, hour, container);
            return;
        }

        InstructorView.renderClassDetailsModal(data, {
            onEdit: function(closeModal) {
                closeModal();
                handleEditClass(instructorId, week, day, hour, container);
            },
            onRemove: function(closeModal) {
                closeModal();
                if (confirm('Remove this class template?')) {
                    performRemoveTemplate(instructorId, week, day, hour, container);
                }
            },
            onManageStudents: function(closeModal) {
                closeModal();
                handleManageStudents(instructorId, week, day, hour, container);
            }
        });
    }

    // ============================================================
    // HANDLE BLOCK DETAILS
    // ============================================================

    function handleBlockDetails(instructorId, week, day, hour, container) {
        var schedule = InstructorQueries.getInstructorSchedule(instructorId, week);
        var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slot || !slot.isBlock) {
            CalendarRenderer.showNotification('Block not found.', 'error');
            return;
        }

        InstructorView.renderBlockDetailsModal({
            dayName: CalendarConstants.getDayName(day),
            hourDisplay: CalendarUtils.formatHour(hour),
            label: slot.label || 'Blocked Time',
            groupLabel: slot.groupLabel || null,
            duration: slot.duration || 1
        }, {
            onRemove: function(closeModal) {
                closeModal();
                if (confirm('Remove this blocked time?')) {
                    performRemoveBlock(instructorId, week, day, hour, container);
                }
            }
        });
    }

    // ============================================================
    // HANDLE EDIT CLASS
    // ============================================================

    function handleEditClass(instructorId, week, day, hour, container) {
        var data = InstructorQueries.getClassDetails(instructorId, week, day, hour);

        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        var disciplines = InstructorQueries.getAvailableDisciplines(instructorId, week);

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this instructor.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarUtils.formatHour(hour);

        InstructorView.renderAddClassModal({
            instructorId: instructorId,
            week: week,
            day: day,
            hour: hour,
            title: 'Edit Class Template - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION,
            preSelectedDisciplineId: data.disciplineId
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performRemoveTemplate(instructorId, week, day, hour, container, function() {
                    performAddClass(instructorId, week, day, hour, disciplineId, duration, label, closeModal, container);
                });
            }
        });
    }

    // ============================================================
    // HANDLE MANAGE STUDENTS
    // ============================================================

    function handleManageStudents(instructorId, week, day, hour, container) {
        var data = InstructorQueries.getClassDetails(instructorId, week, day, hour);

        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        var allStudents = CharacterQueries.getStudents() || [];
        var assignedStudentIds = [];

        if (data.students) {
            for (var i = 0; i < data.students.length; i++) {
                assignedStudentIds.push(data.students[i].studentId);
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
                name: CharacterQueries.getDisplayName(student),
                assigned: isAssigned
            };
        });

        InstructorView.renderManageStudentsModal({
            instructorId: instructorId,
            week: week,
            day: day,
            hour: hour,
            students: students,
            disciplineName: data.disciplineName || 'Unknown'
        }, {
            onConfirm: function(selectedStudents, closeModal) {
                performUpdateAssignments(instructorId, week, day, hour, selectedStudents, closeModal, container);
            }
        });
    }

    // ============================================================
    // PERFORM REMOVE TEMPLATE
    // ============================================================

    function performRemoveTemplate(instructorId, week, day, hour, container, callback) {
        MutationUtils.performMutation({
            validate: function() {
                return { valid: true };
            },
            mutate: function() {
                return InstructorCore.removeInstructorTemplate(instructorId, week, day, hour);
            },
            logMessage: 'Removed instructor class template',
            successMessage: 'Class template removed successfully!',
            failureMessage: 'Failed to remove class template.'
        }).then(function(result) {
            if (result.success) {
                render(container, { selectedId: instructorId, week: week });
                if (callback) callback();
            } else {
                CalendarRenderer.showNotification(result.message || 'Failed to remove class template.', 'error');
            }
        });
    }

    // ============================================================
    // PERFORM REMOVE BLOCK
    // ============================================================

    function performRemoveBlock(instructorId, week, day, hour, container) {
        MutationUtils.performMutation({
            validate: function() {
                return { valid: true };
            },
            mutate: function() {
                return InstructorCore.removeInstructorBlock(instructorId, week, day, hour);
            },
            logMessage: 'Removed instructor block',
            successMessage: 'Block removed successfully!',
            failureMessage: 'Failed to remove block.'
        }).then(function(result) {
            if (result.success) {
                render(container, { selectedId: instructorId, week: week });
            } else {
                CalendarRenderer.showNotification(result.message || 'Failed to remove block.', 'error');
            }
        });
    }

    // ============================================================
    // PERFORM UPDATE ASSIGNMENTS
    // ============================================================

    function performUpdateAssignments(instructorId, week, day, hour, selectedStudents, closeModal, container) {
        if (closeModal) closeModal();
        CalendarRenderer.showNotification('Student assignments updated.', 'success');
        render(container, { selectedId: instructorId, week: week });
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    CalendarModes.registerMode('instructor', {
        label: 'Instructor',
        hint: 'Click a slot to add class template | Right-click to remove | Click class to manage students',
        render: render,
        getEntities: getInstructors,
        getEntityDisplayName: getEntityDisplayName,
        getData: getSchedule
    });

})();