/**
 * js/export/character-export.js - Character CSV Export
 * Pure export adapter - no UI, no persistence, no window.data
 * 
 * This module exports character data to CSV format using the canonical
 * CharacterCSVSchema for column definitions and serialization.
 * 
 * It does NOT:
 * - Access window.data directly
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Handle empty state (that's the caller's responsibility)
 * 
 * Usage:
 *   var characters = CharacterQueries.getAllCharacters();
 *   var result = exportCharactersCSV(characters);
 *   // result: { count: number }
 * 
 *   // Or use the convenience function:
 *   exportCharactersFromData(); // uses CharacterQueries
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
        throw new Error('CharacterCSVExport: CSV parser not available');
    }
    if (!schema || typeof schema.toRows !== 'function') {
        throw new Error('CharacterCSVExport: CharacterCSVSchema not available');
    }
    if (!fileUtils || typeof fileUtils.downloadBlob !== 'function') {
        throw new Error('CharacterCSVExport: FileUtils not available');
    }

    // ============================================================
    // Export Functions
    // ============================================================

    /**
     * Export an array of characters to CSV format and download.
     * 
     * @param {Array} characters - Array of character objects
     * @param {Object} options - Export options
     * @param {string} options.filename - Custom filename (optional)
     * @returns {Object} { count: number, filename: string }
     * @throws {TypeError} If characters is not an array
     */
    function exportCharactersCSV(characters, options) {
        options = options || {};

        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        // Generate CSV rows using the schema
        var rows = schema.toRows(characters);
        var csvContent = parser.arrayToCSV(rows);

        // Create blob with BOM for Excel compatibility
        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        // Generate filename
        var filename = options.filename ||
            'characters-' + new Date().toISOString().slice(0, 10) + '.csv';

        // Download
        fileUtils.downloadBlob(blob, filename);

        return {
            count: characters.length,
            filename: filename
        };
    }

    /**
     * Export characters from the current application data.
     * Uses CharacterQueries to get characters.
     * 
     * @param {Object} options - Export options
     * @returns {Object} { count: number, filename: string, message: string|null }
     */
    function exportCharactersFromData(options) {
        options = options || {};

        // Check for CharacterQueries
        if (typeof window.CharacterQueries === 'undefined' ||
            typeof window.CharacterQueries.getAllCharacters !== 'function') {
            throw new Error('CharacterQueries not available.');
        }

        var characters = window.CharacterQueries.getAllCharacters();

        if (characters.length === 0) {
            return {
                count: 0,
                filename: null,
                message: 'No characters to export.'
            };
        }

        var result = exportCharactersCSV(characters, options);

        // Add message for UI feedback
        result.message = 'Exported ' + result.count + ' characters';
        return result;
    }

    /**
     * Get CSV content as a string without downloading.
     * Useful for testing or preview.
     * 
     * @param {Array} characters - Array of character objects
     * @returns {string} CSV content
     */
    function getCharactersCSVContent(characters) {
        if (!Array.isArray(characters)) {
            throw new TypeError('Characters must be an array.');
        }

        var rows = schema.toRows(characters);
        return parser.arrayToCSV(rows);
    }

    // ============================================================
    // Expose
    // ============================================================

    window.exportCharactersCSV = exportCharactersCSV;
    window.exportCharactersFromData = exportCharactersFromData;
    window.getCharactersCSVContent = getCharactersCSVContent;

})();
