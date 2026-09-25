/**
 * modules/academy/academy-schedule.js - Academy Schedule Coordinator
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
 *                               end every downstream window
 *     scheduleGroupMeeting      create a teaching session with a
 *                               blocking collision check
 *     scheduleInstructorSlot    resolve-or-create the group and
 *                               session implied by an instructor
 *                               staking a claim on a slot
 *     addStudentToTeachingGroup add a member to a group, validating
 *                               enrolment and elimination
 *     dropStudentFromClass      end every enrolment and membership
 *                               for a character in a class
 *     dropStudentFromGroup      end ONLY the membership of a
 *                               character in ONE group
 *     assignStudentToSlot       resolve-or-create the group and
 *                               session implied by a student
 *                               assignment, then add the membership
 *     removeTeachingGroup       delete a teaching group and every
 *                               session owned by it, in one
 *                               transaction
 *     createTeachingGroup       explicit new-group allocation
 *     applyRebalancePlan        apply a rebalance plan produced by
 *                               AcademyBalanceSuggestions across
 *                               every affected group, in one
 *                               transaction
 *     createInstructorCommitment   forward to the commitments module
 *     updateInstructorCommitment   forward to the commitments module
 *     removeInstructorCommitment   forward to the commitments module
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Single-store reads             (the queries modules)
 *   - Single-store writes            (the same domain modules)
 *   - Projection                     (AcademyTeachingProjector)
 *   - Collision DETECTION            (AcademyTeachingCollisions)
 *   - Validation warnings            (AcademyTeachingValidation)
 *   - Rendering                      (views)
 *   - Location entities              (AcademyLocations)
 *   - Instructor commitments store   (AcademyInstructorCommitments)
 *   - Group-number allocation        (AcademyTeachingGroups)
 *   - Rebalance algorithm            (AcademyBalanceSuggestions)
 *
 * COLLISION DETECTION — THE PREDICATES LIVE ELSEWHERE:
 *   The "is this resource free at this slot across this week
 *   range" question is owned by AcademyTeachingCollisions. This
 *   module is a CONSUMER of those predicates, not the owner.
 *
 *   The functions findInstructorCollision and findStudentCollision
 *   below are thin wrappers: they call
 *   AcademyTeachingCollisions.findInstructorConflict and
 *   AcademyTeachingCollisions.findStudentConflict, then reshape the
 *   result into the { session, group, commitment } / { session,
 *   group, studentId, week } shape this module has always
 *   returned. Every existing call site continues to work.
 *
 *   WHY THE PREDICATES MOVED OUT:
 *     The free-slots highlighter on the discipline grid needs to
 *     ask the SAME question the write path asks. When the answer
 *     lived here, the highlighter had its own answer — and the two
 *     disagreed, because the highlighter was discipline-scoped and
 *     week-scoped while the write path was academy-wide and
 *     range-scoped.
 *
 *     By moving the predicate into AcademyTeachingCollisions, both
 *     callers now use one implementation. They agree by
 *     construction.
 *
 *   THE RANGE RULE:
 *     The predicates are range-aware. A candidate that runs weeks
 *     5–40 collides with an instructor's session that runs weeks
 *     30–52 at the same (day, hour), even though the session is
 *     not active in weeks 5–29. The predicate unions the
 *     instructor's occurrences across the whole candidate range
 *     and checks overlap against any of them.
 *
 *     This is why the write path used to reject candidates the
 *     highlighter said were free: the highlighter was checking a
 *     single week (the display week), not the range.
 *
 * ALLOCATOR UNIFICATION:
 *   Group numbers are allocated exclusively by
 *   AcademyTeachingGroups.allocateGroupNumber(appData, ...). This
 *   module does NOT carry a local allocator. The two call sites
 *   that need a number — resolveOrCreateGroupAndSession (when
 *   creating a group) and createTeachingGroup — call the shared
 *   allocator with the appData snapshot the pipeline handed them.
 *
 *   resolveOrCreateGroupAndSession therefore takes appData, not
 *   academy. It resolves academy internally via
 *   getAcademySnapshot(appData), the same way every pipeline
 *   mutate callback in this file does.
 *
 * LOCATION DEPENDENCY:
 *   When a mutation supplies a locationId, AcademyLocations is
 *   MANDATORY at that moment. Lazy resolution solves load order;
 *   it does not make the dependency optional. A missing location
 *   provider, or a location that does not resolve, is a failure.
 *
 *   A null / empty / undefined locationId passes without consulting
 *   AcademyLocations. There is no reference to validate.
 *
 * DROP STUDENT FROM CLASS vs DROP STUDENT FROM GROUP:
 *   Two distinct operations, two distinct semantics:
 *
 *     dropStudentFromClass(classId, charId, effectiveWeek)
 *       The student leaves the class. Every enrolment interval
 *       they have in this class ends (across every discipline),
 *       every teaching-group membership they hold in this class
 *       ends (across every group), and the classId is removed
 *       from character.classIds. The student is no longer a
 *       member of the class.
 *
 *     dropStudentFromGroup(classId, groupId, charId, effectiveWeek)
 *       The student leaves ONE group. That group's membership
 *       interval for this character ends. Enrolments are
 *       untouched. Other groups are untouched. character.classIds
 *       is untouched. The student remains enrolled and remains
 *       a member of the class.
 *
 * APPLY REBALANCE PLAN:
 *   applyRebalancePlan(classId, disciplineId, week, plan) applies
 *   the output of AcademyBalanceSuggestions.suggest in ONE
 *   pipeline transaction.
 *
 *   WHAT IT DOES:
 *     For each group in the plan, its proposedMemberIds list is
 *     applied. Every group's roster becomes exactly the proposed
 *     list: current members who are not in the proposed list have
 *     their membership ended (endWeek = week - 1 on the active
 *     interval, OR the entry is removed entirely when its
 *     startWeek is at or after the effective week), and members in
 *     the proposed list who are not currently active in the group
 *     are added (startWeek = week, endWeek = null).
 *
 *   WHAT IT DOES NOT DO:
 *     - It does not touch groups not mentioned in the plan.
 *     - It does not touch sessions.
 *     - It does not touch enrolments.
 *     - It does not run the algorithm.
 *
 *   TRANSACTIONALITY:
 *     One pipeline. One transaction. Either every group's roster
 *     is updated, or none is.
 *
 * TRANSACTION MODEL:
 *   Every public function here is a single
 *   MutationPipeline.performMutation call, EXCEPT the three
 *   commitment forwarders, which delegate to the commitments
 *   module's own pipelines.
 *
 * INSTRUCTOR COMMITMENTS:
 *   The three forwarders exist so that the schedule module remains
 *   the single documented entry point for anything that shapes the
 *   instructor's weekly time.
 *
 *   No collision preflight runs on commitment create. Commitments
 *   may overlap class sessions and other commitments; the grid
 *   renders the overlap, the collision detector reports it, and
 *   the user decides.
 *
 *   Collision on the OTHER direction — a new class session that
 *   overlaps an existing commitment — IS rejected as an instructor
 *   collision. This is enforced by the predicate:
 *   AcademyTeachingCollisions.isInstructorBusy sees commitments
 *   because the projector folds them into the instructor's
 *   occurrence list.
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
 *   - window.AcademyTeachingGroups   (also: the group-number
 *                                      allocator)
 *   - window.AcademyTeachingSessions
 *   - window.AcademyTeachingCollisions  (the collision predicates)
 *   - window.CharacterQueries
 *   - window.EliminationQueries
 *
 * DEPENDENCIES (LAZY, mandatory at call time when used):
 *   - window.AcademyAggregator
 *   - window.AcademyTeachingProjector
 *   - window.AcademyLocations            (required when a
 *                                          locationId is set)
 *   - window.AcademyInstructorCommitments
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
    var AcademyTeachingCollisions = window.AcademyTeachingCollisions;
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

    function getAcademyLocations() {
        return window.AcademyLocations || null;
    }

    function getAcademyInstructorCommitments() {
        return window.AcademyInstructorCommitments || null;
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
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.allocateGroupNumber !== 'function') {
        _missing.push('AcademyTeachingGroups.allocateGroupNumber');
    }
    if (!AcademyTeachingSessions ||
        typeof AcademyTeachingSessions.getAllSessions !== 'function') {
        _missing.push('AcademyTeachingSessions.getAllSessions');
    }
    if (!AcademyTeachingCollisions ||
        typeof AcademyTeachingCollisions.isInstructorBusy !== 'function' ||
        typeof AcademyTeachingCollisions.isStudentBusy !== 'function' ||
        typeof AcademyTeachingCollisions.findInstructorConflict !== 'function' ||
        typeof AcademyTeachingCollisions.findStudentConflict !== 'function') {
        _missing.push('AcademyTeachingCollisions predicates');
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

    function weekInRange(week, startWeek, endWeek) {
        return RangeUtils.containsWeek(week, startWeek, endWeek);
    }

    function weekRangesOverlap(startA, endA, startB, endB) {
        return RangeUtils.weeksOverlap(startA, endA, startB, endB);
    }

    function getAcademySnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        return appData.academy;
    }

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
    // LOCATION RESOLUTION
    // ============================================================

    function resolveLocationId(rawLocationId) {
        if (rawLocationId === undefined ||
            rawLocationId === null ||
            rawLocationId === '') {
            return { ok: true, value: null };
        }

        if (!isNonEmptyString(rawLocationId)) {
            return {
                ok: false,
                message: 'Location ID must be a non-empty string.'
            };
        }

        var id = String(rawLocationId);
        var AL = getAcademyLocations();

        if (!AL || typeof AL.getLocation !== 'function') {
            return {
                ok: false,
                message: 'AcademyLocations is required to validate a ' +
                    'location. Check the script load order in index.html.'
            };
        }

        var loc = AL.getLocation(id);
        if (!loc) {
            return {
                ok: false,
                message: 'Location not found.'
            };
        }

        return { ok: true, value: id };
    }

    // ============================================================
    // COLLISION DETECTION — THIN WRAPPERS
    // ============================================================
    //
    // The predicates live in AcademyTeachingCollisions. These
    // functions call the predicates and reshape the result into
    // the { session, group, commitment } / { session, group,
    // studentId, week } shape this module has always returned.
    //
    // Every existing call site in this file was written against
    // that shape and continues to work unchanged.
    //
    // The predicate is academy-wide and range-aware. See the file
    // header for why that matters.

    /**
     * Find an instructor collision at a candidate slot.
     *
     * Returns null when no collision, or an object of the shape:
     *   { session, group, commitment }
     * where `session` is a session-shaped descriptor (or null for
     * a commitment collision), `group` is a group descriptor (or
     * null for a commitment collision), and `commitment` is the
     * conflicting commitment record (or null for a session
     * collision).
     *
     * @param {string} instructorId
     * @param {object} candidate
     *   { day, startTime, duration, startWeek, endWeek }
     * @param {string|null} excludeGroupId
     * @returns {object|null}
     */
    function findInstructorCollision(
        instructorId,
        candidate,
        excludeGroupId
    ) {
        if (!isNonEmptyString(instructorId)) {
            return null;
        }
        if (!isPlainObject(candidate)) {
            return null;
        }

        var conflict = AcademyTeachingCollisions.findInstructorConflict(
            instructorId,
            candidate.day,
            candidate.startTime,
            candidate.duration,
            candidate.startWeek,
            candidate.endWeek,
            {
                excludeGroupId: isNonEmptyString(excludeGroupId)
                    ? String(excludeGroupId)
                    : null
            }
        );

        if (!conflict) { return null; }

        return reshapeInstructorConflict(conflict);
    }

    /**
     * Reshape an occurrence returned by the collision predicate
     * into the descriptor shape this module has always returned.
     *
     * The occurrence carries `kind`:
     *   'class'        → a teaching session
     *   'officeHours'  → an instructor commitment (office hours)
     *   'tutoring'     → an instructor commitment (tutoring)
     *
     * The old shape distinguished these by which field was
     * populated. This function reconstructs that shape.
     *
     * `session` is the raw occurrence for class-kind conflicts;
     * the callers that consume this field read `session.day`,
     * `session.startTime`, `session.duration`, and `session.id` —
     * all of which the class occurrence carries. For commitment
     * conflicts, `session` is null.
     *
     * `group` is looked up from AcademyTeachingGroups for class
     * conflicts. A class occurrence carries a groupId; a
     * commitment does not.
     *
     * `commitment` is the raw occurrence for commitment conflicts.
     * Its `kind` is 'officeHours' or 'tutoring'; the callers that
     * consume it read `commitment.kind` to build the rejection
     * message.
     */
    function reshapeInstructorConflict(occurrence) {
        if (!isPlainObject(occurrence)) {
            return null;
        }

        var kind = occurrence.kind;

        if (kind === 'officeHours' || kind === 'tutoring') {
            return {
                session: null,
                group: null,
                commitment: occurrence
            };
        }

        // Default to class-kind. The predicate only returns an
        // occurrence that was projected for this instructor, so
        // 'class' is the only other possibility today.
        var session = occurrence;
        var group = null;

        if (isNonEmptyString(occurrence.groupId)) {
            try {
                group = AcademyTeachingGroups.getGroup(
                    occurrence.groupId
                );
            } catch (e) {
                group = null;
            }
        }

        return {
            session: session,
            group: group,
            commitment: null
        };
    }

    /**
     * Find a student collision at a candidate slot.
     *
     * Returns null when no collision, or an object of the shape:
     *   { session, group, studentId, week }
     *
     * The candidate slot's `startWeek` is stamped as the
     * collision's `week`. The predicate does not carry a week for
     * the conflicting occurrence (the occurrence is one week of a
     * multi-week run); the caller wants to know when the candidate
     * would overlap, and the candidate's own start week is the
     * answer.
     *
     * @param {string} studentId
     * @param {object} candidate
     *   { day, startTime, duration, startWeek, endWeek }
     * @param {string|null} excludeGroupId
     * @returns {object|null}
     */
    function findStudentCollision(
        studentId,
        candidate,
        excludeGroupId
    ) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        if (!isPlainObject(candidate)) {
            return null;
        }

        var conflict = AcademyTeachingCollisions.findStudentConflict(
            studentId,
            candidate.day,
            candidate.startTime,
            candidate.duration,
            candidate.startWeek,
            candidate.endWeek,
            {
                excludeGroupId: isNonEmptyString(excludeGroupId)
                    ? String(excludeGroupId)
                    : null
            }
        );

        if (!conflict) { return null; }

        return reshapeStudentConflict(conflict, candidate);
    }

    function reshapeStudentConflict(occurrence, candidate) {
        if (!isPlainObject(occurrence)) {
            return null;
        }

        var session = occurrence;
        var group = null;

        if (isNonEmptyString(occurrence.groupId)) {
            try {
                group = AcademyTeachingGroups.getGroup(
                    occurrence.groupId
                );
            } catch (e) {
                group = null;
            }
        }

        return {
            session: session,
            group: group,
            studentId: isNonEmptyString(occurrence.studentId)
                ? String(occurrence.studentId)
                : null,
            week: candidate.startWeek
        };
    }

    // ============================================================
    // COLLISION REJECTION — MESSAGE BUILDER
    // ============================================================

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

            var message;
            if (instructorCollision.commitment) {
                message = instructorName +
                    ' is already committed to a ' +
                    (instructorCollision.commitment.kind === 'tutoring'
                        ? 'tutoring block'
                        : 'office-hours block') +
                    ' during this time slot.';
            } else {
                message = instructorName +
                    ' is already teaching during this time slot.';
            }

            return {
                success: false,
                reason: 'instructor_collision',
                message: message,
                data: {
                    collision: {
                        type: 'instructor',
                        instructorId: instructorId,
                        instructorName: instructorName,
                        conflictingSession: instructorCollision.session,
                        conflictingGroup: instructorCollision.group,
                        conflictingCommitment: instructorCollision.commitment || null
                    }
                }
            };
        }

        // The student-side check needs a group of students to
        // collide with. When the candidate group has members, we
        // check each of them; the write path already knows the
        // candidate group and its roster.
        //
        // This mirrors the old behavior: the old function walked
        // the candidate group's active members and looked for a
        // shared student with an overlapping other session. The
        // new predicate asks the same question from the student
        // side: for each candidate-group member, is that student
        // busy at the candidate slot?
        //
        // The first member found busy produces the collision. This
        // matches the old "first shared student wins" semantics.

        var candidateStudentIds = getGroupActiveMembersAtWeek(
            candidateGroupId, candidate.startWeek
        );

        for (var i = 0; i < candidateStudentIds.length; i++) {
            var studentId = candidateStudentIds[i];

            var studentCollision = findStudentCollision(
                studentId, candidate, candidateGroupId
            );
            if (studentCollision) {
                var studentName = 'A student';
                try {
                    var studChar = CharacterQueries.getCharacterById(
                        studentId
                    );
                    if (studChar) {
                        studentName = CharacterQueries.getDisplayName(
                            studChar
                        );
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
                            studentId: studentId,
                            studentName: studentName,
                            week: studentCollision.week,
                            conflictingSession: studentCollision.session,
                            conflictingGroup: studentCollision.group
                        }
                    }
                };
            }
        }

        return null;
    }

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

    // ============================================================
    // addClassDiscipline
    // ============================================================

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
                    '" is no longer supported on addClassDiscipline.'
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
                'Discipline has no valid startWeek.'
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

                var cdBucket = academy.classDisciplines[targetClass];
                if (isPlainObject(cdBucket) &&
                    cdBucket[targetDiscipline]) {
                    delete cdBucket[targetDiscipline];
                    if (Object.keys(cdBucket).length === 0) {
                        delete academy.classDisciplines[targetClass];
                    }
                    stats.markerRemoved = true;
                }

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

        var locationResult = resolveLocationId(config.locationId);
        if (!locationResult.ok) {
            return Promise.resolve(failure(locationResult.message));
        }
        var locationId = locationResult.value;

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
    // dropStudentFromGroup
    // ============================================================

    function dropStudentFromGroup(classId, groupId, charId, effectiveWeek) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
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

        var targetClass = String(classId);
        var targetGroup = String(groupId);
        var targetChar = String(charId);
        var endWeek = week - 1;

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

        var liveIsMember = false;
        try {
            liveIsMember = AcademyTeachingGroups.isMemberOfGroup(
                targetGroup, targetChar, week
            ) === true;
        } catch (e) {
            liveIsMember = false;
        }
        if (!liveIsMember) {
            return Promise.resolve(failure(
                'The character is not an active member of this group ' +
                'during the requested week.'
            ));
        }

        var groupName = isNonEmptyString(liveGroup.customName)
            ? liveGroup.customName
            : ('group ' + targetGroup);

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
                    !isPlainObject(academy.teachingGroups[targetGroup])) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                var g = academy.teachingGroups[targetGroup];
                if (String(g.classId) !== targetClass) {
                    return {
                        valid: false,
                        message:
                            'Group no longer belongs to the specified class.'
                    };
                }
                if (!Array.isArray(g.members)) {
                    return {
                        valid: false,
                        message:
                            'The character is not a member of this group.'
                    };
                }
                var hasActive = false;
                for (var i = 0; i < g.members.length; i++) {
                    var m = g.members[i];
                    if (!m) { continue; }
                    if (String(m.characterId) !== targetChar) { continue; }
                    if (weekInRange(week, m.startWeek, m.endWeek)) {
                        hasActive = true;
                        break;
                    }
                }
                if (!hasActive) {
                    return {
                        valid: false,
                        message:
                            'The character is no longer an active member ' +
                            'of this group at week ' + week + '.'
                    };
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
                    throw new Error('Group has no members array.');
                }

                var matched = null;
                for (var i = 0; i < g.members.length; i++) {
                    var m = g.members[i];
                    if (!m) { continue; }
                    if (String(m.characterId) !== targetChar) { continue; }
                    if (weekInRange(week, m.startWeek, m.endWeek)) {
                        matched = m;
                        break;
                    }
                }

                if (!matched) {
                    throw new Error(
                        'Active membership interval not found at week ' +
                        week + '.'
                    );
                }

                matched.endWeek = endWeek;
                g.updatedAt = new Date().toISOString();

                return {
                    groupId: targetGroup,
                    characterId: targetChar,
                    effectiveWeek: week,
                    endWeek: endWeek
                };
            },
            logMessage: function(result) {
                return 'Removed ' + targetChar + ' from ' + groupName +
                    ' effective week ' + result.effectiveWeek;
            },
            successMessage: 'Left the group.',
            failureMessage: 'Failed to leave the group.'
        });
    }

    // ============================================================
    // removeTeachingGroup
    // ============================================================

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
    // applyRebalancePlan
    // ============================================================
    //
    // Apply a rebalance plan produced by
    // AcademyBalanceSuggestions.suggest in ONE transaction.
    //
    // See the file header for the full contract.
    //
    // THE END-MEMBERSHIP LOOP USES indexOf + splice:
    //   An earlier revision used
    //     group.members = group.members.filter(function(m) {
    //       return m !== activeEntry;
    //     });
    //   That closure captures `activeEntry` from the enclosing
    //   loop body. It works because the filter is invoked
    //   synchronously, before the next iteration reassigns the
    //   variable, but it looks like a stale-closure bug and is
    //   fragile against any future refactor that defers the filter.
    //   indexOf + splice is clearer and immune to the same class of
    //   mistake.

    function applyRebalancePlan(classId, disciplineId, week, plan) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        if (!isPlainObject(plan)) {
            return Promise.resolve(failure(
                'Plan must be an object.'
            ));
        }
        if (plan.ok !== true) {
            return Promise.resolve(failure(
                'Plan is not marked ok; refusing to apply.'
            ));
        }
        if (!Array.isArray(plan.assignments)) {
            return Promise.resolve(failure(
                'Plan.assignments must be an array.'
            ));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        var normalizedAssignments = [];
        var seenGroupIds = Object.create(null);
        var seenMemberIds = Object.create(null);

        for (var ai = 0; ai < plan.assignments.length; ai++) {
            var a = plan.assignments[ai];
            if (!isPlainObject(a)) {
                return Promise.resolve(failure(
                    'Plan.assignments[' + ai + '] must be an object.'
                ));
            }
            if (!isNonEmptyString(a.groupId)) {
                return Promise.resolve(failure(
                    'Plan.assignments[' + ai + '].groupId is required.'
                ));
            }

            var groupId = String(a.groupId);

            if (seenGroupIds[groupId] === true) {
                return Promise.resolve(failure(
                    'Plan.assignments contains duplicate groupId: ' +
                    groupId
                ));
            }
            seenGroupIds[groupId] = true;

            var proposed = Array.isArray(a.proposedMemberIds)
                ? a.proposedMemberIds
                : [];

            var cleanedMembers = [];
            for (var mi = 0; mi < proposed.length; mi++) {
                if (!isNonEmptyString(proposed[mi])) { continue; }
                var memberId = String(proposed[mi]);

                if (seenMemberIds[memberId] === true) {
                    return Promise.resolve(failure(
                        'Plan.assignments places student ' + memberId +
                        ' in more than one group.'
                    ));
                }
                seenMemberIds[memberId] = true;
                cleanedMembers.push(memberId);
            }

            normalizedAssignments.push({
                groupId: groupId,
                proposedMemberIds: cleanedMembers
            });
        }

        var cls = AcademyClasses.getClass(targetClass);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var discipline = AcademyDisciplines.getDiscipline(
            targetDiscipline
        );
        if (!discipline) {
            return Promise.resolve(failure('Discipline not found.'));
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

                if (!findClassInSnapshot(appData, targetClass)) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }

                if (!findDisciplineInSnapshot(
                    appData, targetDiscipline
                )) {
                    return {
                        valid: false,
                        message: 'Discipline no longer exists.'
                    };
                }

                for (var i = 0; i < normalizedAssignments.length; i++) {
                    var na = normalizedAssignments[i];
                    var group = getGroupFromSnapshot(appData, na.groupId);
                    if (!group) {
                        return {
                            valid: false,
                            message: 'Teaching group no longer exists: ' +
                                na.groupId
                        };
                    }
                    if (String(group.classId) !== targetClass) {
                        return {
                            valid: false,
                            message: 'Group ' + na.groupId +
                                ' does not belong to the specified class.'
                        };
                    }
                    if (String(group.disciplineId) !== targetDiscipline) {
                        return {
                            valid: false,
                            message: 'Group ' + na.groupId +
                                ' does not belong to the specified ' +
                                'discipline.'
                        };
                    }
                }

                for (var j = 0; j < normalizedAssignments.length; j++) {
                    var na2 = normalizedAssignments[j];
                    for (var k = 0;
                         k < na2.proposedMemberIds.length;
                         k++) {
                        var memberId = na2.proposedMemberIds[k];

                        if (!findCharacterInSnapshot(appData, memberId)) {
                            return {
                                valid: false,
                                message: 'Student no longer exists: ' +
                                    memberId
                            };
                        }

                        if (!isEnrolledInSnapshot(
                            appData,
                            memberId,
                            targetClass,
                            targetDiscipline,
                            weekNum
                        )) {
                            return {
                                valid: false,
                                message: 'Student ' + memberId +
                                    ' is not enrolled in this discipline ' +
                                    'at week ' + weekNum + '.'
                            };
                        }
                    }
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                var endWeek = weekNum - 1;
                var now = new Date().toISOString();

                var membershipsEnded = 0;
                var membershipsStarted = 0;

                for (var ai2 = 0; ai2 < normalizedAssignments.length; ai2++) {
                    var na3 = normalizedAssignments[ai2];
                    var group = academy.teachingGroups[na3.groupId];
                    if (!isPlainObject(group)) {
                        throw new Error(
                            'Group not found during apply: ' +
                            na3.groupId
                        );
                    }

                    if (!Array.isArray(group.members)) {
                        group.members = [];
                    }

                    var proposedSet = Object.create(null);
                    for (var pi = 0;
                         pi < na3.proposedMemberIds.length;
                         pi++) {
                        proposedSet[na3.proposedMemberIds[pi]] = true;
                    }

                    var activeSet = Object.create(null);
                    for (var mi2 = 0; mi2 < group.members.length; mi2++) {
                        var entry = group.members[mi2];
                        if (!entry) { continue; }
                        if (!isNonEmptyString(entry.characterId)) {
                            continue;
                        }
                        if (!weekInRange(
                            weekNum,
                            entry.startWeek,
                            entry.endWeek
                        )) {
                            continue;
                        }
                        activeSet[String(entry.characterId)] = entry;
                    }

                    var activeIds = Object.keys(activeSet);
                    for (var ei = 0; ei < activeIds.length; ei++) {
                        var activeId = activeIds[ei];
                        if (proposedSet[activeId] === true) {
                            continue;
                        }

                        var activeEntry = activeSet[activeId];

                        if (activeEntry.startWeek >= weekNum) {
                            var idx = group.members.indexOf(activeEntry);
                            if (idx !== -1) {
                                group.members.splice(idx, 1);
                                membershipsEnded++;
                            }
                        } else {
                            activeEntry.endWeek = endWeek;
                            membershipsEnded++;
                        }
                    }

                    for (var si2 = 0;
                         si2 < na3.proposedMemberIds.length;
                         si2++) {
                        var proposedId = na3.proposedMemberIds[si2];
                        if (activeSet[proposedId] !== undefined) {
                            continue;
                        }

                        group.members.push({
                            characterId: proposedId,
                            startWeek: weekNum,
                            endWeek: null
                        });
                        membershipsStarted++;
                    }

                    group.updatedAt = now;
                }

                return {
                    groupsProcessed: normalizedAssignments.length,
                    membershipsEnded: membershipsEnded,
                    membershipsStarted: membershipsStarted
                };
            },

            logMessage: function(result) {
                return 'Applied rebalance plan: ' +
                    result.groupsProcessed + ' group(s), ' +
                    result.membershipsEnded + ' membership(s) ended, ' +
                    result.membershipsStarted + ' membership(s) started';
            },

            successMessage: function(result) {
                return 'Rebalance applied. ' +
                    result.membershipsStarted + ' started, ' +
                    result.membershipsEnded + ' ended.';
            },

            failureMessage: 'Failed to apply the rebalance plan.'
        });
    }

    function isEnrolledInSnapshot(
        appData,
        charId,
        classId,
        disciplineId,
        week
    ) {
        var academy = getAcademySnapshot(appData);
        if (!academy) { return false; }
        var enrBucket = academy.enrolments &&
            academy.enrolments[classId];
        if (!isPlainObject(enrBucket)) { return false; }
        var intervals = enrBucket[charId];
        if (!Array.isArray(intervals)) { return false; }

        var targetDiscipline = String(disciplineId);
        for (var i = 0; i < intervals.length; i++) {
            var entry = intervals[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (String(entry.disciplineId) !== targetDiscipline) {
                continue;
            }
            if (weekInRange(week, entry.startWeek, entry.endWeek)) {
                return true;
            }
        }
        return false;
    }

    function findClassInSnapshot(appData, classId) {
        if (!appData || !isPlainObject(appData.academy)) {
            return null;
        }
        var store = appData.academy.graduatingClasses;
        if (!isPlainObject(store)) { return null; }
        if (!isNonEmptyString(classId)) { return null; }
        var record = store[String(classId)];
        if (!isPlainObject(record)) { return null; }
        return record;
    }

    function findDisciplineInSnapshot(appData, disciplineId) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var target = String(disciplineId);

        if (appData.academy && typeof appData.academy === 'object') {
            var academyList = appData.academy.disciplines;
            if (Array.isArray(academyList)) {
                for (var a = 0; a < academyList.length; a++) {
                    var ad = academyList[a];
                    if (ad && String(ad.id) === target) {
                        return ad;
                    }
                }
            }
        }

        if (appData.curriculum && typeof appData.curriculum === 'object') {
            var legacyList = appData.curriculum.disciplines;
            if (Array.isArray(legacyList)) {
                for (var l = 0; l < legacyList.length; l++) {
                    var ld = legacyList[l];
                    if (ld && String(ld.id) === target) {
                        return ld;
                    }
                }
            }
        }

        return null;
    }

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        if (!isNonEmptyString(charId)) { return null; }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    // ============================================================
    // assignStudentToSlot
    // ============================================================

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

    function sessionMatchesExactly(session, day, startTime, duration) {
        return session.day === day &&
               session.startTime === startTime &&
               session.duration === duration;
    }

    function timeSlotsOverlap(day, startTime, duration, session) {
        if (day !== session.day) { return false; }
        var aEnd = startTime + duration;
        var bEnd = session.startTime + session.duration;
        return startTime < bEnd && session.startTime < aEnd;
    }

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

    function generateGroupId() {
        return IdUtils.generateId('tgroup');
    }

    function generateSessionId() {
        return IdUtils.generateId('tsession');
    }

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

    function validateExplicitGroup(
        academy,
        groupId,
        classId,
        disciplineId,
        instructorId
    ) {
        if (!isPlainObject(academy) ||
            !isPlainObject(academy.teachingGroups)) {
            return {
                ok: false,
                reason: 'group_not_found',
                message: 'Teaching group store is not available.'
            };
        }

        var g = academy.teachingGroups[String(groupId)];
        if (!isPlainObject(g)) {
            return {
                ok: false,
                reason: 'group_not_found',
                message: 'Teaching group not found.'
            };
        }

        if (String(g.classId) !== String(classId)) {
            return {
                ok: false,
                reason: 'group_mismatch',
                message: 'Teaching group does not belong to this class.'
            };
        }
        if (String(g.disciplineId) !== String(disciplineId)) {
            return {
                ok: false,
                reason: 'group_mismatch',
                message: 'Teaching group does not belong to this discipline.'
            };
        }
        if (instructorId !== null &&
            instructorId !== undefined &&
            String(g.instructorId) !== String(instructorId)) {
            return {
                ok: false,
                reason: 'group_mismatch',
                message: 'Teaching group does not belong to this instructor.'
            };
        }

        return { ok: true, group: g };
    }

    function assignStudentToSlot(payload) {
        if (!isPlainObject(payload)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Payload must be an object.'
            ));
        }

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

        var locationResult = resolveLocationId(payload.locationId);
        if (!locationResult.ok) {
            return Promise.resolve(rejection(
                'invalid_input',
                locationResult.message
            ));
        }
        var locationId = locationResult.value;

        var allowCollisions = payload.allowCollisions === true;

        var targetChar = String(payload.charId);
        var targetClass = String(payload.classId);
        var targetDiscipline = String(payload.disciplineId);

        var explicitInstructor = isNonEmptyString(payload.instructorId)
            ? String(payload.instructorId)
            : null;

        var explicitGroupId = isNonEmptyString(payload.groupId)
            ? String(payload.groupId)
            : null;

        var forceNewGroup = payload.forceNewGroup === true;

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

        if (explicitInstructor === null && explicitGroupId === null) {
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

                var targetInstructor;
                if (explicitInstructor !== null) {
                    targetInstructor = explicitInstructor;
                } else if (explicitGroupId !== null) {
                    var pinnedGroup = isPlainObject(academy.teachingGroups)
                        ? academy.teachingGroups[String(explicitGroupId)]
                        : null;
                    if (!isPlainObject(pinnedGroup)) {
                        throw new Error('__group_not_found__');
                    }
                    if (String(pinnedGroup.classId) !== targetClass) {
                        throw new Error('__group_mismatch__:class');
                    }
                    if (String(pinnedGroup.disciplineId) !==
                        targetDiscipline) {
                        throw new Error('__group_mismatch__:discipline');
                    }
                    targetInstructor = String(pinnedGroup.instructorId);
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
                        throw new Error('__missing_instructor__');
                    }
                    targetInstructor = resolution.instructorId;
                }

                var resolved = resolveOrCreateGroupAndSession(
                    appData,
                    targetClass,
                    targetDiscipline,
                    targetInstructor,
                    week,
                    day,
                    startHour,
                    duration,
                    snapshotDiscipline,
                    locationId,
                    explicitGroupId,
                    forceNewGroup
                );

                var resolvedGroup = resolved.group;
                var resolvedSession = resolved.session;
                var createdGroup = resolved.createdGroup;
                var createdSession = resolved.createdSession;

                if (!allowCollisions) {
                    var studentCollision = findStudentCollision(
                        targetChar,
                        {
                            day: day,
                            startTime: startHour,
                            duration: duration,
                            startWeek: resolvedSession.startWeek,
                            endWeek: resolvedSession.endWeek
                        },
                        resolvedGroup.id
                    );
                    if (studentCollision) {
                        throw new Error(
                            '__student_collision__:' +
                            JSON.stringify({
                                day: studentCollision.session
                                    ? studentCollision.session.day
                                    : day,
                                startTime: studentCollision.session
                                    ? studentCollision.session.startTime
                                    : startHour,
                                duration: studentCollision.session
                                    ? studentCollision.session.duration
                                    : duration,
                                conflictingSessionId: studentCollision.session
                                    ? studentCollision.session.sessionId
                                    : null,
                                conflictingGroupId: studentCollision.session
                                    ? studentCollision.session.groupId
                                    : null,
                                conflictingDisciplineId:
                                    studentCollision.session
                                        ? studentCollision.session.disciplineId
                                        : null
                            })
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
                                    group: instructorCollision.group
                                        ? {
                                            id: instructorCollision.group.id,
                                            name: instructorCollision.group.name
                                          }
                                        : null,
                                    commitment: instructorCollision.commitment
                                        || null
                                })
                            );
                        }
                    }
                }

                if (!Array.isArray(resolvedGroup.members)) {
                    resolvedGroup.members = [];
                }

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
                            locationId: resolvedSession.locationId || null,
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
                    locationId: resolvedSession.locationId || null,
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
            return reshapeSentinelRejection(result);
        });
    }

    // ============================================================
    // scheduleInstructorSlot
    // ============================================================

    function scheduleInstructorSlot(payload) {
        if (!isPlainObject(payload)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Payload must be an object.'
            ));
        }

        if (!isNonEmptyString(payload.instructorId)) {
            return Promise.resolve(rejection(
                'invalid_input',
                'Instructor ID is required.'
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

        var locationResult = resolveLocationId(payload.locationId);
        if (!locationResult.ok) {
            return Promise.resolve(rejection(
                'invalid_input',
                locationResult.message
            ));
        }
        var locationId = locationResult.value;

        var allowCollisions = payload.allowCollisions === true;

        var targetInstructor = String(payload.instructorId);
        var targetClass = String(payload.classId);
        var targetDiscipline = String(payload.disciplineId);

        var explicitGroupId = isNonEmptyString(payload.groupId)
            ? String(payload.groupId)
            : null;

        var forceNewGroup = payload.forceNewGroup === true;

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

        var char = CharacterQueries.getCharacterById(targetInstructor);
        if (!char) {
            return Promise.resolve(rejection(
                'character_not_found',
                'Instructor not found.'
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

        var isInstructorEnrolled = false;
        try {
            isInstructorEnrolled = AcademyEnrolments.isEnrolledInWeek(
                targetInstructor, targetClass, targetDiscipline, week
            );
        } catch (e) {
            isInstructorEnrolled = false;
        }

        if (!isInstructorEnrolled) {
            return Promise.resolve(rejection(
                'not_an_instructor',
                'This character is not assigned to teach this ' +
                'discipline for this class during the requested week.'
            ));
        }

        if (char.mode !== 'instructor') {
            return Promise.resolve(rejection(
                'not_an_instructor',
                'This character is not in instructor mode.'
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

                if (!characterInClassInSnapshot(
                    appData, targetInstructor, targetClass
                )) {
                    return {
                        valid: false,
                        message: 'Instructor is no longer a member of this class.'
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

                var interval = findEnrolmentIntervalForWeek(
                    academy,
                    targetInstructor,
                    targetClass,
                    targetDiscipline,
                    week
                );
                if (!interval) {
                    return {
                        valid: false,
                        message: 'Instructor enrolment no longer covers ' +
                            'the requested week.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                var snapshotDiscipline = AcademyDisciplines.getDiscipline(
                    targetDiscipline
                );
                if (!snapshotDiscipline) {
                    throw new Error('Discipline not found.');
                }

                var resolved = resolveOrCreateGroupAndSession(
                    appData,
                    targetClass,
                    targetDiscipline,
                    targetInstructor,
                    week,
                    day,
                    startHour,
                    duration,
                    snapshotDiscipline,
                    locationId,
                    explicitGroupId,
                    forceNewGroup
                );

                var resolvedGroup = resolved.group;
                var resolvedSession = resolved.session;
                var createdGroup = resolved.createdGroup;
                var createdSession = resolved.createdSession;

                if (!allowCollisions) {
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
                                    group: instructorCollision.group
                                        ? {
                                            id: instructorCollision.group.id,
                                            name: instructorCollision.group.name
                                          }
                                        : null,
                                    commitment: instructorCollision.commitment
                                        || null
                                })
                            );
                        }
                    }
                }

                return {
                    groupId: String(resolvedGroup.id),
                    sessionId: String(resolvedSession.id),
                    disciplineId: targetDiscipline,
                    instructorId: targetInstructor,
                    week: week,
                    day: day,
                    startHour: startHour,
                    duration: duration,
                    locationId: resolvedSession.locationId || null,
                    createdGroup: createdGroup,
                    createdSession: createdSession
                };
            },

            logMessage: function(result) {
                var parts = ['Scheduled instructor slot for ' +
                    targetDiscipline];
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

            successMessage: 'Slot added to instructor schedule.',

            failureMessage: 'Failed to add slot to instructor schedule.'
        }).then(function(result) {
            return reshapeSentinelRejection(result);
        });
    }

    // ============================================================
    // SHARED RESOLVERS
    // ============================================================

    function resolveOrCreateGroupAndSession(
        appData,
        classId,
        disciplineId,
        instructorId,
        week,
        day,
        startHour,
        duration,
        discipline,
        locationId,
        explicitGroupId,
        forceNewGroup
    ) {
        var academy = getAcademySnapshot(appData);
        if (!academy) {
            throw new Error('Academy store is not available.');
        }

        var resolvedGroup = null;
        var resolvedSession = null;
        var createdGroup = false;
        var createdSession = false;

        if (!forceNewGroup &&
            explicitGroupId !== null &&
            explicitGroupId !== undefined) {
            var check = validateExplicitGroup(
                academy,
                explicitGroupId,
                classId,
                disciplineId,
                instructorId
            );
            if (!check.ok) {
                throw new Error(
                    '__explicit_group_invalid__:' +
                    check.reason + ':' + check.message
                );
            }
            resolvedGroup = check.group;

            if (!weekInRange(
                week,
                resolvedGroup.startWeek,
                resolvedGroup.endWeek
            )) {
                throw new Error(
                    '__explicit_group_inactive__:' + explicitGroupId
                );
            }
        }

        if (resolvedGroup === null && forceNewGroup !== true) {
            var candidates = collectCandidateGroups(
                academy,
                classId,
                disciplineId,
                instructorId
            );

            candidates.sort(function(a, b) {
                var as = typeof a.startWeek === 'number'
                    ? a.startWeek : 0;
                var bs = typeof b.startWeek === 'number'
                    ? b.startWeek : 0;
                if (as !== bs) { return as - bs; }
                return String(a.id).localeCompare(String(b.id));
            });

            var fallbackGroup = null;
            var fallbackSession = null;
            var sawOverlapOnly = false;

            for (var ci = 0; ci < candidates.length; ci++) {
                var candidateGroup = candidates[ci];

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
                    sawOverlapOnly = true;
                    continue;
                }

                if (fallbackGroup === null) {
                    fallbackGroup = candidateGroup;
                    fallbackSession = null;
                }
            }

            if (resolvedGroup === null && fallbackGroup !== null) {
                resolvedGroup = fallbackGroup;
                resolvedSession = fallbackSession;
            }

            void sawOverlapOnly;
        }

        if (resolvedGroup !== null && resolvedSession === null) {
            var groupSessions = collectSessionsForGroup(
                academy, resolvedGroup.id
            );

            var sessionExact = null;
            var sessionOverlapping = null;

            for (var gsi = 0; gsi < groupSessions.length; gsi++) {
                var gs = groupSessions[gsi];
                if (!weekInRange(
                    week,
                    gs.startWeek,
                    gs.endWeek
                )) {
                    continue;
                }
                if (sessionMatchesExactly(
                    gs, day, startHour, duration
                )) {
                    sessionExact = gs;
                    break;
                }
                if (timeSlotsOverlap(
                    day, startHour, duration, gs
                )) {
                    sessionOverlapping = gs;
                }
            }

            if (sessionExact) {
                resolvedSession = sessionExact;
            } else if (sessionOverlapping) {
                throw new Error(
                    '__group_session_overlap__:' +
                    String(sessionOverlapping.id)
                );
            }
        }

        if (!resolvedGroup) {
            var newGroupId = generateGroupId();
            var groupNumber = AcademyTeachingGroups.allocateGroupNumber(
                appData,
                classId,
                disciplineId,
                instructorId
            );
            var now = new Date().toISOString();

            resolvedGroup = {
                id: newGroupId,
                classId: classId,
                disciplineId: disciplineId,
                instructorId: instructorId,
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
            var sessionStart = week;
            var sessionEnd = null;
            if (discipline.endWeek !== undefined &&
                discipline.endWeek !== null &&
                discipline.endWeek !== '') {
                var parsedDiscEnd = parseWeekStrict(
                    discipline.endWeek
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
                locationId: (locationId === undefined || locationId === null)
                    ? null
                    : String(locationId),
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

        return {
            group: resolvedGroup,
            session: resolvedSession,
            createdGroup: createdGroup,
            createdSession: createdSession
        };
    }

    // ============================================================
    // createTeachingGroup
    // ============================================================

    function createTeachingGroup(payload) {
        if (!isPlainObject(payload)) {
            return Promise.resolve(failure('Payload must be an object.'));
        }
        if (!isNonEmptyString(payload.classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(payload.disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }
        if (!isNonEmptyString(payload.instructorId)) {
            return Promise.resolve(failure('Instructor ID is required.'));
        }

        var week = parseWeekStrict(payload.week);
        if (week === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(payload.classId);
        var targetDiscipline = String(payload.disciplineId);
        var targetInstructor = String(payload.instructorId);

        var cls = AcademyClasses.getClass(targetClass);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var discipline = AcademyDisciplines.getDiscipline(targetDiscipline);
        if (!discipline) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        var char = CharacterQueries.getCharacterById(targetInstructor);
        if (!char) {
            return Promise.resolve(failure('Instructor not found.'));
        }
        if (char.mode !== 'instructor') {
            return Promise.resolve(failure(
                'This character is not in instructor mode.'
            ));
        }

        var marker = AcademyClassDisciplinesQueries.getClassDiscipline(
            targetClass, targetDiscipline
        );
        if (!marker) {
            return Promise.resolve(failure(
                'This class does not offer this discipline.'
            ));
        }

        if (!AcademyClassDisciplinesQueries.isActiveInWeek(
            targetClass, targetDiscipline, week
        )) {
            return Promise.resolve(failure(
                'This discipline is not active during the requested week.'
            ));
        }

        var enrolled = false;
        try {
            enrolled = AcademyEnrolments.isEnrolledInWeek(
                targetInstructor, targetClass, targetDiscipline, week
            );
        } catch (e) {
            enrolled = false;
        }
        if (!enrolled) {
            return Promise.resolve(failure(
                'This character is not assigned to teach this ' +
                'discipline for this class during the requested week.'
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
                if (!characterInClassInSnapshot(
                    appData, targetInstructor, targetClass
                )) {
                    return {
                        valid: false,
                        message:
                            'Instructor is no longer a member of this class.'
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
                var interval = findEnrolmentIntervalForWeek(
                    academy,
                    targetInstructor,
                    targetClass,
                    targetDiscipline,
                    week
                );
                if (!interval) {
                    return {
                        valid: false,
                        message:
                            'Instructor enrolment no longer covers the ' +
                            'requested week.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var academy = getAcademySnapshot(appData);
                if (!academy) {
                    throw new Error('Academy store is not available.');
                }

                var newGroupId = generateGroupId();
                var groupNumber = AcademyTeachingGroups.allocateGroupNumber(
                    appData,
                    targetClass,
                    targetDiscipline,
                    targetInstructor
                );
                var now = new Date().toISOString();

                var group = {
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
                academy.teachingGroups[newGroupId] = group;

                return {
                    group: group,
                    groupId: newGroupId,
                    groupNumber: groupNumber
                };
            },
            logMessage: 'Created teaching group for ' +
                targetDiscipline + ' / ' + targetInstructor,
            successMessage: 'Teaching group created.',
            failureMessage: 'Failed to create teaching group.'
        });
    }

    // ============================================================
    // INSTRUCTOR COMMITMENT FORWARDERS
    // ============================================================

    function createInstructorCommitment(payload) {
        var C = getAcademyInstructorCommitments();
        if (!C || typeof C.createCommitment !== 'function') {
            return Promise.resolve(failure(
                'Instructor commitments module is not available.'
            ));
        }
        return C.createCommitment(payload);
    }

    function updateInstructorCommitment(commitmentId, updates) {
        var C = getAcademyInstructorCommitments();
        if (!C || typeof C.updateCommitment !== 'function') {
            return Promise.resolve(failure(
                'Instructor commitments module is not available.'
            ));
        }
        return C.updateCommitment(commitmentId, updates);
    }

    function removeInstructorCommitment(commitmentId) {
        var C = getAcademyInstructorCommitments();
        if (!C || typeof C.removeCommitment !== 'function') {
            return Promise.resolve(failure(
                'Instructor commitments module is not available.'
            ));
        }
        return C.removeCommitment(commitmentId);
    }

    // ============================================================
    // SENTINEL RESHAPING
    // ============================================================

    function reshapeSentinelRejection(result) {
        if (!result || result.success !== false) {
            return result;
        }
        if (typeof result.message !== 'string') {
            return result;
        }

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
            '__explicit_group_invalid__:'
        ) === 0) {
            var parts = result.message.split(':');
            var reason = parts.length >= 3 ? parts[2] : 'invalid';
            return rejection(
                'explicit_group_invalid',
                'The selected group is not valid for this slot ' +
                '(' + reason + ').'
            );
        }

        if (result.message.indexOf(
            '__explicit_group_inactive__:'
        ) === 0) {
            return rejection(
                'explicit_group_inactive',
                'The selected group is not active during the ' +
                'requested week.'
            );
        }

        if (result.message.indexOf(
            '__group_not_found__'
        ) === 0) {
            return rejection(
                'group_not_found',
                'The selected group no longer exists.'
            );
        }

        if (result.message.indexOf(
            '__group_mismatch__:'
        ) === 0) {
            return rejection(
                'group_mismatch',
                'The selected group does not match the class, ' +
                'discipline, or instructor of this slot.'
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
            var parsed = parseSentinelJson(
                result.message,
                '__instructor_collision__:'
            );
            var message = 'The instructor is already teaching at an ' +
                'overlapping time.';
            if (parsed && parsed.commitment) {
                message = 'The instructor is already committed to a ' +
                    (parsed.commitment.kind === 'tutoring'
                        ? 'tutoring block'
                        : 'office-hours block') +
                    ' during this time slot.';
            }
            return rejection(
                'instructor_collision',
                message,
                { collision: parsed }
            );
        }

        return result;
    }

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
        scheduleInstructorSlot: scheduleInstructorSlot,
        addStudentToTeachingGroup: addStudentToTeachingGroup,
        dropStudentFromClass: dropStudentFromClass,
        dropStudentFromGroup: dropStudentFromGroup,
        assignStudentToSlot: assignStudentToSlot,
        removeTeachingGroup: removeTeachingGroup,
        createTeachingGroup: createTeachingGroup,
        applyRebalancePlan: applyRebalancePlan,

        // Instructor-commitment forwarders
        createInstructorCommitment: createInstructorCommitment,
        updateInstructorCommitment: updateInstructorCommitment,
        removeInstructorCommitment: removeInstructorCommitment,

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
            'scheduleInstructorSlot',
            'addStudentToTeachingGroup',
            'dropStudentFromClass',
            'dropStudentFromGroup',
            'assignStudentToSlot',
            'removeTeachingGroup',
            'createTeachingGroup',
            'applyRebalancePlan',
            'createInstructorCommitment',
            'updateInstructorCommitment',
            'removeInstructorCommitment'
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
