/**
 * modules/tournaments/tournament-queries.js - Tournament Queries
 * Canonical read boundary for tournament domain (IDs only)
 * Path: js/modules/tournaments/tournament-queries.js
 * 
 * This module provides READ-ONLY access to tournament data.
 * All mutations go through tournament-core.js or tournament-matches.js
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - IDs only API - no presentation methods (getWinnerName, getParticipantName)
 *   - Returns DEFENSIVE COPIES (deep clones) to prevent external mutation
 *   - No dependencies on Aggregator (Queries should not depend on Aggregator)
 *   - No dependencies on CharacterQueries, TeamQueries (those belong in Aggregator)
 *   - All methods accept IDs, not objects
 *   - No business logic (isTournamentComplete belongs in Lifecycle/Rules)
 *   - No UI/presentation formatting
 * 
 * API DESIGN:
 *   - getTournament(id) - Get a tournament by ID
 *   - getTournaments(filter) - Get tournaments with optional status filter
 *   - getActiveTournaments() - Get active tournaments
 *   - getCompletedTournaments() - Get completed tournaments
 *   - getDraftTournaments() - Get draft tournaments
 *   - getTournamentsByClass(classId, status) - Get tournaments by graduating class
 * 
 *   - getRounds(tournamentId) - Get rounds for a tournament
 *   - getRound(tournamentId, roundIndex) - Get a specific round
 *   - getRoundCount(tournamentId) - Get number of rounds
 * 
 *   - getMatches(tournamentId, roundIndex) - Get matches for a round
 *   - getMatch(tournamentId, roundIndex, matchIndex) - Get a specific match
 *   - getMatchCount(tournamentId, roundIndex) - Get number of matches
 *   - getMatchWinner(tournamentId, roundIndex, matchIndex) - Get winner ID (not name)
 *   - getMatchLosers(tournamentId, roundIndex, matchIndex) - Get loser IDs (not names)
 *   - getMatchAdvancing(tournamentId, roundIndex, matchIndex) - Get advancing participant IDs
 * 
 *   - getParticipants(tournamentId) - Get participants (defensive copies)
 *   - getParticipantCount(tournamentId) - Get participant count
 *   - isParticipantInTournament(tournamentId, participantId) - Check if participant is in tournament
 *   - getParticipantTypeFromRecord(tournamentId, participantId) - Get participant type
 *   - isParticipantEliminated(tournamentId, participantId) - Check if participant is eliminated
 *   - getActiveParticipants(tournamentId) - Get active participants (not eliminated)
 * 
 *   - getEliminations(tournamentId) - Get eliminations (defensive copies)
 *   - getEliminationCount(tournamentId) - Get elimination count
 *   - getCharacterEliminations(tournamentId) - Get character eliminations
 *   - getTeamEliminations(tournamentId) - Get team eliminations
 * 
 *   - getWinner(tournamentId) - Get winner object (id + type, not name)
 *   - getTournamentStatistics(tournamentId) - Read model statistics
 * 
 *   - getTournamentsForTeam(teamId, status) - Get tournaments for a team
 *   - getTournamentTeams(tournamentId) - Get teams in a tournament (resolved with TeamQueries)
 * 
 * DEPENDENCIES:
 *   - window.data (canonical storage)
 *   - window.ObjectUtils (deep cloning)
 *   - window.IdUtils (ID normalisation)
 *   - window.TournamentConstants (bounds)
 *   - window.TournamentSchema (normalisation)
 * 
 * USAGE:
 *   var Q = window.TournamentQueries;
 *   var tournament = Q.getTournament('tourn_123');
 *   var rounds = Q.getRounds('tourn_123');
 *   var participants = Q.getParticipants('tourn_123');
 *   var winner = Q.getWinner('tourn_123'); // returns { id: 'char_123', type: 'character' }
 */

