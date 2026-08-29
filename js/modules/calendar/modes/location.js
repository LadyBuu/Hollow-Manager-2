/**
 * js/modules/calendar/modes/location.js - Location Calendar Mode
 * Full implementation of location schedule calendar
 * Path: js/modules/calendar/modes/location.js
 * 
 * This module is responsible for:
 *   - Rendering location schedule grid
 *   - Assigning/removing classes from locations
 *   - Displaying which students are assigned to each location
 */

(function() {
    'use strict';

    if (window.__locationModeLoaded) {
        return;
    }
    window.__locationModeLoaded = true;

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
            { name: 'getLocations', fn: window.getLocations },
            { name: 'getLocationSchedule', fn: window.getLocationSchedule },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getStudentSchedule', fn: window.getStudentSchedule },
            { name: 'getClassLocation', fn: window.getClassLocation },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getCharacterById', fn: window.getCharacterById },
            { name: 'setLocationClass', fn: window.setLocationClass },
            { name: 'removeLocationClass', fn: window.removeLocationClass },
            { name: 'clearLocationSchedule', fn: window.clearLocationSchedule },
            { name: 'saveData', fn: window.saveData }
        ];

        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function') {
                missing.push(required[i].name);
            }
        }

        if (missing.length > 0) {
            console.warn('[LocationMode] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getLocations() {
        return typeof window.getLocations === 'function' ? window.getLocations() : [];
    }

    function getSchedule(state) {
        if (!state || !state.selectedId) {
            return {};
        }
        return typeof window.getLocationSchedule === 'function'
            ? window.getLocationSchedule(state.selectedId, state.week)
            : {};
    }

    function render(container, state) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Location calendar dependencies not loaded.</p>';
            return;
        }

        if (!state || !state.selectedId) {
            container.innerHTML = '<div class="empty-state">Select a location to view its schedule</div>';
            return;
        }

        renderLocationSchedule(container, state);
    }

    // ============================================================
    // RENDER LOCATION SCHEDULE
    // ============================================================

    function renderLocationSchedule(container, state) {
        var locationId = state.selectedId;
        var week = state.week;

        var schedule = window.getLocationSchedule(locationId, week);
        var location = getLocationById(locationId);
        var locationName = location ? location.name : 'Unknown';

        var allStudents = window.getStudents();

        var html = '<div class="location-schedule">';
        html += '<div class="location-header"><h3>' + locationName + ' - Week ' + week + '</h3></div>';
        html += getCalendarGridHTML(schedule, locationId, week, allStudents);
        html += '<div style="margin-top:12px;"><button id="clear-location-week" class="danger small">✕ Clear Week</button></div>';
        html += '</div>';

        container.innerHTML = html;

        // Bind events
        bindLocationEvents(container, locationId, week);
    }

    // ============================================================
    // CALENDAR GRID HTML
    // ============================================================

    function getCalendarGridHTML(schedule, locationId, week, allStudents) {
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

                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

                if (disciplineId) {
                    var discipline = window.getDiscipline(disciplineId);
                    
                    // Find duration by checking contiguous hours
                    var duration = 1;
                    for (var h = hour + 1; h <= CALENDAR_END_HOUR; h++) {
                        if (schedule[day] && String(schedule[day][h]) === String(disciplineId)) {
                            duration++;
                            occupiedHours[h] = true;
                        } else {
                            break;
                        }
                    }

                    // Find students assigned to this location
                    var studentNames = [];
                    allStudents.forEach(function(student) {
                        var classLocation = window.getClassLocation(student.id, week, day, hour);
                        if (classLocation && String(classLocation) === String(locationId)) {
                            var sched = window.getStudentSchedule(student.id, week);
                            if (sched[day] && String(sched[day][hour]) === String(disciplineId)) {
                                studentNames.push(window.getDisplayName(student));
                            }
                        }
                    });

                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var studentDisplay = studentNames.length > 0 ? ' - ' + studentNames.join(', ') : '';

                    html += '<div class="time-slot occupied" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + (discipline ? discipline.name : 'Unknown') + durationDisplay + studentDisplay + '</span>';
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

    function bindLocationEvents(container, locationId, week) {
        // Empty slots - click to assign class
        container.querySelectorAll('.time-slot.empty').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showAssignClassModal(locationId, week, day, hour, container);
            });
        });

        // Occupied slots - right-click to remove
        container.querySelectorAll('.time-slot.occupied').forEach(function(slot) {
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                showLocationClassDetailsModal(locationId, week, day, hour, container);
            });

            slot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);
                if (confirm('Remove this class from this location?')) {
                    removeLocationClass(locationId, week, day, hour, container);
                }
            });
        });

        // Clear week button
        var clearBtn = container.querySelector('#clear-location-week');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                if (confirm('Clear all classes from this location for week ' + week + '?')) {
                    clearLocationWeek(locationId, week, container);
                }
            });
        }
    }

    // ============================================================
    // ASSIGN CLASS MODAL
    // ============================================================

    function showAssignClassModal(locationId, week, day, hour, container) {
        var disciplines = window.getAvailableDisciplines(week);

        if (disciplines.length === 0) {
            showNotification('No disciplines available for week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = formatHour(hour);
        var location = getLocationById(locationId);
        var locationName = location ? location.name : 'Unknown';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>Assign Class - ${locationName} - ${DAY_NAMES[day]} at ${hourDisplay}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Discipline:</label>
                        <select id="assign-class-select" style="width:100%;padding:8px;margin-top:4px;">
                            <option value="">— None —</option>
                            ${disciplines.map(function(d) {
                                var instructorDisplay = '';
                                if (d.instructorIds && d.instructorIds.length > 0) {
                                    var instructorNames = d.instructorIds.map(function(id) {
                                        var inst = window.getCharacterById(id);
                                        return inst ? window.getDisplayName(inst) : 'Unknown';
                                    });
                                    instructorDisplay = ' (' + instructorNames.join(', ') + ')';
                                }
                                return '<option value="' + d.id + '">' + d.name + instructorDisplay + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-assign" class="secondary">Cancel</button>
                        <button type="button" id="confirm-assign" class="primary">Assign</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-assign').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-assign').onclick = function() {
            var disciplineId = document.getElementById('assign-class-select').value;

            if (!disciplineId) {
                // Remove existing class
                var removeResult = window.removeLocationClass(locationId, week, day, hour);
                if (removeResult && removeResult.success) {
                    modal.remove();
                    window.saveData()
                        .then(function() {
                            showNotification('Class removed from location.', 'success');
                            render(container, { selectedId: locationId, week: week });
                        })
                        .catch(function(err) {
                            console.error('Failed to save location change:', err);
                            showNotification('Class removed in memory, but persistence failed.', 'error');
                            render(container, { selectedId: locationId, week: week });
                        });
                } else {
                    showNotification(removeResult && removeResult.message ? removeResult.message : 'Failed to remove class.', 'error');
                }
                return;
            }

            var result = window.setLocationClass(locationId, week, day, hour, disciplineId);

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to assign class.', 'error');
                return;
            }

            modal.remove();
            window.saveData()
                .then(function() {
                    showNotification('Class assigned to location!', 'success');
                    render(container, { selectedId: locationId, week: week });
                })
                .catch(function(err) {
                    console.error('Failed to save location assignment:', err);
                    showNotification('Class assigned in memory, but persistence failed.', 'error');
                    render(container, { selectedId: locationId, week: week });
                });
        };
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    function showLocationClassDetailsModal(locationId, week, day, hour, container) {
        var schedule = window.getLocationSchedule(locationId, week);
        var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!disciplineId) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(disciplineId);
        var hourDisplay = formatHour(hour);

        // Find duration
        var duration = 1;
        for (var h = hour + 1; h <= CALENDAR_END_HOUR; h++) {
            if (schedule[day] && String(schedule[day][h]) === String(disciplineId)) {
                duration++;
            } else {
                break;
            }
        }

        // Find students
        var allStudents = window.getStudents();
        var studentNames = [];
        allStudents.forEach(function(student) {
            var classLocation = window.getClassLocation(student.id, week, day, hour);
            if (classLocation && String(classLocation) === String(locationId)) {
                var sched = window.getStudentSchedule(student.id, week);
                if (sched[day] && String(sched[day][hour]) === String(disciplineId)) {
                    studentNames.push(window.getDisplayName(student));
                }
            }
        });

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>${discipline ? discipline.name : 'Unknown'}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${DAY_NAMES[day]} at ${hourDisplay}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span><strong>${duration} hour${duration > 1 ? 's' : ''}</strong></span></div>
                    <div class="detail-row"><span class="label">Students:</span> <span><strong>${studentNames.length}</strong> - ${studentNames.join(', ') || 'None'}</span></div>
                    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-class-btn" class="danger small">✕ Remove from Location</button>
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
            if (confirm('Remove this class from this location?')) {
                modal.remove();
                removeLocationClass(locationId, week, day, hour, container);
            }
        };
    }

    // ============================================================
    // REMOVE CLASS
    // ============================================================

    function removeLocationClass(locationId, week, day, hour, container) {
        var result = window.removeLocationClass(locationId, week, day, hour);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to remove class.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                showNotification('Class removed from location.', 'success');
                render(container, { selectedId: locationId, week: week });
            })
            .catch(function(err) {
                console.error('Failed to save location removal:', err);
                showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: locationId, week: week });
            });
    }

    // ============================================================
    // CLEAR WEEK
    // ============================================================

    function clearLocationWeek(locationId, week, container) {
        var result = window.clearLocationSchedule(locationId, week);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to clear schedule.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                showNotification('Location schedule cleared!', 'success');
                render(container, { selectedId: locationId, week: week });
            })
            .catch(function(err) {
                console.error('Failed to save location clear:', err);
                showNotification('Location schedule cleared in memory, but persistence failed.', 'error');
                render(container, { selectedId: locationId, week: week });
            });
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getLocationById(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        var data = window.data || {};
        if (data.locations && Array.isArray(data.locations)) {
            return data.locations.find(function(l) { return String(l.id) === String(id); }) || null;
        }
        return null;
    }

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
            console.log('[LocationMode]', message);
        }
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('location', {
            label: 'Location',
            render: render,
            getEntities: getLocations,
            getEntityDisplayName: function(entity) {
                return entity.name || 'Unknown';
            },
            getData: getSchedule
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.LocationMode = {
        render: render,
        getLocations: getLocations,
        getSchedule: getSchedule
    };

})();
