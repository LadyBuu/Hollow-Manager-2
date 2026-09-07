/**
 * js/modules/calendar/core/grid-core.js - Calendar Grid Core
 * Shared grid building and occupancy helpers
 * Path: js/modules/calendar/core/grid-core.js
 * 
 * This module handles:
 *   - Building calendar grids from schedule data
 *   - Occupied hour detection
 *   - Availability slot calculation
 *   - Duration-aware availability
 *   - Continuous occupied hour analysis
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no data mutation
 *   - No direct window.data access
 *   - Uses CalendarScheduleCore for schedule semantics
 *   - Uses CalendarConstants for bounds
 *   - Uses CalendarValidation for strict parsing
 *   - Grid is a VIEW-READY projection, not domain data
 * 
 * DEPENDENCIES:
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 * 
 * USAGE:
 *   var GC = window.CalendarGridCore;
 *   var grid = GC.buildGrid(schedule, { days: [1,2,3], hours: [5,6,7] });
 *   var occupied = GC.getOccupiedHours(schedule, 1);
 *   var available = GC.getAvailableHours(schedule, 1);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarGridCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarScheduleCore) {
        missing.push('CalendarScheduleCore');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarGridCore] Missing dependencies: ' + missing.join(', '));
    }

    var ScheduleCore = window.CalendarScheduleCore;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var DAY_NAMES = CalendarConstants.DAY_NAMES;

    // ============================================================
    // HELPERS
    // ============================================================

    function getDayName(day) {
        return CalendarConstants.getDayName(day) || 'Unknown';
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
     * @param {array} options.hours - Hours to include (default: CALENDAR_START_HOUR to CALENDAR_END_HOUR)
     * @param {object} options.durations - Class durations map { scheduleKey: duration }
     * @param {string} options.studentId - Student ID for metadata lookup
     * @param {number} options.week - Week number for metadata lookup
     * @param {function} options.isBlock - Function to check if a slot is blocked
     * @returns {object} Grid with class starts and continuations
     */
    function buildGrid(schedule, options) {
        options = options || {};

        var days = options.days || [];
        if (days.length === 0) {
            for (var d = MIN_DAY; d <= MAX_DAY; d++) {
                days.push(d);
            }
        }

        var hours = options.hours || [];
        if (hours.length === 0) {
            for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
                hours.push(h);
            }
        }

        var durations = options.durations || {};
        var studentId = options.studentId || null;
        var week = options.week || null;
        var isBlock = options.isBlock || function() { return false; };

        var grid = {};

        for (var d = 0; d < days.length; d++) {
            var day = days[d];
            grid[day] = {};

            for (var hr = 0; hr < hours.length; hr++) {
                var hour = hours[hr];
                var isOccupied = schedule && schedule[day] && schedule[day][hour];

                if (isOccupied) {
                    var disciplineId = schedule[day][hour];

                    // Try to find class start using ScheduleCore
                    var classStart = null;
                    if (studentId && week) {
                        classStart = ScheduleCore.findClassStartHour(
                            schedule,
                            durations,
                            studentId,
                            week,
                            day,
                            hour
                        );
                    }

                    if (classStart && classStart.startHour === hour) {
                        // This is a class start
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration || 1,
                            isContinuation: false,
                            startHour: hour,
                            key: classStart.key || null,
                            isBlock: isBlock(day, hour)
                        };
                    } else if (classStart) {
                        // This is a continuation
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration || 1,
                            isContinuation: true,
                            startHour: classStart.startHour || hour,
                            key: classStart.key || null,
                            isBlock: isBlock(day, hour)
                        };
                    } else {
                        // No metadata found - data corruption or simple occupancy
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: 1,
                            isContinuation: false,
                            startHour: hour,
                            key: null,
                            isBlock: isBlock(day, hour),
                            isCorrupted: true
                        };
                    }
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        disciplineId: null,
                        duration: 1,
                        isContinuation: false,
                        startHour: null,
                        key: null,
                        isBlock: isBlock(day, hour)
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
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return {};
        }

        var occupied = {};
        if (!schedule || !schedule[dayNum]) {
            return occupied;
        }

        var daySchedule = schedule[dayNum];
        for (var hour in daySchedule) {
            if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                continue;
            }
            var hourNum = CalendarValidation.parseHour(hour);
            if (hourNum === null) {
                continue;
            }
            if (daySchedule[hour]) {
                occupied[hourNum] = true;
            }
        }

        return occupied;
    }

    /**
     * Get available hours for a day.
     * Returns individual empty cells (not duration-aware).
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour (optional, default: CALENDAR_START_HOUR)
     * @param {number} endHour - End hour (optional, default: CALENDAR_END_HOUR)
     * @returns {Array} Array of available hours
     */
    function getAvailableHours(schedule, day, startHour, endHour) {
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return [];
        }

        startHour = startHour !== undefined ? CalendarValidation.parseHour(startHour) : CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? CalendarValidation.parseHour(endHour) : CALENDAR_END_HOUR;

        if (startHour === null || endHour === null || startHour > endHour) {
            return [];
        }

        var available = [];

        if (!schedule || !schedule[dayNum]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        var daySchedule = schedule[dayNum];
        for (var h = startHour; h <= endHour; h++) {
            if (!daySchedule[h]) {
                available.push(h);
            }
        }

        return available;
    }

    /**
     * Get available start hours for a given duration.
     * Duration-aware: checks if a class of the given duration can start at each hour.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} duration - Duration in hours
     * @param {number} startHour - Start hour (optional, default: CALENDAR_START_HOUR)
     * @param {number} endHour - End hour (optional, default: CALENDAR_END_HOUR)
     * @returns {Array} Array of available start hours
     */
    function getAvailableStartHours(schedule, day, duration, startHour, endHour) {
        var dayNum = CalendarValidation.parseDay(day);
        var durationNum = CalendarValidation.parseDuration(duration);

        if (dayNum === null || durationNum === null) {
            return [];
        }

        startHour = startHour !== undefined ? CalendarValidation.parseHour(startHour) : CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? CalendarValidation.parseHour(endHour) : CALENDAR_END_HOUR;

        if (startHour === null || endHour === null || startHour > endHour) {
            return [];
        }

        var available = [];

        for (var h = startHour; h <= endHour - durationNum + 1; h++) {
            if (!ScheduleCore.hasConflict(schedule, dayNum, h, durationNum)) {
                available.push(h);
            }
        }

        return available;
    }

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
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);

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
     * Check if a day has any occupied hours.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @returns {boolean} True if the day has any occupied hours
     */
    function hasOccupiedHours(schedule, day) {
        var occupied = getOccupiedHours(schedule, day);
        return Object.keys(occupied).length > 0;
    }

    /**
     * Get all occupied days in a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @returns {Array} Array of day numbers that have occupied hours
     */
    function getOccupiedDays(schedule) {
        if (!schedule || typeof schedule !== 'object') {
            return [];
        }

        var days = [];
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = CalendarValidation.parseDay(day);
            if (dayNum === null) {
                continue;
            }
            if (hasOccupiedHours(schedule, dayNum)) {
                days.push(dayNum);
            }
        }

        return days.sort(function(a, b) {
            return a - b;
        });
    }

    /**
     * Get the total number of occupied hours in a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @returns {number} Total occupied hours
     */
    function getTotalOccupiedHours(schedule) {
        if (!schedule || typeof schedule !== 'object') {
            return 0;
        }

        var total = 0;
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = CalendarValidation.parseHour(hour);
                if (hourNum === null) {
                    continue;
                }
                if (daySchedule[hour]) {
                    total++;
                }
            }
        }

        return total;
    }

    /**
     * Get the total number of available hours in a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} startHour - Start hour (optional, default: CALENDAR_START_HOUR)
     * @param {number} endHour - End hour (optional, default: CALENDAR_END_HOUR)
     * @returns {number} Total available hours
     */
    function getTotalAvailableHours(schedule, startHour, endHour) {
        startHour = startHour !== undefined ? CalendarValidation.parseHour(startHour) : CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? CalendarValidation.parseHour(endHour) : CALENDAR_END_HOUR;

        if (startHour === null || endHour === null || startHour > endHour) {
            return 0;
        }

        var total = 0;
        var totalSlots = 7 * (endHour - startHour + 1);

        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            var occupied = getOccupiedHours(schedule, day);
            for (var h = startHour; h <= endHour; h++) {
                if (!occupied[h]) {
                    total++;
                }
            }
        }

        return total;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.__calendarGridCoreLoaded = true;

    window.CalendarGridCore = {
        // Grid building
        buildGrid: buildGrid,

        // Occupancy
        getOccupiedHours: getOccupiedHours,
        getAvailableHours: getAvailableHours,
        getAvailableStartHours: getAvailableStartHours,
        getContinuousOccupiedHours: getContinuousOccupiedHours,
        hasOccupiedHours: hasOccupiedHours,
        getOccupiedDays: getOccupiedDays,
        getTotalOccupiedHours: getTotalOccupiedHours,
        getTotalAvailableHours: getTotalAvailableHours,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        MAX_DURATION: MAX_DURATION,
        DAY_NAMES: DAY_NAMES
    };

})();