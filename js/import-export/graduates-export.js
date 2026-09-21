/**
 * js/import-export/graduates-export.js - Graduates Export
 * Exports the characters who GRADUATED from a class.
 *
 * Path: js/import-export/graduates-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "graduates of class X".
 *   A graduate is a roster member of the class who was NOT
 *   eliminated as of the class's graduation year.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class entity             (AcademyClasses)
 *   - The roster derivation        (AcademyAggregator)
 *   - Elimination semantics        (EliminationQueries)
 *   - Character data               (CharacterQueries)
 *   - CSV parsing                  (CSV)
 *   - Envelope creation            (ExportEnvelope)
 *   - File download                (ExportUtils)
 *
 * SCOPE:
 *   Academy is used ONLY to determine WHICH characters appear in
 *   the export. Once the graduate list is resolved, every column
 *   comes from the character record via CharacterQueries.
 *   No academic data — no grades, no enrolments, no teams, no
 *   rankings, no eliminations — is included in the output.
 *
 * GRADUATION YEAR:
 *   Resolution order:
 *     1. options.graduationYear (integer >= 1)
 *     2. class.year           (the class record's own year)
 *     3. window.data.currentYear
 *     4. the current calendar year
 *
 *   A character is a graduate when
 *     EliminationQueries.isCharacterEliminatedByYear(charId, year)
 *   returns false. This matches the character list's existing
 *   year-scoped elimination filter.
 *
 *   When EliminationQueries is unavailable, this module refuses to
 *   guess: every roster member is treated as NOT a graduate. A
 *   fail-closed answer is the honest one; "everyone passed" would
 *   be a lie.
 *
 * OUTPUT SHAPES:
 *
 *   getGraduates(classId, options) ->
 *     {
 *       classId,
 *       className,
 *       graduationYear,
 *       graduates: [GraduateRecord, ...]
 *     }
 *
 *   GraduateRecord:
 *     {
 *       id,                          // character id
 *       // name
 *       firstName, middleName, lastName, nickname, alias,
 *       previousNames: [string],
 *       displayName,                 // from CharacterQueries
 *       // life
 *       age, birthYear, gender, attraction, sexuality,
 *       // physical
 *       eyes, hair, skin, height, weight, build, appearanceNotes,
 *       // personality (flattened)
 *       traits, ideals, bonds, flaws, alignment,
 *       likes, dislikes, habits, fears, goals,
 *       // combat
 *       stats,                       // { str, dex, ... }
 *       magic,                       // { fire, water, ... }
 *       hp, mp,
 *       weapons,                     // [{ id, name, type, notes }]
 *       specialMoves,                // { physical: [...], magical: [...] }
 *       combatNotes
 *     }
 *
 *   exportGraduatesJSON(classId, options) ->
 *     Promise<{ exported, filename, count, error?, wasEnveloped }>
 *     The envelope is created via ExportEnvelope.create with
 *     { graduates: [...] } as the data payload.
 *
 *   exportGraduatesCSV(classId, options) ->
 *     { exported, filename, count, error? }
 *
 *   getGraduatesCSVContent(classId, options) -> string
 *   getGraduatesJSONEnvelope(classId, options) -> object | null
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyAggregator
 *   - window.CSV
 *   - window.ExportUtils
 *   - window.ExportEnvelope
 *   - window.JSONIO
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.EliminationQueries
 *     Missing -> no character can be a graduate. Fail-closed.
 */

