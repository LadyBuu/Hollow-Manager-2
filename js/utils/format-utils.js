/**
 * utils/format-utils.js - Formatting Utilities
 *
 * Path: js/utils/format-utils.js
 *
 * This module provides:
 *   - formatDate          - Date string -> localized date
 *   - formatRelativeTime  - ISO timestamp -> "5m ago"
 *   - truncateString      - Truncate to a maximum total length
 *   - truncateWithSuffix  - Truncate with a custom suffix
 *   - formatNumber        - Number with locale thousands separators
 *   - formatCurrency      - Number with locale currency format
 *   - formatPercentage    - Number (0-1) as a percentage
 *   - getDayName          - 1-indexed day name (Monday=1)
 *   - getDayName0         - 0-indexed day name (Sunday=0)
 *   - getDayNumber        - Day name -> 1-indexed number
 *   - formatHour          - Hour number -> "2:00 PM"
 *   - parseTimeString     - "9:00 AM" -> 0-23 integer
 *
 * IMPORTANT:
 *   - No side effects. No application state. No DOM dependencies.
 *   - Pure with respect to input -> output, EXCEPT that formatDate,
 *     formatNumber, formatCurrency, and formatRelativeTime depend
 *     on the browser locale and the current time. Callers that need
 *     deterministic output must pin the locale or use a date
 *     library.
 *   - CalendarConstants is a MANDATORY dependency. The module
 *     throws at load time if it is missing or lacks the required
 *     functions. There are no fallback day-name or hour tables.
 *
 * DATE SEMANTICS:
 *   - Date-only strings (e.g. "2026-09-05") are parsed as UTC
 *     midnight by `new Date()`, then rendered in local time by
 *     `toLocaleDateString()`. West of UTC this shows the previous
 *     calendar day. For date-only values, either store a full
 *     timestamp or format with `timeZone: 'UTC'` at the call site.
 *     This module does not do that for you because not every caller
 *     wants UTC.
 *
 * RELATIVE TIME SEMANTICS:
 *   - formatRelativeTime expects an ISO 8601 timestamp.
 *   - Past-only by design. A timestamp more than 30 seconds in
 *     the future returns the fallback, because the historical
 *     behaviour of "Just now" for future-dated data (clock skew,
 *     imported records) was misleading.
 *   - Boundaries:
 *       < 1 minute     -> "Just now"
 *       < 60 minutes   -> "Xm ago"
 *       < 24 hours     -> "Xh ago"
 *       < 7 days       -> "Xd ago"
 *       otherwise      -> localized date string
 *   - Invalid or missing timestamps return the fallback.
 *
 * FALLBACK SEMANTICS:
 *   Every formatter accepts an optional fallback, applied when the
 *   input is absent or invalid. A fallback of '' or 0 is respected;
 *   it is only substituted when the argument is `undefined`. The
 *   old code used `fallback || DEFAULT`, which swallowed '' and 0.
 *
 * PARSEHOUR RENAME:
 *   This module's time-string parser was named parseHour, which
 *   collided with CalendarValidation.parseHour (which validates a
 *   numeric hour against [MIN_HOUR, MAX_HOUR]). The function is now
 *   parseTimeString. A deprecated alias parseHour is kept on the
 *   export for backward compatibility with existing call sites.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants (MANDATORY)
 *   - window.ValidationUtils (for truncateString; if absent, a
 *     local implementation matching its semantics is used)
 *   - window.ValidationUtils.parseOptionalInteger (if absent, a
 *     local implementation matching its strictness is used)
 *
 * USAGE:
 *   var FU = window.FormatUtils;
 *   FU.formatDate('2026-09-05');
 *   FU.truncateString('Hello world', 8);        // 'hello...'? -> 'Hello...'
 *   FU.getDayName(3);                            // 'Wednesday'
 *   FU.formatHour(14);                           // '2:00 PM'
 *   FU.formatRelativeTime('2026-09-10T08:00:00Z');
 *   FU.parseTimeString('9:00 AM');               // 9
 */

