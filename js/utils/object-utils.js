/**
 * utils/object-utils.js - Object Utilities
 * Generic object manipulation functions
 *
 * Path: js/utils/object-utils.js
 *
 * This module provides:
 *   - deepClone       - Deep clone via structuredClone
 *   - isPlainObject   - Check whether a value is a plain data object
 *
 * IMPORTANT:
 *   - deepClone is PURE and throws on failure. It never returns
 *     the input reference and never returns a lossy approximation.
 *   - No knowledge of HollowBlades domain concepts.
 *   - No dependencies on other modules.
 *   - This is the SINGLE SOURCE OF TRUTH for deep cloning.
 *     database.js and mutation-pipeline.js MUST call it rather
 *     than reimplement it.
 *
 * THE READ SAFETY CONTRACT:
 *   deepClone(value) returns a new value that shares no mutable
 *   structure with `value`, for any value structuredClone can
 *   handle. If structuredClone is unavailable or throws, deepClone
 *   throws. There is no JSON fallback.
 *
 *   WHY NO FALLBACK:
 *     MutationPipeline calls deepClone to snapshot live state
 *     before a mutation. If the save then fails, it restores from
 *     that snapshot. A JSON fallback would "succeed" by silently
 *     dropping functions and undefined fields, turning NaN and
 *     Infinity into null, Dates into strings, and Map/Set into {}.
 *     The pipeline would then restore a corrupted copy over live
 *     data. A snapshot you cannot trust is worse than no snapshot.
 *
 *     The same failure mode applies to database.js, which uses
 *     structuredClone directly for its persistence copy. Making
 *     deepClone match that behaviour means a value that cannot be
 *     safely snapshotted fails loudly at the point of cloning,
 *     not silently at the point of rollback.
 *
 * DEPENDENCIES:
 *   - structuredClone (browser API)
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
     *   - Primitives (null, undefined, number, string, boolean,
     *     symbol, bigint) are returned as-is. Primitives are
     *     copied by value; there is no aliasing concern.
     *   - Objects and arrays are cloned via structuredClone.
     *   - If structuredClone is unavailable, throws.
     *   - If structuredClone throws (functions, DOM nodes, proxies,
     *     some host objects), the error propagates unchanged.
     *   - Never returns the input reference for object inputs.
     *
     * LIMITATIONS (inherent to structuredClone):
     *   - Functions cannot be cloned and cause a throw.
     *   - DOM nodes, Window, and some host objects cause a throw.
     *   - Proxies cause a throw.
     *   - Symbols used as keys are dropped silently by the browser's
     *     structuredClone implementation. This is a browser
     *     behaviour, not something this module can detect.
     *   - Class instances clone as plain objects, losing their
     *     prototype. This is structuredClone's behaviour.
     *
     * @param {*} value - Value to clone
     * @returns {*} Cloned value
     * @throws {Error} If structuredClone is unavailable, or if it
     *   throws on the given value.
     */
    function deepClone(value) {
        // Primitives: return as-is. Safe because primitives are
        // copied by value; there is no aliasing.
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone !== 'function') {
            throw new Error(
                'ObjectUtils.deepClone: structuredClone is not ' +
                'available in this environment. Cannot safely clone. ' +
                'A JSON fallback would silently corrupt data; this ' +
                'module refuses to provide one.'
            );
        }

        var cloned;
        try {
            cloned = structuredClone(value);
        } catch (e) {
            throw new Error(
                'ObjectUtils.deepClone: structuredClone failed. ' +
                'Value contains something that cannot be safely ' +
                'cloned (function, DOM node, proxy, or host object). ' +
                'Original error: ' + (e && e.message ? e.message : e)
            );
        }

        // structuredClone never returns the input reference for
        // object inputs. Assert that invariant defensively; a
        // failure here means the runtime is broken, not the caller.
        if (cloned === value) {
            throw new Error(
                'ObjectUtils.deepClone: structuredClone returned the ' +
                'input reference. This violates the read safety ' +
                'contract and indicates a broken runtime.'
            );
        }

        return cloned;
    }

    // ============================================================
    // PLAIN OBJECT CHECK
    // ============================================================

    /**
     * Check if a value is a plain data object.
     *
     * "Plain" means the prototype is Object.prototype or null.
     * Arrays, class instances, Dates, Maps, and Sets are NOT plain.
     *
     * NOTE: This duplicates ValidationUtils.isPlainObject. Both are
     * kept because this module is deliberately dependency-free, and
     * ValidationUtils is the canonical source. When in doubt, use
     * ValidationUtils.isPlainObject.
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ObjectUtils = Object.freeze({
        deepClone: deepClone,
        isPlainObject: isPlainObject
    });

})();
