/**
 * modules/tournaments/tournament-cascade.js - Tournament Cascade
 *
 * Path: js/modules/tournaments/tournament-cascade.js
 *
 * Transaction-local cleanup helpers for the tournament domain when
 * a character is deleted.
 *
 * WHAT THIS MODULE OWNS:
 *   Removing every reference to a deleted character from the
 *   tournament domain, operating on the caller's appData snapshot.
 *   The reference shapes are:
 *
 *     tournament.participants[]                    { id, type }
 *     tournament.eliminations[]                    { participantId, participantType, ... }
 *     round.matches[].participants[]               character IDs
 *     round.matches[].results{}                    character IDs as keys
 *     round.matches[].individualResults{}          character IDs as keys
 *     character.eliminations[]                     the mirror on the
 *                                                  character side
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The transaction. The caller (CharacterCRUD.deleteCharacter or
 *     AcademyCascade.characterDeleted) owns the pipeline entry.
 *     This module never calls MutationPipeline.performMutation.
 *   - The character-side elimination mirror write/remove logic.
 *     TournamentEliminationCascade owns that. This module composes
 *     with it: it calls reverseTournamentEliminations for each
 *     tournament whose tournament-side elimination records were
 *     actually affected.
 *   - Match generation, completion, or status transitions.
 *   - Storage. Reads and writes go through the appData snapshot;
 *     window.data is never touched.
 *
 * HISTORY:
 *   This module exists because TournamentCore had no
 *   stripCharacterRefs export, and AcademyCascade.characterDeleted
 *   silently skipped the tournament domain as a result. Character
 *   deletion left orphan participant IDs, elimination records,
 *   and match slots behind. The skip-warning added to
 *   AcademyCascade.runStripHelper surfaced the gap; this module
 *   closes it.
 *
 * ARCHITECTURE:
 *
 *     TournamentCore
 *       └─ stripCharacterRefs(appData, charId)   delegator
 *            └─ TournamentCascade.stripCharacterRefs(appData, charId)
 *                 ├─ tournament.participants[]
 *                 ├─ tournament.eliminations[]
 *                 ├─ round.matches[].participants[]
 *                 ├─ round.matches[].results{}
 *                 ├─ round.matches[].individualResults{}
 *                 └─ TournamentEliminationCascade
 *                      └─ character.eliminations[]
 *
 *   TournamentCore exposes the mutation API. The cascade helper
 *   lives here, in a module whose name says what it does. A future
 *   reader looking for "how does the tournament domain react to a
 *   character deletion" finds one file.
 *
 * MATCH SEMANTICS:
 *   Removing a character from a match removes the character's slot
 *   in participants[] AND the character-keyed entry in the
 *   character-result maps (results{} for group exams,
 *   individualResults{} for team matches). Both are removed
 *   together, so the match remains internally coherent:
 *
 *     remaining participants
 *         ↕
 *     remaining character-keyed results
 *
 *   Match STATUS is not changed. A match that was 'completed'
 *   stays 'completed'. Its result set is now smaller, but every
 *   remaining participant still has a result. Deleting a person
 *   from the database is not a reason to retroactively declare the
 *   remaining competitors' match unfinished.
 *
 *   teamResults{} is untouched: its keys are team IDs, not
 *   character IDs.
 *
 *   The round's derived status is recomputed via the same rule
 *   TournamentMatches uses, so a round whose matches are all still
 *   completed stays 'completed', and a round that had only one
 *   match (now smaller) stays whatever it was.
 *
 * ELIMINATION MIRROR:
 *   When a character-typed elimination record is removed from
 *   tournament.eliminations[], the corresponding character-side
 *   record (character.eliminations[] with matching tournamentId)
 *   must also be removed, and character.eliminatedWeeks[] rebuilt.
 *   TournamentEliminationCascade.reverseTournamentEliminations
 *   does both.
 *
 *   That call is gated: it runs only for tournaments where at
 *   least one character-typed elimination record was actually
 *   removed. A tournament where the character appeared only in
 *   match participant lists or result maps needs no mirror
 *   cleanup — running the reversal would be wasted work, and it
 *   would obscure the actual intent of the call.
 *
 * PARTICIPANT TYPE:
 *   Only character-typed references are cleaned. A tournament in
 *   team mode may still carry character-side elimination records
 *   (from individualResults of team matches), and those are
 *   handled by the elimination cascade. Team-typed participant
 *   entries are untouched: a team's membership is that team's
 *   concern, not this cascade's.
 *
 * IDEMPOTENCE:
 *   Running the cascade twice for the same character is safe.
 *   After the first run, no reference matches; the second run
 *   reports zero counts and does not call the mirror cascade.
 *
 * THROWING:
 *   Invalid arguments throw. A missing appData, a malformed
 *   characterId, or an appData with no tournaments array is a
 *   caller bug and fails the enclosing transaction.
 *
 *   A malformed tournament record inside appData.tournaments is
 *   not an error. The cascade is a cleanup pass; it skips
 *   malformed records and continues. Whatever corruption exists
 *   was there before the cascade ran.
 *
 * RETURN SHAPE:
 *   {
 *     participantRecordsRemoved:    number,
 *     eliminationRecordsRemoved:    number,
 *     matchParticipantSlotsRemoved: number,
 *     matchResultEntriesRemoved:    number
 *   }
 *
 *   All counts are RECORDS changed, not entities touched:
 *     - participantRecordsRemoved counts tournament.participants[]
 *       entries removed across all tournaments.
 *     - eliminationRecordsRemoved counts tournament-side
 *       elimination records removed across all tournaments.
 *     - matchParticipantSlotsRemoved counts match participant
 *       slots removed across all rounds of all tournaments.
 *     - matchResultEntriesRemoved counts result-map entries
 *       removed across all matches (results{} and
 *       individualResults{} combined).
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.IdUtils
 *   - window.TournamentEliminationCascade
 */

