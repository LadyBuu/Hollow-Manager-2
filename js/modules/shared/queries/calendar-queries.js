/**
 * shared/queries/calendar-queries.js - Calendar Queries
 * Read-only calendar/schedule queries
 * 
 * This module provides READ-ONLY access to all calendar/schedule data:
 *   - Student schedules
 *   - Student rest days
 *   - Slot metadata
 *   - Instructor templates and blocks
 *   - Location schedules
 *   - Conflict detection
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - NO dependencies on ScheduleCore
 *   - NO dependencies on MutationUtils
 *   - NO UI dependencies
 *   - Reads window.data.curriculum directly
 *   - Uses lazy loading for CalendarConstants
 *   - All methods return defensive copies where appropriate
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.data (canonical state)
 *   - window.CalendarConstants (for bounds)
 *   - window.DisciplineQueries (for discipline names)
 *   - window.CharacterQueries (for instructor names)
 */

(function() {
    'use strict';

    if (window.__calendarQueriesLoaded) {
        return;
    }
    window.__calendarQueriesLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // GET CONSTANTS - Lazy loaded from CalendarConstants
    // ============================================================

    function getConstants() {
        var CC = getCalendarConstants();
        if (CC) {
            return {
                MIN_WEEK: CC.MIN_WEEK || 1,
                MAX_WEEK: CC.MAX_WEEK || 52,
                MIN_DAY: CC.MIN_DAY || 1,
                MAX_DAY: CC.MAX_DAY || 7,
                MIN_HOUR: CC.MIN_HOUR || 0,
                MAX_HOUR: CC.MAX_HOUR || 23,
                CALENDAR_START_HOUR: CC.CALENDAR_START_HOUR || 5,
                CALENDAR_END_HOUR: CC.CALENDAR_END_HOUR || 23,
                MIN_CLASS_DURATION: CC.MIN_CLASS_DURATION || 1,
                MAX_CLASS_DURATION: CC.MAX_CLASS_DURATION || 4
            };
        }
        return {
            MIN_WEEK: 1,
            MAX_WEEK: 52,
            MIN_DAY: 1,
            MAX_DAY: 7,
            MIN_HOUR: 0,
            MAX_HOUR: 23,
            CALENDAR_START_HOUR: 5,
            CALENDAR_END_HOUR: 23,
            MIN_CLASS_DURATION: 1,
            MAX_CLASS_DURATION: 4
        };
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CalendarConstants is optional - we use lazy loading
        if (!getCalendarConstants()) {
            missing.push('CalendarConstants (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[CalendarQueries] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurriculum() {
        var data = window.data || {};
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return {};
        }
        return data.curriculum;
    }

    function getScheduleData() {
        var curriculum = getCurriculum();
        return curriculum.schedules || {};
    }

    function getRestDaysData() {
        var curriculum = getCurriculum();
        return curriculum.restDays || {};
    }

    function getMetadataData() {
        var curriculum = getCurriculum();
        return curriculum.metadata || {};
    }

    function getInstructorTemplatesData() {
        var curriculum = getCurriculum();
        return curriculum.instructorTemplates || {};
    }

    function getInstructorBlocksData() {
        var curriculum = getCurriculum();
        return curriculum.instructorBlocks || {};
    }

    function getLocationSchedulesData() {
        var curriculum = getCurriculum();
        return curriculum.locationSchedules || {};
    }

    function isValidWeek(week) {
        var constants = getConstants();
        var num = parseInt(week, 10);
        return !isNaN(num) && num >= constants.MIN_WEEK && num <= constants.MAX_WEEK ? num : null;
    }

    function isValidDay(day) {
        var constants = getConstants();
        var num = parseInt(day, 10);
        return !isNaN(num) && num >= constants.MIN_DAY && num <= constants.MAX_DAY ? num : null;
    }

    function isValidHour(hour) {
        var constants = getConstants();
        var num = parseInt(hour, 10);
        return !isNaN(num) && num >= constants.MIN_HOUR && num <= constants.MAX_HOUR ? num : null;
    }

    function isValidDuration(duration) {
        var constants = getConstants();
        var num = parseInt(duration, 10);
        return !isNaN(num) && num >= constants.MIN_CLASS_DURATION && num <= constants.MAX_CLASS_DURATION ? num : null;
    }

    function getDisciplineName(disciplineId) {
        if (!disciplineId) {
            return 'Unknown';
        }
        var DisciplineQueries = getDisciplineQueries();
        if (DisciplineQueries && typeof DisciplineQueries.getDiscipline === 'function') {
            var discipline = DisciplineQueries.getDiscipline(disciplineId);
            if (discipline) {
                return discipline.name || 'Unknown';
            }
        }
        return 'Unknown';
    }

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return '';
        }
        var CharacterQueries = getCharacterQueries();
        if (CharacterQueries && typeof CharacterQueries.getCharacterNameById === 'function') {
            return CharacterQueries.getCharacterNameById(charId);
        }
        if (CharacterQueries && typeof CharacterQueries.getDisplayName === 'function') {
            var char = CharacterQueries.getCharacterById(charId);
            return char ? CharacterQueries.getDisplayName(char) : '';
        }
        return '';
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (_) {}
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    // ============================================================
    // STUDENT SCHEDULE QUERIES
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getStudentSchedule(studentId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !studentId) {
            return {};
        }

        var schedules = getScheduleData();
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return {};
        }

        return deepClone(schedules[studentId][weekNum]);
    }

    /**
     * Get a student's rest days for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of rest day numbers
     */
    function getStudentRestDays(studentId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !studentId) {
            return [];
        }

        var restDays = getRestDaysData();
        if (!restDays[studentId] || !restDays[studentId][weekNum]) {
            return [];
        }

        return deepClone(restDays[studentId][weekNum]);
    }

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
        var weekNum = isValidWeek(week);
        var dayNum = isValidDay(day);
        var hourNum = isValidHour(hour);

        if (weekNum === null || weekNum === undefined || isNaN(weekNum) ||
            dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            !studentId) {
            return null;
        }

        var metadata = getMetadataData();
        var key = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);
        return metadata[key] ? deepClone(metadata[key]) : null;
    }

    /**
     * Get a student's classes for a specific week (with details).
     * 
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {array} Array of class detail objects
     */
    function getStudentClasses(studentId, week) {
        var schedule = getStudentSchedule(studentId, week);
        var restDays = getStudentRestDays(studentId, week);
        var weekNum = isValidWeek(week) || 1;
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
            if (Array.isArray(restDays)) {
                for (var r = 0; r < restDays.length; r++) {
                    if (restDays[r] === dayNum) {
                        isRestDay = true;
                        break;
                    }
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

                var metadata = getSlotMetadata(studentId, weekNum, dayNum, hourNum);
                var disciplineName = getDisciplineName(disciplineId);
                var instructorId = metadata ? metadata.instructorId : null;
                var instructorName = instructorId ? getCharacterDisplayName(instructorId) : '';

                classes.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: disciplineId,
                    disciplineName: disciplineName,
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

    // ============================================================
    // INSTRUCTOR SCHEDULE QUERIES
    // ============================================================

    /**
     * Get instructor templates for a specific week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @returns {object} Templates object
     */
    function getInstructorTemplates(instructorId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !instructorId) {
            return {};
        }

        var templates = getInstructorTemplatesData();
        if (!templates[instructorId] || !templates[instructorId][weekNum]) {
            return {};
        }

        return deepClone(templates[instructorId][weekNum]);
    }

    /**
     * Get instructor blocks for a specific week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @returns {object} Blocks object
     */
    function getInstructorBlocks(instructorId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !instructorId) {
            return {};
        }

        var blocks = getInstructorBlocksData();
        if (!blocks[instructorId] || !blocks[instructorId][weekNum]) {
            return {};
        }

        return deepClone(blocks[instructorId][weekNum]);
    }

    /**
     * Get instructor schedule (templates + blocks) for a specific week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object with templates and blocks
     */
    function getInstructorSchedule(instructorId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !instructorId) {
            return {};
        }

        var templates = getInstructorTemplates(instructorId, weekNum);
        var blocks = getInstructorBlocks(instructorId, weekNum);
        var result = {};

        // Merge templates and blocks
        var allKeys = {};
        for (var key in templates) {
            if (Object.prototype.hasOwnProperty.call(templates, key)) {
                allKeys[key] = true;
            }
        }
        for (var key in blocks) {
            if (Object.prototype.hasOwnProperty.call(blocks, key)) {
                allKeys[key] = true;
            }
        }

        for (var key in allKeys) {
            if (Object.prototype.hasOwnProperty.call(allKeys, key)) {
                var parts = key.split('_');
                if (parts.length >= 4) {
                    var dayNum = parseInt(parts[2], 10);
                    var hourNum = parseInt(parts[3], 10);
                    if (!isNaN(dayNum) && !isNaN(hourNum)) {
                        if (!result[dayNum]) {
                            result[dayNum] = {};
                        }
                        result[dayNum][hourNum] = {
                            template: templates[key] || null,
                            block: blocks[key] || null,
                            isTemplate: !!templates[key],
                            isBlock: !!blocks[key]
                        };
                    }
                }
            }
        }

        return result;
    }

    // ============================================================
    // LOCATION SCHEDULE QUERIES
    // ============================================================

    /**
     * Get location schedule for a specific week.
     * 
     * @param {string} locationId - Location ID
     * @param {number|string} week - Week number
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getLocationSchedule(locationId, week) {
        var weekNum = isValidWeek(week);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !locationId) {
            return {};
        }

        var schedules = getLocationSchedulesData();
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return {};
        }

        return deepClone(schedules[locationId][weekNum]);
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    /**
     * Check if a schedule has a conflict at a specific time.
     * 
     * @param {object} schedule - Schedule object
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @param {number|string} duration - Duration in hours
     * @returns {boolean} True if there is a conflict
     */
    function hasConflict(schedule, day, hour, duration) {
        var constants = getConstants();
        var dayNum = isValidDay(day);
        var hourNum = isValidHour(hour);
        var durationNum = isValidDuration(duration);

        if (dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            durationNum === null || durationNum === undefined || isNaN(durationNum)) {
            return true;
        }

        if (!schedule || !schedule[dayNum]) {
            return false;
        }

        var maxHour = Math.min(hourNum + durationNum, constants.MAX_HOUR + 1);
        for (var h = hourNum; h < maxHour; h++) {
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
     * @param {number|string} day - Day number (1-7)
     * @returns {boolean} True if the day is a rest day
     */
    function isRestDay(restDays, day) {
        if (!Array.isArray(restDays)) {
            return false;
        }
        var dayNum = isValidDay(day);
        if (dayNum === null || dayNum === undefined || isNaN(dayNum)) {
            return false;
        }
        for (var i = 0; i < restDays.length; i++) {
            if (restDays[i] === dayNum) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find the start of a class that may span multiple hours.
     * 
     * @param {object} schedule - Schedule object
     * @param {object} metadata - Metadata object
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number
     * @returns {object|null} Class start info or null
     */
    function findClassStart(schedule, metadata, studentId, week, day, hour) {
        var constants = getConstants();
        var dayNum = isValidDay(day);
        var hourNum = isValidHour(hour);
        var weekNum = isValidWeek(week);

        if (dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            weekNum === null || weekNum === undefined || isNaN(weekNum) ||
            !schedule || !schedule[dayNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        if (!disciplineId) {
            return null;
        }

        var key = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);
        var meta = metadata && metadata[key] ? metadata[key] : null;

        if (meta && meta.duration) {
            var duration = isValidDuration(meta.duration);
            if (duration !== null && duration !== undefined && !isNaN(duration)) {
                var actualDuration = 1;
                for (var h = hourNum + 1; h < hourNum + duration && h <= constants.MAX_HOUR; h++) {
                    if (String(schedule[dayNum][h]) === String(disciplineId)) {
                        actualDuration++;
                    } else {
                        break;
                    }
                }
                if (duration === actualDuration) {
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

            var candidateKey = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(candidate);
            var candidateMeta = metadata && metadata[candidateKey] ? metadata[candidateKey] : null;

            if (candidateMeta && candidateMeta.duration) {
                var candidateDuration = isValidDuration(candidateMeta.duration);
                if (candidateDuration !== null && candidateDuration !== undefined && !isNaN(candidateDuration)) {
                    var actualDuration = 1;
                    for (var h2 = candidate + 1; h2 < candidate + candidateDuration && h2 <= constants.MAX_HOUR; h2++) {
                        if (String(schedule[dayNum][h2]) === String(disciplineId)) {
                            actualDuration++;
                        } else {
                            break;
                        }
                    }
                    if (actualDuration === candidateDuration) {
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

        return {
            startHour: hourNum,
            duration: 1,
            disciplineId: disciplineId,
            key: key,
            metadata: null
        };
    }

    // ============================================================
    // AVAILABILITY HELPERS
    // ============================================================

    /**
     * Get available hours for a schedule on a specific day.
     * 
     * @param {object} schedule - Schedule object
     * @param {number|string} day - Day number (1-7)
     * @param {number} duration - Duration in hours
     * @param {number} startHour - Start hour (default: CALENDAR_START_HOUR)
     * @param {number} endHour - End hour (default: CALENDAR_END_HOUR)
     * @returns {array} Array of available start hours
     */
    function getAvailableStartHours(schedule, day, duration, startHour, endHour) {
        var constants = getConstants();
        var dayNum = isValidDay(day);
        var durationNum = isValidDuration(duration);

        if (dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            durationNum === null || durationNum === undefined || isNaN(durationNum)) {
            return [];
        }

        startHour = startHour !== undefined ? isValidHour(startHour) : constants.CALENDAR_START_HOUR;
        endHour = endHour !== undefined ? isValidHour(endHour) : constants.CALENDAR_END_HOUR;

        if (startHour === null || startHour === undefined || isNaN(startHour) ||
            endHour === null || endHour === undefined || isNaN(endHour) ||
            startHour > endHour) {
            return [];
        }

        var available = [];

        if (!schedule || !schedule[dayNum]) {
            for (var h = startHour; h <= endHour - durationNum + 1; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour - durationNum + 1; h++) {
            var hasConflict = false;
            for (var d = 0; d < durationNum; d++) {
                if (schedule[dayNum][h + d]) {
                    hasConflict = true;
                    break;
                }
            }
            if (!hasConflict) {
                available.push(h);
            }
        }

        return available;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarQueries = {
        // ---- Student ----
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        getSlotMetadata: getSlotMetadata,
        getStudentClasses: getStudentClasses,

        // ---- Instructor ----
        getInstructorTemplates: getInstructorTemplates,
        getInstructorBlocks: getInstructorBlocks,
        getInstructorSchedule: getInstructorSchedule,

        // ---- Location ----
        getLocationSchedule: getLocationSchedule,

        // ---- Conflict ----
        hasConflict: hasConflict,
        isRestDay: isRestDay,
        findClassStart: findClassStart,

        // ---- Availability ----
        getAvailableStartHours: getAvailableStartHours,

        // ---- Helpers ----
        isValidWeek: isValidWeek,
        isValidDay: isValidDay,
        isValidHour: isValidHour,
        isValidDuration: isValidDuration,

        // ---- Constants (lazy loaded) ----
        get MIN_WEEK() {
            var constants = getConstants();
            return constants.MIN_WEEK;
        },
        get MAX_WEEK() {
            var constants = getConstants();
            return constants.MAX_WEEK;
        },
        get MIN_DAY() {
            var constants = getConstants();
            return constants.MIN_DAY;
        },
        get MAX_DAY() {
            var constants = getConstants();
            return constants.MAX_DAY;
        },
        get MIN_HOUR() {
            var constants = getConstants();
            return constants.MIN_HOUR;
        },
        get MAX_HOUR() {
            var constants = getConstants();
            return constants.MAX_HOUR;
        },
        get CALENDAR_START_HOUR() {
            var constants = getConstants();
            return constants.CALENDAR_START_HOUR;
        },
        get CALENDAR_END_HOUR() {
            var constants = getConstants();
            return constants.CALENDAR_END_HOUR;
        },
        get MIN_CLASS_DURATION() {
            var constants = getConstants();
            return constants.MIN_CLASS_DURATION;
        },
        get MAX_CLASS_DURATION() {
            var constants = getConstants();
            return constants.MAX_CLASS_DURATION;
        }
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CalendarQueries;
        var missing = [];

        var required = [
            'getStudentSchedule',
            'getStudentRestDays',
            'getSlotMetadata',
            'getStudentClasses',
            'getInstructorTemplates',
            'getInstructorBlocks',
            'getInstructorSchedule',
            'getLocationSchedule',
            'hasConflict',
            'isRestDay',
            'findClassStart',
            'getAvailableStartHours',
            'isValidWeek',
            'isValidDay',
            'isValidHour',
            'isValidDuration'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Check computed properties
        var computedProps = ['MIN_WEEK', 'MAX_WEEK', 'MIN_DAY', 'MAX_DAY', 'MIN_HOUR', 'MAX_HOUR'];
        for (var j = 0; j < computedProps.length; j++) {
            if (typeof exports[computedProps[j]] === 'undefined') {
                missing.push(computedProps[j] + ' (computed)');
            }
        }

        if (missing.length > 0) {
            console.warn('[CalendarQueries] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CalendarQueries] All exports verified successfully.');
        }
    })();

})();
