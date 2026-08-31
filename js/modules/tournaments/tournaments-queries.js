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
 * PARTICIPANT TYPE AUTHORITY:
 *   - Tournament context is AUTHORITATIVE when supplied.
 *   - Participant type is determined by tournament mode (canonical type).
 *   - Explicit participant object type is only used when NO tournament context exists.
 *   - This ensures queries and renderers agree on participant identity.
 * 
 * DEPENDENCIES:
 *   - TournamentsSchema for shared validation and type checking
 *   - CALENDAR_CONSTANTS for week validation
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsQueriesLoaded) return;

    if (!window.TournamentsSchema) {
        console.error('TournamentsQueries: TournamentsSchema required.');
        return;
    }

    // Check CALENDAR_CONSTANTS
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = Number.isInteger(CALENDAR.MIN_WEEK) ? CALENDAR.MIN_WEEK : 1;
    var MAX_WEEK = Number.isInteger(CALENDAR.MAX_WEEK) ? CALENDAR.MAX_WEEK : 52;

    window.__tournamentsQueriesLoaded = true;

    var Schema = window.TournamentsSchema;

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function normaliseId(id) {
        if (id === undefined || id === null) return null;
        if (typeof id === 'object') return null;
        var normalised = String(id).trim();
        return normalised !== '' ? normalised : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        return window.data;
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
        return char.name || char.firstName || 'Unknown Character';
    }

    /**
     * Get the canonical participant type for a tournament mode.
     * Returns null for invalid modes.
     */
    function getCanonicalParticipantType(mode) {
        if (mode === 'teams') return 'team';
        if (mode === 'individuals') return 'character';
        return null;
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
         * Get participant name using the canonical type from tournament mode.
         * 
         * AUTHORITATIVE: Tournament context determines participant type.
         * If no tournament context, falls back to supplied participant type.
         * 
         * @param {string|object} participant - Either an ID string or a participant object
         * @param {object} tournament - Tournament context (optional but recommended)
         */
        getParticipantName: function(participant, tournament) {
            if (!participant) return 'Unknown';

            var idStr = null;
            var suppliedType = null;

            // Extract ID and type from participant
            if (typeof participant === 'object' && participant !== null) {
                idStr = normaliseId(participant.id);
                if (participant.type !== undefined) {
                    suppliedType = participant.type;
                }
            } else {
                idStr = normaliseId(participant);
            }

            if (idStr === null) return 'Unknown';

            // ---- DETERMINE TYPE ----
            var type = null;

            // 1. Tournament context is authoritative
            if (tournament) {
                var canonicalType = this.getCanonicalParticipantType(tournament.mode);
                if (canonicalType) {
                    // Verify the participant exists with this type
                    var record = this.getParticipantRecord(tournament, idStr);
                    if (record && record.type === canonicalType) {
                        type = canonicalType;
                    } else if (record) {
                        // Participant exists but type doesn't match canonical - data is malformed
                        return 'Unknown (' + idStr + ')';
                    }
                    // If no record, participant is not in tournament
                }
            }

            // 2. Fallback to supplied type
            if (!type && suppliedType) {
                if (suppliedType === 'team' || suppliedType === 'character') {
                    type = suppliedType;
                }
            }

            // 3. Legacy datastore inference (only if no tournament context)
            if (!type) {
                var data = this.getDataStore();
                if (data) {
                    // Check teams first (legacy)
                    if (Array.isArray(data.teams) && data.teams.some(function(t) {
                        return t && normaliseId(t.id) === idStr;
                    })) {
                        type = 'team';
                    } else if (Array.isArray(data.characters) && data.characters.some(function(c) {
                        return c && normaliseId(c.id) === idStr;
                    })) {
                        type = 'character';
                    }
                }
            }

            if (!type) return 'Unknown (ID: ' + idStr + ')';

            // ---- LOOK UP ENTITY ----
            var data = this.getDataStore();
            if (!data) return 'Unknown';

            if (type === 'team') {
                var team = data.teams ? data.teams.find(function(t) {
                    return t && normaliseId(t.id) === idStr;
                }) : null;
                if (team) {
                    // Return team name, fallback to ID
                    return team.name || team.id || 'Unknown Team';
                }
                return 'Unknown Team (ID: ' + idStr + ')';
            }

            if (type === 'character') {
                var char = data.characters ? data.characters.find(function(c) {
                    return c && normaliseId(c.id) === idStr;
                }) : null;
                if (char) {
                    return getCharacterName(char);
                }
                return 'Unknown Character (ID: ' + idStr + ')';
            }

            return 'Unknown';
        },

        /**
         * Get participant type.
         * 
         * AUTHORITATIVE: Tournament context determines participant type.
         * If no tournament context, falls back to supplied participant type.
         * 
         * @param {string|object} participant - Either an ID string or a participant object
         * @param {object} tournament - Tournament context (optional)
         * @returns {string} 'character', 'team', or 'unknown'
         */
        getParticipantType: function(participant, tournament) {
            if (!participant) return 'unknown';

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

            if (idStr === null) return 'unknown';

            // 1. Tournament context is authoritative
            if (tournament) {
                var canonicalType = this.getCanonicalParticipantType(tournament.mode);
                if (canonicalType) {
                    var record = this.getParticipantRecord(tournament, idStr);
                    if (record && record.type === canonicalType) {
                        return canonicalType;
                    }
                    if (record && record.type !== canonicalType) {
                        return 'unknown';
                    }
                    return 'unknown';
                }
            }

            // 2. Fallback to supplied type
            if (suppliedType) {
                if (suppliedType === 'team' || suppliedType === 'character') {
                    return suppliedType;
                }
                return 'unknown';
            }

            // 3. Legacy datastore inference
            var data = this.getDataStore();
            if (!data) return 'unknown';

            if (Array.isArray(data.teams) && data.teams.some(function(t) {
                return t && normaliseId(t.id) === idStr;
            })) {
                return 'team';
            }

            if (Array.isArray(data.characters) && data.characters.some(function(c) {
                return c && normaliseId(c.id) === idStr;
            })) {
                return 'character';
            }

            return 'unknown';
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
            if (!tournament) return 'unknown';
            var id = normaliseId(participantId);
            if (id === null) return 'unknown';
            return this.getParticipantType({ id: id }, tournament);
        },

        /**
         * Get participant record from tournament.
         */
        getParticipantRecord: function(tournament, id) {
            return getParticipantRecord(tournament, id);
        },

        /**
         * Get data store helper.
         */
        getDataStore: function() {
            return getDataStore();
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
                    return match.status === 'completed' ? 'unknown' : 'pending';
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
                    name: this.getTournamentParticipantName(tournament, normalised),
                    outcome: 'pending',
                    isGroupExam: isGroupExam
                };

                if (isGroupExam) {
                    var resultValue = match.results && match.results[normalised];
                    if (resultValue === 'pass') {
                        display.outcome = 'passed';
                    } else if (resultValue === 'fail') {
                        display.outcome = 'failed';
                    } else if (match.status === 'completed') {
                        display.outcome = 'unknown';
                    } else {
                        display.outcome = 'pending';
                    }
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
        },

        /**
         * Get the week range for validation.
         * Returns { min: number, max: number }
         */
        getWeekRange: function() {
            return { min: MIN_WEEK, max: MAX_WEEK };
        },

        /**
         * Check if a week is valid.
         */
        isValidWeek: function(week) {
            var num = Number(week);
            return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
        },

        /**
         * Get the canonical participant type for a tournament mode.
         */
        getCanonicalParticipantType: function(mode) {
            return getCanonicalParticipantType(mode);
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsQueries = TournamentsQueries;

})();
