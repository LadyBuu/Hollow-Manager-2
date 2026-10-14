/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 *
 * Readiness adapter. Owns readiness/error state, not data.
 *
 * EXPOSES:
 *   DataLoader.isReady        boolean
 *   DataLoader.hasFailed      boolean
 *   DataLoader.isInitialized  boolean
 *   DataLoader.error          Error|null
 *
 *   whenReady(onReady, onError?)   Register a callback pair.
 *                                  Both are called asynchronously.
 *                                  onReady(data) on success,
 *                                  onError(err) on failure.
 *
 *   getData()      window.data or null
 *   getStatus()    'uninitialized' | 'waiting' | 'ready' | 'failed'
 *   getError()     the recorded error, if any
 *   init()         idempotent
 *   reset()        clears readiness/error state; pending callbacks
 *                  are carried into the next attempt
 *   retry()        real retry: re-opens the DB and reloads data.
 *                  Returns Promise<data|null>.
 *
 * BEHAVIOUR NOTES:
 *   - `window.data` is NOT treated as a readiness signal on its own.
 *     database.js assigns it before the migration save completes, so
 *     trusting it can flip "failed" to "ready" incorrectly.
 *   - Failure is NOT terminal. `retry()` re-attempts the load.
 *   - The degraded retry path (no window.db) has a bounded timeout so
 *     callers fail honestly rather than hanging.
 *
 * DEPENDENCIES:
 *   - window.data (canonical data source)
 *   - document (dataReady event)
 *   - window.db (optional; for status checks and real retry)
 *
 * USAGE:
 *   DataLoader.whenReady(
 *       function(data) { ... },
 *       function(err)  { ... }
 *   );
 */

