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
 *   - All mutations use copy-before-commit candidate semantics
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All deep cloning uses ObjectUtils.deepClone (MANDATORY)
 *   - All ID normalisation is consistent
 *   - Instructor templates define the instructor's scheduled teaching slots
 *   - Blocks are time periods when the instructor is unavailable
 *   - Duration metadata is stored in the template/block itself
 *   - All validation uses CalendarValidation from calendar-validation.js
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var IC = window.CalendarInstructorCore;
 *   var result = IC.setInstructorTemplate(instructorId, week, day, hour, {
 *       disciplineId: 'math_101',
 *       duration: 2,
 *       label: 'A'
 *   });
 *   if (result.success) { console.log('Template added'); }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarInstructorCoreLoaded) {
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

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.isInstructor !== 'function') {
        missing.push('CharacterQueries.isInstructor');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarInstructorCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__calendarInstructorCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var ScheduleCore = window.CalendarScheduleCore;
    var DisciplineQueries = window.DisciplineQueries;
    var CharacterQueries = window.CharacterQueries;

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

        return { success: true, data: data };
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = window.data;
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
     */
    function setInstructorTemplate(instructorId, week, day, hour, templateData) {
        // ---- PHASE 1: VALIDATE ----
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        var discipline = DisciplineQueries.getDiscipline(normalisedDisciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = CalendarValidation.parseDuration(templateData.duration);
        if (durationNum === null) {
            return failure('Duration must be between ' + CalendarConstants.MIN_CLASS_DURATION + ' and ' + CalendarConstants.MAX_CLASS_DURATION + ' hours.');
        }

        if (hourNum + durationNum > MAX_HOUR + 1) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var instructor = CharacterQueries.getCharacterById(normalisedInstructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }
        if (!CharacterQueries.isInstructor(instructor)) {
            return failure('Character is not an instructor.');
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

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateTemplates = deepClone(data.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var templateKey = normalisedInstructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            candidateTemplates[templateKey] = {};
        }

        // Duration-aware overlap check using ScheduleCore
        if (ScheduleCore.hasDurationOverlap(candidateTemplates[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with an existing template at this time.');
        }

        var classKey = dayNum + '_' + hourNum;

        candidateTemplates[templateKey][classKey] = {
            disciplineId: normalisedDisciplineId,
            label: templateData.label || '',
            groupLabel: templateData.groupLabel || '',
            duration: durationNum,
            assignedStudents: templateData.assignedStudents || []
        };

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorTemplates = candidateTemplates;

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

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = window.data;
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
     */
    function setInstructorBlock(instructorId, week, day, hour, blockData) {
        // ---- PHASE 1: VALIDATE ----
        var normalisedInstructorId = normaliseId(instructorId);
        if (normalisedInstructorId === null) {
            return failure('Instructor ID is required.');
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

        if (!blockData || typeof blockData !== 'object') {
            return failure('Block data is required.');
        }

        var durationNum = CalendarValidation.parseDuration(blockData.duration);
        if (durationNum === null) {
            return failure('Duration must be between ' + CalendarConstants.MIN_CLASS_DURATION + ' and ' + CalendarConstants.MAX_CLASS_DURATION + ' hours.');
        }

        if (hourNum + durationNum > MAX_HOUR + 1) {
            return failure('Block duration extends beyond the end of the day.');
        }

        var instructor = CharacterQueries.getCharacterById(normalisedInstructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }
        if (!CharacterQueries.isInstructor(instructor)) {
            return failure('Character is not an instructor.');
        }

        // Validate discipline ID if provided
        if (blockData.disciplineId) {
            var normalisedDisciplineId = normaliseId(blockData.disciplineId);
            if (normalisedDisciplineId !== null) {
                var discipline = DisciplineQueries.getDiscipline(normalisedDisciplineId);
                if (!discipline) {
                    return failure('Discipline not found: ' + blockData.disciplineId);
                }
            }
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

        // Duration-aware overlap check using ScheduleCore
        if (ScheduleCore.hasDurationOverlap(candidateBlocks[blockKey], dayNum, hourNum, durationNum)) {
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

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = window.data;
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