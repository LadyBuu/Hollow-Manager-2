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
 *   - Uses IdUtils for ID generation when available
 *   - Non-fatal: logging failures do not propagate
 *
 * ACTIVITY LOG CONTRACT:
 *
 *   Ordering:
 *     - Entries are stored NEWEST-FIRST (unshift on write).
 *     - Consumers may rely on this invariant: history[0] is always
 *       the most recent entry.
 *
 *   Entry shape:
 *     {
 *       id: string,
 *       message: string,
 *       type: 'info' | 'success' | 'warning' | 'error',
 *       timestamp: string,
 *       metadata: object|null
 *     }
 *
 *   Message semantics:
 *     - `message` is the COMPLETE human-readable text of the event.
 *       It is NOT a template. Consumers display it as-is.
 *
 *   Type semantics:
 *     - Unknown types are coerced to 'info'.
 *
 *   Metadata semantics:
 *     - `metadata` is deep-cloned on write, so later caller mutations
 *       do not affect the stored entry, and non-cloneable values are
 *       dropped rather than allowed to break a subsequent save.
 *
 *   Capacity:
 *     - History is capped at 100 entries. Older entries are dropped
 *       on write. Not configurable at runtime.
 *
 *   Failure behaviour:
 *     - Logging failures are non-fatal and are logged to the console
 *       as warnings.
 *
 * DEPENDENCIES:
 *   - window.IdUtils (for ID generation, preferred)
 *   - window.data (must exist before logging)
 *
 * USAGE:
 *   ActivityLog.record('Character graduated', 'success');
 *   ActivityLog.record('Tournament completed', 'info', { tournamentId: 't_123' });
 *
 *   var history = ActivityLog.getHistory(); // newest-first
 *   var recent = history.slice(0, 10);      // 10 most recent
 */

(function() {
    'use strict';

    if (window.__activityLogLoaded) return;
    window.__activityLogLoaded = true;

    var MAX_ENTRIES = 100;
    var VALID_TYPES = { info: true, success: true, warning: true, error: true };

    // ============================================================
    // HELPERS
    // ============================================================

    function coerceType(type) {
        if (typeof type !== 'string') { return 'info'; }
        return VALID_TYPES[type] ? type : 'info';
    }

    /**
     * Deep-clone metadata so the stored entry cannot be mutated by
     * the caller, and so non-cloneable values (DOM nodes, functions)
     * do not poison a subsequent createSafeCopy() in the save path.
     * Falls back to null on any failure.
     */
    function cloneMetadata(metadata) {
        if (metadata === null || metadata === undefined) { return null; }
        if (typeof metadata !== 'object') { return null; }

        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(metadata);
            }
            return JSON.parse(JSON.stringify(metadata));
        } catch (e) {
            return null;
        }
    }

    function generateId() {
        if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
            try {
                return window.IdUtils.generateId('act');
            } catch (e) {
                // fall through
            }
        }
        return 'act_' + Date.now() + '_' +
            Math.random().toString(36).slice(2, 10);
    }

    function getActivities() {
        if (!window.data || typeof window.data !== 'object') { return null; }
        if (!Array.isArray(window.data.activities)) { return null; }
        return window.data.activities;
    }

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    function record(message, type, metadata) {
        try {
            if (message === undefined || message === null) {
                return;
            }

            var activities = getActivities();
            if (!activities) {
                if (window.data && !Array.isArray(window.data.activities)) {
                    window.data.activities = [];
                    activities = window.data.activities;
                } else {
                    return;
                }
            }

            activities.unshift({
                id: generateId(),
                message: String(message),
                type: coerceType(type),
                timestamp: new Date().toISOString(),
                metadata: cloneMetadata(metadata)
            });

            if (activities.length > MAX_ENTRIES) {
                activities.length = MAX_ENTRIES;
            }

        } catch (error) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[ActivityLog] record() failed:', error);
            }
        }
    }

    function getHistory() {
        var activities = getActivities();
        if (!activities) { return []; }
        return activities.map(function(entry) {
            if (!entry || typeof entry !== 'object') { return entry; }
            var copy = {
                id: entry.id,
                message: entry.message,
                type: entry.type,
                timestamp: entry.timestamp,
                metadata: cloneMetadata(entry.metadata)
            };
            return copy;
        });
    }

    function clearHistory() {
        var activities = getActivities();
        if (activities) {
            // Mutate in place so holders of window.data.activities
            // stay coherent.
            activities.length = 0;
        }
    }

    function getCount() {
        var activities = getActivities();
        return activities ? activities.length : 0;
    }

    function getByType(type) {
        var activities = getActivities();
        if (!activities) { return []; }
        return activities.filter(function(entry) {
            return entry && typeof entry === 'object' && entry.type === type;
        });
    }

    function search(query) {
        var activities = getActivities();
        if (!activities) { return []; }
        if (!query || typeof query !== 'string') { return []; }

        var lowerQuery = query.toLowerCase();
        return activities.filter(function(entry) {
            if (!entry || typeof entry !== 'object') { return false; }
            if (typeof entry.message !== 'string') { return false; }
            return entry.message.toLowerCase().indexOf(lowerQuery) !== -1;
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ActivityLog = Object.freeze({
        record: record,
        getHistory: getHistory,
        clearHistory: clearHistory,
        getCount: getCount,
        getByType: getByType,
        search: search
    });

})();
