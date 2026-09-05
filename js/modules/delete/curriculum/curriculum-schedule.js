/**
 * js/core/curriculum/curriculum-schedule.js - Student Schedule Operations
 * Path: js/core/curriculum/curriculum-schedule.js
 * 
 * This module provides student schedule CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Multi-hour classes occupy every hour in the schedule array
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumScheduleLoaded) {
        return;
    }
    window.__curriculumScheduleLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        return isSafeInteger(value) && value >= 1 && value <= 7;
    }

    function validateHour(value) {
        return isSafeInteger(value) && value >= 0 && value <= 23;
    }

    function validateDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    function validateScheduleSlot(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (1-52).' };
        }

        if (!validateDay(day)) {
            return { valid: false, message: 'Valid day is required (1-7).' };
        }

        if (!validateHour(hour)) {
            return { valid: false, message: 'Valid hour is required (0-23).' };
        }

        return { valid: true, weekNum: weekNum };
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumSchedule: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumSchedule: JSON clone failed:', e);
            return null;
        }
    }

    function getScheduleStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            return null;
        }
        return data;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithSchedule(schedule, operationType, count) {
        var cloned = deepClone(schedule);
        if (cloned === null) {
            return failure('Failed to clone schedule data.');
        }
        return {
            success: true,
            schedule: cloned,
            operation: operationType || 'updated',
            count: count || 0
        };
    }

    // ============================================================
    // SCHEDULE QUERIES
    // ============================================================

    function getStudentSchedule(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getScheduleStore();
        if (!data) {
            return {};
        }

        if (!data.curriculum.schedules || typeof data.curriculum.schedules !== 'object') {
            return {};
        }

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return {};
        }

        var weekSchedule = studentSchedule[weekNum];
        var result = {};

        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                continue;
            }
            var daySchedule = weekSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }
            result[day] = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                result[day][hour] = daySchedule[hour];
            }
        }
        return result;
    }

    function getStudentScheduleWeek(studentId, week) {
        return getStudentSchedule(studentId, week);
    }

    function getStudentScheduleClass(studentId, week, day, hour) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return null;
        }

        var schedule = getStudentSchedule(studentId, validation.weekNum);
        if (!schedule[day] || !schedule[day][hour]) {
            return null;
        }

        return schedule[day][hour];
    }

    function getStudentRestDays(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getScheduleStore();
        if (!data) {
            return [];
        }

        if (!data.curriculum.restDays || typeof data.curriculum.restDays !== 'object') {
            return [];
        }

        if (!data.curriculum.restDays[studentId] || !data.curriculum.restDays[studentId][weekNum]) {
            return [];
        }

        return data.curriculum.restDays[studentId][weekNum].slice();
    }

    function getStudentDisciplineHourUsage(studentId, week) {
        var schedule = getStudentSchedule(studentId, week);
        var disciplineHours = {};

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
                var discId = daySchedule[hour];
                if (discId) {
                    if (!disciplineHours[discId]) {
                        disciplineHours[discId] = 0;
                    }
                    disciplineHours[discId]++;
                }
            }
        }

        return disciplineHours;
    }

    function hasScheduleConflict(schedule, day, hour, duration) {
        duration = duration || 1;

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

    // ============================================================
    // FIND CLASS START - Helper for metadata operations
    // ============================================================

    function findClassStart(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return null;
        }

        var disciplineId = schedule[day][hour];
        var startHour = hour;

        while (startHour > 0 && schedule[day][startHour - 1] === disciplineId) {
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23 && schedule[day][endHour + 1] === disciplineId) {
            endHour++;
        }

        return {
            disciplineId: disciplineId,
            startHour: startHour,
            endHour: endHour,
            duration: endHour - startHour + 1
        };
    }

    // ============================================================
    // SCHEDULE MUTATIONS
    // ============================================================

    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hour + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return failure('Instructor not found.');
        }

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateSchedules = deepClone(store.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        if (!candidateSchedules[studentId][weekNum]) {
            candidateSchedules[studentId][weekNum] = {};
        }

        var schedule = candidateSchedules[studentId][weekNum];

        // Check for conflicts
        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            if (schedule[day] && schedule[day][h]) {
                var existingDiscipline = getDiscipline(schedule[day][h]);
                var existingName = existingDiscipline ? existingDiscipline.name : 'Unknown';
                return failure('Student already has a class during this time: ' + existingName);
            }
        }

        // Check rest days
        var restDays = getStudentRestDays(studentId, weekNum);
        if (restDays.indexOf(day) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // Check weekly hour limit
        var usedHours = getStudentDisciplineHourUsage(studentId, weekNum);
        var usedCount = usedHours[disciplineId] || 0;
        var maxHours = discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;

        if (usedCount + durationNum > maxHours) {
            return failure('This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.');
        }

        if (!schedule[day]) {
            schedule[day] = {};
        }

        var key = getScheduleKey(studentId, weekNum, day, hour);

        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            schedule[day][h] = disciplineId;
        }

        if (instructorId) {
            candidateInstructors[key] = instructorId;
        } else {
            delete candidateInstructors[key];
        }

        candidateDurations[key] = durationNum;

        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classDurations = candidateDurations;

        logActivity('Added class to schedule: ' + discipline.name);
        return successWithSchedule(schedule, 'added');
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum.schedules ||
            !store.curriculum.schedules[studentId] ||
            !store.curriculum.schedules[studentId][weekNum]) {
            return failure('No schedule for this student and week.');
        }

        var schedule = store.curriculum.schedules[studentId][weekNum];
        if (!schedule[day] || !schedule[day][hour]) {
            return failure('No class at this time.');
        }

        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('Could not determine class structure.');
        }

        var disciplineId = classInfo.disciplineId;
        var startHour = classInfo.startHour;
        var duration = classInfo.duration;

        var candidateSchedules = deepClone(store.curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        var candidateSchedule = candidateSchedules[studentId][weekNum];

        for (var h = startHour; h < startHour + duration && h <= 23; h++) {
            delete candidateSchedule[day][h];
        }

        if (candidateSchedule[day] && Object.keys(candidateSchedule[day]).length === 0) {
            delete candidateSchedule[day];
        }

        var key = getScheduleKey(studentId, weekNum, day, startHour);
        delete candidateInstructors[key];
        delete candidateLabels[key];
        delete candidateGroupLabels[key];
        delete candidateDurations[key];
        delete candidateLocations[key];

        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Removed class from schedule');
        return { success: true, deleted: true };
    }

    function clearStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum.schedules ||
            !store.curriculum.schedules[studentId] ||
            !store.curriculum.schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule found for this student and week.' });
        }

        var candidateSchedules = deepClone(store.curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        var keyPrefix = studentId + '_' + weekNum + '_';
        var weekSchedule = candidateSchedules[studentId][weekNum];

        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }
        delete candidateSchedules[studentId][weekNum];

        for (var key in candidateInstructors) {
            if (key.indexOf(keyPrefix) === 0) {
                delete candidateInstructors[key];
            }
        }

        for (var key in candidateLabels) {
            if (key.indexOf(keyPrefix) === 0) {
                delete candidateLabels[key];
            }
        }

        for (var key in candidateGroupLabels) {
            if (key.indexOf(keyPrefix) === 0) {
                delete candidateGroupLabels[key];
            }
        }

        for (var key in candidateDurations) {
            if (key.indexOf(keyPrefix) === 0) {
                delete candidateDurations[key];
            }
        }

        for (var key in candidateLocations) {
            if (key.indexOf(keyPrefix) === 0) {
                delete candidateLocations[key];
            }
        }

        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Cleared schedule for week ' + weekNum);
        return { success: true, cleared: true };
    }

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
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

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum.schedules) {
            return failure('No schedules found.');
        }

        if (!store.curriculum.schedules[studentId]) {
            return failure('No schedule found for this student.');
        }

        var sourceSchedule = store.curriculum.schedules[studentId][sourceWeekNum];
        if (!sourceSchedule || typeof sourceSchedule !== 'object') {
            return failure('No schedule found for source week.');
        }

        // Build copy plan
        var copyPlan = [];
        var sourceKeys = [];

        for (var day in sourceSchedule) {
            if (!Object.prototype.hasOwnProperty.call(sourceSchedule, day)) {
                continue;
            }
            var daySchedule = sourceSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInt(hour, 10);
                var disciplineId = daySchedule[hour];

                var sourceKey = getScheduleKey(studentId, sourceWeekNum, day, hourNum);
                var duration = store.curriculum.classDurations && store.curriculum.classDurations[sourceKey]
                    ? store.curriculum.classDurations[sourceKey]
                    : null;

                if (!duration) {
                    continue;
                }

                var classInfo = findClassStart(sourceSchedule, parseInt(day), hourNum);
                if (!classInfo || classInfo.startHour !== hourNum) {
                    continue;
                }

                copyPlan.push({
                    day: parseInt(day),
                    hour: hourNum,
                    disciplineId: disciplineId,
                    duration: duration,
                    instructorId: store.curriculum.classInstructors ? store.curriculum.classInstructors[sourceKey] : null,
                    label: store.curriculum.classLabels ? store.curriculum.classLabels[sourceKey] : null,
                    groupLabel: store.curriculum.classGroupLabels ? store.curriculum.classGroupLabels[sourceKey] : null,
                    locationId: store.curriculum.classLocations ? store.curriculum.classLocations[sourceKey] : null,
                    sourceKey: sourceKey
                });

                sourceKeys.push(sourceKey);
            }
        }

        if (copyPlan.length === 0) {
            return success({ copied: false, count: 0, message: 'No classes to copy.' });
        }

        var candidateSchedules = deepClone(store.curriculum.schedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        var targetKeyPrefix = studentId + '_' + targetWeekNum + '_';

        if (overwrite) {
            if (candidateSchedules[studentId] && candidateSchedules[studentId][targetWeekNum]) {
                delete candidateSchedules[studentId][targetWeekNum];
            }

            for (var key in candidateInstructors) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete candidateInstructors[key];
                }
            }

            for (var key in candidateLabels) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete candidateLabels[key];
                }
            }

            for (var key in candidateGroupLabels) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete candidateGroupLabels[key];
                }
            }

            for (var key in candidateDurations) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete candidateDurations[key];
                }
            }

            for (var key in candidateLocations) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete candidateLocations[key];
                }
            }
        }

        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        if (!candidateSchedules[studentId][targetWeekNum]) {
            candidateSchedules[studentId][targetWeekNum] = {};
        }

        var targetSchedule = candidateSchedules[studentId][targetWeekNum];
        var copiedCount = 0;

        for (var i = 0; i < copyPlan.length; i++) {
            var item = copyPlan[i];
            var day = item.day;
            var hour = item.hour;
            var duration = item.duration;
            var disciplineId = item.disciplineId;

            if (!overwrite) {
                var hasConflict = false;
                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (targetSchedule[day] && targetSchedule[day][h]) {
                        hasConflict = true;
                        break;
                    }
                }
                if (hasConflict) {
                    continue;
                }
            }

            if (!targetSchedule[day]) {
                targetSchedule[day] = {};
            }

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                targetSchedule[day][h] = disciplineId;
            }

            var targetKey = getScheduleKey(studentId, targetWeekNum, day, hour);

            if (item.instructorId) {
                candidateInstructors[targetKey] = item.instructorId;
            }

            if (item.label) {
                candidateLabels[targetKey] = item.label;
            }

            if (item.groupLabel) {
                candidateGroupLabels[targetKey] = item.groupLabel;
            }

            candidateDurations[targetKey] = duration;

            if (item.locationId) {
                candidateLocations[targetKey] = item.locationId;
            }

            copiedCount++;
        }

        // Copy rest days
        var restDays = getStudentRestDays(studentId, sourceWeekNum);
        if (restDays && restDays.length > 0) {
            if (!candidateSchedules.restDays) {
                candidateSchedules.restDays = {};
            }
            if (!candidateSchedules.restDays[studentId]) {
                candidateSchedules.restDays[studentId] = {};
            }
            candidateSchedules.restDays[studentId][targetWeekNum] = restDays.slice();
        }

        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum + ' (' + copiedCount + ' classes)');
        return { success: true, copied: true, count: copiedCount };
    }

    function setStudentRestDays(studentId, week, days) {
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

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateRestDays = deepClone(store.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest day data.');
        }

        var candidateSchedules = deepClone(store.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        if (!candidateRestDays[studentId]) {
            candidateRestDays[studentId] = {};
        }

        var validDays = days.filter(function(d) {
            return isSafeInteger(d) && d >= 1 && d <= 7;
        });

        candidateRestDays[studentId][weekNum] = validDays;

        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var schedule = candidateSchedules[studentId][weekNum];
            var keyPrefix = studentId + '_' + weekNum + '_';

            for (var i = 0; i < validDays.length; i++) {
                var day = validDays[i];

                if (schedule[day]) {
                    for (var hour in schedule[day]) {
                        var key = keyPrefix + day + '_' + hour;
                        delete candidateInstructors[key];
                        delete candidateLabels[key];
                        delete candidateGroupLabels[key];
                        delete candidateDurations[key];
                        delete candidateLocations[key];
                    }
                    delete schedule[day];
                }
            }
        }

        store.curriculum.restDays = candidateRestDays;
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Set rest days for student week ' + weekNum);
        return { success: true, days: validDays };
    }

    // ============================================================
    // SCHEDULE METADATA HELPERS
    // ============================================================

    function getClassMetadata(studentId, week, day, hour) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return null;
        }

        var weekNum = validation.weekNum;

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return null;
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var data = getScheduleStore();
        if (!data || !data.curriculum) {
            return null;
        }

        return {
            instructorId: data.curriculum.classInstructors ? data.curriculum.classInstructors[key] || null : null,
            label: data.curriculum.classLabels ? data.curriculum.classLabels[key] || null : null,
            groupLabel: data.curriculum.classGroupLabels ? data.curriculum.classGroupLabels[key] || null : null,
            duration: data.curriculum.classDurations ? data.curriculum.classDurations[key] || classInfo.duration : classInfo.duration,
            locationId: data.curriculum.classLocations ? data.curriculum.classLocations[key] || null : null
        };
    }

    function getClassInstructor(studentId, week, day, hour) {
        var metadata = getClassMetadata(studentId, week, day, hour);
        return metadata ? metadata.instructorId : null;
    }

    function getClassLabel(studentId, week, day, hour) {
        var metadata = getClassMetadata(studentId, week, day, hour);
        return metadata ? metadata.label : null;
    }

    function getClassGroupLabel(studentId, week, day, hour) {
        var metadata = getClassMetadata(studentId, week, day, hour);
        return metadata ? metadata.groupLabel : null;
    }

    function getClassDuration(studentId, week, day, hour) {
        var metadata = getClassMetadata(studentId, week, day, hour);
        return metadata ? metadata.duration : null;
    }

    function getClassLocation(studentId, week, day, hour) {
        var metadata = getClassMetadata(studentId, week, day, hour);
        return metadata ? metadata.locationId : null;
    }

    function setClassInstructor(studentId, week, day, hour, instructorId) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        if (instructorId && !getCharacterById(instructorId)) {
            return failure('Instructor not found.');
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        if (instructorId) {
            candidateInstructors[key] = instructorId;
        } else {
            delete candidateInstructors[key];
        }

        store.curriculum.classInstructors = candidateInstructors;

        return { success: true, instructorId: instructorId };
    }

    function setClassLabel(studentId, week, day, hour, label) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        if (label !== undefined && label !== null && String(label).trim() !== '') {
            candidateLabels[key] = String(label).trim();
        } else {
            delete candidateLabels[key];
        }

        store.curriculum.classLabels = candidateLabels;

        return { success: true, label: label };
    }

    function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        if (groupLabel !== undefined && groupLabel !== null && String(groupLabel).trim() !== '') {
            candidateGroupLabels[key] = String(groupLabel).trim();
        } else {
            delete candidateGroupLabels[key];
        }

        store.curriculum.classGroupLabels = candidateGroupLabels;

        return { success: true, groupLabel: groupLabel };
    }

    function setClassDuration(studentId, week, day, hour, duration) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        candidateDurations[key] = durationNum;

        store.curriculum.classDurations = candidateDurations;

        logActivity('Set duration for class: ' + durationNum + 'h');
        return { success: true, duration: durationNum };
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;

        if (locationId && !isNonEmptyString(locationId)) {
            return failure('Valid location ID is required.');
        }

        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, day, hour);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, day, startHour);

        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        if (locationId) {
            candidateLocations[key] = locationId;
        } else {
            delete candidateLocations[key];
        }

        store.curriculum.classLocations = candidateLocations;

        return { success: true, locationId: locationId };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getStudentSchedule = getStudentSchedule;
    window.getStudentScheduleWeek = getStudentScheduleWeek;
    window.getStudentScheduleClass = getStudentScheduleClass;
    window.getStudentRestDays = getStudentRestDays;
    window.getStudentDisciplineHourUsage = getStudentDisciplineHourUsage;
    window.hasScheduleConflict = hasScheduleConflict;

    // Mutations
    window.setStudentScheduleClass = setStudentScheduleClass;
    window.removeStudentScheduleClass = removeStudentScheduleClass;
    window.clearStudentSchedule = clearStudentSchedule;
    window.duplicateStudentSchedule = duplicateStudentSchedule;
    window.setStudentRestDays = setStudentRestDays;

    // Metadata
    window.getClassMetadata = getClassMetadata;
    window.getClassInstructor = getClassInstructor;
    window.getClassLabel = getClassLabel;
    window.getClassGroupLabel = getClassGroupLabel;
    window.getClassDuration = getClassDuration;
    window.getClassLocation = getClassLocation;
    window.setClassInstructor = setClassInstructor;
    window.setClassLabel = setClassLabel;
    window.setClassGroupLabel = setClassGroupLabel;
    window.setClassDuration = setClassDuration;
    window.setClassLocation = setClassLocation;

    // Utilities
    window.getScheduleKey = getScheduleKey;
    window.findClassStart = findClassStart;

})();
