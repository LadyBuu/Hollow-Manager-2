/**
 * js/export/character-csv-schema.js
 * Canonical Character CSV schema - single source of truth for all character CSV operations.
 * 
 * This module defines:
 * - The CSV section header
 * - Column names and order
 * - Field mapping between CSV and character objects
 * - Parsing logic for CSV rows
 * - Serialization logic for character objects
 * - Template generation
 * 
 * All character CSV operations (export, import, template) should use this schema.
 */

(function() {
    'use strict';

    // ============================================================
    // SECTION HEADER
    // ============================================================

    /**
     * The section marker used in CSV files to identify character data.
     * Must appear on a line by itself before the character data.
     */
    var SECTION = '# CHARACTERS';

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================

    /**
     * Canonical column order for character CSV.
     * This defines the exact order of columns in exported files
     * and the expected order in imported files.
     */
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

    /**
     * Map column index to character field name.
     * Used during import to assign CSV values to character properties.
     */
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

    /**
     * Required fields for a valid character row.
     * Used during import validation.
     */
    var REQUIRED_FIELDS = {
        firstName: { index: 1, label: 'FirstName' },
        lastName: { index: 3, label: 'LastName' }
    };

    // ============================================================
    // PARSING
    // ============================================================

    /**
     * Parse a CSV row into a character candidate object.
     * 
     * @param {Array} row - CSV row as array of strings
     * @param {Function} warnFn - Optional warning callback (message, fieldName)
     * @returns {Object} { valid: boolean, character: object|null, errors: string[], warnings: string[] }
     */
    function parseRow(row, warnFn) {
        var errors = [];
        var warnings = [];

        // Validate required fields
        var firstName = String(row[1] || '').trim();
        var lastName = String(row[3] || '').trim();

        if (!firstName && !lastName) {
            errors.push('Character row missing first name and last name');
            return { valid: false, character: null, errors: errors, warnings: warnings };
        }

        // Extract ID - null means "create new"
        var id = String(row[0] || '').trim() || null;

        // Parse boolean
        var deceasedValue = String(row[15] || '').trim();
        var deceased = deceasedValue === 'true' || deceasedValue === 'TRUE' || deceasedValue === '1';

        // Parse JSON fields
        var careerStatus = parseJSONField(row[20], [], warnFn, 'CareerStatus');
        var eliminatedWeeks = parseJSONField(row[21], [], warnFn, 'EliminatedWeeks');

        // Build character candidate
        var character = {
            // Identity
            id: id,
            firstName: firstName,
            middleName: String(row[2] || '').trim(),
            lastName: lastName,

            // Demographics
            birthYear: String(row[4] || '').trim(),
            gender: String(row[5] || '').trim(),

            // Names and titles
            associatedNames: String(row[6] || '').trim(),

            // Physical appearance
            eyes: String(row[7] || '').trim(),
            hair: String(row[8] || '').trim(),
            skin: String(row[9] || '').trim(),
            height: String(row[10] || '').trim(),
            weight: String(row[11] || '').trim(),
            build: String(row[12] || '').trim(),
            appearanceNotes: String(row[13] || '').trim(),

            // Metadata
            notes: String(row[14] || '').trim(),
            specialty: String(row[19] || '').trim(),

            // Status flags
            deceased: deceased,
            deathYear: String(row[16] || '').trim(),
            deathCause: String(row[17] || '').trim(),
            deathAge: String(row[18] || '').trim(),

            // Structured data (JSON)
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

    /**
     * Parse a JSON field from a CSV cell.
     * Returns fallback if the field is empty or invalid.
     * 
     * @param {string} value - Raw cell value
     * @param {*} fallback - Default value if parsing fails
     * @param {Function} warnFn - Warning callback
     * @param {string} fieldName - Name of the field for error messages
     * @returns {*} Parsed value or fallback
     */
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

    /**
     * Parse a boolean field from a CSV cell.
     * Accepts: true, TRUE, 1, false, FALSE, 0, or empty string (defaults to false)
     * 
     * @param {string} value - Raw cell value
     * @returns {boolean} Parsed boolean
     */
    function parseBooleanField(value) {
        var str = String(value == null ? '' : value).trim();
        return str === 'true' || str === 'TRUE' || str === '1';
    }

    /**
     * Parse an integer field from a CSV cell.
     * 
     * @param {string} value - Raw cell value
     * @param {number} fallback - Default if empty
     * @param {Function} warnFn - Warning callback
     * @param {string} fieldName - Name of the field for error messages
     * @returns {number|string} Parsed integer or fallback
     */
    function parseIntegerField(value, fallback, warnFn, fieldName) {
        var str = String(value == null ? '' : value).trim();
        if (str === '') {
            return fallback;
        }

        if (!/^-?\d+$/.test(str)) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid integer in "' + fieldName + '": "' + str + '" - using fallback', fieldName);
            }
            return fallback;
        }

        var parsed = parseInt(str, 10);
        if (!Number.isSafeInteger(parsed)) {
            if (typeof warnFn === 'function') {
                warnFn('Integer "' + str + '" is outside safe range for "' + fieldName + '" - using fallback', fieldName);
            }
            return fallback;
        }

        return parsed;
    }

    // ============================================================
    // SERIALIZATION
    // ============================================================

    /**
     * Convert a character object to a CSV row (array of strings).
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
     * @returns {Array} Array of CSV rows (including header)
     */
    function toRows(characters) {
        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        var rows = [
            [SECTION],
            COLUMNS.slice() // Copy header array
        ];

        characters.forEach(function(char) {
            rows.push(toRow(char));
        });

        return rows;
    }

    /**
     * Get the CSV header row.
     * 
     * @returns {Array} Header row as array of strings
     */
    function getHeader() {
        return COLUMNS.slice();
    }

    // ============================================================
    // TEMPLATE
    // ============================================================

    /**
     * Generate example/template rows for the CSV template.
     * 
     * @returns {Array} Template rows (including section and header)
     */
    function getTemplateRows() {
        return [
            [SECTION],
            COLUMNS.slice(),
            [
                '',                             // CharacterId
                'John',                         // FirstName
                '',                             // MiddleName
                'Doe',                          // LastName
                '1990',                         // BirthYear
                'Male',                         // Gender
                '',                             // AssociatedNames
                'Blue',                         // EyeColor
                'Brown',                        // HairColor
                'Fair',                         // SkinColor
                "5'10\"",                       // Height
                '75kg',                         // Weight
                'Athletic',                     // Build
                '',                             // AppearanceNotes
                'Example character',            // Notes
                'false',                        // Deceased
                '',                             // DeathYear
                '',                             // DeathCause
                '',                             // DeathAge
                '',                             // Specialty
                '[{"status":"trainee","startYear":1920,"endYear":1923}]', // CareerStatus
                '[]'                            // EliminatedWeeks
            ],
            [
                '',                             // CharacterId
                'Jane',                         // FirstName
                'Mary',                         // MiddleName
                'Smith',                        // LastName
                '1992',                         // BirthYear
                'Female',                       // Gender
                'The Shadow',                   // AssociatedNames
                'Green',                        // EyeColor
                'Black',                        // HairColor
                'Olive',                        // SkinColor
                "5'7\"",                        // Height
                '60kg',                         // Weight
                'Slim',                         // Build
                'Scar on cheek',                // AppearanceNotes
                '',                             // Notes
                'false',                        // Deceased
                '',                             // DeathYear
                '',                             // DeathCause
                '',                             // DeathAge
                '',                             // Specialty
                '[{"status":"trainee","startYear":1920,"endYear":1923}]', // CareerStatus
                '[]'                            // EliminatedWeeks
            ]
        ];
    }

    /**
     * Get example character template as an array of character objects.
     * Useful for testing or seeding.
     * 
     * @returns {Array} Template character objects
     */
    function getTemplateCharacters() {
        return [
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
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Check if a character candidate is complete enough for import.
     * 
     * @param {Object} candidate - Character candidate from parseRow
     * @returns {boolean} True if valid
     */
    function isValidCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        var name = (candidate.firstName || '') + (candidate.lastName || '');
        return name.trim().length > 0;
    }

    /**
     * Get a list of all column names.
     * 
     * @returns {Array} Column names
     */
    function getColumns() {
        return COLUMNS.slice();
    }

    /**
     * Get the column index for a given field name.
     * 
     * @param {string} fieldName - Character field name
     * @returns {number|null} Column index or null if not found
     */
    function getColumnIndex(fieldName) {
        for (var key in FIELD_MAP) {
            if (FIELD_MAP.hasOwnProperty(key) && FIELD_MAP[key] === fieldName) {
                return parseInt(key, 10);
            }
        }
        return null;
    }

    /**
     * Get the character field name for a given column index.
     * 
     * @param {number} index - Column index
     * @returns {string|null} Field name or null if not found
     */
    function getFieldName(index) {
        return FIELD_MAP[index] || null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterCSVSchema = {
        // Constants
        SECTION: SECTION,
        COLUMNS: COLUMNS,

        // Parsing
        parseRow: parseRow,
        parseJSONField: parseJSONField,
        parseBooleanField: parseBooleanField,
        parseIntegerField: parseIntegerField,

        // Serialization
        toRow: toRow,
        toRows: toRows,
        getHeader: getHeader,

        // Template
        getTemplateRows: getTemplateRows,
        getTemplateCharacters: getTemplateCharacters,

        // Validation helpers
        isValidCandidate: isValidCandidate,
        getColumns: getColumns,
        getColumnIndex: getColumnIndex,
        getFieldName: getFieldName
    };

})();
