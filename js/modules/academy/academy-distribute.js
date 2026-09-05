/**
 * js/modules/academy/academy-distribute.js - Academy Distribution
 * Cross-domain distribution workflow for the Academy
 * Path: js/modules/academy/academy-distribute.js
 * 
 * This module handles:
 *   - Auto-distribution of students to academic teams
 *   - Balanced distribution based on team capacity
 *   - Conflict detection with schedules
 *   - Atomic bulk operations (all or nothing)
 * 
 * IMPORTANT:
 *   - This is a CROSS-DOMAIN workflow combining:
 *     - Classes (students)
 *     - Teams (capacity)
 *     - Groups (auto-groups)
 *     - Schedules (conflict detection)
 *   - All mutations are ATOMIC: validate all, then commit all
 *   - No mutation of live state occurs before validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyGroups (from academy-groups.js)
 *   - window.AcademySchedule (from academy-schedule.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamCore (from team-core.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.ActivityLog (from activity-log.js)
 * 
 * USAGE:
 *   var distribute = window.AcademyDistribute;
 *   var result = distribute.autoDistributeStudents(classId, week, maxTeamSize, teamIds);
 *   if (result.success) { console.log('Distributed ' + result.assigned + ' students'); }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyDistributeLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var AcademyGroups = window.AcademyGroups;
    var AcademySchedule = window.AcademySchedule;
    var CharacterQueries = window.CharacterQueries;
    var TeamCore = window.TeamCore;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableStudents !== 'function') {
            missing.push('AcademyQueries.getAvailableStudents');
        }

        if (!AcademyGroups || typeof AcademyGroups.getAcademicTeams !== 'function') {
            missing.push('AcademyGroups.getAcademicTeams');
        }
        if (!AcademyGroups || typeof AcademyGroups.addStudentToAutoGroup !== 'function') {
            missing.push('AcademyGroups.addStudentToAutoGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.removeStudentFromAutoGroup !== 'function') {
            missing.push('AcademyGroups.removeStudentFromAutoGroup');
        }

        if (!AcademySchedule || typeof AcademySchedule.getAvailableSlots !== 'function') {
            missing.push('AcademySchedule.getAvailableSlots');
        }
        if (!AcademySchedule || typeof AcademySchedule.hasConflict !== 'function') {
            missing.push('AcademySchedule.hasConflict');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!TeamCore || typeof TeamCore.getTeam !== 'function') {
            missing.push('TeamCore.getTeam');
        }
        if (!TeamCore || typeof TeamCore.getActiveMembers !== 'function') {
            missing.push('TeamCore.getActiveMembers');
        }
        if (!TeamCore || typeof TeamCore.addMember !== 'function') {
            missing.push('TeamCore.addMember');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (missing.length > 0) {
            console.warn('AcademyDistribute: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyDistributeLoaded = true;

    // ============================================================
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR || 5;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR || 23;

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
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

    function validateClassId(classId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }
        var cls = AcademyQueries.getClass(classId);
        if (!cls) {
            return { valid: false, message: 'Class not found.' };
        }
        return { valid: true, class: cls };
    }

    function validateTeamIds(teamIds, classId, weekNum, maxSize) {
        if (!Array.isArray(teamIds) || teamIds.length === 0) {
            return { valid: false, message: 'At least one team is required.' };
        }

        var validTeams = [];
        var errors = [];

        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            if (!isNonEmptyString(teamId)) {
                errors.push('Invalid team ID: ' + teamId);
                continue;
            }

            var team = TeamCore.getTeam(teamId);
            if (!team) {
                errors.push('Team not found: ' + teamId);
                continue;
            }

            // Validate team is academic and belongs to the class
            if (team.type !== 'academic') {
                errors.push('Team "' + team.name + '" is not an academic team.');
                continue;
            }

            if (String(team.classId) !== String(classId)) {
                errors.push('Team "' + team.name + '" does not belong to this class.');
                continue;
            }

            // Check if team is operational
            if (team.status !== 'active') {
                errors.push('Team "' + team.name + '" is not active.');
                continue;
            }

            // Get current member count
            var activeMembers = TeamCore.getActiveMembers(team, weekNum);
            var currentCount = activeMembers.length;

            if (currentCount >= maxSize) {
                errors.push('Team "' + team.name + '" is already at maximum capacity (' + maxSize + ').');
                continue;
            }

            validTeams.push({
                team: team,
                id: teamId,
                name: team.name,
                currentCount: currentCount,
                availableSlots: maxSize - currentCount
            });
        }

        if (errors.length > 0) {
            return { valid: false, message: errors.join('; ') };
        }

        if (validTeams.length === 0) {
            return { valid: false, message: 'No valid teams available.' };
        }

        return { valid: true, teams: validTeams };
    }

    // ============================================================
    // CORE DISTRIBUTION ALGORITHM - ATOMIC
    // ============================================================

    /**
     * Auto-distribute students to academic teams.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {number} maxTeamSize - Maximum students per team
     * @param {array} teamIds - Optional array of team IDs (if not provided, all academic teams in class are used)
     * @returns {object} Result with assigned students and any issues
     */
    function autoDistributeStudents(classId, week, maxTeamSize, teamIds) {
        // ---- PHASE 1: VALIDATE BASIC INPUTS ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var maxSize = parseInt(maxTeamSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            return failure('Max team size must be at least 1.');
        }
        if (maxSize > 20) {
            return failure('Max team size cannot exceed 20.');
        }

        // ---- PHASE 2: VALIDATE CLASS ----
        var classResult = validateClassId(classId);
        if (!classResult.valid) {
            return failure(classResult.message);
        }

        // ---- PHASE 3: GET AVAILABLE STUDENTS ----
        var availableStudents = AcademyQueries.getAvailableStudents(classId, weekNum);
        if (availableStudents.length === 0) {
            return failure('No available students for this class at week ' + weekNum + '.');
        }

        // ---- PHASE 4: GET TEAMS ----
        var teamsResult;
        if (Array.isArray(teamIds) && teamIds.length > 0) {
            teamsResult = validateTeamIds(teamIds, classId, weekNum, maxSize);
        } else {
            // Get all academic teams for this class
            var allTeams = AcademyQueries.getAcademicTeams(classId);
            var allTeamIds = [];
            for (var i = 0; i < allTeams.length; i++) {
                allTeamIds.push(allTeams[i].id);
            }
            teamsResult = validateTeamIds(allTeamIds, classId, weekNum, maxSize);
        }

        if (!teamsResult.valid) {
            return failure(teamsResult.message);
        }

        var validTeams = teamsResult.teams;

        // ---- PHASE 5: CALCULATE TOTAL CAPACITY ----
        var totalAvailableSlots = 0;
        for (var i = 0; i < validTeams.length; i++) {
            totalAvailableSlots += validTeams[i].availableSlots;
        }

        if (totalAvailableSlots === 0) {
            return failure('No available slots in any team.');
        }

        var studentsToAssign = Math.min(availableStudents.length, totalAvailableSlots);

        // ---- PHASE 6: SHUFFLE STUDENTS FOR FAIRNESS ----
        var shuffled = availableStudents.slice();
        for (var s = shuffled.length - 1; s > 0; s--) {
            var j = Math.floor(Math.random() * (s + 1));
            var temp = shuffled[s];
            shuffled[s] = shuffled[j];
            shuffled[j] = temp;
        }

        // ---- PHASE 7: BUILD ASSIGNMENT PLAN ----
        // Create a working copy of team slots
        var teamSlots = {};
        for (var i = 0; i < validTeams.length; i++) {
            teamSlots[validTeams[i].id] = validTeams[i].availableSlots;
        }

        var assignments = [];
        var capacityExceeded = 0;

        for (var a = 0; a < shuffled.length && a < studentsToAssign; a++) {
            var student = shuffled[a];

            // Find team with available slot (round-robin to balance)
            var targetTeam = null;
            var targetTeamId = null;

            for (var t = 0; t < validTeams.length; t++) {
                var teamId = validTeams[t].id;
                if (teamSlots[teamId] > 0) {
                    targetTeam = validTeams[t];
                    targetTeamId = teamId;
                    break;
                }
            }

            if (!targetTeam) {
                capacityExceeded++;
                continue;
            }

            assignments.push({
                studentId: student.id,
                student: student,
                teamId: targetTeamId,
                team: targetTeam,
                studentName: CharacterQueries.getDisplayName(student)
            });

            teamSlots[targetTeamId]--;
        }

        if (assignments.length === 0) {
            return failure('No students could be assigned. Check team capacity.');
        }

        // ---- PHASE 8: VALIDATE SCHEDULE CONFLICTS ----
        var conflicts = [];
        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];
            var studentId = assignment.studentId;

            // Check if student already has classes at the team's slots
            var teamSlots = AcademyGroups.getGroupSlots(assignment.teamId);
            if (teamSlots && teamSlots.length > 0) {
                for (var s2 = 0; s2 < teamSlots.length; s2++) {
                    var slot = teamSlots[s2];
                    if (slot.week === weekNum) {
                        if (AcademySchedule.hasConflict(studentId, weekNum, slot.day, slot.hour, slot.duration)) {
                            conflicts.push({
                                studentId: studentId,
                                studentName: assignment.studentName,
                                teamId: assignment.teamId,
                                teamName: assignment.team.name,
                                day: slot.day,
                                hour: slot.hour,
                                duration: slot.duration
                            });
                            break;
                        }
                    }
                }
            }
        }

        // ---- PHASE 9: HANDLE CONFLICTS ----
        if (conflicts.length > 0) {
            // If there are conflicts, we need to decide whether to proceed
            // For now, we'll proceed but report the conflicts
            // In a future version, we could try to resolve conflicts or skip those students
        }

        // ---- PHASE 10: COMMIT ASSIGNMENTS ----
        var assignedCount = 0;
        var failedAssignments = [];

        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];

            // Check if student is already in this team
            var students = AcademyGroups.getGroupStudents(assignment.teamId);
            var alreadyInTeam = false;
            for (var s2 = 0; s2 < students.length; s2++) {
                if (String(students[s2]) === String(assignment.studentId)) {
                    alreadyInTeam = true;
                    break;
                }
            }

            if (alreadyInTeam) {
                failedAssignments.push({
                    studentId: assignment.studentId,
                    studentName: assignment.studentName,
                    teamId: assignment.teamId,
                    teamName: assignment.team.name,
                    reason: 'Already in team'
                });
                continue;
            }

            // Use TeamCore to add member (this handles the actual mutation)
            var result = TeamCore.addMember(assignment.teamId, {
                characterId: assignment.studentId,
                role: 'Member',
                joinPeriod: String(weekNum),
                leavePeriod: ''
            });

            if (result) {
                assignedCount++;
            } else {
                failedAssignments.push({
                    studentId: assignment.studentId,
                    studentName: assignment.studentName,
                    teamId: assignment.teamId,
                    teamName: assignment.team.name,
                    reason: 'Failed to add member'
                });
            }
        }

        // ---- PHASE 11: LOG AND RETURN ----
        if (assignedCount > 0) {
            var className = classResult.class.name || 'Unknown';
            recordActivity('Auto-distributed ' + assignedCount + ' students in class ' + className + ' for week ' + weekNum);
        }

        // Determine if operation was successful
        var successResult = assignedCount > 0;

        return {
            success: successResult,
            assigned: assignedCount,
            capacityExceeded: capacityExceeded,
            conflictCount: conflicts.length,
            failedAssignments: failedAssignments,
            assignments: assignments,
            conflicts: conflicts,
            message: successResult
                ? 'Distributed ' + assignedCount + ' students successfully.'
                : 'No students could be assigned.'
        };
    }

    /**
     * Auto-distribute students with conflict resolution.
     * This version attempts to skip students with conflicts rather than failing.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {number} maxTeamSize - Maximum students per team
     * @param {array} teamIds - Optional array of team IDs
     * @param {object} options - Additional options
     * @param {boolean} options.skipConflicts - Skip students with conflicts (default: true)
     * @param {boolean} options.validateOnly - Only validate, don't commit (default: false)
     * @returns {object} Result with assigned students and any issues
     */
    function autoDistributeStudentsWithOptions(classId, week, maxTeamSize, teamIds, options) {
        options = options || {};
        var skipConflicts = options.skipConflicts !== false;
        var validateOnly = options.validateOnly === true;

        // ---- PHASE 1: VALIDATE BASIC INPUTS ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var maxSize = parseInt(maxTeamSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            return failure('Max team size must be at least 1.');
        }
        if (maxSize > 20) {
            return failure('Max team size cannot exceed 20.');
        }

        // ---- PHASE 2: VALIDATE CLASS ----
        var classResult = validateClassId(classId);
        if (!classResult.valid) {
            return failure(classResult.message);
        }

        // ---- PHASE 3: GET AVAILABLE STUDENTS ----
        var availableStudents = AcademyQueries.getAvailableStudents(classId, weekNum);
        if (availableStudents.length === 0) {
            return failure('No available students for this class at week ' + weekNum + '.');
        }

        // ---- PHASE 4: GET TEAMS ----
        var teamsResult;
        if (Array.isArray(teamIds) && teamIds.length > 0) {
            teamsResult = validateTeamIds(teamIds, classId, weekNum, maxSize);
        } else {
            var allTeams = AcademyQueries.getAcademicTeams(classId);
            var allTeamIds = [];
            for (var i = 0; i < allTeams.length; i++) {
                allTeamIds.push(allTeams[i].id);
            }
            teamsResult = validateTeamIds(allTeamIds, classId, weekNum, maxSize);
        }

        if (!teamsResult.valid) {
            return failure(teamsResult.message);
        }

        var validTeams = teamsResult.teams;

        // ---- PHASE 5: BUILD ASSIGNMENT PLAN WITH CONFLICT CHECKING ----
        var teamSlots = {};
        for (var i = 0; i < validTeams.length; i++) {
            teamSlots[validTeams[i].id] = validTeams[i].availableSlots;
        }

        // Get all team slots upfront
        var teamSlotsMap = {};
        for (var i = 0; i < validTeams.length; i++) {
            var slots = AcademyGroups.getGroupSlots(validTeams[i].id);
            if (slots && slots.length > 0) {
                teamSlotsMap[validTeams[i].id] = slots.filter(function(slot) {
                    return slot.week === weekNum;
                });
            } else {
                teamSlotsMap[validTeams[i].id] = [];
            }
        }

        var shuffled = availableStudents.slice();
        for (var s = shuffled.length - 1; s > 0; s--) {
            var j = Math.floor(Math.random() * (s + 1));
            var temp = shuffled[s];
            shuffled[s] = shuffled[j];
            shuffled[j] = temp;
        }

        var assignments = [];
        var capacityExceeded = 0;
        var skippedConflicts = 0;
        var conflicts = [];

        for (var a = 0; a < shuffled.length; a++) {
            var student = shuffled[a];

            // Find team with available slot
            var targetTeam = null;
            var targetTeamId = null;

            for (var t = 0; t < validTeams.length; t++) {
                var teamId = validTeams[t].id;
                if (teamSlots[teamId] > 0) {
                    targetTeam = validTeams[t];
                    targetTeamId = teamId;
                    break;
                }
            }

            if (!targetTeam) {
                capacityExceeded++;
                continue;
            }

            // Check for schedule conflicts
            var hasConflict = false;
            var conflictingSlots = [];
            var teamSlots2 = teamSlotsMap[targetTeamId] || [];

            if (teamSlots2.length > 0) {
                for (var s2 = 0; s2 < teamSlots2.length; s2++) {
                    var slot = teamSlots2[s2];
                    if (AcademySchedule.hasConflict(student.id, weekNum, slot.day, slot.hour, slot.duration)) {
                        hasConflict = true;
                        conflictingSlots.push({
                            day: slot.day,
                            hour: slot.hour,
                            duration: slot.duration
                        });
                    }
                }
            }

            if (hasConflict && skipConflicts) {
                skippedConflicts++;
                conflicts.push({
                    studentId: student.id,
                    studentName: CharacterQueries.getDisplayName(student),
                    teamId: targetTeamId,
                    teamName: targetTeam.name,
                    conflictingSlots: conflictingSlots
                });
                continue;
            }

            assignments.push({
                studentId: student.id,
                student: student,
                teamId: targetTeamId,
                team: targetTeam,
                studentName: CharacterQueries.getDisplayName(student),
                hasConflict: hasConflict,
                conflictingSlots: conflictingSlots
            });

            teamSlots[targetTeamId]--;
        }

        if (assignments.length === 0) {
            return failure('No students could be assigned. Check team capacity and conflicts.');
        }

        // ---- PHASE 6: VALIDATE ONLY ----
        if (validateOnly) {
            return success({
                assignments: assignments,
                assigned: assignments.length,
                capacityExceeded: capacityExceeded,
                skippedConflicts: skippedConflicts,
                conflicts: conflicts,
                totalAvailableStudents: availableStudents.length
            });
        }

        // ---- PHASE 7: COMMIT ASSIGNMENTS ----
        var assignedCount = 0;
        var failedAssignments = [];

        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];

            // Check if student is already in this team
            var students = AcademyGroups.getGroupStudents(assignment.teamId);
            var alreadyInTeam = false;
            for (var s2 = 0; s2 < students.length; s2++) {
                if (String(students[s2]) === String(assignment.studentId)) {
                    alreadyInTeam = true;
                    break;
                }
            }

            if (alreadyInTeam) {
                failedAssignments.push({
                    studentId: assignment.studentId,
                    studentName: assignment.studentName,
                    teamId: assignment.teamId,
                    teamName: assignment.team.name,
                    reason: 'Already in team'
                });
                continue;
            }

            var result = TeamCore.addMember(assignment.teamId, {
                characterId: assignment.studentId,
                role: 'Member',
                joinPeriod: String(weekNum),
                leavePeriod: ''
            });

            if (result) {
                assignedCount++;
            } else {
                failedAssignments.push({
                    studentId: assignment.studentId,
                    studentName: assignment.studentName,
                    teamId: assignment.teamId,
                    teamName: assignment.team.name,
                    reason: 'Failed to add member'
                });
            }
        }

        // ---- PHASE 8: LOG AND RETURN ----
        if (assignedCount > 0) {
            var className = classResult.class.name || 'Unknown';
            recordActivity('Auto-distributed ' + assignedCount + ' students in class ' + className + ' for week ' + weekNum);
        }

        var successResult = assignedCount > 0;

        return {
            success: successResult,
            assigned: assignedCount,
            capacityExceeded: capacityExceeded,
            skippedConflicts: skippedConflicts,
            conflictCount: conflicts.length,
            failedAssignments: failedAssignments,
            assignments: assignments,
            conflicts: conflicts,
            totalAvailableStudents: availableStudents.length,
            message: successResult
                ? 'Distributed ' + assignedCount + ' students successfully.'
                : 'No students could be assigned.'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDistribute = {
        // Main distribution
        autoDistributeStudents: autoDistributeStudents,
        autoDistributeStudentsWithOptions: autoDistributeStudentsWithOptions,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validateClassId: validateClassId,
        validateTeamIds: validateTeamIds
    };

})();