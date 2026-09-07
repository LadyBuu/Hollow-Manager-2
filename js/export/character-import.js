/**
 * js/export/character-import.js - Character CSV Import
 * PURE PARSER - returns candidates, does NOT mutate application state
 * 
 * This module parses CSV text into character candidates using the canonical
 * CharacterCSVSchema for column definitions and validation.
 * 
 * It does NOT:
 * - Access window.data directly
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Mutate application state
 * - Generate IDs (that's the caller's responsibility)
 * - Apply default values (that's the schema's responsibility)
 * 
 * Usage:
 *   var result = importCharactersCSV(csvText);
 *   if (result.hasErrors()) { /* handle errors * / }
 *   var candidates = result.getValid();
 *   // Pass candidates to CharacterCore.importCharacters()
 */

(function() {
    'use strict';

    // ============================================================
    // Dependencies
    // ============================================================

    var parser = window.CSV;
    var schema = window.CharacterCSVSchema;
    var Result = window.ImportResult;

    // Validate dependencies
    if (!parser || typeof parser.parse !== 'function') {
        throw new Error('CharacterCSVImport: CSV parser not available');
    }
    if (!schema || typeof schema.parseRow !== 'function') {
        throw new Error('CharacterCSVImport: CharacterCSVSchema not available');
    }
    if (!Result || typeof Result !== 'function') {
        throw new Error('CharacterCSVImport: ImportResult not available');
    }

    // ============================================================
    // Constants
    // ============================================================

    var MAX_ROWS = 10000; // Sanity limit to prevent memory issues

    // ============================================================
    // Import Functions
    // ============================================================

    /**
     * Parse CSV text and return character candidates.
     * 
     * @param {string} csvText - CSV file content
     * @param {Object} options - Import options
     * @param {boolean} options.strict - Strict mode: reject rows with errors (default: false)
     * @param {number} options.maxRows - Maximum rows to parse (default: 10000)
     * @returns {ImportResult} ImportResult with valid candidates, errors, warnings
     */
    function importCharactersCSV(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var maxRows = options.maxRows || MAX_ROWS;

        var result = new Result();

        // Parse CSV
        var records;
        try {
            records = parser.parse(csvText);
        } catch (e) {
            result.addError('Failed to parse CSV: ' + e.message);
            return result;
        }

        if (records.length === 0) {
            result.addWarning('CSV file is empty');
            return result;
        }

        // Extract character section
        var characterRows = extractCharacterRows(records);
        if (characterRows.length === 0) {
            result.addError('No character data found. Expected "' + schema.SECTION + '" section.');
            return result;
        }

        // Check row limit
        if (characterRows.length > maxRows) {
            result.addError('Too many rows (' + characterRows.length + '). Maximum is ' + maxRows + '.');
            return result;
        }

        // Parse each row
        characterRows.forEach(function(row, index) {
            var rowNumber = index + 1;

            // Skip empty rows
            if (isBlankRow(row)) {
                return;
            }

            // Parse the row using the schema
            var parsed = schema.parseRow(row, function(warning, fieldName) {
                var msg = warning;
                if (fieldName) {
                    msg = fieldName + ': ' + warning;
                }
                result.addWarning(msg, { row: rowNumber, field: fieldName });
            });

            if (parsed.valid) {
                // Validate the candidate
                if (schema.isValidCandidate(parsed.character)) {
                    result.addValid(parsed.character, { row: rowNumber });
                } else {
                    result.addError('Invalid character data', { row: rowNumber });
                }
            }

            // Add errors
            parsed.errors.forEach(function(err) {
                result.addError(err, { row: rowNumber });
            });

            // In strict mode, reject rows with errors
            if (strict && parsed.errors.length > 0) {
                // Remove any valid record that was added for this row
                // (we need to filter it out)
                var validRecords = result.getValid(true);
                var lastValid = validRecords[validRecords.length - 1];
                if (lastValid && lastValid.metadata && lastValid.metadata.row === rowNumber) {
                    // This is tricky - we'd need to remove it.
                    // Instead, we should only add valid records after we know there are no errors.
                    // Let's restructure: collect, then add.
                }
            }
        });

        // If in strict mode, filter out any records that had errors
        if (strict) {
            var filteredValid = [];
            var validItems = result.getValid(true);
            for (var i = 0; i < validItems.length; i++) {
                var item = validItems[i];
                var rowNum = item.metadata && item.metadata.row;
                if (rowNum) {
                    var rowErrors = result.getErrorsForRow(rowNum);
                    if (rowErrors.length === 0) {
                        filteredValid.push(item);
                    } else {
                        // Mark as skipped
                        result.addSkipped(item.record, 'Row had errors', { row: rowNum });
                    }
                } else {
                    filteredValid.push(item);
                }
            }

            // Clear and re-add valid records
            result._valid = filteredValid;
        }

        return result;
    }

    /**
     * Extract rows from the CHARACTERS section.
     * 
     * @param {Array} records - All CSV records
     * @returns {Array} Array of character data rows (excluding header)
     */
    function extractCharacterRows(records) {
        var rows = [];
        var inSection = false;
        var foundHeader = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];

            // Skip empty rows
            if (isBlankRow(row)) {
                continue;
            }

            var first = String(row[0] || '').trim();

            // Check for section start
            if (first === schema.SECTION) {
                inSection = true;
                continue;
            }

            // Check for section end (next section)
            if (inSection && first.startsWith('#')) {
                break;
            }

            // Skip header row
            if (inSection && first === 'CharacterId') {
                foundHeader = true;
                continue;
            }

            // Collect data rows
            if (inSection) {
                // Only include rows that have at least some data
                if (row.length > 0 && String(row[0] || '').trim()) {
                    rows.push(row);
                }
            }
        }

        // If we found a header but no data rows, that's fine - just return empty array
        return rows;
    }

    /**
     * Check if a row is completely blank.
     * 
     * @param {Array} row - CSV row
     * @returns {boolean} True if blank
     */
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

    /**
     * Parse a character CSV file from a File object.
     * Convenience wrapper for browser FileReader.
     * 
     * @param {File} file - CSV file
     * @param {Object} options - Import options
     * @returns {Promise<ImportResult>} Promise resolving to ImportResult
     */
    function importCharactersFromFile(file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                try {
                    var result = importCharactersCSV(e.target.result, options);
                    resolve(result);
                } catch (err) {
                    reject(new Error('Failed to import characters: ' + err.message));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + reader.error.message));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Validate character candidates against the schema.
     * Useful for pre-import validation.
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

        candidates.forEach(function(candidate, index) {
            if (schema.isValidCandidate(candidate)) {
                valid.push(candidate);
            } else {
                invalid.push({
                    index: index,
                    candidate: candidate,
                    reason: 'Missing required fields (firstName/lastName)'
                });
            }
        });

        return { valid: valid, invalid: invalid };
    }

    /**
     * Get a preview of the import result.
     * Shows first N valid records for user review.
     * 
     * @param {ImportResult} result - Import result
     * @param {number} limit - Number of records to preview (default: 5)
     * @returns {Object} { preview: Array, total: number }
     */
    function getImportPreview(result, limit) {
        limit = limit || 5;

        if (!(result instanceof Result)) {
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

    // ============================================================
    // Expose
    // ============================================================

    window.importCharactersCSV = importCharactersCSV;
    window.importCharactersFromFile = importCharactersFromFile;
    window.validateCharacterCandidates = validateCandidates;
    window.getCharacterImportPreview = getImportPreview;

})();
