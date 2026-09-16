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
 *   - endWeek === null means "ongoing" (treated as MAX_WEEK for
 *     intersection purposes).
 *   - Weeks are integers in [MIN_WEEK, MAX_WEEK].
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
 * RANGE INCLUSIVITY HELPER:
 *   `rangeContains(week, start, end)` treats `end === null` as
 *   MAX_WEEK. It is the single source of truth for the
 *   "is-this-week-inside-this-window" question. No consumer
 *   should reimplement it.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.AcademyClassDisciplines
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
    var AcademyClassDisciplines = window.AcademyClassDisciplines;
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
    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.isActiveInWeek !== 'function') {
        _missing.push('AcademyClassDisciplines.isActiveInWeek');
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

    /**
     * Does [start, end] contain the given week?
     *
     * This is the canonical range check. `end === null` means
     * ongoing. Both bounds are inclusive.
     *
     * THIS IS THE SINGLE SOURCE OF TRUTH. Any other module that
     * needs the check should call this one, or replicate the
     * semantic exactly (inclusive both ends, null means open).
     * Reimplementing it with different semantics is a bug.
     */
    function rangeContains(week, start, end) {
        if (typeof week !== 'number' ||
            !isFinite(week) ||
            week < MIN_WEEK ||
            week > MAX_WEEK) {
            return false;
        }
        if (typeof start !== 'number' || !isFinite(start)) {
            return false;
        }
        if (week < start) {
            return false;
        }
        if (end !== null && end !== undefined) {
            if (week > end) {
                return false;
            }
        }
        return true;
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
        return AcademyClassDisciplines.isActiveInWeek(
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
    // Exposed so that consumers do not reimplement the range
    // containment logic. Two consumers asking "does this range
    // cover this week?" must give the same answer.

    /**
     * Does [start, end] contain the given week?
     * end === null means ongoing.
     *
     * Exposed because collision detection, validation, and the
     * calendar aggregator all need this check and it must be
     * consistent across them.
     */
    function rangeContainsWeek(start, end, week) {
        return rangeContains(week, start, end);
    }

    /**
     * Do two ranges overlap? end === null means ongoing.
     *
     * Overlap here means "there exists a week contained by both."
     * Both ends inclusive.
     */
    function rangesOverlap(startA, endA, startB, endB) {
        var effEndA = (endA === null || endA === undefined) ? MAX_WEEK : endA;
        var effEndB = (endB === null || endB === undefined) ? MAX_WEEK : endB;
        if (startA === null || startA === undefined) { return false; }
        if (startB === null || startB === undefined) { return false; }
        return startA <= effEndB && startB <= effEndA;
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

        // Range helpers (single source of truth for range checks)
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

        // Smoke tests on the range helpers, which are the pure parts
        // of this module.
        try {
            if (rangeContainsWeek(1, 10, 5) !== true) {
                missing.push('rangeContainsWeek(1,10,5) !== true');
            }
            if (rangeContainsWeek(1, 10, 10) !== true) {
                missing.push('inclusive endWeek not honoured');
            }
            if (rangeContainsWeek(1, 10, 11) !== false) {
                missing.push('rangeContainsWeek(1,10,11) !== false');
            }
            if (rangeContainsWeek(1, null, 52) !== true) {
                missing.push('null endWeek not treated as ongoing');
            }
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
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingProjector] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
