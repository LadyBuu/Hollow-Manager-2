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
 *   A character can be referenced by a mission in exactly two
 *   places:
 *
 *     mission.supportPersonnel[]        array of character UUIDs
 *     mission.reports[].authorId        character UUID or null
 *
 *   Both are cleaned when the character is deleted. The cleanup is
 *   asymmetric, and the asymmetry is deliberate:
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
 *   This is the same historical-record principle applied elsewhere:
 *   the fact that a report exists is preserved; the fact that its
 *   author is no longer in the system is annotated, not erased.
 *
 * IDEMPOTENCE:
 *   Running the cascade twice for the same character is safe.
 *   After the first run, no supportPersonnel entry matches and no
 *   report has that authorId, so the second run reports zero
 *   removals.
 *
 * RETURN SHAPE:
 *   {
 *     supportEntriesRemoved: N,
 *     reportsRedacted: N
 *   }
 *
 *   Both counts are the number of RECORDS changed, not the number
 *   of missions touched. A mission with three support entries for
 *   the same character (impossible given schema uniqueness, but
 *   defensive) would count 3. A mission with five reports by the
 *   same author would count 5.
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
     * @param {object} appData - Pipeline snapshot
     * @param {string} characterId
     * @returns {object} {
     *   supportEntriesRemoved: number,
     *   reportsRedacted: number
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
            reportsRedacted: 0
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
            // Minimal smoke test: an in-memory snapshot with one
            // mission carrying one support entry and one report by
            // the target character. Both should be cleaned, and the
            // report body must survive.
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
                second.reportsRedacted !== 0) {
                missing.push(
                    'smoke: cascade is not idempotent'
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
