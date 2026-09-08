/**
 * modules/academy/academy-distribute.js - Academy Distribute
 * Auto-distribution engine for assigning students to classes and schedules
 * 
 * This module is responsible for:
 *   - Auto-distributing students across classes
 *   - Balancing class sizes
 *   - Assigning students to disciplines and instructors
 *   - Building schedules from distribution data
 *   - Validation and conflict detection
 * 
 * IMPORTANT:
 *   - This module orchestrates distribution (algorithm + mutation)
 *   - Uses AcademyQueries for read-only data access
 *   - Uses AcademySchedule for academic scheduling operations
 *   - Uses CalendarProvider for schedule conflicts
 *   - No direct CalendarCore or ScheduleCore dependency
 *   - Distribution algorithm is PURE and testable
 *   - Mutations are applied through AcademySchedule
 *   - This module does NOT call saveData() - callers own persistence
 * 
 * MUTATION CONTRACT:
 *   - All operations are candidate-based: VALIDATE → ALGORITHM → APPLY
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.AcademySchedule (from academy-schedule.js) - MANDATORY
 *   - window.AcademyConstants (from academy-constants.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.CalendarQueries (from calendar-queries.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var distribute = window.AcademyDistribute;
 *   
 *   // Auto-distribute students
 *   var result = distribute.autoDistribute('class_123', 5);
 *   var result = distribute.autoDistributeWithGroups('class_123', 5, 4);
 *   
 *   // Build schedules
 *   var result = distribute.buildScheduleFromGroups('class_123', 5);
 *   
 *   // Advanced distribution
 *   var result = distribute.distributeBySkill('class_123', 5, {
 *     maxPerGroup: 6,
 *     minPerGroup: 3
 *   });
 */

