/**
 * js/modules/academy/academy-cascade.js - Academy Cascade Coordinator
 * Single entry point for cross-domain cleanup when Academy entities
 * are deleted.
 *
 * Path: js/modules/academy/academy-cascade.js
 *
 * This module is responsible for:
 *   - Coordinating cleanup after character deletion
 *   - Coordinating cleanup after class deletion
 *   - Coordinating cleanup after discipline deletion
 *   - Coordinating cleanup after location deletion
 *   - Coordinating cleanup after team deletion
 *
 * IMPORTANT:
 *   - This module does NOT do the cleanup itself. Each domain module
 *     owns its own strip*Refs helpers. This coordinator simply calls
 *     them in a defined order and returns a merged summary.
 *   - All helpers are PURE with respect to appData: they mutate the
 *     snapshot they are given and do not touch window.data. The
 *     coordinator is designed to run INSIDE a pipeline mutate()
 *     callback, so every cascade participates in the same transaction
 *     as the entity removal.
 *   - This module does NOT call MutationPipeline. It has no opinion
 *     about transactions. The caller (AcademyClasses.delete,
 *     AcademyDisciplines.delete, CharacterCRUD.deleteCharacter, etc.)
 *     owns the transaction.
 *   - Domain modules NOT loaded at call time are skipped silently.
 *     The result reports which modules participated.
 *
 * WHY A COORDINATOR:
 *   Before this module, cascade logic was inlined in each delete path:
 *     - AcademyClasses.delete stripped classIds from characters,
 *       removed weeklyTeams, deleted grades and rankings.
 *     - AcademyDisciplines.delete stripped schedules, groups, metadata,
 *       grades.
 *     - AcademyLocations.delete stripped location schedules,
 *       classLocations, metadata.
 *     - CharacterCRUD.deleteCharacter stripped team memberships,
 *       auto-groups, grades, rankings, social, missions, tournaments,
 *       curriculum.
 *   Each of these was individually correct, but every time a new
 *   domain module was added (enrolments, social score, weekly teams),
 *   every delete path needed to be updated. Missing one created
 *   orphaned references. The coordinator centralises the list of
 *   "everything that needs to be cleaned up when X is deleted" so
 *   adding a new domain module means updating ONE file.
 *
 * CASCADE SEMANTICS BY DELETION TYPE:
 *
 *   characterDeleted(appData, charId):
 *     Strips every reference to a character across the academy and
 *     curriculum domains. Called from CharacterCRUD.deleteCharacter
 *     inside the pipeline transaction that removes the character
 *     record itself.
 *
 *   classDeleted(appData, classId):
 *     Strips every reference to a class. Called from
 *     AcademyClasses.delete inside the pipeline transaction that
 *     removes the class record itself.
 *
 *   disciplineDeleted(appData, disciplineId):
 *     Strips every reference to a discipline. Called from
 *     AcademyDisciplines.delete inside the pipeline transaction.
 *
 *   locationDeleted(appData, locationId):
 *     Strips every reference to a location. Called from
 *     AcademyLocations.delete inside the pipeline transaction.
 *
 *   teamDeleted(appData, teamId):
 *     Strips every reference to a persistent Team entity. Called from
 *     TeamCore.deleteTeam inside the pipeline transaction.
 *
 * RETURN SHAPE:
 *   Each cascade returns a structured summary:
 *     {
 *       modules: [ 'academyEnrolments', 'academyGrades', ... ],
 *       details: {
 *         academyEnrolments: { enrolmentsRemoved: 3 },
 *         academyGrades: { gradesRemoved: 5 },
 *         ...
 *       }
 *     }
 *   The `modules` array lists which strip*Refs helpers actually ran.
 *   Modules that were unavailable (not loaded) are omitted.
 *
 * DEPENDENCIES:
 *   - None at module load. All helpers are read lazily at call time.
 *
 * OPTIONAL DEPENDENCIES (used when available):
 *   - window.AcademyEnrolments
 *   - window.AcademyGrades
 *   - window.AcademyGroups
 *   - window.AcademyRanking
 *   - window.AcademySocialScore
 *   - window.AcademyWeeklyTeams
 *   - window.CharacterEliminations (not a strip helper, but related)
 *   - window.SocialCore
 *   - window.MissionCore
 *   - window.TournamentCore
 *
 * USAGE:
 *   // Inside a pipeline mutate() callback in AcademyClasses.delete:
 *   var cascade = AcademyCascade.classDeleted(appData, classId);
 *   return { deleted: true, classId: classId, cascade: cascade };
 *
 *   // Inside CharacterCRUD.deleteCharacter's pipeline mutate:
 *   var cascade = AcademyCascade.characterDeleted(appData, charId);
 */

