/**
 * js/core/curriculum/curriculum-instructor.js - Instructor Calendar Operations
 * Path: js/core/curriculum/curriculum-instructor.js
 * 
 * This module provides instructor calendar operations.
 * 
 * IMPORTANT:
 *   - All MUTATION operations return:
 *     { success: true, changed: boolean, operation: string, data: object, count: number }
 *     or { success: false, message: string }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Instructor templates define scheduled teaching slots
 *   - Instructor blocks represent unavailable time
 *   - Templates and blocks CANNOT overlap (mutually exclusive)
 *   - Malformed existing entries are REJECTED (fail closed)
 *   - Query results are DEEP CLONED to prevent external mutation
 *   - Mutation results are DEEP CLONED to prevent external mutation
 *   - Instructor IDs are validated in all operations (queries and mutations)
 *   - Calendar keys (day_hour) are validated in queries
 *   - Stale assignedStudent references are rejected
 * 
 * MUTATION RESULT CONTRACT:
 *   - addInstructorClassTemplate:
 *     { success: true, changed: true, operation: 'added', data: { template: object }, count: 1 }
 *   - removeInstructorClassTemplate:
 *     { success: true, changed: true, operation: 'removed', data: {}, count: 0 }
 *   - addInstructorBlock:
 *     { success: true, changed: true, operation: 'blocked', data: { block: object }, count: 1 }
 *   - removeInstructorBlock:
 *     { success: true, changed: true, operation: 'unblocked', data: {}, count: 0 }
 *   - All failures: { success: false, message: string }
 * 
 * INVARIANTS:
 *   - For a given instructor + week: templates ∩ blocks = ∅
 *   - Calendar keys must be in format: day_hour (day: 1-7, hour: 0-23)
 * 
 * DEPENDENCY SEMANTICS:
 *   - Prefers window.getDiscipline and window.getCharacterById if available
 *   - Falls back to direct data inspection for compatibility
 *   - Callers should ensure canonical core functions are loaded
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

    function isValidCalendarKey(key) {
        if (!isNonEmptyString(key)) {
            return false;
        }

        var parts = key.split('_');
        if (parts.length !== 2) {
            return false;
        }

        var day = parseSafeInteger(parts[0]);
        var hour = parseSafeInteger(parts[1]);

        return day !== null && day >= 1 && day <= 7 &&
               hour !== null && hour >= 0 && hour <= 23;
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

    /**
     * Check if a new duration-based entry overlaps with existing entries.
     * Returns true if overlap exists, false otherwise.
     * Treats malformed existing entries as overlaps (fail closed).
     */
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
                // Malformed key - treat as conflict (fail closed)
                return true;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = validateDuration(entry && entry.duration);

            // Malformed existing entry - treat as conflict (fail closed)
            if (existingDuration === null) {
                return true;
            }

            var existingEnd = existingStart + existingDuration;
            var newEnd = hour + duration;

            if (hour < existingEnd && existingStart < newEnd) {
                return true;
            }
        }

        return false;
    }

    /**
     * Validate that assigned students exist.
     * Returns true if all assigned students exist, false otherwise.
     */
    function validateAssignedStudents(assignedStudents) {
        if (!Array.isArray(assignedStudents) || assignedStudents.length === 0) {
            return true;
        }

        for (var i = 0; i < assignedStudents.length; i++) {
            var student = getCharacterById(assignedStudents[i]);
            if (!student) {
                return false;
            }
        }

        return true;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function successResult(operation, data, count) {
        var safeData = deepClone(data || {});
        if (safeData === null) {
            return failure('Failed to prepare operation result.');
        }

        return {
            success: true,
            changed: true,
            operation: operation || 'updated',
            data: safeData,
            count: typeof count === 'number' ? count : 1
        };
    }

    // ============================================================
    // INSTRUCTOR TEMPLATE OPERATIONS
    // ============================================================

    function getInstructorTemplates(instructorId, week) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return {};
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorTemplates) {
            return {};
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        var templates = data.curriculum.instructorTemplates[templateKey] || {};

        var result = {};
        for (var key in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, key)) {
                continue;
            }

            // Validate calendar key
            if (!isValidCalendarKey(key)) {
                continue;
            }

            var template = templates[key];
            if (!template || typeof template !== 'object') {
                continue;
            }

            if (!isNonEmptyString(template.disciplineId)) {
                continue;
            }

            var duration = validateDuration(template.duration);
            if (duration === null) {
                continue;
            }

            // Validate assigned students
            if (template.assignedStudents && !validateAssignedStudents(template.assignedStudents)) {
                continue;
            }

            result[key] = deepClone(template);
        }
        return result;
    }

    function addInstructorClassTemplate(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE INPUTS ----
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
            return failure('Template data is required.');
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
        if (!validateAssignedStudents(assignedStudents)) {
            return failure('One or more assigned students were not found.');
        }

        // ---- PHASE 2: GET STORE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum || typeof store.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE TEMPLATES ----
        var candidateTemplates = deepClone(store.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        // ---- PHASE 4: CLONE BLOCKS FOR OVERLAP CHECK (DO NOT COMMIT) ----
        var blocksForCheck = deepClone(store.curriculum.instructorBlocks || {});
        if (blocksForCheck === null) {
            return failure('Failed to prepare block data for overlap check.');
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            candidateTemplates[templateKey] = {};
        }

        // ---- PHASE 5: CHECK OVERLAPS ----
        // Check against existing templates
        if (hasDurationOverlap(candidateTemplates[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with an existing template at this time.');
        }

        // Check against existing blocks
        var blockKey = normalisedInstructorId + '_' + weekNum;
        if (blocksForCheck[blockKey] && hasDurationOverlap(blocksForCheck[blockKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with a blocked time.');
        }

        // ---- PHASE 6: ADD TEMPLATE ----
        var classKey = dayNum + '_' + hourNum;

        candidateTemplates[templateKey][classKey] = {
            disciplineId: normalisedDisciplineId,
            label: data.label || '',
            groupLabel: data.groupLabel || '',
            duration: durationNum,
            assignedStudents: assignedStudents
        };

        // ---- PHASE 7: COMMIT (TEMPLATES ONLY) ----
        store.curriculum.instructorTemplates = candidateTemplates;

        var template = candidateTemplates[templateKey][classKey];
        logActivity('Added instructor class template: ' + discipline.name);

        return successResult('added', { template: template }, 1);
    }

    function removeInstructorClassTemplate(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE INPUTS ----
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
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

        // Validate the template structure before deletion
        var template = candidateTemplates[templateKey][classKey];
        if (!template || typeof template !== 'object') {
            return failure('Template data is malformed.');
        }
        if (!isNonEmptyString(template.disciplineId)) {
            return failure('Template discipline is malformed.');
        }
        if (validateDuration(template.duration) === null) {
            return failure('Template duration is malformed.');
        }

        // ---- PHASE 4: REMOVE ----
        delete candidateTemplates[templateKey][classKey];

        if (Object.keys(candidateTemplates[templateKey]).length === 0) {
            delete candidateTemplates[templateKey];
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Removed instructor class template');
        return successResult('removed', {}, 0);
    }

    // ============================================================
    // INSTRUCTOR BLOCK OPERATIONS
    // ============================================================

    function getInstructorBlocks(instructorId, week) {
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return {};
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorBlocks) {
            return {};
        }

        var blockKey = normalisedInstructorId + '_' + weekNum;
        var blocks = data.curriculum.instructorBlocks[blockKey] || {};

        var result = {};
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) {
                continue;
            }

            var dayNum = parseSafeInteger(day);
            if (dayNum === null || dayNum < 1 || dayNum > 7) {
                continue;
            }

            var dayBlocks = blocks[day];
            if (typeof dayBlocks !== 'object' || Array.isArray(dayBlocks)) {
                continue;
            }

            result[day] = {};
            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) {
                    continue;
                }

                var hourNum = parseSafeInteger(hour);
                if (hourNum === null || hourNum < 0 || hourNum > 23) {
                    continue;
                }

                var block = dayBlocks[hour];
                if (!block || typeof block !== 'object') {
                    continue;
                }

                var duration = validateDuration(block.duration);
                if (duration === null) {
                    continue;
                }

                result[day][hour] = deepClone(block);
            }
        }
        return result;
    }

    function addInstructorBlock(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE INPUTS ----
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

        // Validate discipline ID if provided
        if (data.disciplineId) {
            var normalisedDisciplineId = normaliseId(data.disciplineId);
            if (normalisedDisciplineId !== null) {
                var discipline = getDiscipline(normalisedDisciplineId);
                if (!discipline) {
                    return failure('Discipline not found: ' + data.disciplineId);
                }
            }
        }

        // ---- PHASE 2: GET STORE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum || typeof store.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE BLOCKS ----
        var candidateBlocks = deepClone(store.curriculum.instructorBlocks || {});
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        // ---- PHASE 4: CLONE TEMPLATES FOR OVERLAP CHECK (DO NOT COMMIT) ----
        var templatesForCheck = deepClone(store.curriculum.instructorTemplates || {});
        if (templatesForCheck === null) {
            return failure('Failed to prepare template data for overlap check.');
        }

        var blockKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateBlocks[blockKey]) {
            candidateBlocks[blockKey] = {};
        }
        if (!candidateBlocks[blockKey][dayNum]) {
            candidateBlocks[blockKey][dayNum] = {};
        }

        // ---- PHASE 5: CHECK OVERLAPS ----
        // Check against existing blocks
        if (hasDurationOverlap(candidateBlocks[blockKey], dayNum, hourNum, durationNum)) {
            return failure('Time slot already has a block.');
        }

        // Check against existing templates
        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (templatesForCheck[templateKey] && hasDurationOverlap(templatesForCheck[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Block overlaps with an existing class template.');
        }

        // ---- PHASE 6: ADD BLOCK ----
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

        // ---- PHASE 7: COMMIT (BLOCKS ONLY) ----
        store.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Added instructor block');
        return successResult('blocked', { block: blockData }, 1);
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE INPUTS ----
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

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
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

        // Validate the block structure before deletion
        var block = candidateBlocks[blockKey][dayNum][hourNum];
        if (!block || typeof block !== 'object') {
            return failure('Block data is malformed.');
        }
        if (validateDuration(block.duration) === null) {
            return failure('Block duration is malformed.');
        }

        // ---- PHASE 4: REMOVE ----
        delete candidateBlocks[blockKey][dayNum][hourNum];

        if (Object.keys(candidateBlocks[blockKey][dayNum]).length === 0) {
            delete candidateBlocks[blockKey][dayNum];
        }

        if (Object.keys(candidateBlocks[blockKey]).length === 0) {
            delete candidateBlocks[blockKey];
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Removed instructor block');
        return successResult('unblocked', {}, 0);
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
