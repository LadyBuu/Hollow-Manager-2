/**
 * js/modules/teams/team-modals.js - Team Modal Dialogs
 * Handles team form, member modal, and ranking modal
 * Path: js/modules/teams/team-modals.js
 */

(function() {
    'use strict';

    var TeamModals = {
        /**
         * Show the team form modal
         * @param {string} editId - Team ID for editing, or null for new
         * @param {string} type - Team type (for new team)
         */
        showTeamForm: function(editId, type) {
            var modal = document.getElementById('team-form-modal');
            var title = document.getElementById('team-form-title');
            var form = document.getElementById('team-form-inner');

            if (!modal) {
                console.error('Team form modal not found');
                return;
            }

            modal.classList.remove('hidden');

            // Populate selectors
            this.populateClassSelector();
            this.populateMissionSelector();

            if (editId) {
                title.textContent = 'Edit Team';
                var team = window.TeamCore.getTeam(editId);
                if (team) {
                    document.getElementById('team-name').value = team.name || '';
                    document.getElementById('team-type').value = team.type || 'academic';
                    document.getElementById('team-start').value = team.startPeriod || '';
                    document.getElementById('team-end').value = team.endPeriod || '';
                    document.getElementById('team-ranking').value = team.currentRank || '';
                    document.getElementById('team-status').value = team.status || 'active';
                    if (team.temporaryMission) {
                        document.getElementById('team-mission').value = team.temporaryMission;
                    }
                    if (team.type === 'academic') {
                        if (team.classId) {
                            document.getElementById('team-class').value = team.classId;
                        }
                        document.getElementById('team-number').value = team.teamNumber || '';
                    }
                    form.dataset.editId = editId;

                    // Populate name history
                    var container = document.getElementById('name-history-container');
                    container.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        team.nameHistory.forEach(function(entry) {
                            TeamModals.addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                        });
                    } else {
                        TeamModals.addNameHistoryEntry(container);
                    }
                }
            } else {
                title.textContent = 'Add Team';
                form.reset();
                document.getElementById('team-type').value = type || 'academic';
                document.getElementById('team-status').value = 'active';
                delete form.dataset.editId;

                var container = document.getElementById('name-history-container');
                container.innerHTML = '';
                TeamModals.addNameHistoryEntry(container);
            }

            TeamModals.updatePeriodLabels();
            TeamModals.toggleAcademicFields(document.getElementById('team-type').value);
            TeamModals.toggleMissionField(document.getElementById('team-type').value);
        },

        /**
         * Show the member management modal
         * @param {string} teamId - Team ID
         * @param {string} tab - Current tab
         */
        showMemberModal: function(teamId, tab) {
            var modal = document.getElementById('member-modal');
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return;

            var data = window.data || {};
            var currentPeriod = team.type === 'academic' 
                ? (window.teamState ? window.teamState.filters.academic.filterWeek || 1 : 1) 
                : (data.currentYear || new Date().getFullYear());

            document.getElementById('modal-team-name').textContent = team.name + ' - Members (Full History)';

            // Populate character selector
            var select = document.getElementById('member-character');
            select.innerHTML = '<option value="">Select character...</option>';

            var eligibleChars = window.TeamMembers.getEligibleCharacters(team.type);
            var currentMemberIds = [];
            var formerMemberIds = [];

            if (team.members) {
                team.members.forEach(function(m) {
                    var status = team.type === 'academic' 
                        ? window.TeamMembers.getStatusAtWeek(m, currentPeriod) 
                        : window.TeamMembers.getStatusAtPeriod(m, currentPeriod, team.type);
                    if (status === 'active' || status === 'future') {
                        currentMemberIds.push(m.characterId);
                    } else {
                        formerMemberIds.push(m.characterId);
                    }
                });
            }

            // Group characters
            var inTeamChars = [];
            var availableChars = [];
            var inOtherTeamChars = [];
            var formerChars = [];
            var eliminatedChars = [];
            var deceasedChars = [];

            eligibleChars.forEach(function(char) {
                var charId = char.id;
                var inTeam = currentMemberIds.indexOf(charId) !== -1;
                var isFormer = formerMemberIds.indexOf(charId) !== -1;
                var isDeceased = char.deceased || false;
                var isEliminated = false;

                if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
                    for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                        var elimWeek = parseInt(char.eliminatedWeeks[i]);
                        if (!isNaN(elimWeek) && elimWeek <= currentPeriod) {
                            isEliminated = true;
                            break;
                        }
                    }
                }

                if (inTeam) {
                    inTeamChars.push(char);
                } else if (isDeceased) {
                    deceasedChars.push(char);
                } else if (isEliminated) {
                    eliminatedChars.push(char);
                } else if (isFormer) {
                    formerChars.push(char);
                } else {
                    // Check if in another team
                    var inOtherTeam = false;
                    var data = window.data || {};
                    if (data.teams) {
                        for (var i = 0; i < data.teams.length; i++) {
                            var t = data.teams[i];
                            if (String(t.id) === String(teamId)) continue;
                            if (t.status === 'deleted') continue;
                            if (t.members && t.members.some(function(m) { return String(m.characterId) === String(charId); })) {
                                inOtherTeam = true;
                                break;
                            }
                        }
                    }
                    if (inOtherTeam) {
                        inOtherTeamChars.push(char);
                    } else {
                        availableChars.push(char);
                    }
                }
            });

            // Sort and add to select
            var allGroups = [
                { items: inTeamChars, label: '— Already in Team —', style: 'color:var(--accent);font-weight:bold;' },
                { items: availableChars, label: '— Available —', style: '' },
                { items: inOtherTeamChars, label: '— In Other Teams —', style: 'color:var(--text-dim);' },
                { items: formerChars, label: '— Former Members —', style: 'color:var(--text-dim);font-style:italic;' },
                { items: eliminatedChars, label: '— Eliminated —', style: 'color:var(--danger);' },
                { items: deceasedChars, label: '— Deceased —', style: 'color:var(--danger);text-decoration:line-through;' }
            ];

            var hasItems = false;
            allGroups.forEach(function(group) {
                if (group.items.length > 0) {
                    if (hasItems) {
                        var separator = document.createElement('option');
                        separator.disabled = true;
                        separator.textContent = group.label;
                        separator.style.color = 'var(--text-dim)';
                        select.appendChild(separator);
                    } else {
                        hasItems = true;
                    }

                    group.items.forEach(function(char) {
                        var name = window.getDisplayName(char);
                        var status = window.getCurrentStatus(char);
                        var option = document.createElement('option');
                        option.value = char.id;
                        option.textContent = name + ' [' + status + ']';
                        if (group.style) {
                            option.style.cssText = group.style;
                        }
                        select.appendChild(option);
                    });
                }
            });

            // Reset form fields
            document.getElementById('member-role').value = '';
            document.getElementById('member-join').value = '';
            document.getElementById('member-leave').value = '';

            // Render members list
            var membersHtml = window.TeamMembers.renderList(team, currentPeriod);
            document.getElementById('members-list').innerHTML = membersHtml;

            modal.dataset.teamId = teamId;
            modal.dataset.tab = tab || 'academic';
            modal.classList.remove('hidden');

            // Attach member events
            TeamModals.attachMemberEvents(teamId, tab);
        },

        /**
         * Show the ranking modal
         * @param {string} teamId - Team ID
         * @param {string} tab - Current tab
         */
        showRankingModal: function(teamId, tab) {
            var modal = document.getElementById('ranking-modal');
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return;

            var periodLabel = team.type === 'academic' ? 'Week Block' : 'Period';
            document.getElementById('ranking-modal-title').textContent = team.name + ' - Ranking History';
            document.getElementById('ranking-week').placeholder = periodLabel + ' (e.g., 1 for weeks 1-2)';
            document.getElementById('ranking-week').value = '';
            document.getElementById('ranking-rank').value = '';

            modal.dataset.teamId = teamId;
            modal.dataset.tab = tab || 'academic';

            // Render rankings
            var rankingsHtml = window.TeamRankings.renderList(team);
            document.getElementById('ranking-list').innerHTML = rankingsHtml;

            modal.classList.remove('hidden');

            // Attach ranking events
            TeamModals.attachRankingEvents(teamId, tab);
        },

        /**
         * Populate class selector
         */
        populateClassSelector: function() {
            var select = document.getElementById('team-class');
            if (!select) return;

            var classes = window.getClasses();
            var currentValue = select.value;
            select.innerHTML = '<option value="">Unassigned</option>';
            classes.forEach(function(cls) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                select.appendChild(option);
            });
            if (currentValue) select.value = currentValue;
        },

        /**
         * Populate mission selector
         */
        populateMissionSelector: function() {
            var select = document.getElementById('team-mission');
            if (!select) return;

            var data = window.data || {};
            var missions = data.missions || [];
            select.innerHTML = '<option value="">None</option>';
            var sortedMissions = missions.slice().sort(function(a, b) {
                if (a.status === 'active' && b.status !== 'active') return -1;
                if (a.status !== 'active' && b.status === 'active') return 1;
                return a.title.localeCompare(b.title);
            });
            sortedMissions.forEach(function(mission) {
                if (mission.status !== 'cancelled') {
                    var option = document.createElement('option');
                    option.value = mission.id;
                    option.textContent = mission.title + (mission.status === 'completed' ? ' (completed)' : '');
                    select.appendChild(option);
                }
            });
        },

        /**
         * Toggle academic fields visibility
         */
        toggleAcademicFields: function(type) {
            var fields = document.getElementById('academic-team-fields');
            if (fields) {
                fields.style.display = (type === 'academic') ? 'block' : 'none';
            }
        },

        /**
         * Toggle mission field visibility
         */
        toggleMissionField: function(type) {
            var field = document.getElementById('temporary-mission-field');
            if (field) {
                field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
            }
        },

        /**
         * Update period labels based on team type
         */
        updatePeriodLabels: function() {
            var typeSelect = document.getElementById('team-type');
            if (!typeSelect) return;

            var type = typeSelect.value;
            var startLabel = document.getElementById('team-start-label');
            var endLabel = document.getElementById('team-end-label');
            var startInput = document.getElementById('team-start');
            var endInput = document.getElementById('team-end');

            if (type === 'academic') {
                if (startLabel) startLabel.textContent = 'Start Week';
                if (endLabel) endLabel.textContent = 'End Week (optional)';
                if (startInput) startInput.placeholder = 'Week (e.g., 1)';
                if (endInput) endInput.placeholder = 'Week (e.g., 52)';
            } else {
                if (startLabel) startLabel.textContent = 'Start Period';
                if (endLabel) endLabel.textContent = 'End Period (optional)';
                if (startInput) startInput.placeholder = 'Year or date';
                if (endInput) endInput.placeholder = 'Year or date';
            }

            TeamModals.toggleAcademicFields(type);
            TeamModals.toggleMissionField(type);
        },

        /**
         * Add a name history entry
         */
        addNameHistoryEntry: function(container, name, start, end) {
            var entry = document.createElement('div');
            entry.className = 'name-history-entry';
            entry.innerHTML = `
                <input type="text" class="name-history-name" placeholder="Team Name" value="${name || ''}">
                <input type="text" class="name-history-start" placeholder="Start" value="${start || ''}">
                <input type="text" class="name-history-end" placeholder="End" value="${end || ''}">
                <button type="button" class="small danger remove-name">✕</button>
            `;
            container.appendChild(entry);
            entry.querySelector('.remove-name').onclick = function() {
                if (container.children.length > 1) entry.remove();
                else alert('You need at least one name entry.');
            };
        },

        /**
         * Attach events for member modal
         */
        attachMemberEvents: function(teamId, tab) {
            var container = document.getElementById('members-list');
            if (!container) return;

            container.querySelectorAll('.edit-member').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var index = parseInt(this.dataset.index);
                    if (!isNaN(index)) {
                        TeamModals.showEditMemberModal(teamId, index, tab);
                    }
                });
            });

            container.querySelectorAll('.remove-member').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (confirm('Remove this member from the team?')) {
                        window.TeamMembers.removeMember(teamId, this.dataset.char);
                        TeamModals.showMemberModal(teamId, tab);
                        if (typeof window.renderTeamTab === 'function') {
                            window.renderTeamTab(tab);
                        }
                    }
                });
            });
        },

        /**
         * Attach events for ranking modal
         */
        attachRankingEvents: function(teamId, tab) {
            var container = document.getElementById('ranking-list');
            if (!container) return;

            container.querySelectorAll('.remove-ranking').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (confirm('Remove this ranking entry?')) {
                        window.TeamRankings.removeRanking(teamId, this.dataset.period);
                        TeamModals.showRankingModal(teamId, tab);
                        if (typeof window.renderTeamTab === 'function') {
                            window.renderTeamTab(tab);
                        }
                    }
                });
            });
        },

        /**
         * Show edit member modal
         */
        showEditMemberModal: function(teamId, index, tab) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.members || !team.members[index]) {
                alert('Member not found.');
                return;
            }

            var member = team.members[index];
            var char = window.getCharacterById(member.characterId);
            var name = char ? window.getDisplayName(char) : 'Unknown';

            document.getElementById('edit-member-name').textContent = name;
            document.getElementById('edit-member-role').value = member.role || '';
            document.getElementById('edit-member-join').value = member.joinPeriod || '';
            document.getElementById('edit-member-leave').value = member.leavePeriod || '';

            var modal = document.getElementById('edit-member-modal');
            modal.dataset.teamId = teamId;
            modal.dataset.index = index;
            modal.dataset.tab = tab || 'academic';
            modal.classList.remove('hidden');
        },

        /**
         * Close modals
         */
        closeTeamForm: function() {
            document.getElementById('team-form-modal').classList.add('hidden');
        },

        closeMemberModal: function() {
            document.getElementById('member-modal').classList.add('hidden');
        },

        closeEditMemberModal: function() {
            document.getElementById('edit-member-modal').classList.add('hidden');
        },

        closeRankingModal: function() {
            document.getElementById('ranking-modal').classList.add('hidden');
        }
    };

    window.TeamModals = TeamModals;


})();
