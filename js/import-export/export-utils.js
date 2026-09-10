/**
 * js/export/export-utils.js - Shared Export Utilities
 * 
 * This module provides utility functions for CSV/JSON import/export operations.
 * It focuses on file handling, CSV row validation, and JSON parsing for imports.
 * 
 * It does NOT contain:
 * - ID generation or normalisation (use IdUtils)
 * - Object cloning (use ObjectUtils)
 * - Application data detection (use ApplicationDataSchema)
 * - Business logic or domain knowledge
 * 
 * All other export/import modules should depend on these primitives.
 */

(function() {
    'use strict';

    // ============================================================
    // Warning Management
    // ============================================================

    /**
     * Maximum number of warnings to store before truncating
     */
    var MAX_WARNINGS = 50;

    /**
     * Add a warning to a warnings array with a cap.
     * 
     * @param {Array} warnings - Array to add warning to
     * @param {string} message - Warning message
     */
    function addWarning(warnings, message) {
        if (!Array.isArray(warnings)) return;

        if (warnings.length < MAX_WARNINGS - 1) {
            warnings.push(message);
        } else if (warnings.length === MAX_WARNINGS - 1) {
            warnings.push('Additional warnings omitted.');
        }
    }

    // ============================================================
    // CSV Row Helpers
    // ============================================================

    /**
     * Check if a CSV row is completely blank.
     * 
     * @param {Array} row - CSV row as array of strings
     * @returns {boolean} True if all cells are empty
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
     * Require a field to be non-empty.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @returns {string} Trimmed field value
     * @throws {Error} If field is missing or empty
     */
    function requireField(row, index, fieldName) {
        var value = String(row[index] == null ? '' : row[index]).trim();
        if (!value) {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }
        return value;
    }

    /**
     * Require a field to be a valid integer.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {number} fallback - Default value if empty
     * @returns {number} Parsed integer
     * @throws {Error} If value is not a valid integer
     */
    function requireInteger(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        if (!/^-?\d+$/.test(value)) {
            throw new Error('Invalid integer "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        var parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
            throw new Error('Integer "' + value + '" is outside safe range for "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
    }

    /**
     * Require a field to be a valid number.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {number} fallback - Default value if empty
     * @returns {number} Parsed number
     * @throws {Error} If value is not a valid number
     */
    function requireNumber(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
            throw new Error('Invalid number "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        var parsed = Number(value);
        if (!isFinite(parsed)) {
            throw new Error('Number "' + value + '" is out of range for "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
    }

    /**
     * Require a field to be one of the allowed enum values.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Array} allowed - Array of allowed values
     * @param {string} defaultValue - Default value if empty
     * @returns {string} Valid enum value
     * @throws {Error} If value is not in the allowed list
     */
    function requireEnum(row, index, fieldName, allowed, defaultValue) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && defaultValue !== undefined) {
            return defaultValue;
        }

        if (value === '') {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }

        if (allowed.indexOf(value) === -1) {
            throw new Error('Invalid value "' + value + '" for "' + fieldName + '". Allowed: ' + allowed.join(', '));
        }

        return value;
    }

    // ============================================================
    // JSON Field Helpers
    // ============================================================

    /**
     * Parse a JSON array field from a CSV cell.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Array} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @returns {Array} Parsed JSON array or fallback
     */
    function parseJSONArray(row, index, fieldName, fallback, warnFn) {
        fallback = Array.isArray(fallback) ? fallback : [];

        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON array in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Parse a JSON object field from a CSV cell.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Object} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @returns {Object} Parsed JSON object or fallback
     */
    function parseJSONObject(row, index, fieldName, fallback, warnFn) {
        fallback = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};

        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);
            if (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object') {
                throw new Error('Expected JSON object, got ' + (Array.isArray(parsed) ? 'array' : typeof parsed));
            }
            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON object in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Parse any JSON value from a CSV cell with validation.
     * 
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {*} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @param {string} expectedType - Expected type ('array', 'object', 'string', etc.)
     * @returns {*} Parsed JSON value or fallback
     */
    function parseJSON(row, index, fieldName, fallback, warnFn, expectedType) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);

            if (expectedType === 'array' && !Array.isArray(parsed)) {
                throw new Error('Expected JSON array, got ' + typeof parsed);
            }
            if (expectedType === 'object' && (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object')) {
                throw new Error('Expected JSON object, got ' + (Array.isArray(parsed) ? 'array' : typeof parsed));
            }
            if (expectedType === 'string' && typeof parsed !== 'string') {
                throw new Error('Expected JSON string, got ' + typeof parsed);
            }
            if (expectedType === 'number' && typeof parsed !== 'number') {
                throw new Error('Expected JSON number, got ' + typeof parsed);
            }
            if (expectedType === 'boolean' && typeof parsed !== 'boolean') {
                throw new Error('Expected JSON boolean, got ' + typeof parsed);
            }

            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    // ============================================================
    // File Helpers
    // ============================================================

    /**
     * Download a blob as a file.
     * 
     * @param {Blob} blob - Blob to download
     * @param {string} filename - Name of the file to create
     */
    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Read a file as text.
     * 
     * @param {File} file - File to read
     * @returns {Promise<string>} Promise resolving to file contents
     */
    function readFileAsText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
            };
            reader.readAsText(file);
        });
    }

    /**
     * Read a file as JSON.
     * 
     * @param {File} file - File to read
     * @returns {Promise<Object>} Promise resolving to parsed JSON
     */
    function readFileAsJSON(file) {
        return readFileAsText(file).then(function(text) {
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error('Invalid JSON: ' + e.message);
            }
        });
    }

    // ============================================================
    // Validate UTF-8 BOM
    // ============================================================

    /**
     * Check if text starts with UTF-8 BOM and remove it.
     * 
     * @param {string} text - Text to check
     * @returns {string} Text without BOM
     */
    function stripBOM(text) {
        if (typeof text === 'string' && text.startsWith('\uFEFF')) {
            return text.substring(1);
        }
        return text;
    }

    /**
     * Check if text has a UTF-8 BOM.
     * 
     * @param {string} text - Text to check
     * @returns {boolean} True if BOM is present
     */
    function hasBOM(text) {
        return typeof text === 'string' && text.startsWith('\uFEFF');
    }

    // ============================================================
    // Expose
    // ============================================================

    window.ExportUtils = {
        // Constants
        MAX_WARNINGS: MAX_WARNINGS,

        // Warning management
        addWarning: addWarning,

        // CSV row helpers
        isBlankRow: isBlankRow,
        requireField: requireField,
        requireInteger: requireInteger,
        requireNumber: requireNumber,
        requireEnum: requireEnum,

        // JSON field helpers
        parseJSONArray: parseJSONArray,
        parseJSONObject: parseJSONObject,
        parseJSON: parseJSON,

        // File helpers
        downloadBlob: downloadBlob,
        readFileAsText: readFileAsText,
        readFileAsJSON: readFileAsJSON,

        // BOM helpers
        stripBOM: stripBOM,
        hasBOM: hasBOM
    };

    // Also expose as FileUtils for clarity
    window.FileUtils = {
        downloadBlob: downloadBlob,
        readFileAsText: readFileAsText,
        readFileAsJSON: readFileAsJSON,
        stripBOM: stripBOM,
        hasBOM: hasBOM
    };

})();