(function() {
    'use strict';

    if (window.__tournamentCascadeLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var IdUtils = window.IdUtils;
    var EliminationCascade = window.TournamentEliminationCascade;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }

    if (!EliminationCascade ||
        typeof EliminationCascade.reverseTournamentEliminations !==
            'function') {
        _missing.push(
            'TournamentEliminationCascade.reverseTournamentEliminations'
        );
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentCascade] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentCascadeLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    // ============================================================
    // PARTICIPANT CLEANUP
    // ============================================================

    /**
     * Remove character-typed entries matching `target` from a
     * tournament's participants list. Team-typed entries are
     * untouched. Returns the count of entries removed.
     */
    function stripFromParticipants(tournament, target) {
        if (!isPlainObject(tournament)) { return 0; }
        if (!Array.isArray(tournament.participants)) { return 0; }

        var removed = 0;
        var kept = [];

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!isPlainObject(p)) {
                kept.push(p);
                continue;
            }
            if (p.type !== 'character') {
                kept.push(p);
                continue;
            }
            if (normaliseId(p.id) === target) {
                removed++;
                continue;
            }
            kept.push(p);
        }

        if (removed > 0) {
            tournament.participants = kept;
        }
        return removed;
    }

    // ============================================================
    // TOURNAMENT-SIDE ELIMINATION CLEANUP
    // ============================================================

    /**
     * Remove character-typed elimination records matching `target`
     * from a tournament's eliminations list. Returns the count of
     * records removed.
     */
    function stripFromTournamentEliminations(tournament, target) {
        if (!isPlainObject(tournament)) { return 0; }
        if (!Array.isArray(tournament.eliminations)) { return 0; }

        var removed = 0;
        var kept = [];

        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (!isPlainObject(e)) {
                kept.push(e);
                continue;
            }
            if (e.participantType !== 'character') {
                kept.push(e);
                continue;
            }
            if (normaliseId(e.participantId) === target) {
                removed++;
                continue;
            }
            kept.push(e);
        }

        if (removed > 0) {
            tournament.eliminations = kept;
        }
        return removed;
    }

    // ============================================================
    // MATCH CLEANUP
    // ============================================================

    /**
     * Remove `target` from a match's participant list and from
     * every character-keyed result map. Returns:
     *
     *   { slotsRemoved, resultEntriesRemoved }
     */
    function stripFromMatch(match, target) {
        var result = {
            slotsRemoved: 0,
            resultEntriesRemoved: 0
        };

        if (!isPlainObject(match)) { return result; }

        // ---- participants[] ----
        if (Array.isArray(match.participants)) {
            var kept = [];
            for (var i = 0; i < match.participants.length; i++) {
                var pid = normaliseId(match.participants[i]);
                if (pid !== null && pid === target) {
                    result.slotsRemoved++;
                    continue;
                }
                kept.push(match.participants[i]);
            }
            if (result.slotsRemoved > 0) {
                match.participants = kept;
            }
        }

        // ---- results{} (group_exam) ----
        if (isPlainObject(match.results)) {
            result.resultEntriesRemoved += stripFromResultMap(
                match, 'results', target
            );
        }

        // ---- individualResults{} (team_vs_team) ----
        // teamResults{} is keyed by team IDs; intentionally not
        // touched.
        if (isPlainObject(match.individualResults)) {
            result.resultEntriesRemoved += stripFromResultMap(
                match, 'individualResults', target
            );
        }

        return result;
    }

    /**
     * Remove `target`-keyed entries from one result map on a match.
     * Returns the number of entries removed.
     *
     * Result maps are keyed by normalised ID strings. A key that
     * does not normalise cleanly is left alone — the cascade is
     * not a repair pass.
     */
    function stripFromResultMap(match, field, target) {
        var map = match[field];
        if (!isPlainObject(map)) { return 0; }

        var keysToRemove = [];
        var keys = Object.keys(map);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var normKey = normaliseId(key);
            if (normKey !== null && normKey === target) {
                keysToRemove.push(key);
            }
        }

        for (var j = 0; j < keysToRemove.length; j++) {
            delete map[keysToRemove[j]];
        }

        return keysToRemove.length;
    }

    /**
     * Walk every round in a tournament and clean every match.
     * Mutates in place. Returns:
     *
     *   { slotsRemoved, resultEntriesRemoved }
     */
    function stripFromTournamentMatches(tournament, target) {
        var totals = {
            slotsRemoved: 0,
            resultEntriesRemoved: 0
        };

        if (!isPlainObject(tournament)) { return totals; }
        if (!Array.isArray(tournament.rounds)) { return totals; }

        for (var r = 0; r < tournament.rounds.length; r++) {
            var round = tournament.rounds[r];
            if (!isPlainObject(round)) { continue; }
            if (!Array.isArray(round.matches)) { continue; }

            for (var m = 0; m < round.matches.length; m++) {
                var match = round.matches[m];
                var result = stripFromMatch(match, target);
                totals.slotsRemoved += result.slotsRemoved;
                totals.resultEntriesRemoved += result.resultEntriesRemoved;
            }

            // Round status is not recomputed. Removing a character
            // from a match does not change the match's status, and
            // the round's derived status is a function of its
            // matches' statuses. If the round was 'completed', it
            // stays 'completed'; if 'pending' or 'in_progress', it
            // stays those. No reconciliation needed.
        }

        return totals;
    }

    // ============================================================
    // STRIP CHARACTER REFS
    // ============================================================

    /**
     * Remove every reference to a character from every tournament
     * in the snapshot.
     *
     * Mutates appData.tournaments in place. Never touches
     * window.data. Never enters the pipeline.
     *
     * For each tournament that had at least one character-typed
     * elimination removed, calls
     * TournamentEliminationCascade.reverseTournamentEliminations
     * to clean the character-side mirror. Tournaments where the
     * character appeared only in participants or matches are not
     * sent through the mirror call; the character had no
     * tournament-side elimination record to mirror.
     *
     * @param {object} appData - Pipeline snapshot
     * @param {string} charId
     * @returns {object} {
     *   participantRecordsRemoved,
     *   eliminationRecordsRemoved,
     *   matchParticipantSlotsRemoved,
     *   matchResultEntriesRemoved
     * }
     */
    function stripCharacterRefs(appData, charId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentCascade] appData is required.'
            );
        }

        var target = normaliseId(charId);
        if (target === null) {
            throw new Error(
                '[TournamentCascade] A valid characterId is required.'
            );
        }

        var result = {
            participantRecordsRemoved: 0,
            eliminationRecordsRemoved: 0,
            matchParticipantSlotsRemoved: 0,
            matchResultEntriesRemoved: 0
        };

        if (!Array.isArray(appData.tournaments)) {
            return result;
        }

        var tournaments = appData.tournaments;

        for (var i = 0; i < tournaments.length; i++) {
            var tournament = tournaments[i];
            if (!isPlainObject(tournament)) { continue; }

            var participantsRemoved = stripFromParticipants(
                tournament, target
            );
            result.participantRecordsRemoved += participantsRemoved;

            var eliminationsRemoved = stripFromTournamentEliminations(
                tournament, target
            );
            result.eliminationRecordsRemoved += eliminationsRemoved;

            var matchTotals = stripFromTournamentMatches(
                tournament, target
            );
            result.matchParticipantSlotsRemoved +=
                matchTotals.slotsRemoved;
            result.matchResultEntriesRemoved +=
                matchTotals.resultEntriesRemoved;

            // Mirror cleanup is gated: only run when a
            // tournament-side elimination was actually removed.
            //
            // A tournament where the character appeared only in
            // participants or matches has no character-side
            // elimination record to clean. Running the reversal
            // would be idempotent and harmless, but it would also
            // be work that pretends something happened when
            // nothing did.
            if (eliminationsRemoved > 0) {
                EliminationCascade.reverseTournamentEliminations(
                    appData,
                    tournament.id
                );
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentCascade = Object.freeze({
        stripCharacterRefs: stripCharacterRefs
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentCascade;
        var missing = [];

        if (typeof exports.stripCharacterRefs !== 'function') {
            missing.push('stripCharacterRefs');
        }

        try {
            // Minimal smoke test: one tournament, one character in
            // participants, one elimination, one match with a
            // results entry. All four counts should be 1.
            var snapshot = {
                tournaments: [
                    {
                        id: 'tourn_a',
                        mode: 'individuals',
                        participants: [
                            { id: 'char_1', type: 'character' },
                            { id: 'char_2', type: 'character' }
                        ],
                        eliminations: [
                            {
                                participantId: 'char_1',
                                participantType: 'character',
                                week: 5
                            }
                        ],
                        rounds: [
                            {
                                id: 'round_1',
                                matches: [
                                    {
                                        id: 'match_1',
                                        status: 'completed',
                                        participants: ['char_1', 'char_2'],
                                        results: {
                                            char_1: 'fail',
                                            char_2: 'pass'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ],
                characters: [
                    {
                        id: 'char_1',
                        eliminations: [
                            {
                                id: 'elim_a',
                                tournamentId: 'tourn_a',
                                week: 5,
                                standalone: false
                            }
                        ],
                        eliminatedWeeks: []
                    },
                    {
                        id: 'char_2',
                        eliminations: [],
                        eliminatedWeeks: []
                    }
                ]
            };

            var outcome = stripCharacterRefs(snapshot, 'char_1');

            if (outcome.participantRecordsRemoved !== 1) {
                missing.push(
                    'smoke: participantRecordsRemoved expected 1, got ' +
                    outcome.participantRecordsRemoved
                );
            }
            if (outcome.eliminationRecordsRemoved !== 1) {
                missing.push(
                    'smoke: eliminationRecordsRemoved expected 1, got ' +
                    outcome.eliminationRecordsRemoved
                );
            }
            if (outcome.matchParticipantSlotsRemoved !== 1) {
                missing.push(
                    'smoke: matchParticipantSlotsRemoved expected 1, got ' +
                    outcome.matchParticipantSlotsRemoved
                );
            }
            if (outcome.matchResultEntriesRemoved !== 1) {
                missing.push(
                    'smoke: matchResultEntriesRemoved expected 1, got ' +
                    outcome.matchResultEntriesRemoved
                );
            }

            var t = snapshot.tournaments[0];
            if (t.participants.length !== 1 ||
                String(t.participants[0].id) !== 'char_2') {
                missing.push('smoke: participants not filtered correctly');
            }
            if (t.eliminations.length !== 0) {
                missing.push('smoke: eliminations not filtered correctly');
            }

            var match = t.rounds[0].matches[0];
            if (match.participants.length !== 1 ||
                match.participants[0] !== 'char_2') {
                missing.push('smoke: match participants not filtered');
            }
            if (Object.keys(match.results).length !== 1 ||
                match.results.char_1 !== undefined ||
                match.results.char_2 !== 'pass') {
                missing.push('smoke: match results not filtered');
            }
            if (match.status !== 'completed') {
                missing.push('smoke: match status was altered');
            }

            // Idempotence: second run must be a no-op.
            var second = stripCharacterRefs(snapshot, 'char_1');
            if (second.participantRecordsRemoved !== 0 ||
                second.eliminationRecordsRemoved !== 0 ||
                second.matchParticipantSlotsRemoved !== 0 ||
                second.matchResultEntriesRemoved !== 0) {
                missing.push('smoke: cascade is not idempotent');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentCascade] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();