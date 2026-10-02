/**
 * modules/teams/team-export-picker.js - Team Export Picker
 * Modal that lists teams and triggers TeamExport for one.
 *
 * Path: js/modules/teams/team-export-picker.js
 *
 * WHAT THIS OWNS:
 *   - The picker modal: render, open, close.
 *   - Team list population from TeamQueries.
 *   - Delegated click handling for "export this team" buttons.
 *   - Calling TeamExport.exportTeam(teamId).
 *
 * WHAT THIS DOES NOT OWN:
 *   - The export itself. TeamExport owns the projection and
 *     download.
 *   - Long-lived state. One open at a time; teardown on close.
 *
 * OPENING MODES:
 *   openModal()                  lists all operational teams.
 *   openModal({ teamId })        lists all teams, but highlights
 *                                and scrolls to the given team.
 *   openModal({ teamId, direct: true })
 *                                exports immediately, no modal.
 *
 *   The direct mode exists for callers that already have a
 *   specific team in mind (the per-team `.export-team` button on
 *   a team row). The picker is still useful as a page-level entry
 *   point ("export..."), where the user has not yet chosen a team.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.TeamExport
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__teamExportPickerLoaded) {
        return;
    }
    window.__teamExportPickerLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var TeamExport = window.TeamExport;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getTypeLabel !== 'function') {
        _missing.push('TeamConstants.getTypeLabel');
    }
    if (!TeamExport ||
        typeof TeamExport.exportTeam !== 'function') {
        _missing.push('TeamExport.exportTeam');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        _missing.push('DomUtils.escapeHtml');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExportPicker] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _clickHandler = null;
    var _highlightTeamId = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // OPEN
    // ============================================================

    /**
     * Open the picker, or export directly.
     *
     * @param {object} [options]
     * @param {string} [options.teamId]  Preselect and highlight.
     * @param {boolean} [options.direct] Skip the modal and export
     *   the specified team immediately.
     */
    function openModal(options) {
        options = options || {};

        var teamId = isNonEmptyString(options.teamId)
            ? String(options.teamId)
            : null;

        if (options.direct === true) {
            if (!teamId) {
                notify(
                    'No team selected for export.',
                    'error'
                );
                return;
            }
            triggerTeamExport(teamId);
            return;
        }

        closeModal();

        _highlightTeamId = teamId;

        var teams = fetchTeams();
        if (teams.length === 0) {
            notify('No teams to export.', 'info');
            return;
        }

        var modal = Modal.createModal('team-export-picker-modal');
        if (!modal) {
            notify('Could not open the export picker.', 'error');
            return;
        }
        modal.id = 'team-export-picker-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;

        contentEl.innerHTML = buildPickerHTML(teams);

        _clickHandler = handleClick;
        contentEl.addEventListener('click', _clickHandler);

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);

        scrollToHighlight();
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _clickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _clickHandler
                );
            } catch (e) {
                // Ignore.
            }
        }

        _modal = null;
        _contentEl = null;
        _clickHandler = null;
        _highlightTeamId = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // DATA
    // ============================================================

    function fetchTeams() {
        var all = TeamQueries.getTeams(null, null, false);
        if (!Array.isArray(all)) { return []; }

        var filtered = [];
        for (var i = 0; i < all.length; i++) {
            var team = all[i];
            if (!team || !team.id) { continue; }
            if (team.status === 'deprecated') { continue; }
            filtered.push(team);
        }

        filtered.sort(function(a, b) {
            var aName = isNonEmptyString(a.name)
                ? a.name
                : 'Unnamed Team';
            var bName = isNonEmptyString(b.name)
                ? b.name
                : 'Unnamed Team';
            return aName.localeCompare(bName);
        });

        return filtered;
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildPickerHTML(teams) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Team</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="team-export-close"' +
                    '>&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint">' +
                    'Choose a team to export. The report is a ' +
                    'plain-text document containing the team ' +
                    'header, name and ranking history, member ' +
                    'stints, and a character snapshot for each ' +
                    'member.' +
                '</p>';

        html += '<div class="team-export-list">';

        for (var i = 0; i < teams.length; i++) {
            html += renderTeamRow(teams[i]);
        }

        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderTeamRow(team) {
        var teamId = String(team.id);
        var name = isNonEmptyString(team.name)
            ? team.name
            : 'Unnamed Team';
        var typeLabel = TeamConstants.getTypeLabel(team.type) ||
            team.type || '';
        var memberCount = Array.isArray(team.members)
            ? team.members.length
            : 0;
        var periodDisplay = formatPeriod(team);

        var isHighlighted = _highlightTeamId &&
            String(_highlightTeamId) === teamId;

        var rowClass = 'team-export-row';
        if (isHighlighted) {
            rowClass += ' team-export-row-highlight';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">';

        html += '<div class="team-export-row-info">';
        html += '<div class="team-export-row-name">' +
                    escapeHtml(name) +
                '</div>';
        html += '<div class="team-export-row-meta">';
        html += escapeHtml(typeLabel);
        if (periodDisplay) {
            html += ' \u00b7 ' + escapeHtml(periodDisplay);
        }
        html += ' \u00b7 ' + memberCount + ' member' +
            (memberCount === 1 ? '' : 's');
        html += '</div>';
        html += '</div>';

        html += '<button type="button" class="primary small" ' +
                    'data-action="team-export-run" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">' +
                    'Export' +
                '</button>';

        html += '</div>';
        return html;
    }

    function formatPeriod(team) {
        var start = team.startPeriod;
        var end = team.endPeriod;
        var hasStart = start !== undefined && start !== null &&
                       String(start).trim() !== '';
        var hasEnd = end !== undefined && end !== null &&
                     String(end).trim() !== '';

        if (hasStart && hasEnd) {
            return String(start) + '\u2013' + String(end);
        }
        if (hasStart) { return String(start) + '\u2013'; }
        if (hasEnd) { return '\u2013' + String(end); }
        return '';
    }

    // ============================================================
    // INTERACTION
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var btn = target.closest('[data-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.action;

        if (action === 'team-export-close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'team-export-run') {
            e.preventDefault();
            var teamId = btn.dataset.teamId;
            if (!teamId) { return; }
            triggerTeamExport(teamId);
            return;
        }
    }

    function triggerTeamExport(teamId) {
        var result;
        try {
            result = TeamExport.exportTeam(teamId);
        } catch (err) {
            console.warn(
                '[TeamExportPicker] TeamExport.exportTeam threw:',
                err
            );
            notify(
                'Team export failed: ' + err.message,
                'error'
            );
            return;
        }

        if (result && result.exported) {
            notify(
                'Exported ' + result.count + ' member' +
                (result.count === 1 ? '' : 's') +
                ': ' + result.filename,
                'success'
            );
            closeModal();
            return;
        }

        notify(
            'Team export failed: ' +
                ((result && result.error) || 'Unknown error'),
            'error'
        );
    }

    // ============================================================
    // HIGHLIGHT SCROLL
    // ============================================================

    function scrollToHighlight() {
        if (!_contentEl || !_highlightTeamId) { return; }

        var row = _contentEl.querySelector(
            '.team-export-row-highlight'
        );
        if (!row || typeof row.scrollIntoView !== 'function') {
            return;
        }

        setTimeout(function() {
            try {
                row.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            } catch (e) {
                // Ignore.
            }
        }, 50);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExportPicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamExportPicker;
        var missing = [];

        if (typeof exports.openModal !== 'function') {
            missing.push('openModal');
        }
        if (typeof exports.closeModal !== 'function') {
            missing.push('closeModal');
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExportPicker] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
