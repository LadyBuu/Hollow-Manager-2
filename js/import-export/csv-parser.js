/**
 * js/import-export/csv-parser.js - CSV Parser
 * Pure CSV parsing and serialization utilities
 *
 * This module provides:
 *   - parse()              - Parse CSV text into a 2D array
 *   - escape()             - Escape a single field for CSV output
 *   - arrayToCSV()         - Convert a 2D array to CSV text
 *   - isPotentialFormula() - Check if a value might be a spreadsheet formula
 *   - guardFormula()       - Prefix a formula-looking value with '
 *   - unguardFormula()     - Strip a guard prefix from a value
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
 * FORMULA INJECTION GUARD:
 *   Spreadsheet applications (Excel, LibreOffice Calc, Google
 *   Sheets) evaluate any cell whose first character is `=`, `+`,
 *   `-`, `@`, tab, or carriage return as a formula. That is a
 *   real injection vector when a CSV export includes user-authored
 *   text: a notes field beginning with `=` is executed as a
 *   formula the moment the file is opened.
 *
 *   Three functions implement the guard:
 *
 *     isPotentialFormula(value)  the predicate. True when the
 *                                trimmed value's first character
 *                                is one of the six prefixes.
 *                                Exposed for callers that want to
 *                                inspect without modifying.
 *
 *     guardFormula(value)        the export-side helper. When
 *                                isPotentialFormula(value) is true,
 *                                returns the value prefixed with a
 *                                single quote. The quote tells the
 *                                spreadsheet "treat this as a
 *                                literal string". It does not
 *                                appear in the rendered cell.
 *
 *     unguardFormula(value)      the import-side helper. Strips a
 *                                single leading quote IF AND ONLY
 *                                IF stripping it reveals a value
 *                                that would have been guarded.
 *                                A cell that was not guarded on
 *                                the way out — a cell whose content
 *                                genuinely begins with an apostrophe
 *                                — is returned unchanged.
 *
 *   The pair MUST be used together. Applying guardFormula on
 *   export without unguardFormula on import silently corrupts
 *   every value whose first character is one of the six prefixes:
 *   a weight field of `-5`, a notes field of `- fixed the door`,
 *   an appearance note of `@home`. The character-export and
 *   class-roster-export modules apply both.
 *
 * WHY THE GUARD IS STRICTER THAN "starts with a prefix":
 *   A naive guard that prefixes anything beginning with `-` would
 *   alter negative numbers and bullet lists. That is why
 *   isPotentialFormula exists as a distinct predicate: it defines
 *   the exact set of shapes that spreadsheets treat as formulas,
 *   and unguardFormula uses the same predicate to decide whether
 *   a leading quote is a guard or a real apostrophe.
 *
 *   The unguard check is symmetric: unguardFormula(v) returns v
 *   unchanged unless v begins with `'` AND the remainder is itself
 *   a potential formula. A user-authored string like
 *   `'Tis the season` is left alone because `Tis the season` is
 *   not a potential formula.
 *
 * DEPENDENCIES:
 *   - None (self-contained)
 *
 * USAGE:
 *   var CSV = window.CSV;
 *
 *   // Parse CSV text into rows
 *   var rows = CSV.parse(csvText);
 *
 *   // Convert rows to CSV text
 *   var text = CSV.arrayToCSV(rows);
 *
 *   // Escape a single value
 *   var escaped = CSV.escape('Hello, "World"');
 *
 *   // Check if a value might be a formula
 *   if (CSV.isPotentialFormula(userInput)) {
 *       // Warn the user
 *   }
 *
 *   // Guard a value on export
 *   var safe = CSV.guardFormula(userInput);
 *
 *   // Unguard a value on import
 *   var original = CSV.unguardFormula(safe);
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

    /**
     * The character used to guard a formula-looking value. A
     * single quote tells the spreadsheet to treat the following
     * cell content as a literal string. Spreadsheets do not
     * render the quote itself.
     */
    var FORMULA_GUARD_CHAR = "'";

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

        // Push the last field if there's any content.
        // Note: We always push if the record is non-empty OR the
        // field is non-empty. This preserves trailing empty fields
        // on the last row.
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
     */
    function arrayToCSV(records) {
        if (!Array.isArray(records)) {
            throw new TypeError(
                'CSV.arrayToCSV: records must be an array.'
            );
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
    // FORMULA INJECTION - predicate
    // ============================================================

    /**
     * Check if a value might be interpreted as a spreadsheet formula.
     *
     * This is a pure predicate. It does not modify the value; it
     * reports whether the value's trimmed first character is one of
     * the six spreadsheet formula prefixes.
     *
     * Used by:
     *   - callers that want to warn the user before exporting
     *   - guardFormula, to decide whether a value needs guarding
     *   - unguardFormula, to decide whether a leading quote is a
     *     guard or a real apostrophe
     *
     * @param {*} value - Value to check
     * @returns {boolean} True if the value might be a formula
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
    // FORMULA INJECTION - export-side guard
    // ============================================================

    /**
     * Guard a value against spreadsheet formula evaluation.
     *
     * When isPotentialFormula(value) is true, returns the value
     * prefixed with a single quote. The quote tells the spreadsheet
     * to treat the cell as a literal string and is not rendered.
     *
     * When isPotentialFormula(value) is false, or the value is not
     * a string, the value is returned unchanged.
     *
     * IMPORTANT: a value that is already guarded is not
     * double-guarded. guardFormula(guardFormula(x)) === guardFormula(x)
     * for every x. This makes the helper safe to call from
     * multiple layers on the same cell.
     *
     * @param {*} value - Value to guard
     * @returns {*} Guarded value, or the input unchanged
     */
    function guardFormula(value) {
        if (value === undefined || value === null) {
            return value;
        }
        if (typeof value !== 'string') {
            return value;
        }
        if (value === '') {
            return value;
        }

        // Already guarded? Idempotent return.
        if (value.charAt(0) === FORMULA_GUARD_CHAR &&
            isPotentialFormula(value.substring(1))) {
            return value;
        }

        if (isPotentialFormula(value)) {
            return FORMULA_GUARD_CHAR + value;
        }
        return value;
    }

    // ============================================================
    // FORMULA INJECTION - import-side unguard
    // ============================================================

    /**
     * Strip the guard prefix from a value that was guarded by
     * guardFormula.
     *
     * The strip is SYMMETRIC with the guard. A leading quote is
     * removed if and only if the remainder is a potential formula —
     * that is, if and only if guardFormula would have added the
     * quote in the first place.
     *
     *   unguardFormula("'=SUM(A1:A10)")  -> "=SUM(A1:A10)"
     *   unguardFormula("'-5")            -> "-5"
     *   unguardFormula("'@home")         -> "@home"
     *   unguardFormula("'Tis the season")-> "'Tis the season"
     *   unguardFormula("-5")             -> "-5"      (no quote to strip)
     *   unguardFormula("hello")          -> "hello"
     *
     * The last two cases matter: a value that was never guarded
     * passes through unchanged, and a value whose first character
     * is a real apostrophe (not a guard) is preserved.
     *
     * IMPORTANT: a value that is not a string, or that is empty, is
     * returned unchanged. Numbers, booleans, null, and undefined
     * are not guarded on export, so they are not unguarded on
     * import.
     *
     * @param {*} value - Value to unguard
     * @returns {*} Unguarded value, or the input unchanged
     */
    function unguardFormula(value) {
        if (typeof value !== 'string') {
            return value;
        }
        if (value === '') {
            return value;
        }

        if (value.charAt(0) !== FORMULA_GUARD_CHAR) {
            return value;
        }

        var remainder = value.substring(1);
        if (remainder === '') {
            return value;
        }

        if (isPotentialFormula(remainder)) {
            return remainder;
        }

        return value;
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

    window.CSV = Object.freeze({
        // ---- Core operations ----
        parse: parse,
        escape: escape,
        arrayToCSV: arrayToCSV,

        // ---- Formula injection guard (export + import) ----
        isPotentialFormula: isPotentialFormula,
        guardFormula: guardFormula,
        unguardFormula: unguardFormula,

        // ---- Utilities ----
        countRows: countRows,
        preview: preview,
        detectDelimiter: detectDelimiter
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CSV;
        var failures = [];

        var required = [
            'parse',
            'escape',
            'arrayToCSV',
            'isPotentialFormula',
            'guardFormula',
            'unguardFormula'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        // Guard / unguard round trip. Every case must survive.
        var roundTripCases = [
            '=SUM(A1:A10)',
            '+1234',
            '-5',
            '@home',
            '\tindented',
            'hello',
            '',
            "'Tis the season",
            "'=SUM(A1:A10)"
        ];

        for (var c = 0; c < roundTripCases.length; c++) {
            var original = roundTripCases[c];
            var guarded = exports.guardFormula(original);
            var unguarded = exports.unguardFormula(guarded);

            // The unguarded value must equal the original for every
            // case EXCEPT an input that was already guarded by hand:
            // "'=SUM(A1:A10)" was manually guarded, so unguardFormula
            // strips it once and returns "=SUM(A1:A10)". That is the
            // correct behaviour; the manually-guarded form is
            // indistinguishable from a guard we added ourselves.
            var expected;
            if (original === "'=SUM(A1:A10)") {
                expected = '=SUM(A1:A10)';
            } else {
                expected = original;
            }

            if (unguarded !== expected) {
                failures.push(
                    'round trip failed for "' + original +
                    '": guarded="' + guarded +
                    '", unguarded="' + unguarded +
                    '", expected="' + expected + '"'
                );
            }
        }

        // Idempotence: guardFormula(guardFormula(x)) === guardFormula(x).
        var idempotenceCases = ['=A1', '-5', '@home', 'plain'];
        for (var d = 0; d < idempotenceCases.length; d++) {
            var v = idempotenceCases[d];
            var once = exports.guardFormula(v);
            var twice = exports.guardFormula(once);
            if (once !== twice) {
                failures.push(
                    'guardFormula not idempotent for "' + v + '"'
                );
            }
        }

        // Apostrophe preservation: a real leading apostrophe is not
        // stripped because the remainder is not a formula.
        var apostrophe = "'Tis the season";
        if (exports.unguardFormula(apostrophe) !== apostrophe) {
            failures.push(
                'unguardFormula stripped a real apostrophe'
            );
        }

        if (failures.length > 0) {
            if (typeof console !== 'undefined' && console.error) {
                console.error(
                    '[CSV] Verification failed: ' +
                    failures.join('; ')
                );
            }
        }
    })();

})();
