/**
 * js/modules/missions/missions-core.js - Mission Core Operations
 * CANONICAL mutation API for missions.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence via MutationUtils
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: all or nothing
 *   - Uses MissionsSchema for validation
 *   - Uses MissionRules for derivation
 *   - Uses MissionsQueries for read access
 *   - Internal `id` is immutable; `missionId` is derived/human-readable
 *   - Mutations build complete proposed state before committing
 *   - Derived fields (progress, pay, completedAt) are CALCULATED, never accepted as input
 *   - Only whitelisted fields are updateable via updateMission()
 *   - undefined values are ignored; null values explicitly clear fields
 * 
 * UPDATEABLE FIELDS (whitelist):
 *   title, description, year, month, day, primaryType, subtype,
 *   secondaryType, escalation, threatType, environment, location,
 *   duration, difficulty, priority, basePay, surchargePay, billing,
 *   assignedTeamId, supportPersonnel, status, objectives, notes, tags
 * 
 * DERIVED FIELDS (calculated, never accepted as input):
 *   id, missionId, pay, progress, completedAt, createdAt, log
 * 
 * LIFECYCLE RULES:
 *   - Active mission with 100% progress auto-completes (creation AND update)
 *   - Completed/Cancelled missions: status can be manually changed, but objectives are frozen
 *   - Objective modifications are rejected for completed/cancelled missions
 *   - Cannot modify objectives in the same transaction that sets status to completed/cancelled
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - This module does NOT log activity
 *   - MutationUtils owns persistence and activity logging
 * 
 * DEPENDENCIES:
 *   - window.MissionsSchema (required)
 *   - window.MissionRules (required)
 *   - window.MissionsQueries (required)
 *   - window.CharacterQueries (required)
 *   - window.TeamQueries (required)
 *   - window.IdUtils (required)
 *   - window.ObjectUtils (required)
 */

