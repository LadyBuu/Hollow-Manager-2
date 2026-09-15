/**
 * modules/shared/queries/tournament-queries.js - Tournament Queries
 * Read-only facade for tournament data.
 *
 * Path: js/modules/shared/queries/tournament-queries.js
 *
 * RESPONSIBILITIES:
 *   - Tournament read access (getTournament, getTournaments, ...)
 *   - Participant read access
 *   - Round and match read access BY ID
 *   - Elimination read access
 *   - Result-map accessors
 *   - Final passers derivation
 *   - Type/status lookups
 *
 * IDENTITY:
 *   Rounds and matches are identified by stable IDs, not indices.
 *   Every round- and match-scoped query takes the ID. Resolution goes
 *   through TournamentSchema.findRoundById / findMatchById.
 *
 *   The index-based versions of these functions (getRound with an
 *   index, getMatch with two indices) are GONE. Callers that need
 *   positional ordering use the `index` field on the returned VM or
 *   the `getRoundIndex` helper.
 *
 * IMPORTANT:
 *   - READ ONLY. This module never mutates data.
 *   - Returns defensive copies unless documented otherwise.
 *   - Does NOT own tournament data. The store is window.data.tournaments.
 *   - No UI dependencies, no mutation pipeline calls.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated from this tournament
 *
 * DEPRECATED FIELDS:
 *   - tournament.winner: accepted on read. Always null on new data.
 *   - match.winner / match.loser: accepted on read. Always null on
 *     new data. Only meaningful for legacy 'standard' matches.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TournamentSchema
 *   - window.ObjectUtils
 *   - window.IdUtils
 *
 * USAGE:
 *   var Queries = window.TournamentQueries;
 *
 *   var tournament = Queries.getTournament('tourn_123');
 *   var rounds = Queries.getRounds('tourn_123');
 *   var round = Queries.getRound('tourn_123', 'round_abc');
 *   var match = Queries.getMatch('tourn_123', 'round_abc', 'match_xyz');
 *   var passers = Queries.getFinalPassers('tourn_123');
 */

