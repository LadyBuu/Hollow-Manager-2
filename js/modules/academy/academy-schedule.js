/**
 * modules/academy/academy-schedule.js - Academy Schedule
 * Academy's integration boundary with Calendar for scheduling operations
 * 
 * This module provides Academy-specific scheduling operations that
 * delegate to the Calendar domain for actual schedule mechanics.
 * 
 * IMPORTANT:
 *   - This is an INTEGRATION/ORCHESTRATION layer, not a scheduling domain
 *   - Uses CalendarProvider for all schedule operations
 *   - Calendar owns schedule mechanics (ScheduleCore)
 *   - No direct window.data access
 *   - No direct CalendarCore/ScheduleCore imports (uses provider)
 *   - All operations are candidate-based: validate → delegate
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 * 
 * DEPENDENCY INJECTION:
 *   - CalendarProvider is injected via init() or configure()
 *   - No hard dependency on ScheduleCore or CalendarQueries
 * 
 * CALENDAR PROVIDER INTERFACE:
 *   {
 *       getStudentSchedule: function(studentId, week) { ... },
 *       setStudentSlot: function(studentId, week, day, hour, disciplineId, duration, metadata) { ... },
 *       removeStudentSlot: function(studentId, week, day, hour) { ... },
 *       clearStudentSchedule: function(studentId, week) { ... },
 *       duplicateStudentSchedule: function(studentId, fromWeek, toWeek) { ... },
 *       getStudentRestDays: function(studentId, week) { ... },
 *       setRestDays: function(studentId, week, days) { ... },
 *       removeRestDays: function(studentId, week) { ... },
 *       hasConflict: function(schedule, day, hour, duration) { ... },
 *       getSlotMetadata: function(studentId, week, day, hour) { ... },
 *       setSlotMetadata: function(studentId, week, day, hour, metadata) { ... },
 *       findClassStart: function(schedule, metadata, studentId, week, day, hour) { ... }
 *   }
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.AcademyConstants (from academy-constants.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 * 
 * USAGE:
 *   // Configure with CalendarProvider
 *   AcademySchedule.configure({
 *       calendarProvider: {
 *           getStudentSchedule: function(studentId, week) {
 *               return CalendarQueries.getStudentSchedule(studentId, week);
 *           },
 *           setStudentSlot: function(studentId, week, day, hour, disciplineId, duration, metadata) {
 *               return ScheduleCore.setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata);
 *           },
 *           // ... all other methods
 *       }
 *   });
 * 
 *   // Use schedule operations
 *   var schedule = AcademySchedule.getStudentSchedule('student_123', 5);
 *   var result = AcademySchedule.setStudentScheduleClass('student_123', 5, 1, 9, 'disc_abc', 2);
 *   var result = AcademySchedule.removeStudentScheduleClass('student_123', 5, 1, 9);
 */

