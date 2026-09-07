/**
 * js/modules/academy/academy-groups.js - Academy Group Domain
 * Single source of truth for all auto-group operations within the Academy
 * Path: js/modules/academy/academy-groups.js
 * 
 * This module handles:
 *   - Auto-group CRUD operations
 *   - Student management within groups
 *   - Slot management within groups
 *   - Group summaries and queries
 *   - Bulk operations (atomic candidate construction)
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for auto-groups
 *   - All mutations are candidate-based: validate, clone, modify, return candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 * 
 * USAGE:
 *   var groups = window.AcademyGroups;
 *   var result = groups.createAutoGroup(disciplineId, instructorId);
 *   var candidate = groups.buildAddStudentCandidate(key, studentId);
 *   // Apply candidate via MutationPipeline
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyGroupsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

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

        if (missing.length > 0) {
            throw new Error('AcademyGroups: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var AUTO_GROUP_LABEL = 'auto-group';

    // ============================================================
    // HELPER ALIASES
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

    // ============================================================
    // DATA STORE ACCESS - Read-only
    // ============================================================

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
    // VALIDATION HELPERS
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

    // ============================================================
    // GROUP QUERIES
    // ============================================================

    function getAllAutoGroups() {
        var store = getAutoGroupsStore();
        if (!store || typeof store !== 'object') {
            return {};
        }
        return deepClone(store) || {};
    }

    function getAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function getGroupsByDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return {};
        }
        var groups = getAllAutoGroups();
        var result = {};
        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }
            var group = groups[key];
            if (group && String(group.disciplineId) === String(disciplineId)) {
                result[key] = group;
            }
        }
        return result;
    }

    function getGroupsByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        var groups = getAllAutoGroups();
        var result = {};
        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }
            var group = groups[key];
            if (group && String(group.instructorId) === String(instructorId)) {
                result[key] = group;
            }
        }
        return result;
    }

    function getGroupStudents(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.students)) {
            return [];
        }
        return group.students.slice();
    }

    function getGroupSlots(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        return group.slots.slice();
    }

    function getGroupStudentCount(key) {
        return getGroupStudents(key).length;
    }

    function getGroupSlotCount(key) {
        return getGroupSlots(key).length;
    }

    function isStudentInGroup(key, studentId) {
        var students = getGroupStudents(key);
        for (var i = 0; i < students.length; i++) {
            if (String(students[i]) === String(studentId)) {
                return true;
            }
        }
        return false;
    }

    function getGroupsForStudent(studentId) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }

        var allGroups = getAllAutoGroups();
        var result = {};

        for (var key in allGroups) {
            if (!Object.prototype.hasOwnProperty.call(allGroups, key)) {
                continue;
            }
            var group = allGroups[key];
            if (group && Array.isArray(group.students)) {
                for (var i = 0; i < group.students.length; i++) {
                    if (String(group.students[i]) === String(studentId)) {
                        result[key] = group;
                        break;
                    }
                }
            }
        }

        return result;
    }

    function getGroupsForWeek(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var allGroups = getAllAutoGroups();
        var result = {};

        for (var key in allGroups) {
            if (!Object.prototype.hasOwnProperty.call(allGroups, key)) {
                continue;
            }
            var group = allGroups[key];
            if (!Array.isArray(group.slots)) {
                continue;
            }

            var hasSlot = false;
            for (var i = 0; i < group.slots.length; i++) {
                if (group.slots[i].week === weekNum) {
                    hasSlot = true;
                    break;
                }
            }

            if (hasSlot) {
                result[key] = group;
            }
        }

        return result;
    }

    function getGroupSlotsByWeek(key, week) {
        var slots = getGroupSlots(key);
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var result = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.week === weekNum) {
                result.push(slot);
            }
        }

        result.sort(function(a, b) {
            if (a.day !== b.day) {
                return a.day - b.day;
            }
            return a.hour - b.hour;
        });

        return result;
    }

    // ============================================================
    // GROUP SUMMARIES
    // ============================================================

    function getGroupSummary(key) {
        var group = getAutoGroup(key);
        if (!group) {
            return null;
        }

        var discipline = DisciplineQueries.getDiscipline(group.disciplineId);
        var instructor = CharacterQueries.getCharacterById(group.instructorId);

        return {
            key: key,
            name: (discipline ? discipline.name : 'Unknown') + ' (' + (instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown') + ')',
            disciplineId: group.disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: group.instructorId,
            instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown',
            studentCount: group.students ? group.students.length : 0,
            slotCount: group.slots ? group.slots.length : 0,
            students: group.students || [],
            slots: group.slots || []
        };
    }

    function getAllGroupSummaries() {
        var groups = getAllAutoGroups();
        var result = [];

        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }
            var summary = getGroupSummary(key);
            if (summary) {
                result.push(summary);
            }
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function getGroupDisplayName(key) {
        var summary = getGroupSummary(key);
        return summary ? summary.name : 'Unknown Group';
    }

    // ============================================================
    // SLOT OVERLAP DETECTION
    // ============================================================

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
    // CANDIDATE MUTATION FUNCTIONS - No direct commit
    // ============================================================

    /**
     * Build a candidate for creating an auto-group.
     * Returns a mutation object for MutationPipeline.
     */
    function buildCreateGroupCandidate(disciplineId, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        var discResult = validateDisciplineId(disciplineId);
        if (!discResult.valid) {
            return failure(discResult.message);
        }

        var instResult = validateInstructorId(instructorId);
        if (!instResult.valid) {
            return failure(instResult.message);
        }

        var groupKey = String(disciplineId) + '_' + String(instructorId);

        // ---- PHASE 2: CHECK FOR EXISTING ----
        var existing = getAutoGroup(groupKey);
        if (existing) {
            return failure('Group already exists for this discipline and instructor.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
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

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.autoGroups) {
                data.curriculum.autoGroups = {};
            }
            data.curriculum.autoGroups[groupKey] = newGroup;
            return { group: deepClone(newGroup) };
        }

        return success({
            mutate: mutate,
            group: newGroup,
            groupKey: groupKey
        });
    }

    /**
     * Build a candidate for deleting an auto-group.
     */
    function buildDeleteGroupCandidate(key) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var displayName = group.displayName || key;

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { deleted: false };
            }
            delete data.curriculum.autoGroups[key];
            return { deleted: true };
        }

        return success({
            mutate: mutate,
            displayName: displayName
        });
    }

    /**
     * Build a candidate for adding a student to an auto-group.
     */
    function buildAddStudentCandidate(key, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return failure(studentResult.message);
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (isStudentInGroup(key, studentId)) {
            return failure('Student is already in this group.');
        }

        var studentName = CharacterQueries.getDisplayName(studentResult.student);

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { added: false };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
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
     * Build a candidate for removing a student from an auto-group.
     */
    function buildRemoveStudentCandidate(key, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!isStudentInGroup(key, studentId)) {
            return failure('Student is not in this group.');
        }

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { removed: false };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: false };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return String(id) !== String(studentId);
            });

            // Clean up empty groups
            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete data.curriculum.autoGroups[key];
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
     * Build a candidate for adding a slot to an auto-group.
     */
    function buildAddSlotCandidate(key, week, day, hour, duration, label) {
        // ---- PHASE 1: VALIDATE ----
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

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var newSlot = {
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || ''
        };

        if (hasSlotOverlap(newSlot, group.slots)) {
            return failure('Slot overlaps with an existing slot in this group.');
        }

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { added: false };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
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
     * Build a candidate for removing a slot from an auto-group.
     */
    function buildRemoveSlotCandidate(key, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
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

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!Array.isArray(group.slots)) {
            return failure('Group has no slots.');
        }

        var slotIndex = -1;
        var slotData = null;
        for (var i = 0; i < group.slots.length; i++) {
            var s = group.slots[i];
            if (s.week === weekNum && s.day === dayNum && s.hour === hourNum) {
                slotIndex = i;
                slotData = s;
                break;
            }
        }

        if (slotIndex === -1) {
            return failure('Slot not found in group.');
        }

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { removed: false };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.slots)) {
                return { removed: false };
            }

            candidateGroup.slots.splice(slotIndex, 1);

            // Clean up empty groups
            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete data.curriculum.autoGroups[key];
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
     * Build a candidate for adding multiple students to an auto-group.
     */
    function buildAddStudentsCandidate(key, studentIds) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var studentValidation = validateStudentIds(studentIds);
        if (!studentValidation.valid) {
            return failure(studentValidation.message);
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        var existingStudents = group.students || [];
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

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { added: 0 };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
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
     * Build a candidate for removing multiple students from an auto-group.
     */
    function buildRemoveStudentsCandidate(key, studentIds) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!Array.isArray(group.students) || group.students.length === 0) {
            return failure('Group has no students.');
        }

        var removedStudents = [];
        var notInGroup = [];

        for (var i = 0; i < studentIds.length; i++) {
            var sid = studentIds[i];
            var isInGroup = false;
            for (var j = 0; j < group.students.length; j++) {
                if (String(group.students[j]) === String(sid)) {
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

        // ---- PHASE 2: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum || !data.curriculum.autoGroups) {
                return { removed: 0 };
            }
            var candidateGroup = data.curriculum.autoGroups[key];
            if (!candidateGroup || !Array.isArray(candidateGroup.students)) {
                return { removed: 0 };
            }

            candidateGroup.students = candidateGroup.students.filter(function(id) {
                return !removedSet[String(id)];
            });

            // Clean up empty groups
            var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
            var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
            if (!hasStudents && !hasSlots) {
                delete data.curriculum.autoGroups[key];
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
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These perform the mutation and commit directly.
    // DEPRECATED: Use build*Candidate functions with MutationPipeline.
    // ============================================================

    function createAutoGroup(disciplineId, instructorId) {
        var candidate = buildCreateGroupCandidate(disciplineId, instructorId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ group: candidate.data.group });
        } catch (e) {
            return failure(e.message || 'Failed to create group.');
        }
    }

    function deleteAutoGroup(key) {
        var candidate = buildDeleteGroupCandidate(key);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ deleted: true });
        } catch (e) {
            return failure(e.message || 'Failed to delete group.');
        }
    }

    function addStudentToAutoGroup(key, studentId) {
        var candidate = buildAddStudentCandidate(key, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ added: true });
        } catch (e) {
            return failure(e.message || 'Failed to add student.');
        }
    }

    function removeStudentFromAutoGroup(key, studentId) {
        var candidate = buildRemoveStudentCandidate(key, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ removed: true });
        } catch (e) {
            return failure(e.message || 'Failed to remove student.');
        }
    }

    function addSlotToAutoGroup(key, week, day, hour, duration, label) {
        var candidate = buildAddSlotCandidate(key, week, day, hour, duration, label);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ added: true });
        } catch (e) {
            return failure(e.message || 'Failed to add slot.');
        }
    }

    function removeSlotFromAutoGroup(key, week, day, hour) {
        var candidate = buildRemoveSlotCandidate(key, week, day, hour);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ removed: true });
        } catch (e) {
            return failure(e.message || 'Failed to remove slot.');
        }
    }

    function addStudentsToAutoGroup(key, studentIds) {
        var candidate = buildAddStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
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

    function removeStudentsFromAutoGroup(key, studentIds) {
        var candidate = buildRemoveStudentsCandidate(key, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
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
        // Queries
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForWeek: getGroupsForWeek,
        getGroupSlotsByWeek: getGroupSlotsByWeek,

        // Summaries
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries,
        getGroupDisplayName: getGroupDisplayName,

        // Candidate builders (preferred - use with MutationPipeline)
        buildCreateGroupCandidate: buildCreateGroupCandidate,
        buildDeleteGroupCandidate: buildDeleteGroupCandidate,
        buildAddStudentCandidate: buildAddStudentCandidate,
        buildRemoveStudentCandidate: buildRemoveStudentCandidate,
        buildAddSlotCandidate: buildAddSlotCandidate,
        buildRemoveSlotCandidate: buildRemoveSlotCandidate,
        buildAddStudentsCandidate: buildAddStudentsCandidate,
        buildRemoveStudentsCandidate: buildRemoveStudentsCandidate,

        // Legacy wrappers (DEPRECATED - use candidate builders)
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToAutoGroup: addStudentToAutoGroup,
        removeStudentFromAutoGroup: removeStudentFromAutoGroup,
        addSlotToAutoGroup: addSlotToAutoGroup,
        removeSlotFromAutoGroup: removeSlotFromAutoGroup,
        addStudentsToAutoGroup: addStudentsToAutoGroup,
        removeStudentsFromAutoGroup: removeStudentsFromAutoGroup
    };

})();
