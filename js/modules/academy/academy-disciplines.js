/**
 * modules/academy/academy-disciplines.js - Academy Disciplines
 * SINGLE SOURCE OF TRUTH for all discipline/curriculum data and operations
 * 
 * This module is responsible for:
 *   - Discipline CRUD operations (create, update, delete)
 *   - Discipline queries (get by ID, get all, get available)
 *   - Discipline validation
 *   - Instructor assignment for disciplines
 * 
 * IMPORTANT:
 *   - This module OWNS discipline data - it does NOT depend on AcademyQueries
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 * 
 * USAGE:
 *   var disciplines = window.AcademyDisciplines;
 *   
 *   // Create a discipline
 *   var result = disciplines.create({
 *     name: 'Combat Training',
 *     type: 'mandatory',
 *     instructorIds: ['char_123'],
 *     startWeek: 1,
 *     endWeek: 10,
 *     weeklyHours: 2,
 *     weight: 1.0
 *   });
 *   
 *   // Update a discipline
 *   var result = disciplines.update('disc_123', { name: 'Advanced Combat' });
 *   
 *   // Delete a discipline
 *   var result = disciplines.delete('disc_123');
 *   
 *   // Get a discipline
 *   var discipline = disciplines.getDiscipline('disc_123');
 *   var all = disciplines.getDisciplines();
 *   var available = disciplines.getAvailableDisciplines(5);
 */

