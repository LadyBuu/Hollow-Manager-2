/**
 * utils/format-utils.js - Formatting Utilities
 * 
 * Path: js/utils/format-utils.js
 * 
 * This module provides:
 *   - formatDate - Date formatting
 *   - truncateString - String truncation
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects
 *   - No domain knowledge
 */

(function() {
    'use strict';

    if (window.__formatUtilsLoaded) return;
    window.__formatUtilsLoaded = true;

    // ============================================================
    // FORMATTING HELPERS
    // ============================================================

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        var date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'N/A';
        }
        
        return date.toLocaleDateString();
    }

    function truncateString(str, length) {
        if (str === undefined || str === null) return '';
        
        str = String(str);
        
        if (!Number.isFinite(length) || length < 0) {
            return str;
        }
        
        if (str.length <= length) return str;
        
        return str.substring(0, length) + '...';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FormatUtils = {
        formatDate: formatDate,
        truncateString: truncateString
    };

})();
