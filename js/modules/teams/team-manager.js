/**
 * js/modules/teams/team-manager.js - Team Manager
 * Path: js/modules/teams/team-manager.js
 */

(function() {
    'use strict';

    var teamState = {
        currentTab: 'academic',
        expandedTeamId: null,
        currentTeamId: null,
        filters: {
            academic: { filterWeek: 1, filterStatus: 'all', filterClass: 'all' },
            professional: { filterYear: '', filterStatus: 'all' },
            temporary: { filterYear: '', filterStatus: 'all' },
            civilian: { filterStatus: 'all' }
        }
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

        container.innerHTML = getTeamManagerHTML();
        renderAllTeams();
        initTeamManagerEvents();
    }

    function getTeamManagerHTML() {
        return `
            <div class="page-header">
                <h2>Team Manager</h2>
                <button id="add-team-btn" class="primary">+ Add Team</button>
            </div>
            <div class="tab-container">
                <div class="tab-nav" id="team-tab-nav">
                    <button class="tab-btn active" data-tab="academic">Academic</button>
                    <button class="tab-btn" data-tab="professional">Professional</button>
                    <button class="tab-btn" data-tab="temporary">Temporary</button>
                    <button class="tab-btn" data-tab="civilian">Civilian</button>
                    <button class="tab-btn" data-tab="all">All Teams</button>
                </div>
                <div class="tab-content" id="team-tab-content">
                    <div id="tab-academic" class="tab-panel active" style="display:block;">
                        <div id="academic-content"></div>
                    </div>
                    <div id="tab-professional" class="tab-panel" style="display:none;">
                        <div id="professional-content"></div>
                    </div>
                    <div id="tab-temporary" class="tab-panel" style="display:none;">
                        <div id="temporary-content"></div>
                    </div>
                    <div id="tab-civilian" class="tab-panel" style="display:none;">
                        <div id="civilian-content"></div>
                    </div>
                    <div id="tab-all" class="tab-panel" style="display:none;">
                        <div id="all-content"></div>
                    </div>
                </div>
            </div>

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

    // ============================================================
    // RENDER ALL TEAMS - SIMPLE DEBUG VERSION
    // ============================================================

    function renderAllTeams() {
        var container = document.getElementById('academic-content');
        if (!container) return;

        var allTeams = window.data.teams || [];
        
        // Count teams by type
        var academicTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
        var professionalTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
        var temporaryTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
        var civilianTeams = allTeams.filter(function(t) { return t.type === 'civilian'; });

        // Show total count
        var html = '<div style="padding:8px;margin-bottom:12px;background:var(--panel-alt);border-radius:6px;border:1px solid var(--border);">';
        html += '<span style="font-size:0.8rem;color:var(--text-dim);">Total Teams: <strong>' + allTeams.length + '</strong></span>';
        html += ' | Academic: <strong>' + academicTeams.length + '</strong>';
        html += ' | Professional: <strong>' + professionalTeams.length + '</strong>';
        html += ' | Temporary: <strong>' + temporaryTeams.length + '</strong>';
        html += ' | Civilian: <strong>' + civilianTeams.length + '</strong>';
        html += '</div>';

        // Show all teams in a simple list
        if (allTeams.length === 0) {
            html += '<p class="empty-state">No teams found in data.</p>';
        } else {
            html += '<div class="list-header team-header" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;">';
            html += '<span>Team Name</span>';
            html += '<span>Type</span>';
            html += '<span>Period</span>';
            html += '<span>Status</span>';
            html += '<span>Members</span>';
            html += '</div>';

            allTeams.forEach(function(team) {
                var memberCount = team.members ? team.members.length : 0;
                var typeLabel = team.type || 'unknown';
                var periodDisplay = team.startPeriod || '-';
                if (team.endPeriod) periodDisplay += ' → ' + team.endPeriod;
                
                html += '<div class="list-item" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;">';
                html += '<span><strong>' + team.name + '</strong></span>';
                html += '<span style="font-size:0.75rem;">' + typeLabel + '</span>';
                html += '<span style="font-size:0.75rem;">' + periodDisplay + '</span>';
                html += '<span style="font-size:0.75rem;">' + (team.status || 'active') + '</span>';
                html += '<span style="font-size:0.75rem;">' + memberCount + '</span>';
                html += '</div>';
            });
        }

        container.innerHTML = html;
    }

    // ============================================================
    // INIT EVENTS
    // ============================================================

    function initTeamManagerEvents() {
        var tabNav = document.getElementById('team-tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;

                var tab = btn.dataset.tab;
                teamState.currentTab = tab;

                document.querySelectorAll('#team-tab-nav .tab-btn').forEach(function(b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');

                document.querySelectorAll('#team-tab-content .tab-panel').forEach(function(p) {
                    p.style.display = 'none';
                    p.classList.remove('active');
                });

                var panel = document.getElementById('tab-' + tab);
                if (panel) {
                    panel.style.display = 'block';
                    panel.classList.add('active');
                }

                // Re-render based on tab
                var container = document.getElementById(tab + '-content');
                if (container) {
                    renderAllTeams();
                }
            });
        }

        var addBtn = document.getElementById('add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showTeamForm(null);
            });
        }

        // Form submit
        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
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

                if (!teamData.name) {
                    alert('Team name is required.');
                    return;
                }

                var data = window.data || {};
                if (!data.teams) data.teams = [];

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

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                document.getElementById('team-form-modal').classList.add('hidden');
                renderAllTeams();
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

        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                var type = this.value;
                var fields = document.getElementById('academic-team-fields');
                if (fields) {
                    fields.style.display = (type === 'academic') ? 'block' : 'none';
                }
                var missionField = document.getElementById('temporary-mission-field');
                if (missionField) {
                    missionField.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
                }
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
            });
        }

        function showTeamForm(editId) {
            var modal = document.getElementById('team-form-modal');
            if (!modal) return;
            
            var title = document.getElementById('team-form-title');
            var form = document.getElementById('team-form-inner');

            modal.classList.remove('hidden');

            if (editId) {
                title.textContent = 'Edit Team';
            } else {
                title.textContent = 'Add Team';
                form.reset();
                document.getElementById('team-type').value = 'academic';
                document.getElementById('team-status').value = 'active';
                delete form.dataset.editId;
            }
        }

        // Member modal - simplified
        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', function() {
                alert('Member management coming soon');
            });
        }

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
