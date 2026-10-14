/**
 * utils/timing-utils.js - Timing Utilities
 *
 * Path: js/utils/timing-utils.js
 *
 * This module provides:
 *   - throttle   - Leading-edge throttle (with trailing option)
 *   - debounce   - Trailing-edge debounce, with cancel() and flush()
 *   - once       - Run a function once; caches result or rethrows cached error
 *
 * IMPORTANT:
 *   - No application or domain state
 *   - No DOM dependencies
 *   - No persistence
 *   - Wrappers maintain private timing state and use timers
 *   - These are NOT pure functions - they are stateful closures
 *   - Side-effect free with respect to application state
 *
 * RETURN CONVENTIONS (deliberately different per function):
 *
 *   throttle(fn, limit)         -> returns fn's last successful result.
 *                                  Returns undefined if fn has thrown
 *                                  on every executed call so far.
 *                                  Suppressed calls return the previous
 *                                  successful result (stale by design).
 *
 *   debounce(fn, wait)          -> returns undefined from the wrapped
 *                                  call (fn runs later). The wrapper
 *                                  exposes .cancel() and .flush().
 *                                  .flush() returns fn's result if a
 *                                  pending call was executed, else
 *                                  undefined.
 *
 *   once(fn)                    -> returns fn's cached result on every
 *                                  call. If fn threw on the first call,
 *                                  the cached error is rethrown on every
 *                                  subsequent call. Callers can
 *                                  distinguish "returned null" from
 *                                  "failed" by catching.
 *
 * SEMANTICS:
 *   throttle (leading-edge, default):
 *     First call executes immediately. Subsequent calls during the
 *     throttle window are ignored. The window begins at the moment
 *     of the executed call, not at its completion; a slow fn can
 *     therefore overlap its own cooldown. No trailing invocation
 *     unless { trailing: true } is set.
 *
 *   throttle (with { trailing: true }):
 *     As above, but if any call was suppressed during the window,
 *     fn is invoked once at the end of the window with the last
 *     suppressed arguments. This is what you want for a slider or
 *     a text filter that must settle on the final input.
 *
 *   debounce:
 *     Trailing-edge. Calls during the wait period reset the timer.
 *     Only the last call's arguments are used. fn runs after the
 *     wait period elapses with no further calls.
 *
 *   once:
 *     First call executes fn. Subsequent calls return the cached
 *     result without re-invoking. If the first call throws, the
 *     error is cached and rethrown on every later call (the
 *     function is NOT retried).
 *
 * USAGE:
 *   var t = TimingUtils.throttle(function() { ... }, 100);
 *   var d = TimingUtils.debounce(function() { ... }, 100);
 *   var o = TimingUtils.once(function() { ... });
 *
 *   d.cancel();          // drop any pending call
 *   var r = d.flush();   // run any pending call now, return its result
 *
 *   var t2 = TimingUtils.throttle(fn, 100, { trailing: true });
 */

