/**
 * utils/id-utils.js - ID Generation Utilities
 * 
 * Path: js/utils/id-utils.js
 * 
 * This module provides:
 *   - generateId - Unique ID generation with prefix
 * 
 * IMPORTANT:
 *   - PURE function - no side effects
 *   - No domain knowledge
 */

(function() {
    'use strict';

    if (window.__idUtilsLoaded) return;
    window.__idUtilsLoaded = true;

    // ============================================================
    // ID GENERATION
    // ============================================================

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
    // EXPOSE
    // ============================================================

    window.IdUtils = {
        generateId: generateId
    };

})();
