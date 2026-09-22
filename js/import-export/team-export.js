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
 * WHAT A MEMBER RECORD CONTAINS:
 *   The member's role, every stint (join/leave interval), and the
 *   member's character stats:
 *     - identity  (name fields, previousNames, displayName)
 *     - physical  (age, birthYear, gender, eyes, hair, skin,
 *                  height, weight, build, appearanceNotes)
 *     - personality (traits, ideals, bonds, flaws, alignment,
 *                  likes, dislikes, habits, fears, goals)
 *     - combat    (stats, magic, hp, mp, weapons, specialMoves,
 *                  combatNotes)
 *
 * FAIL-CLOSED:
 *   When CharacterQueries is unavailable, the module cannot build
 *   member records. Every export function returns an error result.
 *   It does NOT emit partial rows.
 *
 *   When ObjectUtils is unavailable, cloning falls back to a local
 *   structural clone. The module still works.
 *
 * JSON SHAPE (deliberately NOT the application envelope):
 *   A team export is a projection over state, not a backup of it.
 *   It gets its own top-level shape, so it cannot be fed to
 *   ImportPipeline (which is correct — importing a team export as
 *   application state would be nonsense).
 *
 *     {
 *       exportedAt: ISO string,
 *       teamCount:  number,
 *       teams:      [TeamRecord, ...]
 *     }
 *
 *   TeamRecord:
 *     {
 *       id, name, type, status,
 *       startPeriod, endPeriod,
 *       classId, classDisplay, teamNumber,
 *       temporaryMission,
 *       nameHistory: [ { name, startPeriod, endPeriod } ],
 *       memberCount: number,
 *       members: [MemberRecord, ...]
 *     }
 *
 *   MemberRecord:
 *     {
 *       memberId, characterId, role, displayName,
 *       stints: [ { joinPeriod, leavePeriod } ],
 *       // full character projection:
 *       firstName, middleName, lastName, nickname, alias,
 *       previousNames: [string],
 *       age, birthYear, gender, attraction, sexuality,
 *       eyes, hair, skin, height, weight, build, appearanceNotes,
 *       traits, ideals, bonds, flaws, alignment,
 *       likes, dislikes, habits, fears, goals,
 *       stats, magic, hp, mp, weapons, specialMoves, combatNotes
 *     }
 *
 * CSV SHAPE (flat, one row per stint):
 *   A member with two stints produces two rows. Both rows carry
 *   the same character data; only JoinPeriod and LeavePeriod
 *   differ. This is the flattening CSV requires.
 *
 *   Columns:
 *     TeamName, TeamStatus, TeamStartPeriod, TeamEndPeriod,
 *     MemberName, MemberRole, JoinPeriod, LeavePeriod,
 *     Age, BirthYear, Gender, Eyes, Hair, Skin, Height, Weight,
 *     Build, Traits, Ideals, Bonds, Flaws, Alignment,
 *     Likes, Dislikes, Habits, Fears, Goals,
 *     Stats, Magic, HP, MP, Weapons, SpecialMoves,
 *     AppearanceNotes, CombatNotes
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.TeamConstants    (normalizeTeamType)
 *   - window.CSV
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyQueries   (class display name)
 *   - window.CharacterConstants (stat key list)
 *   - window.MagicConstants   (magic type key list)
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

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    var CSV_FILENAME_PREFIX = 'teams';
    var JSON_FILENAME_PREFIX = 'teams';
    var SECTION_HEADER = '# TEAMS';

    var PROFESSIONAL_TYPE = 'professional';

    // CSV columns. Grouped by owner so a reader can see at a glance
    // which fields belong to the team and which to the member.
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

    function sanitiseForFilename(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'teams';
    }

    /**
     * Local structural clone. Used when ObjectUtils is unavailable.
     * Mirrors the shape of ObjectUtils.deepClone for the JSON-shaped
     * values this module handles.
     */
    function localClone(value) {
        if (value === null || value === undefined) { return value; }
        var type = typeof value;
        if (type !== 'object') { return value; }
        if (Array.isArray(value)) {
            var arr = new Array(value.length);
            for (var i = 0; i < value.length; i++) {
                arr[i] = localClone(value[i]);
            }
            return arr;
        }
        if (value instanceof Date) {
            return new Date(value.getTime());
        }
        var result = {};
        var keys = Object.keys(value);
        for (var j = 0; j < keys.length; j++) {
            result[keys[j]] = localClone(value[keys[j]]);
        }
        return result;
    }

    function cloneValue(value) {
        var OU = getObjectUtils();
        if (OU && typeof OU.deepClone === 'function') {
            try {
                return OU.deepClone(value);
            } catch (e) {
                // fall through to local
            }
        }
        return localClone(value);
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

    function buildMemberRecord(member) {
        if (!member || !isNonEmptyString(member.characterId)) {
            return null;
        }

        var charId = String(member.characterId);
        var char = CharacterQueries.getCharacterById(charId);

        if (!char) {
            // The team references a character that no longer exists.
            // Emit a stub so the team's member list is not silently
            // shortened. The stub carries the ID and role from the
            // member entry, plus the stints; every character field
            // is empty.
            return {
                memberId: isNonEmptyString(member.memberId)
                    ? String(member.memberId)
                    : '',
                characterId: charId,
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

            // ---- Identity ----
            firstName: safeString(char.firstName),
            middleName: safeString(char.middleName),
            lastName: safeString(char.lastName),
            nickname: safeString(char.nickname),
            alias: safeString(char.alias),
            previousNames: normalisePreviousNames(char),

            // ---- Physical ----
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

            // ---- Personality ----
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

            // ---- Combat ----
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

        // Sort members by display name, then by earliest join.
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
     *   ('active' | 'inactive' | 'operational'). Default: no filter
     *   (deprecated already excluded by TeamQueries).
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
    // CSV
    // ============================================================
    //
    // One row per (team, member, stint). A member with zero stints
    // still produces one row with blank JoinPeriod / LeavePeriod,
    // because the member's identity and stats are worth exporting
    // even when the stint data is missing.

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

    /**
     * Get the CSV content as a string. No download.
     *
     * @param {object} [options]
     * @returns {string}
     */
    function getTeamsCSVContent(options) {
        var vm = getTeams(options);
        var rows = buildCSVRows(vm);
        return CSV.arrayToCSV(rows);
    }

    /**
     * Export the team list as a CSV file.
     *
     * @param {object} [options]
     * @param {string} [options.filename]
     * @param {string} [options.status]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   teamCount: number,
     *   memberCount: number,
     *   rowCount: number,
     *   error: string|null
     * }}
     */
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

        // Row count = team rows + one per stint (or one for
        // stintless members).
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
    // JSON
    // ============================================================

    /**
     * Build the JSON document object without downloading.
     *
     * @param {object} [options]
     * @returns {object}
     */
    function getTeamsJSONDocument(options) {
        options = options || {};
        var vm = getTeams(options);

        return {
            exportedAt: new Date().toISOString(),
            teamCount: vm.teamCount,
            memberCount: vm.memberCount,
            stintCount: vm.stintCount,
            teams: vm.teams
        };
    }

    /**
     * Export the team list as a JSON file.
     *
     * @param {object} [options]
     * @param {string} [options.filename]
     * @param {boolean} [options.pretty] - Pretty print (default: true)
     * @param {string} [options.status]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   teamCount: number,
     *   memberCount: number,
     *   error: string|null
     * }}
     */
    function exportTeamsJSON(options) {
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

        var document = getTeamsJSONDocument(options);

        var serialised;
        try {
            serialised = JSON.stringify(
                document,
                null,
                options.pretty !== false ? 2 : 0
            );
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                error: 'Failed to serialize JSON: ' + e.message
            };
        }

        var filename = options.filename ||
            JSON_FILENAME_PREFIX + '-' +
            new Date().toISOString().slice(0, 10) + '.json';

        try {
            var blob = new Blob([serialised], {
                type: 'application/json'
            });
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                error: 'Failed to download JSON: ' + e.message
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
    // EXPOSE
    // ============================================================

    window.TeamExport = Object.freeze({
        // Projection
        getTeams: getTeams,

        // JSON
        getTeamsJSONDocument: getTeamsJSONDocument,
        exportTeamsJSON: exportTeamsJSON,

        // CSV
        getTeamsCSVContent: getTeamsCSVContent,
        exportTeamsCSV: exportTeamsCSV,

        // Constants
        COLUMNS: COLUMNS.slice(),
        SECTION_HEADER: SECTION_HEADER
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamExport;
        var missing = [];

        var required = [
            'getTeams',
            'getTeamsJSONDocument',
            'exportTeamsJSON',
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
