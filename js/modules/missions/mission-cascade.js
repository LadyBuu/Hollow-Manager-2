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
 *   - Reporting exactly what was cleaned up, so the caller can log
 *     a summary.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The transaction. The caller (CharacterCRUD.deleteCharacter or
 *     a higher-level cascade coordinator) owns the pipeline entry.
 *     This module never calls MutationPipeline.performMutation.
 *   - Deletion policy. It reacts to a character that has already
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
 * REFERENCE MODEL:
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
 *   This is the same historical-record principle applied
 *   elsewhere: what is worth preserving is preserved (the report
 *   body and timestamp), what is a bare reference is dropped (the
 *   participant row).
 *
 * IDEMPOTENCE:
 *   Running the cascade twice for the same character is safe.
 *   After the first run, no supportPersonnel entry matches, no
 *   report has that authorId, and no participant row has that
 *   characterId. The second run reports zero changes.
 *
 * RETURN SHAPE:
 *   {
 *     supportEntriesRemoved: N,
 *     reportsRedacted: N,
 *     participantEntriesRemoved: N
 *   }
 *
 *   Each count is the number of RECORDS changed, not the number of
 *   missions touched. A mission with three support entries for the
 *   same character (impossible given schema uniqueness, but
 *   defensive) would count 3. A mission with five reports by the
 *   same author would count 5. A mission with four participant
 *   rows for the same character (across four teams) would count 4.
 *
 * THROWING:
 *   This is a transaction-local helper. A caller that violates the
 *   contract has a bug that will corrupt the transaction if it
 *   proceeds. So invalid arguments THROW.
 *
 *   Specifically:
 *     - appData missing or not an object: throw.
 *     - characterId missing or invalid: throw.
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
    // EXPOSE
    // ============================================================

    window.MissionCascade = Object.freeze({
        stripCharacterRefs: stripCharacterRefs
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

        try {
            // ---- Smoke test 1: the original three-way cleanup ----
            //
            // One mission carrying one support entry and one report
            // by the target character. Both should be cleaned, and
            // the report body must survive.
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

            // Idempotence: running again must be a no-op.
            var second = stripCharacterRefs(snapshot, 'char_1');
            if (second.supportEntriesRemoved !== 0 ||
                second.reportsRedacted !== 0 ||
                second.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: cascade is not idempotent'
                );
            }

            // ---- Smoke test 2: participant stripping ----
            //
            // A character who was a participant under two teams
            // and as a rookie on a second mission. All three
            // participant rows should be removed; the other
            // characters' rows must survive.
            var participantSnapshot = {
                missions: [
                    {
                        id: 'mission_x',
                        supportPersonnel: [],
                        reports: [],
                        participants: [
                            { characterId: 'char_1', teamId: 'team_a', source: 'team' },
                            { characterId: 'char_1', teamId: 'team_b', source: 'team' },
                            { characterId: 'char_2', teamId: 'team_a', source: 'team' },
                            { characterId: 'char_1', teamId: null,     source: 'rookie' }
                        ]
                    },
                    {
                        id: 'mission_y',
                        supportPersonnel: [],
                        reports: [],
                        participants: [
                            { characterId: 'char_2', teamId: 'team_a', source: 'team' }
                        ]
                    }
                ]
            };

            var pOutcome = stripCharacterRefs(
                participantSnapshot, 'char_1'
            );

            if (pOutcome.participantEntriesRemoved !== 3) {
                missing.push(
                    'smoke: participantEntriesRemoved expected 3, got ' +
                    pOutcome.participantEntriesRemoved
                );
            }
            if (pOutcome.supportEntriesRemoved !== 0) {
                missing.push(
                    'smoke: supportEntriesRemoved expected 0, got ' +
                    pOutcome.supportEntriesRemoved
                );
            }
            if (pOutcome.reportsRedacted !== 0) {
                missing.push(
                    'smoke: reportsRedacted expected 0, got ' +
                    pOutcome.reportsRedacted
                );
            }

            var missionX = participantSnapshot.missions[0];
            if (missionX.participants.length !== 1) {
                missing.push(
                    'smoke: mission_x participants length expected 1, ' +
                    'got ' + missionX.participants.length
                );
            } else if (
                missionX.participants[0].characterId !== 'char_2' ||
                missionX.participants[0].teamId !== 'team_a'
            ) {
                missing.push(
                    'smoke: mission_x kept the wrong participant'
                );
            }

            var missionY = participantSnapshot.missions[1];
            if (missionY.participants.length !== 1 ||
                missionY.participants[0].characterId !== 'char_2') {
                missing.push(
                    'smoke: mission_y was altered incorrectly'
                );
            }

            // Idempotence for the participant path.
            var pSecond = stripCharacterRefs(
                participantSnapshot, 'char_1'
            );
            if (pSecond.participantEntriesRemoved !== 0) {
                missing.push(
                    'smoke: participant cascade is not idempotent'
                );
            }

            // ---- Smoke test 3: malformed entries are left alone ----
            var malformedSnapshot = {
                missions: [
                    {
                        id: 'mission_z',
                        participants: [
                            null,
                            'not-an-object',
                            { characterId: 'char_1', teamId: 'team_a', source: 'team' },
                            { characterId: 'char_2', teamId: 'team_a', source: 'team' }
                        ]
                    }
                ]
            };
            var mOutcome = stripCharacterRefs(
                malformedSnapshot, 'char_1'
            );
            if (mOutcome.participantEntriesRemoved !== 1) {
                missing.push(
                    'smoke: malformed test expected 1 removal, got ' +
                    mOutcome.participantEntriesRemoved
                );
            }
            var mz = malformedSnapshot.missions[0].participants;
            if (mz.length !== 3) {
                missing.push(
                    'smoke: malformed entries should survive, ' +
                    'expected length 3, got ' + mz.length
                );
            }
            if (mz[0] !== null ||
                mz[1] !== 'not-an-object' ||
                !isPlainObject(mz[2]) ||
                mz[2].characterId !== 'char_2') {
                missing.push(
                    'smoke: malformed entries were altered or wrongly ordered'
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