/**
 * modules/tournaments/tournament-lifecycle.js - Tournament Lifecycle
 * Single source of truth for tournament lifecycle rules and permissions
 * Path: js/modules/tournaments/tournament-lifecycle.js
 * 
 * This module is responsible for:
 *   - Tournament status lifecycle rules
 *   - Operation permissions by status
 *   - Status transition validation
 *   - Lifecycle query functions
 * 
 * IMPORTANT:
 *   - This is the CANONICAL authority for tournament lifecycle rules
 *   - All modules MUST use this for permission checks
 *   - Rules are declarative and immutable
 *   - No persistence, no DOM, no UI state
 *   - PURE functions - no side effects
 * 
 * DEPENDENCIES:
 *   - window.TournamentsSchema (from tournaments-schema.js) - MANDATORY
 * 
 * USAGE:
 *   var Lifecycle = window.TournamentLifecycle;
 *   var canEdit = Lifecycle.canEditTournament('active');
 *   var status = Lifecycle.getLifecycleStatus(tournament);
 *   var canComplete = Lifecycle.canCompleteTournament(tournament);
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

    if (!window.TournamentsSchema) {
        throw new Error('[TournamentLifecycle] TournamentsSchema is required.');
    }

    var Schema = window.TournamentsSchema;

    // Get lifecycle rules from Schema (already frozen)
    var LIFECYCLE_RULES = Schema.LIFECYCLE_RULES;
    var VALID_STATUSES = Schema.VALID_STATUSES;

    window.__tournamentLifecycleLoaded = true;

    // ============================================================
    // PERMISSION CHECKS
    // ============================================================

    /**
     * Get lifecycle rules for a status.
     * Returns null for unknown statuses (no silent fallback).
     * 
     * @param {string} status - Tournament status
     * @returns {object|null} Lifecycle rules or null
     */
    function getLifecycleRules(status) {
        if (!status || typeof status !== 'string') {
            return null;
        }
        return LIFECYCLE_RULES[status] || null;
    }

    /**
     * Check if a status is valid.
     * 
     * @param {string} status - Tournament status
     * @returns {boolean} True if valid
     */
    function isValidStatus(status) {
        return Schema.isValidStatus(status);
    }

    /**
     * Check if a tournament can be edited (name, mode, weeks, rounds, etc.).
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if editable
     */
    function canEditTournament(statusOrTournament) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        return rules !== null && rules.edit === true;
    }

    /**
     * Check if participants can be modified.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if participants can be modified
     */
    function canModifyParticipants(statusOrTournament) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        return rules !== null && rules.participants === true;
    }

    /**
     * Check if eliminations can be modified.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if eliminations can be modified
     */
    function canModifyEliminations(statusOrTournament) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        return rules !== null && rules.eliminations === true;
    }

    /**
     * Check if rounds can be modified.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if rounds can be modified
     */
    function canModifyRounds(statusOrTournament) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        return rules !== null && rules.rounds === true;
    }

    /**
     * Check if a tournament can be completed.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @param {boolean} winnerExists - Whether a winner has been determined
     * @returns {boolean} True if completion is allowed
     */
    function canCompleteTournament(statusOrTournament, winnerExists) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        if (rules === null || rules.complete !== true) {
            return false;
        }

        // Active tournaments require a winner to complete
        if (status === 'active' && !winnerExists) {
            return false;
        }

        return true;
    }

    /**
     * Check if a round can be added.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @param {number} currentRoundCount - Current number of rounds
     * @param {number} totalRounds - Maximum rounds allowed
     * @returns {boolean} True if a round can be added
     */
    function canAddRound(statusOrTournament, currentRoundCount, totalRounds) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        if (rules === null || rules.rounds !== true) {
            return false;
        }

        if (currentRoundCount >= totalRounds) {
            return false;
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
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        return status === 'completed';
    }

    /**
     * Check if any mutation is allowed on this status.
     * 
     * @param {string|object} statusOrTournament - Status string or tournament object
     * @returns {boolean} True if any mutation is allowed
     */
    function isStatusMutable(statusOrTournament) {
        var status = typeof statusOrTournament === 'string'
            ? statusOrTournament
            : (statusOrTournament ? statusOrTournament.status : null);

        var rules = getLifecycleRules(status);
        if (rules === null) {
            return false;
        }

        return rules.edit === true ||
               rules.participants === true ||
               rules.rounds === true ||
               rules.eliminations === true ||
               rules.complete === true;
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY
    // ============================================================

    /**
     * Get complete lifecycle status of a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} Lifecycle status object
     */
    function getLifecycleStatus(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return {
                status: 'unknown',
                valid: false,
                mutable: false,
                edit: false,
                participants: false,
                rounds: false,
                eliminations: false,
                complete: false,
                terminal: false
            };
        }

        var status = tournament.status || 'unknown';
        var rules = getLifecycleRules(status);

        if (rules === null) {
            return {
                status: status,
                valid: false,
                mutable: false,
                edit: false,
                participants: false,
                rounds: false,
                eliminations: false,
                complete: false,
                terminal: false
            };
        }

        return {
            status: status,
            valid: true,
            mutable: rules.edit || rules.participants || rules.rounds || rules.eliminations || rules.complete,
            edit: rules.edit === true,
            participants: rules.participants === true,
            rounds: rules.rounds === true,
            eliminations: rules.eliminations === true,
            complete: rules.complete === true,
            terminal: status === 'completed',
            canAddRound: function(currentRoundCount, totalRounds) {
                return canAddRound(status, currentRoundCount, totalRounds);
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

        // Cannot transition out of completed
        if (fromStatus === 'completed') {
            return false;
        }

        // draft -> active or completed
        if (fromStatus === 'draft') {
            return toStatus === 'active' || toStatus === 'completed';
        }

        // active -> completed
        if (fromStatus === 'active') {
            return toStatus === 'completed';
        }

        return false;
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

        var allowed = [];
        for (var i = 0; i < VALID_STATUSES.length; i++) {
            var target = VALID_STATUSES[i];
            if (isValidStatusTransition(status, target)) {
                allowed.push(target);
            }
        }
        return allowed;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentLifecycle = {
        // Permission checks
        getLifecycleRules: getLifecycleRules,
        isValidStatus: isValidStatus,
        canEditTournament: canEditTournament,
        canModifyParticipants: canModifyParticipants,
        canModifyEliminations: canModifyEliminations,
        canModifyRounds: canModifyRounds,
        canCompleteTournament: canCompleteTournament,
        canAddRound: canAddRound,
        isStatusTerminal: isStatusTerminal,
        isStatusMutable: isStatusMutable,

        // Lifecycle status
        getLifecycleStatus: getLifecycleStatus,
        getRulesTable: getRulesTable,

        // Status transitions
        isValidStatusTransition: isValidStatusTransition,
        getAllowedTransitions: getAllowedTransitions,

        // Constants (read-only)
        LIFECYCLE_RULES: LIFECYCLE_RULES
    };

})();
