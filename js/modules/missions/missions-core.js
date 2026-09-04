/**
 * js/modules/missions/missions-core.js - Mission Core Operations
 * CANONICAL mutation API for missions.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence (saveData)
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: all or nothing
 *   - Uses MissionsSchema for validation
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
 * ID SEMANTICS:
 *   - id: immutable internal identity (never changes)
 *   - missionId: derived human-readable identifier; may change when team/year/difficulty changes
 *   - missionId sequence is stateful (scans existing missions for next number)
 * 
 * DEPENDENCIES:
 *   - MissionsSchema (required)
 *   - window.saveData (for persistence - caller responsibility)
 *   - window.generateId (for ID generation)
 *   - window.logActivity (for activity logging)
 */

(function() {
    'use strict';

    if (window.__missionsCoreLoaded) return;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionsSchema) {
        return;
    }

    window.__missionsCoreLoaded = true;

    var Schema = window.MissionsSchema;
    var MISSION_TYPES = Schema.MISSION_TYPES;
    var DIFFICULTY_CODES = Schema.DIFFICULTY_CODES;

    // ============================================================
    // UPDATEABLE FIELDS WHITELIST
    // ============================================================

    var MUTABLE_FIELDS = [
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
    ];

    // ============================================================
    // HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function normaliseId(id) {
        return Schema.normaliseId(id);
    }

    function generateInternalId(prefix) {
        prefix = prefix || 'miss';
        if (typeof window.generateId === 'function') {
            return window.generateId(prefix);
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function logActivity(message) {
        try {
            if (typeof window.logActivity === 'function') {
                window.logActivity(message);
            }
        } catch (err) {
            // Activity logging failure should not abort the mutation
        }
    }

    function getTeamById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return null;
        }
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && normaliseId(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    function getCharacterById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        for (var i = 0; i < data.characters.length; i++) {
            var character = data.characters[i];
            if (character && normaliseId(character.id) === target) {
                return character;
            }
        }
        return null;
    }

    function getDisplayName(character) {
        if (!character) {
            return 'Unknown';
        }
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(character);
        }
        return character.name || character.firstName || 'Unknown';
    }

    function hasOwnProperty(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================================
    // PAY PARSING
    // ============================================================

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

    function calculatePay(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

        // Negative pay is rejected (mission compensation cannot be negative)
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

    // ============================================================
    // PROGRESS CALCULATION
    // ============================================================

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

    // ============================================================
    // MISSION ID GENERATION
    // ============================================================

    function generateMissionId(teamId, year, difficulty) {
        var data = getDataStore();
        if (!data) {
            data = {};
        }
        var missions = data.missions || [];

        // Get team abbreviation
        var teamAbbr = '';
        if (teamId) {
            var team = getTeamById(teamId);
            if (team) {
                var teamName = typeof team.name === 'string' ? team.name.trim() : '';
                if (teamName) {
                    var nameParts = teamName.split(' ');
                    if (nameParts.length === 1) {
                        teamAbbr = nameParts[0].substring(0, 3).toUpperCase();
                    } else {
                        var abbrParts = [];
                        for (var p = 0; p < nameParts.length; p++) {
                            abbrParts.push(nameParts[p].charAt(0).toUpperCase());
                        }
                        teamAbbr = abbrParts.join('');
                    }
                    if (teamAbbr.length < 2) {
                        teamAbbr = teamAbbr.padEnd(2, 'X');
                    }
                }
            }
        }
        if (!teamAbbr) {
            teamAbbr = 'UNS';
        }

        var yearStr = String(year).slice(-2);
        var difficultyCode = DIFFICULTY_CODES[difficulty] || 'M';

        var prefix = teamAbbr + '-' + yearStr + '-' + difficultyCode;
        var sequence = 1;

        var regex = new RegExp('^' + escapeRegExp(prefix) + '(\\d{3})$');

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.missionId && typeof m.missionId === 'string') {
                var match = regex.exec(m.missionId);
                if (match) {
                    var num = parseInt(match[1], 10);
                    if (!isNaN(num) && num >= sequence) {
                        sequence = num + 1;
                    }
                }
            }
        }

        return prefix + String(sequence).padStart(3, '0');
    }

    // ============================================================
    // CLONE MISSION (For atomic operations)
    // ============================================================

    function cloneMission(mission) {
        if (!mission) {
            return null;
        }

        var objectives = Array.isArray(mission.objectives)
            ? mission.objectives.map(function(o) {
                return {
                    text: o.text || '',
                    done: !!o.done
                };
            })
            : [];

        var supportPersonnel = Array.isArray(mission.supportPersonnel)
            ? mission.supportPersonnel.slice()
            : [];

        var tags = Array.isArray(mission.tags)
            ? mission.tags.slice()
            : [];

        var log = Array.isArray(mission.log)
            ? mission.log.map(function(entry) {
                return {
                    timestamp: entry.timestamp || null,
                    message: entry.message || ''
                };
            })
            : [];

        return {
            id: mission.id,
            missionId: mission.missionId,
            title: mission.title,
            description: mission.description || '',
            year: mission.year,
            month: mission.month,
            day: mission.day,
            primaryType: mission.primaryType || '',
            subtype: mission.subtype || '',
            secondaryType: mission.secondaryType || '',
            escalation: mission.escalation || 'tier_ii',
            threatType: mission.threatType || '',
            environment: mission.environment || '',
            location: mission.location || '',
            duration: mission.duration || '',
            difficulty: mission.difficulty || 'medium',
            priority: mission.priority || 'medium',
            basePay: mission.basePay || '',
            surchargePay: mission.surchargePay || '',
            pay: mission.pay || '',
            billing: mission.billing || 'original',
            assignedTeamId: mission.assignedTeamId || null,
            supportPersonnel: supportPersonnel,
            status: mission.status || 'active',
            objectives: objectives,
            progress: mission.progress || 0,
            notes: mission.notes || '',
            tags: tags,
            createdAt: mission.createdAt || null,
            completedAt: mission.completedAt || null,
            log: log
        };
    }

    // ============================================================
    // VALIDATE TEAM REFERENCE
    // ============================================================

    function validateTeamReference(teamId) {
        if (!teamId) {
            return true;
        }
        var team = getTeamById(teamId);
        if (!team) {
            return false;
        }
        return true;
    }

    // ============================================================
    // OBJECTIVES MUTABILITY CHECK
    // ============================================================

    function areObjectivesMutable(mission) {
        if (!mission) {
            return false;
        }
        return mission.status !== 'completed' && mission.status !== 'cancelled';
    }

    function canModifyObjectives(originalStatus, proposedStatus, hasObjectiveUpdate) {
        if (!hasObjectiveUpdate) {
            return true;
        }

        if (originalStatus === 'completed' || originalStatus === 'cancelled') {
            return false;
        }

        if (proposedStatus === 'completed' || proposedStatus === 'cancelled') {
            return false;
        }

        return true;
    }

    // ============================================================
    // COMMIT MISSION (Shared helper)
    // ============================================================

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

        return cloneMission(proposed);
    }

    // ============================================================
    // CORE API
    // ============================================================

    var MissionsCore = {
        /**
         * Get a mission by ID.
         * Returns a CLONE - safe for reading, not a live reference.
         */
        getMission: function(id) {
            var data = getDataStore();
            if (!data || !Array.isArray(data.missions)) {
                return null;
            }
            var target = normaliseId(id);
            if (target === null) {
                return null;
            }
            var mission = null;
            for (var i = 0; i < data.missions.length; i++) {
                var m = data.missions[i];
                if (m && normaliseId(m.id) === target) {
                    mission = m;
                    break;
                }
            }
            return mission ? cloneMission(mission) : null;
        },

        /**
         * Get all missions (with optional filter).
         * Returns a SHALLOW copy of the array with cloned mission objects.
         * 
         * @param {string} filter - 'all', 'active', 'completed', 'cancelled'
         * @returns {array} Array of mission clones
         */
        getMissions: function(filter) {
            var data = getDataStore();
            if (!data || !Array.isArray(data.missions)) {
                return [];
            }

            var missions = [];
            for (var i = 0; i < data.missions.length; i++) {
                missions.push(data.missions[i]);
            }

            if (filter === 'active') {
                var active = [];
                for (var j = 0; j < missions.length; j++) {
                    var m = missions[j];
                    if (m.status === 'active') {
                        active.push(m);
                    }
                }
                missions = active;
            } else if (filter === 'completed') {
                var completed = [];
                for (var k = 0; k < missions.length; k++) {
                    var m2 = missions[k];
                    if (m2.status === 'completed') {
                        completed.push(m2);
                    }
                }
                missions = completed;
            } else if (filter === 'cancelled') {
                var cancelled = [];
                for (var l = 0; l < missions.length; l++) {
                    var m3 = missions[l];
                    if (m3.status === 'cancelled') {
                        cancelled.push(m3);
                    }
                }
                missions = cancelled;
            }

            // Sort by priority then creation date
            var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
            missions.sort(function(a, b) {
                var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 2;
                var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 2;
                if (pa !== pb) {
                    return pa - pb;
                }
                var dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
                var dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
                return dateB - dateA;
            });

            // Return clones
            var result = [];
            for (var mIdx = 0; mIdx < missions.length; mIdx++) {
                result.push(cloneMission(missions[mIdx]));
            }
            return result;
        },

        /**
         * Generate a human-readable mission ID.
         * Exposed for UI preview and CSV operations.
         */
        generateMissionId: generateMissionId,

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

            // ---- PHASE 1: NORMALISE INPUT ----
            var normalised = Schema.normaliseMission(data);
            if (!normalised) {
                return null;
            }

            // ---- PHASE 2: VALIDATE TEAM REFERENCE ----
            if (!validateTeamReference(normalised.assignedTeamId)) {
                return null;
            }

            // ---- PHASE 3: CALCULATE DERIVED FIELDS ----
            var objectives = normalised.objectives || [];
            var progress = calculateProgress(objectives);
            var status = normalised.status || 'active';

            if (progress === 100 && status === 'active') {
                status = 'completed';
            }

            // ---- PHASE 4: GENERATE MISSION ID ----
            var missionId = generateMissionId(
                normalised.assignedTeamId,
                normalised.year || new Date().getFullYear(),
                normalised.difficulty
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
                pay: calculatePay(normalised.basePay, normalised.surchargePay),
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
                log: []
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

            logActivity('Created mission: ' + mission.title + ' (' + mission.missionId + ')');
            return cloneMission(mission);
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
            var original = this.getMission(id);
            if (!original) {
                return null;
            }

            if (!updates || typeof updates !== 'object') {
                return null;
            }

            // ---- PHASE 1: FILTER TO ONLY MUTABLE FIELDS (ignore undefined) ----
            var validUpdates = {};
            var keys = Object.keys(updates);
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                if (MUTABLE_FIELDS.indexOf(key) !== -1 && hasOwnProperty(updates, key) && updates[key] !== undefined) {
                    validUpdates[key] = updates[key];
                }
            }

            if (Object.keys(validUpdates).length === 0) {
                return cloneMission(original);
            }

            // ---- PHASE 2: CHECK OBJECTIVES MUTABILITY ----
            var proposedStatus = validUpdates.status !== undefined
                ? validUpdates.status
                : original.status;

            if (!canModifyObjectives(
                original.status,
                proposedStatus,
                hasOwnProperty(validUpdates, 'objectives')
            )) {
                return null;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var proposed = cloneMission(original);

            var updateKeys = Object.keys(validUpdates);
            for (var uk = 0; uk < updateKeys.length; uk++) {
                var uk2 = updateKeys[uk];
                var value = validUpdates[uk2];

                if (value === null) {
                    if (uk2 === 'assignedTeamId') {
                        proposed.assignedTeamId = null;
                    } else if (uk2 === 'supportPersonnel') {
                        proposed.supportPersonnel = [];
                    } else if (uk2 === 'tags') {
                        proposed.tags = [];
                    } else if (uk2 === 'objectives') {
                        proposed.objectives = [];
                    } else if (uk2 === 'notes' || uk2 === 'description') {
                        proposed[uk2] = '';
                    } else {
                        proposed[uk2] = '';
                    }
                } else if (validUpdates[uk2] !== undefined) {
                    proposed[uk2] = validUpdates[uk2];
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
            proposed.progress = calculateProgress(proposed.objectives);

            proposed.pay = calculatePay(proposed.basePay, proposed.surchargePay);

            var originalTeamId = normaliseId(original.assignedTeamId);
            var proposedTeamId = normaliseId(proposed.assignedTeamId);

            var shouldRegenerateId =
                originalTeamId !== proposedTeamId ||
                original.year !== proposed.year ||
                original.difficulty !== proposed.difficulty;

            if (shouldRegenerateId) {
                var newId = generateMissionId(
                    proposed.assignedTeamId,
                    proposed.year || new Date().getFullYear(),
                    proposed.difficulty
                );
                if (newId !== proposed.missionId) {
                    proposed.missionId = newId;
                }
            }

            if (proposed.status === 'completed' && original.status !== 'completed') {
                proposed.completedAt = new Date().toISOString();
            } else if (proposed.status !== 'completed' && original.status === 'completed') {
                proposed.completedAt = null;
            }

            if (proposed.progress === 100 && proposed.status === 'active') {
                proposed.status = 'completed';
                proposed.completedAt = new Date().toISOString();
            }

            // ---- PHASE 7: VALIDATE PROPOSED STATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            // ---- PHASE 8: COMMIT ----
            var committed = commitMission(id, proposed);
            if (!committed) {
                return null;
            }

            var changedKeys = Object.keys(validUpdates);
            logActivity('Updated mission: ' + committed.title + ' (' + changedKeys.join(', ') + ')');

            return committed;
        },

        /**
         * Delete a mission permanently.
         * 
         * @param {string} id - Internal mission ID
         * @returns {boolean} Success
         */
        deleteMission: function(id) {
            var mission = this.getMission(id);
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

            logActivity('Deleted mission: ' + mission.title);
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
            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            var proposed = cloneMission(mission);
            proposed.objectives[objectiveIndex].done = !proposed.objectives[objectiveIndex].done;

            proposed.progress = calculateProgress(proposed.objectives);

            if (proposed.progress === 100 && proposed.status === 'active') {
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

            var statusMsg = committed.status === 'completed' ? ' (auto-completed)' : '';
            logActivity('Toggled objective for mission: ' + committed.title + statusMsg);

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

            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            var proposed = cloneMission(mission);
            proposed.objectives.push({
                text: cleanText,
                done: false
            });

            proposed.progress = calculateProgress(proposed.objectives);

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            logActivity('Added objective to mission: ' + committed.title);

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
            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!areObjectivesMutable(mission)) {
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            var proposed = cloneMission(mission);
            proposed.objectives.splice(objectiveIndex, 1);

            proposed.progress = calculateProgress(proposed.objectives);

            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                return null;
            }

            var committed = commitMission(missionId, proposed);
            if (!committed) {
                return null;
            }

            logActivity('Removed objective from mission: ' + committed.title);

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

            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            var proposed = cloneMission(mission);
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

            var character = getCharacterById(target);
            if (!character) {
                return null;
            }

            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            var proposed = cloneMission(mission);
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
                return cloneMission(mission);
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

            var charName = getDisplayName(character);
            logActivity('Added ' + charName + ' as support to mission: ' + committed.title);

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

            var mission = this.getMission(missionId);
            if (!mission) {
                return null;
            }

            if (!mission.supportPersonnel) {
                return cloneMission(mission);
            }

            var proposed = cloneMission(mission);
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

            logActivity('Removed support personnel from mission: ' + committed.title);

            return committed;
        },

        /**
         * Get support personnel as character objects for a mission.
         * Handles both mission objects and mission IDs.
         * 
         * @param {object|string} mission - Mission object or mission ID
         * @returns {array} Array of character objects
         */
        getSupportPersonnel: function(mission) {
            var missionObj;

            if (mission && typeof mission === 'object') {
                missionObj = mission;
            } else {
                missionObj = this.getMission(mission);
            }

            if (!missionObj || !missionObj.supportPersonnel) {
                return [];
            }

            var characters = [];
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) {
                return characters;
            }

            for (var i = 0; i < missionObj.supportPersonnel.length; i++) {
                var id = missionObj.supportPersonnel[i];
                var target = normaliseId(id);
                if (target === null) {
                    continue;
                }
                var character = null;
                for (var j = 0; j < data.characters.length; j++) {
                    var c = data.characters[j];
                    if (c && normaliseId(c.id) === target) {
                        character = c;
                        break;
                    }
                }
                if (character) {
                    characters.push(cloneCharacter(character));
                }
            }

            return characters;
        },

        /**
         * Get missions by primary or secondary type.
         * 
         * @param {string} typeId - Mission type ID
         * @returns {array} Array of mission clones
         */
        getMissionsByType: function(typeId) {
            var missions = this.getMissions('all');
            var result = [];
            for (var i = 0; i < missions.length; i++) {
                var m = missions[i];
                if (m.primaryType === typeId || m.secondaryType === typeId) {
                    result.push(m);
                }
            }
            return result;
        },

        /**
         * Get mission type counts.
         * 
         * @returns {object} Counts by mission type
         */
        getMissionTypeCounts: function() {
            var missions = this.getMissions('all');
            var counts = {};
            var typeKeys = Object.keys(MISSION_TYPES);
            for (var i = 0; i < typeKeys.length; i++) {
                counts[typeKeys[i]] = 0;
            }
            for (var j = 0; j < missions.length; j++) {
                var m = missions[j];
                if (m.primaryType && counts[m.primaryType] !== undefined) {
                    counts[m.primaryType]++;
                }
            }
            return counts;
        },

        // Schema access
        Schema: Schema
    };

    // ============================================================
    // CLONE CHARACTER HELPER (For support personnel)
    // ============================================================

    function cloneCharacter(character) {
        if (!character) {
            return null;
        }
        return {
            id: character.id,
            firstName: character.firstName || '',
            lastName: character.lastName || '',
            middleName: character.middleName || '',
            nickname: character.nickname || '',
            name: character.name || character.firstName || 'Unknown',
            deceased: !!character.deceased,
            status: character.status || 'active',
            classIds: Array.isArray(character.classIds) ? character.classIds.slice() : []
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsCore = MissionsCore;

})();