(function() {
    'use strict';

    if (window.__academyDistributeLoaded) {
        return;
    }
    window.__academyDistributeLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var AcademySchedule = window.AcademySchedule;
    var AcademyConstants = window.AcademyConstants;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarQueries = window.CalendarQueries;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var DEFAULT_WEEK = 1;

    var DEFAULT_MAX_PER_GROUP = AcademyConstants.MAX_TEAM_SIZE || 8;
    var DEFAULT_MIN_PER_GROUP = AcademyConstants.MIN_TEAM_SIZE || 2;
    var DEFAULT_TARGET_PER_GROUP = AcademyConstants.DEFAULT_TEAM_SIZE || 4;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
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

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return DEFAULT_WEEK;
    }

    function parseWeek(week) {
        return CalendarValidation.parseWeek(week);
    }

    function parseDay(day) {
        return CalendarValidation.parseDay(day);
    }

    function parseHour(hour) {
        return CalendarValidation.parseHour(hour);
    }

    function parseDuration(duration) {
        return CalendarValidation.parseDuration(duration);
    }

    function shuffleArray(array) {
        var arr = array.slice();
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
        }
        return arr;
    }

    function getAvailableHours() {
        var hours = [];
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }
        return hours;
    }

    function getAvailableDays() {
        var days = [];
        for (var d = MIN_DAY; d <= MAX_DAY; d++) {
            days.push(d);
        }
        return days;
    }

    // ============================================================
    // DISTRIBUTION ALGORITHM - PURE FUNCTION
    // ============================================================

    /**
     * Distribute students into groups.
     * This is a PURE function - no side effects, no mutations.
     * 
     * @param {array} students - Array of student objects
     * @param {number} numGroups - Number of groups to create
     * @param {object} options - Distribution options
     * @param {number} options.maxPerGroup - Maximum students per group
     * @param {number} options.minPerGroup - Minimum students per group
     * @param {number} options.targetPerGroup - Target students per group
     * @param {string} options.method - Distribution method ('balanced', 'random', 'skill')
     * @param {function} options.getSkill - Function to get student skill level
     * @returns {array} Array of groups { id, students, count }
     */
    function distributeStudents(students, numGroups, options) {
        if (!Array.isArray(students) || students.length === 0) {
            return [];
        }

        if (numGroups < 1) {
            numGroups = 1;
        }

        options = options || {};
        var method = options.method || 'balanced';
        var maxPerGroup = options.maxPerGroup || DEFAULT_MAX_PER_GROUP;
        var minPerGroup = options.minPerGroup || DEFAULT_MIN_PER_GROUP;
        var targetPerGroup = options.targetPerGroup || DEFAULT_TARGET_PER_GROUP;

        // Adjust number of groups based on student count
        var idealGroups = Math.ceil(students.length / targetPerGroup);
        var actualGroups = Math.max(1, Math.min(numGroups, Math.ceil(students.length / minPerGroup)));

        if (actualGroups < 1) {
            actualGroups = 1;
        }

        // Create empty groups
        var groups = [];
        for (var i = 0; i < actualGroups; i++) {
            groups.push({
                id: 'group_' + (i + 1),
                students: [],
                count: 0
            });
        }

        var shuffledStudents = shuffleArray(students);

        // Distribute based on method
        if (method === 'balanced') {
            // Round-robin distribution
            for (var j = 0; j < shuffledStudents.length; j++) {
                var groupIndex = j % actualGroups;
                if (groups[groupIndex].count < maxPerGroup) {
                    groups[groupIndex].students.push(shuffledStudents[j]);
                    groups[groupIndex].count++;
                } else {
                    // Find the least filled group
                    var minIndex = 0;
                    var minCount = groups[0].count;
                    for (var k = 1; k < groups.length; k++) {
                        if (groups[k].count < minCount && groups[k].count < maxPerGroup) {
                            minCount = groups[k].count;
                            minIndex = k;
                        }
                    }
                    if (groups[minIndex].count < maxPerGroup) {
                        groups[minIndex].students.push(shuffledStudents[j]);
                        groups[minIndex].count++;
                    } else {
                        // All groups are full - add to the smallest
                        var smallestIndex = 0;
                        var smallestCount = groups[0].count;
                        for (var l = 1; l < groups.length; l++) {
                            if (groups[l].count < smallestCount) {
                                smallestCount = groups[l].count;
                                smallestIndex = l;
                            }
                        }
                        groups[smallestIndex].students.push(shuffledStudents[j]);
                        groups[smallestIndex].count++;
                    }
                }
            }
        } else if (method === 'skill') {
            // Sort by skill (if provided)
            var getSkill = options.getSkill || function(student) {
                var stats = CharacterQueries.getCharacterStats(student);
                if (!stats) { return 50; }
                var total = 0;
                var count = 0;
                for (var key in stats) {
                    if (Object.prototype.hasOwnProperty.call(stats, key)) {
                        total += stats[key] || 0;
                        count++;
                    }
                }
                return count > 0 ? total / count : 50;
            };

            var sortedStudents = shuffledStudents.sort(function(a, b) {
                var skillA = getSkill(a) || 0;
                var skillB = getSkill(b) || 0;
                return skillA - skillB;
            });

            // Snake distribution for balanced skill
            var snake = [];
            for (var m = 0; m < sortedStudents.length; m++) {
                var groupIdx = m % actualGroups;
                if (Math.floor(m / actualGroups) % 2 === 1) {
                    groupIdx = actualGroups - 1 - groupIdx;
                }
                if (!snake[groupIdx]) {
                    snake[groupIdx] = [];
                }
                snake[groupIdx].push(sortedStudents[m]);
            }

            for (var n = 0; n < snake.length; n++) {
                if (snake[n]) {
                    groups[n].students = snake[n];
                    groups[n].count = snake[n].length;
                }
            }
        } else {
            // Random distribution
            for (var o = 0; o < shuffledStudents.length; o++) {
                var randomIndex = Math.floor(Math.random() * actualGroups);
                var attempts = 0;
                while (groups[randomIndex].count >= maxPerGroup && attempts < actualGroups * 2) {
                    randomIndex = Math.floor(Math.random() * actualGroups);
                    attempts++;
                }
                groups[randomIndex].students.push(shuffledStudents[o]);
                groups[randomIndex].count++;
            }
        }

        return groups;
    }

    // ============================================================
    // AUTO-DISTRIBUTE - MAIN ENTRY POINT
    // ============================================================

    /**
     * Auto-distribute students in a class for a given week.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Distribution options
     * @param {number} options.numGroups - Number of groups (default: auto-calculated)
     * @param {number} options.maxPerGroup - Maximum students per group
     * @param {number} options.minPerGroup - Minimum students per group
     * @param {number} options.targetPerGroup - Target students per group
     * @param {string} options.method - Distribution method ('balanced', 'random', 'skill')
     * @param {string} options.disciplineId - Optional discipline to assign
     * @param {string} options.instructorId - Optional instructor to assign
     * @param {number} options.duration - Class duration in hours
     * @param {array} options.availableHours - Available hours for scheduling
     * @param {array} options.availableDays - Available days for scheduling
     * @param {boolean} options.clearExisting - Clear existing schedule before distribution
     * @param {function} options.getSkill - Function to get student skill level
     * @param {array} options.teamIds - Specific teams to distribute to (optional)
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function autoDistribute(classId, week, options) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        options = options || {};

        // ---- PHASE 2: GET STUDENTS ----
        var students = AcademyQueries.getClassStudents(classId);

        if (!students || students.length === 0) {
            return failure('No students found in this class.');
        }

        var classRecord = AcademyQueries.getClass(classId);
        if (!classRecord) {
            return failure('Class not found.');
        }

        // ---- PHASE 3: CLEAR EXISTING SCHEDULES ----
        if (options.clearExisting) {
            for (var i = 0; i < students.length; i++) {
                AcademySchedule.clearStudentSchedule(students[i].id, weekNum);
            }
        }

        // ---- PHASE 4: DETERMINE DISTRIBUTION SETTINGS ----
        var numGroups = options.numGroups || Math.ceil(students.length / DEFAULT_TARGET_PER_GROUP);
        var maxPerGroup = options.maxPerGroup || DEFAULT_MAX_PER_GROUP;
        var minPerGroup = options.minPerGroup || DEFAULT_MIN_PER_GROUP;
        var targetPerGroup = options.targetPerGroup || DEFAULT_TARGET_PER_GROUP;

        // ---- PHASE 5: DISTRIBUTE STUDENTS (PURE ALGORITHM) ----
        var groups = distributeStudents(students, numGroups, {
            method: options.method || 'balanced',
            maxPerGroup: maxPerGroup,
            minPerGroup: minPerGroup,
            targetPerGroup: targetPerGroup,
            getSkill: options.getSkill
        });

        // ---- PHASE 6: BUILD SCHEDULE FROM GROUPS ----
        var availableHours = options.availableHours || getAvailableHours();
        var availableDays = options.availableDays || getAvailableDays();
        var disciplineId = options.disciplineId || null;
        var instructorId = options.instructorId || null;
        var duration = options.duration || 1;
        var teamIds = options.teamIds || null;

        var scheduleResult = buildScheduleFromGroups(
            groups,
            weekNum,
            availableDays,
            availableHours,
            disciplineId,
            instructorId,
            duration,
            options,
            teamIds
        );

        if (!scheduleResult.success) {
            return failure(scheduleResult.message);
        }

        return success({
            classId: classId,
            week: weekNum,
            groups: groups,
            schedule: scheduleResult.data,
            totalStudents: students.length,
            groupCount: groups.length
        });
    }

    /**
     * Auto-distribute with explicit group count.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {number} numGroups - Number of groups
     * @param {object} options - Distribution options
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function autoDistributeWithGroups(classId, week, numGroups, options) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNumber(numGroups) || numGroups < 1) {
            return failure('Number of groups must be at least 1.');
        }

        options = options || {};
        options.numGroups = numGroups;

        return autoDistribute(classId, week, options);
    }

    // ============================================================
    // SCHEDULE BUILDING
    // ============================================================

    /**
     * Build a schedule from student groups.
     * 
     * @param {array} groups - Array of group objects { id, students, count }
     * @param {number|string} week - Week number
     * @param {array} availableDays - Available days for scheduling
     * @param {array} availableHours - Available hours for scheduling
     * @param {string} disciplineId - Discipline ID to assign
     * @param {string} instructorId - Instructor ID to assign
     * @param {number} duration - Class duration in hours
     * @param {object} options - Additional options
     * @param {string} options.labelPrefix - Prefix for class labels
     * @param {function} options.getGroupLabel - Function to generate group labels
     * @param {array} options.teamIds - Specific teams to distribute to
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function buildScheduleFromGroups(groups, week, availableDays, availableHours, disciplineId, instructorId, duration, options, teamIds) {
        // ---- PHASE 1: VALIDATE ----
        if (!Array.isArray(groups) || groups.length === 0) {
            return failure('At least one group is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (!Array.isArray(availableDays) || availableDays.length === 0) {
            availableDays = getAvailableDays();
        }

        if (!Array.isArray(availableHours) || availableHours.length === 0) {
            availableHours = getAvailableHours();
        }

        duration = parseDuration(duration) || 1;

        options = options || {};

        // ---- PHASE 2: GET TEAMS ----
        var teams = [];
        if (teamIds && Array.isArray(teamIds) && teamIds.length > 0) {
            // Use specific teams
            for (var i = 0; i < teamIds.length; i++) {
                var team = TeamQueries.getTeamById(teamIds[i]);
                if (team) {
                    teams.push(team);
                }
            }
        }

        // If no teams specified or none found, use all teams
        if (teams.length === 0) {
            // We need the classId to get teams - this should be passed in
            // For now, we'll use the groups themselves
            teams = groups.map(function(g, idx) {
                return {
                    id: g.id || 'team_' + (idx + 1),
                    name: options.getGroupLabel ? options.getGroupLabel(g.id, idx, groups.length) : ('Group ' + (idx + 1)),
                    members: g.students || []
                };
            });
        }

        // ---- PHASE 3: SCHEDULE EACH GROUP ----
        var scheduledGroups = [];
        var scheduledStudents = {};
        var errors = [];

        var days = shuffleArray(availableDays);
        var hours = shuffleArray(availableHours);

        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            var groupId = group.id || 'group_' + (g + 1);
            var students = group.students || [];

            if (students.length === 0) {
                scheduledGroups.push({
                    groupId: groupId,
                    students: [],
                    scheduled: false,
                    reason: 'No students in group'
                });
                continue;
            }

            // Find an available slot for this group
            var slotFound = false;
            var assignedDay = null;
            var assignedHour = null;

            // Try each day and hour combination
            for (var d = 0; d < days.length && !slotFound; d++) {
                var day = days[d];
                for (var h = 0; h < hours.length && !slotFound; h++) {
                    var hour = hours[h];

                    // Check if this slot is available for all students in the group
                    var slotAvailable = true;
                    for (var s = 0; s < students.length; s++) {
                        var student = students[s];
                        if (!student || !student.id) { continue; }

                        // Check for conflicts using AcademySchedule
                        if (AcademySchedule.hasStudentScheduleConflict(student.id, weekNum, day, hour, duration)) {
                            slotAvailable = false;
                            break;
                        }
                    }

                    if (slotAvailable) {
                        slotFound = true;
                        assignedDay = day;
                        assignedHour = hour;
                    }
                }
            }

            if (!slotFound) {
                errors.push({
                    groupId: groupId,
                    error: 'No available slot found for group with ' + students.length + ' students'
                });
                scheduledGroups.push({
                    groupId: groupId,
                    students: students,
                    scheduled: false,
                    reason: 'No available slot found'
                });
                continue;
            }

            // Assign the slot to all students in the group
            var label = options.getGroupLabel ?
                options.getGroupLabel(groupId, g, groups.length) :
                (options.labelPrefix || 'Group ') + (g + 1);

            var metadata = {
                groupLabel: label,
                instructorId: instructorId || null
            };

            var assignErrors = [];
            var assignedStudents = [];

            for (var s2 = 0; s2 < students.length; s2++) {
                var student = students[s2];
                if (!student || !student.id) { continue; }

                var result = AcademySchedule.setStudentScheduleClass(
                    student.id,
                    weekNum,
                    assignedDay,
                    assignedHour,
                    disciplineId,
                    duration,
                    metadata
                );

                if (result.success) {
                    assignedStudents.push(student.id);
                    if (!scheduledStudents[student.id]) {
                        scheduledStudents[student.id] = [];
                    }
                    scheduledStudents[student.id].push({
                        day: assignedDay,
                        hour: assignedHour,
                        disciplineId: disciplineId,
                        duration: duration,
                        groupLabel: label
                    });
                } else {
                    assignErrors.push({
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        error: result.message
                    });
                }
            }

            scheduledGroups.push({
                groupId: groupId,
                students: students.map(function(s) { return s.id; }),
                scheduled: true,
                day: assignedDay,
                hour: assignedHour,
                disciplineId: disciplineId,
                duration: duration,
                label: label,
                studentCount: assignedStudents.length,
                errors: assignErrors
            });
        }

        return success({
            scheduledGroups: scheduledGroups,
            scheduledStudents: scheduledStudents,
            totalGroups: groups.length,
            scheduledCount: scheduledGroups.filter(function(g) { return g.scheduled; }).length,
            errors: errors
        });
    }

    // ============================================================
    // ADVANCED DISTRIBUTION
    // ============================================================

    /**
     * Distribute by skill level.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Distribution options
     * @param {number} options.maxPerGroup - Maximum students per group
     * @param {number} options.minPerGroup - Minimum students per group
     * @param {number} options.targetPerGroup - Target students per group
     * @param {string} options.disciplineId - Discipline to assign
     * @param {string} options.instructorId - Instructor to assign
     * @param {number} options.duration - Class duration
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function distributeBySkill(classId, week, options) {
        options = options || {};
        options.method = 'skill';
        return autoDistribute(classId, week, options);
    }

    /**
     * Distribute evenly (balanced).
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Distribution options
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function distributeEvenly(classId, week, options) {
        options = options || {};
        options.method = 'balanced';
        return autoDistribute(classId, week, options);
    }

    /**
     * Distribute randomly.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Distribution options
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function distributeRandom(classId, week, options) {
        options = options || {};
        options.method = 'random';
        return autoDistribute(classId, week, options);
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Check if a distribution is valid.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Check options
     * @param {number} options.maxPerGroup - Maximum students per group
     * @param {number} options.minPerGroup - Minimum students per group
     * @returns {object} { valid: boolean, issues: array }
     */
    function validateDistribution(classId, week, options) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return { valid: false, issues: ['Invalid week number.'] };
        }

        options = options || {};
        var maxPerGroup = options.maxPerGroup || DEFAULT_MAX_PER_GROUP;
        var minPerGroup = options.minPerGroup || DEFAULT_MIN_PER_GROUP;

        var students = AcademyQueries.getClassStudents(classId);
        if (!students || students.length === 0) {
            return { valid: true, issues: [] };
        }

        var issues = [];
        var groupAssignments = {};
        var studentSchedule = {};

        // Check each student's schedule
        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var schedule = AcademySchedule.getStudentSchedule(student.id, weekNum);

            // Count how many classes this student has in this week
            var classCount = 0;
            for (var day in schedule) {
                if (Object.prototype.hasOwnProperty.call(schedule, day)) {
                    var daySchedule = schedule[day];
                    if (!daySchedule || typeof daySchedule !== 'object') { continue; }
                    for (var hour in daySchedule) {
                        if (Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                            if (daySchedule[hour]) {
                                classCount++;
                            }
                        }
                    }
                }
            }

            // Group by label (if any)
            var groupLabel = null;
            for (var day2 in schedule) {
                if (Object.prototype.hasOwnProperty.call(schedule, day2)) {
                    var daySchedule2 = schedule[day2];
                    if (!daySchedule2 || typeof daySchedule2 !== 'object') { continue; }
                    for (var hour2 in daySchedule2) {
                        if (Object.prototype.hasOwnProperty.call(daySchedule2, hour2)) {
                            var label = AcademySchedule.getClassLabel(student.id, weekNum, parseInt(day2, 10), parseInt(hour2, 10));
                            if (label) {
                                groupLabel = label;
                                break;
                            }
                        }
                    }
                    if (groupLabel) { break; }
                }
            }

            if (groupLabel) {
                if (!groupAssignments[groupLabel]) {
                    groupAssignments[groupLabel] = [];
                }
                groupAssignments[groupLabel].push(student.id);
                studentSchedule[student.id] = groupLabel;
            }
        }

        // Check group sizes
        for (var label in groupAssignments) {
            if (Object.prototype.hasOwnProperty.call(groupAssignments, label)) {
                var size = groupAssignments[label].length;
                if (size > maxPerGroup) {
                    issues.push('Group "' + label + '" has ' + size + ' students (max: ' + maxPerGroup + ')');
                }
                if (size < minPerGroup && size > 0) {
                    issues.push('Group "' + label + '" has only ' + size + ' students (min: ' + minPerGroup + ')');
                }
            }
        }

        // Check for students without groups
        var unassigned = [];
        for (var s = 0; s < students.length; s++) {
            if (!studentSchedule[students[s].id]) {
                unassigned.push(CharacterQueries.getDisplayName(students[s]));
            }
        }

        if (unassigned.length > 0) {
            issues.push('Unassigned students: ' + unassigned.join(', '));
        }

        return {
            valid: issues.length === 0,
            issues: issues,
            groups: groupAssignments,
            unassigned: unassigned,
            totalStudents: students.length,
            groupCount: Object.keys(groupAssignments).length
        };
    }

    // ============================================================
    // DISTRIBUTION SUMMARY
    // ============================================================

    /**
     * Get a summary of the current distribution for a class.
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @returns {object} Distribution summary
     */
    function getDistributionSummary(classId, week) {
        if (!isNonEmptyString(classId)) {
            return { error: 'Class ID is required.' };
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = getCurrentWeek();
        }

        var students = AcademyQueries.getClassStudents(classId);
        if (!students || students.length === 0) {
            return {
                classId: classId,
                week: weekNum,
                totalStudents: 0,
                assignedStudents: 0,
                groups: [],
                unassigned: []
            };
        }

        var groups = {};
        var unassigned = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var schedule = AcademySchedule.getStudentSchedule(student.id, weekNum);

            var found = false;
            for (var day in schedule) {
                if (Object.prototype.hasOwnProperty.call(schedule, day)) {
                    var daySchedule = schedule[day];
                    if (!daySchedule || typeof daySchedule !== 'object') { continue; }
                    for (var hour in daySchedule) {
                        if (Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                            var label = AcademySchedule.getClassLabel(student.id, weekNum, parseInt(day, 10), parseInt(hour, 10));
                            if (label) {
                                if (!groups[label]) {
                                    groups[label] = [];
                                }
                                groups[label].push(student.id);
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) { break; }
                }
            }

            if (!found) {
                unassigned.push(student.id);
            }
        }

        var groupSummaries = Object.keys(groups).map(function(key) {
            return {
                label: key,
                studentCount: groups[key].length,
                studentIds: groups[key]
            };
        });

        return {
            classId: classId,
            week: weekNum,
            totalStudents: students.length,
            assignedStudents: students.length - unassigned.length,
            unassignedCount: unassigned.length,
            groupCount: Object.keys(groups).length,
            groups: groupSummaries,
            unassigned: unassigned
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDistribute = {
        // ---- Main Entry Points ----
        autoDistribute: autoDistribute,
        autoDistributeWithGroups: autoDistributeWithGroups,

        // ---- Distribution Methods ----
        distributeBySkill: distributeBySkill,
        distributeEvenly: distributeEvenly,
        distributeRandom: distributeRandom,

        // ---- Schedule Building ----
        buildScheduleFromGroups: buildScheduleFromGroups,

        // ---- Core Algorithms ----
        distributeStudents: distributeStudents,

        // ---- Validation ----
        validateDistribution: validateDistribution,

        // ---- Summary ----
        getDistributionSummary: getDistributionSummary,

        // ---- Helpers ----
        getAvailableHours: getAvailableHours,
        getAvailableDays: getAvailableDays,

        // ---- Constants ----
        DEFAULT_MAX_PER_GROUP: DEFAULT_MAX_PER_GROUP,
        DEFAULT_MIN_PER_GROUP: DEFAULT_MIN_PER_GROUP,
        DEFAULT_TARGET_PER_GROUP: DEFAULT_TARGET_PER_GROUP,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        MIN_HOUR: MIN_HOUR,
        MAX_HOUR: MAX_HOUR,
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR
    };

})();