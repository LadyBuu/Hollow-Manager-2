/**
 * modules/teams/team-render.js - Team Rendering
 * Pure rendering for team lists and team data
 * 
 * This module provides:
 *   - renderList - Render a list of teams
 *   - renderExpandedMembers - Render expanded member section
 *   - renderTeamCard - Render a single team card
 *   - renderTeamSummary - Render a team summary
 *   - renderContainer - Render the team manager container
 * 
 * IMPORTANT:
 *   - PURE RENDERING - no event binding, no mutations, no state
 *   - No data mutations
 *   - No persistence calls
 *   - No direct window.data access - uses TeamAggregator for data
 *   - Uses TeamQueries for simple team data
 *   - Uses TeamConstants for labels and types
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent or escapeHtml
 * 
 * DEPENDENCIES:
 *   - window.TeamAggregator (from team-aggregator.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var TR = window.TeamRender;
 *   var html = TR.renderList(teams, 'professional', 5, 'team_123');
 *   var container = TR.renderContainer('professional');
 */

(function() {
    'use strict';

    if (window.__teamRenderLoaded) {
        return;
    }
    window.__teamRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TeamAggregator = window.TeamAggregator;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var DomUtils = window.DomUtils;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamAggregator || typeof TeamAggregator.getTeamPageViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamPageViewModel');
        }
        if (!TeamAggregator || typeof TeamAggregator.getTeamMembersViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamMembersViewModel');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamPeriodDisplay !== 'function') {
            missing.push('TeamQueries.getTeamPeriodDisplay');
        }
        if (!TeamQueries || typeof TeamQueries.getCurrentRank !== 'function') {
            missing.push('TeamQueries.getCurrentRank');
        }

        if (!TeamConstants) {
            missing.push('TeamConstants');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[TeamRender] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // CONSTANTS - From TeamConstants
    // ============================================================

    var DEFAULT_TEAM_TYPE = TeamConstants.DEFAULT_TEAM_TYPE;
    var DEFAULT_TEAM_STATUS = TeamConstants.DEFAULT_TEAM_STATUS;

    // ============================================================
    // TEAM LIST RENDERING
    // ============================================================

    /**
     * Render a list of teams.
     * 
     * @param {array} teams - Array of team objects (from TeamQueries)
     * @param {string} type - Team type for labels
     * @param {number|string} filterPeriod - Current period for member filtering
     * @param {string} expandedTeamId - ID of expanded team
     * @returns {string} HTML string
     */
    function renderList(teams, type, filterPeriod, expandedTeamId) {
        if (!teams || teams.length === 0) {
            var labels = {
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams',
                'academic': 'academic teams'
            };
            return '<p class="empty-state" style="padding:20px;">No ' + (labels[type] || 'teams') + ' found.</p>';
        }

        var periodNum = parseInt(filterPeriod, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = 1;
        }

        var html = '';
        html += '<div class="list-header team-header">';
        html += '<span>Team Name</span>';
        html += '<span>Period</span>';
        html += '<span>Rank</span>';
        html += '<span>Members</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }

            var periodDisplay = TeamQueries.getTeamPeriodDisplay(team);
            var typeLabel = TeamConstants.getTypeLabel(team.type);

            var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
            var memberCount = activeMembers.length;

            var isExpanded = (expandedTeamId === team.id);
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var inactiveClass = isInactive ? 'inactive' : '';

            var rankDisplay = TeamQueries.getCurrentRank(team) || '-';

            var classDisplay = '';
            if (team.type === 'academic' && team.classId) {
                var className = TeamAggregator.getClassDisplayName(team.classId);
                if (className && className !== 'Unassigned') {
                    classDisplay = ' <span class="team-class">[' + escapeHtml(className) + ']</span>';
                }
            }

            // Team row - using CSS classes for styling
            html += '<div class="list-item team-item ' + inactiveClass + '" data-id="' + escapeAttribute(team.id) + '">';
            html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span class="team-type-label">' + escapeHtml(typeLabel) + '</span>';
            if (isInactive) {
                html += ' <span class="team-status-inactive">(Inactive)</span>';
            }
            html += '</span>';
            html += '<span class="team-period">' + escapeHtml(periodDisplay) + '</span>';
            html += '<span class="team-rank">' + escapeHtml(rankDisplay) + '</span>';
            html += '<span class="team-member-count">' + memberCount + '</span>';
            html += '<span class="actions">' +
                '<button class="small toggle-members" data-id="' + escapeAttribute(team.id) + '">' + (isExpanded ? '\u25be' : '\u25b8') + '</button>' +
                '<button class="small manage-members" data-id="' + escapeAttribute(team.id) + '">Members</button>' +
                '<button class="small manage-rankings" data-id="' + escapeAttribute(team.id) + '">Rankings</button>' +
                '<button class="small edit-team" data-id="' + escapeAttribute(team.id) + '">Edit</button>' +
                '<button class="small danger delete-team" data-id="' + escapeAttribute(team.id) + '">Delete</button>' +
                '</span>';
            html += '</div>';

            if (isExpanded) {
                html += renderExpandedMembers(team, periodNum);
            }
        }

        return html;
    }

    // ============================================================
    // EXPANDED MEMBERS RENDERING
    // ============================================================

    /**
     * Render expanded members section.
     * Uses TeamAggregator for member data.
     * 
     * @param {object} team - Team object
     * @param {number|string} filterPeriod - Current period
     * @returns {string} HTML string
     */
    function renderExpandedMembers(team, filterPeriod) {
        if (!team || typeof team !== 'object') {
            return '';
        }

        var periodNum = parseInt(filterPeriod, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = 1;
        }

        var periodLabel = TeamConstants.getPeriodLabel(team.type);

        // Use TeamAggregator for member data
        var membersVM = TeamAggregator.getTeamMembersViewModel(team.id, periodNum);
        if (!membersVM) {
            return '';
        }

        var activeMembers = membersVM.members.filter(function(m) {
            return m.activeAtPeriod;
        });

        var labelText = 'Active Members in ' + periodLabel + ' ' + periodNum + ':';

        var html = '<div class="team-members-expanded" data-team-id="' + escapeAttribute(team.id) + '">';

        if (activeMembers.length > 0) {
            html += '<div class="members-expanded-header">' + escapeHtml(labelText) + '</div>';
            for (var i = 0; i < activeMembers.length; i++) {
                var member = activeMembers[i];
                if (!member) {
                    continue;
                }

                var statusInfo = getMemberStatusInfo(member);
                var statusClass = statusInfo.className;

                html += '<div class="member-entry ' + statusClass + '">';
                html += '<span>' + escapeHtml(member.displayName) + ' <span class="role">(' + escapeHtml(member.role) + ')</span></span>';
                html += '<span class="member-details">Age: ' + escapeHtml(member.age || '-') + ' | Joined: ' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' \u2192 ' + escapeHtml(member.leavePeriod) : '') + ' | <span class="member-status">' + escapeHtml(statusInfo.label) + '</span></span>';
                html += '</div>';
            }
        } else {
            html += '<div class="member-entry empty">No active members this ' + periodLabel.toLowerCase() + '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MEMBER STATUS INFO
    // ============================================================

    function getMemberStatusInfo(member) {
        if (!member) {
            return { label: 'Unknown', className: 'status-unknown' };
        }

        if (member.deceased) {
            return { label: 'Deceased', className: 'status-deceased' };
        }

        if (member.status) {
            var statusLower = String(member.status).toLowerCase();
            if (statusLower === 'eliminated') {
                return { label: 'Eliminated', className: 'status-eliminated' };
            }
            if (statusLower === 'former' || statusLower === 'inactive') {
                return { label: 'Former', className: 'status-left' };
            }
            if (statusLower === 'active') {
                return { label: 'Active', className: 'status-active' };
            }
            if (statusLower === 'future') {
                return { label: 'Future Member', className: 'status-future' };
            }
        }

        if (!member.activeAtPeriod) {
            return { label: 'Former', className: 'status-left' };
        }

        return { label: 'Active', className: 'status-active' };
    }

    // ============================================================
    // TEAM CARD RENDERING
    // ============================================================

    /**
     * Render a single team card for compact display.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Current period
     * @returns {string} HTML string
     */
    function renderTeamCard(team, period) {
        if (!team || typeof team !== 'object') {
            return '';
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = 1;
        }

        var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
        var memberCount = activeMembers.length;
        var rankDisplay = TeamQueries.getCurrentRank(team) || '-';
        var periodDisplay = TeamQueries.getTeamPeriodDisplay(team);
        var typeLabel = TeamConstants.getTypeLabel(team.type);

        var isInactive = team.status === 'deprecated' || team.status === 'inactive';
        var inactiveClass = isInactive ? 'inactive' : '';

        var classDisplay = '';
        if (team.type === 'academic' && team.classId) {
            var className = TeamAggregator.getClassDisplayName(team.classId);
            if (className && className !== 'Unassigned') {
                classDisplay = ' <span class="team-class">[' + escapeHtml(className) + ']</span>';
            }
        }

        var html = '<div class="team-card ' + inactiveClass + '" data-id="' + escapeAttribute(team.id) + '">';
        html += '<div class="team-card-header">';
        html += '<strong>' + escapeHtml(team.name) + '</strong>' + classDisplay;
        html += ' <span class="team-type-label">' + escapeHtml(typeLabel) + '</span>';
        if (isInactive) {
            html += ' <span class="team-status-inactive">(Inactive)</span>';
        }
        html += '</div>';
        html += '<div class="team-card-details">';
        html += '<span class="team-period">' + escapeHtml(periodDisplay) + '</span>';
        html += '<span class="team-rank">Rank: ' + escapeHtml(rankDisplay) + '</span>';
        html += '<span class="team-member-count">Members: ' + memberCount + '</span>';
        html += '</div>';
        html += '<div class="team-card-actions">';
        html += '<button class="small toggle-members" data-id="' + escapeAttribute(team.id) + '">\u25b8</button>';
        html += '<button class="small manage-members" data-id="' + escapeAttribute(team.id) + '">Members</button>';
        html += '<button class="small manage-rankings" data-id="' + escapeAttribute(team.id) + '">Rankings</button>';
        html += '<button class="small edit-team" data-id="' + escapeAttribute(team.id) + '">Edit</button>';
        html += '<button class="small danger delete-team" data-id="' + escapeAttribute(team.id) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // TEAM SUMMARY RENDERING
    // ============================================================

    /**
     * Render a team summary for dashboard or quick view.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Current period for member count
     * @returns {string} HTML string
     */
    function renderTeamSummary(team, period) {
        if (!team || typeof team !== 'object') {
            return '';
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = 1;
        }

        var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
        var memberCount = activeMembers.length;
        var rankDisplay = TeamQueries.getCurrentRank(team) || '-';
        var typeLabel = TeamConstants.getTypeLabel(team.type);

        var html = '<div class="team-summary">';
        html += '<span class="team-name">' + escapeHtml(team.name) + '</span>';
        html += '<span class="team-type">' + escapeHtml(typeLabel) + '</span>';
        html += '<span class="team-rank">#' + escapeHtml(rankDisplay) + '</span>';
        html += '<span class="team-members">' + memberCount + ' active members</span>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // CONTAINER RENDERING
    // ============================================================

    /**
     * Render the team manager container.
     * 
     * @param {string} activeTab - Current active tab
     * @param {object} viewModel - Optional view model from TeamAggregator
     * @returns {string} HTML string
     */
    function renderContainer(activeTab, viewModel) {
        activeTab = activeTab || DEFAULT_TEAM_TYPE;

        viewModel = viewModel || TeamAggregator.getTeamPageViewModel({
            type: activeTab,
            period: 1
        });

        var counts = viewModel.counts || { professional: 0, temporary: 0, civilian: 0 };
        var teams = viewModel.teams || [];
        var expandedTeamId = viewModel.expandedTeamId || null;
        var period = viewModel.period || 1;

        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' + counts.professional + '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' + counts.temporary + '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' + counts.civilian + '</p></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" id="team-tab-nav">';
        html += '<button class="tab-btn ' + (activeTab === 'professional' ? 'active' : '') + '" data-tab="professional">Professional (' + counts.professional + ')</button>';
        html += '<button class="tab-btn ' + (activeTab === 'temporary' ? 'active' : '') + '" data-tab="temporary">Temporary (' + counts.temporary + ')</button>';
        html += '<button class="tab-btn ' + (activeTab === 'civilian' ? 'active' : '') + '" data-tab="civilian">Civilian (' + counts.civilian + ')</button>';
        html += '</div>';

        // Filter section
        html += '<div id="filter-container" class="filter-container">';
        html += buildFilterHTML(activeTab);
        html += '</div>';

        // Team list
        html += '<div id="team-list-container" class="team-list-container">';
        html += renderList(teams, activeTab, period, expandedTeamId);
        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // FILTER HTML
    // ============================================================

    function buildFilterHTML(tab) {
        if (tab === 'professional' || tab === 'temporary') {
            return [
                '<div class="filter-row">',
                    '<div class="filter-group">',
                        '<label for="team-filter-year">Year:</label>',
                        '<input type="number" id="team-filter-year" value="" min="1900" max="2100" placeholder="All">',
                    '</div>',
                    '<div class="filter-group">',
                        '<label for="' + tab + '-show-inactive">Show Inactive:</label>',
                        '<input type="checkbox" id="' + tab + '-show-inactive">',
                    '</div>',
                    '<button id="apply-filter-btn" class="small primary">Apply</button>',
                '</div>'
            ].join('');
        }

        if (tab === 'civilian') {
            return [
                '<div class="filter-row">',
                    '<div class="filter-group">',
                        '<label for="civilian-show-inactive">Show Inactive:</label>',
                        '<input type="checkbox" id="civilian-show-inactive">',
                    '</div>',
                    '<button id="apply-filter-btn" class="small primary">Apply</button>',
                '</div>'
            ].join('');
        }

        return '';
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
    // EXPOSE
    // ============================================================

    window.TeamRender = {
        // List rendering
        renderList: renderList,
        renderExpandedMembers: renderExpandedMembers,
        renderTeamCard: renderTeamCard,
        renderTeamSummary: renderTeamSummary,

        // Container
        renderContainer: renderContainer,
        buildFilterHTML: buildFilterHTML,
        getModalsHTML: getModalsHTML,

        // Helpers
        getMemberStatusInfo: getMemberStatusInfo,
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute
    };

})();