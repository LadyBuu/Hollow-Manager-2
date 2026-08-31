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
 *   - Derived fields (progress, pay, completedAt) are calculated, not accepted as input
 *   - Only whitelisted fields are updateable via updateMission()
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
 *   - Active mission with 100% progress auto-completes
 *   - Completed mission: status can be manually changed, but objectives are frozen
 *   - Cancelled mission: status can be manually changed, but objectives are frozen
 *   - Objective modifications are rejected for completed/cancelled missions
 * 
 * ID SEMANTICS:
 *   - id: immutable internal identity (never changes)
 *   - missionId: derived human-readable identifier; may change when team/year/difficulty changes
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

    if (!window.MissionsSchema) {
        console.error('MissionsCore: MissionsSchema required.');
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
        if (!window.data || typeof window.data !== 'object') return null;
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
            // Ignore logging errors
        }
    }

    function getTeamById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        var target = normaliseId(id);
        if (target === null) return null;
        return data.teams.find(function(t) {
            return t && normaliseId(t.id) === target;
        }) || null;
    }

    function getCharacterById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        var target = normaliseId(id);
        if (target === null) return null;
        return data.characters.find(function(c) {
            return c && normaliseId(c.id) === target;
        }) || null;
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
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

        if (!match) return null;

        var num = Number(text);
        return Number.isFinite(num) ? num : null;
    }

    function calculatePay(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

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
    // MISSION ID GENERATION
    // ============================================================

    function generateMissionId(teamId, year, difficulty) {
        var data = getDataStore();
        if (!data) data = {};
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
                        teamAbbr = nameParts.map(function(part) {
                            return part.charAt(0).toUpperCase();
                        }).join('');
                    }
                    if (teamAbbr.length < 2) {
                        teamAbbr = teamAbbr.padEnd(2, 'X');
                    }
                }
            }
        }
        if (!teamAbbr) teamAbbr = 'UNS';

        var yearStr = String(year).slice(-2);
        var difficultyCode = DIFFICULTY_CODES[difficulty] || 'M';

        var prefix = teamAbbr + '-' + yearStr + '-' + difficultyCode;
        var sequence = 1;
        
        // Use regex for safer matching with escaped prefix
        var regex = new RegExp('^' + escapeRegExp(prefix) + '(\\d{3})$');
        
        missions.forEach(function(m) {
            if (m.missionId && typeof m.missionId === 'string') {
                var match = regex.exec(m.missionId);
                if (match) {
                    var num = parseInt(match[1], 10);
                    if (!isNaN(num) && num >= sequence) {
                        sequence = num + 1;
                    }
                }
            }
        });

        return prefix + String(sequence).padStart(3, '0');
    }

    // ============================================================
    // CLONE MISSION (For atomic operations)
    // ============================================================

    function cloneMission(mission) {
        if (!mission) return null;

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
            supportPersonnel: Array.isArray(mission.supportPersonnel) ? mission.supportPersonnel.slice() : [],
            status: mission.status || 'active',
            objectives: Array.isArray(mission.objectives) ? mission.objectives.map(function(o) {
                return {
                    text: o.text || '',
                    done: !!o.done
                };
            }) : [],
            progress: mission.progress || 0,
            notes: mission.notes || '',
            tags: Array.isArray(mission.tags) ? mission.tags.slice() : [],
            createdAt: mission.createdAt || null,
            completedAt: mission.completedAt || null,
            log: Array.isArray(mission.log) ? mission.log.map(function(entry) {
                return {
                    timestamp: entry.timestamp || null,
                    message: entry.message || ''
                };
            }) : []
        };
    }

    // ============================================================
    // VALIDATE TEAM REFERENCE
    // ============================================================

    function validateTeamReference(teamId) {
        if (!teamId) return true;
        var team = getTeamById(teamId);
        if (!team) {
            console.warn('MissionsCore: Team reference validation failed - team not found:', teamId);
            return false;
        }
        return true;
    }

    // ============================================================
    // OBJECTIVES MUTABILITY CHECK
    // ============================================================

    function areObjectivesMutable(mission) {
        if (!mission) return false;
        // Completed and cancelled missions have frozen objectives
        return mission.status !== 'completed' && mission.status !== 'cancelled';
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
            if (!data || !Array.isArray(data.missions)) return null;
            var target = normaliseId(id);
            if (target === null) return null;
            var mission = data.missions.find(function(m) {
                return m && normaliseId(m.id) === target;
            });
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
            if (!data || !Array.isArray(data.missions)) return [];

            var missions = data.missions.slice();

            if (filter === 'active') {
                missions = missions.filter(function(m) { return m.status === 'active'; });
            } else if (filter === 'completed') {
                missions = missions.filter(function(m) { return m.status === 'completed'; });
            } else if (filter === 'cancelled') {
                missions = missions.filter(function(m) { return m.status === 'cancelled'; });
            }

            // Sort by priority then creation date
            var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
            missions.sort(function(a, b) {
                var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 2;
                var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 2;
                if (pa !== pb) return pa - pb;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            // Return clones
            return missions.map(cloneMission);
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
         * 
         * @param {object} data - Mission data
         * @returns {object|null} Created mission or null if invalid
         */
        createMission: function(data) {
            if (!data || typeof data !== 'object') return null;

            // ---- PHASE 1: NORMALISE INPUT ----
            var normalised = Schema.normaliseMission(data);
            if (!normalised) return null;

            // ---- PHASE 2: VALIDATE TEAM REFERENCE ----
            if (!validateTeamReference(normalised.assignedTeamId)) {
                return null;
            }

            // ---- PHASE 3: GENERATE MISSION ID ----
            var missionId = generateMissionId(
                normalised.assignedTeamId,
                normalised.year || new Date().getFullYear(),
                normalised.difficulty
            );

            // ---- PHASE 4: BUILD COMPLETE MISSION ----
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
                status: normalised.status || 'active',
                objectives: normalised.objectives || [],
                progress: normalised.progress || 0,
                notes: normalised.notes || '',
                tags: normalised.tags || [],
                createdAt: new Date().toISOString(),
                completedAt: normalised.status === 'completed' ? new Date().toISOString() : null,
                log: []
            };

            // ---- PHASE 5: VALIDATE MISSION ----
            var validation = Schema.validateMission(mission);
            if (!validation.valid) {
                console.warn('MissionsCore.createMission: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- PHASE 6: COMMIT ----
            var store = getDataStore();
            if (!store) {
                if (!window.data) window.data = {};
                if (!window.data.missions) window.data.missions = [];
                window.data.missions.push(mission);
            } else {
                if (!store.missions) store.missions = [];
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
         * 
         * @param {string} id - Internal mission ID
         * @param {object} updates - Fields to update (must be in MUTABLE_FIELDS)
         * @returns {object|null} Updated mission or null if invalid
         */
        updateMission: function(id, updates) {
            var original = this.getMission(id);
            if (!original) return null;

            if (!updates || typeof updates !== 'object') return null;

            // ---- PHASE 1: FILTER TO ONLY MUTABLE FIELDS ----
            var validUpdates = {};
            Object.keys(updates).forEach(function(key) {
                if (MUTABLE_FIELDS.indexOf(key) !== -1 && hasOwnProperty(updates, key)) {
                    validUpdates[key] = updates[key];
                }
            });

            if (Object.keys(validUpdates).length === 0) {
                console.warn('MissionsCore.updateMission: No valid updateable fields provided.');
                return cloneMission(original);
            }

            // ---- PHASE 2: CHECK OBJECTIVES MUTABILITY ----
            var isFrozen = !areObjectivesMutable(original);
            if (isFrozen && hasOwnProperty(validUpdates, 'objectives')) {
                console.warn(
                    'MissionsCore.updateMission: Cannot modify objectives of ' +
                    original.status + ' mission.'
                );
                return null;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var proposed = cloneMission(original);

            // Apply all valid updates (handling null as "clear this field")
            Object.keys(validUpdates).forEach(function(key) {
                if (validUpdates[key] === null) {
                    // Null = clear the field
                    if (key === 'assignedTeamId') {
                        proposed.assignedTeamId = null;
                    } else if (key === 'supportPersonnel') {
                        proposed.supportPersonnel = [];
                    } else if (key === 'tags') {
                        proposed.tags = [];
                    } else if (key === 'objectives') {
                        proposed.objectives = [];
                    } else if (key === 'notes' || key === 'description') {
                        proposed[key] = '';
                    } else {
                        proposed[key] = '';
                    }
                } else if (validUpdates[key] !== undefined) {
                    proposed[key] = validUpdates[key];
                }
            });

            // ---- PHASE 4: VALIDATE TEAM REFERENCE ----
            if (proposed.assignedTeamId && !validateTeamReference(proposed.assignedTeamId)) {
                return null;
            }

            // ---- PHASE 5: NORMALISE OBJECTIVES ----
            if (Array.isArray(proposed.objectives)) {
                proposed.objectives = proposed.objectives.map(function(o) {
                    if (!o || typeof o !== 'object') {
                        return { text: '', done: false };
                    }
                    return {
                        text: String(o.text || '').trim(),
                        done: !!o.done
                    };
                }).filter(function(o) { return o.text; });
            }

            // ---- PHASE 6: RECALCULATE DERIVED FIELDS ----
            // Progress from objectives
            var total = proposed.objectives.length;
            var completed = proposed.objectives.filter(function(o) { return o.done; }).length;
            proposed.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Pay from base + surcharge
            proposed.pay = calculatePay(proposed.basePay, proposed.surchargePay);

            // Mission ID regeneration (only if values actually changed)
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

            // CompletedAt handling
            if (proposed.status === 'completed' && original.status !== 'completed') {
                proposed.completedAt = new Date().toISOString();
            } else if (proposed.status !== 'completed' && original.status === 'completed') {
                proposed.completedAt = null;
            } else if (proposed.status === 'completed' && proposed.completedAt) {
                // Keep existing completedAt if already completed
            }

            // Auto-complete if progress reaches 100% and status is active
            if (proposed.progress === 100 && proposed.status === 'active') {
                proposed.status = 'completed';
                proposed.completedAt = new Date().toISOString();
            }

            // ---- PHASE 7: VALIDATE PROPOSED STATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.updateMission: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- PHASE 8: COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var target = normaliseId(id);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return null;

            // Apply to live state
            Object.assign(store.missions[index], proposed);

            var changedKeys = Object.keys(validUpdates);
            logActivity('Updated mission: ' + proposed.title + ' (' + changedKeys.join(', ') + ')');

            return cloneMission(store.missions[index]);
        },

        /**
         * Delete a mission permanently.
         * 
         * @param {string} id - Internal mission ID
         * @returns {boolean} Success
         */
        deleteMission: function(id) {
            var mission = this.getMission(id);
            if (!mission) return false;

            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return false;

            var target = normaliseId(id);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return false;

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
            if (!mission) return null;

            // ---- LIFECYCLE CHECK ----
            if (!areObjectivesMutable(mission)) {
                console.warn('MissionsCore.toggleObjective: Cannot modify objectives of ' + mission.status + ' mission.');
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            proposed.objectives[objectiveIndex].done = !proposed.objectives[objectiveIndex].done;

            // Recalculate progress
            var total = proposed.objectives.length;
            var completed = proposed.objectives.filter(function(o) { return o.done; }).length;
            proposed.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Auto-complete if progress reaches 100%
            if (proposed.progress === 100 && proposed.status === 'active') {
                proposed.status = 'completed';
                proposed.completedAt = new Date().toISOString();
            }

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.toggleObjective: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var target = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            var statusMsg = proposed.status === 'completed' ? ' (auto-completed)' : '';
            logActivity('Toggled objective for mission: ' + proposed.title + statusMsg);

            return cloneMission(store.missions[index]);
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
            if (!cleanText) return null;

            var mission = this.getMission(missionId);
            if (!mission) return null;

            // ---- LIFECYCLE CHECK ----
            if (!areObjectivesMutable(mission)) {
                console.warn('MissionsCore.addObjective: Cannot modify objectives of ' + mission.status + ' mission.');
                return null;
            }

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            proposed.objectives.push({
                text: cleanText,
                done: false
            });

            // Recalculate progress
            var total = proposed.objectives.length;
            var completed = proposed.objectives.filter(function(o) { return o.done; }).length;
            proposed.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.addObjective: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var target = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            logActivity('Added objective to mission: ' + proposed.title);

            return cloneMission(store.missions[index]);
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
            if (!mission) return null;

            // ---- LIFECYCLE CHECK ----
            if (!areObjectivesMutable(mission)) {
                console.warn('MissionsCore.removeObjective: Cannot modify objectives of ' + mission.status + ' mission.');
                return null;
            }

            if (!Array.isArray(mission.objectives) || !mission.objectives[objectiveIndex]) {
                return null;
            }

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            proposed.objectives.splice(objectiveIndex, 1);

            // Recalculate progress
            var total = proposed.objectives.length;
            var completed = proposed.objectives.filter(function(o) { return o.done; }).length;
            proposed.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            // If no objectives left, set progress to 0
            if (total === 0) {
                proposed.progress = 0;
            }

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.removeObjective: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var target = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            logActivity('Removed objective from mission: ' + proposed.title);

            return cloneMission(store.missions[index]);
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
            if (!cleanMessage) return null;

            var mission = this.getMission(missionId);
            if (!mission) return null;

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            if (!proposed.log) proposed.log = [];
            proposed.log.push({
                timestamp: new Date().toISOString(),
                message: cleanMessage
            });

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.addLog: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var target = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === target;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            return cloneMission(store.missions[index]);
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
            if (target === null) return null;

            // Validate character exists
            var character = getCharacterById(target);
            if (!character) {
                console.warn('MissionsCore.addSupportPersonnel: Character not found:', target);
                return null;
            }

            var mission = this.getMission(missionId);
            if (!mission) return null;

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            if (!proposed.supportPersonnel) proposed.supportPersonnel = [];

            // Check if already added
            var exists = proposed.supportPersonnel.some(function(id) {
                return normaliseId(id) === target;
            });

            if (exists) {
                return cloneMission(mission);
            }

            proposed.supportPersonnel.push(target);

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.addSupportPersonnel: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var id = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === id;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            var charName = getDisplayName(character);
            logActivity('Added ' + charName + ' as support to mission: ' + proposed.title);

            return cloneMission(store.missions[index]);
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
            if (target === null) return null;

            var mission = this.getMission(missionId);
            if (!mission) return null;

            if (!mission.supportPersonnel) return cloneMission(mission);

            // ---- BUILD PROPOSED STATE ----
            var proposed = cloneMission(mission);
            proposed.supportPersonnel = proposed.supportPersonnel.filter(function(id) {
                return normaliseId(id) !== target;
            });

            // ---- VALIDATE ----
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) {
                console.warn('MissionsCore.removeSupportPersonnel: Validation failed:', validation.errors.join(', '));
                return null;
            }

            // ---- COMMIT ----
            var store = getDataStore();
            if (!store || !Array.isArray(store.missions)) return null;

            var id = normaliseId(missionId);
            var index = store.missions.findIndex(function(m) {
                return m && normaliseId(m.id) === id;
            });

            if (index === -1) return null;

            Object.assign(store.missions[index], proposed);

            logActivity('Removed support personnel from mission: ' + proposed.title);

            return cloneMission(store.missions[index]);
        },

        /**
         * Get support personnel as character objects for a mission.
         * 
         * @param {object|string} mission - Mission object or mission ID
         * @returns {array} Array of character objects
         */
        getSupportPersonnel: function(mission) {
            var missionObj = typeof mission === 'string' ? this.getMission(mission) : mission;
            if (!missionObj || !missionObj.supportPersonnel) return [];

            var characters = [];
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return characters;

            missionObj.supportPersonnel.forEach(function(id) {
                var char = data.characters.find(function(c) {
                    return c && normaliseId(c.id) === normaliseId(id);
                });
                if (char) characters.push(cloneCharacter(char));
            });

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
            return missions.filter(function(m) {
                return m.primaryType === typeId || m.secondaryType === typeId;
            });
        },

        /**
         * Get mission type counts.
         * 
         * @returns {object} Counts by mission type
         */
        getMissionTypeCounts: function() {
            var missions = this.getMissions('all');
            var counts = {};
            Object.keys(MISSION_TYPES).forEach(function(key) {
                counts[key] = 0;
            });
            missions.forEach(function(m) {
                if (m.primaryType && counts[m.primaryType] !== undefined) {
                    counts[m.primaryType]++;
                }
            });
            return counts;
        },

        // Schema access
        Schema: Schema
    };

    // ============================================================
    // CLONE CHARACTER HELPER (For support personnel)
    // ============================================================

    function cloneCharacter(char) {
        if (!char) return null;
        return {
            id: char.id,
            firstName: char.firstName || '',
            lastName: char.lastName || '',
            middleName: char.middleName || '',
            nickname: char.nickname || '',
            name: char.name || char.firstName || 'Unknown',
            deceased: !!char.deceased,
            status: char.status || 'active',
            classIds: Array.isArray(char.classIds) ? char.classIds.slice() : []
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsCore = MissionsCore;

})();
