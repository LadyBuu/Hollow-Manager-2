/**
 * modules/teams/team-matchmaking-view.js - Team Matchmaking View
 * Modal renderer for the Team Matchmaking planner.
 *
 * Path: js/modules/teams/team-matchmaking-view.js
 *
 * RESPONSIBILITIES:
 *   - Render the planner modal as a MATRIX.
 *   - Column headers: one per understaffed team, showing the
 *     team name, its active-window at the planning year, and its
 *     current/required member count.
 *   - Row headers: one per candidate, showing the candidate's
 *     name, age, and availability window.
 *   - Intersection cells: a radio button. At most one team per
 *     candidate can be selected (radio group scoped per
 *     candidate).
 *   - Under each candidate whose row has a checked radio, render
 *     a DETAILS STRIP with the Join and Leave inputs for that one
 *     team. The strip moves as the selection changes.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Event binding. TeamEvents owns it.
 *   - Planner state. Stored on the modal's DOM element.
 *   - Domain reads. Every field arrives on the view model.
 *   - Eligibility. TeamQueries owns it.
 *   - Mutations. TeamCore owns it.
 *   - Shortage history computation. TeamQueries
 *     .getTeamShortagePeriods owns it; this view only renders the
 *     display string that TeamAggregator placed on each team row.
 *
 * PLANNER VM SHAPE:
 *   {
 *     period: number,
 *     targetSize: number,
 *     teams: [
 *       {
 *         teamId, teamName,
 *         memberCount, targetSize, remainingCapacity,
 *         periodDisplay,
 *         members: [ ... ],      // present but not used by matrix
 *         shortagePeriods: [ { from, to } ],
 *         shortageDisplay: string
 *       }
 *     ],
 *     candidates: [
 *       {
 *         characterId, displayName, ageDisplay,
 *         statusAtPeriod,
 *         availability: { from, to, display },
 *         assignment: { status, display },
 *         availabilityBucket: 'available' | 'outside' | 'unknown',
 *         history: { hasProfessionalHistory, formerTeamCount }
 *       }
 *     ]
 *   }
 *
 * LAYOUT:
 *   The matrix scrolls both ways. Column headers stick to the
 *   top; row headers stick to the left. This is what makes a
 *   wide matrix usable — you can scroll to a candidate at the
 *   bottom and still see which column is which team.
 *
 *   A sticky header row/column needs `position: sticky` on each
 *   header cell, and the scroll container must be the element
 *   with `overflow: auto`. Teams.css owns the sticky rules; the
 *   renderer emits the correct structure.
 *
 * DOM CONTRACT FOR COMMIT:
 *   Each intersection cell emits:
 *
 *     <label class="planner-cell">
 *       <input type="radio"
 *              name="planner-cand-<candidateId>"
 *              class="planner-assoc-radio"
 *              data-team-id="..."
 *              data-character-id="..." />
 *     </label>
 *
 *   The radio group name is scoped per candidate, so at most one
 *   team is checked per candidate. TeamEvents reads every checked
 *   radio and builds one assignment per checked radio.
 *
 *   The details strip emits, once per candidate whose row has a
 *   checked radio:
 *
 *     <div class="planner-row-details"
 *          data-character-id="...">
 *       <span class="planner-row-details-label">Team X:</span>
 *       <input class="planner-assoc-join"
 *              data-team-id="..."
 *              data-character-id="..." />
 *       <span class="planner-row-details-dash">–</span>
 *       <input class="planner-assoc-leave"
 *              data-team-id="..."
 *              data-character-id="..." />
 *     </div>
 *
 *   TeamEvents reads the join/leave inputs by the
 *   (teamId, characterId) pair it took from the checked radio.
 *
 * STAGING MODEL:
 *   The strip renders from values carried on the modal's DOM,
 *   not from a state object in this module. TeamEvents owns the
 *   staging: on radio change, it re-reads the plan, decides
 *   which strip is now visible, and re-renders the strip area
 *   only (not the whole matrix, so the radio keeps focus).
 *
 *   This view is a pure function of the VM. It always emits the
 *   full structure; the swap of the visible strip is handled by
 *   TeamEvents after the initial render.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__teamMatchmakingViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[TeamMatchmakingView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__teamMatchmakingViewLoaded = true;

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

    /**
     * Default join year for a candidate in a given planning year.
     *
     * The rule:
     *   - Start with the planning year.
     *   - If the candidate's availability window opens after the
     *     planning year, use the window's open.
     *   - If the candidate's window closes before the planning
     *     year, use the window's close.
     *
     * This is what makes the strip default to a valid year for
     * the candidate rather than the raw planning year, which
     * could be outside their window.
     */
    function defaultJoinYear(candidate, vm) {
        if (!candidate || !candidate.availability) {
            return String(vm.period);
        }

        var from = candidate.availability.from;
        var to = candidate.availability.to;

        if (from !== null && vm.period < from) {
            return String(from);
        }
        if (to !== null && vm.period > to) {
            return String(to);
        }
        return String(vm.period);
    }

    // ============================================================
    // PLANNER - MATRIX
    // ============================================================

    function renderPlanner(vm) {
        if (!vm) {
            throw new Error(
                '[TeamMatchmakingView] renderPlanner requires a ' +
                'view model.'
            );
        }
        if (!Array.isArray(vm.teams)) {
            throw new Error(
                '[TeamMatchmakingView] Planner VM is missing ' +
                'teams array.'
            );
        }
        if (!Array.isArray(vm.candidates)) {
            throw new Error(
                '[TeamMatchmakingView] Planner VM is missing ' +
                'candidates array.'
            );
        }

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Matchmaking Planner \u2014 Year ' +
                    escapeHtml(String(vm.period)) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="matchmaking-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body planner-body">';

        html += '<p class="planner-summary">' +
                    'Target size: <strong>' +
                        escapeHtml(String(vm.targetSize)) +
                    '</strong>. ' +
                    'Understaffed teams: <strong>' +
                        escapeHtml(String(vm.teams.length)) +
                    '</strong>. ' +
                    'Candidates: <strong>' +
                        escapeHtml(String(vm.candidates.length)) +
                    '</strong>. ' +
                    'Pick one team per candidate; the years below ' +
                    'the row apply to the team you picked.' +
                '</p>';

        if (vm.teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'No understaffed professional teams at ' +
                        'this year. Nothing to plan.' +
                    '</p>';
            html += '<div class="planner-actions">';
            html += '<button type="button" class="secondary" ' +
                        'data-action="matchmaking-close">' +
                        'Close' +
                    '</button>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        if (vm.candidates.length === 0) {
            html += '<p class="empty-state small">' +
                        'No candidates in the professional pool.' +
                    '</p>';
            html += '<div class="planner-actions">';
            html += '<button type="button" class="secondary" ' +
                        'data-action="matchmaking-close">' +
                        'Close' +
                    '</button>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        html += renderMatrix(vm);

        html += '<div class="planner-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="matchmaking-close">' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="matchmaking-commit">' +
                    'Commit Assignments' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // MATRIX
    // ============================================================

    function renderMatrix(vm) {
        var html = '';

        html += '<div class="planner-matrix-wrap">';
        html += '<table class="planner-matrix">';

        html += '<thead>';
        html += '<tr>';

        // Top-left corner cell. Sits above the row-header column
        // and to the left of the team column headers. Empty.
        html += '<th class="planner-matrix-corner" ' +
                    'aria-hidden="true"></th>';

        for (var t = 0; t < vm.teams.length; t++) {
            html += renderTeamHeader(vm.teams[t], vm);
        }

        html += '</tr>';
        html += '</thead>';

        html += '<tbody>';

        for (var c = 0; c < vm.candidates.length; c++) {
            html += renderCandidateRow(vm.candidates[c], vm);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ------------------------------------------------------------
    // Column headers
    // ------------------------------------------------------------

    function renderTeamHeader(team, vm) {
        var html = '';

        html += '<th class="planner-matrix-team-header" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '">';

        html += '<div class="planner-matrix-team-name">' +
                    escapeHtml(team.teamName) +
                '</div>';

        html += '<div class="planner-matrix-team-count">' +
                    escapeHtml(String(team.memberCount)) +
                    ' / ' +
                    escapeHtml(String(team.targetSize)) +
                '</div>';

        if (isNonEmptyString(team.periodDisplay)) {
            html += '<div class="planner-matrix-team-window">' +
                        escapeHtml(team.periodDisplay) +
                    '</div>';
        }

        if (isNonEmptyString(team.shortageDisplay)) {
            html += '<div class="planner-matrix-team-shortage" ' +
                        'title="Years this team has been below ' +
                        'the target size">' +
                        'Short ' +
                        escapeHtml(team.shortageDisplay) +
                    '</div>';
        }

        html += '</th>';
        return html;
    }

    // ------------------------------------------------------------
    // Rows
    // ------------------------------------------------------------

    /**
     * One candidate. The row is a <tr> with:
     *
     *   - a row-header cell (candidate identity + availability)
     *   - one radio cell per team
     *
     * The details strip is a SECOND <tr> immediately below the
     * radio row. It carries colspan spanning the whole table, so
     * it reads as a full-width band. It contains the Join and
     * Leave inputs for the candidate's currently-selected team.
     *
     * The strip is always emitted, but its visibility is
     * controlled by a `hidden` attribute that reflects whether
     * any radio in the row is checked. When nothing is checked,
     * the strip renders with `hidden` and no inputs; TeamEvents
     * fills it in and unhides it when a radio is picked.
     */
    function renderCandidateRow(candidate, vm) {
        var html = '';

        var rowClass = 'planner-matrix-row ' +
            'planner-candidate-' + candidate.availabilityBucket;
        if (candidate.assignment.status === 'active') {
            rowClass += ' planner-candidate-assigned';
        }

        html += '<tr class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">';

        // ---- Row header ----
        html += renderCandidateHeader(candidate, vm);

        // ---- Cells ----
        for (var t = 0; t < vm.teams.length; t++) {
            html += renderCell(candidate, vm.teams[t], vm);
        }

        html += '</tr>';

        // ---- Details strip ----
        html += renderDetailsStrip(candidate, vm);

        return html;
    }

    function renderCandidateHeader(candidate, vm) {
        var html = '';

        html += '<th class="planner-matrix-row-header" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">';

        html += '<div class="planner-matrix-candidate-name">' +
                    escapeHtml(candidate.displayName) +
                '</div>';

        var metaParts = [];
        if (isNonEmptyString(candidate.ageDisplay)) {
            metaParts.push('(' + candidate.ageDisplay + ')');
        }
        if (isNonEmptyString(candidate.statusAtPeriod)) {
            metaParts.push(candidate.statusAtPeriod);
        }

        if (metaParts.length > 0) {
            html += '<div class="planner-matrix-candidate-meta">' +
                        escapeHtml(metaParts.join(' \u00b7 ')) +
                    '</div>';
        }

        if (isNonEmptyString(candidate.availability.display)) {
            html += '<div class="planner-matrix-candidate-window">' +
                        'Available ' +
                        escapeHtml(candidate.availability.display) +
                    '</div>';
        }

        if (isNonEmptyString(candidate.assignment.display) &&
            candidate.assignment.display !== 'Unassigned') {
            html += '<div class="planner-matrix-candidate-assignment">' +
                        escapeHtml(candidate.assignment.display) +
                    '</div>';
        }

        html += '</th>';
        return html;
    }

    // ------------------------------------------------------------
    // Cells
    // ------------------------------------------------------------

    function renderCell(candidate, team, vm) {
        var radioGroupName = 'planner-cand-' +
            String(candidate.characterId);

        // A team at capacity in this view is not possible; the
        // aggregator excludes those from the planner VM. But
        // guard anyway — a stale VM should not produce a
        // selectable cell for a full team.
        var atCapacity = team.memberCount >= team.targetSize;

        var html = '';

        html += '<td class="planner-matrix-cell" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">';

        html += '<label class="planner-cell-label" ' +
                    'title="Assign ' +
                        escapeAttribute(candidate.displayName) +
                        ' to ' + escapeAttribute(team.teamName) +
                    '">';

        html += '<input type="radio" ' +
                    'name="' + escapeAttribute(radioGroupName) + '" ' +
                    'class="planner-assoc-radio" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '"' +
                    (atCapacity ? ' disabled' : '') + '>';

        html += '</label>';

        html += '</td>';
        return html;
    }

    // ------------------------------------------------------------
    // Details strip
    // ------------------------------------------------------------
    //
    // One <tr> per candidate, immediately below the candidate's
    // radio row. Spans the full table width.
    //
    // The strip is rendered with `hidden` and empty content by
    // default. TeamEvents populates it when a radio is picked and
    // hides it again when the selection is cleared.
    //
    // The default-join year is preserved on the strip via a
    // data attribute so TeamEvents has a starting value for the
    // Join input when it builds the strip.

    function renderDetailsStrip(candidate, vm) {
        var html = '';

        html += '<tr class="planner-matrix-details-row" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '" ' +
                    'data-default-join="' +
                        escapeAttribute(
                            defaultJoinYear(candidate, vm)
                        ) + '" ' +
                    'hidden>';

        // Colspan = 1 (corner) + teams. The team headers are
        // <th>, each occupying one column.
        var colspan = vm.teams.length + 1;

        html += '<td class="planner-matrix-details-cell" ' +
                    'colspan="' + escapeAttribute(colspan) + '">';

        // Content is injected by TeamEvents when a radio is
        // picked. The empty wrapper here is the anchor.
        html += '<div class="planner-row-details" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">' +
                '</div>';

        html += '</td>';
        html += '</tr>';

        return html;
    }

    // ============================================================
    // LEGACY MODES (setup / proposal)
    // ============================================================
    //
    // Kept for the transition. Nothing in TeamEvents calls these
    // after the planner change. Delete along with the old
    // TeamMatchmaking module once the planner is confirmed.

    function renderSetup(vm) {
        var defaultYear = vm.defaultYear;
        var defaultTargetSize = vm.defaultTargetSize;

        var html = '';
        html += '<div class="modal-header">';
        html += '<h3>Team Matchmaking</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="matchmaking-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint">' +
                    'Legacy setup mode. The planner is now the ' +
                    'default matchmaking interface.' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="matchmaking-year">Year</label>';
        html += '<input type="number" id="matchmaking-year" ' +
                    'class="matchmaking-year" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(safeString(defaultYear)) +
                    '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="matchmaking-target-size">' +
                    'Target Team Size' +
                '</label>';
        html += '<input type="number" id="matchmaking-target-size" ' +
                    'class="matchmaking-target-size" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(
                            safeString(defaultTargetSize)
                        ) +
                    '">';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="matchmaking-close">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="matchmaking-build">' +
                    'Build Proposal' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderProposal(vm) {
        var year = vm.year;
        var targetSize = vm.targetSize;
        var assignments = vm.assignments;
        var unassigned = vm.unassigned;

        if (!Array.isArray(assignments)) {
            throw new Error(
                '[TeamMatchmakingView] Proposal VM is missing ' +
                'assignments array.'
            );
        }
        if (!Array.isArray(unassigned)) {
            throw new Error(
                '[TeamMatchmakingView] Proposal VM is missing ' +
                'unassigned array.'
            );
        }

        var totalAssignments = 0;
        for (var i = 0; i < assignments.length; i++) {
            var a = assignments[i];
            if (!Array.isArray(a.additions)) {
                throw new Error(
                    '[TeamMatchmakingView] Assignment "' +
                    safeString(a.teamId) +
                    '" is missing additions array.'
                );
            }
            totalAssignments += a.additions.length;
        }

        var html = '';
        html += '<div class="modal-header">';
        html += '<h3>Matchmaking Proposal \u2014 Year ' +
                    escapeHtml(String(year)) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="matchmaking-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body matchmaking-body">';

        html += '<p class="field-hint matchmaking-summary">' +
                    'Target size: <strong>' +
                        escapeHtml(String(targetSize)) +
                    '</strong>. ' +
                    'Proposed additions: <strong>' +
                        escapeHtml(String(totalAssignments)) +
                    '</strong> across <strong>' +
                        escapeHtml(String(assignments.length)) +
                    '</strong> team' +
                    (assignments.length === 1 ? '' : 's') +
                    '.' +
                '</p>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="matchmaking-close">' +
                    'Close' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PUBLIC ENTRY
    // ============================================================

    function renderHTML(vm) {
        if (!vm || typeof vm !== 'object') {
            throw new Error(
                '[TeamMatchmakingView] renderHTML requires a view ' +
                'model.'
            );
        }

        if (vm.mode === 'planner') {
            return renderPlanner(vm);
        }
        if (vm.mode === 'setup') {
            return renderSetup(vm);
        }
        if (vm.mode === 'proposal') {
            return renderProposal(vm);
        }

        throw new Error(
            '[TeamMatchmakingView] Unknown view mode: "' +
            safeString(vm.mode) + '".'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMatchmakingView = Object.freeze({
        renderHTML: renderHTML
    });

})();
