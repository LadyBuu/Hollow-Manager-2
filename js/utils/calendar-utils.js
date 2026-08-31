/**
 * js/utils/calendar-utils.js - Calendar Utilities
 * Path: js/utils/calendar-utils.js
 * 
 * This module provides calendar-related utility functions:
 *   - Week block calculation for academic schedules
 *   - Week number calculation
 *   - Day name formatting
 *   - Period validation helpers
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarUtilsLoaded) {
        return;
    }
    window.__calendarUtilsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var WEEKS_PER_BLOCK = 2;

    // ============================================================
    // WEEK BLOCK HELPERS
    // ============================================================

    /**
     * Get the 2-week block for a given week number.
     * Blocks are: 1-2, 3-4, 5-6, etc.
     * 
     * @param {number|string} weekNum - Week number (1-52)
     * @returns {object|null} { start: number, end: number } or null if invalid
     */
    function getWeekBlock(weekNum) {
        var num = parseInt(weekNum, 10);
        if (isNaN(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }

        // Calculate block: 1-2 -> block 1, 3-4 -> block 2, etc.
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
     * @returns {array} Array of block objects
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
        var num = parseInt(weekNum, 10);
        if (isNaN(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return Math.floor((num - 1) / WEEKS_PER_BLOCK) + 1;
    }

    /**
     * Get the week range for a given block number.
     * 
     * @param {number} blockNum - Block number (1-26)
     * @returns {object|null} { start: number, end: number } or null if invalid
     */
    function getBlockRange(blockNum) {
        var num = parseInt(blockNum, 10);
        if (isNaN(num) || num < 1 || num > Math.ceil(MAX_WEEK / WEEKS_PER_BLOCK)) {
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
     * Get the week number from a date.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @param {number} firstDayOfWeek - 1 = Monday, 0 = Sunday (default: 1)
     * @returns {number} Week number (1-52)
     */
    function getWeekNumber(date, firstDayOfWeek) {
        firstDayOfWeek = firstDayOfWeek || 1;
        var d = new Date(date);
        d.setHours(0, 0, 0, 0);
        
        // Set to Thursday of the same week to get ISO week number
        var dayOffset = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
        d.setDate(d.getDate() - dayOffset + 3);
        
        var week1 = new Date(d.getFullYear(), 0, 4);
        var week1Offset = (week1.getDay() + 6) % 7;
        week1.setDate(week1.getDate() - week1Offset);
        
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
        return ((weekNum - startWeek) % 52) + 1;
    }

    // ============================================================
    // DAY NAME HELPERS
    // ============================================================

    /**
     * Get the day name for a given day number (1-7).
     * 1 = Monday, 7 = Sunday
     * 
     * @param {number} day - Day number (1-7)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     */
    function getDayName(day, format) {
        format = format || 'long';
        var names = {
            'long': ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            'short': ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            'min': ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
        };
        var dayNames = names[format] || names['long'];
        var num = parseInt(day, 10);
        if (isNaN(num) || num < 1 || num > 7) return 'Unknown';
        return dayNames[num] || 'Unknown';
    }

    /**
     * Get the day number (1-7) from a day name.
     * 1 = Monday, 7 = Sunday
     * 
     * @param {string} dayName - Day name (e.g., 'Monday', 'Mon', 'Mo')
     * @returns {number} Day number (1-7) or null if not found
     */
    function getDayNumber(dayName) {
        var names = {
            'monday': 1, 'mon': 1, 'mo': 1,
            'tuesday': 2, 'tue': 2, 'tu': 2,
            'wednesday': 3, 'wed': 3, 'we': 3,
            'thursday': 4, 'thu': 4, 'th': 4,
            'friday': 5, 'fri': 5, 'fr': 5,
            'saturday': 6, 'sat': 6, 'sa': 6,
            'sunday': 7, 'sun': 7, 'su': 7
        };
        var key = String(dayName).toLowerCase();
        return names[key] || null;
    }

    // ============================================================
    // PERIOD VALIDATION HELPERS
    // ============================================================

    /**
     * Check if a value is a valid week number (1-52).
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid
     */
    function isValidWeek(value) {
        var num = parseInt(value, 10);
        return !isNaN(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    /**
     * Check if a value is a valid year (1900-2100).
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid
     */
    function isValidYear(value) {
        var num = parseInt(value, 10);
        var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
        var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;
        return !isNaN(num) && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    /**
     * Parse a period value to a number.
     * 
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed number or null if invalid
     */
    function parsePeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = parseInt(value, 10);
        return !isNaN(num) ? num : null;
    }

    // ============================================================
    // DATE FORMATTING HELPERS
    // ============================================================

    /**
     * Format a date as a string.
     * 
     * @param {Date|string} date - Date object or ISO date string
     * @param {string} format - 'iso', 'date', or 'full' (default: 'date')
     * @returns {string} Formatted date string
     */
    function formatDate(date, format) {
        format = format || 'date';
        var d = new Date(date);
        if (isNaN(d.getTime())) return 'Invalid Date';

        var options = {
            'iso': { year: 'numeric', month: '2-digit', day: '2-digit' },
            'date': { year: 'numeric', month: 'long', day: 'numeric' },
            'full': { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        };

        return d.toLocaleDateString('en-US', options[format] || options['date']);
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

        // Day name helpers
        getDayName: getDayName,
        getDayNumber: getDayNumber,

        // Period validation
        isValidWeek: isValidWeek,
        isValidYear: isValidYear,
        parsePeriod: parsePeriod,

        // Date formatting
        formatDate: formatDate,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        WEEKS_PER_BLOCK: WEEKS_PER_BLOCK
    };

    // Also expose the key function globally for backward compatibility
    window.getWeekBlock = getWeekBlock;

})();
