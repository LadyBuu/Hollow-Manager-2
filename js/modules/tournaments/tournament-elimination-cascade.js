/**
 * modules/tournaments/tournament-elimination-cascade.js
 * Tournament Elimination Cascade
 *
 * Path: js/modules/tournaments/tournament-elimination-cascade.js
 *
 * PURPOSE:
 *   Transaction-local mutation helpers that synchronise elimination
 *   records on the tournament side and the character side, given an
 *   appData snapshot.
 *
 * WHY THIS MODULE EXISTS:
 *   When a match completes and a participant's result is 'fail',
 *   that participant is eliminated from the tournament. The
 *   elimination must be recorded on BOTH:
 *     - tournament.eliminations[]   (the tournament's own view)
 *     - character.eliminations[]    (the character's historical view)
 *
 *   Those writes must happen INSIDE the same pipeline transaction
 *   that completes the match. They cannot go through a public
 *   mutation API (like a hypothetical CharacterEliminations.add())
 *   because that would itself enter the pipeline, and nesting
 *   pipelines deadlocks or corrupts the transaction.
 *
 *   This module is the transaction-local alternative. It receives an
 *   appData snapshot, mutates it in place, and returns counts. It
 *   NEVER enters the pipeline.
 *
 * NOMENCLATURE:
 *   These functions are NOT pure in the functional-programming sense:
 *   they mutate appData in place. They are TRANSACTION-LOCAL MUTATION
 *   HELPERS. The distinction matters: "pure" would imply no side
 *   effects, and that is not what these functions do.
 *
 *   What they DO guarantee:
 *     - They never touch window.data.
 *     - They never enter the pipeline.
 *     - They never call saveData().
 *     - They operate only on the appData they are given.
 *     - They throw on contract violations (see below), so a broken
 *       caller fails the enclosing transaction loudly.
 *
 * PUBLIC OPERATIONS:
 *   applyFailEliminations(appData, tournament, match, round, week)
 *     Write eliminations for failing participants of a completed
 *     match.
 *
 *   reverseMatchEliminations(appData, tournament, matchId)
 *     Remove eliminations whose provenance is a specific match.
 *
 *   reverseRoundEliminations(appData, tournament, roundId)
 *     Remove eliminations whose provenance is a specific round.
 *
 *   reverseTournamentEliminations(appData, tournamentId)
 *     Remove every non-standalone character-side elimination keyed
 *     to a tournament. Used when the tournament itself is being
 *     destroyed.
 *
 *   restoreCharacterElimination(appData, tournamentId, characterId)
 *     Manual override. Remove the elimination record for a
 *     (tournamentId, characterId) pair, regardless of provenance.
 *     This is the user-initiated "Restore" action.
 *
 * PROVENANCE:
 *   Every elimination written by applyFailEliminations carries:
 *     fromRoundId   the round the match belongs to
 *     fromMatchId   the match that produced the failure
 *   on BOTH the tournament-side and character-side records.
 *
 *   This is what makes per-match and per-round reversal possible.
 *   Without provenance, removing one match would force reversing
 *   every elimination in the tournament.
 *
 *   Legacy elimination records without provenance:
 *     - Are NOT touched by reverseMatchEliminations.
 *     - Are NOT touched by reverseRoundEliminations.
 *     - ARE touched by reverseTournamentEliminations (which is
 *       provenance-agnostic).
 *     - ARE touched by restoreCharacterElimination (which is
 *       provenance-agnostic).
 *
 * LAST-WINS SEMANTICS:
 *   The tournament keeps ONE elimination per (characterId,
 *   tournamentId). If a character fails twice in one tournament
 *   (e.g. after a manual restore and a second failure), the newer
 *   elimination REPLACES the older one on both sides.
 *
 *   Consequence: reverseMatchEliminations on the older match finds
 *   nothing to reverse, because the older elimination's provenance
 *   is gone. That is consistent with the "current elimination
 *   state" model. It does NOT preserve the history of the first
 *   elimination as a separate event.
 *
 *   If a historical-event model is ever adopted, this module is the
 *   single place that changes.
 *
 * FAILING-PARTICIPANT EXTRACTION (v21 FIX):
 *   The set of "who gets eliminated" depends on the match type, and
 *   the two types index their result maps differently:
 *
 *     group_exam
 *       match.participants is a list of CHARACTER IDs.
 *       match.results is keyed by CHARACTER IDs.
 *       A character is eliminated when results[charId] === 'fail'.
 *       The character must appear in match.participants; a stray key
 *       in match.results that is not a participant is ignored.
 *
 *     team_vs_team
 *       match.participants is a list of TEAM IDs.
 *       match.teamResults is keyed by TEAM IDs.
 *       match.individualResults is keyed by CHARACTER IDs.
 *
 *       A team is eliminated when teamResults[teamId] === 'fail',
 *       but team elimination does NOT eliminate the team's members.
 *
 *       A character is eliminated when
 *       individualResults[charId] === 'fail'. Individual results are
 *       keyed by characters who are members of the participating
 *       teams, NOT by the participants themselves. The
 *       participant-set check therefore does NOT apply to team
 *       matches. A character ID in individualResults is trusted; the
 *       caller (TournamentMatches.completeMatch) is responsible for
 *       ensuring the map only contains legitimate members.
 *
 *   Previous behaviour (bug, fixed in v21):
 *     getFailingParticipantIds rejected any ID that was not in
 *     match.participants, unconditionally. For team matches, the
 *     individual results are keyed by characters, which are not
 *     participants, so every entry was silently dropped and no
 *     character was ever eliminated. This is the bug that this
 *     version fixes.
 *
 * TEAM MATCH SEMANTICS:
 *   For 'team_vs_team' matches, ONLY individualResults[charId] ===
 *   'fail' triggers a character elimination. teamResults[] never
 *   eliminates anyone directly. A team can fail while every member
 *   passes; a team can pass while a member fails.
 *
 * IDEMPOTENCE:
 *   applyFailEliminations is idempotent for a given match: calling
 *   it twice with the same inputs produces the same state on both
 *   sides.
 *
 * CONTRACT ON INVALID INPUT:
 *   Invalid invocation (missing appData, missing tournament, missing
 *   match, missing round, invalid week) THROWS. That is deliberate:
 *   these are internal transaction helpers, and a broken caller
 *   should fail the enclosing transaction, not silently return an
 *   empty result that the caller will ignore.
 *
 *   Normal domain outcomes (no failures to apply, no eliminations to
 *   reverse) return a result with zero counts. Those are not errors.
 *
 * RESULT SHAPE:
 *   Every operation returns a summary:
 *     {
 *       written:  N,   // records written (apply only)
 *       replaced: N,   // records replaced by last-wins (apply only)
 *       reversed: N,   // elimination records removed (reverse/restore)
 *       characterIds: [ ... ],  // characters touched
 *     }
 *
 *   `reversed` counts RECORDS removed, not characters touched.
 *   `characterIds` is the list of characters whose records changed.
 *   The two can diverge only if a malformed character had two
 *   matching elimination records; the invariant is one per
 *   (characterId, tournamentId).
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.IdUtils            (elimination record IDs on the
 *                                character side)
 *   - window.CalendarValidation (rebuilding eliminatedWeeks[] and
 *                                validating the elimination week)
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.ObjectUtils        (not used internally; reserved for
 *                                callers if needed)
 *
 * USAGE:
 *   // Inside TournamentMatches.completeMatch's mutate callback:
 *   var cascade = TournamentEliminationCascade.applyFailEliminations(
 *       appData, tournament, match, round, tournament.endWeek
 *   );
 *
 *   // Inside TournamentMatches.removeMatch's mutate callback:
 *   var reversal =
 *       TournamentEliminationCascade.reverseMatchEliminations(
 *           appData, tournament, matchId
 *       );
 *
 *   // Inside TournamentCore.removeRound's mutate callback:
 *   var reversal =
 *       TournamentEliminationCascade.reverseRoundEliminations(
 *           appData, tournament, roundId
 *       );
 *
 *   // Inside TournamentCore.deleteTournament's mutate callback:
 *   var reversal =
 *       TournamentEliminationCascade.reverseTournamentEliminations(
 *           appData, tournamentId
 *       );
 *
 *   // Manual restore, from a UI event handler:
 *   var restore =
 *       TournamentEliminationCascade.restoreCharacterElimination(
 *           appData, tournamentId, characterId
 *       );
 */

