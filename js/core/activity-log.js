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
 */

(function() {
    'use strict';

    if (window.__activityLogLoaded) return;
    window.__activityLogLoaded = true;

    // ============================================================
    // ID GENERATION (internal)
    // ============================================================

    function _generateId(prefix) {
        prefix = prefix || 'id';
        
        if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
            return window.IdUtils.generateId(prefix);
        }
        
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        
        return prefix + '_' +
               Date.now() + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    function _logActivity(message, type) {
        type = type || 'info';
        
        if (message === undefined || message === null) {
            return;
        }
        
        message = String(message);
        
        if (!window.data || typeof window.data !== 'object') {
            window.data = {};
        }
        
        if (!Array.isArray(window.data.activities)) {
            window.data.activities = [];
        }
        
        window.data.activities.unshift({
            id: _generateId('act'),
            message: message,
            type: type,
            timestamp: new Date().toISOString()
        });
        
        if (window.data.activities.length > 100) {
            window.data.activities.length = 100;
        }
        
        console.log('[' + type + ']', message);
    }

    function recordActivity(message, type) {
        try {
            _logActivity(message, type);
        } catch (error) {
            console.error('Activity logging failed:', error);
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ActivityLog = {
        record: recordActivity,
        _logActivity: _logActivity  // Internal use only
    };

})();
