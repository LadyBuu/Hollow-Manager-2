/**
 * js/core/curriculum/curriculum-classes.js - Class CRUD Operations
 * Path: js/core/curriculum/curriculum-classes.js
 * 
 * This module provides class CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string }
 *   - Mutation functions return operation-specific result fields on success
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - All query results are DEEP CLONED to prevent external mutation
 *   - Class names are unique (case-insensitive, trimmed)
 *   - deleteClass() removes character references and unassigns academic teams
 *   - Malformed relationship fields are skipped (not repaired)
 *   - Shared validators are consumed from CurriculumValidators
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumClassesLoaded) {
        return;
    }
    window.__curriculumClassesLoaded = true;

    // ============================================================
    // VALIDATOR DEPENDENCIES
    // ============================================================

    var Validators = window.CurriculumValidators;

    if (!Validators) {
        console.error('[CurriculumClasses] CurriculumValidators not available.');
        return;
    }

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function generateId(prefix) {
        prefix = prefix || 'class';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
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

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumClasses: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumClasses: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function successWithClass(cls) {
        var cloned = deepClone(cls);
        if (cloned === null) {
            return failure('Failed to clone class data.');
        }
        return { success: true, class: cloned };
    }

    // ============================================================
    // CLASS QUERIES
    // ============================================================

    function getClass(id) {
        if (id === undefined || id === null || id === '') {
            return null;
        }

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
        if (!Validators.isNonEmptyString(name)) {
            return null;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return null;
        }

        var target = name.trim().toLowerCase();
        var cls = data.classes.find(function(c) {
            return c && c.name && c.name.trim().toLowerCase() === target;
        });

        return cls ? deepClone(cls) : null;
    }

    function getClassDisplayName(id) {
        var cls = getClass(id);
        return cls ? cls.name : 'Unassigned';
    }

    function getClassOptions() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return [];
        }

        var options = [];
        for (var i = 0; i < data.classes.length; i++) {
            var cls = data.classes[i];
            if (!cls || typeof cls !== 'object') {
                continue;
            }
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

    function getCharactersByClass(classId) {
        if (!Validators.isNonEmptyString(classId)) {
            return [];
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }

        var target = String(classId);
        var result = [];

        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (c && typeof c === 'object' && Array.isArray(c.classIds) &&
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
        if (!Validators.isNonEmptyString(classId)) {
            return [];
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return [];
        }

        var target = String(classId);
        var result = [];

        for (var i = 0; i < data.teams.length; i++) {
            var t = data.teams[i];
            if (t && typeof t === 'object' && t.type === 'academic' &&
                String(t.classId) === target && t.status !== 'deleted') {
                var cloned = deepClone(t);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }

        return result;
    }

    function getTeamCountByClass(classId) {
        if (!Validators.isNonEmptyString(classId)) {
            return 0;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return 0;
        }

        var target = String(classId);
        var count = 0;

        for (var i = 0; i < data.teams.length; i++) {
            var t = data.teams[i];
            if (t && typeof t === 'object' && t.type === 'academic' &&
                String(t.classId) === target && t.status !== 'deleted') {
                count++;
            }
        }

        return count;
    }

    function getCharacterCountByClass(classId) {
        if (!Validators.isNonEmptyString(classId)) {
            return 0;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return 0;
        }

        var target = String(classId);
        var count = 0;

        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (c && typeof c === 'object' && Array.isArray(c.classIds) &&
                c.classIds.some(function(cid) { return String(cid) === target; })) {
                count++;
            }
        }

        return count;
    }

    function getCharacterClasses(char) {
        if (!char || typeof char !== 'object' || !Array.isArray(char.classIds)) {
            return [];
        }

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

    function classExists(id) {
        if (id === undefined || id === null || id === '') {
            return false;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return false;
        }

        var target = String(id);

        for (var i = 0; i < data.classes.length; i++) {
            var cls = data.classes[i];
            if (cls && String(cls.id) === target) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // CLASS CRUD MUTATIONS
    // ============================================================

    function createClass(name) {
        if (!Validators.isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var target = String(name).trim();
        var data = getDataStore();

        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Classes data is corrupted.');
        }

        var existing = data.classes.find(function(c) {
            return c && c.name && c.name.trim().toLowerCase() === target.toLowerCase();
        });

        if (existing) {
            return failure('A class with this name already exists.');
        }

        var newClass = {
            id: generateId('class'),
            name: target,
            createdAt: new Date().toISOString()
        };

        var candidate = deepClone(data.classes);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        candidate.push(newClass);
        data.classes = candidate;

        logActivity('Created class: ' + newClass.name);
        return successWithClass(newClass);
    }

    function updateClass(id, updates) {
        if (!Validators.isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        if (!updates || typeof updates !== 'object') {
            return failure('Updates must be an object.');
        }

        // Reject unknown fields
        var allowedFields = { name: true };

        for (var key in updates) {
            if (!Object.prototype.hasOwnProperty.call(updates, key)) {
                continue;
            }
            if (!allowedFields[key]) {
                return failure('Unsupported class field: ' + key);
            }
        }

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
        var candidate = deepClone(cls);

        if (candidate === null) {
            return failure('Failed to clone class data.');
        }

        var hasChanges = false;

        if (updates.name !== undefined) {
            if (!Validators.isNonEmptyString(updates.name)) {
                return failure('Class name cannot be empty.');
            }

            var newName = String(updates.name).trim();
            var existing = data.classes.find(function(c) {
                return c && String(c.id) !== String(id) &&
                    c.name && c.name.trim().toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return failure('A class with this name already exists.');
            }

            candidate.name = newName;
            hasChanges = true;
        }

        if (!hasChanges) {
            return successWithClass(cls);
        }

        var candidateArray = deepClone(data.classes);
        if (candidateArray === null) {
            return failure('Failed to prepare class data.');
        }

        candidateArray[index] = candidate;
        data.classes = candidateArray;

        logActivity('Updated class: ' + candidate.name);
        return successWithClass(candidate);
    }

    function deleteClass(id) {
        if (!Validators.isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

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

        // All candidates are prepared BEFORE any mutation
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

        // Clean references in characters
        for (var i = 0; i < candidateCharacters.length; i++) {
            var char = candidateCharacters[i];
            if (!char || typeof char !== 'object' || !Array.isArray(char.classIds)) {
                continue;
            }

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

        // Clean references in academic teams
        for (var i = 0; i < candidateTeams.length; i++) {
            var team = candidateTeams[i];
            if (!team || typeof team !== 'object' || team.type !== 'academic') {
                continue;
            }
            if (String(team.classId) === String(id)) {
                affectedTeams.push({
                    id: team.id,
                    name: team.name || 'Unknown'
                });
                team.classId = null;
            }
        }

        // Remove the class from the candidate array
        candidateClasses.splice(index, 1);

        // Commit all candidates atomically (in practice, sequential assignment)
        data.classes = candidateClasses;
        data.characters = candidateCharacters;
        data.teams = candidateTeams;

        logActivity('Deleted class: ' + name + ' (' + affectedCharacters.length + ' characters, ' + affectedTeams.length + ' teams)');
        return {
            success: true,
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams
        };
    }

    // ============================================================
    // CHARACTER-CLASS ASSIGNMENTS
    // ============================================================

    function addCharacterToClass(charId, classId) {
        if (!Validators.isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }

        if (!Validators.isNonEmptyString(classId)) {
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

        if (existingClassIds.some(function(cid) { return String(cid) === String(classId); })) {
            return failure('Character is already in this class.');
        }

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

        candidateChar.classIds.push(classId);
        data.characters = candidateChars;

        var charName = getDisplayName(char);
        logActivity('Added ' + charName + ' to class: ' + cls.name);

        return {
            success: true,
            characterId: charId,
            classId: classId,
            className: cls.name
        };
    }

    function removeCharacterFromClass(charId, classId) {
        if (!Validators.isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }

        if (!Validators.isNonEmptyString(classId)) {
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

        data.characters = candidateChars;

        var charName = getDisplayName(char);
        logActivity('Removed ' + charName + ' from class: ' + cls.name);

        return {
            success: true,
            characterId: charId,
            classId: classId,
            className: cls.name
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getClass = getClass;
    window.getClasses = getClasses;
    window.getClassByName = getClassByName;
    window.getClassDisplayName = getClassDisplayName;
    window.getClassOptions = getClassOptions;
    window.getCharactersByClass = getCharactersByClass;
    window.getTeamsByClass = getTeamsByClass;
    window.getTeamCountByClass = getTeamCountByClass;
    window.getCharacterCountByClass = getCharacterCountByClass;
    window.getCharacterClasses = getCharacterClasses;
    window.getCharacterClassNames = getCharacterClassNames;
    window.classExists = classExists;

    // Mutations
    window.createClass = createClass;
    window.updateClass = updateClass;
    window.deleteClass = deleteClass;
    window.addCharacterToClass = addCharacterToClass;
    window.removeCharacterFromClass = removeCharacterFromClass;

})();
