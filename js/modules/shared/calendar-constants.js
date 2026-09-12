/**
 * shared/constants/calendar-constants.js - Calendar Constants
 * Single source of truth for all calendar-related constants
 * 
 * This module provides:
 *   - Week number bounds (MIN_WEEK, MAX_WEEK)
 *   - Day number bounds (MIN_DAY, MAX_DAY)
 *   - Hour bounds (MIN_HOUR, MAX_HOUR, CALENDAR_START_HOUR, CALENDAR_END_HOUR)
 *   - Class duration bounds (MIN_CLASS_DURATION, MAX_CLASS_DURATION)
 *   - Week/block constants (DAYS_IN_WEEK, WEEKS_PER_BLOCK)
 *   - Day name arrays (for calendar display)
 *   - Validation functions for all calendar values
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for calendar constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Validation runs BEFORE publishing to ensure integrity
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Any integer >= 1 is a valid year.
 *   - This is deliberate: the application deals with fictional
 *     timelines and shouldn't impose artificial bounds.
 *   - Weeks and days remain bounded (they have real semantic
 *     meaning: 52 weeks per year, 7 days per week).
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 */

(function() {
    'use strict';

    if (window.__calendarConstantsLoaded) return;
    window.__calendarConstantsLoaded = true;

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }
        return Object.freeze(obj);
    }

    // ============================================================
    // WEEK CONSTANTS
    // ============================================================

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;

    // ============================================================
    // DAY CONSTANTS
    // ============================================================

    var MIN_DAY = 1;
    var MAX_DAY = 7;
    var DAYS_IN_WEEK = 7;

    // ============================================================
    // HOUR CONSTANTS
    // ============================================================

    var MIN_HOUR = 0;
    var MAX_HOUR = 23;
    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;

    // ============================================================
    // CLASS DURATION CONSTANTS
    // ============================================================

    var MIN_CLASS_DURATION = 1;
    var MAX_CLASS_DURATION = 4;

    // ============================================================
    // WEEK BLOCK CONSTANTS
    // ============================================================

    var WEEKS_PER_BLOCK = 2;

    // ============================================================
    // DAY NAMES - CANONICAL SOURCE OF TRUTH
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DAY_NAMES_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var DAY_NAMES_MIN = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    var DAY_NAMES_0 = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var DAY_NAMES_SHORT_0 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var DAY_NAMES_MIN_0 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    var _dayNameMapLong = Object.create(null);
    DAY_NAMES.forEach(function(name, index) {
        if (index > 0) { _dayNameMapLong[name] = index; }
    });

    var _dayNameMapShort = Object.create(null);
    DAY_NAMES_SHORT.forEach(function(name, index) {
        if (index > 0) { _dayNameMapShort[name] = index; }
    });

    var _dayNameMapMin = Object.create(null);
    DAY_NAMES_MIN.forEach(function(name, index) {
        if (index > 0) { _dayNameMapMin[name] = index; }
    });

    // ============================================================
    // VALIDATION FUNCTIONS - Return number or null
    // ============================================================

    function isValidWeek(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    function isValidDay(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_DAY || num > MAX_DAY) {
            return null;
        }
        return num;
    }

    function isValidHour(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_HOUR || num > MAX_HOUR) {
            return null;
        }
        return num;
    }

    function isValidCalendarHour(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < CALENDAR_START_HOUR || num > CALENDAR_END_HOUR) {
            return null;
        }
        return num;
    }

    function isValidDuration(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_CLASS_DURATION || num > MAX_CLASS_DURATION) {
            return null;
        }
        return num;
    }

    /**
     * Validate a year value.
     * 
     * Years are UNBOUNDED positive integers. Any integer >= 1 is
     * considered a valid year.
     * 
     * @param {*} value - Value to validate
     * @returns {number|null} Parsed year or null if invalid
     */
    function isValidYear(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
            return null;
        }
        return num;
    }

    function isWeekValid(value) {
        return isValidWeek(value) !== null;
    }

    function isDayValid(value) {
        return isValidDay(value) !== null;
    }

    function isHourValid(value) {
        return isValidHour(value) !== null;
    }

    function isCalendarHourValid(value) {
        return isValidCalendarHour(value) !== null;
    }

    function isDurationValid(value) {
        return isValidDuration(value) !== null;
    }

    function isYearValid(value) {
        return isValidYear(value) !== null;
    }

    // ============================================================
    // DAY NAME LOOKUP FUNCTIONS
    // ============================================================

    function getDayName(day, format) {
        format = format || 'long';
        var num = isValidDay(day);
        if (num === null) { return 'Unknown'; }
        if (format === 'short') { return DAY_NAMES_SHORT[num] || 'Unknown'; }
        if (format === 'min') { return DAY_NAMES_MIN[num] || 'Unknown'; }
        return DAY_NAMES[num] || 'Unknown';
    }

    function getDayName0(day, format) {
        format = format || 'long';
        var num = Number(day);
        if (!Number.isInteger(num) || num < 0 || num > 6) { return 'Unknown'; }
        if (format === 'short') { return DAY_NAMES_SHORT_0[num] || 'Unknown'; }
        if (format === 'min') { return DAY_NAMES_MIN_0[num] || 'Unknown'; }
        return DAY_NAMES_0[num] || 'Unknown';
    }

    function getDayNumber(dayName) {
        if (!dayName || typeof dayName !== 'string') { return null; }
        var key = dayName.trim();
        if (_dayNameMapLong[key] !== undefined) { return _dayNameMapLong[key]; }
        if (_dayNameMapShort[key] !== undefined) { return _dayNameMapShort[key]; }
        if (_dayNameMapMin[key] !== undefined) { return _dayNameMapMin[key]; }
        var lower = key.toLowerCase();
        for (var i = 1; i < DAY_NAMES.length; i++) {
            if (DAY_NAMES[i].toLowerCase() === lower) { return i; }
            if (DAY_NAMES_SHORT[i] && DAY_NAMES_SHORT[i].toLowerCase() === lower) { return i; }
            if (DAY_NAMES_MIN[i] && DAY_NAMES_MIN[i].toLowerCase() === lower) { return i; }
        }
        return null;
    }

    // ============================================================
    // HOUR HELPERS
    // ============================================================

    function getHourOptions(startHour, endHour, includeMinutes) {
        startHour = startHour !== undefined ? isValidCalendarHour(startHour) : CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? isValidCalendarHour(endHour) : CALENDAR_END_HOUR;
        if (startHour === null || endHour === null || startHour > endHour) { return []; }
        includeMinutes = includeMinutes !== false;
        var options = [];
        for (var h = startHour; h <= endHour; h++) {
            options.push({ value: h, label: formatHour(h, includeMinutes) });
        }
        return options;
    }

    function formatHour(hour, includeMinutes) {
        includeMinutes = includeMinutes !== false;
        var num = isValidHour(hour);
        if (num === null) { return String(hour); }
        var displayHour = num > 12 ? num - 12 : num;
        if (num === 0) { displayHour = 12; }
        var ampm = num >= 12 ? 'PM' : 'AM';
        return displayHour + (includeMinutes ? ':00 ' : ' ') + ampm;
    }

    function parseHour(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') { return null; }
        var trimmed = timeStr.trim().toUpperCase();
        var match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
        if (match24) {
            var hour = parseInt(match24[1], 10);
            var minute = parseInt(match24[2], 10);
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) { return hour; }
        }
        var match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (match12) {
            var hour = parseInt(match12[1], 10);
            var minute = parseInt(match12[2], 10);
            var ampm = match12[3];
            if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
                if (ampm === 'PM' && hour < 12) { hour += 12; }
                if (ampm === 'AM' && hour === 12) { hour = 0; }
                return hour;
            }
        }
        var matchSimple = trimmed.match(/^(\d{1,2})\s*(AM|PM)?$/);
        if (matchSimple) {
            var hour = parseInt(matchSimple[1], 10);
            if (matchSimple[2]) {
                var ampm = matchSimple[2];
                if (hour >= 1 && hour <= 12) {
                    if (ampm === 'PM' && hour < 12) { hour += 12; }
                    if (ampm === 'AM' && hour === 12) { hour = 0; }
                    return hour;
                }
            } else {
                if (hour >= 0 && hour <= 23) { return hour; }
            }
        }
        return null;
    }

    // ============================================================
    // WEEK BLOCK HELPERS
    // ============================================================

    function getWeekBlock(weekNum) {
        var num = isValidWeek(weekNum);
        if (num === null) { return null; }
        var blockIndex = Math.floor((num - 1) / WEEKS_PER_BLOCK);
        var start = (blockIndex * WEEKS_PER_BLOCK) + 1;
        var end = Math.min(start + WEEKS_PER_BLOCK - 1, MAX_WEEK);
        return { start: start, end: end, block: blockIndex + 1, label: 'Wk ' + start + '-' + end };
    }

    function getAllWeekBlocks() {
        var blocks = [];
        for (var i = 1; i <= MAX_WEEK; i += WEEKS_PER_BLOCK) {
            var start = i;
            var end = Math.min(i + WEEKS_PER_BLOCK - 1, MAX_WEEK);
            blocks.push({
                start: start,
                end: end,
                block: Math.floor((i - 1) / WEEKS_PER_BLOCK) + 1,
                label: 'Wk ' + start + '-' + end,
                week: i
            });
        }
        return blocks;
    }

    function getWeekBlockNumber(weekNum) {
        var num = isValidWeek(weekNum);
        if (num === null) { return null; }
        return Math.floor((num - 1) / WEEKS_PER_BLOCK) + 1;
    }

    function getBlockRange(blockNum) {
        var num = Number(blockNum);
        var maxBlocks = Math.ceil(MAX_WEEK / WEEKS_PER_BLOCK);
        if (!Number.isInteger(num) || num < 1 || num > maxBlocks) { return null; }
        var start = (num - 1) * WEEKS_PER_BLOCK + 1;
        var end = Math.min(start + WEEKS_PER_BLOCK - 1, MAX_WEEK);
        return { start: start, end: end, label: 'Wk ' + start + '-' + end };
    }

    // ============================================================
    // VALIDATE CONSTANTS
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (typeof MIN_WEEK !== 'number' || MIN_WEEK < 1) {
            errors.push('MIN_WEEK must be a positive number.');
        }
        if (typeof MAX_WEEK !== 'number' || MAX_WEEK <= MIN_WEEK) {
            errors.push('MAX_WEEK must be greater than MIN_WEEK.');
        }
        if (typeof MIN_DAY !== 'number' || MIN_DAY < 1 || MIN_DAY > 7) {
            errors.push('MIN_DAY must be between 1 and 7.');
        }
        if (typeof MAX_DAY !== 'number' || MAX_DAY > 7 || MAX_DAY <= MIN_DAY) {
            errors.push('MAX_DAY must be greater than MIN_DAY and at most 7.');
        }
        if (typeof DAYS_IN_WEEK !== 'number' || DAYS_IN_WEEK !== 7) {
            errors.push('DAYS_IN_WEEK must be 7.');
        }
        if (typeof MIN_HOUR !== 'number' || MIN_HOUR < 0 || MIN_HOUR > 23) {
            errors.push('MIN_HOUR must be between 0 and 23.');
        }
        if (typeof MAX_HOUR !== 'number' || MAX_HOUR > 23 || MAX_HOUR <= MIN_HOUR) {
            errors.push('MAX_HOUR must be greater than MIN_HOUR and at most 23.');
        }
        if (typeof CALENDAR_START_HOUR !== 'number' || CALENDAR_START_HOUR < MIN_HOUR || CALENDAR_START_HOUR > MAX_HOUR) {
            errors.push('CALENDAR_START_HOUR must be between MIN_HOUR and MAX_HOUR.');
        }
        if (typeof CALENDAR_END_HOUR !== 'number' || CALENDAR_END_HOUR < CALENDAR_START_HOUR || CALENDAR_END_HOUR > MAX_HOUR) {
            errors.push('CALENDAR_END_HOUR must be between CALENDAR_START_HOUR and MAX_HOUR.');
        }
        if (typeof MIN_CLASS_DURATION !== 'number' || MIN_CLASS_DURATION < 1) {
            errors.push('MIN_CLASS_DURATION must be a positive number.');
        }
        if (typeof MAX_CLASS_DURATION !== 'number' || MAX_CLASS_DURATION <= MIN_CLASS_DURATION || MAX_CLASS_DURATION > 8) {
            errors.push('MAX_CLASS_DURATION must be greater than MIN_CLASS_DURATION and at most 8.');
        }
        if (typeof WEEKS_PER_BLOCK !== 'number' || WEEKS_PER_BLOCK < 1) {
            errors.push('WEEKS_PER_BLOCK must be a positive number.');
        }

        if (errors.length > 0) {
            console.warn('[CalendarConstants] Validation errors:', errors);
        }
        return errors.length === 0;
    }

    validateConstants();

    deepFreeze(DAY_NAMES);
    deepFreeze(DAY_NAMES_SHORT);
    deepFreeze(DAY_NAMES_MIN);
    deepFreeze(DAY_NAMES_0);
    deepFreeze(DAY_NAMES_SHORT_0);
    deepFreeze(DAY_NAMES_MIN_0);

    window.CalendarConstants = Object.freeze({
        // Week
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        // Day
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        DAYS_IN_WEEK: DAYS_IN_WEEK,
        // Hour
        MIN_HOUR: MIN_HOUR,
        MAX_HOUR: MAX_HOUR,
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        // Duration
        MIN_CLASS_DURATION: MIN_CLASS_DURATION,
        MAX_CLASS_DURATION: MAX_CLASS_DURATION,
        // Week blocks
        WEEKS_PER_BLOCK: WEEKS_PER_BLOCK,
        // Day names (1-indexed)
        DAY_NAMES: DAY_NAMES,
        DAY_NAMES_SHORT: DAY_NAMES_SHORT,
        DAY_NAMES_MIN: DAY_NAMES_MIN,
        // Day names (0-indexed)
        DAY_NAMES_0: DAY_NAMES_0,
        DAY_NAMES_SHORT_0: DAY_NAMES_SHORT_0,
        DAY_NAMES_MIN_0: DAY_NAMES_MIN_0,
        // Validation (returns number or null)
        isValidWeek: isValidWeek,
        isValidDay: isValidDay,
        isValidHour: isValidHour,
        isValidCalendarHour: isValidCalendarHour,
        isValidDuration: isValidDuration,
        isValidYear: isValidYear,
        // Validation (returns boolean)
        isWeekValid: isWeekValid,
        isDayValid: isDayValid,
        isHourValid: isHourValid,
        isCalendarHourValid: isCalendarHourValid,
        isDurationValid: isDurationValid,
        isYearValid: isYearValid,
        // Day name lookup
        getDayName: getDayName,
        getDayName0: getDayName0,
        getDayNumber: getDayNumber,
        // Hour helpers
        getHourOptions: getHourOptions,
        formatHour: formatHour,
        parseHour: parseHour,
        // Week blocks
        getWeekBlock: getWeekBlock,
        getAllWeekBlocks: getAllWeekBlocks,
        getWeekBlockNumber: getWeekBlockNumber,
        getBlockRange: getBlockRange,
        validateConstants: validateConstants
    });

})();