/**
 * js/modules/teams/team-manager.js - Team Manager Main
 * Path: js/modules/teams/team-manager.js
 */

(function() {
    'use strict';

    var teamState = {
        currentTab: 'academic',
        expandedTeamId: null,
        filters: {
            academic: { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
            professional: { filterYear: '', filterStatus: 'active' },
            temporary: { filterYear: '', filterStatus: 'active' },
            civilian: { filterStatus: 'active' }
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
        if (!window.data.classes) {
            window.data.classes = [];
        }

        if (!container.dataset.initialized || container.dataset.forceRefresh) {
            container.innerHTML = getTeamManagerHTML();
            container.dataset.initialized = 'true';
            delete container.dataset.forceRefresh;
        }

        renderTeamTab(teamState.currentTab);
        initTeamManagerEvents();
    }

    function getTeamManagerHTML() {
        var activeTab = teamState.currentTab || 'academic';
        return `
            <div class="page-header">
                <h2>Team Manager</h2>
                <button id="add-team-btn" class="primary">+ Add Team</button>
            </div>
            <div class="tab-container">
                <div class="tab-nav" id="team-tab-nav">
                    <button class="tab-btn ${activeTab === 'academic' ? 'active' : ''}" data-tab="academic">Academic</button>
                    <button class="tab-btn ${activeTab === 'professional' ? 'active' : ''}" data-tab="professional">Professional</button>
                    <button class="tab-btn ${activeTab === 'temporary' ? 'active' : ''}" data-tab="temporary">Temporary</button>
                    <button class="tab-btn ${activeTab === 'civilian' ? 'active' : ''}" data-tab="civilian">Civilian</button>
                </div>
                <div class="tab-content" id="team-tab-content">
                    <div id="tab-academic" class="tab-panel ${activeTab === 'academic' ? 'active' : ''}" style="${activeTab === 'academic' ? 'display:block;' : 'display:none;'}">
                        <div id="academic-content"></div>
                    </div>
                    <div id="tab-professional" class="tab-panel ${activeTab === 'professional' ? 'active' : ''}" style="${activeTab === 'professional' ? 'display:block;' : 'display:none;'}">
                        <div id="professional-content"></div>
                    </div>
                    <div id="tab-temporary" class="tab-panel ${activeTab === 'temporary' ? 'active' : ''}" style="${activeTab === 'temporary' ? 'display:block;' : 'display:none;'}">
                        <div id="temporary-content"></div>
                    </div>
                    <div id="tab-civilian" class="tab-panel ${activeTab === 'civilian' ? 'active' : ''}" style="${activeTab === 'civilian' ? 'display:block;' : 'display:none;'}">
                        <div id="civilian-content"></div>
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
                                    <input type="number" id="team-ranking" placeholder="Rank (e.g., 1, 2, 3...)" min="1">
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
                            <input type="text" id="member-join" placeholder="Join Week/Year" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="text" id="member-leave" placeholder="Leave Week/Year" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
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
                                <label>Join Week/Year</label>
                                <input type="text" id="edit-member-join">
                            </div>
                            <div class="form-group">
                                <label>Leave Week/Year</label>
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
                            <input type="text" id="ranking-week" placeholder="Week Block (1, 3, 5...) or Year" style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
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

    function renderTeamTab(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) return;

        var filter = teamState.filters[tab] || { filterWeek: 1, filterStatus: 'active', filterClass: 'all' };
        var filteredTeams = getFilteredTeams(tab, filter);

        var data = window.data || {};
        var filterPeriod = tab === 'academic' 
            ? (filter.filterWeek || 1) 
            : (data.currentYear || new Date().getFullYear());

        var classes = window.getClasses();
        var filterHtml = buildFilterHTML(tab, filter, classes);
        var teamsHtml = renderTeamList(filteredTeams, tab, filterPeriod);

        container.innerHTML = filterHtml + teamsHtml;

        setTimeout(function() {
            attachFilterEvents(tab);
            attachTeamActionEvents(tab);
        }, 50);
    }

    function getFilteredTeams(type, filter) {
        var teams = window.TeamCore.getTeams(type);
        if (!teams || teams.length === 0) return [];

        if (type === 'academic') {
            var weekNum = parseInt(filter.filterWeek) || 1;
            var block = window.getWeekBlock(weekNum);

            teams = teams.filter(function(team) {
                var start = parseInt(team.startPeriod);
                var end = parseInt(team.endPeriod);
                if (isNaN(start)) return true;
                return start <= block.end && (isNaN(end) || end >= block.start);
            });

            var classFilter = filter.filterClass || 'all';
            if (classFilter !== 'all') {
                teams = teams.filter(function(team) {
                    return String(team.classId) === String(classFilter);
                });
            }

            if (filter.filterStatus === 'active') {
                teams = teams.filter(function(t) { return t.status === 'active'; });
            } else if (filter.filterStatus === 'inactive') {
                teams = teams.filter(function(t) { return t.status === 'deprecated' || t.status === 'inactive'; });
            }

        } else if (type === 'professional' || type === 'temporary') {
            var year = filter.filterYear || '';
            if (year) {
                var yearNum = parseInt(year);
                if (!isNaN(yearNum)) {
                    teams = teams.filter(function(team) {
                        var start = parseInt(team.startPeriod);
                        return !isNaN(start) && start >= yearNum;
                    });
                }
            }

            if (filter.filterStatus === 'active') {
                teams = teams.filter(function(t) { return t.status === 'active'; });
            } else if (filter.filterStatus === 'inactive') {
                teams = teams.filter(function(t) { return t.status === 'deprecated' || t.status === 'inactive'; });
            }
        }

        teams.sort(function(a, b) {
            if (type === 'professional') {
                var aActive = a.status === 'active' ? 0 : 1;
                var bActive = b.status === 'active' ? 0 : 1;
                if (aActive !== bActive) return aActive - bActive;
            }
            return a.name.localeCompare(b.name);
        });

        return teams;
    }

    function buildFilterHTML(tab, filter, classes) {
        if (tab === 'academic') {
            var weekValue = filter.filterWeek || 1;
            var classFilterValue = filter.filterClass || 'all';

            var classOptions = '';
            classes.forEach(function(cls) {
                var selected = (classFilterValue === cls.id) ? 'selected' : '';
                classOptions += '<option value="' + cls.id + '" ' + selected + '>' + cls.name + '</option>';
            });

            return `
                <div class="filter-section">
                    <label for="team-filter-week">Week:</label>
                    <input type="number" id="team-filter-week" value="${weekValue}" min="1" max="52" style="width:80px;">
                    <button id="apply-filter-btn" class="small primary">Apply</button>
                    <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active during this 2-week block</span>
                    <label style="margin-left:12px;">Class:</label>
                    <select id="team-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                        ${classOptions}
                    </select>
                    <label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">
                        <input type="checkbox" id="academic-show-inactive" ${filter.filterStatus === 'inactive' ? 'checked' : ''} style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive
                    </label>
                </div>
            `;
        } else if (tab === 'professional') {
            var yearValue = filter.filterYear || '';
            return `
                <div class="filter-section">
                    <label for="team-filter-year">Year:</label>
                    <input type="number" id="team-filter-year" value="${yearValue}" min="1900" max="2100" style="width:80px;" placeholder="All">
                    <button id="apply-filter-btn" class="small primary">Apply</button>
                    <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active from this year onward</span>
                    <label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">
                        <input type="checkbox" id="professional-show-inactive" ${filter.filterStatus === 'inactive' ? 'checked' : ''} style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive
                    </label>
                </div>
            `;
        } else if (tab === 'temporary') {
            var yearValue = filter.filterYear || '';
            return `
                <div class="filter-section">
                    <label for="team-filter-year">Year:</label>
                    <input type="number" id="team-filter-year" value="${yearValue}" min="1900" max="2100" style="width:80px;" placeholder="All">
                    <button id="apply-filter-btn" class="small primary">Apply</button>
                    <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active from this year onward</span>
                </div>
            `;
        } else {
            return `
                <div class="filter-section">
                    <span style="font-size:0.75rem;color:var(--text-dim);">All civilian teams shown</span>
                </div>
            `;
        }
    }

    function renderTeamList(teams, type, filterPeriod) {
        if (!teams || teams.length === 0) {
            var labels = {
                'academic': 'academic teams',
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams'
            };
            return '<p class="empty-state" style="padding:20px;">No ' + (labels[type] || 'teams') + ' found.</p>';
        }

        var html = '';
        var headerHtml = `
            <div class="list-header team-header" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;">
                <span>Team Name</span>
                <span>Period</span>
                <span>Rank</span>
                <span>Members</span>
                <span>Actions</span>
            </div>
        `;
        html += headerHtml;

        var filterPeriodNum = parseInt(filterPeriod) || 1;

        teams.forEach(function(team) {
            var periodDisplay = window.TeamCore.getPeriodDisplay(team);
            var typeLabel = window.TeamCore.getTypeLabel(team.type);
            var activeMembers = window.TeamCore.getActiveMembers(team, filterPeriodNum);
            var memberCount = activeMembers.length;

            var isExpanded = (teamState.expandedTeamId === team.id);
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var inactiveStyle = isInactive ? 'opacity:0.6;background:var(--panel-alt);' : '';

            var rankDisplay = team.currentRank || '-';

            var classDisplay = '';
            if (team.type === 'academic' && team.classId) {
                var className = window.getClassDisplayName(team.classId);
                if (className && className !== 'Unassigned') {
                    classDisplay = ' <span style="font-size:0.6rem;color:var(--accent);">[' + className + ']</span>';
                }
            }

            html += '<div class="list-item team-item" data-id="' + team.id + '" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;' + inactiveStyle + '">';
            html += '<span><strong>' + team.name + '</strong>' + classDisplay + ' <span style="font-size:0.6rem;color:var(--text-dim);">' + typeLabel + '</span>';
            if (isInactive) {
                html += ' <span style="color:var(--text-dim);font-size:0.6rem;">(Inactive)</span>';
            }
            html += '</span>';
            html += '<span style="font-size:0.75rem;">' + periodDisplay + '</span>';
            html += '<span style="font-size:0.75rem;">' + rankDisplay + '</span>';
            html += '<span style="font-size:0.75rem;">' + memberCount + '</span>';
            html += '<span class="actions">' +
                '<button class="small toggle-members" data-id="' + team.id + '">' + (isExpanded ? '▾' : '▸') + '</button>' +
                '<button class="small manage-members" data-id="' + team.id + '">Members</button>' +
                '<button class="small manage-rankings" data-id="' + team.id + '">Rankings</button>' +
                '<button class="small edit-team" data-id="' + team.id + '">Edit</button>' +
                '<button class="small danger delete-team" data-id="' + team.id + '">Delete</button>' +
                '</span>';
            html += '</div>';

            if (isExpanded) {
                html += '<div class="team-members-expanded" data-team-id="' + team.id + '">';
                if (activeMembers.length > 0) {
                    html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Current Active Members:</div>';
                    activeMembers.forEach(function(member) {
                        var char = window.getCharacterById(member.characterId);
                        var name = char ? window.getDisplayName(char) : 'Unknown';
                        var age = char ? window.getCharacterAge(char) : '-';
                        var deadMarker = char && char.deceased ? ' ✝' : '';

                        var status = team.type === 'academic' 
                            ? window.TeamMembers.getStatusAtWeek(member, filterPeriodNum) 
                            : window.TeamMembers.getStatusAtPeriod(member, filterPeriodNum, team.type);
                        var statusInfo = window.TeamCore.getMemberStatusInfo(status);

                        html += '<div class="member-entry" style="border-left:3px solid ' + statusInfo.color + ';padding-left:8px;">' +
                            '<span>' + name + deadMarker + ' <span class="role">(' + (member.role || 'Member') + ')</span></span>' +
                            '<span style="color:var(--text-dim);font-size:0.75rem;">Age: ' + age + ' | Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + ' | <span style="color:' + statusInfo.color + ';">' + statusInfo.label + '</span></span>' +
                            '</div>';
                    });
                } else {
                    html += '<div class="member-entry empty" style="color:var(--text-dim);font-size:0.8rem;">No active members this period</div>';
                }
                html += '</div>';
            }
        });

        return html;
    }

    function attachFilterEvents(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) return;

        var applyBtn = container.querySelector('#apply-filter-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                if (tab === 'academic') {
                    var week = parseInt(container.querySelector('#team-filter-week').value);
                    var classFilter = container.querySelector('#team-class-filter') ? container.querySelector('#team-class-filter').value : 'all';
                    if (!isNaN(week) && week > 0 && week <= 52) {
                        teamState.filters.academic.filterWeek = week;
                        teamState.filters.academic.filterClass = classFilter;
                        renderTeamTab(tab);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                } else if (tab === 'professional' || tab === 'temporary') {
                    var year = container.querySelector('#team-filter-year').value;
                    if (year === '' || !isNaN(parseInt(year))) {
                        teamState.filters[tab].filterYear = year;
                        renderTeamTab(tab);
                    } else {
                        alert('Please enter a valid year.');
                    }
                }
            });
        }

        var classFilter = container.querySelector('#team-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                if (tab === 'academic') {
                    teamState.filters.academic.filterClass = this.value;
                    renderTeamTab(tab);
                }
            });
        }

        var inactiveCheck = container.querySelector('#' + tab + '-show-inactive');
        if (inactiveCheck) {
            inactiveCheck.addEventListener('change', function() {
                teamState.filters[tab].filterStatus = this.checked ? 'inactive' : 'active';
                renderTeamTab(tab);
            });
        }
    }

    function attachTeamActionEvents(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) return;

        container.querySelectorAll('.toggle-members, .manage-members, .manage-rankings, .edit-team, .delete-team').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.dataset.id;
                if (!id) return;

                if (this.classList.contains('toggle-members')) {
                    teamState.expandedTeamId = (teamState.expandedTeamId === id) ? null : id;
                    renderTeamTab(tab);
                } else if (this.classList.contains('manage-members')) {
                    window.TeamModals.showMemberModal(id, tab);
                } else if (this.classList.contains('manage-rankings')) {
                    window.TeamModals.showRankingModal(id, tab);
                } else if (this.classList.contains('edit-team')) {
                    window.TeamModals.showTeamForm(id, tab);
                } else if (this.classList.contains('delete-team')) {
                    if (confirm('Delete this team permanently?')) {
                        window.TeamCore.deleteTeam(id);
                        renderTeamTab(tab);
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    }
                }
            });
        });
    }

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

                renderTeamTab(tab);
            });
        }

        var addBtn = document.getElementById('add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                window.TeamModals.showTeamForm(null, teamState.currentTab || 'academic');
            });
        }

        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                var editId = form.dataset.editId;
                var tab = form.dataset.tab || 'academic';

                var nameHistory = [];
                document.querySelectorAll('.name-history-entry').forEach(function(entry) {
                    var nameInput = entry.querySelector('.name-history-name');
                    var startInput = entry.querySelector('.name-history-start');
                    var endInput = entry.querySelector('.name-history-end');
                    if (nameInput.value.trim()) {
                        nameHistory.push({
                            name: nameInput.value.trim(),
                            startPeriod: startInput.value || '',
                            endPeriod: endInput.value || ''
                        });
                    }
                });

                var teamData = {
                    name: document.getElementById('team-name').value.trim(),
                    type: document.getElementById('team-type').value,
                    startPeriod: document.getElementById('team-start').value || '',
                    endPeriod: document.getElementById('team-end').value || '',
                    currentRank: document.getElementById('team-ranking').value || '',
                    status: document.getElementById('team-status').value || 'active',
                    nameHistory: nameHistory,
                    temporaryMission: document.getElementById('team-mission').value || null,
                    classId: document.getElementById('team-class').value || null,
                    teamNumber: document.getElementById('team-number').value.trim() || ''
                };

                if (teamData.type !== 'academic') {
                    teamData.classId = null;
                    teamData.teamNumber = '';
                }

                if (!teamData.name) {
                    alert('Team name is required.');
                    return;
                }

                var result;
                if (editId) {
                    result = window.TeamCore.updateTeam(editId, teamData);
                } else {
                    result = window.TeamCore.createTeam(teamData);
                }

                if (result) {
                    window.TeamModals.closeTeamForm();
                    renderTeamTab(tab);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                }
            });
        }

        var closeFormBtn = document.getElementById('close-team-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() { window.TeamModals.closeTeamForm(); });
        }

        var cancelFormBtn = document.getElementById('cancel-team-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() { window.TeamModals.closeTeamForm(); });
        }

        var formModal = document.getElementById('team-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeTeamForm();
            });
        }

        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                window.TeamModals.updatePeriodLabels();
            });
        }

        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                window.TeamModals.addNameHistoryEntry(container);
            });
        }

        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                var teamId = modal.dataset.teamId;
                var tab = modal.dataset.tab || 'academic';
                if (!teamId) return;

                var charId = document.getElementById('member-character').value;
                var role = document.getElementById('member-role').value.trim();
                var joinPeriod = document.getElementById('member-join').value;
                var leavePeriod = document.getElementById('member-leave').value;

                if (!charId) {
                    alert('Please select a character.');
                    return;
                }

                var team = window.TeamCore.getTeam(teamId);
                if (!team) return;

                if (team.members && team.members.some(function(m) { return String(m.characterId) === String(charId); })) {
                    alert('This character is already in the team.');
                    return;
                }

                var result = window.TeamMembers.addMember(teamId, charId, role || 'Member', joinPeriod || '', leavePeriod || '');
                if (result) {
                    window.TeamModals.showMemberModal(teamId, tab);
                    renderTeamTab(tab);
                }
            });
        }

        var memberClose = document.querySelector('#member-modal .close-modal');
        if (memberClose) {
            memberClose.addEventListener('click', function() { window.TeamModals.closeMemberModal(); });
        }

        var memberBg = document.getElementById('member-modal');
        if (memberBg) {
            memberBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeMemberModal();
            });
        }

        var editClose = document.querySelector('#edit-member-modal .close-modal');
        if (editClose) {
            editClose.addEventListener('click', function() { window.TeamModals.closeEditMemberModal(); });
        }

        var editBg = document.getElementById('edit-member-modal');
        if (editBg) {
            editBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeEditMemberModal();
            });
        }

        var cancelEdit = document.getElementById('cancel-edit-member');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', function() { window.TeamModals.closeEditMemberModal(); });
        }

        var editForm = document.getElementById('edit-member-form');
        if (editForm) {
            editForm.addEventListener('submit', function(e) {
                e.preventDefault();
                var modal = document.getElementById('edit-member-modal');
                var teamId = modal.dataset.teamId;
                var index = parseInt(modal.dataset.index);
                var tab = modal.dataset.tab || 'academic';

                var team = window.TeamCore.getTeam(teamId);
                if (!team || !team.members || !team.members[index]) return;

                var member = team.members[index];
                var charId = member.characterId;

                var updates = {
                    role: document.getElementById('edit-member-role').value.trim() || 'Member',
                    joinPeriod: document.getElementById('edit-member-join').value || '',
                    leavePeriod: document.getElementById('edit-member-leave').value || ''
                };

                var result = window.TeamMembers.updateMember(teamId, charId, updates);
                if (result) {
                    window.TeamModals.closeEditMemberModal();
                    window.TeamModals.showMemberModal(teamId, tab);
                    renderTeamTab(tab);
                }
            });
        }

        var rankClose = document.querySelector('#ranking-modal .close-modal');
        if (rankClose) {
            rankClose.addEventListener('click', function() { window.TeamModals.closeRankingModal(); });
        }

        var rankBg = document.getElementById('ranking-modal');
        if (rankBg) {
            rankBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeRankingModal();
            });
        }

        var addRankBtn = document.getElementById('add-ranking-btn');
        if (addRankBtn) {
            addRankBtn.addEventListener('click', function() {
                var modal = document.getElementById('ranking-modal');
                var teamId = modal.dataset.teamId;
                var tab = modal.dataset.tab || 'academic';
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

                var result = window.TeamRankings.addRanking(teamId, period, rank);
                if (result) {
                    window.TeamModals.showRankingModal(teamId, tab);
                    renderTeamTab(tab);
                    document.getElementById('ranking-week').value = '';
                    document.getElementById('ranking-rank').value = '';
                }
            });
        }
    }

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
                container.dataset.forceRefresh = 'true';
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
    window.renderTeamTab = renderTeamTab;

})();
