/**
 * js/core/curriculum/curriculum-location-schedule.js - Location Schedule Operations
 * Path: js/core/curriculum/curriculum-location-schedule.js
 * 
 * This module provides location schedule CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Location schedules are stored as: locationSchedules[locationId_week][day][hour] = disciplineId
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumLocationScheduleLoaded) {
        return;
    }
    window.__curriculumLocationScheduleLoaded = true;

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

    function getLocation(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }
        return data.locations.find(function(l) {
            return l && String(l.id) === String(id);
        }) || null;
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function normaliseId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumLocationSchedule: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumLocationSchedule: JSON clone failed:', e);
            return null;
        }
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

    // ============================================================
    // LOCATION SCHEDULE QUERIES
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
            return deepClone(data.locationSchedules[key]) || {};
        }
        return {};
    }

    function getClassLocation(studentId, week, day, hour) {
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

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.classLocations) {
            return null;
        }

        var key = studentId + '_' + weekNum + '_' + day + '_' + hour;
        if (data.curriculum.classLocations[key]) {
            return data.curriculum.classLocations[key];
        }

        return null;
    }

    function getLocationClassDuration(locationId, week, day, hour) {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.classDurations) {
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

        var key = locationId + '_' + weekNum + '_' + day + '_' + hour;
        if (data.curriculum.classDurations[key]) {
            var duration = Number(data.curriculum.classDurations[key]);
            if (isSafeInteger(duration) && duration >= 1 && duration <= 4) {
                return duration;
            }
        }

        return null;
    }

    // ============================================================
    // LOCATION SCHEDULE MUTATIONS
    // ============================================================

    function setLocationClass(locationId, week, day, hour, disciplineId) {
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return failure('Valid day is required (1-7).');
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
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

        var location = getLocation(normalisedLocationId);
        if (!location) {
            return failure('Location not found.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var candidateSchedules = deepClone(data.locationSchedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!candidateSchedules[key]) {
            candidateSchedules[key] = {};
        }
        if (!candidateSchedules[key][day]) {
            candidateSchedules[key][day] = {};
        }

        candidateSchedules[key][day][hour] = normalisedDisciplineId;

        data.locationSchedules = candidateSchedules;

        logActivity('Assigned class to location: ' + discipline.name);
        return { success: true, assigned: true };
    }

    function removeLocationClass(locationId, week, day, hour) {
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return failure('Valid day is required (1-7).');
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return failure('Valid hour is required (0-23).');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.locationSchedules) {
            return failure('No location schedules found.');
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!data.locationSchedules[key] || !data.locationSchedules[key][day]) {
            return failure('No schedule for this day.');
        }

        if (!data.locationSchedules[key][day][hour]) {
            return failure('No class at this time.');
        }

        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key][day][hour];

        if (Object.keys(candidateSchedules[key][day]).length === 0) {
            delete candidateSchedules[key][day];
        }

        if (Object.keys(candidateSchedules[key]).length === 0) {
            delete candidateSchedules[key];
        }

        data.locationSchedules = candidateSchedules;

        logActivity('Removed class from location');
        return { success: true, removed: true };
    }

    function clearLocationSchedule(locationId, week) {
        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId === null) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.locationSchedules) {
            return success({ cleared: false, message: 'No location schedules found.' });
        }

        var key = normalisedLocationId + '_' + weekNum;
        if (!data.locationSchedules[key]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key];

        data.locationSchedules = candidateSchedules;

        logActivity('Cleared location schedule for week ' + weekNum);
        return { success: true, cleared: true };
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isSafeInteger(day) || day < 1 || day > 7) {
            return failure('Valid day is required (1-7).');
        }

        if (!isSafeInteger(hour) || hour < 0 || hour > 23) {
            return failure('Valid hour is required (0-23).');
        }

        var normalisedLocationId = normaliseId(locationId);
        if (normalisedLocationId && !getLocation(normalisedLocationId)) {
            return failure('Location not found.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // Verify class exists at this hour
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[weekNum];
        if (!weekSchedule[day] || !weekSchedule[day][hour]) {
            return failure('No class at this time.');
        }

        // Find class start
        var disciplineId = weekSchedule[day][hour];

        var startHour = hour;
        while (startHour > 0 && weekSchedule[day][startHour - 1] === disciplineId) {
            startHour--;
        }

        var key = studentId + '_' + weekNum + '_' + day + '_' + startHour;

        var candidateLocations = deepClone(data.curriculum.classLocations || {});
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        if (normalisedLocationId) {
            candidateLocations[key] = normalisedLocationId;
        } else {
            delete candidateLocations[key];
        }

        data.curriculum.classLocations = candidateLocations;

        return { success: true, set: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getLocationSchedule = getLocationSchedule;
    window.getClassLocation = getClassLocation;
    window.getLocationClassDuration = getLocationClassDuration;

    // Mutations
    window.setLocationClass = setLocationClass;
    window.removeLocationClass = removeLocationClass;
    window.clearLocationSchedule = clearLocationSchedule;
    window.setClassLocation = setClassLocation;

})();
