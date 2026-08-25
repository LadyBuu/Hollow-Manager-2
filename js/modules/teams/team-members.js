/**
 * js/modules/teams/team-members.js - Team Member Management
 * Handles adding, removing, and managing team members
 * Path: js/modules/teams/team-members.js
 */

(function() {
    'use strict';

    var TeamMembers = {
        /**
         * Get member status at a specific week (academic)
         * @param {object} member - Member object
         * @param {number} week - Week number
         * @returns {string} Status string
         */
        getStatusAtWeek: function(member, week) {
            return this.getStatusAtPeriod(member, week, 'academic');
        },

        /**
         * Get member status at a specific period
         * @param {object} member - Member object
         * @param {number} period - Week or Year
         * @param {string} teamType - Team type
         * @returns {string} Status string
         */
        getStatusAtPeriod: function(member, period, teamType) {
            var periodNum = parseInt(period) || 1;
            var join = parseInt(member.joinPeriod);
            var leave = parseInt(member.leavePeriod);

            var char = window.getCharacterById(member.characterId);

            // Check if character is deceased
            if (char && char.deceased) {
                if (char.deathYear) {
                    var deathYear = parseInt(char.deathYear);
                    if (!isNaN(deathYear) && deathYear <= periodNum) {
                        return 'deceased';
                    }
                }
                if (char.deathAge) {
                    var birthYear = parseInt(char.birthYear);
                    if (!isNaN(birthYear)) {
                        var deathYear = birthYear + parseInt(char.deathAge);
                        if (deathYear <= periodNum) {
                            return 'deceased';
                        }
                    }
                }
                return 'deceased';
            }

            // Check if character is eliminated
            if (char && char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
                for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                    var elimWeek = parseInt(char.eliminatedWeeks[i]);
                    if (!isNaN(elimWeek) && elimWeek <= periodNum) {
                        return 'eliminated';
                    }
                }
            }

            // Check membership status
            if (teamType === 'academic') {
                if (!isNaN(leave) && leave < periodNum) return 'left';
                if (!isNaN(join) && join > periodNum) return 'future';
                if (!isNaN(join) && join <= periodNum && (isNaN(leave) || leave >= periodNum)) return 'active';
            } else {
                if (!isNaN(leave) && leave < periodNum) return 'left';
                if (!isNaN(join) && join > periodNum) return 'future';
                if (isNaN(join) || (join <= periodNum && (isNaN(leave) || leave >= periodNum))) return 'active';
            }

            return 'unknown';
        },

        /**
         * Get characters eligible for a team type
         * @param {string} teamType - Team type
         * @returns {array} Array of character objects
         */
        getEligibleCharacters: function(teamType) {
            var data = window.data || {};
            var chars = data.characters || [];
            var result = [];

            chars.forEach(function(c) {
                var status = window.getCurrentStatus(c).toLowerCase();

                if (teamType === 'academic') {
                    if (status === 'trainee' || status.startsWith('trainee')) {
                        result.push(c);
                    }
                } else if (teamType === 'civilian') {
                    if (status === 'civilian') {
                        result.push(c);
                    }
                } else {
                    var allowedStatuses = ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'];
                    var isAllowed = false;
                    for (var i = 0; i < allowedStatuses.length; i++) {
                        if (status === allowedStatuses[i] || status.startsWith(allowedStatuses[i])) {
                            isAllowed = true;
                            break;
                        }
                    }
                    if (isAllowed) {
                        result.push(c);
                    }
                }
            });

            return result;
        },

        /**
         * Add a member to a team
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @param {string} role - Member role
         * @param {string} joinPeriod - Join period
         * @param {string} leavePeriod - Leave period (optional)
         * @returns {boolean} Success
         */
        addMember: function(teamId, charId, role, joinPeriod, leavePeriod) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return false;

            if (!team.members) team.members = [];

            // Check if already in team
            if (team.members.some(function(m) { return String(m.characterId) === String(charId); })) {
                return false;
            }

            team.members.push({
                characterId: charId,
                role: role || 'Member',
                joinPeriod: joinPeriod || '',
                leavePeriod: leavePeriod || ''
            });

            if (typeof window.logActivity === 'function') {
                var char = window.getCharacterById(charId);
                window.logActivity('Added ' + (char ? char.firstName : 'character') + ' to team: ' + team.name);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return true;
        },

        /**
         * Remove a member from a team
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @returns {boolean} Success
         */
        removeMember: function(teamId, charId) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.members) return false;

            var removed = team.members.filter(function(m) { return String(m.characterId) === String(charId); });
            if (removed.length === 0) return false;

            team.members = team.members.filter(function(m) { return String(m.characterId) !== String(charId); });

            if (typeof window.logActivity === 'function') {
                var char = window.getCharacterById(charId);
                window.logActivity('Removed ' + (char ? char.firstName : 'character') + ' from team: ' + team.name);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return true;
        },

        /**
         * Update a member's details
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @param {object} updates - Updates to apply
         * @returns {boolean} Success
         */
        updateMember: function(teamId, charId, updates) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.members) return false;

            var member = team.members.find(function(m) { return String(m.characterId) === String(charId); });
            if (!member) return false;

            Object.assign(member, updates);

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return true;
        },

        /**
         * Render members list for a team
         * @param {object} team - Team object
         * @param {number} filterPeriod - Current period
         * @returns {string} HTML string
         */
        renderList: function(team, filterPeriod) {
            if (!team || !team.members || team.members.length === 0) {
                return '<p class="empty-state">No members in this team</p>';
            }

            var periodLabel = team.type === 'academic' ? 'Wk' : 'Period';
            var html = '';

            // Separate active and former members
            var activeMembers = [];
            var formerMembers = [];

            team.members.forEach(function(member, index) {
                var status = team.type === 'academic' 
                    ? TeamMembers.getStatusAtWeek(member, filterPeriod) 
                    : TeamMembers.getStatusAtPeriod(member, filterPeriod, team.type);
                
                if (status === 'active' || status === 'future') {
                    activeMembers.push({ member: member, index: index, status: status });
                } else {
                    formerMembers.push({ member: member, index: index, status: status });
                }
            });

            // Sort active by join period
            activeMembers.sort(function(a, b) {
                var aJoin = parseInt(a.member.joinPeriod) || 0;
                var bJoin = parseInt(b.member.joinPeriod) || 0;
                return aJoin - bJoin;
            });

            // Sort former by priority
            formerMembers.sort(function(a, b) {
                var priorityMap = { 'active': 0, 'future': 1, 'left': 2, 'eliminated': 3, 'deceased': 4 };
                var aPriority = priorityMap[a.status] !== undefined ? priorityMap[a.status] : 5;
                var bPriority = priorityMap[b.status] !== undefined ? priorityMap[b.status] : 5;
                if (aPriority !== bPriority) return aPriority - bPriority;
                return (a.member.characterId || '').localeCompare(b.member.characterId || '');
            });

            var allMembers = activeMembers.concat(formerMembers);

            allMembers.forEach(function(item) {
                var member = item.member;
                var index = item.index;
                var status = item.status;
                var char = window.getCharacterById(member.characterId);
                var name = char ? window.getDisplayName(char) : 'Unknown';
                var age = char ? window.getCharacterAge(char) : '-';

                var statusInfo = window.TeamCore.getMemberStatusInfo(status);
                var periodDisplay = periodLabel + (member.joinPeriod || '?');
                if (member.leavePeriod) {
                    periodDisplay += ' → ' + periodLabel + member.leavePeriod;
                }

                var statusIcon = '';
                var statusSuffix = '';
                if (status === 'deceased') {
                    statusIcon = '✝ ';
                    statusSuffix = ' (Deceased)';
                } else if (status === 'eliminated') {
                    statusIcon = '⚠ ';
                    statusSuffix = ' (Eliminated)';
                } else if (status === 'left') {
                    statusIcon = '↩ ';
                    statusSuffix = ' (Former)';
                } else if (status === 'future') {
                    statusIcon = '⏳ ';
                    statusSuffix = ' (Future)';
                } else if (status === 'active') {
                    statusIcon = '✓ ';
                }

                html += '<div class="member-entry" style="border-left:3px solid ' + statusInfo.color + ';padding-left:8px;' +
                    (status === 'deceased' ? 'opacity:0.6;' : '') +
                    (status === 'left' ? 'opacity:0.7;' : '') + '" data-member-index="' + index + '">' +
                    '<div class="member-info" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;width:100%;">' +
                    '<span><strong>' + name + '</strong></span>' +
                    '<span class="role" style="color:var(--accent);font-size:0.75rem;">' + (member.role || 'Member') + '</span>' +
                    '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">' + periodDisplay + '</span>' +
                    '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">Age: ' + age + '</span>' +
                    '<span style="color:' + statusInfo.color + ';font-size:0.7rem;font-weight:600;">' + statusIcon + statusInfo.label + statusSuffix + '</span>' +
                    '<div class="member-actions" style="display:flex;gap:4px;">' +
                    '<button class="small edit-member" data-index="' + index + '">Edit</button>' +
                    '<button class="small danger remove-member" data-char="' + member.characterId + '">Remove</button>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            });

            return html;
        }
    };

    window.TeamMembers = TeamMembers;


})();