(function() {
    'use strict';

    if (window.__academyScheduleLoaded) {
        return;
    }
    window.__academyScheduleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var AcademyConstants = window.AcademyConstants;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;

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
    // INJECTED DEPENDENCIES
    // ============================================================

    var _calendarProvider = null;

    /**
     * Configure AcademySchedule with external dependencies.
     * Must be called before any schedule operations.
     * 
     * @param {object} deps - Dependency injection object
     * @param {object} deps.calendarProvider - Calendar provider with schedule methods
     * @returns {boolean} True if configured successfully
     */
    function configure(deps) {
        deps = deps || {};

        if (deps.calendarProvider) {
            var required = [
                'getStudentSchedule',
                'setStudentSlot',
                'removeStudentSlot',
                'clearStudentSchedule',
                'duplicateStudentSchedule',
                'getStudentRestDays',
                'setRestDays',
                'removeRestDays',
                'hasConflict',
                'getSlotMetadata',
                'setSlotMetadata',
                'findClassStart'
            ];

            var missing = [];
            for (var i = 0; i < required.length; i++) {
                var method = required[i];
                if (typeof deps.calendarProvider[method] !== 'function') {
                    missing.push(method);
                }
            }

            if (missing.length > 0) {
                console.warn('[AcademySchedule] calendarProvider missing methods:', missing.join(', '));
                return false;
            }

            _calendarProvider = deps.calendarProvider;
            return true;
        }

        return false;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }

        if (!AcademyConstants) {
            missing.push('AcademyConstants');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
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

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!_calendarProvider) {
            missing.push('calendarProvider (call AcademySchedule.configure() first)');
        }

        if (missing.length > 0) {
            console.warn('[AcademySchedule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
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

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return DEFAULT_WEEK;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // STUDENT SCHEDULE - READ OPERATIONS
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getStudentSchedule(studentId, week) {
        if (!checkDependencies()) {
            return {};
        }

        if (!isNonEmptyString(studentId)) {
            return {};
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = getCurrentWeek();
        }

        return _calendarProvider.getStudentSchedule(studentId, weekNum);
    }

    /**
     * Get a student's classes for a specific week (with details).
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of class detail objects
     */
    function getStudentClasses(studentId, week) {
        if (!checkDependencies()) {
            return [];
        }

        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = getCurrentWeek();
        }

        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        var restDays = _calendarProvider.getStudentRestDays(studentId, weekNum);
        var classes = [];

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) {
                continue;
            }

            // Skip rest days
            var isRestDay = false;
            for (var r = 0; r < restDays.length; r++) {
                if (restDays[r] === dayNum) {
                    isRestDay = true;
                    break;
                }
            }
            if (isRestDay) {
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
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) {
                    continue;
                }

                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }

                var metadata = _calendarProvider.getSlotMetadata(studentId, weekNum, dayNum, hourNum);
                var discipline = DisciplineQueries.getDiscipline(disciplineId);
                var instructorId = metadata ? metadata.instructorId : null;
                var instructorName = '';
                if (instructorId) {
                    var instructor = CharacterQueries.getCharacterById(instructorId);
                    if (instructor) {
                        instructorName = CharacterQueries.getDisplayName(instructor);
                    }
                }

                classes.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: disciplineId,
                    disciplineName: discipline ? discipline.name : 'Unknown',
                    duration: metadata ? metadata.duration || 1 : 1,
                    label: metadata ? metadata.label || '' : '',
                    groupLabel: metadata ? metadata.groupLabel || '' : '',
                    instructorId: instructorId,
                    instructorName: instructorName,
                    isContinuation: false
                });
            }
        }

        classes.sort(function(a, b) {
            if (a.day !== b.day) {
                return a.day - b.day;
            }
            return a.hour - b.hour;
        });

        return classes;
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
        if (!checkDependencies()) {
            return null;
        }

        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        var metadata = _calendarProvider.getSlotMetadata(studentId, weekNum, dayNum, hourNum);
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        var instructorId = metadata ? metadata.instructorId : null;
        var instructorName = '';
        if (instructorId) {
            var instructor = CharacterQueries.getCharacterById(instructorId);
            if (instructor) {
                instructorName = CharacterQueries.getDisplayName(instructor);
            }
        }

        return {
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            disciplineId: disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            duration: metadata ? metadata.duration || 1 : 1,
            label: metadata ? metadata.label || '' : '',
            groupLabel: metadata ? metadata.groupLabel || '' : '',
            instructorId: instructorId,
            instructorName: instructorName,
            isContinuation: false
        };
    }

    /**
     * Get weekly usage statistics for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { total, byDiscipline }
     */
    function getStudentWeeklyUsage(studentId, week) {
        if (!checkDependencies()) {
            return { total: 0, byDiscipline: {} };
        }

        if (!isNonEmptyString(studentId)) {
            return { total: 0, byDiscipline: {} };
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = getCurrentWeek();
        }

        var classes = getStudentClasses(studentId, weekNum);
        var total = 0;
        var byDiscipline = {};

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var duration = cls.duration || 1;
            total += duration;

            var id = cls.disciplineId;
            if (!byDiscipline[id]) {
                byDiscipline[id] = {
                    disciplineId: id,
                    disciplineName: cls.disciplineName || 'Unknown',
                    hours: 0
                };
            }
            byDiscipline[id].hours += duration;
        }

        return {
            total: total,
            byDiscipline: byDiscipline
        };
    }

    // ============================================================
    // STUDENT SCHEDULE - MUTATION OPERATIONS
    // ============================================================

    /**
     * Set a student's schedule slot.
     * Validates inputs then delegates to CalendarProvider.
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
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

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
        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        if (_calendarProvider.hasConflict(schedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        // ---- PHASE 3: DELEGATE TO CALENDAR ----
        var result = _calendarProvider.setStudentSlot(
            studentId,
            weekNum,
            dayNum,
            hourNum,
            disciplineId,
            durationNum,
            metadata || {}
        );

        return result ? success(result) : failure('Failed to set class.');
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
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

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

        // DELEGATE TO CALENDAR
        var result = _calendarProvider.removeStudentSlot(studentId, weekNum, dayNum, hourNum, duration);
        return result ? success(result) : failure('Failed to remove class.');
    }

    /**
     * Clear a student's entire schedule for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearStudentSchedule(studentId, week) {
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // DELEGATE TO CALENDAR
        var result = _calendarProvider.clearStudentSchedule(studentId, weekNum);
        return result ? success(result) : failure('Failed to clear schedule.');
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
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

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

        // DELEGATE TO CALENDAR
        var result = _calendarProvider.duplicateStudentSchedule(studentId, fromWeekNum, toWeekNum);
        return result ? success(result) : failure('Failed to duplicate schedule.');
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    /**
     * Get a student's rest days for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of rest day numbers
     */
    function getStudentRestDays(studentId, week) {
        if (!checkDependencies()) {
            return [];
        }

        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = getCurrentWeek();
        }

        return _calendarProvider.getStudentRestDays(studentId, weekNum);
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
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

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

        // DELEGATE TO CALENDAR
        var result = _calendarProvider.setRestDays(studentId, weekNum, days);
        return result ? success(result) : failure('Failed to set rest days.');
    }

    /**
     * Clear a student's rest days for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearStudentRestDays(studentId, week) {
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // DELEGATE TO CALENDAR
        var result = _calendarProvider.removeRestDays(studentId, weekNum);
        return result ? success(result) : failure('Failed to clear rest days.');
    }

    // ============================================================
    // CONFLICT DETECTION
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
        if (!checkDependencies()) {
            return true;
        }

        if (!isNonEmptyString(studentId)) {
            return true;
        }

        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);
        var durationNum = parseDuration(duration);

        if (weekNum === null || dayNum === null || hourNum === null || durationNum === null) {
            return true;
        }

        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        return _calendarProvider.hasConflict(schedule, dayNum, hourNum, durationNum);
    }

    /**
     * Check if a day is a rest day for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @returns {boolean} True if the day is a rest day
     */
    function isStudentRestDay(studentId, week, day) {
        if (!checkDependencies()) {
            return false;
        }

        if (!isNonEmptyString(studentId)) {
            return false;
        }

        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);

        if (weekNum === null || dayNum === null) {
            return false;
        }

        var restDays = _calendarProvider.getStudentRestDays(studentId, weekNum);
        for (var i = 0; i < restDays.length; i++) {
            if (restDays[i] === dayNum) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // CLASS METADATA HELPERS
    // ============================================================

    /**
     * Get the instructor ID for a specific class slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {string|null} Instructor ID or null
     */
    function getClassInstructor(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
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
        var details = getClassDetails(studentId, week, day, hour);
        if (!details || !details.instructorId) {
            return 'Not assigned';
        }
        return details.instructorName || 'Not assigned';
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
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.duration || 1 : 1;
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
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.label || '' : '';
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
        if (!checkDependencies()) {
            return null;
        }

        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = parseWeek(week);
        var dayNum = parseDay(day);
        var hourNum = parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        var metadata = _calendarProvider.getSlotMetadata(studentId, weekNum, dayNum, hourNum);

        var result = _calendarProvider.findClassStart(
            schedule,
            { [studentId + '_' + weekNum + '_' + dayNum + '_' + hourNum]: metadata },
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

        return result ? result.startHour : null;
    }

    /**
     * Get full class details with all metadata.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object|null} Full class details or null
     */
    function getFullClassDetails(studentId, week, day, hour) {
        return getClassDetails(studentId, week, day, hour);
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
        if (!checkDependencies()) {
            return failure('Dependencies not available.');
        }

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

            if (!slot.studentId || !slot.disciplineId || slot.week === undefined ||
                slot.day === undefined || slot.hour === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: studentId, disciplineId, week, day, hour'
                });
                continue;
            }

            var schedule = _calendarProvider.getStudentSchedule(slot.studentId, slot.week);
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
        // Configuration
        configure: configure,

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