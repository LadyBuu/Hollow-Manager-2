/**
 * js/modules/tournaments/tournaments-core.js - Core Tournament Functions
 * Handles tournament CRUD operations and core logic
 * Path: js/modules/tournaments/tournaments-core.js
 */

(function() {
    'use strict';

    function getTournament(id) {
        var data = window.data || {};
        if (!data.tournaments) return null;
        var tourn = data.tournaments.find(function(t) { return String(t.id) === String(id); });
        if (tourn) {
            ensureTournamentIntegrity(tourn);
        }
        return tourn;
    }

    function getTournaments() {
        var data = window.data || {};
        if (!data.tournaments) {
            data.tournaments = [];
            return [];
        }
        data.tournaments.forEach(function(tourn) {
            ensureTournamentIntegrity(tourn);
        });
        return data.tournaments;
    }

    function ensureTournamentIntegrity(tourn) {
        if (!tourn) return;
        if (!tourn.mode) tourn.mode = 'teams';
        if (!tourn.participants || !Array.isArray(tourn.participants)) tourn.participants = [];
        if (!tourn.rounds || !Array.isArray(tourn.rounds)) tourn.rounds = [];
        if (!tourn.eliminations || !Array.isArray(tourn.eliminations)) tourn.eliminations = [];
        if (!tourn.winners || !Array.isArray(tourn.winners)) tourn.winners = [];
        if (!tourn.status) tourn.status = 'draft';
        if (!tourn.totalRounds) tourn.totalRounds = 1;
        if (!tourn.startWeek) tourn.startWeek = 1;
        if (!tourn.endWeek) tourn.endWeek = 52;
        if (!tourn.teams || !Array.isArray(tourn.teams)) tourn.teams = [];
        if (!tourn.matches || !Array.isArray(tourn.matches)) tourn.matches = [];
        if (!tourn.currentRound) tourn.currentRound = 0;
        if (!tourn.createdAt) tourn.createdAt = new Date().toISOString();
    }

    function createTournament(tournData) {
        var data = window.data || {};
        if (!data.tournaments) data.tournaments = [];

        var newTourn = {
            id: window.generateId('tourn'),
            name: tournData.name || 'New Tournament',
            mode: tournData.mode || 'teams',
            startWeek: parseInt(tournData.startWeek) || 1,
            endWeek: parseInt(tournData.endWeek) || 52,
            totalRounds: parseInt(tournData.totalRounds) || 1,
            currentRound: 0,
            status: 'draft',
            participants: [],
            teams: [],
            rounds: [],
            matches: [],
            eliminations: [],
            winner: null,
            winners: [],
            createdAt: new Date().toISOString()
        };
        data.tournaments.push(newTourn);
        
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        
        return newTourn;
    }

    function updateTournament(id, updates) {
        var tourn = getTournament(id);
        if (!tourn) return null;

        var existingParticipants = tourn.participants || [];
        var existingRounds = tourn.rounds || [];
        var existingEliminations = tourn.eliminations || [];
        var existingWinner = tourn.winner || null;
        var existingWinners = tourn.winners || [];
        var existingMode = tourn.mode || 'teams';

        Object.assign(tourn, updates);

        if (!tourn.mode) tourn.mode = existingMode;
        if (!tourn.participants || !Array.isArray(tourn.participants)) tourn.participants = existingParticipants;
        if (!tourn.rounds || !Array.isArray(tourn.rounds)) tourn.rounds = existingRounds;
        if (!tourn.eliminations || !Array.isArray(tourn.eliminations)) tourn.eliminations = existingEliminations;
        if (!tourn.winner) tourn.winner = existingWinner;
        if (!tourn.winners || !Array.isArray(tourn.winners)) tourn.winners = existingWinners;

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }

        return tourn;
    }

    function deleteTournament(id) {
        if (!confirm('Delete this tournament permanently?')) return false;
        var data = window.data || {};
        if (!data.tournaments) return false;

        var tourn = data.tournaments.find(function(t) { return String(t.id) === String(id); });
        if (!tourn) return false;

        var tournName = tourn.name;
        data.tournaments = data.tournaments.filter(function(t) { return String(t.id) !== String(id); });

        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted tournament: ' + tournName);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function getParticipantName(id) {
        if (!id) return 'Unknown';
        var data = window.data || {};

        var char = data.characters ? data.characters.find(function(c) { return String(c.id) === String(id); }) : null;
        if (char) {
            return window.getDisplayName(char);
        }

        var team = data.teams ? data.teams.find(function(t) { return String(t.id) === String(id); }) : null;
        if (team) {
            return team.name;
        }

        return 'Unknown';
    }

    function getParticipantType(id) {
        if (!id) return 'unknown';
        var data = window.data || {};
        if (data.characters && data.characters.some(function(c) { return String(c.id) === String(id); })) return 'character';
        if (data.teams && data.teams.some(function(t) { return String(t.id) === String(id); })) return 'team';
        return 'unknown';
    }

    function getTournamentStatusColor(status) {
        var map = {
            'draft': 'var(--text-dim)',
            'active': 'var(--accent)',
            'completed': 'var(--info)'
        };
        return map[status] || 'var(--text-dim)';
    }

    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;
        if (char.deceased) return true;
        if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
            var weekNum = parseInt(week) || 1;
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parseInt(char.eliminatedWeeks[i]);
                if (!isNaN(elimWeek) && elimWeek <= weekNum) {
                    return true;
                }
            }
        }
        return false;
    }

    function ensureTournamentArrays(tourn) {
        if (!tourn) return;
        if (!tourn.participants || !Array.isArray(tourn.participants)) tourn.participants = [];
        if (!tourn.rounds || !Array.isArray(tourn.rounds)) tourn.rounds = [];
        if (!tourn.eliminations || !Array.isArray(tourn.eliminations)) tourn.eliminations = [];
        if (!tourn.winners || !Array.isArray(tourn.winners)) tourn.winners = [];
        if (!tourn.teams || !Array.isArray(tourn.teams)) tourn.teams = [];
        if (!tourn.matches || !Array.isArray(tourn.matches)) tourn.matches = [];
        if (!tourn.mode) tourn.mode = 'teams';
    }

    function markCharacterEliminated(charId, tournament, reason) {
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            return;
        }

        var weekNum = tournament ? (parseInt(tournament.startWeek) || 1) : 1;
        var tournamentId = tournament ? tournament.id : null;

        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];
        if (char.eliminatedWeeks.indexOf(weekNum) === -1) {
            char.eliminatedWeeks.push(weekNum);
            char.eliminatedWeeks.sort(function(a, b) { return parseInt(a) - parseInt(b); });
        }

        if (!char.eliminations) char.eliminations = [];
        var alreadyExists = char.eliminations.some(function(e) {
            return !e.standalone && String(e.tournamentId) === String(tournamentId);
        });
        if (!alreadyExists) {
            char.eliminations.push({
                tournamentId: tournamentId,
                week: weekNum,
                reason: reason || 'Eliminated from tournament',
                standalone: false,
                fromMatch: true
            });
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    function unmarkCharacterEliminated(charId, tournament) {
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            return;
        }

        var tournamentId = tournament ? tournament.id : null;
        var weekNum = tournament ? (parseInt(tournament.startWeek) || 1) : 1;

        if (char.eliminatedWeeks) {
            var idx = char.eliminatedWeeks.indexOf(weekNum);
            if (idx !== -1) {
                char.eliminatedWeeks.splice(idx, 1);
            }
        }

        if (char.eliminations) {
            char.eliminations = char.eliminations.filter(function(e) {
                return !(String(e.tournamentId) === String(tournamentId) && !e.standalone);
            });
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    function checkRoundStatuses(tourn) {
        if (!tourn.rounds || tourn.rounds.length === 0) return;

        var allCompleted = true;

        for (var i = 0; i < tourn.rounds.length; i++) {
            var round = tourn.rounds[i];
            if (!round.matches || round.matches.length === 0) {
                round.status = 'pending';
                allCompleted = false;
                continue;
            }

            var roundCompleted = true;
            for (var j = 0; j < round.matches.length; j++) {
                if (round.matches[j].status !== 'completed') {
                    roundCompleted = false;
                    allCompleted = false;
                    break;
                }
            }
            round.status = roundCompleted ? 'completed' : 'pending';
        }

        if (allCompleted && tourn.rounds.length > 0) {
            var allRoundsComplete = true;
            for (var i = 0; i < tourn.rounds.length; i++) {
                if (tourn.rounds[i].status !== 'completed') {
                    allRoundsComplete = false;
                    break;
                }
            }
            if (allRoundsComplete) {
                tourn.status = 'completed';
                var lastRound = tourn.rounds[tourn.rounds.length - 1];
                if (lastRound.matches && lastRound.matches.length > 0) {
                    var winners = [];
                    lastRound.matches.forEach(function(m) {
                        if (m.winner) winners.push(m.winner);
                    });
                    if (winners.length === 1) {
                        tourn.winner = winners[0];
                    } else if (winners.length > 1) {
                        tourn.winners = winners;
                        tourn.winner = winners[0];
                    }
                }
            }
        } else if (tourn.rounds.length > 0 && tourn.status === 'draft') {
            tourn.status = 'active';
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    function getRoundParticipants(tourn, roundIndex) {
        var round = tourn.rounds[roundIndex];
        var participants = [];

        if (round && round.matches) {
            round.matches.forEach(function(match) {
                if (match.participants) {
                    match.participants.forEach(function(id) {
                        if (participants.indexOf(id) === -1) {
                            participants.push(id);
                        }
                    });
                }
            });
        }

        return participants;
    }

    function getParticipantRoundStatus(tourn, roundIndex, participantId) {
        var round = tourn.rounds[roundIndex];
        if (!round || !round.matches) return 'unknown';

        for (var i = 0; i < round.matches.length; i++) {
            var match = round.matches[i];
            if (match.participants && match.participants.some(function(id) { return String(id) === String(participantId); })) {

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
                if (match.advancing && match.advancing.some(function(id) { return String(id) === String(participantId); })) {
                    return 'advancing';
                }
                if (match.status === 'completed') {
                    return 'advancing';
                }
                return 'pending';
            }
        }

        if (tourn.eliminations) {
            var isEliminated = tourn.eliminations.some(function(e) { return String(e.participantId) === String(participantId); });
            if (isEliminated) return 'eliminated';
        }

        return 'unknown';
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    document.addEventListener('dataReady', function() {
        // Ensure tournaments data exists
        if (window.data && !window.data.tournaments) {
            window.data.tournaments = [];
        }
    });

    if (window.data && !window.data.tournaments) {
        window.data.tournaments = [];
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.getTournament = getTournament;
    window.getTournaments = getTournaments;
    window.createTournament = createTournament;
    window.updateTournament = updateTournament;
    window.deleteTournament = deleteTournament;
    window.getParticipantName = getParticipantName;
    window.getParticipantType = getParticipantType;
    window.getTournamentStatusColor = getTournamentStatusColor;
    window.isCharacterEliminatedByWeek = isCharacterEliminatedByWeek;
    window.ensureTournamentArrays = ensureTournamentArrays;
    window.ensureTournamentIntegrity = ensureTournamentIntegrity;
    window.markCharacterEliminated = markCharacterEliminated;
    window.unmarkCharacterEliminated = unmarkCharacterEliminated;
    window.checkRoundStatuses = checkRoundStatuses;
    window.getRoundParticipants = getRoundParticipants;
    window.getParticipantRoundStatus = getParticipantRoundStatus;

    console.log('tournaments-core.js loaded');

})();
