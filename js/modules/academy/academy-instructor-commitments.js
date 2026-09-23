/**
 * modules/academy/academy-instructor-commitments.js
 * Academy Instructor Commitments
 *
 * Path: js/modules/academy/academy-instructor-commitments.js
 *
 * SINGLE SOURCE OF TRUTH for instructor-only time blocks.
 *
 * WHAT THIS MODULE OWNS:
 *   A commitment: a block of time on an instructor's weekly
 *   schedule that is not a teaching session. Two kinds:
 *
 *     'officeHours'  the instructor is available. No character.
 *     'tutoring'     the instructor is meeting someone who is
 *                    not necessarily in the Academy. Optional
 *                    character reference, optional label.
 *
 *   Storage:
 *
 *     academy.instructorCommitments[commitmentId] = {
 *       id,
 *       classId,
 *       instructorId,
 *       kind,              // 'officeHours' | 'tutoring'
 *       day,               // 1-7, Monday=1
 *       startTime,         // hour, 0-23
 *       duration,          // hours, 1..MAX_CLASS_DURATION
 *       locationId,        // null when unset
 *       characterId,       // null, only meaningful when kind === 'tutoring'
 *       label,             // '' when unset
 *       startWeek,         // 1..MAX_WEEK
 *       endWeek,           // null = ongoing
 *       createdAt,
 *       updatedAt
 *     }
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The teaching-sessions store     (AcademyTeachingSessions)
 *   - The teaching-groups store       (AcademyTeachingGroups)
 *   - The social-relationship store   (SocialCore / SocialQueries)
 *   - The class-discipline store      (AcademyClassDisciplines)
 *   - Student enrolment               (AcademyEnrolments)
 *
 * SEMANTICS:
 *   Commitments are INSTRUCTOR-ONLY time blocks. They never
 *   appear on a student's schedule, never roll into any student's
 *   weekly-hours target, and are never suppressed by a class's
 *   rest days. They are the instructor's own commitment and are
 *   independent of any class's calendar.
 *
 *   They DO participate in instructor collision detection: two
 *   commitments on the same instructor at overlapping times are
 *   a conflict, and a commitment that overlaps a class session
 *   taught by the same instructor is a conflict. The collision
 *   detector reads them via the projector; this module does not
 *   perform the detection.
 *
 *   When location is set, a commitment also occupies a location.
 *   The location collision rule applies: a room cannot be
 *   double-booked. As above, that rule is enforced by the
 *   collision detector, not here.
 *
 * KIND DISCRIMINATION:
 *   The two kinds share every field except `characterId`.
 *   `characterId` is only accepted when kind is 'tutoring'. A
 *   caller that tries to set it on an office hour gets a
 *   rejection, not a silent drop. The reason is that a silently
 *   dropped field is a bug the caller cannot see. A rejection is
 *   a bug the caller has to fix.
 *
 * MENTORING HOOK (tutoring only):
 *   When a tutoring commitment is created or updated with a
 *   characterId, the save sequence also ensures a mentor
 *   relationship exists between the instructor (as mentor) and
 *   the character (as mentee) in the Social domain.
 *
 *   The check is DIRECTIONAL and FORWARD-ONLY:
 *
 *     SocialQueries.relationshipExists(
 *       instructorId, characterId, 'mentor'
 *     )
 *
 *   A reverse-direction mentor relationship (character mentors
 *   instructor) does not satisfy the check. Both directions are
 *   distinct facts, and the tutoring block means only one of
 *   them.
 *
 *   The relationship create is a SEPARATE MUTATION PIPELINE,
 *   run after the commitment write commits. If it fails, the
 *   commitment stays. The user sees a toast asking them to retry
 *   the relationship from the Social tab. Atomicity across the
 *   two stores is not attempted; the two stores belong to two
 *   domains and have two owners.
 *
 *   When SocialCore is not available, or when its character
 *   provider has not been initialised, the relationship create
 *   is skipped and the same "commitment saved, relationship not
 *   saved" outcome applies. The commitment record is unaffected.
 *
 * RANGE PREDICATES:
 *   Week-in-range and time-overlap questions in this module
 *   delegate to RangeUtils. This module does not reimplement
 *   range math. Where RangeUtils does not cover a specific
 *   question (hour-level overlap), the local helper performs it
 *   directly.
 *
 * MUTATION CONTRACT:
 *   Every public mutation returns Promise<{ success, data?, message? }>.
 *   Every mutation routes through MutationPipeline.
 *   Every mutation is atomic on its OWN store.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.RangeUtils
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.AcademyClasses       (class existence + class reads)
 *   - window.CharacterQueries     (instructor existence + display)
 *
 * DEPENDENCIES (LAZY, used at call time):
 *   - window.AcademyLocations     (location existence, optional)
 *   - window.SocialCore           (mentor relationship create)
 *   - window.SocialQueries        (mentor relationship read)
 *   - window.NotificationSystem   (soft-failure notice)
 *
 * USAGE:
 *   var C = window.AcademyInstructorCommitments;
 *
 *   // Office hours
 *   C.createCommitment({
 *       classId: 'class_1',
 *       instructorId: 'char_1',
 *       kind: 'officeHours',
 *       day: 3,
 *       startTime: 14,
 *       duration: 2,
 *       locationId: 'loc_office',
 *       label: 'Open hours',
 *       startWeek: 5,
 *       endWeek: null
 *   }).then(function (r) { ... });
 *
 *   // Tutoring (with a mentor relationship ensured)
 *   C.createCommitment({
 *       classId: 'class_1',
 *       instructorId: 'char_1',
 *       kind: 'tutoring',
 *       characterId: 'char_42',
 *       day: 5,
 *       startTime: 10,
 *       duration: 1,
 *       label: 'Thesis chapter 3',
 *       startWeek: 5,
 *       endWeek: null
 *   }).then(function (r) { ... });
 */

