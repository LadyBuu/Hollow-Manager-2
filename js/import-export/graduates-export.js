/**
 * js/import-export/graduates-export.js - Graduates Export
 * Exports the characters who GRADUATED from a class.
 *
 * Path: js/import-export/graduates-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "graduates of class X".
 *
 * WHAT "GRADUATE" MEANS HERE:
 *   A graduate is a character who is a member of the class and has
 *   NO eliminations of any kind. Neither tournament-driven nor
 *   standalone. A character with even one elimination record is
 *   not a graduate.
 *
 *   There is no year filter. Classes are not connected to years.
 *   The elimination check is presence-based: has this character
 *   ever been eliminated at all?
 *
 * TWO OUTPUT FORMATS:
 *
 *   TEXT (the primary format):
 *     A human-readable plain-text document. Designed to be opened
 *     in a text editor and read. Sparse: a line is emitted only
 *     when the field it describes has content. Sub-objects (stats,
 *     magic, weapons, moves) are flattened into prose.
 *
 *     This is a PROJECTION, not a backup. It is deliberately lossy
 *     in structure — a reader who wants to re-import data should
 *     use the JSON envelope export at the application level.
 *
 *   CSV (the secondary format):
 *     A flat grid, one row per graduate. Useful for spreadsheet
 *     work and scripting. JSON-shaped fields remain JSON-encoded,
 *     because a spreadsheet consumer expects to parse them.
 *
 * TEXT SHAPE:
 *
 *   Hollow Blades — Graduates of Class of 1926
 *   Exported 2026-09-22
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
 *
 *   ============================================================
 *   Mira Vale
 *   ============================================================
 *   ...
 *
 * FAIL-CLOSED ELIGIBILITY:
 *   When EliminationQueries is unavailable, this module refuses to
 *   guess: every roster member is treated as NOT a graduate. A
 *   fail-closed answer is the honest one; "everyone passed" would
 *   be a lie.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class entity             (AcademyClasses)
 *   - The roster derivation        (AcademyAggregator)
 *   - Elimination reads            (EliminationQueries)
 *   - Character data               (CharacterQueries)
 *   - CSV parsing                  (CSV)
 *   - File download                (ExportUtils)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyAggregator
 *   - window.CSV
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.EliminationQueries
 *     Missing -> no character can be a graduate. Fail-closed.
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

    if (_missing.length > 0) {
        throw new Error(
            '[GraduatesExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
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

    var TEXT_FILENAME_PREFIX = 'graduates';
    var CSV_FILENAME_PREFIX = 'graduates';
    var SECTION_HEADER = '# GRADUATES';

    var GRADUATE_SEPARATOR = '='.repeat(64);
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

    // ============================================================
    // GRADUATE FILTER
    // ============================================================
    //
    // A graduate is a roster member with NO eliminations at all.
    // Presence, not year. See the file header for the reasoning.

    var _graduateFilterWarned = false;

    function isGraduate(charId) {
        var EQ = getEliminationQueries();

        if (!EQ || typeof EQ.getEliminationWeek !== 'function') {
            if (!_graduateFilterWarned) {
                _graduateFilterWarned = true;
                console.warn(
                    '[GraduatesExport] EliminationQueries.' +
                    'getEliminationWeek is not available. ' +
                    'No character can be classified as a graduate.'
                );
            }
            return false;
        }

        var earliest;
        try {
            earliest = EQ.getEliminationWeek(charId);
        } catch (e) {
            console.warn(
                '[GraduatesExport] getEliminationWeek threw:',
                e,
                { charId: charId }
            );
            return false;
        }

        return earliest === null || earliest === undefined;
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
            result[k] = isFiniteNumber(v) ? v : 0;
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
     * Get the graduate list for a class.
     *
     * @param {string} classId
     * @returns {object|null} The graduate VM, or null when the
     *   class does not exist or the arguments are malformed.
     */
    function getGraduates(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var roster = resolveRoster(String(cls.id));
        var graduates = [];

        for (var i = 0; i < roster.length; i++) {
            var charId = roster[i];
            if (!isGraduate(charId)) { continue; }
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
            graduates: graduates
        };
    }

    // ============================================================
    // TEXT FORMAT
    // ============================================================
    //
    // The text format is the primary export. It is designed to be
    // read, not parsed. Every design decision favours the reader:
    //
    //   - Sparse: a field line is emitted only when the field has
    //     content. No "Traits: (none)" filler.
    //   - Sections collapse: a graduate with no personality data
    //     does not get a "Personality" header with empty lines.
    //   - Sub-objects flatten: stats become "STR 14 · DEX 12 · ..."
    //     not a JSON blob.
    //   - Separators carry hierarchy: === for each graduate.
    //   - Labels are padded to a fixed width so values line up
    //     within a graduate block.

    function padLabel(label) {
        var str = String(label);
        while (str.length < LABEL_WIDTH) {
            str += ' ';
        }
        return str;
    }

    /**
     * Emit a labelled line, or nothing if the value is empty.
     * Whitespace within the value is collapsed to single spaces so
     * a multi-line notes field does not break the block layout.
     */
    function textLine(label, value) {
        if (!hasText(value)) { return ''; }
        var v = String(value).replace(/\s+/g, ' ').trim();
        if (v === '') { return ''; }
        return padLabel(label) + ': ' + v + '\n';
    }

    /**
     * Format stats as "STR 14 · DEX 12 · ..." with each key
     * uppercased. All-zero stats are treated as empty.
     */
    function formatStats(stats) {
        if (!isObject(stats)) { return ''; }

        var keys = Object.keys(stats);
        if (keys.length === 0) { return ''; }

        var any = false;
        for (var i = 0; i < keys.length; i++) {
            if (stats[keys[i]] !== 0) { any = true; break; }
        }
        if (!any) { return ''; }

        var parts = [];
        for (var j = 0; j < keys.length; j++) {
            var k = keys[j];
            parts.push(k.toUpperCase() + ' ' + stats[k]);
        }
        return parts.join(' \u00b7 ');
    }

    /**
     * Format magic as "Fire 8 · Water 3" with only non-zero
     * entries shown.
     */
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

    /**
     * Format weapons as "Longsword (sharp); Dagger (sharp)".
     */
    function formatWeapons(weapons) {
        if (!Array.isArray(weapons) || weapons.length === 0) {
            return '';
        }

        var parts = [];
        for (var i = 0; i < weapons.length; i++) {
            var w = weapons[i];
            if (!isObject(w)) { continue; }
            var name = isNonEmptyString(w.name) ? String(w.name) : '';
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

    /**
     * Format special moves as "Physical — A, B · Magical — C".
     */
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

    function formatPhysicalComposite(grad) {
        var parts = [];
        if (isNonEmptyString(grad.build)) {
            parts.push(String(grad.build));
        }
        if (isNonEmptyString(grad.height)) {
            parts.push(String(grad.height));
        }
        if (isNonEmptyString(grad.weight)) {
            parts.push(String(grad.weight));
        }
        return parts.join(' \u00b7 ');
    }

    function formatColourComposite(grad) {
        var parts = [];
        if (isNonEmptyString(grad.eyes)) {
            parts.push(String(grad.eyes));
        }
        if (isNonEmptyString(grad.hair)) {
            parts.push(String(grad.hair));
        }
        if (isNonEmptyString(grad.skin)) {
            parts.push(String(grad.skin));
        }
        return parts.join(' / ');
    }

    /**
     * Emit the header banner for a graduate.
     *   ============================================================
     *   Aldric Blackwood
     *   ============================================================
     */
    function emitGraduateHeader(grad) {
        var out = '';
        out += GRADUATE_SEPARATOR + '\n';
        out += (isNonEmptyString(grad.displayName)
            ? grad.displayName
            : 'Unknown') + '\n';
        out += GRADUATE_SEPARATOR + '\n';
        return out;
    }

    function emitIdentityLines(grad) {
        var out = '';

        // Full name, if different from display name.
        var fullName = [grad.firstName, grad.middleName, grad.lastName]
            .filter(isNonEmptyString)
            .join(' ');
        if (fullName && fullName !== grad.displayName) {
            out += textLine('Name', fullName);
        }

        if (isNonEmptyString(grad.nickname)) {
            out += textLine('Nickname', grad.nickname);
        }
        if (isNonEmptyString(grad.alias)) {
            out += textLine('Alias', grad.alias);
        }

        if (Array.isArray(grad.previousNames) &&
            grad.previousNames.length > 0) {
            out += textLine(
                'Also',
                grad.previousNames.join(', ')
            );
        }

        if (isNonEmptyString(grad.age)) {
            out += textLine('Age', grad.age);
        }
        if (isNonEmptyString(grad.birthYear)) {
            out += textLine('Born', grad.birthYear);
        }
        if (isNonEmptyString(grad.gender)) {
            out += textLine('Gender', grad.gender);
        }
        if (isNonEmptyString(grad.attraction)) {
            out += textLine('Attraction', grad.attraction);
        }
        if (isNonEmptyString(grad.sexuality)) {
            out += textLine('Sexuality', grad.sexuality);
        }

        return out;
    }

    function emitPhysicalLines(grad) {
        var out = '';

        var composite = formatPhysicalComposite(grad);
        if (composite) {
            out += textLine('Physical', composite);
        }

        var colours = formatColourComposite(grad);
        if (colours) {
            out += textLine('Eyes/Hair', colours);
        }

        if (isNonEmptyString(grad.appearanceNotes)) {
            out += textLine('Appearance', grad.appearanceNotes);
        }

        return out;
    }

    function emitPersonalityLines(grad) {
        var out = '';

        if (isNonEmptyString(grad.traits)) {
            out += textLine('Traits', grad.traits);
        }
        if (isNonEmptyString(grad.ideals)) {
            out += textLine('Ideals', grad.ideals);
        }
        if (isNonEmptyString(grad.bonds)) {
            out += textLine('Bonds', grad.bonds);
        }
        if (isNonEmptyString(grad.flaws)) {
            out += textLine('Flaws', grad.flaws);
        }
        if (isNonEmptyString(grad.alignment)) {
            out += textLine('Alignment', grad.alignment);
        }
        if (isNonEmptyString(grad.likes)) {
            out += textLine('Likes', grad.likes);
        }
        if (isNonEmptyString(grad.dislikes)) {
            out += textLine('Dislikes', grad.dislikes);
        }
        if (isNonEmptyString(grad.habits)) {
            out += textLine('Habits', grad.habits);
        }
        if (isNonEmptyString(grad.fears)) {
            out += textLine('Fears', grad.fears);
        }
        if (isNonEmptyString(grad.goals)) {
            out += textLine('Goals', grad.goals);
        }

        return out;
    }

    function emitCombatLines(grad) {
        var out = '';

        var stats = formatStats(grad.stats);
        if (stats) {
            out += textLine('Stats', stats);
        }

        var hpmp = '';
        if (isFiniteNumber(grad.hp) && grad.hp !== 0) {
            hpmp += 'HP ' + grad.hp;
        }
        if (isFiniteNumber(grad.mp) && grad.mp !== 0) {
            if (hpmp) { hpmp += ' \u00b7 '; }
            hpmp += 'MP ' + grad.mp;
        }
        if (hpmp) {
            out += textLine('Combat', hpmp);
        }

        var magic = formatMagic(grad.magic);
        if (magic) {
            out += textLine('Magic', magic);
        }

        var weapons = formatWeapons(grad.weapons);
        if (weapons) {
            out += textLine('Weapons', weapons);
        }

        var moves = formatSpecialMoves(grad.specialMoves);
        if (moves) {
            out += textLine('Moves', moves);
        }

        if (isNonEmptyString(grad.combatNotes)) {
            out += textLine('Notes', grad.combatNotes);
        }

        return out;
    }

    /**
     * Emit one graduate block. Sections are separated by a blank
     * line if there is more than one section with content, so the
     * reader's eye can group them.
     */
    function emitGraduateBlock(grad) {
        var out = '';

        out += emitGraduateHeader(grad);

        var identity = emitIdentityLines(grad);
        var physical = emitPhysicalLines(grad);
        var personality = emitPersonalityLines(grad);
        var combat = emitCombatLines(grad);

        var sections = [identity, physical, personality, combat]
            .filter(function(s) { return s !== ''; });

        if (sections.length === 0) {
            // A graduate with no data beyond the name. Emit a
            // single placeholder so the block is not just a banner.
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
     * Build the full text export for a graduate VM.
     *
     * @param {object} vm - The VM from getGraduates()
     * @returns {string}
     */
    function buildGraduatesText(vm) {
        var out = '';

        var count = vm.graduates.length;

        // ---- Header ----
        out += 'Hollow Blades \u2014 Graduates of ' + vm.className + '\n';
        out += 'Exported ' + new Date().toISOString().slice(0, 10) + '\n';
        out += count + ' graduate' + (count === 1 ? '' : 's') + '\n\n';

        if (count === 0) {
            out += '(No graduates in this class.)\n';
            return out;
        }

        // ---- Graduates ----
        for (var i = 0; i < vm.graduates.length; i++) {
            if (i > 0) {
                out += '\n';
            }
            out += emitGraduateBlock(vm.graduates[i]);
        }

        return out;
    }

    /**
     * Get the plain-text content as a string. No download.
     *
     * @param {string} classId
     * @returns {string} Empty string when the class does not exist.
     */
    function getGraduatesTextContent(classId) {
        var vm = getGraduates(classId);
        if (!vm) { return ''; }
        return buildGraduatesText(vm);
    }

    /**
     * Export the graduate list as a plain-text file.
     *
     * @param {string} classId
     * @param {object} [options]
     * @param {string} [options.filename]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   count: number,
     *   error: string|null
     * }}
     */
    function exportGraduatesText(classId, options) {
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

        var content = buildGraduatesText(vm);

        // No BOM. Plain text does not need it, and it produces a
        // phantom character in most Unix tooling.
        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var filename = options.filename ||
            TEXT_FILENAME_PREFIX + '-' +
            sanitiseForFilename(vm.className) + '.txt';

        try {
            ExportUtils.downloadBlob(blob, filename);
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
            count: vm.graduates.length,
            error: null
        };
    }

    // ============================================================
    // CSV
    // ============================================================
    //
    // CSV is the secondary format. It is a flat grid — one row per
    // graduate — that a spreadsheet or scripting tool can consume.
    // JSON-shaped fields (stats, magic, weapons, moves) remain
    // JSON-encoded, because a consumer of CSV expects to parse
    // them. Rows are separated by \r\n and the file carries a BOM,
    // both because Excel expects them.

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
    // EXPOSE
    // ============================================================

    window.GraduatesExport = Object.freeze({
        // Projection
        getGraduates: getGraduates,

        // Text (primary)
        getGraduatesTextContent: getGraduatesTextContent,
        exportGraduatesText: exportGraduatesText,

        // CSV (secondary)
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
            'getGraduatesTextContent',
            'exportGraduatesText',
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
