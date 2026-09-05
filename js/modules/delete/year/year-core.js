/**
 * js/modules/year/year-core.js - Year Core Operations
 * Single source of truth for all academic year mutations
 * Path: js/modules/year/year-core.js
 * 
 * This module handles:
 *   - Grade mutations (delegated to GradeCore)
 *   - Ranking mutations (delegated to RankingCore)
 *   - Schedule mutations (delegated to ScheduleCore)
 *   - Group mutations (delegated to GroupCore)
 *   - Class mutations (graduating classes)
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - USES GradeCore for grade operations
 *   - USES RankingCore for ranking operations
 *   - USES ScheduleCore for schedule operations
 *   - USES GroupCore for group operations
 *   - USES MutationUtils for backup and persistence
 * 
 * DEPENDENCIES:
 *   - window.GradeCore (from curriculum-grades.js)
 *   - window.RankingCore (from curriculum-ranking.js)
 *   - window.ScheduleCore (from curriculum-schedule.js)
 *   - window.GroupCore (from curriculum-groups.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.ObjectUtils (from object-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__yearCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var GradeCore = window.GradeCore;
    var RankingCore = window.RankingCore;
    var ScheduleCore = window.ScheduleCore;
    var GroupCore = window.GroupCore;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!GradeCore || typeof GradeCore.saveGrades !== 'function') {
            missing.push('GradeCore.saveGrades');
        }
        if (!GradeCore || typeof GradeCore.getGrades !== 'function') {
            missing.push('GradeCore.getGrades');
        }
        if (!GradeCore || typeof GradeCore.calculateGradeSummary !== 'function') {
            missing.push('GradeCore.calculateGradeSummary');
        }
        if (!GradeCore || typeof GradeCore.getGradeLetter !== 'function') {
            missing.push('GradeCore.getGradeLetter');
        }

        if (!RankingCore || typeof RankingCore.getRankings !== 'function') {
            missing.push('RankingCore.getRankings');
        }
        if (!RankingCore || typeof RankingCore.setRankings !== 'function') {
            missing.push('RankingCore.setRankings');
        }
        if (!RankingCore || typeof RankingCore.autoGenerateRankings !== 'function') {
            missing.push('RankingCore.autoGenerateRankings');
        }
        if (!RankingCore || typeof RankingCore.updateStudentRank !== 'function') {
            missing.push('RankingCore.updateStudentRank');
        }
        if (!RankingCore || typeof RankingCore.removeStudentFromRankings !== 'function') {
            missing.push('RankingCore.removeStudentFromRankings');
        }

        if (!ScheduleCore || typeof ScheduleCore.getStudentSchedule !== 'function') {
            missing.push('ScheduleCore.getStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.setStudentScheduleClass !== 'function') {
            missing.push('ScheduleCore.setStudentScheduleClass');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeStudentScheduleClass !== 'function') {
            missing.push('ScheduleCore.removeStudentScheduleClass');
        }

        if (!GroupCore || typeof GroupCore.getAllAutoGroups !== 'function') {
            missing.push('GroupCore.getAllAutoGroups');
        }
        if (!GroupCore || typeof GroupCore.createAutoGroup !== 'function') {
            missing.push('GroupCore.createAutoGroup');
        }
        if (!GroupCore || typeof GroupCore.addStudentToGroup !== 'function') {
            missing.push('GroupCore.addStudentToGroup');
        }
        if (!GroupCore || typeof GroupCore.removeStudentFromGroup !== 'function') {
            missing.push('GroupCore.removeStudentFromGroup');
        }

        if (!MutationUtils || typeof MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (!MutationUtils || typeof MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('YearCore: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__yearCoreLoaded = true;

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

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateScore(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        return Number.isFinite(num) && num >= 0 && num <= 100;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    // ============================================================
    // GRADE OPERATIONS
    // ============================================================

    function getStudentGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return GradeCore.getGrades(studentId, weekNum);
    }

    function calculateGradeSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        return GradeCore.calculateGradeSummary(studentId, weekNum);
    }

    function getGradeLetter(discipline, score) {
        return GradeCore.getGradeLetter(discipline, score);
    }

    function saveGrades(studentId, week, grades) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isObject(grades)) {
            return failure('Grades must be an object.');
        }

        var validatedGrades = {};
        var invalidDisciplines = [];
        var invalidScores = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var value = grades[disciplineId];

            if (value === undefined || value === null || value === '') {
                validatedGrades[disciplineId] = null;
                continue;
            }

            var discipline = typeof window.getDiscipline === 'function'
                ? window.getDiscipline(disciplineId)
                : null;

            if (!discipline) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            if (!validateScore(value)) {
                invalidScores.push(disciplineId);
                continue;
            }

            validatedGrades[disciplineId] = Math.round(Number(value) * 10) / 10;
        }

        if (invalidDisciplines.length > 0) {
            var disciplineNames = invalidDisciplines.map(function(id) {
                var d = typeof window.getDiscipline === 'function' ? window.getDiscipline(id) : null;
                return d ? d.name : id;
            });
            return failure('Invalid disciplines: ' + disciplineNames.join(', ') + '.');
        }

        if (invalidScores.length > 0) {
            return failure('Invalid scores for: ' + invalidScores.join(', ') + '. Scores must be between 0 and 100.');
        }

        var result = GradeCore.saveGrades(studentId, weekNum, validatedGrades);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to save grades.');
        }

        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var changed = result.changed || false;
        var count = result.count || 0;

        if (changed) {
            recordActivity('Saved grades for ' + studentName + ' week ' + weekNum + ' (' + count + ' changes)');
        }

        return {
            success: true,
            changed: changed,
            count: count,
            data: result.data
        };
    }

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    function getRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        return RankingCore.getRankings(weekNum);
    }

    function getStudentRank(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        return RankingCore.getStudentRank(weekNum, studentId);
    }

    function getRankingCount(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return 0;
        }
        return RankingCore.getRankingCount(weekNum);
    }

    function hasRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }
        return RankingCore.hasRankings(weekNum);
    }

    function setRankings(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (!entry || typeof entry !== 'object') {
                return failure('Invalid ranking entry at index ' + i + '.');
            }
            if (!isNonEmptyString(entry.studentId)) {
                return failure('Student ID is required at index ' + i + '.');
            }
            var rankNum = parseInt(entry.rank, 10);
            if (isNaN(rankNum) || rankNum < 1) {
                return failure('Valid rank is required at index ' + i + '.');
            }
        }

        var result = RankingCore.setRankings(weekNum, rankings);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to set rankings.');
        }

        var count = result.count || 0;
        recordActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    function autoGenerateRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = RankingCore.autoGenerateRankings(weekNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to auto-generate rankings.');
        }

        var count = result.count || 0;
        recordActivity('Auto-generated rankings for week ' + weekNum + ' (' + count + ' students)');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    function updateStudentRank(week, studentId, newRank) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var rankNum = parseInt(newRank, 10);
        if (isNaN(rankNum) || rankNum < 1) {
            return failure('Valid rank is required.');
        }

        var result = RankingCore.updateStudentRank(weekNum, studentId, rankNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to update student rank.');
        }

        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var count = result.count || 0;
        var operation = result.operation || 'updated';

        recordActivity('Updated rank for ' + studentName + ' (' + operation + ', week ' + weekNum + ')');

        return {
            success: true,
            operation: operation,
            count: count,
            data: result.rankings
        };
    }

    function removeStudentFromRankings(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = RankingCore.removeStudentFromRankings(weekNum, studentId);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to remove student from rankings.');
        }

        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var count = result.count || 0;

        recordActivity('Removed ' + studentName + ' from rankings (week ' + weekNum + ')');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    // ============================================================
    // SCHEDULE OPERATIONS - Delegated to ScheduleCore
    // ============================================================

    function getStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return ScheduleCore.getStudentSchedule(studentId, weekNum);
    }

    function getStudentRestDays(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        return ScheduleCore.getStudentRestDays(studentId, weekNum);
    }

    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        return ScheduleCore.setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId);
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        return ScheduleCore.removeStudentScheduleClass(studentId, week, day, hour);
    }

    function clearStudentSchedule(studentId, week) {
        return ScheduleCore.clearStudentSchedule(studentId, week);
    }

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        return ScheduleCore.duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite);
    }

    function setStudentRestDays(studentId, week, days) {
        return ScheduleCore.setStudentRestDays(studentId, week, days);
    }

    function getClassInstructor(studentId, week, day, hour) {
        return ScheduleCore.getClassInstructor(studentId, week, day, hour);
    }

    function getClassDuration(studentId, week, day, hour) {
        return ScheduleCore.getClassDuration(studentId, week, day, hour);
    }

    function getClassLabel(studentId, week, day, hour) {
        return ScheduleCore.getClassLabel(studentId, week, day, hour);
    }

    // ============================================================
    // GROUP OPERATIONS - Delegated to GroupCore
    // ============================================================

    function getAllAutoGroups() {
        return GroupCore.getAllAutoGroups();
    }

    function getAutoGroup(key) {
        return GroupCore.getAutoGroup(key);
    }

    function getGroupsByDiscipline(disciplineId) {
        return GroupCore.getGroupsByDiscipline(disciplineId);
    }

    function getGroupsByInstructor(instructorId) {
        return GroupCore.getGroupsByInstructor(instructorId);
    }

    function getGroupStudents(key) {
        return GroupCore.getGroupStudents(key);
    }

    function getGroupSlots(key) {
        return GroupCore.getGroupSlots(key);
    }

    function getGroupStudentCount(key) {
        return GroupCore.getGroupStudentCount(key);
    }

    function createAutoGroup(disciplineId, instructorId) {
        return GroupCore.createAutoGroup(disciplineId, instructorId);
    }

    function deleteAutoGroup(key) {
        return GroupCore.deleteAutoGroup(key);
    }

    function addStudentToGroup(key, studentId, options) {
        return GroupCore.addStudentToGroup(key, studentId, options);
    }

    function removeStudentFromGroup(key, studentId) {
        return GroupCore.removeStudentFromGroup(key, studentId);
    }

    function addSlotToGroup(key, week, day, hour, duration, label) {
        return GroupCore.addSlotToGroup(key, week, day, hour, duration, label);
    }

    function removeSlotFromGroup(key, week, day, hour) {
        return GroupCore.removeSlotFromGroup(key, week, day, hour);
    }

    function rebuildGroupsFromSchedules() {
        return GroupCore.rebuildGroupsFromSchedules();
    }

    // ============================================================
    // CLASS OPERATIONS - Graduating Classes
    // ============================================================

    function getClass(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = window.data || {};
        if (!data.classes || !Array.isArray(data.classes)) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < data.classes.length; i++) {
            var cls = data.classes[i];
            if (cls && typeof cls === 'object' && String(cls.id) === target) {
                return deepClone(cls);
            }
        }
        return null;
    }

    function getClasses() {
        var data = window.data || {};
        if (!data.classes || !Array.isArray(data.classes)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.classes.length; i++) {
            var cls = data.classes[i];
            if (cls && typeof cls === 'object') {
                var cloned = deepClone(cls);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function createClass(name) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var trimmed = String(name).trim();

        var data = window.data || {};
        if (!data.classes || !Array.isArray(data.classes)) {
            if (!data.classes) {
                data.classes = [];
            }
        }

        var existing = data.classes.some(function(cls) {
            return cls && String(cls.name || '').toLowerCase() === trimmed.toLowerCase();
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        var newClass = {
            id: 'class_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: trimmed,
            createdAt: new Date().toISOString()
        };

        data.classes.push(newClass);

        recordActivity('Created class: ' + newClass.name);

        return {
            success: true,
            class: deepClone(newClass)
        };
    }

    function updateClass(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        if (!isObject(updates)) {
            return failure('Updates must be an object.');
        }

        if (updates.name !== undefined && !isNonEmptyString(updates.name)) {
            return failure('Class name cannot be empty.');
        }

        var data = window.data || {};
        if (!data.classes || !Array.isArray(data.classes)) {
            return failure('No classes found.');
        }

        var index = -1;
        var cls = null;

        for (var i = 0; i < data.classes.length; i++) {
            if (data.classes[i] && String(data.classes[i].id) === String(id)) {
                index = i;
                cls = data.classes[i];
                break;
            }
        }

        if (index === -1 || !cls) {
            return failure('Class not found.');
        }

        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();

            var existing = data.classes.some(function(c) {
                return c && String(c.id) !== String(id) &&
                    String(c.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return failure('A class with this name already exists.');
            }

            cls.name = newName;
        }

        recordActivity('Updated class: ' + cls.name);

        return {
            success: true,
            class: deepClone(cls)
        };
    }

    function deleteClass(id) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var data = window.data || {};
        if (!data.classes || !Array.isArray(data.classes)) {
            return failure('No classes found.');
        }

        var index = -1;
        var cls = null;

        for (var i = 0; i < data.classes.length; i++) {
            if (data.classes[i] && String(data.classes[i].id) === String(id)) {
                index = i;
                cls = data.classes[i];
                break;
            }
        }

        if (index === -1 || !cls) {
            return failure('Class not found.');
        }

        var className = cls.name;

        // Clean up references in characters
        if (data.characters && Array.isArray(data.characters)) {
            for (var i = 0; i < data.characters.length; i++) {
                var char = data.characters[i];
                if (!char || typeof char !== 'object' || !Array.isArray(char.classIds)) {
                    continue;
                }
                char.classIds = char.classIds.filter(function(cid) {
                    return String(cid) !== String(id);
                });
            }
        }

        // Clean up references in academic teams
        if (data.teams && Array.isArray(data.teams)) {
            for (var i = 0; i < data.teams.length; i++) {
                var team = data.teams[i];
                if (team && typeof team === 'object' && team.type === 'academic' && String(team.classId) === String(id)) {
                    team.classId = null;
                }
            }
        }

        data.classes.splice(index, 1);

        recordActivity('Deleted class: ' + className);

        return {
            success: true,
            className: className
        };
    }

    function getClassDisplayName(classId) {
        var cls = getClass(classId);
        return cls ? cls.name : 'Unassigned';
    }

    function getCharactersByClass(classId) {
        if (!classId) {
            return [];
        }

        var data = window.data || {};
        if (!data.characters || !Array.isArray(data.characters)) {
            return [];
        }

        var target = String(classId);
        var result = [];

        for (var i = 0; i < data.characters.length; i++) {
            var char = data.characters[i];
            if (!char || typeof char !== 'object' || !Array.isArray(char.classIds)) {
                continue;
            }
            if (char.classIds.some(function(cid) { return String(cid) === target; })) {
                result.push(char);
            }
        }

        return result;
    }

    function getTeamsByClass(classId) {
        if (!classId) {
            return [];
        }

        var data = window.data || {};
        if (!data.teams || !Array.isArray(data.teams)) {
            return [];
        }

        var target = String(classId);
        var result = [];

        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && typeof team === 'object' && team.type === 'academic' && String(team.classId) === target) {
                if (team.status !== 'deleted') {
                    result.push(team);
                }
            }
        }

        return result;
    }

    function getAvailableStudentsForClass(classId, week) {
        if (!classId) {
            return [];
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var classChars = getCharactersByClass(classId);

        // Filter: not deceased, not eliminated, not in active academic team
        var result = [];

        for (var i = 0; i < classChars.length; i++) {
            var char = classChars[i];
            if (!char || typeof char !== 'object') {
                continue;
            }

            if (char.deceased) {
                continue;
            }

            // Check elimination - use Elimination module if available
            if (typeof window.isCharacterEliminatedByWeek === 'function') {
                if (window.isCharacterEliminatedByWeek(char, weekNum)) {
                    continue;
                }
            }

            // Check if in active team for this class
            var teams = getTeamsByClass(classId);
            var isInTeam = false;

            for (var j = 0; j < teams.length; j++) {
                var team = teams[j];
                if (!team || typeof team !== 'object' || !Array.isArray(team.members)) {
                    continue;
                }

                for (var k = 0; k < team.members.length; k++) {
                    var member = team.members[k];
                    if (member && String(member.characterId) === String(char.id)) {
                        isInTeam = true;
                        break;
                    }
                }
                if (isInTeam) {
                    break;
                }
            }

            if (!isInTeam) {
                result.push(char);
            }
        }

        return result;
    }

    // ============================================================
    // TOURNAMENT OPERATIONS (Placeholder)
    // ============================================================

    function getCharacterTournaments(characterId) {
        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t || typeof t !== 'object') {
                continue;
            }

            // Check if character is a participant
            if (t.participants && Array.isArray(t.participants)) {
                var isParticipant = t.participants.some(function(p) {
                    return p && String(p.id || p) === String(characterId);
                });

                if (isParticipant) {
                    result.push(deepClone(t));
                }
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.YearCore = {
        // Grade operations
        getStudentGrades: getStudentGrades,
        calculateGradeSummary: calculateGradeSummary,
        getGradeLetter: getGradeLetter,
        saveGrades: saveGrades,

        // Ranking operations
        getRankings: getRankings,
        getStudentRank: getStudentRank,
        getRankingCount: getRankingCount,
        hasRankings: hasRankings,
        setRankings: setRankings,
        autoGenerateRankings: autoGenerateRankings,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,

        // Schedule operations
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,
        setStudentRestDays: setStudentRestDays,
        getClassInstructor: getClassInstructor,
        getClassDuration: getClassDuration,
        getClassLabel: getClassLabel,

        // Group operations
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToGroup: addStudentToGroup,
        removeStudentFromGroup: removeStudentFromGroup,
        addSlotToGroup: addSlotToGroup,
        removeSlotFromGroup: removeSlotFromGroup,
        rebuildGroupsFromSchedules: rebuildGroupsFromSchedules,

        // Class operations (graduating classes)
        getClass: getClass,
        getClasses: getClasses,
        createClass: createClass,
        updateClass: updateClass,
        deleteClass: deleteClass,
        getClassDisplayName: getClassDisplayName,
        getCharactersByClass: getCharactersByClass,
        getTeamsByClass: getTeamsByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,

        // Tournament operations (placeholder)
        getCharacterTournaments: getCharacterTournaments,

        // Utilities
        validateWeek: validateWeek,
        validateScore: validateScore
    };

})();