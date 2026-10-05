/**
 * js/import-export/character-export-picker.js - Character Export Picker
 * Modal that offers four character export formats:
 *
 *   Full report       every detail, one file, all selected characters
 *                     concatenated with a bulk banner
 *   General           a curated subset: identity, physical,
 *                     personality, combat, all-time class names,
 *                     professional teams, career status,
 *                     departments, social. No missions, no notes,
 *                     no academic history beyond class names.
 *   Simplified        the roster: name, gender, birth year, eliminated
 *   Blank template    a CSV template for authoring new characters
 *
 * Path: js/import-export/character-export-picker.js
 *
 * SCOPE:
 *   The picker accepts an optional `characterIds` array. When
 *   supplied, the three report formats (Full, General, Simplified)
 *   export only those characters. When omitted or empty, all three
 *   export every character in the store.
 *
 *   The template format is never scoped. A blank template is a
 *   blank template regardless of selection.
 *
 * FORMAT SEMANTICS:
 *   Full report       CharacterExport.exportSelectedText(charIds)
 *                     or CharacterExport.exportCharacterText(id)
 *                     when a single character is selected.
 *   General           CharacterExport.exportGeneralSelectedText(charIds)
 *                     or CharacterExport.exportGeneralText(id)
 *                     when a single character is selected.
 *   Simplified        CharacterRosterExport.exportSelectedText(charIds)
 *                     or CharacterRosterExport.exportText()
 *                     when the whole store is in scope.
 *   Blank template    CharacterCSV.exportTemplate()
 *
 *   The picker opens the target module lazily at click time. A
 *   missing module produces a toast, not a boot-time crash.
 *
 * WHAT THIS MODULE OWNS:
 *   - The modal shell
 *   - The format radio group
 *   - The pre-flight count
 *   - The scope summary line
 *   - The export button and its result reporting
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The character list            (CharacterQueries)
 *   - The download                  (ExportUtils, via the targets)
 *   - The header button             (characters/index.js)
 *   - Selection state               (CharacterList owns it; the
 *                                    caller passes the current
 *                                    selection in)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, resolved at click time):
 *   - window.CharacterCSV
 *   - window.CharacterRosterExport
 *   - window.CharacterExport
 *   - window.CharacterQueries       (pre-flight count)
 */

