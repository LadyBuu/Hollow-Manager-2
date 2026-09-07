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
 *   - All deep cloning uses ObjectUtils.deepClone (MANDATORY)
 *   - All ID normalisation is consistent
 *   - getClassLocation() resolves continuation hours to the class start
 *   - setClassLocation() resolves continuation hours to the class start
 *   - All validation uses CalendarValidation from calendar-validation.js
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.CalendarMetadataCore (from metadata-core.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.LocationQueries (from location-queries.js) - MANDATORY
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarLocationCoreLoaded) {
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

    if (!window.CalendarScheduleCore) {
        missing.push('CalendarScheduleCore');
    }

    if (!window.CalendarMetadataCore) {
        missing.push('CalendarMetadataCore');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (!window.LocationQueries || typeof window.LocationQueries.getLocation !== 'function') {
        missing.push('LocationQueries.getLocation');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarLocationCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__calendarLocationCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var ScheduleCore = window.CalendarScheduleCore;
    var MetadataCore = window.CalendarMetadataCore;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;

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

    function getScheduleKey(studentId, week, day, hour) {
        return ScheduleCore.getScheduleKey(studentId, week, day, hour);
    }

    function getValidClassDuration(metadata, key) {
        return MetadataCore.getValidClassDuration(metadata, key);
    }

    function buildMetadataCandidates(curriculum) {
        return MetadataCore.buildCandidates(curriculum);
    }

    function commitMetadataCandidates(curriculum, metadataCandidates) {
        MetadataCore.commitCandidates(curriculum, metadataCandidates);
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = window.data;
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

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var normalisedDisciplineId = normaliseId(disciplineId);
        if (normalisedDisciplineId === null) {
            return failure('Discipline ID is required.');
        }

        var discipline = DisciplineQueries.getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var location = LocationQueries.getLocation(normalisedLocationId);
        if (!location) {
            return failure('Location not found.');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = window.data;
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

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = window.data;
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

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = window.data;
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

        return success({ cleared: true });
    }

    // ============================================================
    // CLASS LOCATION RESOLUTION
    // ============================================================

    /**
     * Get the location of a class.
     * Resolves continuation hours to the class start.
     */
    function getClassLocation(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: GET DATA ----
        var data = window.data;
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

        var classStart = ScheduleCore.findClassStartHour(
            weekSchedule,
            metadata.classDurations,
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

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

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId && !LocationQueries.getLocation(normalisedLocationId)) {
            return failure('Location not found.');
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

        // ---- PHASE 3: VERIFY CLASS EXISTS AT THIS HOUR ----
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
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

        var classStart = ScheduleCore.findClassStartHour(
            weekSchedule,
            metadata.classDurations,
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

        if (!classStart) {
            return failure('No valid class start found for this hour.');
        }

        // ---- PHASE 5: BUILD CANDIDATES ----
        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var key = getScheduleKey(studentId, weekNum, dayNum, classStart.startHour);

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