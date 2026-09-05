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
 *   - Bulk operations (atomic)
 *   - Rebuilding groups from schedules
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for auto-groups
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - Bulk operations are ATOMIC: all or nothing
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.ActivityLog (from activity-log.js)
 * 
 * USAGE:
 *   var groups = window.AcademyGroups;
 *   var result = groups.createAutoGroup(disciplineId, instructorId);
 *   var group = groups.getGroupSummary(key);
 *   var result = groups.addStudentToAutoGroup(key, studentId);
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
    var AcademyQueries = window.AcademyQueries;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var ActivityLog = window.ActivityLog;

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

        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterById !== 'function') {
            missing.push('AcademyQueries.getCharacterById');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (missing.length > 0) {
            console.warn('AcademyGroups: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyGroupsLoaded = true;

    // ============================================================
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
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

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // VALIDATION HELPERS - Strict validation
    // ============================================================

    function validateWeek(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    function validateDay(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_DAY || num > MAX_DAY) {
            return null;
        }
        return num;
    }

    function validateHour(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_HOUR || num > MAX_HOUR) {
            return null;
        }
        return num;
    }

    function validateDuration(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1 || num > 4) {
            return null;
        }
        return num;
    }

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
        var discipline = AcademyQueries.getDiscipline(disciplineId);
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
        // Check if character is actually an instructor
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
        // Check if character is actually a student
        var status = CharacterQueries.getCurrentStatus(student);
        if (status !== 'trainee' && status !== 'rookie' && status !== 'junior') {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateSlotData(key, week, day, hour, duration) {
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return keyResult;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { valid: false, message: 'Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { valid: false, message: 'Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { valid: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hourNum + durationNum > 24) {
            return { valid: false, message: 'Slot duration extends beyond the end of the day.' };
        }

        return {
            valid: true,
            key: keyResult.key,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum
        };
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
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.autoGroups) {
            return {};
        }
        var cloned = deepClone(data.curriculum.autoGroups);
        return cloned || {};
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
        return students.some(function(id) {
            return String(id) === String(studentId);
        });
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
        var weekNum = validateWeek(week);
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
        var weekNum = validateWeek(week);
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

        var discipline = AcademyQueries.getDiscipline(group.disciplineId);
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
    // GROUP MUTATIONS - Candidate-based
    // ============================================================

    function createAutoGroup(disciplineId, instructorId) {
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

        // ---- PHASE 3: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        // ---- PHASE 5: CREATE GROUP ----
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

        candidateGroups[groupKey] = newGroup;

        // ---- PHASE 6: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 7: LOG ----
        recordActivity('Created auto-group: ' + newGroup.displayName);

        return success({
            group: deepClone(newGroup)
        });
    }

    function deleteAutoGroup(key) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        // ---- PHASE 4: DELETE ----
        var displayName = group.displayName || key;
        delete candidateGroups[key];

        // ---- PHASE 5: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 6: LOG ----
        recordActivity('Deleted auto-group: ' + displayName);

        return success({ deleted: true });
    }

    function addStudentToAutoGroup(key, studentId) {
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.students)) {
            candidateGroup.students = [];
        }

        candidateGroup.students.push(String(studentId));
        candidateGroup.students.sort();

        // ---- PHASE 4: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 5: LOG ----
        var studentName = CharacterQueries.getDisplayName(studentResult.student);
        recordActivity('Added ' + studentName + ' to auto-group: ' + (group.displayName || key));

        return success({
            added: true,
            studentId: studentId,
            studentName: studentName
        });
    }

    function removeStudentFromAutoGroup(key, studentId) {
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.students)) {
            return failure('Group has no students.');
        }

        candidateGroup.students = candidateGroup.students.filter(function(id) {
            return String(id) !== String(studentId);
        });

        // Clean up empty groups
        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        // ---- PHASE 4: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 5: LOG ----
        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Removed ' + studentName + ' from auto-group: ' + (group.displayName || key));

        return success({ removed: true });
    }

    // ============================================================
    // SLOT MANAGEMENT - Candidate-based
    // ============================================================

    function addSlotToAutoGroup(key, week, day, hour, duration, label) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateSlotData(key, week, day, hour, duration);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        // Check for overlap
        var newSlot = {
            week: validation.week,
            day: validation.day,
            hour: validation.hour,
            duration: validation.duration,
            label: label || ''
        };

        if (hasSlotOverlap(newSlot, group.slots)) {
            return failure('Slot overlaps with an existing slot in this group.');
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.slots)) {
            candidateGroup.slots = [];
        }

        candidateGroup.slots.push(newSlot);
        candidateGroup.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        // ---- PHASE 4: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 5: LOG ----
        recordActivity('Added slot to auto-group: ' + (group.displayName || key));

        return success({
            added: true,
            slot: newSlot
        });
    }

    function removeSlotFromAutoGroup(key, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var keyResult = validateGroupKey(key);
        if (!keyResult.valid) {
            return failure(keyResult.message);
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        var group = getAutoGroup(key);
        if (!group) {
            return failure('Group not found.');
        }

        if (!Array.isArray(group.slots)) {
            return failure('Group has no slots.');
        }

        // Find slot
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.slots)) {
            return failure('Group has no slots.');
        }

        candidateGroup.slots.splice(slotIndex, 1);

        // Clean up empty groups
        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        // ---- PHASE 4: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 5: LOG ----
        recordActivity('Removed slot from auto-group: ' + (group.displayName || key));

        return success({ removed: true });
    }

    // ============================================================
    // SLOT OVERLAP DETECTION
    // ============================================================

    function hasSlotOverlap(newSlot, existingSlots) {
        for (var i = 0; i < existingSlots.length; i++) {
            if (slotsOverlap(newSlot, existingSlots[i])) {
                return true;
            }
        }
        return false;
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

    // ============================================================
    // BULK OPERATIONS - ATOMIC
    // ============================================================

    function addStudentsToAutoGroup(key, studentIds) {
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

        // Filter out students already in the group
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.students)) {
            candidateGroup.students = [];
        }

        // ---- PHASE 4: APPLY ALL CHANGES ----
        for (var i = 0; i < newStudents.length; i++) {
            candidateGroup.students.push(String(newStudents[i].studentId));
        }
        candidateGroup.students.sort();

        // ---- PHASE 5: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 6: LOG ----
        var groupName = group.displayName || key;
        var studentNames = newStudents.map(function(s) {
            return CharacterQueries.getDisplayName(s.student);
        });
        recordActivity('Added ' + newStudents.length + ' students to auto-group: ' + groupName);

        return success({
            added: newStudents.length,
            students: newStudents.map(function(s) { return s.studentId; }),
            studentNames: studentNames,
            alreadyInGroup: alreadyInGroup
        });
    }

    function removeStudentsFromAutoGroup(key, studentIds) {
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

        // Validate all students exist in the group
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        if (!Array.isArray(candidateGroup.students)) {
            return failure('Group has no students.');
        }

        // ---- PHASE 4: APPLY ALL CHANGES ----
        var removedSet = {};
        for (var i = 0; i < removedStudents.length; i++) {
            removedSet[String(removedStudents[i])] = true;
        }

        candidateGroup.students = candidateGroup.students.filter(function(id) {
            return !removedSet[String(id)];
        });

        // Clean up empty groups
        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;
        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        // ---- PHASE 6: LOG ----
        var groupName = group.displayName || key;
        recordActivity('Removed ' + removedStudents.length + ' students from auto-group: ' + groupName);

        return success({
            removed: removedStudents.length,
            students: removedStudents,
            notInGroup: notInGroup
        });
    }

    // ============================================================
    // REBUILD GROUPS FROM SCHEDULES
    // ============================================================

    function rebuildGroupsFromSchedules() {
        // ---- PHASE 1: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 2: BUILD METADATA CANDIDATES ----
        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        // ---- PHASE 3: COLLECT CLASS INSTANCES ----
        var students = CharacterQueries.getStudents();
        if (!Array.isArray(students)) {
            students = [];
        }

        var schedules = data.curriculum.schedules || {};
        var classInstances = {};
        var overlapErrors = [];

        for (var s = 0; s < students.length; s++) {
            var student = students[s];
            var studentId = student.id;
            var studentSchedules = schedules[studentId] || {};

            for (var week in studentSchedules) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedules, week)) {
                    continue;
                }

                var weekNum = parseInt(week, 10);
                if (isNaN(weekNum)) {
                    continue;
                }

                var weekSchedule = studentSchedules[week];
                if (!isObject(weekSchedule)) {
                    continue;
                }

                for (var day in weekSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                        continue;
                    }

                    var dayNum = parseInt(day, 10);
                    if (isNaN(dayNum)) {
                        continue;
                    }

                    var daySchedule = weekSchedule[day];
                    if (!isObject(daySchedule)) {
                        continue;
                    }

                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                            continue;
                        }

                        var hourNum = parseInt(hour, 10);
                        if (isNaN(hourNum)) {
                            continue;
                        }

                        var disciplineId = daySchedule[hourNum];
                        if (!disciplineId) {
                            continue;
                        }

                        var startKey = studentId + '_' + weekNum + '_' + dayNum + '_' + hourNum;
                        var duration = validateDuration(metadataCandidates.classDurations && metadataCandidates.classDurations[startKey]);

                        if (duration === null) {
                            continue;
                        }

                        if (!isAutoGroupClass(metadataCandidates, studentId, weekNum, dayNum, hourNum)) {
                            continue;
                        }

                        var instructorId = null;
                        if (metadataCandidates.classInstructors) {
                            instructorId = metadataCandidates.classInstructors[startKey];
                        }

                        if (!instructorId) {
                            continue;
                        }

                        var groupKey = String(disciplineId) + '_' + String(instructorId);

                        if (!classInstances[groupKey]) {
                            classInstances[groupKey] = {
                                disciplineId: String(disciplineId),
                                instructorId: String(instructorId),
                                slots: [],
                                studentClasses: {}
                            };
                        }

                        var group = classInstances[groupKey];

                        var newSlot = {
                            week: weekNum,
                            day: dayNum,
                            hour: hourNum,
                            duration: duration
                        };

                        var slotExists = false;
                        for (var k = 0; k < group.slots.length; k++) {
                            var existingSlot = group.slots[k];
                            if (existingSlot.week === weekNum &&
                                existingSlot.day === dayNum &&
                                existingSlot.hour === hourNum &&
                                existingSlot.duration === duration) {
                                slotExists = true;
                                break;
                            }
                        }

                        if (!slotExists) {
                            if (hasSlotOverlap(newSlot, group.slots)) {
                                overlapErrors.push({
                                    groupKey: groupKey,
                                    studentId: studentId,
                                    week: weekNum,
                                    day: dayNum,
                                    hour: hourNum,
                                    duration: duration
                                });
                            } else {
                                group.slots.push(newSlot);
                                group.slots.sort(function(a, b) {
                                    if (a.week !== b.week) return a.week - b.week;
                                    if (a.day !== b.day) return a.day - b.day;
                                    return a.hour - b.hour;
                                });
                            }
                        }

                        var slotKey2 = weekNum + '_' + dayNum + '_' + hourNum + '_' + duration;
                        if (!group.studentClasses[studentId]) {
                            group.studentClasses[studentId] = {};
                        }
                        group.studentClasses[studentId][slotKey2] = true;
                    }
                }
            }
        }

        if (overlapErrors.length > 0) {
            return {
                success: false,
                message: 'Cannot rebuild groups: schedule data contains overlapping auto-group classes.',
                overlaps: overlapErrors,
                overlapCount: overlapErrors.length
            };
        }

        // ---- PHASE 4: BUILD GROUPS ----
        var newGroups = {};
        var count = 0;

        for (var groupKey in classInstances) {
            if (!Object.prototype.hasOwnProperty.call(classInstances, groupKey)) {
                continue;
            }

            var instance = classInstances[groupKey];
            var slots = instance.slots;

            var validStudents = [];
            var studentIds = Object.keys(instance.studentClasses);

            for (var i = 0; i < studentIds.length; i++) {
                var studentId2 = studentIds[i];
                var hasAllSlots = true;

                for (var j = 0; j < slots.length; j++) {
                    var slot = slots[j];
                    var slotKey3 = slot.week + '_' + slot.day + '_' + slot.hour + '_' + slot.duration;

                    if (!instance.studentClasses[studentId2] || !instance.studentClasses[studentId2][slotKey3]) {
                        hasAllSlots = false;
                        break;
                    }
                }

                if (hasAllSlots) {
                    validStudents.push(studentId2);
                }
            }

            if (validStudents.length === 0) {
                continue;
            }

            var discipline = AcademyQueries.getDiscipline(instance.disciplineId);
            var instructor = CharacterQueries.getCharacterById(instance.instructorId);
            var disciplineName = discipline ? discipline.name : 'Unknown';
            var instructorName = instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';

            var shortInstructor = instructorName;
            var parts = instructorName.split(' ');
            if (parts.length >= 2) {
                shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
            }

            var group2 = {
                id: groupKey,
                disciplineId: instance.disciplineId,
                instructorId: instance.instructorId,
                displayName: disciplineName + ' (' + shortInstructor + ')',
                students: validStudents,
                slots: slots.slice(),
                createdAt: new Date().toISOString()
            };

            newGroups[groupKey] = group2;
            count++;
        }

        var candidate = deepClone(newGroups);
        if (candidate === null) {
            return failure('Failed to prepare group data.');
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.autoGroups = candidate;

        // ---- PHASE 6: LOG ----
        recordActivity('Rebuilt auto-groups from schedules: ' + count + ' groups created');

        return success({ count: count });
    }

    // ============================================================
    // METADATA HELPERS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations', 'classLocations'];

    function buildMetadataCandidates(curriculum) {
        var metadata = {};
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum && curriculum[key] ? curriculum[key] : {};
            var cloned = deepClone(source);
            if (cloned === null) {
                return null;
            }
            metadata[key] = cloned;
        }
        return metadata;
    }

    function isAutoGroupClass(metadata, studentId, week, day, hour) {
        var key = studentId + '_' + week + '_' + day + '_' + hour;
        if (metadata && metadata.classGroupLabels) {
            return metadata.classGroupLabels[key] === AUTO_GROUP_LABEL;
        }
        return false;
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

        // Mutations
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToAutoGroup: addStudentToAutoGroup,
        removeStudentFromAutoGroup: removeStudentFromAutoGroup,
        addSlotToAutoGroup: addSlotToAutoGroup,
        removeSlotFromAutoGroup: removeSlotFromAutoGroup,
        rebuildGroupsFromSchedules: rebuildGroupsFromSchedules,

        // Bulk operations
        addStudentsToAutoGroup: addStudentsToAutoGroup,
        removeStudentsFromAutoGroup: removeStudentsFromAutoGroup,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration
    };

})();