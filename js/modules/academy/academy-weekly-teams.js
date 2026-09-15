/**
 * modules/academy/academy-weekly-teams-view.js - Academy Weekly Teams View
 * Standalone view for browsing academic teams within a class and week
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
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Does NOT call TeamQueries or AcademyQueries.
 *   - Receives a view model from AcademyAggregator.
 *   - Does NOT bind events. Rows emit data-* attributes that
 *     AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping (mandatory; no fallbacks).
 *   - Returns an HTML string.
 *
 * VIEW MODEL SOURCE:
 *   The view model is produced by
 *   AcademyAggregator.getWeeklyTeamsViewViewModel(classId, week, selectedTeamId).
 *
 *   The Weekly Teams view is ACADEMY-OWNED and WEEK-SCOPED. The team
 *   members shown are the assignment for the selected week (from
 *   academy.weeklyTeams), not the persistent Team entity's roster.
 *   Persistent Team metadata (name, type, status) is still shown
 *   because the team identity is shared across weeks.
 *
 *   Member status fields (activeAtPeriod, deceased, etc.) are NOT
 *   part of the weekly assignment model. Every member shown in a
 *   week's assignment is by definition active in that week. The
 *   member rows therefore render name and role only.
 *
 * INTERFACE:
 *   AcademyWeeklyTeamsView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       classes:        [ { id, name } ],
 *       classId:        string | null,
 *       className:      string | null,
 *       week:           number,
 *       teams:          [ { id, name, type, typeLabel, periodLabel,
 *                           periodDisplay, memberCount,
 *                           activeMemberCount, status } ],
 *       selectedTeamId: string | null,
 *       selectedTeam:   { ...same shape..., members: [ { characterId,
 *                           name, status, age, deceased, role,
 *                           activeAtPeriod } ] } | null
 *     }
 *
 *   If classId is null, an empty state renders.
 *   If teams is empty, the list renders a "no teams" message.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-weekly-teams-class-select (change)
 *   - #academy-weekly-teams-week-input   (change)
 *   - .academy-weekly-team-row [data-team-id]
 *   - .academy-weekly-team-member-row [data-character-id]
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
    window.__academyWeeklyTeamsViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
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
            console.warn('[AcademyWeeklyTeamsView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

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
            case 'active':    return 'academy-team-status-badge academy-team-status-active';
            case 'inactive':  return 'academy-team-status-badge academy-team-status-inactive';
            case 'deprecated':return 'academy-team-status-badge academy-team-status-deprecated';
            default:          return 'academy-team-status-badge academy-team-status-unknown';
        }
    }

    function getMemberStatusBadgeClass(member) {
        if (!member) {
            return 'academy-weekly-member-badge academy-weekly-member-unknown';
        }
        if (member.deceased) {
            return 'academy-weekly-member-badge academy-weekly-member-deceased';
        }
        if (member.activeAtPeriod === false) {
            return 'academy-weekly-member-badge academy-weekly-member-former';
        }
        return 'academy-weekly-member-badge academy-weekly-member-active';
    }

    function getMemberStatusLabel(member) {
        if (!member) {
            return 'Unknown';
        }
        if (member.deceased) {
            return 'Deceased';
        }
        if (member.activeAtPeriod === false) {
            return 'Former';
        }
        return 'Active';
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Weekly Teams view dependencies not loaded.</p>' +
                '</div>'
            );
        }

        var vm = viewModel || {};
        var classId = vm.classId || null;

        var html = '';
        html += '<div class="academy-body academy-weekly-teams-layout">';
        html += renderTopBar(vm);

        if (!classId) {
            html += '<div class="academy-weekly-teams-empty">' +
                        '<p class="empty-state small">Select a class to view its weekly teams.</p>' +
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
        html += '<label class="academy-top-label">Class:</label>';
        html += '<select id="academy-weekly-teams-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var selected = classId && String(classId) === String(cls.id) ? ' selected' : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' + selected + '>' +
                escapeHtml(cls.name || 'Unnamed Class') +
                '</option>';
        }

        html += '</select>';
        html += '</div>';

        html += '<div class="academy-weekly-teams-top-right">';
        html += '<label class="academy-top-label">Week:</label>';
        html += '<input type="number" id="academy-weekly-teams-week-input" ' +
            'class="academy-week-input" ' +
            'value="' + escapeAttribute(String(week || 1)) + '" ' +
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
        html += '<span class="academy-weekly-teams-list-count">' + teams.length + '</span>';
        html += '</div>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">No teams found for this class.</p>';
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

        var isSelected = selectedTeamId && String(selectedTeamId) === String(team.id);
        var typeBadgeClass = getTeamTypeBadgeClass(team.type);
        var statusBadgeClass = getTeamStatusBadgeClass(team.status);

        var rowClass = 'academy-weekly-team-row';
        if (isSelected) {
            rowClass += ' selected';
        }

        var memberCount = isFiniteNumber(team.activeMemberCount)
            ? team.activeMemberCount
            : (isFiniteNumber(team.memberCount) ? team.memberCount : 0);

        var html = '';
        html += '<div class="' + rowClass + '" data-team-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="academy-weekly-team-row-main">';
        html += '<span class="academy-weekly-team-name">' + escapeHtml(team.name || 'Unnamed Team') + '</span>';
        html += '<span class="' + typeBadgeClass + '">' +
                    escapeHtml(team.typeLabel || team.type || 'Team') +
                '</span>';
        html += '</div>';

        html += '<div class="academy-weekly-team-row-meta">';
        html += '<span class="academy-weekly-team-members">' + memberCount + ' members</span>';
        if (isNonEmptyString(team.periodDisplay)) {
            html += '<span class="academy-weekly-team-period">' + escapeHtml(team.periodDisplay) + '</span>';
        }
        html += '<span class="' + statusBadgeClass + '">' +
                    escapeHtml((team.status || 'active').charAt(0).toUpperCase() + (team.status || 'active').slice(1)) +
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
        html += '<div class="academy-weekly-teams-detail" id="academy-weekly-teams-detail">';

        if (!selected) {
            html += '<div class="academy-detail-empty">' +
                        '<p class="empty-state small">Select a team to view its members.</p>' +
                    '</div>';
            html += '</div>';
            return html;
        }

        html += renderDetailHeader(selected, vm.week);
        html += renderDetailMembers(selected, vm.week);

        html += '</div>';
        return html;
    }

    function renderDetailHeader(team, week) {
        var typeBadgeClass = getTeamTypeBadgeClass(team.type);
        var statusBadgeClass = getTeamStatusBadgeClass(team.status);
        var activeCount = isFiniteNumber(team.activeMemberCount)
            ? team.activeMemberCount
            : (Array.isArray(team.members) ? team.members.length : 0);

        var html = '';
        html += '<div class="academy-weekly-team-detail-header">';

        html += '<div class="academy-weekly-team-detail-title-row">';
        html += '<h3 class="academy-weekly-team-detail-title">' +
                    escapeHtml(team.name || 'Unnamed Team') +
                '</h3>';
        html += '<span class="' + typeBadgeClass + '">' +
                    escapeHtml(team.typeLabel || team.type || 'Team') +
                '</span>';
        html += '<span class="' + statusBadgeClass + '">' +
                    escapeHtml((team.status || 'active').charAt(0).toUpperCase() + (team.status || 'active').slice(1)) +
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
                    escapeHtml(String(activeCount)) +
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

    function renderDetailMembers(team, week) {
        var members = Array.isArray(team.members) ? team.members : [];

        var html = '';
        html += '<div class="academy-weekly-team-members-section">';
        html += '<div class="academy-weekly-team-members-header">';
        html += '<h4 class="academy-weekly-team-members-title">Members</h4>';
        html += '<span class="academy-weekly-team-members-count">' + members.length + '</span>';
        html += '</div>';

        if (members.length === 0) {
            html += '<p class="empty-state small">No members assigned to this team this week.</p>';
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
        var statusLabel = getMemberStatusLabel(member);

        var rowClass = 'academy-weekly-team-member-row';
        if (member.deceased) {
            rowClass += ' deceased';
        }
        if (member.activeAtPeriod === false) {
            rowClass += ' former';
        }

        var secondaryParts = [];
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            secondaryParts.push(escapeHtml(member.role));
        }
        if (isNonEmptyString(member.status)) {
            secondaryParts.push(escapeHtml(member.status));
        }
        if (isNonEmptyString(member.age)) {
            secondaryParts.push('Age ' + escapeHtml(member.age));
        }

        var html = '';
        html += '<div class="' + rowClass + '" data-character-id="' + escapeAttribute(member.characterId) + '">';

        html += '<div class="academy-weekly-team-member-main">';
        html += '<span class="academy-weekly-team-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        html += '<span class="' + statusClass + '">' + escapeHtml(statusLabel) + '</span>';
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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyWeeklyTeamsView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyWeeklyTeamsView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
