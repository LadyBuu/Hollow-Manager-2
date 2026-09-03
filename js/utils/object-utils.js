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
 *   - Delegates to db.createSafeCopy when available
 */

(function() {
    'use strict';

    if (window.__objectUtilsLoaded) return;
    window.__objectUtilsLoaded = true;

    // ============================================================
    // DEEP CLONE
    // ============================================================

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        // Prefer database module's clone if available
        if (window.db && typeof window.db.createSafeCopy === 'function') {
            try {
                return window.db.createSafeCopy(value);
            } catch (e) {
                // Fall through to fallback
            }
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('ObjectUtils: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('ObjectUtils: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ObjectUtils = {
        deepClone: deepClone
    };

})();
