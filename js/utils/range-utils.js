/**
 * utils/range-utils.js - Range Utilities
 * Generic range predicates for integer intervals with open ends.
 *
 * Path: js/utils/range-utils.js
 *
 * This module provides:
 *   - contains(value, start, end)        — is value in [start, end]?
 *   - overlaps(startA, endA, sB, eB)     — do two ranges intersect?
 *   - intersection(sA, eA, sB, eB)       — the [start, end] of overlap
 *   - containsWeek(week, start, end)     — week-typed contains
 *   - weeksOverlap(sA, eA, sB, eB)       — week-typed overlaps
 *
 * IMPORTANT:
 *   - PURE. No side effects. No mutable state.
 *   - No domain knowledge beyond "weeks are bounded by CalendarConstants".
 *   - Two external dependencies: CalendarConstants, CalendarValidation.
 *   - These are the SINGLE SOURCE OF TRUTH for range predicates in
 *     the application. Every module that needs "does this interval
 *     contain this value" or "do these two intervals overlap" MUST
 *     delegate here. Do not reimplement per-module.
 *
 * OPEN-ENDED RANGES (null end):
 *   `end === null` means "unbounded on the right" (ongoing). This is
 *   the semantic the Academy teaching model uses for `endWeek: null`
 *   and the enrollment store uses for `endWeek: null`. RangeUtils
 *   treats null-end uniformly: the range extends to positive
 *   infinity for overlap and containment purposes.
 *
 *   A `start` of null is treated as "no range" — the predicates
 *   return false (contains) or false (overlaps). A range without a
 *   start is meaningless; callers that want "from the beginning"
 *   should pass MIN_WEEK or an explicit value.
 *
 * INCLUSIVE ENDS:
 *   All bounds are inclusive on both ends. A range [1, 10] contains
 *   weeks 1, 2, ..., 10. This matches the Academy teaching model's
 *   "endWeek is inclusive" convention.
 *
 * WEEK-TYPED vs GENERIC:
 *   The generic forms (`contains`, `overlaps`, `intersection`) work
 *   on any integer interval with null-as-open-end. They do not
 *   validate inputs beyond "is a finite number for start and end
 *   when non-null."
 *
 *   The week-typed forms (`containsWeek`, `weeksOverlap`) first
 *   parse the week through CalendarValidation.parseWeek, then run
 *   the same logic with MIN_WEEK / MAX_WEEK as the outer bounds.
 *   A week outside [MIN_WEEK, MAX_WEEK] is rejected: containsWeek
 *   returns false; weeksOverlap treats an invalid argument as "no
 *   range" and returns false.
 *
 * WHY THIS MODULE EXISTS:
 *   The Academy module accumulated nine independent implementations
 *   of the same two predicates. Each had slightly different blank-
 *   bound handling and edge-case treatment. Consolidating them into
 *   one canonical implementation is what makes the semantics
 *   consistent across the whole teaching model.
 *
 * NOT THIS MODULE:
 *   - Input validation of week strings or numbers is
 *     CalendarValidation's concern. RangeUtils calls into
 *     CalendarValidation; it does not reimplement parsing.
 *   - Persistence, mutation, projection, or rendering.
 *   - Any domain-specific concept (enrolment, class-discipline,
 *     teaching group, session). Those modules own their own
 *     semantics; they delegate only the range question to this file.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)   MANDATORY
 *   - window.CalendarValidation   (parseWeek)            MANDATORY
 *
 * USAGE:
 *   var R = window.RangeUtils;
 *
 *   R.contains(5, 1, 10);           // true
 *   R.contains(15, 1, 10);          // false
 *   R.contains(5, 1, null);         // true (open end)
 *
 *   R.overlaps(1, 10, 5, 15);       // true
 *   R.overlaps(1, 10, 11, 20);      // false
 *   R.overlaps(1, 10, 10, 20);      // true (inclusive)
 *   R.overlaps(1, null, 30, 40);    // true (open end)
 *
 *   R.intersection(1, 10, 5, 15);   // { start: 5, end: 10 }
 *   R.intersection(1, 10, 11, 20);  // null
 *
 *   R.containsWeek(5, 1, 10);       // true
 *   R.containsWeek(53, 1, 10);      // false (week out of bounds)
 *   R.weeksOverlap(1, 10, 5, null); // true
 */

