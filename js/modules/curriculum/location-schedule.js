/**
 * js/modules/curriculum/location-schedule.js - Location Schedule Module
 * Handles location scheduling with weekly view
 * Path: js/modules/curriculum/location-schedule.js
 * 
 * This module is responsible for:
 *   - Rendering location schedule UI
 *   - Displaying classes by location and time
 *   - Assigning/removing classes from locations (delegates to core)
 *   - Displaying which students are assigned to each location slot
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed locally.
 *   - Persistence is coordinated through the central saveData() function.
 *   - This module calls saveData() after successful mutations.
 *   - Core functions do not perform persistence themselves.
 *   - Student-location relationships are explicit (via getClassLocation).
 *   - Student lookup is cached per render for performance.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * PERSISTENCE CONTRACT:
 *   UI → core mutation → window.data → saveData() → persistence
 *   saveData() is guaranteed to return a Promise.
 * 
 * ARCHITECTURAL NOTE:
 *   - Location schedules are stored as locationSchedules[locationId_week][day][hour] = disciplineId
 *   - Student-location assignments are stored explicitly in classLocations
 *   - The core represents multi-hour classes as repeated hourly entries.
 *   - Student assignments are per-hour; a 3-hour block shows students assigned at the start hour.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - getClassLocation() is a required core dependency for explicit student-location mapping.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Location schedule UI state
    // ============================================================

    var state = {
        currentWeek: 1,
        selectedLocationId: null
    };

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;

    // ============================================================
    // RENDER LOCATION SCHEDULE - Public API (only this is exposed)
    // ============================================================

    function renderLocationSchedule(container) {
        if (!container) {
            container = document.getElementById('location-schedule-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading location schedule...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[LocationSchedule] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        // Verify all core dependencies
        var requiredDeps = [
            { name: 'getLocations', fn: window.getLocations },
            { name: 'getLocationSchedule', fn: window.getLocationSchedule },
            { name: 'setLocationClass', fn: window.setLocationClass },
            { name: 'removeLocationClass', fn: window.removeLocationClass },
            { name: 'clearLocationSchedule', fn: window.clearLocationSchedule },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getClassLocation', fn: window.getClassLocation },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getCharacterById', fn: window.getCharacterById }
        ];

        for (var i = 0; i < requiredDeps.length; i++) {
            if (typeof requiredDeps[i].fn !== 'function') {
                console.error('[LocationSchedule] ' + requiredDeps[i].name + '() is not available.');
                container.innerHTML = '<p class="empty-state">Location schedule core module not loaded. Please refresh the page.</p>';
                return;
            }
        }

        container.innerHTML = getLocationScheduleHTML();
        populateLocationSelector();
        renderScheduleData();
        initLocationScheduleEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // LOCATION SCHEDULE HTML
    // ============================================================

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

    // ============================================================
    // POPULATE LOCATION SELECTOR
    // ============================================================

    function populateLocationSelector() {
        var select = document.getElementById('location-schedule-select');
        if (!select) return;

        var locations = window.getLocations();
        var sortedLocations = locations.slice().sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        select.innerHTML = '<option value="">Select a location...</option>';
        sortedLocations.forEach(function(loc) {
            var typeLabel = getTypeLabel(loc.type);
            var option = document.createElement('option');
            option.value = loc.id;
            option.textContent = loc.name + ' (' + typeLabel + ')';
            select.appendChild(option);
        });

        // Restore selection using state
        if (state.selectedLocationId) {
            var hasStoredValue = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === state.selectedLocationId) {
                    hasStoredValue = true;
                    break;
                }
            }
            if (hasStoredValue) {
                select.value = state.selectedLocationId;
            } else {
                state.selectedLocationId = null;
            }
        }

        if (!state.selectedLocationId && select.options.length > 1) {
            select.selectedIndex = 1;
            state.selectedLocationId = select.value;
        }
    }

    // ============================================================
    // TYPE LABELS
    // ============================================================

    var TYPE_LABELS = {
        'indoor': 'Indoor',
        'outdoor': 'Outdoor',
        'pool': 'Pool',
        'classroom': 'Classroom',
        'lab': 'Lab',
        'field': 'Field',
        'other': 'Other'
    };

    function getTypeLabel(type) {
        return TYPE_LABELS[type] || type || 'Other';
    }

    // ============================================================
    // RENDER SCHEDULE DATA
    // ============================================================

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

        var schedule = window.getLocationSchedule(locationId, week) || {};

        var allStudents = window.getStudents();
        var studentSchedules = {};
        allStudents.forEach(function(student) {
            studentSchedules[student.id] = window.getStudentSchedule(student.id, week) || {};
        });

        var hours = [];
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }

        var dayColumns = grid.querySelectorAll('.day-column');
        dayColumns.forEach(function(column) {
            var day = parseInt(column.dataset.day, 10);
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
                        var duration = 1;
                        for (var h = hour + 1; h <= CALENDAR_END_HOUR; h++) {
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

                        // Get students explicitly assigned to this location at the start hour
                        // Note: Student assignments are per-hour; a 3-hour block shows students
                        // assigned at the start hour (duration is a visual grouping only)
                        var studentNames = [];
                        allStudents.forEach(function(student) {
                            var sched = studentSchedules[student.id];
                            var assignedLocationId = window.getClassLocation(student.id, week, day, hour);

                            if (assignedLocationId !== null && assignedLocationId !== undefined) {
                                if (String(assignedLocationId) === String(locationId)) {
                                    if (sched[day] && String(sched[day][hour]) === String(disciplineId)) {
                                        studentNames.push(getSafeDisplayName(student));
                                    }
                                }
                            }
                        });

                        var labelEl = document.createElement('span');
                        labelEl.className = 'slot-label';
                        var labelText = discipline.name + durationDisplay;
                        if (studentNames.length > 0) {
                            labelText += ' - ' + studentNames.join(', ');
                        }
                        labelEl.textContent = labelText;
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

    // ============================================================
    // GET SAFE DISPLAY NAME
    // ============================================================

    function getSafeDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char && char.name ? char.name : 'Unknown';
    }

    // ============================================================
    // SHOW ASSIGN CLASS MODAL
    // ============================================================

    function showAssignClassModal(day, hour, existingDisciplineId) {
        if (!state.selectedLocationId) {
            showNotification('Please select a location first.', 'error');
            return;
        }

        var week = state.currentWeek;
        var locationId = state.selectedLocationId;
        var disciplines = window.getAvailableDisciplines(week);

        if (disciplines.length === 0) {
            showNotification('No disciplines available for week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>${existingDisciplineId ? 'Change' : 'Assign'} Class - ${DAY_NAMES[day]} at ${hourDisplay}:00 ${ampm}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Discipline:</label>
                        <select id="assign-class-select" style="width:100%;padding:8px;margin-top:4px;">
                            <option value="">— None —</option>
                            ${disciplines.map(function(d) {
                                var selected = (existingDisciplineId && String(d.id) === String(existingDisciplineId)) ? 'selected' : '';
                                var instructorDisplay = '';
                                if (d.instructorIds && d.instructorIds.length > 0) {
                                    var instructorNames = d.instructorIds.map(function(id) {
                                        var inst = window.getCharacterById(id);
                                        if (inst) {
                                            return escapeHtml(getSafeDisplayName(inst));
                                        }
                                        return 'Unknown';
                                    });
                                    instructorDisplay = ' (' + instructorNames.join(', ') + ')';
                                }
                                return '<option value="' + escapeHtml(d.id) + '" ' + selected + '>' +
                                    escapeHtml(d.name) + instructorDisplay +
                                '</option>';
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

            var schedule = window.getLocationSchedule(locationId, week) || {};
            if (schedule[day] && schedule[day][hour]) {
                if (!confirm('This location already has a class at this time. Overwrite?')) {
                    return;
                }
            }

            if (!disciplineId) {
                var clearResult = window.removeLocationClass(locationId, week, day, hour);
                if (clearResult && clearResult.success) {
                    modal.remove();
                    renderScheduleData();
                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification('Class removed from location.', 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save location change:', err);
                                showNotification('Class removed in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification('Class removed from location.', 'success');
                    }
                } else {
                    showNotification(clearResult && clearResult.message ? clearResult.message : 'Failed to remove class.', 'error');
                }
                return;
            }

            var discipline = window.getDiscipline(disciplineId);
            if (!discipline) {
                showNotification('Discipline not found.', 'error');
                return;
            }

            var result = window.setLocationClass(locationId, week, day, hour, disciplineId);

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to assign class.', 'error');
                return;
            }

            modal.remove();
            renderScheduleData();

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Class assigned to location!', 'success');
                    })
                    .catch(function(err) {
                        console.error('Failed to save location assignment:', err);
                        showNotification('Class assigned in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Class assigned to location!', 'success');
            }
        };
    }

    // ============================================================
    // REMOVE CLASS FROM LOCATION
    // ============================================================

    function removeClassFromLocation(locationId, week, day, hour) {
        var result = window.removeLocationClass(locationId, week, day, hour);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to remove class.', 'error');
            return;
        }

        renderScheduleData();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification('Class removed from location.', 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save location removal:', err);
                    showNotification('Class removed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification('Class removed from location.', 'success');
        }
    }

    // ============================================================
    // CLEAR LOCATION SCHEDULE
    // ============================================================

    function clearLocationSchedule() {
        if (!state.selectedLocationId) {
            showNotification('Please select a location first.', 'error');
            return;
        }

        if (!confirm('Clear all classes from this location for week ' + state.currentWeek + '?')) return;

        var locationId = state.selectedLocationId;
        var week = state.currentWeek;

        var result = window.clearLocationSchedule(locationId, week);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to clear schedule.', 'error');
            return;
        }

        renderScheduleData();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification('Location schedule cleared!', 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save location clear:', err);
                    showNotification('Location schedule cleared in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification('Location schedule cleared!', 'success');
        }
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

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
            console.log('[LocationSchedule]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initLocationScheduleEvents() {
        var select = document.getElementById('location-schedule-select');
        if (select) {
            // No clone needed - the select was just created, no existing listeners
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
                    var w = parseInt(week, 10);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderScheduleData();
                    } else {
                        showNotification('Please enter a valid week (1-52).', 'error');
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
    // REGISTER WITH CURRICULUM MAIN - NO INDEPENDENT LIFECYCLE
    // This module is rendered by curriculum-main.js via TabManager.
    // It does not independently listen for lifecycle events.
    // ============================================================

    // EXPOSE PUBLIC API
    window.renderLocationSchedule = renderLocationSchedule;

})();
