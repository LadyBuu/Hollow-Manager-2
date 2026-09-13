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
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    var missing = [];

    if (!window.TournamentConstants) {
        missing.push('TournamentConstants');
    }
    if (!window.TournamentSchema) {
        missing.push('TournamentSchema');
    }

    if (missing.length > 0) {
        console.warn('[TournamentLifecycle] Missing dependencies:', missing.join(', '));
        // Fall back to default rules below.
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Constants = window.TournamentConstants || {};
    var Schema = window.TournamentSchema || {};

    // ============================================================
    // LIFECYCLE RULES TABLE
    // ============================================================
    //
    // Each status has a set of explicit capabilities. There is no
    // generic "editable" flag. Each operation checks its specific
    // capability.
    //
    // canComplete means "lifecycle permits completion". The domain
    // prerequisite (every round done) is checked by Rules, not here.

    var LIFECYCLE_RULES = Constants.LIFECYCLE_RULES || {
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

    var STATUS_TRANSITIONS = Constants.STATUS_TRANSITIONS || {
        'draft': ['active', 'completed'],
        'active': ['completed'],
        'completed': []
    };

    var VALID_STATUSES = Constants.VALID_STATUSES || ['draft', 'active', 'completed'];

    window.__tournamentLifecycleLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Extract a status string from either a status string or a
     * tournament object. Returns null if neither yields a usable
     * status.
     */
    function extractStatus(statusOrTournament) {
        if (typeof statusOrTournament === 'string') {
            return statusOrTournament;
        }
        if (statusOrTournament && typeof statusOrTournament === 'object') {
            return statusOrTournament.status || null;
        }
        return null;
    }

    /**
     * Internal status validity check.
     * Delegates to TournamentSchema.isValidStatus when available,
     * otherwise falls back to the locally-known VALID_STATUSES list.
     */
    function isValidStatusInternal(status) {
        if (Schema.isValidStatus && typeof Schema.isValidStatus === 'function') {
            return Schema.isValidStatus(status);
        }
        return VALID_STATUSES.indexOf(status) !== -1;
    }

    // ============================================================
    // PERMISSION CHECKS - EXPLICIT CAPABILITIES
    // ============================================================

    function getLifecycleRules(status) {
        if (!status || typeof status !== 'string') {
            return LIFECYCLE_RULES.draft || {
                canEditMetadata: false,
                canModifyParticipants: false,
                canAddRounds: false,
                canRemoveRounds: false,
                canModifyEliminations: false,
                canComplete: false
            };
        }
        return LIFECYCLE_RULES[status] || LIFECYCLE_RULES.draft || {
            canEditMetadata: false,
            canModifyParticipants: false,
            canAddRounds: false,
            canRemoveRounds: false,
            canModifyEliminations: false,
            canComplete: false
        };
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
        if (!tournament || typeof tournament !== 'object') {
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

        var status = tournament.status || 'unknown';
        var rules = getLifecycleRules(status);
        var valid = isValidStatusInternal(status);

        return {
            status: status,
            valid: valid,
            mutable: rules.canEditMetadata ||
                     rules.canModifyParticipants ||
                     rules.canAddRounds ||
                     rules.canRemoveRounds ||
                     rules.canModifyEliminations ||
                     rules.canComplete,
            canEditMetadata: rules.canEditMetadata === true,
            canModifyParticipants: rules.canModifyParticipants === true,
            canAddRounds: rules.canAddRounds === true,
            canRemoveRounds: rules.canRemoveRounds === true,
            canModifyEliminations: rules.canModifyEliminations === true,
            canComplete: rules.canComplete === true,
            terminal: status === 'completed',
            description: rules.description || 'Unknown status',

            // Convenience closures
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
        if (!allowed) { return false; }

        return allowed.indexOf(toStatus) !== -1;
    }

    function getAllowedTransitions(status) {
        if (!isValidStatusInternal(status)) {
            return [];
        }
        var allowed = STATUS_TRANSITIONS[status];
        if (!allowed) { return []; }
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

        // Constants (read-only)
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

        if (missing.length > 0) {
            console.warn('[TournamentLifecycle] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();