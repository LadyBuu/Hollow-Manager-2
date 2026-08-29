/**
 * js/modules/calendar/modes/location.js - Location Calendar Mode
 * Full implementation of location schedule calendar
 * Path: js/modules/calendar/modes/location.js
 * 
 * This module is responsible for:
 *   - Rendering location schedule grid
 *   - Assigning/removing classes from locations
 *   - Displaying which students are assigned to each location
 * 
 * IMPORTANT:
 *   - This module uses core functions for all mutations
 *   - No direct window.data mutations
 *   - Duration is retrieved from metadata, not inferred from repeated IDs
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

    if (window.__locationModeLoaded) {
        return;
    }
    window.__locationModeLoaded = true;

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

        if (typeof window.getLocations !== 'function') {
            missing.push('getLocations');
        }

        if (typeof window.getLocationSchedule !== 'function') {
            missing.push('getLocationSchedule');
        }

        if (typeof window.getAvailableDisciplines !== 'function') {
            missing.push('getAvailableDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getClassLocation !== 'function') {
            missing.push('getClassLocation');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.setLocationClass !== 'function') {
            missing.push('setLocationClass');
        }

        if (typeof window.removeLocationClass !== 'function') {
            missing.push('removeLocationClass');
        }

        if (typeof window.clearLocationSchedule !== 'function') {
            missing.push('clearLocationSchedule');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.getLocation !== 'function') {
            missing.push('getLocation');
        }

        if (missing.length > 0) {
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
    // GET LOCATION BY ID
    // ============================================================

    function getLocationById(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        var data = window.data || {};
        if (data.locations && Array.isArray(data.locations)) {
            for (var i = 0; i < data.locations.length; i++) {
                if (String(data.locations[i].id) === String(id)) {
                    return data.locations[i];
                }
            }
        }
        return null;
    }

    // ============================================================
    // RENDER LOCATION SCHEDULE
    // ============================================================

    function renderLocationSchedule(container, state) {
        var locationId = state.selectedId;
        var week = state.week;

        var schedule = window.getLocationSchedule(locationId, week) || {};
        var location = getLocationById(locationId);
        var locationName = location ? location.name : 'Unknown';

        var allStudents = window.getStudents() || [];

        var html = '<div class="location-schedule">';
        html += '<div class="location-header"><h3>' + escapeHtml(locationName) + ' - Week ' + week + '</h3></div>';
        html += getCalendarGridHTML(schedule, locationId, week, allStudents);
        html += '<div style="margin-top:12px;"><button id="clear-location-week" class="danger small">Clear Week</button></div>';
        html += '</div>';

        container.innerHTML = html;

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

            for (var i = 0; i < hours.length; i++) {
                var hour = hours[i];

                if (occupiedHours[hour]) {
                    continue;
                }

                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

                if (disciplineId) {
                    var discipline = window.getDiscipline(disciplineId);

                    // Get duration - prefer metadata, fallback to inference
                    var duration = 1;
                    if (typeof window.getLocationClassDuration === 'function') {
                        var metaDuration = window.getLocationClassDuration(locationId, week, day, hour);
                        if (metaDuration !== null && metaDuration !== undefined) {
                            duration = metaDuration;
                        }
                    }

                    // If no metadata, infer from contiguous schedule entries
                    if (duration === 1) {
                        for (var h2 = hour + 1; h2 <= CALENDAR_END_HOUR; h2++) {
                            if (schedule[day] && String(schedule[day][h2]) === String(disciplineId)) {
                                duration++;
                                occupiedHours[h2] = true;
                            } else {
                                break;
                            }
                        }
                    } else {
                        // Mark occupied hours based on metadata duration
                        for (var h3 = hour + 1; h3 < hour + duration && h3 <= CALENDAR_END_HOUR; h3++) {
                            occupiedHours[h3] = true;
                        }
                    }

                    // Find students assigned to this location
                    var studentNames = [];
                    for (var s = 0; s < allStudents.length; s++) {
                        var student = allStudents[s];
                        var classLocation = window.getClassLocation(student.id, week, day, hour);
                        if (classLocation && String(classLocation) === String(locationId)) {
                            var sched = window.getStudentSchedule(student.id, week) || {};
                            if (sched[day] && String(sched[day][hour]) === String(disciplineId)) {
                                studentNames.push(window.getDisplayName(student));
                            }
                        }
                    }

                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';
                    var studentDisplay = studentNames.length > 0 ? ' - ' + escapeHtml(studentNames.join(', ')) : '';
                    var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

                    html += '<div class="time-slot occupied" data-day="' + day + '" data-hour="' + hour + '" data-duration="' + duration + '" style="min-height:' + (30 * duration) + 'px;height:' + (30 * duration) + 'px;">';
                    html += '<span class="slot-time">' + CalendarUtils.formatHour(hour) + '</span>';
                    html += '<span class="slot-label">' + disciplineName + durationDisplay + studentDisplay + '</span>';
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

        return html;
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindLocationEvents(container, locationId, week) {
        var emptySlots = container.querySelectorAll('.time-slot.empty');
        for (var i = 0; i < emptySlots.length; i++) {
            var slot = emptySlots[i];
            slot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showAssignClassModal(locationId, week, day, hour, container);
            });
        }

        var occupiedSlots = container.querySelectorAll('.time-slot.occupied');
        for (var j = 0; j < occupiedSlots.length; j++) {
            var occSlot = occupiedSlots[j];
            occSlot.addEventListener('click', function() {
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                showLocationClassDetailsModal(locationId, week, day, hour, container);
            });

            occSlot.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                var day = parseInt(this.dataset.day, 10);
                var hour = parseInt(this.dataset.hour, 10);
                if (confirm('Remove this class from this location?')) {
                    removeLocationClass(locationId, week, day, hour, container);
                }
            });
        }

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
        var disciplines = window.getAvailableDisciplines(week) || [];

        if (disciplines.length === 0) {
            showNotification('No disciplines available for week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);
        var location = getLocationById(locationId);
        var locationName = location ? location.name : 'Unknown';

        var modal = document.createElement('div');
        modal.className = 'modal';

        var optionsHTML = '<option value="">-- None --</option>';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var instructorDisplay = '';
            if (d.instructorIds && d.instructorIds.length > 0) {
                var instructorNames = [];
                for (var j = 0; j < d.instructorIds.length; j++) {
                    var inst = window.getCharacterById(d.instructorIds[j]);
                    if (inst) {
                        instructorNames.push(window.getDisplayName(inst));
                    }
                }
                if (instructorNames.length > 0) {
                    instructorDisplay = ' (' + instructorNames.join(', ') + ')';
                }
            }
            optionsHTML += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + instructorDisplay + '</option>';
        }

        modal.innerHTML = (
            '<div class="modal-content" style="max-width:450px;">' +
                '<div class="modal-header">' +
                    '<h3>Assign Class - ' + escapeHtml(locationName) + ' - ' + escapeHtml(DAY_NAMES[day]) + ' at ' + escapeHtml(hourDisplay) + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Discipline:</label>' +
                        '<select id="assign-class-select" style="width:100%;padding:8px;margin-top:4px;">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="form-actions" style="margin-top:16px;">' +
                        '<button type="button" id="cancel-assign" class="secondary">Cancel</button>' +
                        '<button type="button" id="confirm-assign" class="primary">Assign</button>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        document.body.appendChild(modal);

        var closeModal = function() { modal.remove(); };
        modal.querySelector('.close-modal').onclick = closeModal;
        modal.querySelector('#cancel-assign').onclick = closeModal;
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#confirm-assign').onclick = function() {
            var select = document.getElementById('assign-class-select');
            var disciplineId = select ? select.value : null;

            if (!disciplineId) {
                var removeResult = window.removeLocationClass(locationId, week, day, hour);
                if (removeResult && removeResult.success) {
                    modal.remove();
                    window.saveData()
                        .then(function() {
                            showNotification('Class removed from location.', 'success');
                            render(container, { selectedId: locationId, week: week });
                        })
                        .catch(function() {
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
                    showNotification('Class assigned to location.', 'success');
                    render(container, { selectedId: locationId, week: week });
                })
                .catch(function() {
                    showNotification('Class assigned in memory, but persistence failed.', 'error');
                    render(container, { selectedId: locationId, week: week });
                });
        };
    }

    // ============================================================
    // CLASS DETAILS MODAL
    // ============================================================

    function showLocationClassDetailsModal(locationId, week, day, hour, container) {
        var schedule = window.getLocationSchedule(locationId, week) || {};
        var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!disciplineId) {
            showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(disciplineId);
        var hourDisplay = CalendarUtils.formatHour(hour);

        // Get duration - prefer metadata, fallback to inference
        var duration = 1;
        if (typeof window.getLocationClassDuration === 'function') {
            var metaDuration = window.getLocationClassDuration(locationId, week, day, hour);
            if (metaDuration !== null && metaDuration !== undefined) {
                duration = metaDuration;
            }
        }

        // If no metadata, infer from contiguous schedule entries
        if (duration === 1) {
            for (var h = hour + 1; h <= CALENDAR_END_HOUR; h++) {
                if (schedule[day] && String(schedule[day][h]) === String(disciplineId)) {
                    duration++;
                } else {
                    break;
                }
            }
        }

        // Find students
        var allStudents = window.getStudents() || [];
        var studentNames = [];
        for (var s = 0; s < allStudents.length; s++) {
            var student = allStudents[s];
            var classLocation = window.getClassLocation(student.id, week, day, hour);
            if (classLocation && String(classLocation) === String(locationId)) {
                var sched = window.getStudentSchedule(student.id, week) || {};
                if (sched[day] && String(sched[day][hour]) === String(disciplineId)) {
                    studentNames.push(window.getDisplayName(student));
                }
            }
        }

        var disciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = (
            '<div class="modal-content" style="max-width:450px;">' +
                '<div class="modal-header">' +
                    '<h3>' + disciplineName + '</h3>' +
                    '<button class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="detail-row"><span class="label">Day/Time:</span> <span>' + escapeHtml(DAY_NAMES[day]) + ' at ' + escapeHtml(hourDisplay) + '</span></div>' +
                    '<div class="detail-row"><span class="label">Duration:</span> <span><strong>' + duration + ' hour' + (duration > 1 ? 's' : '') + '</strong></span></div>' +
                    '<div class="detail-row"><span class="label">Students:</span> <span><strong>' + studentNames.length + '</strong> - ' + (studentNames.length > 0 ? escapeHtml(studentNames.join(', ')) : 'None') + '</span></div>' +
                    '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button type="button" id="remove-class-btn" class="danger small">Remove from Location</button>' +
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
            .catch(function() {
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
                showNotification('Location schedule cleared.', 'success');
                render(container, { selectedId: locationId, week: week });
            })
            .catch(function() {
                showNotification('Location schedule cleared in memory, but persistence failed.', 'error');
                render(container, { selectedId: locationId, week: week });
            });
    }

    // ============================================================
    // HELPERS
    // ============================================================

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

})();