(function() {
    'use strict';

    if (window.__timingUtilsLoaded) return;
    window.__timingUtilsLoaded = true;

    // ============================================================
    // THROTTLE
    // ============================================================

    /**
     * Create a throttled function.
     *
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Throttle window in milliseconds
     * @param {object} [options]
     * @param {boolean} [options.trailing=false] - If true, invoke fn
     *   once at the end of the window with the last suppressed
     *   arguments, provided at least one call was suppressed.
     * @returns {Function} Throttled function
     *
     * @throws {Error} If fn is not a function or limit is invalid.
     *
     * SEMANTICS:
     *   - Leading-edge by default: first call executes immediately.
     *   - The window starts at the moment fn is invoked, not at its
     *     completion. A slow fn overlaps its own cooldown.
     *   - Suppressed calls return the previous successful result.
     *   - If fn throws, the cooldown still arms (the error is
     *     rethrown to the caller). This prevents a throwing fn from
     *     locking the throttle forever.
     *   - With trailing: true, a single trailing invocation runs at
     *     window end if any calls were suppressed.
     */
    function throttle(fn, limit, options) {
        if (typeof fn !== 'function') {
            throw new Error('throttle: fn must be a function');
        }
        if (!Number.isFinite(limit) || limit < 0) {
            throw new Error('throttle: limit must be a non-negative finite number');
        }

        options = options || {};
        var useTrailing = options.trailing === true;

        var inThrottle = false;
        var lastResult = undefined;
        var lastArgs = null;
        var lastContext = null;
        var trailingTimer = null;
        var timer = null;

        function armCooldown() {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(function() {
                timer = null;
                inThrottle = false;

                if (useTrailing && lastArgs !== null) {
                    var ctx = lastContext;
                    var args = lastArgs;
                    lastArgs = null;
                    lastContext = null;

                    inThrottle = true;
                    armCooldown();

                    try {
                        lastResult = fn.apply(ctx, args);
                    } catch (e) {
                        lastResult = undefined;
                        throw e;
                    }
                }
            }, limit);
        }

        return function() {
            var context = this;
            var args = arguments;

            if (inThrottle) {
                if (useTrailing) {
                    lastArgs = args;
                    lastContext = context;
                }
                return lastResult;
            }

            inThrottle = true;

            // Arm the cooldown BEFORE calling fn, so a throw does
            // not leave inThrottle stuck at true forever.
            armCooldown();

            try {
                lastResult = fn.apply(context, args);
            } catch (e) {
                lastResult = undefined;
                throw e;
            }

            return lastResult;
        };
    }

    // ============================================================
    // DEBOUNCE
    // ============================================================

    /**
     * Create a debounced function.
     *
     * @param {Function} fn - Function to debounce
     * @param {number} wait - Wait period in milliseconds
     * @returns {Function} Debounced function with .cancel() and .flush()
     *
     * @throws {Error} If fn is not a function or wait is invalid.
     *
     * SEMANTICS:
     *   - Trailing-edge. Calls during the wait period reset the timer.
     *   - Only the last call's arguments are used.
     *   - The wrapped function returns undefined; use .flush() if you
     *     need the pending call's result.
     *
     * .cancel():
     *   Drops any pending call. The wrapped function will not run.
     *
     * .flush():
     *   If a call is pending, runs it immediately with the last
     *   arguments and returns its result. If no call is pending,
     *   returns undefined. Safe to call multiple times; the pending
     *   state is cleared either way.
     *
     * TYPICAL USE:
     *   var save = TimingUtils.debounce(doSave, 500);
     *   window.addEventListener('beforeunload', function() {
     *       save.flush();
     *   });
     *   // Or, to discard pending work on navigation:
     *   save.cancel();
     */
    function debounce(fn, wait) {
        if (typeof fn !== 'function') {
            throw new Error('debounce: fn must be a function');
        }
        if (!Number.isFinite(wait) || wait < 0) {
            throw new Error('debounce: wait must be a non-negative finite number');
        }

        var timer = null;
        var pendingArgs = null;
        var pendingContext = null;

        function clearPending() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            pendingArgs = null;
            pendingContext = null;
        }

        var debounced = function() {
            pendingArgs = arguments;
            pendingContext = this;

            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(function() {
                timer = null;
                var args = pendingArgs;
                var ctx = pendingContext;
                pendingArgs = null;
                pendingContext = null;
                fn.apply(ctx, args);
            }, wait);
        };

        debounced.cancel = function() {
            clearPending();
        };

        debounced.flush = function() {
            if (!pendingArgs) {
                return undefined;
            }

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            var args = pendingArgs;
            var ctx = pendingContext;
            pendingArgs = null;
            pendingContext = null;

            return fn.apply(ctx, args);
        };

        return debounced;
    }

    // ============================================================
    // ONCE
    // ============================================================

    /**
     * Create a function that runs at most once.
     *
     * @param {Function} fn - Function to run once
     * @returns {Function} Wrapper that runs fn once and caches result
     *
     * @throws {Error} If fn is not a function.
     *
     * SEMANTICS:
     *   - First call executes fn and caches the return value.
     *   - Subsequent calls return the cached value.
     *   - If the first call throws, the error is cached and rethrown
     *     on every subsequent call. fn is NOT retried.
     *   - The wrapper is not resettable. For retryable initialization,
     *     use a different primitive.
     *
     * CALLER GUIDANCE:
     *   Because a thrown error is rethrown rather than swallowed,
     *   the caller can always distinguish "fn returned null" from
     *   "fn failed" by catching. There is no silent null fallback.
     */
    function once(fn) {
        if (typeof fn !== 'function') {
            throw new Error('once: fn must be a function');
        }

        var called = false;
        var result;
        var error = null;

        return function() {
            if (!called) {
                called = true;
                try {
                    result = fn.apply(this, arguments);
                } catch (e) {
                    error = e;
                }
            }

            if (error !== null) {
                throw error;
            }

            return result;
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TimingUtils = Object.freeze({
        throttle: throttle,
        debounce: debounce,
        once: once
    });

})();