(function() {
    'use strict';

    if (window.__loaderLoaded) return;
    window.__loaderLoaded = true;

    var DEGRADED_RETRY_TIMEOUT_MS = 30000;

    // ============================================================
    // STATE
    // ============================================================

    var _isInitialized = false;
    var _isReady = false;
    var _hasFailed = false;
    var _error = null;

    // Each entry: { onReady, onError }
    var _pendingCallbacks = [];

    var _retryPromise = null;
    var _listenerAttached = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function scheduleAsync(fn) {
        setTimeout(fn, 0);
    }

    function safeInvoke(fn, arg) {
        try {
            fn(arg);
        } catch (e) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[DataLoader] callback error:', e);
            }
        }
    }

    function normalisePair(onReady, onError) {
        if (typeof onReady === 'function') {
            return { onReady: onReady, onError: onError };
        }
        // Legacy single-argument form: treat as onReady only.
        return null;
    }

    // ============================================================
    // EVENT HANDLING
    // ============================================================

    function onDataReady(event) {
        if (event && event.detail && event.detail.status === 'failed') {
            markFailed(
                event.detail.error || new Error('Data loading failed')
            );
            return;
        }

        var data = event && event.detail ? event.detail.data : null;

        if (!data) {
            markFailed(new Error('dataReady received without data'));
            return;
        }

        markReady(data);
    }

    // ============================================================
    // STATE TRANSITIONS
    // ============================================================

    function markReady(data) {
        if (!data) { return; }

        _isReady = true;
        _hasFailed = false;
        _error = null;
        _isInitialized = true;

        drainReady(data);
    }

    function markFailed(error) {
        _isReady = false;
        _hasFailed = true;
        _error = error || new Error('Data loading failed');
        _isInitialized = true;

        drainFailed(_error);
    }

    function drainReady(data) {
        var batch = _pendingCallbacks.slice();
        _pendingCallbacks = [];

        for (var i = 0; i < batch.length; i++) {
            (function(pair) {
                scheduleAsync(function() {
                    safeInvoke(pair.onReady, data);
                });
            })(batch[i]);
        }
    }

    function drainFailed(err) {
        var batch = _pendingCallbacks.slice();
        _pendingCallbacks = [];

        for (var i = 0; i < batch.length; i++) {
            (function(pair) {
                scheduleAsync(function() {
                    if (pair.onError) {
                        safeInvoke(pair.onError, err);
                    } else if (pair.onReady) {
                        // Legacy caller did not supply onError.
                        // Deliver null so existing checks still work.
                        safeInvoke(pair.onReady, null);
                    }
                });
            })(batch[i]);
        }
    }

    // ============================================================
    // CURRENT STATE CHECK
    // ============================================================

    function checkCurrentState() {
        if (_isReady) { return; }

        // Error state takes precedence over the presence of
        // window.data, which database.js assigns before its
        // migration save completes.
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

        // Only trust window.data once we know there is no recorded
        // error and the DB has not failed.
        if (window.data) {
            markReady(window.data);
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) { return; }

        if (!_listenerAttached) {
            document.addEventListener('dataReady', onDataReady);
            _listenerAttached = true;
        }

        checkCurrentState();

        if (!_isInitialized) {
            _isInitialized = true;
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function whenReady(onReady, onError) {
        var pair = normalisePair(onReady, onError);
        if (!pair) { return; }

        checkCurrentState();

        if (_isReady && window.data) {
            scheduleAsync(function() {
                safeInvoke(pair.onReady, window.data);
            });
            return;
        }

        if (_hasFailed) {
            var err = _error || new Error('Data loading failed');
            scheduleAsync(function() {
                if (pair.onError) {
                    safeInvoke(pair.onError, err);
                } else {
                    safeInvoke(pair.onReady, null);
                }
            });
            return;
        }

        _pendingCallbacks.push(pair);
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

    function getError() { return _error; }

    /**
     * Clear readiness/error state but keep any pending callbacks so
     * they still fire on the next resolution.
     */
    function reset() {
        _isReady = false;
        _hasFailed = false;
        _error = null;
        _isInitialized = false;
        _retryPromise = null;
        // _pendingCallbacks deliberately preserved.
    }

    function retry() {
        if (!_hasFailed) {
            return Promise.resolve(window.data || null);
        }

        if (_retryPromise) {
            return _retryPromise;
        }

        var db = window.db;

        // Degraded path: no db or missing required methods.
        if (!db ||
            typeof db.ensureDatabaseReady !== 'function' ||
            typeof db.loadData !== 'function') {

            reset();
            _isInitialized = true;

            _retryPromise = new Promise(function(resolve) {
                var settled = false;

                function finish(value) {
                    if (settled) { return; }
                    settled = true;
                    _retryPromise = null;
                    resolve(value);
                }

                // Timeout so this fails honestly rather than hanging.
                var timer = setTimeout(function() {
                    markFailed(new Error(
                        'Retry timed out waiting for dataReady. ' +
                        'window.db is unavailable and no dataReady ' +
                        'event arrived within ' +
                        (DEGRADED_RETRY_TIMEOUT_MS / 1000) + 's.'
                    ));
                    finish(null);
                }, DEGRADED_RETRY_TIMEOUT_MS);

                whenReady(
                    function(data) {
                        clearTimeout(timer);
                        finish(data || null);
                    },
                    function() {
                        clearTimeout(timer);
                        finish(null);
                    }
                );
            });

            return _retryPromise;
        }

        // Full retry.
        reset();
        _isInitialized = true;

        _retryPromise = Promise.resolve()
            .then(function() { return db.ensureDatabaseReady(); })
            .then(function() { return db.loadData(); })
            .then(function(data) {
                if (data) {
                    markReady(data);
                    _retryPromise = null;
                    return data;
                }
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

    window.DataLoader = Object.freeze({
        get isReady()       { return _isReady; },
        get hasFailed()     { return _hasFailed; },
        get isInitialized() { return _isInitialized; },
        get error()         { return _error; },

        init: init,
        whenReady: whenReady,
        getData: getData,
        getStatus: getStatus,
        getError: getError,
        reset: reset,
        retry: retry
    });

    // ============================================================
    // AUTO-INIT
    // ============================================================

    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
