/**
 * modules/teams/team-render.js - Team Rendering
 * Pure HTML rendering for team lists, forms, and detail views.
 *
 * Path: js/modules/teams/team-render.js
 *
 * Provides:
 *   - renderContainer(vm)          full page shell
 *   - renderList(teams, options)   team rows
 *   - renderUnassigned(vm)         unassigned-character rows
 *   - renderExpandedMembers(vm)    expanded member section
 *   - renderTeamCard(vm)           compact card (single team)
 *   - renderTeamSummary(vm)        single-line summary
 *   - renderFilterBar(vm)          filter bar (per tab)
 *   - renderRankingList(vm)        ranking rows
 *   - renderTeamForm(vm)           team creation/edit form
 *   - renderRankingForm()          ranking entry form
 *   - renderNameHistoryRow(entry)  one name-history row
 *
 * IMPORTANT:
 *   - RENDER ONLY. No queries, no state, no mutations, no domain
 *     calculations.
 *   - Every input is a view model already produced by
 *     TeamAggregator.
 *   - Uses DomUtils for escaping.
 *   - Display strings (type label, period display, rank display)
 *     arrive on the VM. The renderer does not derive them.
 *
 * PAGE HEADER ACTIONS:
 *   The page header carries three actions on the professional tab:
 *
 *     [Export] [Matchmaking] [+ Add Team]
 *
 *   - Export opens the team export picker (TeamExportPicker).
 *     The picker owns the format choice (JSON / CSV) and the
 *     status filter; the header button does not need to know
 *     about formats.
 *
 *   - Matchmaking opens the matchmaking modal. Professional
 *     teams only.
 *
 *   - + Add Team opens the team form.
 *
 *   All three are hidden while the Unassigned view is active,
 *   because none of them applies to a read-only roster of people.
 *   They are also hidden on the Temporary and Civilian tabs,
 *   because matchmaking and export target professional teams.
 *
 * MEMBER VM:
 *   A member VM carries:
 *     { characterId, memberId, displayName, status, age, deceased,
 *       role,
 *       intervals: [{ joinPeriod, leavePeriod, periodDisplay,
 *                     activeAtPeriod }],
 *       joinPeriod, leavePeriod, activeAtPeriod }
 *
 *   renderExpandedMembers iterates `intervals` to produce one line
 *   per stint.
 *
 * UNASSIGNED VM:
 *   The Unassigned view model carries:
 *     { year, total,
 *       rows: [ {
 *         characterId, displayName, status,
 *         juniorDisplay, seniorDisplay,
 *         classification, futureDisplay, futureTeamName,
 *         futureJoinYear
 *       } ] }
 *
 *   renderUnassigned emits a four-column row:
 *     Character | Status | Junior Since | Senior Since
 *   with the future-stint indicator rendered as a sub-line under
 *   the character name when present.
 *
 * TOGGLE:
 *   The professional tab's filter bar carries a two-button toggle
 *   (Teams | Unassigned). It is rendered by renderFilterBar when
 *   filterVM.tab === 'professional'. The toggle's active state is
 *   passed in as filterVM.showUnassigned (boolean).
 *
 * NO INLINE STYLES:
 *   All layout lives in CSS classes. The renderer emits class names
 *   only. The classes are defined in the Teams module stylesheet.
 *
 * DEPENDENCIES:
 *   - window.DomUtils      (escaping)
 *   - window.TeamConstants (type/status vocabulary for the form)
 */

