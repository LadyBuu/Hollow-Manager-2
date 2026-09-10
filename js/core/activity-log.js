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
 * ACTIVITY LOG CONTRACT:
 * 
 *   Ordering:
 *     - Entries are stored NEWEST-FIRST (unshift on write).
 *     - Consumers may rely on this invariant: history[0] is always
 *       the most recent entry. If you slice the history, you are
 *       taking the most recent N entries.
 * 
 *   Entry shape:
 *     {
 *       id: string,          // unique, generated via IdUtils.generateId('act')
 *       message: string,     // complete human-readable text
 *       type: string,        // 'info' | 'success' | 'warning' | 'error'
 *       timestamp: string,   // ISO 8601
 *       metadata: object|null // optional, opaque to ActivityLog
 *     }
 * 
 *   Message semantics:
 *     - `message` is the COMPLETE human-readable text of the event.
 *       It is NOT a template waiting to be resolved.
 *     - ActivityLog does NOT resolve referenced entities. If a producer
 *       wants a character name in the message, the producer includes it.
 *     - Consumers should display `message` as-is.
 * 
 *   Type semantics:
 *     - 'info'    - default, neutral events
 *     - 'success' - completed successfully
 *     - 'warning' - completed with a caveat
 *     - 'error'   - failed
 *     - Producers should pass a type when the log entry implies one.
 *       MutationPipeline passes the pipeline's outcome type.
 * 
 *   Metadata semantics:
 *     - `metadata` is an optional object for caller use.
 *     - Its shape is NOT part of the contract.
 *     - ActivityLog does not inspect, validate, or transform it.
 *     - Consumers that rely on specific metadata fields must
 *       coordinate with producers. Do not assume a field exists.
 *     - Currently no producer in the codebase populates metadata.
 *       It is a hook for future structured logging.
 * 
 *   Capacity:
 *     - History is capped at 100 entries. Older entries are dropped
 *       on write. This is intentional and not configurable at runtime.
 * 
 *   Failure behaviour:
 *     - Logging failures are non-fatal. If window.data is missing or
 *       malformed, record() silently returns. The caller's operation
 *       should not fail because logging failed.
 * 
 * DEPENDENCIES:
 *   - window.IdUtils (for ID generation)
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
