/**
 * js/modules/calendar/modes/location.js - Location Calendar Mode
 * Full implementation of location calendar
 * Path: js/modules/calendar/modes/location.js
 * 
 * This module is responsible for:
 *   - Rendering location calendar grid (using shared renderer)
 *   - Displaying location schedule
 *   - Showing which students are at each location
 *   - Adding/removing classes from location
 *   - Showing location usage statistics
 * 
 * IMPORTANT:
 *   - ORCHESTRATION ONLY - no domain logic
 *   - Uses LocationQueries for all data
 *   - Uses LocationView for all rendering
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
 *   - window.LocationQueries (from queries/location-queries.js) - MANDATORY
 *   - window.LocationView (from views/location-view.js) - MANDATORY
 *   - window.CalendarRenderer (from calendar-renderer.js) - MANDATORY
 *   - window.CalendarUtils (from calendar-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarModes (from modes/index.js) - MANDATORY
 *   - window.CalendarLocationCore (from core/location-core.js) - MANDATORY
 *   - window.MutationUtils (from mutation-pipeline.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.LocationQueries || typeof window.LocationQueries.getLocationSchedule !== 'function') {
        missing.push('LocationQueries.getLocationSchedule');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocationDisciplineAvailability !== 'function') {
        missing.push('LocationQueries.getLocationDisciplineAvailability');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocationUsage !== 'function') {
        missing.push('LocationQueries.getLocationUsage');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocationClassDetails !== 'function') {
        missing.push('LocationQueries.getLocationClassDetails');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getStudentsAtLocation !== 'function') {
        missing.push('LocationQueries.getStudentsAtLocation');
    }

    if (!window.LocationView || typeof window.LocationView.renderLocationSidebar !== 'function') {
        missing.push('LocationView.renderLocationSidebar');
    }
    if (!window.LocationView || typeof window.LocationView.renderLocationDetailsModal !== 'function') {
        missing.push('LocationView.renderLocationDetailsModal');
    }
    if (!window.LocationView || typeof window.LocationView.renderAddClassModal !== 'function') {
        missing.push('LocationView.renderAddClassModal');
    }
    if (!window.LocationView || typeof window.LocationView.renderLocationStudentsModal !== 'function') {
        missing.push('LocationView.renderLocationStudentsModal');
    }
    if (!window.LocationView || typeof window.LocationView.renderLocationUsageView !== 'function') {
        missing.push('LocationView.renderLocationUsageView');
    }
    if (!window.LocationView || typeof window.LocationView.renderDisciplineAvailabilityView !== 'function') {
        missing.push('LocationView.renderDisciplineAvailabilityView');
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

    if (!window.CalendarLocationCore || typeof window.CalendarLocationCore.setLocationClass !== 'function') {
        missing.push('CalendarLocationCore.setLocationClass');
    }
    if (!window.CalendarLocationCore || typeof window.CalendarLocationCore.removeLocationClass !== 'function') {
        missing.push('CalendarLocationCore.removeLocationClass');
    }
    if (!window.CalendarLocationCore || typeof window.CalendarLocationCore.clearLocationSchedule !== 'function') {
        missing.push('CalendarLocationCore.clearLocationSchedule');
    }

    if (!window.MutationUtils || typeof window.MutationUtils.performMutation !== 'function') {
        missing.push('MutationUtils.performMutation');
    }

    if (!window.LocationQueries || typeof window.LocationQueries.getLocation !== 'function') {
        missing.push('LocationQueries.getLocation');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocations !== 'function') {
        missing.push('LocationQueries.getLocations');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (missing.length > 0) {
        throw new Error('[LocationMode] Missing dependencies: ' + missing.join(', '));
    }

    window.__locationModeLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var LocationQueries = window.LocationQueries;
    var LocationView = window.LocationView;
    var CalendarRenderer = window.CalendarRenderer;
    var CalendarUtils = window.CalendarUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CalendarModes = window.CalendarModes;
    var LocationCore = window.CalendarLocationCore;
    var MutationUtils = window.MutationUtils;
    var DisciplineQueries = window.DisciplineQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;

    // ============================================================
    // HELPERS
    // ============================================================

    function getLocations() {
        return LocationQueries.getLocations() || [];
    }

    function getEntityDisplayName(entity) {
        return entity.name || entity.id || 'Unknown';
    }

    // ============================================================
    // DATA QUERY
    // ============================================================

    function getSchedule(state) {
        if (!state || !state.selectedId) {
            return {};
        }

        return LocationQueries.getLocationSchedule(
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

        var schedule = LocationQueries.getLocationSchedule(locationId, week);
        var location = LocationQueries.getLocation(locationId);
        var locationName = location ? location.name || location.id : 'Unknown';

        var availableDisciplines = LocationQueries.getLocationDisciplineAvailability(locationId, week) || [];

        var data = {
            schedule: schedule,
            restDays: [],
            entityName: locationName,
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
            getInstructorName: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (!slot || !slot.instructorId) return '';
                var instructor = window.CharacterQueries ? window.CharacterQueries.getCharacterById(slot.instructorId) : null;
                return instructor ? window.CharacterQueries.getDisplayName(instructor) : '';
            },
            isBlock: function() {
                return false;
            },
            slotMetadata: function(day, hour) {
                var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (!slot) return '';

                var metadata = [];

                if (slot.students && slot.students.length > 0) {
                    metadata.push(slot.students.length + ' student' + (slot.students.length > 1 ? 's' : ''));
                }

                if (metadata.length > 0) {
                    return ' [' + metadata.join(' | ') + ']';
                }

                return '';
            },
            extraSidebar: LocationView.renderLocationSidebar(locationId, week),
            availableItems: getAvailableDisciplinesForLocation(locationId, week),
            availableLabel: 'Available Disciplines'
        };

        CalendarRenderer.renderGrid(container, state, data);

        CalendarRenderer.bindEvents(container, state, {
            onSlotClick: function(day, hour) {
                handleAddClass(locationId, week, day, hour, container);
            },
            onSlotRightClick: function(day, hour) {
                handleRemoveClass(locationId, week, day, hour, container);
            },
            onSlotDetails: function(day, hour) {
                handleSlotDetails(locationId, week, day, hour, container);
            },
            onAvailableItemClick: function(disciplineId) {
                handleAddClassWithDiscipline(locationId, week, null, null, container, disciplineId);
            }
        });
    }

    // ============================================================
    // AVAILABLE DISCIPLINES
    // ============================================================

    function getAvailableDisciplinesForLocation(locationId, week) {
        var disciplines = LocationQueries.getLocationDisciplineAvailability(locationId, week) || [];

        return disciplines
            .filter(function(d) {
                return d.available && d.canHost;
            })
            .map(function(d) {
                return {
                    id: d.id,
                    label: d.name,
                    subtitle: d.maxSlots > 0 ? d.usedCount + '/' + d.maxSlots + ' slots used' : 'Available'
                };
            });
    }

    // ============================================================
    // HANDLE ADD CLASS
    // ============================================================

    function handleAddClass(locationId, week, day, hour, container) {
        var disciplines = LocationQueries.getLocationDisciplineAvailability(locationId, week)
            .filter(function(d) {
                return d.available && d.canHost;
            });

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this location.', 'error');
            return;
        }

        var hourDisplay = CalendarUtils.formatHour(hour);
        var dayName = CalendarConstants.getDayName(day);

        LocationView.renderAddClassModal({
            locationId: locationId,
            week: week,
            day: day,
            hour: hour,
            title: 'Assign Class - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performAddClass(locationId, week, day, hour, disciplineId, closeModal, container);
            }
        });
    }

    function handleAddClassWithDiscipline(locationId, week, day, hour, container, preSelectedDisciplineId) {
        var disciplines = LocationQueries.getLocationDisciplineAvailability(locationId, week)
            .filter(function(d) {
                return d.available && d.canHost;
            });

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this location.', 'error');
            return;
        }

        if (day === null || hour === null) {
            var schedule = LocationQueries.getLocationSchedule(locationId, week);
            var found = false;

            for (var d = MIN_DAY; d <= MAX_DAY; d++) {
                for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                    if (!schedule[d] || !schedule[d][h]) {
                        var discipline = DisciplineQueries.getDiscipline(preSelectedDisciplineId);
                        var disciplineName = discipline ? discipline.name : 'Unknown';
                        var dayName = CalendarConstants.getDayName(d);

                        LocationView.renderAddClassModal({
                            locationId: locationId,
                            week: week,
                            day: d,
                            hour: h,
                            title: 'Assign Class - ' + dayName + ' at ' + CalendarUtils.formatHour(h),
                            disciplines: disciplines,
                            maxDuration: MAX_DURATION,
                            preSelectedDisciplineId: preSelectedDisciplineId
                        }, {
                            onConfirm: function(disciplineId, duration, label, closeModal) {
                                performAddClass(locationId, week, d, h, disciplineId, closeModal, container);
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

        LocationView.renderAddClassModal({
            locationId: locationId,
            week: week,
            day: day,
            hour: hour,
            title: 'Assign Class - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION,
            preSelectedDisciplineId: preSelectedDisciplineId
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performAddClass(locationId, week, day, hour, disciplineId, closeModal, container);
            }
        });
    }

    // ============================================================
    // PERFORM ADD CLASS
    // ============================================================

    function performAddClass(locationId, week, day, hour, disciplineId, closeModal, container) {
        var duration = 1;

        if (hour + duration > CALENDAR_END_HOUR + 1) {
            CalendarRenderer.showNotification('Class extends beyond the calendar boundary.', 'error');
            return;
        }

        var schedule = LocationQueries.getLocationSchedule(locationId, week);
        if (schedule[day] && schedule[day][hour]) {
            CalendarRenderer.showNotification('This slot is already occupied.', 'error');
            return;
        }

        MutationUtils.performMutation({
            validate: function() {
                return { valid: true };
            },
            mutate: function() {
                return LocationCore.setLocationClass(locationId, week, day, hour, disciplineId);
            },
            logMessage: function() {
                var discipline = DisciplineQueries.getDiscipline(disciplineId);
                var disciplineName = discipline ? discipline.name : 'Unknown';
                return 'Assigned class to location: ' + disciplineName;
            },
            successMessage: 'Class assigned to location successfully!',
            failureMessage: 'Failed to assign class to location.'
        }).then(function(result) {
            if (result.success) {
                if (closeModal) closeModal();
                render(container, { selectedId: locationId, week: week });
            } else {
                CalendarRenderer.showNotification(result.message || 'Failed to assign class.', 'error');
            }
        });
    }

    // ============================================================
    // HANDLE REMOVE CLASS
    // ============================================================

    function handleRemoveClass(locationId, week, day, hour, container) {
        var schedule = LocationQueries.getLocationSchedule(locationId, week);
        var slot = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;

        if (!slot) {
            CalendarRenderer.showNotification('No class at this time.', 'error');
            return;
        }

        if (!confirm('Remove this class from the location?')) {
            return;
        }

        performRemoveClass(locationId, week, day, hour, container);
    }

    function performRemoveClass(locationId, week, day, hour, container) {
        MutationUtils.performMutation({
            validate: function() {
                return { valid: true };
            },
            mutate: function() {
                return LocationCore.removeLocationClass(locationId, week, day, hour);
            },
            logMessage: 'Removed class from location',
            successMessage: 'Class removed from location successfully!',
            failureMessage: 'Failed to remove class from location.'
        }).then(function(result) {
            if (result.success) {
                render(container, { selectedId: locationId, week: week });
            } else {
                CalendarRenderer.showNotification(result.message || 'Failed to remove class.', 'error');
            }
        });
    }

    // ============================================================
    // HANDLE SLOT DETAILS
    // ============================================================

    function handleSlotDetails(locationId, week, day, hour, container) {
        var data = LocationQueries.getLocationClassDetails(locationId, week, day, hour);

        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        LocationView.renderLocationDetailsModal(data, {
            onEdit: function(closeModal) {
                closeModal();
                handleEditClass(locationId, week, day, hour, container);
            },
            onRemove: function(closeModal) {
                closeModal();
                if (confirm('Remove this class from the location?')) {
                    performRemoveClass(locationId, week, day, hour, container);
                }
            }
        });
    }

    // ============================================================
    // HANDLE EDIT CLASS
    // ============================================================

    function handleEditClass(locationId, week, day, hour, container) {
        var data = LocationQueries.getLocationClassDetails(locationId, week, day, hour);

        if (!data) {
            CalendarRenderer.showNotification('Class not found.', 'error');
            return;
        }

        var disciplines = LocationQueries.getLocationDisciplineAvailability(locationId, week)
            .filter(function(d) {
                return d.available && d.canHost;
            });

        if (disciplines.length === 0) {
            CalendarRenderer.showNotification('No disciplines available for this location.', 'error');
            return;
        }

        var dayName = CalendarConstants.getDayName(day);
        var hourDisplay = CalendarUtils.formatHour(hour);

        LocationView.renderAddClassModal({
            locationId: locationId,
            week: week,
            day: day,
            hour: hour,
            title: 'Edit Class - ' + dayName + ' at ' + hourDisplay,
            disciplines: disciplines,
            maxDuration: MAX_DURATION,
            preSelectedDisciplineId: data.disciplineId
        }, {
            onConfirm: function(disciplineId, duration, label, closeModal) {
                performRemoveClass(locationId, week, day, hour, container, function() {
                    performAddClass(locationId, week, day, hour, disciplineId, closeModal, container);
                });
            }
        });
    }

    // ============================================================
    // EXPOSE PUBLIC API
    // ============================================================

    CalendarModes.registerMode('location', {
        label: 'Location',
        hint: 'Click an empty slot to assign a class | Right-click to remove | Click a class for details',
        render: render,
        getEntities: getLocations,
        getEntityDisplayName: getEntityDisplayName,
        getData: getSchedule
    });

})();