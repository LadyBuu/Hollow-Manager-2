/**
 * utils/calendar-validation.js - Calendar Validation
 * Canonical single source of truth for all calendar validation
 * Path: js/utils/calendar-validation.js
 *
 * This module provides:
 *   - Strict validation and parsing of calendar values
 *   - Week, day, hour, duration validation
 *   - Year validation (unbounded positive integers)
 *   - Calendar date validation (year + month + day)
 *   - Single source of truth - all modules MUST use this
 *
 * IMPORTANT:
 *   - This is the CANONICAL validation layer for calendar values
 *   - All modules MUST use these functions - do NOT duplicate
 *   - Validation functions return null for invalid input
 *   - Parse functions return null for invalid input
 *   - No domain knowledge - calendar concepts only
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Any integer >= 1 is a valid year.
 *   - parseYear() accepts any positive integer.
 *   - Weeks and days remain bounded (they have real semantic
 *     meaning: 52 weeks per year, 7 days per week).
 *
 * CALENDAR DATE SEMANTICS:
 *   - isValidCalendarDate(y, m, d) validates a (year, month, day)
 *     triple against the real Gregorian calendar.
 *   - Year is unbounded (any integer >= 1).
 *   - Month is 1-12.
 *   - Day is 1-31, but the day must fit the month. Feb 30 is
 *     rejected. Feb 29 is accepted only in leap years.
 *   - Returns a boolean, not a parsed value. The inputs are used
 *     as-is; callers that need the parsed integer form should call
 *     parseYear / a Number() cast themselves.
 *
 *   This function exists for the missions domain, which stores
 *   (year, month, day) as three separate integers and needs to
 *   reject impossible dates like 2026-02-30 or 2026-13-01.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants (for bounds only)
 *
 * USAGE:
 *   var CV = window.CalendarValidation;
 *   var week = CV.parseWeek(weekInput);
 *   if (week === null) { /* invalid *\/ }
 *   var isValid = CV.isWeekValid(weekInput);
 *   var dateOk = CV.isValidCalendarDate(2026, 2, 29);  // false
 *   var dateOk = CV.isValidCalendarDate(2024, 2, 29);  // true
 */

