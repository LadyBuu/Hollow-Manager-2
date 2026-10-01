/**
 * js/import-export/character-export-picker.js - Character Export Picker
 * Modal that offers three character export formats:
 *
 *   Full CSV        every field, one row per character, spreadsheet-ready
 *   Roster (text)   name, gender, birth year, eliminated, human-readable
 *   Blank template  the CSV template for authoring new characters
 *
 * Path: js/import-export/character-export-picker.js
 *
 * WHY A PICKER:
 *   Before this module, three separate icon buttons in the character
 *   header each opened a different download. The icons (↓ ▤ ☰) were
 *   not self-describing, the header clipped on narrow viewports, and
 *   users could not tell "export characters" from "export roster."
 *
 *   The picker makes the choice explicit and textual, and collapses
 *   the header down to a single Export button.
 *
 * FORMAT SEMANTICS:
 *   Full CSV        CharacterCSV.exportFromData
 *   Roster (text)   CharacterRosterExport.exportText
 *   Blank template  CharacterCSV.exportTemplate
 *
 *   The picker opens the target module lazily at click time. A
 *   missing module produces a toast, not a boot-time crash.
 *
 * WHAT THIS MODULE OWNS:
 *   - The modal shell
 *   - The format radio group
 *   - The pre-flight count
 *   - The export button and its result reporting
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The character list            (CharacterQueries)
 *   - The download                  (ExportUtils, via the targets)
 *   - The header button             (characters/index.js)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, resolved at click time):
 *   - window.CharacterCSV
 *   - window.CharacterRosterExport
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
    var _selectedFormat = 'csv';
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
     * @param {function} [options.onClose]     - Called once on close
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(options) {
        options = options || {};

        closeModal();

        _selectedFormat = isNonEmptyString(options.initialFormat)
            ? String(options.initialFormat)
            : 'csv';
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        var shell = Modal.createModal('character-export-picker-modal');
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
        _selectedFormat = 'csv';
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function getCharacterCount() {
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

    function getFormatAvailability() {
        var csv = window.CharacterCSV || null;
        var roster = window.CharacterRosterExport || null;

        return {
            csv: csv !== null &&
                 typeof csv.exportFromData === 'function',
            roster: roster !== null &&
                    typeof roster.exportText === 'function',
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
        var count = getCharacterCount();
        var availability = getFormatAvailability();

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Characters</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // ---- Pre-flight count ----
        html += '<div class="character-export-picker-preview">';
        if (count === null) {
            html += '<p class="empty-state">' +
                        'Character data is not available.' +
                    '</p>';
        } else if (count === 0) {
            html += '<p class="empty-state">' +
                        'No characters to export.' +
                    '</p>';
        } else {
            html += '<div class="character-export-picker-counts">';
            html += '<span class="character-export-picker-count">' +
                        '<strong>' + count + '</strong> ' +
                        (count === 1 ? 'character' : 'characters') +
                        ' in the store' +
                    '</span>';
            html += '</div>';
        }
        html += '</div>';

        // ---- Format radio group ----
        html += '<div class="character-export-picker-formats">';
        html += '<p class="field-hint character-export-picker-hint">' +
                    'Pick a format, then click Export.' +
                '</p>';

        html += buildFormatRow(
            'csv',
            'Full CSV',
            'Every field, one row per character. ' +
            'Opens in Excel or Google Sheets.',
            availability.csv
        );

        html += buildFormatRow(
            'roster',
            'Roster (text)',
            'Name, gender, birth year, and elimination year. ' +
            'A plain-text roster, sorted alphabetically.',
            availability.roster
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

        // ---- Footer ----
        var canExport = isFormatAvailable(_selectedFormat, availability);
        var hasData = count !== null && count > 0;
        var templateSelected = _selectedFormat === 'template';

        var exportDisabled = templateSelected
            ? !canExport
            : (!canExport || !hasData);

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
                    'Export' +
                '</button>';

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
        if (format === 'csv') { return availability.csv; }
        if (format === 'roster') { return availability.roster; }
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

        _selectedFormat = target.value || 'csv';

        // Re-render so the selected row highlights and the export
        // button's disabled state updates.
        renderContent();
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function handleExport() {
        var result;

        try {
            if (_selectedFormat === 'csv') {
                result = runCSVExport();
            } else if (_selectedFormat === 'roster') {
                result = runRosterExport();
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
        if (format === 'csv') { return 'CSV'; }
        if (format === 'roster') { return 'Roster'; }
        if (format === 'template') { return 'Template'; }
        return 'Export';
    }

    function runCSVExport() {
        var csv = window.CharacterCSV;
        if (!csv || typeof csv.exportFromData !== 'function') {
            return null;
        }

        var result = csv.exportFromData();

        // CharacterCSV.exportFromData returns { count, filename,
        // message }. Translate the "no data" path into an exported:
        // false shape so the caller handles it uniformly.
        if (result && result.message === 'No characters to export.') {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }

        if (result && typeof result.count === 'number') {
            return {
                exported: true,
                filename: result.filename,
                count: result.count,
                error: null
            };
        }

        return {
            exported: false,
            filename: null,
            count: 0,
            error: 'CSV export returned an unexpected shape.'
        };
    }

    function runRosterExport() {
        var roster = window.CharacterRosterExport;
        if (!roster || typeof roster.exportText !== 'function') {
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
