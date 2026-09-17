/**
 * modules/tournaments/tournament-lifecycle.js - Tournament Lifecycle
 * Single source of truth for tournament lifecycle rules and permissions.
 *
 * Path: js/modules/tournaments/tournament-lifecycle.js
 *
 * RESPONSIBILITIES:
 *   - Tournament status lifecycle rules
 *   - Operation permissions by status
 *   - Status transition validation
 *   - Lifecycle query functions
 *   - Permission checks for all operations
 *
 * STATUS MODEL (SIMPLIFIED):
 *   Tournaments are RECORDS, not state machines. Every capability is
 *   permitted in every status. The status field is a soft label the
 *   user controls. No operation is blocked by status.
 *
 *   The LIFECYCLE_RULES table still exists with the same shape so
 *   existing callers that read `rules.canX` keep working. Every
 *   capability is `true` for every status. The description strings
 *   reflect the label semantics.
 *
 *   STATUS_TRANSITIONS is fully permissive: every status can
 *   transition to every other status, and to itself (idempotent).
 *
 *   Round management has no caps. The user can add rounds beyond
 *   totalRounds, and remove rounds even after matches are completed.
 *   totalRounds is a planning hint, not an invariant.
 *
 * IMPORTANT:
 *   - This is the CANONICAL authority for tournament lifecycle
 *     queries. Every module reads through it. Those reads now return
 *     permissive values by design.
 *   - No persistence, no DOM, no UI state.
 *   - PURE functions - no side effects.
 *
 * DEPENDENCY CONTRACT (STRICT):
 *   TournamentConstants and TournamentSchema are MANDATORY. This
 *   module THROWS at load time when either is missing or malformed.
 *
 *     TournamentConstants:
 *       LIFECYCLE_RULES     — object keyed by status
 *       STATUS_TRANSITIONS  — object keyed by status
 *       VALID_STATUSES      — non-empty array of status strings
 *
 *     TournamentSchema:
 *       isValidStatus       — function(status) -> boolean
 *
 * FROZEN RULE TABLE:
 *   This module captures deep-frozen copies of LIFECYCLE_RULES and
 *   STATUS_TRANSITIONS at load time. Later mutations of the constants
 *   module have no effect here. A rule table is declared once and
 *   every check must be consistent.
 *
 * COMPLETION SEMANTICS:
 *   - The lifecycle module does NOT gate completion. Completion is
 *     whatever the user decides. No winner is required. Rounds do
 *     not need to be complete.
 *
 * MATCH TYPES:
 *   - No match type affects lifecycle rules.
 *
 * DEPENDENCIES:
 *   - window.TournamentConstants (MANDATORY)
 *   - window.TournamentSchema (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__tournamentLifecycleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var Constants = window.TournamentConstants;
    var Schema = window.TournamentSchema;

    var _missing = [];

    if (!Constants) {
        _missing.push('TournamentConstants (module)');
    } else {
        if (!Constants.LIFECYCLE_RULES ||
            typeof Constants.LIFECYCLE_RULES !== 'object' ||
            Array.isArray(Constants.LIFECYCLE_RULES)) {
            _missing.push('TournamentConstants.LIFECYCLE_RULES');
        }
        if (!Constants.STATUS_TRANSITIONS ||
            typeof Constants.STATUS_TRANSITIONS !== 'object' ||
            Array.isArray(Constants.STATUS_TRANSITIONS)) {
            _missing.push('TournamentConstants.STATUS_TRANSITIONS');
        }
        if (!Array.isArray(Constants.VALID_STATUSES) ||
            Constants.VALID_STATUSES.length === 0) {
            _missing.push('TournamentConstants.VALID_STATUSES (must be a non-empty array)');
        }
    }

    if (!Schema) {
        _missing.push('TournamentSchema (module)');
    } else {
        if (typeof Schema.isValidStatus !== 'function') {
            _missing.push('TournamentSchema.isValidStatus');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentLifecycle] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // CONSTANTS - FROZEN COPIES
    // ============================================================

    var CAPABILITY_KEYS = [
        'canEditMetadata',
        'canModifyParticipants',
        'canAddRounds',
        'canRemoveRounds',
        'canModifyEliminations',
        'canComplete'
    ];

    var VALID_STATUSES = Constants.VALID_STATUSES.slice();

    function deepFreeze(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (Object.isFrozen(value)) {
            return value;
        }

        Object.freeze(value);

        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
            deepFreeze(value[keys[i]]);
        }

        return value;
    }

    function buildFrozenRules(rawRules) {
        var result = {};

        for (var i = 0; i < VALID_STATUSES.length; i++) {
            var status = VALID_STATUSES[i];
            var raw = rawRules[status];

            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error(
                    '[TournamentLifecycle] LIFECYCLE_RULES is missing a ' +
                    'valid entry for status "' + status + '".'
                );
            }

            var entry = {};

            for (var k = 0; k < CAPABILITY_KEYS.length; k++) {
                var key = CAPABILITY_KEYS[k];
                if (typeof raw[key] !== 'boolean') {
                    throw new Error(
                        '[TournamentLifecycle] LIFECYCLE_RULES["' + status +
                        '"].' + key + ' must be a boolean.'
                    );
                }
                entry[key] = raw[key];
            }

            entry.description = (typeof raw.description === 'string')
                ? raw.description
                : '';

            result[status] = entry;
        }

        return deepFreeze(result);
    }

    function buildFrozenTransitions(rawTransitions) {
        var result = {};

        for (var i = 0; i < VALID_STATUSES.length; i++) {
            var status = VALID_STATUSES[i];
            var raw = rawTransitions[status];

            if (!Array.isArray(raw)) {
                throw new Error(
                    '[TournamentLifecycle] STATUS_TRANSITIONS is missing a ' +
                    'valid array for status "' + status + '".'
                );
            }

            var entry = [];
            for (var j = 0; j < raw.length; j++) {
                var target = raw[j];
                if (typeof target !== 'string') {
                    throw new Error(
                        '[TournamentLifecycle] STATUS_TRANSITIONS["' +
                        status + '"][' + j + '] must be a string.'
                    );
                }
                if (VALID_STATUSES.indexOf(target) === -1) {
                    throw new Error(
                        '[TournamentLifecycle] STATUS_TRANSITIONS["' +
                        status + '"] references unknown status "' +
                        target + '".'
                    );
                }
                entry.push(target);
            }

            result[status] = entry;
        }

        return deepFreeze(result);
    }

    var LIFECYCLE_RULES = buildFrozenRules(Constants.LIFECYCLE_RULES);
    var STATUS_TRANSITIONS = buildFrozenTransitions(Constants.STATUS_TRANSITIONS);

    window.__tournamentLifecycleLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function extractStatus(statusOrTournament) {
        if (typeof statusOrTournament === 'string') {
            return statusOrTournament;
        }
        if (statusOrTournament &&
            typeof statusOrTournament === 'object' &&
            !Array.isArray(statusOrTournament)) {
            var s = statusOrTournament.status;
            if (typeof s === 'string') {
                return s;
            }
            return null;
        }
        return null;
    }

    function isValidStatusInternal(status) {
        return Schema.isValidStatus(status);
    }

    // ============================================================
    // PERMISSION CHECKS
    // ============================================================

    function getLifecycleRules(status) {
        if (typeof status !== 'string' || status === '') {
            return {
                canEditMetadata: true,
                canModifyParticipants: true,
                canAddRounds: true,
                canRemoveRounds: true,
                canModifyEliminations: true,
                canComplete: true,
                description: 'Unknown status (permissive fallback)'
            };
        }

        var rule = LIFECYCLE_RULES[status];
        if (!rule || typeof rule !== 'object') {
            return {
                canEditMetadata: true,
                canModifyParticipants: true,
                canAddRounds: true,
                canRemoveRounds: true,
                canModifyEliminations: true,
                canComplete: true,
                description: 'Unknown status: ' + status
            };
        }

        return rule;
    }

    function canEditMetadata(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canEditMetadata === true;
    }

    function canModifyParticipants(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canModifyParticipants === true;
    }

    function canModifyEliminations(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canModifyEliminations === true;
    }

    function canAddRounds(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canAddRounds === true;
    }

    function canRemoveRounds(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canRemoveRounds === true;
    }

    function canCompleteTournament(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canComplete === true;
    }

    /**
     * Can a round be added?
     *
     * The lifecycle capability check is `true` for every status.
     * There is no cap on round count. totalRounds is a soft planning
     * hint, not an invariant.
     */
    function canAddRound(statusOrTournament, _currentRoundCount, _totalRounds) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canAddRounds === true;
    }

    /**
     * Can a round be removed?
     *
     * Any round can be removed at any time. Match states do not
     * block removal. The caller may want to fix records after the
     * fact, and that is the whole point of a record-keeping tool.
     */
    function canRemoveRound(statusOrTournament, _currentRoundCount, _roundIndex, _rounds) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return true; }
        return getLifecycleRules(status).canRemoveRounds === true;
    }

    function isStatusTerminal(statusOrTournament) {
        return false;
    }

    function isStatusMutable(statusOrTournament) {
        return true;
    }

    // ============================================================
    // PUBLIC STATUS VALIDITY CHECK
    // ============================================================

    function isValidStatus(status) {
        return isValidStatusInternal(status);
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY
    // ============================================================

    function getLifecycleStatus(tournament) {
        if (!tournament ||
            typeof tournament !== 'object' ||
            Array.isArray(tournament)) {
            return {
                status: 'unknown',
                valid: false,
                mutable: true,
                canEditMetadata: true,
                canModifyParticipants: true,
                canAddRounds: true,
                canRemoveRounds: true,
                canModifyEliminations: true,
                canComplete: true,
                terminal: false,
                description: 'Invalid tournament',
                canAddRound: function() { return true; },
                canRemoveRound: function() { return true; },
                canCompleteTournament: function() { return true; }
            };
        }

        var status = typeof tournament.status === 'string'
            ? tournament.status
            : 'unknown';

        var rules = getLifecycleRules(status);
        var valid = isValidStatusInternal(status);

        return {
            status: status,
            valid: valid,
            mutable: true,
            canEditMetadata: rules.canEditMetadata === true,
            canModifyParticipants: rules.canModifyParticipants === true,
            canAddRounds: rules.canAddRounds === true,
            canRemoveRounds: rules.canRemoveRounds === true,
            canModifyEliminations: rules.canModifyEliminations === true,
            canComplete: rules.canComplete === true,
            terminal: false,
            description: typeof rules.description === 'string'
                ? rules.description
                : 'Unknown status',

            canAddRound: function(_c, _t) {
                return canAddRound(status, _c, _t);
            },
            canRemoveRound: function(_c, _i, _r) {
                return canRemoveRound(status, _c, _i, _r);
            },
            canCompleteTournament: function() {
                return canCompleteTournament(status);
            }
        };
    }

    function getRulesTable() {
        return LIFECYCLE_RULES;
    }

    // ============================================================
    // STATUS TRANSITION VALIDATION
    // ============================================================

    function isValidStatusTransition(fromStatus, toStatus) {
        if (!isValidStatusInternal(fromStatus) ||
            !isValidStatusInternal(toStatus)) {
            return false;
        }

        if (fromStatus === toStatus) {
            return true;
        }

        var allowed = STATUS_TRANSITIONS[fromStatus];
        if (!Array.isArray(allowed)) { return false; }

        return allowed.indexOf(toStatus) !== -1;
    }

    function getAllowedTransitions(status) {
        if (!isValidStatusInternal(status)) {
            return [];
        }
        var allowed = STATUS_TRANSITIONS[status];
        if (!Array.isArray(allowed)) { return []; }
        return allowed.slice();
    }

    function getTransitionResult(fromStatus, toStatus) {
        if (isValidStatusTransition(fromStatus, toStatus)) {
            return toStatus;
        }
        return null;
    }

    function getTransitionOptions(status) {
        var transitions = getAllowedTransitions(status);
        var labels = {
            'draft': 'Draft',
            'active': 'Active',
            'completed': 'Completed'
        };

        return transitions.map(function(t) {
            return {
                value: t,
                label: labels[t] || t.charAt(0).toUpperCase() + t.slice(1)
            };
        });
    }

    // ============================================================
    // COMPLETION READINESS (LIFECYCLE SIDE)
    // ============================================================
    //
    // Always true. The domain decides whether the tournament is ready
    // in the semantic sense; the lifecycle module no longer imposes
    // a status-based gate.

    function isReadyForCompletion(tournament, _allRoundsComplete, _hasWinner) {
        if (!tournament) { return false; }
        return true;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentLifecycle = {
        getLifecycleRules: getLifecycleRules,
        isValidStatus: isValidStatus,
        canEditMetadata: canEditMetadata,
        canModifyParticipants: canModifyParticipants,
        canModifyEliminations: canModifyEliminations,
        canAddRounds: canAddRounds,
        canRemoveRounds: canRemoveRounds,
        canCompleteTournament: canCompleteTournament,
        canAddRound: canAddRound,
        canRemoveRound: canRemoveRound,
        isStatusTerminal: isStatusTerminal,
        isStatusMutable: isStatusMutable,

        getLifecycleStatus: getLifecycleStatus,
        getRulesTable: getRulesTable,

        isValidStatusTransition: isValidStatusTransition,
        getAllowedTransitions: getAllowedTransitions,
        getTransitionResult: getTransitionResult,
        getTransitionOptions: getTransitionOptions,

        isReadyForCompletion: isReadyForCompletion,

        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        VALID_STATUSES: VALID_STATUSES
    };

    (function verify() {
        var exports = window.TournamentLifecycle;
        var missing = [];

        var required = [
            'canEditMetadata', 'canModifyParticipants', 'canModifyEliminations',
            'canAddRounds', 'canRemoveRounds', 'canCompleteTournament',
            'isValidStatus', 'isStatusTerminal', 'isStatusMutable',
            'getLifecycleStatus', 'getRulesTable',
            'isValidStatusTransition', 'getAllowedTransitions',
            'isReadyForCompletion'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (typeof exports.isValidStatus('draft') !== 'boolean') {
                missing.push('isValidStatus (returned non-boolean)');
            }
        } catch (e) {
            missing.push('isValidStatus (threw: ' + e.message + ')');
        }

        for (var j = 0; j < VALID_STATUSES.length; j++) {
            var status = VALID_STATUSES[j];
            if (!LIFECYCLE_RULES[status]) {
                missing.push(
                    'LIFECYCLE_RULES missing entry for status: ' + status
                );
            }
            if (!Array.isArray(STATUS_TRANSITIONS[status])) {
                missing.push(
                    'STATUS_TRANSITIONS missing entry for status: ' + status
                );
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentLifecycle] Verification - some exports or ' +
                'constants may be missing:', missing.join(', ')
            );
        }
    })();

})();/**
 * modules/tournaments/tournament-lifecycle.js - Tournament Lifecycle
 * Single source of truth for tournament lifecycle rules and permissions.
 *
 * Path: js/modules/tournaments/tournament-lifecycle.js
 *
 * RESPONSIBILITIES:
 *   - Tournament status lifecycle rules
 *   - Operation permissions by status (EXPLICIT capabilities)
 *   - Status transition validation
 *   - Lifecycle query functions
 *   - Permission checks for all operations
 *
 * IMPORTANT:
 *   - This is the CANONICAL authority for tournament lifecycle rules.
 *   - All modules MUST use this for permission checks.
 *   - Rules are declarative and immutable.
 *   - No persistence, no DOM, no UI state.
 *   - PURE functions - no side effects.
 *   - Uses EXPLICIT capabilities, not vague "edit: true".
 *   - Capabilities: canEditMetadata, canModifyParticipants, canAddRounds,
 *     canRemoveRounds, canModifyEliminations, canComplete.
 *
 * DEPENDENCY CONTRACT (STRICT):
 *   TournamentConstants and TournamentSchema are MANDATORY. This module
 *   THROWS at load time when either is missing or malformed. There is
 *   no fallback rule table. A missing dependency is a boot-order bug,
 *   not a runtime condition to degrade from.
 *
 *   The required surface from each dependency:
 *
 *     TournamentConstants:
 *       LIFECYCLE_RULES     — object keyed by status, each value with
 *                             the six boolean capabilities plus a
 *                             description string
 *       STATUS_TRANSITIONS  — object keyed by status, each value an
 *                             array of allowed next statuses
 *       VALID_STATUSES      — non-empty array of status strings
 *
 *     TournamentSchema:
 *       isValidStatus       — function(status) -> boolean
 *
 *   Any deviation throws at load. The exception names the missing
 *   field and, where possible, what was actually present.
 *
 * RULE TABLE VALIDATION:
 *   At load time, this module walks LIFECYCLE_RULES for every entry in
 *   VALID_STATUSES and verifies that each entry:
 *     - exists and is an object
 *     - has all six capability keys, each strictly boolean
 *     - has a description string
 *   and walks STATUS_TRANSITIONS to verify each entry is an array of
 *   strings, each of which appears in VALID_STATUSES.
 *
 *   A malformed rule table throws. Silent tolerance of a malformed
 *   table would mean the app runs with lifecycle rules that don't match
 *   what the constants module declares, and no code path would ever
 *   notice. Throwing on load is the only failure mode that lets a
 *   developer catch the bug.
 *
 * FROZEN RULE TABLE:
 *   This module captures deep-frozen copies of LIFECYCLE_RULES and
 *   STATUS_TRANSITIONS. The copies are used for every read. This
 *   means:
 *
 *     - A later mutation of window.TournamentConstants.LIFECYCLE_RULES
 *       has no effect on this module. The rule table this module
 *       checks against is fixed at load time.
 *     - A caller that receives `getRulesTable()` cannot mutate the
 *       live rules. The deep-freeze makes the returned object
 *       immutable.
 *
 *   The trade-off: if the constants module is edited at runtime (which
 *   it shouldn't be), this module keeps using the original table. That
 *   is the correct semantics — a rule table is declared once, at load,
 *   and every check must be consistent.
 *
 * COMPLETION SEMANTICS:
 *   - A tournament can be completed when its lifecycle permits it.
 *     The DOMAIN condition (every round's matches completed) is
 *     validated separately by TournamentRules.isReadyForCompletion.
 *   - No winner is required. A tournament can finish with zero, one,
 *     or many final passers.
 *   - The lifecycle module does NOT inspect round or match state.
 *
 * MATCH TYPES:
 *   - No match type affects lifecycle rules directly.
 *   - Pair exams, group exams, and team matches share the same
 *     lifecycle rules as any other match.
 *
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *
 * USAGE:
 *   var Lifecycle = window.TournamentLifecycle;
 *   var canEdit = Lifecycle.canEditMetadata(tournament);
 *   var status = Lifecycle.getLifecycleStatus(tournament);
 *   var canComplete = Lifecycle.canCompleteTournament(tournament);
 *   var transitions = Lifecycle.getAllowedTransitions('draft');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentLifecycleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var Constants = window.TournamentConstants;
    var Schema = window.TournamentSchema;

    var _missing = [];

    // ---- TournamentConstants ----
    if (!Constants) {
        _missing.push('TournamentConstants (module)');
    } else {
        if (!Constants.LIFECYCLE_RULES ||
            typeof Constants.LIFECYCLE_RULES !== 'object' ||
            Array.isArray(Constants.LIFECYCLE_RULES)) {
            _missing.push('TournamentConstants.LIFECYCLE_RULES');
        }
        if (!Constants.STATUS_TRANSITIONS ||
            typeof Constants.STATUS_TRANSITIONS !== 'object' ||
            Array.isArray(Constants.STATUS_TRANSITIONS)) {
            _missing.push('TournamentConstants.STATUS_TRANSITIONS');
        }
        if (!Array.isArray(Constants.VALID_STATUSES) ||
            Constants.VALID_STATUSES.length === 0) {
            _missing.push('TournamentConstants.VALID_STATUSES (must be a non-empty array)');
        }
    }

    // ---- TournamentSchema ----
    if (!Schema) {
        _missing.push('TournamentSchema (module)');
    } else {
        if (typeof Schema.isValidStatus !== 'function') {
            _missing.push('TournamentSchema.isValidStatus');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentLifecycle] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // CONSTANTS - FROZEN COPIES
    // ============================================================

    var CAPABILITY_KEYS = [
        'canEditMetadata',
        'canModifyParticipants',
        'canAddRounds',
        'canRemoveRounds',
        'canModifyEliminations',
        'canComplete'
    ];

    var VALID_STATUSES = Constants.VALID_STATUSES.slice();

    /**
     * Deep-freeze a value. Recursively freezes objects and arrays.
     * Primitives pass through.
     */
    function deepFreeze(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (Object.isFrozen(value)) {
            return value;
        }

        Object.freeze(value);

        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
            deepFreeze(value[keys[i]]);
        }

        return value;
    }

    /**
     * Build a frozen, validated copy of LIFECYCLE_RULES.
     *
     * Every status in VALID_STATUSES must have a corresponding entry.
     * Each entry must be an object with all six capability keys, each
     * strictly boolean, plus a description string. Anything else
     * throws.
     */
    function buildFrozenRules(rawRules) {
        var result = {};

        for (var i = 0; i < VALID_STATUSES.length; i++) {
            var status = VALID_STATUSES[i];
            var raw = rawRules[status];

            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error(
                    '[TournamentLifecycle] LIFECYCLE_RULES is missing a ' +
                    'valid entry for status "' + status + '".'
                );
            }

            var entry = {};

            for (var k = 0; k < CAPABILITY_KEYS.length; k++) {
                var key = CAPABILITY_KEYS[k];
                if (typeof raw[key] !== 'boolean') {
                    throw new Error(
                        '[TournamentLifecycle] LIFECYCLE_RULES["' + status +
                        '"].' + key + ' must be a boolean.'
                    );
                }
                entry[key] = raw[key];
            }

            entry.description = (typeof raw.description === 'string')
                ? raw.description
                : '';

            result[status] = entry;
        }

        return deepFreeze(result);
    }

    /**
     * Build a frozen, validated copy of STATUS_TRANSITIONS.
     *
     * Every status in VALID_STATUSES must have a corresponding entry.
     * Each entry must be an array of strings; every string must be a
     * valid status. Anything else throws.
     */
    function buildFrozenTransitions(rawTransitions) {
        var result = {};

        for (var i = 0; i < VALID_STATUSES.length; i++) {
            var status = VALID_STATUSES[i];
            var raw = rawTransitions[status];

            if (!Array.isArray(raw)) {
                throw new Error(
                    '[TournamentLifecycle] STATUS_TRANSITIONS is missing a ' +
                    'valid array for status "' + status + '".'
                );
            }

            var entry = [];
            for (var j = 0; j < raw.length; j++) {
                var target = raw[j];
                if (typeof target !== 'string') {
                    throw new Error(
                        '[TournamentLifecycle] STATUS_TRANSITIONS["' +
                        status + '"][' + j + '] must be a string.'
                    );
                }
                if (VALID_STATUSES.indexOf(target) === -1) {
                    throw new Error(
                        '[TournamentLifecycle] STATUS_TRANSITIONS["' +
                        status + '"] references unknown status "' +
                        target + '".'
                    );
                }
                entry.push(target);
            }

            result[status] = entry;
        }

        return deepFreeze(result);
    }

    var LIFECYCLE_RULES = buildFrozenRules(Constants.LIFECYCLE_RULES);
    var STATUS_TRANSITIONS = buildFrozenTransitions(Constants.STATUS_TRANSITIONS);

    window.__tournamentLifecycleLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Extract a status string from either a status string or a
     * tournament object. Returns null if neither yields a usable
     * status.
     *
     * Rejects non-string status values on objects (a number, an array,
     * etc.) rather than coercing. A tournament with status: 7 is
     * malformed; treating 7 as a status would silently match nothing.
     */
    function extractStatus(statusOrTournament) {
        if (typeof statusOrTournament === 'string') {
            return statusOrTournament;
        }
        if (statusOrTournament &&
            typeof statusOrTournament === 'object' &&
            !Array.isArray(statusOrTournament)) {
            var s = statusOrTournament.status;
            if (typeof s === 'string') {
                return s;
            }
            return null;
        }
        return null;
    }

    function isValidStatusInternal(status) {
        return Schema.isValidStatus(status);
    }

    // ============================================================
    // PERMISSION CHECKS - EXPLICIT CAPABILITIES
    // ============================================================

    /**
     * Get the lifecycle rule table for a status.
     *
     * When the status is unknown (not a string, or a string not in the
     * rule table), returns a freshly-allocated fully-disabled rule
     * object. The caller cannot mutate the shared rule table by
     * writing to the returned object.
     *
     * The disabled fallback is intentionally restrictive: an unknown
     * status should grant NO capabilities, not draft-like permissions.
     */
    function getLifecycleRules(status) {
        if (typeof status !== 'string' || status === '') {
            return {
                canEditMetadata: false,
                canModifyParticipants: false,
                canAddRounds: false,
                canRemoveRounds: false,
                canModifyEliminations: false,
                canComplete: false,
                description: 'Unknown status'
            };
        }

        var rule = LIFECYCLE_RULES[status];
        if (!rule || typeof rule !== 'object') {
            return {
                canEditMetadata: false,
                canModifyParticipants: false,
                canAddRounds: false,
                canRemoveRounds: false,
                canModifyEliminations: false,
                canComplete: false,
                description: 'Unknown status: ' + status
            };
        }

        return rule;
    }

    function canEditMetadata(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canEditMetadata === true;
    }

    function canModifyParticipants(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canModifyParticipants === true;
    }

    function canModifyEliminations(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canModifyEliminations === true;
    }

    function canAddRounds(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canAddRounds === true;
    }

    function canRemoveRounds(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canRemoveRounds === true;
    }

    /**
     * Check whether the lifecycle permits completing a tournament.
     *
     * NOTE: This does NOT inspect round or match state, and does NOT
     * require a winner. The domain condition (every match done) is
     * checked by TournamentRules.validateCompletionReadiness.
     */
    function canCompleteTournament(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return getLifecycleRules(status).canComplete === true;
    }

    function canAddRound(statusOrTournament, currentRoundCount, totalRounds) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }

        var rules = getLifecycleRules(status);
        if (rules.canAddRounds !== true) { return false; }

        if (typeof currentRoundCount === 'number' &&
            typeof totalRounds === 'number' &&
            currentRoundCount >= totalRounds) {
            return false;
        }

        return true;
    }

    function canRemoveRound(statusOrTournament, currentRoundCount, roundIndex, rounds) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }

        var rules = getLifecycleRules(status);
        if (rules.canRemoveRounds !== true) { return false; }

        if (currentRoundCount === 0) { return false; }
        if (roundIndex < 0 || roundIndex >= currentRoundCount) { return false; }

        // A round with any completed match cannot be removed, and a
        // round whose own status is 'completed' cannot be removed,
        // regardless of its matches.
        if (status === 'active' || status === 'completed') {
            if (!Array.isArray(rounds)) { return false; }

            var round = rounds[roundIndex];
            if (!round) { return false; }

            if (Array.isArray(round.matches)) {
                for (var i = 0; i < round.matches.length; i++) {
                    var match = round.matches[i];
                    if (match && match.status === 'completed') {
                        return false;
                    }
                }
            }

            if (round.status === 'completed') {
                return false;
            }
        }

        return true;
    }

    function isStatusTerminal(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        return status === 'completed';
    }

    function isStatusMutable(statusOrTournament) {
        var status = extractStatus(statusOrTournament);
        if (status === null) { return false; }
        var rules = getLifecycleRules(status);
        return rules.canEditMetadata === true ||
               rules.canModifyParticipants === true ||
               rules.canAddRounds === true ||
               rules.canRemoveRounds === true ||
               rules.canModifyEliminations === true ||
               rules.canComplete === true;
    }

    // ============================================================
    // PUBLIC STATUS VALIDITY CHECK
    // ============================================================

    function isValidStatus(status) {
        return isValidStatusInternal(status);
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY
    // ============================================================

    /**
     * Get the complete lifecycle status of a tournament.
     *
     * NOTE: The canComplete field on the returned object reflects ONLY
     * the lifecycle permission. Callers must additionally check
     * TournamentRules.isReadyForCompletion for the domain condition.
     */
    function getLifecycleStatus(tournament) {
        if (!tournament ||
            typeof tournament !== 'object' ||
            Array.isArray(tournament)) {
            return {
                status: 'unknown',
                valid: false,
                mutable: false,
                canEditMetadata: false,
                canModifyParticipants: false,
                canAddRounds: false,
                canRemoveRounds: false,
                canModifyEliminations: false,
                canComplete: false,
                terminal: false,
                description: 'Invalid tournament'
            };
        }

        var status = typeof tournament.status === 'string'
            ? tournament.status
            : 'unknown';

        var rules = getLifecycleRules(status);
        var valid = isValidStatusInternal(status);

        return {
            status: status,
            valid: valid,
            mutable: rules.canEditMetadata === true ||
                     rules.canModifyParticipants === true ||
                     rules.canAddRounds === true ||
                     rules.canRemoveRounds === true ||
                     rules.canModifyEliminations === true ||
                     rules.canComplete === true,
            canEditMetadata: rules.canEditMetadata === true,
            canModifyParticipants: rules.canModifyParticipants === true,
            canAddRounds: rules.canAddRounds === true,
            canRemoveRounds: rules.canRemoveRounds === true,
            canModifyEliminations: rules.canModifyEliminations === true,
            canComplete: rules.canComplete === true,
            terminal: status === 'completed',
            description: typeof rules.description === 'string'
                ? rules.description
                : 'Unknown status',

            // Convenience closures. Bound to the captured `status`.
            canAddRound: function(currentRoundCount, totalRounds) {
                return canAddRound(status, currentRoundCount, totalRounds);
            },
            canRemoveRound: function(currentRoundCount, roundIndex, rounds) {
                return canRemoveRound(
                    status, currentRoundCount, roundIndex, rounds
                );
            },
            canCompleteTournament: function() {
                return canCompleteTournament(status);
            }
        };
    }

    /**
     * Return the frozen rule table.
     *
     * The returned object is deeply frozen. Callers cannot mutate it
     * to change lifecycle behavior. This is intentional.
     */
    function getRulesTable() {
        return LIFECYCLE_RULES;
    }

    // ============================================================
    // STATUS TRANSITION VALIDATION
    // ============================================================

    function isValidStatusTransition(fromStatus, toStatus) {
        if (!isValidStatusInternal(fromStatus) ||
            !isValidStatusInternal(toStatus)) {
            return false;
        }

        if (fromStatus === toStatus) {
            return true;
        }

        var allowed = STATUS_TRANSITIONS[fromStatus];
        if (!Array.isArray(allowed)) { return false; }

        return allowed.indexOf(toStatus) !== -1;
    }

    /**
     * Get the allowed transitions from a status.
     *
     * The status transitions table is frozen at load. The returned
     * array is a fresh slice, so a caller cannot mutate the frozen
     * table by pushing to the returned array.
     */
    function getAllowedTransitions(status) {
        if (!isValidStatusInternal(status)) {
            return [];
        }
        var allowed = STATUS_TRANSITIONS[status];
        if (!Array.isArray(allowed)) { return []; }
        return allowed.slice();
    }

    function getTransitionResult(fromStatus, toStatus) {
        if (isValidStatusTransition(fromStatus, toStatus)) {
            return toStatus;
        }
        return null;
    }

    function getTransitionOptions(status) {
        var transitions = getAllowedTransitions(status);
        var labels = {
            'draft': 'Start Tournament',
            'active': 'Complete Tournament',
            'completed': 'Reopen Tournament'
        };

        return transitions.map(function(t) {
            return {
                value: t,
                label: labels[t] || t.charAt(0).toUpperCase() + t.slice(1)
            };
        });
    }

    // ============================================================
    // COMPLETION READINESS (LIFECYCLE SIDE)
    // ============================================================
    //
    // This is a lifecycle-only check. It answers: "may the tournament
    // be moved to 'completed' status?" It does not inspect round or
    // match state. The domain check belongs in TournamentRules.
    //
    // Signature kept for backward compatibility with the previous
    // version, which took allRoundsComplete and hasWinner. Those
    // arguments are accepted but IGNORED — the lifecycle check is
    // status-based only.

    function isReadyForCompletion(tournament, _allRoundsComplete, _hasWinner) {
        if (!tournament) { return false; }
        return canCompleteTournament(tournament);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentLifecycle = {
        // Permission checks (explicit capabilities)
        getLifecycleRules: getLifecycleRules,
        isValidStatus: isValidStatus,
        canEditMetadata: canEditMetadata,
        canModifyParticipants: canModifyParticipants,
        canModifyEliminations: canModifyEliminations,
        canAddRounds: canAddRounds,
        canRemoveRounds: canRemoveRounds,
        canCompleteTournament: canCompleteTournament,
        canAddRound: canAddRound,
        canRemoveRound: canRemoveRound,
        isStatusTerminal: isStatusTerminal,
        isStatusMutable: isStatusMutable,

        // Lifecycle status
        getLifecycleStatus: getLifecycleStatus,
        getRulesTable: getRulesTable,

        // Status transitions
        isValidStatusTransition: isValidStatusTransition,
        getAllowedTransitions: getAllowedTransitions,
        getTransitionResult: getTransitionResult,
        getTransitionOptions: getTransitionOptions,

        // Completion readiness (lifecycle-only)
        isReadyForCompletion: isReadyForCompletion,

        // Constants (frozen)
        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        VALID_STATUSES: VALID_STATUSES
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentLifecycle;
        var missing = [];

        var required = [
            'canEditMetadata', 'canModifyParticipants', 'canModifyEliminations',
            'canAddRounds', 'canRemoveRounds', 'canCompleteTournament',
            'isValidStatus', 'isStatusTerminal', 'isStatusMutable',
            'getLifecycleStatus', 'getRulesTable',
            'isValidStatusTransition', 'getAllowedTransitions',
            'isReadyForCompletion'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (typeof exports.isValidStatus('draft') !== 'boolean') {
                missing.push('isValidStatus (returned non-boolean)');
            }
        } catch (e) {
            missing.push('isValidStatus (threw: ' + e.message + ')');
        }

        for (var j = 0; j < VALID_STATUSES.length; j++) {
            var status = VALID_STATUSES[j];
            if (!LIFECYCLE_RULES[status]) {
                missing.push(
                    'LIFECYCLE_RULES missing entry for status: ' + status
                );
            }
            if (!Array.isArray(STATUS_TRANSITIONS[status])) {
                missing.push(
                    'STATUS_TRANSITIONS missing entry for status: ' + status
                );
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentLifecycle] Verification - some exports or ' +
                'constants may be missing:', missing.join(', ')
            );
        }
    })();

})();
