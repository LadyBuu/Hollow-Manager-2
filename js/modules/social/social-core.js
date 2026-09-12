/**
 * modules/social/social-core.js - Social Domain Core
 * Relationship CRUD operations with full mutation pipeline
 *
 * This module provides:
 *   - createRelationship - Create a new relationship
 *   - updateRelationship - Update an existing relationship
 *   - deleteRelationship - Delete a relationship
 *   - deleteAllRelationshipsForCharacter - Delete all relationships for a character
 *   - validateRelationshipData - Pure validation function
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - All mutations use MutationPipeline for transactional safety
 *   - No DOM, no UI, no notifications, no rendering
 *   - Uses SocialQueries for read operations (Social data only)
 *   - Uses injected characterProvider for character existence (tiny interface)
 *   - Uses SocialConstants for type definitions
 *   - Returns structured results { success, data?, message?, error? }
 *   - No confirm() dialogs - caller handles UI
 *   - No window.data fallbacks - data structure must exist
 *   - characterProvider is INJECTED via init() - no fallback to CharacterQueries
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Any integer >= 1 is a valid year.
 *   - A null, empty, or missing year is also valid (means "year not
 *     specified").
 *   - Years are stored as strings on the relationship record. When a
 *     year is provided, it is normalised to a canonical string form
 *     (no leading zeros, no whitespace).
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, every relationship involving that
 *   character is removed from social.relationships. Relationships are
 *   stored as { character1, character2, ... }; both sides are checked.
 *   This helper is called by CharacterCRUD.deleteCharacter from inside
 *   its pipeline mutate, so it runs in the same transaction as the
 *   character removal.
 *
 * CHARACTER PROVIDER INTERFACE:
 *   {
 *       exists: function(characterId) { return true/false }
 *   }
 *
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *
 * USAGE:
 *   SocialCore.init({
 *       characterProvider: {
 *           exists: function(id) { return CharacterQueries.getCharacterById(id) !== null; }
 *       }
 *   });
 *
 *   var result = SocialCore.createRelationship('char1', 'char2', 'friendship');
 *   if (result.success) {
 *       // relationship created
 *   }
 */

