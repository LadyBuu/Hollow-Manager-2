/**
 * utils/validation-utils.js - Validation Utilities
 * Generic validation and type checking functions
 * 
 * Path: js/utils/validation-utils.js
 * 
 * This module provides:
 *   - Type checking (isObject, isSafeInteger, isPositiveInteger)
 *   - Period/Week parsing (parseOptionalPeriod, parsePositivePeriod, etc.)
 * 
 * IMPORTANT:
 *   - These functions are PURE - no side effects
 *   - No knowledge of HollowBlades domain concepts
 *   - "Period" here means generic positive integer time representation
 *   - Domain interpretation (weeks, years) belongs in domain modules
 */

(function() {
    'use strict';

    if (window.__validationUtilsLoaded) return;
    window.__validationUtilsLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function isPositiveInteger(value) {
        return isSafeInteger(value) && value >= 1;
    }

    // ============================================================
    // PERIOD PARSING - Generic integer-string parsing
    // ============================================================

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

    function parsePositivePeriod(value, fallback) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    function parseStrictPositivePeriod(value) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

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
    // EXPOSE
    // ============================================================

    window.ValidationUtils = {
        isObject: isObject,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo
    };

})();
