/**
 * js/import-export/team-export-picker.js - Team Export Picker
 * Modal that offers plain-text / CSV export of all professional
 * teams.
 *
 * Path: js/import-export/team-export-picker.js
 *
 * WHY A PICKER FOR A NON-PARAMETERIZED EXPORT:
 *   Teams are not scoped the way graduates are. "All professional
 *   teams" is a single well-defined set. The picker exists as the
 *   place where the user chooses the format, and where they see a
 *   pre-flight count before downloading.
 *
 * FORMATS:
 *   Text (default) - a plain-text document designed to be read.
 *     Sparse; sections collapse when empty; sub-objects are
 *     flattened into prose. This is the primary format.
 *
 *   CSV - a flat grid, one row per stint. Useful for spreadsheet
 *     work and scripting. JSON-shaped fields remain encoded.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.TeamExport
 */

(function() {
    'use strict';

    if (window.__teamExportPickerLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var TeamExport = window.TeamExport;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
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
    if (!TeamExport ||
        typeof TeamExport.exportTeamsText !== 'function' ||
        typeof TeamExport.exportTeamsCSV !== 'function' ||
        typeof TeamExport.getTeams !== 'function') {
        _missing.push('TeamExport API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExportPicker] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamExportPickerLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _statusFilter = 'all';
    var _onClose = null;

    var _contentChangeHandler = null;
    var _contentClickHandler = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    function openModal(options) {
        options = options || {};

        closeModal();

        _statusFilter = isNonEmptyString(options.initialStatus)
            ? String(options.initialStatus)
            : 'all';
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        var shell = Modal.createModal('team-export-picker-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'team-export-picker-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);

        renderContent();

        Modal.modalSetup(shell, function() {
            closeModal();
        });
        Modal.showModal(shell);

        return shell;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        resetState();

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        if (onClose) {
            try {
                onClose();
            } catch (e) {
                console.warn(
                    '[TeamExportPicker] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _statusFilter = 'all';
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function buildViewModel() {
        var options = {};
        if (_statusFilter !== 'all') {
            options.status = _statusFilter;
        }

        var vm;
        try {
            vm = TeamExport.getTeams(options);
        } catch (e) {
            console.warn('[TeamExportPicker] getTeams threw:', e);
            vm = {
                teamCount: 0,
                memberCount: 0,
                stintCount: 0,
                teams: []
            };
        }

        return {
            statusFilter: _statusFilter,
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            stintCount: vm.stintCount
        };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        var vm = buildViewModel();
        _contentEl.innerHTML = buildModalHTML(vm);
    }

    function buildModalHTML(vm) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Professional Teams</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint">' +
                    'Exports every professional team with its ' +
                    'members, each member\'s stints (join / leave ' +
                    'periods), and full character stats.' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="team-export-picker-status-select">' +
                    'Team Status' +
                '</label>';
        html += '<select id="team-export-picker-status-select" ' +
                    'class="team-export-picker-status-select">';

        var statuses = [
            { value: 'all', label: 'All (active + inactive)' },
            { value: 'active', label: 'Active only' },
            { value: 'inactive', label: 'Inactive only' }
        ];
        for (var i = 0; i < statuses.length; i++) {
            var s = statuses[i];
            var selected = String(s.value) === String(vm.statusFilter)
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(s.value) + '"' + selected + '>' +
                        escapeHtml(s.label) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="team-export-picker-preview">';
        if (vm.teamCount === 0) {
            html += '<p class="empty-state">' +
                        'No professional teams match this filter.' +
                    '</p>';
        } else {
            html += '<div class="team-export-picker-counts">';
            html += '<span class="team-export-picker-count">' +
                        '<strong>' + vm.teamCount + '</strong> ' +
                        (vm.teamCount === 1 ? 'team' : 'teams') +
                    '</span>';
            html += '<span class="team-export-picker-count">' +
                        '<strong>' + vm.memberCount + '</strong> ' +
                        (vm.memberCount === 1 ? 'member' : 'members') +
                    '</span>';
            html += '<span class="team-export-picker-count">' +
                        '<strong>' + vm.stintCount + '</strong> ' +
                        (vm.stintCount === 1 ? 'stint' : 'stints') +
                    '</span>';
            html += '</div>';
            html += '<p class="field-hint team-export-picker-note">' +
                        'Text format is a human-readable document. ' +
                        'CSV format is a flat grid for spreadsheets.' +
                    '</p>';
        }
        html += '</div>';

        html += '</div>';

        var hasTeams = vm.teamCount > 0;

        html += '<div class="modal-footer team-export-picker-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="close">' +
                    'Close' +
                '</button>';

        html += '<span class="team-export-picker-footer-spacer"></span>';

        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="export-csv"' +
                    (hasTeams ? '' : ' disabled') + '>' +
                    'Export CSV' +
                '</button>';

        html += '<button type="button" class="primary" ' +
                    'data-picker-action="export-text"' +
                    (hasTeams ? '' : ' disabled') + '>' +
                    'Export Text' +
                '</button>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-picker-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.pickerAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'export-text') {
            e.preventDefault();
            handleExport('text');
            return;
        }

        if (action === 'export-csv') {
            e.preventDefault();
            handleExport('csv');
            return;
        }
    }

    function handleContentChange(e) {
        var target = e.target;
        if (!target || !target.classList) { return; }

        if (target.classList.contains(
            'team-export-picker-status-select'
        )) {
            _statusFilter = isNonEmptyString(target.value)
                ? String(target.value)
                : 'all';
            renderContent();
        }
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function buildExportOptions() {
        var options = {};
        if (_statusFilter !== 'all') {
            options.status = _statusFilter;
        }
        return options;
    }

    function handleExport(format) {
        var options = buildExportOptions();
        var result;

        try {
            if (format === 'text') {
                result = TeamExport.exportTeamsText(options);
            } else {
                result = TeamExport.exportTeamsCSV(options);
            }
        } catch (err) {
            console.warn(
                '[TeamExportPicker] export threw:', err
            );
            notify('Team export failed: ' + err.message, 'error');
            return;
        }

        if (result && result.exported) {
            var message = 'Exported ' + result.teamCount + ' team(s)';
            if (typeof result.memberCount === 'number') {
                message += ', ' + result.memberCount + ' member(s)';
            }
            message += ': ' + result.filename;
            notify(message, 'success');
            closeModal();
            return;
        }

        var error = (result && result.error) ? result.error : '';

        if (error === 'No professional teams found.') {
            notify(error, 'warning');
            renderContent();
            return;
        }

        notify(
            'Team export failed: ' + (error || 'Unknown error'),
            'error'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExportPicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    (function verify() {
        var exports = window.TeamExportPicker;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExportPicker] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
