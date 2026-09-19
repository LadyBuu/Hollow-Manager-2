/**
 * modules/academy/academy-teaching-projector.js - Academy Teaching Projector
 *
 * Path: js/modules/academy/academy-teaching-projector.js
 *
 * Persisted teaching relationships → weekly occurrences.
 *
 * WHAT THIS MODULE OWNS:
 *   - Reading the persisted teaching data (class-disciplines,
 *     enrolments, teaching groups, teaching sessions).
 *   - Computing which occurrences exist in a given week, by
 *     intersecting every applicable window.
 *   - Projecting the result as a flat, read-only list of
 *     Occurrence objects.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Any persisted state. It reads only.
 *   - Any mutation. It never touches a store.
 *   - Any collision detection. AcademyTeachingCollisions consumes
 *     the projector's output.
 *   - Any validation. AcademyTeachingValidation consumes the
 *     projector's output.
 *   - Any display formatting. AcademyCalendarAggregator consumes
 *     the projector's output.
 *   - Any UI concerns. This module knows nothing about the DOM.
 *
 * THE MODEL:
 *
 *   A persisted teaching relationship exists as:
 *
 *     ClassDiscipline     a class offering a discipline, ranged
 *     Enrolment           a student's participation, ranged
 *     TeachingGroup       students with an instructor, ranged
 *       members[]         each with a ranged window
 *     TeachingSession     a recurring meeting, ranged
 *
 *   An OCCURRENCE is one meeting of one teaching group, in one
 *   week, at a specific day and time and location, together with
 *   the set of students who were actually present.
 *
 *   The projector's job is to answer:
 *
 *     "For week W, what are all the meetings that actually happen?"
 *
 *   A meeting "actually happens" when the week falls inside the
 *   intersection of every applicable window:
 *
 *     class-discipline window
 *       ∩ group window
 *       ∩ session window
 *
 *   And, per student:
 *
 *     ∩ enrolment window
 *       ∩ membership window
 *
 *   The intersection is the model. Nothing is duplicated in
 *   storage; every layer carries only its own range.
 *
 * WHY ONE PROJECTION MODULE:
 *   Every consumer of schedules needs the same answer to "what
 *   exists this week?" — the student calendar, the instructor
 *   calendar, the location calendar, the collision detector, the
 *   weekly-hours validator. Before this module, each consumer did
 *   its own intersection and they drifted. Now there is one
 *   projector and every consumer filters its output.
 *
 * RANGE SEMANTICS:
 *   - All ranges are inclusive on both ends.
 *   - endWeek === null means "ongoing" (unbounded on the right).
 *   - Weeks are integers in [MIN_WEEK, MAX_WEEK].
 *
 * RANGE PREDICATES:
 *   The range question — "does this range contain this week" and
 *   "do these two ranges overlap" — is owned by window.RangeUtils,
 *   which is the canonical range-predicate module for the whole
 *   application. This projector delegates to RangeUtils.
 *
 *   `rangeContainsWeek` and `rangesOverlap` remain exported because
 *   external callers depend on them. They are thin wrappers over
 *   RangeUtils.containsWeek and RangeUtils.weeksOverlap
 *   respectively. The docstrings on each wrapper name RangeUtils
 *   as the owner of the semantics. Do not reimplement the range
 *   math here; it lives in one place, on purpose.
 *
 * CLASS-DISCIPLINE READS:
 *   The class-discipline marker store has two modules: a mutation
 *   module (AcademyClassDisciplines) and a read module
 *   (AcademyClassDisciplinesQueries). This projector reads through
 *   the read module. It has no reason to reach for the mutation
 *   module; a projection that walked the writer would be reading
 *   through a surface that has no business existing on the read
 *   path.
 *
 *   The single read the projector performs is `isActiveInWeek`,
 *   which reads the DISCIPLINE's window (the marker has no window).
 *   That read is a query, and it lives on the queries module.
 *
 * OCCURRENCE SHAPE:
 *
 *   {
 *     sessionId,     string
 *     groupId,       string
 *     classId,       string
 *     disciplineId,  string
 *     instructorId,  string | null
 *     week,          number
 *     day,           number  (1-7)
 *     startTime,     number  (0-23)
 *     duration,      number  (hours, >= 1)
 *     locationId,    string | null
 *     studentIds     array of strings
 *   }
 *
 *   The studentIds list contains only students whose enrolment
 *   window AND membership window cover the requested week. A
 *   student whose enrolment has ended is not in the list, even
 *   though the session and the group might still be running.
 *
 *   The occurrence represents one group-session-week with its
 *   effective roster. It is not one row per student; consumers
 *   that want per-student projections filter the studentIds list.
 *
 * DETERMINISM:
 *   The output is a deterministic list. Occurrences are sorted by
 *   (day, startTime, sessionId). This is the canonical order used
 *   by every consumer. Sorting is not left to callers.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.RangeUtils
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyEnrolments
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 */

