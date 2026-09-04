/**
 * js/modules/calendar/core/grid-core.js - Calendar Grid Core
 * Shared grid helpers, overlap detection, and schedule integrity validation
 * Path: js/modules/calendar/core/grid-core.js
 * 
 * This module handles:
 *   - Building calendar grids from schedule data
 *   - Occupied hour detection
 *   - Availability slot calculation
 *   - Duration-aware conflict detection
 *   - Class start hour resolution
 *   - Schedule integrity validation
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no data mutation
 *   - All functions are read-only queries
 *   - No direct window.data access
 *   - All ID normalisation is consistent
 *   - Duration metadata is respected for availability calculations
 *   - Student schedules are the canonical source of truth
 *   - UI-level overlap detection is a guardrail; core is authoritative
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - for deepClone where needed
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarGridCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        return;
    }

    window.__calendarGridCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;
    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function deepClone(value) {
        return window.ObjectUtils.deepClone(value);
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function validateDuration(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateDay(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 7) ? num : null;
    }

    function validateHour(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 0 && num <= 23) ? num : null;
    }

    // ============================================================
    // GRID BUILDING
    // ============================================================

    /**
     * Build a grid from a schedule.
     * Distinguishes class starts from continuations.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} options - Grid options
     * @param {array} options.days - Days to include (default: 1-7)
     * @param {array} options.hours - Hours to include (default: 5-23)
     * @param {object} options.metadata - Metadata object with classDurations, etc.
     * @param {string} options.studentId - Student ID for metadata lookup
     * @param {number} options.week - Week number for metadata lookup
     * @returns {object} Grid with class starts and continuations
     */
    function buildGrid(schedule, options) {
        options = options || {};
        var grid = {};

        var days = options.days || [1, 2, 3, 4, 5, 6, 7];
        var hours = options.hours || [];

        if (hours.length === 0) {
            for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                hours.push(h);
            }
        }

        var metadata = options.metadata || {};
        var studentId = options.studentId || null;
        var week = options.week || null;

        for (var d = 0; d < days.length; d++) {
            var day = days[d];
            grid[day] = {};

            for (var hr = 0; hr < hours.length; hr++) {
                var hour = hours[hr];
                var isOccupied = schedule && schedule[day] && schedule[day][hour];

                if (isOccupied) {
                    var disciplineId = schedule[day][hour];

                    // Try to find class start
                    var classStart = null;
                    if (studentId && week && metadata.classDurations) {
                        classStart = findClassStartHour(schedule, metadata, studentId, week, day, hour);
                    }

                    if (classStart && classStart.startHour === hour) {
                        // This is a class start
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration,
                            students: [],
                            label: metadata.classLabels ? metadata.classLabels[classStart.key] || null : null,
                            groupLabel: metadata.classGroupLabels ? metadata.classGroupLabels[classStart.key] || null : null,
                            instructorId: metadata.classInstructors ? metadata.classInstructors[classStart.key] || null : null,
                            isContinuation: false,
                            startHour: hour,
                            key: classStart.key
                        };
                    } else if (classStart) {
                        // This is a continuation
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration,
                            students: [],
                            label: null,
                            groupLabel: null,
                            instructorId: null,
                            isContinuation: true,
                            startHour: classStart.startHour,
                            key: classStart.key
                        };
                    } else {
                        // No metadata found - data corruption
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: 1,
                            students: [],
                            label: null,
                            groupLabel: null,
                            instructorId: null,
                            isContinuation: false,
                            startHour: hour,
                            key: null,
                            isCorrupted: true
                        };
                    }
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        disciplineId: null,
                        duration: 1,
                        students: [],
                        label: null,
                        groupLabel: null,
                        instructorId: null,
                        isContinuation: false,
                        startHour: null,
                        key: null
                    };
                }
            }
        }

        return grid;
    }

    // ============================================================
    // OCCUPANCY HELPERS
    // ============================================================

    /**
     * Get occupied hours for a day.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @returns {object} Occupied hours { hour: true }
     */
    function getOccupiedHours(schedule, day) {
        var occupied = {};
        if (!schedule || !schedule[day]) {
            return occupied;
        }

        for (var hour in schedule[day]) {
            if (schedule[day][hour]) {
                occupied[hour] = true;
            }
        }
        return occupied;
    }

    /**
     * Get available slots for a day.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour (optional)
     * @param {number} endHour - End hour (optional)
     * @returns {array} Array of available hours
     */
    function getAvailableSlots(schedule, day, startHour, endHour) {
        if (startHour === undefined || startHour === null) {
            startHour = CALENDAR_START_HOUR;
        }
        if (endHour === undefined || endHour === null) {
            endHour = CALENDAR_END_HOUR;
        }

        var available = [];

        if (!schedule || !schedule[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!schedule[day][h]) {
                available.push(h);
            }
        }
        return available;
    }

    /**
     * Get continuous occupied hours of the same discipline.
     * This measures OCCUPIED HOURS, not class duration.
     * For class duration, use metadata.classDurations.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @returns {number} Number of continuous occupied hours
     */
    function getContinuousOccupiedHours(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return 0;
        }

        var disciplineId = schedule[day][hour];
        var startHour = hour;
        while (startHour > 0 && String(schedule[day][startHour - 1]) === String(disciplineId)) {
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23 && String(schedule[day][endHour + 1]) === String(disciplineId)) {
            endHour++;
        }

        return endHour - startHour + 1;
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    /**
     * Check if a slot has a conflict.
     * Duration-aware.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasConflict(schedule, day, hour, duration) {
        if (duration === undefined || duration === null) {
            duration = 1;
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return false;
        }

        if (!schedule || !schedule[day]) {
            return false;
        }

        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a new duration-based entry overlaps with existing entries.
     * Treats malformed existing entries as OCCUPIED to prevent overwriting garbage.
     * 
     * @param {object} entries - Entries object { day: { hour: { duration: N } } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is an overlap
     */
    function hasDurationOverlap(entries, day, hour, duration) {
        if (!entries || !entries[day]) {
            return false;
        }

        var dayEntries = entries[day];

        for (var existingHour in dayEntries) {
            if (!Object.prototype.hasOwnProperty.call(dayEntries, existingHour)) {
                continue;
            }

            var existingStart = parseInt(existingHour, 10);
            if (isNaN(existingStart)) {
                continue;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = entry && entry.duration ? parseInt(entry.duration, 10) : null;

            // If the existing entry is malformed, treat it as occupied
            if (existingDuration === null || isNaN(existingDuration) || existingDuration < 1 || existingDuration > 4) {
                var existingEnd = existingStart + 1;
                var newEnd = hour + duration;
                if (hour < existingEnd && existingStart < newEnd) {
                    return true;
                }
                continue;
            }

            var existingEnd = existingStart + existingDuration;
            var newEnd = hour + duration;

            if (hour < existingEnd && existingStart < newEnd) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a student schedule slot has conflicts.
     * Duration-aware: checks all occupied hours in the range.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasStudentScheduleConflict(schedule, day, hour, duration) {
        if (!schedule || !schedule[day]) {
            return false;
        }

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // CLASS START RESOLUTION
    // ============================================================

    /**
     * Find the class start hour for a given occupied hour.
     * Uses metadata to find the start, with occupancy fallback.
     * Returns null if no class start can be found.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object with classDurations, etc.
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @returns {object|null} { startHour, duration, disciplineId, key } or null
     */
    function findClassStartHour(schedule, metadata, studentId, week, day, hour) {
        if (!schedule || !schedule[day]) {
            return null;
        }

        var disciplineId = schedule[day][hour];
        if (!disciplineId) {
            return null;
        }

        // First, check if this hour itself has metadata (is a start)
        var key = getScheduleKey(studentId, week, day, hour);
        var duration = getValidClassDuration(metadata, key);

        if (duration !== null) {
            // Validate that the duration matches the actual occupied cells
            var actualDuration = validateOccupiedDuration(schedule, day, hour, disciplineId);
            if (actualDuration !== null && duration === actualDuration) {
                return {
                    startHour: hour,
                    duration: duration,
                    disciplineId: disciplineId,
                    key: key
                };
            }
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hour - 1; candidate >= 0; candidate--) {
            if (String(schedule[day][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateKey = getScheduleKey(studentId, week, day, candidate);
            var candidateDuration = getValidClassDuration(metadata, candidateKey);

            if (candidateDuration !== null) {
                var actualDuration = validateOccupiedDuration(schedule, day, candidate, disciplineId);
                if (actualDuration !== null && candidateDuration === actualDuration) {
                    if (hour < candidate + candidateDuration) {
                        return {
                            startHour: candidate,
                            duration: candidateDuration,
                            disciplineId: disciplineId,
                            key: candidateKey
                        };
                    }
                }
                break;
            }
        }

        return null;
    }

    /**
     * Validate that occupied hours match the expected duration.
     * Returns the actual duration if consistent, null otherwise.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour
     * @param {string} disciplineId - Discipline ID
     * @returns {number|null} Actual duration or null if inconsistent
     */
    function validateOccupiedDuration(schedule, day, startHour, disciplineId) {
        var duration = 0;
        var maxHour = 23;

        for (var h = startHour; h <= maxHour; h++) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                duration++;
            } else {
                break;
            }
        }

        // Check that the class is contiguous - no gaps
        for (var h = startHour + duration; h <= Math.min(startHour + duration + 4, maxHour); h++) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                return null;
            }
        }

        return duration;
    }

    /**
     * Get valid class duration from metadata.
     * 
     * @param {object} metadata - Metadata object with classDurations
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {number|null} Duration or null if invalid
     */
    function getValidClassDuration(metadata, key) {
        if (!metadata || !metadata.classDurations) {
            return null;
        }
        var duration = metadata.classDurations[key];
        if (duration === undefined || duration === null) {
            return null;
        }
        var num = parseInt(duration, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    // ============================================================
    // INTEGRITY VALIDATION
    // ============================================================

    /**
     * Validate the integrity of a schedule.
     * Checks:
     * - All class starts have valid duration metadata
     * - All occupied hours belong to a valid class
     * - No overlapping classes
     * - All metadata keys correspond to actual classes
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object with classDurations, etc.
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @returns {object} { valid: boolean, issues: array, warnings: array }
     */
    function validateScheduleIntegrity(schedule, metadata, studentId, week) {
        var results = {
            valid: true,
            issues: [],
            warnings: []
        };

        if (!schedule || typeof schedule !== 'object') {
            results.valid = false;
            results.issues.push('Schedule is not available.');
            return results;
        }

        // Find all class starts
        var classStarts = [];
        var seenHours = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            if (!isObject(schedule[day])) {
                continue;
            }

            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) {
                    continue;
                }

                var disciplineId = schedule[day][hour];
                if (!disciplineId) {
                    continue;
                }

                var key = getScheduleKey(studentId, week, day, hourNum);

                // Check if this hour has valid duration metadata
                var duration = getValidClassDuration(metadata, key);
                if (duration !== null) {
                    // This is a class start
                    var actualDuration = validateOccupiedDuration(schedule, day, hourNum, disciplineId);
                    if (actualDuration === null || actualDuration !== duration) {
                        var dayName = getDayName(day);
                        results.issues.push('Class at ' + dayName + ' ' + hourNum + ': Duration mismatch (metadata: ' + duration + ', actual: ' + (actualDuration || 'inconsistent') + ')');
                        results.valid = false;
                    }
                    classStarts.push({
                        day: parseInt(day, 10),
                        hour: hourNum,
                        duration: duration,
                        disciplineId: disciplineId,
                        key: key
                    });
                }
            }
        }

        // Check for overlapping classes
        for (var i = 0; i < classStarts.length; i++) {
            for (var j = i + 1; j < classStarts.length; j++) {
                var a = classStarts[i];
                var b = classStarts[j];
                if (a.day !== b.day) {
                    continue;
                }

                var aStart = a.hour;
                var aEnd = a.hour + a.duration;
                var bStart = b.hour;
                var bEnd = b.hour + b.duration;

                if (aStart < bEnd && bStart < aEnd) {
                    var dayName = getDayName(a.day);
                    results.issues.push('Overlapping classes on ' + dayName + ': ' + a.hour + '-' + aEnd + ' and ' + b.hour + '-' + bEnd);
                    results.valid = false;
                }
            }
        }

        // Check that all metadata keys correspond to actual classes
        var prefix = studentId + '_' + week + '_';
        var metadataKeys = ['classDurations', 'classInstructors', 'classLabels', 'classGroupLabels', 'classLocations'];

        for (var m = 0; m < metadataKeys.length; m++) {
            var storeKey = metadataKeys[m];
            var store = metadata[storeKey];
            if (!store) {
                continue;
            }

            for (var metaKey in store) {
                if (!Object.prototype.hasOwnProperty.call(store, metaKey)) {
                    continue;
                }
                if (metaKey.indexOf(prefix) !== 0) {
                    continue;
                }

                var parts = metaKey.split('_');
                if (parts.length !== 4) {
                    results.warnings.push('Malformed metadata key: ' + metaKey);
                    continue;
                }

                var dayKey = parseInt(parts[2], 10);
                var hourKey = parseInt(parts[3], 10);
                if (isNaN(dayKey) || isNaN(hourKey)) {
                    results.warnings.push('Invalid metadata key format: ' + metaKey);
                    continue;
                }

                if (!schedule[dayKey] || !schedule[dayKey][hourKey]) {
                    var dayName = getDayName(dayKey);
                    results.warnings.push('Orphan metadata at ' + dayName + ' ' + hourKey + ' (no class)');
                }
            }
        }

        return results;
    }

    /**
     * Get day name from day number.
     * 
     * @param {number} day - Day number (1-7)
     * @returns {string} Day name
     */
    function getDayName(day) {
        return DAY_NAMES[day] || 'Unknown';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarGridCore = {
        // Grid building
        buildGrid: buildGrid,

        // Occupancy helpers
        getOccupiedHours: getOccupiedHours,
        getAvailableSlots: getAvailableSlots,
        getContinuousOccupiedHours: getContinuousOccupiedHours,

        // Conflict detection
        hasConflict: hasConflict,
        hasDurationOverlap: hasDurationOverlap,
        hasStudentScheduleConflict: hasStudentScheduleConflict,

        // Class start resolution
        findClassStartHour: findClassStartHour,
        validateOccupiedDuration: validateOccupiedDuration,
        getValidClassDuration: getValidClassDuration,

        // Integrity validation
        validateScheduleIntegrity: validateScheduleIntegrity,

        // Utilities
        getDayName: getDayName,
        getScheduleKey: getScheduleKey,
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        DAY_NAMES: DAY_NAMES
    };

})();