(function() {
    'use strict';

    if (window.__tournamentQueriesLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Schema = window.TournamentSchema;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;

    var _missing = [];

    if (!Schema || typeof Schema.findRoundById !== 'function') {
        _missing.push('TournamentSchema.findRoundById');
    }
    if (!Schema || typeof Schema.findMatchById !== 'function') {
        _missing.push('TournamentSchema.findMatchById');
    }
    if (!Schema || typeof Schema.deriveAdvancing !== 'function') {
        _missing.push('TournamentSchema.deriveAdvancing');
    }
    if (!Schema || typeof Schema.deriveFinalPassers !== 'function') {
        _missing.push('TournamentSchema.deriveFinalPassers');
    }
    if (!Schema || typeof Schema.isValidStatus !== 'function') {
        _missing.push('TournamentSchema.isValidStatus');
    }
    if (!Schema || typeof Schema.isValidMatchType !== 'function') {
        _missing.push('TournamentSchema.isValidMatchType');
    }
    if (!Schema || typeof Schema.isValidResult !== 'function') {
        _missing.push('TournamentSchema.isValidResult');
    }
    if (!Schema || typeof Schema.normaliseId !== 'function') {
        _missing.push('TournamentSchema.normaliseId');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentQueries] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentQueriesLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        return Schema.normaliseId(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[TournamentQueries] deepClone aliased the input.'
            );
        }
        return result;
    }

    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!Array.isArray(window.data.tournaments)) {
            return null;
        }
        return window.data.tournaments;
    }

    function parseWeek(value) {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1 || num > 52) {
            return null;
        }
        return num;
    }

    // ============================================================
    // TOURNAMENT READS
    // ============================================================

    function getTournament(id) {
        var normalised = normaliseId(id);
        if (normalised === null) {
            return null;
        }

        var store = getStore();
        if (!store) {
            return null;
        }

        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (t && normaliseId(t.id) === normalised) {
                return deepClone(t);
            }
        }
        return null;
    }

    function getTournaments(status) {
        var store = getStore();
        if (!store) {
            return [];
        }

        var filterStatus = isNonEmptyString(status) ? status : null;
        var result = [];

        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (!t) { continue; }
            if (filterStatus && t.status !== filterStatus) { continue; }
            result.push(deepClone(t));
        }

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

    function getTournamentsByClass(classId) {
        var normalised = normaliseId(classId);
        if (normalised === null) {
            return [];
        }

        var store = getStore();
        if (!store) {
            return [];
        }

        var result = [];
        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (!t) { continue; }
            if (normaliseId(t.graduatingClassId) !== normalised) {
                continue;
            }
            result.push(deepClone(t));
        }
        return result;
    }

    function getTournamentsForWeek(week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var store = getStore();
        if (!store) {
            return [];
        }

        var result = [];
        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (!t) { continue; }
            var start = parseWeek(t.startWeek);
            var end = parseWeek(t.endWeek);
            if (start === null || end === null) { continue; }
            if (weekNum >= start && weekNum <= end) {
                result.push(deepClone(t));
            }
        }
        return result;
    }

    function getExamForClassAndWeek(classId, week) {
        var normalised = normaliseId(classId);
        if (normalised === null) {
            return null;
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var store = getStore();
        if (!store) {
            return null;
        }

        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (!t) { continue; }
            if (normaliseId(t.graduatingClassId) !== normalised) {
                continue;
            }
            var start = parseWeek(t.startWeek);
            var end = parseWeek(t.endWeek);
            if (start === null || end === null) { continue; }
            if (weekNum >= start && weekNum <= end) {
                return deepClone(t);
            }
        }
        return null;
    }

    // ============================================================
    // PARTICIPANT READS
    // ============================================================

    function getParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return tournament.participants.slice();
    }

    function getParticipantCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return 0;
        }
        return tournament.participants.length;
    }

    function getParticipantIds(tournamentId) {
        var participants = getParticipants(tournamentId);
        var result = [];
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (p && p.id) {
                result.push(p.id);
            }
        }
        return result;
    }

    function getParticipant(tournamentId, participantId) {
        var normalised = normaliseId(participantId);
        if (normalised === null) {
            return null;
        }
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return null;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === normalised) {
                return deepClone(p);
            }
        }
        return null;
    }

    function getParticipantTypeFromRecord(tournamentId, participantId) {
        var normalised = normaliseId(participantId);
        if (normalised === null) {
            return null;
        }
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return null;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === normalised) {
                return p.type || null;
            }
        }
        return null;
    }

    function isParticipantInTournament(tournamentId, participantId, participantType) {
        var normalised = normaliseId(participantId);
        if (normalised === null) {
            return false;
        }
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!p) { continue; }
            if (normaliseId(p.id) === normalised) {
                if (participantType !== undefined &&
                    participantType !== null) {
                    if (p.type === participantType) { return true; }
                } else {
                    return true;
                }
            }
        }
        return false;
    }

    function getActiveParticipants(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!p) { continue; }
            if (!isParticipantEliminated(tournamentId, p.id)) {
                result.push(deepClone(p));
            }
        }
        return result;
    }

    // ============================================================
    // ROUND READS - BY ID
    // ============================================================

    function getRounds(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds.slice();
    }

    function getRoundCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return 0;
        }
        return tournament.rounds.length;
    }

    /**
     * Get a round by its stable id.
     * @returns {object|null} A defensive clone, or null.
     */
    function getRound(tournamentId, roundId) {
        var normalisedRound = normaliseId(roundId);
        if (normalisedRound === null) {
            return null;
        }
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return null;
        }
        var round = Schema.findRoundById(tournament, normalisedRound);
        return round ? deepClone(round) : null;
    }

    /**
     * Get a round's positional index within the tournament.
     * Returns -1 if not found.
     *
     * This is a display-order helper. It is NOT the round's identity.
     */
    function getRoundIndex(tournamentId, roundId) {
        var normalisedRound = normaliseId(roundId);
        if (normalisedRound === null) {
            return -1;
        }
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return -1;
        }
        return Schema.findRoundIndexById(tournament, normalisedRound);
    }

    // ============================================================
    // MATCH READS - BY ID
    // ============================================================

    /**
     * Get a round's matches.
     * @param {string} tournamentId
     * @param {string} roundId
     * @returns {array} Array of match records (clones of the round's
     *   live matches).
     */
    function getMatches(tournamentId, roundId) {
        var round = getRound(tournamentId, roundId);
        if (!round || !Array.isArray(round.matches)) {
            return [];
        }
        return round.matches.slice();
    }

    /**
     * Get a single match by its stable id.
     * @returns {object|null} A defensive clone, or null.
     */
    function getMatch(tournamentId, roundId, matchId) {
        var normalisedMatch = normaliseId(matchId);
        if (normalisedMatch === null) {
            return null;
        }
        var round = getRound(tournamentId, roundId);
        if (!round || !Array.isArray(round.matches)) {
            return null;
        }
        var match = Schema.findMatchById(round, normalisedMatch);
        return match ? deepClone(match) : null;
    }

    /**
     * Get a match's positional index within a round.
     * Returns -1 if not found.
     *
     * This is a display-order helper. It is NOT the match's identity.
     */
    function getMatchIndex(tournamentId, roundId, matchId) {
        var normalisedMatch = normaliseId(matchId);
        if (normalisedMatch === null) {
            return -1;
        }
        var round = getRound(tournamentId, roundId);
        if (!round || !Array.isArray(round.matches)) {
            return -1;
        }
        return Schema.findMatchIndexById(round, normalisedMatch);
    }

    function getMatchCount(tournamentId, roundId) {
        return getMatches(tournamentId, roundId).length;
    }

    function isMatchComplete(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return false; }
        return match.status === 'completed';
    }

    /**
     * @deprecated No winner concept anymore. Returns null on new data.
     */
    function getMatchWinner(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return null; }
        return match.winner || null;
    }

    /**
     * Get the raw result value for a participant in a match.
     * Returns 'pass' | 'fail' | 'retry' | null.
     */
    function getParticipantResult(tournamentId, roundId, matchId, participantId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return null; }

        var normalised = normaliseId(participantId);
        if (normalised === null) { return null; }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            if (match.results &&
                match.results[normalised] !== undefined) {
                return match.results[normalised];
            }
            return null;
        }

        if (type === 'team_vs_team') {
            if (match.teamResults &&
                match.teamResults[normalised] !== undefined) {
                return match.teamResults[normalised];
            }
            if (match.individualResults &&
                match.individualResults[normalised] !== undefined) {
                return match.individualResults[normalised];
            }
            return null;
        }

        if (type === 'standard') {
            if (match.winner &&
                normaliseId(match.winner) === normalised) {
                return 'pass';
            }
            if (match.loser &&
                normaliseId(match.loser) === normalised) {
                return 'fail';
            }
            return null;
        }

        return null;
    }

    /**
     * Get the full result map for a match, keyed by participant ID.
     */
    function getMatchResults(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return {}; }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            return deepClone(match.results || {});
        }

        if (type === 'team_vs_team') {
            var combined = {};
            var teamResults = match.teamResults || {};
            var indResults = match.individualResults || {};
            Object.keys(teamResults).forEach(function(k) {
                combined[k] = teamResults[k];
            });
            Object.keys(indResults).forEach(function(k) {
                combined[k] = indResults[k];
            });
            return combined;
        }

        if (type === 'standard') {
            var legacy = {};
            if (match.winner) {
                legacy[normaliseId(match.winner)] = 'pass';
            }
            if (match.loser) {
                legacy[normaliseId(match.loser)] = 'fail';
            }
            return legacy;
        }

        return {};
    }

    function getTeamResults(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match || match.type !== 'team_vs_team') { return {}; }
        return deepClone(match.teamResults || {});
    }

    function getIndividualResults(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match || match.type !== 'team_vs_team') { return {}; }
        return deepClone(match.individualResults || {});
    }

    function getPairings(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return []; }
        if (match.isPairExam !== true) { return []; }
        if (!Array.isArray(match.pairings)) { return []; }
        return deepClone(match.pairings);
    }

    function getMatchAdvancing(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return []; }
        return Schema.deriveAdvancing(match);
    }

    function getMatchPassers(tournamentId, roundId, matchId) {
        return getMatchAdvancing(tournamentId, roundId, matchId);
    }

    function getMatchFailers(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return []; }

        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];
        var results = getMatchResults(tournamentId, roundId, matchId);
        var failers = [];
        for (var i = 0; i < participants.length; i++) {
            var id = normaliseId(participants[i]);
            if (id === null) { continue; }
            if (results[id] === 'fail') {
                failers.push(id);
            }
        }
        return failers;
    }

    // ============================================================
    // ELIMINATION READS
    // ============================================================

    function getEliminations(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }
        return tournament.eliminations.slice();
    }

    function getEliminationCount(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return 0;
        }
        return tournament.eliminations.length;
    }

    function getEliminationRecord(tournamentId, participantId) {
        var normalised = normaliseId(participantId);
        if (normalised === null) { return null; }

        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return null;
        }

        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && normaliseId(e.participantId) === normalised) {
                return deepClone(e);
            }
        }
        return null;
    }

    function isParticipantEliminated(tournamentId, participantId) {
        return getEliminationRecord(tournamentId, participantId) !== null;
    }

    // ============================================================
    // WINNER (deprecated) AND FINAL PASSERS
    // ============================================================

    /**
     * @deprecated No winner concept anymore. Returns null on new data.
     */
    function getWinner(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !tournament.winner) {
            return null;
        }
        return deepClone(tournament.winner);
    }

    function getFinalPassers(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) { return []; }
        return Schema.deriveFinalPassers(tournament);
    }

    function getFinalPasserCount(tournamentId) {
        return getFinalPassers(tournamentId).length;
    }

    // ============================================================
    // STATISTICS
    // ============================================================

    function getTournamentStatistics(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) {
            return {
                participantCount: 0,
                activeParticipantCount: 0,
                roundCount: 0,
                matchCount: 0,
                completedMatchCount: 0,
                eliminationCount: 0,
                finalPasserCount: 0,
                hasWinner: false
            };
        }

        var participants = Array.isArray(tournament.participants)
            ? tournament.participants
            : [];
        var rounds = Array.isArray(tournament.rounds)
            ? tournament.rounds
            : [];

        var matchCount = 0;
        var completedMatchCount = 0;
        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round || !Array.isArray(round.matches)) { continue; }
            matchCount += round.matches.length;
            for (var j = 0; j < round.matches.length; j++) {
                var match = round.matches[j];
                if (match && match.status === 'completed') {
                    completedMatchCount++;
                }
            }
        }

        var activeParticipantCount = 0;
        for (var k = 0; k < participants.length; k++) {
            var p = participants[k];
            if (p && !isParticipantEliminated(tournamentId, p.id)) {
                activeParticipantCount++;
            }
        }

        return {
            participantCount: participants.length,
            activeParticipantCount: activeParticipantCount,
            roundCount: rounds.length,
            matchCount: matchCount,
            completedMatchCount: completedMatchCount,
            eliminationCount: Array.isArray(tournament.eliminations)
                ? tournament.eliminations.length
                : 0,
            finalPasserCount: getFinalPasserCount(tournamentId),
            hasWinner: false
        };
    }

    // ============================================================
    // VALIDATION / TYPE HELPERS
    // ============================================================

    function isValidTournamentStatus(status) {
        return Schema.isValidStatus(status);
    }

    function isValidMatchType(type) {
        return Schema.isValidMatchType(type);
    }

    function isValidResult(value) {
        return Schema.isValidResult(value);
    }

    function validateTournament(tournament) {
        return Schema.validateTournament(tournament, { strict: false });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentQueries = {
        // Tournament reads
        getTournament: getTournament,
        getTournaments: getTournaments,
        getActiveTournaments: getActiveTournaments,
        getCompletedTournaments: getCompletedTournaments,
        getDraftTournaments: getDraftTournaments,
        getTournamentsByClass: getTournamentsByClass,
        getTournamentsForWeek: getTournamentsForWeek,
        getExamForClassAndWeek: getExamForClassAndWeek,

        // Participant reads
        getParticipants: getParticipants,
        getParticipant: getParticipant,
        getParticipantIds: getParticipantIds,
        getParticipantCount: getParticipantCount,
        getParticipantTypeFromRecord: getParticipantTypeFromRecord,
        isParticipantInTournament: isParticipantInTournament,
        getActiveParticipants: getActiveParticipants,

        // Round reads — by ID
        getRounds: getRounds,
        getRound: getRound,
        getRoundCount: getRoundCount,
        getRoundIndex: getRoundIndex,

        // Match reads — by ID
        getMatches: getMatches,
        getMatch: getMatch,
        getMatchCount: getMatchCount,
        getMatchIndex: getMatchIndex,
        isMatchComplete: isMatchComplete,
        getMatchWinner: getMatchWinner,
        getParticipantResult: getParticipantResult,
        getMatchResults: getMatchResults,
        getTeamResults: getTeamResults,
        getIndividualResults: getIndividualResults,
        getPairings: getPairings,
        getMatchAdvancing: getMatchAdvancing,
        getMatchPassers: getMatchPassers,
        getMatchFailers: getMatchFailers,

        // Elimination reads
        getEliminations: getEliminations,
        getEliminationCount: getEliminationCount,
        getEliminationRecord: getEliminationRecord,
        isParticipantEliminated: isParticipantEliminated,

        // Winner (deprecated) and final passers
        getWinner: getWinner,
        getFinalPassers: getFinalPassers,
        getFinalPasserCount: getFinalPasserCount,

        // Statistics
        getTournamentStatistics: getTournamentStatistics,

        // Type / status helpers
        isValidTournamentStatus: isValidTournamentStatus,
        isValidMatchType: isValidMatchType,
        isValidResult: isValidResult,
        validateTournament: validateTournament
    };

})();
