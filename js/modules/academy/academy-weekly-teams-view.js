/**
 * modules/academy/academy-weekly-teams-view.js - Academy Weekly Teams View
 * Standalone view for browsing academic teams within a class and week.
 *
 * Path: js/modules/academy/academy-weekly-teams-view.js
 *
 * This module is responsible for:
 *   - Rendering the class + week selectors
 *   - Rendering the team list (left panel)
 *   - Rendering the team detail (right panel) with members
 *   - Rendering an empty state when no class or team is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Does NOT call TeamQueries or AcademyQueries.
 *   - Receives a view model from AcademyAggregator.getWeeklyTeamsViewModel.
 *   - Does NOT bind events. Rows emit data-* attributes that
 *     AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * VIEW MODEL SOURCE:
 *   The view model is produced by
 *   AcademyAggregator.getWeeklyTeamsViewModel(classId, week, selectedTeamId).
 *
 *   Weekly Teams is ACADEMY-OWNED and WEEK-SCOPED. The team members
 *   shown are the assignment for the selected week (from
 *   academy.weeklyTeams), not the persistent Team entity's roster.
 *   Persistent Team metadata (name, type, status, period) is still
 *   shown because the team identity is shared across weeks.
 *
 *   The VM supplies every display-ready value the renderer needs:
 *     typeLabel       — display label for the team type
 *     statusLabel     — display label for the team status
 *     periodLabel     — 'Week' | 'Year'
 *     periodDisplay   — formatted range ('Wk 3 – Wk 14', '2025 – 2027', '-')
 *     memberCount     — number of members in the weekly assignment
 *   Member VMs supply:
 *     roleLabel       — display label for the member's role ('' for default)
 *     statusLabel     — 'Active' | 'Deceased'
 *
 *   The renderer does not derive any of these from raw enum values.
 *
 * MEMBER SEMANTICS (WEEKLY ASSIGNMENT MODEL):
 *   The members shown are the weekly assignment. Every member of the
 *   assignment is by definition active in the selected week. There is
 *   no "former member" state in this view. Persistent-entity
 *   membership (join/leave periods, historical rosters) lives in the
 *   Teams tab, not here.
 *
 * INTERFACE:
 *   AcademyWeeklyTeamsView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       classes:        [ { id, name } ],
 *       classId:        string | null,
 *       className:      string | null,
 *       week:           number | null,
 *       teams:          [ <teamRowVM> ],
 *       selectedTeamId: string | null,
 *       selectedTeam:   <teamDetailVM> | null
 *     }
 *
 *   teamRowVM:
 *     {
 *       id, name,
 *       type, typeLabel,
 *       status, statusLabel,
 *       periodLabel, periodDisplay,
 *       memberCount
 *     }
 *
 *   teamDetailVM:
 *     {
 *       id, name,
 *       type, typeLabel,
 *       status, statusLabel,
 *       periodLabel, periodDisplay,
 *       temporaryMission: string | null,
 *       memberCount: number,
 *       members: [ <memberVM> ]
 *     }
 *
 *   memberVM:
 *     {
 *       characterId,
 *       name,
 *       role,
 *       roleLabel,
 *       age,
 *       statusLabel
 *     }
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-weekly-teams-class-select  (change)
 *   - #academy-weekly-teams-week-input    (change / Enter)
 *   - .academy-weekly-team-row            [data-team-id]
 *   - .academy-weekly-team-member-row     [data-character-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyWeeklyTeamsView.renderHTML(vm);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyWeeklyTeamsView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academyWeeklyTeamsViewLoaded = true;

    // ============================================================
    // ESCAPING HELPERS
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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function getTeamTypeBadgeClass(type) {
        switch (type) {
            case 'academic':     return 'academy-team-type-badge academy-team-type-academic';
            case 'professional': return 'academy-team-type-badge academy-team-type-professional';
            case 'temporary':    return 'academy-team-type-badge academy-team-type-temporary';
            case 'civilian':     return 'academy-team-type-badge academy-team-type-civilian';
            default:             return 'academy-team-type-badge academy-team-type-unknown';
        }
    }

    function getTeamStatusBadgeClass(status) {
        switch (status) {
            case 'active':     return 'academy-team-status-badge academy-team-status-active';
            case 'inactive':   return 'academy-team-status-badge academy-team-status-inactive';
            case 'deprecated': return 'academy-team-status-badge academy-team-status-deprecated';
            default:           return 'academy-team-status-badge academy-team-status-unknown';
        }
    }

    // Member status is binary in the weekly-assignment model: a member
    // is either deceased or active for the selected week.
    function getMemberStatusBadgeClass(member) {
        if (member && member.statusLabel === 'Deceased') {
            return 'academy-weekly-member-badge academy-weekly-member-deceased';
        }
        return 'academy-weekly-member-badge academy-weekly-member-active';
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        var vm = viewModel || {};
        var classId = vm.classId || null;

        var html = '';
        html += '<div class="academy-body academy-weekly-teams-layout">';
        html += renderTopBar(vm);

        if (!classId) {
            html += '<div class="academy-weekly-teams-empty">' +
                        '<p class="empty-state small">' +
                            'Select a class to view its weekly teams.' +
                        '</p>' +
                    '</div>';
        } else {
            html += '<div class="academy-weekly-teams-panels">';
            html += renderListPanel(vm);
            html += renderDetailPanel(vm);
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // TOP BAR - Class + Week selectors
    // ============================================================

    function renderTopBar(vm) {
        var classes = Array.isArray(vm.classes) ? vm.classes : [];
        var classId = vm.classId || null;
        var week = vm.week;

        var html = '';
        html += '<div class="academy-weekly-teams-top-bar">';

        html += '<div class="academy-weekly-teams-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-weekly-teams-class-select">Class:</label>';
        html += '<select id="academy-weekly-teams-class-select" ' +
                    'class="academy-class-select">';
        html += '<option value="">Select a class...</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name || 'Unnamed Class') +
                    '</option>';
        }

        html += '</select>';
        html += '</div>';

        html += '<div class="academy-weekly-teams-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-weekly-teams-week-input">Week:</label>';
        html += '<input type="number" id="academy-weekly-teams-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' + escapeAttribute(
                        isFiniteNumber(week) ? String(week) : ''
                    ) + '" ' +
                    'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(vm) {
        var teams = Array.isArray(vm.teams) ? vm.teams : [];
        var selectedTeamId = vm.selectedTeamId || null;

        var html = '';
        html += '<div class="academy-weekly-teams-sidebar">';

        html += '<div class="academy-weekly-teams-list-header">';
        html += '<h4 class="academy-weekly-teams-list-title">Teams</h4>';
        html += '<span class="academy-weekly-teams-list-count">' +
                    teams.length +
                '</span>';
        html += '</div>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'No teams found for this class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-weekly-teams-list">';
        for (var i = 0; i < teams.length; i++) {
            html += renderListRow(teams[i], selectedTeamId);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderListRow(team, selectedTeamId) {
        if (!team || !team.id) {
            return '';
        }

        var isSelected = selectedTeamId &&
            String(selectedTeamId) === String(team.id);

        var typeBadgeClass = getTeamTypeBadgeClass(team.type);
        var statusBadgeClass = getTeamStatusBadgeClass(team.status);

        var rowClass = 'academy-weekly-team-row';
        if (isSelected) {
            rowClass += ' selected';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="academy-weekly-team-row-main">';
        html += '<span class="academy-weekly-team-name">' +
                    escapeHtml(team.name || 'Unnamed Team') +
                '</span>';
        html += '<span class="' + typeBadgeClass + '">' +
                    escapeHtml(team.typeLabel) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-weekly-team-row-meta">';
        html += '<span class="academy-weekly-team-members">' +
                    team.memberCount + ' members' +
                '</span>';
        if (isNonEmptyString(team.periodDisplay)) {
            html += '<span class="academy-weekly-team-period">' +
                        escapeHtml(team.periodDisplay) +
                    '</span>';
        }
        html += '<span class="' + statusBadgeClass + '">' +
                    escapeHtml(team.statusLabel) +
                '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(vm) {
        var selected = vm.selectedTeam || null;

        var html = '';
        html += '<div class="academy-weekly-teams-detail" ' +
                    'id="academy-weekly-teams-detail">';

        if (!selected) {
            html += '<div class="academy-detail-empty">' +
                        '<p class="empty-state small">' +
                            'Select a team to view its members.' +
                        '</p>' +
                    '</div>';
            html += '</div>';
            return html;
        }

        html += renderDetailHeader(selected, vm.week);
        html += renderDetailMembers(selected);

        html += '</div>';
        return html;
    }

    function renderDetailHeader(team, week) {
        var typeBadgeClass = getTeamTypeBadgeClass(team.type);
        var statusBadgeClass = getTeamStatusBadgeClass(team.status);

        var html = '';
        html += '<div class="academy-weekly-team-detail-header">';

        html += '<div class="academy-weekly-team-detail-title-row">';
        html += '<h3 class="academy-weekly-team-detail-title">' +
                    escapeHtml(team.name || 'Unnamed Team') +
                '</h3>';
        html += '<span class="' + typeBadgeClass + '">' +
                    escapeHtml(team.typeLabel) +
                '</span>';
        html += '<span class="' + statusBadgeClass + '">' +
                    escapeHtml(team.statusLabel) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-weekly-team-detail-meta">';

        if (isFiniteNumber(week)) {
            html += '<span class="academy-weekly-team-detail-meta-item">' +
                        '<span class="meta-label">Week:</span> ' +
                        escapeHtml(String(week)) +
                    '</span>';
        }

        if (isNonEmptyString(team.periodLabel)) {
            html += '<span class="academy-weekly-team-detail-meta-item">' +
                        '<span class="meta-label">Period:</span> ' +
                        escapeHtml(team.periodLabel) +
                    '</span>';
        }

        if (isNonEmptyString(team.periodDisplay)) {
            html += '<span class="academy-weekly-team-detail-meta-item">' +
                        '<span class="meta-label">Range:</span> ' +
                        escapeHtml(team.periodDisplay) +
                    '</span>';
        }

        html += '<span class="academy-weekly-team-detail-meta-item">' +
                    '<span class="meta-label">Members:</span> ' +
                    team.memberCount +
                '</span>';

        if (isNonEmptyString(team.temporaryMission)) {
            html += '<span class="academy-weekly-team-detail-meta-item">' +
                        '<span class="meta-label">Mission:</span> ' +
                        escapeHtml(team.temporaryMission) +
                    '</span>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderDetailMembers(team) {
        var members = Array.isArray(team.members) ? team.members : [];

        var html = '';
        html += '<div class="academy-weekly-team-members-section">';
        html += '<div class="academy-weekly-team-members-header">';
        html += '<h4 class="academy-weekly-team-members-title">Members</h4>';
        html += '<span class="academy-weekly-team-members-count">' +
                    members.length +
                '</span>';
        html += '</div>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members assigned to this team this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-weekly-team-members-list">';
        for (var i = 0; i < members.length; i++) {
            html += renderMemberRow(members[i]);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderMemberRow(member) {
        if (!member || !member.characterId) {
            return '';
        }

        var statusClass = getMemberStatusBadgeClass(member);

        var rowClass = 'academy-weekly-team-member-row';
        if (member.statusLabel === 'Deceased') {
            rowClass += ' deceased';
        }

        // Secondary line: role, then age. The VM's roleLabel is
        // already display-ready; empty means the default role, which
        // is not shown.
        var secondaryParts = [];
        if (isNonEmptyString(member.roleLabel)) {
            secondaryParts.push(escapeHtml(member.roleLabel));
        }
        if (isNonEmptyString(member.age) && member.age !== '-') {
            secondaryParts.push(escapeHtml(member.age));
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId) + '">';

        html += '<div class="academy-weekly-team-member-main">';
        html += '<span class="academy-weekly-team-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        html += '<span class="' + statusClass + '">' +
                    escapeHtml(member.statusLabel) +
                '</span>';
        html += '</div>';

        if (secondaryParts.length > 0) {
            html += '<div class="academy-weekly-team-member-secondary">' +
                        secondaryParts.join(' &middot; ') +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsView = {
        renderHTML: renderHTML
    };

})();
