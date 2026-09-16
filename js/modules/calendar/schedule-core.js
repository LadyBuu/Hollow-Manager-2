/**
 * modules/calendar/schedule-core.js - Schedule Core
 * SINGLE SOURCE OF TRUTH for scheduling primitives and mutations
 * 
 * IMPORTANT:
 *   - Mutates window.data.curriculum
 *   - Does NOT call saveData() - MutationUtils handles persistence
 *   - No UI dependencies
 *   - No external domain dependencies (Character, Academy, etc.)
 *   - Uses ObjectUtils for cloning
 *   - Uses CalendarValidation for validation
 * 
 * MUTATION CONTRACT:
 *   - All operations validate inputs
 *   - All operations use deepClone for candidates
 *   - All operations commit changes to window.data.curriculum
 *   - Caller owns persistence through MutationUtils
 * 
 * BLOCK TYPE VOCABULARY:
 *   Instructor blocks carry a `type` field. Valid values:
 *     'blocked'       — general unavailable time (default)
 *     'office_hours'  — student-facing availability
 *     'research'      — non-teaching work time
 *   Missing or invalid type on write defaults to 'blocked'. The
 *   read path (CalendarQueries.getInstructorBlocks) normalizes
 *   legacy records that predate the type field.
 * 
 * DUPLICATE SEMANTICS:
 *   duplicateInstructorSchedule and duplicateLocationSchedule
 *   OVERWRITE the target week. They do not merge. The caller is
 *   responsible for warning the user about overwriting existing
 *   data. Student schedule duplication is unchanged from the
 *   original duplicateStudentSchedule.
 * 
 * DEPENDENCIES:
 *   - ObjectUtils
 *   - CalendarConstants
 *   - CalendarValidation
 */

