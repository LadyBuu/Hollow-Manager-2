/**
 * utils/calendar-validation.js - Calendar Validation
 * Canonical single source of truth for all calendar validation
 * Path: js/utils/calendar-validation.js
 * 
 * This module provides:
 *   - Strict validation and parsing of calendar values
 *   - Week, day, hour, duration, year validation
 *   - Single source of truth - all modules MUST use this
 * 
 * IMPORTANT:
 *   - This is the CANONICAL validation layer for calendar values
 *   - All modules MUST use these functions - do NOT duplicate
 *   - Validation functions return null for invalid input
 *   - Parse functions return null for invalid input
 *   - No domain knowledge - calendar concepts only
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (for bounds only)
 * 
 * USAGE:
 *   var CV = window.CalendarValidation;
 *   var week = CV.parseWeek(weekInput);
 *   if (week === null) { /* invalid *\/ }
 *   var isValid = CV.isWeekValid(weekInput);
 */

(function() {
    'use strict';

    if (window.__calendarValidationLoaded) {
        return;
    }
    window.__calendarValidationLoaded = true;

    var CC = window.CalendarConstants;

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
        if (!CC || typeof CC.MIN_YEAR !== 'number') {
            missing.push('CalendarConstants.MIN_YEAR');
        }
        if (!CC || typeof CC.MAX_YEAR !== 'number') {
            missing.push('CalendarConstants.MAX_YEAR');
        }
        if (!CC || typeof CC.CALENDAR_START_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_START_HOUR');
        }
        if (!CC || typeof CC.CALENDAR_END_HOUR !== 'number') {
            missing.push('CalendarConstants.CALENDAR_END_HOUR');
        }

        if (missing.length > 0) {
            throw new Error('CalendarValidation: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

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
        if (num < CC.MIN_YEAR || num > CC.MAX_YEAR) {
            return null;
        }

        return num;
    }

    function isYearValid(value) {
        return parseYear(value) !== null;
    }

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

    function getYearBounds() {
        return {
            min: CC.MIN_YEAR,
            max: CC.MAX_YEAR
        };
    }

    function getCalendarHourBounds() {
        return {
            min: CC.CALENDAR_START_HOUR,
            max: CC.CALENDAR_END_HOUR
        };
    }

    window.CalendarValidation = {
        parseWeek: parseWeek,
        isWeekValid: isWeekValid,
        parseDay: parseDay,
        isDayValid: isDayValid,
        parseHour: parseHour,
        isHourValid: isHourValid,
        parseCalendarHour: parseCalendarHour,
        isCalendarHourValid: isCalendarHourValid,
        parseDuration: parseDuration,
        isDurationValid: isDurationValid,
        parseYear: parseYear,
        isYearValid: isYearValid,
        parseSlot: parseSlot,
        isSlotValid: isSlotValid,
        parseInRange: parseInRange,
        isInRange: isInRange,
        getWeekBounds: getWeekBounds,
        getDayBounds: getDayBounds,
        getHourBounds: getHourBounds,
        getDurationBounds: getDurationBounds,
        getYearBounds: getYearBounds,
        getCalendarHourBounds: getCalendarHourBounds
    };

})();
