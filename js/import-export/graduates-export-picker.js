/**
 * js/import-export/graduates-export-picker.js - Graduates Export Picker
 * Modal that lets the user choose a class, then export its graduates.
 *
 * Path: js/import-export/graduates-export-picker.js
 *
 * WHAT THIS MODULE OWNS:
 *   The modal that opens when the user clicks a graduate export
 *   button in the header. The modal:
 *     1. Lists every class by name.
 *     2. Lets the user select one.
 *     3. Provides two actions: Export JSON and Export CSV.
 *     4. Closes on success or on user cancel.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class list            (AcademyClasses / AcademyQueries)
 *   - The graduates projection  (GraduatesExport)
 *   - The download mechanism    (ExportUtils, via GraduatesExport)
 *   - The header buttons        (ui.js)
 *
 * MODAL LIFECYCLE:
 *   - The picker creates its own .modal shell, appended to
 *     document.body.
 *   - It closes on the Close button, on backdrop click, and on
 *     Escape.
 *   - Only one picker is open at a time. Opening a second closes
 *     the first.
 *
 * RESULT REPORTING:
 *   Both export buttons route through GraduatesExport and dispatch
 *   the result via NotificationSystem. The modal itself does not
 *   toast success or failure — GraduatesExport's caller contract
 *   says the caller reports. The picker reports, then closes on
 *   success. On "no graduates" it stays open so the user can pick
 *   a different class.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyClasses
 *   - window.GraduatesExport
 */

(function() {
    'use strict';

    if (window.__graduatesExportPickerLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyClasses = window.AcademyClasses;
    var GraduatesExport = window.GraduatesExport;

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
    if (!AcademyClasses ||
        typeof AcademyClasses.getClasses !== 'function') {
        _missing.push('AcademyClasses.getClasses');
    }
    if (!GraduatesExport ||
        typeof GraduatesExport.exportGraduatesJSON !== 'function' ||
        typeof GraduatesExport.exportGraduatesCSV !== 'function') {
        _missing.push('GraduatesExport API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[GraduatesExportPicker] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__graduatesExportPickerLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _selectedClassId = null;
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
     * Open the graduates export picker.
     *
     * @param {object} [options]
     * @param {string} [options.initialClassId] - Preselect this class
     * @param {function} [options.onClose]      - Called once when
     *   the modal closes for any reason
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(options) {
        options = options || {};

        closeModal();

        _selectedClassId = isNonEmptyString(options.initialClassId)
            ? String(options.initialClassId)
            : null;
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        var shell = Modal.createModal('graduates-export-picker-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'graduates-export-picker-modal';

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
                    '[GraduatesExportPicker] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _selectedClassId = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function buildViewModel() {
        var classes = [];
        try {
            classes = AcademyClasses.getClasses() || [];
        } catch (e) {
            classes = [];
        }

        var rows = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (!c || !c.id) { continue; }
            rows.push({
                id: String(c.id),
                name: isNonEmptyString(c.name)
                    ? String(c.name)
                    : 'Unnamed Class',
                status: isNonEmptyString(c.status) ? c.status : 'active'
            });
        }

        rows.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            classes: rows,
            selectedClassId: _selectedClassId
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
        var classes = vm.classes;

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>Export Graduates</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        if (classes.length === 0) {
            html += '<p class="empty-state">' +
                        'No classes exist yet. Create a class first ' +
                        'from the Academy tab.' +
                    '</p>';
        } else {
            html += '<p class="field-hint">' +
                        'Pick a class. Graduates are the members of ' +
                        'that class who have never been eliminated.' +
                    '</p>';

            html += '<div class="form-group">';
            html += '<label for="graduates-picker-class-select">' +
                        'Class' +
                    '</label>';
            html += '<select id="graduates-picker-class-select" ' +
                        'class="graduates-picker-class-select">';
            html += '<option value="">Select a class...</option>';
            for (var i = 0; i < classes.length; i++) {
                var c = classes[i];
                var selected = String(c.id) === String(vm.selectedClassId)
                    ? ' selected'
                    : '';
                var statusSuffix = (c.status !== 'active')
                    ? ' (' + c.status + ')'
                    : '';
                html += '<option value="' +
                            escapeAttribute(c.id) + '"' + selected + '>' +
                            escapeHtml(c.name + statusSuffix) +
                        '</option>';
            }
            html += '</select>';
            html += '</div>';
        }

        html += '</div>';

        // ---- Footer ----
        var hasSelection = isNonEmptyString(vm.selectedClassId);
        var hasClasses = classes.length > 0;

        html += '<div class="modal-footer graduates-picker-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="close">' +
                    'Close' +
                '</button>';

        html += '<span class="graduates-picker-footer-spacer"></span>';

        html += '<button type="button" class="primary" ' +
                    'data-picker-action="export-json"' +
                    (hasSelection ? '' : ' disabled') + '>' +
                    'Export JSON' +
                '</button>';

        html += '<button type="button" class="primary" ' +
                    'data-picker-action="export-csv"' +
                    (hasSelection ? '' : ' disabled') + '>' +
                    'Export CSV' +
                '</button>';

        html += '</div>';

        // hasClasses is kept for symmetry; the disabled state of
        // the export buttons is driven by hasSelection, which
        // implies hasClasses.
        void hasClasses;

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

        if (action === 'export-json') {
            e.preventDefault();
            handleExport('json');
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

        if (target.classList.contains('graduates-picker-class-select')) {
            _selectedClassId = isNonEmptyString(target.value)
                ? String(target.value)
                : null;
            renderContent();
        }
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function handleExport(format) {
        if (!isNonEmptyString(_selectedClassId)) {
            notify('Select a class first.', 'info');
            return;
        }

        var classId = _selectedClassId;
        var result;

        try {
            if (format === 'json') {
                result = GraduatesExport.exportGraduatesJSON(classId);
            } else {
                result = GraduatesExport.exportGraduatesCSV(classId);
            }
        } catch (err) {
            console.warn(
                '[GraduatesExportPicker] export threw:', err
            );
            notify('Graduates export failed: ' + err.message, 'error');
            return;
        }

        if (result && result.exported) {
            notify(
                'Exported ' + result.count + ' graduate(s): ' +
                result.filename,
                'success'
            );
            closeModal();
            return;
        }

        var error = (result && result.error) ? result.error : '';

        if (error === 'No graduates found for this class.') {
            notify(error, 'warning');
            // Stay open so the user can pick another class.
            return;
        }

        if (error === 'Class not found or arguments invalid.') {
            notify(error, 'error');
            // Stay open; the class list may have changed.
            renderContent();
            return;
        }

        notify(
            'Graduates export failed: ' + (error || 'Unknown error'),
            'error'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GraduatesExportPicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.GraduatesExportPicker;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[GraduatesExportPicker] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
