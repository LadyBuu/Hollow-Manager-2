/**
 * js/modules/missions/missions-core.js - Missions Core Module
 * Single source of truth for all mission data mutations
 * Path: js/modules/missions/missions-core.js
 * 
 * This module handles:
 *   - Mission CRUD (create, read, update, delete)
 *   - Mission status transitions
 *   - Objective management
 *   - Support personnel management
 *   - Mission log management
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - USES MissionsSchema for structural validation
 *   - USES MissionRules for domain logic
 *   - USES MissionsQueries for read operations (with fallback to window.data)
 *   - USES CharacterQueries for character data (with fallback to window.data)
 *   - USES TeamQueries for team data (with fallback to window.data)
 *   - USES IdUtils for ID generation
 *   - USES ObjectUtils for deep cloning
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
 * DEPENDENCIES:
 *   - window.MissionsSchema (from missions-schema.js) - MANDATORY
 *   - window.MissionRules (from mission-rules.js) - MANDATORY
 *   - window.MissionsQueries (from missions-queries.js) - RECOMMENDED (with fallback)
 *   - window.CharacterQueries (from character-queries.js) - RECOMMENDED (with fallback)
 *   - window.TeamQueries (from team-queries.js) - RECOMMENDED (with fallback)
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var core = window.MissionsCore;
 *   var result = core.createMission({ title: 'Operation Nightfall', ... });
 *   var mission = core.getMission('2026-001-E');
 *   var updated = core.updateMission('2026-001-E', { status: 'completed' });
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionsCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    var missing = [];

    if (!window.MissionsSchema || typeof window.MissionsSchema.validateMission !== 'function') {
        missing.push('MissionsSchema.validateMission');
    }
    if (!window.MissionRules || typeof window.MissionRules.recalculateMission !== 'function') {
        missing.push('MissionRules.recalculateMission');
    }
    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }
    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsCore] Missing dependencies: ' + missing.join(', '));
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MissionsSchema = window.MissionsSchema;
    var MissionRules = window.MissionRules;
    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;

    // Optional dependencies (with fallbacks)
    var MissionsQueries = window.MissionsQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_STATUS = 'active';
    var DEFAULT_PRIORITY = 'medium';
    var DEFAULT_DIFFICULTY = 'medium';

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId(prefix) {
        return IdUtils.generateId(prefix);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA ACCESS (with fallbacks)
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getMissionsFromStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.missions)) {
            return [];
        }
        return data.missions;
    }

    function getCharactersFromStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }
        return data.characters;
    }

    function getTeamsFromStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return [];
        }
        return data.teams;
    }

    // ============================================================
    // QUERY FUNCTIONS (with fallbacks)
    // ============================================================

    /**
     * Get all missions.
     * Uses MissionsQueries if available, otherwise reads from window.data.
     */
    function getMissions() {
        if (MissionsQueries && typeof MissionsQueries.getMissions === 'function') {
            try {
                return MissionsQueries.getMissions();
            } catch (e) {
                // Fall through to store
            }
        }
        return deepClone(getMissionsFromStore()) || [];
    }

    /**
     * Get a mission by ID.
     * Uses MissionsQueries if available, otherwise reads from window.data.
     */
    function getMission(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (MissionsQueries && typeof MissionsQueries.getMission === 'function') {
            try {
                return MissionsQueries.getMission(id);
            } catch (e) {
                // Fall through to store
            }
        }

        var missions = getMissionsFromStore();
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m && (String(m.id) === String(id) || String(m.missionId) === String(id))) {
                return deepClone(m);
            }
        }
        return null;
    }

    /**
     * Get a character by ID.
     * Uses CharacterQueries if available, otherwise reads from window.data.
     */
    function getCharacterById(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (CharacterQueries && typeof CharacterQueries.getCharacterById === 'function') {
            try {
                return CharacterQueries.getCharacterById(id);
            } catch (e) {
                // Fall through to store
            }
        }

        var characters = getCharactersFromStore();
        for (var i = 0; i < characters.length; i++) {
            if (characters[i] && String(characters[i].id) === String(id)) {
                return characters[i];
            }
        }
        return null;
    }

    /**
     * Get a team by ID.
     * Uses TeamQueries if available, otherwise reads from window.data.
     */
    function getTeamById(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (TeamQueries && typeof TeamQueries.getTeamById === 'function') {
            try {
                return TeamQueries.getTeamById(id);
            } catch (e) {
                // Fall through to store
            }
        }

        var teams = getTeamsFromStore();
        for (var i = 0; i < teams.length; i++) {
            if (teams[i] && String(teams[i].id) === String(id)) {
                return teams[i];
            }
        }
        return null;
    }

    /**
     * Get support personnel names for a mission.
     * Uses MissionsQueries if available.
     */
    function getSupportPersonnel(mission) {
        if (!mission) {
            return [];
        }

        if (MissionsQueries && typeof MissionsQueries.getSupportPersonnel === 'function') {
            try {
                return MissionsQueries.getSupportPersonnel(mission);
            } catch (e) {
                // Fall through
            }
        }

        if (!Array.isArray(mission.supportPersonnel)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < mission.supportPersonnel.length; i++) {
            var charId = mission.supportPersonnel[i];
            var char = getCharacterById(charId);
            if (char) {
                result.push({
                    id: charId,
                    name: char.firstName + ' ' + (char.lastName || ''),
                    character: char
                });
            }
        }
        return result;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateMissionData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Mission data must be an object.' };
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.title)) {
                return { valid: false, message: 'Mission title is required.' };
            }
        } else {
            if (data.title !== undefined && !isNonEmptyString(data.title)) {
                return { valid: false, message: 'Mission title cannot be empty.' };
            }
        }

        return { valid: true };
    }

    function validateStatus(status) {
        var validStatuses = ['active', 'completed', 'cancelled', 'on_hold'];
        if (validStatuses.indexOf(status) === -1) {
            return { valid: false, message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') };
        }
        return { valid: true };
    }

    function validatePriority(priority) {
        var validPriorities = ['low', 'medium', 'high', 'critical'];
        if (validPriorities.indexOf(priority) === -1) {
            return { valid: false, message: 'Invalid priority. Must be one of: ' + validPriorities.join(', ') };
        }
        return { valid: true };
    }

    function validateDifficulty(difficulty) {
        var validDifficulties = ['easy', 'medium', 'hard', 'extreme'];
        if (validDifficulties.indexOf(difficulty) === -1) {
            return { valid: false, message: 'Invalid difficulty. Must be one of: ' + validDifficulties.join(', ') };
        }
        return { valid: true };
    }

    function validateTeamId(teamId) {
        if (!teamId) {
            return { valid: true }; // Null/undefined is allowed
        }
        var team = getTeamById(teamId);
        if (!team) {
            return { valid: false, message: 'Team not found.' };
        }
        return { valid: true, team: team };
    }

    function validateCharacterId(characterId) {
        if (!characterId) {
            return { valid: false, message: 'Character ID is required.' };
        }
        var character = getCharacterById(characterId);
        if (!character) {
            return { valid: false, message: 'Character not found.' };
        }
        return { valid: true, character: character };
    }

    function validateObjective(objective) {
        if (!isObject(objective)) {
            return { valid: false, message: 'Objective must be an object.' };
        }
        if (!isNonEmptyString(objective.text)) {
            return { valid: false, message: 'Objective text is required.' };
        }
        return { valid: true };
    }

    // ============================================================
    // MISSION CRUD OPERATIONS
    // ============================================================

    /**
     * Create a new mission.
     * @param {object} data - Mission data
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function createMission(data) {
        // ---- PHASE 1: VALIDATE ----
        if (!isObject(data)) {
            return failure('Mission data is required.');
        }

        if (!isNonEmptyString(data.title)) {
            return failure('Mission title is required.');
        }

        // Validate team
        var teamResult = validateTeamId(data.assignedTeamId);
        if (!teamResult.valid) {
            return failure(teamResult.message);
        }

        // Validate status
        var status = data.status || DEFAULT_STATUS;
        var statusResult = validateStatus(status);
        if (!statusResult.valid) {
            return failure(statusResult.message);
        }

        // Validate priority
        var priority = data.priority || DEFAULT_PRIORITY;
        var priorityResult = validatePriority(priority);
        if (!priorityResult.valid) {
            return failure(priorityResult.message);
        }

        // Validate difficulty
        var difficulty = data.difficulty || DEFAULT_DIFFICULTY;
        var difficultyResult = validateDifficulty(difficulty);
        if (!difficultyResult.valid) {
            return failure(difficultyResult.message);
        }

        // Validate objectives
        var objectives = Array.isArray(data.objectives) ? data.objectives : [];
        for (var i = 0; i < objectives.length; i++) {
            var objResult = validateObjective(objectives[i]);
            if (!objResult.valid) {
                return failure('Objective ' + (i + 1) + ': ' + objResult.message);
            }
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var now = new Date().toISOString();

        var newMission = {
            id: generateId('miss'),
            missionId: data.missionId || null,
            title: data.title.trim(),
            description: data.description || '',
            year: data.year || null,
            month: data.month || null,
            day: data.day || null,
            primaryType: data.primaryType || '',
            subtype: data.subtype || '',
            secondaryType: data.secondaryType || '',
            escalation: data.escalation || 'tier_ii',
            threatType: data.threatType || '',
            environment: data.environment || '',
            location: data.location || '',
            duration: data.duration || '',
            difficulty: difficulty,
            priority: priority,
            basePay: data.basePay || '',
            surchargePay: data.surchargePay || '',
            pay: data.pay || '',
            billing: data.billing || 'original',
            assignedTeamId: data.assignedTeamId || null,
            supportPersonnel: Array.isArray(data.supportPersonnel) ? data.supportPersonnel.slice() : [],
            status: status,
            objectives: objectives.map(function(obj) {
                return {
                    text: obj.text.trim(),
                    done: obj.done === true
                };
            }),
            progress: 0,
            notes: data.notes || '',
            tags: Array.isArray(data.tags) ? data.tags.slice() : [],
            createdAt: now,
            completedAt: status === 'completed' ? now : null,
            log: []
        };

        // ---- PHASE 3: RECALCULATE ----
        try {
            var recalculated = MissionRules.recalculateMission(newMission);
            if (recalculated) {
                newMission = recalculated;
            }
        } catch (e) {
            // Recalculation failure shouldn't block creation
        }

        // ---- PHASE 4: STRUCTURAL VALIDATION ----
        var validation = MissionsSchema.validateMission(newMission);
        if (!validation.valid) {
            return failure('Validation failed: ' + validation.message);
        }

        // ---- PHASE 5: COMMIT ----
        var dataStore = getDataStore();
        if (!dataStore) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(dataStore.missions)) {
            dataStore.missions = [];
        }

        dataStore.missions.push(deepClone(newMission));

        return success({ mission: newMission });
    }

    /**
     * Update an existing mission.
     * @param {string} id - Mission ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function updateMission(id, updates) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(id)) {
            return failure('Mission ID is required.');
        }

        if (!isObject(updates)) {
            return failure('Updates must be an object.');
        }

        // ---- PHASE 2: GET MISSION ----
        var existing = getMission(id);
        if (!existing) {
            return failure('Mission not found.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        var changed = false;
        var statusChanged = false;

        // Apply updates
        if (updates.title !== undefined) {
            if (!isNonEmptyString(updates.title)) {
                return failure('Mission title cannot be empty.');
            }
            candidate.title = updates.title.trim();
            changed = true;
        }

        if (updates.description !== undefined) {
            candidate.description = updates.description || '';
            changed = true;
        }

        if (updates.status !== undefined) {
            var statusResult = validateStatus(updates.status);
            if (!statusResult.valid) {
                return failure(statusResult.message);
            }
            if (candidate.status !== updates.status) {
                candidate.status = updates.status;
                statusChanged = true;
                changed = true;
            }
        }

        if (updates.priority !== undefined) {
            var priorityResult = validatePriority(updates.priority);
            if (!priorityResult.valid) {
                return failure(priorityResult.message);
            }
            candidate.priority = updates.priority;
            changed = true;
        }

        if (updates.difficulty !== undefined) {
            var difficultyResult = validateDifficulty(updates.difficulty);
            if (!difficultyResult.valid) {
                return failure(difficultyResult.message);
            }
            candidate.difficulty = updates.difficulty;
            changed = true;
        }

        if (updates.assignedTeamId !== undefined) {
            if (updates.assignedTeamId !== null && !isNonEmptyString(updates.assignedTeamId)) {
                return failure('Invalid team ID.');
            }
            var teamResult = validateTeamId(updates.assignedTeamId);
            if (!teamResult.valid) {
                return failure(teamResult.message);
            }
            candidate.assignedTeamId = updates.assignedTeamId || null;
            changed = true;
        }

        if (updates.location !== undefined) {
            candidate.location = updates.location || '';
            changed = true;
        }

        if (updates.duration !== undefined) {
            candidate.duration = updates.duration || '';
            changed = true;
        }

        if (updates.pay !== undefined) {
            candidate.pay = updates.pay || '';
            changed = true;
        }

        if (updates.basePay !== undefined) {
            candidate.basePay = updates.basePay || '';
            changed = true;
        }

        if (updates.surchargePay !== undefined) {
            candidate.surchargePay = updates.surchargePay || '';
            changed = true;
        }

        if (updates.notes !== undefined) {
            candidate.notes = updates.notes || '';
            changed = true;
        }

        if (updates.tags !== undefined) {
            candidate.tags = Array.isArray(updates.tags) ? updates.tags.slice() : [];
            changed = true;
        }

        if (updates.supportPersonnel !== undefined) {
            var personnel = [];
            if (Array.isArray(updates.supportPersonnel)) {
                for (var i = 0; i < updates.supportPersonnel.length; i++) {
                    var charResult = validateCharacterId(updates.supportPersonnel[i]);
                    if (!charResult.valid) {
                        return failure('Invalid support personnel: ' + charResult.message);
                    }
                    personnel.push(updates.supportPersonnel[i]);
                }
            }
            candidate.supportPersonnel = personnel;
            changed = true;
        }

        if (updates.objectives !== undefined) {
            if (!Array.isArray(updates.objectives)) {
                return failure('Objectives must be an array.');
            }
            var objectives = [];
            for (var j = 0; j < updates.objectives.length; j++) {
                var objResult = validateObjective(updates.objectives[j]);
                if (!objResult.valid) {
                    return failure('Objective ' + (j + 1) + ': ' + objResult.message);
                }
                objectives.push({
                    text: updates.objectives[j].text.trim(),
                    done: updates.objectives[j].done === true
                });
            }
            candidate.objectives = objectives;
            changed = true;
        }

        if (updates.progress !== undefined) {
            var progress = Number(updates.progress);
            if (isNaN(progress) || progress < 0 || progress > 100) {
                return failure('Progress must be a number between 0 and 100.');
            }
            candidate.progress = progress;
            changed = true;
        }

        // If status changed to completed, set completedAt
        if (statusChanged && candidate.status === 'completed' && !candidate.completedAt) {
            candidate.completedAt = new Date().toISOString();
            changed = true;
        }

        // If status changed away from completed, clear completedAt
        if (statusChanged && candidate.status !== 'completed' && candidate.completedAt) {
            candidate.completedAt = null;
            changed = true;
        }

        // ---- PHASE 4: RECALCULATE ----
        try {
            var recalculated = MissionRules.recalculateMission(candidate);
            if (recalculated) {
                candidate = recalculated;
                changed = true;
            }
        } catch (e) {
            // Recalculation failure shouldn't block update
        }

        if (!changed) {
            return success({ mission: existing, changed: false });
        }

        // ---- PHASE 5: STRUCTURAL VALIDATION ----
        var validation = MissionsSchema.validateMission(candidate);
        if (!validation.valid) {
            return failure('Validation failed: ' + validation.message);
        }

        // ---- PHASE 6: COMMIT ----
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(id)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate, changed: true });
    }

    /**
     * Delete a mission.
     * @param {string} id - Mission ID
     * @returns {object} { success: boolean, message?: string }
     */
    function deleteMission(id) {
        if (!isNonEmptyString(id)) {
            return failure('Mission ID is required.');
        }

        var existing = getMission(id);
        if (!existing) {
            return failure('Mission not found.');
        }

        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(id)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions.splice(foundIndex, 1);

        return success({ deleted: true });
    }

    // ============================================================
    // OBJECTIVE MANAGEMENT
    // ============================================================

    /**
     * Toggle an objective's done status.
     * @param {string} missionId - Mission ID
     * @param {number} objectiveIndex - Objective index
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function toggleObjective(missionId, objectiveIndex) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        if (!Array.isArray(existing.objectives) || existing.objectives.length === 0) {
            return failure('Mission has no objectives.');
        }

        if (objectiveIndex < 0 || objectiveIndex >= existing.objectives.length) {
            return failure('Objective index out of range.');
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        candidate.objectives[objectiveIndex].done = !candidate.objectives[objectiveIndex].done;

        // Recalculate mission
        try {
            var recalculated = MissionRules.recalculateMission(candidate);
            if (recalculated) {
                candidate = recalculated;
            }
        } catch (e) {
            // Recalculation failure shouldn't block toggle
        }

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(missionId)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate, objectiveIndex: objectiveIndex });
    }

    /**
     * Add an objective to a mission.
     * @param {string} missionId - Mission ID
     * @param {string} text - Objective text
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function addObjective(missionId, text) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        if (!isNonEmptyString(text)) {
            return failure('Objective text is required.');
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        if (!Array.isArray(candidate.objectives)) {
            candidate.objectives = [];
        }

        candidate.objectives.push({
            text: text.trim(),
            done: false
        });

        // Recalculate mission
        try {
            var recalculated = MissionRules.recalculateMission(candidate);
            if (recalculated) {
                candidate = recalculated;
            }
        } catch (e) {
            // Recalculation failure shouldn't block add
        }

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(missionId)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate });
    }

    /**
     * Remove an objective from a mission.
     * @param {string} missionId - Mission ID
     * @param {number} objectiveIndex - Objective index
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function removeObjective(missionId, objectiveIndex) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        if (!Array.isArray(existing.objectives) || existing.objectives.length === 0) {
            return failure('Mission has no objectives.');
        }

        if (objectiveIndex < 0 || objectiveIndex >= existing.objectives.length) {
            return failure('Objective index out of range.');
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        candidate.objectives.splice(objectiveIndex, 1);

        // Recalculate mission
        try {
            var recalculated = MissionRules.recalculateMission(candidate);
            if (recalculated) {
                candidate = recalculated;
            }
        } catch (e) {
            // Recalculation failure shouldn't block remove
        }

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(missionId)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate });
    }

    // ============================================================
    // LOG MANAGEMENT
    // ============================================================

    /**
     * Add a log entry to a mission.
     * @param {string} missionId - Mission ID
     * @param {string} message - Log message
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function addLog(missionId, message) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        if (!isNonEmptyString(message)) {
            return failure('Log message is required.');
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        if (!Array.isArray(candidate.log)) {
            candidate.log = [];
        }

        candidate.log.push({
            timestamp: new Date().toISOString(),
            message: message.trim()
        });

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var i = 0; i < dataStore.missions.length; i++) {
            if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(missionId)) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate });
    }

    // ============================================================
    // SUPPORT PERSONNEL MANAGEMENT
    // ============================================================

    /**
     * Add support personnel to a mission.
     * @param {string} missionId - Mission ID
     * @param {string} characterId - Character ID
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function addSupportPersonnel(missionId, characterId) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        var charResult = validateCharacterId(characterId);
        if (!charResult.valid) {
            return failure(charResult.message);
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        if (!Array.isArray(existing.supportPersonnel)) {
            existing.supportPersonnel = [];
        }

        // Check if already added
        for (var i = 0; i < existing.supportPersonnel.length; i++) {
            if (String(existing.supportPersonnel[i]) === String(characterId)) {
                return failure('Character is already assigned as support personnel.');
            }
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        candidate.supportPersonnel.push(characterId);

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var j = 0; j < dataStore.missions.length; j++) {
            if (dataStore.missions[j] && String(dataStore.missions[j].id) === String(missionId)) {
                foundIndex = j;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate });
    }

    /**
     * Remove support personnel from a mission.
     * @param {string} missionId - Mission ID
     * @param {string} characterId - Character ID
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function removeSupportPersonnel(missionId, characterId) {
        if (!isNonEmptyString(missionId)) {
            return failure('Mission ID is required.');
        }

        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }

        var existing = getMission(missionId);
        if (!existing) {
            return failure('Mission not found.');
        }

        if (!Array.isArray(existing.supportPersonnel)) {
            return failure('Mission has no support personnel.');
        }

        var found = false;
        for (var i = 0; i < existing.supportPersonnel.length; i++) {
            if (String(existing.supportPersonnel[i]) === String(characterId)) {
                found = true;
                break;
            }
        }

        if (!found) {
            return failure('Character is not assigned as support personnel.');
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone mission data.');
        }

        var newPersonnel = [];
        for (var j = 0; j < candidate.supportPersonnel.length; j++) {
            if (String(candidate.supportPersonnel[j]) !== String(characterId)) {
                newPersonnel.push(candidate.supportPersonnel[j]);
            }
        }
        candidate.supportPersonnel = newPersonnel;

        // Commit
        var dataStore = getDataStore();
        if (!dataStore || !Array.isArray(dataStore.missions)) {
            return failure('Data store is not available.');
        }

        var foundIndex = -1;
        for (var k = 0; k < dataStore.missions.length; k++) {
            if (dataStore.missions[k] && String(dataStore.missions[k].id) === String(missionId)) {
                foundIndex = k;
                break;
            }
        }

        if (foundIndex === -1) {
            return failure('Mission not found in data store.');
        }

        dataStore.missions[foundIndex] = deepClone(candidate);

        return success({ mission: candidate });
    }

    // ============================================================
    // STATUS OPERATIONS
    // ============================================================

    /**
     * Complete a mission.
     * @param {string} missionId - Mission ID
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function completeMission(missionId) {
        return updateMission(missionId, { status: 'completed' });
    }

    /**
     * Cancel a mission.
     * @param {string} missionId - Mission ID
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function cancelMission(missionId) {
        return updateMission(missionId, { status: 'cancelled' });
    }

    /**
     * Reactivate a mission.
     * @param {string} missionId - Mission ID
     * @returns {object} { success: boolean, message?: string, mission?: object }
     */
    function reactivateMission(missionId) {
        return updateMission(missionId, { status: 'active' });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsCore = {
        // Query functions (with fallbacks)
        getMissions: getMissions,
        getMission: getMission,
        getSupportPersonnel: getSupportPersonnel,

        // CRUD
        createMission: createMission,
        updateMission: updateMission,
        deleteMission: deleteMission,

        // Objectives
        toggleObjective: toggleObjective,
        addObjective: addObjective,
        removeObjective: removeObjective,

        // Log
        addLog: addLog,

        // Support personnel
        addSupportPersonnel: addSupportPersonnel,
        removeSupportPersonnel: removeSupportPersonnel,

        // Status operations
        completeMission: completeMission,
        cancelMission: cancelMission,
        reactivateMission: reactivateMission,

        // Validation (exposed for external use)
        validateStatus: validateStatus,
        validatePriority: validatePriority,
        validateDifficulty: validateDifficulty,
        validateObjective: validateObjective
    };

    window.__missionsCoreLoaded = true;

})();
