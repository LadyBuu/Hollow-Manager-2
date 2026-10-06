/**
 * modules/teams/team-matchmaking-view.js - Team Matchmaking View
 * Modal renderer for the Team Matchmaking planner.
 *
 * Path: js/modules/teams/team-matchmaking-view.js
 *
 * RESPONSIBILITIES:
 *   - Render the planner modal.
 *   - Render the left column: professional teams under the
 *     target size, with their existing members and each member's
 *     interval (join + leave).
 *   - Render the right column: the same canonical pool candidates
 *     as the Professional Pool, with checkboxes and per-team
 *     year inputs.
 *   - Collect planner input (ticked candidates, their year
 *     inputs, and the team they are ticked against).
 *
 * WHAT THIS DOES NOT OWN:
 *   - Event binding. TeamEvents owns it.
 *   - Planner state. Stored on the modal's DOM element.
 *   - Domain reads. Every field arrives on the view model.
 *   - Eligibility. TeamQueries owns it.
 *   - Mutations. TeamCore owns it.
 *   - Shortage history computation. TeamQueries.getTeamShortagePeriods
 *     owns it; this view only renders the display string that
 *     TeamAggregator placed on each team row.
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
 *         members: [
 *           { characterId, memberId, displayName, role,
 *             joinPeriod, leavePeriod, intervalDisplay }
 *         ],
 *         shortagePeriods: [ { from: number, to: number | null } ],
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
 * SHORTAGE LINE:
 *   Each team card carries an optional "short" line beneath the
 *   period display. It renders `shortageDisplay` verbatim when the
 *   string is non-empty:
 *
 *     Short 1930–1931, 1935–present
 *
 *   An empty `shortageDisplay` means the team has never been short
 *   between its start period and the planning period, and the line
 *   is omitted entirely. The row is not rendered with a placeholder.
 *
 * PLANNER DOM CONTRACT:
 *   For each (candidate, team) association the UI renders:
 *
 *     <tr class="planner-candidate-row"
 *         data-character-id="...">
 *       ...
 *       <td class="planner-assoc-cell" data-team-id="...">
 *         <input type="checkbox"
 *                class="planner-assoc-checkbox"
 *                data-team-id="..."
 *                data-character-id="..." />
 *         <input type="text"
 *                class="planner-assoc-join"
 *                data-team-id="..."
 *                data-character-id="..." />
 *         <input type="text"
 *                class="planner-assoc-leave"
 *                data-team-id="..."
 *                data-character-id="..." />
 *       </td>
 *       ...
 *     </tr>
 *
 *   TeamEvents reads those inputs on commit. The view never reads
 *   them itself; it only emits the shape.
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

    // ============================================================
    // PLANNER
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

        html += '<p class="field-hint planner-summary">' +
                    'Target size: <strong>' +
                        escapeHtml(String(vm.targetSize)) +
                    '</strong>. ' +
                    'Understaffed teams: <strong>' +
                        escapeHtml(String(vm.teams.length)) +
                    '</strong>. ' +
                    'Candidates: <strong>' +
                        escapeHtml(String(vm.candidates.length)) +
                    '</strong>.' +
                '</p>';

        if (vm.teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'No understaffed professional teams at this ' +
                        'year. Nothing to plan.' +
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

        if (vm.candidates.length === 0) {
            html += '<p class="empty-state small">' +
                        'No candidates in the professional pool.' +
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

        html += renderPlannerTeamsPanel(vm);

        html += renderPlannerCandidatesPanel(vm);

        html += '<div class="form-actions planner-actions">';
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
    // PLANNER — TEAMS PANEL
    // ============================================================

    function renderPlannerTeamsPanel(vm) {
        var html = '';

        html += '<div class="planner-panel planner-teams-panel">';
        html += '<div class="planner-panel-header">' +
                    'Understaffed Teams (' +
                    escapeHtml(String(vm.teams.length)) +
                    ')' +
                '</div>';

        html += '<div class="planner-teams-list">';

        for (var i = 0; i < vm.teams.length; i++) {
            html += renderPlannerTeam(vm.teams[i]);
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPlannerTeam(team) {
        var html = '';

        html += '<div class="planner-team" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '">';

        html += '<div class="planner-team-header">';
        html += '<span class="planner-team-name">' +
                    escapeHtml(team.teamName) +
                '</span>';
        html += '<span class="planner-team-count">' +
                    escapeHtml(String(team.memberCount)) +
                    ' / ' +
                    escapeHtml(String(team.targetSize)) +
                    ' members' +
                '</span>';
        html += '</div>';

        html += '<div class="planner-team-meta">' +
                    escapeHtml(team.periodDisplay) +
                '</div>';

        // ---- Shortage line. ----
        //
        // Rendered only when the aggregator placed a non-empty
        // shortageDisplay on the row. An empty string means the
        // team has never been short between its start period and
        // the planning period, and the line is omitted.
        if (isNonEmptyString(team.shortageDisplay)) {
            html += '<div class="planner-team-shortage">' +
                        'Short ' +
                        escapeHtml(team.shortageDisplay) +
                    '</div>';
        }

        html += '<div class="planner-team-members">';

        if (team.members.length === 0) {
            html += '<div class="planner-team-member empty">' +
                        'No active members.' +
                    '</div>';
        } else {
            for (var i = 0; i < team.members.length; i++) {
                html += renderPlannerTeamMember(team.members[i]);
            }
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPlannerTeamMember(member) {
        var html = '';

        html += '<div class="planner-team-member" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId) + '">';

        html += '<span class="planner-team-member-name">' +
                    escapeHtml(member.displayName) +
                '</span>';

        if (isNonEmptyString(member.role)) {
            html += '<span class="planner-team-member-role">(' +
                        escapeHtml(member.role) +
                    ')</span>';
        }

        html += '<span class="planner-team-member-interval">' +
                    escapeHtml(member.intervalDisplay) +
                '</span>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PLANNER — CANDIDATES PANEL
    // ============================================================

    function renderPlannerCandidatesPanel(vm) {
        var html = '';

        html += '<div class="planner-panel planner-candidates-panel">';
        html += '<div class="planner-panel-header">' +
                    'Available Candidates (' +
                    escapeHtml(String(vm.candidates.length)) +
                    ')' +
                '</div>';

        html += '<div class="planner-candidates-list">';

        for (var i = 0; i < vm.candidates.length; i++) {
            html += renderPlannerCandidateRow(vm.candidates[i], vm);
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPlannerCandidateRow(candidate, vm) {
        var bucketClass =
            'planner-candidate-' + candidate.availabilityBucket;
        var statusClass = candidate.assignment.status === 'active'
            ? ' planner-candidate-assigned'
            : '';

        var html = '';

        html += '<div class="planner-candidate-row ' +
                    bucketClass + statusClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">';

        // ---- Candidate identity line ----
        html += '<div class="planner-candidate-identity">';
        html += '<span class="planner-candidate-name">' +
                    escapeHtml(candidate.displayName) +
                '</span>';
        if (isNonEmptyString(candidate.ageDisplay)) {
            html += '<span class="planner-candidate-age">(' +
                        escapeHtml(candidate.ageDisplay) +
                    ')</span>';
        }
        html += '</div>';

        // ---- Candidate meta line ----
        html += '<div class="planner-candidate-meta">';
        if (isNonEmptyString(candidate.statusAtPeriod)) {
            html += '<span class="planner-candidate-status">' +
                        escapeHtml(candidate.statusAtPeriod) +
                    '</span>';
        }
        html += '<span class="planner-candidate-availability">' +
                    escapeHtml(candidate.availability.display) +
                '</span>';
        if (isNonEmptyString(candidate.assignment.display) &&
            candidate.assignment.display !== 'Unassigned') {
            html += '<span class="planner-candidate-assignment">' +
                        escapeHtml(candidate.assignment.display) +
                    '</span>';
        }
        html += '</div>';

        // ---- Per-team checkboxes + year inputs ----
        html += '<div class="planner-candidate-teams">';

        for (var t = 0; t < vm.teams.length; t++) {
            html += renderPlannerTeamCell(
                candidate, vm.teams[t], vm
            );
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderPlannerTeamCell(candidate, team, vm) {
        // Default years: the intersection of the planning year
        // and the candidate's availability window, clamped to the
        // window if the planning year is outside it.
        var defaultJoin = String(vm.period);
        var defaultLeave = '';

        if (candidate.availability.from !== null &&
            vm.period < candidate.availability.from) {
            defaultJoin = String(candidate.availability.from);
        }
        if (candidate.availability.to !== null &&
            vm.period > candidate.availability.to) {
            defaultJoin = String(candidate.availability.to);
        }

        var html = '';

        html += '<div class="planner-team-cell" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '">';

        html += '<label class="planner-team-cell-label">';
        html += '<input type="checkbox" ' +
                    'class="planner-assoc-checkbox" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '">';
        html += '<span class="planner-team-cell-name">' +
                    escapeHtml(team.teamName) +
                '</span>';
        html += '</label>';

        html += '<div class="planner-team-cell-years">';
        html += '<input type="text" ' +
                    'class="planner-assoc-join" ' +
                    'placeholder="Join" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '" ' +
                    'value="' +
                        escapeAttribute(defaultJoin) + '">';
        html += '<span class="planner-team-cell-dash">\u2013</span>';
        html += '<input type="text" ' +
                    'class="planner-assoc-leave" ' +
                    'placeholder="Leave" ' +
                    'data-team-id="' +
                        escapeAttribute(team.teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '" ' +
                    'value="' +
                        escapeAttribute(defaultLeave) + '">';
        html += '</div>';

        html += '</div>';
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
