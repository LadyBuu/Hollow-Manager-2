/**
 * js/core/bootstrap.js - Application Bootstrap
 * Path: js/core/bootstrap.js
 * 
 * Responsibility (single): coordinate the startup sequence.
 * 
 * Sequence:
 *   DataLoader readiness
 *       ↓
 *   TabManager.onDataReady()
 *       ↓
 *   dispatch 'bootstrapReady'
 * 
 *   OR
 * 
 *   DataLoader failure
 *       ↓
 *   dispatch 'bootstrapFailed'
 * 
 * IMPORTANT:
 *   - No domain knowledge. No dashboard, no tabs, no rendering.
 *   - No direct window.data access. DataLoader is the sole source.
 *   - No safety timeouts that manufacture success.
 *   - No lifecycle methods added to TabManager.
 *   - Failure is reported via event, not by calling into TabManager.
 * 
 * LOAD ORDER:
 *   Must load AFTER core infrastructure (DataLoader, TabManager)
 *   and BEFORE app.js.
 * 
 * DEPENDENCIES:
 *   - window.DataLoader (from loader.js)
 *   - window.TabManager (from tab-manager.js)
 * 
 * USAGE:
 *   // Auto-bootstraps on DOM ready.
 *   // Manual reinit (for tests): window.bootstrap.reinit();
 */

(function() {
    'use strict';

    if (window.__bootstrapLoaded) {
        return;
    }
    window.__bootstrapLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DataLoader = window.DataLoader;
    var TabManager = window.TabManager;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _bootstrapping = false;
    var _resolved = false;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DataLoader || typeof DataLoader.whenReady !== 'function') {
            missing.push('DataLoader.whenReady');
        }

        if (!TabManager || typeof TabManager.onDataReady !== 'function') {
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
     * Initialize the bootstrap sequence.
     * 
     * @returns {boolean} True if the sequence was started (or already complete).
     */
    function init() {
        if (_initialized) {
            return true;
        }

        if (_bootstrapping) {
            return false;
        }

        _bootstrapping = true;

        if (!checkDependencies()) {
            _bootstrapping = false;
            return false;
        }

        // If DataLoader has already resolved before we started, handle now.
        if (DataLoader.isReady) {
            resolveSuccess();
            return true;
        }

        if (DataLoader.hasFailed) {
            resolveFailure(DataLoader.getError() || new Error('Data loading failed'));
            return true;
        }

        // Wait for readiness. DataLoader.whenReady fires with data on
        // success, or with null on failure.
        DataLoader.whenReady(function(data) {
            if (data) {
                resolveSuccess();
            } else {
                resolveFailure(
                    DataLoader.getError() || new Error('Data loading failed')
                );
            }
        });

        return true;
    }

    // ============================================================
    // RESOLUTION
    // ============================================================

    function resolveSuccess() {
        if (_resolved) {
            return;
        }
        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        // Notify TabManager that data is ready so it can render the
        // initial tab. TabManager handles whichever tabs are registered.
        try {
            TabManager.onDataReady();
        } catch (err) {
            console.error('[Bootstrap] TabManager.onDataReady failed:', err);
        }

        dispatchReady();
    }

    function resolveFailure(error) {
        if (_resolved) {
            return;
        }
        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        console.error('[Bootstrap] Data loading failed:', error);

        // Do not call TabManager.onDataReady(). TabManager stays in its
        // waiting state. The failure is reported via event; app.js
        // decides how to surface it.
        dispatchFailure(error);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('bootstrapReady', {
                detail: {
                    status: 'ready',
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    function dispatchFailure(error) {
        try {
            var event = new CustomEvent('bootstrapFailed', {
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
            });
            document.dispatchEvent(event);
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
        console.log('[Bootstrap] Reset complete');
    }

    function reinit() {
        reset();
        return init();
    }

    function getStatus() {
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

    window.bootstrap = {
        init: init,
        reset: reset,
        reinit: reinit,
        getStatus: getStatus
    };

    // ============================================================
    // AUTO-BOOTSTRAP
    // ============================================================

    function autoBootstrap() {
        if (_initialized) {
            return;
        }
        init();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        autoBootstrap();
    } else {
        document.addEventListener('DOMContentLoaded', autoBootstrap);
    }

})();
