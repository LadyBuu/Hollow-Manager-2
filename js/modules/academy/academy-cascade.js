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
 *   domain module was added (enrolments, social score, weekly teams,
 *   teaching groups, teaching sessions), every delete path needed to
 *   be updated. Missing one created orphaned references. The
 *   coordinator centralises the list of "everything that needs to be
 *   cleaned up when X is deleted" so adding a new domain module means
 *   updating ONE file.
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
 * TEACHING-MODEL CASCADE SEMANTICS (v20):
 *
 *   The teaching model adds three stores to academy:
 *     classDisciplines       a class's offering of a discipline
 *     teachingGroups         students + instructor for a class-discipline
 *     teachingSessions       recurring meetings of a teaching group
 *
 *   Cascade rules:
 *
 *     classDeleted:
 *       - Every teaching group whose classId matches is HARD-DELETED.
 *       - Every teaching session whose group belonged to the class is
 *         HARD-DELETED. Sessions are resolved by walking the group
 *         store, because sessions only carry a groupId, not a classId.
 *
 *     disciplineDeleted:
 *       - Sessions belonging to any group for the discipline are
 *         HARD-DELETED first (they would orphan otherwise).
 *       - Every teaching group whose disciplineId matches is
 *         HARD-DELETED.
 *
 *     characterDeleted:
 *       - Every membership window for the character is ENDED
 *         (endWeek set). History survives.
 *       - Every group whose instructorId matches has its own endWeek
 *         set. The group record survives as a historical fact.
 *       - Sessions for those groups are NOT touched. The group still
 *         exists; the instructor has simply stopped.
 *
 *     locationDeleted:
 *       - Every session whose locationId matches has the locationId
 *         NULLED. The session survives, unassigned. A decommissioned
 *         room does not end the class; it just needs a new room.
 *
 *   The distinction is deliberate:
 *     - Class and discipline deletion hard-deletes, because the
 *       class/discipline never existed. There is no window to preserve.
 *     - Character deletion ends windows, because the character did
 *       exist; a stop in the timeline is a fact worth recording.
 *     - Location deletion nulls a reference, because the location was
 *       a property of the session, not its identity.
 *
 * WEEKLY-TEAMS CASCADE SEMANTICS:
 *
 *   The character-deletion cascade names `AcademyWeeklyTeams.stripCharacterRefs`.
 *   That helper is the WEEK-AGNOSTIC counterpart to the module's own
 *   `endCharacterMemberships(appData, charId, effectiveWeek)`.
 *
 *   Why two helpers:
 *     - `endCharacterMemberships` requires an explicit effective week.
 *       It is used by callers that know the character stopped at a
 *       particular week (e.g. a future "archive this student" flow).
 *     - `stripCharacterRefs` takes no week. It ends every open interval
 *       with `leavePeriod = MAX_WEEK`. It is used by character deletion
 *       itself, where "the character is gone" is not a week-bound fact
 *       and no meaningful effective week exists.
 *
 *   If the coordinator ever passed only a charId to
 *   `endCharacterMemberships`, the function would return a zero-count
 *   result without ending any interval, because its `parseWeekStrict`
 *   guard rejects an absent effective week. The two helpers are not
 *   interchangeable; the coordinator calls the week-agnostic one.
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
 *   - window.AcademyTeachingGroups       (v20)
 *   - window.AcademyTeachingSessions     (v20)
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

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
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

    /**
     * Walk the teaching-group store from an appData snapshot and
     * return the IDs of every group matching a predicate.
     *
     * Used by disciplineDeleted to find the groups whose sessions
     * must be stripped before the groups themselves are removed.
     *
     * @param {object} appData
     * @param {function} predicate - receives a group record, returns bool
     * @returns {array} Array of group IDs
     */
    function findTeachingGroupIds(appData, predicate) {
        var result = [];
        if (!appData || typeof appData !== 'object') {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }
        var store = appData.academy.teachingGroups;
        if (!isPlainObject(store)) {
            return result;
        }
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var group = store[keys[i]];
            if (!isPlainObject(group)) {
                continue;
            }
            if (predicate(group)) {
                result.push(keys[i]);
            }
        }
        return result;
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
     *   5. Academy weekly teams (membership intervals across every
     *      persistent Team entity; every open interval is closed
     *      with leavePeriod = MAX_WEEK)
     *   6. Academy auto-groups (instructor groups removed; student
     *      memberships removed)
     *   7. Academy teaching groups (v20) — membership windows ended;
     *      groups instructed by the character have their endWeek set.
     *      Sessions are NOT touched (the group still exists).
     *   8. Social relationships (from SocialCore, if present)
     *   9. Mission support personnel (from MissionCore, if present)
     *  10. Tournament participants / eliminations / matches (from
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

        // v20 — Teaching groups.
        //
        // stripCharacterRefs ends membership windows and sets the
        // endWeek on any group whose instructorId matches. Sessions
        // are untouched: the group still exists as a historical
        // fact, and its recurring meetings were a property of the
        // group, not the character.
        entries.push({
            module: 'academyTeachingGroups',
            result: runStripHelper(
                'academyTeachingGroups', 'AcademyTeachingGroups',
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
     *   6. Academy teaching sessions (v20) — sessions belonging to
     *      any group of the class. Sessions are resolved via the
     *      group store, because sessions only carry a groupId.
     *   7. Academy teaching groups (v20) — every group whose classId
     *      matches is removed.
     *
     * Note: class membership is stored on character.classIds. The
     * caller (AcademyClasses.delete) is responsible for stripping the
     * classId from characters, because AcademyClasses owns that data
     * relationship. This coordinator does not touch character records.
     *
     * Note: sessions must be stripped BEFORE the groups are stripped,
     * because AcademyTeachingSessions.stripClassRefs resolves the
     * class via the group store. If the groups are gone, the session
     * strip finds nothing.
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

        // v20 — Sessions first. Sessions reference groups, groups
        // reference classes. The helper walks the group store to
        // resolve the class. If we stripped groups first, the
        // session strip would find no matching groups.
        entries.push({
            module: 'academyTeachingSessions',
            result: runStripHelper(
                'academyTeachingSessions', 'AcademyTeachingSessions',
                'stripClassRefs', appData, target
            )
        });

        // v20 — Then groups.
        entries.push({
            module: 'academyTeachingGroups',
            result: runStripHelper(
                'academyTeachingGroups', 'AcademyTeachingGroups',
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
     *   1. Academy enrolments (disciplineId removed from every
     *      student's enrolment intervals)
     *   2. Academy teaching sessions (v20) — sessions belonging to
     *      any group whose disciplineId matches. This is a two-step
     *      operation: we resolve the group IDs from the snapshot
     *      first, strip their sessions one by one, then (step 3)
     *      strip the groups themselves.
     *   3. Academy teaching groups (v20) — every group whose
     *      disciplineId matches is removed.
     *
     * Note: AcademyDisciplines.delete handles the other discipline
     * cascades inline (schedules, auto-groups, metadata, grades)
     * because those are curriculum-internal concerns that its own
     * private helpers already cover. The coordinator handles the
     * cross-domain parts only.
     *
     * Note on ordering: sessions must be stripped BEFORE their
     * groups disappear from the snapshot. stripGroupRefs finds
     * sessions by iterating the session store and matching groupId.
     * It does not need the group record itself; but if the group
     * is already removed from academy.teachingGroups, we have no
     * way to enumerate the group IDs to call stripGroupRefs on.
     * So we snapshot the IDs first.
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

        // v20 — Sessions and groups.
        //
        // We resolve the group IDs BEFORE stripping anything. Then
        // strip sessions for each group ID. Then strip the groups
        // themselves. Each step is idempotent and safe to skip if
        // its helper is missing.

        var matchingGroupIds = findTeachingGroupIds(appData, function(group) {
            return String(group.disciplineId) === target;
        });

        var sessionStrips = 0;
        var sessionsRemoved = 0;
        var sessionsModuleAvailable = false;

        var Sessions = window.AcademyTeachingSessions;
        if (Sessions && typeof Sessions.stripGroupRefs === 'function' &&
            matchingGroupIds.length > 0) {
            sessionsModuleAvailable = true;
            for (var i = 0; i < matchingGroupIds.length; i++) {
                try {
                    var sessionResult = Sessions.stripGroupRefs(
                        appData,
                        matchingGroupIds[i]
                    );
                    if (sessionResult &&
                        typeof sessionResult.sessionsRemoved === 'number') {
                        sessionsRemoved += sessionResult.sessionsRemoved;
                    }
                    sessionStrips++;
                } catch (e) {
                    throw new Error(
                        '[AcademyCascade] AcademyTeachingSessions.stripGroupRefs ' +
                        'threw during discipline cascade: ' +
                        (e && e.message ? e.message : e)
                    );
                }
            }
        }

        if (sessionsModuleAvailable) {
            entries.push({
                module: 'academyTeachingSessions',
                result: {
                    sessionsRemoved: sessionsRemoved,
                    groupsProcessed: sessionStrips
                }
            });
        }

        entries.push({
            module: 'academyTeachingGroups',
            result: runStripHelper(
                'academyTeachingGroups', 'AcademyTeachingGroups',
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
     * Order of operations:
     *   1. Academy teaching sessions (v20) — every session whose
     *      locationId matches has the locationId NULLED. The
     *      session survives, unassigned. A decommissioned room does
     *      not end the class; it just needs a new room.
     *
     * Note: location cleanup is otherwise curriculum-internal
     * (locationSchedules, classLocations, metadata). AcademyLocations
     * handles it inline via its own cascade helpers. The v20 teaching
     * cascade is the one cross-domain part this coordinator owns.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} locationId - Location ID
     * @returns {object} Cascade summary
     */
    function locationDeleted(appData, locationId) {
        if (!appData || !isNonEmptyString(locationId)) {
            return { modules: [], details: {} };
        }

        var target = String(locationId);
        var entries = [];

        entries.push({
            module: 'academyTeachingSessions',
            result: runStripHelper(
                'academyTeachingSessions', 'AcademyTeachingSessions',
                'stripLocationRefs', appData, target
            )
        });

        return summarise(entries);
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
            var w = details.academyWeeklyTeams.assignmentsRemoved ||
                    details.academyWeeklyTeams.membershipsEnded ||
                    details.academyWeeklyTeams.recordsRemoved ||
                    0;
            if (w > 0) { parts.push(w + ' team assignment(s)'); }
        }
        if (details.academyGroups) {
            var ag = details.academyGroups;
            var agTotal = (ag.instructorGroupsRemoved || 0) +
                          (ag.studentMembershipsRemoved || 0);
            if (agTotal > 0) { parts.push(agTotal + ' group reference(s)'); }
        }

        // v20 — Teaching groups and sessions.
        if (details.academyTeachingGroups) {
            var tg = details.academyTeachingGroups;
            var tgTotal = (tg.groupsRemoved || 0) +
                          (tg.membershipsEnded || 0) +
                          (tg.groupsEndedAsInstructor || 0);
            if (tgTotal > 0) {
                parts.push(tgTotal + ' teaching-group reference(s)');
            }
        }
        if (details.academyTeachingSessions) {
            var ts = details.academyTeachingSessions;
            var tsTotal = (ts.sessionsRemoved || 0) +
                          (ts.sessionsCleared || 0);
            if (tsTotal > 0) {
                parts.push(tsTotal + ' teaching-session reference(s)');
            }
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

    window.AcademyCascade = Object.freeze({
        characterDeleted: characterDeleted,
        classDeleted: classDeleted,
        disciplineDeleted: disciplineDeleted,
        locationDeleted: locationDeleted,
        teamDeleted: teamDeleted,
        formatSummary: formatSummary
    });

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