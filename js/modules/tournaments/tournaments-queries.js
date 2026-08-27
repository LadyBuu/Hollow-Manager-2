/**
 * js/modules/tournaments/tournaments-queries.js - Tournament Queries
 * PURE read-only queries. Does NOT mutate data.
 * Path: js/modules/tournaments/tournaments-queries.js
 */

(function() {
    'use strict';

    if (window.__tournamentsQueriesLoaded) return;
    window.__tournamentsQueriesLoaded = true;

    if (!window.TournamentsCore) {
        console.error('TournamentsQueries: TournamentsCore required.');
        return;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        return window.data;
    }

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
         * Get participant name using the participant's declared type.
         */
        getParticipantName: function(participant) {
            if (!participant) return 'Unknown';

            var id = typeof participant === 'object' ? participant.id : participant;
            if (!id) return 'Unknown';

            var type = typeof participant === 'object' ? participant.type : null;

            var data = getDataStore();
            if (!data) return 'Unknown';

            // Use declared type if available
            if (type === 'team' && Array.isArray(data.teams)) {
                var team = data.teams.find(function(t) {
                    return t && String(t.id) === String(id);
                });
                if (team) return team.name || 'Unknown Team';
                return 'Unknown Team';
            }

            if (type === 'character' && Array.isArray(data.characters)) {
                var char = data.characters.find(function(c) {
                    return c && String(c.id) === String(id);
                });
                if (char) {
                    return window.getDisplayName ? window.getDisplayName(char) : char.name || 'Unknown';
                }
                return 'Unknown Character';
            }

            // Fallback: search both
            if (Array.isArray(data.characters)) {
                var char = data.characters.find(function(c) {
                    return c && String(c.id) === String(id);
                });
                if (char) {
                    return window.getDisplayName ? window.getDisplayName(char) : char.name || 'Unknown';
                }
            }

            if (Array.isArray(data.teams)) {
                var team = data.teams.find(function(t) {
                    return t && String(t.id) === String(id);
                });
                if (team) return team.name || 'Unknown Team';
            }

            return 'Unknown';
        },

        /**
         * Get participant type.
         */
        getParticipantType: function(id) {
            if (!id) return 'unknown';
            var data = getDataStore();
            if (!data) return 'unknown';

            if (Array.isArray(data.characters) && data.characters.some(function(c) {
                return c && String(c.id) === String(id);
            })) {
                return 'character';
            }

            if (Array.isArray(data.teams) && data.teams.some(function(t) {
                return t && String(t.id) === String(id);
            })) {
                return 'team';
            }

            return 'unknown';
        },

        /**
         * Get participants for a round.
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
                        if (id && participants.indexOf(id) === -1) {
                            participants.push(id);
                        }
                    });
                }
            });

            return participants;
        },

        /**
         * Get participant status in a round.
         */
        getParticipantRoundStatus: function(tournament, roundIndex, participantId) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 'unknown';
            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) return 'unknown';

            var round = tournament.rounds[roundIndex];
            if (!round || !Array.isArray(round.matches)) return 'unknown';

            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (!match || !Array.isArray(match.participants)) continue;

                if (match.participants.some(function(id) {
                    return id && String(id) === String(participantId);
                })) {
                    if (match.type === 'group_exam') {
                        var result = match.results && match.results[participantId];
                        if (result === 'pass') return 'passed';
                        if (result === 'fail') return 'failed';
                        return 'pending';
                    }

                    if (match.winner && String(match.winner) === String(participantId)) {
                        return 'winner';
                    }
                    if (match.loser && String(match.loser) === String(participantId)) {
                        return 'eliminated';
                    }
                    if (match.advancing && match.advancing.some(function(id) {
                        return id && String(id) === String(participantId);
                    })) {
                        return 'advancing';
                    }
                    if (match.status === 'completed') {
                        return 'advancing';
                    }
                    return 'pending';
                }
            }

            // Check if eliminated globally
            if (Array.isArray(tournament.eliminations)) {
                var isEliminated = tournament.eliminations.some(function(e) {
                    return e && String(e.participantId) === String(participantId);
                });
                if (isEliminated) return 'eliminated';
            }

            return 'unknown';
        },

        /**
         * Get round status summary.
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
         * Get tournament winner display name.
         */
        getWinnerName: function(tournament) {
            if (!tournament || !tournament.winner) return 'Not determined';
            return this.getParticipantName(tournament.winner);
        },

        /**
         * Check if tournament is complete.
         */
        isTournamentComplete: function(tournament) {
            if (!tournament) return false;
            if (tournament.status === 'completed') return true;

            // Also check rounds
            if (!Array.isArray(tournament.rounds) || tournament.rounds.length === 0) {
                return false;
            }

            var allComplete = tournament.rounds.every(function(r) {
                return r.status === 'completed';
            });

            return allComplete && tournament.winner;
        }
    };

    window.TournamentsQueries = TournamentsQueries;

})();
