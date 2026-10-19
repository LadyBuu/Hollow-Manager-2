/**
 * js/import-export/character-export.js - Character Export Bundle
 *
 * CANONICAL SOURCE for every character-related export, import, and
 * template operation. One file, three namespaces, three concerns:
 *
 *   window.CharacterCSV           full character CSV
 *                                   - schema (columns, field map)
 *                                   - export   (CharacterCSV.export)
 *                                   - import   (CharacterCSV.import)
 *                                   - template (CharacterCSV.exportTemplate)
 *                                   - all legacy template aliases
 *
 *   window.CharacterRosterExport  tab-separated roster text
 *                                   - buildText()
 *                                   - exportText()
 *                                   - buildSelectedText()
 *                                   - exportSelectedText()
 *
 *   window.CharacterExport        character report text
 *                                   - getCharacterReportText(charId)
 *                                   - exportCharacterText(charId)
 *                                   - exportSelectedText(charIds)
 *
 *                                 general report text
 *                                   - getGeneralReportText(charId)
 *                                   - exportGeneralText(charId)
 *
 * WHY THREE NAMESPACES IN ONE FILE:
 *   They share the CSV parser, the character queries, and the
 *   export utilities, they share the same "character in, file out"
 *   concern, and they share a template/column vocabulary that would
 *   fragment if split across files.
 *
 * SECTIONS IN THIS FILE, IN ORDER:
 *   1. Shared dependencies and helpers
 *   2. CharacterCSV           — schema, export, import, template
 *   3. CharacterRosterExport  — tab-separated roster text
 *   4. CharacterExport        — full-detail character report
 *                             + general report
 *
 * STRICT MODE:
 *   CharacterCSV.importCharacters does not pre-filter its result in
 *   strict mode. Strict mode is a policy decision that belongs to
 *   the CONSUMER of the ImportResult. The result already carries
 *   every valid record, every error (with row metadata), and every
 *   warning; a strict caller filters getValid(true) against
 *   getErrorsForRow() itself.
 *
 *   The import loop applies the strict rule for row-level enum and
 *   range failures, which the module owns. Anything beyond that is
 *   the caller's responsibility.
 *
 * FORMULA INJECTION:
 *   CharacterCSV.export prefixes every user-authored string cell
 *   with a guard character when the value would be evaluated as a
 *   spreadsheet formula. CharacterCSV.import strips the guard
 *   symmetrically.
 *
 *   SCOPE OF THE GUARD (this revision):
 *     The guard is applied through a local wrapper
 *     (guardFormulaForCell) that SKIPS guarding when the value
 *     looks like a negative number or a negative number with a
 *     trailing unit or comma-grouped tail ("-5", "-5kg",
 *     "-5 metres", "-5,000"). Those values round-trip unchanged;
 *     they are not silently prefixed, which avoids producing "'-5"
 *     in the CSV where a text-editor reader would see it.
 *
 *     Everything else routes through CSV.guardFormula. That still
 *     covers "=SUM(A1:A10)", "+1234", "@home", a leading tab, and
 *     a leading CR.
 *
 *   The guard/un-guard pair is symmetric on the import side
 *   (CSV.unguardFormula), so a genuine leading apostrophe in a
 *   value — "'Tis the season" — is preserved.
 *
 *   csv-parser.js is NOT modified. The scoping lives entirely in
 *   this file because three other exporters depend on
 *   isPotentialFormula's current behaviour.
 *
 * LAZY DEPENDENCIES:
 *   Every dependency this file uses is resolved at call time, not
 *   at load time. A missing dependency produces a clear error the
 *   first time an operation that needs it runs, not a load-time
 *   throw that takes the whole module offline.
 *
 * PREVIOUS-NAME COLUMN:
 *   The column header is "AssociatedNames". The field on the
 *   character record is `previousNames`, an array. Export writes
 *   `previousNames.join(' | ')`. Import splits on '|' and trims
 *   each entry. Empty cells yield [].
 *
 *   A single previous name containing a literal '|' would be
 *   mis-split. That is a documented trade-off of keeping the
 *   column flat and human-editable. CharacterCSV's other array
 *   columns (careerStatus, eliminatedWeeks) remain JSON-encoded.
 *
 * ELIMINATION QUERIES SIGNATURE:
 *   CharacterRosterExport.resolveEliminationMarker calls
 *   EliminationQueries.getEliminationYear(char) with a character
 *   record. EliminationQueries accepts both a character record and
 *   a character-id string, so both shapes work here and in
 *   class-roster-export.js.
 */

