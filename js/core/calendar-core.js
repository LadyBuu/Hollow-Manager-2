/**
 * core/calendar-core.js - Unified Calendar Core Operations
 * Single source of truth for all calendar-related data mutations
 * Path: js/core/calendar-core.js
 * 
 * This module handles:
 *   - Student schedules (classes, rest days, duplication)
 *   - Instructor calendars (templates, blocks)
 *   - Location schedules (assignments)
 *   - Shared grid operations (occupancy, conflicts, availability)
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

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function ensureCurriculumStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        var defaults = {
            schedules: {},
            restDays: {},
            classInstructors: {},
            classLabels: {},
            classGroupLabels: {},
            classDurations: {},
            classLocations: {},
            instructorTemplates: {},
            instructorBlocks: {}
        };

        for (var key in defaults) {
            if (data.curriculum[key] === undefined) {
                data.curriculum[key] = defaults[key];
            }
        }

        return data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getDiscipline(id) {
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

    // ============================================================
    // SCHEDULE KEY GENERATION
    // ============================================================

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS
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

    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var durationNum = parsePositiveInteger(duration) || 1;
        if (durationNum < 1 || durationNum > 4) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hour + durationNum > 24) {
            return { success: false, message: 'Class duration extends beyond the end of the day.' };
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return { success: false, message: 'Instructor not found.' };
        }

        // ---- PHASE 2: CHECK CONFLICTS ----
        var data = ensureCurriculumStructure();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.curriculum.schedules[studentId]) {
            data.curriculum.schedules[studentId] = {};
        }

        if (!data.curriculum.schedules[studentId][weekNum]) {
            data.curriculum.schedules[studentId][weekNum] = {};
        }

        var schedule = data.curriculum.schedules[studentId][weekNum];

        // Check for conflicts
        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            if (schedule[day] && schedule[day][h]) {
                var existingDiscipline = getDiscipline(schedule[day][h]);
                var existingName = existingDiscipline ? existingDiscipline.name : 'Unknown';
                return { success: false, message: 'Student already has a class during this time: ' + existingName };
            }
        }

        // Check weekly hour limit
        var usedHours = {};
        for (var d in schedule) {
            if (!isObject(schedule[d])) continue;
            for (var h in schedule[d]) {
                var discId = schedule[d][h];
                if (discId) {
                    if (!usedHours[discId]) usedHours[discId] = 0;
                    usedHours[discId]++;
                }
            }
        }

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
            data.curriculum.classInstructors[key] = instructorId;
        } else {
            delete data.curriculum.classInstructors[key];
        }

        data.curriculum.classDurations[key] = durationNum;

        logActivity('Added class to schedule: ' + discipline.name);
        return { success: true };
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return { success: false, message: 'Schedule not found.' };
        }

        if (!data.curriculum.schedules[studentId] || !data.curriculum.schedules[studentId][weekNum]) {
            return { success: false, message: 'No schedule for this student and week.' };
        }

        var schedule = data.curriculum.schedules[studentId][weekNum];
        if (!schedule[day] || !schedule[day][hour]) {
            return { success: false, message: 'No class at this time.' };
        }

        // Find class start and duration
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

        // ---- PHASE 3: APPLY ----
        for (var h = startHour; h <= endHour; h++) {
            delete schedule[day][h];
        }

        var key = getScheduleKey(studentId, weekNum, day, startHour);
        delete data.curriculum.classInstructors[key];
        delete data.curriculum.classLabels[key];
        delete data.curriculum.classGroupLabels[key];
        delete data.curriculum.classDurations[key];

        // Clean up empty day
        if (schedule[day] && Object.keys(schedule[day]).length === 0) {
            delete schedule[day];
        }

        logActivity('Removed class from schedule');
        return { success: true };
    }

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return { success: false, message: 'Valid source week is required.' };
        }

        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return { success: false, message: 'Valid target week is required.' };
        }

        if (sourceWeekNum === targetWeekNum) {
            return { success: false, message: 'Source and target weeks must be different.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var data = ensureCurriculumStructure();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.curriculum.schedules[studentId]) {
            data.curriculum.schedules[studentId] = {};
        }

        var sourceSchedule = data.curriculum.schedules[studentId][sourceWeekNum] || {};
        var destSchedule = data.curriculum.schedules[studentId][targetWeekNum] || {};

        // ---- PHASE 3: CLEAR TARGET (if overwrite) ----
        if (overwrite) {
            var targetKeyPrefix = studentId + '_' + targetWeekNum + '_';

            for (var day in destSchedule) {
                delete destSchedule[day];
            }

            if (data.curriculum.classInstructors) {
                for (var key in data.curriculum.classInstructors) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete data.curriculum.classInstructors[key];
                    }
                }
            }

            if (data.curriculum.classLabels) {
                for (var key in data.curriculum.classLabels) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete data.curriculum.classLabels[key];
                    }
                }
            }

            if (data.curriculum.classGroupLabels) {
                for (var key in data.curriculum.classGroupLabels) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete data.curriculum.classGroupLabels[key];
                    }
                }
            }

            if (data.curriculum.classDurations) {
                for (var key in data.curriculum.classDurations) {
                    if (key.indexOf(targetKeyPrefix) === 0) {
                        delete data.curriculum.classDurations[key];
                    }
                }
            }
        }

        // ---- PHASE 4: COPY ----
        var copiedCount = 0;
        if (!data.curriculum.schedules[studentId][targetWeekNum]) {
            data.curriculum.schedules[studentId][targetWeekNum] = {};
        }

        var destScheduleRef = data.curriculum.schedules[studentId][targetWeekNum];

        for (var day in sourceSchedule) {
            if (!isObject(sourceSchedule[day])) continue;
            if (!destScheduleRef[day]) destScheduleRef[day] = {};

            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInt(hour, 10);
                var sourceKey = studentId + '_' + sourceWeekNum + '_' + day + '_' + hourNum;
                var duration = data.curriculum.classDurations && data.curriculum.classDurations[sourceKey]
                    ? data.curriculum.classDurations[sourceKey]
                    : null;

                if (!duration) continue;

                if (!destScheduleRef[day][hour] || overwrite) {
                    var disciplineId = sourceSchedule[day][hour];
                    for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                        destScheduleRef[day][h] = disciplineId;
                    }
                    copiedCount++;

                    var targetKey = studentId + '_' + targetWeekNum + '_' + day + '_' + hourNum;

                    if (data.curriculum.classInstructors && data.curriculum.classInstructors[sourceKey]) {
                        data.curriculum.classInstructors[targetKey] = data.curriculum.classInstructors[sourceKey];
                    }
                    if (data.curriculum.classLabels && data.curriculum.classLabels[sourceKey]) {
                        data.curriculum.classLabels[targetKey] = data.curriculum.classLabels[sourceKey];
                    }
                    if (data.curriculum.classGroupLabels && data.curriculum.classGroupLabels[sourceKey]) {
                        data.curriculum.classGroupLabels[targetKey] = data.curriculum.classGroupLabels[sourceKey];
                    }
                    if (duration) {
                        if (!data.curriculum.classDurations) data.curriculum.classDurations = {};
                        data.curriculum.classDurations[targetKey] = duration;
                    }
                }
            }
        }

        // Copy rest days
        if (data.curriculum.restDays && data.curriculum.restDays[studentId]) {
            var sourceRestDays = data.curriculum.restDays[studentId][sourceWeekNum];
            if (sourceRestDays && sourceRestDays.length > 0) {
                if (!data.curriculum.restDays[studentId]) data.curriculum.restDays[studentId] = {};
                data.curriculum.restDays[studentId][targetWeekNum] = sourceRestDays.slice();
            }
        }

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum);
        return { success: true, copiedCount: copiedCount };
    }

    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
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

        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }

        delete schedule[weekNum];

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

        logActivity('Cleared schedule for week ' + weekNum);
        return { success: true };
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

        return data.curriculum.restDays[studentId][weekNum];
    }

    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!Array.isArray(days)) {
            return { success: false, message: 'Rest days must be an array.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = ensureCurriculumStructure();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.curriculum.restDays[studentId]) {
            data.curriculum.restDays[studentId] = {};
        }

        var validDays = days.filter(function(d) {
            return isSafeInteger(d) && d >= 1 && d <= 7;
        });

        data.curriculum.restDays[studentId][weekNum] = validDays;

        // Remove classes on rest days
        if (data.curriculum.schedules && data.curriculum.schedules[studentId] &&
            data.curriculum.schedules[studentId][weekNum]) {
            var schedule = data.curriculum.schedules[studentId][weekNum];
            validDays.forEach(function(day) {
                if (schedule[day]) {
                    // Remove all classes on this rest day
                    var keyPrefix = studentId + '_' + weekNum + '_' + day + '_';
                    for (var hour in schedule[day]) {
                        var key = keyPrefix + hour;
                        delete data.curriculum.classInstructors[key];
                        delete data.curriculum.classLabels[key];
                        delete data.curriculum.classGroupLabels[key];
                        delete data.curriculum.classDurations[key];
                    }
                    delete schedule[day];
                }
            });
        }

        logActivity('Set rest days for student week ' + weekNum);
        return { success: true };
    }

    // ============================================================
    // INSTRUCTOR CALENDAR OPERATIONS
    // ============================================================

    function getInstructorTemplates(instructorId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorTemplates) {
            return {};
        }

        var templateKey = instructorId + '_' + weekNum;
        return data.curriculum.instructorTemplates[templateKey] || {};
    }

    function setInstructorTemplate(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        if (!data || !isNonEmptyString(data.disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = getDiscipline(data.disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var duration = parsePositiveInteger(data.duration) || 1;
        if (duration < 1 || duration > 4) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hour + duration > 24) {
            return { success: false, message: 'Class duration extends beyond the end of the day.' };
        }

        // ---- PHASE 2: APPLY ----
        var store = ensureCurriculumStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var templateKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorTemplates[templateKey]) {
            store.curriculum.instructorTemplates[templateKey] = {};
        }

        var classKey = day + '_' + hour;

        // Check for existing template
        if (store.curriculum.instructorTemplates[templateKey][classKey]) {
            return { success: false, message: 'Class template already exists at this time.' };
        }

        store.curriculum.instructorTemplates[templateKey][classKey] = {
            disciplineId: String(data.disciplineId),
            label: data.label || '',
            groupLabel: data.groupLabel || '',
            duration: duration,
            assignedStudents: Array.isArray(data.assignedStudents) ? data.assignedStudents.slice() : []
        };

        logActivity('Added instructor class template: ' + discipline.name);
        return { success: true };
    }

    function removeInstructorTemplate(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorTemplates) {
            return { success: false, message: 'No instructor templates found.' };
        }

        var templateKey = instructorId + '_' + weekNum;
        if (!data.curriculum.instructorTemplates[templateKey]) {
            return { success: false, message: 'No template for this instructor and week.' };
        }

        var classKey = day + '_' + hour;
        if (!data.curriculum.instructorTemplates[templateKey][classKey]) {
            return { success: false, message: 'No class template at this time.' };
        }

        delete data.curriculum.instructorTemplates[templateKey][classKey];

        if (Object.keys(data.curriculum.instructorTemplates[templateKey]).length === 0) {
            delete data.curriculum.instructorTemplates[templateKey];
        }

        logActivity('Removed instructor class template');
        return { success: true };
    }

    function getInstructorBlocks(instructorId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorBlocks) {
            return {};
        }

        var blockKey = instructorId + '_' + weekNum;
        return data.curriculum.instructorBlocks[blockKey] || {};
    }

    function setInstructorBlock(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        if (!data || typeof data !== 'object') {
            return { success: false, message: 'Block data is required.' };
        }

        var duration = parsePositiveInteger(data.duration) || 1;
        if (duration < 1 || duration > 4) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hour + duration > 24) {
            return { success: false, message: 'Block duration extends beyond the end of the day.' };
        }

        // ---- PHASE 2: APPLY ----
        var store = ensureCurriculumStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var blockKey = instructorId + '_' + weekNum;
        if (!store.curriculum.instructorBlocks[blockKey]) {
            store.curriculum.instructorBlocks[blockKey] = {};
        }
        if (!store.curriculum.instructorBlocks[blockKey][day]) {
            store.curriculum.instructorBlocks[blockKey][day] = {};
        }

        // Check for conflict
        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (store.curriculum.instructorBlocks[blockKey][day][h]) {
                return { success: false, message: 'Time slot already has a block.' };
            }
        }

        store.curriculum.instructorBlocks[blockKey][day][hour] = {
            label: data.label || 'Blocked Time',
            groupLabel: data.groupLabel || null,
            duration: duration,
            disciplineId: data.disciplineId || null
        };

        var autoAssignedCount = 0;

        // Auto-assign students if groupLabel and disciplineId provided
        if (data.groupLabel && data.disciplineId) {
            var disciplineId = data.disciplineId;
            var groupLabel = data.groupLabel;
            var students = window.getStudents ? window.getStudents() : [];

            var groupStudents = [];
            if (typeof window.getDisciplineGroups === 'function') {
                var groups = window.getDisciplineGroups(disciplineId);
                if (groups && groups[groupLabel] && groups[groupLabel].students) {
                    groupStudents = Object.keys(groups[groupLabel].students);
                }
            }

            groupStudents.forEach(function(studentId) {
                var schedule = getStudentSchedule(studentId, weekNum);
                var hasConflict = false;
                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        hasConflict = true;
                        break;
                    }
                }

                if (!hasConflict) {
                    var result = setStudentScheduleClass(
                        studentId,
                        weekNum,
                        day,
                        hour,
                        disciplineId,
                        duration,
                        instructorId
                    );

                    if (result && result.success) {
                        var key = getScheduleKey(studentId, weekNum, day, hour);
                        if (data.label) {
                            store.curriculum.classLabels[key] = data.label;
                        }
                        if (groupLabel) {
                            store.curriculum.classGroupLabels[key] = groupLabel;
                        }
                        autoAssignedCount++;
                    }
                }
            });
        }

        logActivity('Added instructor block');
        return { success: true, autoAssignedCount: autoAssignedCount };
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorBlocks) {
            return { success: false, message: 'No instructor blocks found.' };
        }

        var blockKey = instructorId + '_' + weekNum;
        if (!data.curriculum.instructorBlocks[blockKey] ||
            !data.curriculum.instructorBlocks[blockKey][day] ||
            !data.curriculum.instructorBlocks[blockKey][day][hour]) {
            return { success: false, message: 'No block at this time.' };
        }

        // Remove associated classes from students if this block had a group
        var blockData = data.curriculum.instructorBlocks[blockKey][day][hour];
        if (blockData && blockData.groupLabel && blockData.disciplineId) {
            var students = window.getStudents ? window.getStudents() : [];
            students.forEach(function(student) {
                var schedule = getStudentSchedule(student.id, weekNum);
                for (var h = hour; h < hour + (blockData.duration || 1) && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h] === blockData.disciplineId) {
                        var classInstructorId = data.curriculum.classInstructors ?
                            data.curriculum.classInstructors[getScheduleKey(student.id, weekNum, day, h)] :
                            null;
                        if (classInstructorId && String(classInstructorId) === String(instructorId)) {
                            var result = removeStudentScheduleClass(student.id, weekNum, day, h);
                            if (!result || !result.success) {
                                // Continue anyway - best effort
                            }
                        }
                    }
                }
            });
        }

        delete data.curriculum.instructorBlocks[blockKey][day][hour];

        if (Object.keys(data.curriculum.instructorBlocks[blockKey][day]).length === 0) {
            delete data.curriculum.instructorBlocks[blockKey][day];
        }

        if (Object.keys(data.curriculum.instructorBlocks[blockKey]).length === 0) {
            delete data.curriculum.instructorBlocks[blockKey];
        }

        logActivity('Removed instructor block');
        return { success: true };
    }

    // ============================================================
    // LOCATION SCHEDULE OPERATIONS
    // ============================================================

    function getLocationSchedule(locationId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.locationSchedules) {
            return {};
        }

        var key = locationId + '_' + weekNum;
        if (data.locationSchedules[key]) {
            return data.locationSchedules[key];
        }
        return {};
    }

    function setLocationClass(locationId, week, day, hour, disciplineId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return { success: false, message: 'Location ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.locationSchedules) {
            data.locationSchedules = {};
        }

        var key = locationId + '_' + weekNum;
        if (!data.locationSchedules[key]) {
            data.locationSchedules[key] = {};
        }
        if (!data.locationSchedules[key][day]) {
            data.locationSchedules[key][day] = {};
        }

        data.locationSchedules[key][day][hour] = disciplineId;

        logActivity('Assigned class to location: ' + discipline.name);
        return { success: true };
    }

    function removeLocationClass(locationId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return { success: false, message: 'Location ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.locationSchedules) {
            return { success: false, message: 'No location schedules found.' };
        }

        var key = locationId + '_' + weekNum;
        if (!data.locationSchedules[key] || !data.locationSchedules[key][day]) {
            return { success: false, message: 'No schedule for this day.' };
        }

        if (!data.locationSchedules[key][day][hour]) {
            return { success: false, message: 'No class at this time.' };
        }

        delete data.locationSchedules[key][day][hour];

        if (Object.keys(data.locationSchedules[key][day]).length === 0) {
            delete data.locationSchedules[key][day];
        }

        if (Object.keys(data.locationSchedules[key]).length === 0) {
            delete data.locationSchedules[key];
        }

        logActivity('Removed class from location');
        return { success: true };
    }

    function clearLocationSchedule(locationId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return { success: false, message: 'Location ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.locationSchedules) {
            return { success: false, message: 'No location schedules found.' };
        }

        var key = locationId + '_' + weekNum;
        if (data.locationSchedules[key]) {
            delete data.locationSchedules[key];
        }

        logActivity('Cleared location schedule for week ' + weekNum);
        return { success: true };
    }

    function getClassLocation(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return null;
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return null;
        }

        // ---- PHASE 2: LOOKUP ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.classLocations) {
            return null;
        }

        var key = getScheduleKey(studentId, weekNum, day, hour);
        if (data.curriculum.classLocations[key]) {
            return data.curriculum.classLocations[key];
        }
        return null;
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required.' };
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return { success: false, message: 'Valid day is required.' };
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return { success: false, message: 'Valid hour is required.' };
        }

        if (locationId && !isNonEmptyString(locationId)) {
            return { success: false, message: 'Valid location ID is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = ensureCurriculumStructure();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        var key = getScheduleKey(studentId, weekNum, day, hour);

        if (locationId) {
            data.curriculum.classLocations[key] = locationId;
        } else {
            delete data.curriculum.classLocations[key];
        }

        return { success: true };
    }

    // ============================================================
    // SHARED GRID HELPERS
    // ============================================================

    function buildGrid(schedule, options) {
        options = options || {};
        var grid = {};

        var days = options.days || [1, 2, 3, 4, 5, 6, 7];
        var hours = options.hours || [];

        for (var h = 5; h <= 23; h++) {
            hours.push(h);
        }

        days.forEach(function(day) {
            grid[day] = {};
            hours.forEach(function(hour) {
                var isOccupied = schedule && schedule[day] && schedule[day][hour];
                grid[day][hour] = {
                    occupied: !!isOccupied,
                    disciplineId: isOccupied || null,
                    duration: 1,
                    students: [],
                    label: null,
                    groupLabel: null,
                    instructorId: null
                };
            });
        });

        return grid;
    }

    function getOccupiedHours(schedule, day) {
        var occupied = {};
        if (!schedule || !schedule[day]) return occupied;

        for (var hour in schedule[day]) {
            if (schedule[day][hour]) {
                occupied[hour] = true;
            }
        }
        return occupied;
    }

    function getAvailableSlots(schedule, day, startHour, endHour) {
        startHour = startHour || 5;
        endHour = endHour || 23;
        var available = [];

        if (!schedule || !schedule[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!schedule[day][h]) {
                available.push(h);
            }
        }
        return available;
    }

    function hasConflict(schedule, day, hour, duration) {
        duration = duration || 1;

        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    function getMaxContinuous(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return 0;
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

        return endHour - startHour + 1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarCore = {
        // Student Schedule
        getStudentSchedule: getStudentSchedule,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        duplicateStudentSchedule: duplicateStudentSchedule,
        clearStudentSchedule: clearStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        setStudentRestDays: setStudentRestDays,

        // Instructor Calendar
        getInstructorTemplates: getInstructorTemplates,
        setInstructorTemplate: setInstructorTemplate,
        removeInstructorTemplate: removeInstructorTemplate,
        getInstructorBlocks: getInstructorBlocks,
        setInstructorBlock: setInstructorBlock,
        removeInstructorBlock: removeInstructorBlock,

        // Location Schedule
        getLocationSchedule: getLocationSchedule,
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,
        clearLocationSchedule: clearLocationSchedule,
        getClassLocation: getClassLocation,
        setClassLocation: setClassLocation,

        // Shared Helpers
        buildGrid: buildGrid,
        getOccupiedHours: getOccupiedHours,
        getAvailableSlots: getAvailableSlots,
        hasConflict: hasConflict,
        getMaxContinuous: getMaxContinuous,

        // Utilities
        getScheduleKey: getScheduleKey,
        validateWeek: validateWeek
    };

})();
