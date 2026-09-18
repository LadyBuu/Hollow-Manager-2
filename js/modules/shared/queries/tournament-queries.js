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
 *   - Prior-round outcome derivation (for the Exam picker indicator)
 *
 * IDENTITY:
 *   Rounds and matches are identified by stable IDs, not indices.
 *   Every round- and match-scoped query takes the ID. Resolution goes
 *   through TournamentSchema.findRoundById / findMatchById.
 *
 *   Positional ordering is provided as a separate concern via
 *   getRoundIndex / getMatchIndex. Those return display-order
 *   positions; they are NOT identity.
 *
 * ARCHIVED TOURNAMENTS:
 *   A tournament with a non-null `archivedAt` is considered archived.
 *   Archived tournaments:
 *     - are EXCLUDED from getTournaments() and its status-filtered
 *       variants by default,
 *     - are EXCLUDED from getTournamentsByClass and
 *       getTournamentsForWeek by default,
 *     - are still returned by getTournament(id), which does not filter,
 *     - can be INCLUDED by passing { includeArchived: true }.
 *
 *   getExamForClassAndWeek also excludes archived tournaments by
 *   default, so the Academy Exams view does not surface archived exams
 *   as "the active exam for this week."
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
 * DEPENDENCIES (MANDATORY):
 *   - window.TournamentSchema
 *   - window.CalendarValidation
 *   - window.ObjectUtils
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
    var CalendarValidation = window.CalendarValidation;
    var ObjectUtils = window.ObjectUtils;

    var _missing = [];

    if (!Schema || typeof Schema.findRoundById !== 'function') {
        _missing.push('TournamentSchema.findRoundById');
    }
    if (!Schema || typeof Schema.findMatchById !== 'function') {
        _missing.push('TournamentSchema.findMatchById');
    }
    if (!Schema || typeof Schema.findRoundIndexById !== 'function') {
        _missing.push('TournamentSchema.findRoundIndexById');
    }
    if (!Schema || typeof Schema.findMatchIndexById !== 'function') {
        _missing.push('TournamentSchema.findMatchIndexById');
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
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
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
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
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
        return CalendarValidation.parseWeek(value);
    }

    function isArchived(tournament) {
        if (!tournament) { return false; }
        return tournament.archivedAt !== undefined &&
               tournament.archivedAt !== null &&
               tournament.archivedAt !== '';
    }

    // ============================================================
    // TOURNAMENT READS
    // ============================================================

    /**
     * Get a tournament by ID.
     *
     * This is the ONE query that does NOT filter archived tournaments.
     * Callers that want to hide archived tournaments should check
     * `archivedAt` on the returned record.
     *
     * @returns {object|null} Defensive clone, or null.
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
     * Get all tournaments, optionally filtered by status.
     *
     * Archived tournaments are excluded by default. Pass
     * { includeArchived: true } to include them.
     *
     * @param {string} [status] - filter by status
     * @param {object} [options] - { includeArchived: boolean }
     * @returns {array} Array of defensive clones.
     */
    function getTournaments(status, options) {
        options = options || {};
        var includeArchived = options.includeArchived === true;

        var store = getStore();
        if (!store) {
            return [];
        }

        var filterStatus = isNonEmptyString(status) ? status : null;
        var result = [];

        for (var i = 0; i < store.length; i++) {
            var t = store[i];
            if (!t) { continue; }

            if (!includeArchived && isArchived(t)) { continue; }
            if (filterStatus && t.status !== filterStatus) { continue; }

            result.push(deepClone(t));
        }

        return result;
    }

    function getActiveTournaments(options) {
        return getTournaments('active', options);
    }

    function getCompletedTournaments(options) {
        return getTournaments('completed', options);
    }

    function getDraftTournaments(options) {
        return getTournaments('draft', options);
    }

    /**
     * Get tournaments for a class.
     * Archived tournaments excluded by default.
     */
    function getTournamentsByClass(classId, options) {
        options = options || {};
        var includeArchived = options.includeArchived === true;

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
            if (!includeArchived && isArchived(t)) { continue; }
            if (normaliseId(t.graduatingClassId) !== normalised) {
                continue;
            }
            result.push(deepClone(t));
        }
        return result;
    }

    /**
     * Get tournaments active during a week.
     * Archived tournaments excluded by default.
     */
    function getTournamentsForWeek(week, options) {
        options = options || {};
        var includeArchived = options.includeArchived === true;

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
            if (!includeArchived && isArchived(t)) { continue; }
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
     * Get the exam for a (class, week) pair.
     *
     * Archived tournaments are excluded. If multiple tournaments match
     * (which should not happen under the current creation rules), the
     * first match wins.
     *
     * @returns {object|null} Defensive clone, or null.
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
            if (isArchived(t)) { continue; }
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

    function isParticipantInTournament(
        tournamentId,
        participantId,
        participantType
    ) {
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
     * @returns {array} Array of match records (clones).
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
     * Get the raw result value for a participant in a match.
     * Returns 'pass' | 'fail' | 'retry' | null.
     *
     * SEMANTICS:
     *   group_exam   : results[participantId]
     *   team_vs_team : teamResults[participantId] if present,
     *                  otherwise individualResults[participantId]
     *
     * For team_vs_team, the participant may be either a team ID or a
     * character ID (for individual member results). This function
     * checks teamResults first, then individualResults.
     */
    function getParticipantResult(
        tournamentId,
        roundId,
        matchId,
        participantId
    ) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return null; }

        var normalised = normaliseId(participantId);
        if (normalised === null) { return null; }

        return readParticipantResultFromMatch(match, normalised);
    }

    /**
     * Internal helper: read a participant's result from a match
     * record that is already in hand.
     *
     * SEMANTICS:
     *   group_exam   : results[participantId]
     *   team_vs_team : teamResults[participantId] if present,
     *                  otherwise individualResults[participantId]
     *
     * No validation of match shape here; the caller is responsible
     * for passing a structurally valid match record.
     *
     * @returns {string|null} 'pass' | 'fail' | 'retry' | null
     */
    function readParticipantResultFromMatch(match, normalisedParticipantId) {
        if (!match || typeof match !== 'object') { return null; }
        if (!isNonEmptyString(normalisedParticipantId)) { return null; }

        var type = match.type;

        if (type === 'group_exam') {
            if (match.results &&
                match.results[normalisedParticipantId] !== undefined) {
                return match.results[normalisedParticipantId];
            }
            return null;
        }

        if (type === 'team_vs_team') {
            if (match.teamResults &&
                match.teamResults[normalisedParticipantId] !== undefined) {
                return match.teamResults[normalisedParticipantId];
            }
            if (match.individualResults &&
                match.individualResults[normalisedParticipantId] !== undefined) {
                return match.individualResults[normalisedParticipantId];
            }
            return null;
        }

        return null;
    }

    /**
     * Get the full result map for a match, keyed by participant ID.
     *
     * For team_vs_team, team results and individual results are
     * merged into a single map. If a key appears in both maps, the
     * individual result takes precedence (it is more specific).
     */
    function getMatchResults(tournamentId, roundId, matchId) {
        var match = getMatch(tournamentId, roundId, matchId);
        if (!match) { return {}; }

        var type = match.type;

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
    // PRIOR-ROUND OUTCOMES
    // ============================================================
    //
    // Reads the round that immediately precedes `beforeRoundId` (by
    // positional order) and returns a map of participant ID to the
    // participant's outcome in that round, restricted to 'pass' and
    // 'retry'.
    //
    // This is the derivation behind the Exam picker's pass/retry
    // indicator. The picker is opened to add a match to a specific
    // round; the badge on each candidate reflects what that candidate
    // did in the round immediately before.
    //
    // CONTRACT:
    //   - Only COMPLETED matches contribute.
    //   - 'fail' is dropped. A failing participant would be filtered
    //     out of the picker pool anyway; recording 'fail' here would
    //     be dead state that callers would then need to ignore.
    //   - null (unresolved result on a completed match) is dropped.
    //   - If a participant appears in MULTIPLE completed matches in
    //     the previous round, the outcomes are reconciled:
    //         any 'pass'   -> 'pass'
    //         else any 'retry' -> 'retry'
    //         otherwise absent
    //     This makes the badge deterministic under match reordering.
    //     The tie-break favours 'pass' because it is the stronger
    //     outcome and the UI reads more naturally as "they passed".
    //   - The previous round is the round at index-1 of the round
    //     containing `beforeRoundId`. If `beforeRoundId` is the first
    //     round, or not found, an empty map is returned.
    //
    // SEMANTICS BY MATCH TYPE:
    //   group_exam   : reads match.results[participantId]
    //   team_vs_team : reads match.teamResults[participantId]
    //                  (NOT individualResults; see C8 spec, Q4)
    //
    // Return shape:
    //   { [participantId]: 'pass' | 'retry' }
    //
    // The map is a plain object with String keys and String values.
    // Entries whose value would be neither 'pass' nor 'retry' are
    // omitted entirely.

    /**
     * Get the outcome map for the round immediately preceding
     * `beforeRoundId`.
     *
     * @param {string} tournamentId
     * @param {string} beforeRoundId - The round the picker is
     *   targeting. The returned map describes the round BEFORE it.
     * @returns {object} Map of participant ID to 'pass' | 'retry'.
     *   Empty when there is no previous round, or when the previous
     *   round has no completed matches.
     */
    function getPriorRoundOutcomes(tournamentId, beforeRoundId) {
        var result = {};

        var normalisedBefore = normaliseId(beforeRoundId);
        if (normalisedBefore === null) {
            return result;
        }

        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return result;
        }

        var beforeIndex = Schema.findRoundIndexById(
            tournament,
            normalisedBefore
        );
        if (beforeIndex <= 0) {
            // Either the round is not found (-1) or it is the first
            // round (0). Either way, there is no previous round.
            return result;
        }

        var previousRound = tournament.rounds[beforeIndex - 1];
        if (!previousRound || !Array.isArray(previousRound.matches)) {
            return result;
        }

        // Two-pass reconcile: gather per-participant best outcome.
        //   'pass' beats 'retry' beats absent.
        // We track the best seen so far per participant and upgrade
        // in place. This handles the multi-match case without a
        // second walk.
        var matches = previousRound.matches;

        for (var m = 0; m < matches.length; m++) {
            var match = matches[m];
            if (!match) { continue; }
            if (match.status !== 'completed') { continue; }

            var participants = Array.isArray(match.participants)
                ? match.participants
                : [];

            for (var p = 0; p < participants.length; p++) {
                var pid = normaliseId(participants[p]);
                if (pid === null) { continue; }

                var raw = readParticipantResultFromMatch(match, pid);
                if (raw !== 'pass' && raw !== 'retry') {
                    // 'fail', null, or anything unexpected is
                    // dropped. Participants who failed are excluded
                    // from the picker pool by a separate filter.
                    continue;
                }

                var current = result[pid];
                if (current === 'pass') {
                    continue;
                }
                if (raw === 'pass') {
                    result[pid] = 'pass';
                    continue;
                }
                // raw === 'retry'
                if (current === undefined) {
                    result[pid] = 'retry';
                }
                // current === 'retry' already, no change.
            }
        }

        return result;
    }

    // ============================================================
    // ELIMINATION READS
    // ============================================================

    /**
     * Get every elimination record for a tournament.
     * @returns {array} Defensive clones of elimination records.
     */
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

    /**
     * Get eliminations produced by a specific round.
     * Useful for debugging and for round-level reversal audits.
     */
    function getEliminationsByRound(tournamentId, roundId) {
        var normalised = normaliseId(roundId);
        if (normalised === null) { return []; }

        var all = getEliminations(tournamentId);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var e = all[i];
            if (e && normaliseId(e.fromRoundId) === normalised) {
                result.push(e);
            }
        }
        return result;
    }

    /**
     * Get eliminations produced by a specific match.
     */
    function getEliminationsByMatch(tournamentId, matchId) {
        var normalised = normaliseId(matchId);
        if (normalised === null) { return []; }

        var all = getEliminations(tournamentId);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var e = all[i];
            if (e && normaliseId(e.fromMatchId) === normalised) {
                result.push(e);
            }
        }
        return result;
    }

    // ============================================================
    // FINAL PASSERS
    // ============================================================

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
                archived: false
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
            archived: isArchived(tournament)
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
        isArchived: isArchived,

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
        getParticipantResult: getParticipantResult,
        getMatchResults: getMatchResults,
        getTeamResults: getTeamResults,
        getIndividualResults: getIndividualResults,
        getPairings: getPairings,
        getMatchAdvancing: getMatchAdvancing,
        getMatchPassers: getMatchPassers,
        getMatchFailers: getMatchFailers,

        // Prior-round outcomes (for the Exam picker indicator)
        getPriorRoundOutcomes: getPriorRoundOutcomes,

        // Elimination reads
        getEliminations: getEliminations,
        getEliminationCount: getEliminationCount,
        getEliminationRecord: getEliminationRecord,
        isParticipantEliminated: isParticipantEliminated,
        getEliminationsByRound: getEliminationsByRound,
        getEliminationsByMatch: getEliminationsByMatch,

        // Final passers
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
            'getActiveTournaments', 'getCompletedTournaments',
            'getDraftTournaments',
            'getTournamentsByClass', 'getTournamentsForWeek',
            'getExamForClassAndWeek', 'isArchived',
            'getParticipants', 'getParticipant', 'getParticipantIds',
            'getParticipantCount', 'getParticipantTypeFromRecord',
            'isParticipantInTournament', 'getActiveParticipants',
            'getRounds', 'getRound', 'getRoundCount', 'getRoundIndex',
            'getMatches', 'getMatch', 'getMatchCount', 'getMatchIndex',
            'isMatchComplete', 'getParticipantResult',
            'getMatchResults', 'getTeamResults', 'getIndividualResults',
            'getPairings', 'getMatchAdvancing', 'getMatchPassers',
            'getMatchFailers',
            'getPriorRoundOutcomes',
            'getEliminations', 'getEliminationCount',
            'getEliminationRecord', 'isParticipantEliminated',
            'getEliminationsByRound', 'getEliminationsByMatch',
            'getFinalPassers', 'getFinalPasserCount',
            'getTournamentStatistics',
            'isValidTournamentStatus', 'isValidMatchType',
            'isValidResult', 'validateTournament'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentQueries] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
