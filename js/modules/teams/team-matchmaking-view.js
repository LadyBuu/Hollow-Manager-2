/**
 * modules/teams/team-matchmaking-view.js - Team Matchmaking View
 * Modal renderer for the Team Matchmaking workflow.
 *
 * Path: js/modules/teams/team-matchmaking-view.js
 *
 * RESPONSIBILITIES:
 *   - Render the matchmaking modal in one of two modes: Setup
 *     and Proposal.
 *   - Render one row per assignment in the proposal.
 *   - Render the unassigned-candidates panel.
 *   - Collect Setup-mode form values.
 *   - Read the add-unassigned select.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Event binding. TeamEvents owns it.
 *   - Proposal state. Stored on the modal's DOM element.
 *   - Domain reads. Every field arrives on the view model.
 *   - Mutations.
 *
 * VM SHAPES:
 *   Setup mode:
 *     {
 *       mode: 'setup',
 *       defaultYear: number|null,
 *       defaultTargetSize: number
 *     }
 *
 *   Proposal mode:
 *     {
 *       mode: 'proposal',
 *       year: number,
 *       targetSize: number,
 *       assignments: [
 *         {
 *           teamId, teamName,
 *           additions: [candidate]
 *         }
 *       ],
 *       unassigned: [candidate]
 *     }
 *
 *   Candidate (from TeamAggregator.getTeamMatchmakingViewModel):
 *     {
 *       id, name, status, ageDisplay,
 *       availability: { from, to, display },
 *       assignment: {
 *         status, nextTeamName, nextJoinYear
 *       }
 *     }
 *
 * STRICT VM:
 *   The renderer trusts the VM contract. It does not default
 *   missing arrays to empty and does not infer domain state from
 *   presentation strings. Unknown modes throw rather than falling
 *   back to setup.
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
    // CANDIDATE ROW HELPERS
    // ============================================================

    /**
     * Composition line for a candidate: "Available 1902–1907" or
     * "Available any" or "Available 1902–".
     */
    function availabilityLabel(candidate) {
        if (!candidate.availability) { return ''; }
        var display = candidate.availability.display;
        if (!isNonEmptyString(display)) { return ''; }
        if (display === 'any') { return 'Available any year'; }
        return 'Available ' + display;
    }

    /**
     * Assignment line for a candidate that already has a future
     * commitment. Empty string for freely available candidates.
     */
    function nextAssignmentLabel(candidate) {
        if (!candidate.assignment) { return ''; }
        if (candidate.assignment.status !== 'future') { return ''; }
        var team = candidate.assignment.nextTeamName;
        var year = candidate.assignment.nextJoinYear;
        if (!isNonEmptyString(team)) { return ''; }
        if (year === null || year === undefined) {
            return 'Next: ' + team;
        }
        return 'Next: ' + team + ' from ' + String(year);
    }

    /**
     * Single-line secondary description for a candidate. Combines
     * status, availability, and (when present) the next assignment.
     */
    function candidateSecondaryLine(candidate) {
        var parts = [];

        if (isNonEmptyString(candidate.status)) {
            parts.push(candidate.status);
        }

        var avail = availabilityLabel(candidate);
        if (avail) { parts.push(avail); }

        var next = nextAssignmentLabel(candidate);
        if (next) { parts.push(next); }

        return parts.join(' \u00b7 ');
    }

    // ============================================================
    // SETUP MODE
    // ============================================================

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
                    'Fills understaffed professional teams from the ' +
                    'professional pool. A proposal is generated ' +
                    'first; you can edit it before committing.' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="matchmaking-year">Year</label>';
        html += '<input type="number" id="matchmaking-year" ' +
                    'class="matchmaking-year" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(safeString(defaultYear)) +
                    '">';
        html += '<p class="field-hint">' +
                    'The year the matchmaking runs for. Eligibility ' +
                    'and team windows are scoped to this year.' +
                '</p>';
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
        html += '<p class="field-hint">' +
                    'Teams at or above this size are skipped. ' +
                    'The proposal will not push a team past this size.' +
                '</p>';
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

    // ============================================================
    // PROPOSAL MODE
    // ============================================================

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
                    '. ' +
                    'Unassigned pool: <strong>' +
                        escapeHtml(String(unassigned.length)) +
                    '</strong>.' +
                '</p>';

        if (assignments.length === 0) {
            html += '<p class="empty-state small">' +
                        'The proposal is empty. Every eligible ' +
                        'character is either already on a team ' +
                        'or there are no understaffed teams.' +
                    '</p>';
        } else {
            html += '<div class="matchmaking-assignments">';
            for (var j = 0; j < assignments.length; j++) {
                html += renderAssignmentRow(assignments[j], vm);
            }
            html += '</div>';
        }

        html += renderUnassignedPanel(unassigned);

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="matchmaking-back">' +
                    'Back to Setup' +
                '</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="matchmaking-commit"' +
                    (totalAssignments === 0 ? ' disabled' : '') +
                    '>Commit Proposal</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderAssignmentRow(assignment, vm) {
        var teamId = assignment.teamId;
        var teamName = assignment.teamName;
        var additions = assignment.additions;

        var html = '';
        html += '<div class="matchmaking-assignment" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">';

        html += '<div class="matchmaking-assignment-header">';
        html += '<span class="matchmaking-assignment-name">' +
                    escapeHtml(teamName) +
                '</span>';
        html += '<span class="matchmaking-assignment-count">' +
                    additions.length + ' new' +
                '</span>';
        html += '</div>';

        html += '<div class="matchmaking-additions">';
        for (var i = 0; i < additions.length; i++) {
            html += renderAdditionRow(additions[i], teamId);
        }
        html += '</div>';

        html += renderAddMiniForm(teamId, vm);

        html += '</div>';
        return html;
    }

    function renderAdditionRow(candidate, teamId) {
        var secondary = candidateSecondaryLine(candidate);

        var html = '';
        html += '<div class="matchmaking-addition" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.id) + '">';

        html += '<div class="matchmaking-addition-main">';
        html += '<span class="matchmaking-addition-name">' +
                    escapeHtml(candidate.name) +
                '</span>';
        if (isNonEmptyString(candidate.ageDisplay)) {
            html += '<span class="matchmaking-addition-age">(' +
                        escapeHtml(candidate.ageDisplay) +
                    ')</span>';
        }
        html += '</div>';

        if (secondary) {
            html += '<div class="matchmaking-addition-secondary">' +
                        escapeHtml(secondary) +
                    '</div>';
        }

        html += '<button type="button" ' +
                    'class="small danger matchmaking-remove-addition" ' +
                    'data-action="matchmaking-remove-addition" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.id) + '">' +
                    '\u2715' +
                '</button>';

        html += '</div>';
        return html;
    }

    function renderAddMiniForm(teamId, vm) {
        var unassigned = vm.unassigned;
        if (unassigned.length === 0) { return ''; }

        var html = '';
        html += '<div class="matchmaking-add-form">';
        html += '<select class="matchmaking-add-select" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">';
        html += '<option value="">Add unassigned...</option>';
        for (var i = 0; i < unassigned.length; i++) {
            var candidate = unassigned[i];

            // Native <select> options cannot carry styled spans, so
            // the availability is folded into the label text.
            var optionLabel = candidate.name;
            if (candidate.availability &&
                isNonEmptyString(candidate.availability.display) &&
                candidate.availability.display !== 'any') {
                optionLabel = candidate.name +
                    ' (' + candidate.availability.display + ')';
            }

            html += '<option value="' +
                        escapeAttribute(candidate.id) + '">' +
                        escapeHtml(optionLabel) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="matchmaking-add-addition" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">' +
                    'Add' +
                '</button>';
        html += '</div>';
        return html;
    }

    function renderUnassignedPanel(unassigned) {
        if (unassigned.length === 0) { return ''; }

        var html = '';
        html += '<div class="matchmaking-unassigned">';
        html += '<div class="matchmaking-unassigned-header">' +
                    'Unassigned Pool (' + unassigned.length + ')' +
                '</div>';
        html += '<div class="matchmaking-unassigned-list">';
        for (var i = 0; i < unassigned.length; i++) {
            var candidate = unassigned[i];
            var secondary = candidateSecondaryLine(candidate);

            html += '<div class="matchmaking-unassigned-row" ' +
                        'data-character-id="' +
                            escapeAttribute(candidate.id) + '">';
            html += '<span class="matchmaking-unassigned-name">' +
                        escapeHtml(candidate.name) +
                    '</span>';
            if (secondary) {
                html += '<span class="matchmaking-unassigned-secondary">' +
                            escapeHtml(secondary) +
                        '</span>';
            }
            html += '</div>';
        }
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // PUBLIC ENTRY
    // ============================================================

    /**
     * Render the matchmaking modal content.
     *
     * @param {object} vm - View model. See file header for shape.
     * @returns {string} HTML
     */
    function renderHTML(vm) {
        if (!vm || typeof vm !== 'object') {
            throw new Error(
                '[TeamMatchmakingView] renderHTML requires a view ' +
                'model.'
            );
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

    /**
     * Collect the Setup-mode form values from a container.
     */
    function collectSetup(container) {
        if (!container) { return null; }

        var yearEl = container.querySelector('.matchmaking-year');
        var sizeEl = container.querySelector(
            '.matchmaking-target-size'
        );

        return {
            year: yearEl ? yearEl.value.trim() : '',
            targetSize: sizeEl ? sizeEl.value.trim() : ''
        };
    }

    /**
     * Read the currently selected candidate ID from an
     * add-unassigned select element.
     */
    function readAddSelect(selectEl) {
        if (!selectEl) { return ''; }
        return selectEl.value || '';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMatchmakingView = Object.freeze({
        renderHTML: renderHTML,
        collectSetup: collectSetup,
        readAddSelect: readAddSelect
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamMatchmakingView;
        var missing = [];

        var required = [
            'renderHTML',
            'collectSetup',
            'readAddSelect'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamMatchmakingView] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
