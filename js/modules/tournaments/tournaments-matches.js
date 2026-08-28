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
 *   - loser is DERIVED for 2-person standard matches, not independently mutable
 *   - Public mutation methods return DEFENSIVE COPIES of the mutated object
 *   - ALL mutations use the same build-validate-apply pipeline
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - Callers own persistence
 * 
 * MUTATION PATTERN (applied to ALL mutations):
 *   1. Retrieve existing data
 *   2. Validate existing structure (via Schema)
 *   3. Validate operation-specific inputs (REJECT invalid, don't filter)
 *   4. Build complete proposed state via buildProposedMatch()
 *   5. Validate proposed state
 *   6. Apply COMPLETE proposed state (all fields)
 *   7. Return a DEFENSIVE COPY of the result
 * 
 * SEMANTIC INVARIANTS ENFORCED:
 *   - Group exams: winner and loser must be null
 *   - Standard matches: if advancing is present, winner must be in advancing
 *   - Two-person standard: loser is derived from winner
 * 
 * DEPENDENCIES:
 *   - TournamentsCore for tournament lookup
 *   - TournamentsSchema for shared validation
 */

(function() {
    'use strict';

    if (window.__tournamentsMatchesLoaded) return;
    window.__tournamentsMatchesLoaded = true;

    if (!window.TournamentsCore) {
        console.error('TournamentsMatches: TournamentsCore required.');
        return;
    }

    if (!window.TournamentsSchema) {
        console.error('TournamentsMatches: TournamentsSchema required.');
        return;
    }

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
    var isValidParticipantType = Schema.isValidParticipantType;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var ALLOWED_UPDATE_KEYS = [
        'participants',
        'type',
        'status',
        'winner',
        'loser',
        'advancing',
        'results'
    ];

    var MATCH_KEYS = [
        'participants',
        'type',
        'status',
        'winner',
        'loser',
        'advancing',
        'results'
    ];

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getValidTournament(id) {
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

        var seen = {};
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) return false;
            if (seen[id]) return false;
            seen[id] = true;
            if (!validateParticipant(tournament, id, expectedType)) return false;
        }

        return true;
    }

    function deriveLoser(participants, winner) {
        if (!Array.isArray(participants) || participants.length !== 2) return null;
        if (!winner) return null;
        var winnerId = normaliseId(winner);
        if (winnerId === null) return null;
        var loser = participants.find(function(id) {
            return normaliseId(id) !== winnerId;
        });
        return loser || null;
    }

    function normaliseReject(id) {
        var normalised = normaliseId(id);
        if (normalised === null) return null;
        return normalised;
    }

    function normaliseIdArrayStrict(ids) {
        if (!Array.isArray(ids)) return null;
        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseReject(ids[i]);
            if (normalised === null) return null;
            result.push(normalised);
        }
        return result;
    }

    function normaliseResultsStrict(results) {
        if (!isObject(results)) return null;
        var normalised = {};
        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseReject(key);
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
     * Build a complete proposed match state.
     * This is the SINGLE canonical match construction function.
     * Used by ALL mutation operations.
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

        if (updates.type !== undefined) {
            if (!isValidMatchType(updates.type)) return null;
            normalisedUpdates.type = updates.type;
        }

        if (updates.status !== undefined) {
            if (!isValidMatchStatus(updates.status)) return null;
            normalisedUpdates.status = updates.status;
        }

        if (updates.winner !== undefined) {
            if (updates.winner === null) {
                normalisedUpdates.winner = null;
            } else {
                var winner = normaliseReject(updates.winner);
                if (winner === null) return null;
                normalisedUpdates.winner = winner;
            }
        }

        if (updates.loser !== undefined) {
            if (updates.loser !== null) {
                return null;
            }
            normalisedUpdates.loser = null;
        }

        if (updates.advancing !== undefined) {
            if (updates.advancing === null || updates.advancing === undefined) {
                normalisedUpdates.advancing = [];
            } else {
                var advancing = normaliseIdArrayStrict(updates.advancing);
                if (advancing === null) return null;
                normalisedUpdates.advancing = advancing;
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
            type: normalisedUpdates.type !== undefined
                ? normalisedUpdates.type
                : (base.type || round.matchType || 'standard'),
            status: normalisedUpdates.status !== undefined
                ? normalisedUpdates.status
                : (base.status || 'pending'),
            winner: normalisedUpdates.winner !== undefined
                ? normalisedUpdates.winner
                : base.winner,
            loser: null,
            advancing: normalisedUpdates.advancing !== undefined
                ? normalisedUpdates.advancing
                : (base.advancing ? base.advancing.slice() : []),
            results: normalisedUpdates.results !== undefined
                ? normalisedUpdates.results
                : (base.results ? Object.assign({}, base.results) : {})
        };

        var matchSize = round.matchSize || 2;
        if (proposed.participants.length !== matchSize) return null;

        // ---- Type canonicalisation ----
        if (proposed.type === 'group_exam') {
            proposed.winner = null;
            proposed.loser = null;
        }

        // ---- Derive loser for standard 2-person matches ----
        if (proposed.type === 'standard' && proposed.participants.length === 2) {
            if (proposed.winner) {
                proposed.loser = deriveLoser(proposed.participants, proposed.winner);
            } else {
                proposed.loser = null;
            }
        }

        return proposed;
    }

    /**
     * Validate a complete proposed match state.
     * Returns { valid: boolean, errors: array }
     */
    function validateProposedMatch(proposed, tournament, round, matchIndex) {
        var errors = [];

        // ---- TYPE ----
        if (!isValidMatchType(proposed.type)) {
            errors.push('Invalid match type. Must be "standard" or "group_exam".');
        }

        if (round.matchType && round.matchType !== proposed.type) {
            errors.push('Match type "' + proposed.type + '" does not match round type "' + round.matchType + '".');
        }

        // ---- STATUS ----
        if (!isValidMatchStatus(proposed.status)) {
            errors.push('Invalid match status. Must be "pending", "in_progress", or "completed".');
        }

        // ---- PARTICIPANTS ----
        var matchSize = round.matchSize || 2;
        if (proposed.participants.length !== matchSize) {
            errors.push('Match size mismatch. Expected: ' + matchSize + ', got: ' + proposed.participants.length);
        }

        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        if (!validateMatchParticipants(tournament, proposed.participants, expectedType)) {
            errors.push('Invalid match participants.');
        }

        var seen = {};
        for (var i = 0; i < proposed.participants.length; i++) {
            var id = proposed.participants[i];
            if (seen[id]) {
                errors.push('Duplicate participant in match: "' + id + '"');
            }
            seen[id] = true;
        }

        // ---- WINNER ----
        if (proposed.type === 'group_exam' && proposed.winner !== null) {
            errors.push('Group exam matches do not have a winner field.');
        }

        if (proposed.winner !== null) {
            var winnerId = normaliseId(proposed.winner);
            if (winnerId === null) {
                errors.push('Invalid winner ID.');
            } else if (proposed.participants.indexOf(winnerId) === -1) {
                errors.push('Winner must be a participant in the match.');
            } else if (!validateParticipant(tournament, winnerId, expectedType)) {
                errors.push('Winner is not a valid tournament participant.');
            }
        }

        // ---- LOSER ----
        if (proposed.loser !== null) {
            if (proposed.type === 'group_exam') {
                errors.push('Group exam matches do not have a loser field.');
            } else {
                var loserId = normaliseId(proposed.loser);
                if (loserId === null) {
                    errors.push('Invalid loser ID.');
                } else if (proposed.participants.indexOf(loserId) === -1) {
                    errors.push('Loser must be a participant in the match.');
                } else if (proposed.winner && loserId === normaliseId(proposed.winner)) {
                    errors.push('Loser cannot be the same as winner.');
                }
            }
        }

        // ---- ADVANCING ----
        if (Array.isArray(proposed.advancing)) {
            var advancingSeen = {};
            for (var a = 0; a < proposed.advancing.length; a++) {
                var advId = normaliseId(proposed.advancing[a]);
                if (advId === null) {
                    errors.push('Invalid advancing participant ID.');
                    continue;
                }
                if (advancingSeen[advId]) {
                    errors.push('Duplicate advancing participant: "' + advId + '"');
                }
                advancingSeen[advId] = true;
                if (proposed.participants.indexOf(advId) === -1) {
                    errors.push('Advancing participant must be in the match.');
                }
                if (!validateParticipant(tournament, advId, expectedType)) {
                    errors.push('Advancing participant is not a valid tournament participant.');
                }
            }

            // Winner must be in advancing for standard matches
            if (proposed.type === 'standard' && proposed.winner && proposed.advancing.length > 0) {
                if (proposed.advancing.indexOf(proposed.winner) === -1) {
                    errors.push('Standard match winner must be included in advancing participants.');
                }
            }
        }

        // ---- RESULTS ----
        if (Object.keys(proposed.results).length > 0) {
            if (proposed.type !== 'group_exam') {
                errors.push('Results are only valid for group_exam matches.');
            } else {
                var resultKeys = Object.keys(proposed.results);
                for (var r = 0; r < resultKeys.length; r++) {
                    var key = resultKeys[r];
                    var id = normaliseId(key);
                    if (id === null) {
                        errors.push('Invalid result participant ID: "' + key + '"');
                        continue;
                    }
                    if (proposed.participants.indexOf(id) === -1) {
                        errors.push('Result participant "' + key + '" is not in the match.');
                    }
                    var value = proposed.results[key];
                    if (!isValidGroupExamResult(value)) {
                        errors.push('Result for participant "' + key + '" must be "pass" or "fail".');
                    }
                }
            }
        }

        // ---- COMPLETED MATCH VALIDATION ----
        if (proposed.status === 'completed') {
            if (proposed.type === 'standard' && !proposed.winner) {
                errors.push('Completed standard match must have a winner.');
            }
            if (proposed.type === 'group_exam') {
                for (var m = 0; m < proposed.participants.length; m++) {
                    var pid = proposed.participants[m];
                    if (!proposed.results[pid] || !isValidGroupExamResult(proposed.results[pid])) {
                        errors.push('Completed group exam must have results for all participants.');
                        break;
                    }
                }
            }
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

    // ============================================================
    // MATCH API
    // ============================================================

    var TournamentsMatches = {
        addMatch: function(tournamentId, roundIndex, matchData) {
            if (!isObject(matchData)) return null;

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

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

            var proposed = buildProposedMatch(base, matchData, tournament, round);
            if (proposed === null) return null;

            var validation = validateProposedMatch(proposed, tournament, round, -1);
            if (!validation.valid) return null;

            round.matches.push(proposed);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added match to round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return cloneMatch(proposed);
        },

        removeMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return false;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return false;

            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return false;

            var match = getMatch(round, matchIndex);
            if (!match) return false;

            if (match.status === 'completed') return false;

            round.matches.splice(matchIndex, 1);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed match from round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return true;
        },

        updateMatch: function(tournamentId, roundIndex, matchIndex, updates) {
            if (!isObject(updates)) return null;

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.status === 'completed') return null;

            var proposed = buildProposedMatch(match, updates, tournament, round);
            if (proposed === null) return null;

            var validation = validateProposedMatch(proposed, tournament, round, matchIndex);
            if (!validation.valid) return null;

            var changed = applyProposedMatch(match, proposed);

            if (changed && typeof window.logActivity === 'function') {
                window.logActivity('Updated match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return cloneMatch(match);
        },

        completeMatch: function(tournamentId, roundIndex, matchIndex, winnerId, results) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

            var structureValidation = Schema.validateTournament(tournament, { strict: true });
            if (!structureValidation.valid) return null;

            var match = getMatch(round, matchIndex);
            if (!match) return null;

            if (match.status === 'completed') return null;

            var updates = { status: 'completed' };

            if (match.type === 'standard') {
                var winnerNormalised = normaliseReject(winnerId);
                if (winnerNormalised === null) return null;
                if (match.participants.indexOf(winnerNormalised) === -1) return null;
                updates.winner = winnerNormalised;
            }

            if (match.type === 'group_exam') {
                if (!results || !isObject(results) || Object.keys(results).length === 0) return null;
                var normalisedResults = normaliseResultsStrict(results);
                if (normalisedResults === null) return null;
                for (var i = 0; i < match.participants.length; i++) {
                    if (!normalisedResults[match.participants[i]]) return null;
                }
                updates.results = normalisedResults;
            }

            var proposed = buildProposedMatch(match, updates, tournament, round);
            if (proposed === null) return null;

            var validation = validateProposedMatch(proposed, tournament, round, matchIndex);
            if (!validation.valid) return null;

            applyProposedMatch(match, proposed);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Completed match in round ' + (round.roundNumber || roundIndex + 1) + ' of tournament: ' + tournament.name);
            }

            return cloneMatch(match);
        },

        setGroupExamResult: function(tournamentId, roundIndex, matchIndex, participantId, result) {
            var participantNormalised = normaliseReject(participantId);
            if (participantNormalised === null) return null;

            if (!result) return null;
            if (result !== 'pass' && result !== 'fail') return null;

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

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

            var proposed = buildProposedMatch(match, updates, tournament, round);
            if (proposed === null) return null;

            var validation = validateProposedMatch(proposed, tournament, round, matchIndex);
            if (!validation.valid) return null;

            applyProposedMatch(match, proposed);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set group exam result for participant in tournament: ' + tournament.name);
            }

            return cloneMatch(match);
        },

        setMatchWinner: function(tournamentId, roundIndex, matchIndex, winnerId) {
            var winnerNormalised = normaliseReject(winnerId);
            if (winnerNormalised === null) return null;

            var tournament = getValidTournament(tournamentId);
            if (!tournament) return null;

            var round = getMutableRound(tournament, roundIndex);
            if (!round) return null;

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
            var proposed = buildProposedMatch(match, updates, tournament, round);
            if (proposed === null) return null;

            var validation = validateProposedMatch(proposed, tournament, round, matchIndex);
            if (!validation.valid) return null;

            applyProposedMatch(match, proposed);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Set match winner in tournament: ' + tournament.name);
            }

            return cloneMatch(match);
        },

        // ============================================================
        // READ OPERATIONS - Defensive copies
        // ============================================================

        getRoundMatches: function(tournamentId, roundIndex) {
            var tournament = getValidTournament(tournamentId);
            if (!tournament) return [];

            var round = getRound(tournament, roundIndex);
            if (!round) return [];

            return cloneMatchesArray(round.matches);
        },

        getMatch: function(tournamentId, roundIndex, matchIndex) {
            var tournament = getValidTournament(tournamentId);
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

        getMatchAdvancing: function(tournamentId, roundIndex, matchIndex) {
            var match = this.getMatch(tournamentId, roundIndex, matchIndex);
            if (!match) return [];

            if (Array.isArray(match.advancing) && match.advancing.length > 0) {
                return match.advancing.slice();
            }

            if (match.type === 'standard' && match.winner) {
                return [match.winner];
            }

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