(function() {
    'use strict';

    if (window.__socialCoreLoaded) {
        return;
    }
    window.__socialCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialConstants = window.SocialConstants;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // INJECTED DEPENDENCIES
    // ============================================================

    var _characterProvider = null;

    /**
     * Initialize SocialCore with injected dependencies.
     * Must be called before any mutation operations.
     *
     * @param {object} deps - Dependency injection object
     * @param {object} deps.characterProvider - Character provider with exists() method
     */
    function init(deps) {
        deps = deps || {};

        if (deps.characterProvider) {
            if (typeof deps.characterProvider.exists !== 'function') {
                console.warn('[SocialCore] characterProvider must have an exists() method.');
            } else {
                _characterProvider = deps.characterProvider;
            }
        }

        return _characterProvider !== null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getRelationshipById !== 'function') {
            missing.push('SocialQueries.getRelationshipById');
        }
        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.relationshipExists !== 'function') {
            missing.push('SocialQueries.relationshipExists');
        }

        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            missing.push('SocialConstants.isDirectional');
        }
        if (!SocialConstants || typeof SocialConstants.isValidType !== 'function') {
            missing.push('SocialConstants.isValidType');
        }
        if (!SocialConstants || typeof SocialConstants.getDefaultTypeId !== 'function') {
            missing.push('SocialConstants.getDefaultTypeId');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        // characterProvider is optional (for tests), but warn if not set
        if (!_characterProvider || typeof _characterProvider.exists !== 'function') {
            missing.push('characterProvider.exists (call SocialCore.init() first)');
        }

        if (missing.length > 0) {
            console.warn('[SocialCore] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // VALIDATION - Pure function
    // ============================================================

    /**
     * Validate relationship data.
     * This is a PURE function - no side effects, no state mutation.
     *
     * @param {object} data - Relationship data to validate
     * @param {object} options - Optional validation options
     * @param {boolean} options.checkDuplicates - Check for duplicates (default: true)
     * @returns {object} { valid: boolean, errors: string[] }
     */
    function validateRelationshipData(data, options) {
        options = options || { checkDuplicates: true };
        var errors = [];

        var char1 = data.character1;
        var char2 = data.character2;
        var typeId = data.typeId;

        // Character 1 validation
        if (!char1 || String(char1).trim() === '') {
            errors.push('Character 1 is required.');
        }

        // Character 2 validation
        if (!char2 || String(char2).trim() === '') {
            errors.push('Character 2 is required.');
        }

        // Same character check
        if (char1 && char2 && String(char1) === String(char2)) {
            errors.push('Cannot create a relationship between the same character.');
        }

        // Character existence validation - uses injected characterProvider
        if (char1 && _characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(char1)) {
                errors.push('Character 1 does not exist.');
            }
        }

        if (char2 && _characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(char2)) {
                errors.push('Character 2 does not exist.');
            }
        }

        // Type validation
        if (!typeId) {
            errors.push('Relationship type is required.');
        } else if (!SocialConstants.isValidType(typeId)) {
            errors.push('Invalid relationship type.');
        }

        // Year validation (unbounded positive integers, or empty)
        if (data.startYear !== undefined && data.startYear !== null && data.startYear !== '') {
            if (!isValidYear(data.startYear)) {
                errors.push('Start year must be a positive integer.');
            }
        }

        if (data.endYear !== undefined && data.endYear !== null && data.endYear !== '') {
            if (!isValidYear(data.endYear)) {
                errors.push('End year must be a positive integer.');
            }
        }

        // Year range validation
        var startNum = Number(data.startYear);
        var endNum = Number(data.endYear);
        if (data.startYear && data.endYear && isValidYear(data.startYear) && isValidYear(data.endYear)) {
            if (endNum < startNum) {
                errors.push('End year must be after start year.');
            }
        }

        // Duplicate check
        if (options.checkDuplicates && char1 && char2 && typeId) {
            if (SocialQueries.relationshipExists(char1, char2, typeId)) {
                var label = SocialConstants.getLabel(typeId);
                errors.push('A ' + label + ' relationship already exists between these characters.');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate a year value.
     *
     * Years are UNBOUNDED positive integers. Any integer >= 1 is valid.
     * An empty, null, or undefined value is also valid (means "year not
     * specified").
     *
     * @param {*} value - Year value to validate
     * @returns {boolean} True if valid
     */
    function isValidYear(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }

        var num = Number(value);
        return Number.isInteger(num) && num >= 1;
    }

    /**
     * Normalise a year value for storage.
     *
     * Years are stored as strings. A valid year is normalised to its
     * canonical string form. An invalid year is normalised to an empty
     * string (the caller's validator is responsible for rejecting it
     * before normalisation runs; this function is forgiving).
     *
     * @param {*} value - Year value to normalise
     * @returns {string} Normalised year string or empty string
     */
    function normaliseYear(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }

        var num = Number(value);
        if (Number.isInteger(num) && num >= 1) {
            return String(num);
        }

        return '';
    }

    /**
     * Normalise a text value.
     *
     * @param {*} value - Text value to normalise
     * @returns {string} Normalised text string
     */
    function normaliseText(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value).trim();
    }

    /**
     * Normalise a character ID.
     *
     * @param {*} value - ID value to normalise
     * @returns {string} Normalised ID string or empty string
     */
    function normaliseId(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    // ============================================================
    // MUTATION HELPERS
    // ============================================================

    /**
     * Get the next relationship ID.
     * Uses the social.nextId counter.
     *
     * @param {object} data - Application data object
     * @returns {number} Next relationship ID
     */
    function getNextId(data) {
        if (!data.social) {
            data.social = {};
        }

        if (!data.social.relationships) {
            data.social.relationships = [];
        }

        if (typeof data.social.nextId !== 'number' || data.social.nextId < 1) {
            data.social.nextId = 1;
        }

        // Ensure no collisions with existing IDs
        var existingIds = Object.create(null);
        data.social.relationships.forEach(function(rel) {
            if (rel && rel.id !== undefined && rel.id !== null) {
                existingIds[String(rel.id)] = true;
            }
        });

        var nextId = data.social.nextId;
        while (existingIds[String(nextId)]) {
            nextId++;
        }

        data.social.nextId = nextId + 1;
        return nextId;
    }

    // ============================================================
    // CORE MUTATIONS - Using MutationPipeline
    // ============================================================

    /**
     * Create a new relationship.
     *
     * @param {string} charId1 - First character ID
     * @param {string} charId2 - Second character ID
     * @param {string} typeId - Relationship type ID
     * @param {string|number} startYear - Start year (optional)
     * @param {string|number} endYear - End year (optional)
     * @param {string} clarification - Clarification text (optional)
     * @param {string} notes - Notes (optional)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function createRelationship(charId1, charId2, typeId, startYear, endYear, clarification, notes) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        // Normalise inputs
        var c1 = normaliseId(charId1);
        var c2 = normaliseId(charId2);
        var type = normaliseText(typeId);
        var start = normaliseYear(startYear);
        var end = normaliseYear(endYear);
        var clar = normaliseText(clarification);
        var noteText = normaliseText(notes);

        // Validate
        var validation = validateRelationshipData({
            character1: c1,
            character2: c2,
            typeId: type,
            startYear: start,
            endYear: end,
            clarification: clar,
            notes: noteText
        });

        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.errors.join(' '),
                errors: validation.errors
            });
        }

        var label = SocialConstants.getLabel(type);

        return MutationPipeline.performMutation({
            validate: function(data) {
                // Re-validate within the transaction
                var currentValidation = validateRelationshipData({
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification: clar,
                    notes: noteText
                }, { checkDuplicates: true });

                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: currentValidation.errors.join(' ')
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                // Ensure social structure exists
                if (!data.social) {
                    data.social = {};
                }
                if (!Array.isArray(data.social.relationships)) {
                    data.social.relationships = [];
                }

                // Get next ID
                var id = getNextId(data);

                // Create relationship object
                var relationship = {
                    id: id,
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification: clar,
                    notes: noteText,
                    createdAt: new Date().toISOString()
                };

                data.social.relationships.push(relationship);

                return { relationship: relationship };
            },

            logMessage: function() {
                return 'Created ' + label + ' relationship';
            },

            successMessage: 'Relationship created successfully!',
            failureMessage: 'Failed to create relationship.'
        });
    }

    /**
     * Update an existing relationship.
     *
     * @param {string|number} id - Relationship ID
     * @param {object} updates - Updates to apply
     * @param {string} updates.character1 - New character 1 ID (optional)
     * @param {string} updates.character2 - New character 2 ID (optional)
     * @param {string} updates.typeId - New relationship type ID (optional)
     * @param {string|number} updates.startYear - New start year (optional)
     * @param {string|number} updates.endYear - New end year (optional)
     * @param {string} updates.clarification - New clarification (optional)
     * @param {string} updates.notes - New notes (optional)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function updateRelationship(id, updates) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!id) {
            return Promise.resolve({
                success: false,
                message: 'Relationship ID is required.'
            });
        }

        var relId = String(id);

        var existing = SocialQueries.getRelationshipById(relId);
        if (!existing) {
            return Promise.resolve({
                success: false,
                message: 'Relationship not found.'
            });
        }

        // Normalise updates
        var c1 = updates.character1 !== undefined ? normaliseId(updates.character1) : existing.character1;
        var c2 = updates.character2 !== undefined ? normaliseId(updates.character2) : existing.character2;
        var type = updates.typeId !== undefined ? normaliseText(updates.typeId) : existing.typeId;
        var start = updates.startYear !== undefined ? normaliseYear(updates.startYear) : existing.startYear;
        var end = updates.endYear !== undefined ? normaliseYear(updates.endYear) : existing.endYear;
        var clar = updates.clarification !== undefined ? normaliseText(updates.clarification) : existing.clarification;
        var noteText = updates.notes !== undefined ? normaliseText(updates.notes) : existing.notes;

        // Validate the proposed state
        var validation = validateRelationshipData({
            character1: c1,
            character2: c2,
            typeId: type,
            startYear: start,
            endYear: end,
            clarification: clar,
            notes: noteText
        }, { checkDuplicates: true });

        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.errors.join(' '),
                errors: validation.errors
            });
        }

        var label = SocialConstants.getLabel(type);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentRel = SocialQueries.getRelationshipById(relId);
                if (!currentRel) {
                    return {
                        valid: false,
                        message: 'Relationship no longer exists.'
                    };
                }

                var currentValidation = validateRelationshipData({
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification: clar,
                    notes: noteText
                }, { checkDuplicates: true });

                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: currentValidation.errors.join(' ')
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var rel = null;
                var index = -1;

                if (data.social && Array.isArray(data.social.relationships)) {
                    for (var i = 0; i < data.social.relationships.length; i++) {
                        if (data.social.relationships[i] && String(data.social.relationships[i].id) === relId) {
                            rel = data.social.relationships[i];
                            index = i;
                            break;
                        }
                    }
                }

                if (!rel) {
                    throw new Error('Relationship not found in data store.');
                }

                rel.character1 = c1;
                rel.character2 = c2;
                rel.typeId = type;
                rel.startYear = start;
                rel.endYear = end;
                rel.clarification = clar;
                rel.notes = noteText;

                return { relationship: rel };
            },

            logMessage: function() {
                return 'Updated ' + label + ' relationship';
            },

            successMessage: 'Relationship updated successfully!',
            failureMessage: 'Failed to update relationship.'
        });
    }

    /**
     * Delete a relationship.
     *
     * @param {string|number} id - Relationship ID
     * @returns {Promise<{ success: boolean, message?: string }>}
     */
    function deleteRelationship(id) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!id) {
            return Promise.resolve({
                success: false,
                message: 'Relationship ID is required.'
            });
        }

        var relId = String(id);

        var existing = SocialQueries.getRelationshipById(relId);
        if (!existing) {
            return Promise.resolve({
                success: false,
                message: 'Relationship not found.'
            });
        }

        var label = SocialConstants.getLabel(existing.typeId);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentRel = SocialQueries.getRelationshipById(relId);
                if (!currentRel) {
                    return {
                        valid: false,
                        message: 'Relationship no longer exists.'
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                if (!data.social || !Array.isArray(data.social.relationships)) {
                    throw new Error('No relationships found.');
                }

                var found = false;
                data.social.relationships = data.social.relationships.filter(function(rel) {
                    if (rel && String(rel.id) === relId) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Relationship not found in data store.');
                }

                return { deleted: true };
            },

            logMessage: function() {
                return 'Deleted ' + label + ' relationship';
            },

            successMessage: 'Relationship deleted successfully!',
            failureMessage: 'Failed to delete relationship.'
        });
    }

    /**
     * Delete all relationships involving a character.
     *
     * @param {string} charId - Character ID
     * @returns {Promise<{ success: boolean, count?: number, message?: string }>}
     */
    function deleteAllRelationshipsForCharacter(charId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var target = String(charId);

        // Check character exists via injected provider
        if (_characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(target)) {
                return Promise.resolve({
                    success: false,
                    message: 'Character not found.'
                });
            }
        }

        var rels = SocialQueries.getCharacterRelationships(target);
        if (rels.length === 0) {
            return Promise.resolve({
                success: true,
                count: 0,
                message: 'No relationships to delete.'
            });
        }

        var relIds = rels.map(function(rel) { return String(rel.id); });

        return MutationPipeline.performMutation({
            validate: function(data) {
                return { valid: true };
            },

            mutate: function(data) {
                if (!data.social || !Array.isArray(data.social.relationships)) {
                    throw new Error('No relationships found.');
                }

                var count = 0;
                data.social.relationships = data.social.relationships.filter(function(rel) {
                    if (!rel) { return true; }

                    var c1 = String(rel.character1);
                    var c2 = String(rel.character2);

                    if (c1 === target || c2 === target) {
                        count++;
                        return false;
                    }
                    return true;
                });

                return { deletedCount: count };
            },

            logMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' relationships for character';
            },

            successMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' relationships.';
            },
            failureMessage: 'Failed to delete relationships.'
        });
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    /**
     * Strip all social relationships involving a character.
     *
     * Relationships are stored as { character1, character2, ... }.
     * Whether the type is directional or not, any relationship where
     * either side matches the deleted character is unreachable and is
     * removed.
     *
     * This helper is PURE with respect to `appData`: it mutates the
     * store, but it does not touch `window.data`. It is designed to be
     * called from inside a pipeline mutate() callback in another
     * module's transaction. It never throws.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID to strip
     * @returns {object} { relationshipsRemoved }
     */
    function stripCharacterRefs(appData, charId) {
        var result = { relationshipsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        if (!appData.social || typeof appData.social !== 'object') {
            return result;
        }

        var relationships = appData.social.relationships;
        if (!Array.isArray(relationships)) {
            return result;
        }

        var target = String(charId);
        var before = relationships.length;

        appData.social.relationships = relationships.filter(function(rel) {
            if (!rel) {
                return true;
            }
            return String(rel.character1) !== target &&
                   String(rel.character2) !== target;
        });

        result.relationshipsRemoved = before - appData.social.relationships.length;
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialCore = {
        // Initialization
        init: init,

        // Mutations
        createRelationship: createRelationship,
        updateRelationship: updateRelationship,
        deleteRelationship: deleteRelationship,
        deleteAllRelationshipsForCharacter: deleteAllRelationshipsForCharacter,

        // Cascade helpers (for cross-domain cleanup)
        stripCharacterRefs: stripCharacterRefs,

        // Validation (pure, for external use)
        validateRelationshipData: validateRelationshipData,
        isValidYear: isValidYear,

        // Normalisation (for external use)
        normaliseYear: normaliseYear,
        normaliseText: normaliseText,
        normaliseId: normaliseId
    };

})();