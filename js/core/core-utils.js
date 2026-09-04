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
 *   - PURE functions only (no side effects)
 *   - Small, focused, composable
 * 
 * WHAT BELONGS HERE:
 *   - Type checking (isObject, isSafeInteger, isPositiveInteger)
 *   - Period parsing (parseOptionalPeriod, parsePositivePeriod, etc.)
 *   - ID generation (generateId)
 *   - Deep clone (deepClone) - delegates to ObjectUtils
 *   - Formatting (formatDate, truncateString)
 * 
 * WHAT DOES NOT BELONG HERE (REMOVED):
 *   - Team predicates (isTeamOperational, etc.) → TeamQueries
 *   - Team queries (getTeamById, getTeams, etc.) → TeamQueries
 *   - Character queries (getCharacterById, getDisplayName, etc.) → CharacterQueries
 *   - Class queries (getClasses, getClass, etc.) → ClassesQueries
 *   - Discipline queries (getDiscipline, etc.) → DisciplineCore
 *   - Schedule queries (getStudentSchedule) → ScheduleCore
 *   - Elimination queries (isCharacterEliminated) → Elimination
 *   - Tournament helpers (getParticipantName) → TournamentCore
 *   - Random generators (generateRandomStats) → CharacterGenerator
 *   - Activity logging (_logActivity, recordActivity) → ActivityLog
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (optional, for deepClone)
 *   - window.IdUtils (optional, for generateId)
 *   - window.ValidationUtils (optional, for parsing)
 * 
 * USAGE:
 *   var utils = window.CoreUtils;
 *   var obj = utils.isObject(value);
 *   var id = utils.generateId('user');
 *   var parsed = utils.parseOptionalPeriod('42');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__coreUtilsLoaded) {
        return;
    }
    window.__coreUtilsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS (optional, with fallbacks)
    // ============================================================

    var ObjectUtils = window.ObjectUtils || null;
    var IdUtils = window.IdUtils || null;
    var ValidationUtils = window.ValidationUtils || null;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    /**
     * Check if a value is a plain object (not null, not array).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a plain object
     */
    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
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

    // ============================================================
    // PERIOD PARSING - Generic integer-string parsing
    // ============================================================

    /**
     * Parse an optional period value to a number.
     * Returns null for invalid, empty, or non-numeric values.
     * This is a generic parser - domain interpretation (weeks, years)
     * belongs in domain modules.
     * 
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed number or null
     */
    function parseOptionalPeriod(value) {
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
     * Parse a positive period with a fallback value.
     * @param {*} value - Value to parse
     * @param {number} fallback - Fallback value if parsing fails
     * @returns {number} Parsed number or fallback
     */
    function parsePositivePeriod(value, fallback) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    /**
     * Parse a strict positive period.
     * Returns null for invalid, empty, or non-positive values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed number or null
     */
    function parseStrictPositivePeriod(value) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    /**
     * Check if a value has a non-empty period value.
     * @param {*} value - Value to check
     * @returns {boolean} True if value has content
     */
    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    /**
     * Get detailed period information.
     * @param {*} value - Value to check
     * @returns {object} { present: boolean, valid: boolean, value: number|null }
     */
    function getPeriodInfo(value) {
        if (!hasPeriodValue(value)) {
            return { present: false, valid: true, value: null };
        }
        var parsed = parseOptionalPeriod(value);
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

        // Prefer IdUtils if available
        if (IdUtils && typeof IdUtils.generateId === 'function') {
            return IdUtils.generateId(prefix);
        }

        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }

        return prefix + '_' +
               Date.now() + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // DEEP CLONE - Generic, delegates to ObjectUtils
    // ============================================================

    /**
     * Deep clone a value.
     * Delegates to ObjectUtils if available, with fallback implementation.
     * Returns null on failure.
     * 
     * @param {*} value - Value to clone
     * @returns {*} Cloned value or null on failure
     */
    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        // Prefer ObjectUtils if available
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }

        // Fallback implementation
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CoreUtils: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CoreUtils: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // FORMATTING HELPERS
    // ============================================================

    /**
     * Format a date string to a localized date string.
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted date or 'N/A'
     */
    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        var date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString();
    }

    /**
     * Truncate a string to a maximum length.
     * @param {string} str - String to truncate
     * @param {number} length - Maximum length
     * @returns {string} Truncated string
     */
    function truncateString(str, length) {
        if (str === undefined || str === null) return '';
        str = String(str);
        if (!Number.isFinite(length) || length < 0) return str;
        if (str.length <= length) return str;
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
        if (isNaN(num) || !isFinite(num)) return min;
        return Math.max(min, Math.min(max, num));
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

    /**
     * Parse a non-negative integer (>= 0).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseNonNegativeInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
            return null;
        }
        return num;
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
        if (!Array.isArray(arr) || arr.length === 0) return undefined;
        return arr[arr.length - 1];
    }

    /**
     * Get the first element of an array.
     * @param {Array} arr - Array
     * @returns {*} First element or undefined
     */
    function first(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return undefined;
        return arr[0];
    }

    /**
     * Deduplicate an array of strings or numbers.
     * @param {Array} arr - Array to deduplicate
     * @returns {Array} Deduplicated array
     */
    function unique(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.filter(function(item, index) {
            return arr.indexOf(item) === index;
        });
    }

    // ============================================================
    // OBJECT HELPERS
    // ============================================================

    /**
     * Safely get a nested property from an object.
     * @param {object} obj - Object to traverse
     * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
     * @param {*} defaultValue - Default value if property not found
     * @returns {*} Property value or default
     */
    function get(obj, path, defaultValue) {
        if (!obj || typeof obj !== 'object') return defaultValue;
        if (typeof path !== 'string') return defaultValue;

        var keys = path.split('.');
        var current = obj;

        for (var i = 0; i < keys.length; i++) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return defaultValue;
            }
            current = current[keys[i]];
        }

        return current !== undefined ? current : defaultValue;
    }

    /**
     * Safely set a nested property on an object.
     * Creates intermediate objects if they don't exist.
     * @param {object} obj - Object to modify
     * @param {string} path - Dot-separated path
     * @param {*} value - Value to set
     * @returns {object} The modified object
     */
    function set(obj, path, value) {
        if (!obj || typeof obj !== 'object') return obj;
        if (typeof path !== 'string') return obj;

        var keys = path.split('.');
        var current = obj;

        for (var i = 0; i < keys.length - 1; i++) {
            var key = keys[i];
            if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        current[keys[keys.length - 1]] = value;
        return obj;
    }

    /**
     * Check if an object has a nested property.
     * @param {object} obj - Object to check
     * @param {string} path - Dot-separated path
     * @returns {boolean} True if property exists
     */
    function has(obj, path) {
        if (!obj || typeof obj !== 'object') return false;
        if (typeof path !== 'string') return false;

        var keys = path.split('.');
        var current = obj;

        for (var i = 0; i < keys.length; i++) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return false;
            }
            if (!Object.prototype.hasOwnProperty.call(current, keys[i])) {
                return false;
            }
            current = current[keys[i]];
        }

        return true;
    }

    // ============================================================
    // STRING HELPERS
    // ============================================================

    /**
     * Capitalize the first letter of a string.
     * @param {string} str - String to capitalize
     * @returns {string} Capitalized string
     */
    function capitalize(str) {
        if (!str || typeof str !== 'string') return '';
        if (str.length === 0) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Convert a string to title case.
     * @param {string} str - String to convert
     * @returns {string} Title case string
     */
    function titleCase(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .toLowerCase()
            .split(' ')
            .map(function(word) {
                return capitalize(word);
            })
            .join(' ');
    }

    /**
     * Convert a string to kebab-case.
     * @param {string} str - String to convert
     * @returns {string} Kebab-case string
     */
    function kebabCase(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    }

    /**
     * Convert a string to snake_case.
     * @param {string} str - String to convert
     * @returns {string} Snake_case string
     */
    function snakeCase(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();
    }

    // ============================================================
    // EXPOSE - Minimal, Generic Only
    // ============================================================

    window.CoreUtils = {
        // Type helpers
        isObject: isObject,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isFiniteNumber: isFiniteNumber,
        isNonNegativeNumber: isNonNegativeNumber,

        // Period parsing
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo,
        parseNonNegativeInteger: parseNonNegativeInteger,

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

        // Object
        get: get,
        set: set,
        has: has,

        // String
        capitalize: capitalize,
        titleCase: titleCase,
        kebabCase: kebabCase,
        snakeCase: snakeCase
    };

    // ============================================================
    // LEGACY COMPATIBILITY (Deprecated - will be removed)
    // ============================================================

    // These are kept for backward compatibility during migration.
    // All new code should use the named exports above.

    window.isObject = isObject;
    window.isSafeInteger = isSafeInteger;
    window.isPositiveInteger = isPositiveInteger;
    window.parseOptionalPeriod = parseOptionalPeriod;
    window.parsePositivePeriod = parsePositivePeriod;
    window.parseStrictPositivePeriod = parseStrictPositivePeriod;
    window.hasPeriodValue = hasPeriodValue;
    window.getPeriodInfo = getPeriodInfo;
    window.generateId = generateId;
    window.deepClone = deepClone;
    window.formatDate = formatDate;
    window.truncateString = truncateString;

})();
