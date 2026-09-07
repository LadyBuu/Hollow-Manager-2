/**
 * js/modules/tournaments/tournaments-matches.js - Tournament Match Operations
 * CANONICAL match mutation API for tournaments.
 * 
 * MATCH PHILOSOPHY:
 *   - All match mutations go through this API
 *   - Invalid inputs are REJECTED (not silently filtered)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - ALL validation is performed against a proposed state BEFORE any mutation
 *   - Caller is responsible for persistence via MutationUtils
 *   - loser and advancing are DERIVED for standard matches, not independently mutable
 *   - Public mutation methods return DEFENSIVE COPIES of the mutated object
 *   - Match creation/update/completion uses buildProposedMatch()
 *   - Removal uses the same build-validate-apply approach (cloning + validation)
 * 
 * LIFECYCLE RULES:
 *   - Only completeMatch() can transition a match to 'completed'
 *   - updateMatch() cannot change status to 'completed'
 *   - Pending matches may have a provisional winner (setMatchWinner)
 *   - Completion freezes the result
 *   - Results are only valid for group_exam matches
 *   - Type changes only allowed for pending matches with no winner/results
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - This module does NOT log activity
 *   - MutationUtils owns persistence and activity logging
 * 
 * DEPENDENCIES:
 *   - window.TournamentsSchema - Structural validation and derivation
 *   - window.TournamentLifecycle - Lifecycle permissions
 *   - window.TournamentsCore - Tournament lookup
 *   - window.ObjectUtils - Deep cloning
 *   - window.IdUtils - ID normalisation
 * 
 * SEMANTIC INVARIANTS ENFORCED:
 *   - Group exams: winner and loser must be null
 *   - Results only valid for group_exam matches
 *   - Standard matches: winner determines advancing
 *   - Standard 2-person matches: winner determines loser AND advancing
 *   - Winner must be an active tournament participant (not eliminated)
 *   - Cannot modify a completed match
 *   - Cannot modify a match in a completed round
 *   - Participant changes cannot leave a stale winner
 *   - Result participants must be in the match
 *   - Type changes only allowed for pending matches with no results
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsMatchesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsSchema) {
        missing.push('TournamentsSchema');
    }

    if (!window.TournamentLifecycle) {
        missing.push('TournamentLifecycle');
    }

    if (!window.TournamentsCore) {
        missing.push('TournamentsCore');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentsMatches] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentsMatchesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Schema = window.TournamentsSchema;
    var Lifecycle = window.TournamentLifecycle;
    var Core = window.TournamentsCore;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_MODES = Schema.VALID_MODES;
    var VALID_MATCH_TYPES = Schema.VALID_MATCH_TYPES;
    var VALID_MATCH_STATUSES = Schema.VALID_MATCH_STATUSES;
    var VALID_GROUP_EXAM_RESULTS = Schema.VALID_GROUP_EXAM_RESULTS;

    // Allowed update keys - frozen
    var ALLOWED_UPDATE_KEYS = Object.freeze([
        'participants',
        'type',
        'status',
        'winner',
        'results'
    ]);

    // Internal match keys
    var MATCH_KEYS = Object.freeze([
        'participants',
        'type',
        'status',
        'winner',
        'loser',
        'advancing',
        'results'
    ]);

    // Type change rules
    var TYPE_CHANGE_ALLOWED_STATUSES = Object.freeze(['pending']);

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
            return null;
        }
        return num;
    }

    function getTournamentWithRounds(id) {
        var tournament = Core.getTournament(id);
        if (!tournament) {
            return null;
        }
        if (!Array.isArray(tournament.rounds)) {
            return null;
        }
        return tournament;
    }

    function getRound(tournament, roundIndex) {
        if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
            return null;
        }
        var round = tournament.rounds[roundIndex];
        if (!round || typeof round !== 'object') {
            return null;
        }
        if (!Array.isArray(round.matches)) {
            return null;
        }
        return round;
    }

    function getMutableRound(tournament, roundIndex) {
        var round = getRound(tournament, roundIndex);
        if (!round) {
            return null;
        }
        if (round.status === 'completed') {
            return null;
        }
        return round;
    }

    function getMatch(round, matchIndex) {
        if (matchIndex < 0 || matchIndex >= round.matches.length) {
            return null;
        }
        var match = round.matches[matchIndex];
        if (!match || typeof match !== 'object') {
            return null;
        }
        return match;
    }

    function validateParticipant(tournament, participantId, expectedType) {
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }

        var isInTournament = Schema.isParticipantInTournament(tournament, id);
        if (!isInTournament) {
            return false;
        }

        var isEliminated = Schema.isParticipantEliminated(tournament, id);
        if (isEliminated) {
            return false;
        }

        if (expectedType) {
            var participantRecord = Schema.getParticipantTypeFromRecord(tournament, id);
            if (participantRecord !== expectedType) {
                return false;
            }
        }

        return true;
    }

    function validateMatchParticipants(tournament, participantIds, expectedType) {
        if (!Array.isArray(participantIds) || participantIds.length < 2) {
            return false;
        }

        var seen = Object.create(null);
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) {
                return false;
            }
            if (seen[id]) {
                return false;
            }
            seen[id] = true;
            if (!validateParticipant(tournament, id, expectedType)) {
                return false;
            }
        }

        return true;
    }

    function validateResultParticipants(participants, results) {
        if (!results || typeof results !== 'object') {
            return true;
        }

        var participantIds = participants.map(normaliseId).filter(function(id) {
            return id !== null;
        });

        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var id = normaliseId(keys[i]);
            if (id === null) {
                return false;
            }
            if (participantIds.indexOf(id) === -1) {
                return false;
            }
        }
        return true;
    }

    function deriveLoser(participants, winner) {
        return Schema.deriveLoser(participants, winner);
    }

    function deriveAdvancing(match) {
        return Schema.deriveAdvancing(match);
    }

    function normaliseIdArrayStrict(ids) {
        if (!Array.isArray(ids)) {
            return null;
        }
        var result = [];
        var seen = Object.create(null);
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised === null) {
                return null;
            }
            if (seen[normalised]) {
                return null;
            }
            seen[normalised] = true;
            result.push(normalised);
        }
        return result;
    }

    function normaliseResultsStrict(results) {
        if (!isObject(results)) {
            return null;
        }
        var normalised = Object.create(null);
        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                return null;
            }
            var value = results[key];
            if (VALID_GROUP_EXAM_RESULTS.indexOf(value) === -1) {
                return null;
            }
            normalised[id] = value;
        }
        return normalised;
    }

    function hasOnlyAllowedKeys(object, allowedKeys) {
        var keys = Object.keys(object);
        for (var i = 0; i < keys.length; i++) {
            if (allowedKeys.indexOf(keys[i]) === -1) {
                return false;
            }
        }
        return true;
    }

    function isTypeChangeAllowed(base) {
        if (!base) {
            return false;
        }
        if (TYPE_CHANGE_ALLOWED_STATUSES.indexOf(base.status) === -1) {
            return false;
        }
        if (base.winner) {
            return false;
        }
        if (base.results && Object.keys(base.results).length > 0) {
            return false;
        }
        return true;
    }

    function cloneMatch(match) {
        if (!match || typeof match !== 'object') {
            return null;
        }
        return deepClone(match);
    }

    function cloneRound(round) {
        if (!round || typeof round !== 'object') {
            return round;
        }
        var copy = Object.assign({}, round);
        if (Array.isArray(round.matches)) {
            copy.matches = round.matches.map(cloneMatch).filter(function(m) {
                return m !== null;
            });
        }
        return copy;
    }

    function buildProposedTournament(tournament, roundIndex, proposedRound) {
        var proposed = Object.assign({}, tournament);
        proposed.rounds = tournament.rounds.map(function(r, idx) {
            if (idx === roundIndex) {
                return proposedRound;
            }
            return cloneRound(r);
        });
        return proposed;
    }

    function applyProposedMatch(match, proposed) {
        var changed = false;
        for (var k = 0; k < MATCH_KEYS.length; k++) {
            var key = MATCH_KEYS[k];
            if (JSON.stringify(match[key]) !== JSON.stringify(proposed[key])) {
                match[key] = proposed[key];
                changed = true;
            }
        }
        return changed;
    }

    // ============================================================
    // BUILD PROPOSED MATCH - SINGLE CANONICAL CONSTRUCTION
    // ============================================================

    /**
     * Build a complete proposed match state.
     * This is the SINGLE canonical match construction function.
     * Used by ALL match creation/update/completion operations.
     * 
     * @param {object} base - Existing match state
     * @param {object} updates - Updates to apply
     * @param {object} tournament - Tournament object
     * @param {object} round - Round object
     * @param {object} options - Build options
     * @param {boolean} options.allowCompletion - Whether completion is allowed
     * @returns {object|null} Proposed match or null
     */
    function buildProposedMatch(base, updates, tournament, round, options) {
        options = options || {};
        var allowCompletion = options.allowCompletion === true;

        // ---- Reject unknown update keys ----
        if (!hasOnlyAllowedKeys(updates, ALLOWED_UPDATE_KEYS)) {
            return null;
        }

        // ---- Normalise updates ----
        var normalisedUpdates = {};

        if (updates.participants !== undefined) {
            var participants = normaliseIdArrayStrict(updates.participants);
            if (participants === null) {
                return null;
            }
            normalisedUpdates.participants = participants;
        }

        // ---- Type change validation ----
        var proposedType = updates.type !== undefined
            ? updates.type
            : (base.type || round.matchType || 'standard');

        if (updates.type !== undefined && updates.type !== base.type) {
            if (!isTypeChangeAllowed(base)) {
                return null;
            }
            if (VALID_MATCH_TYPES.indexOf(proposedType) === -1) {
                return null;
            }
        }

        normalisedUpdates.type = proposedType;

        // ---- Status validation ----
        var currentStatus = base.status || 'pending';
        var newStatus = updates.status !== undefined ? updates.status : currentStatus;

        // Only completeMatch() can set 'completed'
        if (newStatus === 'completed' && currentStatus !== 'completed') {
            if (!allowCompletion) {
                return null;
            }
        }

        if (updates.status !== undefined && updates.status !== currentStatus) {
            if (VALID_MATCH_STATUSES.indexOf(updates.status) === -1) {
                return null;
            }
            if (updates.status === 'completed' && currentStatus !== 'completed') {
                if (!allowCompletion) {
                    return null;
                }
            }
            normalisedUpdates.status = updates.status;
        }

        // ---- Results validation ----
        if (updates.results !== undefined && proposedType !== 'group_exam') {
            return null;
        }

        if (updates.winner !== undefined) {
            if (updates.winner === null) {
                normalisedUpdates.winner = null;
            } else {
                var winner = normaliseId(updates.winner);
                if (winner === null) {
                    return null;
                }
                normalisedUpdates.winner = winner;
            }
        }

        if (updates.results !== undefined) {
            if (updates.results === null || updates.results === undefined) {
                normalisedUpdates.results = {};
            } else {
                var results = normaliseResultsStrict(updates.results);
                if (results === null) {
                    return null;
                }
                normalisedUpdates.results = results;
            }
        }

        // ---- Build proposed state ----
        var proposed = {
            participants: normalisedUpdates.participants !== undefined
                ? normalisedUpdates.participants
                : (base.participants ? base.participants.slice() : []),
            type: normalisedUpdates.type,
            status: normalisedUpdates.status !== undefined
                ? normalisedUpdates.status
                : (base.status !== undefined ? base.status : 'pending'),
            winner: normalisedUpdates.winner !== undefined
                ? normalisedUpdates.winner
                : (base.winner !== undefined ? base.winner : null),
            loser: null,
            advancing: [],
            results: normalisedUpdates.results !== undefined
                ? normalisedUpdates.results
                : (base.results ? Object.assign({}, base.results) : {})
        };

        // ---- Enforce match size ----
        var matchSize = round.matchSize || 2;
        if (proposed.participants.length !== matchSize) {
            return null;
        }

        // ---- Group exam: reject explicit winner ----
        if (proposed.type === 'group_exam') {
            if (normalisedUpdates.winner !== undefined && normalisedUpdates.winner !== null) {
                return null;
            }
            if (base.winner !== undefined && base.winner !== null && !updates.winner) {
                return null;
            }
            proposed.winner = null;
            proposed.loser = null;
        }

        // ---- Validate winner is still valid after participant changes ----
        if (proposed.winner !== null) {
            if (proposed.participants.indexOf(proposed.winner) === -1) {
                return null;
            }
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, proposed.winner, expectedType)) {
                return null;
            }
        }

        // ---- Validate all participants are active ----
        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        if (!validateMatchParticipants(tournament, proposed.participants, expectedType)) {
            return null;
        }

        // ---- Validate result participants belong to the match ----
        if (!validateResultParticipants(proposed.participants, proposed.results)) {
            return null;
        }

        // ---- Derive loser for standard 2-person matches ----
        if (proposed.type === 'standard' && proposed.participants.length === 2) {
            if (proposed.winner) {
                proposed.loser = deriveLoser(proposed.participants, proposed.winner);
            } else {
                proposed.loser = null;
            }
        }

        // ---- Derive advancing for ALL matches ----
        proposed.advancing = deriveAdvancing(proposed);

        return proposed;
    }

    /**
     * Validate a complete proposed match state.
     * MUTATION-SPECIFIC validation + delegation to Schema.
     * 
     * @param {object} proposed - Proposed match state
     * @param {object} tournament - Tournament object
     * @param {object} round - Round object
     * @param {number} matchIndex - Match index (-1 for new matches)
     * @returns {object} { valid: boolean, errors: array }
     */
    function validateProposedMatch(proposed, tournament, round, matchIndex) {
        var errors = [];

        // ---- Mutation-specific validation ----
        if (round.status === 'completed') {
            errors.push('Cannot modify matches in a completed round.');
            return { valid: false, errors: errors };
        }

        if (matchIndex >= 0) {
            var existingMatch = getMatch(round, matchIndex);
            if (existingMatch && existingMatch.status === 'completed') {
                errors.push('Cannot modify a completed match.');
                return { valid: false, errors: errors };
            }
        }

        // ---- Delegate structural validation to Schema ----
        var schemaResult = Schema.validateMatch(proposed, tournament, true, round);
        if (!schemaResult.valid) {
            schemaResult.errors.forEach(function(err) {
                errors.push(err);
            });
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // MATCH API
    // ============================================================

    var TournamentsMatches = {
        /**
         * Add a match to a round.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {object} matchData - Match data
         * @returns {object|null} Defensive copy of the created match
         */
        addMatch: function(tournamentId, roundIndex, matchData) {
            if (!isObject(matchData)) {
                return null;
            }

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return null;
            }

            // ---- Build base match ----
            var base = {
                participants: [],
                type: round.matchType || 'standard',
                status: 'pending',
                winner: null,
                loser: null,
                advancing: [],
                results: {}
            };

            var proposedMatch = buildProposedMatch(base, matchData, tournament, round);
            if (proposedMatch === null) {
                return null;
            }

            var validation = validateProposedMatch(proposedMatch, tournament, round, -1);
            if (!validation.valid) {
                return null;
            }

            // ---- Build proposed tournament state ----
            var proposedRound = cloneRound(round);
            proposedRound.matches.push(proposedMatch);

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return null;
            }

            // ---- Apply ----
            round.matches.push(proposedMatch);

            return cloneMatch(proposedMatch);
        },

        /**
         * Remove a match from a round.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match to remove
         * @returns {boolean} Success
         */
        removeMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return false;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return false;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return false;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return false;
            }

            if (match.status === 'completed') {
                return false;
            }

            // ---- Build proposed state ----
            var proposedMatches = round.matches
                .filter(function(_, idx) {
                    return idx !== matchIndex;
                })
                .map(cloneMatch)
                .filter(function(m) {
                    return m !== null;
                });

            var proposedRound = cloneRound(round);
            proposedRound.matches = proposedMatches;

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return false;
            }

            // ---- Apply ----
            round.matches = proposedMatches;

            return true;
        },

        /**
         * Update a match.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * NOTE: Cannot change status to 'completed'. Use completeMatch() for that.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match to update
         * @param {object} updates - Updates to apply
         * @returns {object|null} Defensive copy of the updated match
         */
        updateMatch: function(tournamentId, roundIndex, matchIndex, updates) {
            if (!isObject(updates)) {
                return null;
            }

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return null;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return null;
            }

            if (match.status === 'completed') {
                return null;
            }

            // ---- Build proposed match ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) {
                return null;
            }

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) {
                return null;
            }

            // ---- Build proposed tournament state ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            }).filter(function(m) {
                return m !== null;
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return null;
            }

            // ---- Apply ----
            applyProposedMatch(match, proposedMatch);

            return cloneMatch(match);
        },

        /**
         * Complete a match.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * This is the ONLY way to transition a match to 'completed' status.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match to complete
         * @param {string|null} winnerId - Winner ID (standard matches)
         * @param {object|null} results - Results (group exam matches)
         * @returns {object|null} Defensive copy of the completed match
         */
        completeMatch: function(tournamentId, roundIndex, matchIndex, winnerId, results) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return null;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return null;
            }

            if (match.status === 'completed') {
                return null;
            }

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            var updates = { status: 'completed' };

            if (match.type === 'standard') {
                if (winnerId === undefined || winnerId === null) {
                    return null;
                }
                var winnerNormalised = normaliseId(winnerId);
                if (winnerNormalised === null) {
                    return null;
                }
                if (match.participants.indexOf(winnerNormalised) === -1) {
                    return null;
                }
                if (!validateParticipant(tournament, winnerNormalised, expectedType)) {
                    return null;
                }
                updates.winner = winnerNormalised;
            }

            if (match.type === 'group_exam') {
                if (!results || !isObject(results) || Object.keys(results).length === 0) {
                    return null;
                }
                var normalisedResults = normaliseResultsStrict(results);
                if (normalisedResults === null) {
                    return null;
                }
                // All participants must have results
                for (var i = 0; i < match.participants.length; i++) {
                    if (!normalisedResults[match.participants[i]]) {
                        return null;
                    }
                }
                if (!validateResultParticipants(match.participants, normalisedResults)) {
                    return null;
                }
                updates.results = normalisedResults;
            }

            // ---- Build proposed match (with completion allowed) ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round, {
                allowCompletion: true
            });
            if (proposedMatch === null) {
                return null;
            }

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) {
                return null;
            }

            // ---- Build proposed tournament state ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            }).filter(function(m) {
                return m !== null;
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return null;
            }

            // ---- Apply ----
            applyProposedMatch(match, proposedMatch);

            return cloneMatch(match);
        },

        /**
         * Set a group exam result.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @param {string} participantId - Participant ID
         * @param {string} result - 'pass' or 'fail'
         * @returns {object|null} Defensive copy of the updated match
         */
        setGroupExamResult: function(tournamentId, roundIndex, matchIndex, participantId, result) {
            var participantNormalised = normaliseId(participantId);
            if (participantNormalised === null) {
                return null;
            }

            if (!result) {
                return null;
            }
            if (result !== 'pass' && result !== 'fail') {
                return null;
            }

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return null;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return null;
            }

            if (match.type !== 'group_exam') {
                return null;
            }
            if (match.status === 'completed') {
                return null;
            }

            if (match.participants.indexOf(participantNormalised) === -1) {
                return null;
            }

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, participantNormalised, expectedType)) {
                return null;
            }

            var updates = {
                results: Object.assign({}, match.results || {})
            };
            updates.results[participantNormalised] = result;

            // ---- Build proposed match ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) {
                return null;
            }

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) {
                return null;
            }

            // ---- Build proposed tournament state ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            }).filter(function(m) {
                return m !== null;
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return null;
            }

            // ---- Apply ----
            applyProposedMatch(match, proposedMatch);

            return cloneMatch(match);
        },

        /**
         * Set a match winner.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * NOTE: Pending standard matches may have a provisional winner.
         * Completion freezes the result.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @param {string} winnerId - Winner ID
         * @returns {object|null} Defensive copy of the updated match
         */
        setMatchWinner: function(tournamentId, roundIndex, matchIndex, winnerId) {
            var winnerNormalised = normaliseId(winnerId);
            if (winnerNormalised === null) {
                return null;
            }

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getMutableRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) {
                return null;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return null;
            }

            if (match.type === 'group_exam') {
                return null;
            }
            if (match.status === 'completed') {
                return null;
            }

            if (match.participants.indexOf(winnerNormalised) === -1) {
                return null;
            }

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, winnerNormalised, expectedType)) {
                return null;
            }

            var updates = { winner: winnerNormalised };

            // ---- Build proposed match ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) {
                return null;
            }

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) {
                return null;
            }

            // ---- Build proposed tournament state ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            }).filter(function(m) {
                return m !== null;
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- Validate proposed tournament ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) {
                return null;
            }

            // ---- Apply ----
            applyProposedMatch(match, proposedMatch);

            return cloneMatch(match);
        },

        // ============================================================
        // READ OPERATIONS - Defensive copies
        // ============================================================

        /**
         * Get matches for a round (defensive copies).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @returns {array} Array of match objects
         */
        getRoundMatches: function(tournamentId, roundIndex) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return [];
            }

            var round = getRound(tournament, roundIndex);
            if (!round) {
                return [];
            }

            return round.matches.map(cloneMatch).filter(function(m) {
                return m !== null;
            });
        },

        /**
         * Get a match (defensive copy).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {object|null} Match object or null
         */
        getMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) {
                return null;
            }

            var round = getRound(tournament, roundIndex);
            if (!round) {
                return null;
            }

            var match = getMatch(round, matchIndex);
            if (!match) {
                return null;
            }

            return cloneMatch(match);
        },

        /**
         * Check if a match is complete.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {boolean} True if complete
         */
        isMatchComplete: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) {
                return false;
            }
            return match.status === 'completed';
        },

        /**
         * Get match winner.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {string|null} Winner ID or null
         */
        getMatchWinner: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) {
                return null;
            }
            return match.winner || null;
        },

        /**
         * Get match loser(s).
         * For standard matches, returns the loser if present.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {array} Array of loser IDs
         */
        getMatchLosers: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) {
                return [];
            }
            if (match.loser) {
                return [match.loser];
            }
            return [];
        },

        /**
         * Get participants advancing from a match.
         * ALWAYS derives from the current match state.
         * This is the SINGLE SOURCE OF TRUTH for advancing.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {array} Array of advancing participant IDs
         */
        getMatchAdvancing: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) {
                return [];
            }
            return deriveAdvancing(match);
        },

        // ============================================================
        // VALIDATION HELPERS
        // ============================================================

        /**
         * Validate a match object against the schema.
         * 
         * @param {object} match - Match object
         * @param {object} tournament - Tournament object
         * @param {boolean} strict - Strict validation
         * @param {object} round - Round object
         * @returns {object} { valid: boolean, errors: array }
         */
        validateMatch: function(match, tournament, strict, round) {
            return Schema.validateMatch(match, tournament, strict, round);
        },

        /**
         * Derive advancing from a match state.
         * This is the canonical derivation function.
         * 
         * @param {object} match - Match object
         * @returns {array} Array of advancing participant IDs
         */
        deriveAdvancing: deriveAdvancing,

        /**
         * Check if a type change is allowed for a match.
         * 
         * @param {object} match - Match object
         * @returns {boolean} True if type change is allowed
         */
        isTypeChangeAllowed: isTypeChangeAllowed,

        /**
         * Validate that result participants belong to the match.
         * 
         * @param {array} participants - Array of participant IDs
         * @param {object} results - Results object
         * @returns {boolean} True if valid
         */
        validateResultParticipants: validateResultParticipants
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsMatches = TournamentsMatches;

})();
