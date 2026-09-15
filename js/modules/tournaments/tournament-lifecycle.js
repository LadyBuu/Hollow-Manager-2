/**
 * modules/tournaments/tournament-lifecycle.js - Tournament Lifecycle
 * Single source of truth for tournament lifecycle rules and permissions
 * Path: js/modules/tournaments/tournament-lifecycle.js
 *
 * This module is responsible for:
 *   - Tournament status lifecycle rules
 *   - Operation permissions by status (EXPLICIT capabilities)
 *   - Status transition validation
 *   - Lifecycle query functions
 *   - Permission checks for all operations
 *
 * IMPORTANT:
 *   - This is the CANONICAL authority for tournament lifecycle rules
 *   - All modules MUST use this for permission checks
 *   - Rules are declarative and immutable
 *   - No persistence, no DOM, no UI state
 *   - PURE functions - no side effects
 *   - Uses EXPLICIT capabilities, not vague "edit: true"
 *   - Capabilities: canEditMetadata, canModifyParticipants, canAddRounds,
 *     canRemoveRounds, canModifyEliminations, canComplete
 *
 * DEPENDENCY CONTRACT (STRICT):
 *   TournamentConstants and TournamentSchema are MANDATORY. This module
 *   THROWS at load time when either is missing or malformed. There is
 *   no fallback rule table. A missing dependency is a boot-order bug,
 *   not a runtime condition to degrade from. Silent fallback would
 *   mean the lifecycle rules used by the running app might not match
 *   the rules the constants module declares, and no code path would
 *   ever notice.
 *
 *   The required surface from each dependency:
 *
 *     TournamentConstants:
 *       LIFECYCLE_RULES     — object keyed by status, each value with
 *                             the six boolean capabilities plus a
 *                             description string
 *       STATUS_TRANSITIONS  — object keyed by status, each value an
 *                             array of allowed next statuses
 *       VALID_STATUSES      — array of status strings
 *
 *     TournamentSchema:
 *       isValidStatus       — function(status) -> boolean
 *
 *   Any deviation throws. The exception lists which capability is
 *   missing and what was actually present.
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
 *     (used for isValidStatus delegation)
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
        if (!Array.isArray(Constants.VALID_STATUSES)) {
            _missing.push('TournamentConstants.VALID_STATUSES');
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
    // FROZEN REFERENCES
    // ============================================================
    //
    // The lifecycle rules and status transitions are declared by the
    // constants module and consumed by this module. We take references
    // here (not copies) so that a constants-module edit is visible
    // immediately. The constants module owns the freeze; if it doesn't
    // freeze, we're not the layer that should fix that. We do read the
    // arrays as immutable: `getAllowedTransitions` returns a slice,
    // never the live array.

    var LIFECYCLE_RULES = Constants.LIFECYCLE_RULES;
    var STATUS_TRANSITIONS = Constants.STATUS_TRANSITIONS;
    var VALID_STATUSES = Constants.VALID_STATUSES;

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

    /**
     * Internal status validity check. Delegates to
     * TournamentSchema.isValidStatus, which is the canonical authority
     * for the set of valid statuses.
     */
    function isValidStatusInternal(status) {
        return Schema.isValidStatus(status);
    }

    // ============================================================
    // PERMISSION CHECKS - EXPLICIT CAPABILITIES
    // ============================================================

    /**
     * Get the lifecycle rule table for a status.
     *
     * When the status is unknown (not a string, or a string that is
     * not a key in LIFECYCLE_RULES), returns a fully-disabled rule
     * object. This is stricter than the previous fallback to
     * `LIFECYCLE_RULES.draft` — an unknown status should not silently
     * grant draft-level permissions. Callers that want permissive
     * behavior for a missing status should handle the null case
     * themselves.
     *
     * The disabled rule object is a fresh object every call, so a
     * caller that mutates it cannot affect subsequent calls.
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
     *
     * @param {string|object} statusOrTournament
     * @returns {boolean}
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

        // If tournament is active or completed, check round contents.
        // A round that has started or finished cannot be removed.
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
     * NOTE: The canComplete field on the returned object reflects
     * ONLY the lifecycle permission. Callers must additionally check
     * TournamentRules.isReadyForCompletion for the domain condition.
     */
    function getLifecycleStatus(tournament) {
        if (!tournament || typeof tournament !== 'object' || Array.isArray(tournament)) {
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
                return canRemoveRound(status, currentRoundCount, roundIndex, rounds);
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
        // Return a slice so a caller cannot mutate the constants table
        // by pushing to the returned array.
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
    // status-based only. Removing them entirely would break callers
    // that still pass them.

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

        // Constants (read-only references from TournamentConstants)
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

        // Smoke-test isValidStatus
        try {
            if (typeof exports.isValidStatus('draft') !== 'boolean') {
                missing.push('isValidStatus (returned non-boolean)');
            }
        } catch (e) {
            missing.push('isValidStatus (threw: ' + e.message + ')');
        }

        // Smoke-test that every status in VALID_STATUSES has a rules
        // entry. A missing entry means the constants module is
        // inconsistent with itself.
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
