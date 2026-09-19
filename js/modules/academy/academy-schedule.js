/**
 * js/modules/academy/academy-schedule.js - Academy Schedule Coordinator
 *
 * Path: js/modules/academy/academy-schedule.js
 *
 * The compound-mutation coordinator for the Academy teaching model.
 *
 * WHAT THIS MODULE OWNS:
 *   Operations that touch two or more of the teaching-model stores
 *   in a single transaction:
 *
 *     addClassDiscipline        create a class-discipline marker and
 *                               auto-enrol every active student
 *     removeClassDiscipline     remove a class-discipline marker and
 *                               end every downstream window (groups,
 *                               sessions, enrolments)
 *     scheduleGroupMeeting      create a teaching session with a
 *                               blocking collision check
 *     addStudentToTeachingGroup add a member to a group, validating
 *                               enrolment and elimination
 *     dropStudentFromClass      end every enrolment and membership
 *                               for a character in a class, and
 *                               remove the classId from the character
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Single-store reads             (AcademyClassDisciplines,
 *                                     AcademyEnrolments, etc.)
 *   - Single-store writes            (the same modules)
 *   - Projection                     (AcademyTeachingProjector)
 *   - Collision reporting            (AcademyTeachingCollisions)
 *   - Validation warnings            (AcademyTeachingValidation)
 *   - Rendering                      (views)
 *   - Calendar provider bridging     (retired)
 *
 * TRANSACTION MODEL:
 *   Every public function here is a single MutationPipeline.performMutation
 *   call. It either fully succeeds or fully rolls back. Partial success
 *   is not a possible outcome.
 *
 *   Reads performed during validation use the pipeline's appData snapshot,
 *   not window.data. Because MutationPipeline serialises mutations, the
 *   snapshot is stable for the duration of the transaction.
 *
 * WEEK SEMANTICS (INCLUSIVE BOUNDS):
 *   All week ranges are inclusive on both ends.
 *
 *   `endWeek === null` means "ongoing" (no bound).
 *
 *   The "end this effective week N" convention is:
 *
 *       endWeek = N - 1
 *
 *   Because endWeek is inclusive. If you say "stop at week 10",
 *   the record runs through week 9. If you say "the offering
 *   finished at the end of week 10", you pass effectiveWeek = 11.
 *
 *   This is the same convention used by every end* helper in the
 *   teaching-model modules (AcademyTeachingGroups.endGroup,
 *   AcademyTeachingSessions.endSession, AcademyEnrolments.leave).
 *
 * DISCIPLINE WINDOW (v27):
 *   A class-discipline marker has no window. The discipline entity
 *   owns startWeek / endWeek. When auto-enrolling students in a
 *   newly-offered class-discipline, the enrolment window is the
 *   discipline's window. This is a change from pre-v27, where the
 *   class-discipline carried its own startWeek / endWeek and the
 *   auto-enrolment used those.
 *
 * ROSTER SEMANTICS:
 *   "Active students in a class" is defined as:
 *
 *     CharacterQueries.getCharacters()
 *       filtered by character.classIds.includes(classId)
 *       minus the class's instructorId
 *
 *   This is what AcademyAggregator.getClassStudentsViewModel returns.
 *   The coordinator uses that function so the roster in the auto-
 *   enrolment path and the roster in the UI always agree.
 *
 *   AcademyAggregator is accessed LAZILY. The load order in
 *   index.html does not need to place the aggregator before this
 *   module; the roster lookup resolves the aggregator at call time.
 *   See getAcademyAggregator() below.
 *
 * ELIMINATION SEMANTICS:
 *   A student eliminated in week N is available during week N and
 *   unavailable from week N+1 onward. This is the same boundary rule
 *   used everywhere else in the codebase (EliminationQueries owns it).
 *
 *   An auto-enrolment skips a student when:
 *
 *     isCharacterEliminatedByWeek(charId, classDisciplineStartWeek)
 *
 *   is true. Elimination at exactly the start week does not skip the
 *   student; they are still available during that week.
 *
 * COLLISION POLICY:
 *   When scheduling a group meeting, the coordinator checks for:
 *
 *     - Instructor collision    (same instructor, overlapping time)
 *     - Student collision       (same student, overlapping time)
 *
 *   Both are BLOCKING by default. When one is detected, the mutation
 *   is rejected without writing. The caller receives a structured
 *   result with `reason: 'instructor_collision'` or `'student_collision'`,
 *   plus the details needed to show a confirmation modal. If the user
 *   confirms, the caller re-invokes with `allowCollisions: true`.
 *
 *   Location collisions are NOT checked. Rooms may be double-booked
 *   without warning, error, or constraint.
 *
 * STORE SHAPES (v27):
 *   academy.classDisciplines[classId][disciplineId] = {
 *     classId, disciplineId, mandatory, createdAt, updatedAt
 *   }
 *
 *   academy.enrolments[classId][charId] = [
 *     { disciplineId, startWeek, endWeek }
 *   ]
 *
 *   academy.teachingGroups[groupId] = {
 *     id, classId, disciplineId, instructorId,
 *     groupNumber, customName,
 *     members: [{ characterId, startWeek, endWeek }],
 *     startWeek, endWeek, createdAt, updatedAt
 *   }
 *
 *   academy.teachingSessions[sessionId] = {
 *     id, groupId, day, startTime, duration, locationId,
 *     startWeek, endWeek, createdAt, updatedAt
 *   }
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.AcademyClassDisciplines
 *   - window.AcademyEnrolments
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.CharacterQueries
 *   - window.EliminationQueries
 *
 * DEPENDENCIES (LAZY):
 *   - window.AcademyAggregator  — resolved at call time by
 *                                 getClassRoster(). Not required at
 *                                 load time.
 *
 * USAGE:
 *   AcademySchedule.addClassDiscipline('class_1', 'disc_en', {
 *       mandatory: true
 *   }).then(function(result) { ... });
 *
 *   AcademySchedule.scheduleGroupMeeting('tgroup_1', {
 *       day: 1, startTime: 9, duration: 2, startWeek: 1, endWeek: 12
 *   }).then(function(result) {
 *       if (!result.success && result.reason === 'instructor_collision') {
 *           // Show the confirmation modal using result.data.collision
 *       }
 *   });
 */

