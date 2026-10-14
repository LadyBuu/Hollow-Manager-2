/**
 * utils/validation-utils.js - Validation Utilities
 * Generic validation and type checking functions
 *
 * Path: js/utils/validation-utils.js
 *
 * This module provides:
 *   - Type checking (isPlainObject, isSafeInteger, isPositiveInteger,
 *     isFiniteNumber, isString, isNonEmptyString, hasValue)
 *   - Integer parsing (parseOptionalInteger, parsePositiveInteger,
 *     parseStrictPositiveInteger, parseNonNegativeInteger)
 *   - String helpers (capitalize, truncateString, stringLength,
 *     isEmptyOrWhitespace)
 *   - Object helpers (hasKey, getKeys, isEmptyObject)
 *   - Number helpers (clamp, parseNumber)
 *
 * IMPORTANT:
 *   - These functions are PURE - no side effects
 *   - No knowledge of HollowBlades domain concepts
 *   - SELF-CONTAINED - no external dependencies
 *   - This is the SINGLE SOURCE OF TRUTH for validation utilities
 *
 * INTEGER PARSING RULES:
 *   All parse*Integer functions accept only strings matching
 *   /^\d+$/ or numbers that are already safe integers. They reject:
 *     - signed values ('-5', '+5')
 *     - decimals ('5.0')
 *     - exponential ('1e3')
 *     - hex ('0x10')
 *     - whitespace-only strings
 *     - Infinity, NaN
 *
 *   This is deliberately strict. Four integer parsers already exist
 *   in the codebase (here, FormUtils, FormatUtils, CalendarValidation)
 *   with different rules; this is the one callers should use when they
 *   want "definitely an integer, no surprises".
 *
 * EMPTY-OBJECT SEMANTICS:
 *   isEmptyObject is narrow: it returns true only for plain objects
 *   with no own enumerable keys. It returns FALSE for null,
 *   undefined, strings, arrays, and class instances. This matches
 *   "the object is empty" rather than "the value is falsy".
 *
 *   If you want "this value has no content" across strings, arrays
 *   and objects, use hasValue() and negate it.
 *
 * TRUNCATE STRING SEMANTICS:
 *   truncateString(value, length, suffix) guarantees the result is
 *   at most `length` characters. The suffix counts against the
 *   budget. If length is smaller than the suffix, the suffix itself
 *   is truncated.
 *
 * DEPRECATED ALIASES:
 *   The *Period aliases and isObject exist for backward
 *   compatibility with callers that predate the rename to *Integer.
 *   Removal target: once all callers migrate. New code should use
 *   the canonical names.
 *
 * DEPENDENCIES:
 *   - None (self-contained)
 *
 * USAGE:
 *   ValidationUtils.isSafeInteger(42);           // true
 *   ValidationUtils.parseOptionalInteger('42');  // 42
 *   ValidationUtils.parseOptionalInteger('4.2'); // null
 *   ValidationUtils.isNonEmptyString('hello');   // true
 */

