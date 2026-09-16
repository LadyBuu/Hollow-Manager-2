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
 * RETRY SEMANTICS:
 *   retry() is a REAL retry. It:
 *     1. Clears readiness/error state.
 *     2. Calls window.db.ensureDatabaseReady() to re-open the
 *        IndexedDB connection.
 *     3. Calls window.db.loadData() to reload application data.
 *     4. Transitions to ready on success, failed on failure.
 * 
 *   If window.db is unavailable (missing module or the module
 *   doesn't expose the required methods), retry() falls back to
 *   waiting for a dataReady event. This preserves the previous
 *   behavior as a degraded mode rather than crashing.
 * 
 *   Calling retry() while not in a failed state is a no-op that
 *   resolves to the current data (or null).
 * 
 *   Calling retry() while a retry is already in flight returns
 *   the same Promise. This prevents concurrent retries from
 *   stacking db.ensureDatabaseReady() calls.
 * 
 * DEPENDENCIES:
 *   - window.data (canonical data source)
 *   - document (for dataReady event)
 *   - window.db (for status checks and retry)
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

    // Retry state - prevents concurrent retries
    var _retryPromise = null;

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
        _retryPromise = null;
    }

    /**
     * Attempt to recover from a data-loading failure.
     * 
     * BEHAVIOR:
     *   - Not failed: resolves immediately with the current data (or
     *     null). Does not re-attempt the load.
     *   - Failed and a retry is already in flight: returns the same
     *     Promise. Concurrent calls do not stack.
     *   - Failed: resets state, then re-attempts the database open
     *     and load. On success transitions to ready; on failure
     *     transitions to failed and resolves with null.
     * 
     *   If window.db is unavailable or doesn't expose
     *   ensureDatabaseReady / loadData, the function falls back to
     *   the previous "reset and wait for a dataReady event" path.
     *   This keeps retry() safe in a degraded environment where
     *   only the event path exists.
     * 
     * @returns {Promise<object|null>} Resolved with window.data on
     *   success, null on failure.
     */
    function retry() {
        // Not failed: nothing to retry.
        if (!_hasFailed) {
            return Promise.resolve(window.data || null);
        }

        // Already retrying: return the in-flight Promise.
        if (_retryPromise) {
            return _retryPromise;
        }

        // Snapshot the db reference once, so a mid-retry swap of
        // window.db does not produce inconsistent state.
        var db = window.db;

        // Degraded path: no db, or db missing the required methods.
        // Reset and wait for a dataReady event.
        if (!db ||
            typeof db.ensureDatabaseReady !== 'function' ||
            typeof db.loadData !== 'function') {
            reset();
            _isInitialized = true;

            _retryPromise = new Promise(function(resolve) {
                whenReady(function(data) {
                    _retryPromise = null;
                    resolve(data || null);
                });
            });

            return _retryPromise;
        }

        // Full retry: reset, re-open the database, then load.
        reset();
        _isInitialized = true;

        _retryPromise = Promise.resolve()
            .then(function() {
                return db.ensureDatabaseReady();
            })
            .then(function() {
                return db.loadData();
            })
            .then(function(data) {
                if (data) {
                    // Ensure listeners and callbacks observe the ready
                    // state. dataReady may or may not have fired
                    // depending on whether loadData went through the
                    // dispatch path.
                    markReady(data);
                    _retryPromise = null;
                    return data;
                }

                // loadData resolved but yielded no data. Treat as
                // failure.
                markFailed(new Error('Data load returned no data.'));
                _retryPromise = null;
                return null;
            })
            .catch(function(err) {
                markFailed(err);
                _retryPromise = null;
                return null;
            });

        return _retryPromise;
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
