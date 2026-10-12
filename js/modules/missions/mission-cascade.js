/**
 * js/modules/missions/mission-cascade.js - Mission Cascade
 *
 * Path: js/modules/missions/mission-cascade.js
 *
 * Transaction-local cleanup helpers for cross-domain deletions.
 *
 * WHAT THIS MODULE OWNS:
 *   - Removing a deleted character's references from mission records
 *     inside a caller's pipeline transaction.
 *   - Removing a deleted team's references from mission records
 *     inside a caller's pipeline transaction.
 *   - Reporting exactly what was cleaned up, so the caller can log
 *     a summary.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The transaction. The caller (CharacterCRUD.deleteCharacter,
 *     TeamCore.deleteTeam, or a higher-level cascade coordinator)
 *     owns the pipeline entry. This module never calls
 *     MutationPipeline.performMutation.
 *   - Deletion policy. It reacts to an entity that has already
 *     been removed from the snapshot.
 *   - Any other domain's cleanup. It touches only
 *     appData.missions.
 *   - Storage. It never touches window.data.
 *
 * WHY A SEPARATE MODULE:
 *   MissionCore is a mutation API. It receives commands and goes
 *   through the pipeline. Cross-domain cascades are the opposite
 *   shape: they run INSIDE an existing transaction that was started
 *   by another module, and they mutate an appData snapshot directly.
 *   Mixing the two shapes in one file is how MissionCore would
 *   quietly grow a pipeline dependency it should not have.
 *
 * CHARACTER REFERENCE MODEL (stripCharacterRefs):
 *   A character can be referenced by a mission in exactly three
 *   places:
 *
 *     mission.supportPersonnel[]        array of character UUIDs
 *     mission.reports[].authorId        character UUID or null
 *     mission.participants[].characterId character UUID
 *
 *   All three are cleaned when the character is deleted. The
 *   cleanup is asymmetric, and the asymmetry is deliberate:
 *
 *     supportPersonnel
 *       The character is REMOVED from the array. Support personnel
 *       is a forward-looking assignment: "these characters are
 *       working on this mission." A deleted character cannot work
 *       on anything. Removal is correct.
 *
 *     reports[].authorId
 *       The character is NOT removed from the report. The report
 *       survives — it is a historical note someone wrote, and its
 *       content is independent of who wrote it. What changes is
 *       `authorId`: set to null, and `authorRedacted` set to true.
 *       The renderer displays "Unknown" for the author. This
 *       preserves the report body and timestamp.
 *
 *     participants[]
 *       The participant entry is REMOVED. A participant is a
 *       record of a character having taken part in a mission;
 *       without the character there is nothing to point at.
 *       Keeping a dangling characterId in the participants list
 *       would produce "Unknown" rows in the UI and break the
 *       (characterId, teamId) uniqueness invariant on the next
 *       edit. Removal is the correct policy.
 *
 *       Unlike a report, a participant entry carries no
 *       historical content beyond the character identity itself.
 *       There is nothing worth preserving when the character is
 *       gone. Contrast: a report body is text someone wrote, and
 *       it survives; a participant row is a pointer, and it does
 *       not.
 *
 * TEAM REFERENCE MODEL (stripTeamRefs):
 *   A team can be referenced by a mission in exactly two places:
 *
 *     mission.assignedTeamIds[]         array of team UUIDs
 *     mission.participants[].teamId     team UUID (null for rookies)
 *
 *   Both are cleaned when the team is deleted. The cleanup is
 *   asymmetric, and the asymmetry is deliberate:
 *
 *     assignedTeamIds
 *       The team id is REMOVED from the array. Assigned teams are
 *       a forward-looking assignment: "this team is running this
 *       mission." A deleted team cannot run anything. Removal is
 *       correct.
 *
 *     participants[]
 *       A participant whose teamId matches the deleted team is
 *       REMOVED from the participants list. The participant entry
 *       is a pointer to (character, team) — the team half no
 *       longer resolves, so the entry has nothing to point at.
 *       Rookie participants (teamId === null) are unaffected:
 *       they are not attached to a team.
 *
 *       Contrast with the character cascade, where reports survive
 *       because they carry content. A participant row carries no
 *       content beyond the reference itself. Removal is the
 *       correct policy in both directions.
 *
 *   The team cascade does NOT touch reports, support personnel,
 *   or any other field. A mission's reports are written by
 *   characters, not teams; a mission's support personnel is a
 *   list of characters, not teams. Only the two team-referencing
 *   fields are cleaned.
 *
 *   NOTE: this is the same cleanup that runs when a team is
 *   removed from a mission via updateMission's assignedTeamIds
 *   update. The difference is the trigger: updateMission handles
 *   "the user removed this team from THIS mission"; the cascade
 *   handles "this team has been deleted and every mission that
 *   referenced it must be cleaned in the same transaction."
 *
 * WHY THE TEAM CASCADE EXISTS:
 *   Before this revision, TeamCore.deleteTeam removed the team
 *   from the store and stripped its tournament references, but
 *   did not touch missions. Every mission that had the deleted
 *   team in assignedTeamIds kept a dead reference. On the next
 *   export, the file carried dangling team ids; on the next
 *   import, CrossDomainValidator rejected the file with one
 *   "Mission references non-existent team" error per dangling
 *   reference.
 *
 *   With stripTeamRefs called from TeamCore.deleteTeam, that
 *   state is impossible to produce. A mission's assignedTeamIds
 *   is guaranteed to only contain ids that resolve to live teams
 *   at every point a transaction commits.
 *
 * IDEMPOTENCE:
 *   Running either cascade twice for the same entity is safe.
 *   After the first run:
 *     - no supportPersonnel entry matches (character case);
 *     - no report has that authorId (character case);
 *     - no participant row has that characterId (character case);
 *     - no assignedTeamIds entry matches (team case);
 *     - no participant row has that teamId (team case).
 *   The second run reports zero changes.
 *
 * RETURN SHAPES:
 *
 *   stripCharacterRefs:
 *     {
 *       supportEntriesRemoved: N,
 *       reportsRedacted: N,
 *       participantEntriesRemoved: N
 *     }
 *
 *   stripTeamRefs:
 *     {
 *       assignedTeamEntriesRemoved: N,
 *       participantEntriesRemoved: N
 *     }
 *
 *   Each count is the number of RECORDS changed, not the number of
 *   missions touched. A mission with three support entries for the
 *   same character (impossible given schema uniqueness, but
 *   defensive) would count 3.
 *
 * THROWING:
 *   These are transaction-local helpers. A caller that violates
 *   the contract has a bug that will corrupt the transaction if it
 *   proceeds. So invalid arguments THROW.
 *
 *   Specifically:
 *     - appData missing or not an object: throw.
 *     - characterId / teamId missing or invalid: throw.
 *
 *   A malformed mission record inside appData.missions is NOT an
 *   error. The cascade is a cleanup pass; it skips malformed
 *   missions and does not report them. Whatever corruption exists
 *   was there before the cascade ran, and the cascade's job is to
 *   remove references, not to validate the store.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.IdUtils
 */