(function() {
    'use strict';

    if (window.__academyDisciplinesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyDisciplines] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyDisciplinesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_START_WEEK = MIN_WEEK;
    var DEFAULT_END_WEEK = MAX_WEEK;

    var VALID_DISCIPLINE_TYPES = ['mandatory', 'optional'];
    var DEFAULT_TYPE = 'mandatory';

    var MIN_WEEKLY_HOURS = 0.5;
    var MAX_WEEKLY_HOURS = 40;
    var DEFAULT_WEEKLY_HOURS = 1;

    var MIN_WEIGHT = 0.1;
    var MAX_WEIGHT = 10;
    var DEFAULT_WEIGHT = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('disc');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

    function ensureDisciplineStructures() {
        var curriculum = getCurriculum();
        if (!curriculum) {
            return null;
        }

        if (!curriculum.disciplines || typeof curriculum.disciplines !== 'object') {
            curriculum.disciplines = [];
        }

        return curriculum;
    }

    // ============================================================
    // INTERNAL DISCIPLINE LOOKUP - PRIVATE
    // ============================================================

    /**
     * Get a discipline record by ID (internal).
     * 
     * @param {string} id - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDisciplineRecord(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d && String(d.id) === target) {
                return d;
            }
        }

        return null;
    }

    /**
     * Get all discipline records (internal).
     * 
     * @returns {array} Array of discipline objects
     */
    function getDisciplineRecords() {
        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d) {
                result.push(d);
            }
        }

        return result;
    }

    /**
     * Get discipline by name (internal, case-insensitive).
     * 
     * @param {string} name - Discipline name
     * @returns {object|null} Discipline object or null
     */
    function getDisciplineByNameRecord(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var disciplines = getDisciplineRecords();

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && d.name && String(d.name).toLowerCase().trim() === target) {
                return d;
            }
        }

        return null;
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    function validateDisciplineData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        // Name - required for full creation
        if (!isPartial || data.name !== undefined) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
        }

        // Type - optional, with default
        if (data.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', ') };
            }
        }

        // Instructor IDs - optional
        if (data.instructorIds !== undefined) {
            if (!Array.isArray(data.instructorIds)) {
                return { valid: false, message: 'Instructor IDs must be an array.' };
            }
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!isNonEmptyString(data.instructorIds[i])) {
                    return { valid: false, message: 'Invalid instructor ID at index ' + i + '.' };
                }
            }
        }

        // Start week - optional, with default
        if (data.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(data.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return { valid: false, message: 'Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        // End week - optional, with default
        if (data.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(data.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return { valid: false, message: 'End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        // Weekly hours - optional, with default
        if (data.weeklyHours !== undefined) {
            var weeklyHours = Number(data.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return { valid: false, message: 'Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.' };
            }
        }

        // Weight - optional, with default
        if (data.weight !== undefined) {
            var weight = Number(data.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return { valid: false, message: 'Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // PUBLIC API - DISCIPLINE CRUD
    // ============================================================

    /**
     * Create a new discipline.
     * Candidate-based: validates, creates, commits.
     * 
     * @param {object} data - Discipline data
     * @param {string} data.name - Discipline name
     * @param {string} data.type - 'mandatory' or 'optional' (default: 'mandatory')
     * @param {array} data.instructorIds - Array of instructor IDs
     * @param {number} data.startWeek - Start week (default: 1)
     * @param {number} data.endWeek - End week (default: 52)
     * @param {number} data.weeklyHours - Weekly hours (default: 1)
     * @param {number} data.weight - Weight multiplier (default: 1)
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateDisciplineData(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: GET STORE ----
        var curriculum = ensureDisciplineStructures();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: CHECK FOR DUPLICATE NAME ----
        var existing = getDisciplineByNameRecord(data.name);
        if (existing) {
            return failure('A discipline with this name already exists.');
        }

        // ---- PHASE 4: BUILD DISCIPLINE OBJECT ----
        var now = new Date().toISOString();
        var disciplineId = generateId();

        var startWeek = data.startWeek !== undefined ? CalendarValidation.parseWeek(data.startWeek) : DEFAULT_START_WEEK;
        var endWeek = data.endWeek !== undefined ? CalendarValidation.parseWeek(data.endWeek) : DEFAULT_END_WEEK;

        // Ensure startWeek <= endWeek
        if (startWeek > endWeek) {
            return failure('Start week cannot be after end week.');
        }

        var weeklyHours = data.weeklyHours !== undefined ? Number(data.weeklyHours) : DEFAULT_WEEKLY_HOURS;
        var weight = data.weight !== undefined ? Number(data.weight) : DEFAULT_WEIGHT;

        var newDiscipline = {
            id: disciplineId,
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
            instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [],
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            weight: weight,
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 5: COMMIT ----
        curriculum.disciplines.push(newDiscipline);

        return success({
            discipline: newDiscipline
        });
    }

    /**
     * Update an existing discipline.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} id - Discipline ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function update(id, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return failure('Updates are required.');
        }

        // ---- PHASE 2: GET STORE ----
        var curriculum = ensureDisciplineStructures();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(id);
        var existing = null;
        var existingIndex = -1;

        for (var i = 0; i < curriculum.disciplines.length; i++) {
            if (String(curriculum.disciplines[i].id) === target) {
                existing = curriculum.disciplines[i];
                existingIndex = i;
                break;
            }
        }

        if (!existing) {
            return failure('Discipline not found.');
        }

        // ---- PHASE 4: VALIDATE UPDATES ----
        var validation = validateDisciplineData(updates, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone discipline data.');
        }

        var hasChanges = false;

        // Name update
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return failure('Discipline name cannot be empty.');
            }
            if (newName !== candidate.name) {
                // Check for duplicate name
                var duplicate = getDisciplineByNameRecord(newName);
                if (duplicate && String(duplicate.id) !== target) {
                    return failure('A discipline with this name already exists.');
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Type update
        if (updates.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(updates.type) === -1) {
                return failure('Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', '));
            }
            if (candidate.type !== updates.type) {
                candidate.type = updates.type;
                hasChanges = true;
            }
        }

        // Instructor IDs update
        if (updates.instructorIds !== undefined) {
            if (!Array.isArray(updates.instructorIds)) {
                return failure('Instructor IDs must be an array.');
            }
            var newInstructors = [];
            for (var j = 0; j < updates.instructorIds.length; j++) {
                if (isNonEmptyString(updates.instructorIds[j])) {
                    newInstructors.push(String(updates.instructorIds[j]).trim());
                }
            }
            // Check if changed
            var currentSorted = candidate.instructorIds.slice().sort();
            var newSorted = newInstructors.slice().sort();
            if (currentSorted.length !== newSorted.length ||
                currentSorted.some(function(v, idx) { return v !== newSorted[idx]; })) {
                candidate.instructorIds = newInstructors;
                hasChanges = true;
            }
        }

        // Start week update
        if (updates.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(updates.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return failure('Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
            }
            if (candidate.startWeek !== startWeek) {
                candidate.startWeek = startWeek;
                hasChanges = true;
            }
        }

        // End week update
        if (updates.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(updates.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return failure('End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
            }
            if (candidate.endWeek !== endWeek) {
                candidate.endWeek = endWeek;
                hasChanges = true;
            }
        }

        // Weekly hours update
        if (updates.weeklyHours !== undefined) {
            var weeklyHours = Number(updates.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return failure('Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.');
            }
            if (candidate.weeklyHours !== weeklyHours) {
                candidate.weeklyHours = weeklyHours;
                hasChanges = true;
            }
        }

        // Weight update
        if (updates.weight !== undefined) {
            var weight = Number(updates.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return failure('Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.');
            }
            if (candidate.weight !== weight) {
                candidate.weight = weight;
                hasChanges = true;
            }
        }

        // Validate week range after updates
        if (candidate.startWeek > candidate.endWeek) {
            return failure('Start week cannot be after end week.');
        }

        if (!hasChanges) {
            return success({ discipline: existing, changed: false });
        }

        // ---- PHASE 6: COMMIT ----
        candidate.updatedAt = new Date().toISOString();
        curriculum.disciplines[existingIndex] = candidate;

        return success({
            discipline: candidate,
            changed: true
        });
    }

    /**
     * Delete a discipline permanently.
     * 
     * @param {string} id - Discipline ID
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function deleteDiscipline(id) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var curriculum = ensureDisciplineStructures();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(id);
        var foundIndex = -1;
        var existing = null;

        for (var i = 0; i < curriculum.disciplines.length; i++) {
            if (String(curriculum.disciplines[i].id) === target) {
                foundIndex = i;
                existing = curriculum.disciplines[i];
                break;
            }
        }

        if (!existing) {
            return failure('Discipline not found.');
        }

        var disciplineInfo = {
            id: target,
            name: existing.name
        };

        // ---- PHASE 4: REMOVE ----
        curriculum.disciplines.splice(foundIndex, 1);

        return success({
            deleted: true,
            discipline: disciplineInfo
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (internal)
    // ============================================================

    /**
     * Get a discipline by ID (defensive copy).
     * 
     * @param {string} id - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDiscipline(id) {
        var record = getDisciplineRecord(id);
        return record ? deepClone(record) : null;
    }

    /**
     * Get all disciplines (defensive copies).
     * 
     * @returns {array} Array of discipline objects
     */
    function getDisciplines() {
        var records = getDisciplineRecords();
        return records.map(function(r) {
            return deepClone(r);
        });
    }

    /**
     * Get disciplines by type.
     * 
     * @param {string} type - 'mandatory' or 'optional'
     * @returns {array} Array of discipline objects
     */
    function getDisciplinesByType(type) {
        if (VALID_DISCIPLINE_TYPES.indexOf(type) === -1) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].type === type) {
                result.push(deepClone(all[i]));
            }
        }

        return result;
    }

    /**
     * Get disciplines by instructor.
     * 
     * @param {string} instructorId - Instructor ID
     * @returns {array} Array of discipline objects
     */
    function getDisciplinesByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];
        var target = String(instructorId);

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.instructorIds && Array.isArray(d.instructorIds)) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === target) {
                        result.push(deepClone(d));
                        break;
                    }
                }
            }
        }

        return result;
    }

    /**
     * Get available disciplines for a specific week.
     * 
     * @param {number} week - Week number
     * @returns {array} Array of discipline objects
     */
    function getAvailableDisciplines(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.startWeek <= weekNum && d.endWeek >= weekNum) {
                result.push(deepClone(d));
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    /**
     * Get active disciplines (startWeek <= currentWeek <= endWeek).
     * 
     * @param {number} currentWeek - Current week (default: from window.data)
     * @returns {array} Array of discipline objects
     */
    function getActiveDisciplines(currentWeek) {
        var week = currentWeek !== undefined ? CalendarValidation.parseWeek(currentWeek) : null;
        if (week === null) {
            var data = getDataStore();
            week = (data && data.currentWeek) || MIN_WEEK;
        }

        return getAvailableDisciplines(week);
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Save multiple disciplines at once.
     * 
     * @param {array} disciplinesData - Array of discipline data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing disciplines
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function saveDisciplines(disciplinesData, options) {
        if (!Array.isArray(disciplinesData) || disciplinesData.length === 0) {
            return failure('Discipline data array is required.');
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var created = 0;
        var updated = 0;
        var skipped = 0;
        var errors = [];

        for (var i = 0; i < disciplinesData.length; i++) {
            var data = disciplinesData[i];
            if (!isObject(data)) {
                errors.push({
                    index: i,
                    error: 'Invalid discipline data.'
                });
                continue;
            }

            // Validate required fields
            if (!data.name) {
                errors.push({
                    index: i,
                    error: 'Missing required field: name'
                });
                continue;
            }

            // Check if discipline already exists by name
            var existing = getDisciplineByNameRecord(data.name);

            if (existing && !overwrite) {
                skipped++;
                continue;
            }

            if (existing) {
                // Update existing
                var updateResult = update(existing.id, data);
                if (updateResult.success) {
                    updated++;
                } else {
                    errors.push({
                        index: i,
                        error: updateResult.message
                    });
                }
            } else {
                // Create new
                var createResult = create(data);
                if (createResult.success) {
                    created++;
                } else {
                    errors.push({
                        index: i,
                        error: createResult.message
                    });
                }
            }
        }

        return success({
            total: disciplinesData.length,
            created: created,
            updated: updated,
            skipped: skipped,
            errors: errors,
            successCount: created + updated
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplines = {
        // ---- CRUD ----
        create: create,
        update: update,
        delete: deleteDiscipline,

        // ---- Queries ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getDisciplinesByType: getDisciplinesByType,
        getDisciplinesByInstructor: getDisciplinesByInstructor,
        getAvailableDisciplines: getAvailableDisciplines,
        getActiveDisciplines: getActiveDisciplines,

        // ---- Bulk ----
        saveDisciplines: saveDisciplines,

        // ---- Internal (for AcademyQueries) ----
        getDisciplineRecord: getDisciplineRecord,
        getDisciplineRecords: getDisciplineRecords,
        getDisciplineByNameRecord: getDisciplineByNameRecord,

        // ---- Constants ----
        VALID_DISCIPLINE_TYPES: VALID_DISCIPLINE_TYPES,
        DEFAULT_TYPE: DEFAULT_TYPE,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_WEEKLY_HOURS: MIN_WEEKLY_HOURS,
        MAX_WEEKLY_HOURS: MAX_WEEKLY_HOURS,
        MIN_WEIGHT: MIN_WEIGHT,
        MAX_WEIGHT: MAX_WEIGHT,
        DEFAULT_WEEKLY_HOURS: DEFAULT_WEEKLY_HOURS,
        DEFAULT_WEIGHT: DEFAULT_WEIGHT
    };

})();