(function() {
    'use strict';

    if (window.__tournamentQueriesLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    function getConstants() {
        return window.TournamentConstants || null;
    }

    function getSchema() {
        return window.TournamentSchema || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getObjectUtils()) {
            missing.push('ObjectUtils (lazy)');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils (lazy)');
        }
        if (!getConstants()) {
            missing.push('TournamentConstants (lazy)');
        }
        if (!getSchema()) {
            missing.push('TournamentSchema (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentQueries] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        var IdUtils = getIdUtils();
        if (IdUtils && typeof IdUtils.normaliseId === 'function') {
            return IdUtils.normaliseId(value);
        }
        if (value === null || value === undefined) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
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

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 0) {
            return null;
        }
        return num;
    }

    function getParticipantTypeFromTournament(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return null;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return null;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === id) {
                return p.type || null;
            }
        }
        return null;
    }

    function isParticipantInTournamentRecord(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === id) {
                return true;
            }
        }
        return false;
    }

    function isParticipantEliminatedRecord(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }
        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && normaliseId(e.participantId) === id) {
                return true;
            }
        }
        return false;
    }

    function getParticipantsRecord(tournament) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return tournament.participants.map(function(p) {
            return deepClone(p);
        }).filter(function(p) { return p !== null; });
    }

    function getRoundsRecord(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds.map(function(r) {
            return deepClone(r);
        }).filter(function(r) { return r !== null; });
    }

    function getEliminationsRecord(tournament) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }
        return tournament.eliminations.map(function(e) {
            return deepClone(e);
        }).filter(function(e) { return e !== null; });
    }

    // ============================================================
    // TOURNAMENT LOOKUP
    // ============================================================

    /**
     * Get a tournament by ID. Returns a defensive copy.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object|null} Tournament object or null
     */
    function getTournament(tournamentId) {
        if (!isNonEmptyString(tournamentId)) {
            return null;
        }
        var target = normaliseId(tournamentId);
        if (target === null) {
            return null;
        }

        var tournaments = getTournamentArray();
        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && normaliseId(t.id) === target) {
                return deepClone(t);
            }
        }
        return null;
    }

    /**
     * Get tournaments with optional status filter.
     * 
     * @param {string} status - Optional status filter ('active', 'completed', 'draft')
     * @returns {array} Array of tournament objects (defensive copies)
     */
    function getTournaments(status) {
        var tournaments = getTournamentArray();
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t) {
                continue;
            }

            if (status && t.status !== status) {
                continue;
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

    /**
     * Get active tournaments.
     * 
     * @returns {array} Array of active tournament objects
     */
    function getActiveTournaments() {
        return getTournaments('active');
    }

    /**
     * Get completed tournaments.
     * 
     * @returns {array} Array of completed tournament objects
     */
    function getCompletedTournaments() {
        return getTournaments('completed');
    }

    /**
     * Get draft tournaments.
     * 
     * @returns {array} Array of draft tournament objects
     */
    function getDraftTournaments() {
        return getTournaments('draft');
    }

    /**
     * Get tournaments by graduating class.
     * 
     * @param {string} classId - Graduating class ID
     * @param {string} status - Optional status filter
     * @returns {array} Array of tournament objects
     */
    function getTournamentsByClass(classId, status) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var tournaments = getTournaments(status);
        var target = normaliseId(classId);
        if (target === null) {
            return [];
        }

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
    // PARTICIPANT QUERIES (IDs only)
    // ============================================================

    /**
     * Get participants of a tournament (defensive copies).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of participant objects { id, type }
     */
    function getParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return [];
        }
        return getParticipantsRecord(tournament);
    }

    /**
     * Get participant count.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {number} Number of participants
     */
    function getParticipantCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return 0;
        }
        return Array.isArray(tournament.participants) ? tournament.participants.length : 0;
    }

    /**
     * Check if a participant is in a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {boolean} True if participant is in tournament
     */
    function isParticipantInTournament(tournamentId, participantId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return false;
        }
        return isParticipantInTournamentRecord(tournament, participantId);
    }

    /**
     * Get participant type from tournament record.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {string|null} Participant type ('character' or 'team') or null
     */
    function getParticipantTypeFromRecord(tournamentId, participantId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return null;
        }
        return getParticipantTypeFromTournament(tournament, participantId);
    }

    /**
     * Check if a participant is eliminated.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {boolean} True if eliminated
     */
    function isParticipantEliminated(tournamentId, participantId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return false;
        }
        return isParticipantEliminatedRecord(tournament, participantId);
    }

    /**
     * Get active participants (not eliminated).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of active participant objects
     */
    function getActiveParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return [];
        }

        var participants = Array.isArray(tournament.participants) ? tournament.participants : [];
        var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];
        var eliminatedIds = {};

        for (var i = 0; i < eliminations.length; i++) {
            var id = normaliseId(eliminations[i].participantId);
            if (id !== null) {
                eliminatedIds[id] = true;
            }
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

    /**
     * Get rounds for a tournament (defensive copies).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of round objects
     */
    function getRounds(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return [];
        }
        return getRoundsRecord(tournament);
    }

    /**
     * Get a specific round (defensive copy).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @returns {object|null} Round object or null
     */
    function getRound(tournamentId, roundIndex) {
        var rounds = getRounds(tournamentId);
        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0 || index >= rounds.length) {
            return null;
        }
        return rounds[index];
    }

    /**
     * Get the number of rounds.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {number} Number of rounds
     */
    function getRoundCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return 0;
        }
        return Array.isArray(tournament.rounds) ? tournament.rounds.length : 0;
    }

    /**
     * Get the current round number (derived from rounds.length).
     * This is a QUERY, not a stored value.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {number} Current round number
     */
    function getCurrentRound(tournamentId) {
        var rounds = getRounds(tournamentId);
        return rounds.length;
    }

    // ============================================================
    // MATCH QUERIES (IDs only)
    // ============================================================

    /**
     * Get matches for a round (defensive copies).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @returns {array} Array of match objects
     */
    function getMatches(tournamentId, roundIndex) {
        var round = getRound(tournamentId, roundIndex);
        if (!round || !Array.isArray(round.matches)) {
            return [];
        }
        return round.matches.map(function(m) {
            return deepClone(m);
        }).filter(function(m) { return m !== null; });
    }

    /**
     * Get a specific match (defensive copy).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @param {number} matchIndex - Index of the match (0-based)
     * @returns {object|null} Match object or null
     */
    function getMatch(tournamentId, roundIndex, matchIndex) {
        var matches = getMatches(tournamentId, roundIndex);
        var index = parseInt(matchIndex, 10);
        if (isNaN(index) || index < 0 || index >= matches.length) {
            return null;
        }
        return matches[index];
    }

    /**
     * Get the number of matches in a round.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @returns {number} Number of matches
     */
    function getMatchCount(tournamentId, roundIndex) {
        var matches = getMatches(tournamentId, roundIndex);
        return matches.length;
    }

    /**
     * Get the winner ID of a match (not name).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @param {number} matchIndex - Index of the match (0-based)
     * @returns {string|null} Winner ID or null
     */
    function getMatchWinner(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return null;
        }
        return match.winner || null;
    }

    /**
     * Get the loser IDs of a match (not names).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @param {number} matchIndex - Index of the match (0-based)
     * @returns {array} Array of loser IDs
     */
    function getMatchLosers(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return [];
        }
        if (match.loser) {
            return [match.loser];
        }
        return [];
    }

    /**
     * Get advancing participant IDs from a match (not names).
     * ALWAYS derives from the current match state.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @param {number} matchIndex - Index of the match (0-based)
     * @returns {array} Array of advancing participant IDs
     */
    function getMatchAdvancing(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return [];
        }

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

    /**
     * Check if a match is complete.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round (0-based)
     * @param {number} matchIndex - Index of the match (0-based)
     * @returns {boolean} True if complete
     */
    function isMatchComplete(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return false;
        }
        return match.status === 'completed';
    }

    // ============================================================
    // ELIMINATION QUERIES
    // ============================================================

    /**
     * Get eliminations from a tournament (defensive copies).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of elimination records
     */
    function getEliminations(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return [];
        }
        return getEliminationsRecord(tournament);
    }

    /**
     * Get elimination count.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {number} Number of eliminations
     */
    function getEliminationCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return 0;
        }
        return Array.isArray(tournament.eliminations) ? tournament.eliminations.length : 0;
    }

    /**
     * Get character eliminations (filtered by participantType).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of character elimination records
     */
    function getCharacterEliminations(tournamentId) {
        var eliminations = getEliminations(tournamentId);
        return eliminations.filter(function(e) {
            return e && e.participantType === 'character';
        });
    }

    /**
     * Get team eliminations (filtered by participantType).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of team elimination records
     */
    function getTeamEliminations(tournamentId) {
        var eliminations = getEliminations(tournamentId);
        return eliminations.filter(function(e) {
            return e && e.participantType === 'team';
        });
    }

    // ============================================================
    // WINNER QUERIES (IDs only, not names)
    // ============================================================

    /**
     * Get the winner of a tournament (defensive copy).
     * Returns { id, type } only, not the resolved name.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object|null} Winner object { id, type } or null
     */
    function getWinner(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !tournament.winner) {
            return null;
        }
        return deepClone(tournament.winner);
    }

    /**
     * Get the winner ID of a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {string|null} Winner ID or null
     */
    function getWinnerId(tournamentId) {
        var winner = getWinner(tournamentId);
        if (!winner) {
            return null;
        }
        return winner.id || null;
    }

    /**
     * Get the winner type of a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {string|null} Winner type ('character' or 'team') or null
     */
    function getWinnerType(tournamentId) {
        var winner = getWinner(tournamentId);
        if (!winner) {
            return null;
        }
        return winner.type || null;
    }

    // ============================================================
    // STATISTICS (Read model)
    // ============================================================

    /**
     * Get tournament statistics (read model).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object} Statistics object
     */
    function getTournamentStatistics(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return {
                participantCount: 0,
                roundCount: 0,
                matchCount: 0,
                eliminationCount: 0,
                hasWinner: false,
                winnerId: null,
                winnerType: null
            };
        }

        var participants = Array.isArray(tournament.participants) ? tournament.participants : [];
        var rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
        var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];

        var matchCount = 0;
        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (round && Array.isArray(round.matches)) {
                matchCount += round.matches.length;
            }
        }

        var winner = tournament.winner || null;

        return {
            participantCount: participants.length,
            roundCount: rounds.length,
            matchCount: matchCount,
            eliminationCount: eliminations.length,
            hasWinner: !!winner,
            winnerId: winner ? winner.id : null,
            winnerType: winner ? winner.type : null
        };
    }

    // ============================================================
    // TEAM ASSOCIATIONS
    // ============================================================

    /**
     * Get tournaments for a team.
     * 
     * @param {string} teamId - Team ID
     * @param {string} status - Optional status filter
     * @returns {array} Array of tournament objects
     */
    function getTournamentsForTeam(teamId, status) {
        if (!isNonEmptyString(teamId)) {
            return [];
        }

        var tournaments = getTournaments(status);
        var target = normaliseId(teamId);
        if (target === null) {
            return [];
        }

        var result = [];
        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t || !Array.isArray(t.participants)) {
                continue;
            }

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

    /**
     * Get teams in a tournament (resolved with TeamQueries).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of team objects with id, name, type, eliminated
     */
    function getTournamentTeams(tournamentId) {
        var participants = getParticipants(tournamentId);
        var TeamQueries = getTeamQueries();

        return participants.filter(function(p) {
            return p && p.type === 'team';
        }).map(function(p) {
            var team = TeamQueries ? TeamQueries.getTeamById(p.id) : null;
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
        getRound: getRound,
        getRoundCount: getRoundCount,
        getCurrentRound: getCurrentRound,

        // Matches
        getMatches: getMatches,
        getMatch: getMatch,
        getMatchCount: getMatchCount,
        getMatchWinner: getMatchWinner,
        getMatchLosers: getMatchLosers,
        getMatchAdvancing: getMatchAdvancing,
        isMatchComplete: isMatchComplete,

        // Eliminations
        getEliminations: getEliminations,
        getEliminationCount: getEliminationCount,
        getCharacterEliminations: getCharacterEliminations,
        getTeamEliminations: getTeamEliminations,

        // Winner
        getWinner: getWinner,
        getWinnerId: getWinnerId,
        getWinnerType: getWinnerType,

        // Statistics
        getTournamentStatistics: getTournamentStatistics,

        // Team associations
        getTournamentsForTeam: getTournamentsForTeam,
        getTournamentTeams: getTournamentTeams
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentQueries;
        var missing = [];

        var required = [
            'getTournament', 'getTournaments', 'getActiveTournaments',
            'getCompletedTournaments', 'getDraftTournaments', 'getTournamentsByClass',
            'getParticipants', 'getParticipantCount', 'isParticipantInTournament',
            'getParticipantTypeFromRecord', 'isParticipantEliminated', 'getActiveParticipants',
            'getRounds', 'getRound', 'getRoundCount', 'getCurrentRound',
            'getMatches', 'getMatch', 'getMatchCount',
            'getMatchWinner', 'getMatchLosers', 'getMatchAdvancing', 'isMatchComplete',
            'getEliminations', 'getEliminationCount',
            'getCharacterEliminations', 'getTeamEliminations',
            'getWinner', 'getWinnerId', 'getWinnerType',
            'getTournamentStatistics',
            'getTournamentsForTeam', 'getTournamentTeams'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentQueries] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentQueries] All exports verified successfully.');
        }
    })();

})();
