/**
 * js/modules/curriculum/location-schedule.js - Location Schedule
 * Path: js/modules/curriculum/location-schedule.js
 */

(function() {
    'use strict';

    if (window.__locationScheduleLoaded) return;
    window.__locationScheduleLoaded = true;

    var state = {
        currentWeek: 1,
        selectedLocationId: null
    };

    function renderLocationSchedule(container) {
        if (!container) {
            container = document.getElementById('location-schedule-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading location schedule...</p>';
            return;
        }

        if (!window.data.locations) {
            window.data.locations = [];
        }
        if (!window.data.locationSchedules) {
            window.data.locationSchedules = {};
        }

        container.innerHTML = getLocationScheduleHTML();
        populateLocationSelector();
        renderScheduleData();
        initLocationScheduleEvents();
    }

    function getLocationScheduleHTML() {
        return `
            <div class="page-header">
                <h2>Location Schedule</h2>
                <div style="display:flex;gap:8px;">
                    <button id="clear-location-schedule-btn" class="danger small">✕ Clear Week</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="location-selector">
                    <label for="location-schedule-select">Location:</label>
                    <select id="location-schedule-select">
                        <option value="">Select a location...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="prev-location-week" class="small">← Prev</button>
                    <span id="location-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-location-week" class="small">Next →</button>
                    <button id="goto-location-week" class="small primary">Go to Week</button>
                </div>
            </div>
            <div class="schedule-grid-wrapper" id="location-grid-wrapper">
                <div class="schedule-grid" id="location-grid">
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
            <div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);text-align:center;">
                Click a slot to assign a class • Right-click to remove
            </div>
        `;
    }

    function populateLocationSelector() {
        var select = document.getElementById('location-schedule-select');
        if (!select) return;

        var locations = window.data.locations || [];
        var currentValue = select.value;

        select.innerHTML = '<option value="">Select a location...</option>';
        locations.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });
        locations.forEach(function(loc) {
            var option = document.createElement('option');
            option.value = loc.id;
            var typeLabels = {
                'indoor': 'Indoor',
                'outdoor': 'Outdoor',
                'pool': 'Pool',
                'classroom': 'Classroom',
                'lab': 'Lab',
                'field': 'Field',
                'other': 'Other'
            };
            var typeLabel = typeLabels[loc.type] || loc.type || 'Other';
            option.textContent = loc.name + ' (' + typeLabel + ')';
            select.appendChild(option);
        });

        if (currentValue && select.querySelector('option[value="' + currentValue + '"]')) {
            select.value = currentValue;
        } else if (locations.length > 0) {
            select.selectedIndex = 1;
            state.selectedLocationId = select.value;
        }
    }

    function renderScheduleData() {
        var grid = document.getElementById('location-grid');
        if (!grid) return;

        var weekDisplay = document.getElementById('location-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        var select = document.getElementById('location-schedule-select');
        if (select && select.value) {
            state.selectedLocationId = select.value;
        }

        if (!state.selectedLocationId) {
            var dayColumns = grid.querySelectorAll('.day-column');
            dayColumns.forEach(function(col) {
                var slots = col.querySelector('.day-slots');
                if (slots) {
                    slots.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;">Select a location</div>';
                }
            });
            return;
        }

        var week = state.currentWeek;
        var locationId = state.selectedLocationId;
        var schedule = getLocationSchedule(locationId, week);

        var hours = [];
        for (var h = 5; h <= 23; h++) {
            hours.push(h);
        }

        var dayColumns = grid.querySelectorAll('.day-column');
        dayColumns.forEach(function(column, index) {
            var day = index + 1;
            var slots = column.querySelector('.day-slots');
            if (!slots) return;

            slots.innerHTML = '';
            var occupiedHours = {};

            hours.forEach(function(hour) {
                if (occupiedHours[hour]) return;

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
                        occupiedHours[hour] = true;

                        // Check if there's a duration
                        var duration = 1;
                        // Check if next hours have the same discipline
                        for (var h = hour + 1; h <= 23; h++) {
                            if (schedule[day] && schedule[day][h] === disciplineId) {
                                duration++;
                                occupiedHours[h] = true;
                            } else {
                                break;
                            }
                        }

                        slot.classList.add('occupied');
                        slot.style.minHeight = (30 * duration) + 'px';
                        slot.style.height = (30 * duration) + 'px';
                        if (duration > 1) {
                            slot.classList.add('duration-' + duration);
                        }

                        var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';

                        // Find which students are in this class at this location
                        var students = window.getStudents();
                        var studentNames = [];
                        students.forEach(function(student) {
                            var sched = window.getStudentSchedule(student.id, week);
                            // Check if this student has this class at this time and location
                            for (var d in sched) {
                                for (var h in sched[d]) {
                                    if (String(sched[d][h]) === String(disciplineId) && parseInt(d) === day && parseInt(h) === hour) {
                                        studentNames.push(window.getDisplayName(student));
                                        break;
                                    }
                                }
                            }
                        });

                        var labelEl = document.createElement('span');
                        labelEl.className = 'slot-label';
                        labelEl.textContent = discipline.name + durationDisplay + (studentNames.length > 0 ? ' - ' + studentNames.join(', ') : '');
                        slot.appendChild(labelEl);

                        slot.addEventListener('click', function() {
                            showAssignClassModal(day, hour, disciplineId);
                        });

                        slot.addEventListener('contextmenu', function(e) {
                            e.preventDefault();
                            if (confirm('Remove this class from this location?')) {
                                removeClassFromLocation(locationId, week, day, hour);
                            }
                        });

                    } else {
                        slot.classList.add('empty');
                        var labelEl = document.createElement('span');
                        labelEl.className = 'slot-label';
                        labelEl.textContent = '?';
                        slot.appendChild(labelEl);
                    }
                } else {
                    slot.classList.add('empty');
                    var labelEl = document.createElement('span');
                    labelEl.className = 'slot-label';
                    labelEl.textContent = '+';
                    slot.appendChild(labelEl);

                    slot.addEventListener('click', function() {
                        showAssignClassModal(day, hour);
                    });
                }

                slots.appendChild(slot);
            });
        });
    }

    function getLocationSchedule(locationId, week) {
        var data = window.data || {};
        if (!data.locationSchedules) {
            data.locationSchedules = {};
        }
        var key = locationId + '_' + week;
        if (!data.locationSchedules[key]) {
            data.locationSchedules[key] = {};
        }
        return data.locationSchedules[key];
    }

    function setLocationSchedule(locationId, week, day, hour, disciplineId) {
        var data = window.data || {};
        if (!data.locationSchedules) {
            data.locationSchedules = {};
        }
        var key = locationId + '_' + week;
        if (!data.locationSchedules[key]) {
            data.locationSchedules[key] = {};
        }
        if (!data.locationSchedules[key][day]) {
            data.locationSchedules[key][day] = {};
        }
        if (disciplineId) {
            data.locationSchedules[key][day][hour] = disciplineId;
        } else {
            delete data.locationSchedules[key][day][hour];
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    function showAssignClassModal(day, hour, existingDisciplineId) {
        if (!state.selectedLocationId) {
            alert('Please select a location first.');
            return;
        }

        var week = state.currentWeek;
        var locationId = state.selectedLocationId;
        var disciplines = window.getAvailableDisciplines(week);

        if (disciplines.length === 0) {
            alert('No disciplines available for week ' + week + '.');
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>${existingDisciplineId ? 'Change' : 'Assign'} Class - ${dayNames[day]} at ${hourDisplay}:00 ${ampm}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Discipline:</label>
                        <select id="assign-class-select" style="width:100%;padding:8px;margin-top:4px;">
                            <option value="">— None —</option>
                            ${disciplines.map(function(d) {
                                var selected = (existingDisciplineId && String(d.id) === String(existingDisciplineId)) ? 'selected' : '';
                                return '<option value="' + d.id + '" ' + selected + '>' + d.name + ' (' + (d.type || 'mandatory') + ')</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-assign-class" class="secondary">Cancel</button>
                        <button type="button" id="confirm-assign-class" class="primary">Assign</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-assign-class').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-assign-class').onclick = function() {
            var disciplineId = document.getElementById('assign-class-select').value;
            var schedule = getLocationSchedule(locationId, week);
            
            // If clearing
            if (!disciplineId) {
                if (schedule[day] && schedule[day][hour]) {
                    delete schedule[day][hour];
                }
                modal.remove();
                renderScheduleData();
                return;
            }

            // Check for conflicts
            var discipline = window.getDiscipline(disciplineId);
            var schedule = getLocationSchedule(locationId, week);
            var hasConflict = false;
            var conflictingHour = null;

            for (var h in schedule[day]) {
                if (parseInt(h) !== hour && schedule[day][h] === disciplineId) {
                    hasConflict = true;
                    conflictingHour = h;
                    break;
                }
            }

            if (hasConflict) {
                if (!confirm('This discipline is already scheduled at ' + dayNames[day] + ' ' + conflictingHour + ':00 in this location.\n\nAssign it here anyway? (This will move the class to this time)')) {
                    return;
                }
                // Remove from old time
                delete schedule[day][conflictingHour];
            }

            setLocationSchedule(locationId, week, day, hour, disciplineId);
            modal.remove();
            renderScheduleData();
            alert('Class assigned to location!');
        };
    }

    function removeClassFromLocation(locationId, week, day, hour) {
        var schedule = getLocationSchedule(locationId, week);
        if (schedule[day] && schedule[day][hour]) {
            delete schedule[day][hour];
            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }
            renderScheduleData();
        }
    }

    function clearLocationSchedule() {
        if (!state.selectedLocationId) {
            alert('Please select a location first.');
            return;
        }

        if (!confirm('Clear all classes from this location for week ' + state.currentWeek + '?')) return;

        var locationId = state.selectedLocationId;
        var week = state.currentWeek;
        var key = locationId + '_' + week;
        var data = window.data || {};
        if (data.locationSchedules) {
            delete data.locationSchedules[key];
            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }
        }
        renderScheduleData();
    }

    function initLocationScheduleEvents() {
        var select = document.getElementById('location-schedule-select');
        if (select) {
            select.addEventListener('change', function() {
                state.selectedLocationId = this.value;
                renderScheduleData();
            });
        }

        var prevBtn = document.getElementById('prev-location-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderScheduleData();
                }
            });
        }

        var nextBtn = document.getElementById('next-location-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderScheduleData();
                }
            });
        }

        var gotoBtn = document.getElementById('goto-location-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', state.currentWeek);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderScheduleData();
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }

        var clearBtn = document.getElementById('clear-location-schedule-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearLocationSchedule);
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('location-schedule', renderLocationSchedule);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('location-schedule-content');
        if (container && container.style.display !== 'none') {
            renderLocationSchedule(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'location-schedule') {
            var container = document.getElementById('location-schedule-content');
            if (container) {
                renderLocationSchedule(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('location-schedule-content');
            if (container && container.style.display !== 'none') {
                renderLocationSchedule(container);
            }
        }, 100);
    }

    window.renderLocationSchedule = renderLocationSchedule;
    window.renderScheduleData = renderScheduleData;
    window.getLocationSchedule = getLocationSchedule;
    window.setLocationSchedule = setLocationSchedule;
    window.showAssignClassModal = showAssignClassModal;
    window.removeClassFromLocation = removeClassFromLocation;
    window.clearLocationSchedule = clearLocationSchedule;
    window.populateLocationSelector = populateLocationSelector;
    window.initLocationScheduleEvents = initLocationScheduleEvents;
    window.locationScheduleState = state;

})();
