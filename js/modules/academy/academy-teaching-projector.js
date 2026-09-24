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
 * OCCURRENCE KINDS:
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
 *   reads from `getAllSessions()` today and must additionally
 *   read the commitment occurrences. That change lives in
 *   academy-schedule.js.
 *
 * COMMITMENT DEPENDENCY IS LAZY-BUT-MANDATORY AT PROJECTION TIME:
 *   AcademyInstructorCommitments is a lazy dependency: the module
 *   loads without it. But when projectWeek() is called and the
 *   commitments module is absent, the projector throws. It does
 *   not return class occurrences alone.
 *
 *   Rationale: the flat list is the canonical answer to "what is
 *   scheduled this week?" A missing commitments module means the
 *   answer is incomplete, and an incomplete answer that looks
 *   complete is worse than a loud failure. Callers that want
 *   class occurrences only call projectClassOccurrences through
 *   a dedicated projection if one exists; today, none does, so
 *   the module refuses to answer.
 *
 * WEEK FILTERING:
 *   A class occurrence exists in a week when:
 *     1. the group's [startWeek, endWeek] contains the week
 *     2. the class-discipline is active in the week
 *     3. the session's [startWeek, endWeek] contains the week
 *     4. the session's day is not a rest day for the group's class
 *
 *   A commitment occurrence exists in a week when:
 *     1. the commitment's [startWeek, endWeek] contains the week
 *
 *   Commitments are NOT suppressed by rest days. A commitment is
 *   the instructor's own time, held independently of any class's
 *   calendar.
 *
 * MALFORMED RECORDS THROW:
 *   This is a canonical projection layer. Malformed persisted
 *   records — a non-object group, a non-object session, a
 *   non-object commitment — throw rather than being silently
 *   dropped. Semantic absence (range does not contain, discipline
 *   not active, rest day) is filtered normally.
 *
 *   A silent skip converts "this record is broken" into "this
 *   record does not exist," and downstream consumers cannot
 *   distinguish the two. Throwing keeps the failure visible.
 *
 * REST DAYS:
 *   Rest days apply to CLASS occurrences only.
 *
 *   They are read once per (classId, week) pair via a resolver
 *   built at the top of the projection. A rest-day query failure
 *   propagates; it is not converted to "no rest days."
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
 * DEPENDENCIES (LAZY, mandatory at projection time):
 *   - window.AcademyInstructorCommitments
 *     When present, commitment occurrences are emitted.
 *     When absent, projectWeek throws. See the header section
 *     above.
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
    }
    if (!AcademyTeachingSessions) {
        _missing.push('AcademyTeachingSessions (module)');
    } else {
        if (typeof AcademyTeachingSessions.getSessionsForGroup !== 'function') {
            _missing.push(
                'AcademyTeachingSessions.getSessionsForGroup'
            );
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
    // LAZY-BUT-MANDATORY DEPENDENCIES
    // ============================================================

    /**
     * Resolve AcademyInstructorCommitments at projection time.
     * Throws when the module is missing or malformed.
     *
     * This is the "lazy ≠ optional" pattern: the module loads
     * without it, but a projection cannot answer the question
     * without it.
     */
    function requireInstructorCommitments() {
        var C = window.AcademyInstructorCommitments;
        if (!C ||
            typeof C.getActiveCommitmentsForWeek !== 'function') {
            throw new Error(
                '[AcademyTeachingProjector] ' +
                'AcademyInstructorCommitments.getActiveCommitmentsForWeek ' +
                'is required by projectWeek. Check the script load ' +
                'order in index.html.'
            );
        }
        return C;
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
    //
    // A rest-day query failure propagates. This is not a place
    // where "the query failed" and "there are no rest days" can
    // be the same answer.

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
                var resolved = AcademyClasses.getRestDaysForWeek(
                    key, week
                );
                days = Array.isArray(resolved) ? resolved : [];
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

        // Resolve the commitments module up front. If it is
        // missing, projectWeek throws; it does not return a
        // partial list.
        var Commitments = requireInstructorCommitments();

        var occurrences = [];

        // ---- Class occurrences ----
        var classOccurrences = projectClassOccurrences(weekNum);
        for (var i = 0; i < classOccurrences.length; i++) {
            occurrences.push(classOccurrences[i]);
        }

        // ---- Commitment occurrences ----
        var commitmentOccurrences = projectCommitmentsForWeek(
            weekNum, Commitments
        );
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

            if (!isPlainObject(group)) {
                throw new Error(
                    '[AcademyTeachingProjector] Malformed group ' +
                    'record at index ' + g + '. Persisted group ' +
                    'records must be plain objects.'
                );
            }

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
            if (!Array.isArray(sessions)) {
                throw new Error(
                    '[AcademyTeachingProjector] ' +
                    'getSessionsForGroup returned a non-array for ' +
                    'group ' + group.id + '.'
                );
            }

            for (var s = 0; s < sessions.length; s++) {
                var session = sessions[s];

                if (!isPlainObject(session)) {
                    throw new Error(
                        '[AcademyTeachingProjector] Malformed session ' +
                        'record for group ' + group.id + ' at index ' +
                        s + '.'
                    );
                }

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
            instructorId: group.instructorId,

            week: week,
            day: session.day,
            startTime: session.startTime,
            duration: session.duration,
            locationId: session.locationId,

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
    // The batch reader on AcademyInstructorCommitments returns
    // every active commitment for the week in one call. This
    // replaces an earlier O(classes) walk.

    function projectCommitmentsForWeek(weekNum, Commitments) {
        var actives = Commitments.getActiveCommitmentsForWeek(weekNum);

        if (!Array.isArray(actives)) {
            throw new Error(
                '[AcademyTeachingProjector] ' +
                'getActiveCommitmentsForWeek returned a non-array. ' +
                'This is a commitments-module bug.'
            );
        }

        var occurrences = [];

        for (var i = 0; i < actives.length; i++) {
            var occ = buildCommitmentOccurrence(actives[i], weekNum);
            if (occ) {
                occurrences.push(occ);
            }
        }

        return occurrences;
    }

    /**
     * Build a commitment occurrence from a persisted commitment
     * record.
     *
     * Malformed records throw. The persisted shape is guaranteed
     * by AcademyInstructorCommitments' validator; a broken record
     * here is a data-integrity failure, not an absence.
     *
     * Fields are read directly, without `|| null` / `|| ''`
     * defaults. The persisted shape carries `null` for absent
     * locationId and characterId, and `''` for an absent label.
     * Inventing defaults here would hide a shape violation.
     */
    function buildCommitmentOccurrence(commitment, week) {
        if (!isPlainObject(commitment)) {
            throw new Error(
                '[AcademyTeachingProjector] Malformed commitment ' +
                'record. Persisted commitment records must be plain ' +
                'objects.'
            );
        }
        if (!isNonEmptyString(commitment.id)) {
            throw new Error(
                '[AcademyTeachingProjector] Commitment record is ' +
                'missing an id.'
            );
        }
        if (!isNonEmptyString(commitment.instructorId)) {
            throw new Error(
                '[AcademyTeachingProjector] Commitment ' +
                commitment.id + ' is missing an instructorId.'
            );
        }

        var kind = commitment.kind;
        if (kind !== KIND_OFFICE_HOURS && kind !== KIND_TUTORING) {
            throw new Error(
                '[AcademyTeachingProjector] Commitment ' +
                commitment.id + ' has an unknown kind: ' + kind + '.'
            );
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
            locationId: commitment.locationId,

            // Tutoring-only fields. Null on office hours.
            characterId: commitment.characterId,
            label: commitment.label
        };
    }

    // ============================================================
    // SORTING
    // ============================================================

    /**
     * Deterministic occurrence identity, used only for tie-breaking.
     *
     * Branches on kind so a class occurrence never compares its
     * sessionId against a commitment's commitmentId.
     */
    function occurrenceIdentity(occ) {
        if (!occ || typeof occ !== 'object') { return ''; }
        if (occ.kind === KIND_CLASS) {
            return occ.sessionId !== undefined &&
                   occ.sessionId !== null
                ? String(occ.sessionId)
                : '';
        }
        if (occ.kind === KIND_OFFICE_HOURS ||
            occ.kind === KIND_TUTORING) {
            return occ.commitmentId !== undefined &&
                   occ.commitmentId !== null
                ? String(occ.commitmentId)
                : '';
        }
        return '';
    }

    function sortOccurrences(occurrences) {
        occurrences.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            var ai = occurrenceIdentity(a);
            var bi = occurrenceIdentity(b);
            return ai.localeCompare(bi);
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
    //
    // projectForClass semantics: "every occurrence whose classId
    // is this class." That includes commitment occurrences,
    // because commitments carry a classId. A caller that wants
    // teaching SESSIONS for the class should filter further on
    // kind === 'class'. This is documented here and in the
    // function's own comment.

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
            if (occ.instructorId !== undefined &&
                occ.instructorId !== null &&
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
            if (occ.locationId !== undefined &&
                occ.locationId !== null &&
                String(occ.locationId) === target) {
                result.push(occ);
            }
        }
        return result;
    }

    /**
     * Every occurrence whose classId is the requested class.
     *
     * INCLUDES COMMITMENT OCCURRENCES. A commitment carries a
     * classId, so it appears in this projection. A caller that
     * wants teaching sessions for the class filters the result
     * on kind === 'class'.
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
            if (occ.instructorId !== undefined &&
                occ.instructorId !== null &&
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
