/**
 * js/modules/teams/team-manager.js - Team Manager
 * Handles team UI orchestration and user interaction
 * Path: js/modules/teams/team-manager.js
 * 
 * This module is responsible for:
 *   - Orchestrating the team manager UI
 *   - Team CRUD operations (delegates to TeamCore)
 *   - Member management (delegates to TeamCore)
 *   - Ranking management (delegates to TeamCore)
 *   - Filtering (delegates to TeamFilters)
 *   - Modal management (integrated directly)
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
 *     - window.TeamMembers
 *     - window.TeamRankings
 *     - window.TeamRender
 *     - window.CharacterQueries
 *     - window.AcademyQueries (replaces ClassesQueries)
 *     - window.NotificationSystem
 *     - window.CALENDAR_CONSTANTS
 *     - window.TabManager
 *     - window.Modal
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
        console.warn('TeamManager: TeamCore not available.');
        return;
    }
    if (!window.TeamQueries) {
        console.warn('TeamManager: TeamQueries not available.');
        return;
    }
    if (!window.TeamFilters) {
        console.warn('TeamManager: TeamFilters not available.');
        return;
    }
    if (!window.TeamMembers) {
        console.warn('TeamManager: TeamMembers not available.');
        return;
    }
    if (!window.TeamRankings) {
        console.warn('TeamManager: TeamRankings not available.');
        return;
    }
    if (!window.TeamRender) {
        console.warn('TeamManager: TeamRender not available.');
        return;
    }
    if (!window.CharacterQueries) {
        console.warn('TeamManager: CharacterQueries not available.');
        return;
    }
    if (!window.AcademyQueries) {
        console.warn('TeamManager: AcademyQueries not available.');
        return;
    }
    if (!window.NotificationSystem) {
        console.warn('TeamManager: NotificationSystem not available.');
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        console.warn('TeamManager: CALENDAR_CONSTANTS not available.');
        return;
    }
    if (!window.TabManager) {
        console.warn('TeamManager: TabManager not available.');
        return;
    }
    if (!window.Modal) {
        console.warn('TeamManager: Modal not available.');
        return;
    }

    window.__teamManagerLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamFilters = window.TeamFilters;
    var TeamMembers = window.TeamMembers;
    var TeamRankings = window.TeamRankings;
    var TeamRender = window.TeamRender;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var NotificationSystem = window.NotificationSystem;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var TabManager = window.TabManager;
    var Modal = window.Modal;

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

    function escapeAttribute(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
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
    // CLASS HELPERS - Uses AcademyQueries (replaces ClassesQueries)
    // ============================================================

    function getClassDisplayName(classId) {
        if (!classId) {
            return 'Unassigned';
        }
        return AcademyQueries.getClassDisplayName(classId) || 'Unassigned';
    }

    function getClasses() {
        return AcademyQueries.getClasses() || [];
    }

    // ============================================================
    // STATE
    // ============================================================

    var teamState = {
        currentTab: 'professional',
        expandedTeamId: null,
        filters: {
            professional: { filterYear: '', filterStatus: 'active' },
            temporary: { filterYear: '', filterStatus: 'active' },
            civilian: { filterStatus: 'active' }
        },
        // Modal state
        modalTeamId: null,
        modalMemberId: null,
        modalRankingPeriod: null
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

        // Only count professional, temporary, civilian (academic is in academy module)
        var allProf = 0;
        var allTemp = 0;
        var allCiv = 0;

        for (var j = 0; j < visibleTeams.length; j++) {
            var t = visibleTeams[j];
            var normalizedType = TeamCore.normalizeTeamType(t.type);
            if (normalizedType === 'professional') {
                allProf++;
            } else if (normalizedType === 'temporary') {
                allTemp++;
            } else if (normalizedType === 'civilian') {
                allCiv++;
            }
        }

        // Update tab button labels
        var tabButtons = container.querySelectorAll('.tab-btn');
        var tabMap = {
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
        var counts = [allProf, allTemp, allCiv];
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

        // Only count professional, temporary, civilian (academic is in academy module)
        var allProf = 0;
        var allTemp = 0;
        var allCiv = 0;

        for (var j = 0; j < visibleTeams.length; j++) {
            var t = visibleTeams[j];
            var normalizedType = TeamCore.normalizeTeamType(t.type);
            if (normalizedType === 'professional') {
                allProf++;
            } else if (normalizedType === 'temporary') {
                allTemp++;
            } else if (normalizedType === 'civilian') {
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
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' + allProf + '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' + allTemp + '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' + allCiv + '</p></div>';
        html += '</div>';

        // Tab buttons - academic removed (handled in academy module)
        html += '<div class="tab-nav" id="team-tab-nav">';
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
        var filter = teamState.filters[tab] || teamState.filters.professional;

        if (tab === 'professional') {
            return getProfessionalFilterHTML(filter);
        } else if (tab === 'temporary') {
            return getTemporaryFilterHTML(filter);
        } else if (tab === 'civilian') {
            return getCivilianFilterHTML(filter);
        }
        return '';
    }

    function getProfessionalFilterHTML(filter) {
        var html = '';
        html += '<div class="filter-row">';
        html += '<div class="filter-group">';
        html += '<label for="team-filter-year">Year:</label>';
        html += '<input type="number" id="team-filter-year" value="' + (filter.filterYear || '') + '" min="' + MIN_YEAR + '" max="' + MAX_YEAR + '" placeholder="All">';
        html += '</div>';
        html += '<div class="filter-group">';
        html += '<label for="professional-show-inactive">Show Inactive:</label>';
        html += '<input type="checkbox" id="professional-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + '>';
        html += '</div>';
        html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
        html += '</div>';
        return html;
    }

    function getTemporaryFilterHTML(filter) {
        var html = '';
        html += '<div class="filter-row">';
        html += '<div class="filter-group">';
        html += '<label for="team-filter-year">Year:</label>';
        html += '<input type="number" id="team-filter-year" value="' + (filter.filterYear || '') + '" min="' + MIN_YEAR + '" max="' + MAX_YEAR + '" placeholder="All">';
        html += '</div>';
        html += '<div class="filter-group">';
        html += '<label for="temporary-show-inactive">Show Inactive:</label>';
        html += '<input type="checkbox" id="temporary-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + '>';
        html += '</div>';
        html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
        html += '</div>';
        return html;
    }

    function getCivilianFilterHTML(filter) {
        var html = '';
        html += '<div class="filter-row">';
        html += '<div class="filter-group">';
        html += '<label for="civilian-show-inactive">Show Inactive:</label>';
        html += '<input type="checkbox" id="civilian-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + '>';
        html += '</div>';
        html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // GET FILTERED TEAMS
    // ============================================================

    function getFilteredTeamsForTab(tab) {
        var filter = teamState.filters[tab] || teamState.filters.professional;

        if (tab === 'professional') {
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

        var periodNum = 1;

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

        var periodNum = 1;

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
                                        '<option value="professional">Professional</option>',
                                        '<option value="temporary">Temporary</option>',
                                        '<option value="civilian">Civilian</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-start-label">Start Period</label>',
                                    '<input type="text" id="team-start" placeholder="Year">',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-end-label">End Period (optional)</label>',
                                    '<input type="text" id="team-end" placeholder="Year">',
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
                                '<div class="form-group full-width" id="temporary-mission-field">',
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
        var modal = document.getElementById('team-form-modal');
        if (!modal) {
            return;
        }

        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        populateClassSelector();
        populateMissionSelector();

        if (editId) {
            title.textContent = 'Edit Team';
            var team = TeamCore.getTeam(editId);
            if (team) {
                setFieldValue('team-name', team.name);
                setFieldValue('team-type', team.type || 'professional');
                setFieldValue('team-start', team.startPeriod);
                setFieldValue('team-end', team.endPeriod);

                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    var currentRank = TeamQueries.getTeamCurrentRank(team);
                    rankingInput.value = currentRank || '';
                    rankingInput.disabled = true;
                }

                setFieldValue('team-status', team.status || 'active');

                var missionSelect = document.getElementById('team-mission');
                if (missionSelect && team.temporaryMission) {
                    missionSelect.value = team.temporaryMission;
                }

                if (form) {
                    form.dataset.editId = editId;
                }

                var container = document.getElementById('name-history-container');
                if (container) {
                    container.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        for (var i = 0; i < team.nameHistory.length; i++) {
                            var entry = team.nameHistory[i];
                            addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                        }
                    } else {
                        addNameHistoryEntry(container);
                    }
                }
            }
        } else {
            title.textContent = 'Add Team';
            if (form) {
                form.reset();
                setFieldValue('team-type', 'professional');
                setFieldValue('team-status', 'active');

                var rankingInput2 = document.getElementById('team-ranking');
                if (rankingInput2) {
                    rankingInput2.value = '';
                    rankingInput2.disabled = true;
                }

                delete form.dataset.editId;
            }

            var container2 = document.getElementById('name-history-container');
            if (container2) {
                container2.innerHTML = '';
                addNameHistoryEntry(container2);
            }
        }

        updatePeriodLabels();
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            toggleMissionField(typeSelect.value);
        }
    }

    function closeTeamForm() {
        var modal = document.getElementById('team-form-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // TEAM FORM HELPERS
    // ============================================================

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? String(value) : '';
        }
    }

    function populateClassSelector() {
        var select = document.getElementById('team-class');
        if (!select) {
            return;
        }

        var classes = AcademyQueries.getClasses();
        var currentValue = select.value;
        select.innerHTML = '<option value="">Unassigned</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
        if (currentValue) {
            select.value = currentValue;
        }
    }

    function populateMissionSelector() {
        var select = document.getElementById('team-mission');
        if (!select) {
            return;
        }

        var data = window.data || {};
        var missions = data.missions || [];
        select.innerHTML = '<option value="">None</option>';

        var sortedMissions = missions.slice().sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') {
                return -1;
            }
            if (a.status !== 'active' && b.status === 'active') {
                return 1;
            }
            var titleA = String(a.title || '');
            var titleB = String(b.title || '');
            return titleA.localeCompare(titleB);
        });

        for (var i = 0; i < sortedMissions.length; i++) {
            var mission = sortedMissions[i];
            if (mission.status !== 'cancelled') {
                var option = document.createElement('option');
                option.value = mission.id;
                var title = String(mission.title || 'Untitled');
                option.textContent = title + (mission.status === 'completed' ? ' (completed)' : '');
                select.appendChild(option);
            }
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
        if (!typeSelect) {
            return;
        }

        var type = typeSelect.value;
        var startLabel = document.getElementById('team-start-label');
        var endLabel = document.getElementById('team-end-label');
        var startInput = document.getElementById('team-start');
        var endInput = document.getElementById('team-end');

        if (type === 'academic') {
            if (startLabel) {
                startLabel.textContent = 'Start Week (' + MIN_WEEK + '-' + MAX_WEEK + ')';
            }
            if (endLabel) {
                endLabel.textContent = 'End Week (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Week (e.g., 1)';
            }
            if (endInput) {
                endInput.placeholder = 'Week (e.g., ' + MAX_WEEK + ')';
            }
        } else {
            if (startLabel) {
                startLabel.textContent = 'Start Period (' + MIN_YEAR + '-' + MAX_YEAR + ')';
            }
            if (endLabel) {
                endLabel.textContent = 'End Period (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Year (e.g., ' + MIN_YEAR + ')';
            }
            if (endInput) {
                endInput.placeholder = 'Year (e.g., ' + MAX_YEAR + ')';
            }
        }

        toggleMissionField(type);
    }

    function addNameHistoryEntry(container, name, start, end) {
        if (!container) {
            return;
        }

        var entry = document.createElement('div');
        entry.className = 'name-history-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'name-history-name';
        nameInput.placeholder = 'Team Name';
        nameInput.value = name || '';
        nameInput.style.cssText = 'flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.className = 'name-history-start';
