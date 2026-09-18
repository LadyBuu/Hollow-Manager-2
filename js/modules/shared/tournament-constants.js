/**
 * modules/tournaments/tournament-constants.js - Tournament Constants
 * Single source of truth for all tournament-related constants
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
 * DEPENDENCIES:
 *   - window.CalendarConstants    (for week bounds) - LAZY
 *   - window.TournamentSchema     (for canonical enums) - LAZY
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

        if (errors.length > 0) {
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
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_RESULTS: VALID_RESULTS,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_MATCH_TYPE: DEFAULT_MATCH_TYPE,
        DEFAULT_ROUND_MATCH_SIZE: DEFAULT_ROUND_MATCH_SIZE,
        DEFAULT_TOTAL_ROUNDS: DEFAULT_TOTAL_ROUNDS,

        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        MODE_TO_PARTICIPANT_TYPE: MODE_TO_PARTICIPANT_TYPE,

        get MIN_WEEK() { return getComputedBounds().MIN_WEEK; },
        get MAX_WEEK() { return getComputedBounds().MAX_WEEK; },

        isValidStatus: isValidStatus,
        isValidMode: isValidMode,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidResult: isValidResult,
        isValidGroupExamResult: isValidGroupExamResult,

        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,

        getLifecycleRules: getLifecycleRules,
        isStatusTransitionAllowed: isStatusTransitionAllowed,
        getAllowedTransitions: getAllowedTransitions,

        checkDependencies: checkDependencies,
        validateConstants: validateConstants
    });

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
