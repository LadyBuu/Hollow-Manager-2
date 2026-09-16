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
 *   Target of 0 or missing weeklyHours yields status 'met' when
 *   scheduledMinutes is 0 and 'over' otherwise. This is because a
 *   class-discipline with no target but with scheduled sessions is
 *   unusual and worth surfacing.
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
 *   - window.AcademyTeachingProjector
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.AcademyClassDisciplines
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
    var Projector = window.AcademyTeachingProjector;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var AcademyClassDisciplines = window.AcademyClassDisciplines;
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
    if (!Projector) {
        _missing.push('AcademyTeachingProjector (module)');
    } else {
        if (typeof Projector.projectWeek !== 'function') {
            _missing.push('AcademyTeachingProjector.projectWeek');
        }
        if (typeof Projector.rangeContainsWeek !== 'function') {
            _missing.push('AcademyTeachingProjector.rangeContainsWeek');
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
    if (!AcademyClassDisciplines) {
        _missing.push('AcademyClassDisciplines (module)');
    } else {
        if (typeof AcademyClassDisciplines.getClassDiscipline !== 'function') {
            _missing.push('AcademyClassDisciplines.getClassDiscipline');
        }
        if (typeof AcademyClassDisciplines.getEffectiveConfig !== 'function') {
            _missing.push('AcademyClassDisciplines.getEffectiveConfig');
        }
    }
    if (!AcademyEnrolments) {
        _missing.push('AcademyEnrolments (module)');
    } else {
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
    // WEEKLY HOURS VALIDATION
    // ============================================================

    /**
     * Compute the weekly-hours report for every enrolled student in
     * a class for a given week.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {array} Array of report entries.
     *   {
     *     classId, disciplineId, studentId, week,
     *     scheduledMinutes, targetMinutes,
     *     differenceMinutes, status
     *   }
     */
    function validateClassWeeklyHours(classId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null || !isNonEmptyString(classId)) {
            return [];
        }

        var target = String(classId);

        // Walk every enrolled student for this class. The enrolments
        // store knows which students are enrolled; each entry carries
        // the disciplineId plus its range. A student can be enrolled
        // in a discipline for part of the class's run; only students
        // whose enrolment covers the week contribute to that
        // discipline's report.
        var enrolments = AcademyEnrolments.getClassEnrolments(target);
        if (!enrolments || typeof enrolments !== 'object') {
            return [];
        }

        // Cache the scheduled minutes per (student, discipline).
        // The projector emits per-session occurrences with a
        // studentIds list; walking the projector once and
        // accumulating is much cheaper than calling
        // projectForStudent per student.
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
                // during the given week. getClassEnrolments returns
                // the deduplicated list of disciplines, without
                // ranges; the week check confirms the student is
                // actually enrolled this week.
                if (!AcademyEnrolments.isEnrolledInWeek(
                    studentId, target, disciplineId, weekNum
                )) {
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

        // Deterministic order: (disciplineId, studentId).
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
     * (classId, disciplineId) pair. Uses the effective config,
     * which falls back from the class-discipline's explicit value
     * to the discipline's default. When neither is set, the target
     * is 0.
     */
    function resolveTargetMinutes(classId, disciplineId) {
        var config = AcademyClassDisciplines.getEffectiveConfig(
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
     * 'met'. Useful for surfacing warnings in the UI.
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

    /**
     * Validate structural invariants across the teaching model.
     *
     * Returns an array of warning objects. Every check is
     * warning-only.
     *
     * Checks:
     *   1. Every group member's window must be contained within
     *      the corresponding enrolment window for the group's
     *      (class, discipline).
     *   2. Every session's window must be contained within its
     *      group's window.
     *   3. Every session's group must exist.
     *   4. Every session in the given week must have a non-empty
     *      roster (studentIds list from the projector).
     *
     * @param {number|string} week - Used for the empty-roster
     *   check. Pass null to skip that check.
     * @returns {array}
     */
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

                // Find enrolment intervals for this discipline.
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

                // The member's [start, end] must be contained within
                // at least one enrolment interval. If not, warn.
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
            if (memStart < eStart) { continue; }
            if (eEnd === null || eEnd === undefined) {
                // Ongoing enrolment covers any member window that
                // starts at or after eStart.
                return true;
            }
            if (memEnd === null || memEnd === undefined) {
                // Member has no end; enrolment must also have no end
                // for the window to be contained.
                if (eEnd === null || eEnd === undefined) {
                    return true;
                }
                continue;
            }
            if (memEnd <= eEnd) {
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

            // Session window must be contained within the group's
            // window.
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

    /**
     * Is [innerStart, innerEnd] contained within [outerStart, outerEnd]?
     * null on either outer bound means "unbounded on that side."
     */
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

        if (innerStart < outerStart) { return false; }

        var effInnerEnd = (innerEnd === null || innerEnd === undefined)
            ? CalendarConstants.MAX_WEEK
            : innerEnd;
        var effOuterEnd = (outerEnd === null || outerEnd === undefined)
            ? CalendarConstants.MAX_WEEK
            : outerEnd;

        if (effInnerEnd > effOuterEnd) { return false; }

        return true;
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

    /**
     * Full validation report for a class in a given week.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object} {
     *   classId,
     *   week,
     *   weeklyHours: array,
     *   invariants: array,
     *   hasWarnings: boolean
     * }
     */
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

        // The invariant checks are class-agnostic. Filter the ones
        // that are relevant to this class so a per-class report
        // does not carry warnings about other classes' groups.
        var relevantInvariants = [];
        for (var i = 0; i < invariants.length; i++) {
            var w = invariants[i];
            var ctx = w.context || {};
            if (ctx.classId && String(ctx.classId) !== String(classId)) {
                continue;
            }
            // Empty-roster and session-group-missing warnings do not
            // carry a classId; they are included regardless. If you
            // want stricter filtering, resolve the group's classId
            // and compare.
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
        // Weekly-hours
        validateClassWeeklyHours: validateClassWeeklyHours,
        validateClassWeeklyHoursProblems:
            validateClassWeeklyHoursProblems,

        // Invariants
        validateInvariants: validateInvariants,

        // Full report
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

        // Smoke test on the pure helper: rangeContained.
        try {
            if (rangeContained(5, 10, 1, 20) !== true) {
                missing.push('rangeContained(5,10,1,20) !== true');
            }
            if (rangeContained(1, 10, 5, 20) !== false) {
                missing.push('rangeContained(1,10,5,20) !== false');
            }
            if (rangeContained(5, 10, 5, 10) !== true) {
                missing.push('rangeContained with equal bounds !== true');
            }
            if (rangeContained(5, null, 1, null) !== true) {
                missing.push('rangeContained with open ends !== true');
            }
            if (rangeContained(5, null, 1, 20) !== false) {
                missing.push('rangeContained open inside closed !== false');
            }
            if (rangeContained(5, 10, 1, null) !== true) {
                missing.push('rangeContained closed inside open !== true');
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
