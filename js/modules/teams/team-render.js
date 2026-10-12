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
 *   - Modals: team form, ranking form/list.
 *   - The PERIODS editor: one row per period, each carrying its
 *     own name, start / end, tactical style, and specialisations.
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
 *   list.
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
 *   Each entry renders as one row in the periods editor. The
 *   renderer emits:
 *
 *     .team-period-row[data-period-index="N"]
 *       .team-period-row-header       (label + remove button)
 *       input.team-period-name        (name)
 *       input.team-period-start       (start year)
 *       input.team-period-end         (end year; disabled on the
 *                                      last row, which is the
 *                                      open-ended current period)
 *       textarea.team-period-style    (tactical style)
 *       .team-period-specialisations  (chip list, one per
 *                                      specialisation)
 *       .team-period-specialisation-add-row
 *                                     (select + Add button for
 *                                      the current row)
 *
 *   The remove button carries data-period-index. The remove
 *   button is omitted on the first row when there is only one
 *   period; a team must always have at least one.
 *
 *   The end year input on the last row is disabled AND read-only:
 *   the open-ended sentinel is a fact about the model, not a
 *   value the user picks. The renderer sets value="" on that
 *   input. TeamEvents reads the empty value as '' when
 *   collecting.
 *
 *   On a create form, the VM synthesises a single period seeded
 *   with the current calendar year. The user sees one editable
 *   row and no history. On edit, every stored period renders.
 *
 * LEGACY SHAPE:
 *   The read-only descriptive block reads `team.tacticalStyle` and
 *   `team.specialisations` off the detail / list VM. Those are
 *   populated by TeamAggregator from the current period when
 *   periods exist, and from the legacy scalars otherwise. This
 *   module does not touch nameHistory or any legacy field.
 *
 * TAB VOCABULARY:
 *   The Teams tab renders two top-level tabs:
 *     professional | civilian
 *
 * PAGE HEADER ACTIONS:
 *   Export / Matchmaking / Add Team appear on the Professional tab.
 *   Civilian shows Add Team and Export.
 *
 *   The Export button is a BULK export: it exports every team the
 *   user has ticked in the list below, into a single file. It is
 *   disabled when nothing is selected. The per-row Export button
 *   on each team row remains a single-team export.
 *
 * TEAM SELECTION:
 *   Each team row carries a checkbox at the leading edge. State is
 *   held by TeamEvents as a Set of teamIds and passed in as
 *   `selectedIds` on the render options.
 *
 * TEAM ROW ACTIONS:
 *   The row action strip carries a Kill Team button between
 *   Export and Edit.
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
    // DESCRIPTIVE FIELDS (read-only)
    // ============================================================
    //
    // Rendered in two places:
    //
    //   .team-members-expanded      when a row is expanded
    //   .team-card                  a card-layout caller
    //
    // Reads `team.tacticalStyle` and `team.specialisations` off
    // the VM. Those fields are populated by TeamAggregator from
    // the current period (or the legacy scalars, pre-migration).
    //
    // The block renders:
    //
    //   Tactical Style: <value>
    //   Specialisations: <label>, <label>, ...
    //   Periods: <list>            (only when > 1 period)
    //
    // Either row is omitted when its field is empty. When both
    // are empty AND there is only one period, the whole block is
    // omitted.

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
    // TEAM LIST
    // ============================================================

    function renderList(teams, options) {
        options = options || {};
        var type = options.type || 'professional';
        var expandedTeamId = options.expandedTeamId || null;
        var expandedMembersVM = options.expandedMembersVM || null;
        var selectedIds = options.selectedIds || Object.create(null);

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

            var isSelected =
                selectedIds[String(team.id)] === true;

            var rowClass = 'list-item team-item';
            if (team.isActive === false) {
                rowClass += ' inactive';
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

        if (membersVM.team) {
            html += renderDescriptiveFields(membersVM.team);
        }

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
    //
    // The form carries the top-level team scalars (name, type,
    // start, end, class, team number, status, associated mission)
    // and the periods editor.
    //
    // The top-level name is the CURRENT period's name. It is
    // rendered as an editable field for convenience — a user who
    // only wants to rename the current period does not have to
    // scroll to the editor. The team name input writes through to
    // the last period on submit. See team-events.js for the read.
    //
    // The top-level start / end inputs are NOT rendered: the
    // team's start and end are derived from periods[0].start and
    // periods[last].end. The periods editor owns them. Two
    // separate places to edit the same value would be a bug
    // factory.
    //
    // The periods editor is the sole owner of start and end for
    // any period.

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

        html += '<div class="form-group full-width">';
        html += '<label for="team-name">Current Name *</label>';
        html += '<input type="text" id="team-name" value="' +
                    escapeAttribute(formVM.name) + '" required>';
        html += '<span class="field-hint">' +
                    'The current period\u2019s name. Editing here ' +
                    'renames the current period.' +
                '</span>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-type">Team Type *</label>';
        html += '<select id="team-type" required>' +
                    typeOptions +
                '</select>';
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

    // ============================================================
    // PERIODS EDITOR
    // ============================================================
    //
    // One row per period. Each row carries:
    //
    //   name             text input
    //   start            number input
    //   end              number input (disabled on the last row)
    //   tacticalStyle    textarea
    //   specialisations  chip list, with a select + Add button
    //
    // The row is keyed by data-period-index. TeamEvents reads
    // every row's fields on submit. Chip add / remove are
    // DOM-only edits within the row; nothing hits the store until
    // submit.

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
                    'years. The last period is the team\u2019s ' +
                    'present; its end year is open.' +
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

    function renderPeriodRow(period, index, isLast, options, canRemove) {
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

        var headerLabel;
        if (isLast) {
            headerLabel = 'Period ' + (index + 1) + ' (current)';
        } else {
            headerLabel = 'Period ' + (index + 1);
        }

        var html = '';
        html += '<div class="team-period-row" ' +
                    'data-period-index="' +
                        escapeAttribute(String(index)) + '" ' +
                    'data-is-last="' + (isLast ? 'true' : 'false') + '">';

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

        html += '<div class="team-period-field team-period-field-end">';
        html += '<label class="team-period-field-label">End</label>';
        if (isLast) {
            html += '<input type="text" ' +
                        'class="team-period-end" ' +
                        'value="" ' +
                        'placeholder="present" ' +
                        'readonly disabled>';
            html += '<span class="team-period-field-hint">' +
                        '(open)' +
                    '</span>';
        } else {
            html += '<input type="number" ' +
                        'class="team-period-end" ' +
                        'min="1" ' +
                        'value="' + escapeAttribute(end) + '" ' +
                        'placeholder="Year">';
        }
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

        // Normalise: entries may be strings or { id, label } refs.
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

        // Options still selectable in this row.
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
        var poolExpandedIds = pageVM.poolExpandedIds ||
            Object.create(null);
        var poolSelectedIds = pageVM.poolSelectedIds ||
            Object.create(null);
        var teamSelectedIds = pageVM.teamSelectedIds ||
            Object.create(null);

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
                members: expandedTeam.members,
                team: expandedTeam
            };
        }

        var html = '';

        var selectedCount = countTrue(teamSelectedIds);

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

        html += renderStats(counts);
        html += renderTabNav(activeTab, counts);
        html += '<div id="filter-container" ' +
                    'class="filter-container"></div>';

        html += '<div id="team-list-container" ' +
                    'class="team-list-container' +
                    (isTimeline ? ' timeline-container' : '') +
                    '">';

        if (isTimeline) {
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
                selectedIds: teamSelectedIds
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
        renderRankingForm: renderRankingForm
    });

})();
