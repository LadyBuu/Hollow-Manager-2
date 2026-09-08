/**
 * js/modules/calendar/schedule-core.js - Schedule Core
 * SINGLE SOURCE OF TRUTH for all scheduling primitives and mutations
 * Path: js/modules/calendar/schedule-core.js
 * 
 * This module provides the CANONICAL scheduling operations:
 *   - Student schedule management (get/set/remove/clear)
 *   - Instructor schedule management (templates & blocks)
 *   - Location schedule management
 *   - Rest day management
 *   - Schedule query helpers
 *   - Conflict detection (duration-aware)
 *   - Class start resolution
 *   - Metadata management
 * 
 * MUTATION PHILOSOPHY:
 *   - All operations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false or { success: false })
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All validation uses CalendarValidation
 * 
 * PERSISTENCE CONTRACT:
 *   - This module updates window.data.curriculum in-memory
 *   - Caller is responsible for window.saveData()
 *   - No UI dependencies (notifications, modals, rendering)
 *   - No DOM access
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 * 
 * USAGE:
 *   var core = window.ScheduleCore;
 *   
 *   // Student operations
 *   core.setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata);
 *   core.removeStudentSlot(studentId, week, day, hour);
 *   core.clearStudentSchedule(studentId, week);
 *   core.getStudentSchedule(studentId, week);
 *   core.getStudentRestDays(studentId, week);
 *   core.setRestDays(studentId, week, [1, 3, 5]);
 *   
 *   // Instructor operations
 *   core.setInstructorTemplate(instructorId, week, day, hour, disciplineId, duration, label);
 *   core.removeInstructorTemplate(instructorId, week, day, hour);
 *   core.getInstructorTemplates(instructorId, week);
 *   core.setInstructorBlock(instructorId, week, day, hour, duration, label);
 *   core.removeInstructorBlock(instructorId, week, day, hour);
 *   core.getInstructorBlocks(instructorId, week);
 *   
 *   // Location operations
 *   core.setLocationClass(locationId, week, day, hour, disciplineId);
 *   core.removeLocationClass(locationId, week, day, hour);
 *   core.clearLocationSchedule(locationId, week);
 *   core.getLocationSchedule(locationId, week);
 *   
 *   // Queries
 *   core.hasConflict(schedule, day, hour, duration);
 *   core.isRestDay(restDays, day);
 *   core.findClassStart(schedule, metadata, studentId, week, day, hour);
 *   core.getSlotMetadata(studentId, week, day, hour);
 *   core.setSlotMetadata(studentId, week, day, hour, data);
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

    function getTemplateKey(instructorId, week, day, hour) {
        return String(instructorId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function getBlockKey(instructorId, week, day, hour) {
        return String(instructorId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
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
        if (!data) {
            return null;
        }
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            data.curriculum = {};
        }
        return data.curriculum;
    }

    function ensureCurriculumStructure() {
        var curriculum = getCurriculum();
        if (!curriculum) {
            return null;
        }

        if (!curriculum.schedules || typeof curriculum.schedules !== 'object') {
            curriculum.schedules = {};
        }
        if (!curriculum.restDays || typeof curriculum.restDays !== 'object') {
            curriculum.restDays = {};
        }
        if (!curriculum.metadata || typeof curriculum.metadata !== 'object') {
            curriculum.metadata = {};
        }
        if (!curriculum.instructorTemplates || typeof curriculum.instructorTemplates !== 'object') {
            curriculum.instructorTemplates = {};
        }
        if (!curriculum.instructorBlocks || typeof curriculum.instructorBlocks !== 'object') {
            curriculum.instructorBlocks = {};
        }
        if (!curriculum.locationSchedules || typeof curriculum.locationSchedules !== 'object') {
            curriculum.locationSchedules = {};
        }

        return curriculum;
    }

    // ============================================================
    // VALIDATION HELPERS
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

    function validateInstructorId(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return { valid: false, message: 'Instructor ID is required.' };
        }
        return { valid: true };
    }

    function validateLocationId(locationId) {
        if (!isNonEmptyString(locationId)) {
            return { valid: false, message: 'Location ID is required.' };
        }
        return { valid: true };
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
     * @param {object} metadata - Additional metadata (instructor, label, etc.)
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(curriculum.restDays);
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
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
        var curriculum = ensureCurriculumStructure();
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
            var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
            var metadata = (curriculum.metadata || {})[key] || {};
            durationNum = metadata.duration || 1;
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 5: REMOVE SLOT ----
        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            if (candidateSchedules[studentId][weekNum][dayNum] &&
                String(candidateSchedules[studentId][weekNum][dayNum][h]) === disciplineId) {
                delete candidateSchedules[studentId][weekNum][dayNum][h];
            }
        }

        // ---- PHASE 6: CLEAN UP ----
        if (candidateSchedules[studentId][weekNum][dayNum] &&
            Object.keys(candidateSchedules[studentId][weekNum][dayNum]).length === 0) {
            delete candidateSchedules[studentId][weekNum][dayNum];
        }

        // Remove metadata
        var removeKey = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        delete candidateMetadata[removeKey];

        // ---- PHASE 7: COMMIT ----
        curriculum.schedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(curriculum.restDays);
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        if (!curriculum.restDays || !curriculum.restDays[studentId] || !curriculum.restDays[studentId][weekNum]) {
            return success({ removed: false, message: 'No rest days for this week.' });
        }

        var candidateRestDays = deepClone(curriculum.restDays);
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
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

    /**
     * Find the class start hour for a given occupied hour.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour to check
     * @returns {object|null} { startHour, duration, disciplineId, key, metadata } or null
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

    // ============================================================
    // INSTRUCTOR SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get instructor templates for a specific week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @returns {object} Templates object { day_hour: { disciplineId, duration, label, assignedStudents } }
     */
    function getInstructorTemplates(instructorId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) {
            return {};
        }

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.instructorTemplates) {
            return {};
        }

        var templates = curriculum.instructorTemplates[instructorId];
        if (!templates || !templates[weekNum]) {
            return {};
        }

        return deepClone(templates[weekNum]) || {};
    }

    /**
     * Set an instructor template.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {string} disciplineId - Discipline ID
     * @param {number|string} duration - Duration in hours
     * @param {string} label - Optional label for the template
     * @param {array} assignedStudents - Optional array of student IDs
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setInstructorTemplate(instructorId, week, day, hour, disciplineId, duration, label, assignedStudents) {
        // ---- PHASE 1: VALIDATE ----
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var slotValidation = validateSlot(instructorId, week, day, hour, duration);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateTemplates = deepClone(curriculum.instructorTemplates);
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        // ---- PHASE 4: CREATE TEMPLATE STRUCTURE ----
        if (!candidateTemplates[instructorId]) {
            candidateTemplates[instructorId] = {};
        }
        if (!candidateTemplates[instructorId][weekNum]) {
            candidateTemplates[instructorId][weekNum] = {};
        }

        var weekTemplates = candidateTemplates[instructorId][weekNum];
        var key = getTemplateKey(instructorId, weekNum, dayNum, hourNum);

        // ---- PHASE 5: CHECK CONFLICT ----
        if (weekTemplates[key]) {
            return failure('Template already exists at this time.');
        }

        // ---- PHASE 6: APPLY ----
        weekTemplates[key] = {
            disciplineId: disciplineId,
            duration: durationNum,
            label: label || '',
            assignedStudents: Array.isArray(assignedStudents) ? assignedStudents.slice() : [],
            day: dayNum,
            hour: hourNum
        };

        // ---- PHASE 7: COMMIT ----
        curriculum.instructorTemplates = candidateTemplates;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            disciplineId: disciplineId,
            label: label || ''
        });
    }

    /**
     * Remove an instructor template.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeInstructorTemplate(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: CHECK EXISTS ----
        var templates = curriculum.instructorTemplates || {};
        if (!templates[instructorId] || !templates[instructorId][weekNum]) {
            return failure('No templates for this instructor and week.');
        }

        var key = getTemplateKey(instructorId, weekNum, dayNum, hourNum);
        if (!templates[instructorId][weekNum][key]) {
            return failure('No template at this time.');
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateTemplates = deepClone(curriculum.instructorTemplates);
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        // ---- PHASE 5: REMOVE ----
        delete candidateTemplates[instructorId][weekNum][key];

        // Clean up empty structures
        if (Object.keys(candidateTemplates[instructorId][weekNum]).length === 0) {
            delete candidateTemplates[instructorId][weekNum];
        }
        if (Object.keys(candidateTemplates[instructorId]).length === 0) {
            delete candidateTemplates[instructorId];
        }

        // ---- PHASE 6: COMMIT ----
        curriculum.instructorTemplates = candidateTemplates;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            removed: true
        });
    }

    // ============================================================
    // INSTRUCTOR BLOCK OPERATIONS
    // ============================================================

    /**
     * Get instructor blocks for a specific week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @returns {object} Blocks object { day: { hour: { duration, label } } }
     */
    function getInstructorBlocks(instructorId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) {
            return {};
        }

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.instructorBlocks) {
            return {};
        }

        var blocks = curriculum.instructorBlocks[instructorId];
        if (!blocks || !blocks[weekNum]) {
            return {};
        }

        return deepClone(blocks[weekNum]) || {};
    }

    /**
     * Set an instructor block.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @param {string} label - Optional label for the block
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setInstructorBlock(instructorId, week, day, hour, duration, label) {
        // ---- PHASE 1: VALIDATE ----
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var slotValidation = validateSlot(instructorId, week, day, hour, duration);
        if (!slotValidation.valid) {
            return failure(slotValidation.message);
        }

        var weekNum = slotValidation.week;
        var dayNum = slotValidation.day;
        var hourNum = slotValidation.hour;
        var durationNum = slotValidation.duration;

        // ---- PHASE 2: GET STORE ----
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateBlocks = deepClone(curriculum.instructorBlocks);
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        // ---- PHASE 4: CREATE BLOCK STRUCTURE ----
        if (!candidateBlocks[instructorId]) {
            candidateBlocks[instructorId] = {};
        }
        if (!candidateBlocks[instructorId][weekNum]) {
            candidateBlocks[instructorId][weekNum] = {};
        }
        if (!candidateBlocks[instructorId][weekNum][dayNum]) {
            candidateBlocks[instructorId][weekNum][dayNum] = {};
        }

        // ---- PHASE 5: CHECK CONFLICT ----
        if (candidateBlocks[instructorId][weekNum][dayNum][hourNum]) {
            return failure('Block already exists at this time.');
        }

        // ---- PHASE 6: APPLY ----
        candidateBlocks[instructorId][weekNum][dayNum][hourNum] = {
            duration: durationNum,
            label: label || 'Blocked'
        };

        // ---- PHASE 7: COMMIT ----
        curriculum.instructorBlocks = candidateBlocks;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || 'Blocked'
        });
    }

    /**
     * Remove an instructor block.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeInstructorBlock(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: CHECK EXISTS ----
        var blocks = curriculum.instructorBlocks || {};
        if (!blocks[instructorId] || !blocks[instructorId][weekNum] || !blocks[instructorId][weekNum][dayNum]) {
            return failure('No block at this time.');
        }

        if (!blocks[instructorId][weekNum][dayNum][hourNum]) {
            return failure('No block at this hour.');
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateBlocks = deepClone(curriculum.instructorBlocks);
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        // ---- PHASE 5: REMOVE ----
        delete candidateBlocks[instructorId][weekNum][dayNum][hourNum];

        // Clean up empty structures
        if (Object.keys(candidateBlocks[instructorId][weekNum][dayNum]).length === 0) {
            delete candidateBlocks[instructorId][weekNum][dayNum];
        }
        if (Object.keys(candidateBlocks[instructorId][weekNum]).length === 0) {
            delete candidateBlocks[instructorId][weekNum];
        }
        if (Object.keys(candidateBlocks[instructorId]).length === 0) {
            delete candidateBlocks[instructorId];
        }

        // ---- PHASE 6: COMMIT ----
        curriculum.instructorBlocks = candidateBlocks;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            removed: true
        });
    }

    // ============================================================
    // LOCATION SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get a location's schedule for a specific week.
     * 
     * @param {string} locationId - Location ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getLocationSchedule(locationId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(locationId)) {
            return {};
        }

        var curriculum = getCurriculum();
        if (!curriculum || !curriculum.locationSchedules) {
            return {};
        }

        var locationSchedule = curriculum.locationSchedules[locationId];
        if (!locationSchedule || !locationSchedule[weekNum]) {
            return {};
        }

        return deepClone(locationSchedule[weekNum]) || {};
    }

    /**
     * Set a location class slot.
     * 
     * @param {string} locationId - Location ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {string} disciplineId - Discipline ID
     * @param {number|string} duration - Duration in hours
     * @param {object} metadata - Additional metadata
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function setLocationClass(locationId, week, day, hour, disciplineId, duration, metadata) {
        // ---- PHASE 1: VALIDATE ----
        var locationValidation = validateLocationId(locationId);
        if (!locationValidation.valid) {
            return failure(locationValidation.message);
        }

        var slotValidation = validateSlot(locationId, week, day, hour, duration);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare location schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 4: CREATE SCHEDULE STRUCTURE ----
        if (!candidateSchedules[locationId]) {
            candidateSchedules[locationId] = {};
        }
        if (!candidateSchedules[locationId][weekNum]) {
            candidateSchedules[locationId][weekNum] = {};
        }

        var weekSchedule = candidateSchedules[locationId][weekNum];

        // ---- PHASE 5: CHECK CONFLICTS ----
        if (hasConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Location already has a class during this time.');
        }

        // ---- PHASE 6: APPLY CHANGES ----
        if (!weekSchedule[dayNum]) {
            weekSchedule[dayNum] = {};
        }

        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            weekSchedule[dayNum][h] = disciplineId;
        }

        // ---- PHASE 7: STORE METADATA ----
        var key = getScheduleKey(locationId, weekNum, dayNum, hourNum);
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

        candidateMetadata[key].duration = durationNum;

        // ---- PHASE 8: COMMIT ----
        curriculum.locationSchedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({
            locationId: locationId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            disciplineId: disciplineId
        });
    }

    /**
     * Remove a location class slot.
     * 
     * @param {string} locationId - Location ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Optional duration
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function removeLocationClass(locationId, week, day, hour, duration) {
        // ---- PHASE 1: VALIDATE ----
        var locationValidation = validateLocationId(locationId);
        if (!locationValidation.valid) {
            return failure(locationValidation.message);
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
        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: CHECK CLASS EXISTS ----
        var schedules = curriculum.locationSchedules || {};
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return failure('No schedule for this location and week.');
        }

        var weekSchedule = schedules[locationId][weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[dayNum][hourNum]);

        // Determine duration
        var durationNum = CalendarValidation.parseDuration(duration);
        if (durationNum === null) {
            var key = getScheduleKey(locationId, weekNum, dayNum, hourNum);
            var metadata = (curriculum.metadata || {})[key] || {};
            durationNum = metadata.duration || 1;
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare location schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // ---- PHASE 5: REMOVE SLOT ----
        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            if (candidateSchedules[locationId][weekNum][dayNum] &&
                String(candidateSchedules[locationId][weekNum][dayNum][h]) === disciplineId) {
                delete candidateSchedules[locationId][weekNum][dayNum][h];
            }
        }

        // ---- PHASE 6: CLEAN UP ----
        if (candidateSchedules[locationId][weekNum][dayNum] &&
            Object.keys(candidateSchedules[locationId][weekNum][dayNum]).length === 0) {
            delete candidateSchedules[locationId][weekNum][dayNum];
        }

        // Remove metadata
        var removeKey = getScheduleKey(locationId, weekNum, dayNum, hourNum);
        delete candidateMetadata[removeKey];

        // ---- PHASE 7: COMMIT ----
        curriculum.locationSchedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({
            locationId: locationId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            removed: true
        });
    }

    /**
     * Clear a location's entire schedule for a week.
     * 
     * @param {string} locationId - Location ID
     * @param {number|string} week - Week number
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function clearLocationSchedule(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var schedules = curriculum.locationSchedules || {};
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare location schedule data.');
        }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (candidateMetadata === null) {
            candidateMetadata = {};
        }

        // Remove schedule
        delete candidateSchedules[locationId][weekNum];

        // Remove metadata for this week
        var prefix = String(locationId) + '_' + String(weekNum) + '_';
        for (var key in candidateMetadata) {
            if (Object.prototype.hasOwnProperty.call(candidateMetadata, key) && key.indexOf(prefix) === 0) {
                delete candidateMetadata[key];
            }
        }

        curriculum.locationSchedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({ cleared: true, week: weekNum });
    }

    // ============================================================
    // COMPATIBILITY ALIASES (for migration from CalendarCore)
    // ============================================================

    // Alias for duplicateStudentSchedule - duplicates a student's schedule from one week to another
    function duplicateStudentSchedule(studentId, fromWeek, toWeek) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var fromWeekNum = CalendarValidation.parseWeek(fromWeek);
        var toWeekNum = CalendarValidation.parseWeek(toWeek);

        if (fromWeekNum === null || toWeekNum === null) {
            return failure('Valid weeks are required.');
        }

        var schedule = getStudentSchedule(studentId, fromWeekNum);
        if (!schedule || Object.keys(schedule).length === 0) {
            return failure('No schedule found for source week.');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        candidateSchedules[studentId][toWeekNum] = deepClone(schedule);

        curriculum.schedules = candidateSchedules;

        return success({
            studentId: studentId,
            fromWeek: fromWeekNum,
            toWeek: toWeekNum,
            duplicated: true
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleCore = {
        // ---- Validation ----
        validateSlot: validateSlot,
        validateRestDays: validateRestDays,
        validateOccupiedDuration: validateOccupiedDuration,

        // ---- Conflict Detection ----
        hasConflict: hasConflict,
        isRestDay: isRestDay,

        // ---- Student Operations ----
        getStudentSchedule: getStudentSchedule,
        setStudentSlot: setStudentSlot,
        removeStudentSlot: removeStudentSlot,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,

        // ---- Rest Day Operations ----
        getStudentRestDays: getStudentRestDays,
        setRestDays: setRestDays,
        removeRestDays: removeRestDays,

        // ---- Metadata Operations ----
        getSlotMetadata: getSlotMetadata,
        setSlotMetadata: setSlotMetadata,

        // ---- Class Start Resolution ----
        findClassStart: findClassStart,

        // ---- Instructor Operations ----
        getInstructorTemplates: getInstructorTemplates,
        setInstructorTemplate: setInstructorTemplate,
        removeInstructorTemplate: removeInstructorTemplate,
        getInstructorBlocks: getInstructorBlocks,
        setInstructorBlock: setInstructorBlock,
        removeInstructorBlock: removeInstructorBlock,

        // ---- Location Operations ----
        getLocationSchedule: getLocationSchedule,
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,
        clearLocationSchedule: clearLocationSchedule,

        // ---- Helpers ----
        getScheduleKey: getScheduleKey,

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
