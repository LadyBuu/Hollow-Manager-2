/**
 * js/modules/academy/academy-groups.js - Academy Group Operations
 * Centralized auto-group management for the academy module
 * Path: js/modules/academy/academy-groups.js
 * 
 * This module handles:
 *   - Auto-group CRUD operations (delegates to GroupCore)
 *   - Student management within auto-groups
 *   - Slot management within auto-groups
 *   - Rebuilding auto-groups from schedules
 * 
 * IMPORTANT:
 *   - All MUTATION operations return:
 *     { success: true, changed: boolean, operation: string, data: object, count: number }
 *     or { success: false, message: string }
 *   - Query functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * DEPENDENCIES:
 *   - window.GroupCore (from curriculum-groups.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 * 
 * USAGE:
 *   var groups = window.AcademyGroups;
 *   var result = groups.createAutoGroup(disciplineId, instructorId);
 *   var allGroups = groups.getAllAutoGroups();
 *   var group = groups.addStudentToAutoGroup(key, studentId);
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

    var GroupCore = window.GroupCore;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!GroupCore || typeof GroupCore.getAllAutoGroups !== 'function') {
            missing.push('GroupCore.getAllAutoGroups');
        }
        if (!GroupCore || typeof GroupCore.getAutoGroup !== 'function') {
            missing.push('GroupCore.getAutoGroup');
        }
        if (!GroupCore || typeof GroupCore.getGroupsByDiscipline !== 'function') {
            missing.push('GroupCore.getGroupsByDiscipline');
        }
        if (!GroupCore || typeof GroupCore.getGroupsByInstructor !== 'function') {
            missing.push('GroupCore.getGroupsByInstructor');
        }
        if (!GroupCore || typeof GroupCore.getGroupStudents !== 'function') {
            missing.push('GroupCore.getGroupStudents');
        }
        if (!GroupCore || typeof GroupCore.getGroupSlots !== 'function') {
            missing.push('GroupCore.getGroupSlots');
        }
        if (!GroupCore || typeof GroupCore.getGroupStudentCount !== 'function') {
            missing.push('GroupCore.getGroupStudentCount');
        }
        if (!GroupCore || typeof GroupCore.getGroupSlotCount !== 'function') {
            missing.push('GroupCore.getGroupSlotCount');
        }
        if (!GroupCore || typeof GroupCore.isStudentInGroup !== 'function') {
            missing.push('GroupCore.isStudentInGroup');
        }
        if (!GroupCore || typeof GroupCore.createAutoGroup !== 'function') {
            missing.push('GroupCore.createAutoGroup');
        }
        if (!GroupCore || typeof GroupCore.deleteAutoGroup !== 'function') {
            missing.push('GroupCore.deleteAutoGroup');
        }
        if (!GroupCore || typeof GroupCore.addStudentToGroup !== 'function') {
            missing.push('GroupCore.addStudentToGroup');
        }
        if (!GroupCore || typeof GroupCore.removeStudentFromGroup !== 'function') {
            missing.push('GroupCore.removeStudentFromGroup');
        }
        if (!GroupCore || typeof GroupCore.addSlotToGroup !== 'function') {
            missing.push('GroupCore.addSlotToGroup');
        }
        if (!GroupCore || typeof GroupCore.removeSlotFromGroup !== 'function') {
            missing.push('GroupCore.removeSlotFromGroup');
        }
        if (!GroupCore || typeof GroupCore.rebuildGroupsFromSchedules !== 'function') {
            missing.push('GroupCore.rebuildGroupsFromSchedules');
        }

        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDisciplines !== 'function') {
            missing.push('AcademyQueries.getDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterById !== 'function') {
            missing.push('AcademyQueries.getCharacterById');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
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
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateDay(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 7) ? num : null;
    }

    function validateHour(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 0 && num <= 23) ? num : null;
    }

    function validateDuration(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // GROUP QUERIES
    // ============================================================

    function getAllAutoGroups() {
        return GroupCore.getAllAutoGroups();
    }

    function getAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        return GroupCore.getAutoGroup(key);
    }

    function getGroupsByDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return {};
        }
        return GroupCore.getGroupsByDiscipline(disciplineId);
    }

    function getGroupsByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        return GroupCore.getGroupsByInstructor(instructorId);
    }

    function getGroupStudents(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        return GroupCore.getGroupStudents(key);
    }

    function getGroupSlots(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        return GroupCore.getGroupSlots(key);
    }

    function getGroupStudentCount(key) {
        if (!isNonEmptyString(key)) {
            return 0;
        }
        return GroupCore.getGroupStudentCount(key);
    }

    function getGroupSlotCount(key) {
        if (!isNonEmptyString(key)) {
            return 0;
        }
        return GroupCore.getGroupSlotCount(key);
    }

    function isStudentInGroup(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId)) {
            return false;
        }
        return GroupCore.isStudentInGroup(key, studentId);
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

    function getGroupDisciplineName(key) {
        var group = getAutoGroup(key);
        if (!group) {
            return 'Unknown';
        }
        var discipline = AcademyQueries.getDiscipline(group.disciplineId);
        return discipline ? discipline.name : 'Unknown';
    }

    function getGroupInstructorName(key) {
        var group = getAutoGroup(key);
        if (!group) {
            return 'Unknown';
        }
        var instructor = AcademyQueries.getCharacterById(group.instructorId);
        return instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';
    }

    // ============================================================
    // GROUP MUTATIONS
    // ============================================================

    function createAutoGroup(disciplineId, instructorId) {
        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var result = GroupCore.createAutoGroup(disciplineId, instructorId);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to create auto-group.' };
        }

        return result;
    }

    function deleteAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var result = GroupCore.deleteAutoGroup(key);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to delete auto-group.' };
        }

        return result;
    }

    function addStudentToAutoGroup(key, studentId, options) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var student = AcademyQueries.getCharacterById(studentId);
        if (!student) {
            return { success: false, message: 'Student not found.' };
        }

        var result = GroupCore.addStudentToGroup(key, studentId, options || {});

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to add student to auto-group.' };
        }

        return result;
    }

    function removeStudentFromAutoGroup(key, studentId) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        if (!GroupCore.isStudentInGroup(key, studentId)) {
            return { success: false, message: 'Student is not in this group.' };
        }

        var result = GroupCore.removeStudentFromGroup(key, studentId);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to remove student from auto-group.' };
        }

        return result;
    }

    function addSlotToAutoGroup(key, week, day, hour, duration, label) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { success: false, message: 'Valid day is required (1-7).' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { success: false, message: 'Valid hour is required (0-23).' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var result = GroupCore.addSlotToGroup(key, weekNum, dayNum, hourNum, durationNum, label);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to add slot to auto-group.' };
        }

        return result;
    }

    function removeSlotFromAutoGroup(key, week, day, hour) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { success: false, message: 'Valid day is required (1-7).' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { success: false, message: 'Valid hour is required (0-23).' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var result = GroupCore.removeSlotFromGroup(key, weekNum, dayNum, hourNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to remove slot from auto-group.' };
        }

        return result;
    }

    function rebuildAutoGroups() {
        var result = GroupCore.rebuildGroupsFromSchedules();

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to rebuild auto-groups.' };
        }

        return result;
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    function addStudentsToAutoGroup(key, studentIds) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return { success: false, message: 'At least one student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var results = {
            success: true,
            total: studentIds.length,
            added: 0,
            failed: 0,
            errors: []
        };

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            var result = addStudentToAutoGroup(key, studentId);

            if (result && result.success) {
                results.added++;
            } else {
                results.failed++;
                var student = AcademyQueries.getCharacterById(studentId);
                var name = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
                results.errors.push(name + ': ' + (result ? result.message : 'Unknown error'));
            }
        }

        if (results.failed > 0) {
            results.message = 'Added ' + results.added + ' of ' + results.total + ' students. Errors: ' + results.errors.join('; ');
        } else {
            results.message = 'Added ' + results.added + ' students.';
        }

        return results;
    }

    function removeStudentsFromAutoGroup(key, studentIds) {
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return { success: false, message: 'At least one student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var results = {
            success: true,
            total: studentIds.length,
            removed: 0,
            failed: 0,
            errors: []
        };

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            var result = removeStudentFromAutoGroup(key, studentId);

            if (result && result.success) {
                results.removed++;
            } else {
                results.failed++;
                var student = AcademyQueries.getCharacterById(studentId);
                var name = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
                results.errors.push(name + ': ' + (result ? result.message : 'Unknown error'));
            }
        }

        if (results.failed > 0) {
            results.message = 'Removed ' + results.removed + ' of ' + results.total + ' students. Errors: ' + results.errors.join('; ');
        } else {
            results.message = 'Removed ' + results.removed + ' students.';
        }

        return results;
    }

    // ============================================================
    // GROUP SUMMARY HELPERS
    // ============================================================

    function getGroupSummary(key) {
        var group = getAutoGroup(key);
        if (!group) {
            return null;
        }

        var discipline = AcademyQueries.getDiscipline(group.disciplineId);
        var instructor = AcademyQueries.getCharacterById(group.instructorId);

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

        // Sort by name
        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

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

        // Sort by day, then hour
        result.sort(function(a, b) {
            if (a.day !== b.day) {
                return a.day - b.day;
            }
            return a.hour - b.hour;
        });

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
        getGroupDisciplineName: getGroupDisciplineName,
        getGroupInstructorName: getGroupInstructorName,
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries,
        getGroupSlotsByWeek: getGroupSlotsByWeek,
        getGroupsForWeek: getGroupsForWeek,

        // Mutations
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToAutoGroup: addStudentToAutoGroup,
        removeStudentFromAutoGroup: removeStudentFromAutoGroup,
        addSlotToAutoGroup: addSlotToAutoGroup,
        removeSlotFromAutoGroup: removeSlotFromAutoGroup,
        rebuildAutoGroups: rebuildAutoGroups,

        // Bulk operations
        addStudentsToAutoGroup: addStudentsToAutoGroup,
        removeStudentsFromAutoGroup: removeStudentsFromAutoGroup,

        // Validation
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration
    };

})();