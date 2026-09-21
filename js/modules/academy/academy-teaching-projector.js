/**
 * modules/academy/academy-teaching-projector.js - Academy Teaching Projector
 *
 * Path: js/modules/academy/academy-teaching-projector.js
 *
 * Persisted teaching relationships → weekly occurrences.
 *
 * WHAT THIS MODULE OWNS:
 *   - Reading the persisted teaching data (class-disciplines,
 *     enrolments, teaching groups, teaching sessions, class rest
 *     days).
 *   - Computing which occurrences exist in a given week, by
 *     intersecting every applicable window AND excluding sessions
 *     that fall on a rest day for the target week.
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
 *   A meeting "actually happens" when:
 *     - the week falls inside the intersection of every
 *       applicable window:
 *         class-discipline window
 *           ∩ group window
 *           ∩ session window
 *     - per student:
 *         ∩ enrolment window
 *           ∩ membership window
 *     - AND the session's day is not a rest day for the week in
 *       the class the group belongs to.
 *
 * REST DAYS:
 *   class.restDays is the class's default rest days. class.restDaysByWeek
 *   is a sparse map of per-week overrides. AcademyClasses.getRestDaysForWeek
 *   resolves the effective set for a given week.
 *
 *   The projector consults this resolver once per class per week,
 *   caching the result, and skips any session whose day is in the
 *   set. Skipped sessions are not emitted as occurrences. This is
 *   the mechanism by which "a class is on rest on Saturday" stops
 *   a scheduled Saturday session from counting toward the
 *   discipline's weekly-hours target, from appearing on the grid,
 *   and from colliding with anything.
 *
 *   The session record itself is NOT deleted. If the day is a
 *   rest day for week 3 but not for week 4, the session is
 *   suppressed in week 3 and projects in week 4.
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
 *   respectively. Do not reimplement the range math here.
 *
 * CLASS-DISCIPLINE READS:
 *   The class-discipline marker store has two modules: a mutation
 *   module (AcademyClassDisciplines) and a read module
 *   (AcademyClassDisciplinesQueries). This projector reads through
 *   the read module. The single read it performs is
 *   `isActiveInWeek`, which reads the DISCIPLINE's window (the
 *   marker has no window).
 *
 * REST-DAY READS:
 *   The rest-day question — "what are the effective rest days
 *   for this class this week?" — is owned by AcademyClasses,
 *   through getRestDaysForWeek. This projector reads through that
 *   function. It does not walk class.restDays or
 *   class.restDaysByWeek directly.
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
 *   - window.AcademyClasses           (rest-day resolution)
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
    var AcademyClasses = window.AcademyClasses;

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
    if (!AcademyClasses ||
        typeof AcademyClasses.getRestDaysForWeek !== 'function') {
        _missing.push('AcademyClasses.getRestDaysForWeek');
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

    function rangeContains(week, start, end) {
        return RangeUtils.contains(week, start, end);
    }

    // ============================================================
    // REST-DAY SUPPRESSION
    // ============================================================
    //
    // For a given week, resolve each class's effective rest days
    // once. A session whose day is in the set is skipped. The
    // cache is local to the projectWeek call, so it is discarded
    // when the call returns. Subsequent calls re-resolve.
    //
    // A class with no entry in the cache and no rest days at all
    // is not stored; lookups miss and return [] quickly.

    function makeRestDayResolver(week) {
        var cache = Object.create(null);

        return function isRestDay(classId, day) {
            if (!isNonEmptyString(classId)) {
                return false;
            }
            var key = String(classId);
            var days;
            if (Object.prototype.hasOwnProperty.call(cache, key)) {
                days = cache[key];
            } else {
                try {
                    var resolved = AcademyClasses.getRestDaysForWeek(
                        key, week
                    );
                    days = Array.isArray(resolved) ? resolved : [];
                } catch (e) {
                    console.warn(
                        '[AcademyTeachingProjector] ' +
                        'getRestDaysForWeek failed:', e
                    );
                    days = [];
                }
                cache[key] = days;
            }
            return days.indexOf(day) !== -1;
        };
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

        var isRestDay = makeRestDayResolver(weekNum);

        var occurrences = [];

        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!isPlainObject(group)) { continue; }

            if (!rangeContains(weekNum, group.startWeek, group.endWeek)) {
                continue;
            }

            if (!classDisciplineActiveInWeek(
                group.classId, group.disciplineId, weekNum
            )) {
                continue;
            }

            var studentIds = activeStudentsForGroup(group, weekNum);

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

                // Rest-day suppression. A session whose day is a
                // rest day for this week in this class does not
                // happen this week. It remains in the store and
                // projects in other weeks where its day is not a
                // rest day.
                if (isRestDay(group.classId, session.day)) {
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

            if (!rangeContains(week, member.startWeek, member.endWeek)) {
                continue;
            }

            if (!AcademyEnrolments.isEnrolledInWeek(
                charId, classId, disciplineId, week
            )) {
                continue;
            }

            result.push(String(charId));
        }

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

    function rangeContainsWeek(start, end, week) {
        return RangeUtils.containsWeek(week, start, end);
    }

    function rangesOverlap(startA, endA, startB, endB) {
        return RangeUtils.weeksOverlap(startA, endA, startB, endB);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingProjector = Object.freeze({
        projectWeek: projectWeek,

        projectForStudent: projectForStudent,
        projectForInstructor: projectForInstructor,
        projectForLocation: projectForLocation,
        projectForClass: projectForClass,
        projectForGroup: projectForGroup,
        projectForClassDiscipline: projectForClassDiscipline,

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

        try {
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
