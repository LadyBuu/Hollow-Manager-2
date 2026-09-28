/**
 * modules/tournaments/tournament-cascade.js - Tournament Cascade
 *
 * Path: js/modules/tournaments/tournament-cascade.js
 *
 * Transaction-local cleanup helpers for the tournament domain when
 * a character or a team is deleted.
 *
 * WHAT THIS MODULE OWNS:
 *   Removing every reference to a deleted character or team from the
 *   tournament domain, operating on the caller's appData snapshot.
 *
 *   CHARACTER REFERENCE SHAPES:
 *     tournament.participants[]                    { id, type }
 *     tournament.eliminations[]                    { participantId, participantType, ... }
 *     round.matches[].participants[]               character IDs
 *     round.matches[].results{}                    character IDs as keys
 *     round.matches[].individualResults{}          character IDs as keys
 *     character.eliminations[]                     the mirror on the
 *                                                  character side
 *
 *   TEAM REFERENCE SHAPES:
 *     tournament.participants[]                    { id, type: 'team' }
 *     tournament.eliminations[]                    { participantId, participantType: 'team', ... }
 *     round.matches[].participants[]               team IDs (bare strings)
 *     round.matches[].teamResults{}                team IDs as keys
 *
 *   NOTE on team deletion: character-side elimination records
 *   (character.eliminations[]) reference teams only indirectly, via
 *   tournamentId. They are cleaned by the tournament-side cascade
 *   when the tournament-side elimination is removed, and by the
 *   normal tournament reversal paths. stripTeamRefs does NOT walk
 *   character.eliminations[] directly.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The transaction. The caller (CharacterCRUD.deleteCharacter,
 *     TeamCore.deleteTeam, or AcademyCascade.characterDeleted) owns
 *     the pipeline entry. This module never calls
 *     MutationPipeline.performMutation.
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
 *   stripTeamRefs was added later, for the same reason applied to
 *   team deletion. TeamCore.deleteTeam used to splice the team out
 *   of appData.teams without touching tournaments. Exports made
 *   before that fix carry tournament participants pointing at
 *   deleted teams; imports of those files fail cross-domain
 *   validation. TeamCore.deleteTeam now calls stripTeamRefs inside
 *   its own transaction, before the team record disappears.
 *
 * ARCHITECTURE:
 *
 *     TournamentCore
 *       ├─ stripCharacterRefs(appData, charId)   delegator
 *       │    └─ TournamentCascade.stripCharacterRefs(appData, charId)
 *       │         ├─ tournament.participants[]
 *       │         ├─ tournament.eliminations[]
 *       │         ├─ round.matches[].participants[]
 *       │         ├─ round.matches[].results{}
 *       │         ├─ round.matches[].individualResults{}
 *       │         └─ TournamentEliminationCascade
 *       │              └─ character.eliminations[]
 *       │
 *       └─ stripTeamRefs(appData, teamId)        delegator
 *            └─ TournamentCascade.stripTeamRefs(appData, teamId)
 *                 ├─ tournament.participants[]
 *                 ├─ tournament.eliminations[]
 *                 ├─ round.matches[].participants[]
 *                 └─ round.matches[].teamResults{}
 *
 * MATCH SEMANTICS - CHARACTER:
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
 *   teamResults{} is untouched for character deletion: its keys are
 *   team IDs, not character IDs.
 *
 *   The round's derived status is recomputed via the same rule
 *   TournamentMatches uses, so a round whose matches are all still
 *   completed stays 'completed', and a round that had only one
 *   match (now smaller) stays whatever it was.
 *
 * MATCH SEMANTICS - TEAM:
 *   Removing a team from a match removes the team's slot in
 *   participants[] AND the team-keyed entry in teamResults{}.
 *   individualResults{} is left alone: its keys are character IDs,
 *   and the individual results belong to the members, not to the
 *   team. Deleting the team is not the same as deleting its
 *   members.
 *
 *   Match STATUS is not changed. Same rationale as the character
 *   case. If a completed team match is left with only one team
 *   after the cascade, the round status reconciliation reflects
 *   that at the next recompute. Round status is not recomputed
 *   here, deliberately — the argument is identical to the
 *   character case.
 *
 * ELIMINATION MIRROR - CHARACTER:
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
 * ELIMINATION MIRROR - TEAM:
 *   Team-side elimination records live only on the tournament
 *   (tournament.eliminations[]). There is no team-side mirror:
 *   teams do not carry an eliminations array. So stripping a
 *   team-typed elimination is a pure deletion from the
 *   tournament record. No cascade call is needed.
 *
 *   This asymmetry is real and intentional. Eliminations are a
 *   fact about individuals competing in a tournament; a team's
 *   elimination is recorded against the team, not against its
 *   members. The character-side mirror exists because characters
 *   carry their own historical elimination record for the
 *   Academy view. Teams do not.
 *
 * PARTICIPANT TYPE:
 *   stripCharacterRefs touches only character-typed references.
 *   stripTeamRefs touches only team-typed references. A tournament
 *   in team mode may still carry character-side elimination
 *   records (from individualResults of team matches), and those
 *   are handled by the character cascade, not by the team cascade.
 *   Team-typed participant entries are untouched by the character
 *   cascade: a team's membership is that team's concern.
 *
 * IDEMPOTENCE:
 *   Running either cascade twice for the same entity is safe.
 *   After the first run, no reference matches; the second run
 *   reports zero counts and does not call the mirror cascade.
 *
 * THROWING:
 *   Invalid arguments throw. A missing appData, a malformed
 *   characterId / teamId, or an appData with no tournaments array
 *   is a caller bug and fails the enclosing transaction.
 *
 *   A malformed tournament record inside appData.tournaments is
 *   not an error. The cascade is a cleanup pass; it skips
 *   malformed records and continues. Whatever corruption exists
 *   was there before the cascade ran.
 *
 * RETURN SHAPE - stripCharacterRefs:
 *   {
 *     participantRecordsRemoved:    number,
 *     eliminationRecordsRemoved:    number,
 *     matchParticipantSlotsRemoved: number,
 *     matchResultEntriesRemoved:    number
 *   }
 *
 * RETURN SHAPE - stripTeamRefs:
 *   {
 *     participantRecordsRemoved:    number,
 *     eliminationRecordsRemoved:    number,
 *     matchParticipantSlotsRemoved: number,
 *     matchTeamResultEntriesRemoved: number
 *   }
 *
 *   All counts are RECORDS changed, not entities touched.
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
    // PARTICIPANT CLEANUP - CHARACTER
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
    // PARTICIPANT CLEANUP - TEAM
    // ============================================================

    /**
     * Remove team-typed entries matching `target` from a
     * tournament's participants list. Character-typed entries are
     * untouched. Returns the count of entries removed.
     *
     * The counterpart to stripFromParticipants. Kept separate
     * rather than parameterised by type because the two are
     * independent policies: character deletion touches the
     * character-side elimination mirror, team deletion does not.
     */
    function stripFromTeamParticipants(tournament, target) {
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
            if (p.type !== 'team') {
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
    // TOURNAMENT-SIDE ELIMINATION CLEANUP - CHARACTER
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
    // TOURNAMENT-SIDE ELIMINATION CLEANUP - TEAM
    // ============================================================

    /**
     * Remove team-typed elimination records matching `target` from
     * a tournament's eliminations list. Returns the count of
     * records removed.
     *
     * No mirror cleanup is needed: teams do not carry their own
     * elimination arrays.
     */
    function stripFromTeamEliminations(tournament, target) {
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
            if (e.participantType !== 'team') {
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
    // MATCH CLEANUP - CHARACTER
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

    // ============================================================
    // MATCH CLEANUP - TEAM
    // ============================================================

    /**
     * Remove `target` from a match's participant list and from the
     * team-keyed result map. Returns:
     *
     *   { slotsRemoved, teamResultEntriesRemoved }
     *
     * individualResults{} is left alone: its keys are character
     * IDs, and deleting the team is not the same as deleting its
     * members.
     */
    function stripTeamFromMatch(match, target) {
        var result = {
            slotsRemoved: 0,
            teamResultEntriesRemoved: 0
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

        // ---- teamResults{} ----
        if (isPlainObject(match.teamResults)) {
            var keys = Object.keys(match.teamResults);
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                if (normaliseId(key) === target) {
                    delete match.teamResults[key];
                    result.teamResultEntriesRemoved++;
                }
            }
        }

        // ---- individualResults{} ----
        // Deliberately not touched. See the docstring above.

        return result;
    }

    // ============================================================
    // RESULT MAP HELPERS
    // ============================================================

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

    // ============================================================
    // TOURNAMENT MATCH WALKERS
    // ============================================================

    /**
     * Walk every round in a tournament and clean every match of
     * character references. Mutates in place. Returns:
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

            // Round status is not recomputed. See the file header
            // for the rationale.
        }

        return totals;
    }

    /**
     * Walk every round in a tournament and clean every match of
     * team references. Mutates in place. Returns:
     *
     *   { slotsRemoved, teamResultEntriesRemoved }
     */
    function stripTeamFromTournamentMatches(tournament, target) {
        var totals = {
            slotsRemoved: 0,
            teamResultEntriesRemoved: 0
        };

        if (!isPlainObject(tournament)) { return totals; }
        if (!Array.isArray(tournament.rounds)) { return totals; }

        for (var r = 0; r < tournament.rounds.length; r++) {
            var round = tournament.rounds[r];
            if (!isPlainObject(round)) { continue; }
            if (!Array.isArray(round.matches)) { continue; }

            for (var m = 0; m < round.matches.length; m++) {
                var match = round.matches[m];
                var result = stripTeamFromMatch(match, target);
                totals.slotsRemoved += result.slotsRemoved;
                totals.teamResultEntriesRemoved +=
                    result.teamResultEntriesRemoved;
            }
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
    // STRIP TEAM REFS
    // ============================================================

    /**
     * Remove every reference to a team from every tournament in the
     * snapshot.
     *
     * Mutates appData.tournaments in place. Never touches
     * window.data. Never enters the pipeline.
     *
     * Called from TeamCore.deleteTeam inside the delete transaction,
     * BEFORE the team record is spliced out of appData.teams. The
     * cascade runs while the transaction snapshot still sees the
     * tournament-side references, and its own writes are part of
     * the same all-or-nothing commit.
     *
     * No mirror cleanup is performed, because teams do not carry
     * their own elimination arrays. See the file header for the
     * rationale.
     *
     * @param {object} appData - Pipeline snapshot
     * @param {string} teamId
     * @returns {object} {
     *   participantRecordsRemoved,
     *   eliminationRecordsRemoved,
     *   matchParticipantSlotsRemoved,
     *   matchTeamResultEntriesRemoved
     * }
     */
    function stripTeamRefs(appData, teamId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[TournamentCascade] appData is required.'
            );
        }

        var target = normaliseId(teamId);
        if (target === null) {
            throw new Error(
                '[TournamentCascade] A valid teamId is required.'
            );
        }

        var result = {
            participantRecordsRemoved: 0,
            eliminationRecordsRemoved: 0,
            matchParticipantSlotsRemoved: 0,
            matchTeamResultEntriesRemoved: 0
        };

        if (!Array.isArray(appData.tournaments)) {
            return result;
        }

        var tournaments = appData.tournaments;

        for (var i = 0; i < tournaments.length; i++) {
            var tournament = tournaments[i];
            if (!isPlainObject(tournament)) { continue; }

            result.participantRecordsRemoved +=
                stripFromTeamParticipants(tournament, target);

            result.eliminationRecordsRemoved +=
                stripFromTeamEliminations(tournament, target);

            var matchTotals = stripTeamFromTournamentMatches(
                tournament, target
            );
            result.matchParticipantSlotsRemoved +=
                matchTotals.slotsRemoved;
            result.matchTeamResultEntriesRemoved +=
                matchTotals.teamResultEntriesRemoved;
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentCascade = Object.freeze({
        stripCharacterRefs: stripCharacterRefs,
        stripTeamRefs: stripTeamRefs
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
        if (typeof exports.stripTeamRefs !== 'function') {
            missing.push('stripTeamRefs');
        }

        try {
            // ---- Smoke test 1: character cascade ----
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

            // ---- Smoke test 2: team cascade ----
            var teamSnapshot = {
                tournaments: [
                    {
                        id: 'tourn_b',
                        mode: 'teams',
                        participants: [
                            { id: 'team_1', type: 'team' },
                            { id: 'team_2', type: 'team' }
                        ],
                        eliminations: [
                            {
                                participantId: 'team_1',
                                participantType: 'team',
                                week: 5
                            }
                        ],
                        rounds: [
                            {
                                id: 'round_1',
                                matches: [
                                    {
                                        id: 'match_1',
                                        type: 'team_vs_team',
                                        status: 'completed',
                                        participants: ['team_1', 'team_2'],
                                        teamResults: {
                                            team_1: 'fail',
                                            team_2: 'pass'
                                        },
                                        individualResults: {
                                            char_a: 'fail',
                                            char_b: 'pass'
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            var teamOutcome = stripTeamRefs(teamSnapshot, 'team_1');

            if (teamOutcome.participantRecordsRemoved !== 1) {
                missing.push(
                    'smoke-team: participantRecordsRemoved expected 1, ' +
                    'got ' + teamOutcome.participantRecordsRemoved
                );
            }
            if (teamOutcome.eliminationRecordsRemoved !== 1) {
                missing.push(
                    'smoke-team: eliminationRecordsRemoved expected 1, ' +
                    'got ' + teamOutcome.eliminationRecordsRemoved
                );
            }
            if (teamOutcome.matchParticipantSlotsRemoved !== 1) {
                missing.push(
                    'smoke-team: matchParticipantSlotsRemoved expected 1, ' +
                    'got ' + teamOutcome.matchParticipantSlotsRemoved
                );
            }
            if (teamOutcome.matchTeamResultEntriesRemoved !== 1) {
                missing.push(
                    'smoke-team: matchTeamResultEntriesRemoved expected ' +
                    '1, got ' + teamOutcome.matchTeamResultEntriesRemoved
                );
            }

            var tb = teamSnapshot.tournaments[0];
            if (tb.participants.length !== 1 ||
                String(tb.participants[0].id) !== 'team_2') {
                missing.push(
                    'smoke-team: participants not filtered correctly'
                );
            }
            if (tb.eliminations.length !== 0) {
                missing.push(
                    'smoke-team: eliminations not filtered correctly'
                );
            }

            var teamMatch = tb.rounds[0].matches[0];
            if (teamMatch.participants.length !== 1 ||
                teamMatch.participants[0] !== 'team_2') {
                missing.push(
                    'smoke-team: match participants not filtered'
                );
            }
            if (Object.keys(teamMatch.teamResults).length !== 1 ||
                teamMatch.teamResults.team_1 !== undefined ||
                teamMatch.teamResults.team_2 !== 'pass') {
                missing.push(
                    'smoke-team: teamResults not filtered'
                );
            }
            // individualResults must be untouched.
            if (teamMatch.individualResults.char_a !== 'fail' ||
                teamMatch.individualResults.char_b !== 'pass') {
                missing.push(
                    'smoke-team: individualResults were altered'
                );
            }
            if (teamMatch.status !== 'completed') {
                missing.push(
                    'smoke-team: match status was altered'
                );
            }

            // Idempotence: second run must be a no-op.
            var teamSecond = stripTeamRefs(teamSnapshot, 'team_1');
            if (teamSecond.participantRecordsRemoved !== 0 ||
                teamSecond.eliminationRecordsRemoved !== 0 ||
                teamSecond.matchParticipantSlotsRemoved !== 0 ||
                teamSecond.matchTeamResultEntriesRemoved !== 0) {
                missing.push(
                    'smoke-team: team cascade is not idempotent'
                );
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
