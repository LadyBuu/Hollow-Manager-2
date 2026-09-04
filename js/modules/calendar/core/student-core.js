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
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone (or structuredClone fallback)
 *   - All ID normalisation is consistent
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.getDiscipline (from curriculum modules)
 *   - window.getCharacterById (from curriculum modules)
 *   - window.logActivity (for activity logging)
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarStudentCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        return;
    }

    window.__calendarStudentCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations', 'classLocations'];

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            if (data.curriculum.disciplines[i] && String(data.curriculum.disciplines[i].id) === String(id)) {
                return data.curriculum.disciplines[i];
            }
        }
        return null;
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && String(data.characters[i].id) === String(id)) {
                return data.characters[i];
            }
        }
        return null;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            try {
                window.logActivity(message, type);
            } catch (e) {
                // Activity logging failure should not abort mutations
            }
        }
    }

    function deepClone(value) {
        return window.ObjectUtils.deepClone(value);
    }

    function normaliseId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function normaliseIdArray(arr) {
        if (!Array.isArray(arr)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            var id = normaliseId(arr[i]);
            if (id !== null && result.indexOf(id) === -1) {
                result.push(id);
            }
        }
        return result;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateDay(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 7) ? num : null;
    }

    function validateHour(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 0 && num <= 23) ? num : null;
    }

    function validateDuration(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
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

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            if (data.curriculum[key] !== undefined && !isObject(data.curriculum[key])) {
                return { success: false, message: 'Metadata store "' + key + '" is corrupted.' };
            }
        }

        return { success: true, data: data };
    }

    function buildMetadataCandidates(curriculum) {
        var metadata = {};
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum && curriculum[key] ? curriculum[key] : {};
            var cloned = deepClone(source);
            if (cloned === null) {
                return null;
            }
            metadata[key] = cloned;
        }
        return metadata;
    }

    function commitMetadataCandidates(curriculum, metadataCandidates) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            curriculum[key] = metadataCandidates[key];
        }
    }

    function deleteClassMetadata(metadataCandidates, key) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = metadataCandidates[storeKey];
            if (store && store[key] !== undefined) {
                delete store[key];
            }
        }
    }

    function clearMetadataForPrefix(metadataCandidates, prefix) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = metadataCandidates[storeKey];
            if (!store) {
                continue;
            }
            for (var metadataKey in store) {
                if (Object.prototype.hasOwnProperty.call(store, metadataKey) && metadataKey.indexOf(prefix) === 0) {
                    delete store[metadataKey];
                }
            }
        }
    }

    function getValidClassDuration(metadataCandidates, key) {
        if (!metadataCandidates || !metadataCandidates.classDurations) {
            return null;
        }
        var duration = metadataCandidates.classDurations[key];
        if (duration === undefined || duration === null) {
            return null;
        }
        var num = parseInt(duration, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    function hasStudentScheduleConflict(schedule, day, hour, duration) {
        if (!schedule || !schedule[day]) {
            return false;
        }

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
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

        var data = getDataStore();
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
     * Cleans stale metadata when setting a new class.
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
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

        var discipline = getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (validated.hour + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId && !getCharacterById(normalisedInstructorId)) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
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

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
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

        if (hasStudentScheduleConflict(weekSchedule, dayNum, hourNum, durationNum)) {
            return failure('Student already has a class during this time.');
        }

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

        var key = getScheduleKey(validated.studentId, validated.week, dayNum, hourNum);

        for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
            weekSchedule[dayNum][h] = normalisedDisciplineId;
        }

        deleteClassMetadata(metadataCandidates, key);

        if (normalisedInstructorId) {
            metadataCandidates.classInstructors[key] = normalisedInstructorId;
        } else {
            delete metadataCandidates.classInstructors[key];
        }

        metadataCandidates.classDurations[key] = durationNum;

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Added class to schedule: ' + discipline.name);
        return success({ added: true });
    }

    /**
     * Remove a class from a student's schedule.
     * Candidate-based: validates, clones, modifies, commits.
     * Uses metadata to find the correct start hour.
     */
    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
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

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var weekScheduleClone = candidateSchedules[validated.studentId][validated.week];

        // ---- PHASE 4: FIND CLASS START USING METADATA ----
        var startHour = hourNum;
        var startKey = getScheduleKey(validated.studentId, validated.week, dayNum, startHour);

        var duration = getValidClassDuration(metadataCandidates, startKey);

        if (duration === null) {
            while (startHour > 0 &&
                   weekScheduleClone[dayNum] &&
                   String(weekScheduleClone[dayNum][startHour - 1]) === disciplineId) {
                startHour--;
            }
            var foundKey = getScheduleKey(validated.studentId, validated.week, dayNum, startHour);
            duration = getValidClassDuration(metadataCandidates, foundKey) || 1;
        }

        if (hourNum >= startHour + duration) {
            return failure('Class does not cover this hour.');
        }

        // ---- PHASE 5: DELETE FROM CANDIDATES ----
        for (var h = startHour; h < startHour + duration && h <= 23; h++) {
            if (weekScheduleClone[dayNum] && String(weekScheduleClone[dayNum][h]) === disciplineId) {
                delete weekScheduleClone[dayNum][h];
            }
        }

        var key = getScheduleKey(validated.studentId, validated.week, dayNum, startHour);
        deleteClassMetadata(metadataCandidates, key);

        if (weekScheduleClone[dayNum] && Object.keys(weekScheduleClone[dayNum]).length === 0) {
            delete weekScheduleClone[dayNum];
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed class from schedule');
        return success({ removed: true });
    }

    /**
     * Duplicate a student's schedule from one week to another.
     * Candidate-based: validates, clones, modifies, commits.
     * Checks entire duration before copying.
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
        var data = getDataStore();
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

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
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

            clearMetadataForPrefix(metadataCandidates, targetKeyPrefix);

            if (candidateRestDays[studentId]) {
                delete candidateRestDays[studentId][targetWeekNum];
            }
        }

        if (!candidateSchedules[studentId][targetWeekNum]) {
            candidateSchedules[studentId][targetWeekNum] = {};
        }
        var targetScheduleRef = candidateSchedules[studentId][targetWeekNum];

        // ---- PHASE 5: COPY WITH DURATION-AWARE CONFLICT CHECK ----
        var copiedCount = 0;
        var skippedCount = 0;

        for (var day in sourceSchedule) {
            if (!isObject(sourceSchedule[day])) {
                continue;
            }

            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInt(hour, 10);
                var sourceKey = getScheduleKey(studentId, sourceWeekNum, day, hourNum);

                var duration = getValidClassDuration(metadataCandidates, sourceKey);
                if (duration === null) {
                    skippedCount++;
                    continue;
                }

                var disciplineId = String(sourceSchedule[day][hour]);

                var actualDuration = 0;
                var maxHour = 23;
                for (var h = hourNum; h <= maxHour; h++) {
                    if (String(sourceSchedule[day][h]) === disciplineId) {
                        actualDuration++;
                    } else {
                        break;
                    }
                }

                if (actualDuration !== duration) {
                    skippedCount++;
                    continue;
                }

                var canCopy = true;

                if (!overwrite) {
                    for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                        if (targetScheduleRef[day] && targetScheduleRef[day][h]) {
                            canCopy = false;
                            break;
                        }
                    }
                }

                if (!canCopy) {
                    continue;
                }

                for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                    if (!targetScheduleRef[day]) {
                        targetScheduleRef[day] = {};
                    }
                    targetScheduleRef[day][h] = disciplineId;
                }

                copiedCount++;

                var targetKey = getScheduleKey(studentId, targetWeekNum, day, hourNum);

                if (metadataCandidates.classInstructors[sourceKey]) {
                    metadataCandidates.classInstructors[targetKey] = metadataCandidates.classInstructors[sourceKey];
                }
                if (metadataCandidates.classLabels[sourceKey]) {
                    metadataCandidates.classLabels[targetKey] = metadataCandidates.classLabels[sourceKey];
                }
                if (metadataCandidates.classGroupLabels[sourceKey]) {
                    metadataCandidates.classGroupLabels[targetKey] = metadataCandidates.classGroupLabels[sourceKey];
                }
                if (metadataCandidates.classDurations[sourceKey]) {
                    metadataCandidates.classDurations[targetKey] = metadataCandidates.classDurations[sourceKey];
                }
                if (metadataCandidates.classLocations[sourceKey]) {
                    metadataCandidates.classLocations[targetKey] = metadataCandidates.classLocations[sourceKey];
                }
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
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        var logMsg = 'Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum;
        logMsg += ' (' + copiedCount + ' classes';
        if (skippedCount > 0) {
            logMsg += ', ' + skippedCount + ' skipped due to data integrity issues';
        }
        logMsg += ')';
        logActivity(logMsg);

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
        var data = getDataStore();
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

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
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

        clearMetadataForPrefix(metadataCandidates, keyPrefix);

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Cleared schedule for week ' + weekNum);
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

        var data = getDataStore();
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
            var day = parseInt(days[i], 10);
            if (isNaN(day) || day < 1 || day > 7) {
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
        var data = getDataStore();
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

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
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
                        var hourNum = parseInt(hour, 10);
                        var key = getScheduleKey(studentId, weekNum, day, hourNum);
                        if (getValidClassDuration(metadataCandidates, key) !== null) {
                            deleteClassMetadata(metadataCandidates, key);
                        }
                    }
                    delete weekSchedule[day];
                }
            }
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.restDays = candidateRestDays;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Set rest days for student week ' + weekNum);
        return success({ days: validDays });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarStudentCore = {
        getStudentSchedule: getStudentSchedule,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        duplicateStudentSchedule: duplicateStudentSchedule,
        clearStudentSchedule: clearStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        setStudentRestDays: setStudentRestDays
    };

})();
