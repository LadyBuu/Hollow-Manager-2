/**
 * modules/academy/academy-teaching-validation.js
 * Academy Teaching Validation
 *
 * Path: js/modules/academy/academy-teaching-validation.js
 *
 * Warning-only validation for the teaching model.
 *
 * WHAT THIS MODULE OWNS:
 *   - Weekly-hours validation: for each (student, class-discipline),
 *     compute scheduled minutes for a week and compare against the
 *     target set by the class-discipline's weeklyHours.
 *   - Structural invariant warnings: membership window must be
 *     contained within the corresponding enrolment window; a
 *     session's window must be contained within its group's window.
 *   - Null-group warnings: a session whose group no longer exists.
 *   - Empty-roster warnings: a session with no students for the week.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Hard errors. Every check here is warning-only. Whether a
 *     warning should block an operation is a policy decision that
 *     belongs to AcademySchedule, not here.
 *   - Collision detection. AcademyTeachingCollisions owns it.
 *   - Occurrence projection. AcademyTeachingProjector owns it.
 *   - Mutations. Nothing in the schedule stack mutates.
 *
 * WHY WARNING-ONLY:
 *   The schedule is under active construction most of the time. A
 *   weekly-hours shortfall is not an error; it may mean the
 *   timetable is being built. A student with no meeting this week
 *   may be on rest. The validator reports facts; the UI decides
 *   how prominently to surface them.
 *
 *   The one place where a warning becomes actionable is inside
 *   AcademySchedule, which may choose to reject a proposed
 *   mutation if the resulting validation shows a specific kind of
 *   problem. That decision lives there, not here.
 *
 * WEEKLY-HOURS SEMANTICS:
 *   For each class-discipline, `weeklyHours` is the class's target
 *   for how many hours per week a student should spend in that
 *   discipline. When the class-discipline is not configured with
 *   an explicit weeklyHours, the discipline's `defaultWeeklyHours`
 *   is used.
 *
 *   For a given week:
 *
 *     scheduledMinutes = sum over the student's occurrences in
 *                        that (class, discipline) of
 *                        occurrence.duration * 60
 *
 *     targetMinutes    = weeklyHours * 60
 *
 *     differenceMinutes = scheduledMinutes - targetMinutes
 *
 *     status:
 *       'under'  when scheduledMinutes < targetMinutes
 *       'met'    when scheduledMinutes === targetMinutes
 *       'over'   when scheduledMinutes > targetMinutes
 *
 *   Only the student's actual occurrences count. Sessions the
 *   student is not rostered for are excluded (the projector
 *   already excludes them from studentIds).
 *
 *   ACTIVE-DISCIPLINE GUARD (this revision):
 *     A discipline that does not run in the queried week is NOT
 *     part of the report. The report answers "how is the student
 *     doing in the disciplines that run this week?", and a
 *     discipline that runs weeks 5–12 has no place in a week-1
 *     report, even if the student's enrolment interval covers
 *     week 1.
 *
 *     The check is AcademyClassDisciplinesQueries.isActiveInWeek,
 *     which reads the discipline's own startWeek / endWeek. The
 *     projector already applies the same check when building
 *     occurrences, so the scheduled-minutes side was already
 *     correct; the target side was not. Before this revision,
 *     a discipline starting in week 5 produced a report row in
 *     week 1 showing "0 / 3h, 3h left", as though the student
 *     had failed to attend a course that had not begun.
 *
 *     The row is now omitted entirely. The absence is the answer.
 *
 * CLASS-DISCIPLINE READS:
 *   The class-discipline marker store has two modules: a mutation
 *   module (AcademyClassDisciplines) and a read module
 *   (AcademyClassDisciplinesQueries). This validator reads through
 *   the read module.
 *
 *   The two reads it performs are `getEffectiveConfig` (to resolve
 *   the discipline's weeklyHours) and `isActiveInWeek` (to filter
 *   the report to running disciplines).
 *
 * RANGE PREDICATES:
 *   The range question — "does this range contain this week" and
 *   "is this range contained inside this other range" — is owned
 *   by window.RangeUtils.
 *
 *   `rangeContained` is a local composition: it asks RangeUtils
 *   twice, once per bound, and ANDs the answers.
 *
 * REPORT SHAPES:
 *
 *   Weekly-hours report per student per discipline:
 *     {
 *       classId,
 *       disciplineId,
 *       studentId,
 *       week,
 *       scheduledMinutes,
 *       targetMinutes,
 *       differenceMinutes,
 *       status
 *     }
 *
 *   Invariant warning:
 *     {
 *       kind: 'invariant',
 *       code: 'membership-outside-enrolment'
 *              | 'session-outside-group'
 *              | 'session-group-missing'
 *              | 'empty-roster',
 *       message: string,
 *       context: object   // ids and details, shape depends on code
 *     }
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.RangeUtils
 *   - window.AcademyTeachingProjector
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyEnrolments
 */

