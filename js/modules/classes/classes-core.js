/**
 * js/modules/classes/classes-core.js - Classes Core Module
 * Single source of truth for all class-related data mutations
 * Path: js/modules/classes/classes-core.js
 * 
 * This module handles:
 *   - Class CRUD (create, read, update, delete)
 *   - Character-class assignments
 *   - Class validation
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - USES CharacterQueries for character data
 *   - USES ClassesQueries for class queries
 *   - USES TeamQueries for team data
 *   - USES ActivityLog for activity logging
 *   - USES ObjectUtils for deep cloning
 *   - USES IdUtils for ID generation
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Validate inputs
 *     2. Build candidate state (deep clone)
 *     3. Apply validated changes to candidate
 *     4. Apply candidate to data store (replace, not mutate)
 *     5. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before candidate validation completes
 * 
 * CLASS SEMANTICS:
 *   - Classes are stored as: classes = [{ id, name, createdAt }]
 *   - Class names must be unique (case-insensitive, trimmed)
 *   - Classes are referenced by characters via classIds array
 *   - Classes are referenced by academic teams via classId field
 * 
 * DELETION SEMANTICS:
 *   - Deleting a class removes it from all characters' classIds arrays
 *   - Deleting a class sets classId to null on all academic teams
 *   - The class object itself is removed from the classes array
 *   - All operations are transactional (all or nothing)
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.ValidationUtils (from validation-utils.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 * 
 * USAGE:
 *   var core = window.ClassesCore;
 *   var result = core.createClass('Spring 2025');
 *   if (result.success) { console.log('Created:', result.class); }
 * 
 *   var updateResult = core.updateClass('class_123', { name: 'Spring 2025 (A)' });
 *   var deleteResult = core.deleteClass('class_123');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesCoreLoaded) {
        return;
    }
    window.__classesCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var TeamQueries = window.TeamQueries;
    var ActivityLog = window.ActivityLog;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;

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
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getTeamsByClass !== 'function') {
            missing.push('ClassesQueries.getTeamsByClass');
        }

        // TeamQueries is MANDATORY
        if (!TeamQueries || typeof TeamQueries.isTeamOperational !== 'function') {
            missing.push('TeamQueries.isTeamOperational');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // ObjectUtils is MANDATORY
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        // IdUtils is MANDATORY
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (missing.length > 0) {
            console.warn('ClassesCore: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        // Fallback (should never be reached if dependencies are checked)
        if (value === null || typeof value !== 'object') return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.warn('ClassesCore: Failed to clone:', e);
            return null;
        }
    }

    function recordActivity(message) {
        try {
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (e) {
            // Ignore logging errors
        }
    }

    function getCharacterName(charId) {
        if (CharacterQueries && typeof CharacterQueries.getDisplayName === 'function') {
            var char = CharacterQueries.getCharacterById(charId);
            return char ? CharacterQueries.getDisplayName(char) : 'Unknown';
        }
        return 'Unknown';
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateClassId() {
        if (IdUtils && typeof IdUtils.generateId === 'function') {
            return IdUtils.generateId('class');
        }
        if (typeof window.generateId === 'function') {
            return window.generateId('class');
        }
        return 'class_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate a class name.
     * @param {string} name - Class name to validate
     * @param {string} excludeId - Optional class ID to exclude from duplicate check
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateClassName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return { valid: false, message: 'Class name is required.' };
        }

        var trimmed = String(name).trim();

        // Check for existing class with same name
        var classes = ClassesQueries.getClasses();
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (!c || typeof c !== 'object') continue;
            if (excludeId && String(c.id) === String(excludeId)) continue;
            if (String(c.name || '').toLowerCase().trim() === trimmed.toLowerCase()) {
                return { valid: false, message: 'A class with this name already exists.' };
            }
        }

        return { valid: true };
    }

    /**
     * Validate class data before create/update.
     * @param {object} data - Class data to validate
     * @param {boolean} isPartial - If true, only validate fields that are present
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateClassData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Class data must be an object.' };
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name cannot be empty.' };
            }
        }

        // No other fields to validate for classes
        return { valid: true };
    }

    // ============================================================
    // CLASS CRUD OPERATIONS
    // ============================================================

    /**
     * Create a new class.
     * @param {string} name - Class name
     * @returns {object} { success: boolean, message?: string, class?: object }
     */
    function createClass(name) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        var validation = validateClassName(name);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }

        // ---- PHASE 3: CHECK DUPLICATE (defensive) ----
        var trimmed = String(name).trim();
        var existing = data.classes.find(function(c) {
            return c && String(c.name || '').toLowerCase() === trimmed.toLowerCase();
        });

        if (existing) {
            return { success: false, message: 'A class with this name already exists.' };
        }

        // ---- PHASE 4: CREATE ----
        var newClass = {
            id: generateClassId(),
            name: trimmed,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(data.classes);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare class data.' };
        }

        candidate.push(newClass);

        // ---- PHASE 6: COMMIT ----
        data.classes = candidate;

        recordActivity('Created class: ' + newClass.name);

        return {
            success: true,
            class: deepClone(newClass),
            message: 'Class created successfully.'
        };
    }

    /**
     * Update an existing class.
     * @param {string} id - Class ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, message?: string, class?: object, changed?: boolean }
     */
    function updateClass(id, updates) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }

        if (!isObject(updates)) {
            return { success: false, message: 'Updates must be an object.' };
        }

        var dataValidation = validateClassData(updates, true);
        if (!dataValidation.valid) {
            return { success: false, message: dataValidation.message };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return { success: false, message: 'No classes found.' };
        }

        // ---- PHASE 3: FIND CLASS ----
        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }

        var cls = data.classes[index];

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(cls);
        if (candidate === null) {
            return { success: false, message: 'Failed to clone class data.' };
        }

        var changed = false;

        // ---- PHASE 5: APPLY UPDATES TO CANDIDATE ----
        if (updates.name !== undefined) {
            var nameValidation = validateClassName(updates.name, id);
            if (!nameValidation.valid) {
                return { success: false, message: nameValidation.message };
            }
            var newName = String(updates.name).trim();
            if (candidate.name !== newName) {
                candidate.name = newName;
                changed = true;
            }
        }

        if (!changed) {
            return {
                success: true,
                class: deepClone(cls),
                changed: false,
                message: 'No changes to apply.'
            };
        }

        // ---- PHASE 6: BUILD FULL CANDIDATE ARRAY ----
        var candidateArray = deepClone(data.classes);
        if (candidateArray === null) {
            return { success: false, message: 'Failed to prepare class data.' };
        }

        candidateArray[index] = candidate;

        // ---- PHASE 7: COMMIT ----
        data.classes = candidateArray;

        recordActivity('Updated class: ' + candidate.name);

        return {
            success: true,
            class: deepClone(candidate),
            changed: true,
            message: 'Class updated successfully.'
        };
    }

    /**
     * Delete a class.
     * @param {string} id - Class ID
     * @returns {object} { success: boolean, message?: string, affectedCharacters?: number, affectedTeams?: number }
     */
    function deleteClass(id) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Class ID is required.' };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!Array.isArray(data.classes)) {
            return { success: false, message: 'No classes found.' };
        }

        if (!Array.isArray(data.characters)) {
            return { success: false, message: 'Character data is corrupted.' };
        }

        if (!Array.isArray(data.teams)) {
            return { success: false, message: 'Team data is corrupted.' };
        }

        // ---- PHASE 3: FIND CLASS ----
        var index = data.classes.findIndex(function(c) {
            return c && String(c.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Class not found.' };
        }

        var cls = data.classes[index];
        var className = cls.name;

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateClasses = deepClone(data.classes);
        if (candidateClasses === null) {
            return { success: false, message: 'Failed to prepare class data.' };
        }

        var candidateCharacters = deepClone(data.characters);
        if (candidateCharacters === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var candidateTeams = deepClone(data.teams);
        if (candidateTeams === null) {
            return { success: false, message: 'Failed to prepare team data.' };
        }

        var affectedCharacters = 0;
        var affectedTeams = 0;

        // ---- PHASE 5: CLEAN REFERENCES IN CHARACTERS ----
        for (var i = 0; i < candidateCharacters.length; i++) {
            var char = candidateCharacters[i];
            if (!char || typeof char !== 'object' || !Array.isArray(char.classIds)) {
                continue;
            }

            // Check if character has this class
            var hadClass = char.classIds.some(function(cid) {
                return String(cid) === String(id);
            });

            if (hadClass) {
                affectedCharacters++;
                char.classIds = char.classIds.filter(function(cid) {
                    return String(cid) !== String(id);
                });
            }
        }

        // ---- PHASE 6: CLEAN REFERENCES IN TEAMS ----
        for (var i = 0; i < candidateTeams.length; i++) {
            var team = candidateTeams[i];
            if (!team || typeof team !== 'object' || team.type !== 'academic') {
                continue;
            }

            if (String(team.classId) === String(id)) {
                affectedTeams++;
                team.classId = null;
            }
        }

        // ---- PHASE 7: REMOVE CLASS ----
        candidateClasses.splice(index, 1);

        // ---- PHASE 8: COMMIT ALL CANDIDATES ----
        data.classes = candidateClasses;
        data.characters = candidateCharacters;
        data.teams = candidateTeams;

        recordActivity('Deleted class: ' + className + ' (' + affectedCharacters + ' characters, ' + affectedTeams + ' teams)');

        return {
            success: true,
            className: className,
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams,
            message: 'Class deleted successfully.'
        };
    }

    // ============================================================
    // CHARACTER-CLASS ASSIGNMENTS
    // ============================================================

    /**
     * Add a character to a class.
     * @param {string} charId - Character ID
     * @param {string} classId - Class ID
     * @returns {object} { success: boolean, message?: string }
     */
    function addCharacterToClass(charId, classId) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(charId)) {
            return { success: false, message: 'Character ID is required.' };
        }

        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        // ---- PHASE 2: VALIDATE CLASS EXISTS ----
        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        // ---- PHASE 3: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return { success: false, message: 'No characters found.' };
        }

        // ---- PHASE 4: FIND CHARACTER ----
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
            return { success: false, message: 'Character not found.' };
        }

        var existingClassIds = Array.isArray(char.classIds) ? char.classIds : [];

        if (existingClassIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, message: 'Character is already in this class.' };
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return { success: false, message: 'Character data corrupted.' };
        }

        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        candidateChar.classIds.push(classId);

        // ---- PHASE 6: COMMIT ----
        data.characters = candidate;

        var charName = CharacterQueries.getDisplayName(char);
        recordActivity('Added ' + charName + ' to class: ' + cls.name);

        return {
            success: true,
            characterId: charId,
            classId: classId,
            className: cls.name,
            message: 'Character added to class successfully.'
        };
    }

    /**
     * Remove a character from a class.
     * @param {string} charId - Character ID
     * @param {string} classId - Class ID
     * @returns {object} { success: boolean, message?: string }
     */
    function removeCharacterFromClass(charId, classId) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(charId)) {
            return { success: false, message: 'Character ID is required.' };
        }

        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        // ---- PHASE 2: VALIDATE CLASS EXISTS ----
        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        // ---- PHASE 3: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return { success: false, message: 'No characters found.' };
        }

        // ---- PHASE 4: FIND CHARACTER ----
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
            return { success: false, message: 'Character not found.' };
        }

        var existingClassIds = Array.isArray(char.classIds) ? char.classIds : [];

        if (!existingClassIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, message: 'Character is not in this class.' };
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return { success: false, message: 'Character data corrupted.' };
        }

        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        candidateChar.classIds = candidateChar.classIds.filter(function(cid) {
            return String(cid) !== String(classId);
        });

        // ---- PHASE 6: COMMIT ----
        data.characters = candidate;

        var charName = CharacterQueries.getDisplayName(char);
        recordActivity('Removed ' + charName + ' from class: ' + cls.name);

        return {
            success: true,
            characterId: charId,
            classId: classId,
            className: cls.name,
            message: 'Character removed from class successfully.'
        };
    }

    /**
     * Remove a character from all classes.
     * @param {string} charId - Character ID
     * @returns {object} { success: boolean, message?: string, removedCount?: number }
     */
    function removeCharacterFromAllClasses(charId) {
        // ---- PHASE 1: VALIDATE ----
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(charId)) {
            return { success: false, message: 'Character ID is required.' };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return { success: false, message: 'No characters found.' };
        }

        // ---- PHASE 3: FIND CHARACTER ----
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
            return { success: false, message: 'Character not found.' };
        }

        var existingClassIds = Array.isArray(char.classIds) ? char.classIds : [];

        if (existingClassIds.length === 0) {
            return {
                success: true,
                removedCount: 0,
                message: 'Character is not in any classes.'
            };
        }

        var removedCount = existingClassIds.length;

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return { success: false, message: 'Character data corrupted.' };
        }

        candidateChar.classIds = [];

        // ---- PHASE 5: COMMIT ----
        data.characters = candidate;

        var charName = CharacterQueries.getDisplayName(char);
        recordActivity('Removed ' + charName + ' from all classes (' + removedCount + ' classes)');

        return {
            success: true,
            removedCount: removedCount,
            message: 'Character removed from all classes successfully.'
        };
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Add multiple characters to a class.
     * @param {string} classId - Class ID
     * @param {Array} charIds - Array of character IDs
     * @returns {object} { success: boolean, message?: string, added?: number, failed?: Array }
     */
    function addCharactersToClass(classId, charIds) {
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        if (!Array.isArray(charIds) || charIds.length === 0) {
            return { success: false, message: 'At least one character ID is required.' };
        }

        // ---- PHASE 1: VALIDATE CLASS EXISTS ----
        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return { success: false, message: 'No characters found.' };
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var added = 0;
        var failed = [];

        for (var i = 0; i < charIds.length; i++) {
            var charId = charIds[i];
            if (!isNonEmptyString(charId)) {
                failed.push({ charId: charId, reason: 'Invalid character ID' });
                continue;
            }

            var charIndex = -1;
            for (var j = 0; j < candidate.length; j++) {
                if (candidate[j] && String(candidate[j].id) === String(charId)) {
                    charIndex = j;
                    break;
                }
            }

            if (charIndex === -1) {
                failed.push({ charId: charId, reason: 'Character not found' });
                continue;
            }

            var char = candidate[charIndex];
            if (!Array.isArray(char.classIds)) {
                char.classIds = [];
            }

            if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                failed.push({ charId: charId, reason: 'Already in class' });
                continue;
            }

            char.classIds.push(classId);
            added++;
        }

        if (added === 0) {
            return {
                success: false,
                message: 'No characters were added. ' + failed.length + ' failed.',
                added: 0,
                failed: failed
            };
        }

        // ---- PHASE 4: COMMIT ----
        data.characters = candidate;

        recordActivity('Added ' + added + ' characters to class: ' + cls.name);

        return {
            success: true,
            added: added,
            failed: failed,
            message: 'Added ' + added + ' characters to class. ' + failed.length + ' failed.'
        };
    }

    /**
     * Remove multiple characters from a class.
     * @param {string} classId - Class ID
     * @param {Array} charIds - Array of character IDs
     * @returns {object} { success: boolean, message?: string, removed?: number, failed?: Array }
     */
    function removeCharactersFromClass(classId, charIds) {
        if (!checkDependencies()) {
            return { success: false, message: 'Dependencies not loaded.' };
        }

        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        if (!Array.isArray(charIds) || charIds.length === 0) {
            return { success: false, message: 'At least one character ID is required.' };
        }

        // ---- PHASE 1: VALIDATE CLASS EXISTS ----
        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            return { success: false, message: 'Class not found.' };
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return { success: false, message: 'No characters found.' };
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return { success: false, message: 'Failed to prepare character data.' };
        }

        var removed = 0;
        var failed = [];

        for (var i = 0; i < charIds.length; i++) {
            var charId = charIds[i];
            if (!isNonEmptyString(charId)) {
                failed.push({ charId: charId, reason: 'Invalid character ID' });
                continue;
            }

            var charIndex = -1;
            for (var j = 0; j < candidate.length; j++) {
                if (candidate[j] && String(candidate[j].id) === String(charId)) {
                    charIndex = j;
                    break;
                }
            }

            if (charIndex === -1) {
                failed.push({ charId: charId, reason: 'Character not found' });
                continue;
            }

            var char = candidate[charIndex];
            if (!Array.isArray(char.classIds)) {
                char.classIds = [];
            }

            if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                failed.push({ charId: charId, reason: 'Not in class' });
                continue;
            }

            char.classIds = char.classIds.filter(function(cid) {
                return String(cid) !== String(classId);
            });
            removed++;
        }

        if (removed === 0) {
            return {
                success: false,
                message: 'No characters were removed. ' + failed.length + ' failed.',
                removed: 0,
                failed: failed
            };
        }

        // ---- PHASE 4: COMMIT ----
        data.characters = candidate;

        recordActivity('Removed ' + removed + ' characters from class: ' + cls.name);

        return {
            success: true,
            removed: removed,
            failed: failed,
            message: 'Removed ' + removed + ' characters from class. ' + failed.length + ' failed.'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesCore = {
        // CRUD
        createClass: createClass,
        updateClass: updateClass,
        deleteClass: deleteClass,

        // Character-class assignments
        addCharacterToClass: addCharacterToClass,
        removeCharacterFromClass: removeCharacterFromClass,
        removeCharacterFromAllClasses: removeCharacterFromAllClasses,

        // Bulk operations
        addCharactersToClass: addCharactersToClass,
        removeCharactersFromClass: removeCharactersFromClass,

        // Validation
        validateClassName: validateClassName,
        validateClassData: validateClassData,

        // Helpers
        generateClassId: generateClassId
    };

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from CoreUtils/curriculum-classes to ClassesCore.
    // They will be removed in a future version.

    window.createClass = createClass;
    window.updateClass = updateClass;
    window.deleteClass = deleteClass;
    window.addCharacterToClass = addCharacterToClass;
    window.removeCharacterFromClass = removeCharacterFromClass;

})();
