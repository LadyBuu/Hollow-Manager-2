/**
 * modules/academy/academy-teaching-groups.js - Academy Teaching Groups
 * SINGLE SOURCE OF TRUTH for teaching relationships.
 *
 * Path: js/modules/academy/academy-teaching-groups.js
 *
 * WHAT THIS MODULE OWNS:
 *   A teaching relationship: a set of students studying a class's
 *   offering of a discipline with a specific instructor.
 *
 *     academy.teachingGroups[groupId] = {
 *       id,
 *       classId,
 *       disciplineId,
 *       instructorId,
 *       groupNumber,       // monotonic, per (classId, disciplineId, instructorId)
 *       customName,        // null or user-set
 *       members: [
 *         { characterId, startWeek, endWeek }
 *       ],
 *       startWeek,         // when the group was formed
 *       endWeek,           // null = ongoing; endWeek inclusive
 *       createdAt,
 *       updatedAt
 *     }
 *
 *   Plus a sequence store for group numbers:
 *
 *     academy.teachingGroupSequences["classId|disciplineId|instructorId"] = N
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Class-discipline windows      (AcademyClassDisciplines)
 *   - Student enrolment             (AcademyEnrolments)
 *   - Recurring meetings            (AcademyTeachingSessions)
 *   - Compound operations           (AcademySchedule)
 *
 * HISTORICAL-RECORD PRINCIPLE:
 *   A group is a historical fact. Ending a member's participation
 *   sets their endWeek; it does NOT delete the member entry. Ending
 *   the group as a whole sets the group's endWeek. Deleting a group
 *   outright is reserved for administrative cleanup and for
 *   cascade deletes (class delete, discipline delete).
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded [MIN_WEEK, MAX_WEEK].
 *   - startWeek and endWeek are integers in that range.
 *   - endWeek === null means "ongoing".
 *   - endWeek is INCLUSIVE.
 *
 * MEMBERSHIP INVARIANT — AT MOST ONE ACTIVE INTERVAL PER CHARACTER:
 *   A character has at most one interval per group that contains any
 *   given week. This is enforced at add time (addMemberToGroup
 *   rejects a new interval that would overlap an existing non-active
 *   interval) and at end time (endMembership rejects when the stored
 *   history contains more than one interval containing the effective
 *   week, which is a data-integrity failure rather than a normal
 *   state).
 *
 *   "Already active at this week" is NOT an overlap rejection. It is
 *   a no-op: the caller asked for a state that already holds.
 *   Overlap rejection applies only to the case where the proposed
 *   interval would conflict with an existing interval that does NOT
 *   already contain the requested week. This mirrors the semantics
 *   of AcademyWeeklyTeams.syncAddMemberIntervalToPersistentRoster.
 *
 * RANGE PREDICATES:
 *   The "does this range contain this week" question is owned by
 *   window.RangeUtils, which is the canonical range-predicate module
 *   for the whole application. The two local helpers
 *   `memberActiveInWeek` and `groupActiveInWeek` are delegating
 *   wrappers: they do the member-shape / group-shape null checks and
 *   then call RangeUtils.containsWeek. Do not reimplement the range
 *   math here; it lives in one place, on purpose.
 *
 * DISPLAY NAME:
 *   A group's display name is:
 *     customName if set
 *     otherwise `${discipline.name} ${letterFromNumber(groupNumber)}`
 *
 *   The letter is derived from groupNumber. Group 1 → A, 2 → B, ...
 *   27 → AA, 28 → AB, etc. (base-26 alphabetic).
 *
 *   The aggregator resolves the display name. This module provides
 *   the raw inputs (groupNumber, customName, disciplineId).
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the appData argument it is handed. It does not read window.data.
 *   Preflight reads against window.data are for early UX feedback
 *   only; the pipeline re-checks against the snapshot.
 *
 * CASCADE STRICTNESS:
 *   stripClassRefs, stripDisciplineRefs, stripInstructorRefs, and
 *   stripCharacterRefs operate on a destructive cascade. A missing
 *   or malformed group store on the snapshot is a data-integrity
 *   failure, not "no groups"; the helpers throw rather than silently
 *   reporting a zero-count success.
 *
 *   stripCharacterRefs is called during character deletion. It ends
 *   the character's memberships rather than deleting entries, so
 *   historical records survive.
 *
 * REMOVE-GROUP-RECORD IS LOW-LEVEL:
 *   removeGroupRecord deletes the group record from the group store.
 *   It does NOT remove teaching sessions owned by the group. Cross-
 *   domain callers that want a group and its sessions removed in one
 *   transaction use AcademySchedule.removeTeachingGroup, which is
 *   the compound operation that owns that orchestration.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.RangeUtils
 *   - window.MutationPipeline
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *   - window.IdUtils
 *
 * USAGE:
 *   AcademyTeachingGroups.createGroup(classId, disciplineId, instructorId, week)
 *       .then(...);
 *   AcademyTeachingGroups.addMemberToGroup(groupId, charId, week)
 *       .then(...);
 *   AcademyTeachingGroups.endMembership(groupId, charId, effectiveWeek)
 *       .then(...);
 */

