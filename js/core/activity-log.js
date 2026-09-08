/**
 * core/activity-log.js - Activity Logging
 * Application-wide activity logging infrastructure
 * 
 * Path: js/core/activity-log.js
 * 
 * This module provides:
 *   - Activity logging with timestamp
 *   - Activity history management
 *   - Automatic trimming to 100 entries
 *   - Structured metadata support
 * 
 * IMPORTANT:
 *   - This is application infrastructure, not a utility
 *   - Mutates window.data.activities
 *   - Domain modules call ActivityLog.record()
 *   - Does NOT create window.data if it doesn't exist
 *   - Uses IdUtils for ID generation (SINGLE SOURCE OF TRUTH)
 *   - Non-fatal: logging failures do not propagate
 * 
 * DEPENDENCIES:
 *   - window.IdUtils (for ID generation)
 *   - window.data (must exist before logging)
 * 
 * USAGE:
 *   ActivityLog.record('Character graduated', 'success');
 *   ActivityLog.record('Tournament completed', 'info', { tournamentId: 't_123' });
 */

(function() {
    'use strict';

    if (window.__activityLogLoaded) return;
    window.__activityLogLoaded = true;

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    function record(message, type, metadata) {
        try {
            if (message === undefined || message === null) {
                return;
            }

            message = String(message);
            type = type || 'info';
            metadata = metadata || null;

            if (!window.data || typeof window.data !== 'object') {
                return;
            }

            if (!Array.isArray(window.data.activities)) {
                window.data.activities = [];
            }

            var id = null;
            if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
                id = window.IdUtils.generateId('act');
            } else {
                id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            }

            window.data.activities.unshift({
                id: id,
                message: message,
                type: type,
                timestamp: new Date().toISOString(),
                metadata: metadata
            });

            if (window.data.activities.length > 100) {
                window.data.activities.length = 100;
            }

        } catch (error) {
            // Non-fatal: logging failures should not propagate
        }
    }

    function getHistory() {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return [];
        }
        return window.data.activities.slice();
    }

    function clearHistory() {
        if (window.data && Array.isArray(window.data.activities)) {
            window.data.activities = [];
        }
    }

    function getCount() {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return 0;
        }
        return window.data.activities.length;
    }

    function getByType(type) {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return [];
        }
        return window.data.activities.filter(function(entry) {
            return entry.type === type;
        });
    }

    function search(query) {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return [];
        }
        if (!query || typeof query !== 'string') {
            return [];
        }
        var lowerQuery = query.toLowerCase();
        return window.data.activities.filter(function(entry) {
            return entry.message.toLowerCase().indexOf(lowerQuery) !== -1;
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ActivityLog = {
        record: record,
        getHistory: getHistory,
        clearHistory: clearHistory,
        getCount: getCount,
        getByType: getByType,
        search: search
    };

})();
