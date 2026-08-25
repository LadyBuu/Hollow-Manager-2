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
            academic: { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
            professional: { filterYear: '', filterStatus: 'active' },
            temporary: { filterYear: '', filterStatus: 'active' },
            civilian: { filterStatus: 'active' }
        }
    };

    window.teamState = teamState;

    // ============================================================
    // MAIN RENDER FUNCTION
    // ============================================================

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

        // Always re-render to ensure fresh data
        container.innerHTML = getTeamManagerHTML();
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

    // ============================================================
    // TAB RENDERING
    // ============================================================

    function renderTeamTab(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) {
            return;
        }

        var filter = teamState.filters[tab] || { filterWeek: 1, filterStatus: 'active', filterClass: 'all' };
        
        // Get teams for this tab
        var allTeams = window.data.teams || [];
        var teams = allTeams.filter(function(t) { return t.status !== 'deleted'; });
        
        // Filter by type
        if (tab === 'academic') {
            teams = teams.filter(function(t) { return t.type === 'academic'; });
        } else if (tab === 'professional') {
            teams = teams.filter(function(t) { return t.type === 'professional'; });
        } else if (tab === 'temporary') {
            teams = teams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
        } else if (tab === 'civilian') {
            teams = teams.filter(function(t) { return t.type === 'civilian'; });
        }

        // Apply filters
        if (tab === 'academic') {
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

        } else if (tab === 'professional' || tab === 'temporary') {
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

        // Sort teams
        teams.sort(function(a, b) {
            if (tab === 'professional') {
                var aActive = a.status === 'active' ? 0 : 1;
                var bActive = b.status === 'active' ? 0 : 1;
                if (aActive !== bActive) return aActive - bActive;
            }
            return a.name.localeCompare(b.name);
        });

        // Build HTML
        var filterHtml = buildFilterHTML(tab, filter);
        var listHtml = renderTeamList(teams, tab);

        container.innerHTML = filterHtml + listHtml;

        // Attach events
        setTimeout(function() {
            attachFilterEvents(tab);
            attachTeamActionEvents(tab);
        }, 50);
    }

    // ============================================================
    // FILTER HTML
    // ============================================================

    function buildFilterHTML(tab, filter) {
        if (tab === 'academic') {
            var weekValue = filter.filterWeek || 1;
            var classFilterValue = filter.filterClass || 'all';
            
            var classes = window.getClasses() || [];
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

    // ============================================================
    // TEAM LIST RENDER
    // ============================================================

    function renderTeamList(teams, tab) {
        if (!teams || teams.length === 0) {
            var labels = {
                'academic': 'academic teams',
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams'
            };
            return '<p class="empty-state" style="padding:20px;">No ' + (labels[tab] || 'teams') + ' found.</p>';
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

        var data = window.data || {};
        var currentYear = data.currentYear || 1924;

        teams.forEach(function(team) {
            var periodDisplay = getPeriodDisplay(team);
            var typeLabel = getTypeLabel(team.type);
            var memberCount = team.members ? team.members.length : 0;

            var isExpanded = (teamState.expandedTeamId === team.id);
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var inactiveStyle = isInactive ? 'opacity:0.6;background:var(--panel-alt);' : '';

            var rankDisplay = team.currentRank || '-';

            var classDisplay = '';
            if (team.type === 'academic' && team.classId) {
                var className = getClassDisplayName(team.classId);
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
                if (team.members && team.members.length > 0) {
                    html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Members:</div>';
                    team.members.forEach(function(member) {
                        var char = window.getCharacterById(member.characterId);
                        var name = char ? window.getDisplayName(char) : 'Unknown';
                        var deadMarker = char && char.deceased ? ' ✝' : '';
                        html += '<div class="member-entry" style="padding-left:8px;">' +
                            '<span>' + name + deadMarker + ' <span class="role">(' + (member.role || 'Member') + ')</span></span>' +
                            '<span style="color:var(--text-dim);font-size:0.75rem;">Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + '</span>' +
                            '</div>';
                    });
                } else {
                    html += '<div class="member-entry empty" style="color:var(--text-dim);font-size:0.8rem;">No members</div>';
                }
                html += '</div>';
            }
        });

        return html;
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getPeriodDisplay(team) {
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
    }

    function getTypeLabel(type) {
        var labels = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'internship': 'Temporary',
            'civilian': 'Civilian'
        };
        return labels[type] || type || 'Unknown';
    }

    function getClassDisplayName(classId) {
        if (!classId) return 'Unassigned';
        var classes = window.getClasses() || [];
        var cls = classes.find(function(c) { return String(c.id) === String(classId); });
        return cls ? cls.name : 'Unassigned';
    }

    // ============================================================
    // EVENT ATTACHMENT
    // ============================================================

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
                    openMemberModal(id, tab);
                } else if (this.classList.contains('manage-rankings')) {
                    openRankingModal(id, tab);
                } else if (this.classList.contains('edit-team')) {
                    showTeamForm(id, tab);
                } else if (this.classList.contains('delete-team')) {
                    if (confirm('Delete this team permanently?')) {
                        deleteTeam(id, tab);
                    }
                }
            });
        });
    }

    // ============================================================
    // MODAL FUNCTIONS
    // ============================================================

    function openMemberModal(teamId, tab) {
        var modal = document.getElementById('member-modal');
        if (!modal) return;
        
        var team = getTeam(teamId);
        if (!team) return;

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
        modal.dataset.tab = tab || 'academic';
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
            html += '<div class="member-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">' +
                '<span><strong>' + name + '</strong> <span class="role" style="color:var(--text-dim);font-size:0.75rem;">' + (member.role || 'Member') + '</span></span>' +
                '<span style="color:var(--text-dim);font-size:0.7rem;">Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + '</span>' +
                '<div class="member-actions" style="display:flex;gap:4px;">' +
                '<button class="small edit-member" data-index="' + index + '">Edit</button>' +
                '<button class="small danger remove-member" data-char="' + member.characterId + '">Remove</button>' +
                '</div>' +
                '</div>';
        });
        container.innerHTML = html;

        // Attach member events
        var modal = document.getElementById('member-modal');
        var teamId = modal.dataset.teamId;
        var tab = modal.dataset.tab || 'academic';

        container.querySelectorAll('.edit-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var index = parseInt(this.dataset.index);
                if (!isNaN(index)) {
                    openEditMemberModal(teamId, index, tab);
                }
            });
        });

        container.querySelectorAll('.remove-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (confirm('Remove this member from the team?')) {
                    removeMember(teamId, this.dataset.char, tab);
                }
            });
        });
    }

    function openEditMemberModal(teamId, index, tab) {
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
        modal.dataset.tab = tab || 'academic';
        modal.classList.remove('hidden');
    }

    function openRankingModal(teamId, tab) {
        var modal = document.getElementById('ranking-modal');
        if (!modal) return;
        
        var team = getTeam(teamId);
        if (!team) return;

        document.getElementById('ranking-modal-title').textContent = team.name + ' - Ranking History';
        document.getElementById('ranking-week').value = '';
        document.getElementById('ranking-rank').value = '';

        modal.dataset.teamId = teamId;
        modal.dataset.tab = tab || 'academic';

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
            html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">' +
                '<span><strong>#' + entry.rank + '</strong> - ' + entry.period + '</span>' +
                '<button class="small danger remove-ranking" data-period="' + entry.period + '">Remove</button>' +
                '</div>';
        });
        container.innerHTML = html;

        var modal = document.getElementById('ranking-modal');
        var teamId = modal.dataset.teamId;
        var tab = modal.dataset.tab || 'academic';

        container.querySelectorAll('.remove-ranking').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Remove this ranking entry?')) {
                    removeRanking(teamId, this.dataset.period, tab);
                }
            });
        });
    }

    function showTeamForm(editId, tab) {
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
            document.getElementById('team-type').value = tab || 'academic';
            document.getElementById('team-status').value = 'active';
            delete form.dataset.editId;
        }

        updatePeriodLabels();
        toggleAcademicFields(document.getElementById('team-type').value);
        toggleMissionField(document.getElementById('team-type').value);
    }

    function getTeam(id) {
        if (!id) return null;
        var data = window.data || {};
        if (!data.teams) return null;
        return data.teams.find(function(t) { return String(t.id) === String(id); }) || null;
    }

    function deleteTeam(id, tab) {
        var data = window.data || {};
        if (!data.teams) return;
        
        var team = data.teams.find(function(t) { return String(t.id) === String(id); });
        if (!team) return;

        data.teams = data.teams.filter(function(t) { return String(t.id) !== String(id); });
        
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted team: ' + team.name);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderTeamTab(tab || 'academic');
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function removeMember(teamId, charId, tab) {
        var team = getTeam(teamId);
        if (!team) return;
        
        team.members = team.members.filter(function(m) { return String(m.characterId) !== String(charId); });
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderMembers(team);
        renderTeamTab(tab);
    }

    function removeRanking(teamId, period, tab) {
        var team = getTeam(teamId);
        if (!team) return;
        
        team.rankingHistory = team.rankingHistory.filter(function(r) { return String(r.period) !== String(period); });
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderRankings(team);
        renderTeamTab(tab);
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

    // ============================================================
    // INIT EVENTS
    // ============================================================

    function initTeamManagerEvents() {
        // Tab switching
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

        // Add team button
        var addBtn = document.getElementById('add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showTeamForm(null, teamState.currentTab || 'academic');
            });
        }

        // Form submit
        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                var editId = form.dataset.editId;
                var tab = form.dataset.tab || 'academic';

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
                        ...teamData,
                        createdAt: new Date().toISOString()
                    };
                    data.teams.push(newTeam);
                }

                if (typeof window.logActivity === 'function') {
                    window.logActivity('Saved team: ' + teamData.name);
                }
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                document.getElementById('team-form-modal').classList.add('hidden');
                renderTeamTab(tab);
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
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

        // Type select change
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', updatePeriodLabels);
        }

        // Add member
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

                if (typeof window.logActivity === 'function') {
                    var char = window.getCharacterById(charId);
                    window.logActivity('Added ' + (char ? char.firstName : 'character') + ' to team: ' + team.name);
                }
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                openMemberModal(teamId, tab);
                renderTeamTab(tab);
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
                var tab = modal.dataset.tab || 'academic';

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
                openMemberModal(teamId, tab);
                renderTeamTab(tab);
            });
        }

        // Add ranking
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

                var team = getTeam(teamId);
                if (!team) return;

                if (!team.rankingHistory) team.rankingHistory = [];
                team.rankingHistory.push({ period: period, rank: rank });
                team.currentRank = rank;

                if (typeof window.logActivity === 'function') {
                    window.logActivity('Added ranking #' + rank + ' for team: ' + team.name);
                }
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }

                openRankingModal(teamId, tab);
                renderTeamTab(tab);
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
