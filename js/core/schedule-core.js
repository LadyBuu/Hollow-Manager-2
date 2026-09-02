/**
 * core/schedule-core.js - Schedule Core Operations
 * Single source of truth for all student schedule-related data mutations
 * Path: js/core/schedule-core.js
 * 
 * This module handles:
 *   - Student schedule CRUD (get, set, remove, clear)
 *   - Schedule duplication between weeks (TRANSACTIONAL)
 *   - Rest days management
 *   - Schedule conflict detection
 *   - Weekly hour limit enforcement
 *   - Class metadata (instructor, label, duration, location)
 * 
 * IMPORTANT:
 *   - All MUTATION operations return an object with { success: boolean }.
 *   - Failure results include { message: string }.
 *   - Successful operations may include operation-specific result fields.
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 * 
 * MUTATION INVARIANT (CANDIDATE-BASED COMMIT):
 *   - All mutations build candidates BEFORE touching any live state
 *   - 1. Validate inputs
 *   - 2. Validate live state structure exists (read-only)
 *   - 3. Build candidate (deep clone)
 *   - 4. Apply validated changes to candidate
 *   - 5. Pre-clone result data (safe)
 *   - 6. COMMIT candidate to data store
 *   - 7. If any step before commit fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before all validation completes
 *   - This is a candidate-based commit, not a database transaction
 * 
 * SCHEDULE SEMANTICS:
 *   - Schedules are stored as: schedules[studentId][week][day][hour] = disciplineId
 *   - Multi-hour classes occupy every hour in the array
 *   - Class metadata (instructor, label, duration) is stored at the START hour only
 *   - Metadata key format: studentId_week_day_startHour
 *   - Rest days are stored as: restDays[studentId][week] = [days]
 *   - Weekly hour limits are enforced per discipline
 *   - Duplication is transactional: validates source before clearing target
 *   - setClassDuration() validates class exists before setting metadata
 * 
 * DEPENDENCIES:
 *   - window.data (global state)
 *   - window.getDiscipline (from core-utils.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__scheduleCoreLoaded) {
        return;
    }
    window.__scheduleCoreLoaded = true;

    // ============================================================
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_WEEK : 1;
    var MAX_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_WEEK : 52;
    var MIN_DAY = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_DAY : 1;
    var MAX_DAY = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_DAY : 7;
    var MIN_HOUR = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_HOUR : 0;
    var MAX_HOUR = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_HOUR : 23;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = ['getDiscipline', 'getCharacterById'];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (!window.CoreUtils || typeof window.CoreUtils.deepClone !== 'function') {
            missing.push('CoreUtils.deepClone');
        }

        if (!window.MutationUtils || typeof window.MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }

        if (missing.length > 0) {
            console.warn('ScheduleCore: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

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

        if (typeof window.logActivity !== 'function') {
            return;
        }

        try {
            window.logActivity(message, type);
        } catch (e) {
            console.error('ScheduleCore: activity logging failed:', e);
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

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK ? num : null;
    }

    function validateDay(value) {
        // Use parseSafeInteger from CoreUtils if available
        if (window.CoreUtils && typeof window.CoreUtils.parseStrictPositivePeriod === 'function') {
            var parsed = window.CoreUtils.parseStrictPositivePeriod(value);
            return parsed !== null && parsed >= MIN_DAY && parsed <= MAX_DAY ? parsed : null;
        }

        // Fallback
        if (!isSafeInteger(value)) return null;
        var num = Number(value);
        return num >= MIN_DAY && num <= MAX_DAY ? num : null;
    }

    function validateHour(value) {
        // Use parseSafeInteger from CoreUtils if available
        if (window.CoreUtils && typeof window.CoreUtils.parseStrictPositivePeriod === 'function') {
            var parsed = window.CoreUtils.parseStrictPositivePeriod(value);
            // Hours can be 0-23, so we need to handle 0 specially
            if (value === 0 || value === '0') {
                return 0;
            }
            return parsed !== null && parsed >= MIN_HOUR && parsed <= MAX_HOUR ? parsed : null;
        }

        // Fallback
        if (!isSafeInteger(value)) return null;
        var num = Number(value);
        return num >= MIN_HOUR && num <= MAX_HOUR ? num : null;
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
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { valid: false, message: 'Valid day is required (' + MIN_DAY + '-' + MAX_DAY + ').' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { valid: false, message: 'Valid hour is required (' + MIN_HOUR + '-' + MAX_HOUR + ').' };
        }

        return { valid: true, weekNum: weekNum, dayNum: dayNum, hourNum: hourNum };
    }

    function deepClone(value) {
        if (window.CoreUtils && typeof window.CoreUtils.deepClone === 'function') {
            return window.CoreUtils.deepClone(value);
        }

        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('ScheduleCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('ScheduleCore: JSON clone failed:', e);
            return null;
        }
    }

    function getScheduleStore() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            return null;
        }

        return data;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
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
    // SCHEDULE QUERIES (with cloning for safety)
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

        // Clone to prevent external mutation
        var weekSchedule = studentSchedule[weekNum];
        var result = {};
        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
            var daySchedule = weekSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;
            result[day] = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
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
        if (!schedule[validation.dayNum] || !schedule[validation.dayNum][validation.hourNum]) {
            return null;
        }

        return schedule[validation.dayNum][validation.hourNum];
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
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var discId = daySchedule[hour];
                if (discId) {
                    if (!disciplineHours[discId]) disciplineHours[discId] = 0;
                    disciplineHours[discId]++;
                }
            }
        }

        return disciplineHours;
    }

    function getStudentScheduleCount(studentId) {
        var schedule = getStudentSchedule(studentId, 1);
        var count = 0;

        for (var week in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, week)) continue;
            var weekData = schedule[week];
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
    // SCHEDULE MUTATIONS (candidate-based, NO live mutation)
    // ============================================================

    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

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

        if (hourNum + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: GET CURRENT STATE (read-only) ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
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

        // ---- PHASE 4: CHECK CONFLICTS ----
        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        if (!candidateSchedules[studentId][weekNum]) {
            candidateSchedules[studentId][weekNum] = {};
        }

        var schedule = candidateSchedules[studentId][weekNum];

        // Check for conflicts
        for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
            if (schedule[dayNum] && schedule[dayNum][h]) {
                var existingDiscipline = getDiscipline(schedule[dayNum][h]);
                var existingName = existingDiscipline ? existingDiscipline.name : 'Unknown';
                return failure('Student already has a class during this time: ' + existingName);
            }
        }

        // Check rest days
        var restDays = getStudentRestDays(studentId, weekNum);
        if (restDays.indexOf(dayNum) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // Check weekly hour limit
        var usedHours = getStudentDisciplineHourUsage(studentId, weekNum);
        var usedCount = usedHours[disciplineId] || 0;
        var maxHours = discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;

        if (usedCount + durationNum > maxHours) {
            return failure('This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.');
        }

        // ---- PHASE 5: APPLY CHANGES TO CANDIDATES ----
        if (!schedule[dayNum]) schedule[dayNum] = {};

        var key = getScheduleKey(studentId, weekNum, dayNum, hourNum);

        for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
            schedule[dayNum][h] = disciplineId;
        }

        if (instructorId) {
            candidateInstructors[key] = instructorId;
        } else {
            delete candidateInstructors[key];
        }

        candidateDurations[key] = durationNum;

        // ---- PHASE 6: COMMIT ----
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classDurations = candidateDurations;

        logActivity('Added class to schedule: ' + discipline.name);
        return successWithSchedule(schedule, 'added');
    }

    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        // ---- PHASE 2: GET CURRENT STATE (read-only) ----
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
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 3: FIND CLASS BOUNDARIES ----
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('Could not determine class structure.');
        }

        var disciplineId = classInfo.disciplineId;
        var startHour = classInfo.startHour;
        var duration = classInfo.duration;

        // ---- PHASE 4: BUILD CANDIDATES ----
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

        // ---- PHASE 5: REMOVE CLASS FROM CANDIDATES ----
        for (var h = startHour; h < startHour + duration && h <= 23; h++) {
            delete candidateSchedule[dayNum][h];
        }

        // Clean up empty day
        if (candidateSchedule[dayNum] && Object.keys(candidateSchedule[dayNum]).length === 0) {
            delete candidateSchedule[dayNum];
        }

        // Delete metadata at start hour only
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);
        delete candidateInstructors[key];
        delete candidateLabels[key];
        delete candidateGroupLabels[key];
        delete candidateDurations[key];
        delete candidateLocations[key];

        // ---- PHASE 6: COMMIT ----
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Removed class from schedule');
        return success({ deleted: true });
    }

    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 2: GET CURRENT STATE (read-only) ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum.schedules ||
            !store.curriculum.schedules[studentId] ||
            !store.curriculum.schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule found for this student and week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
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

        // ---- PHASE 4: CLEAR FROM CANDIDATES ----
        var keyPrefix = studentId + '_' + weekNum + '_';
        var weekSchedule = candidateSchedules[studentId][weekNum];

        // Clear schedule entries
        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }
        delete candidateSchedules[studentId][weekNum];

        // Clear metadata
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

        // ---- PHASE 5: COMMIT ----
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Cleared schedule for week ' + weekNum);
        return success({ cleared: true });
    }

    // ============================================================
    // SCHEDULE DUPLICATION - TRANSACTIONAL
    // ============================================================

    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return failure('Valid source week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return failure('Valid target week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (sourceWeekNum === targetWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        // ---- PHASE 2: GET CURRENT STATE (read-only) ----
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

        // ---- PHASE 3: BUILD COPY PLAN (read-only validation) ----
        var copyPlan = [];
        var sourceKeys = [];

        for (var day in sourceSchedule) {
            if (!Object.prototype.hasOwnProperty.call(sourceSchedule, day)) continue;
            var daySchedule = sourceSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var hourNum = parseInt(hour, 10);
                var disciplineId = daySchedule[hour];

                var sourceKey = getScheduleKey(studentId, sourceWeekNum, day, hourNum);
                var duration = store.curriculum.classDurations && store.curriculum.classDurations[sourceKey]
                    ? store.curriculum.classDurations[sourceKey]
                    : null;

                if (!duration) continue;

                // Only process start hours
                var classInfo = findClassStart(sourceSchedule, parseInt(day), hourNum);
                if (!classInfo || classInfo.startHour !== hourNum) continue;

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

                // Mark this key as processed (to avoid duplicates)
                sourceKeys.push(sourceKey);
            }
        }

        if (copyPlan.length === 0) {
            return success({ copied: false, count: 0, message: 'No classes to copy.' });
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
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

        // ---- PHASE 5: CLEAR TARGET (if overwrite) ----
        if (overwrite) {
            // Clear schedule
            if (candidateSchedules[studentId] && candidateSchedules[studentId][targetWeekNum]) {
                delete candidateSchedules[studentId][targetWeekNum];
            }

            // Clear metadata
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

        // ---- PHASE 6: APPLY COPY PLAN TO CANDIDATES ----
        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        if (!candidateSchedules[studentId][targetWeekNum]) {
            candidateSchedules[studentId][targetWeekNum] = {};
        }

        var targetSchedule = candidateSchedules[studentId][targetWeekNum];
        var copiedCount = 0;

        copyPlan.forEach(function(item) {
            var day = item.day;
            var hour = item.hour;
            var duration = item.duration;
            var disciplineId = item.disciplineId;

            // Check for conflicts
            if (!overwrite) {
                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (targetSchedule[day] && targetSchedule[day][h]) {
                        return; // Skip this class
                    }
                }
            }

            // Copy schedule
            if (!targetSchedule[day]) targetSchedule[day] = {};

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                targetSchedule[day][h] = disciplineId;
            }

            // Copy metadata at start hour
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
        });

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

        // ---- PHASE 7: COMMIT ----
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum + ' (' + copiedCount + ' classes)');
        return success({ copied: true, count: copiedCount });
    }

    // ============================================================
    // REST DAYS OPERATIONS
    // ============================================================

    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (!Array.isArray(days)) {
            return failure('Rest days must be an array.');
        }

        // ---- PHASE 2: GET CURRENT STATE (read-only) ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
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

        // ---- PHASE 4: APPLY TO CANDIDATES ----
        if (!candidateRestDays[studentId]) {
            candidateRestDays[studentId] = {};
        }

        var validDays = days.filter(function(d) {
            return validateDay(d) !== null;
        });

        candidateRestDays[studentId][weekNum] = validDays;

        // Remove classes on rest days
        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var schedule = candidateSchedules[studentId][weekNum];
            var keyPrefix = studentId + '_' + weekNum + '_';

            validDays.forEach(function(day) {
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
            });
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.restDays = candidateRestDays;
        store.curriculum.schedules = candidateSchedules;
        store.curriculum.classInstructors = candidateInstructors;
        store.curriculum.classLabels = candidateLabels;
        store.curriculum.classGroupLabels = candidateGroupLabels;
        store.curriculum.classDurations = candidateDurations;
        store.curriculum.classLocations = candidateLocations;

        logActivity('Set rest days for student week ' + weekNum);
        return success({ days: validDays });
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
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        // Find the class start hour
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return null;
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

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
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        if (instructorId && !getCharacterById(instructorId)) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: GET CURRENT STATE AND VALIDATE CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

        // ---- PHASE 3: BUILD CANDIDATE ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateInstructors = deepClone(store.curriculum.classInstructors || {});
        if (candidateInstructors === null) {
            return failure('Failed to prepare instructor data.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATE ----
        if (instructorId) {
            candidateInstructors[key] = instructorId;
        } else {
            delete candidateInstructors[key];
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.classInstructors = candidateInstructors;

        return success({ instructorId: instructorId });
    }

    function setClassLabel(studentId, week, day, hour, label) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        // ---- PHASE 2: GET CURRENT STATE AND VALIDATE CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

        // ---- PHASE 3: BUILD CANDIDATE ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateLabels = deepClone(store.curriculum.classLabels || {});
        if (candidateLabels === null) {
            return failure('Failed to prepare label data.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATE ----
        if (label !== undefined && label !== null && String(label).trim() !== '') {
            candidateLabels[key] = String(label).trim();
        } else {
            delete candidateLabels[key];
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.classLabels = candidateLabels;

        return success({ label: label });
    }

    function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        // ---- PHASE 2: GET CURRENT STATE AND VALIDATE CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

        // ---- PHASE 3: BUILD CANDIDATE ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateGroupLabels = deepClone(store.curriculum.classGroupLabels || {});
        if (candidateGroupLabels === null) {
            return failure('Failed to prepare group label data.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATE ----
        if (groupLabel !== undefined && groupLabel !== null && String(groupLabel).trim() !== '') {
            candidateGroupLabels[key] = String(groupLabel).trim();
        } else {
            delete candidateGroupLabels[key];
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.classGroupLabels = candidateGroupLabels;

        return success({ groupLabel: groupLabel });
    }

    function setClassDuration(studentId, week, day, hour, duration) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        // ---- PHASE 2: GET CURRENT STATE AND VALIDATE CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

        // ---- PHASE 3: BUILD CANDIDATE ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateDurations = deepClone(store.curriculum.classDurations || {});
        if (candidateDurations === null) {
            return failure('Failed to prepare duration data.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATE ----
        candidateDurations[key] = durationNum;

        // ---- PHASE 5: COMMIT ----
        store.curriculum.classDurations = candidateDurations;

        logActivity('Set duration for class: ' + durationNum + 'h');
        return success({ duration: durationNum });
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.weekNum;
        var dayNum = validation.dayNum;
        var hourNum = validation.hourNum;

        if (locationId && !isNonEmptyString(locationId)) {
            return failure('Valid location ID is required.');
        }

        // ---- PHASE 2: GET CURRENT STATE AND VALIDATE CLASS EXISTS ----
        var schedule = getStudentSchedule(studentId, weekNum);
        var classInfo = findClassStart(schedule, dayNum, hourNum);
        if (!classInfo) {
            return failure('No class exists at this time.');
        }

        var startHour = classInfo.startHour;
        var key = getScheduleKey(studentId, weekNum, dayNum, startHour);

        // ---- PHASE 3: BUILD CANDIDATE ----
        var store = getScheduleStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateLocations = deepClone(store.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATE ----
        if (locationId) {
            candidateLocations[key] = locationId;
        } else {
            delete candidateLocations[key];
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.classLocations = candidateLocations;

        return success({ locationId: locationId });
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
        validateDuration: validateDuration,
        findClassStart: findClassStart
    };

})();
