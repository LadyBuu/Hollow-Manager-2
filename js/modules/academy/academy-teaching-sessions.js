/**
 * modules/academy/academy-teaching-sessions.js - Academy Teaching Sessions
 * SINGLE SOURCE OF TRUTH for recurring teaching meetings.
 *
 * Path: js/modules/academy/academy-teaching-sessions.js
 *
 * WHAT THIS MODULE OWNS:
 *   A teaching session: a recurring meeting of a teaching group at a
 *   fixed day, time, duration, and location.
 *
 *     academy.teachingSessions[sessionId] = {
 *       id,
 *       groupId,
 *       day,             // 1-7 (Monday=1)
 *       startTime,       // hour (0-23) at which the session starts
 *       duration,        // hours
 *       locationId,      // null = no location
 *       startWeek,       // when the session begins
 *       endWeek,         // null = ongoing; endWeek INCLUSIVE
 *       createdAt,
 *       updatedAt
 *     }
 *
 * SESSIONS HAVE NO ROSTER:
 *   A session does not carry studentIds. Membership lives on the
 *   group. A session's effective roster is the group's roster,
 *   filtered by the group's own window, the session's own window,
 *   and the class-discipline's window. The projector does that
 *   intersection; this module never touches rosters.
 *
 * GROUPID IS IMMUTABLE AFTER CREATION:
 *   A session belongs to exactly one group, chosen at creation. The
 *   update surface does not accept groupId. Moving a session to
 *   another group is a remove-and-recreate operation, because the
 *   membership semantics of the two groups may not be compatible.
 *
 * LOCATION IS A HINT, NOT A VALIDATED REFERENCE:
 *   locationId is stored as a free identifier. This module does NOT
 *   validate that the referenced location exists. Rationale: a
 *   session is a recurring timetable slot, and a slot may be created
 *   before a room is assigned or after a room is decommissioned. The
 *   location is a property of the slot, not a foreign key that gates
 *   the slot's existence.
 *
 *   Contrast with AcademyInstructorCommitments, which DOES validate
 *   the location reference. Commitments are the instructor's own
 *   time; the location there is chosen deliberately at creation. Two
 *   use cases, two policies.
 *
 *   When a location is deleted, AcademyCascade.locationDeleted calls
 *   stripLocationRefs, which nulls the reference on every session
 *   that carried it. The session survives.
 *
 * HISTORICAL-RECORD PRINCIPLE:
 *   A session is a historical fact. Ending a session sets its
 *   endWeek; it does NOT delete the record. Deleting a session
 *   outright is reserved for administrative cleanup and for cascade
 *   deletes (group delete, class delete, discipline delete).
 *
 * CALENDAR END BOUNDARY:
 *   CALENDAR_END_HOUR is the last hour that may be OCCUPIED. A
 *   session that starts at CALENDAR_END_HOUR with duration 1 occupies
 *   [CALENDAR_END_HOUR, CALENDAR_END_HOUR + 1), which is valid. The
 *   exclusive end of the calendar day is therefore
 *   CALENDAR_END_HOUR + 1, exposed here as CALENDAR_END_TIME.
 *
 *   The rule reads: `startTime + duration <= CALENDAR_END_TIME`.
 *
 *   The same derived constant appears in academy-session-form-modal.js
 *   and academy-instructor-commitments.js. Until a canonical
 *   CalendarConstants.isValidTimeWindow() helper exists, each file
 *   carries the local constant with this same comment. Do not
 *   change the arithmetic in one file without changing it in all
 *   three.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the appData argument it is handed. It does not read window.data.
 *   Preflight reads against window.data are for early UX feedback
 *   only; the pipeline re-checks against the snapshot.
 *
 *   This applies to:
 *     - create: the group exists in the snapshot, no ID collision,
 *       no overlap in the snapshot
 *     - update: the session exists in the snapshot, the candidate
 *       satisfies all constraints, no overlap in the snapshot
 *     - end: the session exists in the snapshot
 *     - remove: the session exists in the snapshot
 *
 * RANGE PREDICATES:
 *   - `sessionActiveInWeek` delegates to RangeUtils.containsWeek.
 *   - `sessionsOverlap` combines a local TIME overlap with a
 *     RangeUtils.weeksOverlap call for the week ranges.
 *
 * CASCADE HELPERS:
 *   stripGroupRefs(appData, groupId)          remove every session
 *                                              of a group
 *   stripLocationRefs(appData, locationId)    null the locationId
 *                                              on every session that
 *                                              referenced it
 *   stripClassRefs(appData, classId)          remove every session of
 *                                              every group in a class
 *   stripDisciplineRefs(appData, disciplineId)
 *                                              remove every session of
 *                                              every group whose
 *                                              disciplineId matches
 *
 *   stripDisciplineRefs resolves the discipline's groups internally,
 *   via the group store on the same appData snapshot. Callers do not
 *   need to enumerate groups. This is the discipline→group→session
 *   knowledge living where it belongs.
 *
 *   CASCADE STRICTNESS:
 *     The class and discipline strips require the group store to be
 *     present on the snapshot. A missing or malformed group store is
 *     a data-integrity failure during a destructive cascade; the
 *     helper throws rather than silently reporting zero sessions
 *     removed. The group strip does not require the store (it filters
 *     sessions directly by groupId), and the location strip does not
 *     require any store.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.RangeUtils
 *   - window.MutationPipeline
 *   - window.AcademyTeachingGroups
 *   - window.IdUtils
 *
 * USAGE:
 *   AcademyTeachingSessions.createSession({...}).then(...);
 *   AcademyTeachingSessions.updateSession(id, {...}).then(...);
 *   AcademyTeachingSessions.endSession(id, week).then(...);
 */

