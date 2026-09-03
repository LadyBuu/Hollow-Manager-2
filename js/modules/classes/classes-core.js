/**
 * modules/classes/classes-core.js - Classes Core Operations
 * Single source of truth for all graduating class data mutations
 * Path: js/modules/classes/classes-core.js
 * 
 * This module handles:
 *   - Graduating class CRUD (create, read, update, delete)
 *   - Character assignment to classes (trainee/instructor)
 *   - Character removal from classes
 *   - Role management (trainee ↔ instructor)
 *   - Query functions for class members
 * 
 * IMPORTANT:
 *   - CLASS OWNS ITS MEMBERSHIP - members stored on the class, not on characters
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
 * DATA MODEL:
 *   graduatingClasses: [
 *       {
 *           id: "gradclass_xxx",
 *           name: "Class of 2028",
 *           graduationYear: 2028,
 *           members: [
 *               { characterId: "char_xxx", role: "trainee" },
 *               { characterId: "char_yyy", role: "instructor" }
 *           ],
 *           createdAt: "2024-01-01T00:00:00.000Z"
 *       }
 *   ]
 * 
 * ROLE SEMANTICS:
 *   - 'trainee': Student member of the graduating class
 *   - 'instructor': Teacher/professor member of the graduating class
 *   - A character can be in multiple classes (e.g., instructor across years)
 *   - Role changes are tracked historically (mutation creates new record)
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

    function isValidRole(role) {
        return role === 'trainee' || role === 'instructor';
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

    function createGraduatingClass(name, graduationYear) {
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

        // Validate year
        var year = null;
        if (graduationYear !== undefined && graduationYear !== null && graduationYear !== '') {
            year = parseInt(graduationYear, 10);
            if (isNaN(year) || year < 1900 || year > 2100) {
                return failure('Invalid graduation year. Must be between 1900 and 2100.');
            }
        }

        // ---- PHASE 2: BUILD CLASS ----
        var newClass = {
            id: generateId('gradclass'),
            name: target,
            graduationYear: year,
            members: [],
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

    function updateGraduatingClass(id, name, graduationYear) {
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

        // Validate year if provided
        var year = null;
        if (graduationYear !== undefined) {
            if (graduationYear !== null && graduationYear !== '') {
                year = parseInt(graduationYear, 10);
                if (isNaN(year) || year < 1900 || year > 2100) {
                    return failure('Invalid graduation year. Must be between 1900 and 2100.');
                }
            }
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[index].name = newName;
        if (graduationYear !== undefined) {
            candidate[index].graduationYear = year;
        }

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
        var memberCount = Array.isArray(cls.members) ? cls.members.length : 0;

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate.splice(index, 1);

        // ---- PHASE 3: COMMIT ----
        data.graduatingClasses = candidate;

        logActivity('Deleted graduating class: ' + name + ' (' + memberCount + ' members affected)');
        return success({ deleted: true, memberCount: memberCount });
    }

    // ============================================================
    // MEMBERSHIP QUERIES
    // ============================================================

    function getMembers(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = getGraduatingClass(classId);
        if (!cls) {
            return [];
        }

        return Array.isArray(cls.members) ? cls.members.slice() : [];
    }

    function getMembersWithCharacters(classId) {
        var members = getMembers(classId);
        var result = [];

        members.forEach(function(member) {
            var char = getCharacterById(member.characterId);
            result.push({
                characterId: member.characterId,
                role: member.role,
                character: char ? deepClone(char) : null
            });
        });

        return result;
    }

    function getTrainees(classId) {
        var members = getMembers(classId);
        return members.filter(function(m) { return m.role === 'trainee'; });
    }

    function getTraineesWithCharacters(classId) {
        var members = getTrainees(classId);
        var result = [];

        members.forEach(function(member) {
            var char = getCharacterById(member.characterId);
            result.push({
                characterId: member.characterId,
                role: 'trainee',
                character: char ? deepClone(char) : null
            });
        });

        return result;
    }

    function getInstructors(classId) {
        var members = getMembers(classId);
        return members.filter(function(m) { return m.role === 'instructor'; });
    }

    function getInstructorsWithCharacters(classId) {
        var members = getInstructors(classId);
        var result = [];

        members.forEach(function(member) {
            var char = getCharacterById(member.characterId);
            result.push({
                characterId: member.characterId,
                role: 'instructor',
                character: char ? deepClone(char) : null
            });
        });

        return result;
    }

    function getMemberCount(classId) {
        return getMembers(classId).length;
    }

    function getTraineeCount(classId) {
        return getTrainees(classId).length;
    }

    function getInstructorCount(classId) {
        return getInstructors(classId).length;
    }

    function getTotalCount(classId) {
        return getTraineeCount(classId) + getInstructorCount(classId);
    }

    function isMember(classId, characterId) {
        var members = getMembers(classId);
        return members.some(function(m) {
            return String(m.characterId) === String(characterId);
        });
    }

    function getMemberRole(classId, characterId) {
        var members = getMembers(classId);
        var member = members.find(function(m) {
            return String(m.characterId) === String(characterId);
        });
        return member ? member.role : null;
    }

    // ============================================================
    // MEMBERSHIP MUTATIONS (candidate-based)
    // ============================================================

    function addMember(classId, characterId, role) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }

        if (!isValidRole(role)) {
            return failure('Role must be "trainee" or "instructor".');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return failure('No classes found.');
        }

        var char = getCharacterById(characterId);
        if (!char) {
            return failure('Character not found.');
        }

        // Find class index (read-only)
        var classIndex = data.graduatingClasses.findIndex(function(c) {
            return c && String(c.id) === String(classId);
        });

        if (classIndex === -1) {
            return failure('Class not found.');
        }

        var cls = data.graduatingClasses[classIndex];

        // Check if already a member
        if (!Array.isArray(cls.members)) {
            cls.members = [];
        }

        if (cls.members.some(function(m) { return String(m.characterId) === String(characterId); })) {
            return failure('Character is already a member of this class.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[classIndex].members.push({
            characterId: characterId,
            role: role
        });

        // ---- PHASE 3: COMMIT ----
        data.graduatingClasses = candidate;

        var charName = getDisplayName(char);
        logActivity('Added ' + charName + ' to class "' + cls.name + '" as ' + role);
        return success({
            characterId: characterId,
            role: role,
            className: cls.name
        });
    }

    function removeMember(classId, characterId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return failure('No classes found.');
        }

        var char = getCharacterById(characterId);
        var charName = char ? getDisplayName(char) : 'Unknown';

        var classIndex = data.graduatingClasses.findIndex(function(c) {
            return c && String(c.id) === String(classId);
        });

        if (classIndex === -1) {
            return failure('Class not found.');
        }

        var cls = data.graduatingClasses[classIndex];

        if (!Array.isArray(cls.members)) {
            return failure('No members found.');
        }

        var memberIndex = cls.members.findIndex(function(m) {
            return String(m.characterId) === String(characterId);
        });

        if (memberIndex === -1) {
            return failure('Character is not a member of this class.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[classIndex].members.splice(memberIndex, 1);

        // ---- PHASE 3: COMMIT ----
        data.graduatingClasses = candidate;

        logActivity('Removed ' + charName + ' from class "' + cls.name + '"');
        return success({
            characterId: characterId,
            className: cls.name
        });
    }

    function setMemberRole(classId, characterId, role) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }

        if (!isValidRole(role)) {
            return failure('Role must be "trainee" or "instructor".');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return failure('No classes found.');
        }

        var char = getCharacterById(characterId);
        var charName = char ? getDisplayName(char) : 'Unknown';

        var classIndex = data.graduatingClasses.findIndex(function(c) {
            return c && String(c.id) === String(classId);
        });

        if (classIndex === -1) {
            return failure('Class not found.');
        }

        var cls = data.graduatingClasses[classIndex];

        if (!Array.isArray(cls.members)) {
            return failure('No members found.');
        }

        var memberIndex = cls.members.findIndex(function(m) {
            return String(m.characterId) === String(characterId);
        });

        if (memberIndex === -1) {
            return failure('Character is not a member of this class.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(data.graduatingClasses);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate[classIndex].members[memberIndex].role = role;

        // ---- PHASE 3: COMMIT ----
        data.graduatingClasses = candidate;

        logActivity('Updated ' + charName + '\'s role in "' + cls.name + '" to ' + role);
        return success({
            characterId: characterId,
            role: role,
            className: cls.name
        });
    }

    // ============================================================
    // CHARACTER QUERIES
    // ============================================================

    function getClassesForCharacter(characterId) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var data = getDataStore();
        if (!data) {
            return [];
        }

        if (!Array.isArray(data.graduatingClasses)) {
            return [];
        }

        var result = [];
        data.graduatingClasses.forEach(function(cls) {
            if (!Array.isArray(cls.members)) {
                return;
            }
            var member = cls.members.find(function(m) {
                return String(m.characterId) === String(characterId);
            });
            if (member) {
                result.push({
                    classId: cls.id,
                    className: cls.name,
                    graduationYear: cls.graduationYear,
                    role: member.role
                });
            }
        });

        return result;
    }

    function getAvailableCharactersForClass(classId, filters) {
        filters = filters || {};

        var data = getDataStore();
        if (!data) {
            return [];
        }

        if (!Array.isArray(data.characters)) {
            return [];
        }

        var members = getMembers(classId);
        var memberIds = {};
        members.forEach(function(m) {
            memberIds[m.characterId] = true;
        });

        var available = data.characters.filter(function(char) {
            // Already in this class
            if (memberIds[char.id]) {
                return false;
            }

            // Deceased
            if (char.deceased) {
                return false;
            }

            // Birth year filter
            if (filters.minBirthYear !== null && filters.minBirthYear !== undefined) {
                var birthYear = parseInt(char.birthYear, 10);
                if (isNaN(birthYear) || birthYear < filters.minBirthYear) {
                    return false;
                }
            }

            if (filters.maxBirthYear !== null && filters.maxBirthYear !== undefined) {
                var birthYear = parseInt(char.birthYear, 10);
                if (isNaN(birthYear) || birthYear > filters.maxBirthYear) {
                    return false;
                }
            }

            // Name filter
            if (filters.name) {
                var name = getDisplayName(char).toLowerCase();
                if (name.indexOf(filters.name.toLowerCase()) === -1) {
                    return false;
                }
            }

            return true;
        });

        return available;
    }

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy: Returns just the character objects for trainees.
     * @deprecated Use getTraineesWithCharacters() instead.
     */
    function getCharactersByGraduatingClass(classId) {
        var members = getTraineesWithCharacters(classId);
        return members.map(function(m) { return m.character; }).filter(function(c) { return c; });
    }

    /**
     * Legacy: Returns just the character objects for instructors.
     * @deprecated Use getInstructorsWithCharacters() instead.
     */
    function getInstructorsByGraduatingClass(classId) {
        var members = getInstructorsWithCharacters(classId);
        return members.map(function(m) { return m.character; }).filter(function(c) { return c; });
    }

    /**
     * Legacy: Returns characters only (not full member objects).
     * @deprecated Use getMembersWithCharacters() or specific role queries.
     */
    function getGraduatingClassMembers(classId, includeInstructors) {
        if (includeInstructors) {
            var instructors = getInstructorsWithCharacters(classId);
            return instructors.map(function(m) { return m.character; }).filter(function(c) { return c; });
        } else {
            var trainees = getTraineesWithCharacters(classId);
            return trainees.map(function(m) { return m.character; }).filter(function(c) { return c; });
        }
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
    // EXPOSE - Main API
    // ============================================================

    window.ClassesCore = {
        // CRUD
        getGraduatingClass: getGraduatingClass,
        getGraduatingClasses: getGraduatingClasses,
        getGraduatingClassByName: getGraduatingClassByName,
        createGraduatingClass: createGraduatingClass,
        updateGraduatingClass: updateGraduatingClass,
        deleteGraduatingClass: deleteGraduatingClass,

        // Membership - Queries
        getMembers: getMembers,
        getMembersWithCharacters: getMembersWithCharacters,
        getTrainees: getTrainees,
        getTraineesWithCharacters: getTraineesWithCharacters,
        getInstructors: getInstructors,
        getInstructorsWithCharacters: getInstructorsWithCharacters,
        getMemberCount: getMemberCount,
        getTraineeCount: getTraineeCount,
        getInstructorCount: getInstructorCount,
        getTotalCount: getTotalCount,
        isMember: isMember,
        getMemberRole: getMemberRole,

        // Membership - Mutations
        addMember: addMember,
        removeMember: removeMember,
        setMemberRole: setMemberRole,

        // Character queries
        getClassesForCharacter: getClassesForCharacter,
        getAvailableCharactersForClass: getAvailableCharactersForClass,

        // Validation
        validateClassName: validateClassName,
        classExists: classExists,

        // Legacy compatibility (deprecated)
        getCharactersByGraduatingClass: getCharactersByGraduatingClass,
        getInstructorsByGraduatingClass: getInstructorsByGraduatingClass,
        getGraduatingClassMembers: getGraduatingClassMembers
    };

    // ============================================================
    // LEGACY GLOBAL ALIASES - For backward compatibility
    // ============================================================

    window.getGraduatingClass = getGraduatingClass;
    window.getGraduatingClasses = getGraduatingClasses;
    window.getGraduatingClassByName = getGraduatingClassByName;
    window.createGraduatingClass = createGraduatingClass;
    window.updateGraduatingClass = updateGraduatingClass;
    window.deleteGraduatingClass = deleteGraduatingClass;

    // Legacy assignment functions (will be removed later)
    window.assignCharacterToGraduatingClass = function(charId, classId, isInstructor) {
        var role = isInstructor ? 'instructor' : 'trainee';
        return addMember(classId, charId, role);
    };

    window.removeCharacterFromGraduatingClass = function(charId) {
        // Find which class this character is in and remove them
        var data = getDataStore();
        if (!data) return failure('Data store not available.');
        if (!Array.isArray(data.graduatingClasses)) return failure('No classes found.');

        var foundClassId = null;
        var foundIndex = -1;

        for (var i = 0; i < data.graduatingClasses.length; i++) {
            var cls = data.graduatingClasses[i];
            if (!Array.isArray(cls.members)) continue;
            var memberIndex = cls.members.findIndex(function(m) {
                return String(m.characterId) === String(charId);
            });
            if (memberIndex !== -1) {
                foundClassId = cls.id;
                foundIndex = i;
                break;
            }
        }

        if (!foundClassId) {
            return failure('Character is not in any graduating class.');
        }

        return removeMember(foundClassId, charId);
    };

})();
