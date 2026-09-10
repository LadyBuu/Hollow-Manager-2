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
 *   // or
 *   var result = CharacterCSV.exportFromData();
 *   
 *   // Import
 *   var result = CharacterCSV.import(csvText);
 *   var candidates = result.getValid();
 *   
 *   // Template
 *   var result = CharacterCSV.exportTemplate();
 *   var content = CharacterCSV.getTemplateContent();
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

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================

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
        'EliminatedWeeks'
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
        21: 'eliminatedWeeks'
    };

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

    /**
     * Parse a CSV row into a character candidate object.
     * 
     * @param {Array} row - CSV row as array of strings
     * @param {Function} warnFn - Optional warning callback
     * @returns {Object} { valid: boolean, character: object|null, errors: string[], warnings: string[] }
     */
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
            eliminatedWeeks: eliminatedWeeks
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

    /**
     * Convert a character object to a CSV row.
     * 
     * @param {Object} character - Character object
     * @returns {Array} CSV row as array of strings
     */
    function toRow(character) {
        if (!character || typeof character !== 'object') {
            return COLUMNS.map(function() { return ''; });
        }

        return [
            character.id ?? '',
            character.firstName ?? '',
            character.middleName ?? '',
            character.lastName ?? '',
            character.birthYear ?? '',
            character.gender ?? '',
            character.associatedNames ?? '',
            character.eyes ?? '',
            character.hair ?? '',
            character.skin ?? '',
            character.height ?? '',
            character.weight ?? '',
            character.build ?? '',
            character.appearanceNotes ?? '',
            character.notes ?? '',
            character.deceased ? 'true' : 'false',
            character.deathYear ?? '',
            character.deathCause ?? '',
            character.deathAge ?? '',
            character.specialty ?? '',
            JSON.stringify(character.careerStatus ?? []),
            JSON.stringify(character.eliminatedWeeks ?? [])
        ];
    }

    /**
     * Convert an array of character objects to CSV rows.
     * 
     * @param {Array} characters - Array of character objects
     * @returns {Array} Array of CSV rows (including section and header)
     */
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

    /**
     * Export characters to CSV and download.
     * 
     * @param {Array} characters - Array of character objects
     * @param {Object} options - Export options
     * @param {string} options.filename - Custom filename
     * @returns {Object} { count: number, filename: string }
     */
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

    /**
     * Export characters from the current application data.
     * 
     * @param {Object} options - Export options
     * @returns {Object} { count: number, filename: string, message: string|null }
     */
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

    /**
     * Get CSV content as a string without downloading.
     * 
     * @param {Array} characters - Array of character objects
     * @returns {string} CSV content
     */
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

    /**
     * Extract character rows from CSV records.
     * 
     * @param {Array} records - All CSV records
     * @returns {Array} Array of character data rows
     */
    function extractRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];

            if (isBlankRow(row)) {
                continue;
            }

            var first = String(row[0] || '').trim();

            if (first === SECTION) {
                inSection = true;
                continue;
            }

            if (inSection && first.startsWith('#')) {
                break;
            }

            if (inSection && first === 'CharacterId') {
                continue;
            }

            if (inSection) {
                if (row.length > 0 && String(row[0] || '').trim()) {
                    rows.push(row);
                }
            }
        }

        return rows;
    }

    /**
     * Parse CSV text into character candidates.
     * 
     * @param {string} csvText - CSV file content
     * @param {Object} options - Import options
     * @param {boolean} options.strict - Reject rows with errors (default: false)
     * @param {number} options.maxRows - Maximum rows to parse (default: 10000)
     * @returns {ImportResult} ImportResult with valid candidates, errors, warnings
     */
    function importCharacters(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var maxRows = options.maxRows || MAX_ROWS;

        var result = new ImportResult();

        // Parse CSV
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

        // Extract character rows
        var characterRows = extractRows(records);
        if (characterRows.length === 0) {
            result.addError('No character data found. Expected "' + SECTION + '" section.');
            return result;
        }

        if (characterRows.length > maxRows) {
            result.addError('Too many rows (' + characterRows.length + '). Maximum is ' + maxRows + '.');
            return result;
        }

        // Parse each row
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
                    result.addValid(parsed.character, { row: rowNumber });
                } else {
                    result.addError('Invalid character data (missing name)', { row: rowNumber });
                }
            }

            for (var j = 0; j < parsed.errors.length; j++) {
                result.addError(parsed.errors[j], { row: rowNumber });
            }
        }

        // Filter in strict mode
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

    /**
     * Parse a character CSV file from a File object.
     * 
     * @param {File} file - CSV file
     * @param {Object} options - Import options
     * @returns {Promise<ImportResult>} Promise resolving to ImportResult
     */
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

    /**
     * Get template characters as objects.
     * 
     * @param {Object} options - Template options
     * @param {number} options.count - Number of examples (default: 2)
     * @returns {Array} Array of character objects
     */
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
                eliminatedWeeks: []
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
                eliminatedWeeks: []
            }
        ];

        return templates.slice(0, count);
    }

    /**
     * Get template rows as an array.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data
     * @param {number} options.exampleCount - Number of examples (default: 2)
     * @returns {Array} Array of CSV rows
     */
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

    /**
     * Get template CSV content as a string.
     * 
     * @param {Object} options - Template options
     * @returns {string} CSV content
     */
    function getTemplateContent(options) {
        var rows = getTemplateRows(options);
        return CSV.arrayToCSV(rows);
    }

    /**
     * Export character CSV template.
     * 
     * @param {Object} options - Template options
     * @param {string} options.filename - Custom filename
     * @param {Array} options.exampleData - Custom example data
     * @returns {Object} { exported: boolean, filename: string }
     */
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

    /**
     * Get template preview for display.
     * 
     * @param {Object} options - Template options
     * @param {number} options.previewRows - Number of example rows to show (default: 2)
     * @returns {Object} { headers: Array, examples: Array }
     */
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

    /**
     * Validate character candidates against the schema.
     * 
     * @param {Array} candidates - Character candidates
     * @returns {Object} { valid: Array, invalid: Array }
     */
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

    /**
     * Get a preview of the import result.
     * 
     * @param {ImportResult} result - Import result
     * @param {number} limit - Number of records to preview (default: 5)
     * @returns {Object} { preview: Array, total: number, hasMore: boolean }
     */
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

    /**
     * Get a summary of the import result for display.
     * 
     * @param {ImportResult} result - Import result
     * @returns {Object} Formatted summary
     */
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

        if (missing.length > 0) {
            console.warn('[CharacterCSV] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CharacterCSV] All exports verified successfully.');
        }
    })();

})();
