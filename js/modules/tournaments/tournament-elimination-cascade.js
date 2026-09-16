/**
 * modules/tournaments/tournament-elimination-cascade.js
 * Elimination Cascade
 *
 * Path: js/modules/tournaments/tournament-elimination-cascade.js
 *
 * PURPOSE:
 *   Pure helpers that write and reverse elimination records on the
 *   tournament and character sides, given an appData snapshot.
 *
 * WHY THIS MODULE EXISTS:
 *   When a match completes and a participant's result is 'fail',
 *   that participant is eliminated from the tournament. The
 *   elimination must be recorded on BOTH:
 *     - tournament.eliminations[]   (the tournament's own view)
 *     - character.eliminations[]    (the character's historical view)
 *
 *   Those writes must happen INSIDE the same pipeline transaction
 *   that completes the match. They cannot go through
 *   CharacterEliminations or TournamentEliminationWorkflow, because
 *   both of those are themselves pipeline entry points, and nesting
 *   pipelines deadlocks or corrupts the transaction.
 *
 *   This module is the pure alternative. It receives an appData
 *   snapshot, mutates it in place, and returns counts. It never
 *   enters the pipeline. It is designed to run inside
 *   TournamentMatches.completeMatch's mutate callback, and inside
 *   the reversal paths in removeMatch / removeRound /
 *   deleteTournament.
 *
 * PROVENANCE:
 *   Every elimination written by the cascade carries:
 *     fromRoundId   the round the match belongs to
 *     fromMatchId   the match that produced the failure
 *   on both the tournament-side and character-side records.
 *
 *   This is what makes reversal possible. Without provenance, you
 *   cannot tell which elimination belongs to which match, and
 *   removing one match would force you to reverse every elimination
 *   in the tournament.
 *
 *   Legacy elimination records without provenance are not touched by
 *   per-match or per-round reversal. They are only reversed by
 *   deleteTournament's tournament-wide reversal, or by the manual
 *   restore path in TournamentEliminationWorkflow.
 *
 * LAST-WINS SEMANTICS:
 *   If a character is somehow eliminated twice within the same
 *   tournament (a second chance, then a second failure), the newer
 *   elimination REPLACES the older one. The story is: the first
 *   elimination was reversed to grant a second chance, then the
 *   character failed again. The code does not preserve the
 *   intermediate reversal as a separate record — the tournament
 *   keeps one elimination per (characterId, tournamentId).
 *
 *   "Replace" here means: remove any existing elimination for
 *   (characterId, tournamentId) on both sides, then write the new
 *   one. The result is one record per (characterId, tournamentId).
 *
 * IDEMPOTENCE:
 *   applyFailEliminations is idempotent on participants whose result
 *   is 'fail' and who already have an elimination for this
 *   tournament. The result is the same elimination, rewritten.
 *
 * TEAM MATCH SEMANTICS:
 *   For 'team_vs_team' matches, ONLY individualResults[charId] ===
 *   'fail' triggers an elimination. teamResults[] never eliminates
 *   anyone directly. A team can fail a match while every individual
 *   member passes; no one is eliminated. A team can pass while an
 *   individual member fails; only that member is eliminated.
 *
 * LEGACY MATCH TYPES:
 *   'standard' is not handled. It has no results map and is not
 *   produced by the current match-generation code.
 *
 * WEEK SEMANTICS:
 *   The elimination week is the TOURNAMENT'S endWeek, not the
 *   match's week and not the current UI week. The contract is:
 *   elimination happens at the end of the tournament, and the
 *   character is ineligible starting the following week.
 *
 *   EliminationQueries.isCharacterEliminatedByWeek(char, N) uses a
 *   strictly-less-than boundary: it returns true only when
 *   elimWeek < N. A character eliminated at week 14 is therefore
 *   eligible in week 14 and ineligible from week 15 onward. That is
 *   exactly the intended behaviour.
 *
 * REASON STRING:
 *   'Eliminated on week ' + week
 *   where week is the tournament's endWeek.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.IdUtils (for generating elimination record IDs)
 *   - window.CalendarValidation (for rebuilding eliminatedWeeks[] strictly)
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.ObjectUtils (for deepClone, if a caller needs one; not
 *     used internally)
 *
 * USAGE:
 *   // Inside TournamentMatches.completeMatch's mutate callback:
 *   var cascade = TournamentEliminationCascade.applyFailEliminations(
 *       appData,
 *       tournament,
 *       completedMatch,
 *       round,
 *       tournament.endWeek
 *   );
 *
 *   // Inside removeMatch's mutate callback:
 *   var cascade = TournamentEliminationCascade.reverseMatchEliminations(
 *       appData,
 *       tournament,
 *       matchId
 *   );
 *
 *   // Inside removeRound's mutate callback:
 *   var cascade = TournamentEliminationCascade.reverseRoundEliminations(
 *       appData,
 *       tournament,
 *       roundId
 *   );
 *
 *   // Inside deleteTournament's mutate callback, BEFORE the tournament
 *   // record is spliced out:
 *   var cascade = TournamentEliminationCascade.reverseTournamentEliminations(
 *       appData,
 *       tournamentId
 *   );
 */

