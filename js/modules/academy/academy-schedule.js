/**
 * modules/academy/academy-schedule.js - Academy Schedule
 * Academy's integration boundary with Calendar for scheduling operations
 *
 * Path: js/modules/academy/academy-schedule.js
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
 *   - This module does NOT call saveData()
 *
 * WRITE vs READ CONTRACT (v2 — Session D2):
 *   - WRITE operations return Promise<{ success, data?, message? }>.
 *     They delegate to the provider's Promise-based methods, which
 *     route through MutationPipeline. Persistence, rollback, and
 *     activity logging are owned by the pipeline.
 *   - READ operations remain SYNCHRONOUS. They delegate to the
 *     provider's read methods, which read window.data.curriculum
 *     directly.
 *   - Callers MUST treat writes as Promises. Do not test
 *     `if (result.success)` on a write — test it on the resolved
 *     value: `result.then(r => { if (r.success) ... })`.
 *   - The provider is the single boundary. If the provider returns
 *     a Promise for a write, this module returns a Promise for that
 *     write. If the provider returns a value synchronously for a
 *     read, this module returns synchronously for that read.
 *
 * WHY THE SPLIT:
 *   - ScheduleCore was rewritten in Session D1 to route every
 *     mutation through MutationPipeline. Those mutations are now
 *     Promise-based. Reads never went through the pipeline and
 *     remain synchronous.
 *   - This module does not wrap reads in Promises, because doing
 *     so would break every UI consumer that reads schedules
 *     synchronously (the calendar grid, the aggregator, the
 *     attendance views).
 *
 * PROVIDER INTERFACE:
 *   The provider MUST expose the following methods.
 *   Writes return Promise. Reads return synchronously.
 *
 *   Writes (Promise-based):
 *     setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata)
 *     removeStudentSlot(studentId, week, day, hour, duration)
 *     clearStudentSchedule(studentId, week)
 *     duplicateStudentSchedule(studentId, fromWeek, toWeek)
 *     setRestDays(studentId, week, days)
 *     removeRestDays(studentId, week)
 *     setSlotMetadata(studentId, week, day, hour, metadata)
 *     setLocationClass(locationId, week, day, hour, disciplineId, duration, metadata)
 *     removeLocationClass(locationId, week, day, hour)
 *
 *   Reads (synchronous):
 *     getStudentSchedule(studentId, week)
 *     getStudentRestDays(studentId, week)
 *     getSlotMetadata(studentId, week, day, hour)
 *     hasConflict(schedule, day, hour, duration)
 *     findClassStart(schedule, metadata, studentId, week, day, hour)
 *
 * METADATA MAP CONTRACT:
 *   - The `metadata` argument to `findClassStart` is the FULL metadata map,
 *     keyed `${entityId}_${week}_${day}_${hour}`. findClassStart walks
 *     forward from the given hour looking up candidate metadata to
 *     determine how far a multi-hour class extends.
 *   - The provider only exposes single-slot metadata lookup
 *     (`getSlotMetadata(id, week, day, hour)`), so this module
 *     reconstructs the full map on demand by enumerating the
 *     schedule's occupied slots and calling getSlotMetadata for each.
 *     The reconstruction is bounded by the student's own schedule.
 *
 * getStudentClasses SEMANTICS:
 *   - Returns ONE entry per occupied slot. A class that spans hours
 *     9, 10, 11 appears as three entries (one per hour).
 *   - This matches what StudentCalendarUI and the CalendarAggregator
 *     expect for grid rendering.
 *
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.AcademyConstants (from academy-constants.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 */

