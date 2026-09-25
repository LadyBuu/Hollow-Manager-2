/**
 * modules/academy/academy-teaching-groups.js - Academy Teaching Groups
 * SINGLE SOURCE OF TRUTH for teaching relationships AND group-number
 * allocation.
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
 *   Plus the ALLOCATOR that advances the sequence:
 *
 *     AcademyTeachingGroups.allocateGroupNumber(
 *       appData, classId, disciplineId, instructorId
 *     ) → integer
 *
 *   The allocator is the single source of truth for "how do group
 *   numbers advance." AcademySchedule calls it too; there is no
 *   second implementation.
 *
 * GROUP NUMBER ALLOCATION — THE SEQUENCE INVARIANT:
 *   For a given (classId, disciplineId, instructorId) triple, the
 *   sequence store holds the highest group number currently in use.
 *
 *     - allocateGroupNumber returns (stored + 1) and writes it.
 *     - renumberTeachingGroups reassigns 1..N to every group of the
 *       triple, then writes N to the sequence.
 *
 *   Because both operations maintain this invariant, the sequence
 *   never has to be recomputed from the group records. Every group
 *   in the triple has a groupNumber <= the sequence value, and
 *   every number in [1, sequence] belongs to some group — except
 *   after a delete, where compaction has not yet run.
 *
 *   GAPS ARE ALLOWED. Deleting a group does not decrement the
 *   sequence; the next group created gets the next number above the
 *   gap. The gap persists until the user runs renumberTeachingGroups,
 *   which is a deliberate user action, not an automatic side effect
 *   of delete.
 *
 *   WHY GAPS PERSIST:
 *     Group numbers are STABLE IDENTIFIERS as much as they are
 *     display labels. A user with "Group 2" on a printed roster, or
 *     a lesson plan that says "Group 3 meets at 10:00," expects
 *     those numbers to still mean the same group next week.
 *     Automatic renumbering after every delete would silently
 *     change what "Group 2" refers to. Explicit renumbering lets
 *     the user say "yes, I want the labels to close up now."
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Class-discipline windows      (AcademyClassDisciplines)
 *   - Student enrolment             (AcademyEnrolments)
 *   - Recurring meetings            (AcademyTeachingSessions)
 *   - Compound operations           (AcademySchedule)
 *
 * STORAGE NAMESPACE (v28):
 *   Teaching groups and their number sequences live at
 *   academy.teachingGroups and academy.teachingGroupSequences.
 *
 *   The discipline records that `createGroup` and other mutations
 *   validate against live at academy.disciplines. The legacy
 *   curriculum.disciplines location was retired; the snapshot
 *   validator reads from academy.disciplines and falls back to
 *   curriculum.disciplines only for pre-v28 snapshots loaded
 *   mid-transaction during an upgrade.
 *
 * HISTORICAL-RECORD PRINCIPLE:
 *   A group is a historical fact. Ending a member's participation
 *   sets their endWeek; it does NOT delete the member entry. Ending
 *   the group as a whole sets the group's endWeek. Deleting a group
 *   outright is reserved for administrative cleanup and for
 *   cascade deletes (class delete, discipline delete).
 *
 *   Clear Roster is the exception. See CLEAR ROSTER below.
 *
 * CLEAR ROSTER — HARD DELETE:
 *   clearGroupRoster(groupId) removes every member entry from the
 *   group. The member records are DELETED, not ended. No history
 *   survives.
 *
 *   This is a deliberate departure from the historical-record
 *   principle. The semantic is: "this assignment was a mistake and
 *   the records should not have existed." It matches the per-
 *   student Remove button in the group block header, which uses
 *   removeMemberRecord for the same reason.
 *
 *   Callers that want the interval-aware variant ("these students
 *   were in the group and left") should call endMembership per
 *   character. No bulk version of that exists today.
 *
 *   The group itself and its sessions are NOT touched. Only the
 *   members array is emptied.
 *
 * RENUMBERING — HARD REASSIGNMENT:
 *   renumberTeachingGroups(classId, disciplineId, instructorId)
 *   collects every group of the triple, sorts them, assigns 1..N
 *   in that order, and writes N to the sequence.
 *
 *   WHAT IT TOUCHES:
 *     - each group's groupNumber
 *     - the sequence value for the triple
 *
 *   WHAT IT DOES NOT TOUCH:
 *     - id, customName, members, startWeek, endWeek, createdAt,
 *       updatedAt (updatedAt is refreshed, other fields unchanged)
 *     - teachingSessions (sessions reference groupId, not
 *       groupNumber)
 *     - enrolments
 *     - anything outside the triple
 *
 *   SORT ORDER:
 *     Ascending groupNumber, then createdAt, then id. Groups whose
 *     groupNumber is missing or malformed sort last, ordered by
 *     createdAt and id. This preserves the user's existing mental
 *     order (the groups keep their relative positions) while
 *     closing gaps. A group that was #3 stays before the group
 *     that was #5; after renumbering they become #2 and #3.
 *
 *   SCOPING:
 *     One triple. Every group of the triple is renumbered
 *     independently of groups belonging to other instructors or
 *     other disciplines. This matches the sequence's per-triple
 *     key exactly.
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded [MIN_WEEK, MAX_WEEK].
 *   - startWeek and endWeek are integers in that range.
 *   - endWeek === null means "ongoing".
 *   - endWeek is INCLUSIVE.
 *
 * MEMBERSHIP INVARIANT — AT MOST ONE ACTIVE INTERVAL PER CHARACTER:
 *   A character has at most one interval per group that contains
 *   any given week. This is enforced at add time (addMemberToGroup
 *   rejects a new interval that would overlap an existing non-active
 *   interval) and at end time (endMembership rejects when the stored
 *   history contains more than one interval containing the effective
 *   week, which is a data-integrity failure rather than a normal
 *   state).
 *
 * RANGE PREDICATES:
 *   The "does this range contain this week" question is owned by
 *   window.RangeUtils. The two local helpers `memberActiveInWeek`
 *   and `groupActiveInWeek` are delegating wrappers.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the appData argument it is handed. It does not read window.data.
 *
 * CASCADE STRICTNESS:
 *   stripClassRefs, stripDisciplineRefs, stripInstructorRefs, and
 *   stripCharacterRefs operate on a destructive cascade. A missing
 *   or malformed group store on the snapshot is a data-integrity
 *   failure, not "no groups"; the helpers throw rather than silently
 *   reporting a zero-count success.
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
 *   AcademyTeachingGroups.renumberTeachingGroups(classId, disciplineId, instructorId)
 *       .then(...);
 *   AcademyTeachingGroups.addMemberToGroup(groupId, charId, week)
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
        return DEFAULT_GROUP_NAME_MAX_LENGTH;
    }

    // ============================================================
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================

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
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var target = String(disciplineId);

        // Primary: academy.disciplines
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

        // Legacy fallback: curriculum.disciplines
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

    function findConflictOnAdd(group, charId, weekNum) {
        if (!group || !Array.isArray(group.members)) { return null; }
        var target = String(charId);
        var proposed = { startWeek: weekNum, endWeek: null };

        for (var i = 0; i < group.members.length; i++) {
            var m = group.members[i];
            if (!m) { continue; }
            if (String(m.characterId) !== target) { continue; }

            if (memberActiveInWeek(m, weekNum)) {
                continue;
            }

            if (memberIntervalsOverlap(m, proposed)) {
                return m;
            }
        }
        return null;
    }

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
    // GROUP-NUMBER ALLOCATOR
    // ============================================================
    //
    // THE single source of truth for "how do group numbers
    // advance." AcademySchedule calls this too.
    //
    // The allocator operates on the appData SNAPSHOT the caller
    // hands it. It does not read window.data. This is what makes it
    // safe to call from inside a pipeline mutate() callback: the
    // sequence store is read and written on the same snapshot the
    // surrounding transaction is working on.
    //
    // INVARIANT:
    //   On return, sequence[key] === the number just returned, and
    //   that number is 1 more than whatever was stored before (or 1
    //   if the key was absent).
    //
    // MALFORMED SEQUENCE:
    //   A stored value that is not a non-negative integer is a data-
    //   integrity failure. The allocator throws rather than
    //   silently starting from 1, because starting from 1 would
    //   produce duplicate group numbers.
    //
    // THROWS:
    //   - when the appData snapshot is missing
    //   - when the sequence store is missing
    //   - when the stored value is malformed

    function allocateGroupNumber(
        appData,
        classId,
        disciplineId,
        instructorId
    ) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[AcademyTeachingGroups] allocateGroupNumber requires ' +
                'an appData snapshot.'
            );
        }
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(instructorId)) {
            throw new Error(
                '[AcademyTeachingGroups] allocateGroupNumber requires ' +
                'classId, disciplineId, and instructorId.'
            );
        }

        var seqStore = ensureSequenceStore(appData);
        var seqKey = makeSequenceKey(
            classId, disciplineId, instructorId
        );

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

    /**
     * Read-only preview of the next group number that would be
     * allocated, without advancing the sequence.
     *
     * Returns the integer, or null when the triple is malformed or
     * the sequence value is unreadable. Does NOT throw on a
     * malformed sequence; the caller sees null.
     */
    function peekNextGroupNumber(classId, disciplineId, instructorId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(instructorId)) {
            return null;
        }
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        var seqStore = window.data.academy.teachingGroupSequences;
        if (!isPlainObject(seqStore)) {
            return 1;
        }
        var seqKey = makeSequenceKey(
            classId, disciplineId, instructorId
        );
        var stored = seqStore[seqKey];
        if (stored === undefined) {
            return 1;
        }
        if (typeof stored !== 'number' ||
            !isFinite(stored) ||
            !Number.isInteger(stored) ||
            stored < 0) {
            return null;
        }
        return stored + 1;
    }

    /**
     * Read-only view of the stored sequence value for a triple.
     * Returns 0 when the key is absent, or null when the stored
     * value is malformed or the input is invalid.
     */
    function getGroupNumberSequence(classId, disciplineId, instructorId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(instructorId)) {
            return null;
        }
        if (!window.data || typeof window.data !== 'object') {
            return 0;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return 0;
        }
        var seqStore = window.data.academy.teachingGroupSequences;
        if (!isPlainObject(seqStore)) {
            return 0;
        }
        var seqKey = makeSequenceKey(
            classId, disciplineId, instructorId
        );
        var stored = seqStore[seqKey];
        if (stored === undefined) {
            return 0;
        }
        if (typeof stored !== 'number' ||
            !isFinite(stored) ||
            !Number.isInteger(stored) ||
            stored < 0) {
            return null;
        }
        return stored;
    }

    // ============================================================
    // SORT FOR RENUMBER
    // ============================================================
    //
    // Ascending groupNumber, then createdAt, then id.
    //
    // Malformed groupNumbers (missing, non-integer, negative) sort
    // last. Among groups with malformed numbers, sort by createdAt
    // and id, so a group that was created before another still
    // comes first.

    function compareForRenumber(a, b) {
        var aNum = (typeof a.groupNumber === 'number' &&
                    isFinite(a.groupNumber) &&
                    Number.isInteger(a.groupNumber) &&
                    a.groupNumber > 0)
            ? a.groupNumber
            : null;
        var bNum = (typeof b.groupNumber === 'number' &&
                    isFinite(b.groupNumber) &&
                    Number.isInteger(b.groupNumber) &&
                    b.groupNumber > 0)
            ? b.groupNumber
            : null;

        if (aNum !== null && bNum !== null && aNum !== bNum) {
            return aNum - bNum;
        }
        if (aNum !== null && bNum === null) { return -1; }
        if (aNum === null && bNum !== null) { return 1; }

        var aCreated = isNonEmptyString(a.createdAt) ? a.createdAt : '';
        var bCreated = isNonEmptyString(b.createdAt) ? b.createdAt : '';
        if (aCreated !== bCreated) {
            return aCreated < bCreated ? -1 : 1;
        }
        return String(a.id).localeCompare(String(b.id));
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
    // MUTATIONS
    // ============================================================

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

        var newGroupId = IdUtils.generateId('tgroup');

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

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

                var nextNumber = allocateGroupNumber(
                    appData,
                    targetClass,
                    targetDiscipline,
                    targetInstructor
                );

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
     * Renumber every group of a (classId, disciplineId, instructorId)
     * triple to 1..N, and set the sequence value to N.
     *
     * See the file header, RENUMBERING — HARD REASSIGNMENT, for what
     * this touches and what it does not.
     *
     * The mutation does not require any of the groups to exist
     * pre-flight. A triple with no groups produces a successful
     * no-op that ALSO writes the sequence to 0 (so future
     * createGroup calls start at 1). That is a legitimate use: it
     * resets a triple's numbering to a known baseline.
     *
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function renumberTeachingGroups(classId, disciplineId, instructorId) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }
        if (!isNonEmptyString(instructorId)) {
            return Promise.resolve(failure('Instructor ID is required.'));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var targetInstructor = String(instructorId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
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

                if (!findCharacterInSnapshot(appData, targetInstructor)) {
                    return {
                        valid: false,
                        message: 'Instructor no longer exists.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var groupStore = ensureGroupStore(appData);
                var seqStore = ensureSequenceStore(appData);

                // ---- Collect the triple's groups ----
                //
                // We work on LIVE references from the snapshot's
                // group store, so the assignment below mutates the
                // store in place. That is what the pipeline expects
                // from a mutate callback.

                var targets = [];
                var keys = Object.keys(groupStore);

                for (var i = 0; i < keys.length; i++) {
                    var g = groupStore[keys[i]];
                    if (!isPlainObject(g)) { continue; }
                    if (String(g.classId) !== targetClass) { continue; }
                    if (String(g.disciplineId) !== targetDiscipline) {
                        continue;
                    }
                    if (String(g.instructorId) !== targetInstructor) {
                        continue;
                    }
                    targets.push(g);
                }

                if (targets.length === 0) {
                    // No groups. Reset the sequence so the next
                    // createGroup for this triple starts at 1.
                    var seqKey0 = makeSequenceKey(
                        targetClass, targetDiscipline, targetInstructor
                    );
                    seqStore[seqKey0] = 0;
                    return {
                        groupsRenumbered: 0,
                        highestNumber: 0
                    };
                }

                // ---- Sort and reassign ----

                targets.sort(compareForRenumber);

                var renumberMap = [];
                var nowIso = new Date().toISOString();

                for (var j = 0; j < targets.length; j++) {
                    var group = targets[j];
                    var newNumber = j + 1;
                    var oldNumber = (typeof group.groupNumber === 'number')
                        ? group.groupNumber
                        : null;
                    if (group.groupNumber !== newNumber) {
                        group.groupNumber = newNumber;
                        group.updatedAt = nowIso;
                        renumberMap.push({
                            groupId: String(group.id),
                            oldNumber: oldNumber,
                            newNumber: newNumber
                        });
                    }
                }

                // ---- Write the sequence ----
                //
                // After renumbering, the highest group number in use
                // is N (targets.length). The next allocateGroupNumber
                // call must therefore return N + 1.

                var seqKey = makeSequenceKey(
                    targetClass, targetDiscipline, targetInstructor
                );
                seqStore[seqKey] = targets.length;

                return {
                    groupsRenumbered: targets.length,
                    groupsChanged: renumberMap.length,
                    highestNumber: targets.length,
                    renumberMap: renumberMap
                };
            },

            logMessage: function(result) {
                if (result.groupsChanged === 0) {
                    return 'Renumbered groups for ' +
                        targetDiscipline + ' / ' + targetInstructor +
                        ' (already contiguous)';
                }
                return 'Renumbered ' + result.groupsRenumbered +
                    ' group(s) for ' + targetDiscipline + ' / ' +
                    targetInstructor +
                    ' (' + result.groupsChanged + ' changed)';
            },

            successMessage: function(result) {
                if (result.groupsRenumbered === 0) {
                    return 'No groups to renumber.';
                }
                if (result.groupsChanged === 0) {
                    return 'Group numbers are already contiguous.';
                }
                return 'Renumbered ' + result.groupsRenumbered +
                    ' group' +
                    (result.groupsRenumbered === 1 ? '' : 's') + '.';
            },

            failureMessage: 'Failed to renumber groups.'
        });
    }

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

                var snapshotGroup = getGroupFromSnapshot(appData, targetGroup);
                if (!snapshotGroup) {
                    return {
                        valid: false,
                        message: 'Teaching group no longer exists.'
                    };
                }

                if (!findCharacterInSnapshot(appData, targetChar)) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

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
     * Clear the group's roster. Removes every member entry from the
     * group.
     *
     * HARD DELETE SEMANTIC:
     *   The member records are removed entirely. No history
     *   survives. This matches the per-student Remove button in
     *   the group block header, which calls removeMemberRecord.
     *
     *   The intent is correction: "this assignment was a mistake
     *   and the records should not have existed." Callers that
     *   want the interval-aware variant ("these students were in
     *   the group and left") should call endMembership per
     *   character. No bulk version of that exists today.
     *
     * THE GROUP AND ITS SESSIONS ARE NOT TOUCHED:
     *   Only the members array is emptied. The group record, its
     *   startWeek / endWeek, its customName, its groupNumber, and
     *   every teaching session owned by it are unchanged.
     *
     * IDEMPOTENT:
     *   A group with an empty members array is a successful no-op.
     *   The result reports removed: 0.
     *
     * @param {string} groupId
     * @returns {Promise<{ success, data?: { removed: number }, message? }>}
     */
    function clearGroupRoster(groupId) {
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
                    throw new Error('Teaching group not found in store.');
                }
                var group = store[targetGroup];

                if (!Array.isArray(group.members)) {
                    group.members = [];
                    return { removed: 0 };
                }

                var removed = group.members.length;
                group.members = [];

                if (removed > 0) {
                    group.updatedAt = new Date().toISOString();
                }

                return { removed: removed };
            },
            logMessage: function(result) {
                return 'Cleared ' + (result && result.removed
                    ? result.removed : 0) +
                    ' member(s) from teaching group ' + targetGroup;
            },
            successMessage: function(result) {
                var n = result && result.removed ? result.removed : 0;
                if (n === 0) {
                    return 'The group already has no students.';
                }
                return 'Removed ' + n + ' student' +
                    (n === 1 ? '' : 's') + ' from the group.';
            },
            failureMessage: 'Failed to clear the group roster.'
        });
    }

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

        // Group-number allocation (public for AcademySchedule)
        allocateGroupNumber: allocateGroupNumber,
        peekNextGroupNumber: peekNextGroupNumber,
        getGroupNumberSequence: getGroupNumberSequence,

        // Mutations
        createGroup: createGroup,
        renumberTeachingGroups: renumberTeachingGroups,
        addMemberToGroup: addMemberToGroup,
        endMembership: endMembership,
        removeMemberRecord: removeMemberRecord,
        clearGroupRoster: clearGroupRoster,
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
            'allocateGroupNumber', 'peekNextGroupNumber',
            'getGroupNumberSequence',
            'createGroup', 'renumberTeachingGroups',
            'addMemberToGroup', 'endMembership',
            'removeMemberRecord', 'clearGroupRoster', 'endGroup',
            'setGroupCustomName', 'removeGroupRecord',
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
            console.warn(
                '[AcademyTeachingGroups] Verification missing:',
                missing.join(', ')
            );
        }

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

            // Allocator smoke test on a synthetic snapshot.
            var snap = { academy: { teachingGroupSequences: {} } };
            var n1 = allocateGroupNumber(snap, 'c', 'd', 'i');
            var n2 = allocateGroupNumber(snap, 'c', 'd', 'i');
            var n3 = allocateGroupNumber(snap, 'c', 'd', 'i');
            if (n1 !== 1 || n2 !== 2 || n3 !== 3) {
                missing.push(
                    'allocateGroupNumber did not produce 1,2,3 ' +
                    '(got ' + n1 + ',' + n2 + ',' + n3 + ')'
                );
            }

            // Renumber's sort order.
            var sorted = [
                { id: 'g3', groupNumber: 3, createdAt: '2024-01-03' },
                { id: 'g1', groupNumber: 1, createdAt: '2024-01-01' },
                { id: 'g5', groupNumber: 5, createdAt: '2024-01-05' },
                { id: 'gX', groupNumber: null, createdAt: '2024-01-02' }
            ].sort(compareForRenumber);

            if (sorted[0].id !== 'g1' ||
                sorted[1].id !== 'g3' ||
                sorted[2].id !== 'g5' ||
                sorted[3].id !== 'gX') {
                missing.push(
                    'compareForRenumber did not sort as expected'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingGroups] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
