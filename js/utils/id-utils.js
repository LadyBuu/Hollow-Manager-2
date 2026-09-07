/**
 * utils/id-utils.js - ID Generation and Normalisation Utilities
 * 
 * Path: js/utils/id-utils.js
 * 
 * This module provides:
 *   - generateId - Unique ID generation with prefix
 *   - normaliseId - Normalise IDs for consistent comparison
 *   - isValidId - Check if an ID is valid
 *   - isSameId - Check if two IDs are the same (normalised)
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects
 *   - No domain knowledge
 *   - SINGLE SOURCE OF TRUTH for all ID operations
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
    // ID NORMALISATION
    // ============================================================

    /**
     * Normalise an ID for consistent comparison.
     * 
     * Rules:
     *   - Null/undefined/empty returns empty string
     *   - Objects are rejected (returns empty string)
     *   - Numbers are converted to strings
     *   - Strings are trimmed
     *   - Does NOT lowercase - IDs may be case-sensitive
     * 
     * @param {*} value - Value to normalise
     * @returns {string} Normalised ID (empty string for invalid)
     */
    function normaliseId(value) {
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'object') {
            // Reject objects - they can't be valid IDs
            return '';
        }

        var str = String(value).trim();

        // Reject empty strings
        if (str === '') {
            return '';
        }

        return str;
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
     * @param {*} id1 - First ID
     * @param {*} id2 - Second ID
     * @returns {boolean} True if IDs are the same
     */
    function isSameId(id1, id2) {
        return normaliseId(id1) === normaliseId(id2);
    }

    /**
     * Check if a value is a valid ID and matches a specific pattern.
     * 
     * @param {*} value - Value to check
     * @param {string} prefix - Expected prefix (e.g., 'char_', 'team_')
     * @returns {boolean} True if value is a valid ID with the given prefix
     */
    function isValidIdWithPrefix(value, prefix) {
        var normalised = normaliseId(value);
        if (normalised === '') {
            return false;
        }
        if (prefix) {
            return normalised.startsWith(prefix);
        }
        return true;
    }

    /**
     * Extract a clean ID from a prefixed string.
     * 
     * @param {string} value - Prefixed ID (e.g., 'char_abc123')
     * @param {string} prefix - Prefix to strip (e.g., 'char_')
     * @returns {string} Clean ID without prefix
     */
    function stripPrefix(value, prefix) {
        var normalised = normaliseId(value);
        if (normalised === '') {
            return '';
        }
        if (prefix && normalised.startsWith(prefix)) {
            return normalised.substring(prefix.length);
        }
        return normalised;
    }

    /**
     * Add a prefix to an ID if not already present.
     * 
     * @param {string} id - ID to prefix
     * @param {string} prefix - Prefix to add
     * @returns {string} Prefixed ID
     */
    function addPrefix(id, prefix) {
        var normalised = normaliseId(id);
        if (normalised === '') {
            return '';
        }
        if (prefix && !normalised.startsWith(prefix)) {
            return prefix + normalised;
        }
        return normalised;
    }

    // ============================================================
    // ARRAY HELPERS
    // ============================================================

    /**
     * Normalise an array of IDs.
     * 
     * @param {Array} ids - Array of IDs
     * @returns {Array} Array of normalised IDs (filtered)
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
     * @returns {boolean} True if array contains the ID
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
     * Filter an array to only include valid IDs.
     * 
     * @param {Array} ids - Array of IDs
     * @returns {Array} Array of valid IDs (normalised)
     */
    function filterValidIds(ids) {
        return normaliseIdArray(ids);
    }

    /**
     * Deduplicate an array of IDs.
     * 
     * @param {Array} ids - Array of IDs
     * @returns {Array} Array of unique IDs (normalised)
     */
    function uniqueIds(ids) {
        var normalised = normaliseIdArray(ids);
        var seen = {};
        var result = [];
        for (var i = 0; i < normalised.length; i++) {
            var id = normalised[i];
            if (!seen[id]) {
                seen[id] = true;
                result.push(id);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.IdUtils = {
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
    };

})();
