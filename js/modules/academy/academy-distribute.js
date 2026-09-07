/**
 * js/modules/academy/academy-distribute.js - Academy Distribution
 * Cross-domain distribution workflow for the Academy
 * Path: js/modules/academy/academy-distribute.js
 * 
 * This module handles:
 *   - Auto-distribution of students to academic teams
 *   - Balanced distribution based on team capacity
 *   - Conflict detection with schedules
 *   - Candidate-based planning with atomic execution
 * 
 * IMPORTANT:
 *   - This is a CROSS-DOMAIN workflow combining:
 *     - Classes (students)
 *     - Teams (capacity)
 *     - Schedules (conflict detection)
 *   - All operations are CANDIDATE-BASED: build plan, then execute
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 * 
 * DEPENDENCIES:
 *   - window.AcademyClassQueries (from academy-class-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.TeamCore (from team-core.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.CalendarScheduleCore (from calendar/core/schedule-core.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 *   - window.ObjectUtils (from object-utils.js)
 * 
 * USAGE:
 *   var distribute = window.AcademyDistribute;
 *   var plan = distribute.buildDistributionPlan(classId, week, maxTeamSize, teamIds, options);
 *   if (plan.success) {
 *     // Apply plan via MutationPipeline
 *   }
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

    var AcademyClassQueries = window.AcademyClassQueries;
    var TeamQueries = window.TeamQueries;
    var TeamCore = window.TeamCore;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarScheduleCore = window.CalendarScheduleCore;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyClassQueries || typeof AcademyClassQueries.getClass !== 'function') {
            missing.push('AcademyClassQueries.getClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getCharactersByClass !== 'function') {
            missing.push('AcademyClassQueries.getCharactersByClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getAvailableStudentsForClass !== 'function') {
            missing.push('AcademyClassQueries.getAvailableStudentsForClass');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByType !== 'function') {
            missing.push('TeamQueries.getTeamsByType');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }

        if (!TeamCore || typeof TeamCore.getTeam !== 'function') {
            missing.push('TeamCore.getTeam');
        }
        if (!TeamCore || typeof TeamCore.addMember !== 'function') {
            missing.push('TeamCore.addMember');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!CalendarScheduleCore || typeof CalendarScheduleCore.hasConflict !== 'function') {
            missing.push('CalendarScheduleCore.hasConflict');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (missing.length > 0) {
            throw new Error('AcademyDistribute: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MAX_TEAM_SIZE = 20;

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    function validatePositiveInteger(value, min, max) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < min || num > max) {
            return null;
        }
        return num;
    }

    function validateClassId(classId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }
        var cls = AcademyClassQueries.getClass(classId);
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

            if (team.type !== 'academic') {
                errors.push('Team "' + team.name + '" is not an academic team.');
                continue;
            }

            if (String(team.classId) !== String(classId)) {
                errors.push('Team "' + team.name + '" does not belong to this class.');
                continue;
            }

            if (team.status !== 'active') {
                errors.push('Team "' + team.name + '" is not active.');
                continue;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(team, weekNum);
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
    // CORE DISTRIBUTION ALGORITHM - Build Plan Only
    // ============================================================

    /**
     * Build a distribution plan without applying any mutations.
     * This is the single source of truth for the distribution algorithm.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {number} maxTeamSize - Maximum students per team
     * @param {array} teamIds - Optional array of team IDs (if not provided, all academic teams in class are used)
     * @param {object} options - Additional options
     * @param {boolean} options.skipConflicts - Skip students with conflicts (default: true)
     * @param {boolean} options.balancePolicy - 'round-robin' | 'least-occupied' | 'fill-capacity' (default: 'least-occupied')
     * @param {boolean} options.shuffleStudents - Randomise student order (default: true)
     * @returns {object} Distribution plan with assignments, conflicts, and metadata
     */
    function buildDistributionPlan(classId, week, maxTeamSize, teamIds, options) {
        options = options || {};
        var skipConflicts = options.skipConflicts !== false;
        var balancePolicy = options.balancePolicy || 'least-occupied';
        var shuffleStudents = options.shuffleStudents !== false;

        // ---- PHASE 1: VALIDATE BASIC INPUTS ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var maxSize = validatePositiveInteger(maxTeamSize, 1, MAX_TEAM_SIZE);
        if (maxSize === null) {
            return failure('Max team size must be between 1 and ' + MAX_TEAM_SIZE + '.');
        }

        // ---- PHASE 2: VALIDATE CLASS ----
        var classResult = validateClassId(classId);
        if (!classResult.valid) {
            return failure(classResult.message);
        }

        // ---- PHASE 3: GET AVAILABLE STUDENTS ----
        var availableStudents = AcademyClassQueries.getAvailableStudentsForClass(classId, weekNum);
        if (availableStudents.length === 0) {
            return failure('No available students for this class at week ' + weekNum + '.');
        }

        // ---- PHASE 4: GET TEAMS ----
        var teamsResult;
        if (Array.isArray(teamIds) && teamIds.length > 0) {
            teamsResult = validateTeamIds(teamIds, classId, weekNum, maxSize);
        } else {
            var allTeams = TeamQueries.getTeamsByType('academic', 'operational');
            var allTeamIds = [];
            for (var i = 0; i < allTeams.length; i++) {
                if (String(allTeams[i].classId) === String(classId)) {
                    allTeamIds.push(allTeams[i].id);
                }
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
        if (shuffleStudents) {
            for (var s = shuffled.length - 1; s > 0; s--) {
                var j = Math.floor(Math.random() * (s + 1));
                var temp = shuffled[s];
                shuffled[s] = shuffled[j];
                shuffled[j] = temp;
            }
        }

        // ---- PHASE 7: GET TEAM SCHEDULE SLOTS ----
        var teamSlotsMap = {};
        for (var i = 0; i < validTeams.length; i++) {
            var team = validTeams[i];
            // Use TeamCore to get team schedule slots
            // This assumes teams have a slots property or can be queried
            var slots = [];
            if (team.slots && Array.isArray(team.slots)) {
                slots = team.slots.filter(function(slot) {
                    return slot.week === weekNum;
                });
            }
            teamSlotsMap[team.id] = slots;
        }

        // ---- PHASE 8: BUILD ASSIGNMENT PLAN ----
        var teamSlots = {};
        for (var i = 0; i < validTeams.length; i++) {
            teamSlots[validTeams[i].id] = validTeams[i].availableSlots;
        }

        var assignments = [];
        var skippedConflicts = 0;
        var conflicts = [];
        var capacityExceeded = 0;

        // Track remaining capacity per team for least-occupied policy
        var remainingCapacity = {};
        for (var i = 0; i < validTeams.length; i++) {
            remainingCapacity[validTeams[i].id] = validTeams[i].availableSlots;
        }

        // Current occupancy for least-occupied policy
        var currentOccupancy = {};
        for (var i = 0; i < validTeams.length; i++) {
            currentOccupancy[validTeams[i].id] = validTeams[i].currentCount;
        }

        for (var a = 0; a < shuffled.length && a < studentsToAssign; a++) {
            var student = shuffled[a];

            // ---- PHASE 8a: Evaluate candidate teams ----
            var candidateTeams = [];

            for (var t = 0; t < validTeams.length; t++) {
                var team = validTeams[t];
                var teamId = team.id;

                if (teamSlots[teamId] <= 0) {
                    continue;
                }

                // Check schedule conflicts
                var hasConflict = false;
                var conflictingSlots = [];
                var teamSlots2 = teamSlotsMap[teamId] || [];

                if (teamSlots2.length > 0) {
                    for (var s2 = 0; s2 < teamSlots2.length; s2++) {
                        var slot = teamSlots2[s2];
                        // Use CalendarScheduleCore for conflict detection
                        if (CalendarScheduleCore.hasConflict(
                            null, // schedule will be looked up internally
                            slot.day,
                            slot.hour,
                            slot.duration
                        )) {
                            hasConflict = true;
                            conflictingSlots.push({
                                day: slot.day,
                                hour: slot.hour,
                                duration: slot.duration
                            });
                        }
                    }
                }

                candidateTeams.push({
                    team: team,
                    teamId: teamId,
                    hasConflict: hasConflict,
                    conflictingSlots: conflictingSlots,
                    currentOccupancy: currentOccupancy[teamId] || 0,
                    availableSlots: teamSlots[teamId]
                });
            }

            // ---- PHASE 8b: Filter by conflict policy ----
            var availableTeams = candidateTeams;
            if (skipConflicts) {
                availableTeams = candidateTeams.filter(function(t) {
                    return !t.hasConflict;
                });
            }

            if (availableTeams.length === 0) {
                if (skipConflicts) {
                    skippedConflicts++;
                    conflicts.push({
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        candidateTeams: candidateTeams.map(function(t) {
                            return {
                                teamId: t.teamId,
                                teamName: t.team.name,
                                hasConflict: t.hasConflict
                            };
                        })
                    });
                }
                continue;
            }

            // ---- PHASE 8c: Select best team by balancing policy ----
            var selectedTeam = null;

            if (balancePolicy === 'round-robin') {
                // Round-robin: track last assigned index
                // Simple implementation: pick first available team with remaining slots
                // More sophisticated round-robin would maintain a pointer
                for (var i = 0; i < availableTeams.length; i++) {
                    if (availableTeams[i].availableSlots > 0) {
                        selectedTeam = availableTeams[i];
                        break;
                    }
                }
            } else if (balancePolicy === 'least-occupied') {
                // Least occupied first: pick team with lowest current occupancy
                var sortedByOccupancy = availableTeams.slice().sort(function(a, b) {
                    return a.currentOccupancy - b.currentOccupancy;
                });
                for (var i = 0; i < sortedByOccupancy.length; i++) {
                    if (sortedByOccupancy[i].availableSlots > 0) {
                        selectedTeam = sortedByOccupancy[i];
                        break;
                    }
                }
            } else {
                // 'fill-capacity' or default: fill teams sequentially
                for (var i = 0; i < availableTeams.length; i++) {
                    if (availableTeams[i].availableSlots > 0) {
                        selectedTeam = availableTeams[i];
                        break;
                    }
                }
            }

            if (!selectedTeam) {
                capacityExceeded++;
                continue;
            }

            // ---- PHASE 8d: Record assignment ----
            assignments.push({
                studentId: student.id,
                student: student,
                teamId: selectedTeam.teamId,
                team: selectedTeam.team,
                studentName: CharacterQueries.getDisplayName(student),
                hasConflict: selectedTeam.hasConflict,
                conflictingSlots: selectedTeam.conflictingSlots
            });

            // Update capacity and occupancy
            teamSlots[selectedTeam.teamId]--;
            currentOccupancy[selectedTeam.teamId] = (currentOccupancy[selectedTeam.teamId] || 0) + 1;
        }

        if (assignments.length === 0) {
            return failure('No students could be assigned. Check team capacity and conflicts.');
        }

        // ---- PHASE 9: Build the execution plan ----
        function buildMutation() {
            var mutationData = {
                assignments: [],
                assignedCount: 0,
                failedAssignments: []
            };

            for (var i = 0; i < assignments.length; i++) {
                var assignment = assignments[i];

                // Check if student is already in this team
                var team = TeamCore.getTeam(assignment.teamId);
                if (!team) {
                    mutationData.failedAssignments.push({
                        studentId: assignment.studentId,
                        studentName: assignment.studentName,
                        teamId: assignment.teamId,
                        teamName: assignment.team.name,
                        reason: 'Team not found'
                    });
                    continue;
                }

                var members = TeamQueries.getActiveTeamMembers(team, weekNum);
                var alreadyInTeam = false;
                for (var j = 0; j < members.length; j++) {
                    if (String(members[j].characterId) === String(assignment.studentId)) {
                        alreadyInTeam = true;
                        break;
                    }
                }

                if (alreadyInTeam) {
                    mutationData.failedAssignments.push({
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
                    mutationData.assignedCount++;
                    mutationData.assignments.push(assignment);
                } else {
                    mutationData.failedAssignments.push({
                        studentId: assignment.studentId,
                        studentName: assignment.studentName,
                        teamId: assignment.teamId,
                        teamName: assignment.team.name,
                        reason: 'Failed to add member'
                    });
                }
            }

            return mutationData;
        }

        function mutate(data) {
            var result = buildMutation();
            return result;
        }

        // ---- PHASE 10: Return plan ----
        var className = classResult.class.name || 'Unknown';

        return success({
            // Plan metadata
            classId: classId,
            className: className,
            week: weekNum,
            maxTeamSize: maxSize,

            // Assignment data
            assignments: assignments,
            assigned: assignments.length,
            capacityExceeded: capacityExceeded,
            skippedConflicts: skippedConflicts,
            conflictCount: conflicts.length,

            // Detailed reports
            conflicts: conflicts,
            totalAvailableStudents: availableStudents.length,

            // Execution function (for MutationPipeline)
            mutate: mutate,

            // Validation function (for MutationPipeline)
            validate: function(data) {
                return { valid: true };
            },

            // Result summary
            summary: {
                totalStudents: availableStudents.length,
                assignedStudents: assignments.length,
                skippedStudents: skippedConflicts + capacityExceeded,
                teamsUsed: function() {
                    var used = {};
                    for (var i = 0; i < assignments.length; i++) {
                        used[assignments[i].teamId] = true;
                    }
                    return Object.keys(used).length;
                }()
            }
        });
    }

    // ============================================================
    // EXECUTE PLAN - Applies a plan via MutationPipeline
    // ============================================================

    /**
     * Execute a distribution plan.
     * This is the recommended way to apply a plan.
     * 
     * @param {object} plan - The plan returned by buildDistributionPlan
     * @param {object} options - Execution options
     * @param {boolean} options.validateOnly - If true, only validate the plan
     * @returns {object} Execution result
     */
    function executeDistributionPlan(plan, options) {
        options = options || {};

        if (!plan || !plan.success) {
            return failure('Invalid or failed plan.');
        }

        if (options.validateOnly) {
            return success({
                validated: true,
                plan: plan.data,
                summary: plan.data.summary
            });
        }

        try {
            var result = plan.data.mutate(window.data);
            return success({
                executed: true,
                assigned: result.assignedCount || 0,
                assignments: result.assignments || [],
                failedAssignments: result.failedAssignments || [],
                summary: plan.data.summary
            });
        } catch (e) {
            return failure(e.message || 'Failed to execute distribution plan.');
        }
    }

    // ============================================================
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These build and execute the plan directly.
    // DEPRECATED: Use buildDistributionPlan + MutationPipeline.
    // ============================================================

    /**
     * Legacy: Auto-distribute students directly.
     * DEPRECATED: Use buildDistributionPlan + executeDistributionPlan.
     */
    function autoDistributeStudents(classId, week, maxTeamSize, teamIds) {
        var plan = buildDistributionPlan(classId, week, maxTeamSize, teamIds, {
            skipConflicts: false,
            balancePolicy: 'fill-capacity',
            shuffleStudents: true
        });

        if (!plan.success) {
            return failure(plan.message);
        }

        try {
            var result = plan.data.mutate(window.data);
            return {
                success: result.assignedCount > 0,
                assigned: result.assignedCount || 0,
                capacityExceeded: plan.data.capacityExceeded || 0,
                conflictCount: plan.data.conflictCount || 0,
                failedAssignments: result.failedAssignments || [],
                assignments: result.assignments || [],
                conflicts: plan.data.conflicts || [],
                message: result.assignedCount > 0
                    ? 'Distributed ' + result.assignedCount + ' students successfully.'
                    : 'No students could be assigned.'
            };
        } catch (e) {
            return failure(e.message || 'Failed to distribute students.');
        }
    }

    /**
     * Legacy: Auto-distribute with options.
     * DEPRECATED: Use buildDistributionPlan + executeDistributionPlan.
     */
    function autoDistributeStudentsWithOptions(classId, week, maxTeamSize, teamIds, options) {
        options = options || {};
        var plan = buildDistributionPlan(classId, week, maxTeamSize, teamIds, {
            skipConflicts: options.skipConflicts !== false,
            balancePolicy: options.balancePolicy || 'least-occupied',
            shuffleStudents: options.shuffleStudents !== false
        });

        if (!plan.success) {
            return failure(plan.message);
        }

        if (options.validateOnly) {
            return success({
                assignments: plan.data.assignments,
                assigned: plan.data.assigned,
                capacityExceeded: plan.data.capacityExceeded,
                skippedConflicts: plan.data.skippedConflicts,
                conflicts: plan.data.conflicts,
                totalAvailableStudents: plan.data.totalAvailableStudents,
                summary: plan.data.summary
            });
        }

        try {
            var result = plan.data.mutate(window.data);
            return {
                success: result.assignedCount > 0,
                assigned: result.assignedCount || 0,
                capacityExceeded: plan.data.capacityExceeded || 0,
                skippedConflicts: plan.data.skippedConflicts || 0,
                conflictCount: plan.data.conflictCount || 0,
                failedAssignments: result.failedAssignments || [],
                assignments: result.assignments || [],
                conflicts: plan.data.conflicts || [],
                totalAvailableStudents: plan.data.totalAvailableStudents,
                message: result.assignedCount > 0
                    ? 'Distributed ' + result.assignedCount + ' students successfully.'
                    : 'No students could be assigned.'
            };
        } catch (e) {
            return failure(e.message || 'Failed to distribute students.');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDistribute = {
        // Primary API - Build plan, then execute
        buildDistributionPlan: buildDistributionPlan,
        executeDistributionPlan: executeDistributionPlan,

        // Legacy wrappers (deprecated - use with caution)
        autoDistributeStudents: autoDistributeStudents,
        autoDistributeStudentsWithOptions: autoDistributeStudentsWithOptions,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validatePositiveInteger: validatePositiveInteger,
        validateClassId: validateClassId,
        validateTeamIds: validateTeamIds,

        // Constants
        MAX_TEAM_SIZE: MAX_TEAM_SIZE
    };

})();