(function() {
    'use strict';

    if (window.__tournamentEliminationCascadeLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    var IdUtils = window.IdUtils;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentEliminationCascade] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentEliminationCascadeLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function buildReason(week) {
        return 'Eliminated on week ' + week;
    }

    /**
     * Find a character record in an appData snapshot by ID.
     * Returns a live reference, or null.
     */
    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        if (!isNonEmptyString(charId)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    /**
     * Ensure character.eliminations[] is an array, and rebuild
     * character.eliminatedWeeks[] from it.
     *
     * eliminatedWeeks[] is a derived cache. It is rebuilt here
     * because the cascade is the last writer to touch
     * character.eliminations[] inside the pipeline transaction.
     */
    function rebuildEliminatedWeeks(character) {
        if (!character) {
            return;
        }
        if (!Array.isArray(character.eliminations)) {
            character.eliminations = [];
        }

        character.eliminatedWeeks = [];

        for (var i = 0; i < character.eliminations.length; i++) {
            var e = character.eliminations[i];
            if (!e || typeof e !== 'object') {
                continue;
            }
            var week = CalendarValidation.parseWeek(e.week);
            if (week === null) {
                continue;
            }
            if (character.eliminatedWeeks.indexOf(week) === -1) {
                character.eliminatedWeeks.push(week);
            }
        }

        character.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    /**
     * Remove every tournament-side elimination for this tournament
     * whose provenance is (fromMatchId) matches the given match ID.
     *
     * Returns the array of removed records (for logging).
     */
    function removeTournamentEliminationsByMatch(tournament, matchId) {
        var removed = [];
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return removed;
        }
        if (!isNonEmptyString(matchId)) {
            return removed;
        }

        var target = String(matchId);
        var kept = [];
        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && isNonEmptyString(e.fromMatchId) &&
                String(e.fromMatchId) === target) {
                removed.push(e);
                continue;
            }
            kept.push(e);
        }
        tournament.eliminations = kept;
        return removed;
    }

    /**
     * Remove every tournament-side elimination for this tournament
     * whose provenance is (fromRoundId) matches the given round ID.
     */
    function removeTournamentEliminationsByRound(tournament, roundId) {
        var removed = [];
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return removed;
        }
        if (!isNonEmptyString(roundId)) {
            return removed;
        }

        var target = String(roundId);
        var kept = [];
        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && isNonEmptyString(e.fromRoundId) &&
                String(e.fromRoundId) === target) {
                removed.push(e);
                continue;
            }
            kept.push(e);
        }
        tournament.eliminations = kept;
        return removed;
    }

    /**
     * Remove character-side eliminations whose (tournamentId,
     * fromMatchId) matches the given pair.
     */
    function removeCharacterEliminationsByMatch(appData, tournamentId, matchId) {
        var removedIds = [];
        if (!appData || !Array.isArray(appData.characters)) {
            return removedIds;
        }
        if (!isNonEmptyString(tournamentId) || !isNonEmptyString(matchId)) {
            return removedIds;
        }

        var targetTournament = String(tournamentId);
        var targetMatch = String(matchId);

        for (var i = 0; i < appData.characters.length; i++) {
            var char = appData.characters[i];
            if (!char || !Array.isArray(char.eliminations)) {
                continue;
            }

            var kept = [];
            var wasTouched = false;
            for (var j = 0; j < char.eliminations.length; j++) {
                var e = char.eliminations[j];
                if (e &&
                    e.standalone !== true &&
                    isNonEmptyString(e.tournamentId) &&
                    isNonEmptyString(e.fromMatchId) &&
                    String(e.tournamentId) === targetTournament &&
                    String(e.fromMatchId) === targetMatch) {
                    wasTouched = true;
                    continue;
                }
                kept.push(e);
            }

            if (wasTouched) {
                char.eliminations = kept;
                rebuildEliminatedWeeks(char);
                removedIds.push(String(char.id));
            }
        }

        return removedIds;
    }

    /**
     * Remove character-side eliminations whose (tournamentId,
     * fromRoundId) matches the given pair.
     */
    function removeCharacterEliminationsByRound(appData, tournamentId, roundId) {
        var removedIds = [];
        if (!appData || !Array.isArray(appData.characters)) {
            return removedIds;
        }
        if (!isNonEmptyString(tournamentId) || !isNonEmptyString(roundId)) {
            return removedIds;
        }

        var targetTournament = String(tournamentId);
        var targetRound = String(roundId);

        for (var i = 0; i < appData.characters.length; i++) {
            var char = appData.characters[i];
            if (!char || !Array.isArray(char.eliminations)) {
                continue;
            }

            var kept = [];
            var wasTouched = false;
            for (var j = 0; j < char.eliminations.length; j++) {
                var e = char.eliminations[j];
                if (e &&
                    e.standalone !== true &&
                    isNonEmptyString(e.tournamentId) &&
                    isNonEmptyString(e.fromRoundId) &&
                    String(e.tournamentId) === targetTournament &&
                    String(e.fromRoundId) === targetRound) {
                    wasTouched = true;
                    continue;
                }
                kept.push(e);
            }

            if (wasTouched) {
                char.eliminations = kept;
                rebuildEliminatedWeeks(char);
                removedIds.push(String(char.id));
            }
        }

        return removedIds;
    }

    /**
     * Remove character-side eliminations tied to a tournament, of any
     * provenance. This is the deleteTournament path: the tournament
     * is going away, so every non-standalone elimination keyed to it
     * must go too.
     *
     * Standalone eliminations (standalone === true) are not touched.
     */
    function removeCharacterEliminationsByTournament(appData, tournamentId) {
        var removedIds = [];
        if (!appData || !Array.isArray(appData.characters)) {
            return removedIds;
        }
        if (!isNonEmptyString(tournamentId)) {
            return removedIds;
        }

        var target = String(tournamentId);

        for (var i = 0; i < appData.characters.length; i++) {
            var char = appData.characters[i];
            if (!char || !Array.isArray(char.eliminations)) {
                continue;
            }

            var kept = [];
            var wasTouched = false;
            for (var j = 0; j < char.eliminations.length; j++) {
                var e = char.eliminations[j];
                if (e &&
                    e.standalone !== true &&
                    isNonEmptyString(e.tournamentId) &&
                    String(e.tournamentId) === target) {
                    wasTouched = true;
                    continue;
                }
                kept.push(e);
            }

            if (wasTouched) {
                char.eliminations = kept;
                rebuildEliminatedWeeks(char);
                removedIds.push(String(char.id));
            }
        }

        return removedIds;
    }

    // ============================================================
    // FAIL-RESULT EXTRACTION
    // ============================================================

    /**
     * Given a completed match, return the array of participant IDs
     * whose result is 'fail'.
     *
     * SEMANTICS:
     *   - group_exam: results[charId] === 'fail'
     *   - team_vs_team: individualResults[charId] === 'fail'
     *     (teamResults is not consulted; a team failing does not
     *      directly eliminate its members)
     *   - anything else: [] (standard is legacy and not supported)
     *
     * The returned array is de-duplicated and only contains IDs that
     * appear in match.participants[]. Results maps that contain
     * unknown keys are ignored for the purposes of this cascade.
     */
    function getFailingParticipantIds(match) {
        if (!match || typeof match !== 'object') {
            return [];
        }

        var type = match.type || 'group_exam';
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        var participantSet = Object.create(null);
        for (var i = 0; i < participants.length; i++) {
            var pid = isNonEmptyString(participants[i])
                ? String(participants[i])
                : '';
            if (pid !== '') {
                participantSet[pid] = true;
            }
        }

        var failures = [];
        var seen = Object.create(null);

        function addIfFailing(id) {
            if (!isNonEmptyString(id)) { return; }
            var key = String(id);
            if (!participantSet[key]) { return; }
            if (seen[key]) { return; }
            seen[key] = true;
            failures.push(key);
        }

        if (type === 'group_exam') {
            var results = isObject(match.results) ? match.results : {};
            var rKeys = Object.keys(results);
            for (var r = 0; r < rKeys.length; r++) {
                if (results[rKeys[r]] === 'fail') {
                    addIfFailing(rKeys[r]);
                }
            }
        } else if (type === 'team_vs_team') {
            var indResults = isObject(match.individualResults)
                ? match.individualResults
                : {};
            var iKeys = Object.keys(indResults);
            for (var k = 0; k < iKeys.length; k++) {
                if (indResults[iKeys[k]] === 'fail') {
                    addIfFailing(iKeys[k]);
                }
            }
        }
        // 'standard' and any unknown types produce no eliminations.

        return failures;
    }

    // ============================================================
    // PUBLIC API - WRITE
    // ============================================================

    /**
     * Apply eliminations for the failing participants of a completed
     * match.
     *
     * PURE with respect to appData: mutates the snapshot in place,
     * never touches window.data, never enters the pipeline.
     *
     * CONTRACT:
     *   - Writes one elimination per (characterId, tournamentId).
     *   - If an elimination for (characterId, tournamentId) already
     *     exists on either side, both sides are cleaned up first,
     *     then the new one is written. This is "last wins".
     *   - Every written elimination carries fromRoundId and
     *     fromMatchId.
     *   - character.eliminatedWeeks[] is rebuilt after any write.
     *   - Standalone eliminations are not touched.
     *   - Participants whose result is not 'fail' are not touched.
     *
     * @param {object} appData       - Pipeline snapshot
     * @param {object} tournament    - Live tournament reference in appData
     * @param {object} match         - Completed match (live reference)
     * @param {object} round         - Round containing the match
     * @param {number} week          - Elimination week (tournament endWeek)
     * @returns {object}             - Cascade counts
     */
    function applyFailEliminations(appData, tournament, match, round, week) {
        var result = {
            written: 0,
            replaced: 0,
            unchanged: 0,
            characterIds: [],
            error: null
        };

        if (!appData || typeof appData !== 'object') {
            result.error = 'appData is required.';
            return result;
        }
        if (!isObject(tournament)) {
            result.error = 'tournament is required.';
            return result;
        }
        if (!isObject(match)) {
            result.error = 'match is required.';
            return result;
        }
        if (!isObject(round)) {
            result.error = 'round is required.';
            return result;
        }

        var tournamentId = isNonEmptyString(tournament.id)
            ? String(tournament.id)
            : '';
        var matchId = isNonEmptyString(match.id)
            ? String(match.id)
            : '';
        var roundId = isNonEmptyString(round.id)
            ? String(round.id)
            : '';

        if (tournamentId === '' || matchId === '' || roundId === '') {
            result.error = 'Missing tournament, round, or match ID.';
            return result;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            result.error = 'Valid elimination week is required.';
            return result;
        }

        var failingIds = getFailingParticipantIds(match);
        if (failingIds.length === 0) {
            return result;
        }

        if (!Array.isArray(tournament.eliminations)) {
            tournament.eliminations = [];
        }

        var reason = buildReason(weekNum);

        for (var f = 0; f < failingIds.length; f++) {
            var charId = failingIds[f];

            // ---- Remove any existing elimination for this pair ----
            // Tournament side: remove by (participantId), regardless of
            // provenance, because there can be only one per pair.
            var tournamentKept = [];
            var tournamentTouched = false;
            for (var te = 0; te < tournament.eliminations.length; te++) {
                var tourE = tournament.eliminations[te];
                if (tourE &&
                    tourE.participantType === 'character' &&
                    isNonEmptyString(tourE.participantId) &&
                    String(tourE.participantId) === charId) {
                    tournamentTouched = true;
                    continue;
                }
                tournamentKept.push(tourE);
            }
            tournament.eliminations = tournamentKept;

            // Character side: remove by (tournamentId), regardless of
            // provenance.
            var char = findCharacterInSnapshot(appData, charId);
            var charTouched = false;
            if (char && Array.isArray(char.eliminations)) {
                var charKept = [];
                for (var ce = 0; ce < char.eliminations.length; ce++) {
                    var charE = char.eliminations[ce];
                    if (charE &&
                        charE.standalone !== true &&
                        isNonEmptyString(charE.tournamentId) &&
                        String(charE.tournamentId) === tournamentId) {
                        charTouched = true;
                        continue;
                    }
                    charKept.push(charE);
                }
                char.eliminations = charKept;
            }

            if (tournamentTouched || charTouched) {
                result.replaced++;
            }

            // ---- Write tournament-side record ----
            tournament.eliminations.push({
                participantId: charId,
                participantType: 'character',
                week: weekNum,
                reason: reason,
                fromRoundId: roundId,
                fromMatchId: matchId
            });

            // ---- Write character-side record ----
            if (char) {
                if (!Array.isArray(char.eliminations)) {
                    char.eliminations = [];
                }
                char.eliminations.push({
                    id: IdUtils.generateId('elim'),
                    tournamentId: tournamentId,
                    fromRoundId: roundId,
                    fromMatchId: matchId,
                    week: weekNum,
                    reason: reason,
                    standalone: false,
                    fromMatch: true
                });
                rebuildEliminatedWeeks(char);
            }

            result.written++;
            result.characterIds.push(charId);
        }

        return result;
    }

    // ============================================================
    // PUBLIC API - REVERSE
    // ============================================================

    /**
     * Reverse eliminations produced by a specific match.
     *
     * Called from removeMatch's mutate, BEFORE the match is spliced
     * out of the round.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseMatchEliminations(appData, tournament, matchId) {
        var result = { reversed: 0, characterIds: [] };

        if (!isObject(tournament) || !isNonEmptyString(matchId)) {
            return result;
        }

        var removed = removeTournamentEliminationsByMatch(
            tournament,
            matchId
        );
        if (removed.length === 0) {
            return result;
        }

        var tournamentId = isNonEmptyString(tournament.id)
            ? String(tournament.id)
            : '';

        var characterIds = removeCharacterEliminationsByMatch(
            appData,
            tournamentId,
            matchId
        );

        result.reversed = removed.length;
        result.characterIds = characterIds;
        return result;
    }

    /**
     * Reverse eliminations produced by every match in a round.
     *
     * Called from removeRound's mutate, BEFORE the round is spliced
     * out of the tournament.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseRoundEliminations(appData, tournament, roundId) {
        var result = { reversed: 0, characterIds: [] };

        if (!isObject(tournament) || !isNonEmptyString(roundId)) {
            return result;
        }

        var removed = removeTournamentEliminationsByRound(
            tournament,
            roundId
        );
        if (removed.length === 0) {
            return result;
        }

        var tournamentId = isNonEmptyString(tournament.id)
            ? String(tournament.id)
            : '';

        var characterIds = removeCharacterEliminationsByRound(
            appData,
            tournamentId,
            roundId
        );

        result.reversed = removed.length;
        result.characterIds = characterIds;
        return result;
    }

    /**
     * Reverse every non-standalone elimination keyed to a tournament
     * on the character side.
     *
     * Called from deleteTournament's mutate, BEFORE the tournament
     * record is spliced out. The tournament's own eliminations[]
     * disappears with the record, so only the character side needs
     * explicit cleanup.
     *
     * Standalone eliminations are NOT touched.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseTournamentEliminations(appData, tournamentId) {
        var result = { reversed: 0, characterIds: [] };

        if (!isNonEmptyString(tournamentId)) {
            return result;
        }

        var characterIds = removeCharacterEliminationsByTournament(
            appData,
            tournamentId
        );

        result.reversed = characterIds.length;
        result.characterIds = characterIds;
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentEliminationCascade = {
        applyFailEliminations: applyFailEliminations,
        reverseMatchEliminations: reverseMatchEliminations,
        reverseRoundEliminations: reverseRoundEliminations,
        reverseTournamentEliminations: reverseTournamentEliminations,

        // Exposed for testing only.
        getFailingParticipantIds: getFailingParticipantIds,
        rebuildEliminatedWeeks: rebuildEliminatedWeeks
    };

})();
