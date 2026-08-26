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
 *   - 'deleted': Physically removed from the system (soft-delete is not used)
 * 
 * TEAM TYPES:
 *   - 'academic': Academic/educational teams
 *   - 'professional': Professional/working teams
 *   - 'temporary': Temporary or project-based teams
 *   - 'civilian': Civilian/non-combatant teams
 * 
 * MEMBERSHIP SEMANTICS:
 *   - joinPeriod: The period (week/year) when the member joined
 *   - leavePeriod: The period (week/year) when the member left
 *   - Membership is inclusive: join <= period <= leave means active
 *   - For academic teams, period is a week number (1-52)
 *   - For other teams, period is a year or custom identifier
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
        return type && VALID_TEAM_TYPES.indexOf(type) !== -1;
    }

    function isValidTeamStatus(status) {
        return status && VALID_TEAM_STATUSES.indexOf(status) !== -1;
    }

    function sanitizeTeamData(teamData) {
        teamData = teamData || {};
        return {
            name: teamData.name || 'Unnamed Team',
            type: isValidTeamType(teamData.type) ? teamData.type : 'academic',
            startPeriod: teamData.startPeriod || '',
            endPeriod: teamData.endPeriod || '',
            currentRank: teamData.currentRank || '',
            status: isValidTeamStatus(teamData.status) ? teamData.status : 'active',
            nameHistory: Array.isArray(teamData.nameHistory) ? teamData.nameHistory.slice() : [],
            temporaryMission: teamData.temporaryMission || null,
            classId: teamData.classId || null,
            teamNumber: teamData.teamNumber || ''
        };
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
         * @param {string} type - Team type filter
         * @param {string} status - Team status filter
         * @returns {array} Array of team objects (read-only, do not mutate directly)
         */
        getTeams: function(type, status) {
            var data = window.data || {};
            if (!data.teams) return [];

            var teams = data.teams.filter(function(t) {
                // Deleted teams are physically removed, so this filter is redundant
                // but kept for safety
                return t.status !== 'deleted';
            });

            if (type && isValidTeamType(type)) {
                teams = teams.filter(function(t) { return t.type === type; });
            }

            if (status) {
                if (status === 'active') {
                    teams = teams.filter(function(t) { return t.status === 'active'; });
                } else if (status === 'inactive') {
                    teams = teams.filter(function(t) { return t.status === 'inactive' || t.status === 'deprecated'; });
                }
            }

            // Return a shallow copy to discourage direct mutation
            return teams.slice();
        },

        /**
         * Create a new team
         * @param {object} teamData - Team data (mutates window.data, caller saves)
         * @returns {object} Created team
         */
        createTeam: function(teamData) {
            var data = window.data || {};
            if (!data.teams) data.teams = [];

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

            var oldName = team.name;
            var oldType = team.type;

            // Whitelist allowed properties - prevents accidental mutation of id, members, etc.
            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] !== undefined) {
                    // Validate type before applying
                    if (key === 'type' && !isValidTeamType(updates[key])) {
                        console.warn('updateTeam: Invalid team type "' + updates[key] + '" ignored');
                        return;
                    }
                    if (key === 'status' && !isValidTeamStatus(updates[key])) {
                        console.warn('updateTeam: Invalid team status "' + updates[key] + '" ignored');
                        return;
                    }
                    if (key === 'nameHistory' && !Array.isArray(updates[key])) {
                        console.warn('updateTeam: nameHistory must be an array, ignored');
                        return;
                    }
                    team[key] = updates[key];
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

            var nameChanged = (updates.name !== undefined && updates.name !== oldName);
            var typeChanged = (updates.type !== undefined && updates.type !== oldType);

            if (typeof window.logActivity === 'function') {
                var changes = [];
                if (nameChanged) changes.push('name');
                if (typeChanged) changes.push('type');
                if (changes.length > 0) {
                    window.logActivity('Updated team: ' + (updates.name || oldName) + ' (' + changes.join(', ') + ')');
                } else {
                    window.logActivity('Updated team: ' + (updates.name || oldName));
                }
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

        /**
         * Get active members of a team at a given period
         * @param {object} team - Team object
         * @param {number} period - Week (academic) or Year (other types)
         * @returns {array} Array of active members
         */
        getActiveMembers: function(team, period) {
            if (!team || !team.members) return [];
            var periodNum = parseInt(period) || 1;

            return team.members.filter(function(m) {
                var join = parseInt(m.joinPeriod);
                var leave = parseInt(m.leavePeriod);

                // For academic teams, joinPeriod is required
                if (team.type === 'academic') {
                    return !isNaN(join) && join <= periodNum && (isNaN(leave) || leave >= periodNum);
                }

                // For non-academic teams, if joinPeriod is missing, assume "from beginning"
                if (isNaN(join)) return true;
                return join <= periodNum && (isNaN(leave) || leave >= periodNum);
            });
        },

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
            var labels = {
                'academic': '📚 Academic',
                'professional': '💼 Professional',
                'temporary': '📋 Temporary',
                'civilian': '👤 Civilian'
            };
            return labels[type] || type || 'Unknown';
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
