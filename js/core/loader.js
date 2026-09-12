/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 * 
 * This module provides:
 *   - Readiness state for application data
 *   - Callback-based API for consumers
 *   - Event-to-callback translation
 *   - Retry capability for recovery scenarios
 * 
 * IMPORTANT:
 *   - This is a READINESS ADAPTER, not a data loader
 *   - Owns readiness/error state, NOT data
 *   - window.data is the canonical data source
 *   - DataLoader is a facade for the dataReady event
 *   - Can recover from missed events by checking current state
 *   - Failure is NOT permanently terminal (can recover via retry)
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
 * 
 *   // Retry after failure
 *   DataLoader.retry().then(function(data) {
 *       // data is window.data or null
 *   });
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

        _isReady = true;
        _hasFailed = false;
        _error = null;
        _isInitialized = true;

        processCallbacks();
    }

    function markFailed(error) {
        _isReady = false;
        _hasFailed = true;
        _error = error || new Error('Data loading failed');
        _isInitialized = true;

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
        if (_isReady) {
            return;
        }

        if (window.data) {
            markReady(window.data);
            return;
        }

        if (window.db && typeof window.db.getLoadError === 'function') {
            var loadError = window.db.getLoadError();
            if (loadError) {
                markFailed(loadError);
                return;
            }
        }

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

        document.addEventListener('dataReady', onDataReady);

        checkCurrentState();

        if (!_isInitialized) {
            _isInitialized = true;
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function whenReady(callback) {
        if (typeof callback !== 'function') return;

        checkCurrentState();

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

        _pendingCallbacks.push(callback);
    }

    function getData() {
        return _isReady ? window.data : null;
    }

    function getStatus() {
        if (_hasFailed) return 'failed';
        if (_isReady) return 'ready';
        if (_isInitialized) return 'waiting';
        return 'uninitialized';
    }

    function getError() {
        return _error;
    }

    function reset() {
        _isReady = false;
        _hasFailed = false;
        _error = null;
        _pendingCallbacks = [];
        _isInitialized = false;
    }

    function retry() {
        if (!_hasFailed) {
            return Promise.resolve(window.data || null);
        }

        reset();
        _isInitialized = true;

        return new Promise(function(resolve) {
            whenReady(function(data) {
                resolve(data || null);
            });
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DataLoader = {
        get isReady() { return _isReady; },
        get hasFailed() { return _hasFailed; },
        get isInitialized() { return _isInitialized; },
        get error() { return _error; },

        init: init,
        whenReady: whenReady,
        getData: getData,
        getStatus: getStatus,
        getError: getError,
        reset: reset,
        retry: retry
    };

    // ============================================================
    // AUTO-INIT
    // ============================================================

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();