(function() {
    'use strict';

    if (window.__rangeUtilsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[RangeUtils] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__rangeUtilsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Is this value a usable integer endpoint?
     *
     * For `start`: must be a finite integer. Null start means "no
     * range" and is rejected by the predicates themselves, not here.
     *
     * For `end`: either a finite integer, or null (unbounded).
     */
    function isFiniteInteger(value) {
        return typeof value === 'number' &&
               isFinite(value) &&
               Number.isInteger(value);
    }

    /**
     * Normalise an "end" endpoint. null / undefined become
     * Infinity (unbounded on the right). Non-integer values
     * become null so the caller can reject them.
     *
     * @returns {number|null} finite integer, Infinity, or null
     */
    function normaliseEnd(end) {
        if (end === null || end === undefined) {
            return Infinity;
        }
        if (!isFiniteInteger(end)) {
            return null;
        }
        return end;
    }

    /**
     * Normalise a "start" endpoint. null / undefined / non-integer
     * become null (invalid).
     *
     * @returns {number|null} finite integer or null
     */
    function normaliseStart(start) {
        if (!isFiniteInteger(start)) {
            return null;
        }
        return start;
    }

    // ============================================================
    // GENERIC PREDICATES
    // ============================================================

    /**
     * Does the range [start, end] contain the value?
     *
     * SEMANTICS:
     *   - Both bounds are inclusive.
     *   - `end === null` means "unbounded on the right."
     *   - A null or non-integer `start` means "no range": returns
     *     false for every value.
     *   - A null `value` returns false.
     *   - A non-integer `value` returns false.
     *   - A non-integer, non-null `end` returns false (invalid
     *     range).
     *
     * @param {number} value
     * @param {number} start
     * @param {number|null} end
     * @returns {boolean}
     */
    function contains(value, start, end) {
        if (!isFiniteInteger(value)) {
            return false;
        }

        var s = normaliseStart(start);
        if (s === null) {
            return false;
        }

        var e = normaliseEnd(end);
        if (e === null) {
            return false;
        }

        if (value < s) {
            return false;
        }
        if (value > e) {
            return false;
        }
        return true;
    }

    /**
     * Do the ranges [startA, endA] and [startB, endB] overlap?
     *
     * SEMANTICS:
     *   - Both bounds are inclusive.
     *   - `end === null` means "unbounded on the right."
     *   - A null or non-integer `start` on either side means "no
     *     range": returns false.
     *   - A non-integer, non-null `end` on either side means "no
     *     range": returns false.
     *
     *   Inclusive-endpoint overlap: [1, 10] and [10, 20] DO overlap
     *   at week 10. This is deliberate; it matches the teaching
     *   model's convention that endWeek is the last active week.
     *
     * @returns {boolean}
     */
    function overlaps(startA, endA, startB, endB) {
        var sA = normaliseStart(startA);
        if (sA === null) { return false; }

        var sB = normaliseStart(startB);
        if (sB === null) { return false; }

        var eA = normaliseEnd(endA);
        if (eA === null) { return false; }

        var eB = normaliseEnd(endB);
        if (eB === null) { return false; }

        // Two intervals overlap iff:
        //   startA <= endB   AND   startB <= endA
        // Inclusive bounds, so touching at one point counts.
        return sA <= eB && sB <= eA;
    }

    /**
     * Return the intersection of [startA, endA] and [startB, endB],
     * or null when they do not overlap.
     *
     * SEMANTICS:
     *   - Both bounds are inclusive.
     *   - `end === null` means "unbounded on the right."
     *   - The returned `end` is a finite integer when either input
     *     has a finite end. If both ends are null, the returned
     *     `end` is null (unbounded).
     *   - A null or non-integer start on either side means "no
     *     range": returns null.
     *
     * @returns {object|null} { start, end } or null
     */
    function intersection(startA, endA, startB, endB) {
        var sA = normaliseStart(startA);
        if (sA === null) { return null; }

        var sB = normaliseStart(startB);
        if (sB === null) { return null; }

        var eA = normaliseEnd(endA);
        if (eA === null) { return null; }

        var eB = normaliseEnd(endB);
        if (eB === null) { return null; }

        var start = Math.max(sA, sB);
        var end = Math.min(eA, eB);

        if (start > end) {
            return null;
        }

        return {
            start: start,
            end: end === Infinity ? null : end
        };
    }

    // ============================================================
    // WEEK-TYPED PREDICATES
    // ============================================================
    //
    // These parse the week argument through CalendarValidation
    // first, then run the generic predicate against it. The
    // parsing rejects a week outside [MIN_WEEK, MAX_WEEK] and any
    // non-integer input. Invalid weeks return false.

    /**
     * Does the week range [startWeek, endWeek] contain the given
     * week?
     *
     * SEMANTICS:
     *   - `week` is validated through CalendarValidation.parseWeek.
     *     A non-integer or out-of-range value returns false.
     *   - `startWeek` and `endWeek` are the same shape as the
     *     generic predicate: inclusive bounds, null end means
     *     unbounded.
     *   - `startWeek` and `endWeek` are NOT validated for range;
     *     the caller is expected to pass integers within the
     *     calendar. This matches the teaching-model stores, which
     *     always write validated weeks.
     *
     * @param {number|string} week
     * @param {number} startWeek
     * @param {number|null} endWeek
     * @returns {boolean}
     */
    function containsWeek(week, startWeek, endWeek) {
        var w = CalendarValidation.parseWeek(week);
        if (w === null) {
            return false;
        }
        if (w < MIN_WEEK || w > MAX_WEEK) {
            return false;
        }
        return contains(w, startWeek, endWeek);
    }

    /**
     * Do the two week ranges [startA, endA] and [startB, endB]
     * overlap?
     *
     * SEMANTICS:
     *   - Both bounds are inclusive.
     *   - `end === null` means "unbounded on the right."
     *   - Starts are validated as integers in [MIN_WEEK, MAX_WEEK].
     *     An invalid start on either side returns false.
     *   - Ends are validated as integers in [MIN_WEEK, MAX_WEEK]
     *     when non-null. An invalid end on either side returns
     *     false.
     *
     * @returns {boolean}
     */
    function weeksOverlap(startA, endA, startB, endB) {
        var sA = parseWeekStart(startA);
        if (sA === null) { return false; }

        var sB = parseWeekStart(startB);
        if (sB === null) { return false; }

        var eA = parseWeekEnd(endA);
        if (eA === null) { return false; }

        var eB = parseWeekEnd(endB);
        if (eB === null) { return false; }

        return sA <= eB && sB <= eA;
    }

    // ============================================================
    // INTERNAL - Week-endpoint parsing for weeksOverlap
    // ============================================================
    //
    // containsWeek delegates to contains, which does not validate
    // the bounds themselves. weeksOverlap is different: it is
    // comparing two ranges, and both ranges are supposed to be
    // week-typed. So it parses both endpoints.

    function parseWeekStart(value) {
        var parsed = CalendarValidation.parseWeek(value);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    function parseWeekEnd(value) {
        if (value === null || value === undefined) {
            return Infinity;
        }
        return parseWeekStart(value);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.RangeUtils = Object.freeze({
        // Generic
        contains: contains,
        overlaps: overlaps,
        intersection: intersection,

        // Week-typed
        containsWeek: containsWeek,
        weeksOverlap: weeksOverlap,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.RangeUtils;
        var missing = [];

        var required = [
            'contains',
            'overlaps',
            'intersection',
            'containsWeek',
            'weeksOverlap'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke tests. These run once at load time. A throw here
        // means the module is broken and callers should fail loudly.
        try {
            // contains
            if (contains(5, 1, 10) !== true) {
                missing.push('contains(5,1,10) !== true');
            }
            if (contains(15, 1, 10) !== false) {
                missing.push('contains(15,1,10) !== false');
            }
            if (contains(10, 1, 10) !== true) {
                missing.push('contains inclusive end failed');
            }
            if (contains(5, 1, null) !== true) {
                missing.push('contains open end failed');
            }
            if (contains(5, null, 10) !== false) {
                missing.push('contains null start should be false');
            }
            if (contains(null, 1, 10) !== false) {
                missing.push('contains null value should be false');
            }

            // overlaps
            if (overlaps(1, 10, 5, 15) !== true) {
                missing.push('overlaps simple failed');
            }
            if (overlaps(1, 10, 11, 20) !== false) {
                missing.push('overlaps disjoint failed');
            }
            if (overlaps(1, 10, 10, 20) !== true) {
                missing.push('overlaps inclusive endpoint failed');
            }
            if (overlaps(1, null, 30, 40) !== true) {
                missing.push('overlaps open end failed');
            }
            if (overlaps(null, 10, 5, 15) !== false) {
                missing.push('overlaps null start should be false');
            }

            // intersection
            var inter = intersection(1, 10, 5, 15);
            if (!inter || inter.start !== 5 || inter.end !== 10) {
                missing.push('intersection(1,10,5,15) failed');
            }
            if (intersection(1, 10, 11, 20) !== null) {
                missing.push('intersection disjoint should be null');
            }
            var inter2 = intersection(1, null, 30, 40);
            if (!inter2 || inter2.start !== 30 || inter2.end !== 40) {
                missing.push('intersection open end failed');
            }

            // containsWeek
            if (containsWeek(5, 1, 10) !== true) {
                missing.push('containsWeek(5,1,10) !== true');
            }
            if (containsWeek('5', 1, 10) !== true) {
                missing.push('containsWeek string week failed');
            }
            if (containsWeek(53, 1, 10) !== false) {
                missing.push('containsWeek out of bounds should fail');
            }
            if (containsWeek(5, 1, null) !== true) {
                missing.push('containsWeek open end failed');
            }

            // weeksOverlap
            if (weeksOverlap(1, 10, 5, 15) !== true) {
                missing.push('weeksOverlap simple failed');
            }
            if (weeksOverlap(1, 10, 11, 20) !== false) {
                missing.push('weeksOverlap disjoint failed');
            }
            if (weeksOverlap(1, 10, 10, 20) !== true) {
                missing.push('weeksOverlap inclusive endpoint failed');
            }
            if (weeksOverlap(1, 10, 5, null) !== true) {
                missing.push('weeksOverlap open end failed');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[RangeUtils] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();