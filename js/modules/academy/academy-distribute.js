/**
 * modules/academy/academy-distribute.js - Academy Distribute
 * Auto-distribution engine for assigning students to classes and schedules
 *
 * Path: js/modules/academy/academy-distribute.js
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
 *   - Uses CalendarProvider for schedule conflicts (via AcademySchedule)
 *   - No direct CalendarCore or ScheduleCore dependency
 *   - Distribution algorithm is PURE and testable
 *   - This module does NOT call saveData() — the pipeline owns persistence
 *
 * WRITE vs READ CONTRACT (v2 — Session D4):
 *   - WRITE-producing operations return Promises:
 *       autoDistribute
 *       autoDistributeWithGroups
 *       distributeBySkill
 *       distributeEvenly
 *       distributeRandom
 *       buildScheduleFromGroups
 *   - READ-ONLY / PURE operations remain synchronous:
 *       distributeStudents      (pure algorithm)
 *       validateDistribution    (reads only)
 *       getDistributionSummary  (reads only)
 *       getAvailableHours       (pure)
 *       getAvailableDays        (pure)
 *
 *   Callers MUST await the write-producing functions or chain
 *   `.then()` on them. Do not test `if (result.success)` on the
 *   returned value — that value is a Promise.
 *
 *   The old shape was:
 *       var result = autoDistribute(classId, week, opts);
 *       if (result.success) { ... }
 *
 *   The new shape is:
 *       autoDistribute(classId, week, opts).then(function(result) {
 *           if (result.success) { ... }
 *       });
 *
 * SEQUENCING GUARANTEE:
 *   - Writes to a single student's schedule are serialised by
 *     MutationPipeline. Sibling writes for different students are
 *     also serialised because MutationPipeline has a single queue.
 *   - buildScheduleFromGroups resolves group slots sequentially,
 *     so the "find the first free slot for this group" search sees
 *     the effects of the previous group's writes. Running groups in
 *     parallel would cause slot collisions.
 *   - No cross-group transaction. If group 3 fails, groups 1 and 2
 *     remain written. This matches the previous behaviour. If you
 *     need all-or-nothing, you need a bulk operation on ScheduleCore,
 *     not a fan-out loop here.
 *
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js) — MANDATORY
 *   - window.AcademySchedule (from academy-schedule.js) — MANDATORY
 *   - window.AcademyConstants (from academy-constants.js) — MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) — MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) — MANDATORY
 *   - window.CharacterQueries (from character-queries.js) — MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) — MANDATORY
 *   - window.TeamQueries (from team-queries.js) — MANDATORY
 *   - window.CalendarQueries (from calendar-queries.js) — MANDATORY
 *   - window.ObjectUtils (from object-utils.js) — MANDATORY
 */

