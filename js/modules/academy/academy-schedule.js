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
 * WRITE vs READ CONTRACT:
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
 *
 * NO CURRENT-WEEK FALLBACK:
 *   Reads and writes REQUIRE a valid week. When the week is invalid,
 *   reads return empty results (not week 1 data), and writes are
 *   rejected. Callers that want the "current week" behavior fetch
 *   window.data.currentWeek themselves and pass it in. This module
 *   does not silently substitute a default.
 *
 * NO ENRICHMENT:
 *   This module does not resolve discipline names or instructor
 *   names. Schedule entries are returned with raw IDs. Callers that
 *   need display enrichment compose the returned data with
 *   AcademyDisciplines and CharacterQueries themselves, or via
 *   AcademyAggregator.
 *
 *   Rationale: this module is the scheduling boundary. Pulling
 *   AcademyDisciplines or CharacterQueries into it couples the
 *   schedule layer to the entity layer for display reasons. The
 *   aggregator is where that composition belongs.
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
 *   - Each entry carries day, hour, disciplineId, duration, label,
 *     groupLabel, and instructorId from metadata. It does NOT carry
 *     disciplineName or instructorName — enrichment is the caller's
 *     concern.
 *   - This matches what the CalendarAggregator produces for grid
 *     rendering, minus the display-name enrichment.
 *
 * DEPENDENCIES:
 *   - window.AcademyConstants (from academy-constants.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarProvider (via configure()) - MANDATORY
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

    var AcademyConstants = window.AcademyConstants;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    /**
     * Coerce a provider write result to a Promise.
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
    // The reconstruction is bounded by the entity's own schedule, so
    // the extra provider calls are cheap.
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
    //
    // READS DO NOT FALL BACK TO CURRENT WEEK.
    //   - If the week is invalid, they return empty.
    //   - Callers fetch window.data.currentWeek themselves.
    //
    // READS DO NOT ENRICH WITH DISPLAY NAMES.
    //   - Schedule entries carry disciplineId and instructorId.
    //   - Callers compose with AcademyDisciplines / CharacterQueries.

    /**
     * Get a student's raw schedule for a specific week.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number (required)
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
            return {};
        }

        return _calendarProvider.getStudentSchedule(studentId, weekNum);
    }

    /**
     * Get a student's classes for a specific week.
     *
     * SEMANTICS:
     *   Returns ONE entry per occupied slot. A multi-hour class appears
     *   as N entries, one per hour. Each entry carries:
     *     day, hour, disciplineId, duration, label, groupLabel, instructorId
     *   but NOT disciplineName or instructorName. Enrichment is the
     *   caller's concern.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number (required)
     * @returns {array} Array of class detail objects with raw IDs
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
            return [];
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
                var instructorId = metadata ? metadata.instructorId : null;

                classes.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: disciplineId,
                    duration: metadata && typeof metadata.duration === 'number' ? metadata.duration : 1,
                    label: metadata && typeof metadata.label === 'string' ? metadata.label : '',
                    groupLabel: metadata && typeof metadata.groupLabel === 'string' ? metadata.groupLabel : '',
                    instructorId: instructorId,
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
     * Returns the same shape as a single entry from getStudentClasses.
     * Does NOT enrich with display names.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number (required)
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
        var instructorId = metadata ? metadata.instructorId : null;

        return {
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            disciplineId: disciplineId,
            duration: metadata && typeof metadata.duration === 'number' ? metadata.duration : 1,
            label: metadata && typeof metadata.label === 'string' ? metadata.label : '',
            groupLabel: metadata && typeof metadata.groupLabel === 'string' ? metadata.groupLabel : '',
            instructorId: instructorId,
            isContinuation: false
        };
    }

    /**
     * Get weekly usage statistics for a student.
     *
     * Reads the raw schedule directly to avoid double-counting. A
     * class that spans three hours is one entry per hour in the raw
     * schedule, and each entry contributes exactly its slot to the
     * total. The previous version reconstructed this from
     * getStudentClasses, which returned per-hour entries too, but
     * summed duration again — a multi-hour class was counted twice.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number (required)
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
            return { total: 0, byDiscipline: {} };
        }

        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        var total = 0;
        var byDiscipline = {};

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
                if (!disciplineId) {
                    continue;
                }
                total += 1;
                if (!byDiscipline[disciplineId]) {
                    byDiscipline[disciplineId] = {
                        disciplineId: disciplineId,
                        hours: 0
                    };
                }
                byDiscipline[disciplineId].hours += 1;
            }
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
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, metadata) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not available.'));
        }

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

        // Check for conflicts before delegating.
        var schedule = _calendarProvider.getStudentSchedule(studentId, weekNum);
        if (_calendarProvider.hasConflict(schedule, dayNum, hourNum, durationNum)) {
            return Promise.resolve(failure('Student already has a class during this time.'));
        }

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

    function getStudentRestDays(studentId, week) {
        if (!checkDependencies()) {
            return [];
        }

        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        return _calendarProvider.getStudentRestDays(studentId, weekNum);
    }

    // ============================================================
    // REST DAYS - WRITES (Promise-based)
    // ============================================================

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

    function getClassDuration(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.duration : 1;
    }

    function getClassLabel(studentId, week, day, hour) {
        var details = getClassDetails(studentId, week, day, hour);
        return details ? details.label : '';
    }

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
     * no cross-slot transaction here.
     *
     * CONFLICT CHECKING:
     *   The conflict check for each slot reads the CURRENT schedule
     *   from the provider. Because writes are sequential, later
     *   slots in the same batch see the effects of earlier ones.
     *   That is the correct behavior for a batch that might include
     *   two slots for the same student.
     *
     * @param {array} slots - Array of slot objects
     * @param {object} options - Save options
     * @returns {Promise<{ success, data?, message? }>}
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

        // Sequential write chain. Each slot is applied via
        // setStudentScheduleClass, which reads the current schedule
        // from the provider for its conflict check. Because the
        // chain is sequential, later slots see earlier writes.
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

                var weekNum = parseWeek(slot.week);
                if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
                    errors.push({ index: item.index, error: 'Invalid week.' });
                    return;
                }

                var schedule = _calendarProvider.getStudentSchedule(slot.studentId, weekNum);
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
        MIN_CLASS_DURATION: MIN_CLASS_DURATION
    };

})();
