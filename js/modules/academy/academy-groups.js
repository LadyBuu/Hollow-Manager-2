/**
 * modules/academy/academy-groups.js - Academy Groups
 * CANONICAL source of truth for auto-group mutations
 * 
 * This module provides:
 *   - Group CRUD mutations (create, delete)
 *   - Student membership mutations (add, remove, bulk)
 *   - Slot mutations (add, remove, bulk)
 *   - Candidate builders for MutationPipeline
 * 
 * IMPORTANT:
 *   - This module owns auto-group MUTATIONS only
 *   - Reads are in AcademyQueries (moved to shared/queries/)
 *   - Uses AcademyQueries for validation reads
 *   - Uses CharacterQueries for character validation
 *   - Uses DisciplineQueries for discipline validation
 *   - All mutations are candidate-based: validate, clone, modify, return candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
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
 *   var result = groups.addStudentsToGroup(key, [studentId1, studentId2]);
 *   var result = groups.removeStudentsFromGroup(key, [studentId1, studentId2]);
 *   
 *   // Candidate builders (for MutationPipeline)
 *   var candidate = groups.buildCreateGroupCandidate(disciplineId, instructorId);
 *   var candidate = groups.buildDeleteGroupCandidate(key);
 *   // etc.
 */

(function() {
    'use strict';

    if (window.__academyGroupsLoaded) {
        return;
    }
    window.__academyGroupsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var AcademyQueries = window.AcademyQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseDay !== 'function') {
            missing.push('CalendarValidation.parseDay');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseHour !== 'function') {
            missing.push('CalendarValidation.parseHour');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseDuration !== 'function') {
            missing.push('CalendarValidation.parseDuration');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (!AcademyQueries || typeof AcademyQueries.getAutoGroup !== 'function') {
            missing.push('AcademyQueries.getAutoGroup');
        }

        if (missing.length > 0) {
            throw new Error('AcademyGroups: Missing dependencies: ' + missing.join(', '));
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
        return ObjectUtils.deepClone(value);
    }

    function generateId(prefix) {
        return IdUtils.generateId(prefix);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getAutoGroupsStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.curriculum || typeof window.data.curriculum !== 'object') {
            return null;
        }
        return window.data.curriculum.autoGroups;
    }

    // ============================================================
    // VALIDATION - Uses AcademyQueries for reads
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
    // CANDIDATE BUILDERS - For MutationPipeline
    // ============================================================

    /**
     * Build a candidate for creating a group.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {string} instructorId - Instructor ID
     * @returns {object} { success: boolean, data?: object, message?: string }
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

        var groupKey = String(disciplineId) + '_' + String(instructorId);

        // Use AcademyQueries for read
        var existing = AcademyQueries.getAutoGroup(groupKey);
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
            if (!dataStore.curriculum.autoGroups) {
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
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildDeleteGroupCandidate(key) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
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
     * @returns {object} { success: boolean, data?: object, message?: string }
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

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (AcademyQueries.isStudentInGroup(key, studentId)) {
            return failure('Student is already in this group.');
        }

        var studentName = CharacterQueries.getDisplayName(studentResult.student);

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
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildRemoveStudentCandidate(key, studentId) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!AcademyQueries.isStudentInGroup(key, studentId)) {
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
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildAddSlotCandidate(key, week, day, hour, duration, label) {
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

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var slots = AcademyQueries.getGroupSlots(key);

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
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildRemoveSlotCandidate(key, week, day, hour) {
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

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var slots = AcademyQueries.getGroupSlots(key);
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
     * @returns {object} { success: boolean, data?: object, message?: string }
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

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var existingStudents = AcademyQueries.getGroupStudents(key);
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

        var studentNames = newStudents.map(function(s) {
            return CharacterQueries.getDisplayName(s.student);
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
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildRemoveStudentsCandidate(key, studentIds) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        // Use AcademyQueries for read
        var group = AcademyQueries.getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var existingStudents = AcademyQueries.getGroupStudents(key);
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
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {string} instructorId - Instructor ID
     * @returns {object} { success: boolean, data?: object, message?: string }
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

    /**
     * Delete a group.
     * 
     * @param {string} key - Group key
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
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

    /**
     * Add a student to a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
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

    /**
     * Remove a student from a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
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

    /**
     * Add a slot to a group.
     * 
     * @param {string} key - Group key
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @param {string} label - Optional label
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
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

    /**
     * Remove a slot from a group.
     * 
     * @param {string} key - Group key
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
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

    /**
     * Add multiple students to a group.
     * 
     * @param {string} key - Group key
     * @param {array} studentIds - Array of student IDs
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function addStudentsToGroup(key, studentIds) {
        var candidate = buildAddStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
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

    /**
     * Remove multiple students from a group.
     * 
     * @param {string} key - Group key
     * @param {array} studentIds - Array of student IDs
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function removeStudentsFromGroup(key, studentIds) {
        var candidate = buildRemoveStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
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
        buildRemoveStudentsCandidate: buildRemoveStudentsCandidate
    };

    window.__academyGroupsLoaded = true;

})();