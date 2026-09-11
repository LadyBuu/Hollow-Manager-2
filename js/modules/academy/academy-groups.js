/**
 * modules/academy/academy-groups.js - Academy Groups
 * CANONICAL source of truth for auto-group MUTATIONS.
 * 
 * This module provides:
 *   - Group mutations (create, delete)
 *   - Student membership mutations (add, remove, bulk)
 *   - Slot mutations (add, remove, bulk)
 *   - Candidate builders for MutationPipeline
 * 
 * IMPORTANT:
 *   - This module owns auto-group MUTATIONS only.
 *   - READS are owned by AcademyQueries. This module does not
 *     re-implement reads; the legacy read functions below are thin
 *     aliases that delegate to AcademyQueries and are kept only for
 *     backward compatibility. New code should call AcademyQueries.
 *   - Uses LAZY LOADING to break circular dependencies.
 *   - All mutations are candidate-based: validate, clone, return a
 *     candidate with a `mutate` closure. Callers run the closure
 *     inside their own transaction (or invoke it directly, which is
 *     what the public mutation functions below do).
 *   - This module does NOT call saveData() directly. The public
 *     mutation functions here are self-contained candidate runners;
 *     if you need transactional persistence, route through
 *     MutationPipeline at the call site.
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
 *   - window.AcademyQueries - LAZY (for reads only)
 * 
 * USAGE:
 *   var groups = window.AcademyGroups;
 *   
 *   // Mutations
 *   var result = groups.createGroup(disciplineId, instructorId);
 *   var result = groups.deleteGroup(key);
 *   var result = groups.addStudentToGroup(key, studentId);
 *   var result = groups.removeStudentFromGroup(key, studentId);
 *   var result = groups.addSlotToGroup(key, week, day, hour, duration, label);
 *   var result = groups.removeSlotFromGroup(key, week, day, hour);
 *   
 *   // Candidate builders (for MutationPipeline)
 *   var candidate = groups.buildCreateGroupCandidate(disciplineId, instructorId);
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

    /**
     * Get the auto-groups store, defensively.
     * The store is a plain object at curriculum.autoGroups.
     * Returns {} if missing.
     */
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
        if (status !== 'instructor' && status !== 'teacher' && status !== 'professor' && status !== 'senior') {
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
        if (status !== 'trainee' && status !== 'rookie' && status !== 'junior') {
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
    // 
    // These are used INTERNALLY by the candidate builders to
    // validate preconditions. They read the store directly. The
    // public read API is on AcademyQueries; these are private
    // helpers so that mutations don't depend on the public read
    // module.

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

    /**
     * Build a candidate for creating a group.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {string} instructorId - Instructor ID
     * @returns {object} { success, data?: { mutate, group, groupKey }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum) {
                dataStore.curriculum = {};
            }
            if (!dataStore.curriculum.autoGroups ||
                typeof dataStore.curriculum.autoGroups !== 'object' ||
                Array.isArray(dataStore.curriculum.autoGroups)) {
                dataStore.curriculum.autoGroups = {};
            }
            dataStore.curriculum.autoGroups[groupKey] = deepClone(newGroup);
            return { group: deepClone(newGroup) };
        }

        return success({
            mutate: mutate,
            group: newGroup,
            groupKey: groupKey
        });
    }

    /**
     * Build a candidate for deleting a group.
     * 
     * @param {string} key - Group key
     * @returns {object} { success, data?: { mutate, displayName }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { deleted: false };
            }
            delete dataStore.curriculum.autoGroups[key];
            return { deleted: true };
        }

        return success({
            mutate: mutate,
            displayName: displayName
        });
    }

    /**
     * Build a candidate for adding a student to a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { added: false };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
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

    /**
     * Build a candidate for removing a student from a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { removed: false };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: false };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return String(id) !== String(studentId);
            });

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete dataStore.curriculum.autoGroups[key];
            }

            return { removed: true };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            groupName: group.displayName || key
        });
    }

    /**
     * Build a candidate for adding a slot to a group.
     * 
     * @param {string} key - Group key
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @param {string} label - Optional label
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { added: false };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
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

    /**
     * Build a candidate for removing a slot from a group.
     * 
     * @param {string} key - Group key
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { removed: false };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.slots)) {
                return { removed: false };
            }

            candidateGroup.slots.splice(slotIndex, 1);

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete dataStore.curriculum.autoGroups[key];
            }

            return { removed: true };
        }

        return success({
            mutate: mutate,
            slot: slotData,
            groupName: group.displayName || key
        });
    }

    /**
     * Build a candidate for adding multiple students to a group.
     * 
     * @param {string} key - Group key
     * @param {array} studentIds - Array of student IDs
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { added: 0 };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
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

    /**
     * Build a candidate for removing multiple students from a group.
     * 
     * @param {string} key - Group key
     * @param {array} studentIds - Array of student IDs
     * @returns {object} { success, data?: { mutate, ... }, message? }
     */
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
        for (var i = 0; i < removedStudents.length; i++) {
            removedSet[String(removedStudents[i])] = true;
        }

        function mutate() {
            var dataStore = window.data;
            if (!dataStore.curriculum || !dataStore.curriculum.autoGroups) {
                return { removed: 0 };
            }
            var candidateGroup = dataStore.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: 0 };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return !removedSet[String(id)];
            });

            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete dataStore.curriculum.autoGroups[key];
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

    // ============================================================
    // PUBLIC MUTATION API
    // ============================================================

    /**
     * Create a new group.
     * Runs the candidate mutate directly. Does not persist through
     * MutationPipeline; if transactional persistence is needed, use
     * buildCreateGroupCandidate at the call site and route it through
     * MutationPipeline.
     */
    function createGroup(disciplineId, instructorId) {
        var candidate = buildCreateGroupCandidate(disciplineId, instructorId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ group: result.group });
        } catch (e) {
            return failure(e.message || 'Failed to create group.');
        }
    }

    function deleteGroup(key) {
        var candidate = buildDeleteGroupCandidate(key);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ deleted: result.deleted });
        } catch (e) {
            return failure(e.message || 'Failed to delete group.');
        }
    }

    function addStudentToGroup(key, studentId) {
        var candidate = buildAddStudentCandidate(key, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ added: result.added });
        } catch (e) {
            return failure(e.message || 'Failed to add student.');
        }
    }

    function removeStudentFromGroup(key, studentId) {
        var candidate = buildRemoveStudentCandidate(key, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ removed: result.removed });
        } catch (e) {
            return failure(e.message || 'Failed to remove student.');
        }
    }

    function addSlotToGroup(key, week, day, hour, duration, label) {
        var candidate = buildAddSlotCandidate(key, week, day, hour, duration, label);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ added: result.added });
        } catch (e) {
            return failure(e.message || 'Failed to add slot.');
        }
    }

    function removeSlotFromGroup(key, week, day, hour) {
        var candidate = buildRemoveSlotCandidate(key, week, day, hour);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ removed: result.removed });
        } catch (e) {
            return failure(e.message || 'Failed to remove slot.');
        }
    }

    function addStudentsToGroup(key, studentIds) {
        var candidate = buildAddStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({
                added: candidate.data.added,
                students: candidate.data.students,
                studentNames: candidate.data.studentNames,
                alreadyInGroup: candidate.data.alreadyInGroup
            });
        } catch (e) {
            return failure(e.message || 'Failed to add students.');
        }
    }

    function removeStudentsFromGroup(key, studentIds) {
        var candidate = buildRemoveStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({
                removed: candidate.data.removed,
                students: candidate.data.students,
                notInGroup: candidate.data.notInGroup
            });
        } catch (e) {
            return failure(e.message || 'Failed to remove students.');
        }
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
        // ---- Mutations ----
        createGroup: createGroup,
        deleteGroup: deleteGroup,
        addStudentToGroup: addStudentToGroup,
        removeStudentFromGroup: removeStudentFromGroup,
        addSlotToGroup: addSlotToGroup,
        removeSlotFromGroup: removeSlotFromGroup,
        addStudentsToGroup: addStudentsToGroup,
        removeStudentsFromGroup: removeStudentsFromGroup,

        // ---- Candidate Builders (for MutationPipeline) ----
        buildCreateGroupCandidate: buildCreateGroupCandidate,
        buildDeleteGroupCandidate: buildDeleteGroupCandidate,
        buildAddStudentCandidate: buildAddStudentCandidate,
        buildRemoveStudentCandidate: buildRemoveStudentCandidate,
        buildAddSlotCandidate: buildAddSlotCandidate,
        buildRemoveSlotCandidate: buildRemoveSlotCandidate,
        buildAddStudentsCandidate: buildAddStudentsCandidate,
        buildRemoveStudentsCandidate: buildRemoveStudentsCandidate,

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
            'buildCreateGroupCandidate', 'buildDeleteGroupCandidate',
            'buildAddStudentCandidate', 'buildRemoveStudentCandidate',
            'buildAddSlotCandidate', 'buildRemoveSlotCandidate',
            'buildAddStudentsCandidate', 'buildRemoveStudentsCandidate'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyGroups] Verification failed - missing exports:', missing.join(', '));
        } else {
            console.log('[AcademyGroups] All exports verified successfully.');
        }
    })();

})();