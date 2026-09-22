/**
 * js/import-export/graduates-export.js - Graduates Export
 * Exports characters who PASSED a class.
 *
 * Path: js/import-export/graduates-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "graduates of class X".
 *   A graduate is a roster member of the class who has NEVER
 *   been eliminated — by any means.
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
 *   rankings, no elimination records — is included in the output.
 *
 * CLASSES HAVE NO YEAR:
 *   A class is an entity with an id, a name, a status, and a
 *   description. There is no graduation year, no academic year,
 *   no week boundary. The module does not invent one.
 *
 *   The picker shows every existing class and lets the user
 *   choose. Class choice is a UI concern; this module exposes
 *   getClassChoices() to feed it.
 *
 * GRADUATE FILTER — "NEVER ELIMINATED":
 *   A character is a graduate of a class when:
 *     1. the class is on their classIds list, AND
 *     2. they are not the class's instructor at any week, AND
 *     3. they have ZERO elimination records.
 *
 *   Condition 3 is the whole "passed" test. An elimination is an
 *   elimination: tournament-driven and standalone are both
 *   elimination records on character.eliminations[], and the
 *   presence of ANY record disqualifies the character.
 *
 *   No year. No week. No boundary. If a character has ever been
 *   eliminated, they did not pass; if they have never been
 *   eliminated, they passed.
 *
 *   The instructor exclusion in condition 2 uses the ALL-TIME
 *   instructor query (AcademyClasses.getClassInstructorIdsAllTime),
 *   because there is no week context in this export. A character
 *   who taught the class during weeks 1-8 and stopped is still
 *   excluded from the roster: the export is "students who passed
 *   this class," and an instructor is not a student.
 *
 * OUTPUT SHAPES:
 *
 *   getClassChoices() ->
 *     [ { id, name }, ... ]  sorted by name
 *
 *   getGraduates(classId) ->
 *     {
 *       classId,
 *       className,
 *       graduates: [GraduateRecord, ...]
 *     }
 *     or null when classId is missing / unknown
 *
 *   GraduateRecord:
 *     {
 *       id,
 *       firstName, middleName, lastName, nickname, alias,
 *       previousNames: [string],
 *       displayName,
 *       age, birthYear, gender, attraction, sexuality,
 *       eyes, hair, skin, height, weight, build, appearanceNotes,
 *       traits, ideals, bonds, flaws, alignment,
 *       likes, dislikes, habits, fears, goals,
 *       stats, magic, hp, mp, weapons, specialMoves, combatNotes
 *     }
 *
 *   exportGraduatesJSON(classId, options) ->
 *     { exported, filename, count, error?, wasEnveloped }
 *
 *   exportGraduatesCSV(classId, options) ->
 *     { exported, filename, count, error? }
 *
 *   Error codes (result.error):
 *     'Class not found or arguments invalid.'
 *     'No graduates found for this class.'
 *     (any transport-level failure message from blob/download)
 *
 *   getGraduatesCSVContent(classId) -> string
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
 *   - window.CharacterConstants  (stat key list)
 *   - window.MagicConstants      (magic type key list)
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
    if (!AcademyClasses || typeof AcademyClasses.getClasses !== 'function') {
        _missing.push('AcademyClasses.getClasses');
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
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

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
        'FirstName',
        'MiddleName',
        'LastName',
        'Nickname',
        'Alias',
        'PreviousNames',
        'Age',
        'BirthYear',
        'Gender',
        'Attraction',
        'Sexuality',
        'Eyes',
        'Hair',
        'Skin',
        'Height',
        'Weight',
        'Build',
        'AppearanceNotes',
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

    function sanitiseForFilename(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'class';
    }

    // ============================================================
    // CLASS CHOICES (for the picker)
    // ============================================================

    /**
     * Every existing class as a simple { id, name } pair, sorted
     * by name. The UI uses this to build the picker menu.
     *
     * Returns an empty array when there are no classes. Never null.
     */
    function getClassChoices() {
        var classes = [];
        try {
            classes = AcademyClasses.getClasses() || [];
        } catch (e) {
            console.warn(
                '[GraduatesExport] AcademyClasses.getClasses threw:', e
            );
            return [];
        }

        if (!Array.isArray(classes)) { return []; }

        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            result.push({
                id: String(cls.id),
                name: isNonEmptyString(cls.name)
                    ? String(cls.name)
                    : 'Unnamed Class'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // ELIMINATION TEST
    // ============================================================
    //
    // "Never eliminated" is a direct property of the character
    // record: character.eliminations[] is empty.
    //
    // Both standalone and tournament eliminations are records on
    // that array. There is no year, no week, no boundary; the
    // presence of any record disqualifies the character.

    function hasNoEliminations(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return false; }

        if (!Array.isArray(char.eliminations)) {
            return true;
        }

        return char.eliminations.length === 0;
    }

    // ============================================================
    // INSTRUCTOR EXCLUSION (ALL-TIME)
    // ============================================================
    //
    // The export is "students who passed this class." A character
    // who has ever been an instructor for the class is not a
    // student for the class, regardless of whether they also carry
    // the classId on their own record.
    //
    // The all-time query is used because there is no week context
    // in this export.

    function getClassInstructorIdSet(classId) {
        if (typeof AcademyClasses.getClassInstructorIdsAllTime !== 'function') {
            return Object.create(null);
        }

        var ids;
        try {
            ids = AcademyClasses.getClassInstructorIdsAllTime(classId);
        } catch (e) {
            console.warn(
                '[GraduatesExport] getClassInstructorIdsAllTime threw:', e
            );
            return Object.create(null);
        }

        var set = Object.create(null);
        if (!Array.isArray(ids)) { return set; }
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] === undefined || ids[i] === null) { continue; }
            var key = String(ids[i]);
            if (key === '') { continue; }
            set[key] = true;
        }
        return set;
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

            firstName: safeString(char.firstName),
            middleName: safeString(char.middleName),
            lastName: safeString(char.lastName),
            nickname: safeString(char.nickname),
            alias: safeString(char.alias),
            previousNames: normalisePreviousNames(char),
            displayName: displayName,

            age: age,
            birthYear: safeString(char.birthYear),
            gender: safeString(char.gender),
            attraction: safeString(char.attraction),
            sexuality: safeString(char.sexuality),

            eyes: safeString(char.eyes),
            hair: safeString(char.hair),
            skin: safeString(char.skin),
            height: safeString(char.height),
            weight: safeString(char.weight),
            build: safeString(char.build),
            appearanceNotes: safeString(char.appearanceNotes),

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
     * Get the graduates of a class.
     *
     * A graduate is a roster member of the class who:
     *   - is not an instructor (all-time) for the class
     *   - has zero elimination records of any kind
     *
     * @param {string} classId
     * @returns {object|null} The graduate VM, or null when the
     *   class does not exist or the classId is malformed.
     */
    function getGraduates(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var classIdStr = String(cls.id);
        var instructorSet = getClassInstructorIdSet(classIdStr);
        var roster = resolveRoster(classIdStr);

        var graduates = [];
        for (var i = 0; i < roster.length; i++) {
            var charId = roster[i];
            if (instructorSet[charId]) { continue; }
            if (!hasNoEliminations(charId)) { continue; }
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
            classId: classIdStr,
            className: isNonEmptyString(cls.name)
                ? String(cls.name)
                : 'Unnamed Class',
            graduates: graduates
        };
    }

    // ============================================================
    // CSV
    // ============================================================

    function buildCSVRows(vm) {
        var rows = [];

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
    function getGraduatesCSVContent(classId) {
        var vm = getGraduates(classId);
        if (!vm) { return ''; }
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    /**
     * Export the graduate list as a CSV file.
     */
    function exportGraduatesCSV(classId, options) {
        options = options || {};

        var vm = getGraduates(classId);
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

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' + sanitiseForFilename(vm.className) +
            '.csv';

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
     *   { classId, className, count }.
     */
    function getGraduatesJSONEnvelope(classId, options) {
        options = options || {};

        var vm = getGraduates(classId);
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

        var vm = getGraduates(classId);
        if (!vm) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Class not found or arguments invalid.',
                wasEnveloped: false
            };
        }

        if (vm.graduates.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No graduates found for this class.',
                wasEnveloped: false
            };
        }

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

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' + sanitiseForFilename(vm.className) +
            '.json';

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
            count: vm.graduates.length,
            error: null,
            wasEnveloped: true
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GraduatesExport = Object.freeze({
        // Picker feed
        getClassChoices: getClassChoices,

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
            'getClassChoices',
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
