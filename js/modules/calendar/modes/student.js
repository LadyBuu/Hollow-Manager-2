/**
 * js/modules/calendar/modes/student.js - Student Calendar Mode
 * Full implementation of student schedule calendar
 * Path: js/modules/calendar/modes/student.js
 * 
 * This module is responsible for:
 *   - Rendering student schedule grid
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

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR;

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
            return false;
        }

        return true;
    }

    // ============================================================
    // RANGE OVERLAP DETECTION - UI-Level Guardrail
    // ============================================================

    /**
     * Check if a requested time range overlaps with any existing class.
     * Uses duration metadata to determine class boundaries.
     * 
     * This is a UI-level guardrail. Core mutation functions remain
     * the authoritative source of truth for validation.
     * 
     * @param {object} schedule - Student schedule for the week
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Requested start hour
     * @param {number} duration - Requested duration in hours
     * @returns {boolean} True if there is an overlap
     */
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

            // Range overlap check: [start, end) interval model
            if (startHour < existingEnd && requestedEnd > existingStart) {
                return true;
            }
        }

        return false;
    }

    /**
     * Build a map of occupied hours for a schedule.
     * Used for availability checks in the time-slot modal.
     */
    function buildOccupiedMap(schedule, studentId, week) {
        var occupied = {};

        for (var day = 1; day <= 7; day++) {
            if (!schedule[day]) continue;

            for (var hour in schedule[day]) {
                if (!schedule[day][hour]) continue;

                var startHour = parseInt(hour, 10);
                var duration = window.getClassDuration(studentId, week, day, startHour) || 1;

                for (var h = startHour; h < startHour + duration && h <= CALENDAR_END_HOUR; h++) {
                    if (!occupied[day]) occupied[day] = {};
                    occupied[day][h] = true;
                }
            }
        }

        return occupied;
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
    // RENDER STUDENT SCHEDULE
    // ============================================================

    function renderStudentSchedule(container, state) {
        var studentId = state.selectedId;
        var week = state.week;

        var schedule = window.getStudentSchedule(studentId, week) || {};
        var restDays = window.getStudentRestDays(studentId, week) || [];

        // Student-specific availability for the sidebar
        var availableDisciplines = getAvailableDisciplinesForStudent(studentId, week);

        var html = getScheduleGridHTML(schedule, restDays, studentId, week, availableDisciplines);
        container.innerHTML = html;

        bindStudentEvents(container, studentId, week);
    }

    // ============================================================
    // SCHEDULE GRID HTML
    // ============================================================

    function getScheduleGridHTML(schedule, restDays, studentId, week, availableDisciplines) {
        var hours = [];
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }

        var html = '<div class="schedule-grid">';

        for (var day = 1; day <= 7; day++) {
            var isRestDay = restDays.indexOf(day) !== -1;
            var dayName = DAY_NAMES[day];

            html += '<div class="day-column' + (isRestDay ? ' rest-day' : '') + '" data-day="' + day + '">';
            html += '<div class="day-header">' + dayName + (isRestDay ? ' [R]' : '') + '</div>';
            html += '<div class="day-slots">';

            var occupiedHours = {};

            for (var i = 0; i < hours.length; i++) {
                var hour = hours[i];

                if (occupiedHours[hour]) {
                    continue;
                }

                var disciplineId = null;
                if (schedule[day] && schedule[day][hour]) {
                    disciplineId = schedule[day][hour];
                }

                if (disciplineId) {
                    var discipline = window.getDiscipline(disciplineId);
                    var duration = window.getClassDuration(studentId, week, day, hour) || 1;
                    var instructorId = window.getClassInstructor(studentId, week, day, hour);
                    var label = window.getClassLabel(studentId, week, day, hour);
                    var groupLabel = window.getClassGroupLabel(studentId, week, day, hour);

                    for (var h = hour; h < hour + duration && h <= CALENDAR_END_HOUR; h++) {
                        occupiedHours[h] = true;
                    }

                    var instructorName = '';
                    if (instructorId) {
                        var instructor = window.getCharacterById(instructorId);
                        if (instructor) {
                            instructorName = window.getDisplayName(instructor);
                        }
                    }

                    var labelDisplay = label ? ' [' + escapeHtml(label) + ']' : '';
                    var groupDisplay = groupLabel ? ' (G' + escapeHtml(groupLabel) + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

                    html += '<div class="time-slot occupied" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + disciplineName + labelDisplay + groupDisplay + durationDisplay + (instructorName ? ' (' + escapeHtml(instructorName) + ')' : '') + '</span>';
                    html += '</div>';

                } else if (isRestDay) {
                    html += '<div class="time-slot empty rest-slot" data-day="' + day + '" data-hour="' + hour + '">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
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

        html += getSidebarHTML(schedule, restDays, studentId, week, availableDisciplines);

        return html;
    }

    // ============================================================
    // SIDEBAR HTML
    // ============================================================

    function getSidebarHTML(schedule, restDays, studentId, week, availableDisciplines) {
        var html = '<div class="schedule-sidebar">';

        html += '<div class="sidebar-section">';
        html += '<h4>Rest Days</h4>';
        html += '<div class="rest-day-controls">';
        for (var d = 1; d <= 7; d++) {
            var checked = restDays.indexOf(d) !== -1 ? 'checked' : '';
            html += '<label><input type="checkbox" class="rest-day-check" data-day="' + d + '" ' + checked + '> ' + DAY_NAMES[d] + '</label>';
        }
        html += '</div>';
        html += '<button id="save-rest-days-btn" class="small primary">Save Rest Days</button>';
        html += '</div>';

        html += '<div class="sidebar-section">';
        html += '<h4>Available Disciplines</h4>';
        html += '<div id="available-disciplines">';
        if (availableDisciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available for this student</p>';
        } else {
            for (var i = 0; i < availableDisciplines.length; i++) {
                var item = availableDisciplines[i];
                var d = item.discipline;
                var remaining = item.maxHours - item.used;
                html += '<div class="available-discipline" data-discipline="' + escapeHtml(d.id) + '">' +
                    escapeHtml(d.name) + ' <span style="font-size:0.6rem;color:var(--text-dim);">(' + remaining + 'h remaining)</span>' +
                '</div>';
            }
        }
        html += '</div>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindStudentEvents(container, studentId, week) {
        var emptySlots = container.querySelectorAll('.time-slot.empty:not(.rest-slot)');
        for (var i = 0; i < emptySlots.length; i++) {
            var slot = emptySlots[i];
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showAddClassModal(studentId, week, day, hour, container);
            });
        }

        var occupiedSlots = container.querySelectorAll('.time-slot.occupied');
        for (var j = 0; j < occupiedSlots.length; j++) {
            var occSlot = occupiedSlots[j];
            occSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showClassDetailsModal(studentId, week, day, hour, container);
            });

            occSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (confirm('Remove this class from the schedule?')) {
                    removeClass(studentId, week, day, hour, container);
                }
            });
        }

        var saveRestBtn = container.querySelector('#save-rest-days-btn');
        if (saveRestBtn) {
            saveRestBtn.addEventListener('click', function() {
                saveRestDays(container, studentId, week);
            });
        }

        var availDisciplines = container.querySelectorAll('.available-discipline');
        for (var k = 0; k < availDisciplines.length; k++) {
            var el = availDisciplines[k];
            el.addEventListener('click', function() {
                var disciplineId = this.dataset.discipline;
                showTimeSlotsModal(studentId, week, disciplineId, container);
            });
        }
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    function saveRestDays(container, studentId, week) {
        var checkboxes = container.querySelectorAll('.rest-day-check');
        var days = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var cb = checkboxes[i];
            if (cb.checked) {
                days.push(parseInt(cb.dataset.day, 10));
            }
        }

        var result = window.setStudentRestDays(studentId, week, days);
        if (result && result.success) {
            window.saveData()
                .then(function() {
                    showNotification('Rest days saved.', 'success');
                    render(container, { selectedId: studentId, week: week });
                })
                .catch(function() {
                    showNotification('Rest days saved in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(result && result.message ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // ADD CLASS MODAL
    // ============================================================

    function showAddClassModal(studentId, week, day, hour, container) {
        var available = getAvailableDisciplinesForStudent(studentId, week);

        if (available.length === 0) {
            showNotification('All disciplines are full for this week.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:500px;">' +
                '<div class="modal-header">' +
                    '<h3>Add Class - ' + DAY_NAMES[day] + ' at ' + hourDisplay + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Select Discipline:</label>' +
                        '<select id="add-class-select" style="width:100%;padding:8px;margin-bottom:8px;">' +
                            getAvailableOptionsHTML(available) +
                        '</select>' +
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
            var select = document.getElementById('add-class-select');
            var disciplineId = select ? select.value : null;
            if (!disciplineId) {
                showNotification('Please select a discipline.', 'error');
                return;
            }

            var durationEl = document.getElementById('add-class-duration');
            var duration = parseInt(durationEl ? durationEl.value : 1, 10) || 1;

            // Validate calendar boundary
            if (hour + duration > CALENDAR_END_HOUR + 1) {
                showNotification('Class extends beyond the calendar boundary.', 'error');
                return;
            }

            // Re-read schedule at commit time (defensive)
            var currentSchedule = window.getStudentSchedule(studentId, week) || {};

            // UI-level range overlap check (guardrail)
            if (hasRangeOverlap(currentSchedule, studentId, week, day, hour, duration)) {
                showNotification('This would overlap with an existing class.', 'error');
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
                showNotification('This discipline is no longer available.', 'error');
                return;
            }

            var remainingHours = availableItem.maxHours - availableItem.used;

            if (duration > remainingHours) {
                showNotification(
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
                showNotification(result ? result.message : 'Failed to add class.', 'error');
                return;
            }

            modal.remove();
            window.saveData()
                .then(function() {
                    showNotification('Class added successfully.', 'success');
                    render(container, { selectedId: studentId, week: week });
                })
                .catch(function() {
                    showNotification('Class added in memory, but persistence failed.', 'error');
                    render(container, { selectedId: studentId, week: week });
                });
        };
    }

    function getAvailableOptionsHTML(available) {
        var html = '';
        for (var i = 0; i < available.length; i++) {
            var item = available[i];
            var d = item.discipline;
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        return html;
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    function showClassDetailsModal(studentId, week, day, hour, container) {
        var schedule = window.getStudentSchedule(studentId, week) || {};
        var daySchedule = schedule[day] || {};
        var disciplineId = daySchedule[hour];

        if (!disciplineId) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
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

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:450px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(discipline.name) + (label ? ' [' + escapeHtml(label) + ']' : '') + (groupLabel ? ' (G' + escapeHtml(groupLabel) + ')' : '') + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="label">Instructor:</span> <span><strong>' + escapeHtml(instructorName) + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Day/Time:</span> <span>' + escapeHtml(DAY_NAMES[day]) + ' at ' + escapeHtml(hourDisplay) + '</span></div>' +
                    '<div class="detail-row"><span class="label">Duration:</span> <span><strong>' + duration + ' hour' + (duration > 1 ? 's' : '') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Group:</span> <span><strong>' + (groupLabel ? escapeHtml(groupLabel) : 'None') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Week:</span> <span>' + week + '</span></div>' +
                    '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button type="button" id="remove-class-detail" class="danger small">Remove from Schedule</button>' +
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

        modal.querySelector('#remove-class-detail').onclick = function() {
            if (confirm('Remove this class from the schedule?')) {
                modal.remove();
                removeClass(studentId, week, day, hour, container);
            }
        };
    }

    // ============================================================
    // REMOVE CLASS
    // ============================================================

    function removeClass(studentId, week, day, hour, container) {
        var result = window.removeStudentScheduleClass(studentId, week, day, hour);

        if (!result || !result.success) {
            showNotification(result ? result.message : 'Failed to remove class.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                showNotification('Class removed from schedule.', 'success');
                render(container, { selectedId: studentId, week: week });
            })
            .catch(function() {
                showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: studentId, week: week });
            });
    }

    // ============================================================
    // TIME SLOTS MODAL - Duration-Aware
    // ============================================================

    function showTimeSlotsModal(studentId, week, disciplineId, container) {
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        var schedule = window.getStudentSchedule(studentId, week) || {};
        var restDays = window.getStudentRestDays(studentId, week) || [];

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:400px;">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(discipline.name) + ' - Available Slots</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">' +
                        'Click on a time slot to add a 1-hour class.' +
                    '</p>' +
                    '<div style="max-height:300px;overflow-y:auto;" id="time-slots-list">' +
                        getTimeSlotsListHTML(schedule, restDays, studentId, week) +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:12px;">' +
                        '<button type="button" id="close-slots-modal" class="secondary">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#close-slots-modal').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        var slotButtons = modal.querySelectorAll('.add-to-slot-btn');
        for (var i = 0; i < slotButtons.length; i++) {
            var btn = slotButtons[i];
            btn.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);

                // Re-read schedule at commit time (defensive)
                var currentSchedule = window.getStudentSchedule(studentId, week) || {};

                // UI-level range overlap check (guardrail)
                if (hasRangeOverlap(currentSchedule, studentId, week, day, hour, 1)) {
                    showNotification('This slot is no longer available.', 'error');
                    modal.remove();
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
                    showNotification(result ? result.message : 'Failed to add class.', 'error');
                    return;
                }

                modal.remove();
                window.saveData()
                    .then(function() {
                        showNotification('Class added successfully.', 'success');
                        render(container, { selectedId: studentId, week: week });
                    })
                    .catch(function() {
                        showNotification('Class added in memory, but persistence failed.', 'error');
                        render(container, { selectedId: studentId, week: week });
                    });
            });
        }
    }

    function getTimeSlotsListHTML(schedule, restDays, studentId, week) {
        var html = '';
        var foundSlots = false;
        var selectionHours = CalendarUtils.getSelectionHours();

        // Build occupied map using the shared helper
        var occupiedMap = buildOccupiedMap(schedule, studentId, week);

        for (var day = 1; day <= 7; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            for (var i = 0; i < selectionHours.length; i++) {
                var hour = selectionHours[i];
                var isOccupied = occupiedMap[day] && occupiedMap[day][hour];

                if (!isOccupied) {
                    foundSlots = true;
                    html += (
                        '<div style="padding:6px 10px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;">' +
                            '<span>' + DAY_NAMES[day] + ' at ' + CalendarUtils.formatHour(hour) + '</span>' +
                            '<button class="add-to-slot-btn primary small" data-day="' + day + '" data-hour="' + hour + '">Add 1h</button>' +
                        '</div>'
                    );
                }
            }
        }

        if (!foundSlots) {
            html = '<p class="empty-state">No available time slots for this discipline this week.</p>';
        }

        return html;
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
