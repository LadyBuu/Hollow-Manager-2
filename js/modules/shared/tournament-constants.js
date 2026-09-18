/**
 * modules/tournaments/tournament-constants.js - Tournament Constants
 * Single source of truth for all tournament-related constants.
 *
 * Path: js/modules/tournaments/tournament-constants.js
 *
 * LIFECYCLE MODEL (SIMPLIFIED):
 *   Tournaments are records, not state machines. The status field is
 *   a soft label for the user:
 *
 *     draft      — being set up
 *     active     — running
 *     completed  — done
 *
 *   NONE of these block any operation. The user can add rounds,
 *   matches, participants, or eliminations at any time. A completed
 *   tournament can be reopened; a draft can be completed directly.
 *
 *   The former LIFECYCLE_RULES enforced operation-permission by
 *   status. That was a fiction that got in the way of the real
 *   workflow: record keeping, where the user is the authority on
 *   what they want to change and when.
 *
 *   The rules object is retained so existing callers that read
 *   `LIFECYCLE_RULES[status].canX` continue to work. Every flag is
 *   now `true`.
 *
 * ENUM OWNERSHIP:
 *   The following enums are owned by TournamentSchema:
 *     - VALID_STATUSES
 *     - VALID_MODES
 *     - VALID_MATCH_TYPES
 *     - VALID_MATCH_STATUSES
 *     - VALID_PARTICIPANT_TYPES
 *     - VALID_RESULTS
 *
 *   This module re-exports them. Callers that want a frozen array or
 *   a set-based lookup can use either the export here or the
 *   corresponding export on TournamentSchema — they are the same
 *   array by reference.
 *
 * LABEL OWNERSHIP:
 *   Every tournament-vocabulary label lives here. Callers that render
 *   a status, mode, match type, match status, participant type, or
 *   result MUST use the get*Label helpers below rather than
 *   re-implementing the mapping. Before this module owned the
 *   labels, the mapping was duplicated in the Academy-side exam
 *   aggregator; that duplication is now closed.
 *
 *   The label helpers return a safe fallback for unrecognised input
 *   (String(value) for a defined value; '' for null/undefined). They
 *   do not throw. This matches the historical behaviour of the
 *   aggregator's local helpers, which is where these were lifted
 *   from.
 *
 *   CSS class names, icons, and any other presentation mapping are
 *   NOT part of this module. Those belong to the renderer. The
 *   aggregator retains its own getResultCategory / getOutcomeDisplay
 *   for the exams UI, because those return CSS class names.
 *
 * INTEGER PARSING:
 *   parsePositiveInteger is the canonical strict parser for
 *   "positive integer" values: a number or a pure-digit string,
 *   non-empty, no sign, no decimal, no trailing characters, within
 *   Number.isSafeInteger bounds, >= 1.
 *
 *   It returns the parsed integer, or null. It never coerces.
 *   "12abc", "-1", "1.5", "1e2", NaN, Infinity, booleans, objects,
 *   arrays, and whitespace-only strings all return null.
 *
 *   Callers that need a different shape (e.g. an integer that may be
 *   negative, or an integer bounded to a week range) build on this
 *   parser rather than re-implementing it. Schema.coerceInteger is
 *   the safe-integer variant and remains in Schema for the cases
 *   where negative values are legitimate (years, deltas).
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants    (for week bounds) - LAZY
 *   - window.TournamentSchema     (for canonical enums) - LAZY
 *
 * ENUM RESOLUTION AND LOAD ORDER:
 *   TournamentSchema and CalendarConstants are resolved lazily at
 *   load time and re-checked at each dependency-touching call. When
 *   TournamentSchema is absent at load, the local fallback arrays are
 *   used; when CalendarConstants is absent at load, week bounds
 *   default to [1, 52]. Both fallbacks are conservative copies of
 *   the canonical values and are frozen identically.
 *
 *   The enums defined here — including the labels — do NOT change
 *   with load order. A caller that imports this module before
 *   Schema will get the fallback arrays; a caller that imports it
 *   after Schema will get Schema's canonical arrays. Both sets
 *   contain the same string values, which is what the label maps
 *   are keyed on.
 */