(function() {
    'use strict';

    if (window.__academyDistributeLoaded) {
        return;
    }
    window.__academyDistributeLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
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
    // DISTRIBUTION ALGORITHM — PURE
    // ============================================================

    /**
     * Distribute students into groups.
     * PURE — no side effects, no mutations, no Promise.
     *
     * @param {array} students - Array of student objects
     * @param {number} numGroups - Number of groups to create
     * @param {object} options - Distribution options
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

        var idealGroups = Math.ceil(students.length / targetPerGroup);
        var actualGroups = Math.max(1, Math.min(numGroups, Math.ceil(students.length / minPerGroup)));

        if (actualGroups < 1) {
            actualGroups = 1;
        }

        var groups = [];
        for (var i = 0; i < actualGroups; i++) {
            groups.push({
                id: 'group_' + (i + 1),
                students: [],
                count: 0
            });
        }

        var shuffledStudents = shuffleArray(students);

        if (method === 'balanced') {
            for (var j = 0; j < shuffledStudents.length; j++) {
                var groupIndex = j % actualGroups;
                if (groups[groupIndex].count < maxPerGroup) {
                    groups[groupIndex].students.push(shuffledStudents[j]);
                    groups[groupIndex].count++;
                } else {
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
    // AUTO-DISTRIBUTE — MAIN ENTRY POINT (Promise-based)
    // ============================================================

    /**
     * Auto-distribute students in a class for a given week.
     *
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @param {object} options - Distribution options
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function autoDistribute(classId, week, options) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        options = options || {};

        // ---- PHASE 2: GET STUDENTS (sync read) ----
        var students = AcademyQueries.getClassStudents(classId);
        if (!students || students.length === 0) {
            return Promise.resolve(failure('No students found in this class.'));
        }

        var classRecord = AcademyQueries.getClass(classId);
        if (!classRecord) {
            return Promise.resolve(failure('Class not found.'));
        }

        // ---- PHASE 3: CLEAR EXISTING SCHEDULES (async, sequential) ----
        // Clearing all students' schedules before redistribution is a
        // batched write. Each clear goes through AcademySchedule (and
        // therefore the pipeline). We run them sequentially so the
        // pipeline queue is not spammed with overlapping transactions
        // on different students in the same tick.
        var preClearChain = Promise.resolve();
        if (options.clearExisting) {
            preClearChain = students.reduce(function(chain, student) {
                return chain.then(function() {
                    return AcademySchedule.clearStudentSchedule(student.id, weekNum);
                });
            }, Promise.resolve());
        }

        return preClearChain.then(function() {
            // ---- PHASE 4: DETERMINE DISTRIBUTION SETTINGS ----
            var numGroups = options.numGroups || Math.ceil(students.length / DEFAULT_TARGET_PER_GROUP);
            var maxPerGroup = options.maxPerGroup || DEFAULT_MAX_PER_GROUP;
            var minPerGroup = options.minPerGroup || DEFAULT_MIN_PER_GROUP;
            var targetPerGroup = options.targetPerGroup || DEFAULT_TARGET_PER_GROUP;

            // ---- PHASE 5: DISTRIBUTE STUDENTS (pure) ----
            var groups = distributeStudents(students, numGroups, {
                method: options.method || 'balanced',
                maxPerGroup: maxPerGroup,
                minPerGroup: minPerGroup,
                targetPerGroup: targetPerGroup,
                getSkill: options.getSkill
            });

            // ---- PHASE 6: BUILD SCHEDULE FROM GROUPS (async) ----
            var availableHours = options.availableHours || getAvailableHours();
            var availableDays = options.availableDays || getAvailableDays();
            var disciplineId = options.disciplineId || null;
            var instructorId = options.instructorId || null;
            var duration = options.duration || 1;
            var teamIds = options.teamIds || null;

            return buildScheduleFromGroups(
                groups,
                weekNum,
                availableDays,
                availableHours,
                disciplineId,
                instructorId,
                duration,
                options,
                teamIds
            ).then(function(scheduleResult) {
                if (!scheduleResult || !scheduleResult.success) {
                    return failure(
                        scheduleResult && scheduleResult.message
                            ? scheduleResult.message
                            : 'Failed to build schedule.'
                    );
                }

                return success({
                    classId: classId,
                    week: weekNum,
                    groups: groups,
                    schedule: scheduleResult.data,
                    totalStudents: students.length,
                    groupCount: groups.length
                });
            });
        });
    }

    /**
     * Auto-distribute with an explicit group count.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {number} numGroups
     * @param {object} options
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function autoDistributeWithGroups(classId, week, numGroups, options) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        if (!isNumber(numGroups) || numGroups < 1) {
            return Promise.resolve(failure('Number of groups must be at least 1.'));
        }

        options = options || {};
        options.numGroups = numGroups;

        return autoDistribute(classId, week, options);
    }

    // ============================================================
    // SCHEDULE BUILDING (Promise-based, sequential per group)
    // ============================================================

    /**
     * Build a schedule from student groups.
     *
     * SEQUENCING:
     *   Groups are processed one at a time. For each group we:
     *     1. Search for a slot where every student in the group is free.
     *     2. Write each student's slot.
     *   The slot search for group N+1 must see the writes from group N,
     *   otherwise two groups could be assigned to the same slot. We
     *   therefore chain group processing with `.then()` rather than
     *   running them in parallel.
     *
     * @param {array} groups
     * @param {number|string} week
     * @param {array} availableDays
     * @param {array} availableHours
     * @param {string} disciplineId
     * @param {string} instructorId
     * @param {number} duration
     * @param {object} options
     * @param {array} teamIds
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function buildScheduleFromGroups(groups, week, availableDays, availableHours, disciplineId, instructorId, duration, options, teamIds) {
        // ---- PHASE 1: VALIDATE ----
        if (!Array.isArray(groups) || groups.length === 0) {
            return Promise.resolve(failure('At least one group is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        if (!Array.isArray(availableDays) || availableDays.length === 0) {
            availableDays = getAvailableDays();
        }

        if (!Array.isArray(availableHours) || availableHours.length === 0) {
            availableHours = getAvailableHours();
        }

        duration = parseDuration(duration) || 1;

        options = options || {};

        // ---- PHASE 2: SHUFFLED SEARCH ORDER ----
        // Randomised once per call. Groups are processed sequentially,
        // so the randomness is per-call, not per-group.
        var days = shuffleArray(availableDays);
        var hours = shuffleArray(availableHours);

        // ---- PHASE 3: RESULT ACCUMULATORS ----
        var scheduledGroups = [];
        var scheduledStudents = {};
        var errors = [];

        // ---- PHASE 4: SEQUENTIAL GROUP PROCESSING ----
        var chain = Promise.resolve();

        groups.forEach(function(group, g) {
            chain = chain.then(function() {
                var groupId = group.id || 'group_' + (g + 1);
                var students = group.students || [];

                if (students.length === 0) {
                    scheduledGroups.push({
                        groupId: groupId,
                        students: [],
                        scheduled: false,
                        reason: 'No students in group'
                    });
                    return;
                }

                // ---- SLOT SEARCH ----
                // For each candidate (day, hour), check whether every
                // student in the group is free. The check goes through
                // AcademySchedule.hasStudentScheduleConflict, which is
                // a synchronous read against the live store. Because
                // we are chained after the previous group's writes,
                // we see their effects.
                var slotFound = false;
                var assignedDay = null;
                var assignedHour = null;

                for (var d = 0; d < days.length && !slotFound; d++) {
                    var day = days[d];
                    for (var h = 0; h < hours.length && !slotFound; h++) {
                        var hour = hours[h];

                        var slotAvailable = true;
                        for (var s = 0; s < students.length; s++) {
                            var student = students[s];
                            if (!student || !student.id) { continue; }

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
                    return;
                }

                // ---- LABEL AND METADATA ----
                var label = options.getGroupLabel
                    ? options.getGroupLabel(groupId, g, groups.length)
                    : (options.labelPrefix || 'Group ') + (g + 1);

                var metadata = {
                    groupLabel: label,
                    instructorId: instructorId || null
                };

                // ---- WRITE EACH STUDENT'S SLOT ----
                // Sequential per student, so that if one write fails
                // the error is attributed to the correct student and
                // the remaining students in the group still get their
                // slot (rather than aborting mid-group).
                var assignedStudents = [];
                var assignErrors = [];
                var studentChain = Promise.resolve();

                students.forEach(function(student) {
                    if (!student || !student.id) {
                        return;
                    }

                    studentChain = studentChain.then(function() {
                        return AcademySchedule.setStudentScheduleClass(
                            student.id,
                            weekNum,
                            assignedDay,
                            assignedHour,
                            disciplineId,
                            duration,
                            metadata
                        ).then(function(result) {
                            if (result && result.success) {
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
                                    error: result && result.message ? result.message : 'Unknown error.'
                                });
                            }
                        });
                    });
                });

                return studentChain.then(function() {
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
                });
            });
        });

        // ---- PHASE 5: RESOLVE WITH SUMMARY ----
        return chain.then(function() {
            return success({
                scheduledGroups: scheduledGroups,
                scheduledStudents: scheduledStudents,
                totalGroups: groups.length,
                scheduledCount: scheduledGroups.filter(function(g) { return g.scheduled; }).length,
                errors: errors
            });
        });
    }

    // ============================================================
    // ADVANCED DISTRIBUTION (Promise-based)
    // ============================================================

    /**
     * Distribute by skill level.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} options
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function distributeBySkill(classId, week, options) {
        options = options || {};
        options.method = 'skill';
        return autoDistribute(classId, week, options);
    }

    /**
     * Distribute evenly (balanced).
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} options
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function distributeEvenly(classId, week, options) {
        options = options || {};
        options.method = 'balanced';
        return autoDistribute(classId, week, options);
    }

    /**
     * Distribute randomly.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} options
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function distributeRandom(classId, week, options) {
        options = options || {};
        options.method = 'random';
        return autoDistribute(classId, week, options);
    }

    // ============================================================
    // VALIDATION (synchronous, read-only)
    // ============================================================

    /**
     * Check if a distribution is valid.
     * READ-ONLY. Does not mutate state.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} options
     * @returns {object} { valid: boolean, issues: array, ... }
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

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var schedule = AcademySchedule.getStudentSchedule(student.id, weekNum);

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

            var groupLabel = null;
            for (var day2 in schedule) {
                if (Object.prototype.hasOwnProperty.call(schedule, day2)) {
                    var daySchedule2 = schedule[day2];
                    if (!daySchedule2 || typeof daySchedule2 !== 'object') { continue; }
                    for (var hour2 in daySchedule2) {
                        if (Object.prototype.hasOwnProperty.call(daySchedule2, hour2)) {
                            var label = AcademySchedule.getClassLabel(
                                student.id, weekNum, parseInt(day2, 10), parseInt(hour2, 10)
                            );
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
    // DISTRIBUTION SUMMARY (synchronous, read-only)
    // ============================================================

    /**
     * Get a summary of the current distribution for a class.
     * READ-ONLY.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object}
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
                            var label = AcademySchedule.getClassLabel(
                                student.id, weekNum, parseInt(day, 10), parseInt(hour, 10)
                            );
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
        // ---- Main Entry Points (Promise-based) ----
        autoDistribute: autoDistribute,
        autoDistributeWithGroups: autoDistributeWithGroups,

        // ---- Distribution Methods (Promise-based) ----
        distributeBySkill: distributeBySkill,
        distributeEvenly: distributeEvenly,
        distributeRandom: distributeRandom,

        // ---- Schedule Building (Promise-based) ----
        buildScheduleFromGroups: buildScheduleFromGroups,

        // ---- Core Algorithms (pure, synchronous) ----
        distributeStudents: distributeStudents,

        // ---- Validation (synchronous, read-only) ----
        validateDistribution: validateDistribution,

        // ---- Summary (synchronous, read-only) ----
        getDistributionSummary: getDistributionSummary,

        // ---- Helpers (pure, synchronous) ----
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