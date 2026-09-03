/**
 * utils/timing-utils.js - Timing Utilities
 * 
 * Path: js/utils/timing-utils.js
 * 
 * This module provides:
 *   - throttle - Throttle function calls
 *   - debounce - Debounce function calls
 *   - once - Run function once
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects
 *   - Moved from dom-utils.js
 */

(function() {
    'use strict';

    if (window.__timingUtilsLoaded) return;
    window.__timingUtilsLoaded = true;

    // ============================================================
    // TIMING HELPERS
    // ============================================================

    function throttle(fn, limit) {
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

    function debounce(fn, wait) {
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

    function once(fn) {
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
