/**
 * js/modules/academy/academy-core.js - Academy Core Operations
 * Single source of truth for all academy mutations
 * Path: js/modules/academy/academy-core.js
 * 
 * This module handles:
 *   - Class CRUD (delegates to ClassesCore)
 *   - Student operations (delegates to GradeCore/RankingCore/ScheduleCore)
 *   - Faculty operations (delegates to InstructorCore/LocationCore/GroupCore)
 *   - Academic team operations (delegates to TeamCore)
 *   - Tournament operations (delegates to TournamentCore)
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Delegates to domain-specific core modules for actual operations
 *   - All mutations use MutationUtils.performMutation() when appropriate
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.GradeCore (from curriculum-grades.js)
 *   - window.RankingCore (from curriculum-ranking.js)
 *   - window.ScheduleCore (from curriculum-schedule.js)
 *   - window.InstructorCore (from curriculum-instructor.js)
 *   - window.LocationCore (from curriculum-location-schedule.js)
 *   - window.GroupCore (from curriculum-groups.js)
 *   - window.TeamCore (from team-core.js)
 *   - window.TournamentCore (from tournament-core.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ClassesCore = window.ClassesCore;
    var GradeCore = window.GradeCore;
    var RankingCore = window.RankingCore;
    var ScheduleCore = window.ScheduleCore;
    var InstructorCore = window.InstructorCore;
    var LocationCore = window.LocationCore;
    var GroupCore = window.GroupCore;
    var TeamCore = window.TeamCore;
    var TournamentCore = window.TournamentCore;
    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
        }
        if (!ClassesCore || typeof ClassesCore.deleteClass !== 'function') {
            missing.push('ClassesCore.deleteClass');
        }
        if (!ClassesCore || typeof ClassesCore.addCharacterToClass !== 'function') {
            missing.push('ClassesCore.addCharacterToClass');
        }
        if (!ClassesCore || typeof ClassesCore.removeCharacterFromClass !== 'function') {
            missing.push('ClassesCore.removeCharacterFromClass');
        }

        if (!GradeCore || typeof GradeCore.saveGrades !== 'function') {
            missing.push('GradeCore.saveGrades');
        }
        if (!GradeCore || typeof GradeCore.getGrades !== 'function') {
            missing.push('GradeCore.getGrades');
        }
        if (!GradeCore || typeof GradeCore.calculateGradeSummary !== 'function') {
            missing.push('GradeCore.calculateGradeSummary');
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

        if (!ScheduleCore || typeof ScheduleCore.getStudentSchedule !== 'function') {
            missing.push('ScheduleCore.getStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.setStudentScheduleClass !== 'function') {
            missing.push('ScheduleCore.setStudentScheduleClass');
        }

        if (!InstructorCore || typeof InstructorCore.getInstructorTemplates !== 'function') {
            missing.push('InstructorCore.getInstructorTemplates');
        }
        if (!InstructorCore || typeof InstructorCore.addInstructorClassTemplate !== 'function') {
            missing.push('InstructorCore.addInstructorClassTemplate');
        }

        if (!LocationCore || typeof LocationCore.getLocationSchedule !== 'function') {
            missing.push('LocationCore.getLocationSchedule');
        }

        if (!GroupCore || typeof GroupCore.getAllAutoGroups !== 'function') {
            missing.push('GroupCore.getAllAutoGroups');
        }

        if (!TeamCore || typeof TeamCore.getTeams !== 'function') {
            missing.push('TeamCore.getTeams');
        }
        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            missing.push('TeamCore.createTeam');
        }
        if (!TeamCore || typeof TeamCore.addMember !== 'function') {
            missing.push('TeamCore.addMember');
        }
        if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
            missing.push('TeamCore.removeMember');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // TournamentCore is optional - warn if missing
        if (!TournamentCore) {
            // Missing TournamentCore is acceptable - tournaments are optional
        }

        if (missing.length > 0) {
            console.warn('AcademyCore: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyCoreLoaded = true;

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
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
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
    // CLASS OPERATIONS
    // ============================================================

    function getClass(id) {
        return ClassesQueries.getClass(id);
    }

    function getClasses() {
        return ClassesQueries.getClasses();
    }

    function createClass(name) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var result = ClassesCore.createClass(name);
        if (result && result.success) {
            recordActivity('Created class: ' + name);
            return result;
        }

        return failure(result ? result.message : 'Failed to create class.');
    }

    function updateClass(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }
        if (!isObject(updates)) {
            return failure('Updates must be an object.');
        }

        var result = ClassesCore.updateClass(id, updates);
        if (result && result.success) {
            var cls = ClassesQueries.getClass(id);
            recordActivity('Updated class: ' + (cls ? cls.name : id));
            return result;
        }

        return failure(result ? result.message : 'Failed to update class.');
    }

    function deleteClass(id) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var cls = ClassesQueries.getClass(id);
        var result = ClassesCore.deleteClass(id);
        if (result && result.success) {
            recordActivity('Deleted class: ' + (cls ? cls.name : id));
            return result;
        }

        return failure(result ? result.message : 'Failed to delete class.');
    }

    function getClassStudents(classId) {
        if (!classId) {
            return [];
        }
        return ClassesQueries.getCharactersByClass(classId);
    }

    function getClassStudentCount(classId) {
        return getClassStudents(classId).length;
    }

    function getClassTeams(classId) {
        if (!classId) {
            return [];
        }
        return ClassesQueries.getTeamsByClass(classId);
    }

    function getClassTeamCount(classId) {
        return getClassTeams(classId).length;
    }

    function addStudentToClass(classId, studentId) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = ClassesCore.addCharacterToClass(studentId, classId);
        if (result && result.success) {
            var cls = ClassesQueries.getClass(classId);
            recordActivity('Added student to class: ' + (cls ? cls.name : classId));
            return result;
        }

        return failure(result ? result.message : 'Failed to add student to class.');
    }

    function removeStudentFromClass(classId, studentId) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = ClassesCore.removeCharacterFromClass(studentId, classId);
        if (result && result.success) {
            var cls = ClassesQueries.getClass(classId);
            recordActivity('Removed student from class: ' + (cls ? cls.name : classId));
            return result;
        }

        return failure(result ? result.message : 'Failed to remove student from class.');
    }

    function addStudentsToClass(classId, studentIds) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var result = ClassesCore.addCharactersToClass(classId, studentIds);
        if (result && result.success) {
            var cls = ClassesQueries.getClass(classId);
            recordActivity('Added ' + result.added + ' students to class: ' + (cls ? cls.name : classId));
            return result;
        }

        return failure(result ? result.message : 'Failed to add students to class.');
    }

    function removeStudentsFromClass(classId, studentIds) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var result = ClassesCore.removeCharactersFromClass(classId, studentIds);
        if (result && result.success) {
            var cls = ClassesQueries.getClass(classId);
            recordActivity('Removed ' + result.removed + ' students from class: ' + (cls ? cls.name : classId));
            return result;
        }

        return failure(result ? result.message : 'Failed to remove students from class.');
    }

    // ============================================================
    // GRADE OPERATIONS (delegated to GradeCore)
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

        var result = GradeCore.saveGrades(studentId, weekNum, grades);
        if (result && result.success) {
            recordActivity('Saved grades for student ' + studentId + ' week ' + weekNum);
            return result;
        }

        return failure(result ? result.message : 'Failed to save grades.');
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
        if (GradeCore && typeof GradeCore.getGradeLetter === 'function') {
            return GradeCore.getGradeLetter(discipline, score);
        }
        return '';
    }

    // ============================================================
    // RANKING OPERATIONS (delegated to RankingCore)
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

    function setRankings(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }
        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        var result = RankingCore.setRankings(weekNum, rankings);
        if (result && result.success) {
            recordActivity('Set rankings for week ' + weekNum);
            return result;
        }

        return failure(result ? result.message : 'Failed to set rankings.');
    }

    function autoGenerateRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = RankingCore.autoGenerateRankings(weekNum);
        if (result && result.success) {
            recordActivity('Auto-generated rankings for week ' + weekNum);
            return result;
        }

        return failure(result ? result.message : 'Failed to auto-generate rankings.');
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
        if (result && result.success) {
            recordActivity('Updated student rank for week ' + weekNum);
            return result;
        }

        return failure(result ? result.message : 'Failed to update student rank.');
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
        if (result && result.success) {
            recordActivity('Removed student from rankings for week ' + weekNum);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove student from rankings.');
    }

    // ============================================================
    // SCHEDULE OPERATIONS (delegated to ScheduleCore)
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

    // ============================================================
    // ACADEMIC TEAM OPERATIONS (delegated to TeamCore)
    // ============================================================

    function getAcademicTeams(classId) {
        if (!classId) {
            return [];
        }
        var teams = TeamCore.getTeams('academic', 'operational', false);
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (String(teams[i].classId) === String(classId)) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    function getAcademicTeam(id) {
        return TeamCore.getTeam(id);
    }

    function createAcademicTeam(classId, name, teamNumber, startPeriod, endPeriod) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(name)) {
            return failure('Team name is required.');
        }

        var teamData = {
            name: name,
            type: 'academic',
            classId: classId,
            teamNumber: teamNumber || '',
            startPeriod: startPeriod || '1',
            endPeriod: endPeriod || '',
            status: 'active'
        };

        var result = TeamCore.createTeam(teamData);
        if (result) {
            recordActivity('Created academic team: ' + name);
            return success(result);
        }

        return failure('Failed to create academic team.');
    }

    function updateAcademicTeam(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Team ID is required.');
        }

        var result = TeamCore.updateTeam(id, updates);
        if (result) {
            recordActivity('Updated academic team: ' + (result.name || id));
            return success(result);
        }

        return failure('Failed to update academic team.');
    }

    function deleteAcademicTeam(id) {
        if (!isNonEmptyString(id)) {
            return failure('Team ID is required.');
        }

        var team = TeamCore.getTeam(id);
        var result = TeamCore.deleteTeam(id);
        if (result) {
            recordActivity('Deleted academic team: ' + (team ? team.name : id));
            return success({ deleted: true });
        }

        return failure('Failed to delete academic team.');
    }

    function addStudentToAcademicTeam(teamId, studentId, role, joinPeriod) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var memberData = {
            characterId: studentId,
            role: role || 'Member',
            joinPeriod: joinPeriod || '1',
            leavePeriod: ''
        };

        var result = TeamCore.addMember(teamId, memberData);
        if (result) {
            var team = TeamCore.getTeam(teamId);
            recordActivity('Added student to academic team: ' + (team ? team.name : teamId));
            return success(result);
        }

        return failure('Failed to add student to academic team.');
    }

    function removeStudentFromAcademicTeam(teamId, studentId) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = TeamCore.removeMember(teamId, studentId);
        if (result) {
            var team = TeamCore.getTeam(teamId);
            recordActivity('Removed student from academic team: ' + (team ? team.name : teamId));
            return success({ removed: true });
        }

        return failure('Failed to remove student from academic team.');
    }

    function getAcademicTeamMembers(teamId, week) {
        if (!isNonEmptyString(teamId)) {
            return [];
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return [];
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            weekNum = 1;
        }

        return TeamCore.getActiveMembers(team, weekNum);
    }

    function getAcademicTeamMemberCount(teamId, week) {
        return getAcademicTeamMembers(teamId, week).length;
    }

    // ============================================================
    // AUTO-DISTRIBUTE STUDENTS TO ACADEMIC TEAMS
    // ============================================================

    function autoDistributeStudents(classId, week, maxTeamSize, teamIds) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var maxSize = parseInt(maxTeamSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            return failure('Max team size must be at least 1.');
        }

        // Get available students
        var availableStudents = ClassesQueries.getAvailableStudentsForClass(classId, weekNum);
        if (availableStudents.length === 0) {
            return failure('No available students for this class at week ' + weekNum + '.');
        }

        // Get teams
        var teams = [];
        if (Array.isArray(teamIds) && teamIds.length > 0) {
            for (var i = 0; i < teamIds.length; i++) {
                var t = TeamCore.getTeam(teamIds[i]);
                if (t) {
                    teams.push(t);
                }
            }
        } else {
            teams = getAcademicTeams(classId);
        }

        if (teams.length === 0) {
            return failure('No academic teams found for this class.');
        }

        // Calculate available slots
        var teamSlots = {};
        var totalAvailableSlots = 0;

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var activeCount = TeamCore.getActiveMembers(team, weekNum).length;
            var availableSlots = Math.max(0, maxSize - activeCount);
            teamSlots[team.id] = availableSlots;
            totalAvailableSlots += availableSlots;
        }

        if (totalAvailableSlots === 0) {
            return failure('No available slots in any team.');
        }

        // Shuffle students
        var shuffled = availableStudents.slice();
        for (var s = shuffled.length - 1; s > 0; s--) {
            var j = Math.floor(Math.random() * (s + 1));
            var temp = shuffled[s];
            shuffled[s] = shuffled[j];
            shuffled[j] = temp;
        }

        var assignments = [];
        var capacityExceeded = 0;

        for (var a = 0; a < shuffled.length; a++) {
            var student = shuffled[a];

            // Find team with available slot
            var targetTeam = null;
            var targetTeamId = null;

            for (var t = 0; t < teams.length; t++) {
                var teamId = teams[t].id;
                if (teamSlots[teamId] > 0) {
                    targetTeam = teams[t];
                    targetTeamId = teamId;
                    break;
                }
            }

            if (!targetTeam) {
                capacityExceeded++;
                continue;
            }

            // Add student to team
            var result = TeamCore.addMember(targetTeamId, {
                characterId: student.id,
                role: 'Member',
                joinPeriod: String(weekNum),
                leavePeriod: ''
            });

            if (result) {
                assignments.push({
                    studentId: student.id,
                    teamId: targetTeamId,
                    teamName: targetTeam.name
                });
                teamSlots[targetTeamId]--;
            }
        }

        var successCount = assignments.length;
        if (successCount === 0) {
            return failure('No students could be assigned. Check team capacity.');
        }

        recordActivity('Auto-distributed ' + successCount + ' students in class ' + classId + ' for week ' + weekNum);

        return success({
            assigned: successCount,
            capacityExceeded: capacityExceeded,
            assignments: assignments
        });
    }

    // ============================================================
    // FACULTY OPERATIONS (delegated to InstructorCore/LocationCore/GroupCore)
    // ============================================================

    function getInstructorTemplates(instructorId, week) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return InstructorCore.getInstructorTemplates(instructorId, weekNum);
    }

    function addInstructorClassTemplate(instructorId, week, day, hour, data) {
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = InstructorCore.addInstructorClassTemplate(instructorId, weekNum, day, hour, data);
        if (result && result.success) {
            recordActivity('Added instructor class template for ' + instructorId);
            return result;
        }

        return failure(result ? result.message : 'Failed to add instructor class template.');
    }

    function removeInstructorClassTemplate(instructorId, week, day, hour) {
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = InstructorCore.removeInstructorClassTemplate(instructorId, weekNum, day, hour);
        if (result && result.success) {
            recordActivity('Removed instructor class template for ' + instructorId);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove instructor class template.');
    }

    function getInstructorBlocks(instructorId, week) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return InstructorCore.getInstructorBlocks(instructorId, weekNum);
    }

    function addInstructorBlock(instructorId, week, day, hour, data) {
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = InstructorCore.addInstructorBlock(instructorId, weekNum, day, hour, data);
        if (result && result.success) {
            recordActivity('Added instructor block for ' + instructorId);
            return result;
        }

        return failure(result ? result.message : 'Failed to add instructor block.');
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = InstructorCore.removeInstructorBlock(instructorId, weekNum, day, hour);
        if (result && result.success) {
            recordActivity('Removed instructor block for ' + instructorId);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove instructor block.');
    }

    function getLocationSchedule(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return LocationCore.getLocationSchedule(locationId, weekNum);
    }

    function setLocationClass(locationId, week, day, hour, disciplineId) {
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = LocationCore.setLocationClass(locationId, weekNum, day, hour, disciplineId);
        if (result && result.success) {
            recordActivity('Set location class for ' + locationId);
            return result;
        }

        return failure(result ? result.message : 'Failed to set location class.');
    }

    function removeLocationClass(locationId, week, day, hour) {
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = LocationCore.removeLocationClass(locationId, weekNum, day, hour);
        if (result && result.success) {
            recordActivity('Removed location class for ' + locationId);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove location class.');
    }

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

    function createAutoGroup(disciplineId, instructorId) {
        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var result = GroupCore.createAutoGroup(disciplineId, instructorId);
        if (result && result.success) {
            recordActivity('Created auto-group for discipline ' + disciplineId + ' and instructor ' + instructorId);
            return result;
        }

        return failure(result ? result.message : 'Failed to create auto-group.');
    }

    function deleteAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        var result = GroupCore.deleteAutoGroup(key);
        if (result && result.success) {
            recordActivity('Deleted auto-group: ' + key);
            return result;
        }

        return failure(result ? result.message : 'Failed to delete auto-group.');
    }

    function addStudentToAutoGroup(key, studentId, options) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = GroupCore.addStudentToGroup(key, studentId, options || {});
        if (result && result.success) {
            recordActivity('Added student to auto-group: ' + key);
            return result;
        }

        return failure(result ? result.message : 'Failed to add student to auto-group.');
    }

    function removeStudentFromAutoGroup(key, studentId) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var result = GroupCore.removeStudentFromGroup(key, studentId);
        if (result && result.success) {
            recordActivity('Removed student from auto-group: ' + key);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove student from auto-group.');
    }

    function addSlotToAutoGroup(key, week, day, hour, duration, label) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = GroupCore.addSlotToGroup(key, weekNum, day, hour, duration, label);
        if (result && result.success) {
            recordActivity('Added slot to auto-group: ' + key);
            return result;
        }

        return failure(result ? result.message : 'Failed to add slot to auto-group.');
    }

    function removeSlotFromAutoGroup(key, week, day, hour) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var result = GroupCore.removeSlotFromGroup(key, weekNum, day, hour);
        if (result && result.success) {
            recordActivity('Removed slot from auto-group: ' + key);
            return result;
        }

        return failure(result ? result.message : 'Failed to remove slot from auto-group.');
    }

    function rebuildAutoGroups() {
        var result = GroupCore.rebuildGroupsFromSchedules();
        if (result && result.success) {
            recordActivity('Rebuilt auto-groups from schedules');
            return result;
        }

        return failure(result ? result.message : 'Failed to rebuild auto-groups.');
    }

    // ============================================================
    // TOURNAMENT OPERATIONS (delegated to TournamentCore)
    // ============================================================

    function getTournaments(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        if (TournamentCore && typeof TournamentCore.getTournamentsByClass === 'function') {
            return TournamentCore.getTournamentsByClass(classId);
        }

        // Fallback to direct data access if TournamentCore not available
        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && String(t.classId) === String(classId)) {
                result.push(t);
            }
        }

        return result;
    }

    function getTournament(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (TournamentCore && typeof TournamentCore.getTournament === 'function') {
            return TournamentCore.getTournament(id);
        }

        var data = window.data || {};
        var tournaments = data.tournaments || [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && String(t.id) === String(id)) {
                return t;
            }
        }

        return null;
    }

    function createTournament(classId, name, description, week) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(name)) {
            return failure('Tournament name is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (TournamentCore && typeof TournamentCore.createTournament === 'function') {
            var result = TournamentCore.createTournament({
                classId: classId,
                name: name,
                description: description || '',
                week: weekNum,
                status: 'active'
            });

            if (result && result.success) {
                recordActivity('Created tournament: ' + name);
                return result;
            }

            return failure(result ? result.message : 'Failed to create tournament.');
        }

        // Fallback: direct data mutation
        var data = window.data || {};
        if (!Array.isArray(data.tournaments)) {
            data.tournaments = [];
        }

        var tournament = {
            id: generateId('tourn'),
            classId: classId,
            name: name,
            description: description || '',
            week: weekNum,
            status: 'active',
            teams: [],
            matches: [],
            createdAt: new Date().toISOString()
        };

        data.tournaments.push(tournament);
        recordActivity('Created tournament: ' + name);

        return success(tournament);
    }

    function updateTournament(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Tournament ID is required.');
        }

        if (TournamentCore && typeof TournamentCore.updateTournament === 'function') {
            var result = TournamentCore.updateTournament(id, updates);
            if (result && result.success) {
                recordActivity('Updated tournament: ' + id);
                return result;
            }
            return failure(result ? result.message : 'Failed to update tournament.');
        }

        // Fallback: direct data mutation
        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var index = -1;

        for (var i = 0; i < tournaments.length; i++) {
            if (tournaments[i] && String(tournaments[i].id) === String(id)) {
                index = i;
                break;
            }
        }

        if (index === -1) {
            return failure('Tournament not found.');
        }

        var tournament = tournaments[index];
        var allowedUpdates = ['name', 'description', 'week', 'status', 'teams', 'matches'];

        for (var k = 0; k < allowedUpdates.length; k++) {
            var key = allowedUpdates[k];
            if (updates[key] !== undefined) {
                tournament[key] = updates[key];
            }
        }

        recordActivity('Updated tournament: ' + (tournament.name || id));
        return success(tournament);
    }

    function deleteTournament(id) {
        if (!isNonEmptyString(id)) {
            return failure('Tournament ID is required.');
        }

        if (TournamentCore && typeof TournamentCore.deleteTournament === 'function') {
            var result = TournamentCore.deleteTournament(id);
            if (result && result.success) {
                recordActivity('Deleted tournament: ' + id);
                return result;
            }
            return failure(result ? result.message : 'Failed to delete tournament.');
        }

        // Fallback: direct data mutation
        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var index = -1;
        var name = '';

        for (var i = 0; i < tournaments.length; i++) {
            if (tournaments[i] && String(tournaments[i].id) === String(id)) {
                index = i;
                name = tournaments[i].name || id;
                break;
            }
        }

        if (index === -1) {
            return failure('Tournament not found.');
        }

        tournaments.splice(index, 1);
        recordActivity('Deleted tournament: ' + name);

        return success({ deleted: true });
    }

    function addTeamToTournament(tournamentId, teamId) {
        if (!isNonEmptyString(tournamentId)) {
            return failure('Tournament ID is required.');
        }
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }

        if (TournamentCore && typeof TournamentCore.addTeamToTournament === 'function') {
            var result = TournamentCore.addTeamToTournament(tournamentId, teamId);
            if (result && result.success) {
                recordActivity('Added team to tournament: ' + tournamentId);
                return result;
            }
            return failure(result ? result.message : 'Failed to add team to tournament.');
        }

        // Fallback: direct data mutation
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return failure('Tournament not found.');
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return failure('Team not found.');
        }

        if (!Array.isArray(tournament.teams)) {
            tournament.teams = [];
        }

        // Check if already in tournament
        var exists = false;
        for (var i = 0; i < tournament.teams.length; i++) {
            if (String(tournament.teams[i]) === String(teamId)) {
                exists = true;
                break;
            }
        }

        if (exists) {
            return failure('Team is already in this tournament.');
        }

        tournament.teams.push(teamId);
        recordActivity('Added team to tournament: ' + tournament.name);

        return success({ added: true });
    }

    function removeTeamFromTournament(tournamentId, teamId) {
        if (!isNonEmptyString(tournamentId)) {
            return failure('Tournament ID is required.');
        }
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }

        if (TournamentCore && typeof TournamentCore.removeTeamFromTournament === 'function') {
            var result = TournamentCore.removeTeamFromTournament(tournamentId, teamId);
            if (result && result.success) {
                recordActivity('Removed team from tournament: ' + tournamentId);
                return result;
            }
            return failure(result ? result.message : 'Failed to remove team from tournament.');
        }

        // Fallback: direct data mutation
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return failure('Tournament not found.');
        }

        if (!Array.isArray(tournament.teams)) {
            return failure('Tournament has no teams.');
        }

        var index = -1;
        for (var i = 0; i < tournament.teams.length; i++) {
            if (String(tournament.teams[i]) === String(teamId)) {
                index = i;
                break;
            }
        }

        if (index === -1) {
            return failure('Team not found in tournament.');
        }

        tournament.teams.splice(index, 1);
        recordActivity('Removed team from tournament: ' + tournament.name);

        return success({ removed: true });
    }

    function getTournamentTeams(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.teams)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < tournament.teams.length; i++) {
            var team = TeamCore.getTeam(tournament.teams[i]);
            if (team) {
                result.push(team);
            }
        }
        return result;
    }

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    function getCharacterById(id) {
        return CharacterQueries.getCharacterById(id);
    }

    function getCharacterName(id) {
        var char = CharacterQueries.getCharacterById(id);
        return char ? CharacterQueries.getDisplayName(char) : 'Unknown';
    }

    function getAvailableStudents(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        return ClassesQueries.getAvailableStudentsForClass(classId, weekNum);
    }

    function getClassInstructors(classId) {
        if (!classId) {
            return [];
        }
        var students = getClassStudents(classId);
        var instructors = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var status = CharacterQueries.getCurrentStatus(student);
            if (status === 'instructor' || status === 'teacher' || status === 'professor') {
                instructors.push(student);
            }
        }

        return instructors;
    }

    function getClassDisciplines(classId) {
        // Get disciplines taught by instructors in this class
        var instructors = getClassInstructors(classId);
        var disciplines = [];
        var seen = {};

        for (var i = 0; i < instructors.length; i++) {
            var instructor = instructors[i];
            // This would need to check instructor's assigned disciplines
            // For now, return empty array
        }

        return disciplines;
    }

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }
        var data = window.data || {};
        if (!data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            var d = data.curriculum.disciplines[i];
            if (d && String(d.id) === String(id)) {
                return d;
            }
        }
        return null;
    }

    function getLocation(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }
        var data = window.data || {};
        if (!Array.isArray(data.locations)) {
            return null;
        }
        for (var i = 0; i < data.locations.length; i++) {
            var loc = data.locations[i];
            if (loc && String(loc.id) === String(id)) {
                return loc;
            }
        }
        return null;
    }

    function getLocations() {
        var data = window.data || {};
        if (!Array.isArray(data.locations)) {
            return [];
        }
        return data.locations.slice();
    }

    function getDisciplines() {
        var data = window.data || {};
        if (!data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }
        return data.curriculum.disciplines.slice();
    }

    function getAvailableDisciplines(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        var data = window.data || {};
        if (!data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }
        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') {
                return false;
            }
            var start = parseInt(d.startWeek, 10);
            var end = parseInt(d.endWeek, 10);
            if (!isNaN(start) && start > weekNum) {
                return false;
            }
            if (!isNaN(end) && end < weekNum) {
                return false;
            }
            return true;
        });
        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getInstructors() {
        var data = window.data || {};
        if (!Array.isArray(data.characters)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (!c || typeof c !== 'object') {
                continue;
            }
            if (c.deceased) {
                continue;
            }
            var status = CharacterQueries.getCurrentStatus(c);
            if (status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior') {
                result.push(c);
            }
        }
        return result;
    }

    function getStudents() {
        var data = window.data || {};
        if (!Array.isArray(data.characters)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (!c || typeof c !== 'object') {
                continue;
            }
            if (c.deceased) {
                continue;
            }
            var status = CharacterQueries.getCurrentStatus(c);
            if (status === 'trainee' || status === 'rookie' || status === 'junior') {
                result.push(c);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCore = {
        // Class operations
        getClass: getClass,
        getClasses: getClasses,
        createClass: createClass,
        updateClass: updateClass,
        deleteClass: deleteClass,
        getClassStudents: getClassStudents,
        getClassStudentCount: getClassStudentCount,
        getClassTeams: getClassTeams,
        getClassTeamCount: getClassTeamCount,
        addStudentToClass: addStudentToClass,
        removeStudentFromClass: removeStudentFromClass,
        addStudentsToClass: addStudentsToClass,
        removeStudentsFromClass: removeStudentsFromClass,

        // Grade operations
        getStudentGrades: getStudentGrades,
        saveGrades: saveGrades,
        calculateGradeSummary: calculateGradeSummary,
        getGradeLetter: getGradeLetter,

        // Ranking operations
        getRankings: getRankings,
        getStudentRank: getStudentRank,
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

        // Academic team operations
        getAcademicTeams: getAcademicTeams,
        getAcademicTeam: getAcademicTeam,
        createAcademicTeam: createAcademicTeam,
        updateAcademicTeam: updateAcademicTeam,
        deleteAcademicTeam: deleteAcademicTeam,
        addStudentToAcademicTeam: addStudentToAcademicTeam,
        removeStudentFromAcademicTeam: removeStudentFromAcademicTeam,
        getAcademicTeamMembers: getAcademicTeamMembers,
        getAcademicTeamMemberCount: getAcademicTeamMemberCount,
        autoDistributeStudents: autoDistributeStudents,

        // Faculty operations (instructor)
        getInstructorTemplates: getInstructorTemplates,
        addInstructorClassTemplate: addInstructorClassTemplate,
        removeInstructorClassTemplate: removeInstructorClassTemplate,
        getInstructorBlocks: getInstructorBlocks,
        addInstructorBlock: addInstructorBlock,
        removeInstructorBlock: removeInstructorBlock,

        // Faculty operations (location)
        getLocationSchedule: getLocationSchedule,
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,

        // Auto-group operations
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToAutoGroup: addStudentToAutoGroup,
        removeStudentFromAutoGroup: removeStudentFromAutoGroup,
        addSlotToAutoGroup: addSlotToAutoGroup,
        removeSlotFromAutoGroup: removeSlotFromAutoGroup,
        rebuildAutoGroups: rebuildAutoGroups,

        // Tournament operations
        getTournaments: getTournaments,
        getTournament: getTournament,
        createTournament: createTournament,
        updateTournament: updateTournament,
        deleteTournament: deleteTournament,
        addTeamToTournament: addTeamToTournament,
        removeTeamFromTournament: removeTeamFromTournament,
        getTournamentTeams: getTournamentTeams,

        // Utility
        getCharacterById: getCharacterById,
        getCharacterName: getCharacterName,
        getAvailableStudents: getAvailableStudents,
        getClassInstructors: getClassInstructors,
        getClassDisciplines: getClassDisciplines,
        getDiscipline: getDiscipline,
        getLocation: getLocation,
        getLocations: getLocations,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,
        getInstructors: getInstructors,
        getStudents: getStudents,
        validateWeek: validateWeek,
        validateScore: validateScore
    };

})();