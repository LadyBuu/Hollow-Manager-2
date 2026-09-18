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
 * CACHE MAINTENANCE:
 *   character.eliminatedWeeks[] is a derived cache. Its single
 *   implementation lives in EliminationQueries.rebuildEliminatedWeeks.
 *   This module calls it after every write or removal. Both this
 *   module and AcademyEliminations share the one implementation.
 *
 * YEAR STAMPING (v25+):
 *   Every character-side elimination record carries a `year` — the
 *   year the character was eliminated. The year is resolved from the
 *   tournament's graduatingClassId → class.year. When the class year
 *   cannot be resolved, currentYear is used and a warning is logged.
 *
 *   The tournament-side record also carries `year` for consistency,
 *   though its primary key is still the tournament's own identity.
 *
 * PUBLIC OPERATIONS:
 *   applyFailEliminations(appData, tournament, match, round, week)
 *     Write eliminations for failing participants of a completed
 *     match. REQUIRES that every failing character exists in the
 *     snapshot. Missing characters fail the transaction.
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
 *   shiftTournamentEliminationWeeks(appData, tournamentId, newWeek)
 *     Set the `week` field on every tournament-driven elimination
 *     record for a tournament, on both sides. Used when a
 *     tournament's endWeek changes, because the elimination week is
 *     derived from endWeek and must move with it.
 *
 *   rebuildEliminatedWeeks(character)
 *     Forwarding wrapper. Delegates to
 *     EliminationQueries.rebuildEliminatedWeeks.
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
 *     - ARE touched by shiftTournamentEliminationWeeks (which is
 *       provenance-agnostic; the shift operates on all
 *       tournament-driven records for the tournament).
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
 *   v24 fix: unknown match types now THROW rather than falling
 *   through to group_exam semantics. A malformed record should fail
 *   the enclosing transaction, not generate pseudo-eliminations.
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
 *   shiftTournamentEliminationWeeks is idempotent for a given
 *   newWeek: calling it twice with the same value produces the same
 *   state as calling it once.
 *
 * CONTRACT ON INVALID INPUT:
 *   Invalid invocation (missing appData, missing tournament, missing
 *   match, missing round, invalid week, missing target character)
 *   THROWS. That is deliberate: these are internal transaction
 *   helpers, and a broken caller should fail the enclosing
 *   transaction, not silently return an empty result that the
 *   caller will ignore.
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
 *       shifted:  N,   // records updated in place (shift only)
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
 *   - window.IdUtils              (elimination record IDs on the
 *                                  character side)
 *   - window.CalendarValidation   (validating the elimination week)
 *   - window.EliminationQueries   (rebuildEliminatedWeeks)
 *
 * DEPENDENCIES (LAZY):
 *   - window.AcademyClasses       (resolving class years for the
 *                                  character-side elimination
 *                                  record)
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
    var EliminationQueries = window.EliminationQueries;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.rebuildEliminatedWeeks !== 'function') {
        _missing.push('EliminationQueries.rebuildEliminatedWeeks');
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
     * Delegates to EliminationQueries.rebuildEliminatedWeeks, which is
     * the single implementation shared by this module and
     * AcademyEliminations.
     *
     * Exposed on this module's public surface as a forwarding wrapper
     * for callers that already reference it here.
     */
    function rebuildEliminatedWeeks(character) {
        EliminationQueries.rebuildEliminatedWeeks(character);
    }

    // ============================================================
    // YEAR RESOLUTION
    // ============================================================
    //
    // Every character-side elimination record carries a `year` — the
    // year the character was eliminated. Resolution order:
    //
    //   1. The tournament's graduatingClassId → class.year.
    //   2. window.data.currentYear.
    //   3. The current calendar year.
    //
    // Step 2 logs a warning. A missing class year is a data-quality
    // signal, not a silent default.

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function resolveEliminationYear(appData, tournament) {
        if (tournament && tournament.graduatingClassId && appData &&
            appData.academy && appData.academy.graduatingClasses) {
            var cls = appData.academy.graduatingClasses[
                String(tournament.graduatingClassId)
            ];
            if (cls) {
                var clsYear = parseInt(cls.year, 10);
                if (!isNaN(clsYear) && clsYear > 0) {
                    return clsYear;
                }
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            console.warn(
                '[TournamentEliminationCascade] Tournament "' +
                (tournament ? tournament.id : 'unknown') +
                '" has no resolvable class year. Falling back to ' +
                'currentYear (' + data.currentYear + ').'
            );
            return Math.floor(data.currentYear);
        }

        console.warn(
            '[TournamentEliminationCascade] Tournament "' +
            (tournament ? tournament.id : 'unknown') +
            '" has no resolvable class year and no currentYear is ' +
            'set. Using calendar year.'
        );
        return new Date().getFullYear();
    }

    // ============================================================
    // FAIL-RESULT EXTRACTION
    // ============================================================

    /**
     * Given a completed match, return the array of CHARACTER IDs
     * whose result is 'fail'.
     *
     * SEMANTICS (v21 + v24):
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
     * [FIX-C3] Unknown match types THROW. Previously they fell
     * through to group_exam semantics, which could generate nonsense
     * eliminations from malformed data. This is an internal
     * transaction helper; a contract violation should fail the
     * enclosing transaction.
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

        var type = match.type;
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

        if (type === 'group_exam') {
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

        // [FIX-C3] Unknown type. Do NOT guess.
        throw new Error(
            '[TournamentEliminationCascade] Unsupported match type: "' +
            type + '". Expected "group_exam" or "team_vs_team".'
        );
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
     * [FIX-C1] The predicate receives BOTH the elimination record
     * AND the containing character. This makes it possible to scope
     * a removal to a specific character, which the manual-restore
     * path needs. Previously the predicate only saw the elimination,
     * so a restore by (tournamentId, characterId) had no way to
     * check the character ID and removed the tournament's
     * eliminations from every character.
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
                if (e && predicate(e, char)) {
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
     *   - Every written elimination carries a `year`, resolved from
     *     the tournament's class context.
     *   - character.eliminatedWeeks[] is rebuilt after any write.
     *   - Standalone eliminations are NOT touched.
     *
     * [FIX-C2] Every failing character MUST exist in the snapshot.
     * If a character ID does not resolve, this function THROWS. The
     * previous behaviour (silently skip the character-side write and
     * still report written: 1) could produce a "successful"
     * elimination that only half-existed — tournament-side record
     * present, character-side record absent. That asymmetry is
     * exactly the shape that lets an eliminated character still
     * appear in Academy eligibility views.
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

        var yearNum = resolveEliminationYear(appData, tournament);

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

            // [FIX-C2] Character MUST exist. Enforce both-sides-or-throw.
            var char = findCharacterInSnapshot(appData, charId);
            if (!char) {
                throw new Error(
                    '[TournamentEliminationCascade] Cannot apply ' +
                    'elimination: character "' + charId + '" was not ' +
                    'found in the transaction snapshot. The elimination ' +
                    'cannot be written on both sides, and a one-sided ' +
                    'write would leave the tournament and character ' +
                    'records inconsistent.'
                );
            }

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
            var charRemoved = 0;
            if (Array.isArray(char.eliminations)) {
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
                year: yearNum,
                week: weekNum,
                reason: reason,
                fromRoundId: roundId,
                fromMatchId: matchId
            });

            // ---- Write character-side record ----
            // The character is guaranteed to exist by [FIX-C2].
            if (!Array.isArray(char.eliminations)) {
                char.eliminations = [];
            }
            char.eliminations.push({
                id: IdUtils.generateId('elim'),
                tournamentId: tournamentId,
                fromRoundId: roundId,
                fromMatchId: matchId,
                year: yearNum,
                week: weekNum,
                reason: reason,
                standalone: false,
                fromMatch: true
            });
            rebuildEliminatedWeeks(char);

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
     * [FIX-C1] Character-side removal is scoped to BOTH the
     * tournament AND the target character. The previous version
     * checked only the tournament ID, so restoring one character
     * from a tournament also removed every other character's
     * eliminations for that tournament.
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
        // [FIX-C1] The predicate now receives the containing
        // character, so the removal is scoped to BOTH IDs.
        var characterResult = removeCharacterEliminationsBy(
            appData,
            function(e, character) {
                if (e.standalone === true) { return false; }
                if (normaliseId(e.tournamentId) !== tId) { return false; }
                return normaliseId(character.id) === cId;
            }
        );

        return {
            reversed: tournamentResult.count + characterResult.count,
            characterIds: characterResult.characterIds
        };
    }

    // ============================================================
    // WEEK SHIFT (T8)
    // ============================================================
    //
    // WHY THIS EXISTS:
    //   The elimination week is not an independent fact. It is
    //   derived from the tournament's endWeek at the moment the
    //   elimination is written (see applyFailEliminations, which
    //   reads `week` from the caller and the caller passes
    //   tournament.endWeek). When the tournament's endWeek changes,
    //   every elimination written by this mechanism must move with
    //   it, on both sides, or the two views of "when was this
    //   character eliminated" drift apart.
    //
    //   The alternative — "eliminations keep the week they were
    //   created with" — is wrong here, because it would leave every
    //   elimination record stamped with a week that no longer
    //   matches the exam it belongs to. Any UI that surfaces
    //   "eliminated on week X" would show an X that disagrees with
    //   the exam header.
    //
    // SCOPE:
    //   - Tournament-side: every record in
    //     tournament.eliminations[]. All of them belong to this
    //     tournament, all of them were stamped with this
    //     tournament's endWeek, so all of them move.
    //
    //   - Character-side: every record in character.eliminations[]
    //     where tournamentId matches AND standalone !== true.
    //     Standalone eliminations (Drop Out) are user-authored
    //     facts and must not move.
    //
    // SEMANTICS:
    //   The shift SETS the week to newWeek. It does not add a delta
    //   to the existing week. The elimination week is defined as
    //   "the tournament's endWeek", so it moves to the new
    //   endWeek, unconditionally.
    //
    // IDEMPOTENCE:
    //   Calling twice with the same newWeek produces the same state
    //   as calling once.
    //
    // CACHE:
    //   character.eliminatedWeeks[] is rebuilt on every touched
    //   character.

    /**
     * Set the `week` field on every tournament-driven elimination
     * record for a tournament, on both sides.
     *
     * TRANSACTION-LOCAL. Mutates appData in place.
     *
     * @param {object} appData      - Pipeline snapshot
     * @param {string} tournamentId - The tournament whose
     *   eliminations should shift
     * @param {number|string} newWeek - The new week; integer in
     *   [MIN_WEEK, MAX_WEEK]
     * @returns {object} { shifted, characterIds }
     *   - shifted is the number of elimination RECORDS updated on
     *     both sides combined.
     *   - characterIds is the list of characters whose
     *     eliminatedWeeks cache was rebuilt.
     */
    function shiftTournamentEliminationWeeks(
        appData,
        tournamentId,
        newWeek
    ) {
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

        var weekNum = CalendarValidation.parseWeek(newWeek);
        if (weekNum === null) {
            throw new Error(
                '[TournamentEliminationCascade] Valid new week is ' +
                'required. Got: ' + newWeek
            );
        }

        var tId = normaliseId(tournamentId);

        var result = {
            shifted: 0,
            characterIds: []
        };

        // ---- 1. Tournament side ----
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

        if (tournament && Array.isArray(tournament.eliminations)) {
            for (var te = 0; te < tournament.eliminations.length; te++) {
                var tourE = tournament.eliminations[te];
                if (!tourE || typeof tourE !== 'object') { continue; }
                if (tourE.week === weekNum) { continue; }
                tourE.week = weekNum;
                result.shifted++;
            }
        }

        // ---- 2. Character side ----
        if (Array.isArray(appData.characters)) {
            for (var c = 0; c < appData.characters.length; c++) {
                var char = appData.characters[c];
                if (!char || !Array.isArray(char.eliminations)) {
                    continue;
                }

                var touched = false;
                for (var ce = 0;
                     ce < char.eliminations.length;
                     ce++) {
                    var charE = char.eliminations[ce];
                    if (!charE || typeof charE !== 'object') { continue; }
                    if (charE.standalone === true) { continue; }
                    if (normaliseId(charE.tournamentId) !== tId) {
                        continue;
                    }
                    if (charE.week === weekNum) { continue; }
                    charE.week = weekNum;
                    result.shifted++;
                    touched = true;
                }

                if (touched) {
                    rebuildEliminatedWeeks(char);
                    result.characterIds.push(String(char.id));
                }
            }
        }

        return result;
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

        // Week shift (T8)
        shiftTournamentEliminationWeeks:
            shiftTournamentEliminationWeeks,

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
            'shiftTournamentEliminationWeeks',
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
