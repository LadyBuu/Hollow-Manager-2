/**
 * js/modules/academy/academy-classes.js - Academy Classes
 * SINGLE SOURCE OF TRUTH for all academy class ENTITY data AND
 * character ↔ class membership mutations.
 *
 * Path: js/modules/academy/academy-classes.js
 *
 * This module is responsible for:
 *   - Class entity CRUD operations (create, update, delete)
 *   - Class lookup (by ID, by name, by status)
 *   - Class entity mutations
 *   - Character ↔ class membership mutations (addToClass,
 *     removeClassById, addClassByName, removeFromAllClasses)
 *
 * This module is NOT responsible for:
 *   - Class membership STORAGE. Membership lives on
 *     character.classIds. That fact is unchanged by S10.1; what
 *     changed is that the mutations which write to that array now
 *     live here rather than in the character suite.
 *   - Class roster DERIVATION. AcademyQueries derives rosters from
 *     character.classIds.
 *   - Cross-domain cascade cleanup. That is owned by AcademyCascade.
 *
 * IMPORTANT (v15+):
 *   - This module OWNS class ENTITIES and now OWNS the mutations
 *     that write character.classIds.
 *   - academy.classStudents no longer exists. It was removed in v15
 *     and must never be reintroduced.
 *   - Character membership is stored on character.classIds[].
 *   - The academy roster is DERIVED: characters whose classIds
 *     include classId. AcademyQueries owns that derivation.
 *
 * S10.1 MIGRATION:
 *   The four membership mutations (addToClass, removeClassById,
 *   addClassByName, removeFromAllClasses) and the two
 *   classIds-normalisation helpers (normaliseClassIds,
 *   getNormalisedClassIds) were moved here from
 *   character-classes.js. That file has been deleted.
 *
 *   The membership mutations previously delegated their class reads
 *   through the retired AcademyQueries facade. They now go directly
 *   to AcademyClasses's own internal accessors (getClassInternal,
 *   getClassByNameInternal). This is the same class entity data,
 *   read from the same store; the intermediate facade is gone.
 *
 *   The legacy addStudent / removeStudent shims that delegate back to
 *   character-classes.js were deleted. Nothing calls them.
 *
 * READ SAFETY (Phase 2):
 *   - getAcademyStore() returns null (does NOT create academy.{...})
 *     when the store is missing. Reads are side-effect free.
 *   - Public lookups return DEEP CLONES.
 *   - Internal lookups return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData` argument.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input.
 *
 * DELETE CASCADE (Phase 8):
 *   Deleting a class is a CASCADE. In a single MutationPipeline
 *   transaction it:
 *     1. Strips the classId from every character's classIds array.
 *        (Character-side concern; kept inline.)
 *     2. Deletes the class entity from academy.graduatingClasses.
 *     3. Cross-domain cleanup: enrolments, grades, rankings, social
 *        scores, weekly teams. Delegated to AcademyCascade.classDeleted.
 *
 *   The cascade is atomic: if the mutation fails, the entire snapshot
 *   is restored. No partial cleanup.
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
 *   - window.AcademyCascade (from academy-cascade.js) - LAZY
 *     When present, cross-domain cleanup on delete routes through it.
 *     When absent, cross-domain cleanup is skipped (the cascade
 *     coordinator is the single owner of the "what needs cleanup"
 *     list; the alternative is inline duplication, which is what the
 *     coordinator exists to eliminate).
 *
 * USAGE:
 *   var classes = window.AcademyClasses;
 *
 *   var result = classes.create('Class of 2026');
 *   var result = classes.update('class_123', { name: 'New Name' });
 *   var result = classes.delete('class_123');
 *
 *   var cls = classes.getClass('class_123');
 *   var all = classes.getClasses();
 *   var byName = classes.getClassByName('Class of 2026');
 *
 *   // Membership mutations (moved here in S10.1)
 *   classes.addToClass('char_456', 'class_123').then(...);
 *   classes.removeClassById('char_456', 'class_123').then(...);
 *   classes.addClassByName('char_456', 'New Class').then(...);
 *   classes.removeFromAllClasses('char_456').then(...);
 */

