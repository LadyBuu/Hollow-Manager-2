/**
 * js/modules/calendar/modes/student.js - Student Calendar Mode
 * Full implementation of student schedule calendar
 * Path: js/modules/calendar/modes/student.js
 * 
 * This module is responsible for:
 *   - Rendering student schedule grid (using shared renderer)
 *   - Adding/removing classes from schedule
 *   - Managing rest days (user-configurable per student/week)
 *   - Displaying available disciplines
 *   - Showing class details
 * 
 * IMPORTANT:
 *   - This module uses core functions for ALL mutations
 *   - NO direct window.data mutations
 *   - Duration metadata is respected for availability calculations
 *   - Student schedules are the canonical source of truth
 *   - UI-level overlap detection is a guardrail; core is authoritative
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUtils) {
        console.error('StudentMode: CalendarUtils not loaded.');
        return;
    }

    if (!window.CalendarRenderer) {
        console.error('StudentMode: CalendarRenderer not loaded.');
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__studentModeLoaded) {
        return;
    }
    window.__studentModeLoaded = true;

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

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
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

        if (typeof window.getStudentRestDays !== 'function') {
            missing.push('getStudentRestDays');
        }

        if (typeof window.setStudentRestDays !== 'function') {
            missing.push('setStudentRestDays');
        }

        if (typeof window.addStudentScheduleClass !== 'function') {
            missing.push('addStudentScheduleClass');
        }

        if (typeof window.removeStudentScheduleClass !== 'function') {
            missing.push('removeStudentScheduleClass');
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

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (missing.length > 0) {
            console.warn('StudentMode: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getStudents() {
        return typeof window.getStudents === 'function' ? window.getStudents() : [];
    }

    function getSchedule(state) {
        if (!state || !state.selectedId) {
            return {};
        }
        return typeof window.getStudentSchedule === 'function'
            ? window.getStudentSchedule(state.selectedId, state.week)
            : {};
    }

    function render(container, state) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Student calendar dependencies not loaded.</p>';
            return;
        }

        if (!state || !state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a student to view their schedule</div>';
            return;
        }

        renderStudentSchedule(container, state);
    }

    // ============================================================
    // RENDER STUDENT SCHEDULE - Using Shared Renderer
    // ============================================================

    function renderStudentSchedule(container, state) {
        var studentId = state.selectedId;
        var week = state.week;

        var schedule = window.getStudentSchedule(studentId, week) || {};
        var restDays = window.getStudentRestDays(studentId, week) || [];
        var availableDisciplines = getAvailableDisciplinesForStudent(studentId, week);
        var student = window.getCharacterById(studentId);
        var studentName = student ? window.getDisplayName(student) : 'Unknown';

        // Prepare data for shared renderer
        var data = {
            schedule: schedule,
            restDays: restDays,
            entityName: studentName,
            getDiscipline: function(id) {
                return window.getDiscipline(id);
            },
            getDuration: function(day, hour) {
                return window.getClassDuration(studentId, week, day, hour) || 1;
            },
            getLabel: function(day, hour) {
                return window.getClassLabel(studentId, week, day, hour) || '';
            },
            getGroupLabel: function(day, hour) {
                return window.getClassGroupLabel(studentId, week, day, hour) || '';
            },
            getInstructorName: function(day, hour) {
                var instructorId = window.getClassInstructor(studentId, week, day, hour);
                if (instructorId) {
                    var instructor = window.getCharacterById(instructorId);
                    if (instructor) {
                        return window.getDisplayName(instructor);
                    }
                }
                return '';
            },
            availableItems: availableDisciplines.map(function(item) {
                var remaining = item.maxHours - item.used;
                return {
                    id: item.discipline.id,
                    label: item.discipline.name,
                    subtitle: remaining + 'h remaining'
                };
            }),
            availableLabel: 'Available Disciplines',
            slotLabelField: 'label'
        };

        // Use shared renderer
        CalendarRenderer.renderGrid(container, state, data);

        // Bind events with student-specific callbacks
        CalendarRenderer.bindEvents(container, state, {
            onSlotClick: function(day, hour) {
                showAddClassModal(studentId, week, day, hour, container);
            },
            onSlotRightClick: function(day, hour) {
                if (confirm('Remove this class from the schedule?')) {
                    removeClass(studentId, week, day, hour, container);
                }
            },
            onSlotDetails: function(day, hour) {
                showClassDetailsModal(studentId, week, day, hour, container);
            },
            onRestDaySave: function(days) {
                saveRestDays(studentId, week, days, container);
            },
            onAvailableItemClick: function(disciplineId) {
                showTimeSlotsModal(studentId, week, disciplineId, container);
            }
        });
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    function saveRestDays(studentId, week, days, container) {
        var result = window.setStudentRestDays(studentId, week, days);
        if (result && result.success) {
            window.saveData()
                .then(function() {
                    CalendarRenderer.showNotification('Rest days saved.', 'success');
                    render(container, { selectedId: studentId, week: week });
                })
                .catch(function() {
                    CalendarRenderer.showNotification('Rest days saved in memory, but persistence failed.', 'error');
                });
        } else {
            CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // ADD CLASS MODAL - Using Shared Renderer
    // ============================================================

    function showAddClassModal(studentId, week, day, hour, container) {
        var available = getAvailableDisciplinesForStudent(studentId, week);

        if (available.length === 0) {
            CalendarRenderer.showNotification('All disciplines are full for this week.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        CalendarRenderer.createAddClassModal({
            title: 'Add Class - ' + CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay,
            disciplines: available.map(function(item) { return item.discipline; }),
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
                var currentSchedule = window.getStudentSchedule(studentId, week) || {};

                // UI-level range overlap check (guardrail)
                if (hasRangeOverlap(currentSchedule, studentId, week, day, hour, duration)) {
                    CalendarRenderer.showNotification('This would overlap with an existing class.', 'error');
                    return;
                }

                // Validate remaining weekly hours
                var availableItem = null;
                for (var i = 0; i < available.length; i++) {
                    if (available[i].discipline.id === disciplineId) {
                        availableItem = available[i];
                        break;
                    }
                }

                if (!availableItem) {
                    CalendarRenderer.showNotification('This discipline is no longer available.', 'error');
                    return;
                }

                var remainingHours = availableItem.maxHours - availableItem.used;

                if (duration > remainingHours) {
                    CalendarRenderer.showNotification(
                        'This class would exceed the remaining weekly hours for this discipline.',
                        'error'
                    );
                    return;
                }

                var discipline = window.getDiscipline(disciplineId);
                var instructorId = discipline && discipline.instructorIds && discipline.instructorIds.length > 0
                    ? discipline.instructorIds[0]
                    : null;

                var result = window.addStudentScheduleClass(
                    studentId,
                    week,
                    day,
                    hour,
                    disciplineId,
                    duration,
                    instructorId
                );

                if (!result || !result.success) {
                    CalendarRenderer.showNotification(result ? result.message : 'Failed to add class.', 'error');
                    return;
                }

                closeModal();
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Class added successfully.', 'success');
                        render(container, { selectedId: studentId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Class added in memory, but persistence failed.', 'error');
                        render(container, { selectedId: studentId, week: week });
                    });
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    // ============================================================
    // CLASS DETAILS MODAL - Using Shared Renderer
    // ============================================================

    function showClassDetailsModal(studentId, week, day, hour, container) {
        var schedule = window.getStudentSchedule(studentId, week) || {};
        var daySchedule = schedule[day] || {};
        var disciplineId = daySchedule[hour];

        if (!disciplineId) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            CalendarRenderer.showNotification('Discipline not found.', 'error');
            return;
        }

        var instructorId = window.getClassInstructor(studentId, week, day, hour);
        var duration = window.getClassDuration(studentId, week, day, hour) || 1;
        var label = window.getClassLabel(studentId, week, day, hour) || '';
        var groupLabel = window.getClassGroupLabel(studentId, week, day, hour) || '';

        var instructorName = 'Not assigned';
        if (instructorId) {
            var instructor = window.getCharacterById(instructorId);
            if (instructor) {
                instructorName = window.getDisplayName(instructor);
            }
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        CalendarRenderer.createDetailsModal({
            title: discipline.name + (label ? ' [' + label + ']' : '') + (groupLabel ? ' (G' + groupLabel + ')' : ''),
            details: [
                { label: 'Instructor', value: instructorName },
                { label: 'Day/Time', value: CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay },
                { label: 'Duration', value: duration + ' hour' + (duration > 1 ? 's' : '') },
                { label: 'Group', value: groupLabel || 'None' },
                { label: 'Week', value: week }
            ],
            actions: [
                {
                    label: 'Remove from Schedule',
                    className: 'danger',
                    handler: function(closeModal) {
                        if (confirm('Remove this class from the schedule?')) {
                            closeModal();
                            removeClass(studentId, week, day, hour, container);
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
    // REMOVE CLASS
    // ============================================================

    function removeClass(studentId, week, day, hour, container) {
        var result = window.removeStudentScheduleClass(studentId, week, day, hour);

        if (!result || !result.success) {
            CalendarRenderer.showNotification(result ? result.message : 'Failed to remove class.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                CalendarRenderer.showNotification('Class removed from schedule.', 'success');
                render(container, { selectedId: studentId, week: week });
            })
            .catch(function() {
                CalendarRenderer.showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: studentId, week: week });
            });
    }

    // ============================================================
    // TIME SLOTS MODAL - Using Shared Renderer
    // ============================================================

    function showTimeSlotsModal(studentId, week, disciplineId, container) {
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            CalendarRenderer.showNotification('Discipline not found.', 'error');
            return;
        }

        var schedule = window.getStudentSchedule(studentId, week) || {};
        var restDays = window.getStudentRestDays(studentId, week) || [];
        var occupiedMap = CalendarRenderer.buildOccupiedMap(schedule, function(day, hour) {
            return window.getClassDuration(studentId, week, day, hour) || 1;
        });

        // Build time slots list
        var modal = document.createElement('div');
        modal.className = 'modal';

        var slotsHTML = '';
        var foundSlots = false;
        var selectionHours = CalendarUtils.getSelectionHours ? CalendarUtils.getSelectionHours() : [];

        if (selectionHours.length === 0) {
            for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                selectionHours.push(h);
            }
        }

        for (var day = 1; day <= 7; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            for (var i = 0; i < selectionHours.length; i++) {
                var hour = selectionHours[i];
                var isOccupied = occupiedMap[day] && occupiedMap[day][hour];

                if (!isOccupied) {
                    foundSlots = true;
                    slotsHTML += (
                        '<div style="padding:6px 10px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;">' +
                            '<span>' + CalendarRenderer.DAY_NAMES[day] + ' at ' + CalendarUtils.formatHour(hour) + '</span>' +
                            '<button class="add-to-slot-btn primary small" data-day="' + day + '" data-hour="' + hour + '">Add 1h</button>' +
                        '</div>'
                    );
                }
            }
        }

        if (!foundSlots) {
            slotsHTML = '<p class="empty-state">No available time slots for this discipline this week.</p>';
        }

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:400px;">' +
                '<div class="modal-header">' +
                    '<h3>' + CalendarRenderer.escapeHtml(discipline.name) + ' - Available Slots</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">' +
                        'Click on a time slot to add a 1-hour class.' +
                    '</p>' +
                    '<div style="max-height:300px;overflow-y:auto;" id="time-slots-list">' +
                        slotsHTML +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:12px;">' +
                        '<button type="button" id="close-slots-modal" class="secondary">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#close-slots-modal').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        var slotButtons = modal.querySelectorAll('.add-to-slot-btn');
        for (var j = 0; j < slotButtons.length; j++) {
            var btn = slotButtons[j];
            btn.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);

                // Re-read schedule at commit time (defensive)
                var currentSchedule = window.getStudentSchedule(studentId, week) || {};

                // UI-level range overlap check (guardrail)
                if (hasRangeOverlap(currentSchedule, studentId, week, day, hour, 1)) {
                    CalendarRenderer.showNotification('This slot is no longer available.', 'error');
                    closeModal();
                    render(container, { selectedId: studentId, week: week });
                    return;
                }

                var instructorId = discipline.instructorIds && discipline.instructorIds.length > 0
                    ? discipline.instructorIds[0]
                    : null;

                var result = window.addStudentScheduleClass(
                    studentId,
                    week,
                    day,
                    hour,
                    disciplineId,
                    1,
                    instructorId
                );

                if (!result || !result.success) {
                    CalendarRenderer.showNotification(result ? result.message : 'Failed to add class.', 'error');
                    return;
                }

                closeModal();
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Class added successfully.', 'success');
                        render(container, { selectedId: studentId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Class added in memory, but persistence failed.', 'error');
                        render(container, { selectedId: studentId, week: week });
                    });
            });
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getAvailableDisciplinesForStudent(studentId, week) {
        var allDisciplines = window.getAvailableDisciplines(week) || [];
        var schedule = window.getStudentSchedule(studentId, week) || {};
        var usedHours = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var discId = daySchedule[hour];
                if (discId) {
                    var duration = window.getClassDuration(studentId, week, parseInt(day, 10), parseInt(hour, 10)) || 1;
                    if (!usedHours[discId]) usedHours[discId] = 0;
                    usedHours[discId] += duration;
                }
            }
        }

        var available = [];
        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            var usedCount = usedHours[d.id] || 0;
            var maxHours = d.weeklyHours || 1;
            if (usedCount < maxHours) {
                available.push({ discipline: d, used: usedCount, maxHours: maxHours });
            }
        }

        return available;
    }

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
            var existingDuration = window.getClassDuration(studentId, week, day, existingStart) || 1;
            var existingEnd = existingStart + existingDuration;
            var requestedEnd = startHour + duration;

            if (startHour < existingEnd && requestedEnd > existingStart) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('student', {
            label: 'Student',
            hint: 'Click a slot to add class | Right-click to remove | Rest days are user-configurable',
            render: render,
            getEntities: getStudents,
            getEntityDisplayName: function(entity) {
                return typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(entity)
                    : (entity.name || 'Unknown');
            },
            getData: getSchedule
        });
    }

})();
