/**
 * modules/teams/team-verifier-view.js - Team Verifier View
 * Modal renderer for the team consistency report.
 *
 * Path: js/modules/teams/team-verifier-view.js
 *
 * WHAT THIS OWNS:
 *   - The verifier modal shell.
 *   - Rendering the summary line.
 *   - Grouping findings by team.
 *   - One row per finding.
 *   - The "Go to team" action, which closes the verifier and
 *     opens the standard team edit form.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The checks. TeamVerifier.runChecks owns them.
 *   - Team mutations. Nothing here writes.
 *   - The team edit form. TeamEvents.showTeamForm owns it.
 *
 * FLOW:
 *   openModal()
 *     -> create modal shell
 *     -> TeamVerifier.runChecks()
 *     -> render findings
 *     -> Modal.showModal()
 *     -> bind click handlers
 *
 * GO TO TEAM:
 *   Clicking a finding's team name, or the "Edit" button on a
 *   finding row, closes the verifier and calls
 *   TeamEvents.showTeamForm(teamId). The user lands in the
 *   standard edit form with the team loaded.
 *
 * EMPTY STATE:
 *   When no findings are returned, the modal shows a single
 *   success line and no rows.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamVerifier
 *   - window.Modal
 *   - window.DomUtils
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, at click time):
 *   - window.TeamEvents
 */