(function() {
    'use strict';

    if (window.__scheduleCoreLoaded) { return; }
    window.__scheduleCoreLoaded = true;

    var ObjectUtils = window.ObjectUtils;
    var CC = window.CalendarConstants;
    var CV = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    /**
     * Valid instructor block types. Extensible. If a future build
     * adds a type, extend this list and the read-path normalizer in
     * calendar-queries.js.
     */
    var VALID_BLOCK_TYPES = ['blocked', 'office_hours', 'research'];
    var DEFAULT_BLOCK_TYPE = 'blocked';

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function success(data) {
        return { success: true, data: data };
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function isValidBlockType(type) {
        return VALID_BLOCK_TYPES.indexOf(type) !== -1;
    }

    function normaliseBlockType(type) {
        if (typeof type !== 'string') { return DEFAULT_BLOCK_TYPE; }
        var trimmed = type.trim();
        if (isValidBlockType(trimmed)) { return trimmed; }
        return DEFAULT_BLOCK_TYPE;
    }

    function getCurriculum() {
        var data = window.data || {};
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            data.curriculum = {};
        }
        return data.curriculum;
    }

    function ensureCurriculumStructure() {
        var curriculum = getCurriculum();
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

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateSlot(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return { valid: false, message: 'Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').' };
        }

        var dayNum = CV.parseDay(day);
        if (dayNum === null || dayNum < CC.MIN_DAY || dayNum > CC.MAX_DAY) {
            return { valid: false, message: 'Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').' };
        }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null || hourNum < CC.MIN_HOUR || hourNum > CC.MAX_HOUR) {
            return { valid: false, message: 'Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').' };
        }

        var durationNum = CV.parseDuration(duration);
        if (durationNum === null || durationNum < CC.MIN_CLASS_DURATION || durationNum > CC.MAX_CLASS_DURATION) {
            return { valid: false, message: 'Duration must be between ' + CC.MIN_CLASS_DURATION + ' and ' + CC.MAX_CLASS_DURATION + ' hours.' };
        }

        if (hourNum + durationNum > CC.MAX_HOUR + 1) {
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

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return { valid: false, message: 'Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').' };
        }

        if (!Array.isArray(days)) {
            return { valid: false, message: 'Rest days must be an array.' };
        }

        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = CV.parseDay(days[i]);
            if (day === null || day < CC.MIN_DAY || day > CC.MAX_DAY) {
                return { valid: false, message: 'Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').' };
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

    function hasConflict(schedule, day, hour, duration) {
        var dayNum = CV.parseDay(day);
        var hourNum = CV.parseHour(hour);
        var durationNum = CV.parseDuration(duration);

        if (dayNum === null || hourNum === null || durationNum === null) { return true; }

        if (!schedule || !schedule[dayNum]) { return false; }

        for (var h = hourNum; h < hourNum + durationNum && h <= CC.MAX_HOUR; h++) {
            if (schedule[dayNum][h]) { return true; }
        }

        return false;
    }

    function isRestDay(restDays, day) {
        if (!Array.isArray(restDays)) { return false; }
        var dayNum = CV.parseDay(day);
        if (dayNum === null) { return false; }
        return restDays.indexOf(dayNum) !== -1;
    }

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS
    // ============================================================

    function setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata) {
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (!candidateSchedules) { return failure('Failed to prepare schedule data.'); }

        var candidateRestDays = deepClone(curriculum.restDays);
        if (!candidateRestDays) { return failure('Failed to prepare rest days data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        var restDays = candidateRestDays[studentId] && candidateRestDays[studentId][weekNum]
            ? candidateRestDays[studentId][weekNum]
            : [];

        if (restDays.indexOf(dayNum) !== -1) {
            return failure('This is a rest day for this student.');
        }

        if (!candidateSchedules[studentId]) { candidateSchedules[studentId] = {}; }
        if (!candidateSchedules[studentId][weekNum]) { candidateSchedules[studentId][weekNum] = {}; }

        var weekSchedule = candidateSchedules[studentId][weekNum];

        if (hasConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        if (!weekSchedule[dayNum]) { weekSchedule[dayNum] = {}; }

        for (var h = hourNum; h < hourNum + durationNum && h <= CC.MAX_HOUR; h++) {
            weekSchedule[dayNum][h] = disciplineId;
        }

        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        if (!candidateMetadata[key]) { candidateMetadata[key] = {}; }

        if (metadata && typeof metadata === 'object') {
            for (var prop in metadata) {
                if (Object.prototype.hasOwnProperty.call(metadata, prop)) {
                    candidateMetadata[key][prop] = metadata[prop];
                }
            }
        }
        candidateMetadata[key].duration = durationNum;

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

    function removeStudentSlot(studentId, week, day, hour, duration) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var dayNum = CV.parseDay(day);
        if (dayNum === null || dayNum < CC.MIN_DAY || dayNum > CC.MAX_DAY) {
            return failure('Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').');
        }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null || hourNum < CC.MIN_HOUR || hourNum > CC.MAX_HOUR) {
            return failure('Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = schedules[studentId][weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[dayNum][hourNum]);

        var durationNum = CV.parseDuration(duration);
        if (durationNum === null) {
            var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);
            var metadata = (curriculum.metadata || {})[key] || {};
            durationNum = metadata.duration || 1;
        }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (!candidateSchedules) { return failure('Failed to prepare schedule data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        for (var h = hourNum; h < hourNum + durationNum && h <= CC.MAX_HOUR; h++) {
            if (candidateSchedules[studentId][weekNum][dayNum] &&
                String(candidateSchedules[studentId][weekNum][dayNum][h]) === disciplineId) {
                delete candidateSchedules[studentId][weekNum][dayNum][h];
            }
        }

        if (candidateSchedules[studentId][weekNum][dayNum] &&
            Object.keys(candidateSchedules[studentId][weekNum][dayNum]).length === 0) {
            delete candidateSchedules[studentId][weekNum][dayNum];
        }

        var removeKey = getScheduleKey(studentId, weekNum, dayNum, hourNum);
        delete candidateMetadata[removeKey];

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

    function clearStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (!candidateSchedules) { return failure('Failed to prepare schedule data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        delete candidateSchedules[studentId][weekNum];

        var prefix = String(studentId) + '_' + String(weekNum) + '_';
        for (var key in candidateMetadata) {
            if (Object.prototype.hasOwnProperty.call(candidateMetadata, key) && key.indexOf(prefix) === 0) {
                delete candidateMetadata[key];
            }
        }

        if (curriculum.restDays && curriculum.restDays[studentId]) {
            delete curriculum.restDays[studentId][weekNum];
        }

        curriculum.schedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({ cleared: true, week: weekNum });
    }

    function duplicateStudentSchedule(studentId, fromWeek, toWeek) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var fromWeekNum = CV.parseWeek(fromWeek);
        var toWeekNum = CV.parseWeek(toWeek);

        if (fromWeekNum === null || toWeekNum === null) {
            return failure('Valid weeks are required.');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var schedules = curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][fromWeekNum]) {
            return failure('No schedule found for source week.');
        }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (!candidateSchedules) { return failure('Failed to prepare schedule data.'); }

        if (!candidateSchedules[studentId]) { candidateSchedules[studentId] = {}; }

        candidateSchedules[studentId][toWeekNum] = deepClone(schedules[studentId][fromWeekNum]);

        curriculum.schedules = candidateSchedules;

        return success({
            studentId: studentId,
            fromWeek: fromWeekNum,
            toWeek: toWeekNum,
            duplicated: true
        });
    }

    // ============================================================
    // REST DAY OPERATIONS
    // ============================================================

    function setRestDays(studentId, week, days) {
        var validation = validateRestDays(studentId, week, days);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validDays = validation.days;

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateSchedules = deepClone(curriculum.schedules);
        if (!candidateSchedules) { return failure('Failed to prepare schedule data.'); }

        var candidateRestDays = deepClone(curriculum.restDays);
        if (!candidateRestDays) { return failure('Failed to prepare rest days data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var weekSchedule = candidateSchedules[studentId][weekNum];

            for (var i = 0; i < validDays.length; i++) {
                var day = validDays[i];
                if (weekSchedule[day]) {
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

        if (!candidateRestDays[studentId]) { candidateRestDays[studentId] = {}; }
        candidateRestDays[studentId][weekNum] = validDays;

        curriculum.schedules = candidateSchedules;
        curriculum.restDays = candidateRestDays;
        curriculum.metadata = candidateMetadata;

        return success({
            studentId: studentId,
            week: weekNum,
            days: validDays
        });
    }

    function removeRestDays(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        if (!curriculum.restDays || !curriculum.restDays[studentId] || !curriculum.restDays[studentId][weekNum]) {
            return success({ removed: false, message: 'No rest days for this week.' });
        }

        var candidateRestDays = deepClone(curriculum.restDays);
        if (!candidateRestDays) { return failure('Failed to prepare rest days data.'); }

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

    function setSlotMetadata(studentId, week, day, hour, data) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null) { return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').'); }

        var dayNum = CV.parseDay(day);
        if (dayNum === null) { return failure('Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').'); }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null) { return failure('Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').'); }

        if (!data || typeof data !== 'object') {
            return failure('Metadata data is required.');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { return failure('Failed to prepare metadata data.'); }

        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);

        if (!candidateMetadata[key]) { candidateMetadata[key] = {}; }

        for (var prop in data) {
            if (Object.prototype.hasOwnProperty.call(data, prop)) {
                if (data[prop] === null || data[prop] === undefined) {
                    delete candidateMetadata[key][prop];
                } else {
                    candidateMetadata[key][prop] = data[prop];
                }
            }
        }

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
    // INSTRUCTOR OPERATIONS
    // ============================================================

    function setInstructorTemplate(instructorId, week, day, hour, disciplineId, duration, label, assignedStudents) {
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateTemplates = deepClone(curriculum.instructorTemplates);
        if (!candidateTemplates) { return failure('Failed to prepare template data.'); }

        if (!candidateTemplates[instructorId]) { candidateTemplates[instructorId] = {}; }
        if (!candidateTemplates[instructorId][weekNum]) { candidateTemplates[instructorId][weekNum] = {}; }

        var weekTemplates = candidateTemplates[instructorId][weekNum];
        var key = String(instructorId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);

        if (weekTemplates[key]) {
            return failure('Template already exists at this time.');
        }

        weekTemplates[key] = {
            disciplineId: disciplineId,
            duration: durationNum,
            label: label || '',
            assignedStudents: Array.isArray(assignedStudents) ? assignedStudents.slice() : [],
            day: dayNum,
            hour: hourNum
        };

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

    function removeInstructorTemplate(instructorId, week, day, hour) {
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var dayNum = CV.parseDay(day);
        if (dayNum === null || dayNum < CC.MIN_DAY || dayNum > CC.MAX_DAY) {
            return failure('Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').');
        }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null || hourNum < CC.MIN_HOUR || hourNum > CC.MAX_HOUR) {
            return failure('Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var templates = curriculum.instructorTemplates || {};
        if (!templates[instructorId] || !templates[instructorId][weekNum]) {
            return failure('No templates for this instructor and week.');
        }

        var key = String(instructorId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);
        if (!templates[instructorId][weekNum][key]) {
            return failure('No template at this time.');
        }

        var candidateTemplates = deepClone(curriculum.instructorTemplates);
        if (!candidateTemplates) { return failure('Failed to prepare template data.'); }

        delete candidateTemplates[instructorId][weekNum][key];

        if (Object.keys(candidateTemplates[instructorId][weekNum]).length === 0) {
            delete candidateTemplates[instructorId][weekNum];
        }
        if (Object.keys(candidateTemplates[instructorId]).length === 0) {
            delete candidateTemplates[instructorId];
        }

        curriculum.instructorTemplates = candidateTemplates;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            removed: true
        });
    }

    /**
     * Set an instructor block.
     *
     * @param {string} instructorId
     * @param {number|string} week
     * @param {number|string} day
     * @param {number|string} hour
     * @param {number|string} duration
     * @param {string} label
     * @param {string} [type] - 'blocked' | 'office_hours' | 'research'.
     *   Defaults to 'blocked' when absent or invalid.
     * @returns {object} { success, data?, message? }
     */
    function setInstructorBlock(instructorId, week, day, hour, duration, label, type) {
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var slotValidation = validateSlot(instructorId, week, day, hour, duration);
        if (!slotValidation.valid) {
            return failure(slotValidation.message);
        }

        var blockType = normaliseBlockType(type);

        var weekNum = slotValidation.week;
        var dayNum = slotValidation.day;
        var hourNum = slotValidation.hour;
        var durationNum = slotValidation.duration;

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateBlocks = deepClone(curriculum.instructorBlocks);
        if (!candidateBlocks) { return failure('Failed to prepare block data.'); }

        if (!candidateBlocks[instructorId]) { candidateBlocks[instructorId] = {}; }
        if (!candidateBlocks[instructorId][weekNum]) { candidateBlocks[instructorId][weekNum] = {}; }
        if (!candidateBlocks[instructorId][weekNum][dayNum]) { candidateBlocks[instructorId][weekNum][dayNum] = {}; }

        if (candidateBlocks[instructorId][weekNum][dayNum][hourNum]) {
            return failure('Block already exists at this time.');
        }

        candidateBlocks[instructorId][weekNum][dayNum][hourNum] = {
            duration: durationNum,
            label: label || '',
            type: blockType
        };

        curriculum.instructorBlocks = candidateBlocks;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || '',
            type: blockType
        });
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var dayNum = CV.parseDay(day);
        if (dayNum === null || dayNum < CC.MIN_DAY || dayNum > CC.MAX_DAY) {
            return failure('Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').');
        }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null || hourNum < CC.MIN_HOUR || hourNum > CC.MAX_HOUR) {
            return failure('Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var blocks = curriculum.instructorBlocks || {};
        if (!blocks[instructorId] || !blocks[instructorId][weekNum] || !blocks[instructorId][weekNum][dayNum]) {
            return failure('No block at this time.');
        }

        if (!blocks[instructorId][weekNum][dayNum][hourNum]) {
            return failure('No block at this hour.');
        }

        var candidateBlocks = deepClone(curriculum.instructorBlocks);
        if (!candidateBlocks) { return failure('Failed to prepare block data.'); }

        delete candidateBlocks[instructorId][weekNum][dayNum][hourNum];

        if (Object.keys(candidateBlocks[instructorId][weekNum][dayNum]).length === 0) {
            delete candidateBlocks[instructorId][weekNum][dayNum];
        }
        if (Object.keys(candidateBlocks[instructorId][weekNum]).length === 0) {
            delete candidateBlocks[instructorId][weekNum];
        }
        if (Object.keys(candidateBlocks[instructorId]).length === 0) {
            delete candidateBlocks[instructorId];
        }

        curriculum.instructorBlocks = candidateBlocks;

        return success({
            instructorId: instructorId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            removed: true
        });
    }

    /**
     * Duplicate an instructor's schedule from one week to another.
     *
     * Copies templates and (optionally) blocks. OVERWRITES the target
     * week — no merge. The caller is responsible for warning the user
     * when the target week already has data.
     *
     * @param {string} instructorId
     * @param {number|string} fromWeek
     * @param {number|string} toWeek
     * @param {object} [options] - { includeBlocks: boolean } (default true)
     * @returns {object} { success, data?, message? }
     */
    function duplicateInstructorSchedule(instructorId, fromWeek, toWeek, options) {
        var instructorValidation = validateInstructorId(instructorId);
        if (!instructorValidation.valid) {
            return failure(instructorValidation.message);
        }

        var fromWeekNum = CV.parseWeek(fromWeek);
        var toWeekNum = CV.parseWeek(toWeek);

        if (fromWeekNum === null || fromWeekNum < CC.MIN_WEEK || fromWeekNum > CC.MAX_WEEK) {
            return failure('Valid source week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }
        if (toWeekNum === null || toWeekNum < CC.MIN_WEEK || toWeekNum > CC.MAX_WEEK) {
            return failure('Valid target week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }
        if (fromWeekNum === toWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        options = options || {};
        var includeBlocks = options.includeBlocks !== false;

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        // ---- Templates ----
        var sourceTemplates = null;
        var templates = curriculum.instructorTemplates || {};
        if (templates[instructorId] && templates[instructorId][fromWeekNum]) {
            sourceTemplates = templates[instructorId][fromWeekNum];
        }

        var candidateTemplates = deepClone(curriculum.instructorTemplates);
        if (!candidateTemplates) { return failure('Failed to prepare template data.'); }

        if (sourceTemplates) {
            if (!candidateTemplates[instructorId]) { candidateTemplates[instructorId] = {}; }
            // Overwrite the target week completely.
            candidateTemplates[instructorId][toWeekNum] = deepClone(sourceTemplates);
        } else {
            // Source week has no templates. Clear the target week so the
            // operation is a faithful copy of "nothing".
            if (candidateTemplates[instructorId] && candidateTemplates[instructorId][toWeekNum]) {
                delete candidateTemplates[instructorId][toWeekNum];
            }
        }

        // ---- Blocks ----
        var candidateBlocks = deepClone(curriculum.instructorBlocks);
        if (!candidateBlocks) { return failure('Failed to prepare block data.'); }

        if (includeBlocks) {
            var sourceBlocks = null;
            var blocks = curriculum.instructorBlocks || {};
            if (blocks[instructorId] && blocks[instructorId][fromWeekNum]) {
                sourceBlocks = blocks[instructorId][fromWeekNum];
            }

            if (sourceBlocks) {
                if (!candidateBlocks[instructorId]) { candidateBlocks[instructorId] = {}; }
                candidateBlocks[instructorId][toWeekNum] = deepClone(sourceBlocks);
            } else {
                if (candidateBlocks[instructorId] && candidateBlocks[instructorId][toWeekNum]) {
                    delete candidateBlocks[instructorId][toWeekNum];
                }
            }
        }

        curriculum.instructorTemplates = candidateTemplates;
        curriculum.instructorBlocks = candidateBlocks;

        return success({
            instructorId: instructorId,
            fromWeek: fromWeekNum,
            toWeek: toWeekNum,
            includeBlocks: includeBlocks,
            duplicated: true
        });
    }

    // ============================================================
    // LOCATION OPERATIONS
    // ============================================================

    function setLocationClass(locationId, week, day, hour, disciplineId, duration, metadata) {
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

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (!candidateSchedules) { return failure('Failed to prepare location schedule data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        if (!candidateSchedules[locationId]) { candidateSchedules[locationId] = {}; }
        if (!candidateSchedules[locationId][weekNum]) { candidateSchedules[locationId][weekNum] = {}; }

        var weekSchedule = candidateSchedules[locationId][weekNum];

        if (hasConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Location already has a class during this time.');
        }

        if (!weekSchedule[dayNum]) { weekSchedule[dayNum] = {}; }

        for (var h = hourNum; h < hourNum + durationNum && h <= CC.MAX_HOUR; h++) {
            weekSchedule[dayNum][h] = disciplineId;
        }

        var key = getScheduleKey(locationId, weekNum, dayNum, hourNum);
        if (!candidateMetadata[key]) { candidateMetadata[key] = {}; }

        if (metadata && typeof metadata === 'object') {
            for (var prop in metadata) {
                if (Object.prototype.hasOwnProperty.call(metadata, prop)) {
                    candidateMetadata[key][prop] = metadata[prop];
                }
            }
        }
        candidateMetadata[key].duration = durationNum;

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

    function removeLocationClass(locationId, week, day, hour, duration) {
        var locationValidation = validateLocationId(locationId);
        if (!locationValidation.valid) {
            return failure(locationValidation.message);
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var dayNum = CV.parseDay(day);
        if (dayNum === null || dayNum < CC.MIN_DAY || dayNum > CC.MAX_DAY) {
            return failure('Valid day is required (' + CC.MIN_DAY + '-' + CC.MAX_DAY + ').');
        }

        var hourNum = CV.parseHour(hour);
        if (hourNum === null || hourNum < CC.MIN_HOUR || hourNum > CC.MAX_HOUR) {
            return failure('Valid hour is required (' + CC.MIN_HOUR + '-' + CC.MAX_HOUR + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var schedules = curriculum.locationSchedules || {};
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return failure('No schedule for this location and week.');
        }

        var weekSchedule = schedules[locationId][weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[dayNum][hourNum]);

        var durationNum = CV.parseDuration(duration);
        if (durationNum === null) {
            var key = getScheduleKey(locationId, weekNum, dayNum, hourNum);
            var metadata = (curriculum.metadata || {})[key] || {};
            durationNum = metadata.duration || 1;
        }

        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (!candidateSchedules) { return failure('Failed to prepare location schedule data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        for (var h = hourNum; h < hourNum + durationNum && h <= CC.MAX_HOUR; h++) {
            if (candidateSchedules[locationId][weekNum][dayNum] &&
                String(candidateSchedules[locationId][weekNum][dayNum][h]) === disciplineId) {
                delete candidateSchedules[locationId][weekNum][dayNum][h];
            }
        }

        if (candidateSchedules[locationId][weekNum][dayNum] &&
            Object.keys(candidateSchedules[locationId][weekNum][dayNum]).length === 0) {
            delete candidateSchedules[locationId][weekNum][dayNum];
        }

        var removeKey = getScheduleKey(locationId, weekNum, dayNum, hourNum);
        delete candidateMetadata[removeKey];

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

    function clearLocationSchedule(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var weekNum = CV.parseWeek(week);
        if (weekNum === null || weekNum < CC.MIN_WEEK || weekNum > CC.MAX_WEEK) {
            return failure('Valid week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        var schedules = curriculum.locationSchedules || {};
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (!candidateSchedules) { return failure('Failed to prepare location schedule data.'); }

        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        delete candidateSchedules[locationId][weekNum];

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

    /**
     * Duplicate a location's schedule from one week to another.
     *
     * Copies both the schedule cells and the associated metadata
     * entries (slot metadata is keyed by `<locationId>_<week>_<day>_<hour>`
     * and would otherwise dangle in the source week). OVERWRITES the
     * target week — no merge.
     *
     * @param {string} locationId
     * @param {number|string} fromWeek
     * @param {number|string} toWeek
     * @returns {object} { success, data?, message? }
     */
    function duplicateLocationSchedule(locationId, fromWeek, toWeek) {
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var fromWeekNum = CV.parseWeek(fromWeek);
        var toWeekNum = CV.parseWeek(toWeek);

        if (fromWeekNum === null || fromWeekNum < CC.MIN_WEEK || fromWeekNum > CC.MAX_WEEK) {
            return failure('Valid source week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }
        if (toWeekNum === null || toWeekNum < CC.MIN_WEEK || toWeekNum > CC.MAX_WEEK) {
            return failure('Valid target week is required (' + CC.MIN_WEEK + '-' + CC.MAX_WEEK + ').');
        }
        if (fromWeekNum === toWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        var curriculum = ensureCurriculumStructure();
        if (!curriculum) { return failure('Curriculum data is not available.'); }

        // ---- Schedule cells ----
        var sourceSchedule = null;
        var schedules = curriculum.locationSchedules || {};
        if (schedules[locationId] && schedules[locationId][fromWeekNum]) {
            sourceSchedule = schedules[locationId][fromWeekNum];
        }

        var candidateSchedules = deepClone(curriculum.locationSchedules);
        if (!candidateSchedules) { return failure('Failed to prepare location schedule data.'); }

        if (sourceSchedule) {
            if (!candidateSchedules[locationId]) { candidateSchedules[locationId] = {}; }
            candidateSchedules[locationId][toWeekNum] = deepClone(sourceSchedule);
        } else {
            if (candidateSchedules[locationId] && candidateSchedules[locationId][toWeekNum]) {
                delete candidateSchedules[locationId][toWeekNum];
            }
        }

        // ---- Metadata ----
        // Copy metadata entries whose key starts with
        // `<locationId>_<fromWeek>_`, re-keyed to the target week. Also
        // clear any target-week metadata that would otherwise dangle
        // over the overwritten cells.
        var candidateMetadata = deepClone(curriculum.metadata);
        if (!candidateMetadata) { candidateMetadata = {}; }

        var sourcePrefix = String(locationId) + '_' + String(fromWeekNum) + '_';
        var targetPrefix = String(locationId) + '_' + String(toWeekNum) + '_';

        // First, drop every target-week entry for this location. The
        // schedule cells are being replaced; stale metadata must not
        // survive.
        for (var key in candidateMetadata) {
            if (Object.prototype.hasOwnProperty.call(candidateMetadata, key) &&
                key.indexOf(targetPrefix) === 0) {
                delete candidateMetadata[key];
            }
        }

        // Then, copy source-week entries under the target prefix.
        for (var srcKey in candidateMetadata) {
            if (Object.prototype.hasOwnProperty.call(candidateMetadata, srcKey) &&
                srcKey.indexOf(sourcePrefix) === 0) {
                var suffix = srcKey.substring(sourcePrefix.length);
                var newKey = targetPrefix + suffix;
                candidateMetadata[newKey] = deepClone(candidateMetadata[srcKey]);
            }
        }

        curriculum.locationSchedules = candidateSchedules;
        curriculum.metadata = candidateMetadata;

        return success({
            locationId: locationId,
            fromWeek: fromWeekNum,
            toWeek: toWeekNum,
            duplicated: true
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleCore = {
        // Validation
        validateSlot: validateSlot,
        validateRestDays: validateRestDays,

        // Conflict
        hasConflict: hasConflict,
        isRestDay: isRestDay,

        // Student
        setStudentSlot: setStudentSlot,
        removeStudentSlot: removeStudentSlot,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,

        // Rest Days
        setRestDays: setRestDays,
        removeRestDays: removeRestDays,

        // Metadata
        setSlotMetadata: setSlotMetadata,

        // Instructor
        setInstructorTemplate: setInstructorTemplate,
        removeInstructorTemplate: removeInstructorTemplate,
        setInstructorBlock: setInstructorBlock,
        removeInstructorBlock: removeInstructorBlock,
        duplicateInstructorSchedule: duplicateInstructorSchedule,

        // Location
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,
        clearLocationSchedule: clearLocationSchedule,
        duplicateLocationSchedule: duplicateLocationSchedule,

        // Block type helpers (exposed for the view layer)
        VALID_BLOCK_TYPES: VALID_BLOCK_TYPES,
        DEFAULT_BLOCK_TYPE: DEFAULT_BLOCK_TYPE,
        isValidBlockType: isValidBlockType,
        normaliseBlockType: normaliseBlockType,

        // Constants
        MIN_WEEK: CC.MIN_WEEK,
        MAX_WEEK: CC.MAX_WEEK,
        MIN_DAY: CC.MIN_DAY,
        MAX_DAY: CC.MAX_DAY,
        MIN_HOUR: CC.MIN_HOUR,
        MAX_HOUR: CC.MAX_HOUR,
        CALENDAR_START_HOUR: CC.CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CC.CALENDAR_END_HOUR,
        MAX_DURATION: CC.MAX_CLASS_DURATION,
        MIN_CLASS_DURATION: CC.MIN_CLASS_DURATION
    };

})();