(function() {
    'use strict';

    if (window.__tournamentConstantsLoaded) {
        return;
    }
    window.__tournamentConstantsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    function getTournamentSchema() {
        return window.TournamentSchema || null;
    }

    function getBounds() {
        var CC = getCalendarConstants();
        if (!CC) {
            return {
                MIN_WEEK: 1,
                MAX_WEEK: 52
            };
        }
        return {
            MIN_WEEK: CC.MIN_WEEK || 1,
            MAX_WEEK: CC.MAX_WEEK || 52
        };
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];
        var CC = getCalendarConstants();
        var Schema = getTournamentSchema();

        if (!CC) {
            missing.push('CalendarConstants (lazy)');
        } else {
            var required = ['MIN_WEEK', 'MAX_WEEK'];
            for (var i = 0; i < required.length; i++) {
                if (typeof CC[required[i]] !== 'number') {
                    missing.push('CalendarConstants.' + required[i]);
                }
            }
        }

        if (!Schema) {
            missing.push('TournamentSchema (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentConstants] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // ENUM SOURCES - From TournamentSchema, with local fallback
    // ============================================================

    var _schema = getTournamentSchema();

    function resolveEnum(schemaKey, fallback) {
        if (_schema && Array.isArray(_schema[schemaKey])) {
            return _schema[schemaKey];
        }
        console.warn(
            '[TournamentConstants] TournamentSchema.' + schemaKey +
            ' not available at load time. Using local fallback.'
        );
        return fallback;
    }

    var VALID_STATUSES = resolveEnum('VALID_STATUSES', [
        'draft',
        'active',
        'completed'
    ]);

    var VALID_MODES = resolveEnum('VALID_MODES', [
        'teams',
        'individuals'
    ]);

    var VALID_MATCH_TYPES = resolveEnum('VALID_MATCH_TYPES', [
        'group_exam',
        'team_vs_team'
    ]);

    var VALID_MATCH_STATUSES = resolveEnum('VALID_MATCH_STATUSES', [
        'pending',
        'in_progress',
        'completed'
    ]);

    var VALID_PARTICIPANT_TYPES = resolveEnum('VALID_PARTICIPANT_TYPES', [
        'character',
        'team'
    ]);

    var VALID_RESULTS = resolveEnum('VALID_RESULTS', [
        'pass',
        'fail',
        'retry'
    ]);

    var VALID_GROUP_EXAM_RESULTS = VALID_RESULTS;

    // ============================================================
    // DEFAULT VALUES
    // ============================================================

    var DEFAULT_STATUS = 'draft';
    var DEFAULT_MODE = 'teams';
    var DEFAULT_MATCH_TYPE = 'group_exam';
    var DEFAULT_ROUND_MATCH_SIZE = 2;
    var DEFAULT_TOTAL_ROUNDS = 1;

    // ============================================================
    // LIFECYCLE RULES - PERMISSIVE
    // ============================================================
    //
    // Tournaments are records, not state machines. Every operation is
    // permitted in every status. The status field is a soft label.
    //
    // The shape is retained so existing callers that read
    // `LIFECYCLE_RULES[status].canX` continue to work.

    var LIFECYCLE_RULES = {
        draft: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: true,
            canComplete: true,
            description: 'Setup phase'
        },
        active: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: true,
            canComplete: true,
            description: 'Running phase'
        },
        completed: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: true,
            canComplete: true,
            description: 'Finished phase (can be reopened)'
        }
    };

    // ============================================================
    // STATUS TRANSITION RULES - PERMISSIVE
    // ============================================================
    //
    // Any status can transition to any other status. The user is the
    // authority on where a record belongs.

    var STATUS_TRANSITIONS = {
        'draft': ['draft', 'active', 'completed'],
        'active': ['draft', 'active', 'completed'],
        'completed': ['draft', 'active', 'completed']
    };

    // ============================================================
    // MODE → PARTICIPANT TYPE
    // ============================================================

    var MODE_TO_PARTICIPANT_TYPE = {
        'teams': 'team',
        'individuals': 'character'
    };

    // ============================================================
    // DERIVED LOOKUP SETS
    // ============================================================

    function buildSet(list) {
        var set = Object.create(null);
        for (var i = 0; i < list.length; i++) {
            set[list[i]] = true;
        }
        return set;
    }

    var _statusSet = buildSet(VALID_STATUSES);
    var _modeSet = buildSet(VALID_MODES);
    var _matchTypeSet = buildSet(VALID_MATCH_TYPES);
    var _matchStatusSet = buildSet(VALID_MATCH_STATUSES);
    var _participantTypeSet = buildSet(VALID_PARTICIPANT_TYPES);
    var _resultSet = buildSet(VALID_RESULTS);

    // ============================================================
    // VALIDATION LOOKUPS
    // ============================================================

    function isValidStatus(status) {
        return _statusSet[status] === true;
    }

    function isValidMode(mode) {
        return _modeSet[mode] === true;
    }

    function isValidMatchType(type) {
        return _matchTypeSet[type] === true;
    }

    function isValidMatchStatus(status) {
        return _matchStatusSet[status] === true;
    }

    function isValidParticipantType(type) {
        return _participantTypeSet[type] === true;
    }

    function isValidResult(result) {
        return _resultSet[result] === true;
    }

    function isValidGroupExamResult(result) {
        return _resultSet[result] === true;
    }

    function getCanonicalParticipantType(mode) {
        return MODE_TO_PARTICIPANT_TYPE[mode] || null;
    }

    function isParticipantTypeCanonical(mode, type) {
        return getCanonicalParticipantType(mode) === type;
    }

    function getLifecycleRules(status) {
        return LIFECYCLE_RULES[status] || null;
    }

    function isStatusTransitionAllowed(fromStatus, toStatus) {
        if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
            return false;
        }
        var allowed = STATUS_TRANSITIONS[fromStatus];
        return allowed && allowed.indexOf(toStatus) !== -1;
    }

    function getAllowedTransitions(status) {
        if (!isValidStatus(status)) {
            return [];
        }
        return STATUS_TRANSITIONS[status] || [];
    }

    // ============================================================
    // LABEL LOOKUPS
    // ============================================================
    //
    // The tournament vocabulary is here. Callers that render any
    // tournament value use these helpers.
    //
    // Contract:
    //   - Known enum value  -> its human label.
    //   - Unknown but non-null/undefined -> String(value). This is
    //     the historical aggregator behaviour, preserved so that a
    //     malformed record still renders something readable.
    //   - null/undefined -> ''. A missing value renders as nothing,
    //     not "null" or "undefined".
    //
    // No helper throws. The tournament record is a record; a bad
    // label is not a reason to fail a render.

    var STATUS_LABELS = Object.freeze({
        'draft':     'Draft',
        'active':    'Active',
        'completed': 'Completed'
    });

    var MODE_LABELS = Object.freeze({
        'teams':       'Teams',
        'individuals': 'Individuals'
    });

    var MATCH_STATUS_LABELS = Object.freeze({
        'pending':     'Pending',
        'in_progress': 'In Progress',
        'completed':   'Completed'
    });

    var MATCH_TYPE_LABELS = Object.freeze({
        'group_exam':   'Group Exam',
        'team_vs_team': 'Team Match'
    });

    var PARTICIPANT_TYPE_LABELS = Object.freeze({
        'character': 'Character',
        'team':      'Team'
    });

    var RESULT_LABELS = Object.freeze({
        'pass':  'Pass',
        'retry': 'Retry',
        'fail':  'Fail'
    });

    function labelOrDefault(map, value) {
        if (value === null || value === undefined) {
            return '';
        }
        var key = String(value);
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            return map[key];
        }
        return key;
    }

    function getStatusLabel(status) {
        return labelOrDefault(STATUS_LABELS, status);
    }

    function getModeLabel(mode) {
        return labelOrDefault(MODE_LABELS, mode);
    }

    function getMatchStatusLabel(status) {
        return labelOrDefault(MATCH_STATUS_LABELS, status);
    }

    function getMatchTypeLabel(type) {
        return labelOrDefault(MATCH_TYPE_LABELS, type);
    }

    function getParticipantTypeLabel(type) {
        return labelOrDefault(PARTICIPANT_TYPE_LABELS, type);
    }

    function getResultLabel(result) {
        return labelOrDefault(RESULT_LABELS, result);
    }

    // ============================================================
    // INTEGER PARSING
    // ============================================================
    //
    // parsePositiveInteger is the strict positive-integer parser for
    // the tournament domain. It accepts numbers and pure-digit
    // strings. Everything else returns null.
    //
    // See the file header for the full contract. This is the ONLY
    // strict positive-integer parser in the tournament module.
    // Callers must use it rather than re-implementing the check.

    function parsePositiveInteger(value) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            if (!Number.isSafeInteger(value)) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isSafeInteger(n) || n < 1) {
                return null;
            }
            return n;
        }
        return null;
    }

    // ============================================================
    // COMPUTED BOUNDS
    // ============================================================

    var _computedBounds = null;

    function getComputedBounds() {
        if (!_computedBounds) {
            var bounds = getBounds();
            _computedBounds = Object.freeze({
                MIN_WEEK: bounds.MIN_WEEK,
                MAX_WEEK: bounds.MAX_WEEK
            });
        }
        return _computedBounds;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        function validateEnum(name, list) {
            if (!Array.isArray(list) || list.length === 0) {
                errors.push(name + ' must be a non-empty array.');
                return;
            }
            var seen = Object.create(null);
            for (var i = 0; i < list.length; i++) {
                var v = list[i];
                if (typeof v !== 'string' || v.trim() === '') {
                    errors.push(name + '[' + i + '] must be a non-empty string.');
                    continue;
                }
                if (seen[v]) {
                    errors.push(name + ' has duplicate value: "' + v + '".');
                }
                seen[v] = true;
            }
        }

        validateEnum('VALID_STATUSES', VALID_STATUSES);
        validateEnum('VALID_MODES', VALID_MODES);
        validateEnum('VALID_MATCH_TYPES', VALID_MATCH_TYPES);
        validateEnum('VALID_MATCH_STATUSES', VALID_MATCH_STATUSES);
        validateEnum('VALID_PARTICIPANT_TYPES', VALID_PARTICIPANT_TYPES);
        validateEnum('VALID_RESULTS', VALID_RESULTS);

        if (!isValidStatus(DEFAULT_STATUS)) {
            errors.push('DEFAULT_STATUS is not a valid status: "' + DEFAULT_STATUS + '".');
        }
        if (!isValidMode(DEFAULT_MODE)) {
            errors.push('DEFAULT_MODE is not a valid mode: "' + DEFAULT_MODE + '".');
        }
        if (!isValidMatchType(DEFAULT_MATCH_TYPE)) {
            errors.push('DEFAULT_MATCH_TYPE is not a valid match type: "' + DEFAULT_MATCH_TYPE + '".');
        }
        if (typeof DEFAULT_ROUND_MATCH_SIZE !== 'number' || DEFAULT_ROUND_MATCH_SIZE < 2) {
            errors.push('DEFAULT_ROUND_MATCH_SIZE must be a number >= 2.');
        }
        if (typeof DEFAULT_TOTAL_ROUNDS !== 'number' || DEFAULT_TOTAL_ROUNDS < 1) {
            errors.push('DEFAULT_TOTAL_ROUNDS must be a number >= 1.');
        }

        var lifecycleKeys = Object.keys(LIFECYCLE_RULES);
        for (var s = 0; s < VALID_STATUSES.length; s++) {
            if (lifecycleKeys.indexOf(VALID_STATUSES[s]) === -1) {
                errors.push('LIFECYCLE_RULES missing entry for status: "' + VALID_STATUSES[s] + '".');
            }
        }

        var transitionKeys = Object.keys(STATUS_TRANSITIONS);
        for (var st = 0; st < VALID_STATUSES.length; st++) {
            if (transitionKeys.indexOf(VALID_STATUSES[st]) === -1) {
                errors.push('STATUS_TRANSITIONS missing entry for status: "' + VALID_STATUSES[st] + '".');
            }
        }

        var modeKeys = Object.keys(MODE_TO_PARTICIPANT_TYPE);
        for (var m = 0; m < VALID_MODES.length; m++) {
            if (modeKeys.indexOf(VALID_MODES[m]) === -1) {
                errors.push('MODE_TO_PARTICIPANT_TYPE missing entry for mode: "' + VALID_MODES[m] + '".');
            }
        }

        // ---- Label map coverage ----
        // Every enum value must have a label. A missing label means a
        // caller will fall through to the raw string, which is a UX
        // bug waiting to surface. Fail loudly at load.

        function validateLabelCoverage(enumName, list, mapName, map) {
            for (var i = 0; i < list.length; i++) {
                var v = list[i];
                if (!Object.prototype.hasOwnProperty.call(map, v)) {
                    errors.push(
                        mapName + ' missing label for ' + enumName +
                        ' value: "' + v + '".'
                    );
                } else if (typeof map[v] !== 'string' || map[v] === '') {
                    errors.push(
                        mapName + ' has empty/non-string label for "' +
                        v + '".'
                    );
                }
            }
        }

        validateLabelCoverage(
            'VALID_STATUSES', VALID_STATUSES,
            'STATUS_LABELS', STATUS_LABELS
        );
        validateLabelCoverage(
            'VALID_MODES', VALID_MODES,
            'MODE_LABELS', MODE_LABELS
        );
        validateLabelCoverage(
            'VALID_MATCH_STATUSES', VALID_MATCH_STATUSES,
            'MATCH_STATUS_LABELS', MATCH_STATUS_LABELS
        );
        validateLabelCoverage(
            'VALID_MATCH_TYPES', VALID_MATCH_TYPES,
            'MATCH_TYPE_LABELS', MATCH_TYPE_LABELS
        );
        validateLabelCoverage(
            'VALID_PARTICIPANT_TYPES', VALID_PARTICIPANT_TYPES,
            'PARTICIPANT_TYPE_LABELS', PARTICIPANT_TYPE_LABELS
        );
        validateLabelCoverage(
            'VALID_RESULTS', VALID_RESULTS,
            'RESULT_LABELS', RESULT_LABELS
        );

        // ---- parsePositiveInteger smoke test ----
        // The parser is load-bearing for the whole module. Prove it
        // behaves before publishing. Any failure here is a load-time
        // bug, not a runtime surprise.

        function expectParse(input, expected, label) {
            var got = parsePositiveInteger(input);
            if (got !== expected) {
                errors.push(
                    'parsePositiveInteger(' + label + ') returned ' +
                    got + ', expected ' + expected + '.'
                );
            }
        }

        expectParse(1, 1, '1');
        expectParse(42, 42, '42');
        expectParse('42', 42, '"42"');
        expectParse('  7  ', 7, '"  7  "');
        expectParse(0, null, '0');
        expectParse(-1, null, '-1');
        expectParse(1.5, null, '1.5');
        expectParse('1.5', null, '"1.5"');
        expectParse('12abc', null, '"12abc"');
        expectParse('1e2', null, '"1e2"');
        expectParse('', null, '""');
        expectParse('   ', null, '"   "');
        expectParse(null, null, 'null');
        expectParse(undefined, null, 'undefined');
        expectParse(NaN, null, 'NaN');
        expectParse(Infinity, null, 'Infinity');
        expectParse(true, null, 'true');
        expectParse({}, null, '{}');
        expectParse([], null, '[]');
        expectParse(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
            'MAX_SAFE_INTEGER');
        expectParse(Number.MAX_SAFE_INTEGER + 1, null, 'MAX_SAFE_INTEGER+1');

        if (errors.length > 0) {
            // Constant-table errors are load-order bugs, not runtime
            // degradations. Surface them loudly. The module still
            // publishes so downstream callers do not throw on load,
            // but the console warning is unmissable.
            console.warn('[TournamentConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    validateConstants();

    deepFreeze(VALID_STATUSES);
    deepFreeze(VALID_MODES);
    deepFreeze(VALID_MATCH_TYPES);
    deepFreeze(VALID_MATCH_STATUSES);
    deepFreeze(VALID_PARTICIPANT_TYPES);
    deepFreeze(VALID_RESULTS);
    deepFreeze(LIFECYCLE_RULES);
    deepFreeze(STATUS_TRANSITIONS);
    deepFreeze(MODE_TO_PARTICIPANT_TYPE);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentConstants = Object.freeze({
        // Enums (re-exported from TournamentSchema when available;
        // local fallback otherwise)
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_RESULTS: VALID_RESULTS,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        // Defaults
        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_MATCH_TYPE: DEFAULT_MATCH_TYPE,
        DEFAULT_ROUND_MATCH_SIZE: DEFAULT_ROUND_MATCH_SIZE,
        DEFAULT_TOTAL_ROUNDS: DEFAULT_TOTAL_ROUNDS,

        // Rules tables
        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        MODE_TO_PARTICIPANT_TYPE: MODE_TO_PARTICIPANT_TYPE,

        // Label maps (read-only references; frozen above)
        STATUS_LABELS: STATUS_LABELS,
        MODE_LABELS: MODE_LABELS,
        MATCH_STATUS_LABELS: MATCH_STATUS_LABELS,
        MATCH_TYPE_LABELS: MATCH_TYPE_LABELS,
        PARTICIPANT_TYPE_LABELS: PARTICIPANT_TYPE_LABELS,
        RESULT_LABELS: RESULT_LABELS,

        // Bounds (computed lazily from CalendarConstants)
        get MIN_WEEK() { return getComputedBounds().MIN_WEEK; },
        get MAX_WEEK() { return getComputedBounds().MAX_WEEK; },

        // Enum validation
        isValidStatus: isValidStatus,
        isValidMode: isValidMode,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidResult: isValidResult,
        isValidGroupExamResult: isValidGroupExamResult,

        // Mode → participant type
        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,

        // Lifecycle helpers
        getLifecycleRules: getLifecycleRules,
        isStatusTransitionAllowed: isStatusTransitionAllowed,
        getAllowedTransitions: getAllowedTransitions,

        // Label lookups
        getStatusLabel: getStatusLabel,
        getModeLabel: getModeLabel,
        getMatchStatusLabel: getMatchStatusLabel,
        getMatchTypeLabel: getMatchTypeLabel,
        getParticipantTypeLabel: getParticipantTypeLabel,
        getResultLabel: getResultLabel,

        // Integer parsing
        parsePositiveInteger: parsePositiveInteger,

        // Diagnostics
        checkDependencies: checkDependencies,
        validateConstants: validateConstants
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentConstants;
        var missing = [];

        try {
            var week = exports.MIN_WEEK;
            if (typeof week !== 'number') {
                missing.push('MIN_WEEK (computed)');
            }
        } catch (e) {
            missing.push('MIN_WEEK (computed property error)');
        }

        var requiredFns = [
            'isValidStatus', 'isValidMode', 'isValidMatchType',
            'isValidMatchStatus', 'isValidParticipantType', 'isValidResult',
            'isValidGroupExamResult',
            'getCanonicalParticipantType', 'isParticipantTypeCanonical',
            'getLifecycleRules', 'isStatusTransitionAllowed', 'getAllowedTransitions',
            'getStatusLabel', 'getModeLabel', 'getMatchStatusLabel',
            'getMatchTypeLabel', 'getParticipantTypeLabel', 'getResultLabel',
            'parsePositiveInteger'
        ];
        for (var i = 0; i < requiredFns.length; i++) {
            if (typeof exports[requiredFns[i]] !== 'function') {
                missing.push(requiredFns[i]);
            }
        }

        var requiredConsts = [
            'VALID_STATUSES', 'VALID_MODES', 'VALID_MATCH_TYPES',
            'VALID_MATCH_STATUSES', 'VALID_PARTICIPANT_TYPES', 'VALID_RESULTS',
            'LIFECYCLE_RULES', 'STATUS_TRANSITIONS', 'MODE_TO_PARTICIPANT_TYPE',
            'STATUS_LABELS', 'MODE_LABELS', 'MATCH_STATUS_LABELS',
            'MATCH_TYPE_LABELS', 'PARTICIPANT_TYPE_LABELS', 'RESULT_LABELS'
        ];
        for (var j = 0; j < requiredConsts.length; j++) {
            if (exports[requiredConsts[j]] === undefined) {
                missing.push(requiredConsts[j]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentConstants] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();