/**
 * js/modules/curriculum/schedule.js - Student Schedule Module
 * Handles individual student schedules with weekly view
 * Renamed from student-schedule.js
 * Path: js/modules/curriculum/schedule.js
 */

(function() {
    'use strict';

    var state = {
        currentWeek: 1,
        selectedStudentId: null
    };

    function renderStudentScheduleView(container) {
        if (!container) {
            container = document.getElementById('schedule-content');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for schedule, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading schedule data...</p>';
            return;
        }

        // Ensure curriculum structure exists
        if (!window.data.curriculum) {
            window.data.curriculum = {
                disciplines: [],
                schedules: {},
                restDays: {},
                examDays: {},
                grades: {},
                rankings: {},
                currentWeek: 1,
                classInstructors: {},
                classLabels: {},
                classGroupLabels: {},
                classDurations: {},
                instructorClasses: {},
                instructorTemplates: {},
                instructorBlocks: {},
                instructorGroups: {},
                disciplineGroups: {},
                autoGroups: {}
            };
        }
        if (!window.data.curriculum.schedules) {
            window.data.curriculum.schedules = {};
        }
        if (!window.data.curriculum.restDays) {
            window.data.curriculum.restDays = {};
        }

        container.innerHTML = getScheduleHTML();

        populateStudentSelector();
        initStudentScheduleEvents();
        renderStudentSchedule();
    }

    function getScheduleHTML() {
        return `
            <div class="page-header">
                <h2>Student Schedule</h2>
                <div class="header-actions">
                    <button id="duplicate-schedule-btn" class="primary small">■ Duplicate to Week</button>
                    <button id="clear-schedule-btn" class="danger small">✕ Clear Week</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="student-selector">
                    <label for="schedule-student">Student:</label>
                    <select id="schedule-student">
                        <option value="">Select a trainee...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="prev-schedule-week" class="small">← Prev</button>
                    <span id="schedule-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-schedule-week" class="small">Next →</button>
                    <button id="goto-schedule-week" class="small primary">Go to Week</button>
                </div>
            </div>
            <div class="schedule-grid-wrapper" id="schedule-grid-wrapper">
                <div class="schedule-grid" id="schedule-grid">
                    <div class="day-column" data-day="1">
                        <div class="day-header">Monday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="2">
                        <div class="day-header">Tuesday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="3">
                        <div class="day-header">Wednesday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="4">
                        <div class="day-header">Thursday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="5">
                        <div class="day-header">Friday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="6">
                        <div class="day-header">Saturday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="7">
                        <div class="day-header">Sunday</div>
                        <div class="day-slots"></div>
                    </div>
                </div>
            </div>
            <div class="schedule-sidebar">
                <div class="sidebar-section">
                    <h4>Week Overview</h4>
                    <div id="schedule-overview"><p class="empty-state">No classes scheduled</p></div>
                </div>
                <div class="sidebar-section">
                    <h4>Available Disciplines</h4>
                    <div id="schedule-available"><p class="empty-state">No disciplines available</p></div>
                </div>
                <div class="sidebar-section">
                    <h4>Rest Days</h4>
                    <div class="rest-day-controls">
                        <label><input type="checkbox" class="rest-day-check" data-day="1"> Mon</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="2"> Tue</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="3"> Wed</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="4"> Thu</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="5"> Fri</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="6"> Sat</label>
                        <label><input type="checkbox" class="rest-day-check" data-day="7"> Sun</label>
                    </div>
                    <button id="save-rest-days-btn" class="small primary" style="margin-top:8px;">Save Rest Days</button>
                </div>
                <div class="sidebar-section">
                    <h4>Hours Summary</h4>
                    <div id="schedule-hours-summary">
                        <p>Used: <strong id="schedule-hours-used">0</strong> / <span id="schedule-hours-total">0</span></p>
                    </div>
                </div>
            </div>
        `;
    }

    function populateStudentSelector() {
        var select = document.getElementById('schedule-student');
        if (!select) return;

        var trainees = window.data && window.data.characters ? window.data.characters.filter(function(c) {
            if (c.deceased) return false;
            var status = window.getCurrentStatus(c).toLowerCase();
            return status === 'trainee' || status === 'rookie';
        }) : [];

        trainees.sort(function(a, b) {
            var nameA = window.getDisplayName(a).toLowerCase();
            var nameB = window.getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        var currentValue = select.value;
        select.innerHTML = '<option value="">Select a trainee...</option>';

        if (trainees.length === 0) {
            select.innerHTML += '<option value="" disabled>No trainees found. Create a trainee character first.</option>';
            return;
        }

        trainees.forEach(function(c) {
            var name = window.getDisplayName(c);
            var option = document.createElement('option');
            option.value = c.id;
            var status = window.getCurrentStatus(c);
            option.textContent = name + ' (' + status + ')';
            select.appendChild(option);
        });

        if (currentValue && select.querySelector('option[value="' + currentValue + '"]')) {
            select.value = currentValue;
        } else if (select.options.length > 1 && !state.selectedStudentId) {
            select.selectedIndex = 1;
            state.selectedStudentId = select.value;
        }
    }

    function initStudentScheduleEvents() {
        var studentSelect = document.getElementById('schedule-student');
        if (studentSelect) {
            var newSelect = studentSelect.cloneNode(true);
            studentSelect.parentNode.replaceChild(newSelect, studentSelect);

            newSelect.addEventListener('change', function() {
                state.selectedStudentId = this.value;
                renderStudentSchedule();
            });
            studentSelect = newSelect;
        }

        var prevBtn = document.getElementById('prev-schedule-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderStudentSchedule();
                }
            });
        }

        var nextBtn = document.getElementById('next-schedule-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderStudentSchedule();
                }
            });
        }

        var gotoBtn = document.getElementById('goto-schedule-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', state.currentWeek);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderStudentSchedule();
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }

        var duplicateBtn = document.getElementById('duplicate-schedule-btn');
        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', showDuplicateModal);
        }

        var clearBtn = document.getElementById('clear-schedule-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearSchedule);
        }

        var saveRestBtn = document.getElementById('save-rest-days-btn');
        if (saveRestBtn) {
            saveRestBtn.addEventListener('click', saveRestDays);
        }
    }

    function renderStudentSchedule() {
        var grid = document.getElementById('schedule-grid');
        if (!grid) return;

        var weekDisplay = document.getElementById('schedule-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        var select = document.getElementById('schedule-student');
        if (select && select.value) {
            state.selectedStudentId = select.value;
        }

        if (!state.selectedStudentId) {
            var dayColumns = grid.querySelectorAll('.day-column');
            dayColumns.forEach(function(col) {
                var slots = col.querySelector('.day-slots');
                if (slots) {
                    slots.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;">Select a trainee</div>';
                }
            });
            updateSidebarEmpty();
            return;
        }

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        var data = window.data || {};
        var restDays = data.curriculum && data.curriculum.restDays ? data.curriculum.restDays[state.currentWeek] || [] : [];
        var availableDisciplines = getAvailableDisciplinesForStudent(state.selectedStudentId, state.currentWeek);

        var hours = [];
        for (var h = 5; h <= 23; h++) {
            hours.push(h);
        }

        var dayColumns = grid.querySelectorAll('.day-column');
        dayColumns.forEach(function(column, index) {
            var day = index + 1;
            var slots = column.querySelector('.day-slots');
            if (!slots) return;

            var isRestDay = restDays.indexOf(day) !== -1;
            column.classList.toggle('rest-day', isRestDay);

            slots.innerHTML = '';

            if (isRestDay) {
                var restMsg = document.createElement('div');
                restMsg.className = 'empty-state';
                restMsg.style.padding = '20px';
                restMsg.style.textAlign = 'center';
                restMsg.textContent = '🛑 Rest Day';
                slots.appendChild(restMsg);
                if (schedule[day]) {
                    delete schedule[day];
                }
                return;
            }

            var occupiedHours = {};

            hours.forEach(function(hour) {
                if (occupiedHours[hour]) {
                    return;
                }

                var slot = document.createElement('div');
                slot.className = 'time-slot';
                slot.dataset.day = day;
                slot.dataset.hour = hour;

                var timeLabel = document.createElement('span');
                timeLabel.className = 'slot-time';
                var hourDisplay = hour > 12 ? hour - 12 : hour;
                var ampm = hour >= 12 ? 'PM' : 'AM';
                if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                if (hour === 12) { ampm = 'PM'; }
                timeLabel.textContent = hourDisplay + ':00 ' + ampm;
                slot.appendChild(timeLabel);

                var disciplineId = null;
                if (schedule[day] && schedule[day][hour]) {
                    disciplineId = schedule[day][hour];
                }

                if (disciplineId) {
                    var discipline = window.getDiscipline(disciplineId);
                    if (discipline) {
                        var duration = window.getClassDuration(state.selectedStudentId, state.currentWeek, day, hour) || 1;

                        for (var h = hour; h < hour + duration && h <= 23; h++) {
                            occupiedHours[h] = true;
                        }

                        slot.classList.add('occupied');
                        slot.style.minHeight = (30 * duration) + 'px';
                        slot.style.height = (30 * duration) + 'px';
                        if (duration > 1) {
                            slot.classList.add('duration-' + duration);
                        }

                        var instructorId = window.getClassInstructor(state.selectedStudentId, state.currentWeek, day, hour);
                        var instructorName = '';
                        if (instructorId) {
                            var instructor = window.getCharacterById(instructorId);
                            if (instructor) {
                                instructorName = window.getDisplayName(instructor);
                            }
                        }

                        var label = window.getClassLabel(state.selectedStudentId, state.currentWeek, day, hour);
                        var groupLabel = window.getClassGroupLabel(state.selectedStudentId, state.currentWeek, day, hour);

                        var labelDisplay = label ? ' [' + label + ']' : '';
                        var groupDisplay = groupLabel ? ' (G' + groupLabel + ')' : '';
                        var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';

                        var labelEl = document.createElement('span');
                        labelEl.className = 'slot-label';
                        labelEl.textContent = discipline.name + labelDisplay + groupDisplay + durationDisplay + (instructorName ? ' (' + instructorName + ')' : '');
                        slot.appendChild(labelEl);

                        slot.addEventListener('click', (function(discId, d, h) {
                            return function() {
                                showScheduleClassDetails(state.selectedStudentId, discId, state.currentWeek, d, h);
                            };
                        })(disciplineId, day, hour));

                        slot.addEventListener('contextmenu', function(e) {
                            e.preventDefault();
                            if (confirm('Remove this class from the schedule?')) {
                                removeScheduleClass(state.selectedStudentId, state.currentWeek, day, hour);
                            }
                        });
                    } else {
                        slot.classList.add('empty');
                        var labelEl = document.createElement('span');
                        labelEl.className = 'slot-label';
                        labelEl.textContent = '?';
                        slot.appendChild(labelEl);
                        occupiedHours[hour] = true;
                    }
                } else {
                    slot.classList.add('empty');
                    var labelEl = document.createElement('span');
                    labelEl.className = 'slot-label';
                    labelEl.textContent = '+';
                    slot.appendChild(labelEl);

                    slot.addEventListener('click', function() {
                        showAddScheduleClassModal(state.selectedStudentId, state.currentWeek, day, hour);
                    });
                }

                slots.appendChild(slot);
            });
        });

        updateScheduleSidebar();
    }

    function updateScheduleSidebar() {
        if (!state.selectedStudentId) {
            updateSidebarEmpty();
            return;
        }

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        var available = getAvailableDisciplinesForStudent(state.selectedStudentId, state.currentWeek);
        var data = window.data || {};
        var restDays = data.curriculum && data.curriculum.restDays ? data.curriculum.restDays[state.currentWeek] || [] : [];

        var overview = document.getElementById('schedule-overview');
        if (overview) {
            var classList = [];
            for (var day in schedule) {
                for (var hour in schedule[day]) {
                    var discId = schedule[day][hour];
                    if (discId) {
                        var discipline = window.getDiscipline(discId);
                        if (discipline) {
                            var instructorId = window.getClassInstructor(state.selectedStudentId, state.currentWeek, parseInt(day), parseInt(hour));
                            var instructorName = '';
                            if (instructorId) {
                                var instructor = window.getCharacterById(instructorId);
                                if (instructor) {
                                    instructorName = window.getDisplayName(instructor);
                                }
                            }
                            var label = window.getClassLabel(state.selectedStudentId, state.currentWeek, parseInt(day), parseInt(hour));
                            var groupLabel = window.getClassGroupLabel(state.selectedStudentId, state.currentWeek, parseInt(day), parseInt(hour));
                            var labelDisplay = label ? ' [' + label + ']' : '';
                            var groupDisplay = groupLabel ? ' (G' + groupLabel + ')' : '';
                            var duration = window.getClassDuration(state.selectedStudentId, state.currentWeek, parseInt(day), parseInt(hour));
                            var durationDisplay = duration && duration > 1 ? ' (' + duration + 'h)' : '';
                            classList.push({
                                day: parseInt(day),
                                hour: parseInt(hour),
                                name: discipline.name + labelDisplay + groupDisplay + durationDisplay,
                                instructor: instructorName
                            });
                        }
                    }
                }
            }

            if (classList.length === 0) {
                overview.innerHTML = '<p class="empty-state">No classes scheduled</p>';
            } else {
                var dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                classList.sort(function(a, b) {
                    if (a.day !== b.day) return a.day - b.day;
                    return a.hour - b.hour;
                });
                var html = '';
                classList.forEach(function(cls) {
                    var hourDisplay = cls.hour > 12 ? cls.hour - 12 : cls.hour;
                    var ampm = cls.hour >= 12 ? 'PM' : 'AM';
                    if (cls.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                    if (cls.hour === 12) { ampm = 'PM'; }
                    html += '<div class="activity-item">' +
                        dayNames[cls.day] + ' ' + hourDisplay + ':00 ' + ampm +
                        ' - <strong>' + cls.name + '</strong>' +
                        (cls.instructor ? ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + cls.instructor + ')</span>' : '') +
                    '</div>';
                });
                overview.innerHTML = html;
            }
        }

        var availContainer = document.getElementById('schedule-available');
        if (availContainer) {
            if (available.length === 0) {
                availContainer.innerHTML = '<p class="empty-state">All disciplines are full for this week</p>';
            } else {
                var html = '';
                available.forEach(function(item) {
                    var disc = item.discipline;
                    var instructorDisplay = item.instructorNames.length > 0 ?
                        item.instructorNames.join(', ') : 'No instructors assigned';
                    var isFull = item.remaining === 0;
                    html += '<div class="available-discipline' + (isFull ? ' full' : '') + '" style="cursor:pointer;" data-discipline="' + disc.id + '">' +
                        '<span>' + disc.name + ' <span style="font-size:0.6rem;color:var(--text-dim);">(' + instructorDisplay + ')</span></span>' +
                        '<span class="hours">' + item.used + '/' + item.maxHours + 'h</span>' +
                    '</div>';
                });
                availContainer.innerHTML = html;

                availContainer.querySelectorAll('.available-discipline').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var disciplineId = this.dataset.discipline;
                        if (state.selectedStudentId) {
                            showAvailableTimeSlotsModal(disciplineId, state.selectedStudentId, state.currentWeek);
                        }
                    });
                });
            }
        }

        var usedEl = document.getElementById('schedule-hours-used');
        var totalEl = document.getElementById('schedule-hours-total');
        if (usedEl && totalEl) {
            var totalHours = 0;
            var usedHours = 0;
            var allDisciplines = window.getAvailableDisciplines(state.currentWeek);
            allDisciplines.forEach(function(d) {
                totalHours += d.weeklyHours || 0;
            });
            var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
            for (var day in schedule) {
                for (var hour in schedule[day]) {
                    if (schedule[day][hour]) usedHours++;
                }
            }
            usedEl.textContent = usedHours;
            totalEl.textContent = totalHours;
        }

        var checkboxes = document.querySelectorAll('.rest-day-check');
        checkboxes.forEach(function(cb) {
            var day = parseInt(cb.dataset.day);
            cb.checked = restDays.indexOf(day) !== -1;
        });
    }

    function updateSidebarEmpty() {
        var overview = document.getElementById('schedule-overview');
        if (overview) {
            overview.innerHTML = '<p class="empty-state">Select a trainee</p>';
        }
        var availContainer = document.getElementById('schedule-available');
        if (availContainer) {
            availContainer.innerHTML = '<p class="empty-state">Select a trainee</p>';
        }
        var usedEl = document.getElementById('schedule-hours-used');
        var totalEl = document.getElementById('schedule-hours-total');
        if (usedEl) usedEl.textContent = '0';
        if (totalEl) totalEl.textContent = '0';
    }

    function getAvailableDisciplinesForStudent(studentId, week) {
        var allDisciplines = window.getAvailableDisciplines(week);
        var used = getStudentDisciplineHours(studentId, week);
        var available = [];
        var weekNum = parseInt(week) || 1;

        allDisciplines.forEach(function(d) {
            var usedCount = used[d.id] || 0;
            var maxHours = d.weeklyHours || 1;
            if (usedCount < maxHours) {
                var instructors = [];
                if (d.instructorIds) {
                    d.instructorIds.forEach(function(id) {
                        var instructor = window.getCharacterById(id);
                        if (instructor) {
                            instructors.push(window.getDisplayName(instructor));
                        }
                    });
                }
                available.push({
                    discipline: d,
                    used: usedCount,
                    maxHours: maxHours,
                    remaining: maxHours - usedCount,
                    instructorIds: d.instructorIds || [],
                    instructorNames: instructors
                });
            }
        });
        return available;
    }

    function getStudentDisciplineHours(studentId, week) {
        var schedule = window.getStudentSchedule(studentId, week);
        var disciplineHours = {};
        for (var day in schedule) {
            for (var hour in schedule[day]) {
                var discId = schedule[day][hour];
                if (discId) {
                    if (!disciplineHours[discId]) disciplineHours[discId] = 0;
                    disciplineHours[discId]++;
                }
            }
        }
        return disciplineHours;
    }

    function showAddScheduleClassModal(studentId, week, day, hour) {
        var available = getAvailableDisciplinesForStudent(studentId, week);

        if (available.length === 0) {
            alert('All disciplines are full for this week.');
            return;
        }

        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3>Add Class - ${dayNames[day]} at ${hourDisplay}:00 ${ampm}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Select Discipline:</label>
                        <select id="add-class-select" style="width:100%;padding:8px;margin-bottom:8px;">
                            ${available.map(function(item) {
                                var d = item.discipline;
                                var instructorDisplay = item.instructorNames.length > 0 ?
                                    item.instructorNames.join(', ') : 'No instructors assigned';
                                return '<option value="' + d.id + '">' +
                                    d.name + ' (' + instructorDisplay + ')' +
                                '</option>';
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
                alert('Please select a discipline.');
                return;
            }

            var duration = parseInt(document.getElementById('add-class-duration').value) || 1;
            var weekNum = parseInt(week) || 1;

            var discipline = window.getDiscipline(disciplineId);
            var instructorId = null;
            if (discipline && discipline.instructorIds && discipline.instructorIds.length > 0) {
                instructorId = discipline.instructorIds[0];
            }

            var schedule = window.getStudentSchedule(studentId, weekNum);
            var hasConflict = false;
            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (schedule[day] && schedule[day][h]) {
                    hasConflict = true;
                    break;
                }
            }

            if (hasConflict) {
                alert('Student already has a class at this time.');
                return;
            }

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (!schedule[day]) schedule[day] = {};
                schedule[day][h] = disciplineId;
                if (instructorId) {
                    window.setClassInstructor(studentId, weekNum, day, h, instructorId);
                }
                if (h === hour) {
                    window.setClassDuration(studentId, weekNum, day, h, duration);
                }
            }

            modal.remove();
            if (typeof window.saveData === 'function') {
                window.saveData().then(function() {
                    if (typeof window.logActivity === 'function') {
                        window.logActivity('Added ' + (discipline ? discipline.name : '') + ' to schedule');
                    }
                    renderStudentSchedule();
                    if (typeof window.renderAutoGroups === 'function') {
                        window.renderAutoGroups();
                    }
                    alert('Class added successfully!');
                }).catch(function(err) {
                    renderStudentSchedule();
                    alert('Class added but failed to save data.');
                });
            } else {
                renderStudentSchedule();
                alert('Class added successfully!');
            }
        };
    }

    function showScheduleClassDetails(studentId, disciplineId, week, day, hour) {
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) return;

        var instructorId = window.getClassInstructor(studentId, week, day, hour);
        var instructorName = 'Not assigned';
        if (instructorId) {
            var instructor = window.getCharacterById(instructorId);
            if (instructor) {
                instructorName = window.getDisplayName(instructor);
            }
        }

        var duration = window.getClassDuration(studentId, week, day, hour) || 1;
        var label = window.getClassLabel(studentId, week, day, hour) || '';
        var groupLabel = window.getClassGroupLabel(studentId, week, day, hour) || '';

        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${dayNames[day]} at ${hourDisplay}:00 ${ampm}</span></div>
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
                removeScheduleClass(studentId, week, day, hour);
                modal.remove();
            }
        };
    }

    function removeScheduleClass(studentId, week, day, hour) {
        var schedule = window.getStudentSchedule(studentId, week);
        var duration = window.getClassDuration(studentId, week, day, hour) || 1;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day] && schedule[day][h]) {
                delete schedule[day][h];
                window.setClassInstructor(studentId, week, day, h, null);
                window.setClassLabel(studentId, week, day, h, null);
                window.setClassGroupLabel(studentId, week, day, h, null);
                window.setClassDuration(studentId, week, day, h, null);
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderStudentSchedule();
        if (typeof window.logActivity === 'function') {
            window.logActivity('Removed class from schedule');
        }
    }

    function showAvailableTimeSlotsModal(disciplineId, studentId, week) {
        var discipline = window.getDiscipline(disciplineId);
        if (!discipline) {
            alert('Discipline not found.');
            return;
        }

        var weekNum = parseInt(week) || state.currentWeek || 1;
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
                        Click on a time slot to add this class.
                    </p>
                    <div style="max-height:300px;overflow-y:auto;" id="time-slots-list">
                        <p class="empty-state">No available slots</p>
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

        var slotsList = document.getElementById('time-slots-list');
        var slotsHtml = '';
        var foundSlots = false;

        var schedule = window.getStudentSchedule(studentId, weekNum);
        for (var d = 1; d <= 7; d++) {
            for (var h = 8; h <= 20; h++) {
                var hasClass = schedule[d] && schedule[d][h];
                if (!hasClass) {
                    foundSlots = true;
                    var hourDisplay = h > 12 ? h - 12 : h;
                    var ampm = h >= 12 ? 'PM' : 'AM';
                    if (h === 0) { hourDisplay = 12; ampm = 'AM'; }
                    if (h === 12) { ampm = 'PM'; }
                    slotsHtml += '<div style="padding:6px 10px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;">';
                    slotsHtml += '<span>' + dayNames[d] + ' at ' + hourDisplay + ':00 ' + ampm + '</span>';
                    slotsHtml += '<button class="add-to-slot-btn primary small" data-day="' + d + '" data-hour="' + h + '">Add</button>';
                    slotsHtml += '</div>';
                }
            }
        }

        if (foundSlots) {
            slotsList.innerHTML = slotsHtml;
            slotsList.querySelectorAll('.add-to-slot-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var day = parseInt(this.dataset.day);
                    var hour = parseInt(this.dataset.hour);
                    var duration = 1;

                    var discipline = window.getDiscipline(disciplineId);
                    var instructorId = null;
                    if (discipline && discipline.instructorIds && discipline.instructorIds.length > 0) {
                        instructorId = discipline.instructorIds[0];
                    }

                    var schedule = window.getStudentSchedule(studentId, weekNum);
                    var hasConflict = false;
                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h]) {
                            hasConflict = true;
                            break;
                        }
                    }

                    if (hasConflict) {
                        alert('Student already has a class at this time.');
                        return;
                    }

                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][h] = disciplineId;
                        if (instructorId) {
                            window.setClassInstructor(studentId, weekNum, day, h, instructorId);
                        }
                        if (h === hour) {
                            window.setClassDuration(studentId, weekNum, day, h, duration);
                        }
                    }

                    modal.remove();
                    if (typeof window.saveData === 'function') {
                        window.saveData().then(function() {
                            renderStudentSchedule();
                            if (typeof window.renderAutoGroups === 'function') {
                                window.renderAutoGroups();
                            }
                            alert('Class added successfully!');
                        }).catch(function(err) {
                            renderStudentSchedule();
                            alert('Class added but failed to save.');
                        });
                    } else {
                        renderStudentSchedule();
                        alert('Class added successfully!');
                    }
                });
            });
        } else {
            slotsList.innerHTML = '<p class="empty-state">No available time slots for this discipline this week.</p>';
        }
    }

    function showDuplicateModal() {
        if (!state.selectedStudentId) {
            alert('Please select a trainee first.');
            return;
        }

        var currentWeek = state.currentWeek;

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <div class="modal-header">
                    <h3>Duplicate Schedule</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;">
                        Copy schedule from <strong>Week ${currentWeek}</strong> to:
                    </p>
                    <div class="form-group">
                        <label>Target Week:</label>
                        <input type="number" id="duplicate-target-week" min="1" max="52" value="${currentWeek + 1}" style="width:100%;padding:8px;">
                    </div>
                    <div style="margin-top:8px;font-size:0.75rem;color:var(--text-dim);">
                        <label><input type="checkbox" id="duplicate-overwrite" checked> Overwrite existing schedule</label>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-duplicate" class="secondary">Cancel</button>
                        <button type="button" id="confirm-duplicate" class="primary">Duplicate</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-duplicate').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-duplicate').onclick = function() {
            var targetWeek = parseInt(document.getElementById('duplicate-target-week').value);
            var overwrite = document.getElementById('duplicate-overwrite').checked;

            if (isNaN(targetWeek) || targetWeek < 1 || targetWeek > 52) {
                alert('Please enter a valid week (1-52).');
                return;
            }

            if (targetWeek === currentWeek) {
                alert('Target week cannot be the same as the current week.');
                return;
            }

            duplicateScheduleToWeek(currentWeek, targetWeek, overwrite);
            modal.remove();
        };
    }

    function duplicateScheduleToWeek(sourceWeek, targetWeek, overwrite) {
        if (!state.selectedStudentId) {
            alert('Please select a trainee first.');
            return;
        }

        var studentId = state.selectedStudentId;

        var targetSchedule = window.getStudentSchedule(studentId, targetWeek);
        var hasData = false;
        for (var day in targetSchedule) {
            for (var hour in targetSchedule[day]) {
                if (targetSchedule[day][hour]) {
                    hasData = true;
                    break;
                }
            }
            if (hasData) break;
        }

        if (hasData && !overwrite) {
            if (!confirm('Week ' + targetWeek + ' already has classes. Overwrite?')) {
                return;
            }
        }

        var sourceSchedule = window.getStudentSchedule(studentId, sourceWeek);
        var destSchedule = window.getStudentSchedule(studentId, targetWeek);

        if (overwrite) {
            for (var day in destSchedule) {
                delete destSchedule[day];
            }
        }

        var copiedCount = 0;
        for (var day in sourceSchedule) {
            if (!destSchedule[day]) destSchedule[day] = {};
            for (var hour in sourceSchedule[day]) {
                if (!destSchedule[day][hour] || overwrite) {
                    destSchedule[day][hour] = sourceSchedule[day][hour];
                    var instructorId = window.getClassInstructor(studentId, sourceWeek, parseInt(day), parseInt(hour));
                    if (instructorId) {
                        window.setClassInstructor(studentId, targetWeek, parseInt(day), parseInt(hour), instructorId);
                    }
                    var label = window.getClassLabel(studentId, sourceWeek, parseInt(day), parseInt(hour));
                    if (label) {
                        window.setClassLabel(studentId, targetWeek, parseInt(day), parseInt(hour), label);
                    }
                    var groupLabel = window.getClassGroupLabel(studentId, sourceWeek, parseInt(day), parseInt(hour));
                    if (groupLabel) {
                        window.setClassGroupLabel(studentId, targetWeek, parseInt(day), parseInt(hour), groupLabel);
                    }
                    var duration = window.getClassDuration(studentId, sourceWeek, parseInt(day), parseInt(hour));
                    if (duration) {
                        window.setClassDuration(studentId, targetWeek, parseInt(day), parseInt(hour), duration);
                    }
                    copiedCount++;
                }
            }
        }

        var data = window.data || {};
        if (data.curriculum && data.curriculum.restDays && data.curriculum.restDays[sourceWeek]) {
            if (overwrite || !data.curriculum.restDays[targetWeek]) {
                if (!data.curriculum.restDays) data.curriculum.restDays = {};
                data.curriculum.restDays[targetWeek] = data.curriculum.restDays[sourceWeek].slice();
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Duplicated schedule from week ' + sourceWeek + ' to ' + targetWeek + ' (' + copiedCount + ' classes)');
                }
                state.currentWeek = targetWeek;
                renderStudentSchedule();
                alert('Schedule duplicated from week ' + sourceWeek + ' to week ' + targetWeek + ' (' + copiedCount + ' classes copied)');
            }).catch(function(err) {
                alert('Failed to duplicate schedule.');
            });
        } else {
            state.currentWeek = targetWeek;
            renderStudentSchedule();
            alert('Schedule duplicated from week ' + sourceWeek + ' to week ' + targetWeek + ' (' + copiedCount + ' classes copied)');
        }
    }

    function clearSchedule() {
        if (!state.selectedStudentId) {
            alert('Please select a trainee first.');
            return;
        }

        if (!confirm('Clear all classes for week ' + state.currentWeek + '?')) return;

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        for (var day in schedule) {
            delete schedule[day];
        }

        var week = state.currentWeek;
        var data = window.data || {};
        if (data.curriculum && data.curriculum.classInstructors) {
            for (var key in data.curriculum.classInstructors) {
                var parts = key.split('_');
                if (parts[1] == week) {
                    delete data.curriculum.classInstructors[key];
                }
            }
        }
        if (data.curriculum && data.curriculum.classLabels) {
            for (var key in data.curriculum.classLabels) {
                var parts = key.split('_');
                if (parts[1] == week) {
                    delete data.curriculum.classLabels[key];
                }
            }
        }
        if (data.curriculum && data.curriculum.classGroupLabels) {
            for (var key in data.curriculum.classGroupLabels) {
                var parts = key.split('_');
                if (parts[1] == week) {
                    delete data.curriculum.classGroupLabels[key];
                }
            }
        }
        if (data.curriculum && data.curriculum.classDurations) {
            for (var key in data.curriculum.classDurations) {
                var parts = key.split('_');
                if (parts[1] == week) {
                    delete data.curriculum.classDurations[key];
                }
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Cleared schedule for week ' + state.currentWeek);
                }
                renderStudentSchedule();
            }).catch(function(err) {
                renderStudentSchedule();
            });
        } else {
            renderStudentSchedule();
        }
    }

    function saveRestDays() {
        if (!state.selectedStudentId) {
            alert('Please select a trainee first.');
            return;
        }

        var checkboxes = document.querySelectorAll('.rest-day-check');
        var restDays = [];
        checkboxes.forEach(function(cb) {
            if (cb.checked) {
                restDays.push(parseInt(cb.dataset.day));
            }
        });

        var data = window.data || {};
        if (!data.curriculum) data.curriculum = {};
        if (!data.curriculum.restDays) data.curriculum.restDays = {};
        data.curriculum.restDays[state.currentWeek] = restDays;

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        restDays.forEach(function(day) {
            if (schedule[day]) {
                delete schedule[day];
            }
        });

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Saved rest days for week ' + state.currentWeek + ' and removed classes on rest days');
                }
                renderStudentSchedule();
            }).catch(function(err) {
                renderStudentSchedule();
            });
        } else {
            renderStudentSchedule();
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.studentSchedule = state;
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('schedule-content');
        if (container && container.style.display !== 'none') {
            renderStudentScheduleView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'schedule') {
            var container = document.getElementById('schedule-content');
            if (container) {
                renderStudentScheduleView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('schedule-content');
            if (container && container.style.display !== 'none') {
                renderStudentScheduleView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderStudentScheduleView = renderStudentScheduleView;
    window.renderStudentSchedule = renderStudentSchedule;
    window.initStudentScheduleEvents = initStudentScheduleEvents;
    window.populateStudentSelector = populateStudentSelector;
    window.getAvailableDisciplinesForStudent = getAvailableDisciplinesForStudent;
    window.getStudentDisciplineHours = getStudentDisciplineHours;
    window.showAddScheduleClassModal = showAddScheduleClassModal;
    window.showScheduleClassDetails = showScheduleClassDetails;
    window.showAvailableTimeSlotsModal = showAvailableTimeSlotsModal;
    window.removeScheduleClass = removeScheduleClass;
    window.duplicateScheduleToWeek = duplicateScheduleToWeek;
    window.clearSchedule = clearSchedule;
    window.saveRestDays = saveRestDays;
    window.studentScheduleState = state;

    console.log('schedule.js loaded');

})();
