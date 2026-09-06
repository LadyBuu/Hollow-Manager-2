/**
 * utils/format-utils.js - Formatting Utilities
 * 
 * Path: js/utils/format-utils.js
 * 
 * This module provides:
 *   - formatDate - Date formatting with timezone awareness
 *   - truncateString - String truncation with validation
 *   - getDayName - Day name lookup (1-indexed, Monday=1)
 *   - getDayName0 - Day name lookup (0-indexed, Sunday=0)
 *   - getDayNumber - Day number from day name
 *   - formatHour - Hour formatting (12-hour with AM/PM)
 *   - parseHour - Hour parsing from time string
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects
 *   - No domain knowledge
 *   - No application state
 *   - No DOM dependencies
 *   - Uses CalendarConstants for day names and hour formatting
 * 
 * DATE SEMANTICS:
 *   - Date-only strings (e.g., "2026-09-05") are interpreted as UTC
 *   - This can display the previous calendar date in some timezones
 *   - For precise date handling, use a dedicated date library
 *   - If your data stores date-only values, be aware of timezone conversion
 * 
 * TRUNCATION SEMANTICS:
 *   - length must be a non-negative finite integer
 *   - Invalid length values return the original string (does not throw)
 *   - This is intentionally forgiving for UI presentation
 * 
 * USAGE:
 *   var FU = window.FormatUtils;
 *   var date = FU.formatDate('2026-09-05');
 *   var truncated = FU.truncateString('Hello world', 5);
 *   var dayName = FU.getDayName(3); // 'Wednesday'
 *   var hour = FU.formatHour(14); // '2:00 PM'
 */