(function() {
    'use strict';

    if (window.__characterExportBundleLoaded) {
        return;
    }
    window.__characterExportBundleLoaded = true;

    // ============================================================
    // SHARED DEPENDENCY ACCESSORS - LAZY
    // ============================================================

    function getCSV()               { return window.CSV || null; }
    function getImportResult()      { return window.ImportResult || null; }
    function getExportUtils()       { return window.ExportUtils || null; }
    function getIdUtils()           { return window.IdUtils || null; }
    function getCharacterQueries()  { return window.CharacterQueries || null; }

    // ============================================================
    // SHARED DEPENDENCY CHECKS - per entry point
    // ============================================================

    function requireCSV(calleeName) {
        var CSV = getCSV();
        if (!CSV || typeof CSV.parse !== 'function' ||
            typeof CSV.arrayToCSV !== 'function') {
            throw new Error(
                '[CharacterExport] ' + calleeName + ' requires ' +
                'window.CSV with parse and arrayToCSV. Ensure ' +
                'csv-parser.js is loaded before this function is ' +
                'called.'
            );
        }
        return CSV;
    }

    function requireImportResult(calleeName) {
        var IR = getImportResult();
        if (typeof IR !== 'function') {
            throw new Error(
                '[CharacterExport] ' + calleeName + ' requires ' +
                'window.ImportResult. Ensure import-result.js is ' +
                'loaded before this function is called.'
            );
        }
        return IR;
    }

    function requireExportUtils(calleeName) {
        var EU = getExportUtils();
        if (!EU || typeof EU.downloadBlob !== 'function') {
            throw new Error(
                '[CharacterExport] ' + calleeName + ' requires ' +
                'window.ExportUtils.downloadBlob. Ensure ' +
                'export-utils.js is loaded before this function is ' +
                'called.'
            );
        }
        return EU;
    }

    function requireIdUtils(calleeName) {
        var IU = getIdUtils();
        if (!IU || typeof IU.generateId !== 'function') {
            throw new Error(
                '[CharacterExport] ' + calleeName + ' requires ' +
                'window.IdUtils.generateId. Ensure id-utils.js is ' +
                'loaded before this function is called.'
            );
        }
        return IU;
    }

    // ============================================================
    // SHARED SMALL HELPERS
    // ============================================================

    var BOM_CHAR_CODE = 0xFEFF;

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function trimmed(value) {
        return safeString(value).trim();
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    /**
     * Coerce a value to a boolean the same way form checkboxes do.
     * "true"/"false" strings are honoured; anything else follows
     * JS truthiness.
     */
    function coerceBoolean(value) {
        if (typeof value === 'string') {
            if (value.toLowerCase() === 'false') { return false; }
            if (value.toLowerCase() === 'true') { return true; }
        }
        return !!value;
    }

    /**
     * Pad a numeric value to `width` with leading zeroes.
     * Manual loop; avoids String.prototype.padStart.
     */
    function padZeros(value, width) {
        var str = String(value);
        while (str.length < width) {
            str = '0' + str;
        }
        return str;
    }

    /**
     * Guard a value against spreadsheet formula evaluation.
     *
     * Delegates to CSV.guardFormula when available. Falls back to a
     * local implementation using CSV.isPotentialFormula as the
     * predicate. Non-string values pass through untouched.
     *
     * The guard is idempotent: a value that is already guarded is
     * not guarded a second time.
     */
    function guardFormula(value) {
        var CSV = getCSV();
        if (CSV && typeof CSV.guardFormula === 'function') {
            return CSV.guardFormula(value);
        }

        // Fallback: local implementation with the same semantics,
        // using whichever predicate helper is available.
        if (value === undefined || value === null) {
            return value;
        }
        if (typeof value !== 'string') {
            return value;
        }
        if (value === '') {
            return value;
        }

        var predicate = null;
        if (CSV && typeof CSV.isPotentialFormula === 'function') {
            predicate = CSV.isPotentialFormula;
        } else {
            predicate = function(v) {
                if (typeof v !== 'string') { return false; }
                var t = v.trim();
                if (t === '') { return false; }
                var first = t.charAt(0);
                return first === '=' || first === '+' ||
                       first === '-' || first === '@' ||
                       first === '\t' || first === '\r';
            };
        }

        if (value.charAt(0) === "'" &&
            predicate(value.substring(1))) {
            return value;
        }
        if (predicate(value)) {
            return "'" + value;
        }
        return value;
    }

    /**
     * Guard a cell value against spreadsheet formula evaluation,
     * SKIPPING the guard when the value looks like a negative
     * number with an optional unit or comma-grouped tail.
     *
     * Why skip:
     *   A cell whose trimmed content matches /^-?\d/ is a negative
     *   number or a negative number followed by a unit or
     *   comma-grouping ("-5", "-5kg", "-5 metres", "-5,000").
     *   Those are ordinary data values, not formulas, and prefixing
     *   them with `'` produces "'-5" in the CSV file, which a
     *   text-editor reader finds confusing.
     *
     *   Round-trip losslessness is preserved without the prefix
     *   because no unguard is needed on the import side for these
     *   values (the string in the cell is unchanged on the way out
     *   and on the way back in).
     *
     *   Real formula shapes ("=SUM(A1)", "+1234", "@home",
     *   leading tab, leading CR) still go through guardFormula.
     */
    function guardFormulaForCell(value) {
        if (typeof value !== 'string') {
            return guardFormula(value);
        }
        var trimmedValue = value.trim();
        if (trimmedValue === '') {
            return value;
        }
        if (/^-?\d/.test(trimmedValue)) {
            // Negative number, or any numeric value. Not a
            // spreadsheet formula. Skip the guard.
            return value;
        }
        return guardFormula(value);
    }

    /**
     * Strip the guard prefix from a value that was guarded by
     * guardFormula. The strip is symmetric with the guard.
     *
     * Delegates to CSV.unguardFormula when available; otherwise
     * uses a local implementation with the same semantics.
     */
    function unguardFormula(value) {
        var CSV = getCSV();
        if (CSV && typeof CSV.unguardFormula === 'function') {
            return CSV.unguardFormula(value);
        }

        // Local fallback, symmetric to the local guard above.
        if (typeof value !== 'string') {
            return value;
        }
        if (value === '') {
            return value;
        }
        if (value.charAt(0) !== "'") {
            return value;
        }
        var remainder = value.substring(1);
        if (remainder === '') {
            return value;
        }

        var predicate;
        if (CSV && typeof CSV.isPotentialFormula === 'function') {
            predicate = CSV.isPotentialFormula;
        } else {
            predicate = function(v) {
                if (typeof v !== 'string') { return false; }
                var t = v.trim();
                if (t === '') { return false; }
                var first = t.charAt(0);
                return first === '=' || first === '+' ||
                       first === '-' || first === '@' ||
                       first === '\t' || first === '\r';
            };
        }

        if (predicate(remainder)) {
            return remainder;
        }
        return value;
    }

    /**
     * Parse a strict positive integer (or 0), returning null for
     * anything malformed. Used by the career-status and
     * eliminatedWeeks row-level coercion.
     */
    function parseStrictInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isSafeInteger(value)) { return null; }
            return value;
        }
        if (typeof value === 'string') {
            var str = value.trim();
            if (str === '' || !/^-?\d+$/.test(str)) { return null; }
            var n = parseInt(str, 10);
            if (isNaN(n) || !Number.isSafeInteger(n)) {
                return null;
            }
            return n;
        }
        return null;
    }

    /**
     * Get the character's class ids for display purposes, preferring
     * enrolment data over the cached classIds array.
     *
     * Enrolment is the source of truth (AcademyEnrolments). The
     * classIds field is a denormalised cache that can carry stale
     * references after a rollback or purge; using enrolment first
     * means a purge is reflected immediately.
     *
     * Falls back to classIds when enrolments are absent or empty.
     * Returns a string-id array.
     */
    function getClassIdsForCharacter(char) {
        if (!char || !char.id) { return []; }

        var Enrol = window.AcademyEnrolments;
        if (Enrol &&
            typeof Enrol.getStudentClasses === 'function') {
            try {
                var enrolled = Enrol.getStudentClasses(char.id);
                if (Array.isArray(enrolled) &&
                    enrolled.length > 0) {
                    var result = [];
                    for (var i = 0; i < enrolled.length; i++) {
                        if (isNonEmptyString(enrolled[i])) {
                            result.push(String(enrolled[i]));
                        }
                    }
                    if (result.length > 0) { return result; }
                }
            } catch (e) {
                // Fall through to classIds.
            }
        }

        if (Array.isArray(char.classIds)) {
            var fallback = [];
            for (var j = 0; j < char.classIds.length; j++) {
                if (isNonEmptyString(char.classIds[j])) {
                    fallback.push(String(char.classIds[j]));
                }
            }
            return fallback;
        }

        return [];
    }

    // ============================================================
    // SECTION 2: CharacterCSV
    // ============================================================

    (function() {

        var SECTION = '# CHARACTERS';
        var MAX_ROWS = 10000;
        var ID_PREFIX = 'char';

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
            'EliminatedWeeks',
            'Authority',
            'ConflictStyle',
            'SocialStyle',
            'Quirks'
        ];

        var FIELD_MAP = {
            0: 'id',
            1: 'firstName',
            2: 'middleName',
            3: 'lastName',
            4: 'birthYear',
            5: 'gender',
            6: 'previousNames',
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
            21: 'eliminatedWeeks',
            22: 'authority',
            23: 'conflictStyle',
            24: 'socialStyle',
            25: 'quirks'
        };

        function normalizeSectionMarker(value) {
            var str = String(value == null ? '' : value);

            if (str.length > 0 && str.charCodeAt(0) === BOM_CHAR_CODE) {
                str = str.substring(1);
            }

            str = str.trim();
            if (str === '') { return ''; }

            if (str.charAt(0) === '#') {
                str = '#' + str.substring(1).trim();
            }

            return str.toUpperCase();
        }

        function isSectionMarker(value) {
            var normalized = normalizeSectionMarker(value);
            return normalized.length > 0 &&
                   normalized.charAt(0) === '#';
        }

        var TARGET_SECTION_MARKER = normalizeSectionMarker(SECTION);
        var HEADER_MARKER_FIRST_COLUMN = 'CHARACTERID';

        function getColumns() {
            return COLUMNS.slice();
        }

        function getHeader() {
            return COLUMNS.slice();
        }

        function getColumnIndex(fieldName) {
            for (var key in FIELD_MAP) {
                if (Object.prototype.hasOwnProperty.call(
                    FIELD_MAP, key
                ) && FIELD_MAP[key] === fieldName) {
                    return parseInt(key, 10);
                }
            }
            return null;
        }

        function getFieldName(index) {
            return FIELD_MAP[index] || null;
        }

        function getSection() {
            return SECTION;
        }

        function parseJSONField(value, fallback, warnFn, fieldName) {
            var str = String(value == null ? '' : value).trim();
            if (str === '') {
                return fallback;
            }

            try {
                return JSON.parse(str);
            } catch (e) {
                if (typeof warnFn === 'function') {
                    warnFn(
                        'Invalid JSON in "' + fieldName + '": ' +
                        e.message + ' - using fallback',
                        fieldName
                    );
                }
                return fallback;
            }
        }

        function parseBooleanField(value) {
            var str = String(value == null ? '' : value).trim();
            var lowered = str.toLowerCase();
            return lowered === 'true' || str === '1';
        }

        function isValidCandidate(candidate) {
            if (!candidate || typeof candidate !== 'object') {
                return false;
            }
            var name = (candidate.firstName || '') +
                       (candidate.lastName || '');
            return name.trim().length > 0;
        }

        function isBlankRow(row) {
            if (!row || row.length === 0) {
                return true;
            }
            for (var i = 0; i < row.length; i++) {
                var cell = String(row[i] == null ? '' : row[i])
                    .trim();
                if (cell !== '') {
                    return false;
                }
            }
            return true;
        }

        /**
         * Split the flat-joined previous-names column.
         * "John | Johnny" -> ["John", "Johnny"]. Empty segments
         * are dropped. An empty cell yields [].
         */
        function splitPreviousNames(raw) {
            var str = String(raw == null ? '' : raw).trim();
            if (str === '') { return []; }

            var parts = str.split('|');
            var result = [];
            for (var i = 0; i < parts.length; i++) {
                var entry = parts[i].trim();
                if (entry !== '') { result.push(entry); }
            }
            return result;
        }

        /**
         * Coerce a raw careerStatus value (parsed JSON) to a
         * well-formed array of entries.
         *
         *   - Non-array values become [].
         *   - Non-object entries are dropped.
         *   - status is lowercased and trimmed.
         *   - startYear / endYear must be strict integers, or ''
         *     (a malformed year drops the entry with a warning).
         *   - title is coerced to a string.
         *
         * The function is warn-only: malformed entries do not
         * abort the row. The alternative is a silent drop; a
         * warning at the import boundary is more useful.
         */
        function coerceCareerStatus(raw, warnFn) {
            if (!Array.isArray(raw)) {
                if (raw !== null && raw !== undefined) {
                    if (typeof warnFn === 'function') {
                        warnFn(
                            'CareerStatus is not an array - ' +
                            'defaulting to [].',
                            'CareerStatus'
                        );
                    }
                }
                return [];
            }

            var result = [];
            for (var i = 0; i < raw.length; i++) {
                var entry = raw[i];
                if (!isObject(entry)) { continue; }

                var status = typeof entry.status === 'string'
                    ? entry.status.trim().toLowerCase()
                    : '';

                var startYearNum = parseStrictInteger(
                    entry.startYear
                );
                var endYearNum = parseStrictInteger(
                    entry.endYear
                );

                // Only warn when a value was present but unparseable.
                var startPresent = entry.startYear !== undefined &&
                    entry.startYear !== null &&
                    String(entry.startYear).trim() !== '';
                var endPresent = entry.endYear !== undefined &&
                    entry.endYear !== null &&
                    String(entry.endYear).trim() !== '';

                if (startPresent && startYearNum === null) {
                    if (typeof warnFn === 'function') {
                        warnFn(
                            'Career status entry ' + i +
                            ' has a malformed startYear - ' +
                            'entry skipped.',
                            'CareerStatus'
                        );
                    }
                    continue;
                }
                if (endPresent && endYearNum === null) {
                    if (typeof warnFn === 'function') {
                        warnFn(
                            'Career status entry ' + i +
                            ' has a malformed endYear - ' +
                            'entry skipped.',
                            'CareerStatus'
                        );
                    }
                    continue;
                }

                result.push({
                    status: status,
                    startYear: startYearNum === null
                        ? ''
                        : String(startYearNum),
                    endYear: endYearNum === null
                        ? ''
                        : String(endYearNum),
                    title: typeof entry.title === 'string'
                        ? entry.title.trim()
                        : ''
                });
            }

            return result;
        }

        /**
         * Coerce a raw eliminatedWeeks value (parsed JSON) to an
         * array of integers. Malformed entries are dropped with a
         * warning. A non-array value yields [].
         */
        function coerceEliminatedWeeks(raw, warnFn) {
            if (!Array.isArray(raw)) {
                if (raw !== null && raw !== undefined) {
                    if (typeof warnFn === 'function') {
                        warnFn(
                            'EliminatedWeeks is not an array - ' +
                            'defaulting to [].',
                            'EliminatedWeeks'
                        );
                    }
                }
                return [];
            }

            var result = [];
            for (var i = 0; i < raw.length; i++) {
                var entry = raw[i];
                var n = parseStrictInteger(entry);
                if (n === null) {
                    if (typeof warnFn === 'function') {
                        warnFn(
                            'EliminatedWeeks entry ' + i +
                            ' is not an integer - dropped.',
                            'EliminatedWeeks'
                        );
                    }
                    continue;
                }
                result.push(n);
            }
            return result;
        }

        function parseRow(row, warnFn) {
            var errors = [];
            var warnings = [];

            var firstName = String(row[1] || '').trim();
            var lastName = String(row[3] || '').trim();

            if (!firstName && !lastName) {
                errors.push(
                    'Character row missing first name and last name'
                );
                return {
                    valid: false,
                    character: null,
                    errors: errors,
                    warnings: warnings
                };
            }

            var id = String(row[0] || '').trim() || null;
            var deceased = parseBooleanField(row[15]);

            var rawCareer = parseJSONField(
                row[20], [], warnFn, 'CareerStatus'
            );
            var careerStatus = coerceCareerStatus(
                rawCareer, warnFn
            );

            var rawWeeks = parseJSONField(
                row[21], [], warnFn, 'EliminatedWeeks'
            );
            var eliminatedWeeks = coerceEliminatedWeeks(
                rawWeeks, warnFn
            );

            // Every string cell that could have been guarded on
            // export is unguarded here. The unguard is symmetric:
            // a cell that was never guarded passes through.
            var character = {
                id: id,
                firstName: unguardFormula(firstName),
                middleName: unguardFormula(
                    String(row[2] || '').trim()
                ),
                lastName: unguardFormula(lastName),
                birthYear: unguardFormula(
                    String(row[4] || '').trim()
                ),
                gender: unguardFormula(
                    String(row[5] || '').trim()
                ),
                previousNames: splitPreviousNames(
                    unguardFormula(String(row[6] || ''))
                ),
                eyes: unguardFormula(
                    String(row[7] || '').trim()
                ),
                hair: unguardFormula(
                    String(row[8] || '').trim()
                ),
                skin: unguardFormula(
                    String(row[9] || '').trim()
                ),
                height: unguardFormula(
                    String(row[10] || '').trim()
                ),
                weight: unguardFormula(
                    String(row[11] || '').trim()
                ),
                build: unguardFormula(
                    String(row[12] || '').trim()
                ),
                appearanceNotes: unguardFormula(
                    String(row[13] || '').trim()
                ),
                notes: unguardFormula(
                    String(row[14] || '').trim()
                ),
                deceased: deceased,
                deathYear: unguardFormula(
                    String(row[16] || '').trim()
                ),
                deathCause: unguardFormula(
                    String(row[17] || '').trim()
                ),
                deathAge: unguardFormula(
                    String(row[18] || '').trim()
                ),
                specialty: unguardFormula(
                    String(row[19] || '').trim()
                ),
                careerStatus: careerStatus,
                eliminatedWeeks: eliminatedWeeks,

                personality: {
                    authority: unguardFormula(
                        String(row[22] || '').trim()
                    ),
                    conflictStyle: unguardFormula(
                        String(row[23] || '').trim()
                    ),
                    socialStyle: unguardFormula(
                        String(row[24] || '').trim()
                    ),
                    quirks: unguardFormula(
                        String(row[25] || '').trim()
                    )
                }
            };

            return {
                valid: true,
                character: character,
                errors: errors,
                warnings: warnings
            };
        }

        /**
         * Build one CSV row for a character.
         *
         * Every user-authored string cell is guarded against
         * spreadsheet formula evaluation via
         * guardFormulaForCell. That wrapper skips the guard for
         * negative numbers and numeric strings, so "-5" and "-5kg"
         * round-trip unchanged while "=SUM(A1)" is still guarded.
         *
         * The cells produced by this function itself — the boolean
         * 'true'/'false' cell and the JSON-encoded careerStatus
         * and eliminatedWeeks cells — are not guarded, because
         * their shape is fixed and cannot begin with a formula
         * prefix.
         */
        function toRow(character) {
            if (!character || typeof character !== 'object') {
                return COLUMNS.map(function() { return ''; });
            }

            var personality = character.personality || {};

            var previousNames = Array.isArray(character.previousNames)
                ? character.previousNames
                    .map(function(n) {
                        return safeString(n).trim();
                    })
                    .filter(function(n) { return n !== ''; })
                : [];

            return [
                character.id != null ? character.id : '',
                guardFormulaForCell(character.firstName != null
                    ? character.firstName : ''),
                guardFormulaForCell(character.middleName != null
                    ? character.middleName : ''),
                guardFormulaForCell(character.lastName != null
                    ? character.lastName : ''),
                guardFormulaForCell(character.birthYear != null
                    ? character.birthYear : ''),
                guardFormulaForCell(character.gender != null
                    ? character.gender : ''),
                guardFormulaForCell(previousNames.join(' | ')),
                guardFormulaForCell(character.eyes != null
                    ? character.eyes : ''),
                guardFormulaForCell(character.hair != null
                    ? character.hair : ''),
                guardFormulaForCell(character.skin != null
                    ? character.skin : ''),
                guardFormulaForCell(character.height != null
                    ? character.height : ''),
                guardFormulaForCell(character.weight != null
                    ? character.weight : ''),
                guardFormulaForCell(character.build != null
                    ? character.build : ''),
                guardFormulaForCell(character.appearanceNotes != null
                    ? character.appearanceNotes : ''),
                guardFormulaForCell(character.notes != null
                    ? character.notes : ''),
                character.deceased ? 'true' : 'false',
                guardFormulaForCell(character.deathYear != null
                    ? character.deathYear : ''),
                guardFormulaForCell(character.deathCause != null
                    ? character.deathCause : ''),
                guardFormulaForCell(character.deathAge != null
                    ? character.deathAge : ''),
                guardFormulaForCell(character.specialty != null
                    ? character.specialty : ''),
                JSON.stringify(
                    character.careerStatus != null
                        ? character.careerStatus : []
                ),
                JSON.stringify(
                    character.eliminatedWeeks != null
                        ? character.eliminatedWeeks : []
                ),
                guardFormulaForCell(personality.authority != null
                    ? personality.authority : ''),
                guardFormulaForCell(personality.conflictStyle != null
                    ? personality.conflictStyle : ''),
                guardFormulaForCell(personality.socialStyle != null
                    ? personality.socialStyle : ''),
                guardFormulaForCell(personality.quirks != null
                    ? personality.quirks : '')
            ];
        }

        function toRows(characters) {
            if (!Array.isArray(characters)) {
                throw new TypeError(
                    'Characters must be an array.'
                );
            }

            var rows = [
                [SECTION],
                COLUMNS.slice()
            ];

            for (var i = 0; i < characters.length; i++) {
                rows.push(toRow(characters[i]));
            }

            return rows;
        }

        function exportCharacters(characters, options) {
            options = options || {};

            requireExportUtils('CharacterCSV.export');

            if (!Array.isArray(characters)) {
                throw new TypeError(
                    'Characters must be an array.'
                );
            }

            var CSV = requireCSV('CharacterCSV.export');

            var rows = toRows(characters);
            var csvContent = CSV.arrayToCSV(rows);

            var blob = new Blob(['\uFEFF' + csvContent], {
                type: 'text/csv;charset=utf-8;'
            });

            var filename = options.filename ||
                'characters-' +
                new Date().toISOString().slice(0, 10) + '.csv';

            getExportUtils().downloadBlob(blob, filename);

            return {
                count: characters.length,
                filename: filename
            };
        }

        function exportFromData(options) {
            options = options || {};

            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries ||
                typeof CharacterQueries.getCharacters !== 'function') {
                throw new Error(
                    'CharacterQueries not available.'
                );
            }

            var characters = CharacterQueries.getCharacters();

            if (characters.length === 0) {
                return {
                    count: 0,
                    filename: null,
                    message: 'No characters to export.'
                };
            }

            var result = exportCharacters(characters, options);
            result.message =
                'Exported ' + result.count + ' characters';
            return result;
        }

        function getCSVContent(characters) {
            if (!Array.isArray(characters)) {
                throw new TypeError(
                    'Characters must be an array.'
                );
            }

            var CSV = requireCSV('CharacterCSV.getCSVContent');
            var rows = toRows(characters);
            return CSV.arrayToCSV(rows);
        }

        function extractRows(records) {
            var rows = [];
            var inSection = false;

            for (var i = 0; i < records.length; i++) {
                var row = records[i];

                if (isBlankRow(row)) {
                    continue;
                }

                var first = String(
                    row[0] == null ? '' : row[0]
                );

                if (!inSection) {
                    if (normalizeSectionMarker(first) ===
                        TARGET_SECTION_MARKER) {
                        inSection = true;
                    }
                    continue;
                }

                if (isSectionMarker(first)) {
                    break;
                }

                if (normalizeSectionMarker(first) ===
                    HEADER_MARKER_FIRST_COLUMN) {
                    continue;
                }

                rows.push(row);
            }

            return rows;
        }

        function importCharacters(csvText, options) {
            options = options || {};
            var maxRows = options.maxRows || MAX_ROWS;

            var CSV = requireCSV('CharacterCSV.import');
            var ImportResult = requireImportResult(
                'CharacterCSV.import'
            );

            var result = new ImportResult();

            var records;
            try {
                records = CSV.parse(csvText);
            } catch (e) {
                result.addError(
                    'Failed to parse CSV: ' + e.message
                );
                return result;
            }

            if (records.length === 0) {
                result.addWarning('CSV file is empty');
                return result;
            }

            var characterRows = extractRows(records);
            if (characterRows.length === 0) {
                result.addError(
                    'No character data found. Expected "' +
                    SECTION + '" section.'
                );
                return result;
            }

            if (characterRows.length > maxRows) {
                result.addError(
                    'Too many rows (' + characterRows.length +
                    '). Maximum is ' + maxRows + '.'
                );
                return result;
            }

            var CharacterQueries = getCharacterQueries();

            for (var i = 0; i < characterRows.length; i++) {
                var row = characterRows[i];
                var rowNumber = i + 1;

                if (isBlankRow(row)) {
                    continue;
                }

                var parsed = parseRow(row, function(
                    warning, fieldName
                ) {
                    var msg = warning;
                    if (fieldName) {
                        msg = fieldName + ': ' + warning;
                    }
                    result.addWarning(msg, {
                        row: rowNumber,
                        field: fieldName
                    });
                });

                if (parsed.valid) {
                    if (isValidCandidate(parsed.character)) {
                        // ---- ID resolution ----
                        //
                        // The CSV's CharacterId column is a hint,
                        // not a key. CharacterCRUD.save ignores it
                        // (it treats the DTO as "create new" and
                        // assigns a fresh id). We therefore:
                        //
                        //   - generate an id when the CSV had none
                        //   - regenerate when the CSV id collides
                        //     with a live character, and warn
                        //
                        // This makes the collision visible to the
                        // user rather than silently producing two
                        // characters with the "same" id in the
                        // candidate list.
                        if (!parsed.character.id) {
                            var IU = requireIdUtils(
                                'CharacterCSV.import'
                            );
                            parsed.character.id =
                                IU.generateId(ID_PREFIX);
                        } else if (
                            CharacterQueries &&
                            typeof CharacterQueries
                                .getCharacterById === 'function'
                        ) {
                            var existing = null;
                            try {
                                existing = CharacterQueries
                                    .getCharacterById(
                                        parsed.character.id
                                    );
                            } catch (e) {
                                existing = null;
                            }
                            if (existing) {
                                var IU2 = requireIdUtils(
                                    'CharacterCSV.import'
                                );
                                var oldId =
                                    parsed.character.id;
                                parsed.character.id =
                                    IU2.generateId(ID_PREFIX);
                                result.addWarning(
                                    'CharacterId "' + oldId +
                                    '" already exists; a new id ' +
                                    'was generated.',
                                    { row: rowNumber, field: 'CharacterId' }
                                );
                            }
                        }
                        result.addValid(parsed.character, {
                            row: rowNumber
                        });
                    } else {
                        result.addError(
                            'Invalid character data (missing name)',
                            { row: rowNumber }
                        );
                    }
                }

                for (var j = 0; j < parsed.errors.length; j++) {
                    result.addError(parsed.errors[j], {
                        row: rowNumber
                    });
                }
            }

            return result;
        }

        function importFromFile(file, options) {
            options = options || {};

            return new Promise(function(resolve, reject) {
                var reader = new FileReader();

                reader.onload = function(e) {
                    try {
                        var result = importCharacters(
                            e.target.result, options
                        );
                        resolve(result);
                    } catch (err) {
                        reject(new Error(
                            'Failed to import characters: ' +
                            err.message
                        ));
                    }
                };

                reader.onerror = function() {
                    reject(new Error(
                        'Failed to read file: ' +
                        (reader.error
                            ? reader.error.message
                            : 'Unknown error')
                    ));
                };

                reader.readAsText(file);
            });
        }

        function getTemplateCharacters(options) {
            options = options || {};
            var count = options.count || 2;

            var templates = [
                {
                    id: null,
                    firstName: 'John',
                    middleName: '',
                    lastName: 'Doe',
                    birthYear: '1900',
                    gender: 'Male',
                    previousNames: [],
                    eyes: 'Blue',
                    hair: 'Brown',
                    skin: 'Fair',
                    height: '178cm',
                    weight: '75kg',
                    build: 'Athletic',
                    appearanceNotes: '',
                    notes: 'Example character',
                    deceased: false,
                    deathYear: '',
                    deathCause: '',
                    deathAge: '',
                    specialty: '',
                    careerStatus: [{
                        status: 'trainee',
                        startYear: 1920,
                        endYear: 1923
                    }],
                    eliminatedWeeks: [],
                    personality: {
                        authority: 'Cooperative but independent',
                        conflictStyle: 'Negotiates first',
                        socialStyle: 'Warm with strangers',
                        quirks: 'Collects information they have ' +
                            'no use for'
                    }
                },
                {
                    id: null,
                    firstName: 'Jane',
                    middleName: 'Mary',
                    lastName: 'Smith',
                    birthYear: '1902',
                    gender: 'Female',
                    previousNames: ['The Shadow'],
                    eyes: 'Green',
                    hair: 'Black',
                    skin: 'Olive',
                    height: '170cm',
                    weight: '60kg',
                    build: 'Slim',
                    appearanceNotes: 'Scar on cheek',
                    notes: '',
                    deceased: false,
                    deathYear: '',
                    deathCause: '',
                    deathAge: '',
                    specialty: '',
                    careerStatus: [{
                        status: 'trainee',
                        startYear: 1920,
                        endYear: 1923
                    }],
                    eliminatedWeeks: [],
                    personality: {
                        authority: 'Suspicious of authority',
                        conflictStyle:
                            'Lets resentment build quietly',
                        socialStyle:
                            'Reserved until trust is earned',
                        quirks: 'Hates owing anyone a favour'
                    }
                }
            ];

            return templates.slice(0, count);
        }

        function getTemplateRows(options) {
            options = options || {};

            var characters;
            if (options.exampleData &&
                Array.isArray(options.exampleData)) {
                characters = options.exampleData;
            } else {
                characters = getTemplateCharacters({
                    count: options.exampleCount || 2
                });
            }

            return toRows(characters);
        }

        function getTemplateContent(options) {
            var CSV = requireCSV('CharacterCSV.getTemplateContent');
            var rows = getTemplateRows(options);
            return CSV.arrayToCSV(rows);
        }

        function exportTemplate(options) {
            options = options || {};

            requireExportUtils('CharacterCSV.exportTemplate');

            var content = getTemplateContent(options);

            var blob = new Blob(['\uFEFF' + content], {
                type: 'text/csv;charset=utf-8;'
            });

            var filename = options.filename ||
                'characters-template.csv';
            getExportUtils().downloadBlob(blob, filename);

            return {
                exported: true,
                filename: filename
            };
        }

        function getTemplatePreview(options) {
            options = options || {};
            var previewRows = options.previewRows || 2;

            var rows = getTemplateRows(options);
            var headers = rows.length > 1 ? rows[1] : [];
            var examples = [];

            for (var i = 2;
                 i < Math.min(rows.length, 2 + previewRows);
                 i++) {
                examples.push(rows[i]);
            }

            return {
                headers: headers,
                examples: examples
            };
        }

        function validateCandidates(candidates) {
            if (!Array.isArray(candidates)) {
                throw new TypeError(
                    'Candidates must be an array.'
                );
            }

            var valid = [];
            var invalid = [];

            for (var i = 0; i < candidates.length; i++) {
                var candidate = candidates[i];
                if (isValidCandidate(candidate)) {
                    valid.push(candidate);
                } else {
                    invalid.push({
                        index: i,
                        candidate: candidate,
                        reason:
                            'Missing required fields ' +
                            '(firstName/lastName)'
                    });
                }
            }

            return { valid: valid, invalid: invalid };
        }

        function getImportPreview(result, limit) {
            limit = limit || 5;

            var ImportResult = getImportResult();
            if (typeof ImportResult !== 'function' ||
                !(result instanceof ImportResult)) {
                throw new TypeError(
                    'Result must be an ImportResult'
                );
            }

            var valid = result.getValid();
            var preview = valid.slice(0, limit);

            return {
                preview: preview,
                total: valid.length,
                hasMore: valid.length > limit
            };
        }

        function getImportSummary(result) {
            var ImportResult = getImportResult();
            if (typeof ImportResult !== 'function' ||
                !(result instanceof ImportResult)) {
                throw new TypeError(
                    'Result must be an ImportResult'
                );
            }

            var summary = result.getSummary();

            var messages = [];
            if (summary.valid > 0) {
                messages.push(
                    summary.valid + ' character(s) ready to import'
                );
            }
            if (summary.errors > 0) {
                messages.push(
                    summary.errors + ' error(s) found'
                );
            }
            if (summary.warnings > 0) {
                messages.push(
                    summary.warnings + ' warning(s) found'
                );
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
                message: messages.join(', ') ||
                    'No characters found'
            };
        }

        window.CharacterCSV = {
            SECTION: SECTION,
            COLUMNS: COLUMNS,
            ID_PREFIX: ID_PREFIX,

            getColumns: getColumns,
            getHeader: getHeader,
            getColumnIndex: getColumnIndex,
            getFieldName: getFieldName,
            getSection: getSection,

            parseRow: parseRow,
            parseJSONField: parseJSONField,
            parseBooleanField: parseBooleanField,
            isValidCandidate: isValidCandidate,
            extractRows: extractRows,

            toRow: toRow,
            toRows: toRows,

            export: exportCharacters,
            exportFromData: exportFromData,
            getCSVContent: getCSVContent,

            import: importCharacters,
            importFromFile: importFromFile,

            getTemplateCharacters: getTemplateCharacters,
            getTemplateRows: getTemplateRows,
            getTemplateContent: getTemplateContent,
            exportTemplate: exportTemplate,
            getTemplatePreview: getTemplatePreview,

            validateCandidates: validateCandidates,
            getImportPreview: getImportPreview,
            getImportSummary: getImportSummary
        };

        window.downloadCharacterCSVTemplate = exportTemplate;
        window.downloadCharactersCSVTemplate = exportTemplate;
        window.downloadCharacterTemplate = exportTemplate;
        window.characterCSVTemplate = exportTemplate;

    })();

    // ============================================================
    // SECTION 3: CharacterRosterExport
    // ============================================================
    //
    // The tab-separated roster format does not run through the CSV
    // formula guard: TSV has no spreadsheet-evaluation convention
    // that the guard would protect against, and the roster is a
    // display grid, not a spreadsheet import.

    (function() {

        function hasEliminationRecord(char) {
            if (!char || typeof char !== 'object') {
                return false;
            }
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

        function resolveEliminationMarker(char) {
            if (!char || typeof char !== 'object') { return ''; }
            if (!hasEliminationRecord(char)) { return ''; }

            var EQ = window.EliminationQueries || null;
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
                    if (raw !== undefined &&
                        raw !== null &&
                        raw !== '') {
                        var n = parseInt(raw, 10);
                        if (!isNaN(n) && n >= 1) {
                            return String(n);
                        }
                    }
                }
            }

            return 'Yes';
        }

        // TSV has no quoting convention, so a tab or a newline
        // inside a cell would split the row. Both are replaced
        // with a single space before the row is joined. This is
        // lossy by design: the roster is a display grid, and
        // losing the newline in a multi-line note is preferable
        // to corrupting the row.

        function stripTabs(value) {
            return String(value).replace(/\t/g, ' ');
        }

        function stripNewlines(value) {
            return String(value).replace(/[\r\n]+/g, ' ');
        }

        function cleanField(value) {
            return stripNewlines(
                stripTabs(safeString(value))
            );
        }

        function buildText() {
            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries ||
                typeof CharacterQueries.getCharacters !==
                    'function') {
                return {
                    valid: false,
                    content: '',
                    count: 0,
                    error:
                        'CharacterQueries is not available.'
                };
            }

            var characters = [];
            try {
                characters =
                    CharacterQueries.getCharacters() || [];
            } catch (e) {
                return {
                    valid: false,
                    content: '',
                    count: 0,
                    error:
                        'Failed to read character store: ' +
                        e.message
                };
            }

            var sorted = characters.slice().sort(function(a, b) {
                var na = '';
                var nb = '';
                try {
                    na = CharacterQueries.getDisplayName(a) || '';
                } catch (e) { na = ''; }
                try {
                    nb = CharacterQueries.getDisplayName(b) || '';
                } catch (e) { nb = ''; }
                return na.localeCompare(nb);
            });

            var lines = [];
            lines.push(
                ['Name', 'Gender', 'Birth Year', 'Eliminated']
                    .join('\t')
            );

            for (var i = 0; i < sorted.length; i++) {
                var char = sorted[i];
                if (!char || typeof char !== 'object') {
                    continue;
                }

                var name = '';
                try {
                    name = CharacterQueries.getDisplayName(char) ||
                        '';
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

        function buildSelectedText(charIds) {
            if (!Array.isArray(charIds)) {
                return {
                    valid: false,
                    content: '',
                    count: 0,
                    error: 'characterIds must be an array.'
                };
            }

            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries ||
                typeof CharacterQueries.getCharacterById !==
                    'function') {
                return {
                    valid: false,
                    content: '',
                    count: 0,
                    error: 'CharacterQueries is not available.'
                };
            }

            var records = [];
            var seen = Object.create(null);

            for (var i = 0; i < charIds.length; i++) {
                if (charIds[i] === null ||
                    charIds[i] === undefined) {
                    continue;
                }
                var idStr = String(charIds[i]);
                if (idStr === '' || seen[idStr]) { continue; }
                seen[idStr] = true;

                var c = null;
                try {
                    c = CharacterQueries.getCharacterById(idStr);
                } catch (e) {
                    c = null;
                }
                if (c) { records.push(c); }
            }

            records.sort(function(a, b) {
                var na = '';
                var nb = '';
                try {
                    na = CharacterQueries.getDisplayName(a) || '';
                } catch (e) { na = ''; }
                try {
                    nb = CharacterQueries.getDisplayName(b) || '';
                } catch (e) { nb = ''; }
                return na.localeCompare(nb);
            });

            var lines = [];
            lines.push(
                ['Name', 'Gender', 'Birth Year', 'Eliminated']
                    .join('\t')
            );

            for (var r = 0; r < records.length; r++) {
                var char = records[r];
                var name = '';
                try {
                    name = CharacterQueries.getDisplayName(char) ||
                        '';
                } catch (e) { name = ''; }

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
                count: records.length,
                error: null
            };
        }

        function buildFilename() {
            var now = new Date();
            var y = now.getFullYear();
            var m = now.getMonth() + 1;
            var d = now.getDate();
            return 'characters-roster-' +
                y + '-' + padZeros(m, 2) + '-' +
                padZeros(d, 2) + '.txt';
        }

        function exportText() {
            requireExportUtils('CharacterRosterExport.exportText');

            var built = buildText();
            if (!built.valid) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: built.error ||
                        'Failed to build roster.'
                };
            }

            var filename = buildFilename();

            try {
                var blob = new Blob([built.content], {
                    type: 'text/plain;charset=utf-8'
                });
                getExportUtils().downloadBlob(blob, filename);
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

        function exportSelectedText(charIds, options) {
            options = options || {};

            requireExportUtils(
                'CharacterRosterExport.exportSelectedText'
            );

            var built = buildSelectedText(charIds);
            if (!built.valid) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: built.error || 'Failed to build roster.'
                };
            }

            // Only after validity is confirmed does a count of
            // zero mean "nothing to export". Before the validity
            // check, a zero count is the default the error paths
            // leave behind.
            if (built.count === 0) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'No characters to export.'
                };
            }

            var filename = isNonEmptyString(options.filename)
                ? String(options.filename)
                : buildFilename();

            try {
                var blob = new Blob([built.content], {
                    type: 'text/plain;charset=utf-8'
                });
                getExportUtils().downloadBlob(blob, filename);
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

        window.CharacterRosterExport = Object.freeze({
            buildText: buildText,
            exportText: exportText,
            buildSelectedText: buildSelectedText,
            exportSelectedText: exportSelectedText
        });

    })();

    // ============================================================
    // SECTION 4: CharacterExport
    // ============================================================
    //
    // The full and general report builders compose their
    // cross-domain reads lazily at call time and already guard
    // against missing modules. They do not need the CSV formula
    // guard; they emit plain text, not CSV.
    //
    // PERF (deferred):
    //   exportSelectedText and exportGeneralSelectedText re-read
    //   getCharacterById and getDisplayName for every character on
    //   every iteration. A per-batch Map<id, char> and
    //   Map<classId, className> would eliminate the repeated
    //   lookups. The current cost is bounded by the number of
    //   characters selected; a few hundred is imperceptible. If
    //   bulk export of a very large selection becomes a reported
    //   problem, add the two caches here.

    (function() {

        var ROLE_STUDENT = 'student';
        var ROLE_INSTRUCTOR = 'instructor';

        var BANNER_WIDTH = 61;
        var BANNER = new Array(BANNER_WIDTH + 1).join('=');
        var LABEL_WIDTH = 18;
        var FILENAME_PREFIX = 'character';

        var DEFAULT_STAT_KEYS =
            ['str', 'dex', 'con', 'int', 'wis', 'cha'];

        function hasText(value) {
            if (value === undefined || value === null) {
                return false;
            }
            if (typeof value === 'string') {
                return value.trim() !== '';
            }
            if (typeof value === 'number') {
                return isFinite(value);
            }
            if (typeof value === 'boolean') { return true; }
            if (Array.isArray(value)) {
                return value.length > 0;
            }
            if (typeof value === 'object') {
                return Object.keys(value).length > 0;
            }
            return false;
        }

        function intervalRole(interval) {
            if (!interval || typeof interval !== 'object') {
                return ROLE_STUDENT;
            }
            if (interval.role === ROLE_INSTRUCTOR) {
                return ROLE_INSTRUCTOR;
            }
            return ROLE_STUDENT;
        }

        function sanitiseForFilename(value) {
            var str = safeString(value);
            str = str.replace(
                /[<>:"/\\|?*\u0000-\u001F]/g, ''
            );
            str = str.replace(/\s+/g, '-');
            str = str.replace(/-+/g, '-');
            str = str.replace(/^[-.]+|[-.]+$/g, '');
            if (str === '') { return 'character'; }
            if (str.length > 60) {
                str = str.substring(0, 60)
                    .replace(/-+$/, '');
            }
            return str;
        }

        function line(label, value) {
            if (!hasText(value)) { return ''; }
            var v = String(value).replace(/\s+/g, ' ').trim();
            if (v === '') { return ''; }
            var lbl = String(label);
            while (lbl.length < LABEL_WIDTH) { lbl += ' '; }
            return lbl + ': ' + v + '\n';
        }

        function sectionHeader(title) {
            var underlineLen = Math.min(title.length, 60);
            var underline = new Array(underlineLen + 1)
                .join('-');
            return title + '\n' + underline + '\n';
        }

        function emptySectionBody() {
            return '(none)\n';
        }

        function indentedLine(label, value) {
            var inner = line(label, value);
            if (inner === '') { return ''; }
            return '  ' + inner;
        }

        function indentBlock(label, text) {
            if (!hasText(text)) { return ''; }
            var out = '  ' + label + ':\n';
            var lines = String(text)
                .replace(/\r\n/g, '\n').split('\n');
            for (var i = 0; i < lines.length; i++) {
                out += '    ' + lines[i] + '\n';
            }
            return out;
        }

        function groupLine(label, value) {
            if (!hasText(value)) { return ''; }
            var v = String(value).replace(/\s+/g, ' ').trim();
            if (v === '') { return ''; }
            var lbl = String(label);
            while (lbl.length < LABEL_WIDTH) { lbl += ' '; }
            return '    ' + lbl + ': ' + v + '\n';
        }

        function groupHeader(title) {
            var underlineLen = Math.min(title.length, 40);
            var underline = new Array(underlineLen + 1)
                .join('~');
            return '  ' + title + '\n' +
                '  ' + underline + '\n';
        }

        function formatWeekRange(startWeek, endWeek) {
            var s = (startWeek !== undefined &&
                     startWeek !== null &&
                     startWeek !== '')
                ? String(startWeek)
                : '';
            var e = (endWeek !== undefined &&
                     endWeek !== null &&
                     endWeek !== '')
                ? String(endWeek)
                : '';

            if (s && e) {
                return 'Week ' + s + ' \u2013 Week ' + e;
            }
            if (s) { return 'Week ' + s + ' \u2013 present'; }
            if (e) { return 'until Week ' + e; }
            return '';
        }

        function formatYearRange(startYear, endYear) {
            var s = (startYear !== undefined &&
                     startYear !== null &&
                     startYear !== '')
                ? String(startYear)
                : '';
            var e = (endYear !== undefined &&
                     endYear !== null &&
                     endYear !== '')
                ? String(endYear)
                : '';

            if (s && e) { return s + ' \u2013 ' + e; }
            if (s) { return s + ' \u2013 present'; }
            if (e) { return 'until ' + e; }
            return '';
        }

        function isAcademicTeamType(teamType) {
            var TC = window.TeamConstants;
            if (!TC ||
                typeof TC.normalizeTeamType !== 'function') {
                return false;
            }
            return TC.normalizeTeamType(teamType) === 'academic';
        }

        function makeTimelineEntry(year, week, display) {
            var yearNum = parseInt(year, 10);
            if (isNaN(yearNum) || yearNum < 1) {
                return null;
            }

            var yearStr = String(yearNum);
            while (yearStr.length < 4) {
                yearStr = '0' + yearStr;
            }

            var weekStr = '00';
            if (week !== undefined &&
                week !== null &&
                week !== '') {
                var weekNum = parseInt(week, 10);
                if (!isNaN(weekNum) &&
                    weekNum >= 1 &&
                    weekNum <= 99) {
                    weekStr = String(weekNum);
                    if (weekStr.length < 2) {
                        weekStr = '0' + weekStr;
                    }
                }
            }

            return {
                sortKey: yearStr + '-' + weekStr,
                display: display
            };
        }

        function collectTimelineEntries(char, charId) {
            var entries = [];

            if (Array.isArray(char.careerStatus)) {
                for (var i = 0;
                     i < char.careerStatus.length;
                     i++) {
                    var status = char.careerStatus[i];
                    if (!isObject(status)) { continue; }
                    var entry = makeTimelineEntry(
                        status.startYear,
                        null,
                        'Became ' + (status.status || 'Unknown')
                    );
                    if (entry) { entries.push(entry); }
                }
            }

            var TeamQueries = window.TeamQueries;
            if (TeamQueries &&
                typeof TeamQueries
                    .getTeamsForCharacterAllTimeIncludingDeprecated ===
                    'function') {
                var teams = [];
                try {
                    teams = TeamQueries
                        .getTeamsForCharacterAllTimeIncludingDeprecated(
                            charId
                        ) || [];
                } catch (e) { teams = []; }

                for (var t = 0; t < teams.length; t++) {
                    var team = teams[t];
                    if (!team) { continue; }
                    if (team.type !== 'professional') {
                        continue;
                    }

                    var teamName = isNonEmptyString(team.name)
                        ? team.name
                        : 'Unnamed Team';

                    var records = [];
                    try {
                        records = TeamQueries
                            .getAllTeamMemberRecords(team) || [];
                    } catch (e) { records = []; }

                    for (var r = 0; r < records.length; r++) {
                        var rec = records[r];
                        if (!rec ||
                            String(rec.characterId) !==
                                String(charId)) {
                            continue;
                        }
                        if (!Array.isArray(rec.intervals)) {
                            continue;
                        }
                        for (var iv = 0;
                             iv < rec.intervals.length;
                             iv++) {
                            var interval = rec.intervals[iv];
                            if (!interval) { continue; }
                            var entry2 = makeTimelineEntry(
                                interval.joinPeriod,
                                null,
                                'Joined ' + teamName
                            );
                            if (entry2) { entries.push(entry2); }
                        }
                    }
                }
            }

            var EQ = window.EliminationQueries;
            if (EQ &&
                typeof EQ.getEliminationYear === 'function') {
                var elimYear = null;
                var elimWeek = null;
                var elimReason = '';
                try {
                    elimYear = EQ.getEliminationYear(charId);
                    if (typeof EQ.getEliminationWeek ===
                        'function') {
                        elimWeek = EQ.getEliminationWeek(charId);
                    }
                    if (typeof EQ.getEliminationReason ===
                        'function') {
                        elimReason =
                            EQ.getEliminationReason(charId) || '';
                    }
                } catch (e) { /* leave nulls */ }

                if (elimYear !== null &&
                    elimYear !== undefined) {
                    var reasonText = elimReason &&
                        elimReason !== 'Unknown'
                        ? ' \u2014 ' + elimReason
                        : '';
                    var entry3 = makeTimelineEntry(
                        elimYear,
                        elimWeek,
                        'Eliminated' + reasonText
                    );
                    if (entry3) { entries.push(entry3); }
                }
            }

            var Classes = window.AcademyClasses;
            if (Classes &&
                typeof Classes.getClasses === 'function') {
                var allClasses = [];
                try {
                    allClasses = Classes.getClasses() || [];
                } catch (e) { allClasses = []; }

                var charClassIds = getClassIdsForCharacter(char);

                for (var g = 0;
                     g < allClasses.length;
                     g++) {
                    var gClass = allClasses[g];
                    if (!gClass ||
                        gClass.status !== 'graduated') {
                        continue;
                    }
                    if (!isFiniteNumber(gClass.year) &&
                        !isNonEmptyString(gClass.year)) {
                        continue;
                    }

                    var belongs = false;
                    for (var ci = 0;
                         ci < charClassIds.length;
                         ci++) {
                        if (String(charClassIds[ci]) ===
                            String(gClass.id)) {
                            belongs = true;
                            break;
                        }
                    }
                    if (!belongs) { continue; }

                    var entry4 = makeTimelineEntry(
                        gClass.year,
                        null,
                        'Graduated from ' +
                            (gClass.name || 'Unknown Class')
                    );
                    if (entry4) { entries.push(entry4); }
                }
            }

            entries.sort(function(a, b) {
                var keyCmp = a.sortKey.localeCompare(b.sortKey);
                if (keyCmp !== 0) { return keyCmp; }
                return a.display.localeCompare(b.display);
            });

            var seen = Object.create(null);
            var deduped = [];
            for (var d = 0; d < entries.length; d++) {
                var key = entries[d].sortKey + '::' +
                    entries[d].display;
                if (seen[key]) { continue; }
                seen[key] = true;
                deduped.push(entries[d]);
            }

            return deduped;
        }

        function buildTimelineSection(char, charId) {
            var entries = collectTimelineEntries(char, charId);

            if (entries.length === 0) {
                return emptySectionBody();
            }

            var out = '';
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                var yearStr = e.sortKey.substring(0, 4)
                    .replace(/^0+/, '');
                var weekStr = e.sortKey.substring(5);
                var weekNum = parseInt(weekStr, 10);

                var dateLabel;
                if (weekNum > 0) {
                    dateLabel = 'Y' + yearStr + ' W' + weekNum;
                } else {
                    dateLabel = 'Y' + yearStr;
                }

                var lbl = dateLabel;
                while (lbl.length < 10) { lbl += ' '; }

                out += lbl + '  ' + e.display + '\n';
            }
            return out;
        }

        function buildAtAGlanceSection(char, charId) {
            var CharacterQueries = getCharacterQueries();
            var out = '';

            out += line('Character ID', String(charId));

            var status = '';
            try {
                status = CharacterQueries
                    .getCurrentStatus(char) || '';
            } catch (e) { status = ''; }
            out += line('Current status', status);

            var age = '';
            try {
                age = CharacterQueries
                    .getCharacterAge(char) || '';
            } catch (e) { age = ''; }
            out += line('Age', age);

            var deceased = false;
            try {
                if (typeof CharacterQueries.isDeceased ===
                    'function') {
                    deceased =
                        CharacterQueries.isDeceased(char) === true;
                }
            } catch (e) { deceased = false; }
            out += line('Deceased', deceased ? 'yes' : 'no');

            var TeamQueries = window.TeamQueries;
            var teamNames = [];
            if (TeamQueries &&
                typeof TeamQueries.getTeamsForCharacter ===
                    'function') {
                var currentYear = null;
                if (window.data &&
                    isFiniteNumber(window.data.currentYear) &&
                    window.data.currentYear > 0) {
                    currentYear = Math.floor(
                        window.data.currentYear
                    );
                }
                if (currentYear !== null) {
                    var teams = [];
                    try {
                        teams = TeamQueries.getTeamsForCharacter(
                            charId, currentYear
                        ) || [];
                    } catch (e) { teams = []; }
                    for (var i = 0; i < teams.length; i++) {
                        if (teams[i] &&
                            isNonEmptyString(teams[i].name)) {
                            teamNames.push(teams[i].name);
                        }
                    }
                }
            }
            if (teamNames.length > 0) {
                out += line('On teams', teamNames.join(', '));
            }

            var Classes = window.AcademyClasses;
            if (Classes &&
                typeof Classes.getCharacterClassNames ===
                    'function') {
                var classNames = [];
                try {
                    classNames =
                        Classes.getCharacterClassNames(char) ||
                        [];
                } catch (e) { classNames = []; }
                if (classNames.length > 0) {
                    out += line('In classes', classNames.join(', '));
                }
            }

            if (out === '') {
                return emptySectionBody();
            }
            return out;
        }

        function buildIdentityPhysicalGroup(char) {
            var out = '';
            var physicalParts = [];

            if (isNonEmptyString(char.build)) {
                physicalParts.push(String(char.build));
            }
            if (isNonEmptyString(char.height)) {
                physicalParts.push(String(char.height));
            }
            if (isNonEmptyString(char.weight)) {
                physicalParts.push(String(char.weight));
            }
            if (physicalParts.length > 0) {
                out += groupLine(
                    'Build',
                    physicalParts.join(' \u00b7 ')
                );
            }

            var colourParts = [];
            if (isNonEmptyString(char.eyes)) {
                colourParts.push(String(char.eyes));
            }
            if (isNonEmptyString(char.hair)) {
                colourParts.push(String(char.hair));
            }
            if (isNonEmptyString(char.skin)) {
                colourParts.push(String(char.skin));
            }
            if (colourParts.length > 0) {
                out += groupLine(
                    'Eyes / hair / skin',
                    colourParts.join(' / ')
                );
            }

            if (isNonEmptyString(char.gender)) {
                out += groupLine('Gender', char.gender);
            }
            if (isNonEmptyString(char.attraction)) {
                out += groupLine('Attraction', char.attraction);
            }
            if (isNonEmptyString(char.sexuality)) {
                out += groupLine('Sexuality', char.sexuality);
            }

            if (isNonEmptyString(char.appearanceNotes)) {
                out += '\n';
                out += '    ' + 'Appearance notes:' + '\n';
                out += indentBlock('', char.appearanceNotes)
                    .replace(/^  /gm, '    ');
            }

            if (out === '') { return ''; }

            return groupHeader('Physical') + out + '\n';
        }

        function buildIdentityPersonalityGroup(char) {
            var p = isObject(char.personality)
                ? char.personality
                : {};

            var out = '';
            out += groupLine('Traits', p.traits);
            out += groupLine('Ideals', p.ideals);
            out += groupLine('Bonds', p.bonds);
            out += groupLine('Flaws', p.flaws);
            out += groupLine('Alignment', p.alignment);
            out += groupLine('Likes', p.likes);
            out += groupLine('Dislikes', p.dislikes);
            out += groupLine('Habits', p.habits);
            out += groupLine('Fears', p.fears);
            out += groupLine('Goals', p.goals);
            out += groupLine('Authority', p.authority);
            out += groupLine('Conflict style', p.conflictStyle);
            out += groupLine('Social style', p.socialStyle);
            out += groupLine('Quirks', p.quirks);

            if (out === '') { return ''; }

            return groupHeader('Personality') + out + '\n';
        }

        function buildIdentityCombatGroup(char) {
            var out = '';

            var statKeys = DEFAULT_STAT_KEYS;
            var CC = window.CharacterConstants;
            if (CC && Array.isArray(CC.STAT_KEYS) &&
                CC.STAT_KEYS.length > 0) {
                statKeys = CC.STAT_KEYS.slice();
            }

            var stats = isObject(char.stats) ? char.stats : {};
            var statParts = [];
            for (var s = 0; s < statKeys.length; s++) {
                var k = statKeys[s];
                var v = stats[k];
                if (isFiniteNumber(v)) {
                    statParts.push(k.toUpperCase() + ' ' + v);
                }
            }
            if (statParts.length > 0) {
                out += groupLine(
                    'Stats',
                    statParts.join(' \u00b7 ')
                );
            }

            var hpmp = [];
            if (isFiniteNumber(char.hp)) {
                hpmp.push('HP ' + char.hp);
            }
            if (isFiniteNumber(char.mp)) {
                hpmp.push('MP ' + char.mp);
            }
            if (hpmp.length > 0) {
                out += groupLine('HP / MP', hpmp.join(' \u00b7 '));
            }

            var magicKeys = [];
            var MC = window.MagicConstants;
            if (MC && typeof MC.getTypeKeys === 'function') {
                try {
                    var mkeys = MC.getTypeKeys();
                    if (Array.isArray(mkeys)) {
                        magicKeys = mkeys;
                    }
                } catch (e) { magicKeys = []; }
            }

            var magic = isObject(char.magic) ? char.magic : {};
            var magicParts = [];
            for (var m = 0; m < magicKeys.length; m++) {
                var mk = magicKeys[m];
                var mv = magic[mk];
                if (isFiniteNumber(mv) && mv !== 0) {
                    var mlabel = mk.charAt(0).toUpperCase() +
                        mk.slice(1);
                    magicParts.push(mlabel + ' ' + mv);
                }
            }
            if (magicParts.length > 0) {
                out += groupLine(
                    'Magic',
                    magicParts.join(' \u00b7 ')
                );
            }

            if (Array.isArray(char.weapons) &&
                char.weapons.length > 0) {
                var weapons = [];
                for (var w = 0;
                     w < char.weapons.length;
                     w++) {
                    var weapon = char.weapons[w];
                    if (!isObject(weapon)) { continue; }
                    var name = isNonEmptyString(weapon.name)
                        ? String(weapon.name)
                        : '';
                    if (name === '') { continue; }
                    if (isNonEmptyString(weapon.type)) {
                        name += ' (' + weapon.type + ')';
                    }
                    if (isNonEmptyString(weapon.notes)) {
                        name += ' \u2014 ' + weapon.notes;
                    }
                    weapons.push(name);
                }
                if (weapons.length > 0) {
                    out += groupLine(
                        'Weapons',
                        weapons.join('; ')
                    );
                }
            }

            var sm = isObject(char.specialMoves)
                ? char.specialMoves
                : {};
            var moveParts = [];

            function listNames(list) {
                if (!Array.isArray(list) ||
                    list.length === 0) {
                    return '';
                }
                var names = [];
                for (var i = 0; i < list.length; i++) {
                    var item = list[i];
                    if (!isObject(item)) { continue; }
                    if (!isNonEmptyString(item.name)) {
                        continue;
                    }
                    var str = String(item.name);
                    if (isNonEmptyString(item.description)) {
                        str += ' (' + item.description + ')';
                    }
                    names.push(str);
                }
                return names.join(', ');
            }

            var phys = listNames(sm.physical);
            var mag = listNames(sm.magical);
            if (phys) {
                moveParts.push('Physical \u2014 ' + phys);
            }
            if (mag) {
                moveParts.push('Magical \u2014 ' + mag);
            }

            if (moveParts.length > 0) {
                out += groupLine(
                    'Moves',
                    moveParts.join(' \u00b7 ')
                );
            }

            if (isNonEmptyString(char.combatNotes)) {
                out += groupLine('Combat notes', char.combatNotes);
            }

            if (out === '') { return ''; }

            return groupHeader('Combat') + out + '\n';
        }

        function buildIdentitySection(char, charId) {
            var CharacterQueries = getCharacterQueries();
            var out = '';

            out += line('Character ID', String(charId));

            var fullName = '';
            if (typeof CharacterQueries.getFullName ===
                'function') {
                try {
                    fullName =
                        CharacterQueries.getFullName(char) || '';
                } catch (e) { fullName = ''; }
            }
            out += line('Full name', fullName);

            var displayName = '';
            try {
                displayName =
                    CharacterQueries.getDisplayName(char) || '';
            } catch (e) { displayName = ''; }
            out += line('Display name', displayName);

            if (isNonEmptyString(char.nickname)) {
                out += line('Nickname', char.nickname);
            }
            if (isNonEmptyString(char.alias)) {
                out += line('Alias', char.alias);
            }
            if (Array.isArray(char.previousNames) &&
                char.previousNames.length > 0) {
                out += line(
                    'Also known as',
                    char.previousNames.join(', ')
                );
            }

            if (isNonEmptyString(char.birthYear)) {
                out += line('Birth year', char.birthYear);
            }
            if (isNonEmptyString(char.deathYear)) {
                out += line('Death year', char.deathYear);
            }
            if (isNonEmptyString(char.deathWeek)) {
                out += line('Death week', char.deathWeek);
            }
            if (isNonEmptyString(char.deathCause)) {
                out += line('Death cause', char.deathCause);
            }
            if (isNonEmptyString(char.deathAge)) {
                out += line('Age at death', char.deathAge);
            }

            if (isNonEmptyString(char.specialty)) {
                out += line('Specialty', char.specialty);
            }

            if (isNonEmptyString(char.notes)) {
                out += '\n';
                out += indentBlock('Notes', char.notes);
            }

            var physical = buildIdentityPhysicalGroup(char);
            var personality =
                buildIdentityPersonalityGroup(char);
            var combat = buildIdentityCombatGroup(char);

            if (physical || personality || combat) {
                out += '\n';
            }
            if (physical) { out += physical; }
            if (personality) { out += personality; }
            if (combat) { out += combat; }

            if (out === '') {
                return emptySectionBody();
            }
            return out;
        }

        function buildRoleSplitEnrolmentMap(char, charId) {
            var result = {
                student: {},
                instructor: {}
            };

            var Enrol = window.AcademyEnrolments;
            var Classes = window.AcademyClasses;
            var Disciplines = window.AcademyDisciplines;

            if (!Enrol ||
                typeof Enrol.getStudentDisciplines !==
                    'function') {
                return result;
            }

            var classIds = getClassIdsForCharacter(char);

            // Merge in the class's own list from
            // getCharacterClasses, when available. This catches the
            // case where a character has enrolments but not a
            // classIds entry (pre-migration).
            if (Classes &&
                typeof Classes.getCharacterClasses ===
                    'function') {
                try {
                    var classes =
                        Classes.getCharacterClasses(char) || [];
                    for (var i = 0; i < classes.length; i++) {
                        if (classes[i] &&
                            isNonEmptyString(classes[i].id)) {
                            var cid = String(classes[i].id);
                            if (classIds.indexOf(cid) === -1) {
                                classIds.push(cid);
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            for (var ci = 0; ci < classIds.length; ci++) {
                var classId = classIds[ci];

                var intervals = [];
                try {
                    intervals = Enrol.getStudentDisciplines(
                        charId, classId
                    ) || [];
                } catch (e) {
                    intervals = [];
                }
                if (!Array.isArray(intervals)) {
                    intervals = [];
                }

                var studentDisciplineIds = Object.create(null);
                var instructorDisciplineIds =
                    Object.create(null);

                // Defensive shape handling: an entry may be a
                // discipline-id string (pre-v31) or an object with
                // { disciplineId, role }. Both are accepted.
                for (var ii = 0;
                     ii < intervals.length;
                     ii++) {
                    var iv = intervals[ii];
                    var discId = '';
                    var isInstructor = false;

                    if (typeof iv === 'string') {
                        discId = iv.trim();
                    } else if (iv && typeof iv === 'object' &&
                        isNonEmptyString(iv.disciplineId)) {
                        discId = String(iv.disciplineId).trim();
                        isInstructor =
                            intervalRole(iv) === ROLE_INSTRUCTOR;
                    }

                    if (discId === '') { continue; }

                    if (isInstructor) {
                        instructorDisciplineIds[discId] = true;
                    } else {
                        studentDisciplineIds[discId] = true;
                    }
                }

                var className = '';
                if (Classes &&
                    typeof Classes.getDisplayName ===
                        'function') {
                    try {
                        className =
                            Classes.getDisplayName(classId) ||
                            '';
                    } catch (e) { className = ''; }
                }
                if (!className ||
                    className === 'Unknown Class') {
                    className = 'Unknown Class';
                }

                var studentList =
                    Object.keys(studentDisciplineIds);
                if (studentList.length > 0) {
                    studentList.sort(function(a, b) {
                        var na = '';
                        var nb = '';
                        if (Disciplines &&
                            typeof Disciplines.getDiscipline ===
                                'function') {
                            var da =
                                Disciplines.getDiscipline(a);
                            var db =
                                Disciplines.getDiscipline(b);
                            na = da &&
                                 isNonEmptyString(da.name)
                                ? da.name
                                : a;
                            nb = db &&
                                 isNonEmptyString(db.name)
                                ? db.name
                                : b;
                        } else {
                            na = a; nb = b;
                        }
                        return na.localeCompare(nb);
                    });
                    result.student[classId] = {
                        classId: classId,
                        className: className,
                        disciplineIds: studentList
                    };
                }

                var instructorList =
                    Object.keys(instructorDisciplineIds);
                if (instructorList.length > 0) {
                    instructorList.sort(function(a, b) {
                        var na = '';
                        var nb = '';
                        if (Disciplines &&
                            typeof Disciplines.getDiscipline ===
                                'function') {
                            var da =
                                Disciplines.getDiscipline(a);
                            var db =
                                Disciplines.getDiscipline(b);
                            na = da &&
                                 isNonEmptyString(da.name)
                                ? da.name
                                : a;
                            nb = db &&
                                 isNonEmptyString(db.name)
                                ? db.name
                                : b;
                        } else {
                            na = a; nb = b;
                        }
                        return na.localeCompare(nb);
                    });
                    result.instructor[classId] = {
                        classId: classId,
                        className: className,
                        disciplineIds: instructorList
                    };
                }
            }

            return result;
        }

        function getDisciplineNameSafe(disciplineId) {
            if (!isNonEmptyString(disciplineId)) {
                return 'Unknown Discipline';
            }
            var Disciplines = window.AcademyDisciplines;
            if (Disciplines &&
                typeof Disciplines.getDiscipline ===
                    'function') {
                try {
                    var d =
                        Disciplines.getDiscipline(disciplineId);
                    if (d && isNonEmptyString(d.name)) {
                        return d.name;
                    }
                } catch (e) { /* fall through */ }
            }
            return 'Unknown Discipline';
        }

        function buildClassesStudiedSection(char, charId) {
            var split =
                buildRoleSplitEnrolmentMap(char, charId);
            var classIds = Object.keys(split.student);

            if (classIds.length === 0) {
                return emptySectionBody();
            }

            classIds.sort(function(a, b) {
                return split.student[a].className
                    .localeCompare(
                        split.student[b].className
                    );
            });

            var out = '';
            for (var i = 0; i < classIds.length; i++) {
                var entry = split.student[classIds[i]];
                out += entry.className + ' [' +
                    entry.classId + ']\n';
            }
            return out;
        }

        function buildDisciplinesStudiedSection(char, charId) {
            var split =
                buildRoleSplitEnrolmentMap(char, charId);
            var classIds = Object.keys(split.student);

            if (classIds.length === 0) {
                return emptySectionBody();
            }

            classIds.sort(function(a, b) {
                return split.student[a].className
                    .localeCompare(
                        split.student[b].className
                    );
            });

            var out = '';
            for (var i = 0; i < classIds.length; i++) {
                var entry = split.student[classIds[i]];

                out += entry.className + ' [' +
                    entry.classId + ']\n';

                for (var d = 0;
                     d < entry.disciplineIds.length;
                     d++) {
                    var discId = entry.disciplineIds[d];
                    out += '  ' +
                        getDisciplineNameSafe(discId) + '\n';
                }

                out += '\n';
            }

            return out;
        }

        function buildClassesTaughtSection(char, charId) {
            var split =
                buildRoleSplitEnrolmentMap(char, charId);
            var classIds = Object.keys(split.instructor);

            if (classIds.length === 0) {
                return emptySectionBody();
            }

            classIds.sort(function(a, b) {
                return split.instructor[a].className
                    .localeCompare(
                        split.instructor[b].className
                    );
            });

            var out = '';
            for (var i = 0; i < classIds.length; i++) {
                var entry = split.instructor[classIds[i]];
                out += entry.className + ' [' +
                    entry.classId + ']\n';
            }
            return out;
        }

        function buildDisciplinesTaughtSection(char, charId) {
            var split =
                buildRoleSplitEnrolmentMap(char, charId);
            var classIds = Object.keys(split.instructor);

            if (classIds.length === 0) {
                return emptySectionBody();
            }

            classIds.sort(function(a, b) {
                return split.instructor[a].className
                    .localeCompare(
                        split.instructor[b].className
                    );
            });

            var out = '';
            for (var i = 0; i < classIds.length; i++) {
                var entry = split.instructor[classIds[i]];

                out += entry.className + ' [' +
                    entry.classId + ']\n';

                for (var d = 0;
                     d < entry.disciplineIds.length;
                     d++) {
                    var discId = entry.disciplineIds[d];
                    out += '  ' +
                        getDisciplineNameSafe(discId) + '\n';
                }

                out += '\n';
            }

            return out;
        }

        function buildCommitmentsSection(char, charId) {
            var Commit = window.AcademyInstructorCommitments;
            if (!Commit ||
                typeof Commit.getCommitmentsForInstructor !==
                    'function') {
                return emptySectionBody();
            }

            var commitments = [];
            try {
                commitments =
                    Commit.getCommitmentsForInstructor(charId) ||
                    [];
            } catch (e) { commitments = []; }

            if (commitments.length === 0) {
                return emptySectionBody();
            }

            var out = '';

            for (var i = 0; i < commitments.length; i++) {
                var c = commitments[i];
                if (!c) { continue; }

                var kind = isNonEmptyString(c.kind)
                    ? c.kind
                    : 'commitment';
                var kindLabel = kind === 'officeHours'
                    ? 'Office hours'
                    : (kind === 'tutoring'
                        ? 'Tutoring'
                        : kind);

                var dayLabel = 'Day ' + String(c.day || '?');
                var AC = window.CalendarConstants;
                if (AC && typeof AC.getDayName === 'function') {
                    var dn = AC.getDayName(c.day);
                    if (isNonEmptyString(dn)) {
                        dayLabel = dn;
                    }
                }

                var timeLabel = '';
                if (isFiniteNumber(c.startTime)) {
                    var start = padZeros(c.startTime, 2);
                    var duration = isFiniteNumber(c.duration)
                        ? c.duration
                        : 1;
                    var end = padZeros(
                        c.startTime + duration, 2
                    );
                    timeLabel =
                        start + ':00\u2013' + end + ':00';
                }

                var lineLabel = kindLabel + ': ' + dayLabel;
                if (timeLabel) {
                    lineLabel += ' ' + timeLabel;
                }

                out += lineLabel + '\n';

                if (isNonEmptyString(c.characterId)) {
                    out += indentedLine(
                        'With',
                        resolveCharName(c.characterId)
                    );
                }
                if (isNonEmptyString(c.label)) {
                    out += indentedLine('Label', c.label);
                }
                if (isNonEmptyString(c.locationId)) {
                    var Loc = window.LocationQueries;
                    if (Loc &&
                        typeof Loc.getLocationName ===
                            'function') {
                        out += indentedLine(
                            'Location',
                            Loc.getLocationName(c.locationId)
                        );
                    }
                }
                out += indentedLine(
                    'Period',
                    formatWeekRange(c.startWeek, c.endWeek)
                );
            }

            return out;
        }

        function resolveCharName(charId) {
            var CharacterQueries = getCharacterQueries();
            if (!isNonEmptyString(charId)) { return 'Unknown'; }
            var c = null;
            try {
                c = CharacterQueries.getCharacterById(charId);
            } catch (e) { c = null; }
            if (!c) { return String(charId); }
            try {
                return CharacterQueries.getDisplayName(c) ||
                    String(charId);
            } catch (e) {
                return String(charId);
            }
        }

        function buildTeamMemberBlock(team, charId) {
            var TeamQueries = window.TeamQueries;
            if (!TeamQueries ||
                typeof TeamQueries.getAllTeamMemberRecords !==
                    'function') {
                return '';
            }

            var records = [];
            try {
                records =
                    TeamQueries.getAllTeamMemberRecords(team) ||
                    [];
            } catch (e) {
                records = [];
            }

            var out = '';
            for (var r = 0; r < records.length; r++) {
                var rec = records[r];
                if (!rec) { continue; }
                if (String(rec.characterId) !== String(charId)) {
                    continue;
                }

                if (isNonEmptyString(rec.role) &&
                    rec.role !== 'Member') {
                    out += indentedLine('Role', rec.role);
                }

                if (Array.isArray(rec.intervals)) {
                    for (var iv = 0;
                         iv < rec.intervals.length;
                         iv++) {
                        var interval = rec.intervals[iv];
                        if (!interval) { continue; }

                        var range = isAcademicTeamType(team.type)
                            ? formatWeekRange(
                                interval.joinPeriod,
                                interval.leavePeriod
                            )
                            : formatYearRange(
                                interval.joinPeriod,
                                interval.leavePeriod
                            );

                        out += indentedLine('Stint', range);
                    }
                }
            }

            return out;
        }

        function buildAcademicTeamsGroup(academicTeams, charId) {
            var Classes = window.AcademyClasses;
            var byClass = Object.create(null);
            var classOrder = [];

            for (var i = 0; i < academicTeams.length; i++) {
                var team = academicTeams[i];
                if (!team || !team.id) { continue; }

                var classId = isNonEmptyString(team.classId)
                    ? String(team.classId)
                    : '__unassigned__';

                if (!byClass[classId]) {
                    byClass[classId] = [];
                    classOrder.push(classId);
                }
                byClass[classId].push(team);
            }

            classOrder.sort(function(a, b) {
                if (a === '__unassigned__') { return 1; }
                if (b === '__unassigned__') { return -1; }

                var nameA = '';
                var nameB = '';
                if (Classes &&
                    typeof Classes.getDisplayName ===
                        'function') {
                    try {
                        nameA =
                            Classes.getDisplayName(a) || '';
                    } catch (e) { nameA = ''; }
                    try {
                        nameB =
                            Classes.getDisplayName(b) || '';
                    } catch (e) { nameB = ''; }
                }
                if (!nameA) { nameA = a; }
                if (!nameB) { nameB = b; }
                return nameA.localeCompare(nameB);
            });

            var out = '';

            for (var c = 0; c < classOrder.length; c++) {
                var cid = classOrder[c];
                var teams = byClass[cid];

                var heading;
                if (cid === '__unassigned__') {
                    heading = '(Unassigned)';
                } else if (Classes &&
                           typeof Classes.getDisplayName ===
                               'function') {
                    try {
                        heading =
                            Classes.getDisplayName(cid) || cid;
                    } catch (e) {
                        heading = cid;
                    }
                } else {
                    heading = cid;
                }

                out += '  ' + heading + ':\n';

                teams.sort(function(a, b) {
                    return (a.name || '').localeCompare(
                        b.name || ''
                    );
                });

                for (var t = 0; t < teams.length; t++) {
                    var team = teams[t];
                    var name = isNonEmptyString(team.name)
                        ? team.name
                        : 'Unnamed Team';

                    out += '    ' + name + ' [' +
                        team.id + ']\n';

                    var memberBlock =
                        buildTeamMemberBlock(team, charId);
                    if (memberBlock) {
                        out += memberBlock
                            .split('\n')
                            .filter(function(l) {
                                return l !== '';
                            })
                            .map(function(l) {
                                return '  ' + l;
                            })
                            .join('\n') + '\n';
                    }
                }
            }

            return out;
        }

        function buildNonAcademicTeamsGroup(
            typeLabel, teams, charId
        ) {
            var displayType = isNonEmptyString(typeLabel)
                ? typeLabel.charAt(0).toUpperCase() +
                  typeLabel.slice(1)
                : 'Other';

            teams.sort(function(a, b) {
                return (a.name || '').localeCompare(
                    b.name || ''
                );
            });

            var out = '';
            out += displayType + ':\n';

            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                var name = isNonEmptyString(team.name)
                    ? team.name
                    : 'Unnamed Team';

                out += '  ' + name + ' [' +
                    team.id + ']\n';

                var memberBlock =
                    buildTeamMemberBlock(team, charId);
                if (memberBlock) {
                    out += memberBlock;
                }
            }

            return out;
        }

        function buildTeamsSection(char, charId) {
            var TeamQueries = window.TeamQueries;
            if (!TeamQueries ||
                typeof TeamQueries
                    .getTeamsForCharacterAllTimeIncludingDeprecated !==
                    'function') {
                return emptySectionBody();
            }

            var teams = [];
            try {
                teams = TeamQueries
                    .getTeamsForCharacterAllTimeIncludingDeprecated(
                        charId
                    ) || [];
            } catch (e) { teams = []; }

            var professional = [];
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                if (!team) { continue; }
                if (team.type === 'professional') {
                    professional.push(team);
                }
            }

            if (professional.length === 0) {
                return emptySectionBody();
            }

            return buildNonAcademicTeamsGroup(
                'professional', professional, charId
            );
        }

        function buildSocialSection(char, charId) {
            var SA = window.SocialAggregator;
            if (!SA ||
                typeof SA.getCharacterRelationshipsViewModel !==
                    'function') {
                return emptySectionBody();
            }

            var vm = null;
            try {
                vm = SA.getCharacterRelationshipsViewModel(
                    charId
                );
            } catch (e) {
                console.warn(
                    '[CharacterExport] ' +
                    'getCharacterRelationshipsViewModel ' +
                    'threw:', e
                );
                vm = null;
            }

            if (!vm ||
                !Array.isArray(vm.relationships) ||
                vm.relationships.length === 0) {
                return emptySectionBody();
            }

            var out = '';

            out += 'Relationships:\n';
            for (var i = 0; i < vm.relationships.length; i++) {
                var rel = vm.relationships[i];
                if (!rel) { continue; }

                var lineText = '  ' +
                    (rel.otherCharName || 'Unknown');

                if (isNonEmptyString(rel.typeLabel)) {
                    lineText += ' \u2014 ' + rel.typeLabel;
                }
                if (isNonEmptyString(rel.clarification)) {
                    lineText += ' (' + rel.clarification + ')';
                }
                if (isNonEmptyString(rel.period)) {
                    lineText += ' \u00b7 ' + rel.period;
                }
                out += lineText + '\n';

                if (isNonEmptyString(rel.notes)) {
                    out += '      ' + String(rel.notes)
                        .replace(/\s+/g, ' ').trim() + '\n';
                }
            }

            return out;
        }

        function buildMissionsSection(char, charId) {
            var MQ = window.MissionQueries;
            if (!MQ ||
                typeof MQ.getMissionsForCharacter !==
                    'function') {
                return emptySectionBody();
            }

            var entries = [];
            try {
                entries =
                    MQ.getMissionsForCharacter(charId) || [];
            } catch (e) {
                console.warn(
                    '[CharacterExport] ' +
                    'getMissionsForCharacter threw:', e
                );
                entries = [];
            }

            if (entries.length === 0) {
                return emptySectionBody();
            }

            var byTeam = Object.create(null);
            var teamOrder = [];
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!entry) { continue; }
                var tid = entry.teamId || 'unknown';
                if (!byTeam[tid]) {
                    byTeam[tid] = {
                        teamName: entry.teamName ||
                            'Unnamed Team',
                        missions: []
                    };
                    teamOrder.push(tid);
                }
                byTeam[tid].missions.push(entry.mission);
            }

            var out = '';
            var MC = window.MissionConstants;

            for (var t = 0; t < teamOrder.length; t++) {
                var tid2 = teamOrder[t];
                var group = byTeam[tid2];

                out += 'Via ' + group.teamName + ':\n';

                for (var m = 0;
                     m < group.missions.length;
                     m++) {
                    var mission = group.missions[m];
                    if (!mission) { continue; }

                    var title = isNonEmptyString(mission.title)
                        ? mission.title
                        : 'Untitled';

                    var status = isNonEmptyString(mission.status)
                        ? mission.status
                        : '';

                    var statusLabel = status;
                    if (MC &&
                        typeof MC.getStatusLabel ===
                            'function' &&
                        status) {
                        var sl = MC.getStatusLabel(status);
                        if (isNonEmptyString(sl)) {
                            statusLabel = sl;
                        }
                    }

                    var bits = [title];
                    if (statusLabel) {
                        bits.push('[' + statusLabel + ']');
                    }
                    if (mission.archivedAt) {
                        bits.push('(archived)');
                    }

                    out += '  ' + bits.join(' ') + '\n';

                    if (isNonEmptyString(mission.location)) {
                        out += indentedLine(
                            'Location', mission.location
                        );
                    }
                    if (isNonEmptyString(mission.description)) {
                        out += '      ' +
                            String(mission.description)
                                .replace(/\s+/g, ' ')
                                .trim() + '\n';
                    }
                }

                out += '\n';
            }

            return out;
        }

        function buildTournamentsSection(char, charId) {
            var out = '';

            var eliminationLines = [];

            if (Array.isArray(char.eliminations)) {
                for (var i = 0;
                     i < char.eliminations.length;
                     i++) {
                    var elim = char.eliminations[i];
                    if (!elim) { continue; }

                    var year = isNonEmptyString(elim.year)
                        ? String(elim.year)
                        : '';
                    var week = isFiniteNumber(elim.week) ||
                        isNonEmptyString(elim.week)
                        ? String(elim.week)
                        : '';
                    var reason = isNonEmptyString(elim.reason)
                        ? String(elim.reason)
                        : '';

                    var bits = [];
                    if (year) { bits.push('Year ' + year); }
                    if (week) { bits.push('Week ' + week); }

                    var source = '';
                    if (elim.standalone) {
                        source = 'standalone';
                    } else if (elim.fromMatch) {
                        source = 'tournament';
                    }

                    var lineText = bits.join(', ') ||
                        '(undated)';
                    if (source) {
                        lineText += ' \u2014 ' + source;
                    }
                    if (reason) {
                        lineText += ': ' + reason;
                    }

                    eliminationLines.push(lineText);
                }
            }

            if (eliminationLines.length > 0) {
                out += 'Eliminations:\n';
                for (var el = 0;
                     el < eliminationLines.length;
                     el++) {
                    out += '  ' + eliminationLines[el] + '\n';
                }
            }

            var Ranking = window.AcademyRanking;
            var Classes = window.AcademyClasses;
            var rankLines = [];

            if (Ranking &&
                typeof Ranking.getRankingRecords ===
                    'function' &&
                Classes &&
                typeof Classes.getCharacterClasses ===
                    'function') {

                var classes = [];
                try {
                    classes =
                        Classes.getCharacterClasses(char) || [];
                } catch (e) { classes = []; }

                for (var c = 0; c < classes.length; c++) {
                    var cls = classes[c];
                    if (!cls || !cls.id) { continue; }
                    var className = isNonEmptyString(cls.name)
                        ? cls.name
                        : 'Unnamed Class';

                    var records = [];
                    try {
                        records =
                            Ranking.getRankingRecords(cls.id) ||
                            [];
                    } catch (e) { records = []; }

                    for (var r = 0; r < records.length; r++) {
                        var ranking = records[r];
                        if (!ranking) { continue; }
                        if (String(ranking.studentId) !==
                            String(charId)) {
                            continue;
                        }

                        var week2 = isFiniteNumber(ranking.week)
                            ? String(ranking.week)
                            : '?';

                        var lineText = '  ' + className +
                            ', Week ' + week2 + ': ' +
                            'rank ' + String(ranking.rank || '?');

                        if (isFiniteNumber(
                            ranking.totalStudents
                        ) && ranking.totalStudents > 0) {
                            lineText += ' of ' +
                                ranking.totalStudents;
                        }
                        if (isFiniteNumber(
                            ranking.overallScore
                        )) {
                            lineText += ', overall ' +
                                ranking.overallScore;
                        } else if (isFiniteNumber(
                            ranking.academicAverage
                        )) {
                            lineText += ', academic ' +
                                ranking.academicAverage;
                        }

                        rankLines.push(lineText);
                    }
                }
            }

            if (rankLines.length > 0) {
                out += '\n';
                out += 'Rankings:\n';
                out += rankLines.join('\n') + '\n';
            }

            if (out === '') {
                return emptySectionBody();
            }
            return out;
        }

        function buildAcademyHistorySection(char, charId) {
            var Classes = window.AcademyClasses;
            if (!Classes ||
                typeof Classes.getClasses !== 'function') {
                return emptySectionBody();
            }

            var all = [];
            try {
                all = Classes.getClasses() || [];
            } catch (e) { all = []; }

            var charClassIds = getClassIdsForCharacter(char);
            var out = '';
            var any = false;

            for (var i = 0; i < all.length; i++) {
                var cls = all[i];
                if (!cls) { continue; }
                if (cls.status !== 'graduated') { continue; }

                var belongs = false;
                for (var ci = 0;
                     ci < charClassIds.length;
                     ci++) {
                    if (String(charClassIds[ci]) ===
                        String(cls.id)) {
                        belongs = true;
                        break;
                    }
                }
                if (!belongs) { continue; }

                any = true;

                var className = isNonEmptyString(cls.name)
                    ? cls.name
                    : 'Unnamed Class';

                var year = isFiniteNumber(cls.year)
                    ? String(cls.year)
                    : (isNonEmptyString(cls.year)
                        ? cls.year
                        : '');

                var heading = 'Graduated from ' + className;
                if (year) {
                    heading += ' in ' + year;
                }

                out += heading + '\n';
                out += indentedLine('Class ID', cls.id);
                out += indentedLine('Status', cls.status);
            }

            if (!any) {
                return emptySectionBody();
            }
            return out;
        }

        function buildDepartmentsSection(char, charId) {
            var DQ = window.DepartmentQueries;
            if (!DQ ||
                typeof DQ.getDepartmentsForCharacter !==
                    'function' ||
                typeof DQ.getMemberEntry !== 'function') {
                return emptySectionBody();
            }

            var currentYear = null;
            if (window.data &&
                isFiniteNumber(window.data.currentYear) &&
                window.data.currentYear > 0) {
                currentYear = Math.floor(window.data.currentYear);
            }
            if (currentYear === null) {
                return emptySectionBody();
            }

            var departments = [];
            try {
                departments = DQ.getDepartmentsForCharacter(
                    charId, currentYear
                ) || [];
            } catch (e) {
                console.warn(
                    '[CharacterExport] ' +
                    'getDepartmentsForCharacter threw:', e
                );
                departments = [];
            }

            if (!Array.isArray(departments) ||
                departments.length === 0) {
                return emptySectionBody();
            }

            var rows = [];
            for (var i = 0; i < departments.length; i++) {
                var dept = departments[i];
                if (!dept || !dept.id) { continue; }

                var entry = null;
                try {
                    entry = DQ.getMemberEntry(dept, charId);
                } catch (e) {
                    entry = null;
                }

                var joinYear = null;
                if (entry && Array.isArray(entry.intervals)) {
                    for (var j = 0;
                         j < entry.intervals.length;
                         j++) {
                        var iv = entry.intervals[j];
                        if (!iv || typeof iv !== 'object') {
                            continue;
                        }
                        var y = parseInt(iv.joinPeriod, 10);
                        if (isNaN(y)) { continue; }
                        if (joinYear === null || y < joinYear) {
                            joinYear = y;
                        }
                    }
                }

                var isHead = dept.headId &&
                    String(dept.headId) === String(charId);

                rows.push({
                    name: isNonEmptyString(dept.name)
                        ? dept.name
                        : 'Unnamed Department',
                    joinYear: joinYear,
                    isHead: isHead
                });
            }

            if (rows.length === 0) {
                return emptySectionBody();
            }

            rows.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            var out = '';
            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];

                var lineText = '  ' + row.name;
                if (row.isHead) {
                    lineText += ' (Head)';
                }
                if (row.joinYear !== null) {
                    lineText += ' \u00b7 Since ' +
                        String(row.joinYear);
                }
                out += lineText + '\n';
            }
            return out;
        }

        function buildCharacterReport(charId) {
            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries) {
                return null;
            }

            var char = null;
            try {
                char = CharacterQueries.getCharacterById(charId);
            } catch (e) { char = null; }

            if (!char) { return null; }

            var displayName = '';
            try {
                displayName =
                    CharacterQueries.getDisplayName(char) || '';
            } catch (e) { displayName = ''; }

            var out = '';

            out += BANNER + '\n';
            out += 'CHARACTER REPORT \u2014 ' +
                (displayName || 'Unknown') + '\n';
            out += 'Generated: ' +
                new Date().toISOString() + '\n';
            out += BANNER + '\n\n';

            out += sectionHeader('AT A GLANCE');
            out += buildAtAGlanceSection(char, charId);
            out += '\n';

            out += sectionHeader('TIMELINE');
            out += buildTimelineSection(char, charId);
            out += '\n';

            out += sectionHeader('IDENTITY');
            out += buildIdentitySection(char, charId);
            out += '\n';

            out += sectionHeader('CLASSES STUDIED');
            out += buildClassesStudiedSection(char, charId);
            out += '\n';

            out += sectionHeader('DISCIPLINES STUDIED');
            out += buildDisciplinesStudiedSection(
                char, charId
            );
            out += '\n';

            out += sectionHeader('CLASSES TAUGHT');
            out += buildClassesTaughtSection(char, charId);
            out += '\n';

            out += sectionHeader('DISCIPLINES TAUGHT');
            out += buildDisciplinesTaughtSection(char, charId);
            out += '\n';

            out += sectionHeader('COMMITMENTS');
            out += buildCommitmentsSection(char, charId);
            out += '\n';

            out += sectionHeader('TEAMS');
            out += buildTeamsSection(char, charId);
            out += '\n';

            out += sectionHeader('DEPARTMENTS');
            out += buildDepartmentsSection(char, charId);
            out += '\n';

            out += sectionHeader('SOCIAL');
            out += buildSocialSection(char, charId);
            out += '\n';

            out += sectionHeader('MISSIONS');
            out += buildMissionsSection(char, charId);
            out += '\n';

            out += sectionHeader('TOURNAMENTS / EXAMS');
            out += buildTournamentsSection(char, charId);
            out += '\n';

            out += sectionHeader('ACADEMY HISTORY');
            out += buildAcademyHistorySection(char, charId);
            out += '\n';

            out += BANNER + '\n';
            out += 'END OF REPORT\n';
            out += 'Character ID: ' + String(charId) + '\n';
            out += 'File generated by Hollow Manager 2\n';
            out += BANNER + '\n';

            return {
                char: char,
                displayName: displayName,
                text: out
            };
        }

        function getCharacterReportText(charId) {
            if (!isNonEmptyString(charId)) { return ''; }
            var built = buildCharacterReport(charId);
            if (!built) { return ''; }
            return built.text;
        }

        function exportCharacterText(charId, options) {
            options = options || {};

            requireExportUtils(
                'CharacterExport.exportCharacterText'
            );

            if (!isNonEmptyString(charId)) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Character ID is required.'
                };
            }

            var built = null;
            try {
                built = buildCharacterReport(String(charId));
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to build report: ' +
                        e.message
                };
            }

            if (!built) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Character not found.'
                };
            }

            var slug = sanitiseForFilename(built.displayName);
            var filename = options.filename ||
                FILENAME_PREFIX + '-' + slug + '-' +
                String(charId) + '.txt';

            var blob;
            try {
                blob = new Blob([built.text], {
                    type: 'text/plain;charset=utf-8'
                });
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to build file blob: ' +
                        e.message
                };
            }

            try {
                getExportUtils().downloadBlob(blob, filename);
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to download: ' + e.message
                };
            }

            return {
                exported: true,
                filename: filename,
                error: null
            };
        }

        function exportSelectedText(charIds, options) {
            options = options || {};

            requireExportUtils(
                'CharacterExport.exportSelectedText'
            );

            if (!Array.isArray(charIds)) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'characterIds must be an array.'
                };
            }

            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries ||
                typeof CharacterQueries.getCharacterById !==
                    'function') {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'CharacterQueries is not available.'
                };
            }

            var resolved = [];
            var seen = Object.create(null);

            for (var i = 0; i < charIds.length; i++) {
                if (charIds[i] === null ||
                    charIds[i] === undefined) {
                    continue;
                }
                var idStr = String(charIds[i]);
                if (idStr === '' || seen[idStr]) { continue; }
                seen[idStr] = true;

                var c = null;
                try {
                    c = CharacterQueries.getCharacterById(idStr);
                } catch (e) {
                    c = null;
                }
                if (c) {
                    var display = idStr;
                    try {
                        display = CharacterQueries
                            .getDisplayName(c) || idStr;
                    } catch (e) {
                        display = idStr;
                    }
                    resolved.push({
                        id: idStr,
                        name: display
                    });
                }
            }

            if (resolved.length === 0) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'No characters to export.'
                };
            }

            resolved.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            var parts = [];
            var count = 0;

            for (var r = 0; r < resolved.length; r++) {
                var built = null;
                try {
                    built = buildCharacterReport(resolved[r].id);
                } catch (e) {
                    built = null;
                }
                if (!built) { continue; }
                parts.push(built.text);
                count++;
            }

            if (count === 0) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'No reports could be built.'
                };
            }

            var now = new Date();
            var iso = now.toISOString();
            var outer = '';
            outer += BANNER + '\n';
            outer += 'BULK CHARACTER REPORT \u2014 ' + count +
                ' character' + (count === 1 ? '' : 's') + '\n';
            outer += 'Generated: ' + iso + '\n';
            outer += BANNER + '\n\n';

            var content = outer +
                parts.join('\n\n');

            var filename = isNonEmptyString(options.filename)
                ? String(options.filename)
                : ('characters-report-' +
                    iso.slice(0, 10) + '-' +
                    count + '.txt');

            var blob;
            try {
                blob = new Blob([content], {
                    type: 'text/plain;charset=utf-8'
                });
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    count: count,
                    error: 'Failed to build file blob: ' +
                        e.message
                };
            }

            try {
                getExportUtils().downloadBlob(blob, filename);
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    count: count,
                    error: 'Failed to download: ' + e.message
                };
            }

            return {
                exported: true,
                filename: filename,
                count: count,
                error: null
            };
        }

        function buildGeneralIdentitySection(char, charId) {
            var CharacterQueries = getCharacterQueries();
            var out = '';

            var displayName = '';
            try {
                displayName =
                    CharacterQueries.getDisplayName(char) || '';
            } catch (e) { displayName = ''; }
            out += line('Display name', displayName);

            if (isNonEmptyString(char.firstName)) {
                out += line('First name', char.firstName);
            }
            if (isNonEmptyString(char.middleName)) {
                out += line('Middle name', char.middleName);
            }
            if (isNonEmptyString(char.lastName)) {
                out += line('Last name', char.lastName);
            }
            if (isNonEmptyString(char.nickname)) {
                out += line('Nickname', char.nickname);
            }
            if (isNonEmptyString(char.gender)) {
                out += line('Gender', char.gender);
            }

            if (isNonEmptyString(char.birthYear)) {
                out += line('Year of birth', char.birthYear);
            }

            var deceased = false;
            try {
                if (typeof CharacterQueries.isDeceased ===
                    'function') {
                    deceased =
                        CharacterQueries.isDeceased(char) === true;
                }
            } catch (e) { deceased = false; }

            if (deceased && isNonEmptyString(char.deathYear)) {
                out += line('Year of death', char.deathYear);
            }

            if (out === '') {
                return emptySectionBody();
            }
            return out;
        }

        function buildGeneralClassesSection(char) {
            var Classes = window.AcademyClasses;
            if (!Classes ||
                typeof Classes.getDisplayName !== 'function') {
                return emptySectionBody();
            }

            var classIds = getClassIdsForCharacter(char);

            if (classIds.length === 0) {
                return emptySectionBody();
            }

            var seen = Object.create(null);
            var names = [];

            for (var i = 0; i < classIds.length; i++) {
                var idStr = String(classIds[i]);
                if (idStr === '' || seen[idStr]) { continue; }
                seen[idStr] = true;

                var className = '';
                try {
                    className =
                        Classes.getDisplayName(idStr) || '';
                } catch (e) {
                    className = '';
                }

                if (!isNonEmptyString(className) ||
                    className === 'Unknown Class') {
                    names.push('Unknown Class [' + idStr + ']');
                } else {
                    names.push(className);
                }
            }

            if (names.length === 0) {
                return emptySectionBody();
            }

            names.sort(function(a, b) {
                return a.localeCompare(b);
            });

            var out = '';
            for (var n = 0; n < names.length; n++) {
                out += '  ' + names[n] + '\n';
            }
            return out;
        }

        function buildGeneralCareerSection(char) {
            var careerStatus = Array.isArray(char.careerStatus)
                ? char.careerStatus
                : [];

            if (careerStatus.length === 0) {
                return emptySectionBody();
            }

            var rows = [];
            for (var i = 0; i < careerStatus.length; i++) {
                var entry = careerStatus[i];
                if (!entry || typeof entry !== 'object') {
                    continue;
                }

                var status = isNonEmptyString(entry.status)
                    ? entry.status
                    : 'unknown';

                var period = formatYearRange(
                    entry.startYear, entry.endYear
                );

                var title = isNonEmptyString(entry.title)
                    ? ' [' + entry.title + ']'
                    : '';

                var lineText = '  ' + status;
                if (period) {
                    lineText += ' (' + period + ')';
                }
                lineText += title;

                rows.push({
                    sortYear: parseInt(entry.startYear, 10),
                    text: lineText
                });
            }

            if (rows.length === 0) {
                return emptySectionBody();
            }

            rows.sort(function(a, b) {
                var ay = isNaN(a.sortYear) ? Infinity : a.sortYear;
                var by = isNaN(b.sortYear) ? Infinity : b.sortYear;
                if (ay !== by) { return ay - by; }
                return a.text.localeCompare(b.text);
            });

            var out = '';
            for (var r = 0; r < rows.length; r++) {
                out += rows[r].text + '\n';
            }
            return out;
        }

        function buildGeneralReport(charId) {
            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries) { return null; }

            var char = null;
            try {
                char = CharacterQueries.getCharacterById(charId);
            } catch (e) { char = null; }
            if (!char) { return null; }

            var displayName = '';
            try {
                displayName =
                    CharacterQueries.getDisplayName(char) || '';
            } catch (e) { displayName = ''; }

            var out = '';

            out += BANNER + '\n';
            out += 'GENERAL REPORT \u2014 ' +
                (displayName || 'Unknown') + '\n';
            out += 'Generated: ' +
                new Date().toISOString() + '\n';
            out += BANNER + '\n\n';

            out += sectionHeader('IDENTITY');
            out += buildGeneralIdentitySection(char, charId);
            out += '\n';

            var physical = buildIdentityPhysicalGroup(char);
            if (physical) {
                out += sectionHeader('PHYSICAL');
                out += physical;
                out += '\n';
            }

            var personality = buildIdentityPersonalityGroup(char);
            if (personality) {
                out += sectionHeader('PERSONALITY');
                out += personality;
                out += '\n';
            }

            var combat = buildIdentityCombatGroup(char);
            if (combat) {
                out += sectionHeader('COMBAT');
                out += combat;
                out += '\n';
            }

            out += sectionHeader('ACADEMIC CLASSES');
            out += buildGeneralClassesSection(char);
            out += '\n';

            out += sectionHeader('PROFESSIONAL TEAMS');
            out += buildTeamsSection(char, charId);
            out += '\n';

            out += sectionHeader('CAREER STATUS');
            out += buildGeneralCareerSection(char);
            out += '\n';

            out += sectionHeader('DEPARTMENTS');
            out += buildDepartmentsSection(char, charId);
            out += '\n';

            out += sectionHeader('SOCIAL');
            out += buildSocialSection(char, charId);
            out += '\n';

            out += BANNER + '\n';
            out += 'END OF REPORT\n';
            out += 'Character ID: ' + String(charId) + '\n';
            out += 'File generated by Hollow Manager 2\n';
            out += BANNER + '\n';

            return {
                char: char,
                displayName: displayName,
                text: out
            };
        }

        function getGeneralReportText(charId) {
            if (!isNonEmptyString(charId)) { return ''; }
            var built = buildGeneralReport(charId);
            if (!built) { return ''; }
            return built.text;
        }

        function exportGeneralText(charId, options) {
            options = options || {};

            requireExportUtils(
                'CharacterExport.exportGeneralText'
            );

            if (!isNonEmptyString(charId)) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Character ID is required.'
                };
            }

            var built = null;
            try {
                built = buildGeneralReport(String(charId));
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to build report: ' +
                        e.message
                };
            }

            if (!built) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Character not found.'
                };
            }

            var slug = sanitiseForFilename(built.displayName);
            var filename = options.filename ||
                FILENAME_PREFIX + '-general-' + slug +
                '-' + String(charId) + '.txt';

            var blob;
            try {
                blob = new Blob([built.text], {
                    type: 'text/plain;charset=utf-8'
                });
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to build file blob: ' +
                        e.message
                };
            }

            try {
                getExportUtils().downloadBlob(blob, filename);
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    error: 'Failed to download: ' + e.message
                };
            }

            return {
                exported: true,
                filename: filename,
                error: null
            };
        }

        function exportGeneralSelectedText(charIds, options) {
            options = options || {};

            requireExportUtils(
                'CharacterExport.exportGeneralSelectedText'
            );

            if (!Array.isArray(charIds)) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'characterIds must be an array.'
                };
            }

            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries ||
                typeof CharacterQueries.getCharacterById !==
                    'function') {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'CharacterQueries is not available.'
                };
            }

            var resolved = [];
            var seen = Object.create(null);

            for (var i = 0; i < charIds.length; i++) {
                if (charIds[i] === null ||
                    charIds[i] === undefined) {
                    continue;
                }
                var idStr = String(charIds[i]);
                if (idStr === '' || seen[idStr]) { continue; }
                seen[idStr] = true;

                var c = null;
                try {
                    c = CharacterQueries.getCharacterById(idStr);
                } catch (e) {
                    c = null;
                }
                if (c) {
                    var display = idStr;
                    try {
                        display = CharacterQueries
                            .getDisplayName(c) || idStr;
                    } catch (e) {
                        display = idStr;
                    }
                    resolved.push({
                        id: idStr,
                        name: display
                    });
                }
            }

            if (resolved.length === 0) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'No characters to export.'
                };
            }

            resolved.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            var parts = [];
            var count = 0;

            for (var r = 0; r < resolved.length; r++) {
                var built = null;
                try {
                    built = buildGeneralReport(resolved[r].id);
                } catch (e) {
                    built = null;
                }
                if (!built) { continue; }
                parts.push(built.text);
                count++;
            }

            if (count === 0) {
                return {
                    exported: false,
                    filename: null,
                    count: 0,
                    error: 'No reports could be built.'
                };
            }

            var now = new Date();
            var iso = now.toISOString();
            var outer = '';
            outer += BANNER + '\n';
            outer += 'BULK GENERAL REPORT \u2014 ' + count +
                ' character' + (count === 1 ? '' : 's') + '\n';
            outer += 'Generated: ' + iso + '\n';
            outer += BANNER + '\n\n';

            var content = outer + parts.join('\n\n');

            var filename = isNonEmptyString(options.filename)
                ? String(options.filename)
                : ('characters-general-' +
                    iso.slice(0, 10) + '-' +
                    count + '.txt');

            var blob;
            try {
                blob = new Blob([content], {
                    type: 'text/plain;charset=utf-8'
                });
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    count: count,
                    error: 'Failed to build file blob: ' +
                        e.message
                };
            }

            try {
                getExportUtils().downloadBlob(blob, filename);
            } catch (e) {
                return {
                    exported: false,
                    filename: null,
                    count: count,
                    error: 'Failed to download: ' + e.message
                };
            }

            return {
                exported: true,
                filename: filename,
                count: count,
                error: null
            };
        }

        window.CharacterExport = Object.freeze({
            getCharacterReportText: getCharacterReportText,
            exportCharacterText: exportCharacterText,
            exportSelectedText: exportSelectedText,

            getGeneralReportText: getGeneralReportText,
            exportGeneralText: exportGeneralText,
            exportGeneralSelectedText: exportGeneralSelectedText
        });

    })();

    // ============================================================
    // BUNDLE VERIFICATION
    // ============================================================

    (function verify() {
        var missing = [];

        if (!window.CharacterCSV ||
            typeof window.CharacterCSV.export !== 'function' ||
            typeof window.CharacterCSV.import !== 'function') {
            missing.push('CharacterCSV.export/import');
        }
        if (!window.CharacterRosterExport ||
            typeof window.CharacterRosterExport.exportText !==
                'function') {
            missing.push('CharacterRosterExport.exportText');
        }
        if (!window.CharacterRosterExport ||
            typeof window.CharacterRosterExport.exportSelectedText !==
                'function') {
            missing.push('CharacterRosterExport.exportSelectedText');
        }
        if (!window.CharacterExport ||
            typeof window.CharacterExport.exportCharacterText !==
                'function') {
            missing.push('CharacterExport.exportCharacterText');
        }
        if (!window.CharacterExport ||
            typeof window.CharacterExport.exportSelectedText !==
                'function') {
            missing.push('CharacterExport.exportSelectedText');
        }
        if (!window.CharacterExport ||
            typeof window.CharacterExport.exportGeneralText !==
                'function') {
            missing.push('CharacterExport.exportGeneralText');
        }
        if (!window.CharacterExport ||
            typeof window.CharacterExport.exportGeneralSelectedText !==
                'function') {
            missing.push(
                'CharacterExport.exportGeneralSelectedText'
            );
        }

        if (typeof window.downloadCharacterCSVTemplate !==
            'function') {
            missing.push('downloadCharacterCSVTemplate alias');
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterExport] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
