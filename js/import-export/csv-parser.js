/**
 * js/import-export/csv-parser.js - CSV Parser
 * Pure CSV parsing and serialization utilities
 * 
 * This module provides:
 *   - parse() - Parse CSV text into a 2D array
 *   - escape() - Escape a single field for CSV output
 *   - arrayToCSV() - Convert a 2D array to CSV text
 *   - isPotentialFormula() - Check if a value might be a spreadsheet formula
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects, no mutations
 *   - No domain knowledge
 *   - No dependencies
 *   - Handles: quoted fields, escaped quotes, UTF-8 BOM, CRLF/LF line endings
 *   - Consistent RFC 4180-compatible behaviour
 * 
 * CSV SPECIFICATION (RFC 4180):
 *   - Records are separated by line breaks (CRLF or LF)
 *   - Fields within a record are separated by commas
 *   - Fields may be quoted with double quotes
 *   - Quoted fields may contain commas, newlines, and escaped quotes ("")
 *   - Fields may span multiple lines when quoted
 * 
 * SEMANTICS:
 *   - parse() strips UTF-8 BOM if present
 *   - parse() treats both \r\n and \n as line breaks
 *   - parse() throws on unclosed quoted fields (invalid CSV)
 *   - parse() preserves empty trailing fields
 *   - escape() only quotes when necessary (comma, quote, newline, CR)
 *   - arrayToCSV() uses \r\n as line separator (RFC 4180 compliant)
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var CSV = window.CSV;
 *   
 *   // Parse CSV text into rows
 *   var rows = CSV.parse(csvText);
 *   // rows[0] = ['Name', 'Age', 'City']
 *   // rows[1] = ['Alice', '30', 'New York']
 *   
 *   // Convert rows to CSV text
 *   var text = CSV.arrayToCSV(rows);
 *   
 *   // Escape a single value
 *   var escaped = CSV.escape('Hello, "World"');
 *   // escaped = '"Hello, ""World"""'
 *   
 *   // Check if a value might be a formula
 *   if (CSV.isPotentialFormula(userInput)) {
 *       // Warn the user
 *   }
 */

