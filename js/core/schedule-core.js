/**
 * core/schedule-core.js - Schedule Core Operations
 * Single source of truth for all student schedule-related data mutations
 * Path: js/core/schedule-core.js
 * 
 * This module handles:
 *   - Student schedule CRUD (get, set, remove, clear)
 *   - Schedule duplication between weeks
 *   - Rest days management
 *   - Schedule conflict detection
 *   - Weekly hour limit enforcement
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * SCHEDULE SEMANTICS:
 *   - Schedules are stored as: schedules[studentId][week][day][hour] = disciplineId
 *   - Multi-hour classes occupy every hour in the array
 *   - Class metadata (instructor, label, duration) is stored separately
 *   - Rest days are stored as: restDays[studentId][week] = [days]
 *   - Weekly hour limits are enforced per discipline
 *   - scheduleKey = studentId + '_' + week + '_' + day + '_' + hour
 */

(function() {
    'use strict';

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
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function ensureScheduleStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        if (!data.curriculum.schedules || typeof data.curriculum.schedules !== 'object') {
            data.curriculum.schedules = {};
        }

        if (!data.curriculum.restDays || typeof data.curriculum.restDays !== 'object') {
            data.curriculum.restDays = {};
        }

        if (!data.curriculum.classInstructors || typeof data.curriculum.classInstructors !== 'object') {
            data.curriculum.classInstructors = {};
        }

        if (!data.curriculum.classLabels || typeof data.curriculum.classLabels !== 'object') {
            data.curriculum.classLabels = {};
        }

        if (!data.curriculum.classGroupLabels || typeof data.curriculum.classGroupLabels !== 'object') {
            data.curriculum.classGroupLabels = {};
        }

        if (!data.curriculum.classDurations || typeof data.curriculum.classDurations !== 'object') {
            data.curriculum.classDurations = {};
        }

        if (!data.curriculum.classLocations || typeof data.curriculum.classLocations !== 'object') {
            data.curriculum.classLocations = {};
        }

        return data;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

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

    // ============================================================
    // SCHEDULE QUERIES
    // ============================================================

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

        return studentSchedule[weekNum];
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

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.restDays) {
            return [];
        }

        if (!data.curriculum.restDays[studentId] || !data.curriculum.restDays[studentId][weekNum]) {
            return [];
        }

        return data.curriculum.restDays[studentId][weekNum];
    }

    function getStudentDisciplineHourUsage(studentId, week) {
        var schedule = getStudentSchedule(studentId, week);
        var disciplineHours = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                var discId = schedule[day][hour];
                if (discId) {
                    if (!disciplineHours[discId]) disciplineHours[discId] = 0;
                    disciplineHours[discId]++;
                }
            }
        }

        return disciplineHours;
    }

    function getStudentScheduleCount(studentId) {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return 0;
        }

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule) return 0;

        var count = 0;
        for (var week in studentSchedule) {
            if (!Object.prototype.hasOwnProperty.call(studentSchedule, week)) continue;
            var weekData = studentSchedule[week];
            if (!weekData || typeof weekData !== 'object') continue;

            for (var day in weekData) {
                if (!Object.prototype.hasOwnProperty.call(weekData, day)) continue;
                var dayData = weekData[day];
                if (!dayData || typeof dayData !== 'object') continue;

                for (var hour in dayData) {
                    if (!Object.prototype.hasOwnProperty.call(dayData, hour)) continue;
                    if (dayData[hour]) count++;
                }
            }
        }

        return count;
    }

    function hasScheduleConflict(schedule, day, hour, duration) {
        duration = duration || 1;

        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // SCHEDULE MUTATIONS
    // ============================================================

    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;

        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hour + durationNum > 24) {
            return { success: false, message: 'Class duration extends beyond the end of the day.' };
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return { success: false, message: 'Instructor not found.' };
        }

        // ---- PHASE 2: CHECK CONFLICTS ----
        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!store.curriculum.schedules[studentId]) {
            store.curriculum.schedules[studentId] = {};
        }

        if (!store.curriculum.schedules[studentId][weekNum]) {
            store.curriculum.schedules[studentId][weekNum] = {};
        }

        var schedule = store.curriculum.schedules[studentId][weekNum];

        // Check for conflicts
        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            if (schedule[day] && schedule[day][h]) {
                var existingDiscipline = getDiscipline(schedule[day][h]);
                var existingName = existingDiscipline ? existingDiscipline.name : 'Unknown';
                return {
                    success: false,
                    message: 'Student already has a class during this time: ' + existingName
                };
            }
        }

        // Check rest days
        var restDays = getStudentRestDays(studentId, weekNum);
        if (restDays.indexOf(day) !== -1) {
            return { success: false, message: 'This is a rest day for this student.' };
        }

        // Check weekly hour limit
        var usedHours = getStudentDisciplineHourUsage(studentId, weekNum);
        var usedCount = usedHours[disciplineId] || 0;
        var maxHours = discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;

        if (usedCount + durationNum > maxHours) {
            return {
                success: false,
                message: 'This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.'
            };
        }

        // ---- PHASE 3: APPLY ----
        if (!schedule[day]) schedule[day] = {};

        var key = getScheduleKey(studentId, weekNum, day, hour);

        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            schedule[day][h] = disciplineId;
        }

        if (instructorId) {
            store.curriculum.classInstructors[key] = instructorId;
        } else {
            delete store.curriculum.classInstructors[key];
        }

        store.curriculum.classDurations[key] = durationNum;

        logActivity('Added class to schedule: ' + discipline.name);
        return { success: true };
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.schedules) {
            return { success: false, message: 'Schedule not found.' };
        }

        if (!store.curriculum.schedules[studentId] || !store.curriculum.schedules[studentId][weekNum]) {
            return { success: false, message: 'No schedule for this student and week.' };
        }

        var schedule = store.curriculum.schedules[studentId][weekNum];
        if (!schedule[day] || !schedule[day][hour]) {
            return { success: false, message: 'No class at this time.' };
        }

        // ---- PHASE 3: FIND CLASS BOUNDARIES ----
        var disciplineId = schedule[day][hour];
        var startHour = hour;
        while (startHour > 0 && schedule[day][startHour - 1] === disciplineId) {
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23 && schedule[day][endHour + 1] === disciplineId) {
            endHour++;
        }

        var duration = endHour - startHour + 1;

        // ---- PHASE 4: APPLY ----
        for (var h = startHour; h <= endHour; h++) {
            delete schedule[day][h];
        }

        var key = getScheduleKey(studentId, weekNum, day, startHour);

        delete store.curriculum.classInstructors[key];
        delete store.curriculum.classLabels[key];
        delete store.curriculum.classGroupLabels[key];
        delete store.curriculum.classDurations[key];
        delete store.curriculum.classLocations[key];

        // Clean up empty day
        if (schedule[day] && Object.keys(schedule[day]).length === 0) {
            delete schedule[day];
        }

        logActivity('Removed class from schedule');
        return { success: true };
    }

    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        // ---- PHASE 2: CLEAR ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return { success: true };
        }

        var schedule = data.curriculum.schedules[studentId];
        if (!schedule || !schedule[weekNum]) {
            return { success: true };
        }

        var weekSchedule = schedule[weekNum];
        var keyPrefix = studentId + '_' + weekNum + '_';

        // Clear schedule entries
        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }
        delete schedule[weekNum];

        // Clear metadata
        if (data.curriculum.classInstructors) {
            for (var key in data.curriculum.classInstructors) {
                if (key.indexOf(keyPrefix) === 0) {
                    delete data.curriculum.classInstructors[key];
                }
            }
        }

        if (data.curriculum.classLabels) {
            for (var key in data.curriculum.classLabels) {
                if (key.indexOf(keyPrefix) === 0) {
                    delete data.curriculum.classLabels[key];
                }
            }
        }

        if (data.curriculum.classGroupLabels) {
            for (var key in data.curriculum.classGroupLabels) {
                if (key.indexOf(keyPrefix) === 0) {
                    delete data.curriculum.classGroupLabels[key];
                }
            }
        }

        if (data.curriculum.classDurations) {
            for (var key in data.curriculum.classDurations) {
                if (key.indexOf(keyPrefix) === 0) {
                    delete data.curriculum.classDurations[key];
                }
            }
        }

        if (data.curriculum.classLocations) {
            for (var key in data.curriculum.classLocations) {
                if (key.indexOf(keyPrefix) === 0) {
                    delete data.curriculum.classLocations[key];
                }
            }
        }

        logActivity('Cleared schedule for week ' + weekNum);
        return { success: true };
    }

    // ============================================================
    // SCHEDULE DUPLICATION
    // ============================================================

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return { success: false, message: 'Valid source week is required (1-52).' };
        }

        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return { success: false, message: 'Valid target week is required (1-52).' };
        }

        if (sourceWeekNum === targetWeekNum) {
            return { success: false, message: 'Source and target weeks must be different.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!store.curriculum.schedules[studentId]) {
            store.curriculum.schedules[studentId] = {};
        }

        var sourceSchedule = store.curriculum.schedules[studentId][sourceWeekNum] || {};
        var destSchedule = store.curriculum.schedules[studentId][targetWeekNum] || {};

        // ---- PHASE 3: CLEAR TARGET (if overwrite) ----
        if (overwrite) {
            var targetKeyPrefix = studentId + '_' + targetWeekNum + '_';

            for (var day in destSchedule) {
                delete destSchedule[day];
            }
            delete store.curriculum.schedules[studentId][targetWeekNum];
            store.curriculum.schedules[studentId][targetWeekNum] = {};

            if (store.curriculum.classInstructors) {
                for (var key in store.curriculum.classInstructors) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete store.curriculum.classInstructors[key];
                    }
                }
            }

            if (store.curriculum.classLabels) {
                for (var key in store.curriculum.classLabels) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete store.curriculum.classLabels[key];
                    }
                }
            }

            if (store.curriculum.classGroupLabels) {
                for (var key in store.curriculum.classGroupLabels) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete store.curriculum.classGroupLabels[key];
                    }
                }
            }

            if (store.curriculum.classDurations) {
                for (var key in store.curriculum.classDurations) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete store.curriculum.classDurations[key];
                    }
                }
            }

            if (store.curriculum.classLocations) {
                for (var key in store.curriculum.classLocations) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete store.curriculum.classLocations[key];
                    }
                }
            }
        }

        // ---- PHASE 4: COPY ----
        var copiedCount = 0;
        var destScheduleRef = store.curriculum.schedules[studentId][targetWeekNum];

        for (var day in sourceSchedule) {
            if (!isObject(sourceSchedule[day])) continue;
            if (!destScheduleRef[day]) destScheduleRef[day] = {};

            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInt(hour, 10);
                var sourceKey = studentId + '_' + sourceWeekNum + '_' + day + '_' + hourNum;
                var duration = store.curriculum.classDurations && store.curriculum.classDurations[sourceKey]
                    ? store.curriculum.classDurations[sourceKey]
                    : null;

                if (!duration) continue;

                if (!destScheduleRef[day][hour] || overwrite) {
                    var disciplineId = sourceSchedule[day][hour];

                    for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                        destScheduleRef[day][h] = disciplineId;
                    }

                    copiedCount++;

                    var targetKey = studentId + '_' + targetWeekNum + '_' + day + '_' + hourNum;

                    if (store.curriculum.classInstructors && store.curriculum.classInstructors[sourceKey]) {
                        store.curriculum.classInstructors[targetKey] = store.curriculum.classInstructors[sourceKey];
                    }

                    if (store.curriculum.classLabels && store.curriculum.classLabels[sourceKey]) {
                        store.curriculum.classLabels[targetKey] = store.curriculum.classLabels[sourceKey];
                    }

                    if (store.curriculum.classGroupLabels && store.curriculum.classGroupLabels[sourceKey]) {
                        store.curriculum.classGroupLabels[targetKey] = store.curriculum.classGroupLabels[sourceKey];
                    }

                    if (duration) {
                        if (!store.curriculum.classDurations) store.curriculum.classDurations = {};
                        store.curriculum.classDurations[targetKey] = duration;
                    }

                    if (store.curriculum.classLocations && store.curriculum.classLocations[sourceKey]) {
                        store.curriculum.classLocations[targetKey] = store.curriculum.classLocations[sourceKey];
                    }
                }
            }
        }

        // Copy rest days
        if (store.curriculum.restDays && store.curriculum.restDays[studentId]) {
            var sourceRestDays = store.curriculum.restDays[studentId][sourceWeekNum];
            if (sourceRestDays && sourceRestDays.length > 0) {
                if (!store.curriculum.restDays[studentId]) {
                    store.curriculum.restDays[studentId] = {};
                }
                store.curriculum.restDays[studentId][targetWeekNum] = sourceRestDays.slice();
            }
        }

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum);
        return { success: true, copiedCount: copiedCount };
    }

    // ============================================================
    // REST DAYS OPERATIONS
    // ============================================================

    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!Array.isArray(days)) {
            return { success: false, message: 'Rest days must be an array.' };
        }

        // ---- PHASE 2: APPLY ----
        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!store.curriculum.restDays[studentId]) {
            store.curriculum.restDays[studentId] = {};
        }

        var validDays = days.filter(function(d) {
            return isSafeInteger(d) && d >= 1 && d <= 7;
        });

        store.curriculum.restDays[studentId][weekNum] = validDays;

        // Remove classes on rest days
        if (store.curriculum.schedules && store.curriculum.schedules[studentId] &&
            store.curriculum.schedules[studentId][weekNum]) {
            var schedule = store.curriculum.schedules[studentId][weekNum];
            var keyPrefix = studentId + '_' + weekNum + '_';

            validDays.forEach(function(day) {
                if (schedule[day]) {
                    for (var hour in schedule[day]) {
                        var key = keyPrefix + day + '_' + hour;
                        delete store.curriculum.classInstructors[key];
                        delete store.curriculum.classLabels[key];
                        delete store.curriculum.classGroupLabels[key];
                        delete store.curriculum.classDurations[key];
                        delete store.curriculum.classLocations[key];
                    }
                    delete schedule[day];
                }
            });
        }

        logActivity('Set rest days for student week ' + weekNum);
        return { success: true };
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
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var data = getDataStore();
        if (!data || !data.curriculum) {
            return null;
        }

        return {
            instructorId: data.curriculum.classInstructors ? data.curriculum.classInstructors[key] || null : null,
            label: data.curriculum.classLabels ? data.curriculum.classLabels[key] || null : null,
            groupLabel: data.curriculum.classGroupLabels ? data.curriculum.classGroupLabels[key] || null : null,
            duration: data.curriculum.classDurations ? data.curriculum.classDurations[key] || 1 : 1,
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
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return { success: false, message: 'Instructor not found.' };
        }

        if (instructorId) {
            store.curriculum.classInstructors[key] = instructorId;
        } else {
            delete store.curriculum.classInstructors[key];
        }

        return { success: true };
    }

    function setClassLabel(studentId, week, day, hour, label) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (label !== undefined && label !== null && String(label).trim() !== '') {
            store.curriculum.classLabels[key] = String(label).trim();
        } else {
            delete store.curriculum.classLabels[key];
        }

        return { success: true };
    }

    function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (groupLabel !== undefined && groupLabel !== null && String(groupLabel).trim() !== '') {
            store.curriculum.classGroupLabels[key] = String(groupLabel).trim();
        } else {
            delete store.curriculum.classGroupLabels[key];
        }

        return { success: true };
    }

    function setClassDuration(studentId, week, day, hour, duration) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        store.curriculum.classDurations[key] = durationNum;
        return { success: true };
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        var weekNum = validation.weekNum;
        var key = getScheduleKey(studentId, weekNum, day, hour);

        var store = ensureScheduleStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (locationId && !isNonEmptyString(locationId)) {
            return { success: false, message: 'Valid location ID is required.' };
        }

        if (locationId) {
            store.curriculum.classLocations[key] = locationId;
        } else {
            delete store.curriculum.classLocations[key];
        }

        return { success: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleCore = {
        // Queries
        getStudentSchedule: getStudentSchedule,
        getStudentScheduleWeek: getStudentScheduleWeek,
        getStudentScheduleClass: getStudentScheduleClass,
        getStudentRestDays: getStudentRestDays,
        getStudentDisciplineHourUsage: getStudentDisciplineHourUsage,
        getStudentScheduleCount: getStudentScheduleCount,
        hasScheduleConflict: hasScheduleConflict,

        // Mutations
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        clearStudentSchedule: clearStudentSchedule,
        duplicateStudentSchedule: duplicateStudentSchedule,
        setStudentRestDays: setStudentRestDays,

        // Metadata
        getClassMetadata: getClassMetadata,
        getClassInstructor: getClassInstructor,
        getClassLabel: getClassLabel,
        getClassGroupLabel: getClassGroupLabel,
        getClassDuration: getClassDuration,
        getClassLocation: getClassLocation,
        setClassInstructor: setClassInstructor,
        setClassLabel: setClassLabel,
        setClassGroupLabel: setClassGroupLabel,
        setClassDuration: setClassDuration,
        setClassLocation: setClassLocation,

        // Utilities
        getScheduleKey: getScheduleKey,
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration
    };

})();