(function() {
    'use strict';

    if (window.__academyTeachingGroupsLoaded) {
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
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
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
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!RangeUtils || typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingGroups] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingGroupsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var DEFAULT_GROUP_NAME_MAX_LENGTH = 60;

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
                '[AcademyTeachingGroups] deepClone aliased the input.'
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
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    function makeSequenceKey(classId, disciplineId, instructorId) {
        return String(classId) + '|' +
               String(disciplineId) + '|' +
               String(instructorId);
    }

    function resolveGroupNameMaxLength() {
        // TeamConstants is not a dependency of this module, and
        // group name length is not a team concern. The bound is
        // local; callers that need a different one must state it
        // here. This is not a silent truncation: an overlong name
        // is rejected, not trimmed.
        return DEFAULT_GROUP_NAME_MAX_LENGTH;
    }

    // ============================================================
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================
    //
    // RangeUtils.containsWeek(week, start, end) is the canonical
    // "does this range contain this week" predicate for the whole
    // application. It treats end === null as unbounded, uses
    // inclusive bounds on both ends, and rejects weeks outside
    // [MIN_WEEK, MAX_WEEK].
    //
    // The two helpers below add only the member-shape and
    // group-shape null checks that RangeUtils cannot know about.
    // Everything else is delegation. Do not put range math here.

    function memberActiveInWeek(member, week) {
        if (!member || typeof member !== 'object') {
            return false;
        }
        if (member.startWeek === null || member.startWeek === undefined) {
            return false;
        }
        return RangeUtils.containsWeek(
            week,
            member.startWeek,
            member.endWeek
        );
    }

    function groupActiveInWeek(group, week) {
        if (!group) {
            return false;
        }
        if (group.startWeek === null || group.startWeek === undefined) {
            return false;
        }
        return RangeUtils.containsWeek(
            week,
            group.startWeek,
            group.endWeek
        );
    }

    // ============================================================
    // MEMBER INTERVAL OVERLAP
    // ============================================================
    //
    // Two member entries overlap when their inclusive [start, end]
    // ranges intersect. endWeek === null means unbounded.
    //
    // This predicate is local because RangeUtils.weeksOverlap works
    // on bare week numbers and this shape carries startWeek /
    // endWeek. The interval math itself is not reimplemented: the
    // endpoint comparison is the same inclusive-overlap rule used
    // everywhere.

    function memberIntervalsOverlap(a, b) {
        if (!a || !b) { return false; }
        if (a.startWeek === null || a.startWeek === undefined) { return false; }
        if (b.startWeek === null || b.startWeek === undefined) { return false; }

        var aEnd = (a.endWeek === null || a.endWeek === undefined)
            ? Infinity
            : a.endWeek;
        var bEnd = (b.endWeek === null || b.endWeek === undefined)
            ? Infinity
            : b.endWeek;

        return a.startWeek <= bEnd && b.startWeek <= aEnd;
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getGroupStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.teachingGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getSequenceStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.teachingGroupSequences;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getGroupStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.teachingGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getGroupFromSnapshot(appData, groupId) {
        var store = getGroupStoreFromSnapshot(appData);
        if (!store) { return null; }
        if (!isNonEmptyString(groupId)) { return null; }
        var record = store[String(groupId)];
        if (!isPlainObject(record)) { return null; }
        return record;
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
        if (!appData || !isPlainObject(appData.curriculum)) {
            return null;
        }
        var list = appData.curriculum.disciplines;
        if (!Array.isArray(list)) { return null; }
        if (!isNonEmptyString(disciplineId)) { return null; }
        var target = String(disciplineId);
        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            if (d && String(d.id) === target) {
                return d;
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

    function ensureGroupStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.teachingGroups ||
            typeof appData.academy.teachingGroups !== 'object' ||
            Array.isArray(appData.academy.teachingGroups)) {
            appData.academy.teachingGroups = {};
        }
        return appData.academy.teachingGroups;
    }

    function ensureSequenceStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.teachingGroupSequences ||
            typeof appData.academy.teachingGroupSequences !== 'object' ||
            Array.isArray(appData.academy.teachingGroupSequences)) {
            appData.academy.teachingGroupSequences = {};
        }
        return appData.academy.teachingGroupSequences;
    }

    // ============================================================
    // INTERNAL READS - LIVE REFERENCES
    // ============================================================

    function getGroupInternal(groupId) {
        if (!isNonEmptyString(groupId)) {
            return null;
        }
        var store = getGroupStore();
        if (!store) {
            return null;
        }
        var record = store[String(groupId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    function getAllGroupRecordsInternal() {
        var store = getGroupStore();
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
    // VALIDATION - preflight (live reads)
    // ============================================================

    function validateInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return { valid: false, message: 'Instructor ID is required.' };
        }
        var char = CharacterQueries.getCharacterById(instructorId);
        if (!char) {
            return { valid: false, message: 'Instructor not found.' };
        }
        return { valid: true, character: char };
    }

    function validateClassAndDiscipline(classId, disciplineId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return { valid: false, message: 'Class not found.' };
        }
        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, class: cls, discipline: discipline };
    }

    function validateWeekRange(startWeek, endWeek) {
        var startNum = parseWeekStrict(startWeek);
        if (startNum === null) {
            return {
                valid: false,
                message: 'Start week must be between ' +
                    MIN_WEEK + ' and ' + MAX_WEEK + '.'
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
    // INTERNAL PREDICATES
    // ============================================================

    /**
     * Count the member entries on the group that have at least one
     * interval containing `weekNum`.
     */
    function countActiveMemberEntries(group, charId, weekNum) {
        if (!group || !Array.isArray(group.members)) { return 0; }
        var target = String(charId);
        var count = 0;
        for (var i = 0; i < group.members.length; i++) {
            var m = group.members[i];
            if (!m) { continue; }
            if (String(m.characterId) !== target) { continue; }
            if (memberActiveInWeek(m, weekNum)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Does adding an interval at `weekNum` (open-ended) conflict
     * with any existing interval for this character on this group
     * that is NOT already active at `weekNum`?
     *
     * The membership invariant is "at most one active interval per
     * character per group at any given week." A character who is
     * already active at weekNum is asking for a state that already
     * holds — a no-op, not a conflict.
     *
     * A character who is NOT active at weekNum but who has an
     * existing interval that would still overlap [weekNum, ∞) is a
     * real conflict: the proposed interval would create two
     * simultaneous stints.
     *
     * Returns the conflicting entry, or null.
     */
    function findConflictOnAdd(group, charId, weekNum) {
        if (!group || !Array.isArray(group.members)) { return null; }
        var target = String(charId);
        var proposed = { startWeek: weekNum, endWeek: null };

        for (var i = 0; i < group.members.length; i++) {
            var m = group.members[i];
            if (!m) { continue; }
            if (String(m.characterId) !== target) { continue; }

            // Already active at weekNum? Then the requested state
            // already holds. Not a conflict.
            if (memberActiveInWeek(m, weekNum)) {
                continue;
            }

            if (memberIntervalsOverlap(m, proposed)) {
                return m;
            }
        }
        return null;
    }

    /**
     * Find every entry for this character that has at least one
     * interval containing `weekNum`.
     */
    function findActiveEntriesForWeek(group, charId, weekNum) {
        var result = [];
        if (!group || !Array.isArray(group.members)) { return result; }
        var target = String(charId);
        for (var i = 0; i < group.members.length; i++) {
            var m = group.members[i];
            if (!m) { continue; }
            if (String(m.characterId) !== target) { continue; }
            if (memberActiveInWeek(m, weekNum)) {
                result.push(m);
            }
        }
        return result;
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getGroup(groupId) {
        var record = getGroupInternal(groupId);
        return record ? deepClone(record) : null;
    }

    function getAllGroups() {
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getGroupsForClass(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var target = String(classId);
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].classId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    function getGroupsForDiscipline(classId, disciplineId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
            return [];
        }
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (String(r.classId) === targetClass &&
                String(r.disciplineId) === targetDiscipline) {
                result.push(deepClone(r));
            }
        }
        return result;
    }

    function getGroupsForInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }
        var target = String(instructorId);
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (String(records[i].instructorId) === target) {
                result.push(deepClone(records[i]));
            }
        }
        return result;
    }

    function getGroupsForStudent(studentId) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var target = String(studentId);
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            var members = Array.isArray(records[i].members)
                ? records[i].members
                : [];
            for (var j = 0; j < members.length; j++) {
                if (String(members[j].characterId) === target) {
                    result.push(deepClone(records[i]));
                    break;
                }
            }
        }
        return result;
    }

    function getGroupsForClassDisciplineInstructor(classId, disciplineId, instructorId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(instructorId)) {
            return [];
        }
        var tc = String(classId);
        var td = String(disciplineId);
        var ti = String(instructorId);
        var records = getAllGroupRecordsInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (String(r.classId) === tc &&
                String(r.disciplineId) === td &&
                String(r.instructorId) === ti) {
                result.push(deepClone(r));
            }
        }
        return result;
    }

    function getActiveMembers(groupId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }
        var record = getGroupInternal(groupId);
        if (!record) {
            return [];
        }
        var members = Array.isArray(record.members) ? record.members : [];
        var result = [];
        for (var i = 0; i < members.length; i++) {
            if (memberActiveInWeek(members[i], weekNum)) {
                result.push(String(members[i].characterId));
            }
        }
        return result;
    }

    function isMemberOfGroup(groupId, charId, week) {
        if (!isNonEmptyString(groupId) || !isNonEmptyString(charId)) {
            return false;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return false;
        }
        var record = getGroupInternal(groupId);
        if (!record) {
            return false;
        }
        var members = Array.isArray(record.members) ? record.members : [];
        var target = String(charId);
        for (var i = 0; i < members.length; i++) {
            if (String(members[i].characterId) === target &&
                memberActiveInWeek(members[i], weekNum)) {
                return true;
            }
        }
        return false;
    }

    function getGroupForStudentInClassDiscipline(classId, disciplineId, charId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(charId)) {
            return null;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return null;
        }

        var tc = String(classId);
        var td = String(disciplineId);
        var target = String(charId);
        var records = getAllGroupRecordsInternal();

        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (String(r.classId) !== tc) { continue; }
            if (String(r.disciplineId) !== td) { continue; }
            if (!groupActiveInWeek(r, weekNum)) { continue; }

            var members = Array.isArray(r.members) ? r.members : [];
            for (var j = 0; j < members.length; j++) {
                if (String(members[j].characterId) === target &&
                    memberActiveInWeek(members[j], weekNum)) {
                    return deepClone(r);
                }
            }
        }
        return null;
    }

    // ============================================================
    // CANDIDATE BUILDER
    // ============================================================

    function buildNewGroupRecord(classId, disciplineId, instructorId, groupNumber, week) {
        var now = new Date().toISOString();
        return {
            id: null,
            classId: String(classId),
            disciplineId: String(disciplineId),
            instructorId: String(instructorId),
            groupNumber: groupNumber,
            customName: null,
            members: [],
            startWeek: week,
            endWeek: null,
            createdAt: now,
            updatedAt: now
        };
    }

    // ============================================================
    // SEQUENCE VALIDATION
    // ============================================================
    //
    // The sequence store records the LAST allocated group number for
    // each (classId, disciplineId, instructorId) triple. The next
    // number is the recorded value plus one.
    //
    // Three states:
    //   - key absent               -> nextNumber = 1
    //   - key present, valid int >= 0 -> nextNumber = stored + 1
    //   - key present, malformed   -> throw
    //
    // The third state is a data-integrity failure. Treating a
    // corrupt sequence as "no sequence" would silently reuse group
    // numbers, and the sequence contract (monotonic per triple) is
    // load-bearing for display names and for reasoning about
    // historical groups.

    function allocateGroupNumber(seqStore, seqKey) {
        if (!isPlainObject(seqStore)) {
            throw new Error(
                '[AcademyTeachingGroups] The sequence store is not ' +
                'available on the snapshot.'
            );
        }

        var stored = seqStore[seqKey];

        if (stored === undefined) {
            seqStore[seqKey] = 1;
            return 1;
        }

        if (typeof stored !== 'number' ||
            !isFinite(stored) ||
            !Number.isInteger(stored) ||
            stored < 0) {
            throw new Error(
                '[AcademyTeachingGroups] The group-number sequence ' +
                'for "' + seqKey + '" is malformed (' +
                JSON.stringify(stored) + '). Fix the stored sequence ' +
                'before creating more groups for this triple.'
            );
        }

        var next = stored + 1;
        seqStore[seqKey] = next;
        return next;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Create a group. Allocates a fresh groupNumber from the sequence
     * store for this (class, discipline, instructor) triple.
     *
     * Does NOT merge with an existing group. Callers that want
     * find-or-create should use getGroupsForClassDisciplineInstructor
     * and pick one, or add members via addMemberToGroup.
     */
    function createGroup(classId, disciplineId, instructorId, week) {
        var cdCheck = validateClassAndDiscipline(classId, disciplineId);
        if (!cdCheck.valid) {
            return Promise.resolve(failure(cdCheck.message));
        }

        var instCheck = validateInstructor(instructorId);
        if (!instCheck.valid) {
            return Promise.resolve(failure(instCheck.message));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid start week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var targetInstructor = String(instructorId);
        var seqKey = makeSequenceKey(targetClass, targetDiscipline, targetInstructor);

        // Generate the ID outside the pipeline. The pipeline
        // validator checks it for collision against the snapshot;
        // a collision is essentially impossible with IdUtils, but
        // the check is cheap and the contract is "ID is unique in
        // the resulting store."
        var newGroupId = IdUtils.generateId('tgroup');

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                // References must exist in the snapshot.
                if (!findClassInSnapshot(appData, targetClass)) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }
                if (!findDisciplineInSnapshot(appData, targetDiscipline)) {
                    return {
                        valid: false,
                        message: 'Discipline no longer exists.'
                    };
                }
                if (!findCharacterInSnapshot(appData, targetInstructor)) {
                    return {
                        valid: false,
                        message: 'Instructor no longer exists.'
                    };
                }

                // The generated ID must not collide in the snapshot.
                var groupStore = getGroupStoreFromSnapshot(appData);
                if (groupStore && groupStore[newGroupId]) {
                    return {
                        valid: false,
                        message: 'Group ID collision.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var groupStore = ensureGroupStore(appData);
                var seqStore = ensureSequenceStore(appData);

                // allocateGroupNumber throws on a malformed sequence;
                // the throw rolls back the transaction.
                var nextNumber = allocateGroupNumber(seqStore, seqKey);

                var group = buildNewGroupRecord(
                    targetClass,
                    targetDiscipline,
                    targetInstructor,
                    nextNumber,
                    weekNum
                );

                group.id = newGroupId;
                groupStore[newGroupId] = group;

                return { group: deepClone(group), groupId: newGroupId };
            },
            logMessage: 'Created teaching group for ' +
                (cdCheck.discipline.name || targetDiscipline) +
                ' with ' + (instCheck.character ? instCheck.character.firstName : targetInstructor),
            successMessage: 'Teaching group created.',
            failureMessage: 'Failed to create teaching group.'
        });
    }

    /**
     * Add a member to a group. Records "from `week` onward."
     *
     * MEMBERSHIP INVARIANT:
     *   If the member already has an interval on this group that
     *   contains `week`, this is a no-op.
     *
     *   Otherwise, if the member has any interval on this group
     *   that would overlap [week, ∞), the operation is rejected.
     *   The proposed interval would create two simultaneous stints
     *   for the same character on the same group.
     */
    function addMemberToGroup(groupId, charId, week) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var liveGroup = getGroupInternal(groupId);
        if (!liveGroup) {
            return Promise.resolve(failure('Teaching group not found.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var targetGroup = String(groupId);
        var targetChar = String(charId);

        // Preflight: already active at this week (live store)?
        if (isMemberOfGroup(targetGroup, targetChar, weekNum)) {
            return Promise.resolve({
                success: true,
                data: { added: false, reason: 'already-active' }
            });
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                // Group must exist in the snapshot.
                var snapshotGroup = getGroupFromSnapshot(appData, targetGroup);
                if (!snapshotGroup) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }

                // Character must exist in the snapshot.
                if (!findCharacterInSnapshot(appData, targetChar)) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                // Membership invariant against the snapshot.
                // Already active at this week -> no-op, allowed.
                // Any other overlap -> reject.
                var activeCount = countActiveMemberEntries(
                    snapshotGroup, targetChar, weekNum
                );
                if (activeCount > 0) {
                    return { valid: true };
                }

                var conflict = findConflictOnAdd(
                    snapshotGroup, targetChar, weekNum
                );
                if (conflict) {
                    return {
                        valid: false,
                        message:
                            'This character already has an overlapping ' +
                            'stint on this group (from week ' +
                            conflict.startWeek + ').'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !isPlainObject(store[targetGroup])) {
                    throw new Error('Teaching group not found in store.');
                }
                var group = store[targetGroup];
                if (!Array.isArray(group.members)) {
                    group.members = [];
                }

                var activeCount = countActiveMemberEntries(
                    group, targetChar, weekNum
                );
                if (activeCount > 0) {
                    return { added: false, reason: 'already-active' };
                }

                group.members.push({
                    characterId: targetChar,
                    startWeek: weekNum,
                    endWeek: null
                });
                group.updatedAt = new Date().toISOString();
                return { added: true };
            },
            logMessage: 'Added ' + targetChar + ' to teaching group ' + targetGroup,
            successMessage: 'Member added to group.',
            failureMessage: 'Failed to add member to group.'
        });
    }

    /**
     * End a member's participation from `effectiveWeek` onward.
     *
     * Drop-out semantics: truncates the active window at
     * effectiveWeek - 1. History survives.
     *
     * MEMBERSHIP INVARIANT:
     *   Exactly one active interval at effectiveWeek is the normal
     *   case. Zero is a no-op. More than one means stored history
     *   has overlapping stints for the same character on the same
     *   group — a data-integrity failure. Throwing surfaces it.
     */
    function endMembership(groupId, charId, effectiveWeek) {
        if (!isNonEmptyString(groupId) || !isNonEmptyString(charId)) {
            return Promise.resolve(failure('Group and character IDs are required.'));
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid effective week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
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

                var snapshotGroup = getGroupFromSnapshot(appData, targetGroup);
                if (!snapshotGroup) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }

                var activeEntries = findActiveEntriesForWeek(
                    snapshotGroup, targetChar, weekNum
                );

                if (activeEntries.length > 1) {
                    return {
                        valid: false,
                        message:
                            'Stored membership history has ' +
                            activeEntries.length + ' overlapping stints ' +
                            'for this character at week ' + weekNum +
                            '. Repair the stored intervals before ' +
                            'ending membership.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !isPlainObject(store[targetGroup])) {
                    return { ended: false, reason: 'no-group' };
                }
                var group = store[targetGroup];
                if (!Array.isArray(group.members)) {
                    return { ended: false, reason: 'no-members' };
                }

                var activeEntries = findActiveEntriesForWeek(
                    group, targetChar, weekNum
                );

                if (activeEntries.length === 0) {
                    return { ended: false, reason: 'not-active' };
                }

                if (activeEntries.length > 1) {
                    // Should be unreachable: validate() rejects
                    // this case. Kept as a defensive assertion so
                    // a diverged validate/mutate pair fails loudly
                    // rather than silently truncating one interval.
                    throw new Error(
                        'Multiple active intervals found during end.'
                    );
                }

                var matched = activeEntries[0];

                if (matched.startWeek >= weekNum) {
                    return { ended: false, reason: 'starts-after' };
                }

                matched.endWeek = weekNum - 1;
                group.updatedAt = new Date().toISOString();
                return { ended: true, endWeek: matched.endWeek };
            },
            logMessage: 'Ended membership of ' + targetChar +
                ' in teaching group ' + targetGroup,
            successMessage: 'Member removed from group.',
            failureMessage: 'Failed to remove member from group.'
        });
    }

    /**
     * Hard-delete a member's record from a group entirely.
     * Administrative cleanup only.
     *
     * Returns { removed: N } so callers can see how many entries
     * were affected. Under normal history, N is 0 or 1; a corrupt
     * store with duplicate entries for the same character returns
     * the count of all entries removed.
     */
    function removeMemberRecord(groupId, charId) {
        if (!isNonEmptyString(groupId) || !isNonEmptyString(charId)) {
            return Promise.resolve(failure('Group and character IDs are required.'));
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
                if (!getGroupFromSnapshot(appData, targetGroup)) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !isPlainObject(store[targetGroup])) {
                    return { removed: 0 };
                }
                var group = store[targetGroup];
                if (!Array.isArray(group.members)) {
                    return { removed: 0 };
                }
                var before = group.members.length;
                group.members = group.members.filter(function(m) {
                    return !m ||
                        String(m.characterId) !== targetChar;
                });
                var removed = before - group.members.length;
                if (removed > 0) {
                    group.updatedAt = new Date().toISOString();
                }
                return { removed: removed };
            },
            logMessage: 'Removed membership record(s) for ' + targetChar,
            successMessage: 'Membership record removed.',
            failureMessage: 'Failed to remove membership record.'
        });
    }

    /**
     * End the group as a whole from `effectiveWeek` onward.
     * Members' individual windows are unchanged; the group's own
     * endWeek is set.
     */
    function endGroup(groupId, effectiveWeek) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid effective week is required.')
            );
        }

        var targetGroup = String(groupId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var snapshotGroup = getGroupFromSnapshot(appData, targetGroup);
                if (!snapshotGroup) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                if (snapshotGroup.startWeek >= weekNum) {
                    return {
                        valid: false,
                        message:
                            'Effective week would end the group before ' +
                            'it begins.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !isPlainObject(store[targetGroup])) {
                    return { ended: false };
                }
                var group = store[targetGroup];
                if (group.startWeek >= weekNum) {
                    return { ended: false, reason: 'starts-after' };
                }
                group.endWeek = weekNum - 1;
                group.updatedAt = new Date().toISOString();
                return { ended: true, endWeek: group.endWeek };
            },
            logMessage: 'Ended teaching group ' + targetGroup,
            successMessage: 'Teaching group ended.',
            failureMessage: 'Failed to end teaching group.'
        });
    }

    /**
     * Set or clear the group's custom name.
     * Pass null to revert to the auto-generated name.
     *
     * Overlong names are REJECTED, not truncated. Silent truncation
     * hides user error; the caller must supply a name within bounds.
     */
    function setGroupCustomName(groupId, customName) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }

        var targetGroup = String(groupId);
        var name = null;
        if (customName !== null && customName !== undefined) {
            if (typeof customName !== 'string') {
                return Promise.resolve(failure('Custom name must be a string or null.'));
            }
            var trimmed = customName.trim();
            if (trimmed === '') {
                name = null;
            } else {
                var maxLength = resolveGroupNameMaxLength();
                if (trimmed.length > maxLength) {
                    return Promise.resolve(failure(
                        'Group name must be ' + maxLength +
                        ' characters or fewer.'
                    ));
                }
                name = trimmed;
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
                if (!getGroupFromSnapshot(appData, targetGroup)) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !isPlainObject(store[targetGroup])) {
                    return { changed: false };
                }
                var group = store[targetGroup];
                group.customName = name;
                group.updatedAt = new Date().toISOString();
                return { changed: true };
            },
            logMessage: 'Set custom name on teaching group ' + targetGroup,
            successMessage: 'Group name updated.',
            failureMessage: 'Failed to update group name.'
        });
    }

    /**
     * Hard-delete a teaching group. Reserved for administrative
     * cleanup and for cascade deletes. Ordinary "this group is over"
     * is endGroup.
     *
     * LOW-LEVEL PRIMITIVE: this function does NOT remove teaching
     * sessions owned by the group. Sessions that reference the
     * deleted group become orphans. Cross-domain callers that need
     * the group and its sessions removed in one transaction use
     * AcademySchedule.removeTeachingGroup, which is the compound
     * operation that owns that orchestration.
     */
    function removeGroupRecord(groupId) {
        if (!isNonEmptyString(groupId)) {
            return Promise.resolve(failure('Group ID is required.'));
        }

        var targetGroup = String(groupId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getGroupStoreFromSnapshot(appData);
                if (!store || !Object.prototype.hasOwnProperty.call(store, targetGroup)) {
                    return { removed: false };
                }
                delete store[targetGroup];
                return { removed: true };
            },
            logMessage: 'Removed teaching group record ' + targetGroup,
            successMessage: 'Teaching group removed.',
            failureMessage: 'Failed to remove teaching group.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================
    //
    // All four helpers run inside another module's pipeline
    // transaction. A missing or malformed group store on the
    // snapshot is a data-integrity failure for a destructive
    // cascade; the helper throws rather than silently reporting a
    // zero-count success.

    function assertGroupStorePresent(appData, helperName) {
        var store = getGroupStoreFromSnapshot(appData);
        if (!store) {
            throw new Error(
                '[AcademyTeachingGroups] ' + helperName + ' requires ' +
                'the teachingGroups store on the snapshot. The store ' +
                'is missing or malformed; the cascade cannot proceed.'
            );
        }
        return store;
    }

    /**
     * End every membership for a character across all groups, from
     * `effectiveWeek` onward. Historical records survive.
     *
     * If effectiveWeek is null, all memberships are ended with
     * endWeek = MAX_WEEK.
     */
    function stripCharacterRefs(appData, charId, effectiveWeek) {
        var result = { membershipsEnded: 0, groupsEndedAsInstructor: 0 };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }

        var store = assertGroupStorePresent(appData, 'stripCharacterRefs');

        var weekNum = null;
        if (effectiveWeek !== undefined && effectiveWeek !== null) {
            weekNum = parseWeekStrict(effectiveWeek);
        }

        var target = String(charId);
        var groupIds = Object.keys(store);

        for (var i = 0; i < groupIds.length; i++) {
            var group = store[groupIds[i]];
            if (!isPlainObject(group)) { continue; }

            // If the character is the instructor, end the whole group.
            if (String(group.instructorId) === target) {
                if (weekNum !== null) {
                    if (group.startWeek < weekNum &&
                        (group.endWeek === null || group.endWeek >= weekNum)) {
                        group.endWeek = weekNum - 1;
                        result.groupsEndedAsInstructor++;
                    }
                } else {
                    if (group.endWeek === null) {
                        group.endWeek = MAX_WEEK;
                        result.groupsEndedAsInstructor++;
                    }
                }
                continue;
            }

            // Otherwise, end their membership(s).
            if (!Array.isArray(group.members)) { continue; }
            for (var j = 0; j < group.members.length; j++) {
                var member = group.members[j];
                if (String(member.characterId) !== target) { continue; }
                if (member.endWeek !== null && member.endWeek !== undefined) {
                    continue;
                }
                if (weekNum !== null) {
                    if (member.startWeek >= weekNum) {
                        continue;
                    }
                    member.endWeek = weekNum - 1;
                } else {
                    member.endWeek = MAX_WEEK;
                }
                result.membershipsEnded++;
            }
        }

        return result;
    }

    /**
     * Strip the entire teachingGroups subtree for a class.
     * Hard delete. Called from class-delete cascade.
     */
    function stripClassRefs(appData, classId) {
        var result = { groupsRemoved: 0 };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = assertGroupStorePresent(appData, 'stripClassRefs');

        var target = String(classId);
        var groupIds = Object.keys(store);

        for (var i = 0; i < groupIds.length; i++) {
            var group = store[groupIds[i]];
            if (!isPlainObject(group)) { continue; }
            if (String(group.classId) === target) {
                delete store[groupIds[i]];
                result.groupsRemoved++;
            }
        }

        return result;
    }

    /**
     * Strip all teaching groups for a discipline across all classes.
     * Called from discipline-delete cascade.
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = { groupsRemoved: 0 };

        if (!appData || !isNonEmptyString(disciplineId)) {
            return result;
        }

        var store = assertGroupStorePresent(appData, 'stripDisciplineRefs');

        var target = String(disciplineId);
        var groupIds = Object.keys(store);

        for (var i = 0; i < groupIds.length; i++) {
            var group = store[groupIds[i]];
            if (!isPlainObject(group)) { continue; }
            if (String(group.disciplineId) === target) {
                delete store[groupIds[i]];
                result.groupsRemoved++;
            }
        }

        return result;
    }

    /**
     * Strip all teaching groups for a specific instructor. Called
     * when an instructor record is deleted outright (rare).
     */
    function stripInstructorRefs(appData, instructorId) {
        var result = { groupsRemoved: 0 };

        if (!appData || !isNonEmptyString(instructorId)) {
            return result;
        }

        var store = assertGroupStorePresent(appData, 'stripInstructorRefs');

        var target = String(instructorId);
        var groupIds = Object.keys(store);

        for (var i = 0; i < groupIds.length; i++) {
            var group = store[groupIds[i]];
            if (!isPlainObject(group)) { continue; }
            if (String(group.instructorId) === target) {
                delete store[groupIds[i]];
                result.groupsRemoved++;
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingGroups = Object.freeze({
        // Reads
        getGroup: getGroup,
        getAllGroups: getAllGroups,
        getGroupsForClass: getGroupsForClass,
        getGroupsForDiscipline: getGroupsForDiscipline,
        getGroupsForInstructor: getGroupsForInstructor,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForClassDisciplineInstructor: getGroupsForClassDisciplineInstructor,
        getActiveMembers: getActiveMembers,
        isMemberOfGroup: isMemberOfGroup,
        getGroupForStudentInClassDiscipline: getGroupForStudentInClassDiscipline,

        // Mutations
        createGroup: createGroup,
        addMemberToGroup: addMemberToGroup,
        endMembership: endMembership,
        removeMemberRecord: removeMemberRecord,
        endGroup: endGroup,
        setGroupCustomName: setGroupCustomName,
        removeGroupRecord: removeGroupRecord,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs,
        stripInstructorRefs: stripInstructorRefs,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingGroups;
        var required = [
            'getGroup', 'getAllGroups', 'getGroupsForClass',
            'getGroupsForDiscipline', 'getGroupsForInstructor',
            'getGroupsForStudent', 'getGroupsForClassDisciplineInstructor',
            'getActiveMembers', 'isMemberOfGroup',
            'getGroupForStudentInClassDiscipline',
            'createGroup', 'addMemberToGroup', 'endMembership',
            'removeMemberRecord', 'endGroup', 'setGroupCustomName',
            'removeGroupRecord',
            'stripCharacterRefs', 'stripClassRefs',
            'stripDisciplineRefs', 'stripInstructorRefs'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            console.warn('[AcademyTeachingGroups] Verification missing:', missing.join(', '));
        }

        // Smoke test the range wrappers and the overlap predicate.
        try {
            var activeMember = { characterId: 'c1', startWeek: 1, endWeek: 10 };
            var ongoingMember = { characterId: 'c2', startWeek: 5, endWeek: null };
            var noStartMember = { characterId: 'c3', startWeek: null, endWeek: 20 };

            if (memberActiveInWeek(activeMember, 5) !== true) {
                missing.push('memberActiveInWeek missed an active week');
            }
            if (memberActiveInWeek(activeMember, 10) !== true) {
                missing.push('memberActiveInWeek failed on inclusive end');
            }
            if (memberActiveInWeek(activeMember, 11) !== false) {
                missing.push('memberActiveInWeek found a week past the end');
            }
            if (memberActiveInWeek(ongoingMember, 52) !== true) {
                missing.push('memberActiveInWeek missed an ongoing week');
            }
            if (memberActiveInWeek(noStartMember, 5) !== false) {
                missing.push('memberActiveInWeek accepted a null startWeek');
            }
            if (memberActiveInWeek(null, 5) !== false) {
                missing.push('memberActiveInWeek accepted a null member');
            }

            var activeGroup = { startWeek: 1, endWeek: 10 };
            var ongoingGroup = { startWeek: 5, endWeek: null };
            var noStartGroup = { startWeek: null, endWeek: 20 };

            if (groupActiveInWeek(activeGroup, 5) !== true) {
                missing.push('groupActiveInWeek missed an active week');
            }
            if (groupActiveInWeek(activeGroup, 11) !== false) {
                missing.push('groupActiveInWeek found a week past the end');
            }
            if (groupActiveInWeek(ongoingGroup, 52) !== true) {
                missing.push('groupActiveInWeek missed an ongoing week');
            }
            if (groupActiveInWeek(noStartGroup, 5) !== false) {
                missing.push('groupActiveInWeek accepted a null startWeek');
            }
            if (groupActiveInWeek(null, 5) !== false) {
                missing.push('groupActiveInWeek accepted a null group');
            }

            // Overlap predicate.
            if (memberIntervalsOverlap(
                { startWeek: 1, endWeek: 10 },
                { startWeek: 11, endWeek: 20 }
            ) !== false) {
                missing.push('memberIntervalsOverlap flagged disjoint');
            }
            if (memberIntervalsOverlap(
                { startWeek: 1, endWeek: 10 },
                { startWeek: 10, endWeek: 20 }
            ) !== true) {
                missing.push('memberIntervalsOverlap missed inclusive endpoint');
            }
            if (memberIntervalsOverlap(
                { startWeek: 1, endWeek: 10 },
                { startWeek: 5, endWeek: null }
            ) !== true) {
                missing.push('memberIntervalsOverlap missed open-ended overlap');
            }
            if (memberIntervalsOverlap(
                { startWeek: null, endWeek: 10 },
                { startWeek: 1, endWeek: 10 }
            ) !== false) {
                missing.push('memberIntervalsOverlap accepted a null startWeek');
            }
        } catch (e) {
            missing.push('range-wrapper smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingGroups] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
