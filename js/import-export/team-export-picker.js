/**
 * modules/teams/team-export-picker.js - Team Export Picker
 * Two picker modes:
 *
 *   1. PERIOD PICKER (the primary mode)
 *      Opened from a team row's Export button. Scoped to the one
 *      team that was clicked. The modal shows only that team's
 *      periods and asks which one to export. No team list.
 *
 *   2. DIRECT SHORTCUT
 *      When the caller passes { direct: true } and the team has
 *      exactly one period, the export fires immediately with no
 *      modal. A multi-period team still opens the period picker.
 *
 *   3. TEAM LIST (fallback)
 *      Opened with no teamId. Shows every professional and
 *      civilian team with an Export button per row. Academic
 *      teams are excluded: they use weeks, not years, and are
 *      managed by the Academy module.
 *
 * Path: js/modules/teams/team-export-picker.js
 *
 * PERIOD PICKER BEHAVIOUR:
 *   The modal is titled "Export Team — <team name>". It renders
 *   a radio list of the team's periods, one row per period:
 *
 *     ( ) Rapid (1900–1905)
 *     (•) Rapid II (1905–present)   (current)
 *
 *   The current period (the last one) is preselected. The chosen
 *   period entry is passed to TeamExport.exportTeam as
 *   { period: <entry> }. TeamExport filters the member list and
 *   ranking history to that period using the half-open predicate
 *   in TeamQueries.intervalOverlapsPeriod.
 *
 *   When the team has exactly one period, no radio group is
 *   shown; the modal simply confirms which period is about to be
 *   exported and offers Export / Cancel.
 *
 * RESULT REPORTING:
 *   Success closes the modal and notifies. Failure stays open
 *   with an inline error so the user can retry or pick a
 *   different period.
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
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getPeriods !== 'function') {
        _missing.push('TeamQueries.getPeriods');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getCurrentTeamName !== 'function') {
        _missing.push('TeamQueries.getCurrentTeamName');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getTypeLabel !== 'function') {
        _missing.push('TeamConstants.getTypeLabel');
    }
    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
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
    var _changeHandler = null;

    // Mode:
    //   'period'  — the modal is scoped to one team, picking a
    //               period. This is the primary mode.
    //   'list'    — the modal lists all exportable teams.
    var _mode = 'period';

    // Period-picker state.
    var _scopedTeamId = null;
    var _scopedTeamName = '';
    var _periodsForScopedTeam = [];
    var _selectedPeriodIndex = -1;

    // List-mode state (kept for the fallback path).
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

    /**
     * Format a period's range for display. 'present' when the end
     * is open.
     */
    function formatPeriodRange(period) {
        if (!period || typeof period !== 'object') { return ''; }

        var start = isNonEmptyString(period.startPeriod)
            ? String(period.startPeriod)
            : '?';
        var end = isNonEmptyString(period.endPeriod)
            ? String(period.endPeriod)
            : 'present';

        return start + '\u2013' + end;
    }

    /**
     * A team is exportable when it is not academic. Academic teams
     * use weeks, not years; their export flow lives in the
     * Academy module.
     */
    function isExportableTeam(team) {
        if (!team || !team.id) { return false; }
        var normalized = null;
        try {
            normalized =
                TeamConstants.normalizeTeamType(team.type);
        } catch (e) {
            normalized = team.type;
        }
        return normalized !== 'academic';
    }

    // ============================================================
    // OPEN
    // ============================================================

    /**
     * Open the picker, or export directly when applicable.
     *
     * @param {object} [options]
     * @param {string} [options.teamId]   Scope to one team. When
     *   given, the modal is a period picker for that team.
     * @param {boolean} [options.direct]  Skip the modal and
     *   export the named team immediately, when it has one
     *   period. A multi-period team still opens the period
     *   picker.
     */
    function openModal(options) {
        options = options || {};

        var teamId = isNonEmptyString(options.teamId)
            ? String(options.teamId)
            : null;

        // ---- Direct shortcut ----
        if (options.direct === true) {
            if (!teamId) {
                notify('No team selected for export.', 'error');
                return;
            }
            var directTeam = getTeam(teamId);
            if (!directTeam) {
                notify('Team not found.', 'error');
                return;
            }
            var directPeriods =
                TeamQueries.getPeriods(directTeam);
            if (directPeriods.length <= 1) {
                triggerTeamExport(teamId, null);
                return;
            }
            // Multi-period: fall through to the period modal.
        }

        closeModal();

        // ---- Scoped mode (a teamId was supplied) ----
        if (teamId) {
            openScoped(teamId);
            return;
        }

        // ---- List mode (no teamId) ----
        openList();
    }

    function getTeam(teamId) {
        try {
            return TeamQueries.getTeamById(teamId);
        } catch (e) {
            return null;
        }
    }

    // ------------------------------------------------------------
    // Scoped open — the period picker
    // ------------------------------------------------------------

    function openScoped(teamId) {
        var team = getTeam(teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return;
        }
        if (!isExportableTeam(team)) {
            notify(
                'Academic teams use the Academy export flow.',
                'info'
            );
            return;
        }

        _mode = 'period';
        _scopedTeamId = String(team.id);
        _scopedTeamName =
            TeamQueries.getCurrentTeamName(team) || 'Unnamed Team';
        _highlightTeamId = null;

        loadPeriods(team);

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

        contentEl.innerHTML = buildScopedHTML();

        _clickHandler = handleClick;
        _changeHandler = handleChange;
        contentEl.addEventListener('click', _clickHandler);
        contentEl.addEventListener('change', _changeHandler);

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);
    }

    // ------------------------------------------------------------
    // List open — the bulk picker
    // ------------------------------------------------------------

    function openList() {
        var teams = fetchTeams();
        if (teams.length === 0) {
            notify('No teams to export.', 'info');
            return;
        }

        _mode = 'list';
        _scopedTeamId = null;
        _scopedTeamName = '';
        _periodsForScopedTeam = [];
        _selectedPeriodIndex = -1;
        _highlightTeamId = null;

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

        contentEl.innerHTML = buildListHTML(teams);

        _clickHandler = handleClick;
        _changeHandler = handleChange;
        contentEl.addEventListener('click', _clickHandler);
        contentEl.addEventListener('change', _changeHandler);

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _clickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _clickHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _changeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _changeHandler
                );
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _clickHandler = null;
        _changeHandler = null;

        _mode = 'period';
        _scopedTeamId = null;
        _scopedTeamName = '';
        _periodsForScopedTeam = [];
        _selectedPeriodIndex = -1;
        _highlightTeamId = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) { /* ignore */ }
        }
    }

    // ============================================================
    // PERIODS
    // ============================================================

    /**
     * Build the period display list for a team. The last period
     * is marked current and preselected.
     */
    function loadPeriods(team) {
        _periodsForScopedTeam = [];

        var periods = TeamQueries.getPeriods(team);
        for (var i = 0; i < periods.length; i++) {
            var p = periods[i];
            _periodsForScopedTeam.push({
                periodIndex: i,
                name: isNonEmptyString(p.name)
                    ? String(p.name)
                    : 'Unnamed Period',
                range: formatPeriodRange(p),
                isCurrent: (i === periods.length - 1),
                _raw: p
            });
        }

        _selectedPeriodIndex =
            _periodsForScopedTeam.length > 0
                ? _periodsForScopedTeam.length - 1
                : -1;
    }

    // ============================================================
    // SCOPED HTML (period picker)
    // ============================================================

    function buildScopedHTML() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Team \u2014 ' +
                    escapeHtml(_scopedTeamName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="team-export-close"' +
                    '>&times;</button>';
        html += '</div>';

        html += '<div class="modal-body team-export-picker-body">';

        if (_periodsForScopedTeam.length === 0) {
            html += '<p class="empty-state">' +
                        'This team has no periods recorded. ' +
                        'It cannot be exported by period.' +
                    '</p>';
            html += '</div>';
            html += '<div class="form-actions ' +
                        'team-export-picker-footer">';
            html += '<button type="button" class="secondary" ' +
                        'data-action="team-export-close">' +
                        'Close' +
                    '</button>';
            html += '</div>';
            return html;
        }

        if (_periodsForScopedTeam.length === 1) {
            // Single-period team: no choice to make. Show the
            // period as a read-only confirmation line.
            html += '<p class="field-hint">' +
                        'This team has one period. Export it.' +
                    '</p>';
            html += renderSinglePeriodCard(
                _periodsForScopedTeam[0]
            );
        } else {
            html += '<p class="field-hint">' +
                        'Choose which period of the team to ' +
                        'export. Members and rankings are ' +
                        'filtered to the chosen period.' +
                    '</p>';
            html += renderPeriodSelector();
        }

        html += renderErrorRegion();

        html += '</div>';

        html += '<div class="form-actions ' +
                    'team-export-picker-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="team-export-close">' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="team-export-confirm">' +
                    'Export' +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderSinglePeriodCard(period) {
        var html = '';
        html += '<div class="team-export-period-single">';
        html += '<div class="team-export-period-name">' +
                    escapeHtml(period.name) +
                '</div>';
        html += '<div class="team-export-period-range">' +
                    escapeHtml(period.range) +
                '</div>';
        html += '</div>';
        return html;
    }

    function renderPeriodSelector() {
        var html = '';
        html += '<div class="team-export-period-selector">';
        html += '<div class="team-export-period-header">' +
                    'Period to export' +
                '</div>';
        html += '<div class="team-export-period-list">';

        for (var i = 0; i < _periodsForScopedTeam.length; i++) {
            html += renderPeriodOption(
                _periodsForScopedTeam[i], i
            );
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPeriodOption(period, index) {
        var checked = (index === _selectedPeriodIndex)
            ? ' checked'
            : '';

        var labelClass = 'team-export-period-option';
        if (checked) { labelClass += ' is-selected'; }

        var currentBadge = period.isCurrent
            ? ' <span class="team-export-period-current">' +
                '(current)' +
              '</span>'
            : '';

        var html = '';
        html += '<label class="' + labelClass + '">';
        html += '<input type="radio" ' +
                    'name="team-export-period" ' +
                    'value="' +
                        escapeAttribute(String(index)) + '"' +
                    checked + '>';
        html += '<span class="team-export-period-body">';
        html += '<span class="team-export-period-name">' +
                    escapeHtml(period.name) +
                    currentBadge +
                '</span>';
        html += '<span class="team-export-period-range">' +
                    escapeHtml(period.range) +
                '</span>';
        html += '</span>';
        html += '</label>';

        return html;
    }

    function renderErrorRegion() {
        return '<div id="team-export-picker-error" ' +
                    'class="team-export-picker-error" ' +
                    'style="display:none;margin-top:10px;' +
                    'padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;' +
                    'color:var(--danger);"></div>';
    }

    // ============================================================
    // LIST HTML (bulk fallback)
    // ============================================================

    function fetchTeams() {
        var all = TeamQueries.getTeams(null, null, false);
        if (!Array.isArray(all)) { return []; }

        var filtered = [];
        for (var i = 0; i < all.length; i++) {
            var team = all[i];
            if (!isExportableTeam(team)) { continue; }
            if (team.status === 'deprecated') { continue; }
            filtered.push(team);
        }

        filtered.sort(function(a, b) {
            var aName = TeamQueries.getCurrentTeamName(a) ||
                'Unnamed Team';
            var bName = TeamQueries.getCurrentTeamName(b) ||
                'Unnamed Team';
            return aName.localeCompare(bName);
        });

        return filtered;
    }

    function buildListHTML(teams) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Team</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="team-export-close"' +
                    '>&times;</button>';
        html += '</div>';

        html += '<div class="modal-body team-export-picker-body">';

        html += '<p class="field-hint">' +
                    'Choose a team to export. When a team has more ' +
                    'than one period, you will be asked which ' +
                    'period to export.' +
                '</p>';

        html += '<div class="team-export-list">';
        for (var i = 0; i < teams.length; i++) {
            html += renderTeamRow(teams[i]);
        }
        html += '</div>';

        html += renderErrorRegion();

        html += '</div>';

        return html;
    }

    function renderTeamRow(team) {
        var teamId = String(team.id);
        var name = TeamQueries.getCurrentTeamName(team) ||
            'Unnamed Team';
        var typeLabel = TeamConstants.getTypeLabel(team.type) ||
            team.type || '';
        var memberCount = Array.isArray(team.members)
            ? team.members.length
            : 0;
        var periodDisplay = formatTeamPeriod(team);

        var periods = TeamQueries.getPeriods(team);
        var periodCount = periods.length;

        var isHighlighted = _highlightTeamId &&
            String(_highlightTeamId) === teamId;

        var rowClass = 'team-export-row';
        if (isHighlighted) {
            rowClass += ' team-export-row-highlight';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '">';

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
        if (periodCount > 1) {
            html += ' \u00b7 ' + periodCount + ' periods';
        }
        html += '</div>';
        html += '</div>';

        html += '<button type="button" class="primary small" ' +
                    'data-action="team-export-run" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '">' +
                    'Export' +
                '</button>';

        html += '</div>';
        return html;
    }

    function formatTeamPeriod(team) {
        var periods = TeamQueries.getPeriods(team);
        if (periods.length === 0) { return ''; }

        var first = periods[0];
        var last = periods[periods.length - 1];

        var start = isNonEmptyString(first.startPeriod)
            ? String(first.startPeriod)
            : '';
        var end = isNonEmptyString(last.endPeriod)
            ? String(last.endPeriod)
            : '';

        if (start && end) { return start + '\u2013' + end; }
        if (start) { return start + '\u2013present'; }
        if (end) { return '\u2013' + end; }
        return '';
    }

    // ============================================================
    // INTERACTION
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;

        if (action === 'team-export-close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'team-export-confirm') {
            e.preventDefault();
            handleConfirmScoped();
            return;
        }

        if (action === 'team-export-run') {
            e.preventDefault();
            var teamId = actionEl.dataset.teamId;
            if (!teamId) { return; }
            handleListRunExport(teamId);
            return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.name) { return; }
        if (target.name !== 'team-export-period') { return; }

        var index = parseInt(String(target.value || ''), 10);
        if (isNaN(index) || index < 0) { return; }
        if (index >= _periodsForScopedTeam.length) { return; }

        _selectedPeriodIndex = index;
        renderPeriodSelectorInPlace();
    }

    // ------------------------------------------------------------
    // Scoped confirm
    // ------------------------------------------------------------

    function handleConfirmScoped() {
        var period = null;
        if (_periodsForScopedTeam.length === 1) {
            period = _periodsForScopedTeam[0]._raw;
        } else if (_selectedPeriodIndex >= 0 &&
                   _selectedPeriodIndex <
                       _periodsForScopedTeam.length) {
            period = _periodsForScopedTeam[_selectedPeriodIndex]._raw;
        } else {
            setError('Select a period first.');
            return;
        }
        triggerTeamExport(_scopedTeamId, period);
    }

    // ------------------------------------------------------------
    // List-mode run
    // ------------------------------------------------------------
    //
    // The list-mode Export button on a row scopes to that team.
    // If the team has one period, export directly. Otherwise,
    // re-open in scoped mode so the user picks a period. This
    // keeps the flow consistent: period selection always happens
    // in the scoped picker.

    function handleListRunExport(teamId) {
        var team = getTeam(teamId);
        if (!team) {
            setError('Team not found.');
            return;
        }

        var periods = TeamQueries.getPeriods(team);
        if (periods.length <= 1) {
            triggerTeamExport(teamId, null);
            return;
        }

        // Re-open in scoped mode. This closes the list modal and
        // opens the period picker for the chosen team.
        closeModal();
        openScoped(teamId);
    }

    // ------------------------------------------------------------
    // In-place period selector re-render
    // ------------------------------------------------------------

    function renderPeriodSelectorInPlace() {
        if (!_contentEl) { return; }

        var existing = _contentEl.querySelector(
            '.team-export-period-selector'
        );
        if (!existing) { return; }

        var wrapper = document.createElement('div');
        wrapper.innerHTML = renderPeriodSelector();
        var replacement = wrapper.firstElementChild;
        if (replacement) {
            existing.parentNode.replaceChild(
                replacement, existing
            );
        }
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function triggerTeamExport(teamId, period) {
        var result;
        try {
            result = TeamExport.exportTeam(
                teamId,
                period ? { period: period } : {}
            );
        } catch (err) {
            console.warn(
                '[TeamExportPicker] TeamExport.exportTeam threw:',
                err
            );
            if (_contentEl) {
                setError(
                    'Export failed: ' + (err.message || String(err))
                );
            } else {
                notify(
                    'Team export failed: ' + err.message,
                    'error'
                );
            }
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

        var errorMessage = (result && result.error) ||
            'Unknown error';

        if (_contentEl) {
            setError(errorMessage);
        } else {
            notify(
                'Team export failed: ' + errorMessage,
                'error'
            );
        }
    }

    function setError(message) {
        if (!_contentEl) { return; }
        var errEl = _contentEl.querySelector(
            '#team-export-picker-error'
        );
        if (!errEl) { return; }

        if (!message) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            return;
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
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