(function() {
    'use strict';

    if (window.__graduatesExportLoaded) {
        return;
    }
    window.__graduatesExportLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;
    var AcademyAggregator = window.AcademyAggregator;
    var CSV = window.CSV;
    var ExportUtils = window.ExportUtils;
    var ExportEnvelope = window.ExportEnvelope;
    var JSONIO = window.JSONIO;

    var _missing = [];

    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }

    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }

    if (!CSV || typeof CSV.arrayToCSV !== 'function') {
        _missing.push('CSV.arrayToCSV');
    }

    if (!ExportUtils || typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (!ExportEnvelope || typeof ExportEnvelope.create !== 'function') {
        _missing.push('ExportEnvelope.create');
    }

    if (!JSONIO || typeof JSONIO.serializeJSON !== 'function') {
        _missing.push('JSONIO.serializeJSON');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[GraduatesExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCIES
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getMagicConstants() {
        return window.MagicConstants || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    var COLUMNS = [
        // Name
        'FirstName',
        'MiddleName',
        'LastName',
        'Nickname',
        'Alias',
        'PreviousNames',
        // Life
        'Age',
        'BirthYear',
        'Gender',
        'Attraction',
        'Sexuality',
        // Physical
        'Eyes',
        'Hair',
        'Skin',
        'Height',
        'Weight',
        'Build',
        'AppearanceNotes',
        // Personality (flattened)
        'Traits',
        'Ideals',
        'Bonds',
        'Flaws',
        'Alignment',
        'Likes',
        'Dislikes',
        'Habits',
        'Fears',
        'Goals',
        // Combat
        'Stats',
        'Magic',
        'HP',
        'MP',
        'Weapons',
        'SpecialMoves',
        'CombatNotes'
    ];

    var CSV_FILENAME_PREFIX = 'graduates';
    var SECTION_HEADER = '# GRADUATES';

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function jsonOrEmpty(value) {
        try {
            return JSON.stringify(value === undefined ? null : value);
        } catch (e) {
            return 'null';
        }
    }

    function jsonObjectOr(value, fallback) {
        if (!isObject(value)) { return fallback; }
        return value;
    }

    function clonePlainObject(value) {
        if (!isObject(value)) { return {}; }
        var result = {};
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = value[k];
            if (v === null ||
                v === undefined ||
                typeof v === 'string' ||
                typeof v === 'number' ||
                typeof v === 'boolean') {
                result[k] = v;
            } else {
                result[k] = jsonOrEmpty(v);
            }
        }
        return result;
    }

    // ============================================================
    // GRADUATION YEAR RESOLUTION
    // ============================================================

    function resolveGraduationYear(cls, options) {
        if (options && options.graduationYear !== undefined &&
            options.graduationYear !== null) {
            var explicit = parseInt(options.graduationYear, 10);
            if (!isNaN(explicit) && explicit >= 1) {
                return explicit;
            }
        }

        if (cls && cls.year !== undefined && cls.year !== null && cls.year !== '') {
            var classYear = parseInt(cls.year, 10);
            if (!isNaN(classYear) && classYear >= 1) {
                return classYear;
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }

        return new Date().getFullYear();
    }

    // ============================================================
    // GRADUATE FILTER
    // ============================================================

    function isGraduate(charId, graduationYear) {
        var EQ = getEliminationQueries();

        // Fail-closed: without an elimination authority we cannot
        // honestly say who passed. Return false for everyone.
        if (!EQ || typeof EQ.isCharacterEliminatedByYear !== 'function') {
            return false;
        }

        var eliminated = false;
        try {
            eliminated = EQ.isCharacterEliminatedByYear(
                charId,
                graduationYear
            ) === true;
        } catch (e) {
            console.warn(
                '[GraduatesExport] isCharacterEliminatedByYear threw:',
                e
            );
            return false;
        }

        return eliminated === false;
    }

    // ============================================================
    // ROSTER RESOLUTION
    // ============================================================

    function resolveRoster(classId) {
        var roster = [];
        try {
            roster = AcademyAggregator.getClassStudentsViewModel(
                classId
            ) || [];
        } catch (e) {
            console.warn(
                '[GraduatesExport] getClassStudentsViewModel threw:', e
            );
            return [];
        }

        if (!Array.isArray(roster)) { return []; }

        var result = [];
        var seen = Object.create(null);
        for (var i = 0; i < roster.length; i++) {
            var entry = roster[i];
            if (!entry || !entry.id) { continue; }
            var key = String(entry.id);
            if (seen[key]) { continue; }
            seen[key] = true;
            result.push(key);
        }
        return result;
    }

    // ============================================================
    // GRADUATE RECORD PROJECTION
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS) && CC.STAT_KEYS.length > 0) {
            return CC.STAT_KEYS.slice();
        }
        return DEFAULT_STAT_KEYS.slice();
    }

    function getMagicKeys() {
        var MC = getMagicConstants();
        if (MC && typeof MC.getTypeKeys === 'function') {
            try {
                var keys = MC.getTypeKeys();
                if (Array.isArray(keys) && keys.length > 0) {
                    return keys.slice();
                }
            } catch (e) {
                // fall through
            }
        }
        return [];
    }

    function normaliseStats(char) {
        var keys = getStatKeys();
        var source = isObject(char.stats) ? char.stats : {};
        var result = {};
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = source[k];
            if (isFiniteNumber(v)) {
                result[k] = v;
            } else {
                result[k] = 0;
            }
        }
        return result;
    }

    function normaliseMagic(char) {
        var keys = getMagicKeys();
        var source = isObject(char.magic) ? char.magic : {};
        var result = {};
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = source[k];
            if (isFiniteNumber(v)) {
                result[k] = v;
            } else {
                result[k] = 0;
            }
        }
        return result;
    }

    function normaliseWeapons(char) {
        var raw = Array.isArray(char.weapons) ? char.weapons : [];
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var w = raw[i];
            if (!isObject(w)) { continue; }
            result.push({
                id: isNonEmptyString(w.id) ? String(w.id) : '',
                name: isNonEmptyString(w.name) ? String(w.name) : '',
                type: isNonEmptyString(w.type) ? String(w.type) : '',
                notes: typeof w.notes === 'string' ? w.notes : ''
            });
        }
        return result;
    }

    function normaliseSpecialMoves(char) {
        var source = isObject(char.specialMoves) ? char.specialMoves : {};
        var physRaw = Array.isArray(source.physical) ? source.physical : [];
        var magRaw = Array.isArray(source.magical) ? source.magical : [];

        function mapList(list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!isObject(m)) { continue; }
                out.push({
                    id: isNonEmptyString(m.id) ? String(m.id) : '',
                    name: isNonEmptyString(m.name) ? String(m.name) : '',
                    description: typeof m.description === 'string'
                        ? m.description
                        : ''
                });
            }
            return out;
        }

        return {
            physical: mapList(physRaw),
            magical: mapList(magRaw)
        };
    }

    function normalisePreviousNames(char) {
        if (!Array.isArray(char.previousNames)) { return []; }
        var result = [];
        for (var i = 0; i < char.previousNames.length; i++) {
            var n = char.previousNames[i];
            if (typeof n !== 'string') { continue; }
            var trimmed = n.trim();
            if (trimmed === '') { continue; }
            result.push(trimmed);
        }
        return result;
    }

    /**
     * Build a single graduate record from a character id.
     * Every field comes from the character record. Academy is not
     * consulted here.
     */
    function buildGraduateRecord(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return null; }

        var personality = isObject(char.personality)
            ? char.personality
            : {};

        var age = '';
        try {
            var ageValue = CharacterQueries.getCharacterAge(char);
            if (ageValue !== undefined && ageValue !== null) {
                age = String(ageValue);
            }
        } catch (e) {
            age = '';
        }

        var displayName = '';
        try {
            displayName = CharacterQueries.getDisplayName(char) || '';
        } catch (e) {
            displayName = '';
        }

        return {
            id: String(char.id),

            // Name
            firstName: safeString(char.firstName),
            middleName: safeString(char.middleName),
            lastName: safeString(char.lastName),
            nickname: safeString(char.nickname),
            alias: safeString(char.alias),
            previousNames: normalisePreviousNames(char),
            displayName: displayName,

            // Life
            age: age,
            birthYear: safeString(char.birthYear),
            gender: safeString(char.gender),
            attraction: safeString(char.attraction),
            sexuality: safeString(char.sexuality),

            // Physical
            eyes: safeString(char.eyes),
            hair: safeString(char.hair),
            skin: safeString(char.skin),
            height: safeString(char.height),
            weight: safeString(char.weight),
            build: safeString(char.build),
            appearanceNotes: safeString(char.appearanceNotes),

            // Personality
            traits: safeString(personality.traits),
            ideals: safeString(personality.ideals),
            bonds: safeString(personality.bonds),
            flaws: safeString(personality.flaws),
            alignment: safeString(personality.alignment),
            likes: safeString(personality.likes),
            dislikes: safeString(personality.dislikes),
            habits: safeString(personality.habits),
            fears: safeString(personality.fears),
            goals: safeString(personality.goals),

            // Combat
            stats: normaliseStats(char),
            magic: normaliseMagic(char),
            hp: isFiniteNumber(char.hp) ? char.hp : 0,
            mp: isFiniteNumber(char.mp) ? char.mp : 0,
            weapons: normaliseWeapons(char),
            specialMoves: normaliseSpecialMoves(char),
            combatNotes: safeString(char.combatNotes)
        };
    }

    // ============================================================
    // PUBLIC PROJECTION
    // ============================================================

    /**
     * Get the graduate list for a class.
     *
     * @param {string} classId
     * @param {object} [options]
     * @param {number} [options.graduationYear] Override the class year
     * @returns {object|null} The graduate VM, or null when the class
     *   does not exist or the arguments are malformed.
     */
    function getGraduates(classId, options) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        options = options || {};
        var graduationYear = resolveGraduationYear(cls, options);

        var roster = resolveRoster(String(cls.id));
        var graduates = [];

        for (var i = 0; i < roster.length; i++) {
            var charId = roster[i];
            if (!isGraduate(charId, graduationYear)) { continue; }
            var record = buildGraduateRecord(charId);
            if (record) {
                graduates.push(record);
            }
        }

        graduates.sort(function(a, b) {
            return String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
        });

        return {
            classId: String(cls.id),
            className: isNonEmptyString(cls.name)
                ? String(cls.name)
                : 'Unnamed Class',
            graduationYear: graduationYear,
            graduates: graduates
        };
    }

    // ============================================================
    // CSV
    // ============================================================

    function buildCSVRows(vm) {
        var rows = [];

        // Section marker + header, matching the CharacterCSV and
        // MissionCSV patterns so a future importer can be written
        // against the same conventions.
        rows.push([SECTION_HEADER]);
        rows.push(COLUMNS.slice());

        for (var i = 0; i < vm.graduates.length; i++) {
            var g = vm.graduates[i];
            rows.push([
                g.firstName,
                g.middleName,
                g.lastName,
                g.nickname,
                g.alias,
                jsonOrEmpty(g.previousNames),
                g.age,
                g.birthYear,
                g.gender,
                g.attraction,
                g.sexuality,
                g.eyes,
                g.hair,
                g.skin,
                g.height,
                g.weight,
                g.build,
                g.appearanceNotes,
                g.traits,
                g.ideals,
                g.bonds,
                g.flaws,
                g.alignment,
                g.likes,
                g.dislikes,
                g.habits,
                g.fears,
                g.goals,
                jsonOrEmpty(g.stats),
                jsonOrEmpty(g.magic),
                String(g.hp),
                String(g.mp),
                jsonOrEmpty(g.weapons),
                jsonOrEmpty(g.specialMoves),
                g.combatNotes
            ]);
        }

        return rows;
    }

    /**
     * Build the CSV content as a string. No download.
     */
    function getGraduatesCSVContent(classId, options) {
        var vm = getGraduates(classId, options);
        if (!vm) { return ''; }
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    /**
     * Export the graduate list as a CSV file.
     */
    function exportGraduatesCSV(classId, options) {
        options = options || {};

        var vm = getGraduates(classId, options);
        if (!vm) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Class not found or arguments invalid.'
            };
        }

        if (vm.graduates.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No graduates found for this class.'
            };
        }

        var content;
        try {
            content = CSV.arrayToCSV(buildCSVRows(vm));
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to serialize CSV: ' + e.message
            };
        }

        var blob = new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8;'
        });

        var sanitisedClass = String(vm.className)
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'class';

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' + sanitisedClass + '-' +
            String(vm.graduationYear) + '.csv';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to download CSV: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            count: vm.graduates.length,
            error: null
        };
    }

    // ============================================================
    // JSON
    // ============================================================

    /**
     * Build the JSON envelope object without downloading.
     *
     * The envelope payload is `{ graduates: [...] }`. On top of
     * the envelope's own metadata, the returned envelope carries
     * graduates-specific metadata under `metadata.graduates`:
     *   { classId, className, graduationYear, count }.
     */
    function getGraduatesJSONEnvelope(classId, options) {
        options = options || {};

        var vm = getGraduates(classId, options);
        if (!vm) { return null; }

        var envelope;
        try {
            envelope = ExportEnvelope.create(
                { graduates: vm.graduates },
                {
                    applicationName: options.applicationName,
                    applicationVersion: options.applicationVersion,
                    dataVersion: options.dataVersion,
                    exportedBy: options.exportedBy,
                    extraMetadata: {
                        graduates: {
                            classId: vm.classId,
                            className: vm.className,
                            graduationYear: vm.graduationYear,
                            count: vm.graduates.length
                        }
                    }
                }
            );
        } catch (e) {
            console.warn(
                '[GraduatesExport] ExportEnvelope.create threw:', e
            );
            return null;
        }

        return envelope;
    }

    /**
     * Export the graduate list as a JSON file.
     */
    function exportGraduatesJSON(classId, options) {
        options = options || {};

        var envelope = getGraduatesJSONEnvelope(classId, options);
        if (!envelope) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Could not build a graduate envelope.',
                wasEnveloped: false
            };
        }

        var graduates = envelope.data.graduates;
        if (!Array.isArray(graduates) || graduates.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No graduates found for this class.',
                wasEnveloped: true
            };
        }

        var serialised;
        try {
            serialised = JSONIO.serializeJSON(envelope, {
                envelope: false,
                pretty: options.pretty !== false
            });
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to serialize JSON: ' + e.message,
                wasEnveloped: true
            };
        }

        if (!serialised || !serialised.valid) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: (serialised && serialised.error) ||
                    'Serialization failed.',
                wasEnveloped: true
            };
        }

        var sanitisedClass = String(
            envelope.metadata.graduates.className
        )
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'class';

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' + sanitisedClass + '-' +
            String(envelope.metadata.graduates.graduationYear) + '.json';

        try {
            var blob = new Blob([serialised.content], {
                type: 'application/json'
            });
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to download JSON: ' + e.message,
                wasEnveloped: true
            };
        }

        return {
            exported: true,
            filename: filename,
            count: graduates.length,
            error: null,
            wasEnveloped: true
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GraduatesExport = Object.freeze({
        // Projection
        getGraduates: getGraduates,

        // JSON
        getGraduatesJSONEnvelope: getGraduatesJSONEnvelope,
        exportGraduatesJSON: exportGraduatesJSON,

        // CSV
        getGraduatesCSVContent: getGraduatesCSVContent,
        exportGraduatesCSV: exportGraduatesCSV,

        // Constants
        COLUMNS: COLUMNS.slice(),
        SECTION_HEADER: SECTION_HEADER
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.GraduatesExport;
        var missing = [];

        var required = [
            'getGraduates',
            'getGraduatesJSONEnvelope',
            'exportGraduatesJSON',
            'getGraduatesCSVContent',
            'exportGraduatesCSV'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[GraduatesExport] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
