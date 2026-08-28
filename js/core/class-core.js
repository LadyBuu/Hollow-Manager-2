/**
 * core/class-core.js - Class Core Operations
 * Single source of truth for all academic class-related data mutations
 * Path: js/core/class-core.js
 * 
 * This module handles:
 *   - Class CRUD (create, read, update, delete)
 *   - Character-class assignments
 *   - Class name uniqueness validation
 *   - Cascade deletion with reference cleanup
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * CLASS SEMANTICS:
 *   - A class is a named academic group (e.g., "Spring 1424", "March 1436")
 *   - Class names are free text and must be unique
 *   - Characters can belong to multiple classes
 *   - Classes can have multiple characters and academic teams
 *   - Deleting a class cascades to characters and teams (removes references)
 */

(function() {
    'use strict';

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

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
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

    function getTeamById(id) {
        if (typeof window.getTeamById === 'function') {
            return window.getTeamById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        return data.teams.find(function(t) {
            return t && String(t.id) === String(id);
        }) || null;
    }

    function ensureClassStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }

        return data;
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

        return data.classes.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getClasses() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return [];
        }
        return data.classes.slice();
    }

    function getClassByName(name) {
        if (!isNonEmptyString(name)) return null;

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return null;
        }

        var target = String(name).toLowerCase();
        return data.classes.find(function(c) {
            return c && String(c.name || '').toLowerCase() === target;
        }) || null;
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
        // Sort by name
        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });
        return options;
    }

    function createClass(name) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(name)) {
            return { success: false, message: 'Class name is required.' };
        }

        var target = String(name).trim();

        // ---- PHASE 2: CHECK DUPLICATES ----
        var store = ensureClassStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var existing = store.classes.find(function(c) {
            return c && String(c.name || '').toLowerCase() === target.toLowerCase();
        });

        if (existing) {
            return { success: false, message: 'A class with this name already exists.' };
        }

        // ---- PHASE 3: BUILD CLASS ----
        var newClass = {
            id: generateId('class'),
            name: target,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: APPLY ----
        store.classes.push(newClass);

        logActivity('Created class: ' + newClass.name);
        return { success: true, class: newClass };
    }

    function updateClass(id, updates) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !Array.isArray(store.classes)) {
            return { success: false, message: 'No classes found.' };
        }

        var index = store.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }

        var cls = store.classes[index];

        // ---- PHASE 3: APPLY UPDATES ----
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return { success: false, message: 'Class name cannot be empty.' };
            }

            var existing = store.classes.find(function(c) {
                return c && String(c.id) !== String(id) &&
                       String(c.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return { success: false, message: 'A class with this name already exists.' };
            }

            cls.name = newName;
        }

        logActivity('Updated class: ' + cls.name);
        return { success: true, class: cls };
    }

    function deleteClass(id, options) {
        options = options || {};
        var removeReferences = options.removeReferences !== false;

        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !Array.isArray(store.classes)) {
            return { success: false, message: 'No classes found.' };
        }

        var index = store.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }

        var cls = store.classes[index];
        var name = cls.name;

        // ---- PHASE 3: GET AFFECTED ENTITIES (for reporting) ----
        var affectedCharacters = [];
        var affectedTeams = [];

        if (removeReferences) {
            // Find affected characters
            if (Array.isArray(store.characters)) {
                store.characters.forEach(function(char) {
                    if (!char || typeof char !== 'object') return;
                    if (!Array.isArray(char.classIds)) return;
                    if (char.classIds.some(function(cid) { return String(cid) === String(id); })) {
                        affectedCharacters.push({
                            id: char.id,
                            name: getDisplayName(char)
                        });
                    }
                });
            }

            // Find affected teams
            if (Array.isArray(store.teams)) {
                store.teams.forEach(function(team) {
                    if (!team || typeof team !== 'object') return;
                    if (team.type === 'academic' && String(team.classId) === String(id)) {
                        affectedTeams.push({
                            id: team.id,
                            name: team.name || 'Unknown'
                        });
                    }
                });
            }
        }

        // ---- PHASE 4: CLEAN UP REFERENCES ----
        if (removeReferences) {
            // Remove class ID from characters
            if (Array.isArray(store.characters)) {
                store.characters.forEach(function(char) {
                    if (char && Array.isArray(char.classIds)) {
                        char.classIds = char.classIds.filter(function(cid) {
                            return String(cid) !== String(id);
                        });
                    }
                });
            }

            // Remove class ID from academic teams
            if (Array.isArray(store.teams)) {
                store.teams.forEach(function(team) {
                    if (team && team.type === 'academic' && String(team.classId) === String(id)) {
                        team.classId = null;
                    }
                });
            }
        }

        // ---- PHASE 5: DELETE ----
        store.classes.splice(index, 1);

        logActivity('Deleted class: ' + name);

        return {
            success: true,
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams
        };
    }

    // ============================================================
    // CHARACTER-CLASS ASSIGNMENTS
    // ============================================================

    function getCharactersByClass(classId) {
        if (!isNonEmptyString(classId)) return [];

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }

        var target = String(classId);
        return data.characters.filter(function(c) {
            return c && typeof c === 'object' &&
                   Array.isArray(c.classIds) &&
                   c.classIds.some(function(cid) {
                       return String(cid) === target;
                   });
        });
    }

    function getTeamsByClass(classId) {
        if (!isNonEmptyString(classId)) return [];

        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return [];
        }

        var target = String(classId);
        return data.teams.filter(function(t) {
            return t && typeof t === 'object' &&
                   t.type === 'academic' &&
                   String(t.classId) === target &&
                   t.status !== 'deleted';
        });
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
        return classes.filter(function(c) {
            return c && char.classIds.some(function(cid) {
                return String(cid) === String(c.id);
            });
        });
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
        var teamCount = teams.length;
        var characterCount = characters.length;

        // Count active students (not deceased)
        var activeCount = 0;
        for (var i = 0; i < characters.length; i++) {
            if (!characters[i].deceased) {
                activeCount++;
            }
        }

        return {
            class: cls,
            teamCount: teamCount,
            characterCount: characterCount,
            activeCount: activeCount,
            teams: teams,
            characters: characters
        };
    }

    // ============================================================
    // CLASS PRESENCE HELPERS
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
            return { success: false, message: 'Character ID is required.' };
        }
        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        var char = getCharacterById(charId);
        if (!char) {
            return { success: false, message: 'Character not found.' };
        }

        var cls = getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        // Ensure classIds array exists
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
        }

        // Check if already in class
        if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, message: 'Character is already in this class.' };
        }

        // ---- PHASE 2: APPLY ----
        char.classIds.push(classId);

        var charName = getDisplayName(char);
        logActivity('Added ' + charName + ' to class: ' + cls.name);

        return { success: true };
    }

    function removeCharacterFromClass(charId, classId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(charId)) {
            return { success: false, message: 'Character ID is required.' };
        }
        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        var char = getCharacterById(charId);
        if (!char) {
            return { success: false, message: 'Character not found.' };
        }

        var cls = getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        if (!Array.isArray(char.classIds)) {
            return { success: false, message: 'Character is not in any classes.' };
        }

        if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, message: 'Character is not in this class.' };
        }

        // ---- PHASE 2: APPLY ----
        char.classIds = char.classIds.filter(function(cid) {
            return String(cid) !== String(classId);
        });

        var charName = getDisplayName(char);
        logActivity('Removed ' + charName + ' from class: ' + cls.name);

        return { success: true };
    }

    // ============================================================
    // CLASS VALIDATION HELPERS
    // ============================================================

    function validateClassName(name) {
        if (!isNonEmptyString(name)) {
            return { valid: false, message: 'Class name is required.' };
        }

        var trimmed = String(name).trim();

        // Check for existing class with same name
        var existing = getClassByName(trimmed);
        if (existing) {
            return { valid: false, message: 'A class with this name already exists.' };
        }

        return { valid: true };
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

        // Presence helpers
        isCharacterInClass: isCharacterInClass,
        addCharacterToClass: addCharacterToClass,
        removeCharacterFromClass: removeCharacterFromClass,

        // Validation
        validateClassName: validateClassName,
        classExists: classExists
    };

})();