(function() {
    'use strict';

    if (window.__teamRenderLoaded) {
        return;
    }
    window.__teamRenderLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var TeamConstants = window.TeamConstants;

    var _missing = [];
    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        _missing.push('DomUtils.escapeHtml');
    }
    if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeAttribute');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getTeamTypes !== 'function') {
        _missing.push('TeamConstants.getTeamTypes');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getTeamStatuses !== 'function') {
        _missing.push('TeamConstants.getTeamStatuses');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamRender] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function safeCount(value) {
        if (typeof value === 'number' && isFinite(value)) {
            return String(value);
        }
        return '0';
    }

    function getFormTeamTypes() {
        var all = TeamConstants.getTeamTypes();
        var result = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i].isAcademic === true) { continue; }
            result.push(all[i]);
        }
        return result;
    }

    function getFormTeamStatuses() {
        return TeamConstants.getTeamStatuses();
    }

    // ============================================================
    // SHARED FRAGMENTS
    // ============================================================

    function renderTeamActions(teamId, isExpanded, allowToggle) {
        var idAttr = escapeAttribute(teamId);
        var html = '';

        if (allowToggle !== false) {
            var caret = isExpanded ? '\u25be' : '\u25b8';
            var ariaLabel = isExpanded
                ? 'Collapse team members'
                : 'Expand team members';
            var ariaExpanded = isExpanded ? 'true' : 'false';

            html += '<button type="button" ' +
                        'class="small toggle-members" ' +
                        'data-id="' + idAttr + '" ' +
                        'aria-label="' +
                            escapeAttribute(ariaLabel) + '" ' +
                        'aria-expanded="' + ariaExpanded + '">' +
                        caret +
                    '</button>';
        }

        html += '<button type="button" ' +
                    'class="small manage-members" ' +
                    'data-id="' + idAttr + '">Members</button>';
        html += '<button type="button" ' +
                    'class="small manage-rankings" ' +
                    'data-id="' + idAttr + '">Rankings</button>';
        html += '<button type="button" ' +
                    'class="small edit-team" ' +
                    'data-id="' + idAttr + '">Edit</button>';
        html += '<button type="button" ' +
                    'class="small danger delete-team" ' +
                    'data-id="' + idAttr + '">Delete</button>';

        return html;
    }

    // ============================================================
    // TEAM LIST
    // ============================================================

    function renderList(teams, options) {
        options = options || {};
        var type = options.type || 'professional';
        var expandedTeamId = options.expandedTeamId || null;
        var expandedMembersVM = options.expandedMembersVM || null;

        if (!Array.isArray(teams) || teams.length === 0) {
            var labels = {
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams'
            };
            var label = labels[type] || 'teams';
            return '<p class="empty-state team-list-empty">' +
                        'No ' + escapeHtml(label) + ' found.' +
                    '</p>';
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
            if (!team || !team.id) { continue; }

            var isExpanded = expandedTeamId &&
                String(expandedTeamId) === String(team.id);

            var rowClass = 'list-item team-item';
            if (team.isActive === false) {
                rowClass += ' inactive';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-id="' +
                            escapeAttribute(team.id) + '">';

            html += '<span class="team-name-cell">';
            html += '<strong>' +
                        escapeHtml(team.name || 'Unnamed Team') +
                    '</strong>';
            if (isNonEmptyString(team.classDisplay)) {
                html += ' <span class="team-class">[' +
                            escapeHtml(team.classDisplay) +
                        ']</span>';
            }
            html += ' <span class="team-type-label">' +
                        escapeHtml(
                            team.typeLabel || team.type || ''
                        ) +
                    '</span>';
            if (team.isActive === false) {
                html += ' <span class="team-status-inactive">' +
                            '(Inactive)' +
                        '</span>';
            }
            html += '</span>';

            html += '<span class="team-period">' +
                        escapeHtml(team.periodDisplay || '-') +
                    '</span>';

            html += '<span class="team-rank">' +
                        escapeHtml(team.currentRank || '-') +
                    '</span>';

            html += '<span class="team-member-count">' +
                        safeCount(team.activeMemberCount) +
                    '</span>';

            html += '<span class="actions">' +
                        renderTeamActions(team.id, isExpanded, true) +
                    '</span>';

            html += '</div>';

            if (isExpanded && expandedMembersVM) {
                html += renderExpandedMembers(expandedMembersVM);
            }
        }

        return html;
    }

    // ============================================================
    // UNASSIGNED LIST
    // ============================================================

    /**
     * Render the Unassigned view.
     *
     * Rows are professional-team-eligible characters who are not
     * currently active on a professional team at the current
     * application year. The future-stint indicator appears as a
     * sub-line under the character name when the row's
     * classification is 'future'.
     *
     * @param {object} vm - Unassigned view model
     * @returns {string}
     */
    function renderUnassigned(vm) {
        if (!vm || !Array.isArray(vm.rows)) {
            return '';
        }

        var yearLabel = vm.year !== null && vm.year !== undefined
            ? String(vm.year)
            : '';

        if (vm.rows.length === 0) {
            return '<p class="empty-state team-list-empty">' +
                        'No unassigned characters' +
                        (yearLabel ? ' for ' + escapeHtml(yearLabel) : '') +
                        '.' +
                    '</p>';
        }

        var html = '';

        html += '<div class="unassigned-summary">' +
                    'Unassigned at year ' +
                    '<strong>' + escapeHtml(yearLabel) + '</strong>' +
                    ' &mdash; ' +
                    '<strong>' + safeCount(vm.total) + '</strong>' +
                    ' character' +
                    (vm.total === 1 ? '' : 's') +
                '</div>';

        html += '<div class="list-header unassigned-header">';
        html += '<span>Character</span>';
        html += '<span>Status</span>';
        html += '<span>Junior Since</span>';
        html += '<span>Senior Since</span>';
        html += '</div>';

        for (var i = 0; i < vm.rows.length; i++) {
            var row = vm.rows[i];
            if (!row || !row.characterId) { continue; }

            var rowClass = 'list-item unassigned-item';
            var hasFuture = isNonEmptyString(row.futureDisplay);
            if (hasFuture) {
                rowClass += ' has-future';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-id="' +
                            escapeAttribute(row.characterId) + '">';

            // Character cell (with optional future indicator)
            html += '<span class="unassigned-name-cell">';
            html += '<strong class="unassigned-name">' +
                        escapeHtml(row.displayName || 'Unknown') +
                    '</strong>';
            if (hasFuture) {
                html += '<span class="unassigned-future" ' +
                            'title="Already committed to a ' +
                                'professional team in a future year">' +
                            '&rarr; ' +
                            escapeHtml(row.futureDisplay) +
                        '</span>';
            }
            html += '</span>';

            html += '<span class="unassigned-status">' +
                        escapeHtml(row.status || '') +
                    '</span>';

            html += '<span class="unassigned-junior">' +
                        escapeHtml(row.juniorDisplay || '\u2014') +
                    '</span>';

            html += '<span class="unassigned-senior">' +
                        escapeHtml(row.seniorDisplay || '\u2014') +
                    '</span>';

            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // EXPANDED MEMBERS
    // ============================================================

    function renderExpandedMembers(membersVM) {
        if (!membersVM) {
            return '';
        }

        var periodLabel = membersVM.periodLabel || 'Period';
        var period = membersVM.period;
        var allMembers = Array.isArray(membersVM.members)
            ? membersVM.members
            : [];

        var activeMembers = [];
        for (var i = 0; i < allMembers.length; i++) {
            var m = allMembers[i];
            if (m && m.activeAtPeriod === true) {
                activeMembers.push(m);
            }
        }

        var html = '';
        html += '<div class="team-members-expanded" ' +
                    'data-team-id="' +
                        escapeAttribute(membersVM.teamId) + '">';

        if (activeMembers.length === 0) {
            html += '<div class="member-entry empty">' +
                        'No active members this ' +
                        escapeHtml(periodLabel.toLowerCase()) +
                    '</div>';
            html += '</div>';
            return html;
        }

        html += '<div class="members-expanded-header">' +
                    'Active Members in ' +
                    escapeHtml(periodLabel) +
                    ' ' + safeString(period) +
                ':</div>';

        for (var j = 0; j < activeMembers.length; j++) {
            html += renderExpandedMember(activeMembers[j]);
        }

        html += '</div>';
        return html;
    }

    function renderExpandedMember(member) {
        var html = '';

        html += '<div class="member-entry" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId || '') +
                    '">';

        html += '<div class="member-entry-header">';
        html += '<span class="member-entry-name">' +
                    escapeHtml(member.displayName || 'Unknown') +
                '</span> ';
        html += '<span class="member-entry-role">(' +
                    escapeHtml(member.role || 'Member') +
                ')</span> ';

        if (isNonEmptyString(member.age) && member.age !== '-') {
            html += '<span class="member-entry-age">Age: ' +
                        escapeHtml(member.age) +
                    '</span> ';
        }

        if (isNonEmptyString(member.status)) {
            html += '<span class="member-entry-status">' +
                        escapeHtml(member.status) +
                    '</span>';
        }
        html += '</div>';

        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        html += '<div class="member-entry-intervals">';

        if (intervals.length === 0) {
            html += '<div class="member-entry-interval empty">' +
                        'No stints recorded.' +
                    '</div>';
        } else {
            for (var k = 0; k < intervals.length; k++) {
                var iv = intervals[k];
                if (!iv || typeof iv !== 'object') { continue; }

                var rowClass = 'member-entry-interval';
                if (iv.activeAtPeriod === true) {
                    rowClass += ' active';
                }

                html += '<div class="' + rowClass + '" ' +
                            'data-join-period="' +
                                escapeAttribute(
                                    iv.joinPeriod || ''
                                ) + '">';
                html += '<span class="member-entry-interval-period">' +
                            escapeHtml(
                                iv.periodDisplay ||
                                formatFallbackInterval(iv)
                            ) +
                        '</span>';
                html += '</div>';
            }
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function formatFallbackInterval(iv) {
        var join = iv && isNonEmptyString(iv.joinPeriod)
            ? iv.joinPeriod
            : '';
        var leave = iv && isNonEmptyString(iv.leavePeriod)
            ? iv.leavePeriod
            : '';
        if (join && leave) {
            return join + ' \u2013 ' + leave;
        }
        if (join) {
            return join + ' \u2013';
        }
        if (leave) {
            return 'Until ' + leave;
        }
        return '\u2014';
    }

    // ============================================================
    // TEAM CARD
    // ============================================================

    function renderTeamCard(team) {
        if (!team || !team.id) {
            return '';
        }

        var cardClass = 'team-card';
        if (team.isActive === false) {
            cardClass += ' inactive';
        }

        var html = '';
        html += '<div class="' + cardClass + '" ' +
                    'data-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="team-card-header">';
        html += '<strong>' +
                    escapeHtml(team.name || 'Unnamed Team') +
                '</strong>';
        if (isNonEmptyString(team.classDisplay)) {
            html += ' <span class="team-class">[' +
                        escapeHtml(team.classDisplay) +
                    ']</span>';
        }
        html += ' <span class="team-type-label">' +
                    escapeHtml(team.typeLabel || team.type || '') +
                '</span>';
        if (team.isActive === false) {
            html += ' <span class="team-status-inactive">' +
                        '(Inactive)' +
                    '</span>';
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
                    safeCount(team.activeMemberCount) +
                '</span>';
        html += '</div>';

        html += '<div class="team-card-actions">' +
                    renderTeamActions(team.id, false, false) +
                '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAM SUMMARY
    // ============================================================

    function renderTeamSummary(team) {
        if (!team || !team.id) {
            return '';
        }

        return '<div class="team-summary">' +
                    '<span class="team-name">' +
                        escapeHtml(team.name || 'Unnamed Team') +
                    '</span>' +
                    '<span class="team-type">' +
                        escapeHtml(
                            team.typeLabel || team.type || ''
                        ) +
                    '</span>' +
                    '<span class="team-rank">#' +
                        escapeHtml(team.currentRank || '-') +
                    '</span>' +
                    '<span class="team-members">' +
                        safeCount(team.activeMemberCount) +
                        ' active members' +
                    '</span>' +
                '</div>';
    }

    // ============================================================
    // FILTER BAR
    // ============================================================

    function renderFilterBar(filterVM) {
        if (!filterVM || !filterVM.tab) {
            return '';
        }

        var tab = filterVM.tab;
        var periodLabel = filterVM.periodLabel || 'Year';
        var yearValue = filterVM.filterYear !== undefined &&
                        filterVM.filterYear !== null
            ? filterVM.filterYear
            : '';
        var status = filterVM.filterStatus || 'active';

        var html = '';

        // ---- Professional tab: mode toggle + filters ----
        if (tab === 'professional') {
            var showUnassigned = filterVM.showUnassigned === true;

            html += '<div class="filter-row filter-row-professional">';

            // Mode toggle
            html += '<div class="mode-toggle" role="tablist">';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (showUnassigned ? '' : ' active') + '" ' +
                        'data-mode="teams" ' +
                        'role="tab" ' +
                        'aria-selected="' +
                            (showUnassigned ? 'false' : 'true') + '">' +
                        'Teams' +
                    '</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (showUnassigned ? ' active' : '') + '" ' +
                        'data-mode="unassigned" ' +
                        'role="tab" ' +
                        'aria-selected="' +
                            (showUnassigned ? 'true' : 'false') + '">' +
                        'Unassigned' +
                    '</button>';
            html += '</div>';

            // Filters are only meaningful in Teams mode. When the
            // user is looking at Unassigned, the year and status
            // filters do not apply, so we hide them.
            if (!showUnassigned) {
                html += '<div class="filter-group">';
                html += '<label for="team-filter-year">' +
                            escapeHtml(periodLabel) + ':' +
                        '</label>';
                html += '<input type="number" id="team-filter-year" ' +
                            'value="' +
                                escapeAttribute(safeString(yearValue)) +
                            '" placeholder="All">';
                html += '</div>';
                html += '<div class="filter-group">';
                html += '<label for="' + escapeAttribute(tab) +
                            '-show-inactive">Show Inactive:</label>';
                html += '<input type="checkbox" id="' +
                            escapeAttribute(tab) + '-show-inactive"' +
                            (status === 'inactive' ? ' checked' : '') +
                        '>';
                html += '</div>';
                html += '<button type="button" id="apply-filter-btn" ' +
                            'class="small primary">Apply</button>';
            }

            html += '</div>';
            return html;
        }

        // ---- Civilian tab: only the inactive checkbox ----
        if (tab === 'civilian') {
            html += '<div class="filter-row">';
            html += '<div class="filter-group">';
            html += '<label for="civilian-show-inactive">' +
                        'Show Inactive:' +
                    '</label>';
            html += '<input type="checkbox" ' +
                        'id="civilian-show-inactive"' +
                        (status === 'inactive' ? ' checked' : '') +
                    '>';
            html += '</div>';
            html += '<button type="button" id="apply-filter-btn" ' +
                        'class="small primary">Apply</button>';
            html += '</div>';
            return html;
        }

        // ---- Temporary tab: year + inactive ----
        html += '<div class="filter-row">';
        html += '<div class="filter-group">';
        html += '<label for="team-filter-year">' +
                    escapeHtml(periodLabel) + ':' +
                '</label>';
        html += '<input type="number" id="team-filter-year" ' +
                    'value="' +
                        escapeAttribute(safeString(yearValue)) +
                    '" placeholder="All">';
        html += '</div>';
        html += '<div class="filter-group">';
        html += '<label for="' + escapeAttribute(tab) +
                    '-show-inactive">Show Inactive:</label>';
        html += '<input type="checkbox" id="' +
                    escapeAttribute(tab) + '-show-inactive"' +
                    (status === 'inactive' ? ' checked' : '') +
                '>';
        html += '</div>';
        html += '<button type="button" id="apply-filter-btn" ' +
                    'class="small primary">Apply</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RANKING LIST
    // ============================================================

    function renderRankingList(rankVM) {
        if (!rankVM ||
            !Array.isArray(rankVM.history) ||
            rankVM.history.length === 0) {
            return '<p class="empty-state">No ranking history</p>';
        }

        var html = '';

        for (var i = 0; i < rankVM.history.length; i++) {
            var entry = rankVM.history[i];
            if (!entry) { continue; }

            html += '<div class="ranking-entry">';
            html += '<span class="ranking-entry-text">' +
                        'Period: <strong>' +
                        escapeHtml(entry.period) +
                        '</strong> \u2192 Rank: <strong>#' +
                        escapeHtml(String(entry.rank)) +
                        '</strong>' +
                    '</span>';
            html += '<button type="button" ' +
                        'class="small danger remove-ranking" ' +
                        'data-period="' +
                            escapeAttribute(entry.period) + '">' +
                        '\u2715' +
                    '</button>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // TEAM FORM
    // ============================================================

    function renderTeamForm(formVM) {
        if (!formVM) {
            return '';
        }

        var isEdit = formVM.isEdit === true;

        var classOptions = renderClassOptions(formVM);
        var missionOptions = renderMissionOptions(formVM);
        var statusOptions = renderStatusOptions(formVM.status);
        var typeOptions = renderTypeOptions(formVM.type);
        var nameHistory = renderNameHistory(formVM.nameHistory);

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3 id="team-form-title">' +
                    (isEdit ? 'Edit Team' : 'Add Team') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'id="close-team-form">&times;</button>';
        html += '</div>';

        html += '<form id="team-form-inner" data-edit-id="' +
                    (isEdit
                        ? escapeAttribute(formVM.teamId)
                        : '') + '">';

        html += '<div class="form-grid">';

        html += '<div class="form-group full-width">';
        html += '<label for="team-name">Team Name *</label>';
        html += '<input type="text" id="team-name" value="' +
                    escapeAttribute(formVM.name) + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-type">Team Type *</label>';
        html += '<select id="team-type" required>' +
                    typeOptions +
                '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-start">Start Period</label>';
        html += '<input type="text" id="team-start" value="' +
                    escapeAttribute(formVM.startPeriod) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-end">End Period (optional)</label>';
        html += '<input type="text" id="team-end" value="' +
                    escapeAttribute(formVM.endPeriod) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-class">Class</label>';
        html += '<select id="team-class">';
        html += '<option value="">Unassigned</option>';
        html += classOptions;
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-number">Team Number</label>';
        html += '<input type="text" id="team-number" value="' +
                    escapeAttribute(formVM.teamNumber) + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Current Ranking</label>';
        html += '<input type="text" value="' +
                    escapeAttribute(formVM.currentRank || '-') +
                    '" readonly disabled>';
        html += '<span class="field-hint">' +
                    '(Read-only; use Rankings to modify)' +
                '</span>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-status">Status</label>';
        html += '<select id="team-status">' +
                    statusOptions +
                '</select>';
        html += '</div>';

        html += '<div class="form-group full-width" ' +
                    'id="temporary-mission-field">';
        html += '<label for="team-mission">' +
                    'Associated Mission' +
                '</label>';
        html += '<select id="team-mission">';
        html += '<option value="">None</option>';
        html += missionOptions;
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group full-width">';
        html += '<label>Name History</label>';
        html += '<div id="name-history-container">' +
                    nameHistory +
                '</div>';
        html += '<button type="button" id="add-name-history-btn" ' +
                    'class="small add-name-history-btn">' +
                    '+ Add Name Period' +
                '</button>';
        html += '</div>';

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-team-form" ' +
                    'class="secondary">Cancel</button>';
        html += '<button type="submit" id="save-team-btn" ' +
                    'class="primary">' +
                    (isEdit ? 'Save Team' : 'Create Team') +
                '</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    function renderTypeOptions(currentType) {
        var types = getFormTeamTypes();
        var html = '';
        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            var selected = currentType === type.id
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(type.id) + '"' +
                        selected + '>' +
                        escapeHtml(type.label) +
                    '</option>';
        }
        return html;
    }

    function renderStatusOptions(currentStatus) {
        var statuses = getFormTeamStatuses();
        var html = '';
        for (var i = 0; i < statuses.length; i++) {
            var status = statuses[i];
            var selected = currentStatus === status.id
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(status.id) + '"' +
                        selected + '>' +
                        escapeHtml(status.label) +
                    '</option>';
        }
        return html;
    }

    function renderClassOptions(formVM) {
        var options = Array.isArray(formVM.classOptions)
            ? formVM.classOptions
            : [];
        var currentId = formVM.classId;

        var html = '';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (!opt || !opt.id) { continue; }
            var selected = String(currentId) === String(opt.id)
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(opt.id) + '"' +
                        selected + '>' +
                        escapeHtml(opt.name || 'Unnamed Class') +
                    '</option>';
        }
        return html;
    }

    function renderMissionOptions(formVM) {
        var options = Array.isArray(formVM.missionOptions)
            ? formVM.missionOptions
            : [];
        var currentId = formVM.temporaryMission;

        var html = '';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (!opt || !opt.id) { continue; }
            var selected = String(currentId) === String(opt.id)
                ? ' selected'
                : '';
            var suffix = opt.status === 'completed'
                ? ' (completed)'
                : '';
            html += '<option value="' +
                        escapeAttribute(opt.id) + '"' +
                        selected + '>' +
                        escapeHtml(opt.title + suffix) +
                    '</option>';
        }
        return html;
    }

    function renderNameHistory(history) {
        var list = Array.isArray(history) ? history : [];
        if (list.length === 0) {
            return renderNameHistoryRow(null);
        }

        var html = '';
        for (var i = 0; i < list.length; i++) {
            html += renderNameHistoryRow(list[i]);
        }
        return html;
    }

    function renderNameHistoryRow(entry) {
        var e = entry || {};

        var html = '';
        html += '<div class="name-history-entry">';
        html += '<input type="text" class="name-history-name" ' +
                    'placeholder="Team Name" ' +
                    'value="' +
                        escapeAttribute(e.name || '') + '">';
        html += '<input type="text" class="name-history-start" ' +
                    'placeholder="Start" ' +
                    'value="' +
                        escapeAttribute(e.startPeriod || '') +
                    '">';
        html += '<input type="text" class="name-history-end" ' +
                    'placeholder="End" ' +
                    'value="' +
                        escapeAttribute(e.endPeriod || '') +
                    '">';
        html += '<button type="button" ' +
                    'class="small danger remove-name">x</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // RANKING FORM
    // ============================================================

    function renderRankingForm() {
        var html = '';
        html += '<form id="ranking-form-inner">';
        html += '<div class="ranking-form">';
        html += '<input type="text" id="ranking-period" ' +
                    'class="ranking-period-input" ' +
                    'placeholder="Period">';
        html += '<input type="number" id="ranking-rank" ' +
                    'class="ranking-rank-input" ' +
                    'placeholder="Rank" min="1">';
        html += '<button type="button" id="add-ranking-btn" ' +
                    'class="primary small">Add Ranking</button>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CONTAINER
    // ============================================================

    function renderContainer(pageVM) {
        if (!pageVM) {
            throw new Error(
                '[TeamRender] renderContainer requires a page ' +
                'view model.'
            );
        }

        var activeTab = pageVM.activeTab || 'professional';
        var counts = pageVM.counts || {
            professional: 0,
            temporary: 0,
            civilian: 0
        };
        var teams = Array.isArray(pageVM.teams)
            ? pageVM.teams
            : [];
        var expandedTeamId = pageVM.expandedTeamId || null;
        var expandedTeam = pageVM.expandedTeam || null;
        var period = pageVM.period;
        var showUnassigned = pageVM.showUnassigned === true;
        var unassignedVM = pageVM.unassignedVM || null;

        var expandedMembersVM = null;
        if (expandedTeam && Array.isArray(expandedTeam.members)) {
            expandedMembersVM = {
                teamId: expandedTeam.id,
                periodLabel: expandedTeam.periodLabel || 'Period',
                period: period,
                members: expandedTeam.members
            };
        }

        var html = '';

        // ---- Page header ----
        //
        // The header contains three actions on the professional tab:
        //
        //   Export        : opens the team export picker
        //   Matchmaking   : opens the matchmaking modal
        //   + Add Team    : opens the team form
        //
        // All three are hidden on Temporary and Civilian tabs
        // because matchmaking and professional-team export target
        // professional teams only.
        //
        // All three are hidden while the Unassigned view is active,
        // because none of them applies to a read-only roster of
        // people.
        //
        // The page-header action group is stable across tabs; only
        // its contents change. This keeps the header height
        // consistent whether the user is on Professional, Temporary,
        // or Civilian.
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<div class="page-header-actions">';
        if (activeTab === 'professional' && !showUnassigned) {
            html += '<button type="button" ' +
                        'id="team-export-btn" ' +
                        'class="secondary">Export</button>';
            html += '<button type="button" ' +
                        'id="team-matchmaking-btn" ' +
                        'class="secondary">Matchmaking</button>';
            html += '<button type="button" id="add-team-btn" ' +
                        'class="primary">+ Add Team</button>';
        }
        html += '</div>';
        html += '</div>';

        html += renderStats(counts);

        html += renderTabNav(activeTab, counts);

        html += '<div id="filter-container" ' +
                    'class="filter-container"></div>';

        html += '<div id="team-list-container" ' +
                    'class="team-list-container">';

        // ---- Body: either the team list or the unassigned list ----
        if (activeTab === 'professional' && showUnassigned) {
            html += renderUnassigned(unassignedVM);
        } else {
            html += renderList(teams, {
                type: activeTab,
                expandedTeamId: expandedTeamId,
                expandedMembersVM: expandedMembersVM
            });
        }

        html += '</div>';

        return html;
    }

    function renderStats(counts) {
        var html = '';
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3>' +
                    '<p class="stat-number">' +
                        safeCount(counts.professional) +
                    '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3>' +
                    '<p class="stat-number">' +
                        safeCount(counts.temporary) +
                    '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3>' +
                    '<p class="stat-number">' +
                        safeCount(counts.civilian) +
                    '</p></div>';
        html += '</div>';
        return html;
    }

    function renderTabNav(activeTab, counts) {
        function tabBtn(tab, label, count) {
            var active = activeTab === tab ? ' active' : '';
            return '<button type="button" ' +
                        'class="tab-btn' + active + '" ' +
                        'data-tab="' + escapeAttribute(tab) + '">' +
                        escapeHtml(label) +
                        ' (' + safeCount(count) + ')' +
                    '</button>';
        }

        var html = '';
        html += '<div class="tab-nav" id="team-tab-nav">';
        html += tabBtn(
            'professional', 'Professional', counts.professional
        );
        html += tabBtn(
            'temporary', 'Temporary', counts.temporary
        );
        html += tabBtn(
            'civilian', 'Civilian', counts.civilian
        );
        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRender = Object.freeze({
        // Container
        renderContainer: renderContainer,

        // Lists / detail
        renderList: renderList,
        renderUnassigned: renderUnassigned,
        renderExpandedMembers: renderExpandedMembers,
        renderTeamCard: renderTeamCard,
        renderTeamSummary: renderTeamSummary,

        // Filter bar
        renderFilterBar: renderFilterBar,

        // Modal contents
        renderRankingList: renderRankingList,
        renderTeamForm: renderTeamForm,
        renderRankingForm: renderRankingForm,
        renderNameHistoryRow: renderNameHistoryRow
    });

})();
