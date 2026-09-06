/**
 * modules/calendar/core/schedule-core.js - Calendar Schedule Core
 * Shared schedule semantics, key generation, and rule logic
 * Path: js/modules/calendar/core/schedule-core.js
 * 
 * This module provides:
 *   - getScheduleKey - Canonical schedule key generation
 *   - hasConflict - Duration-aware conflict detection
 *   - hasDurationOverlap - Interval overlap detection
 *   - findClassStartHour - Resolve occupied hour to class start
 *   - validateOccupiedDuration - Validate contiguous class duration
 *   - getValidClassDuration - Get duration from metadata
 *   - getContinuousOccupiedHours - Measure occupied runs
 *   - getAvailableStartHours - Get valid class start slots
 *   - getClassRange - Get class start and end hours
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for schedule semantics
 *   - All calendar cores use these functions
 *   - No direct window.data access
 *   - PURE functions - no side effects, no mutations
 *   - Uses CalendarConstants for bounds
 *   - Uses ValidationUtils for strict parsing (when available)
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - OPTIONAL (for parsing)
 * 
 * USAGE:
 *   var SC = window.CalendarScheduleCore;
 *   var key = SC.getScheduleKey(studentId, week, day, hour);
 *   var hasConflict = SC.hasConflict(schedule, day, hour, duration);
 *   var start = SC.findClassStartHour(schedule, durations, studentId, week, day, hour);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarScheduleCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    if (!window.CalendarConstants) {
        console.error('[CalendarScheduleCore] CalendarConstants is required.');
        return;
    }

    var CalendarConstants = window.CalendarConstants;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // STRICT INTEGER PARSING
    // ============================================================

    function parseInteger(value) {
        if (ValidationUtils && typeof ValidationUtils.parseInteger === 'function') {
            return ValidationUtils.parseInteger(value);
        }

        // Local fallback (should never be reached if ValidationUtils is loaded)
        if (value === undefined || value === null || value === '') {
            return null;
        }

        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    // ============================================================
    // SCHEDULE KEY GENERATION - CANONICAL SOURCE OF TRUTH
    // ============================================================

    /**
     * Generate a canonical schedule key.
     * Format: studentId_week_day_hour
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {string} Schedule key
     */
    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' +
               String(week) + '_' +
               String(day) + '_' +
               String(hour);
    }

    /**
     * Parse a schedule key into its components.
     * 
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {object|null} { studentId, week, day, hour } or null
     */
    function parseScheduleKey(key) {
        if (!key || typeof key !== 'string') {
            return null;
        }

        var parts = key.split('_');
        if (parts.length !== 4) {
            return null;
        }

        var studentId = parts[0] || null;
        var week = parseInteger(parts[1]);
        var day = parseInteger(parts[2]);
        var hour = parseInteger(parts[3]);

        if (!studentId || week === null || day === null || hour === null) {
            return null;
        }

        return {
            studentId: studentId,
            week: week,
            day: day,
            hour: hour
        };
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    /**
     * Check if a time slot has a conflict.
     * Duration-aware: checks all hours in the range.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasConflict(schedule, day, hour, duration) {
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);
        var durationNum = parseInteger(duration);

        if (dayNum === null || hourNum === null || durationNum === null) {
            return false;
        }

        // Validate bounds
        if (dayNum < MIN_DAY || dayNum > MAX_DAY ||
            hourNum < MIN_HOUR || hourNum > MAX_HOUR ||
            durationNum < 1 || durationNum > MAX_DURATION) {
            return true; // Invalid input is treated as a conflict
        }

        // Check calendar boundary
        if (hourNum + durationNum > MAX_HOUR + 1) {
            return true;
        }

        if (!schedule || !schedule[dayNum]) {
            return false;
        }

        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            if (schedule[dayNum][h]) {
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
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);
        var durationNum = parseInteger(duration);

        if (dayNum === null || hourNum === null || durationNum === null) {
            return true; // Invalid input is treated as a conflict
        }

        // Validate bounds
        if (dayNum < MIN_DAY || dayNum > MAX_DAY ||
            hourNum < MIN_HOUR || hourNum > MAX_HOUR ||
            durationNum < 1 || durationNum > MAX_DURATION) {
            return true;
        }

        // Check calendar boundary
        if (hourNum + durationNum > MAX_HOUR + 1) {
            return true;
        }

        if (!entries || !entries[dayNum]) {
            return false;
        }

        var dayEntries = entries[dayNum];

        for (var existingHour in dayEntries) {
            if (!Object.prototype.hasOwnProperty.call(dayEntries, existingHour)) {
                continue;
            }

            var existingStart = parseInteger(existingHour);
            if (existingStart === null) {
                continue;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = entry && entry.duration ? parseInteger(entry.duration) : null;

            // If the existing entry is malformed, treat it as occupied
            if (existingDuration === null || existingDuration < 1 || existingDuration > MAX_DURATION) {
                var existingEnd = existingStart + 1;
                var newEnd = hourNum + durationNum;
                if (hourNum < existingEnd && existingStart < newEnd) {
                    return true;
                }
                continue;
            }

            var existingEnd = existingStart + existingDuration;
            var newEnd = hourNum + durationNum;

            if (hourNum < existingEnd && existingStart < newEnd) {
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
     * @param {object} durations - Class durations map { scheduleKey: duration }
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @returns {object|null} { startHour, duration, disciplineId, key } or null
     */
    function findClassStartHour(schedule, durations, studentId, week, day, hour) {
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (dayNum === null || hourNum === null) {
            return null;
        }

        if (!schedule || !schedule[dayNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        if (!disciplineId) {
            return null;
        }

        // First, check if this hour itself has metadata (is a start)
        var key = getScheduleKey(studentId, week, dayNum, hourNum);
        var duration = getValidClassDuration(durations, key);

        if (duration !== null) {
            // Validate that the duration matches the actual occupied cells
            var actualDuration = validateOccupiedDuration(schedule, dayNum, hourNum, disciplineId);
            if (actualDuration !== null && duration === actualDuration) {
                return {
                    startHour: hourNum,
                    duration: duration,
                    disciplineId: disciplineId,
                    key: key
                };
            }
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hourNum - 1; candidate >= 0; candidate--) {
            if (String(schedule[dayNum][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateKey = getScheduleKey(studentId, week, dayNum, candidate);
            var candidateDuration = getValidClassDuration(durations, candidateKey);

            if (candidateDuration !== null) {
                var actualDuration = validateOccupiedDuration(schedule, dayNum, candidate, disciplineId);
                if (actualDuration !== null && candidateDuration === actualDuration) {
                    if (hourNum < candidate + candidateDuration) {
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
        var dayNum = parseInteger(day);
        var startNum = parseInteger(startHour);

        if (dayNum === null || startNum === null) {
            return null;
        }

        if (!schedule || !schedule[dayNum]) {
            return null;
        }

        var duration = 0;

        for (var h = startNum; h <= MAX_HOUR; h++) {
            if (String(schedule[dayNum][h]) === String(disciplineId)) {
                duration++;
            } else {
                break;
            }
        }

        // Check that the class is contiguous - no gaps
        for (var h = startNum + duration; h <= Math.min(startNum + duration + MAX_DURATION, MAX_HOUR); h++) {
            if (String(schedule[dayNum][h]) === String(disciplineId)) {
                return null;
            }
        }

        return duration;
    }

    /**
     * Get valid class duration from durations map.
     * 
     * @param {object} durations - Class durations map { scheduleKey: duration }
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {number|null} Duration or null if invalid
     */
    function getValidClassDuration(durations, key) {
        if (!durations || typeof durations !== 'object') {
            return null;
        }

        var duration = durations[key];
        if (duration === undefined || duration === null) {
            return null;
        }

        var num = parseInteger(duration);
        if (num === null || num < 1 || num > MAX_DURATION) {
            return null;
        }

        return num;
    }

    // ============================================================
    // OCCUPANCY HELPERS
    // ============================================================

    /**
     * Get continuous occupied hours of the same discipline.
     * Measures OCCUPIED HOURS, not class duration.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @returns {number} Number of continuous occupied hours
     */
    function getContinuousOccupiedHours(schedule, day, hour) {
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (dayNum === null || hourNum === null) {
            return 0;
        }

        if (!schedule || !schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return 0;
        }

        var disciplineId = schedule[dayNum][hourNum];

        // Find start of continuous run
        var startHour = hourNum;
        while (startHour > 0 && String(schedule[dayNum][startHour - 1]) === String(disciplineId)) {
            startHour--;
        }

        // Find end of continuous run
        var endHour = hourNum;
        while (endHour < MAX_HOUR && String(schedule[dayNum][endHour + 1]) === String(disciplineId)) {
            endHour++;
        }

        return endHour - startHour + 1;
    }

    /**
     * Get the range of a class (start and end hours).
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} durations - Class durations map { scheduleKey: duration }
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @returns {object|null} { startHour, endHour, duration, disciplineId } or null
     */
    function getClassRange(schedule, durations, studentId, week, day, hour) {
        var classStart = findClassStartHour(schedule, durations, studentId, week, day, hour);

        if (!classStart) {
            return null;
        }

        return {
            startHour: classStart.startHour,
            endHour: classStart.startHour + classStart.duration,
            duration: classStart.duration,
            disciplineId: classStart.disciplineId,
            key: classStart.key
        };
    }

    // ============================================================
    // AVAILABILITY HELPERS
    // ============================================================

    /**
     * Get available start hours for a given duration.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} duration - Duration in hours
     * @param {number} startHour - Start hour (optional)
     * @param {number} endHour - End hour (optional)
     * @returns {Array} Array of available start hours
     */
    function getAvailableStartHours(schedule, day, duration, startHour, endHour) {
        var dayNum = parseInteger(day);
        var durationNum = parseInteger(duration);

        if (dayNum === null || durationNum === null) {
            return [];
        }

        startHour = startHour !== undefined ? parseInteger(startHour) : CalendarConstants.CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? parseInteger(endHour) : CalendarConstants.CALENDAR_END_HOUR;

        if (startHour === null || endHour === null || startHour > endHour) {
            return [];
        }

        var available = [];

        for (var h = startHour; h <= endHour - durationNum + 1; h++) {
            if (!hasConflict(schedule, dayNum, h, durationNum)) {
                available.push(h);
            }
        }

        return available;
    }

    /**
     * Get the next available start hour for a given duration.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} duration - Duration in hours
     * @param {number} fromHour - Hour to start searching from (optional)
     * @returns {number|null} Next available start hour or null
     */
    function getNextAvailableStartHour(schedule, day, duration, fromHour) {
        var dayNum = parseInteger(day);
        var durationNum = parseInteger(duration);

        if (dayNum === null || durationNum === null) {
            return null;
        }

        fromHour = fromHour !== undefined ? parseInteger(fromHour) : CalendarConstants.CALENDAR_START_HOUR;
        if (fromHour === null) {
            return null;
        }

        var endHour = CalendarConstants.CALENDAR_END_HOUR;

        for (var h = fromHour; h <= endHour - durationNum + 1; h++) {
            if (!hasConflict(schedule, dayNum, h, durationNum)) {
                return h;
            }
        }

        return null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.__calendarScheduleCoreLoaded = true;

    window.CalendarScheduleCore = {
        // Schedule key
        getScheduleKey: getScheduleKey,
        parseScheduleKey: parseScheduleKey,

        // Conflict detection
        hasConflict: hasConflict,
        hasDurationOverlap: hasDurationOverlap,

        // Class start resolution
        findClassStartHour: findClassStartHour,
        validateOccupiedDuration: validateOccupiedDuration,
        getValidClassDuration: getValidClassDuration,
        getClassRange: getClassRange,

        // Occupancy
        getContinuousOccupiedHours: getContinuousOccupiedHours,

        // Availability
        getAvailableStartHours: getAvailableStartHours,
        getNextAvailableStartHour: getNextAvailableStartHour,

        // Utility
        parseInteger: parseInteger
    };

})();