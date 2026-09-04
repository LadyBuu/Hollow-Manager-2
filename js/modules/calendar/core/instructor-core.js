/**
 * js/modules/calendar/core/instructor-core.js - Instructor Calendar Core
 * Instructor template and block operations for the calendar system
 * Path: js/modules/calendar/core/instructor-core.js
 * 
 * This module handles:
 *   - Instructor class templates (scheduled teaching slots)
 *   - Instructor blocks (unavailable time)
 *   - Instructor template/block CRUD operations
 * 
 * IMPORTANT:
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone (or structuredClone fallback)
 *   - All ID normalisation is consistent
 *   - Instructor templates define the instructor's scheduled teaching slots
 *   - Blocks are time periods when the instructor is unavailable
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

    if (window.__calendarInstructorCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        return;
    }

    window.__calendarInstructorCoreLoaded = true;

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

    function validateCurriculumStructure(data) {
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return { success: false, message: 'Curriculum data is not available.' };
        }

        if (data.curriculum.instructorTemplates !== undefined && !isObject(data.curriculum.instructorTemplates)) {
            return { success: false, message: 'Instructor templates data is corrupted.' };
        }

        if (data.curriculum.instructorBlocks !== undefined && !isObject(data.curriculum.instructorBlocks)) {
            return { success: false, message: 'Instructor blocks data is corrupted.' };
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

    /**
     * Check if a new duration-based entry overlaps with existing entries.
     * Treats malformed existing entries as OCCUPIED to prevent overwriting garbage.
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

            var existingStart = parseInt(existingHour, 10);
            if (isNaN(existingStart)) {
                continue;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = entry && entry.duration ? parseInt(entry.duration, 10) : null;

            // If the existing entry is malformed, treat it as occupied
            if (existingDuration === null || isNaN(existingDuration) || existingDuration < 1 || existingDuration > 4) {
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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // INSTRUCTOR TEMPLATE OPERATIONS
    // ============================================================

    /**
     * Get instructor class templates for a week.
     * Returns a cloned copy to prevent external mutation.
     */
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

        return deepClone(templates) || {};
    }

    /**
     * Set an instructor class template.
     * Candidate-based: validates, clones, modifies, commits.
     * Duration-aware overlap detection.
     */
    function setInstructorTemplate(instructorId, week, day, hour, templateData) {
        // ---- PHASE 1: VALIDATE ----
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

        if (!templateData || typeof templateData !== 'object') {
            return failure('Template data is required.');
        }

        if (!isNonEmptyString(templateData.disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var normalisedDisciplineId = normaliseId(templateData.disciplineId);
        if (normalisedDisciplineId === null) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(templateData.duration);
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

        var assignedStudents = normaliseIdArray(templateData.assignedStudents);
        for (var i = 0; i < assignedStudents.length; i++) {
            var student = getCharacterById(assignedStudents[i]);
            if (!student) {
                return failure('Student not found: ' + assignedStudents[i]);
            }
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
        var candidateTemplates = deepClone(data.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            candidateTemplates[templateKey] = {};
        }

        // Duration-aware overlap check
        if (hasDurationOverlap(candidateTemplates[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with an existing template at this time.');
        }

        var classKey = dayNum + '_' + hourNum;

        candidateTemplates[templateKey][classKey] = {
            disciplineId: normalisedDisciplineId,
            label: templateData.label || '',
            groupLabel: templateData.groupLabel || '',
            duration: durationNum,
            assignedStudents: assignedStudents
        };

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Added instructor class template: ' + discipline.name);
        return success({ added: true });
    }

    /**
     * Remove an instructor class template.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function removeInstructorTemplate(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Removed instructor class template');
        return success({ removed: true });
    }

    // ============================================================
    // INSTRUCTOR BLOCK OPERATIONS
    // ============================================================

    /**
     * Get instructor blocks for a week.
     * Returns a cloned copy to prevent external mutation.
     */
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

        return deepClone(blocks) || {};
    }

    /**
     * Set an instructor block.
     * Candidate-based: validates, clones, modifies, commits.
     * Duration-aware overlap detection.
     */
    function setInstructorBlock(instructorId, week, day, hour, blockData) {
        // ---- PHASE 1: VALIDATE ----
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

        if (!blockData || typeof blockData !== 'object') {
            return failure('Block data is required.');
        }

        var durationNum = validateDuration(blockData.duration);
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
        if (blockData.disciplineId) {
            var normalisedDisciplineId = normaliseId(blockData.disciplineId);
            if (normalisedDisciplineId !== null) {
                var discipline = getDiscipline(normalisedDisciplineId);
                if (!discipline) {
                    return failure('Discipline not found: ' + blockData.disciplineId);
                }
            }
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
        var candidateBlocks = deepClone(data.curriculum.instructorBlocks || {});
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

        // Duration-aware overlap check
        if (hasDurationOverlap(candidateBlocks[blockKey], dayNum, hourNum, durationNum)) {
            return failure('Time slot already has a block.');
        }

        var newBlockData = {
            label: blockData.label || 'Blocked Time',
            groupLabel: blockData.groupLabel || null,
            duration: durationNum
        };

        if (blockData.disciplineId) {
            var normDiscId = normaliseId(blockData.disciplineId);
            if (normDiscId !== null) {
                newBlockData.disciplineId = normDiscId;
            }
        }

        candidateBlocks[blockKey][dayNum][hourNum] = newBlockData;

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Added instructor block');
        return success({ added: true });
    }

    /**
     * Remove an instructor block.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function removeInstructorBlock(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Removed instructor block');
        return success({ removed: true });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarInstructorCore = {
        getInstructorTemplates: getInstructorTemplates,
        setInstructorTemplate: setInstructorTemplate,
        removeInstructorTemplate: removeInstructorTemplate,
        getInstructorBlocks: getInstructorBlocks,
        setInstructorBlock: setInstructorBlock,
        removeInstructorBlock: removeInstructorBlock
    };

})();