(function() {
    'use strict';

    if (window.__formatUtilsLoaded) return;

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var _missing = [];

    if (!CalendarConstants || typeof CalendarConstants !== 'object') {
        _missing.push('CalendarConstants');
    } else {
        var requiredMethods = [
            'getDayName',
            'getDayName0',
            'getDayNumber',
            'formatHour',
            'parseHour'
        ];
        for (var i = 0; i < requiredMethods.length; i++) {
            var m = requiredMethods[i];
            if (typeof CalendarConstants[m] !== 'function') {
                _missing.push('CalendarConstants.' + m);
            }
        }
    }

    window.__formatUtilsLoaded = true;

    if (_missing.length > 0) {
        window.FormatUtils = Object.freeze({
            _loadFailed: true,
            _missing: _missing.slice()
        });
        throw new Error(
            '[FormatUtils] Missing or invalid dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // DEPENDENCY CACHE
    // ============================================================
    // These are read at call time inside the helpers, not cached
    // into local variables, so a late-loaded ValidationUtils is
    // still picked up.

    function getValidationUtils() {
        return window.ValidationUtils;
    }

    // ============================================================
    // INTEGER PARSING
    // ============================================================
    // Delegates to ValidationUtils.parseOptionalInteger when
    // available. Falls back to a local strict implementation with
    // identical semantics. Rejects '0x10', '1e1', '5.0', signed
    // strings, and non-numeric types.

    function parseInteger(value) {
        var VU = getValidationUtils();
        if (VU && typeof VU.parseOptionalInteger === 'function') {
            return VU.parseOptionalInteger(value);
        }

        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value === 'number') {
            return Number.isSafeInteger(value) ? value : null;
        }

        if (typeof value !== 'string') {
            return null;
        }

        var trimmed = value.trim();
        if (trimmed === '' || !/^\d+$/.test(trimmed)) {
            return null;
        }

        var num = Number(trimmed);
        return Number.isSafeInteger(num) ? num : null;
    }

    // ============================================================
    // FALLBACK HELPERS
    // ============================================================

    function resolveFallback(value, defaultValue) {
        return value !== undefined ? value : defaultValue;
    }

    // ============================================================
    // DATE / TIME FORMATTING
    // ============================================================

    /**
     * Format a date string to a localized date string.
     *
     * SEMANTICS:
     *   - Date-only strings (e.g. "2026-09-05") are parsed as UTC
     *     midnight and rendered in local time. West of UTC this
     *     can show the previous day. See the header note.
     *
     * @param {string} dateString
     * @param {string} [fallback='N/A']
     * @returns {string}
     */
    function formatDate(dateString, fallback) {
        fallback = resolveFallback(fallback, 'N/A');

        if (dateString === undefined || dateString === null || dateString === '') {
            return fallback;
        }

        var date = new Date(String(dateString));
        if (isNaN(date.getTime())) {
            return fallback;
        }

        return date.toLocaleDateString();
    }

    /**
     * Format a timestamp as a relative time string.
     *
     * A timestamp more than 30 seconds in the future returns the
     * fallback. Timestamps within the last 30 seconds (or up to 30
     * seconds ahead, for clock skew) return "Just now".
     *
     * @param {string} timestamp
     * @param {string} [fallback='']
     * @returns {string}
     */
    function formatRelativeTime(timestamp, fallback) {
        fallback = resolveFallback(fallback, '');

        if (!timestamp) {
            return fallback;
        }

        var date = new Date(timestamp);
        if (isNaN(date.getTime())) {
            return fallback;
        }

        var now = Date.now();
        var diffMs = now - date.getTime();

        // Future beyond a small skew tolerance: not "just now".
        if (diffMs < -30000) {
            return fallback;
        }

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

    // ============================================================
    // STRING TRUNCATION
    // ============================================================
    // Delegates to ValidationUtils.truncateString so there is one
    // implementation. Semantics: the result is at most `length`
    // characters, INCLUDING the suffix.

    /**
     * Truncate a string to a maximum total length, including the
     * suffix. Delegates to ValidationUtils.truncateString.
     *
     * NOTE: Older versions of this module appended '...' AFTER
     * truncating to `length`, producing `length + 3` characters.
     * The current semantics match ValidationUtils (the total is
     * `length`). Callers that relied on the longer output need to
     * pass `length + 3`.
     *
     * @param {*} value
     * @param {number} length - Maximum total length including suffix
     * @returns {string}
     */
    function truncateString(value, length) {
        var VU = getValidationUtils();
        if (VU && typeof VU.truncateString === 'function') {
            return VU.truncateString(value, length);
        }

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
        if (length <= 3) {
            return '...'.substring(0, length);
        }
        return str.substring(0, length - 3) + '...';
    }

    /**
     * Truncate with a custom suffix.
     *
     * Same semantics as truncateString, with the suffix supplied by
     * the caller.
     *
     * @param {*} value
     * @param {number} length - Maximum total length including suffix
     * @param {string} [suffix='...']
     * @returns {string}
     */
    function truncateWithSuffix(value, length, suffix) {
        suffix = suffix === undefined ? '...' : String(suffix);

        var VU = getValidationUtils();
        if (VU && typeof VU.truncateString === 'function') {
            return VU.truncateString(value, length, suffix);
        }

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
        if (length <= suffix.length) {
            return suffix.substring(0, length);
        }
        return str.substring(0, length - suffix.length) + suffix;
    }

    // ============================================================
    // NUMBER / CURRENCY / PERCENTAGE
    // ============================================================

    function formatNumber(value, fallback) {
        fallback = resolveFallback(fallback, '0');

        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        var num = Number(value);
        if (!Number.isFinite(num)) {
            return fallback;
        }

        return num.toLocaleString();
    }

    var CURRENCY_SYMBOLS = {
        USD: '$', EUR: '€', GBP: '£', JPY: '¥',
        CHF: 'CHF', CAD: 'CA$', AUD: 'A$', CNY: '¥',
        SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł'
    };

    function currencyFallback(currency, value) {
        var symbol = CURRENCY_SYMBOLS[currency];
        if (symbol) {
            return symbol + '0';
        }
        return currency + ' 0';
    }

    function formatCurrency(value, currency, fallback) {
        currency = currency || 'USD';

        if (fallback === undefined) {
            fallback = currencyFallback(currency, value);
        }

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
     * @param {*} value - Value in the 0-1 range (0.5 -> '50%')
     * @param {number} [decimals=0] - Non-negative integer decimal places
     * @param {string} [fallback='0%']
     * @returns {string}
     */
    function formatPercentage(value, decimals, fallback) {
        fallback = resolveFallback(fallback, '0%');

        if (decimals === undefined || decimals === null) {
            decimals = 0;
        }
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) {
            decimals = 0;
        }

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
    // DAY NAME FUNCTIONS - delegate to CalendarConstants
    // ============================================================

    function getDayName(day, format) {
        return CalendarConstants.getDayName(day, format);
    }

    function getDayName0(day, format) {
        return CalendarConstants.getDayName0(day, format);
    }

    function getDayNumber(dayName) {
        return CalendarConstants.getDayNumber(dayName);
    }

    // ============================================================
    // HOUR FUNCTIONS - delegate to CalendarConstants
    // ============================================================

    function formatHour(hour, includeMinutes) {
        return CalendarConstants.formatHour(hour, includeMinutes);
    }

    /**
     * Parse a time string to an hour number.
     *
     * NOTE: This is a DIFFERENT function from
     * CalendarValidation.parseHour, which validates a numeric hour
     * against [MIN_HOUR, MAX_HOUR]. This one parses a string like
     * '9:00 AM' or '14:00' to a 0-23 integer.
     */
    function parseTimeString(timeStr) {
        return CalendarConstants.parseHour(timeStr);
    }

    /**
     * @deprecated Use parseTimeString. Kept for backward
     * compatibility with existing call sites that call
     * FormatUtils.parseHour.
     */
    function parseHourLegacy(timeStr) {
        return parseTimeString(timeStr);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FormatUtils = Object.freeze({
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
        parseTimeString: parseTimeString,
        parseHour: parseHourLegacy   // deprecated alias
    });

})();
