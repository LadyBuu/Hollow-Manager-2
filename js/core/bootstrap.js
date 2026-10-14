/**
 * js/core/bootstrap.js - Application Bootstrap
 * Path: js/core/bootstrap.js
 *
 * Coordinates the startup sequence:
 *   DataLoader readiness -> TabManager.onDataReady() -> 'bootstrapReady'
 *   OR
 *   DataLoader failure   -> 'bootstrapFailed'
 *
 * IMPORTANT:
 *   - No domain knowledge.
 *   - No direct window.data access. DataLoader is the sole source.
 *   - No safety timeouts that manufacture success.
 *   - Failure is reported via event, not by calling TabManager on error.
 *   - If TabManager.onDataReady() throws, 'bootstrapReady' is NOT
 *     dispatched; 'bootstrapFailed' is dispatched instead.
 *   - After a failure, a successful DataLoader.retry() re-runs the
 *     bootstrap sequence and dispatches 'bootstrapReady'.
 *
 * EVENTS:
 *   'bootstrapReady'  detail: { status: 'ready', timestamp }
 *   'bootstrapFailed' detail: { status: 'failed', message, error, timestamp }
 *
 * 'bootstrapReady' may fire synchronously during script load if data
 * is already present. Consumers in app.js must call getStatus() first
 * if they need to catch a late subscription.
 *
 * DEPENDENCIES:
 *   - window.DataLoader (from loader.js)
 *   - window.TabManager  (from tab-manager.js)
 */

(function() {
    'use strict';

    if (window.__bootstrapLoaded) return;
    window.__bootstrapLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _bootstrapping = false;
    var _resolved = false;
    var _attemptToken = 0;

    // ============================================================
    // DEPENDENCY CHECK - reads lazily
    // ============================================================

    function getDependencies() {
        return {
            DataLoader: window.DataLoader,
            TabManager: window.TabManager
        };
    }

    function checkDependencies() {
        var deps = getDependencies();
        var missing = [];

        if (!deps.DataLoader ||
            typeof deps.DataLoader.whenReady !== 'function') {
            missing.push('DataLoader.whenReady');
        }

        if (!deps.TabManager ||
            typeof deps.TabManager.onDataReady !== 'function') {
            missing.push('TabManager.onDataReady');
        }

        if (missing.length > 0) {
            console.error('[Bootstrap] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // INIT
    // ============================================================

    /**
     * @returns {boolean} true if the sequence was started or already
     *   complete; false if dependencies are missing or an attempt is
     *   already in flight.
     */
    function init() {
        if (_initialized) { return true; }
        if (_bootstrapping) { return false; }

        _bootstrapping = true;

        if (!checkDependencies()) {
            _bootstrapping = false;
            return false;
        }

        var deps = getDependencies();
        var DataLoader = deps.DataLoader;

        var myToken = ++_attemptToken;

        // Fast path: already resolved.
        if (DataLoader.isReady) {
            resolveSuccess(myToken);
            return true;
        }

        if (DataLoader.hasFailed) {
            resolveFailure(
                DataLoader.getError() || new Error('Data loading failed'),
                myToken
            );
            // Leave a listener in place for a possible later retry.
            watchForRetry(myToken);
            return true;
        }

        DataLoader.whenReady(
            function(data) {
                if (myToken !== _attemptToken) { return; }
                if (data) {
                    resolveSuccess(myToken);
                } else {
                    resolveFailure(
                        DataLoader.getError() ||
                        new Error('Data loading failed'),
                        myToken
                    );
                    watchForRetry(myToken);
                }
            },
            function(err) {
                if (myToken !== _attemptToken) { return; }
                resolveFailure(
                    err || new Error('Data loading failed'),
                    myToken
                );
                watchForRetry(myToken);
            }
        );

        return true;
    }

    /**
     * After a failure, watch for a successful retry and re-run the
     * sequence so 'bootstrapReady' is not lost.
     */
    function watchForRetry(previousToken) {
        var DataLoader = getDependencies().DataLoader;
        if (!DataLoader || typeof DataLoader.whenReady !== 'function') {
            return;
        }

        DataLoader.whenReady(function(data) {
            if (!data) { return; }
            if (!_resolved) { return; }
            // Successful retry after a failure: re-run.
            reset();
            init();
        });
    }

    // ============================================================
    // RESOLUTION
    // ============================================================

    function resolveSuccess(token) {
        if (token !== _attemptToken) { return; }
        if (_resolved) { return; }

        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        var TabManager = getDependencies().TabManager;
        var ok = true;

        try {
            TabManager.onDataReady();
        } catch (err) {
            ok = false;
            console.error('[Bootstrap] TabManager.onDataReady failed:', err);
            dispatchFailure(err);
        }

        if (ok) {
            dispatchReady();
        }
    }

    function resolveFailure(error, token) {
        if (token !== undefined && token !== _attemptToken) { return; }
        if (_resolved) { return; }

        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        console.error('[Bootstrap] Data loading failed:', error);
        dispatchFailure(error);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            document.dispatchEvent(new CustomEvent('bootstrapReady', {
                detail: { status: 'ready', timestamp: Date.now() },
                bubbles: true,
                cancelable: false
            }));
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    function dispatchFailure(error) {
        try {
            document.dispatchEvent(new CustomEvent('bootstrapFailed', {
                detail: {
                    status: 'failed',
                    message: error && error.message
                        ? 'Data loading failed: ' + error.message
                        : 'Data loading failed.',
                    error: error || null,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            }));
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    // ============================================================
    // TEST / HOT-RELOAD HELPERS
    // ============================================================

    function reset() {
        _initialized = false;
        _bootstrapping = false;
        _resolved = false;
        _attemptToken++;
    }

    function reinit() {
        reset();
        return init();
    }

    function getStatus() {
        var deps = getDependencies();
        var DataLoader = deps.DataLoader;
        return {
            initialized: _initialized,
            bootstrapping: _bootstrapping,
            resolved: _resolved,
            dataReady: DataLoader ? DataLoader.isReady : false,
            dataFailed: DataLoader ? DataLoader.hasFailed : false
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.bootstrap = Object.freeze({
        init: init,
        reset: reset,
        reinit: reinit,
        getStatus: getStatus
    });

    // ============================================================
    // AUTO-BOOTSTRAP
    // ============================================================

    function autoBootstrap() {
        if (_initialized) { return; }
        init();
    }

    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        autoBootstrap();
    } else {
        document.addEventListener('DOMContentLoaded', autoBootstrap);
    }

})();
