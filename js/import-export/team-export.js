/**
 * js/import-export/team-export.js - Team Export
 * Exports all professional teams with their members, stints, and
 * each member's full character stats.
 *
 * Path: js/import-export/team-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "all professional teams".
 *
 * WHAT "PROFESSIONAL TEAM" MEANS HERE:
 *   Every team whose type normalises to 'professional'. Deprecated
 *   teams are excluded. Active and inactive teams are included.
 *
 *   This is a full export, not a period-scoped view. A team that
 *   disbanded in 1912 is still in the export. A member who left in
 *   1915 is still in the member list.
 *
 * TWO OUTPUT FORMATS:
 *
 *   TEXT (the primary format):
 *     A human-readable plain-text document. Designed to be opened
 *     in a text editor and read. Sparse: a line is emitted only
 *     when the field it describes has content. Sections collapse
 *     when empty. Sub-objects (stats, magic, weapons, moves) are
 *     flattened into prose. Stints collapse onto one line per
 *     member.
 *
 *     This is a PROJECTION, not a backup. It is deliberately lossy
 *     in structure — a reader who wants to re-import data should
 *     use the JSON envelope export at the application level.
 *
 *   CSV (the secondary format):
 *     A flat grid, one row per stint. Useful for spreadsheet work
 *     and scripting. JSON-shaped fields remain JSON-encoded,
 *     because a spreadsheet consumer expects to parse them.
 *
 * FAIL-CLOSED:
 *   When CharacterQueries is unavailable, the module cannot build
 *   member records. Every export function returns an error result.
 *   It does NOT emit partial output.
 *
 * TEXT SHAPE:
 *
 *   Hollow Blades — Professional Teams Export
 *   Exported 2026-09-22
 *   3 teams · 11 members · 14 stints
 *
 *   ============================================================
 *   CRIMSON BLADES
 *   ============================================================
 *   Status:   Active (professional)
 *   Period:   1910 – present
 *   Class:    Class of 1910
 *   Team #:   3
 *
 *   --- Aldric Blackwood  (Captain) ----------------------------
 *   Stints:   1910 – present
 *   Age:      32
 *   Gender:   Male
 *   Build:    Athletic · 5'11" · 78kg
 *   Eyes:     Grey
 *   ...
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.TeamConstants    (normalizeTeamType)
 *   - window.CSV
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyQueries     (class display name)
 *   - window.CharacterConstants (stat key list)
 *   - window.MagicConstants     (magic type key list)
 */

