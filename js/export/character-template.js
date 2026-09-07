/**
 * js/export/character-template.js - Character CSV Template
 * Generates a template CSV file for character imports.
 * 
 * This module uses the canonical CharacterCSVSchema to generate
 * template rows with example data.
 * 
 * It does NOT:
 * - Access window.data
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Mutate any state
 * 
 * Usage:
 *   // Download template
 *   var result = exportCharacterTemplate();
 *   // result: { exported: true, filename: string }
 * 
 *   // Or get template content without downloading
 *   var csvContent = getCharacterTemplateContent();
 */

(function() {
    'use strict';

    // ============================================================
    // Dependencies
    // ============================================================

    var parser = window.CSV;
    var schema = window.CharacterCSVSchema;
    var fileUtils = window.FileUtils || window.ExportUtils;

    // Validate dependencies
    if (!parser || typeof parser.arrayToCSV !== 'function') {
        throw new Error('CharacterTemplate: CSV parser not available');
    }
    if (!schema || typeof schema.getTemplateRows !== 'function') {
        throw new Error('CharacterTemplate: CharacterCSVSchema not available');
    }
    if (!fileUtils || typeof fileUtils.downloadBlob !== 'function') {
        throw new Error('CharacterTemplate: FileUtils not available');
    }

    // ============================================================
    // Template Functions
    // ============================================================

    /**
     * Generate and download a character CSV template.
     * 
     * @param {Object} options - Template options
     * @param {string} options.filename - Custom filename (optional)
     * @param {Array} options.exampleData - Custom example data (optional)
     * @returns {Object} { exported: boolean, filename: string }
     */
    function exportCharacterTemplate(options) {
        options = options || {};

        // Get template rows
        var rows;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            // Use custom example data
            rows = schema.toRows(options.exampleData);
            // Ensure section header and column header are present
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                // Prepend section and header if not present
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                rows = headerRows.concat(rows.slice(1));
            }
        } else {
            // Use default template
            rows = schema.getTemplateRows();
        }

        var csvContent = parser.arrayToCSV(rows);

        // Create blob with BOM for Excel compatibility
        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        // Generate filename
        var filename = options.filename || 'characters-template.csv';

        // Download
        fileUtils.downloadBlob(blob, filename);

        return {
            exported: true,
            filename: filename
        };
    }

    /**
     * Get template CSV content as a string without downloading.
     * Useful for testing or preview.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data (optional)
     * @returns {string} CSV content
     */
    function getCharacterTemplateContent(options) {
        options = options || {};

        var rows;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            rows = schema.toRows(options.exampleData);
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                rows = headerRows.concat(rows.slice(1));
            }
        } else {
            rows = schema.getTemplateRows();
        }

        return parser.arrayToCSV(rows);
    }

    /**
     * Get template rows as an array (not CSV).
     * Useful for programmatic use.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data (optional)
     * @returns {Array} Array of CSV rows
     */
    function getCharacterTemplateRows(options) {
        options = options || {};

        if (options.exampleData && Array.isArray(options.exampleData)) {
            var rows = schema.toRows(options.exampleData);
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                return headerRows.concat(rows.slice(1));
            }
            return rows;
        }

        return schema.getTemplateRows();
    }

    /**
     * Get template characters as objects.
     * Useful for populating a form or preview.
     * 
     * @param {Object} options - Template options
     * @param {number} options.count - Number of template characters to return (default: 2)
     * @returns {Array} Array of character objects
     */
    function getTemplateCharacters(options) {
        options = options || {};
        var count = options.count || 2;

        if (typeof schema.getTemplateCharacters === 'function') {
            var templates = schema.getTemplateCharacters();
            return templates.slice(0, count);
        }

        // Fallback if schema doesn't have template characters
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
        ].slice(0, count);
    }

    /**
     * Get a preview of the template for display.
     * 
     * @param {Object} options - Template options
     * @param {number} options.previewRows - Number of example rows to show (default: 2)
     * @returns {Object} { headers: Array, examples: Array }
     */
    function getTemplatePreview(options) {
        options = options || {};
        var previewRows = options.previewRows || 2;

        var rows = getCharacterTemplateRows(options);
        var headers = rows.length > 1 ? rows[1] : [];
        var examples = [];

        // Skip section header (row 0) and column header (row 1)
        for (var i = 2; i < Math.min(rows.length, 2 + previewRows); i++) {
            examples.push(rows[i]);
        }

        return {
            headers: headers,
            examples: examples
        };
    }

    // ============================================================
    // Expose
    // ============================================================

    window.exportCharacterTemplate = exportCharacterTemplate;
    window.getCharacterTemplateContent = getCharacterTemplateContent;
    window.getCharacterTemplateRows = getCharacterTemplateRows;
    window.getTemplateCharacters = getTemplateCharacters;
    window.getCharacterTemplatePreview = getTemplatePreview;

})();
