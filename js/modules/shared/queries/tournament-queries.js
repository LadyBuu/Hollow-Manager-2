/**
 * modules/shared/queries/tournament-queries.js - Tournament Queries
 * Read-only facade for tournament data
 * Path: js/modules/shared/queries/tournament-queries.js
 *
 * This module provides:
 *   - Tournament read access (getTournament, getTournaments, ...)
 *   - Participant read access
 *   - Round and match read access
 *   - Elimination read access
 *   - Result-map accessors
 *   - Final passers derivation
 *   - Type/status lookups
 *
 * IMPORTANT:
 *   - READ ONLY. This module never mutates data.
 *   - Returns defensive copies unless documented otherwise.
 *   - Does NOT own tournament data. The store is window.data.tournaments.
 *   - Composes the raw store. Domain derivations (like advancement)
 *     are delegated to TournamentSchema where canonical.
 *   - No UI dependencies.
 *   - No mutation pipeline calls.
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
 * DEPENDENCIES:
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *     (used for advancement derivation, normalisation, and validation
 *      of read data)
 *
 * USAGE:
 *   var Queries = window.TournamentQueries;
 *   var tournament = Queries.getTournament('tourn_123');
 *   var rounds = Queries.getRounds('tourn_123');
 *   var match = Queries.getMatch('tourn_123', 0, 1);
 *   var passers = Queries.getFinalPassers('tourn_123');
 */

