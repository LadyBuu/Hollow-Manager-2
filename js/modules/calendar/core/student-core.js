/**
 * js/modules/calendar/core/student-core.js - Student Calendar Core
 * Student schedule operations for the calendar system
 * Path: js/modules/calendar/core/student-core.js
 * 
 * This module handles:
 *   - Student schedule CRUD operations
 *   - Student rest day management
 *   - Schedule duplication
 *   - Schedule clearing
 * 
 * IMPORTANT:
 *   - All mutations use copy-before-commit candidate semantics
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone (MANDATORY)
 *   - All ID normalisation is consistent
 *   - Student schedules are the canonical source of truth for student calendar
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.CalendarMetadataCore (from metadata-core.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var SC = window.CalendarStudentCore;
 *   var result = SC.setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration);
 *   if (result.success) { console.log('Class added'); }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarStudentCoreLoaded) {
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

    if (!window.CalendarScheduleCore) {
        missing.push('CalendarScheduleCore');
    }

    if (!window.CalendarMetadataCore) {
        missing.push('CalendarMetadataCore');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (missing.length > 0) {
        console.error('[CalendarStudentCore] Missing dependencies:', missing.join(', '));
        return;
    }

    window.__calendarStudentCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var CalendarConstants = window.CalendarConstants;
    var ScheduleCore = window.CalendarScheduleCore;
    var MetadataCore = window.CalendarMetadataCore;
    var DisciplineQueries = window.DisciplineQueries;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

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

    function normaliseId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    function validateWeek(value) {
        var num = parseInteger(value);
        if (num === null || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    function validateDay(value) {
        var num = parseInteger(value);
        if (num === null || num < MIN_DAY || num > MAX_DAY) {
            return null;
        }
        return num;
    }

    function validateHour(value) {
        var num = parseInteger(value);
        if (num === null || num < MIN_HOUR || num > MAX_HOUR) {
            return null;
        }
        return num;
    }

    function validateDuration(value) {
        var num = parseInteger(value);
        if (num === null || num < 1 || num > MAX_DURATION) {
            return null;
        }
        return num;
    }

    function validateScheduleSlot(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { success: false, message: 'Valid day is required (1-7).' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { success: false, message: 'Valid hour is required (0-23).' };
        }

        return {
            success: true,
            data: {
                studentId: String(studentId).trim(),
                week: weekNum,
                day: dayNum,
                hour: hourNum
            }
        };
    }

    function validateCurriculumStructure(data) {
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return { success: false, message: 'Curriculum data is not available.' };
        }

        if (data.curriculum.schedules !== undefined && !isObject(data.curriculum.schedules)) {
            return { success: false, message: 'Schedule data is corrupted.' };
        }

        if (data.curriculum.restDays !== undefined && !isObject(data.curriculum.restDays)) {
            return { success: false, message: 'Rest days data is corrupted.' };
        }

        return { success: true, data: data };
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * Returns a cloned copy to prevent external mutation.
     */
    function getStudentSchedule(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = window.data;
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return {};
        }

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return {};
        }

        return deepClone(studentSchedule[weekNum]) || {};
    }

    /**
     * Set a student's schedule class.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        var normalisedDisciplineId = normaliseId(disciplineId);
        if (normalisedDisciplineId === null) {
            return failure('Discipline ID is required.');
        }

        var discipline = DisciplineQueries.getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and ' + MAX_DURATION + ' hours.');
        }

        if (validated.hour + durationNum > MAX_HOUR + 1) {
            return failure('Class duration extends beyond the end of the day.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = MetadataCore.buildCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        if (!candidateSchedules[validated.studentId]) {
            candidateSchedules[validated.studentId] = {};
        }
        if (!candidateSchedules[validated.studentId][validated.week]) {
            candidateSchedules[validated.studentId][validated.week] = {};
        }

        var weekSchedule = candidateSchedules[validated.studentId][validated.week];
        var dayNum = validated.day;
        var hourNum = validated.hour;

        // Check for conflicts
        if (ScheduleCore.hasConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        // Check rest days
        var restDays = candidateRestDays[validated.studentId] && candidateRestDays[validated.studentId][validated.week]
            ? candidateRestDays[validated.studentId][validated.week]
            : [];

        if (restDays.indexOf(dayNum) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // Check weekly hour limit
        var usedHours = {};
        for (var d in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, d)) {
                continue;
            }
            var daySchedule = weekSchedule[d];
            if (!isObject(daySchedule)) {
                continue;
            }
            for (var h in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, h)) {
                    continue;
                }
                var discId = daySchedule[h];
                if (discId) {
                    if (!usedHours[discId]) {
                        usedHours[discId] = 0;
                    }
                    usedHours[discId]++;
                }
            }
        }

        var usedCount = usedHours[normalisedDisciplineId] || 0;
        var maxHours = discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;
        if (usedCount + durationNum > maxHours) {
            return failure('This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATES ----
        if (!weekSchedule[dayNum]) {
            weekSchedule[dayNum] = {};
        }

        var key = ScheduleCore.getScheduleKey(validated.studentId, validated.week, dayNum, hourNum);

        for (var h = hourNum; h < hourNum + durationNum && h <= MAX_HOUR; h++) {
            weekSchedule[dayNum][h] = normalisedDisciplineId;
        }

        // Set metadata
        MetadataCore.setClassMetadata(metadataCandidates, key, {
            duration: durationNum
        });

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        MetadataCore.commitCandidates(data.curriculum, metadataCandidates);

        return success({ added: true });
    }

    /**
     * Remove a class from a student's schedule.
     * Candidate-based: validates, clones, modifies, commits.
     * Uses ScheduleCore to find the correct start hour.
     */
    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // Check if class exists
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[validated.studentId];
        if (!studentSchedule || !studentSchedule[validated.week]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[validated.week];
        var dayNum = validated.day;
        var hourNum = validated.hour;

        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[dayNum][hourNum]);

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = MetadataCore.buildCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var weekScheduleClone = candidateSchedules[validated.studentId][validated.week];

        // ---- PHASE 4: FIND CLASS START ----
        var startHour = hourNum;
        var startKey = ScheduleCore.getScheduleKey(validated.studentId, validated.week, dayNum, startHour);

        var duration = MetadataCore.getValidClassDuration(data.curriculum, startKey);

        if (duration === null) {
            while (startHour > 0 &&
                   weekScheduleClone[dayNum] &&
                   String(weekScheduleClone[dayNum][startHour - 1]) === disciplineId) {
                startHour--;
            }
            var foundKey = ScheduleCore.getScheduleKey(validated.studentId, validated.week, dayNum, startHour);
            duration = MetadataCore.getValidClassDuration(data.curriculum, foundKey) || 1;
        }

        // ---- PHASE 5: DELETE FROM CANDIDATES ----
        for (var h = startHour; h < startHour + duration && h <= MAX_HOUR; h++) {
            if (weekScheduleClone[dayNum] && String(weekScheduleClone[dayNum][h]) === disciplineId) {
                delete weekScheduleClone[dayNum][h];
            }
        }

        var key = ScheduleCore.getScheduleKey(validated.studentId, validated.week, dayNum, startHour);
        MetadataCore.deleteClassMetadata(metadataCandidates, key);

        if (weekScheduleClone[dayNum] && Object.keys(weekScheduleClone[dayNum]).length === 0) {
            delete weekScheduleClone[dayNum];
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        MetadataCore.commitCandidates(data.curriculum, metadataCandidates);

        return success({ removed: true });
    }

    /**
     * Duplicate a student's schedule from one week to another.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return failure('Valid source week is required (1-52).');
        }

        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return failure('Valid target week is required (1-52).');
        }

        if (sourceWeekNum === targetWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        overwrite = overwrite === true;

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = MetadataCore.buildCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        var sourceSchedule = candidateSchedules[studentId][sourceWeekNum] || {};
        var targetSchedule = candidateSchedules[studentId][targetWeekNum] || {};

        // ---- PHASE 4: CLEAR TARGET (if overwrite) ----
        if (overwrite) {
            var targetKeyPrefix = studentId + '_' + targetWeekNum + '_';

            for (var day in targetSchedule) {
                delete targetSchedule[day];
            }

            MetadataCore.clearMetadataForPrefix(metadataCandidates, targetKeyPrefix);

            if (candidateRestDays[studentId]) {
                delete candidateRestDays[studentId][targetWeekNum];
            }
        }

        if (!candidateSchedules[studentId][targetWeekNum]) {
            candidateSchedules[studentId][targetWeekNum] = {};
        }
        var targetScheduleRef = candidateSchedules[studentId][targetWeekNum];

        // ---- PHASE 5: COPY WITH CONFLICT CHECK ----
        var copiedCount = 0;
        var skippedCount = 0;

        for (var day in sourceSchedule) {
            if (!isObject(sourceSchedule[day])) {
                continue;
            }

            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInteger(hour);
                if (hourNum === null) {
                    continue;
                }

                var sourceKey = ScheduleCore.getScheduleKey(studentId, sourceWeekNum, day, hourNum);

                var duration = MetadataCore.getValidClassDuration(data.curriculum, sourceKey);
                if (duration === null) {
                    skippedCount++;
                    continue;
                }

                var disciplineId = String(sourceSchedule[day][hour]);

                // Verify source class is contiguous
                var actualDuration = ScheduleCore.validateOccupiedDuration(sourceSchedule, day, hourNum, disciplineId);
                if (actualDuration === null || actualDuration !== duration) {
                    skippedCount++;
                    continue;
                }

                // Check target conflicts
                var canCopy = true;

                if (!overwrite) {
                    for (var h = hourNum; h < hourNum + duration && h <= MAX_HOUR; h++) {
                        if (targetScheduleRef[day] && targetScheduleRef[day][h]) {
                            canCopy = false;
                            break;
                        }
                    }
                }

                if (!canCopy) {
                    continue;
                }

                // Copy the class
                for (var h = hourNum; h < hourNum + duration && h <= MAX_HOUR; h++) {
                    if (!targetScheduleRef[day]) {
                        targetScheduleRef[day] = {};
                    }
                    targetScheduleRef[day][h] = disciplineId;
                }

                copiedCount++;

                // Copy metadata
                var targetKey = ScheduleCore.getScheduleKey(studentId, targetWeekNum, day, hourNum);
                MetadataCore.copyClassMetadata(metadataCandidates, sourceKey, targetKey);
            }
        }

        // ---- PHASE 6: COPY REST DAYS ----
        var sourceRestDays = candidateRestDays[studentId] && candidateRestDays[studentId][sourceWeekNum]
            ? candidateRestDays[studentId][sourceWeekNum]
            : [];

        var copiedRestDays = [];

        if (sourceRestDays.length > 0) {
            for (var i = 0; i < sourceRestDays.length; i++) {
                var day = sourceRestDays[i];

                if (overwrite) {
                    copiedRestDays.push(day);
                } else {
                    var hasClasses = targetScheduleRef[day] && Object.keys(targetScheduleRef[day]).length > 0;
                    if (!hasClasses) {
                        copiedRestDays.push(day);
                    }
                }
            }

            if (copiedRestDays.length > 0) {
                var targetRestDays = [];
                if (!overwrite && candidateRestDays[studentId] && candidateRestDays[studentId][targetWeekNum]) {
                    targetRestDays = candidateRestDays[studentId][targetWeekNum];
                }

                var allRestDays = targetRestDays.slice();
                for (var i = 0; i < copiedRestDays.length; i++) {
                    var day = copiedRestDays[i];
                    if (allRestDays.indexOf(day) === -1) {
                        allRestDays.push(day);
                    }
                }

                if (allRestDays.length > 0) {
                    if (!candidateRestDays[studentId]) {
                        candidateRestDays[studentId] = {};
                    }
                    candidateRestDays[studentId][targetWeekNum] = allRestDays;
                }
            }
        }

        // ---- PHASE 7: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        MetadataCore.commitCandidates(data.curriculum, metadataCandidates);

        return success({
            copiedCount: copiedCount,
            skippedCount: skippedCount,
            restDaysCopied: copiedRestDays.length
        });
    }

    /**
     * Clear a student's schedule for a week.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        var schedules = data.curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = MetadataCore.buildCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var weekSchedule = candidateSchedules[studentId][weekNum];
        var keyPrefix = studentId + '_' + weekNum + '_';

        // ---- PHASE 4: CLEAR CANDIDATES ----
        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }
        delete candidateSchedules[studentId][weekNum];

        if (candidateRestDays[studentId]) {
            delete candidateRestDays[studentId][weekNum];
        }

        MetadataCore.clearMetadataForPrefix(metadataCandidates, keyPrefix);

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        MetadataCore.commitCandidates(data.curriculum, metadataCandidates);

        return success({ cleared: true });
    }

    // ============================================================
    // REST DAYS OPERATIONS
    // ============================================================

    function getStudentRestDays(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = window.data;
        if (!data || !data.curriculum || !data.curriculum.restDays) {
            return [];
        }

        if (!data.curriculum.restDays[studentId] || !data.curriculum.restDays[studentId][weekNum]) {
            return [];
        }

        return data.curriculum.restDays[studentId][weekNum].slice();
    }

    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(days)) {
            return failure('Rest days must be an array.');
        }

        // ---- PHASE 2: NORMALISE AND VALIDATE ----
        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = parseInteger(days[i]);
            if (day === null || day < MIN_DAY || day > MAX_DAY) {
                return failure('All rest days must be valid days (1-7).');
            }

            var key = String(day);
            if (!seen[key]) {
                seen[key] = true;
                validDays.push(day);
            }
        }

        validDays.sort(function(a, b) {
            return a - b;
        });

        // ---- PHASE 3: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = MetadataCore.buildCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        if (!candidateRestDays[studentId]) {
            candidateRestDays[studentId] = {};
        }

        candidateRestDays[studentId][weekNum] = validDays;

        // ---- PHASE 5: REMOVE CLASSES ON REST DAYS ----
        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var weekSchedule = candidateSchedules[studentId][weekNum];
            var keyPrefix = studentId + '_' + weekNum + '_';

            for (var i = 0; i < validDays.length; i++) {
                var day = validDays[i];
                if (weekSchedule[day]) {
                    for (var hour in weekSchedule[day]) {
                        var hourNum = parseInteger(hour);
                        if (hourNum === null) {
                            continue;
                        }
                        var key = ScheduleCore.getScheduleKey(studentId, weekNum, day, hourNum);
                        if (MetadataCore.getValidClassDuration(data.curriculum, key) !== null) {
                            MetadataCore.deleteClassMetadata(metadataCandidates, key);
                        }
                    }
                    delete weekSchedule[day];
                }
            }
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.restDays = candidateRestDays;
        data.curriculum.schedules = candidateSchedules;
        MetadataCore.commitCandidates(data.curriculum, metadataCandidates);

        return success({ days: validDays });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarStudentCore = {
        // Schedule operations
        getStudentSchedule: getStudentSchedule,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        duplicateStudentSchedule: duplicateStudentSchedule,
        clearStudentSchedule: clearStudentSchedule,

        // Rest days
        getStudentRestDays: getStudentRestDays,
        setStudentRestDays: setStudentRestDays
    };

})();