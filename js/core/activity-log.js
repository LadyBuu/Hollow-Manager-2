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
 *   ActivityLog.record('Tournament completed', 'info');
 */

(function() {
    'use strict';

    if (window.__activityLogLoaded) return;
    window.__activityLogLoaded = true;

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    /**
     * Record an activity in the application history.
     * 
     * @param {string} message - Activity description
     * @param {string} type - Activity type: 'info', 'success', 'warning', 'error'
     * 
     * BEHAVIOR:
     *   - If window.data doesn't exist, logs a warning and returns
     *   - If window.data.activities doesn't exist, creates it
     *   - Trims history to 100 entries (newest first)
     *   - All errors are caught and logged to console (non-fatal)
     * 
     * USAGE:
     *   ActivityLog.record('Character created', 'success');
     *   ActivityLog.record('Mission failed', 'error');
     */
    function record(message, type) {
        try {
            // Validate input
            if (message === undefined || message === null) {
                return;
            }

            message = String(message);
            type = type || 'info';

            // Do NOT create window.data - it must exist
            if (!window.data || typeof window.data !== 'object') {
                console.warn('[ActivityLog] window.data is not available');
                return;
            }

            // Create activities array if it doesn't exist
            if (!Array.isArray(window.data.activities)) {
                window.data.activities = [];
            }

            // Generate ID using IdUtils (single source of truth)
            var id = null;
            if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
                id = window.IdUtils.generateId('act');
            } else {
                // Emergency fallback if IdUtils is missing
                id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            }

            // Prepend new activity (newest first)
            window.data.activities.unshift({
                id: id,
                message: message,
                type: type,
                timestamp: new Date().toISOString()
            });

            // Trim to 100 entries
            if (window.data.activities.length > 100) {
                window.data.activities.length = 100;
            }

        } catch (error) {
            // Non-fatal: logging failures should not propagate
            console.error('[ActivityLog] Failed to record activity:', error);
        }
    }

    /**
     * Get the current activity history.
     * Returns a copy of the activities array.
     * 
     * @returns {Array} Array of activity objects (newest first)
     */
    function getHistory() {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return [];
        }
        return window.data.activities.slice();
    }

    /**
     * Clear the activity history.
     */
    function clearHistory() {
        if (window.data && Array.isArray(window.data.activities)) {
            window.data.activities = [];
        }
    }

    /**
     * Get the number of activities in the history.
     * 
     * @returns {number} Number of activities
     */
    function getCount() {
        if (!window.data || !Array.isArray(window.data.activities)) {
            return 0;
        }
        return window.data.activities.length;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ActivityLog = {
        record: record,
        getHistory: getHistory,
        clearHistory: clearHistory,
        getCount: getCount
    };

})();