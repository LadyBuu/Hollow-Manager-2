/**
 * modules/academy/academy-teaching-collisions.js - Academy Teaching Collisions
 *
 * Path: js/modules/academy/academy-teaching-collisions.js
 *
 * Two families of query live in this module. They answer
 * different questions. Do not conflate them.
 *
 * FAMILY 1 — SLOT PREDICATES (busy / free):
 *
 *   isInstructorBusy(instructorId, day, startTime, duration,
 *                    startWeek, endWeek, options)
 *   isStudentBusy(studentId, day, startTime, duration,
 *                 startWeek, endWeek, options)
 *
 *   "Is this resource already occupied at this slot, across this
 *    week range?"
 *
 *   These are the AUTHORITATIVE busy/free predicates for the
 *   Academy. Both the write path (session creation) and the read
 *   path (the free-slots highlighter on the discipline grid) call
 *   these. That is what makes them agree by construction.
 *
 *   Scoping rules:
 *     - Instructor: academy-wide. Any session, in any discipline,
 *       taught by this instructor, in any week range, that
 *       overlaps the queried slot, makes them busy. Instructor
 *       commitments also count.
 *     - Student: academy-wide. Any occurrence whose studentIds
 *       contains this student, in any week range, that overlaps
 *       the queried slot, makes them busy.
 *
 *   The predicates are NOT discipline-scoped. An instructor who
 *   teaches English and Maths is busy in Maths at 11:00 Thursday
 *   when they are teaching English at 11:00 Thursday, because
 *   they are one person with one body. The discipline grid shows
 *   only English sessions, but the busy question is not scoped to
 *   English. That distinction is deliberate and is the bug this
 *   module exists to prevent.
 *
 * FAMILY 2 — OCCURRENCE COLLISION REPORT:
 *
 *   detectCollisions(week)
 *   detectCollisionsInOccurrences(week, occurrences)
 *   hasCollisionsFor(resourceType, resourceId, week)
 *
 *   "Does this WEEK's projected schedule already contain overlaps
 *    between occurrences for the same resource?"
 *
 *   This is a post-hoc diagnostic over a single week's projection.
 *   It reports what the current timetable contains; it does not
 *   answer "would this new session collide?" That is Family 1's
 *   job.
 *
 *   Family 2 is what a "check my timetable" button would call.
 *   Family 1 is what a "can I put a session here?" check calls.
 *
 * The two families share the same underlying projector output.
 * Family 1 slices it per slot; Family 2 walks it per week.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Occurrence projection. AcademyTeachingProjector owns it.
 *   - Weekly-hours validation. AcademyTeachingValidation owns it.
 *   - Mutations. Nothing in the schedule stack mutates here.
 *   - Instructor commitments. AcademyInstructorCommitments owns
 *     the store; this module reads it via
 *     getActiveCommitmentsForWeek.
 *
 * PURITY:
 *   Every function is a pure read. No storage writes, no DOM, no
 *   global state.
 *
 * RESOURCE NAMING:
 *   The predicate names (`isInstructorBusy`, `isStudentBusy`) use
 *   the word "busy" rather than "free." A busy question has a
 *   definite answer for any input; a free question implies
 *   everything else is a slot, which is not true. The highlighter
 *   inverts the predicate when it needs a "free" answer.
 *
 *   "Busy" is chosen over "occupied" or "committed" because it is
 *   the shortest word that covers sessions, commitments, and any
 *   other occurrence kind the projector emits. Sessions and
 *   commitments are both "the resource is not available."
 *
 * BUSY DEFINITION — THE OVERLAP PREDICATE:
 *   Two (day, hour-range) pairs overlap when they are on the same
 *   day and their [start, start + duration) windows intersect.
 *   Back-to-back sessions do NOT overlap: 9–10 and 10–11 are
 *   fine.
 *
 *   Two week ranges overlap when their [startWeek, endWeek]
 *   intervals intersect. A null endWeek is treated as +infinity.
 *   The boundary rule is inclusive on both ends: weeks 5–10 and
 *   10–20 overlap at week 10.
 *
 *   A resource is busy at a candidate slot when there exists at
 *   least one occurrence in their projection whose (day, hour)
 *   window AND (week) window both overlap the candidate's.
 *
 * EXCLUSIONS:
 *   Both predicates accept an optional `options.excludeGroupId`.
 *   An occurrence belonging to that group is skipped. This is how
 *   the write path avoids reporting the group being edited as a
 *   collision against itself.
 *
 * RETURN SHAPE:
 *   The predicates return a plain boolean. They do not return the
 *   conflicting occurrence. Callers that need the conflicting
 *   occurrence call `findInstructorConflict` / `findStudentConflict`
 *   below, which return the first conflict found (as an occurrence
 *   descriptor) or null.
 *
 *   Two-layer shape: the boolean is the common case (the
 *   highlighter asks it 84 times per grid); the finder is the
 *   rare case (the write path asks it once per session, and needs
 *   the detail to build a rejection message).
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyTeachingProjector
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.RangeUtils
 *
 * DEPENDENCIES (LAZY, used only if present):
 *   - window.AcademyInstructorCommitments
 *     When present, instructor commitments are folded into the
 *     instructor's occurrence list. When absent, only teaching
 *     sessions count. This is a soft dependency: the projector
 *     folds commitments into projectWeek when the commitments
 *     module is present, and returns sessions-only when it is
 *     not. The predicates here call the projector and inherit
 *     whatever it produced.
 */

