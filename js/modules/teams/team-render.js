/**
 * modules/teams/team-render.js - Team Rendering
 * Pure rendering for team lists and team data.
 *
 * Path: js/modules/teams/team-render.js
 *
 * This module provides:
 *   - renderList(vm)              - team list rows
 *   - renderExpandedMembers(vm)   - expanded member section
 *   - renderTeamCard(vm)          - compact team card
 *   - renderTeamSummary(vm)       - single-line summary
 *   - renderContainer(vm)         - full page shell
 *   - renderFilterBar(filterVM)   - filter bar
 *   - renderMemberList(membersVM) - member rows
 *   - renderRankingList(rankVM)   - ranking rows
 *   - renderTeamForm(formVM)      - team form markup
 *   - renderMemberForm(formVM)    - member form markup
 *   - renderRankingForm(formVM)   - ranking form markup
 *   - getModalsHTML()             - static modal shells
 *
 * IMPORTANT:
 *   - RENDER ONLY. No queries, no state, no mutations, no domain
 *     calculations.
 *   - Every input is a view model already produced by TeamAggregator.
 *   - Uses DomUtils for escaping. No other dependency.
 *   - Every display string (type label, period display, rank display,
 *     member status label) is supplied by the VM. The renderer does
 *     not derive display strings from domain data.
 *   - Every period on the incoming VM is already validated. The
 *     renderer does not validate or default periods.
 *
 * FILTER BAR:
 *   The filter bar is rendered here from a filter VM supplied by
 *   TeamAggregator.getFilterBarViewModel(tab). The renderer does not
 *   read TeamUI and does not call TeamEvents. This is the direction
 *   the dependency graph expects:
 *
 *     TeamUI -> TeamAggregator -> TeamRender
 *
 *   not:
 *
 *     TeamRender -> TeamEvents -> TeamUI
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = TeamRender.renderList(listVM);
 *   container.innerHTML = TeamRender.renderContainer(pageVM);
 */

