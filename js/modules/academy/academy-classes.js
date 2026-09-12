/**
 * js/modules/academy/academy-classes.js - Academy Classes
 * SINGLE SOURCE OF TRUTH for all academy class ENTITY data and operations
 * Path: js/modules/academy/academy-classes.js
 * 
 * This module is responsible for:
 *   - Class entity CRUD operations (create, update, delete)
 *   - Class lookup (by ID, by name, by status)
 *   - Class entity mutations
 * 
 * This module is NOT responsible for:
 *   - Class membership storage. Membership lives on character.classIds.
 *   - Class roster derivation. AcademyQueries derives rosters from
 *     character.classIds.
 *   - Character ↔ class relationship mutations. Those are owned by
 *     CharacterClasses (addToClass / removeClassById / addClassByName /
 *     removeFromAllClasses).
 * 
 * IMPORTANT (v15+):
 *   - This module OWNS class ENTITIES, not membership.
 *   - academy.classStudents no longer exists. It was removed in v15
 *     and must never be reintroduced.
 *   - Character membership is stored on character.classIds[].
 *   - The academy roster is DERIVED: characters whose classIds include
 *     classId. AcademyQueries owns that derivation.
 *   - This module's legacy membership methods (addStudent, removeStudent,
 *     removeStudentFromAllClasses) are thin DELEGATORS to CharacterClasses.
 *     They exist for backwards compatibility during the Academy UI rework
 *     and will be removed once all callers migrate.
 *   - Class deletion is a CASCADE. It removes the class entity, strips
 *     the classId from every character that references it, and removes
 *     all class-scoped data (weeklyTeams, grades, rankings) in a single
 *     MutationPipeline transaction.
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Any integer >= 1 is a valid year for a class.
 *   - A null year is also valid (represents "year not specified").
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CharacterClasses (from character-classes.js) - LAZY
 *   - window.CharacterQueries (from character-queries.js) - LAZY
 * 
 * USAGE:
 *   var classes = window.AcademyClasses;
 *   
 *   // Entity CRUD
 *   var result = classes.create('Class of 2026');
 *   var result = classes.update('class_123', { name: 'New Name' });
 *   var result = classes.delete('class_123');
 *   
 *   // Lookups (used by AcademyQueries)
 *   var cls = classes.getClass('class_123');
 *   var all = classes.getClasses();
 *   var byName = classes.getClassByName('Class of 2026');
 *   
 *   // DEPRECATED membership delegates — use CharacterClasses directly
 *   var result = classes.addStudent('class_123', 'student_456');
 *   var result = classes.removeStudent('class_123', 'student_456');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyClassesLoaded) {
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

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyClasses] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyClassesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================
    // CharacterClasses and CharacterQueries load at different times
    // than this module depending on the script order. Resolve them
    // lazily at call time.

    function getCharacterClasses() {
        return window.CharacterClasses || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = ['active', 'archived', 'graduated'];
    var DEFAULT_STATUS = 'active';

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('class');
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

    function getAcademyStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!data.academy || typeof data.academy !== 'object') {
            data.academy = {};
        }

        return data.academy;
    }

    /**
     * Ensure the class entity structure exists.
     * 
     * NOTE: This does NOT create or touch academy.classStudents. That
     * structure is gone as of v15. Class membership is derived from
     * character.classIds.
     */
    function ensureClassStructures() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }

        if (!academy.graduatingClasses || typeof academy.graduatingClasses !== 'object' || Array.isArray(academy.graduatingClasses)) {
            academy.graduatingClasses = {};
        }

        return academy;
    }

    // ============================================================
    // INTERNAL CLASS LOOKUP - PRIVATE
    // ============================================================
    // These are the CANONICAL class ENTITY lookup functions. They
    // read from academy.graduatingClasses, which is unaffected by
    // the v15 membership change.

    /**
     * Get a class record by ID (internal).
     * Returns a LIVE reference - do not mutate directly.
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClassInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return null;
        }

        var target = String(classId);
        return academy.graduatingClasses[target] || null;
    }

    /**
     * Get all class records (internal).
     * Returns an array of class objects (live references).
     * 
     * @returns {array} Array of class objects
     */
    function getClassesInternal() {
        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return [];
        }

        var result = [];
        for (var id in academy.graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(academy.graduatingClasses, id)) {
                var cls = academy.graduatingClasses[id];
                if (cls) {
                    result.push(cls);
                }
            }
        }

        return result;
    }

    /**
     * Get class records by status (internal).
     * 
     * @param {string} status - Status filter ('active', 'archived', 'graduated')
     * @returns {array} Array of class objects
     */
    function getClassesByStatusInternal(status) {
        if (!isNonEmptyString(status)) {
            return getClassesInternal();
        }

        var all = getClassesInternal();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].status === status) {
                result.push(all[i]);
            }
        }

        return result;
    }

    /**
     * Get active class records (internal).
     * 
     * @returns {array} Array of active class objects
     */
    function getActiveClassesInternal() {
        return getClassesByStatusInternal('active');
    }

    /**
     * Get a class by name (internal, case-insensitive).
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByNameInternal(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var classes = getClassesInternal();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && cls.name && String(cls.name).toLowerCase().trim() === target) {
                return cls;
            }
        }

        return null;
    }

    /**
     * Get class display name (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name or 'Unknown Class'
     */
    function getClassDisplayNameInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return 'Unknown Class';
        }

        return cls.name || 'Unnamed Class';
    }

    // ============================================================
    // CHARACTER ↔ CLASS - READ PATH
    // ============================================================
    // These read character.classIds directly. This is the canonical
    // membership relationship. There is no separate roster store to
    // read from, so there is nothing to keep in sync.

    /**
     * Get character class names (internal).
     * Reads from character.classIds.
     * 
     * @param {object} character - Character object with classIds
     * @returns {array} Array of class names
     */
    function getCharacterClassNamesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var names = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    names.push(classes[j].name);
                    break;
                }
            }
        }

        return names;
    }

    /**
     * Get character classes (internal).
     * Reads from character.classIds.
     * 
     * @param {object} character - Character object with classIds
     * @returns {array} Array of class objects
     */
    function getCharacterClassesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var result = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    result.push(classes[j]);
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // YEAR VALIDATION
    // ============================================================

    /**
     * Validate a year value for a class.
     * 
     * Years are UNBOUNDED positive integers. A null value is also
     * accepted (means "year not specified").
     * 
     * @param {*} value - Year value to validate
     * @returns {object} { valid: boolean, value: number|null, message?: string }
     */
    function validateYearValue(value) {
        if (value === undefined || value === null || value === '') {
            return { valid: true, value: null };
        }

        var num = Number(value);
        if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return {
                valid: false,
                value: null,
                message: 'Year must be a positive number.'
            };
        }

        return { valid: true, value: num };
    }

    // ============================================================
    // PUBLIC API - CLASS ENTITY CRUD
    // ============================================================

    /**
     * Create a new class.
     * 
     * @param {string} name - Class name
     * @param {object} options - Optional configuration
     * @param {string} options.status - Status ('active', 'archived', 'graduated')
     * @param {number} options.year - Graduation year (any positive integer)
     * @param {string} options.description - Class description
     * @param {string} options.instructorId - Instructor ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function create(name, options) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(name)) {
            return Promise.resolve(failure('Class name is required.'));
        }

        var trimmedName = String(name).trim();

        // Check for duplicate name
        var existing = getClassByNameInternal(trimmedName);
        if (existing) {
            return Promise.resolve(failure('A class with this name already exists.'));
        }

        options = options || {};

        // Validate status
        var status = options.status || DEFAULT_STATUS;
        if (VALID_STATUSES.indexOf(status) === -1) {
            return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
        }

        // Validate year (unbounded positive integer or null)
        var yearResult = validateYearValue(options.year);
        if (!yearResult.valid) {
            return Promise.resolve(failure(yearResult.message));
        }

        // ---- PHASE 2: BUILD CLASS OBJECT ----
        var now = new Date().toISOString();
        var classId = generateId();

        var newClass = {
            id: classId,
            name: trimmedName,
            status: status,
            year: yearResult.value,
            description: options.description || '',
            instructorId: options.instructorId || null,
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 3: MUTATION PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function() {
                var current = getClassByNameInternal(trimmedName);
                if (current) {
                    return { valid: false, message: 'A class with this name already exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || typeof data.academy !== 'object') {
                    data.academy = {};
                }
                if (!data.academy.graduatingClasses ||
                    typeof data.academy.graduatingClasses !== 'object' ||
                    Array.isArray(data.academy.graduatingClasses)) {
                    data.academy.graduatingClasses = {};
                }
                data.academy.graduatingClasses[classId] = newClass;
                return { class: newClass, classId: classId };
            },
            logMessage: function() {
                return 'Created class: ' + trimmedName;
            },
            successMessage: function() {
                return 'Class created successfully!';
            },
            failureMessage: 'Failed to create class.'
        });
    }

    /**
     * Update an existing class.
     * 
     * @param {string} classId - Class ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function update(classId, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        // ---- PHASE 2: VERIFY EXISTING ----
        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        // ---- PHASE 3: VALIDATE UPDATES ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone class data.'));
        }

        // Name update validation
        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return Promise.resolve(failure('Class name cannot be empty.'));
            }
            var newName = String(updates.name).trim();
            if (newName !== existing.name) {
                var duplicate = getClassByNameInternal(newName);
                if (duplicate && String(duplicate.id) !== target) {
                    return Promise.resolve(failure('A class with this name already exists.'));
                }
                candidate.name = newName;
            }
        }

        // Status update validation
        if (updates.status !== undefined) {
            if (VALID_STATUSES.indexOf(updates.status) === -1) {
                return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
            }
            candidate.status = updates.status;
        }

        // Year update validation (unbounded positive integer or null)
        if (updates.year !== undefined) {
            var yearResult = validateYearValue(updates.year);
            if (!yearResult.valid) {
                return Promise.resolve(failure(yearResult.message));
            }
            candidate.year = yearResult.value;
        }

        // Description update
        if (updates.description !== undefined) {
            candidate.description = updates.description || '';
        }

        // Instructor update
        if (updates.instructorId !== undefined) {
            candidate.instructorId = updates.instructorId || null;
        }

        candidate.updatedAt = new Date().toISOString();

        // ---- PHASE 4: MUTATION PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function() {
                var current = getClassInternal(target);
                if (!current) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || !data.academy.graduatingClasses) {
                    throw new Error('Academy data is not available.');
                }
                if (!data.academy.graduatingClasses[target]) {
                    throw new Error('Class not found in data store.');
                }
                data.academy.graduatingClasses[target] = candidate;
                return { class: candidate };
            },
            logMessage: function() {
                return 'Updated class: ' + candidate.name;
            },
            successMessage: 'Class updated successfully!',
            failureMessage: 'Failed to update class.'
        });
    }

    /**
     * Delete a class permanently.
     * 
     * This is a CASCADE operation. In a single MutationPipeline
     * transaction it:
     *   1. Deletes the class entity from academy.graduatingClasses.
     *   2. Removes classId from every character's classIds array.
     *   3. Removes academy.weeklyTeams[classId] (all weeks, all teams).
     *   4. Removes grades keyed to this class (academy.grades).
     *   5. Removes rankings keyed to this class (academy.rankings).
     * 
     * Rationale: after deletion, any surviving reference to the class
     * would be unreachable data. Removing it in the same transaction
     * avoids both orphaned references and partial-cascade states.
     * 
     * @param {string} classId - Class ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function deleteClass(classId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        var className = existing.name;

        // ---- PHASE 2: MUTATION PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function() {
                var current = getClassInternal(target);
                if (!current) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || !data.academy.graduatingClasses) {
                    throw new Error('Academy data is not available.');
                }
                if (!data.academy.graduatingClasses[target]) {
                    throw new Error('Class not found in data store.');
                }

                // ---- 1. Delete the class entity ----
                delete data.academy.graduatingClasses[target];

                // ---- 2. Strip classId from every character ----
                var affectedCharacters = 0;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        var char = data.characters[i];
                        if (!char || !Array.isArray(char.classIds)) {
                            continue;
                        }
                        var before = char.classIds.length;
                        char.classIds = char.classIds.filter(function(id) {
                            return String(id) !== target;
                        });
                        if (char.classIds.length !== before) {
                            affectedCharacters++;
                        }
                    }
                }

                // ---- 3. Delete weeklyTeams for this class ----
                if (data.academy.weeklyTeams &&
                    typeof data.academy.weeklyTeams === 'object') {
                    delete data.academy.weeklyTeams[target];
                }

                // ---- 4. Delete grades keyed to this class ----
                var removedGrades = 0;
                if (data.academy.grades &&
                    typeof data.academy.grades === 'object') {
                    var gradeIds = Object.keys(data.academy.grades);
                    for (var g = 0; g < gradeIds.length; g++) {
                        var grade = data.academy.grades[gradeIds[g]];
                        if (grade && String(grade.classId) === target) {
                            delete data.academy.grades[gradeIds[g]];
                            removedGrades++;
                        }
                    }
                }

                // ---- 5. Delete rankings keyed to this class ----
                var removedRankings = 0;
                if (data.academy.rankings &&
                    typeof data.academy.rankings === 'object') {
                    var rankIds = Object.keys(data.academy.rankings);
                    for (var r = 0; r < rankIds.length; r++) {
                        var rank = data.academy.rankings[rankIds[r]];
                        if (rank && String(rank.classId) === target) {
                            delete data.academy.rankings[rankIds[r]];
                            removedRankings++;
                        }
                    }
                }

                return {
                    deleted: true,
                    classId: target,
                    className: className,
                    affectedCharacters: affectedCharacters,
                    removedGrades: removedGrades,
                    removedRankings: removedRankings
                };
            },
            logMessage: function(result) {
                return 'Deleted class: ' + result.className;
            },
            successMessage: 'Class deleted successfully!',
            failureMessage: 'Failed to delete class.'
        });
    }

    // ============================================================
    // MEMBERSHIP - DEPRECATED DELEGATORS
    // ============================================================
    // These functions exist only for backwards compatibility while the
    // Academy UI is being reworked. They delegate to CharacterClasses,
    // which is the canonical membership mutation path.
    // 
    // New code should call CharacterClasses directly. These delegates
    // will be removed once all callers migrate.

    /**
     * Add a student to a class.
     * 
     * @deprecated Use CharacterClasses.addToClass instead.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function addStudent(classId, studentId) {
        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses || typeof CharacterClasses.addToClass !== 'function') {
            return Promise.resolve(failure('CharacterClasses.addToClass is not available.'));
        }
        return CharacterClasses.addToClass(studentId, classId);
    }

    /**
     * Remove a student from a class.
     * 
     * @deprecated Use CharacterClasses.removeClassById instead.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function removeStudent(classId, studentId) {
        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses || typeof CharacterClasses.removeClassById !== 'function') {
            return Promise.resolve(failure('CharacterClasses.removeClassById is not available.'));
        }
        return CharacterClasses.removeClassById(studentId, classId);
    }

    /**
     * Remove a student from all classes.
     * 
     * @deprecated Use CharacterClasses.removeFromAllClasses instead.
     * 
     * @param {string} studentId - Student ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function removeStudentFromAllClasses(studentId) {
        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses || typeof CharacterClasses.removeFromAllClasses !== 'function') {
            return Promise.resolve(failure('CharacterClasses.removeFromAllClasses is not available.'));
        }
        return CharacterClasses.removeFromAllClasses(studentId);
    }

    // ============================================================
    // PUBLIC INTERNAL LOOKUP (for AcademyQueries)
    // ============================================================

    /**
     * Get a class by ID (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(classId) {
        return getClassInternal(classId);
    }

    /**
     * Get all classes (internal).
     * 
     * @returns {array} Array of class objects
     */
    function getClasses() {
        return getClassesInternal();
    }

    /**
     * Get classes by status (internal).
     * 
     * @param {string} status - Status filter
     * @returns {array} Array of class objects
     */
    function getClassesByStatus(status) {
        return getClassesByStatusInternal(status);
    }

    /**
     * Get class by name (internal).
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        return getClassByNameInternal(name);
    }

    /**
     * Get class display name (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name
     */
    function getDisplayName(classId) {
        return getClassDisplayNameInternal(classId);
    }

    /**
     * Check if a character is in a class.
     * Reads from character.classIds.
     * 
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if in class
     */
    function isCharacterInClass(character, classId) {
        if (!character || typeof character !== 'object') {
            return false;
        }
        if (!Array.isArray(character.classIds) || !classId) {
            return false;
        }
        var target = String(classId);
        for (var i = 0; i < character.classIds.length; i++) {
            if (String(character.classIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get character class names.
     * Reads from character.classIds.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class names
     */
    function getCharacterClassNames(character) {
        return getCharacterClassNamesInternal(character);
    }

    /**
     * Get character classes.
     * Reads from character.classIds.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class objects
     */
    function getCharacterClassesFor(character) {
        return getCharacterClassesInternal(character);
    }

    // ============================================================
    // DEPRECATED STUBS
    // ============================================================
    // These existed in the pre-v15 API. They now delegate to
    // AcademyQueries, which derives rosters from character.classIds.
    // They will be removed once all callers migrate.

    /**
     * @deprecated Use AcademyQueries.getClassStudents instead.
     */
    function getClassStudents(classId) {
        var AQ = window.AcademyQueries;
        if (AQ && typeof AQ.getClassStudentIds === 'function') {
            return AQ.getClassStudentIds(classId);
        }
        // Fallback: derive directly
        return deriveRosterIds(classId);
    }

    /**
     * @deprecated Use AcademyQueries.getClassStudentIds instead.
     */
    function getClassStudentsInternal(classId) {
        return getClassStudents(classId);
    }

    /**
     * Derive roster IDs from character.classIds.
     * Local fallback used only if AcademyQueries isn't loaded.
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of character IDs
     */
    function deriveRosterIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            return [];
        }
        var chars = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !Array.isArray(c.classIds)) {
                continue;
            }
            for (var j = 0; j < c.classIds.length; j++) {
                if (String(c.classIds[j]) === target) {
                    result.push(c.id);
                    break;
                }
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClasses = {
        // ---- Class Entity CRUD (public) ----
        create: create,
        update: update,
        delete: deleteClass,

        // ---- Membership (DEPRECATED - delegates to CharacterClasses) ----
        addStudent: addStudent,
        removeStudent: removeStudent,
        removeStudentFromAllClasses: removeStudentFromAllClasses,

        // ---- Lookups (for AcademyQueries) ----
        getClass: getClass,
        getClasses: getClasses,
        getClassesByStatus: getClassesByStatus,
        getClassByName: getClassByName,
        getDisplayName: getDisplayName,
        isCharacterInClass: isCharacterInClass,
        getCharacterClassNames: getCharacterClassNames,
        getCharacterClasses: getCharacterClassesFor,

        // ---- DEPRECATED STUBS ----
        getClassStudents: getClassStudents,
        getClassStudentsInternal: getClassStudentsInternal,

        // ---- Internal (low-level, for AcademyQueries) ----
        getClassInternal: getClassInternal,
        getClassesInternal: getClassesInternal,
        getClassesByStatusInternal: getClassesByStatusInternal,
        getClassByNameInternal: getClassByNameInternal,
        getClassDisplayNameInternal: getClassDisplayNameInternal,
        getCharacterClassNamesInternal: getCharacterClassNamesInternal,
        getCharacterClassesInternal: getCharacterClassesInternal,

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS
    };

})();