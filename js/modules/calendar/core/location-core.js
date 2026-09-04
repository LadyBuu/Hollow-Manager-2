/**
 * js/modules/calendar/core/location-core.js - Location Calendar Core
 * Location schedule operations for the calendar system
 * Path: js/modules/calendar/core/location-core.js
 * 
 * This module handles:
 *   - Location schedule CRUD operations
 *   - Location class assignment and removal
 *   - Class location resolution (finding where a class is located)
 *   - Location schedule clearing
 * 
 * IMPORTANT:
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone (or structuredClone fallback)
 *   - All ID normalisation is consistent
 *   - getClassLocation() resolves continuation hours to the class start
 *   - setClassLocation() resolves continuation hours to the class start
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.getDiscipline (from curriculum modules)
 *   - window.getLocation (from curriculum modules)
 *   - window.logActivity (for activity logging)
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarLocationCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        return;
    }

    window.__calendarLocationCoreLoaded = true;

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

    function getLocationById(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }
        for (var i = 0; i < data.locations.length; i++) {
            if (data.locations[i] && String(data.locations[i].id) === String(id)) {
                return data.locations[i];
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

    function validateLocationStructure(data) {
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (data.locationSchedules !== undefined && !isObject(data.locationSchedules)) {
            return { success: false, message: 'Location schedules data is corrupted.' };
        }

        return { success: true, data: data };
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

    function getValidClassDuration(metadata, key) {
        if (!metadata || !metadata.classDurations) {
            return null;
        }
        var duration = metadata.classDurations[key];
        if (duration === undefined || duration === null) {
            return null;
        }
        var num = parseInt(duration, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    /**
     * Find the class start hour for a given occupied hour.
     * Uses metadata to find the start, with occupancy fallback.
     * Returns null if no class start can be found.
     */
    function findClassStartHour(schedule, metadata, studentId, week, day, hour) {
        if (!schedule || !schedule[day]) {
            return null;
        }

        var disciplineId = schedule[day][hour];
        if (!disciplineId) {
            return null;
        }

        // First, check if this hour itself has metadata (is a start)
        var key = getScheduleKey(studentId, week, day, hour);
        var duration = getValidClassDuration(metadata, key);

        if (duration !== null) {
            // Validate that the duration matches the actual occupied cells
            var actualDuration = validateOccupiedDuration(schedule, day, hour, disciplineId);
            if (actualDuration !== null && duration === actualDuration) {
                return {
                    startHour: hour,
                    duration: duration,
                    disciplineId: disciplineId,
                    key: key
                };
            }
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hour - 1; candidate >= 0; candidate--) {
            if (String(schedule[day][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateKey = getScheduleKey(studentId, week, day, candidate);
            var candidateDuration = getValidClassDuration(metadata, candidateKey);

            if (candidateDuration !== null) {
                var actualDuration = validateOccupiedDuration(schedule, day, candidate, disciplineId);
                if (actualDuration !== null && candidateDuration === actualDuration) {
                    if (hour < candidate + candidateDuration) {
                        return {
                            startHour: candidate,
                            duration: candidateDuration,
                            disciplineId: disciplineId,
                            key: candidateKey
                        };
                    }
                }
                break;
            }
        }

        return null;
    }

    /**
     * Validate that occupied hours match the expected duration.
     * Returns the actual duration if consistent, null otherwise.
     */
    function validateOccupiedDuration(schedule, day, startHour, disciplineId) {
        var duration = 0;
        var maxHour = 23;

        for (var h = startHour; h <= maxHour; h++) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                duration++;
            } else {
                break;
            }
        }

        // Check that the class is contiguous - no gaps
        for (var h = startHour + duration; h <= Math.min(startHour + duration + 4, maxHour); h++) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                return null;
            }
        }

        return duration;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // LOCATION SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get a location schedule for a week.
     * Returns a cloned copy to prevent external mutation.
     */
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
            return deepClone(data.locationSchedules[key]) || {};
        }
        return {};
    }

    /**
     * Assign a class to a location.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function setLocationClass(locationId, week, day, hour, disciplineId) {
        // ---- PHASE 1: VALIDATE ----
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var normalisedDisciplineId = normaliseId(disciplineId);
        if (normalisedDisciplineId === null) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var location = getLocationById(normalisedLocationId);
        if (!location) {
            return failure('Location not found.');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!candidateSchedules[key]) {
            candidateSchedules[key] = {};
        }
        if (!candidateSchedules[key][dayNum]) {
            candidateSchedules[key][dayNum] = {};
        }

        // Overwrite without conflict detection (location assignment is replacement)
        candidateSchedules[key][dayNum][hourNum] = normalisedDisciplineId;

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Assigned class to location: ' + discipline.name);
        return success({ assigned: true });
    }

    /**
     * Remove a class from a location.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function removeLocationClass(locationId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        if (!data.locationSchedules) {
            return failure('No location schedules found.');
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!data.locationSchedules[key] || !data.locationSchedules[key][dayNum]) {
            return failure('No schedule for this day.');
        }

        if (!data.locationSchedules[key][dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key][dayNum][hourNum];

        if (Object.keys(candidateSchedules[key][dayNum]).length === 0) {
            delete candidateSchedules[key][dayNum];
        }

        if (Object.keys(candidateSchedules[key]).length === 0) {
            delete candidateSchedules[key];
        }

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Removed class from location');
        return success({ removed: true });
    }

    /**
     * Clear a location schedule for a week.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function clearLocationSchedule(locationId, week) {
        // ---- PHASE 1: VALIDATE ----
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        if (!data.locationSchedules) {
            return success({ cleared: false, message: 'No location schedules found.' });
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!data.locationSchedules[key]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key];

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Cleared location schedule for week ' + weekNum);
        return success({ cleared: true });
    }

    /**
     * Get the location of a class.
     * Resolves continuation hours to the class start.
     */
    function getClassLocation(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }

        // ---- PHASE 2: GET DATA ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.classLocations) {
            return null;
        }

        // ---- PHASE 3: FIND CLASS START ----
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return null;
        }

        var weekSchedule = studentSchedule[weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return null;
        }

        // Build metadata object for reading - no deep clone needed for queries
        var metadata = {
            classDurations: data.curriculum.classDurations || {},
            classInstructors: data.curriculum.classInstructors || {},
            classLabels: data.curriculum.classLabels || {},
            classGroupLabels: data.curriculum.classGroupLabels || {},
            classLocations: data.curriculum.classLocations || {}
        };

        var classStart = findClassStartHour(weekSchedule, metadata, studentId, weekNum, dayNum, hourNum);
        if (!classStart) {
            return null;
        }

        // Get the location from the start hour
        var key = getScheduleKey(studentId, weekNum, dayNum, classStart.startHour);
        if (data.curriculum.classLocations[key]) {
            return data.curriculum.classLocations[key];
        }

        return null;
    }

    /**
     * Set the location of a class.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function setClassLocation(studentId, week, day, hour, locationId) {
        // ---- PHASE 1: VALIDATE ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId && !getLocationById(normalisedLocationId)) {
            return failure('Location not found.');
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

        // ---- PHASE 3: VERIFY CLASS EXISTS AT THIS HOUR ----
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[validated.studentId];
        if (!studentSchedule || !studentSchedule[validated.week]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[validated.week];
        if (!weekSchedule[validated.day] || !weekSchedule[validated.day][validated.hour]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 4: FIND CLASS START ----
        var metadata = {
            classDurations: data.curriculum.classDurations || {},
            classInstructors: data.curriculum.classInstructors || {},
            classLabels: data.curriculum.classLabels || {},
            classGroupLabels: data.curriculum.classGroupLabels || {},
            classLocations: data.curriculum.classLocations || {}
        };

        var classStart = findClassStartHour(weekSchedule, metadata, validated.studentId, validated.week, validated.day, validated.hour);
        if (!classStart) {
            return failure('No valid class start found for this hour.');
        }

        // ---- PHASE 5: BUILD CANDIDATES ----
        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var key = getScheduleKey(validated.studentId, validated.week, validated.day, classStart.startHour);

        if (normalisedLocationId) {
            metadataCandidates.classLocations[key] = normalisedLocationId;
        } else {
            delete metadataCandidates.classLocations[key];
        }

        // ---- PHASE 6: COMMIT ----
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        return success({ set: true });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarLocationCore = {
        getLocationSchedule: getLocationSchedule,
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,
        clearLocationSchedule: clearLocationSchedule,
        getClassLocation: getClassLocation,
        setClassLocation: setClassLocation
    };

})();
