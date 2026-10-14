/**
 * js/core/bootstrap.js - Application Bootstrap
 * Path: js/core/bootstrap.js
 *
 * Responsibility (single): coordinate the startup sequence.
 *
 * SEQUENCE:
 *   Load-order check
 *       |
 *       v
 *   DataLoader readiness
 *       |
 *       v
 *   TabManager.onDataReady()
 *       |
 *       v
 *   dispatch 'bootstrapReady'
 *
 *   OR
 *
 *   DataLoader failure
 *       |
 *       v
 *   dispatch 'bootstrapFailed'
 *
 *   OR
 *
 *   Load-order problem
 *       |
 *       v
 *   dispatch 'bootstrapFailed' with a diagnostic message
 *
 * IMPORTANT:
 *   - No domain knowledge. No dashboard, no tabs, no rendering.
 *   - No direct window.data access. DataLoader is the sole source.
 *   - No safety timeouts that manufacture success.
 *   - If TabManager.onDataReady() throws, 'bootstrapFailed' is
 *     dispatched (not 'bootstrapReady') with the error attached.
 *   - Failure is reported via event. Bootstrap does NOT call
 *     TabManager.onDataReady() on the failure path.
 *
 * TABMANAGER AND READINESS:
 *   TabManager also subscribes to DataLoader.whenReady() on its
 *   own, so it renders the initial tab without needing Bootstrap
 *   to trigger it. Bootstrap's call to TabManager.onDataReady()
 *   is idempotent (TabManager guards against a second call), so
 *   the arrangement works either way.
 *
 *   If TabManager's own callback fires first, Bootstrap's call is
 *   a no-op. If Bootstrap's call fires first, TabManager's own
 *   callback is a no-op. Both paths converge.
 *
 * FAILURE RECOVERY:
 *   After 'bootstrapFailed', calling DataLoader.retry() can
 *   recover. Bootstrap watches for a successful retry via a
 *   second whenReady() registration and re-runs the sequence.
 *   The second run is safe because every callback is token-guarded
 *   against stale attempts.
 *
 * EVENT REPLAY:
 *   'bootstrapReady' and 'bootstrapFailed' are dispatched in a
 *   macrotask (setTimeout 0), so listeners registered after this
 *   script loads still receive the events. The header of the
 *   previous version warned that app.js must call getStatus() to
 *   catch a synchronous dispatch; that is no longer necessary.
 *   getStatus() remains available for callers that want it.
 *
 * LOAD ORDER:
 *   Must load AFTER:
 *     - loader.js         (window.DataLoader)
 *     - tab-manager.js    (window.TabManager)
 *     - id-utils.js       (window.IdUtils)
 *     - object-utils.js   (window.ObjectUtils)
 *     - dom-utils.js      (window.DomUtils)
 *     - calendar-constants.js   (window.CalendarConstants)
 *     - calendar-validation.js  (window.CalendarValidation)
 *     - database.js       (window.db)
 *   and BEFORE app.js.
 *
 *   Bootstrap asserts this on init and refuses to start if a
 *   required module is missing. The failure is reported via
 *   'bootstrapFailed' with a diagnostic message.
 *
 * DEPENDENCIES:
 *   - window.DataLoader (required)
 *   - window.TabManager (required)
 *   - window.IdUtils (required; loaded by id-utils.js)
 *   - window.ObjectUtils (required; loaded by object-utils.js)
 *   - window.DomUtils (required; loaded by dom-utils.js)
 *   - window.CalendarConstants (required; loaded by calendar-constants.js)
 *   - window.CalendarValidation (required; loaded by calendar-validation.js)
 *   - window.db (required; loaded by database.js)
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
    // STATE
    // ============================================================

    var _initialized = false;
    var _bootstrapping = false;
    var _resolved = false;
    var _attemptToken = 0;

    // ============================================================
    // LAZY DEPENDENCY ACCESS
    // ============================================================

    function getDependencies() {
        return {
            DataLoader: window.DataLoader,
            TabManager: window.TabManager
        };
    }

    // ============================================================
    // LOAD-ORDER CHECK
    // ============================================================

    /**
     * Required modules and the methods Bootstrap uses from each.
     * This is a load-order assertion: if any is missing, the app
     * is loaded in the wrong order, and Bootstrap should not
     * silently proceed.
     */
    var REQUIRED_MODULES = [
        {
            name: 'IdUtils',
            methods: ['generateId'],
            file: 'id-utils.js'
        },
        {
            name: 'ObjectUtils',
            methods: ['deepClone'],
            file: 'object-utils.js'
        },
        {
            name: 'DomUtils',
            methods: ['escapeHtml'],
            file: 'dom-utils.js'
        },
        {
            name: 'CalendarConstants',
            methods: ['getDayName'],
            file: 'calendar-constants.js'
        },
        {
            name: 'CalendarValidation',
            methods: ['parseWeek'],
            file: 'calendar-validation.js'
        },
        {
            name: 'DataLoader',
            methods: ['whenReady'],
            file: 'loader.js'
        },
        {
            name: 'TabManager',
            methods: ['onDataReady'],
            file: 'tab-manager.js'
        }
    ];

    function checkLoadOrder() {
        var missing = [];

        for (var i = 0; i < REQUIRED_MODULES.length; i++) {
            var spec = REQUIRED_MODULES[i];
            var mod = window[spec.name];

            if (!mod) {
                missing.push(spec.name + ' (' + spec.file + ')');
                continue;
            }

            for (var j = 0; j < spec.methods.length; j++) {
                if (typeof mod[spec.methods[j]] !== 'function') {
                    missing.push(
                        spec.name + '.' + spec.methods[j] +
                        ' (' + spec.file + ')'
                    );
                }
            }
        }

        // window.db is not a module object, just a set of
        // functions. Check it separately.
        if (!window.db || typeof window.db.loadData !== 'function') {
            missing.push('window.db.loadData (database.js)');
        }

        return missing;
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
            console.error(
                '[Bootstrap] Missing critical dependencies:',
                missing.join(', ')
            );
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
     * @returns {boolean} True if the sequence was started or is
     *   already complete. False if an attempt is already in
     *   flight, or the load order is wrong. Callers that need to
     *   distinguish should consult getStatus().
     */
    function init() {
        if (_initialized) {
            return true;
        }

        if (_bootstrapping) {
            return false;
        }

        _bootstrapping = true;

        // Load-order assertion. A wrong order is a programmer
        // error, not a runtime failure, but Bootstrap refuses to
        // proceed and reports it via the same failure channel.
        var loadOrderProblems = checkLoadOrder();
        if (loadOrderProblems.length > 0) {
            _bootstrapping = false;
            var message =
                'Application scripts are loaded in the wrong order. ' +
                'Missing: ' + loadOrderProblems.join(', ') + '. ' +
                'Fix the script tags in index.html.';

            console.error('[Bootstrap] ' + message);
            dispatchFailure(new Error(message));
            return false;
        }

        if (!checkDependencies()) {
            _bootstrapping = false;
            var depError = new Error(
                'DataLoader or TabManager is missing a required method.'
            );
            dispatchFailure(depError);
            return false;
        }

        var DataLoader = getDependencies().DataLoader;

        // Token for this attempt. Stale callbacks from a previous
        // attempt (after reinit) are ignored.
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
            watchForRetry();
            return true;
        }

        // Wait for readiness.
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
                    watchForRetry();
                }
            },
            function(err) {
                if (myToken !== _attemptToken) { return; }
                resolveFailure(
                    err || new Error('Data loading failed'),
                    myToken
                );
                watchForRetry();
            }
        );

        return true;
    }

    /**
     * After a failure, watch for a successful retry and re-run the
     * sequence so 'bootstrapReady' is not lost.
     */
    function watchForRetry() {
        var DataLoader = getDependencies().DataLoader;
        if (!DataLoader || typeof DataLoader.whenReady !== 'function') {
            return;
        }

        DataLoader.whenReady(function(data) {
            if (!data) { return; }
            if (!_resolved) { return; }
            // Only re-run if the last attempt ended in failure.
            var status = getStatus();
            if (status.dataFailed) {
                reset();
                init();
            }
        });
    }

    // ============================================================
    // RESOLUTION
    // ============================================================

    function resolveSuccess(token) {
        if (token !== _attemptToken) { return; }
        if (_resolved && _initialized) {
            // Already successfully resolved on this attempt.
            return;
        }

        var TabManager = getDependencies().TabManager;
        var onDataReadyOk = true;
        var onDataReadyError = null;

        try {
            TabManager.onDataReady();
        } catch (err) {
            onDataReadyOk = false;
            onDataReadyError = err;
            console.error(
                '[Bootstrap] TabManager.onDataReady failed:',
                err
            );
        }

        if (!onDataReadyOk) {
            // Do not dispatch 'bootstrapReady'. Report failure
            // with the error attached.
            _resolved = true;
            _initialized = true;
            _bootstrapping = false;
            dispatchFailure(onDataReadyError);
            watchForRetry();
            return;
        }

        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        dispatchReady();
    }

    function resolveFailure(error, token) {
        if (token !== undefined && token !== _attemptToken) { return; }
        if (_resolved && _initialized) { return; }

        _resolved = true;
        _initialized = true;
        _bootstrapping = false;

        console.error('[Bootstrap] Data loading failed:', error);
        dispatchFailure(error);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    // Events are dispatched in a macrotask so listeners registered
    // after this script loads still receive them. This is the fix
    // for the "event fired before anyone arrived" bug.
    function dispatchReady() {
        setTimeout(function() {
            try {
                document.dispatchEvent(new CustomEvent('bootstrapReady', {
                    detail: {
                        status: 'ready',
                        timestamp: Date.now()
                    },
                    bubbles: true,
                    cancelable: false
                }));
            } catch (e) {
                // Ignore event dispatch errors
            }
        }, 0);
    }

    function dispatchFailure(error) {
        setTimeout(function() {
            try {
                document.dispatchEvent(new CustomEvent('bootstrapFailed', {
                    detail: {
                        status: 'failed',
                        message: error && error.message
                            ? error.message
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
        }, 0);
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
        if (_initialized) {
            return;
        }
        init();
    }

    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        autoBootstrap();
    } else {
        document.addEventListener('DOMContentLoaded', autoBootstrap);
    }

})();