(function() {
    'use strict';

    if (window.__academyCascadeLoaded) {
        return;
    }
    window.__academyCascadeLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Call a strip helper on a module if the module is loaded and the
     * helper is a function.
     *
     * @param {string} moduleName  - Human-readable name for the summary
     * @param {string} modulePath  - Property name on window
     * @param {string} helperName  - Method name on the module
     * @param {object} appData
     * @param {string} entityId
     * @returns {object|null} The helper's return value, or null if skipped
     */
    function runStripHelper(moduleName, modulePath, helperName, appData, entityId) {
        var mod = window[modulePath];
        if (!mod || typeof mod[helperName] !== 'function') {
            return null;
        }
        try {
            var result = mod[helperName](appData, entityId);
            return result || {};
        } catch (e) {
            // A throwing cascade helper is a bug. Surface it.
            // The caller's transaction will abort and roll back.
            throw new Error(
                '[AcademyCascade] ' + moduleName + '.' + helperName +
                ' threw during cascade: ' + (e && e.message ? e.message : e)
            );
        }
    }

    /**
     * Build a cascade summary from a set of helper results.
     *
     * @param {array} entries - Array of { module, result } objects
     * @returns {object} { modules: string[], details: object }
     */
    function summarise(entries) {
        var modules = [];
        var details = {};

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry || entry.result === null || entry.result === undefined) {
                continue;
            }
            modules.push(entry.module);
            details[entry.module] = entry.result;
        }

        return {
            modules: modules,
            details: details
        };
    }

    // ============================================================
    // CHARACTER DELETION CASCADE
    // ============================================================

    /**
     * Strip all references to a character from the academy and
     * curriculum domains.
     *
     * Called from CharacterCRUD.deleteCharacter's pipeline mutate
     * callback, AFTER the character record has been removed from
     * data.characters (or before; the order within the transaction
     * does not matter because the character is unreachable either way).
     *
     * Order of operations:
     *   1. Academy enrolments (class-scoped student entries)
     *   2. Academy grades (records keyed to the student)
     *   3. Academy rankings (records keyed to the student)
     *   4. Academy social scores (entries keyed to the student)
     *   5. Academy weekly teams (assignments for the student)
     *   6. Academy auto-groups (instructor groups removed; student
     *      memberships removed)
     *   7. Social relationships (from SocialCore, if present)
     *   8. Mission support personnel (from MissionCore, if present)
     *   9. Tournament participants / eliminations / matches (from
     *      TournamentCore, if present)
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID
     * @returns {object} Cascade summary
     */
    function characterDeleted(appData, charId) {
        if (!appData || !isNonEmptyString(charId)) {
            return { modules: [], details: {} };
        }

        var target = String(charId);
        var entries = [];

        entries.push({
            module: 'academyEnrolments',
            result: runStripHelper(
                'academyEnrolments', 'AcademyEnrolments',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'academyGrades',
            result: runStripHelper(
                'academyGrades', 'AcademyGrades',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'academyRanking',
            result: runStripHelper(
                'academyRanking', 'AcademyRanking',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'academySocialScore',
            result: runStripHelper(
                'academySocialScore', 'AcademySocialScore',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'academyWeeklyTeams',
            result: runStripHelper(
                'academyWeeklyTeams', 'AcademyWeeklyTeams',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'academyGroups',
            result: runStripHelper(
                'academyGroups', 'AcademyGroups',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'socialCore',
            result: runStripHelper(
                'socialCore', 'SocialCore',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'missionCore',
            result: runStripHelper(
                'missionCore', 'MissionCore',
                'stripCharacterRefs', appData, target
            )
        });

        entries.push({
            module: 'tournamentCore',
            result: runStripHelper(
                'tournamentCore', 'TournamentCore',
                'stripCharacterRefs', appData, target
            )
        });

        return summarise(entries);
    }

    // ============================================================
    // CLASS DELETION CASCADE
    // ============================================================

    /**
     * Strip all references to a class.
     *
     * Called from AcademyClasses.delete's pipeline mutate callback.
     *
     * Order of operations:
     *   1. Academy enrolments (entire classId subtree)
     *   2. Academy grades (records keyed to the class)
     *   3. Academy rankings (records keyed to the class)
     *   4. Academy social scores (entire classId subtree)
     *   5. Academy weekly teams (entire classId subtree)
     *
     * Note: class membership is stored on character.classIds. The
     * caller (AcademyClasses.delete) is responsible for stripping the
     * classId from characters, because AcademyClasses owns that data
     * relationship. This coordinator does not touch character records.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} classId - Class ID
     * @returns {object} Cascade summary
     */
    function classDeleted(appData, classId) {
        if (!appData || !isNonEmptyString(classId)) {
            return { modules: [], details: {} };
        }

        var target = String(classId);
        var entries = [];

        entries.push({
            module: 'academyEnrolments',
            result: runStripHelper(
                'academyEnrolments', 'AcademyEnrolments',
                'stripClassRefs', appData, target
            )
        });

        entries.push({
            module: 'academyGrades',
            result: runStripHelper(
                'academyGrades', 'AcademyGrades',
                'stripClassRefs', appData, target
            )
        });

        entries.push({
            module: 'academyRanking',
            result: runStripHelper(
                'academyRanking', 'AcademyRanking',
                'stripClassRefs', appData, target
            )
        });

        entries.push({
            module: 'academySocialScore',
            result: runStripHelper(
                'academySocialScore', 'AcademySocialScore',
                'stripClassRefs', appData, target
            )
        });

        entries.push({
            module: 'academyWeeklyTeams',
            result: runStripHelper(
                'academyWeeklyTeams', 'AcademyWeeklyTeams',
                'stripClassRefs', appData, target
            )
        });

        return summarise(entries);
    }

    // ============================================================
    // DISCIPLINE DELETION CASCADE
    // ============================================================

    /**
     * Strip all references to a discipline.
     *
     * Called from AcademyDisciplines.delete's pipeline mutate callback.
     *
     * Order of operations:
     *   1. Academy enrolments (disciplineId removed from every student's
     *      enrolment list)
     *
     * Note: AcademyDisciplines.delete handles the other discipline
     * cascades inline (schedules, auto-groups, metadata, grades)
     * because those are curriculum-internal concerns that its own
     * private helpers already cover. The coordinator handles the
     * cross-domain parts only.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} disciplineId - Discipline ID
     * @returns {object} Cascade summary
     */
    function disciplineDeleted(appData, disciplineId) {
        if (!appData || !isNonEmptyString(disciplineId)) {
            return { modules: [], details: {} };
        }

        var target = String(disciplineId);
        var entries = [];

        entries.push({
            module: 'academyEnrolments',
            result: runStripHelper(
                'academyEnrolments', 'AcademyEnrolments',
                'stripDisciplineRefs', appData, target
            )
        });

        return summarise(entries);
    }

    // ============================================================
    // LOCATION DELETION CASCADE
    // ============================================================

    /**
     * Strip all references to a location.
     *
     * Called from AcademyLocations.delete's pipeline mutate callback.
     *
     * Note: location cleanup is entirely curriculum-internal
     * (locationSchedules, classLocations, metadata). AcademyLocations
     * handles it inline via its own cascade helpers. No cross-domain
     * strip helper exists for locations at this time. This function
     * is provided for symmetry and future use; it currently returns
     * an empty cascade.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} locationId - Location ID
     * @returns {object} Cascade summary
     */
    function locationDeleted(appData, locationId) {
        if (!appData || !isNonEmptyString(locationId)) {
            return { modules: [], details: {} };
        }
        return { modules: [], details: {} };
    }

    // ============================================================
    // TEAM DELETION CASCADE
    // ============================================================

    /**
     * Strip all references to a persistent Team entity.
     *
     * Called from TeamCore.deleteTeam's pipeline mutate callback.
     *
     * Order of operations:
     *   1. Academy weekly teams (the teamId is removed from every
     *      class-week assignment map)
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} teamId - Team ID
     * @returns {object} Cascade summary
     */
    function teamDeleted(appData, teamId) {
        if (!appData || !isNonEmptyString(teamId)) {
            return { modules: [], details: {} };
        }

        var target = String(teamId);
        var entries = [];

        entries.push({
            module: 'academyWeeklyTeams',
            result: runStripHelper(
                'academyWeeklyTeams', 'AcademyWeeklyTeams',
                'stripTeamRefs', appData, target
            )
        });

        return summarise(entries);
    }

    // ============================================================
    // SUMMARY RENDERING (for activity log messages)
    // ============================================================

    /**
     * Build a short human-readable summary of a cascade result, for
     * inclusion in an activity log message.
     *
     * @param {object} cascade - Result from one of the cascade functions
     * @returns {string} e.g. "(3 enrolments, 5 grades)"
     */
    function formatSummary(cascade) {
        if (!cascade || !cascade.details) {
            return '';
        }

        var parts = [];
        var details = cascade.details;

        if (details.academyEnrolments) {
            var e = details.academyEnrolments.enrolmentsRemoved || 0;
            if (e > 0) { parts.push(e + ' enrolment(s)'); }
        }
        if (details.academyGrades) {
            var g = details.academyGrades.gradesRemoved || 0;
            if (g > 0) { parts.push(g + ' grade(s)'); }
        }
        if (details.academyRanking) {
            var r = details.academyRanking.rankingsRemoved || 0;
            if (r > 0) { parts.push(r + ' ranking(s)'); }
        }
        if (details.academySocialScore) {
            var s = details.academySocialScore.socialScoresRemoved || 0;
            if (s > 0) { parts.push(s + ' social score(s)'); }
        }
        if (details.academyWeeklyTeams) {
            var w = details.academyWeeklyTeams.assignmentsRemoved || 0;
            if (w > 0) { parts.push(w + ' team assignment(s)'); }
        }
        if (details.academyGroups) {
            var ag = details.academyGroups;
            var agTotal = (ag.instructorGroupsRemoved || 0) +
                          (ag.studentMembershipsRemoved || 0);
            if (agTotal > 0) { parts.push(agTotal + ' group reference(s)'); }
        }
        if (details.socialCore) {
            var sc = details.socialCore.relationshipsRemoved || 0;
            if (sc > 0) { parts.push(sc + ' relationship(s)'); }
        }
        if (details.missionCore) {
            var mc = details.missionCore.supportEntriesRemoved || 0;
            if (mc > 0) { parts.push(mc + ' mission reference(s)'); }
        }
        if (details.tournamentCore) {
            var t = details.tournamentCore;
            var tTotal = (t.participantRecordsRemoved || 0) +
                         (t.eliminationRecordsRemoved || 0) +
                         (t.winnerRecordsCleared || 0) +
                         (t.matchParticipantSlotsRemoved || 0) +
                         (t.matchesPruned || 0);
            if (tTotal > 0) { parts.push(tTotal + ' tournament reference(s)'); }
        }

        if (parts.length === 0) {
            return '';
        }
        return '(' + parts.join(', ') + ')';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCascade = {
        characterDeleted: characterDeleted,
        classDeleted: classDeleted,
        disciplineDeleted: disciplineDeleted,
        locationDeleted: locationDeleted,
        teamDeleted: teamDeleted,
        formatSummary: formatSummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyCascade;
        var missing = [];

        var required = [
            'characterDeleted',
            'classDeleted',
            'disciplineDeleted',
            'locationDeleted',
            'teamDeleted',
            'formatSummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyCascade] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
