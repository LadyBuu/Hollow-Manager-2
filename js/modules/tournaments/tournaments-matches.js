/**
 * js/modules/tournaments/tournaments-matches.js - Tournament Match Operations
 * CANONICAL match mutation API for tournaments.
 * 
 * MATCH PHILOSOPHY:
 *   - All match mutations go through this API
 *   - Invalid inputs are REJECTED (not silently filtered)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - ALL validation is performed against a proposed state BEFORE any mutation
 *   - Caller is responsible for persistence (saveData)
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
 *   - Callers own persistence
 * 
 * MUTATION PATTERN (applied to ALL mutations):
 *   1. Retrieve existing data
 *   2. Validate existing structure (via Schema)
 *   3. Validate operation-specific inputs (REJECT invalid, don't filter)
 *   4. Build complete proposed state (buildProposedMatch for creation/update/completion)
 *   5. Validate proposed state (mutation rules + Schema delegation)
 *   6. Apply COMPLETE proposed state (all fields)
 *   7. Return a DEFENSIVE COPY of the result
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
 *   - Result participants must be in the match (no arbitrary result keys)
 *   - Type changes only allowed for pending matches with no results
 *   - Pending standard matches may have a provisional winner; completion freezes the result
 *   - Schema validation functions MUST NOT mutate the supplied object
 * 
 * DEPENDENCIES:
 *   - TournamentsCore for tournament lookup
 *   - TournamentsSchema for shared validation
 *   - CALENDAR_CONSTANTS for week validation
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsMatchesLoaded) return;

    if (!window.TournamentsCore) {
        console.error('TournamentsMatches: TournamentsCore required.');
        return;
    }

    if (!window.TournamentsSchema) {
        console.error('TournamentsMatches: TournamentsSchema required.');
        return;
    }

    // Check CALENDAR_CONSTANTS
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = Number.isInteger(CALENDAR.MIN_WEEK) ? CALENDAR.MIN_WEEK : 1;
    var MAX_WEEK = Number.isInteger(CALENDAR.MAX_WEEK) ? CALENDAR.MAX_WEEK : 52;

    window.__tournamentsMatchesLoaded = true;

    var Core = window.TournamentsCore;
    var Schema = window.TournamentsSchema;

    // ============================================================
    // VALIDATION HELPERS (from Schema)
    // ============================================================

    var isObject = Schema.isObject;
    var isValidMatchType = Schema.isValidMatchType;
    var isValidMatchStatus = Schema.isValidMatchStatus;
    var isValidGroupExamResult = Schema.isValidGroupExamResult;
    var normaliseId = Schema.normaliseId;

    // ============================================================
    // CONSTANTS
    // ============================================================

    // advancing and loser are DERIVED - NOT publicly updateable for standard matches
    // Results are NOT publicly updateable for standard matches
    var ALLOWED_UPDATE_KEYS = [
        'participants',
        'type',
        'status',
        'winner',
        'results'
    ];

    // Internal keys - includes derived fields
    var MATCH_KEYS = [
        'participants',
        'type',
        'status',
        'winner',
        'loser',
        'advancing',
        'results'
    ];

    // Type change rules
    var TYPE_CHANGE_ALLOWED_STATUSES = ['pending'];

    // Valid status transitions (only completeMatch can set 'completed')
    var STATUS_TRANSITIONS = {
        'pending': ['in_progress', 'pending'],
        'in_progress': ['pending', 'in_progress'],
        'completed': []  // No transitions out of completed
    };

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getTournamentWithRounds(id) {
        var tournament = Core.getTournament(id);
        if (!tournament) return null;
        if (!Array.isArray(tournament.rounds)) return null;
        return tournament;
    }

    function getRound(tournament, roundIndex) {
        if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return null;
        var round = tournament.rounds[roundIndex];
        if (!round || typeof round !== 'object') return null;
        if (!Array.isArray(round.matches)) return null;
        return round;
    }

    function getMutableRound(tournament, roundIndex) {
        var round = getRound(tournament, roundIndex);
        if (!round) return null;
        if (round.status === 'completed') return null;
        return round;
    }

    function getMatch(round, matchIndex) {
        if (matchIndex < 0 || matchIndex >= round.matches.length) return null;
        var match = round.matches[matchIndex];
        if (!match || typeof match !== 'object') return null;
        return match;
    }

    function validateParticipant(tournament, participantId, expectedType) {
        var id = normaliseId(participantId);
        if (id === null) return false;

        var isInTournament = Array.isArray(tournament.participants) &&
            tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });

        if (!isInTournament) return false;

        var isEliminated = Array.isArray(tournament.eliminations) &&
            tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });

        if (isEliminated) return false;

        if (expectedType) {
            var participantRecord = tournament.participants.find(function(p) {
                return p && normaliseId(p.id) === id;
            });
            if (participantRecord && participantRecord.type !== expectedType) return false;
        }

        return true;
    }

    function validateMatchParticipants(tournament, participantIds, expectedType) {
        if (!Array.isArray(participantIds) || participantIds.length < 2) return false;

        var seen = Object.create(null);
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) return false;
            if (seen[id]) return false;
            seen[id] = true;
            if (!validateParticipant(tournament, id, expectedType)) return false;
        }

        return true;
    }

    function validateResultParticipants(participants, results) {
        if (!results || typeof results !== 'object') return true;

        // Normalise participants for safe comparison
        var participantIds = participants.map(function(id) {
            return normaliseId(id);
        }).filter(function(id) { return id !== null; });

        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var id = normaliseId(keys[i]);
            if (id === null) return false;
            if (participantIds.indexOf(id) === -1) {
                return false;
            }
        }
        return true;
    }

    function deriveLoser(participants, winner) {
        if (!Array.isArray(participants) || participants.length !== 2) return null;
        if (!winner) return null;
        var winnerId = normaliseId(winner);
        if (winnerId === null) return null;
        
        // Verify winner is in participants
        if (!participants.some(function(id) {
            return normaliseId(id) === winnerId;
        })) {
            return null;
        }
        
        var loser = participants.find(function(id) {
            return normaliseId(id) !== winnerId;
        });
        return loser || null;
    }

    /**
     * Canonical advancing derivation function.
     * This is the SINGLE SOURCE OF TRUTH for advancing.
     * 
     * Standard matches: winner advances (if winner exists)
     * Group exam matches: participants with 'pass' advance
     * 
     * NOTE: For pending group exams, advancing represents "passed so far".
     * The match does not need to be completed for advancing to be derived.
     * This is intentional: it allows progressive result entry.
     * 
     * @param {object} match - Match object with participants, type, winner, results
     * @returns {array} Array of advancing participant IDs
     */
    function deriveAdvancing(match) {
        // Standard match: winner advances
        if (match.type === 'standard') {
            if (match.winner) {
                return [match.winner];
            }
            return [];
        }

        // Group exam: participants with 'pass' advance
        if (match.type === 'group_exam') {
            var advancing = [];
            var participants = Array.isArray(match.participants) ? match.participants : [];
            
            // Iterate over participants, not results keys
            for (var i = 0; i < participants.length; i++) {
                var id = participants[i];
                var normalised = normaliseId(id);
                if (normalised === null) continue;
                if (match.results && match.results[normalised] === 'pass') {
                    advancing.push(normalised);
                }
            }
            return advancing;
        }

        return [];
    }

    function normaliseIdArrayStrict(ids) {
        if (!Array.isArray(ids)) return null;
        var result = [];
        var seen = Object.create(null);
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised === null) return null;
            if (seen[normalised]) return null; // Reject duplicates
            seen[normalised] = true;
            result.push(normalised);
        }
        return result;
    }

    function normaliseResultsStrict(results) {
        if (!isObject(results)) return null;
        var normalised = Object.create(null);
        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) return null;
            var value = results[key];
            if (!isValidGroupExamResult(value)) return null;
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

    /**
     * Check if a status transition is allowed.
     * Only 'pending' and 'in_progress' can transition between each other.
     * 'completed' is terminal and can only be set by completeMatch().
     */
    function isStatusTransitionAllowed(currentStatus, newStatus) {
        if (currentStatus === newStatus) return true;
        if (newStatus === 'completed') return false; // Only completeMatch() can set completed
        var allowed = STATUS_TRANSITIONS[currentStatus];
        if (!allowed) return false;
        return allowed.indexOf(newStatus) !== -1;
    }

    /**
     * Check if a type change is allowed for the given match state.
     * Type changes are only allowed for pending matches with no winner/results.
     */
    function isTypeChangeAllowed(base) {
        if (!base) return false;
        if (TYPE_CHANGE_ALLOWED_STATUSES.indexOf(base.status) === -1) {
            return false;
        }
        if (base.winner) return false;
        if (base.results && Object.keys(base.results).length > 0) {
            return false;
        }
        return true;
    }

    /**
     * Build a complete proposed match state.
     * This is the SINGLE canonical match construction function.
     * Used by ALL match creation/update/completion operations.
     * 
     * Ensures:
     *   - winner determines loser for standard 2-person matches
     *   - winner determines advancing for standard matches
     *   - group exams have no winner/loser
     *   - participant changes cannot leave a stale winner
     *   - result participants must be in the match
     *   - results only valid for group_exam matches
     *   - type changes only allowed for pending matches with no results
     *   - Invalid explicit winner on group_exam is REJECTED (not silently nulled)
     *   - status 'completed' cannot be set via update (only completeMatch)
     *   - legal status transitions enforced
     */
    function buildProposedMatch(base, updates, tournament, round) {
        // ---- Reject unknown update keys ----
        if (!hasOnlyAllowedKeys(updates, ALLOWED_UPDATE_KEYS)) {
            return null;
        }

        // ---- Normalise updates (reject invalid) ----
        var normalisedUpdates = {};

        if (updates.participants !== undefined) {
            var participants = normaliseIdArrayStrict(updates.participants);
            if (participants === null) return null;
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
            // Type must be valid
            if (!isValidMatchType(proposedType)) return null;
        }

        normalisedUpdates.type = proposedType;

        // ---- Status validation ----
        var currentStatus = base.status || 'pending';
        var newStatus = updates.status !== undefined ? updates.status : currentStatus;

        // Only completeMatch() can set 'completed'
        if (newStatus === 'completed' && currentStatus !== 'completed') {
            return null;
        }

        // Validate status transition (excluding completed which is handled above)
        if (updates.status !== undefined && updates.status !== currentStatus) {
            if (!isStatusTransitionAllowed(currentStatus, updates.status)) {
                return null;
            }
        }

        if (updates.status !== undefined) {
            if (!isValidMatchStatus(updates.status)) return null;
            normalisedUpdates.status = updates.status;
        }

        // ---- Results validation: only valid for group_exam ----
        if (updates.results !== undefined && proposedType !== 'group_exam') {
            return null;
        }

        if (updates.winner !== undefined) {
            if (updates.winner === null) {
                normalisedUpdates.winner = null;
            } else {
                var winner = normaliseId(updates.winner);
                if (winner === null) return null;
                normalisedUpdates.winner = winner;
            }
        }

        if (updates.results !== undefined) {
            if (updates.results === null || updates.results === undefined) {
                normalisedUpdates.results = {};
            } else {
                var results = normaliseResultsStrict(updates.results);
                if (results === null) return null;
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
            loser: null, // Will be derived if needed
            advancing: [], // Will be derived if needed
            results: normalisedUpdates.results !== undefined
                ? normalisedUpdates.results
                : (base.results ? Object.assign({}, base.results) : {})
        };

        // ---- Enforce match size ----
        var matchSize = round.matchSize || 2;
        if (proposed.participants.length !== matchSize) return null;

        // ---- Group exam: reject explicit winner (don't silently null it) ----
        if (proposed.type === 'group_exam') {
            // If the caller explicitly supplied a winner (not just inherited from base)
            if (normalisedUpdates.winner !== undefined && normalisedUpdates.winner !== null) {
                return null;
            }
            // Also check if base had a winner (shouldn't happen for group_exam, but defend)
            if (base.winner !== undefined && base.winner !== null && !updates.winner) {
                return null;
            }
            proposed.winner = null;
            proposed.loser = null;
        }

        // ---- Validate winner is still valid after participant changes ----
        if (proposed.winner !== null) {
            // Check winner is still in participants
            if (proposed.participants.indexOf(proposed.winner) === -1) {
                // Winner is no longer a participant - reject
                return null;
            }
            // Validate winner is an active tournament participant
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
     * Returns { valid: boolean, errors: array }
     */
    function validateProposedMatch(proposed, tournament, round, matchIndex) {
        var errors = [];

        // ---- MUTATION-SPECIFIC VALIDATION ----
        // Cannot modify a match in a completed round
        if (round.status === 'completed') {
            errors.push('Cannot modify matches in a completed round.');
            return { valid: false, errors: errors };
        }

        // Cannot modify a completed match
        if (matchIndex >= 0) {
            var existingMatch = getMatch(round, matchIndex);
            if (existingMatch && existingMatch.status === 'completed') {
                errors.push('Cannot modify a completed match.');
                return { valid: false, errors: errors };
            }
        }

        // ---- DELEGATE STRUCTURAL VALIDATION TO SCHEMA ----
        var schemaResult = Schema.validateMatch(proposed, tournament, true, round);
        if (!schemaResult.valid) {
            schemaResult.errors.forEach(function(err) {
                errors.push(err);
            });
        }

        return { valid: errors.length === 0, errors: errors };
    }

    function cloneMatch(match) {
        if (!match) return null;
        return JSON.parse(JSON.stringify(match));
    }

    function cloneMatchesArray(matches) {
        if (!Array.isArray(matches)) return [];
        return matches.map(cloneMatch);
    }

    function cloneRound(round) {
        if (!round || typeof round !== 'object') return round;
        var copy = Object.assign({}, round);
        if (Array.isArray(round.matches)) {
            copy.matches = round.matches.map(cloneMatch);
        }
        return copy;
    }

    /**
     * Apply the complete proposed state to a match.
     * Used by ALL mutation operations.
     */
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

    /**
     * Build a complete proposed tournament state for a match mutation.
     * Used for all match mutations to ensure atomicity at the tournament level.
     */
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
            if (!isObject(matchData)) return null;

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

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
            if (proposedMatch === null) return null;

            var validation = validateProposedMatch(proposedMatch, tournament, round, -1);
            if (!validation.valid) return null;

            // ---- BUILD PROPOSED TOURNAMENT STATE ----
            var proposedRound = cloneRound(round);
            proposedRound.matches.push(proposedMatch);

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return null;

            // ---- APPLY ----
            round.matches.push(proposedMatch);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added match to round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

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
            if (!tournament) return false;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return false;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return false;

            var match = getMatch(round, matchIndex);
            if (!match) return false;

            if (match.status === 'completed') return false;

            // ---- BUILD PROPOSED STATE ----
            var proposedMatches = round.matches
                .map(cloneMatch)
                .filter(function(_, idx) {
                    return idx !== matchIndex;
                });

            var proposedRound = cloneRound(round);
            proposedRound.matches = proposedMatches;

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return false;

            // ---- APPLY ----
            round.matches = proposedMatches;

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed match from round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Update a match.
         * Uses build-validate-apply pipeline with tournament-level validation.
         * 
         * NOTE: Cannot change status to 'completed'. Use completeMatch() for that.
         * NOTE: Results cannot be set on standard matches.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match to update
         * @param {object} updates - Updates to apply
         * @returns {object|null} Defensive copy of the updated match
         */
        updateMatch: function(tournamentId, roundIndex, matchIndex, updates) {
            if (!isObject(updates)) return null;

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.status === 'completed') return null;

            // ---- BUILD PROPOSED MATCH ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) return null;

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) return null;

            // ---- BUILD PROPOSED TOURNAMENT STATE ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return null;

            // ---- APPLY ----
            applyProposedMatch(match, proposedMatch);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Updated match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

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
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.status === 'completed') return null;

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            var updates = { status: 'completed' };

            if (match.type === 'standard') {
                if (winnerId === undefined || winnerId === null) {
                    return null;
                }
                var winnerNormalised = normaliseId(winnerId);
                if (winnerNormalised === null) return null;
                if (match.participants.indexOf(winnerNormalised) === -1) return null;
                
                // Validate winner is an active tournament participant
                if (!validateParticipant(tournament, winnerNormalised, expectedType)) {
                    return null;
                }
                
                updates.winner = winnerNormalised;
            }

            if (match.type === 'group_exam') {
                if (!results || !isObject(results) || Object.keys(results).length === 0) return null;
                var normalisedResults = normaliseResultsStrict(results);
                if (normalisedResults === null) return null;
                // All participants must have results
                for (var i = 0; i < match.participants.length; i++) {
                    if (!normalisedResults[match.participants[i]]) return null;
                }
                // Validate result participants belong to the match
                if (!validateResultParticipants(match.participants, normalisedResults)) {
                    return null;
                }
                updates.results = normalisedResults;
            }

            // ---- BUILD PROPOSED MATCH ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) return null;

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) return null;

            // ---- BUILD PROPOSED TOURNAMENT STATE ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return null;

            // ---- APPLY ----
            applyProposedMatch(match, proposedMatch);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Completed match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

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
            if (participantNormalised === null) return null;

            if (!result) return null;
            if (result !== 'pass' && result !== 'fail') return null;

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.type !== 'group_exam') return null;
            if (match.status === 'completed') return null;

            if (match.participants.indexOf(participantNormalised) === -1) return null;

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, participantNormalised, expectedType)) return null;

            var updates = {
                results: Object.assign({}, match.results || {})
            };
            updates.results[participantNormalised] = result;

            // ---- BUILD PROPOSED MATCH ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) return null;

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) return null;

            // ---- BUILD PROPOSED TOURNAMENT STATE ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return null;

            // ---- APPLY ----
            applyProposedMatch(match, proposedMatch);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set group exam result for participant in tournament: ' + tournament.name);
            }

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
            if (winnerNormalised === null) return null;

            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            // Validate existing tournament structure
            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.type === 'group_exam') return null;
            if (match.status === 'completed') return null;

            if (match.participants.indexOf(winnerNormalised) === -1) return null;

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, winnerNormalised, expectedType)) return null;

            var updates = { winner: winnerNormalised };

            // ---- BUILD PROPOSED MATCH ----
            var proposedMatch = buildProposedMatch(match, updates, tournament, round);
            if (proposedMatch === null) return null;

            var validation = validateProposedMatch(proposedMatch, tournament, round, matchIndex);
            if (!validation.valid) return null;

            // ---- BUILD PROPOSED TOURNAMENT STATE ----
            var proposedRound = cloneRound(round);
            proposedRound.matches = round.matches.map(function(m, idx) {
                if (idx === matchIndex) {
                    return proposedMatch;
                }
                return cloneMatch(m);
            });

            var proposedTournament = buildProposedTournament(tournament, roundIndex, proposedRound);

            // ---- VALIDATE PROPOSED TOURNAMENT ----
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: true });
            if (!tournValidation.valid) return null;

            // ---- APPLY ----
            applyProposedMatch(match, proposedMatch);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set match winner in tournament: ' + tournament.name);
            }

            return cloneMatch(match);
        },

        // ============================================================
        // READ OPERATIONS - Defensive copies
        // ============================================================

        getRoundMatches: function(tournamentId, roundIndex) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return [];

            var round = getRound(tournament, roundIndex);
            if (!round) return [];

            return cloneMatchesArray(round.matches);
        },

        getMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getTournamentWithRounds(tournamentId);
            if (!tournament) return null;

            var round = getRound(tournament, roundIndex);
            if (!round) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            return cloneMatch(match);
        },

        isMatchComplete: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return false;
            return match.status === 'completed';
        },

        getMatchWinner: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return null;
            return match.winner || null;
        },

        getMatchLosers: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return [];
            if (match.loser) return [match.loser];
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
            if (!match) return [];
            return deriveAdvancing(match);
        },

        // ============================================================
        // VALIDATION HELPERS
        // ============================================================

        /**
         * Validate a match object against the schema.
         * Returns { valid: boolean, errors: array }
         */
        validateMatch: function(match, tournament, strict, round) {
            return Schema.validateMatch(match, tournament, strict, round);
        },

        /**
         * Get the week range for validation.
         * Returns { min: number, max: number }
         */
        getWeekRange: function() {
            return { min: MIN_WEEK, max: MAX_WEEK };
        },

        /**
         * Derive advancing from a match state.
         * This is the canonical derivation function.
         */
        deriveAdvancing: deriveAdvancing,

        /**
         * Check if a type change is allowed for a match.
         */
        isTypeChangeAllowed: isTypeChangeAllowed,

        /**
         * Validate that result participants belong to the match.
         * Normalises IDs for safe comparison.
         */
        validateResultParticipants: validateResultParticipants
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsMatches = TournamentsMatches;

    // Delegate to Core for backward compatibility
    if (window.TournamentsCore) {
        window.TournamentsCore.addMatch = TournamentsMatches.addMatch;
        window.TournamentsCore.removeMatch = TournamentsMatches.removeMatch;
        window.TournamentsCore.updateMatch = TournamentsMatches.updateMatch;
        window.TournamentsCore.completeMatch = TournamentsMatches.completeMatch;
        window.TournamentsCore.setGroupExamResult = TournamentsMatches.setGroupExamResult;
        window.TournamentsCore.setMatchWinner = TournamentsMatches.setMatchWinner;
        window.TournamentsCore.getRoundMatches = TournamentsMatches.getRoundMatches;
        window.TournamentsCore.getMatch = TournamentsMatches.getMatch;
        window.TournamentsCore.isMatchComplete = TournamentsMatches.isMatchComplete;
        window.TournamentsCore.getMatchWinner = TournamentsMatches.getMatchWinner;
        window.TournamentsCore.getMatchLosers = TournamentsMatches.getMatchLosers;
        window.TournamentsCore.getMatchAdvancing = TournamentsMatches.getMatchAdvancing;
    }

})();