(function() {
    'use strict';

    if (window.__academyTeachingSessionsLoaded) {
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
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var IdUtils = window.IdUtils;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils ||
        typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseDay !== 'function') {
        _missing.push('CalendarValidation.parseDay');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseHour !== 'function') {
        _missing.push('CalendarValidation.parseHour');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseDuration !== 'function') {
        _missing.push('CalendarValidation.parseDuration');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!RangeUtils || typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!RangeUtils || typeof RangeUtils.weeksOverlap !== 'function') {
        _missing.push('RangeUtils.weeksOverlap');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingSessions] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingSessionsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_CLASS_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // CALENDAR_END_HOUR is the last hour that may be occupied. A
    // session that starts at that hour with duration 1 occupies
    // [CALENDAR_END_HOUR, CALENDAR_END_HOUR + 1), which is valid.
    // The exclusive end of the calendar day is therefore
    // CALENDAR_END_HOUR + 1.
    //
    // The same derived constant appears in
    // academy-session-form-modal.js and
    // academy-instructor-commitments.js. Do not change the
    // arithmetic here without changing it there.
    var CALENDAR_END_TIME = CalendarConstants.CALENDAR_END_HOUR + 1;

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
                '[AcademyTeachingSessions] deepClone aliased the input.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) return null;
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) return null;
        return parsed;
    }

    function parseDayStrict(day) {
        var parsed = CalendarValidation.parseDay(day);
        if (parsed === null) return null;
        if (parsed < MIN_DAY || parsed > MAX_DAY) return null;
        return parsed;
    }

    function parseHourStrict(hour) {
        var parsed = CalendarValidation.parseHour(hour);
        if (parsed === null) return null;
        if (parsed < MIN_HOUR || parsed > MAX_HOUR) return null;
        return parsed;
    }

    function parseDurationStrict(duration) {
        var parsed = CalendarValidation.parseDuration(duration);
        if (parsed === null) return null;
        if (parsed < MIN_CLASS_DURATION || parsed > MAX_CLASS_DURATION) return null;
        return parsed;
    }

    // ============================================================
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================

    function sessionActiveInWeek(session, week) {
        if (!session) return false;
        if (session.startWeek === null || session.startWeek === undefined) {
            return false;
        }
        return RangeUtils.containsWeek(
            week,
            session.startWeek,
            session.endWeek
        );
    }

    function sessionsOverlap(a, b) {
        if (!a || !b) return false;
        if (a.day !== b.day) return false;

        var aStart = a.startTime;
        var aEnd = a.startTime + a.duration;
        var bStart = b.startTime;
        var bEnd = b.startTime + b.duration;

        var timeOverlap = aStart < bEnd && bStart < aEnd;
        if (!timeOverlap) return false;

        return RangeUtils.weeksOverlap(
            a.startWeek, a.endWeek,
            b.startWeek, b.endWeek
        );
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.teachingSessions;
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
        var store = appData.academy.teachingSessions;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function ensureStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.teachingSessions ||
            typeof appData.academy.teachingSessions !== 'object' ||
            Array.isArray(appData.academy.teachingSessions)) {
            appData.academy.teachingSessions = {};
        }
        return appData.academy.teachingSessions;
    }

    function getSessionInternal(sessionId) {
        if (!isNonEmptyString(sessionId)) {
            return null;
        }
        var store = getStore();
        if (!store) return null;
        var record = store[String(sessionId)];
        if (!isPlainObject(record)) return null;
        return record;
    }

    function getAllSessionRecordsInternal() {
        var store = getStore();
        if (!store) return [];
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
    // Used by pipeline validate() callbacks. Read from the appData
    // snapshot, not window.data.

    /**
     * Resolve a teaching group from the transaction snapshot.
     *
     * The snapshot's group store is the authoritative view for
     * validation. Reading through AcademyTeachingGroups would read
     * live state, which may diverge from the snapshot during the
     * pipeline's validate→mutate window.
     */
    function getGroupFromSnapshot(appData, groupId) {
        if (!appData || !appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        if (!isPlainObject(appData.academy.teachingGroups)) {
            return null;
        }
        if (!isNonEmptyString(groupId)) {
            return null;
        }
        var group = appData.academy.teachingGroups[String(groupId)];
        if (!isPlainObject(group)) {
            return null;
        }
        return group;
    }

    function getSessionFromSnapshot(appData, sessionId) {
        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return null;
        }
        if (!isNonEmptyString(sessionId)) {
            return null;
        }
        var record = store[String(sessionId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateNoRoster(raw) {
        if (!isPlainObject(raw)) return { valid: true };
        if (raw.studentIds !== undefined) {
            return {
                valid: false,
                message: 'Teaching sessions do not carry studentIds. ' +
                    'Membership lives on the group.'
            };
        }
        if (raw.members !== undefined) {
            return {
                valid: false,
                message: 'Teaching sessions do not carry members. ' +
                    'Membership lives on the group.'
            };
        }
        return { valid: true };
    }

    function validateGroupId(groupId) {
        if (!isNonEmptyString(groupId)) {
            return { valid: false, message: 'Group ID is required.' };
        }
        var group = AcademyTeachingGroups.getGroup(groupId);
        if (!group) {
            return { valid: false, message: 'Teaching group not found.' };
        }
        return { valid: true, group: group };
    }

    function validateTimeWindow(day, startTime, duration) {
        var dayNum = parseDayStrict(day);
        if (dayNum === null) {
            return {
                valid: false,
                message: 'Day must be between ' + MIN_DAY + ' and ' + MAX_DAY + '.'
            };
        }
        var startNum = parseHourStrict(startTime);
        if (startNum === null) {
            return {
                valid: false,
                message: 'Start time must be between ' + MIN_HOUR + ' and ' + MAX_HOUR + '.'
            };
        }
        var durationNum = parseDurationStrict(duration);
        if (durationNum === null) {
            return {
                valid: false,
                message: 'Duration must be between ' +
                    MIN_CLASS_DURATION + ' and ' + MAX_CLASS_DURATION + '.'
            };
        }
        if (startNum + durationNum > CALENDAR_END_TIME) {
            return {
                valid: false,
                message: 'Session extends beyond the end of the day.'
            };
        }
        return {
            valid: true,
            day: dayNum,
            startTime: startNum,
            duration: durationNum
        };
    }

    function validateWeekRange(startWeek, endWeek) {
        var startNum = parseWeekStrict(startWeek);
        if (startNum === null) {
            return {
                valid: false,
                message: 'Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'
            };
        }
        if (endWeek === undefined || endWeek === null) {
            return { valid: true, startWeek: startNum, endWeek: null };
        }
        var endNum = parseWeekStrict(endWeek);
        if (endNum === null) {
            return {
                valid: false,
                message: 'End week must be null or between ' +
                    MIN_WEEK + ' and ' + MAX_WEEK + '.'
            };
        }
        if (endNum < startNum) {
            return {
                valid: false,
                message: 'End week cannot be before start week.'
            };
        }
        return { valid: true, startWeek: startNum, endWeek: endNum };
    }

    // ============================================================
    // OVERLAP DETECTION
    // ============================================================
    //
    // Two lookups with the same shape, one against live state, one
    // against a transaction snapshot. Preflight uses live; the
    // pipeline uses snapshot.

    function findOverlappingSessionInStore(
        store,
        groupId,
        candidate,
        excludeId
    ) {
        if (!store || typeof store !== 'object') {
            return null;
        }
        var targetGroup = String(groupId);
        var exclude = (excludeId !== undefined && excludeId !== null)
            ? String(excludeId)
            : null;

        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (!isPlainObject(s)) continue;
            if (String(s.groupId) !== targetGroup) continue;
            if (exclude !== null && String(s.id) === exclude) continue;
            if (sessionsOverlap(s, candidate)) {
                return s;
            }
        }
        return null;
    }

    function findOverlappingSession(groupId, candidate, excludeId) {
        return findOverlappingSessionInStore(
            getStore(),
            groupId,
            candidate,
            excludeId
        );
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getSession(sessionId) {
        var record = getSessionInternal(sessionId);
        return record ? deepClone(record) : null;
    }

    function getAllSessions() {
        var records = getAllSessionRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getSessionsForGroup(groupId) {
        if (!isNonEmptyString(groupId)) return [];
        var target = String(groupId);
        var records = getAllSessionRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].groupId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    function getSessionsForLocation(locationId) {
        if (!isNonEmptyString(locationId)) return [];
        var target = String(locationId);
        var records = getAllSessionRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].locationId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    function getActiveSessionsForGroup(groupId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) return [];
        var sessions = getSessionsForGroup(groupId);
        var result = [];
        for (var i = 0; i < sessions.length; i++) {
            if (sessionActiveInWeek(sessions[i], weekNum)) {
                result.push(sessions[i]);
            }
        }
        return result;
    }

    function getActiveSessionsForLocation(locationId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) return [];
        var sessions = getSessionsForLocation(locationId);
        var result = [];
        for (var i = 0; i < sessions.length; i++) {
            if (sessionActiveInWeek(sessions[i], weekNum)) {
                result.push(sessions[i]);
            }
        }
        return result;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    function createSession(data) {
        if (!isPlainObject(data)) {
            return Promise.resolve(failure('Session data must be an object.'));
        }

        var rosterCheck = validateNoRoster(data);
        if (!rosterCheck.valid) {
            return Promise.resolve(failure(rosterCheck.message));
        }

        var groupCheck = validateGroupId(data.groupId);
        if (!groupCheck.valid) {
            return Promise.resolve(failure(groupCheck.message));
        }

        var timeCheck = validateTimeWindow(
            data.day,
            data.startTime,
            data.duration
        );
        if (!timeCheck.valid) {
            return Promise.resolve(failure(timeCheck.message));
        }

        var weekCheck = validateWeekRange(data.startWeek, data.endWeek);
        if (!weekCheck.valid) {
            return Promise.resolve(failure(weekCheck.message));
        }

        var locationId = (data.locationId !== undefined && data.locationId !== null &&
                          data.locationId !== '')
            ? String(data.locationId)
            : null;

        var candidate = {
            id: null,
            groupId: String(data.groupId),
            day: timeCheck.day,
            startTime: timeCheck.startTime,
            duration: timeCheck.duration,
            locationId: locationId,
            startWeek: weekCheck.startWeek,
            endWeek: weekCheck.endWeek
        };

        // Preflight overlap check against live state (UX).
        var overlap = findOverlappingSession(candidate.groupId, candidate, null);
        if (overlap) {
            return Promise.resolve(failure(
                'This session overlaps with an existing session ' +
                'of the same group on day ' + overlap.day + ' ' +
                'from week ' + overlap.startWeek + '.'
            ));
        }

        var generatedId = IdUtils.generateId('tsession');
        candidate.id = generatedId;

        var now = new Date().toISOString();
        candidate.createdAt = now;
        candidate.updatedAt = now;

        var targetId = generatedId;
        var targetGroupId = candidate.groupId;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                // The group must exist in the snapshot.
                if (!getGroupFromSnapshot(appData, targetGroupId)) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }

                // The session ID must not collide in the snapshot.
                if (getSessionFromSnapshot(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Session ID collision.'
                    };
                }

                // No overlap against the snapshot's sessions of
                // this group.
                var store = getStoreFromSnapshot(appData);
                var snapshotOverlap = findOverlappingSessionInStore(
                    store, targetGroupId, candidate, null
                );
                if (snapshotOverlap) {
                    return {
                        valid: false,
                        message:
                            'This session overlaps with an existing ' +
                            'session of the same group on day ' +
                            snapshotOverlap.day + '.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);
                store[targetId] = deepClone(candidate);
                return { session: deepClone(candidate), sessionId: targetId };
            },
            logMessage: 'Created teaching session for group ' + targetGroupId,
            successMessage: 'Teaching session created.',
            failureMessage: 'Failed to create teaching session.'
        });
    }

    function updateSession(sessionId, updates) {
        if (!isNonEmptyString(sessionId)) {
            return Promise.resolve(failure('Session ID is required.'));
        }
        if (!isPlainObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        var rosterCheck = validateNoRoster(updates);
        if (!rosterCheck.valid) {
            return Promise.resolve(failure(rosterCheck.message));
        }

        if (updates.groupId !== undefined) {
            return Promise.resolve(failure(
                'groupId is immutable after creation. Remove this ' +
                'session and create a new one in the target group.'
            ));
        }

        var existing = getSessionInternal(sessionId);
        if (!existing) {
            return Promise.resolve(failure('Teaching session not found.'));
        }

        var candidate = deepClone(existing);

        if (updates.day !== undefined) candidate.day = updates.day;
        if (updates.startTime !== undefined) candidate.startTime = updates.startTime;
        if (updates.duration !== undefined) candidate.duration = updates.duration;
        if (updates.locationId !== undefined) {
            candidate.locationId = (updates.locationId === null ||
                                    updates.locationId === '')
                ? null
                : String(updates.locationId);
        }
        if (updates.startWeek !== undefined) candidate.startWeek = updates.startWeek;
        if (updates.endWeek !== undefined) candidate.endWeek = updates.endWeek;

        var timeCheck = validateTimeWindow(
            candidate.day,
            candidate.startTime,
            candidate.duration
        );
        if (!timeCheck.valid) {
            return Promise.resolve(failure(timeCheck.message));
        }
        candidate.day = timeCheck.day;
        candidate.startTime = timeCheck.startTime;
        candidate.duration = timeCheck.duration;

        var weekCheck = validateWeekRange(candidate.startWeek, candidate.endWeek);
        if (!weekCheck.valid) {
            return Promise.resolve(failure(weekCheck.message));
        }
        candidate.startWeek = weekCheck.startWeek;
        candidate.endWeek = weekCheck.endWeek;

        // Preflight overlap check against live state (UX).
        var overlap = findOverlappingSession(
            candidate.groupId,
            candidate,
            sessionId
        );
        if (overlap) {
            return Promise.resolve(failure(
                'This session overlaps with an existing session ' +
                'of the same group on day ' + overlap.day + '.'
            ));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(sessionId);
        var targetGroupId = candidate.groupId;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                // The target must still exist.
                if (!getSessionFromSnapshot(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Teaching session no longer exists.'
                    };
                }

                // The owning group must still exist.
                if (!getGroupFromSnapshot(appData, targetGroupId)) {
                    return {
                        valid: false,
                        message: 'Owning teaching group no longer exists.'
                    };
                }

                // No overlap in the snapshot, excluding this session.
                var store = getStoreFromSnapshot(appData);
                var snapshotOverlap = findOverlappingSessionInStore(
                    store, targetGroupId, candidate, targetId
                );
                if (snapshotOverlap) {
                    return {
                        valid: false,
                        message:
                            'This session overlaps with an existing ' +
                            'session of the same group on day ' +
                            snapshotOverlap.day + '.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    throw new Error('Teaching session not found in store.');
                }
                store[targetId] = deepClone(candidate);
                return { session: deepClone(candidate) };
            },
            logMessage: 'Updated teaching session ' + targetId,
            successMessage: 'Teaching session updated.',
            failureMessage: 'Failed to update teaching session.'
        });
    }

    function endSession(sessionId, effectiveWeek) {
        if (!isNonEmptyString(sessionId)) {
            return Promise.resolve(failure('Session ID is required.'));
        }
        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid effective week is required.')
            );
        }

        var existing = getSessionInternal(sessionId);
        if (!existing) {
            return Promise.resolve(failure('Teaching session not found.'));
        }
        if (existing.startWeek >= weekNum) {
            return Promise.resolve(
                failure('Effective week would end the session before it begins.')
            );
        }

        var targetId = String(sessionId);
        var newEndWeek = weekNum - 1;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var snapshot = getSessionFromSnapshot(appData, targetId);
                if (!snapshot) {
                    return {
                        valid: false,
                        message: 'Teaching session no longer exists.'
                    };
                }
                if (snapshot.startWeek >= weekNum) {
                    return {
                        valid: false,
                        message:
                            'Effective week would end the session ' +
                            'before it begins.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store || !store[targetId]) {
                    throw new Error('Teaching session not found in store.');
                }
                store[targetId].endWeek = newEndWeek;
                store[targetId].updatedAt = new Date().toISOString();
                return { session: deepClone(store[targetId]) };
            },
            logMessage: 'Ended teaching session ' + targetId,
            successMessage: 'Teaching session ended.',
            failureMessage: 'Failed to end teaching session.'
        });
    }

    function removeSessionRecord(sessionId) {
        if (!isNonEmptyString(sessionId)) {
            return Promise.resolve(failure('Session ID is required.'));
        }
        var targetId = String(sessionId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!getSessionFromSnapshot(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Teaching session no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store || !Object.prototype.hasOwnProperty.call(store, targetId)) {
                    throw new Error('Teaching session not found in store.');
                }
                delete store[targetId];
                return { removed: true };
            },
            logMessage: 'Removed teaching session ' + targetId,
            successMessage: 'Teaching session removed.',
            failureMessage: 'Failed to remove teaching session.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Strip all sessions for a group. Called from a group-delete
     * cascade.
     *
     * Does not require the group store. Sessions are filtered by
     * groupId directly. A missing store is not an error here: if
     * there are no sessions, there is nothing to strip.
     */
    function stripGroupRefs(appData, groupId) {
        var result = { sessionsRemoved: 0 };
        if (!appData || !isNonEmptyString(groupId)) return result;

        var store = getStoreFromSnapshot(appData);
        if (!store) return result;

        var target = String(groupId);
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (isPlainObject(s) && String(s.groupId) === target) {
                delete store[keys[i]];
                result.sessionsRemoved++;
            }
        }
        return result;
    }

    /**
     * Null the locationId on every session that referenced the
     * deleted location. The session survives; the reference is
     * cleared.
     */
    function stripLocationRefs(appData, locationId) {
        var result = { sessionsCleared: 0 };
        if (!appData || !isNonEmptyString(locationId)) return result;

        var store = getStoreFromSnapshot(appData);
        if (!store) return result;

        var target = String(locationId);
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (isPlainObject(s) && String(s.locationId) === target) {
                s.locationId = null;
                s.updatedAt = new Date().toISOString();
                result.sessionsCleared++;
            }
        }
        return result;
    }

    /**
     * Strip all sessions for every group in a class.
     *
     * The class→group resolution reads the group store on the same
     * appData snapshot. Sessions are removed only when their group
     * exists in the snapshot and that group's classId matches.
     *
     * CASCADE STRICTNESS: a missing or malformed group store throws.
     * This is a destructive cascade; silently reporting zero
     * removals would hide a data-integrity failure and leave the
     * sessions orphaned.
     */
    function stripClassRefs(appData, classId) {
        var result = { sessionsRemoved: 0 };
        if (!appData || !isNonEmptyString(classId)) return result;

        var store = getStoreFromSnapshot(appData);
        if (!store) return result;

        if (!appData.academy ||
            !isPlainObject(appData.academy.teachingGroups)) {
            throw new Error(
                '[AcademyTeachingSessions] stripClassRefs requires ' +
                'the teachingGroups store on the snapshot. The store ' +
                'is missing or malformed; the class-delete cascade ' +
                'cannot resolve group ownership without it.'
            );
        }

        var groupStore = appData.academy.teachingGroups;
        var targetClass = String(classId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (!isPlainObject(s)) continue;
            var group = groupStore[String(s.groupId)];
            if (group && String(group.classId) === targetClass) {
                delete store[keys[i]];
                result.sessionsRemoved++;
            }
        }
        return result;
    }

    /**
     * Strip every session belonging to a group whose disciplineId
     * matches the given discipline.
     *
     * The discipline→group→session resolution lives here, in the
     * sessions domain, because the sessions domain owns the
     * groupId → session relationship. Callers (AcademyCascade) do
     * not need to enumerate groups or know that sessions reference
     * groups.
     *
     * The group store is read from the same appData snapshot, so
     * this helper is transaction-local: it sees the state as of the
     * cascade's current mutation, not the live store.
     *
     * CASCADE STRICTNESS: a missing or malformed group store throws.
     *
     * Sessions whose group no longer exists in the snapshot are not
     * touched. Their groupId points at nothing, so the discipline
     * relationship cannot be established. Cleaning orphan sessions
     * of unknown discipline is out of scope; the caller (or a
     * subsequent repair pass) is responsible.
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = { sessionsRemoved: 0 };
        if (!appData || !isNonEmptyString(disciplineId)) return result;

        var store = getStoreFromSnapshot(appData);
        if (!store) return result;

        if (!appData.academy ||
            !isPlainObject(appData.academy.teachingGroups)) {
            throw new Error(
                '[AcademyTeachingSessions] stripDisciplineRefs requires ' +
                'the teachingGroups store on the snapshot. The store ' +
                'is missing or malformed; the discipline-delete cascade ' +
                'cannot resolve group ownership without it.'
            );
        }

        var groupStore = appData.academy.teachingGroups;
        var targetDiscipline = String(disciplineId);
        var keys = Object.keys(store);

        for (var i = 0; i < keys.length; i++) {
            var s = store[keys[i]];
            if (!isPlainObject(s)) continue;
            var group = groupStore[String(s.groupId)];
            if (!group) continue;
            if (String(group.disciplineId) !== targetDiscipline) continue;
            delete store[keys[i]];
            result.sessionsRemoved++;
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingSessions = Object.freeze({
        // Reads
        getSession: getSession,
        getAllSessions: getAllSessions,
        getSessionsForGroup: getSessionsForGroup,
        getSessionsForLocation: getSessionsForLocation,
        getActiveSessionsForGroup: getActiveSessionsForGroup,
        getActiveSessionsForLocation: getActiveSessionsForLocation,

        // Mutations
        createSession: createSession,
        updateSession: updateSession,
        endSession: endSession,
        removeSessionRecord: removeSessionRecord,

        // Cascade helpers
        stripGroupRefs: stripGroupRefs,
        stripLocationRefs: stripLocationRefs,
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs,

        // Helpers (exposed for testing)
        sessionsOverlap: sessionsOverlap,
        sessionActiveInWeek: sessionActiveInWeek,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        MIN_HOUR: MIN_HOUR,
        MAX_HOUR: MAX_HOUR,
        MIN_CLASS_DURATION: MIN_CLASS_DURATION,
        MAX_CLASS_DURATION: MAX_CLASS_DURATION
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingSessions;
        var required = [
            'getSession', 'getAllSessions',
            'getSessionsForGroup', 'getSessionsForLocation',
            'getActiveSessionsForGroup', 'getActiveSessionsForLocation',
            'createSession', 'updateSession', 'endSession',
            'removeSessionRecord',
            'stripGroupRefs', 'stripLocationRefs', 'stripClassRefs',
            'stripDisciplineRefs',
            'sessionsOverlap', 'sessionActiveInWeek'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            var activeSession = { startWeek: 1, endWeek: 10 };
            var ongoingSession = { startWeek: 5, endWeek: null };
            var noStartSession = { startWeek: null, endWeek: 20 };

            if (sessionActiveInWeek(activeSession, 5) !== true) {
                missing.push('sessionActiveInWeek missed an active week');
            }
            if (sessionActiveInWeek(activeSession, 10) !== true) {
                missing.push('sessionActiveInWeek failed on inclusive end');
            }
            if (sessionActiveInWeek(activeSession, 11) !== false) {
                missing.push('sessionActiveInWeek found a week past the end');
            }
            if (sessionActiveInWeek(ongoingSession, 52) !== true) {
                missing.push('sessionActiveInWeek missed an ongoing week');
            }
            if (sessionActiveInWeek(noStartSession, 5) !== false) {
                missing.push('sessionActiveInWeek accepted a null startWeek');
            }
            if (sessionActiveInWeek(null, 5) !== false) {
                missing.push('sessionActiveInWeek accepted a null session');
            }

            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: 10 },
                { day: 1, startTime: 10, duration: 1, startWeek: 1, endWeek: 10 }
            ) !== false) {
                missing.push('sessionsOverlap flagged back-to-back hours');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: 10 },
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: 10 }
            ) !== true) {
                missing.push('sessionsOverlap missed identical slots');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 2, startWeek: 1, endWeek: 10 },
                { day: 1, startTime: 10, duration: 2, startWeek: 1, endWeek: 10 }
            ) !== true) {
                missing.push('sessionsOverlap missed partial hour overlap');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 2, startWeek: 1, endWeek: 10 },
                { day: 2, startTime: 9, duration: 2, startWeek: 1, endWeek: 10 }
            ) !== false) {
                missing.push('sessionsOverlap flagged different days');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: 5 },
                { day: 1, startTime: 9, duration: 1, startWeek: 6, endWeek: 10 }
            ) !== false) {
                missing.push('sessionsOverlap ignored week disjointness');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: 5 },
                { day: 1, startTime: 9, duration: 1, startWeek: 5, endWeek: 10 }
            ) !== true) {
                missing.push('sessionsOverlap missed inclusive week endpoint');
            }
            if (sessionsOverlap(
                { day: 1, startTime: 9, duration: 1, startWeek: 1, endWeek: null },
                { day: 1, startTime: 9, duration: 1, startWeek: 30, endWeek: 40 }
            ) !== true) {
                missing.push('sessionsOverlap missed an ongoing week range');
            }

            // Boundary smoke test. A session ending exactly at
            // CALENDAR_END_TIME is valid; one ending one hour later
            // is not.
            var lastOccupiable = CalendarConstants.CALENDAR_END_HOUR;
            if (CALENDAR_END_TIME !== lastOccupiable + 1) {
                missing.push('CALENDAR_END_TIME is not CALENDAR_END_HOUR + 1');
            }
            var okTime = validateTimeWindow(
                MIN_DAY, lastOccupiable, 1
            );
            if (okTime.valid !== true) {
                missing.push(
                    'validateTimeWindow rejected a session ending ' +
                    'exactly at CALENDAR_END_TIME'
                );
            }
            var badTime = validateTimeWindow(
                MIN_DAY, lastOccupiable, 2
            );
            if (badTime.valid !== false) {
                missing.push(
                    'validateTimeWindow accepted a session extending ' +
                    'past CALENDAR_END_TIME'
                );
            }
        } catch (e) {
            missing.push('predicate smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn('[AcademyTeachingSessions] Verification failed:', missing.join(', '));
        }
    })();

})();
