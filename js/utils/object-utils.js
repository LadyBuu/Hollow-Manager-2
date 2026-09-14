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
 * READ SAFETY CONTRACT:
 *   - deepClone ALWAYS returns a value that is not === to the input,
 *     for object inputs. There is no fallback that returns the
 *     original reference. If every clone strategy fails, deepClone
 *     throws. This is a hard contract, not a hint.
 *   - If a future edit ever introduces a fallback that returns the
 *     original, the explicit identity check below fires and throws.
 *     This makes the contract self-enforcing.
 *   - Primitives (null, undefined, number, string, boolean, symbol,
 *     bigint) are returned as-is. This is safe because primitives are
 *     copied by value; there is no aliasing.
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
     *   - Does NOT return the original reference on failure. Aliasing
     *     is treated as a cloning failure, not a graceful degradation.
     * 
     * LIMITATIONS:
     *   - JSON fallback loses: undefined, Date, Map, Set, TypedArrays, etc.
     *   - JSON fallback only works with JSON-serializable data
     *   - For application data, ensure your data is JSON-serializable
     * 
     * @param {*} value - Value to clone
     * @returns {*} Cloned value
     * @throws {Error} If cloning fails or if aliasing is detected
     * 
     * USAGE:
     *   try {
     *       var cloned = ObjectUtils.deepClone(data);
     *   } catch (e) {
     *       // Handle clone failure
     *   }
     */
    function deepClone(value) {
        // Primitives: return as-is. Safe because primitives are
        // copied by value; there is no aliasing.
        if (value === null || typeof value !== 'object') {
            return value;
        }

        // Try structuredClone first (modern browsers)
        if (typeof structuredClone === 'function') {
            try {
                var structured = structuredClone(value);
                // structuredClone never returns the input reference,
                // but check anyway to keep the contract self-enforcing.
                if (structured !== value) {
                    return structured;
                }
                // If we somehow got the same reference, fall through.
            } catch (e) {
                // Fall through to JSON fallback
            }
        }

        // Fallback to JSON
        var json;
        try {
            json = JSON.parse(JSON.stringify(value));
        } catch (e) {
            throw new Error(
                'ObjectUtils.deepClone: Failed to clone value. ' +
                'Ensure the value is JSON-serializable. ' +
                'Original error: ' + e.message
            );
        }

        // The JSON round-trip always constructs a new value for object
        // inputs. If it somehow produced the same reference (which is
        // impossible for a genuine JSON.parse result), treat it as a
        // cloning failure rather than silently returning an alias.
        if (json === value) {
            throw new Error(
                'ObjectUtils.deepClone: Clone produced the original reference. ' +
                'This is a bug — deepClone must never return the input for object inputs.'
            );
        }

        return json;
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
