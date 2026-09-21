/**
 * modules/teams/team-matchmaking-view.js - Team Matchmaking View
 * Modal renderer for the Team Matchmaking workflow.
 *
 * Path: js/modules/teams/team-matchmaking-view.js
 *
 * RESPONSIBILITIES:
 *   - Render the matchmaking modal's two modes: Setup and
 *     Proposal.
 *   - Render one row per assignment in the proposal.
 *   - Render the "unassigned candidates" panel.
 *   - Collect the Setup-mode form values.
 *
 * NOT RESPONSIBILITIES:
 *   - Event binding. The events module owns the modal's
 *     interaction wiring.
 *   - Proposal state. The proposal is stored on the modal's
 *     DOM element as a plain object; the events module mutates
 *     it. This module reads it and re-renders.
 *   - Domain reads. Every field the renderer uses arrives on
 *     the view model.
 *   - Mutations. Committing the proposal is the events module's
 *     job.
 *
 * VIEW MODEL — SETUP MODE:
 *   {
 *     mode: 'setup',
 *     defaultYear: number,
 *     defaultTargetSize: number
 *   }
 *
 * VIEW MODEL — PROPOSAL MODE:
 *   {
 *     mode: 'proposal',
 *     year: number,
 *     targetSize: number,
 *     assignments: [ {
 *       teamId,
 *       teamName,
 *       additions: [ { id, name, status, history } ]
 *     } ],
 *     unassigned: [ { id, name, status, history } ],
 *     candidatesById: { [id]: { id, name, status, history } }
 *   }
 *
 *   `unassigned` is the list of candidates not yet placed in
 *   any assignment. The events module maintains this list when
 *   the user removes or moves a person.
 *
 *   `candidatesById` is a lookup for the "add to team" dropdown.
 *   The events module builds it once when entering proposal
 *   mode.
 *
 * EDITABILITY:
 *   Every assignment row emits a "Remove" button for each
 *   addition. Every assignment also emits an "Add" mini-form
 *   with a dropdown of unassigned candidates.
 *
 *   Moving a person between teams is implemented as Remove +
 *   Add. There is no drag-and-drop; the spec does not call for
 *   one, and the DOM-level interaction is simpler without it.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
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
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function formatHistory(history) {
        if (!Array.isArray(history) || history.length === 0) {
            return 'No professional-team history';
        }
        return 'Years: ' + history.join(', ');
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
                    'pool of eligible characters. ' +
                    'A proposal is generated first; you can edit it ' +
                    'before committing.' +
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
                    'The year the matchmaking runs for. ' +
                    'Eligibility and team windows are scoped to ' +
                    'this year.' +
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
                    'The proposal will not push a team past this ' +
                    'size.' +
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
        var assignments = Array.isArray(vm.assignments)
            ? vm.assignments
            : [];
        var unassigned = Array.isArray(vm.unassigned)
            ? vm.unassigned
            : [];

        var totalAssignments = 0;
        for (var i = 0; i < assignments.length; i++) {
            totalAssignments += assignments[i].additions.length;
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
            for (var a = 0; a < assignments.length; a++) {
                html += renderAssignmentRow(assignments[a], vm);
            }
            html += '</div>';
        }

        html += renderUnassignedPanel(unassigned, vm);

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
        var additions = Array.isArray(assignment.additions)
            ? assignment.additions
            : [];

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

        // ---- Add mini-form ----
        html += renderAddMiniForm(teamId, vm);

        html += '</div>';
        return html;
    }

    function renderAdditionRow(candidate, teamId) {
        var history = Array.isArray(candidate.history)
            ? candidate.history
            : [];
        var hasHistory = history.length > 0;

        var html = '';
        html += '<div class="matchmaking-addition" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.id) + '">';

        html += '<div class="matchmaking-addition-main">';
        html += '<span class="matchmaking-addition-name">' +
                    escapeHtml(candidate.name) +
                '</span>';
        if (isNonEmptyString(candidate.status)) {
            html += '<span class="matchmaking-addition-status">' +
                        escapeHtml(candidate.status) +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="matchmaking-addition-secondary">' +
                    (hasHistory
                        ? escapeHtml(formatHistory(history))
                        : '<em>No professional-team history</em>') +
                '</div>';

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
        var unassigned = Array.isArray(vm.unassigned)
            ? vm.unassigned
            : [];

        if (unassigned.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="matchmaking-add-form">';
        html += '<select class="matchmaking-add-select" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">';
        html += '<option value="">Add unassigned...</option>';
        for (var i = 0; i < unassigned.length; i++) {
            var candidate = unassigned[i];
            html += '<option value="' +
                        escapeAttribute(candidate.id) + '">' +
                        escapeHtml(candidate.name) +
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

    function renderUnassignedPanel(unassigned, vm) {
        if (unassigned.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="matchmaking-unassigned">';
        html += '<div class="matchmaking-unassigned-header">' +
                    'Unassigned Pool (' + unassigned.length + ')' +
                '</div>';
        html += '<div class="matchmaking-unassigned-list">';
        for (var i = 0; i < unassigned.length; i++) {
            var candidate = unassigned[i];
            html += '<div class="matchmaking-unassigned-row" ' +
                        'data-character-id="' +
                            escapeAttribute(candidate.id) + '">';
            html += '<span class="matchmaking-unassigned-name">' +
                        escapeHtml(candidate.name) +
                    '</span>';
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

        if (vm.mode === 'proposal') {
            return renderProposal(vm);
        }
        return renderSetup(vm);
    }

    /**
     * Collect the Setup-mode form values from a container.
     *
     * @param {HTMLElement} container
     * @returns {object} { year, targetSize } or null
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
     * Read the currently selected candidate ID from an "Add
     * unassigned" mini-form's select element.
     *
     * @param {HTMLElement} selectEl
     * @returns {string} The candidate ID, or ''
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
                '[TeamMatchmakingView] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
