/**
 * js/modules/teams/team-core.js - Core Team Operations
 * Handles CRUD operations for teams
 * Path: js/modules/teams/team-core.js
 */

(function() {
    'use strict';

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
         * Get teams, optionally filtered by type
         * @param {string} type - 'academic', 'professional', 'temporary', 'civilian', or null for all
         * @param {string} status - 'active', 'inactive', or null for all
         * @returns {array} Array of team objects
         */
        getTeams: function(type, status) {
            var data = window.data || {};
            if (!data.teams) return [];

            var teams = data.teams.filter(function(t) { return t.status !== 'deleted'; });

            if (type) {
                teams = teams.filter(function(t) { return t.type === type; });
            }

            if (status === 'active') {
                teams = teams.filter(function(t) { return t.status === 'active'; });
            } else if (status === 'inactive') {
                teams = teams.filter(function(t) { return t.status === 'inactive' || t.status === 'deprecated'; });
            }

            return teams;
        },

        /**
         * Create a new team
         * @param {object} teamData - Team data
         * @returns {object} Created team
         */
        createTeam: function(teamData) {
            var data = window.data || {};
            if (!data.teams) data.teams = [];

            var newTeam = {
                id: window.generateId('team'),
                name: teamData.name || 'Unnamed Team',
                type: teamData.type || 'academic',
                startPeriod: teamData.startPeriod || '',
                endPeriod: teamData.endPeriod || '',
                currentRank: teamData.currentRank || '',
                status: teamData.status || 'active',
                nameHistory: teamData.nameHistory || [],
                members: [],
                rankingHistory: [],
                temporaryMission: teamData.temporaryMission || null,
                classId: teamData.classId || null,
                teamNumber: teamData.teamNumber || '',
                createdAt: new Date().toISOString()
            };

            data.teams.push(newTeam);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Created team: ' + newTeam.name + ' (' + newTeam.type + ')');
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return newTeam;
        },

        /**
         * Update an existing team
         * @param {string} id - Team ID
         * @param {object} updates - Updates to apply
         * @returns {object|null} Updated team or null
         */
        updateTeam: function(id, updates) {
            var team = this.getTeam(id);
            if (!team) return null;

            var oldName = team.name;
            Object.assign(team, updates);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Updated team: ' + (updates.name || oldName));
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return team;
        },

        /**
         * Delete a team permanently
         * @param {string} id - Team ID
         * @returns {boolean} Success
         */
        deleteTeam: function(id) {
            var team = this.getTeam(id);
            if (!team) return false;

            var data = window.data || {};
            if (!data.teams) return false;

            data.teams = data.teams.filter(function(t) { return String(t.id) !== String(id); });

            if (typeof window.logActivity === 'function') {
                window.logActivity('Deleted team: ' + team.name);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
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

                if (team.type === 'academic') {
                    return !isNaN(join) && join <= periodNum && (isNaN(leave) || leave >= periodNum);
                } else {
                    if (isNaN(join)) return true;
                    return join <= periodNum && (isNaN(leave) || leave >= periodNum);
                }
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
                var startBlock = window.getRankingBlock(team.startPeriod);
                var endBlock = window.getRankingBlock(team.endPeriod);
                if (startBlock && endBlock) return 'Wk ' + startBlock.label + ' - Wk ' + endBlock.label;
                if (startBlock) return 'Wk ' + startBlock.label + '+';
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
                'internship': '📋 Temporary',
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

    // Expose globally
    window.TeamCore = TeamCore;

    console.log('team-core.js loaded');

})();
