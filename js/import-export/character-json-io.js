/**
 * js/modules/characters/character-json-io.js - Character JSON Import/Export
 *
 * Path: js/modules/characters/character-json-io.js
 *
 * WHAT THIS OWNS:
 *   - Exporting a single character's FULL raw record to a JSON file.
 *     The export is the record as stored, verbatim — no stripping, no
 *     projection, no migration. Every field the store carries is
 *     included.
 *
 *   - Importing a JSON blob into the character form. The blob is
 *     pasted by the user into a modal textarea, parsed, normalised
 *     through CharacterCRUD.normaliseCharacterData, and then written
 *     into the form fields via CharacterForm. The user then reviews
 *     and clicks Save.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Persistence. Import does NOT write to the store. It fills the
 *     form. The user saves. This is deliberate: an import that
 *     silently overwrote a store record would be a foot-gun.
 *   - Field enumeration. normaliseCharacterData is the canonical
 *     shape; this module delegates to it.
 *   - The form's field ids. CharacterForm owns those.
 *
 * DOWNLOAD RELIABILITY (this revision):
 *   downloadJson no longer revokes the blob URL. The previous
 *   implementation revoked it 100ms after click, which on Chrome
 *   raced the browser's download manager and killed the download
 *   for larger payloads. Modern browsers reclaim blob URLs on
 *   page unload, so leaving them alive costs nothing measurable.
 *
 *   The anchor is also removed synchronously, immediately after
 *   click() returns, and the removal is guarded. A double-click on
 *   Export can no longer throw inside a stale timeout.
 *
 *   The toast reports success only after the click has been
 *   dispatched. Whether the browser actually writes the file is
 *   outside our control; a dispatched download on a modern browser
 *   reliably produces a file.
 *
 * IMPORT INPUT:
 *   The import path is a MODAL with a textarea, not a file picker.
 *   The user pastes the JSON text directly, clicks Import, and the
 *   form fills. A "Load from file..." link is also present for
 *   users who have the JSON on disk; it drops the file's contents
 *   into the textarea. The user still clicks Import.
 *
 * EXPORT SHAPE:
 *   A single JSON object: the full character record. Not wrapped in
 *   an envelope, not arrayed. Filename is derived from the character
 *   name: character-<first>-<last>.json.
 *
 * IMPORT SHAPE:
 *   The pasted text may contain either:
 *     - a single character object: { firstName, lastName, ... }
 *     - an array of character objects: [ {...}, {...} ] — in which
 *       case only the FIRST entry is imported, because the target
 *       is the character form and the form holds one character.
 *
 *   Unknown keys are ignored. Missing keys fall back to defaults via
 *   normaliseCharacterData. Malformed JSON is rejected with an
 *   inline error in the modal; the form is not touched.
 *
 * SECURITY:
 *   The module never executes anything from the pasted text. It
 *   parses with JSON.parse, hands the result to
 *   normaliseCharacterData, and writes the result into the DOM via
 *   FormUtils.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterForm
 *   - window.FormUtils
 *   - window.Modal
 *   - window.NotificationSystem
 */

