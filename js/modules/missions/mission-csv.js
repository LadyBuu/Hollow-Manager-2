/**
 * js/modules/missions/mission-csv.js - Mission CSV
 * Canonical source for all mission CSV operations.
 *
 * Consolidates: CSV schema (columns, field map), export, import
 * (parsing to candidates), template generation.
 *
 * IMPORTANT:
 *   - PURE functions: no persistence, no DOM, no state mutation.
 *   - Import returns candidates (does NOT mutate); MissionImport
 *     routes them through MissionCore.
 *   - Export never reads window.data directly (exportFromData goes
 *     through MissionQueries).
 *
 * REVISION NOTES (fixes in this version):
 *   - Allowed values for Status / Priority / Difficulty / Escalation /
 *     Billing now come from MissionConstants. The retired 'extreme'
 *     and 'on_hold' values are gone from the vocabulary and the
 *     template. An unknown value is a row ERROR (it used to be
 *     silently blanked or accepted and then rejected later).
 *   - Export no longer loses data. Columns appended (older files
 *     without them still parse): Year, Month, Day, Escalation,
 *     Billing, BasePay, SurchargePay. A round trip keeps the mission
 *     date instead of re-dating it to the current year.
 *   - Teams: the TeamId column holds one or more team ids separated by
 *     ';' (',' is also accepted on import). toRow reads the canonical
 *     `assignedTeamIds` (falling back to the legacy `assignedTeamId`).
 *     The parsed candidate carries both `assignedTeamIds` (array) and
 *     `assignedTeamId` (first id or null) for compatibility.
 *   - Pay: the Pay column keeps the stored total string for humans;
 *     BasePay / SurchargePay are the authoritative inputs. MissionImport
 *     prefers BasePay and falls back to Pay.
 *
 * SECTION MARKER: compared via normalizeSectionMarker (BOM-tolerant,
 *   whitespace-tolerant, case-insensitive).
 * ROW ACCEPTANCE: any non-blank row; MissionId may be empty.
 * STRICT MODE: policy for the ImportResult consumer; this module only
 *   skips error rows when options.strict is true.
 *
 * PARTICIPANTS COLUMN: JSON array of { characterId, teamId, source }.
 *   Empty => []; malformed => warning + []; individual bad entries are
 *   dropped with a warning; duplicate pairs keep the first.
 *
 * DEPENDENCIES (all mandatory): CSV, ImportResult, ExportUtils,
 *   IdUtils, MissionConstants.
 */

