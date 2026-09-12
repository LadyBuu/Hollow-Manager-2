/**
 * modules/academy/academy-groups.js - Academy Groups
 * CANONICAL source of truth for auto-group MUTATIONS.
 *
 * This module provides:
 *   - Group mutations (create, delete)
 *   - Student membership mutations (add, remove, bulk)
 *   - Slot mutations (add, remove, bulk)
 *   - Bulk cleanup (delete all groups for instructor / discipline)
 *   - Candidate builders for MutationPipeline (advanced callers)
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module owns auto-group MUTATIONS only.
 *   - READS are owned by AcademyQueries. This module does not
 *     re-implement reads; the legacy read functions below are thin
 *     aliases that delegate to AcademyQueries and are kept only for
 *     backward compatibility. New code should call AcademyQueries.
 *   - Uses LAZY LOADING to break circular dependencies.
 *   - All PUBLIC mutations go through MutationPipeline. The pipeline
 *     owns persistence, rollback, and activity logging.
 *   - Candidate builders are still exported for callers that need to
 *     run their own transaction (e.g. cascade deletes). They are
 *     pure: they compute the closure but do not run it. The closure
 *     takes an `appData` argument and expects to run INSIDE a pipeline
 *     mutate() callback.
 *   - This module does NOT call saveData() directly.
 *
 * STATUS MATCHING:
 *   - CharacterQueries.getCurrentStatus returns TITLE-CASE values
 *     ('Instructor', 'Trainee', 'Junior', ...).
 *   - CharacterConstants.isInstructorStatus / isStudentStatus accept
 *     any casing and do the lowercase comparison internally.
 *   - When CharacterConstants is loaded, this module delegates to it.
 *   - The local fallback lists are lowercase and the comparison
 *     lowercases the incoming status before matching.
 *
 * MUTATION CONTRACT:
 *   - All public mutations return Promise<{ success, data?, message? }>
 *   - The candidate builders return { success, data: { mutate, ... } }
 *     synchronously; the caller owns the transaction.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   A character can be referenced in autoGroups two ways:
 *     - As the instructor (group.instructorId === charId). Groups
 *       with a deleted instructor are removed entirely.
 *     - As a student (group.students includes charId). The student
 *       is removed from the array. Groups left with no students and
 *       no slots are pruned.
 *   This helper is called by CharacterCRUD.deleteCharacter from
 *   inside its pipeline mutate, so it runs in the same transaction
 *   as the character removal.
 *
 * DATA STORE CONTRACT:
 *   - window.data.curriculum.autoGroups is the source of truth.
 *   - Shape:
 *       autoGroups = {
 *         [groupKey]: {
 *           id, disciplineId, instructorId, displayName,
 *           students: [charId, ...],
 *           slots: [{ week, day, hour, duration, label }],
 *           createdAt
 *         }
 *       }
 *   - groupKey is conventionally `disciplineId + '_' + instructorId`.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.ObjectUtils - MANDATORY
 *   - window.IdUtils - MANDATORY
 *   - window.CharacterQueries - MANDATORY
 *   - window.DisciplineQueries - MANDATORY
 *   - window.CalendarValidation - MANDATORY
 *   - window.CalendarConstants - MANDATORY
 *   - window.MutationPipeline - MANDATORY
 *   - window.CharacterConstants - OPTIONAL (preferred for status checks)
 *   - window.AcademyQueries - LAZY (for read aliases only)
 *
 * USAGE:
 *   var groups = window.AcademyGroups;
 *
 *   // Mutations (Promise-based)
 *   groups.createGroup(disciplineId, instructorId)
 *       .then(function(result) { ... });
 *
 *   // Advanced: run the mutation inside your own transaction
 *   var candidate = groups.buildCreateGroupCandidate(disciplineId, instructorId);
 *   if (candidate.success) {
 *       MutationPipeline.performMutation({
 *           validate: function() { return { valid: true }; },
 *           mutate: function(appData) { return candidate.data.mutate(appData); },
 *           // ...
 *       });
 *   }
 */

