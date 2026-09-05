/**
 * utils/object-utils.js - Object Utilities
 * Generic object manipulation functions
 * 
 * Path: js/utils/object-utils.js
 * 
 * This module provides:
 *   - deepClone - Deep cloning with structuredClone + JSON fallback
 * 
 * IMPORTANT:
 *   - These functions are PURE - no side effects
 *   - No knowledge of HollowBlades domain concepts
 *   - No dependencies on other modules (self-contained)
 *   - Throws on failure (does not return null)
 *   - This is the SINGLE SOURCE OF TRUTH for generic cloning
 *   - Database and MutationPipeline use this module
 * 
 * DEPENDENCIES:
 *   - None
 * 
 * USAGE:
 *   var cloned = ObjectUtils.deepClone(original);
 *   // Throws if cloning fails
 */

(function() {
    'use strict';

    if (window.__objectUtilsLoaded) return;
    window.__objectUtilsLoaded = true;

    // ============================================================
    // DEEP CLONE
    // ============================================================

    /**
     * Deep clone a value.
     * 
     * SEMANTICS:
     *   - Uses structuredClone if available (modern browsers)
     *   - Falls back to JSON.parse(JSON.stringify()) for compatibility
     *   - Throws an error if cloning fails
     *   - Does NOT return null on failure (distinguishes from cloned null)
     * 
     * LIMITATIONS:
     *   - JSON fallback loses: undefined, Date, Map, Set, TypedArrays, etc.
     *   - JSON fallback only works with JSON-serializable data
     *   - For application data, ensure your data is JSON-serializable
     * 
     * @param {*} value - Value to clone
     * @returns {*} Cloned value
     * @throws {Error} If cloning fails
     * 
     * USAGE:
     *   try {
     *       var cloned = ObjectUtils.deepClone(data);
     *   } catch (e) {
     *       // Handle clone failure
     *   }
     */
    function deepClone(value) {
        // Primitives: return as-is
        if (value === null || typeof value !== 'object') {
            return value;
        }

        // Try structuredClone first (modern browsers)
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                // Fall through to JSON fallback
            }
        }

        // Fallback to JSON
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            throw new Error(
                'ObjectUtils.deepClone: Failed to clone value. ' +
                'Ensure the value is JSON-serializable. ' +
                'Original error: ' + e.message
            );
        }
    }

    /**
     * Check if a value is a plain object.
     * Useful for determining if a value can be deeply cloned via JSON.
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
     * Check if a value is cloneable via JSON.
     * Some values (Date, Map, Set, etc.) are not JSON-serializable.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if value is JSON-serializable
     */
    function isJsonSerializable(value) {
        if (value === null || typeof value !== 'object') {
            return true;
        }

        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                if (!isJsonSerializable(value[i])) {
                    return false;
                }
            }
            return true;
        }

        if (isPlainObject(value)) {
            for (var key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    if (!isJsonSerializable(value[key])) {
                        return false;
                    }
                }
            }
            return true;
        }

        // Non-plain objects (Date, Map, Set, custom classes) are not JSON-serializable
        return false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ObjectUtils = {
        deepClone: deepClone,
        isPlainObject: isPlainObject,
        isJsonSerializable: isJsonSerializable
    };

})();