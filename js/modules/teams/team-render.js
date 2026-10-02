/**
 * modules/teams/team-render.js - Team Rendering
 * Pure HTML rendering for team lists, forms, and detail views.
 *
 * Path: js/modules/teams/team-render.js
 *
 * WHAT THIS OWNS:
 *   - HTML string construction for the Teams tab.
 *   - Page shell, filter bar, team list, expanded members.
 *   - Professional Pool view (available / future sections).
 *   - Timeline delegation (via TimelineView).
 *   - Modals: team form, ranking form/list, name history row.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads, mutations, projections. Every input is a view model.
 *   - Event binding. TeamEvents owns it.
 *   - Domain calculations. Everything is display-ready on the VM.
 *
 * VM CONTRACT:
 *   The renderer trusts the VM shape. It does not default missing
 *   fields to fabricated values and does not skip malformed rows.
 *   A broken VM produces a visible failure, not a plausible empty
 *   list.
 *
 * PAGE HEADER ACTIONS:
 *   Export / Matchmaking / Add Team appear on the Professional tab.
 *   Temporary and Civilian tabs show only Add Team. Matchmaking and
 *   Export are professional-scoped features.
 *
 * VIEW MODES (professional only):
 *   'teams' | 'pool' | 'timeline'. The mode toggle renders all
 *   three for the professional tab; Temporary and Civilian tabs
 *   have no mode toggle.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 *   - window.TeamConstants
 *
 * DEPENDENCIES (LAZY):
 *   - window.TimelineView (timeline renderer)
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

    function isCount(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function renderCount(value) {
        if (!isCount(value)) {
            throw new Error(
                '[TeamRender] Expected a numeric count, got: ' +
                typeof value
            );
        }
        return String(value);
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
                    'class="small export-team" ' +
                    'data-id="' + idAttr + '">Export</button>';
        html += '<button type="button" ' +
                    'class="small edit-team" ' +
                    'data-id="' + idAttr + '">Edit</button>';
        html += '<button type="button" ' +
                    'class="small danger delete-team" ' +
                    'data-id="' + idAttr + '">Delete</button>';

        return html;
    }

    function renderAgeChip(ageDisplay) {
        if (!isNonEmptyString(ageDisplay)) { return ''; }
        return '<span class="unassigned-age">(' +
                    escapeHtml(ageDisplay) +
                ')</span>';
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
                        escapeHtml(team.typeLabel || team.type || '') +
                    '</span>';
            if (team.isActive === false) {
                html += ' <span class="team-status-inactive">' +
                            '(Inactive)' +
                        '</span>';
            }
            if (isNonEmptyString(team.temporaryMissionName)) {
                html += ' <span class="team-mission-label" ' +
                            'title="Associated mission">' +
                            escapeHtml(team.temporaryMissionName) +
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
                        renderCount(team.activeMemberCount) +
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
    // PROFESSIONAL POOL
    // ============================================================

    function renderProfessionalPool(vm) {
        if (!vm) {
            return '<p class="empty-state">Pool is not available.</p>';
        }

        var available = Array.isArray(vm.available) ? vm.available : [];
        var future = Array.isArray(vm.future) ? vm.future : [];

        var html = '';

        html += '<div class="pool-summary">';
        html += 'Pool at year <strong>' +
                    escapeHtml(String(vm.period)) +
                '</strong> &mdash; ';
        html += '<strong>' + escapeHtml(String(available.length)) +
                    '</strong> available, ';
        html += '<strong>' + escapeHtml(String(future.length)) +
                    '</strong> with future commitments.';
        html += '</div>';

        html += renderPoolSection(
            'Available',
            available,
            renderAvailablePoolRow
        );

        if (future.length > 0) {
            html += renderPoolSection(
                'Future Assignments',
                future,
                renderFuturePoolRow
            );
        }

        return html;
    }

    function renderPoolSection(heading, rows, rowRenderer) {
        if (rows.length === 0) { return ''; }

        var html = '';

        html += '<div class="pool-section">';
        html += '<div class="pool-section-header">' +
                    escapeHtml(heading) +
                    ' (' + escapeHtml(String(rows.length)) + ')' +
                '</div>';

        html += '<div class="list-header pool-header">';
        html += '<span>Character</span>';
        html += '<span>Status</span>';
        html += '<span>Available</span>';
        html += '<span>Assignment</span>';
        html += '<span>History</span>';
        html += '</div>';

        for (var i = 0; i < rows.length; i++) {
            html += rowRenderer(rows[i]);
        }

        html += '</div>';

        return html;
    }

    function renderAvailablePoolRow(row) {
        return renderPoolRowBase(row, 'available');
    }

    function renderFuturePoolRow(row) {
        return renderPoolRowBase(row, 'future');
    }

    function renderPoolRowBase(row, variant) {
        var html = '';

        html += '<div class="list-item professional-pool-item ' +
                    'pool-item-' + variant + '" ' +
                    'data-id="' +
                        escapeAttribute(row.characterId) + '">';

        html += '<span class="pool-character">';
        html += '<strong class="pool-name">' +
                    escapeHtml(row.displayName) +
                '</strong>';
        html += ' ' + renderAgeChip(row.ageDisplay);
        html += '</span>';

        html += '<span class="pool-status">' +
                    escapeHtml(row.statusAtPeriod || '') +
                '</span>';

        html += '<span class="pool-availability">' +
                    escapeHtml(row.availability.display) +
                '</span>';

        html += '<span class="pool-assignment">' +
                    escapeHtml(row.assignment.display) +
                '</span>';

        html += '<span class="pool-history">';
        if (row.history.hasProfessionalHistory) {
            html += 'Former: ' + escapeHtml(
                String(row.history.formerTeamCount)
            ) + ' team' +
            (row.history.formerTeamCount === 1 ? '' : 's');
        } else {
            html += '\u2014';
        }
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // TIMELINE (delegated)
    // ============================================================

    function renderTimelineContent(pageVM) {
        var TV = window.TimelineView;
        if (!TV || typeof TV.renderTimeline !== 'function') {
            throw new Error(
                '[TeamRender] TimelineView is not available.'
            );
        }

        var timelineVM = pageVM.timelineVM;
        var expandedYears = pageVM.timelineExpandedYears ||
                            Object.create(null);

        if (!timelineVM) {
            throw new Error(
                '[TeamRender] pageVM.timelineVM is missing.'
            );
        }

        return TV.renderTimeline(timelineVM, expandedYears);
    }

    // ============================================================
    // EXPANDED MEMBERS
    // ============================================================

    function renderExpandedMembers(membersVM) {
        if (!membersVM) { return ''; }

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
                    renderCount(team.activeMemberCount) +
                '</span>';
        html += '</div>';

        if (isNonEmptyString(team.temporaryMissionName)) {
            html += '<div class="team-card-mission">' +
                        escapeHtml(team.temporaryMissionName) +
                    '</div>';
        }

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
                        renderCount(team.activeMemberCount) +
                        ' active members' +
                    '</span>' +
                '</div>';
    }

    // ============================================================
    // FILTER BAR
    // ============================================================

    function renderFilterBar(filterVM) {
        if (!filterVM || !filterVM.tab) { return ''; }

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
            var viewMode = filterVM.viewMode || 'teams';
            var isPool = viewMode === 'pool';
            var isTimeline = viewMode === 'timeline';

            html += '<div class="filter-row filter-row-professional">';

            html += '<div class="mode-toggle" role="tablist">';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (viewMode === 'teams' ? ' active' : '') +
                        '" ' +
                        'data-mode="teams" ' +
                        'role="tab" ' +
                        'aria-selected="' +
                            (viewMode === 'teams' ? 'true' : 'false') +
                        '">Teams</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (isPool ? ' active' : '') +
                        '" ' +
                        'data-mode="pool" ' +
                        'role="tab" ' +
                        'aria-selected="' +
                            (isPool ? 'true' : 'false') +
                        '">Professional Pool</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (isTimeline ? ' active' : '') +
                        '" ' +
                        'data-mode="timeline" ' +
                        'role="tab" ' +
                        'aria-selected="' +
                            (isTimeline ? 'true' : 'false') +
                        '">Timeline</button>';
            html += '</div>';

            // Year and status filters apply only to the Teams mode.
            if (viewMode === 'teams') {
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
            return '<p class="empty-state">Form data is not available.</p>';
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
                '[TeamRender] renderContainer requires a page VM.'
            );
        }

        var activeTab = pageVM.activeTab;
        var viewMode = pageVM.viewMode || 'teams';
        var counts = pageVM.counts;
        var teams = pageVM.teams;
        var expandedTeamId = pageVM.expandedTeamId || null;
        var expandedTeam = pageVM.expandedTeam || null;
        var period = pageVM.period;
        var poolVM = pageVM.professionalPoolVM || null;

        var isPool = activeTab === 'professional' &&
            viewMode === 'pool';
        var isTimeline = activeTab === 'professional' &&
            viewMode === 'timeline';

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
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<div class="page-header-actions">';
        if (activeTab === 'professional') {
            html += '<button type="button" ' +
                        'id="team-export-btn" ' +
                        'class="secondary">Export</button>';
            html += '<button type="button" ' +
                        'id="team-matchmaking-btn" ' +
                        'class="secondary">Matchmaking</button>';
        }
        html += '<button type="button" id="add-team-btn" ' +
                    'class="primary">+ Add Team</button>';
        html += '</div>';
        html += '</div>';

        html += renderStats(counts);
        html += renderTabNav(activeTab, counts);
        html += '<div id="filter-container" ' +
                    'class="filter-container"></div>';

        html += '<div id="team-list-container" ' +
                    'class="team-list-container' +
                    (isTimeline ? ' timeline-container' : '') +
                    '">';

        // ---- Body ----
        if (isTimeline) {
            html += renderTimelineContent(pageVM);
        } else if (isPool) {
            html += renderProfessionalPool(poolVM);
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
                        renderCount(counts.professional) +
                    '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3>' +
                    '<p class="stat-number">' +
                        renderCount(counts.temporary) +
                    '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3>' +
                    '<p class="stat-number">' +
                        renderCount(counts.civilian) +
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
                        ' (' + renderCount(count) + ')' +
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
        renderContainer: renderContainer,

        renderList: renderList,
        renderProfessionalPool: renderProfessionalPool,
        renderExpandedMembers: renderExpandedMembers,
        renderTeamCard: renderTeamCard,
        renderTeamSummary: renderTeamSummary,

        renderFilterBar: renderFilterBar,

        renderRankingList: renderRankingList,
        renderTeamForm: renderTeamForm,
        renderRankingForm: renderRankingForm,
        renderNameHistoryRow: renderNameHistoryRow
    });

})();