(function() {
    'use strict';

    if (window.__teamRenderLoaded) {
        return;
    }
    window.__teamRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORT
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

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
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    // ============================================================
    // SHARED FRAGMENTS
    // ============================================================

    /**
     * Render the action buttons shared by the list row and the card.
     *
     * @param {string} teamId
     * @param {boolean} isExpanded
     * @returns {string}
     */
    function renderTeamActions(teamId, isExpanded) {
        var idAttr = escapeAttribute(teamId);
        var caret = isExpanded ? '\u25be' : '\u25b8';
        var ariaLabel = isExpanded ? 'Collapse team members' : 'Expand team members';
        var ariaExpanded = isExpanded ? 'true' : 'false';

        var html = '';
        html += '<button class="small toggle-members" ' +
                    'data-id="' + idAttr + '" ' +
                    'aria-label="' + escapeAttribute(ariaLabel) + '" ' +
                    'aria-expanded="' + escapeAttribute(ariaExpanded) + '">' +
                    caret +
                '</button>';
        html += '<button class="small manage-members" data-id="' + idAttr + '">Members</button>';
        html += '<button class="small manage-rankings" data-id="' + idAttr + '">Rankings</button>';
        html += '<button class="small edit-team" data-id="' + idAttr + '">Edit</button>';
        html += '<button class="small danger delete-team" data-id="' + idAttr + '">Delete</button>';
        return html;
    }

    // ============================================================
    // TEAM LIST
    // ============================================================

    /**
     * Render a list of team list VMs.
     *
     * @param {object} listVM - { teams: [], total, filtered }
     * @param {string} type
     * @param {string} expandedTeamId
     * @param {object} expandedMembersVM - Members VM for the expanded
     *                                     team, or null.
     * @returns {string}
     */
    function renderList(listVM, type, expandedTeamId, expandedMembersVM) {
        if (!listVM || !Array.isArray(listVM.teams)) {
            return '<p class="empty-state" style="padding:20px;">No teams found.</p>';
        }

        var teams = listVM.teams;

        if (teams.length === 0) {
            var labels = {
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams',
                'academic': 'academic teams'
            };
            var label = labels[type] || 'teams';
            return '<p class="empty-state" style="padding:20px;">No ' + escapeHtml(label) + ' found.</p>';
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
            if (!team || !team.id) {
                continue;
            }

            var isExpanded = expandedTeamId &&
                String(expandedTeamId) === String(team.id);

            var rowClass = 'list-item team-item';
            if (!team.isActive) {
                rowClass += ' inactive';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-id="' + escapeAttribute(team.id) + '">';

            // Team name + class + type + inactive marker
            html += '<span>';
            html += '<strong>' + escapeHtml(team.name || 'Unnamed Team') + '</strong>';
            if (isNonEmptyString(team.classDisplay)) {
                html += ' <span class="team-class">[' +
                            escapeHtml(team.classDisplay) +
                        ']</span>';
            }
            html += ' <span class="team-type-label">' +
                        escapeHtml(team.typeLabel || team.type || '') +
                    '</span>';
            if (!team.isActive) {
                html += ' <span class="team-status-inactive">(Inactive)</span>';
            }
            html += '</span>';

            html += '<span class="team-period">' +
                        escapeHtml(team.periodDisplay || '-') +
                    '</span>';

            html += '<span class="team-rank">' +
                        escapeHtml(team.currentRank || '-') +
                    '</span>';

            html += '<span class="team-member-count">' +
                        safeString(team.activeMemberCount) +
                    '</span>';

            html += '<span class="actions">' +
                        renderTeamActions(team.id, isExpanded) +
                    '</span>';

            html += '</div>';

            if (isExpanded && expandedMembersVM) {
                html += renderExpandedMembers(expandedMembersVM);
            }
        }

        return html;
    }

    // ============================================================
    // EXPANDED MEMBERS
    // ============================================================

    /**
     * Render the expanded members section.
     *
     * The VM comes from TeamAggregator.getTeamMembersViewModel. It
     * already carries displayName, status, age, role, and
     * activeAtPeriod on every member. The renderer just prints.
     *
     * @param {object} membersVM
     * @returns {string}
     */
    function renderExpandedMembers(membersVM) {
        if (!membersVM) {
            return '';
        }

        var periodLabel = membersVM.periodLabel || 'Period';
        var period = membersVM.period;
        var activeMembers = (membersVM.members || []).filter(function(m) {
            return m.activeAtPeriod;
        });

        var html = '<div class="team-members-expanded" ' +
                        'data-team-id="' + escapeAttribute(membersVM.teamId) + '">';

        if (activeMembers.length === 0) {
            html += '<div class="member-entry empty">No active members this ' +
                        escapeHtml(periodLabel.toLowerCase()) +
                    '</div>';
            html += '</div>';
            return html;
        }

        var labelText = 'Active Members in ' + periodLabel + ' ' + safeString(period) + ':';
        html += '<div class="members-expanded-header">' +
                    escapeHtml(labelText) +
                '</div>';

        for (var i = 0; i < activeMembers.length; i++) {
            var member = activeMembers[i];
            var statusInfo = member.statusInfo || {};

            var memberClass = 'member-entry';
            if (isNonEmptyString(statusInfo.className)) {
                memberClass += ' ' + statusInfo.className;
            }

            html += '<div class="' + escapeAttribute(memberClass) + '">';
            html += '<span>' +
                        escapeHtml(member.displayName || 'Unknown') +
                        ' <span class="role">(' +
                            escapeHtml(member.role || 'Member') +
                        ')</span>' +
                    '</span>';

            html += '<span class="member-details">';
            html += 'Age: ' + escapeHtml(member.age || '-');
            html += ' | Joined: ' + escapeHtml(member.joinPeriod || '?');
            if (member.leavePeriod) {
                html += ' \u2192 ' + escapeHtml(member.leavePeriod);
            }
            html += ' | <span class="member-status">' +
                        escapeHtml(statusInfo.label || 'Unknown') +
                    '</span>';
            html += '</span>';

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAM CARD
    // ============================================================

    /**
     * Render a team card from a list VM entry.
     *
     * @param {object} team
     * @returns {string}
     */
    function renderTeamCard(team) {
        if (!team || !team.id) {
            return '';
        }

        var cardClass = 'team-card';
        if (!team.isActive) {
            cardClass += ' inactive';
        }

        var html = '<div class="' + cardClass + '" ' +
                        'data-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="team-card-header">';
        html += '<strong>' + escapeHtml(team.name || 'Unnamed Team') + '</strong>';
        if (isNonEmptyString(team.classDisplay)) {
            html += ' <span class="team-class">[' +
                        escapeHtml(team.classDisplay) +
                    ']</span>';
        }
        html += ' <span class="team-type-label">' +
                    escapeHtml(team.typeLabel || team.type || '') +
                '</span>';
        if (!team.isActive) {
            html += ' <span class="team-status-inactive">(Inactive)</span>';
        }
        html += '</div>';

        html += '<div class="team-card-details">';
        html += '<span class="team-period">' +
                    escapeHtml(team.periodDisplay || '-') +
                '</span>';
        html += '<span class="team-rank">Rank: ' +
                    escapeHtml(team.currentRank || '-') +
                '</span>';
        html += '<span class="team-member-count">Members: ' +
                    safeString(team.activeMemberCount) +
                '</span>';
        html += '</div>';

        html += '<div class="team-card-actions">';
        html += renderTeamActions(team.id, false);
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAM SUMMARY
    // ============================================================

    /**
     * Render a single-line team summary from a list VM entry.
     *
     * @param {object} team
     * @returns {string}
     */
    function renderTeamSummary(team) {
        if (!team || !team.id) {
            return '';
        }

        var html = '<div class="team-summary">';
        html += '<span class="team-name">' + escapeHtml(team.name || 'Unnamed Team') + '</span>';
        html += '<span class="team-type">' + escapeHtml(team.typeLabel || team.type || '') + '</span>';
        html += '<span class="team-rank">#' + escapeHtml(team.currentRank || '-') + '</span>';
        html += '<span class="team-members">' +
                    safeString(team.activeMemberCount) +
                    ' active members' +
                '</span>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // FILTER BAR
    // ============================================================

    /**
     * Render the filter bar from a filter VM.
     *
     * @param {object} filterVM - { tab, typeLabel, periodLabel,
     *                             filterYear, filterStatus }
     * @returns {string}
     */
    function renderFilterBar(filterVM) {
        if (!filterVM || !filterVM.tab) {
            return '';
        }

        var tab = filterVM.tab;
        var periodLabel = filterVM.periodLabel || 'Year';
        var yearValue = filterVM.filterYear !== undefined && filterVM.filterYear !== null
            ? filterVM.filterYear
            : '';
        var status = filterVM.filterStatus || 'active';

        if (tab === 'civilian') {
            return [
                '<div class="filter-row">',
                    '<div class="filter-group">',
                        '<label for="civilian-show-inactive">Show Inactive:</label>',
                        '<input type="checkbox" id="civilian-show-inactive"' +
                            (status === 'inactive' ? ' checked' : '') + '>',
                    '</div>',
                    '<button id="apply-filter-btn" class="small primary" type="button">Apply</button>',
                '</div>'
            ].join('');
        }

        // Professional and temporary: year + show-inactive checkbox.
        return [
            '<div class="filter-row">',
                '<div class="filter-group">',
                    '<label for="team-filter-year">' +
                        escapeHtml(periodLabel) +
                    ':</label>',
                    '<input type="number" id="team-filter-year" ' +
                        'value="' + escapeAttribute(safeString(yearValue)) + '" ' +
                        'placeholder="All">',
                '</div>',
                '<div class="filter-group">',
                    '<label for="' + escapeAttribute(tab) + '-show-inactive">' +
                        'Show Inactive:' +
                    '</label>',
                    '<input type="checkbox" id="' + escapeAttribute(tab) + '-show-inactive"' +
                        (status === 'inactive' ? ' checked' : '') + '>',
                '</div>',
                '<button id="apply-filter-btn" class="small primary" type="button">Apply</button>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // MEMBER LIST
    // ============================================================

    /**
     * Render the member list inside the member modal.
     *
     * @param {object} membersVM - { teamId, teamName, period, members }
     * @returns {string}
     */
    function renderMemberList(membersVM) {
        if (!membersVM || !Array.isArray(membersVM.members)) {
            return '<p class="empty-state">No members in this team</p>';
        }

        var members = membersVM.members;
        if (members.length === 0) {
            return '<p class="empty-state">No members in this team</p>';
        }

        var html = '';
        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (!member || !member.characterId) { continue; }

            var rowClass = 'member-entry';
            if (!member.activeAtPeriod) {
                rowClass += ' member-entry-inactive';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-character-id="' + escapeAttribute(member.characterId) + '" ' +
                        'style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';

            html += '<span>';
            html += '<strong>' + escapeHtml(member.displayName || 'Unknown') + '</strong>';
            html += ' <span style="color:var(--text-dim);font-size:0.65rem;">(' +
                        escapeHtml(member.role || 'Member') +
                    ')</span>';
            html += ' <span style="color:var(--text-dim);font-size:0.6rem;">' +
                        escapeHtml(member.joinPeriod || '?') +
                        (member.leavePeriod
                            ? ' \u2192 ' + escapeHtml(member.leavePeriod)
                            : '') +
                    '</span>';
            html += '</span>';

            html += '<span>';
            html += '<button type="button" class="small edit-member" ' +
                        'data-character-id="' + escapeAttribute(member.characterId) + '" ' +
                        'style="font-size:0.6rem;padding:2px 6px;">Edit</button>';
            html += '<button type="button" class="small danger remove-member" ' +
                        'data-character-id="' + escapeAttribute(member.characterId) + '" ' +
                        'style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
            html += '</span>';

            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RANKING LIST
    // ============================================================

    /**
     * Render the ranking history list inside the ranking modal.
     *
     * @param {object} rankVM - { teamId, teamName, currentRank, history }
     * @returns {string}
     */
    function renderRankingList(rankVM) {
        if (!rankVM || !Array.isArray(rankVM.history) || rankVM.history.length === 0) {
            return '<p class="empty-state">No ranking history</p>';
        }

        var history = rankVM.history;
        var html = '';

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) { continue; }

            html += '<div class="ranking-entry" ' +
                        'style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span>Period: <strong>' + escapeHtml(entry.period) +
                        '</strong> \u2192 Rank: <strong>#' +
                        escapeHtml(String(entry.rank)) +
                    '</strong></span>';
            html += '<button type="button" class="small danger remove-ranking" ' +
                        'data-period="' + escapeAttribute(entry.period) + '" ' +
                        'style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // TEAM FORM
    // ============================================================

    /**
     * Render the team form. Used by TeamEvents when the team form
     * modal is opened.
     *
     * @param {object} formVM - from TeamAggregator.getTeamFormViewModel
     * @returns {string}
     */
    function renderTeamForm(formVM) {
        if (!formVM) {
            return '';
        }

        var isEdit = formVM.isEdit === true;

        var classOptions = '';
        for (var i = 0; i < formVM.classOptions.length; i++) {
            var opt = formVM.classOptions[i];
            var selected = String(formVM.classId) === String(opt.id) ? ' selected' : '';
            classOptions += '<option value="' + escapeAttribute(opt.id) + '"' +
                                selected + '>' +
                                escapeHtml(opt.name) +
                            '</option>';
        }

        var missionOptions = '';
        for (var j = 0; j < formVM.missionOptions.length; j++) {
            var mOpt = formVM.missionOptions[j];
            var mSelected = String(formVM.temporaryMission) === String(mOpt.id) ? ' selected' : '';
            var mSuffix = mOpt.status === 'completed' ? ' (completed)' : '';
            missionOptions += '<option value="' + escapeAttribute(mOpt.id) + '"' +
                                  mSelected + '>' +
                                  escapeHtml(mOpt.title + mSuffix) +
                              '</option>';
        }

        var statusOptions = ['active', 'inactive', 'deprecated'];
        var statusHtml = '';
        for (var k = 0; k < statusOptions.length; k++) {
            var s = statusOptions[k];
            var sSelected = formVM.status === s ? ' selected' : '';
            statusHtml += '<option value="' + escapeAttribute(s) + '"' + sSelected + '>' +
                              escapeHtml(s.charAt(0).toUpperCase() + s.slice(1)) +
                          '</option>';
        }

        var html = '';

        html += '<form id="team-form-inner" data-edit-id="' +
                    (isEdit ? escapeAttribute(formVM.teamId) : '') + '">';

        html += '<div class="form-grid">';

        // Name
        html += '<div class="form-group full-width">';
        html += '<label for="team-name">Team Name *</label>';
        html += '<input type="text" id="team-name" value="' +
                    escapeAttribute(formVM.name) + '" required>';
        html += '</div>';

        // Type
        html += '<div class="form-group">';
        html += '<label for="team-type">Team Type *</label>';
        html += '<select id="team-type" required>';
        var typeOptions = ['professional', 'temporary', 'civilian'];
        for (var t = 0; t < typeOptions.length; t++) {
            var type = typeOptions[t];
            var tSelected = formVM.type === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + tSelected + '>' +
                        escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Start period
        html += '<div class="form-group">';
        html += '<label for="team-start">Start Period</label>';
        html += '<input type="text" id="team-start" value="' +
                    escapeAttribute(formVM.startPeriod) + '" placeholder="Year">';
        html += '</div>';

        // End period
        html += '<div class="form-group">';
        html += '<label for="team-end">End Period (optional)</label>';
        html += '<input type="text" id="team-end" value="' +
                    escapeAttribute(formVM.endPeriod) + '" placeholder="Year">';
        html += '</div>';

        // Class
        html += '<div class="form-group">';
        html += '<label for="team-class">Class</label>';
        html += '<select id="team-class">';
        html += '<option value="">Unassigned</option>';
        html += classOptions;
        html += '</select>';
        html += '</div>';

        // Team number
        html += '<div class="form-group">';
        html += '<label for="team-number">Team Number</label>';
        html += '<input type="text" id="team-number" value="' +
                    escapeAttribute(formVM.teamNumber) + '">';
        html += '</div>';

        // Current ranking (read-only)
        html += '<div class="form-group">';
        html += '<label>Current Ranking</label>';
        html += '<input type="text" value="' +
                    escapeAttribute(formVM.currentRank || '-') +
                '" readonly disabled>';
        html += '<span class="field-hint">' +
                    '(Read-only; use Rankings to modify)' +
                '</span>';
        html += '</div>';

        // Status
        html += '<div class="form-group">';
        html += '<label for="team-status">Status</label>';
        html += '<select id="team-status">' + statusHtml + '</select>';
        html += '</div>';

        // Mission
        html += '<div class="form-group full-width" id="temporary-mission-field">';
        html += '<label for="team-mission">Associated Mission</label>';
        html += '<select id="team-mission">';
        html += '<option value="">None</option>';
        html += missionOptions;
        html += '</select>';
        html += '</div>';

        // Name history
        html += '<div class="form-group full-width">';
        html += '<label>Name History</label>';
        html += '<div id="name-history-container">';
        if (formVM.nameHistory && formVM.nameHistory.length > 0) {
            for (var h = 0; h < formVM.nameHistory.length; h++) {
                html += renderNameHistoryRow(formVM.nameHistory[h]);
            }
        } else {
            html += renderNameHistoryRow(null);
        }
        html += '</div>';
        html += '<button type="button" id="add-name-history-btn" class="small" ' +
                    'style="margin-top:8px;">+ Add Name Period</button>';
        html += '</div>';

        html += '</div>'; // form-grid

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-team-form" class="secondary">Cancel</button>';
        html += '<button type="submit" id="save-team-btn" class="primary">' +
                    (isEdit ? 'Save Team' : 'Create Team') +
                '</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    /**
     * Render one name-history row. Called from renderTeamForm and
     * from TeamEvents when the "+ Add Name Period" button is clicked.
     *
     * @param {object|null} entry - { name, startPeriod, endPeriod }
     * @returns {string}
     */
    function renderNameHistoryRow(entry) {
        var e = entry || {};
        var html = '';
        html += '<div class="name-history-entry" ' +
                    'style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">';
        html += '<input type="text" class="name-history-name" placeholder="Team Name" ' +
                    'value="' + escapeAttribute(e.name || '') + '" ' +
                    'style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<input type="text" class="name-history-start" placeholder="Start" ' +
                    'value="' + escapeAttribute(e.startPeriod || '') + '" ' +
                    'style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<input type="text" class="name-history-end" placeholder="End" ' +
                    'value="' + escapeAttribute(e.endPeriod || '') + '" ' +
                    'style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<button type="button" class="small danger remove-name" ' +
                    'style="padding:2px 6px;font-size:0.6rem;">x</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // MEMBER FORM (edit)
    // ============================================================

    /**
     * Render the edit-member form. Used by TeamEvents when the edit
     * member modal is opened.
     *
     * @param {object} formVM - { characterId, characterName, role,
     *                            joinPeriod, leavePeriod }
     * @returns {string}
     */
    function renderMemberForm(formVM) {
        if (!formVM || !formVM.characterId) {
            return '';
        }

        var html = '';
        html += '<form id="edit-member-form" ' +
                    'data-character-id="' + escapeAttribute(formVM.characterId) + '">';

        html += '<div class="form-group">';
        html += '<label>Character</label>';
        html += '<p style="margin:4px 0 12px 0;font-weight:600;">' +
                    escapeHtml(formVM.characterName || 'Unknown') +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="edit-member-role">Role</label>';
        html += '<input type="text" id="edit-member-role" value="' +
                    escapeAttribute(formVM.role || '') + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="edit-member-join">Join Period</label>';
        html += '<input type="text" id="edit-member-join" value="' +
                    escapeAttribute(formVM.joinPeriod || '') + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="edit-member-leave">Leave Period</label>';
        html += '<input type="text" id="edit-member-leave" value="' +
                    escapeAttribute(formVM.leavePeriod || '') + '">';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-edit-member" class="secondary">Cancel</button>';
        html += '<button type="submit" id="save-edit-member" class="primary">Save Changes</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    // ============================================================
    // RANKING FORM
    // ============================================================

    /**
     * Render the add-ranking form. Used by TeamEvents when the
     * ranking modal is opened.
     *
     * @returns {string}
     */
    function renderRankingForm() {
        var html = '';
        html += '<form id="ranking-form-inner">';
        html += '<div class="ranking-form" ' +
                    'style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">';
        html += '<input type="text" id="ranking-period" placeholder="Period" ' +
                    'style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">';
        html += '<input type="number" id="ranking-rank" placeholder="Rank" min="1" ' +
                    'style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">';
        html += '<button type="button" id="add-ranking-btn" class="primary small">Add Ranking</button>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CONTAINER
    // ============================================================

    /**
     * Render the full page shell.
     *
     * The caller supplies a page VM from
     * TeamAggregator.getTeamPageViewModel, plus the filter bar VM
     * from TeamAggregator.getFilterBarViewModel. The renderer does
     * not query anything.
     *
     * @param {object} pageVM
     * @returns {string}
     */
    function renderContainer(pageVM) {
        if (!pageVM) {
            throw new Error('[TeamRender] renderContainer requires a page view model.');
        }

        var activeTab = pageVM.activeTab || 'professional';
        var counts = pageVM.counts || {
            professional: 0,
            temporary: 0,
            civilian: 0
        };
        var teams = pageVM.teams || [];
        var expandedTeamId = pageVM.expandedTeamId || null;
        var expandedTeam = pageVM.expandedTeam || null;
        var period = pageVM.period;

        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary" type="button">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' +
                    safeString(counts.professional) +
                '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' +
                    safeString(counts.temporary) +
                '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' +
                    safeString(counts.civilian) +
                '</p></div>';
        html += '</div>';

        // Tabs
        html += '<div class="tab-nav" id="team-tab-nav">';
        html += '<button class="tab-btn' + (activeTab === 'professional' ? ' active' : '') + '" ' +
                    'type="button" data-tab="professional">Professional (' +
                    safeString(counts.professional) +
                ')</button>';
        html += '<button class="tab-btn' + (activeTab === 'temporary' ? ' active' : '') + '" ' +
                    'type="button" data-tab="temporary">Temporary (' +
                    safeString(counts.temporary) +
                ')</button>';
        html += '<button class="tab-btn' + (activeTab === 'civilian' ? ' active' : '') + '" ' +
                    'type="button" data-tab="civilian">Civilian (' +
                    safeString(counts.civilian) +
                ')</button>';
        html += '</div>';

        // Filter bar container (populated by TeamEvents after render)
        html += '<div id="filter-container" class="filter-container"></div>';

        // Team list
        html += '<div id="team-list-container" class="team-list-container">';

        var expandedMembersVM = null;
        if (expandedTeam && Array.isArray(expandedTeam.members)) {
            // The expandedTeam VM already contains members. We pass
            // them through renderList via a lightweight wrapper.
            expandedMembersVM = {
                teamId: expandedTeam.id,
                periodLabel: expandedTeam.periodLabel || 'Period',
                period: period,
                members: expandedTeam.members
            };
        }

        html += renderList(
            { teams: teams, total: teams.length, filtered: teams.length },
            activeTab,
            expandedTeamId,
            expandedMembersVM
        );

        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // MODALS (static shells)
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
                    '<div class="modal-body" id="team-form-body"></div>',
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
                            '<button id="add-member-btn" class="primary small" type="button">Add Member</button>',
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
                    '<div class="modal-body" id="edit-member-body"></div>',
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
                        '<div id="ranking-form-container"></div>',
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
        // Container
        renderContainer: renderContainer,

        // Lists / detail
        renderList: renderList,
        renderExpandedMembers: renderExpandedMembers,
        renderTeamCard: renderTeamCard,
        renderTeamSummary: renderTeamSummary,

        // Filter bar
        renderFilterBar: renderFilterBar,

        // Modal contents
        renderMemberList: renderMemberList,
        renderRankingList: renderRankingList,
        renderTeamForm: renderTeamForm,
        renderMemberForm: renderMemberForm,
        renderRankingForm: renderRankingForm,
        renderNameHistoryRow: renderNameHistoryRow,

        // Static modal shells
        getModalsHTML: getModalsHTML,

        // Helpers
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamRender;
        var missing = [];

        var required = [
            'renderContainer',
            'renderList', 'renderExpandedMembers', 'renderTeamCard', 'renderTeamSummary',
            'renderFilterBar',
            'renderMemberList', 'renderRankingList',
            'renderTeamForm', 'renderMemberForm', 'renderRankingForm',
            'renderNameHistoryRow',
            'getModalsHTML',
            'escapeHtml', 'escapeAttribute'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamRender] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
