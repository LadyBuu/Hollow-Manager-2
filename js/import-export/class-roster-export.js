/**
 * js/import-export/class-roster-export.js - Class Roster Export
 * Class-scoped roster exports in three flavors: graduates, all
 * characters, and (through GraduatesExportPicker) CSV.
 *
 * Path: js/import-export/class-roster-export.js
 *
 * MERGED FROM graduates-export.js (v31):
 *   This module absorbed everything that used to live in
 *   graduates-export.js. The merge was driven by the observation
 *   that the graduates export was already a class-scoped roster
 *   export with a single filter applied; the roster resolver, the
 *   field projection, the text formatter, and the CSV serializer
 *   were all identical between the two concepts. Splitting them
 *   into two files meant two copies of the same formatter and two
 *   identical dependency graphs.
 *
 *   The old file is gone. This module is the single owner of every
 *   class-scoped roster export in the codebase.
 *
 *   For backward compatibility with existing consumers
 *   (GraduatesExportPicker, anything else that reached for
 *   window.GraduatesExport), this module also installs the same
 *   public surface on window.GraduatesExport as a compatibility
 *   alias. New callers should use window.ClassRosterExport.
 *   Removing the alias is a separate cleanup once every consumer
 *   has been migrated.
 *
 * WHAT THIS MODULE OWNS:
 *
 *   Graduates (filtered roster):
 *     getGraduates(classId)                projection
 *     getGraduatesTextContent(classId)     text
 *     exportGraduatesText(classId)         text + download
 *     getGraduatesCSVContent(classId)      CSV
 *     exportGraduatesCSV(classId)          CSV + download
 *
 *   Characters (unfiltered roster):
 *     getCharacters(classId)               projection
 *     exportClassCharactersText(classId)   text + download
 *     exportClassGraduatesText(classId)    thin wrapper over
 *                                          exportGraduatesText,
 *                                          so the class detail
 *                                          panel has one module
 *                                          for both class-scoped
 *                                          text exports.
 *
 * WHAT "GRADUATE" MEANS HERE:
 *   A graduate is a class member with NO eliminations of any kind.
 *   Neither tournament-driven nor standalone. Presence-based, not
 *   year-scoped.
 *
 *   The presence test is delegated to
 *   EliminationQueries.hasEliminations. That predicate correctly
 *   recognises a year-only elimination (a record with a year but
 *   no week), which the old getEliminationWeek-based test did NOT:
 *   a year-only elimination had getEliminationWeek === null, so
 *   the character was mis-classified as a graduate.
 *
 * WHAT "CHARACTER" MEANS HERE:
 *   Every class member. Includes eliminated and deceased members.
 *   Instructors of the class are excluded by the roster source
 *   (AcademyAggregator.getClassStudentsViewModel).
 *
 *   "Characters" is a superset of "graduates". Every graduate is
 *   a character; a character is a graduate only if they have no
 *   eliminations.
 *
 * ROSTER SOURCE:
 *   AcademyAggregator.getClassStudentsViewModel(classId). The
 *   aggregator excludes instructors of the class; nothing else is
 *   filtered here except the graduate elimination filter.
 *
 * OUTPUT FORMATS:
 *
 *   TEXT (the primary format):
 *     A human-readable plain-text document. Designed to be opened
 *     in a text editor and read. Sparse: a line is emitted only
 *     when the field it describes has content.
 *
 *   CSV (the secondary format, graduates only):
 *     A flat grid, one row per graduate. Useful for spreadsheet
 *     work and scripting. JSON-shaped fields remain JSON-encoded.
 *
 * FAIL-CLOSED ELIGIBILITY (graduates only):
 *   When EliminationQueries is unavailable, this module refuses
 *   to guess: every roster member is treated as NOT a graduate.
 *   A fail-closed answer is the honest one; "everyone passed"
 *   would be a lie.
 *
 *   The characters export does not consult EliminationQueries at
 *   all, so it is unaffected by the module's absence.
 *
 * FORMULA GUARD:
 *   The CSV output runs user-authored string cells through a local
 *   guardFormulaForCell wrapper that skips negative numbers and
 *   numeric strings ("-5", "-5kg"). Everything else routes through
 *   CSV.guardFormula. This matches character-export.js's scoping,
 *   so the two exporters produce the same shapes for the same
 *   values.
 *
 *   No importer consumes this CSV today, so the round-trip
 *   symmetry is not enforced by a caller. If a user opens the
 *   CSV in a text editor and hand-edits it, the values in the
 *   cells are unchanged from what was written, so re-parsing
 *   produces the same values.
 *
 * STATS ABSENCE:
 *   A character with no `stats` block produces a stats entry whose
 *   values are `null` for every key rather than `0`. formatStats
 *   skips null keys, so the text output shows only stats that
 *   exist. A CSV consumer that reads the JSON stats column sees
 *   {"str":null,...}, which is honest about the absence.
 *
 * AGE:
 *   Age is computed as of the current application year, not at
 *   graduation. A graduate exported in a year after their class
 *   year will show their age at the later year, not the age at
 *   graduation. Changing this would require threading the
 *   graduating class year into the query; the fix is deferred
 *   because the current behaviour matches what the Character tab
 *   shows.
 *
 * VM SHAPE:
 *   Both getGraduates() and getCharacters() return a VM of the
 *   shape:
 *
 *     {
 *       classId:   string,
 *       className: string,
 *       members:   array,   // accurate name for the contents
 *       graduates: array    // legacy alias; same array reference
 *     }
 *
 *   `members` is the accurate key. `graduates` is retained so
 *   external callers written against the shared VM shape
 *   continue to work without modification. Both keys reference
 *   the same array; mutating one mutates the other. New code
 *   should read `members`.
 *
 * TEXT SHAPE:
 *
 *   Hollow Manager 2 — Graduates of Class of 1926
 *   Exported 2026-09-25
 *   12 graduates
 *
 *   ============================================================
 *   Aldric Blackwood
 *   ============================================================
 *   Age      : 32
 *   Gender   : Male
 *   Physical : Athletic · 5'11" · 78kg
 *   Eyes/Hair: Grey / Black / Fair
 *   Traits   : Brave, Honest, Loyal
 *   Stats    : STR 14 · DEX 12 · CON 13 · INT 10 · WIS 11 · CHA 9
 *   Combat   : HP 45 · MP 20
 *   Weapons  : Longsword (sharp); Dagger (sharp)
 *   ...
 *
 * DEPENDENCIES (MANDATORY at call time):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyAggregator
 *   - window.CSV
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL at call time):
 *   - window.EliminationQueries
 *     Missing -> no character can be a graduate. Fail-closed.
 *     The characters export does not use this dependency.
 *   - window.CharacterConstants  (stat key list)
 *   - window.MagicConstants      (magic type key list)
 */

