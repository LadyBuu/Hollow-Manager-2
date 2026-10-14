/**
 * utils/calendar-validation.js - Calendar Validation
 * Canonical single source of truth for all calendar validation
 * Path: js/utils/calendar-validation.js
 *
 * This module provides:
 *   - Strict validation and parsing of calendar values
 *   - Week, day, hour, duration validation
 *   - Year validation (unbounded positive safe integers)
 *   - Calendar date validation (year + month + day)
 *
 * IMPORTANT:
 *   - This is the CANONICAL validation layer for calendar values.
 *     All modules MUST use these functions.
 *   - Parse functions return null for invalid input. They never
 *     return NaN, and they never throw on invalid input.
 *   - No domain knowledge - calendar concepts only.
 *
 * STRICTNESS:
 *   Every parse function accepts only:
 *     - numbers that are already integers in range
 *     - strings matching /^\d+$/ (digits only, no sign, no decimal,
 *       no exponent, no hex)
 *
 *   Rejected examples (all return null):
 *     true, false, [5], new Date(), {}, Symbol(), undefined
 *     '0x5', '1e1', '5.0', '-5', '+5', ' 5 ', ''
 *
 *   The previous version coerced via Number() and accepted most
 *   of these. Because this module claims to be "strict" and
 *   "canonical", it now actually is.
 *
 * DEPENDENCIES - LAZY:
 *   CalendarConstants is required by the bounded integer parsers
 *   (parseWeek, parseDay, parseHour, parseCalendarHour,
 *   parseDuration, parseSlot, parseInRange, isInRange) and the
 *   bounds accessors. It is resolved at CALL time, not at load
 *   time, so this module loads cleanly regardless of script order.
 *   A caller that invokes a bounded parser before
 *   CalendarConstants is on window gets a clear error naming the
 *   missing file.
 *
 *   parseYear and isValidCalendarDate have NO dependency on
 *   CalendarConstants. They work regardless of load order.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive SAFE integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Any Number.isSafeInteger value >= 1 is a valid year.
 *   - parseYear() rejects non-safe integers (e.g. 1e21).
 *   - Weeks and days remain bounded: 52 weeks per year, 7 days
 *     per week, both with real semantic meaning.
 *
 * CALENDAR DATE SEMANTICS:
 *   - isValidCalendarDate(y, m, d) validates a (year, month, day)
 *     triple against the real Gregorian calendar.
 *   - Year is unbounded (any positive safe integer).
 *   - Month is 1-12.
 *   - Day is 1-31, and must fit the month. Feb 30 is rejected.
 *     Feb 29 is accepted only in leap years.
 *   - Uses a leap-year formula and month table, not a Date
 *     object. This avoids the local-time and year-range quirks
 *     of `new Date(y, m, 0)`.
 *   - Returns a boolean. Does not return a parsed date.
 *
 * PARSEHOUR NAME CLASH:
 *   This module's parseHour(value) validates a NUMERIC hour value
 *   against [MIN_HOUR, MAX_HOUR]. FormatUtils.parseHour(timeStr)
 *   parses a TIME STRING like '9:00 AM' to a 0-23 integer. They
 *   are different functions with the same name. FormatUtils has
 *   been renamed to parseTimeString; the old name remains as a
 *   deprecated alias.
 *
 * SLOT SEMANTICS:
 *   parseSlot validates a (week, day, hour, duration) tuple and
 *   ensures the resulting slot fits within the calendar grid:
 *   hour + duration - 1 <= CALENDAR_END_HOUR.
 *
 * USAGE:
 *   var CV = window.CalendarValidation;
 *   var week = CV.parseWeek(input);
 *   if (week === null) { ... }
 *   var dateOk = CV.isValidCalendarDate(2026, 2, 29); // false
 *   var dateOk = CV.isValidCalendarDate(2024, 2, 29); // true
 */

