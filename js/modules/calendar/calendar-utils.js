/**
 * js/modules/calendar/calendar-utils.js - Calendar Utilities
 * Path: js/modules/calendar/calendar-utils.js
 * 
 * This module provides calendar-domain utility functions:
 *   - Week block calculation for academic schedules
 *   - Week number calculation
 *   - Academic week calculation
 *   - Week/year validation
 * 
 * IMPORTANT:
 *   - No DOM dependencies
 *   - No persistence
 *   - No application state
 *   - Uses CalendarConstants for all bounds
 *   - Formatting functions moved to FormatUtils
 *   - Validation functions moved to CalendarConstants
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var CU = window.CalendarUtils;
 *   var block = CU.getWeekBlock(3);
 *   var blocks = CU.getAllWeekBlocks();
 *   var weekNum = CU.getWeekNumber(new Date());
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarUtilsLoaded) {
        return;
    }
    window.__calendarUtilsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    if (!window.CalendarConstants) {
        console.error('[CalendarUtils] CalendarConstants is required.');
        return;
    }

    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var WEEKS_PER_BLOCK = CalendarConstants.WEEKS_PER_BLOCK;
    var DAYS_IN_WEEK = CalendarConstants.DAYS_IN_WEEK;

    // ============================================================
    // WEEK BLOCK HELPERS
    // ============================================================

    /**
     * Get the 2-week block for a given week number.
     * Blocks are: 1-2, 3-4, 5-6, etc.
     * 
     * @param {number|string} weekNum - Week number (1-52)
     * @returns {object|null} { start: number, end: number, block: number, label: string } or null if invalid
     */
    function getWeekBlock(weekNum) {
        var num = CalendarConstants.isValidWeek(weekNum);
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
     * @param {number|string} weekNum - Week number (1-52)
     * @returns {number|null} Block number or null if invalid
     */
    function getWeekBlockNumber(weekNum) {
        var num = CalendarConstants.isValidWeek(weekNum);
        if (num === null) {
            return null;
        }
        return Math.floor((num - 1) / WEEKS_PER_BLOCK) + 1;
    }

    /**
     * Get the week range for a given block number.
     * 
     * @param {number} blockNum - Block number (1-26)
     * @returns {object|null} { start: number, end: number, label: string } or null if invalid
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
    // WEEK NUMBER HELPERS
    // ============================================================

    /**
     * Get the ISO week number from a date.
     * Based on ISO 8601: weeks start on Monday, week 1 contains Jan 4.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @returns {number} Week number (1-52)
     */
    function getWeekNumber(date) {
        var d = new Date(date);
        if (isNaN(d.getTime())) {
            return 1;
        }

        d.setHours(0, 0, 0, 0);

        // Set to Thursday of the same week to get ISO week number
        var dayOffset = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
        d.setDate(d.getDate() - dayOffset + 3);

        // Get week 1 of the year
        var week1 = new Date(d.getFullYear(), 0, 4);
        var week1Offset = (week1.getDay() + 6) % 7;
        week1.setDate(week1.getDate() - week1Offset);

        // Calculate week number
        var diff = (d - week1) / 86400000;
        return Math.floor(diff / 7) + 1;
    }

    /**
     * Get the academic week number for a given date.
     * Assumes the academic year starts on the first Monday of the year.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @param {number} startWeek - Starting week offset (default: 1)
     * @returns {number} Academic week number (1-52)
     */
    function getAcademicWeek(date, startWeek) {
        startWeek = startWeek || 1;
        var weekNum = getWeekNumber(date);
        // Adjust so week 1 of the academic year starts at the given offset
        var academicWeek = ((weekNum - startWeek) % 52) + 1;
        // Ensure positive result (JavaScript % can be negative)
        while (academicWeek < 1) {
            academicWeek += 52;
        }
        return academicWeek;
    }

    /**
     * Get the ISO week number from a date (alias for getWeekNumber).
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @returns {number} Week number (1-52)
     */
    function getISOWeekNumber(date) {
        return getWeekNumber(date);
    }

    // ============================================================
    // DATE HELPERS
    // ============================================================

    /**
     * Get the first day of the week for a given date.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @param {number} firstDayOfWeek - 1 = Monday, 0 = Sunday (default: 1)
     * @returns {Date} Date of the first day of the week
     */
    function getFirstDayOfWeek(date, firstDayOfWeek) {
        firstDayOfWeek = firstDayOfWeek || 1;
        var d = new Date(date);
        if (isNaN(d.getTime())) {
            return new Date();
        }

        d.setHours(0, 0, 0, 0);
        var dayOffset = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
        var targetOffset = firstDayOfWeek === 1 ? 0 : 6;
        d.setDate(d.getDate() - dayOffset + targetOffset);
        return d;
    }

    /**
     * Get the last day of the week for a given date.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @param {number} firstDayOfWeek - 1 = Monday, 0 = Sunday (default: 1)
     * @returns {Date} Date of the last day of the week
     */
    function getLastDayOfWeek(date, firstDayOfWeek) {
        firstDayOfWeek = firstDayOfWeek || 1;
        var firstDay = getFirstDayOfWeek(date, firstDayOfWeek);
        var lastDay = new Date(firstDay);
        lastDay.setDate(firstDay.getDate() + 6);
        return lastDay;
    }

    /**
     * Get the date range for a week.
     * 
     * @param {number} weekNum - Week number (1-52)
     * @param {number} year - Year
     * @param {number} firstDayOfWeek - 1 = Monday, 0 = Sunday (default: 1)
     * @returns {object|null} { start: Date, end: Date } or null if invalid
     */
    function getWeekDateRange(weekNum, year, firstDayOfWeek) {
        var week = CalendarConstants.isValidWeek(weekNum);
        if (week === null) {
            return null;
        }

        firstDayOfWeek = firstDayOfWeek || 1;
        year = year || new Date().getFullYear();

        // Get Jan 4 of the year (ISO week 1 starts here)
        var jan4 = new Date(year, 0, 4);
        var jan4Offset = (jan4.getDay() + 6) % 7;
        var week1Start = new Date(jan4);
        week1Start.setDate(jan4.getDate() - jan4Offset);

        // Calculate week start
        var startDate = new Date(week1Start);
        startDate.setDate(week1Start.getDate() + (week - 1) * 7);

        // If first day is Sunday, adjust
        if (firstDayOfWeek === 0) {
            startDate.setDate(startDate.getDate() + 6);
            var startDay = startDate.getDay();
            if (startDay !== 0) {
                startDate.setDate(startDate.getDate() - startDay);
            }
        }

        var endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        return {
            start: startDate,
            end: endDate
        };
    }

    // ============================================================
    // VALIDATION HELPERS (delegated to CalendarConstants)
    // ============================================================

    /**
     * Check if a value is a valid week number (1-52).
     * @deprecated Use CalendarConstants.isValidWeek() instead.
     */
    function isValidWeek(value) {
        return CalendarConstants.isValidWeek(value) !== null;
    }

    /**
     * Check if a value is a valid year.
     * @deprecated Use CalendarConstants.isValidYear() instead.
     */
    function isValidYear(value) {
        return CalendarConstants.isValidYear(value) !== null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarUtils = {
        // Week block helpers
        getWeekBlock: getWeekBlock,
        getAllWeekBlocks: getAllWeekBlocks,
        getWeekBlockNumber: getWeekBlockNumber,
        getBlockRange: getBlockRange,

        // Week number helpers
        getWeekNumber: getWeekNumber,
        getAcademicWeek: getAcademicWeek,
        getISOWeekNumber: getISOWeekNumber,

        // Date helpers
        getFirstDayOfWeek: getFirstDayOfWeek,
        getLastDayOfWeek: getLastDayOfWeek,
        getWeekDateRange: getWeekDateRange,

        // Validation (deprecated - use CalendarConstants)
        isValidWeek: isValidWeek,
        isValidYear: isValidYear,

        // Constants (deprecated - use CalendarConstants)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        WEEKS_PER_BLOCK: WEEKS_PER_BLOCK,
        DAYS_IN_WEEK: DAYS_IN_WEEK
    };

    // ============================================================
    // LEGACY COMPATIBILITY (DEPRECATED - Will be removed)
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from old CalendarUtils structure.
    // They will be removed in a future version.

    window.getWeekBlock = getWeekBlock;
    window.getAllWeekBlocks = getAllWeekBlocks;
    window.getWeekBlockNumber = getWeekBlockNumber;
    window.getBlockRange = getBlockRange;
    window.getWeekNumber = getWeekNumber;
    window.getAcademicWeek = getAcademicWeek;
    window.isValidWeek = isValidWeek;
    window.isValidYear = isValidYear;

})();