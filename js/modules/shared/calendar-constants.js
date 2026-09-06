/**
 * modules/shared/calendar-constants.js - Calendar Constants
 * Single source of truth for all calendar-related constants
 * Path: js/modules/shared/calendar-constants.js
 * 
 * This module provides:
 *   - Week number bounds (MIN_WEEK, MAX_WEEK)
 *   - Day number bounds (MIN_DAY, MAX_DAY)
 *   - Hour bounds (MIN_HOUR, MAX_HOUR, CALENDAR_START_HOUR, CALENDAR_END_HOUR)
 *   - Class duration bounds (MIN_CLASS_DURATION, MAX_CLASS_DURATION)
 *   - Year bounds (MIN_YEAR, MAX_YEAR)
 *   - Week/block constants (DAYS_IN_WEEK, WEEKS_PER_BLOCK)
 *   - Day name arrays (for calendar display)
 *   - Validation functions for all calendar values
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for calendar constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Validation runs BEFORE publishing to ensure integrity
 *   - No character-specific or domain-specific constants
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var CC = window.CalendarConstants;
 *   var minWeek = CC.MIN_WEEK;
 *   var valid = CC.isValidWeek(week);
 *   var dayName = CC.getDayName(3);
 *   var hours = CC.getHourOptions();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarConstantsLoaded) {
        return;
    }
    window.__calendarConstantsLoaded = true;

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

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

    var MIN_DAY = 1;  // Monday
    var MAX_DAY = 7;  // Sunday
    var DAYS_IN_WEEK = 7;

    // ============================================================
    // HOUR CONSTANTS
    // ============================================================

    var MIN_HOUR = 0;
    var MAX_HOUR = 23;
    var CALENDAR_START_HOUR = 5;   // 5:00 AM
    var CALENDAR_END_HOUR = 23;    // 11:00 PM

    // ============================================================
    // CLASS DURATION CONSTANTS
    // ============================================================

    var MIN_CLASS_DURATION = 1;
    var MAX_CLASS_DURATION = 4;

    // ============================================================
    // YEAR CONSTANTS
    // ============================================================

    var MIN_YEAR = 1900;
    var MAX_YEAR = 2100;

    // ============================================================
    // WEEK BLOCK CONSTANTS
    // ============================================================

    var WEEKS_PER_BLOCK = 2;

    // ============================================================
    // DAY NAMES - CANONICAL SOURCE OF TRUTH
    // ============================================================

    /**
     * Day names (1-indexed: Monday = 1, Sunday = 7)
     * Used for calendar display and formatting.
     */
    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    var DAY_NAMES_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    var DAY_NAMES_MIN = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

    /**
     * Day names (0-indexed: Sunday = 0, Saturday = 6)
     * Used for compatibility with JavaScript Date API.
     */
    var DAY_NAMES_0 = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var DAY_NAMES_SHORT_0 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var DAY_NAMES_MIN_0 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    var _dayNameMapLong = Object.create(null);
    DAY_NAMES.forEach(function(name, index) {
        if (index > 0) {
            _dayNameMapLong[name] = index;
        }
    });

    var _dayNameMapShort = Object.create(null);
    DAY_NAMES_SHORT.forEach(function(name, index) {
        if (index > 0) {
            _dayNameMapShort[name] = index;
        }
    });

    var _dayNameMapMin = Object.create(null);
    DAY_NAMES_MIN.forEach(function(name, index) {
        if (index > 0) {
            _dayNameMapMin[name] = index;
        }
    });

    // ============================================================
    // VALIDATION FUNCTIONS
    // ============================================================

    /**
     * Validate a week number.
     * 
     * @param {*} value - Week value to validate
     * @returns {number|null} Validated week or null
     */
    function isValidWeek(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    /**
     * Validate a day number.
     * 
     * @param {*} value - Day value to validate
     * @returns {number|null} Validated day or null
     */
    function isValidDay(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_DAY || num > MAX_DAY) {
            return null;
        }
        return num;
    }

    /**
     * Validate an hour number.
     * 
     * @param {*} value - Hour value to validate
     * @returns {number|null} Validated hour or null
     */
    function isValidHour(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_HOUR || num > MAX_HOUR) {
            return null;
        }
        return num;
    }

    /**
     * Validate a calendar display hour.
     * Calendar display hours are constrained to CALENDAR_START_HOUR to CALENDAR_END_HOUR.
     * 
     * @param {*} value - Hour value to validate
     * @returns {number|null} Validated hour or null
     */
    function isValidCalendarHour(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < CALENDAR_START_HOUR || num > CALENDAR_END_HOUR) {
            return null;
        }
        return num;
    }

    /**
     * Validate a class duration.
     * 
     * @param {*} value - Duration value to validate
     * @returns {number|null} Validated duration or null
     */
    function isValidDuration(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_CLASS_DURATION || num > MAX_CLASS_DURATION) {
            return null;
        }
        return num;
    }

    /**
     * Validate a year number.
     * 
     * @param {*} value - Year value to validate
     * @returns {number|null} Validated year or null
     */
    function isValidYear(value) {
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_YEAR || num > MAX_YEAR) {
            return null;
        }
        return num;
    }

    /**
     * Check if a week number is valid (returns boolean).
     * 
     * @param {*} value - Week value to check
     * @returns {boolean} True if valid
     */
    function isWeekValid(value) {
        return isValidWeek(value) !== null;
    }

    /**
     * Check if a day number is valid (returns boolean).
     * 
     * @param {*} value - Day value to check
     * @returns {boolean} True if valid
     */
    function isDayValid(value) {
        return isValidDay(value) !== null;
    }

    /**
     * Check if an hour number is valid (returns boolean).
     * 
     * @param {*} value - Hour value to check
     * @returns {boolean} True if valid
     */
    function isHourValid(value) {
        return isValidHour(value) !== null;
    }

    /**
     * Check if a calendar display hour is valid (returns boolean).
     * 
     * @param {*} value - Hour value to check
     * @returns {boolean} True if valid
     */
    function isCalendarHourValid(value) {
        return isValidCalendarHour(value) !== null;
    }

    /**
     * Check if a duration is valid (returns boolean).
     * 
     * @param {*} value - Duration value to check
     * @returns {boolean} True if valid
     */
    function isDurationValid(value) {
        return isValidDuration(value) !== null;
    }

    /**
     * Check if a year is valid (returns boolean).
     * 
     * @param {*} value - Year value to check
     * @returns {boolean} True if valid
     */
    function isYearValid(value) {
        return isValidYear(value) !== null;
    }

    // ============================================================
    // DAY NAME LOOKUP FUNCTIONS
    // ============================================================

    /**
     * Get day name by number.
     * 
     * @param {number} day - Day number (1-7, Monday=1)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     */
    function getDayName(day, format) {
        format = format || 'long';

        var num = isValidDay(day);
        if (num === null) {
            return 'Unknown';
        }

        if (format === 'short') {
            return DAY_NAMES_SHORT[num] || 'Unknown';
        }
        if (format === 'min') {
            return DAY_NAMES_MIN[num] || 'Unknown';
        }

        return DAY_NAMES[num] || 'Unknown';
    }

    /**
     * Get day name (0-indexed) by number.
     * 
     * @param {number} day - Day number (0-6, Sunday=0)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     */
    function getDayName0(day, format) {
        format = format || 'long';

        var num = Number(day);
        if (!Number.isInteger(num) || num < 0 || num > 6) {
            return 'Unknown';
        }

        if (format === 'short') {
            return DAY_NAMES_SHORT_0[num] || 'Unknown';
        }
        if (format === 'min') {
            return DAY_NAMES_MIN_0[num] || 'Unknown';
        }

        return DAY_NAMES_0[num] || 'Unknown';
    }

    /**
     * Get day number from day name.
     * 
     * @param {string} dayName - Day name (e.g., 'Monday', 'Mon', 'Mo')
     * @returns {number|null} Day number (1-7) or null
     */
    function getDayNumber(dayName) {
        if (!dayName || typeof dayName !== 'string') {
            return null;
        }

        var key = dayName.trim();

        // Try long names first
        if (_dayNameMapLong[key] !== undefined) {
            return _dayNameMapLong[key];
        }

        // Try short names
        if (_dayNameMapShort[key] !== undefined) {
            return _dayNameMapShort[key];
        }

        // Try min names
        if (_dayNameMapMin[key] !== undefined) {
            return _dayNameMapMin[key];
        }

        // Try case-insensitive
        var lower = key.toLowerCase();
        for (var i = 1; i < DAY_NAMES.length; i++) {
            if (DAY_NAMES[i].toLowerCase() === lower) {
                return i;
            }
            if (DAY_NAMES_SHORT[i] && DAY_NAMES_SHORT[i].toLowerCase() === lower) {
                return i;
            }
            if (DAY_NAMES_MIN[i] && DAY_NAMES_MIN[i].toLowerCase() === lower) {
                return i;
            }
        }

        return null;
    }

    // ============================================================
    // HOUR HELPERS
    // ============================================================

    /**
     * Get hour options for select dropdowns.
     * 
     * @param {number} startHour - Start hour (optional, default: CALENDAR_START_HOUR)
     * @param {number} endHour - End hour (optional, default: CALENDAR_END_HOUR)
     * @param {boolean} includeMinutes - Whether to include ":00" (default: true)
     * @returns {Array<{value: number, label: string}>} Array of hour options
     */
    function getHourOptions(startHour, endHour, includeMinutes) {
        startHour = startHour !== undefined ? isValidCalendarHour(startHour) : CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? isValidCalendarHour(endHour) : CALENDAR_END_HOUR;

        if (startHour === null || endHour === null || startHour > endHour) {
            return [];
        }

        includeMinutes = includeMinutes !== false;

        var options = [];
        for (var h = startHour; h <= endHour; h++) {
            options.push({
                value: h,
                label: formatHour(h, includeMinutes)
            });
        }
        return options;
    }

    /**
     * Format an hour number to a display string.
     * 
     * @param {number} hour - Hour number (0-23)
     * @param {boolean} includeMinutes - Whether to include ":00" (default: true)
     * @returns {string} Formatted hour string
     */
    function formatHour(hour, includeMinutes) {
        includeMinutes = includeMinutes !== false;

        var num = isValidHour(hour);
        if (num === null) {
            return String(hour);
        }

        var displayHour = num > 12 ? num - 12 : num;
        if (num === 0) displayHour = 12;
        var ampm = num >= 12 ? 'PM' : 'AM';

        return displayHour + (includeMinutes ? ':00 ' : ' ') + ampm;
    }

    /**
     * Parse a time string to hour number.
     * 
     * @param {string} timeStr - Time string (e.g., "9:00 AM", "14:00")
     * @returns {number|null} Hour number (0-23) or null
     */
    function parseHour(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') {
            return null;
        }

        var trimmed = timeStr.trim().toUpperCase();

        // Try 24-hour format
        var match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
        if (match24) {
            var hour = parseInt(match24[1], 10);
            var minute = parseInt(match24[2], 10);
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return hour;
            }
        }

        // Try 12-hour format
        var match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (match12) {
            var hour = parseInt(match12[1], 10);
            var minute = parseInt(match12[2], 10);
            var ampm = match12[3];
            if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
                if (ampm === 'PM' && hour < 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                return hour;
            }
        }

        // Try without minutes
        var matchSimple = trimmed.match(/^(\d{1,2})\s*(AM|PM)?$/);
        if (matchSimple) {
            var hour = parseInt(matchSimple[1], 10);
            if (matchSimple[2]) {
                var ampm = matchSimple[2];
                if (hour >= 1 && hour <= 12) {
                    if (ampm === 'PM' && hour < 12) hour += 12;
                    if (ampm === 'AM' && hour === 12) hour = 0;
                    return hour;
                }
            } else {
                // 24-hour without AM/PM
                if (hour >= 0 && hour <= 23) {
                    return hour;
                }
            }
        }

        return null;
    }

    // ============================================================
    // WEEK BLOCK HELPERS
    // ============================================================

    /**
     * Get the week block for a given week.
     * Blocks are: 1-2, 3-4, 5-6, etc.
     * 
     * @param {number} weekNum - Week number (1-52)
     * @returns {object|null} { start: number, end: number, block: number, label: string }
     */
    function getWeekBlock(weekNum) {
        var num = isValidWeek(weekNum);
        if (num === null) {
            return null;
        }

        var blockIndex = Math.floor((num - 1) / WEEKS_PER_BLOCK);
        var start = (blockIndex * WEEKS_PER_BLOCK) + 1;
        var end = Math.min(start + WEEKS_PER_BLOCK - 1, MAX_WEEK);

        return {
            start: start,
            end: end,
            block: blockIndex + 1,
            label: 'Wk ' + start + '-' + end
        };
    }

    /**
     * Get all week blocks for the academic year.
     * 
     * @returns {Array} Array of block objects
     */
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
                week: i // Center week for display
            });
        }
        return blocks;
    }

    /**
     * Get the block number for a given week.
     * 
     * @param {number} weekNum - Week number (1-52)
     * @returns {number|null} Block number or null
     */
    function getWeekBlockNumber(weekNum) {
        var num = isValidWeek(weekNum);
        if (num === null) {
            return null;
        }
        return Math.floor((num - 1) / WEEKS_PER_BLOCK) + 1;
    }

    /**
     * Get the week range for a given block number.
     * 
     * @param {number} blockNum - Block number (1-26)
     * @returns {object|null} { start: number, end: number, label: string }
     */
    function getBlockRange(blockNum) {
        var num = Number(blockNum);
        var maxBlocks = Math.ceil(MAX_WEEK / WEEKS_PER_BLOCK);
        if (!Number.isInteger(num) || num < 1 || num > maxBlocks) {
            return null;
        }

        var start = (num - 1) * WEEKS_PER_BLOCK + 1;
        var end = Math.min(start + WEEKS_PER_BLOCK - 1, MAX_WEEK);

        return {
            start: start,
            end: end,
            label: 'Wk ' + start + '-' + end
        };
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // Week bounds
        if (typeof MIN_WEEK !== 'number' || MIN_WEEK < 1) {
            errors.push('MIN_WEEK must be a positive number.');
        }
        if (typeof MAX_WEEK !== 'number' || MAX_WEEK <= MIN_WEEK) {
            errors.push('MAX_WEEK must be greater than MIN_WEEK.');
        }

        // Day bounds
        if (typeof MIN_DAY !== 'number' || MIN_DAY < 1 || MIN_DAY > 7) {
            errors.push('MIN_DAY must be between 1 and 7.');
        }
        if (typeof MAX_DAY !== 'number' || MAX_DAY > 7 || MAX_DAY <= MIN_DAY) {
            errors.push('MAX_DAY must be greater than MIN_DAY and at most 7.');
        }
        if (typeof DAYS_IN_WEEK !== 'number' || DAYS_IN_WEEK !== 7) {
            errors.push('DAYS_IN_WEEK must be 7.');
        }

        // Hour bounds
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

        // Duration bounds
        if (typeof MIN_CLASS_DURATION !== 'number' || MIN_CLASS_DURATION < 1) {
            errors.push('MIN_CLASS_DURATION must be a positive number.');
        }
        if (typeof MAX_CLASS_DURATION !== 'number' || MAX_CLASS_DURATION <= MIN_CLASS_DURATION || MAX_CLASS_DURATION > 8) {
            errors.push('MAX_CLASS_DURATION must be greater than MIN_CLASS_DURATION and at most 8.');
        }

        // Year bounds
        if (typeof MIN_YEAR !== 'number' || MIN_YEAR < 1) {
            errors.push('MIN_YEAR must be a positive number.');
        }
        if (typeof MAX_YEAR !== 'number' || MAX_YEAR <= MIN_YEAR) {
            errors.push('MAX_YEAR must be greater than MIN_YEAR.');

        }

        // Week block
        if (typeof WEEKS_PER_BLOCK !== 'number' || WEEKS_PER_BLOCK < 1) {
            errors.push('WEEKS_PER_BLOCK must be a positive number.');
        }

        // Day name arrays
        if (!Array.isArray(DAY_NAMES) || DAY_NAMES.length !== 8) {
            errors.push('DAY_NAMES must be an array of length 8.');
        }
        if (!Array.isArray(DAY_NAMES_SHORT) || DAY_NAMES_SHORT.length !== 8) {
            errors.push('DAY_NAMES_SHORT must be an array of length 8.');
        }
        if (!Array.isArray(DAY_NAMES_MIN) || DAY_NAMES_MIN.length !== 8) {
            errors.push('DAY_NAMES_MIN must be an array of length 8.');
        }
        if (!Array.isArray(DAY_NAMES_0) || DAY_NAMES_0.length !== 7) {
            errors.push('DAY_NAMES_0 must be an array of length 7.');
        }
        if (!Array.isArray(DAY_NAMES_SHORT_0) || DAY_NAMES_SHORT_0.length !== 7) {
            errors.push('DAY_NAMES_SHORT_0 must be an array of length 7.');
        }
        if (!Array.isArray(DAY_NAMES_MIN_0) || DAY_NAMES_MIN_0.length !== 7) {
            errors.push('DAY_NAMES_MIN_0 must be an array of length 7.');
        }

        if (errors.length > 0) {
            throw new Error('CalendarConstants validation failed:\n  ' + errors.join('\n  '));
        }

        return true;
    }

    // ============================================================
    // VALIDATE BEFORE PUBLISHING
    // ============================================================

    try {
        validateConstants();
        console.log('[CalendarConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[CalendarConstants] Validation failed:', e.message);
        throw e;
    }

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(DAY_NAMES);
    deepFreeze(DAY_NAMES_SHORT);
    deepFreeze(DAY_NAMES_MIN);
    deepFreeze(DAY_NAMES_0);
    deepFreeze(DAY_NAMES_SHORT_0);
    deepFreeze(DAY_NAMES_MIN_0);
    deepFreeze(_dayNameMapLong);
    deepFreeze(_dayNameMapShort);
    deepFreeze(_dayNameMapMin);

    // ============================================================
    // EXPOSE
    // ============================================================

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

        // Year
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR,

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

        // Validation (public for testing)
        validateConstants: validateConstants
    });

    // ============================================================
    // LEGACY COMPATIBILITY (DEPRECATED - Will be removed)
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from old constants structure.
    // They will be removed in a future version.

    window.MIN_WEEK = MIN_WEEK;
    window.MAX_WEEK = MAX_WEEK;
    window.MIN_DAY = MIN_DAY;
    window.MAX_DAY = MAX_DAY;
    window.MIN_HOUR = MIN_HOUR;
    window.MAX_HOUR = MAX_HOUR;
    window.CALENDAR_START_HOUR = CALENDAR_START_HOUR;
    window.CALENDAR_END_HOUR = CALENDAR_END_HOUR;
    window.MIN_CLASS_DURATION = MIN_CLASS_DURATION;
    window.MAX_CLASS_DURATION = MAX_CLASS_DURATION;
    window.MIN_YEAR = MIN_YEAR;
    window.MAX_YEAR = MAX_YEAR;
    window.WEEKS_PER_BLOCK = WEEKS_PER_BLOCK;
    window.DAY_NAMES = DAY_NAMES;
    window.DAY_NAMES_SHORT = DAY_NAMES_SHORT;
    window.DAY_NAMES_MIN = DAY_NAMES_MIN;
    window.DAY_NAMES_0 = DAY_NAMES_0;
    window.DAY_NAMES_SHORT_0 = DAY_NAMES_SHORT_0;
    window.DAY_NAMES_MIN_0 = DAY_NAMES_MIN_0;

    // Legacy compatibility for CalendarUtils constants
    window.getDayName = getDayName;
    window.getDayNumber = getDayNumber;
    window.formatHour = formatHour;
    window.parseHour = parseHour;
    window.getHourOptions = getHourOptions;
    window.getWeekBlock = getWeekBlock;
    window.getAllWeekBlocks = getAllWeekBlocks;
    window.getWeekBlockNumber = getWeekBlockNumber;
    window.getBlockRange = getBlockRange;

    // Legacy compatibility for validation
    window.isValidWeek = isValidWeek;
    window.isValidDay = isValidDay;
    window.isValidHour = isValidHour;
    window.isValidDuration = isValidDuration;
    window.isValidYear = isValidYear;

})();