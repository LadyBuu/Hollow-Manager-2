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
 * CLASSID SEMANTICS:
 *   classId identifies the ACADEMY CONTEXT in which the commitment
 *   is recorded. It does NOT make the commitment subject to the
 *   class's teaching schedule or rest-day rules.
 *
 *   A commitment is the instructor's own time. It is independent
 *   of any class's calendar. The class's rest days do not suppress
 *   it. The class's teaching sessions do not displace it.
 *
 *   classId exists so that a commitment can be listed, filtered,
 *   and cascaded by class. When a class is deleted, its
 *   commitments are deleted with it (the class is the context;
 *   without the context, the record is orphaned). This is the
 *   only sense in which classId is used.
 *
 * KIND DISCRIMINATION:
 *   The two kinds share every field except `characterId`.
 *   `characterId` is only accepted when kind is 'tutoring'. A
 *   caller that tries to set it on an office hour gets a
 *   rejection, not a silent drop.
 *
 *   Canonical invariant:
 *     officeHours  → characterId === null
 *     tutoring     → characterId === null OR valid character ID
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Pipeline validate() callbacks resolve references against the
 *   `appData` argument they are handed. They do not read
 *   window.data. Preflight reads against window.data are for
 *   early UX feedback only; the pipeline re-checks against the
 *   snapshot.
 *
 *   Both create and update validate the CANDIDATE against the
 *   snapshot. This closes two failure modes:
 *     - a reference that was valid at preflight being invalidated
 *       by another mutation before commit
 *     - an update that preserves a reference which has already
 *       become stale in storage
 *
 * LOCATION DEPENDENCY:
 *   When a commitment sets a locationId, AcademyLocations is
 *   MANDATORY. A missing location provider, or a location that
 *   does not resolve, is a validation failure. There is no
 *   "foreign key valid only when the module happens to be
 *   loaded" path.
 *
 * LABEL:
 *   The label is bounded by LABEL_MAX_LENGTH. An overlong label
 *   is REJECTED, not silently truncated. Silent truncation hides
 *   user error; the caller must supply a label within bounds.
 *
 * MENTORING HOOK (tutoring only):
 *   When a tutoring commitment is created or updated with a
 *   characterId, the save sequence also ensures a mentor
 *   relationship exists between the instructor (as mentor) and
 *   the character (as mentee) in the Social domain.
 *
 *   The relationship create is a SEPARATE MUTATION PIPELINE,
 *   run after the commitment write commits. If it fails, the
 *   commitment stays.
 *
 *   The relationship check has THREE outcomes:
 *     exists            → no create attempted
 *     doesn't exist     → create attempted
 *     couldn't determine → no create attempted; the caller is
 *                          notified that the relationship could
 *                          not be verified. A failed read does not
 *                          silently become "assume absent."
 *
 * RANGE PREDICATES:
 *   Week-in-range questions in this module delegate to
 *   RangeUtils. This module does not reimplement range math.
 *
 * MUTATION CONTRACT:
 *   Every public mutation returns Promise<{ success, data?, message? }>.
 *   Every mutation routes through MutationPipeline.
 *   Every mutation is atomic on its OWN store.
 *
 * CASCADE HELPERS:
 *   stripClassRefs(appData, classId)
 *     Every commitment attached to the class is removed.
 *     Commitments are class-scoped.
 *
 *   stripCharacterRefs(appData, characterId)
 *     Two roles are handled in one pass:
 *       - the character as INSTRUCTOR: their commitments are
 *         deleted
 *       - the character as SUBJECT of a tutoring block: the
 *         commitment survives, characterId is nulled
 *
 *   stripInstructorRefs(appData, instructorId)
 *     Every commitment owned by the instructor is removed,
 *     regardless of class.
 *
 *     SEMANTIC DISTINCTION FROM stripCharacterRefs:
 *       stripCharacterRefs is "remove every relationship to this
 *       character." It handles the subject role too.
 *
 *       stripInstructorRefs is "remove commitments owned by this
 *       instructor." It is narrower: it does not touch the subject
 *       role. For a character deletion, stripCharacterRefs is the
 *       right call. stripInstructorRefs exists for callers that
 *       want to express "clear this instructor's schedule" without
 *       touching anyone else's references.
 *
 *   stripLocationRefs(appData, locationId)
 *     Nulls the locationId on every commitment that referenced
 *     the deleted location. The commitment survives. Symmetric
 *     with AcademyTeachingSessions.stripLocationRefs.
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
 *   - window.CharacterQueries
 *
 * DEPENDENCIES (LAZY, mandatory at call time when used):
 *   - window.AcademyLocations     (location existence; required
 *                                  when a locationId is set)
 *   - window.SocialCore           (mentor relationship create)
 *   - window.SocialQueries        (mentor relationship read)
 *   - window.NotificationSystem   (soft-failure notice)
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

    /**
     * Normalise a label WITHOUT truncation. A label longer than
     * LABEL_MAX_LENGTH is returned as-is; the validator rejects it.
     * Trimming whitespace is fine — that is normalisation, not
     * silent mutation of the caller's intent.
     */
    function normaliseLabel(raw) {
        if (raw === undefined || raw === null) {
            return '';
        }
        return String(raw).trim();
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
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================
    //
    // Used by the pipeline validate() callbacks. Read from the
    // appData snapshot, not window.data.

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    function findClassInSnapshot(appData, classId) {
        if (!appData || !appData.academy ||
            !isPlainObject(appData.academy.graduatingClasses)) {
            return null;
        }
        var target = String(classId);
        return appData.academy.graduatingClasses[target] || null;
    }

    function findCommitmentInSnapshot(appData, commitmentId) {
        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return null;
        }
        var record = store[String(commitmentId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    // ============================================================
    // PAYLOAD VALIDATION (user input)
    // ============================================================
    //
    // validateCommitmentPayload() is the USER-INPUT validator. It
    // checks the requested payload's shape and domain rules. It does
    // not check reference existence.
    //
    // Reference existence is validateCandidateAgainstSnapshot()'s
    // job, which runs inside the pipeline.

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
                normalised.locationId = String(payload.locationId);
            }
        } else if (!isPartial) {
            normalised.locationId = null;
        }

        // ---- characterId ----
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

                var effectiveKind = normalised.kind !== undefined
                    ? normalised.kind
                    : (payload.kind !== undefined ? String(payload.kind) : null);

                if (effectiveKind === KIND_OFFICE_HOURS) {
                    return {
                        valid: false,
                        message: 'Office hours do not take a character.'
                    };
                }

                normalised.characterId = String(payload.characterId);
            }
        } else if (!isPartial) {
            normalised.characterId = null;
        }

        // ---- label (reject overlong; no truncation) ----
        if (payload.label !== undefined) {
            var label = normaliseLabel(payload.label);
            if (label.length > LABEL_MAX_LENGTH) {
                return {
                    valid: false,
                    message: 'Label must be ' + LABEL_MAX_LENGTH +
                        ' characters or fewer.'
                };
            }
            normalised.label = label;
        } else if (!isPartial) {
            normalised.label = '';
        }

        return { valid: true, normalised: normalised };
    }

    // ============================================================
    // CANDIDATE VALIDATION (structural, complete record)
    // ============================================================
    //
    // validateCandidate() checks the COMPLETE candidate record's
    // structural and domain shape. It does not check reference
    // existence — that is the snapshot validator's job.
    //
    // Used by create and update after the candidate has been built
    // or restored from storage.

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

        // ---- locationId: null or non-empty string ----
        if (candidate.locationId !== null &&
            candidate.locationId !== undefined) {
            if (!isNonEmptyString(candidate.locationId)) {
                return {
                    valid: false,
                    message: 'Candidate locationId must be null or a ' +
                        'non-empty string.'
                };
            }
        }

        // ---- characterId: null or non-empty string; not on
        //      office hours ----
        if (candidate.characterId !== null &&
            candidate.characterId !== undefined) {
            if (!isNonEmptyString(candidate.characterId)) {
                return {
                    valid: false,
                    message: 'Candidate characterId must be null or a ' +
                        'non-empty string.'
                };
            }
            if (candidate.kind === KIND_OFFICE_HOURS) {
                return {
                    valid: false,
                    message: 'Office hours do not take a character.'
                };
            }
        }

        // ---- label length ----
        if (candidate.label !== undefined && candidate.label !== null) {
            if (typeof candidate.label !== 'string') {
                return {
                    valid: false,
                    message: 'Candidate label must be a string.'
                };
            }
            if (candidate.label.length > LABEL_MAX_LENGTH) {
                return {
                    valid: false,
                    message: 'Candidate label must be ' +
                        LABEL_MAX_LENGTH + ' characters or fewer.'
                };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // SNAPSHOT VALIDATION (reference existence)
    // ============================================================
    //
    // validateCandidateAgainstSnapshot() checks that every foreign
    // reference on the candidate resolves in the transaction
    // snapshot. It runs inside the pipeline validator.
    //
    // Location is MANDATORY when set: a missing AcademyLocations
    // provider is a failure, not a silent pass.
    //
    // A commitment ID collision check is NOT part of this
    // function; the caller owns that (create only).

    function validateCandidateAgainstSnapshot(candidate, appData) {
        // ---- classId ----
        if (!findClassInSnapshot(appData, candidate.classId)) {
            return {
                valid: false,
                message: 'Class no longer exists: ' + candidate.classId
            };
        }

        // ---- instructorId ----
        if (!findCharacterInSnapshot(appData, candidate.instructorId)) {
            return {
                valid: false,
                message: 'Instructor no longer exists: ' +
                    candidate.instructorId
            };
        }

        // ---- characterId (tutoring only) ----
        if (isNonEmptyString(candidate.characterId)) {
            if (!findCharacterInSnapshot(appData, candidate.characterId)) {
                return {
                    valid: false,
                    message: 'Character no longer exists: ' +
                        candidate.characterId
                };
            }
        }

        // ---- locationId ----
        if (isNonEmptyString(candidate.locationId)) {
            var AL = getAcademyLocations();
            if (!AL || typeof AL.getLocation !== 'function') {
                return {
                    valid: false,
                    message: 'AcademyLocations is required to validate ' +
                        'a commitment location. Check the script load ' +
                        'order in index.html.'
                };
            }
            var loc = AL.getLocation(candidate.locationId);
            if (!loc) {
                return {
                    valid: false,
                    message: 'Location not found: ' + candidate.locationId
                };
            }
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
    // Three-state read:
    //   exists             → no create attempted
    //   doesn't exist      → create attempted
    //   couldn't determine → no create attempted; soft-failure
    //                        is reported to the user

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

        // ---- Read the current state. Three outcomes. ----
        var exists;
        try {
            exists = SQ.relationshipExists(
                instructorId,
                characterId,
                MENTOR_TYPE_ID
            ) === true;
        } catch (e) {
            console.warn(
                '[AcademyInstructorCommitments] ' +
                'relationshipExists threw; the mentor relationship ' +
                'could not be verified. Not attempting a create.',
                e
            );
            return Promise.resolve({
                attempted: false,
                created: false,
                reason: 'check-failed'
            });
        }

        if (exists) {
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
            '',
            '',
            '',
            ''
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
            if (!hook.attempted && hook.reason === 'check-failed') {
                notify(
                    'Tutoring block saved. The mentor relationship ' +
                    'could not be verified; no attempt was made to ' +
                    'create it. Check the Social tab and add the ' +
                    'relationship manually if needed.',
                    'warning'
                );
                return hook;
            }

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

        // Preflight reference check (UX). The pipeline re-checks
        // against the snapshot.
        var preflight = validateCandidateAgainstSnapshot(
            candidate, getDataStore()
        );
        if (!preflight.valid) {
            return Promise.resolve(failure(preflight.message));
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

                // ID collision against the snapshot.
                if (findCommitmentInSnapshot(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Commitment ID collision.'
                    };
                }

                // Reference existence against the snapshot. This
                // is the authoritative check.
                var snapCheck = validateCandidateAgainstSnapshot(
                    candidate, appData
                );
                if (!snapCheck.valid) {
                    return {
                        valid: false,
                        message: snapCheck.message
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

        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        // Preflight reference check (UX).
        var preflight = validateCandidateAgainstSnapshot(
            candidate, getDataStore()
        );
        if (!preflight.valid) {
            return Promise.resolve(failure(preflight.message));
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

                // The commitment must still exist.
                if (!findCommitmentInSnapshot(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Commitment no longer exists.'
                    };
                }

                // Reference existence against the snapshot. This is
                // the authoritative check. An update that would
                // preserve a stale classId / instructorId /
                // characterId / locationId fails here.
                var snapCheck = validateCandidateAgainstSnapshot(
                    candidate, appData
                );
                if (!snapCheck.valid) {
                    return {
                        valid: false,
                        message: snapCheck.message
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
                if (!findCommitmentInSnapshot(appData, targetId)) {
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
     * Every commitment OWNED by the instructor is removed.
     *
     * SEMANTIC DISTINCTION:
     *   stripCharacterRefs removes every relationship to the
     *   character, including the tutoring-subject role.
     *
     *   stripInstructorRefs removes only what the instructor owns.
     *   It does not clear the subject role of any other
     *   instructor's tutoring block.
     *
     * For a character deletion, stripCharacterRefs is the correct
     * call. stripInstructorRefs exists for callers that want to
     * express "clear this instructor's schedule" without touching
     * anyone else's references.
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

    /**
     * Null the locationId on every commitment that references the
     * deleted location.
     *
     * The commitment survives. The room was a property of the
     * block, not its identity.
     *
     * Symmetric with AcademyTeachingSessions.stripLocationRefs.
     */
    function stripLocationRefs(appData, locationId) {
        var result = { referencesCleared: 0 };

        if (!appData || !isNonEmptyString(locationId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(locationId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var c = store[keys[i]];
            if (!isPlainObject(c)) {
                continue;
            }
            if (!isNonEmptyString(c.locationId)) {
                continue;
            }
            if (String(c.locationId) !== target) {
                continue;
            }
            c.locationId = null;
            c.updatedAt = new Date().toISOString();
            result.referencesCleared++;
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
        stripLocationRefs: stripLocationRefs,

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
            'stripInstructorRefs',
            'stripLocationRefs'
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