(function() {
    'use strict';

    if (window.__academyTeachingProjectorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var RangeUtils = window.RangeUtils;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;

    var _missing = [];

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!RangeUtils ||
        typeof RangeUtils.contains !== 'function') {
        _missing.push('RangeUtils.contains');
    }
    if (!RangeUtils ||
        typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!RangeUtils ||
        typeof RangeUtils.weeksOverlap !== 'function') {
        _missing.push('RangeUtils.weeksOverlap');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.isActiveInWeek !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.isActiveInWeek');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.isEnrolledInWeek !== 'function') {
        _missing.push('AcademyEnrolments.isEnrolledInWeek');
    }
    if (!AcademyTeachingGroups) {
        _missing.push('AcademyTeachingGroups (module)');
    } else {
        if (typeof AcademyTeachingGroups.getAllGroups !== 'function') {
            _missing.push('AcademyTeachingGroups.getAllGroups');
        }
        if (typeof AcademyTeachingGroups.isMemberOfGroup !== 'function') {
            _missing.push('AcademyTeachingGroups.isMemberOfGroup');
        }
    }
    if (!AcademyTeachingSessions) {
        _missing.push('AcademyTeachingSessions (module)');
    } else {
        if (typeof AcademyTeachingSessions.getAllSessions !== 'function') {
            _missing.push('AcademyTeachingSessions.getAllSessions');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingProjector] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingProjectorLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

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

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    // ============================================================
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================
    //
    // The range question is owned by RangeUtils. The two functions
    // below are delegating wrappers:
    //
    //   rangeContains(week, start, end)
    //     → RangeUtils.contains(week, start, end)
    //
    //   rangeContainsWeek(start, end, week)  [exported]
    //     → RangeUtils.containsWeek(week, start, end)
    //
    // The wrappers exist because the projector's internal call sites
    // read more naturally as `rangeContains(week, start, end)`, and
    // because `rangeContainsWeek` and `rangesOverlap` are part of
    // this module's public surface, consumed by collision detection
    // and validation. Delegation keeps the semantics identical
    // across the whole application.

    /**
     * Does [start, end] contain the given week?
     *
     * Delegates to RangeUtils.contains. end === null means ongoing.
     * Both bounds are inclusive.
     */
    function rangeContains(week, start, end) {
        return RangeUtils.contains(week, start, end);
    }

    // ============================================================
    // MAIN ENTRY POINT
    // ============================================================

    /**
     * Project all teaching occurrences for a given week.
     *
     * @param {number|string} week
     * @returns {array} Sorted array of Occurrence objects. Empty
     *   when the week is invalid or no relationships produce
     *   occurrences that week.
     */
    function projectWeek(week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var groups = AcademyTeachingGroups.getAllGroups();
        if (!Array.isArray(groups) || groups.length === 0) {
            return [];
        }

        var occurrences = [];

        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!isPlainObject(group)) { continue; }

            // The group's own window.
            if (!rangeContains(weekNum, group.startWeek, group.endWeek)) {
                continue;
            }

            // The class-discipline window. A group whose class or
            // discipline has ended does not project.
            if (!classDisciplineActiveInWeek(
                group.classId, group.disciplineId, weekNum
            )) {
                continue;
            }

            // The members of this group who were enrolled and
            // members during this week.
            var studentIds = activeStudentsForGroup(group, weekNum);

            // Sessions belonging to this group.
            var sessions = AcademyTeachingSessions.getSessionsForGroup(
                group.id
            );
            if (!Array.isArray(sessions)) { continue; }

            for (var s = 0; s < sessions.length; s++) {
                var session = sessions[s];
                if (!isPlainObject(session)) { continue; }

                if (!rangeContains(
                    weekNum, session.startWeek, session.endWeek
                )) {
                    continue;
                }

                occurrences.push(buildOccurrence(
                    session, group, weekNum, studentIds
                ));
            }
        }

        sortOccurrences(occurrences);
        return occurrences;
    }

    // ============================================================
    // PER-GROUP PROJECTION HELPERS
    // ============================================================

    function classDisciplineActiveInWeek(classId, disciplineId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return false;
        }
        return AcademyClassDisciplinesQueries.isActiveInWeek(
            classId, disciplineId, week
        );
    }

    /**
     * Return the student IDs that are members of the group AND
     * enrolled in the group's class-discipline during the given
     * week.
     *
     * Membership and enrolment are separate facts; both must
     * contain the week for a student to appear.
     */
    function activeStudentsForGroup(group, week) {
        if (!isPlainObject(group) ||
            !Array.isArray(group.members)) {
            return [];
        }

        var classId = group.classId;
        var disciplineId = group.disciplineId;

        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < group.members.length; i++) {
            var member = group.members[i];
            if (!isPlainObject(member)) { continue; }

            var charId = member.characterId;
            if (!isNonEmptyString(charId)) { continue; }

            // Membership window covers this week?
            if (!rangeContains(week, member.startWeek, member.endWeek)) {
                continue;
            }

            // Enrolment window covers this week?
            if (!AcademyEnrolments.isEnrolledInWeek(
                charId, classId, disciplineId, week
            )) {
                continue;
            }

            result.push(String(charId));
        }

        // Deterministic order for the occurrence's studentIds list.
        result.sort();
        return result;
    }

    function buildOccurrence(session, group, week, studentIds) {
        return {
            sessionId: session.id,
            groupId: group.id,
            classId: group.classId,
            disciplineId: group.disciplineId,
            instructorId: group.instructorId || null,

            week: week,
            day: session.day,
            startTime: session.startTime,
            duration: session.duration,
            locationId: session.locationId || null,

            studentIds: studentIds
        };
    }

    // ============================================================
    // SORTING
    // ============================================================

    function sortOccurrences(occurrences) {
        occurrences.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return String(a.sessionId).localeCompare(String(b.sessionId));
        });
    }

    // ============================================================
    // FILTERED PROJECTIONS
    // ============================================================
    //
    // These are thin filters over projectWeek. They exist so
    // consumers do not have to walk the full list when they only
    // care about one entity. Every consumer is still reading the
    // same underlying projection, computed the same way.

    /**
     * Occurrences that involve a specific student in a given week.
     */
    function projectForStudent(studentId, week) {
        if (!isNonEmptyString(studentId)) { return []; }
        var target = String(studentId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            for (var j = 0; j < occ.studentIds.length; j++) {
                if (occ.studentIds[j] === target) {
                    result.push(occ);
                    break;
                }
            }
        }
        return result;
    }

    /**
     * Occurrences taught by a specific instructor in a given week.
     */
    function projectForInstructor(instructorId, week) {
        if (!isNonEmptyString(instructorId)) { return []; }
        var target = String(instructorId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (occ.instructorId !== null &&
                String(occ.instructorId) === target) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Occurrences held at a specific location in a given week.
     */
    function projectForLocation(locationId, week) {
        if (!isNonEmptyString(locationId)) { return []; }
        var target = String(locationId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (occ.locationId !== null &&
                String(occ.locationId) === target) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Occurrences belonging to a specific class in a given week.
     */
    function projectForClass(classId, week) {
        if (!isNonEmptyString(classId)) { return []; }
        var target = String(classId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (String(occ.classId) === target) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Occurrences belonging to a specific teaching group in a
     * given week. This is the group's own projected schedule.
     */
    function projectForGroup(groupId, week) {
        if (!isNonEmptyString(groupId)) { return []; }
        var target = String(groupId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (String(occ.groupId) === target) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Occurrences in a given week belonging to a specific
     * (classId, disciplineId) pair. Used by the weekly-hours
     * validator to compute per-discipline scheduled minutes.
     */
    function projectForClassDiscipline(classId, disciplineId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return [];
        }
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (String(occ.classId) === targetClass &&
                String(occ.disciplineId) === targetDiscipline) {
                result.push(occ);
            }
        }
        return result;
    }

    // ============================================================
    // RANGE HELPERS - PUBLIC
    // ============================================================
    //
    // These two functions are part of the projector's public
    // surface. They exist so that consumers of the projector do
    // not reimplement the range containment or overlap logic; they
    // delegate to RangeUtils, which owns the semantics.
    //
    // Do not add logic here. The bodies are the delegate calls and
    // nothing else. If a caller needs a different predicate, add it
    // to RangeUtils and delegate from there, or open-code the
    // caller's own check — but do not grow these wrappers.

    /**
     * Does [start, end] contain the given week?
     * end === null means ongoing.
     *
     * Delegates to RangeUtils.containsWeek. Exposed so that
     * collision detection, validation, and the calendar
     * aggregator all get the same answer from the same owner.
     */
    function rangeContainsWeek(start, end, week) {
        return RangeUtils.containsWeek(week, start, end);
    }

    /**
     * Do two ranges overlap? end === null means ongoing.
     *
     * Delegates to RangeUtils.weeksOverlap. Overlap here means
     * "there exists a week contained by both." Both ends
     * inclusive.
     */
    function rangesOverlap(startA, endA, startB, endB) {
        return RangeUtils.weeksOverlap(startA, endA, startB, endB);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingProjector = Object.freeze({
        // Full projection
        projectWeek: projectWeek,

        // Filtered projections
        projectForStudent: projectForStudent,
        projectForInstructor: projectForInstructor,
        projectForLocation: projectForLocation,
        projectForClass: projectForClass,
        projectForGroup: projectForGroup,
        projectForClassDiscipline: projectForClassDiscipline,

        // Range helpers (delegating wrappers over RangeUtils)
        rangeContainsWeek: rangeContainsWeek,
        rangesOverlap: rangesOverlap
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingProjector;
        var missing = [];

        var required = [
            'projectWeek',
            'projectForStudent',
            'projectForInstructor',
            'projectForLocation',
            'projectForClass',
            'projectForGroup',
            'projectForClassDiscipline',
            'rangeContainsWeek',
            'rangesOverlap'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke tests on the two exported delegating wrappers.
        // These exercise the delegation and confirm the RangeUtils
        // semantics are what the projector's consumers expect.
        try {
            // rangeContainsWeek — inclusive bounds, null end means ongoing.
            if (rangeContainsWeek(1, 10, 5) !== true) {
                missing.push('rangeContainsWeek(1,10,5) !== true');
            }
            if (rangeContainsWeek(1, 10, 10) !== true) {
                missing.push('rangeContainsWeek inclusive endWeek not honoured');
            }
            if (rangeContainsWeek(1, 10, 11) !== false) {
                missing.push('rangeContainsWeek(1,10,11) !== false');
            }
            if (rangeContainsWeek(1, null, 52) !== true) {
                missing.push('rangeContainsWeek null endWeek not treated as ongoing');
            }

            // rangesOverlap — inclusive endpoints, null end means ongoing.
            if (rangesOverlap(1, 10, 5, 15) !== true) {
                missing.push('rangesOverlap missed a simple overlap');
            }
            if (rangesOverlap(1, 10, 11, 20) !== false) {
                missing.push('rangesOverlap found an overlap that does not exist');
            }
            if (rangesOverlap(1, 10, 10, 20) !== true) {
                missing.push('rangesOverlap missed inclusive-endpoint overlap');
            }
            if (rangesOverlap(1, null, 30, 40) !== true) {
                missing.push('rangesOverlap missed open-ended overlap');
            }
        } catch (e) {
            missing.push('range-wrapper smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingProjector] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();