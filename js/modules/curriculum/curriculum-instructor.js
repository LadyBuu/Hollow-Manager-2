/**
 * js/core/curriculum/curriculum-instructor.js - Instructor Calendar Operations
 * Path: js/core/curriculum/curriculum-instructor.js
 * 
 * This module provides instructor calendar operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Instructor templates define scheduled teaching slots
 *   - Instructor blocks represent unavailable time
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumInstructorLoaded) {
        return;
    }
    window.__curriculumInstructorLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function parseSafeInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isSafeInteger(num) ? num : null;
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

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 1 && num <= 7 ? num : null;
    }

    function validateHour(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 0 && num <= 23 ? num : null;
    }

    function validateDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
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

    function hasDurationOverlap(entries, day, hour, duration) {
        if (!entries || !entries[day]) {
            return false;
        }

        var dayEntries = entries[day];

        for (var existingHour in dayEntries) {
            if (!Object.prototype.hasOwnProperty.call(dayEntries, existingHour)) {
                continue;
            }

            var existingStart = parseSafeInteger(existingHour);
            if (existingStart === null) {
                continue;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = validateDuration(entry && entry.duration);

            if (existingDuration === null) {
                var existingEnd = existingStart + 1;
                var newEnd = hour + duration;
                if (hour < existingEnd && existingStart < newEnd) {
                    return true;
                }
                continue;
            }

            var existingEnd = existingStart + existingDuration;
            var newEnd = hour + duration;

            if (hour < existingEnd && existingStart < newEnd) {
                return true;
            }
        }

        return false;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumInstructor: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumInstructor: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // INSTRUCTOR TEMPLATE OPERATIONS
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
        var templates = data.curriculum.instructorTemplates[templateKey] || {};

        var result = {};
        for (var key in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, key)) {
                continue;
            }
            result[key] = deepClone(templates[key]);
        }
        return result;
    }

    function addInstructorClassTemplate(instructorId, week, day, hour, data) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        if (!data || !isNonEmptyString(data.disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var normalisedDisciplineId = normaliseId(data.disciplineId);
        if (normalisedDisciplineId === null) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(data.duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var instructor = getCharacterById(normalisedInstructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        var assignedStudents = normaliseIdArray(data.assignedStudents);
        for (var i = 0; i < assignedStudents.length; i++) {
            var student = getCharacterById(assignedStudents[i]);
            if (!student) {
                return failure('Student not found: ' + assignedStudents[i]);
            }
        }

        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateTemplates = deepClone(store.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            candidateTemplates[templateKey] = {};
        }

        if (hasDurationOverlap(candidateTemplates[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with an existing template at this time.');
        }

        var classKey = dayNum + '_' + hourNum;

        candidateTemplates[templateKey][classKey] = {
            disciplineId: normalisedDisciplineId,
            label: data.label || '',
            groupLabel: data.groupLabel || '',
            duration: durationNum,
            assignedStudents: assignedStudents
        };

        store.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Added instructor class template: ' + discipline.name);
        return { success: true, added: true };
    }

    function removeInstructorClassTemplate(instructorId, week, day, hour) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var candidateTemplates = deepClone(data.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            return failure('No template for this instructor and week.');
        }

        var classKey = dayNum + '_' + hourNum;
        if (!candidateTemplates[templateKey][classKey]) {
            return failure('No class template at this time.');
        }

        delete candidateTemplates[templateKey][classKey];

        if (Object.keys(candidateTemplates[templateKey]).length === 0) {
            delete candidateTemplates[templateKey];
        }

        data.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Removed instructor class template');
        return { success: true, removed: true };
    }

    // ============================================================
    // INSTRUCTOR BLOCK OPERATIONS
    // ============================================================

    function getInstructorBlocks(instructorId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorBlocks) {
            return {};
        }

        var blockKey = normaliseId(instructorId) + '_' + weekNum;
        var blocks = data.curriculum.instructorBlocks[blockKey] || {};

        var result = {};
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) {
                continue;
            }
            result[day] = {};
            for (var hour in blocks[day]) {
                if (!Object.prototype.hasOwnProperty.call(blocks[day], hour)) {
                    continue;
                }
                result[day][hour] = deepClone(blocks[day][hour]);
            }
        }
        return result;
    }

    function addInstructorBlock(instructorId, week, day, hour, data) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        if (!data || typeof data !== 'object') {
            return failure('Block data is required.');
        }

        var durationNum = validateDuration(data.duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Block duration extends beyond the end of the day.');
        }

        var instructor = getCharacterById(normalisedInstructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        if (data.disciplineId) {
            var normalisedDisciplineId = normaliseId(data.disciplineId);
            if (normalisedDisciplineId !== null) {
                var discipline = getDiscipline(normalisedDisciplineId);
                if (!discipline) {
                    return failure('Discipline not found: ' + data.disciplineId);
                }
            }
        }

        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var candidateBlocks = deepClone(store.curriculum.instructorBlocks || {});
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        var blockKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateBlocks[blockKey]) {
            candidateBlocks[blockKey] = {};
        }
        if (!candidateBlocks[blockKey][dayNum]) {
            candidateBlocks[blockKey][dayNum] = {};
        }

        if (hasDurationOverlap(candidateBlocks[blockKey], dayNum, hourNum, durationNum)) {
            return failure('Time slot already has a block.');
        }

        var blockData = {
            label: data.label || 'Blocked Time',
            groupLabel: data.groupLabel || null,
            duration: durationNum
        };

        if (data.disciplineId) {
            var normDiscId = normaliseId(data.disciplineId);
            if (normDiscId !== null) {
                blockData.disciplineId = normDiscId;
            }
        }

        candidateBlocks[blockKey][dayNum][hourNum] = blockData;

        // Auto-assign students if group label provided
        var autoAssignedCount = 0;
        if (data.groupLabel && data.disciplineId) {
            // This would integrate with group-core in production
            autoAssignedCount = 0;
        }

        store.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Added instructor block');
        return { success: true, added: true, autoAssignedCount: autoAssignedCount };
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var candidateBlocks = deepClone(data.curriculum.instructorBlocks || {});
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        var blockKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateBlocks[blockKey] ||
            !candidateBlocks[blockKey][dayNum] ||
            !candidateBlocks[blockKey][dayNum][hourNum]) {
            return failure('No block at this time.');
        }

        delete candidateBlocks[blockKey][dayNum][hourNum];

        if (Object.keys(candidateBlocks[blockKey][dayNum]).length === 0) {
            delete candidateBlocks[blockKey][dayNum];
        }

        if (Object.keys(candidateBlocks[blockKey]).length === 0) {
            delete candidateBlocks[blockKey];
        }

        data.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Removed instructor block');
        return { success: true, removed: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Templates
    window.getInstructorTemplates = getInstructorTemplates;
    window.addInstructorClassTemplate = addInstructorClassTemplate;
    window.removeInstructorClassTemplate = removeInstructorClassTemplate;

    // Blocks
    window.getInstructorBlocks = getInstructorBlocks;
    window.addInstructorBlock = addInstructorBlock;
    window.removeInstructorBlock = removeInstructorBlock;

})();
