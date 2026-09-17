/**
 * modules/academy/academy-weekly-teams-view.js - Academy Weekly Teams View
 * Standalone view for browsing academic teams within a class and week.
 *
 * Path: js/modules/academy/academy-weekly-teams-view.js
 *
 * RESPONSIBILITIES:
 *   - Rendering the class + week selectors
 *   - Rendering the "unassigned teams" section (orphan assignment)
 *   - Rendering the team list (left panel) with actions
 *   - Rendering the team detail (right panel) with members
 *   - Rendering an empty state when no class or team is selected
 *   - Building the Create / Edit Team and Auto-Distribute modals
 *   - Collecting raw form values from those modals
 *
 * NOT RESPONSIBILITIES:
 *   - Event binding. AcademyView binds; this module emits data-*.
 *   - Domain reads. The VM carries everything the renderer needs.
 *   - Validation. Collectors return raw field values; the domain
 *     validates.
 *
 * VM CONTRACT (from AcademyAggregator.getWeeklyTeamsViewModel):
 *   {
 *     classes:       [{ id, name }],
 *     classId:       string | null,
 *     className:     string | null,
 *     week:          number | null,
 *     teams:         [TeamVM],
 *     selectedTeamId: string | null,
 *     selectedTeam:  TeamVM | null,
 *     orphanTeams:   [OrphanVM],   // academic teams with classId: null
 *     orphanClasses: [{ id, name, selected?: bool }]  // for the picker
 *   }
 *
 *   TeamVM:
 *   {
 *     id, name, type, typeLabel, status, statusLabel,
 *     periodLabel, periodDisplay, memberCount,
 *     members: [MemberVM]         // only on selectedTeam
 *   }
 *
 *   MemberVM:
 *   {
 *     characterId, name, role, roleLabel, age,
 *     statusLabel, deceased
 *   }
 *
 *   OrphanVM:
 *   {
 *     id, name, memberCount,
 *     suggestedClassId: string | null
 *   }
 *
 *   Every field is guaranteed present. The VM never emits undefined
 *   for a listed field; it emits null (or [] for arrays) when the
 *   value is genuinely absent. The renderer does not defend against
 *   missing fields.
 *
 * EMPTY TEAMS:
 *   The list-panel "Clear Schedule" button emits
 *   data-action="weekly-teams-clear-windows". AcademyView handles it
 *   by calling AcademyWeeklyTeams.clearClassWindows, which removes
 *   every weekly-team window record for the current class. The
 *   persistent Team entities are NOT deleted.
 *
 * ORPHAN ASSIGNMENT:
 *   Each orphan row emits data-action="weekly-teams-assign-orphan-team"
 *   with data-team-id and data-class-id read from the row's dropdown.
 *   AcademyView routes it to AcademyWeeklyTeams.assignTeamToClass.
 *   The section disappears once the last orphan is assigned.
 *
 * EVENTS EMITTED:
 *   - #academy-weekly-teams-class-select     (change)
 *   - #academy-weekly-teams-week-input       (change / Enter)
 *   - .academy-weekly-team-row [data-team-id] (click)
 *   - .academy-weekly-team-member-row [data-character-id]
 *   - [data-action="weekly-teams-create-team"]      (click)
 *   - [data-action="weekly-teams-edit-team"]        (click)
 *   - [data-action="weekly-teams-auto-distribute"]  (click)
 *   - [data-action="weekly-teams-clear-windows"]    (click)
 *   - [data-action="weekly-teams-delete-team"]      (click)
 *   - [data-action="weekly-teams-manage-members"]   (click)
 *   - [data-action="weekly-teams-assign-orphan-team"] (click)
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
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

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademyWeeklyTeamsView] renderHTML requires a view model.'
            );
        }

        var vm = viewModel;
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
    // TOP BAR
    // ============================================================

    function renderTopBar(vm) {
        var classes = vm.classes;
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
            if (!cls || !cls.id) { continue; }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name) +
                    '</option>';
        }

        html += '</select>';
        html += '</div>';

        html += '<div class="academy-weekly-teams-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-weekly-teams-week-input">Week:</label>';
        html += '<input type="number" id="academy-weekly-teams-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' +
                        (isFiniteNumber(week) ? String(week) : '') +
                    '" ' +
                    'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // ORPHAN TEAMS SECTION
    // ============================================================

    function renderOrphanSection(vm) {
        var orphans = vm.orphanTeams;
        if (!orphans || orphans.length === 0) {
            return '';
        }

        var classes = vm.classes;

        var html = '';
        html += '<div class="academy-weekly-teams-orphan-section" ' +
                    'data-expanded="false">';

        html += '<button type="button" ' +
                    'class="academy-orphan-toggle" ' +
                    'data-action="weekly-teams-toggle-orphans">';
        html += '<span class="academy-orphan-toggle-icon">\u25b8</span>';
        html += '<span class="academy-orphan-toggle-text">';
        html += orphans.length + ' unassigned team' +
                (orphans.length === 1 ? '' : 's');
        html += '</span>';
        html += '<span class="academy-orphan-toggle-hint">' +
                    'Click to assign to a class' +
                '</span>';
        html += '</button>';

        html += '<div class="academy-orphan-list" style="display:none;">';

        for (var i = 0; i < orphans.length; i++) {
            html += renderOrphanRow(orphans[i], classes);
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderOrphanRow(orphan, classes) {
        if (!orphan || !orphan.id) { return ''; }

        var suggested = orphan.suggestedClassId || '';

        var html = '';
        html += '<div class="academy-orphan-row" ' +
                    'data-team-id="' + escapeAttribute(orphan.id) + '">';

        html += '<div class="academy-orphan-row-main">';
        html += '<span class="academy-orphan-name">' +
                    escapeHtml(orphan.name) +
                '</span>';
        html += '<span class="academy-orphan-members">' +
                    orphan.memberCount + ' member' +
                    (orphan.memberCount === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        html += '<div class="academy-orphan-row-controls">';

        html += '<select class="academy-orphan-class-select">';
        html += '<option value="">Select class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var selected = (String(cls.id) === String(suggested))
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name) +
                    '</option>';
        }
        html += '</select>';

        if (suggested) {
            html += '<span class="academy-orphan-suggestion">' +
                        'Suggested from member rosters' +
                    '</span>';
        } else {
            html += '<span class="academy-orphan-suggestion academy-orphan-suggestion-none">' +
                        'No clear suggestion \u2014 pick manually' +
                    '</span>';
        }

        html += '<button type="button" class="small primary" ' +
                    'data-action="weekly-teams-assign-orphan-team" ' +
                    'data-team-id="' + escapeAttribute(orphan.id) + '">' +
                    'Assign' +
                '</button>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(vm) {
        var teams = vm.teams;
        var selectedTeamId = vm.selectedTeamId;

        var html = '';
        html += '<div class="academy-weekly-teams-sidebar">';

        html += renderOrphanSection(vm);

        // ---- Actions ----
        html += '<div class="academy-weekly-teams-list-actions">';
        html += '<button type="button" ' +
                    'class="primary small academy-add-team-btn" ' +
                    'data-action="weekly-teams-create-team">' +
                    '+ Create Team' +
                '</button>';
        html += '<button type="button" ' +
                    'class="secondary small academy-auto-distribute-btn" ' +
                    'data-action="weekly-teams-auto-distribute">' +
                    'Auto-Distribute' +
                '</button>';
        html += '<button type="button" ' +
                    'class="secondary small academy-empty-teams-btn" ' +
                    'data-action="weekly-teams-clear-windows" ' +
                    'title="Remove every scheduled team from the weekly ' +
                        'view for this class. Teams themselves are kept.">' +
                    'Clear Schedule' +
                '</button>';
        html += '</div>';

        // ---- List header ----
        html += '<div class="academy-weekly-teams-list-header">';
        html += '<h4 class="academy-weekly-teams-list-title">Teams</h4>';
        html += '<span class="academy-weekly-teams-list-count">' +
                    teams.length +
                '</span>';
        html += '</div>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'No teams scheduled for this week. ' +
                        'Use <strong>+ Create Team</strong> or ' +
                        '<strong>Auto-Distribute</strong> to get started.' +
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
        if (!team || !team.id) { return ''; }

        var isSelected = selectedTeamId &&
            String(selectedTeamId) === String(team.id);

        var typeBadgeClass = getTeamTypeBadgeClass(team.type);
        var statusBadgeClass = getTeamStatusBadgeClass(team.status);

        var rowClass = 'academy-weekly-team-row';
        if (isSelected) { rowClass += ' selected'; }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="academy-weekly-team-row-main">';
        html += '<span class="academy-weekly-team-name">' +
                    escapeHtml(team.name) +
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
        var selected = vm.selectedTeam;

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
                    escapeHtml(team.name) +
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

        html += '</div>';

        html += '<div class="academy-weekly-team-detail-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="weekly-teams-edit-team" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '">' +
                    'Edit Team' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="weekly-teams-manage-members" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '">' +
                    'Manage Members' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="weekly-teams-delete-team" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '">' +
                    'Delete Team' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderDetailMembers(team) {
        var members = team.members;
        if (!Array.isArray(members)) {
            members = [];
        }

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
                        'No members assigned to this team this week. ' +
                        'Use <strong>Manage Members</strong> to add some.' +
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
        if (!member || !member.characterId) { return ''; }

        var rowClass = 'academy-weekly-team-member-row';
        if (member.deceased === true) {
            rowClass += ' deceased';
        }

        var secondaryParts = [];
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            secondaryParts.push(escapeHtml(member.role));
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
                    escapeHtml(member.name) +
                '</span>';
        if (isNonEmptyString(member.statusLabel)) {
            html += '<span class="academy-weekly-team-member-status-badge">' +
                        escapeHtml(member.statusLabel) +
                    '</span>';
        }
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
    // MODAL BUILDER - Create / Edit Team
    // ============================================================

    function buildTeamModalHTML(options) {
        options = options || {};

        var team = options.team || null;
        var isEdit = !!team;
        var t = team || {};

        var classId = options.classId || (team && team.classId) || '';
        var className = options.className || 'Class';
        var week = options.week;

        var defaultStartWeek = (week !== undefined && week !== null)
            ? String(week)
            : '';

        var nameValue = isEdit ? (t.name || '') : '';
        var numberValue = isEdit ? (t.teamNumber || '') : '';
        var startValue = isEdit
            ? (t.startPeriod !== undefined && t.startPeriod !== null
                ? String(t.startPeriod)
                : '')
            : defaultStartWeek;
        var endValue = isEdit
            ? (t.endPeriod !== undefined && t.endPeriod !== null
                ? String(t.endPeriod)
                : '')
            : '';

        var title = isEdit ? 'Edit Academic Team' : 'Create Academic Team';
        var submitLabel = isEdit ? 'Save Team' : 'Create Team';

        var html = '';
        html += '<form id="weekly-teams-team-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' +
                        escapeAttribute(week == null ? '' : String(week)) + '" ' +
                    'data-edit-id="' +
                        (isEdit ? escapeAttribute(t.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + escapeHtml(title) + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (isEdit) {
            html += '<p class="field-hint">' +
                        'Editing <strong>' +
                        escapeHtml(t.name || 'Unnamed Team') +
                        '</strong> in ' +
                        escapeHtml(className) +
                        '. Class and type are fixed after creation.' +
                    '</p>';
        } else {
            html += '<p class="field-hint">' +
                        'Creates a persistent Team entity of type "academic" ' +
                        'for <strong>' + escapeHtml(className) + '</strong>.' +
                    '</p>';
        }

        html += '<div class="form-group">';
        html += '<label for="weekly-team-name">Team Name *</label>';
        html += '<input type="text" id="weekly-team-name" ' +
                    'class="weekly-team-name" ' +
                    'placeholder="e.g., Team Alpha" ' +
                    'value="' + escapeAttribute(nameValue) + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="weekly-team-number">Team Identifier</label>';
        html += '<input type="text" id="weekly-team-number" ' +
                    'class="weekly-team-number" ' +
                    'placeholder="Optional, e.g., A, 1, Alpha" ' +
                    'value="' + escapeAttribute(numberValue) + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="weekly-team-start-period">Start Week</label>';
        html += '<input type="number" id="weekly-team-start-period" ' +
                    'class="weekly-team-start-period" ' +
                    'value="' + escapeAttribute(startValue) + '" ' +
                    'min="1" max="52" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="weekly-team-end-period">End Week (optional)</label>';
        html += '<input type="number" id="weekly-team-end-period" ' +
                    'class="weekly-team-end-period" ' +
                    'value="' + escapeAttribute(endValue) + '" ' +
                    'min="1" max="52" placeholder="Leave blank for ongoing">';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    escapeHtml(submitLabel) +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectTeamForm(form) {
        if (!form) { return null; }

        var nameEl = form.querySelector('.weekly-team-name');
        var numberEl = form.querySelector('.weekly-team-number');
        var startEl = form.querySelector('.weekly-team-start-period');
        var endEl = form.querySelector('.weekly-team-end-period');

        return {
            name: nameEl ? nameEl.value.trim() : '',
            teamNumber: numberEl ? numberEl.value.trim() : '',
            startPeriod: startEl ? startEl.value.trim() : '',
            endPeriod: endEl ? endEl.value.trim() : ''
        };
    }

    // ============================================================
    // MODAL BUILDERS - Auto-Distribute
    // ============================================================

    function buildAutoDistributeModalHTML(options) {
        options = options || {};
        var classId = options.classId || '';
        var className = options.className || 'Class';
        var week = options.week;
        var eligibleCount = isFiniteNumber(options.eligibleCount)
            ? options.eligibleCount
            : 0;
        var canDistribute = options.canDistribute === true;

        var html = '';
        html += '<form id="weekly-teams-auto-distribute-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' +
                        escapeAttribute(week == null ? '' : String(week)) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Auto-Distribute to Teams</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="at-auto-info">' +
                    'Eligible students in <strong>' +
                    escapeHtml(className) + '</strong>: ' +
                    '<strong>' + eligibleCount + '</strong>' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="weekly-teams-group-size">Students per Team</label>';
        html += '<input type="number" id="weekly-teams-group-size" ' +
                    'class="weekly-teams-group-size" ' +
                    'value="4" min="2" max="20">';
        html += '<p class="field-hint">' +
                    'Existing teams are filled toward this size first. ' +
                    'New teams are only created when no existing team ' +
                    'has room.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="weekly-teams-name-prefix">Team Name Prefix</label>';
        html += '<input type="text" id="weekly-teams-name-prefix" ' +
                    'class="weekly-teams-name-prefix" ' +
                    'value="Team ">';
        html += '<p class="field-hint">' +
                    'Each new team is named Prefix + number (Team 1, Team 2, ...).' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">' +
                    '<input type="checkbox" ' +
                        'class="weekly-teams-clear-existing">' +
                    '<span>Clear existing team windows for this class first</span>' +
                '</label>';
        html += '<p class="field-hint">' +
                    'When checked, every weekly-team window record for ' +
                    'this class is removed before distribution runs. Team ' +
                    'entities are NOT deleted; their rosters are preserved.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (canDistribute ? '' : ' disabled') +
                    '>Distribute</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectAutoDistributeForm(form) {
        if (!form) { return null; }

        var sizeEl = form.querySelector('.weekly-teams-group-size');
        var prefixEl = form.querySelector('.weekly-teams-name-prefix');
        var clearEl = form.querySelector('.weekly-teams-clear-existing');

        return {
            groupSize: sizeEl ? sizeEl.value.trim() : '',
            namePrefix: prefixEl ? prefixEl.value : 'Team ',
            clearExisting: clearEl ? clearEl.checked === true : false
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsView = {
        renderHTML: renderHTML,

        buildTeamModalHTML: buildTeamModalHTML,
        buildAutoDistributeModalHTML: buildAutoDistributeModalHTML,

        collectTeamForm: collectTeamForm,
        collectAutoDistributeForm: collectAutoDistributeForm
    };

})();
