/**
 * utils/validation-utils.js - Validation Utilities
 * Generic validation and type checking functions
 * 
 * Path: js/utils/validation-utils.js
 * 
 * This module provides:
 *   - Type checking (isPlainObject, isSafeInteger, isPositiveInteger)
 *   - Integer parsing (parseOptionalInteger, parsePositiveInteger, etc.)
 *   - String validation (isNonEmptyString, hasValue)
 * 
 * IMPORTANT:
 *   - These functions are PURE - no side effects
 *   - No knowledge of HollowBlades domain concepts
 *   - SELF-CONTAINED - no external dependencies
 *   - This is the SINGLE SOURCE OF TRUTH for validation utilities
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var isValid = ValidationUtils.isSafeInteger(42);
 *   var parsed = ValidationUtils.parseOptionalInteger('42');
 *   var hasContent = ValidationUtils.isNonEmptyString('hello');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__validationUtilsLoaded) {
        return;
    }
    window.__validationUtilsLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    /**
     * Check if a value is a plain object (not null, not array).
     * Plain objects have Object.prototype as their prototype.
     * 
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
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a safe integer
     */
    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    /**
     * Check if a value is a positive integer (>= 1).
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a positive integer
     */
    function isPositiveInteger(value) {
        return isSafeInteger(value) && value >= 1;
    }

    /**
     * Check if a value is a finite number.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a finite number
     */
    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Check if a value is a non-negative number (>= 0).
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-negative number
     */
    function isNonNegativeNumber(value) {
        return isFiniteNumber(value) && value >= 0;
    }

    /**
     * Check if a value is a string.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a string
     */
    function isString(value) {
        return typeof value === 'string';
    }

    /**
     * Check if a value is a non-empty string (after trimming).
     * This is the CANONICAL string validation function.
     * All modules MUST use this for string validation.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-empty string
     * 
     * USAGE:
     *   if (ValidationUtils.isNonEmptyString(input)) {
     *       // input is a valid non-empty string
     *   }
     */
    function isNonEmptyString(value) {
        return isString(value) && value.trim() !== '';
    }

    /**
     * Check if a value has content (non-empty after trimming).
     * Works for strings, arrays, and objects.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value has content
     */
    function hasValue(value) {
        if (value === undefined || value === null) {
            return false;
        }

        if (isString(value)) {
            return value.trim() !== '';
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        if (isPlainObject(value)) {
            return Object.keys(value).length > 0;
        }

        return true;
    }

    // ============================================================
    // INTEGER PARSING
    // ============================================================

    /**
     * Parse an optional integer value.
     * Returns null for invalid, empty, or non-numeric values.
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

        if (!Number.isSafeInteger(parsed)) {
            return null;
        }

        return parsed;
    }

    /**
     * Parse a positive integer with a fallback value.
     * 
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
     * 
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
     * 
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseNonNegativeInteger(value) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 0) ? parsed : null;
    }

    /**
     * Get detailed integer information.
     * 
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
    // ARRAY HELPERS
    // ============================================================

    /**
     * Check if an array is defined and has elements.
     * 
     * @param {*} arr - Value to check
     * @returns {boolean} True if array has elements
     */
    function isNonEmptyArray(arr) {
        return Array.isArray(arr) && arr.length > 0;
    }

    /**
     * Check if a value is an array.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is an array
     */
    function isArray(value) {
        return Array.isArray(value);
    }

    // ============================================================
    // STRING HELPERS
    // ============================================================

    /**
     * Capitalize the first letter of a string.
     * 
     * @param {*} value - Value to capitalize
     * @returns {string} Capitalized string
     */
    function capitalize(value) {
        if (!isNonEmptyString(value)) {
            return '';
        }
        var str = String(value);
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Truncate a string to a maximum length.
     * 
     * @param {string} value - String to truncate
     * @param {number} length - Maximum length
     * @param {string} suffix - Suffix to add (default: '...')
     * @returns {string} Truncated string
     */
    function truncateString(value, length, suffix) {
        if (!isNonEmptyString(value)) {
            return '';
        }

        suffix = suffix || '...';

        if (!isSafeInteger(length) || length < 1) {
            return String(value);
        }

        var str = String(value);
        if (str.length <= length) {
            return str;
        }

        return str.substring(0, length - suffix.length) + suffix;
    }

    /**
     * Get the string length (safe for null/undefined).
     * 
     * @param {*} value - Value to check
     * @returns {number} String length or 0
     */
    function stringLength(value) {
        if (value === undefined || value === null) {
            return 0;
        }
        return String(value).length;
    }

    /**
     * Check if a string is empty or whitespace only.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if string is empty or whitespace
     */
    function isEmptyOrWhitespace(value) {
        if (value === undefined || value === null) {
            return true;
        }
        return String(value).trim() === '';
    }

    // ============================================================
    // OBJECT HELPERS
    // ============================================================

    /**
     * Check if an object has a specific key.
     * 
     * @param {object} obj - Object to check
     * @param {string} key - Key to look for
     * @returns {boolean} True if object has the key
     */
    function hasKey(obj, key) {
        if (!isPlainObject(obj)) {
            return false;
        }
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    /**
     * Get an object's keys (safe for null/undefined).
     * 
     * @param {object} obj - Object to get keys from
     * @returns {string[]} Array of keys
     */
    function getKeys(obj) {
        if (!isPlainObject(obj)) {
            return [];
        }
        return Object.keys(obj);
    }

    /**
     * Check if an object is empty.
     * 
     * @param {object} obj - Object to check
     * @returns {boolean} True if object is empty
     */
    function isEmptyObject(obj) {
        if (!isPlainObject(obj)) {
            return true;
        }
        return Object.keys(obj).length === 0;
    }

    // ============================================================
    // NUMBER HELPERS
    // ============================================================

    /**
     * Clamp a number between a minimum and maximum value.
     * 
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Clamped value
     */
    function clamp(value, min, max) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) {
            return min;
        }
        return Math.max(min, Math.min(max, num));
    }

    /**
     * Check if a value is a valid number (finite).
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a finite number
     */
    function isValidNumber(value) {
        return isFiniteNumber(value);
    }

    /**
     * Parse a number with a fallback.
     * 
     * @param {*} value - Value to parse
     * @param {number} fallback - Fallback value
     * @returns {number} Parsed number or fallback
     */
    function parseNumber(value, fallback) {
        var num = Number(value);
        return isFiniteNumber(num) ? num : fallback;
    }

    // ============================================================
    // LEGACY ALIASES (DEPRECATED - Kept for backward compatibility)
    // ============================================================

    /**
     * @deprecated Use parseOptionalInteger() instead.
     */
    function parseOptionalPeriod(value) {
        return parseOptionalInteger(value);
    }

    /**
     * @deprecated Use parsePositiveInteger() instead.
     */
    function parsePositivePeriod(value, fallback) {
        return parsePositiveInteger(value, fallback);
    }

    /**
     * @deprecated Use parseStrictPositiveInteger() instead.
     */
    function parseStrictPositivePeriod(value) {
        return parseStrictPositiveInteger(value);
    }

    /**
     * @deprecated Use hasValue() instead.
     */
    function hasPeriodValue(value) {
        return hasValue(value);
    }

    /**
     * @deprecated Use getIntegerInfo() instead.
     */
    function getPeriodInfo(value) {
        return getIntegerInfo(value);
    }

    /**
     * @deprecated Use isPlainObject() instead.
     */
    function isObject(value) {
        return isPlainObject(value);
    }

    // ============================================================
    // EXPOSE - All functions properly exported
    // ============================================================

    window.ValidationUtils = {
        // ---- Type checking ----
        isPlainObject: isPlainObject,
        isObject: isObject, // Deprecated alias
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isFiniteNumber: isFiniteNumber,
        isNonNegativeNumber: isNonNegativeNumber,
        isString: isString,
        isNonEmptyString: isNonEmptyString, // <-- CRITICAL: This was missing!
        hasValue: hasValue,

        // ---- Integer parsing ----
        parseOptionalInteger: parseOptionalInteger,
        parsePositiveInteger: parsePositiveInteger,
        parseStrictPositiveInteger: parseStrictPositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        getIntegerInfo: getIntegerInfo,

        // ---- Array helpers ----
        isArray: isArray,
        isNonEmptyArray: isNonEmptyArray,

        // ---- String helpers ----
        capitalize: capitalize,
        truncateString: truncateString,
        stringLength: stringLength,
        isEmptyOrWhitespace: isEmptyOrWhitespace,

        // ---- Object helpers ----
        hasKey: hasKey,
        getKeys: getKeys,
        isEmptyObject: isEmptyObject,

        // ---- Number helpers ----
        clamp: clamp,
        isValidNumber: isValidNumber,
        parseNumber: parseNumber,

        // ---- Deprecated period aliases ----
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo
    };


    // ============================================================
    // VERIFICATION
    // ============================================================

    // Self-test to ensure critical exports exist
    (function verify() {
        var missing = [];

        // Check that isNonEmptyString is properly exposed
        if (typeof window.ValidationUtils.isNonEmptyString !== 'function') {
            missing.push('ValidationUtils.isNonEmptyString');
        }

        // Check that hasValue is properly exposed
        if (typeof window.ValidationUtils.hasValue !== 'function') {
            missing.push('ValidationUtils.hasValue');
        }

        // Check that global aliases exist
        if (typeof window.isNonEmptyString !== 'function') {
            missing.push('window.isNonEmptyString');
        }

        if (missing.length > 0) {
            console.error('[ValidationUtils] Verification failed - missing exports:', missing.join(', '));
        } else {
            console.log('[ValidationUtils] All exports verified successfully.');
        }
    })();

})();
