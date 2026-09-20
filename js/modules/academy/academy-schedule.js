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
 *     assignStudentToSlot       resolve-or-create the group and
 *                               session implied by a single
 *                               (student, week, day, hour, discipline)
 *                               assignment, then add the membership
 *     removeTeachingGroup       delete a teaching group and every
 *                               session owned by it, in one
 *                               transaction
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Single-store reads             (AcademyClassDisciplinesQueries,
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
 *   Reads performed during validation and inside the mutate callback
 *   use the pipeline's appData snapshot, not window.data. Because
 *   MutationPipeline serialises mutations, the snapshot is stable for
 *   the duration of the transaction.
 *
 *   The coordinator does NOT call other modules' mutation methods.
 *   Those methods run their own MutationPipeline; nesting pipelines is
 *   not supported. Instead, the coordinator performs the equivalent
 *   writes inline on the snapshot, using the canonical record shapes
 *   and invariant rules of each store. Where a store exposes a pure
 *   construction helper, the coordinator uses it.
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
 * RANGE PREDICATES (v27):
 *   Week-in-range and range-overlap questions delegate to
 *   `RangeUtils`. That module is the canonical implementation for
 *   the whole application; this module does not reimplement range
 *   math.
 *
 * CLASS-DISCIPLINE READS:
 *   The class-discipline marker store has two modules: a mutation
 *   module (AcademyClassDisciplines) and a read module
 *   (AcademyClassDisciplinesQueries). This coordinator reads through
 *   the read module. It does NOT call the mutation module for reads.
 *
 * DISCIPLINE WINDOW (v27):
 *   A class-discipline marker has no window. The discipline entity
 *   owns startWeek / endWeek.
 *
 * INSTRUCTOR-OF-CLASS (v29):
 *   A class does not carry an instructor field. The instructors of a
 *   class are derived from per-discipline instructor enrolments. The
 *   `assignStudentToSlot` resolver reads those enrolments inside the
 *   pipeline transaction:
 *
 *     explicit instructorId in the payload
 *         ↓
 *     active instructor-mode enrolment for (classId, disciplineId)
 *         ├── exactly one  → use it
 *         ├── more than one → reject 'ambiguous_instructor'
 *         └── zero          → reject 'missing_instructor'
 *
 *   There is no class-level fallback. Prior to v29, the resolver fell
 *   back to `cls.instructorId`; that field was retired, and the
 *   fallback went with it.
 *
 *   The rule is mirrored by the live/preflight query
 *   AcademyClasses.getClassInstructorIds(classId, week, { disciplineId }).
 *   The two must agree. Neither calls the other across a transaction
 *   boundary; both express the same rule against their own source.
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
 *   plus the details needed to show a confirmation modal.
 *
 *   Location collisions are NOT checked.
 *
 * COLLISION OVERRIDE SEMANTICS:
 *   `allowCollisions: true` bypasses POLICY conflicts only:
 *     - student_collision
 *     - instructor_collision
 *
 *   It does NOT bypass STRUCTURAL invariants:
 *     - invalid week / day / hour / duration
 *     - missing class / discipline / character
 *     - offering inactive in the requested week
 *     - student not enrolled in the offering
 *     - missing instructor (no explicit, no active instructor enrolment)
 *     - ambiguous instructor (multiple active instructor enrolments)
 *     - group_session_overlap (same group, overlapping session)
 *     - malformed references
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
 *   academy.teachingGroupSequences["classId|disciplineId|instructorId"] = N
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
 *   - window.RangeUtils
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.AcademyClassDisciplinesQueries
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
 *   - window.AcademyTeachingProjector — resolved at call time by the
 *                                 student-collision check in
 *                                 assignStudentToSlot. When absent,
 *                                 the student-collision check is
 *                                 skipped with a warning; the rest
 *                                 of the operation runs.
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
 *
 *   AcademySchedule.assignStudentToSlot({
 *       charId: 'char_1',
 *       classId: 'class_1',
 *       disciplineId: 'disc_en',
 *       week: 5,
 *       day: 1,
 *       startHour: 9,
 *       duration: 2
 *   }).then(function(result) { ... });
 *
 *   AcademySchedule.removeTeachingGroup({
 *       groupId: 'tgroup_1',
 *       classId: 'class_1'
 *   }).then(function(result) { ... });
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
    var RangeUtils = window.RangeUtils;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var CharacterQueries = window.CharacterQueries;
    var EliminationQueries = window.EliminationQueries;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getAcademyAggregator() {
        return window.AcademyAggregator || null;
    }

    function getAcademyTeachingProjector() {
        return window.AcademyTeachingProjector || null;
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
    if (!RangeUtils ||
        typeof RangeUtils.containsWeek !== 'function' ||
        typeof RangeUtils.weeksOverlap !== 'function') {
        _missing.push('RangeUtils.containsWeek / weeksOverlap');
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
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.getClassDiscipline');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
        _missing.push('AcademyEnrolments.getStudentDisciplines');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getActiveMembers !== 'function') {
        _missing.push('AcademyTeachingGroups.getActiveMembers');
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
     *
     * Delegates to RangeUtils.containsWeek, which is the canonical
     * "is this week in this range" predicate. Wrapper exists so
     * call sites read naturally and so a future change to the
     * canonical predicate lands in one place.
     */
    function weekInRange(week, startWeek, endWeek) {
        return RangeUtils.containsWeek(week, startWeek, endWeek);
    }

    /**
     * Do two week ranges overlap?
     *
     * Delegates to RangeUtils.weeksOverlap, which is the canonical
     * range-overlap predicate. Wrapper exists so call sites read
     * naturally and so a future change to the canonical predicate
     * lands in one place.
     */
    function weekRangesOverlap(startA, endA, startB, endB) {
        return RangeUtils.weeksOverlap(startA, endA, startB, endB);
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
     * Week ranges must also overlap.
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
     * Get the group's active member IDs at a given week.
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
     */
    function findInstructorCollision(instructorId, candidate, excludeGroupId) {
        if (!isNonEmptyString(instructorId)) {
            return null;
        }

        var allSessions = AcademyTeachingSessions.getAllSessions() || [];

        for (var i = 0; i < allSessions.length; i++) {
            var session = allSessions[i];
            if (!isPlainObject(session)) { continue; }

            if (excludeGroupId &&
                String(session.groupId) === String(excludeGroupId)) {
                continue;
            }

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
     */
    function findStudentCollision(candidateGroupId, candidate) {
        if (!isNonEmptyString(candidateGroupId)) {
            return null;
        }

        var startWeek = candidate.startWeek;
        var endWeek = (candidate.endWeek === null || candidate.endWeek === undefined)
            ? MAX_WEEK
            : candidate.endWeek;

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
     * THE ENROLMENT WINDOW (v27):
     *   The marker has no window. The window comes from the
     *   DISCIPLINE.
     *
     * CONFIG SHAPE (v27):
     *   config = { mandatory?: boolean }
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

        var existing =
            AcademyClassDisciplinesQueries.getClassDiscipline(
                classId, disciplineId
            );
        if (existing) {
            return Promise.resolve(failure(
                'This class already offers this discipline.'
            ));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        var isMandatory;
        if (typeof config.mandatory === 'boolean') {
            isMandatory = config.mandatory;
        } else {
            isMandatory = (discipline.type === 'mandatory');
        }

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

                var cdBucket = ensureClassBucket(
                    academy, 'classDisciplines', targetClass
                );
                cdBucket[targetDiscipline] = deepClone(plan.marker);

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

                var eliminated = false;
                try {
                    eliminated = EliminationQueries.isCharacterEliminatedByWeek(
                        studentId, startWeek
                    ) === true;
                } catch (e) {
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
     * effectiveWeek is the first week that is NOT covered by the
     * offering.
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

        var existing =
            AcademyClassDisciplinesQueries.getClassDiscipline(
                classId, disciplineId
            );
        if (!existing) {
            return Promise.resolve(failure(
                'This class does not offer this discipline.'
            ));
        }

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
     * @param {string} groupId
     * @param {object} config
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

        if (EliminationQueries.isCharacterEliminatedByWeek(charId, week)) {
            return Promise.resolve(failure(
                'This character is eliminated and cannot join new groups.'
            ));
        }

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
    // removeTeachingGroup
    // ============================================================
    //
    // Hard-delete a teaching group and every session owned by it,
    // in one transaction.
    //
    // THIS IS A HARD DELETE, NOT A WINDOW TRUNCATION:
    //   Every other end* helper in the teaching-model stack sets
    //   endWeek and preserves the record as a historical fact.
    //   removeTeachingGroup is different: it is the user-facing
    //   "delete this group" action, called from the schedule-assign
    //   modal's remove-group mode. The intent is destructive, and
    //   the group and its sessions are removed outright.
    //
    //   Student enrolments are NOT touched. A student's enrolment in
    //   a class-discipline is a fact about the student, not about
    //   the group. Dropping the group does not drop the enrolment;
    //   the student is simply no longer scheduled into any group for
    //   that discipline until they are re-assigned.
    //
    // WHAT IT DOES:
    //   1. Delete every session in academy.teachingSessions whose
    //      groupId matches.
    //   2. Delete the group record from academy.teachingGroups.
    //   3. Return a summary of what was removed.
    //
    // WHAT IT DOES NOT DO:
    //   - It does not touch enrolments.
    //   - It does not touch the teachingGroupSequences counter. A
    //     future group for the same (class, discipline, instructor)
    //     triple continues from the last allocated number, which is
    //     the correct behavior: sequence numbers are monotonic and
    //     must not be reused even after a group is deleted.
    //   - It does not cascade into any other store.
    //
    // INPUT:
    //   { groupId, classId }
    //     groupId  required
    //     classId  required; used only as a safety check to prevent
    //              a caller from removing a group belonging to a
    //              different class than the one it thinks it is
    //              operating on.
    //
    // RETURN (success):
    //   {
    //     success: true,
    //     data: {
    //       groupId,
    //       classId,
    //       sessionsRemoved: number,
    //       membersRemoved:  number
    //     }
    //   }
    //
    // RETURN (rejection):
    //   {
    //     success: false,
    //     message: string
    //   }
    //
    //   Reasons: missing groupId / classId, group not found,
    //   class mismatch.

    /**
     * Remove a teaching group and every session owned by it.
     *
     * @param {object} payload { groupId, classId }
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeTeachingGroup(payload) {
        if (!isPlainObject(payload)) {
            return Promise.resolve(failure('Payload must be an object.'));
        }

        if (!isNonEmptyString(payload.groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }
        if (!isNonEmptyString(payload.classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var targetGroup = String(payload.groupId);
        var targetClass = String(payload.classId);

        // Preflight against the live store: the group must exist and
        // must belong to the class the caller thinks it does. This
        // is a fast, friendly rejection for a caller bug; the
        // authoritative check runs inside the pipeline against the
        // snapshot.
        var liveGroup = null;
        try {
            liveGroup = AcademyTeachingGroups.getGroup(targetGroup);
        } catch (e) {
            liveGroup = null;
        }
        if (!liveGroup) {
            return Promise.resolve(failure('Teaching group not found.'));
        }
        if (String(liveGroup.classId) !== targetClass) {
            return Promise.resolve(failure(
                'This group does not belong to the specified class.'
            ));
        }

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
                var snapshotGroup = academy.teachingGroups[targetGroup];
                if (String(snapshotGroup.classId) !== targetClass) {
                    return {
                        valid: false,
                        message:
                            'This group does not belong to the specified class.'
                    };
                }
                return { valid: true };
            },

            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                var group = academy.teachingGroups[targetGroup];
                if (!isPlainObject(group)) {
                    throw new Error('Teaching group not found.');
                }

                var membersRemoved = Array.isArray(group.members)
                    ? group.members.length
                    : 0;

                // ---- 1. Delete every session belonging to this group ----
                var sessionsRemoved = 0;
                if (isPlainObject(academy.teachingSessions)) {
                    var sessionIds = Object.keys(academy.teachingSessions);
                    for (var i = 0; i < sessionIds.length; i++) {
                        var sid = sessionIds[i];
                        var session = academy.teachingSessions[sid];
                        if (!isPlainObject(session)) { continue; }
                        if (String(session.groupId) !== targetGroup) {
                            continue;
                        }
                        delete academy.teachingSessions[sid];
                        sessionsRemoved++;
                    }
                }

                // ---- 2. Delete the group record ----
                delete academy.teachingGroups[targetGroup];

                return {
                    groupId: targetGroup,
                    classId: targetClass,
                    sessionsRemoved: sessionsRemoved,
                    membersRemoved: membersRemoved
                };
            },

            logMessage: function(result) {
                var parts = ['Deleted teaching group ' + targetGroup];
                if (result.sessionsRemoved > 0) {
                    parts.push(result.sessionsRemoved + ' session(s)');
                }
                if (result.membersRemoved > 0) {
                    parts.push(result.membersRemoved + ' membership(s)');
                }
                return parts.join(' — ');
            },

            successMessage: 'Teaching group deleted.',
            failureMessage: 'Failed to delete teaching group.'
        });
    }

    // ============================================================
    // assignStudentToSlot
    // ============================================================
    //
    // The sixth compound mutation. Given a (student, class,
    // discipline, week, day, hour, duration) intent, resolve or
    // create the teaching group and teaching session that make the
    // intent true, then add the student's group membership.
    //
    // All five writes happen in ONE MutationPipeline transaction.
    // The coordinator does NOT call AcademyTeachingGroups.createGroup,
    // AcademyTeachingSessions.createSession, or
    // AcademyEnrolments.enrol; those methods run their own pipelines.
    // Instead, the equivalent records are written inline on the
    // snapshot, using the canonical record shapes those modules
    // produce.
    //
    // RESOLUTION POLICY:
    //
    //   1. Validate payload shape and numeric bounds.
    //   2. Preflight: class exists, discipline exists, character
    //      exists, character is a member of the class, class-
    //      discipline marker exists, offering active in `week`,
    //      student enrolled in the offering during `week`.
    //   3. Resolve instructor (preflight, for early rejection):
    //        - explicit override, or
    //        - exactly one active instructor-mode enrolment for
    //          (classId, disciplineId) at `week`, or
    //        - reject 'ambiguous_instructor' when >1, or
    //        - reject 'missing_instructor' when 0.
    //      There is NO class-level fallback; the class record no
    //      longer carries an instructor field.
    //   4. Inside the pipeline: re-resolve all of the above
    //      against the snapshot.
    //   5. Find or create the teaching group:
    //        - candidates: groups for (class, discipline,
    //          instructor) that are active at `week`.
    //        - for each, look at its sessions active at `week`.
    //        - if a session matches (day, startTime, duration)
    //          EXACTLY, reuse that group and session.
    //        - else if a session on that group OVERLAPS the
    //          requested slot, reject `group_session_overlap`.
    //        - else if a group exists with no overlapping
    //          session, create a session on that group.
    //        - else create a new group and a session on it.
    //   6. Compute the membership window:
    //        startWeek = week
    //        endWeek   = min(enrolmentInterval.endWeek,
    //                        discipline.endWeek)  // null = ongoing
    //   7. Collision checks (skipped when allowCollisions is true):
    //        - student collision
    //        - instructor collision (only when creating a session)
    //   8. Write the new group (if any), new session (if any),
    //      and the membership.
    //
    // STRUCTURAL INVARIANTS ARE NEVER OVERRIDABLE.
    //   `allowCollisions: true` bypasses only the POLICY checks
    //   (student_collision, instructor_collision). It does NOT
    //   bypass validation errors, missing prerequisites,
    //   ambiguous/missing instructor, or group_session_overlap.
    //
    // INSTRUCTOR RESOLUTION IS TRANSACTION-LOCAL:
    //   The authoritative resolution reads `academy.enrolments`
    //   from the pipeline snapshot, not from the live store. The
    //   live/preflight query AcademyClasses.getClassInstructorIds
    //   expresses the same rule; the two must agree. The
    //   transaction-local helper `resolveInstructorFromSnapshot`
    //   below is the authoritative one.
    //
    // INPUT SHAPE:
    //   {
    //     charId,                  required
    //     classId,                 required
    //     disciplineId,            required
    //     week,                    required, in [MIN_WEEK, MAX_WEEK]
    //     day,                     required, in [MIN_DAY, MAX_DAY]
    //     startHour,               required, in [MIN_HOUR, MAX_HOUR]
    //     duration,                required, in [MIN_CLASS_DURATION,
    //                                                 MAX_CLASS_DURATION]
    //     instructorId,            optional; overrides the enrolment
    //     allowCollisions,         optional; default false
    //   }
    //
    // RETURN SHAPE (success):
    //   {
    //     success: true,
    //     data: {
    //       groupId, sessionId, disciplineId, instructorId,
    //       week, day, startHour, duration,
    //       createdGroup: boolean,
    //       createdSession: boolean,
    //       addedMembership: boolean
    //     }
    //   }
    //
    // RETURN SHAPE (rejection):
    //   {
    //     success: false,
    //     reason: 'invalid_input'
    //            | 'class_not_found'
    //            | 'discipline_not_found'
    //            | 'character_not_found'
    //            | 'not_in_class'
    //            | 'no_class_discipline'
    //            | 'offering_inactive'
    //            | 'not_enrolled'
    //            | 'missing_instructor'
    //            | 'ambiguous_instructor'
    //            | 'group_session_overlap'
    //            | 'student_collision'
    //            | 'instructor_collision',
    //     message: string,
    //     data?: object
    //   }

    /**
     * Reject helper. Structurally the same shape as failure(),
     * plus a reason code the caller can branch on.
     */
    function rejection(reason, message, data) {
        var result = {
            success: false,
            reason: reason,
            message: message
        };
        if (data !== undefined) {
            result.data = data;
        }
        return result;
    }

    /**
     * Find the enrolment interval for (charId, classId,
     * disciplineId) that contains `week`. Returns null when there
     * is no such interval.
     *
     * Reads from the appData snapshot, not window.data, so it can
     * be used inside pipeline callbacks.
     */
    function findEnrolmentIntervalForWeek(
        academy,
        charId,
        classId,
        disciplineId,
        week
    ) {
        if (!isPlainObject(academy)) { return null; }
        var enrBucket = academy.enrolments &&
            academy.enrolments[classId];
        if (!isPlainObject(enrBucket)) { return null; }
        var intervals = enrBucket[charId];
        if (!Array.isArray(intervals)) { return null; }

        var targetDisc = String(disciplineId);
        for (var i = 0; i < intervals.length; i++) {
            var entry = intervals[i];
            if (!entry) { continue; }
            if (String(entry.disciplineId) !== targetDisc) {
                continue;
            }
            if (weekInRange(week, entry.startWeek, entry.endWeek)) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Does the character's classIds array contain classId?
     * Reads from the appData snapshot.
     */
    function characterInClassInSnapshot(appData, charId, classId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return false;
        }
        var targetChar = String(charId);
        var targetClass = String(classId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (!c || String(c.id) !== targetChar) { continue; }
            if (!Array.isArray(c.classIds)) { return false; }
            for (var j = 0; j < c.classIds.length; j++) {
                if (String(c.classIds[j]) === targetClass) {
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    /**
     * Does the class-discipline marker exist for (classId,
     * disciplineId) in the snapshot?
     */
    function classDisciplineExistsInSnapshot(
        academy,
        classId,
        disciplineId
    ) {
        if (!isPlainObject(academy)) { return false; }
        var cdStore = academy.classDisciplines;
        if (!isPlainObject(cdStore)) { return false; }
        var byClass = cdStore[classId];
        if (!isPlainObject(byClass)) { return false; }
        return byClass[disciplineId] !== undefined;
    }

    /**
     * Collect the candidate teaching groups for (classId,
     * disciplineId, instructorId) from the snapshot. Returns an
     * array of raw group records (live references).
     */
    function collectCandidateGroups(
        academy,
        classId,
        disciplineId,
        instructorId
    ) {
        var result = [];
        if (!isPlainObject(academy)) { return result; }
        var store = academy.teachingGroups;
        if (!isPlainObject(store)) { return result; }

        var tc = String(classId);
        var td = String(disciplineId);
        var ti = String(instructorId);

        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var g = store[keys[i]];
            if (!isPlainObject(g)) { continue; }
            if (String(g.classId) !== tc) { continue; }
            if (String(g.disciplineId) !== td) { continue; }
            if (String(g.instructorId) !== ti) { continue; }
            result.push(g);
        }
        return result;
    }

    /**
     * Collect the sessions for a group from the snapshot.
     */
    function collectSessionsForGroup(academy, groupId) {
        var result = [];
        if (!isPlainObject(academy)) { return result; }
        var store = academy.teachingSessions;
        if (!isPlainObject(store)) { return result; }
        var tg = String(groupId);
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (!isPlainObject(s)) { continue; }
            if (String(s.groupId) !== tg) { continue; }
            result.push(s);
        }
        return result;
    }

    /**
     * Does a session record cover the given (day, startTime,
     * duration) EXACTLY? Used to decide reuse.
     */
    function sessionMatchesExactly(session, day, startTime, duration) {
        return session.day === day &&
               session.startTime === startTime &&
               session.duration === duration;
    }

    /**
     * Do the requested (day, startTime, duration) and the given
     * session overlap in time, ignoring week ranges? Used to
     * reject `group_session_overlap`.
     */
    function timeSlotsOverlap(day, startTime, duration, session) {
        if (day !== session.day) { return false; }
        var aEnd = startTime + duration;
        var bEnd = session.startTime + session.duration;
        return startTime < bEnd && session.startTime < aEnd;
    }

    /**
     * Compute the membership window for a new member added by
     * assignStudentToSlot.
     *
     *   startWeek = week
     *   endWeek   = min(enrolmentInterval.endWeek,
     *                   discipline.endWeek)   // null = unbounded
     */
    function computeMembershipEndWeek(enrolmentInterval, discipline) {
        var enrolEnd = (enrolmentInterval &&
                        enrolmentInterval.endWeek !== undefined &&
                        enrolmentInterval.endWeek !== null)
            ? enrolmentInterval.endWeek
            : null;

        var discEnd = (discipline &&
                       discipline.endWeek !== undefined &&
                       discipline.endWeek !== null &&
                       discipline.endWeek !== '')
            ? discipline.endWeek
            : null;

        if (enrolEnd === null) { return discEnd; }
        if (discEnd === null) { return enrolEnd; }
        return Math.min(enrolEnd, discEnd);
    }

    /**
     * Generate a group id for a newly created group inside
     * assignStudentToSlot.
     */
    function generateGroupId() {
        return IdUtils.generateId('tgroup');
    }

    /**
     * Generate a session id for a newly created session inside
     * assignStudentToSlot.
     */
    function generateSessionId() {
        return IdUtils.generateId('tsession');
    }

    /**
     * Allocate the next group number for a (class, discipline,
     * instructor) triple from the snapshot's sequence store.
     * Mirrors AcademyTeachingGroups.createGroup's allocation.
     */
    function allocateGroupNumber(
        academy,
        classId,
        disciplineId,
        instructorId
    ) {
        if (!isPlainObject(academy.teachingGroupSequences)) {
            academy.teachingGroupSequences = {};
        }
        var seqStore = academy.teachingGroupSequences;
        var seqKey = String(classId) + '|' +
                     String(disciplineId) + '|' +
                     String(instructorId);

        var nextNumber = 1;
        if (typeof seqStore[seqKey] === 'number' &&
            seqStore[seqKey] >= 0) {
            nextNumber = seqStore[seqKey] + 1;
        }
        seqStore[seqKey] = nextNumber;
        return nextNumber;
    }

    /**
     * Resolve the instructor for (classId, disciplineId) at a given
     * week from the pipeline snapshot.
     *
     * A character is treated as an instructor for this purpose when
     * their `mode` is 'instructor'. The enrolment itself is
     * mode-neutral; mode is a fact on the character, not on the
     * enrolment.
     *
     * Reads exclusively from the snapshot. Does not consult
     * AcademyClasses.getClassInstructorIds, which is a live-store
     * read and not authoritative inside a transaction.
     *
     * Returns:
     *   { ok: true,  instructorId }                    — exactly one
     *   { ok: false, reason: 'missing_instructor' }    — zero
     *   { ok: false, reason: 'ambiguous_instructor',
     *     instructorIds }                              — more than one
     */
    function resolveInstructorFromSnapshot(
        appData,
        classId,
        disciplineId,
        week
    ) {
        if (!appData || !Array.isArray(appData.characters)) {
            return { ok: false, reason: 'missing_instructor' };
        }
        var academy = getAcademySnapshot(appData);
        if (!isPlainObject(academy)) {
            return { ok: false, reason: 'missing_instructor' };
        }

        var enrBucket = academy.enrolments &&
            academy.enrolments[String(classId)];
        if (!isPlainObject(enrBucket)) {
            return { ok: false, reason: 'missing_instructor' };
        }

        var targetDisc = String(disciplineId);

        // Index characters by id so the mode lookup is O(1) per
        // candidate. The character array is walked once per call,
        // which is what the other resolver-adjacent helpers do
        // anyway.
        var charById = Object.create(null);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && c.id !== undefined && c.id !== null) {
                charById[String(c.id)] = c;
            }
        }

        var matches = [];
        var charIds = Object.keys(enrBucket);

        for (var ci = 0; ci < charIds.length; ci++) {
            var charId = charIds[ci];
            var intervals = enrBucket[charId];
            if (!Array.isArray(intervals)) { continue; }

            var matched = false;
            for (var ii = 0; ii < intervals.length; ii++) {
                var iv = intervals[ii];
                if (!iv || typeof iv !== 'object') { continue; }
                if (String(iv.disciplineId) !== targetDisc) {
                    continue;
                }
                if (!weekInRange(week, iv.startWeek, iv.endWeek)) {
                    continue;
                }
                matched = true;
                break;
            }
            if (!matched) { continue; }

            var char = charById[String(charId)];
            if (!char) { continue; }
            if (char.mode !== 'instructor') { continue; }

            matches.push(String(charId));
        }

        if (matches.length === 0) {
            return { ok: false, reason: 'missing_instructor' };
        }
        if (matches.length === 1) {
            return { ok: true, instructorId: matches[0] };
        }

        matches.sort();
        return {
            ok: false,
            reason: 'ambiguous_instructor',
            instructorIds: matches
        };
    }

    /**
     * Check the student's existing occurrences in `week` for a
     * time overlap with the requested slot, excluding any
     * occurrence that belongs to `excludeGroupId`.
     */
    function findStudentSlotCollision(
        charId,
        week,
        day,
        startHour,
        duration,
        excludeGroupId
    ) {
        var Projector = getAcademyTeachingProjector();
        if (!Projector ||
            typeof Projector.projectForStudent !== 'function') {
            console.warn(
                '[AcademySchedule] AcademyTeachingProjector is not ' +
                'available. The student-collision check in ' +
                'assignStudentToSlot will be skipped.'
            );
            return null;
        }

        var occurrences;
        try {
            occurrences = Projector.projectForStudent(charId, week) || [];
        } catch (e) {
            console.warn(
                '[AcademySchedule] projectForStudent threw:', e
            );
            return null;
        }

        var exclude = excludeGroupId
            ? String(excludeGroupId)
            : null;

        var newStart = startHour;
        var newEnd = startHour + duration;

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ) { continue; }
            if (occ.day !== day) { continue; }
            if (exclude !== null &&
                String(occ.groupId) === exclude) {
                continue;
            }
            var occEnd = occ.startTime + occ.duration;
            var overlaps = newStart < occEnd &&
                           occ.startTime < newEnd;
            if (overlaps) {
                return { occurrence: occ };
            }
        }
        return null;
    }

    function assignStudentToSlot(payload) {
        if (!isPlainObject(payload)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Payload must be an object.'
            ));
        }

        // ---- Payload validation ----
        if (!isNonEmptyString(payload.charId)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Character ID is required.'
            ));
        }
        if (!isNonEmptyString(payload.classId)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Class ID is required.'
            ));
        }
        if (!isNonEmptyString(payload.disciplineId)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Discipline ID is required.'
            ));
        }

        var week = parseWeekStrict(payload.week);
        if (week === null) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var day = CalendarValidation.parseDay(payload.day);
        if (day === null) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Valid day is required (' +
                CalendarConstants.MIN_DAY + '-' +
                CalendarConstants.MAX_DAY + ').'
            ));
        }

        var startHour = CalendarValidation.parseHour(payload.startHour);
        if (startHour === null) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Valid start hour is required (' +
                CalendarConstants.MIN_HOUR + '-' +
                CalendarConstants.MAX_HOUR + ').'
            ));
        }

        var duration = CalendarValidation.parseDuration(payload.duration);
        if (duration === null) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Duration must be between ' +
                CalendarConstants.MIN_CLASS_DURATION + ' and ' +
                CalendarConstants.MAX_CLASS_DURATION + ' hours.'
            ));
        }

        if (startHour + duration > CalendarConstants.MAX_HOUR + 1) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Session extends beyond the end of the day.'
            ));
        }

        var allowCollisions = payload.allowCollisions === true;

        var targetChar = String(payload.charId);
        var targetClass = String(payload.classId);
        var targetDiscipline = String(payload.disciplineId);

        var explicitInstructor = isNonEmptyString(payload.instructorId)
            ? String(payload.instructorId)
            : null;

        // ---- Preflight (live reads for early UX feedback) ----
        var cls = AcademyClasses.getClass(targetClass);
        if (!cls) {
            return Promise.resolve(rejection(
                'class_not_found',
                'Class not found.'
            ));
        }

        var discipline = AcademyDisciplines.getDiscipline(targetDiscipline);
        if (!discipline) {
            return Promise.resolve(rejection(
                'discipline_not_found',
                'Discipline not found.'
            ));
        }

        var char = CharacterQueries.getCharacterById(targetChar);
        if (!char) {
            return Promise.resolve(rejection(
                'character_not_found',
                'Character not found.'
            ));
        }

        var classIds = Array.isArray(char.classIds) ? char.classIds : [];
        var inClass = false;
        for (var ci = 0; ci < classIds.length; ci++) {
            if (String(classIds[ci]) === targetClass) {
                inClass = true;
                break;
            }
        }
        if (!inClass) {
            return Promise.resolve(rejection(
                'not_in_class',
                'This character is not a member of this class.'
            ));
        }

        var marker = AcademyClassDisciplinesQueries.getClassDiscipline(
            targetClass, targetDiscipline
        );
        if (!marker) {
            return Promise.resolve(rejection(
                'no_class_discipline',
                'This class does not offer this discipline.'
            ));
        }

        if (!AcademyClassDisciplinesQueries.isActiveInWeek(
            targetClass, targetDiscipline, week
        )) {
            return Promise.resolve(rejection(
                'offering_inactive',
                'This discipline is not active during the requested week.'
            ));
        }

        if (!AcademyEnrolments.isEnrolledInWeek(
            targetChar, targetClass, targetDiscipline, week
        )) {
            return Promise.resolve(rejection(
                'not_enrolled',
                'The character is not enrolled in this discipline ' +
                'during the requested week.'
            ));
        }

        // Preflight instructor resolution: live read, used only to
        // give the caller an early rejection. The authoritative
        // resolution runs inside the pipeline against the snapshot.
        //
        // Skipped when an explicit instructor was supplied: the
        // explicit value wins, and the caller is asserting they
        // know who it is.
        if (explicitInstructor === null) {
            var liveInstructorIds = null;
            try {
                if (typeof AcademyClasses.getClassInstructorIds === 'function') {
                    liveInstructorIds = AcademyClasses.getClassInstructorIds(
                        targetClass,
                        week,
                        { disciplineId: targetDiscipline }
                    );
                }
            } catch (e) {
                liveInstructorIds = null;
            }

            if (Array.isArray(liveInstructorIds)) {
                if (liveInstructorIds.length === 0) {
                    return Promise.resolve(rejection(
                        'missing_instructor',
                        'No instructor teaches this discipline for this ' +
                        'class. Assign an instructor from the character\'s ' +
                        'Disciplines tab before scheduling the student.'
                    ));
                }
                if (liveInstructorIds.length > 1) {
                    return Promise.resolve(rejection(
                        'ambiguous_instructor',
                        'Multiple instructors teach this discipline for ' +
                        'this class. Specify which one to use.',
                        { instructorIds: liveInstructorIds.slice() }
                    ));
                }
            }
        }

        // ---- Pipeline ----
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

                // Structural re-checks against the snapshot.
                if (!characterInClassInSnapshot(
                    appData, targetChar, targetClass
                )) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member of this class.'
                    };
                }

                if (!classDisciplineExistsInSnapshot(
                    academy, targetClass, targetDiscipline
                )) {
                    return {
                        valid: false,
                        message: 'Class-discipline no longer exists.'
                    };
                }

                if (!findEnrolmentIntervalForWeek(
                    academy,
                    targetChar,
                    targetClass,
                    targetDiscipline,
                    week
                )) {
                    return {
                        valid: false,
                        message: 'Enrolment no longer covers the requested week.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                // Re-resolve against the snapshot.
                var snapshotEnrolment = findEnrolmentIntervalForWeek(
                    academy,
                    targetChar,
                    targetClass,
                    targetDiscipline,
                    week
                );
                if (!snapshotEnrolment) {
                    throw new Error(
                        'Enrolment no longer covers the requested week.'
                    );
                }

                var snapshotDiscipline = AcademyDisciplines.getDiscipline(
                    targetDiscipline
                );
                if (!snapshotDiscipline) {
                    throw new Error('Discipline not found.');
                }

                // ---- Instructor resolution (authoritative) ----
                //
                // Explicit instructor wins; otherwise resolve from
                // active instructor-mode enrolments in the snapshot.
                // Reject with missing/ambiguous when the snapshot
                // does not have exactly one answer.
                var targetInstructor;
                if (explicitInstructor !== null) {
                    targetInstructor = explicitInstructor;
                } else {
                    var resolution = resolveInstructorFromSnapshot(
                        appData,
                        targetClass,
                        targetDiscipline,
                        week
                    );
                    if (!resolution.ok) {
                        if (resolution.reason === 'ambiguous_instructor') {
                            throw new Error(
                                '__ambiguous_instructor__:' +
                                JSON.stringify({
                                    instructorIds: resolution.instructorIds
                                })
                            );
                        }
                        throw new Error(
                            '__missing_instructor__'
                        );
                    }
                    targetInstructor = resolution.instructorId;
                }

                // ---- Resolve group and session ----
                var candidates = collectCandidateGroups(
                    academy,
                    targetClass,
                    targetDiscipline,
                    targetInstructor
                );

                var resolvedGroup = null;
                var resolvedSession = null;
                var createdGroup = false;
                var createdSession = false;

                // Sort candidates by startWeek so the first active
                // one wins. Deterministic.
                candidates.sort(function(a, b) {
                    var as = typeof a.startWeek === 'number'
                        ? a.startWeek : 0;
                    var bs = typeof b.startWeek === 'number'
                        ? b.startWeek : 0;
                    if (as !== bs) { return as - bs; }
                    return String(a.id).localeCompare(String(b.id));
                });

                for (var ci = 0; ci < candidates.length; ci++) {
                    var candidateGroup = candidates[ci];

                    // Group active at week?
                    if (!weekInRange(
                        week,
                        candidateGroup.startWeek,
                        candidateGroup.endWeek
                    )) {
                        continue;
                    }

                    var sessions = collectSessionsForGroup(
                        academy, candidateGroup.id
                    );

                    var exactMatch = null;
                    var overlapping = null;

                    for (var si = 0; si < sessions.length; si++) {
                        var s = sessions[si];
                        if (!weekInRange(
                            week,
                            s.startWeek,
                            s.endWeek
                        )) {
                            continue;
                        }
                        if (sessionMatchesExactly(
                            s, day, startHour, duration
                        )) {
                            exactMatch = s;
                            break;
                        }
                        if (timeSlotsOverlap(
                            day, startHour, duration, s
                        )) {
                            overlapping = s;
                        }
                    }

                    if (exactMatch) {
                        resolvedGroup = candidateGroup;
                        resolvedSession = exactMatch;
                        break;
                    }
                    if (overlapping) {
                        // Structural invariant. Never overridable.
                        throw new Error(
                            '__group_session_overlap__:' +
                            String(overlapping.id)
                        );
                    }

                    // Group has no overlapping session. Create a
                    // session on this group.
                    resolvedGroup = candidateGroup;
                    break;
                }

                // No group with an exact match. Create the group and
                // the session we need.
                if (!resolvedGroup) {
                    var newGroupId = generateGroupId();
                    var groupNumber = allocateGroupNumber(
                        academy,
                        targetClass,
                        targetDiscipline,
                        targetInstructor
                    );
                    var now = new Date().toISOString();

                    resolvedGroup = {
                        id: newGroupId,
                        classId: targetClass,
                        disciplineId: targetDiscipline,
                        instructorId: targetInstructor,
                        groupNumber: groupNumber,
                        customName: null,
                        members: [],
                        startWeek: week,
                        endWeek: null,
                        createdAt: now,
                        updatedAt: now
                    };

                    if (!isPlainObject(academy.teachingGroups)) {
                        academy.teachingGroups = {};
                    }
                    academy.teachingGroups[newGroupId] = resolvedGroup;
                    createdGroup = true;
                }

                if (!resolvedSession) {
                    // Compute the session window: starts at `week`,
                    // ends when the discipline ends.
                    var sessionStart = week;
                    var sessionEnd = null;
                    if (snapshotDiscipline.endWeek !== undefined &&
                        snapshotDiscipline.endWeek !== null &&
                        snapshotDiscipline.endWeek !== '') {
                        var parsedDiscEnd = parseWeekStrict(
                            snapshotDiscipline.endWeek
                        );
                        if (parsedDiscEnd !== null) {
                            sessionEnd = parsedDiscEnd;
                        }
                    }

                    var newSessionId = generateSessionId();
                    var sessionNow = new Date().toISOString();
                    resolvedSession = {
                        id: newSessionId,
                        groupId: resolvedGroup.id,
                        day: day,
                        startTime: startHour,
                        duration: duration,
                        locationId: null,
                        startWeek: sessionStart,
                        endWeek: sessionEnd,
                        createdAt: sessionNow,
                        updatedAt: sessionNow
                    };

                    if (!isPlainObject(academy.teachingSessions)) {
                        academy.teachingSessions = {};
                    }
                    academy.teachingSessions[newSessionId] = resolvedSession;
                    createdSession = true;
                }

                // ---- Collision checks ----
                if (!allowCollisions) {
                    var studentCollision = findStudentSlotCollision(
                        targetChar,
                        week,
                        day,
                        startHour,
                        duration,
                        resolvedGroup.id
                    );
                    if (studentCollision) {
                        throw new Error(
                            '__student_collision__:' +
                            JSON.stringify(studentCollision)
                        );
                    }

                    if (createdSession) {
                        var candidateSession = {
                            day: day,
                            startTime: startHour,
                            duration: duration,
                            startWeek: resolvedSession.startWeek,
                            endWeek: resolvedSession.endWeek
                        };
                        var instructorCollision = findInstructorCollision(
                            targetInstructor,
                            candidateSession,
                            resolvedGroup.id
                        );
                        if (instructorCollision) {
                            throw new Error(
                                '__instructor_collision__:' +
                                JSON.stringify({
                                    session: instructorCollision.session,
                                    group: {
                                        id: instructorCollision.group.id,
                                        name: instructorCollision.group.name
                                    }
                                })
                            );
                        }
                    }
                }

                // ---- Membership ----
                if (!Array.isArray(resolvedGroup.members)) {
                    resolvedGroup.members = [];
                }

                // Idempotency: if the student already has an active
                // membership at `week`, don't create a duplicate.
                for (var mi = 0; mi < resolvedGroup.members.length; mi++) {
                    var existing = resolvedGroup.members[mi];
                    if (!existing) { continue; }
                    if (String(existing.characterId) !== targetChar) {
                        continue;
                    }
                    if (weekInRange(
                        week, existing.startWeek, existing.endWeek
                    )) {
                        return {
                            groupId: String(resolvedGroup.id),
                            sessionId: String(resolvedSession.id),
                            disciplineId: targetDiscipline,
                            instructorId: targetInstructor,
                            week: week,
                            day: day,
                            startHour: startHour,
                            duration: duration,
                            createdGroup: createdGroup,
                            createdSession: createdSession,
                            addedMembership: false
                        };
                    }
                }

                var membershipEnd = computeMembershipEndWeek(
                    snapshotEnrolment,
                    snapshotDiscipline
                );

                resolvedGroup.members.push({
                    characterId: targetChar,
                    startWeek: week,
                    endWeek: membershipEnd
                });
                resolvedGroup.updatedAt = new Date().toISOString();

                return {
                    groupId: String(resolvedGroup.id),
                    sessionId: String(resolvedSession.id),
                    disciplineId: targetDiscipline,
                    instructorId: targetInstructor,
                    week: week,
                    day: day,
                    startHour: startHour,
                    duration: duration,
                    createdGroup: createdGroup,
                    createdSession: createdSession,
                    addedMembership: true
                };
            },

            logMessage: function(result) {
                var parts = ['Assigned ' + targetChar +
                    ' to ' + targetDiscipline];
                parts.push('week ' + week + ', day ' + day +
                    ' at ' + startHour + 'h for ' + duration + 'h');
                if (result && result.createdGroup) {
                    parts.push('created group');
                }
                if (result && result.createdSession) {
                    parts.push('created session');
                }
                return parts.join(' — ');
            },

            successMessage: 'Student assigned to slot.',

            failureMessage: 'Failed to assign student to slot.'
        }).then(function(result) {
            // The pipeline catches thrown errors and turns them
            // into { success: false, message }. Our sentinel
            // messages need to be re-shaped back into structured
            // rejections.
            if (result && result.success === false &&
                typeof result.message === 'string') {

                if (result.message.indexOf(
                    '__group_session_overlap__:'
                ) === 0) {
                    return rejection(
                        'group_session_overlap',
                        'This group already meets during that time. ' +
                        'Pick a different slot or a different duration.'
                    );
                }

                if (result.message.indexOf(
                    '__missing_instructor__'
                ) === 0) {
                    return rejection(
                        'missing_instructor',
                        'No instructor teaches this discipline for this ' +
                        'class. Assign an instructor from the character\'s ' +
                        'Disciplines tab before scheduling the student.'
                    );
                }

                if (result.message.indexOf(
                    '__ambiguous_instructor__:'
                ) === 0) {
                    return rejection(
                        'ambiguous_instructor',
                        'Multiple instructors teach this discipline for ' +
                        'this class. Specify which one to use.',
                        parseSentinelJson(
                            result.message,
                            '__ambiguous_instructor__:'
                        )
                    );
                }

                if (result.message.indexOf(
                    '__student_collision__:'
                ) === 0) {
                    return rejection(
                        'student_collision',
                        'This student is already scheduled at an ' +
                        'overlapping time.',
                        {
                            collision: parseSentinelJson(
                                result.message,
                                '__student_collision__:'
                            )
                        }
                    );
                }

                if (result.message.indexOf(
                    '__instructor_collision__:'
                ) === 0) {
                    return rejection(
                        'instructor_collision',
                        'The instructor is already teaching at an ' +
                        'overlapping time.',
                        {
                            collision: parseSentinelJson(
                                result.message,
                                '__instructor_collision__:'
                            )
                        }
                    );
                }
            }
            return result;
        });
    }

    /**
     * Parse a JSON payload out of a sentinel-prefixed message.
     * Returns null on any failure.
     */
    function parseSentinelJson(message, prefix) {
        try {
            var json = message.substring(prefix.length);
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySchedule = Object.freeze({
        addClassDiscipline: addClassDiscipline,
        removeClassDiscipline: removeClassDiscipline,
        scheduleGroupMeeting: scheduleGroupMeeting,
        addStudentToTeachingGroup: addStudentToTeachingGroup,
        dropStudentFromClass: dropStudentFromClass,
        assignStudentToSlot: assignStudentToSlot,
        removeTeachingGroup: removeTeachingGroup,

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
            'dropStudentFromClass',
            'assignStudentToSlot',
            'removeTeachingGroup'
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