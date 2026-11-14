/**
 * modules/teams/team-render.js - Team Rendering
 * Pure HTML rendering for team lists, forms, and detail views.
 *
 * Path: js/modules/teams/team-render.js
 *
 * WHAT THIS OWNS:
 *   - HTML string construction for the Teams tab.
 *   - Page shell, filter bar, team list, expanded members.
 *   - Professional Pool view: expandable rows with a compact
 *     stats panel, per-row selection checkboxes, and a
 *     "Create Team from Selection" action.
 *   - Timeline delegation (via TimelineView).
 *   - Rankings delegation (via TeamRankingsView).
 *   - Modals: team form, ranking form/list.
 *   - The PERIODS editor: one row per period, each carrying its
 *     own name, start / end, tactical style, and specialisations.
 *   - renderPeriodRow(), the single canonical renderer for a
 *     period row. TeamEvents delegates to this function when it
 *     appends a new row, so the append-path markup cannot drift
 *     from the initial-render markup.
 *   - The read-only descriptive block on the expanded row and the
 *     team card: current period's tactical style and
 *     specialisations, plus a period history list when there is
 *     more than one period.
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
 *   list. renderCount() throws deliberately; a malformed count
 *   blanks the tab, and the console names the malformed field.
 *
 * PERIODS MODEL:
 *   The team form VM carries `periods`, an array of display-shaped
 *   entries:
 *
 *     {
 *       startPeriod, endPeriod, name, tacticalStyle,
 *       specialisationIds: [],
 *       specialisations:   [ { id, label } ]
 *     }
 *
 *   Each entry renders as one row in the periods editor via
 *   renderPeriodRow(period, index, isLast, options, canRemove).
 *
 *   THE LAST ROW IS NOT SPECIAL:
 *   Every row's end input is a normal editable number input. A
 *   blank end means "unbounded on this side"; for the last row
 *   specifically, that means the team is still ongoing. A
 *   non-blank end on the last row means the team disbanded at
 *   that year.
 *
 * TEAM TYPE IN THE FORM SELECT:
 *   The form's #team-type select offers every non-academic type
 *   (academic teams are managed by the Academy module). If the
 *   current team's type is not in that list — because it is
 *   academic, or because it is an unnormalised legacy alias —
 *   the type is appended as a DISABLED option marked
 *   "(current; not editable here)".
 *
 * FILTER BAR SORT AND SPECIALISATION CONTROLS (this revision):
 *   The professional tab in Teams mode gains three new controls
 *   next to the year input and the Show Inactive checkbox:
 *
 *     #team-sort            Sort key <select>, options from
 *                           filterVM.sortOptions. Values are
 *                           'name' | 'period' | 'members'.
 *     #team-sort-direction  Direction toggle. Shows ▲ for asc,
 *                           ▼ for desc. The accessible label
 *                           names the current direction and the
 *                           one a click will switch to.
 *     #team-specialisations-toggle
 *                           Popover trigger. Reads
 *                           "Specialisations" when no filter is
 *                           active and "Specialisations (N)"
 *                           otherwise. Carries .has-filter when
 *                           active.
 *     #team-specialisations-panel
 *                           Hidden popover panel. One checkbox
 *                           per filterVM.specialisationOptions
 *                           entry. A "Clear" link at the bottom.
 *                           TeamEvents owns open/close and the
 *                           checkbox change handler; the renderer
 *                           only emits the markup and the
 *                           `hidden` attribute.
 *
 *   The new controls live inside the `viewMode === 'teams'` branch
 *   of renderFilterBar, so they appear only on the professional
 *   tab in Teams mode. Pool, Timeline, and Rankings modes have
 *   their own control surfaces and are unaffected.
 *
 * LIST HEADER SORT INDICATOR (this revision):
 *   The list header row gains a small sort-indicator span next to
 *   "Team Name". It shows the current sort key and direction as
 *   "↑ Name" / "↑ Period" / "↓ Members". This makes the current
 *   sort legible even when the filter bar is scrolled out of
 *   view. The indicator is read-only display, not a control.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 *   - window.TeamConstants
 *
 * DEPENDENCIES (LAZY):
 *   - window.TimelineView       (timeline renderer)
 *   - window.TeamRankingsView   (rankings tab renderer)
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

    /**
     * Emit a count as a string.
     *
     * THROWS on anything that is not a finite number. This is
     * deliberate: a malformed count is a data-layer bug, and
     * surfacing it as a render failure means the tab visibly
     * refuses to display rather than silently rendering "NaN" or
     * "0".
     */
    function renderCount(value) {
        if (!isCount(value)) {
            throw new Error(
                '[TeamRender] Expected a numeric count, got: ' +
                typeof value
            );
        }
        return String(value);
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    /**
     * The types offered in the team form. Academic teams are
     * managed by the Academy module. The retired 'temporary' type
     * is gone from TeamConstants entirely.
     */
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

    /**
     * Normalise a stored type for form display. Routes through
     * TeamConstants.normalizeTeamType so a legacy 'temporary' or
     * 'internship' record displays as 'professional'.
     */
    function normaliseTeamTypeForDisplay(rawType) {
        if (typeof TeamConstants.normalizeTeamType !== 'function') {
            return typeof rawType === 'string' ? rawType : '';
        }
        return TeamConstants.normalizeTeamType(rawType) || '';
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
                    'class="small danger kill-team" ' +
                    'data-id="' + idAttr + '" ' +
                    'title="Mark every active member as deceased ' +
                    'in a chosen year">Kill</button>';
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
    // STATUS LABELS
    // ============================================================

    function renderStatusLabels(team) {
        var html = '';

        if (team.isActive === false) {
            html += ' <span class="team-status-inactive">' +
                        '(Inactive)' +
                    '</span>';
        }

        if (team.isDeprecated === true) {
            html += ' <span class="team-status-deprecated">' +
                        '(Deprecated)' +
                    '</span>';
        }

        return html;
    }

    // ============================================================
    // DESCRIPTIVE FIELDS (read-only)
    // ============================================================

    function renderDescriptiveFields(team) {
        if (!team || typeof team !== 'object') { return ''; }

        var style = isNonEmptyString(team.tacticalStyle)
            ? String(team.tacticalStyle)
            : '';

        var specs = [];
        if (isArray(team.specialisations)) {
            for (var i = 0; i < team.specialisations.length; i++) {
                var entry = team.specialisations[i];
                if (!entry) { continue; }
                if (typeof entry === 'string') {
                    specs.push(entry);
                } else if (isNonEmptyString(entry.label)) {
                    specs.push(String(entry.label));
                } else if (isNonEmptyString(entry.id)) {
                    specs.push(String(entry.id));
                }
            }
        }
        var specText = specs.join(', ');

        // Periods list: only shown when there is more than one.
        var periodsList = '';
        if (isArray(team.periods) && team.periods.length > 1) {
            var periodLines = [];
            for (var p = 0; p < team.periods.length; p++) {
                var period = team.periods[p];
                if (!period || typeof period !== 'object') {
                    continue;
                }
                var start = isNonEmptyString(period.startPeriod)
                    ? String(period.startPeriod)
                    : '?';
                var end = isNonEmptyString(period.endPeriod)
                    ? String(period.endPeriod)
                    : 'present';
                var name = isNonEmptyString(period.name)
                    ? String(period.name)
                    : 'Unnamed';
                periodLines.push(
                    escapeHtml(name) + ' (' +
                    escapeHtml(start) + '\u2013' +
                    escapeHtml(end) + ')'
                );
            }
            if (periodLines.length > 0) {
                periodsList = periodLines.join(' &middot; ');
            }
        }

        if (style === '' && specText === '' && periodsList === '') {
            return '';
        }

        var html = '';
        html += '<div class="team-descriptive-fields">';

        if (style !== '') {
            html += '<div class="team-descriptive-row">' +
                        '<span class="team-descriptive-label">' +
                            'Tactical Style:' +
                        '</span>' +
                        '<span class="team-descriptive-value">' +
                            escapeHtml(style) +
                        '</span>' +
                    '</div>';
        }

        if (specText !== '') {
            html += '<div class="team-descriptive-row">' +
                        '<span class="team-descriptive-label">' +
                            'Specialisations:' +
                        '</span>' +
                        '<span class="team-descriptive-value">' +
                            escapeHtml(specText) +
                        '</span>' +
                    '</div>';
        }

        if (periodsList !== '') {
            html += '<div class="team-descriptive-row ' +
                        'team-descriptive-periods-row">' +
                        '<span class="team-descriptive-label">' +
                            'Periods:' +
                        '</span>' +
                        '<span class="team-descriptive-value ' +
                            'team-descriptive-periods">' +
                            periodsList +
                        '</span>' +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // LIST
    // ============================================================

    function renderList(teams, options) {
        options = options || {};
        var type = options.type || 'professional';
        var expandedTeamId = options.expandedTeamId || null;
        var expandedMembersVM = options.expandedMembersVM || null;
        var selectedIds = options.selectedIds || Object.create(null);

        // Sort state, forwarded from the page VM. The header row
        // shows a small indicator so the current sort is legible
        // even when the filter bar is scrolled out of view.
        // Defaults preserve existing behaviour for callers that
        // do not pass these (the card and modal paths).
        var sort = isNonEmptyString(options.sort)
            ? options.sort
            : 'name';
        var sortDirection = options.sortDirection === 'desc'
            ? 'desc'
            : 'asc';

        if (!Array.isArray(teams) || teams.length === 0) {
            var labels = {
                'professional': 'professional teams',
                'civilian': 'civilian teams'
            };
            var label = labels[type] || 'teams';
            return '<p class="empty-state team-list-empty">' +
                        'No ' + escapeHtml(label) + ' found.' +
                    '</p>';
        }

        var html = '';

        html += '<div class="list-header team-header">';
        html += '<span class="team-header-check"></span>';
        html += '<span class="team-header-name">' +
                    'Team Name' +
                    renderSortIndicator(sort, sortDirection) +
                '</span>';
        html += '<span>Period</span>';
        html += '<span>Rank</span>';
        html += '<span>Members</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];

            var isExpanded = expandedTeamId &&
                String(expandedTeamId) === String(team.id);

            var isSelected =
                selectedIds[String(team.id)] === true;

            var rowClass = 'list-item team-item';
            if (team.isActive === false) {
                rowClass += ' inactive';
            }
            if (team.isDeprecated === true) {
                rowClass += ' deprecated';
            }
            if (isSelected) {
                rowClass += ' team-item-selected';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-id="' +
                            escapeAttribute(team.id) + '">';

            html += '<span class="team-select-cell">';
            html += '<input type="checkbox" ' +
                        'class="team-select-checkbox" ' +
                        'data-team-id="' +
                            escapeAttribute(team.id) + '"' +
                        (isSelected ? ' checked' : '') +
                        ' aria-label="Select ' +
                            escapeAttribute(
                                team.name || 'team'
                            ) + '">';
            html += '</span>';

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
            html += renderStatusLabels(team);
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

    /**
     * Small read-only indicator next to the "Team Name" column
     * label. Shows the current sort key and direction as
     * "\u2191 Name" / "\u2193 Members" so the sort state is
     * legible even when the filter bar is out of view.
     *
     * The arrow points at what a CLICK on the direction toggle
     * would do, not the current direction alone — but here it
     * is read-only display of the current state, so:
     *   asc  -> \u2191 (up arrow, ascending)
     *   desc -> \u2193 (down arrow, descending)
     *
     * Unknown sort keys emit no indicator.
     */
    function renderSortIndicator(sort, sortDirection) {
        var labels = {
            'name': 'Name',
            'period': 'Period',
            'members': 'Members'
        };
        var label = labels[sort];
        if (!label) { return ''; }

        var arrow = sortDirection === 'desc'
            ? '\u2193'
            : '\u2191';

        return '<span class="team-header-sort-indicator" ' +
                    'title="Sorted by ' + escapeAttribute(label) +
                    ' (' +
                    (sortDirection === 'desc'
                        ? 'descending'
                        : 'ascending') +
                    ')">' +
                    arrow + ' ' + escapeHtml(label) +
                '</span>';
    }

    // ============================================================
    // PROFESSIONAL POOL
    // ============================================================

    function renderProfessionalPool(vm, expandedIds, selectedIds) {
        if (!vm) {
            return '<p class="empty-state">Pool is not available.</p>';
        }

        var available = Array.isArray(vm.available)
            ? vm.available
            : [];
        var historical = Array.isArray(vm.historical)
            ? vm.historical
            : [];

        expandedIds = expandedIds || Object.create(null);
        selectedIds = selectedIds || Object.create(null);

        var selectedCount = 0;
        for (var k in selectedIds) {
            if (Object.prototype.hasOwnProperty.call(
                selectedIds, k
            ) && selectedIds[k] === true) {
                selectedCount++;
            }
        }

        var html = '';

        html += '<div class="pool-selection-bar">';
        html += '<div class="pool-selection-info">';
        html += '<strong>' + selectedCount + '</strong> selected';
        html += '<span class="pool-selection-hint">' +
                    'Tick two or more candidates to create a team ' +
                    'from them.' +
                '</span>';
        html += '</div>';
        html += '<div class="pool-selection-actions">';
        html += '<button type="button" ' +
                    'class="small secondary" ' +
                    'id="pool-clear-selection"' +
                    (selectedCount === 0 ? ' disabled' : '') +
                    '>Clear</button>';
        html += '<button type="button" ' +
                    'class="primary small" ' +
                    'id="pool-create-team-btn"' +
                    (selectedCount < 2 ? ' disabled' : '') +
                    '>Create Team from Selection</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="pool-summary">';
        html += 'Pool as of year <strong>' +
                    escapeHtml(String(vm.period)) +
                '</strong> &mdash; ';
        html += '<strong>' + escapeHtml(String(available.length)) +
                    '</strong> currently in their window, ';
        html += '<strong>' + escapeHtml(String(historical.length)) +
                    '</strong> outside it.';
        html += '</div>';

        if (available.length === 0 && historical.length === 0) {
            html += '<p class="empty-state">' +
                        'No candidates in the professional pool.' +
                    '</p>';
            return html;
        }

        html += renderPoolSection(
            'Available',
            available,
            'pool-item-available',
            expandedIds,
            selectedIds
        );

        html += renderPoolSection(
            'Previously Available',
            historical,
            'pool-item-historical',
            expandedIds,
            selectedIds
        );

        return html;
    }

    function renderPoolSection(
        heading, rows, variantClass, expandedIds, selectedIds
    ) {
        if (rows.length === 0) { return ''; }

        var html = '';

        html += '<div class="pool-section">';
        html += '<div class="pool-section-header">' +
                    escapeHtml(heading) +
                    ' (' + escapeHtml(String(rows.length)) + ')' +
                '</div>';

        html += '<div class="list-header pool-header">';
        html += '<span class="pool-header-check"></span>';
        html += '<span>Character</span>';
        html += '<span>Status</span>';
        html += '<span>Available</span>';
        html += '<span>Assignment</span>';
        html += '<span>History</span>';
        html += '</div>';

        for (var i = 0; i < rows.length; i++) {
            html += renderPoolRow(
                rows[i],
                variantClass,
                expandedIds,
                selectedIds
            );
        }

        html += '</div>';

        return html;
    }

    function renderPoolRow(
        row, variantClass, expandedIds, selectedIds
    ) {
        if (!row || typeof row !== 'object') {
            throw new Error(
                '[TeamRender] Pool row is not an object.'
            );
        }
        if (!row.availability || typeof row.availability !== 'object') {
            throw new Error(
                '[TeamRender] Pool row missing `availability` ' +
                '(characterId=' + safeString(row.characterId) + ').'
            );
        }
        if (!row.assignment || typeof row.assignment !== 'object') {
            throw new Error(
                '[TeamRender] Pool row missing `assignment` ' +
                '(characterId=' + safeString(row.characterId) + ').'
            );
        }
        if (!row.history || typeof row.history !== 'object') {
            throw new Error(
                '[TeamRender] Pool row missing `history` ' +
                '(characterId=' + safeString(row.characterId) + ').'
            );
        }

        var charId = row.characterId;
        var idAttr = escapeAttribute(charId);

        var isExpanded = expandedIds[charId] === true;
        var isSelected = selectedIds[charId] === true;

        var rowClass = 'list-item professional-pool-item ' +
            variantClass;
        if (isExpanded) { rowClass += ' pool-item-expanded'; }
        if (isSelected) { rowClass += ' pool-item-selected'; }

        var html = '';

        html += '<div class="' + rowClass + '" ' +
                    'data-id="' + idAttr + '" ' +
                    'data-action="pool-toggle-expand">';

        html += '<span class="pool-select-cell">';
        html += '<input type="checkbox" ' +
                    'class="pool-select-checkbox" ' +
                    'data-character-id="' + idAttr + '"' +
                    (isSelected ? ' checked' : '') +
                    ' aria-label="Select ' +
                        escapeAttribute(row.displayName) + '">';
        html += '</span>';

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
                    escapeHtml(row.availability.display || '') +
                '</span>';

        html += '<span class="pool-assignment">' +
                    escapeHtml(row.assignment.display || '') +
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

        if (isExpanded) {
            html += renderPoolExpandPanel(row);
        }

        return html;
    }

    // ============================================================
    // POOL EXPAND PANEL
    // ============================================================

    function renderPoolExpandPanel(row) {
        var detail = row.detail;

        var html = '';
        html += '<div class="pool-expand-panel" ' +
                    'data-character-id="' +
                        escapeAttribute(row.characterId) + '">';

        if (!detail) {
            html += '<p class="empty-state small">' +
                        'No profile details available.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += renderPoolPhysicalLine(detail.physical);
        html += renderPoolPersonalityBlock(detail.personality);
        html += renderPoolCombatBlock(detail.combat);

        html += '</div>';
        return html;
    }

    function renderPoolPhysicalLine(physical) {
        if (!physical) { return ''; }

        var parts = [];
        if (isNonEmptyString(physical.height)) {
            parts.push(escapeHtml(physical.height));
        }
        if (isNonEmptyString(physical.weight)) {
            parts.push(escapeHtml(physical.weight));
        }
        if (isNonEmptyString(physical.build)) {
            parts.push(escapeHtml(physical.build));
        }

        if (parts.length === 0) { return ''; }

        var html = '';
        html += '<div class="pool-expand-line pool-expand-physical">';
        html += '<span class="pool-expand-label">Physical</span>';
        html += '<span class="pool-expand-value">' +
                    parts.join(' \u00b7 ') +
                '</span>';
        html += '</div>';
        return html;
    }

    function renderPoolPersonalityBlock(personality) {
        if (!personality) { return ''; }

        var fields = [
            { key: 'traits',        label: 'Traits' },
            { key: 'ideals',        label: 'Ideals' },
            { key: 'bonds',         label: 'Bonds' },
            { key: 'flaws',         label: 'Flaws' },
            { key: 'alignment',     label: 'Alignment' },
            { key: 'goals',         label: 'Goals' },
            { key: 'socialStyle',   label: 'Social' },
            { key: 'conflictStyle', label: 'Conflict' },
            { key: 'quirks',        label: 'Quirks' }
        ];

        var lines = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var value = personality[f.key];
            if (!isNonEmptyString(value)) { continue; }

            lines.push(
                '<div class="pool-expand-line pool-expand-personality">' +
                    '<span class="pool-expand-label">' +
                        escapeHtml(f.label) +
                    '</span>' +
                    '<span class="pool-expand-value">' +
                        escapeHtml(value) +
                    '</span>' +
                '</div>'
            );
        }

        if (lines.length === 0) { return ''; }

        var html = '';
        html += '<div class="pool-expand-block pool-expand-block-personality">';
        html += '<div class="pool-expand-block-header">Personality</div>';
        html += lines.join('');
        html += '</div>';
        return html;
    }

    function renderPoolCombatBlock(combat) {
        if (!combat) { return ''; }

        var html = '';
        html += '<div class="pool-expand-block pool-expand-block-combat">';
        html += '<div class="pool-expand-block-header">Combat</div>';

        var order = Array.isArray(combat.statOrder)
            ? combat.statOrder
            : Object.keys(combat.stats || {});

        var statParts = [];
        for (var i = 0; i < order.length; i++) {
            var key = order[i];
            var stat = combat.stats ? combat.stats[key] : null;
            if (!stat) { continue; }

            statParts.push(
                '<span class="pool-stat">' +
                    '<span class="pool-stat-label">' +
                        escapeHtml(stat.label) +
                    '</span>' +
                    '<span class="pool-stat-value">' +
                        escapeHtml(String(stat.value)) +
                    '</span>' +
                '</span>'
            );
        }

        if (statParts.length > 0) {
            html += '<div class="pool-expand-line pool-expand-stats">' +
                        '<span class="pool-expand-label">Stats</span>' +
                        '<span class="pool-expand-value">' +
                            statParts.join('') +
                        '</span>' +
                    '</div>';
        }

        html += '<div class="pool-expand-line pool-expand-hpmp">' +
                    '<span class="pool-expand-label">HP / MP</span>' +
                    '<span class="pool-expand-value">' +
                        escapeHtml(String(combat.hp)) +
                        ' / ' +
                        escapeHtml(String(combat.mp)) +
                    '</span>' +
                '</div>';

        var magic = Array.isArray(combat.magic)
            ? combat.magic
            : [];

        if (magic.length > 0) {
            var magicParts = [];
            for (var m = 0; m < magic.length; m++) {
                var entry = magic[m];
                magicParts.push(
                    '<span class="pool-magic">' +
                        '<span class="pool-magic-label">' +
                            escapeHtml(entry.label) +
                        '</span>' +
                        '<span class="pool-magic-value">' +
                            escapeHtml(String(entry.value)) +
                        '</span>' +
                    '</span>'
                );
            }
            html += '<div class="pool-expand-line pool-expand-magic">' +
                        '<span class="pool-expand-label">Magic</span>' +
                        '<span class="pool-expand-value">' +
                            magicParts.join('') +
                        '</span>' +
                    '</div>';
        }

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
    // RANKINGS (delegated — pure passthrough)
    // ============================================================
    //
    // The rankings tab body is rendered by TeamRankingsView. The
    // ordered-list VM ({ year, rows, unrankedTeams, showInactive })
    // is passed through unchanged. This module does NOT read
    // sortMode, sortDirection, or any other ranking field; it just
    // hands the VM over.

    function renderRankingsContent(pageVM) {
        var RV = window.TeamRankingsView;
        if (!RV || typeof RV.renderRankingsTab !== 'function') {
            throw new Error(
                '[TeamRender] TeamRankingsView is not available.'
            );
        }

        var rankingsVM = pageVM.rankingsVM;

        if (!rankingsVM) {
            throw new Error(
                '[TeamRender] pageVM.rankingsVM is missing.'
            );
        }

        return RV.renderRankingsTab(rankingsVM);
    }

    // ============================================================
    // EXPANDED MEMBERS
    // ============================================================
    //
    // A member may carry MULTIPLE stints. The aggregator emits
    // every interval on each member, with a per-interval
    // `activeAtPeriod` boolean and an aggregate one on the
    // member as a whole.
    //
    // A member is shown here when ANY of their stints is active
    // at the viewed period. Members whose stints are ALL closed
    // are "former" members and belong in the member manager's
    // Former section, not here.
    //
    // A shown member renders EVERY stint, not just the active
    // one, so a re-joined member's earlier stints remain visible.

    function memberHasActiveStint(member) {
        if (!member || typeof member !== 'object') { return false; }
        if (member.activeAtPeriod === true) { return true; }
        if (!Array.isArray(member.intervals)) { return false; }
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (iv && iv.activeAtPeriod === true) {
                return true;
            }
        }
        return false;
    }

    function renderExpandedMembers(membersVM) {
        if (!membersVM) { return ''; }

        var periodLabel = membersVM.periodLabel || 'Period';
        var period = membersVM.period;
        var allMembers = Array.isArray(membersVM.members)
            ? membersVM.members
            : [];

        var shownMembers = [];
        for (var i = 0; i < allMembers.length; i++) {
            var m = allMembers[i];
            if (!m) { continue; }
            if (memberHasActiveStint(m)) {
                shownMembers.push(m);
            }
        }

        var html = '';
        html += '<div class="team-members-expanded" ' +
                    'data-team-id="' +
                        escapeAttribute(membersVM.teamId) + '">';

        if (membersVM.team) {
            html += renderDescriptiveFields(membersVM.team);
        }

        if (shownMembers.length === 0) {
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

        for (var j = 0; j < shownMembers.length; j++) {
            html += renderExpandedMember(shownMembers[j]);
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
                } else {
                    rowClass += ' historical';
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
                if (iv.activeAtPeriod === true) {
                    html += '<span class="member-entry-interval-badge">' +
                                'Current' +
                            '</span>';
                } else {
                    html += '<span class="member-entry-interval-badge ' +
                                'member-entry-interval-badge-historical">' +
                                'Previous' +
                            '</span>';
                }
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
        if (team.isDeprecated === true) {
            cardClass += ' deprecated';
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
        html += renderStatusLabels(team);
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

        html += renderDescriptiveFields(team);

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
    //
    // The professional tab carries a four-way mode toggle:
    //
    //   Teams | Professional Pool | Timeline | Rankings
    //
    // The year input, the Show Inactive checkbox, the sort
    // controls, and the specialisations popover appear only in
    // Teams mode. The other modes have their own controls on
    // their own body.
    //
    // THE NEW CONTROLS (this revision):
    //
    //   #team-sort            <select> of { name, period, members }
    //   #team-sort-direction  direction toggle button
    //   #team-specialisations-toggle
    //                         popover trigger button
    //   #team-specialisations-panel
    //                         hidden popover panel with one
    //                         checkbox per specialisation id
    //
    // The popover's `hidden` attribute is the renderer's concern;
    // TeamEvents owns opening and closing it. Emitting the panel
    // with `hidden` means a fresh render always starts closed,
    // which is the correct default.

    function renderFilterBar(filterVM) {
        if (!filterVM || !filterVM.tab) { return ''; }

        var tab = filterVM.tab;
        var periodLabel = filterVM.periodLabel || 'Year';
        var yearValue = filterVM.filterYear !== undefined &&
                        filterVM.filterYear !== null
            ? filterVM.filterYear
            : '';
        var showInactive = filterVM.showInactive === true;

        var html = '';

        if (tab === 'professional') {
            var viewMode = filterVM.viewMode || 'teams';
            var isPool = viewMode === 'pool';
            var isTimeline = viewMode === 'timeline';
            var isRankings = viewMode === 'rankings';

            html += '<div class="filter-row filter-row-professional">';

            html += '<div class="mode-toggle" role="tablist">';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (viewMode === 'teams' ? ' active' : '') +
                        '" ' +
                        'data-mode="teams" ' +
                        'role="tab" ' +
                        'aria-controls="team-list-container" ' +
                        'aria-selected="' +
                            (viewMode === 'teams' ? 'true' : 'false') +
                        '">Teams</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (isPool ? ' active' : '') +
                        '" ' +
                        'data-mode="pool" ' +
                        'role="tab" ' +
                        'aria-controls="team-list-container" ' +
                        'aria-selected="' +
                            (isPool ? 'true' : 'false') +
                        '">Professional Pool</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (isTimeline ? ' active' : '') +
                        '" ' +
                        'data-mode="timeline" ' +
                        'role="tab" ' +
                        'aria-controls="team-list-container" ' +
                        'aria-selected="' +
                            (isTimeline ? 'true' : 'false') +
                        '">Timeline</button>';
            html += '<button type="button" ' +
                        'class="mode-btn' +
                            (isRankings ? ' active' : '') +
                        '" ' +
                        'data-mode="rankings" ' +
                        'role="tab" ' +
                        'aria-controls="team-list-container" ' +
                        'aria-selected="' +
                            (isRankings ? 'true' : 'false') +
                        '">Rankings</button>';
            html += '</div>';

            if (viewMode === 'teams') {
                html += renderTeamsModeFilterControls(
                    tab, periodLabel, yearValue, showInactive,
                    filterVM
                );
            }

            html += '</div>';
            return html;
        }

        html += '<div class="filter-row">';
        html += '<div class="filter-group">';
        html += '<label for="civilian-show-inactive">' +
                    'Show Inactive:' +
                '</label>';
        html += '<input type="checkbox" ' +
                    'id="civilian-show-inactive"' +
                    (showInactive ? ' checked' : '') +
                '>';
        html += '</div>';
        html += '<button type="button" id="apply-filter-btn" ' +
                    'class="small primary">Apply</button>';
        html += '</div>';

        return html;
    }

    /**
     * The Teams-mode filter controls: year input, show-inactive,
     * sort select, sort direction toggle, specialisations
     * popover trigger + panel, and Apply. Split out from
     * renderFilterBar so the professional branch stays readable.
     */
    function renderTeamsModeFilterControls(
        tab, periodLabel, yearValue, showInactive, filterVM
    ) {
        var html = '';

        // ---- Year ----
        html += '<div class="filter-group">';
        html += '<label for="team-filter-year">' +
                    escapeHtml(periodLabel) + ':' +
                '</label>';
        html += '<input type="number" id="team-filter-year" ' +
                    'value="' +
                        escapeAttribute(safeString(yearValue)) +
                    '" placeholder="All">';
        html += '</div>';

        // ---- Show Inactive ----
        html += '<div class="filter-group">';
        html += '<label for="' + escapeAttribute(tab) +
                    '-show-inactive">Show Inactive:</label>';
        html += '<input type="checkbox" id="' +
                    escapeAttribute(tab) + '-show-inactive"' +
                    (showInactive ? ' checked' : '') +
                '>';
        html += '</div>';

        // ---- Sort key ----
        html += '<div class="filter-group">';
        html += '<label for="team-sort">Sort:</label>';
        html += '<select id="team-sort" class="team-sort-select">';
        var sortOptions = isArray(filterVM.sortOptions)
            ? filterVM.sortOptions
            : [
                { id: 'name', label: 'Name' },
                { id: 'period', label: 'Period' },
                { id: 'members', label: 'Members' }
            ];
        var currentSort = isNonEmptyString(filterVM.sort)
            ? filterVM.sort
            : 'name';
        for (var s = 0; s < sortOptions.length; s++) {
            var opt = sortOptions[s];
            if (!opt || !isNonEmptyString(opt.id)) { continue; }
            var isSel = opt.id === currentSort;
            html += '<option value="' +
                        escapeAttribute(opt.id) + '"' +
                        (isSel ? ' selected' : '') + '>' +
                        escapeHtml(opt.label || opt.id) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Sort direction toggle ----
        var sortDirection = filterVM.sortDirection === 'desc'
            ? 'desc'
            : 'asc';
        var arrow = sortDirection === 'desc'
            ? '\u25bc'  // black down-pointing triangle
            : '\u25b2'; // black up-pointing triangle
        var nextDirection = sortDirection === 'desc' ? 'asc' : 'desc';
        var directionLabel = sortDirection === 'desc'
            ? 'Sort descending (click to switch to ascending)'
            : 'Sort ascending (click to switch to descending)';

        html += '<div class="filter-group">';
        html += '<label for="team-sort-direction">' +
                    'Direction:' +
                '</label>';
        html += '<button type="button" ' +
                    'id="team-sort-direction" ' +
                    'class="small team-sort-direction-btn" ' +
                    'data-direction="' +
                        escapeAttribute(sortDirection) + '" ' +
                    'data-next-direction="' +
                        escapeAttribute(nextDirection) + '" ' +
                    'title="' +
                        escapeAttribute(directionLabel) + '" ' +
                    'aria-label="' +
                        escapeAttribute(directionLabel) + '">' +
                    arrow +
                '</button>';
        html += '</div>';

        // ---- Specialisations popover trigger + panel ----
        //
        // The trigger's label reflects the current selection
        // count. The panel is rendered with the `hidden`
        // attribute; TeamEvents owns opening and closing it.
        var specCount = filterVM.selectedSpecialisationCount;
        if (typeof specCount !== 'number' || !isFinite(specCount)) {
            specCount = isArray(filterVM.specialisationIds)
                ? filterVM.specialisationIds.length
                : 0;
        }
        var hasFilter = specCount > 0;

        html += '<div class="filter-group team-specialisations-group">';
        html += '<label>Specialisations:</label>';
        html += '<button type="button" ' +
                    'id="team-specialisations-toggle" ' +
                    'class="small team-specialisations-btn' +
                        (hasFilter ? ' has-filter' : '') + '" ' +
                    'aria-haspopup="true" ' +
                    'aria-expanded="false" ' +
                    'title="Filter by specialisation">' +
                    'Specialisations' +
                    (hasFilter ? ' (' + specCount + ')' : '') +
                '</button>';
        html += renderSpecialisationsPanel(filterVM);
        html += '</div>';

        // ---- Apply ----
        html += '<button type="button" id="apply-filter-btn" ' +
                    'class="small primary">Apply</button>';

        return html;
    }

    /**
     * The popover panel for the specialisations filter.
     *
     * Rendered with the `hidden` attribute so a fresh render
     * always starts closed. Each entry is a checkbox whose value
     * is the mission-type id; checked when the id appears in
     * filterVM.specialisationIds. A "Clear" link at the bottom
     * clears the selection (TeamEvents handles the click).
     *
     * When the vocabulary is empty (MissionConstants not loaded),
     * the panel is not emitted at all; the trigger is still
     * emitted, but clicking it will do nothing because there is
     * no panel to open. That is the correct degradation: no
     * vocabulary, no filter.
     */
    function renderSpecialisationsPanel(filterVM) {
        var options = isArray(filterVM.specialisationOptions)
            ? filterVM.specialisationOptions
            : [];

        if (options.length === 0) { return ''; }

        var selectedIds = isArray(filterVM.specialisationIds)
            ? filterVM.specialisationIds
            : [];

        var selectedSet = Object.create(null);
        for (var i = 0; i < selectedIds.length; i++) {
            if (isNonEmptyString(selectedIds[i])) {
                selectedSet[selectedIds[i]] = true;
            }
        }

        var html = '';
        html += '<div id="team-specialisations-panel" ' +
                    'class="team-specialisations-panel" ' +
                    'role="dialog" ' +
                    'aria-label="Filter by specialisation" ' +
                    'hidden>';

        html += '<div class="team-specialisations-panel-header">' +
                    'Filter by specialisation' +
                '</div>';

        html += '<div class="team-specialisations-list">';
        for (var j = 0; j < options.length; j++) {
            var opt = options[j];
            if (!opt || !isNonEmptyString(opt.id)) { continue; }
            var isChecked =
                selectedSet[opt.id] === true;
            html += '<label class="team-specialisations-row">';
            html += '<input type="checkbox" ' +
                        'class="team-specialisation-checkbox" ' +
                        'value="' +
                            escapeAttribute(opt.id) + '"' +
                        (isChecked ? ' checked' : '') + '>';
            html += '<span class="team-specialisations-row-label">' +
                        escapeHtml(opt.label || opt.id) +
                    '</span>';
            html += '</label>';
        }
        html += '</div>';

        html += '<div class="team-specialisations-panel-footer">';
        html += '<button type="button" ' +
                    'id="team-specialisations-clear" ' +
                    'class="small secondary team-specialisations-clear">' +
                    'Clear' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // RANKING LIST (per-team modal)
    // ============================================================

    function renderRankingList(rankVM) {
        if (!rankVM ||
            !Array.isArray(rankVM.history) ||
            rankVM.history.length === 0) {
            return '<p class="empty-state">No ranking history</p>';
        }

        var rangeByPeriod = Object.create(null);
        if (Array.isArray(rankVM.historyWithRanges)) {
            for (var r = 0; r < rankVM.historyWithRanges.length; r++) {
                var rw = rankVM.historyWithRanges[r];
                if (!rw || !rw.period) { continue; }
                rangeByPeriod[String(rw.period)] = rw;
            }
        }

        var html = '';

        for (var i = 0; i < rankVM.history.length; i++) {
            var entry = rankVM.history[i];
            if (!entry) { continue; }

            var periodStr = String(entry.period);
            var rangeEntry = rangeByPeriod[periodStr];

            var governsText = '';
            if (rangeEntry) {
                var from = rangeEntry.governsFrom;
                var to = rangeEntry.governsTo;
                if (to === null || to === undefined) {
                    governsText = 'governs ' + from +
                        '\u2013present';
                } else if (to === from + 1) {
                    governsText = 'governs ' + from + ' only';
                } else {
                    governsText = 'governs ' + from +
                        '\u2013' + (to - 1);
                }
            }

            html += '<div class="ranking-entry">';

            html += '<div class="ranking-entry-main">';
            html += '<span class="ranking-entry-text">' +
                        'Period: <strong>' +
                        escapeHtml(periodStr) +
                        '</strong> \u2192 Rank: <strong>#' +
                        escapeHtml(String(entry.rank)) +
                        '</strong>' +
                    '</span>';
            html += '<button type="button" ' +
                        'class="small danger remove-ranking" ' +
                        'data-period="' +
                            escapeAttribute(periodStr) + '">' +
                        '\u2715' +
                    '</button>';
            html += '</div>';

            if (governsText !== '') {
                html += '<div class="ranking-entry-governs">' +
                            escapeHtml(governsText) +
                        '</div>';
            }

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

        // ---- Top-of-form name (dirty-track baseline) ----
        html += '<div class="form-group full-width">';
        html += '<label for="team-name">Current Name *</label>';
        html += '<input type="text" id="team-name" ' +
                    'value="' +
                        escapeAttribute(formVM.name) + '" ' +
                    'data-original-value="' +
                        escapeAttribute(formVM.name) + '" ' +
                    'required>';
        html += '<span class="field-hint">' +
                    'The current period\u2019s name. Editing here ' +
                    'renames the current period. If you rename ' +
                    'the last period in the editor below and ' +
                    'leave this field untouched, the editor wins.' +
                '</span>';
        html += '</div>';

        // ---- Team type (with current-type-in-list fix) ----
        html += '<div class="form-group">';
        html += '<label for="team-type">Team Type *</label>';
        html += '<select id="team-type" required>' +
                    typeOptions +
                '</select>';
        html += renderTypeHint(formVM.type);
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

        // ---- Periods editor ----
        html += renderPeriodsEditor(formVM);

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

    function renderTypeHint(rawCurrentType) {
        var normalised = normaliseTeamTypeForDisplay(rawCurrentType);
        if (normalised === '') { return ''; }

        var offered = getFormTeamTypes();
        var inList = false;
        for (var i = 0; i < offered.length; i++) {
            if (offered[i].id === normalised) {
                inList = true;
                break;
            }
        }
        if (inList) { return ''; }

        var hintText;
        if (normalised === 'academic') {
            hintText =
                'This team\u2019s type is academic; changing it ' +
                'here would move it to the Teams module\u2019s ' +
                'scope. Edit academic teams through the Academy ' +
                'module.';
        } else {
            hintText =
                'This team\u2019s stored type (\u201c' +
                escapeHtml(normalised) +
                '\u201d) is not one of the types offered here. ' +
                'Pick a type to replace it, or leave it as-is.';
        }

        return '<span class="field-hint">' +
                    hintText +
                '</span>';
    }

    // ============================================================
    // PERIODS EDITOR
    // ============================================================

    function renderPeriodsEditor(formVM) {
        var periods = isArray(formVM.periods)
            ? formVM.periods
            : [];
        var options = isArray(formVM.specialisationOptions)
            ? formVM.specialisationOptions
            : [];

        var canRemove = periods.length > 1;

        var html = '';
        html += '<div class="form-group full-width team-periods-editor">';

        html += '<label>Periods</label>';
        html += '<p class="field-hint">' +
                    'Each period describes the team for a range of ' +
                    'years. Leave the last period\u2019s end year ' +
                    'blank if the team is still ongoing; set it to ' +
                    'close the team at that year.' +
                '</p>';

        html += '<div id="team-periods-list" class="team-periods-list">';

        for (var i = 0; i < periods.length; i++) {
            var isLast = (i === periods.length - 1);
            html += renderPeriodRow(
                periods[i], i, isLast, options, canRemove
            );
        }

        html += '</div>';

        html += '<button type="button" id="add-team-period-btn" ' +
                    'class="small add-team-period-btn">' +
                    '+ New Period' +
                '</button>';

        html += '</div>';
        return html;
    }

    /**
     * Render one period row.
     *
     * This is the SINGLE canonical renderer for a period row.
     * TeamEvents calls it both during initial render (via
     * renderPeriodsEditor) and during the append path (via
     * buildNewPeriodRowHTML). Any change to the row's markup
     * belongs here, not in the append helper.
     *
     * The end input is EDITABLE on every row, including the
     * last. A blank end on the last row means the team is
     * still ongoing; a non-blank end means the team disbanded
     * at that year. The `isLast` parameter is preserved for
     * the caller's own use (TeamEvents passes it when
     * appending) but is not consulted by this function.
     *
     * The row label is plain "Period N" for every row. The
     * "(current)" suffix is gone; the last row is identified by
     * its position in the list, not by a label.
     *
     * @param {object} period  A display-shaped period entry:
     *   { startPeriod, endPeriod, name, tacticalStyle,
     *     specialisations: [{ id, label }] }
     * @param {number} index   0-based position in the list.
     * @param {boolean} isLast  True for the last row. Preserved
     *   in the contract for caller convenience; NOT used here.
     * @param {array} options  The full specialisation vocabulary.
     * @param {boolean} canRemove True when the row should carry
     *   a remove button. The initial render passes
     *   `periods.length > 1`; TeamEvents passes `false` when
     *   appending and reveals the button via
     *   updateRemoveButtons() once there is more than one.
     * @returns {string} HTML for one `.team-period-row`.
     */
    function renderPeriodRow(
        period, index, isLast, options, canRemove
    ) {
        period = period || {};
        options = isArray(options) ? options : [];
        canRemove = canRemove === true;

        var start = isNonEmptyString(period.startPeriod)
            ? String(period.startPeriod)
            : '';
        var end = isNonEmptyString(period.endPeriod)
            ? String(period.endPeriod)
            : '';
        var name = isNonEmptyString(period.name)
            ? String(period.name)
            : '';
        var style = isNonEmptyString(period.tacticalStyle)
            ? String(period.tacticalStyle)
            : '';

        // The label is plain "Period N" for every row. `isLast`
        // is intentionally not consulted. See the block comment.
        var headerLabel = 'Period ' + (index + 1);

        var html = '';
        html += '<div class="team-period-row" ' +
                    'data-period-index="' +
                        escapeAttribute(String(index)) + '">';

        // ---- Header ----
        html += '<div class="team-period-row-header">';
        html += '<span class="team-period-row-label">' +
                    escapeHtml(headerLabel) +
                '</span>';
        if (canRemove) {
            html += '<button type="button" ' +
                        'class="small danger team-period-remove" ' +
                        'data-period-index="' +
                            escapeAttribute(String(index)) + '" ' +
                        'title="Remove this period">' +
                        '\u2715' +
                    '</button>';
        }
        html += '</div>';

        // ---- Name / Start / End ----
        html += '<div class="team-period-row-fields">';

        html += '<div class="team-period-field team-period-field-name">';
        html += '<label class="team-period-field-label">Name</label>';
        html += '<input type="text" ' +
                    'class="team-period-name" ' +
                    'value="' + escapeAttribute(name) + '" ' +
                    'placeholder="e.g., Rapid">';
        html += '</div>';

        html += '<div class="team-period-field team-period-field-start">';
        html += '<label class="team-period-field-label">Start</label>';
        html += '<input type="number" ' +
                    'class="team-period-start" ' +
                    'min="1" ' +
                    'value="' + escapeAttribute(start) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        // ---- End: EDITABLE on every row. ----
        //
        // A blank value means "unbounded on this side". For the
        // last row, that means the team is still ongoing. For a
        // non-last row, the user must fill it in before saving
        // (enforced by collectPeriodsFromForm in team-events.js).
        html += '<div class="team-period-field team-period-field-end">';
        html += '<label class="team-period-field-label">End</label>';
        html += '<input type="number" ' +
                    'class="team-period-end" ' +
                    'min="1" ' +
                    'value="' + escapeAttribute(end) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        html += '</div>'; // row-fields

        // ---- Tactical style ----
        html += '<div class="team-period-tactical-style-row">';
        html += '<label class="team-period-field-label">' +
                    'Tactical Style' +
                '</label>';
        html += '<textarea class="team-period-style" ' +
                    'rows="3" ' +
                    'placeholder="How the team works together. ' +
                    'Fighting style, doctrine, tone.">' +
                    escapeHtml(style) +
                '</textarea>';
        html += '</div>';

        // ---- Specialisations ----
        html += renderPeriodSpecialisationsRow(
            period, index, options
        );

        html += '</div>'; // team-period-row

        return html;
    }

    function renderPeriodSpecialisationsRow(period, index, options) {
        var selectedIds = isArray(period.specialisations)
            ? period.specialisations
            : [];

        var currentIds = [];
        var currentLabels = Object.create(null);
        var labelById = Object.create(null);

        for (var i = 0; i < selectedIds.length; i++) {
            var entry = selectedIds[i];
            if (!entry) { continue; }
            if (typeof entry === 'string') {
                var idStr = entry.trim();
                if (idStr === '') { continue; }
                currentIds.push(idStr);
                currentLabels[idStr] = idStr;
            } else if (isNonEmptyString(entry.id)) {
                var idObj = String(entry.id);
                currentIds.push(idObj);
                currentLabels[idObj] = isNonEmptyString(entry.label)
                    ? String(entry.label)
                    : idObj;
            }
        }

        for (var o = 0; o < options.length; o++) {
            var opt = options[o];
            if (!opt || !isNonEmptyString(opt.id)) { continue; }
            labelById[opt.id] = isNonEmptyString(opt.label)
                ? String(opt.label)
                : opt.id;
        }

        var selectedSet = Object.create(null);
        for (var s = 0; s < currentIds.length; s++) {
            selectedSet[currentIds[s]] = true;
        }

        var available = [];
        for (var a = 0; a < options.length; a++) {
            var candidate = options[a];
            if (!candidate || !isNonEmptyString(candidate.id)) {
                continue;
            }
            if (selectedSet[candidate.id] === true) { continue; }
            available.push(candidate);
        }

        var html = '';
        html += '<div class="team-period-specialisations-row">';
        html += '<label class="team-period-field-label">' +
                    'Specialisations' +
                '</label>';

        html += '<div class="team-period-specialisation-input-group">';
        html += '<select class="team-period-specialisation-select"' +
                    (available.length === 0 ? ' disabled' : '') + '>';

        if (available.length === 0) {
            var placeholderText = options.length === 0
                ? 'No specialisations available'
                : 'All specialisations already selected';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholderText) +
                    '</option>';
        } else {
            html += '<option value="">Select...</option>';
            for (var av = 0; av < available.length; av++) {
                var avail = available[av];
                html += '<option value="' +
                            escapeAttribute(avail.id) + '">' +
                            escapeHtml(avail.label) +
                        '</option>';
            }
        }

        html += '</select>';
        html += '<button type="button" ' +
                    'class="small primary ' +
                    'team-period-specialisation-add"' +
                    (available.length === 0 ? ' disabled' : '') + '>' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div class="team-period-specialisation-chips">';

        if (currentIds.length === 0) {
            html += '<p class="empty-state small">' +
                        'No specialisations selected.' +
                    '</p>';
        } else {
            for (var c = 0; c < currentIds.length; c++) {
                var id = currentIds[c];
                var label = currentLabels[id] || labelById[id] || id;
                html += renderSpecialisationChip(id, label);
            }
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderSpecialisationChip(id, label) {
        var html = '';
        html += '<div class="team-specialisation-chip" ' +
                    'data-specialisation-id="' +
                        escapeAttribute(id) + '">';
        html += '<span class="team-specialisation-chip-name">' +
                    escapeHtml(label) +
                '</span>';
        html += '<button type="button" class="small danger ' +
                    'team-specialisation-remove" ' +
                    'data-specialisation-id="' +
                        escapeAttribute(id) + '">' +
                    '\u2715' +
                '</button>';
        html += '</div>';
        return html;
    }

    function renderTypeOptions(currentType) {
        var normalised = normaliseTeamTypeForDisplay(currentType);
        var types = getFormTeamTypes();
        var html = '';

        var inList = false;
        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            var selected = normalised === type.id
                ? ' selected'
                : '';
            if (normalised === type.id) { inList = true; }
            html += '<option value="' +
                        escapeAttribute(type.id) + '"' +
                        selected + '>' +
                        escapeHtml(type.label) +
                    '</option>';
        }

        if (!inList && normalised !== '') {
            var displayLabel = normalised;
            var typeRecord = TeamConstants.getTeamType(normalised);
            if (typeRecord && isNonEmptyString(typeRecord.label)) {
                displayLabel = typeRecord.label;
            }
            html += '<option value="' +
                        escapeAttribute(normalised) + '" ' +
                        'selected disabled>' +
                        escapeHtml(displayLabel) +
                        ' (current; not editable here)' +
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

    // ============================================================
    // RANKING FORM
    // ============================================================

    function renderRankingForm() {
        var html = '';
        html += '<form id="ranking-form-inner">';
        html += '<div class="ranking-form">';
        html += '<input type="text" id="ranking-period" ' +
                    'class="ranking-period-input" ' +
                    'inputmode="numeric" ' +
                    'pattern="[0-9]+" ' +
                    'title="Period must be a positive integer." ' +
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
    //
    // The page shell. Dispatches to the body renderer for the
    // current mode. The four modes:
    //
    //   teams     the list, with the expanded team inline
    //   pool      the Professional Pool
    //   timeline  the year-by-year event timeline (delegated)
    //   rankings  the ranking table (delegated)
    //
    // SORT AND DIRECTION THREADING (this revision):
    // pageVM carries sort and sortDirection from
    // getTeamPageViewModel's options; renderList needs them so
    // the header row can show the current sort indicator. The
    // renderer does not recompute or re-sort; it just draws the
    // header label from the state.

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
        var poolExpandedIds = pageVM.poolExpandedIds ||
            Object.create(null);
        var poolSelectedIds = pageVM.poolSelectedIds ||
            Object.create(null);
        var teamSelectedIds = pageVM.teamSelectedIds ||
            Object.create(null);

        // Sort state, threaded to the list header.
        var sort = isNonEmptyString(pageVM.sort)
            ? pageVM.sort
            : 'name';
        var sortDirection = pageVM.sortDirection === 'desc'
            ? 'desc'
            : 'asc';

        var isPool = activeTab === 'professional' &&
            viewMode === 'pool';
        var isTimeline = activeTab === 'professional' &&
            viewMode === 'timeline';
        var isRankings = activeTab === 'professional' &&
            viewMode === 'rankings';

        var expandedMembersVM = null;
        if (expandedTeam && Array.isArray(expandedTeam.members)) {
            expandedMembersVM = {
                teamId: expandedTeam.id,
                periodLabel: expandedTeam.periodLabel || 'Period',
                period: period,
                members: expandedTeam.members,
                team: expandedTeam
            };
        }

        var html = '';

        var selectedCount = countTrue(teamSelectedIds);

        // ---- Page header ----
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<div class="page-header-actions">';

        if (activeTab === 'professional') {
            html += '<button type="button" ' +
                        'id="team-export-btn" ' +
                        'class="secondary"' +
                        (selectedCount === 0 ? ' disabled' : '') + '>' +
                        'Export' +
                        (selectedCount > 0
                            ? ' (' + selectedCount + ')'
                            : '') +
                    '</button>';
            html += '<button type="button" ' +
                        'id="team-matchmaking-btn" ' +
                        'class="secondary">Matchmaking</button>';
        } else {
            html += '<button type="button" ' +
                        'id="team-export-btn" ' +
                        'class="secondary"' +
                        (selectedCount === 0 ? ' disabled' : '') + '>' +
                        'Export' +
                        (selectedCount > 0
                            ? ' (' + selectedCount + ')'
                            : '') +
                    '</button>';
        }

        html += '<button type="button" id="add-team-btn" ' +
                    'class="primary">+ Add Team</button>';
        html += '</div>';
        html += '</div>';

        // ---- Stats, tab nav, filter bar ----
        html += renderStats(counts);
        html += renderTabNav(activeTab, counts);
        html += '<div id="filter-container" ' +
                    'class="filter-container"></div>';

        // ---- Body ----
        var bodyClass = 'team-list-container';
        if (isTimeline) { bodyClass += ' timeline-container'; }
        if (isRankings) { bodyClass += ' rankings-container'; }

        html += '<div id="team-list-container" ' +
                    'class="' + bodyClass + '" ' +
                    'role="tabpanel">';

        if (isRankings) {
            html += renderRankingsContent(pageVM);
        } else if (isTimeline) {
            html += renderTimelineContent(pageVM);
        } else if (isPool) {
            html += renderProfessionalPool(
                poolVM,
                poolExpandedIds,
                poolSelectedIds
            );
        } else {
            html += renderList(teams, {
                type: activeTab,
                expandedTeamId: expandedTeamId,
                expandedMembersVM: expandedMembersVM,
                selectedIds: teamSelectedIds,
                sort: sort,
                sortDirection: sortDirection
            });
        }

        html += '</div>';

        return html;
    }

    function countTrue(obj) {
        if (!obj) { return 0; }
        var n = 0;
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) &&
                obj[k] === true) {
                n++;
            }
        }
        return n;
    }

    function renderStats(counts) {
        var html = '';
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3>' +
                    '<p class="stat-number">' +
                        renderCount(counts.professional) +
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

        // Public API: single canonical renderer for a period row.
        // TeamEvents delegates to this when appending a new row.
        renderPeriodRow: renderPeriodRow
    });

})();
