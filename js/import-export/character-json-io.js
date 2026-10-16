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
 *     pasted by the user into a modal textarea (or loaded from a
 *     file), parsed, per-field coerced, and then written into the
 *     form fields via CharacterForm. The user then reviews and
 *     clicks Save.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Persistence. Import does NOT write to the store. It fills the
 *     form. The user saves.
 *   - Field enumeration. CharacterForm owns the field ids.
 *   - The form's field shape. FormUtils owns the DOM writes.
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
 *   the fragment contains. If the fragment names any of them, they
 *   are listed in the import summary as "not applicable" so the user
 *   knows they were ignored rather than silently applied.
 *
 *   The presence of a key in the fragment is the "this section should
 *   be updated" signal. There is no separate section picker.
 *
 * NORMALISATION:
 *   This module does NOT run the fragment through
 *   CharacterCRUD.normaliseCharacterData. That function defaults
 *   every absent field to ''/0/false, which would overwrite every
 *   form field the fragment does not name — defeating the entire
 *   selective-import contract. Instead, this module coerces each
 *   present value per-field at write time:
 *
 *     - numeric fields (stats, magic, hp, mp, birthYear, deathYear,
 *       deathAge, careerStatus years, weapon fields) are parsed
 *       through a strict integer/number coercion
 *     - string fields are stringified
 *     - boolean fields are coerced via the same rule FormUtils uses
 *
 *   A value that fails to coerce is NOT written. It is reported in
 *   the import result as "skipped (invalid value)", so the user sees
 *   which fields the fragment named but the importer refused.
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
 *   with a shim carrying the fragment's moves.
 *
 *   Move IDs are STRIPPED on import. A fragment exported from
 *   character A carries A's move ids; importing it into character B
 *   without stripping would collide with B's own moves at merge
 *   time, because CharacterCRUD's mergeSpecialMoves matches by id.
 *   Stripping them at import time makes every imported move land as
 *   a fresh move with a new id, which is the correct semantics for
 *   "bring this profile into a different character".
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
 *   parses with JSON.parse, coerces each present value through a
 *   strict per-field coercion, and writes the result into the DOM
 *   via FormUtils.
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterForm
 *   - window.FormUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.ExportUtils
 *   - window.CharacterStatsView  (moves section renderer)
 *   - window.MagicConstants      (magic level labels, optional)
 *   - window.IdUtils             (not required; not used)
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. A missing
 *   dependency produces a clear error the first time the operation
 *   that needs it is invoked, not at load time.
 */

