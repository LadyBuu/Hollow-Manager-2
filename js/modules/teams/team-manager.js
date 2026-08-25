/**
 * js/modules/teams/team-manager.js - Team Manager
 * Path: js/modules/teams/team-manager.js
 */

(function() {
    'use strict';

    var teamState = {
        currentTab: 'all',
        expandedTeamId: null,
        currentTeamId: null
    };

    window.teamState = teamState;

    function renderTeamManager(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        if (!window.data.teams) {
            window.data.teams = [];
        }

        renderDirect(container);
        initTeamManagerEvents(container);
    }

    function renderDirect(container) {
        var allTeams = window.data.teams || [];
        
        var academicTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
        var professionalTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
        var temporaryTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
        var civilianTeams = allTeams.filter(function(t) { return t.type === 'civilian'; });

        var html = '';
        
        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Academic</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--accent);margin:2px 0;">' + academicTeams.length + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Professional</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--info);margin:2px 0;">' + professionalTeams.length + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Temporary</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--warning);margin:2px 0;">' + temporaryTeams.length + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Civilian</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--text-dim);margin:2px 0;">' + civilianTeams.length + '</p></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'all' ? 'active' : '') + '" data-tab="all" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'all' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'all' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">All Teams (' + allTeams.length + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'academic' ? 'active' : '') + '" data-tab="academic" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'academic' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'academic' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Academic (' + academicTeams.length + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'professional' ? 'active' : '') + '" data-tab="professional" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'professional' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'professional' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Professional (' + professionalTeams.length + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'temporary' ? 'active' : '') + '" data-tab="temporary" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'temporary' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'temporary' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Temporary (' + temporaryTeams.length + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'civilian' ? 'active' : '') + '" data-tab="civilian" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'civilian' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'civilian' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Civilian (' + civilianTeams.length + ')</button>';
        html += '</div>';

        // Team list container
        html += '<div id="team-list-container"></div>';

        // Modals (hidden by default)
        html += getModalsHTML();

        container.innerHTML = html;

        // Render teams for current tab
        var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
        renderTeamList(filteredTeams, container);
    }

    function getFilteredTeams(allTeams, tab) {
        if (tab === 'all') return allTeams;
        if (tab === 'academic') return allTeams.filter(function(t) { return t.type === 'academic'; });
        if (tab === 'professional') return allTeams.filter(function(t) { return t.type === 'professional'; });
        if (tab === 'temporary') return allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
        if (tab === 'civilian') return allTeams.filter(function(t) { return t.type === 'civilian'; });
        return allTeams;
    }

    function getModalsHTML() {
        return `
            <!-- Team Form Modal -->
            <div id="team-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="team-form-title">Add Team</h3>
                        <button class="close-modal" id="close-team-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="team-form-inner">
                            <div class="form-grid">
                                <div class="form-group full-width">
                                    <label>Team Name *</label>
                                    <input type="text" id="team-name" required>
                                </div>
                                <div class="form-group">
                                    <label>Team Type *</label>
                                    <select id="team-type" required>
                                        <option value="academic">Academic</option>
                                        <option value="professional">Professional</option>
                                        <option value="temporary">Temporary</option>
                                        <option value="civilian">Civilian</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label id="team-start-label">Start Period</label>
                                    <input type="text" id="team-start" placeholder="Week or Year">
                                </div>
                                <div class="form-group">
                                    <label id="team-end-label">End Period (optional)</label>
                                    <input type="text" id="team-end" placeholder="Week or Year">
                                </div>
                                <div class="form-group">
                                    <label>Current Ranking</label>
                                    <input type="number" id="team-ranking" placeholder="Rank" min="1">
                                </div>
                                <div class="form-group">
                                    <label>Status</label>
                                    <select id="team-status">
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                        <option value="deprecated">Deprecated</option>
                                    </select>
                                </div>
                                <div id="academic-team-fields" style="display:none;grid-column:1/-1;">
                                    <div class="form-group">
                                        <label>Class</label>
                                        <select id="team-class" style="width:100%;padding:8px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                            <option value="">Unassigned</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Team Number (optional)</label>
                                        <input type="text" id="team-number" placeholder="e.g., A, B, 1, 2...">
                                    </div>
                                </div>
                                <div class="form-group full-width" id="temporary-mission-field" style="display:none;">
                                    <label>Associated Mission</label>
                                    <select id="team-mission">
                                        <option value="">None</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label>Name History</label>
                                    <div id="name-history-container">
                                        <div class="name-history-entry">
                                            <input type="text" class="name-history-name" placeholder="Team Name">
                                            <input type="text" class="name-history-start" placeholder="Start">
                                            <input type="text" class="name-history-end" placeholder="End">
                                            <button type="button" class="small danger remove-name">✕</button>
                                        </div>
                                    </div>
                                    <button type="button" id="add-name-history-btn" class="small" style="margin-top:8px;">+ Add Name Period</button>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-team-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-team-btn" class="primary">Save Team</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Member Modal -->
            <div id="member-modal" class="modal hidden">
                <div class="modal-content" style="max-width:800px;">
                    <div class="modal-header">
                        <h3 id="modal-team-name">Team Members</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="member-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
                            <select id="member-character" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <option value="">Select character...</option>
                            </select>
                            <input type="text" id="member-role" placeholder="Role" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="text" id="member-join" placeholder="Join" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="text" id="member-leave" placeholder="Leave" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <button id="add-member-btn" class="primary small">Add Member</button>
                        </div>
                        <div id="members-list">
                            <p class="empty-state">No members in this team</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Edit Member Modal -->
            <div id="edit-member-modal" class="modal hidden">
                <div class="modal-content small">
                    <div class="modal-header">
                        <h3>Edit Member</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="edit-member-form">
                            <div class="form-group">
                                <label>Character</label>
                                <p id="edit-member-name" style="margin:4px 0 12px 0;font-weight:600;"></p>
                            </div>
                            <div class="form-group">
                                <label>Role</label>
                                <input type="text" id="edit-member-role">
                            </div>
                            <div class="form-group">
                                <label>Join</label>
                                <input type="text" id="edit-member-join">
                            </div>
                            <div class="form-group">
                                <label>Leave</label>
                                <input type="text" id="edit-member-leave">
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-edit-member" class="secondary">Cancel</button>
                                <button type="submit" id="save-edit-member" class="primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Ranking Modal -->
            <div id="ranking-modal" class="modal hidden">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="ranking-modal-title">Ranking History</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="ranking-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
                            <input type="text" id="ranking-week" placeholder="Period" style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="number" id="ranking-rank" placeholder="Rank" min="1" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <button id="add-ranking-btn" class="primary small">Add Ranking</button>
                        </div>
                        <div id="ranking-list">
                            <p class="empty-state">No ranking history</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTeamList(teams, container) {
        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) return;

        if (teams.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:20px;">No teams found.</p>';
            return;
        }

        var html = '';
        html += '<div class="list-header team-header" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">';
        html += '<span>Team Name</span>';
        html += '<span>Type</span>';
        html += '<span>Period</span>';
        html += '<span>Status</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        teams.forEach(function(team) {
            var memberCount = team.members ? team.members.length : 0;
            var typeLabel = team.type || 'unknown';
            var periodDisplay = getPeriodDisplay(team);
            var isExpanded = (teamState.expandedTeamId === team.id);
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var style = isInactive ? 'opacity:0.6;background:var(--panel-alt);' : '';

            html += '<div class="list-item team-item" data-id="' + team.id + '" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;' + style + '">';
            html += '<span><strong>' + team.name + '</strong></span>';
            html += '<span style="font-size:0.75rem;">' + typeLabel + '</span>';
            html += '<span style="font-size:0.75rem;">' + periodDisplay + '</span>';
            html += '<span style="font-size:0.75rem;color:' + (team.status === 'active' ? 'var(--accent)' : 'var(--text-dim)') + ';">' + (team.status || 'active') + '</span>';
            html += '<span class="actions" style="display:flex;gap:4px;flex-wrap:wrap;">';
            html += '<button class="small toggle-members" data-id="' + team.id + '" style="padding:2px 8px;font-size:0.65rem;">' + (isExpanded ? '▾' : '▸') + ' ' + memberCount + '</button>';
            html += '<button class="small manage-members" data-id="' + team.id + '" style="padding:2px 8px;font-size:0.65rem;">Members</button>';
            html += '<button class="small manage-rankings" data-id="' + team.id + '" style="padding:2px 8px;font-size:0.65rem;">Rankings</button>';
            html += '<button class="small edit-team" data-id="' + team.id + '" style="padding:2px 8px;font-size:0.65rem;">Edit</button>';
            html += '<button class="small danger delete-team" data-id="' + team.id + '" style="padding:2px 8px;font-size:0.65rem;">Delete</button>';
            html += '</span>';
            html += '</div>';

            if (isExpanded) {
                html += '<div class="team-members-expanded" data-team-id="' + team.id + '" style="display:block;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;margin-bottom:4px;">';
                if (team.members && team.members.length > 0) {
                    html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Members:</div>';
                    team.members.forEach(function(member) {
                        var char = window.getCharacterById(member.characterId);
                        var name = char ? window.getDisplayName(char) : 'Unknown';
                        var deadMarker = char && char.deceased ? ' ✝' : '';
                        html += '<div class="member-entry" style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid var(--border-soft);font-size:0.75rem;">';
                        html += '<span>' + name + deadMarker + ' <span class="role" style="color:var(--text-dim);font-size:0.7rem;">(' + (member.role || 'Member') + ')</span></span>';
                        html += '<span style="color:var(--text-dim);font-size:0.7rem;">Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + '</span>';
                        html += '</div>';
                    });
                } else {
                    html += '<div class="member-entry empty" style="color:var(--text-dim);font-size:0.8rem;">No members</div>';
                }
                html += '</div>';
            }
        });

        listContainer.innerHTML = html;

        // Attach events to the new elements
        attachTeamEvents(container);
    }

    function getPeriodDisplay(team) {
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
    }

    function getTeam(id) {
        if (!id) return null;
        var data = window.data || {};
        if (!data.teams) return null;
        return data.teams.find(function(t) { return String(t.id) === String(id); }) || null;
    }

    function attachTeamEvents(container) {
        // Toggle members
        container.querySelectorAll('.toggle-members').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.dataset.id;
                if (teamState.expandedTeamId === id) {
                    teamState.expandedTeamId = null;
                } else {
                    teamState.expandedTeamId = id;
                }
                // Re-render
                var allTeams = window.data.teams || [];
                var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
                renderTeamList(filteredTeams, container);
            });
        });

        // Manage members
        container.querySelectorAll('.manage-members').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                openMemberModal(this.dataset.id, container);
            });
        });

        // Manage rankings
        container.querySelectorAll('.manage-rankings').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                openRankingModal(this.dataset.id, container);
            });
        });

        // Edit team
        container.querySelectorAll('.edit-team').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                showTeamForm(this.dataset.id, container);
            });
        });

        // Delete team
        container.querySelectorAll('.delete-team').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (confirm('Delete this team permanently?')) {
                    deleteTeam(this.dataset.id, container);
                }
            });
        });
    }

    function openMemberModal(teamId, container) {
        var team = getTeam(teamId);
        if (!team) return;

        var modal = document.getElementById('member-modal');
        if (!modal) return;

        document.getElementById('modal-team-name').textContent = team.name + ' - Members';

        var select = document.getElementById('member-character');
        if (select) {
            select.innerHTML = '<option value="">Select character...</option>';
            var chars = window.data.characters || [];
            var currentMemberIds = (team.members || []).map(function(m) { return m.characterId; });
            
            chars.forEach(function(char) {
                var isInTeam = currentMemberIds.indexOf(char.id) !== -1;
                var option = document.createElement('option');
                option.value = char.id;
                option.textContent = window.getDisplayName(char) + ' [' + window.getCurrentStatus(char) + ']';
                if (isInTeam) {
                    option.style.color = 'var(--accent)';
                    option.textContent += ' ✓ In Team';
                    option.disabled = true;
                }
                select.appendChild(option);
            });
        }

        document.getElementById('member-role').value = '';
        document.getElementById('member-join').value = '';
        document.getElementById('member-leave').value = '';

        renderMembers(team);
        modal.dataset.teamId = teamId;
        modal.dataset.container = container;
        modal.classList.remove('hidden');
    }

    function renderMembers(team) {
        var container = document.getElementById('members-list');
        if (!container) return;
        
        if (!team.members || team.members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members in this team</p>';
            return;
        }

        var html = '';
        team.members.forEach(function(member, index) {
            var char = window.getCharacterById(member.characterId);
            var name = char ? window.getDisplayName(char) : 'Unknown';
            html += '<div class="member-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span><strong>' + name + '</strong> <span class="role" style="color:var(--text-dim);font-size:0.75rem;">' + (member.role || 'Member') + '</span></span>';
            html += '<span style="color:var(--text-dim);font-size:0.7rem;">Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + '</span>';
            html += '<div class="member-actions" style="display:flex;gap:4px;">';
            html += '<button class="small edit-member" data-index="' + index + '" style="padding:2px 8px;font-size:0.65rem;">Edit</button>';
            html += '<button class="small danger remove-member" data-char="' + member.characterId + '" style="padding:2px 8px;font-size:0.65rem;">Remove</button>';
            html += '</div>';
            html += '</div>';
        });
        container.innerHTML = html;

        var modal = document.getElementById('member-modal');
        var teamId = modal.dataset.teamId;

        container.querySelectorAll('.edit-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var index = parseInt(this.dataset.index);
                if (!isNaN(index)) {
                    openEditMemberModal(teamId, index);
                }
            });
        });

        container.querySelectorAll('.remove-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (confirm('Remove this member from the team?')) {
                    removeMember(teamId, this.dataset.char);
                }
            });
        });
    }

    function openEditMemberModal(teamId, index) {
        var team = getTeam(teamId);
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
        modal.classList.remove('hidden');
    }

    function openRankingModal(teamId, container) {
        var team = getTeam(teamId);
        if (!team) return;

        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

        document.getElementById('ranking-modal-title').textContent = team.name + ' - Ranking History';
        document.getElementById('ranking-week').value = '';
        document.getElementById('ranking-rank').value = '';

        modal.dataset.teamId = teamId;
        modal.dataset.container = container;

        renderRankings(team);
        modal.classList.remove('hidden');
    }

    function renderRankings(team) {
        var container = document.getElementById('ranking-list');
        if (!container) return;
        
        if (!team.rankingHistory || team.rankingHistory.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking history</p>';
            return;
        }

        var html = '';
        team.rankingHistory.forEach(function(entry) {
            html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span><strong>#' + entry.rank + '</strong> - ' + entry.period + '</span>';
            html += '<button class="small danger remove-ranking" data-period="' + entry.period + '" style="padding:2px 8px;font-size:0.65rem;">Remove</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        var modal = document.getElementById('ranking-modal');
        var teamId = modal.dataset.teamId;

        container.querySelectorAll('.remove-ranking').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Remove this ranking entry?')) {
                    removeRanking(teamId, this.dataset.period);
                }
            });
        });
    }

    function showTeamForm(editId, container) {
        var modal = document.getElementById('team-form-modal');
        if (!modal) return;
        
        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        // Populate class selector
        var classSelect = document.getElementById('team-class');
        if (classSelect) {
            var classes = window.getClasses() || [];
            var currentValue = classSelect.value;
            classSelect.innerHTML = '<option value="">Unassigned</option>';
            classes.forEach(function(cls) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                classSelect.appendChild(option);
            });
            if (currentValue) classSelect.value = currentValue;
        }

        // Populate mission selector
        var missionSelect = document.getElementById('team-mission');
        if (missionSelect) {
            var missions = window.data.missions || [];
            missionSelect.innerHTML = '<option value="">None</option>';
            missions.forEach(function(mission) {
                var option = document.createElement('option');
                option.value = mission.id;
                option.textContent = mission.title;
                missionSelect.appendChild(option);
            });
        }

        if (editId) {
            title.textContent = 'Edit Team';
            var team = getTeam(editId);
            if (team) {
                document.getElementById('team-name').value = team.name || '';
                document.getElementById('team-type').value = team.type || 'academic';
                document.getElementById('team-start').value = team.startPeriod || '';
                document.getElementById('team-end').value = team.endPeriod || '';
                document.getElementById('team-ranking').value = team.currentRank || '';
                document.getElementById('team-status').value = team.status || 'active';
                if (team.classId) {
                    document.getElementById('team-class').value = team.classId;
                }
                if (team.teamNumber) {
                    document.getElementById('team-number').value = team.teamNumber;
                }
                if (team.temporaryMission) {
                    document.getElementById('team-mission').value = team.temporaryMission;
                }
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Add Team';
            form.reset();
            document.getElementById('team-type').value = 'academic';
            document.getElementById('team-status').value = 'active';
            delete form.dataset.editId;
        }

        updatePeriodLabels();
        toggleAcademicFields(document.getElementById('team-type').value);
        toggleMissionField(document.getElementById('team-type').value);
        modal.dataset.container = container;
    }

    function deleteTeam(id, container) {
        var data = window.data || {};
        if (!data.teams) return;
        
        var team = data.teams.find(function(t) { return String(t.id) === String(id); });
        if (!team) return;

        data.teams = data.teams.filter(function(t) { return String(t.id) !== String(id); });
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        
        var allTeams = window.data.teams || [];
        var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
        renderTeamList(filteredTeams, container);
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function removeMember(teamId, charId) {
        var team = getTeam(teamId);
        if (!team) return;
        
        team.members = team.members.filter(function(m) { return String(m.characterId) !== String(charId); });
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderMembers(team);
        var allTeams = window.data.teams || [];
        var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
        var container = document.getElementById('tab-teams');
        if (container) {
            renderTeamList(filteredTeams, container);
        }
    }

    function removeRanking(teamId, period) {
        var team = getTeam(teamId);
        if (!team) return;
        
        team.rankingHistory = team.rankingHistory.filter(function(r) { return String(r.period) !== String(period); });
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderRankings(team);
    }

    function toggleAcademicFields(type) {
        var fields = document.getElementById('academic-team-fields');
        if (fields) {
            fields.style.display = (type === 'academic') ? 'block' : 'none';
        }
    }

    function toggleMissionField(type) {
        var field = document.getElementById('temporary-mission-field');
        if (field) {
            field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
        }
    }

    function updatePeriodLabels() {
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

        toggleAcademicFields(type);
        toggleMissionField(type);
    }

    function initTeamManagerEvents(container) {
        // Tab switching
        var tabNav = container.querySelector('.tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;

                var tab = btn.dataset.tab;
                teamState.currentTab = tab;

                // Update tab buttons
                tabNav.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-dim)';
                    b.style.borderBottomColor = 'transparent';
                });
                btn.classList.add('active');
                btn.style.color = 'var(--accent)';
                btn.style.borderBottomColor = 'var(--accent)';

                // Update team list
                var allTeams = window.data.teams || [];
                var filteredTeams = getFilteredTeams(allTeams, tab);
                renderTeamList(filteredTeams, container);
            });
        }

        // Add team button
        var addBtn = container.querySelector('#add-team-btn');
        if (addBtn) {
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                showTeamForm(null, container);
            });
        }

        // Close form buttons
        var closeFormBtn = document.getElementById('close-team-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                document.getElementById('team-form-modal').classList.add('hidden');
            });
        }

        var cancelFormBtn = document.getElementById('cancel-team-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
                document.getElementById('team-form-modal').classList.add('hidden');
            });
        }

        var formModal = document.getElementById('team-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Form submit
        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                var editId = form.dataset.editId;
                var container = document.getElementById('team-form-modal').dataset.container;

                var teamData = {
                    name: document.getElementById('team-name').value.trim(),
                    type: document.getElementById('team-type').value,
                    startPeriod: document.getElementById('team-start').value || '',
                    endPeriod: document.getElementById('team-end').value || '',
                    currentRank: document.getElementById('team-ranking').value || '',
                    status: document.getElementById('team-status').value || 'active',
                    classId: document.getElementById('team-class').value || null,
                    teamNumber: document.getElementById('team-number').value.trim() || '',
                    temporaryMission: document.getElementById('team-mission').value || null,
                    members: [],
                    rankingHistory: []
                };

                if (teamData.type !== 'academic') {
                    teamData.classId = null;
                    teamData.teamNumber = '';
                }

                if (!teamData.name) {
                    alert('Team name is required.');
                    return;
                }

                var data = window.data || {};
                if (!data.teams) data.teams = [];

                if (editId) {
                    var index = data.teams.findIndex(function(t) { return String(t.id) === String(editId); });
                    if (index !== -1) {
                        var existing = data.teams[index];
                        teamData.members = existing.members || [];
                        teamData.rankingHistory = existing.rankingHistory || [];
                        data.teams[index] = Object.assign({}, existing, teamData);
                    }
                } else {
                    var newTeam = {
                        id: window.generateId('team'),
                        name: teamData.name,
                        type: teamData.type,
                        startPeriod: teamData.startPeriod,
                        endPeriod: teamData.endPeriod,
                        currentRank: teamData.currentRank,
                        status: teamData.status,
                        classId: teamData.classId,
                        teamNumber: teamData.teamNumber,
                        temporaryMission: teamData.temporaryMission,
                        members: [],
                        rankingHistory: [],
                        createdAt: new Date().toISOString()
                    };
                    data.teams.push(newTeam);
                }

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                document.getElementById('team-form-modal').classList.add('hidden');

                if (container) {
                    var allTeams = window.data.teams || [];
                    var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
                    renderTeamList(filteredTeams, container);
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            });
        }

        // Type select change
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                updatePeriodLabels();
            });
        }

        // Add member
        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                var teamId = modal.dataset.teamId;
                var container = modal.dataset.container;
                if (!teamId) return;

                var charId = document.getElementById('member-character').value;
                var role = document.getElementById('member-role').value.trim();
                var joinPeriod = document.getElementById('member-join').value;
                var leavePeriod = document.getElementById('member-leave').value;

                if (!charId) {
                    alert('Please select a character.');
                    return;
                }

                var team = getTeam(teamId);
                if (!team) return;

                if (!team.members) team.members = [];
                if (team.members.some(function(m) { return String(m.characterId) === String(charId); })) {
                    alert('This character is already in the team.');
                    return;
                }

                team.members.push({
                    characterId: charId,
                    role: role || 'Member',
                    joinPeriod: joinPeriod || '',
                    leavePeriod: leavePeriod || ''
                });

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                renderMembers(team);
                if (container) {
                    var allTeams = window.data.teams || [];
                    var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
                    renderTeamList(filteredTeams, container);
                }
            });
        }

        // Close member modal
        var memberClose = document.querySelector('#member-modal .close-modal');
        if (memberClose) {
            memberClose.addEventListener('click', function() {
                document.getElementById('member-modal').classList.add('hidden');
            });
        }

        var memberBg = document.getElementById('member-modal');
        if (memberBg) {
            memberBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Edit member
        var editClose = document.querySelector('#edit-member-modal .close-modal');
        if (editClose) {
            editClose.addEventListener('click', function() {
                document.getElementById('edit-member-modal').classList.add('hidden');
            });
        }

        var editBg = document.getElementById('edit-member-modal');
        if (editBg) {
            editBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        var cancelEdit = document.getElementById('cancel-edit-member');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', function() {
                document.getElementById('edit-member-modal').classList.add('hidden');
            });
        }

        var editForm = document.getElementById('edit-member-form');
        if (editForm) {
            editForm.addEventListener('submit', function(e) {
                e.preventDefault();
                var modal = document.getElementById('edit-member-modal');
                var teamId = modal.dataset.teamId;
                var index = parseInt(modal.dataset.index);

                var team = getTeam(teamId);
                if (!team || !team.members || !team.members[index]) return;

                var member = team.members[index];
                member.role = document.getElementById('edit-member-role').value.trim() || 'Member';
                member.joinPeriod = document.getElementById('edit-member-join').value || '';
                member.leavePeriod = document.getElementById('edit-member-leave').value || '';

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                document.getElementById('edit-member-modal').classList.add('hidden');
                renderMembers(team);
                var container = document.getElementById('tab-teams');
                if (container) {
                    var allTeams = window.data.teams || [];
                    var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
                    renderTeamList(filteredTeams, container);
                }
            });
        }

        // Add ranking
        var addRankBtn = document.getElementById('add-ranking-btn');
        if (addRankBtn) {
            addRankBtn.addEventListener('click', function() {
                var modal = document.getElementById('ranking-modal');
                var teamId = modal.dataset.teamId;
                var container = modal.dataset.container;
                if (!teamId) return;

                var period = document.getElementById('ranking-week').value;
                var rank = document.getElementById('ranking-rank').value;

                if (!period) {
                    alert('Please enter a period.');
                    return;
                }
                if (!rank) {
                    alert('Please enter a rank.');
                    return;
                }

                var team = getTeam(teamId);
                if (!team) return;

                if (!team.rankingHistory) team.rankingHistory = [];
                team.rankingHistory.push({ period: period, rank: rank });
                team.currentRank = rank;

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                renderRankings(team);
                if (container) {
                    var allTeams = window.data.teams || [];
                    var filteredTeams = getFilteredTeams(allTeams, teamState.currentTab);
                    renderTeamList(filteredTeams, container);
                }
            });
        }

        // Close ranking modal
        var rankClose = document.querySelector('#ranking-modal .close-modal');
        if (rankClose) {
            rankClose.addEventListener('click', function() {
                document.getElementById('ranking-modal').classList.add('hidden');
            });
        }

        var rankBg = document.getElementById('ranking-modal');
        if (rankBg) {
            rankBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Add name history
        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                var entry = document.createElement('div');
                entry.className = 'name-history-entry';
                entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';
                entry.innerHTML = `
                    <input type="text" class="name-history-name" placeholder="Team Name" style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                    <input type="text" class="name-history-start" placeholder="Start" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                    <input type="text" class="name-history-end" placeholder="End" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                    <button type="button" class="small danger remove-name" style="padding:2px 6px;font-size:0.6rem;">✕</button>
                `;
                container.appendChild(entry);
                entry.querySelector('.remove-name').onclick = function() {
                    if (container.children.length > 1) entry.remove();
                    else alert('You need at least one name entry.');
                };
            });
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('teams', renderTeamManager);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-teams');
        if (container && container.style.display !== 'none') {
            renderTeamManager(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'teams') {
            var container = document.getElementById('tab-teams');
            if (container) {
                renderTeamManager(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-teams');
            if (container && container.style.display !== 'none') {
                renderTeamManager(container);
            }
        }, 100);
    }

    window.renderTeamManager = renderTeamManager;

})();
