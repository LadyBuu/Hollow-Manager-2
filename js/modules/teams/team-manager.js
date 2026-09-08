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

    var missing = [];

    if (!window.TeamCore) {
        missing.push('TeamCore');
    }
    if (!window.TeamQueries) {
        missing.push('TeamQueries');
    }
    if (!window.TeamFilters) {
        missing.push('TeamFilters');
    }
    if (!window.TeamMembers) {
        missing.push('TeamMembers');
    }
    if (!window.TeamRankings) {
        missing.push('TeamRankings');
    }
    if (!window.TeamRender) {
        missing.push('TeamRender');
    }
    if (!window.CharacterQueries) {
        missing.push('CharacterQueries');
    }
    if (!window.AcademyQueries) {
        missing.push('AcademyQueries');
    }
    if (!window.NotificationSystem) {
        missing.push('NotificationSystem');
    }
    if (!window.CALENDAR_CONSTANTS) {
        missing.push('CALENDAR_CONSTANTS');
    }
    if (!window.TabManager) {
        missing.push('TabManager');
    }
    if (!window.Modal) {
        missing.push('Modal');
    }

    if (missing.length > 0) {
        console.warn('TeamManager: Missing dependencies:', missing.join(', '));
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
        startInput.placeholder = 'Start';
        startInput.value = start || '';
        startInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.className = 'name-history-end';
        endInput.placeholder = 'End';
        endInput.value = end || '';
        endInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-name';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';
        removeBtn.textContent = 'x';

        entry.appendChild(nameInput);
        entry.appendChild(startInput);
        entry.appendChild(endInput);
        entry.appendChild(removeBtn);

        container.appendChild(entry);

        removeBtn.onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                showNotification('You need at least one name entry.', 'error');
            }
        };
    }

    // ============================================================
    // MEMBER MANAGEMENT - Integrated directly (no TeamModals dependency)
    // ============================================================

    function openMemberModal(teamId) {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        teamState.modalTeamId = teamId;

        var titleEl = document.getElementById('modal-team-name');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Members (Full History)';
        }

        populateMemberCharacterSelect(teamId);

        var roleInput = document.getElementById('member-role');
        if (roleInput) {
            roleInput.value = '';
        }

        var joinInput = document.getElementById('member-join');
        if (joinInput) {
            joinInput.value = '';
        }

        var leaveInput = document.getElementById('member-leave');
        if (leaveInput) {
            leaveInput.value = '';
        }

        refreshMemberList(teamId);

        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');

        attachMemberEvents(teamId);
    }

    function closeMemberModal() {
        var modal = document.getElementById('member-modal');
        if (modal) {
            modal.classList.add('hidden');
            teamState.modalTeamId = null;
        }
    }

    function attachMemberEvents(teamId) {
        var container = document.getElementById('members-list');
        if (!container) {
            return;
        }

        container.removeEventListener('click', handleMemberClick);
        container.addEventListener('click', handleMemberClick);
        container.dataset.teamId = teamId;
    }

    function handleMemberClick(e) {
        var target = e.target.closest('button');
        if (!target) {
            return;
        }

        var container = document.getElementById('members-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) {
            return;
        }

        if (target.classList.contains('edit-member')) {
            e.stopPropagation();
            var charId = target.dataset.characterId;
            if (charId) {
                showEditMemberModal(teamId, charId);
            }
            return;
        }

        if (target.classList.contains('remove-member')) {
            e.stopPropagation();
            var charId = target.dataset.characterId;
            if (charId && confirm('Remove this member from the team?')) {
                var result = TeamCore.removeMember(teamId, charId);
                if (result) {
                    refreshAllMemberUI(teamId);
                    refreshTeamStats();
                } else {
                    showNotification('Failed to remove member.', 'error');
                }
            }
            return;
        }
    }

    function showEditMemberModal(teamId, charId) {
        var modal = document.getElementById('edit-member-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team || !team.members) {
            showNotification('Team not found.', 'error');
            return;
        }

        var member = null;
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === String(charId)) {
                member = m;
                break;
            }
        }

        if (!member) {
            showNotification('Member not found.', 'error');
            return;
        }

        var character = CharacterQueries.getCharacterById(member.characterId);
        var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

        var nameEl = document.getElementById('edit-member-name');
        if (nameEl) {
            nameEl.textContent = name;
        }

        var roleEl = document.getElementById('edit-member-role');
        if (roleEl) {
            roleEl.value = member.role || '';
        }

        var joinEl = document.getElementById('edit-member-join');
        if (joinEl) {
            joinEl.value = member.joinPeriod || '';
        }

        var leaveEl = document.getElementById('edit-member-leave');
        if (leaveEl) {
            leaveEl.value = member.leavePeriod || '';
        }

        modal.dataset.teamId = teamId;
        modal.dataset.characterId = charId;
        modal.classList.remove('hidden');
    }

    function closeEditMemberModal() {
        var modal = document.getElementById('edit-member-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function populateMemberCharacterSelect(teamId) {
        var select = document.getElementById('member-character');
        if (!select) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        select.innerHTML = '<option value="">Select character...</option>';

        var data = window.data || {};
        var characters = Array.isArray(data.characters) ? data.characters : [];

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char || typeof char !== 'object') {
                continue;
            }

            var isInTeam = false;
            if (Array.isArray(team.members)) {
                for (var j = 0; j < team.members.length; j++) {
                    if (team.members[j] && String(team.members[j].characterId) === String(char.id)) {
                        isInTeam = true;
                        break;
                    }
                }
            }

            var option = document.createElement('option');
            option.value = char.id;
            var displayName = CharacterQueries.getDisplayName(char);
            option.textContent = displayName + (isInTeam ? ' (In Team)' : '');
            if (isInTeam) {
                option.disabled = true;
            }
            select.appendChild(option);
        }
    }

    function refreshMemberList(teamId) {
        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var container = document.getElementById('members-list');
        if (!container) {
            return;
        }

        var members = Array.isArray(team.members) ? team.members : [];

        if (members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members in this team</p>';
            return;
        }

        var html = '';
        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }

            var character = CharacterQueries.getCharacterById(member.characterId);
            var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

            html += '<div class="member-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span><strong>' + escapeHtml(name) + '</strong> <span style="color:var(--text-dim);font-size:0.65rem;">(' + escapeHtml(member.role || 'Member') + ')</span>';
            html += ' <span style="color:var(--text-dim);font-size:0.6rem;">' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + escapeHtml(member.leavePeriod) : '') + '</span>';
            html += '</span>';
            html += '<span>';
            html += '<button class="small edit-member" data-character-id="' + escapeAttribute(member.characterId) + '" style="font-size:0.6rem;padding:2px 6px;">Edit</button>';
            html += '<button class="small danger remove-member" data-character-id="' + escapeAttribute(member.characterId) + '" style="font-size:0.6rem;padding:2px 6px;">✕</button>';
            html += '</span>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function refreshAllMemberUI(teamId) {
        refreshMemberList(teamId);
        refreshTeamList();
    }

    function addMember() {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            showNotification('Member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            showNotification('No team selected.', 'error');
            return;
        }

        var charSelect = document.getElementById('member-character');
        var roleInput = document.getElementById('member-role');
        var joinInput = document.getElementById('member-join');
        var leaveInput = document.getElementById('member-leave');

        var charId = charSelect ? charSelect.value : '';
        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

        if (!charId) {
            showNotification('Please select a character.', 'error');
            return;
        }

        var result = TeamCore.addMember(teamId, {
            characterId: charId,
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to add member. The character may already be in this team.', 'error');
            return;
        }

        if (charSelect) {
            charSelect.value = '';
        }
        if (roleInput) {
            roleInput.value = '';
        }
        if (joinInput) {
            joinInput.value = '';
        }
        if (leaveInput) {
            leaveInput.value = '';
        }

        refreshAllMemberUI(teamId);
        refreshTeamStats();
        showNotification('Member added successfully!', 'success');
    }

    function saveEditMember(e) {
        e.preventDefault();

        var modal = document.getElementById('edit-member-modal');
        if (!modal) {
            showNotification('Edit member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        var charId = modal.dataset.characterId;

        if (!teamId || !charId) {
            showNotification('No member selected.', 'error');
            return;
        }

        var roleInput = document.getElementById('edit-member-role');
        var joinInput = document.getElementById('edit-member-join');
        var leaveInput = document.getElementById('edit-member-leave');

        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

        var result = TeamCore.updateMember(teamId, charId, {
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to update member.', 'error');
            return;
        }

        modal.classList.add('hidden');

        refreshAllMemberUI(teamId);
        refreshTeamStats();
        showNotification('Member updated successfully!', 'success');
    }

    // ============================================================
    // RANKING MANAGEMENT - Integrated directly (no TeamModals dependency)
    // ============================================================

    function openRankingModal(teamId) {
        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        teamState.modalTeamId = teamId;

        var titleEl = document.getElementById('ranking-modal-title');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Ranking History';
        }

        var periodInput = document.getElementById('ranking-period');
        if (periodInput) {
            periodInput.value = '';
            if (team.type === 'academic') {
                periodInput.placeholder = 'Week (e.g., 1)';
            } else {
                periodInput.placeholder = 'Year';
            }
        }

        var rankInput = document.getElementById('ranking-rank');
        if (rankInput) {
            rankInput.value = '';
        }

        modal.dataset.teamId = teamId;

        refreshRankingList(teamId);

        modal.classList.remove('hidden');

        attachRankingEvents(teamId);
    }

    function closeRankingModal() {
        var modal = document.getElementById('ranking-modal');
        if (modal) {
            modal.classList.add('hidden');
            teamState.modalTeamId = null;
        }
    }

    function attachRankingEvents(teamId) {
        var container = document.getElementById('ranking-list');
        if (!container) {
            return;
        }

        container.removeEventListener('click', handleRankingClick);
        container.addEventListener('click', handleRankingClick);
        container.dataset.teamId = teamId;
    }

    function handleRankingClick(e) {
        var target = e.target.closest('button');
        if (!target) {
            return;
        }

        var container = document.getElementById('ranking-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) {
            return;
        }

        if (target.classList.contains('remove-ranking')) {
            e.stopPropagation();
            var period = target.dataset.period;
            if (period && confirm('Remove this ranking entry?')) {
                var result = TeamCore.removeRanking(teamId, period);
                if (result) {
                    refreshAllRankingUI(teamId);
                    refreshTeamStats();
                } else {
                    showNotification('Failed to remove ranking.', 'error');
                }
            }
        }
    }

    function refreshRankingList(teamId) {
        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var container = document.getElementById('ranking-list');
        if (!container) {
            return;
        }

        var history = TeamCore.getSortedRankings(team);

        if (history.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking history</p>';
            return;
        }

        var html = '';
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span>Period: <strong>' + escapeHtml(entry.period) + '</strong> → Rank: <strong>#' + escapeHtml(entry.rank) + '</strong></span>';
            html += '<button class="small danger remove-ranking" data-period="' + escapeAttribute(entry.period) + '" style="font-size:0.6rem;padding:2px 6px;">✕</button>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function refreshAllRankingUI(teamId) {
        refreshRankingList(teamId);
        refreshTeamList();
    }

    function addRanking(e) {
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            showNotification('Ranking modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            showNotification('No team selected.', 'error');
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            showNotification('Team not found.', 'error');
            return;
        }

        var periodInput = document.getElementById('ranking-period');
        var rankInput = document.getElementById('ranking-rank');

        var period = periodInput ? periodInput.value.trim() : '';
        var rank = rankInput ? parseInt(rankInput.value, 10) : null;

        if (!period) {
            showNotification('Please enter a period.', 'error');
            return;
        }

        if (!Number.isInteger(rank) || rank < 1) {
            showNotification('Please enter a valid rank (positive integer).', 'error');
            return;
        }

        var result = TeamCore.addRanking(teamId, period, rank);
        if (!result) {
            showNotification('Failed to add ranking.', 'error');
            return;
        }

        if (periodInput) {
            periodInput.value = '';
        }
        if (rankInput) {
            rankInput.value = '';
        }

        refreshAllRankingUI(teamId);
        refreshTeamStats();
        showNotification('Ranking added successfully!', 'success');
    }

    // ============================================================
    // APPLY FILTERS
    // ============================================================

    function applyFilters(tab) {
        var filter = teamState.filters[tab] || teamState.filters.professional;

        if (tab === 'professional') {
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
        } else if (tab === 'civilian') {
            var civInactiveCheck = document.getElementById('civilian-show-inactive');
            if (civInactiveCheck) {
                filter.filterStatus = civInactiveCheck.checked ? 'inactive' : 'active';
            }
        }

        refreshTeamList();
        refreshTeamStats();
    }

    // ============================================================
    // TEAM CRUD OPERATIONS
    // ============================================================

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
                    var inactiveCheck = filterContainer.querySelector('#professional-show-inactive, #temporary-show-inactive, #civilian-show-inactive');
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
                updatePeriodLabels();
            });
        }

        // Add name history
        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                if (container) {
                    addNameHistoryEntry(container);
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
                closeMemberModal();
            });
        }

        var memberBg = document.getElementById('member-modal');
        if (memberBg) {
            memberBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeMemberModal();
                }
            });
        }

        // Edit member
        var editClose = document.querySelector('#edit-member-modal .close-modal');
        if (editClose) {
            editClose.addEventListener('click', function() {
                closeEditMemberModal();
            });
        }

        var editBg = document.getElementById('edit-member-modal');
        if (editBg) {
            editBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeEditMemberModal();
                }
            });
        }

        var cancelEdit = document.getElementById('cancel-edit-member');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', function() {
                closeEditMemberModal();
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
                closeRankingModal();
            });
        }

        var rankBg = document.getElementById('ranking-modal');
        if (rankBg) {
            rankBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeRankingModal();
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
        var inactiveChecks = container.querySelectorAll('#professional-show-inactive, #temporary-show-inactive, #civilian-show-inactive');
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