(function() {
    'use strict';

    if (window.__academyInstructorCommitmentsLoaded) {
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
    var CharacterQueries = window.CharacterQueries;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils ||
        typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function' ||
        typeof CalendarValidation.parseDay !== 'function' ||
        typeof CalendarValidation.parseHour !== 'function' ||
        typeof CalendarValidation.parseDuration !== 'function') {
        _missing.push('CalendarValidation week/day/hour/duration parsers');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number' ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.MIN_HOUR !== 'number' ||
        typeof CalendarConstants.MAX_HOUR !== 'number' ||
        typeof CalendarConstants.MIN_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.MAX_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.CALENDAR_END_HOUR !== 'number') {
        _missing.push('CalendarConstants bounds');
    }
    if (!RangeUtils || typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyInstructorCommitments] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyInstructorCommitmentsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MIN_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;

    var KIND_OFFICE_HOURS = 'officeHours';
    var KIND_TUTORING = 'tutoring';
    var VALID_KINDS = [KIND_OFFICE_HOURS, KIND_TUTORING];

    var MENTOR_TYPE_ID = 'mentor';

    var LABEL_MAX_LENGTH = 60;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyLocations() {
        return window.AcademyLocations || null;
    }

    function getSocialCore() {
        return window.SocialCore || null;
    }

    function getSocialQueries() {
        return window.SocialQueries || null;
    }

    function getNotificationSystem() {
        return window.NotificationSystem || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

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
                '[AcademyInstructorCommitments] deepClone returned ' +
                'the original reference.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function generateId() {
        return IdUtils.generateId('commit');
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

    function parseDayStrict(day) {
        var parsed = CalendarValidation.parseDay(day);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_DAY || parsed > MAX_DAY) {
            return null;
        }
        return parsed;
    }

    function parseHourStrict(hour) {
        var parsed = CalendarValidation.parseHour(hour);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_HOUR || parsed > MAX_HOUR) {
            return null;
        }
        return parsed;
    }

    function parseDurationStrict(duration) {
        var parsed = CalendarValidation.parseDuration(duration);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_DURATION || parsed > MAX_DURATION) {
            return null;
        }
        return parsed;
    }

    function normaliseLabel(raw) {
        if (raw === undefined || raw === null) {
            return '';
        }
        var s = String(raw).trim();
        if (s === '') {
            return '';
        }
        if (s.length > LABEL_MAX_LENGTH) {
            s = s.slice(0, LABEL_MAX_LENGTH);
        }
        return s;
    }

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            try {
                NS.notify(message, type || 'info');
            } catch (e) {
                // Never propagate from a notify.
            }
        }
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy ||
            typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.instructorCommitments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.instructorCommitments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function ensureStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.instructorCommitments ||
            typeof appData.academy.instructorCommitments !== 'object' ||
            Array.isArray(appData.academy.instructorCommitments)) {
            appData.academy.instructorCommitments = {};
        }
        return appData.academy.instructorCommitments;
    }

    function getRecordInternal(commitmentId) {
        if (!isNonEmptyString(commitmentId)) {
            return null;
        }
        var store = getStore();
        if (!store) {
            return null;
        }
        var record = store[String(commitmentId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    function getAllRecordsInternal() {
        var store = getStore();
        if (!store) {
            return [];
        }
        var result = [];
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var record = store[keys[i]];
            if (isPlainObject(record)) {
                result.push(record);
            }
        }
        return result;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate a commitment payload.
     *
     * The payload is either a full candidate (create) or a partial
     * set of fields (update). The `isPartial` flag switches the
     * "required fields" checks.
     *
     * @param {object} payload
     * @param {boolean} isPartial
     * @returns {{ valid: boolean, message?: string, normalised?: object }}
     */
    function validateCommitmentPayload(payload, isPartial) {
        if (!isPlainObject(payload)) {
            return {
                valid: false,
                message: 'Commitment payload must be an object.'
            };
        }

        var normalised = {};

        // ---- classId ----
        if (!isPartial || payload.classId !== undefined) {
            if (!isNonEmptyString(payload.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
            var cls = AcademyClasses.getClass(payload.classId);
            if (!cls) {
                return { valid: false, message: 'Class not found.' };
            }
            normalised.classId = String(payload.classId);
        }

        // ---- instructorId ----
        if (!isPartial || payload.instructorId !== undefined) {
            if (!isNonEmptyString(payload.instructorId)) {
                return {
                    valid: false,
                    message: 'Instructor ID is required.'
                };
            }
            var instructor = CharacterQueries.getCharacterById(
                payload.instructorId
            );
            if (!instructor) {
                return {
                    valid: false,
                    message: 'Instructor not found.'
                };
            }
            normalised.instructorId = String(payload.instructorId);
        }

        // ---- kind ----
        if (!isPartial || payload.kind !== undefined) {
            if (!isNonEmptyString(payload.kind)) {
                return {
                    valid: false,
                    message: 'Kind is required.'
                };
            }
            var kind = String(payload.kind);
            if (VALID_KINDS.indexOf(kind) === -1) {
                return {
                    valid: false,
                    message: 'Kind must be one of: ' +
                        VALID_KINDS.join(', ') + '.'
                };
            }
            normalised.kind = kind;
        }

        // ---- day ----
        if (!isPartial || payload.day !== undefined) {
            var day = parseDayStrict(payload.day);
            if (day === null) {
                return {
                    valid: false,
                    message: 'Day must be between ' +
                        MIN_DAY + ' and ' + MAX_DAY + '.'
                };
            }
            normalised.day = day;
        }

        // ---- startTime ----
        if (!isPartial || payload.startTime !== undefined) {
            var startTime = parseHourStrict(payload.startTime);
            if (startTime === null) {
                return {
                    valid: false,
                    message: 'Start time must be between ' +
                        MIN_HOUR + ' and ' + MAX_HOUR + '.'
                };
            }
            normalised.startTime = startTime;
        }

        // ---- duration ----
        if (!isPartial || payload.duration !== undefined) {
            var duration = parseDurationStrict(payload.duration);
            if (duration === null) {
                return {
                    valid: false,
                    message: 'Duration must be between ' +
                        MIN_DURATION + ' and ' + MAX_DURATION + ' hours.'
                };
            }
            normalised.duration = duration;
        }

        // ---- end of day check ----
        //
        // Only run when both are present in the same payload. A
        // partial update that only changes `duration` re-checks the
        // combination against the existing record in the pipeline
        // mutate() callback.
        if (normalised.startTime !== undefined &&
            normalised.duration !== undefined) {
            if (normalised.startTime + normalised.duration >
                CALENDAR_END_HOUR + 1) {
                return {
                    valid: false,
                    message: 'Commitment extends beyond the end of ' +
                        'the day.'
                };
            }
        }

        // ---- startWeek ----
        if (!isPartial || payload.startWeek !== undefined) {
            var startWeek = parseWeekStrict(payload.startWeek);
            if (startWeek === null) {
                return {
                    valid: false,
                    message: 'Start week must be between ' +
                        MIN_WEEK + ' and ' + MAX_WEEK + '.'
                };
            }
            normalised.startWeek = startWeek;
        }

        // ---- endWeek ----
        if (payload.endWeek !== undefined) {
            if (payload.endWeek === null ||
                payload.endWeek === '') {
                normalised.endWeek = null;
            } else {
                var endWeek = parseWeekStrict(payload.endWeek);
                if (endWeek === null) {
                    return {
                        valid: false,
                        message: 'End week must be null or between ' +
                            MIN_WEEK + ' and ' + MAX_WEEK + '.'
                    };
                }
                normalised.endWeek = endWeek;
            }
        } else if (!isPartial) {
            normalised.endWeek = null;
        }

        // ---- endWeek >= startWeek ----
        if (normalised.startWeek !== undefined &&
            normalised.endWeek !== undefined &&
            normalised.endWeek !== null &&
            normalised.endWeek < normalised.startWeek) {
            return {
                valid: false,
                message: 'End week cannot be before start week.'
            };
        }

        // ---- locationId ----
        if (payload.locationId !== undefined) {
            if (payload.locationId === null ||
                payload.locationId === '') {
                normalised.locationId = null;
            } else {
                if (!isNonEmptyString(payload.locationId)) {
                    return {
                        valid: false,
                        message: 'Location ID must be a non-empty string.'
                    };
                }
                var AL = getAcademyLocations();
                if (AL && typeof AL.getLocation === 'function') {
                    var loc = null;
                    try {
                        loc = AL.getLocation(payload.locationId);
                    } catch (e) {
                        loc = null;
                    }
                    if (!loc) {
                        return {
                            valid: false,
                            message: 'Location not found.'
                        };
                    }
                }
                normalised.locationId = String(payload.locationId);
            }
        } else if (!isPartial) {
            normalised.locationId = null;
        }

        // ---- characterId ----
        //
        // Only meaningful for tutoring. Rejected on office hours at
        // write time, not silently dropped. See the module header.
        if (payload.characterId !== undefined) {
            if (payload.characterId === null ||
                payload.characterId === '') {
                normalised.characterId = null;
            } else {
                if (!isNonEmptyString(payload.characterId)) {
                    return {
                        valid: false,
                        message: 'Character ID must be a non-empty string.'
                    };
                }

                // Refuse characterId on office hours.
                var effectiveKind = normalised.kind !== undefined
                    ? normalised.kind
                    : (payload.kind !== undefined ? String(payload.kind) : null);

                if (effectiveKind === KIND_OFFICE_HOURS) {
                    return {
                        valid: false,
                        message: 'Office hours do not take a character.'
                    };
                }

                var char = CharacterQueries.getCharacterById(
                    payload.characterId
                );
                if (!char) {
                    return {
                        valid: false,
                        message: 'Character not found.'
                    };
                }

                normalised.characterId = String(payload.characterId);
            }
        } else if (!isPartial) {
            normalised.characterId = null;
        }

        // ---- label ----
        if (payload.label !== undefined) {
            normalised.label = normaliseLabel(payload.label);
        } else if (!isPartial) {
            normalised.label = '';
        }

        return { valid: true, normalised: normalised };
    }

    /**
     * Validate a completed candidate record before commit.
     * This is the final gate; it re-checks the cross-field
     * invariants the partial validator cannot check in isolation.
     *
     * @param {object} candidate
     * @returns {{ valid: boolean, message?: string }}
     */
    function validateCandidate(candidate) {
        if (!isPlainObject(candidate)) {
            return { valid: false, message: 'Candidate is not an object.' };
        }

        if (!isNonEmptyString(candidate.classId)) {
            return { valid: false, message: 'Candidate missing classId.' };
        }
        if (!isNonEmptyString(candidate.instructorId)) {
            return { valid: false, message: 'Candidate missing instructorId.' };
        }
        if (VALID_KINDS.indexOf(candidate.kind) === -1) {
            return { valid: false, message: 'Candidate kind is invalid.' };
        }

        var day = parseDayStrict(candidate.day);
        if (day === null) {
            return { valid: false, message: 'Candidate day is invalid.' };
        }

        var startTime = parseHourStrict(candidate.startTime);
        if (startTime === null) {
            return { valid: false, message: 'Candidate start time is invalid.' };
        }

        var duration = parseDurationStrict(candidate.duration);
        if (duration === null) {
            return { valid: false, message: 'Candidate duration is invalid.' };
        }

        if (startTime + duration > CALENDAR_END_HOUR + 1) {
            return {
                valid: false,
                message: 'Candidate extends beyond the end of the day.'
            };
        }

        var startWeek = parseWeekStrict(candidate.startWeek);
        if (startWeek === null) {
            return { valid: false, message: 'Candidate startWeek is invalid.' };
        }

        if (candidate.endWeek !== null &&
            candidate.endWeek !== undefined) {
            var endWeek = parseWeekStrict(candidate.endWeek);
            if (endWeek === null) {
                return {
                    valid: false,
                    message: 'Candidate endWeek is invalid.'
                };
            }
            if (endWeek < startWeek) {
                return {
                    valid: false,
                    message: 'Candidate endWeek is before startWeek.'
                };
            }
        }

        if (candidate.kind === KIND_OFFICE_HOURS &&
            candidate.characterId !== null &&
            candidate.characterId !== undefined &&
            candidate.characterId !== '') {
            return {
                valid: false,
                message: 'Office hours do not take a character.'
            };
        }

        return { valid: true };
    }

    // ============================================================
    // CANDIDATE BUILDER
    // ============================================================

    function buildCommitmentRecord(normalised) {
        var now = new Date().toISOString();
        return {
            id: generateId(),
            classId: normalised.classId,
            instructorId: normalised.instructorId,
            kind: normalised.kind,
            day: normalised.day,
            startTime: normalised.startTime,
            duration: normalised.duration,
            locationId: normalised.locationId === undefined
                ? null : normalised.locationId,
            characterId: normalised.characterId === undefined
                ? null : normalised.characterId,
            label: normalised.label === undefined
                ? '' : normalised.label,
            startWeek: normalised.startWeek,
            endWeek: normalised.endWeek === undefined
                ? null : normalised.endWeek,
            createdAt: now,
            updatedAt: now
        };
    }

    // ============================================================
    // MENTOR RELATIONSHIP HOOK
    // ============================================================
    //
    // Called AFTER the commitment pipeline commits. Checks for an
    // existing forward-direction mentor relationship from the
    // instructor to the character. If none exists, creates one.
    //
    // Failure of this hook does not roll back the commitment. The
    // user sees a warning and can retry from the Social tab.

    function ensureMentorRelationship(instructorId, characterId) {
        if (!isNonEmptyString(instructorId) ||
            !isNonEmptyString(characterId)) {
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'invalid-input'
            });
        }

        if (instructorId === characterId) {
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'self-reference'
            });
        }

        var SQ = getSocialQueries();
        if (!SQ || typeof SQ.relationshipExists !== 'function') {
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'queries-unavailable'
            });
        }

        var SC = getSocialCore();
        if (!SC || typeof SC.createRelationship !== 'function') {
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'core-unavailable'
            });
        }

        var alreadyExists = false;
        try {
            alreadyExists = SQ.relationshipExists(
                instructorId,
                characterId,
                MENTOR_TYPE_ID
            ) === true;
        } catch (e) {
            console.warn(
                '[AcademyInstructorCommitments] ' +
                'relationshipExists threw:', e
            );
            alreadyExists = false;
        }

        if (alreadyExists) {
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'already-exists'
            });
        }

        return SC.createRelationship(
            instructorId,
            characterId,
            MENTOR_TYPE_ID,
            '',    // startYear
            '',    // endYear
            '',    // clarification
            ''     // notes
        ).then(function (result) {
            if (result && result.success) {
                return {
                    attempted: true,
                    created: true,
                    reason: null
                };
            }
            return {
                attempted: true,
                created: false,
                reason: (result && result.message) || 'create-failed',
                failureMessage: result && result.message
            };
        }).catch(function (err) {
            return {
                attempted: true,
                created: false,
                reason: String(err && err.message || err)
            };
        });
    }

    /**
     * Apply the mentor-relationship hook to a commitment result.
     *
     * Called from the .then() of a successful commitment write
     * when the commitment is a tutoring session with a character.
     * On failure, notifies the user without rolling back.
     *
     * @param {object} commitment
     * @returns {Promise<void>}
     */
    function applyMentorHook(commitment) {
        if (!commitment) { return Promise.resolve(); }
        if (commitment.kind !== KIND_TUTORING) {
            return Promise.resolve();
        }
        if (!isNonEmptyString(commitment.characterId)) {
            return Promise.resolve();
        }

        return ensureMentorRelationship(
            commitment.instructorId,
            commitment.characterId
        ).then(function (hook) {
            if (hook.attempted && !hook.created) {
                notify(
                    'Tutoring block saved. The mentor relationship ' +
                    'could not be saved: ' +
                    (hook.reason || 'unknown error') +
                    '. Retry from the Social tab if needed.',
                    'warning'
                );
            }
            return hook;
        });
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    function createCommitment(payload) {
        var validation = validateCommitmentPayload(payload, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var normalised = validation.normalised;
        var candidate = buildCommitmentRecord(normalised);

        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        var targetId = candidate.id;

        return MutationPipeline.performMutation({
            validate: function (appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (getStoreFromSnapshot(appData) &&
                    getStoreFromSnapshot(appData)[targetId]) {
                    return {
                        valid: false,
                        message: 'Commitment ID collision.'
                    };
                }
                return { valid: true };
            },
            mutate: function (appData) {
                var store = ensureStore(appData);
                store[targetId] = deepClone(candidate);
                return { commitment: candidate, commitmentId: targetId };
            },
            logMessage: 'Created instructor commitment: ' +
                candidate.kind + ' for ' + candidate.instructorId,
            successMessage: candidate.kind === KIND_OFFICE_HOURS
                ? 'Office hours saved.'
                : 'Tutoring block saved.',
            failureMessage: 'Failed to save the commitment.'
        }).then(function (result) {
            if (!result || !result.success) {
                return result;
            }
            return applyMentorHook(candidate).then(function () {
                return result;
            });
        });
    }

    function updateCommitment(commitmentId, updates) {
        if (!isNonEmptyString(commitmentId)) {
            return Promise.resolve(failure('Commitment ID is required.'));
        }
        if (!isPlainObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        var existing = getRecordInternal(commitmentId);
        if (!existing) {
            return Promise.resolve(failure('Commitment not found.'));
        }

        var validation = validateCommitmentPayload(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var normalised = validation.normalised;
        var candidate = deepClone(existing);

        var fieldNames = [
            'classId', 'instructorId', 'kind', 'day', 'startTime',
            'duration', 'locationId', 'characterId', 'label',
            'startWeek', 'endWeek'
        ];
        for (var i = 0; i < fieldNames.length; i++) {
            var f = fieldNames[i];
            if (normalised[f] !== undefined) {
                candidate[f] = normalised[f];
            }
        }

        // Re-validate the combination.
        if (candidate.startTime + candidate.duration >
            CALENDAR_END_HOUR + 1) {
            return Promise.resolve(failure(
                'Commitment extends beyond the end of the day.'
            ));
        }
        if (candidate.endWeek !== null &&
            candidate.endWeek < candidate.startWeek) {
            return Promise.resolve(failure(
                'End week cannot be before start week.'
            ));
        }
        if (candidate.kind === KIND_OFFICE_HOURS &&
            isNonEmptyString(candidate.characterId)) {
            return Promise.resolve(failure(
                'Office hours do not take a character.'
            ));
        }

        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(commitmentId);

        return MutationPipeline.performMutation({
            validate: function (appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    return {
                        valid: false,
                        message: 'Commitment no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function (appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    throw new Error('Commitment not found in store.');
                }
                store[targetId] = deepClone(candidate);
                return { commitment: candidate };
            },
            logMessage: 'Updated instructor commitment ' + targetId,
            successMessage: 'Commitment updated.',
            failureMessage: 'Failed to update the commitment.'
        }).then(function (result) {
            if (!result || !result.success) {
                return result;
            }
            return applyMentorHook(candidate).then(function () {
                return result;
            });
        });
    }

    function removeCommitment(commitmentId) {
        if (!isNonEmptyString(commitmentId)) {
            return Promise.resolve(failure('Commitment ID is required.'));
        }

        var existing = getRecordInternal(commitmentId);
        if (!existing) {
            return Promise.resolve(failure('Commitment not found.'));
        }

        var targetId = String(commitmentId);

        return MutationPipeline.performMutation({
            validate: function (appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    return {
                        valid: false,
                        message: 'Commitment no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function (appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    throw new Error('Commitment not found in store.');
                }
                var removed = store[targetId];
                delete store[targetId];
                return { commitment: removed };
            },
            logMessage: 'Removed instructor commitment ' + targetId,
            successMessage: 'Commitment removed.',
            failureMessage: 'Failed to remove the commitment.'
        });
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getCommitment(commitmentId) {
        var record = getRecordInternal(commitmentId);
        return record ? deepClone(record) : null;
    }

    function getCommitmentsForInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }
        var target = String(instructorId);
        var records = getAllRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].instructorId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    function getCommitmentsForClass(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var target = String(classId);
        var records = getAllRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].classId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    /**
     * Every commitment the instructor owns for the class that is
     * active at the given week.
     *
     * Week-in-range delegates to RangeUtils.containsWeek.
     */
    function getActiveCommitmentsForInstructor(
        instructorId,
        week
    ) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var target = String(instructorId);
        var records = getAllRecordsInternal();
        var result = [];

        for (var i = 0; i < records.length; i++) {
            var c = records[i];
            if (String(c.instructorId) !== target) {
                continue;
            }
            if (!RangeUtils.containsWeek(
                weekNum, c.startWeek, c.endWeek
            )) {
                continue;
            }
            result.push(deepClone(c));
        }

        return result;
    }

    function getActiveCommitmentsForClass(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var target = String(classId);
        var records = getAllRecordsInternal();
        var result = [];

        for (var i = 0; i < records.length; i++) {
            var c = records[i];
            if (String(c.classId) !== target) {
                continue;
            }
            if (!RangeUtils.containsWeek(
                weekNum, c.startWeek, c.endWeek
            )) {
                continue;
            }
            result.push(deepClone(c));
        }

        return result;
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================
    //
    // Pure with respect to appData. Mutate the snapshot. Never
    // touch window.data. Never throw. Run inside another module's
    // pipeline transaction (AcademyCascade).

    function stripClassRefs(appData, classId) {
        var result = { commitmentsRemoved: 0 };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(classId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var c = store[keys[i]];
            if (!isPlainObject(c)) {
                continue;
            }
            if (String(c.classId) === target) {
                delete store[keys[i]];
                result.commitmentsRemoved++;
            }
        }

        return result;
    }

    /**
     * Strip references to a character.
     *
     * Two distinct roles:
     *
     *   The character is the INSTRUCTOR of the commitment. The
     *   commitment was their time; it is deleted. Counted under
     *   `commitmentsRemoved`.
     *
     *   The character is the SUBJECT of a tutoring commitment
     *   (characterId). The commitment is not theirs; only the
     *   reference is cleared. Counted under `referencesCleared`.
     *
     * A single call can do both, if the deleted character happened
     * to be both the instructor and the subject of the same
     * commitment. That cannot happen in practice — a commitment
     * cannot have instructorId === characterId because the
     * validator rejects self-reference on the mentor hook, and the
     * domain layer permits it structurally only when a caller
     * deliberately constructs it. The code handles it anyway.
     */
    function stripCharacterRefs(appData, characterId) {
        var result = {
            commitmentsRemoved: 0,
            referencesCleared: 0
        };

        if (!appData || !isNonEmptyString(characterId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(characterId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var c = store[key];
            if (!isPlainObject(c)) {
                continue;
            }

            var isInstructor = String(c.instructorId) === target;
            var isSubject = isNonEmptyString(c.characterId) &&
                            String(c.characterId) === target;

            if (isInstructor) {
                delete store[key];
                result.commitmentsRemoved++;
                continue;
            }

            if (isSubject) {
                c.characterId = null;
                c.updatedAt = new Date().toISOString();
                result.referencesCleared++;
            }
        }

        return result;
    }

    /**
     * Delete every commitment owned by the instructor, regardless
     * of class. Used when an instructor record is deleted outright.
     * Same effect as stripCharacterRefs for the instructor role;
     * provided for callers that want the intent explicit.
     */
    function stripInstructorRefs(appData, instructorId) {
        var result = { commitmentsRemoved: 0 };

        if (!appData || !isNonEmptyString(instructorId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(instructorId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var c = store[keys[i]];
            if (!isPlainObject(c)) {
                continue;
            }
            if (String(c.instructorId) === target) {
                delete store[keys[i]];
                result.commitmentsRemoved++;
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyInstructorCommitments = Object.freeze({
        // Mutations
        createCommitment: createCommitment,
        updateCommitment: updateCommitment,
        removeCommitment: removeCommitment,

        // Reads
        getCommitment: getCommitment,
        getCommitmentsForInstructor: getCommitmentsForInstructor,
        getCommitmentsForClass: getCommitmentsForClass,
        getActiveCommitmentsForInstructor:
            getActiveCommitmentsForInstructor,
        getActiveCommitmentsForClass:
            getActiveCommitmentsForClass,

        // Cascade helpers
        stripClassRefs: stripClassRefs,
        stripCharacterRefs: stripCharacterRefs,
        stripInstructorRefs: stripInstructorRefs,

        // Constants (read-only)
        KIND_OFFICE_HOURS: KIND_OFFICE_HOURS,
        KIND_TUTORING: KIND_TUTORING,
        VALID_KINDS: VALID_KINDS,
        MENTOR_TYPE_ID: MENTOR_TYPE_ID,
        LABEL_MAX_LENGTH: LABEL_MAX_LENGTH
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyInstructorCommitments;
        var missing = [];

        var required = [
            'createCommitment',
            'updateCommitment',
            'removeCommitment',
            'getCommitment',
            'getCommitmentsForInstructor',
            'getCommitmentsForClass',
            'getActiveCommitmentsForInstructor',
            'getActiveCommitmentsForClass',
            'stripClassRefs',
            'stripCharacterRefs',
            'stripInstructorRefs'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyInstructorCommitments] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
