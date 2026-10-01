/**
 * js/import-export/csv/character-csv.js - Character CSV
 * Canonical source for all character CSV operations
 *
 * This module consolidates:
 *   - Character CSV schema (column definitions, field mapping)
 *   - Character CSV export (serialization)
 *   - Character CSV import (parsing)
 *   - Character CSV template generation
 *
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for character CSV
 *   - All character CSV operations use this module
 *   - PURE functions - no side effects, no mutations
 *   - No persistence, no DOM, no state
 *   - Import returns candidates (does NOT mutate)
 *   - Export is read-only (does NOT access window.data)
 *
 * LEGACY TEMPLATE ALIASES (v30):
 *   CharacterEvents and a small number of older callers look for a
 *   top-level download function on window, named one of:
 *
 *     downloadCharacterCSVTemplate
 *     downloadCharactersCSVTemplate
 *     downloadCharacterTemplate
 *     characterCSVTemplate
 *
 *   The canonical entry point is window.CharacterCSV.exportTemplate.
 *   The four aliases above are installed below, each routing to that
 *   canonical entry point. They exist for backward compatibility with
 *   callers that predate the consolidation into this module. New
 *   callers should use window.CharacterCSV.exportTemplate directly.
 *
 *   Do NOT remove the aliases without first grepping for their use.
 *   CharacterEvents.characterTemplateHandler currently checks each of
 *   the four names in order and fires the first one that is a
 *   function. Removing the aliases reintroduces the "Char template
 *   not available" failure.
 *
 * SECTION MARKER HANDLING:
 *   The section marker is compared via normalizeSectionMarker, which:
 *     - strips a leading UTF-8 BOM if one survived the CSV parser
 *     - trims surrounding whitespace
 *     - collapses the space between '#' and the section name
 *     - uppercases the result
 *   This makes "# CHARACTERS", "#CHARACTERS", "# characters", and
 *   "﻿# CHARACTERS" all match.
 *
 * ROW ACCEPTANCE:
 *   A data row is accepted when at least one cell has content. The
 *   CharacterId column may be empty — that is the normal case for a
 *   newly exported template or a hand-authored file, where the ID is
 *   assigned at import time.
 *
 * ID ASSIGNMENT:
 *   When a row is accepted and its CharacterId cell is empty, this
 *   module assigns a fresh ID via IdUtils.generateId('char') BEFORE
 *   adding the candidate to the valid list. This matches the prefix
 *   used by CharacterCRUD.createNewCharacter.
 *
 * PERSONALITY FIELDS (v2):
 *   The character record's personality object has grown from ten
 *   fields to fourteen. The four new fields are:
 *
 *     authority       relationship to authority
 *     conflictStyle   how they handle conflict
 *     socialStyle     how they relate to others
 *     quirks          a behavioural oddity
 *
 *   These are appended to the CSV as columns 22-25. Existing files
 *   that lack these columns import with empty strings for the four
 *   fields, which is the correct default.
 *
 * DEPENDENCIES:
 *   - window.CSV (from csv-parser.js) - MANDATORY
 *   - window.ImportResult (from import-result.js) - MANDATORY
 *   - window.ExportUtils (from export-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *
 * USAGE:
 *   var CharacterCSV = window.CharacterCSV;
 *
 *   // Export
 *   var result = CharacterCSV.export(characters);
 *   var result = CharacterCSV.exportFromData();
 *
 *   // Import
 *   var result = CharacterCSV.import(csvText);
 *   var candidates = result.getValid();
 *
 *   // Template
 *   var result = CharacterCSV.exportTemplate();
 *   var content = CharacterCSV.getTemplateContent();
 *
 *   // Legacy alias (equivalent to exportTemplate)
 *   window.downloadCharacterCSVTemplate();
 */