(function() {
    'use strict';

    if (window.__missionCascadeLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var IdUtils = window.IdUtils;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionCascade] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionCascadeLoaded = true;

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
    // STRIP CHARACTER REFS
    // ============================================================

    /**
     * Remove a character's references from every mission in the
     * snapshot.
     *
     * Mutates appData.missions in place. Never touches window.data.
     * Never enters the pipeline. Never throws on malformed mission
     * records.
     *
     * Three passes per mission, each visiting only the field it
     * owns:
     *
     *   stripFromSupportPersonnel   drops matching entries
     *   stripFromReports            nulls the authorId and sets
     *                               authorRedacted
     *   stripFromParticipants       drops matching participant rows
     *
     * @param {object} appData - Pipeline snapshot
     * @param {string} characterId
     * @returns {object} {
     *   supportEntriesRemoved: number,
     *   reportsRedacted: number,
     *   participantEntriesRemoved: number
     * }
     */
    function stripCharacterRefs(appData, characterId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[MissionCascade] appData is required.'
            );
        }

        var target = normaliseId(characterId);
        if (target === null) {
            throw new Error(
                '[MissionCascade] A valid characterId is required.'
            );
        }

        var result = {
            supportEntriesRemoved: 0,
            reportsRedacted: 0,
            participantEntriesRemoved: 0
        };

        if (!Array.isArray(appData.missions)) {
            return result;
        }

        var missions = appData.missions;

        for (var i = 0; i < missions.length; i++) {
            var mission = missions[i];
            if (!isPlainObject(mission)) { continue; }

            stripFromSupportPersonnel(mission, target, result);
            stripFromReports(mission, target, result);
            stripFromParticipants(mission, target, result);
        }

        return result;
    }

    function stripFromSupportPersonnel(mission, target, result) {
        if (!Array.isArray(mission.supportPersonnel)) {
            return;
        }

        var original = mission.supportPersonnel;
        var kept = [];

        for (var i = 0; i < original.length; i++) {
            var id = normaliseId(original[i]);
            if (id !== null && id === target) {
                result.supportEntriesRemoved++;
                continue;
            }
            kept.push(original[i]);
        }

        if (kept.length !== original.length) {
            mission.supportPersonnel = kept;
        }
    }

    function stripFromReports(mission, target, result) {
        if (!Array.isArray(mission.reports)) {
            return;
        }

        var reports = mission.reports;

        for (var i = 0; i < reports.length; i++) {
            var report = reports[i];
            if (!isPlainObject(report)) { continue; }

            var authorId = normaliseId(report.authorId);
            if (authorId === null) {
                // Already redacted, or malformed. Nothing to do.
                continue;
            }

            if (authorId !== target) {
                continue;
            }

            report.authorId = null;
            report.authorRedacted = true;
            result.reportsRedacted++;
        }
    }

    /**
     * Remove participant rows that reference the deleted character.
     *
     * A participant row is removed when its normalised characterId
     * matches the target. This applies to both sources:
     *
     *   - source 'team'   the character was participating as a
     *                     member of one of the mission's assigned
     *                     teams
     *   - source 'rookie' the character was participating as a
     *                     rookie selected from the rookie
     *                     candidate list
     *
     * The policy is the same for both: the character is gone, so
     * the participant entry has nothing to point at. Removing it
     * keeps the (characterId, teamId) uniqueness invariant intact
     * for the next edit, and prevents "Unknown" rows in the UI.
     *
     * The whole list is rebuilt when anything is removed, so a
     * mission with no matching rows is left byte-identical.
     */
    function stripFromParticipants(mission, target, result) {
        if (!Array.isArray(mission.participants)) {
            return;
        }

        var original = mission.participants;
        var kept = [];

        for (var i = 0; i < original.length; i++) {
            var p = original[i];
            if (!isPlainObject(p)) {
                // A malformed participant entry is left alone. The
                // cascade cleans references, it does not repair
                // shape. Whatever produced this record is a
                // separate problem.
                kept.push(p);
                continue;
            }

            var cid = normaliseId(p.characterId);
            if (cid !== null && cid === target) {
                result.participantEntriesRemoved++;
                continue;
            }
            kept.push(p);
        }

        if (kept.length !== original.length) {
            mission.participants = kept;
        }
    }

    // ============================================================
    // STRIP TEAM REFS
    // ============================================================

    /**
     * Remove a team's references from every mission in the
     * snapshot.
     *
     * Mutates appData.missions in place. Never touches window.data.
     * Never enters the pipeline. Never throws on malformed mission
     * records.
     *
     * Two passes per mission, each visiting only the field it
     * owns:
     *
     *   stripTeamFromAssignedTeamIds   drops matching entries
     *   stripTeamFromParticipants      drops participant rows
     *                                  whose teamId matches
     *
     * Rookie participants (teamId === null) are unaffected: they
     * are not attached to a team. Only team participants whose
     * specific team was deleted are removed.
     *
     * The team cascade does NOT touch reports, support personnel,
     * or the mission log (which no longer exists). Only the two
     * team-referencing fields are cleaned.
     *
     * @param {object} appData - Pipeline snapshot
     * @param {string} teamId
     * @returns {object} {
     *   assignedTeamEntriesRemoved: number,
     *   participantEntriesRemoved: number
     * }
     */
    function stripTeamRefs(appData, teamId) {
        if (!appData || typeof appData !== 'object') {
            throw new Error(
                '[MissionCascade] appData is required.'
            );
        }

        var target = normaliseId(teamId);
        if (target === null) {
            throw new Error(
                '[MissionCascade] A valid teamId is required.'
            );
        }

        var result = {
            assignedTeamEntriesRemoved: 0,
            participantEntriesRemoved: 0
        };

        if (!Array.isArray(appData.missions)) {
            return result;
        }

        var missions = appData.missions;

        for (var i = 0; i < missions.length; i++) {
            var mission = missions[i];
            if (!isPlainObject(mission)) { continue; }

            stripTeamFromAssignedTeamIds(mission, target, result);
            stripTeamFromParticipants(mission, target, result);
        }

        return result;
    }

    /**
     * Remove a team id from mission.assignedTeamIds.
     *
     * The legacy scalar `assignedTeamId` is not touched here:
     * MissionSchema.canonicaliseMissionShape handles the legacy
     * shape on write, and MissionQueries.getTeamIdsForMission
     * handles it on read. The cascade runs on the snapshot, which
     * has already been canonicalised by the time any mission has
     * been stored. So only the array form appears here in
     * practice.
     *
     * A defensive check: if the legacy scalar is present and
     * matches the target, it is nulled. This costs nothing and
     * covers a snapshot that somehow slipped past
     * canonicalisation.
     */
    function stripTeamFromAssignedTeamIds(mission, target, result) {
        if (Array.isArray(mission.assignedTeamIds)) {
            var original = mission.assignedTeamIds;
            var kept = [];

            for (var i = 0; i < original.length; i++) {
                var id = normaliseId(original[i]);
                if (id !== null && id === target) {
                    result.assignedTeamEntriesRemoved++;
                    continue;
                }
                kept.push(original[i]);
            }

            if (kept.length !== original.length) {
                mission.assignedTeamIds = kept;
            }
        }

        // Defensive: legacy scalar. Only nulled if it matches the
        // target, and only if the array form is absent. When both
        // are present, the array wins and the scalar is already
        // ignored by every reader.
        if (mission.assignedTeamId !== undefined &&
            mission.assignedTeamId !== null &&
            !Array.isArray(mission.assignedTeamIds)) {
            var scalarId = normaliseId(mission.assignedTeamId);
            if (scalarId !== null && scalarId === target) {
                mission.assignedTeamId = null;
                result.assignedTeamEntriesRemoved++;
            }
        }
    }

    /**
     * Remove participant rows that reference the deleted team.
     *
     * A participant row is removed when its normalised teamId
     * matches the target. Rookie participants (teamId === null)
     * are unaffected. The (characterId, teamId) uniqueness
     * invariant is preserved by the removal: if a character was a
     * participant under two teams, only the row for the deleted
     * team is removed; the row for the surviving team stays.
     *
     * The whole list is rebuilt when anything is removed, so a
     * mission with no matching rows is left byte-identical.
     */
    function stripTeamFromParticipants(mission, target, result) {
        if (!Array.isArray(mission.participants)) {
            return;
        }

        var original = mission.participants;
        var kept = [];

        for (var i = 0; i < original.length; i++) {
            var p = original[i];
            if (!isPlainObject(p)) {
                // Malformed entries are left alone. See the same
                // note on stripFromParticipants.
                kept.push(p);
                continue;
            }

            // Rookie participants are not attached to a team.
            if (p.teamId === null || p.teamId === undefined) {
                kept.push(p);
                continue;
            }

            var tid = normaliseId(p.teamId);
            if (tid !== null && tid === target) {
                result.participantEntriesRemoved++;
                continue;
            }
            kept.push(p);
        }

        if (kept.length !== original.length) {
            mission.participants = kept;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCascade = Object.freeze({
        stripCharacterRefs: stripCharacterRefs,
        stripTeamRefs: stripTeamRefs
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionCascade;
        var missing = [];

        if (typeof exports.stripCharacterRefs !== 'function') {
            missing.push('stripCharacterRefs');
        }
        if (typeof exports.stripTeamRefs !== 'function') {
            missing.push('stripTeamRefs');
        }

        try {
            // ---- Character cascade smoke tests (unchanged) ----

            var snapshot = {
                missions: [
                    {
                        id: 'mission_a',
                        supportPersonnel: ['char_1', 'char_2'],
                        reports: [
                            {
                                id: 'report_a',
                                authorId: 'char_1',
                                authorRedacted: false,
                                text: 'Something happened.',
                                createdAt: '2026-09-17T12:00:00.000Z'
                            },
                            {
                                id: 'report_b',
                                authorId: 'char_2',
                                authorRedacted: false,
                                text: 'Something else.',
                                createdAt: '2026-09-17T13:00:00.000Z'
                            }
                        ]
                    }
                ]
            };

            var outcome = stripCharacterRefs(snapshot, 'char_1');

            if (outcome.supportEntriesRemoved !== 1) {
                missing.push(
                    'smoke: supportEntriesRemoved expected 1, got ' +
                    outcome.supportEntriesRemoved
                );
            }
            if (outcome.reportsRedacted !== 1) {
                missing.push(
                    'smoke: reportsRedacted expected 1, got ' +
                    outcome.reportsRedacted
                );
            }
            if (outcome.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: participantEntriesRemoved should be 0, got ' +
                    outcome.participantEntriesRemoved
                );
            }

            var mission = snapshot.missions[0];

            if (mission.supportPersonnel.length !== 1 ||
                mission.supportPersonnel[0] !== 'char_2') {
                missing.push('smoke: supportPersonnel not filtered correctly');
            }

            var reportA = mission.reports[0];
            if (reportA.authorId !== null) {
                missing.push('smoke: reportA.authorId was not nulled');
            }
            if (reportA.authorRedacted !== true) {
                missing.push('smoke: reportA.authorRedacted was not set');
            }
            if (reportA.text !== 'Something happened.') {
                missing.push('smoke: reportA.text was altered');
            }
            if (reportA.createdAt !== '2026-09-17T12:00:00.000Z') {
                missing.push('smoke: reportA.createdAt was altered');
            }

            var reportB = mission.reports[1];
            if (reportB.authorId !== 'char_2' ||
                reportB.authorRedacted !== false) {
                missing.push('smoke: reportB was altered incorrectly');
            }

            var second = stripCharacterRefs(snapshot, 'char_1');
            if (second.supportEntriesRemoved !== 0 ||
                second.reportsRedacted !== 0 ||
                second.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: cascade is not idempotent'
                );
            }

            // ---- Team cascade smoke tests ----

            // A mission assigned to two teams, one of which is
            // deleted. The other must survive.
            var teamSnapshot = {
                missions: [
                    {
                        id: 'mission_t',
                        assignedTeamIds: ['team_a', 'team_b'],
                        participants: [
                            { characterId: 'c1', teamId: 'team_a', source: 'team' },
                            { characterId: 'c2', teamId: 'team_b', source: 'team' },
                            { characterId: 'c3', teamId: null,     source: 'rookie' }
                        ]
                    }
                ]
            };

            var tOutcome = stripTeamRefs(teamSnapshot, 'team_a');

            if (tOutcome.assignedTeamEntriesRemoved !== 1) {
                missing.push(
                    'smoke: assignedTeamEntriesRemoved expected 1, got ' +
                    tOutcome.assignedTeamEntriesRemoved
                );
            }
            if (tOutcome.participantEntriesRemoved !== 1) {
                missing.push(
                    'smoke: participantEntriesRemoved expected 1, got ' +
                    tOutcome.participantEntriesRemoved
                );
            }

            var tMission = teamSnapshot.missions[0];
            if (tMission.assignedTeamIds.length !== 1 ||
                tMission.assignedTeamIds[0] !== 'team_b') {
                missing.push(
                    'smoke: assignedTeamIds not filtered correctly'
                );
            }

            if (tMission.participants.length !== 2) {
                missing.push(
                    'smoke: team participants length expected 2, ' +
                    'got ' + tMission.participants.length
                );
            } else {
                var p0 = tMission.participants[0];
                var p1 = tMission.participants[1];
                if (p0.characterId !== 'c2' || p0.teamId !== 'team_b') {
                    missing.push(
                        'smoke: survivor participant was altered'
                    );
                }
                if (p1.characterId !== 'c3' || p1.teamId !== null ||
                    p1.source !== 'rookie') {
                    missing.push(
                        'smoke: rookie participant was altered'
                    );
                }
            }

            // Idempotence for the team cascade.
            var tSecond = stripTeamRefs(teamSnapshot, 'team_a');
            if (tSecond.assignedTeamEntriesRemoved !== 0 ||
                tSecond.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: team cascade is not idempotent'
                );
            }

            // A mission that does not reference the deleted team
            // must be left byte-identical.
            var untouchedSnapshot = {
                missions: [
                    {
                        id: 'mission_u',
                        assignedTeamIds: ['team_c'],
                        participants: [
                            { characterId: 'c4', teamId: 'team_c', source: 'team' }
                        ]
                    }
                ]
            };

            var uOutcome = stripTeamRefs(untouchedSnapshot, 'team_a');
            if (uOutcome.assignedTeamEntriesRemoved !== 0 ||
                uOutcome.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: cascade touched an unrelated mission'
                );
            }

            var uMission = untouchedSnapshot.missions[0];
            if (uMission.assignedTeamIds[0] !== 'team_c' ||
                uMission.participants[0].teamId !== 'team_c') {
                missing.push(
                    'smoke: unrelated mission was altered'
                );
            }

            // Malformed participant entries survive.
            var malformedSnapshot = {
                missions: [
                    {
                        id: 'mission_m',
                        assignedTeamIds: ['team_x'],
                        participants: [
                            null,
                            'not-an-object',
                            { characterId: 'c9', teamId: 'team_x', source: 'team' },
                            { characterId: 'c10', teamId: 'team_y', source: 'team' }
                        ]
                    }
                ]
            };

            var mOutcome = stripTeamRefs(malformedSnapshot, 'team_x');
            if (mOutcome.assignedTeamEntriesRemoved !== 1 ||
                mOutcome.participantEntriesRemoved !== 1) {
                missing.push(
                    'smoke: malformed test produced wrong counts: ' +
                    'assigned=' + mOutcome.assignedTeamEntriesRemoved +
                    ' participant=' + mOutcome.participantEntriesRemoved
                );
            }

            var mMission = malformedSnapshot.missions[0];
            if (mMission.participants.length !== 3) {
                missing.push(
                    'smoke: malformed entries should survive, ' +
                    'expected length 3, got ' + mMission.participants.length
                );
            }
            if (mMission.participants[0] !== null ||
                mMission.participants[1] !== 'not-an-object') {
                missing.push(
                    'smoke: malformed entries were altered'
                );
            }
            if (mMission.assignedTeamIds.length !== 0) {
                missing.push(
                    'smoke: assignedTeamIds should be empty after strip'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionCascade] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