(function() {
    'use strict';

    if (window.__characterJsonIoLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterForm = window.CharacterForm;
    var FormUtils = window.FormUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.normaliseCharacterData !== 'function') {
        _missing.push('CharacterCRUD.normaliseCharacterData');
    }
    if (!CharacterForm ||
        typeof CharacterForm.render !== 'function') {
        _missing.push('CharacterForm.render');
    }
    if (!FormUtils ||
        typeof FormUtils.setField !== 'function') {
        _missing.push('FormUtils.setField');
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
            '[CharacterJSONIO] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__characterJsonIoLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _clickHandler = null;
    var _keydownHandler = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function sanitiseFilenamePart(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function buildFilename(char) {
        var first = sanitiseFilenamePart(char && char.firstName);
        var last = sanitiseFilenamePart(char && char.lastName);

        var nameParts = [];
        if (first) { nameParts.push(first); }
        if (last) { nameParts.push(last); }

        var stem = nameParts.length > 0
            ? nameParts.join('-')
            : (char && char.id
                ? String(char.id)
                : 'character');

        return 'character-' + stem + '.json';
    }

    /**
     * Trigger a browser download of a JSON blob.
     *
     * The blob URL is deliberately NOT revoked. Revoking on a timer
     * raced the browser's download manager on Chrome and killed the
     * download for larger payloads. Modern browsers reclaim blob
     * URLs on page unload, so leaving them alive costs nothing
     * measurable.
     *
     * The anchor is removed synchronously, immediately after click
     * returns. By that point the download has been dispatched to the
     * browser's download manager and the anchor is no longer needed.
     * The removal is guarded against a missing parent so a stray
     * double-click on Export cannot throw.
     */
    function downloadJson(filename, obj) {
        var text = JSON.stringify(obj, null, 2);
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';

        document.body.appendChild(a);

        try {
            a.click();
        } finally {
            // Remove synchronously. The click already dispatched the
            // download; the anchor is finished.
            try {
                if (a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            } catch (e) {
                // Guarded. A concurrent removal is harmless.
            }
            // Deliberately do NOT revoke `url`. See the header note.
        }
    }

    function escapeHtml(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function exportCharacter(charId) {
        if (!charId) {
            return { exported: false, error: 'No character id supplied.' };
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return { exported: false, error: 'Character not found.' };
        }

        var snapshot;
        try {
            snapshot = JSON.parse(JSON.stringify(char));
        } catch (e) {
            return {
                exported: false,
                error: 'Failed to serialise character: ' + e.message
            };
        }

        var filename = buildFilename(char);

        try {
            downloadJson(filename, snapshot);
        } catch (e) {
            return {
                exported: false,
                error: 'Failed to download: ' + e.message
            };
        }

        return { exported: true, filename: filename };
    }

    // ============================================================
    // FORM FIELD WRITERS
    // ============================================================

    function writeScalarField(id, value) {
        FormUtils.setField(id, value);
    }

    function writeDisplayParts(record) {
        var dp = record.displayParts || {};
        FormUtils.setField('char-displayFirst',    dp.first    !== false);
        FormUtils.setField('char-displayNickname', dp.nickname === true);
        FormUtils.setField('char-displayMiddle',   dp.middle   !== false);
        FormUtils.setField('char-displayLast',     dp.last     !== false);
        FormUtils.setField('char-displayAlias',    dp.alias    === true);
    }

    function writePreviousNames(record) {
        var container = document.getElementById('previous-names-container');
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addPreviousNameRow === 'function') {
            var names = Array.isArray(record.previousNames)
                ? record.previousNames
                : [];
            if (names.length === 0) {
                CharacterForm.addPreviousNameRow(container, '');
            } else {
                names.forEach(function(n) {
                    CharacterForm.addPreviousNameRow(container, n);
                });
            }
        }
    }

    function writeStats(record) {
        var stats = record.stats || {};
        var keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        keys.forEach(function(k) {
            if (stats[k] !== undefined && stats[k] !== null) {
                FormUtils.setField('char-stat-' + k, stats[k]);
            }
        });
    }

    function writeMagic(record) {
        var magic = record.magic || {};
        var keys = Object.keys(magic);
        keys.forEach(function(k) {
            FormUtils.setField('char-magic-' + k, magic[k]);
        });
    }

    function writeWeapons(record) {
        var container = document.getElementById('weapons-container');
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addWeaponRow === 'function') {
            var weapons = Array.isArray(record.weapons)
                ? record.weapons
                : [];
            weapons.forEach(function(w) {
                CharacterForm.addWeaponRow(container, w);
            });
        }
    }

    function writeCareerStatus(record) {
        var container = document.getElementById('career-status-container');
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addCareerEntryRow === 'function') {
            var entries = Array.isArray(record.careerStatus)
                ? record.careerStatus
                : [];
            if (entries.length === 0) {
                CharacterForm.addCareerEntryRow(container);
            } else {
                entries.forEach(function(entry) {
                    CharacterForm.addCareerEntryRow(container, entry);
                });
            }
        }
    }

    function writePersonality(record) {
        var p = record.personality || {};
        FormUtils.setField('char-personality-traits',        p.traits        || '');
        FormUtils.setField('char-personality-ideals',        p.ideals        || '');
        FormUtils.setField('char-personality-bonds',         p.bonds         || '');
        FormUtils.setField('char-personality-flaws',         p.flaws         || '');
        FormUtils.setField('char-personality-alignment',     p.alignment     || '');
        FormUtils.setField('char-personality-likes',         p.likes         || '');
        FormUtils.setField('char-personality-dislikes',      p.dislikes      || '');
        FormUtils.setField('char-personality-habits',        p.habits        || '');
        FormUtils.setField('char-personality-fears',         p.fears         || '');
        FormUtils.setField('char-personality-goals',         p.goals         || '');
        FormUtils.setField('char-personality-authority',     p.authority     || '');
        FormUtils.setField('char-personality-conflictStyle', p.conflictStyle || '');
        FormUtils.setField('char-personality-socialStyle',   p.socialStyle   || '');
        FormUtils.setField('char-personality-quirks',        p.quirks        || '');
    }

    function writeDeceasedState(record) {
        var deceased = record.deceased === true;
        FormUtils.setField('char-deceased', deceased);

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = deceased ? 'block' : 'none';
        }

        if (CharacterForm &&
            typeof CharacterForm.applyDeceasedState === 'function') {
            CharacterForm.applyDeceasedState(deceased);
        }
    }

    function writeIsFiller(record) {
        FormUtils.setField('char-is-filler', record.isFiller === true);
    }

    /**
     * Write a normalised character record into the live form.
     * Does NOT save. Does NOT touch the store.
     */
    function writeRecordToForm(record) {
        if (!record || typeof record !== 'object') { return false; }

        // Name block
        writeScalarField('char-firstName',  record.firstName  || '');
        writeScalarField('char-middleName', record.middleName || '');
        writeScalarField('char-lastName',   record.lastName   || '');
        writeScalarField('char-nickname',   record.nickname   || '');
        writeScalarField('char-alias',      record.alias      || '');
        writePreviousNames(record);
        writeDisplayParts(record);

        // Identity block
        writeScalarField('char-birthYear',  record.birthYear  || '');
        writeScalarField('char-gender',     record.gender     || '');
        writeScalarField('char-attraction', record.attraction || '');

        // Deceased block
        writeScalarField('char-deathYear',  record.deathYear  || '');
        writeScalarField('char-deathAge',   record.deathAge   || '');
        writeScalarField('char-deathCause', record.deathCause || '');
        writeDeceasedState(record);

        // Physical block
        writeScalarField('char-eyes',            record.eyes            || '');
        writeScalarField('char-hair',            record.hair            || '');
        writeScalarField('char-skin',            record.skin            || '');
        writeScalarField('char-height',          record.height          || '');
        writeScalarField('char-weight',          record.weight          || '');
        writeScalarField('char-build',           record.build           || '');
        writeScalarField('char-appearanceNotes', record.appearanceNotes || '');

        // Personality block
        writePersonality(record);

        // Professional block
        writeScalarField('char-specialty', record.specialty || '');
        writeCareerStatus(record);

        // Combat block
        writeStats(record);
        writeScalarField('char-hp', record.hp || 0);
        writeScalarField('char-mp', record.mp || 0);
        writeMagic(record);
        writeWeapons(record);
        writeScalarField('char-combat-notes', record.combatNotes || '');

        // Notes block
        writeScalarField('char-notes-tab', record.notes || '');

        // Filler flag
        writeIsFiller(record);

        return true;
    }

    // ============================================================
    // PARSE
    // ============================================================

    /**
     * Parse a JSON blob and fill the form. Does NOT save.
     */
    function importText(text) {
        if (typeof text !== 'string' || text.trim() === '') {
            return { imported: false, error: 'Paste a JSON object first.' };
        }

        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return {
                imported: false,
                error: 'Not valid JSON: ' + e.message
            };
        }

        var record = parsed;
        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                return {
                    imported: false,
                    error: 'The array is empty.'
                };
            }
            record = parsed[0];
        }

        if (!record || typeof record !== 'object') {
            return {
                imported: false,
                error: 'The text does not contain a character object.'
            };
        }

        var normalised;
        try {
            normalised = CharacterCRUD.normaliseCharacterData(record);
        } catch (e) {
            return {
                imported: false,
                error: 'Failed to normalise record: ' + e.message
            };
        }

        if (!normalised.firstName || !normalised.lastName) {
            return {
                imported: false,
                error: 'Record is missing firstName or lastName.'
            };
        }

        var wrote = writeRecordToForm(normalised);
        if (!wrote) {
            return {
                imported: false,
                error: 'Failed to write record into the form.'
            };
        }

        return { imported: true };
    }

    // ============================================================
    // IMPORT MODAL
    // ============================================================

    function buildModalHTML() {
        return `
            <div class="modal-header">
                <h3>Import Character JSON</h3>
                <button type="button" class="close-modal" data-json-action="close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <p class="field-hint" style="font-size:0.75rem;color:var(--text-dim);margin:0 0 8px 0;line-height:1.45;">
                    Paste a character object as JSON. The form will fill with
                    the values, but nothing is saved until you click
                    <strong>Save</strong> on the character form. A single object
                    or an array of objects is accepted; an array imports only
                    the first entry.
                </p>

                <textarea id="character-json-paste-input"
                          spellcheck="false"
                          autocomplete="off"
                          placeholder='{ "firstName": "Alice", "lastName": "Blackwood", "birthYear": "1900", ... }'
                          style="width:100%;min-height:260px;padding:8px 10px;
                                 background:var(--bg);
                                 border:1px solid var(--border);
                                 color:var(--text);
                                 border-radius:6px;
                                 font-family:monospace;
                                 font-size:0.72rem;
                                 line-height:1.5;
                                 resize:vertical;
                                 white-space:pre;
                                 overflow:auto;"></textarea>

                <div id="character-json-error"
                     style="display:none;margin-top:8px;padding:6px 10px;
                            background:var(--danger-soft);
                            border-left:3px solid var(--danger);
                            border-radius:4px;
                            font-size:0.72rem;
                            color:var(--danger);"></div>

                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
                    <button type="button"
                            class="secondary small"
                            data-json-action="file"
                            style="font-size:0.7rem;padding:4px 10px;">
                        Load from file...
                    </button>
                    <span style="font-size:0.65rem;color:var(--text-dim);">
                        Or paste directly with Ctrl+V / Cmd+V
                    </span>
                </div>
            </div>
            <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-soft);">
                <button type="button" class="secondary" data-json-action="close">Cancel</button>
                <button type="button" class="primary" data-json-action="import">Import</button>
            </div>
        `;
    }

    function showError(contentEl, message) {
        var errorEl = contentEl.querySelector('#character-json-error');
        if (!errorEl) { return; }
        if (!message) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
            return;
        }
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }

    function getPasteEl(contentEl) {
        return contentEl.querySelector('#character-json-paste-input');
    }

    function closeImportModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _clickHandler) {
            try {
                contentEl.removeEventListener('click', _clickHandler);
            } catch (e) {}
        }
        if (contentEl && _keydownHandler) {
            try {
                contentEl.removeEventListener('keydown', _keydownHandler);
            } catch (e) {}
        }

        _modal = null;
        _contentEl = null;
        _clickHandler = null;
        _keydownHandler = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }
    }

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var actionEl = target.closest('[data-json-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.jsonAction;

        if (action === 'close') {
            e.preventDefault();
            closeImportModal();
            return;
        }

        if (action === 'import') {
            e.preventDefault();
            doImport();
            return;
        }

        if (action === 'file') {
            e.preventDefault();
            openFilePickerIntoTextarea();
            return;
        }
    }

    function doImport() {
        var contentEl = _contentEl;
        if (!contentEl) { return; }

        var pasteEl = getPasteEl(contentEl);
        if (!pasteEl) { return; }

        var text = String(pasteEl.value || '');

        var result = importText(text);

        if (result.imported) {
            closeImportModal();
            notify(
                'Character profile imported into the form. Review ' +
                'the fields, then click Save.',
                'success'
            );
            return;
        }

        showError(contentEl, result.error || 'Import failed.');
    }

    function openFilePickerIntoTextarea() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';

        input.addEventListener('change', function() {
            var file = input.files && input.files[0];
            if (!file) {
                cleanup();
                return;
            }

            var reader = new FileReader();
            reader.onerror = function() {
                showError(_contentEl, 'Failed to read the file.');
                cleanup();
            };
            reader.onload = function() {
                var text = String(reader.result || '');
                var pasteEl = getPasteEl(_contentEl);
                if (pasteEl) {
                    pasteEl.value = text;
                    showError(_contentEl, '');
                    pasteEl.focus();
                }
                cleanup();
            };
            reader.readAsText(file);
        });

        function cleanup() {
            try {
                if (input.parentNode) {
                    input.parentNode.removeChild(input);
                }
            } catch (e) { /* ignore */ }
        }

        document.body.appendChild(input);
        input.click();
    }

    function openImportModal() {
        closeImportModal();

        var shell = Modal.createModal('character-json-import-modal');
        if (!shell) {
            notify('Could not open import modal.', 'error');
            return null;
        }
        shell.id = 'character-json-import-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        contentEl.innerHTML = buildModalHTML();

        _clickHandler = handleClick;
        _keydownHandler = function(e) {
            // Ctrl/Cmd + Enter triggers Import from the textarea.
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                doImport();
            }
        };

        contentEl.addEventListener('click', _clickHandler);
        contentEl.addEventListener('keydown', _keydownHandler);

        Modal.modalSetup(shell, function() {
            closeImportModal();
        });
        Modal.showModal(shell);

        setTimeout(function() {
            var pasteEl = getPasteEl(contentEl);
            if (pasteEl && typeof pasteEl.focus === 'function') {
                try { pasteEl.focus(); } catch (e) {}
            }
        }, 50);

        return shell;
    }

    // ============================================================
    // PUBLIC ENTRY POINTS
    // ============================================================

    function handleExportCurrent() {
        var charId = (typeof window.getCurrentEditId === 'function')
            ? window.getCurrentEditId()
            : null;

        if (!charId) {
            notify('Select a character first.', 'error');
            return Promise.resolve({
                exported: false,
                error: 'No character selected.'
            });
        }

        var result = exportCharacter(charId);

        if (result.exported) {
            notify(
                'Character profile exported: ' + result.filename,
                'success'
            );
        } else {
            notify(
                'Export failed: ' + (result.error || 'Unknown error'),
                'error'
            );
        }

        return Promise.resolve(result);
    }

    function handleImportIntoForm() {
        openImportModal();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterJSONIO = Object.freeze({
        exportCharacter: exportCharacter,
        importText: importText,

        handleExportCurrent: handleExportCurrent,
        handleImportIntoForm: handleImportIntoForm,

        // Exposed for tests / advanced callers
        writeRecordToForm: writeRecordToForm,
        buildFilename: buildFilename
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterJSONIO;
        var missing = [];

        var required = [
            'exportCharacter',
            'importText',
            'handleExportCurrent',
            'handleImportIntoForm',
            'writeRecordToForm'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterJSONIO] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();