(function() {
    'use strict';

    if (window.__characterCSVLoaded) return;
    window.__characterCSVLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CSV || typeof window.CSV.parse !== 'function') {
        throw new Error('[CharacterCSV] CSV parser is required.');
    }
    if (!window.ImportResult || typeof window.ImportResult !== 'function') {
        throw new Error('[CharacterCSV] ImportResult is required.');
    }
    if (!window.ExportUtils || typeof window.ExportUtils.downloadBlob !== 'function') {
        throw new Error('[CharacterCSV] ExportUtils is required.');
    }
    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        throw new Error('[CharacterCSV] IdUtils is required.');
    }

    var CSV = window.CSV;
    var ImportResult = window.ImportResult;
    var ExportUtils = window.ExportUtils;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SECTION = '# CHARACTERS';
    var MAX_ROWS = 10000;
    var BOM_CHAR_CODE = 0xFEFF;
    var ID_PREFIX = 'char';

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================
    //
    // Twenty-six columns. The first twenty-two are the original set.
    // Columns 22-25 are the four new personality fields added when
    // the personality model grew.
    //
    // Column order matters: FIELD_MAP uses numeric indices, and both
    // parseRow and toRow read/write by index. Appending new columns
    // is safe; reordering existing ones is a breaking change.

    var COLUMNS = [
        'CharacterId',
        'FirstName',
        'MiddleName',
        'LastName',
        'BirthYear',
        'Gender',
        'AssociatedNames',
        'EyeColor',
        'HairColor',
        'SkinColor',
        'Height',
        'Weight',
        'Build',
        'AppearanceNotes',
        'Notes',
        'Deceased',
        'DeathYear',
        'DeathCause',
        'DeathAge',
        'Specialty',
        'CareerStatus',
        'EliminatedWeeks',
        // ---- New personality fields ----
        'Authority',
        'ConflictStyle',
        'SocialStyle',
        'Quirks'
    ];

    var FIELD_MAP = {
        0: 'id',
        1: 'firstName',
        2: 'middleName',
        3: 'lastName',
        4: 'birthYear',
        5: 'gender',
        6: 'associatedNames',
        7: 'eyes',
        8: 'hair',
        9: 'skin',
        10: 'height',
        11: 'weight',
        12: 'build',
        13: 'appearanceNotes',
        14: 'notes',
        15: 'deceased',
        16: 'deathYear',
        17: 'deathCause',
        18: 'deathAge',
        19: 'specialty',
        20: 'careerStatus',
        21: 'eliminatedWeeks',
        22: 'authority',
        23: 'conflictStyle',
        24: 'socialStyle',
        25: 'quirks'
    };

    // ============================================================
    // SECTION MARKER NORMALIZATION
    // ============================================================
    //
    // The section marker in the file may appear in several equivalent
    // forms. This normalization produces a single canonical string
    // for comparison.
    //
    //   "﻿# CHARACTERS"  → "#CHARACTERS"
    //   "# CHARACTERS"   → "#CHARACTERS"
    //   "#CHARACTERS"    → "#CHARACTERS"
    //   "# characters"   → "#CHARACTERS"
    //   "  #CHARACTERS " → "#CHARACTERS"
    //
    // Returns '' for null, undefined, or empty input.

    function normalizeSectionMarker(value) {
        var str = String(value == null ? '' : value);

        if (str.length > 0 && str.charCodeAt(0) === BOM_CHAR_CODE) {
            str = str.substring(1);
        }

        str = str.trim();
        if (str === '') { return ''; }

        if (str.charAt(0) === '#') {
            str = '#' + str.substring(1).trim();
        }

        return str.toUpperCase();
    }

    function isSectionMarker(value) {
        var normalized = normalizeSectionMarker(value);
        return normalized.length > 0 && normalized.charAt(0) === '#';
    }

    var TARGET_SECTION_MARKER = normalizeSectionMarker(SECTION);
    var HEADER_MARKER_FIRST_COLUMN = 'CHARACTERID';

    // ============================================================
    // SCHEMA HELPERS
    // ============================================================

    function getColumns() {
        return COLUMNS.slice();
    }

    function getHeader() {
        return COLUMNS.slice();
    }

    function getColumnIndex(fieldName) {
        for (var key in FIELD_MAP) {
            if (FIELD_MAP.hasOwnProperty(key) && FIELD_MAP[key] === fieldName) {
                return parseInt(key, 10);
            }
        }
        return null;
    }

    function getFieldName(index) {
        return FIELD_MAP[index] || null;
    }

    function getSection() {
        return SECTION;
    }

    // ============================================================
    // PARSING HELPERS
    // ============================================================

    function parseJSONField(value, fallback, warnFn, fieldName) {
        var str = String(value == null ? '' : value).trim();
        if (str === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(str);
            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in "' + fieldName + '": ' + e.message + ' - using fallback', fieldName);
            }
            return fallback;
        }
    }

    function parseBooleanField(value) {
        var str = String(value == null ? '' : value).trim();
        return str === 'true' || str === 'TRUE' || str === '1';
    }

    function isValidCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        var name = (candidate.firstName || '') + (candidate.lastName || '');
        return name.trim().length > 0;
    }

    function isBlankRow(row) {
        if (!row || row.length === 0) {
            return true;
        }
        for (var i = 0; i < row.length; i++) {
            var cell = String(row[i] == null ? '' : row[i]).trim();
            if (cell !== '') {
                return false;
            }
        }
        return true;
    }

    // ============================================================
    // ROW PARSING
    // ============================================================

    function parseRow(row, warnFn) {
        var errors = [];
        var warnings = [];

        var firstName = String(row[1] || '').trim();
        var lastName = String(row[3] || '').trim();

        if (!firstName && !lastName) {
            errors.push('Character row missing first name and last name');
            return { valid: false, character: null, errors: errors, warnings: warnings };
        }

        var id = String(row[0] || '').trim() || null;
        var deceased = parseBooleanField(row[15]);
        var careerStatus = parseJSONField(row[20], [], warnFn, 'CareerStatus');
        var eliminatedWeeks = parseJSONField(row[21], [], warnFn, 'EliminatedWeeks');

        var character = {
            id: id,
            firstName: firstName,
            middleName: String(row[2] || '').trim(),
            lastName: lastName,
            birthYear: String(row[4] || '').trim(),
            gender: String(row[5] || '').trim(),
            associatedNames: String(row[6] || '').trim(),
            eyes: String(row[7] || '').trim(),
            hair: String(row[8] || '').trim(),
            skin: String(row[9] || '').trim(),
            height: String(row[10] || '').trim(),
            weight: String(row[11] || '').trim(),
            build: String(row[12] || '').trim(),
            appearanceNotes: String(row[13] || '').trim(),
            notes: String(row[14] || '').trim(),
            deceased: deceased,
            deathYear: String(row[16] || '').trim(),
            deathCause: String(row[17] || '').trim(),
            deathAge: String(row[18] || '').trim(),
            specialty: String(row[19] || '').trim(),
            careerStatus: careerStatus,
            eliminatedWeeks: eliminatedWeeks,

            personality: {
                authority: String(row[22] || '').trim(),
                conflictStyle: String(row[23] || '').trim(),
                socialStyle: String(row[24] || '').trim(),
                quirks: String(row[25] || '').trim()
            }
        };

        return {
            valid: true,
            character: character,
            errors: errors,
            warnings: warnings
        };
    }

    // ============================================================
    // ROW SERIALIZATION
    // ============================================================

    function toRow(character) {
        if (!character || typeof character !== 'object') {
            return COLUMNS.map(function() { return ''; });
        }

        var personality = character.personality || {};

        return [
            character.id != null ? character.id : '',
            character.firstName != null ? character.firstName : '',
            character.middleName != null ? character.middleName : '',
            character.lastName != null ? character.lastName : '',
            character.birthYear != null ? character.birthYear : '',
            character.gender != null ? character.gender : '',
            character.associatedNames != null ? character.associatedNames : '',
            character.eyes != null ? character.eyes : '',
            character.hair != null ? character.hair : '',
            character.skin != null ? character.skin : '',
            character.height != null ? character.height : '',
            character.weight != null ? character.weight : '',
            character.build != null ? character.build : '',
            character.appearanceNotes != null ? character.appearanceNotes : '',
            character.notes != null ? character.notes : '',
            character.deceased ? 'true' : 'false',
            character.deathYear != null ? character.deathYear : '',
            character.deathCause != null ? character.deathCause : '',
            character.deathAge != null ? character.deathAge : '',
            character.specialty != null ? character.specialty : '',
            JSON.stringify(character.careerStatus != null ? character.careerStatus : []),
            JSON.stringify(character.eliminatedWeeks != null ? character.eliminatedWeeks : []),
            personality.authority != null ? personality.authority : '',
            personality.conflictStyle != null ? personality.conflictStyle : '',
            personality.socialStyle != null ? personality.socialStyle : '',
            personality.quirks != null ? personality.quirks : ''
        ];
    }

    function toRows(characters) {
        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        var rows = [
            [SECTION],
            COLUMNS.slice()
        ];

        for (var i = 0; i < characters.length; i++) {
            rows.push(toRow(characters[i]));
        }

        return rows;
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function exportCharacters(characters, options) {
        options = options || {};

        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        var rows = toRows(characters);
        var csvContent = CSV.arrayToCSV(rows);

        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename ||
            'characters-' + new Date().toISOString().slice(0, 10) + '.csv';

        ExportUtils.downloadBlob(blob, filename);

        return {
            count: characters.length,
            filename: filename
        };
    }

    function exportFromData(options) {
        options = options || {};

        if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacters !== 'function') {
            throw new Error('CharacterQueries not available.');
        }

        var characters = window.CharacterQueries.getCharacters();

        if (characters.length === 0) {
            return {
                count: 0,
                filename: null,
                message: 'No characters to export.'
            };
        }

        var result = exportCharacters(characters, options);
        result.message = 'Exported ' + result.count + ' characters';
        return result;
    }

    function getCSVContent(characters) {
        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        var rows = toRows(characters);
        return CSV.arrayToCSV(rows);
    }

    // ============================================================
    // IMPORT
    // ============================================================

    function extractRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];

            if (isBlankRow(row)) {
                continue;
            }

            var first = String(row[0] == null ? '' : row[0]);

            if (!inSection) {
                if (normalizeSectionMarker(first) === TARGET_SECTION_MARKER) {
                    inSection = true;
                }
                continue;
            }

            if (isSectionMarker(first)) {
                break;
            }

            if (normalizeSectionMarker(first) === HEADER_MARKER_FIRST_COLUMN) {
                continue;
            }

            rows.push(row);
        }

        return rows;
    }

    function importCharacters(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var maxRows = options.maxRows || MAX_ROWS;

        var result = new ImportResult();

        var records;
        try {
            records = CSV.parse(csvText);
        } catch (e) {
            result.addError('Failed to parse CSV: ' + e.message);
            return result;
        }

        if (records.length === 0) {
            result.addWarning('CSV file is empty');
            return result;
        }

        var characterRows = extractRows(records);
        if (characterRows.length === 0) {
            result.addError('No character data found. Expected "' + SECTION + '" section.');
            return result;
        }

        if (characterRows.length > maxRows) {
            result.addError('Too many rows (' + characterRows.length + '). Maximum is ' + maxRows + '.');
            return result;
        }

        for (var i = 0; i < characterRows.length; i++) {
            var row = characterRows[i];
            var rowNumber = i + 1;

            if (isBlankRow(row)) {
                continue;
            }

            var parsed = parseRow(row, function(warning, fieldName) {
                var msg = warning;
                if (fieldName) {
                    msg = fieldName + ': ' + warning;
                }
                result.addWarning(msg, { row: rowNumber, field: fieldName });
            });

            if (parsed.valid) {
                if (isValidCandidate(parsed.character)) {
                    if (!parsed.character.id) {
                        parsed.character.id = IdUtils.generateId(ID_PREFIX);
                    }
                    result.addValid(parsed.character, { row: rowNumber });
                } else {
                    result.addError('Invalid character data (missing name)', { row: rowNumber });
                }
            }

            for (var j = 0; j < parsed.errors.length; j++) {
                result.addError(parsed.errors[j], { row: rowNumber });
            }
        }

        if (strict) {
            var filteredValid = [];
            var validItems = result.getValid(true);
            for (var k = 0; k < validItems.length; k++) {
                var item = validItems[k];
                var rowNum = item.metadata && item.metadata.row;
                if (rowNum) {
                    var rowErrors = result.getErrorsForRow(rowNum);
                    if (rowErrors.length === 0) {
                        filteredValid.push(item);
                    } else {
                        result.addSkipped(item.record, 'Row had errors', { row: rowNum });
                    }
                } else {
                    filteredValid.push(item);
                }
            }
            result._valid = filteredValid;
        }

        return result;
    }

    function importFromFile(file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                try {
                    var result = importCharacters(e.target.result, options);
                    resolve(result);
                } catch (err) {
                    reject(new Error('Failed to import characters: ' + err.message));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
            };

            reader.readAsText(file);
        });
    }

    // ============================================================
    // TEMPLATE
    // ============================================================

    function getTemplateCharacters(options) {
        options = options || {};
        var count = options.count || 2;

        var templates = [
            {
                id: null,
                firstName: 'John',
                middleName: '',
                lastName: 'Doe',
                birthYear: '1990',
                gender: 'Male',
                associatedNames: '',
                eyes: 'Blue',
                hair: 'Brown',
                skin: 'Fair',
                height: "5'10\"",
                weight: '75kg',
                build: 'Athletic',
                appearanceNotes: '',
                notes: 'Example character',
                deceased: false,
                deathYear: '',
                deathCause: '',
                deathAge: '',
                specialty: '',
                careerStatus: [{ status: 'trainee', startYear: 1920, endYear: 1923 }],
                eliminatedWeeks: [],
                personality: {
                    authority: 'Cooperative but independent',
                    conflictStyle: 'Negotiates first',
                    socialStyle: 'Warm with strangers',
                    quirks: 'Collects information they have no use for'
                }
            },
            {
                id: null,
                firstName: 'Jane',
                middleName: 'Mary',
                lastName: 'Smith',
                birthYear: '1992',
                gender: 'Female',
                associatedNames: 'The Shadow',
                eyes: 'Green',
                hair: 'Black',
                skin: 'Olive',
                height: "5'7\"",
                weight: '60kg',
                build: 'Slim',
                appearanceNotes: 'Scar on cheek',
                notes: '',
                deceased: false,
                deathYear: '',
                deathCause: '',
                deathAge: '',
                specialty: '',
                careerStatus: [{ status: 'trainee', startYear: 1920, endYear: 1923 }],
                eliminatedWeeks: [],
                personality: {
                    authority: 'Suspicious of authority',
                    conflictStyle: 'Lets resentment build quietly',
                    socialStyle: 'Reserved until trust is earned',
                    quirks: 'Hates owing anyone a favour'
                }
            }
        ];

        return templates.slice(0, count);
    }

    function getTemplateRows(options) {
        options = options || {};

        var characters;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            characters = options.exampleData;
        } else {
            characters = getTemplateCharacters({ count: options.exampleCount || 2 });
        }

        return toRows(characters);
    }

    function getTemplateContent(options) {
        var rows = getTemplateRows(options);
        return CSV.arrayToCSV(rows);
    }

    function exportTemplate(options) {
        options = options || {};

        var content = getTemplateContent(options);

        var blob = new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename || 'characters-template.csv';
        ExportUtils.downloadBlob(blob, filename);

        return {
            exported: true,
            filename: filename
        };
    }

    function getTemplatePreview(options) {
        options = options || {};
        var previewRows = options.previewRows || 2;

        var rows = getTemplateRows(options);
        var headers = rows.length > 1 ? rows[1] : [];
        var examples = [];

        for (var i = 2; i < Math.min(rows.length, 2 + previewRows); i++) {
            examples.push(rows[i]);
        }

        return {
            headers: headers,
            examples: examples
        };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateCandidates(candidates) {
        if (!Array.isArray(candidates)) {
            throw new TypeError('Candidates must be an array.');
        }

        var valid = [];
        var invalid = [];

        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            if (isValidCandidate(candidate)) {
                valid.push(candidate);
            } else {
                invalid.push({
                    index: i,
                    candidate: candidate,
                    reason: 'Missing required fields (firstName/lastName)'
                });
            }
        }

        return { valid: valid, invalid: invalid };
    }

    function getImportPreview(result, limit) {
        limit = limit || 5;

        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var valid = result.getValid();
        var preview = valid.slice(0, limit);

        return {
            preview: preview,
            total: valid.length,
            hasMore: valid.length > limit
        };
    }

    function getImportSummary(result) {
        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var summary = result.getSummary();

        var messages = [];
        if (summary.valid > 0) {
            messages.push(summary.valid + ' character(s) ready to import');
        }
        if (summary.errors > 0) {
            messages.push(summary.errors + ' error(s) found');
        }
        if (summary.warnings > 0) {
            messages.push(summary.warnings + ' warning(s) found');
        }

        return {
            total: summary.total,
            valid: summary.valid,
            errors: summary.errors,
            warnings: summary.warnings,
            added: summary.added,
            updated: summary.updated,
            skipped: summary.skipped,
            hasErrors: summary.hasErrors,
            hasWarnings: summary.hasWarnings,
            message: messages.join(', ') || 'No characters found'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterCSV = {
        // ---- Constants ----
        SECTION: SECTION,
        COLUMNS: COLUMNS,
        ID_PREFIX: ID_PREFIX,

        // ---- Schema helpers ----
        getColumns: getColumns,
        getHeader: getHeader,
        getColumnIndex: getColumnIndex,
        getFieldName: getFieldName,
        getSection: getSection,

        // ---- Parsing ----
        parseRow: parseRow,
        parseJSONField: parseJSONField,
        parseBooleanField: parseBooleanField,
        isValidCandidate: isValidCandidate,
        extractRows: extractRows,

        // ---- Serialization ----
        toRow: toRow,
        toRows: toRows,

        // ---- Export ----
        export: exportCharacters,
        exportFromData: exportFromData,
        getCSVContent: getCSVContent,

        // ---- Import ----
        import: importCharacters,
        importFromFile: importFromFile,

        // ---- Template ----
        getTemplateCharacters: getTemplateCharacters,
        getTemplateRows: getTemplateRows,
        getTemplateContent: getTemplateContent,
        exportTemplate: exportTemplate,
        getTemplatePreview: getTemplatePreview,

        // ---- Validation ----
        validateCandidates: validateCandidates,
        getImportPreview: getImportPreview,
        getImportSummary: getImportSummary
    };

    // ============================================================
    // LEGACY TEMPLATE ALIASES
    // ============================================================
    //
    // CharacterEvents.characterTemplateHandler checks each of these
    // four names in order and fires the first one that is a function.
    // They all route to the canonical exportTemplate.
    //
    // See the LEGACY TEMPLATE ALIASES note in the file header.

    window.downloadCharacterCSVTemplate = exportTemplate;
    window.downloadCharactersCSVTemplate = exportTemplate;
    window.downloadCharacterTemplate = exportTemplate;
    window.characterCSVTemplate = exportTemplate;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterCSV;
        var missing = [];

        var required = [
            'export', 'exportFromData', 'getCSVContent',
            'import', 'importFromFile',
            'exportTemplate', 'getTemplateContent', 'getTemplateRows', 'getTemplatePreview',
            'validateCandidates', 'getImportPreview', 'getImportSummary',
            'parseRow', 'toRow', 'toRows',
            'getColumns', 'getHeader', 'getSection'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Legacy aliases are also part of the module's contract.
        var aliasNames = [
            'downloadCharacterCSVTemplate',
            'downloadCharactersCSVTemplate',
            'downloadCharacterTemplate',
            'characterCSVTemplate'
        ];
        for (var a = 0; a < aliasNames.length; a++) {
            if (typeof window[aliasNames[a]] !== 'function') {
                missing.push(aliasNames[a]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CharacterCSV] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
