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
 *   The single-character paths use the per-character exporters
 *   so the produced filename carries the character's name rather
 *   than being a bulk file with one entry. The Simplified format
 *   has no per-character exporter, so a single-character
 *   Simplified export is a one-row TSV produced by
 *   exportSelectedText([id]); that is the correct shape for a
 *   fixed-column roster.
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
 * DEPENDENCIES (MANDATORY at call time):
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
    window.__characterExportPickerLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getDomUtils() {
        return window.DomUtils || null;
    }

    function getModal() {
        return window.Modal || null;
    }

    function getNotificationSystem() {
        return window.NotificationSystem || null;
    }

    function getCharacterCSV() {
        return window.CharacterCSV || null;
    }

    function getCharacterRosterExport() {
        return window.CharacterRosterExport || null;
    }

    function getCharacterExport() {
        return window.CharacterExport || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - at open time
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var DU = getDomUtils();
        if (!DU ||
            typeof DU.escapeHtml !== 'function' ||
            typeof DU.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeHtml/escapeAttribute');
        }

        var M = getModal();
        if (!M ||
            typeof M.createModal !== 'function' ||
            typeof M.showModal !== 'function' ||
            typeof M.closeModal !== 'function' ||
            typeof M.modalSetup !== 'function') {
            missing.push('Modal API');
        }

        var NS = getNotificationSystem();
        if (!NS || typeof NS.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.error(
                '[CharacterExportPicker] Missing mandatory ' +
                'dependencies: ' + missing.join(', ')
            );
            return false;
        }

        return true;
    }

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
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        } else if (typeof console !== 'undefined' && console.warn) {
            console.warn('[CharacterExportPicker]', message);
        }
    }

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
        if (!checkDependencies()) {
            notify('Export is not available.', 'error');
            return null;
        }

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

        // If the preselected format is unavailable, fall through to
        // the first available format. This prevents opening with a
        // selected-but-disabled radio.
        var availability = getFormatAvailability();
        if (!isFormatAvailable(_selectedFormat, availability)) {
            var fallback = getFirstAvailableFormat(availability);
            if (fallback) {
                _selectedFormat = fallback;
            }
        }

        var M = getModal();
        var shell = M.createModal(
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

        M.modalSetup(shell, function() {
            closeModal();
        });
        M.showModal(shell);

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
                var M = getModal();
                if (M && typeof M.closeModal === 'function') {
                    M.closeModal(modal);
                }
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
        var CQ = getCharacterQueries();
        if (!CQ ||
            typeof CQ.getCharacters !== 'function') {
            return null;
        }
        try {
            var chars = CQ.getCharacters() || [];
            return chars.length;
        } catch (e) {
            return null;
        }
    }

    /**
     * Returns { scope: 'all' | 'selected', count: number,
     *           totalSelected: number }.
     *
     *   scope 'selected' with a live count means characterIds is
     *   set and at least one of those IDs resolves to a real
     *   character. totalSelected is the original characterIds
     *   length, so the UI can distinguish "nothing selected" from
     *   "everything selected was deleted".
     *
     *   scope 'selected' with count 0 and totalSelected > 0 means
     *   the selection is empty (all selected characters were
     *   deleted since the selection was made). The UI recovers
     *   from this by offering "Use all characters instead".
     *
     *   scope 'all' means the whole store is in scope. count is
     *   the store size (or null when CharacterQueries is absent).
     */
    function getScope() {
        if (_characterIds && _characterIds.length > 0) {
            var totalSelected = _characterIds.length;
            var live = 0;
            var CQ = getCharacterQueries();
            if (CQ &&
                typeof CQ.getCharacterById === 'function') {
                for (var i = 0; i < _characterIds.length; i++) {
                    try {
                        if (CQ.getCharacterById(
                            _characterIds[i]
                        )) {
                            live++;
                        }
                    } catch (e) { /* ignore */ }
                }
            } else {
                live = totalSelected;
            }
            return {
                scope: 'selected',
                count: live,
                totalSelected: totalSelected
            };
        }
        return {
            scope: 'all',
            count: getWholeStoreCount(),
            totalSelected: 0
        };
    }

    function getFormatAvailability() {
        var csv = getCharacterCSV();
        var roster = getCharacterRosterExport();
        var report = getCharacterExport();

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

    function isFormatAvailable(format, availability) {
        if (format === 'report') { return availability.report; }
        if (format === 'general') { return availability.general; }
        if (format === 'simplified') {
            return availability.simplified;
        }
        if (format === 'template') { return availability.template; }
        return false;
    }

    function getFirstAvailableFormat(availability) {
        var order = ['report', 'general', 'simplified', 'template'];
        for (var i = 0; i < order.length; i++) {
            if (isFormatAvailable(order[i], availability)) {
                return order[i];
            }
        }
        return null;
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

        var exportDisabled = computeExportDisabled(scope, availability);
        var exportLabel = computeExportLabel(scope);

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

    function computeExportDisabled(scope, availability) {
        var canExport = isFormatAvailable(
            _selectedFormat, availability
        );
        if (!canExport) { return true; }

        var templateSelected = _selectedFormat === 'template';
        if (templateSelected) { return false; }

        if (scope.scope === 'selected' &&
            scope.totalSelected > 0 &&
            scope.count === 0) {
            // Recoverable empty selection. The Export button is
            // disabled until the user chooses "Use all characters
            // instead" or closes.
            return true;
        }

        if (scope.count === null) {
            // CharacterQueries unavailable for the whole-store
            // scope. Export is allowed: the downstream exporter
            // will surface its own error if it cannot read.
            return false;
        }

        return scope.count === 0;
    }

    function computeExportLabel(scope) {
        if (_selectedFormat === 'template') {
            return 'Export';
        }
        if (scope.scope === 'selected' &&
            scope.count !== null && scope.count > 0) {
            return 'Export ' + scope.count +
                ' character' + (scope.count === 1 ? '' : 's');
        }
        return 'Export';
    }

    function buildScopeSummaryHTML(scope) {
        var html = '';
        html += '<div class="character-export-picker-preview">';

        if (scope.scope === 'selected') {
            if (scope.count > 0) {
                html += '<div class="character-export-picker-counts">';
                html += '<span class="character-export-picker-count">' +
                            'Exporting <strong>' + scope.count +
                            '</strong> selected character' +
                            (scope.count === 1 ? '' : 's') +
                        '</span>';
                if (scope.count < scope.totalSelected) {
                    html += '<span class="character-export-picker-count" ' +
                                'style="color:var(--text-dim);' +
                                'font-size:0.7rem;' +
                                'margin-left:6px;">' +
                                '(' + (scope.totalSelected - scope.count) +
                                ' no longer exist)' +
                            '</span>';
                }
                html += '</div>';
            } else if (scope.totalSelected > 0) {
                html += buildEmptySelectionHTML(scope);
            } else {
                // Defensive: shouldn't happen (getScope returns
                // 'all' when characterIds is empty), but if it
                // ever does, treat it as nothing selected.
                html += '<p class="empty-state">' +
                            'No characters selected.' +
                        '</p>';
            }
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

    /**
     * Recovery UI for the "selection is empty" state. The user
     * landed here with a selection, but every character in it
     * has been deleted since. Offer a single button that widens
     * the scope to the whole store.
     */
    function buildEmptySelectionHTML(scope) {
        var html = '';
        html += '<div class="character-export-picker-empty-selection">';
        html += '<p class="empty-state">' +
                    'The ' + scope.totalSelected +
                    ' selected character' +
                    (scope.totalSelected === 1 ? '' : 's') +
                    ' no longer exist' +
                    (scope.totalSelected === 1 ? 's' : '') +
                    '.' +
                '</p>';
        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="use-all">' +
                    'Use all characters instead' +
                '</button>';
        html += '</div>';
        return html;
    }

    function buildFormatRow(format, title, description, available) {
        var checked = _selectedFormat === format ? ' checked' : '';
        var disabled = available ? '' : ' disabled';

        // When the format is unavailable, the row is disabled and
        // NOT selected — even if _selectedFormat happens to equal
        // `format`. This prevents a "selected but disabled" radio.
        var rowClass = 'character-export-picker-format';
        if (available && checked) { rowClass += ' is-selected'; }
        if (!available) { rowClass += ' is-disabled'; }

        var html = '';
        html += '<label class="' + rowClass + '" ' +
                    'data-format="' + escapeAttribute(format) + '">';

        html += '<input type="radio" name="character-export-format" ' +
                    'value="' + escapeAttribute(format) + '"' +
                    (available ? checked : '') +
                    disabled + '>';

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

    // ============================================================
    // IN-PLACE UPDATE
    // ============================================================

    /**
     * Apply a format selection change to the existing DOM without
     * re-rendering. Focus, caret position, and the radio group's
     * arrow-key traversal all survive.
     *
     * The rows are located by `data-format` (unique per row), so
     * the update is order-independent.
     */
    function applyFormatSelectionInPlace(format) {
        if (!_contentEl) { return; }

        var rows = _contentEl.querySelectorAll(
            '.character-export-picker-format'
        );

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var rowFormat = row.dataset ? row.dataset.format : null;
            if (!rowFormat) { continue; }

            var input = row.querySelector(
                'input[name="character-export-format"]'
            );
            var isAvailable = input && !input.disabled;
            var isNowSelected = isAvailable && rowFormat === format;

            if (isNowSelected) {
                row.classList.add('is-selected');
            } else {
                row.classList.remove('is-selected');
            }
        }

        updateExportButtonState();
    }

    /**
     * Recompute the export button's label and disabled state
     * against the current scope and availability. Called after a
     * selection change and after the "use all" recovery.
     */
    function updateExportButtonState() {
        if (!_contentEl) { return; }

        var btn = _contentEl.querySelector(
            '[data-picker-action="export"]'
        );
        if (!btn) { return; }

        var scope = getScope();
        var availability = getFormatAvailability();
        var disabled = computeExportDisabled(scope, availability);
        var label = computeExportLabel(scope);

        btn.disabled = disabled;
        btn.textContent = label;
    }

    /**
     * Re-render just the scope summary region. Called by the "Use
     * all characters instead" recovery, which changes the scope
     * from 'selected' to 'all'.
     */
    function updateScopeSummaryInPlace() {
        if (!_contentEl) { return; }

        var existing = _contentEl.querySelector(
            '.character-export-picker-preview'
        );
        if (!existing) { return; }

        var scope = getScope();
        var wrapper = document.createElement('div');
        wrapper.innerHTML = buildScopeSummaryHTML(scope);
        var replacement = wrapper.firstElementChild;
        if (replacement) {
            existing.parentNode.replaceChild(
                replacement, existing
            );
        }

        updateExportButtonState();
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

        if (action === 'use-all') {
            e.preventDefault();
            handleUseAll();
            return;
        }
    }

    function handleContentChange(e) {
        var target = e.target;
        if (!target || !target.name) { return; }
        if (target.name !== 'character-export-format') { return; }

        _selectedFormat = target.value || 'report';

        // In-place update. No renderContent() call, so focus on
        // the newly-checked radio survives.
        applyFormatSelectionInPlace(_selectedFormat);
    }

    /**
     * "Use all characters instead": widen the scope from the
     * selected-but-empty set to the whole store. Re-renders the
     * scope summary and refreshes the button.
     */
    function handleUseAll() {
        _characterIds = null;
        updateScopeSummaryInPlace();
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

    /**
     * Resolve the ids the report formats should operate on.
     *
     * Returns either:
     *   { ids: string[] }    explicit list to pass to the
     *                        *SelectedText helpers
     *   { all: true }        whole store; caller routes to the
     *                        per-store helper
     *   null                 no ids can be resolved
     */
    function resolveExportIds() {
        if (_characterIds && _characterIds.length > 0) {
            return { ids: _characterIds.slice() };
        }

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacters !== 'function') {
            return null;
        }

        var all;
        try {
            all = CQ.getCharacters() || [];
        } catch (e) {
            return null;
        }

        var ids = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] && all[i].id) {
                ids.push(String(all[i].id));
            }
        }
        return { ids: ids };
    }

    function runReportExport() {
        var report = getCharacterExport();
        if (!report) { return null; }

        var resolved = resolveExportIds();
        if (!resolved) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }

        var ids = resolved.ids;

        if (ids.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }

        // Single-character fast path: use the per-character
        // exporter so the filename carries the character's name.
        if (ids.length === 1) {
            if (typeof report.exportCharacterText !== 'function') {
                return null;
            }
            var single = report.exportCharacterText(ids[0]);
            if (single && single.exported) {
                return {
                    exported: true,
                    filename: single.filename,
                    count: 1,
                    error: null
                };
            }
            return single;
        }

        if (typeof report.exportSelectedText !== 'function') {
            return null;
        }
        return report.exportSelectedText(ids);
    }

    function runGeneralExport() {
        var report = getCharacterExport();
        if (!report) { return null; }

        var resolved = resolveExportIds();
        if (!resolved) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }

        var ids = resolved.ids;

        if (ids.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters to export.'
            };
        }

        // Single-character fast path.
        if (ids.length === 1) {
            if (typeof report.exportGeneralText !== 'function') {
                return null;
            }
            var single = report.exportGeneralText(ids[0]);
            if (single && single.exported) {
                return {
                    exported: true,
                    filename: single.filename,
                    count: 1,
                    error: null
                };
            }
            return single;
        }

        if (typeof report.exportGeneralSelectedText !== 'function') {
            return null;
        }
        return report.exportGeneralSelectedText(ids);
    }

    function runSimplifiedExport() {
        var roster = getCharacterRosterExport();
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
        var csv = getCharacterCSV();
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
