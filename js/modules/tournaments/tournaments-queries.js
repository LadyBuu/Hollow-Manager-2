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
 * 
 * READ SEMANTICS:
 *   - getTournaments() returns a shallow array copy containing live tournament references
 *   - Tournament objects are live references; do not mutate them directly
 *   - Completed matches return 'unknown' for ambiguous participant outcomes
 *   - round.status is AUTHORITATIVE for round status queries
 *   - isTournamentComplete() provides a query-layer projection of completion semantics
 *     (see TournamentsCore for authoritative mutation semantics)
 * 
 * DEPENDENCIES:
 *   - TournamentsSchema for shared validation and type checking
 */

(function() {
    'use strict';

    if (window.__tournamentsQueriesLoaded) return;
    window.__tournamentsQueriesLoaded = true;

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        return window.data;
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function normaliseId(id) {
        if (id === undefined || id === null) return null;
        if (typeof id === 'object') return null;
        var normalised = String(id).trim();
        return normalised !== '' ? normalised : null;
    }

    function getParticipantRecord(tournament, id) {
        if (!tournament || !Array.isArray(tournament.participants)) return null;
        var target = normaliseId(id);
        if (target === null) return null;
        return tournament.participants.find(function(p) {
            return p && normaliseId(p.id) === target;
        }) || null;
    }

    function getCharacterById(id) {
        var target = normaliseId(id);
        if (target === null) return null;
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && normaliseId(c.id) === target;
        }) || null;
    }

    function getTeamById(id) {
        var target = normaliseId(id);
        if (target === null) return null;
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        return data.teams.find(function(t) {
            return t && normaliseId(t.id) === target;
        }) || null;
    }

    function getCharacterName(char) {
        if (!char) return 'Unknown Character';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || 'Unknown Character';
    }

    // ============================================================
    // QUERIES API
    // ============================================================

    var TournamentsQueries = {
        /**
         * Get tournament status color.
         */
        getStatusColor: function(status) {
            var map = {
                'draft': 'var(--text-dim)',
                'active': 'var(--accent)',
                'completed': 'var(--info)'
            };
            return map[status] || 'var(--text-dim)';
        },

        /**
         * Get all tournaments. Returns a shallow copy of the array.
         * Tournament objects are LIVE REFERENCES; do not mutate them.
         */
        getTournaments: function() {
            var data = getDataStore();
            return data && Array.isArray(data.tournaments) ? data.tournaments.slice() : [];
        },

        /**
         * Get participant name using the participant's declared type.
         * 
         * CRITICAL: If the declared type is present, we ONLY look in the
         * corresponding entity type. We do NOT search across boundaries.
         * This prevents malformed data from being silently hidden.
         * 
         * @param {string|object} participant - Either an ID string or a participant object
         * @param {object} tournament - Tournament context for type resolution (optional but recommended)
         */
        getParticipantName: function(participant, tournament) {
            if (!participant) return 'Unknown';

            if (typeof participant === 'object' && participant !== null) {
                var id = participant.id;
                var type = participant.type;

                if (!id) return 'Unknown';

                var normalisedId = normaliseId(id);
                if (normalisedId === null) return 'Unknown';

                if (type === 'team') {
                    var team = getTeamById(normalisedId);
                    if (team) return team.name || 'Unknown Team';
                    return 'Unknown Team';
                }

                if (type === 'character') {
                    var char = getCharacterById(normalisedId);
                    if (char) return getCharacterName(char);
                    return 'Unknown Character';
                }

                if (type !== undefined) {
                    return 'Unknown (' + type + ')';
                }
            }

            var idStr = normaliseId(typeof participant === 'object' ? participant.id : participant);
            if (idStr === null) return 'Unknown';

            if (tournament) {
                var record = getParticipantRecord(tournament, idStr);
                if (record && record.type) {
                    if (record.type === 'team') {
                        var team = getTeamById(idStr);
                        if (team) return team.name || 'Unknown Team';
                        return 'Unknown Team';
                    }
                    if (record.type === 'character') {
                        var char = getCharacterById(idStr);
                        if (char) return getCharacterName(char);
                        return 'Unknown Character';
                    }
                    return 'Unknown (' + record.type + ')';
                }
            }

            // Fallback: legacy ID-only lookup
            var data = getDataStore();
            if (!data) return 'Unknown';

            if (Array.isArray(data.characters)) {
                var char = data.characters.find(function(c) {
                    return c && normaliseId(c.id) === idStr;
                });
                if (char) return getCharacterName(char);
            }

            if (Array.isArray(data.teams)) {
                var team = data.teams.find(function(t) {
                    return t && normaliseId(t.id) === idStr;
                });
                if (team) return team.name || 'Unknown Team';
            }

            return 'Unknown';
        },

        /**
         * Get participant type.
         * If tournament context is provided, uses declared participant type.
         * Otherwise falls back to legacy datastore inference.
         * Invalid declared types return 'unknown'.
         * 
         * @param {string|object} participant - Either an ID string or a participant object
         * @param {object} tournament - Tournament context (optional)
         * @returns {string} 'character', 'team', or 'unknown'
         */
        getParticipantType: function(participant, tournament) {
            if (!participant) return 'unknown';

            // If we have a participant object with declared type and tournament context
            if (typeof participant === 'object' && participant !== null) {
                if (participant.type) {
                    var validTypes = ['character', 'team'];
                    if (validTypes.indexOf(participant.type) !== -1) {
                        return participant.type;
                    }
                    return 'unknown';
                }
                if (!participant.id) return 'unknown';
                var id = participant.id;
            } else {
                var id = participant;
            }

            // If tournament context is provided, try to resolve from participant record
            if (tournament) {
                var record = getParticipantRecord(tournament, id);
                if (record && record.type) {
                    var validTypes = ['character', 'team'];
                    if (validTypes.indexOf(record.type) !== -1) {
                        return record.type;
                    }
                    return 'unknown';
                }
            }

            // Fallback: legacy datastore lookup
            var idStr = normaliseId(id);
            if (idStr === null) return 'unknown';

            var data = getDataStore();
            if (!data) return 'unknown';

            if (Array.isArray(data.characters) && data.characters.some(function(c) {
                return c && normaliseId(c.id) === idStr;
            })) {
                return 'character';
            }

            if (Array.isArray(data.teams) && data.teams.some(function(t) {
                return t && normaliseId(t.id) === idStr;
            })) {
                return 'team';
            }

            return 'unknown';
        },

        /**
         * Check if a participant is eliminated from a tournament.
         */
        isParticipantEliminated: function(tournament, participantId) {
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;
            var target = normaliseId(participantId);
            if (target === null) return false;
            return tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === target;
            });
        },

        /**
         * Get participants for a round.
         * Returns all participant IDs that appear in matches in this round.
         * IDs are normalised to strings for consistency.
         */
        getRoundParticipants: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) return [];
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return [];

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return [];

            var participants = [];
            round.matches.forEach(function(match) {
                if (Array.isArray(match.participants)) {
                    match.participants.forEach(function(id) {
                        if (id) {
                            var normalised = normaliseId(id);
                            if (normalised !== null && participants.indexOf(normalised) === -1) {
                                participants.push(normalised);
                            }
                        }
                    });
                }
            });

            return participants;
        },

        /**
         * Get participant status in a round.
         * Returns one of: 'winner', 'eliminated', 'advancing', 'passed', 'failed', 'pending', 'unknown'
         * 
         * CRITICAL: Does NOT infer elimination from incomplete data.
         * For completed matches without explicit outcome for a participant, returns 'unknown'.
         */
        getParticipantRoundStatus: function(tournament, roundIndex, participantId) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 'unknown';
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return 'unknown';

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return 'unknown';

            var target = normaliseId(participantId);
            if (target === null) return 'unknown';

            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (!match || !Array.isArray(match.participants)) continue;

                var isInMatch = match.participants.some(function(id) {
                    return normaliseId(id) === target;
                });

                if (!isInMatch) continue;

                // Group exam - check results
                if (match.type === 'group_exam') {
                    var result = match.results && match.results[target];
                    if (result === 'pass') return 'passed';
                    if (result === 'fail') return 'failed';
                    return 'pending';
                }

                // Standard match - check winner/loser/advancing
                if (match.winner && normaliseId(match.winner) === target) {
                    return 'winner';
                }

                if (match.loser && normaliseId(match.loser) === target) {
                    return 'eliminated';
                }

                if (Array.isArray(match.advancing)) {
                    var isAdvancing = match.advancing.some(function(id) {
                        return normaliseId(id) === target;
                    });
                    if (isAdvancing) return 'advancing';
                }

                // For completed matches, return 'unknown' rather than inferring elimination
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
         */
        getRoundStatusSummary: function(tournament, roundIndex) {
            var participants = this.getRoundParticipants(tournament, roundIndex);
            var statuses = {};

            participants.forEach(function(id) {
                statuses[id] = this.getParticipantRoundStatus(tournament, roundIndex, id);
            }, this);

            return statuses;
        },

        /**
         * Get round status.
         * round.status is AUTHORITATIVE. Do not infer from matches.
         */
        getRoundStatus: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 'empty';
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return 'empty';

            var round = tournament.rounds[roundIndex];
            if (!round) return 'empty';

            if (round.status === 'completed') return 'completed';

            var matches = Array.isArray(round.matches) ? round.matches : [];

            if (matches.length === 0) return 'empty';

            var hasInProgress = matches.some(function(m) {
                return m && m.status === 'in_progress';
            });

            if (hasInProgress) return 'in_progress';

            var hasPending = matches.some(function(m) {
                return m && m.status === 'pending';
            });

            if (hasPending) return 'pending';

            return 'pending';
        },

        /**
         * Get tournament winner display name.
         * Winner is expected to be a participant object { id, type }.
         */
        getWinnerName: function(tournament) {
            if (!tournament || !tournament.winner) return 'Not determined';
            return this.getParticipantName(tournament.winner, tournament);
        },

        /**
         * Get tournament winner as a participant object.
         * Returns null if no winner.
         */
        getWinner: function(tournament) {
            if (!tournament || !tournament.winner) return null;
            return tournament.winner;
        },

        /**
         * Check if tournament is complete.
         * This is a QUERY-LAYER projection of completion semantics.
         * For authoritative mutation semantics, see TournamentsCore.completeTournament().
         * 
         * Defines completion as: status === 'completed' OR (all rounds complete AND winner exists)
         */
        isTournamentComplete: function(tournament) {
            if (!tournament) return false;

            if (tournament.status === 'completed') return true;

            if (!Array.isArray(tournament.rounds) || tournament.rounds.length === 0) {
                return false;
            }

            var allRoundsComplete = tournament.rounds.every(function(r) {
                return r && r.status === 'completed';
            });

            return allRoundsComplete && !!tournament.winner;
        },

        /**
         * Get match display information.
         * Returns an array of objects with name, outcome, and type.
         * This is the canonical way to get match display data for rendering.
         * 
         * CRITICAL: Does NOT infer elimination from completed matches.
         * For completed matches without explicit outcome for a participant, returns 'unknown'.
         */
        getMatchDisplay: function(tournament, roundIndex, matchIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) return [];
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return [];

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return [];

            if (matchIndex < 0 || matchIndex >= round.matches.length) return [];

            var match = round.matches[matchIndex];
            if (!match || !Array.isArray(match.participants)) return [];

            var result = [];
            var isGroupExam = match.type === 'group_exam';

            match.participants.forEach(function(id) {
                var normalised = normaliseId(id);
                if (normalised === null) return;

                var display = {
                    id: normalised,
                    name: this.getParticipantName({ id: normalised }, tournament),
                    outcome: 'pending',
                    isGroupExam: isGroupExam
                };

                if (isGroupExam) {
                    var resultValue = match.results && match.results[normalised];
                    if (resultValue === 'pass') display.outcome = 'passed';
                    else if (resultValue === 'fail') display.outcome = 'failed';
                    else display.outcome = 'pending';
                } else {
                    if (match.winner && normaliseId(match.winner) === normalised) {
                        display.outcome = 'winner';
                    } else if (match.loser && normaliseId(match.loser) === normalised) {
                        display.outcome = 'eliminated';
                    } else if (Array.isArray(match.advancing) && match.advancing.some(function(aid) {
                        return normaliseId(aid) === normalised;
                    })) {
                        display.outcome = 'advancing';
                    } else if (match.status === 'completed') {
                        // For completed matches without explicit outcome, return 'unknown'
                        // Do NOT infer elimination from incomplete data
                        display.outcome = 'unknown';
                    } else {
                        display.outcome = 'pending';
                    }
                }

                result.push(display);
            }, this);

            return result;
        },

        /**
         * Get participant count for a tournament.
         */
        getParticipantCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.participants)) return 0;
            return tournament.participants.length;
        },

        /**
         * Get round count for a tournament.
         */
        getRoundCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 0;
            return tournament.rounds.length;
        },

        /**
         * Get match count for a round.
         */
        getMatchCount: function(tournament, roundIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 0;
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return 0;
            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return 0;
            return round.matches.length;
        },

        /**
         * Get elimination count for a tournament.
         */
        getEliminationCount: function(tournament) {
            if (!tournament || !Array.isArray(tournament.eliminations)) return 0;
            return tournament.eliminations.length;
        },

        /**
         * Get a match by round and match index.
         * Returns a LIVE reference - do not mutate directly.
         * Use TournamentsMatches for mutations.
         */
        getMatch: function(tournament, roundIndex, matchIndex) {
            if (!tournament || !Array.isArray(tournament.rounds)) return null;
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return null;
            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return null;
            if (matchIndex < 0 || matchIndex >= round.matches.length) return null;
            return round.matches[matchIndex] || null;
        },

        /**
         * Get tournament participant name with context.
         * Convenience wrapper around getParticipantName.
         */
        getTournamentParticipantName: function(tournament, participantId) {
            if (!tournament) return 'Unknown';
            var id = normaliseId(participantId);
            if (id === null) return 'Unknown';
            return this.getParticipantName({ id: id }, tournament);
        },

        /**
         * Get tournament participant type with context.
         * Convenience wrapper around getParticipantType.
         */
        getTournamentParticipantType: function(tournament, participantId) {
            if (!tournament) return null;
            var id = normaliseId(participantId);
            if (id === null) return null;
            return this.getParticipantType({ id: id }, tournament);
        },

        /**
         * Check if a match is complete using the match's status.
         */
        isMatchComplete: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) return false;
            return match.status === 'completed';
        },

        /**
         * Get match winner.
         */
        getMatchWinner: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) return null;
            return match.winner || null;
        },

        /**
         * Get match losers (standard matches only).
         */
        getMatchLosers: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
            if (!match) return [];
            if (match.loser) return [match.loser];
            return [];
        },

        /**
         * Get participants advancing from a match.
         */
        getMatchAdvancing: function(tournament, roundIndex, matchIndex) {
            var match = this.getMatch(tournament, roundIndex, matchIndex);
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

    window.TournamentsQueries = TournamentsQueries;

})();