(function() {
    'use strict';

    if (window.__missionCSVLoaded) return;
    window.__missionCSVLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CSV || typeof window.CSV.parse !== 'function') {
        throw new Error('[MissionCSV] CSV parser is required.');
    }
    if (!window.ImportResult || typeof window.ImportResult !== 'function') {
        throw new Error('[MissionCSV] ImportResult is required.');
    }
    if (!window.ExportUtils ||
        typeof window.ExportUtils.downloadBlob !== 'function') {
        throw new Error('[MissionCSV] ExportUtils is required.');
    }
    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        throw new Error('[MissionCSV] IdUtils is required.');
    }
    if (!window.MissionConstants ||
        !Array.isArray(window.MissionConstants.VALID_STATUSES)) {
        throw new Error('[MissionCSV] MissionConstants is required.');
    }

    var CSV = window.CSV;
    var ImportResult = window.ImportResult;
    var ExportUtils = window.ExportUtils;
    var MC = window.MissionConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SECTION = '# MISSIONS';
    var MAX_ROWS = 10000;
    var BOM_CHAR_CODE = 0xFEFF;
    var TEAM_ID_SEPARATOR = ';';

    // Allowed values, '' included (blank = "use the default").
    var VALID_STATUSES = MC.VALID_STATUSES.concat(['']);
    var VALID_PRIORITIES = MC.VALID_PRIORITIES.concat(['']);
    var VALID_DIFFICULTIES = MC.VALID_DIFFICULTIES.concat(['']);
    var VALID_ESCALATIONS = MC.VALID_ESCALATION_TIERS.concat(['']);
    var VALID_BILLINGS = MC.VALID_BILLING_TYPES.concat(['']);
    var VALID_PARTICIPANT_SOURCES = ['team', 'rookie'];

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================
    //
    // New columns are APPENDED so older files (fewer cells) still
    // parse: missing trailing cells read as empty.

    var COLUMNS = [
        'MissionId',      // 0
        'Title',          // 1
        'Status',         // 2
        'Priority',       // 3
        'Difficulty',     // 4
        'TeamId',         // 5  one or more ids, ';'-separated
        'Location',       // 6
        'Duration',       // 7
        'Pay',            // 8  stored total (informational)
        'Progress',       // 9
        'Objectives',     // 10 JSON
        'Participants',   // 11 JSON
        'Year',           // 12
        'Month',          // 13
        'Day',            // 14
        'Escalation',     // 15
        'Billing',        // 16
        'BasePay',        // 17
        'SurchargePay'    // 18
    ];

    var FIELD_MAP = {
        0: 'id',
        1: 'title',
        2: 'status',
        3: 'priority',
        4: 'difficulty',
        5: 'assignedTeamId',
        6: 'location',
        7: 'duration',
        8: 'pay',
        9: 'progress',
        10: 'objectives',
        11: 'participants',
        12: 'year',
        13: 'month',
        14: 'day',
        15: 'escalation',
        16: 'billing',
        17: 'basePay',
        18: 'surchargePay'
    };

    // ============================================================
    // SECTION MARKER NORMALIZATION
    // ============================================================

    function normalizeSectionMarker(value) {
        var s = String(value == null ? '' : value);

        if (s.length > 0 && s.charCodeAt(0) === BOM_CHAR_CODE) {
            s = s.substring(1);
        }

        s = s.trim();
        if (s === '') { return ''; }

        if (s.charAt(0) === '#') {
            s = '#' + s.substring(1).trim();
        }

        return s.toUpperCase();
    }

    function isSectionMarker(value) {
        var n = normalizeSectionMarker(value);
        return n.length > 0 && n.charAt(0) === '#';
    }

    var TARGET_SECTION_MARKER = normalizeSectionMarker(SECTION);
    var HEADER_MARKER_FIRST_COLUMN = 'MISSIONID';

    // ============================================================
    // SCHEMA HELPERS
    // ============================================================

    function getColumns() { return COLUMNS.slice(); }
    function getHeader() { return COLUMNS.slice(); }

    function getColumnIndex(fieldName) {
        for (var key in FIELD_MAP) {
            if (Object.prototype.hasOwnProperty.call(FIELD_MAP, key) &&
                FIELD_MAP[key] === fieldName) {
                return parseInt(key, 10);
            }
        }
        return null;
    }

    function getFieldName(index) { return FIELD_MAP[index] || null; }
    function getSection() { return SECTION; }

    function getValidStatuses() { return VALID_STATUSES.slice(); }
    function getValidPriorities() { return VALID_PRIORITIES.slice(); }
    function getValidDifficulties() { return VALID_DIFFICULTIES.slice(); }

    function isValidStatus(v) { return VALID_STATUSES.indexOf(v) !== -1; }
    function isValidPriority(v) { return VALID_PRIORITIES.indexOf(v) !== -1; }
    function isValidDifficulty(v) {
        return VALID_DIFFICULTIES.indexOf(v) !== -1;
    }
    function isValidEscalation(v) {
        return VALID_ESCALATIONS.indexOf(v) !== -1;
    }
    function isValidBilling(v) { return VALID_BILLINGS.indexOf(v) !== -1; }

    function nonBlank(list) {
        return list.filter(function(x) { return x !== ''; });
    }

    // ============================================================
    // PARSING HELPERS
    // ============================================================

    function cell(row, index) {
        var v = row[index];
        return String(v == null ? '' : v).trim();
    }

    /** Wrap ExportUtils.parseJSON; kept for API compatibility. */
    function parseJSONField(value, fallback, warnFn, fieldName) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') { return fallback; }

        var wrapped = (typeof warnFn === 'function')
            ? function(msg) { warnFn(msg, fieldName); }
            : undefined;

        return ExportUtils.parseJSON(
            [s], 0, fieldName || 'JSON field', fallback, wrapped
        );
    }

    function parseProgressField(value, warnFn) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') { return 0; }

        if (!/^\d+$/.test(s)) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid progress value "' + s + '" - using 0',
                    'Progress');
            }
            return 0;
        }

        var parsed = parseInt(s, 10);
        if (!Number.isSafeInteger(parsed)) {
            if (typeof warnFn === 'function') {
                warnFn('Progress value "' + s +
                    '" is outside safe range - using 0', 'Progress');
            }
            return 0;
        }

        if (parsed > 100) {
            if (typeof warnFn === 'function') {
                warnFn('Progress value "' + s +
                    '" is above 100 - clamping to 100', 'Progress');
            }
            return 100;
        }

        return parsed;
    }

    /** Positive integer or undefined (blank). Invalid => warning + undefined. */
    function parseIntegerField(value, fieldName, warnFn) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') { return undefined; }

        if (!/^\d+$/.test(s)) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid ' + fieldName + ' "' + s +
                    '" - using the default', fieldName);
            }
            return undefined;
        }

        var n = parseInt(s, 10);
        if (!Number.isSafeInteger(n) || n < 1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid ' + fieldName + ' "' + s +
                    '" - using the default', fieldName);
            }
            return undefined;
        }
        return n;
    }

    /** "a;b" or "a,b" -> ['a','b'] (trimmed, deduped, blanks dropped). */
    function parseTeamIdsField(value) {
        var s = String(value == null ? '' : value).trim();
        if (s === '') { return []; }

        var parts = s.split(/[;,]/);
        var seen = Object.create(null);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var id = parts[i].trim();
            if (id === '' || seen[id]) { continue; }
            seen[id] = true;
            out.push(id);
        }
        return out;
    }

    function parseObjectivesField(value, warnFn) {
        var raw = String(value == null ? '' : value).trim();
        if (raw === '') { return []; }

        try {
            var parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                if (typeof warnFn === 'function') {
                    warnFn('Objectives must be a JSON array - using ' +
                        'empty array', 'Objectives');
                }
                return [];
            }

            var valid = [];
            for (var i = 0; i < parsed.length; i++) {
                var obj = parsed[i];
                if (!obj || typeof obj !== 'object') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + i +
                            ' is not an object - skipping', 'Objectives');
                    }
                    continue;
                }
                if (typeof obj.text !== 'string' || obj.text.trim() === '') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + i +
                            ' has no text - skipping', 'Objectives');
                    }
                    continue;
                }
                valid.push(obj);
            }
            return valid;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in Objectives: ' + e.message +
                    ' - using empty array', 'Objectives');
            }
            return [];
        }
    }

    function parseParticipantsField(value, warnFn) {
        var raw = String(value == null ? '' : value).trim();
        if (raw === '') { return []; }

        function warn(msg) {
            if (typeof warnFn === 'function') {
                warnFn(msg, 'Participants');
            }
        }

        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            warn('Invalid JSON in Participants: ' + e.message +
                ' - using empty array');
            return [];
        }

        if (!Array.isArray(parsed)) {
            warn('Participants must be a JSON array - using empty array');
            return [];
        }

        var result = [];
        var seen = Object.create(null);

        for (var i = 0; i < parsed.length; i++) {
            var p = parsed[i];

            if (!p || typeof p !== 'object' || Array.isArray(p)) {
                warn('Participant at index ' + i +
                    ' is not an object - skipping');
                continue;
            }

            var characterId = (typeof p.characterId === 'string')
                ? p.characterId.trim()
                : '';
            if (characterId === '') {
                warn('Participant at index ' + i +
                    ' has no characterId - skipping');
                continue;
            }

            var source = p.source;
            if (VALID_PARTICIPANT_SOURCES.indexOf(source) === -1) {
                warn('Participant at index ' + i +
                    ' has invalid source - skipping');
                continue;
            }

            var teamId = null;
            if (p.teamId !== undefined && p.teamId !== null &&
                p.teamId !== '') {
                teamId = (typeof p.teamId === 'string')
                    ? p.teamId.trim()
                    : String(p.teamId);
                if (teamId === '') { teamId = null; }
            }

            if (source === 'team' && teamId === null) {
                warn('Participant at index ' + i +
                    ' source "team" requires a teamId - skipping');
                continue;
            }
            if (source === 'rookie' && teamId !== null) {
                warn('Participant at index ' + i +
                    ' source "rookie" must have teamId null - skipping');
                continue;
            }

            var key = characterId + '::' +
                (teamId === null ? '__null__' : teamId);
            if (seen[key]) {
                warn('Duplicate participant at index ' + i +
                    ' - keeping the first');
                continue;
            }
            seen[key] = true;

            result.push({
                characterId: characterId,
                teamId: teamId,
                source: source
            });
        }

        return result;
    }

    function isValidCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        var title = candidate.title || '';
        return title.trim().length > 0;
    }

    function isBlankRow(row) {
        if (!row || row.length === 0) { return true; }
        for (var i = 0; i < row.length; i++) {
            if (String(row[i] == null ? '' : row[i]).trim() !== '') {
                return false;
            }
        }
        return true;
    }

    // ============================================================
    // ROW PARSING
    // ============================================================

    function checkEnum(value, validator, label, allowed, errors) {
        if (value !== '' && !validator(value)) {
            errors.push('Invalid ' + label + ' "' + value +
                '". Allowed: ' + nonBlank(allowed).join(', '));
        }
    }

    /**
     * Parse a CSV row into a mission candidate.
     *
     * An unknown enum value makes the row invalid (an error), it is
     * not silently blanked. Blank enum cells are fine: MissionCore
     * applies the defaults.
     *
     * @returns {{valid, mission, errors, warnings}}
     */
    function parseRow(row, warnFn) {
        var errors = [];
        var warnings = [];

        var title = cell(row, 1);
        if (!title) {
            errors.push('Mission row missing title');
            return { valid: false, mission: null,
                errors: errors, warnings: warnings };
        }

        var status = cell(row, 2);
        var priority = cell(row, 3);
        var difficulty = cell(row, 4);
        var escalation = cell(row, 15);
        var billing = cell(row, 16);

        checkEnum(status, isValidStatus, 'status', VALID_STATUSES, errors);
        checkEnum(priority, isValidPriority, 'priority',
            VALID_PRIORITIES, errors);
        checkEnum(difficulty, isValidDifficulty, 'difficulty',
            VALID_DIFFICULTIES, errors);
        checkEnum(escalation, isValidEscalation, 'escalation',
            VALID_ESCALATIONS, errors);
        checkEnum(billing, isValidBilling, 'billing',
            VALID_BILLINGS, errors);

        if (errors.length > 0) {
            return { valid: false, mission: null,
                errors: errors, warnings: warnings };
        }

        var teamIds = parseTeamIdsField(row[5]);

        var mission = {
            id: cell(row, 0) || null,
            title: title,
            status: status,
            priority: priority,
            difficulty: difficulty,
            assignedTeamIds: teamIds,
            assignedTeamId: teamIds.length > 0 ? teamIds[0] : null,
            location: cell(row, 6),
            duration: cell(row, 7),
            pay: cell(row, 8),
            progress: parseProgressField(row[9], warnFn),
            objectives: parseObjectivesField(row[10], warnFn),
            participants: parseParticipantsField(row[11], warnFn),
            year: parseIntegerField(row[12], 'Year', warnFn),
            month: parseIntegerField(row[13], 'Month', warnFn),
            day: parseIntegerField(row[14], 'Day', warnFn),
            escalation: escalation,
            billing: billing,
            basePay: cell(row, 17),
            surchargePay: cell(row, 18)
        };

        return { valid: true, mission: mission,
            errors: errors, warnings: warnings };
    }

    // ============================================================
    // ROW SERIALIZATION
    // ============================================================

    function getTeamIdsOf(mission) {
        if (Array.isArray(mission.assignedTeamIds)) {
            return mission.assignedTeamIds;
        }
        if (mission.assignedTeamId !== undefined &&
            mission.assignedTeamId !== null &&
            mission.assignedTeamId !== '') {
            return [mission.assignedTeamId];
        }
        return [];
    }

    function orBlank(v) { return v != null ? v : ''; }

    function toRow(mission) {
        if (!mission || typeof mission !== 'object') {
            return COLUMNS.map(function() { return ''; });
        }

        return [
            orBlank(mission.id),
            orBlank(mission.title),
            orBlank(mission.status),
            orBlank(mission.priority),
            orBlank(mission.difficulty),
            getTeamIdsOf(mission).join(TEAM_ID_SEPARATOR),
            orBlank(mission.location),
            orBlank(mission.duration),
            orBlank(mission.pay),
            mission.progress != null ? mission.progress : 0,
            JSON.stringify(mission.objectives != null
                ? mission.objectives : []),
            JSON.stringify(mission.participants != null
                ? mission.participants : []),
            orBlank(mission.year),
            orBlank(mission.month),
            orBlank(mission.day),
            orBlank(mission.escalation),
            orBlank(mission.billing),
            orBlank(mission.basePay),
            orBlank(mission.surchargePay)
        ];
    }

    function toRows(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = [[SECTION], COLUMNS.slice()];
        for (var i = 0; i < missions.length; i++) {
            rows.push(toRow(missions[i]));
        }
        return rows;
    }

    // ============================================================
    // EXPORT
    // ============================================================

    function exportMissions(missions, options) {
        options = options || {};

        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var csvContent = CSV.arrayToCSV(toRows(missions));

        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename ||
            'missions-' + new Date().toISOString().slice(0, 10) + '.csv';

        ExportUtils.downloadBlob(blob, filename);

        return { count: missions.length, filename: filename };
    }

    function exportFromData(options) {
        options = options || {};

        if (!window.MissionQueries ||
            typeof window.MissionQueries.getMissions !== 'function') {
            throw new Error('MissionQueries not available.');
        }

        var missions = window.MissionQueries.getMissions();

        if (missions.length === 0) {
            return { count: 0, filename: null,
                message: 'No missions to export.' };
        }

        var result = exportMissions(missions, options);
        result.message = 'Exported ' + result.count + ' missions';
        return result;
    }

    function getCSVContent(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }
        return CSV.arrayToCSV(toRows(missions));
    }

    // ============================================================
    // IMPORT
    // ============================================================

    /**
     * Extract mission rows: skip to the "# MISSIONS" marker, skip the
     * header row, accept any non-blank row, stop at the next section.
     */
    function extractRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];
            if (isBlankRow(row)) { continue; }

            var first = String(row[0] == null ? '' : row[0]);

            if (!inSection) {
                if (normalizeSectionMarker(first) === TARGET_SECTION_MARKER) {
                    inSection = true;
                }
                continue;
            }

            if (isSectionMarker(first)) { break; }

            if (normalizeSectionMarker(first) ===
                HEADER_MARKER_FIRST_COLUMN) {
                continue;
            }

            rows.push(row);
        }

        return rows;
    }

    /**
     * Parse CSV text into mission candidates.
     *
     * @param {string} csvText
     * @param {object} [options] - { strict, maxRows }
     *   strict: skip (rather than add) rows that produced errors.
     * @returns {ImportResult}
     */
    function importMissions(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var maxRows = options.maxRows || MAX_ROWS;

        var result = new ImportResult();

        var records;
        try {
            records = CSV.parse(csvText);
        } catch (e) {
            result.addError('Failed to parse CSV: ' + e.message);
            return result;
        }

        if (records.length === 0) {
            result.addWarning('CSV file is empty');
            return result;
        }

        var missionRows = extractRows(records);
        if (missionRows.length === 0) {
            result.addError('No mission data found. Expected "' +
                SECTION + '" section.');
            return result;
        }

        if (missionRows.length > maxRows) {
            result.addError('Too many rows (' + missionRows.length +
                '). Maximum is ' + maxRows + '.');
            return result;
        }

        for (var i = 0; i < missionRows.length; i++) {
            var row = missionRows[i];
            var rowNumber = i + 1;

            if (isBlankRow(row)) { continue; }

            var parsed = parseRow(row, function(warning, fieldName) {
                var msg = fieldName ? fieldName + ': ' + warning : warning;
                result.addWarning(msg,
                    { row: rowNumber, field: fieldName });
            });

            if (!parsed.valid) {
                for (var k = 0; k < parsed.errors.length; k++) {
                    result.addError(parsed.errors[k], { row: rowNumber });
                }
                if (strict && parsed.mission) {
                    result.addSkipped(parsed.mission, 'Row had errors',
                        { row: rowNumber });
                }
                continue;
            }

            var mission = parsed.mission;

            if (!isValidCandidate(mission)) {
                result.addError('Invalid mission data (missing title)',
                    { row: rowNumber });
                continue;
            }

            result.addValid(mission, { row: rowNumber });
        }

        return result;
    }

    function importFromFile(file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                try {
                    resolve(importMissions(e.target.result, options));
                } catch (err) {
                    reject(new Error(
                        'Failed to import missions: ' + err.message));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file: ' +
                    (reader.error ? reader.error.message
                        : 'Unknown error')));
            };

            reader.readAsText(file);
        });
    }

    // ============================================================
    // TEMPLATE
    // ============================================================

    function getTemplateMissions(options) {
        options = options || {};
        var count = options.count || 2;

        var templates = [
            {
                id: null,
                title: 'Operation Nightfall',
                status: 'active',
                priority: 'high',
                difficulty: 'hard',
                assignedTeamIds: [],
                location: 'Berlin',
                duration: '2 weeks',
                pay: '',
                basePay: '5000',
                surchargePay: '',
                progress: 50,
                year: 1926,
                month: 3,
                day: 14,
                escalation: 'tier_iii',
                billing: 'original',
                objectives: [
                    { text: 'Infiltrate base', done: true },
                    { text: 'Retrieve documents', done: true }
                ],
                participants: [
                    { characterId: 'char_example_1',
                      teamId: 'team_example_1', source: 'team' }
                ]
            },
            {
                id: null,
                title: 'Rescue Mission',
                status: 'active',
                priority: 'medium',
                difficulty: 'medium',
                assignedTeamIds: [],
                location: 'London',
                duration: '3 days',
                pay: '',
                basePay: '2000',
                surchargePay: '',
                progress: 0,
                year: 1926,
                month: 5,
                day: 2,
                escalation: 'tier_ii',
                billing: 'original',
                objectives: [
                    { text: 'Find hostages', done: false },
                    { text: 'Extract safely', done: false }
                ],
                participants: [
                    { characterId: 'char_example_2', teamId: null,
                      source: 'rookie' }
                ]
            }
        ];

        if (options.includeAllStatuses) {
            var statuses = nonBlank(VALID_STATUSES);
            var all = [];
            for (var i = 0; i < Math.min(statuses.length, count); i++) {
                var copy = JSON.parse(
                    JSON.stringify(templates[i % templates.length]));
                copy.status = statuses[i];
                copy.title = statuses[i].charAt(0).toUpperCase() +
                    statuses[i].slice(1) + ' Mission';
                copy.progress = statuses[i] === 'completed' ? 100 :
                                statuses[i] === 'cancelled' ? 0 : 50;
                all.push(copy);
            }
            return all;
        }

        return templates.slice(0, count);
    }

    function getComprehensiveTemplateRows(options) {
        options = options || {};
        var maxExamples = options.maxExamples || 20;

        var rows = [[SECTION], COLUMNS.slice()];

        var statuses = options.includeAllStatuses
            ? nonBlank(VALID_STATUSES) : ['active'];
        var priorities = options.includeAllPriorities
            ? nonBlank(VALID_PRIORITIES) : ['medium'];
        var difficulties = options.includeAllDifficulties
            ? nonBlank(VALID_DIFFICULTIES) : ['medium'];

        var n = 0;

        for (var s = 0; s < statuses.length && n < maxExamples; s++) {
            for (var p = 0; p < priorities.length && n < maxExamples; p++) {
                for (var d = 0; d < difficulties.length &&
                     n < maxExamples; d++) {
                    var status = statuses[s];
                    var priority = priorities[p];
                    var difficulty = difficulties[d];

                    function cap(x) {
                        return x.charAt(0).toUpperCase() + x.slice(1);
                    }

                    var title = cap(status) + ' ' + cap(priority) + ' ' +
                        cap(difficulty) + ' Mission';

                    var done = status === 'completed';
                    var progress = done ? '100' :
                        status === 'cancelled' ? '0' :
                        String(10 + ((n * 7) % 80));

                    var objectives = '[{"text":"Primary objective",' +
                        '"done":' + done + '},{"text":"Secondary ' +
                        'objective","done":' + done + '}]';

                    rows.push([
                        '', title, status, priority, difficulty, '',
                        'Location ' + (n + 1),
                        (Math.floor(n / 2) % 4 + 1) + ' weeks',
                        '', progress, objectives, '[]',
                        '1926', '1', '1', '', '',
                        String(((n % 8) + 2) * 1000), ''
                    ]);

                    n++;
                }
            }
        }

        return rows;
    }

    function getTemplateRows(options) {
        options = options || {};

        if (options.comprehensive) {
            return getComprehensiveTemplateRows(options);
        }

        var missions = (options.exampleData &&
                        Array.isArray(options.exampleData))
            ? options.exampleData
            : getTemplateMissions({ count: options.exampleCount || 2 });

        return toRows(missions);
    }

    function getTemplateContent(options) {
        return CSV.arrayToCSV(getTemplateRows(options));
    }

    function exportTemplate(options) {
        options = options || {};

        var blob = new Blob(['\uFEFF' + getTemplateContent(options)], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename || 'missions-template.csv';
        ExportUtils.downloadBlob(blob, filename);

        return { exported: true, filename: filename };
    }

    function getColumnDescriptions() {
        return {
            'MissionId': 'Leave blank. Every CSV row creates a new ' +
                'mission; use JSON import to update existing ones',
            'Title': 'Required. The mission name',
            'Status': 'Optional. One of: ' +
                nonBlank(VALID_STATUSES).join(', '),
            'Priority': 'Optional. One of: ' +
                nonBlank(VALID_PRIORITIES).join(', '),
            'Difficulty': 'Optional. One of: ' +
                nonBlank(VALID_DIFFICULTIES).join(', '),
            'TeamId': 'Optional. One or more team ids separated by ' +
                '"' + TEAM_ID_SEPARATOR + '"',
            'Location': 'Optional. Mission location',
            'Duration': 'Optional. Mission duration (e.g., 2 weeks)',
            'Pay': 'Optional. Informational total; BasePay is used when ' +
                'present',
            'Progress': 'Optional. Derived from objectives on import',
            'Objectives': 'Optional. JSON array: ' +
                '[{"text":"...","done":true/false}]',
            'Participants': 'Optional. JSON array: ' +
                '[{"characterId":"...","teamId":"...","source":"team"}] ' +
                'or [{"characterId":"...","teamId":null,' +
                '"source":"rookie"}]',
            'Year': 'Optional. Positive integer (defaults to the ' +
                'current year)',
            'Month': 'Optional. Month number in the active calendar',
            'Day': 'Optional. Day of the month in the active calendar',
            'Escalation': 'Optional. One of: ' +
                nonBlank(VALID_ESCALATIONS).join(', '),
            'Billing': 'Optional. One of: ' +
                nonBlank(VALID_BILLINGS).join(', '),
            'BasePay': 'Optional. Number, e.g. 5000',
            'SurchargePay': 'Optional. Number, e.g. 500'
        };
    }

    function getTemplatePreview(options) {
        options = options || {};
        var previewRows = options.previewRows || 2;

        var rows = getTemplateRows(options);
        var headers = rows.length > 1 ? rows[1] : [];
        var examples = [];

        for (var i = 2; i < Math.min(rows.length, 2 + previewRows); i++) {
            examples.push(rows[i]);
        }

        return {
            headers: headers,
            examples: examples,
            columnDescriptions: getColumnDescriptions(),
            allowedValues: {
                Status: nonBlank(VALID_STATUSES),
                Priority: nonBlank(VALID_PRIORITIES),
                Difficulty: nonBlank(VALID_DIFFICULTIES),
                Escalation: nonBlank(VALID_ESCALATIONS),
                Billing: nonBlank(VALID_BILLINGS)
            }
        };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateCandidates(candidates, options) {
        options = options || {};
        var validateEnums = options.validateEnums !== false;

        if (!Array.isArray(candidates)) {
            throw new TypeError('Candidates must be an array.');
        }

        var valid = [];
        var invalid = [];
        var warnings = [];

        function warn(i, candidate, field, value, message) {
            warnings.push({
                index: i, candidate: candidate, field: field,
                value: value, message: message
            });
        }

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];

            if (!isValidCandidate(c)) {
                invalid.push({
                    index: i, candidate: c,
                    reason: 'Missing required field: title'
                });
                continue;
            }

            if (validateEnums) {
                var enumChecks = [
                    ['status', isValidStatus],
                    ['priority', isValidPriority],
                    ['difficulty', isValidDifficulty],
                    ['escalation', isValidEscalation],
                    ['billing', isValidBilling]
                ];
                for (var e = 0; e < enumChecks.length; e++) {
                    var f = enumChecks[e][0];
                    if (c[f] && !enumChecks[e][1](c[f])) {
                        warn(i, c, f, c[f],
                            'Invalid ' + f + ' "' + c[f] + '"');
                    }
                }

                if (typeof c.progress === 'number' &&
                    (c.progress < 0 || c.progress > 100)) {
                    warn(i, c, 'progress', c.progress,
                        'Progress must be between 0 and 100');
                }

                if (Array.isArray(c.objectives)) {
                    for (var j = 0; j < c.objectives.length; j++) {
                        var obj = c.objectives[j];
                        if (!obj || typeof obj !== 'object') {
                            warn(i, c, 'objectives', obj,
                                'Objective at index ' + j +
                                ' is not an object');
                        } else if (!obj.text ||
                                   typeof obj.text !== 'string') {
                            warn(i, c, 'objectives', obj,
                                'Objective at index ' + j +
                                ' has no text');
                        }
                    }
                }

                if (Array.isArray(c.participants)) {
                    for (var p = 0; p < c.participants.length; p++) {
                        var part = c.participants[p];
                        if (!part || typeof part !== 'object') {
                            warn(i, c, 'participants', part,
                                'Participant at index ' + p +
                                ' is not an object');
                            continue;
                        }
                        if (typeof part.characterId !== 'string' ||
                            part.characterId.trim() === '') {
                            warn(i, c, 'participants', part,
                                'Participant at index ' + p +
                                ' has no characterId');
                        }
                        if (VALID_PARTICIPANT_SOURCES.indexOf(
                            part.source) === -1) {
                            warn(i, c, 'participants', part,
                                'Participant at index ' + p +
                                ' has invalid source');
                        }
                    }
                }
            }

            valid.push(c);
        }

        return { valid: valid, invalid: invalid, warnings: warnings };
    }

    function getImportPreview(result, limit) {
        limit = limit || 5;

        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var valid = result.getValid();
        return {
            preview: valid.slice(0, limit),
            total: valid.length,
            hasMore: valid.length > limit
        };
    }

    function getImportSummary(result) {
        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var summary = result.getSummary();

        var messages = [];
        if (summary.valid > 0) {
            messages.push(summary.valid + ' mission(s) ready to import');
        }
        if (summary.errors > 0) {
            messages.push(summary.errors + ' error(s) found');
        }
        if (summary.warnings > 0) {
            messages.push(summary.warnings + ' warning(s) found');
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
            message: messages.join(', ') || 'No missions found'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCSV = {
        SECTION: SECTION,
        COLUMNS: COLUMNS,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,
        VALID_ESCALATIONS: VALID_ESCALATIONS,
        VALID_BILLINGS: VALID_BILLINGS,
        VALID_PARTICIPANT_SOURCES: VALID_PARTICIPANT_SOURCES,

        getColumns: getColumns,
        getHeader: getHeader,
        getColumnIndex: getColumnIndex,
        getFieldName: getFieldName,
        getSection: getSection,
        getValidStatuses: getValidStatuses,
        getValidPriorities: getValidPriorities,
        getValidDifficulties: getValidDifficulties,
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty,

        parseRow: parseRow,
        parseProgressField: parseProgressField,
        parseJSONField: parseJSONField,
        parseObjectivesField: parseObjectivesField,
        parseParticipantsField: parseParticipantsField,
        parseTeamIdsField: parseTeamIdsField,
        isValidCandidate: isValidCandidate,
        extractRows: extractRows,

        toRow: toRow,
        toRows: toRows,

        'export': exportMissions,
        exportFromData: exportFromData,
        getCSVContent: getCSVContent,

        'import': importMissions,
        importFromFile: importFromFile,

        getTemplateMissions: getTemplateMissions,
        getTemplateRows: getTemplateRows,
        getTemplateContent: getTemplateContent,
        exportTemplate: exportTemplate,
        getTemplatePreview: getTemplatePreview,
        getColumnDescriptions: getColumnDescriptions,
        getComprehensiveTemplateRows: getComprehensiveTemplateRows,

        validateCandidates: validateCandidates,
        getImportPreview: getImportPreview,
        getImportSummary: getImportSummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionCSV;
        var missing = [];

        var required = [
            'export', 'exportFromData', 'getCSVContent',
            'import', 'importFromFile',
            'exportTemplate', 'getTemplateContent', 'getTemplateRows',
            'getTemplatePreview',
            'validateCandidates', 'getImportPreview', 'getImportSummary',
            'parseRow', 'toRow', 'toRows',
            'getColumns', 'getHeader', 'getSection',
            'getValidStatuses', 'getValidPriorities',
            'getValidDifficulties',
            'isValidStatus', 'isValidPriority', 'isValidDifficulty',
            'parseParticipantsField', 'parseTeamIdsField'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        function check(cond, label) {
            if (!cond) { missing.push(label); }
        }

        try {
            // participants
            var ok = parseParticipantsField(
                '[{"characterId":"c1","teamId":"t1","source":"team"},' +
                '{"characterId":"c2","teamId":null,"source":"rookie"}]',
                null);
            check(ok.length === 2 && ok[0].teamId === 't1' &&
                ok[1].teamId === null, 'participants did not round-trip');
            check(parseParticipantsField('', null).length === 0,
                'empty participants');
            check(parseParticipantsField('not json', null).length === 0,
                'bad-JSON participants');
            check(parseParticipantsField(
                '[{"characterId":"c1","teamId":null,"source":"team"},' +
                '{"characterId":"c2","teamId":"t1","source":"rookie"}]',
                null).length === 0, 'incoherent participants kept');
            check(parseParticipantsField(
                '[{"characterId":"c1","teamId":"t1","source":"team"},' +
                '{"characterId":"c1","teamId":"t1","source":"team"}]',
                null).length === 1, 'duplicate participants kept');

            // teams
            var t = parseTeamIdsField(' a ; b,a ;; c ');
            check(t.length === 3 && t[0] === 'a' && t[2] === 'c',
                'parseTeamIdsField');

            // vocabulary comes from MissionConstants
            check(!isValidDifficulty('extreme'),
                '"extreme" should no longer be valid');
            check(!isValidStatus('on_hold'),
                '"on_hold" should no longer be valid');
            check(isValidStatus('') && isValidDifficulty('expert'),
                'blank / expert should be valid');

            // toRow keeps teams, date and escalation
            var row = toRow({
                id: 'm1', title: 'T', status: 'active',
                priority: 'medium', difficulty: 'medium',
                assignedTeamIds: ['t1', 't2'], progress: 0,
                objectives: [],
                participants: [
                    { characterId: 'c1', teamId: 't1', source: 'team' }
                ],
                year: 1920, month: 12, day: 8, escalation: 'tier_iii',
                billing: 'original', basePay: '500', surchargePay: '50'
            });
            check(row.length === COLUMNS.length, 'toRow width mismatch');
            check(row[5] === 't1;t2', 'toRow lost the team ids');
            check(row[12] === 1920 && row[13] === 12 && row[14] === 8,
                'toRow lost the date');
            check(row[15] === 'tier_iii', 'toRow lost escalation');
            check(row[11].indexOf('"characterId":"c1"') !== -1,
                'toRow participants not JSON');

            // parseRow round-trips a row it wrote
            var parsed = parseRow(row.map(String), null);
            check(parsed.valid, 'parseRow rejected its own output: ' +
                parsed.errors.join('; '));
            if (parsed.valid) {
                check(parsed.mission.assignedTeamIds.length === 2,
                    'round trip lost teams');
                check(parsed.mission.year === 1920 &&
                    parsed.mission.month === 12 &&
                    parsed.mission.day === 8, 'round trip lost the date');
                check(parsed.mission.basePay === '500',
                    'round trip lost basePay');
            }

            // an unknown enum is an error, not a silent blank
            var bad = parseRow(['', 'T', 'active', 'medium', 'extreme'],
                null);
            check(!bad.valid && bad.errors.length > 0,
                'unknown difficulty was not rejected');

            // an older, shorter row still parses
            var old = parseRow(['', 'Old', '', '', '', 'team_x'], null);
            check(old.valid && old.mission.assignedTeamId === 'team_x' &&
                old.mission.year === undefined,
                'older shorter row did not parse');

            check(getFieldName(COLUMNS.length - 1) === 'surchargePay',
                'COLUMNS / FIELD_MAP mismatch');
            for (var c = 0; c < COLUMNS.length; c++) {
                if (!FIELD_MAP[c]) {
                    missing.push('FIELD_MAP missing index ' + c);
                }
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn('[MissionCSV] Verification - some exports may ' +
                'be missing:', missing.join(', '));
        }
    })();

})();
