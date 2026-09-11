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
 *   VALIDATE -> SNAPSHOT -> MUTATE -> PERSIST -> LOG -> UI COMMIT
 *   Returns structured results for caller handling
 *   No UI dependencies (no notifications, no confirm, no rendering)
 *   No DOM access
 *   USES CharacterQueries for character data and display names
 *   USES AcademyQueries for class data (reads only)
 *   USES MutationPipeline for transaction management
 *   USES IdUtils for ID generation
 * 
 * CLASS ENTITY CREATION:
 *   addClassByName is self-contained. When the named class does not
 *   exist, it creates the class entity DIRECTLY inside its own
 *   MutationPipeline transaction. It does NOT call AcademyClasses.create,
 *   because that is itself a Promise-based pipeline call — nesting
 *   pipelines would either deadlock or corrupt the transaction.
 * 
 *   The class entity shape produced here MUST match what AcademyClasses
 *   produces on its own create path. If AcademyClasses ever changes its
 *   entity shape, this file needs updating in lockstep. The shape is:
 *     { id, name, status, year, description, instructorId,
 *       createdAt, updatedAt }
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
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

    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassByName !== 'function') {
            missing.push('AcademyQueries.getClassByName');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (missing.length > 0) {
            throw new Error('CharacterClasses: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

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

    function addToClass(charId, classId) {
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

        var cls = AcademyQueries.getClass(classId);
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
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentClass = AcademyQueries.getClass(classId);
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

    function removeClassById(charId, classId) {
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

        var cls = AcademyQueries.getClass(classId);
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

                var currentClass = AcademyQueries.getClass(classId);
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

            logMessage: function() {
                return 'Removed ' + name + ' from class: ' + cls.name;
            },

            successMessage: function() {
                return 'Character removed from class successfully!';
            },
            failureMessage: 'Failed to remove character from class.'
        });
    }

    function addClassByName(charId, className) {
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

        var existingClass = AcademyQueries.getClassByName(trimmedName);
        var name = CharacterQueries.getDisplayName(char);

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

                var currentClass = AcademyQueries.getClassByName(trimmedName);
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

    function removeFromAllClasses(charId) {
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

    function getCharacterClasses(char) {
        return AcademyQueries.getCharacterClasses(char);
    }

    function getCharacterClassNames(char) {
        return AcademyQueries.getCharacterClassNames(char);
    }

    function getCharactersByClass(classId) {
        return AcademyQueries.getClassStudents(classId);
    }

    function getAvailableStudentsForClass(classId, week) {
        return AcademyQueries.getAvailableStudents(classId, week);
    }

    window.CharacterClasses = {
        addToClass: addToClass,
        removeClassById: removeClassById,
        addClassByName: addClassByName,
        removeFromAllClasses: removeFromAllClasses,

        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getCharactersByClass: getCharactersByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,

        normaliseClassIds: normaliseClassIds,
        getNormalisedClassIds: getNormalisedClassIds
    };

})();