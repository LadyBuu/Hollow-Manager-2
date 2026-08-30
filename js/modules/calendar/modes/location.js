/**
 * js/modules/calendar/modes/location.js - Location Calendar Mode
 * Full implementation of location schedule calendar
 * Path: js/modules/calendar/modes/location.js
 * 
 * This module is responsible for:
 *   - Rendering location schedule grid (using shared renderer)
 *   - Assigning classes to locations
 *   - Displaying which students are assigned to each location
 * 
 * IMPORTANT:
 *   - This module uses core functions for ALL mutations
 *   - NO direct window.data mutations
 *   - Duration is retrieved from metadata when available
 *   - Duration inference is ONLY used as a fallback when metadata is missing
 *   - The core is authoritative for all data mutations
 *   - Removal is handled via right-click or details modal, not the assignment modal
 *   - getCharacterById is optional; instructor names degrade gracefully
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUtils) {
        console.error('LocationMode: CalendarUtils not loaded.');
        return;
    }

    if (!window.CalendarRenderer) {
        console.error('LocationMode: CalendarRenderer not loaded.');
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
    var CalendarRenderer = window.CalendarRenderer;

    var CALENDAR_START_HOUR = CalendarUtils.CALENDAR_START_HOUR || 5;
    var CALENDAR_END_HOUR = CalendarUtils.CALENDAR_END_HOUR || 23;

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

        // Duration metadata function (preferred)
        if (typeof window.getLocationClassDuration !== 'function') {
            missing.push('getLocationClassDuration');
        }

        // getCharacterById is optional - used for instructor names in dropdown
        // The module degrades gracefully if not available

        if (missing.length > 0) {
            console.warn('LocationMode: Missing dependencies:', missing.join(', '));
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
    // RENDER LOCATION SCHEDULE - Using Shared Renderer
    // ============================================================

    function renderLocationSchedule(container, state) {
        var locationId = state.selectedId;
        var week = state.week;

        var schedule = window.getLocationSchedule(locationId, week) || {};
        var location = window.getLocation(locationId);
        var locationName = location ? location.name : 'Unknown';

        var allStudents = window.getStudents() || [];

        // Prepare data for shared renderer
        var data = {
            schedule: schedule,
            restDays: [], // Locations don't have rest days
            entityName: locationName,
            getDiscipline: function(id) {
                return window.getDiscipline(id);
            },
            getDuration: function(day, hour) {
                return getLocationDisplayDuration(locationId, week, day, hour, schedule);
            },
            getLabel: function(day, hour) {
                // Locations don't typically have labels, but we could add metadata
                return '';
            },
            getGroupLabel: function(day, hour) {
                // Locations don't typically have group labels
                return '';
            },
            getInstructorName: function(day, hour) {
                // Locations don't have instructors directly
                // We could look up the instructor from the discipline
                return '';
            },
            isBlock: function(day, hour) {
                // Locations don't have blocks
                return false;
            },
            slotMetadata: function(day, hour) {
                // Show student count for location slots
                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (!disciplineId) {
                    return '';
                }

                var studentNames = getStudentsAtLocation(locationId, week, day, hour, disciplineId);
                if (studentNames.length > 0) {
                    return ' - ' + CalendarRenderer.escapeHtml(studentNames.join(', '));
                }
                return '';
            },
            extraSidebar: getLocationSidebarHTML(locationId, week),
            availableItems: getAvailableDisciplinesForLocation(locationId, week),
            availableLabel: 'Available Disciplines'
        };

        // Use shared renderer
        CalendarRenderer.renderGrid(container, state, data);

        // Bind events with location-specific callbacks
        CalendarRenderer.bindEvents(container, state, {
            onSlotClick: function(day, hour) {
                showAssignClassModal(locationId, week, day, hour, container);
            },
            onSlotRightClick: function(day, hour) {
                if (confirm('Remove this class from this location?')) {
                    removeLocationClass(locationId, week, day, hour, container);
                }
            },
            onSlotDetails: function(day, hour) {
                showLocationClassDetailsModal(locationId, week, day, hour, container);
            },
            onAvailableItemClick: function(disciplineId) {
                // For locations, clicking an available item opens the add modal with that discipline pre-selected
                showAssignClassModalWithDiscipline(locationId, week, null, null, container, disciplineId);
            },
            onClearWeek: function() {
                clearLocationWeek(locationId, week, container);
            }
        });

        // Add clear week button if not already rendered
        var clearBtn = container.querySelector('#clear-week-btn');
        if (!clearBtn) {
            var clearBtnContainer = container.querySelector('.calendar-grid-container');
            if (clearBtnContainer) {
                var btnWrapper = document.createElement('div');
                btnWrapper.style.marginTop = '12px';
                btnWrapper.innerHTML = '<button id="clear-week-btn" class="danger small">Clear Week</button>';
                clearBtnContainer.appendChild(btnWrapper);
            }
        }
    }

    // ============================================================
    // LOCATION SIDEBAR
    // ============================================================

    function getLocationSidebarHTML(locationId, week) {
        var usageCount = window.getLocationUsage ? window.getLocationUsage(locationId) : 0;
        var weekUsage = window.getLocationUsageByWeek ? window.getLocationUsageByWeek(locationId, week) : 0;
        var capacity = window.getLocationCapacity ? window.getLocationCapacity(locationId) : null;

        var html = '<div class="sidebar-section">';
        html += '<h4>Location Info</h4>';
        html += '<div style="font-size:0.8rem;color:var(--text-dim);">';
        html += '<div>Total Usage: <strong>' + usageCount + '</strong> slots</div>';
        html += '<div>This Week: <strong>' + weekUsage + '</strong> slots</div>';
        if (capacity !== null && capacity !== undefined) {
            var capacityDisplay = capacity === 0 ? 'Unlimited' : capacity;
            html += '<div>Capacity: <strong>' + capacityDisplay + '</strong></div>';
        }
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // DURATION HELPERS
    // ============================================================

    /**
     * Get the display duration of a class at a location slot.
     * Prefers metadata from getLocationClassDuration().
     * Falls back to inference ONLY if metadata is missing.
     * 
     * This is a UI display helper. The core is authoritative for duration.
     */
    function getLocationDisplayDuration(locationId, week, day, hour, schedule) {
        // Try metadata first
        if (typeof window.getLocationClassDuration === 'function') {
            var duration = window.getLocationClassDuration(locationId, week, day, hour);
            if (duration !== null && duration !== undefined && duration >= 1) {
                return duration;
            }
        }

        // Fallback: infer from contiguous schedule entries
        // This is ONLY used when metadata is missing (legacy data or migration)
        if (schedule && schedule[day]) {
            var disciplineId = schedule[day][hour];
            if (disciplineId) {
                var inferred = 1;
                for (var h = hour + 1; h <= CALENDAR_END_HOUR; h++) {
                    if (schedule[day] && String(schedule[day][h]) === String(disciplineId)) {
                        inferred++;
                    } else {
                        break;
                    }
                }
                return inferred;
            }
        }

        return 1;
    }

    // ============================================================
    // STUDENT HELPERS
    // ============================================================

    function getStudentsAtLocation(locationId, week, day, hour, disciplineId) {
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

        return studentNames;
    }

    // ============================================================
    // AVAILABLE DISCIPLINES FOR LOCATION
    // ============================================================

    function getAvailableDisciplinesForLocation(locationId, week) {
        var allDisciplines = window.getAvailableDisciplines(week) || [];
        var schedule = window.getLocationSchedule(locationId, week) || {};

        // Get occupied hours
        var occupied = {};
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var discId = daySchedule[hour];
                if (discId) {
                    if (!occupied[discId]) occupied[discId] = [];
                    occupied[discId].push({ day: parseInt(day, 10), hour: parseInt(hour, 10) });
                }
            }
        }

        // Filter disciplines that are not already assigned
        var available = [];
        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!occupied[d.id] || occupied[d.id].length === 0) {
                available.push({
                    id: d.id,
                    label: d.name,
                    subtitle: 'Not assigned'
                });
            } else {
                available.push({
                    id: d.id,
                    label: d.name,
                    subtitle: occupied[d.id].length + ' slot(s)'
                });
            }
        }

        return available;
    }

    // ============================================================
    // ASSIGN CLASS MODAL - Using Shared Renderer
    // ============================================================

    function showAssignClassModal(locationId, week, day, hour, container) {
        var disciplines = window.getAvailableDisciplines(week) || [];

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);
        var location = window.getLocation(locationId);
        var locationName = location ? location.name : 'Unknown';

        CalendarRenderer.createAddClassModal({
            title: 'Assign Class - ' + locationName + ' - ' + CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: 4,
            getDisciplineLabel: function(d) {
                var label = d.name;
                if (d.instructorIds && d.instructorIds.length > 0) {
                    var instructorNames = [];
                    for (var j = 0; j < d.instructorIds.length; j++) {
                        var inst = typeof window.getCharacterById === 'function'
                            ? window.getCharacterById(d.instructorIds[j])
                            : null;
                        if (inst) {
                            instructorNames.push(window.getDisplayName(inst));
                        }
                    }
                    if (instructorNames.length > 0) {
                        label += ' (' + instructorNames.join(', ') + ')';
                    }
                }
                return label;
            },
            onConfirm: function(disciplineId, duration, label, groupLabel, closeModal) {
                // Re-read schedule at commit time (defensive)
                var currentSchedule = window.getLocationSchedule(locationId, week) || {};

                // Check if slot is still empty (defensive)
                if (currentSchedule[day] && currentSchedule[day][hour]) {
                    CalendarRenderer.showNotification('This slot is no longer available.', 'error');
                    closeModal();
                    render(container, { selectedId: locationId, week: week });
                    return;
                }

                var result = window.setLocationClass(locationId, week, day, hour, disciplineId);

                if (!result || !result.success) {
                    CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to assign class.', 'error');
                    return;
                }

                closeModal();
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Class assigned to location.', 'success');
                        render(container, { selectedId: locationId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Class assigned in memory, but persistence failed.', 'error');
                        render(container, { selectedId: locationId, week: week });
                    });
            },
            onCancel: function() {
                // No-op
            }
        });
    }

    function showAssignClassModalWithDiscipline(locationId, week, day, hour, container, preSelectedDisciplineId) {
        var disciplines = window.getAvailableDisciplines(week) || [];

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for week ' + week + '.', 'error');
            return;
        }

        var hourDisplay = day !== null && hour !== null ? CalendarUtils.formatHour(hour) : 'any slot';
        var dayDisplay = day !== null ? CalendarRenderer.DAY_NAMES[day] : 'any day';
        var location = window.getLocation(locationId);
        var locationName = location ? location.name : 'Unknown';

        var modal = CalendarRenderer.createAddClassModal({
            title: 'Assign ' + (preSelectedDisciplineId ? 'Class' : 'Class') + ' - ' + locationName + ' - ' + dayDisplay + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: 4,
            getDisciplineLabel: function(d) {
                var label = d.name;
                if (d.instructorIds && d.instructorIds.length > 0) {
                    var instructorNames = [];
                    for (var j = 0; j < d.instructorIds.length; j++) {
                        var inst = typeof window.getCharacterById === 'function'
                            ? window.getCharacterById(d.instructorIds[j])
                            : null;
                        if (inst) {
                            instructorNames.push(window.getDisplayName(inst));
                        }
                    }
                    if (instructorNames.length > 0) {
                        label += ' (' + instructorNames.join(', ') + ')';
                    }
                }
                return label;
            },
            onConfirm: function(disciplineId, duration, label, groupLabel, closeModal) {
                // For "any slot" mode, find an available slot
                if (day === null || hour === null) {
                    // Find first available slot
                    var schedule = window.getLocationSchedule(locationId, week) || {};
                    var foundSlot = false;

                    for (var d = 1; d <= 7; d++) {
                        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                            if (!schedule[d] || !schedule[d][h]) {
                                var result = window.setLocationClass(locationId, week, d, h, disciplineId);
                                if (result && result.success) {
                                    foundSlot = true;
                                    closeModal();
                                    window.saveData()
                                        .then(function() {
                                            CalendarRenderer.showNotification('Class assigned to location.', 'success');
                                            render(container, { selectedId: locationId, week: week });
                                        })
                                        .catch(function() {
                                            CalendarRenderer.showNotification('Class assigned in memory, but persistence failed.', 'error');
                                            render(container, { selectedId: locationId, week: week });
                                        });
                                    return;
                                }
                            }
                        }
                    }

                    if (!foundSlot) {
                        CalendarRenderer.showNotification('No available slots found.', 'error');
                    }
                    return;
                }

                // Specific slot assignment
                var currentSchedule = window.getLocationSchedule(locationId, week) || {};

                if (currentSchedule[day] && currentSchedule[day][hour]) {
                    CalendarRenderer.showNotification('This slot is no longer available.', 'error');
                    closeModal();
                    render(container, { selectedId: locationId, week: week });
                    return;
                }

                var result = window.setLocationClass(locationId, week, day, hour, disciplineId);

                if (!result || !result.success) {
                    CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to assign class.', 'error');
                    return;
                }

                closeModal();
                window.saveData()
                    .then(function() {
                        CalendarRenderer.showNotification('Class assigned to location.', 'success');
                        render(container, { selectedId: locationId, week: week });
                    })
                    .catch(function() {
                        CalendarRenderer.showNotification('Class assigned in memory, but persistence failed.', 'error');
                        render(container, { selectedId: locationId, week: week });
                    });
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

    function showLocationClassDetailsModal(locationId, week, day, hour, container) {
        var schedule = window.getLocationSchedule(locationId, week) || {};
        var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!disciplineId) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        var discipline = window.getDiscipline(disciplineId);
        var hourDisplay = CalendarUtils.formatHour(hour);

        // Get duration using the display helper
        var duration = getLocationDisplayDuration(locationId, week, day, hour, schedule);

        // Find students assigned to this location
        var studentNames = getStudentsAtLocation(locationId, week, day, hour, disciplineId);

        var disciplineName = discipline ? discipline.name : 'Unknown';

        CalendarRenderer.createDetailsModal({
            title: disciplineName,
            details: [
                { label: 'Location', value: window.getLocation(locationId) ? window.getLocation(locationId).name : 'Unknown' },
                { label: 'Day/Time', value: CalendarRenderer.DAY_NAMES[day] + ' at ' + hourDisplay },
                { label: 'Duration', value: duration + ' hour' + (duration > 1 ? 's' : '') },
                { label: 'Students', value: studentNames.length > 0 ? studentNames.length + ' - ' + studentNames.join(', ') : 'None' }
            ],
            actions: [
                {
                    label: 'Remove from Location',
                    className: 'danger',
                    handler: function(closeModal) {
                        if (confirm('Remove this class from this location?')) {
                            closeModal();
                            removeLocationClass(locationId, week, day, hour, container);
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

    function removeLocationClass(locationId, week, day, hour, container) {
        var result = window.removeLocationClass(locationId, week, day, hour);

        if (!result || !result.success) {
            CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to remove class.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                CalendarRenderer.showNotification('Class removed from location.', 'success');
                render(container, { selectedId: locationId, week: week });
            })
            .catch(function() {
                CalendarRenderer.showNotification('Class removed in memory, but persistence failed.', 'error');
                render(container, { selectedId: locationId, week: week });
            });
    }

    // ============================================================
    // CLEAR WEEK
    // ============================================================

    function clearLocationWeek(locationId, week, container) {
        var result = window.clearLocationSchedule(locationId, week);

        if (!result || !result.success) {
            CalendarRenderer.showNotification(result && result.message ? result.message : 'Failed to clear schedule.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                CalendarRenderer.showNotification('Location schedule cleared.', 'success');
                render(container, { selectedId: locationId, week: week });
            })
            .catch(function() {
                CalendarRenderer.showNotification('Location schedule cleared in memory, but persistence failed.', 'error');
                render(container, { selectedId: locationId, week: week });
            });
    }

    // ============================================================
    // REGISTER WITH CALENDAR MODES
    // ============================================================

    if (window.CalendarModes && typeof window.CalendarModes.registerMode === 'function') {
        window.CalendarModes.registerMode('location', {
            label: 'Location',
            hint: 'Click a slot to assign a class | Right-click to remove | Click available discipline to auto-assign',
            render: render,
            getEntities: getLocations,
            getEntityDisplayName: function(entity) {
                return entity.name || 'Unknown';
            },
            getData: getSchedule
        });
    }

})();
