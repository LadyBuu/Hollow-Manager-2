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
 *   - Delegates to CoreUtils - the SINGLE SOURCE OF TRUTH
 *   - This module exists for backward compatibility during migration
 *   - New code should use CoreUtils directly
 * 
 * DEPENDENCIES:
 *   - window.CoreUtils (for all validation logic)
 * 
 * USAGE:
 *   // Legacy (still works)
 *   var isValid = ValidationUtils.isSafeInteger(42);
 * 
 *   // Preferred (new code)
 *   var isValid = CoreUtils.isSafeInteger(42);
 */

(function() {
    'use strict';

    if (window.__validationUtilsLoaded) return;
    window.__validationUtilsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CoreUtils = window.CoreUtils;

    // ============================================================
    // DELEGATE TO COREUTILS
    // ============================================================

    /**
     * Check if a value is a plain object.
     * @deprecated Use CoreUtils.isPlainObject() instead.
     */
    function isPlainObject(value) {
        if (CoreUtils && typeof CoreUtils.isPlainObject === 'function') {
            return CoreUtils.isPlainObject(value);
        }
        // Emergency fallback (should never be reached)
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    /**
     * Check if a value is a safe integer.
     * @deprecated Use CoreUtils.isSafeInteger() instead.
     */
    function isSafeInteger(value) {
        if (CoreUtils && typeof CoreUtils.isSafeInteger === 'function') {
            return CoreUtils.isSafeInteger(value);
        }
        return Number.isSafeInteger(value);
    }

    /**
     * Check if a value is a positive integer (>= 1).
     * @deprecated Use CoreUtils.isPositiveInteger() instead.
     */
    function isPositiveInteger(value) {
        if (CoreUtils && typeof CoreUtils.isPositiveInteger === 'function') {
            return CoreUtils.isPositiveInteger(value);
        }
        return Number.isSafeInteger(value) && value >= 1;
    }

    /**
     * Parse an optional integer value.
     * @deprecated Use CoreUtils.parseOptionalInteger() instead.
     */
    function parseOptionalInteger(value) {
        if (CoreUtils && typeof CoreUtils.parseOptionalInteger === 'function') {
            return CoreUtils.parseOptionalInteger(value);
        }
        // Emergency fallback (should never be reached)
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
     * @deprecated Use CoreUtils.parsePositiveInteger() instead.
     */
    function parsePositiveInteger(value, fallback) {
        if (CoreUtils && typeof CoreUtils.parsePositiveInteger === 'function') {
            return CoreUtils.parsePositiveInteger(value, fallback);
        }
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    /**
     * Parse a strict positive integer.
     * @deprecated Use CoreUtils.parseStrictPositiveInteger() instead.
     */
    function parseStrictPositiveInteger(value) {
        if (CoreUtils && typeof CoreUtils.parseStrictPositiveInteger === 'function') {
            return CoreUtils.parseStrictPositiveInteger(value);
        }
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    /**
     * Check if a value has content (non-empty after trimming).
     * @deprecated Use CoreUtils.hasValue() instead.
     */
    function hasValue(value) {
        if (CoreUtils && typeof CoreUtils.hasValue === 'function') {
            return CoreUtils.hasValue(value);
        }
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    /**
     * Get detailed integer information.
     * @deprecated Use CoreUtils.getIntegerInfo() instead.
     */
    function getIntegerInfo(value) {
        if (CoreUtils && typeof CoreUtils.getIntegerInfo === 'function') {
            return CoreUtils.getIntegerInfo(value);
        }
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

        // Integer parsing
        parseOptionalInteger: parseOptionalInteger,
        parsePositiveInteger: parsePositiveInteger,
        parseStrictPositiveInteger: parseStrictPositiveInteger,
        hasValue: hasValue,
        getIntegerInfo: getIntegerInfo,

        // Deprecated period aliases
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo
    };

})();