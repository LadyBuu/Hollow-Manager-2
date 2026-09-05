/**
 * utils/format-utils.js - Formatting Utilities
 * 
 * Path: js/utils/format-utils.js
 * 
 * This module provides:
 *   - formatDate - Date formatting with timezone awareness
 *   - truncateString - String truncation with validation
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects
 *   - No domain knowledge
 *   - No application state
 *   - No DOM dependencies
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
 *   var date = FormatUtils.formatDate('2026-09-05');
 *   var truncated = FormatUtils.truncateString('Hello world', 5);
 */

(function() {
    'use strict';

    if (window.__formatUtilsLoaded) return;
    window.__formatUtilsLoaded = true;

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
    // EXPOSE
    // ============================================================

    window.FormatUtils = {
        formatDate: formatDate,
        truncateString: truncateString,
        truncateWithSuffix: truncateWithSuffix,
        formatNumber: formatNumber,
        formatCurrency: formatCurrency,
        formatPercentage: formatPercentage
    };

})();