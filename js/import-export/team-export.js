/**
 * js/import-export/team-export.js - Team Export Bundle
 *
 * CANONICAL SOURCE for every team-related export operation. One
 * file, two namespaces, two concerns:
 *
 *   window.TeamExport         professional team data export
 *                               - getTeams()
 *                               - getTeamsTextContent()
 *                               - exportTeamsText()
 *                               - getTeamsCSVContent()
 *                               - exportTeamsCSV()
 *
 *   window.TeamExportPicker   modal that offers the two formats
 *                               - openModal()
 *                               - closeModal()
 *
 * WHY TWO NAMESPACES IN ONE FILE:
 *   The picker exists only to offer the two TeamExport formats.
 *   There is no other consumer of TeamExportPicker, and the picker
 *   has no behaviour beyond routing to TeamExport. Keeping them in
 *   one file makes the "one team export concern" boundary obvious:
 *   the data projection and the UI that triggers it live together.
 *
 *   Contrast with the character side, where CharacterExportPicker
 *   is deliberately separate from CharacterExport because the
 *   character export bundle already has three namespaces and the
 *   picker is a distinct interface for a distinct menu.
 *
 * PUBLIC API STABILITY:
 *   Every consumer that reached for window.TeamExport or
 *   window.TeamExportPicker by name continues to find them.
 *   Consolidating the files does NOT change the public surface.
 *
 * CONSOLIDATION HISTORY:
 *   This file previously existed as two separate modules:
 *     team-export.js          (professional team text + CSV export)
 *     team-export-picker.js   (modal offering the two formats)
 *
 *   They were merged because the picker is a thin wrapper around
 *   the exporter, with no independent lifecycle and no other
 *   consumer.
 *
 * SECTIONS IN THIS FILE, IN ORDER:
 *   1. Shared dependencies and helpers
 *   2. TeamExport         — text + CSV projection of teams
 *   3. TeamExportPicker   — modal shell
 *
 * ============================================================
 * SECTION 1: SHARED DEPENDENCIES AND HELPERS
 * ============================================================
 *
 * MANDATORY (for TeamExport):
 *   window.TeamQueries       (from team-queries.js)
 *   window.CharacterQueries  (from character-queries.js)
 *   window.TeamConstants     (from team-constants.js)
 *   window.CSV               (from csv-parser.js)
 *   window.ExportUtils       (from export-utils.js)
 *
 * MANDATORY (for TeamExportPicker, in addition):
 *   window.DomUtils              (from dom-utils.js)
 *   window.Modal                 (from modal.js)
 *   window.NotificationSystem    (from notification.js)
 *
 * All mandatory dependencies are checked here, in the shared
 * preamble. The check is fail-fast: a missing dependency throws
 * at load time with a clear message rather than producing a
 * half-working module that fails silently on first use.
 */

