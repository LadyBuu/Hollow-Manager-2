/**
 * js/modules/tournaments/tournaments-queries.js - Tournament Queries
 * PURE read-only queries. Does NOT mutate data.
 * 
 * QUERY PHILOSOPHY:
 *   - All queries are PURE: no side effects, no mutation
 *   - Respect declared participant types from tournament data
 *   - Do NOT silently repair or reinterpret malformed data
 *   - Return "Unknown" for missing entities, never search across type boundaries
 *   - ID comparisons are always string-normalised
 *   - Do NOT infer outcomes from incomplete data
 *   - All getters return DEFENSIVE COPIES
 * 
 * READ SEMANTICS:
 *   - getTournaments() returns defensive copies of tournament objects
 *   - Completed matches return 'unknown' for ambiguous participant outcomes
 *   - round.status is AUTHORITATIVE for round status queries
 *   - isTournamentComplete() provides a query-layer projection of completion semantics
 * 
 * PARTICIPANT TYPE AUTHORITY:
 *   - Tournament context is AUTHORITATIVE when supplied.
 *   - Participant type is determined by tournament mode (canonical type).
 *   - Explicit participant object type is only used when NO tournament context exists.
 *   - This ensures queries and renderers agree on participant identity.
 * 
 * DEPENDENCIES:
 *   - window.TournamentsSchema - Structural validation and identity
 *   - window.CharacterQueries - Character data queries
 *   - window.TeamQueries - Team data queries
 *   - window.IdUtils - ID normalisation
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsSchema) {
        missing.push('TournamentsSchema');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeamName !== 'function') {
        missing.push('TeamQueries.getTeamName');
    }

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentsQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentsQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Schema = window.TournamentsSchema;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_MODES = Schema.VALID_MODES;
    var VALID_STATUSES = Schema.VALID_STATUSES;
    var VALID_PARTICIPANT_TYPES = Schema.VALID_PARTICIPANT_TYPES;
    var VALID_MATCH_TYPES = Schema.VALID_MATCH_TYPES;
    var VALID_MATCH_STATUSES = Schema.VALID_MATCH_STATUSES;
    var VALID_GROUP_EXAM_RESULTS = Schema.VALID_GROUP_EXAM_RESULTS;

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getTournamentInternal(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) {
            return null;
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.tournaments)) {
            return null;
        }
        for (var i = 0; i < data.tournaments.length; i++) {
            var t = data.tournaments[i];
            if (t && normaliseId(t.id) === normalisedId) {
                return t;
            }
        }
        return null;
    }

    function getParticipantRecord(tournament, id) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return null;
        }
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === target) {
                return p;
            }
        }
        return null;
    }

    function getCanonicalParticipantType(mode) {
        return Schema.getCanonicalParticipantType(mode);
    }

    function deepClone(value) {
        return Schema.deepClone(value);
    }

    // ============================================================
    // RESOLVE PARTICIPANT - Internal resolver
    // ============================================================

    /**
     * Resolve a participant to its canonical representation.
     * This is the SINGLE SOURCE OF TRUTH for participant resolution.
     * 
     * @param {string|object} participant - ID string or participant object
     * @param {object} tournament - Tournament context (optional)
     * @returns {object} { id, type, record }
     */
    function resolveParticipant(participant, tournament) {
        var result = {
            id: null,
            type: null,
            record: null
        };

        if (!participant) {
            return result;
        }

        var idStr = null;
        var suppliedType = null;

        if (typeof participant === 'object' && participant !== null) {
            idStr = normaliseId(participant.id);
            if (participant.type !== undefined) {
                suppliedType = participant.type;
            }
        } else {
            idStr = normaliseId(participant);
        }

        if (idStr === null) {
            return result;
        }

        result.id = idStr;

        // 1. Tournament context is authoritative
        if (tournament) {
            var canonicalType = getCanonicalParticipantType(tournament.mode);
            if (canonicalType) {
                var record = getParticipantRecord(tournament, idStr);
                if (record && record.type === canonicalType) {
                    result.type = canonicalType;
                    result.record = record;
                    return result;
                }
                if (record && record.type !== canonicalType) {
                    // Participant exists but type doesn't match - data is malformed
                    return result;
                }
                return result;
            }
        }

        // 2. Fallback to supplied type
        if (suppliedType && VALID_PARTICIPANT_TYPES.indexOf(suppliedType) !== -1) {
            result.type = suppliedType;
            return result;
        }

        // 3. Legacy datastore inference (only if no tournament context)
        if (!tournament) {
            var data = getDataStore();
            if (data) {
                if (Array.isArray(data.teams) && data.teams.some(function(t) {
                    return t && normaliseId(t.id) === idStr;
                })) {
                    result.type = 'team';
                    return result;
                }
                if (Array.isArray(data.characters) && data.characters.some(function(c) {
                    return c && normaliseId(c.id) === idStr;
                })) {
                    result.type = 'character';
                    return result;
                }
            }
        }

        return result;
    }

    // ============================================================
    // QUERIES API
    // ============================================================

    var TournamentsQueries = {
        // ============================================================
        // TOURNAMENT QUERIES - Defensive copies
        // ============================================================

        /**
         * Get all tournaments. Returns defensive copies.
         * 
         * @returns {array} Array of tournament objects
         */
        getTournaments: function() {
            var data = getDataStore();
            if (!data || !Array.isArray(data.tournaments)) {
                return [];
            }
            var result = [];
            for (var i = 0; i < data.tournaments.length; i++) {
                if (data.tournaments[i]) {
                    result.push(deepClone(data.tournaments[i]));
                }
            }
            return result;
        },

        /**
         * Get a tournament by ID (defensive copy).
         * 
         * @param {string} id - Tournament ID
         * @returns {object|null} Tournament object or null
         */
        getTournament: function(id) {
            var tournament = getTournamentInternal(id);
            if (!tournament) {
                return null;
            }
            return deepClone(tournament);
        },

        // ============================================================
        // PARTICIPANT QUERIES
        // ============================================================

        /**
         * Get a participant record from a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @param {string} id - Participant ID
         * @returns {object|null} Participant record or null
         */
        getParticipantRecord: function(tournament, id) {
            return getParticipantRecord(tournament, id);
        },

        /**
         * Get participant type using the canonical type from tournament mode.
         * 
         * @param {string|object} participant - ID string or participant object
         * @param {object} tournament - Tournament context (optional)
         * @returns {string} 'character', 'team', or 'unknown'
         */
        getParticipantType: function(participant, tournament) {
            var resolved = resolveParticipant(participant, tournament);
            return resolved.type || 'unknown';
        },

        /**
         * Get participant name using the canonical type from tournament mode.
         * 
         * @param {string|object} participant - ID string or participant object
         * @param {object} tournament - Tournament context (optional)
         * @returns {string} Participant name
         */
        getParticipantName: function(participant, tournament) {
            var resolved = resolveParticipant(participant, tournament);
            if (resolved.id === null) {
                return 'Unknown';
            }

            if (resolved.type === 'team') {
                var team = TeamQueries.getTeamById(resolved.id);
                if (team) {
                    return TeamQueries.getTeamName(team) || resolved.id;
                }
                return 'Unknown Team (' + resolved.id + ')';
            }

            if (resolved.type === 'character') {
                var character = CharacterQueries.getCharacterById(resolved.id);
                if (character) {
                    return CharacterQueries.getDisplayName(character);
                }
                return 'Unknown Character (' + resolved.id + ')';
            }

            return 'Unknown (ID: ' + resolved.id + ')';
        },

        /**
         * Get tournament participant name with context.
         * Convenience wrapper around getParticipantName.
         * 
         * @param {object} tournament - Tournament object
         * @param {string} participantId - Participant ID
         * @returns {string} Participant name
         */
        getTournamentParticipantName: function(tournament, participantId) {
            if (!tournament) {
                return 'Unknown';
            }
            return this.getParticipantName({ id: participantId }, tournament);
        },

        /**
         * Get tournament participant type with context.
         * Convenience wrapper around getParticipantType.
         * 
         * @param {object} tournament - Tournament object
         * @param {string} participantId - Participant ID
         * @returns {string} 'character', 'team', or 'unknown'
         */
        getTournamentParticipantType: function(tournament, participantId) {
            if (!tournament) {
                return 'unknown';
            }
            return this.getParticipantType({ id: participantId }, tournament);
        },

        /**
         * Get the canonical participant type for a tournament mode.
         * 
         * @param {string} mode - Tournament mode
         * @returns {string|null} 'team', 'character', or null
         */
        getCanonicalParticipantType: function(mode) {
            return getCanonicalParticipantType(mode);
        },

        /**
         * Check if a participant is in a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @param {string} participantId - Participant ID
         * @returns {boolean} True if participant is in tournament
         */
        isParticipantInTournament: function(tournament, participantId) {
            return Schema.isParticipantInTournament(tournament, participantId);
        },

        /**
         * Check if a participant is eliminated from a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @param {string} participantId - Participant ID
         * @returns {boolean} True if eliminated
         */
        isParticipantEliminated: function(tournament, participantId) {
            return Schema.isParticipantEliminated(tournament, participantId);
        },

        // ============================================================
        // ROUND QUERIES
        // ============================================================

        /**
         * Get participants for a round.
         * Returns all participant IDs that appear in matches in this round.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @returns {array} Array of participant IDs
         */
        getRoundParticipants: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return [];
            }
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                return [];
            }

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) {
                return [];
            }

            var participants = [];
            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (Array.isArray(match.participants)) {
                    for (var j = 0; j < match.participants.length; j++) {
                        var id = normaliseId(match.participants[j]);
                        if (id !== null && participants.indexOf(id) === -1) {
                            participants.push(id);
                        }
                    }
                }
            }

            return participants;
        },

        /**
         * Get participant status in a round.
         * Returns one of: 'winner', 'eliminated', 'advancing', 'passed', 'failed', 'pending', 'unknown'
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {string} participantId - Participant ID
         * @returns {string} Participant status
         */
        getParticipantRoundStatus: function(tournament, roundIndex, participantId) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 'unknown';
            }
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                return 'unknown';
            }

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) {
                return 'unknown';
            }

            var target = normaliseId(participantId);
            if (target === null) {
                return 'unknown';
            }

            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (!match || !Array.isArray(match.participants)) {
                    continue;
                }

                var isInMatch = match.participants.some(function(id) {
                    return normaliseId(id) === target;
                });

                if (!isInMatch) {
                    continue;
                }

                // Group exam - check results
                if (match.type === 'group_exam') {
                    var result = match.results && match.results[target];
                    if (result === 'pass') {
                        return 'passed';
                    }
                    if (result === 'fail') {
                        return 'failed';
                    }
                    return match.status === 'completed' ? 'unknown' : 'pending';
                }

                // Standard match - check winner/loser/advancing
                if (match.winner && normaliseId(match.winner) === target) {
                    return 'winner';
                }

                if (match.loser && normaliseId(match.loser) === target) {
                    return 'eliminated';
                }

                // Derive advancing from Schema
                var advancing = Schema.deriveAdvancing(match);
                for (var j = 0; j < advancing.length; j++) {
                    if (normaliseId(advancing[j]) === target) {
                        return 'advancing';
                    }
                }

                if (match.status === 'completed') {
                    return 'unknown';
                }

                return 'pending';
            }

            if (this.isParticipantEliminated(tournament, target)) {
                return 'eliminated';
            }

            return 'unknown';
        },

        /**
         * Get round status summary.
         * Returns an object mapping participant IDs to their status.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @returns {object} Status summary
         */
        getRoundStatusSummary: function(tournament, roundIndex) {
            var participants = this.getRoundParticipants(tournament, roundIndex);
            var statuses = {};
            for (var i = 0; i < participants.length; i++) {
                statuses[participants[i]] = this.getParticipantRoundStatus(
                    tournament,
                    roundIndex,
                    participants[i]
                );
            }
            return statuses;
        },

        /**
         * Get round status.
         * round.status is AUTHORITATIVE for round status queries.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @returns {string} 'completed', 'in_progress', 'pending', 'empty', or 'unknown'
         */
        getRoundStatus: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 'unknown';
            }
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                return 'unknown';
            }

            var round = tournament.rounds[roundIndex];
            if (!round) {
                return 'unknown';
            }

            // round.status is authoritative
            if (round.status === 'completed') {
                return 'completed';
            }

            var matches = Array.isArray(round.matches) ? round.matches : [];

            if (matches.length === 0) {
                return 'empty';
            }

            var hasInProgress = matches.some(function(m) {
                return m && m.status === 'in_progress';
            });

            if (hasInProgress) {
                return 'in_progress';
            }

            var hasPending = matches.some(function(m) {
                return m && m.status === 'pending';
            });

            if (hasPending) {
                return 'pending';
            }

            return 'pending';
        },

        /**
         * Get round count for a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @returns {number} Number of rounds
         */
        getRoundCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 0;
            }
            return tournament.rounds.length;
        },

        // ============================================================
        // MATCH QUERIES
        // ============================================================

        /**
         * Get a match (defensive copy).
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {object|null} Match object or null
         */
        getMatch: function(tournament, roundIndex, matchIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return null;
            }
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                return null;
            }
            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) {
                return null;
            }
            if (matchIndex < 0 || matchIndex >= round.matches.length) {
                return null;
            }
            var match = round.matches[matchIndex];
            if (!match) {
                return null;
            }
            return deepClone(match);
        },

        /**
         * Get match count for a round.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @returns {number} Number of matches
         */
        getMatchCount: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 0;
            }
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                return 0;
            }
            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) {
                return 0;
            }
            return round.matches.length;
        },

        /**
         * Check if a match is complete.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {boolean} True if complete
         */
        isMatchComplete: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) {
                return false;
            }
            return match.status === 'completed';
        },

        /**
         * Get match winner.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {string|null} Winner ID or null
         */
        getMatchWinner: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) {
                return null;
            }
            return match.winner || null;
        },

        /**
         * Get match loser(s).
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {array} Array of loser IDs
         */
        getMatchLosers: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
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
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match
         * @returns {array} Array of advancing participant IDs
         */
        getMatchAdvancing: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) {
                return [];
            }
            return Schema.deriveAdvancing(match);
        },

        // ============================================================
        // TOURNAMENT SUMMARY QUERIES
        // ============================================================

        /**
         * Get participant count for a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @returns {number} Number of participants
         */
        getParticipantCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.participants)) {
                return 0;
            }
            return tournament.participants.length;
        },

        /**
         * Get elimination count for a tournament.
         * 
         * @param {object} tournament - Tournament object
         * @returns {number} Number of eliminations
         */
        getEliminationCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.eliminations)) {
                return 0;
            }
            return tournament.eliminations.length;
        },

        /**
         * Get tournament winner as a participant object (defensive copy).
         * 
         * @param {object} tournament - Tournament object
         * @returns {object|null} Winner object or null
         */
        getWinner: function(tournament) {
            if (!tournament || !tournament.winner) {
                return null;
            }
            return deepClone(tournament.winner);
        },

        /**
         * Get tournament winner display name.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} Winner name or 'Not determined'
         */
        getWinnerName: function(tournament) {
            if (!tournament || !tournament.winner) {
                return 'Not determined';
            }
            return this.getParticipantName(tournament.winner, tournament);
        },

        /**
         * Check if tournament is complete (query-layer projection).
         * 
         * @param {object} tournament - Tournament object
         * @returns {boolean} True if complete
         */
        isTournamentComplete: function(tournament) {
            if (!tournament) {
                return false;
            }

            if (tournament.status === 'completed') {
                return true;
            }

            if (!Array.isArray(tournament.rounds) || tournament.rounds.length === 0) {
                return false;
            }

            var allRoundsComplete = tournament.rounds.every(function(r) {
                return r && r.status === 'completed';
            });

            return allRoundsComplete && !!tournament.winner;
        },

        /**
         * Get the current round number (derived from rounds.length).
         * 
         * @param {object} tournament - Tournament object
         * @returns {number} Current round number
         */
        getCurrentRound: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 0;
            }
            return tournament.rounds.length;
        },

        // ============================================================
        // EXTERNAL DEPENDENCY ACCESS (for compatibility)
        // ============================================================

        /**
         * Get a character by ID (delegates to CharacterQueries).
         * 
         * @param {string} id - Character ID
         * @returns {object|null} Character object or null
         */
        getCharacterById: function(id) {
            return CharacterQueries.getCharacterById(id);
        },

        /**
         * Get a team by ID (delegates to TeamQueries).
         * 
         * @param {string} id - Team ID
         * @returns {object|null} Team object or null
         */
        getTeamById: function(id) {
            return TeamQueries.getTeamById(id);
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsQueries = TournamentsQueries;

})();