(function() {
    'use strict';

    if (window.__characterJsonIoLoaded) {
        return;
    }
    window.__characterJsonIoLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCharacterQueries()   { return window.CharacterQueries || null; }
    function getCharacterCRUD()      { return window.CharacterCRUD || null; }
    function getCharacterForm()      { return window.CharacterForm || null; }
    function getFormUtils()          { return window.FormUtils || null; }
    function getModal()              { return window.Modal || null; }
    function getNotificationSystem() { return window.NotificationSystem || null; }
    function getExportUtils()        { return window.ExportUtils || null; }
    function getCharacterStatsView() { return window.CharacterStatsView || null; }
    function getMagicConstants()     { return window.MagicConstants || null; }

    // ============================================================
    // DEPENDENCY CHECKS - per entry point
    // ============================================================

    function checkExportDependencies() {
        var missing = [];

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CQ || typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        var EU = getExportUtils();
        if (!EU || typeof EU.downloadBlob !== 'function') {
            missing.push('ExportUtils.downloadBlob');
        }

        return missing;
    }

    function checkImportDependencies() {
        var missing = [];

        var FormUtils = getFormUtils();
        if (!FormUtils || typeof FormUtils.setField !== 'function') {
            missing.push('FormUtils.setField');
        }

        var CF = getCharacterForm();
        if (!CF ||
            typeof CF.render !== 'function') {
            missing.push('CharacterForm.render');
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

        return missing;
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _clickHandler = null;
    var _keydownHandler = null;
    var _inputHandler = null;
    var _fileInputCleanup = null;

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
    //
    // sexuality and deathWeek are in this list because the form has
    // no corresponding input for either. They are real fields on the
    // record; the form simply does not edit them. An import that
    // carries them is not a mistake — it is a fragment exported from
    // a record with more data than the form can show, and the
    // importer is honest about ignoring it.
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
        'nameFormat': true,
        'sexuality': true,
        'deathWeek': true
    };

    // ============================================================
    // HELPERS - notification and escaping
    // ============================================================

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        } else if (typeof console !== 'undefined' && console.warn) {
            console.warn('[CharacterJSONIO]', message);
        }
    }

    function escapeHtml(value) {
        var DU = window.DomUtils;
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

    function hasKey(obj, key) {
        return obj !== null &&
               typeof obj === 'object' &&
               Object.prototype.hasOwnProperty.call(obj, key);
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

    // ============================================================
    // PER-FIELD COERCION
    // ============================================================
    //
    // The importer knows which form field is numeric, string, or
    // boolean. A value that fails to coerce is NOT written; it is
    // recorded in `_skippedFields` and reported to the user.
    //
    // We do not run the fragment through normaliseCharacterData:
    // that would default every absent field, defeating selective
    // import. See the NORMALISATION note in the header.

    function coerceString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    /**
     * Coerce a numeric field. Accepts:
     *   - finite numbers
     *   - strings matching /^-?\d+(\.\d+)?$/
     *   - the empty string (clears the field)
     *   - null, undefined (clears the field)
     *
     * Returns { ok: true, value: number|'' } on success, or
     * { ok: false } on a malformed value.
     */
    function coerceNumber(value) {
        if (value === undefined || value === null || value === '') {
            return { ok: true, value: '' };
        }
        if (typeof value === 'number') {
            if (isFinite(value)) {
                return { ok: true, value: value };
            }
            return { ok: false };
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') {
                return { ok: true, value: '' };
            }
            if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
                return { ok: false };
            }
            var num = Number(trimmed);
            if (!isFinite(num)) { return { ok: false }; }
            return { ok: true, value: num };
        }
        return { ok: false };
    }

    /**
     * Coerce a value to boolean, matching FormUtils's checkbox rule:
     * the strings 'true' and 'false' are honoured, everything else
     * follows JS truthiness. Null and undefined coerce to false.
     */
    function coerceBoolean(value) {
        if (typeof value === 'string') {
            if (value === 'false') { return false; }
            if (value === 'true') { return true; }
        }
        return !!value;
    }

    // ============================================================
    // SKIP TRACKING
    // ============================================================
    //
    // Every write helper reports into a single per-import set of
    // skipped field ids. The set is reset at the start of each
    // import and consumed by the result. This is the mechanism by
    // which a malformed value produces a visible message instead of
    // a silent blank.

    var _skippedFields = [];

    function resetSkippedFields() {
        _skippedFields = [];
    }

    function recordSkipped(fieldLabel) {
        if (_skippedFields.indexOf(fieldLabel) === -1) {
            _skippedFields.push(fieldLabel);
        }
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function exportCharacter(charId) {
        if (!charId) {
            return {
                exported: false,
                error: 'No character id supplied.'
            };
        }

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return {
                exported: false,
                error: 'Character queries are not available.'
            };
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return {
                exported: false,
                error: 'Character not found.'
            };
        }

        var EU = getExportUtils();
        if (!EU || typeof EU.downloadBlob !== 'function') {
            return {
                exported: false,
                error: 'Export utilities are not available.'
            };
        }

        var snapshot;
        try {
            // structuredClone preserves types JSON.stringify would
            // coerce (Dates to strings, NaN to null). The stored
            // record is JSON-shaped, so JSON is a faithful round
            // trip today, but structuredClone is the safer choice
            // for a full-fidelity export.
            if (typeof structuredClone === 'function') {
                snapshot = structuredClone(char);
            } else {
                snapshot = JSON.parse(JSON.stringify(char));
            }
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
            EU.downloadBlob(blob, baseFilename);
        } catch (e) {
            return {
                exported: false,
                error: 'Failed to download: ' + e.message
            };
        }

        return {
            exported: true,
            filename: baseFilename
        };
    }

    // ============================================================
    // FIELD WRITERS
    // ============================================================
    //
    // Every writer is called only when the corresponding key is
    // PRESENT in the fragment. The presence check lives in
    // writeRecordToForm, not here.

    function writeStringField(id, value, label) {
        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }
        FormUtils.setField(id, coerceString(value));
    }

    function writeNumberField(id, value, label) {
        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        var coerced = coerceNumber(value);
        if (!coerced.ok) {
            recordSkipped(label || id);
            return;
        }
        FormUtils.setField(id, coerced.value);
    }

    function writeBooleanField(id, value) {
        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }
        FormUtils.setField(id, coerceBoolean(value));
    }

    function writeDisplayParts(value) {
        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }
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

        var CharacterForm = getCharacterForm();
        if (!CharacterForm ||
            typeof CharacterForm.addPreviousNameRow !== 'function') {
            return;
        }

        if (names.length === 0) {
            CharacterForm.addPreviousNameRow(container, '');
            return;
        }

        names.forEach(function(n) {
            CharacterForm.addPreviousNameRow(
                container, coerceString(n)
            );
        });
    }

    function writeStats(stats) {
        if (!stats || typeof stats !== 'object') { return; }

        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        var keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        keys.forEach(function(k) {
            if (!hasKey(stats, k)) { return; }

            var coerced = coerceNumber(stats[k]);
            if (!coerced.ok) {
                recordSkipped('stat ' + k.toUpperCase());
                return;
            }
            FormUtils.setField('char-stat-' + k, coerced.value);
        });
    }

    function writeMagic(magic) {
        if (!magic || typeof magic !== 'object') { return; }

        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        var keys = Object.keys(magic);
        var written = [];

        keys.forEach(function(k) {
            var coerced = coerceNumber(magic[k]);
            if (!coerced.ok) {
                recordSkipped('magic ' + k);
                return;
            }
            FormUtils.setField('char-magic-' + k, coerced.value);
            written.push({ key: k, value: coerced.value });
        });

        // Refresh the companion level labels next to each input.
        var MC = getMagicConstants();
        if (MC &&
            typeof MC.getProficiencyLevelLabel === 'function') {
            written.forEach(function(entry) {
                var levelEl = document.querySelector(
                    '[data-magic-level="' + entry.key + '"]'
                );
                if (levelEl) {
                    levelEl.textContent =
                        MC.getProficiencyLevelLabel(entry.value);
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

        var CharacterForm = getCharacterForm();
        if (!CharacterForm ||
            typeof CharacterForm.addWeaponRow !== 'function') {
            return;
        }

        weapons.forEach(function(w) {
            // Do not coerce the weapon entry's interior. The form
            // row builder already handles missing fields; its
            // own defaults (empty name, default type, empty notes)
            // are the correct fallback for an undefined value.
            CharacterForm.addWeaponRow(container, w);
        });
    }

    /**
     * Write the imported moves into the Combat tab's moves section.
     *
     * Move IDs are STRIPPED. A fragment exported from character A
     * carries A's move ids; importing it into character B without
     * stripping would collide with B's own moves at merge time,
     * because CharacterCRUD's mergeSpecialMoves matches by id.
     * Stripping them here means every imported move lands as a
     * fresh move with a new id — the correct semantics for
     * "bring this profile into a different character".
     */
    function writeSpecialMoves(moves) {
        var CSV = getCharacterStatsView();
        if (!CSV ||
            typeof CSV.renderMovesSection !== 'function') {
            console.warn(
                '[CharacterJSONIO] ' +
                'CharacterStatsView.renderMovesSection is not ' +
                'available; imported moves will not appear in the form.'
            );
            return;
        }

        var physical = moves && Array.isArray(moves.physical)
            ? moves.physical
            : [];
        var magical = moves && Array.isArray(moves.magical)
            ? moves.magical
            : [];

        function stripIds(list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!m || typeof m !== 'object') { continue; }
                out.push({
                    id: '',
                    name: typeof m.name === 'string' ? m.name : '',
                    description: typeof m.description === 'string'
                        ? m.description
                        : ''
                });
            }
            return out;
        }

        try {
            CSV.renderMovesSection({
                specialMoves: {
                    physical: stripIds(physical),
                    magical: stripIds(magical)
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

        var CharacterForm = getCharacterForm();
        if (!CharacterForm ||
            typeof CharacterForm.addCareerEntryRow !== 'function') {
            return;
        }

        if (entries.length === 0) {
            CharacterForm.addCareerEntryRow(container);
            return;
        }

        entries.forEach(function(entry) {
            if (!entry || typeof entry !== 'object') { return; }

            // Per-field coercion on the entry. A malformed startYear
            // or endYear is reported rather than silently dropped;
            // the entry still renders with the other fields intact.
            var startCoerced = coerceNumber(entry.startYear);
            var endCoerced = coerceNumber(entry.endYear);

            if (!startCoerced.ok) {
                recordSkipped('career startYear');
            }
            if (!endCoerced.ok) {
                recordSkipped('career endYear');
            }

            CharacterForm.addCareerEntryRow(container, {
                status: coerceString(entry.status),
                startYear: startCoerced.ok
                    ? startCoerced.value : '',
                endYear: endCoerced.ok
                    ? endCoerced.value : '',
                title: coerceString(entry.title)
            });
        });
    }

    function writePersonality(p) {
        if (!p || typeof p !== 'object') { return; }

        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

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
                FormUtils.setField(map[k], coerceString(p[k]));
            }
        });
    }

    function writeDeceasedState(isDeceased) {
        var FormUtils = getFormUtils();
        if (FormUtils) {
            FormUtils.setField('char-deceased', isDeceased === true);
        }

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display =
                isDeceased === true ? 'block' : 'none';
        }

        var CharacterForm = getCharacterForm();
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
    // core of the merge semantics.

    function writeRecordToForm(fragment) {
        if (!fragment || typeof fragment !== 'object') {
            return false;
        }

        // ---- Name block ----
        if (hasKey(fragment, 'firstName')) {
            writeStringField('char-firstName', fragment.firstName);
        }
        if (hasKey(fragment, 'middleName')) {
            writeStringField('char-middleName', fragment.middleName);
        }
        if (hasKey(fragment, 'lastName')) {
            writeStringField('char-lastName', fragment.lastName);
        }
        if (hasKey(fragment, 'nickname')) {
            writeStringField('char-nickname', fragment.nickname);
        }
        if (hasKey(fragment, 'alias')) {
            writeStringField('char-alias', fragment.alias);
        }
        if (hasKey(fragment, 'previousNames')) {
            writePreviousNames(fragment.previousNames);
        }
        if (hasKey(fragment, 'displayParts')) {
            writeDisplayParts(fragment.displayParts);
        }

        // ---- Identity block ----
        if (hasKey(fragment, 'birthYear')) {
            writeNumberField('char-birthYear', fragment.birthYear,
                'birth year');
        }
        if (hasKey(fragment, 'gender')) {
            writeStringField('char-gender', fragment.gender);
        }
        if (hasKey(fragment, 'attraction')) {
            writeStringField('char-attraction', fragment.attraction);
        }

        // ---- Life Events block ----
        if (hasKey(fragment, 'deceased')) {
            writeDeceasedState(fragment.deceased === true);
        }
        if (hasKey(fragment, 'deathYear')) {
            writeNumberField('char-deathYear', fragment.deathYear,
                'death year');
        }
        if (hasKey(fragment, 'deathAge')) {
            writeNumberField('char-deathAge', fragment.deathAge,
                'death age');
        }
        if (hasKey(fragment, 'deathCause')) {
            writeStringField('char-deathCause', fragment.deathCause);
        }

        // ---- Physical block ----
        if (hasKey(fragment, 'eyes')) {
            writeStringField('char-eyes', fragment.eyes);
        }
        if (hasKey(fragment, 'hair')) {
            writeStringField('char-hair', fragment.hair);
        }
        if (hasKey(fragment, 'skin')) {
            writeStringField('char-skin', fragment.skin);
        }
        if (hasKey(fragment, 'height')) {
            writeStringField('char-height', fragment.height);
        }
        if (hasKey(fragment, 'weight')) {
            writeStringField('char-weight', fragment.weight);
        }
        if (hasKey(fragment, 'build')) {
            writeStringField('char-build', fragment.build);
        }
        if (hasKey(fragment, 'appearanceNotes')) {
            writeStringField('char-appearanceNotes',
                fragment.appearanceNotes);
        }

        // ---- Personality block ----
        if (hasKey(fragment, 'personality')) {
            writePersonality(fragment.personality);
        }

        // ---- Professional block ----
        if (hasKey(fragment, 'specialty')) {
            writeStringField('char-specialty', fragment.specialty);
        }
        if (hasKey(fragment, 'careerStatus')) {
            writeCareerStatus(fragment.careerStatus);
        }

        // ---- Combat block ----
        if (hasKey(fragment, 'stats')) {
            writeStats(fragment.stats);
        }
        if (hasKey(fragment, 'hp')) {
            writeNumberField('char-hp', fragment.hp, 'HP');
        }
        if (hasKey(fragment, 'mp')) {
            writeNumberField('char-mp', fragment.mp, 'MP');
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
            writeStringField('char-combat-notes', fragment.combatNotes);
        }

        // ---- Notes block ----
        if (hasKey(fragment, 'notes')) {
            writeStringField('char-notes-tab', fragment.notes);
        }

        // ---- Filler flag ----
        if (hasKey(fragment, 'isFiller')) {
            writeBooleanField('char-is-filler', fragment.isFiller);
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
            return {
                updating: updating,
                notApplicable: notApplicable
            };
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
                notApplicable: [],
                skipped: []
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
                notApplicable: analysis.notApplicable,
                skipped: []
            };
        }

        resetSkippedFields();

        var wrote = writeRecordToForm(fragment);
        if (!wrote) {
            return {
                imported: false,
                error: 'Failed to write fragment into the form.',
                updating: [],
                notApplicable: [],
                skipped: []
            };
        }

        return {
            imported: true,
            updating: analysis.updating,
            notApplicable: analysis.notApplicable,
            skipped: _skippedFields.slice()
        };
    }

    // ============================================================
    // IMPORT MODAL
    // ============================================================

    function buildModalHTML() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Import Character JSON</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-json-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;' +
                    'color:var(--text-dim);' +
                    'margin:0 0 8px 0;line-height:1.45;">' +
                    'Paste a character fragment as JSON. Only the ' +
                    'fields present in the fragment are updated; ' +
                    'every other field on the form is left alone. ' +
                    'A full record works too \u2014 it updates every ' +
                    'field. Nothing is saved until you click ' +
                    '<strong>Save</strong> on the character form.' +
                '</p>';

        html += '<textarea ' +
                    'id="character-json-paste-input" ' +
                    'spellcheck="false" ' +
                    'autocomplete="off" ' +
                    'placeholder=\'{ "personality": { "traits": ' +
                    '"Cynical" } }\' ' +
                    'style="width:100%;min-height:260px;' +
                    'padding:8px 10px;background:var(--bg);' +
                    'border:1px solid var(--border);' +
                    'color:var(--text);border-radius:6px;' +
                    'font-family:monospace;font-size:0.72rem;' +
                    'line-height:1.5;resize:vertical;' +
                    'white-space:pre;overflow:auto;"></textarea>';

        html += '<div id="character-json-preview" ' +
                    'style="display:none;margin-top:8px;' +
                    'padding:8px 10px;' +
                    'background:var(--panel-alt);' +
                    'border:1px solid var(--border);' +
                    'border-left:3px solid var(--accent);' +
                    'border-radius:4px;font-size:0.72rem;' +
                    'color:var(--text);"></div>';

        html += '<div id="character-json-error" ' +
                    'style="display:none;margin-top:8px;' +
                    'padding:6px 10px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;font-size:0.72rem;' +
                    'color:var(--danger);"></div>';

        html += '<div style="display:flex;' +
                    'justify-content:space-between;' +
                    'align-items:center;gap:8px;' +
                    'margin-top:10px;flex-wrap:wrap;">';
        html += '<button type="button" class="secondary small" ' +
                    'data-json-action="file" ' +
                    'style="font-size:0.7rem;' +
                    'padding:4px 10px;">' +
                    'Load from file...' +
                '</button>';
        html += '<span style="font-size:0.65rem;' +
                    'color:var(--text-dim);">' +
                    'Or paste directly with Ctrl+V / Cmd+V' +
                '</span>';
        html += '</div>';

        html += '</div>';

        html += '<div class="form-actions" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-json-action="close">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-json-action="import">Import</button>';
        html += '</div>';

        return html;
    }

    function showError(contentEl, message) {
        var errorEl = contentEl.querySelector(
            '#character-json-error'
        );
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
                '<div style="margin-bottom:4px;' +
                    'color:var(--text-dim);">' +
                    'No recognised fields in this fragment.' +
                '</div>'
            );
        }

        if (analysis.notApplicable.length > 0) {
            parts.push(
                '<div style="color:var(--text-dim);' +
                    'font-size:0.65rem;">' +
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
        return contentEl.querySelector(
            '#character-json-paste-input'
        );
    }

    function closeImportModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _clickHandler) {
            try {
                contentEl.removeEventListener('click', _clickHandler);
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _keydownHandler) {
            try {
                contentEl.removeEventListener(
                    'keydown', _keydownHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _inputHandler) {
            try {
                contentEl.removeEventListener('input', _inputHandler);
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _clickHandler = null;
        _keydownHandler = null;
        _inputHandler = null;

        if (modal) {
            var M = getModal();
            if (M && typeof M.closeModal === 'function') {
                try { M.closeModal(modal); } catch (e) { /* ignore */ }
            }
        }
    }

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

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
                (result.updating.join(', ') || 'no changes') + '. ' +
                'Review the form, then click Save.';

            if (result.notApplicable &&
                result.notApplicable.length > 0) {
                message += ' (Ignored: ' +
                    result.notApplicable.join(', ') + '.)';
            }

            if (result.skipped && result.skipped.length > 0) {
                message += ' (Skipped invalid values: ' +
                    result.skipped.join(', ') + '.)';
                notify(message, 'warning');
            } else {
                notify(message, 'success');
            }
            return;
        }

        showError(contentEl, result.error || 'Import failed.');
    }

    /**
     * Open a hidden file input, read the chosen file, and drop its
     * text into the modal's textarea.
     *
     * The input is appended to document.body and removed on BOTH
     * `change` (the happy path) and `focus` on window (the cancel
     * path). Without the focus cleanup, a user who cancels the OS
     * dialog leaves an orphaned input in the DOM until page reload.
     */
    function openFilePickerIntoTextarea() {
        if (_fileInputCleanup) {
            _fileInputCleanup();
            _fileInputCleanup = null;
        }

        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';

        var windowFocusHandler = null;
        var cleanupTimer = null;
        var cleanedUp = false;

        function cleanup() {
            if (cleanedUp) { return; }
            cleanedUp = true;

            if (cleanupTimer) {
                clearTimeout(cleanupTimer);
                cleanupTimer = null;
            }

            if (windowFocusHandler) {
                window.removeEventListener(
                    'focus', windowFocusHandler
                );
                windowFocusHandler = null;
            }

            try {
                if (input.parentNode) {
                    input.parentNode.removeChild(input);
                }
            } catch (e) { /* ignore */ }

            _fileInputCleanup = null;
        }

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

        // When the OS file dialog closes — whether the user chose a
        // file or cancelled — window regains focus. On cancel, no
        // change event fires, and this is the only signal we get.
        //
        // Deferred by a tick so a rapid `focus` fires after the
        // `change` handler has had a chance to run.
        windowFocusHandler = function() {
            setTimeout(function() {
                cleanup();
            }, 0);
        };
        window.addEventListener('focus', windowFocusHandler);

        // Safety net for environments where `focus` does not fire
        // (rare; headless browsers, some WebViews). A long timer
        // beats a leaked node.
        cleanupTimer = setTimeout(cleanup, 60000);

        _fileInputCleanup = cleanup;

        document.body.appendChild(input);
        input.click();
    }

    function openImportModal() {
        var missing = checkImportDependencies();
        if (missing.length > 0) {
            console.error(
                '[CharacterJSONIO] Missing dependencies for import: ' +
                missing.join(', ')
            );
            notify(
                'Import is not available. Reload the page and try ' +
                'again.',
                'error'
            );
            return null;
        }

        closeImportModal();

        var M = getModal();
        var shell = M.createModal('character-json-import-modal');
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

        M.modalSetup(shell, function() {
            closeImportModal();
        });
        M.showModal(shell);

        setTimeout(function() {
            var pasteEl = getPasteEl(contentEl);
            if (pasteEl && typeof pasteEl.focus === 'function') {
                try { pasteEl.focus(); } catch (e) { /* ignore */ }
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

        var missing = checkExportDependencies();
        if (missing.length > 0) {
            console.error(
                '[CharacterJSONIO] Missing dependencies for export: ' +
                missing.join(', ')
            );
            notify(
                'Export is not available. Reload the page and try ' +
                'again.',
                'error'
            );
            return Promise.resolve({
                exported: false,
                error: 'Dependencies not loaded.'
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
    //
    // A failed smoke test logs a warning but does not throw. The
    // module's public functions are already exported above; aborting
    // here would only prevent a reload of the script from retrying.

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

        // Smoke test: parseFragment on empty text returns invalid.
        try {
            var parsed = exports.parseFragment('');
            if (!parsed || parsed.valid !== false) {
                missing.push('parseFragment("") should be invalid');
            }
        } catch (e) {
            missing.push('parseFragment threw: ' + e.message);
        }

        // Smoke test: parseFragment on a bare object is valid.
        try {
            var parsed2 = exports.parseFragment('{"firstName":"Ada"}');
            if (!parsed2 || parsed2.valid !== true) {
                missing.push(
                    'parseFragment of a plain object should be valid'
                );
            }
        } catch (e) {
            missing.push('parseFragment threw: ' + e.message);
        }

        if (missing.length > 0) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    '[CharacterJSONIO] Verification failed: ' +
                    missing.join('; ')
                );
            }
        }
    })();

})();
