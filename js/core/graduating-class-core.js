/**
 * core/graduating-class-core.js - Graduating Class Core Operations
 * Path: js/core/graduating-class-core.js
 * 
 * This module handles:
 *   - Graduating class CRUD
 *   - Character assignment to classes
 *   - Character role management (trainee/instructor)
 *   - Class-specific queries
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query functions return their documented value types
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__graduatingClassCoreLoaded) {
        return;
    }
    window.__graduatingClassCoreLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
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
            try {
                window.logActivity(message, type);
            } catch (e) {
                console.error('GraduatingClassCore: activity logging failed:', e);
            }
        }
    }

    function generateId(prefix) {
        prefix = prefix || 'gradclass';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('GraduatingClassCore: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('GraduatingClassCore: JSON clone failed:', e);
            return null;
        }
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

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // GRADUATING CLASS CRUD
    // ============================================================

    function getGraduatingClass(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = getDataStore();
        if (!data) {
            return null;
        }

        // Initialize graduatingClasses array if it doesn't exist
        if (!Array.isArray(data.graduatingClasses)) {
            data.graduatingClasses = [];
        }

        var cls = data.graduatingClasses.find(function(c) {
            return c && String(c.id) === String(id);
        });

        return cls ? deepClone(cls) : null;
    }

    function getGraduatingClasses() {
        var data = getDataStore();
        if (!data) {
            return [];
        }

        if (!Array.isArray(data.graduatingClasses)) {
            data.graduatingClasses = [];
            return [];
        }

        var result = [];
        for (var i = 0; i < data.graduatingClasses.length; i++) {
            var cloned = deepClone(data.graduatingClasses[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getGraduatingClassByName(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!Array.isArray(data.graduatingClasses)) {
            data.graduatingClasses = [];
            return null;
        }

        var target = name.trim().toLowerCase();
        var cls = data.graduatingClasses.find(function(c) {
            return c && c.name && c.name.trim().toLowerCase() === target;
        });

        return cls ? deepClone(cls) : null;
    }

    function createGraduatingClass(name) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var target = String(name).trim();

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            data.graduatingClasses = [];
        }

        // Check duplicate
        var existing = data.graduatingClasses.find(function(c) {
            return c && c.name && c.name.trim().toLowerCase() === target.toLowerCase();
        });

        if (existing) {
            return failure('A graduating class with this name already exists.');
        }

        var newClass = {
            id: generateId('gradclass'),
            name: target,
            createdAt: new Date().toISOString()
        };

        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate.push(newClass);
        data.graduatingClasses = candidate;

        logActivity('Created graduating class: ' + newClass.name);
        return success({ graduatingClass: newClass });
    }

    function updateGraduatingClass(id, name) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var newName = String(name).trim();

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return failure('No classes found.');
        }

        var index = data.graduatingClasses.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return failure('Class not found.');
        }

        var existing = data.graduatingClasses.find(function(c) {
            return c && String(c.id) !== String(id) &&
                   c.name && c.name.trim().toLowerCase() === newName.toLowerCase();
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[index].name = newName;
        data.graduatingClasses = candidate;

        logActivity('Updated graduating class: ' + newName);
        return success({ graduatingClass: candidate[index] });
    }

    function deleteGraduatingClass(id) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return failure('No classes found.');
        }

        var index = data.graduatingClasses.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return failure('Class not found.');
        }

        var cls = data.graduatingClasses[index];
        var name = cls.name;

        // Build candidates for all affected data
        var candidateClasses = deepClone(data.graduatingClasses);
        if (candidateClasses === null) {
            return failure('Failed to prepare class data.');
        }

        var candidateCharacters = deepClone(data.characters);
        if (candidateCharacters === null) {
            return failure('Failed to prepare character data.');
        }

        // Remove class reference from all characters
        var affected = 0;
        for (var i = 0; i < candidateCharacters.length; i++) {
            var char = candidateCharacters[i];
            if (char && String(char.graduatingClassId) === String(id)) {
                char.graduatingClassId = null;
                char.graduatingClassInstructor = false;
                affected++;
            }
        }

        // Remove class from array
        candidateClasses.splice(index, 1);

        // Commit
        data.graduatingClasses = candidateClasses;
        data.characters = candidateCharacters;

        logActivity('Deleted graduating class: ' + name + ' (' + affected + ' characters affected)');
        return success({ deleted: true, affectedCharacters: affected });
    }

    // ============================================================
    // CHARACTER ASSIGNMENT
    // ============================================================

    function assignCharacterToGraduatingClass(charId, classId, isInstructor) {
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }

        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var char = getCharacterById(charId);
        if (!char) {
            return failure('Character not found.');
        }

        var cls = getGraduatingClass(classId);
        if (!cls) {
            return failure('Graduating class not found.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var charIndex = -1;
        for (var i = 0; i < candidate.length; i++) {
            if (candidate[i] && String(candidate[i].id) === String(charId)) {
                charIndex = i;
                break;
            }
        }

        if (charIndex === -1) {
            return failure('Character not found in data store.');
        }

        var targetChar = candidate[charIndex];
        targetChar.graduatingClassId = classId;
        targetChar.graduatingClassInstructor = isInstructor === true;

        data.characters = candidate;

        var roleText = isInstructor ? 'instructor' : 'trainee';
        logActivity('Assigned ' + getDisplayName(char) + ' to graduating class "' + cls.name + '" as ' + roleText);
        return success({ character: targetChar });
    }

    function removeCharacterFromGraduatingClass(charId) {
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }

        var char = getCharacterById(charId);
        if (!char) {
            return failure('Character not found.');
        }

        if (!char.graduatingClassId) {
            return failure('Character is not assigned to any graduating class.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var charIndex = -1;
        for (var i = 0; i < candidate.length; i++) {
            if (candidate[i] && String(candidate[i].id) === String(charId)) {
                charIndex = i;
                break;
            }
        }

        if (charIndex === -1) {
            return failure('Character not found in data store.');
        }

        var targetChar = candidate[charIndex];
        targetChar.graduatingClassId = null;
        targetChar.graduatingClassInstructor = false;

        data.characters = candidate;

        logActivity('Removed ' + getDisplayName(char) + ' from graduating class');
        return success({ character: targetChar });
    }

    function getGraduatingClassMembers(classId, includeInstructors) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.characters.length; i++) {
            var char = data.characters[i];
            if (char && String(char.graduatingClassId) === String(classId)) {
                if (includeInstructors !== undefined) {
                    if (char.graduatingClassInstructor !== includeInstructors) {
                        continue;
                    }
                }
                var cloned = deepClone(char);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }

        return result;
    }

    function getCharactersByGraduatingClass(classId) {
        return getGraduatingClassMembers(classId, false);
    }

    function getInstructorsByGraduatingClass(classId) {
        return getGraduatingClassMembers(classId, true);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // CRUD
    window.getGraduatingClass = getGraduatingClass;
    window.getGraduatingClasses = getGraduatingClasses;
    window.getGraduatingClassByName = getGraduatingClassByName;
    window.createGraduatingClass = createGraduatingClass;
    window.updateGraduatingClass = updateGraduatingClass;
    window.deleteGraduatingClass = deleteGraduatingClass;

    // Character assignment
    window.assignCharacterToGraduatingClass = assignCharacterToGraduatingClass;
    window.removeCharacterFromGraduatingClass = removeCharacterFromGraduatingClass;

    // Queries
    window.getGraduatingClassMembers = getGraduatingClassMembers;
    window.getCharactersByGraduatingClass = getCharactersByGraduatingClass;
    window.getInstructorsByGraduatingClass = getInstructorsByGraduatingClass;


})();