(function() {
    'use strict';

    if (window.__academyGroupsLoaded) {
        return;
    }
    window.__academyGroupsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    function getMutationPipeline() {
        return window.MutationPipeline || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getObjectUtils()) {
            missing.push('ObjectUtils');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getDisciplineQueries()) {
            missing.push('DisciplineQueries');
        }
        if (!getCalendarValidation()) {
            missing.push('CalendarValidation');
        }
        if (!getCalendarConstants()) {
            missing.push('CalendarConstants');
        }
        if (!getMutationPipeline()) {
            missing.push('MutationPipeline');
        }

        if (!getAcademyQueries()) {
            missing.push('AcademyQueries (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[AcademyGroups] Some dependencies not yet loaded:', missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function generateId(prefix) {
        var IdUtils = getIdUtils();
        if (IdUtils && typeof IdUtils.generateId === 'function') {
            return IdUtils.generateId(prefix);
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getAutoGroupsStore() {
        if (!window.data || typeof window.data !== 'object') {
            return {};
        }
        if (!window.data.curriculum || typeof window.data.curriculum !== 'object') {
            return {};
        }
        var store = window.data.curriculum.autoGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return {};
        }
        return store;
    }

    /**
     * Ensure the autoGroups store exists on the given appData object.
     * This is the ONLY place in the module that creates structure.
     * Called from inside pipeline mutate callbacks.
     */
    function ensureAutoGroupsStore(appData) {
        if (!appData.curriculum || typeof appData.curriculum !== 'object') {
            appData.curriculum = {};
        }
        if (!appData.curriculum.autoGroups ||
            typeof appData.curriculum.autoGroups !== 'object' ||
            Array.isArray(appData.curriculum.autoGroups)) {
            appData.curriculum.autoGroups = {};
        }
        return appData.curriculum.autoGroups;
    }

    // ============================================================
    // STATUS CLASSIFIERS
    // ============================================================
    //
    // CharacterQueries.getCurrentStatus returns TITLE-CASE values
    // ('Instructor', 'Trainee', ...). We need to classify them without
    // hard-coding a list that can drift from CharacterConstants.
    //
    // Preferred path: CharacterConstants.isInstructorStatus /
    // isStudentStatus (they already lowercase internally).
    // Fallback path: local list, lowercased before comparison.

    var LOCAL_INSTRUCTOR_STATUSES = ['instructor', 'teacher', 'professor', 'senior'];
    var LOCAL_STUDENT_STATUSES = ['trainee', 'rookie', 'junior', 'student'];

    function isInstructorStatus(status) {
        if (!isNonEmptyString(status)) {
            return false;
        }

        var CC = getCharacterConstants();
        if (CC && typeof CC.isInstructorStatus === 'function') {
            return CC.isInstructorStatus(status) === true;
        }

        return LOCAL_INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function isStudentStatus(status) {
        if (!isNonEmptyString(status)) {
            return false;
        }

        var CC = getCharacterConstants();
        if (CC && typeof CC.isStudentStatus === 'function') {
            return CC.isStudentStatus(status) === true;
        }

        return LOCAL_STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    // ============================================================
    // VALIDATION - Uses lazy-loaded queries for reads
    // ============================================================

    function validateGroupKey(key) {
        if (!isNonEmptyString(key)) {
            return { valid: false, message: 'Group key is required.' };
        }
        return { valid: true, key: key };
    }

    function validateDisciplineId(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return { valid: false, message: 'Discipline queries not available.' };
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, discipline: discipline };
    }

    function validateInstructorId(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return { valid: false, message: 'Instructor ID is required.' };
        }
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return { valid: false, message: 'Character queries not available.' };
        }
        var instructor = CharacterQueries.getCharacterById(instructorId);
        if (!instructor) {
            return { valid: false, message: 'Instructor not found.' };
        }
        var status = CharacterQueries.getCurrentStatus(instructor);
        if (!isInstructorStatus(status)) {
            return { valid: false, message: 'Character is not an instructor.' };
        }
        return { valid: true, instructor: instructor };
    }

    function validateStudentId(studentId) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return { valid: false, message: 'Character queries not available.' };
        }
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return { valid: false, message: 'Student not found.' };
        }
        var status = CharacterQueries.getCurrentStatus(student);
        if (!isStudentStatus(status)) {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateStudentIds(studentIds) {
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return { valid: false, message: 'At least one student ID is required.' };
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return { valid: false, message: 'Character queries not available.' };
        }

        var validated = [];
        var errors = [];

        for (var i = 0; i < studentIds.length; i++) {
            var result = validateStudentId(studentIds[i]);
            if (!result.valid) {
                errors.push(result.message);
            } else {
                validated.push({
                    studentId: studentIds[i],
                    student: result.student
                });
            }
        }

        if (errors.length > 0) {
            return { valid: false, message: errors.join('; ') };
        }

        return { valid: true, students: validated };
    }

    function slotsOverlap(slot1, slot2) {
        if (slot1.week !== slot2.week) {
            return false;
        }
        if (slot1.day !== slot2.day) {
            return false;
        }
        var s1Start = slot1.hour;
        var s1End = slot1.hour + slot1.duration;
        var s2Start = slot2.hour;
        var s2End = slot2.hour + slot2.duration;
        return s1Start < s2End && s2Start < s1End;
    }

    function hasSlotOverlap(newSlot, existingSlots) {
        for (var i = 0; i < existingSlots.length; i++) {
            if (slotsOverlap(newSlot, existingSlots[i])) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // INTERNAL READS - Direct store access for mutations
    // ============================================================
    // Used by candidate builders to validate preconditions. These
    // read the LIVE store, not a snapshot. That's intentional: the
    // candidate builder is a pre-flight check. The pipeline's
    // validate() callback re-checks against the snapshot.

    function getGroupFromStore(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var store = getAutoGroupsStore();
        return store[key] || null;
    }

    function getStudentIdsFromStore(key) {
        var group = getGroupFromStore(key);
        if (!group || !Array.isArray(group.students)) {
            return [];
        }
        return group.students.slice();
    }

    function getSlotsFromStore(key) {
        var group = getGroupFromStore(key);
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        return group.slots.map(function(slot) { return deepClone(slot); });
    }

    function isStudentInGroupStore(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId)) {
            return false;
        }
        var students = getStudentIdsFromStore(key);
        var target = String(studentId);
        for (var i = 0; i < students.length; i++) {
            if (String(students[i]) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // CANDIDATE BUILDERS - For MutationPipeline
    // ============================================================
    //
    // Each builder returns { success: true, data: { mutate, ... } }.
    // The `mutate` closure takes an `appData` argument and is designed
    // to run INSIDE a pipeline mutate() callback. It does NOT reach
    // into window.data directly.

    function buildCreateGroupCandidate(disciplineId, instructorId) {
        var discResult = validateDisciplineId(disciplineId);
        if (!discResult.valid) {
            return failure(discResult.message);
        }

        var instResult = validateInstructorId(instructorId);
        if (!instResult.valid) {
            return failure(instResult.message);
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return failure('Character queries not available.');
        }

        var groupKey = String(disciplineId) + '_' + String(instructorId);

        var existing = getGroupFromStore(groupKey);
        if (existing) {
            return failure('Group already exists for this discipline and instructor.');
        }

        var instructorName = CharacterQueries.getDisplayName(instResult.instructor);
        var shortInstructor = instructorName;
        var parts = instructorName.split(' ');
        if (parts.length >= 2) {
            shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
        }

        var newGroup = {
            id: groupKey,
            disciplineId: String(disciplineId),
            instructorId: String(instructorId),
            displayName: discResult.discipline.name + ' (' + shortInstructor + ')',
            students: [],
            slots: [],
            createdAt: new Date().toISOString()
        };

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            store[groupKey] = deepClone(newGroup);
            return { group: deepClone(newGroup) };
        }

        return success({
            mutate: mutate,
            group: newGroup,
            groupKey: groupKey
        });
    }

    function buildDeleteGroupCandidate(key) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        var displayName = group.displayName || key;

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            if (!store[key]) {
                return { deleted: false };
            }
            delete store[key];
            return { deleted: true };
        }

        return success({
            mutate: mutate,
            displayName: displayName
        });
    }

    function buildAddStudentCandidate(key, studentId) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return failure(studentResult.message);
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (isStudentInGroupStore(key, studentId)) {
            return failure('Student is already in this group.');
        }

        var CharacterQueries = getCharacterQueries();
        var studentName = CharacterQueries ? CharacterQueries.getDisplayName(studentResult.student) : 'Unknown';

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup) {
                return { added: false };
            }
            if (!Array.isArray(candidateGroup.students)) {
                candidateGroup.students = [];
            }
            candidateGroup.students.push(String(studentId));
            candidateGroup.students.sort();
            return { added: true };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            groupName: group.displayName || key
        });
    }

    function buildRemoveStudentCandidate(key, studentId) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!isStudentInGroupStore(key, studentId)) {
            return failure('Student is not in this group.');
        }

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: false };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return String(id) !== String(studentId);
            });

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete store[key];
            }

            return { removed: true };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            groupName: group.displayName || key
        });
    }

    function buildAddSlotCandidate(key, week, day, hour, duration, label) {
        var CalendarConstants = getCalendarConstants();
        var CalendarValidation = getCalendarValidation();

        if (!CalendarConstants || !CalendarValidation) {
            return failure('Calendar constants or validation not available.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + CalendarConstants.MIN_DAY + '-' + CalendarConstants.MAX_DAY + ').');
        }

        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + CalendarConstants.MIN_HOUR + '-' + CalendarConstants.MAX_HOUR + ').');
        }

        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between ' + CalendarConstants.MIN_CLASS_DURATION + ' and ' + CalendarConstants.MAX_CLASS_DURATION + ' hours.');
        }

        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        var slots = getSlotsFromStore(key);

        var newSlot = {
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || ''
        };

        if (hasSlotOverlap(newSlot, slots)) {
            return failure('Slot overlaps with an existing slot in this group.');
        }

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup) {
                return { added: false };
            }
            if (!Array.isArray(candidateGroup.slots)) {
                candidateGroup.slots = [];
            }

            candidateGroup.slots.push(deepClone(newSlot));
            candidateGroup.slots.sort(function(a, b) {
                if (a.week !== b.week) return a.week - b.week;
                if (a.day !== b.day) return a.day - b.day;
                return a.hour - b.hour;
            });

            return { added: true };
        }

        return success({
            mutate: mutate,
            slot: newSlot,
            groupName: group.displayName || key
        });
    }

    function buildRemoveSlotCandidate(key, week, day, hour) {
        var CalendarConstants = getCalendarConstants();
        var CalendarValidation = getCalendarValidation();

        if (!CalendarConstants || !CalendarValidation) {
            return failure('Calendar constants or validation not available.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + CalendarConstants.MIN_DAY + '-' + CalendarConstants.MAX_DAY + ').');
        }

        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + CalendarConstants.MIN_HOUR + '-' + CalendarConstants.MAX_HOUR + ').');
        }

        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        var slots = getSlotsFromStore(key);
        if (!Array.isArray(slots) || slots.length === 0) {
            return failure('Group has no slots.');
        }

        var slotIndex = -1;
        var slotData = null;
        for (var i = 0; i < slots.length; i++) {
            var s = slots[i];
            if (s.week === weekNum && s.day === dayNum && s.hour === hourNum) {
                slotIndex = i;
                slotData = s;
                break;
            }
        }

        if (slotIndex === -1) {
            return failure('Slot not found in group.');
        }

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.slots)) {
                return { removed: false };
            }

            candidateGroup.slots.splice(slotIndex, 1);

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete store[key];
            }

            return { removed: true };
        }

        return success({
            mutate: mutate,
            slot: slotData,
            groupName: group.displayName || key
        });
    }

    function buildAddStudentsCandidate(key, studentIds) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var studentValidation = validateStudentIds(studentIds);
        if (!studentValidation.valid) {
            return failure(studentValidation.message);
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        var existingStudents = getStudentIdsFromStore(key);
        var newStudents = [];
        var alreadyInGroup = [];

        for (var i = 0; i < studentValidation.students.length; i++) {
            var s = studentValidation.students[i];
            var isExisting = false;
            for (var j = 0; j < existingStudents.length; j++) {
                if (String(existingStudents[j]) === String(s.studentId)) {
                    isExisting = true;
                    break;
                }
            }
            if (isExisting) {
                alreadyInGroup.push(s.studentId);
            } else {
                newStudents.push(s);
            }
        }

        if (newStudents.length === 0) {
            return failure('All specified students are already in this group.');
        }

        var CharacterQueries = getCharacterQueries();
        var studentNames = newStudents.map(function(s) {
            return CharacterQueries ? CharacterQueries.getDisplayName(s.student) : 'Unknown';
        });

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup) {
                return { added: 0 };
            }
            if (!Array.isArray(candidateGroup.students)) {
                candidateGroup.students = [];
            }

            for (var i = 0; i < newStudents.length; i++) {
                candidateGroup.students.push(String(newStudents[i].studentId));
            }
            candidateGroup.students.sort();

            return { added: newStudents.length };
        }

        return success({
            mutate: mutate,
            added: newStudents.length,
            students: newStudents.map(function(s) { return s.studentId; }),
            studentNames: studentNames,
            alreadyInGroup: alreadyInGroup,
            groupName: group.displayName || key
        });
    }

    function buildRemoveStudentsCandidate(key, studentIds) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var group = getGroupFromStore(key);
        if (!group) {
            return failure('Group not found.');
        }

        var existingStudents = getStudentIdsFromStore(key);
        if (!Array.isArray(existingStudents) || existingStudents.length === 0) {
            return failure('Group has no students.');
        }

        var removedStudents = [];
        var notInGroup = [];

        for (var i = 0; i < studentIds.length; i++) {
            var sid = studentIds[i];
            var isInGroup = false;
            for (var j = 0; j < existingStudents.length; j++) {
                if (String(existingStudents[j]) === String(sid)) {
                    isInGroup = true;
                    break;
                }
            }
            if (isInGroup) {
                removedStudents.push(sid);
            } else {
                notInGroup.push(sid);
            }
        }

        if (removedStudents.length === 0) {
            return failure('No specified students are in this group.');
        }

        var removedSet = {};
        for (var k = 0; k < removedStudents.length; k++) {
            removedSet[String(removedStudents[k])] = true;
        }

        function mutate(appData) {
            var store = ensureAutoGroupsStore(appData);
            var candidateGroup = store[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: 0 };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return !removedSet[String(id)];
            });

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete store[key];
            }

            return { removed: removedStudents.length };
        }

        return success({
            mutate: mutate,
            removed: removedStudents.length,
            students: removedStudents,
            notInGroup: notInGroup,
            groupName: group.displayName || key
        });
    }

    function buildDeleteAllForInstructorCandidate(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var store = getAutoGroupsStore();
        var target = String(instructorId);
        var keysToRemove = [];

        for (var key in store) {
            if (Object.prototype.hasOwnProperty.call(store, key)) {
                var group = store[key];
                if (group && String(group.instructorId) === target) {
                    keysToRemove.push(key);
                }
            }
        }

        if (keysToRemove.length === 0) {
            return failure('No groups found for this instructor.');
        }

        function mutate(appData) {
            var candidateStore = ensureAutoGroupsStore(appData);
            var removed = 0;
            for (var i = 0; i < keysToRemove.length; i++) {
                if (candidateStore[keysToRemove[i]]) {
                    delete candidateStore[keysToRemove[i]];
                    removed++;
                }
            }
            return { removed: removed, keys: keysToRemove.slice() };
        }

        return success({
            mutate: mutate,
            count: keysToRemove.length,
            keys: keysToRemove.slice()
        });
    }

    function buildDeleteAllForDisciplineCandidate(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var store = getAutoGroupsStore();
        var target = String(disciplineId);
        var keysToRemove = [];

        for (var key in store) {
            if (Object.prototype.hasOwnProperty.call(store, key)) {
                var group = store[key];
                if (group && String(group.disciplineId) === target) {
                    keysToRemove.push(key);
                }
            }
        }

        if (keysToRemove.length === 0) {
            return failure('No groups found for this discipline.');
        }

        function mutate(appData) {
            var candidateStore = ensureAutoGroupsStore(appData);
            var removed = 0;
            for (var i = 0; i < keysToRemove.length; i++) {
                if (candidateStore[keysToRemove[i]]) {
                    delete candidateStore[keysToRemove[i]];
                    removed++;
                }
            }
            return { removed: removed, keys: keysToRemove.slice() };
        }

        return success({
            mutate: mutate,
            count: keysToRemove.length,
            keys: keysToRemove.slice()
        });
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    /**
     * Strip all references to a character from curriculum.autoGroups.
     *
     * A character can be referenced two ways:
     *   - As the instructor of a group (group.instructorId === charId).
     *     Groups with a deleted instructor are removed entirely, since
     *     there's no way to render or use them.
     *   - As a member of a group (group.students includes charId).
     *     Members are removed from the students list, but the group
     *     survives. Groups left with no students and no slots are
     *     pruned (same rule as removeStudentFromGroup's mutate).
     *
     * This helper is PURE with respect to `appData`: it mutates the
     * store, but it does not touch `window.data`. It is designed to be
     * called from inside a pipeline mutate() callback in another
     * module's transaction. It never throws.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID to strip
     * @returns {object} { instructorGroupsRemoved, studentMembershipsRemoved }
     */
    function stripCharacterRefs(appData, charId) {
        var result = {
            instructorGroupsRemoved: 0,
            studentMembershipsRemoved: 0
        };

        if (!appData || !charId) {
            return result;
        }

        if (!appData.curriculum || typeof appData.curriculum !== 'object') {
            return result;
        }

        var store = appData.curriculum.autoGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(charId);
        var keysToRemove = [];

        Object.keys(store).forEach(function(key) {
            var group = store[key];
            if (!group) {
                return;
            }

            // ---- Instructor reference: remove the whole group ----
            if (group.instructorId && String(group.instructorId) === target) {
                keysToRemove.push(key);
                result.instructorGroupsRemoved++;
                return;
            }

            // ---- Student reference: remove from students list ----
            if (Array.isArray(group.students)) {
                var before = group.students.length;
                group.students = group.students.filter(function(id) {
                    return String(id) !== target;
                });
                var removed = before - group.students.length;
                if (removed > 0) {
                    result.studentMembershipsRemoved += removed;

                    var hasStudents = group.students.length > 0;
                    var hasSlots = Array.isArray(group.slots) && group.slots.length > 0;
                    if (!hasStudents && !hasSlots) {
                        keysToRemove.push(key);
                    }
                }
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete store[keysToRemove[i]];
        }

        return result;
    }

    // ============================================================
    // MUTATION PIPELINE WRAPPER
    // ============================================================

    /**
     * Run a candidate's mutate closure inside a MutationPipeline
     * transaction. Handles dependency check and error wrapping.
     */
    function runCandidate(candidate, options) {
        if (!candidate || !candidate.success) {
            return Promise.resolve(candidate || failure('Candidate build failed.'));
        }

        var MutationPipeline = getMutationPipeline();
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            return Promise.resolve(failure('MutationPipeline is not available.'));
        }

        options = options || {};

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                return candidate.data.mutate(appData);
            },
            logMessage: options.logMessage || 'Auto-group mutation',
            successMessage: options.successMessage || 'Operation completed successfully.',
            failureMessage: options.failureMessage || 'Operation failed.'
        });
    }

    // ============================================================
    // PUBLIC MUTATION API - Promise-based
    // ============================================================

    function createGroup(disciplineId, instructorId) {
        var candidate = buildCreateGroupCandidate(disciplineId, instructorId);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Created auto-group: ' + (candidate.data.group.displayName || candidate.data.groupKey),
            successMessage: 'Group created successfully!',
            failureMessage: 'Failed to create group.'
        });
    }

    function deleteGroup(key) {
        var candidate = buildDeleteGroupCandidate(key);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Deleted auto-group: ' + (candidate.data.displayName || key),
            successMessage: 'Group deleted successfully!',
            failureMessage: 'Failed to delete group.'
        });
    }

    function addStudentToGroup(key, studentId) {
        var candidate = buildAddStudentCandidate(key, studentId);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Added ' + (candidate.data.studentName || candidate.data.studentId) + ' to ' + (candidate.data.groupName || key),
            successMessage: 'Student added to group.',
            failureMessage: 'Failed to add student.'
        });
    }

    function removeStudentFromGroup(key, studentId) {
        var candidate = buildRemoveStudentCandidate(key, studentId);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Removed student from ' + (candidate.data.groupName || key),
            successMessage: 'Student removed from group.',
            failureMessage: 'Failed to remove student.'
        });
    }

    function addSlotToGroup(key, week, day, hour, duration, label) {
        var candidate = buildAddSlotCandidate(key, week, day, hour, duration, label);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Added slot to ' + (candidate.data.groupName || key),
            successMessage: 'Slot added to group.',
            failureMessage: 'Failed to add slot.'
        });
    }

    function removeSlotFromGroup(key, week, day, hour) {
        var candidate = buildRemoveSlotCandidate(key, week, day, hour);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Removed slot from ' + (candidate.data.groupName || key),
            successMessage: 'Slot removed from group.',
            failureMessage: 'Failed to remove slot.'
        });
    }

    function addStudentsToGroup(key, studentIds) {
        var candidate = buildAddStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Added ' + candidate.data.added + ' student(s) to ' + (candidate.data.groupName || key),
            successMessage: 'Students added to group.',
            failureMessage: 'Failed to add students.'
        });
    }

    function removeStudentsFromGroup(key, studentIds) {
        var candidate = buildRemoveStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Removed ' + candidate.data.removed + ' student(s) from ' + (candidate.data.groupName || key),
            successMessage: 'Students removed from group.',
            failureMessage: 'Failed to remove students.'
        });
    }

    function deleteAllGroupsForInstructor(instructorId) {
        var candidate = buildDeleteAllForInstructorCandidate(instructorId);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Deleted ' + candidate.data.count + ' group(s) for instructor ' + instructorId,
            successMessage: 'Instructor groups deleted.',
            failureMessage: 'Failed to delete instructor groups.'
        });
    }

    function deleteAllGroupsForDiscipline(disciplineId) {
        var candidate = buildDeleteAllForDisciplineCandidate(disciplineId);
        if (!candidate.success) {
            return Promise.resolve(candidate);
        }

        return runCandidate(candidate, {
            logMessage: 'Deleted ' + candidate.data.count + ' group(s) for discipline ' + disciplineId,
            successMessage: 'Discipline groups deleted.',
            failureMessage: 'Failed to delete discipline groups.'
        });
    }

    // ============================================================
    // BACKWARD-COMPATIBILITY READ ALIASES
    // ============================================================
    //
    // These delegate to AcademyQueries. They exist for backward
    // compatibility with callers that still use AcademyGroups.getX.
    // New code should call AcademyQueries.getX directly.
    //
    // IMPORTANT: do not add new reads here, and do not make
    // AcademyQueries call these aliases — that would recreate the
    // recursion loop that caused a stack overflow. AcademyQueries is
    // the single source of truth for reads; these are aliases only.

    function getAllAutoGroups() {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getAllGroups === 'function') {
            return AQ.getAllGroups();
        }
        return {};
    }

    function getAutoGroup(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroup === 'function') {
            return AQ.getGroup(key);
        }
        return null;
    }

    function isStudentInGroup(key, studentId) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.isStudentInGroup === 'function') {
            return AQ.isStudentInGroup(key, studentId);
        }
        return false;
    }

    function getGroupStudents(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupStudents === 'function') {
            return AQ.getGroupStudents(key);
        }
        return [];
    }

    function getGroupSlots(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupSlots === 'function') {
            return AQ.getGroupSlots(key);
        }
        return [];
    }

    function getGroupsByDiscipline(disciplineId) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupsByDiscipline === 'function') {
            return AQ.getGroupsByDiscipline(disciplineId);
        }
        return {};
    }

    function getGroupsByInstructor(instructorId) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupsByInstructor === 'function') {
            return AQ.getGroupsByInstructor(instructorId);
        }
        return {};
    }

    function getGroupStudentCount(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupStudentCount === 'function') {
            return AQ.getGroupStudentCount(key);
        }
        return 0;
    }

    function getGroupSlotCount(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupSlotCount === 'function') {
            return AQ.getGroupSlotCount(key);
        }
        return 0;
    }

    function getGroupsForStudent(studentId) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupsForStudent === 'function') {
            return AQ.getGroupsForStudent(studentId);
        }
        return {};
    }

    function getGroupsForWeek(week) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupsForWeek === 'function') {
            return AQ.getGroupsForWeek(week);
        }
        return {};
    }

    function getGroupSlotsByWeek(key, week) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupSlotsByWeek === 'function') {
            return AQ.getGroupSlotsByWeek(key, week);
        }
        return [];
    }

    function getGroupSummary(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupSummary === 'function') {
            return AQ.getGroupSummary(key);
        }
        return null;
    }

    function getAllGroupSummaries() {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getAllGroupSummaries === 'function') {
            return AQ.getAllGroupSummaries();
        }
        return [];
    }

    function getGroupDisplayName(key) {
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getGroupDisplayName === 'function') {
            return AQ.getGroupDisplayName(key);
        }
        return 'Unknown Group';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGroups = {
        // ---- Mutations (Promise-based) ----
        createGroup: createGroup,
        deleteGroup: deleteGroup,
        addStudentToGroup: addStudentToGroup,
        removeStudentFromGroup: removeStudentFromGroup,
        addSlotToGroup: addSlotToGroup,
        removeSlotFromGroup: removeSlotFromGroup,
        addStudentsToGroup: addStudentsToGroup,
        removeStudentsFromGroup: removeStudentsFromGroup,
        deleteAllGroupsForInstructor: deleteAllGroupsForInstructor,
        deleteAllGroupsForDiscipline: deleteAllGroupsForDiscipline,

        // ---- Candidate Builders (advanced, for custom transactions) ----
        buildCreateGroupCandidate: buildCreateGroupCandidate,
        buildDeleteGroupCandidate: buildDeleteGroupCandidate,
        buildAddStudentCandidate: buildAddStudentCandidate,
        buildRemoveStudentCandidate: buildRemoveStudentCandidate,
        buildAddSlotCandidate: buildAddSlotCandidate,
        buildRemoveSlotCandidate: buildRemoveSlotCandidate,
        buildAddStudentsCandidate: buildAddStudentsCandidate,
        buildRemoveStudentsCandidate: buildRemoveStudentsCandidate,
        buildDeleteAllForInstructorCandidate: buildDeleteAllForInstructorCandidate,
        buildDeleteAllForDisciplineCandidate: buildDeleteAllForDisciplineCandidate,

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

        // ---- Status classifiers (exposed for other modules that need
        //      to check group eligibility without duplicating the logic) ----
        isInstructorStatus: isInstructorStatus,
        isStudentStatus: isStudentStatus,

        // ---- Read aliases (DEPRECATED — call AcademyQueries directly) ----
        getAutoGroup: getAutoGroup,
        isStudentInGroup: isStudentInGroup,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getAllAutoGroups: getAllAutoGroups,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForWeek: getGroupsForWeek,
        getGroupSlotsByWeek: getGroupSlotsByWeek,
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries,
        getGroupDisplayName: getGroupDisplayName
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyGroups;
        var missing = [];

        var required = [
            'createGroup', 'deleteGroup',
            'addStudentToGroup', 'removeStudentFromGroup',
            'addSlotToGroup', 'removeSlotFromGroup',
            'addStudentsToGroup', 'removeStudentsFromGroup',
            'deleteAllGroupsForInstructor', 'deleteAllGroupsForDiscipline',
            'buildCreateGroupCandidate', 'buildDeleteGroupCandidate',
            'buildAddStudentCandidate', 'buildRemoveStudentCandidate',
            'buildAddSlotCandidate', 'buildRemoveSlotCandidate',
            'buildAddStudentsCandidate', 'buildRemoveStudentsCandidate',
            'buildDeleteAllForInstructorCandidate', 'buildDeleteAllForDisciplineCandidate',
            'stripCharacterRefs',
            'isInstructorStatus', 'isStudentStatus'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyGroups] Verification failed - missing exports:', missing.join(', '));
        }
    })();

})();