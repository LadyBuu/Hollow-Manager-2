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
 *   - No domain knowledge beyond "weeks are bounded by
 *     CalendarConstants".
 *   - Dependencies: CalendarConstants, CalendarValidation (both
 *     MANDATORY and checked at load time).
 *   - These are the SINGLE SOURCE OF TRUTH for range predicates in
 *     the application. Every module that needs "does this interval
 *     contain this value" or "do these two intervals overlap" MUST
 *     delegate here. Do not reimplement per-module.
 *
 * OPEN-ENDED RANGES:
 *   `end === null` means "unbounded on the right" (ongoing). This
 *   matches the Academy teaching model's `endWeek: null` and the
 *   enrollment store's `endWeek: null`.
 *
 *   `undefined` is NOT treated as an open end. A missing or
 *   misspelled end field is a data error and is rejected by every
 *   predicate. If a caller wants an unbounded range, they must
 *   pass null explicitly.
 *
 *   A `start` of null, undefined, or any non-integer is "no range":
 *   every predicate returns false (or null for intersection).
 *
 * INVERTED RANGES:
 *   A range whose start is greater than its (non-null) end is also
 *   "no range". This is not an error; it is a defensive rejection
 *   of a corrupt record. `overlaps` and `intersection` therefore
 *   agree: an inverted range does not overlap anything, and its
 *   intersection with anything is null.
 *
 *   Without this rule, a single record with start > end would
 *   appear to overlap every neighbouring range, producing phantom
 *   conflicts throughout the teaching model.
 *
 * INCLUSIVE ENDS:
 *   All bounds are inclusive on both ends. [1, 10] contains weeks
 *   1 through 10. Overlap at a shared endpoint counts:
 *   [1, 10] and [10, 20] overlap at week 10.
 *
 * WEEK-TYPED vs GENERIC:
 *   The generic forms (contains, overlaps, intersection) work on
 *   any integer interval with null-as-open-end. They do not
 *   validate that start and end are within a specific calendar.
 *
 *   The week-typed forms (containsWeek, weeksOverlap) parse every
 *   bound through CalendarValidation.parseWeek first, so a bound
 *   outside [MIN_WEEK, MAX_WEEK] is rejected. containsWeek returns
 *   false; weeksOverlap returns false. Both are strict: a bound of
 *   0 on either side is rejected consistently.
 *
 * WHY THIS MODULE EXISTS:
 *   The Academy module accumulated nine independent implementations
 *   of the same two predicates, each with slightly different
 *   blank-bound handling. Consolidating them here is what makes
 *   the semantics consistent across the teaching model.
 *
 * NOT THIS MODULE:
 *   - Input parsing and validation of week strings is
 *     CalendarValidation's concern. This module calls into it.
 *   - Persistence, mutation, projection, or rendering.
 *   - Any domain-specific concept (enrolment, class-discipline,
 *     teaching group, session).
 *
 * USAGE:
 *   var R = window.RangeUtils;
 *
 *   R.contains(5, 1, 10);           // true
 *   R.contains(15, 1, 10);          // false
 *   R.contains(5, 1, null);         // true (open end)
 *   R.contains(5, 10, 1);           // false (inverted range)
 *
 *   R.overlaps(1, 10, 5, 15);       // true
 *   R.overlaps(1, 10, 11, 20);      // false
 *   R.overlaps(1, 10, 10, 20);      // true (inclusive)
 *   R.overlaps(1, null, 30, 40);    // true (open end)
 *   R.overlaps(10, 1, 0, 20);       // false (inverted first range)
 *
 *   R.intersection(1, 10, 5, 15);   // { start: 5, end: 10 }
 *   R.intersection(1, 10, 11, 20);  // null
 *   R.intersection(10, 1, 0, 20);   // null (inverted first range)
 *
 *   R.containsWeek(5, 1, 10);       // true
 *   R.containsWeek(53, 1, null);    // false (week out of bounds)
 *   R.weeksOverlap(1, 10, 5, null); // true
 *   R.weeksOverlap(0, 10, 5, 15);   // false (start out of bounds)
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

    // Mark loaded immediately so a second attempt no-ops. The
    // actual throw is deferred until after the API has been
    // exposed, so callers can inspect the broken state.
    window.__rangeUtilsLoaded = true;

    if (_missing.length > 0) {
        window.RangeUtils = Object.freeze({
            _loadFailed: true,
            _missing: _missing.slice()
        });
        throw new Error(
            '[RangeUtils] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Is this a usable finite integer endpoint?
     *
     * Number.isInteger already rejects NaN and ±Infinity, so a
     * separate isFinite check is redundant.
     */
    function isFiniteInteger(value) {
        return typeof value === 'number' && Number.isInteger(value);
    }

    /**
     * Normalise an "end" endpoint.
     *
     *   - null          -> Infinity (unbounded on the right)
     *   - finite integer -> value
     *   - anything else  -> null (invalid; caller rejects)
     *
     * Note that `undefined` is NOT treated as an open end.
     */
    function normaliseEnd(end) {
        if (end === null) {
            return Infinity;
        }
        if (!isFiniteInteger(end)) {
            return null;
        }
        return end;
    }

    /**
     * Normalise a "start" endpoint.
     *
     *   - finite integer -> value
     *   - anything else  -> null (invalid; caller rejects)
     */
    function normaliseStart(start) {
        if (!isFiniteInteger(start)) {
            return null;
        }
        return start;
    }

    /**
     * Parse a range as a whole: both endpoints must be valid, and
     * start must be <= end (inverted ranges are rejected).
     *
     * Returns:
     *   { start: number, end: number }  on success
     *   null                             on any failure
     *
     * The returned `end` is Infinity for open-ended ranges.
     */
    function parseRange(start, end) {
        var s = normaliseStart(start);
        if (s === null) { return null; }

        var e = normaliseEnd(end);
        if (e === null) { return null; }

        if (s > e) { return null; }

        return { start: s, end: e };
    }

    // ============================================================
    // GENERIC PREDICATES
    // ============================================================

    /**
     * Does the range [start, end] contain the value?
     *
     * SEMANTICS:
     *   - Both bounds inclusive.
     *   - `end === null` means "unbounded on the right".
     *   - `undefined` end is rejected (not treated as unbounded).
     *   - A start > end (inverted range) contains nothing.
     *   - A null or non-integer start returns false.
     *   - A null `value` or non-integer `value` returns false.
     *   - A non-integer non-null `end` returns false.
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

        var range = parseRange(start, end);
        if (range === null) {
            return false;
        }

        return value >= range.start && value <= range.end;
    }

    /**
     * Do the ranges [startA, endA] and [startB, endB] overlap?
     *
     * SEMANTICS:
     *   - Both bounds inclusive.
     *   - `end === null` means "unbounded on the right".
     *   - `undefined` end is rejected.
     *   - Inverted ranges (start > end) do not overlap anything.
     *   - A null or non-integer start on either side returns false.
     *   - A non-integer non-null end on either side returns false.
     *
     * Inclusive overlap: [1, 10] and [10, 20] DO overlap at week 10.
     *
     * @returns {boolean}
     */
    function overlaps(startA, endA, startB, endB) {
        var a = parseRange(startA, endA);
        if (a === null) { return false; }

        var b = parseRange(startB, endB);
        if (b === null) { return false; }

        // Two intervals overlap iff startA <= endB AND startB <= endA.
        return a.start <= b.end && b.start <= a.end;
    }

    /**
     * Return the intersection of [startA, endA] and [startB, endB],
     * or null when they do not overlap.
     *
     * SEMANTICS:
     *   - Both bounds inclusive.
     *   - `end === null` means "unbounded on the right".
     *   - `undefined` end is rejected.
     *   - Inverted ranges return null.
     *   - The returned `end` is a finite integer when either input
     *     has a finite end. If both ends are null, the returned
     *     `end` is null (unbounded).
     *   - A null or non-integer start on either side returns null.
     *
     * LIMITATION:
     *   Returns null for both "no overlap" and "invalid input". A
     *   caller that needs to distinguish must validate its inputs
     *   before calling (e.g. via contains() with a known probe, or
     *   by checking the endpoints itself).
     *
     * @returns {object|null} { start, end } or null
     */
    function intersection(startA, endA, startB, endB) {
        var a = parseRange(startA, endA);
        if (a === null) { return null; }

        var b = parseRange(startB, endB);
        if (b === null) { return null; }

        var start = a.start > b.start ? a.start : b.start;
        var end = a.end < b.end ? a.end : b.end;

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
    // These parse every bound through CalendarValidation.parseWeek,
    // so bounds outside [MIN_WEEK, MAX_WEEK] are rejected
    // consistently. containsWeek and weeksOverlap therefore agree
    // on what constitutes a valid bound.

    /**
     * Parse a week-typed start bound. Returns the parsed integer,
     * or null if invalid.
     */
    function parseWeekStart(value) {
        var parsed = CalendarValidation.parseWeek(value);
        if (parsed === null) { return null; }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) { return null; }
        return parsed;
    }

    /**
     * Parse a week-typed end bound. `null` means unbounded (Infinity).
     * Anything else must parse as a valid week.
     */
    function parseWeekEnd(value) {
        if (value === null) {
            return Infinity;
        }
        return parseWeekStart(value);
    }

    /**
     * Does the week range [startWeek, endWeek] contain the given
     * week?
     *
     * SEMANTICS:
     *   - `week` is validated via CalendarValidation.parseWeek.
     *   - `startWeek` and `endWeek` are parsed as week-typed bounds:
     *     both must be integers in [MIN_WEEK, MAX_WEEK], or null
     *     for an open end. A start of 0 is rejected.
     *   - Inverted ranges contain nothing.
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

        var s = parseWeekStart(startWeek);
        if (s === null) { return false; }

        var e = parseWeekEnd(endWeek);
        if (e === null) { return false; }

        if (s > e) { return false; }

        return w >= s && w <= e;
    }

    /**
     * Do the two week ranges [startA, endA] and [startB, endB]
     * overlap?
     *
     * SEMANTICS:
     *   - Every non-null bound must parse as a week in
     *     [MIN_WEEK, MAX_WEEK]. A start of 0 or an end of 53 is
     *     rejected.
     *   - `end === null` means "unbounded on the right".
     *   - Inverted ranges do not overlap anything.
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

        if (sA > eA || sB > eB) { return false; }

        return sA <= eB && sB <= eA;
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
        var failures = [];

        var required = [
            'contains',
            'overlaps',
            'intersection',
            'containsWeek',
            'weeksOverlap'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        if (failures.length > 0) {
            throw new Error(
                '[RangeUtils] Verification failed: ' +
                failures.join(', ')
            );
        }

        // Smoke tests. A failure here throws after the API has
        // already been exposed, so callers that try to use the
        // module will crash loudly rather than quietly getting
        // wrong answers.

        try {
            // ---- contains ----
            if (contains(5, 1, 10) !== true) {
                failures.push('contains(5,1,10) should be true');
            }
            if (contains(15, 1, 10) !== false) {
                failures.push('contains(15,1,10) should be false');
            }
            if (contains(10, 1, 10) !== true) {
                failures.push('contains inclusive end');
            }
            if (contains(5, 1, null) !== true) {
                failures.push('contains open end');
            }
            if (contains(5, null, 10) !== false) {
                failures.push('contains null start should be false');
            }
            if (contains(null, 1, 10) !== false) {
                failures.push('contains null value should be false');
            }
            if (contains(5, 10, 1) !== false) {
                failures.push('contains inverted range should be false');
            }
            if (contains(5, 1, undefined) !== false) {
                failures.push('contains undefined end should be false');
            }

            // ---- overlaps ----
            if (overlaps(1, 10, 5, 15) !== true) {
                failures.push('overlaps simple');
            }
            if (overlaps(1, 10, 11, 20) !== false) {
                failures.push('overlaps disjoint');
            }
            if (overlaps(1, 10, 10, 20) !== true) {
                failures.push('overlaps inclusive endpoint');
            }
            if (overlaps(1, null, 30, 40) !== true) {
                failures.push('overlaps open end');
            }
            if (overlaps(null, 10, 5, 15) !== false) {
                failures.push('overlaps null start should be false');
            }
            if (overlaps(10, 1, 0, 20) !== false) {
                failures.push('overlaps inverted first range should be false');
            }
            if (overlaps(0, 20, 10, 1) !== false) {
                failures.push('overlaps inverted second range should be false');
            }
            if (overlaps(1, undefined, 5, 15) !== false) {
                failures.push('overlaps undefined end should be false');
            }

            // ---- intersection ----
            var inter = intersection(1, 10, 5, 15);
            if (!inter || inter.start !== 5 || inter.end !== 10) {
                failures.push('intersection(1,10,5,15)');
            }
            if (intersection(1, 10, 11, 20) !== null) {
                failures.push('intersection disjoint should be null');
            }
            var inter2 = intersection(1, null, 30, 40);
            if (!inter2 || inter2.start !== 30 || inter2.end !== 40) {
                failures.push('intersection open end');
            }
            if (intersection(10, 1, 0, 20) !== null) {
                failures.push('intersection inverted should be null');
            }

            // ---- containsWeek ----
            if (containsWeek(5, 1, 10) !== true) {
                failures.push('containsWeek(5,1,10)');
            }
            if (containsWeek('5', 1, 10) !== true) {
                failures.push('containsWeek string week');
            }
            // This case actually exercises the bounds check: 53
            // is within the range [1, null] as an integer, so the
            // only way it returns false is if the bounds check
            // rejects 53. The previous test (containsWeek(53,1,10))
            // passed trivially because 53 > 10.
            if (containsWeek(53, 1, null) !== false) {
                failures.push('containsWeek out-of-bounds week');
            }
            if (containsWeek(5, 1, null) !== true) {
                failures.push('containsWeek open end');
            }
            if (containsWeek(5, 0, 10) !== false) {
                failures.push('containsWeek start below MIN_WEEK');
            }
            if (containsWeek(5, 10, 1) !== false) {
                failures.push('containsWeek inverted should be false');
            }

            // ---- weeksOverlap ----
            if (weeksOverlap(1, 10, 5, 15) !== true) {
                failures.push('weeksOverlap simple');
            }
            if (weeksOverlap(1, 10, 11, 20) !== false) {
                failures.push('weeksOverlap disjoint');
            }
            if (weeksOverlap(1, 10, 10, 20) !== true) {
                failures.push('weeksOverlap inclusive endpoint');
            }
            if (weeksOverlap(1, 10, 5, null) !== true) {
                failures.push('weeksOverlap open end');
            }
            if (weeksOverlap(0, 10, 5, 15) !== false) {
                failures.push('weeksOverlap start below MIN_WEEK');
            }
            if (weeksOverlap(10, 1, 0, 20) !== false) {
                failures.push('weeksOverlap inverted should be false');
            }

            // ---- cross-predicate agreement ----
            // containsWeek and weeksOverlap must agree on bad bounds.
            if (containsWeek(5, 0, 10) !== false ||
                weeksOverlap(0, 10, 5, 15) !== false) {
                failures.push(
                    'containsWeek / weeksOverlap disagree on bad start'
                );
            }

        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            throw new Error(
                '[RangeUtils] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