(function() {
    'use strict';

    if (window.__teamExportBundleLoaded) {
        return;
    }
    window.__teamExportBundleLoaded = true;

    // ============================================================
    // SHARED DEPENDENCY CHECK
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamConstants = window.TeamConstants;
    var CSV = window.CSV;
    var ExportUtils = window.ExportUtils;

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    // ---- TeamExport mandatory ----

    if (!TeamQueries ||
        typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getAllTeamMemberRecords !==
            'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !==
            'function') {
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
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    // ---- TeamExportPicker mandatory ----

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // SHARED SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    // ============================================================
    // SECTION 2: TeamExport
    // ============================================================
    //
    // Professional team data export, text and CSV. Every team whose
    // type normalises to 'professional'. Deprecated teams are
    // excluded. Active and inactive teams are included.
    //
    // WHAT THE TEXT FORMAT IS:
    //   A human-readable document. Sparse. A line appears only when
    //   the field it describes has content. Sub-objects flatten to
    //   prose. This is the primary format.
    //
    // WHAT THE CSV FORMAT IS:
    //   A flat grid, one row per stint. Useful for spreadsheet work
    //   and scripting. JSON-shaped fields remain JSON-encoded.
    //
    // FAIL-CLOSED:
    //   When CharacterQueries is unavailable, the module cannot
    //   build member records. That is enforced by the shared
    //   dependency check at the top of this file. The module
    //   refuses to load rather than emitting partial output.

    (function() {

        // ---- Constants ----

        var DEFAULT_STAT_KEYS =
            ['str', 'dex', 'con', 'int', 'wis', 'cha'];

        var TEXT_FILENAME_PREFIX = 'teams';
        var CSV_FILENAME_PREFIX = 'teams';

        var PROFESSIONAL_TYPE = 'professional';

        var TEAM_SEPARATOR = '='.repeat(64);
        var MEMBER_SEPARATOR_LEN = 64;
        var SECTION_HEADER = '# TEAMS';

        var LABEL_WIDTH = 10;

        var COLUMNS = [
            'TeamId',
            'TeamName',
            'TeamStatus',
            'TeamStartPeriod',
            'TeamEndPeriod',
            'TeamClass',
            'TeamNumber',
            'MemberName',
            'MemberRole',
            'JoinPeriod',
            'LeavePeriod',
            'FirstName',
            'MiddleName',
            'LastName',
            'Nickname',
            'Alias',
            'Age',
            'BirthYear',
            'Gender',
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

        // ---- Optional dependency accessors ----

        function getAcademyClasses() {
            return window.AcademyClasses || null;
        }

        function getCharacterConstants() {
            return window.CharacterConstants || null;
        }

        function getMagicConstants() {
            return window.MagicConstants || null;
        }

        // ---- Small helpers ----

        function isFiniteNumber(value) {
            return typeof value === 'number' && isFinite(value);
        }

        function isObject(value) {
            return value !== null &&
                   typeof value === 'object' &&
                   !Array.isArray(value);
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

        // ---- Character projection ----

        function getStatKeys() {
            var CC = getCharacterConstants();
            if (CC && Array.isArray(CC.STAT_KEYS) &&
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
                    if (Array.isArray(keys) &&
                        keys.length > 0) {
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
            var raw = Array.isArray(char.weapons)
                ? char.weapons
                : [];
            var result = [];
            for (var i = 0; i < raw.length; i++) {
                var w = raw[i];
                if (!isObject(w)) { continue; }
                result.push({
                    id: isNonEmptyString(w.id)
                        ? String(w.id) : '',
                    name: isNonEmptyString(w.name)
                        ? String(w.name) : '',
                    type: isNonEmptyString(w.type)
                        ? String(w.type) : '',
                    notes: typeof w.notes === 'string'
                        ? w.notes : ''
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
                        description:
                            typeof m.description === 'string'
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
            if (!Array.isArray(char.previousNames)) {
                return [];
            }
            var result = [];
            for (var i = 0;
                 i < char.previousNames.length;
                 i++) {
                var n = char.previousNames[i];
                if (typeof n !== 'string') { continue; }
                var trimmed = n.trim();
                if (trimmed === '') { continue; }
                result.push(trimmed);
            }
            return result;
        }

        function normaliseStints(member) {
            if (!member || !Array.isArray(member.intervals)) {
                return [];
            }
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

        // ---- Class display ----

        function getClassDisplay(classId) {
            if (!isNonEmptyString(classId)) { return ''; }
            var AC = getAcademyClasses();
            if (AC &&
                typeof AC.getDisplayName === 'function') {
                try {
                    var name = AC.getDisplayName(classId);
                    if (name && name !== 'Unknown Class') {
                        return String(name);
                    }
                } catch (e) {
                    // fall through
                }
            }
            return '';
        }

        // ---- Member record projection ----

        function buildMissingCharacterStub(member) {
            return {
                memberId: isNonEmptyString(member.memberId)
                    ? String(member.memberId) : '',
                characterId: String(member.characterId),
                role: isNonEmptyString(member.role)
                    ? String(member.role) : 'Member',
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
                specialMoves: {
                    physical: [],
                    magical: []
                },
                combatNotes: ''
            };
        }

        function buildMemberRecord(member) {
            if (!member ||
                !isNonEmptyString(member.characterId)) {
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
                var ageValue =
                    CharacterQueries.getCharacterAge(char);
                if (ageValue !== undefined &&
                    ageValue !== null) {
                    age = String(ageValue);
                }
            } catch (e) {
                age = '';
            }

            var displayName = '';
            try {
                displayName =
                    CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                displayName = '';
            }

            return {
                memberId: isNonEmptyString(member.memberId)
                    ? String(member.memberId) : '',
                characterId: charId,
                role: isNonEmptyString(member.role)
                    ? String(member.role) : 'Member',
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

        // ---- Team record projection ----

        function buildTeamRecord(team) {
            if (!team || !team.id) { return null; }

            var membersRaw =
                TeamQueries.getAllTeamMemberRecords(team) || [];
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
                return String(aJoin).localeCompare(
                    String(bJoin)
                );
            });

            var nameHistory = [];
            if (Array.isArray(team.nameHistory)) {
                for (var h = 0;
                     h < team.nameHistory.length;
                     h++) {
                    var entry = team.nameHistory[h];
                    if (!isObject(entry)) { continue; }
                    nameHistory.push({
                        name: safeString(entry.name),
                        startPeriod: safeString(
                            entry.startPeriod
                        ),
                        endPeriod: safeString(entry.endPeriod)
                    });
                }
            }

            var classDisplay = getClassDisplay(team.classId);

            return {
                id: String(team.id),
                name: isNonEmptyString(team.name)
                    ? String(team.name) : 'Unnamed Team',
                type: safeString(team.type),
                status: isNonEmptyString(team.status)
                    ? String(team.status) : 'active',
                startPeriod: safeString(team.startPeriod),
                endPeriod: safeString(team.endPeriod),
                classId: isNonEmptyString(team.classId)
                    ? String(team.classId) : null,
                classDisplay: classDisplay,
                teamNumber: safeString(team.teamNumber),
                temporaryMission:
                    isNonEmptyString(team.temporaryMission)
                        ? String(team.temporaryMission)
                        : null,
                nameHistory: nameHistory,
                memberCount: members.length,
                members: members
            };
        }

        // ---- Public projection ----

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
                console.warn(
                    '[TeamExport] TeamQueries.getTeams threw:', e
                );
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
                for (var m = 0;
                     m < record.members.length;
                     m++) {
                    stintCount +=
                        record.members[m].stints.length;
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

        // ---- Text format ----

        function padLabel(label) {
            var str = String(label);
            while (str.length < LABEL_WIDTH) { str += ' '; }
            return str;
        }

        function textLine(label, value) {
            if (!hasText(value)) { return ''; }
            var v = String(value)
                .replace(/\s+/g, ' ').trim();
            if (v === '') { return ''; }
            return padLabel(label) + ': ' + v + '\n';
        }

        function formatStints(stints) {
            if (!Array.isArray(stints) ||
                stints.length === 0) {
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

        function formatStats(stats) {
            if (!isObject(stats)) { return ''; }

            var keys = Object.keys(stats);
            if (keys.length === 0) { return ''; }

            var any = false;
            for (var i = 0; i < keys.length; i++) {
                if (stats[keys[i]] !== 0) {
                    any = true;
                    break;
                }
            }
            if (!any) { return ''; }

            var parts = [];
            for (var j = 0; j < keys.length; j++) {
                var k = keys[j];
                parts.push(k.toUpperCase() + ' ' + stats[k]);
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
                if (!isFiniteNumber(v) || v === 0) {
                    continue;
                }
                var label = k.charAt(0).toUpperCase() +
                    k.slice(1);
                parts.push(label + ' ' + v);
            }
            return parts.join(' \u00b7 ');
        }

        function formatWeapons(weapons) {
            if (!Array.isArray(weapons) ||
                weapons.length === 0) {
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
                if (!Array.isArray(list) ||
                    list.length === 0) {
                    return '';
                }
                var names = [];
                for (var i = 0; i < list.length; i++) {
                    var m = list[i];
                    if (!isObject(m)) { continue; }
                    if (!isNonEmptyString(m.name)) {
                        continue;
                    }
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

            if (phys) {
                parts.push('Physical \u2014 ' + phys);
            }
            if (mag) {
                parts.push('Magical \u2014 ' + mag);
            }

            return parts.join(' \u00b7 ');
        }

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

        function formatTeamPeriod(team) {
            var start = isNonEmptyString(team.startPeriod)
                ? String(team.startPeriod)
                : '';
            var end = isNonEmptyString(team.endPeriod)
                ? String(team.endPeriod)
                : '';

            if (start && end) {
                return start + ' \u2013 ' + end;
            }
            if (start) { return 'From ' + start; }
            if (end) { return 'Until ' + end; }
            return '';
        }

        function buildMemberHeader(member) {
            var name = isNonEmptyString(member.displayName)
                ? member.displayName
                : 'Unknown';

            var roleSuffix = '';
            if (isNonEmptyString(member.role) &&
                member.role !== 'Member') {
                roleSuffix = '  (' + member.role + ')';
            }

            var prefix = '--- ' + name + roleSuffix + ' ';
            if (prefix.length >= MEMBER_SEPARATOR_LEN) {
                return prefix;
            }
            return prefix +
                '-'.repeat(
                    MEMBER_SEPARATOR_LEN - prefix.length
                );
        }

        function emitIdentityLines(member) {
            var out = '';

            var stints = formatStints(member.stints);
            if (stints) {
                out += textLine('Stints', stints);
            }

            var fullName = [
                member.firstName,
                member.middleName,
                member.lastName
            ].filter(isNonEmptyString).join(' ');

            if (fullName &&
                fullName !== member.displayName) {
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
                out += textLine(
                    'Appearance',
                    member.appearanceNotes
                );
            }

            return out;
        }

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

        function emitCombatLines(member) {
            var out = '';

            var stats = formatStats(member.stats);
            if (stats) {
                out += textLine('Stats', stats);
            }

            var hpmp = '';
            if (isFiniteNumber(member.hp) &&
                member.hp !== 0) {
                hpmp += 'HP ' + member.hp;
            }
            if (isFiniteNumber(member.mp) &&
                member.mp !== 0) {
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

        function emitMemberBlock(member) {
            var out = '';

            out += buildMemberHeader(member) + '\n';

            var identity = emitIdentityLines(member);
            var physical = emitPhysicalLines(member);
            var personality = emitPersonalityLines(member);
            var combat = emitCombatLines(member);

            var sections = [
                identity, physical, personality, combat
            ].filter(function(s) { return s !== ''; });

            for (var i = 0; i < sections.length; i++) {
                if (i > 0) { out += '\n'; }
                out += sections[i];
            }

            return out;
        }

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
                out += textLine(
                    'Mission',
                    team.temporaryMission
                );
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

        function buildTeamsText(vm) {
            var out = '';

            out += 'Hollow Blades \u2014 Professional Teams Export\n';
            out += 'Exported ' +
                new Date().toISOString().slice(0, 10) + '\n';
            out += vm.teamCount + ' team' +
                (vm.teamCount === 1 ? '' : 's') +
                ' \u00b7 ' + vm.memberCount + ' member' +
                (vm.memberCount === 1 ? '' : 's') +
                ' \u00b7 ' + vm.stintCount + ' stint' +
                (vm.stintCount === 1 ? '' : 's') +
                '\n\n';

            if (vm.teamCount === 0) {
                out += '(No professional teams match this ' +
                    'filter.)\n';
                return out;
            }

            for (var t = 0; t < vm.teams.length; t++) {
                var team = vm.teams[t];

                if (t > 0) { out += '\n'; }

                out += emitTeamHeader(team);

                if (team.members.length === 0) {
                    out += '(No members recorded.)\n';
                    continue;
                }

                for (var m = 0;
                     m < team.members.length;
                     m++) {
                    if (m > 0) { out += '\n'; }
                    out += emitMemberBlock(team.members[m]);
                }
            }

            return out;
        }

        function getTeamsTextContent(options) {
            var vm = getTeams(options);
            return buildTeamsText(vm);
        }

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
                    error: 'Failed to download text: ' +
                        e.message
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

        // ---- CSV ----

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

                for (var m = 0;
                     m < team.members.length;
                     m++) {
                    var member = team.members[m];

                    if (member.stints.length === 0) {
                        rows.push(
                            buildMemberCSVRow(team, member, null)
                        );
                        continue;
                    }

                    for (var s = 0;
                         s < member.stints.length;
                         s++) {
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
                    error: 'Failed to serialize CSV: ' +
                        e.message
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
                    error: 'Failed to download CSV: ' +
                        e.message
                };
            }

            var rowCount = 0;
            for (var t = 0; t < vm.teams.length; t++) {
                for (var m = 0;
                     m < vm.teams[t].members.length;
                     m++) {
                    var stints =
                        vm.teams[t].members[m].stints.length;
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

        // ---- Expose TeamExport ----

        window.TeamExport = Object.freeze({
            getTeams: getTeams,
            getTeamsTextContent: getTeamsTextContent,
            exportTeamsText: exportTeamsText,
            getTeamsCSVContent: getTeamsCSVContent,
            exportTeamsCSV: exportTeamsCSV,

            COLUMNS: COLUMNS.slice(),
            SECTION_HEADER: SECTION_HEADER
        });

    })();

    // ============================================================
    // SECTION 3: TeamExportPicker
    // ============================================================
    //
    // Modal that offers plain-text / CSV export of all professional
    // teams.
    //
    // WHY A PICKER FOR A NON-PARAMETERIZED EXPORT:
    //   Teams are not scoped the way graduates are. "All
    //   professional teams" is a single well-defined set. The
    //   picker exists as the place where the user chooses the
    //   format, and where they see a pre-flight count before
    //   downloading.
    //
    // FORMATS:
    //   Text (default) - a plain-text document designed to be read.
    //   CSV - a flat grid, one row per stint.
    //
    // INTERACTION CONTRACT:
    //   - A status-filter dropdown lets the user filter to
    //     active-only, inactive-only, or all.
    //   - Changing the filter re-renders and refreshes the count.
    //   - The two export buttons call TeamExport, report the
    //     result via NotificationSystem, and close on success.
    //   - On "no teams found", the modal stays open and shows a
    //     warning.

    (function() {

        var _modal = null;
        var _contentEl = null;
        var _statusFilter = 'all';
        var _onClose = null;

        var _contentChangeHandler = null;
        var _contentClickHandler = null;

        // ---- Helpers ----

        function notify(message, type) {
            NotificationSystem.notify(message, type || 'info');
        }

        function escapeHtml(value) {
            return DomUtils.escapeHtml(value);
        }

        function escapeAttribute(value) {
            return DomUtils.escapeAttribute(value);
        }

        // ---- Entry point ----

        function openModal(options) {
            options = options || {};

            closeModal();

            _statusFilter = isNonEmptyString(
                options.initialStatus
            )
                ? String(options.initialStatus)
                : 'all';
            _onClose = typeof options.onClose === 'function'
                ? options.onClose
                : null;

            var shell = Modal.createModal(
                'team-export-picker-modal'
            );
            if (!shell) {
                notify('Failed to create modal.', 'error');
                resetState();
                return null;
            }
            shell.id = 'team-export-picker-modal';

            var contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            shell.appendChild(contentEl);

            _modal = shell;
            _contentEl = contentEl;

            _contentChangeHandler = handleContentChange;
            _contentClickHandler = handleContentClick;
            contentEl.addEventListener(
                'change', _contentChangeHandler
            );
            contentEl.addEventListener(
                'click', _contentClickHandler
            );

            renderContent();

            Modal.modalSetup(shell, function() {
                closeModal();
            });
            Modal.showModal(shell);

            return shell;
        }

        function closeModal() {
            var modal = _modal;
            var contentEl = _contentEl;
            var onClose = _onClose;

            if (contentEl && _contentChangeHandler) {
                try {
                    contentEl.removeEventListener(
                        'change', _contentChangeHandler
                    );
                } catch (e) { /* ignore */ }
            }
            if (contentEl && _contentClickHandler) {
                try {
                    contentEl.removeEventListener(
                        'click', _contentClickHandler
                    );
                } catch (e) { /* ignore */ }
            }

            resetState();

            if (modal) {
                try {
                    Modal.closeModal(modal);
                } catch (e) {
                    // Ignore.
                }
            }

            if (onClose) {
                try {
                    onClose();
                } catch (e) {
                    console.warn(
                        '[TeamExportPicker] onClose threw:', e
                    );
                }
            }
        }

        function resetState() {
            _modal = null;
            _contentEl = null;
            _statusFilter = 'all';
            _onClose = null;
            _contentChangeHandler = null;
            _contentClickHandler = null;
        }

        // ---- View model ----

        function buildViewModel() {
            var options = {};
            if (_statusFilter !== 'all') {
                options.status = _statusFilter;
            }

            var vm;
            try {
                vm = window.TeamExport.getTeams(options);
            } catch (e) {
                console.warn(
                    '[TeamExportPicker] getTeams threw:', e
                );
                vm = {
                    teamCount: 0,
                    memberCount: 0,
                    stintCount: 0,
                    teams: []
                };
            }

            return {
                statusFilter: _statusFilter,
                teamCount: vm.teamCount,
                memberCount: vm.memberCount,
                stintCount: vm.stintCount
            };
        }

        // ---- Render ----

        function renderContent() {
            if (!_contentEl) { return; }
            var vm = buildViewModel();
            _contentEl.innerHTML = buildModalHTML(vm);
        }

        function buildModalHTML(vm) {
            var html = '';

            html += '<div class="modal-header">';
            html += '<h3>Export Professional Teams</h3>';
            html += '<button type="button" class="close-modal" ' +
                        'data-picker-action="close" ' +
                        'aria-label="Close">&times;</button>';
            html += '</div>';

            html += '<div class="modal-body">';

            html += '<p class="field-hint">' +
                        'Exports every professional team with its ' +
                        'members, each member\'s stints (join / ' +
                        'leave periods), and full character ' +
                        'stats.' +
                    '</p>';

            html += '<div class="form-group">';
            html += '<label for="team-export-picker-status-select">' +
                        'Team Status' +
                    '</label>';
            html += '<select id="team-export-picker-status-select" ' +
                        'class="team-export-picker-status-select">';

            var statuses = [
                { value: 'all',
                  label: 'All (active + inactive)' },
                { value: 'active', label: 'Active only' },
                { value: 'inactive', label: 'Inactive only' }
            ];
            for (var i = 0; i < statuses.length; i++) {
                var s = statuses[i];
                var selected =
                    String(s.value) === String(vm.statusFilter)
                        ? ' selected'
                        : '';
                html += '<option value="' +
                            escapeAttribute(s.value) + '"' +
                            selected + '>' +
                            escapeHtml(s.label) +
                        '</option>';
            }
            html += '</select>';
            html += '</div>';

            html += '<div class="team-export-picker-preview">';
            if (vm.teamCount === 0) {
                html += '<p class="empty-state">' +
                            'No professional teams match this ' +
                            'filter.' +
                        '</p>';
            } else {
                html += '<div class="team-export-picker-counts">';
                html += '<span class="team-export-picker-count">' +
                            '<strong>' + vm.teamCount +
                            '</strong> ' +
                            (vm.teamCount === 1
                                ? 'team' : 'teams') +
                        '</span>';
                html += '<span class="team-export-picker-count">' +
                            '<strong>' + vm.memberCount +
                            '</strong> ' +
                            (vm.memberCount === 1
                                ? 'member' : 'members') +
                        '</span>';
                html += '<span class="team-export-picker-count">' +
                            '<strong>' + vm.stintCount +
                            '</strong> ' +
                            (vm.stintCount === 1
                                ? 'stint' : 'stints') +
                        '</span>';
                html += '</div>';
                html += '<p class="field-hint ' +
                            'team-export-picker-note">' +
                            'Text format is a human-readable ' +
                            'document. CSV format is a flat grid ' +
                            'for spreadsheets.' +
                        '</p>';
            }
            html += '</div>';

            html += '</div>';

            var hasTeams = vm.teamCount > 0;

            html += '<div class="modal-footer ' +
                        'team-export-picker-footer">';

            html += '<button type="button" class="secondary" ' +
                        'data-picker-action="close">' +
                        'Close' +
                    '</button>';

            html += '<span class="team-export-picker-footer-spacer">' +
                    '</span>';

            html += '<button type="button" class="secondary" ' +
                        'data-picker-action="export-csv"' +
                        (hasTeams ? '' : ' disabled') + '>' +
                        'Export CSV' +
                    '</button>';

            html += '<button type="button" class="primary" ' +
                        'data-picker-action="export-text"' +
                        (hasTeams ? '' : ' disabled') + '>' +
                        'Export Text' +
                    '</button>';

            html += '</div>';

            return html;
        }

        // ---- Event handlers ----

        function handleContentClick(e) {
            var target = e.target;
            if (!target ||
                typeof target.closest !== 'function') {
                return;
            }

            var btn = target.closest('[data-picker-action]');
            if (!btn || !btn.dataset) { return; }

            var action = btn.dataset.pickerAction;

            if (action === 'close') {
                e.preventDefault();
                closeModal();
                return;
            }

            if (action === 'export-text') {
                e.preventDefault();
                handleExport('text');
                return;
            }

            if (action === 'export-csv') {
                e.preventDefault();
                handleExport('csv');
                return;
            }
        }

        function handleContentChange(e) {
            var target = e.target;
            if (!target || !target.classList) { return; }

            if (target.classList.contains(
                'team-export-picker-status-select'
            )) {
                _statusFilter = isNonEmptyString(target.value)
                    ? String(target.value)
                    : 'all';
                renderContent();
            }
        }

        // ---- Export ----

        function buildExportOptions() {
            var options = {};
            if (_statusFilter !== 'all') {
                options.status = _statusFilter;
            }
            return options;
        }

        function handleExport(format) {
            var options = buildExportOptions();
            var result;

            try {
                if (format === 'text') {
                    result =
                        window.TeamExport.exportTeamsText(
                            options
                        );
                } else if (format === 'csv') {
                    result =
                        window.TeamExport.exportTeamsCSV(
                            options
                        );
                } else {
                    notify('Unknown export format.', 'error');
                    return;
                }
            } catch (err) {
                console.warn(
                    '[TeamExportPicker] export threw:', err
                );
                notify(
                    'Team export failed: ' + err.message,
                    'error'
                );
                return;
            }

            if (result && result.exported) {
                var message = 'Exported ' + result.teamCount +
                    ' team(s)';
                if (typeof result.memberCount === 'number') {
                    message += ', ' + result.memberCount +
                        ' member(s)';
                }
                message += ': ' + result.filename;
                notify(message, 'success');
                closeModal();
                return;
            }

            var error = (result && result.error)
                ? result.error
                : '';

            if (error === 'No professional teams found.') {
                notify(error, 'warning');
                renderContent();
                return;
            }

            notify(
                'Team export failed: ' +
                    (error || 'Unknown error'),
                'error'
            );
        }

        // ---- Expose TeamExportPicker ----

        window.TeamExportPicker = Object.freeze({
            openModal: openModal,
            closeModal: closeModal
        });

    })();

    // ============================================================
    // BUNDLE VERIFICATION
    // ============================================================

    (function verify() {
        var missing = [];

        if (!window.TeamExport ||
            typeof window.TeamExport.exportTeamsText !==
                'function' ||
            typeof window.TeamExport.exportTeamsCSV !==
                'function') {
            missing.push(
                'TeamExport.exportTeamsText/exportTeamsCSV'
            );
        }
        if (!window.TeamExportPicker ||
            typeof window.TeamExportPicker.openModal !==
                'function' ||
            typeof window.TeamExportPicker.closeModal !==
                'function') {
            missing.push('TeamExportPicker openModal/closeModal');
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExport] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();