(function() {
    'use strict';

    if (window.__academyTeachingValidationLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var RangeUtils = window.RangeUtils;
    var Projector = window.AcademyTeachingProjector;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyEnrolments = window.AcademyEnrolments;

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
        typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!Projector) {
        _missing.push('AcademyTeachingProjector (module)');
    } else {
        if (typeof Projector.projectWeek !== 'function') {
            _missing.push('AcademyTeachingProjector.projectWeek');
        }
        if (typeof Projector.projectForClass !== 'function') {
            _missing.push('AcademyTeachingProjector.projectForClass');
        }
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
        if (typeof AcademyTeachingSessions.getAllSessions !== 'function') {
            _missing.push('AcademyTeachingSessions.getAllSessions');
        }
    }
    if (!AcademyClassDisciplinesQueries) {
        _missing.push('AcademyClassDisciplinesQueries (module)');
    } else {
        if (typeof AcademyClassDisciplinesQueries.getEffectiveConfig !== 'function') {
            _missing.push(
                'AcademyClassDisciplinesQueries.getEffectiveConfig'
            );
        }
        if (typeof AcademyClassDisciplinesQueries.isActiveInWeek !== 'function') {
            _missing.push(
                'AcademyClassDisciplinesQueries.isActiveInWeek'
            );
        }
    }
    if (!AcademyEnrolments) {
        _missing.push('AcademyEnrolments (module)');
    } else {
        if (typeof AcademyEnrolments.getClassEnrolments !== 'function') {
            _missing.push('AcademyEnrolments.getClassEnrolments');
        }
        if (typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
            _missing.push('AcademyEnrolments.getStudentDisciplines');
        }
        if (typeof AcademyEnrolments.isEnrolledInWeek !== 'function') {
            _missing.push('AcademyEnrolments.isEnrolledInWeek');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingValidation] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingValidationLoaded = true;

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
        if (parsed < CalendarConstants.MIN_WEEK ||
            parsed > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    // ============================================================
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================
    //
    // RangeUtils owns the week-containment primitive. The two
    // helpers below are compositions:
    //
    //   rangeContained(innerStart, innerEnd, outerStart, outerEnd)
    //     asks RangeUtils.containsWeek twice, once per inner bound,
    //     and ANDs the answers.
    //
    //   memberWindowCovered(memStart, memEnd, intervals)
    //     asks, for the member's [memStart, memEnd], whether any of
    //     the enrolment intervals fully contains it.
    //
    // Do not reimplement the week math here.

    function rangeContained(
        innerStart, innerEnd,
        outerStart, outerEnd
    ) {
        if (innerStart === null || innerStart === undefined) {
            return false;
        }
        if (outerStart === null || outerStart === undefined) {
            return false;
        }

        if (!RangeUtils.containsWeek(innerStart, outerStart, outerEnd)) {
            return false;
        }

        if (innerEnd === null || innerEnd === undefined) {
            return outerEnd === null || outerEnd === undefined;
        }

        return RangeUtils.containsWeek(innerEnd, outerStart, outerEnd);
    }

    // ============================================================
    // WEEKLY HOURS VALIDATION
    // ============================================================

    /**
     * Compute the weekly-hours report for every enrolled student in
     * a class for a given week.
     *
     * ACTIVE-DISCIPLINE GUARD:
     *   A discipline that is not active in the given week does not
     *   appear in the report. See the file header.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {array} Array of report entries.
     */
    function validateClassWeeklyHours(classId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null || !isNonEmptyString(classId)) {
            return [];
        }

        var target = String(classId);

        var enrolments = AcademyEnrolments.getClassEnrolments(target);
        if (!enrolments || typeof enrolments !== 'object') {
            return [];
        }

        var minutesByStudentDiscipline = accumulateMinutes(
            target, weekNum
        );

        var reports = [];
        var studentIds = Object.keys(enrolments);
        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            var disciplines = enrolments[studentId];
            if (!Array.isArray(disciplines)) { continue; }

            for (var d = 0; d < disciplines.length; d++) {
                var disciplineId = disciplines[d];
                if (!isNonEmptyString(disciplineId)) { continue; }

                // The student must be enrolled in this discipline
                // during the given week.
                if (!AcademyEnrolments.isEnrolledInWeek(
                    studentId, target, disciplineId, weekNum
                )) {
                    continue;
                }

                // ---- ACTIVE-DISCIPLINE GUARD ----
                //
                // The discipline must be running during the given
                // week. A discipline that starts in week 5 has no
                // business appearing in a week-1 report.
                //
                // The check reads the discipline's own startWeek /
                // endWeek through the canonical query. The projector
                // already applies the same check when building
                // occurrences, so the scheduled-minutes side was
                // already correct; this guard corrects the target
                // side.
                var isActive = false;
                try {
                    isActive = AcademyClassDisciplinesQueries
                        .isActiveInWeek(
                            target, disciplineId, weekNum
                        ) === true;
                } catch (e) {
                    isActive = false;
                }

                if (!isActive) {
                    continue;
                }

                var key = studentId + '::' + disciplineId;
                var scheduledMinutes = minutesByStudentDiscipline[key] || 0;

                var targetMinutes = resolveTargetMinutes(
                    target, disciplineId
                );

                var difference = scheduledMinutes - targetMinutes;
                var status;
                if (scheduledMinutes === targetMinutes) {
                    status = 'met';
                } else if (scheduledMinutes < targetMinutes) {
                    status = 'under';
                } else {
                    status = 'over';
                }

                reports.push({
                    classId: target,
                    disciplineId: String(disciplineId),
                    studentId: studentId,
                    week: weekNum,
                    scheduledMinutes: scheduledMinutes,
                    targetMinutes: targetMinutes,
                    differenceMinutes: difference,
                    status: status
                });
            }
        }

        reports.sort(function(a, b) {
            if (a.disciplineId !== b.disciplineId) {
                return a.disciplineId < b.disciplineId ? -1 : 1;
            }
            return a.studentId < b.studentId ? -1 : 1;
        });

        return reports;
    }

    /**
     * Walk the projector's occurrences for the class, once, and
     * accumulate scheduled minutes per (student, discipline).
     *
     * The projector already filters occurrences to disciplines
     * active in the week. No additional guard is needed here.
     */
    function accumulateMinutes(classId, week) {
        var minutes = Object.create(null);

        var occurrences = Projector.projectForClass(classId, week);
        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }
            if (!Array.isArray(occ.studentIds)) { continue; }
            if (occ.duration === undefined || occ.duration === null) {
                continue;
            }

            var durationMinutes = occ.duration * 60;
            var disciplineId = String(occ.disciplineId);

            for (var s = 0; s < occ.studentIds.length; s++) {
                var studentId = occ.studentIds[s];
                if (!isNonEmptyString(studentId)) { continue; }
                var key = studentId + '::' + disciplineId;
                minutes[key] = (minutes[key] || 0) + durationMinutes;
            }
        }

        return minutes;
    }

    /**
     * Resolve the weekly-hours target (in minutes) for a
     * (classId, disciplineId) pair.
     */
    function resolveTargetMinutes(classId, disciplineId) {
        var config = AcademyClassDisciplinesQueries.getEffectiveConfig(
            classId, disciplineId
        );
        if (!config) {
            return 0;
        }
        var hours = config.weeklyHours;
        if (typeof hours !== 'number' || !isFinite(hours) || hours < 0) {
            return 0;
        }
        return hours * 60;
    }

    /**
     * Convenience: return only the report entries that are NOT
     * 'met'.
     */
    function validateClassWeeklyHoursProblems(classId, week) {
        var all = validateClassWeeklyHours(classId, week);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i].status !== 'met') {
                result.push(all[i]);
            }
        }
        return result;
    }

    // ============================================================
    // STRUCTURAL INVARIANT WARNINGS
    // ============================================================

    function validateInvariants(week) {
        var warnings = [];

        var groups = AcademyTeachingGroups.getAllGroups();
        if (Array.isArray(groups)) {
            checkMembershipInvariants(groups, warnings);
            checkSessionsAgainstGroups(groups, warnings);
        }

        var weekNum = week === undefined || week === null
            ? null
            : parseWeekStrict(week);

        if (weekNum !== null) {
            checkEmptyRosters(weekNum, warnings);
        }

        return warnings;
    }

    function checkMembershipInvariants(groups, out) {
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!isPlainObject(group)) { continue; }
            if (!Array.isArray(group.members)) { continue; }

            var classId = group.classId;
            var disciplineId = group.disciplineId;
            if (!isNonEmptyString(classId) ||
                !isNonEmptyString(disciplineId)) {
                continue;
            }

            for (var m = 0; m < group.members.length; m++) {
                var member = group.members[m];
                if (!isPlainObject(member)) { continue; }

                var charId = member.characterId;
                if (!isNonEmptyString(charId)) { continue; }

                var intervals = AcademyEnrolments.getStudentDisciplines(
                    charId, classId
                );
                if (!Array.isArray(intervals)) { continue; }

                var matching = [];
                for (var e = 0; e < intervals.length; e++) {
                    var entry = intervals[e];
                    if (entry &&
                        String(entry.disciplineId) === String(disciplineId)) {
                        matching.push(entry);
                    }
                }

                if (matching.length === 0) {
                    out.push(buildInvariant(
                        'membership-outside-enrolment',
                        'Group member ' + charId +
                        ' has no enrolment for the group\'s ' +
                        'class-discipline.',
                        {
                            groupId: group.id,
                            classId: classId,
                            disciplineId: disciplineId,
                            memberId: charId,
                            memberStartWeek: member.startWeek,
                            memberEndWeek: member.endWeek
                        }
                    ));
                    continue;
                }

                var covered = memberWindowCovered(
                    member.startWeek, member.endWeek, matching
                );
                if (!covered) {
                    out.push(buildInvariant(
                        'membership-outside-enrolment',
                        'Group member ' + charId +
                        ' has a membership window that is not ' +
                        'contained within their enrolment.',
                        {
                            groupId: group.id,
                            classId: classId,
                            disciplineId: disciplineId,
                            memberId: charId,
                            memberStartWeek: member.startWeek,
                            memberEndWeek: member.endWeek,
                            enrolmentIntervals: matching.slice()
                        }
                    ));
                }
            }
        }
    }

    function memberWindowCovered(memStart, memEnd, intervals) {
        if (memStart === null || memStart === undefined) {
            return false;
        }
        for (var i = 0; i < intervals.length; i++) {
            var entry = intervals[i];
            if (!entry) { continue; }
            var eStart = entry.startWeek;
            var eEnd = entry.endWeek;
            if (eStart === null || eStart === undefined) { continue; }
            if (rangeContained(memStart, memEnd, eStart, eEnd)) {
                return true;
            }
        }
        return false;
    }

    function checkSessionsAgainstGroups(groups, out) {
        var groupIds = Object.create(null);
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (isPlainObject(group) && isNonEmptyString(group.id)) {
                groupIds[String(group.id)] = group;
            }
        }

        var sessions = AcademyTeachingSessions.getAllSessions();
        if (!Array.isArray(sessions)) { return; }

        for (var s = 0; s < sessions.length; s++) {
            var session = sessions[s];
            if (!isPlainObject(session)) { continue; }

            var groupId = session.groupId;
            if (!isNonEmptyString(groupId)) {
                out.push(buildInvariant(
                    'session-group-missing',
                    'Session ' + session.id +
                    ' has no groupId.',
                    { sessionId: session.id }
                ));
                continue;
            }

            var group = groupIds[String(groupId)];
            if (!group) {
                out.push(buildInvariant(
                    'session-group-missing',
                    'Session ' + session.id +
                    ' references a group that does not exist.',
                    {
                        sessionId: session.id,
                        groupId: String(groupId)
                    }
                ));
                continue;
            }

            var sessionStart = session.startWeek;
            var sessionEnd = session.endWeek;
            var groupStart = group.startWeek;
            var groupEnd = group.endWeek;

            var contained = rangeContained(
                sessionStart, sessionEnd, groupStart, groupEnd
            );
            if (!contained) {
                out.push(buildInvariant(
                    'session-outside-group',
                    'Session ' + session.id +
                    ' window extends outside its group\'s window.',
                    {
                        sessionId: session.id,
                        groupId: String(groupId),
                        sessionStartWeek: sessionStart,
                        sessionEndWeek: sessionEnd,
                        groupStartWeek: groupStart,
                        groupEndWeek: groupEnd
                    }
                ));
            }
        }
    }

    function checkEmptyRosters(week, out) {
        var occurrences = Projector.projectWeek(week);
        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }
            if (!Array.isArray(occ.studentIds)) { continue; }
            if (occ.studentIds.length === 0) {
                out.push(buildInvariant(
                    'empty-roster',
                    'Session ' + occ.sessionId +
                    ' has no students for week ' + week + '.',
                    {
                        sessionId: occ.sessionId,
                        groupId: occ.groupId,
                        week: week
                    }
                ));
            }
        }
    }

    function buildInvariant(code, message, context) {
        return {
            kind: 'invariant',
            code: code,
            message: message,
            context: context || {}
        };
    }

    // ============================================================
    // FULL REPORT
    // ============================================================

    function validateClass(classId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null || !isNonEmptyString(classId)) {
            return {
                classId: null,
                week: null,
                weeklyHours: [],
                invariants: [],
                hasWarnings: false
            };
        }

        var weeklyHours = validateClassWeeklyHours(classId, weekNum);
        var invariants = validateInvariants(weekNum);

        var relevantInvariants = [];
        for (var i = 0; i < invariants.length; i++) {
            var w = invariants[i];
            var ctx = w.context || {};
            if (ctx.classId && String(ctx.classId) !== String(classId)) {
                continue;
            }
            relevantInvariants.push(w);
        }

        var hasWarnings =
            weeklyHoursHasProblems(weeklyHours) ||
            relevantInvariants.length > 0;

        return {
            classId: String(classId),
            week: weekNum,
            weeklyHours: weeklyHours,
            invariants: relevantInvariants,
            hasWarnings: hasWarnings
        };
    }

    function weeklyHoursHasProblems(weeklyHours) {
        for (var i = 0; i < weeklyHours.length; i++) {
            if (weeklyHours[i].status !== 'met') {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingValidation = Object.freeze({
        validateClassWeeklyHours: validateClassWeeklyHours,
        validateClassWeeklyHoursProblems:
            validateClassWeeklyHoursProblems,
        validateInvariants: validateInvariants,
        validateClass: validateClass
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingValidation;
        var missing = [];

        var required = [
            'validateClassWeeklyHours',
            'validateClassWeeklyHoursProblems',
            'validateInvariants',
            'validateClass'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (rangeContained(5, 10, 1, 20) !== true) {
                missing.push('rangeContained(5,10,1,20) !== true');
            }
            if (rangeContained(1, 10, 5, 20) !== false) {
                missing.push('rangeContained(1,10,5,20) !== false');
            }
            if (rangeContained(15, 30, 1, 20) !== false) {
                missing.push('rangeContained(15,30,1,20) !== false');
            }
            if (rangeContained(5, 10, 5, 10) !== true) {
                missing.push('rangeContained with equal bounds !== true');
            }
            if (rangeContained(5, null, 1, null) !== true) {
                missing.push('rangeContained with both open ends !== true');
            }
            if (rangeContained(5, null, 1, 20) !== false) {
                missing.push('rangeContained open inside closed !== false');
            }
            if (rangeContained(5, 10, 1, null) !== true) {
                missing.push('rangeContained closed inside open !== true');
            }
            if (rangeContained(null, 10, 1, 20) !== false) {
                missing.push('rangeContained with null inner start !== false');
            }
            if (rangeContained(5, 10, null, 20) !== false) {
                missing.push('rangeContained with null outer start !== false');
            }

            var intervals = [
                { startWeek: 1, endWeek: 5 },
                { startWeek: 10, endWeek: 20 }
            ];
            if (memberWindowCovered(12, 18, intervals) !== true) {
                missing.push('memberWindowCovered missed a containing interval');
            }
            if (memberWindowCovered(4, 12, intervals) !== false) {
                missing.push('memberWindowCovered accepted a straddling window');
            }
            if (memberWindowCovered(6, 9, intervals) !== false) {
                missing.push('memberWindowCovered accepted a window in the gap');
            }
            if (memberWindowCovered(10, 20, intervals) !== true) {
                missing.push('memberWindowCovered missed exact-match interval');
            }
            var openIntervals = [{ startWeek: 1, endWeek: null }];
            if (memberWindowCovered(5, null, openIntervals) !== true) {
                missing.push('memberWindowCovered missed open-ended match');
            }
            if (memberWindowCovered(5, 10, []) !== false) {
                missing.push('memberWindowCovered returned true with no intervals');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingValidation] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
