/**
 * js/modules/teams/team-manager.js - Team Manager
 * Handles team UI orchestration and user interaction
 * Path: js/modules/teams/team-manager.js
 * 
 * This module is responsible for:
 *   - Orchestrating the team manager UI
 *   - Team CRUD operations (delegates to TeamCore)
 *   - Member management (delegates to TeamModals/TeamCore)
 *   - Ranking management (delegates to TeamModals/TeamCore)
 *   - Filtering (delegates to TeamFilters)
 * 
 * IMPORTANT: This module does NOT mutate window.data directly.
 * All domain data mutations are delegated to TeamCore.
 * UI state (teamState, form state, DOM state) is managed here.
 * 
 * RENDERING PHILOSOPHY:
 *   - UI refresh happens IMMEDIATELY after mutation, before persistence
 *   - This ensures the UI reflects the authoritative in-memory state
 *   - Persistence success/failure is reported separately
 * 
 * PERSISTENCE NOTE:
 *   - Mutations are applied to window.data via TeamCore immediately
 *   - saveData() is then called to persist
 *   - If saveData() fails, the in-memory mutation has already occurred
 *   - This is intentional: memory is authoritative, persistence is best-effort
 *   - Users are notified of persistence failures but the UI already shows the change
 * 
 * DEPENDENCIES:
 *   Required:
 *     - window.TeamCore
 *     - window.TeamQueries
 *     - window.TeamFilters
 *     - window.TeamModals
 *     - window.TeamMembers
 *     - window.TeamRankings
 *     - window.TeamRender
 *     - window.CharacterQueries
 *     - window.ClassesQueries
 *     - window.NotificationSystem
 *     - window.CALENDAR_CONSTANTS
 *     - window.TabManager
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamManagerLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.TeamCore) {
        return;
    }
    if (!window.TeamQueries) {
        return;
    }
    if (!window.TeamFilters) {
        return;
    }
    if (!window.TeamModals) {
        return;
    }
    if (!window.TeamMembers) {
        return;
    }
    if (!window.TeamRankings) {
        return;
    }
    if (!window.TeamRender) {
        return;
    }
    if (!window.CharacterQueries) {
        return;
    }
    if (!window.ClassesQueries) {
        return;
    }
    if (!window.NotificationSystem) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.TabManager) {
        return;
    }

    window.__teamManagerLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamFilters = window.TeamFilters;
    var TeamModals = window.TeamModals;
    var TeamMembers = window.TeamMembers;
    var TeamRankings = window.TeamRankings;
    var TeamRender = window.TeamRender;
    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var NotificationSystem = window.NotificationSystem;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var TabManager = window.TabManager;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // CHARACTER HELPERS - Uses CharacterQueries
    // ============================================================

    function getCharacterName(charId) {
        var character = CharacterQueries.getCharacterById(charId);
        return character ? CharacterQueries.getDisplayName(character) : 'Unknown';
    }

    // ============================================================
    // CLASS HELPERS - Uses ClassesQueries
    // ============================================================

    function getClassDisplayName(classId) {
        return ClassesQueries.getClassDisplayName(classId);
    }

    function getClasses() {
        return ClassesQueries.getClasses();
    }

    // ============================================================
    // STATE
    // ============================================================

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

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    // ============================================================
    // UI REFRESH HELPERS
    // ============================================================

    function refreshTeamList() {
        var container = document.getElementById('tab-teams');
        if (container) {
            renderTeamListOnly(container);
        }
    }

    function refreshTeamStats() {
        var container = document.getElementById('tab-teams');
        if (!container) {
            return;
        }

        var allTeams = Array.isArray(window.data.teams) ? window.data.teams : [];

        var visibleTeams = [];
        for (var i = 0; i < allTeams.length; i++) {
            var team = allTeams[i];
            if (team && team.status !== 'deleted') {
                visibleTeams.push(team);
            }
        }

        var allAcad = 0;
        var allProf = 0;
        var allTemp = 0;
        var allCiv = 0;

        for (var j = 0; j < visibleTeams.length; j++) {
            var t = visibleTeams[j];
            if (t.type === 'academic') {
                allAcad++;
            } else if (t.type === 'professional' || t.type === 'internship') {
                allProf++;
            } else if (t.type === 'temporary') {
                allTemp++;
            } else if (t.type === 'civilian') {
                allCiv++;
            }
        }

        // Update tab button labels
        var tabButtons = container.querySelectorAll('.tab-btn');
        var tabMap = {
            'academic': allAcad,
            'professional': allProf,
            'temporary': allTemp,
            'civilian': allCiv
        };

        for (var k = 0; k < tabButtons.length; k++) {
            var btn = tabButtons[k];
            var tab = btn.dataset.tab;
            var count = tabMap[tab] || 0;
            var label = btn.textContent.replace(/\(\d+\)$/, '').trim();
            btn.textContent = label + ' (' + count + ')';
        }

        // Update stat cards
        var statCards = container.querySelectorAll('.stat-card .stat-number');
        var counts = [allAcad, allProf, allTemp, allCiv];
        for (var l = 0; l < statCards.length && l < counts.length; l++) {
            statCards[l].textContent = counts[l];
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function getTeam(teamId) {
        return TeamCore.getTeam(teamId);
    }

    // ============================================================
    // RENDER TEAM MANAGER - Mount entry point
    // ============================================================

    function renderTeamManager(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        renderFullManager(container);
        initTeamManagerEvents(container);
    }

    // ============================================================
    // RENDER FULL MANAGER
    // ============================================================

    function renderFullManager(container) {
        var allTeams = Array.isArray(window.data.teams) ? window.data.teams : [];

        var visibleTeams = [];
        for (var i = 0; i < allTeams.length; i++) {
            var team = allTeams[i];
            if (team && team.status !== 'deleted') {
                visibleTeams.push(team);
            }
        }

        var allAcad = 0;
        var allProf = 0;
        var allTemp = 0;
        var allCiv = 0;

        for (var j = 0; j < visibleTeams.length; j++) {
            var t = visibleTeams[j];
            if (t.type === 'academic') {
                allAcad++;
            } else if (t.type === 'professional' || t.type === 'internship') {
                allProf++;
            } else if (t.type === 'temporary') {
                allTemp++;
            } else if (t.type === 'civilian') {
                allCiv++;
            }
        }

        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Academic</h3><p class="stat-number">' + allAcad + '</p></div>';
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' + allProf + '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' + allTemp + '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' + allCiv + '</p></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" id="team-tab-nav">';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'academic' ? 'active' : '') + '" data-tab="academic">Academic (' + allAcad + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'professional' ? 'active' : '') + '" data-tab="professional">Professional (' + allProf + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'temporary' ? 'active' : '') + '" data-tab="temporary">Temporary (' + allTemp + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'civilian' ? 'active' : '') + '" data-tab="civilian">Civilian (' + allCiv + ')</button>';
        html += '</div>';

        // Filter section
        html += '<div id="filter-container" class="filter-container">';
        html += buildFilterHTML(teamState.currentTab);
        html += '</div>';

        // Team list container
        html += '<div id="team-list-container" class="team-list-container"></div>';

        // Modals
        html += getModalsHTML();

        container.innerHTML = html;

        // Render teams for current tab
        var filteredTeams = getFilteredTeamsForTab(teamState.currentTab);
        renderTeamList(filteredTeams, container);
    }

    // ============================================================
    // BUILD FILTER HTML
    // ============================================================

    function buildFilterHTML(tab) {
        var filter = teamState.filters[tab] || teamState.filters.academic;
        var classes = getClasses();

        if (tab === 'academic') {
            return TeamFilters.buildFilterHTML ? TeamFilters.buildFilterHTML('academic', filter, classes) : '';
        } else if (tab === 'professional') {
            return TeamFilters.buildFilterHTML ? TeamFilters.buildFilterHTML('professional', filter, classes) : '';
        } else if (tab === 'temporary') {
            return TeamFilters.buildFilterHTML ? TeamFilters.buildFilterHTML('temporary', filter, classes) : '';
        } else if (tab === 'civilian') {
            return TeamFilters.buildFilterHTML ? TeamFilters.buildFilterHTML('civilian', filter, classes) : '';
        }
        return '';
    }

    // ============================================================
    // GET FILTERED TEAMS
    // ============================================================

    function getFilteredTeamsForTab(tab) {
        var filter = teamState.filters[tab] || teamState.filters.academic;

        if (tab === 'academic') {
            return TeamFilters.filterTeams('academic', filter);
        } else if (tab === 'professional') {
            return TeamFilters.filterTeams('professional', filter);
        } else if (tab === 'temporary') {
            return TeamFilters.filterTeams('temporary', filter);
        } else if (tab === 'civilian') {
            return TeamFilters.filterTeams('civilian', filter);
        }
        return [];
    }

    // ============================================================
    // RENDER TEAM LIST ONLY - For updates
    // ============================================================

    function renderTeamListOnly(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            return;
        }

        var filteredTeams = getFilteredTeamsForTab(teamState.currentTab);

        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) {
            return;
        }

        var periodNum = teamState.currentTab === 'academic'
            ? (teamState.filters.academic.filterWeek || 1)
            : 1;

        var html = TeamRender.renderList(
            filteredTeams,
            teamState.currentTab,
            periodNum,
            teamState.expandedTeamId
        );

        listContainer.innerHTML = html;
    }

    // ============================================================
    // TEAM LIST RENDERING
    // ============================================================

    function renderTeamList(teams, container) {
        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) {
            listContainer = container;
        }

        var periodNum = teamState.currentTab === 'academic'
            ? (teamState.filters.academic.filterWeek || 1)
            : 1;

        var html = TeamRender.renderList(
            teams,
            teamState.currentTab,
            periodNum,
            teamState.expandedTeamId
        );

        listContainer.innerHTML = html;
    }

    // ============================================================
    // MODALS HTML
    // ============================================================

    function getModalsHTML() {
        return [
            '<!-- Team Form Modal -->',
            '<div id="team-form-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="team-form-title">Add Team</h3>',
                        '<button class="close-modal" id="close-team-form">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="team-form-inner">',
                            '<div class="form-grid">',
                                '<div class="form-group full-width">',
                                    '<label>Team Name *</label>',
                                    '<input type="text" id="team-name" required>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Team Type *</label>',
                                    '<select id="team-type" required>',
                                        '<option value="academic">Academic</option>',
                                        '<option value="professional">Professional</option>',
                                        '<option value="temporary">Temporary</option>',
                                        '<option value="civilian">Civilian</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-start-label">Start Period</label>',
                                    '<input type="text" id="team-start" placeholder="Week or Year">',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-end-label">End Period (optional)</label>',
                                    '<input type="text" id="team-end" placeholder="Week or Year">',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Current Ranking</label>',
                                    '<input type="text" id="team-ranking" readonly disabled>',
                                    '<span class="field-hint">(Read-only; use Rankings tab to modify)</span>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Status</label>',
                                    '<select id="team-status">',
                                        '<option value="active">Active</option>',
                                        '<option value="inactive">Inactive</option>',
                                        '<option value="deprecated">Deprecated</option>',
                                    '</select>',
                                '</div>',
                                '<div id="academic-team-fields" style="display:none;grid-column:1/-1;">',
                                    '<div class="form-group">',
                                        '<label>Class</label>',
                                        '<select id="team-class" style="width:100%;padding:8px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                            '<option value="">Unassigned</option>',
                                        '</select>',
                                    '</div>',
                                    '<div class="form-group">',
                                        '<label>Team Number (optional)</label>',
                                        '<input type="text" id="team-number" placeholder="e.g., A, B, 1, 2...">',
                                    '</div>',
                                '</div>',
                                '<div class="form-group full-width" id="temporary-mission-field" style="display:none;">',
                                    '<label>Associated Mission</label>',
                                    '<select id="team-mission">',
                                        '<option value="">None</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group full-width">',
                                    '<label>Name History</label>',
                                    '<div id="name-history-container">',
                                        '<div class="name-history-entry" style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">',
                                            '<input type="text" class="name-history-name" placeholder="Team Name" style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<input type="text" class="name-history-start" placeholder="Start" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<input type="text" class="name-history-end" placeholder="End" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<button type="button" class="small danger remove-name" style="padding:2px 6px;font-size:0.6rem;">x</button>',
                                        '</div>',
                                    '</div>',
                                    '<button type="button" id="add-name-history-btn" class="small" style="margin-top:8px;">+ Add Name Period</button>',
                                '</div>',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="cancel-team-form" class="secondary">Cancel</button>',
                                '<button type="submit" id="save-team-btn" class="primary">Save Team</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Member Modal -->',
            '<div id="member-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="modal-team-name">Team Members</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div class="member-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">',
                            '<select id="member-character" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<option value="">Select character...</option>',
                            '</select>',
                            '<input type="text" id="member-role" placeholder="Role" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-join" placeholder="Join" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-leave" placeholder="Leave" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<button id="add-member-btn" class="primary small">Add Member</button>',
                        '</div>',
                        '<div id="members-list">',
                            '<p class="empty-state">No members in this team</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Edit Member Modal -->',
            '<div id="edit-member-modal" class="modal hidden">',
                '<div class="modal-content small">',
                    '<div class="modal-header">',
                        '<h3>Edit Member</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="edit-member-form">',
                            '<div class="form-group">',
                                '<label>Character</label>',
                                '<p id="edit-member-name" style="margin:4px 0 12px 0;font-weight:600;"></p>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Role</label>',
                                '<input type="text" id="edit-member-role">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Join</label>',
                                '<input type="text" id="edit-member-join">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Leave</label>',
                                '<input type="text" id="edit-member-leave">',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="cancel-edit-member" class="secondary">Cancel</button>',
                                '<button type="submit" id="save-edit-member" class="primary">Save Changes</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Ranking Modal -->',
            '<div id="ranking-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="ranking-modal-title">Ranking History</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="ranking-form-inner">',
                            '<div class="ranking-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">',
                                '<input type="text" id="ranking-period" placeholder="Period" style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<input type="number" id="ranking-rank" placeholder="Rank" min="1" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<button type="button" id="add-ranking-btn" class="primary small">Add Ranking</button>',
                            '</div>',
                        '</form>',
                        '<div id="ranking-list">',
                            '<p class="empty-state">No ranking history</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // TEAM FORM HANDLING
    // ============================================================

    function showTeamForm(editId) {
        TeamModals.showTeamForm(editId);
    }

    function saveTeam(e) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;

        var type = document.getElementById('team-type').value;

        var teamData = {
            name: document.getElementById('team-name').value.trim(),
            type: type,
            startPeriod: document.getElementById('team-start').value || '',
            endPeriod: document.getElementById('team-end').value || '',
            status: document.getElementById('team-status').value || 'active',
            classId: type === 'academic'
                ? (document.getElementById('team-class').value || null)
                : null,
            teamNumber: type === 'academic'
                ? (document.getElementById('team-number').value.trim() || '')
                : '',
            temporaryMission: (type === 'temporary' || type === 'professional')
                ? (document.getElementById('team-mission').value || null)
                : null,
            nameHistory: collectNameHistory()
        };

        if (!teamData.name) {
            showNotification('Team name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = TeamCore.updateTeam(editId, teamData);
            if (!result) {
                showNotification('Failed to update team.', 'error');
                return;
            }
        } else {
            result = TeamCore.createTeam(teamData);
            if (!result) {
                showNotification('Failed to create team.', 'error');
                return;
            }
        }

        var modal = document.getElementById('team-form-modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        refreshTeamList();
        refreshTeamStats();
        safeUpdateDashboardStats();

        persistMutation(
            editId ? 'Team updated successfully!' : 'Team created successfully!',
            'Failed to save team changes to persistent storage. Your changes have been applied in memory.'
        );
    }

    function collectNameHistory() {
        var entries = document.querySelectorAll('.name-history-entry');
        var history = [];

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var name = entry.querySelector('.name-history-name');
            var start = entry.querySelector('.name-history-start');
            var end = entry.querySelector('.name-history-end');

            if (name && name.value.trim()) {
                history.push({
                    name: name.value.trim(),
                    startPeriod: start ? start.value.trim() : '',
                    endPeriod: end ? end.value.trim() : ''
                });
            }
        }

        return history;
    }

    function deleteTeam(id) {
        var team = TeamCore.getTeam(id);
        if (!team) {
            showNotification('Team not found.', 'error');
            return;
        }

        if (!confirm('Delete "' + team.name + '"? The team will be removed from the manager.')) {
            return;
        }

        var result = TeamCore.deleteTeam(id);

        if (!result) {
            showNotification('Failed to delete team.', 'error');
            return;
        }

        if (teamState.expandedTeamId === id) {
            teamState.expandedTeamId = null;
        }
        refreshTeamList();
        refreshTeamStats();
        safeUpdateDashboardStats();

        persistMutation(
            'Team deleted successfully!',
            'Failed to save team deletion to persistent storage. The team has been removed from memory.'
        );
    }

    // ============================================================
    // MEMBER MANAGEMENT - Delegates to TeamModals
    // ============================================================

    function openMemberModal(teamId) {
        TeamModals.showMemberModal(teamId);
    }

    function addMember() {
        TeamModals.handleAddMember();
    }

    function saveEditMember(e) {
        TeamModals.handleSaveEditMember(e);
    }

    // ============================================================
    // RANKING MANAGEMENT - Delegates to TeamModals
    // ============================================================

    function openRankingModal(teamId) {
        TeamModals.showRankingModal(teamId);
    }

    function addRanking(e) {
        TeamModals.handleAddRanking(e);
    }

    // ============================================================
    // APPLY FILTERS
    // ============================================================

    function applyFilters(tab) {
        var filter = teamState.filters[tab] || teamState.filters.academic;

        if (tab === 'academic') {
            var weekInput = document.getElementById('team-filter-week');
            var classFilter = document.getElementById('team-class-filter');
            var inactiveCheck = document.getElementById('academic-show-inactive');

            if (weekInput) {
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                    filter.filterWeek = week;
                }
            }
            if (classFilter) {
                filter.filterClass = classFilter.value;
            }
            if (inactiveCheck) {
                filter.filterStatus = inactiveCheck.checked ? 'inactive' : 'active';
            }
        } else if (tab === 'professional') {
            var yearInput = document.getElementById('team-filter-year');
            var profInactiveCheck = document.getElementById('professional-show-inactive');

            if (yearInput) {
                var year = parseInt(yearInput.value, 10);
                if (!isNaN(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
                    filter.filterYear = year;
                } else {
                    filter.filterYear = '';
                }
            }
            if (profInactiveCheck) {
                filter.filterStatus = profInactiveCheck.checked ? 'inactive' : 'active';
            }
        } else if (tab === 'temporary') {
            var tempYearInput = document.getElementById('team-filter-year');
            var tempInactiveCheck = document.getElementById('temporary-show-inactive');

            if (tempYearInput) {
                var year = parseInt(tempYearInput.value, 10);
                if (!isNaN(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
                    filter.filterYear = year;
                } else {
                    filter.filterYear = '';
                }
            }
            if (tempInactiveCheck) {
                filter.filterStatus = tempInactiveCheck.checked ? 'inactive' : 'active';
            }
        }

        refreshTeamList();
        refreshTeamStats();
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initTeamManagerEvents(container) {
        // Tab switching
        var tabNav = container.querySelector('#team-tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) {
                    return;
                }

                var tab = btn.dataset.tab;
                if (!tab) {
                    return;
                }

                teamState.currentTab = tab;

                // Update tab buttons
                var allBtns = tabNav.querySelectorAll('.tab-btn');
                for (var i = 0; i < allBtns.length; i++) {
                    var b = allBtns[i];
                    b.classList.remove('active');
                }
                btn.classList.add('active');

                // Update filter section
                var filterContainer = document.getElementById('filter-container');
                if (filterContainer) {
                    filterContainer.innerHTML = buildFilterHTML(tab);
                    var applyBtn = filterContainer.querySelector('#apply-filter-btn');
                    if (applyBtn) {
                        applyBtn.addEventListener('click', function() {
                            applyFilters(tab);
                        });
                    }
                    var inactiveCheck = filterContainer.querySelector('#academic-show-inactive, #professional-show-inactive, #temporary-show-inactive');
                    if (inactiveCheck) {
                        inactiveCheck.addEventListener('change', function() {
                            applyFilters(tab);
                        });
                    }
                }

                refreshTeamList();
                refreshTeamStats();
            });
        }

        // Add team button
        var addBtn = container.querySelector('#add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showTeamForm(null);
            });
        }

        // Team list actions - using event delegation
        var listContainer = container.querySelector('#team-list-container');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var button = e.target.closest('button');
                if (!button) {
                    return;
                }

                var teamId = button.dataset.id;
                if (!teamId && button.closest('.list-item')) {
                    teamId = button.closest('.list-item').dataset.id;
                }
                if (!teamId) {
                    return;
                }

                // Toggle members
                if (button.classList.contains('toggle-members')) {
                    if (teamState.expandedTeamId === teamId) {
                        teamState.expandedTeamId = null;
                    } else {
                        teamState.expandedTeamId = teamId;
                    }
                    refreshTeamList();
                    refreshTeamStats();
                    return;
                }

                // Manage members
                if (button.classList.contains('manage-members')) {
                    openMemberModal(teamId);
                    return;
                }

                // Manage rankings
                if (button.classList.contains('manage-rankings')) {
                    openRankingModal(teamId);
                    return;
                }

                // Edit team
                if (button.classList.contains('edit-team')) {
                    showTeamForm(teamId);
                    return;
                }

                // Delete team
                if (button.classList.contains('delete-team')) {
                    deleteTeam(teamId);
                    return;
                }
            });
        }

        // Form modals
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

        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', saveTeam);
        }

        // Type select change
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                TeamModals.updatePeriodLabels();
            });
        }

        // Add name history
        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                if (container) {
                    TeamModals.addNameHistoryEntry(container);
                }
            });
        }

        // Member modal
        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', addMember);
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
            editForm.addEventListener('submit', saveEditMember);
        }

        // Ranking modal
        var addRankBtn = document.getElementById('add-ranking-btn');
        if (addRankBtn) {
            addRankBtn.removeEventListener('click', addRanking);
            addRankBtn.addEventListener('click', addRanking);
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

        // Filter apply button (initial)
        var applyBtn = document.getElementById('apply-filter-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                applyFilters(teamState.currentTab);
            });
        }

        // Filter inactive checkboxes
        var inactiveChecks = container.querySelectorAll('#academic-show-inactive, #professional-show-inactive, #temporary-show-inactive');
        for (var i = 0; i < inactiveChecks.length; i++) {
            var check = inactiveChecks[i];
            check.addEventListener('change', function() {
                applyFilters(teamState.currentTab);
            });
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('teams', renderTeamManager);
            return true;
        }
        return false;
    }

    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderTeamManager = renderTeamManager;
    window.refreshTeamList = refreshTeamList;
    window.refreshTeamStats = refreshTeamStats;
    window.teamState = teamState;

})();
