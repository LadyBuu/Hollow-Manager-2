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
 *     form. The user saves.
 *   - Field enumeration. normaliseCharacterData is the canonical
 *     shape; this module delegates to it.
 *   - The form's field ids. CharacterForm owns those.
 *   - Download mechanics. ExportUtils.downloadBlob owns the anchor,
 *     the blob URL, and the filename uniquification. This module
 *     supplies a base filename and hands over the payload.
 *
 * SELECTIVE IMPORT (MERGE SEMANTICS):
 *   Importing a JSON fragment updates ONLY the form fields whose keys
 *   appear in the fragment. Keys absent from the fragment are left
 *   alone. This makes partial profiles usable: paste
 *   `{ "personality": { "traits": "Cynical" } }` and only the traits
 *   input changes; every other field on the form keeps its current
 *   value.
 *
 *   Object-valued keys (personality, magic, specialMoves,
 *   displayParts) are merged recursively: a sub-key present in the
 *   fragment overwrites the corresponding form field, and a sub-key
 *   absent from the fragment is left alone. Arrays (weapons,
 *   careerStatus, previousNames) are replaced wholesale when the key
 *   is present, because "merge two weapons lists" has no sensible
 *   meaning.
 *
 *   Fields the form does not edit are not written regardless of what
 *   the fragment contains:
 *
 *     id, createdAt, updatedAt, classIds, parentIds,
 *     eliminations, eliminatedWeeks, mode
 *
 *   These are managed by other modules. If the fragment names any of
 *   them, they are listed in the import summary as "not applicable"
 *   so the user knows they were ignored rather than silently applied.
 *
 *   The presence of a key in the fragment is the "this section should
 *   be updated" signal. There is no separate section picker.
 *
 * EMPTY-VALUE SEMANTICS:
 *   A key present with an empty string, null, or an empty object is
 *   still "present" for merge purposes. That is how the user clears a
 *   field: paste `{ "eyes": "" }` and the eyes input is emptied.
 *   Absence, not emptiness, is what leaves a field untouched.
 *
 * SPECIAL MOVES:
 *   The moves section of the Combat tab is rendered by
 *   CharacterStatsView.renderMovesSection and read back by
 *   CharacterStatsView.collectMovesFromDOM. This module writes the
 *   imported moves into that section by calling renderMovesSection
 *   with a shim carrying the fragment's moves. When the fragment has
 *   no specialMoves key, the section is left as-is.
 *
 *   The moves are NOT written to any field id. The DOM list is the
 *   source of truth for the form's moves.
 *
 * DOWNLOAD FILENAMES:
 *   This module produces a base filename of the form
 *   "character-<first>-<last>.json". ExportUtils.downloadBlob
 *   inserts a local-time timestamp before the extension, so a
 *   second export of the same character in the same session never
 *   collides with the first.
 *
 * IMPORT INPUT:
 *   The import path is a MODAL with a textarea, not a file picker.
 *   The user pastes the JSON text directly, clicks Import, and the
 *   form fills. A "Load from file..." link is also present for
 *   users who have the JSON on disk.
 *
 *   A live preview under the textarea shows which sections the
 *   fragment will update, so the user knows before clicking Import.
 *
 * EXPORT SHAPE:
 *   A single JSON object: the full character record. Not wrapped in
 *   an envelope, not arrayed. Base filename:
 *     character-<first>-<last>.json
 *
 * IMPORT SHAPE:
 *   The pasted text may contain either:
 *     - a single character object: { firstName, ... } (full or partial)
 *     - an array of character objects: [ {...}, {...} ] — in which
 *       case only the FIRST entry is imported, because the target
 *       is the character form and the form holds one character.
 *
 *   Unknown keys are ignored. Malformed JSON is rejected with an
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
 *   - window.ExportUtils
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.CharacterStatsView  (moves section renderer)
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
    var ExportUtils = window.ExportUtils;

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
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
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
    var _inputHandler = null;

    // ============================================================
    // SECTION DEFINITIONS
    // ============================================================
    //
    // Each section is a key on the character record plus a human
    // label for the preview. The section's "present" state is
    // decided by whether that key appears in the fragment. The
    // write order follows the array order, so the preview reads
    // top-to-bottom in the same order as the form tabs.

    var SECTIONS = [
        {
            keys: ['firstName', 'middleName', 'lastName',
                   'nickname', 'alias', 'previousNames',
                   'displayParts'],
            label: 'Name'
        },
        {
            keys: ['birthYear', 'gender', 'attraction'],
            label: 'Identity'
        },
        {
            keys: ['deceased', 'deathYear', 'deathAge',
                   'deathCause'],
            label: 'Life Events'
        },
        {
            keys: ['eyes', 'hair', 'skin', 'height', 'weight',
                   'build', 'appearanceNotes'],
            label: 'Physical'
        },
        {
            keys: ['personality'],
            label: 'Personality'
        },
        {
            keys: ['specialty', 'careerStatus'],
            label: 'Professional'
        },
        {
            keys: ['stats', 'hp', 'mp', 'magic', 'weapons',
                   'specialMoves', 'combatNotes'],
            label: 'Combat'
        },
        {
            keys: ['notes'],
            label: 'Notes'
        },
        {
            keys: ['isFiller'],
            label: 'Filler Flag'
        }
    ];

    // Keys the form does not edit. If a fragment carries any of
    // these, they are reported as "not applicable" so the user
    // knows the importer skipped them on purpose.
    var NON_FORM_KEYS = {
        'id': true,
        'createdAt': true,
        'updatedAt': true,
        'classIds': true,
        'parentIds': true,
        'eliminations': true,
        'eliminatedWeeks': true,
        'mode': true,
        'graduatingClassId': true,
        'graduatingClassInstructor': true,
        'nameFormat': true
    };

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

    function hasKey(obj, key) {
        return obj !== null &&
               typeof obj === 'object' &&
               Object.prototype.hasOwnProperty.call(obj, key);
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

        var baseFilename = buildFilename(char);
        var text = JSON.stringify(snapshot, null, 2);

        try {
            var blob = new Blob([text], { type: 'application/json' });
            ExportUtils.downloadBlob(blob, baseFilename);
        } catch (e) {
            return {
                exported: false,
                error: 'Failed to download: ' + e.message
            };
        }

        return { exported: true, filename: baseFilename };
    }

    // ============================================================
    // FORM FIELD WRITERS
    // ============================================================
    //
    // Every writer below is called only when the corresponding key
    // is PRESENT in the fragment. The presence check happens in
    // writeRecordToForm, not here.

    function writeScalarField(id, value) {
        FormUtils.setField(id, value);
    }

    function writeDisplayParts(value) {
        if (!value || typeof value !== 'object') { return; }
        var dp = value;

        if (hasKey(dp, 'first')) {
            FormUtils.setField('char-displayFirst',
                dp.first !== false);
        }
        if (hasKey(dp, 'nickname')) {
            FormUtils.setField('char-displayNickname',
                dp.nickname === true);
        }
        if (hasKey(dp, 'middle')) {
            FormUtils.setField('char-displayMiddle',
                dp.middle !== false);
        }
        if (hasKey(dp, 'last')) {
            FormUtils.setField('char-displayLast',
                dp.last !== false);
        }
        if (hasKey(dp, 'alias')) {
            FormUtils.setField('char-displayAlias',
                dp.alias === true);
        }
    }

    function writePreviousNames(names) {
        if (!Array.isArray(names)) { return; }

        var container = document.getElementById(
            'previous-names-container'
        );
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addPreviousNameRow === 'function') {
            if (names.length === 0) {
                CharacterForm.addPreviousNameRow(container, '');
            } else {
                names.forEach(function(n) {
                    CharacterForm.addPreviousNameRow(container, n);
                });
            }
        }
    }

    function writeStats(stats) {
        if (!stats || typeof stats !== 'object') { return; }
        var keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        keys.forEach(function(k) {
            if (hasKey(stats, k)) {
                FormUtils.setField('char-stat-' + k, stats[k]);
            }
        });
    }

    function writeMagic(magic) {
        if (!magic || typeof magic !== 'object') { return; }
        var keys = Object.keys(magic);
        keys.forEach(function(k) {
            FormUtils.setField('char-magic-' + k, magic[k]);
        });

        // Some magic types have a companion level label next to
        // their input. Refresh any that exist.
        if (window.MagicConstants &&
            typeof window.MagicConstants.getProficiencyLevelLabel ===
            'function') {
            keys.forEach(function(k) {
                var levelEl = document.querySelector(
                    '[data-magic-level="' + k + '"]'
                );
                if (levelEl) {
                    levelEl.textContent =
                        window.MagicConstants
                            .getProficiencyLevelLabel(magic[k]);
                }
            });
        }
    }

    function writeWeapons(weapons) {
        if (!Array.isArray(weapons)) { return; }

        var container = document.getElementById(
            'weapons-container'
        );
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addWeaponRow === 'function') {
            weapons.forEach(function(w) {
                CharacterForm.addWeaponRow(container, w);
            });
        }
    }

    function writeSpecialMoves(moves) {
        var CharacterStatsView = window.CharacterStatsView || null;
        if (!CharacterStatsView ||
            typeof CharacterStatsView.renderMovesSection !== 'function') {
            console.warn(
                '[CharacterJSONIO] CharacterStatsView.renderMovesSection ' +
                'is not available; imported moves will not appear in ' +
                'the form.'
            );
            return;
        }

        var physical = moves && Array.isArray(moves.physical)
            ? moves.physical
            : [];
        var magical = moves && Array.isArray(moves.magical)
            ? moves.magical
            : [];

        try {
            CharacterStatsView.renderMovesSection({
                specialMoves: {
                    physical: physical,
                    magical: magical
                }
            });
        } catch (e) {
            console.warn(
                '[CharacterJSONIO] renderMovesSection threw while ' +
                'importing moves:', e
            );
        }
    }

    function writeCareerStatus(entries) {
        if (!Array.isArray(entries)) { return; }

        var container = document.getElementById(
            'career-status-container'
        );
        if (!container) { return; }
        container.textContent = '';

        if (CharacterForm &&
            typeof CharacterForm.addCareerEntryRow === 'function') {
            if (entries.length === 0) {
                CharacterForm.addCareerEntryRow(container);
            } else {
                entries.forEach(function(entry) {
                    CharacterForm.addCareerEntryRow(
                        container, entry
                    );
                });
            }
        }
    }

    function writePersonality(p) {
        if (!p || typeof p !== 'object') { return; }

        var map = {
            traits:        'char-personality-traits',
            ideals:        'char-personality-ideals',
            bonds:         'char-personality-bonds',
            flaws:         'char-personality-flaws',
            alignment:     'char-personality-alignment',
            likes:         'char-personality-likes',
            dislikes:      'char-personality-dislikes',
            habits:        'char-personality-habits',
            fears:         'char-personality-fears',
            goals:         'char-personality-goals',
            authority:     'char-personality-authority',
            conflictStyle: 'char-personality-conflictStyle',
            socialStyle:   'char-personality-socialStyle',
            quirks:        'char-personality-quirks'
        };

        var keys = Object.keys(map);
        keys.forEach(function(k) {
            if (hasKey(p, k)) {
                FormUtils.setField(map[k], p[k] || '');
            }
        });
    }

    function writeDeceasedState(isDeceased) {
        FormUtils.setField('char-deceased', isDeceased === true);

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display =
                isDeceased === true ? 'block' : 'none';
        }

        if (CharacterForm &&
            typeof CharacterForm.applyDeceasedState === 'function') {
            CharacterForm.applyDeceasedState(isDeceased === true);
        }
    }

    // ============================================================
    // SELECTIVE WRITE
    // ============================================================
    //
    // Write only the fields whose keys appear in the fragment.
    // Fields whose keys are absent are left untouched. This is the
    // core of merge semantics.

    function writeRecordToForm(fragment) {
        if (!fragment || typeof fragment !== 'object') {
            return false;
        }

        // ---- Name block ----
        if (hasKey(fragment, 'firstName')) {
            writeScalarField('char-firstName',
                fragment.firstName || '');
        }
        if (hasKey(fragment, 'middleName')) {
            writeScalarField('char-middleName',
                fragment.middleName || '');
        }
        if (hasKey(fragment, 'lastName')) {
            writeScalarField('char-lastName',
                fragment.lastName || '');
        }
        if (hasKey(fragment, 'nickname')) {
            writeScalarField('char-nickname',
                fragment.nickname || '');
        }
        if (hasKey(fragment, 'alias')) {
            writeScalarField('char-alias',
                fragment.alias || '');
        }
        if (hasKey(fragment, 'previousNames')) {
            writePreviousNames(fragment.previousNames);
        }
        if (hasKey(fragment, 'displayParts')) {
            writeDisplayParts(fragment.displayParts);
        }

        // ---- Identity block ----
        if (hasKey(fragment, 'birthYear')) {
            writeScalarField('char-birthYear',
                fragment.birthYear || '');
        }
        if (hasKey(fragment, 'gender')) {
            writeScalarField('char-gender',
                fragment.gender || '');
        }
        if (hasKey(fragment, 'attraction')) {
            writeScalarField('char-attraction',
                fragment.attraction || '');
        }

        // ---- Life Events block ----
        if (hasKey(fragment, 'deceased')) {
            writeDeceasedState(fragment.deceased === true);
        }
        if (hasKey(fragment, 'deathYear')) {
            writeScalarField('char-deathYear',
                fragment.deathYear || '');
        }
        if (hasKey(fragment, 'deathAge')) {
            writeScalarField('char-deathAge',
                fragment.deathAge || '');
        }
        if (hasKey(fragment, 'deathCause')) {
            writeScalarField('char-deathCause',
                fragment.deathCause || '');
        }

        // ---- Physical block ----
        if (hasKey(fragment, 'eyes')) {
            writeScalarField('char-eyes',
                fragment.eyes || '');
        }
        if (hasKey(fragment, 'hair')) {
            writeScalarField('char-hair',
                fragment.hair || '');
        }
        if (hasKey(fragment, 'skin')) {
            writeScalarField('char-skin',
                fragment.skin || '');
        }
        if (hasKey(fragment, 'height')) {
            writeScalarField('char-height',
                fragment.height || '');
        }
        if (hasKey(fragment, 'weight')) {
            writeScalarField('char-weight',
                fragment.weight || '');
        }
        if (hasKey(fragment, 'build')) {
            writeScalarField('char-build',
                fragment.build || '');
        }
        if (hasKey(fragment, 'appearanceNotes')) {
            writeScalarField('char-appearanceNotes',
                fragment.appearanceNotes || '');
        }

        // ---- Personality block ----
        if (hasKey(fragment, 'personality')) {
            writePersonality(fragment.personality);
        }

        // ---- Professional block ----
        if (hasKey(fragment, 'specialty')) {
            writeScalarField('char-specialty',
                fragment.specialty || '');
        }
        if (hasKey(fragment, 'careerStatus')) {
            writeCareerStatus(fragment.careerStatus);
        }

        // ---- Combat block ----
        if (hasKey(fragment, 'stats')) {
            writeStats(fragment.stats);
        }
        if (hasKey(fragment, 'hp')) {
            writeScalarField('char-hp',
                fragment.hp || 0);
        }
        if (hasKey(fragment, 'mp')) {
            writeScalarField('char-mp',
                fragment.mp || 0);
        }
        if (hasKey(fragment, 'magic')) {
            writeMagic(fragment.magic);
        }
        if (hasKey(fragment, 'weapons')) {
            writeWeapons(fragment.weapons);
        }
        if (hasKey(fragment, 'specialMoves')) {
            writeSpecialMoves(fragment.specialMoves);
        }
        if (hasKey(fragment, 'combatNotes')) {
            writeScalarField('char-combat-notes',
                fragment.combatNotes || '');
        }

        // ---- Notes block ----
        if (hasKey(fragment, 'notes')) {
            writeScalarField('char-notes-tab',
                fragment.notes || '');
        }

        // ---- Filler flag ----
        if (hasKey(fragment, 'isFiller')) {
            FormUtils.setField('char-is-filler',
                fragment.isFiller === true);
        }

        return true;
    }

    // ============================================================
    // SECTION ANALYSIS (for the preview)
    // ============================================================
    //
    // Given a fragment, decide which sections it will update and
    // which non-form keys it names. The result is used by the
    // modal to show the user what will happen before they commit.

    function analyseFragment(fragment) {
        var updating = [];
        var notApplicable = [];

        if (!fragment || typeof fragment !== 'object') {
            return { updating: updating, notApplicable: notApplicable };
        }

        // Sections that have at least one of their keys present.
        for (var i = 0; i < SECTIONS.length; i++) {
            var section = SECTIONS[i];
            var hit = false;
            for (var k = 0; k < section.keys.length; k++) {
                if (hasKey(fragment, section.keys[k])) {
                    hit = true;
                    break;
                }
            }
            if (hit) {
                updating.push(section.label);
            }
        }

        // Non-form keys that appear in the fragment.
        var allKeys = Object.keys(fragment);
        for (var j = 0; j < allKeys.length; j++) {
            var key = allKeys[j];
            if (NON_FORM_KEYS[key] === true) {
                notApplicable.push(key);
            }
        }

        return {
            updating: updating,
            notApplicable: notApplicable
        };
    }

    // ============================================================
    // PARSE
    // ============================================================

    /**
     * Parse a JSON fragment. Returns { valid, fragment, error }.
     * Does not write anything.
     */
    function parseFragment(text) {
        if (typeof text !== 'string' || text.trim() === '') {
            return {
                valid: false,
                fragment: null,
                error: 'Paste a JSON object first.'
            };
        }

        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return {
                valid: false,
                fragment: null,
                error: 'Not valid JSON: ' + e.message
            };
        }

        var fragment = parsed;
        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                return {
                    valid: false,
                    fragment: null,
                    error: 'The array is empty.'
                };
            }
            fragment = parsed[0];
        }

        if (!fragment ||
            typeof fragment !== 'object' ||
            Array.isArray(fragment)) {
            return {
                valid: false,
                fragment: null,
                error: 'The text does not contain a character object.'
            };
        }

        return {
            valid: true,
            fragment: fragment,
            error: null
        };
    }

    // ============================================================
    // IMPORT
    // ============================================================

    /**
     * Parse a JSON fragment and write its present keys into the
     * form. Does NOT save.
     *
     * Because writeRecordToForm uses presence semantics, a full
     * record behaves the same as it always did: every key on the
     * record is present, so every field is written. A partial
     * fragment writes only the fields it names.
     */
    function importText(text) {
        var parsed = parseFragment(text);
        if (!parsed.valid) {
            return {
                imported: false,
                error: parsed.error,
                updating: [],
                notApplicable: []
            };
        }

        var fragment = parsed.fragment;

        // A fragment must name at least one key the importer
        // understands, otherwise there is nothing to do.
        var analysis = analyseFragment(fragment);
        if (analysis.updating.length === 0) {
            return {
                imported: false,
                error: 'The fragment has no recognised character ' +
                       'fields. Nothing to import.',
                updating: [],
                notApplicable: analysis.notApplicable
            };
        }

        var wrote = writeRecordToForm(fragment);
        if (!wrote) {
            return {
                imported: false,
                error: 'Failed to write fragment into the form.',
                updating: [],
                notApplicable: []
            };
        }

        return {
            imported: true,
            updating: analysis.updating,
            notApplicable: analysis.notApplicable
        };
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
                    Paste a character fragment as JSON. Only the fields
                    present in the fragment are updated; every other
                    field on the form is left alone. A full record works
                    too — it updates every field. Nothing is saved until
                    you click <strong>Save</strong> on the character form.
                </p>

                <textarea id="character-json-paste-input"
                          spellcheck="false"
                          autocomplete="off"
                          placeholder='{ "personality": { "traits": "Cynical" } }'
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

                <div id="character-json-preview"
                     style="display:none;margin-top:8px;padding:8px 10px;
                            background:var(--panel-alt);
                            border:1px solid var(--border);
                            border-left:3px solid var(--accent);
                            border-radius:4px;
                            font-size:0.72rem;
                            color:var(--text);"></div>

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

    function showPreview(contentEl, text) {
        var previewEl = contentEl.querySelector(
            '#character-json-preview'
        );
        if (!previewEl) { return; }

        if (!text || String(text).trim() === '') {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
            return;
        }

        var parsed = parseFragment(text);
        if (!parsed.valid) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
            return;
        }

        var analysis = analyseFragment(parsed.fragment);

        var parts = [];

        if (analysis.updating.length > 0) {
            parts.push(
                '<div style="margin-bottom:4px;">' +
                    '<strong style="color:var(--accent);">' +
                        'Will update:' +
                    '</strong> ' +
                    escapeHtml(analysis.updating.join(', ')) +
                '</div>'
            );
        } else {
            parts.push(
                '<div style="margin-bottom:4px;color:var(--text-dim);">' +
                    'No recognised fields in this fragment.' +
                '</div>'
            );
        }

        if (analysis.notApplicable.length > 0) {
            parts.push(
                '<div style="color:var(--text-dim);font-size:0.65rem;">' +
                    'Not applicable to the form: ' +
                    escapeHtml(
                        analysis.notApplicable.join(', ')
                    ) +
                '</div>'
            );
        }

        previewEl.innerHTML = parts.join('');
        previewEl.style.display = 'block';
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
        if (contentEl && _inputHandler) {
            try {
                contentEl.removeEventListener('input', _inputHandler);
            } catch (e) {}
        }

        _modal = null;
        _contentEl = null;
        _clickHandler = null;
        _keydownHandler = null;
        _inputHandler = null;

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

            var message = 'Imported: ' +
                (result.updating.join(', ') || 'no changes') +
                '. Review the form, then click Save.';
            if (result.notApplicable &&
                result.notApplicable.length > 0) {
                message += ' (Ignored: ' +
                    result.notApplicable.join(', ') + '.)';
            }
            notify(message, 'success');
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
                    showPreview(_contentEl, text);
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
        _inputHandler = function(e) {
            var target = e.target;
            if (!target) { return; }
            if (target.id === 'character-json-paste-input') {
                showError(contentEl, '');
                showPreview(contentEl, target.value);
            }
        };

        contentEl.addEventListener('click', _clickHandler);
        contentEl.addEventListener('keydown', _keydownHandler);
        contentEl.addEventListener('input', _inputHandler);

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
        buildFilename: buildFilename,
        analyseFragment: analyseFragment,
        parseFragment: parseFragment
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