(function() {
    'use strict';

    if (window.__missionsCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.MissionsSchema) {
        missing.push('MissionsSchema');
    }

    if (!window.MissionRules) {
        missing.push('MissionRules');
    }

    if (!window.MissionsQueries) {
        missing.push('MissionsQueries');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }
    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__missionsCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Schema = window.MissionsSchema;
    var Rules = window.MissionRules;
    var Queries = window.MissionsQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MUTABLE_FIELDS = Object.freeze([
        'title',
        'description',
        'year',
        'month',
        'day',
        'primaryType',
        'subtype',
        'secondaryType',
        'escalation',
        'threatType',
        'environment',
        'location',
        'duration',
        'difficulty',
        'priority',
        'basePay',
        'surchargePay',
        'billing',
        'assignedTeamId',
        'supportPersonnel',
        'status',
        'objectives',
        'notes',
        'tags'
    ]);

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateInternalId(prefix) {
        return IdUtils.generateId(prefix || 'miss');
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function commitMission(id, proposed) {
        var store = getDataStore();
        if (!store || !Array.isArray(store.missions)) {
            return null;
        }

        var target = normaliseId(id);
        if (target === null) {
            return null;
        }

        var index = -1;
        for (var i = 0; i < store.missions.length; i++) {
            var m = store.missions[i];
            if (m && normaliseId(m.id) === target) {
                index = i;
                break;
            }
        }

        if (index === -1) {
            return null;
        }

        store.missions[index] = proposed;

        return deepClone(proposed);
    }

    function validateTeamReference(teamId) {
        if (!teamId) {
            return true;
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return false;
        }
        return Rules.isTeamEligibleForMission(team);
    }

    function areObjectivesMutable(mission) {
        return Rules.canModifyObjectives(mission);
    }

    function canModifyObjectivesWithTransition(originalStatus, proposedStatus, hasObjectiveUpdate) {
        return Rules.canModifyObjectivesWithTransition(originalStatus, proposedStatus, hasObjectiveUpdate);
    }

    function cloneMission(mission) {
        if (!mission) {
            return null;
        }
        return deepClone(mission);
    }

    // ============================================================
    // MISSION ID GENERATION - Delegates to MissionId
    // ============================================================

    function generateMissionId(teamId, year, difficulty, existingIds) {
        if (!window.MissionId || typeof window.MissionId.generateMissionId !== 'function') {
            // Fallback for backward compatibility during migration
            var defaultId = generateInternalId('miss') + '-ID';
            return defaultId;
        }
        return window.MissionId.generateMissionId(teamId, year, difficulty, existingIds);
    }

    function getExistingMissionIds() {
        var missions = Queries.getMissions('all');
        var ids = [];
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.missionId && typeof m.missionId === 'string') {
                ids.push(m.missionId);
            }
        }
        return ids;
    }

    // ============================================================
    // CORE API
    // ============================================================

    var MissionsCore = {
        /**
         * Create a new mission.
         * Validates all inputs before mutation.
         * Atomic: builds complete proposed state before committing.
         * Derived fields (progress, pay, completedAt) are CALCULATED.
         * 
         * @param {object} data - Mission data
         * @returns {object|null} Created mission or null if invalid
         */
        createMission: function(data) {
            if (!data || typeof data !== 'object') {
                return null;
            }

            // ---- PHASE 1: CANONICALISE INPUT ----
            var canonical = Schema.canonicaliseMissionShape(data);
            if (!canonical.valid) {
                return null;
            }

            var normalised = canonical.value;
            if (!normalised) {
                return null;
            }

            // ---- PHASE 2: VALIDATE TEAM REFERENCE ----
            if (!validateTeamReference(normalised.assignedTeamId)) {
                return null;
            }

            // ---- PHASE 3: CALCULATE DERIVED FIELDS ----
            var objectives = normalised.objectives || [];
            var progress = Rules.calculateProgress(objectives);
            var status = normalised.status || 'active';

            if (progress === 100 && status === 'active') {
                status = 'completed';
            }

            var pay = Rules.calculatePay(normalised.basePay, normalised.surchargePay);

            // ---- PHASE 4: GENERATE MISSION ID ----
            var existingIds = getExistingMissionIds();
            var missionId = generateMissionId(
                normalised.assignedTeamId,
                normalised.year || new Date().getFullYear(),
                normalised.difficulty,
                existingIds
            );

            // ---- PHASE 5: BUILD COMPLETE MISSION ----
            var mission = {
                id: generateInternalId('miss'),
                missionId: missionId,
                title: normalised.title,
                description: normalised.description || '',
                year: normalised.year,
                month: normalised.month,
                day: normalised.day,
                primaryType: normalised.primaryType || '',
                subtype: normalised.subtype || '',
                secondaryType: normalised.secondaryType || '',
                escalation: normalised.escalation || 'tier_ii',
                threatType: normalised.threatType || '',
                environment: normalised.environment || '',
                location: normalised.location || '',
                duration: normalised.duration || '',
                difficulty: normalised.difficulty || 'medium',
                priority: normalised.priority || 'medium',
                basePay: normalised.basePay || '',
                surchargePay: normalised.surchargePay || '',
                pay: pay,
                billing: normalised.billing || 'original',
                assignedTeamId: normalised.assignedTeamId || null,
                supportPersonnel: normalised.supportPersonnel || [],
                status: status,
                objectives: objectives,
                progress: progress,
                notes: normalised.notes || '',
                tags: normalised.tags || [],
                createdAt: new Date().toISOString(),
                completedAt: status === 'completed' ? new Date().toISOString() : null,
                log: [],
                graduatingClassId: normalised.graduatingClassId || null,
                classFilterEnabled: normalised.classFilterEnabled !== false
            };

            // ---- PHASE 6: VALIDATE MISSION ----
            var validation = Schema.validateMission(mission);
            if (!validation.valid) {
                return null;
            }

            // ---- PHASE 7: COMMIT ----
            var store = getDataStore();
            if (!store) {
                if (!window.data) {
                    window.data = {};
                }
                if (!window.data.missions) {
                    window.data.missions = [];
                }
                window.data.missions.push(mission);
            } else {
                if (!store.missions) {
                    store.missions = [];
                }
                store.missions.push(mission);
            }

            return deepClone(mission);
        },

        /**
         * Update an existing mission.
         * Atomic: builds complete proposed state before committing.
         * Validates all inputs before mutation.
         * Only whitelisted fields are updateable.
         * Derived fields are CALCULATED, never accepted as input.
         * undefined values are ignored; null values explicitly clear fields.
         * 
         * @param {string} id - Internal mission ID
         * @param {object} updates - Fields to update (must be in MUTABLE_FIELDS)
         * @returns {object|null} Updated mission or null if invalid
         */
        updateMission: function(id, updates) {
            var original = Queries.getMission(id);
            if (!original) {
                return null;
            }

            if (!updates || typeof updates !== 'object') {
                return null;
            }

            // ---- PHASE 1: FILTER TO ONLY MUTABLE FIELDS ----
            var validUpdates = {};
            var keys = Object.keys(updates);
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                if (MUTABLE_FIELDS.indexOf(key) !== -1 && updates[key] !== undefined) {
                    validUpdates[key] = updates[key];
                }
            }

            if (Object.keys(validUpdates).length === 0) {
                return deepClone(original);
            }

            // ---- PHASE 2: CHECK OBJECTIVES MUTABILITY ----
            var proposedStatus = validUpdates.status !== undefined
                ? validUpdates.status
                : original.status;

            if (!canModifyObjectivesWithTransition(
                original.status,
                proposedStatus,
                validUpdates.objectives !== undefined
            )) {
                return null;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var proposed = deepClone(original);

            var updateKeys = Object.keys(validUpdates);
            for (var uk = 0; uk < updateKeys.length; uk++) {
                var key2 = updateKeys[uk];
                var value = validUpdates[key2];

                if (value === null) {
                    // Clear field based on type
                    if (key2 === 'assignedTeamId') {
                        proposed.assignedTeamId = null;
                    } else if (key2 === 'supportPersonnel') {
                        proposed.supportPersonnel = [];
                    } else if (key2 === 'tags') {
                        proposed.tags = [];
                    } else if (key2 === 'objectives') {
                        proposed.objectives = [];
                    } else if (key2 === 'notes' || key2 === 'description') {
                        proposed[key2] = '';
                    } else {
                        proposed[key2] = '';
                    }
                } else {
                    proposed[key2] = validUpdates[key2];
                }
            }

            // ---- PHASE 4: VALIDATE TEAM REFERENCE ----
            if (proposed.assignedTeamId && !validateTeamReference(proposed.assignedTeamId)) {
                return null;
            }

            // ---- PHASE 5: NORMALISE OBJECTIVES ----
            if (Array.isArray(proposed.objectives)) {
                var cleanedObjectives = [];
                for (var oi = 0; oi < proposed.objectives.length; oi++) {
                    var o = proposed.objectives[oi];
                    if (!o || typeof o !== 'object') {
                        continue;
                    }
                    var text = String(o.text || '').trim();
                    if (text) {
                        cleanedObjectives.push({
                            text: text,
                            done: !!o.done
                        });
                    }
                }
                proposed.objectives = cleanedObjectives;
            }

            // ---- PHASE 6: RECALCULATE DERIVED FIELDS ----
            proposed.progress = Rules.calculateProgress(proposed.objectives);
            proposed.pay = Rules.calculatePay(proposed.basePay, proposed.surchargePay);

            // ---- PHASE 7: MISSION ID REGENERATION ----
            var originalTeamId = normaliseId(original.assignedTeamId);
            var proposedTeamId = normaliseId(proposed.assignedTeamId);

            var shouldRegenerateId =
                originalTeamId !== proposedTeamId ||
                original.year !== proposed.year ||
                original.difficulty !== proposed.difficulty;

            if (shouldRegenerateId) {
                var existingIds = getExistingMissionIds();
                // Remove the current mission ID from existing IDs to avoid self-collision
                var filteredIds = [];
                for (var fi = 0; fi < existingIds.length; fi++) {
                    if (existingIds[fi] !== original.missionId) {
                        filteredIds.push(existingIds[fi]);
                    }
                }
                var newId = generateMissionId(
                    proposed.assignedTeamId,
                    proposed.year || new Date().getFullYear(),
                    proposed.difficulty,
                    filteredIds
                );
                if (newId && newId !== proposed.missionId) {
                    proposed.missionId = newId;
                }
            }

            // ---- PHASE 8: STATUS AND COMPLETED AT ----
            // Derive status from progress
            var derivedStatus = Rules.deriveStatus(proposed.status, proposed.progress, proposed.objectives);

            // Apply completedAt rules
            proposed.completedAt = Rules.deriveCompletedAt(
                original.status,
                derivedStatus,
                original.completedAt,
                proposed.progress,
                'current'
            );

            proposed.status = derivedStatus;

            // ---- PHASE 9: VALIDATE PROPOSED STATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            // ---- PHASE 10: COMMIT ----
            var committed = commitMission(id, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Delete a mission permanently.
         * 
         * @param {string} id - Internal mission ID
         * @returns {boolean} Success
         */
        deleteMission: function(id) {
            var mission = Queries.getMission(id);
            if (!mission) {
                return false;
            }

            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) {
                return false;
            }

            var target = normaliseId(id);
            var index = -1;
            for (var i = 0; i < store.missions.length; i++) {
                var m = store.missions[i];
                if (m && normaliseId(m.id) === target) {
                    index = i;
                    break;
                }
            }

            if (index === -1) {
                return false;
            }

            store.missions.splice(index, 1);

            return true;
        },

        /**
         * Toggle an objective's done status.
         * Atomic: validates and recalculates progress.
         * Completed/cancelled missions cannot be modified.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {number} objectiveIndex - Index of objective to toggle
         * @returns {object|null} Updated mission or null if invalid
         */
        toggleObjective: function(missionId, objectiveIndex) {
            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            var proposed = deepClone(mission);
            proposed.objectives[objectiveIndex].done = !proposed.objectives[objectiveIndex].done;

            // ---- Recalculate derived fields ----
            proposed.progress = Rules.calculateProgress(proposed.objectives);

            var derivedStatus = Rules.deriveStatus(proposed.status, proposed.progress, proposed.objectives);

            proposed.completedAt = Rules.deriveCompletedAt(
                mission.status,
                derivedStatus,
                mission.completedAt,
                proposed.progress,
                'current'
            );

            proposed.status = derivedStatus;

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Add an objective to a mission.
         * Rejects empty text.
         * Completed/cancelled missions cannot be modified.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {string} text - Objective text
         * @returns {object|null} Updated mission or null if invalid
         */
        addObjective: function(missionId, text) {
            var cleanText = String(text || '').trim();
            if (!cleanText) {
                return null;
            }

            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            var proposed = deepClone(mission);
            proposed.objectives.push({
                text: cleanText,
                done: false
            });

            // ---- Recalculate derived fields ----
            proposed.progress = Rules.calculateProgress(proposed.objectives);

            var derivedStatus = Rules.deriveStatus(proposed.status, proposed.progress, proposed.objectives);

            proposed.completedAt = Rules.deriveCompletedAt(
                mission.status,
                derivedStatus,
                mission.completedAt,
                proposed.progress,
                'current'
            );

            proposed.status = derivedStatus;

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Remove an objective from a mission.
         * Completed/cancelled missions cannot be modified.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {number} objectiveIndex - Index of objective to remove
         * @returns {object|null} Updated mission or null if invalid
         */
        removeObjective: function(missionId, objectiveIndex) {
            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            var proposed = deepClone(mission);
            proposed.objectives.splice(objectiveIndex, 1);

            // ---- Recalculate derived fields ----
            proposed.progress = Rules.calculateProgress(proposed.objectives);

            var derivedStatus = Rules.deriveStatus(proposed.status, proposed.progress, proposed.objectives);

            proposed.completedAt = Rules.deriveCompletedAt(
                mission.status,
                derivedStatus,
                mission.completedAt,
                proposed.progress,
                'current'
            );

            proposed.status = derivedStatus;

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Add a log entry to a mission.
         * Rejects empty messages.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {string} message - Log message
         * @returns {object|null} Updated mission or null if invalid
         */
        addLog: function(missionId, message) {
            var cleanMessage = String(message || '').trim();
            if (!cleanMessage) {
                return null;
            }

            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            var proposed = deepClone(mission);
            if (!proposed.log) {
                proposed.log = [];
            }
            proposed.log.push({
                timestamp: new Date().toISOString(),
                message: cleanMessage
            });

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Add support personnel to a mission.
         * Validates that the character exists.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {string} characterId - Character ID
         * @returns {object|null} Updated mission or null if invalid
         */
        addSupportPersonnel: function(missionId, characterId) {
            var target = normaliseId(characterId);
            if (target === null) {
                return null;
            }

            var character = CharacterQueries.getCharacterById(target);
            if (!character) {
                return null;
            }

            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            var proposed = deepClone(mission);
            if (!proposed.supportPersonnel) {
                proposed.supportPersonnel = [];
            }

            var exists = false;
            for (var i = 0; i < proposed.supportPersonnel.length; i++) {
                if (normaliseId(proposed.supportPersonnel[i]) === target) {
                    exists = true;
                    break;
                }
            }

            if (exists) {
                return deepClone(mission);
            }

            proposed.supportPersonnel.push(target);

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Remove support personnel from a mission.
         * 
         * @param {string} missionId - Internal mission ID
         * @param {string} characterId - Character ID
         * @returns {object|null} Updated mission or null if invalid
         */
        removeSupportPersonnel: function(missionId, characterId) {
            var target = normaliseId(characterId);
            if (target === null) {
                return null;
            }

            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!mission.supportPersonnel) {
                return deepClone(mission);
            }

            var proposed = deepClone(mission);
            var newSupport = [];
            for (var i = 0; i < proposed.supportPersonnel.length; i++) {
                if (normaliseId(proposed.supportPersonnel[i]) !== target) {
                    newSupport.push(proposed.supportPersonnel[i]);
                }
            }
            proposed.supportPersonnel = newSupport;

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Complete a mission.
         * This is a domain command - sets status to completed and recalculates derived fields.
         * 
         * @param {string} missionId - Internal mission ID
         * @returns {object|null} Updated mission or null if invalid
         */
        completeMission: function(missionId) {
            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (mission.status === 'completed') {
                return deepClone(mission);
            }

            if (mission.status === 'cancelled') {
                return null;
            }

            var proposed = deepClone(mission);
            proposed.status = 'completed';

            // Ensure all objectives are done
            if (Array.isArray(proposed.objectives)) {
                for (var i = 0; i < proposed.objectives.length; i++) {
                    if (proposed.objectives[i]) {
                        proposed.objectives[i].done = true;
                    }
                }
            }

            proposed.progress = Rules.calculateProgress(proposed.objectives);
            proposed.completedAt = new Date().toISOString();

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Cancel a mission.
         * 
         * @param {string} missionId - Internal mission ID
         * @returns {object|null} Updated mission or null if invalid
         */
        cancelMission: function(missionId) {
            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (mission.status === 'cancelled') {
                return deepClone(mission);
            }

            if (mission.status === 'completed') {
                return null;
            }

            var proposed = deepClone(mission);
            proposed.status = 'cancelled';
            proposed.completedAt = null;

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        /**
         * Reactivate a cancelled or completed mission.
         * 
         * @param {string} missionId - Internal mission ID
         * @returns {object|null} Updated mission or null if invalid
         */
        reactivateMission: function(missionId) {
            var mission = Queries.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (mission.status === 'active') {
                return deepClone(mission);
            }

            var proposed = deepClone(mission);
            proposed.status = 'active';
            proposed.completedAt = null;

            // Recalculate progress
            proposed.progress = Rules.calculateProgress(proposed.objectives);

            // If progress is 100%, auto-complete instead
            if (proposed.progress === 100) {
                proposed.status = 'completed';
                proposed.completedAt = new Date().toISOString();
            }

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            return committed;
        },

        // Schema access
        Schema: Schema,
        Rules: Rules
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsCore = MissionsCore;

})();
