/**
 * modules/academy/academy-weekly-teams-view.js - Academy Weekly Teams View
 * Standalone view for browsing academic teams within a class and week.
 *
 * Path: js/modules/academy/academy-weekly-teams-view.js
 *
 * RESPONSIBILITIES:
 *   - Rendering the class + week selectors
 *   - Rendering the team list (left panel) with actions
 *   - Rendering the team detail (right panel) with members
 *   - Rendering an empty state when no class or team is selected
 *   - Building the Create / Edit Team and Auto-Distribute modals
 *   - Collecting form values from those modals
 *
 * NOT RESPONSIBILITIES:
 *   - Event binding. AcademyView binds; this module emits data-*.
 *   - Domain reads. The VM carries everything the renderer needs.
 *   - Validation. Collectors return raw field values; the domain
 *     validates.
 *
 * ROSTER SOURCE (v22):
 *   The VM's `teams[].memberCount` and `selectedTeam.members[]`
 *   come from the persistent Team entity's members[] array,
 *   filtered by week. The renderer does not care where the roster
 *   came from; it renders what the VM provides. The Tournaments
 *   view reads the same underlying roster, so the two views always
 *   agree.
 *
 * CLEAR ROSTERS:
 *   The list-panel "Clear Rosters" button emits
 *   data-action="weekly-teams-empty-teams". AcademyView handles it
 *   by calling AcademyWeeklyTeams.clearAllMembershipsForClass,
 *   which HARD-DELETES every member whose active window covers the
 *   current week, across every academic team of the class whose own
 *   startPeriod / endPeriod covers the week.
 *
 *   Teams remain scheduled. Weekly-team window records are
 *   untouched. Members that are not active at the week (past
 *   leaves, future joins) are preserved. This is used when rosters
 *   need to be rebuilt from scratch for a week.
 *
 * EVENTS EMITTED:
 *   - #academy-weekly-teams-class-select  (change)
 *   - #academy-weekly-teams-week-input    (change / Enter)
 *   - .academy-weekly-team-row            [data-team-id]
 *   - .academy-weekly-team-member-row     [data-character-id]
 *   - [data-action="weekly-teams-create-team"]     (click)
 *   - [data-action="weekly-teams-edit-team"]  [data-team-id]  (click)
 *   - [data-action="weekly-teams-auto-distribute"] (click)
 *   - [data-action="weekly-teams-empty-teams"]     (click)
 *   - [data-action="weekly-teams-delete-team"] [data-team-id]  (click)
 *   - [data-action="weekly-teams-manage-members"] [data-team-id] (click)
 *
 * CREATE / EDIT MODE:
 *   buildTeamModalHTML accepts an optional `team` object.
 *     - team absent  → "Create Academic Team" / "Create Team"
 *     - team present → "Edit Academic Team" / "Save Team"
 *
 *   The form fields are identical in both modes:
 *     - Name (required)
 *     - Team Number (optional)
 *     - Start Week (required, defaults to the current display week
 *       on create; preserved from the team on edit)
 *     - End Week (optional, blank = ongoing)
 *
 *   The class and type are FIXED after creation:
 *     - Weekly Teams only shows academic teams of one class.
 *     - Changing type or class would orphan the team from this view.
 *     The edit form does not expose a picker for either.
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

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
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
    // TOP BAR
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
            if (!cls || !cls.id) { continue; }
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
                    'data-action="weekly-teams-empty-teams" ' +
                    'title="Remove every active member from every ' +
                        'scheduled team this week. The teams stay ' +
                        'scheduled and empty.">' +
                    'Clear Rosters' +
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

        html += '</div>';

        // Detail actions
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

        var statusClass = getMemberStatusBadgeClass(member);

        var rowClass = 'academy-weekly-team-member-row';
        if (member.statusLabel === 'Deceased') {
            rowClass += ' deceased';
        }

        var secondaryParts = [];
        if (isNonEmptyString(member.roleLabel)) {
            secondaryParts.push(escapeHtml(member.roleLabel));
        }
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
            : '1';

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
        html += '<form id="weekly-teams-create-team-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week || '')) + '" ' +
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
        html += '<label for="weekly-team-number">Team Number</label>';
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
                    'min="1" max="52">';
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

    function buildCreateTeamModalHTML(options) {
        return buildTeamModalHTML(options);
    }

    function collectCreateTeamForm(form) {
        if (!form) { return null; }

        var nameEl = form.querySelector('.weekly-team-name');
        var numberEl = form.querySelector('.weekly-team-number');
        var startEl = form.querySelector('.weekly-team-start-period');
        var endEl = form.querySelector('.weekly-team-end-period');

        var name = nameEl ? nameEl.value.trim() : '';
        var number = numberEl ? numberEl.value.trim() : '';
        var startPeriod = startEl ? startEl.value.trim() : '';
        var endPeriod = endEl ? endEl.value.trim() : '';

        return {
            name: name,
            teamNumber: number,
            startPeriod: startPeriod,
            endPeriod: endPeriod
        };
    }

    function collectTeamForm(form) {
        return collectCreateTeamForm(form);
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

        var html = '';
        html += '<form id="weekly-teams-auto-distribute-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week || '')) + '">';

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
                    '<span>Clear the schedule first</span>' +
                '</label>';
        html += '<p class="field-hint">' +
                    'When checked, every scheduled team is removed from ' +
                    'the Weekly Teams schedule for this class before ' +
                    'distribution runs. The team entities themselves are ' +
                    'NOT deleted; they remain in the Teams tab and the ' +
                    'Tournaments view.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (eligibleCount < 2 ? ' disabled' : '') +
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

        var size = sizeEl ? parseInt(sizeEl.value, 10) : 4;
        if (isNaN(size) || size < 2) { size = 2; }

        var prefix = prefixEl ? prefixEl.value : 'Team ';
        var clearExisting = clearEl ? clearEl.checked === true : false;

        return {
            groupSize: size,
            namePrefix: prefix,
            clearExisting: clearExisting
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsView = {
        renderHTML: renderHTML,

        buildTeamModalHTML: buildTeamModalHTML,
        buildCreateTeamModalHTML: buildCreateTeamModalHTML,
        buildAutoDistributeModalHTML: buildAutoDistributeModalHTML,

        collectCreateTeamForm: collectCreateTeamForm,
        collectTeamForm: collectTeamForm,
        collectAutoDistributeForm: collectAutoDistributeForm
    };

})();
