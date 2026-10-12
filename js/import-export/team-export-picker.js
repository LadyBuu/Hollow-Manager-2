/**
 * modules/teams/team-export-picker.js - Team Export Picker
 * Modal that lists teams and triggers TeamExport for one, with a
 * period selector when the team has more than one period.
 *
 * Path: js/modules/teams/team-export-picker.js
 *
 * WHAT THIS OWNS:
 *   - The picker modal: render, open, close.
 *   - Team list population from TeamQueries.
 *   - Delegated click handling for "export this team" buttons.
 *   - Calling TeamExport.exportTeam(teamId, { period }).
 *   - The PERIOD SELECTOR: a radio list of the team's periods
 *     when there is more than one.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The export itself. TeamExport owns the projection and
 *     download.
 *   - The periods array shape. TeamCore owns the schema.
 *   - Long-lived state. One open at a time; teardown on close.
 *
 * OPENING MODES:
 *   openModal()                     lists all operational teams.
 *   openModal({ teamId })           lists all teams, highlights
 *                                   and scrolls to the given
 *                                   team.
 *   openModal({ teamId, direct: true })
 *                                   when the team has one period,
 *                                   exports immediately; when it
 *                                   has more than one, opens the
 *                                   picker focused on that team
 *                                   so the user chooses a period.
 *
 *   The direct mode's behaviour splits on period count. A
 *   single-period team has nothing for the user to choose, so
 *   the export fires directly (matching the previous
 *   behaviour). A multi-period team has a real choice to make,
 *   so the picker opens.
 *
 * PERIOD SELECTOR BEHAVIOUR:
 *   When the selected team has one period, no period selector is
 *   shown. When it has more than one, the modal shows a radio
 *   list of periods above the format picker:
 *
 *     ( ) Rapid (1900–1905)
 *     (•) Rapid II (1905–present)
 *
 *   The default selection is the CURRENT period (the last one).
 *   The user may select any other period to export.
 *
 *   The selection is passed to TeamExport.exportTeam as
 *   `{ period: <the period entry> }`. TeamExport filters the
 *   member list and ranking history to that period, per the
 *   half-open predicate.
 *
 * RESULT REPORTING:
 *   The export routes through TeamExport and reports via
 *   NotificationSystem. On success, the modal closes. On failure,
 *   the modal stays open and the error appears in a footer region.
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

    // The currently selected team's period list, as display VMs.
    // Rebuilt whenever the user picks a different team.
    var _selectedTeamId = null;
    var _selectedPeriodIndex = -1;
    var _periodsForSelected = [];

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

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
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
     * Build a display VM for one period. The VM carries a
     * `periodIndex` used by the radio group, plus the period entry
     * itself under `_raw` for passing to TeamExport.
     *
     * The `_raw` field is stripped before serialisation. It exists
     * so the click handler does not have to walk the team's
     * periods array again by index.
     */
    function buildPeriodDisplayVM(period, index) {
        return {
            periodIndex: index,
            name: isNonEmptyString(period.name)
                ? String(period.name)
                : 'Unnamed Period',
            range: formatPeriodRange(period),
            isCurrent: false,
            _raw: period
        };
    }

    // ============================================================
    // OPEN
    // ============================================================

    /**
     * Open the picker, or export directly when applicable.
     *
     * @param {object} [options]
     * @param {string} [options.teamId]  Preselect and highlight.
     * @param {boolean} [options.direct] Skip the modal and export
     *   the specified team immediately, when it has one period.
     *   When the team has more than one period, opens the picker
     *   focused on that team so the user chooses a period.
     */
    function openModal(options) {
        options = options || {};

        var teamId = isNonEmptyString(options.teamId)
            ? String(options.teamId)
            : null;

        // ---- Direct mode ----
        if (options.direct === true) {
            if (!teamId) {
                notify(
                    'No team selected for export.',
                    'error'
                );
                return;
            }

            var team = null;
            try {
                team = TeamQueries.getTeamById(teamId);
            } catch (e) {
                team = null;
            }

            if (!team) {
                notify('Team not found.', 'error');
                return;
            }

            var periods = TeamQueries.getPeriods(team);

            if (periods.length <= 1) {
                // Single-period team. Export immediately.
                triggerTeamExport(teamId, null);
                return;
            }

            // Multi-period team. Fall through to the modal,
            // focused on this team.
        }

        closeModal();

        _highlightTeamId = teamId;

        var teams = fetchTeams();
        if (teams.length === 0) {
            notify('No teams to export.', 'info');
            return;
        }

        // ---- Initial period selection ----
        //
        // When the highlighted team has periods, build the period
        // list and preselect the current (last) period.
        if (teamId) {
            var highlighted = findTeamById(teams, teamId);
            if (highlighted) {
                loadPeriodsForTeam(highlighted);
                _selectedTeamId = String(highlighted.id);
            }
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
        _selectedTeamId = null;
        _selectedPeriodIndex = -1;
        _periodsForSelected = [];

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
            var aName = TeamQueries.getCurrentTeamName(a) ||
                'Unnamed Team';
            var bName = TeamQueries.getCurrentTeamName(b) ||
                'Unnamed Team';
            return aName.localeCompare(bName);
        });

        return filtered;
    }

    function findTeamById(teams, teamId) {
        var target = String(teamId);
        for (var i = 0; i < teams.length; i++) {
            if (String(teams[i].id) === target) {
                return teams[i];
            }
        }
        return null;
    }

    /**
     * Load the period list for a team into module state. Called
     * when the picker opens on a highlighted team, and when the
     * user selects a different team from the list.
     *
     * The last period is marked as current. The selection index
     * defaults to the current period.
     */
    function loadPeriodsForTeam(team) {
        _periodsForSelected = [];

        if (!team) {
            _selectedPeriodIndex = -1;
            return;
        }

        var periods = TeamQueries.getPeriods(team);
        for (var i = 0; i < periods.length; i++) {
            var vm = buildPeriodDisplayVM(periods[i], i);
            if (i === periods.length - 1) {
                vm.isCurrent = true;
            }
            _periodsForSelected.push(vm);
        }

        // Default selection is the current period.
        if (_periodsForSelected.length > 0) {
            _selectedPeriodIndex =
                _periodsForSelected.length - 1;
        } else {
            _selectedPeriodIndex = -1;
        }
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

        html += '<div class="modal-body team-export-picker-body">';

        html += '<p class="field-hint">' +
                    'Choose a team to export. The report is a ' +
                    'plain-text document containing the team ' +
                    'header, name and ranking history, member ' +
                    'stints, and a character snapshot for each ' +
                    'member.' +
                '</p>';

        // ---- Period selector ----
        //
        // Rendered when the currently-selected team has more
        // than one period. The list is populated from
        // _periodsForSelected, which loadPeriodsForTeam builds.
        html += renderPeriodSelector();

        // ---- Team list ----
        html += '<div class="team-export-list">';

        for (var i = 0; i < teams.length; i++) {
            html += renderTeamRow(teams[i]);
        }

        html += '</div>';

        // ---- Error region ----
        html += '<div id="team-export-picker-error" ' +
                    'class="team-export-picker-error" ' +
                    'style="display:none;margin-top:10px;' +
                    'padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;' +
                    'color:var(--danger);"></div>';

        html += '</div>';

        return html;
    }

    /**
     * Render the period selector.
     *
     * When the selected team has one period, returns an empty
     * string (no selector shown). When it has more than one,
     * renders a radio group above the team list.
     *
     * The group is disabled when no team is selected.
     */
    function renderPeriodSelector() {
        if (_periodsForSelected.length <= 1) {
            return '';
        }

        var html = '';
        html += '<div class="team-export-period-selector">';
        html += '<div class="team-export-period-header">' +
                    'Period to export' +
                '</div>';

        html += '<div class="team-export-period-list">';

        for (var i = 0; i < _periodsForSelected.length; i++) {
            html += renderPeriodOption(
                _periodsForSelected[i], i
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
        if (checked) {
            labelClass += ' is-selected';
        }

        var nameSuffix = period.isCurrent
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
                    nameSuffix +
                '</span>';
        html += '<span class="team-export-period-range">' +
                    escapeHtml(period.range) +
                '</span>';
        html += '</span>';
        html += '</label>';

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

        var isSelected = _selectedTeamId &&
            String(_selectedTeamId) === teamId;

        var rowClass = 'team-export-row';
        if (isHighlighted) {
            rowClass += ' team-export-row-highlight';
        }
        if (isSelected) {
            rowClass += ' team-export-row-selected';
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
        if (periodCount > 1) {
            html += ' \u00b7 ' + periodCount + ' periods';
        }
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

    function formatTeamPeriod(team) {
        var periods = TeamQueries.getPeriods(team);
        if (periods.length === 0) {
            return '';
        }

        var first = periods[0];
        var last = periods[periods.length - 1];

        var start = isNonEmptyString(first.startPeriod)
            ? String(first.startPeriod)
            : '';
        var end = isNonEmptyString(last.endPeriod)
            ? String(last.endPeriod)
            : '';

        if (start && end) {
            return start + '\u2013' + end;
        }
        if (start) { return start + '\u2013present'; }
        if (end) { return '\u2013' + end; }
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

        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;

        if (action === 'team-export-close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'team-export-run') {
            e.preventDefault();
            var teamId = actionEl.dataset.teamId;
            if (!teamId) { return; }
            handleRunExport(teamId);
            return;
        }
    }

    /**
     * Handle the Export button on a team row.
     *
     * When the clicked team is different from the currently-
     * selected one, the period list is reloaded (with the current
     * period preselected) and the export fires immediately with
     * the current period. That matches the user's intent: they
     * clicked a specific team's Export button, so export that
     * team.
     *
     * When the clicked team is already selected (the user has
     * chosen a period from the selector), the export fires with
     * the selected period.
     *
     * Single-period teams export immediately; there is no
     * selection to make.
     */
    function handleRunExport(teamId) {
        var team = null;
        try {
            team = TeamQueries.getTeamById(teamId);
        } catch (e) {
            team = null;
        }

        if (!team) {
            setError('Team not found.');
            return;
        }

        var periods = TeamQueries.getPeriods(team);

        // Single-period team: export immediately, no selection.
        if (periods.length <= 1) {
            triggerTeamExport(teamId, null);
            return;
        }

        // Multi-period team. If this row is already the selected
        // one, use the currently-selected period. Otherwise,
        // select this team's current period and export that.
        var targetId = String(teamId);
        var isAlreadySelected = (_selectedTeamId === targetId);

        var periodToExport;
        if (isAlreadySelected &&
            _selectedPeriodIndex >= 0 &&
            _selectedPeriodIndex < _periodsForSelected.length) {
            periodToExport =
                _periodsForSelected[_selectedPeriodIndex]._raw;
        } else {
            // Select the team and use its current period.
            loadPeriodsForTeam(team);
            _selectedTeamId = targetId;
            if (_periodsForSelected.length > 0) {
                periodToExport =
                    _periodsForSelected[
                        _periodsForSelected.length - 1
                    ]._raw;
            } else {
                periodToExport = null;
            }
        }

        triggerTeamExport(teamId, periodToExport);
    }

    /**
     * Fire the export and report the result.
     *
     * @param {string} teamId
     * @param {object|null} period  A period entry, or null for
     *   the current period without scoping.
     */
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

        var errorMessage = (result && result.error) ||
            'Unknown error';

        // When the picker is open, show the error inline so the
        // user can retry or pick another period without losing
        // the modal. In direct mode (no modal), notify.
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
    // PERIOD RADIO CHANGE
    // ============================================================
    //
    // The picker's HTML emits radio inputs for the period list.
    // Changing one updates _selectedPeriodIndex and re-renders
    // the selector so the is-selected class moves. Because the
    // radio group is inside the content element (not a form
    // element with a submit), a change event is dispatched by
    // the browser when the user clicks a different radio.
    //
    // The handler is bound at the same time as the click handler
    // and removed on close.

    var _changeHandler = null;

    function bindChangeHandler() {
        if (!_contentEl) { return; }

        _changeHandler = function(e) {
            var target = e.target;
            if (!target || !target.name) { return; }
            if (target.name !== 'team-export-period') { return; }

            var value = String(target.value || '');
            var index = parseInt(value, 10);
            if (isNaN(index) || index < 0) { return; }
            if (index >= _periodsForSelected.length) { return; }

            _selectedPeriodIndex = index;
            renderPeriodSelectorInPlace();
        };

        _contentEl.addEventListener('change', _changeHandler);
    }

    function unbindChangeHandler() {
        if (_contentEl && _changeHandler) {
            try {
                _contentEl.removeEventListener(
                    'change', _changeHandler
                );
            } catch (e) {
                // Ignore.
            }
        }
        _changeHandler = null;
    }

    /**
     * Re-render just the period selector. Called when the user
     * changes the radio selection.
     */
    function renderPeriodSelectorInPlace() {
        if (!_contentEl) { return; }

        var existing = _contentEl.querySelector(
            '.team-export-period-selector'
        );
        if (!existing) {
            // No selector currently rendered. Nothing to update.
            return;
        }

        var html = renderPeriodSelector();
        if (html === '') {
            // The selector should no longer be shown.
            existing.parentNode.removeChild(existing);
            return;
        }

        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        var replacement = wrapper.firstElementChild;
        if (replacement) {
            existing.parentNode.replaceChild(
                replacement, existing
            );
        }
    }

    // ============================================================
    // TEAM ROW SELECTION
    // ============================================================
    //
    // Clicking a team row's info area (not its Export button)
    // selects the team for the period selector. The row itself
    // carries data-team-id; the Export button is a child. To
    // avoid double-handling, the click handler checks whether
    // the target is inside the Export button.

    // (The row selection handler is merged into handleClick.)

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
