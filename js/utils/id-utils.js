/**
 * utils/id-utils.js - ID Generation and Normalisation Utilities
 *
 * Path: js/utils/id-utils.js
 *
 * This module provides:
 *   - generateId         - Unique ID generation with prefix
 *   - normaliseId        - Normalise IDs for consistent comparison
 *   - isValidId          - Check if an ID is valid
 *   - isSameId           - Check if two IDs are the same (normalised)
 *   - stripPrefix / addPrefix
 *   - Array helpers (normaliseIdArray, arrayContainsId,
 *     filterValidIds, uniqueIds)
 *
 * IMPORTANT:
 *   - No domain knowledge
 *   - SINGLE SOURCE OF TRUTH for all ID operations
 *
 * PURITY:
 *   - All functions are pure EXCEPT generateId(), which reads the
 *     clock and the RNG.
 *
 * VALIDITY:
 *   An ID is valid if and only if normaliseId() returns a non-empty
 *   string. Invalid inputs include:
 *     - null, undefined
 *     - objects (including arrays)
 *     - NaN, Infinity, -Infinity
 *     - booleans
 *     - empty or whitespace-only strings
 *
 *   Valid inputs are:
 *     - non-empty strings (trimmed)
 *     - finite numbers (stringified; useful for legacy numeric IDs)
 *
 *   Symbols are rejected, even though String(symbol) works, because
 *   a symbol is not a data value that should ever be an ID.
 *
 * EQUALITY:
 *   isSameId(a, b) is true only when both a and b are valid AND
 *   normalise to the same string. Two invalid IDs are NOT the same
 *   ID. This prevents undefined === undefined from producing a
 *   phantom match on orphaned records.
 *
 * USAGE:
 *   var id = IdUtils.generateId('char');
 *   if (IdUtils.isSameId(a, b)) { ... }
 */

