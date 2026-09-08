/**
 * modules/calendar/calendar-validation.js - Calendar Validation
 * Calendar-specific domain validation
 * 
 * IMPORTANT:
 *   - Calendar domain validation only
 *   - No external domain validation (Character, Academy, etc.)
 *   - Uses CalendarConstants for bounds
 * 
 * DEPENDENCIES:
 *   - CalendarConstants
 */

(function() {
    'use strict';

    if (window.__calendarValidationLoaded) { return; }
    window.__calendarValidationLoaded = true;

    var CC = window.CalendarConstants;

    function isString(value) { return typeof value === 'string'; }

    function isEmptyString(value) {
        if (!isString(value)) { return false; }
        return value.trim() === '';
    }

    function toNumber(value) {
        if (value === undefined || value === null) { return NaN; }
        if (isString(value)) {
            var trimmed = value.trim();
            if (trimmed === '') { return NaN; }
            return Number(trimmed);
        }
        return Number(value);
    }

    function isFiniteNumber(num) { return Number.isFinite(num); }

    // ============================================================
    // SLOT VALIDATION
    // ============================================================

    function parseWeek(value) {
        if (value === undefined || value === null) { return null; }
        if (isEmptyString(value)) { return null; }
        var num = toNumber(value);
        if (!isFiniteNumber(num)) { return null; }
        if (!Number.isInteger(num)) { return null; }
        if (num < CC.MIN_WEEK || num > CC.MAX_WEEK) { return null; }
        return num;
    }

    function parseDay(value) {
        if (value === undefined || value === null) { return null; }
        if (isEmptyString(value)) { return null; }
        var num = toNumber(value);
        if (!isFiniteNumber(num)) { return null; }
        if (!Number.isInteger(num)) { return null; }
        if (num < CC.MIN_DAY || num > CC.MAX_DAY) { return null; }
        return num;
    }

    function parseHour(value) {
        if (value === undefined || value === null) { return null; }
        if (isEmptyString(value)) { return null; }
        var num = toNumber(value);
        if (!isFiniteNumber(num)) { return null; }
        if (!Number.isInteger(num)) { return null; }
        if (num < CC.MIN_HOUR || num > CC.MAX_HOUR) { return null; }
        return num;
    }

    function parseDuration(value) {
        if (value === undefined || value === null) { return null; }
        if (isEmptyString(value)) { return null; }
        var num = toNumber(value);
        if (!isFiniteNumber(num)) { return null; }
        if (!Number.isInteger(num)) { return null; }
        if (num < CC.MIN_CLASS_DURATION || num > CC.MAX_CLASS_DURATION) { return null; }
        return num;
    }

    function parseYear(value) {
        if (value === undefined || value === null) { return null; }
        if (isEmptyString(value)) { return null; }
        var num = toNumber(value);
        if (!isFiniteNumber(num)) { return null; }
        if (!Number.isInteger(num)) { return null; }
        if (num < CC.MIN_YEAR || num > CC.MAX_YEAR) { return null; }
        return num;
    }

    function parseSlot(week, day, hour, duration) {
        var parsedWeek = parseWeek(week);
        if (parsedWeek === null) { return null; }

        var parsedDay = parseDay(day);
        if (parsedDay === null) { return null; }

        var parsedHour = parseHour(hour);
        if (parsedHour === null) { return null; }

        var parsedDuration = parseDuration(duration);
        if (parsedDuration === null) { return null; }

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
        if (!isFiniteNumber(num)) { return NaN; }
        if (!Number.isInteger(num)) { return NaN; }
        if (num < min || num > max) { return NaN; }

        return num;
    }

    function isInRange(value, min, max, allowNull) {
        var result = parseInRange(value, min, max, allowNull);
        if (allowNull && result === null) { return true; }
        return isFiniteNumber(result);
    }

    window.CalendarValidation = {
        parseWeek: parseWeek,
        parseDay: parseDay,
        parseHour: parseHour,
        parseDuration: parseDuration,
        parseYear: parseYear,
        parseSlot: parseSlot,
        isSlotValid: isSlotValid,
        parseInRange: parseInRange,
        isInRange: isInRange
    };

})();
