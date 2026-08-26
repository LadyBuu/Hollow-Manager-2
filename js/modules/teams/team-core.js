/**
 * js/modules/teams/team-core.js - Core Team Operations
 * Handles CRUD operations for teams with clean persistence boundaries
 * Path: js/modules/teams/team-core.js
 * 
 * IMPORTANT: This module is the CANONICAL mutation API for teams.
 * All team mutations should go through this module.
 * 
 * MUTATION PHILOSOPHY:
 *   - TeamCore provides CRUD operations for teams
 *   - Mutations modify window.data and return the result
 *   - Caller is responsible for persistence (saveData)
 *   - This keeps the module testable and the persistence contract explicit
 * 
 * TEAM STATUSES:
 *   - 'active': Currently active team
 *   - 'inactive': Temporarily inactive team
 *   - 'deprecated': Legacy team, no longer in use
 * 
 * TEAM TYPES:
 *   - 'academic': Academic/educational teams
 *   - 'professional': Professional/working teams
 *                 Legacy 'internship' values are normalised to 'professional'
 *   - 'temporary': Temporary or project-based teams
 *   - 'civilian': Civilian/non-combatant teams
 * 
 * MEMBERSHIP SEMANTICS:
 *   - joinPeriod: The period (week/year) when the member joined
 *   - leavePeriod: The period (week/year) when the member left
 *   - Membership is inclusive: join <= period <= leave means active
 *   - For academic teams, period is a week number (1-52)
 *   - For other teams, period is a numeric year
 * 
 * RANKING SEMANTICS:
 *   - period: Numeric period (week/year) when the ranking was recorded
 *   - rank: Numeric rank position
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamCoreLoaded) {
        return;
    }
    window.__teamCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_TEAM_TYPES = ['academic', 'professional', 'temporary', 'civilian'];
    var VALID_TEAM_STATUSES = ['active', 'inactive', 'deprecated'];
    var UPDATEABLE_PROPERTIES = [
        'name',
        'type',
        'startPeriod',
        'endPeriod',
        'currentRank',
        'status',
        'nameHistory',
        'temporaryMission',
        'classId',
        'teamNumber'
    ];

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isValidTeamType(type) {
        if (!type) return false;
        // 'internship' is a legacy type, accepted as input
        if (type === 'internship') return true;
        return VALID_TEAM_TYPES.indexOf(type) !== -1;
    }

    function normalizeTeamType(type) {
        if (type === 'internship') {
            return 'professional';
        }
        return isValidTeamType(type) ? type : 'academic';
    }

    function isValidTeamStatus(status) {
        return status && VALID_TEAM_STATUSES.indexOf(status) !== -1;
    }

    function parseNumericPeriod(value) {
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        return Number(str);
    }

    function sanitizeNameHistory(history) {
        if (!Array.isArray(history)) return [];

        return history.map(function(entry) {
            entry = entry || {};
            return {
                name: typeof entry.name === 'string' ? entry.name.trim() : '',
                startPeriod: typeof entry.startPeriod === 'string' ? entry.startPeriod.trim() : '',
                endPeriod: typeof entry.endPeriod === 'string' ? entry.endPeriod.trim() : ''
            };
        }).filter(function(entry) {
            return entry.name !== '';
        });
    }

    function sanitizeTeamData(teamData) {
        teamData = teamData || {};
        return {
            name: typeof teamData.name === 'string' ? teamData.name.trim() || 'Unnamed Team' : 'Unnamed Team',
            type: normalizeTeamType(teamData.type),
            startPeriod: typeof teamData.startPeriod === 'string' ? teamData.startPeriod.trim() : '',
            endPeriod: typeof teamData.endPeriod === 'string' ? teamData.endPeriod.trim() : '',
            currentRank: typeof teamData.currentRank === 'string' ? teamData.currentRank.trim() : '',
            status: isValidTeamStatus(teamData.status) ? teamData.status : 'active',
            nameHistory: sanitizeNameHistory(teamData.nameHistory),
            temporaryMission: teamData.temporaryMission || null,
            classId: teamData.classId || null,
            teamNumber: typeof teamData.teamNumber === 'string' ? teamData.teamNumber.trim() : ''
        };
    }

    function ensureDataExists() {
        if (!window.data) {
            window.data = {};
        }
        if (!window.data.teams) {
            window.data.teams = [];
        }
        return window.data;
    }

    function ensureTeamExists(id) {
        if (!id) return null;
        var data = ensureDataExists();
        return data.teams.find(function(t) { return String(t.id) === String(id); }) || null;
    }

    // ============================================================
    // TEAM CORE API
    // ============================================================

    var TeamCore = {
        /**
         * Get a team by ID
         * @param {string} id - Team ID
         * @returns {object|null} Team object or null
         */
        getTeam: function(id) {
            if (!id) return null;
            var data = window.data || {};
            if (!data.teams) return null;
            return data.teams.find(function(t) { return String(t.id) === String(id); }) || null;
        },

        /**
         * Get teams, optionally filtered by type and status
         * @param {string} type - Team type filter (normalised internally)
         * @param {string} status - Team status filter (active, inactive, deprecated)
         * @returns {array} Array of team objects; do not mutate directly
         */
        getTeams: function(type, status) {
            var data = window.data || {};
            if (!data.teams) return [];

            var teams = data.teams.slice();

            if (type) {
                var normalizedType = normalizeTeamType(type);
                teams = teams.filter(function(t) {
                    return normalizeTeamType(t.type) === normalizedType;
                });
            }

            if (status && isValidTeamStatus(status)) {
                teams = teams.filter(function(t) { return t.status === status; });
            }

            return teams;
        },

        /**
         * Get all active teams (status === 'active')
         * @param {string} type - Optional type filter
         * @returns {array} Array of active team objects
         */
        getActiveTeams: function(type) {
            return this.getTeams(type, 'active');
        },

        /**
         * Create a new team
         * @param {object} teamData - Team data (mutates window.data, caller saves)
         * @returns {object} Created team
         */
        createTeam: function(teamData) {
            var data = ensureDataExists();

            var sanitized = sanitizeTeamData(teamData);

            var newTeam = {
                id: window.generateId ? window.generateId('team') : 'team_' + Date.now(),
                name: sanitized.name,
                type: sanitized.type,
                startPeriod: sanitized.startPeriod,
                endPeriod: sanitized.endPeriod,
                currentRank: sanitized.currentRank,
                status: sanitized.status,
                nameHistory: sanitized.nameHistory,
                members: [],
                rankingHistory: [],
                temporaryMission: sanitized.temporaryMission,
                classId: sanitized.classId,
                teamNumber: sanitized.teamNumber,
                createdAt: new Date().toISOString()
            };

            data.teams.push(newTeam);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Created team: ' + newTeam.name + ' (' + newTeam.type + ')');
            }

            return newTeam;
        },

        /**
         * Update an existing team
         * @param {string} id - Team ID
         * @param {object} updates - Updates to apply (mutates window.data, caller saves)
         * @returns {object|null} Updated team or null
         */
        updateTeam: function(id, updates) {
            var team = this.getTeam(id);
            if (!team) return null;

            var changes = [];

            // Whitelist allowed properties - prevents accidental mutation of id, members, etc.
            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] === undefined) return;

                // Handle type specially - validate and normalise without mutating caller's object
                if (key === 'type') {
                    if (!isValidTeamType(updates[key])) {
                        console.warn('updateTeam: Invalid team type "' + updates[key] + '" ignored');
                        return;
                    }
                    var normalizedType = normalizeTeamType(updates[key]);
                    if (team[key] !== normalizedType) {
                        team[key] = normalizedType;
                        changes.push(key);
                    }
                    return;
                }

                // Handle status validation
                if (key === 'status' && !isValidTeamStatus(updates[key])) {
                    console.warn('updateTeam: Invalid team status "' + updates[key] + '" ignored');
                    return;
                }

                // Handle nameHistory sanitization
                if (key === 'nameHistory') {
                    var sanitized = sanitizeNameHistory(updates[key]);
                    if (JSON.stringify(team[key]) !== JSON.stringify(sanitized)) {
                        team[key] = sanitized;
                        changes.push(key);
                    }
                    return;
                }

                // Generic string value
                if (typeof updates[key] === 'string') {
                    var trimmed = updates[key].trim();
                    if (team[key] !== trimmed) {
                        team[key] = trimmed;
                        changes.push(key);
                    }
                } else if (team[key] !== updates[key]) {
                    team[key] = updates[key];
                    changes.push(key);
                }
            });

            // Ensure type is always valid
            if (!isValidTeamType(team.type)) {
                team.type = 'academic';
            }

            // Ensure status is always valid
            if (!isValidTeamStatus(team.status)) {
                team.status = 'active';
            }

            if (typeof window.logActivity === 'function' && changes.length > 0) {
                window.logActivity('Updated team: ' + team.name + ' (' + changes.join(', ') + ')');
            }

            return team;
        },

        /**
         * Delete a team permanently
         * @param {string} id - Team ID (mutates window.data, caller saves)
         * @returns {boolean} Success
         */
        deleteTeam: function(id) {
            var team = this.getTeam(id);
            if (!team) return false;

            var data = window.data || {};
            if (!data.teams) return false;

            var teamName = team.name;
            data.teams = data.teams.filter(function(t) { return String(t.id) !== String(id); });

            if (typeof window.logActivity === 'function') {
                window.logActivity('Deleted team: ' + teamName);
            }

            return true;
        },

        // ============================================================
        // MEMBER OPERATIONS
        // ============================================================

        /**
         * Add a member to a team
         * @param {string} teamId - Team ID
         * @param {object} memberData - { characterId, role, joinPeriod, leavePeriod }
         * @returns {object|null} Added member or null
         */
        addMember: function(teamId, memberData) {
            var team = this.getTeam(teamId);
            if (!team) return null;

            if (!memberData || !memberData.characterId) {
                console.warn('TeamCore.addMember: Missing characterId');
                return null;
            }

            if (!team.members) {
                team.members = [];
            }

            // Check for duplicate
            if (team.members.some(function(m) {
                return String(m.characterId) === String(memberData.characterId);
            })) {
                console.warn('TeamCore.addMember: Character already in team');
                return null;
            }

            var member = {
                characterId: memberData.characterId,
                role: typeof memberData.role === 'string' ? memberData.role.trim() || 'Member' : 'Member',
                joinPeriod: typeof memberData.joinPeriod === 'string' ? memberData.joinPeriod.trim() : '',
                leavePeriod: typeof memberData.leavePeriod === 'string' ? memberData.leavePeriod.trim() : ''
            };

            team.members.push(member);

            if (typeof window.logActivity === 'function') {
                var char = window.getCharacterById(memberData.characterId);
                window.logActivity('Added ' + (char ? window.getDisplayName(char) : 'character') + ' to team: ' + team.name);
            }

            return member;
        },

        /**
         * Remove a member from a team
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @returns {boolean} Success
         */
        removeMember: function(teamId, charId) {
            var team = this.getTeam(teamId);
            if (!team || !team.members) return false;

            var originalLength = team.members.length;
            var removedMember = team.members.find(function(m) {
                return String(m.characterId) === String(charId);
            });

            team.members = team.members.filter(function(m) {
                return String(m.characterId) !== String(charId);
            });

            if (team.members.length === originalLength) {
                return false;
            }

            if (typeof window.logActivity === 'function' && removedMember) {
                var char = window.getCharacterById(charId);
                window.logActivity('Removed ' + (char ? window.getDisplayName(char) : 'character') + ' from team: ' + team.name);
            }

            return true;
        },

        /**
         * Update a member's details
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @param {object} updates - { role, joinPeriod, leavePeriod }
         * @returns {object|null} Updated member or null
         */
        updateMember: function(teamId, charId, updates) {
            var team = this.getTeam(teamId);
            if (!team || !team.members) return null;

            var member = team.members.find(function(m) {
                return String(m.characterId) === String(charId);
            });

            if (!member) return null;

            var allowedMemberUpdates = ['role', 'joinPeriod', 'leavePeriod'];
            var changed = false;

            allowedMemberUpdates.forEach(function(key) {
                if (updates[key] !== undefined) {
                    if (typeof updates[key] === 'string') {
                        member[key] = updates[key].trim();
                    } else {
                        member[key] = updates[key];
                    }
                    changed = true;
                }
            });

            if (!changed) return null;

            if (typeof window.logActivity === 'function') {
                var char = window.getCharacterById(charId);
                window.logActivity('Updated member ' + (char ? window.getDisplayName(char) : 'character') + ' in team: ' + team.name);
            }

            return member;
        },

        /**
         * Get active members of a team at a given period
         * @param {object} team - Team object
         * @param {number} period - Week (academic) or Year (other types)
         * @returns {array} Array of active members
         */
        getActiveMembers: function(team, period) {
            if (!team || !team.members) return [];
            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                return [];
            }

            return team.members.filter(function(m) {
                var join = parseNumericPeriod(m.joinPeriod);
                var leave = parseNumericPeriod(m.leavePeriod);

                // For academic teams, joinPeriod is required
                if (team.type === 'academic') {
                    return join !== null && join <= periodNum && (leave === null || leave >= periodNum);
                }

                // For non-academic teams, if joinPeriod is missing, assume "from beginning"
                if (join === null) return true;
                return join <= periodNum && (leave === null || leave >= periodNum);
            });
        },

        // ============================================================
        // RANKING OPERATIONS
        // ============================================================

        /**
         * Compare two periods for sorting
         * @param {string} a - First period
         * @param {string} b - Second period
         * @returns {number} Comparison result
         * @private
         */
        _comparePeriods: function(a, b) {
            var aNum = parseNumericPeriod(a);
            var bNum = parseNumericPeriod(b);

            if (aNum !== null && bNum !== null) {
                return aNum - bNum;
            }

            return String(a).localeCompare(String(b));
        },

        /**
         * Add a ranking entry to a team
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period (week/year)
         * @param {string|number} rank - Rank number
         * @returns {boolean} Success
         */
        addRanking: function(teamId, period, rank) {
            var team = this.getTeam(teamId);
            if (!team) return false;

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null || periodNum < 1) {
                console.warn('TeamCore.addRanking: Invalid period "' + period + '"');
                return false;
            }

            var rankNum = parseNumericPeriod(rank);
            if (rankNum === null || rankNum < 1) {
                console.warn('TeamCore.addRanking: Invalid rank "' + rank + '"');
                return false;
            }

            if (!team.rankingHistory) {
                team.rankingHistory = [];
            }

            // Check for duplicate period
            var existingIndex = team.rankingHistory.findIndex(function(r) {
                return parseNumericPeriod(r.period) === periodNum;
            });

            if (existingIndex !== -1) {
                team.rankingHistory[existingIndex] = { period: periodNum, rank: rankNum };
            } else {
                team.rankingHistory.push({ period: periodNum, rank: rankNum });
            }

            // Update current rank to the most recent
            this._updateCurrentRank(team);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added ranking #' + rankNum + ' for team: ' + team.name);
            }

            return true;
        },

        /**
         * Remove a ranking entry by period
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            var team = this.getTeam(teamId);
            if (!team || !team.rankingHistory) return false;

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                console.warn('TeamCore.removeRanking: Invalid period "' + period + '"');
                return false;
            }

            var originalLength = team.rankingHistory.length;

            team.rankingHistory = team.rankingHistory.filter(function(r) {
                return parseNumericPeriod(r.period) !== periodNum;
            });

            if (team.rankingHistory.length === originalLength) {
                return false;
            }

            this._updateCurrentRank(team);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed ranking from team: ' + team.name);
            }

            return true;
        },

        /**
         * Update the current rank based on the most recent ranking
         * @param {object} team - Team object
         * @private
         */
        _updateCurrentRank: function(team) {
            if (!team) return;

            if (!team.rankingHistory || team.rankingHistory.length === 0) {
                team.currentRank = '';
                return;
            }

            var sorted = team.rankingHistory.slice().sort(function(a, b) {
                return this._comparePeriods(a.period, b.period);
            }.bind(this));

            team.currentRank = String(sorted[sorted.length - 1].rank);
        },

        /**
         * Get sorted ranking history for a team
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedRankings: function(team) {
            if (!team || !team.rankingHistory) return [];
            return team.rankingHistory.slice().sort(function(a, b) {
                return this._comparePeriods(a.period, b.period);
            }.bind(this));
        },

        // ============================================================
        // DISPLAY HELPERS
        // ============================================================

        /**
         * Get team period display string
         * @param {object} team - Team object
         * @returns {string} Formatted period display
         */
        getPeriodDisplay: function(team) {
            if (!team) return '-';

            if (team.type === 'academic') {
                if (team.startPeriod && team.endPeriod) {
                    return 'Wk ' + team.startPeriod + ' - Wk ' + team.endPeriod;
                } else if (team.startPeriod) {
                    return 'From Wk ' + team.startPeriod;
                }
                return '-';
            } else {
                if (team.startPeriod && team.endPeriod) {
                    return team.startPeriod + ' - ' + team.endPeriod;
                } else if (team.startPeriod) {
                    return 'From ' + team.startPeriod;
                }
                return '-';
            }
        },

        /**
         * Get team type label
         * @param {string} type - Team type
         * @returns {string} Human-readable label
         */
        getTypeLabel: function(type) {
            var normalized = normalizeTeamType(type);
            var labels = {
                'academic': '📚 Academic',
                'professional': '💼 Professional',
                'temporary': '📋 Temporary',
                'civilian': '👤 Civilian'
            };
            return labels[normalized] || type || 'Unknown';
        },

        /**
         * Get status info for a member
         * @param {string} status - Status string
         * @returns {object} { label, color }
         */
        getMemberStatusInfo: function(status) {
            var map = {
                'active': { label: 'Active', color: 'var(--accent)' },
                'left': { label: 'Former', color: 'var(--text-dim)' },
                'deceased': { label: 'Deceased', color: 'var(--danger)' },
                'eliminated': { label: 'Eliminated', color: 'var(--danger)' },
                'future': { label: 'Future Member', color: 'var(--warning)' },
                'unknown': { label: 'Unknown', color: 'var(--text-dim)' }
            };
            return map[status] || map['unknown'];
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamCore = TeamCore;

    console.log('team-core.js loaded');

})();
