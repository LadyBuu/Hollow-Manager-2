/**
 * utils/timing-utils.js - Timing Utilities
 * 
 * Path: js/utils/timing-utils.js
 * 
 * This module provides:
 *   - throttle - Throttle function calls (leading-edge)
 *   - debounce - Debounce function calls
 *   - once - Run function once
 * 
 * IMPORTANT:
 *   - No application or domain state
 *   - No DOM dependencies
 *   - No persistence
 *   - Functions return wrappers that maintain private timing state
 *   - These are NOT pure functions - they maintain internal state and use timers
 *   - Side-effect free with respect to application state
 *   - Moved from dom-utils.js
 * 
 * SEMANTICS:
 *   - throttle: Leading-edge. First call executes immediately.
 *     Subsequent calls during the throttle window are ignored.
 *     No trailing invocation.
 * 
 *   - debounce: Trailing-edge. Calls during the wait period
 *     reset the timer. Only the last call executes.
 * 
 *   - once: First call executes. Subsequent calls are ignored.
 *     Returns the result of the first call.
 * 
 * USAGE:
 *   var throttled = TimingUtils.throttle(function() { ... }, 100);
 *   var debounced = TimingUtils.debounce(function() { ... }, 100);
 *   var oneTime = TimingUtils.once(function() { ... });
 */

(function() {
    'use strict';

    if (window.__timingUtilsLoaded) return;
    window.__timingUtilsLoaded = true;

    // ============================================================
    // THROTTLE - Leading-edge
    // ============================================================

    /**
     * Create a throttled function (leading-edge).
     * 
     * SEMANTICS:
     *   - First call executes immediately
     *   - Subsequent calls during the throttle window are ignored
     *   - No trailing invocation after the window expires
     *   - Returns the result of the last executed call
     * 
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Throttle limit in milliseconds
     * @returns {Function} Throttled function
     * 
     * USAGE:
     *   var throttled = throttle(function() { ... }, 100);
     *   throttled(); // executes immediately
     *   throttled(); // ignored
     *   // 100ms later
     *   throttled(); // executes again
     */
    function throttle(fn, limit) {
        if (typeof fn !== 'function') {
            throw new Error('throttle: fn must be a function');
        }

        if (!Number.isFinite(limit) || limit < 0) {
            throw new Error('throttle: limit must be a non-negative finite number');
        }

        var inThrottle = false;
        var lastResult = null;

        return function() {
            var context = this;
            var args = arguments;

            if (!inThrottle) {
                inThrottle = true;
                lastResult = fn.apply(context, args);
                setTimeout(function() {
                    inThrottle = false;
                }, limit);
            }

            return lastResult;
        };
    }

    // ============================================================
    // DEBOUNCE - Trailing-edge
    // ============================================================

    /**
     * Create a debounced function (trailing-edge).
     * 
     * SEMANTICS:
     *   - Calls during the wait period reset the timer
     *   - Only the last call executes
     *   - The function executes after the wait period has elapsed
     * 
     * @param {Function} fn - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     * 
     * USAGE:
     *   var debounced = debounce(function() { ... }, 100);
     *   debounced(); // timer starts
     *   debounced(); // timer resets
     *   debounced(); // timer resets again
     *   // 100ms after last call, function executes once
     */
    function debounce(fn, wait) {
        if (typeof fn !== 'function') {
            throw new Error('debounce: fn must be a function');
        }

        if (!Number.isFinite(wait) || wait < 0) {
            throw new Error('debounce: wait must be a non-negative finite number');
        }

        var timer = null;

        return function() {
            var context = this;
            var args = arguments;

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            timer = setTimeout(function() {
                timer = null;
                fn.apply(context, args);
            }, wait);
        };
    }

    // ============================================================
    // ONCE - Run once
    // ============================================================

    /**
     * Create a function that runs only once.
     * 
     * SEMANTICS:
     *   - First call executes fn and stores the result
     *   - Subsequent calls return the stored result
     *   - If fn throws, it is NOT retried on subsequent calls
     * 
     * @param {Function} fn - Function to run once
     * @returns {Function} Function that runs only once
     * 
     * USAGE:
     *   var initialize = once(function() { return setup(); });
     *   var result = initialize(); // executes
     *   var sameResult = initialize(); // returns cached result
     */
    function once(fn) {
        if (typeof fn !== 'function') {
            throw new Error('once: fn must be a function');
        }

        var called = false;
        var result = null;

        return function() {
            if (!called) {
                called = true;
                result = fn.apply(this, arguments);
            }
            return result;
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TimingUtils = {
        throttle: throttle,
        debounce: debounce,
        once: once
    };

})();