(function() {
    'use strict';

    if (window.__tournamentQueriesLoaded) {
        return;
    }
    window.__tournamentQueriesLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getSchema() {
        return window.TournamentSchema || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

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

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        var Schema = getSchema();
        if (Schema && typeof Schema.normaliseId === 'function') {
            return Schema.normaliseId(value);
        }
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

    /**
     * Get a tournament by ID.
     * Returns a defensive copy.
     */
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

    /**
     * Get every tournament, optionally filtered by status.
     * Returns defensive copies.
     */
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

    /**
     * Get active tournaments (status === 'active').
     */
    function getActiveTournaments() {
        return getTournaments('active');
    }

    /**
     * Get completed tournaments (status === 'completed').
     */
    function getCompletedTournaments() {
        return getTournaments('completed');
    }

    /**
     * Get draft tournaments (status === 'draft').
     */
    function getDraftTournaments() {
        return getTournaments('draft');
    }

    /**
     * Get tournaments that belong to a specific graduating class.
     */
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

    /**
     * Get tournaments that overlap a specific week.
     * A tournament overlaps when startWeek <= week <= endWeek.
     */
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

    /**
     * Get tournaments that belong to a class AND overlap a week.
     * This is the primary lookup for the Academy exams view:
     * at most one tournament per class per week.
     */
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
            if (normaliseId(t.graduatingClassId) !== normalised) { continue; }
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
                if (participantType !== undefined && participantType !== null) {
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
    // ROUND READS
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

    function getRound(tournamentId, roundIndex) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return null;
        }
        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0 || index >= tournament.rounds.length) {
            return null;
        }
        return deepClone(tournament.rounds[index]);
    }

    // ============================================================
    // MATCH READS
    // ============================================================

    function getMatches(tournamentId, roundIndex) {
        var round = getRound(tournamentId, roundIndex);
        if (!round || !Array.isArray(round.matches)) {
            return [];
        }
        return round.matches.slice();
    }

    function getMatch(tournamentId, roundIndex, matchIndex) {
        var matches = getMatches(tournamentId, roundIndex);
        var index = parseInt(matchIndex, 10);
        if (isNaN(index) || index < 0 || index >= matches.length) {
            return null;
        }
        return matches[index];
    }

    function getMatchCount(tournamentId, roundIndex) {
        return getMatches(tournamentId, roundIndex).length;
    }

    function isMatchComplete(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return false; }
        return match.status === 'completed';
    }

    /**
     * @deprecated No winner concept anymore. Returns null on new data.
     */
    function getMatchWinner(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return null; }
        return match.winner || null;
    }

    /**
     * Get the raw result value for a participant in a match.
     *
     * For group_exam: reads match.results[participantId].
     * For team_vs_team: reads match.teamResults[participantId] when
     *   the participant is a team, match.individualResults[participantId]
     *   when the participant is a character.
     *
     * Returns 'pass' | 'fail' | 'retry' | null.
     */
    function getParticipantResult(tournamentId, roundIndex, matchIndex, participantId) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return null; }

        var normalised = normaliseId(participantId);
        if (normalised === null) { return null; }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            if (match.results && match.results[normalised] !== undefined) {
                return match.results[normalised];
            }
            return null;
        }

        if (type === 'team_vs_team') {
            // Prefer team-level result for team IDs.
            if (match.teamResults && match.teamResults[normalised] !== undefined) {
                return match.teamResults[normalised];
            }
            // Fall back to individual result.
            if (match.individualResults && match.individualResults[normalised] !== undefined) {
                return match.individualResults[normalised];
            }
            return null;
        }

        if (type === 'standard') {
            // Legacy: derive from winner.
            if (match.winner && normaliseId(match.winner) === normalised) {
                return 'pass';
            }
            if (match.loser && normaliseId(match.loser) === normalised) {
                return 'fail';
            }
            return null;
        }

        return null;
    }

    /**
     * Get the full result map for a match, keyed by participant ID.
     *
     * For group_exam: returns match.results as-is.
     * For team_vs_team: merges teamResults and individualResults into
     *   a single map. Character IDs shadow nothing; team IDs and
     *   character IDs don't collide.
     * For standard: derives { winner: 'pass', loser: 'fail' }.
     */
    function getMatchResults(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return {}; }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            return deepClone(match.results || {});
        }

        if (type === 'team_vs_team') {
            var combined = {};
            var teamResults = match.teamResults || {};
            var indResults = match.individualResults || {};
            Object.keys(teamResults).forEach(function(k) { combined[k] = teamResults[k]; });
            Object.keys(indResults).forEach(function(k) { combined[k] = indResults[k]; });
            return combined;
        }

        if (type === 'standard') {
            var legacy = {};
            if (match.winner) { legacy[normaliseId(match.winner)] = 'pass'; }
            if (match.loser) { legacy[normaliseId(match.loser)] = 'fail'; }
            return legacy;
        }

        return {};
    }

    /**
     * Get the team-level result map for a team match.
     * Returns {} for non-team matches.
     */
    function getTeamResults(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match || match.type !== 'team_vs_team') { return {}; }
        return deepClone(match.teamResults || {});
    }

    /**
     * Get the individual-level result map for a team match.
     * Returns {} for non-team matches.
     */
    function getIndividualResults(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match || match.type !== 'team_vs_team') { return {}; }
        return deepClone(match.individualResults || {});
    }

    /**
     * Get the pairings of a pair exam. Returns [] for anything else.
     */
    function getPairings(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return []; }
        if (match.isPairExam !== true) { return []; }
        if (!Array.isArray(match.pairings)) { return []; }
        return deepClone(match.pairings);
    }

    /**
     * Get advancing participant IDs from a match.
     * Delegates to the canonical Schema derivation.
     */
    function getMatchAdvancing(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return []; }

        var Schema = getSchema();
        if (Schema && typeof Schema.deriveAdvancing === 'function') {
            try {
                return Schema.deriveAdvancing(match);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    /**
     * Get the passers of a match (result === 'pass' or 'retry').
     * Alias for getMatchAdvancing, semantically clearer at the call site.
     */
    function getMatchPassers(tournamentId, roundIndex, matchIndex) {
        return getMatchAdvancing(tournamentId, roundIndex, matchIndex);
    }

    /**
     * Get the failers of a match.
     */
    function getMatchFailers(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return []; }

        var participants = Array.isArray(match.participants) ? match.participants : [];
        var results = getMatchResults(tournamentId, roundIndex, matchIndex);
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
     * Kept for legacy reads.
     */
    function getWinner(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !tournament.winner) {
            return null;
        }
        return deepClone(tournament.winner);
    }

    /**
     * Get the final passers of a tournament.
     * The union of advancing IDs across the last round's matches.
     */
    function getFinalPassers(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament) { return []; }

        var Schema = getSchema();
        if (Schema && typeof Schema.deriveFinalPassers === 'function') {
            try {
                return Schema.deriveFinalPassers(tournament);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    /**
     * Get the count of final passers.
     */
    function getFinalPasserCount(tournamentId) {
        return getFinalPassers(tournamentId).length;
    }

    // ============================================================
    // STATISTICS
    // ============================================================

    /**
     * Get a summary of a tournament's current state.
     */
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
                hasWinner: false   // deprecated, always false on new data
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
        var Schema = getSchema();
        if (Schema && typeof Schema.isValidStatus === 'function') {
            return Schema.isValidStatus(status);
        }
        return status === 'draft' || status === 'active' || status === 'completed';
    }

    function isValidMatchType(type) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isValidMatchType === 'function') {
            return Schema.isValidMatchType(type);
        }
        return type === 'standard' || type === 'group_exam' || type === 'team_vs_team';
    }

    function isValidResult(value) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isValidResult === 'function') {
            return Schema.isValidResult(value);
        }
        return value === 'pass' || value === 'fail' || value === 'retry';
    }

    function validateTournament(tournament) {
        var Schema = getSchema();
        if (Schema && typeof Schema.validateTournament === 'function') {
            return Schema.validateTournament(tournament, { strict: false });
        }
        return { valid: false, errors: ['Schema not available'] };
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

        // Round reads
        getRounds: getRounds,
        getRound: getRound,
        getRoundCount: getRoundCount,

        // Match reads
        getMatches: getMatches,
        getMatch: getMatch,
        getMatchCount: getMatchCount,
        isMatchComplete: isMatchComplete,
        getMatchWinner: getMatchWinner,          // @deprecated
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
        getWinner: getWinner,                    // @deprecated
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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentQueries;
        var missing = [];

        var required = [
            'getTournament', 'getTournaments',
            'getActiveTournaments', 'getCompletedTournaments', 'getDraftTournaments',
            'getTournamentsByClass', 'getTournamentsForWeek', 'getExamForClassAndWeek',
            'getParticipants', 'getParticipant', 'getParticipantIds',
            'getParticipantCount', 'getParticipantTypeFromRecord',
            'isParticipantInTournament', 'getActiveParticipants',
            'getRounds', 'getRound', 'getRoundCount',
            'getMatches', 'getMatch', 'getMatchCount',
            'isMatchComplete', 'getMatchWinner',
            'getParticipantResult', 'getMatchResults',
            'getTeamResults', 'getIndividualResults', 'getPairings',
            'getMatchAdvancing', 'getMatchPassers', 'getMatchFailers',
            'getEliminations', 'getEliminationCount', 'getEliminationRecord',
            'isParticipantEliminated',
            'getWinner', 'getFinalPassers', 'getFinalPasserCount',
            'getTournamentStatistics',
            'isValidTournamentStatus', 'isValidMatchType', 'isValidResult',
            'validateTournament'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentQueries] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();