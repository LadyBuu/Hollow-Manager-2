/**
 * js/modules/tournaments/tournaments-matches.js - Tournament Match Operations
 * CANONICAL match mutation API for tournaments.
 * 
 * MATCH PHILOSOPHY:
 *   - All match mutations go through this API
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Caller is responsible for persistence (saveData)
 *   - Match history is preserved (no silent deletion of historical data)
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - Callers own persistence
 * 
 * DEPENDENCIES:
 *   - TournamentsCore for tournament lookup and validation helpers
 */

(function() {
    'use strict';

    if (window.__tournamentsMatchesLoaded) return;
    window.__tournamentsMatchesLoaded = true;

    if (!window.TournamentsCore) {
        console.error('TournamentsMatches: TournamentsCore required.');
        return;
    }

    var Core = window.TournamentsCore;

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function normaliseId(id) {
        return id !== undefined && id !== null ? String(id) : null;
    }

    function isValidMatchType(type) {
        return type === 'standard' || type === 'group_exam';
    }

    function isValidMatchStatus(status) {
        return status === 'pending' || status === 'in_progress' || status === 'completed';
    }

    function isValidParticipantType(type) {
        return type === 'character' || type === 'team';
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        if (!Array.isArray(window.data.tournaments)) return null;
        return window.data;
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /**
     * Get a tournament with validation.
     */
    function getValidTournament(id) {
        var tournament = Core.getTournament(id);
        if (!tournament) {
            console.warn('TournamentsMatches: Tournament not found.');
            return null;
        }
        if (!Array.isArray(tournament.rounds)) {
            console.warn('TournamentsMatches: Malformed rounds data.');
            return null;
        }
        return tournament;
    }

    /**
     * Get a round with validation.
     */
    function getValidRound(tournament, roundIndex) {
        if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
            console.warn('TournamentsMatches: Invalid round index.');
            return null;
        }
        var round = tournament.rounds[roundIndex];
        if (!round || typeof round !== 'object') {
            console.warn('TournamentsMatches: Malformed round data.');
            return null;
        }
        if (!Array.isArray(round.matches)) {
            console.warn('TournamentsMatches: Malformed matches data.');
            return null;
        }
        return round;
    }

    /**
     * Get a match with validation.
     */
    function getValidMatch(round, matchIndex) {
        if (matchIndex < 0 || matchIndex >= round.matches.length) {
            console.warn('TournamentsMatches: Invalid match index.');
            return null;
        }
        var match = round.matches[matchIndex];
        if (!match || typeof match !== 'object') {
            console.warn('TournamentsMatches: Malformed match data.');
            return null;
        }
        return match;
    }

    /**
     * Validate that a participant exists and is in the tournament.
     */
    function validateParticipant(tournament, participantId, expectedType) {
        var id = normaliseId(participantId);
        if (id === null) {
            console.warn('TournamentsMatches: Invalid participant ID.');
            return false;
        }

        // Check if participant is in the tournament
        var isInTournament = Array.isArray(tournament.participants) &&
            tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });

        if (!isInTournament) {
            console.warn('TournamentsMatches: Participant not in tournament.');
            return false;
        }

        // Check if participant is eliminated
        var isEliminated = Array.isArray(tournament.eliminations) &&
            tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });

        if (isEliminated) {
            console.warn('TournamentsMatches: Participant is eliminated.');
            return false;
        }

        // If expected type provided, verify it
        if (expectedType) {
            var participantRecord = tournament.participants.find(function(p) {
                return p && normaliseId(p.id) === id;
            });
            if (participantRecord && participantRecord.type !== expectedType) {
                console.warn('TournamentsMatches: Participant type mismatch. Expected: ' + expectedType + ', got: ' + participantRecord.type);
                return false;
            }
        }

        return true;
    }

    /**
     * Validate that all participants in a match are valid.
     */
    function validateMatchParticipants(tournament, participantIds, expectedType) {
        if (!Array.isArray(participantIds) || participantIds.length < 2) {
            console.warn('TournamentsMatches: Match must have at least 2 participants.');
            return false;
        }

        var seen = {};
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) {
                console.warn('TournamentsMatches: Invalid participant ID at index ' + i);
                return false;
            }

            // Check for duplicates
            if (seen[id]) {
                console.warn('TournamentsMatches: Duplicate participant: ' + id);
                return false;
            }
            seen[id] = true;

            if (!validateParticipant(tournament, id, expectedType)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get the participant type for an ID from tournament data.
     */
    function getParticipantTypeFromTournament(tournament, id) {
        var normalised = normaliseId(id);
        if (normalised === null) return null;
        var record = Array.isArray(tournament.participants) ?
            tournament.participants.find(function(p) {
                return p && normaliseId(p.id) === normalised;
            }) : null;
        return record ? record.type : null;
    }

    // ============================================================
    // MATCH API
    // ============================================================

    var TournamentsMatches = {
        /**
         * Add a match to a round.
         * Atomic: validates all inputs before mutating.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {object} matchData - Match data
         * @param {array} matchData.participants - Array of participant IDs
         * @param {string} [matchData.type] - 'standard' or 'group_exam' (default: 'standard')
         * @param {string} [matchData.status] - 'pending', 'in_progress', 'completed' (default: 'pending')
         * @returns {object|null} The new match object, or null on failure
         */
        addMatch: function(tournamentId, roundIndex, matchData) {
            if (!isObject(matchData)) {
                console.warn('TournamentsMatches.addMatch: matchData must be an object.');
                return null;
            }

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            // Check if round is completed
            if (round.status === 'completed') {
                console.warn('TournamentsMatches.addMatch: Cannot add match to completed round.');
                return null;
            }

            // Validate match type
            var type = matchData.type || 'standard';
            if (!isValidMatchType(type)) {
                console.warn('TournamentsMatches.addMatch: Invalid match type. Must be "standard" or "group_exam".');
                return null;
            }

            // Validate match size against round matchSize
            var participants = Array.isArray(matchData.participants) ? matchData.participants : [];
            var matchSize = round.matchSize || 2;
            if (participants.length !== matchSize) {
                console.warn('TournamentsMatches.addMatch: Match size mismatch. Expected: ' + matchSize + ', got: ' + participants.length);
                return null;
            }

            // Determine expected participant type from tournament mode
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';

            // Validate participants
            if (!validateMatchParticipants(tournament, participants, expectedType)) {
                return null;
            }

            // Validate status
            var status = matchData.status || 'pending';
            if (!isValidMatchStatus(status)) {
                console.warn('TournamentsMatches.addMatch: Invalid status. Must be "pending", "in_progress", or "completed".');
                return null;
            }

            // Build match object
            var match = {
                participants: participants.map(normaliseId),
                type: type,
                status: status,
                winner: null,
                loser: null,
                advancing: [],
                results: {}
            };

            // If match is standard and has 2 participants, we can set winner/loser later
            // If match is group_exam, results will be set separately

            round.matches.push(match);

            // If status is completed, check if round should be completed
            if (status === 'completed') {
                // We don't auto-complete the round - that's a separate operation
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added match to round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return match;
        },

        /**
         * Remove a match from a round.
         * Atomic: validates before mutating.
         * Preserves historical data - match is removed but not hidden.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {boolean} Whether the operation succeeded
         */
        removeMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return false;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return false;

            // Check if round is completed
            if (round.status === 'completed') {
                console.warn('TournamentsMatches.removeMatch: Cannot remove match from completed round.');
                return false;
            }

            var match = getValidMatch(round, matchIndex);
            if (!match) return false;

            // Check if match is completed
            if (match.status === 'completed') {
                console.warn('TournamentsMatches.removeMatch: Cannot remove completed match.');
                return false;
            }

            // Remove the match
            round.matches.splice(matchIndex, 1);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed match from round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Update a match.
         * Atomic: validates all inputs before mutating.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @param {object} updates - Updates to apply
         * @param {array} [updates.participants] - New participant IDs
         * @param {string} [updates.type] - 'standard' or 'group_exam'
         * @param {string} [updates.status] - 'pending', 'in_progress', 'completed'
         * @param {string} [updates.winner] - Winner participant ID
         * @param {string} [updates.loser] - Loser participant ID (standard matches only)
         * @param {array} [updates.advancing] - Advancing participant IDs
         * @param {object} [updates.results] - Results for group_exam matches
         * @returns {object|null} The updated match, or null on failure
         */
        updateMatch: function(tournamentId, roundIndex, matchIndex, updates) {
            if (!isObject(updates)) {
                console.warn('TournamentsMatches.updateMatch: updates must be an object.');
                return null;
            }

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            // Check if round is completed
            if (round.status === 'completed') {
                console.warn('TournamentsMatches.updateMatch: Cannot update match in completed round.');
                return null;
            }

            var match = getValidMatch(round, matchIndex);
            if (!match) return null;

            // Determine expected participant type from tournament mode
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';

            // Build proposed state
            var proposed = {
                participants: updates.participants !== undefined ? updates.participants : match.participants.slice(),
                type: updates.type !== undefined ? updates.type : match.type,
                status: updates.status !== undefined ? updates.status : match.status,
                winner: updates.winner !== undefined ? updates.winner : match.winner,
                loser: updates.loser !== undefined ? updates.loser : match.loser,
                advancing: updates.advancing !== undefined ? updates.advancing : (match.advancing ? match.advancing.slice() : []),
                results: updates.results !== undefined ? updates.results : (match.results ? Object.assign({}, match.results) : {})
            };

            // Validate type
            if (!isValidMatchType(proposed.type)) {
                console.warn('TournamentsMatches.updateMatch: Invalid match type.');
                return null;
            }

            // Validate status
            if (!isValidMatchStatus(proposed.status)) {
                console.warn('TournamentsMatches.updateMatch: Invalid match status.');
                return null;
            }

            // If participants are changing, validate them
            if (updates.participants !== undefined) {
                var matchSize = round.matchSize || 2;
                if (proposed.participants.length !== matchSize) {
                    console.warn('TournamentsMatches.updateMatch: Match size mismatch. Expected: ' + matchSize + ', got: ' + proposed.participants.length);
                    return null;
                }
                if (!validateMatchParticipants(tournament, proposed.participants, expectedType)) {
                    return null;
                }
            }

            // Validate winner
            if (proposed.winner !== null) {
                var winnerId = normaliseId(proposed.winner);
                if (winnerId === null) {
                    console.warn('TournamentsMatches.updateMatch: Invalid winner ID.');
                    return null;
                }
                // Winner must be in participants
                if (proposed.participants.indexOf(winnerId) === -1) {
                    console.warn('TournamentsMatches.updateMatch: Winner must be a participant in the match.');
                    return null;
                }
                if (!validateParticipant(tournament, winnerId, expectedType)) {
                    return null;
                }
                proposed.winner = winnerId;
            }

            // Validate loser (standard matches only)
            if (proposed.loser !== null && proposed.type === 'standard') {
                var loserId = normaliseId(proposed.loser);
                if (loserId === null) {
                    console.warn('TournamentsMatches.updateMatch: Invalid loser ID.');
                    return null;
                }
                if (proposed.participants.indexOf(loserId) === -1) {
                    console.warn('TournamentsMatches.updateMatch: Loser must be a participant in the match.');
                    return null;
                }
                if (!validateParticipant(tournament, loserId, expectedType)) {
                    return null;
                }
                // Loser cannot be winner
                if (proposed.winner && loserId === proposed.winner) {
                    console.warn('TournamentsMatches.updateMatch: Loser cannot be the same as winner.');
                    return null;
                }
                proposed.loser = loserId;
            }

            // Validate advancing
            if (Array.isArray(proposed.advancing)) {
                var validAdvancing = [];
                for (var i = 0; i < proposed.advancing.length; i++) {
                    var advId = normaliseId(proposed.advancing[i]);
                    if (advId === null) continue;
                    if (proposed.participants.indexOf(advId) === -1) {
                        console.warn('TournamentsMatches.updateMatch: Advancing participant must be in the match.');
                        return null;
                    }
                    if (!validateParticipant(tournament, advId, expectedType)) {
                        return null;
                    }
                    validAdvancing.push(advId);
                }
                proposed.advancing = validAdvancing;
            }

            // Validate results (group_exam only)
            if (proposed.type === 'group_exam' && updates.results !== undefined) {
                if (!isObject(proposed.results)) {
                    console.warn('TournamentsMatches.updateMatch: Results must be an object.');
                    return null;
                }
                var validResults = {};
                Object.keys(proposed.results).forEach(function(key) {
                    var id = normaliseId(key);
                    if (id === null) return;
                    var value = proposed.results[key];
                    if (value !== 'pass' && value !== 'fail') {
                        console.warn('TournamentsMatches.updateMatch: Result must be "pass" or "fail".');
                        return;
                    }
                    if (proposed.participants.indexOf(id) === -1) {
                        console.warn('TournamentsMatches.updateMatch: Result participant must be in the match.');
                        return;
                    }
                    validResults[id] = value;
                });
                proposed.results = validResults;
            }

            // Apply updates
            var changed = false;
            var keys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
            keys.forEach(function(key) {
                if (updates[key] !== undefined) {
                    var oldValue = match[key];
                    var newValue = proposed[key];
                    // Compare (handle arrays and objects)
                    var changedValue;
                    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
                        changedValue = oldValue.length !== newValue.length ||
                            oldValue.some(function(v, idx) { return newValue[idx] !== v; });
                    } else if (typeof oldValue === 'object' && typeof newValue === 'object' && oldValue !== null && newValue !== null) {
                        changedValue = JSON.stringify(oldValue) !== JSON.stringify(newValue);
                    } else {
                        changedValue = oldValue !== newValue;
                    }
                    if (changedValue) {
                        match[key] = newValue;
                        changed = true;
                    }
                }
            });

            // If status changed to completed, ensure winner is set for standard matches
            if (match.status === 'completed' && match.type === 'standard' && !match.winner) {
                console.warn('TournamentsMatches.updateMatch: Completed standard match must have a winner.');
                // Roll back status change
                if (updates.status !== undefined) {
                    match.status = updates.status !== undefined ? match.status : 'pending';
                }
                return null;
            }

            if (changed && typeof window.logActivity === 'function') {
                window.logActivity('Updated match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return match;
        },

        /**
         * Complete a match.
         * Convenience function that sets status to 'completed' and validates winner.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @param {string} winnerId - Winner participant ID
         * @returns {object|null} The completed match, or null on failure
         */
        completeMatch: function(tournamentId, roundIndex, matchIndex, winnerId) {
            if (!winnerId) {
                console.warn('TournamentsMatches.completeMatch: Winner ID required.');
                return null;
            }

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            if (round.status === 'completed') {
                console.warn('TournamentsMatches.completeMatch: Cannot complete match in completed round.');
                return null;
            }

            var match = getValidMatch(round, matchIndex);
            if (!match) return null;

            if (match.status === 'completed') {
                console.warn('TournamentsMatches.completeMatch: Match already completed.');
                return null;
            }

            var winnerIdNormalised = normaliseId(winnerId);
            if (winnerIdNormalised === null) {
                console.warn('TournamentsMatches.completeMatch: Invalid winner ID.');
                return null;
            }

            // Winner must be in participants
            if (match.participants.indexOf(winnerIdNormalised) === -1) {
                console.warn('TournamentsMatches.completeMatch: Winner must be a participant in the match.');
                return null;
            }

            // Determine expected participant type
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, winnerIdNormalised, expectedType)) {
                return null;
            }

            // Update match
            match.status = 'completed';
            match.winner = winnerIdNormalised;

            // For standard matches, set loser
            if (match.type === 'standard' && match.participants.length === 2) {
                var loserId = match.participants.find(function(id) {
                    return id !== winnerIdNormalised;
                });
                if (loserId) {
                    match.loser = loserId;
                }
            }

            // For group_exam, ensure all participants have results
            if (match.type === 'group_exam') {
                // Results should have been set via updateMatch
                // If not, set default 'fail' for all without results
                match.participants.forEach(function(id) {
                    if (!match.results || match.results[id] === undefined) {
                        if (!match.results) match.results = {};
                        match.results[id] = (id === winnerIdNormalised) ? 'pass' : 'fail';
                    }
                });
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Completed match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return match;
        },

        /**
         * Set a group exam result for a participant.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @param {string} participantId - Participant ID
         * @param {string} result - 'pass' or 'fail'
         * @returns {object|null} The updated match, or null on failure
         */
        setGroupExamResult: function(tournamentId, roundIndex, matchIndex, participantId, result) {
            if (!participantId || !result) {
                console.warn('TournamentsMatches.setGroupExamResult: Participant ID and result required.');
                return null;
            }

            if (result !== 'pass' && result !== 'fail') {
                console.warn('TournamentsMatches.setGroupExamResult: Result must be "pass" or "fail".');
                return null;
            }

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            if (round.status === 'completed') {
                console.warn('TournamentsMatches.setGroupExamResult: Cannot modify completed round.');
                return null;
            }

            var match = getValidMatch(round, matchIndex);
            if (!match) return null;

            if (match.type !== 'group_exam') {
                console.warn('TournamentsMatches.setGroupExamResult: Match is not a group exam.');
                return null;
            }

            if (match.status === 'completed') {
                console.warn('TournamentsMatches.setGroupExamResult: Cannot modify completed match.');
                return null;
            }

            var participantIdNormalised = normaliseId(participantId);
            if (participantIdNormalised === null) {
                console.warn('TournamentsMatches.setGroupExamResult: Invalid participant ID.');
                return null;
            }

            if (match.participants.indexOf(participantIdNormalised) === -1) {
                console.warn('TournamentsMatches.setGroupExamResult: Participant not in match.');
                return null;
            }

            if (!validateParticipant(tournament, participantIdNormalised)) {
                return null;
            }

            if (!match.results) match.results = {};
            match.results[participantIdNormalised] = result;

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set group exam result for participant in tournament: ' + tournament.name);
            }

            return match;
        },

        /**
         * Set match winner (standard matches only).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @param {string} winnerId - Winner participant ID
         * @returns {object|null} The updated match, or null on failure
         */
        setMatchWinner: function(tournamentId, roundIndex, matchIndex, winnerId) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            if (round.status === 'completed') {
                console.warn('TournamentsMatches.setMatchWinner: Cannot modify completed round.');
                return null;
            }

            var match = getValidMatch(round, matchIndex);
            if (!match) return null;

            if (match.type === 'group_exam') {
                console.warn('TournamentsMatches.setMatchWinner: Use setGroupExamResult for group exams.');
                return null;
            }

            if (match.status === 'completed') {
                console.warn('TournamentsMatches.setMatchWinner: Cannot modify completed match.');
                return null;
            }

            var winnerIdNormalised = normaliseId(winnerId);
            if (winnerIdNormalised === null) {
                console.warn('TournamentsMatches.setMatchWinner: Invalid winner ID.');
                return null;
            }

            if (match.participants.indexOf(winnerIdNormalised) === -1) {
                console.warn('TournamentsMatches.setMatchWinner: Winner must be a participant in the match.');
                return null;
            }

            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (!validateParticipant(tournament, winnerIdNormalised, expectedType)) {
                return null;
            }

            match.winner = winnerIdNormalised;

            // Set loser if standard and has 2 participants
            if (match.type === 'standard' && match.participants.length === 2) {
                var loserId = match.participants.find(function(id) {
                    return id !== winnerIdNormalised;
                });
                if (loserId) {
                    match.loser = loserId;
                }
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set match winner in tournament: ' + tournament.name);
            }

            return match;
        },

        /**
         * Get all matches in a round.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @returns {array} Array of matches (live references)
         */
        getRoundMatches: function(tournamentId, roundIndex) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return [];

            var round = getValidRound(tournament, roundIndex);
            if (!round) return [];

            return round.matches.slice();
        },

        /**
         * Get a match by ID (if matches have IDs).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {object|null} The match, or null if not found
         */
        getMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getValidRound(tournament, roundIndex);
            if (!round) return null;

            return getValidMatch(round, matchIndex);
        },

        /**
         * Check if a match is complete.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {boolean} Whether the match is complete
         */
        isMatchComplete: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return false;
            return match.status === 'completed';
        },

        /**
         * Get match winner.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {string|null} Winner ID, or null if none
         */
        getMatchWinner: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return null;
            return match.winner || null;
        },

        /**
         * Get match losers (standard matches only).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {array} Array of loser IDs
         */
        getMatchLosers: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return [];
            if (match.loser) return [match.loser];
            return [];
        },

        /**
         * Get participants that are advancing from a match.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Round index (0-based)
         * @param {number} matchIndex - Match index (0-based)
         * @returns {array} Array of advancing participant IDs
         */
        getMatchAdvancing: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return [];

            if (Array.isArray(match.advancing) && match.advancing.length > 0) {
                return match.advancing.slice();
            }

            // If no advancing set, winner advances (standard matches)
            if (match.type === 'standard' && match.winner) {
                return [match.winner];
            }

            // For group_exam, passing participants advance
            if (match.type === 'group_exam' && match.results) {
                var advancing = [];
                match.participants.forEach(function(id) {
                    if (match.results[id] === 'pass') {
                        advancing.push(id);
                    }
                });
                return advancing;
            }

            return [];
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsMatches = TournamentsMatches;

    // Also add to TournamentsCore for backward compatibility
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
