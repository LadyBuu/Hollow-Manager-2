/**
 * utils/format-utils.js - Formatting Utilities
 * 
 * Path: js/utils/format-utils.js
 * 
 * This module provides:
 *   - formatDate - Date formatting with timezone awareness
 *   - truncateString - String truncation with validation
 *   - truncateWithSuffix - String truncation with custom suffix
 *   - formatNumber - Number formatting with locale
 *   - formatCurrency - Currency formatting
 *   - formatPercentage - Percentage formatting
 *   - getDayName - Day name lookup (1-indexed, Monday=1)
 *   - getDayName0 - Day name lookup (0-indexed, Sunday=0)
 *   - getDayNumber - Day number from day name
 *   - formatHour - Hour formatting (12-hour with AM/PM)
 *   - parseHour - Hour parsing from time string
 *   - formatRelativeTime - Relative time formatting ("2h ago")
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
 * RELATIVE TIME SEMANTICS:
 *   - formatRelativeTime expects an ISO 8601 timestamp
 *   - Returns '' (or the provided fallback) for invalid/missing timestamps
 *   - Past-only: assumes the timestamp is in the past
 *   - Boundaries: <1m → "Just now", <60m → "Xm ago", <24h → "Xh ago",
 *     <7d → "Xd ago", otherwise → localized date string
 * 
 * USAGE:
 *   var FU = window.FormatUtils;
 *   var date = FU.formatDate('2026-09-05');
 *   var truncated = FU.truncateString('Hello world', 5);
 *   var dayName = FU.getDayName(3); // 'Wednesday'
 *   var hour = FU.formatHour(14); // '2:00 PM'
 *   var relative = FU.formatRelativeTime('2026-09-10T08:00:00Z'); // '2h ago'
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
     */
    function formatDate(dateString, fallback) {
        fallback = fallback || 'N/A';

        if (dateString === undefined || dateString === null || dateString === '') {
            return fallback;
        }

        var str = String(dateString);
        var date = new Date(str);

        if (isNaN(date.getTime())) {
            return fallback;
        }

        return date.toLocaleDateString();
    }

    /**
     * Format a timestamp as a relative time string.
     * 
     * Produces human-friendly strings for recent timestamps:
     *   - < 1 minute:   "Just now"
     *   - < 1 hour:     "Xm ago"
     *   - < 1 day:      "Xh ago"
     *   - < 1 week:     "Xd ago"
     *   - Otherwise:    localized date string (e.g., "9/10/2026")
     * 
     * SEMANTICS:
     *   - Assumes past timestamps. Future timestamps produce "Just now"
     *     because the diff is negative and the first branch matches.
     *   - Invalid or missing timestamps return the fallback.
     *   - Uses Date diffing; not timezone-aware beyond what the
     *     browser provides for the current locale.
     * 
     * @param {string} timestamp - ISO 8601 timestamp
     * @param {string} fallback - Fallback for invalid timestamps (default: '')
     * @returns {string} Relative time string or fallback
     * 
     * USAGE:
     *   formatRelativeTime('2026-09-10T10:30:00Z'); // '5m ago'
     *   formatRelativeTime('2026-09-08T10:30:00Z'); // '2d ago'
     *   formatRelativeTime('invalid', 'unknown');   // 'unknown'
     *   formatRelativeTime(null);                   // ''
     */
    function formatRelativeTime(timestamp, fallback) {
        fallback = fallback !== undefined ? fallback : '';

        if (!timestamp) {
            return fallback;
        }

        var date = new Date(timestamp);
        if (isNaN(date.getTime())) {
            return fallback;
        }

        var now = new Date();
        var diffMs = now - date;
        var diffMins = Math.floor(diffMs / 60000);
        var diffHours = Math.floor(diffMs / 3600000);
        var diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return 'Just now';
        }
        if (diffMins < 60) {
            return diffMins + 'm ago';
        }
        if (diffHours < 24) {
            return diffHours + 'h ago';
        }
        if (diffDays < 7) {
            return diffDays + 'd ago';
        }

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
     */
    function truncateString(value, length) {
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);

        if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
            return str;
        }

        if (str.length <= length) {
            return str;
        }

        return str.substring(0, length) + '...';
    }

    /**
     * Truncate a string with custom suffix.
     * 
     * @param {*} value - Value to truncate
     * @param {number} length - Maximum length
     * @param {string} suffix - Suffix to append (default: '...')
     * @returns {string} Truncated string
     */
    function truncateWithSuffix(value, length, suffix) {
        suffix = suffix || '...';

        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);

        if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
            return str;
        }

        if (str.length <= length) {
            return str;
        }

        return str.substring(0, length) + suffix;
    }

    /**
     * Format a number with commas.
     * 
     * @param {*} value - Value to format
     * @param {string} fallback - Fallback if value is not a number (default: '0')
     * @returns {string} Formatted number
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
    // DAY NAME FUNCTIONS
    // ============================================================

    /**
     * Get day name by number (1-indexed: Monday=1, Sunday=7).
     * 
     * @param {number} day - Day number (1-7, Monday=1)
     * @param {string} format - 'long', 'short', or 'min' (default: 'long')
     * @returns {string} Day name
     */
    function getDayName(day, format) {
        if (CalendarConstants && typeof CalendarConstants.getDayName === 'function') {
            return CalendarConstants.getDayName(day, format);
        }

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
     */
    function getDayName0(day, format) {
        if (CalendarConstants && typeof CalendarConstants.getDayName0 === 'function') {
            return CalendarConstants.getDayName0(day, format);
        }

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
     */
    function getDayNumber(dayName) {
        if (CalendarConstants && typeof CalendarConstants.getDayNumber === 'function') {
            return CalendarConstants.getDayNumber(dayName);
        }

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
    // HOUR FORMATTING FUNCTIONS
    // ============================================================

    /**
     * Format an hour number to a display string (e.g., 9 -> "9:00 AM", 14 -> "2:00 PM").
     * 
     * @param {number} hour - Hour number (0-23)
     * @param {boolean} includeMinutes - Whether to include ":00" (default: true)
     * @returns {string} Formatted hour string
     */
    function formatHour(hour, includeMinutes) {
        if (CalendarConstants && typeof CalendarConstants.formatHour === 'function') {
            return CalendarConstants.formatHour(hour, includeMinutes);
        }

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
     */
    function parseHour(timeStr) {
        if (CalendarConstants && typeof CalendarConstants.parseHour === 'function') {
            return CalendarConstants.parseHour(timeStr);
        }

        if (!timeStr || typeof timeStr !== 'string') {
            return null;
        }

        var trimmed = timeStr.trim().toUpperCase();

        var match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
        if (match24) {
            var hour = parseInt(match24[1], 10);
            var minute = parseInt(match24[2], 10);
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return hour;
            }
        }

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
        formatRelativeTime: formatRelativeTime,
        truncateString: truncateString,
        truncateWithSuffix: truncateWithSuffix,

        // Number formatting
        formatNumber: formatNumber,
        formatCurrency: formatCurrency,
        formatPercentage: formatPercentage,

        // Day name functions
        getDayName: getDayName,
        getDayName0: getDayName0,
        getDayNumber: getDayNumber,

        // Hour functions
        formatHour: formatHour,
        parseHour: parseHour
    };

})();
