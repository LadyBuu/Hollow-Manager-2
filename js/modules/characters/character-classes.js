/**
 * js/modules/characters/character-classes.js - Character Classes
 * Handles adding/removing characters from classes
 * Path: js/modules/characters/character-classes.js
 * 
 * This module is responsible for:
 *   - Adding characters to classes (via MutationPipeline)
 *   - Removing characters from classes (via MutationPipeline)
 *   - Adding classes by name (via MutationPipeline)
 * 
 * IMPORTANT: All mutations use MutationPipeline:
 *   VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
 *   Returns structured results for caller handling
 *   No UI dependencies (no notifications, no confirm, no rendering)
 *   No DOM access
 *   USES CharacterQueries for character data and display names
 *   USES ClassesQueries for class data
 *   USES ClassesCore for class creation (NON-PERSISTING when used in transactions)
 *   USES MutationPipeline for transaction management
 *   USES IdUtils for ID generation
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.ClassesQueries (from classes-queries.js) - MANDATORY
 *   - window.ClassesCore (from classes-core.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var CC = window.CharacterClasses;
 *   CC.addToClass('char_123', 'class_456')
 *      .then(function(result) { ... });
 *   CC.removeClassById('char_123', 'class_456')
 *      .then(function(result) { ... });
 *   CC.addClassByName('char_123', 'New Class')
 *      .then(function(result) { ... });
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var ClassesCore = window.ClassesCore;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // ClassesQueries is MANDATORY
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClassByName !== 'function') {
            missing.push('ClassesQueries.getClassByName');
        }

        // ClassesCore is MANDATORY
        if (!ClassesCore || typeof ClassesCore.createClassInState !== 'function') {
            missing.push('ClassesCore.createClassInState');
        }

        // MutationPipeline is MANDATORY
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        // IdUtils is MANDATORY
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (missing.length > 0) {
            console.warn('CharacterClasses: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NORMALISATION HELPERS
    // ============================================================

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
    // ADD TO CLASS - Uses MutationPipeline
    // ============================================================

    /**
     * Add a character to a class.
     * 
     * @param {string} charId - Character ID
     * @param {string} classId - Class ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addToClass(charId, classId) {
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

        if (!classId) {
            return Promise.resolve({
                success: false,
                message: 'Class ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return Promise.resolve({
                success: false,
                message: 'Class not found.'
            });
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve({
                success: false,
                message: 'Character is already in this class.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                // Re-validate within transaction
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentClass = ClassesQueries.getClass(classId);
                if (!currentClass) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return {
                        valid: false,
                        message: 'Character is already in this class.'
                    };
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

                // Prevent duplicate in case of race
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

            logMessage: function(result) {
                return 'Added ' + name + ' to class: ' + cls.name;
            },

            successMessage: function(result) {
                return 'Character added to class successfully!';
            },
            failureMessage: 'Failed to add character to class.'
        });
    }

    // ============================================================
    // REMOVE FROM CLASS BY ID - Uses MutationPipeline
    // ============================================================

    /**
     * Remove a character from a class by class ID.
     * 
     * @param {string} charId - Character ID
     * @param {string} classId - Class ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeClassById(charId, classId) {
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

        if (!classId) {
            return Promise.resolve({
                success: false,
                message: 'Class ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return Promise.resolve({
                success: false,
                message: 'Class not found.'
            });
        }

        var classIds = getNormalisedClassIds(char);
        if (!classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve({
                success: false,
                message: 'Character is not in this class.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentClass = ClassesQueries.getClass(classId);
                if (!currentClass) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (!currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return {
                        valid: false,
                        message: 'Character is not in this class.'
                    };
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

            logMessage: function(result) {
                return 'Removed ' + name + ' from class: ' + cls.name;
            },

            successMessage: function(result) {
                return 'Character removed from class successfully!';
            },
            failureMessage: 'Failed to remove character from class.'
        });
    }

    // ============================================================
    // ADD CLASS BY NAME - Uses MutationPipeline
    // ============================================================

    /**
     * Add a character to a class by class name.
     * Creates the class if it doesn't exist.
     * 
     * @param {string} charId - Character ID
     * @param {string} className - Class name
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addClassByName(charId, className) {
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

        if (!className || typeof className !== 'string' || className.trim() === '') {
            return Promise.resolve({
                success: false,
                message: 'Class name is required.'
            });
        }

        var trimmedName = className.trim();

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var existingClass = ClassesQueries.getClassByName(trimmedName);
        var name = CharacterQueries.getDisplayName(char);

        // Check if character already in this class
        if (existingClass) {
            var classIds = getNormalisedClassIds(char);
            if (classIds.some(function(cid) { return String(cid) === String(existingClass.id); })) {
                return Promise.resolve({
                    success: false,
                    message: 'Character is already in this class.'
                });
            }
        }

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                // Check if class exists and character is already in it
                var currentClass = ClassesQueries.getClassByName(trimmedName);
                if (currentClass) {
                    var currentClassIds = getNormalisedClassIds(currentChar);
                    if (currentClassIds.some(function(cid) { return String(cid) === String(currentClass.id); })) {
                        return {
                            valid: false,
                            message: 'Character is already in this class.'
                        };
                    }
                }

                return { valid: true };
            },

            mutate: function(data) {
                // Find or create class (in-state, non-persisting)
                var cls = ClassesQueries.getClassByName(trimmedName);

                if (!cls) {
                    var result = ClassesCore.createClassInState(data, trimmedName);
                    if (!result || !result.success) {
                        throw new Error(result ? result.message : 'Failed to create class.');
                    }
                    cls = result.class;
                }

                // Add character to class
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                // Prevent duplicate
                if (currentChar.classIds.some(function(cid) { return String(cid) === String(cls.id); })) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(cls.id);

                return {
                    characterId: charId,
                    classId: cls.id,
                    className: cls.name,
                    classCreated: !existingClass
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

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Remove a character from all classes.
     * 
     * @param {string} charId - Character ID
     * @returns {Promise<{ success: boolean, count?: number, message?: string }>}
     */
    function removeFromAllClasses(charId) {
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

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.length === 0) {
            return Promise.resolve({
                success: true,
                count: 0,
                message: 'Character is not in any classes.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
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
    // QUERY HELPERS (delegated to ClassesQueries)
    // ============================================================

    /**
     * Get classes for a character.
     * Delegated to ClassesQueries.
     */
    function getCharacterClasses(char) {
        return ClassesQueries.getCharacterClasses(char);
    }

    /**
     * Get class names for a character.
     * Delegated to ClassesQueries.
     */
    function getCharacterClassNames(char) {
        return ClassesQueries.getCharacterClassNames(char);
    }

    /**
     * Get characters by class.
     * Delegated to ClassesQueries.
     */
    function getCharactersByClass(classId) {
        return ClassesQueries.getCharactersByClass(classId);
    }

    /**
     * Get available students for a class.
     * Delegated to ClassesQueries.
     */
    function getAvailableStudentsForClass(classId, week) {
        return ClassesQueries.getAvailableStudentsForClass(classId, week);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClasses = {
        // Mutations
        addToClass: addToClass,
        removeClassById: removeClassById,
        addClassByName: addClassByName,
        removeFromAllClasses: removeFromAllClasses,

        // Queries (delegated to ClassesQueries)
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getCharactersByClass: getCharactersByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,

        // Helpers
        normaliseClassIds: normaliseClassIds,
        getNormalisedClassIds: getNormalisedClassIds
    };

})();