(function() {
    'use strict';

    if (window.__idUtilsLoaded) return;
    window.__idUtilsLoaded = true;

    // ============================================================
    // ID GENERATION
    // ============================================================

    /**
     * Generate a unique ID with an optional prefix.
     *
     * Prefers crypto.randomUUID (secure context: HTTPS or
     * localhost). Falls back to a timestamp plus a wide random
     * suffix. The fallback uses crypto.getRandomValues when
     * available, which is not secure-context-only.
     *
     * @param {string} [prefix='id'] - ID prefix
     * @returns {string} Unique ID of the form prefix_<suffix>
     *
     * @throws {Error} If prefix is a non-string that can't be
     *   coerced to a useful prefix.
     */
    function generateId(prefix) {
        if (prefix === undefined || prefix === null) {
            prefix = 'id';
        }
        if (typeof prefix !== 'string') {
            prefix = String(prefix);
        }
        if (prefix === '') {
            prefix = 'id';
        }

        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }

        return prefix + '_' + randomSuffix();
    }

    /**
     * Fallback random suffix. Uses crypto.getRandomValues when
     * available; otherwise Math.random. Twelve base36 characters
     * gives ~2^62 of entropy, which is enough to make collisions
     * negligible even for a long-running session.
     */
    function randomSuffix() {
        var bytes = null;

        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            try {
                bytes = new Uint8Array(8);
                window.crypto.getRandomValues(bytes);
            } catch (e) {
                bytes = null;
            }
        }

        if (bytes) {
            var hex = '';
            for (var i = 0; i < bytes.length; i++) {
                hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
            }
            // Combine the hex bytes with a short timestamp so
            // ordering is roughly monotonic across calls.
            return Date.now().toString(36) + '_' + hex;
        }

        return Date.now().toString(36) + '_' +
               Math.random().toString(36).slice(2, 14);
    }

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    /**
     * Normalise an ID for consistent comparison.
     *
     * Rules:
     *   - null / undefined / empty / whitespace-only -> ''
     *   - object (including array) -> ''
     *   - NaN / Infinity / -Infinity -> ''
     *   - boolean -> ''
     *   - symbol -> ''
     *   - finite number -> String(number).trim()
     *   - non-empty string -> trimmed string
     *
     * Case is preserved. IDs are not lowercased.
     *
     * @param {*} value - Value to normalise
     * @returns {string} Normalised ID, or '' for invalid input
     */
    function normaliseId(value) {
        if (value === null || value === undefined) {
            return '';
        }

        var type = typeof value;

        if (type === 'object' || type === 'boolean' || type === 'symbol' ||
            type === 'function') {
            return '';
        }

        if (type === 'number') {
            if (!Number.isFinite(value)) {
                return '';
            }
            return String(value);
        }

        if (type !== 'string') {
            return '';
        }

        var trimmed = value.trim();
        if (trimmed === '') {
            return '';
        }

        return trimmed;
    }

    /**
     * Check if a value is a valid ID.
     *
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a valid ID
     */
    function isValidId(value) {
        return normaliseId(value) !== '';
    }

    /**
     * Check if two IDs are the same (normalised comparison).
     *
     * Returns true only when BOTH sides are valid IDs and they
     * normalise to the same string. Two invalid IDs are NOT the
     * same ID.
     *
     * @param {*} id1 - First ID
     * @param {*} id2 - Second ID
     * @returns {boolean} True if IDs are both valid and equal
     */
    function isSameId(id1, id2) {
        var a = normaliseId(id1);
        if (a === '') {
            return false;
        }
        var b = normaliseId(id2);
        if (b === '') {
            return false;
        }
        return a === b;
    }

    /**
     * Check if a value is a valid ID and matches a specific prefix.
     *
     * @param {*} value - Value to check
     * @param {string} prefix - Expected prefix (e.g. 'char_')
     * @returns {boolean} True if value is valid and starts with prefix
     */
    function isValidIdWithPrefix(value, prefix) {
        var normalised = normaliseId(value);
        if (normalised === '') {
            return false;
        }
        if (typeof prefix === 'string' && prefix !== '') {
            return normalised.indexOf(prefix) === 0;
        }
        return true;
    }

    /**
     * Extract a clean ID from a prefixed string.
     *
     * @param {*} value - Prefixed ID (e.g. 'char_abc123')
     * @param {string} prefix - Prefix to strip (e.g. 'char_')
     * @returns {string} Clean ID without prefix, or '' if invalid
     */
    function stripPrefix(value, prefix) {
        var normalised = normaliseId(value);
        if (normalised === '') {
            return '';
        }
        if (typeof prefix === 'string' && prefix !== '' &&
            normalised.indexOf(prefix) === 0) {
            return normalised.substring(prefix.length);
        }
        return normalised;
    }

    /**
     * Add a prefix to an ID if not already present.
     *
     * NOTE: This does not rename across prefixes. addPrefix('team_x',
     * 'char_') yields 'char_team_x', which is probably not what the
     * caller wanted. If you need to change a prefix, strip first.
     *
     * @param {*} id - ID to prefix
     * @param {string} prefix - Prefix to add
     * @returns {string} Prefixed ID, or '' if id is invalid
     */
    function addPrefix(id, prefix) {
        var normalised = normaliseId(id);
        if (normalised === '') {
            return '';
        }
        if (typeof prefix !== 'string' || prefix === '') {
            return normalised;
        }
        if (normalised.indexOf(prefix) === 0) {
            return normalised;
        }
        return prefix + normalised;
    }

    // ============================================================
    // ARRAY HELPERS
    // ============================================================

    /**
     * Normalise an array of IDs. Filters out invalid entries.
     *
     * @param {Array} ids - Array of IDs
     * @returns {Array<string>} Array of normalised IDs
     */
    function normaliseIdArray(ids) {
        if (!Array.isArray(ids)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised !== '') {
                result.push(normalised);
            }
        }
        return result;
    }

    /**
     * Check if an array contains an ID (normalised comparison).
     *
     * @param {Array} ids - Array of IDs
     * @param {*} id - ID to look for
     * @returns {boolean} True if array contains a matching valid ID
     */
    function arrayContainsId(ids, id) {
        if (!Array.isArray(ids)) {
            return false;
        }
        var target = normaliseId(id);
        if (target === '') {
            return false;
        }
        for (var i = 0; i < ids.length; i++) {
            if (normaliseId(ids[i]) === target) {
                return true;
            }
        }
        return false;
    }

    /**
     * @deprecated Alias of normaliseIdArray. Kept for callers that
     * predate the rename. New code should use normaliseIdArray.
     */
    function filterValidIds(ids) {
        return normaliseIdArray(ids);
    }

    /**
     * Deduplicate an array of IDs.
     *
     * Uses a null-prototype map for the seen set, so IDs whose
     * string form collides with Object.prototype keys
     * ('constructor', 'toString', '__proto__', etc.) are handled
     * correctly.
     *
     * @param {Array} ids - Array of IDs
     * @returns {Array<string>} Array of unique valid IDs, in order
     */
    function uniqueIds(ids) {
        var normalised = normaliseIdArray(ids);
        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < normalised.length; i++) {
            var id = normalised[i];
            if (seen[id] !== true) {
                seen[id] = true;
                result.push(id);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.IdUtils = Object.freeze({
        // ID generation
        generateId: generateId,

        // ID normalisation
        normaliseId: normaliseId,
        isValidId: isValidId,
        isSameId: isSameId,
        isValidIdWithPrefix: isValidIdWithPrefix,
        stripPrefix: stripPrefix,
        addPrefix: addPrefix,

        // Array helpers
        normaliseIdArray: normaliseIdArray,
        arrayContainsId: arrayContainsId,
        filterValidIds: filterValidIds,
        uniqueIds: uniqueIds
    });

})();
