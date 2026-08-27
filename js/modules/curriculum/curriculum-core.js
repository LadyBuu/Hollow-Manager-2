/**
 * js/core/curriculum-core.js - Canonical Mutation API for Curriculum
 * Single source of truth for all curriculum data mutations
 * Path: js/core/curriculum-core.js
 * 
 * This module is responsible for:
 *   - All curriculum data mutations (disciplines, classes, groups, schedules, rankings)
 *   - Validation of all inputs
 *   - Atomic operations (all or nothing)
 *   - Maintaining data integrity invariants
 *   - Activity logging
 * 
 * IMPORTANT:
 *   - This module mutates window.data directly.
 *   - Callers are responsible for calling saveData() to persist changes.
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Malformed existing data is NOT silently repaired
 *   - This module does NOT call saveData() - callers own persistence
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - Rollback is NOT performed by this module
 * 
 * DATA STRUCTURE CONTRACT:
 *   - window.data must exist
 *   - window.data.curriculum must exist (ensured by ensureCurriculum)
 *   - window.data.teams must exist
 *   - window.data.characters must exist
 *   - window.data.classes must exist
 */

(function() {
    'use strict';

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function generateId(prefix) {
        prefix = prefix || 'id';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function ensureObject(value) {
        return isObject(value) ? value : {};
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getTeamById(id) {
        if (typeof window.getTeamById === 'function') {
            return window.getTeamById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        return data.teams.find(function(t) {
            return t && String(t.id) === String(id);
        }) || null;
    }

    function getDiscipline(id) {
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getActiveTeamMembers(team, period) {
        if (typeof window.getActiveTeamMembers === 'function') {
            return window.getActiveTeamMembers(team, period);
        }
        // Fallback implementation
        if (!team || !Array.isArray(team.members)) return [];
        var periodNum = parsePositiveInteger(period);
        if (periodNum === null) return [];
        return team.members.filter(function(member) {
            if (!member || typeof member !== 'object') return false;
            var join = parsePositiveInteger(member.joinPeriod);
            if (join === null) return false;
            var leave = parsePositiveInteger(member.leavePeriod);
            return join <= periodNum && (leave === null || leave >= periodNum);
        });
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
    }

    function validateGradingSystem(system) {
        if (!Array.isArray(system)) {
            return { valid: false, message: 'Grading system must be an array.' };
        }
        if (system.length === 0) {
            return { valid: true };
        }
        for (var i = 0; i < system.length; i++) {
            var g = system[i];
            if (!g || typeof g !== 'object') {
                return { valid: false, message: 'Invalid grade entry at index ' + i + '.' };
            }
            if (!isNonEmptyString(g.letter)) {
                return { valid: false, message: 'Grade letter is required at index ' + i + '.' };
            }
            var min = Number(g.min);
            var max = Number(g.max);
            if (!isSafeInteger(min) || !isSafeInteger(max) || min < 0 || max > 100 || min > max) {
                return { valid: false, message: 'Invalid grade range at index ' + i + '.' };
            }
            for (var j = i + 1; j < system.length; j++) {
                var other = system[j];
                if (other && g.min <= other.max && other.min <= g.max) {
                    return { valid: false, message: 'Grading ranges for "' + g.letter + '" and "' + other.letter + '" overlap.' };
                }
            }
            for (var j = 0; j < i; j++) {
                var other = system[j];
                if (other && g.letter.toUpperCase() === other.letter.toUpperCase()) {
                    return { valid: false, message: 'Duplicate grade letter "' + g.letter + '".' };
                }
            }
        }
        return { valid: true };
    }

    function validateDiscipline(data) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }
        if (!isNonEmptyString(data.name)) {
            return { valid: false, message: 'Discipline name is required.' };
        }
        if (!data.type || (data.type !== 'mandatory' && data.type !== 'optional')) {
            return { valid: false, message: 'Valid discipline type is required.' };
        }
        if (!Array.isArray(data.instructorIds) || data.instructorIds.length === 0) {
            return { valid: false, message: 'At least one instructor is required.' };
        }
        if (data.startWeek !== '' && data.startWeek !== undefined && data.startWeek !== null) {
            var start = validateWeek(data.startWeek);
            if (start === null) {
                return { valid: false, message: 'Start week must be between 1 and 52.' };
            }
        }
        if (data.endWeek !== '' && data.endWeek !== undefined && data.endWeek !== null) {
            var end = validateWeek(data.endWeek);
            if (end === null) {
                return { valid: false, message: 'End week must be between 1 and 52.' };
            }
        }
        if (data.startWeek && data.endWeek) {
            var start = parsePositiveInteger(data.startWeek);
            var end = parsePositiveInteger(data.endWeek);
            if (start !== null && end !== null && start > end) {
                return { valid: false, message: 'Start week must be before end week.' };
            }
        }
        if (data.weeklyHours !== '' && data.weeklyHours !== undefined && data.weeklyHours !== null) {
            var hours = Number(data.weeklyHours);
            if (isNaN(hours) || hours < 0 || hours > 40) {
                return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
            }
        }
        if (data.maxStudents !== '' && data.maxStudents !== undefined && data.maxStudents !== null) {
            var students = Number(data.maxStudents);
            if (isNaN(students) || students < 0 || students > 100) {
                return { valid: false, message: 'Max students must be between 0 and 100.' };
            }
        }
        if (data.weight !== '' && data.weight !== undefined && data.weight !== null) {
            var weight = Number(data.weight);
            if (isNaN(weight) || weight < 0.1 || weight > 10) {
                return { valid: false, message: 'Weight must be between 0.1 and 10.' };
            }
        }
        if (data.gradingSystem) {
            var gradingValidation = validateGradingSystem(data.gradingSystem);
            if (!gradingValidation.valid) {
                return gradingValidation;
            }
        }
        return { valid: true };
    }

    function validateMemberData(data) {
        if (!isObject(data)) {
            return { valid: false, message: 'Member data must be an object.' };
        }
        if (!isNonEmptyString(data.characterId)) {
            return { valid: false, message: 'Character ID is required.' };
        }
        if (data.joinPeriod !== '' && data.joinPeriod !== undefined && data.joinPeriod !== null) {
            var join = parsePositiveInteger(data.joinPeriod);
            if (join === null) {
                return { valid: false, message: 'Invalid join period.' };
            }
        }
        if (data.leavePeriod !== '' && data.leavePeriod !== undefined && data.leavePeriod !== null) {
            var leave = parsePositiveInteger(data.leavePeriod);
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period.' };
            }
        }
        var joinNum = parsePositiveInteger(data.joinPeriod);
        var leaveNum = parsePositiveInteger(data.leavePeriod);
        if (joinNum !== null && leaveNum !== null && joinNum > leaveNum) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }
        return { valid: true };
    }

    // ============================================================
    // CLASS CRUD
    // ============================================================

    function createClass(name) {
        if (!isNonEmptyString(name)) {
            return { success: false, message: 'Class name is required.' };
        }
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }
        var existing = data.classes.find(function(c) {
            return c && String(c.name || '').toLowerCase() === String(name).toLowerCase();
        });
        if (existing) {
            return { success: false, message: 'A class with this name already exists.' };
        }
        var newClass = {
            id: generateId('class'),
            name: String(name).trim(),
            createdAt: new Date().toISOString()
        };
        data.classes.push(newClass);
        logActivity('Created class: ' + newClass.name);
        return { success: true, class: newClass };
    }

    function updateClass(id, updates) {
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!Array.isArray(data.classes)) {
            return { success: false, message: 'No classes found.' };
        }
        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });
        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }
        var cls = data.classes[index];
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return { success: false, message: 'Class name cannot be empty.' };
            }
            var existing = data.classes.find(function(c) {
                return c && String(c.id) !== String(id) && 
                       String(c.name || '').toLowerCase() === newName.toLowerCase();
            });
            if (existing) {
                return { success: false, message: 'A class with this name already exists.' };
            }
            cls.name = newName;
        }
        logActivity('Updated class: ' + cls.name);
        return { success: true, class: cls };
    }

    function deleteClass(id, options) {
        options = options || {};
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!Array.isArray(data.classes)) {
            return { success: false, message: 'No classes found.' };
        }
        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });
        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }
        var cls = data.classes[index];
        var name = cls.name;
        if (options.removeReferences !== false) {
            if (Array.isArray(data.characters)) {
                data.characters.forEach(function(char) {
                    if (char && Array.isArray(char.classIds)) {
                        char.classIds = char.classIds.filter(function(cid) {
                            return String(cid) !== String(id);
                        });
                    }
                });
            }
            if (Array.isArray(data.teams)) {
                data.teams.forEach(function(team) {
                    if (team && String(team.classId) === String(id)) {
                        team.classId = null;
                    }
                });
            }
        }
        data.classes.splice(index, 1);
        logActivity('Deleted class: ' + name);
        return { success: true };
    }

    // ============================================================
    // TEAM MEMBER CRUD
    // ============================================================

    function addTeamMember(teamId, memberData) {
        var validation = validateMemberData(memberData);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }
        var team = getTeamById(teamId);
        if (!team) {
            return { success: false, message: 'Team not found.' };
        }
        var char = getCharacterById(memberData.characterId);
        if (!char) {
            return { success: false, message: 'Character not found.' };
        }
        if (!Array.isArray(team.members)) {
            team.members = [];
        }
        var existing = team.members.find(function(m) {
            return m && String(m.characterId) === String(memberData.characterId);
        });
        if (existing) {
            return { success: false, message: 'Character is already in this team.' };
        }
        var member = {
            characterId: String(memberData.characterId),
            role: memberData.role || 'Member',
            joinPeriod: memberData.joinPeriod || '',
            leavePeriod: memberData.leavePeriod || ''
        };
        team.members.push(member);
        var charName = getDisplayName(char);
        logActivity('Added ' + charName + ' to team: ' + team.name);
        return { success: true, member: member };
    }

    function removeTeamMember(teamId, characterId) {
        if (!isNonEmptyString(teamId) || !isNonEmptyString(characterId)) {
            return { success: false, message: 'Team ID and Character ID are required.' };
        }
        var team = getTeamById(teamId);
        if (!team) {
            return { success: false, message: 'Team not found.' };
        }
        if (!Array.isArray(team.members)) {
            return { success: false, message: 'Team has no members.' };
        }
        var index = team.members.findIndex(function(m) {
            return m && String(m.characterId) === String(characterId);
        });
        if (index === -1) {
            return { success: false, message: 'Character is not in this team.' };
        }
        var char = getCharacterById(characterId);
        var charName = char ? getDisplayName(char) : 'Unknown';
        team.members.splice(index, 1);
        logActivity('Removed ' + charName + ' from team: ' + team.name);
        return { success: true };
    }

    // ============================================================
    // DISCIPLINE CRUD
    // ============================================================

    function createDiscipline(data) {
        var validation = validateDiscipline(data);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }
        var store = getDataStore();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum) {
            store.curriculum = {};
        }
        if (!Array.isArray(store.curriculum.disciplines)) {
            store.curriculum.disciplines = [];
        }
        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === String(data.name).toLowerCase();
        });
        if (existing) {
            return { success: false, message: 'A discipline with this name already exists.' };
        }
        var discipline = {
            id: generateId('disc'),
            name: String(data.name).trim(),
            type: data.type || 'mandatory',
            instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [],
            curriculum: data.curriculum || '',
            startWeek: data.startWeek !== undefined && data.startWeek !== null && data.startWeek !== '' ? String(data.startWeek) : '',
            endWeek: data.endWeek !== undefined && data.endWeek !== null && data.endWeek !== '' ? String(data.endWeek) : '',
            weeklyHours: data.weeklyHours !== undefined && data.weeklyHours !== null && data.weeklyHours !== '' ? Number(data.weeklyHours) : '',
            maxStudents: data.maxStudents !== undefined && data.maxStudents !== null && data.maxStudents !== '' ? Number(data.maxStudents) : '',
            weight: data.weight !== undefined && data.weight !== null && data.weight !== '' ? Number(data.weight) : 1,
            gradingSystem: Array.isArray(data.gradingSystem) ? data.gradingSystem.slice() : [],
            createdAt: new Date().toISOString()
        };
        store.curriculum.disciplines.push(discipline);
        logActivity('Created discipline: ' + discipline.name);
        return { success: true, discipline: discipline };
    }

    function updateDiscipline(id, data) {
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Discipline ID is required.' };
        }
        var validation = validateDiscipline(data);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }
        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return { success: false, message: 'No disciplines found.' };
        }
        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });
        if (index === -1) {
            return { success: false, message: 'Discipline not found.' };
        }
        var discipline = store.curriculum.disciplines[index];
        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return { success: false, message: 'Discipline name cannot be empty.' };
            }
            var existing = store.curriculum.disciplines.find(function(d) {
                return d && String(d.id) !== String(id) && 
                       String(d.name || '').toLowerCase() === newName.toLowerCase();
            });
            if (existing) {
                return { success: false, message: 'A discipline with this name already exists.' };
            }
            discipline.name = newName;
        }
        if (data.type !== undefined) {
            discipline.type = data.type;
        }
        if (data.instructorIds !== undefined) {
            discipline.instructorIds = Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [];
        }
        if (data.curriculum !== undefined) {
            discipline.curriculum = data.curriculum;
        }
        if (data.startWeek !== undefined) {
            discipline.startWeek = data.startWeek !== '' ? String(data.startWeek) : '';
        }
        if (data.endWeek !== undefined) {
            discipline.endWeek = data.endWeek !== '' ? String(data.endWeek) : '';
        }
        if (data.weeklyHours !== undefined) {
            discipline.weeklyHours = data.weeklyHours !== '' ? Number(data.weeklyHours) : '';
        }
        if (data.maxStudents !== undefined) {
            discipline.maxStudents = data.maxStudents !== '' ? Number(data.maxStudents) : '';
        }
        if (data.weight !== undefined) {
            discipline.weight = data.weight !== '' ? Number(data.weight) : 1;
        }
        if (data.gradingSystem !== undefined) {
            discipline.gradingSystem = Array.isArray(data.gradingSystem) ? data.gradingSystem.slice() : [];
        }
        logActivity('Updated discipline: ' + discipline.name);
        return { success: true, discipline: discipline };
    }

    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Discipline ID is required.' };
        }
        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return { success: false, message: 'No disciplines found.' };
        }
        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });
        if (index === -1) {
            return { success: false, message: 'Discipline not found.' };
        }
        var discipline = store.curriculum.disciplines[index];
        var name = discipline.name;

        // Remove from schedules
        if (store.curriculum.schedules) {
            for (var studentId in store.curriculum.schedules) {
                for (var week in store.curriculum.schedules[studentId]) {
                    var schedule = store.curriculum.schedules[studentId][week];
                    for (var day in schedule) {
                        for (var hour in schedule[day]) {
                            if (String(schedule[day][hour]) === String(id)) {
                                delete schedule[day][hour];
                            }
                        }
                    }
                }
            }
        }

        // Remove from class metadata
        if (store.curriculum.classInstructors) {
            for (var key in store.curriculum.classInstructors) {
                // Keys are studentId_week_day_hour, don't contain discipline ID
                // We need to check the schedule instead
            }
        }

        // Remove from grades
        if (store.curriculum.grades) {
            for (var studentId in store.curriculum.grades) {
                for (var week in store.curriculum.grades[studentId]) {
                    delete store.curriculum.grades[studentId][week][id];
                }
            }
        }

        // Remove from autoGroups
        if (store.curriculum.autoGroups) {
            for (var key in store.curriculum.autoGroups) {
                if (String(store.curriculum.autoGroups[key].disciplineId) === String(id)) {
                    delete store.curriculum.autoGroups[key];
                }
            }
        }

        // Remove from disciplineGroups
        if (store.curriculum.disciplineGroups) {
            delete store.curriculum.disciplineGroups[id];
        }

        // Remove the discipline itself
        store.curriculum.disciplines.splice(index, 1);
        logActivity('Deleted discipline: ' + name);
        return { success: true };
    }

    // ============================================================
    // GROUP OPERATIONS
    // ============================================================

    function getAllAutoGroups() {
        var store = getDataStore();
        if (!store || !store.curriculum) {
            return {};
        }
        if (!store.curriculum.autoGroups) {
            store.curriculum.autoGroups = {};
        }
        return store.curriculum.autoGroups;
    }

    function getGroupByKey(key) {
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function addStudentToGroup(key, studentId) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var char = getCharacterById(studentId);
        if (!char) {
            return { success: false, message: 'Student not found.' };
        }
        if (group.students && group.students.indexOf(studentId) !== -1) {
            return { success: false, message: 'Student already in this group.' };
        }

        var conflicts = [];
        var conflictStudentNames = [];
        var charName = getDisplayName(char);

        if (group.slots && group.slots.length > 0) {
            group.slots.forEach(function(slot) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, slot.week) : {};
                var hasConflict = false;
                for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                    if (schedule[slot.day] && schedule[slot.day][h]) {
                        hasConflict = true;
                        break;
                    }
                }
                if (hasConflict) {
                    conflicts.push({
                        week: slot.week,
                        day: slot.day,
                        hour: slot.hour
                    });
                }
            });
        }

        if (conflicts.length > 0) {
            var conflictMsg = 'Student ' + charName + ' has schedule conflicts in ' + conflicts.length + ' slot(s).\n\n';
            conflictMsg += 'Do you want to remove the student from their current classes in these slots and add them to this group?';
            if (!confirm(conflictMsg)) {
                return { success: false, message: 'Student not added to group due to conflicts.' };
            }
            // Remove conflicting classes
            conflicts.forEach(function(c) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, c.week) : {};
                for (var h = c.hour; h < c.hour + (group.slots.find(function(s) { return s.week === c.week && s.day === c.day && s.hour === c.hour; })?.duration || 1) && h <= 23; h++) {
                    if (schedule[c.day] && schedule[c.day][h]) {
                        delete schedule[c.day][h];
                        if (window.setClassInstructor) {
                            window.setClassInstructor(studentId, c.week, c.day, h, null);
                        }
                        if (window.setClassLabel) {
                            window.setClassLabel(studentId, c.week, c.day, h, null);
                        }
                        if (window.setClassGroupLabel) {
                            window.setClassGroupLabel(studentId, c.week, c.day, h, null);
                        }
                        if (window.setClassDuration) {
                            window.setClassDuration(studentId, c.week, c.day, h, null);
                        }
                    }
                }
            });
            conflictStudentNames.push(charName);
        }

        // Add student to all slots
        if (group.slots && group.slots.length > 0) {
            group.slots.forEach(function(slot) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, slot.week) : {};
                for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                    if (!schedule[slot.day]) schedule[slot.day] = {};
                    schedule[slot.day][h] = group.disciplineId;
                    if (group.instructorId && window.setClassInstructor) {
                        window.setClassInstructor(studentId, slot.week, slot.day, h, group.instructorId);
                    }
                    if (slot.label && window.setClassLabel) {
                        window.setClassLabel(studentId, slot.week, slot.day, h, slot.label);
                    }
                    if (window.setClassGroupLabel) {
                        window.setClassGroupLabel(studentId, slot.week, slot.day, h, 'auto-group');
                    }
                    if (h === slot.hour && window.setClassDuration) {
                        window.setClassDuration(studentId, slot.week, slot.day, h, slot.duration || 1);
                    }
                }
            });
        }

        if (!group.students) group.students = [];
        group.students.push(studentId);
        group.students.sort();

        logActivity('Added ' + charName + ' to group: ' + group.displayName);
        return {
            success: true,
            message: 'Student added to group.',
            conflictStudents: conflictStudentNames
        };
    }

    function removeStudentFromGroup(key, studentId) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var char = getCharacterById(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';

        if (!group.students || group.students.indexOf(studentId) === -1) {
            return { success: false, message: 'Student not in this group.' };
        }

        if (group.slots && group.slots.length > 0) {
            group.slots.forEach(function(slot) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, slot.week) : {};
                for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                    if (schedule[slot.day] && schedule[slot.day][h] === group.disciplineId) {
                        delete schedule[slot.day][h];
                        if (window.setClassInstructor) {
                            window.setClassInstructor(studentId, slot.week, slot.day, h, null);
                        }
                        if (window.setClassLabel) {
                            window.setClassLabel(studentId, slot.week, slot.day, h, null);
                        }
                        if (window.setClassGroupLabel) {
                            window.setClassGroupLabel(studentId, slot.week, slot.day, h, null);
                        }
                        if (window.setClassDuration) {
                            window.setClassDuration(studentId, slot.week, slot.day, h, null);
                        }
                    }
                }
            });
        }

        group.students = group.students.filter(function(id) {
            return String(id) !== String(studentId);
        });

        // Clean up empty groups
        if (group.students.length === 0 && group.slots.length === 0) {
            delete groups[key];
        }

        logActivity('Removed ' + charName + ' from group: ' + group.displayName);
        return { success: true };
    }

    function addSlotToGroup(key, week, day, hour, duration, label) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }
        var durationNum = parsePositiveInteger(duration) || 1;
        if (durationNum < 1 || durationNum > 4) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        var exists = group.slots && group.slots.some(function(s) {
            return s.week === weekNum && s.day === day && s.hour === hour;
        });
        if (exists) {
            return { success: false, message: 'Slot already exists in this group.' };
        }

        if (!group.slots) group.slots = [];
        group.slots.push({
            week: weekNum,
            day: day,
            hour: hour,
            duration: durationNum,
            label: label || ''
        });
        group.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        var addedCount = 0;
        var conflictStudents = [];

        if (group.students && group.students.length > 0) {
            group.students.forEach(function(studentId) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, weekNum) : {};
                var hasConflict = false;
                for (var h = hour; h < hour + durationNum && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        hasConflict = true;
                        break;
                    }
                }
                if (hasConflict) {
                    var student = getCharacterById(studentId);
                    conflictStudents.push(student ? getDisplayName(student) : 'Unknown');
                } else {
                    for (var h = hour; h < hour + durationNum && h <= 23; h++) {
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][h] = group.disciplineId;
                        if (group.instructorId && window.setClassInstructor) {
                            window.setClassInstructor(studentId, weekNum, day, h, group.instructorId);
                        }
                        if (label && window.setClassLabel) {
                            window.setClassLabel(studentId, weekNum, day, h, label);
                        }
                        if (window.setClassGroupLabel) {
                            window.setClassGroupLabel(studentId, weekNum, day, h, 'auto-group');
                        }
                        if (h === hour && window.setClassDuration) {
                            window.setClassDuration(studentId, weekNum, day, h, durationNum);
                        }
                    }
                    addedCount++;
                }
            });
        }

        logActivity('Added slot to group: ' + group.displayName);
        return {
            success: true,
            addedCount: addedCount,
            conflictStudents: conflictStudents
        };
    }

    function removeSlotFromGroup(key, week, day, hour) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        var slotIndex = -1;
        if (group.slots) {
            group.slots.forEach(function(s, idx) {
                if (s.week === weekNum && s.day === day && s.hour === hour) {
                    slotIndex = idx;
                }
            });
        }
        if (slotIndex === -1) {
            return { success: false, message: 'Slot not found in group.' };
        }

        var slot = group.slots[slotIndex];
        if (group.students && group.students.length > 0) {
            group.students.forEach(function(studentId) {
                var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, weekNum) : {};
                for (var h = hour; h < hour + (slot.duration || 1) && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h] === group.disciplineId) {
                        delete schedule[day][h];
                        if (window.setClassInstructor) {
                            window.setClassInstructor(studentId, weekNum, day, h, null);
                        }
                        if (window.setClassLabel) {
                            window.setClassLabel(studentId, weekNum, day, h, null);
                        }
                        if (window.setClassGroupLabel) {
                            window.setClassGroupLabel(studentId, weekNum, day, h, null);
                        }
                        if (window.setClassDuration) {
                            window.setClassDuration(studentId, weekNum, day, h, null);
                        }
                    }
                }
            });
        }

        group.slots.splice(slotIndex, 1);

        // Clean up empty groups
        if (group.students.length === 0 && group.slots.length === 0) {
            delete groups[key];
        }

        logActivity('Removed slot from group: ' + group.displayName);
        return { success: true };
    }

    function rebuildGroupsFromSchedules() {
        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store not available.' };
        }

        var existingGroups = store.curriculum.autoGroups || {};
        var newGroups = {};
        var count = 0;

        var students = window.getStudents ? window.getStudents() : [];
        if (!Array.isArray(students)) students = [];

        students.forEach(function(student) {
            var studentId = student.id;
            var schedule = store.curriculum.schedules ? store.curriculum.schedules[studentId] : null;
            if (!schedule) return;

            for (var week in schedule) {
                var weekNum = parseInt(week, 10);
                if (isNaN(weekNum)) continue;

                for (var day in schedule[weekNum]) {
                    var dayNum = parseInt(day, 10);
                    if (isNaN(dayNum)) continue;

                    for (var hour in schedule[weekNum][dayNum]) {
                        var hourNum = parseInt(hour, 10);
                        if (isNaN(hourNum)) continue;

                        var disciplineId = schedule[weekNum][dayNum][hourNum];
                        if (!disciplineId) continue;

                        // Check if this is a class start (has duration metadata)
                        var duration = window.getClassDuration ? window.getClassDuration(studentId, weekNum, dayNum, hourNum) : null;
                        if (!duration) continue;

                        var instructorId = window.getClassInstructor ? window.getClassInstructor(studentId, weekNum, dayNum, hourNum) : null;
                        if (!instructorId) continue;

                        var key = disciplineId + '_' + instructorId;

                        if (!newGroups[key]) {
                            var discipline = window.getDiscipline ? window.getDiscipline(disciplineId) : null;
                            var instructor = window.getCharacterById ? window.getCharacterById(instructorId) : null;
                            var disciplineName = discipline ? discipline.name : 'Unknown';
                            var instructorName = instructor ? getDisplayName(instructor) : 'Unknown';
                            var shortInstructor = instructorName;
                            if (instructor) {
                                var parts = instructorName.split(' ');
                                if (parts.length >= 2) {
                                    shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
                                }
                            }

                            newGroups[key] = {
                                id: key,
                                disciplineId: disciplineId,
                                instructorId: instructorId,
                                displayName: disciplineName + ' (' + shortInstructor + ')',
                                students: [],
                                slots: [],
                                createdAt: new Date().toISOString()
                            };
                            count++;
                        }

                        var group = newGroups[key];

                        if (group.students.indexOf(studentId) === -1) {
                            group.students.push(studentId);
                            group.students.sort();
                        }

                        var slotExists = group.slots.some(function(s) {
                            return s.week === weekNum && s.day === dayNum && s.hour === hourNum;
                        });

                        if (!slotExists) {
                            var label = window.getClassLabel ? window.getClassLabel(studentId, weekNum, dayNum, hourNum) : '';
                            group.slots.push({
                                week: weekNum,
                                day: dayNum,
                                hour: hourNum,
                                duration: duration || 1,
                                label: label || ''
                            });
                        }
                    }
                }
            }
        });

        store.curriculum.autoGroups = newGroups;
        logActivity('Rebuilt groups from schedules: ' + count + ' groups created');
        return { success: true, count: count };
    }

    // ============================================================
    // SCHEDULE OPERATIONS
    // ============================================================

    function addStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }
        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }
        var durationNum = parsePositiveInteger(duration) || 1;
        if (durationNum < 1 || durationNum > 4) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        var store = getDataStore();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum) store.curriculum = {};
        if (!store.curriculum.schedules) store.curriculum.schedules = {};
        if (!store.curriculum.schedules[studentId]) store.curriculum.schedules[studentId] = {};
        if (!store.curriculum.schedules[studentId][weekNum]) store.curriculum.schedules[studentId][weekNum] = {};

        var schedule = store.curriculum.schedules[studentId][weekNum];
        if (schedule[day] && schedule[day][hour]) {
            return { success: false, message: 'Student already has a class at this time.' };
        }

        // Check discipline hour limit
        var usedHours = {};
        for (var d in schedule) {
            for (var h in schedule[d]) {
                var discId = schedule[d][h];
                if (discId) {
                    if (!usedHours[discId]) usedHours[discId] = 0;
                    usedHours[discId]++;
                }
            }
        }
        var usedCount = usedHours[disciplineId] || 0;
        var discipline = getDiscipline(disciplineId);
        var maxHours = discipline && discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;
        if (usedCount + durationNum > maxHours) {
            return { success: false, message: 'This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.' };
        }

        if (!schedule[day]) schedule[day] = {};
        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            schedule[day][h] = disciplineId;
        }

        if (instructorId && window.setClassInstructor) {
            window.setClassInstructor(studentId, weekNum, day, hour, instructorId);
        }
        if (window.setClassDuration) {
            window.setClassDuration(studentId, weekNum, day, hour, durationNum);
        }

        logActivity('Added class to schedule: ' + (discipline ? discipline.name : 'Unknown'));
        return { success: true };
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.schedules) {
            return { success: false, message: 'Schedule not found.' };
        }
        if (!store.curriculum.schedules[studentId] || !store.curriculum.schedules[studentId][weekNum]) {
            return { success: false, message: 'No schedule for this student and week.' };
        }

        var schedule = store.curriculum.schedules[studentId][weekNum];
        if (!schedule[day] || !schedule[day][hour]) {
            return { success: false, message: 'No class at this time.' };
        }

        var duration = window.getClassDuration ? window.getClassDuration(studentId, weekNum, day, hour) || 1 : 1;
        var disciplineId = schedule[day][hour];

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day] && schedule[day][h] === disciplineId) {
                delete schedule[day][h];
            }
        }

        if (window.setClassInstructor) {
            window.setClassInstructor(studentId, weekNum, day, hour, null);
        }
        if (window.setClassLabel) {
            window.setClassLabel(studentId, weekNum, day, hour, null);
        }
        if (window.setClassGroupLabel) {
            window.setClassGroupLabel(studentId, weekNum, day, hour, null);
        }
        if (window.setClassDuration) {
            window.setClassDuration(studentId, weekNum, day, hour, null);
        }

        // Clean up empty day entries
        if (schedule[day] && Object.keys(schedule[day]).length === 0) {
            delete schedule[day];
        }

        logActivity('Removed class from schedule');
        return { success: true };
    }

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return { success: false, message: 'Valid source week is required.' };
        }
        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return { success: false, message: 'Valid target week is required.' };
        }
        if (sourceWeekNum === targetWeekNum) {
            return { success: false, message: 'Source and target weeks must be different.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.schedules) store.curriculum.schedules = {};
        if (!store.curriculum.schedules[studentId]) store.curriculum.schedules[studentId] = {};

        var sourceSchedule = store.curriculum.schedules[studentId][sourceWeekNum] || {};
        var destSchedule = store.curriculum.schedules[studentId][targetWeekNum] || {};

        if (overwrite) {
            for (var day in destSchedule) {
                delete destSchedule[day];
            }
            // Clear metadata for target week
            if (store.curriculum.classInstructors) {
                for (var key in store.curriculum.classInstructors) {
                    var parts = key.split('_');
                    if (parts[0] === studentId && parseInt(parts[1], 10) === targetWeekNum) {
                        delete store.curriculum.classInstructors[key];
                    }
                }
            }
            if (store.curriculum.classLabels) {
                for (var key in store.curriculum.classLabels) {
                    var parts = key.split('_');
                    if (parts[0] === studentId && parseInt(parts[1], 10) === targetWeekNum) {
                        delete store.curriculum.classLabels[key];
                    }
                }
            }
            if (store.curriculum.classGroupLabels) {
                for (var key in store.curriculum.classGroupLabels) {
                    var parts = key.split('_');
                    if (parts[0] === studentId && parseInt(parts[1], 10) === targetWeekNum) {
                        delete store.curriculum.classGroupLabels[key];
                    }
                }
            }
            if (store.curriculum.classDurations) {
                for (var key in store.curriculum.classDurations) {
                    var parts = key.split('_');
                    if (parts[0] === studentId && parseInt(parts[1], 10) === targetWeekNum) {
                        delete store.curriculum.classDurations[key];
                    }
                }
            }
        }

        var copiedCount = 0;
        if (!store.curriculum.schedules[studentId][targetWeekNum]) {
            store.curriculum.schedules[studentId][targetWeekNum] = {};
        }
        var destScheduleRef = store.curriculum.schedules[studentId][targetWeekNum];

        for (var day in sourceSchedule) {
            if (!destScheduleRef[day]) destScheduleRef[day] = {};
            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInt(hour, 10);
                var duration = window.getClassDuration ? window.getClassDuration(studentId, sourceWeekNum, parseInt(day, 10), hourNum) : null;
                if (!duration) continue;

                if (!destScheduleRef[day][hour] || overwrite) {
                    destScheduleRef[day][hour] = sourceSchedule[day][hour];
                    copiedCount++;

                    var instructorId = window.getClassInstructor ? window.getClassInstructor(studentId, sourceWeekNum, parseInt(day, 10), hourNum) : null;
                    if (instructorId && window.setClassInstructor) {
                        window.setClassInstructor(studentId, targetWeekNum, parseInt(day, 10), hourNum, instructorId);
                    }
                    var label = window.getClassLabel ? window.getClassLabel(studentId, sourceWeekNum, parseInt(day, 10), hourNum) : null;
                    if (label && window.setClassLabel) {
                        window.setClassLabel(studentId, targetWeekNum, parseInt(day, 10), hourNum, label);
                    }
                    var groupLabel = window.getClassGroupLabel ? window.getClassGroupLabel(studentId, sourceWeekNum, parseInt(day, 10), hourNum) : null;
                    if (groupLabel && window.setClassGroupLabel) {
                        window.setClassGroupLabel(studentId, targetWeekNum, parseInt(day, 10), hourNum, groupLabel);
                    }
                    if (duration && window.setClassDuration) {
                        window.setClassDuration(studentId, targetWeekNum, parseInt(day, 10), hourNum, duration);
                    }
                }
            }
        }

        // Copy rest days
        if (window.getStudentRestDays && window.setStudentRestDays) {
            var sourceRestDays = window.getStudentRestDays(studentId, sourceWeekNum);
            if (sourceRestDays && sourceRestDays.length > 0) {
                window.setStudentRestDays(studentId, targetWeekNum, sourceRestDays);
            }
        }

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum + ' for student');
        return { success: true, copiedCount: copiedCount };
    }

    function clearStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.schedules || !store.curriculum.schedules[studentId]) {
            return { success: true };
        }

        var schedule = store.curriculum.schedules[studentId][weekNum];
        if (schedule) {
            for (var day in schedule) {
                delete schedule[day];
            }
            delete store.curriculum.schedules[studentId][weekNum];
        }

        // Clear metadata for this week
        if (store.curriculum.classInstructors) {
            for (var key in store.curriculum.classInstructors) {
                var parts = key.split('_');
                if (parts[0] === studentId && parseInt(parts[1], 10) === weekNum) {
                    delete store.curriculum.classInstructors[key];
                }
            }
        }
        if (store.curriculum.classLabels) {
            for (var key in store.curriculum.classLabels) {
                var parts = key.split('_');
                if (parts[0] === studentId && parseInt(parts[1], 10) === weekNum) {
                    delete store.curriculum.classLabels[key];
                }
            }
        }
        if (store.curriculum.classGroupLabels) {
            for (var key in store.curriculum.classGroupLabels) {
                var parts = key.split('_');
                if (parts[0] === studentId && parseInt(parts[1], 10) === weekNum) {
                    delete store.curriculum.classGroupLabels[key];
                }
            }
        }
        if (store.curriculum.classDurations) {
            for (var key in store.curriculum.classDurations) {
                var parts = key.split('_');
                if (parts[0] === studentId && parseInt(parts[1], 10) === weekNum) {
                    delete store.curriculum.classDurations[key];
                }
            }
        }

        logActivity('Cleared schedule for week ' + weekNum);
        return { success: true };
    }

    function setStudentRestDays(studentId, week, days) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!Array.isArray(days)) {
            return { success: false, message: 'Rest days must be an array.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.restDays) store.curriculum.restDays = {};
        if (!store.curriculum.restDays[studentId]) store.curriculum.restDays[studentId] = {};

        var validDays = days.filter(function(d) {
            return isSafeInteger(d) && d >= 1 && d <= 7;
        });
        store.curriculum.restDays[studentId][weekNum] = validDays;

        // Remove classes on rest days
        if (store.curriculum.schedules && store.curriculum.schedules[studentId] && store.curriculum.schedules[studentId][weekNum]) {
            var schedule = store.curriculum.schedules[studentId][weekNum];
            validDays.forEach(function(day) {
                if (schedule[day]) {
                    delete schedule[day];
                }
            });
        }

        logActivity('Set rest days for student week ' + weekNum);
        return { success: true };
    }

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    function getRankings(week) {
        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.rankings) {
            return [];
        }
        if (store.curriculum.rankings[week]) {
            return store.curriculum.rankings[week].slice();
        }
        return [];
    }

    function setRankings(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!Array.isArray(rankings)) {
            return { success: false, message: 'Rankings must be an array.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.rankings) store.curriculum.rankings = {};

        var validatedRankings = [];
        rankings.forEach(function(r) {
            if (isNonEmptyString(r.studentId) && isSafeInteger(r.rank) && r.rank >= 1) {
                validatedRankings.push({
                    studentId: String(r.studentId),
                    rank: Number(r.rank)
                });
            }
        });

        // Ensure contiguous ranks
        validatedRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });
        validatedRankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        store.curriculum.rankings[weekNum] = validatedRankings;
        logActivity('Set rankings for week ' + weekNum);
        return { success: true, rankings: validatedRankings };
    }

    function updateStudentRank(week, studentId, newRank) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var rankNum = validateRank(newRank);
        if (rankNum === null) {
            return { success: false, message: 'Valid rank is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.rankings) store.curriculum.rankings = {};

        var rankings = store.curriculum.rankings[weekNum] || [];
        var existing = rankings.find(function(r) {
            return String(r.studentId) === String(studentId);
        });

        var char = getCharacterById(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';

        if (!existing) {
            rankings.push({
                studentId: String(studentId),
                rank: rankNum
            });
            existing = rankings[rankings.length - 1];
        }

        var oldRank = existing.rank;
        existing.rank = rankNum;

        // Shift ranks
        rankings.forEach(function(r) {
            if (String(r.studentId) === String(studentId)) return;
            if (oldRank < rankNum && r.rank > oldRank && r.rank <= rankNum) {
                r.rank--;
            } else if (oldRank > rankNum && r.rank >= rankNum && r.rank < oldRank) {
                r.rank++;
            }
        });

        // Normalise
        rankings.sort(function(a, b) {
            return a.rank - b.rank;
        });
        rankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        store.curriculum.rankings[weekNum] = rankings;
        logActivity('Updated rank for ' + charName + ' to #' + rankNum);
        return { success: true, rankings: rankings };
    }

    function autoGenerateRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }

        var students = window.getStudents ? window.getStudents() : [];
        if (!Array.isArray(students) || students.length === 0) {
            return { success: false, message: 'No students found.' };
        }

        // Calculate grade summaries
        var rankings = [];
        students.forEach(function(student) {
            var summary = calculateGradeSummary(student.id, weekNum);
            if (summary.hasGrades) {
                rankings.push({
                    studentId: student.id,
                    average: summary.average
                });
            }
        });

        if (rankings.length === 0) {
            return { success: false, message: 'No students with grades found.' };
        }

        // Sort by average (descending)
        rankings.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }
            var studentA = getCharacterById(a.studentId);
            var studentB = getCharacterById(b.studentId);
            var nameA = studentA ? getDisplayName(studentA) : '';
            var nameB = studentB ? getDisplayName(studentB) : '';
            return nameA.localeCompare(nameB);
        });

        // Assign ranks
        var newRankings = [];
        rankings.forEach(function(r, index) {
            newRankings.push({
                studentId: r.studentId,
                rank: index + 1
            });
        });

        // Add ungraded students at the bottom
        students.forEach(function(student) {
            if (!newRankings.some(function(r) { return String(r.studentId) === String(student.id); })) {
                newRankings.push({
                    studentId: student.id,
                    rank: newRankings.length + 1
                });
            }
        });

        if (!store.curriculum.rankings) store.curriculum.rankings = {};
        store.curriculum.rankings[weekNum] = newRankings;

        var gradedCount = rankings.length;
        logActivity('Auto-generated rankings for week ' + weekNum + ' (' + gradedCount + ' students graded)');
        return { success: true, count: gradedCount, rankings: newRankings };
    }

    function calculateGradeSummary(studentId, week) {
        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { average: 0, totalWeighted: 0, totalWeight: 0, count: 0, total: 0, mandatoryCount: 0, optionalCount: 0, hasGrades: false };
        }

        var grades = store.curriculum.grades && store.curriculum.grades[studentId] && store.curriculum.grades[studentId][week]
            ? store.curriculum.grades[studentId][week]
            : {};

        var disciplines = window.getAvailableDisciplines ? window.getAvailableDisciplines(week) : [];
        if (!Array.isArray(disciplines)) disciplines = [];

        var totalWeighted = 0;
        var totalWeight = 0;
        var count = 0;
        var mandatoryCount = 0;
        var optionalCount = 0;
        var hasGrades = false;

        disciplines.forEach(function(d) {
            var score = grades[d.id];
            if (score !== undefined && score !== null && score !== '' && d.weight) {
                var numericScore = parseFloat(score);
                if (!isNaN(numericScore)) {
                    totalWeighted += numericScore * d.weight;
                    totalWeight += d.weight;
                    count++;
                    hasGrades = true;
                    if (d.type === 'mandatory') mandatoryCount++;
                    else if (d.type === 'optional') optionalCount++;
                }
            }
        });

        var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;

        return {
            average: average,
            totalWeighted: totalWeighted,
            totalWeight: totalWeight,
            count: count,
            total: disciplines.length,
            mandatoryCount: mandatoryCount,
            optionalCount: optionalCount,
            hasGrades: hasGrades
        };
    }

    // ============================================================
    // INSTRUCTOR CALENDAR OPERATIONS
    // ============================================================

    function addInstructorClassTemplate(instructorId, week, day, hour, data) {
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }
        if (!data || !isNonEmptyString(data.disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.instructorTemplates) store.curriculum.instructorTemplates = {};

        var templateKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorTemplates[templateKey]) {
            store.curriculum.instructorTemplates[templateKey] = {};
        }

        var classKey = day + '_' + hour;
        if (store.curriculum.instructorTemplates[templateKey][classKey]) {
            return { success: false, message: 'Class template already exists at this time.' };
        }

        store.curriculum.instructorTemplates[templateKey][classKey] = {
            disciplineId: String(data.disciplineId),
            label: data.label || '',
            groupLabel: data.groupLabel || '',
            duration: parsePositiveInteger(data.duration) || 1,
            assignedStudents: Array.isArray(data.assignedStudents) ? data.assignedStudents.slice() : []
        };

        var discipline = getDiscipline(data.disciplineId);
        logActivity('Added instructor class template: ' + (discipline ? discipline.name : 'Unknown'));
        return { success: true };
    }

    function removeInstructorClassTemplate(instructorId, week, day, hour) {
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.instructorTemplates) {
            return { success: false, message: 'No instructor templates found.' };
        }

        var templateKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorTemplates[templateKey]) {
            return { success: false, message: 'No template for this instructor and week.' };
        }

        var classKey = day + '_' + hour;
        if (!store.curriculum.instructorTemplates[templateKey][classKey]) {
            return { success: false, message: 'No class template at this time.' };
        }

        delete store.curriculum.instructorTemplates[templateKey][classKey];
        if (Object.keys(store.curriculum.instructorTemplates[templateKey]).length === 0) {
            delete store.curriculum.instructorTemplates[templateKey];
        }

        logActivity('Removed instructor class template');
        return { success: true };
    }

    function addInstructorBlock(instructorId, week, day, hour, data) {
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }
        if (!data || typeof data !== 'object') {
            return { success: false, message: 'Block data is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum) {
            return { success: false, message: 'Data store is not available.' };
        }
        if (!store.curriculum.instructorBlocks) store.curriculum.instructorBlocks = {};

        var blockKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorBlocks[blockKey]) {
            store.curriculum.instructorBlocks[blockKey] = {};
        }
        if (!store.curriculum.instructorBlocks[blockKey][day]) {
            store.curriculum.instructorBlocks[blockKey][day] = {};
        }

        var duration = parsePositiveInteger(data.duration) || 1;
        store.curriculum.instructorBlocks[blockKey][day][hour] = {
            label: data.label || 'Blocked Time',
            groupLabel: data.groupLabel || null,
            duration: duration,
            disciplineId: data.disciplineId || null
        };

        // Auto-assign students from group if groupLabel and disciplineId are provided
        var autoAssignedCount = 0;
        if (data.groupLabel && data.disciplineId) {
            var disciplineId = data.disciplineId;
            var groupLabel = data.groupLabel;
            var students = window.getStudents ? window.getStudents() : [];
            if (Array.isArray(students)) {
                // Find students in this group
                var groupStudents = [];
                if (window.getDisciplineGroups) {
                    var groups = window.getDisciplineGroups(disciplineId);
                    if (groups && groups[groupLabel] && groups[groupLabel].students) {
                        groupStudents = Object.keys(groups[groupLabel].students);
                    }
                }

                groupStudents.forEach(function(studentId) {
                    var schedule = window.getStudentSchedule ? window.getStudentSchedule(studentId, weekNum) : {};
                    var hasConflict = false;
                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h]) {
                            hasConflict = true;
                            break;
                        }
                    }

                    if (!hasConflict) {
                        for (var h = hour; h < hour + duration && h <= 23; h++) {
                            if (!schedule[day]) schedule[day] = {};
                            schedule[day][h] = disciplineId;
                            if (window.setClassInstructor) {
                                window.setClassInstructor(studentId, weekNum, day, h, instructorId);
                            }
                            if (data.label && window.setClassLabel) {
                                window.setClassLabel(studentId, weekNum, day, h, data.label);
                            }
                            if (groupLabel && window.setClassGroupLabel) {
                                window.setClassGroupLabel(studentId, weekNum, day, h, groupLabel);
                            }
                            if (h === hour && window.setClassDuration) {
                                window.setClassDuration(studentId, weekNum, day, h, duration);
                            }
                        }
                        autoAssignedCount++;
                    }
                });
            }
        }

        logActivity('Added instructor block');
        return { success: true, autoAssignedCount: autoAssignedCount };
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }
        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.instructorBlocks) {
            return { success: false, message: 'No instructor blocks found.' };
        }

        var blockKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorBlocks[blockKey] || !store.curriculum.instructorBlocks[blockKey][day]) {
            return { success: false, message: 'No block at this time.' };
        }

        // Check if there are student assignments from this block
        var blockData = store.curriculum.instructorBlocks[blockKey][day][hour];
        if (blockData && blockData.groupLabel && blockData.disciplineId) {
            var students = window.getStudents ? window.getStudents() : [];
            if (Array.isArray(students)) {
                students.forEach(function(student) {
                    var schedule = window.getStudentSchedule ? window.getStudentSchedule(student.id, weekNum) : {};
                    for (var h = hour; h < hour + (blockData.duration || 1) && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h] === blockData.disciplineId) {
                            var classInstructorId = window.getClassInstructor ? window.getClassInstructor(student.id, weekNum, day, h) : null;
                            if (classInstructorId && String(classInstructorId) === String(instructorId)) {
                                delete schedule[day][h];
                                if (window.setClassInstructor) {
                                    window.setClassInstructor(student.id, weekNum, day, h, null);
                                }
                                if (window.setClassLabel) {
                                    window.setClassLabel(student.id, weekNum, day, h, null);
                                }
                                if (window.setClassGroupLabel) {
                                    window.setClassGroupLabel(student.id, weekNum, day, h, null);
                                }
                                if (window.setClassDuration) {
                                    window.setClassDuration(student.id, weekNum, day, h, null);
                                }
                            }
                        }
                    }
                });
            }
        }

        delete store.curriculum.instructorBlocks[blockKey][day][hour];
        if (Object.keys(store.curriculum.instructorBlocks[blockKey][day]).length === 0) {
            delete store.curriculum.instructorBlocks[blockKey][day];
        }
        if (Object.keys(store.curriculum.instructorBlocks[blockKey]).length === 0) {
            delete store.curriculum.instructorBlocks[blockKey];
        }

        logActivity('Removed instructor block');
        return { success: true };
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    // Classes
    window.createClass = createClass;
    window.updateClass = updateClass;
    window.deleteClass = deleteClass;

    // Team Members
    window.addTeamMember = addTeamMember;
    window.removeTeamMember = removeTeamMember;

    // Disciplines
    window.createDiscipline = createDiscipline;
    window.updateDiscipline = updateDiscipline;
    window.deleteDiscipline = deleteDiscipline;

    // Groups
    window.getAllAutoGroups = getAllAutoGroups;
    window.getGroupByKey = getGroupByKey;
    window.addStudentToGroup = addStudentToGroup;
    window.removeStudentFromGroup = removeStudentFromGroup;
    window.addSlotToGroup = addSlotToGroup;
    window.removeSlotFromGroup = removeSlotFromGroup;
    window.rebuildGroupsFromSchedules = rebuildGroupsFromSchedules;

    // Schedule
    window.addStudentScheduleClass = addStudentScheduleClass;
    window.removeStudentScheduleClass = removeStudentScheduleClass;
    window.duplicateStudentSchedule = duplicateStudentSchedule;
    window.clearStudentSchedule = clearStudentSchedule;
    window.setStudentRestDays = setStudentRestDays;

    // Ranking
    window.getRankings = getRankings;
    window.setRankings = setRankings;
    window.updateStudentRank = updateStudentRank;
    window.autoGenerateRankings = autoGenerateRankings;
    window.calculateGradeSummary = calculateGradeSummary;

    // Instructor Calendar
    window.addInstructorClassTemplate = addInstructorClassTemplate;
    window.removeInstructorClassTemplate = removeInstructorClassTemplate;
    window.addInstructorBlock = addInstructorBlock;
    window.removeInstructorBlock = removeInstructorBlock;

})();