(function() {
    'use strict';

    if (window.__characterExportPickerLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

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

    if (_missing.length > 0) {
        throw new Error(
            '[CharacterExportPicker] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__characterExportPickerLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _selectedFormat = 'report';
    var _characterIds = null;
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

    /**
     * Open the character export picker.
     *
     * @param {object} [options]
     * @param {string} [options.initialFormat] - Preselect a format
     * @param {string[]} [options.characterIds] - Scope the report
     *   formats (Full, General, Simplified) to these character IDs.
     *   When omitted or empty, the whole store is in scope.
     * @param {function} [options.onClose]     - Called once on close
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(options) {
        options = options || {};

        closeModal();

        _selectedFormat = isNonEmptyString(options.initialFormat)
            ? String(options.initialFormat)
            : 'report';

        _characterIds = null;
        if (Array.isArray(options.characterIds) &&
            options.characterIds.length > 0) {
            var seen = Object.create(null);
            var cleaned = [];
            for (var i = 0; i < options.characterIds.length; i++) {
                var raw = options.characterIds[i];
                if (raw === null || raw === undefined) { continue; }
                var s = String(raw);
                if (s === '' || seen[s]) { continue; }
                seen[s] = true;
                cleaned.push(s);
            }
            if (cleaned.length > 0) {
                _characterIds = cleaned;
            }
        }

        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        var shell = Modal.createModal(
            'character-export-picker-modal'
        );
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'character-export-picker-modal';

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
                    '[CharacterExportPicker] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _selectedFormat = 'report';
        _characterIds = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function getWholeStoreCount() {
        if (!window.CharacterQueries ||
            typeof window.CharacterQueries.getCharacters !==
                'function') {
            return null;
        }
        try {
            var chars = window.CharacterQueries.getCharacters() || [];
            return chars.length;
        } catch (e) {
            return null;
        }
    }

    /**
     * Returns { scope: 'all' | 'selected', count: number }.
     *
     *   scope 'selected' with a live count means characterIds is
     *   set; the count reflects how many of those IDs resolve to
     *   actual characters.
     *
     *   scope 'all' means the whole store is in scope. count is
     *   the store size (or null when CharacterQueries is absent).
     */
    function getScope() {
        if (_characterIds && _characterIds.length > 0) {
            var live = 0;
            if (window.CharacterQueries &&
                typeof window.CharacterQueries.getCharacterById ===
                    'function') {
                for (var i = 0; i < _characterIds.length; i++) {
                    try {
                        if (window.CharacterQueries
                                .getCharacterById(
                                    _characterIds[i]
                                )) {
                            live++;
                        }
                    } catch (e) { /* ignore */ }
                }
            } else {
                live = _characterIds.length;
            }
            return { scope: 'selected', count: live };
        }
        return { scope: 'all', count: getWholeStoreCount() };
    }

    function getFormatAvailability() {
        var csv = window.CharacterCSV || null;
        var roster = window.CharacterRosterExport || null;
        var report = window.CharacterExport || null;

        return {
            report: report !== null &&
                (typeof report.exportSelectedText === 'function' ||
                 typeof report.exportCharacterText === 'function'),
            general: report !== null &&
                (typeof report.exportGeneralSelectedText === 'function' ||
                 typeof report.exportGeneralText === 'function'),
            simplified: roster !== null &&
                (typeof roster.exportSelectedText === 'function' ||
                 typeof roster.exportText === 'function'),
            template: csv !== null &&
                typeof csv.exportTemplate === 'function'
        };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        _contentEl.innerHTML = buildModalHTML();
    }

    function buildModalHTML() {
        var scope = getScope();
        var availability = getFormatAvailability();

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Characters</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += buildScopeSummaryHTML(scope);

        html += '<div class="character-export-picker-formats">';
        html += '<p class="field-hint character-export-picker-hint">' +
                    'Pick a format, then click Export.' +
                '</p>';

        html += buildFormatRow(
            'report',
            'Full report',
            'Every detail \u2014 identity, personality, combat, ' +
            'academic history, teams, departments, relationships, ' +
            'missions, tournaments. One text file.',
            availability.report
        );

        html += buildFormatRow(
            'general',
            'General',
            'A curated subset \u2014 identity, physical, ' +
            'personality, combat, class names, professional teams, ' +
            'career status, departments, relationships. No missions, ' +
            'no notes, no academic history.',
            availability.general
        );

        html += buildFormatRow(
            'simplified',
            'Simplified',
            'Name, gender, birth year, and elimination year. ' +
            'A plain-text roster.',
            availability.simplified
        );

        html += buildFormatRow(
            'template',
            'Blank template',
            'A CSV template with example rows. ' +
            'Use it to author new characters by hand.',
            availability.template
        );

        html += '</div>';

        html += '</div>';

        var canExport = isFormatAvailable(
            _selectedFormat, availability
        );
        var hasData = scope.count === null
            ? true
            : scope.count > 0;
        var templateSelected = _selectedFormat === 'template';

        var exportDisabled = templateSelected
            ? !canExport
            : (!canExport || !hasData);

        var exportLabel = 'Export';
        if (!templateSelected && scope.scope === 'selected' &&
            scope.count !== null && scope.count > 0) {
            exportLabel = 'Export ' + scope.count +
                ' character' + (scope.count === 1 ? '' : 's');
        }

        html += '<div class="modal-footer character-export-picker-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="close">' +
                    'Close' +
                '</button>';

        html += '<span class="character-export-picker-footer-spacer">' +
                '</span>';

        html += '<button type="button" class="primary" ' +
                    'data-picker-action="export"' +
                    (exportDisabled ? ' disabled' : '') + '>' +
                    escapeHtml(exportLabel) +
                '</button>';

        html += '</div>';

        return html;
    }

    function buildScopeSummaryHTML(scope) {
        var html = '';
        html += '<div class="character-export-picker-preview">';

        if (scope.scope === 'selected') {
            html += '<div class="character-export-picker-counts">';
            html += '<span class="character-export-picker-count">' +
                        'Exporting <strong>' + scope.count +
                        '</strong> selected character' +
                        (scope.count === 1 ? '' : 's') +
                    '</span>';
            html += '</div>';
        } else if (scope.count === null) {
            html += '<p class="empty-state">' +
                        'Character data is not available.' +
                    '</p>';
        } else if (scope.count === 0) {
            html += '<p class="empty-state">' +
                        'No characters to export.' +
                    '</p>';
        } else {
            html += '<div class="character-export-picker-counts">';
            html += '<span class="character-export-picker-count">' +
                        'Exporting <strong>' + scope.count +
                        '</strong> ' +
                        (scope.count === 1 ? 'character' : 'characters') +
                        ' in the store' +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function buildFormatRow(format, title, description, available) {
        var checked = _selectedFormat === format ? ' checked' : '';
        var disabled = available ? '' : ' disabled';

        var rowClass = 'character-export-picker-format';
        if (checked) { rowClass += ' is-selected'; }
        if (!available) { rowClass += ' is-disabled'; }

        var html = '';
        html += '<label class="' + rowClass + '" ' +
                    'data-format="' + escapeAttribute(format) + '">';

        html += '<input type="radio" name="character-export-format" ' +
                    'value="' + escapeAttribute(format) + '"' +
                    checked + disabled + '>';

        html += '<span class="character-export-picker-format-body">';
        html += '<span class="character-export-picker-format-title">' +
                    escapeHtml(title) +
                '</span>';
        html += '<span class="character-export-picker-format-desc">' +
                    escapeHtml(description) +
                '</span>';
        if (!available) {
            html += '<span class="character-export-picker-format-unavailable">' +
                        'Not available' +
                    '</span>';
        }
        html += '</span>';

        html += '</label>';

        return html;
    }

    function isFormatAvailable(format, availability) {
        if (format === 'report') { return availability.report; }
        if (format === 'general') { return availability.general; }
        if (format === 'simplified') {
            return availability.simplified;
        }
        if (format === 'template') { return availability.template; }
        return false;
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

        if (action === 'export') {
            e.preventDefault();
            handleExport();
            return;
        }
    }

    function handleContentChange(e) {
        var target = e.target;
        if (!target || !target.name) { return; }
        if (target.name !== 'character-export-format') { return; }

        _selectedFormat = target.value || 'report';

        renderContent();
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function handleExport() {
        var result;

        try {
            if (_selectedFormat === 'report') {
                result = runReportExport();
            } else if (_selectedFormat === 'general') {
                result = runGeneralExport();
            } else if (_selectedFormat === 'simplified') {
                result = runSimplifiedExport();
            } else if (_selectedFormat === 'template') {
                result = runTemplateExport();
            } else {
                notify('Unknown export format.', 'error');
                return;
            }
        } catch (err) {
            console.warn(
                '[CharacterExportPicker] export threw:', err
            );
            notify(
                'Export failed: ' + err.message,
                'error'
            );
            return;
        }

        if (!result) {
            notify('Export module is not available.', 'error');
            return;
        }

        if (result.exported) {
            var label = _formatLabel(_selectedFormat);
            var countPart = '';
            if (typeof result.count === 'number') {
                countPart = ' (' + result.count + ')';
            }
            notify(
                label + ' exported' + countPart + ': ' +
                result.filename,
                'success'
            );
            closeModal();
            return;
        }

        var err = result.error || 'Unknown error';
        notify('Export failed: ' + err, 'error');
    }

    function _formatLabel(format) {
        if (format === 'report') { return 'Full report'; }
        if (format === 'general') { return 'General report'; }
        if (format === 'simplified') { return 'Simplified'; }
        if (format === 'template') { return 'Template'; }
        return 'Export';
    }

    function runReportExport() {
        var report = window.CharacterExport;
        if (!report) { return null; }

        // Scoped to a selection.
        if (_characterIds && _characterIds.length > 0) {
            if (typeof report.exportSelectedText !== 'function') {
                return null;
            }
            return report.exportSelectedText(_characterIds);
        }

        // Whole store. There is no single "export all reports"
        // helper, so build the selection from every character
        // currently in the store, then defer to the same code path.
        if (!window.CharacterQueries ||
            typeof window.CharacterQueries.getCharacters !==
                'function') {
            return null;
        }
        var all = [];
        try {
            all = window.CharacterQueries.getCharacters() || [];
        } catch (e) {
            return null;
        }
        var ids = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] && all[i].id) {
                ids.push(String(all[i].id));
            }
        }
        if (ids.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }
        return report.exportSelectedText(ids);
    }

    function runGeneralExport() {
        var report = window.CharacterExport;
        if (!report) { return null; }

        // Scoped to a selection.
        if (_characterIds && _characterIds.length > 0) {
            if (typeof report.exportGeneralSelectedText !==
                'function') {
                return null;
            }
            return report.exportGeneralSelectedText(_characterIds);
        }

        // Whole store. Same shape as runReportExport: build the
        // full ID list from the store, then defer to the bulk
        // helper so the file layout matches the selected path.
        if (!window.CharacterQueries ||
            typeof window.CharacterQueries.getCharacters !==
                'function') {
            return null;
        }
        var all = [];
        try {
            all = window.CharacterQueries.getCharacters() || [];
        } catch (e) {
            return null;
        }
        var ids = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] && all[i].id) {
                ids.push(String(all[i].id));
            }
        }
        if (ids.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }
        if (typeof report.exportGeneralSelectedText !==
            'function') {
            return null;
        }
        return report.exportGeneralSelectedText(ids);
    }

    function runSimplifiedExport() {
        var roster = window.CharacterRosterExport;
        if (!roster) { return null; }

        if (_characterIds && _characterIds.length > 0) {
            if (typeof roster.exportSelectedText !== 'function') {
                return null;
            }
            return roster.exportSelectedText(_characterIds);
        }

        if (typeof roster.exportText !== 'function') {
            return null;
        }
        return roster.exportText();
    }

    function runTemplateExport() {
        var csv = window.CharacterCSV;
        if (!csv || typeof csv.exportTemplate !== 'function') {
            return null;
        }

        var result = csv.exportTemplate();
        if (result && result.exported) {
            return {
                exported: true,
                filename: result.filename,
                count: null,
                error: null
            };
        }
        return {
            exported: false,
            filename: null,
            count: null,
            error: 'Template export failed.'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterExportPicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterExportPicker;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterExportPicker] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