(function() {
    'use strict';

    if (window.__classRosterExportLoaded) {
        return;
    }
    window.__classRosterExportLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getAcademyAggregator() {
        return window.AcademyAggregator || null;
    }

    function getCSV() {
        return window.CSV || null;
    }

    function getExportUtils() {
        return window.ExportUtils || null;
    }

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
    // DEPENDENCY CHECK - per entry point
    // ============================================================

    function checkDependencies(calleeName) {
        var missing = [];

        var CQ = getCharacterQueries();
        if (!CQ ||
            typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CQ ||
            typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CQ ||
            typeof CQ.getCharacterAge !== 'function') {
            missing.push('CharacterQueries.getCharacterAge');
        }

        var AC = getAcademyClasses();
        if (!AC || typeof AC.getClass !== 'function') {
            missing.push('AcademyClasses.getClass');
        }
        if (!AC || typeof AC.getClasses !== 'function') {
            missing.push('AcademyClasses.getClasses');
        }

        var AA = getAcademyAggregator();
        if (!AA ||
            typeof AA.getClassStudentsViewModel !== 'function') {
            missing.push(
                'AcademyAggregator.getClassStudentsViewModel'
            );
        }

        var CSV = getCSV();
        if (!CSV || typeof CSV.arrayToCSV !== 'function') {
            missing.push('CSV.arrayToCSV');
        }

        var EU = getExportUtils();
        if (!EU || typeof EU.downloadBlob !== 'function') {
            missing.push('ExportUtils.downloadBlob');
        }

        if (missing.length > 0) {
            var msg = '[ClassRosterExport] ' + calleeName +
                ' missing mandatory dependencies: ' +
                missing.join(', ');
            console.error(msg);
            throw new Error(msg);
        }

        return true;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    var GRADUATES_TEXT_FILENAME_PREFIX = 'graduates';
    var GRADUATES_CSV_FILENAME_PREFIX = 'graduates';
    var CHARACTERS_TEXT_FILENAME_PREFIX = 'characters';

    var SECTION_HEADER = '# GRADUATES';

    var ROSTER_SEPARATOR = '='.repeat(64);
    var LABEL_WIDTH = 10;

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
            return JSON.stringify(
                value === undefined ? null : value
            );
        } catch (e) {
            return 'null';
        }
    }

    function sanitiseForFilename(value) {
        return String(
            value === undefined || value === null ? '' : value
        )
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'class';
    }

    /**
     * Is this value non-empty for text-output purposes?
     * Zero is data (it is emitted). An empty string is not.
     */
    function hasText(value) {
        if (value === undefined || value === null) { return false; }
        if (typeof value === 'string') { return value.trim() !== ''; }
        if (typeof value === 'number') { return isFinite(value); }
        if (typeof value === 'boolean') { return true; }
        if (Array.isArray(value)) { return value.length > 0; }
        if (typeof value === 'object') {
            return Object.keys(value).length > 0;
        }
        return false;
    }

    /**
     * Read the accurate `members` key from a roster VM, falling
     * back to the legacy `graduates` key. Both keys are populated
     * by getGraduates() and getCharacters(); the fallback exists
     * for any VM that was produced before the rename or by an
     * external producer.
     */
    function getVMMembers(vm) {
        if (!vm || typeof vm !== 'object') { return []; }
        if (Array.isArray(vm.members)) { return vm.members; }
        if (Array.isArray(vm.graduates)) { return vm.graduates; }
        return [];
    }

    // ============================================================
    // GRADUATE FILTER
    // ============================================================
    //
    // A graduate is a roster member with NO eliminations at all.
    // Presence, not year.
    //
    // The presence test is delegated to
    // EliminationQueries.hasEliminations. That predicate handles
    // the year-only case correctly: a record with a year but no
    // week still counts as an elimination. The previous
    // getEliminationWeek-based test did not: it returned null for
    // a year-only record, so the character was mis-classified as
    // a graduate.

    var _eliminationUnavailableWarned = false;

    function isGraduate(charId) {
        var EQ = getEliminationQueries();

        if (!EQ ||
            typeof EQ.hasEliminations !== 'function') {
            if (!_eliminationUnavailableWarned) {
                _eliminationUnavailableWarned = true;
                console.warn(
                    '[ClassRosterExport] ' +
                    'EliminationQueries.hasEliminations is not ' +
                    'available. No character can be classified as ' +
                    'a graduate.'
                );
            }
            return false;
        }

        var has = false;
        try {
            has = EQ.hasEliminations(charId) === true;
        } catch (e) {
            console.warn(
                '[ClassRosterExport] hasEliminations threw:',
                e,
                { charId: charId }
            );
            // Fail closed.
            return false;
        }

        return !has;
    }

    // ============================================================
    // ROSTER RESOLUTION
    // ============================================================
    //
    // Same source for both the graduates and characters projections:
    // the class's student roster from the aggregator. Instructors
    // of the class are excluded by the aggregator; no instructor
    // filter is applied here.

    function resolveRoster(classId) {
        var AA = getAcademyAggregator();
        if (!AA ||
            typeof AA.getClassStudentsViewModel !== 'function') {
            return [];
        }

        var roster = [];
        try {
            roster = AA.getClassStudentsViewModel(
                classId
            ) || [];
        } catch (e) {
            console.warn(
                '[ClassRosterExport] ' +
                'getClassStudentsViewModel threw:', e
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
    // ROSTER RECORD PROJECTION
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC &&
            Array.isArray(CC.STAT_KEYS) &&
            CC.STAT_KEYS.length > 0) {
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

    /**
     * Project a character's stats block. Present values are
     * carried through as numbers; absent values are `null`.
     *
     * This differs from the previous implementation, which
     * defaulted every absent key to 0. A stats block of all zeros
     * is impossible under the engine's rules (STAT_MIN is above
     * zero), so a wall of zeros in the text output was visibly
     * wrong: it looked like a real, filled-in block that had
     * rolled all-zero.
     *
     * formatStats skips null entries. buildCSVRows serialises the
     * whole stats object, so a CSV consumer sees
     * {"str":null,...}, which is honest about the absence.
     */
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
                result[k] = null;
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
            result[k] = isFiniteNumber(v) ? v : 0;
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
                name: isNonEmptyString(w.name)
                    ? String(w.name) : '',
                type: isNonEmptyString(w.type)
                    ? String(w.type) : '',
                notes: typeof w.notes === 'string' ? w.notes : ''
            });
        }
        return result;
    }

    function normaliseSpecialMoves(char) {
        var source = isObject(char.specialMoves)
            ? char.specialMoves
            : {};
        var physRaw = Array.isArray(source.physical)
            ? source.physical : [];
        var magRaw = Array.isArray(source.magical)
            ? source.magical : [];

        function mapList(list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!isObject(m)) { continue; }
                out.push({
                    id: isNonEmptyString(m.id)
                        ? String(m.id) : '',
                    name: isNonEmptyString(m.name)
                        ? String(m.name) : '',
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

    function buildRosterRecord(charId) {
        var CQ = getCharacterQueries();
        if (!CQ) { return null; }

        var char = null;
        try {
            char = CQ.getCharacterById(charId);
        } catch (e) {
            char = null;
        }
        if (!char) { return null; }

        var personality = isObject(char.personality)
            ? char.personality
            : {};

        // Age is computed as of the current application year,
        // not at graduation. See the AGE note in the file header.
        var age = '';
        try {
            var ageValue = CQ.getCharacterAge(char);
            if (ageValue !== undefined && ageValue !== null) {
                age = String(ageValue);
            }
        } catch (e) {
            age = '';
        }

        var displayName = '';
        try {
            displayName = CQ.getDisplayName(char) || '';
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
    // PROJECTIONS
    // ============================================================

    /**
     * Get the graduate list for a class.
     *
     * Graduates are class members with no eliminations of any kind.
     * Fail-closed: when EliminationQueries is unavailable, no
     * character is classified as a graduate.
     *
     * @param {string} classId
     * @returns {object|null}
     */
    function getGraduates(classId) {
        checkDependencies('getGraduates');

        if (!isNonEmptyString(classId)) {
            return null;
        }

        var AC = getAcademyClasses();
        var cls = AC.getClass(classId);
        if (!cls) {
            return null;
        }

        var roster = resolveRoster(String(cls.id));
        var graduates = [];

        for (var i = 0; i < roster.length; i++) {
            var charId = roster[i];
            if (!isGraduate(charId)) { continue; }
            var record = buildRosterRecord(charId);
            if (record) {
                graduates.push(record);
            }
        }

        graduates.sort(function(a, b) {
            return String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
        });

        // Two keys point at the same array:
        //   `members`   — accurate name for the contents.
        //   `graduates` — legacy name from the shared VM shape.
        //                 Kept for external callers that read
        //                 vm.graduates directly.
        return {
            classId: String(cls.id),
            className: isNonEmptyString(cls.name)
                ? String(cls.name)
                : 'Unnamed Class',
            members: graduates,
            graduates: graduates
        };
    }

    /**
     * Get every character in the class, INCLUDING eliminated
     * students.
     *
     * The projection does not consult EliminationQueries at all;
     * the module does not need it for this path.
     *
     * @param {string} classId
     * @returns {object|null}
     */
    function getCharacters(classId) {
        checkDependencies('getCharacters');

        if (!isNonEmptyString(classId)) {
            return null;
        }

        var AC = getAcademyClasses();
        var cls = AC.getClass(classId);
        if (!cls) {
            return null;
        }

        var roster = resolveRoster(String(cls.id));
        var characters = [];

        for (var i = 0; i < roster.length; i++) {
            var charId = roster[i];
            var record = buildRosterRecord(charId);
            if (record) {
                characters.push(record);
            }
        }

        characters.sort(function(a, b) {
            return String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
        });

        // Two keys point at the same array:
        //   `members`   — accurate name: every character in the
        //                 class, including eliminated ones.
        //   `graduates` — legacy name. It is a lie in this VM
        //                 (the array is NOT the graduates), but
        //                 it is kept so that external callers
        //                 written against the shared VM shape
        //                 continue to work.
        return {
            classId: String(cls.id),
            className: isNonEmptyString(cls.name)
                ? String(cls.name)
                : 'Unnamed Class',
            members: characters,
            graduates: characters
        };
    }

    // ============================================================
    // TEXT FORMAT
    // ============================================================
    //
    // Designed to be read, not parsed. Sparse; empty sections
    // collapse; sub-objects flatten to prose.

    function padLabel(label) {
        var str = String(label);
        while (str.length < LABEL_WIDTH) {
            str += ' ';
        }
        return str;
    }

    function textLine(label, value) {
        if (!hasText(value)) { return ''; }
        var v = String(value).replace(/\s+/g, ' ').trim();
        if (v === '') { return ''; }
        return padLabel(label) + ': ' + v + '\n';
    }

    /**
     * Format a stats block. Null entries (absent stats) are
     * skipped. Zero entries are kept: a 0 is a value, not a
     * missing value, and the engine does not produce zeros for
     * stat blocks in practice, so an explicit zero here is a
     * faithful representation of the record.
     */
    function formatStats(stats) {
        if (!isObject(stats)) { return ''; }

        var keys = Object.keys(stats);
        if (keys.length === 0) { return ''; }

        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = stats[k];
            if (!isFiniteNumber(v)) { continue; }
            parts.push(k.toUpperCase() + ' ' + v);
        }
        return parts.join(' \u00b7 ');
    }

    function formatMagic(magic) {
        if (!isObject(magic)) { return ''; }

        var parts = [];
        var keys = Object.keys(magic);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = magic[k];
            if (!isFiniteNumber(v) || v === 0) { continue; }
            var label = k.charAt(0).toUpperCase() + k.slice(1);
            parts.push(label + ' ' + v);
        }
        return parts.join(' \u00b7 ');
    }

    function formatWeapons(weapons) {
        if (!Array.isArray(weapons) || weapons.length === 0) {
            return '';
        }

        var parts = [];
        for (var i = 0; i < weapons.length; i++) {
            var w = weapons[i];
            if (!isObject(w)) { continue; }
            var name = isNonEmptyString(w.name)
                ? String(w.name) : '';
            if (name === '') { continue; }
            if (isNonEmptyString(w.type)) {
                name += ' (' + w.type + ')';
            }
            if (isNonEmptyString(w.notes)) {
                name += ' \u2014 ' + w.notes;
            }
            parts.push(name);
        }
        return parts.join('; ');
    }

    function formatSpecialMoves(moves) {
        if (!isObject(moves)) { return ''; }

        var parts = [];

        function listOf(list) {
            if (!Array.isArray(list) || list.length === 0) {
                return '';
            }
            var names = [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!isObject(m)) { continue; }
                if (!isNonEmptyString(m.name)) { continue; }
                var s = String(m.name);
                if (isNonEmptyString(m.description)) {
                    s += ' (' + m.description + ')';
                }
                names.push(s);
            }
            return names.join(', ');
        }

        var phys = listOf(moves.physical);
        var mag = listOf(moves.magical);

        if (phys) { parts.push('Physical \u2014 ' + phys); }
        if (mag) { parts.push('Magical \u2014 ' + mag); }

        return parts.join(' \u00b7 ');
    }

    function formatPhysicalComposite(rec) {
        var parts = [];
        if (isNonEmptyString(rec.build)) {
            parts.push(String(rec.build));
        }
        if (isNonEmptyString(rec.height)) {
            parts.push(String(rec.height));
        }
        if (isNonEmptyString(rec.weight)) {
            parts.push(String(rec.weight));
        }
        return parts.join(' \u00b7 ');
    }

    function formatColourComposite(rec) {
        var parts = [];
        if (isNonEmptyString(rec.eyes)) {
            parts.push(String(rec.eyes));
        }
        if (isNonEmptyString(rec.hair)) {
            parts.push(String(rec.hair));
        }
        if (isNonEmptyString(rec.skin)) {
            parts.push(String(rec.skin));
        }
        return parts.join(' / ');
    }

    function emitRosterHeader(rec) {
        var out = '';
        out += ROSTER_SEPARATOR + '\n';
        out += (isNonEmptyString(rec.displayName)
            ? rec.displayName
            : 'Unknown') + '\n';
        out += ROSTER_SEPARATOR + '\n';
        return out;
    }

    function emitIdentityLines(rec) {
        var out = '';

        var fullName = [
            rec.firstName, rec.middleName, rec.lastName
        ]
            .filter(isNonEmptyString)
            .join(' ');
        if (fullName && fullName !== rec.displayName) {
            out += textLine('Name', fullName);
        }

        if (isNonEmptyString(rec.nickname)) {
            out += textLine('Nickname', rec.nickname);
        }
        if (isNonEmptyString(rec.alias)) {
            out += textLine('Alias', rec.alias);
        }

        if (Array.isArray(rec.previousNames) &&
            rec.previousNames.length > 0) {
            out += textLine(
                'Also',
                rec.previousNames.join(', ')
            );
        }

        if (isNonEmptyString(rec.age)) {
            out += textLine('Age', rec.age);
        }
        if (isNonEmptyString(rec.birthYear)) {
            out += textLine('Born', rec.birthYear);
        }
        if (isNonEmptyString(rec.gender)) {
            out += textLine('Gender', rec.gender);
        }
        if (isNonEmptyString(rec.attraction)) {
            out += textLine('Attraction', rec.attraction);
        }
        if (isNonEmptyString(rec.sexuality)) {
            out += textLine('Sexuality', rec.sexuality);
        }

        return out;
    }

    function emitPhysicalLines(rec) {
        var out = '';

        var composite = formatPhysicalComposite(rec);
        if (composite) {
            out += textLine('Physical', composite);
        }

        var colours = formatColourComposite(rec);
        if (colours) {
            out += textLine('Eyes/Hair', colours);
        }

        if (isNonEmptyString(rec.appearanceNotes)) {
            out += textLine('Appearance', rec.appearanceNotes);
        }

        return out;
    }

    function emitPersonalityLines(rec) {
        var out = '';

        if (isNonEmptyString(rec.traits)) {
            out += textLine('Traits', rec.traits);
        }
        if (isNonEmptyString(rec.ideals)) {
            out += textLine('Ideals', rec.ideals);
        }
        if (isNonEmptyString(rec.bonds)) {
            out += textLine('Bonds', rec.bonds);
        }
        if (isNonEmptyString(rec.flaws)) {
            out += textLine('Flaws', rec.flaws);
        }
        if (isNonEmptyString(rec.alignment)) {
            out += textLine('Alignment', rec.alignment);
        }
        if (isNonEmptyString(rec.likes)) {
            out += textLine('Likes', rec.likes);
        }
        if (isNonEmptyString(rec.dislikes)) {
            out += textLine('Dislikes', rec.dislikes);
        }
        if (isNonEmptyString(rec.habits)) {
            out += textLine('Habits', rec.habits);
        }
        if (isNonEmptyString(rec.fears)) {
            out += textLine('Fears', rec.fears);
        }
        if (isNonEmptyString(rec.goals)) {
            out += textLine('Goals', rec.goals);
        }

        return out;
    }

    function emitCombatLines(rec) {
        var out = '';

        var stats = formatStats(rec.stats);
        if (stats) {
            out += textLine('Stats', stats);
        }

        var hpmp = '';
        if (isFiniteNumber(rec.hp) && rec.hp !== 0) {
            hpmp += 'HP ' + rec.hp;
        }
        if (isFiniteNumber(rec.mp) && rec.mp !== 0) {
            if (hpmp) { hpmp += ' \u00b7 '; }
            hpmp += 'MP ' + rec.mp;
        }
        if (hpmp) {
            out += textLine('Combat', hpmp);
        }

        var magic = formatMagic(rec.magic);
        if (magic) {
            out += textLine('Magic', magic);
        }

        var weapons = formatWeapons(rec.weapons);
        if (weapons) {
            out += textLine('Weapons', weapons);
        }

        var moves = formatSpecialMoves(rec.specialMoves);
        if (moves) {
            out += textLine('Moves', moves);
        }

        if (isNonEmptyString(rec.combatNotes)) {
            out += textLine('Notes', rec.combatNotes);
        }

        return out;
    }

    function emitRosterBlock(rec) {
        var out = '';

        out += emitRosterHeader(rec);

        var identity = emitIdentityLines(rec);
        var physical = emitPhysicalLines(rec);
        var personality = emitPersonalityLines(rec);
        var combat = emitCombatLines(rec);

        var sections = [identity, physical, personality, combat]
            .filter(function(s) { return s !== ''; });

        if (sections.length === 0) {
            out += '(No further details recorded.)\n';
            return out;
        }

        for (var i = 0; i < sections.length; i++) {
            if (i > 0) { out += '\n'; }
            out += sections[i];
        }

        return out;
    }

    /**
     * Build the full text for a roster VM.
     *
     * @param {object} vm       The VM from getGraduates() or
     *                          getCharacters(). Both share the
     *                          { className, members, graduates }
     *                          shape.
     * @param {string} label    'Graduates' or 'Characters'. Used in
     *                          the header line and the singular /
     *                          plural count line.
     * @returns {string}
     */
    function buildRosterText(vm, label) {
        var out = '';
        var useLabel = isNonEmptyString(label) ? label : 'Roster';

        var members = getVMMembers(vm);

        var count = members.length;
        var singular = useLabel.toLowerCase().replace(/s$/, '');

        out += 'Hollow Manager 2 \u2014 ' + useLabel + ' of ' +
            vm.className + '\n';
        out += 'Exported ' +
            new Date().toISOString().slice(0, 10) + '\n';
        out += count + ' ' + singular +
            (count === 1 ? '' : 's') + '\n\n';

        if (count === 0) {
            out += '(No ' + useLabel.toLowerCase() +
                ' in this class.)\n';
            return out;
        }

        for (var i = 0; i < members.length; i++) {
            if (i > 0) {
                out += '\n';
            }
            out += emitRosterBlock(members[i]);
        }

        return out;
    }

    // ============================================================
    // TEXT EXPORTS
    // ============================================================

    /**
     * Get the graduates text content as a string. No download.
     */
    function getGraduatesTextContent(classId) {
        var vm = getGraduates(classId);
        if (!vm) { return ''; }
        return buildRosterText(vm, 'Graduates');
    }

    /**
     * Export the graduate list as a plain-text file.
     *
     * @returns {{ exported, filename, count, error }}
     */
    function exportGraduatesText(classId, options) {
        checkDependencies('exportGraduatesText');
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

        var members = getVMMembers(vm);

        if (members.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No graduates found for this class.'
            };
        }

        var content = buildRosterText(vm, 'Graduates');

        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var filename = options.filename ||
            GRADUATES_TEXT_FILENAME_PREFIX + '-' +
            sanitiseForFilename(vm.className) + '.txt';

        try {
            getExportUtils().downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to download text: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            count: members.length,
            error: null
        };
    }

    /**
     * Export every character in the class as a plain-text file,
     * including eliminated students.
     *
     * @returns {{ exported, filename, count, error }}
     */
    function exportClassCharactersText(classId, options) {
        checkDependencies('exportClassCharactersText');
        options = options || {};

        var vm = getCharacters(classId);
        if (!vm) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Class not found or arguments invalid.'
            };
        }

        var members = getVMMembers(vm);

        if (members.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No characters found for this class.'
            };
        }

        var content = buildRosterText(vm, 'Characters');

        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var today = new Date().toISOString().slice(0, 10);
        var filename = options.filename ||
            CHARACTERS_TEXT_FILENAME_PREFIX + '-' +
            sanitiseForFilename(vm.className) + '-' +
            today + '.txt';

        try {
            getExportUtils().downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'Failed to download text: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            count: members.length,
            error: null
        };
    }

    /**
     * Export the class's graduates. Alias for the class detail
     * panel's "Export Graduates" button. Routes to
     * exportGraduatesText; exists so the controller has one module
     * to call for both class-scoped text exports.
     */
    function exportClassGraduatesText(classId, options) {
        return exportGraduatesText(classId, options);
    }

    // ============================================================
    // CSV EXPORTS (graduates only)
    // ============================================================

    /**
     * Guard a cell value against spreadsheet formula evaluation,
     * SKIPPING the guard when the value looks like a negative
     * number with an optional unit or comma-grouped tail.
     *
     * Matches character-export.js's guardFormulaForCell. The
     * scoping keeps "-5", "-5kg", "-5 metres", "-5,000" from
     * being prefixed with a leading apostrophe, which a
     * text-editor reader would see and could mistake for data.
     */
    function guardFormulaForCell(value) {
        var CSV = getCSV();
        if (!CSV || typeof CSV.guardFormula !== 'function') {
            return value;
        }

        if (typeof value !== 'string') {
            return CSV.guardFormula(value);
        }

        var trimmedValue = value.trim();
        if (trimmedValue === '') { return value; }

        if (/^-?\d/.test(trimmedValue)) {
            return value;
        }

        return CSV.guardFormula(value);
    }

    function buildCSVRows(vm) {
        var rows = [];

        var members = getVMMembers(vm);

        rows.push([SECTION_HEADER]);
        rows.push(COLUMNS.slice());

        for (var i = 0; i < members.length; i++) {
            var g = members[i];
            rows.push([
                guardFormulaForCell(g.firstName),
                guardFormulaForCell(g.middleName),
                guardFormulaForCell(g.lastName),
                guardFormulaForCell(g.nickname),
                guardFormulaForCell(g.alias),
                jsonOrEmpty(g.previousNames),
                guardFormulaForCell(g.age),
                guardFormulaForCell(g.birthYear),
                guardFormulaForCell(g.gender),
                guardFormulaForCell(g.attraction),
                guardFormulaForCell(g.sexuality),
                guardFormulaForCell(g.eyes),
                guardFormulaForCell(g.hair),
                guardFormulaForCell(g.skin),
                guardFormulaForCell(g.height),
                guardFormulaForCell(g.weight),
                guardFormulaForCell(g.build),
                guardFormulaForCell(g.appearanceNotes),
                guardFormulaForCell(g.traits),
                guardFormulaForCell(g.ideals),
                guardFormulaForCell(g.bonds),
                guardFormulaForCell(g.flaws),
                guardFormulaForCell(g.alignment),
                guardFormulaForCell(g.likes),
                guardFormulaForCell(g.dislikes),
                guardFormulaForCell(g.habits),
                guardFormulaForCell(g.fears),
                guardFormulaForCell(g.goals),
                jsonOrEmpty(g.stats),
                jsonOrEmpty(g.magic),
                String(g.hp),
                String(g.mp),
                jsonOrEmpty(g.weapons),
                jsonOrEmpty(g.specialMoves),
                guardFormulaForCell(g.combatNotes)
            ]);
        }

        return rows;
    }

    function getGraduatesCSVContent(classId) {
        checkDependencies('getGraduatesCSVContent');

        var vm = getGraduates(classId);
        if (!vm) { return ''; }

        var CSV = getCSV();
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    function exportGraduatesCSV(classId, options) {
        checkDependencies('exportGraduatesCSV');
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

        var members = getVMMembers(vm);

        if (members.length === 0) {
            return {
                exported: false,
                filename: null,
                count: 0,
                error: 'No graduates found for this class.'
            };
        }

        var CSV = getCSV();
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
            GRADUATES_CSV_FILENAME_PREFIX + '-' +
            sanitiseForFilename(vm.className) + '.csv';

        try {
            getExportUtils().downloadBlob(blob, filename);
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
            count: members.length,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    var PUBLIC_API = Object.freeze({
        // Graduates (filtered roster)
        getGraduates: getGraduates,
        getGraduatesTextContent: getGraduatesTextContent,
        exportGraduatesText: exportGraduatesText,
        getGraduatesCSVContent: getGraduatesCSVContent,
        exportGraduatesCSV: exportGraduatesCSV,

        // Characters (unfiltered roster)
        getCharacters: getCharacters,
        exportClassCharactersText: exportClassCharactersText,
        exportClassGraduatesText: exportClassGraduatesText,

        // Constants
        COLUMNS: COLUMNS.slice(),
        SECTION_HEADER: SECTION_HEADER
    });

    window.ClassRosterExport = PUBLIC_API;

    // ------------------------------------------------------------
    // COMPATIBILITY ALIAS
    // ------------------------------------------------------------
    //
    // GraduatesExport was a separate module until v31. It has been
    // absorbed into ClassRosterExport. Consumers that still reach
    // for window.GraduatesExport (GraduatesExportPicker is the
    // known one) resolve through this alias.
    //
    // New callers should use window.ClassRosterExport directly.
    // Removing this alias is a separate cleanup once every consumer
    // has been migrated.

    if (!window.GraduatesExport) {
        window.GraduatesExport = PUBLIC_API;
    }

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ClassRosterExport;
        var missing = [];

        var required = [
            'getGraduates',
            'getGraduatesTextContent',
            'exportGraduatesText',
            'getGraduatesCSVContent',
            'exportGraduatesCSV',
            'getCharacters',
            'exportClassCharactersText',
            'exportClassGraduatesText'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[ClassRosterExport] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