(function() {
    'use strict';

    if (window.__csvParserLoaded) {
        return;
    }
    window.__csvParserLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    /**
     * Characters that trigger quoting when present in a field.
     * Per RFC 4180: comma, double quote, CR, LF.
     * 
     * We also quote when the field starts with a leading/trailing
     * whitespace that would be significant (optional, but helps
     * preserve data integrity across spreadsheet applications).
     */
    var QUOTE_TRIGGERS = /[",\r\n]/;

    /**
     * Characters that indicate a potential spreadsheet formula.
     * Used for warnings (not blocking) to prevent CSV injection.
     * 
     * Common spreadsheet formula prefixes:
     *   =  (equals)
     *   +  (plus)
     *   -  (minus)
     *   @  (at sign)
     *   \t (tab)
     *   \r (carriage return)
     */
    var FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

    // ============================================================
    // PARSING
    // ============================================================

    /**
     * Parse CSV text into a 2D array of strings.
     * 
     * Handles:
     *   - UTF-8 BOM (stripped if present)
     *   - Quoted fields with embedded commas and newlines
     *   - Escaped quotes ("" → ")
     *   - Both \r\n and \n line endings
     *   - Empty fields and trailing fields
     * 
     * Throws if a quoted field is not closed.
     * 
     * @param {string} text - CSV text to parse
     * @returns {Array<Array<string>>} Array of rows (each row is an array of strings)
     * @throws {Error} If CSV is malformed (unclosed quote)
     * 
     * USAGE:
     *   var rows = CSV.parse(csvText);
     *   for (var i = 0; i < rows.length; i++) {
     *       console.log('Row ' + i + ':', rows[i]);
     *   }
     */
    function parse(text) {
        // Normalize input
        if (text === null || text === undefined) {
            return [];
        }

        var str = String(text);

        // Strip UTF-8 BOM if present (common in Excel exports)
        if (str.length > 0 && str.charCodeAt(0) === 0xFEFF) {
            str = str.substring(1);
        }

        // Empty input → empty result
        if (str.length === 0) {
            return [];
        }

        var records = [];
        var currentRecord = [];
        var currentField = '';
        var inQuotes = false;
        var i = 0;
        var len = str.length;

        while (i < len) {
            var ch = str[i];

            if (inQuotes) {
                // ---- Inside a quoted field ----
                if (ch === '"') {
                    if (i + 1 < len && str[i + 1] === '"') {
                        // Escaped quote ("" → ")
                        currentField += '"';
                        i += 2;
                    } else {
                        // End of quoted field
                        inQuotes = false;
                        i++;
                    }
                } else {
                    // Any other character (including newlines) is literal
                    currentField += ch;
                    i++;
                }
            } else {
                // ---- Not inside a quoted field ----
                if (ch === '"') {
                    // Start of quoted field
                    inQuotes = true;
                    i++;
                } else if (ch === ',') {
                    // End of field
                    currentRecord.push(currentField);
                    currentField = '';
                    i++;
                } else if (ch === '\r') {
                    // Possible CRLF or bare CR
                    currentRecord.push(currentField);
                    currentField = '';
                    records.push(currentRecord);
                    currentRecord = [];

                    if (i + 1 < len && str[i + 1] === '\n') {
                        // CRLF - skip both
                        i += 2;
                    } else {
                        // Bare CR
                        i++;
                    }
                } else if (ch === '\n') {
                    // LF line ending
                    currentRecord.push(currentField);
                    currentField = '';
                    records.push(currentRecord);
                    currentRecord = [];
                    i++;
                } else {
                    // Regular character
                    currentField += ch;
                    i++;
                }
            }
        }

        // ---- Handle final field/record ----
        if (inQuotes) {
            throw new Error('Invalid CSV: unclosed quoted field.');
        }

        // Push the last field if there's any content
        // Note: We always push if the record is non-empty OR the field is non-empty
        // This preserves trailing empty fields on the last row
        if (currentField.length > 0 || currentRecord.length > 0) {
            currentRecord.push(currentField);
            records.push(currentRecord);
        }

        return records;
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    /**
     * Escape a single field for CSV output.
     * 
     * - null/undefined → empty string
     * - Fields containing comma, quote, CR, or LF → quoted
     * - Quotes within quoted fields → doubled ("")
     * - Other fields → returned as-is
     * 
     * @param {*} value - Value to escape
     * @returns {string} Escaped CSV field
     * 
     * USAGE:
     *   CSV.escape('Hello');              // 'Hello'
     *   CSV.escape('Hello, World');       // '"Hello, World"'
     *   CSV.escape('He said "Hi"');       // '"He said ""Hi"""'
     *   CSV.escape('Line1\nLine2');       // '"Line1\nLine2"'
     *   CSV.escape(null);                 // ''
     */
    function escape(value) {
        if (value === null || value === undefined) {
            return '';
        }

        var str = String(value);

        // Fast path: empty string
        if (str.length === 0) {
            return '';
        }

        // Quote if the field contains any quote trigger
        if (QUOTE_TRIGGERS.test(str)) {
            // Escape embedded quotes by doubling them
            return '"' + str.replace(/"/g, '""') + '"';
        }

        return str;
    }

    // ============================================================
    // SERIALIZATION
    // ============================================================

    /**
     * Convert a 2D array of values to CSV text.
     * 
     * - Each row is joined with commas
     * - Rows are separated by \r\n (RFC 4180 compliant)
     * - All values are escaped via escape()
     * 
     * @param {Array<Array<*>>} records - Array of rows
     * @returns {string} CSV text
     * @throws {TypeError} If records is not an array
     * 
     * USAGE:
     *   var rows = [
     *       ['Name', 'Age'],
     *       ['Alice', '30'],
     *       ['Bob', '25']
     *   ];
     *   var text = CSV.arrayToCSV(rows);
     *   // 'Name,Age\r\nAlice,30\r\nBob,25'
     */
    function arrayToCSV(records) {
        if (!Array.isArray(records)) {
            throw new TypeError('CSV.arrayToCSV: records must be an array.');
        }

        var lines = [];

        for (var i = 0; i < records.length; i++) {
            var row = records[i];

            // Skip null/undefined rows
            if (row === null || row === undefined) {
                continue;
            }

            // Coerce to array
            if (!Array.isArray(row)) {
                row = [row];
            }

            var escapedFields = [];
            for (var j = 0; j < row.length; j++) {
                escapedFields.push(escape(row[j]));
            }

            lines.push(escapedFields.join(','));
        }

        return lines.join('\r\n');
    }

    // ============================================================
    // SAFETY CHECKS
    // ============================================================

    /**
     * Check if a value might be interpreted as a spreadsheet formula.
     * 
     * This is a WARNING check, not a blocking check.
     * Spreadsheet applications may evaluate cells starting with
     * =, +, -, @, tab, or carriage return as formulas.
     * 
     * This function is used to warn users that exported data
     * might trigger formula evaluation when opened in Excel, etc.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if the value might be a formula
     * 
     * USAGE:
     *   if (CSV.isPotentialFormula('=SUM(A1:A10)')) {
     *       // Warn user
     *   }
     */
    function isPotentialFormula(value) {
        if (value === null || value === undefined) {
            return false;
        }

        if (typeof value !== 'string') {
            return false;
        }

        var trimmed = value.trim();

        if (trimmed.length === 0) {
            return false;
        }

        var firstChar = trimmed.charAt(0);

        return FORMULA_PREFIXES.indexOf(firstChar) !== -1;
    }

    // ============================================================
    // UTILITY HELPERS
    // ============================================================

    /**
     * Count the number of rows in CSV text (without full parsing).
     * 
     * NOTE: This is a lightweight estimate. For accurate row counting
     * that accounts for embedded newlines in quoted fields, use parse().
     * 
     * @param {string} text - CSV text
     * @returns {number} Estimated number of rows
     */
    function countRows(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }

        var trimmed = text.replace(/^\uFEFF/, '');
        if (trimmed.length === 0) {
            return 0;
        }

        // Count line breaks (approximation - doesn't account for quoted newlines)
        var matches = trimmed.match(/\r\n|\r|\n/g);
        var count = matches ? matches.length : 0;

        // If the text doesn't end with a line break, add 1 for the last row
        if (!/[\r\n]$/.test(trimmed)) {
            count++;
        }

        return count;
    }

    /**
     * Get a preview of the first N rows of CSV text.
     * Useful for showing a preview before full import.
     * 
     * @param {string} text - CSV text
     * @param {number} limit - Maximum number of rows to return (default: 5)
     * @returns {Array<Array<string>>} Preview rows
     */
    function preview(text, limit) {
        limit = limit || 5;

        var rows;
        try {
            rows = parse(text);
        } catch (e) {
            return [];
        }

        return rows.slice(0, limit);
    }

    /**
     * Detect the delimiter used in CSV text.
     * 
     * Currently only supports comma detection. In the future,
     * this could be extended to support semicolons (European),
     * tabs (TSV), and pipes.
     * 
     * @param {string} text - CSV text
     * @returns {string} Detected delimiter (currently always ',')
     */
    function detectDelimiter(text) {
        // For now, always return comma
        // Future: examine first line for common delimiters
        return ',';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CSV = {
        // ---- Core operations ----
        parse: parse,
        escape: escape,
        arrayToCSV: arrayToCSV,

        // ---- Safety ----
        isPotentialFormula: isPotentialFormula,

        // ---- Utilities ----
        countRows: countRows,
        preview: preview,
        detectDelimiter: detectDelimiter
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CSV;
        var missing = [];

        var required = ['parse', 'escape', 'arrayToCSV'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CSV] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CSV] All exports verified successfully.');
        }
    })();

})();