(function() {
    'use strict';

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

    function getAcademyCascade() {
        return window.AcademyCascade || null;
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
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyClasses] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
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
            return null;
        }

        return data.academy;
    }

    // ============================================================
    // INTERNAL CLASS LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

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

    function getActiveClassesInternal() {
        return getClassesByStatusInternal('active');
    }

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
    // CHARACTER ↔ CLASS - READ PATH (INTERNAL)
    // ============================================================

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
     */
    function create(name, options) {
        if (!isNonEmptyString(name)) {
            return Promise.resolve(failure('Class name is required.'));
        }

        var trimmedName = String(name).trim();

        var existing = getClassByNameInternal(trimmedName);
        if (existing) {
            return Promise.resolve(failure('A class with this name already exists.'));
        }

        options = options || {};

        var status = options.status || DEFAULT_STATUS;
        if (VALID_STATUSES.indexOf(status) === -1) {
            return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
        }

        var yearResult = validateYearValue(options.year);
        if (!yearResult.valid) {
            return Promise.resolve(failure(yearResult.message));
        }

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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: true };
                }
                var target = trimmedName.toLowerCase();
                var store = appData.academy.graduatingClasses;
                for (var id in store) {
                    if (Object.prototype.hasOwnProperty.call(store, id)) {
                        var cls = store[id];
                        if (cls && cls.name && String(cls.name).toLowerCase().trim() === target) {
                            return { valid: false, message: 'A class with this name already exists.' };
                        }
                    }
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
     */
    function update(classId, updates) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone class data.'));
        }

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

        if (updates.status !== undefined) {
            if (VALID_STATUSES.indexOf(updates.status) === -1) {
                return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
            }
            candidate.status = updates.status;
        }

        if (updates.year !== undefined) {
            var yearResult = validateYearValue(updates.year);
            if (!yearResult.valid) {
                return Promise.resolve(failure(yearResult.message));
            }
            candidate.year = yearResult.value;
        }

        if (updates.description !== undefined) {
            candidate.description = updates.description || '';
        }

        if (updates.instructorId !== undefined) {
            candidate.instructorId = updates.instructorId || null;
        }

        candidate.updatedAt = new Date().toISOString();

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!appData.academy.graduatingClasses[target]) {
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
     * CASCADE. In a single transaction it:
     *   1. Strips the classId from every character's classIds array.
     *   2. Deletes the class entity from academy.graduatingClasses.
     *   3. Delegates cross-domain cleanup (enrolments, grades,
     *      rankings, social scores, weekly teams) to
     *      AcademyCascade.classDeleted.
     *
     * The character-side strip is inline because AcademyClasses owns
     * the class-membership relationship on the character side. The
     * cross-domain parts are delegated so that adding a new
     * class-keyed store means updating one file (the coordinator),
     * not every delete path.
     */
    function deleteClass(classId) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        var className = existing.name;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!appData.academy.graduatingClasses[target]) {
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

                // ---- 1. Strip classId from every character ----
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

                // ---- 2. Delete the class entity ----
                delete data.academy.graduatingClasses[target];

                // ---- 3. Cross-domain cascade ----
                var cascade = null;
                var Cascade = getAcademyCascade();
                if (Cascade && typeof Cascade.classDeleted === 'function') {
                    cascade = Cascade.classDeleted(data, target);
                }

                return {
                    deleted: true,
                    classId: target,
                    className: className,
                    affectedCharacters: affectedCharacters,
                    academyCascade: cascade
                };
            },
            logMessage: function(result) {
                var parts = [];
                if (result.affectedCharacters > 0) {
                    parts.push(result.affectedCharacters + ' character(s) unassigned');
                }

                if (result.academyCascade) {
                    var Cascade = getAcademyCascade();
                    if (Cascade && typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(result.academyCascade);
                        if (summary) {
                            parts.push(summary.replace(/^\(|\)$/g, ''));
                        }
                    }
                }

                var suffix = parts.length > 0
                    ? ' (' + parts.join(', ') + ')'
                    : '';

                return 'Deleted class: ' + result.className + suffix;
            },
            successMessage: 'Class deleted successfully!',
            failureMessage: 'Failed to delete class.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

    function getClass(classId) {
        var record = getClassInternal(classId);
        return record ? deepClone(record) : null;
    }

    function getClasses() {
        var records = getClassesInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getClassesByStatus(status) {
        var records = getClassesByStatusInternal(status);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getClassByName(name) {
        var record = getClassByNameInternal(name);
        return record ? deepClone(record) : null;
    }

    function getDisplayName(classId) {
        return getClassDisplayNameInternal(classId);
    }

    function getCharacterClassNames(character) {
        return getCharacterClassNamesInternal(character);
    }

    function getCharacterClassesFor(character) {
        var records = getCharacterClassesInternal(character);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    // ============================================================
    // CLASS IDS NORMALISATION (moved here in S10.1)
    // ============================================================
    //
    // The character record's classIds array can drift. Duplicates,
    // empty strings, and non-array shapes all show up in practice.
    // These two helpers are the canonical shape enforcement.
    //
    // normaliseClassIds(char) MUTATES the character in place, replacing
    //   char.classIds with a deduplicated, filtered array.
    // getNormalisedClassIds(char) RETURNS a deduplicated, filtered
    //   array without touching the character.

    function normaliseClassIds(char) {
        if (!char) return;
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
            return;
        }

        var seen = new Set();
        char.classIds = char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function getNormalisedClassIds(char) {
        if (!char) return [];
        if (!Array.isArray(char.classIds)) return [];

        var seen = new Set();
        return char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ============================================================
    // MEMBERSHIP MUTATIONS (moved here in S10.1)
    // ============================================================
    //
    // These four functions write character.classIds. They route
    // through MutationPipeline. The class lookup goes through
    // AcademyClasses's own internal accessors (getClassInternal,
    // getClassByNameInternal), which read from the same store as the
    // entity CRUD above. There is no facade between them.

    /**
     * Add a character to a class by class ID.
     *
     * @param {string} charId
     * @param {string} classId
     * @returns {Promise<{success, data?, message?}>}
     */
    function addToClass(charId, classId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!classId) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        // Character read goes through CharacterQueries lazily; the
        // character store is not owned here.
        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve(failure('Character is already in this class.'));
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!getClassInternal(classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return { valid: false, message: 'Character is already in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (currentChar.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(classId);

                return {
                    characterId: charId,
                    classId: classId,
                    className: cls.name
                };
            },

            logMessage: function() {
                return 'Added ' + name + ' to class: ' + cls.name;
            },

            successMessage: function() {
                return 'Character added to class successfully!';
            },
            failureMessage: 'Failed to add character to class.'
        });
    }

    /**
     * Remove a character from a class by class ID.
     *
     * @param {string} charId
     * @param {string} classId
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeClassById(charId, classId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!classId) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (!classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve(failure('Character is not in this class.'));
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!getClassInternal(classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (!currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return { valid: false, message: 'Character is not in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                var found = false;
                currentChar.classIds = currentChar.classIds.filter(function(cid) {
                    if (String(cid) === String(classId)) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Character is not in this class.');
                }

                return {
                    characterId: charId,
                    classId: classId,
                    className: cls.name
                };
            },

            logMessage: function() {
                return 'Removed ' + name + ' from class: ' + cls.name;
            },

            successMessage: function() {
                return 'Character removed from class successfully!';
            },
            failureMessage: 'Failed to remove character from class.'
        });
    }

    /**
     * Add a character to a class by class name. Creates the class
     * entity inside the same transaction when the name does not
     * already resolve to a class.
     *
     * ENTITY SHAPE CONTRACT:
     *   The created class entity matches AcademyClasses.create's
     *   shape exactly: { id, name, status, year, description,
     *   instructorId, createdAt, updatedAt }.
     *
     * @param {string} charId
     * @param {string} className
     * @returns {Promise<{success, data?, message?}>}
     */
    function addClassByName(charId, className) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        if (!className || typeof className !== 'string' || className.trim() === '') {
            return Promise.resolve(failure('Class name is required.'));
        }

        var trimmedName = className.trim();

        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var existingClass = getClassByNameInternal(trimmedName);
        var name = CharacterQueries.getDisplayName(char);

        if (existingClass) {
            var classIds = getNormalisedClassIds(char);
            if (classIds.some(function(cid) { return String(cid) === String(existingClass.id); })) {
                return Promise.resolve(failure('Character is already in this class.'));
            }
        }

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                var currentClass = getClassByNameInternal(trimmedName);
                if (currentClass) {
                    var currentClassIds = getNormalisedClassIds(currentChar);
                    if (currentClassIds.some(function(cid) { return String(cid) === String(currentClass.id); })) {
                        return { valid: false, message: 'Character is already in this class.' };
                    }
                }

                return { valid: true };
            },

            mutate: function(data) {
                // Look for the class entity inside the transaction's
                // data snapshot, not the live store. This makes the
                // operation consistent with the rest of the pipeline.
                var classId = null;
                var className_ = trimmedName;
                var classCreated = false;

                if (!data.academy || typeof data.academy !== 'object') {
                    data.academy = {};
                }
                if (!data.academy.graduatingClasses ||
                    typeof data.academy.graduatingClasses !== 'object' ||
                    Array.isArray(data.academy.graduatingClasses)) {
                    data.academy.graduatingClasses = {};
                }

                // Look up existing class by name inside the snapshot.
                var nameLower = trimmedName.toLowerCase();
                var existing = null;
                Object.keys(data.academy.graduatingClasses).forEach(function(id) {
                    var c = data.academy.graduatingClasses[id];
                    if (c && c.name && String(c.name).toLowerCase() === nameLower) {
                        existing = c;
                        classId = id;
                    }
                });

                // Create the class entity directly if it doesn't exist.
                // We do NOT call AcademyClasses.create here — that is a
                // separate Promise-based pipeline call, and nesting
                // pipelines is not supported.
                if (!existing) {
                    var now = new Date().toISOString();
                    classId = IdUtils.generateId('class');
                    var newClass = {
                        id: classId,
                        name: trimmedName,
                        status: 'active',
                        year: null,
                        description: '',
                        instructorId: null,
                        createdAt: now,
                        updatedAt: now
                    };
                    data.academy.graduatingClasses[classId] = newClass;
                    existing = newClass;
                    classCreated = true;
                    className_ = newClass.name;
                } else {
                    className_ = existing.name;
                }

                // Add classId to the character.
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (currentChar.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(classId);

                return {
                    characterId: charId,
                    classId: classId,
                    className: className_,
                    classCreated: classCreated
                };
            },

            logMessage: function(result) {
                var action = result.classCreated ? 'created and added to' : 'added to';
                return action + ' class "' + result.className + '" for ' + name;
            },

            successMessage: function(result) {
                var action = result.classCreated ? 'created and added to' : 'added to';
                return 'Character ' + action + ' class "' + result.className + '"!';
            },
            failureMessage: 'Failed to add character to class.'
        });
    }

    /**
     * Remove a character from every class they are a member of.
     *
     * @param {string} charId
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeFromAllClasses(charId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.length === 0) {
            return Promise.resolve(success({
                count: 0,
                message: 'Character is not in any classes.'
            }));
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                var count = getNormalisedClassIds(currentChar).length;
                currentChar.classIds = [];

                return { removedCount: count };
            },

            logMessage: function(result) {
                return 'Removed ' + result.removedCount + ' classes from ' + name;
            },

            successMessage: function(result) {
                return 'Removed ' + result.removedCount + ' classes from ' + name + '.';
            },
            failureMessage: 'Failed to remove classes.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClasses = {
        // ---- Class Entity CRUD ----
        create: create,
        update: update,
        delete: deleteClass,

        // ---- Membership mutations (S10.1) ----
        addToClass: addToClass,
        removeClassById: removeClassById,
        addClassByName: addClassByName,
        removeFromAllClasses: removeFromAllClasses,

        // ---- Public lookups (CLONES) ----
        getClass: getClass,
        getClasses: getClasses,
        getClassesByStatus: getClassesByStatus,
        getClassByName: getClassByName,
        getDisplayName: getDisplayName,
        getCharacterClassNames: getCharacterClassNames,
        getCharacterClasses: getCharacterClassesFor,

        // ---- Internal (LIVE REFERENCES) ----
        getClassInternal: getClassInternal,
        getClassesInternal: getClassesInternal,
        getClassesByStatusInternal: getClassesByStatusInternal,
        getClassByNameInternal: getClassByNameInternal,
        getClassDisplayNameInternal: getClassDisplayNameInternal,
        getCharacterClassNamesInternal: getCharacterClassNamesInternal,
        getCharacterClassesInternal: getCharacterClassesInternal,

        // ---- Class IDs normalisation (S10.1) ----
        normaliseClassIds: normaliseClassIds,
        getNormalisedClassIds: getNormalisedClassIds,

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS
    };

})();
