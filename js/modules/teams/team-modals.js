/**
 * js/modules/teams/team-modals.js - Team Modal Dialogs
 * Path: js/modules/teams/team-modals.js
 */

(function() {
    'use strict';

    var TeamModals = {
        showTeamForm: function(editId, type) {
            var modal = document.getElementById('team-form-modal');
            if (!modal) {
                // Modal doesn't exist yet - create it or wait
                return;
            }
            
            var title = document.getElementById('team-form-title');
            var form = document.getElementById('team-form-inner');

            modal.classList.remove('hidden');

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
                        var missionSelect = document.getElementById('team-mission');
                        if (missionSelect) missionSelect.value = team.temporaryMission;
                    }
                    if (team.type === 'academic') {
                        var classSelect = document.getElementById('team-class');
                        if (classSelect && team.classId) {
                            classSelect.value = team.classId;
                        }
                        var numberInput = document.getElementById('team-number');
                        if (numberInput) numberInput.value = team.teamNumber || '';
                    }
                    if (form) form.dataset.editId = editId;

                    var container = document.getElementById('name-history-container');
                    if (container) {
                        container.innerHTML = '';
                        if (team.nameHistory && team.nameHistory.length > 0) {
                            team.nameHistory.forEach(function(entry) {
                                TeamModals.addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                            });
                        } else {
                            TeamModals.addNameHistoryEntry(container);
                        }
                    }
                }
            } else {
                title.textContent = 'Add Team';
                if (form) {
                    form.reset();
                    document.getElementById('team-type').value = type || 'academic';
                    document.getElementById('team-status').value = 'active';
                    delete form.dataset.editId;
                }

                var container = document.getElementById('name-history-container');
                if (container) {
                    container.innerHTML = '';
                    TeamModals.addNameHistoryEntry(container);
                }
            }

            this.updatePeriodLabels();
            var typeSelect = document.getElementById('team-type');
            if (typeSelect) {
                this.toggleAcademicFields(typeSelect.value);
                this.toggleMissionField(typeSelect.value);
            }
        },

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

        toggleAcademicFields: function(type) {
            var fields = document.getElementById('academic-team-fields');
            if (fields) {
                fields.style.display = (type === 'academic') ? 'block' : 'none';
            }
        },

        toggleMissionField: function(type) {
            var field = document.getElementById('temporary-mission-field');
            if (field) {
                field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
            }
        },

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

            this.toggleAcademicFields(type);
            this.toggleMissionField(type);
        },

        addNameHistoryEntry: function(container, name, start, end) {
            if (!container) return;
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

        showMemberModal: function(teamId, tab) {
            var modal = document.getElementById('member-modal');
            if (!modal) return;
            
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return;

            var data = window.data || {};
            var currentPeriod = team.type === 'academic' 
                ? (window.teamState ? window.teamState.filters.academic.filterWeek || 1 : 1) 
                : (data.currentYear || new Date().getFullYear());

            var titleEl = document.getElementById('modal-team-name');
            if (titleEl) titleEl.textContent = team.name + ' - Members (Full History)';

            var select = document.getElementById('member-character');
            if (select) {
                select.innerHTML = '<option value="">Select character...</option>';
                var eligibleChars = this.getEligibleCharacters(team.type);
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

                var allChars = [];
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

                    var statusLabel = '';
                    var style = '';
                    if (inTeam) {
                        statusLabel = '✓ In Team';
                        style = 'color:var(--accent);font-weight:bold;';
                    } else if (isDeceased) {
                        statusLabel = '✝ Deceased';
                        style = 'color:var(--danger);text-decoration:line-through;';
                    } else if (isEliminated) {
                        statusLabel = '⚠ Eliminated';
                        style = 'color:var(--danger);';
                    } else if (isFormer) {
                        statusLabel = '↩ Former';
                        style = 'color:var(--text-dim);font-style:italic;';
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
                            statusLabel = '⊗ In Other Team';
                            style = 'color:var(--text-dim);';
                        } else {
                            statusLabel = '✓ Available';
                            style = 'color:var(--accent);';
                        }
                    }

                    var option = document.createElement('option');
                    option.value = char.id;
                    option.textContent = window.getDisplayName(char) + ' [' + window.getCurrentStatus(char) + '] ' + statusLabel;
                    option.style.cssText = style;
                    if (inTeam || isDeceased || isEliminated) {
                        option.disabled = true;
                    }
                    select.appendChild(option);
                });
            }

            document.getElementById('member-role').value = '';
            document.getElementById('member-join').value = '';
            document.getElementById('member-leave').value = '';

            var membersContainer = document.getElementById('members-list');
            if (membersContainer) {
                membersContainer.innerHTML = window.TeamMembers.renderList(team, currentPeriod);
            }

            modal.dataset.teamId = teamId;
            modal.dataset.tab = tab || 'academic';
            modal.classList.remove('hidden');

            this.attachMemberEvents(teamId, tab);
        },

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

        showEditMemberModal: function(teamId, index, tab) {
            var modal = document.getElementById('edit-member-modal');
            if (!modal) return;
            
            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.members || !team.members[index]) {
                alert('Member not found.');
                return;
            }

            var member = team.members[index];
            var char = window.getCharacterById(member.characterId);
            var name = char ? window.getDisplayName(char) : 'Unknown';

            var nameEl = document.getElementById('edit-member-name');
            if (nameEl) nameEl.textContent = name;
            
            var roleEl = document.getElementById('edit-member-role');
            if (roleEl) roleEl.value = member.role || '';
            
            var joinEl = document.getElementById('edit-member-join');
            if (joinEl) joinEl.value = member.joinPeriod || '';
            
            var leaveEl = document.getElementById('edit-member-leave');
            if (leaveEl) leaveEl.value = member.leavePeriod || '';

            modal.dataset.teamId = teamId;
            modal.dataset.index = index;
            modal.dataset.tab = tab || 'academic';
            modal.classList.remove('hidden');
        },

        showRankingModal: function(teamId, tab) {
            var modal = document.getElementById('ranking-modal');
            if (!modal) return;
            
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return;

            var periodLabel = team.type === 'academic' ? 'Week Block' : 'Period';
            var titleEl = document.getElementById('ranking-modal-title');
            if (titleEl) titleEl.textContent = team.name + ' - Ranking History';
            
            var weekEl = document.getElementById('ranking-week');
            if (weekEl) {
                weekEl.placeholder = periodLabel + ' (e.g., 1 for weeks 1-2)';
                weekEl.value = '';
            }
            
            var rankEl = document.getElementById('ranking-rank');
            if (rankEl) rankEl.value = '';

            modal.dataset.teamId = teamId;
            modal.dataset.tab = tab || 'academic';

            var listEl = document.getElementById('ranking-list');
            if (listEl) {
                listEl.innerHTML = window.TeamRankings.renderList(team);
            }

            modal.classList.remove('hidden');

            this.attachRankingEvents(teamId, tab);
        },

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

        closeTeamForm: function() {
            var modal = document.getElementById('team-form-modal');
            if (modal) modal.classList.add('hidden');
        },

        closeMemberModal: function() {
            var modal = document.getElementById('member-modal');
            if (modal) modal.classList.add('hidden');
        },

        closeEditMemberModal: function() {
            var modal = document.getElementById('edit-member-modal');
            if (modal) modal.classList.add('hidden');
        },

        closeRankingModal: function() {
            var modal = document.getElementById('ranking-modal');
            if (modal) modal.classList.add('hidden');
        }
    };

    window.TeamModals = TeamModals;
})();
