/**
 * js/modules/academy/academy-schedule.js - Academy Schedule
 * Academy-specific scheduling operations for students, instructors, and locations
 * Path: js/modules/academy/academy-schedule.js
 * 
 * This module is responsible for:
 *   - Student schedule management (get, set, remove, clear, duplicate)
 *   - Student rest day management
 *   - Schedule conflict detection
 *   - Schedule queries (class details, instructor, duration, label)
 *   - Schedule validation
 * 
 * IMPORTANT:
 *   - This module uses ScheduleCore for all scheduling mutations
 *   - Uses CalendarQueries for all scheduling reads
 *   - No direct CalendarCore dependency
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - AcademyQueries is the PUBLIC read facade for academy data
 * 
 * DEPENDENCY GRAPH:
 *   AcademySchedule
 *        ↓
 *   ┌─────┼─────┐
 *   ↓           ↓
 * ScheduleCore CalendarQueries
 *   ↓           ↓
 *   └─────┼─────┘
 *         ↓
 *   Internal Data Store
 * 
 * DEPENDENCIES:
 *   - window.ScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.CalendarQueries (from calendar-queries.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var schedule = window.AcademySchedule;
 *   
 *   // Get schedule
 *   var studentSchedule = schedule.getStudentSchedule('student_123', 5);
 *   var classDetails = schedule.getClassDetails('student_123', 5, 1, 9);
 *   
 *   // Mutate schedule
 *   var result = schedule.setStudentScheduleClass('student_123', 5, 1, 9, 'disc_abc', 2);
 *   var result = schedule.removeStudentScheduleClass('student_123', 5, 1, 9);
 *   var result = schedule.clearStudentSchedule('student_123', 5);
 *   var result = schedule.duplicateStudentSchedule('student_123', 4, 5);
 *   
 *   // Rest days
 *   var restDays = schedule.getStudentRestDays('student_123', 5);
 *   var result = schedule.setStudentRestDays('student_123', 5, [1, 3, 5]);
 *   var result = schedule.clearStudentRestDays('student_123', 5);
 *   
 *   // Queries
 *   var instructor = schedule.getClassInstructor('student_123', 5, 1, 9);
 *   var duration = schedule.getClassDuration('student_123', 5, 1, 9);
 *   var label = schedule.getClassLabel('student_123', 5, 1, 9);
 *   var startHour = schedule.findClassStartHour('student_123', 5, 1, 9);
 *   var hasConflict = schedule.hasStudentScheduleConflict('student_123', 5, 1, 9, 2);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyScheduleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ScheduleCore || typeof window.ScheduleCore.getStudentSchedule !== 'function') {
        missing.push('ScheduleCore.getStudentSchedule');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.setStudentSlot !== 'function') {
        missing.push('ScheduleCore.setStudentSlot');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeStudentSlot !== 'function') {
        missing.push('ScheduleCore.removeStudentSlot');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.clearStudentSchedule !== 'function') {
        missing.push('ScheduleCore.clearStudentSchedule');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.duplicateStudentSchedule !== 'function') {
        missing.push('ScheduleCore.duplicateStudentSchedule');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.getStudentRestDays !== 'function') {
        missing.push('ScheduleCore.getStudentRestDays');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.setRestDays !== 'function') {
        missing.push('ScheduleCore.setRestDays');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.removeRestDays !== 'function') {
        missing.push('ScheduleCore.removeRestDays');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.hasConflict !== 'function') {
        missing.push('ScheduleCore.hasConflict');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.findClassStart !== 'function') {
        missing.push('ScheduleCore.findClassStart');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.getSlotMetadata !== 'function') {
        missing.push('ScheduleCore.getSlotMetadata');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.setSlotMetadata !== 'function') {
        missing.push('ScheduleCore.setSlotMetadata');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.isRestDay !== 'function') {
        missing.push('ScheduleCore.isRestDay');
    }

    if (!window.CalendarQueries || typeof window.CalendarQueries.getClassDetails !== 'function') {
        missing.push('CalendarQueries.getClassDetails');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getStudentClasses !== 'function') {
        missing.push('CalendarQueries.getStudentClasses');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getStudentWeeklyUsage !== 'function') {
        missing.push('CalendarQueries.getStudentWeeklyUsage');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.getConflicts !== 'function') {
        missing.push('CalendarQueries.getConflicts');
    }
    if (!window.CalendarQueries || typeof window.CalendarQueries.isRestDay !== 'function') {
        missing.push('CalendarQueries.isRestDay');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseDay !== 'function') {
        missing.push('CalendarValidation.parseDay');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseHour !== 'function') {
        missing.push('CalendarValidation.parseHour');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseDuration !== 'function') {
        missing.push('CalendarValidation.parseDuration');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (missing.length > 0) {
        throw new Error('[AcademySchedule] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyScheduleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ScheduleCore = window.ScheduleCore;
    var CalendarQueries = window.CalendarQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
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

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS - DELEGATES TO SCHEDULECORE
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getStudentSchedule(studentId, week) {
        return ScheduleCore.getStudentSchedule(studentId, week);
    }

    /**
     * Get a student's classes for a specific week (with details).
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of class detail objects
     */
    function getStudentClasses(studentId, week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            weekNum = getCurrentWeek();
        }
        return CalendarQueries.getStudentClasses(studentId, weekNum);
    }

    /**
     * Get class details for a specific slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object|null} Class details or null
     */
    function getClassDetails(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        return CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
    }

    /**
     * Get weekly usage statistics for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { total, byDiscipline }
     */
    function getStudentWeeklyUsage(studentId, week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            weekNum = getCurrentWeek();
        }
        return CalendarQueries.getStudentWeeklyUsage(studentId, weekNum);
    }

    /**
     * Set a student's schedule slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {string} disciplineId - Discipline ID
     * @param {number|string} duration - Duration in hours
     * @param {object} metadata - Additional metadata (instructor, label, etc.)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, metadata) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var dayNum = parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }

        var hourNum = parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        var durationNum = parseDuration(duration);
        if (durationNum === null || durationNum < MIN_CLASS_DURATION || durationNum > MAX_DURATION) {
            return failure('Duration must be between ' + MIN_CLASS_DURATION + ' and ' + MAX_DURATION + ' hours.');
        }

        if (hourNum + durationNum > MAX_HOUR + 1) {
            return failure('Class extends beyond the end of the day.');
        }

        // ---- PHASE 2: CHECK FOR CONFLICTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        if (ScheduleCore.hasConflict(schedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        // ---- PHASE 3: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.setStudentSlot(
            studentId,
            weekNum,
            dayNum,
            hourNum,
            disciplineId,
            durationNum,
            metadata || {}
        );
    }

    /**
     * Remove a student's schedule slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Optional duration (if not provided, uses metadata)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeStudentScheduleClass(studentId, week, day, hour, duration) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var dayNum = parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }

        var hourNum = parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        // ---- PHASE 2: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.removeStudentSlot(studentId, weekNum, dayNum, hourNum, duration);
    }

    /**
     * Clear a student's entire schedule for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 2: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.clearStudentSchedule(studentId, weekNum);
    }

    /**
     * Duplicate a student's schedule from one week to another.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} fromWeek - Source week
     * @param {number|string} toWeek - Target week
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function duplicateStudentSchedule(studentId, fromWeek, toWeek) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var fromWeekNum = parseWeek(fromWeek);
        var toWeekNum = parseWeek(toWeek);

        if (fromWeekNum === null || fromWeekNum < MIN_WEEK || fromWeekNum > MAX_WEEK) {
            return failure('Valid source week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (toWeekNum === null || toWeekNum < MIN_WEEK || toWeekNum > MAX_WEEK) {
            return failure('Valid target week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (fromWeekNum === toWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        // ---- PHASE 2: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.duplicateStudentSchedule(studentId, fromWeekNum, toWeekNum);
    }

    // ============================================================
    // REST DAY OPERATIONS - DELEGATES TO SCHEDULECORE
    // ============================================================

    /**
     * Get a student's rest days for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of rest day numbers
     */
    function getStudentRestDays(studentId, week) {
        return ScheduleCore.getStudentRestDays(studentId, week);
    }

    /**
     * Set a student's rest days for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {array} days - Array of day numbers (1-7)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (!Array.isArray(days)) {
            return failure('Rest days must be an array.');
        }

        // Validate each day
        for (var i = 0; i < days.length; i++) {
            var dayNum = parseDay(days[i]);
            if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
                return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
            }
        }

        // ---- PHASE 2: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.setRestDays(studentId, weekNum, days);
    }

    /**
     * Clear a student's rest days for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearStudentRestDays(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 2: DELEGATE TO SCHEDULECORE ----
        return ScheduleCore.removeRestDays(studentId, weekNum);
    }

    // ============================================================
    // CONFLICT DETECTION - DELEGATES TO SCHEDULECORE + CALENDARQUERIES
    // ============================================================

    /**
     * Check if a student has a schedule conflict.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasStudentScheduleConflict(studentId, week, day, hour, duration) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);
        var durationNum = parseDuration(duration);

        if (weekNum === null || dayNum === null || hourNum === null || durationNum === null) {
            return true;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        return ScheduleCore.hasConflict(schedule, dayNum, hourNum, durationNum);
    }

    /**
     * Get detailed conflict information for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @returns {array} Array of conflict objects
     */
    function getStudentScheduleConflicts(studentId, week, day, hour, duration) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);
        var durationNum = parseDuration(duration);

        if (weekNum === null || dayNum === null || hourNum === null || durationNum === null) {
            return [];
        }

        return CalendarQueries.getConflicts(studentId, weekNum, dayNum, hourNum, durationNum);
    }

    /**
     * Check if a student has a rest day on a specific day.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @returns {boolean} True if the day is a rest day
     */
    function isStudentRestDay(studentId, week, day) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);

        if (weekNum === null || dayNum === null) {
            return false;
        }

        return CalendarQueries.isRestDay(studentId, weekNum, dayNum);
    }

    // ============================================================
    // CLASS METADATA QUERIES - DELEGATES TO SCHEDULECORE + CALENDARQUERIES
    // ============================================================

    /**
     * Get the instructor for a specific class slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {string|null} Instructor ID or null
     */
    function getClassInstructor(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        var details = CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
        return details ? details.instructorId : null;
    }

    /**
     * Get the instructor name for a specific class slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {string} Instructor name or 'Not assigned'
     */
    function getClassInstructorName(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return 'Not assigned';
        }

        var details = CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
        if (!details || !details.instructorId) {
            return 'Not assigned';
        }

        var instructor = CharacterQueries.getCharacterById(details.instructorId);
        return instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown';
    }

    /**
     * Get the duration for a specific class slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {number} Duration in hours (default: 1)
     */
    function getClassDuration(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return 1;
        }

        var details = CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
        return details ? (details.duration || 1) : 1;
    }

    /**
     * Get the label for a specific class slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {string} Class label or empty string
     */
    function getClassLabel(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return '';
        }

        var details = CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
        return details ? (details.label || '') : '';
    }

    /**
     * Find the start hour of a class that may span multiple hours.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number within the class
     * @returns {number|null} Start hour or null
     */
    function findClassStartHour(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var metadata = ScheduleCore.getSlotMetadata(studentId, weekNum, dayNum, hourNum);

        var classStart = ScheduleCore.findClassStart(
            schedule,
            { [ScheduleCore.getScheduleKey(studentId, weekNum, dayNum, hourNum)]: metadata },
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

        return classStart ? classStart.startHour : null;
    }

    /**
     * Get class details with full metadata.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object|null} Full class details or null
     */
    function getFullClassDetails(studentId, week, day, hour) {
        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        return CalendarQueries.getClassDetails(studentId, weekNum, dayNum, hourNum);
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Save multiple schedule slots at once.
     * 
     * @param {array} slots - Array of slot objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing slots
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function saveScheduleSlots(slots, options) {
        if (!Array.isArray(slots) || slots.length === 0) {
            return failure('Schedule slots array is required.');
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var created = 0;
        var updated = 0;
        var skipped = 0;
        var errors = [];

        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (!slot || typeof slot !== 'object') {
                errors.push({
                    index: i,
                    error: 'Invalid slot data.'
                });
                continue;
            }

            // Validate required fields
            if (!slot.studentId || !slot.disciplineId || slot.week === undefined ||
                slot.day === undefined || slot.hour === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: studentId, disciplineId, week, day, hour'
                });
                continue;
            }

            // Check if slot already exists
            var schedule = getStudentSchedule(slot.studentId, slot.week);
            var dayNum = parseDay(slot.day);
            var hourNum = parseHour(slot.hour);

            if (dayNum === null || hourNum === null) {
                errors.push({
                    index: i,
                    error: 'Invalid day or hour.'
                });
                continue;
            }

            var exists = schedule[dayNum] && schedule[dayNum][hourNum];

            if (exists && !overwrite) {
                skipped++;
                continue;
            }

            var duration = slot.duration || 1;
            var metadata = slot.metadata || {};

            var result = setStudentScheduleClass(
                slot.studentId,
                slot.week,
                slot.day,
                slot.hour,
                slot.disciplineId,
                duration,
                metadata
            );

            if (result.success) {
                if (exists) {
                    updated++;
                } else {
                    created++;
                }
            } else {
                errors.push({
                    index: i,
                    error: result.message
                });
            }
        }

        return success({
            total: slots.length,
            created: created,
            updated: updated,
            skipped: skipped,
            errors: errors,
            successCount: created + updated
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySchedule = {
        // ---- Student Schedule ----
        getStudentSchedule: getStudentSchedule,
        getStudentClasses: getStudentClasses,
        getClassDetails: getClassDetails,
        getStudentWeeklyUsage: getStudentWeeklyUsage,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,

        // ---- Rest Days ----
        getStudentRestDays: getStudentRestDays,
        setStudentRestDays: setStudentRestDays,
        clearStudentRestDays: clearStudentRestDays,

        // ---- Conflict Detection ----
        hasStudentScheduleConflict: hasStudentScheduleConflict,
        getStudentScheduleConflicts: getStudentScheduleConflicts,
        isStudentRestDay: isStudentRestDay,

        // ---- Class Metadata ----
        getClassInstructor: getClassInstructor,
        getClassInstructorName: getClassInstructorName,
        getClassDuration: getClassDuration,
        getClassLabel: getClassLabel,
        findClassStartHour: findClassStartHour,
        getFullClassDetails: getFullClassDetails,

        // ---- Bulk Operations ----
        saveScheduleSlots: saveScheduleSlots,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        MIN_HOUR: MIN_HOUR,
        MAX_HOUR: MAX_HOUR,
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        MAX_DURATION: MAX_DURATION,
        MIN_CLASS_DURATION: MIN_CLASS_DURATION,
        DEFAULT_WEEK: DEFAULT_WEEK
    };

})();