(function() {
    'use strict';

    if (window.__validationUtilsLoaded) {
        return;
    }
    window.__validationUtilsLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    /**
     * Check if a value is a plain object (not null, not array).
     *
     * "Plain" means the prototype is Object.prototype or null.
     * Cross-realm objects (from an iframe) and class instances are
     * NOT plain. This is intentional: the callers that use this
     * check want to know "can I treat this like a data bag".
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
     * "Safe" means Number.isSafeInteger: within
     * Number.MIN_SAFE_INTEGER .. Number.MAX_SAFE_INTEGER, no
     * fractional part. 1e21 is NOT safe.
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
     * @returns {boolean} True if value is a safe integer >= 1
     */
    function isPositiveInteger(value) {
        return Number.isSafeInteger(value) && value >= 1;
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
     * Check if a value is a non-negative finite number (>= 0).
     *
     * @param {*} value - Value to check
     * @returns {boolean} True if value is finite and >= 0
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
     *
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-empty string
     *
     * USAGE:
     *   if (ValidationUtils.isNonEmptyString(input)) { ... }
     */
    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Check if a value has content.
     *
     * SEMANTICS:
     *   - null / undefined   -> false
     *   - string             -> false if empty/whitespace-only
     *   - array              -> false if length === 0
     *   - plain object       -> false if no own enumerable keys
     *   - number 0           -> true
     *   - boolean false      -> true
     *   - Map / Set / Date   -> TRUE (non-plain objects are treated
     *                           as having content). Do not use this
     *                           to check an empty Map; check .size.
     *
     * The Map/Set carve-out is deliberate. Narrowing it would break
     * FormUtils and any caller that passes a class instance it
     * genuinely does want treated as present.
     *
     * @param {*} value - Value to check
     * @returns {boolean} True if value has content
     */
    function hasValue(value) {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === 'string') {
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
     *
     * Accepts:
     *   - numbers that are safe integers (5 -> 5)
     *   - strings matching /^\d+$/ ('5' -> 5, '007' -> 7)
     *
     * Rejects (returns null):
     *   - undefined, null, ''
     *   - whitespace-only strings
     *   - signed values ('-5', '+5')
     *   - decimals ('5.0')
     *   - exponential ('1e3')
     *   - hex ('0x10')
     *   - non-safe integers (1e21, 5.5)
     *   - Infinity, NaN
     *
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseOptionalInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value === 'number') {
            if (Number.isSafeInteger(value)) {
                return value;
            }
            return null;
        }

        if (typeof value !== 'string') {
            return null;
        }

        var str = value.trim();
        if (str === '' || !/^\d+$/.test(str)) {
            return null;
        }

        var parsed = Number(str);
        if (!Number.isSafeInteger(parsed)) {
            return null;
        }

        return parsed;
    }

    /**
     * Parse a positive integer with a fallback.
     *
     * @param {*} value - Value to parse
     * @param {number} fallback - Fallback if parsing fails or < 1
     * @returns {number} Parsed integer or fallback
     */
    function parsePositiveInteger(value, fallback) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    /**
     * Parse a strict positive integer.
     *
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer >= 1, or null
     */
    function parseStrictPositiveInteger(value) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    /**
     * Parse a non-negative integer (>= 0).
     *
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer >= 0, or null
     */
    function parseNonNegativeInteger(value) {
        var parsed = parseOptionalInteger(value);
        return (parsed !== null && parsed >= 0) ? parsed : null;
    }

    /**
     * Get detailed integer information.
     *
     * Returns a three-state descriptor:
     *   { present: false, valid: true,  value: null }  // absent
     *   { present: true,  valid: true,  value: n    }  // valid
     *   { present: true,  valid: false, value: null }  // present, invalid
     *
     * "Present" means hasValue(value) is true. Note that hasValue
     * treats 0 and false as present; both are reported as
     * { present: true, valid: false } because neither is a safe
     * integer... actually false is not a number, and 0 is a
     * valid non-negative integer but not "positive". The `value`
     * field is null unless the input parses to a safe integer
     * (which 0 does). Callers that want "present and non-zero"
     * should check value !== 0 themselves.
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
     * Check if an array has elements.
     *
     * @param {*} arr - Value to check
     * @returns {boolean} True if array has at least one element
     */
    function isNonEmptyArray(arr) {
        return Array.isArray(arr) && arr.length > 0;
    }

    // ============================================================
    // STRING HELPERS
    // ============================================================

    /**
     * Capitalize the first letter of a string.
     *
     * Leading whitespace is trimmed before capitalizing, so
     * capitalize(' hi') returns 'Hi' rather than ' hi'.
     * Trailing whitespace is preserved.
     *
     * Returns '' for non-strings and for whitespace-only strings.
     *
     * @param {*} value - Value to capitalize
     * @returns {string} Capitalized string, or ''
     */
    function capitalize(value) {
        if (!isNonEmptyString(value)) {
            return '';
        }
        var str = value.trimStart ? value.trimStart() : value.replace(/^\s+/, '');
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Truncate a string to a maximum total length, including the
     * suffix.
     *
     * SEMANTICS:
     *   - The result is at most `length` characters.
     *   - If length is smaller than the suffix, the suffix is
     *     truncated to fit, and the result is the truncated suffix.
     *   - If the input is shorter than length, the suffix is not
     *     added.
     *
     * EXAMPLES:
     *   truncateString('hello world', 8)  -> 'hello...'   (8 chars)
     *   truncateString('hello world', 20) -> 'hello world'
     *   truncateString('hello world', 2)  -> '..'         (2 chars)
     *   truncateString('hello', 1)        -> '.'          (1 char)
     *
     * @param {*} value - String to truncate
     * @param {number} length - Maximum total length
     * @param {string} [suffix='...'] - Suffix to add
     * @returns {string} Truncated string, or '' if input is invalid
     */
    function truncateString(value, length, suffix) {
        if (!isNonEmptyString(value)) {
            return '';
        }

        suffix = suffix === undefined ? '...' : String(suffix);

        if (!isSafeInteger(length) || length < 0) {
            return String(value);
        }

        var str = String(value);
        if (str.length <= length) {
            return str;
        }

        if (length <= suffix.length) {
            return suffix.substring(0, length);
        }

        return str.substring(0, length - suffix.length) + suffix;
    }

    /**
     * Get the string length (safe for null/undefined).
     *
     * @param {*} value - Value to check
     * @returns {number} String length, or 0 for null/undefined
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
     * @returns {boolean} True if null, undefined, empty, or whitespace
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
     * Check if an object has a specific own key.
     *
     * Returns false for non-plain objects. Logs a warning when a
     * non-plain non-null value is passed, because silently returning
     * false for a class instance hides real bugs.
     *
     * @param {object} obj - Object to check
     * @param {string} key - Key to look for
     * @returns {boolean} True if obj has the key as an own property
     */
    function hasKey(obj, key) {
        if (!isPlainObject(obj)) {
            if (obj !== null && obj !== undefined && typeof obj === 'object') {
                console.warn(
                    '[ValidationUtils.hasKey] non-plain object passed:',
                    obj
                );
            }
            return false;
        }
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    /**
     * Get an object's own enumerable keys.
     *
     * Returns [] for non-plain objects. Logs a warning when a
     * non-plain non-null value is passed.
     *
     * @param {object} obj - Object to get keys from
     * @returns {string[]} Array of keys, or [] if not a plain object
     */
    function getKeys(obj) {
        if (!isPlainObject(obj)) {
            if (obj !== null && obj !== undefined && typeof obj === 'object') {
                console.warn(
                    '[ValidationUtils.getKeys] non-plain object passed:',
                    obj
                );
            }
            return [];
        }
        return Object.keys(obj);
    }

    /**
     * Check if a plain object has no own enumerable keys.
     *
     * Returns false for non-plain values, including null, undefined,
     * strings, arrays, and class instances. This is intentionally
     * narrow: it answers "is this an empty object", not "is this
     * value empty in some general sense". For the latter, use
     * !hasValue(x).
     *
     * @param {object} obj - Object to check
     * @returns {boolean} True if obj is a plain object with no keys
     */
    function isEmptyObject(obj) {
        if (!isPlainObject(obj)) {
            return false;
        }
        return Object.keys(obj).length === 0;
    }

    // ============================================================
    // NUMBER HELPERS
    // ============================================================

    /**
     * Clamp a number between a minimum and maximum value.
     *
     * SEMANTICS:
     *   - Non-finite or NaN input returns NaN (or fallback if
     *     provided). The previous behaviour of returning `min`
     *     silently substituted a plausible value for bad input,
     *     which hid bugs.
     *   - If min > max, returns NaN (or fallback).
     *
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} [max] - Maximum value
     * @param {number} [fallback] - Value to return for invalid input
     * @returns {number} Clamped value, NaN, or fallback
     */
    function clamp(value, min, max, fallback) {
        var hasFallback = arguments.length >= 4;

        if (!isFiniteNumber(value) ||
            !isFiniteNumber(min) ||
            !isFiniteNumber(max) ||
            min > max) {
            return hasFallback ? fallback : NaN;
        }

        return Math.max(min, Math.min(max, value));
    }

    /**
     * Parse a number with a fallback.
     *
     * Rejects '' , whitespace-only strings, null, undefined, and
     * non-finite numbers. The previous behaviour returned 0 for
     * empty strings (Number('') === 0), which silently turned
     * empty form fields into a valid zero.
     *
     * @param {*} value - Value to parse
     * @param {number} fallback - Fallback value
     * @returns {number} Parsed number or fallback
     */
    function parseNumber(value, fallback) {
        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') {
                return fallback;
            }
            var num = Number(trimmed);
            return Number.isFinite(num) ? num : fallback;
        }

        var direct = Number(value);
        return Number.isFinite(direct) ? direct : fallback;
    }

    // ============================================================
    // DEPRECATED ALIASES
    // ============================================================
    // Kept for callers that predate the rename to *Integer. Each
    // delegates to its canonical replacement, so there is exactly
    // one place each behaviour lives. Removal target: once all
    // callers migrate.

    /**
     * @deprecated since the *Integer rename. Use parseOptionalInteger.
     */
    function parseOptionalPeriod(value) {
        return parseOptionalInteger(value);
    }

    /**
     * @deprecated since the *Integer rename. Use parsePositiveInteger.
     */
    function parsePositivePeriod(value, fallback) {
        return parsePositiveInteger(value, fallback);
    }

    /**
     * @deprecated since the *Integer rename. Use parseStrictPositiveInteger.
     */
    function parseStrictPositivePeriod(value) {
        return parseStrictPositiveInteger(value);
    }

    /**
     * @deprecated since the *Integer rename. Use hasValue.
     */
    function hasPeriodValue(value) {
        return hasValue(value);
    }

    /**
     * @deprecated since the *Integer rename. Use getIntegerInfo.
     */
    function getPeriodInfo(value) {
        return getIntegerInfo(value);
    }

    /**
     * @deprecated Use isPlainObject.
     */
    function isObject(value) {
        return isPlainObject(value);
    }

    /**
     * @deprecated Use isFiniteNumber. This alias exists only for
     * callers that predate the canonical name; it is identical.
     */
    function isValidNumber(value) {
        return isFiniteNumber(value);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ValidationUtils = Object.freeze({
        // ---- Type checking ----
        isPlainObject: isPlainObject,
        isObject: isObject,                 // deprecated alias
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isFiniteNumber: isFiniteNumber,
        isValidNumber: isValidNumber,       // deprecated alias
        isNonNegativeNumber: isNonNegativeNumber,
        isString: isString,
        isNonEmptyString: isNonEmptyString,
        hasValue: hasValue,

        // ---- Integer parsing ----
        parseOptionalInteger: parseOptionalInteger,
        parsePositiveInteger: parsePositiveInteger,
        parseStrictPositiveInteger: parseStrictPositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        getIntegerInfo: getIntegerInfo,

        // ---- Array helpers ----
        isArray: Array.isArray,             // direct alias
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
        parseNumber: parseNumber,

        // ---- Deprecated period aliases ----
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo
    });

})();
