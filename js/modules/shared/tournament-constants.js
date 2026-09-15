/**
 * modules/tournaments/tournament-constants.js - Tournament Constants
 * Single source of truth for all tournament-related constants
 * Path: js/modules/tournaments/tournament-constants.js
 *
 * This module provides:
 *   - Tournament status definitions (draft, active, completed)
 *   - Tournament mode definitions (teams, individuals)
 *   - Match type definitions
 *   - Match status definitions (pending, in_progress, completed)
 *   - Participant type definitions (character, team)
 *   - Result vocabulary (pass, retry, fail)
 *   - Lifecycle rules (permissions by status)
 *   - Status transition rules
 *   - Default values
 *   - Week bounds from CalendarConstants
 *
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for tournament constants.
 *   - Enum lists (VALID_MATCH_TYPES, VALID_RESULTS) are DERIVED from
 *     TournamentSchema. TournamentSchema owns the canonical enums;
 *     this module re-exports them. Do not add a parallel list here.
 *   - Constants are DEEP FROZEN to prevent mutation.
 *   - Uses lazy loading for CalendarConstants.
 *   - Validation runs BEFORE publishing to ensure integrity.
 *   - No DOM, no state, no persistence - pure constants only.
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
 *   The enums are read once at load time from TournamentSchema. If
 *   TournamentSchema is not loaded when this module initializes, the
 *   local fallback lists are used and a console warning is emitted.
 *   In the current script-tag order, TournamentSchema loads first.
 *
 * OWNED BY THIS MODULE:
 *   - LIFECYCLE_RULES
 *   - STATUS_TRANSITIONS
 *   - MODE_TO_PARTICIPANT_TYPE
 *   - DEFAULT_STATUS / DEFAULT_MODE / DEFAULT_MATCH_TYPE / DEFAULT_ROUND_MATCH_SIZE / DEFAULT_TOTAL_ROUNDS
 *
 *   The schema does not express lifecycle or transitions; those are
 *   this module's concern.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Tournaments are scoped to WEEKS (bounded 1-52), not years.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants    (for week bounds) - LAZY
 *   - window.TournamentSchema     (for canonical enums) - LAZY
 *
 * USAGE:
 *   var TC = window.TournamentConstants;
 *   var statuses = TC.VALID_STATUSES;
 *   var isDraft = TC.isValidStatus('draft');
 *   var canEdit = TC.LIFECYCLE_RULES[status].canEditMetadata;
 *   var weekRange = { min: TC.MIN_WEEK, max: TC.MAX_WEEK };
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
    //
    // The schema owns these lists. This module re-exports them by
    // reference. If the schema is not loaded when this module
    // initializes, we fall back to local lists that match the
    // schema's current values. The fallback is defensive only; in
    // the current script-tag order, the schema loads first.

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
        'standard',
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

    // Legacy alias. Kept for callers that still reference the old
    // name. Same array as VALID_RESULTS.
    var VALID_GROUP_EXAM_RESULTS = VALID_RESULTS;

    // ============================================================
    // DEFAULT VALUES
    // ============================================================

    var DEFAULT_STATUS = 'draft';
    var DEFAULT_MODE = 'teams';
    var DEFAULT_MATCH_TYPE = 'standard';
    var DEFAULT_ROUND_MATCH_SIZE = 2;
    var DEFAULT_TOTAL_ROUNDS = 1;

    // ============================================================
    // LIFECYCLE RULES - Explicit permissions by status
    // ============================================================

    /**
     * Lifecycle rules per status. Owned by this module — the schema
     * does not express lifecycle.
     *
     * Each status defines what operations are permitted:
     *   - canEditMetadata: Can change name, mode, weeks, totalRounds
     *   - canModifyParticipants: Can add/remove participants
     *   - canAddRounds: Can add new rounds
     *   - canRemoveRounds: Can remove existing rounds
     *   - canModifyEliminations: Can add/remove eliminations
     *   - canComplete: Can mark tournament as completed
     *
     * These are STATUS-BASED permissions. Additional conditions are
     * checked in TournamentRules and TournamentLifecycle.
     */
    var LIFECYCLE_RULES = {
        draft: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: false,
            canComplete: true,
            description: 'Setup phase - fully editable'
        },
        active: {
            canEditMetadata: true,
            canModifyParticipants: false,
            canAddRounds: true,
            canRemoveRounds: false,
            canModifyEliminations: true,
            canComplete: true,
            description: 'Running phase - limited edits'
        },
        completed: {
            canEditMetadata: false,
            canModifyParticipants: false,
            canAddRounds: false,
            canRemoveRounds: false,
            canModifyEliminations: false,
            canComplete: false,
            description: 'Finished phase - read only'
        }
    };

    // ============================================================
    // STATUS TRANSITION RULES
    // ============================================================

    var STATUS_TRANSITIONS = {
        'draft': ['active', 'completed'],
        'active': ['completed'],
        'completed': []
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
    // LOOKUP FUNCTIONS
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

    /**
     * Legacy alias. Same behavior as isValidResult.
     */
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
        if (fromStatus === toStatus) {
            return true;
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

    /**
     * Validate all constants for internal consistency.
     *
     * This runs at load time. It validates:
     *   - enum arrays are non-empty, no duplicates, no empty strings
     *   - DEFAULTS reference valid enum values
     *   - LIFECYCLE_RULES cover exactly the valid statuses
     *   - STATUS_TRANSITIONS cover exactly the valid statuses
     *   - MODE_TO_PARTICIPANT_TYPE covers exactly the valid modes
     *
     * Errors are logged, not thrown. A load-time validation failure
     * does not prevent the module from publishing its constants.
     */
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
        for (var lk = 0; lk < lifecycleKeys.length; lk++) {
            var lStatus = lifecycleKeys[lk];
            if (!isValidStatus(lStatus)) {
                errors.push('LIFECYCLE_RULES contains invalid status: "' + lStatus + '".');
                continue;
            }
            var rules = LIFECYCLE_RULES[lStatus];
            var requiredProps = [
                'canEditMetadata',
                'canModifyParticipants',
                'canAddRounds',
                'canRemoveRounds',
                'canModifyEliminations',
                'canComplete'
            ];
            for (var p = 0; p < requiredProps.length; p++) {
                if (typeof rules[requiredProps[p]] !== 'boolean') {
                    errors.push('LIFECYCLE_RULES["' + lStatus + '"].' + requiredProps[p] + ' must be a boolean.');
                }
            }
            if (!rules.description || typeof rules.description !== 'string') {
                errors.push('LIFECYCLE_RULES["' + lStatus + '"].description is required.');
            }
        }

        var transitionKeys = Object.keys(STATUS_TRANSITIONS);
        for (var st = 0; st < VALID_STATUSES.length; st++) {
            if (transitionKeys.indexOf(VALID_STATUSES[st]) === -1) {
                errors.push('STATUS_TRANSITIONS missing entry for status: "' + VALID_STATUSES[st] + '".');
            }
        }
        for (var tk = 0; tk < transitionKeys.length; tk++) {
            var tStatus = transitionKeys[tk];
            if (!isValidStatus(tStatus)) {
                errors.push('STATUS_TRANSITIONS contains invalid status: "' + tStatus + '".');
                continue;
            }
            var targets = STATUS_TRANSITIONS[tStatus];
            if (!Array.isArray(targets)) {
                errors.push('STATUS_TRANSITIONS["' + tStatus + '"] must be an array.');
                continue;
            }
            for (var t = 0; t < targets.length; t++) {
                if (!isValidStatus(targets[t])) {
                    errors.push('STATUS_TRANSITIONS["' + tStatus + '"] contains invalid target: "' + targets[t] + '".');
                }
                if (targets[t] === tStatus) {
                    errors.push('STATUS_TRANSITIONS["' + tStatus + '"] contains itself as a target.');
                }
            }
        }

        var modeKeys = Object.keys(MODE_TO_PARTICIPANT_TYPE);
        for (var m = 0; m < VALID_MODES.length; m++) {
            if (modeKeys.indexOf(VALID_MODES[m]) === -1) {
                errors.push('MODE_TO_PARTICIPANT_TYPE missing entry for mode: "' + VALID_MODES[m] + '".');
            }
        }
        for (var mk = 0; mk < modeKeys.length; mk++) {
            var mode = modeKeys[mk];
            if (!isValidMode(mode)) {
                errors.push('MODE_TO_PARTICIPANT_TYPE contains invalid mode: "' + mode + '".');
                continue;
            }
            if (!isValidParticipantType(MODE_TO_PARTICIPANT_TYPE[mode])) {
                errors.push('MODE_TO_PARTICIPANT_TYPE["' + mode + '"] contains invalid type: "' +
                    MODE_TO_PARTICIPANT_TYPE[mode] + '".');
            }
        }

        if (errors.length > 0) {
            console.warn('[TournamentConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    // The enum arrays come from TournamentSchema. If they are the
    // schema's arrays, they are already frozen by the schema. If we
    // fell back to local lists, they are not frozen yet. Freeze
    // defensively either way — deepFreeze is idempotent on already-
    // frozen arrays.
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
        // Enum lists (re-exported from TournamentSchema)
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_RESULTS: VALID_RESULTS,
        // Legacy alias. Same array as VALID_RESULTS.
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        // Defaults
        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_MATCH_TYPE: DEFAULT_MATCH_TYPE,
        DEFAULT_ROUND_MATCH_SIZE: DEFAULT_ROUND_MATCH_SIZE,
        DEFAULT_TOTAL_ROUNDS: DEFAULT_TOTAL_ROUNDS,

        // Lifecycle (owned by this module)
        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        MODE_TO_PARTICIPANT_TYPE: MODE_TO_PARTICIPANT_TYPE,

        // Bounds (computed from CalendarConstants)
        get MIN_WEEK() { return getComputedBounds().MIN_WEEK; },
        get MAX_WEEK() { return getComputedBounds().MAX_WEEK; },

        // Lookup functions
        isValidStatus: isValidStatus,
        isValidMode: isValidMode,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidResult: isValidResult,
        // Legacy alias. Same behavior as isValidResult.
        isValidGroupExamResult: isValidGroupExamResult,

        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,

        getLifecycleRules: getLifecycleRules,
        isStatusTransitionAllowed: isStatusTransitionAllowed,
        getAllowedTransitions: getAllowedTransitions,

        // Re-check dependencies
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
            'getLifecycleRules', 'isStatusTransitionAllowed', 'getAllowedTransitions'
        ];
        for (var i = 0; i < requiredFns.length; i++) {
            if (typeof exports[requiredFns[i]] !== 'function') {
                missing.push(requiredFns[i]);
            }
        }

        var requiredConsts = [
            'VALID_STATUSES', 'VALID_MODES', 'VALID_MATCH_TYPES',
            'VALID_MATCH_STATUSES', 'VALID_PARTICIPANT_TYPES', 'VALID_RESULTS',
            'LIFECYCLE_RULES', 'STATUS_TRANSITIONS', 'MODE_TO_PARTICIPANT_TYPE'
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
