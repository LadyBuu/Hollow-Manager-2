/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 * 
 * This module provides:
 *   - Readiness state for application data
 *   - Callback-based API for consumers
 *   - Event-to-callback translation
 * 
 * IMPORTANT:
 *   - This is a READINESS ADAPTER, not a data loader
 *   - Owns readiness/error state, NOT data
 *   - window.data is the canonical data source
 *   - DataLoader is a facade for the dataReady event
 *   - Can recover from missed events by checking current state
 *   - Failure is NOT permanently terminal (can recover)
 * 
 * DEPENDENCIES:
 *   - window.data (canonical data source)
 *   - document (for dataReady event)
 *   - window.db (for status checks)
 * 
 * USAGE:
 *   DataLoader.whenReady(function(data) {
 *       // data is window.data
 *   });
 * 
 *   if (DataLoader.isReady) {
 *       var data = window.data;
 *   }
 */

(function() {
    'use strict';

    if (window.__loaderLoaded) return;
    window.__loaderLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _isInitialized = false;
    var _isReady = false;
    var _hasFailed = false;
    var _error = null;
    var _pendingCallbacks = [];

    // ============================================================
    // EVENT HANDLING
    // ============================================================

    function onDataReady(event) {
        if (event.detail && event.detail.status === 'failed') {
            markFailed(
                event.detail.error || new Error('Data loading failed')
            );
            return;
        }

        var data = event.detail ? event.detail.data : null;

        if (!data) {
            markFailed(
                new Error('dataReady received without data')
            );
            return;
        }

        markReady(data);
    }

    // ============================================================
    // STATE TRANSITIONS
    // ============================================================

    function markReady(data) {
        if (!data) return;

        // Update state
        _isReady = true;
        _hasFailed = false;
        _error = null;
        _isInitialized = true;

        // Process pending callbacks
        processCallbacks();
    }

    function markFailed(error) {
        _isReady = false;
        _hasFailed = true;
        _error = error || new Error('Data loading failed');
        _isInitialized = true;

        // Process pending callbacks with failure
        var callbacks = _pendingCallbacks.slice();
        _pendingCallbacks = [];

        callbacks.forEach(function(cb) {
            setTimeout(function() {
                try {
                    cb(null);
                } catch (e) {
                    // Ignore callback errors
                }
            }, 0);
        });
    }

    function processCallbacks() {
        if (!_isReady) return;

        var callbacks = _pendingCallbacks.slice();
        _pendingCallbacks = [];

        callbacks.forEach(function(cb) {
            try {
                cb(window.data);
            } catch (e) {
                // Ignore callback errors
            }
        });
    }

    // ============================================================
    // CURRENT STATE CHECK (for missed events)
    // ============================================================

    function checkCurrentState() {
        // Already ready
        if (_isReady) {
            return;
        }

        // Check if data already exists
        if (window.data) {
            markReady(window.data);
            return;
        }

        // Check if database has failed
        if (window.db && typeof window.db.getLoadError === 'function') {
            var loadError = window.db.getLoadError();
            if (loadError) {
                markFailed(loadError);
                return;
            }
        }

        // Check database status
        if (window.db && typeof window.db.getDatabaseStatus === 'function') {
            var status = window.db.getDatabaseStatus();
            if (status === 'failed') {
                markFailed(new Error('Database is in failed state'));
                return;
            }
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) return;

        // Listen for dataReady events
        document.addEventListener('dataReady', onDataReady);

        // Check if data already exists (event may have fired before init)
        checkCurrentState();

        // If still not ready, mark as initialized
        if (!_isInitialized) {
            _isInitialized = true;
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Register a callback to be called when data is ready.
     * 
     * SEMANTICS:
     *   - If data is already ready, callback executes immediately
     *   - If data loading has failed, callback receives null
     *   - If data is still loading, callback is queued
     *   - Can recover from failure if data later becomes ready
     * 
     * @param {Function} callback - Function receiving data or null
     */
    function whenReady(callback) {
        if (typeof callback !== 'function') return;

        // Check current state first (may have recovered)
        checkCurrentState();

        // If ready, execute immediately
        if (_isReady && window.data) {
            setTimeout(function() {
                try {
                    callback(window.data);
                } catch (e) {
                    // Ignore callback errors
                }
            }, 0);
            return;
        }

        // If failed, execute with null
        if (_hasFailed) {
            setTimeout(function() {
                try {
                    callback(null);
                } catch (e) {
                    // Ignore callback errors
                }
            }, 0);
            return;
        }

        // Otherwise, queue the callback
        _pendingCallbacks.push(callback);
    }

    /**
     * Get the current data.
     * 
     * @returns {object|null} window.data or null if not ready
     */
    function getData() {
        return _isReady ? window.data : null;
    }

    /**
     * Get the current status.
     * 
     * @returns {string} 'ready' | 'failed' | 'waiting' | 'uninitialized'
     */
    function getStatus() {
        if (_hasFailed) return 'failed';
        if (_isReady) return 'ready';
        if (_isInitialized) return 'waiting';
        return 'uninitialized';
    }

    /**
     * Get the current error (if any).
     * 
     * @returns {Error|null} Error or null
     */
    function getError() {
        return _error;
    }

    /**
     * Reset the loader state.
     * Useful for recovery scenarios.
     */
    function reset() {
        _isReady = false;
        _hasFailed = false;
        _error = null;
        _pendingCallbacks = [];
        _isInitialized = false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DataLoader = {
        // State
        get isReady() { return _isReady; },
        get hasFailed() { return _hasFailed; },
        get isInitialized() { return _isInitialized; },
        get error() { return _error; },

        // API
        init: init,
        whenReady: whenReady,
        getData: getData,
        getStatus: getStatus,
        getError: getError,
        reset: reset
    };

    // Legacy compatibility
    window.whenDataReady = whenReady;

    // ============================================================
    // AUTO-INIT
    // ============================================================

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();