/**
 * modules/classes/classes-core.js - Classes Core Operations
 * Single source of truth for all graduating class data mutations
 * Path: js/modules/classes/classes-core.js
 * 
 * This module handles:
 *   - Graduating class CRUD (create, read, update, delete)
 *   - Character assignment to classes (trainee/instructor)
 *   - Character removal from classes
 *   - Query functions for class members
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 * 
 * MUTATION INVARIANT (CANDIDATE-BASED COMMIT):
 *   - All mutations build candidates BEFORE touching any live state
 *   - 1. Validate inputs
 *   - 2. Validate live state structure exists (read-only)
 *   - 3. Build candidate (deep clone)
 *   - 4. Apply validated changes to candidate
 *   - 5. Pre-clone result data (safe)
 *   - 6. COMMIT candidate to data store
 *   - 7. If any step before commit fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before all validation completes
 *   - This is a candidate-based commit, not a database transaction
 * 
 * DEPENDENCIES:
 *   - window.data (global state)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.MutationUtils (from mutation-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesCoreLoaded) {
        return;
    }
    window.__classesCoreLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = ['getCharacterById', 'getDisplayName'];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (!window.CoreUtils || typeof window.CoreUtils.deepClone !== 'function') {
            missing.push('CoreUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('ClassesCore: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
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
                console.error('ClassesCore: activity logging failed:', e);
            }
        }
    }

    function generateId(prefix) {
        if (window.CoreUtils && typeof window.CoreUtils.generateId === 'function') {
            return window.CoreUtils.generateId(prefix || 'gradclass');
        }
        prefix = prefix || 'gradclass';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function deepClone(value) {
        if (window.CoreUtils && typeof window.CoreUtils.deepClone === 'function') {
            return window.CoreUtils.deepClone(value);
        }

        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('ClassesCore: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('ClassesCore: JSON clone failed:', e);
            return null;
        }
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

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithClass(cls) {
        var cloned = deepClone(cls);
        if (cloned === null) {
            return failure('Failed to clone class data.');
        }
        return { success: true, class: cloned };
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
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: BUILD CLASS ----
        var newClass = {
            id: generateId('gradclass'),
            name: target,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate.push(newClass);

        // ---- PHASE 4: COMMIT ----
        data.graduatingClasses = candidate;

        logActivity('Created graduating class: ' + newClass.name);
        return successWithClass(newClass);
    }

    function updateGraduatingClass(id, name) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[index].name = newName;

        // ---- PHASE 3: COMMIT ----
        data.graduatingClasses = candidate;

        logActivity('Updated graduating class: ' + newName);
        return successWithClass(candidate[index]);
    }

    function deleteGraduatingClass(id) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: BUILD CANDIDATES ----
        var candidateClasses = deepClone(data.graduatingClasses);
        if (candidateClasses === null) {
            return failure('Failed to prepare class data.');
        }

        var candidateCharacters = deepClone(data.characters);
        if (candidateCharacters === null) {
            return failure('Failed to prepare character data.');
        }

        // ---- PHASE 3: CLEAN REFERENCES IN CANDIDATES ----
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

        // ---- PHASE 4: COMMIT ----
        data.graduatingClasses = candidateClasses;
        data.characters = candidateCharacters;

        logActivity('Deleted graduating class: ' + name + ' (' + affected + ' characters affected)');
        return success({ deleted: true, affectedCharacters: affected });
    }

    // ============================================================
    // CHARACTER ASSIGNMENT
    // ============================================================

    function assignCharacterToGraduatingClass(charId, classId, isInstructor) {
        // ---- PHASE 1: VALIDATE ----
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

        // Check if character is already assigned
        if (char.graduatingClassId && String(char.graduatingClassId) === String(classId)) {
            return failure('Character is already in this class.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
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

        // ---- PHASE 3: COMMIT ----
        data.characters = candidate;

        var roleText = isInstructor ? 'instructor' : 'trainee';
        logActivity('Assigned ' + getDisplayName(char) + ' to graduating class "' + cls.name + '" as ' + roleText);
        return success({ 
            character: targetChar,
            characterId: charId,
            classId: classId,
            className: cls.name,
            role: roleText
        });
    }

    function removeCharacterFromGraduatingClass(charId) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: BUILD CANDIDATE ----
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
        var className = getGraduatingClass(targetChar.graduatingClassId);
        targetChar.graduatingClassId = null;
        targetChar.graduatingClassInstructor = false;

        // ---- PHASE 3: COMMIT ----
        data.characters = candidate;

        logActivity('Removed ' + getDisplayName(char) + ' from graduating class');
        return success({ 
            character: targetChar,
            characterId: charId,
            className: className ? className.name : 'Unknown'
        });
    }

    // ============================================================
    // QUERY FUNCTIONS
    // ============================================================

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

    function getCharacterGraduatingClass(charId) {
        if (!isNonEmptyString(charId)) {
            return null;
        }

        var char = getCharacterById(charId);
        if (!char || !char.graduatingClassId) {
            return null;
        }

        return getGraduatingClass(char.graduatingClassId);
    }

    function isCharacterInGraduatingClass(charId, classId) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return false;
        }

        var char = getCharacterById(charId);
        if (!char) {
            return false;
        }

        return String(char.graduatingClassId) === String(classId);
    }

    function getClassMemberCount(classId) {
        return getGraduatingClassMembers(classId).length;
    }

    function getClassInstructorCount(classId) {
        return getGraduatingClassMembers(classId, true).length;
    }

    function getClassTotalCount(classId) {
        return getGraduatingClassMembers(classId).length + getGraduatingClassMembers(classId, true).length;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateClassName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var trimmed = String(name).trim();
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return success(null);
        }

        var existing = data.graduatingClasses.find(function(c) {
            return c &&
                String(c.id) !== String(excludeId) &&
                c.name &&
                c.name.trim().toLowerCase() === trimmed.toLowerCase();
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        return success(null);
    }

    function classExists(id) {
        return getGraduatingClass(id) !== null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesCore = {
        // CRUD
        getGraduatingClass: getGraduatingClass,
        getGraduatingClasses: getGraduatingClasses,
        getGraduatingClassByName: getGraduatingClassByName,
        createGraduatingClass: createGraduatingClass,
        updateGraduatingClass: updateGraduatingClass,
        deleteGraduatingClass: deleteGraduatingClass,

        // Character assignment
        assignCharacterToGraduatingClass: assignCharacterToGraduatingClass,
        removeCharacterFromGraduatingClass: removeCharacterFromGraduatingClass,

        // Queries
        getGraduatingClassMembers: getGraduatingClassMembers,
        getCharactersByGraduatingClass: getCharactersByGraduatingClass,
        getInstructorsByGraduatingClass: getInstructorsByGraduatingClass,
        getCharacterGraduatingClass: getCharacterGraduatingClass,
        isCharacterInGraduatingClass: isCharacterInGraduatingClass,

        // Counts
        getClassMemberCount: getClassMemberCount,
        getClassInstructorCount: getClassInstructorCount,
        getClassTotalCount: getClassTotalCount,

        // Validation
        validateClassName: validateClassName,
        classExists: classExists
    };

})();
