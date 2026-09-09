/**
 * js/modules/missions/mission-core.js - Mission Core
 * CANONICAL mutation API for missions
 * 
 * This module provides:
 *   - Mission CRUD operations (create, update, delete)
 *   - Mission status transitions (complete, cancel, reactivate)
 *   - Objective management (add, remove, toggle)
 *   - Support personnel management (add, remove)
 *   - Mission log management (add entry)
 *   - Domain rule functions (progress, pay, eligibility)
 * 
 * IMPORTANT:
 *   - This is the CANONICAL mutation API for missions
 *   - All mission mutations should go through this module
 *   - Uses MutationPipeline for all mutations
 *   - Uses MissionQueries for read operations
 *   - Uses MissionSchema for structural validation
 *   - All mutations are atomic and validated before application
 *   - Does NOT call saveData() - MutationPipeline handles persistence
 *   - Does NOT depend on UI (no notifications, no DOM)
 * 
 * MUTATION CONTRACT:
 *   - All operations return { success: boolean, data?: any, message?: string }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Valid no-op updates return the existing object (idempotent)
 * 
 * DATA STORE CONTRACT:
 *   - window.data.missions is the source of truth
 *   - If window.data or window.data.missions is missing, operations return failure
 * 
 * DERIVED FIELD RULES:
 *   - progress: ALWAYS derived from objectives (never stored directly)
 *   - pay: ALWAYS derived from basePay + surchargePay
 *   - completedAt: Set when status becomes 'completed', cleared otherwise
 *   - Status is EXPLICITLY set by user (no auto-complete on checkbox click)
 * 
 * DEPENDENCIES:
 *   - window.MissionQueries (from mission-queries.js) - MANDATORY
 *   - window.MissionSchema (from mission-schema.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var Core = window.MissionCore;
 *   
 *   // Create mission
 *   var result = Core.createMission({ title: 'Operation Nightfall', ... });
 *   
 *   // Update mission
 *   var result = Core.updateMission('miss_123', { status: 'completed' });
 *   
 *   // Toggle objective
 *   var result = Core.toggleObjective('miss_123', 0);
 *   
 *   // Add support personnel
 *   var result = Core.addSupportPersonnel('miss_123', 'char_456');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.MissionQueries || typeof window.MissionQueries.getMission !== 'function') {
        missing.push('MissionQueries.getMission');
    }
    if (!window.MissionQueries || typeof window.MissionQueries.getMissions !== 'function') {
        missing.push('MissionQueries.getMissions');
    }

    if (!window.MissionSchema || typeof window.MissionSchema.validateMission !== 'function') {
        missing.push('MissionSchema.validateMission');
    }
    if (!window.MissionSchema || typeof window.MissionSchema.canonicaliseMissionShape !== 'function') {
        missing.push('MissionSchema.canonicaliseMissionShape');
    }
    if (!window.MissionSchema || typeof window.MissionSchema.VALID_STATUSES === 'undefined') {
        missing.push('MissionSchema.VALID_STATUSES');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (missing.length > 0) {
        throw new Error('[MissionCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__missionCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MissionQueries = window.MissionQueries;
    var MissionSchema = window.MissionSchema;
    var MutationPipeline = window.MutationPipeline;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = MissionSchema.VALID_STATUSES;
    var DEFAULT_STATUS = 'active';
    var DEFAULT_PRIORITY = 'medium';
    var DEFAULT_DIFFICULTY = 'medium';

    // ============================================================
    // HELPERS
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

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // DOMAIN RULE FUNCTIONS (formerly in mission-rules.js)
    // ============================================================

    /**
     * Calculate progress percentage from objectives.
     * 
     * @param {array} objectives - Array of objective objects
     * @returns {number} Progress percentage (0-100)
     */
    function calculateProgress(objectives) {
        if (!Array.isArray(objectives) || objectives.length === 0) {
            return 0;
        }

        var completed = 0;
        for (var i = 0; i < objectives.length; i++) {
            var objective = objectives[i];
            if (objective && objective.done) {
                completed++;
            }
        }

        return Math.round((completed / objectives.length) * 100);
    }

    /**
     * Parse a pay value from string or number.
     * Returns null for invalid values.
     * 
     * @param {*} value - Pay value to parse
     * @returns {number|null} Parsed number or null
     */
    function parsePayValue(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        var text = String(value).trim();
        var match = text.match(/^-?\d+(?:\.\d+)?$/);

        if (!match) {
            return null;
        }

        var num = Number(text);
        return Number.isFinite(num) ? num : null;
    }

    /**
     * Calculate total pay from base pay and surcharge pay.
     * 
     * @param {*} basePay - Base pay value
     * @param {*} surchargePay - Surcharge pay value
     * @returns {string} Formatted pay string or empty string
     */
    function calculatePay(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

        // Negative pay is rejected
        if (baseNum !== null && baseNum < 0) {
            return '';
        }
        if (surchargeNum !== null && surchargeNum < 0) {
            return '';
        }

        if (baseNum !== null && surchargeNum !== null) {
            return (baseNum + surchargeNum).toFixed(2) + ' credits';
        }

        if (baseNum !== null) {
            return baseNum.toFixed(2) + ' credits';
        }

        if (surchargeNum !== null) {
            return surchargeNum.toFixed(2) + ' credits';
        }

        return '';
    }

    /**
     * Calculate pay as a number (for comparisons).
     * 
     * @param {*} basePay - Base pay value
     * @param {*} surchargePay - Surcharge pay value
     * @returns {number|null} Total pay as number or null
     */
    function calculatePayNumber(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

        if (baseNum !== null && surchargeNum !== null) {
            return baseNum + surchargeNum;
        }

        if (baseNum !== null) {
            return baseNum;
        }

        if (surchargeNum !== null) {
            return surchargeNum;
        }

        return null;
    }

    /**
     * Check if a mission is ready for completion.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if all objectives are done
     */
    function isReadyForCompletion(mission) {
        if (!mission || typeof mission !== 'object') {
            return false;
        }

        if (mission.status === 'completed' || mission.status === 'cancelled') {
            return false;
        }

        var progress = mission.progress !== undefined ? mission.progress : calculateProgress(mission.objectives);
        return progress === 100;
    }

    /**
     * Determine the appropriate completedAt value based on status transition.
     * 
     * @param {string} originalStatus - Current status
     * @param {string} proposedStatus - Proposed status
     * @param {string|null} originalCompletedAt - Current completedAt value
     * @param {string} policy - 'first' or 'current' (default: 'current')
     * @returns {string|null} Appropriate completedAt value
     */
    function deriveCompletedAt(originalStatus, proposedStatus, originalCompletedAt, policy) {
        policy = policy || 'current';

        // If becoming completed
        if (proposedStatus === 'completed' && originalStatus !== 'completed') {
            return new Date().toISOString();
        }

        // If leaving completed
        if (proposedStatus !== 'completed' && originalStatus === 'completed') {
            if (policy === 'first') {
                return originalCompletedAt || null;
            }
            return null;
        }

        // Preserve existing
        return originalCompletedAt || null;
    }

    /**
     * Check if a status transition is valid.
     * 
     * @param {string} fromStatus - Current status
     * @param {string} toStatus - Proposed status
     * @returns {boolean} True if transition is valid
     */
    function isValidStatusTransition(fromStatus, toStatus) {
        if (fromStatus === toStatus) {
            return true;
        }

        // Allowed transitions:
        // active → completed, cancelled
        // completed → active
        // cancelled → active
        if (fromStatus === 'active' && (toStatus === 'completed' || toStatus === 'cancelled')) {
            return true;
        }

        if (fromStatus === 'completed' && toStatus === 'active') {
            return true;
        }

        if (fromStatus === 'cancelled' && toStatus === 'active') {
            return true;
        }

        return false;
    }

    /**
     * Get the valid status transitions for a given status.
     * 
     * @param {string} status - Current status
     * @returns {array} Array of valid target statuses
     */
    function getValidTransitions(status) {
        var result = [];
        for (var i = 0; i < VALID_STATUSES.length; i++) {
            if (isValidStatusTransition(status, VALID_STATUSES[i])) {
                result.push(VALID_STATUSES[i]);
            }
        }
        return result;
    }

    /**
     * Check if objectives can be modified for a mission.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if objectives can be modified
     */
    function canModifyObjectives(mission) {
        if (!mission || typeof mission !== 'object') {
            return false;
        }

        return mission.status !== 'completed' && mission.status !== 'cancelled';
    }

    /**
     * Check if a team is eligible for mission assignment.
     * 
     * @param {object} team - Team object
     * @returns {boolean} True if team is eligible
     */
    function isTeamEligibleForMission(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }

        // Only Professional and Temporary teams can be assigned missions
        if (team.type !== 'professional' && team.type !== 'temporary') {
            return false;
        }

        // Team must be active
        if (team.status !== 'active') {
            return false;
        }

        return true;
    }

    /**
     * Filter teams to only those eligible for mission assignment.
     * 
     * @param {array} teams - Array of team objects
     * @returns {array} Filtered array of eligible teams
     */
    function filterEligibleTeams(teams) {
        if (!Array.isArray(teams)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (isTeamEligibleForMission(teams[i])) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    /**
     * Recalculate all derived fields for a mission.
     * Pure function - returns a new mission object with derived fields updated.
     * 
     * @param {object} mission - Mission object
     * @param {string} completedAtPolicy - 'first' or 'current' (default: 'current')
     * @returns {object} Mission with derived fields recalculated
     */
    function recalculateMission(mission, completedAtPolicy) {
        completedAtPolicy = completedAtPolicy || 'current';

        if (!mission || typeof mission !== 'object') {
            return mission;
        }

        var result = deepClone(mission);
        if (result === null) {
            return mission;
        }

        // Recalculate progress from objectives
        result.progress = calculateProgress(result.objectives);

        // Recalculate pay from basePay and surchargePay
        result.pay = calculatePay(result.basePay, result.surchargePay);

        // NOTE: Status is NOT auto-derived from progress.
        // Status changes are EXPLICIT user actions.
        // This function only derives progress and pay.

        return result;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateStatus(status) {
        if (VALID_STATUSES.indexOf(status) === -1) {
            return { valid: false, message: 'Invalid status. Must be one of: ' + VALID_STATUSES.join(', ') };
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
        var validDifficulties = ['easy', 'medium', 'hard', 'expert'];
        if (validDifficulties.indexOf(difficulty) === -1) {
            return { valid: false, message: 'Invalid difficulty. Must be one of: ' + validDifficulties.join(', ') };
        }
        return { valid: true };
    }

    function validateTeamId(teamId) {
        if (!teamId) {
            return { valid: true }; // Null/undefined is allowed
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return { valid: false, message: 'Team not found.' };
        }
        if (!isTeamEligibleForMission(team)) {
            return { valid: false, message: 'Team is not eligible for mission assignment.' };
        }
        return { valid: true, team: team };
    }

    function validateCharacterId(characterId) {
        if (!characterId) {
            return { valid: false, message: 'Character ID is required.' };
        }
        var character = CharacterQueries.getCharacterById(characterId);
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
    // GET MISSION (delegates to Queries)
    // ============================================================

    /**
     * Get a mission by ID.
     * Delegates to MissionQueries.
     * 
     * @param {string} id - Mission ID
     * @returns {object|null} Mission object or null
     */
    function getMission(id) {
        return MissionQueries.getMission(id);
    }

    /**
     * Get all missions.
     * Delegates to MissionQueries.
     * 
     * @param {string} filter - Status filter
     * @returns {array} Array of mission objects
     */
    function getMissions(filter) {
        return MissionQueries.getMissions(filter);
    }

    // ============================================================
    // CRUD OPERATIONS - Using MutationPipeline
    // ============================================================

    /**
     * Create a new mission.
     * 
     * @param {object} data - Mission data
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function createMission(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isObject(data)) {
            return Promise.resolve(failure('Mission data is required.'));
        }

        if (!isNonEmptyString(data.title)) {
            return Promise.resolve(failure('Mission title is required.'));
        }

        // Validate team
        var teamResult = validateTeamId(data.assignedTeamId);
        if (!teamResult.valid) {
            return Promise.resolve(failure(teamResult.message));
        }

        // Validate status
        var status = data.status || DEFAULT_STATUS;
        var statusResult = validateStatus(status);
        if (!statusResult.valid) {
            return Promise.resolve(failure(statusResult.message));
        }

        // Validate priority
        var priority = data.priority || DEFAULT_PRIORITY;
        var priorityResult = validatePriority(priority);
        if (!priorityResult.valid) {
            return Promise.resolve(failure(priorityResult.message));
        }

        // Validate difficulty
        var difficulty = data.difficulty || DEFAULT_DIFFICULTY;
        var difficultyResult = validateDifficulty(difficulty);
        if (!difficultyResult.valid) {
            return Promise.resolve(failure(difficultyResult.message));
        }

        // Validate objectives
        var objectives = Array.isArray(data.objectives) ? data.objectives : [];
        for (var i = 0; i < objectives.length; i++) {
            var objResult = validateObjective(objectives[i]);
            if (!objResult.valid) {
                return Promise.resolve(failure('Objective ' + (i + 1) + ': ' + objResult.message));
            }
        }

        // ---- PHASE 2: BUILD MISSION DATA ----
        var now = new Date().toISOString();

        var missionData = {
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
            pay: '',
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
            log: [],
            graduatingClassId: data.graduatingClassId || null,
            classFilterEnabled: data.classFilterEnabled || false
        };

        // ---- PHASE 3: CANONICALISE ----
        var canonical = MissionSchema.canonicaliseMissionShape(missionData);
        if (!canonical.valid) {
            return Promise.resolve(failure('Validation failed: ' + canonical.errors.join(', ')));
        }

        var validatedData = canonical.value;

        // ---- PHASE 4: RECALCULATE DERIVED FIELDS ----
        var recalculated = recalculateMission(validatedData);
        if (recalculated) {
            validatedData = recalculated;
        }

        // ---- PHASE 5: MUTATION VIA PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function() {
                // Verify data store is available
                var dataStore = getDataStore();
                if (!dataStore) {
                    return { valid: false, message: 'Data store is not available.' };
                }

                // Verify mission doesn't already exist (by ID)
                var existing = MissionQueries.getMission(validatedData.id);
                if (existing) {
                    return { valid: false, message: 'Mission with this ID already exists.' };
                }

                return { valid: true };
            },

            mutate: function() {
                var dataStore = getDataStore();
                if (!dataStore) {
                    throw new Error('Data store is not available.');
                }

                if (!Array.isArray(dataStore.missions)) {
                    dataStore.missions = [];
                }

                dataStore.missions.push(deepClone(validatedData));

                return {
                    mission: validatedData,
                    id: validatedData.id
                };
            },

            logMessage: 'Created mission: ' + validatedData.title,
            successMessage: 'Mission created successfully!',
            failureMessage: 'Failed to create mission.'
        });
    }

    /**
     * Update an existing mission.
     * 
     * @param {string} id - Mission ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function updateMission(id, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates must be an object with at least one field.'));
        }

        // ---- PHASE 2: GET EXISTING ----
        var existing = MissionQueries.getMission(id);
        if (!existing) {
            return Promise.resolve(failure('Mission not found.'));
        }

        // ---- PHASE 3: VALIDATE UPDATES ----
        if (updates.status !== undefined) {
            var statusResult = validateStatus(updates.status);
            if (!statusResult.valid) {
                return Promise.resolve(failure(statusResult.message));
            }
            if (!isValidStatusTransition(existing.status, updates.status)) {
                return Promise.resolve(failure('Invalid status transition from "' + existing.status + '" to "' + updates.status + '".'));
            }
        }

        if (updates.priority !== undefined) {
            var priorityResult = validatePriority(updates.priority);
            if (!priorityResult.valid) {
                return Promise.resolve(failure(priorityResult.message));
            }
        }

        if (updates.difficulty !== undefined) {
            var difficultyResult = validateDifficulty(updates.difficulty);
            if (!difficultyResult.valid) {
                return Promise.resolve(failure(difficultyResult.message));
            }
        }

        if (updates.assignedTeamId !== undefined) {
            var teamResult = validateTeamId(updates.assignedTeamId);
            if (!teamResult.valid) {
                return Promise.resolve(failure(teamResult.message));
            }
        }

        if (updates.supportPersonnel !== undefined) {
            if (!Array.isArray(updates.supportPersonnel)) {
                return Promise.resolve(failure('Support personnel must be an array.'));
            }
            for (var i = 0; i < updates.supportPersonnel.length; i++) {
                var charResult = validateCharacterId(updates.supportPersonnel[i]);
                if (!charResult.valid) {
                    return Promise.resolve(failure('Invalid support personnel: ' + charResult.message));
                }
            }
        }

        if (updates.objectives !== undefined) {
            if (!Array.isArray(updates.objectives)) {
                return Promise.resolve(failure('Objectives must be an array.'));
            }
            if (!canModifyObjectives(existing)) {
                return Promise.resolve(failure('Cannot modify objectives for a ' + existing.status + ' mission.'));
            }
            for (var j = 0; j < updates.objectives.length; j++) {
                var objResult = validateObjective(updates.objectives[j]);
                if (!objResult.valid) {
                    return Promise.resolve(failure('Objective ' + (j + 1) + ': ' + objResult.message));
                }
            }
        }

        if (updates.title !== undefined && !isNonEmptyString(updates.title)) {
            return Promise.resolve(failure('Mission title cannot be empty.'));
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone mission data.'));
        }

        var statusChanged = false;
        var originalStatus = candidate.status;

        // Apply updates
        if (updates.title !== undefined) {
            candidate.title = updates.title.trim();
        }

        if (updates.description !== undefined) {
            candidate.description = updates.description || '';
        }

        if (updates.status !== undefined) {
            candidate.status = updates.status;
            statusChanged = true;
        }

        if (updates.priority !== undefined) {
            candidate.priority = updates.priority;
        }

        if (updates.difficulty !== undefined) {
            candidate.difficulty = updates.difficulty;
        }

        if (updates.assignedTeamId !== undefined) {
            candidate.assignedTeamId = updates.assignedTeamId || null;
        }

        if (updates.location !== undefined) {
            candidate.location = updates.location || '';
        }

        if (updates.duration !== undefined) {
            candidate.duration = updates.duration || '';
        }

        if (updates.basePay !== undefined) {
            candidate.basePay = updates.basePay || '';
        }

        if (updates.surchargePay !== undefined) {
            candidate.surchargePay = updates.surchargePay || '';
        }

        if (updates.notes !== undefined) {
            candidate.notes = updates.notes || '';
        }

        if (updates.tags !== undefined) {
            candidate.tags = Array.isArray(updates.tags) ? updates.tags.slice() : [];
        }

        if (updates.supportPersonnel !== undefined) {
            candidate.supportPersonnel = updates.supportPersonnel.slice();
        }

        if (updates.objectives !== undefined) {
            candidate.objectives = updates.objectives.map(function(obj) {
                return {
                    text: obj.text.trim(),
                    done: obj.done === true
                };
            });
        }

        // Handle completedAt
        if (statusChanged) {
            candidate.completedAt = deriveCompletedAt(originalStatus, candidate.status, candidate.completedAt);
        }

        // ---- PHASE 5: RECALCULATE DERIVED FIELDS ----
        var recalculated = recalculateMission(candidate);
        if (recalculated) {
            candidate = recalculated;
        }

        // ---- PHASE 6: STRUCTURAL VALIDATION ----
        var validation = MissionSchema.validateMission(candidate);
        if (!validation.valid) {
            return Promise.resolve(failure('Validation failed: ' + validation.errors.join(', ')));
        }

        // ---- PHASE 7: MUTATION VIA PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function() {
                // Verify mission still exists
                var current = MissionQueries.getMission(id);
                if (!current) {
                    return { valid: false, message: 'Mission no longer exists.' };
                }

                // Verify data store is available
                var dataStore = getDataStore();
                if (!dataStore) {
                    return { valid: false, message: 'Data store is not available.' };
                }

                return { valid: true };
            },

            mutate: function() {
                var dataStore = getDataStore();
                if (!dataStore || !Array.isArray(dataStore.missions)) {
                    throw new Error('Data store is not available.');
                }

                var foundIndex = -1;
                for (var i = 0; i < dataStore.missions.length; i++) {
                    if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(id)) {
                        foundIndex = i;
                        break;
                    }
                }

                if (foundIndex === -1) {
                    throw new Error('Mission not found in data store.');
                }

                dataStore.missions[foundIndex] = deepClone(candidate);

                return {
                    mission: candidate,
                    id: id,
                    changed: true
                };
            },

            logMessage: function() {
                return 'Updated mission: ' + candidate.title;
            },
            successMessage: 'Mission updated successfully!',
            failureMessage: 'Failed to update mission.'
        });
    }

    /**
     * Delete a mission.
     * 
     * @param {string} id - Mission ID
     * @returns {Promise<{ success: boolean, message?: string }>}
     */
    function deleteMission(id) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var existing = MissionQueries.getMission(id);
        if (!existing) {
            return Promise.resolve(failure('Mission not found.'));
        }

        var title = existing.title;

        return MutationPipeline.performMutation({
            validate: function() {
                var current = MissionQueries.getMission(id);
                if (!current) {
                    return { valid: false, message: 'Mission no longer exists.' };
                }

                var dataStore = getDataStore();
                if (!dataStore) {
                    return { valid: false, message: 'Data store is not available.' };
                }

                return { valid: true };
            },

            mutate: function() {
                var dataStore = getDataStore();
                if (!dataStore || !Array.isArray(dataStore.missions)) {
                    throw new Error('Data store is not available.');
                }

                var foundIndex = -1;
                for (var i = 0; i < dataStore.missions.length; i++) {
                    if (dataStore.missions[i] && String(dataStore.missions[i].id) === String(id)) {
                        foundIndex = i;
                        break;
                    }
                }

                if (foundIndex === -1) {
                    throw new Error('Mission not found in data store.');
                }

                dataStore.missions.splice(foundIndex, 1);

                return { deleted: true, id: id };
            },

            logMessage: 'Deleted mission: ' + title,
            successMessage: 'Mission deleted successfully!',
            failureMessage: 'Failed to delete mission.'
        });
    }

    // ============================================================
    // STATUS OPERATIONS
    // ============================================================

    /**
     * Complete a mission.
     * 
     * @param {string} id - Mission ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function completeMission(id) {
        return updateMission(id, { status: 'completed' });
    }

    /**
     * Cancel a mission.
     * 
     * @param {string} id - Mission ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function cancelMission(id) {
        return updateMission(id, { status: 'cancelled' });
    }

    /**
     * Reactivate a mission.
     * 
     * @param {string} id - Mission ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function reactivateMission(id) {
        return updateMission(id, { status: 'active' });
    }

    // ============================================================
    // OBJECTIVE OPERATIONS
    // ============================================================

    /**
     * Toggle an objective's done status.
     * 
     * @param {string} missionId - Mission ID
     * @param {number} index - Objective index
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function toggleObjective(missionId, index) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        if (!Array.isArray(mission.objectives) || mission.objectives.length === 0) {
            return Promise.resolve(failure('Mission has no objectives.'));
        }

        if (index < 0 || index >= mission.objectives.length) {
            return Promise.resolve(failure('Objective index out of range.'));
        }

        if (!canModifyObjectives(mission)) {
            return Promise.resolve(failure('Cannot modify objectives for a ' + mission.status + ' mission.'));
        }

        var objectives = mission.objectives.slice();
        objectives[index] = {
            text: objectives[index].text,
            done: !objectives[index].done
        };

        return updateMission(missionId, { objectives: objectives });
    }

    /**
     * Add an objective to a mission.
     * 
     * @param {string} missionId - Mission ID
     * @param {string} text - Objective text
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addObjective(missionId, text) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        if (!isNonEmptyString(text)) {
            return Promise.resolve(failure('Objective text is required.'));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        if (!canModifyObjectives(mission)) {
            return Promise.resolve(failure('Cannot modify objectives for a ' + mission.status + ' mission.'));
        }

        var objectives = Array.isArray(mission.objectives) ? mission.objectives.slice() : [];
        objectives.push({ text: text.trim(), done: false });

        return updateMission(missionId, { objectives: objectives });
    }

    /**
     * Remove an objective from a mission.
     * 
     * @param {string} missionId - Mission ID
     * @param {number} index - Objective index
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeObjective(missionId, index) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        if (!Array.isArray(mission.objectives) || mission.objectives.length === 0) {
            return Promise.resolve(failure('Mission has no objectives.'));
        }

        if (index < 0 || index >= mission.objectives.length) {
            return Promise.resolve(failure('Objective index out of range.'));
        }

        if (!canModifyObjectives(mission)) {
            return Promise.resolve(failure('Cannot modify objectives for a ' + mission.status + ' mission.'));
        }

        var objectives = mission.objectives.slice();
        objectives.splice(index, 1);

        return updateMission(missionId, { objectives: objectives });
    }

    // ============================================================
    // SUPPORT PERSONNEL OPERATIONS
    // ============================================================

    /**
     * Add support personnel to a mission.
     * 
     * @param {string} missionId - Mission ID
     * @param {string} characterId - Character ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addSupportPersonnel(missionId, characterId) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var charResult = validateCharacterId(characterId);
        if (!charResult.valid) {
            return Promise.resolve(failure(charResult.message));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        var personnel = Array.isArray(mission.supportPersonnel) ? mission.supportPersonnel.slice() : [];

        // Check if already added
        for (var i = 0; i < personnel.length; i++) {
            if (String(personnel[i]) === String(characterId)) {
                return Promise.resolve(failure('Character is already assigned as support personnel.'));
            }
        }

        personnel.push(characterId);

        return updateMission(missionId, { supportPersonnel: personnel });
    }

    /**
     * Remove support personnel from a mission.
     * 
     * @param {string} missionId - Mission ID
     * @param {string} characterId - Character ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeSupportPersonnel(missionId, characterId) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        var personnel = Array.isArray(mission.supportPersonnel) ? mission.supportPersonnel.slice() : [];

        var found = false;
        var newPersonnel = [];
        for (var i = 0; i < personnel.length; i++) {
            if (String(personnel[i]) === String(characterId)) {
                found = true;
            } else {
                newPersonnel.push(personnel[i]);
            }
        }

        if (!found) {
            return Promise.resolve(failure('Character is not assigned as support personnel.'));
        }

        return updateMission(missionId, { supportPersonnel: newPersonnel });
    }

    // ============================================================
    // LOG OPERATIONS
    // ============================================================

    /**
     * Add a log entry to a mission.
     * 
     * @param {string} missionId - Mission ID
     * @param {string} message - Log message
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addLog(missionId, message) {
        if (!isNonEmptyString(missionId)) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        if (!isNonEmptyString(message)) {
            return Promise.resolve(failure('Log message is required.'));
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return Promise.resolve(failure('Mission not found.'));
        }

        var log = Array.isArray(mission.log) ? mission.log.slice() : [];
        log.push({
            timestamp: new Date().toISOString(),
            message: message.trim()
        });

        return updateMission(missionId, { log: log });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCore = {
        // ---- Query functions (delegate to Queries) ----
        getMission: getMission,
        getMissions: getMissions,

        // ---- CRUD ----
        createMission: createMission,
        updateMission: updateMission,
        deleteMission: deleteMission,

        // ---- Status ----
        completeMission: completeMission,
        cancelMission: cancelMission,
        reactivateMission: reactivateMission,

        // ---- Objectives ----
        toggleObjective: toggleObjective,
        addObjective: addObjective,
        removeObjective: removeObjective,

        // ---- Support Personnel ----
        addSupportPersonnel: addSupportPersonnel,
        removeSupportPersonnel: removeSupportPersonnel,

        // ---- Log ----
        addLog: addLog,

        // ---- Domain Rules (pure functions) ----
        calculateProgress: calculateProgress,
        parsePayValue: parsePayValue,
        calculatePay: calculatePay,
        calculatePayNumber: calculatePayNumber,
        isReadyForCompletion: isReadyForCompletion,
        deriveCompletedAt: deriveCompletedAt,
        isValidStatusTransition: isValidStatusTransition,
        getValidTransitions: getValidTransitions,
        canModifyObjectives: canModifyObjectives,
        isTeamEligibleForMission: isTeamEligibleForMission,
        filterEligibleTeams: filterEligibleTeams,
        recalculateMission: recalculateMission,

        // ---- Validation (exposed for external use) ----
        validateStatus: validateStatus,
        validatePriority: validatePriority,
        validateDifficulty: validateDifficulty,
        validateTeamId: validateTeamId,
        validateCharacterId: validateCharacterId,
        validateObjective: validateObjective,

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_PRIORITY: DEFAULT_PRIORITY,
        DEFAULT_DIFFICULTY: DEFAULT_DIFFICULTY
    };

})();♥