(function() {
    'use strict';

    if (window.__calendarValidationLoaded) {
        return;
    }
    window.__calendarValidationLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CC = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================
    //
    // NOTE: MIN_YEAR and MAX_YEAR are deliberately NOT checked.
    // Years are unbounded positive integers and are validated
    // locally by parseYear(). See the YEAR SEMANTICS block above.

    function checkDependencies() {
        var missing = [];

        if (!CC || typeof CC.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }
        if (!CC || typeof CC.MAX_WEEK !== 'number') {
            missing.push('CalendarConstants.MAX_WEEK');
        }
        if (!CC || typeof CC.MIN_DAY !== 'number') {
            missing.push('CalendarConstants.MIN_DAY');
        }
        if (!CC || typeof CC.MAX_DAY !== 'number') {
            missing.push('CalendarConstants.MAX_DAY');
        }
        if (!CC || typeof CC.MIN_HOUR !== 'number') {
            missing.push('CalendarConstants.MIN_HOUR');
        }
        if (!CC || typeof CC.MAX_HOUR !== 'number') {
            missing.push('CalendarConstants.MAX_HOUR');
        }
        if (!CC || typeof CC.MIN_CLASS_DURATION !== 'number') {
            missing.push('CalendarConstants.MIN_CLASS_DURATION');
        }
        if (!CC || typeof CC.MAX_CLASS_DURATION !== 'number') {
            missing.push('CalendarConstants.MAX_CLASS_DURATION');
        }
        if (!CC || typeof CC.CALENDAR_START_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_START_HOUR');
        }
        if (!CC || typeof CC.CALENDAR_END_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_END_HOUR');
        }

        if (missing.length > 0) {
            console.warn('[CalendarValidation] Missing dependencies:', missing.join(', '));
        }

        return missing.length === 0;
    }

    checkDependencies();

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isString(value) {
        return typeof value === 'string';
    }

    function isEmptyString(value) {
        if (!isString(value)) {
            return false;
        }
        return value.trim() === '';
    }

    function toNumber(value) {
        if (value === undefined || value === null) {
            return NaN;
        }
        if (isString(value)) {
            var trimmed = value.trim();
            if (trimmed === '') {
                return NaN;
            }
            return Number(trimmed);
        }
        return Number(value);
    }

    function isInteger(num) {
        return Number.isInteger(num);
    }

    function isFiniteNumber(num) {
        return Number.isFinite(num);
    }

    // ============================================================
    // WEEK VALIDATION
    // ============================================================

    function parseWeek(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (isEmptyString(value)) {
            return null;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return null;
        }
        if (!isInteger(num)) {
            return null;
        }
        if (num < CC.MIN_WEEK || num > CC.MAX_WEEK) {
            return null;
        }

        return num;
    }

    function isWeekValid(value) {
        return parseWeek(value) !== null;
    }

    // ============================================================
    // DAY VALIDATION
    // ============================================================

    function parseDay(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (isEmptyString(value)) {
            return null;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return null;
        }
        if (!isInteger(num)) {
            return null;
        }
        if (num < CC.MIN_DAY || num > CC.MAX_DAY) {
            return null;
        }

        return num;
    }

    function isDayValid(value) {
        return parseDay(value) !== null;
    }

    // ============================================================
    // HOUR VALIDATION
    // ============================================================

    function parseHour(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (isEmptyString(value)) {
            return null;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return null;
        }
        if (!isInteger(num)) {
            return null;
        }
        if (num < CC.MIN_HOUR || num > CC.MAX_HOUR) {
            return null;
        }

        return num;
    }

    function isHourValid(value) {
        return parseHour(value) !== null;
    }

    function parseCalendarHour(value) {
        var num = parseHour(value);
        if (num === null) {
            return null;
        }
        if (num < CC.CALENDAR_START_HOUR || num > CC.CALENDAR_END_HOUR) {
            return null;
        }
        return num;
    }

    function isCalendarHourValid(value) {
        return parseCalendarHour(value) !== null;
    }

    // ============================================================
    // DURATION VALIDATION
    // ============================================================

    function parseDuration(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (isEmptyString(value)) {
            return null;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return null;
        }
        if (!isInteger(num)) {
            return null;
        }
        if (num < CC.MIN_CLASS_DURATION || num > CC.MAX_CLASS_DURATION) {
            return null;
        }

        return num;
    }

    function isDurationValid(value) {
        return parseDuration(value) !== null;
    }

    // ============================================================
    // YEAR VALIDATION
    // ============================================================
    //
    // Years are UNBOUNDED positive integers. Any integer >= 1 is a
    // valid year. There is no upper bound.
    //
    // This function intentionally does NOT consult CalendarConstants
    // for bounds. The unbounded contract is local to this function.

    function parseYear(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (isEmptyString(value)) {
            return null;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return null;
        }
        if (!isInteger(num)) {
            return null;
        }
        if (num < 1) {
            return null;
        }

        return num;
    }

    function isYearValid(value) {
        return parseYear(value) !== null;
    }

    // ============================================================
    // CALENDAR DATE VALIDATION
    // ============================================================
    //
    // Validates a (year, month, day) triple against the real
    // Gregorian calendar.
    //
    // CONTRACT:
    //   - Year: any integer >= 1. Unbounded.
    //   - Month: integer in [1, 12].
    //   - Day: integer in [1, 31], AND must fit the month. Feb 30
    //     is rejected. Feb 29 is accepted only in leap years.
    //
    // Returns a boolean. It does NOT return a parsed date or a
    // structured result. Callers that want the parsed integer form
    // should call parseYear / Number() themselves.
    //
    // IMPLEMENTATION:
    //   `new Date(y, m, 0)` constructs a date with month m
    //   (0-indexed in the Date constructor, so m is our 1-indexed
    //   month here) and day 0. The Date object interprets day 0 as
    //   the last day of the *previous* month, which is exactly our
    //   target month. `.getDate()` then returns the number of days
    //   in that month. This handles leap years correctly for any
    //   year the JS engine supports.

    function isValidCalendarDate(year, month, day) {
        var y = Number(year);
        var m = Number(month);
        var d = Number(day);

        if (!Number.isInteger(y) || y < 1) { return false; }
        if (!Number.isInteger(m) || m < 1 || m > 12) { return false; }
        if (!Number.isInteger(d) || d < 1 || d > 31) { return false; }

        var daysInMonth = new Date(y, m, 0).getDate();
        return d <= daysInMonth;
    }

    // ============================================================
    // SLOT VALIDATION
    // ============================================================

    function parseSlot(week, day, hour, duration) {
        var parsedWeek = parseWeek(week);
        if (parsedWeek === null) {
            return null;
        }

        var parsedDay = parseDay(day);
        if (parsedDay === null) {
            return null;
        }

        var parsedHour = parseHour(hour);
        if (parsedHour === null) {
            return null;
        }

        var parsedDuration = parseDuration(duration);
        if (parsedDuration === null) {
            return null;
        }

        if (parsedHour + parsedDuration > CC.MAX_HOUR + 1) {
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

    function parseInRange(value, min, max, allowNull) {
        allowNull = allowNull === true;

        if (value === undefined || value === null) {
            return allowNull ? null : NaN;
        }

        if (isEmptyString(value)) {
            return allowNull ? null : NaN;
        }

        var num = toNumber(value);
        if (!isFiniteNumber(num)) {
            return NaN;
        }
        if (!isInteger(num)) {
            return NaN;
        }
        if (num < min || num > max) {
            return NaN;
        }

        return num;
    }

    function isInRange(value, min, max, allowNull) {
        var result = parseInRange(value, min, max, allowNull);
        if (allowNull && result === null) {
            return true;
        }
        return isFiniteNumber(result);
    }

    // ============================================================
    // BOUNDS ACCESSORS
    // ============================================================
    //
    // NOTE: getYearBounds() has been REMOVED. Years are unbounded;
    // there are no bounds to return. Callers that previously used
    // it should call parseYear() and check for null instead, or
    // simply validate "integer >= 1" inline.

    function getWeekBounds() {
        return {
            min: CC.MIN_WEEK,
            max: CC.MAX_WEEK
        };
    }

    function getDayBounds() {
        return {
            min: CC.MIN_DAY,
            max: CC.MAX_DAY
        };
    }

    function getHourBounds() {
        return {
            min: CC.MIN_HOUR,
            max: CC.MAX_HOUR
        };
    }

    function getDurationBounds() {
        return {
            min: CC.MIN_CLASS_DURATION,
            max: CC.MAX_CLASS_DURATION
        };
    }

    function getCalendarHourBounds() {
        return {
            min: CC.CALENDAR_START_HOUR,
            max: CC.CALENDAR_END_HOUR
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarValidation = {
        // Week
        parseWeek: parseWeek,
        isWeekValid: isWeekValid,

        // Day
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

        // Year
        parseYear: parseYear,
        isYearValid: isYearValid,

        // Calendar date (year + month + day)
        isValidCalendarDate: isValidCalendarDate,

        // Slot
        parseSlot: parseSlot,
        isSlotValid: isSlotValid,

        // Range
        parseInRange: parseInRange,
        isInRange: isInRange,

        // Bounds
        // NOTE: getYearBounds is deliberately absent — years are unbounded.
        getWeekBounds: getWeekBounds,
        getDayBounds: getDayBounds,
        getHourBounds: getHourBounds,
        getDurationBounds: getDurationBounds,
        getCalendarHourBounds: getCalendarHourBounds
    };

})();