(function() {
    'use strict';

    if (window.__formatUtilsLoaded) return;
    window.__formatUtilsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // HELPER - Strict integer parsing
    // ============================================================

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    // ============================================================
    // FORMATTING HELPERS
    // ============================================================

    /**
     * Format a date string to a localized date string.
     * 
     * SEMANTICS:
     *   - Date-only strings (e.g., "2026-09-05") are parsed as UTC
     *   - The result is formatted in the user's local timezone
     *   - This can cause the displayed date to be one day off
     *   - For date-only values, consider storing as "2026-09-05T00:00:00"
     * 
     * TIMEZONE NOTE:
     *   - "2026-09-05" -> new Date() interprets as UTC midnight
     *   - In US Pacific timezone, this displays as "2026-09-04"
     *   - In UTC timezone, this displays as "2026-09-05"
     *   - For consistent display, use UTC-based formatting or a date library
     * 
     * @param {string} dateString - ISO date string
     * @param {string} fallback - Fallback value if date is invalid (default: 'N/A')
     * @returns {string} Formatted date or fallback
     * 
     * USAGE:
     *   FormatUtils.formatDate('2026-09-05'); // "9/5/2026" (in US locale)
     *   FormatUtils.formatDate('2026-09-05', 'Unknown'); // "9/5/2026"
     *   FormatUtils.formatDate(null, 'Never'); // "Never"
     */
    function formatDate(dateString, fallback) {
        fallback = fallback || 'N/A';

        // Defensive: reject empty values
        if (dateString === undefined || dateString === null || dateString === '') {
            return fallback;
        }

        // Defensive: ensure we have a string
        var str = String(dateString);

        // Parse the date
        var date = new Date(str);

        // Check if the date is valid
        if (isNaN(date.getTime())) {
            return fallback;
        }

        // Format in the user's locale
        return date.toLocaleDateString();
    }

    /**
     * Truncate a string to a maximum length.
     * 
     * SEMANTICS:
     *   - length must be a non-negative finite integer
     *   - Invalid length values return the original string (forgiving)
     *   - This is intentionally non-throwing for UI presentation
     * 
     * @param {*} value - Value to truncate
     * @param {number} length - Maximum length (must be a non-negative finite integer)
     * @returns {string} Truncated string or original string if invalid length
     * 
     * USAGE:
     *   FormatUtils.truncateString('Hello world', 5); // "Hello..."
     *   FormatUtils.truncateString('Hello world', 20); // "Hello world"
     *   FormatUtils.truncateString(null, 5); // ""
     *   FormatUtils.truncateString('Hello', -1); // "Hello" (invalid length)
     */
    function truncateString(value, length) {
        // Defensive: handle null/undefined
        if (value === undefined || value === null) {
            return '';
        }

        // Normalize to string
        var str = String(value);

        // Validate length: must be a non-negative finite integer
        if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
            // Forgiving: return original string
            return str;
        }

        // If string is short enough, return as-is
        if (str.length <= length) {
            return str;
        }

        // Truncate and add ellipsis
        return str.substring(0, length) + '...';
    }

    /**
     * Truncate a string with custom suffix.
     * 
     * @param {*} value - Value to truncate
     * @param {number} length - Maximum length
     * @param {string} suffix - Suffix to append (default: '...')
     * @returns {string} Truncated string
     * 
     * USAGE:
     *   FormatUtils.truncateWithSuffix('Hello world', 5, '…'); // "Hello…"
     */
    function truncateWithSuffix(value, length, suffix) {
        suffix = suffix || '...';

        // Defensive: handle null/undefined
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);

        // Validate length
        if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
            return str;
        }

        // If string is short enough, return as-is
        if (str.length <= length) {
            return str;
        }

        // Truncate and add custom suffix
        return str.substring(0, length) + suffix;
    }

    /**
     * Format a number with commas.
     * 
     * @param {*} value - Value to format
     * @param {string} fallback - Fallback if value is not a number (default: '0')
     * @returns {string} Formatted number
     * 
     * USAGE:
     *   FormatUtils.formatNumber(1234567); // "1,234,567"
     *   FormatUtils.formatNumber('1234567'); // "1,234,567"
     *   FormatUtils.formatNumber(null); // "0"
     */
    function formatNumber(value, fallback) {
        fallback = fallback || '0';

        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        var num = Number(value);
        if (!Number.isFinite(num)) {
            return fallback;
        }

        return num.toLocaleString();
    }

    /**
     * Format a number as currency.
     * 
     * @param {*} value - Value to format
     * @param {string} currency - Currency code (default: 'USD')
     * @param {string} fallback - Fallback if value is not a number (default: '$0')
     * @returns {string} Formatted currency
     * 
     * USAGE:
     *   FormatUtils.formatCurrency(1234.56); // "$1,234.56"
     *   FormatUtils.formatCurrency(1234.56, 'EUR'); // "€1,234.56"
     */
    function formatCurrency(value, currency, fallback) {
        currency = currency || 'USD';
        fallback = fallback || '$0';

        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        var num = Number(value);
        if (!Number.isFinite(num)) {
            return fallback;
        }

        try {
            return num.toLocaleString(undefined, {
                style: 'currency',
                currency: currency
            });
        } catch (e) {
            // Fallback if currency formatting fails
            return currency + ' ' + num.toLocaleString();
        }
    }

    /**
     * Format a number as a percentage.
     * 
     * @param {*} value - Value to format (0-1 range)
     * @param {number} decimals - Number of decimal places (default: 0)
     * @param {string} fallback - Fallback if value is not a number (default: '0%')
     * @returns {string} Formatted percentage
     * 
     * USAGE:
     *   FormatUtils.formatPercentage(0.1234); // "12%"
     *   FormatUtils.formatPercentage(0.1234, 1); // "12.3%"
     */
    function formatPercentage(value, decimals, fallback) {
        decimals = decimals || 0;
        fallback = fallback || '0%';

        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        var num = Number(value);
        if (!Number.isFinite(num)) {
            return fallback;
        }

        return (num * 100).toFixed(decimals) + '%';
    }

    // ============================================================
    // DAY NAME FUNCTIONS (moved from CalendarUtils)
    // ============================================================

    /**
     * Get day name by number (1-indexed: Monday=1, Sunday=7).
     * 
     * @param {number} day - Day number (1-7, Monday=1)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     * 
     * USAGE:
     *   FormatUtils.getDayName(3); // 'Wednesday'
     *   FormatUtils.getDayName(3, 'short'); // 'Wed'
     *   FormatUtils.getDayName(3, 'min'); // 'We'
     */
    function getDayName(day, format) {
        if (CalendarConstants && typeof CalendarConstants.getDayName === 'function') {
            return CalendarConstants.getDayName(day, format);
        }

        // Emergency fallback (should never be reached)
        format = format || 'long';
        var num = parseInteger(day);
        if (num === null || num < 1 || num > 7) {
            return 'Unknown';
        }

        var names = {
            'long': ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            'short': ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            'min': ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
        };

        var dayNames = names[format] || names['long'];
        return dayNames[num] || 'Unknown';
    }

    /**
     * Get day name by number (0-indexed: Sunday=0, Saturday=6).
     * 
     * @param {number} day - Day number (0-6, Sunday=0)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     * 
     * USAGE:
     *   FormatUtils.getDayName0(2); // 'Tuesday' (0-indexed)
     *   FormatUtils.getDayName0(0); // 'Sunday'
     */
    function getDayName0(day, format) {
        if (CalendarConstants && typeof CalendarConstants.getDayName0 === 'function') {
            return CalendarConstants.getDayName0(day, format);
        }

        // Emergency fallback (should never be reached)
        format = format || 'long';
        var num = parseInteger(day);
        if (num === null || num < 0 || num > 6) {
            return 'Unknown';
        }

        var names = {
            'long': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            'short': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            'min': ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
        };

        var dayNames = names[format] || names['long'];
        return dayNames[num] || 'Unknown';
    }

    /**
     * Get day number from day name.
     * 
     * @param {string} dayName - Day name (e.g., 'Monday', 'Mon', 'Mo')
     * @returns {number|null} Day number (1-7, Monday=1) or null
     * 
     * USAGE:
     *   FormatUtils.getDayNumber('Mon'); // 2
     *   FormatUtils.getDayNumber('Tuesday'); // 3
     */
    function getDayNumber(dayName) {
        if (CalendarConstants && typeof CalendarConstants.getDayNumber === 'function') {
            return CalendarConstants.getDayNumber(dayName);
        }

        // Emergency fallback (should never be reached)
        if (!dayName || typeof dayName !== 'string') {
            return null;
        }

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
    // HOUR FORMATTING FUNCTIONS (moved from CalendarUtils)
    // ============================================================

    /**
     * Format an hour number to a display string (e.g., 9 -> "9:00 AM", 14 -> "2:00 PM").
     * 
     * @param {number} hour - Hour number (0-23)
     * @param {boolean} includeMinutes - Whether to include ":00" (default: true)
     * @returns {string} Formatted hour string
     * 
     * USAGE:
     *   FormatUtils.formatHour(14); // "2:00 PM"
     *   FormatUtils.formatHour(9, false); // "9 AM"
     */
    function formatHour(hour, includeMinutes) {
        if (CalendarConstants && typeof CalendarConstants.formatHour === 'function') {
            return CalendarConstants.formatHour(hour, includeMinutes);
        }

        // Emergency fallback (should never be reached)
        includeMinutes = includeMinutes !== false;

        var num = parseInteger(hour);
        if (num === null || num < 0 || num > 23) {
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
     * @returns {number|null} Hour number (0-23) or null if invalid
     * 
     * USAGE:
     *   FormatUtils.parseHour('2:30 PM'); // 14
     *   FormatUtils.parseHour('14:00'); // 14
     */
    function parseHour(timeStr) {
        if (CalendarConstants && typeof CalendarConstants.parseHour === 'function') {
            return CalendarConstants.parseHour(timeStr);
        }

        // Emergency fallback (should never be reached)
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
    // EXPOSE
    // ============================================================

    window.FormatUtils = {
        // Core formatting
        formatDate: formatDate,
        truncateString: truncateString,
        truncateWithSuffix: truncateWithSuffix,

        // Number formatting
        formatNumber: formatNumber,
        formatCurrency: formatCurrency,
        formatPercentage: formatPercentage,

        // Day name functions (from CalendarUtils)
        getDayName: getDayName,
        getDayName0: getDayName0,
        getDayNumber: getDayNumber,

        // Hour functions (from CalendarUtils)
        formatHour: formatHour,
        parseHour: parseHour
    };

})();