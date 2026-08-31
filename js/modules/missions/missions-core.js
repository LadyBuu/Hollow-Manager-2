/**
 * js/modules/missions/missions-core.js - Mission Core Operations
 * CANONICAL mutation API for missions.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence (saveData)
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: all or nothing
 *   - Uses MissionsSchema for validation
 *   - Mission ID is auto-generated on creation
 * 
 * DEPENDENCIES:
 *   - MissionsSchema (required)
 *   - window.saveData (for persistence)
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
    // HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        return window.data;
    }

    function normaliseId(id) {
        return Schema.normaliseId(id);
    }

    function generateId(prefix) {
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
        } catch (err) {}
    }

    function getTeamById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        return data.teams.find(function(t) {
            return t && normaliseId(t.id) === normaliseId(id);
        }) || null;
    }

    function getCharacterById(id) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && normaliseId(c.id) === normaliseId(id);
        }) || null;
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
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
                var nameParts = team.name.split(' ');
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
        if (!teamAbbr) teamAbbr = 'UNS';

        var yearStr = String(year).slice(-2);
        var difficultyCode = DIFFICULTY_CODES[difficulty] || 'M';

        var prefix = teamAbbr + '-' + yearStr + '-' + difficultyCode;
        var sequence = 1;
        
        missions.forEach(function(m) {
            if (m.missionId && m.missionId.startsWith(prefix)) {
                var numPart = m.missionId.replace(prefix, '');
                var num = parseInt(numPart);
                if (!isNaN(num) && num >= sequence) {
                    sequence = num + 1;
                }
            }
        });

        return prefix + String(sequence).padStart(3, '0');
    }

    // ============================================================
    // CORE API
    // ============================================================

    var MissionsCore = {
        /**
         * Get a mission by ID.
         * Returns a LIVE reference - do not mutate directly.
         */
        getMission: function(id) {
            var data = getDataStore();
            if (!data || !Array.isArray(data.missions)) return null;
            var target = normaliseId(id);
            if (target === null) return null;
            return data.missions.find(function(m) {
                return m && normaliseId(m.id) === target;
            }) || null;
        },

        /**
         * Get all missions.
         * Returns a shallow array copy containing live mission references.
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

            return missions;
        },

        /**
         * Create a new mission.
         * Validates all inputs before mutation.
         */
        createMission: function(data) {
            if (!data || typeof data !== 'object') return null;

            // Validate using Schema
            var validation = Schema.validateMission(data);
            if (!validation.valid) return null;

            var now = new Date();
            var year = data.year || now.getFullYear();
            var month = data.month || now.getMonth() + 1;
            var day = data.day || now.getDate();

            // Auto-generate mission ID
            var missionId = generateMissionId(data.assignedTeamId, year, data.difficulty);

            // Calculate total pay
            var totalPay = '';
            var basePay = data.basePay || '';
            var surchargePay = data.surchargePay || '';
            if (basePay || surchargePay) {
                var baseNum = parseFloat(String(basePay).replace(/[^0-9.]/g, ''));
                var surchargeNum = parseFloat(String(surchargePay).replace(/[^0-9.]/g, ''));
                if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
                    totalPay = (baseNum + surchargeNum).toFixed(2) + ' credits';
                } else if (!isNaN(baseNum)) {
                    totalPay = baseNum.toFixed(2) + ' credits';
                } else if (!isNaN(surchargeNum)) {
                    totalPay = surchargeNum.toFixed(2) + ' credits';
                }
            }

            var mission = {
                id: generateId('miss'),
                missionId: missionId,
                title: String(data.title || 'Untitled Mission').trim(),
                description: data.description || '',
                year: year,
                month: month,
                day: day,
                primaryType: data.primaryType || '',
                subtype: data.subtype || '',
                secondaryType: data.secondaryType || '',
                escalation: data.escalation || 'tier_ii',
                threatType: data.threatType || '',
                environment: data.environment || '',
                location: data.location || '',
                duration: data.duration || '',
                difficulty: data.difficulty || 'medium',
                priority: data.priority || 'medium',
                basePay: basePay,
                surchargePay: surchargePay,
                pay: totalPay,
                billing: data.billing || 'original',
                assignedTeamId: data.assignedTeamId || null,
                supportPersonnel: Array.isArray(data.supportPersonnel) ? data.supportPersonnel.slice() : [],
                status: data.status || 'active',
                objectives: Array.isArray(data.objectives) ? data.objectives.map(function(o) {
                    return { text: String(o.text || ''), done: !!o.done };
                }) : [],
                progress: 0,
                notes: data.notes || '',
                tags: Array.isArray(data.tags) ? data.tags.map(function(t) { return String(t).trim(); }).filter(function(t) { return t; }) : [],
                createdAt: new Date().toISOString(),
                completedAt: null,
                log: []
            };

            // Calculate initial progress
            var total = mission.objectives.length;
            var completed = mission.objectives.filter(function(o) { return o.done; }).length;
            mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

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

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Update an existing mission.
         * Validates all inputs before mutation.
         */
        updateMission: function(id, updates) {
            var mission = this.getMission(id);
            if (!mission) return null;

            if (!updates || typeof updates !== 'object') return null;

            // Build proposed state
            var proposed = Object.assign({}, mission);
            Object.keys(updates).forEach(function(key) {
                if (updates[key] !== undefined && updates[key] !== null) {
                    proposed[key] = updates[key];
                }
            });

            // Validate proposed state
            var validation = Schema.validateMission(proposed);
            if (!validation.valid) return null;

            var changes = [];
            var store = getDataStore();

            // Apply changes
            Object.keys(updates).forEach(function(key) {
                if (updates[key] !== undefined && updates[key] !== null && String(mission[key]) !== String(updates[key])) {
                    changes.push(key);
                    mission[key] = updates[key];
                }
            });

            // Re-generate mission ID if team or difficulty changed
            if (updates.assignedTeamId || updates.difficulty) {
                var newId = generateMissionId(
                    mission.assignedTeamId || updates.assignedTeamId,
                    mission.year || new Date().getFullYear(),
                    mission.difficulty || updates.difficulty || 'medium'
                );
                if (newId !== mission.missionId) {
                    mission.missionId = newId;
                    changes.push('missionId');
                }
            }

            // Recalculate total pay
            if (updates.basePay !== undefined || updates.surchargePay !== undefined) {
                var baseNum = parseFloat(String(mission.basePay || '').replace(/[^0-9.]/g, ''));
                var surchargeNum = parseFloat(String(mission.surchargePay || '').replace(/[^0-9.]/g, ''));
                if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
                    mission.pay = (baseNum + surchargeNum).toFixed(2) + ' credits';
                } else if (!isNaN(baseNum)) {
                    mission.pay = baseNum.toFixed(2) + ' credits';
                }
                changes.push('pay');
            }

            // Update progress from objectives
            if (updates.objectives) {
                var total = mission.objectives.length;
                var completed = mission.objectives.filter(function(o) { return o.done; }).length;
                mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
            }

            // Set completedAt if status changed to completed
            if (updates.status === 'completed' && mission.status === 'completed' && !mission.completedAt) {
                mission.completedAt = new Date().toISOString();
            }

            if (changes.length > 0) {
                logActivity('Updated mission: ' + mission.title + ' (' + changes.join(', ') + ')');
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Delete a mission permanently.
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

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return true;
        },

        /**
         * Toggle an objective's done status.
         */
        toggleObjective: function(missionId, objectiveIndex) {
            var mission = this.getMission(missionId);
            if (!mission || !mission.objectives || !mission.objectives[objectiveIndex]) return null;

            mission.objectives[objectiveIndex].done = !mission.objectives[objectiveIndex].done;

            var total = mission.objectives.length;
            var completed = mission.objectives.filter(function(o) { return o.done; }).length;
            mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Auto-complete mission if all objectives done
            if (mission.progress === 100 && mission.status === 'active') {
                mission.status = 'completed';
                mission.completedAt = new Date().toISOString();
                logActivity('Mission completed: ' + mission.title);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Add an objective to a mission.
         */
        addObjective: function(missionId, text) {
            var mission = this.getMission(missionId);
            if (!mission) return null;

            if (!mission.objectives) mission.objectives = [];
            mission.objectives.push({
                text: String(text || '').trim(),
                done: false
            });

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Add a log entry to a mission.
         */
        addLog: function(missionId, message) {
            var mission = this.getMission(missionId);
            if (!mission) return null;

            if (!mission.log) mission.log = [];
            mission.log.push({
                timestamp: new Date().toISOString(),
                message: String(message || '').trim()
            });

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Add support personnel to a mission.
         */
        addSupportPersonnel: function(missionId, characterId) {
            var mission = this.getMission(missionId);
            if (!mission) return null;

            var target = normaliseId(characterId);
            if (target === null) return null;

            if (!mission.supportPersonnel) mission.supportPersonnel = [];

            var exists = mission.supportPersonnel.some(function(id) {
                return normaliseId(id) === target;
            });

            if (exists) return mission;

            mission.supportPersonnel.push(target);

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Remove support personnel from a mission.
         */
        removeSupportPersonnel: function(missionId, characterId) {
            var mission = this.getMission(missionId);
            if (!mission) return null;

            var target = normaliseId(characterId);
            if (target === null) return null;

            if (!mission.supportPersonnel) return mission;

            mission.supportPersonnel = mission.supportPersonnel.filter(function(id) {
                return normaliseId(id) !== target;
            });

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function() {});
            }

            return mission;
        },

        /**
         * Get support personnel as character objects.
         */
        getSupportPersonnel: function(mission) {
            if (!mission || !mission.supportPersonnel) return [];

            var characters = [];
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return characters;

            mission.supportPersonnel.forEach(function(id) {
                var char = data.characters.find(function(c) {
                    return c && normaliseId(c.id) === normaliseId(id);
                });
                if (char) characters.push(char);
            });

            return characters;
        },

        /**
         * Get missions by type.
         */
        getMissionsByType: function(typeId) {
            var missions = this.getMissions('all');
            return missions.filter(function(m) {
                return m.primaryType === typeId || m.secondaryType === typeId;
            });
        },

        /**
         * Get mission type counts.
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
    // EXPOSE
    // ============================================================

    window.MissionsCore = MissionsCore;

})();
