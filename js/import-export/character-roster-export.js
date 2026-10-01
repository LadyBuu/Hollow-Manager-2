/**
 * js/import-export/character-roster-export.js - Character Roster Export
 * Plain-text roster export: Name, Gender, Birth Year, Eliminated.
 *
 * Path: js/import-export/character-roster-export.js
 *
 * WHAT THIS MODULE DOES:
 *   - Builds a tab-separated plain-text roster of every character
 *     in window.data.characters.
 *   - Optionally downloads the text as a .txt file.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does not filter by any character-list filter. Every
 *     character is included, regardless of deceased, eliminated,
 *     or filler status.
 *   - It does not mutate window.data.
 *   - It does not touch the DOM except via ExportUtils.downloadBlob.
 *
 * OUTPUT FORMAT:
 *   Tab-separated, with a header line:
 *
 *     Name\tGender\tBirth Year\tEliminated
 *     Anne Smith\tFemale\t1895\t1915
 *     Bob Jones\tMale\t1900\t
 *
 *   Column semantics:
 *     Name        - CharacterQueries.getDisplayName(char)
 *     Gender      - char.gender, trimmed, or empty
 *     Birth Year  - char.birthYear, trimmed, or empty
 *     Eliminated  - the elimination year when available;
 *                   "Yes" when the character has an elimination
 *                   record but no parseable year; empty otherwise.
 *
 *   Line endings are \n. Some editors prefer \r\n for Windows;
 *   \n is the modern default and is accepted everywhere.
 *
 * ELIMINATION DETECTION:
 *   A character is treated as eliminated when either:
 *     - char.eliminations is a non-empty array
 *     - char.eliminatedWeeks is a non-empty array
 *
 *   The year is read from EliminationQueries.getEliminationYear
 *   when available, then from the first elimination record's year
 *   field, then falls back to "Yes".
 *
 * SORT ORDER:
 *   Alphabetical by display name, case-insensitive.
 *
 * EMPTY DATA:
 *   When there are zero characters, the output is the header line
 *   alone. The export still succeeds, producing a minimal file.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.ExportUtils   (for downloadBlob)
 *
 * DEPENDENCIES (LAZY, read at call time):
 *   - window.EliminationQueries
 */

(function() {
    'use strict';

    if (window.__characterRosterExportLoaded) {
        return;
    }
    window.__characterRosterExportLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[CharacterRosterExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function trimmed(value) {
        return safeString(value).trim();
    }

    /**
     * Does this character have any elimination on record?
     * Shape check on the character record itself.
     */
    function hasEliminationRecord(char) {
        if (!char || typeof char !== 'object') { return false; }
        if (Array.isArray(char.eliminations) &&
            char.eliminations.length > 0) {
            return true;
        }
        if (Array.isArray(char.eliminatedWeeks) &&
            char.eliminatedWeeks.length > 0) {
            return true;
        }
        return false;
    }

    /**
     * Resolve the "Eliminated" column value for a character.
     *
     *   1. EliminationQueries.getEliminationYear, when available.
     *   2. The year field of the first elimination record.
     *   3. "Yes" when the record exists but no year is parseable.
     *   4. '' when the character has no elimination record.
     */
    function resolveEliminationMarker(char) {
        if (!char || typeof char !== 'object') { return ''; }
        if (!hasEliminationRecord(char)) { return ''; }

        var EQ = getEliminationQueries();
        if (EQ && typeof EQ.getEliminationYear === 'function') {
            try {
                var y = EQ.getEliminationYear(char);
                if (y !== null && y !== undefined && y !== '') {
                    var yNum = parseInt(y, 10);
                    if (!isNaN(yNum) && yNum >= 1) {
                        return String(yNum);
                    }
                }
            } catch (e) {
                // Fall through.
            }
        }

        if (Array.isArray(char.eliminations) &&
            char.eliminations.length > 0) {
            var first = char.eliminations[0];
            if (first && typeof first === 'object') {
                var raw = first.year;
                if (raw !== undefined && raw !== null && raw !== '') {
                    var n = parseInt(raw, 10);
                    if (!isNaN(n) && n >= 1) {
                        return String(n);
                    }
                }
            }
        }

        return 'Yes';
    }

    /**
     * Strip tab characters out of a field so they cannot corrupt
     * the tab-separated layout.
     */
    function stripTabs(value) {
        return String(value).replace(/\t/g, ' ');
    }

    /**
     * Strip newline characters out of a field. A name with an
     * embedded newline would otherwise break the row.
     */
    function stripNewlines(value) {
        return String(value).replace(/[\r\n]+/g, ' ');
    }

    function cleanField(value) {
        return stripNewlines(stripTabs(safeString(value)));
    }

    // ============================================================
    // BUILD
    // ============================================================

    /**
     * Build the roster text.
     *
     * @returns {object} {
     *   valid: boolean,
     *   content: string,
     *   count: number,
     *   error: string|null
     * }
     */
    function buildText() {
        var characters = [];
        try {
            characters = CharacterQueries.getCharacters() || [];
        } catch (e) {
            return {
                valid: false,
                content: '',
                count: 0,
                error: 'Failed to read character store: ' + e.message
            };
        }

        // Sort alphabetically by display name.
        var sorted = characters.slice().sort(function(a, b) {
            var na = '';
            var nb = '';
            try { na = CharacterQueries.getDisplayName(a) || ''; }
            catch (e) { na = ''; }
            try { nb = CharacterQueries.getDisplayName(b) || ''; }
            catch (e) { nb = ''; }
            return na.localeCompare(nb);
        });

        var lines = [];

        // Header
        lines.push(
            ['Name', 'Gender', 'Birth Year', 'Eliminated']
                .join('\t')
        );

        for (var i = 0; i < sorted.length; i++) {
            var char = sorted[i];
            if (!char || typeof char !== 'object') { continue; }

            var name = '';
            try {
                name = CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                name = '';
            }

            lines.push([
                cleanField(name),
                cleanField(char.gender),
                cleanField(char.birthYear),
                cleanField(resolveEliminationMarker(char))
            ].join('\t'));
        }

        return {
            valid: true,
            content: lines.join('\n') + '\n',
            count: sorted.length,
            error: null
        };
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function buildFilename() {
        var now = new Date();
        var y = now.getFullYear();
        var m = now.getMonth() + 1;
        var d = now.getDate();
        function pad(n) { return n < 10 ? '0' + n : String(n); }
        return 'characters-roster-' +
            y + '-' + pad(m) + '-' + pad(d) + '.txt';
    }

    /**
     * Build and download the roster file.
     *
     * @returns {object} {
     *   exported: boolean,
     *   filename: string|null,
     *   count: number,
     *   error: string|null
     * }
     */
    function exportText() {
        var built = buildText();
        if (!built.valid) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: built.error || 'Failed to build roster.'
            };
        }

        var filename = buildFilename();

        try {
            var blob = new Blob([built.content], {
                type: 'text/plain;charset=utf-8'
            });
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: built.count,
                error: 'Download failed: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            count: built.count,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterRosterExport = Object.freeze({
        buildText: buildText,
        exportText: exportText
    });

})();