(function() {
    'use strict';

    if (window.__academyScheduleLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyClassDisciplines = window.AcademyClassDisciplines;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var CharacterQueries = window.CharacterQueries;
    var EliminationQueries = window.EliminationQueries;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================
    //
    // AcademyAggregator is not captured at load time. The load
    // order in index.html does not need to place it before this
    // module. getAcademyAggregator() resolves it on first use.

    function getAcademyAggregator() {
        return window.AcademyAggregator || null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils || typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.getClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplines.getClassDiscipline');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
        _missing.push('AcademyEnrolments.getStudentDisciplines');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyTeachingSessions ||
        typeof AcademyTeachingSessions.getAllSessions !== 'function') {
        _missing.push('AcademyTeachingSessions.getAllSessions');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.isCharacterEliminatedByWeek !== 'function') {
        _missing.push('EliminationQueries.isCharacterEliminatedByWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademySchedule] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyScheduleLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademySchedule] deepClone returned the original reference.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    /**
     * Parse a week strictly. Integer or integer-string, in
     * [MIN_WEEK, MAX_WEEK]. No coercion, no fallback.
     */
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
     * Does the given week fall inside [startWeek, endWeek]?
     * endWeek === null means "ongoing".
     */
    function weekInRange(week, startWeek, endWeek) {
        if (startWeek === null || startWeek === undefined) {
            return false;
        }
        if (week < startWeek) {
            return false;
        }
        if (endWeek !== null && endWeek !== undefined && week > endWeek) {
            return false;
        }
        return true;
    }

    /**
     * Do two week ranges overlap? null endWeek means "ongoing",
     * treated as MAX_WEEK.
     */
    function weekRangesOverlap(startA, endA, startB, endB) {
        if (startA === null || startA === undefined) { return false; }
        if (startB === null || startB === undefined) { return false; }

        var effEndA = (endA === null || endA === undefined) ? MAX_WEEK : endA;
        var effEndB = (endB === null || endB === undefined) ? MAX_WEEK : endB;

        return startA <= effEndB && startB <= effEndA;
    }

    /**
     * Get the appData academy snapshot, or null.
     */
    function getAcademySnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        return appData.academy;
    }

    /**
     * Ensure a class-scoped bucket exists in an academy snapshot.
     * Caller passes the store name ('enrolments', 'classDisciplines').
     */
    function ensureClassBucket(academy, storeName, classId) {
        var store = academy[storeName];
        if (!isPlainObject(store)) {
            store = {};
            academy[storeName] = store;
        }
        if (!isPlainObject(store[classId])) {
            store[classId] = {};
        }
        return store[classId];
    }

    /**
     * Get the class's active roster (students only, instructor
     * excluded). Uses AcademyAggregator so the roster is always
     * consistent with the UI.
     *
     * LAZY: AcademyAggregator is resolved at call time. If it's
     * not yet loaded, this returns an empty roster and warns. The
     * caller (addClassDiscipline) will then enrol nobody. That is
     * a safe degradation: a class-discipline is created without
     * auto-enrolment rather than the mutation failing outright.
     */
    function getClassRoster(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var Aggregator = getAcademyAggregator();
        if (!Aggregator ||
            typeof Aggregator.getClassStudentsViewModel !== 'function') {
            console.warn(
                '[AcademySchedule] AcademyAggregator.getClassStudentsViewModel ' +
                'is not available. Auto-enrolment will be skipped.'
            );
            return [];
        }
        try {
            return Aggregator.getClassStudentsViewModel(classId) || [];
        } catch (e) {
            console.warn(
                '[AcademySchedule] getClassStudentsViewModel failed:', e
            );
            return [];
        }
    }

    // ============================================================
    // COLLISION DETECTION
    // ============================================================

    /**
     * Do two session time-slots overlap?
     *
     * Sessions are on the same day, and their [start, end) intervals
     * overlap. Both use inclusive start, exclusive end. A session
     * at 9am for 2 hours runs [9, 11). A session at 11am for 1 hour
     * runs [11, 12). They do not overlap.
     *
     * Week ranges must also overlap. A Monday 9am session in weeks
     * 1-4 and a Monday 9am session in weeks 5-8 do not collide.
     */
    function sessionsOverlap(a, b) {
        if (!a || !b) { return false; }
        if (a.day !== b.day) { return false; }

        var aStart = a.startTime;
        var aEnd = a.startTime + a.duration;
        var bStart = b.startTime;
        var bEnd = b.startTime + b.duration;

        var timeOverlap = aStart < bEnd && bStart < aEnd;
        if (!timeOverlap) { return false; }

        return weekRangesOverlap(
            a.startWeek, a.endWeek,
            b.startWeek, b.endWeek
        );
    }

    /**
     * Get the group's active member IDs at a given week. Used to
     * check whether a conflicting session shares a student with the
     * candidate session.
     */
    function getGroupActiveMembersAtWeek(groupId, week) {
        if (!isNonEmptyString(groupId)) {
            return [];
        }
        try {
            return AcademyTeachingGroups.getActiveMembers(groupId, week) || [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Find the first conflicting session for an instructor.
     *
     * Walks every session in the store. For each session whose
     * group has the given instructorId, checks whether it overlaps
     * the candidate. Returns the conflicting session plus its group
     * context, or null if none.
     */
    function findInstructorCollision(instructorId, candidate, excludeGroupId) {
        if (!isNonEmptyString(instructorId)) {
            return null;
        }

        var allSessions = AcademyTeachingSessions.getAllSessions() || [];

        for (var i = 0; i < allSessions.length; i++) {
            var session = allSessions[i];
            if (!isPlainObject(session)) { continue; }

            // Skip sessions that belong to the group we're adding to.
            // A group cannot collide with itself.
            if (excludeGroupId &&
                String(session.groupId) === String(excludeGroupId)) {
                continue;
            }

            // Resolve the session's group to check the instructor.
            var group = null;
            try {
                group = AcademyTeachingGroups.getGroup(session.groupId);
            } catch (e) {
                group = null;
            }
            if (!group) { continue; }
            if (String(group.instructorId) !== String(instructorId)) {
                continue;
            }

            if (sessionsOverlap(session, candidate)) {
                return {
                    session: session,
                    group: group
                };
            }
        }

        return null;
    }

    /**
     * Find the first conflicting session that shares a student with
     * the candidate group.
     *
     * Strategy:
     *   1. Get the candidate group's active members at each week in
     *      the candidate session's range. That's the set of students
     *      who'd be in the meeting.
     *   2. Walk every session. For each session whose week range
     *      overlaps the candidate's, check time overlap, then check
     *      whether that session's group shares any active member
     *      with the candidate group.
     */
    function findStudentCollision(candidateGroupId, candidate) {
        if (!isNonEmptyString(candidateGroupId)) {
            return null;
        }

        // Which weeks do we need to check? The candidate's range,
        // clamped to the calendar's bounds.
        var startWeek = candidate.startWeek;
        var endWeek = (candidate.endWeek === null || candidate.endWeek === undefined)
            ? MAX_WEEK
            : candidate.endWeek;

        // Build the candidate group's active-student set at every
        // week in the range. This is O(weeks * members) which is
        // fine for realistic sizes.
        var candidateStudentsByWeek = {};
        for (var w = startWeek; w <= endWeek; w++) {
            candidateStudentsByWeek[w] = getGroupActiveMembersAtWeek(
                candidateGroupId, w
            );
        }

        var allSessions = AcademyTeachingSessions.getAllSessions() || [];

        for (var i = 0; i < allSessions.length; i++) {
            var session = allSessions[i];
            if (!isPlainObject(session)) { continue; }

            if (String(session.groupId) === String(candidateGroupId)) {
                continue;
            }

            if (!sessionsOverlap(session, candidate)) {
                continue;
            }

            // Determine the overlap window of weeks.
            var sStart = session.startWeek;
            var sEnd = (session.endWeek === null || session.endWeek === undefined)
                ? MAX_WEEK
                : session.endWeek;

            var overlapStart = Math.max(startWeek, sStart);
            var overlapEnd = Math.min(endWeek, sEnd);

            for (var wk = overlapStart; wk <= overlapEnd; wk++) {
                var candidateStudents = candidateStudentsByWeek[wk] || [];
                if (candidateStudents.length === 0) { continue; }

                var otherStudents = getGroupActiveMembersAtWeek(
                    session.groupId, wk
                );
                if (otherStudents.length === 0) { continue; }

                var shared = findSharedStudent(
                    candidateStudents, otherStudents
                );
                if (shared !== null) {
                    // Resolve the conflicting group for context.
                    var conflictingGroup = null;
                    try {
                        conflictingGroup = AcademyTeachingGroups.getGroup(
                            session.groupId
                        );
                    } catch (e) {
                        conflictingGroup = null;
                    }

                    return {
                        session: session,
                        group: conflictingGroup,
                        studentId: shared,
                        week: wk
                    };
                }
            }
        }

        return null;
    }

    /**
     * Return the first shared string in two arrays, or null.
     */
    function findSharedStudent(a, b) {
        for (var i = 0; i < a.length; i++) {
            var target = String(a[i]);
            for (var j = 0; j < b.length; j++) {
                if (String(b[j]) === target) {
                    return target;
                }
            }
        }
        return null;
    }

    /**
     * Run the collision check and return a structured rejection
     * object if a collision exists, or null if clean.
     *
     * The rejection shape is:
     *   {
     *     success: false,
     *     reason: 'instructor_collision' | 'student_collision',
     *     message: <human-readable>,
     *     data: { collision: { ... } }
     *   }
     */
    function buildCollisionRejection(candidateGroupId, group, candidate) {
        var instructorId = group.instructorId;

        var instructorCollision = findInstructorCollision(
            instructorId, candidate, candidateGroupId
        );
        if (instructorCollision) {
            var instructorName = 'The instructor';
            try {
                var instrChar = CharacterQueries.getCharacterById(instructorId);
                if (instrChar) {
                    instructorName = CharacterQueries.getDisplayName(instrChar);
                }
            } catch (e) {
                // Keep the fallback name.
            }

            return {
                success: false,
                reason: 'instructor_collision',
                message: instructorName +
                    ' is already teaching during this time slot.',
                data: {
                    collision: {
                        type: 'instructor',
                        instructorId: instructorId,
                        instructorName: instructorName,
                        conflictingSession: instructorCollision.session,
                        conflictingGroup: instructorCollision.group
                    }
                }
            };
        }

        var studentCollision = findStudentCollision(
            candidateGroupId, candidate
        );
        if (studentCollision) {
            var studentName = 'A student';
            try {
                var studChar = CharacterQueries.getCharacterById(
                    studentCollision.studentId
                );
                if (studChar) {
                    studentName = CharacterQueries.getDisplayName(studChar);
                }
            } catch (e) {
                // Keep the fallback name.
            }

            return {
                success: false,
                reason: 'student_collision',
                message: studentName +
                    ' already has a session during this time slot.',
                data: {
                    collision: {
                        type: 'student',
                        studentId: studentCollision.studentId,
                        studentName: studentName,
                        week: studentCollision.week,
                        conflictingSession: studentCollision.session,
                        conflictingGroup: studentCollision.group
                    }
                }
            };
        }

        return null;
    }

    // ============================================================
    // addClassDiscipline
    // ============================================================

    /**
     * Create a class-discipline marker. If the marker is mandatory,
     * auto-enrol every active student in the class.
     *
     * "Active student" means:
     *   - In the class roster (character.classIds includes classId)
     *   - Not the class instructor
     *   - Not eliminated as of the discipline's startWeek
     *
     * THE ENROLMENT WINDOW (v27):
     *   The marker has no window. The window comes from the
     *   DISCIPLINE. A discipline with startWeek 1 and endWeek 24
     *   produces enrolments spanning weeks 1–24.
     *
     *   When the discipline has no valid startWeek, the mutation
     *   fails. A class-discipline without a discipline window
     *   cannot be auto-enrolled sensibly, and silently picking
     *   MIN_WEEK would hide the data problem.
     *
     * CONFIG SHAPE (v27):
     *   config = { mandatory?: boolean }
     *
     *   This is a change from pre-v27, where config also carried
     *   startWeek, endWeek, weeklyHours, weight, gradeSchemeId,
     *   assessmentWeights, and instructorIds. None of those belong
     *   on a marker. Passing any of them is rejected with a clear
     *   message rather than silently ignored — a caller still on
     *   the old shape needs to know.
     *
     * One transaction. All-or-nothing.
     *
     * @param {string} classId
     * @param {string} disciplineId
     * @param {object} [config] { mandatory?: boolean }
     * @returns {Promise<{success, data?, message?}>}
     */
    function addClassDiscipline(classId, disciplineId, config) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        config = isPlainObject(config) ? config : {};

        // Reject retired config fields explicitly. A caller still
        // on the pre-v27 shape gets a message that names the field,
        // rather than a silent drop.
        var retiredFields = [
            'startWeek', 'endWeek', 'weeklyHours', 'weight',
            'gradeSchemeId', 'assessmentWeights', 'instructorIds'
        ];
        for (var rf = 0; rf < retiredFields.length; rf++) {
            if (Object.prototype.hasOwnProperty.call(config, retiredFields[rf])) {
                return Promise.resolve(failure(
                    'Config field "' + retiredFields[rf] +
                    '" is no longer supported on addClassDiscipline. ' +
                    'Discipline config lives on the discipline. ' +
                    'Instructor assignment is expressed through enrolments.'
                ));
            }
        }

        if (config.mandatory !== undefined &&
            typeof config.mandatory !== 'boolean') {
            return Promise.resolve(failure('Mandatory must be a boolean.'));
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        // The enrolment window comes from the discipline.
        var startWeek = parseWeekStrict(discipline.startWeek);
        if (startWeek === null) {
            return Promise.resolve(failure(
                'Discipline has no valid startWeek. Set the discipline\'s ' +
                'start week before adding it to a class.'
            ));
        }

        var endWeek = null;
        if (discipline.endWeek !== undefined &&
            discipline.endWeek !== null &&
            discipline.endWeek !== '') {
            endWeek = parseWeekStrict(discipline.endWeek);
            if (endWeek === null) {
                return Promise.resolve(failure(
                    'Discipline has an invalid endWeek.'
                ));
            }
            if (endWeek < startWeek) {
                return Promise.resolve(failure(
                    'Discipline endWeek cannot be before its startWeek.'
                ));
            }
        }

        var existing = AcademyClassDisciplines.getClassDiscipline(
            classId, disciplineId
        );
        if (existing) {
            return Promise.resolve(failure(
                'This class already offers this discipline.'
            ));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        // Mandatory default: fall back to the discipline's type.
        var isMandatory;
        if (typeof config.mandatory === 'boolean') {
            isMandatory = config.mandatory;
        } else {
            isMandatory = (discipline.type === 'mandatory');
        }

        // Compute the enrolment list during validate. Everything
        // that can fail is checked here, before any writes.
        var plan = null;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    return {
                        valid: false,
                        message: 'Academy store is not available.'
                    };
                }

                var cdStore = academy.classDisciplines;
                if (isPlainObject(cdStore) &&
                    isPlainObject(cdStore[targetClass]) &&
                    cdStore[targetClass][targetDiscipline]) {
                    return {
                        valid: false,
                        message: 'This class already offers this discipline.'
                    };
                }

                plan = buildAddClassDisciplinePlan(
                    targetClass,
                    targetDiscipline,
                    isMandatory,
                    startWeek,
                    endWeek
                );

                if (!plan) {
                    return {
                        valid: false,
                        message: 'Failed to build class-discipline plan.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                if (!plan) {
                    throw new Error('Plan was not built.');
                }

                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                // 1. Write the marker record.
                var cdBucket = ensureClassBucket(
                    academy, 'classDisciplines', targetClass
                );
                cdBucket[targetDiscipline] = deepClone(plan.marker);

                // 2. Write enrolments for mandatory offerings.
                if (plan.isMandatory && plan.enrolledCharIds.length > 0) {
                    var enrBucket = ensureClassBucket(
                        academy, 'enrolments', targetClass
                    );
                    for (var i = 0; i < plan.enrolledCharIds.length; i++) {
                        var charId = plan.enrolledCharIds[i];
                        if (!Array.isArray(enrBucket[charId])) {
                            enrBucket[charId] = [];
                        }
                        enrBucket[charId].push({
                            disciplineId: targetDiscipline,
                            startWeek: startWeek,
                            endWeek: endWeek
                        });
                    }
                }

                return {
                    marker: plan.marker,
                    isMandatory: plan.isMandatory,
                    studentsEnrolled: plan.enrolledCharIds.length,
                    studentsSkipped: plan.skippedCharIds.length
                };
            },
            logMessage: function(result) {
                var msg = 'Created class-discipline: ' +
                    (cls.name || targetClass) + ' / ' +
                    (discipline.name || targetDiscipline);
                if (result.isMandatory && result.studentsEnrolled > 0) {
                    msg += ' (' + result.studentsEnrolled +
                        ' student' + (result.studentsEnrolled === 1 ? '' : 's') +
                        ' enrolled)';
                }
                return msg;
            },
            successMessage: function(result) {
                if (result.isMandatory && result.studentsEnrolled > 0) {
                    return 'Class-discipline created. ' +
                        result.studentsEnrolled +
                        ' student' + (result.studentsEnrolled === 1 ? '' : 's') +
                        ' enrolled.';
                }
                return 'Class-discipline created.';
            },
            failureMessage: 'Failed to create class-discipline.'
        });
    }

    /**
     * Build the plan for addClassDiscipline. Pure — no writes.
     *
     * Returns { marker, isMandatory, enrolledCharIds, skippedCharIds }
     * or null on malformed input.
     */
    function buildAddClassDisciplinePlan(
        classId,
        disciplineId,
        isMandatory,
        startWeek,
        endWeek
    ) {
        var now = new Date().toISOString();

        var marker = {
            classId: classId,
            disciplineId: disciplineId,
            mandatory: isMandatory,
            createdAt: now,
            updatedAt: now
        };

        var enrolledCharIds = [];
        var skippedCharIds = [];

        if (isMandatory) {
            var roster = getClassRoster(classId);
            for (var i = 0; i < roster.length; i++) {
                var student = roster[i];
                if (!student || !student.id) { continue; }
                var studentId = String(student.id);

                // Skip eliminated students. Elimination at exactly
                // the start week does NOT skip them; they are still
                // available during that week.
                var eliminated = false;
                try {
                    eliminated = EliminationQueries.isCharacterEliminatedByWeek(
                        studentId, startWeek
                    ) === true;
                } catch (e) {
                    // If the check fails, we default to NOT skipping.
                    // An unexplained elimination query failure
                    // shouldn't silently drop students from their own
                    // class.
                    eliminated = false;
                }

                if (eliminated) {
                    skippedCharIds.push(studentId);
                } else {
                    enrolledCharIds.push(studentId);
                }
            }
        }

        return {
            marker: marker,
            isMandatory: isMandatory,
            enrolledCharIds: enrolledCharIds,
            skippedCharIds: skippedCharIds
        };
    }

    // ============================================================
    // removeClassDiscipline
    // ============================================================

    /**
     * Remove a class-discipline marker and end everything downstream.
     *
     * Under v27 there is no per-class window to end — the marker
     * simply goes away. But every student enrolment, every teaching
     * group, and every teaching session for that class-discipline
     * is truncated at effectiveWeek so that history survives.
     *
     * effectiveWeek is the first week that is NOT covered by the
     * offering. A group with startWeek 1 and endWeek null ends up
     * with endWeek = effectiveWeek - 1.
     *
     * In one transaction it:
     *   - Removes the class-discipline marker.
     *   - Ends every teaching group for the class-discipline.
     *   - Ends every session for those groups.
     *   - Ends every student's enrolment interval in the class-
     *     discipline.
     *
     * Note on ordering: the marker is removed first because the
     * downstream steps read the groups via classId+disciplineId
     * rather than through the marker. Removing the marker first
     * does not break them.
     *
     * One transaction. All-or-nothing.
     *
     * @param {string} classId
     * @param {string} disciplineId
     * @param {number|string} effectiveWeek
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeClassDiscipline(classId, disciplineId, effectiveWeek) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var week = parseWeekStrict(effectiveWeek);
        if (week === null) {
            return Promise.resolve(failure(
                'Valid effective week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var existing = AcademyClassDisciplines.getClassDiscipline(
            classId, disciplineId
        );
        if (!existing) {
            return Promise.resolve(failure(
                'This class does not offer this discipline.'
            ));
        }

        // Sanity: the caller cannot end the offering before the
        // discipline begins. The discipline's window is the source
        // of truth.
        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (discipline) {
            var discStartWeek = parseWeekStrict(discipline.startWeek);
            if (discStartWeek !== null && (week - 1) < discStartWeek) {
                return Promise.resolve(failure(
                    'Effective week would end the offering before the ' +
                    'discipline begins.'
                ));
            }
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var endWeek = week - 1;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    return {
                        valid: false,
                        message: 'Academy store is not available.'
                    };
                }
                var cdBucket = academy.classDisciplines &&
                    academy.classDisciplines[targetClass];
                if (!isPlainObject(cdBucket) ||
                    !cdBucket[targetDiscipline]) {
                    return {
                        valid: false,
                        message: 'Class-discipline no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                var stats = {
                    markerRemoved: false,
                    groupsEnded: 0,
                    sessionsEnded: 0,
                    enrolmentsEnded: 0
                };

                // 1. Remove the marker.
                var cdBucket = academy.classDisciplines[targetClass];
                if (isPlainObject(cdBucket) &&
                    cdBucket[targetDiscipline]) {
                    delete cdBucket[targetDiscipline];
                    if (Object.keys(cdBucket).length === 0) {
                        delete academy.classDisciplines[targetClass];
                    }
                    stats.markerRemoved = true;
                }

                // 2. Truncate every teaching group for this class-discipline.
                var groupIds = [];
                if (isPlainObject(academy.teachingGroups)) {
                    Object.keys(academy.teachingGroups).forEach(function(gid) {
                        var g = academy.teachingGroups[gid];
                        if (!isPlainObject(g)) { return; }
                        if (String(g.classId) !== targetClass) { return; }
                        if (String(g.disciplineId) !== targetDiscipline) { return; }
                        groupIds.push(gid);
                    });
                }

                for (var i = 0; i < groupIds.length; i++) {
                    var group = academy.teachingGroups[groupIds[i]];
                    if (!isPlainObject(group)) { continue; }
                    if (group.endWeek === null ||
                        group.endWeek === undefined ||
                        group.endWeek >= week) {
                        if (group.startWeek < week) {
                            group.endWeek = endWeek;
                            group.updatedAt = new Date().toISOString();
                            stats.groupsEnded++;
                        }
                    }
                }

                // 3. Truncate every session for those groups.
                if (isPlainObject(academy.teachingSessions)) {
                    var groupIdSet = Object.create(null);
                    for (var gk = 0; gk < groupIds.length; gk++) {
                        groupIdSet[String(groupIds[gk])] = true;
                    }

                    Object.keys(academy.teachingSessions).forEach(function(sid) {
                        var session = academy.teachingSessions[sid];
                        if (!isPlainObject(session)) { return; }
                        if (!groupIdSet[String(session.groupId)]) { return; }
                        if (session.endWeek === null ||
                            session.endWeek === undefined ||
                            session.endWeek >= week) {
                            if (session.startWeek < week) {
                                session.endWeek = endWeek;
                                session.updatedAt = new Date().toISOString();
                                stats.sessionsEnded++;
                            }
                        }
                    });
                }

                // 4. Truncate every student's enrolment in this class-discipline.
                var enrBucket = academy.enrolments &&
                    academy.enrolments[targetClass];
                if (isPlainObject(enrBucket)) {
                    Object.keys(enrBucket).forEach(function(charId) {
                        var intervals = enrBucket[charId];
                        if (!Array.isArray(intervals)) { return; }
                        for (var k = 0; k < intervals.length; k++) {
                            var entry = intervals[k];
                            if (!entry) { continue; }
                            if (String(entry.disciplineId) !== targetDiscipline) {
                                continue;
                            }
                            if (entry.endWeek === null ||
                                entry.endWeek === undefined ||
                                entry.endWeek >= week) {
                                if (entry.startWeek < week) {
                                    entry.endWeek = endWeek;
                                    stats.enrolmentsEnded++;
                                }
                            }
                        }
                    });
                }

                return stats;
            },
            logMessage: function(result) {
                var parts = [];
                if (result.groupsEnded > 0) {
                    parts.push(result.groupsEnded + ' group(s)');
                }
                if (result.sessionsEnded > 0) {
                    parts.push(result.sessionsEnded + ' session(s)');
                }
                if (result.enrolmentsEnded > 0) {
                    parts.push(result.enrolmentsEnded + ' enrolment(s)');
                }
                var suffix = parts.length > 0
                    ? ' (' + parts.join(', ') + ')'
                    : '';
                return 'Removed class-discipline: ' + targetClass +
                    ' / ' + targetDiscipline + suffix;
            },
            successMessage: 'Class-discipline removed.',
            failureMessage: 'Failed to remove class-discipline.'
        });
    }

    // ============================================================
    // scheduleGroupMeeting
    // ============================================================

    /**
     * Create a teaching session for a group, with a blocking
     * collision check.
     *
     * COLLISION BEHAVIOUR:
     *   By default (collisionMode: 'block'), the coordinator runs
     *   an instructor collision check and a student collision check.
     *   If either fires, the mutation is rejected WITHOUT writing.
     *   The resolved result carries:
     *     success: false
     *     reason: 'instructor_collision' | 'student_collision'
     *     data.collision: { ... details ... }
     *
     *   The caller is expected to show a confirmation modal and
     *   re-invoke with allowCollisions: true on confirmation.
     *
     *   Set collisionMode: 'ignore' to skip the check entirely.
     *   Set allowCollisions: true to bypass a would-be block.
     *
     * LOCATION COLLISIONS ARE NEVER CHECKED.
     *   Rooms may be double-booked silently. If a location is
     *   provided, it's stored on the session as-is.
     *
     * One transaction. All-or-nothing.
     *
     * @param {string} groupId
     * @param {object} config
     *   { day, startTime, duration, locationId, startWeek, endWeek,
     *     collisionMode, allowCollisions }
     * @returns {Promise<{success, data?, message?, reason?}>}
     */
    function scheduleGroupMeeting(groupId, config) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }
        if (!isPlainObject(config)) {
            return Promise.resolve(failure('Config must be an object.'));
        }

        var group = AcademyTeachingGroups.getGroup(groupId);
        if (!group) {
            return Promise.resolve(failure('Teaching group not found.'));
        }

        var day = CalendarValidation.parseDay(config.day);
        if (day === null) {
            return Promise.resolve(failure(
                'Valid day is required (' +
                CalendarConstants.MIN_DAY + '-' +
                CalendarConstants.MAX_DAY + ').'
            ));
        }

        var startTime = CalendarValidation.parseHour(config.startTime);
        if (startTime === null) {
            return Promise.resolve(failure(
                'Valid start time is required (' +
                CalendarConstants.MIN_HOUR + '-' +
                CalendarConstants.MAX_HOUR + ').'
            ));
        }

        var duration = CalendarValidation.parseDuration(config.duration);
        if (duration === null) {
            return Promise.resolve(failure(
                'Duration must be between ' +
                CalendarConstants.MIN_CLASS_DURATION + ' and ' +
                CalendarConstants.MAX_CLASS_DURATION + ' hours.'
            ));
        }

        if (startTime + duration > CalendarConstants.MAX_HOUR + 1) {
            return Promise.resolve(failure(
                'Session extends beyond the end of the day.'
            ));
        }

        var rangeStart = parseWeekStrict(config.startWeek);
        if (rangeStart === null) {
            return Promise.resolve(failure(
                'Valid week range is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var rangeEnd = null;
        if (config.endWeek !== undefined &&
            config.endWeek !== null &&
            config.endWeek !== '') {
            rangeEnd = parseWeekStrict(config.endWeek);
            if (rangeEnd === null) {
                return Promise.resolve(failure(
                    'Valid week range is required (' +
                    MIN_WEEK + '-' + MAX_WEEK + ').'
                ));
            }
            if (rangeEnd < rangeStart) {
                return Promise.resolve(failure(
                    'End week cannot be before start week.'
                ));
            }
        }

        // Collision mode resolution.
        var collisionMode = 'block';
        if (config.collisionMode === 'ignore') {
            collisionMode = 'ignore';
        }
        if (config.allowCollisions === true) {
            collisionMode = 'ignore';
        }

        var locationId = isNonEmptyString(config.locationId)
            ? String(config.locationId)
            : null;

        var targetGroup = String(groupId);

        // ---- Collision check runs BEFORE the transaction ----
        if (collisionMode === 'block') {
            var candidate = {
                day: day,
                startTime: startTime,
                duration: duration,
                startWeek: rangeStart,
                endWeek: rangeEnd
            };

            var rejection = buildCollisionRejection(
                targetGroup, group, candidate
            );
            if (rejection) {
                return Promise.resolve(rejection);
            }
        }

        var sessionId = IdUtils.generateId('tsession');
        var now = new Date().toISOString();

        var newSession = {
            id: sessionId,
            groupId: targetGroup,
            day: day,
            startTime: startTime,
            duration: duration,
            locationId: locationId,
            startWeek: rangeStart,
            endWeek: rangeEnd,
            createdAt: now,
            updatedAt: now
        };

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    return {
                        valid: false,
                        message: 'Academy store is not available.'
                    };
                }
                if (!isPlainObject(academy.teachingGroups) ||
                    !academy.teachingGroups[targetGroup]) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                if (isPlainObject(academy.teachingSessions) &&
                    academy.teachingSessions[sessionId]) {
                    return {
                        valid: false,
                        message: 'Session ID collision.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }
                if (!isPlainObject(academy.teachingSessions)) {
                    academy.teachingSessions = {};
                }
                academy.teachingSessions[sessionId] = deepClone(newSession);
                return {
                    session: newSession,
                    sessionId: sessionId
                };
            },
            logMessage: 'Scheduled group meeting for group ' + targetGroup +
                ' on day ' + day + ' at ' + startTime,
            successMessage: 'Session scheduled.',
            failureMessage: 'Failed to schedule session.'
        });
    }

    // ============================================================
    // addStudentToTeachingGroup
    // ============================================================

    /**
     * Add a student to a teaching group.
     *
     * Validation:
     *   - The group exists.
     *   - The character exists.
     *   - The character is enrolled in the group's class-discipline
     *     during the requested week.
     *   - The character is not already an active member of the group.
     *   - The character is not eliminated as of the requested week.
     *
     * One transaction. All-or-nothing.
     *
     * @param {string} groupId
     * @param {string} charId
     * @param {number|string} startWeek
     * @returns {Promise<{success, data?, message?}>}
     */
    function addStudentToTeachingGroup(groupId, charId, startWeek) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var week = parseWeekStrict(startWeek);
        if (week === null) {
            return Promise.resolve(failure(
                'Valid start week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var group = AcademyTeachingGroups.getGroup(groupId);
        if (!group) {
            return Promise.resolve(failure('Teaching group not found.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        // Elimination check.
        if (EliminationQueries.isCharacterEliminatedByWeek(charId, week)) {
            return Promise.resolve(failure(
                'This character is eliminated and cannot join new groups.'
            ));
        }

        // Enrolment check.
        var classId = String(group.classId);
        var disciplineId = String(group.disciplineId);

        if (!AcademyEnrolments.isEnrolledInWeek(
            charId, classId, disciplineId, week
        )) {
            return Promise.resolve(failure(
                'The character is not enrolled in this discipline ' +
                'during the requested week.'
            ));
        }

        // Existing membership check.
        var alreadyMember = AcademyTeachingGroups.isMemberOfGroup(
            groupId, charId, week
        );
        if (alreadyMember) {
            return Promise.resolve(failure(
                'The character is already a member of this group.'
            ));
        }

        var targetGroup = String(groupId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    return {
                        valid: false,
                        message: 'Academy store is not available.'
                    };
                }
                var g = academy.teachingGroups &&
                    academy.teachingGroups[targetGroup];
                if (!isPlainObject(g)) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                if (!Array.isArray(g.members)) {
                    // Will be repaired in mutate.
                    return { valid: true };
                }
                for (var i = 0; i < g.members.length; i++) {
                    var m = g.members[i];
                    if (!m) { continue; }
                    if (String(m.characterId) !== targetChar) { continue; }
                    if (weekInRange(week, m.startWeek, m.endWeek)) {
                        return {
                            valid: false,
                            message: 'The character is already a member of this group.'
                        };
                    }
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }
                var g = academy.teachingGroups[targetGroup];
                if (!isPlainObject(g)) {
                    throw new Error('Teaching group not found.');
                }
                if (!Array.isArray(g.members)) {
                    g.members = [];
                }

                g.members.push({
                    characterId: targetChar,
                    startWeek: week,
                    endWeek: null
                });
                g.updatedAt = new Date().toISOString();

                return {
                    groupId: targetGroup,
                    characterId: targetChar,
                    startWeek: week
                };
            },
            logMessage: 'Added ' + targetChar + ' to group ' + targetGroup +
                ' from week ' + week,
            successMessage: 'Student added to group.',
            failureMessage: 'Failed to add student to group.'
        });
    }

    // ============================================================
    // dropStudentFromClass
    // ============================================================

    /**
     * Drop a student from a class.
     *
     * effectiveWeek is the first week the student is no longer in
     * the class. Every window truncates at effectiveWeek - 1.
     *
     * In one transaction:
     *   - Truncate every active enrolment interval for the student
     *     in this class.
     *   - Truncate every active group membership for the student in
     *     groups of this class.
     *   - Remove the classId from the character's classIds array.
     *
     * One transaction. All-or-nothing.
     *
     * @param {string} classId
     * @param {string} charId
     * @param {number|string} effectiveWeek
     * @returns {Promise<{success, data?, message?}>}
     */
    function dropStudentFromClass(classId, charId, effectiveWeek) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var week = parseWeekStrict(effectiveWeek);
        if (week === null) {
            return Promise.resolve(failure(
                'Valid effective week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var targetClass = String(classId);
        var targetChar = String(charId);
        var endWeek = week - 1;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!Array.isArray(appData.characters)) {
                    return {
                        valid: false,
                        message: 'Character store is not available.'
                    };
                }
                var found = false;
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === targetChar) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var stats = {
                    enrolmentsEnded: 0,
                    membershipsEnded: 0,
                    removedFromClass: false
                };

                // 1. Truncate enrolments in this class.
                var academy = getAcademySnapshot(appData);
                if (academy) {
                    var enrBucket = academy.enrolments &&
                        academy.enrolments[targetClass];
                    if (isPlainObject(enrBucket) &&
                        Array.isArray(enrBucket[targetChar])) {
                        var intervals = enrBucket[targetChar];
                        for (var i = 0; i < intervals.length; i++) {
                            var entry = intervals[i];
                            if (!entry) { continue; }
                            if (entry.endWeek === null ||
                                entry.endWeek === undefined ||
                                entry.endWeek >= week) {
                                if (entry.startWeek < week) {
                                    entry.endWeek = endWeek;
                                    stats.enrolmentsEnded++;
                                }
                            }
                        }
                    }

                    // 2. Truncate memberships in groups of this class.
                    if (isPlainObject(academy.teachingGroups)) {
                        Object.keys(academy.teachingGroups).forEach(function(gid) {
                            var g = academy.teachingGroups[gid];
                            if (!isPlainObject(g)) { return; }
                            if (String(g.classId) !== targetClass) { return; }
                            if (!Array.isArray(g.members)) { return; }

                            for (var j = 0; j < g.members.length; j++) {
                                var m = g.members[j];
                                if (!m) { continue; }
                                if (String(m.characterId) !== targetChar) {
                                    continue;
                                }
                                if (m.endWeek === null ||
                                    m.endWeek === undefined ||
                                    m.endWeek >= week) {
                                    if (m.startWeek < week) {
                                        m.endWeek = endWeek;
                                        stats.membershipsEnded++;
                                    }
                                }
                            }
                        });
                    }
                }

                // 3. Remove classId from the character.
                for (var ci = 0; ci < appData.characters.length; ci++) {
                    var c = appData.characters[ci];
                    if (!c || String(c.id) !== targetChar) { continue; }
                    if (!Array.isArray(c.classIds)) {
                        c.classIds = [];
                        break;
                    }
                    var before = c.classIds.length;
                    c.classIds = c.classIds.filter(function(id) {
                        return String(id) !== targetClass;
                    });
                    if (c.classIds.length !== before) {
                        stats.removedFromClass = true;
                    }
                    break;
                }

                return stats;
            },
            logMessage: function(result) {
                var parts = [];
                if (result.enrolmentsEnded > 0) {
                    parts.push(result.enrolmentsEnded + ' enrolment(s)');
                }
                if (result.membershipsEnded > 0) {
                    parts.push(result.membershipsEnded + ' membership(s)');
                }
                var suffix = parts.length > 0
                    ? ' (' + parts.join(', ') + ')'
                    : '';
                return 'Dropped ' + targetChar + ' from class ' +
                    targetClass + suffix;
            },
            successMessage: 'Student dropped from class.',
            failureMessage: 'Failed to drop student from class.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySchedule = Object.freeze({
        // Mutations
        addClassDiscipline: addClassDiscipline,
        removeClassDiscipline: removeClassDiscipline,
        scheduleGroupMeeting: scheduleGroupMeeting,
        addStudentToTeachingGroup: addStudentToTeachingGroup,
        dropStudentFromClass: dropStudentFromClass,

        // Constants (re-exported for callers)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySchedule;
        var missing = [];

        var required = [
            'addClassDiscipline',
            'removeClassDiscipline',
            'scheduleGroupMeeting',
            'addStudentToTeachingGroup',
            'dropStudentFromClass'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySchedule] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();