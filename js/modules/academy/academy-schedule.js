/**
 * js/modules/academy/academy-schedule.js - Academy Schedule Operations
 * Centralized schedule management for the academy module
 * Path: js/modules/academy/academy-schedule.js
 * 
 * This module handles:
 *   - Student schedule CRUD (delegates to ScheduleCore)
 *   - Schedule conflict detection (duration-aware)
 *   - Rest day management
 *   - Schedule duplication with conflict resolution
 *   - Weekly hour limit enforcement
 *   - Class metadata resolution
 *   - Schedule integrity validation
 *   - Schedule display formatting
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
 *   - window.ScheduleCore (from curriculum-schedule.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 * 
 * USAGE:
 *   var schedule = window.AcademySchedule;
 *   var result = schedule.setClass(studentId, week, day, hour, disciplineId, duration);
 *   var conflicts = schedule.hasConflict(studentId, week, day, hour, duration);
 *   var summary = schedule.getStudentSummary(studentId, week);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyScheduleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ScheduleCore = window.ScheduleCore;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ScheduleCore || typeof ScheduleCore.getStudentSchedule !== 'function') {
            missing.push('ScheduleCore.getStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.setStudentScheduleClass !== 'function') {
            missing.push('ScheduleCore.setStudentScheduleClass');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeStudentScheduleClass !== 'function') {
            missing.push('ScheduleCore.removeStudentScheduleClass');
        }
        if (!ScheduleCore || typeof ScheduleCore.clearStudentSchedule !== 'function') {
            missing.push('ScheduleCore.clearStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.duplicateStudentSchedule !== 'function') {
            missing.push('ScheduleCore.duplicateStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.getStudentRestDays !== 'function') {
            missing.push('ScheduleCore.getStudentRestDays');
        }
        if (!ScheduleCore || typeof ScheduleCore.setStudentRestDays !== 'function') {
            missing.push('ScheduleCore.setStudentRestDays');
        }
        if (!ScheduleCore || typeof ScheduleCore.getClassInstructor !== 'function') {
            missing.push('ScheduleCore.getClassInstructor');
        }
        if (!ScheduleCore || typeof ScheduleCore.getClassDuration !== 'function') {
            missing.push('ScheduleCore.getClassDuration');
        }
        if (!ScheduleCore || typeof ScheduleCore.getClassLabel !== 'function') {
            missing.push('ScheduleCore.getClassLabel');
        }
        if (!ScheduleCore || typeof ScheduleCore.getClassGroupLabel !== 'function') {
            missing.push('ScheduleCore.getClassGroupLabel');
        }
        if (!ScheduleCore || typeof ScheduleCore.findClassStart !== 'function') {
            missing.push('ScheduleCore.findClassStart');
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
            console.warn('AcademySchedule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyScheduleLoaded = true;

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
    // SCHEDULE QUERIES
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

    function getStudentScheduleClass(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        return ScheduleCore.getStudentScheduleClass(studentId, weekNum, dayNum, hourNum);
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

    function getClassInstructor(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        return ScheduleCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
    }

    function getClassDuration(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        return ScheduleCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
    }

    function getClassLabel(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        return ScheduleCore.getClassLabel(studentId, weekNum, dayNum, hourNum);
    }

    function getClassGroupLabel(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        return ScheduleCore.getClassGroupLabel(studentId, weekNum, dayNum, hourNum);
    }

    function findClassStart(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }
        var schedule = getStudentSchedule(studentId, weekNum);
        return ScheduleCore.findClassStart(schedule, dayNum, hourNum);
    }

    // ============================================================
    // SCHEDULE CONFLICT DETECTION
    // ============================================================

    function hasScheduleConflict(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return true;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return true;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return true;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return true;
        }
        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            durationNum = 1;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        return ScheduleCore.hasScheduleConflict(schedule, dayNum, hourNum, durationNum);
    }

    function getConflicts(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return [];
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return [];
        }
        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            durationNum = 1;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var conflicts = [];

        if (!schedule || !schedule[dayNum]) {
            return conflicts;
        }

        for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
            if (schedule[dayNum] && schedule[dayNum][h]) {
                var disciplineId = schedule[dayNum][h];
                var disc = AcademyQueries.getDiscipline(disciplineId);
                conflicts.push({
                    hour: h,
                    disciplineId: disciplineId,
                    disciplineName: disc ? disc.name : 'Unknown'
                });
            }
        }

        return conflicts;
    }

    function getAvailableSlots(studentId, week, disciplineId) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var discipline = disciplineId ? AcademyQueries.getDiscipline(disciplineId) : null;

        var maxHours = discipline ? parseFloat(discipline.weeklyHours) || 1 : 1;
        var usedHours = disciplineId ? getWeeklyHourUsage(studentId, weekNum, disciplineId) : 0;
        var remaining = Math.max(0, maxHours - usedHours);

        var slots = [];

        for (var day = 1; day <= 7; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            for (var hour = 8; hour <= 18; hour++) {
                if (!schedule[day] || !schedule[day][hour]) {
                    var maxDuration = Math.min(remaining, 4);
                    if (maxDuration > 0) {
                        slots.push({
                            day: day,
                            hour: hour,
                            maxDuration: maxDuration,
                            available: true
                        });
                    }
                }
            }
        }

        return slots;
    }

    function getFreeTime(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var freeBlocks = [];

        for (var day = 1; day <= 7; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            var blockStart = null;
            var blockEnd = null;

            for (var hour = 8; hour <= 18; hour++) {
                var isOccupied = schedule[day] && schedule[day][hour];

                if (!isOccupied) {
                    if (blockStart === null) {
                        blockStart = hour;
                    }
                    blockEnd = hour;
                } else {
                    if (blockStart !== null) {
                        freeBlocks.push({
                            day: day,
                            startHour: blockStart,
                            endHour: blockEnd,
                            duration: blockEnd - blockStart + 1
                        });
                        blockStart = null;
                        blockEnd = null;
                    }
                }
            }

            if (blockStart !== null) {
                freeBlocks.push({
                    day: day,
                    startHour: blockStart,
                    endHour: blockEnd,
                    duration: blockEnd - blockStart + 1
                });
            }
        }

        return freeBlocks;
    }

    // ============================================================
    // WEEKLY HOUR USAGE
    // ============================================================

    function getWeeklyHourUsage(studentId, week, disciplineId) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(disciplineId)) {
            return 0;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return 0;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var total = 0;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var discId = daySchedule[hour];
                if (discId && String(discId) === String(disciplineId)) {
                    var duration = ScheduleCore.getClassDuration(studentId, weekNum, parseInt(day, 10), parseInt(hour, 10)) || 1;
                    total += duration;
                }
            }
        }

        return total;
    }

    function getDisciplineHourUsage(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var usage = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var disciplineId = daySchedule[hour];
                if (disciplineId) {
                    if (!usage[disciplineId]) {
                        usage[disciplineId] = 0;
                    }
                    var duration = ScheduleCore.getClassDuration(studentId, weekNum, parseInt(day, 10), parseInt(hour, 10)) || 1;
                    usage[disciplineId] += duration;
                }
            }
        }

        return usage;
    }

    function getRemainingWeeklyHours(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var usage = getDisciplineHourUsage(studentId, weekNum);
        var disciplines = AcademyQueries.getAvailableDisciplines(weekNum);
        var remaining = {};

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var used = usage[d.id] || 0;
            var max = parseFloat(d.weeklyHours) || 1;
            remaining[d.id] = {
                disciplineId: d.id,
                disciplineName: d.name,
                maxHours: max,
                usedHours: used,
                remainingHours: Math.max(0, max - used)
            };
        }

        return remaining;
    }

    // ============================================================
    // CLASS DETAILS
    // ============================================================

    function getClassDetails(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        var discipline = AcademyQueries.getDiscipline(disciplineId);
        var instructorId = ScheduleCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
        var instructor = instructorId ? AcademyQueries.getCharacterById(instructorId) : null;
        var duration = ScheduleCore.getClassDuration(studentId, weekNum, dayNum, hourNum) || 1;
        var label = ScheduleCore.getClassLabel(studentId, weekNum, dayNum, hourNum) || '';
        var groupLabel = ScheduleCore.getClassGroupLabel(studentId, weekNum, dayNum, hourNum) || '';
        var startInfo = ScheduleCore.findClassStart(schedule, dayNum, hourNum);

        return {
            disciplineId: disciplineId,
            discipline: discipline,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: instructorId,
            instructor: instructor,
            instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Not assigned',
            duration: duration,
            label: label,
            groupLabel: groupLabel,
            startHour: startInfo ? startInfo.startHour : hourNum,
            endHour: startInfo ? startInfo.startHour + startInfo.duration : hourNum + duration,
            isClassStart: startInfo ? startInfo.startHour === hourNum : true
        };
    }

    function getDayClasses(studentId, week, day) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum]) {
            return [];
        }

        var classes = [];
        var seenStartHours = {};

        for (var hour in schedule[dayNum]) {
            if (!Object.prototype.hasOwnProperty.call(schedule[dayNum], hour)) {
                continue;
            }
            var hourNum = parseInt(hour, 10);
            var details = getClassDetails(studentId, weekNum, dayNum, hourNum);
            if (details && details.isClassStart && !seenStartHours[hourNum]) {
                seenStartHours[hourNum] = true;
                classes.push(details);
            }
        }

        // Sort by hour
        classes.sort(function(a, b) {
            return a.startHour - b.startHour;
        });

        return classes;
    }

    // ============================================================
    // SCHEDULE SUMMARY
    // ============================================================

    function getStudentScheduleSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var usage = getDisciplineHourUsage(studentId, weekNum);

        var totalHours = 0;
        var disciplineCount = {};
        var dayCounts = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            var dayNum = parseInt(day, 10);
            if (!dayCounts[dayNum]) {
                dayCounts[dayNum] = 0;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var disciplineId = daySchedule[hour];
                if (disciplineId) {
                    var duration = ScheduleCore.getClassDuration(studentId, weekNum, dayNum, parseInt(hour, 10)) || 1;
                    totalHours += duration;
                    dayCounts[dayNum] += duration;

                    if (!disciplineCount[disciplineId]) {
                        var disc = AcademyQueries.getDiscipline(disciplineId);
                        disciplineCount[disciplineId] = {
                            disciplineId: disciplineId,
                            disciplineName: disc ? disc.name : 'Unknown',
                            hours: 0,
                            maxHours: disc ? parseFloat(disc.weeklyHours) || 1 : 1
                        };
                    }
                    disciplineCount[disciplineId].hours += duration;
                }
            }
        }

        var disciplineSummary = [];
        for (var key in disciplineCount) {
            if (!Object.prototype.hasOwnProperty.call(disciplineCount, key)) {
                continue;
            }
            var entry = disciplineCount[key];
            disciplineSummary.push(entry);
        }

        disciplineSummary.sort(function(a, b) {
            return a.disciplineName.localeCompare(b.disciplineName);
        });

        var daySummary = [];
        for (var d = 1; d <= 7; d++) {
            daySummary.push({
                day: d,
                hours: dayCounts[d] || 0,
                isRestDay: restDays.indexOf(d) !== -1
            });
        }

        return {
            studentId: studentId,
            week: weekNum,
            totalHours: totalHours,
            restDays: restDays,
            disciplineSummary: disciplineSummary,
            daySummary: daySummary,
            hasClasses: totalHours > 0
        };
    }

    function getClassScheduleForWeek(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var students = AcademyQueries.getStudents();
        var result = {};

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var schedule = getStudentSchedule(student.id, weekNum);
            if (schedule && Object.keys(schedule).length > 0) {
                result[student.id] = {
                    student: student,
                    schedule: schedule,
                    restDays: getStudentRestDays(student.id, weekNum)
                };
            }
        }

        return result;
    }

    // ============================================================
    // SCHEDULE INTEGRITY
    // ============================================================

    function validateScheduleIntegrity(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, issues: ['Student ID is required.'] };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, issues: ['Valid week is required (1-52).'] };
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var issues = [];
        var warnings = [];

        if (!schedule || Object.keys(schedule).length === 0) {
            return { valid: true, issues: [], warnings: ['No schedule for this week.'] };
        }

        // Check each class has correct duration metadata
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            var dayNum = parseInt(day, 10);
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }

                var duration = ScheduleCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
                if (duration === null || duration === undefined) {
                    // Check if this is a continuation or a class without metadata
                    var startInfo = ScheduleCore.findClassStart(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        issues.push({
                            type: 'missing_duration',
                            day: dayNum,
                            hour: hourNum,
                            disciplineId: disciplineId,
                            message: 'Class at ' + getDayName(dayNum) + ' ' + hourNum + ':00 has no duration metadata.'
                        });
                    }
                }
            }
        }

        // Check for overlapping classes
        var classStarts = [];
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseInt(day, 10);
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }

                var startInfo = ScheduleCore.findClassStart(schedule, dayNum, hourNum);
                if (startInfo && startInfo.startHour === hourNum) {
                    classStarts.push({
                        day: dayNum,
                        hour: hourNum,
                        duration: startInfo.duration,
                        disciplineId: disciplineId
                    });
                }
            }
        }

        for (var i = 0; i < classStarts.length; i++) {
            for (var j = i + 1; j < classStarts.length; j++) {
                var a = classStarts[i];
                var b = classStarts[j];
                if (a.day !== b.day) {
                    continue;
                }

                var aStart = a.hour;
                var aEnd = a.hour + a.duration;
                var bStart = b.hour;
                var bEnd = b.hour + b.duration;

                if (aStart < bEnd && bStart < aEnd) {
                    issues.push({
                        type: 'overlap',
                        day: a.day,
                        classA: a,
                        classB: b,
                        message: 'Overlapping classes on ' + getDayName(a.day) + ': ' +
                            a.hour + ':00-' + aEnd + ':00 and ' +
                            b.hour + ':00-' + bEnd + ':00'
                    });
                }
            }
        }

        return {
            valid: issues.length === 0,
            issues: issues,
            warnings: warnings,
            classCount: classStarts.length
        };
    }

    function repairScheduleContinuity(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var changes = [];

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            var dayNum = parseInt(day, 10);

            // Find class starts that have gaps
            var processedHours = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                if (processedHours[hourNum]) {
                    continue;
                }

                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }

                var startInfo = ScheduleCore.findClassStart(schedule, dayNum, hourNum);
                if (!startInfo || startInfo.startHour !== hourNum) {
                    continue;
                }

                var duration = ScheduleCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
                if (duration === null || duration === undefined) {
                    // Try to infer duration from occupied hours
                    var inferredDuration = 1;
                    for (var h = hourNum + 1; h <= 23; h++) {
                        if (String(schedule[dayNum][h]) === String(disciplineId)) {
                            inferredDuration++;
                        } else {
                            break;
                        }
                    }
                    if (inferredDuration > 1) {
                        changes.push({
                            day: dayNum,
                            hour: hourNum,
                            disciplineId: disciplineId,
                            oldDuration: 'unknown',
                            newDuration: inferredDuration,
                            action: 'inferred_duration'
                        });
                        // Mark all hours in this class as processed
                        for (var h = hourNum; h < hourNum + inferredDuration; h++) {
                            processedHours[h] = true;
                        }
                        // Continue to next class
                        continue;
                    }
                }

                // Mark all hours in this class as processed
                var actualDuration = 1;
                for (var h = hourNum + 1; h <= 23; h++) {
                    if (String(schedule[dayNum][h]) === String(disciplineId)) {
                        actualDuration++;
                    } else {
                        break;
                    }
                }
                for (var h = hourNum; h < hourNum + actualDuration; h++) {
                    processedHours[h] = true;
                }

                // Check for gaps (hours with no class in the middle)
                var hasGap = false;
                for (var h = hourNum; h < hourNum + actualDuration; h++) {
                    if (!schedule[dayNum][h]) {
                        hasGap = true;
                        break;
                    }
                }

                if (hasGap) {
                    // Fill gaps
                    for (var h = hourNum; h < hourNum + actualDuration; h++) {
                        if (!schedule[dayNum][h]) {
                            schedule[dayNum][h] = disciplineId;
                            changes.push({
                                day: dayNum,
                                hour: h,
                                disciplineId: disciplineId,
                                action: 'filled_gap'
                            });
                        }
                    }
                }
            }
        }

        if (changes.length > 0) {
            // Apply changes
            var result = ScheduleCore.clearStudentSchedule(studentId, weekNum);
            if (!result || !result.success) {
                return { success: false, message: 'Failed to repair schedule.' };
            }

            // Rebuild schedule with changes
            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                    continue;
                }
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }
                var dayNum = parseInt(day, 10);

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var hourNum = parseInt(hour, 10);
                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) {
                        continue;
                    }

                    // Check if this is a start
                    var startInfo = ScheduleCore.findClassStart(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        var duration = ScheduleCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
                        if (duration === null || duration === undefined) {
                            duration = 1;
                        }
                        ScheduleCore.setStudentScheduleClass(studentId, weekNum, dayNum, hourNum, disciplineId, duration);
                    }
                }
            }
        }

        return {
            success: true,
            repaired: changes.length > 0,
            changes: changes
        };
    }

    // ============================================================
    // SCHEDULE DISPLAY FORMATTING
    // ============================================================

    function getDayName(day) {
        var names = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var num = parseInt(day, 10);
        return (num >= 1 && num <= 7) ? names[num] : 'Unknown';
    }

    function getShortDayName(day) {
        var names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var num = parseInt(day, 10);
        return (num >= 1 && num <= 7) ? names[num] : 'Unknown';
    }

    function formatScheduleGrid(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var grid = [];

        for (var day = 1; day <= 7; day++) {
            grid[day] = {};
            for (var hour = 8; hour <= 18; hour++) {
                var classId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                var isRestDay = restDays.indexOf(day) !== -1;
                var duration = classId ? ScheduleCore.getClassDuration(studentId, weekNum, day, hour) || 1 : 0;

                grid[day][hour] = {
                    occupied: !!classId,
                    disciplineId: classId,
                    isRestDay: isRestDay,
                    duration: duration,
                    isClassStart: classId ? (ScheduleCore.findClassStart(schedule, day, hour) || {}).startHour === hour : false
                };
            }
        }

        return grid;
    }

    function renderScheduleTable(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return '';
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return '';
        }

        var grid = formatScheduleGrid(studentId, weekNum);
        if (!grid) {
            return '';
        }

        var html = '<table class="schedule-table">';
        html += '<thead><tr><th>Time</th>';

        for (var d = 1; d <= 7; d++) {
            html += '<th>' + escapeHtml(getShortDayName(d)) + '</th>';
        }
        html += '</tr></thead><tbody>';

        for (var hour = 8; hour <= 18; hour++) {
            html += '<tr><td class="schedule-time">' + hour + ':00</td>';
            for (var day = 1; day <= 7; day++) {
                var cell = grid[day][hour];
                var display = '·';
                var className = 'schedule-empty';

                if (cell.isRestDay) {
                    display = '--';
                    className = 'schedule-rest';
                } else if (cell.occupied) {
                    var disc = AcademyQueries.getDiscipline(cell.disciplineId);
                    display = disc ? disc.name : 'Unknown';
                    className = 'schedule-class';
                    if (cell.isClassStart) {
                        className += ' class-start';
                    }
                    if (cell.duration > 1) {
                        display += ' (' + cell.duration + 'h)';
                    }
                }

                html += '<td class="' + className + '" data-day="' + day + '" data-hour="' + hour + '">';
                html += escapeHtml(display);
                html += '</td>';
            }
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    }

    function formatScheduleAsText(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return '';
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return '';
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var lines = [];

        for (var day = 1; day <= 7; day++) {
            var dayName = getShortDayName(day);
            var isRestDay = restDays.indexOf(day) !== -1;

            if (isRestDay) {
                lines.push(dayName + ': [REST DAY]');
                continue;
            }

            var classes = [];
            for (var hour = 8; hour <= 18; hour++) {
                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                if (disciplineId) {
                    var startInfo = ScheduleCore.findClassStart(schedule, day, hour);
                    if (startInfo && startInfo.startHour === hour) {
                        var disc = AcademyQueries.getDiscipline(disciplineId);
                        var name = disc ? disc.name : 'Unknown';
                        classes.push(hour + ':00-' + (hour + startInfo.duration) + ':00 ' + name);
                    }
                }
            }

            if (classes.length === 0) {
                lines.push(dayName + ': Free');
            } else {
                lines.push(dayName + ':');
                for (var i = 0; i < classes.length; i++) {
                    lines.push('  ' + classes[i]);
                }
            }
        }

        return lines.join('\n');
    }

    // ============================================================
    // SCHEDULE MUTATIONS
    // ============================================================

    function setClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
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
        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            durationNum = 1;
        }

        // Check for conflicts
        var conflicts = getConflicts(studentId, weekNum, dayNum, hourNum, durationNum);
        if (conflicts.length > 0) {
            var conflictNames = conflicts.map(function(c) { return c.disciplineName; });
            return {
                success: false,
                message: 'Schedule conflict: ' + conflictNames.join(', '),
                conflicts: conflicts
            };
        }

        // Check rest days
        var restDays = getStudentRestDays(studentId, weekNum);
        if (restDays.indexOf(dayNum) !== -1) {
            return { success: false, message: 'This is a rest day for this student.' };
        }

        // Check weekly hour limit
        var usedHours = getWeeklyHourUsage(studentId, weekNum, disciplineId);
        var maxHours = parseFloat(discipline.weeklyHours) || 1;
        if (usedHours + durationNum > maxHours) {
            return {
                success: false,
                message: 'Would exceed weekly hour limit (' + maxHours + 'h) for ' + discipline.name
            };
        }

        var result = ScheduleCore.setStudentScheduleClass(studentId, weekNum, dayNum, hourNum, disciplineId, durationNum, instructorId);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to set class.' };
        }

        return result;
    }

    function removeClass(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
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

        var result = ScheduleCore.removeStudentScheduleClass(studentId, weekNum, dayNum, hourNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to remove class.' };
        }

        return result;
    }

    function clearSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var result = ScheduleCore.clearStudentSchedule(studentId, weekNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to clear schedule.' };
        }

        return result;
    }

    function duplicateSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return { success: false, message: 'Valid source week is required (1-52).' };
        }
        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return { success: false, message: 'Valid target week is required (1-52).' };
        }
        if (sourceWeekNum === targetWeekNum) {
            return { success: false, message: 'Source and target weeks must be different.' };
        }

        // Check for conflicts in target week if not overwriting
        if (!overwrite) {
            var targetSchedule = getStudentSchedule(studentId, targetWeekNum);
            if (targetSchedule && Object.keys(targetSchedule).length > 0) {
                return {
                    success: false,
                    message: 'Target week already has classes. Use overwrite option to replace.'
                };
            }
        }

        var result = ScheduleCore.duplicateStudentSchedule(studentId, sourceWeekNum, targetWeekNum, overwrite);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to duplicate schedule.' };
        }

        return result;
    }

    function setRestDays(studentId, week, days) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }
        if (!Array.isArray(days)) {
            return { success: false, message: 'Rest days must be an array.' };
        }

        var validDays = days.filter(function(d) {
            return validateDay(d) !== null;
        });

        var result = ScheduleCore.setStudentRestDays(studentId, weekNum, validDays);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to set rest days.' };
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySchedule = {
        // Queries
        getStudentSchedule: getStudentSchedule,
        getStudentScheduleClass: getStudentScheduleClass,
        getStudentRestDays: getStudentRestDays,
        getClassInstructor: getClassInstructor,
        getClassDuration: getClassDuration,
        getClassLabel: getClassLabel,
        getClassGroupLabel: getClassGroupLabel,
        findClassStart: findClassStart,

        // Conflict detection
        hasScheduleConflict: hasScheduleConflict,
        getConflicts: getConflicts,
        getAvailableSlots: getAvailableSlots,
        getFreeTime: getFreeTime,

        // Weekly hour usage
        getWeeklyHourUsage: getWeeklyHourUsage,
        getDisciplineHourUsage: getDisciplineHourUsage,
        getRemainingWeeklyHours: getRemainingWeeklyHours,

        // Class details
        getClassDetails: getClassDetails,
        getDayClasses: getDayClasses,

        // Schedule summary
        getStudentScheduleSummary: getStudentScheduleSummary,
        getClassScheduleForWeek: getClassScheduleForWeek,

        // Schedule integrity
        validateScheduleIntegrity: validateScheduleIntegrity,
        repairScheduleContinuity: repairScheduleContinuity,

        // Display formatting
        getDayName: getDayName,
        getShortDayName: getShortDayName,
        formatScheduleGrid: formatScheduleGrid,
        renderScheduleTable: renderScheduleTable,
        formatScheduleAsText: formatScheduleAsText,

        // Mutations
        setClass: setClass,
        removeClass: removeClass,
        clearSchedule: clearSchedule,
        duplicateSchedule: duplicateSchedule,
        setRestDays: setRestDays,

        // Validation
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration
    };

})();