(function() {
    'use strict';

    if (window.__academyTeachingCollisionsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Projector = window.AcademyTeachingProjector;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var RangeUtils = window.RangeUtils;

    var _missing = [];

    if (!Projector) {
        _missing.push('AcademyTeachingProjector (module)');
    } else {
        if (typeof Projector.projectWeek !== 'function') {
            _missing.push('AcademyTeachingProjector.projectWeek');
        }
        if (typeof Projector.projectForStudent !== 'function') {
            _missing.push('AcademyTeachingProjector.projectForStudent');
        }
        if (typeof Projector.projectForInstructor !== 'function') {
            _missing.push('AcademyTeachingProjector.projectForInstructor');
        }
    }

    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }

    if (!RangeUtils) {
        _missing.push('RangeUtils (module)');
    } else {
        if (typeof RangeUtils.containsWeek !== 'function') {
            _missing.push('RangeUtils.containsWeek');
        }
        if (typeof RangeUtils.weeksOverlap !== 'function') {
            _missing.push('RangeUtils.weeksOverlap');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingCollisions] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingCollisionsLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    /**
     * Parse a week via the canonical parser. Returns an integer in
     * [MIN_WEEK, MAX_WEEK], or null.
     */
    function parseWeek(week) {
        if (week === undefined || week === null || week === '') {
            return null;
        }
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) { return null; }
        if (parsed < CalendarConstants.MIN_WEEK ||
            parsed > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    /**
     * Parse an optional end week. A null / undefined / empty value
     * is treated as "open-ended" and returns null (which callers
     * pass to RangeUtils.weeksOverlap as +infinity).
     *
     * A malformed end week returns the sentinel `undefined`, which
     * callers use to reject the whole query rather than silently
     * treating a garbage value as +infinity.
     */
    function parseEndWeek(endWeek) {
        if (endWeek === undefined ||
            endWeek === null ||
            endWeek === '') {
            return null;
        }
        var parsed = parseWeek(endWeek);
        if (parsed === null) {
            return undefined;
        }
        return parsed;
    }

    /**
     * Convert an occurrence's week bounds into the pair
     * [startWeek, endWeek] with null for open-ended. Returns null
     * when the occurrence's bounds are malformed (which callers
     * treat as "this occurrence cannot be evaluated").
     */
    function readOccurrenceWeekRange(occurrence) {
        if (!occurrence || typeof occurrence !== 'object') {
            return null;
        }

        var start = parseWeek(occurrence.week !== undefined
            ? occurrence.week
            : occurrence.startWeek);

        // Occurrences from the projector carry `week` (the query
        // week), not `startWeek`/`endWeek`. The projector has
        // already filtered to occurrences active in the queried
        // week, so an occurrence is one week by construction.
        // The predicates here are called per-candidate-week; the
        // projector is asked for the week the caller cares about.
        //
        // To handle ranges, the predicate asks the projector
        // multiple weeks and unions the results. See
        // projectOccurrencesAcrossWeeks below.

        if (start === null) {
            return null;
        }
        return { week: start, startWeek: start, endWeek: start };
    }

    // ============================================================
    // PROJECTOR CALL — STRUCTURED RESULT
    // ============================================================
    //
    // The projector is mandatory. When it succeeds and returns an
    // array, the caller gets `{ ok: true, occurrences: [...] }`.
    // When it throws, or returns a non-array, the caller gets
    // `{ ok: false, message }`.
    //
    // A projector failure is not "no occurrences." It is a bug in
    // the projector, and the caller must be able to distinguish it.
    // The predicates below propagate the failure as a THROW, not
    // as `false`. A false negative here would place a session on
    // top of an existing one.

    function callProjector(fn, label) {
        var result;
        try {
            result = fn();
        } catch (e) {
            console.warn(
                '[AcademyTeachingCollisions] ' + label + ' threw:', e
            );
            throw new Error(
                '[AcademyTeachingCollisions] ' + label + ' threw: ' +
                (e && e.message ? e.message : e)
            );
        }

        if (!Array.isArray(result)) {
            console.warn(
                '[AcademyTeachingCollisions] ' + label +
                ' returned a non-array:', result
            );
            throw new Error(
                '[AcademyTeachingCollisions] ' + label +
                ' returned a non-array.'
            );
        }

        return result;
    }

    // ============================================================
    // TIME OVERLAP
    // ============================================================
    //
    // Two (day, hour-range) windows overlap when they are on the
    // same day and their [start, start + duration) windows
    // intersect. Back-to-back does not overlap.

    function timeWindowsOverlap(aDay, aStart, aDuration,
                                bDay, bStart, bDuration) {
        if (aDay !== bDay) { return false; }

        var aEnd = aStart + aDuration;
        var bEnd = bStart + bDuration;

        return aStart < bEnd && bStart < aEnd;
    }

    // ============================================================
    // WEEK RANGE OVERLAP
    // ============================================================
    //
    // Delegates to RangeUtils.weeksOverlap, which is the canonical
    // range predicate. A null endWeek is treated as +infinity.

    function weekRangesOverlap(aStart, aEnd, bStart, bEnd) {
        return RangeUtils.weeksOverlap(aStart, aEnd, bStart, bEnd);
    }

    // ============================================================
    // SLOT VALIDATION
    // ============================================================
    //
    // Shared argument validation for the predicates. Returns a
    // normalized descriptor, or throws on malformed input.

    function normalizeSlotArgs(
        day,
        startTime,
        duration,
        startWeek,
        endWeek
    ) {
        if (!isFiniteNumber(day) ||
            !Number.isInteger(day) ||
            day < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot day must be a ' +
                'positive integer.'
            );
        }

        if (!isFiniteNumber(startTime) ||
            !Number.isInteger(startTime) ||
            startTime < 0) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot startTime must be ' +
                'a non-negative integer.'
            );
        }

        if (!isFiniteNumber(duration) ||
            !Number.isInteger(duration) ||
            duration < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot duration must be ' +
                'a positive integer.'
            );
        }

        var startW = parseWeek(startWeek);
        if (startW === null) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot startWeek must be ' +
                'an integer in [' +
                CalendarConstants.MIN_WEEK + ', ' +
                CalendarConstants.MAX_WEEK + '].'
            );
        }

        var endW = parseEndWeek(endWeek);
        if (endW === undefined) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot endWeek must be ' +
                'null or an integer in [' +
                CalendarConstants.MIN_WEEK + ', ' +
                CalendarConstants.MAX_WEEK + '].'
            );
        }

        if (endW !== null && endW < startW) {
            throw new Error(
                '[AcademyTeachingCollisions] Slot endWeek cannot be ' +
                'before startWeek.'
            );
        }

        return {
            day: day,
            startTime: startTime,
            duration: duration,
            startWeek: startW,
            endWeek: endW
        };
    }

    // ============================================================
    // PROJECTOR CALLS ACROSS A WEEK RANGE
    // ============================================================
    //
    // The projector exposes per-week queries (projectWeek,
    // projectForStudent, projectForInstructor). To answer a
    // range question, we union the occurrences returned for every
    // week in the range.
    //
    // Cost: one projector call per week in the range. For a
    // candidate that runs 10 weeks, that is 10 calls. The
    // projector is backed by an in-memory model; the calls are
    // cheap.
    //
    // The result is a flat list of occurrences. Occurrences from
    // different weeks carry different `week` values, so the same
    // underlying session appearing at weeks 5 and 6 produces two
    // entries. The predicate does not dedupe: it only asks whether
    // any occurrence overlaps the candidate slot, and a duplicate
    // occurrence is still an overlap.
    //
    // CAP:
    //   A candidate range of one week calls the projector once.
    //   A candidate range of 52 weeks calls it 52 times. To
    //   prevent a pathological input from stalling the UI, the
    //   cap below rejects a range wider than the number of weeks
    //   the calendar supports, which is already the hard upper
    //   bound. The cap is here so an accidental bad range throws
    //   rather than looping.

    var MAX_RANGE_WEEKS = CalendarConstants.MAX_WEEK -
                          CalendarConstants.MIN_WEEK + 1;

    function projectOccurrencesAcrossWeeks(
        projectFn,
        projectArgs,
        rangeStart,
        rangeEnd
    ) {
        var end = (rangeEnd === null || rangeEnd === undefined)
            ? CalendarConstants.MAX_WEEK
            : rangeEnd;

        if (end < rangeStart) {
            throw new Error(
                '[AcademyTeachingCollisions] Range end is before ' +
                'range start.'
            );
        }

        var span = end - rangeStart + 1;
        if (span > MAX_RANGE_WEEKS) {
            throw new Error(
                '[AcademyTeachingCollisions] Range spans ' + span +
                ' weeks, which exceeds the calendar\'s maximum.'
            );
        }

        var result = [];
        for (var w = rangeStart; w <= end; w++) {
            var occurrences = callProjector(function() {
                return projectFn(projectArgs, w);
            }, 'projectWeek for week ' + w);

            for (var i = 0; i < occurrences.length; i++) {
                result.push(occurrences[i]);
            }
        }
        return result;
    }

    // ============================================================
    // SLOT PREDICATES — INSTRUCTOR
    // ============================================================

    /**
     * Is this instructor already occupied at the given slot, across
     * the given week range?
     *
     * ACADEMY-WIDE. This checks every discipline, every group, and
     * every week in the range. An instructor teaching English at
     * 11:00 Thursday is busy for a candidate Maths session at the
     * same slot. That is deliberate: one person, one body.
     *
     * @param {string} instructorId
     * @param {number} day        1..7
     * @param {number} startTime  hour, 0..23
     * @param {number} duration   hours, >= 1
     * @param {number} startWeek  1..52
     * @param {number|null} endWeek  1..52, or null for open-ended
     * @param {object} [options]
     * @param {string} [options.excludeGroupId]
     *   Skip occurrences belonging to this group. Used by the
     *   write path to avoid reporting the group being edited as a
     *   collision against itself.
     * @returns {boolean} true when the instructor is busy
     * @throws when the projector fails or arguments are malformed
     */
    function isInstructorBusy(
        instructorId,
        day,
        startTime,
        duration,
        startWeek,
        endWeek,
        options
    ) {
        if (!isNonEmptyString(instructorId)) {
            throw new Error(
                '[AcademyTeachingCollisions] isInstructorBusy ' +
                'requires an instructorId.'
            );
        }

        var slot = normalizeSlotArgs(
            day, startTime, duration, startWeek, endWeek
        );

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var occurrences = projectOccurrencesAcrossWeeks(
            function(args, week) {
                return Projector.projectForInstructor(args.id, week);
            },
            { id: String(instructorId) },
            slot.startWeek,
            slot.endWeek
        );

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (excludeGroupId !== null &&
                occ.groupId !== undefined &&
                occ.groupId !== null &&
                String(occ.groupId) === excludeGroupId) {
                continue;
            }

            if (!isFiniteNumber(occ.day) ||
                !isFiniteNumber(occ.startTime)) {
                continue;
            }

            var occDuration = isFiniteNumber(occ.duration) &&
                              occ.duration > 0
                ? Math.round(occ.duration)
                : 1;

            if (timeWindowsOverlap(
                slot.day, slot.startTime, slot.duration,
                occ.day, occ.startTime, occDuration
            )) {
                return true;
            }
        }

        return false;
    }

    /**
     * Find the first occurrence that makes the instructor busy.
     * Returns a descriptor object, or null when the instructor is
     * free.
     *
     * The descriptor is the raw occurrence the projector produced,
     * plus a `kind` field. Callers use this to build a rejection
     * message; they should not assume the occurrence is a session.
     */
    function findInstructorConflict(
        instructorId,
        day,
        startTime,
        duration,
        startWeek,
        endWeek,
        options
    ) {
        if (!isNonEmptyString(instructorId)) {
            throw new Error(
                '[AcademyTeachingCollisions] findInstructorConflict ' +
                'requires an instructorId.'
            );
        }

        var slot = normalizeSlotArgs(
            day, startTime, duration, startWeek, endWeek
        );

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var occurrences = projectOccurrencesAcrossWeeks(
            function(args, week) {
                return Projector.projectForInstructor(args.id, week);
            },
            { id: String(instructorId) },
            slot.startWeek,
            slot.endWeek
        );

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (excludeGroupId !== null &&
                occ.groupId !== undefined &&
                occ.groupId !== null &&
                String(occ.groupId) === excludeGroupId) {
                continue;
            }

            if (!isFiniteNumber(occ.day) ||
                !isFiniteNumber(occ.startTime)) {
                continue;
            }

            var occDuration = isFiniteNumber(occ.duration) &&
                              occ.duration > 0
                ? Math.round(occ.duration)
                : 1;

            if (timeWindowsOverlap(
                slot.day, slot.startTime, slot.duration,
                occ.day, occ.startTime, occDuration
            )) {
                return occ;
            }
        }

        return null;
    }

    // ============================================================
    // SLOT PREDICATES — STUDENT
    // ============================================================

    /**
     * Is this student already occupied at the given slot, across
     * the given week range?
     *
     * ACADEMY-WIDE. Any occurrence whose `studentIds` contains this
     * student counts. A student enrolled in English and Maths is
     * busy in Maths at 11:00 Thursday when they are in an English
     * session at 11:00 Thursday.
     *
     * @returns {boolean} true when the student is busy
     * @throws when the projector fails or arguments are malformed
     */
    function isStudentBusy(
        studentId,
        day,
        startTime,
        duration,
        startWeek,
        endWeek,
        options
    ) {
        if (!isNonEmptyString(studentId)) {
            throw new Error(
                '[AcademyTeachingCollisions] isStudentBusy requires ' +
                'a studentId.'
            );
        }

        var slot = normalizeSlotArgs(
            day, startTime, duration, startWeek, endWeek
        );

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var occurrences = projectOccurrencesAcrossWeeks(
            function(args, week) {
                return Projector.projectForStudent(args.id, week);
            },
            { id: String(studentId) },
            slot.startWeek,
            slot.endWeek
        );

        return anyOccurrenceHitsStudent(
            occurrences,
            slot,
            String(studentId),
            excludeGroupId
        );
    }

    /**
     * Find the first occurrence that makes the student busy.
     * Returns a descriptor object, or null when the student is
     * free.
     */
    function findStudentConflict(
        studentId,
        day,
        startTime,
        duration,
        startWeek,
        endWeek,
        options
    ) {
        if (!isNonEmptyString(studentId)) {
            throw new Error(
                '[AcademyTeachingCollisions] findStudentConflict ' +
                'requires a studentId.'
            );
        }

        var slot = normalizeSlotArgs(
            day, startTime, duration, startWeek, endWeek
        );

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var occurrences = projectOccurrencesAcrossWeeks(
            function(args, week) {
                return Projector.projectForStudent(args.id, week);
            },
            { id: String(studentId) },
            slot.startWeek,
            slot.endWeek
        );

        return firstOccurrenceHittingStudent(
            occurrences,
            slot,
            String(studentId),
            excludeGroupId
        );
    }

    function anyOccurrenceHitsStudent(
        occurrences,
        slot,
        studentId,
        excludeGroupId
    ) {
        return firstOccurrenceHittingStudent(
            occurrences, slot, studentId, excludeGroupId
        ) !== null;
    }

    function firstOccurrenceHittingStudent(
        occurrences,
        slot,
        studentId,
        excludeGroupId
    ) {
        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (excludeGroupId !== null &&
                occ.groupId !== undefined &&
                occ.groupId !== null &&
                String(occ.groupId) === excludeGroupId) {
                continue;
            }

            if (!Array.isArray(occ.studentIds)) { continue; }

            var contains = false;
            for (var s = 0; s < occ.studentIds.length; s++) {
                if (isNonEmptyString(occ.studentIds[s]) &&
                    String(occ.studentIds[s]) === studentId) {
                    contains = true;
                    break;
                }
            }
            if (!contains) { continue; }

            if (!isFiniteNumber(occ.day) ||
                !isFiniteNumber(occ.startTime)) {
                continue;
            }

            var occDuration = isFiniteNumber(occ.duration) &&
                              occ.duration > 0
                ? Math.round(occ.duration)
                : 1;

            if (timeWindowsOverlap(
                slot.day, slot.startTime, slot.duration,
                occ.day, occ.startTime, occDuration
            )) {
                return occ;
            }
        }
        return null;
    }

    // ============================================================
    // BATCH PREDICATES
    // ============================================================
    //
    // The free-slots highlighter asks the same question for every
    // cell on a grid. Batch predicates share the projector work
    // across all cells:
    //
    //   - Project the week ONCE per week in the candidate range.
    //   - For each occurrence, mark the cells it occupies.
    //   - The caller reads the cell map for each grid position.
    //
    // For an 84-cell grid over a 10-week range, this is 10
    // projector calls instead of 840. The per-cell answer is
    // identical to what the singular predicates would produce;
    // the batch functions exist so the highlighter's cost is
    // bounded by the range, not the grid.

    /**
     * Build a busy map for an instructor across a week range.
     *
     * The map is keyed `${day}:${hour}` and holds `true` for every
     * (day, hour) cell the instructor is occupied in, at ANY week
     * within the range.
     *
     * The caller interprets the map: a cell that is not present
     * is free; a cell that is present is busy.
     *
     * @returns {object} { [cellKey]: true }
     * @throws when the projector fails or arguments are malformed
     */
    function buildInstructorBusyMap(
        instructorId,
        startWeek,
        endWeek,
        options
    ) {
        if (!isNonEmptyString(instructorId)) {
            throw new Error(
                '[AcademyTeachingCollisions] buildInstructorBusyMap ' +
                'requires an instructorId.'
            );
        }

        var startW = parseWeek(startWeek);
        if (startW === null) {
            throw new Error(
                '[AcademyTeachingCollisions] buildInstructorBusyMap ' +
                'requires a valid startWeek.'
            );
        }

        var endW = parseEndWeek(endWeek);
        if (endW === undefined) {
            throw new Error(
                '[AcademyTeachingCollisions] buildInstructorBusyMap ' +
                'requires a valid endWeek or null.'
            );
        }
        if (endW !== null && endW < startW) {
            throw new Error(
                '[AcademyTeachingCollisions] buildInstructorBusyMap ' +
                'endWeek cannot be before startWeek.'
            );
        }

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var occurrences = projectOccurrencesAcrossWeeks(
            function(args, week) {
                return Projector.projectForInstructor(args.id, week);
            },
            { id: String(instructorId) },
            startW,
            endW
        );

        return buildBusyMapFromOccurrences(
            occurrences, excludeGroupId
        );
    }

    /**
     * Build a busy map for a set of students across a week range.
     *
     * A cell is marked busy when ANY of the students is occupied
     * there. This is the "all students must be free" question: the
     * caller wants a cell where the instructor is free AND every
     * listed student is free. Marking the union gives exactly
     * that, because a cell that is not in the union is free for
     * every student.
     *
     * @param {string[]} studentIds
     * @param {number} startWeek
     * @param {number|null} endWeek
     * @param {object} [options]
     * @returns {object} { [cellKey]: true }
     * @throws when the projector fails or arguments are malformed
     */
    function buildStudentsBusyMap(
        studentIds,
        startWeek,
        endWeek,
        options
    ) {
        if (!Array.isArray(studentIds)) {
            throw new Error(
                '[AcademyTeachingCollisions] buildStudentsBusyMap ' +
                'requires an array of studentIds.'
            );
        }

        var startW = parseWeek(startWeek);
        if (startW === null) {
            throw new Error(
                '[AcademyTeachingCollisions] buildStudentsBusyMap ' +
                'requires a valid startWeek.'
            );
        }

        var endW = parseEndWeek(endWeek);
        if (endW === undefined) {
            throw new Error(
                '[AcademyTeachingCollisions] buildStudentsBusyMap ' +
                'requires a valid endWeek or null.'
            );
        }
        if (endW !== null && endW < startW) {
            throw new Error(
                '[AcademyTeachingCollisions] buildStudentsBusyMap ' +
                'endWeek cannot be before startWeek.'
            );
        }

        options = isPlainObject(options) ? options : {};
        var excludeGroupId = isNonEmptyString(options.excludeGroupId)
            ? String(options.excludeGroupId)
            : null;

        var busyMap = Object.create(null);
        var seen = Object.create(null);

        for (var s = 0; s < studentIds.length; s++) {
            var sid = studentIds[s];
            if (!isNonEmptyString(sid)) { continue; }
            var key = String(sid);
            if (seen[key]) { continue; }
            seen[key] = true;

            var occurrences = projectOccurrencesAcrossWeeks(
                function(args, week) {
                    return Projector.projectForStudent(args.id, week);
                },
                { id: key },
                startW,
                endW
            );

            mergeBusyMap(
                busyMap,
                occurrences,
                excludeGroupId,
                key
            );
        }

        return busyMap;
    }

    function buildBusyMapFromOccurrences(occurrences, excludeGroupId) {
        var busyMap = Object.create(null);

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (excludeGroupId !== null &&
                occ.groupId !== undefined &&
                occ.groupId !== null &&
                String(occ.groupId) === excludeGroupId) {
                continue;
            }

            markOccurrenceCells(busyMap, occ);
        }

        return busyMap;
    }

    function mergeBusyMap(busyMap, occurrences, excludeGroupId, studentId) {
        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (excludeGroupId !== null &&
                occ.groupId !== undefined &&
                occ.groupId !== null &&
                String(occ.groupId) === excludeGroupId) {
                continue;
            }

            if (!Array.isArray(occ.studentIds)) { continue; }

            var contains = false;
            for (var s = 0; s < occ.studentIds.length; s++) {
                if (isNonEmptyString(occ.studentIds[s]) &&
                    String(occ.studentIds[s]) === studentId) {
                    contains = true;
                    break;
                }
            }
            if (!contains) { continue; }

            markOccurrenceCells(busyMap, occ);
        }
    }

    function markOccurrenceCells(busyMap, occ) {
        if (!isFiniteNumber(occ.day)) { return; }
        if (!isFiniteNumber(occ.startTime)) { return; }

        var duration = isFiniteNumber(occ.duration) && occ.duration > 0
            ? Math.round(occ.duration)
            : 1;

        for (var h = 0; h < duration; h++) {
            var hour = occ.startTime + h;
            if (hour < CalendarConstants.MIN_HOUR) { continue; }
            if (hour > CalendarConstants.MAX_HOUR) { break; }
            busyMap[occ.day + ':' + hour] = true;
        }
    }

    // ============================================================
    // OCCURRENCE COLLISION REPORT — FAMILY 2
    // ============================================================
    //
    // The remainder of this module is the pre-existing collision
    // reporter. It answers a different question from the slot
    // predicates above: "does this WEEK's projected schedule
    // already contain overlaps for the same resource?" It is a
    // diagnostic over the projected week, not a predicate about a
    // candidate slot.
    //
    // See the file header for the two-family distinction.

    function assertOccurrence(occ, index) {
        var where = (index === undefined || index === null)
            ? 'occurrence'
            : 'occurrence at index ' + index;

        if (!isPlainObject(occ)) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ': expected a plain object, got ' +
                (occ === null ? 'null' :
                 Array.isArray(occ) ? 'array' :
                 typeof occ) + '.'
            );
        }

        if (!isNonEmptyString(occ.sessionId)) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ': sessionId must be a non-empty string.'
            );
        }

        if (typeof occ.week !== 'number' ||
            !isFinite(occ.week) ||
            !Number.isInteger(occ.week) ||
            occ.week < 0) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): week must be a ' +
                'non-negative integer.'
            );
        }

        if (typeof occ.day !== 'number' ||
            !isFinite(occ.day) ||
            !Number.isInteger(occ.day) ||
            occ.day < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): day must be a ' +
                'positive integer.'
            );
        }

        if (typeof occ.startTime !== 'number' ||
            !isFinite(occ.startTime) ||
            !Number.isInteger(occ.startTime) ||
            occ.startTime < 0) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): startTime must ' +
                'be a non-negative integer.'
            );
        }

        if (typeof occ.duration !== 'number' ||
            !isFinite(occ.duration) ||
            !Number.isInteger(occ.duration) ||
            occ.duration < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): duration must be ' +
                'a positive integer.'
            );
        }
    }

    function getEndTime(occurrence) {
        return occurrence.startTime + occurrence.duration;
    }

    function occurrencesOverlap(a, b) {
        if (a.day !== b.day) { return false; }
        var aEnd = getEndTime(a);
        var bEnd = getEndTime(b);
        return a.startTime < bEnd && b.startTime < aEnd;
    }

    function indexByResource(occurrences, resourceType) {
        var groups = Object.create(null);

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (resourceType === 'student') {
                addOccurrenceForStudent(occ, groups);
            } else if (resourceType === 'instructor') {
                addOccurrenceForInstructor(occ, groups);
            } else if (resourceType === 'location') {
                addOccurrenceForLocation(occ, groups);
            }
        }

        return groups;
    }

    function addOccurrenceForStudent(occ, groups) {
        if (!Array.isArray(occ.studentIds)) {
            return;
        }
        for (var i = 0; i < occ.studentIds.length; i++) {
            var id = occ.studentIds[i];
            if (!isNonEmptyString(id)) { continue; }
            var key = 'student:' + id;
            if (!groups[key]) {
                groups[key] = {
                    resourceType: 'student',
                    resourceId: String(id),
                    occurrences: []
                };
            }
            groups[key].occurrences.push(occ);
        }
    }

    function addOccurrenceForInstructor(occ, groups) {
        var id = occ.instructorId;

        if (id === null || id === undefined) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' is missing an instructorId. The ' +
                'projector\'s occurrence contract requires every ' +
                'occurrence to name an instructor.'
            );
        }

        if (!isNonEmptyString(id)) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' has an invalid instructorId (' +
                JSON.stringify(id) + ').'
            );
        }

        var key = 'instructor:' + id;
        if (!groups[key]) {
            groups[key] = {
                resourceType: 'instructor',
                resourceId: String(id),
                occurrences: []
            };
        }
        groups[key].occurrences.push(occ);
    }

    function addOccurrenceForLocation(occ, groups) {
        var id = occ.locationId;

        if (id === null || id === undefined) {
            return;
        }

        if (!isNonEmptyString(id)) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' has an invalid locationId (' +
                JSON.stringify(id) + ').'
            );
        }

        var key = 'location:' + id;
        if (!groups[key]) {
            groups[key] = {
                resourceType: 'location',
                resourceId: String(id),
                occurrences: []
            };
        }
        groups[key].occurrences.push(occ);
    }

    function findCollisionsInGroup(group) {
        var occurrences = group.occurrences.slice();

        occurrences.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return String(a.sessionId).localeCompare(String(b.sessionId));
        });

        var collisions = [];

        var cluster = [];
        var clusterLatestEnd = -1;
        var clusterEarliestStart = -1;
        var clusterDay = -1;

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];

            var startsNewCluster = false;

            if (cluster.length === 0) {
                startsNewCluster = true;
            } else if (occ.day !== clusterDay) {
                startsNewCluster = true;
            } else if (occ.startTime >= clusterLatestEnd) {
                startsNewCluster = true;
            }

            if (startsNewCluster) {
                emitClusterIfCollision(
                    group, cluster, collisions
                );
                cluster = [occ];
                clusterLatestEnd = getEndTime(occ);
                clusterEarliestStart = occ.startTime;
                clusterDay = occ.day;
            } else {
                cluster.push(occ);
                var end = getEndTime(occ);
                if (end > clusterLatestEnd) {
                    clusterLatestEnd = end;
                }
            }
        }

        emitClusterIfCollision(group, cluster, collisions);

        return collisions;
    }

    function emitClusterIfCollision(group, cluster, out) {
        if (cluster.length < 2) { return; }

        var sessionIds = [];
        var earliestStart = Infinity;
        var latestEnd = -Infinity;

        for (var i = 0; i < cluster.length; i++) {
            var occ = cluster[i];
            sessionIds.push(occ.sessionId);

            if (occ.startTime < earliestStart) {
                earliestStart = occ.startTime;
            }
            var end = getEndTime(occ);
            if (end > latestEnd) {
                latestEnd = end;
            }
        }

        out.push({
            resourceType: group.resourceType,
            resourceId: group.resourceId,
            week: cluster[0].week,
            day: cluster[0].day,
            startTime: earliestStart,
            endTime: latestEnd,
            sessionIds: sessionIds,
            occurrences: cluster.slice()
        });
    }

    function detectCollisions(week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return {
                week: null,
                collisions: [],
                count: 0,
                hasAny: false
            };
        }

        var occurrences = callProjector(function() {
            return Projector.projectWeek(weekNum);
        }, 'projectWeek');

        return detectCollisionsInOccurrences(weekNum, occurrences);
    }

    function detectCollisionsInOccurrences(week, occurrences) {
        var weekNum = parseWeek(week);

        if (weekNum === null) {
            return {
                week: null,
                collisions: [],
                count: 0,
                hasAny: false
            };
        }

        if (!Array.isArray(occurrences)) {
            throw new Error(
                '[AcademyTeachingCollisions] ' +
                'detectCollisionsInOccurrences requires an array of ' +
                'occurrences. Got ' +
                (occurrences === null ? 'null' :
                 typeof occurrences) + '.'
            );
        }

        for (var v = 0; v < occurrences.length; v++) {
            assertOccurrence(occurrences[v], v);
        }

        var allCollisions = [];

        var resourceTypes = ['student', 'instructor', 'location'];
        for (var t = 0; t < resourceTypes.length; t++) {
            var groups = indexByResource(
                occurrences, resourceTypes[t]
            );
            var keys = Object.keys(groups);
            for (var k = 0; k < keys.length; k++) {
                var group = groups[keys[k]];
                var collisions = findCollisionsInGroup(group);
                for (var c = 0; c < collisions.length; c++) {
                    allCollisions.push(collisions[c]);
                }
            }
        }

        allCollisions.sort(function(a, b) {
            if (a.resourceType !== b.resourceType) {
                return a.resourceType < b.resourceType ? -1 : 1;
            }
            if (a.resourceId !== b.resourceId) {
                return a.resourceId < b.resourceId ? -1 : 1;
            }
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return 0;
        });

        return {
            week: weekNum,
            collisions: allCollisions,
            count: allCollisions.length,
            hasAny: allCollisions.length > 0
        };
    }

    /**
     * Convenience: check whether a specific resource has any
     * collisions in a given week.
     *
     * NAMING AND COST:
     *   The name says what it does: checks one resource for
     *   collisions. It reprojects the week on every call, because
     *   it delegates to detectCollisions.
     *
     *   Not for bulk UI loops. A caller that needs to check many
     *   resources for the same week should call detectCollisions
     *   once and filter the returned list.
     */
    function hasCollisionsFor(resourceType, resourceId, week) {
        if (!isNonEmptyString(resourceType) ||
            !isNonEmptyString(resourceId)) {
            return false;
        }
        if (resourceType !== 'student' &&
            resourceType !== 'instructor' &&
            resourceType !== 'location') {
            return false;
        }

        var report = detectCollisions(week);
        for (var i = 0; i < report.collisions.length; i++) {
            var c = report.collisions[i];
            if (c.resourceType === resourceType &&
                c.resourceId === String(resourceId)) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingCollisions = Object.freeze({
        // ---- Family 1: slot predicates ----

        isInstructorBusy: isInstructorBusy,
        isStudentBusy: isStudentBusy,

        findInstructorConflict: findInstructorConflict,
        findStudentConflict: findStudentConflict,

        // Batch predicates for the free-slots highlighter.
        buildInstructorBusyMap: buildInstructorBusyMap,
        buildStudentsBusyMap: buildStudentsBusyMap,

        // ---- Family 2: occurrence collision report ----

        detectCollisions: detectCollisions,
        detectCollisionsInOccurrences: detectCollisionsInOccurrences,
        hasCollisionsFor: hasCollisionsFor
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingCollisions;
        var missing = [];

        var required = [
            'isInstructorBusy',
            'isStudentBusy',
            'findInstructorConflict',
            'findStudentConflict',
            'buildInstructorBusyMap',
            'buildStudentsBusyMap',
            'detectCollisions',
            'detectCollisionsInOccurrences',
            'hasCollisionsFor'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            // Time overlap: back-to-back does not overlap.
            if (timeWindowsOverlap(1, 9, 1, 1, 10, 1) !== false) {
                missing.push('back-to-back flagged as overlapping');
            }

            // Time overlap: identical slots overlap.
            if (timeWindowsOverlap(1, 9, 1, 1, 9, 1) !== true) {
                missing.push('identical slots not flagged as overlapping');
            }

            // Time overlap: partial overlap is a collision.
            if (timeWindowsOverlap(1, 9, 2, 1, 10, 2) !== true) {
                missing.push('partial overlap not detected');
            }

            // Time overlap: different days never overlap.
            if (timeWindowsOverlap(1, 9, 2, 2, 9, 2) !== false) {
                missing.push('different days flagged as overlapping');
            }

            // RangeUtils delegation: weeks 5-10 and 10-20 overlap at 10.
            if (weekRangesOverlap(5, 10, 10, 20) !== true) {
                missing.push('inclusive week overlap not honoured');
            }

            // RangeUtils delegation: weeks 5-9 and 10-20 are disjoint.
            if (weekRangesOverlap(5, 9, 10, 20) !== false) {
                missing.push('disjoint week ranges flagged as overlapping');
            }

            // Open-ended ranges: 5-null overlaps 30-40.
            if (weekRangesOverlap(5, null, 30, 40) !== true) {
                missing.push('open-ended week overlap not honoured');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingCollisions] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
