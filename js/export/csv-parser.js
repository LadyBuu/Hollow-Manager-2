/**
 * js/export/csv-parser.js - CSV Parser
 * Pure CSV parsing utilities with no business logic
 * Path: js/export/csv-parser.js
 */

(function() {
    'use strict';

    /**
     * Parse CSV text into a 2D array
     * Handles quoted fields, escaped quotes, and UTF-8 BOM
     */
    function parseCSV(text) {
        // Remove UTF-8 BOM if present
        text = String(text || '').replace(/^\uFEFF/, '');

        var records = [];
        var current = [];
        var field = '';
        var inQuotes = false;
        var i = 0;

        while (i < text.length) {
            var ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < text.length && text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                    } else {
                        inQuotes = false;
                        i++;
                    }
                } else {
                    field += ch;
                    i++;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                } else if (ch === ',') {
                    current.push(field);
                    field = '';
                    i++;
                } else if (ch === '\n' || ch === '\r') {
                    if (field.length > 0 || current.length > 0) {
                        current.push(field);
                        records.push(current);
                        current = [];
                        field = '';
                    }
                    if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                        i++;
                    }
                    i++;
                } else {
                    field += ch;
                    i++;
                }
            }
        }

        if (inQuotes) {
            throw new Error('Invalid CSV: unclosed quoted field.');
        }

        if (field.length > 0 || current.length > 0) {
            current.push(field);
            records.push(current);
        }

        return records;
    }

    /**
     * Escape a field for CSV output
     */
    function escapeCSVField(value) {
        if (value === null || value === undefined) return '';
        var str = String(value);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    /**
     * Convert a 2D array to CSV text
     */
    function arrayToCSV(records) {
        return records.map(function(row) {
            return row.map(escapeCSVField).join(',');
        }).join('\r\n');
    }

    // Expose
    window.CSV = {
        parse: parseCSV,
        escape: escapeCSVField,
        arrayToCSV: arrayToCSV
    };

})();
