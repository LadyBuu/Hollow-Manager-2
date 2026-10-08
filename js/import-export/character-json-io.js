/**
 * js/modules/characters/character-json-io.js - Character JSON Import/Export
 *
 * Path: js/modules/characters/character-json-io.js
 *
 * WHAT THIS OWNS:
 *   - Exporting a single character's FULL raw record to a JSON file.
 *     The export is the record as stored, verbatim — no stripping, no
 *     projection, no migration. Every field the store carries is
 *     included: identity, name parts, physical, personality, stats,
 *     magic, HP/MP, weapons, special moves, careerStatus, classIds,
 *     parentIds, eliminations, everything.
 *
 *   - Importing a JSON file into the character form. The file is
 *     parsed, normalised through CharacterCRUD.normaliseCharacterData
 *     (so it lands in the same shape the form and the store expect),
 *     and then written into the form fields via CharacterForm. The
 *     user then reviews and clicks Save.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Persistence. Import does NOT write to the store. It fills the
 *     form. The user saves. This is deliberate: an import that
 *     silently overwrites a store record would be a foot-gun.
 *   - Field enumeration. normaliseCharacterData is the canonical
 *     shape; this module delegates to it.
 *   - The form's field ids. CharacterForm owns those. This module
 *     reads them via a small mapping table so a field rename in the
 *     form is a one-line change here.
 *
 * EXPORT SHAPE:
 *   A single JSON object: the full character record. Not wrapped in
 *   an envelope, not arrayed. Filename is derived from the character
 *   name:
 *
 *     character-<first>-<last>.json
 *
 *   with non-alphanumeric characters in the name replaced by hyphens
 *   and lowercased.
 *
 * IMPORT SHAPE:
 *   The file may contain either:
 *     - a single character object: { firstName, lastName, ... }
 *     - an array of character objects: [ {...}, {...} ] — in which
 *       case only the FIRST entry is imported, because the target is
 *       the character form and the form holds one character.
 *
 *   Unknown keys are ignored. Missing keys fall back to defaults via
 *   normaliseCharacterData. Malformed JSON is rejected with a
 *   notification and no form change.
 *
 * WHY NOT REUSE THE EXISTING IMPORT/EXPORT PIPELINE:
 *   js/import-export/* is a full-database pipeline (envelope, format
 *   migration, cross-domain validation, staged import). It is the
 *   right tool for a whole save file. It is the wrong tool for
 *   "fill out THIS ONE character." This module is the narrow,
 *   character-scoped equivalent: read one record, write one record.
 *
 * SECURITY:
 *   The module never executes anything from the JSON. It parses with
 *   JSON.parse, hands the result to normaliseCharacterData, and
 *   writes the result into the DOM via FormUtils. A hostile JSON
 *   can produce bad values in fields, but cannot run code.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterForm
 *   - window.FormUtils
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.DomUtils  (used only for one confirm-adjacent message)
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

    function downloadJson(filename, obj) {
        var text = JSON.stringify(obj, null, 2);
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        // Give the browser a beat to start the download before we
        // revoke the object URL.
        setTimeout(function() {
            try {
                document.body.removeChild(a);
            } catch (e) { /* ignore */ }
            URL.revokeObjectURL(url);
        }, 100);
    }

    // ============================================================
    // EXPORT
    // ============================================================

    /**
     * Export a single character's full raw record as a JSON file.
     *
     * @param {string} charId
     * @returns {object} { exported: boolean, filename?: string, error?: string }
     */
    function exportCharacter(charId) {
        if (!charId) {
            return { exported: false, error: 'No character id supplied.' };
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return { exported: false, error: 'Character not found.' };
        }

        // Deep clone via JSON round-trip so the export is a frozen
        // snapshot, not a live reference to the store record. Then
        // write the snapshot.
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
    // FORM FIELD MAP
    // ============================================================
    //
    // One entry per form field this module writes. The left side is
    // the path into the normalised character record. The right side
    // is the form element id, or a writer function.
    //
    // Scalars are written with a string id and FormUtils.setField.
    // Arrays and derived structures are written by a function that
    // receives the record and returns nothing.
    //
    // Adding a new form field: add an entry. Removing one: delete
    // the entry. This is the ONLY place that needs to know about
    // both the record shape and the form shape at the same time.

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
     *
     * Does NOT save. Does NOT touch the store. Only writes DOM fields.
     *
     * @param {object} record - A normalised character record (the
     *   output of CharacterCRUD.normaliseCharacterData, or an
     *   equivalent shape).
     * @returns {boolean} true when at least the required identity
     *   fields were written.
     */
    function writeRecordToForm(record) {
        if (!record || typeof record !== 'object') { return false; }

        // ---- Name block ----
        writeScalarField('char-firstName',  record.firstName  || '');
        writeScalarField('char-middleName', record.middleName || '');
        writeScalarField('char-lastName',   record.lastName   || '');
        writeScalarField('char-nickname',   record.nickname   || '');
        writeScalarField('char-alias',      record.alias      || '');
        writePreviousNames(record);
        writeDisplayParts(record);

        // ---- Identity block ----
        writeScalarField('char-birthYear',  record.birthYear  || '');
        writeScalarField('char-gender',     record.gender     || '');
        writeScalarField('char-attraction', record.attraction || '');

        // ---- Deceased block ----
        writeScalarField('char-deathYear',  record.deathYear  || '');
        writeScalarField('char-deathAge',   record.deathAge   || '');
        writeScalarField('char-deathCause', record.deathCause || '');
        writeDeceasedState(record);

        // ---- Physical block ----
        writeScalarField('char-eyes',            record.eyes            || '');
        writeScalarField('char-hair',            record.hair            || '');
        writeScalarField('char-skin',            record.skin            || '');
        writeScalarField('char-height',          record.height          || '');
        writeScalarField('char-weight',          record.weight          || '');
        writeScalarField('char-build',           record.build           || '');
        writeScalarField('char-appearanceNotes', record.appearanceNotes || '');

        // ---- Personality block ----
        writePersonality(record);

        // ---- Professional block ----
        writeScalarField('char-specialty', record.specialty || '');
        writeCareerStatus(record);

        // ---- Combat block ----
        writeStats(record);
        writeScalarField('char-hp', record.hp || 0);
        writeScalarField('char-mp', record.mp || 0);
        writeMagic(record);
        writeWeapons(record);
        writeScalarField('char-combat-notes', record.combatNotes || '');

        // ---- Notes block ----
        writeScalarField('char-notes-tab', record.notes || '');

        // ---- Filler flag ----
        writeIsFiller(record);

        return true;
    }

    // ============================================================
    // IMPORT
    // ============================================================

    /**
     * Parse a JSON file and fill the form. Does NOT save.
     *
     * @param {File} file - A File from an <input type="file">.
     * @returns {Promise<{ imported: boolean, error?: string }>}
     */
    function importFile(file) {
        if (!file) {
            return Promise.resolve({
                imported: false,
                error: 'No file supplied.'
            });
        }

        return new Promise(function(resolve) {
            var reader = new FileReader();

            reader.onerror = function() {
                resolve({
                    imported: false,
                    error: 'Failed to read the file.'
                });
            };

            reader.onload = function() {
                var text = reader.result;
                var parsed;

                try {
                    parsed = JSON.parse(String(text));
                } catch (e) {
                    resolve({
                        imported: false,
                        error: 'Not valid JSON: ' + e.message
                    });
                    return;
                }

                // Accept a single object or an array. If an array,
                // take the first entry.
                var record = parsed;
                if (Array.isArray(parsed)) {
                    if (parsed.length === 0) {
                        resolve({
                            imported: false,
                            error: 'File contains an empty array.'
                        });
                        return;
                    }
                    record = parsed[0];
                }

                if (!record || typeof record !== 'object') {
                    resolve({
                        imported: false,
                        error: 'File does not contain a character object.'
                    });
                    return;
                }

                // Normalise through the CRUD pipeline so the record
                // lands in the same shape the store expects. This
                // also fills missing fields with defaults and clamps
                // out-of-range values.
                var normalised;
                try {
                    normalised = CharacterCRUD.normaliseCharacterData(record);
                } catch (e) {
                    resolve({
                        imported: false,
                        error: 'Failed to normalise record: ' + e.message
                    });
                    return;
                }

                // Identity check. The normalised record must at
                // least carry a first and last name, or the form
                // will not be able to save it later.
                if (!normalised.firstName || !normalised.lastName) {
                    resolve({
                        imported: false,
                        error: 'Record is missing firstName or lastName.'
                    });
                    return;
                }

                var wrote = writeRecordToForm(normalised);
                if (!wrote) {
                    resolve({
                        imported: false,
                        error: 'Failed to write record into the form.'
                    });
                    return;
                }

                resolve({ imported: true });
            };

            reader.readAsText(file);
        });
    }

    // ============================================================
    // FILE INPUT FACTORY
    // ============================================================

    /**
     * Create a hidden file input, wire it, and click it. The input
     * removes itself from the DOM after the read completes or the
     * user cancels.
     *
     * Using a fresh input per invocation is more robust than reusing
     * a single one, because a reused input can fire `change` with
     * the previous file's value when the user picks the same file
     * twice.
     */
    function triggerImportPicker() {
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

            importFile(file).then(function(result) {
                if (result.imported) {
                    notify(
                        'Character profile imported into the form. ' +
                        'Review the fields, then click Save.',
                        'success'
                    );
                } else {
                    notify(
                        'Import failed: ' + (result.error || 'Unknown error'),
                        'error'
                    );
                }
                cleanup();
            });
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

    // ============================================================
    // PUBLIC ENTRY POINTS
    // ============================================================

    /**
     * Export the currently-edited character to a JSON file.
     *
     * Caller is expected to have confirmed there IS a current
     * character. This function does not raise its own confirm.
     *
     * @returns {Promise<{ exported: boolean, filename?: string, error?: string }>}
     */
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

    /**
     * Open a file picker and import the selected JSON into the form.
     *
     * When the form is currently showing a saved character, the
     * caller should have confirmed that the in-form data will be
     * replaced. This function does not raise its own confirm — it
     * trusts the caller's context.
     */
    function handleImportIntoForm() {
        triggerImportPicker();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterJSONIO = Object.freeze({
        exportCharacter: exportCharacter,
        importFile: importFile,

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
            'importFile',
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
