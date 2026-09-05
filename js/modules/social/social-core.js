/**
 * modules/social/social-core.js - Social Domain Core
 * Relationship CRUD operations with full mutation pipeline
 * Path: js/modules/social/social-core.js
 * 
 * This module provides:
 *   - createRelationship - Create a new relationship
 *   - updateRelationship - Update an existing relationship
 *   - deleteRelationship - Delete a relationship
 *   - validateRelationshipData - Pure validation function
 * 
 * IMPORTANT:
 *   - All mutations use MutationPipeline for transactional safety
 *   - No DOM, no UI, no notifications, no rendering
 *   - Uses SocialQueries for read operations
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for character validation
 *   - Returns structured results { success, data?, message?, error? }
 *   - No confirm() dialogs - caller handles UI
 *   - No window.data fallbacks - data structure must exist
 * 
 * MUTATION CONTRACT:
 *   - All mutations are serialised via MutationPipeline
 *   - Rollback is automatic on persistence failure
 *   - Activity logging is handled by MutationPipeline
 *   - Notifications are caller responsibility
 * 
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 * 
 * USAGE:
 *   var SC = window.SocialCore;
 *   var result = SC.createRelationship('char1', 'char2', 'friendship');
 *   if (result.success) {
 *       // relationship created
 *   }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialCoreLoaded) {
        return;
    }
    window.__socialCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialConstants = window.SocialConstants;
    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;

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

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
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

        // Character existence validation
        if (char1) {
            var c1 = CharacterQueries.getCharacterById(char1);
            if (!c1) {
                errors.push('Character 1 does not exist.');
            }
        }

        if (char2) {
            var c2 = CharacterQueries.getCharacterById(char2);
            if (!c2) {
                errors.push('Character 2 does not exist.');
            }
        }

        // Type validation
        if (!typeId) {
            errors.push('Relationship type is required.');
        } else if (!SocialConstants.isValidType(typeId)) {
            errors.push('Invalid relationship type.');
        }

        // Year validation
        if (data.startYear !== undefined && data.startYear !== null && data.startYear !== '') {
            if (!isValidYear(data.startYear)) {
                errors.push('Start year must be a valid year.');
            }
        }

        if (data.endYear !== undefined && data.endYear !== null && data.endYear !== '') {
            if (!isValidYear(data.endYear)) {
                errors.push('End year must be a valid year.');
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
     * @param {*} value - Year value to validate
     * @returns {boolean} True if valid
     */
    function isValidYear(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }

        var num = Number(value);
        return Number.isInteger(num) && num > 0 && num < 10000;
    }

    /**
     * Normalise a year value for storage.
     * 
     * @param {*} value - Year value to normalise
     * @returns {string} Normalised year string or empty string
     */
    function normaliseYear(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }

        var num = Number(value);
        if (Number.isInteger(num) && num > 0 && num < 10000) {
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

            logMessage: function(result) {
                var char1 = CharacterQueries.getCharacterById(c1);
                var char2 = CharacterQueries.getCharacterById(c2);
                var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
                var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';
                return 'Created ' + label + ' relationship between ' + name1 + ' and ' + name2;
            },

            successMessage: 'Relationship created successfully!',
            failureMessage: 'Failed to create relationship.',
            skipNotification: false,
            skipLog: false
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

        // Normalise ID
        var relId = String(id);

        // Find the relationship (read-only check)
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
                // Verify relationship still exists
                var currentRel = SocialQueries.getRelationshipById(relId);
                if (!currentRel) {
                    return {
                        valid: false,
                        message: 'Relationship no longer exists.'
                    };
                }

                // Re-validate with current state
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
                // Find the relationship in the live data
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

                // Apply updates
                rel.character1 = c1;
                rel.character2 = c2;
                rel.typeId = type;
                rel.startYear = start;
                rel.endYear = end;
                rel.clarification = clar;
                rel.notes = noteText;

                return { relationship: rel };
            },

            logMessage: function(result) {
                var char1 = CharacterQueries.getCharacterById(c1);
                var char2 = CharacterQueries.getCharacterById(c2);
                var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
                var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';
                return 'Updated ' + label + ' relationship between ' + name1 + ' and ' + name2;
            },

            successMessage: 'Relationship updated successfully!',
            failureMessage: 'Failed to update relationship.',
            skipNotification: false,
            skipLog: false
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

        // Verify relationship exists (read-only check)
        var existing = SocialQueries.getRelationshipById(relId);
        if (!existing) {
            return Promise.resolve({
                success: false,
                message: 'Relationship not found.'
            });
        }

        var char1 = CharacterQueries.getCharacterById(existing.character1);
        var char2 = CharacterQueries.getCharacterById(existing.character2);
        var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
        var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';
        var label = SocialConstants.getLabel(existing.typeId);

        return MutationPipeline.performMutation({
            validate: function(data) {
                // Verify relationship still exists
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
                return 'Deleted ' + label + ' relationship between ' + name1 + ' and ' + name2;
            },

            successMessage: 'Relationship deleted successfully!',
            failureMessage: 'Failed to delete relationship.',
            skipNotification: false,
            skipLog: false
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

        // Check character exists
        var char = CharacterQueries.getCharacterById(target);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        // Get all relationships for the character
        var rels = SocialQueries.getCharacterRelationships(target);
        if (rels.length === 0) {
            return Promise.resolve({
                success: true,
                count: 0,
                message: 'No relationships to delete.'
            });
        }

        var relIds = rels.map(function(rel) { return String(rel.id); });
        var name = CharacterQueries.getDisplayName(char);

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
                    if (!rel) return true;

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
                return 'Deleted ' + result.deletedCount + ' relationships involving ' + name;
            },

            successMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' relationships for ' + name + '.';
            },
            failureMessage: 'Failed to delete relationships.',
            skipNotification: false,
            skipLog: false
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialCore = {
        // Mutations
        createRelationship: createRelationship,
        updateRelationship: updateRelationship,
        deleteRelationship: deleteRelationship,
        deleteAllRelationshipsForCharacter: deleteAllRelationshipsForCharacter,

        // Validation (pure, for external use)
        validateRelationshipData: validateRelationshipData,
        isValidYear: isValidYear,

        // Normalisation (for external use)
        normaliseYear: normaliseYear,
        normaliseText: normaliseText,
        normaliseId: normaliseId
    };

})();