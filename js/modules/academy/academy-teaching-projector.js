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
 *     days, instructor commitments).
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
 * OCCURRENCE KINDS (this revision):
 *   Every occurrence carries a `kind` discriminator. Three kinds
 *   exist today:
 *
 *     'class'         a teaching session for a teaching group.
 *     'officeHours'   an instructor's available-time block.
 *     'tutoring'      an instructor's 1:1 advisory block.
 *
 *   The class occurrences are unchanged in every field except for
 *   the new `kind` field. Commitment occurrences are new and
 *   carry a different identity field (`commitmentId`) and a
 *   different shape (no groupId, no disciplineId, no studentIds).
 *
 *   Every consumer that exists today filters the flat list
 *   further. The student projection filters on `studentIds`,
 *   which commitments do not carry, so commitments are excluded
 *   without any code change. The instructor projection and the
 *   location projection filter on `instructorId` and `locationId`
 *   respectively, which commitments do carry, so commitments are
 *   included without any code change. The weekly-hours validator
 *   filters on `duration * 60` and `studentIds`, so commitments
 *   are excluded.
 *
 *   Only the collision detector needs an explicit change: it
 *   currently reads from `getAllSessions()`. It must additionally
 *   read the commitment occurrences. That change lives in
 *   academy-schedule.js.
 *
 * (Rest of the header is unchanged.)
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
 *
 * DEPENDENCIES (LAZY, used only if present):
 *   - window.AcademyInstructorCommitments
 *     When absent, commitment occurrences are not emitted. The
 *     projector still emits class occurrences. A missing
 *     commitments module is a soft absence, not a load-time
 *     failure.
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
    // LAZY DEPENDENCIES
    // ============================================================

    function getInstructorCommitments() {
        return window.AcademyInstructorCommitments || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var KIND_CLASS = 'class';
    var KIND_OFFICE_HOURS = 'officeHours';
    var KIND_TUTORING = 'tutoring';

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
    // Rest days apply to CLASS occurrences only. Commitments are
    // the instructor's own time and are independent of any class's
    // calendar; they are not suppressed by any rest day.

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
     * The result is a flat list. Every item carries `kind`. Class
     * occurrences have `kind: 'class'`; commitment occurrences
     * carry their own kind.
     *
     * The list is sorted by (day, startTime, identity) so the
     * order is deterministic across calls.
     *
     * @param {number|string} week
     * @returns {array} Sorted array of Occurrence objects
     */
    function projectWeek(week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var occurrences = [];

        // ---- Class occurrences ----
        var classOccurrences = projectClassOccurrences(weekNum);
        for (var i = 0; i < classOccurrences.length; i++) {
            occurrences.push(classOccurrences[i]);
        }

        // ---- Commitment occurrences ----
        var commitmentOccurrences = projectCommitmentsForWeek(weekNum);
        for (var j = 0; j < commitmentOccurrences.length; j++) {
            occurrences.push(commitmentOccurrences[j]);
        }

        sortOccurrences(occurrences);
        return occurrences;
    }

    // ============================================================
    // CLASS OCCURRENCE PROJECTION
    // ============================================================

    function projectClassOccurrences(weekNum) {
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

                if (isRestDay(group.classId, session.day)) {
                    continue;
                }

                occurrences.push(buildClassOccurrence(
                    session, group, weekNum, studentIds
                ));
            }
        }

        return occurrences;
    }

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

    function buildClassOccurrence(session, group, week, studentIds) {
        return {
            kind: KIND_CLASS,

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
    // COMMITMENT OCCURRENCE PROJECTION
    // ============================================================
    //
    // Commitments are the instructor's own time blocks. They are
    // emitted for any week the commitment's [startWeek, endWeek]
    // range contains.
    //
    // They are NOT suppressed by any class's rest day. A rest day
    // is a property of a class's calendar; a commitment is the
    // instructor's own commitment, held independently.
    //
    // When the commitments module is not loaded, this function
    // returns []. The projector still emits class occurrences. The
    // absence is logged once at module load, not per call, by the
    // caller's own dependency check.

    function projectCommitmentsForWeek(weekNum) {
        var C = getInstructorCommitments();
        if (!C) {
            return [];
        }

        // No batch reader exists on the module that returns every
        // commitment at every week. Two reads give us the same
        // answer:
        //
        //   1. Walk the store via the module's per-class reader
        //      for every class we know about.
        //   2. Or, add a batch reader.
        //
        // The cleanest answer is a batch reader. Until one exists,
        // walk the instructor-commitments store via the module's
        // own class-scoped reads: for each class in the academy,
        // ask for that class's active commitments at this week.
        //
        // The cost is O(classes). The commitment store is small
        // per class. This is acceptable for the current scale.
        //
        // If a future version of the commitments module exposes
        // getAllCommitments() or getAllCommitmentsForWeek(week),
        // this function should switch to it in one line.

        var occurrences = [];

        var AcademyClassesRef = window.AcademyClasses;
        if (!AcademyClassesRef ||
            typeof AcademyClassesRef.getClasses !== 'function') {
            return occurrences;
        }

        var classes = AcademyClassesRef.getClasses() || [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }

            var actives = [];
            try {
                actives = C.getActiveCommitmentsForClass(
                    cls.id, weekNum
                ) || [];
            } catch (e) {
                console.warn(
                    '[AcademyTeachingProjector] ' +
                    'getActiveCommitmentsForClass failed:', e
                );
                actives = [];
            }

            for (var j = 0; j < actives.length; j++) {
                var occ = buildCommitmentOccurrence(actives[j], weekNum);
                if (occ) {
                    occurrences.push(occ);
                }
            }
        }

        return occurrences;
    }

    function buildCommitmentOccurrence(commitment, week) {
        if (!isPlainObject(commitment)) { return null; }
        if (!isNonEmptyString(commitment.id)) { return null; }
        if (!isNonEmptyString(commitment.instructorId)) { return null; }

        var kind = commitment.kind;
        if (kind !== KIND_OFFICE_HOURS && kind !== KIND_TUTORING) {
            return null;
        }

        return {
            kind: kind,

            commitmentId: commitment.id,
            classId: commitment.classId,
            instructorId: commitment.instructorId,

            week: week,
            day: commitment.day,
            startTime: commitment.startTime,
            duration: commitment.duration,
            locationId: commitment.locationId || null,

            // Tutoring-only fields. Null on office hours.
            characterId: commitment.characterId || null,
            label: commitment.label || ''
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

            // Deterministic tie-break. Prefer the identity field
            // of whichever kind the occurrence is.
            var ai = a.sessionId || a.commitmentId || '';
            var bi = b.sessionId || b.commitmentId || '';
            return String(ai).localeCompare(String(bi));
        });
    }

    // ============================================================
    // FILTERED PROJECTIONS
    // ============================================================
    //
    // These operate on the flat list. Commitments pass through
    // projectForInstructor and projectForLocation unchanged.
    // projectForStudent excludes them because commitments carry no
    // studentIds; a loop over occ.studentIds simply finds nothing.
    // projectForClass includes them because they carry classId.
    // projectForGroup excludes them because commitments carry no
    // groupId.

    function projectForStudent(studentId, week) {
        if (!isNonEmptyString(studentId)) { return []; }
        var target = String(studentId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (!Array.isArray(occ.studentIds)) { continue; }
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
            // Commitments have no groupId. The check is explicit:
            // an occurrence without a groupId never matches.
            if (occ.groupId === undefined || occ.groupId === null) {
                continue;
            }
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
            // Commitments have no disciplineId. The check is
            // explicit.
            if (occ.disciplineId === undefined ||
                occ.disciplineId === null) {
                continue;
            }
            if (String(occ.classId) === targetClass &&
                String(occ.disciplineId) === targetDiscipline) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Every commitment occurrence for one instructor in one week.
     * Class occurrences are excluded.
     *
     * Used by the collision detector, which needs to know the
     * instructor's existing commitments when validating a new
     * session against them.
     */
    function projectForInstructorCommitments(instructorId, week) {
        if (!isNonEmptyString(instructorId)) { return []; }
        var target = String(instructorId);
        var all = projectWeek(week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var occ = all[i];
            if (occ.kind === KIND_CLASS) { continue; }
            if (occ.instructorId !== null &&
                String(occ.instructorId) === target) {
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

        // Commitments-only projection
        projectForInstructorCommitments: projectForInstructorCommitments,

        rangeContainsWeek: rangeContainsWeek,
        rangesOverlap: rangesOverlap,

        // Kind constants
        KIND_CLASS: KIND_CLASS,
        KIND_OFFICE_HOURS: KIND_OFFICE_HOURS,
        KIND_TUTORING: KIND_TUTORING
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
            'projectForInstructorCommitments',
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
