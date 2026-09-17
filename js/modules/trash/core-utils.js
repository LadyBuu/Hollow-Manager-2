/**
 * js/core/core-utils.js - Core Utilities
 * Generic utility functions with no domain knowledge
 * Path: js/core/core-utils.js
 * 
 * This module provides GENERIC utilities that can be used by any module.
 * These functions do NOT know about HollowBlades domain concepts.
 * 
 * IMPORTANT:
 *   - NO domain concepts (characters, teams, classes, etc.)
 *   - NO DOM manipulation (that's dom-utils.js)
 *   - NO notification logic (that's notification.js)
 *   - NO activity logging (that's activity-log.js)
 *   - NO application state mutation
 *   - NO dependencies on other modules
 *   - Small, focused, composable
 * 
 * WHAT BELONGS HERE:
 *   - Type checking (isPlainObject, isSafeInteger, isPositiveInteger)
 *   - Integer parsing (parseOptionalInteger, parsePositiveInteger, etc.)
 *   - ID generation (generateId)
 *   - Deep clone (deepClone)
 *   - Formatting (formatDate, truncateString)
 *   - Number helpers (clamp, isFiniteNumber, isNonNegativeNumber)
 *   - Array helpers (isNonEmptyArray, last, first, unique)
 *   - String helpers (capitalize, titleCase, kebabCase, snakeCase)
 * 
 * WHAT DOES NOT BELONG HERE (REMOVED):
 *   - Team predicates → TeamQueries
 *   - Character queries → CharacterQueries
 *   - Class queries → ClassesQueries
 *   - Discipline queries → DisciplineCore
 *   - Schedule queries → ScheduleCore
 *   - Elimination queries → Elimination
 *   - Tournament helpers → TournamentCore
 *   - Random generators → CharacterGenerator
 *   - Activity logging → ActivityLog
 *   - DOM operations → DomUtils
 *   - Form operations → FormUtils
 *   - Timing utilities → TimingUtils
 *   - Object cloning → ObjectUtils
 * 
 * DEPENDENCIES:
 *   - None
 * 
 * USAGE:
 *   var utils = window.CoreUtils;
 *   var obj = utils.isPlainObject(value);
 *   var id = utils.generateId('user');
 *   var parsed = utils.parseOptionalInteger('42');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__coreUtilsLoaded) {
        return;
    }
    window.__coreUtilsLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    /**
     * Check if a value is a plain object (not null, not array).
     * Plain objects have Object.prototype as their prototype.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a plain object
     */
    function isPlainObject(value) {
        if (value === null || typeof value !== 'object') {
            return false;
        }

        var prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    /**
     * Check if a value is a safe integer.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a safe integer
     */
    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    /**
     * Check if a value is a positive integer (>= 1).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a positive integer
     */
    function isPositiveInteger(value) {
        return isSafeInteger(value) && value >= 1;
    }

    /**
     * Check if a value is a finite number.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a finite number
     */
    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Check if a value is a non-negative number (>= 0).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-negative number
     */
    function isNonNegativeNumber(value) {
        return isFiniteNumber(value) && value >= 0;
    }

    // ============================================================
    // INTEGER PARSING - Generic integer-string parsing
    // ============================================================

    /**
     * Parse an optional integer value.
     * Returns null for invalid, empty, or non-numeric values.
     * This is a generic parser - domain interpretation (weeks, years)
     * belongs in domain modules.
     * 
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseOptionalInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        var str = String(value).trim();

        if (!/^\d+$/.test(str)) {
            return null;
        }

        var parsed = Number(str);

        if (!isSafeInteger(parsed)) {
            return null;
        }

        return parsed;
    }

    /**
     * Parse a positive integer with a fallback value.
     * @param {*} value - Value to parse
     * @param {number} fallback - Fallback value if parsing fails
     * @returns {number} Parsed integer or fallback
     */
    function parsePositiveInteger(value, fallback) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    /**
     * Parse a strict positive integer.
     * Returns null for invalid, empty, or non-positive values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseStrictPositiveInteger(value) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    /**
     * Parse a non-negative integer (>= 0).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseNonNegativeInteger(value) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 0) ? parsed : null;
    }

    /**
     * Check if a value has content (non-empty after trimming).
     * @param {*} value - Value to check
     * @returns {boolean} True if value has content
     */
    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    /**
     * Get detailed integer information.
     * @param {*} value - Value to check
     * @returns {object} { present: boolean, valid: boolean, value: number|null }
     */
    function getIntegerInfo(value) {
        if (!hasValue(value)) {
            return { present: false, valid: true, value: null };
        }

        var parsed = parseOptionalInteger(value);
        return {
            present: true,
            valid: parsed !== null,
            value: parsed
        };
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    /**
     * Generate a unique ID with an optional prefix.
     * Uses crypto.randomUUID if available, falls back to timestamp + random.
     * 
     * @param {string} prefix - ID prefix (default: 'id')
     * @returns {string} Unique ID
     */
    function generateId(prefix) {
        prefix = prefix || 'id';

        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }

        return prefix + '_' +
               Date.now() + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // DEEP CLONE - Generic, self-contained
    // ============================================================

    /**
     * Deep clone a value.
     * Uses structuredClone if available, falls back to JSON clone.
     * Throws an error if cloning fails.
     * 
     * @param {*} value - Value to clone
     * @returns {*} Cloned value
     * @throws {Error} If cloning fails
     */
    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                // Fall through to JSON fallback
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            throw new Error('CoreUtils.deepClone: Failed to clone value: ' + e.message);
        }
    }

    // ============================================================
    // FORMATTING HELPERS
    // ============================================================

    /**
     * Format a date string to a localized date string.
     * NOTE: Date-only strings (e.g., "2026-09-05") are interpreted as UTC.
     * For precise date handling, use a dedicated date library.
     * 
     * @param {string} dateString - ISO date string
     * @param {string} fallback - Fallback value if date is invalid (default: 'N/A')
     * @returns {string} Formatted date or fallback
     */
    function formatDate(dateString, fallback) {
        fallback = fallback || 'N/A';

        if (!dateString) {
            return fallback;
        }

        var date = new Date(dateString);

        if (isNaN(date.getTime())) {
            return fallback;
        }

        return date.toLocaleDateString();
    }

    /**
     * Truncate a string to a maximum length.
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

    // ============================================================
    // NUMBER HELPERS
    // ============================================================

    /**
     * Clamp a number between a minimum and maximum value.
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Clamped value
     */
    function clamp(value, min, max) {
        var num = Number(value);
        if (isNaN(num) || !Number.isFinite(num)) {
            return min;
        }
        return Math.max(min, Math.min(max, num));
    }

    // ============================================================
    // ARRAY HELPERS
    // ============================================================

    /**
     * Check if an array is defined and has elements.
     * @param {*} arr - Value to check
     * @returns {boolean} True if array has elements
     */
    function isNonEmptyArray(arr) {
        return Array.isArray(arr) && arr.length > 0;
    }

    /**
     * Get the last element of an array.
     * @param {Array} arr - Array
     * @returns {*} Last element or undefined
     */
    function last(arr) {
        if (!Array.isArray(arr) || arr.length === 0) {
            return undefined;
        }
        return arr[arr.length - 1];
    }

    /**
     * Get the first element of an array.
     * @param {Array} arr - Array
     * @returns {*} First element or undefined
     */
    function first(arr) {
        if (!Array.isArray(arr) || arr.length === 0) {
            return undefined;
        }
        return arr[0];
    }

    /**
     * Deduplicate an array of strings or numbers.
     * @param {Array} arr - Array to deduplicate
     * @returns {Array} Deduplicated array
     */
    function unique(arr) {
        if (!Array.isArray(arr)) {
            return [];
        }
        return arr.filter(function(item, index) {
            return arr.indexOf(item) === index;
        });
    }

    // ============================================================
    // STRING HELPERS
    // ============================================================

    /**
     * Capitalize the first letter of a string.
     * @param {*} value - Value to capitalize
     * @returns {string} Capitalized string
     */
    function capitalize(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        var str = String(value);
        if (str.length === 0) {
            return str;
        }
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Convert a string to title case.
     * @param {*} value - Value to convert
     * @returns {string} Title case string
     */
    function titleCase(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        return String(value)
            .toLowerCase()
            .split(/\s+/)
            .map(function(word) {
                return capitalize(word);
            })
            .join(' ');
    }

    /**
     * Convert a string to kebab-case.
     * @param {*} value - Value to convert
     * @returns {string} Kebab-case string
     */
    function kebabCase(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        return String(value)
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    }

    /**
     * Convert a string to snake_case.
     * @param {*} value - Value to convert
     * @returns {string} Snake_case string
     */
    function snakeCase(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        return String(value)
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();
    }

    // ============================================================
    // EXPOSE - Minimal, Generic Only
    // ============================================================

    window.CoreUtils = {
        // Type helpers
        isPlainObject: isPlainObject,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isFiniteNumber: isFiniteNumber,
        isNonNegativeNumber: isNonNegativeNumber,

        // Integer parsing
        parseOptionalInteger: parseOptionalInteger,
        parsePositiveInteger: parsePositiveInteger,
        parseStrictPositiveInteger: parseStrictPositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        hasValue: hasValue,
        getIntegerInfo: getIntegerInfo,

        // ID generation
        generateId: generateId,

        // Deep clone
        deepClone: deepClone,

        // Formatting
        formatDate: formatDate,
        truncateString: truncateString,

        // Number
        clamp: clamp,

        // Array
        isNonEmptyArray: isNonEmptyArray,
        last: last,
        first: first,
        unique: unique,

        // String
        capitalize: capitalize,
        titleCase: titleCase,
        kebabCase: kebabCase,
        snakeCase: snakeCase
    };

})();