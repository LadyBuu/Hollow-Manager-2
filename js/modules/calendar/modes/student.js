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
 */

(function() {
    'use strict';

    if (window.__studentModeLoaded) {
        return;
    }
    window.__studentModeLoaded = true;

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
            { name: 'getStudentSchedule', fn: window.getStudentSchedule },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline },
            { name: 'getStudentRestDays', fn: window.getStudentRestDays },
            { name: 'setStudentRestDays', fn: window.setStudentRestDays },
            { name: 'addStudentScheduleClass', fn: window.addStudentScheduleClass },
            { name: 'removeStudentScheduleClass', fn: window.removeStudentScheduleClass },
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
            console.warn('[StudentMode] Missing dependencies:', missing.join(', '));
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

        // Render the student schedule
        renderStudentSchedule(container, state);
    }

    // ============================================================
    // RENDER STUDENT SCHEDULE
    // ============================================================

    function renderStudentSchedule(container, state) {
        if (!state || !state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a student to view their schedule</div>';
            return;
        }

        var studentId = state.selectedId;
        var week = state.week;

        var schedule = window.getStudentSchedule(studentId, week);
        var restDays = window.getStudentRestDays(studentId, week) || [];
        var availableDisciplines = window.getAvailableDisciplines(week);

        var html = getScheduleGridHTML(schedule, restDays, studentId, week, availableDisciplines);
        container.innerHTML = html;

        // Bind events
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

        // Day columns
        for (var day = 1; day <= 7; day++) {
            var isRestDay = restDays.indexOf(day) !== -1;
            var dayName = DAY_NAMES[day];

            html += '<div class="day-column' + (isRestDay ? ' rest-day' : '') + '" data-day="' + day + '">';
            html += '<div class="day-header">' + dayName + (isRestDay ? ' 🛑' : '') + '</div>';
            html += '<div class="day-slots">';

            var occupiedHours = {};

            hours.forEach(function(hour) {
                if (occupiedHours[hour]) return;

                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

                if (disciplineId) {
                    var discipline = window.getDiscipline(disciplineId);
                    var duration = window.getClassDuration(studentId, week, day, hour) || 1;
                    var instructorId = window.getClassInstructor(studentId, week, day, hour);
                    var label = window.getClassLabel(studentId, week, day, hour);
                    var groupLabel = window.getClassGroupLabel(studentId, week, day, hour);

                    // Mark occupied hours
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

                    var labelDisplay = label ? ' [' + label + ']' : '';
                    var groupDisplay = groupLabel ? ' (G' + groupLabel + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';

                    html += '<div class="time-slot occupied" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + (discipline ? discipline.name : 'Unknown') + labelDisplay + groupDisplay + durationDisplay + (instructorName ? ' (' + instructorName + ')' : '') + '</span>';
                    html += '</div>';

                } else if (isRestDay) {
                    // Rest day - skip empty slots
                    html += '<div class="time-slot empty rest-slot" data-day="' + day + '" data-hour="' + hour + '">';
                    html += '<span class="slot-time">' + formatHour(hour) + '</span>';
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

        // Sidebar with controls
        html += getSidebarHTML(schedule, restDays, studentId, week, availableDisciplines);

        return html;
    }

    // ============================================================
    // SIDEBAR HTML
    // ============================================================

    function getSidebarHTML(schedule, restDays, studentId, week, availableDisciplines) {
        var html = '<div class="schedule-sidebar">';

        // Rest days
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

        // Available disciplines
        html += '<div class="sidebar-section">';
        html += '<h4>Available Disciplines</h4>';
        html += '<div id="available-disciplines">';
        if (availableDisciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available</p>';
        } else {
            availableDisciplines.forEach(function(d) {
                html += '<div class="available-discipline" data-discipline="' + d.id + '">' + d.name + '</div>';
            });
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
        // Empty slots - click to add class
        container.querySelectorAll('.time-slot.empty:not(.rest-slot)').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showAddClassModal(studentId, week, day, hour, container);
            });
        });

        // Occupied slots - click for details, right-click to remove
        container.querySelectorAll('.time-slot.occupied').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showClassDetailsModal(studentId, week, day, hour, container);
            });

            slot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                if (confirm('Remove this class from the schedule?')) {
                    removeClass(studentId, week, day, hour, container);
                }
            });
        });

        // Rest days
        var saveRestBtn = container.querySelector('#save-rest-days-btn');
        if (saveRestBtn) {
            saveRestBtn.addEventListener('click', function() {
                saveRestDays(container, studentId, week);
            });
        }

        // Available disciplines - click to add
        container.querySelectorAll('.available-discipline').forEach(function(el) {
            el.addEventListener('click', function() {
                var disciplineId = this.dataset.discipline;
                showTimeSlotsModal(studentId, week, disciplineId, container);
            });
        });
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    function saveRestDays(container, studentId, week) {
        var checkboxes = container.querySelectorAll('.rest-day-check');
        var days = [];
        checkboxes.forEach(function(cb) {
            if (cb.checked) {
                days.push(parseInt(cb.dataset.day));
            }
        });

        var result = window.setStudentRestDays(studentId, week, days);
        if (result && result.success) {
            window.saveData()
                .then(function() {
                    showNotification('Rest days saved!', 'success');
                    render(container, { selectedId: studentId, week: week });
                })
                .catch(function(err) {
                    console.error('Failed to save rest days:', err);
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

        var hourDisplay = formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3>Add Class - ${DAY_NAMES[day]} at ${hourDisplay}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Select Discipline:</label>
                        <select id="add-class-select" style="width:100%;padding:8px;margin-bottom:8px;">
                            ${available.map(function(item) {
                                var d = item.discipline;
                                return '<option value="' + d.id + '">' + d.name + '</option>';
                            }).join('')}
                        </select>
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
            var disciplineId = document.getElementById('add-class-select').value;
            if (!disciplineId) {
                showNotification('Please select a discipline.', 'error');
                return;
            }

            var duration = parseInt(document.getElementById('add-class-duration').value) || 1;

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
                    showNotification('Class added successfully!', 'success');
                    render(container, { selectedId: studentId, week: week });
                })
                .catch(function(err) {
                    console.error('Failed to save class:', err);
                    showNotification('Class added in memory, but persistence failed.', 'error');
                    render(container, { selectedId: studentId, week: week });
                });
        };
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    function showClassDetailsModal(studentId, week, day, hour, container) {
        var disciplineId = window.getStudentSchedule(studentId, week)[day][hour];
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) return;

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

        var hourDisplay = formatHour(hour);

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>${discipline.name} ${label ? '[' + label + ']' : ''} ${groupLabel ? '(G' + groupLabel + ')' : ''}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Instructor:</span> <span><strong>${instructorName}</strong></span></div>
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${DAY_NAMES[day]} at ${hourDisplay}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span><strong>${duration} hour${duration > 1 ? 's' : ''}</strong></span></div>
                    <div class="detail-row"><span class="label">Group:</span> <span><strong>${groupLabel || 'None'}</strong></span></div>
                    <div class="detail-row"><span class="label">Week:</span> <span>${week}</span></div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-class-detail" class="danger small">✕ Remove from Schedule</button>
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
            .catch(function(err) {
                console.error('Failed to save class removal:', err);
                showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: studentId, week: week });
            });
    }

    // ============================================================
    // TIME SLOTS MODAL
    // ============================================================

    function showTimeSlotsModal(studentId, week, disciplineId, container) {
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        var schedule = window.getStudentSchedule(studentId, week);
        var restDays = window.getStudentRestDays(studentId, week) || [];

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <div class="modal-header">
                    <h3>${discipline.name} - Available Slots</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">
                        Click on a time slot to add a <strong>1-hour</strong> class.
                    </p>
                    <div style="max-height:300px;overflow-y:auto;" id="time-slots-list">
                        ${getTimeSlotsListHTML(schedule, restDays)}
                    </div>
                    <div class="form-actions" style="margin-top:12px;">
                        <button type="button" id="close-slots-modal" class="secondary">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-slots-modal').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelectorAll('.add-to-slot-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);

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
                        showNotification('Class added successfully!', 'success');
                        render(container, { selectedId: studentId, week: week });
                    })
                    .catch(function(err) {
                        console.error('Failed to save class:', err);
                        showNotification('Class added in memory, but persistence failed.', 'error');
                        render(container, { selectedId: studentId, week: week });
                    });
            });
        });
    }

    function getTimeSlotsListHTML(schedule, restDays) {
        var html = '';
        var foundSlots = false;

        for (var day = 1; day <= 7; day++) {
            if (restDays.indexOf(day) !== -1) continue;

            for (var hour = 8; hour <= 20; hour++) {
                var hasClass = schedule[day] && schedule[day][hour];
                if (!hasClass) {
                    foundSlots = true;
                    html += '<div style="padding:6px 10px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;">';
                    html += '<span>' + DAY_NAMES[day] + ' at ' + formatHour(hour) + '</span>';
                    html += '<button class="add-to-slot-btn primary small" data-day="' + day + '" data-hour="' + hour + '">Add 1h</button>';
                    html += '</div>';
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

    function formatHour(hour) {
        if (hour === undefined || hour === null || hour < 0 || hour > 23) {
            return '?';
        }
        var h = hour % 12 || 12;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        return h + ':00 ' + ampm;
    }

    function getAvailableDisciplinesForStudent(studentId, week) {
        var allDisciplines = window.getAvailableDisciplines(week);
        var schedule = window.getStudentSchedule(studentId, week);
        var usedHours = {};

        for (var day in schedule) {
            for (var hour in schedule[day]) {
                var discId = schedule[day][hour];
                if (discId) {
                    if (!usedHours[discId]) usedHours[discId] = 0;
                    usedHours[discId]++;
                }
            }
        }

        var available = [];
        allDisciplines.forEach(function(d) {
            var usedCount = usedHours[d.id] || 0;
            var maxHours = d.weeklyHours || 1;
            if (usedCount < maxHours) {
                available.push({ discipline: d, used: usedCount, maxHours: maxHours });
            }
        });

        return available;
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
            console.log('[StudentMode]', message);
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('student', {
            label: 'Student',
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.StudentMode = {
        render: render,
        getStudents: getStudents,
        getSchedule: getSchedule
    };

})();
