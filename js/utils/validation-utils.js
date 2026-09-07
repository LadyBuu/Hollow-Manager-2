/**
 * utils/validation-utils.js - Validation Utilities
 * Generic validation and type checking functions
 * 
 * Path: js/utils/validation-utils.js
 * 
 * This module provides:
 *   - Type checking (isPlainObject, isSafeInteger, isPositiveInteger)
 *   - Integer parsing (parseOptionalInteger, parsePositiveInteger, etc.)
 * 
 * IMPORTANT:
 *   - These functions are PURE - no side effects
 *   - No knowledge of HollowBlades domain concepts
 *   - SELF-CONTAINED - no external dependencies
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var isValid = ValidationUtils.isSafeInteger(42);
 *   var parsed = ValidationUtils.parseOptionalInteger('42');
 */

(function() {
    'use strict';

    if (window.__validationUtilsLoaded) return;
    window.__validationUtilsLoaded = true;

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

    // ============================================================
    // LEGACY ALIASES (DEPRECATED)
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
    // EXPOSE
    // ============================================================

    window.ValidationUtils = {
        // Type checking
        isPlainObject: isPlainObject,
        isObject: isObject, // Deprecated alias
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

        // Array helpers
        isNonEmptyArray: isNonEmptyArray,

        // String helpers
        capitalize: capitalize,

        // Deprecated period aliases
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo
    };

})();
