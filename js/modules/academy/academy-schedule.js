/**
 * js/modules/academy/academy-schedule.js - Academy Schedule Domain
 * Single source of truth for all schedule operations within the Academy
 * Path: js/modules/academy/academy-schedule.js
 * 
 * This module handles:
 *   - Student schedule CRUD operations (delegates to CalendarCore)
 *   - Rest day management (delegates to CalendarCore)
 *   - Schedule duplication (delegates to CalendarCore)
 *   - Conflict detection (duration-aware)
 *   - Availability calculation
 *   - Schedule integrity validation
 *   - Weekly hour limit enforcement
 *   - Class metadata resolution
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for Academy schedules
 *   - Delegates to CalendarCore for actual CRUD operations
 *   - Adds Academy-specific business logic (weekly hour limits, availability)
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - This module does NOT call saveData() - callers own persistence
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 *   - Bulk operations are ATOMIC: all or nothing
 * 
 * DEPENDENCIES:
 *   - window.CalendarCore (from calendar/core/index.js)
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.ActivityLog (from activity-log.js)
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
    var AcademyQueries = window.AcademyQueries;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var ActivityLog = window.ActivityLog;

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

        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
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

    function validateDay(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_DAY || num > MAX_DAY) {
            return null;
        }
        return num;
    }

    function validateHour(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_HOUR || num > MAX_HOUR) {
            return null;
        }
        return num;
    }

    function validateDuration(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1 || num > 4) {
            return null;
        }
        return num;
    }

    function validateStudentId(studentId) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return { valid: false, message: 'Student not found.' };
        }
        return { valid: true, student: student };
    }

    function validateDisciplineId(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, discipline: discipline };
    }

    function validateClassInput(studentId, week, day, hour, disciplineId, duration) {
        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return studentResult;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { valid: false, message: 'Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { valid: false, message: 'Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').' };
        }

        var discResult = validateDisciplineId(disciplineId);
        if (!discResult.valid) {
            return discResult;
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { valid: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hourNum + durationNum > 24) {
            return { valid: false, message: 'Class duration extends beyond the end of the day.' };
        }

        return {
            valid: true,
            studentId: studentId,
            student: studentResult.student,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            discipline: discResult.discipline,
            duration: durationNum
        };
    }

    function validateRestDays(days) {
        if (!Array.isArray(days)) {
            return { valid: false, message: 'Rest days must be an array.' };
        }

        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = validateDay(days[i]);
            if (day === null) {
                return { valid: false, message: 'All rest days must be between ' + MIN_DAY + ' and ' + MAX_DAY + '.' };
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
        return CalendarCore.getStudentSchedule(studentId, weekNum);
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
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        return CalendarCore.getStudentRestDays(studentId, weekNum);
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
        return CalendarCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
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
        return CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
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
        return CalendarCore.getClassLabel(studentId, weekNum, dayNum, hourNum);
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
        return CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
    }

    // ============================================================
    // CLASS DETAILS - Enriched metadata
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
        var instructorId = CalendarCore.getClassInstructor(studentId, weekNum, dayNum, hourNum);
        var instructor = instructorId ? CharacterQueries.getCharacterById(instructorId) : null;
        var duration = CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum) || 1;
        var label = CalendarCore.getClassLabel(studentId, weekNum, dayNum, hourNum) || '';
        var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);

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

        classes.sort(function(a, b) {
            return a.startHour - b.startHour;
        });

        return classes;
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    function hasConflict(studentId, week, day, hour, duration) {
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
        return CalendarCore.hasStudentScheduleConflict(schedule, dayNum, hourNum, durationNum);
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

    // ============================================================
    // AVAILABILITY CALCULATION
    // ============================================================

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

        var maxHours = 1;
        var usedHours = 0;
        var remaining = 1;

        if (isNonEmptyString(disciplineId)) {
            var discipline = AcademyQueries.getDiscipline(disciplineId);
            if (discipline) {
                maxHours = parseFloat(discipline.weeklyHours) || 1;
                usedHours = getWeeklyHourUsage(studentId, weekNum, disciplineId);
                remaining = Math.max(0, maxHours - usedHours);
            }
        } else {
            // No discipline specified - check all available slots
            remaining = 4; // Max duration
        }

        var slots = [];

        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            for (var hour = CALENDAR_START_HOUR; hour <= CALENDAR_END_HOUR; hour++) {
                if (!schedule[day] || !schedule[day][hour]) {
                    // Check how many contiguous free hours are available
                    var maxDurationForSlot = Math.min(remaining, 4);
                    var contiguous = 0;
                    for (var h = hour; h <= CALENDAR_END_HOUR && contiguous < maxDurationForSlot; h++) {
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
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var freeBlocks = [];

        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            if (restDays.indexOf(day) !== -1) {
                continue;
            }

            var blockStart = null;
            var blockEnd = null;

            for (var hour = CALENDAR_START_HOUR; hour <= CALENDAR_END_HOUR; hour++) {
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
                    // Only count at the start of a class
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
                    // Only count at the start of a class
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
                    // Only count at the start of a class
                    var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        totalHours += startInfo.duration;
                        dayCounts[dayNum] += startInfo.duration;

                        if (!disciplineCount[disciplineId]) {
                            var disc = AcademyQueries.getDiscipline(disciplineId);
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
        for (var d = MIN_DAY; d <= MAX_DAY; d++) {
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
    // SCHEDULE INTEGRITY
    // ============================================================

    function validateScheduleIntegrity(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, issues: ['Student ID is required.'] };
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, issues: ['Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'] };
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var issues = [];
        var warnings = [];

        if (!schedule || Object.keys(schedule).length === 0) {
            return { valid: true, issues: [], warnings: ['No schedule for this week.'] };
        }

        // Find all class starts
        var classStarts = [];
        var metadata = {
            classDurations: window.data && window.data.curriculum ? window.data.curriculum.classDurations || {} : {}
        };

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

                var duration = CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
                if (duration !== null && duration !== undefined) {
                    // This is a class start (has duration metadata)
                    var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                    if (startInfo && startInfo.startHour === hourNum) {
                        classStarts.push({
                            day: dayNum,
                            hour: hourNum,
                            duration: startInfo.duration,
                            disciplineId: disciplineId,
                            key: startInfo.key
                        });
                    }
                }
            }
        }

        // Check for overlapping classes
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
                        message: 'Overlapping classes: ' +
                            a.hour + ':00-' + aEnd + ':00 and ' +
                            b.hour + ':00-' + bEnd + ':00'
                    });
                }
            }
        }

        // Check for missing duration metadata
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

                var startInfo = CalendarCore.findClassStartHour(schedule, dayNum, hourNum);
                if (startInfo && startInfo.startHour === hourNum) {
                    var duration = CalendarCore.getClassDuration(studentId, weekNum, dayNum, hourNum);
                    if (duration === null || duration === undefined) {
                        issues.push({
                            type: 'missing_duration',
                            day: dayNum,
                            hour: hourNum,
                            disciplineId: disciplineId,
                            message: 'Missing duration metadata at start hour'
                        });
                    }
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

    // ============================================================
    // SCHEDULE MUTATIONS - Delegates to CalendarCore
    // ============================================================

    function setClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateClassInput(studentId, week, day, hour, disciplineId, duration);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: CHECK CONFLICTS ----
        var conflicts = getConflicts(studentId, validation.week, validation.day, validation.hour, validation.duration);
        if (conflicts.length > 0) {
            var conflictNames = conflicts.map(function(c) { return c.disciplineName; });
            return failure('Schedule conflict: ' + conflictNames.join(', '));
        }

        // ---- PHASE 3: CHECK REST DAYS ----
        var restDays = getStudentRestDays(studentId, validation.week);
        if (restDays.indexOf(validation.day) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // ---- PHASE 4: CHECK WEEKLY HOUR LIMIT ----
        var usedHours = getWeeklyHourUsage(studentId, validation.week, validation.discipline.id);
        var maxHours = parseFloat(validation.discipline.weeklyHours) || 1;
        if (usedHours + validation.duration > maxHours) {
            return failure('Would exceed weekly hour limit (' + maxHours + 'h) for ' + validation.discipline.name);
        }

        // ---- PHASE 5: DELEGATE TO CALENDAR CORE ----
        var result = CalendarCore.setStudentScheduleClass(
            studentId,
            validation.week,
            validation.day,
            validation.hour,
            validation.discipline.id,
            validation.duration,
            instructorId
        );

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to set class.');
        }

        // ---- PHASE 6: LOG ----
        var studentName = CharacterQueries.getDisplayName(validation.student);
        recordActivity('Added class to schedule for ' + studentName + ': ' + validation.discipline.name + ' week ' + validation.week);

        return result;
    }

    function removeClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }
        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }
        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        // ---- PHASE 2: CHECK CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 3: DELEGATE TO CALENDAR CORE ----
        var result = CalendarCore.removeStudentScheduleClass(studentId, weekNum, dayNum, hourNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to remove class.');
        }

        // ---- PHASE 4: LOG ----
        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Removed class from schedule for ' + studentName + ' week ' + weekNum);

        return result;
    }

    function clearSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var result = CalendarCore.clearStudentSchedule(studentId, weekNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to clear schedule.');
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Cleared schedule for ' + studentName + ' week ' + weekNum);

        return result;
    }

    function duplicateSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return failure('Valid source week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }
        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return failure('Valid target week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
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

        var result = CalendarCore.duplicateStudentSchedule(studentId, sourceWeekNum, targetWeekNum, overwrite);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to duplicate schedule.');
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Duplicated schedule for ' + studentName + ' from week ' + sourceWeekNum + ' to ' + targetWeekNum);

        return result;
    }

    function setRestDays(studentId, week, days) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var restValidation = validateRestDays(days);
        if (!restValidation.valid) {
            return failure(restValidation.message);
        }

        var result = CalendarCore.setStudentRestDays(studentId, weekNum, restValidation.days);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to set rest days.');
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Set rest days for ' + studentName + ' week ' + weekNum);

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

        // Schedule integrity
        validateScheduleIntegrity: validateScheduleIntegrity,

        // Mutations
        setClass: setClass,
        removeClass: removeClass,
        clearSchedule: clearSchedule,
        duplicateSchedule: duplicateSchedule,
        setRestDays: setRestDays,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration
    };

})();