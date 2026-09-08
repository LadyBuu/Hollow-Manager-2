/**
 * shared/queries/tournament-queries.js - Tournament Queries
 * Read-only tournament domain queries
 * Path: js/shared/queries/tournament-queries.js
 * 
 * This module provides READ-ONLY access to tournament data.
 * All mutations go through tournaments-core.js
 * 
 * OWNERSHIP: Tournament domain
 * DEPENDENCIES: None (reads from window.data directly)
 * 
 * IMPORTANT: All getters return DEFENSIVE COPIES (clones)
 * to prevent external mutation of tournament data.
 */

(function() {
    'use strict';

    if (window.__tournamentQueriesLoaded) return;
    window.__tournamentQueriesLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') return value;
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function getDataStore() {
        return window.data || {};
    }

    function getTournamentArray() {
        var data = getDataStore();
        return Array.isArray(data.tournaments) ? data.tournaments : [];
    }

    // ============================================================
    // TOURNAMENT LOOKUP
    // ============================================================

    function getTournament(tournamentId) {
        if (!isNonEmptyString(tournamentId)) return null;
        var target = normaliseId(tournamentId);
        var tournaments = getTournamentArray();

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && normaliseId(t.id) === target) {
                return deepClone(t);
            }
        }
        return null;
    }

    function getTournaments(status) {
        var tournaments = getTournamentArray();
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t) continue;

            if (status) {
                if (t.status !== status) continue;
            }

            result.push(deepClone(t));
        }

        // Sort by creation date (newest first)
        result.sort(function(a, b) {
            var dateA = a.createdAt || '';
            var dateB = b.createdAt || '';
            return dateB.localeCompare(dateA);
        });

        return result;
    }

    function getActiveTournaments() {
        return getTournaments('active');
    }

    function getCompletedTournaments() {
        return getTournaments('completed');
    }

    function getDraftTournaments() {
        return getTournaments('draft');
    }

    // ============================================================
    // TOURNAMENT BY CLASS
    // ============================================================

    function getTournamentsByClass(classId, status) {
        if (!isNonEmptyString(classId)) return [];

        var tournaments = getTournaments(status);
        var target = normaliseId(classId);
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && normaliseId(t.graduatingClassId) === target) {
                result.push(t);
            }
        }

        return result;
    }

    // ============================================================
    // PARTICIPANT QUERIES
    // ============================================================

    function getParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return [];
        return Array.isArray(tournament.participants) ? deepClone(tournament.participants) : [];
    }

    function getParticipantCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return 0;
        return Array.isArray(tournament.participants) ? tournament.participants.length : 0;
    }

    function isParticipantInTournament(tournamentId, participantId) {
        var participants = getParticipants(tournamentId);
        var target = normaliseId(participantId);

        for (var i = 0; i < participants.length; i++) {
            if (normaliseId(participants[i].id) === target) {
                return true;
            }
        }
        return false;
    }

    function getParticipantTypeFromRecord(tournamentId, participantId) {
        var participants = getParticipants(tournamentId);
        var target = normaliseId(participantId);

        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (p && normaliseId(p.id) === target) {
                return p.type || null;
            }
        }
        return null;
    }

    function isParticipantEliminated(tournamentId, participantId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return false;

        var target = normaliseId(participantId);
        var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];

        for (var i = 0; i < eliminations.length; i++) {
            var e = eliminations[i];
            if (e && normaliseId(e.participantId) === target) {
                return true;
            }
        }
        return false;
    }

    function getActiveParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return [];

        var participants = Array.isArray(tournament.participants) ? tournament.participants : [];
        var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];
        var eliminatedIds = {};

        for (var i = 0; i < eliminations.length; i++) {
            var id = normaliseId(eliminations[i].participantId);
            if (id) eliminatedIds[id] = true;
        }

        var result = [];
        for (var j = 0; j < participants.length; j++) {
            var p = participants[j];
            if (p && !eliminatedIds[normaliseId(p.id)]) {
                result.push(deepClone(p));
            }
        }
        return result;
    }

    // ============================================================
    // ROUND QUERIES
    // ============================================================

    function getRounds(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return [];
        return Array.isArray(tournament.rounds) ? deepClone(tournament.rounds) : [];
    }

    function getRoundCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return 0;
        return Array.isArray(tournament.rounds) ? tournament.rounds.length : 0;
    }

    function getCurrentRound(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return 0;
        return Array.isArray(tournament.rounds) ? tournament.rounds.length : 0;
    }

    function getRound(tournamentId, roundIndex) {
        var rounds = getRounds(tournamentId);
        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0 || index >= rounds.length) return null;
        return deepClone(rounds[index]);
    }

    // ============================================================
    // MATCH QUERIES
    // ============================================================

    function getMatches(tournamentId, roundIndex) {
        var round = getRound(tournamentId, roundIndex);
        if (!round) return [];
        return Array.isArray(round.matches) ? deepClone(round.matches) : [];
    }

    function getMatch(tournamentId, roundIndex, matchIndex) {
        var matches = getMatches(tournamentId, roundIndex);
        var index = parseInt(matchIndex, 10);
        if (isNaN(index) || index < 0 || index >= matches.length) return null;
        return deepClone(matches[index]);
    }

    function getMatchCount(tournamentId, roundIndex) {
        var matches = getMatches(tournamentId, roundIndex);
        return matches.length;
    }

    function getMatchWinner(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) return null;
        return match.winner || null;
    }

    function getMatchLosers(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) return [];
        if (match.loser) return [match.loser];
        return [];
    }

    function getMatchAdvancing(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) return [];

        // Standard match: winner advances
        if (match.type === 'standard') {
            return match.winner ? [match.winner] : [];
        }

        // Group exam: participants with 'pass' advance
        if (match.type === 'group_exam') {
            var advancing = [];
            var results = match.results || {};
            var participants = match.participants || [];

            for (var i = 0; i < participants.length; i++) {
                var id = participants[i];
                if (results[id] === 'pass') {
                    advancing.push(id);
                }
            }
            return advancing;
        }

        return [];
    }

    // ============================================================
    // ELIMINATION QUERIES
    // ============================================================

    function getEliminations(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return [];
        return Array.isArray(tournament.eliminations) ? deepClone(tournament.eliminations) : [];
    }

    function getEliminationCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return 0;
        return Array.isArray(tournament.eliminations) ? tournament.eliminations.length : 0;
    }

    function getCharacterEliminations(tournamentId) {
        var eliminations = getEliminations(tournamentId);
        return eliminations.filter(function(e) {
            return e && e.participantType === 'character';
        });
    }

    function getTeamEliminations(tournamentId) {
        var eliminations = getEliminations(tournamentId);
        return eliminations.filter(function(e) {
            return e && e.participantType === 'team';
        });
    }

    // ============================================================
    // WINNER QUERIES
    // ============================================================

    function getWinner(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return null;
        return tournament.winner ? deepClone(tournament.winner) : null;
    }

    function getWinnerName(tournamentId) {
        var winner = getWinner(tournamentId);
        if (!winner) return 'Not determined';

        // Winner is a participant object with id and type
        // We need to resolve the name
        var character = window.CharacterQueries ?
            window.CharacterQueries.getCharacterById(winner.id) : null;

        if (character) {
            return window.CharacterQueries.getDisplayName(character);
        }

        var team = window.TeamQueries ?
            window.TeamQueries.getTeamById(winner.id) : null;

        if (team) {
            return team.name || 'Unknown Team';
        }

        return winner.id || 'Unknown';
    }

    // ============================================================
    // COMPLETION STATUS
    // ============================================================

    function isTournamentComplete(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) return false;

        if (tournament.status === 'completed') return true;

        var rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
        if (rounds.length === 0) return false;

        var allRoundsComplete = rounds.every(function(r) {
            return r && r.status === 'completed';
        });

        return allRoundsComplete && !!tournament.winner;
    }

    // ============================================================
    // TEAM TOURNAMENTS
    // ============================================================

    function getTournamentsForTeam(teamId, status) {
        if (!isNonEmptyString(teamId)) return [];

        var tournaments = getTournaments(status);
        var target = normaliseId(teamId);
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t || !Array.isArray(t.participants)) continue;

            var found = false;
            for (var j = 0; j < t.participants.length; j++) {
                if (normaliseId(t.participants[j].id) === target) {
                    found = true;
                    break;
                }
            }

            if (found) {
                result.push(t);
            }
        }

        return result;
    }

    function getTournamentTeams(tournamentId) {
        var participants = getParticipants(tournamentId);

        return participants.filter(function(p) {
            return p && p.type === 'team';
        }).map(function(p) {
            // Resolve team name if possible
            var team = window.TeamQueries ?
                window.TeamQueries.getTeamById(p.id) : null;

            return {
                id: p.id,
                name: team ? team.name : 'Unknown Team',
                type: 'team',
                eliminated: isParticipantEliminated(tournamentId, p.id)
            };
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentQueries = {
        // Tournament lookup
        getTournament: getTournament,
        getTournaments: getTournaments,
        getActiveTournaments: getActiveTournaments,
        getCompletedTournaments: getCompletedTournaments,
        getDraftTournaments: getDraftTournaments,
        getTournamentsByClass: getTournamentsByClass,

        // Participants
        getParticipants: getParticipants,
        getParticipantCount: getParticipantCount,
        isParticipantInTournament: isParticipantInTournament,
        getParticipantTypeFromRecord: getParticipantTypeFromRecord,
        isParticipantEliminated: isParticipantEliminated,
        getActiveParticipants: getActiveParticipants,

        // Rounds
        getRounds: getRounds,
        getRoundCount: getRoundCount,
        getCurrentRound: getCurrentRound,
        getRound: getRound,

        // Matches
        getMatches: getMatches,
        getMatch: getMatch,
        getMatchCount: getMatchCount,
        getMatchWinner: getMatchWinner,
        getMatchLosers: getMatchLosers,
        getMatchAdvancing: getMatchAdvancing,

        // Eliminations
        getEliminations: getEliminations,
        getEliminationCount: getEliminationCount,
        getCharacterEliminations: getCharacterEliminations,
        getTeamEliminations: getTeamEliminations,

        // Winner
        getWinner: getWinner,
        getWinnerName: getWinnerName,

        // Completion
        isTournamentComplete: isTournamentComplete,

        // Team associations
        getTournamentsForTeam: getTournamentsForTeam,
        getTournamentTeams: getTournamentTeams
    };

})();
