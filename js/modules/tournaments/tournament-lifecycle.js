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
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentsSchema (from tournaments-schema.js) - MANDATORY (for isValidStatus)
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

    if (!window.TournamentsSchema) {
        missing.push('TournamentsSchema');
    }

    if (missing.length > 0) {
        console.warn('[TournamentLifecycle] Missing dependencies:', missing.join(', '));
        // Fallback to default rules if constants not available
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Constants = window.TournamentConstants || {};
    var Schema = window.TournamentsSchema || {};

    // Get lifecycle rules from Constants (if available)
    var LIFECYCLE_RULES = Constants.LIFECYCLE_RULES || {
        draft: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: false,
            canComplete: false,
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

    function getStatus(statusOrTournament) {
        if (typeof statusOrTournament === 'string') {
            return statusOrTournament;
        }
        if (statusOrTournament && typeof statusOrTournament === 'object') {
            return statusOrTournament.status || null;
        }
        return null;
    }

    function isValidStatus(status) {
        if (Schema.isValidStatus && typeof Schema.isValidStatus === 'function') {
            return Schema.isValidStatus(status);
        }
        return VALID_STATUSES.indexOf(status) !== -1;
    }

    // ============================================================
    // PERMISSION CHECKS - EXPLICIT CAPABILITIES
    // ============================================================

    /**
     * Get lifecycle rules for a status.
     * Returns default rules if status not found.
     * 
     * @param {string} status - Tournament status
     * @returns {object} Lifecycle rules
     */
    function getLifecycleRules(status) {
        if (!status || typeof status !== 'string') {
            return LIFECYCLE_RULES.draft || { canEditMetadata: false, canModifyParticipants: false, canAddRounds: false, canRemoveRounds: false, canModifyEliminations: false, canComplete: false };
        }
        return LIFECYCLE_RULES[status] || LIFECYCLE_RULES.draft || { canEditMetadata: false, canModifyParticipants: false, canAddRounds: false, canRemoveRounds: false, canModifyEliminations: false, canComplete: false };
    }

    /**
     * Check if a status is valid.
     * 
     * @param {string} status - Tournament status
     * @returns {boolean} True if valid
     */
    function isValidStatus(status) {
        return isValidStatus(status);
    }

    /**
     * Check if tournament metadata can be edited (name, mode, weeks, totalRounds).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if metadata can be edited
     */
    function canEditMetadata(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canEditMetadata === true;
    }

    /**
     * Check if participants can be modified (add/remove).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if participants can be modified
     */
    function canModifyParticipants(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canModifyParticipants === true;
    }

    /**
     * Check if eliminations can be modified.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if eliminations can be modified
     */
    function canModifyEliminations(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canModifyEliminations === true;
    }

    /**
     * Check if rounds can be added.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if rounds can be added
     */
    function canAddRounds(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canAddRounds === true;
    }

    /**
     * Check if rounds can be removed.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if rounds can be removed
     */
    function canRemoveRounds(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canRemoveRounds === true;
    }

    /**
     * Check if a tournament can be completed.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @param {boolean} winnerExists - Whether a winner has been determined
     * @returns {boolean} True if completion is allowed
     */
    function canCompleteTournament(statusOrTournament, winnerExists) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }

        var rules = getLifecycleRules(status);
        if (rules.canComplete !== true) {
            return false;
        }

        // Active tournaments require a winner to complete
        if (status === 'active' && !winnerExists) {
            return false;
        }

        return true;
    }

    /**
     * Check if a round can be added (includes count check).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @param {number} currentRoundCount - Current number of rounds
     * @param {number} totalRounds - Maximum rounds allowed
     * @returns {boolean} True if a round can be added
     */
    function canAddRound(statusOrTournament, currentRoundCount, totalRounds) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }

        var rules = getLifecycleRules(status);
        if (rules.canAddRounds !== true) {
            return false;
        }

        if (currentRoundCount >= totalRounds) {
            return false;
        }

        return true;
    }

    /**
     * Check if a round can be removed (includes count check).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @param {number} currentRoundCount - Current number of rounds
     * @param {number} roundIndex - Index of the round to remove
     * @param {array} rounds - Array of rounds (for checking completion status)
     * @returns {boolean} True if the round can be removed
     */
    function canRemoveRound(statusOrTournament, currentRoundCount, roundIndex, rounds) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }

        var rules = getLifecycleRules(status);
        if (rules.canRemoveRounds !== true) {
            return false;
        }

        if (currentRoundCount === 0) {
            return false;
        }

        if (roundIndex < 0 || roundIndex >= currentRoundCount) {
            return false;
        }

        // If tournament is active or completed, check if the round has completed matches
        if (status === 'active' || status === 'completed') {
            if (!rounds || !Array.isArray(rounds)) {
                return false;
            }

            var round = rounds[roundIndex];
            if (!round) {
                return false;
            }

            // Check if any matches in this round are completed
            if (Array.isArray(round.matches)) {
                var hasCompletedMatches = false;
                for (var i = 0; i < round.matches.length; i++) {
                    var match = round.matches[i];
                    if (match && match.status === 'completed') {
                        hasCompletedMatches = true;
                        break;
                    }
                }
                if (hasCompletedMatches) {
                    return false;
                }
            }

            // Check if the round itself is completed
            if (round.status === 'completed') {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if a status is terminal (completed).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if terminal
     */
    function isStatusTerminal(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        return status === 'completed';
    }

    /**
     * Check if any mutation is allowed on this status.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if any mutation is allowed
     */
    function isStatusMutable(statusOrTournament) {
        var status = getStatus(statusOrTournament);
        if (status === null) {
            return false;
        }
        var rules = getLifecycleRules(status);
        return rules.canEditMetadata === true ||
               rules.canModifyParticipants === true ||
               rules.canAddRounds === true ||
               rules.canRemoveRounds === true ||
               rules.canModifyEliminations === true ||
               rules.canComplete === true;
    }

    /**
     * Get the status of a tournament (normalised).
     * 
     * @param {object} tournament - Tournament object
     * @returns {string} Status or 'unknown'
     */
    function getStatus(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return 'unknown';
        }
        return tournament.status || 'unknown';
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY
    // ============================================================

    /**
     * Get complete lifecycle status of a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} Lifecycle status object with all capabilities
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

        // Check if status is valid
        var valid = isValidStatus(status);

        return {
            status: status,
            valid: valid,
            mutable: rules.canEditMetadata || rules.canModifyParticipants || rules.canAddRounds || rules.canRemoveRounds || rules.canModifyEliminations || rules.canComplete,
            canEditMetadata: rules.canEditMetadata === true,
            canModifyParticipants: rules.canModifyParticipants === true,
            canAddRounds: rules.canAddRounds === true,
            canRemoveRounds: rules.canRemoveRounds === true,
            canModifyEliminations: rules.canModifyEliminations === true,
            canComplete: rules.canComplete === true,
            terminal: status === 'completed',
            description: rules.description || 'Unknown status',
            // Helper methods for convenience
            canAddRound: function(currentRoundCount, totalRounds) {
                return canAddRound(status, currentRoundCount, totalRounds);
            },
            canRemoveRound: function(currentRoundCount, roundIndex, rounds) {
                return canRemoveRound(status, currentRoundCount, roundIndex, rounds);
            },
            canComplete: function(winnerExists) {
                return canCompleteTournament(status, winnerExists);
            }
        };
    }

    /**
     * Get the lifecycle rules table (read-only).
     * 
     * @returns {object} Immutable lifecycle rules
     */
    function getRulesTable() {
        return LIFECYCLE_RULES;
    }

    // ============================================================
    // STATUS TRANSITION VALIDATION
    // ============================================================

    /**
     * Check if a status transition is allowed.
     * 
     * @param {string} fromStatus - Current status
     * @param {string} toStatus - Desired status
     * @returns {boolean} True if transition is allowed
     */
    function isValidStatusTransition(fromStatus, toStatus) {
        if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
            return false;
        }

        // Same status is always allowed (no-op)
        if (fromStatus === toStatus) {
            return true;
        }

        // Check against transition table
        var allowed = STATUS_TRANSITIONS[fromStatus];
        if (!allowed) {
            return false;
        }

        return allowed.indexOf(toStatus) !== -1;
    }

    /**
     * Get allowed transitions for a status.
     * 
     * @param {string} status - Current status
     * @returns {array} Array of allowed status strings
     */
    function getAllowedTransitions(status) {
        if (!isValidStatus(status)) {
            return [];
        }

        var allowed = STATUS_TRANSITIONS[status];
        if (!allowed) {
            return [];
        }

        return allowed.slice();
    }

    /**
     * Get the next status after a transition.
     * 
     * @param {string} fromStatus - Current status
     * @param {string} toStatus - Desired status
     * @returns {string|null} The new status or null if invalid
     */
    function getTransitionResult(fromStatus, toStatus) {
        if (isValidStatusTransition(fromStatus, toStatus)) {
            return toStatus;
        }
        return null;
    }

    /**
     * Get the valid transitions with labels for UI.
     * 
     * @param {string} status - Current status
     * @returns {array} Array of { value, label } objects
     */
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
    // COMPLETION READINESS
    // ============================================================

    /**
     * Check if a tournament is ready for completion.
     * This checks both lifecycle permissions AND business conditions.
     * 
     * @param {object} tournament - Tournament object
     * @param {boolean} allRoundsComplete - Whether all rounds are complete
     * @param {boolean} hasWinner - Whether a winner exists
     * @returns {boolean} True if tournament can be completed
     */
    function isReadyForCompletion(tournament, allRoundsComplete, hasWinner) {
        if (!tournament) {
            return false;
        }

        // Check lifecycle permission
        if (!canCompleteTournament(tournament, hasWinner)) {
            return false;
        }

        // Check business conditions
        if (tournament.status === 'active') {
            if (!allRoundsComplete || !hasWinner) {
                return false;
            }
        }

        return true;
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
        getStatus: getStatus,

        // Lifecycle status
        getLifecycleStatus: getLifecycleStatus,
        getRulesTable: getRulesTable,

        // Status transitions
        isValidStatusTransition: isValidStatusTransition,
        getAllowedTransitions: getAllowedTransitions,
        getTransitionResult: getTransitionResult,
        getTransitionOptions: getTransitionOptions,

        // Completion readiness
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

        if (missing.length > 0) {
            console.warn('[TournamentLifecycle] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentLifecycle] All exports verified successfully.');
        }
    })();

})();
