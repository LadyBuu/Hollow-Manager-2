/**
 * js/modules/calendar/schedule-core.js - Schedule Core
 * Single source of truth for all scheduling primitives
 * Path: js/modules/calendar/schedule-core.js
 * 
 * This module provides the fundamental scheduling operations:
 *   - Student slot management (set/remove)
 *   - Rest day management
 *   - Schedule query helpers
 *   - Conflict detection
 *   - Duration-aware operations
 * 
 * IMPORTANT:
 *   - This is the CANONICAL source for all schedule mutations
 *   - All operations are candidate-based: validate, clone, modify, commit
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All validation uses CalendarValidation
 *   - No direct DOM or UI dependencies
 *   - PURE scheduling logic - no knowledge of students/instructors/locations
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 * 
 * USAGE:
 *   var core = window.ScheduleCore;
 *   var result = core.setStudentSlot(studentId, week, day, hour, disciplineId, duration);
 *   var restDays = core.getRestDays(studentId, week);
 *   var conflicts = core.hasConflict(schedule, day, hour, duration);
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__scheduleCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (missing.length > 0) {
        throw new Error('[ScheduleCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__scheduleCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
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
    // HELPERS
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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    // ============================================================
    // DATA STORE ACCESS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

    // ============================================================
    // SCHEDULE VALIDATION
    // ============================================================

    function validateSlot(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return { valid: false, message: 'Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').' };
        }

        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return { valid: false, message: 'Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').' };
        }

        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null || durationNum < MIN_CLASS_DURATION || durationNum > MAX_DURATION) {
            return { valid: false, message: 'Duration must be between ' + MIN_CLASS_DURATION + ' and ' + MAX_DURATION + ' hours.' };
        }

        if (hourNum + durationNum > MAX_HOUR + 1) {
            return { valid: false, message: 'Slot extends beyond the end of the day.' };
        }

        return {
            valid: true,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum
        };
    }

    function validateRestDays(studentId, week, days) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        if (!Array.isArray(days)) {
            return { valid: false, message: 'Rest days must be an array.' };
        }

        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = CalendarValidation.parseDay(days[i]);
            if (day === null || day < MIN_DAY || day > MAX_DAY) {
                return { valid: false, message: 'Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').' };
            }
            if (seen[day]) {
                return { valid: false, message: 'Duplicate rest day: ' + day };
            }
            seen[day] = true;
            validDays.push(day);
        }

        validDays.sort(function(a, b) { return a - b; });

        return {
            valid: true,
            week: weekNum,
            days: validDays
        };
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    /**
     * Check if a time slot has a conflict.
     * Duration-aware: checks all hours in the range.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour to check
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasConflict(schedule, day, hour, duration) {
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);
        var durationNum = CalendarValidation.parseDuration(duration);

        if (dayNum === null || hourNum === null || durationNum === null) {
            return true;
        }

        if (!schedule || !schedule[dayNum]) {
            return false;
        }

        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            if (schedule[dayNum][h]) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a day is a rest day.
     * 
     * @param {array} restDays - Array of rest day numbers
     * @param {number} day - Day number to check
     * @returns {boolean} True if the day is a rest day
     */
    function isRestDay(restDays, day) {
        if (!Array.isArray(restDays)) {
            return false;
        }
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return false;
        }
        return restDays.indexOf(dayNum) !== -1;
    }

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getStudentSchedule(studentId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(studentId)) {
            return {};
        }

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.schedules) {
            return {};
        }

        var studentSchedule = curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return {};
        }

        return deepClone(studentSchedule[weekNum]) || {};
    }

    /**
     * Get a student's rest days for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of rest day numbers
     */
    function getStudentRestDays(studentId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(studentId)) {
            return [];
        }

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.restDays) {
            return [];
        }

        if (!curriculum.restDays[studentId] || !curriculum.restDays[studentId][weekNum]) {
            return [];
        }

        return curriculum.restDays[studentId][weekNum].slice();
    }

    /**
     * Set a student's schedule slot.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {string} disciplineId - Discipline ID
     * @param {number|string} duration - Duration in hours
     * @param {string} metadata - Additional metadata (instructor, label, etc.)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata) {
        // ---- PHASE 1: VALIDATE ----
        var slotValidation = validateSlot(studentId, week, day, hour, duration);
        if (!slotValidation.valid) {
            return failure(slotValidation.message);
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var weekNum = slotValidation.week;
        var dayNum = slotValidation.day;
        var hourNum = slotValidation.hour;
        var durationNum = slotValidation.duration;

        // ---- PHASE 2: GET STORE ----
        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata || {});
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 4: CHECK REST DAYS ----
        var restDays = candidateRestDays[studentId] && candidateRestDays[studentId][weekNum]
            ? candidateRestDays[studentId][weekNum]
            : [];

        if (restDays.indexOf(dayNum) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // ---- PHASE 5: CREATE SCHEDULE STRUCTURE ----
        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }
        if (!candidateSchedules[studentId][weekNum]) {
            candidateSchedules[studentId][weekNum] = {};
        }

        var weekSchedule = candidateSchedules[studentId][weekNum];

        // ---- PHASE 6: CHECK CONFLICTS ----
        if (hasConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        // ---- PHASE 7: APPLY CHANGES ----
        if (!weekSchedule[dayNum]) {
            weekSchedule[dayNum] = {};
        }

        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            weekSchedule[dayNum][h] = disciplineId;
        }

        // ---- PHASE 8: STORE METADATA ----
        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        if (!candidateMetadata[key]) {
            candidateMetadata[key] = {};
        }

        if (metadata && typeof metadata === 'object') {
            for (var prop in metadata) {
                if (Object.prototype.hasOwnProperty.call(metadata, prop)) {
                    candidateMetadata[key][prop] = metadata[prop];
                }
            }
        }

        // Store duration in metadata
        candidateMetadata[key].duration = durationNum;

        // ---- PHASE 9: COMMIT ----
        curriculum.schedules = candidateSchedules;
        curriculum.restDays = candidateRestDays;
        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            disciplineId: disciplineId
        });
    }

    /**
     * Remove a student's schedule slot.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Optional duration (if not provided, uses metadata)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeStudentSlot(studentId, week, day, hour, duration) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }

        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        // ---- PHASE 2: GET STORE ----
        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: CHECK CLASS EXISTS ----
        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = schedules[studentId][weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[dayNum][hourNum]);

        // Determine duration - if not provided, check metadata
        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null) {
            // Try to get from metadata
            var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
            var metadata = (curriculum.metadata || {})[key] || {};
            durationNum = metadata.duration || 1;
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata || {});
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 5: FIND CLASS START ----
        var startHour = hourNum;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);
        var meta = candidateMetadata[key] || {};
        var foundDuration = meta.duration || 1;

        // If duration not provided, use the one from metadata
        if (durationNum === null || durationNum === 1) {
            durationNum = foundDuration;
        }

        // ---- PHASE 6: REMOVE SLOT ----
        for (var h = startHour; h < startHour + durationNum && h <= MAX_HOUR; h++) {
            if (candidateSchedules[studentId][weekNum][dayNum] &&
                String(candidateSchedules[studentId][weekNum][dayNum][h]) === disciplineId) {
                delete candidateSchedules[studentId][weekNum][dayNum][h];
            }
        }

        // ---- PHASE 7: CLEAN UP ----
        if (candidateSchedules[studentId][weekNum][dayNum] &&
            Object.keys(candidateSchedules[studentId][weekNum][dayNum]).length === 0) {
            delete candidateSchedules[studentId][weekNum][dayNum];
        }

        // Remove metadata
        var removeKey = getScheduleKey(studentId, weekNum, dayNum, startHour);
        delete candidateMetadata[removeKey];

        // ---- PHASE 8: COMMIT ----
        curriculum.schedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: startHour,
            duration: durationNum,
            removed: true
        });
    }

    /**
     * Clear a student's entire schedule for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata || {});
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // Remove schedule
        delete candidateSchedules[studentId][weekNum];

        // Remove metadata for this week
        var prefix = String(studentId) + '_' + String(weekNum) + '_';
        for (var key in candidateMetadata) {
            if (Object.prototype.hasOwnProperty.call(candidateMetadata, key) && key.indexOf(prefix) === 0) {
                delete candidateMetadata[key];
            }
        }

        // Remove rest days for this week
        if (curriculum.restDays && curriculum.restDays[studentId]) {
            delete curriculum.restDays[studentId][weekNum];
        }

        curriculum.schedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({ cleared: true, week: weekNum });
    }

    // ============================================================
    // REST DAY OPERATIONS
    // ============================================================

    /**
     * Set a student's rest days for a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {array} days - Array of day numbers (1-7)
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateRestDays(studentId, week, days);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validDays = validation.days;

        // ---- PHASE 2: GET STORE ----
        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata || {});
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 4: REMOVE CLASSES ON REST DAYS ----
        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var weekSchedule = candidateSchedules[studentId][weekNum];
            var prefix = String(studentId) + '_' + String(weekNum) + '_';

            for (var i = 0; i < validDays.length; i++) {
                var day = validDays[i];
                if (weekSchedule[day]) {
                    // Remove all classes on this day
                    for (var hour in weekSchedule[day]) {
                        if (Object.prototype.hasOwnProperty.call(weekSchedule[day], hour)) {
                            var hourNum = parseInt(hour, 10);
                            if (!isNaN(hourNum)) {
                                var key = getScheduleKey(studentId, weekNum, day, hourNum);
                                delete candidateMetadata[key];
                            }
                        }
                    }
                    delete weekSchedule[day];
                }
            }
        }

        // ---- PHASE 5: SET REST DAYS ----
        if (!candidateRestDays[studentId]) {
            candidateRestDays[studentId] = {};
        }
        candidateRestDays[studentId][weekNum] = validDays;

        // ---- PHASE 6: COMMIT ----
        curriculum.schedules = candidateSchedules;
        curriculum.restDays = candidateRestDays;
        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            days: validDays
        });
    }

    /**
     * Remove rest days for a student in a week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeRestDays(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        if (!curriculum.restDays || !curriculum.restDays[studentId] || !curriculum.restDays[studentId][weekNum]) {
            return success({ removed: false, message: 'No rest days for this week.' });
        }

        var candidateRestDays = deepClone(curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        delete candidateRestDays[studentId][weekNum];

        curriculum.restDays = candidateRestDays;

        return success({
            studentId: studentId,
            week: weekNum,
            removed: true
        });
    }

    // ============================================================
    // METADATA OPERATIONS
    // ============================================================

    /**
     * Get metadata for a specific slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object|null} Metadata object or null
     */
    function getSlotMetadata(studentId, week, day, hour) {
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

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.metadata) {
            return null;
        }

        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        var metadata = curriculum.metadata[key];

        if (!metadata) {
            return null;
        }

        return deepClone(metadata);
    }

    /**
     * Set metadata for a specific slot.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {object} data - Metadata data to set
     * @returns {object} { success: boolean, message?: string }
     */
    function setSlotMetadata(studentId, week, day, hour, data) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').');
        }

        var hourNum = CalendarValidation.parseHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').');
        }

        if (!data || typeof data !== 'object') {
            return failure('Metadata data is required.');
        }

        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var candidateMetadata = deepClone(curriculum.metadata || {});
        if (candidateMetadata === null) {
            return failure('Failed to prepare metadata data.');
        }

        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);

        if (!candidateMetadata[key]) {
            candidateMetadata[key] = {};
        }

        for (var prop in data) {
            if (Object.prototype.hasOwnProperty.call(data, prop)) {
                if (data[prop] === null || data[prop] === undefined) {
                    delete candidateMetadata[key][prop];
                } else {
                    candidateMetadata[key][prop] = data[prop];
                }
            }
        }

        // If no properties left, remove the key
        if (Object.keys(candidateMetadata[key]).length === 0) {
            delete candidateMetadata[key];
        }

        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            updated: true
        });
    }

    // ============================================================
    // CLASS START RESOLUTION
    // ============================================================

    /**
     * Find the class start hour for a given occupied hour.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour to check
     * @returns {object|null} { startHour, duration, disciplineId, key } or null
     */
    function findClassStart(schedule, metadata, studentId, week, day, hour) {
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);

        if (dayNum === null || hourNum === null || !schedule || !schedule[dayNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        if (!disciplineId) {
            return null;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        // Check if this hour itself has metadata
        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        var meta = metadata && metadata[key] ? metadata[key] : null;

        if (meta && meta.duration) {
            var duration = CalendarValidation.parseDuration(meta.duration);
            if (duration !== null) {
                // Verify the class is actually contiguous
                var actualDuration = validateOccupiedDuration(schedule, dayNum, hourNum, disciplineId);
                if (actualDuration !== null && duration === actualDuration) {
                    return {
                        startHour: hourNum,
                        duration: duration,
                        disciplineId: disciplineId,
                        key: key,
                        metadata: meta
                    };
                }
            }
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hourNum - 1; candidate >= 0; candidate--) {
            if (String(schedule[dayNum][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateKey = getScheduleKey(studentId, weekNum, dayNum, candidate);
            var candidateMeta = metadata && metadata[candidateKey] ? metadata[candidateKey] : null;

            if (candidateMeta && candidateMeta.duration) {
                var candidateDuration = CalendarValidation.parseDuration(candidateMeta.duration);
                if (candidateDuration !== null) {
                    var actualDuration = validateOccupiedDuration(schedule, dayNum, candidate, disciplineId);
                    if (actualDuration !== null && candidateDuration === actualDuration) {
                        if (hourNum < candidate + candidateDuration) {
                            return {
                                startHour: candidate,
                                duration: candidateDuration,
                                disciplineId: disciplineId,
                                key: candidateKey,
                                metadata: candidateMeta
                            };
                        }
                    }
                    break;
                }
            }
        }

        // No metadata found - use simple occupancy
        return {
            startHour: hourNum,
            duration: 1,
            disciplineId: disciplineId,
            key: key,
            metadata: null
        };
    }

    /**
     * Validate that occupied hours match the expected duration.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour
     * @param {string} disciplineId - Discipline ID
     * @returns {number|null} Actual duration or null if inconsistent
     */
    function validateOccupiedDuration(schedule, day, startHour, disciplineId) {
        var dayNum = CalendarValidation.parseDay(day);
        var startNum = CalendarValidation.parseHour(startHour);

        if (dayNum === null || startNum === null || !schedule || !schedule[dayNum]) {
            return null;
        }

        var duration = 0;

        for (var h = startNum; h <= MAX_HOUR; h++) {
            if (String(schedule[dayNum][h]) === String(disciplineId)) {
                duration++;
            } else {
                break;
            }
        }

        // Check that the class is contiguous - no gaps
        for (var h = startNum + duration; h <= Math.min(startNum + duration + MAX_DURATION, MAX_HOUR); h++) {
            if (String(schedule[dayNum][h]) === String(disciplineId)) {
                return null;
            }
        }

        return duration;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleCore = {
        // Validation
        validateSlot: validateSlot,
        validateRestDays: validateRestDays,

        // Conflict detection
        hasConflict: hasConflict,
        isRestDay: isRestDay,

        // Student schedule operations
        getStudentSchedule: getStudentSchedule,
        setStudentSlot: setStudentSlot,
        removeStudentSlot: removeStudentSlot,
        clearStudentSchedule: clearStudentSchedule,

        // Rest day operations
        getStudentRestDays: getStudentRestDays,
        setRestDays: setRestDays,
        removeRestDays: removeRestDays,

        // Metadata operations
        getSlotMetadata: getSlotMetadata,
        setSlotMetadata: setSlotMetadata,

        // Class start resolution
        findClassStart: findClassStart,
        validateOccupiedDuration: validateOccupiedDuration,

        // Helpers
        getScheduleKey: getScheduleKey,

        // Constants
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