(function() {
    'use strict';

    if (window.__teamExportLoaded) {
        return;
    }
    window.__teamExportLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamConstants = window.TeamConstants;
    var CSV = window.CSV;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }

    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
    }

    if (!CSV || typeof CSV.arrayToCSV !== 'function') {
        _missing.push('CSV.arrayToCSV');
    }

    if (!ExportUtils || typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyQueries() {
        return window.AcademyQueries || null;
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

    var TEXT_FILENAME_PREFIX = 'teams';
    var CSV_FILENAME_PREFIX = 'teams';

    var PROFESSIONAL_TYPE = 'professional';

    // Text formatting constants. Separators are chosen so a reader
    // scanning vertically can tell team boundaries from member
    // boundaries at a glance.
    var TEAM_SEPARATOR = '='.repeat(64);
    var MEMBER_SEPARATOR_LEN = 64;
    var SECTION_HEADER = '# TEAMS';

    // Header labels are padded to this width so values line up
    // within a block. Long labels (e.g. 'Appearance') are not
    // padded; the colon still anchors the value.
    var LABEL_WIDTH = 10;

    // CSV columns.
    var COLUMNS = [
        // ---- Team ----
        'TeamId',
        'TeamName',
        'TeamStatus',
        'TeamStartPeriod',
        'TeamEndPeriod',
        'TeamClass',
        'TeamNumber',
        // ---- Stint ----
        'MemberName',
        'MemberRole',
        'JoinPeriod',
        'LeavePeriod',
        // ---- Identity ----
        'FirstName',
        'MiddleName',
        'LastName',
        'Nickname',
        'Alias',
        'Age',
        'BirthYear',
        'Gender',
        // ---- Physical ----
        'Eyes',
        'Hair',
        'Skin',
        'Height',
        'Weight',
        'Build',
        'AppearanceNotes',
        // ---- Personality ----
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
        // ---- Combat ----
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

    /**
     * Is this value non-empty for text-output purposes?
     * A missing field is not emitted. An empty string is not
     * emitted. A zero is emitted (0 is data). A false is emitted
     * (false is data).
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
    // CHARACTER PROJECTION HELPERS
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

    function normaliseStints(member) {
        if (!member || !Array.isArray(member.intervals)) { return []; }
        var result = [];
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (!isObject(iv)) { continue; }
            result.push({
                joinPeriod: safeString(iv.joinPeriod),
                leavePeriod: safeString(iv.leavePeriod)
            });
        }
        return result;
    }

    // ============================================================
    // CLASS DISPLAY
    // ============================================================

    function getClassDisplay(classId) {
        if (!isNonEmptyString(classId)) { return ''; }
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getClassDisplayName === 'function') {
            try {
                var name = AQ.getClassDisplayName(classId);
                if (name && name !== 'Unknown Class') {
                    return String(name);
                }
            } catch (e) {
                // fall through
            }
        }
        return '';
    }

    // ============================================================
    // MEMBER RECORD PROJECTION
    // ============================================================

    function buildMissingCharacterStub(member) {
        return {
            memberId: isNonEmptyString(member.memberId)
                ? String(member.memberId)
                : '',
            characterId: String(member.characterId),
            role: isNonEmptyString(member.role)
                ? String(member.role)
                : 'Member',
            displayName: '(missing character)',
            stints: normaliseStints(member),

            firstName: '',
            middleName: '',
            lastName: '',
            nickname: '',
            alias: '',
            previousNames: [],

            age: '',
            birthYear: '',
            gender: '',
            attraction: '',
            sexuality: '',

            eyes: '',
            hair: '',
            skin: '',
            height: '',
            weight: '',
            build: '',
            appearanceNotes: '',

            traits: '',
            ideals: '',
            bonds: '',
            flaws: '',
            alignment: '',
            likes: '',
            dislikes: '',
            habits: '',
            fears: '',
            goals: '',

            stats: {},
            magic: {},
            hp: 0,
            mp: 0,
            weapons: [],
            specialMoves: { physical: [], magical: [] },
            combatNotes: ''
        };
    }

    function buildMemberRecord(member) {
        if (!member || !isNonEmptyString(member.characterId)) {
            return null;
        }

        var charId = String(member.characterId);
        var char = CharacterQueries.getCharacterById(charId);

        if (!char) {
            return buildMissingCharacterStub(member);
        }

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
            memberId: isNonEmptyString(member.memberId)
                ? String(member.memberId)
                : '',
            characterId: charId,
            role: isNonEmptyString(member.role)
                ? String(member.role)
                : 'Member',
            displayName: displayName,
            stints: normaliseStints(member),

            firstName: safeString(char.firstName),
            middleName: safeString(char.middleName),
            lastName: safeString(char.lastName),
            nickname: safeString(char.nickname),
            alias: safeString(char.alias),
            previousNames: normalisePreviousNames(char),

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
    // TEAM RECORD PROJECTION
    // ============================================================

    function buildTeamRecord(team) {
        if (!team || !team.id) { return null; }

        var membersRaw = TeamQueries.getAllTeamMemberRecords(team) || [];
        var members = [];

        for (var i = 0; i < membersRaw.length; i++) {
            var m = buildMemberRecord(membersRaw[i]);
            if (m) { members.push(m); }
        }

        members.sort(function(a, b) {
            var nameCmp = String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
            if (nameCmp !== 0) { return nameCmp; }

            var aJoin = a.stints.length > 0
                ? a.stints[0].joinPeriod
                : '';
            var bJoin = b.stints.length > 0
                ? b.stints[0].joinPeriod
                : '';
            return String(aJoin).localeCompare(String(bJoin));
        });

        var nameHistory = [];
        if (Array.isArray(team.nameHistory)) {
            for (var h = 0; h < team.nameHistory.length; h++) {
                var entry = team.nameHistory[h];
                if (!isObject(entry)) { continue; }
                nameHistory.push({
                    name: safeString(entry.name),
                    startPeriod: safeString(entry.startPeriod),
                    endPeriod: safeString(entry.endPeriod)
                });
            }
        }

        var classDisplay = getClassDisplay(team.classId);

        return {
            id: String(team.id),
            name: isNonEmptyString(team.name)
                ? String(team.name)
                : 'Unnamed Team',
            type: safeString(team.type),
            status: isNonEmptyString(team.status)
                ? String(team.status)
                : 'active',
            startPeriod: safeString(team.startPeriod),
            endPeriod: safeString(team.endPeriod),
            classId: isNonEmptyString(team.classId)
                ? String(team.classId)
                : null,
            classDisplay: classDisplay,
            teamNumber: safeString(team.teamNumber),
            temporaryMission: isNonEmptyString(team.temporaryMission)
                ? String(team.temporaryMission)
                : null,
            nameHistory: nameHistory,
            memberCount: members.length,
            members: members
        };
    }

    // ============================================================
    // PUBLIC PROJECTION
    // ============================================================

    /**
     * Get every professional team with its members and member stats.
     *
     * @param {object} [options]
     * @param {string} [options.status] - Optional status filter
     *   ('active' | 'inactive' | 'operational'). Default: no filter.
     * @returns {{
     *   teamCount: number,
     *   memberCount: number,
     *   stintCount: number,
     *   teams: Array
     * }}
     */
    function getTeams(options) {
        options = options || {};

        var statusFilter = isNonEmptyString(options.status)
            ? String(options.status)
            : null;

        var rawTeams;
        try {
            rawTeams = TeamQueries.getTeams(
                PROFESSIONAL_TYPE,
                statusFilter,
                /* includeDeprecated */ false
            ) || [];
        } catch (e) {
            console.warn('[TeamExport] TeamQueries.getTeams threw:', e);
            rawTeams = [];
        }

        var teams = [];
        var memberCount = 0;
        var stintCount = 0;

        for (var i = 0; i < rawTeams.length; i++) {
            var record = buildTeamRecord(rawTeams[i]);
            if (!record) { continue; }
            teams.push(record);
            memberCount += record.memberCount;
            for (var m = 0; m < record.members.length; m++) {
                stintCount += record.members[m].stints.length;
            }
        }

        teams.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            teamCount: teams.length,
            memberCount: memberCount,
            stintCount: stintCount,
            teams: teams
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
    //     content. No "Weapons: (none)" filler.
    //   - Sections collapse: a member with no personality data
    //     does not get a "Personality" header with empty lines.
    //   - Sub-objects flatten: stats become "STR 14 · DEX 12 · ..."
    //     not a JSON blob.
    //   - Stints on one line: "1910 – 1915, 1918 – present".
    //   - Separators carry hierarchy: === for teams, --- for
    //     members. No indentation to track.
    //   - Labels are padded to a fixed width so values line up
    //     within a member block.

    function padLabel(label) {
        var str = String(label);
        while (str.length < LABEL_WIDTH) {
            str += ' ';
        }
        return str;
    }

    /**
     * Emit a labelled line, or nothing if the value is empty.
     * The label is padded; the value is escaped to a single line
     * (newlines become spaces) so a multi-line notes field does
     * not break the block layout.
     */
    function textLine(label, value) {
        if (!hasText(value)) { return ''; }
        var v = String(value).replace(/\s+/g, ' ').trim();
        if (v === '') { return ''; }
        return padLabel(label) + ': ' + v + '\n';
    }

    /**
     * Format a stint list onto one line:
     *   "1910 – present"
     *   "1912 – 1915"
     *   "1912 – 1915, 1918 – present"
     *   "From 1910"
     *   "Until 1915"
     */
    function formatStints(stints) {
        if (!Array.isArray(stints) || stints.length === 0) {
            return '';
        }

        var parts = [];
        for (var i = 0; i < stints.length; i++) {
            var s = stints[i];
            var join = isNonEmptyString(s.joinPeriod)
                ? String(s.joinPeriod).trim()
                : '';
            var leave = isNonEmptyString(s.leavePeriod)
                ? String(s.leavePeriod).trim()
                : '';

            if (join && leave) {
                parts.push(join + ' \u2013 ' + leave);
            } else if (join) {
                parts.push(join + ' \u2013 present');
            } else if (leave) {
                parts.push('until ' + leave);
            } else {
                parts.push('(no dates)');
            }
        }

        return parts.join(', ');
    }

    /**
     * Format stats as "STR 14 · DEX 12 · ..." with each key
     * uppercased. Empty (all-zero) stats are treated as empty.
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
     * Format weapons as "Longsword (sharp), Dagger (sharp)".
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
     * Format special moves as "Physical: A, B · Magical: C".
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

    /**
     * Format a physical composite line:
     *   "Athletic · 5'11" · 78kg"
     * Only non-empty components appear.
     */
    function formatPhysicalComposite(member) {
        var parts = [];
        if (isNonEmptyString(member.build)) {
            parts.push(String(member.build));
        }
        if (isNonEmptyString(member.height)) {
            parts.push(String(member.height));
        }
        if (isNonEmptyString(member.weight)) {
            parts.push(String(member.weight));
        }
        return parts.join(' \u00b7 ');
    }

    /**
     * Format eyes/hair/skin as one line if any of them has content.
     *   "Grey / Black / Fair"
     */
    function formatColourComposite(member) {
        var parts = [];
        if (isNonEmptyString(member.eyes)) {
            parts.push(String(member.eyes));
        }
        if (isNonEmptyString(member.hair)) {
            parts.push(String(member.hair));
        }
        if (isNonEmptyString(member.skin)) {
            parts.push(String(member.skin));
        }
        return parts.join(' / ');
    }

    /**
     * Format a team status line:
     *   "Active (professional)"
     *   "Inactive (professional)"
     *   "Active (academic)"
     */
    function formatTeamStatus(team) {
        var status = isNonEmptyString(team.status)
            ? team.status
            : 'active';
        var capitalised = status.charAt(0).toUpperCase() +
            status.slice(1);
        var type = isNonEmptyString(team.type)
            ? team.type
            : '';
        if (type) {
            return capitalised + ' (' + type + ')';
        }
        return capitalised;
    }

    /**
     * Format a team period:
     *   "1910 – present"
     *   "1910 – 1915"
     *   "From 1910"
     *   "Until 1915"
     *   "(no period)"
     */
    function formatTeamPeriod(team) {
        var start = isNonEmptyString(team.startPeriod)
            ? String(team.startPeriod)
            : '';
        var end = isNonEmptyString(team.endPeriod)
            ? String(team.endPeriod)
            : '';

        if (start && end) { return start + ' \u2013 ' + end; }
        if (start) { return 'From ' + start; }
        if (end) { return 'Until ' + end; }
        return '';
    }

    /**
     * Build the header banner line for a member:
     *   "--- Aldric Blackwood  (Captain) ----------------------------"
     * The trailing dashes pad the line to MEMBER_SEPARATOR_LEN.
     */
    function buildMemberHeader(member) {
        var name = isNonEmptyString(member.displayName)
            ? member.displayName
            : 'Unknown';

        var roleSuffix = '';
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            roleSuffix = '  (' + member.role + ')';
        }

        var prefix = '--- ' + name + roleSuffix + ' ';
        if (prefix.length >= MEMBER_SEPARATOR_LEN) {
            return prefix;
        }
        return prefix + '-'.repeat(MEMBER_SEPARATOR_LEN - prefix.length);
    }

    /**
     * Emit the member's identity block.
     * Returns an empty string when the member has no identity
     * fields worth showing beyond the display name.
     */
    function emitIdentityLines(member) {
        var out = '';

        // Stints go first: they describe the member's relationship
        // to the team, which is the most important context.
        var stints = formatStints(member.stints);
        if (stints) {
            out += textLine('Stints', stints);
        }

        // Full name, if different from display name.
        var fullName = [member.firstName, member.middleName, member.lastName]
            .filter(isNonEmptyString)
            .join(' ');
        if (fullName && fullName !== member.displayName) {
            out += textLine('Name', fullName);
        }

        if (isNonEmptyString(member.nickname)) {
            out += textLine('Nickname', member.nickname);
        }
        if (isNonEmptyString(member.alias)) {
            out += textLine('Alias', member.alias);
        }

        if (Array.isArray(member.previousNames) &&
            member.previousNames.length > 0) {
            out += textLine(
                'Also',
                member.previousNames.join(', ')
            );
        }

        if (isNonEmptyString(member.age)) {
            out += textLine('Age', member.age);
        }
        if (isNonEmptyString(member.birthYear)) {
            out += textLine('Born', member.birthYear);
        }
        if (isNonEmptyString(member.gender)) {
            out += textLine('Gender', member.gender);
        }

        return out;
    }

    /**
     * Emit the physical block. Collapses entirely when empty.
     */
    function emitPhysicalLines(member) {
        var out = '';

        var composite = formatPhysicalComposite(member);
        if (composite) {
            out += textLine('Physical', composite);
        }

        var colours = formatColourComposite(member);
        if (colours) {
            out += textLine('Eyes/Hair', colours);
        }

        if (isNonEmptyString(member.appearanceNotes)) {
            out += textLine('Appearance', member.appearanceNotes);
        }

        return out;
    }

    /**
     * Emit the personality block. Collapses entirely when empty.
     */
    function emitPersonalityLines(member) {
        var out = '';

        if (isNonEmptyString(member.traits)) {
            out += textLine('Traits', member.traits);
        }
        if (isNonEmptyString(member.ideals)) {
            out += textLine('Ideals', member.ideals);
        }
        if (isNonEmptyString(member.bonds)) {
            out += textLine('Bonds', member.bonds);
        }
        if (isNonEmptyString(member.flaws)) {
            out += textLine('Flaws', member.flaws);
        }
        if (isNonEmptyString(member.alignment)) {
            out += textLine('Alignment', member.alignment);
        }
        if (isNonEmptyString(member.likes)) {
            out += textLine('Likes', member.likes);
        }
        if (isNonEmptyString(member.dislikes)) {
            out += textLine('Dislikes', member.dislikes);
        }
        if (isNonEmptyString(member.habits)) {
            out += textLine('Habits', member.habits);
        }
        if (isNonEmptyString(member.fears)) {
            out += textLine('Fears', member.fears);
        }
        if (isNonEmptyString(member.goals)) {
            out += textLine('Goals', member.goals);
        }

        return out;
    }

    /**
     * Emit the combat block. Collapses entirely when empty.
     *
     * Stats go on one line, HP and MP on another, weapons on
     * another, moves on another, combat notes on another. Only
     * the lines with content appear.
     */
    function emitCombatLines(member) {
        var out = '';

        var stats = formatStats(member.stats);
        if (stats) {
            out += textLine('Stats', stats);
        }

        var hpmp = '';
        if (isFiniteNumber(member.hp) && member.hp !== 0) {
            hpmp += 'HP ' + member.hp;
        }
        if (isFiniteNumber(member.mp) && member.mp !== 0) {
            if (hpmp) { hpmp += ' \u00b7 '; }
            hpmp += 'MP ' + member.mp;
        }
        if (hpmp) {
            out += textLine('Combat', hpmp);
        }

        var magic = formatMagic(member.magic);
        if (magic) {
            out += textLine('Magic', magic);
        }

        var weapons = formatWeapons(member.weapons);
        if (weapons) {
            out += textLine('Weapons', weapons);
        }

        var moves = formatSpecialMoves(member.specialMoves);
        if (moves) {
            out += textLine('Moves', moves);
        }

        if (isNonEmptyString(member.combatNotes)) {
            out += textLine('Notes', member.combatNotes);
        }

        return out;
    }

    /**
     * Emit one member block. Sections are separated by a blank
     * line if there is more than one section with content, so the
     * reader's eye can group them.
     */
    function emitMemberBlock(member) {
        var out = '';

        out += buildMemberHeader(member) + '\n';

        var identity = emitIdentityLines(member);
        var physical = emitPhysicalLines(member);
        var personality = emitPersonalityLines(member);
        var combat = emitCombatLines(member);

        var sections = [identity, physical, personality, combat]
            .filter(function(s) { return s !== ''; });

        for (var i = 0; i < sections.length; i++) {
            if (i > 0) { out += '\n'; }
            out += sections[i];
        }

        return out;
    }

    /**
     * Emit the header block for a team:
     *   ============================================================
     *   CRIMSON BLADES
     *   ============================================================
     *   Status:   Active (professional)
     *   Period:   1910 – present
     *   Class:    Class of 1910
     *   Team #:   3
     */
    function emitTeamHeader(team) {
        var out = '';

        out += TEAM_SEPARATOR + '\n';
        out += String(team.name).toUpperCase() + '\n';
        out += TEAM_SEPARATOR + '\n';

        out += textLine('Status', formatTeamStatus(team));

        var period = formatTeamPeriod(team);
        if (period) {
            out += textLine('Period', period);
        }

        if (isNonEmptyString(team.classDisplay)) {
            out += textLine('Class', team.classDisplay);
        }

        if (isNonEmptyString(team.teamNumber)) {
            out += textLine('Team #', team.teamNumber);
        }

        if (isNonEmptyString(team.temporaryMission)) {
            out += textLine('Mission', team.temporaryMission);
        }

        if (Array.isArray(team.nameHistory) &&
            team.nameHistory.length > 0) {
            var history = team.nameHistory.map(function(h) {
                var s = h.name;
                if (h.startPeriod || h.endPeriod) {
                    s += ' (' +
                        (h.startPeriod || '?') +
                        ' \u2013 ' +
                        (h.endPeriod || 'present') +
                        ')';
                }
                return s;
            }).join(', ');
            out += textLine('Formerly', history);
        }

        out += textLine(
            'Members',
            team.memberCount === 1
                ? '1 member'
                : team.memberCount + ' members'
        );

        out += '\n';

        return out;
    }

    /**
     * Build the full text export.
     *
     * @param {object} vm - The VM from getTeams()
     * @returns {string}
     */
    function buildTeamsText(vm) {
        var out = '';

        // ---- Header ----
        out += 'Hollow Blades \u2014 Professional Teams Export\n';
        out += 'Exported ' + new Date().toISOString().slice(0, 10) + '\n';
        out += vm.teamCount + ' team' +
            (vm.teamCount === 1 ? '' : 's') +
            ' \u00b7 ' + vm.memberCount + ' member' +
            (vm.memberCount === 1 ? '' : 's') +
            ' \u00b7 ' + vm.stintCount + ' stint' +
            (vm.stintCount === 1 ? '' : 's') +
            '\n\n';

        if (vm.teamCount === 0) {
            out += '(No professional teams match this filter.)\n';
            return out;
        }

        // ---- Teams ----
        for (var t = 0; t < vm.teams.length; t++) {
            var team = vm.teams[t];

            if (t > 0) {
                out += '\n';
            }

            out += emitTeamHeader(team);

            if (team.members.length === 0) {
                out += '(No members recorded.)\n';
                continue;
            }

            for (var m = 0; m < team.members.length; m++) {
                if (m > 0) {
                    out += '\n';
                }
                out += emitMemberBlock(team.members[m]);
            }
        }

        return out;
    }

    /**
     * Get the plain-text content as a string. No download.
     *
     * @param {object} [options]
     * @returns {string}
     */
    function getTeamsTextContent(options) {
        var vm = getTeams(options);
        return buildTeamsText(vm);
    }

    /**
     * Export the team list as a plain-text file.
     *
     * @param {object} [options]
     * @param {string} [options.filename]
     * @param {string} [options.status]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   teamCount: number,
     *   memberCount: number,
     *   error: string|null
     * }}
     */
    function exportTeamsText(options) {
        options = options || {};

        var vm = getTeams(options);

        if (vm.teamCount === 0) {
            return {
                exported: false,
                filename: null,
                teamCount: 0,
                memberCount: 0,
                error: 'No professional teams found.'
            };
        }

        var content = buildTeamsText(vm);

        // No BOM. A BOM is a Windows Notepad convention for CSV
        // files, and it produces a phantom character in vim, less,
        // and most Unix tooling. Plain text does not need it.
        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var filename = options.filename ||
            TEXT_FILENAME_PREFIX + '-' +
            new Date().toISOString().slice(0, 10) + '.txt';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                error: 'Failed to download text: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            error: null
        };
    }

    // ============================================================
    // CSV
    // ============================================================
    //
    // CSV is the secondary format. It is a flat grid — one row per
    // stint — that a spreadsheet or scripting tool can consume.
    // JSON-shaped fields (stats, magic, weapons, moves) remain
    // JSON-encoded, because a consumer of CSV expects to parse
    // them. Rows are separated by \r\n and the file carries a BOM,
    // both because Excel expects them.

    function buildMemberCSVRow(team, member, stint) {
        return [
            team.id,
            team.name,
            team.status,
            team.startPeriod,
            team.endPeriod,
            team.classDisplay,
            team.teamNumber,

            member.displayName,
            member.role,
            stint ? stint.joinPeriod : '',
            stint ? stint.leavePeriod : '',

            member.firstName,
            member.middleName,
            member.lastName,
            member.nickname,
            member.alias,
            member.age,
            member.birthYear,
            member.gender,

            member.eyes,
            member.hair,
            member.skin,
            member.height,
            member.weight,
            member.build,
            member.appearanceNotes,

            member.traits,
            member.ideals,
            member.bonds,
            member.flaws,
            member.alignment,
            member.likes,
            member.dislikes,
            member.habits,
            member.fears,
            member.goals,

            jsonOrEmpty(member.stats),
            jsonOrEmpty(member.magic),
            String(member.hp),
            String(member.mp),
            jsonOrEmpty(member.weapons),
            jsonOrEmpty(member.specialMoves),
            member.combatNotes
        ];
    }

    function buildCSVRows(vm) {
        var rows = [];

        rows.push([SECTION_HEADER]);
        rows.push(COLUMNS.slice());

        for (var t = 0; t < vm.teams.length; t++) {
            var team = vm.teams[t];

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];

                if (member.stints.length === 0) {
                    rows.push(buildMemberCSVRow(team, member, null));
                    continue;
                }

                for (var s = 0; s < member.stints.length; s++) {
                    rows.push(buildMemberCSVRow(
                        team, member, member.stints[s]
                    ));
                }
            }
        }

        return rows;
    }

    function getTeamsCSVContent(options) {
        var vm = getTeams(options);
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    function exportTeamsCSV(options) {
        options = options || {};

        var vm = getTeams(options);

        if (vm.teamCount === 0) {
            return {
                exported: false,
                filename: null,
                teamCount: 0,
                memberCount: 0,
                rowCount: 0,
                error: 'No professional teams found.'
            };
        }

        var content;
        try {
            content = CSV.arrayToCSV(buildCSVRows(vm));
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                rowCount: 0,
                error: 'Failed to serialize CSV: ' + e.message
            };
        }

        var blob = new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' +
            new Date().toISOString().slice(0, 10) + '.csv';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                rowCount: 0,
                error: 'Failed to download CSV: ' + e.message
            };
        }

        var rowCount = 0;
        for (var t = 0; t < vm.teams.length; t++) {
            for (var m = 0; m < vm.teams[t].members.length; m++) {
                var stints = vm.teams[t].members[m].stints.length;
                rowCount += stints === 0 ? 1 : stints;
            }
        }

        return {
            exported: true,
            filename: filename,
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            rowCount: rowCount,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExport = Object.freeze({
        // Projection
        getTeams: getTeams,

        // Text (primary)
        getTeamsTextContent: getTeamsTextContent,
        exportTeamsText: exportTeamsText,

        // CSV (secondary)
        getTeamsCSVContent: getTeamsCSVContent,
        exportTeamsCSV: exportTeamsCSV,

        // Constants
        COLUMNS: COLUMNS.slice(),
        SECTION_HEADER: SECTION_HEADER
    });

    (function verify() {
        var exports = window.TeamExport;
        var missing = [];

        var required = [
            'getTeams',
            'getTeamsTextContent',
            'exportTeamsText',
            'getTeamsCSVContent',
            'exportTeamsCSV'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExport] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();/**
 * js/import-export/team-export.js - Team Export
 * Exports all professional teams with their members, stints, and
 * each member's full character stats.
 *
 * Path: js/import-export/team-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "all professional teams".
 *
 * WHAT "PROFESSIONAL TEAM" MEANS HERE:
 *   Every team whose type normalises to 'professional'. Deprecated
 *   teams are excluded. Active and inactive teams are included.
 *
 *   This is a full export, not a period-scoped view. A team that
 *   disbanded in 1912 is still in the export. A member who left in
 *   1915 is still in the member list.
 *
 * TWO OUTPUT FORMATS:
 *
 *   TEXT (the primary format):
 *     A human-readable plain-text document. Designed to be opened
 *     in a text editor and read. Sparse: a line is emitted only
 *     when the field it describes has content. Sections collapse
 *     when empty. Sub-objects (stats, magic, weapons, moves) are
 *     flattened into prose. Stints collapse onto one line per
 *     member.
 *
 *     This is a PROJECTION, not a backup. It is deliberately lossy
 *     in structure — a reader who wants to re-import data should
 *     use the JSON envelope export at the application level.
 *
 *   CSV (the secondary format):
 *     A flat grid, one row per stint. Useful for spreadsheet work
 *     and scripting. JSON-shaped fields remain JSON-encoded,
 *     because a spreadsheet consumer expects to parse them.
 *
 * FAIL-CLOSED:
 *   When CharacterQueries is unavailable, the module cannot build
 *   member records. Every export function returns an error result.
 *   It does NOT emit partial output.
 *
 * TEXT SHAPE:
 *
 *   Hollow Blades — Professional Teams Export
 *   Exported 2026-09-22
 *   3 teams · 11 members · 14 stints
 *
 *   ============================================================
 *   CRIMSON BLADES
 *   ============================================================
 *   Status:   Active (professional)
 *   Period:   1910 – present
 *   Class:    Class of 1910
 *   Team #:   3
 *
 *   --- Aldric Blackwood  (Captain) ----------------------------
 *   Stints:   1910 – present
 *   Age:      32
 *   Gender:   Male
 *   Build:    Athletic · 5'11" · 78kg
 *   Eyes:     Grey
 *   ...
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.TeamConstants    (normalizeTeamType)
 *   - window.CSV
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyQueries     (class display name)
 *   - window.CharacterConstants (stat key list)
 *   - window.MagicConstants     (magic type key list)
 */

(function() {
    'use strict';

    if (window.__teamExportLoaded) {
        return;
    }
    window.__teamExportLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamConstants = window.TeamConstants;
    var CSV = window.CSV;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }

    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
    }

    if (!CSV || typeof CSV.arrayToCSV !== 'function') {
        _missing.push('CSV.arrayToCSV');
    }

    if (!ExportUtils || typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyQueries() {
        return window.AcademyQueries || null;
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

    var TEXT_FILENAME_PREFIX = 'teams';
    var CSV_FILENAME_PREFIX = 'teams';

    var PROFESSIONAL_TYPE = 'professional';

    // Text formatting constants. Separators are chosen so a reader
    // scanning vertically can tell team boundaries from member
    // boundaries at a glance.
    var TEAM_SEPARATOR = '='.repeat(64);
    var MEMBER_SEPARATOR_LEN = 64;
    var SECTION_HEADER = '# TEAMS';

    // Header labels are padded to this width so values line up
    // within a block. Long labels (e.g. 'Appearance') are not
    // padded; the colon still anchors the value.
    var LABEL_WIDTH = 10;

    // CSV columns.
    var COLUMNS = [
        // ---- Team ----
        'TeamId',
        'TeamName',
        'TeamStatus',
        'TeamStartPeriod',
        'TeamEndPeriod',
        'TeamClass',
        'TeamNumber',
        // ---- Stint ----
        'MemberName',
        'MemberRole',
        'JoinPeriod',
        'LeavePeriod',
        // ---- Identity ----
        'FirstName',
        'MiddleName',
        'LastName',
        'Nickname',
        'Alias',
        'Age',
        'BirthYear',
        'Gender',
        // ---- Physical ----
        'Eyes',
        'Hair',
        'Skin',
        'Height',
        'Weight',
        'Build',
        'AppearanceNotes',
        // ---- Personality ----
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
        // ---- Combat ----
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

    /**
     * Is this value non-empty for text-output purposes?
     * A missing field is not emitted. An empty string is not
     * emitted. A zero is emitted (0 is data). A false is emitted
     * (false is data).
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
    // CHARACTER PROJECTION HELPERS
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

    function normaliseStints(member) {
        if (!member || !Array.isArray(member.intervals)) { return []; }
        var result = [];
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (!isObject(iv)) { continue; }
            result.push({
                joinPeriod: safeString(iv.joinPeriod),
                leavePeriod: safeString(iv.leavePeriod)
            });
        }
        return result;
    }

    // ============================================================
    // CLASS DISPLAY
    // ============================================================

    function getClassDisplay(classId) {
        if (!isNonEmptyString(classId)) { return ''; }
        var AQ = getAcademyQueries();
        if (AQ && typeof AQ.getClassDisplayName === 'function') {
            try {
                var name = AQ.getClassDisplayName(classId);
                if (name && name !== 'Unknown Class') {
                    return String(name);
                }
            } catch (e) {
                // fall through
            }
        }
        return '';
    }

    // ============================================================
    // MEMBER RECORD PROJECTION
    // ============================================================

    function buildMissingCharacterStub(member) {
        return {
            memberId: isNonEmptyString(member.memberId)
                ? String(member.memberId)
                : '',
            characterId: String(member.characterId),
            role: isNonEmptyString(member.role)
                ? String(member.role)
                : 'Member',
            displayName: '(missing character)',
            stints: normaliseStints(member),

            firstName: '',
            middleName: '',
            lastName: '',
            nickname: '',
            alias: '',
            previousNames: [],

            age: '',
            birthYear: '',
            gender: '',
            attraction: '',
            sexuality: '',

            eyes: '',
            hair: '',
            skin: '',
            height: '',
            weight: '',
            build: '',
            appearanceNotes: '',

            traits: '',
            ideals: '',
            bonds: '',
            flaws: '',
            alignment: '',
            likes: '',
            dislikes: '',
            habits: '',
            fears: '',
            goals: '',

            stats: {},
            magic: {},
            hp: 0,
            mp: 0,
            weapons: [],
            specialMoves: { physical: [], magical: [] },
            combatNotes: ''
        };
    }

    function buildMemberRecord(member) {
        if (!member || !isNonEmptyString(member.characterId)) {
            return null;
        }

        var charId = String(member.characterId);
        var char = CharacterQueries.getCharacterById(charId);

        if (!char) {
            return buildMissingCharacterStub(member);
        }

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
            memberId: isNonEmptyString(member.memberId)
                ? String(member.memberId)
                : '',
            characterId: charId,
            role: isNonEmptyString(member.role)
                ? String(member.role)
                : 'Member',
            displayName: displayName,
            stints: normaliseStints(member),

            firstName: safeString(char.firstName),
            middleName: safeString(char.middleName),
            lastName: safeString(char.lastName),
            nickname: safeString(char.nickname),
            alias: safeString(char.alias),
            previousNames: normalisePreviousNames(char),

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
    // TEAM RECORD PROJECTION
    // ============================================================

    function buildTeamRecord(team) {
        if (!team || !team.id) { return null; }

        var membersRaw = TeamQueries.getAllTeamMemberRecords(team) || [];
        var members = [];

        for (var i = 0; i < membersRaw.length; i++) {
            var m = buildMemberRecord(membersRaw[i]);
            if (m) { members.push(m); }
        }

        members.sort(function(a, b) {
            var nameCmp = String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
            if (nameCmp !== 0) { return nameCmp; }

            var aJoin = a.stints.length > 0
                ? a.stints[0].joinPeriod
                : '';
            var bJoin = b.stints.length > 0
                ? b.stints[0].joinPeriod
                : '';
            return String(aJoin).localeCompare(String(bJoin));
        });

        var nameHistory = [];
        if (Array.isArray(team.nameHistory)) {
            for (var h = 0; h < team.nameHistory.length; h++) {
                var entry = team.nameHistory[h];
                if (!isObject(entry)) { continue; }
                nameHistory.push({
                    name: safeString(entry.name),
                    startPeriod: safeString(entry.startPeriod),
                    endPeriod: safeString(entry.endPeriod)
                });
            }
        }

        var classDisplay = getClassDisplay(team.classId);

        return {
            id: String(team.id),
            name: isNonEmptyString(team.name)
                ? String(team.name)
                : 'Unnamed Team',
            type: safeString(team.type),
            status: isNonEmptyString(team.status)
                ? String(team.status)
                : 'active',
            startPeriod: safeString(team.startPeriod),
            endPeriod: safeString(team.endPeriod),
            classId: isNonEmptyString(team.classId)
                ? String(team.classId)
                : null,
            classDisplay: classDisplay,
            teamNumber: safeString(team.teamNumber),
            temporaryMission: isNonEmptyString(team.temporaryMission)
                ? String(team.temporaryMission)
                : null,
            nameHistory: nameHistory,
            memberCount: members.length,
            members: members
        };
    }

    // ============================================================
    // PUBLIC PROJECTION
    // ============================================================

    /**
     * Get every professional team with its members and member stats.
     *
     * @param {object} [options]
     * @param {string} [options.status] - Optional status filter
     *   ('active' | 'inactive' | 'operational'). Default: no filter.
     * @returns {{
     *   teamCount: number,
     *   memberCount: number,
     *   stintCount: number,
     *   teams: Array
     * }}
     */
    function getTeams(options) {
        options = options || {};

        var statusFilter = isNonEmptyString(options.status)
            ? String(options.status)
            : null;

        var rawTeams;
        try {
            rawTeams = TeamQueries.getTeams(
                PROFESSIONAL_TYPE,
                statusFilter,
                /* includeDeprecated */ false
            ) || [];
        } catch (e) {
            console.warn('[TeamExport] TeamQueries.getTeams threw:', e);
            rawTeams = [];
        }

        var teams = [];
        var memberCount = 0;
        var stintCount = 0;

        for (var i = 0; i < rawTeams.length; i++) {
            var record = buildTeamRecord(rawTeams[i]);
            if (!record) { continue; }
            teams.push(record);
            memberCount += record.memberCount;
            for (var m = 0; m < record.members.length; m++) {
                stintCount += record.members[m].stints.length;
            }
        }

        teams.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            teamCount: teams.length,
            memberCount: memberCount,
            stintCount: stintCount,
            teams: teams
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
    //     content. No "Weapons: (none)" filler.
    //   - Sections collapse: a member with no personality data
    //     does not get a "Personality" header with empty lines.
    //   - Sub-objects flatten: stats become "STR 14 · DEX 12 · ..."
    //     not a JSON blob.
    //   - Stints on one line: "1910 – 1915, 1918 – present".
    //   - Separators carry hierarchy: === for teams, --- for
    //     members. No indentation to track.
    //   - Labels are padded to a fixed width so values line up
    //     within a member block.

    function padLabel(label) {
        var str = String(label);
        while (str.length < LABEL_WIDTH) {
            str += ' ';
        }
        return str;
    }

    /**
     * Emit a labelled line, or nothing if the value is empty.
     * The label is padded; the value is escaped to a single line
     * (newlines become spaces) so a multi-line notes field does
     * not break the block layout.
     */
    function textLine(label, value) {
        if (!hasText(value)) { return ''; }
        var v = String(value).replace(/\s+/g, ' ').trim();
        if (v === '') { return ''; }
        return padLabel(label) + ': ' + v + '\n';
    }

    /**
     * Format a stint list onto one line:
     *   "1910 – present"
     *   "1912 – 1915"
     *   "1912 – 1915, 1918 – present"
     *   "From 1910"
     *   "Until 1915"
     */
    function formatStints(stints) {
        if (!Array.isArray(stints) || stints.length === 0) {
            return '';
        }

        var parts = [];
        for (var i = 0; i < stints.length; i++) {
            var s = stints[i];
            var join = isNonEmptyString(s.joinPeriod)
                ? String(s.joinPeriod).trim()
                : '';
            var leave = isNonEmptyString(s.leavePeriod)
                ? String(s.leavePeriod).trim()
                : '';

            if (join && leave) {
                parts.push(join + ' \u2013 ' + leave);
            } else if (join) {
                parts.push(join + ' \u2013 present');
            } else if (leave) {
                parts.push('until ' + leave);
            } else {
                parts.push('(no dates)');
            }
        }

        return parts.join(', ');
    }

    /**
     * Format stats as "STR 14 · DEX 12 · ..." with each key
     * uppercased. Empty (all-zero) stats are treated as empty.
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
     * Format weapons as "Longsword (sharp), Dagger (sharp)".
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
     * Format special moves as "Physical: A, B · Magical: C".
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

    /**
     * Format a physical composite line:
     *   "Athletic · 5'11" · 78kg"
     * Only non-empty components appear.
     */
    function formatPhysicalComposite(member) {
        var parts = [];
        if (isNonEmptyString(member.build)) {
            parts.push(String(member.build));
        }
        if (isNonEmptyString(member.height)) {
            parts.push(String(member.height));
        }
        if (isNonEmptyString(member.weight)) {
            parts.push(String(member.weight));
        }
        return parts.join(' \u00b7 ');
    }

    /**
     * Format eyes/hair/skin as one line if any of them has content.
     *   "Grey / Black / Fair"
     */
    function formatColourComposite(member) {
        var parts = [];
        if (isNonEmptyString(member.eyes)) {
            parts.push(String(member.eyes));
        }
        if (isNonEmptyString(member.hair)) {
            parts.push(String(member.hair));
        }
        if (isNonEmptyString(member.skin)) {
            parts.push(String(member.skin));
        }
        return parts.join(' / ');
    }

    /**
     * Format a team status line:
     *   "Active (professional)"
     *   "Inactive (professional)"
     *   "Active (academic)"
     */
    function formatTeamStatus(team) {
        var status = isNonEmptyString(team.status)
            ? team.status
            : 'active';
        var capitalised = status.charAt(0).toUpperCase() +
            status.slice(1);
        var type = isNonEmptyString(team.type)
            ? team.type
            : '';
        if (type) {
            return capitalised + ' (' + type + ')';
        }
        return capitalised;
    }

    /**
     * Format a team period:
     *   "1910 – present"
     *   "1910 – 1915"
     *   "From 1910"
     *   "Until 1915"
     *   "(no period)"
     */
    function formatTeamPeriod(team) {
        var start = isNonEmptyString(team.startPeriod)
            ? String(team.startPeriod)
            : '';
        var end = isNonEmptyString(team.endPeriod)
            ? String(team.endPeriod)
            : '';

        if (start && end) { return start + ' \u2013 ' + end; }
        if (start) { return 'From ' + start; }
        if (end) { return 'Until ' + end; }
        return '';
    }

    /**
     * Build the header banner line for a member:
     *   "--- Aldric Blackwood  (Captain) ----------------------------"
     * The trailing dashes pad the line to MEMBER_SEPARATOR_LEN.
     */
    function buildMemberHeader(member) {
        var name = isNonEmptyString(member.displayName)
            ? member.displayName
            : 'Unknown';

        var roleSuffix = '';
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            roleSuffix = '  (' + member.role + ')';
        }

        var prefix = '--- ' + name + roleSuffix + ' ';
        if (prefix.length >= MEMBER_SEPARATOR_LEN) {
            return prefix;
        }
        return prefix + '-'.repeat(MEMBER_SEPARATOR_LEN - prefix.length);
    }

    /**
     * Emit the member's identity block.
     * Returns an empty string when the member has no identity
     * fields worth showing beyond the display name.
     */
    function emitIdentityLines(member) {
        var out = '';

        // Stints go first: they describe the member's relationship
        // to the team, which is the most important context.
        var stints = formatStints(member.stints);
        if (stints) {
            out += textLine('Stints', stints);
        }

        // Full name, if different from display name.
        var fullName = [member.firstName, member.middleName, member.lastName]
            .filter(isNonEmptyString)
            .join(' ');
        if (fullName && fullName !== member.displayName) {
            out += textLine('Name', fullName);
        }

        if (isNonEmptyString(member.nickname)) {
            out += textLine('Nickname', member.nickname);
        }
        if (isNonEmptyString(member.alias)) {
            out += textLine('Alias', member.alias);
        }

        if (Array.isArray(member.previousNames) &&
            member.previousNames.length > 0) {
            out += textLine(
                'Also',
                member.previousNames.join(', ')
            );
        }

        if (isNonEmptyString(member.age)) {
            out += textLine('Age', member.age);
        }
        if (isNonEmptyString(member.birthYear)) {
            out += textLine('Born', member.birthYear);
        }
        if (isNonEmptyString(member.gender)) {
            out += textLine('Gender', member.gender);
        }

        return out;
    }

    /**
     * Emit the physical block. Collapses entirely when empty.
     */
    function emitPhysicalLines(member) {
        var out = '';

        var composite = formatPhysicalComposite(member);
        if (composite) {
            out += textLine('Physical', composite);
        }

        var colours = formatColourComposite(member);
        if (colours) {
            out += textLine('Eyes/Hair', colours);
        }

        if (isNonEmptyString(member.appearanceNotes)) {
            out += textLine('Appearance', member.appearanceNotes);
        }

        return out;
    }

    /**
     * Emit the personality block. Collapses entirely when empty.
     */
    function emitPersonalityLines(member) {
        var out = '';

        if (isNonEmptyString(member.traits)) {
            out += textLine('Traits', member.traits);
        }
        if (isNonEmptyString(member.ideals)) {
            out += textLine('Ideals', member.ideals);
        }
        if (isNonEmptyString(member.bonds)) {
            out += textLine('Bonds', member.bonds);
        }
        if (isNonEmptyString(member.flaws)) {
            out += textLine('Flaws', member.flaws);
        }
        if (isNonEmptyString(member.alignment)) {
            out += textLine('Alignment', member.alignment);
        }
        if (isNonEmptyString(member.likes)) {
            out += textLine('Likes', member.likes);
        }
        if (isNonEmptyString(member.dislikes)) {
            out += textLine('Dislikes', member.dislikes);
        }
        if (isNonEmptyString(member.habits)) {
            out += textLine('Habits', member.habits);
        }
        if (isNonEmptyString(member.fears)) {
            out += textLine('Fears', member.fears);
        }
        if (isNonEmptyString(member.goals)) {
            out += textLine('Goals', member.goals);
        }

        return out;
    }

    /**
     * Emit the combat block. Collapses entirely when empty.
     *
     * Stats go on one line, HP and MP on another, weapons on
     * another, moves on another, combat notes on another. Only
     * the lines with content appear.
     */
    function emitCombatLines(member) {
        var out = '';

        var stats = formatStats(member.stats);
        if (stats) {
            out += textLine('Stats', stats);
        }

        var hpmp = '';
        if (isFiniteNumber(member.hp) && member.hp !== 0) {
            hpmp += 'HP ' + member.hp;
        }
        if (isFiniteNumber(member.mp) && member.mp !== 0) {
            if (hpmp) { hpmp += ' \u00b7 '; }
            hpmp += 'MP ' + member.mp;
        }
        if (hpmp) {
            out += textLine('Combat', hpmp);
        }

        var magic = formatMagic(member.magic);
        if (magic) {
            out += textLine('Magic', magic);
        }

        var weapons = formatWeapons(member.weapons);
        if (weapons) {
            out += textLine('Weapons', weapons);
        }

        var moves = formatSpecialMoves(member.specialMoves);
        if (moves) {
            out += textLine('Moves', moves);
        }

        if (isNonEmptyString(member.combatNotes)) {
            out += textLine('Notes', member.combatNotes);
        }

        return out;
    }

    /**
     * Emit one member block. Sections are separated by a blank
     * line if there is more than one section with content, so the
     * reader's eye can group them.
     */
    function emitMemberBlock(member) {
        var out = '';

        out += buildMemberHeader(member) + '\n';

        var identity = emitIdentityLines(member);
        var physical = emitPhysicalLines(member);
        var personality = emitPersonalityLines(member);
        var combat = emitCombatLines(member);

        var sections = [identity, physical, personality, combat]
            .filter(function(s) { return s !== ''; });

        for (var i = 0; i < sections.length; i++) {
            if (i > 0) { out += '\n'; }
            out += sections[i];
        }

        return out;
    }

    /**
     * Emit the header block for a team:
     *   ============================================================
     *   CRIMSON BLADES
     *   ============================================================
     *   Status:   Active (professional)
     *   Period:   1910 – present
     *   Class:    Class of 1910
     *   Team #:   3
     */
    function emitTeamHeader(team) {
        var out = '';

        out += TEAM_SEPARATOR + '\n';
        out += String(team.name).toUpperCase() + '\n';
        out += TEAM_SEPARATOR + '\n';

        out += textLine('Status', formatTeamStatus(team));

        var period = formatTeamPeriod(team);
        if (period) {
            out += textLine('Period', period);
        }

        if (isNonEmptyString(team.classDisplay)) {
            out += textLine('Class', team.classDisplay);
        }

        if (isNonEmptyString(team.teamNumber)) {
            out += textLine('Team #', team.teamNumber);
        }

        if (isNonEmptyString(team.temporaryMission)) {
            out += textLine('Mission', team.temporaryMission);
        }

        if (Array.isArray(team.nameHistory) &&
            team.nameHistory.length > 0) {
            var history = team.nameHistory.map(function(h) {
                var s = h.name;
                if (h.startPeriod || h.endPeriod) {
                    s += ' (' +
                        (h.startPeriod || '?') +
                        ' \u2013 ' +
                        (h.endPeriod || 'present') +
                        ')';
                }
                return s;
            }).join(', ');
            out += textLine('Formerly', history);
        }

        out += textLine(
            'Members',
            team.memberCount === 1
                ? '1 member'
                : team.memberCount + ' members'
        );

        out += '\n';

        return out;
    }

    /**
     * Build the full text export.
     *
     * @param {object} vm - The VM from getTeams()
     * @returns {string}
     */
    function buildTeamsText(vm) {
        var out = '';

        // ---- Header ----
        out += 'Hollow Blades \u2014 Professional Teams Export\n';
        out += 'Exported ' + new Date().toISOString().slice(0, 10) + '\n';
        out += vm.teamCount + ' team' +
            (vm.teamCount === 1 ? '' : 's') +
            ' \u00b7 ' + vm.memberCount + ' member' +
            (vm.memberCount === 1 ? '' : 's') +
            ' \u00b7 ' + vm.stintCount + ' stint' +
            (vm.stintCount === 1 ? '' : 's') +
            '\n\n';

        if (vm.teamCount === 0) {
            out += '(No professional teams match this filter.)\n';
            return out;
        }

        // ---- Teams ----
        for (var t = 0; t < vm.teams.length; t++) {
            var team = vm.teams[t];

            if (t > 0) {
                out += '\n';
            }

            out += emitTeamHeader(team);

            if (team.members.length === 0) {
                out += '(No members recorded.)\n';
                continue;
            }

            for (var m = 0; m < team.members.length; m++) {
                if (m > 0) {
                    out += '\n';
                }
                out += emitMemberBlock(team.members[m]);
            }
        }

        return out;
    }

    /**
     * Get the plain-text content as a string. No download.
     *
     * @param {object} [options]
     * @returns {string}
     */
    function getTeamsTextContent(options) {
        var vm = getTeams(options);
        return buildTeamsText(vm);
    }

    /**
     * Export the team list as a plain-text file.
     *
     * @param {object} [options]
     * @param {string} [options.filename]
     * @param {string} [options.status]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   teamCount: number,
     *   memberCount: number,
     *   error: string|null
     * }}
     */
    function exportTeamsText(options) {
        options = options || {};

        var vm = getTeams(options);

        if (vm.teamCount === 0) {
            return {
                exported: false,
                filename: null,
                teamCount: 0,
                memberCount: 0,
                error: 'No professional teams found.'
            };
        }

        var content = buildTeamsText(vm);

        // No BOM. A BOM is a Windows Notepad convention for CSV
        // files, and it produces a phantom character in vim, less,
        // and most Unix tooling. Plain text does not need it.
        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var filename = options.filename ||
            TEXT_FILENAME_PREFIX + '-' +
            new Date().toISOString().slice(0, 10) + '.txt';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                error: 'Failed to download text: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            error: null
        };
    }

    // ============================================================
    // CSV
    // ============================================================
    //
    // CSV is the secondary format. It is a flat grid — one row per
    // stint — that a spreadsheet or scripting tool can consume.
    // JSON-shaped fields (stats, magic, weapons, moves) remain
    // JSON-encoded, because a consumer of CSV expects to parse
    // them. Rows are separated by \r\n and the file carries a BOM,
    // both because Excel expects them.

    function buildMemberCSVRow(team, member, stint) {
        return [
            team.id,
            team.name,
            team.status,
            team.startPeriod,
            team.endPeriod,
            team.classDisplay,
            team.teamNumber,

            member.displayName,
            member.role,
            stint ? stint.joinPeriod : '',
            stint ? stint.leavePeriod : '',

            member.firstName,
            member.middleName,
            member.lastName,
            member.nickname,
            member.alias,
            member.age,
            member.birthYear,
            member.gender,

            member.eyes,
            member.hair,
            member.skin,
            member.height,
            member.weight,
            member.build,
            member.appearanceNotes,

            member.traits,
            member.ideals,
            member.bonds,
            member.flaws,
            member.alignment,
            member.likes,
            member.dislikes,
            member.habits,
            member.fears,
            member.goals,

            jsonOrEmpty(member.stats),
            jsonOrEmpty(member.magic),
            String(member.hp),
            String(member.mp),
            jsonOrEmpty(member.weapons),
            jsonOrEmpty(member.specialMoves),
            member.combatNotes
        ];
    }

    function buildCSVRows(vm) {
        var rows = [];

        rows.push([SECTION_HEADER]);
        rows.push(COLUMNS.slice());

        for (var t = 0; t < vm.teams.length; t++) {
            var team = vm.teams[t];

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];

                if (member.stints.length === 0) {
                    rows.push(buildMemberCSVRow(team, member, null));
                    continue;
                }

                for (var s = 0; s < member.stints.length; s++) {
                    rows.push(buildMemberCSVRow(
                        team, member, member.stints[s]
                    ));
                }
            }
        }

        return rows;
    }

    function getTeamsCSVContent(options) {
        var vm = getTeams(options);
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    function exportTeamsCSV(options) {
        options = options || {};

        var vm = getTeams(options);

        if (vm.teamCount === 0) {
            return {
                exported: false,
                filename: null,
                teamCount: 0,
                memberCount: 0,
                rowCount: 0,
                error: 'No professional teams found.'
            };
        }

        var content;
        try {
            content = CSV.arrayToCSV(buildCSVRows(vm));
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                rowCount: 0,
                error: 'Failed to serialize CSV: ' + e.message
            };
        }

        var blob = new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename ||
            CSV_FILENAME_PREFIX + '-' +
            new Date().toISOString().slice(0, 10) + '.csv';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                rowCount: 0,
                error: 'Failed to download CSV: ' + e.message
            };
        }

        var rowCount = 0;
        for (var t = 0; t < vm.teams.length; t++) {
            for (var m = 0; m < vm.teams[t].members.length; m++) {
                var stints = vm.teams[t].members[m].stints.length;
                rowCount += stints === 0 ? 1 : stints;
            }
        }

        return {
            exported: true,
            filename: filename,
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            rowCount: rowCount,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExport = Object.freeze({
        // Projection
        getTeams: getTeams,

        // Text (primary)
        getTeamsTextContent: getTeamsTextContent,
        exportTeamsText: exportTeamsText,

        // CSV (secondary)
        getTeamsCSVContent: getTeamsCSVContent,
        exportTeamsCSV: exportTeamsCSV,

        // Constants
        COLUMNS: COLUMNS.slice(),
        SECTION_HEADER: SECTION_HEADER
    });

    (function verify() {
        var exports = window.TeamExport;
        var missing = [];

        var required = [
            'getTeams',
            'getTeamsTextContent',
            'exportTeamsText',
            'getTeamsCSVContent',
            'exportTeamsCSV'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExport] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