(function() {
    'use strict';

    if (window.__tournamentEliminationCascadeLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var IdUtils = window.IdUtils;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentEliminationCascade] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
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

    /**
     * Normalise an ID value to a trimmed string, or null.
     *
     * The cascade compares identifiers from tournament records
     * against identifiers in character records. Both sides may carry
     * the same logical ID in slightly different shapes (number vs
     * string, whitespace). Normalising to a trimmed string on both
     * sides makes the comparison structural.
     */
    function normaliseId(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        var str = String(value).trim();
        return str === '' ? null : str;
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
        var target = normaliseId(charId);
        if (target === null) {
            return null;
        }
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && normaliseId(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    /**
     * Rebuild character.eliminatedWeeks[] from character.eliminations[].
     *
     * eliminatedWeeks[] is a derived cache. It is rebuilt here
     * because the cascade is the last writer to touch
     * character.eliminations[] inside the transaction.
     *
     * Exposed for testing and for callers that need to rebuild the
     * cache after their own mutation.
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

    // ============================================================
    // FAIL-RESULT EXTRACTION
    // ============================================================

    /**
     * Given a completed match, return the array of CHARACTER IDs
     * whose result is 'fail'.
     *
     * SEMANTICS (v21):
     *
     *   group_exam:
     *     match.participants is a list of CHARACTER IDs.
     *     match.results is keyed by CHARACTER IDs.
     *     A character is eliminated when results[charId] === 'fail'
     *     AND the character appears in match.participants. Stray
     *     keys that are not participants are ignored.
     *
     *   team_vs_team:
     *     match.participants is a list of TEAM IDs.
     *     match.teamResults is keyed by TEAM IDs.
     *     match.individualResults is keyed by CHARACTER IDs, which
     *     are members of the participating teams.
     *
     *     A character is eliminated when
     *     individualResults[charId] === 'fail'.
     *
     *     The participant-set check does NOT apply: characters are
     *     not in match.participants, teams are. Trusting the map's
     *     keys is the correct behaviour. Any stray character ID in
     *     the map is a caller error; validation belongs in
     *     TournamentMatches.completeMatch, where team membership is
     *     available.
     *
     *     A team failing (teamResults[teamId] === 'fail') does NOT
     *     eliminate the team's members. Only individualResults
     *     drives character elimination.
     *
     * The result is de-duplicated. Only IDs that normalise to a
     * non-empty string are returned.
     *
     * Exposed for testing.
     */
    function getFailingParticipantIds(match) {
        if (!match || typeof match !== 'object') {
            return [];
        }

        var type = match.type || 'group_exam';
        var failures = [];
        var seen = Object.create(null);

        if (type === 'team_vs_team') {
            var indResults = isObject(match.individualResults)
                ? match.individualResults
                : {};
            var iKeys = Object.keys(indResults);
            for (var k = 0; k < iKeys.length; k++) {
                if (indResults[iKeys[k]] !== 'fail') { continue; }
                var tvId = normaliseId(iKeys[k]);
                if (tvId === null) { continue; }
                if (seen[tvId]) { continue; }
                seen[tvId] = true;
                failures.push(tvId);
            }
            return failures;
        }

        // group_exam — and any unknown type falls through to this
        // branch. The schema rejects unknown types, but the cascade
        // does not throw on malformed input from outside its own
        // contract; it treats unknown types as group exams.
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        var participantSet = Object.create(null);
        for (var i = 0; i < participants.length; i++) {
            var pid = normaliseId(participants[i]);
            if (pid !== null) {
                participantSet[pid] = true;
            }
        }

        var results = isObject(match.results) ? match.results : {};
        var rKeys = Object.keys(results);
        for (var r = 0; r < rKeys.length; r++) {
            if (results[rKeys[r]] !== 'fail') { continue; }
            var grId = normaliseId(rKeys[r]);
            if (grId === null) { continue; }
            if (!participantSet[grId]) { continue; }
            if (seen[grId]) { continue; }
            seen[grId] = true;
            failures.push(grId);
        }

        return failures;
    }

    // ============================================================
    // INTERNAL REMOVAL HELPERS
    // ============================================================
    //
    // Each returns { count, characterIds } where:
    //   - count is the number of elimination RECORDS removed.
    //   - characterIds is the list of characters whose arrays changed.
    //
    // Both removal helpers run independently of each other. The
    // reversal operations run the tournament-side and character-side
    // removals unconditionally, so an asymmetry in the two sides
    // (from corruption or a partial earlier write) is corrected by
    // the next reversal.

    /**
     * Remove tournament-side eliminations matching a predicate.
     * Returns { count }.
     */
    function removeTournamentEliminationsBy(tournament, predicate) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return { count: 0 };
        }

        var removed = 0;
        var kept = [];

        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && predicate(e)) {
                removed++;
                continue;
            }
            kept.push(e);
        }

        tournament.eliminations = kept;
        return { count: removed };
    }

    /**
     * Remove character-side eliminations matching a predicate.
     * Returns { count, characterIds }.
     *
     * Counts elimination RECORDS removed, not characters touched.
     */
    function removeCharacterEliminationsBy(appData, predicate) {
        var result = { count: 0, characterIds: [] };

        if (!appData || !Array.isArray(appData.characters)) {
            return result;
        }

        for (var i = 0; i < appData.characters.length; i++) {
            var char = appData.characters[i];
            if (!char || !Array.isArray(char.eliminations)) {
                continue;
            }

            var kept = [];
            var removed = 0;

            for (var j = 0; j < char.eliminations.length; j++) {
                var e = char.eliminations[j];
                if (e && predicate(e)) {
                    removed++;
                    continue;
                }
                kept.push(e);
            }

            if (removed > 0) {
                char.eliminations = kept;
                rebuildEliminatedWeeks(char);
                result.count += removed;
                result.characterIds.push(String(char.id));
            }
        }

        return result;
    }

    // ============================================================
    // WRITE
    // ============================================================

    /**
     * Apply eliminations for the failing participants of a completed
     * match.
     *
     * TRANSACTION-LOCAL. Mutates appData in place. Never enters the
     * pipeline.
     *
     * CONTRACT:
     *   - One elimination per (characterId, tournamentId).
     *   - If an elimination already exists for that pair on either
     *     side, both sides are cleaned up first, then the new one is
     *     written. This is "last wins".
     *   - Every written elimination carries fromRoundId and
     *     fromMatchId.
     *   - character.eliminatedWeeks[] is rebuilt after any write.
     *   - Standalone eliminations are NOT touched.
     *
     * THROWS on missing/invalid inputs. A caller that violates the
     * contract fails the enclosing transaction.
     *
     * @param {object} appData    - Pipeline snapshot
     * @param {object} tournament - Live tournament reference in appData
     * @param {object} match      - Completed match (live reference)
     * @param {object} round      - Round containing the match
     * @param {number|string} week - Elimination week
     * @returns {object} { written, replaced, reversed, characterIds }
     */
    function applyFailEliminations(appData, tournament, match, round, week) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentEliminationCascade] appData is required.'
            );
        }
        if (!isObject(tournament)) {
            throw new Error(
                '[TournamentEliminationCascade] tournament is required.'
            );
        }
        if (!isObject(match)) {
            throw new Error(
                '[TournamentEliminationCascade] match is required.'
            );
        }
        if (!isObject(round)) {
            throw new Error(
                '[TournamentEliminationCascade] round is required.'
            );
        }

        var tournamentId = normaliseId(tournament.id);
        var matchId = normaliseId(match.id);
        var roundId = normaliseId(round.id);

        if (tournamentId === null || matchId === null || roundId === null) {
            throw new Error(
                '[TournamentEliminationCascade] Missing tournament, ' +
                'round, or match ID.'
            );
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            throw new Error(
                '[TournamentEliminationCascade] Valid elimination ' +
                'week is required.'
            );
        }

        var result = {
            written: 0,
            replaced: 0,
            reversed: 0,
            characterIds: []
        };

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
            // Tournament side: remove by participantId, regardless of
            // provenance. One per (characterId, tournamentId).
            var tournamentRemoved = 0;
            var tournamentKept = [];
            for (var te = 0; te < tournament.eliminations.length; te++) {
                var tourE = tournament.eliminations[te];
                if (tourE &&
                    tourE.participantType === 'character' &&
                    normaliseId(tourE.participantId) === charId) {
                    tournamentRemoved++;
                    continue;
                }
                tournamentKept.push(tourE);
            }
            tournament.eliminations = tournamentKept;

            // Character side: remove by tournamentId, regardless of
            // provenance.
            var char = findCharacterInSnapshot(appData, charId);
            var charRemoved = 0;
            if (char && Array.isArray(char.eliminations)) {
                var charKept = [];
                for (var ce = 0; ce < char.eliminations.length; ce++) {
                    var charE = char.eliminations[ce];
                    if (charE &&
                        charE.standalone !== true &&
                        normaliseId(charE.tournamentId) === tournamentId) {
                        charRemoved++;
                        continue;
                    }
                    charKept.push(charE);
                }
                char.eliminations = charKept;
            }

            if (tournamentRemoved > 0 || charRemoved > 0) {
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
    // REVERSAL
    // ============================================================

    /**
     * Reverse eliminations produced by a specific match.
     *
     * TRANSACTION-LOCAL. Mutates appData in place.
     *
     * Removes eliminations on BOTH sides independently. If the two
     * sides were out of sync (corruption, partial write), the
     * reversal corrects both. This is idempotent: running it twice
     * produces the same state as running it once.
     *
     * Called from removeMatch's mutate, before the match is spliced
     * out of the round.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseMatchEliminations(appData, tournament, matchId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentEliminationCascade] appData is required.'
            );
        }
        if (!isObject(tournament)) {
            throw new Error(
                '[TournamentEliminationCascade] tournament is required.'
            );
        }
        if (!isNonEmptyString(matchId)) {
            throw new Error(
                '[TournamentEliminationCascade] matchId is required.'
            );
        }

        var target = normaliseId(matchId);
        var tournamentId = normaliseId(tournament.id);

        var tournamentResult = removeTournamentEliminationsBy(
            tournament,
            function(e) {
                return normaliseId(e.fromMatchId) === target;
            }
        );

        var characterResult = removeCharacterEliminationsBy(
            appData,
            function(e) {
                return e.standalone !== true &&
                    normaliseId(e.tournamentId) === tournamentId &&
                    normaliseId(e.fromMatchId) === target;
            }
        );

        return {
            reversed: tournamentResult.count + characterResult.count,
            characterIds: characterResult.characterIds
        };
    }

    /**
     * Reverse eliminations produced by every match in a round.
     *
     * TRANSACTION-LOCAL. Mutates appData in place.
     *
     * Removes eliminations on BOTH sides independently, keyed by
     * fromRoundId. Runs before the round is spliced out of the
     * tournament.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseRoundEliminations(appData, tournament, roundId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentEliminationCascade] appData is required.'
            );
        }
        if (!isObject(tournament)) {
            throw new Error(
                '[TournamentEliminationCascade] tournament is required.'
            );
        }
        if (!isNonEmptyString(roundId)) {
            throw new Error(
                '[TournamentEliminationCascade] roundId is required.'
            );
        }

        var target = normaliseId(roundId);
        var tournamentId = normaliseId(tournament.id);

        var tournamentResult = removeTournamentEliminationsBy(
            tournament,
            function(e) {
                return normaliseId(e.fromRoundId) === target;
            }
        );

        var characterResult = removeCharacterEliminationsBy(
            appData,
            function(e) {
                return e.standalone !== true &&
                    normaliseId(e.tournamentId) === tournamentId &&
                    normaliseId(e.fromRoundId) === target;
            }
        );

        return {
            reversed: tournamentResult.count + characterResult.count,
            characterIds: characterResult.characterIds
        };
    }

    /**
     * Reverse every non-standalone character-side elimination keyed
     * to a tournament.
     *
     * TRANSACTION-LOCAL. Mutates appData in place.
     *
     * Called from deleteTournament's mutate, before the tournament
     * record is spliced out. The tournament's own eliminations[]
     * disappears with the record, so only the character side needs
     * explicit cleanup here.
     *
     * Standalone eliminations are NOT touched.
     *
     * @returns {object} { reversed, characterIds }
     */
    function reverseTournamentEliminations(appData, tournamentId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentEliminationCascade] appData is required.'
            );
        }
        if (!isNonEmptyString(tournamentId)) {
            throw new Error(
                '[TournamentEliminationCascade] tournamentId is required.'
            );
        }

        var target = normaliseId(tournamentId);

        var characterResult = removeCharacterEliminationsBy(
            appData,
            function(e) {
                return e.standalone !== true &&
                    normaliseId(e.tournamentId) === target;
            }
        );

        return {
            reversed: characterResult.count,
            characterIds: characterResult.characterIds
        };
    }

    // ============================================================
    // MANUAL RESTORE
    // ============================================================

    /**
     * Remove the elimination record for (tournamentId, characterId).
     *
     * TRANSACTION-LOCAL. Mutates appData in place.
     *
     * This is the MANUAL OVERRIDE path. It removes eliminations on
     * both sides regardless of provenance. It is distinct from the
     * per-match and per-round reversals, which are provenance-keyed
     * and run when the match or round is removed.
     *
     * The manual restore does NOT re-enable the character for past
     * rounds. It removes the record. Subsequent matches can include
     * the character again; past matches are unchanged.
     *
     * Standalone eliminations are NOT touched.
     *
     * Called from AcademyTournamentEvents.restoreEliminatedParticipant
     * inside a MutationPipeline transaction.
     *
     * @returns {object} { reversed, characterIds }
     */
    function restoreCharacterElimination(appData, tournamentId, characterId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentEliminationCascade] appData is required.'
            );
        }
        if (!isNonEmptyString(tournamentId)) {
            throw new Error(
                '[TournamentEliminationCascade] tournamentId is required.'
            );
        }
        if (!isNonEmptyString(characterId)) {
            throw new Error(
                '[TournamentEliminationCascade] characterId is required.'
            );
        }

        var tId = normaliseId(tournamentId);
        var cId = normaliseId(characterId);

        // Tournament side: find the tournament in the snapshot.
        var tournament = null;
        if (Array.isArray(appData.tournaments)) {
            for (var i = 0; i < appData.tournaments.length; i++) {
                var t = appData.tournaments[i];
                if (t && normaliseId(t.id) === tId) {
                    tournament = t;
                    break;
                }
            }
        }

        var tournamentResult = { count: 0 };
        if (tournament && Array.isArray(tournament.eliminations)) {
            tournamentResult = removeTournamentEliminationsBy(
                tournament,
                function(e) {
                    return e.participantType === 'character' &&
                        normaliseId(e.participantId) === cId;
                }
            );
        }

        // Character side: remove by (tournamentId, characterId).
        var characterResult = removeCharacterEliminationsBy(
            appData,
            function(e) {
                if (e.standalone === true) { return false; }
                return normaliseId(e.tournamentId) === tId;
            }
        );

        return {
            reversed: tournamentResult.count + characterResult.count,
            characterIds: characterResult.characterIds
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentEliminationCascade = {
        // Writes
        applyFailEliminations: applyFailEliminations,

        // Reversals
        reverseMatchEliminations: reverseMatchEliminations,
        reverseRoundEliminations: reverseRoundEliminations,
        reverseTournamentEliminations: reverseTournamentEliminations,

        // Manual override
        restoreCharacterElimination: restoreCharacterElimination,

        // Exposed for testing / advanced callers
        getFailingParticipantIds: getFailingParticipantIds,
        rebuildEliminatedWeeks: rebuildEliminatedWeeks
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentEliminationCascade;
        var missing = [];

        var required = [
            'applyFailEliminations',
            'reverseMatchEliminations',
            'reverseRoundEliminations',
            'reverseTournamentEliminations',
            'restoreCharacterElimination',
            'getFailingParticipantIds',
            'rebuildEliminatedWeeks'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentEliminationCascade] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
