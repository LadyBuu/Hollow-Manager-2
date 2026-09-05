/**
 * js/core/bootstrap.js - Application Bootstrap
 * Path: js/core/bootstrap.js
 * 
 * This module connects infrastructure components:
 *   - DataLoader → TabManager (data readiness)
 *   - Database → DataLoader (data loading)
 *   - Ensures deterministic startup order
 * 
 * IMPORTANT:
 *   - This is the explicit bridge between infrastructure modules
 *   - No domain logic here
 *   - Just connects the dots
 *   - Single source of truth for application startup
 *   - Should be loaded AFTER all core modules but BEFORE domain modules
 * 
 * LOAD ORDER:
 *   <script src="js/core/core-utils.js"></script>
 *   <script src="js/utils/id-utils.js"></script>
 *   <script src="js/utils/object-utils.js"></script>
 *   <script src="js/utils/format-utils.js"></script>
 *   <script src="js/utils/timing-utils.js"></script>
 *   <script src="js/utils/validation-utils.js"></script>
 *   <script src="js/utils/dom-utils.js"></script>
 *   <script src="js/utils/form-utils.js"></script>
 *   <script src="js/utils/modal.js"></script>
 *   <script src="js/utils/notification.js"></script>
 *   <script src="js/core/activity-log.js"></script>
 *   <script src="js/core/database.js"></script>
 *   <script src="js/core/loader.js"></script>
 *   <script src="js/core/state.js"></script>
 *   <script src="js/core/tab-manager.js"></script>
 *   <script src="js/core/mutation-pipeline.js"></script>
 *   <script src="js/core/bootstrap.js"></script>  <!-- HERE -->
 *   <!-- Domain modules -->
 * 
 * DEPENDENCIES:
 *   - window.DataLoader (from loader.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.db (from database.js) - optional, for status checks
 * 
 * USAGE:
 *   // Auto-bootstraps on DOM ready
 *   // Or manually:
 *   window.bootstrap.init();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__bootstrapLoaded) {
        return;
    }
    window.__bootstrapLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var DataLoader = window.DataLoader;
    var TabManager = window.TabManager;
    var db = window.db;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _bootstrapping = false;
    var _dataReadyCalled = false;

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

        // db is optional - only used for status checks
        if (!db || typeof db.getDatabaseStatus !== 'function') {
            // Not fatal - we can still bootstrap without db status
        }

        if (missing.length > 0) {
            console.warn('[Bootstrap] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // BOOTSTRAP LOGIC
    // ============================================================

    /**
     * Initialize the application bootstrap.
     * Connects DataLoader to TabManager.
     * 
     * @returns {boolean} True if bootstrap was successful
     */
    function init() {
        if (_initialized) {
            return true;
        }

        if (_bootstrapping) {
            return false;
        }

        _bootstrapping = true;

        try {
            if (!checkDependencies()) {
                console.error('[Bootstrap] Required dependencies not available.');
                _bootstrapping = false;
                return false;
            }

            // Check if data is already ready
            if (DataLoader.isReady && window.data) {
                handleDataReady(window.data);
                _initialized = true;
                _bootstrapping = false;
                return true;
            }

            // If data has failed, handle it
            if (DataLoader.hasFailed) {
                handleDataFailure(DataLoader.getError());
                _initialized = true;
                _bootstrapping = false;
                return true;
            }

            // Wait for data to be ready
            DataLoader.whenReady(function(data) {
                if (data) {
                    handleDataReady(data);
                } else {
                    handleDataFailure(DataLoader.getError() || new Error('Data loading failed'));
                }
                _initialized = true;
                _bootstrapping = false;
            });

            // Safety timeout: if DataLoader never resolves, fallback
            setTimeout(function() {
                if (!_initialized) {
                    console.warn('[Bootstrap] DataLoader timeout - checking state');

                    // Check if data somehow became available
                    if (window.data) {
                        handleDataReady(window.data);
                        _initialized = true;
                        _bootstrapping = false;
                        return;
                    }

                    // Check database status for clues
                    if (db && typeof db.getDatabaseStatus === 'function') {
                        var status = db.getDatabaseStatus();
                        if (status === 'failed' || status === 'uninitialized') {
                            handleDataFailure(new Error('Database is ' + status));
                            _initialized = true;
                            _bootstrapping = false;
                            return;
                        }

                        // Still waiting - log but don't fail
                        console.warn('[Bootstrap] Still waiting for data (status: ' + status + ')');
                    }
                }
            }, 10000); // 10 second timeout

            return true;

        } catch (err) {
            console.error('[Bootstrap] Initialization failed:', err);
            _bootstrapping = false;
            return false;
        }
    }

    // ============================================================
    // DATA READY HANDLER
    // ============================================================

    function handleDataReady(data) {
        if (_dataReadyCalled) {
            return;
        }
        _dataReadyCalled = true;

        console.log('[Bootstrap] Data ready, initializing TabManager');

        // Tell TabManager that data is ready
        if (TabManager && typeof TabManager.onDataReady === 'function') {
            try {
                TabManager.onDataReady();
            } catch (err) {
                console.error('[Bootstrap] TabManager.onDataReady failed:', err);
            }
        }

        // Dispatch global event for any other listeners
        try {
            var event = new CustomEvent('bootstrapReady', {
                detail: {
                    status: 'ready',
                    data: data,
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
    // DATA FAILURE HANDLER
    // ============================================================

    function handleDataFailure(error) {
        if (_dataReadyCalled) {
            return;
        }
        _dataReadyCalled = true;

        console.error('[Bootstrap] Data loading failed:', error);

        // Tell TabManager about the failure (it will fallback to default tab)
        if (TabManager && typeof TabManager.onDataReady === 'function') {
            try {
                // Passing null indicates failure
                TabManager.onDataReady(null);
            } catch (err) {
                console.error('[Bootstrap] TabManager.onDataReady failed:', err);
            }
        }

        // Dispatch global event
        try {
            var event = new CustomEvent('bootstrapReady', {
                detail: {
                    status: 'failed',
                    error: error ? error.message : 'Unknown error',
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
    // MANUAL BOOTSTRAP (for testing/hot-reload)
    // ============================================================

    /**
     * Reset bootstrap state.
     * Useful for testing or hot-reloading.
     */
    function reset() {
        _initialized = false;
        _bootstrapping = false;
        _dataReadyCalled = false;
        console.log('[Bootstrap] Reset complete');
    }

    /**
     * Force bootstrap to re-run.
     * Useful if modules were reloaded.
     */
    function reinit() {
        reset();
        return init();
    }

    /**
     * Get the current bootstrap status.
     * 
     * @returns {object} Status object
     */
    function getStatus() {
        return {
            initialized: _initialized,
            bootstrapping: _bootstrapping,
            dataReadyCalled: _dataReadyCalled,
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
        getStatus: getStatus,
        onDataReady: handleDataReady,
        onDataFailure: handleDataFailure
    };

    // ============================================================
    // AUTO-BOOTSTRAP
    // ============================================================

    function autoBootstrap() {
        // Only auto-bootstrap once
        if (_initialized) {
            return;
        }

        // Wait for DOM to be ready
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            // If TabManager is already initialized, we might have missed the window
            if (TabManager && TabManager.isInitialized) {
                // TabManager already initialized - check if data is ready
                if (DataLoader && DataLoader.isReady && window.data) {
                    handleDataReady(window.data);
                    _initialized = true;
                } else {
                    init();
                }
            } else {
                init();
            }
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                // If TabManager initialized during DOM load, check state
                if (TabManager && TabManager.isInitialized) {
                    if (DataLoader && DataLoader.isReady && window.data) {
                        handleDataReady(window.data);
                        _initialized = true;
                    } else {
                        init();
                    }
                } else {
                    init();
                }
            });
        }
    }

    // Start auto-bootstrap
    autoBootstrap();

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy function for modules that expect window.bootstrapper.
     * @deprecated Use window.bootstrap.init() instead.
     */
    window.bootstrapper = {
        init: init,
        reset: reset,
        reinit: reinit,
        getStatus: getStatus
    };

})();