(function() {
    'use strict';

    if (window.__teamVerifierViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamVerifier = window.TeamVerifier;
    var Modal = window.Modal;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!TeamVerifier ||
        typeof TeamVerifier.runChecks !== 'function') {
        _missing.push('TeamVerifier.runChecks');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamVerifierView] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamVerifierViewLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _contentClickHandler = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getTeamEvents() {
        return window.TeamEvents || null;
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function openModal() {
        if (_modal && _contentEl) {
            // Already open. Re-run the checks and re-render.
            renderReport();
            return;
        }

        if (_modal) {
            try { Modal.closeModal(_modal); } catch (e) {}
            _modal = null;
            _contentEl = null;
        }

        var modal = Modal.createModal('team-verifier-modal');
        if (!modal) {
            notify('Could not open the team verifier.', 'error');
            return;
        }
        modal.id = 'team-verifier-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide verifier-content';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;

        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('click', _contentClickHandler);

        renderReport();

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _contentClickHandler = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderReport() {
        if (!_contentEl) { return; }

        var result = null;
        try {
            result = TeamVerifier.runChecks();
        } catch (err) {
            console.warn(
                '[TeamVerifierView] runChecks threw:', err
            );
            _contentEl.innerHTML = buildErrorHTML(err);
            return;
        }

        _contentEl.innerHTML = buildReportHTML(result);
    }

    function buildErrorHTML(err) {
        var message = err && err.message
            ? err.message
            : 'Unknown error.';

        var html = '';
        html += '<div class="modal-header">';
        html += '<h3>Team Consistency Report</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-verifier-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p class="empty-state">' +
                    'The verifier failed to run: ' +
                    escapeHtml(message) +
                '</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // REPORT
    // ============================================================

    function buildReportHTML(result) {
        if (!result) { return buildErrorHTML(null); }

        var findings = Array.isArray(result.findings)
            ? result.findings
            : [];
        var summary = result.summary || {};

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Team Consistency Report</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-verifier-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body verifier-body">';

        html += buildSummaryHTML(result, summary);

        if (findings.length === 0) {
            html += buildEmptyStateHTML();
        } else {
            html += buildFindingsHTML(findings);
        }

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-verifier-action="close">Close</button>';
        html += '<button type="button" class="primary" ' +
                    'data-verifier-action="rerun">Rerun</button>';
        html += '</div>';

        return html;
    }

    function buildSummaryHTML(result, summary) {
        var scannedTeams = result.scannedTeams || 0;
        var scannedMembers = result.scannedMembers || 0;
        var scannedIntervals = result.scannedIntervals || 0;

        var errors = summary.errors || 0;
        var warnings = summary.warnings || 0;
        var total = summary.total || 0;

        var summaryClass = 'verifier-summary';
        if (errors > 0) {
            summaryClass += ' verifier-summary-errors';
        } else if (warnings > 0) {
            summaryClass += ' verifier-summary-warnings';
        } else {
            summaryClass += ' verifier-summary-clean';
        }

        var html = '';
        html += '<div class="' + summaryClass + '">';

        html += '<div class="verifier-summary-counts">';
        if (errors > 0) {
            html += '<span class="verifier-count verifier-count-error">' +
                        errors + ' error' +
                        (errors === 1 ? '' : 's') +
                    '</span>';
        }
        if (warnings > 0) {
            html += '<span class="verifier-count ' +
                        'verifier-count-warning">' +
                        warnings + ' warning' +
                        (warnings === 1 ? '' : 's') +
                    '</span>';
        }
        if (total === 0) {
            html += '<span class="verifier-count ' +
                        'verifier-count-clean">' +
                        'No issues found' +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="verifier-summary-scanned">' +
                    'Scanned ' +
                    escapeHtml(String(scannedTeams)) +
                    ' team' + (scannedTeams === 1 ? '' : 's') +
                    ', ' +
                    escapeHtml(String(scannedMembers)) +
                    ' member' + (scannedMembers === 1 ? '' : 's') +
                    ', ' +
                    escapeHtml(String(scannedIntervals)) +
                    ' stint' + (scannedIntervals === 1 ? '' : 's') +
                '</div>';

        html += '</div>';

        return html;
    }

    function buildEmptyStateHTML() {
        return '<div class="verifier-empty">' +
                    '<p class="empty-state">' +
                        'Every professional and temporary team is ' +
                        'consistent with its member records.' +
                    '</p>' +
                '</div>';
    }

    function buildFindingsHTML(findings) {
        var groups = groupFindingsByTeam(findings);

        var html = '';
        html += '<div class="verifier-groups">';

        for (var i = 0; i < groups.length; i++) {
            html += buildTeamGroupHTML(groups[i]);
        }

        html += '</div>';
        return html;
    }

    function groupFindingsByTeam(findings) {
        var byTeam = Object.create(null);
        var order = [];

        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var key = f.teamId || ('__notteam__' + i);

            if (!byTeam[key]) {
                byTeam[key] = {
                    teamId: f.teamId,
                    teamName: f.teamName || 'Unnamed Team',
                    teamType: f.teamType || '',
                    findings: []
                };
                order.push(key);
            }
            byTeam[key].findings.push(f);
        }

        var result = [];
        for (var k = 0; k < order.length; k++) {
            result.push(byTeam[order[k]]);
        }
        return result;
    }

    function buildTeamGroupHTML(group) {
        var html = '';
        html += '<div class="verifier-team-group" ' +
                    'data-team-id="' +
                        escapeAttribute(group.teamId || '') + '">';

        html += '<div class="verifier-team-header">';
        html += '<span class="verifier-team-name">' +
                    escapeHtml(group.teamName) +
                '</span>';
        if (isNonEmptyString(group.teamType)) {
            html += '<span class="verifier-team-type">' +
                        escapeHtml(group.teamType) +
                    '</span>';
        }
        html += '<span class="verifier-team-count">' +
                    group.findings.length + ' finding' +
                    (group.findings.length === 1 ? '' : 's') +
                '</span>';
        if (group.teamId) {
            html += '<button type="button" ' +
                        'class="small secondary verifier-goto-team" ' +
                        'data-verifier-action="go-to-team" ' +
                        'data-team-id="' +
                            escapeAttribute(group.teamId) + '">' +
                        'Open team' +
                    '</button>';
        }
        html += '</div>';

        html += '<div class="verifier-findings">';
        for (var i = 0; i < group.findings.length; i++) {
            html += buildFindingRowHTML(group.findings[i]);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function buildFindingRowHTML(finding) {
        var severityClass = 'verifier-finding-' +
            (finding.severity || 'info');

        var html = '';
        html += '<div class="verifier-finding ' + severityClass + '" ' +
                    'data-check-id="' +
                        escapeAttribute(finding.checkId || '') + '">';

        html += '<div class="verifier-finding-header">';
        html += '<span class="verifier-finding-severity">' +
                    escapeHtml(finding.severity || 'info') +
                '</span>';
        html += '<span class="verifier-finding-title">' +
                    escapeHtml(finding.title || '') +
                '</span>';
        if (isNonEmptyString(finding.characterName)) {
            html += '<span class="verifier-finding-character">' +
                        escapeHtml(finding.characterName) +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="verifier-finding-message">' +
                    escapeHtml(finding.message || '') +
                '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT HANDLING
    // ============================================================

    function handleContentClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var actionEl = target.closest('[data-verifier-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.verifierAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'rerun') {
            e.preventDefault();
            renderReport();
            return;
        }

        if (action === 'go-to-team') {
            e.preventDefault();
            var teamId = actionEl.dataset.teamId;
            if (!teamId) { return; }
            goToTeam(teamId);
            return;
        }
    }

    function goToTeam(teamId) {
        var TeamEvents = getTeamEvents();
        if (!TeamEvents ||
            typeof TeamEvents.showTeamForm !== 'function') {
            console.warn(
                '[TeamVerifierView] TeamEvents.showTeamForm is ' +
                'not available.'
            );
            notify(
                'Cannot open the team edit form right now.',
                'error'
            );
            return;
        }

        closeModal();

        try {
            TeamEvents.showTeamForm(String(teamId));
        } catch (err) {
            console.warn(
                '[TeamVerifierView] showTeamForm threw:', err
            );
            notify(
                'Failed to open the team edit form.',
                'error'
            );
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamVerifierView = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamVerifierView;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamVerifierView] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