(function() {
    'use strict';

    if (window.__academyScheduleLoaded) {
        return;
    }
    window.__academyScheduleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
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
     *
     * Validates the provider interface:
     *   - Read methods must be present as functions.
     *   - Write methods must be present as functions.
     *   - This module does not verify that writes actually return
     *     Promises — it trusts the contract. If a write returns a
     *     raw value, this module wraps it in Promise.resolve so
     *     callers always get a Promise back.
     *
     * @param {object} deps - { calendarProvider }
     * @returns {boolean} True if configured successfully
     */
    function configure(deps) {
        deps = deps || {};

        if (!deps.calendarProvider) {
            return false;
        }

        var required = [
            // Reads (sync)
            'getStudentSchedule',
            'getStudentRestDays',
            'getSlotMetadata',
            'hasConflict',
            'findClassStart',
            // Writes (Promise)
            'setStudentSlot',
            'removeStudentSlot',
            'clearStudentSchedule',
            'duplicateStudentSchedule',
            'setRestDays',
            'removeRestDays',
            'setSlotMetadata',
            'setLocationClass',
            'removeLocationClass'
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

    /**
     * Coerce a provider write result to a Promise.
     *
     * If the provider already returns a Promise, pass it through.
     * If the provider returns a raw value (e.g. a synchronous
     * { success, data, message } from a legacy path), wrap it.
     * If the provider throws synchronously, catch and reject.
     *
     * This keeps the caller-facing contract uniform: writes ALWAYS
     * resolve to { success, data?, message? }.
     *
     * @param {function} fn - Zero-arg thunk that calls the provider
     * @returns {Promise<object>}
     */
    function asPromise(fn) {
        try {
            return Promise.resolve(fn());
        } catch (err) {
            return Promise.resolve({
                success: false,
                message: err && err.message ? err.message : 'Provider threw during write.'
            });
        }
    }

    // ============================================================
    // METADATA MAP RECONSTRUCTION
    // ============================================================
    //
    // The provider only exposes single-slot metadata lookup. The
    // findClassStart provider contract expects the full metadata map
    // keyed `${entityId}_${week}_${day}_${hour}`. We reconstruct it
    // by walking the schedule's occupied slots and calling
    // getSlotMetadata for each.
    //
    // The reconstruction is bounded by the entity's own schedule
    // (typically tens of slots at most), so the extra provider calls
    // are cheap. It avoids having to add a new required method to
    // the provider interface.
    //
    // @param {string} entityId - Student ID or location ID
    // @param {number} weekNum - Week number
    // @param {object} schedule - Schedule object { day: { hour: disciplineId } }
    // @returns {object} Metadata map keyed `${entityId}_${week}_${day}_${hour}`
    function buildMetadataMap(entityId, weekNum, schedule) {
        var map = {};

        if (!schedule || typeof schedule !== 'object') {
            return map;
        }

        for (var dayKey in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, dayKey)) {
                continue;
            }
            var dayNum = parseInt(dayKey, 10);
            if (isNaN(dayNum)) {
                continue;
            }

            var daySchedule = schedule[dayKey];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hourKey in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hourKey)) {
                    continue;
                }
                var hourNum = parseInt(hourKey, 10);
                if (isNaN(hourNum)) {
                    continue;
                }
                if (!daySchedule[hourKey]) {
                    continue;
                }

                var meta = _calendarProvider.getSlotMetadata(entityId, weekNum, dayNum, hourNum);
                if (meta && typeof meta === 'object') {
                    var key = String(entityId) + '_' + String(weekNum) + '_' +
                              String(dayNum) + '_' + String(hourNum);
                    map[key] = meta;
                }
            }
        }

        return map;
    }

    // ============================================================
    // STUDENT SCHEDULE - READ OPERATIONS (synchronous)
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
     * SEMANTICS:
     *   Returns ONE entry per occupied slot. A multi-hour class appears
     *   as N entries, one per hour. This matches what the calendar
     *   grid renderer expects.
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
    // STUDENT SCHEDULE - WRITE OPERATIONS (Promise-based)
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
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, metadata) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        var dayNum = parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return Promise.resolve(failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').'));
        }

        var hourNum = parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return Promise.resolve(failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').'));
        }

        var durationNum = parseDuration(duration);
        if (durationNum === null || durationNum < MIN_CLASS_DURATION || durationNum > MAX_DURATION) {
            return Promise.resolve(failure('Duration must be between ' + MIN_CLASS_DURATION + ' and ' + MAX_DURATION + ' hours.'));
        }

        if (hourNum + durationNum > MAX_HOUR + 1) {
            return Promise.resolve(failure('Class extends beyond the end of the day.'));
        }

        // ---- PHASE 2: CHECK FOR CONFLICTS (sync read) ----
        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        if (_calendarProvider.hasConflict(schedule, dayNum, hourNum, durationNum)) {
            return Promise.resolve(failure('Student already has a class during this time.'));
        }

        // ---- PHASE 3: DELEGATE TO CALENDAR ----
        return asPromise(function() {
            return _calendarProvider.setStudentSlot(
                studentId,
                weekNum,
                dayNum,
                hourNum,
                disciplineId,
                durationNum,
                metadata || {}
            );
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to set class.'
            );
        });
    }

    /**
     * Remove a student's schedule slot.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Optional duration (if not provided, uses metadata)
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function removeStudentScheduleClass(studentId, week, day, hour, duration) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        var dayNum = parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return Promise.resolve(failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').'));
        }

        var hourNum = parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return Promise.resolve(failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').'));
        }

        return asPromise(function() {
            return _calendarProvider.removeStudentSlot(studentId, weekNum, dayNum, hourNum, duration);
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to remove class.'
            );
        });
    }

    /**
     * Clear a student's entire schedule for a week.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function clearStudentSchedule(studentId, week) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        return asPromise(function() {
            return _calendarProvider.clearStudentSchedule(studentId, weekNum);
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to clear schedule.'
            );
        });
    }

    /**
     * Duplicate a student's schedule from one week to another.
     *
     * NOTE: The provider's duplicateStudentSchedule is expected to
     * copy the schedule, rest days, and metadata in one transaction.
     * See ScheduleCore.duplicateStudentSchedule for the semantics.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} fromWeek - Source week
     * @param {number|string} toWeek - Target week
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function duplicateStudentSchedule(studentId, fromWeek, toWeek) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var fromWeekNum = parseWeek(fromWeek);
        var toWeekNum = parseWeek(toWeek);

        if (fromWeekNum === null || fromWeekNum < MIN_WEEK || fromWeekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid source week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        if (toWeekNum === null || toWeekNum < MIN_WEEK || toWeekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid target week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        if (fromWeekNum === toWeekNum) {
            return Promise.resolve(failure('Source and target weeks must be different.'));
        }

        return asPromise(function() {
            return _calendarProvider.duplicateStudentSchedule(studentId, fromWeekNum, toWeekNum);
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to duplicate schedule.'
            );
        });
    }

    // ============================================================
    // REST DAYS - READS (synchronous)
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

    // ============================================================
    // REST DAYS - WRITES (Promise-based)
    // ============================================================

    /**
     * Set a student's rest days for a week.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {array} days - Array of day numbers (1-7)
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function setStudentRestDays(studentId, week, days) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        if (!Array.isArray(days)) {
            return Promise.resolve(failure('Rest days must be an array.'));
        }

        for (var i = 0; i < days.length; i++) {
            var dayNum = parseDay(days[i]);
            if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
                return Promise.resolve(failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').'));
            }
        }

        return asPromise(function() {
            return _calendarProvider.setRestDays(studentId, weekNum, days);
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to set rest days.'
            );
        });
    }

    /**
     * Clear a student's rest days for a week.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {Promise<{ success: boolean, message?: string, data?: object }>}
     */
    function clearStudentRestDays(studentId, week) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        return asPromise(function() {
            return _calendarProvider.removeRestDays(studentId, weekNum);
        }).then(function(providerResult) {
            if (providerResult && providerResult.success) {
                return success(providerResult.data !== undefined ? providerResult.data : providerResult);
            }
            return failure(
                providerResult && providerResult.message
                    ? providerResult.message
                    : 'Failed to clear rest days.'
            );
        });
    }

    // ============================================================
    // CONFLICT DETECTION (synchronous, pure)
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
    // CLASS METADATA HELPERS (synchronous)
    // ============================================================

    function getClassInstructor(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.instructorId : null;
    }

    function getClassInstructorName(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        if (!details || !details.instructorId) {
            return 'Not assigned';
        }
        return details.instructorName || 'Not assigned';
    }

    function getClassDuration(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.duration || 1 : 1;
    }

    function getClassLabel(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.label || '' : '';
    }

    /**
     * Find the start hour of a class that may span multiple hours.
     *
     * The provider's findClassStart contract expects the FULL
     * metadata map (keyed `${entityId}_${week}_${day}_${hour}`), not a
     * single-entry object. This function reconstructs the full map
     * from the student's own schedule before delegating.
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
        var metadataMap = buildMetadataMap(studentId, weekNum, schedule);

        var result = _calendarProvider.findClassStart(
            schedule,
            metadataMap,
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

        return result ? result.startHour : null;
    }

    function getFullClassDetails(studentId, week, day, hour) {
        return getClassDetails(studentId, week, day, hour);
    }

    // ============================================================
    // BULK OPERATIONS (Promise-based, sequential)
    // ============================================================

    /**
     * Save multiple schedule slots at once.
     *
     * SLOTS are applied SEQUENTIALLY. If any write fails, subsequent
     * writes are skipped and the failure is reported in `errors`.
     * Successful writes before the failure remain applied — there is
     * no cross-slot transaction here. If you need all-or-nothing
     * across multiple slots, you need a bulk pipeline operation in
     * ScheduleCore, not this fan-out loop.
     *
     * @param {array} slots - Array of slot objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing slots
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function saveScheduleSlots(slots, options) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

        if (!Array.isArray(slots) || slots.length === 0) {
            return Promise.resolve(failure('Schedule slots array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var counters = {
            created: 0,
            updated: 0,
            skipped: 0
        };
        var errors = [];
        var succeeded = 0;

        // Pre-flight: validate the entire batch before running any writes.
        // We don't want to partially apply if most of the input is
        // malformed.
        var validated = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (!slot || typeof slot !== 'object') {
                errors.push({ index: i, error: 'Invalid slot data.' });
                continue;
            }
            if (!slot.studentId || !slot.disciplineId ||
                slot.week === undefined || slot.day === undefined || slot.hour === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: studentId, disciplineId, week, day, hour'
                });
                continue;
            }
            validated.push({ index: i, slot: slot });
        }

        if (validated.length === 0) {
            return Promise.resolve(success({
                total: slots.length,
                created: 0,
                updated: 0,
                skipped: 0,
                errors: errors,
                successCount: 0
            }));
        }

        // Sequential write chain. Each `.then` returns either a
        // resolved result or a rejected one; we catch per-slot so a
        // single failure does not abort the whole chain unless we
        // choose to stop. Here, we continue so the report is complete.
        var chain = Promise.resolve();

        validated.forEach(function(item) {
            chain = chain.then(function() {
                var slot = item.slot;
                var dayNum = parseDay(slot.day);
                var hourNum = parseHour(slot.hour);

                if (dayNum === null || hourNum === null) {
                    errors.push({ index: item.index, error: 'Invalid day or hour.' });
                    return;
                }

                var schedule = _calendarProvider.getStudentSchedule(slot.studentId, slot.week);
                var exists = schedule[dayNum] && schedule[dayNum][hourNum];

                if (exists && !overwrite) {
                    counters.skipped++;
                    return;
                }

                var duration = slot.duration || 1;
                var metadata = slot.metadata || {};

                return setStudentScheduleClass(
                    slot.studentId,
                    slot.week,
                    slot.day,
                    slot.hour,
                    slot.disciplineId,
                    duration,
                    metadata
                ).then(function(result) {
                    if (result && result.success) {
                        if (exists) {
                            counters.updated++;
                        } else {
                            counters.created++;
                        }
                        succeeded++;
                    } else {
                        errors.push({
                            index: item.index,
                            error: result && result.message ? result.message : 'Unknown error.'
                        });
                    }
                });
            });
        });

        return chain.then(function() {
            return success({
                total: slots.length,
                created: counters.created,
                updated: counters.updated,
                skipped: counters.skipped,
                errors: errors,
                successCount: succeeded
            });
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySchedule = {
        // Configuration
        configure: configure,

        // ---- Student Schedule: Reads (synchronous) ----
        getStudentSchedule: getStudentSchedule,
        getStudentClasses: getStudentClasses,
        getClassDetails: getClassDetails,
        getStudentWeeklyUsage: getStudentWeeklyUsage,

        // ---- Student Schedule: Writes (Promise-based) ----
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,

        // ---- Rest Days: Reads (synchronous) ----
        getStudentRestDays: getStudentRestDays,

        // ---- Rest Days: Writes (Promise-based) ----
        setStudentRestDays: setStudentRestDays,
        clearStudentRestDays: clearStudentRestDays,

        // ---- Conflict Detection (synchronous) ----
        hasStudentScheduleConflict: hasStudentScheduleConflict,
        isStudentRestDay: isStudentRestDay,

        // ---- Class Metadata (synchronous) ----
        getClassInstructor: getClassInstructor,
        getClassInstructorName: getClassInstructorName,
        getClassDuration: getClassDuration,
        getClassLabel: getClassLabel,
        findClassStartHour: findClassStartHour,
        getFullClassDetails: getFullClassDetails,

        // ---- Bulk Operations (Promise-based) ----
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