(function() {
    'use strict';

    if (window.__calendarValidationLoaded) {
        return;
    }
    window.__calendarValidationLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================
    //
    // CalendarConstants is required by the bounded parsers and the
    // bounds accessors. It is resolved at CALL time, not at load
    // time. parseYear and isValidCalendarDate do not need it.

    var REQUIRED_CONSTANTS = [
        'MIN_WEEK', 'MAX_WEEK',
        'MIN_DAY', 'MAX_DAY',
        'MIN_HOUR', 'MAX_HOUR',
        'MIN_CLASS_DURATION', 'MAX_CLASS_DURATION',
        'CALENDAR_START_HOUR', 'CALENDAR_END_HOUR'
    ];

    function requireCalendarConstants(calleeName) {
        var CC = window.CalendarConstants;

        if (!CC || typeof CC !== 'object') {
            throw new Error(
                '[CalendarValidation] ' + calleeName + ' requires ' +
                'CalendarConstants, which is not loaded. Ensure ' +
                'js/utils/calendar-constants.js is included in the ' +
                'page before this function is called.'
            );
        }

        for (var i = 0; i < REQUIRED_CONSTANTS.length; i++) {
            var key = REQUIRED_CONSTANTS[i];
            if (typeof CC[key] !== 'number') {
                throw new Error(
                    '[CalendarValidation] ' + calleeName +
                    ' requires CalendarConstants.' + key +
                    ', which is missing or not a number. The ' +
                    'CalendarConstants module may be an older ' +
                    'version.'
                );
            }
        }

        return CC;
    }

    // ============================================================
    // PRIVATE HELPERS - dependency-free
    // ============================================================

    /**
     * Strict integer coercion from a numeric or digit-string value.
     *
     * Accepts:
     *   - numbers that are already integers
     *   - strings matching /^\d+$/
     *
     * Rejects everything else. Returns null on rejection.
     *
     * Dependency-free: parseYear and isValidCalendarDate use this
     * without touching CalendarConstants.
     */
    function strictInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }

        if (typeof value !== 'string') {
            return null;
        }

        var trimmed = value.trim();
        if (trimmed === '') {
            return null;
        }

        if (!/^\d+$/.test(trimmed)) {
            return null;
        }

        var parsed = Number(trimmed);
        if (!Number.isInteger(parsed)) {
            return null;
        }

        return parsed;
    }

    /**
     * Parse a bounded integer in [min, max]. Shared by week, day,
     * hour, calendar hour, and duration parsers.
     */
    function parseBoundedInteger(value, min, max) {
        var parsed = strictInteger(value);
        if (parsed === null) {
            return null;
        }
        if (parsed < min || parsed > max) {
            return null;
        }
        return parsed;
    }

    // ============================================================
    // WEEK VALIDATION
    // ============================================================

    function parseWeek(value) {
        var CC = requireCalendarConstants('parseWeek');
        return parseBoundedInteger(value, CC.MIN_WEEK, CC.MAX_WEEK);
    }

    function isWeekValid(value) {
        return parseWeek(value) !== null;
    }

    // ============================================================
    // DAY VALIDATION
    // ============================================================
    //
    // NOTE: "day" here means day of week (1-7, Monday=1). This is
    // NOT the same as the "day" argument to isValidCalendarDate,
    // which is day of month. Same word, different domain.

    function parseDay(value) {
        var CC = requireCalendarConstants('parseDay');
        return parseBoundedInteger(value, CC.MIN_DAY, CC.MAX_DAY);
    }

    function isDayValid(value) {
        return parseDay(value) !== null;
    }

    // ============================================================
    // HOUR VALIDATION
    // ============================================================

    function parseHour(value) {
        var CC = requireCalendarConstants('parseHour');
        return parseBoundedInteger(value, CC.MIN_HOUR, CC.MAX_HOUR);
    }

    function isHourValid(value) {
        return parseHour(value) !== null;
    }

    function parseCalendarHour(value) {
        var CC = requireCalendarConstants('parseCalendarHour');
        return parseBoundedInteger(
            value,
            CC.CALENDAR_START_HOUR,
            CC.CALENDAR_END_HOUR
        );
    }

    function isCalendarHourValid(value) {
        return parseCalendarHour(value) !== null;
    }

    // ============================================================
    // DURATION VALIDATION
    // ============================================================

    function parseDuration(value) {
        var CC = requireCalendarConstants('parseDuration');
        return parseBoundedInteger(
            value,
            CC.MIN_CLASS_DURATION,
            CC.MAX_CLASS_DURATION
        );
    }

    function isDurationValid(value) {
        return parseDuration(value) !== null;
    }

    // ============================================================
    // YEAR VALIDATION - dependency-free
    // ============================================================
    //
    // Years are UNBOUNDED positive SAFE integers. There is no upper
    // bound, but values outside the safe integer range (like 1e21)
    // are rejected because they cannot be represented exactly.
    //
    // This function does NOT require CalendarConstants.

    function parseYear(value) {
        var parsed = strictInteger(value);
        if (parsed === null) {
            return null;
        }
        if (!Number.isSafeInteger(parsed)) {
            return null;
        }
        if (parsed < 1) {
            return null;
        }
        return parsed;
    }

    function isYearValid(value) {
        return parseYear(value) !== null;
    }

    // ============================================================
    // CALENDAR DATE VALIDATION - dependency-free
    // ============================================================

    var DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    function isLeapYear(year) {
        if (year % 400 === 0) { return true; }
        if (year % 100 === 0) { return false; }
        return year % 4 === 0;
    }

    function daysInMonth(year, month) {
        if (month === 2 && isLeapYear(year)) {
            return 29;
        }
        return DAYS_IN_MONTH[month];
    }

    /**
     * Validate a (year, month, day) triple against the Gregorian
     * calendar.
     *
     * STRICT INPUT: year, month, and day must each be integers or
     * digit-only strings. Booleans, arrays, Dates, and NaN are
     * rejected. This matches the strictness of the other parsers
     * in this module.
     *
     * This function does NOT require CalendarConstants.
     *
     * @returns {boolean} True if the date is valid.
     */
    function isValidCalendarDate(year, month, day) {
        var y = strictInteger(year);
        if (y === null || y < 1) { return false; }
        if (!Number.isSafeInteger(y)) { return false; }

        var m = strictInteger(month);
        if (m === null || m < 1 || m > 12) { return false; }

        var d = strictInteger(day);
        if (d === null || d < 1 || d > 31) { return false; }

        return d <= daysInMonth(y, m);
    }

    // ============================================================
    // SLOT VALIDATION
    // ============================================================
    //
    // A slot is (week, day, hour, duration) and must fit within the
    // visible calendar grid: the last covered hour must not exceed
    // CALENDAR_END_HOUR.
    //
    // The old check was `hour + duration > MAX_HOUR + 1`, which
    // validated against the broader hour range rather than the
    // calendar window. A slot could be "valid" here but not
    // renderable in the grid.

    function parseSlot(week, day, hour, duration) {
        var CC = requireCalendarConstants('parseSlot');

        var parsedWeek = parseWeek(week);
        if (parsedWeek === null) { return null; }

        var parsedDay = parseDay(day);
        if (parsedDay === null) { return null; }

        var parsedHour = parseCalendarHour(hour);
        if (parsedHour === null) { return null; }

        var parsedDuration = parseDuration(duration);
        if (parsedDuration === null) { return null; }

        if (parsedHour + parsedDuration - 1 > CC.CALENDAR_END_HOUR) {
            return null;
        }

        return {
            week: parsedWeek,
            day: parsedDay,
            hour: parsedHour,
            duration: parsedDuration
        };
    }

    function isSlotValid(week, day, hour, duration) {
        return parseSlot(week, day, hour, duration) !== null;
    }

    // ============================================================
    // RANGE VALIDATION
    // ============================================================

    /**
     * Parse a value within an inclusive integer range.
     *
     * @param {*} value
     * @param {number} min
     * @param {number} max
     * @param {boolean} allowNull - If true, null/undefined/'' return
     *   null (treated as "not provided") rather than being rejected.
     * @returns {number|null} Parsed integer, or null for invalid or
     *   (with allowNull) absent input.
     */
    function parseInRange(value, min, max, allowNull) {
        allowNull = allowNull === true;

        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
            return null;
        }

        return parseBoundedInteger(value, min, max);
    }

    function isInRange(value, min, max, allowNull) {
        allowNull = allowNull === true;

        // Absent input: valid iff allowNull.
        if (value === undefined || value === null || value === '') {
            return allowNull;
        }

        return parseInRange(value, min, max, allowNull) !== null;
    }

    // ============================================================
    // BOUNDS ACCESSORS
    // ============================================================
    //
    // getYearBounds is deliberately absent. Years are unbounded;
    // callers should use parseYear and check for null.

    function getWeekBounds() {
        var CC = requireCalendarConstants('getWeekBounds');
        return { min: CC.MIN_WEEK, max: CC.MAX_WEEK };
    }

    function getDayBounds() {
        var CC = requireCalendarConstants('getDayBounds');
        return { min: CC.MIN_DAY, max: CC.MAX_DAY };
    }

    function getHourBounds() {
        var CC = requireCalendarConstants('getHourBounds');
        return { min: CC.MIN_HOUR, max: CC.MAX_HOUR };
    }

    function getDurationBounds() {
        var CC = requireCalendarConstants('getDurationBounds');
        return { min: CC.MIN_CLASS_DURATION, max: CC.MAX_CLASS_DURATION };
    }

    function getCalendarHourBounds() {
        var CC = requireCalendarConstants('getCalendarHourBounds');
        return { min: CC.CALENDAR_START_HOUR, max: CC.CALENDAR_END_HOUR };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarValidation = Object.freeze({
        // Week
        parseWeek: parseWeek,
        isWeekValid: isWeekValid,

        // Day (of week, 1-7)
        parseDay: parseDay,
        isDayValid: isDayValid,

        // Hour
        parseHour: parseHour,
        isHourValid: isHourValid,
        parseCalendarHour: parseCalendarHour,
        isCalendarHourValid: isCalendarHourValid,

        // Duration
        parseDuration: parseDuration,
        isDurationValid: isDurationValid,

        // Year (unbounded positive safe integer, no constants needed)
        parseYear: parseYear,
        isYearValid: isYearValid,

        // Calendar date (no constants needed)
        isValidCalendarDate: isValidCalendarDate,

        // Slot
        parseSlot: parseSlot,
        isSlotValid: isSlotValid,

        // Range
        parseInRange: parseInRange,
        isInRange: isInRange,

        // Bounds
        getWeekBounds: getWeekBounds,
        getDayBounds: getDayBounds,
        getHourBounds: getHourBounds,
        getDurationBounds: getDurationBounds,
        getCalendarHourBounds: getCalendarHourBounds
    });

})();
