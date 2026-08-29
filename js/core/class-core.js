/**
 * core/class-core.js - Class Core Operations
 * Single source of truth for all academic class-related data mutations
 * Path: js/core/class-core.js
 * 
 * This module handles:
 *   - Class CRUD (create, read, update, delete)
 *   - Character-class assignments
 *   - Class name uniqueness validation
 *   - Cascade deletion with reference cleanup (CANDIDATE-BASED COMMIT)
 * 
 * IMPORTANT:
 *   - All MUTATION operations return an object with { success: boolean }.
 *   - Failure results include { message: string }.
 *   - Successful operations may include operation-specific result fields:
 *     - createClass/updateClass: { class: object }
 *     - deleteClass: { affectedCharacters: array, affectedTeams: array }
 *     - addCharacterToClass/removeCharacterFromClass: { characterId, classId, className }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 * 
 * MUTATION INVARIANT (CANDIDATE-BASED ALL-OR-NOTHING COMMIT):
 *   - All mutations build ALL candidates BEFORE touching any live state
 *   - 1. Validate inputs
 *   - 2. Validate live state structure exists
 *   - 3. Build all candidate arrays (deep clone)
 *   - 4. Apply validated changes to ALL candidates
 *   - 5. COMMIT ALL candidates to data store
 *   - 6. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before all validation completes
 *   - Cross-store operations (class deletion with references) are all-or-nothing
 *   - All candidates are prepared before commit; no expected failures during commit
 *   - This is a candidate-based commit, not a database transaction
 * 
 * CLASS SEMANTICS:
 *   - A class is a named academic group (e.g., "Spring 1424", "March 1436")
 *   - Class names are free text and must be unique (case-insensitive, trimmed)
 *   - Characters can belong to multiple classes
 *   - Classes can have multiple characters and academic teams
 *   - Deleting a class cascades to characters and teams (removes references)
 *   - Cascade deletion is MANDATORY for referential integrity
 *   - Deletion returns lists of affected entities for caller reporting
 *   - Malformed collection entries are skipped (best-effort cleanup)
 *   - All required collections must be structurally valid arrays
 *   - validateClassName() requires the class store to exist and be an array
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classCoreLoaded) {
        return;
    }
    window.__classCoreLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    /**
     * Internal activity logging with defensive error handling.
     * Prevents logging failures from destabilising the mutation contract.
     */
    function logActivity(message, type) {
        type = type || 'info';

        if (typeof window.logActivity !== 'function') {
            return;
        }

        try {
            window.logActivity(message, type);
        } catch (e) {
            console.error('ClassCore: activity logging failed:', e);
        }
    }

    function generateId(prefix) {
        prefix = prefix || 'class';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
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
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function normaliseClassName(name) {
        return isNonEmptyString(name) ? name.trim().toLowerCase() : '';
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('ClassCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('ClassCore: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    function successWithClass(cls) {
        var cloned = deepClone(cls);
        if (cloned === null) {
            return failure('Failed to clone class data.');
        }
        return {
            success: true,
            class: cloned
        };
    }

    function successWithAffected(affected) {
        return {
            success: true,
            affectedCharacters: affected.characters || [],
            affectedTeams: affected.teams || []
        };
    }

    // ============================================================
    // CLASS CRUD
    // ============================================================

    function getClass(id) {
        if (!isNonEmptyString(id)) return null;

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return null;
        }

        var cls = data.classes.find(function(c) {
            return c && String(c.id) === String(id);
        });

        return cls ? deepClone(cls) : null;
    }

    function getClasses() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.classes.length; i++) {
            var cloned = deepClone(data.classes[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getClassByName(name) {
        if (!isNonEmptyString(name)) return null;

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return null;
        }

        var target = normaliseClassName(name);
        var cls = data.classes.find(function(c) {
            return c && normaliseClassName(c.name) === target;
        });

        return cls ? deepClone(cls) : null;
    }

    function getClassDisplayName(id) {
        var cls = getClass(id);
        return cls ? cls.name : 'Unassigned';
    }

    function getClassOptions() {
        var classes = getClasses();
        var options = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') continue;
            options.push({
                id: cls.id,
                name: cls.name,
                createdAt: cls.createdAt || ''
            });
        }
        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });
        return options;
    }

    function createClass(name) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var target = String(name).trim();

        // ---- PHASE 2: CHECK DUPLICATES ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Classes data is corrupted.');
        }

        var existing = data.classes.find(function(c) {
            return c && normaliseClassName(c.name) === normaliseClassName(target);
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        // ---- PHASE 3: BUILD CLASS ----
        var newClass = {
            id: generateId('class'),
            name: target,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(data.classes);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate.push(newClass);

        // ---- PHASE 5: COMMIT ----
        data.classes = candidate;

        logActivity('Created class: ' + newClass.name);
        return successWithClass(newClass);
    }

    function updateClass(id, updates) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        if (!isObject(updates)) {
            return failure('Updates must be an object.');
        }

        // ---- PHASE 2: RETRIEVE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Classes data is corrupted.');
        }

        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return failure('Class not found.');
        }

        var cls = data.classes[index];

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(cls);
        if (candidate === null) {
            return failure('Failed to clone class data.');
        }

        var hasChanges = false;

        if (updates.name !== undefined) {
            // Strict validation: name must be a non-empty string
            if (!isNonEmptyString(updates.name)) {
                return failure('Class name cannot be empty.');
            }

            var newName = String(updates.name).trim();

            var existing = data.classes.find(function(c) {
                return c && String(c.id) !== String(id) &&
                       normaliseClassName(c.name) === normaliseClassName(newName);
            });

            if (existing) {
                return failure('A class with this name already exists.');
            }

            candidate.name = newName;
            hasChanges = true;
        }

        // If no changes, return early
        if (!hasChanges) {
            return successWithClass(cls);
        }

        // ---- PHASE 4: BUILD FULL CANDIDATE ARRAY ----
        var candidateArray = deepClone(data.classes);
        if (candidateArray === null) {
            return failure('Failed to prepare class data.');
        }

        candidateArray[index] = candidate;

        // ---- PHASE 5: COMMIT ----
        data.classes = candidateArray;

        logActivity('Updated class: ' + candidate.name);
        return successWithClass(candidate);
    }

    function deleteClass(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Classes data is corrupted.');
        }

        if (!Array.isArray(data.characters)) {
            return failure('Character data is corrupted.');
        }

        if (!Array.isArray(data.teams)) {
            return failure('Team data is corrupted.');
        }

        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return failure('Class not found.');
        }

        var cls = data.classes[index];
        var name = cls.name;

        // ---- PHASE 3: BUILD ALL CANDIDATES (NO LIVE MUTATION) ----
        var candidateClasses = deepClone(data.classes);
        if (candidateClasses === null) {
            return failure('Failed to prepare class data.');
        }

        var candidateCharacters = deepClone(data.characters);
        if (candidateCharacters === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateTeams = deepClone(data.teams);
        if (candidateTeams === null) {
            return failure('Failed to prepare team data.');
        }

        var affectedCharacters = [];
        var affectedTeams = [];

        // ---- PHASE 4: CLEAN REFERENCES IN CANDIDATES ----
        // Characters (skip malformed entries)
        for (var i = 0; i < candidateCharacters.length; i++) {
            var char = candidateCharacters[i];
            if (!char || typeof char !== 'object') continue;
            if (!Array.isArray(char.classIds)) continue;

            if (char.classIds.some(function(cid) { return String(cid) === String(id); })) {
                affectedCharacters.push({
                    id: char.id,
                    name: getDisplayName(char)
                });
                char.classIds = char.classIds.filter(function(cid) {
                    return String(cid) !== String(id);
                });
            }
        }

        // Teams (skip malformed entries)
        for (var i = 0; i < candidateTeams.length; i++) {
            var team = candidateTeams[i];
            if (!team || typeof team !== 'object') continue;
            if (team.type !== 'academic') continue;
            if (String(team.classId) !== String(id)) continue;

            affectedTeams.push({
                id: team.id,
                name: team.name || 'Unknown'
            });
            team.classId = null;
        }

        // ---- PHASE 5: REMOVE CLASS FROM CANDIDATE ----
        candidateClasses.splice(index, 1);

        // ---- PHASE 6: COMMIT ALL CANDIDATES ----
        // All validation and candidate construction is complete.
        // No expected failure points remain during commit.
        data.classes = candidateClasses;
        data.characters = candidateCharacters;
        data.teams = candidateTeams;

        logActivity('Deleted class: ' + name + ' (' + affectedCharacters.length + ' characters, ' + affectedTeams.length + ' teams)');
        return successWithAffected({
            characters: affectedCharacters,
            teams: affectedTeams
        });
    }

    // ============================================================
    // CHARACTER-CLASS ASSIGNMENTS (candidate-based)
    // ============================================================

    function getCharactersByClass(classId) {
        if (!isNonEmptyString(classId)) return [];

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }

        var target = String(classId);
        var result = [];
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (c && typeof c === 'object' &&
                Array.isArray(c.classIds) &&
                c.classIds.some(function(cid) { return String(cid) === target; })) {
                var cloned = deepClone(c);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }
        return result;
    }

    function getTeamsByClass(classId) {
        if (!isNonEmptyString(classId)) return [];

        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return [];
        }

        var target = String(classId);
        var result = [];
        for (var i = 0; i < data.teams.length; i++) {
            var t = data.teams[i];
            if (t && typeof t === 'object' &&
                t.type === 'academic' &&
                String(t.classId) === target &&
                t.status !== 'deleted') {
                var cloned = deepClone(t);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }
        return result;
    }

    function getTeamCountByClass(classId) {
        return getTeamsByClass(classId).length;
    }

    function getCharacterCountByClass(classId) {
        return getCharactersByClass(classId).length;
    }

    function getCharacterClasses(char) {
        if (!char || typeof char !== 'object') return [];
        if (!Array.isArray(char.classIds)) return [];

        var classes = getClasses();
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (c && char.classIds.some(function(cid) { return String(cid) === String(c.id); })) {
                result.push(c);
            }
        }
        return result;
    }

    function getCharacterClassNames(char) {
        var classes = getCharacterClasses(char);
        return classes.map(function(c) { return c.name; });
    }

    function getClassSummary(classId) {
        var cls = getClass(classId);
        if (!cls) return null;

        var characters = getCharactersByClass(classId);
        var teams = getTeamsByClass(classId);

        var activeCount = 0;
        for (var i = 0; i < characters.length; i++) {
            if (!characters[i].deceased) {
                activeCount++;
            }
        }

        return {
            class: cls,
            teamCount: teams.length,
            characterCount: characters.length,
            activeCount: activeCount,
            teams: teams,
            characters: characters
        };
    }

    // ============================================================
    // CLASS PRESENCE HELPERS (candidate-based mutations)
    // ============================================================

    function isCharacterInClass(charId, classId) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) return false;

        var char = getCharacterById(charId);
        if (!char) return false;
        if (!Array.isArray(char.classIds)) return false;

        return char.classIds.some(function(cid) {
            return String(cid) === String(classId);
        });
    }

    function addCharacterToClass(charId, classId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.characters)) {
            return failure('Character data is corrupted.');
        }

        var cls = getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        // Find character (read-only)
        var charIndex = -1;
        var char = null;
        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && String(data.characters[i].id) === String(charId)) {
                charIndex = i;
                char = data.characters[i];
                break;
            }
        }

        if (!char) {
            return failure('Character not found.');
        }

        // Check class membership (read-only, no mutation)
        var existingClassIds = Array.isArray(char.classIds) ? char.classIds : [];
        if (existingClassIds.some(function(cid) { return String(cid) === String(classId); })) {
            return failure('Character is already in this class.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidateChars = deepClone(data.characters);
        if (candidateChars === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateChar = candidateChars[charIndex];
        if (!candidateChar) {
            return failure('Character data corrupted.');
        }

        // Initialise on candidate only
        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        candidateChar.classIds.push(classId);

        // ---- PHASE 3: COMMIT ----
        data.characters = candidateChars;

        var charName = getDisplayName(char);
        logActivity('Added ' + charName + ' to class: ' + cls.name);

        return success({
            characterId: charId,
            classId: classId,
            className: cls.name
        });
    }

    function removeCharacterFromClass(charId, classId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.characters)) {
            return failure('Character data is corrupted.');
        }

        var cls = getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        var charIndex = -1;
        var char = null;
        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && String(data.characters[i].id) === String(charId)) {
                charIndex = i;
                char = data.characters[i];
                break;
            }
        }

        if (!char) {
            return failure('Character not found.');
        }

        var existingClassIds = Array.isArray(char.classIds) ? char.classIds : [];
        if (!existingClassIds.some(function(cid) { return String(cid) === String(classId); })) {
            return failure('Character is not in this class.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidateChars = deepClone(data.characters);
        if (candidateChars === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateChar = candidateChars[charIndex];
        if (!candidateChar) {
            return failure('Character data corrupted.');
        }

        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        candidateChar.classIds = candidateChar.classIds.filter(function(cid) {
            return String(cid) !== String(classId);
        });

        // ---- PHASE 3: COMMIT ----
        data.characters = candidateChars;

        var charName = getDisplayName(char);
        logActivity('Removed ' + charName + ' from class: ' + cls.name);

        return success({
            characterId: charId,
            classId: classId,
            className: cls.name
        });
    }

    // ============================================================
    // CLASS VALIDATION HELPERS
    // ============================================================

    /**
     * Validate a class name for uniqueness.
     * Returns failure if the class store is missing or corrupted.
     */
    function validateClassName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var trimmed = String(name).trim();

        // Check for existing class with same name
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Classes data is corrupted.');
        }

        var existing = data.classes.find(function(c) {
            return c &&
                String(c.id) !== String(excludeId) &&
                normaliseClassName(c.name) === normaliseClassName(trimmed);
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        return success(null);
    }

    function classExists(id) {
        return getClass(id) !== null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassCore = {
        // CRUD
        getClass: getClass,
        getClasses: getClasses,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getClassOptions: getClassOptions,
        createClass: createClass,
        updateClass: updateClass,
        deleteClass: deleteClass,

        // Character-Class assignments
        getCharactersByClass: getCharactersByClass,
        getTeamsByClass: getTeamsByClass,
        getTeamCountByClass: getTeamCountByClass,
        getCharacterCountByClass: getCharacterCountByClass,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getClassSummary: getClassSummary,

        // Presence helpers (candidate-based mutations)
        isCharacterInClass: isCharacterInClass,
        addCharacterToClass: addCharacterToClass,
        removeCharacterFromClass: removeCharacterFromClass,

        // Validation
        validateClassName: validateClassName,
        classExists: classExists,

        // Constants
        SUCCESS: success,
        FAILURE: failure
    };

})();
