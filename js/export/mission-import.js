/**
 * js/export/mission-import.js - Mission CSV Import
 * PURE PARSER - returns candidates, does NOT mutate application state
 * 
 * This module parses CSV text into mission candidates using the canonical
 * MissionCSVSchema for column definitions and validation.
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
 *   var result = importMissionsCSV(csvText);
 *   if (result.hasErrors()) { /* handle errors * / }
 *   var candidates = result.getValid();
 *   // Pass candidates to MissionCore.importMissions()
 */

(function() {
    'use strict';

    // ============================================================
    // Dependencies
    // ============================================================

    var parser = window.CSV;
    var schema = window.MissionCSVSchema;
    var Result = window.ImportResult;

    // Validate dependencies
    if (!parser || typeof parser.parse !== 'function') {
        throw new Error('MissionCSVImport: CSV parser not available');
    }
    if (!schema || typeof schema.parseRow !== 'function') {
        throw new Error('MissionCSVImport: MissionCSVSchema not available');
    }
    if (!Result || typeof Result !== 'function') {
        throw new Error('MissionCSVImport: ImportResult not available');
    }

    // ============================================================
    // Constants
    // ============================================================

    var MAX_ROWS = 10000; // Sanity limit to prevent memory issues

    // ============================================================
    // Import Functions
    // ============================================================

    /**
     * Parse CSV text and return mission candidates.
     * 
     * @param {string} csvText - CSV file content
     * @param {Object} options - Import options
     * @param {boolean} options.strict - Strict mode: reject rows with errors (default: false)
     * @param {number} options.maxRows - Maximum rows to parse (default: 10000)
     * @param {boolean} options.validateEnums - Validate status/priority/difficulty (default: true)
     * @returns {ImportResult} ImportResult with valid candidates, errors, warnings
     */
    function importMissionsCSV(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var validateEnums = options.validateEnums !== false;
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

        // Extract mission section
        var missionRows = extractMissionRows(records);
        if (missionRows.length === 0) {
            result.addError('No mission data found. Expected "' + schema.SECTION + '" section.');
            return result;
        }

        // Check row limit
        if (missionRows.length > maxRows) {
            result.addError('Too many rows (' + missionRows.length + '). Maximum is ' + maxRows + '.');
            return result;
        }

        // Parse each row
        missionRows.forEach(function(row, index) {
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
                // Additional enum validation if requested
                if (validateEnums) {
                    var mission = parsed.mission;
                    var hasEnumError = false;

                    // Validate status
                    if (mission.status && !schema.isValidStatus(mission.status)) {
                        result.addError(
                            'Invalid status "' + mission.status + '". Allowed: ' + 
                            schema.getValidStatuses().filter(function(s) { return s !== ''; }).join(', '),
                            { row: rowNumber, field: 'Status' }
                        );
                        hasEnumError = true;
                    }

                    // Validate priority
                    if (mission.priority && !schema.isValidPriority(mission.priority)) {
                        result.addError(
                            'Invalid priority "' + mission.priority + '". Allowed: ' + 
                            schema.getValidPriorities().filter(function(p) { return p !== ''; }).join(', '),
                            { row: rowNumber, field: 'Priority' }
                        );
                        hasEnumError = true;
                    }

                    // Validate difficulty
                    if (mission.difficulty && !schema.isValidDifficulty(mission.difficulty)) {
                        result.addError(
                            'Invalid difficulty "' + mission.difficulty + '". Allowed: ' + 
                            schema.getValidDifficulties().filter(function(d) { return d !== ''; }).join(', '),
                            { row: rowNumber, field: 'Difficulty' }
                        );
                        hasEnumError = true;
                    }

                    // If enum validation failed and strict mode, skip this row
                    if (strict && hasEnumError) {
                        result.addSkipped(mission, 'Enum validation failed', { row: rowNumber });
                        return;
                    }
                }

                // Validate the candidate
                if (schema.isValidCandidate(parsed.mission)) {
                    result.addValid(parsed.mission, { row: rowNumber });
                } else {
                    result.addError('Invalid mission data (missing title)', { row: rowNumber });
                }
            }

            // Add errors
            parsed.errors.forEach(function(err) {
                result.addError(err, { row: rowNumber });
            });
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
     * Extract rows from the MISSIONS section.
     * 
     * @param {Array} records - All CSV records
     * @returns {Array} Array of mission data rows (excluding header)
     */
    function extractMissionRows(records) {
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
            if (inSection && first === 'MissionId') {
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
     * Parse a mission CSV file from a File object.
     * Convenience wrapper for browser FileReader.
     * 
     * @param {File} file - CSV file
     * @param {Object} options - Import options
     * @returns {Promise<ImportResult>} Promise resolving to ImportResult
     */
    function importMissionsFromFile(file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                try {
                    var result = importMissionsCSV(e.target.result, options);
                    resolve(result);
                } catch (err) {
                    reject(new Error('Failed to import missions: ' + err.message));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + reader.error.message));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Validate mission candidates against the schema.
     * Useful for pre-import validation.
     * 
     * @param {Array} candidates - Mission candidates
     * @param {Object} options - Validation options
     * @param {boolean} options.validateEnums - Validate enum values (default: true)
     * @returns {Object} { valid: Array, invalid: Array, warnings: Array }
     */
    function validateCandidates(candidates, options) {
        options = options || {};
        var validateEnums = options.validateEnums !== false;

        if (!Array.isArray(candidates)) {
            throw new TypeError('Candidates must be an array.');
        }

        var valid = [];
        var invalid = [];
        var warnings = [];

        candidates.forEach(function(candidate, index) {
            var errors = [];

            // Check required fields
            if (!schema.isValidCandidate(candidate)) {
                invalid.push({
                    index: index,
                    candidate: candidate,
                    reason: 'Missing required field: title'
                });
                return;
            }

            // Validate enums if requested
            if (validateEnums) {
                if (candidate.status && !schema.isValidStatus(candidate.status)) {
                    warnings.push({
                        index: index,
                        candidate: candidate,
                        field: 'status',
                        value: candidate.status,
                        message: 'Invalid status "' + candidate.status + '"'
                    });
                }

                if (candidate.priority && !schema.isValidPriority(candidate.priority)) {
                    warnings.push({
                        index: index,
                        candidate: candidate,
                        field: 'priority',
                        value: candidate.priority,
                        message: 'Invalid priority "' + candidate.priority + '"'
                    });
                }

                if (candidate.difficulty && !schema.isValidDifficulty(candidate.difficulty)) {
                    warnings.push({
                        index: index,
                        candidate: candidate,
                        field: 'difficulty',
                        value: candidate.difficulty,
                        message: 'Invalid difficulty "' + candidate.difficulty + '"'
                    });
                }

                // Validate progress range
                if (typeof candidate.progress === 'number') {
                    if (candidate.progress < 0 || candidate.progress > 100) {
                        warnings.push({
                            index: index,
                            candidate: candidate,
                            field: 'progress',
                            value: candidate.progress,
                            message: 'Progress must be between 0 and 100'
                        });
                    }
                }

                // Validate objectives structure
                if (Array.isArray(candidate.objectives)) {
                    candidate.objectives.forEach(function(obj, objIndex) {
                        if (!obj || typeof obj !== 'object') {
                            warnings.push({
                                index: index,
                                candidate: candidate,
                                field: 'objectives',
                                value: obj,
                                message: 'Objective at index ' + objIndex + ' is not an object'
                            });
                        } else if (!obj.text || typeof obj.text !== 'string') {
                            warnings.push({
                                index: index,
                                candidate: candidate,
                                field: 'objectives',
                                value: obj,
                                message: 'Objective at index ' + objIndex + ' has no text'
                            });
                        }
                    });
                }
            }

            valid.push(candidate);
        });

        return { valid: valid, invalid: invalid, warnings: warnings };
    }

    /**
     * Get a preview of the import result.
     * Shows first N valid records for user review.
     * 
     * @param {ImportResult} result - Import result
     * @param {number} limit - Number of records to preview (default: 5)
     * @returns {Object} { preview: Array, total: number, hasMore: boolean }
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

    /**
     * Get a summary of the import result formatted for UI display.
     * 
     * @param {ImportResult} result - Import result
     * @returns {Object} Formatted summary with display-friendly messages
     */
    function getImportSummary(result) {
        if (!(result instanceof Result)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var summary = result.getSummary();

        var messages = [];
        if (summary.valid > 0) {
            messages.push(summary.valid + ' mission(s) ready to import');
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
            message: messages.join(', ') || 'No missions found'
        };
    }

    // ============================================================
    // Expose
    // ============================================================

    window.importMissionsCSV = importMissionsCSV;
    window.importMissionsFromFile = importMissionsFromFile;
    window.validateMissionCandidates = validateCandidates;
    window.getMissionImportPreview = getImportPreview;
    window.getMissionImportSummary = getImportSummary;

})();
