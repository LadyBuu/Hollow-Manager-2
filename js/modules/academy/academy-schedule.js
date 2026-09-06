/**
 * js/modules/academy/academy-schedule.js - Academy Schedule Domain
 * Single source of truth for Academy-specific schedule policy
 * Path: js/modules/academy/academy-schedule.js
 * 
 * This module handles:
 *   - Academy-specific schedule policy (weekly hour limits, rest days)
 *   - Schedule availability queries
 *   - Schedule summary queries
 *   - Student schedule CRUD (with Academy policy enforcement)
 *   - Rest day management
 * 
 * IMPORTANT:
 *   - This module owns Academy SCHEDULE POLICY, not schedule mechanics
 *   - Schedule storage mechanics are owned by CalendarCore
 *   - All mutations are candidate-based: validate, build candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 * 
 * DEPENDENCIES:
 *   - window.CalendarCore (from calendar/core/index.js)
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
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

    var CalendarCore = window.CalendarCore;
    var ObjectUtils = window.ObjectUtils;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CalendarCore || typeof CalendarCore.getStudentSchedule !== 'function') {
            missing.push('CalendarCore.getStudentSchedule');
        }
        if (!CalendarCore || typeof CalendarCore.setStudentScheduleClass !== 'function') {
            missing.push('CalendarCore.setStudentScheduleClass');
        }
        if (!CalendarCore || typeof CalendarCore.removeStudentScheduleClass !== 'function') {
            missing.push('CalendarCore.removeStudentScheduleClass');
        }
        if (!CalendarCore || typeof CalendarCore.duplicateStudentSchedule !== 'function') {
            missing.push('CalendarCore.duplicateStudentSchedule');
        }
        if (!CalendarCore || typeof CalendarCore.clearStudentSchedule !== 'function') {
            missing.push('CalendarCore.clearStudentSchedule');
        }
        if (!CalendarCore || typeof CalendarCore.getStudentRestDays !== 'function') {
            missing.push('CalendarCore.getStudentRestDays');
        }
        if (!CalendarCore || typeof CalendarCore.setStudentRestDays !== 'function') {
            missing.push('CalendarCore.setStudentRestDays');
        }
        if (!CalendarCore || typeof CalendarCore.getClassInstructor !== 'function') {
            missing.push('CalendarCore.getClassInstructor');
        }
        if (!CalendarCore || typeof CalendarCore.getClassDuration !== 'function') {
            missing.push('CalendarCore.getClassDuration');
        }
        if (!CalendarCore || typeof CalendarCore.getClassLabel !== 'function') {
            missing.push('CalendarCore.getClassLabel');
        }
        if (!CalendarCore || typeof CalendarCore.findClassStartHour !== 'function') {
            missing.push('CalendarCore.findClassStartHour');
        }
        if (!CalendarCore || typeof CalendarCore.hasStudentScheduleConflict !== 'function') {
            missing.push('CalendarCore.hasStudentScheduleConflict');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.isStudent !== 'function') {
            missing.push('CharacterQueries.isStudent');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }
        if (!DisciplineQueries || typeof DisciplineQueries.getAvailableDisciplines !== 'function') {
            missing.push('DisciplineQueries.getAvailableDisciplines');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseDay !== 'function') {
            missing.push('CalendarValidation.parseDay');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseHour !== 'function') {
            missing.push('CalendarValidation.parseHour');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseDuration !== 'function') {
            missing.push('CalendarValidation.parseDuration');
        }
        if (!CalendarValidation || typeof CalendarValidation.parseSlot !== 'function') {
            missing.push('CalendarValidation.parseSlot');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            throw new Error('AcademySchedule: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

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

    function validateStudentId(studentId) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return { valid: false, message: 'Student not found.' };
        }
        if (!CharacterQueries.isStudent(student)) {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateDisciplineId(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, discipline: discipline };
    }

    function validateRestDays(days) {
        if (!Array.isArray(days)) {
            return { valid: false, message: 'Rest days must be an array.' };
        }

        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = CalendarValidation.parseDay(days[i]);
            if (day === null) {
                return { valid: false, message: 'All rest days must be between ' + CalendarConstants.MIN_DAY + ' and ' + CalendarConstants.MAX_DAY + '.' };
            }
            if (seen[day]) {
                return { valid: false, message: 'Duplicate rest day: ' + day + '.' };
            }
            seen[day] = true;
            validDays.push(day);
        }

        validDays.sort(function(a, b) { return a - b; });

        return { valid: true, days: validDays };
    }

    // ============================================================
    // SCHEDULE QUERIES - Delegated to CalendarCore
    // ============================================================

    function getStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }
        return CalendarCore.getStudentSchedule(studentId, weekNum);
    }

    function getStudentScheduleClass(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }
        var schedule = CalendarCore.getStudentSchedule(studentId, weekNum);
        if (schedule[dayNum] && schedule[dayNum][hourNum]) {
            return schedule[dayNum][hourNum];
        }
        return null;
    }

    function getStudentRestDays(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }
        return CalendarCore.getStudentRestDays(studentId, weekNum);
    }

    function getClassInstructor(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }
        return CalendarCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
    }

    function getClassDuration(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }
        return CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
    }

    function getClassLabel(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }
        return CalendarCore.getClassLabel(studentId, weekNum, dayNum, hourNum);
    }

    function findClassStart(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }
        var schedule = getStudentSchedule(studentId, weekNum);
        return CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
    }

    // ============================================================
    // CLASS DETAILS - Enriched read model
    // ============================================================

    function getClassDetails(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return null;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        var instructorId = CalendarCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
        var instructor = instructorId ? CharacterQueries.getCharacterById(instructorId) : null;
        var duration = CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
        var label = CalendarCore.getClassLabel(studentId, weekNum, dayNum, hourNum) || '';
        var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);

        // If duration is missing, this is a malformed schedule entry
        if (duration === null || duration === undefined) {
            return null;
        }

        return {
            disciplineId: disciplineId,
            discipline: discipline,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: instructorId,
            instructor: instructor,
            instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Not assigned',
            duration: duration,
            label: label,
            startHour: startInfo ? startInfo.startHour : hourNum,
            endHour: startInfo ? startInfo.startHour + startInfo.duration : hourNum + duration,
            isClassStart: startInfo ? startInfo.startHour === hourNum : true
        };
    }

    function getDayClasses(studentId, week, day) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }
        var dayNum = CalendarValidation.parseDay(day);
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

        classes.sort(function(a, b) {
            return a.startHour - b.startHour;
        });

        return classes;
    }

    // ============================================================
    // CONFLICT DETECTION - Delegated to CalendarCore
    // ============================================================

    function hasConflict(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return true;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return true;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return true;
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return true;
        }
        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null) {
            durationNum = 1;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        return CalendarCore.hasStudentScheduleConflict(schedule, dayNum, hourNum, durationNum);
    }

    function getConflicts(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return [];
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return [];
        }
        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null) {
            durationNum = 1;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var conflicts = [];

        if (!schedule || !schedule[dayNum]) {
            return conflicts;
        }

        var maxHour = Math.min(hourNum + durationNum, CalendarConstants.MAX_HOUR + 1);
        for (var h = hourNum; h < maxHour; h++) {
            if (schedule[dayNum] && schedule[dayNum][h]) {
                var disciplineId = schedule[dayNum][h];
                var disc = DisciplineQueries.getDiscipline(disciplineId);
                conflicts.push({
                    hour: h,
                    disciplineId: disciplineId,
                    disciplineName: disc ? disc.name : 'Unknown'
                });
            }
        }

        return conflicts;
    }

    // ============================================================
    // AVAILABILITY CALCULATION - Academy-specific
    // ============================================================

    function getAvailableSlots(studentId, week, disciplineId) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);

        var maxHours = 1;
        var usedHours = 0;
        var remaining = CalendarConstants.MAX_CLASS_DURATION;

        if (isNonEmptyString(disciplineId)) {
            var discipline = DisciplineQueries.getDiscipline(disciplineId);
            if (discipline) {
                maxHours = parseFloat(discipline.weeklyHours) || 1;
                usedHours = getWeeklyHourUsage(studentId, weekNum, disciplineId);
                remaining = Math.max(0, maxHours - usedHours);
            }
        }

        var slots = [];

        for (var day = CalendarConstants.MIN_DAY; day <= CalendarConstants.MAX_DAY; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            for (var hour = CalendarConstants.CALENDAR_START_HOUR; hour <= CalendarConstants.CALENDAR_END_HOUR; hour++) {
                if (!schedule[day] || !schedule[day][hour]) {
                    var maxDurationForSlot = Math.min(remaining, CalendarConstants.MAX_CLASS_DURATION);
                    var contiguous = 0;
                    var endHour = Math.min(CalendarConstants.CALENDAR_END_HOUR, CalendarConstants.MAX_HOUR);
                    for (var h = hour; h <= endHour && contiguous < maxDurationForSlot; h++) {
                        if (!schedule[day] || !schedule[day][h]) {
                            contiguous++;
                        } else {
                            break;
                        }
                    }

                    if (contiguous > 0) {
                        slots.push({
                            day: day,
                            hour: hour,
                            maxDuration: Math.min(contiguous, maxDurationForSlot),
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var freeBlocks = [];

        for (var day = CalendarConstants.MIN_DAY; day <= CalendarConstants.MAX_DAY; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            var blockStart = null;
            var blockEnd = null;

            for (var hour = CalendarConstants.CALENDAR_START_HOUR; hour <= CalendarConstants.CALENDAR_END_HOUR; hour++) {
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
    // WEEKLY HOUR USAGE - Academy-specific
    // ============================================================

    function getWeeklyHourUsage(studentId, week, disciplineId) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(disciplineId)) {
            return 0;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return 0;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var total = 0;

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
                var discId = daySchedule[hour];
                if (discId && String(discId) === String(disciplineId)) {
                    var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        total += startInfo.duration;
                    }
                }
            }
        }

        return total;
    }

    function getDisciplineHourUsage(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var usage = {};

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
                if (disciplineId) {
                    var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        if (!usage[disciplineId]) {
                            usage[disciplineId] = 0;
                        }
                        usage[disciplineId] += startInfo.duration;
                    }
                }
            }
        }

        return usage;
    }

    function getRemainingWeeklyHours(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var usage = getDisciplineHourUsage(studentId, weekNum);
        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum);
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
    // SCHEDULE SUMMARY - Academy-specific
    // ============================================================

    function getStudentScheduleSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
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
            var dayNum = parseInt(day, 10);
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            if (!dayCounts[dayNum]) {
                dayCounts[dayNum] = 0;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                var disciplineId = daySchedule[hour];
                if (disciplineId) {
                    var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        totalHours += startInfo.duration;
                        dayCounts[dayNum] += startInfo.duration;

                        if (!disciplineCount[disciplineId]) {
                            var disc = DisciplineQueries.getDiscipline(disciplineId);
                            disciplineCount[disciplineId] = {
                                disciplineId: disciplineId,
                                disciplineName: disc ? disc.name : 'Unknown',
                                hours: 0,
                                maxHours: disc ? parseFloat(disc.weeklyHours) || 1 : 1
                            };
                        }
                        disciplineCount[disciplineId].hours += startInfo.duration;
                    }
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
        for (var d = CalendarConstants.MIN_DAY; d <= CalendarConstants.MAX_DAY; d++) {
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

    // ============================================================
    // SCHEDULE MUTATIONS - With Academy policy enforcement
    // ============================================================

    /**
     * Build a candidate for setting a class with Academy policy checks.
     * Validates: conflicts, rest days, weekly hour limits.
     */
    function buildSetClassCandidate(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = CalendarValidation.parseSlot(week, day, hour, duration);
        if (slotValidation === null) {
            return failure('Invalid slot: week, day, hour, or duration is invalid.');
        }

        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return failure(studentResult.message);
        }

        var discResult = validateDisciplineId(disciplineId);
        if (!discResult.valid) {
            return failure(discResult.message);
        }

        var weekNum = slotValidation.week;
        var dayNum = slotValidation.day;
        var hourNum = slotValidation.hour;
        var durationNum = slotValidation.duration;

        // ---- PHASE 2: CHECK CONFLICTS ----
        var conflicts = getConflicts(studentId, weekNum, dayNum, hourNum, durationNum);
        if (conflicts.length > 0) {
            var conflictNames = conflicts.map(function(c) { return c.disciplineName; });
            return failure('Schedule conflict: ' + conflictNames.join(', '));
        }

        // ---- PHASE 3: CHECK REST DAYS ----
        var restDays = getStudentRestDays(studentId, weekNum);
        if (restDays.indexOf(dayNum) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // ---- PHASE 4: CHECK WEEKLY HOUR LIMIT ----
        var usedHours = getWeeklyHourUsage(studentId, weekNum, discResult.discipline.id);
        var maxHours = parseFloat(discResult.discipline.weeklyHours) || 1;
        if (usedHours + durationNum > maxHours) {
            return failure('Would exceed weekly hour limit (' + maxHours + 'h) for ' + discResult.discipline.name);
        }

        var studentName = CharacterQueries.getDisplayName(studentResult.student);

        // ---- PHASE 5: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            // Delegate to CalendarCore for actual schedule mutation
            var result = CalendarCore.setStudentScheduleClass(
                studentId,
                weekNum,
                dayNum,
                hourNum,
                disciplineId,
                durationNum,
                instructorId
            );

            if (!result || !result.success) {
                throw new Error(result ? result.message : 'Failed to set class.');
            }

            return {
                studentId: studentId,
                studentName: studentName,
                discipline: discResult.discipline.name,
                week: weekNum,
                day: dayNum,
                hour: hourNum,
                duration: durationNum
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            discipline: discResult.discipline,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum
        });
    }

    /**
     * Build a candidate for removing a class.
     * Removes the entire class at the specified start hour.
     */
    function buildRemoveClassCandidate(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + CalendarConstants.MIN_DAY + '-' + CalendarConstants.MAX_DAY + ').');
        }
        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + CalendarConstants.MIN_HOUR + '-' + CalendarConstants.MAX_HOUR + ').');
        }

        // ---- PHASE 2: CHECK CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        // ---- PHASE 3: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            var result = CalendarCore.removeStudentScheduleClass(studentId, weekNum, dayNum, hourNum);
            if (!result || !result.success) {
                throw new Error(result ? result.message : 'Failed to remove class.');
            }
            return {
                studentId: studentId,
                studentName: studentName,
                week: weekNum,
                day: dayNum,
                hour: hourNum
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            week: weekNum,
            day: dayNum,
            hour: hourNum
        });
    }

    /**
     * Build a candidate for clearing a student's entire schedule for a week.
     */
    function buildClearScheduleCandidate(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        function mutate(data) {
            var result = CalendarCore.clearStudentSchedule(studentId, weekNum);
            if (!result || !result.success) {
                throw new Error(result ? result.message : 'Failed to clear schedule.');
            }
            return {
                studentId: studentId,
                studentName: studentName,
                week: weekNum
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            week: weekNum
        });
    }

    /**
     * Build a candidate for duplicating a schedule from one week to another.
     */
    function buildDuplicateScheduleCandidate(studentId, sourceWeek, targetWeek, overwrite) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var sourceWeekNum = CalendarValidation.parseWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return failure('Valid source week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }
        var targetWeekNum = CalendarValidation.parseWeek(targetWeek);
        if (targetWeekNum === null) {
            return failure('Valid target week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }
        if (sourceWeekNum === targetWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        overwrite = overwrite === true;

        // Check for conflicts in target week if not overwriting
        if (!overwrite) {
            var targetSchedule = getStudentSchedule(studentId, targetWeekNum);
            if (targetSchedule && Object.keys(targetSchedule).length > 0) {
                return failure('Target week already has classes. Use overwrite option to replace.');
            }
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        function mutate(data) {
            var result = CalendarCore.duplicateStudentSchedule(studentId, sourceWeekNum, targetWeekNum, overwrite);
            if (!result || !result.success) {
                throw new Error(result ? result.message : 'Failed to duplicate schedule.');
            }
            return {
                studentId: studentId,
                studentName: studentName,
                sourceWeek: sourceWeekNum,
                targetWeek: targetWeekNum
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            sourceWeek: sourceWeekNum,
            targetWeek: targetWeekNum
        });
    }

    /**
     * Build a candidate for setting rest days.
     */
    function buildSetRestDaysCandidate(studentId, week, days) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var restValidation = validateRestDays(days);
        if (!restValidation.valid) {
            return failure(restValidation.message);
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        function mutate(data) {
            var result = CalendarCore.setStudentRestDays(studentId, weekNum, restValidation.days);
            if (!result || !result.success) {
                throw new Error(result ? result.message : 'Failed to set rest days.');
            }
            return {
                studentId: studentId,
                studentName: studentName,
                week: weekNum,
                days: restValidation.days
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            week: weekNum,
            days: restValidation.days
        });
    }

    // ============================================================
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These perform the mutation and commit directly.
    // DEPRECATED: Use build*Candidate functions with MutationPipeline.
    // ============================================================

    function setClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        var candidate = buildSetClassCandidate(studentId, week, day, hour, disciplineId, duration, instructorId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success(result);
        } catch (e) {
            return failure(e.message || 'Failed to set class.');
        }
    }

    function removeClass(studentId, week, day, hour) {
        var candidate = buildRemoveClassCandidate(studentId, week, day, hour);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success(result);
        } catch (e) {
            return failure(e.message || 'Failed to remove class.');
        }
    }

    function clearSchedule(studentId, week) {
        var candidate = buildClearScheduleCandidate(studentId, week);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success(result);
        } catch (e) {
            return failure(e.message || 'Failed to clear schedule.');
        }
    }

    function duplicateSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        var candidate = buildDuplicateScheduleCandidate(studentId, sourceWeek, targetWeek, overwrite);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success(result);
        } catch (e) {
            return failure(e.message || 'Failed to duplicate schedule.');
        }
    }

    function setRestDays(studentId, week, days) {
        var candidate = buildSetRestDaysCandidate(studentId, week, days);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success(result);
        } catch (e) {
            return failure(e.message || 'Failed to set rest days.');
        }
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
        findClassStart: findClassStart,

        // Class details
        getClassDetails: getClassDetails,
        getDayClasses: getDayClasses,

        // Conflict detection
        hasConflict: hasConflict,
        getConflicts: getConflicts,

        // Availability
        getAvailableSlots: getAvailableSlots,
        getFreeTime: getFreeTime,

        // Weekly hour usage
        getWeeklyHourUsage: getWeeklyHourUsage,
        getDisciplineHourUsage: getDisciplineHourUsage,
        getRemainingWeeklyHours: getRemainingWeeklyHours,

        // Schedule summary
        getStudentScheduleSummary: getStudentScheduleSummary,

        // Candidate builders (preferred - use with MutationPipeline)
        buildSetClassCandidate: buildSetClassCandidate,
        buildRemoveClassCandidate: buildRemoveClassCandidate,
        buildClearScheduleCandidate: buildClearScheduleCandidate,
        buildDuplicateScheduleCandidate: buildDuplicateScheduleCandidate,
        buildSetRestDaysCandidate: buildSetRestDaysCandidate,

        // Legacy wrappers (deprecated - use with caution)
        setClass: setClass,
        removeClass: removeClass,
        clearSchedule: clearSchedule,
        duplicateSchedule: duplicateSchedule,
        setRestDays: setRestDays
    };

})();