/**
 * js/modules/academy/academy-cascade.js - Academy Cascade Coordinator
 *
 * Path: js/modules/academy/academy-cascade.js
 *
 * Single entry point for cross-domain cleanup when Academy entities
 * are deleted.
 *
 * WHAT THIS MODULE OWNS:
 *   Coordinating cleanup after character, class, discipline,
 *   location, and team deletion. Each cascade function calls the
 *   strip*Refs helpers exposed by the domain modules that need to
 *   react to the deletion, and returns a merged summary.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   The cleanup itself. Each domain module owns its own
 *   strip*Refs helpers. This coordinator calls them in a defined
 *   order and merges the results. It does not reimplement any
 *   cascade logic. It does not call MutationPipeline; the caller
 *   (AcademyClasses.delete, AcademyDisciplines.delete, etc.) owns
 *   the transaction.
 *
 * TRANSACTION MODEL:
 *   Every helper this coordinator calls is PURE with respect to
 *   appData: it mutates the snapshot it is given and never touches
 *   window.data. The coordinator is designed to run INSIDE a
 *   pipeline mutate() callback, so every cascade participates in
 *   the same transaction as the entity removal.
 *
 * OPTIONAL-DEPENDENCY POLICY:
 *   Domain modules that are not loaded at call time are skipped
 *   silently, EXCEPT for a single warn the first time a given
 *   (module, helper) pair is skipped. This is deliberate: the
 *   coordinator's job is to run whatever cleanup is available
 *   without failing the enclosing transaction. But a silent skip
 *   is how a missing strip helper goes unnoticed — the
 *   MissionCore.stripCharacterRefs and TournamentCore.
 *   stripCharacterRefs gaps went undetected for exactly this
 *   reason. The warn makes the gap visible without making it
 *   fatal.
 *
 *   The warn fires at most once per (module, helper) pair per
 *   session. A batch delete over fifty characters skips the same
 *   missing helper fifty times and warns once.
 *
 * ORDERING RULES:
 *   The cascade functions respect two ordering constraints:
 *
 *     classDeleted and disciplineDeleted:
 *       Sessions are stripped BEFORE groups, because
 *       AcademyTeachingSessions.stripClassRefs and
 *       AcademyTeachingSessions.stripGroupRefs resolve the class or
 *       group via the group store. Once the group is gone, the
 *       session strip finds nothing.
 *
 *     disciplineDeleted:
 *       The group IDs matching the discipline are captured BEFORE
 *       any group is removed, so the session strip has something
 *       to iterate over.
 *
 *   Both constraints are documented inline at the point where
 *   they matter.
 *
 * SEMANTICS BY DELETION TYPE:
 *
 *   characterDeleted(appData, charId):
 *     Strips every reference to a character across academy and
 *     curriculum. Enrolments and grades are hard-deleted; ranking
 *     records are hard-deleted; social scores are hard-deleted;
 *     weekly-team memberships are ended with leavePeriod = MAX_WEEK
 *     (the character existed; a stop in the timeline is a fact
 *     worth recording); teaching-group memberships are ended;
 *     groups instructed by the character have their endWeek set;
 *     sessions are not touched (the group still exists). Social,
 *     mission, and tournament references are delegated to their
 *     respective domains.
 *
 *     Instructor commitments (this revision):
 *       academyInstructorCommitments.stripCharacterRefs is called
 *       for the deleted character. It handles two distinct roles
 *       in one pass:
 *
 *         - Commitments the character OWNED as instructor are
 *           deleted. The block was theirs; it goes with them.
 *
 *         - Commitments where the character was the SUBJECT of a
 *           tutoring block are kept, with characterId nulled. The
 *           block still belongs to the instructor; the reference
 *           to the deleted character is the only thing removed.
 *
 *       No separate stripInstructorRefs call is needed here. The
 *       single stripCharacterRefs handles both roles.
 *
 *   classDeleted(appData, classId):
 *     Hard-deletes enrolments, grades, rankings, social scores,
 *     weekly-team windows, teaching sessions, and teaching groups.
 *     The class never existed as a historical record from the
 *     cascade's point of view; hard delete is correct.
 *
 *     Instructor commitments (this revision):
 *       academyInstructorCommitments.stripClassRefs is called for
 *       the deleted class. Every commitment attached to the class
 *       is removed. Commitments are class-scoped, so a class
 *       deletion takes its commitments with it.
 *
 *   disciplineDeleted(appData, disciplineId):
 *     Hard-deletes enrolments, teaching sessions for the
 *     discipline's groups, and the groups themselves. Same
 *     reasoning: the discipline is gone.
 *
 *     No new call in this revision. Instructor commitments are not
 *     attached to disciplines.
 *
 *   locationDeleted(appData, locationId):
 *     Nulls the locationId on every teaching session that
 *     referenced it. The session survives, unassigned. A
 *     decommissioned room does not end the class; it needs a new
 *     room.
 *
 *     Instructor commitments (this revision):
 *       The commitments module does not own a location strip
 *       helper. The reason: a commitment's locationId is a
 *       reference, not a foreign key with cascade semantics. When
 *       a location is deleted, the commitment should have its
 *       locationId nulled, exactly as a teaching session does.
 *       That helper is not exposed by
 *       academyInstructorCommitments in this turn. Until it is,
 *       commitments retain a stale locationId after a location
 *       delete; reads fall back to the null display path when the
 *       referenced location cannot be resolved. Adding the strip
 *       helper is a small follow-up.
 *
 *   teamDeleted(appData, teamId):
 *     Removes the teamId from every class-week assignment map.
 *
 *     No new call in this revision. Instructor commitments have
 *     no teamId.
 *
 * RETURN SHAPE:
 *   {
 *     modules: [ 'academyEnrolments', 'academyGrades', ... ],
 *     details: {
 *       academyEnrolments: { enrolmentsRemoved: 3 },
 *       academyGrades: { gradesRemoved: 5 },
 *       ...
 *     }
 *   }
 *
 *   The `modules` array lists which strip*Refs helpers actually
 *   ran. Modules that were unavailable are omitted.
 *
 * DEPENDENCIES:
 *   None at module load. All helpers are read lazily at call time.
 *
 * USAGE:
 *   // Inside a pipeline mutate() callback in AcademyClasses.delete:
 *   var cascade = AcademyCascade.classDeleted(appData, classId);
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

    // ============================================================
    // SKIP-WARNING BOOKKEEPING
    // ============================================================
    //
    // A silent skip is how a missing strip helper goes unnoticed.
    // The warn fires at most once per (module, helper) pair per
    // session so a batch delete does not spam the console.

    var _warnedSkips = Object.create(null);

    function warnSkipOnce(moduleName, helperName, reason) {
        var key = moduleName + '.' + helperName;
        if (_warnedSkips[key] === true) { return; }
        _warnedSkips[key] = true;

        console.warn(
            '[AcademyCascade] Skipping ' + key + ' during cascade: ' +
            reason + '. References to the deleted entity will remain ' +
            'in this domain.'
        );
    }

    // ============================================================
    // STRIP HELPER DISPATCH
    // ============================================================

    /**
     * Call a strip helper on a module if the module is loaded and
     * the helper is a function.
     *
     * Missing module or missing helper -> warn once, return a
     * skipped marker. The marker is filtered out of the merged
     * summary by summarise().
     *
     * A throwing helper is a bug and fails the enclosing
     * transaction: the caller's pipeline rolls back and the error
     * surfaces.
     *
     * @param {string} moduleName  - Human-readable name for the summary
     * @param {string} modulePath  - Property name on window
     * @param {string} helperName  - Method name on the module
     * @param {object} appData
     * @param {string} entityId
     * @returns {object} The helper's return value, or a skipped marker
     */
    function runStripHelper(
        moduleName,
        modulePath,
        helperName,
        appData,
        entityId
    ) {
        var mod = window[modulePath];

        if (!mod) {
            warnSkipOnce(
                moduleName,
                helperName,
                'module window.' + modulePath + ' is not loaded'
            );
            return {
                skipped: true,
                reason: 'module-not-loaded'
            };
        }

        if (typeof mod[helperName] !== 'function') {
            warnSkipOnce(
                moduleName,
                helperName,
                'module window.' + modulePath +
                ' does not export ' + helperName + '()'
            );
            return {
                skipped: true,
                reason: 'helper-not-exported'
            };
        }

        try {
            var result = mod[helperName](appData, entityId);
            return result || {};
        } catch (e) {
            throw new Error(
                '[AcademyCascade] ' + moduleName + '.' + helperName +
                ' threw during cascade: ' +
                (e && e.message ? e.message : e)
            );
        }
    }

    /**
     * Build a cascade summary from a set of helper results.
     *
     * Skipped markers are dropped. Only helpers that actually ran
     * (and returned a value, even an empty object) appear in the
     * summary.
     *
     * @param {array} entries - Array of { module, result } objects
     * @returns {object} { modules: string[], details: object }
     */
    function summarise(entries) {
        var modules = [];
        var details = {};

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry) { continue; }
            if (entry.result === null || entry.result === undefined) {
                continue;
            }
            if (entry.result.skipped === true) {
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
     * Called from CharacterCRUD.deleteCharacter's pipeline mutate.
     *
     * Ordering:
     *   1.  Academy enrolments (hard delete)
     *   2.  Academy grades (hard delete)
     *   3.  Academy rankings (hard delete)
     *   4.  Academy social scores (hard delete)
     *   5.  Academy weekly teams (memberships ended, leavePeriod =
     *       MAX_WEEK; the character existed, and the ending is a
     *       historical fact)
     *   6.  Academy auto-groups (instructor groups removed; student
     *       memberships removed)
     *   7.  Academy teaching groups (membership windows ended; groups
     *       instructed by the character have their endWeek set;
     *       sessions are NOT touched, because the group survives)
     *   8.  Academy instructor commitments (owned commitments
     *       deleted; subject references nulled)       [this revision]
     *   9.  Social relationships (SocialCore.stripCharacterRefs)
     *   10. Mission support personnel and report authors
     *       (MissionCore.stripCharacterRefs, delegating to
     *       MissionCascade)
     *   11. Tournament participants, eliminations, match participant
     *       slots, and match result maps
     *       (TournamentCore.stripCharacterRefs, delegating to
     *       TournamentCascade)
     *
     * @param {object} appData - Pipeline snapshot
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
            module: 'academyTeachingGroups',
            result: runStripHelper(
                'academyTeachingGroups', 'AcademyTeachingGroups',
                'stripCharacterRefs', appData, target
            )
        });

        // ---- Instructor commitments (this revision) ----
        //
        // One call handles both roles:
        //   - the character as instructor: their commitments are
        //     deleted
        //   - the character as tutoring subject: characterId is
        //     nulled, the commitment survives
        //
        // The helper is idempotent and safe to call before the
        // commitments module has been loaded. When it is not
        // loaded, runStripHelper warns once and the cascade
        // proceeds.
        entries.push({
            module: 'academyInstructorCommitments',
            result: runStripHelper(
                'academyInstructorCommitments',
                'AcademyInstructorCommitments',
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
     * Called from AcademyClasses.delete's pipeline mutate.
     *
     * ORDERING: sessions are stripped BEFORE groups. The session
     * strip resolves the class via the group store; if the groups
     * are gone, the session strip finds nothing.
     *
     * Class membership is stored on character.classIds.
     * AcademyClasses.delete itself strips the classId from
     * characters, because AcademyClasses owns that data
     * relationship. This coordinator does not touch character
     * records.
     *
     * Instructor commitments (this revision) are class-scoped.
     * They are stripped after the groups, because the order
     * relative to groups does not matter for them and grouping the
     * "class-owned" strips together reads more clearly.
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

        // Sessions first; see the ordering note above.
        entries.push({
            module: 'academyTeachingSessions',
            result: runStripHelper(
                'academyTeachingSessions', 'AcademyTeachingSessions',
                'stripClassRefs', appData, target
            )
        });

        // Then groups.
        entries.push({
            module: 'academyTeachingGroups',
            result: runStripHelper(
                'academyTeachingGroups', 'AcademyTeachingGroups',
                'stripClassRefs', appData, target
            )
        });

        // ---- Instructor commitments (this revision) ----
        //
        // Every commitment attached to the class is removed. The
        // strip is independent of groups and sessions; it walks
        // its own store and matches on classId.
        entries.push({
            module: 'academyInstructorCommitments',
            result: runStripHelper(
                'academyInstructorCommitments',
                'AcademyInstructorCommitments',
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
     * Called from AcademyDisciplines.delete's pipeline mutate.
     *
     * Two-step session cleanup: the group IDs for the discipline
     * are captured BEFORE anything is removed, then sessions are
     * stripped per group, then the groups themselves are stripped.
     * Reversing the order leaves no way to enumerate the groups to
     * clean sessions for.
     *
     * Instructor commitments have no discipline reference; they
     * are not part of this cascade.
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

        // Capture group IDs BEFORE removing any group. See the
        // ordering note above.
        var matchingGroupIds = findTeachingGroupIds(
            appData,
            function(group) {
                return String(group.disciplineId) === target;
            }
        );

        var sessionsRemoved = 0;
        var sessionsGroupsProcessed = 0;
        var sessionsModuleAvailable = false;

        var Sessions = window.AcademyTeachingSessions;
        if (Sessions &&
            typeof Sessions.stripGroupRefs === 'function' &&
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
                    sessionsGroupsProcessed++;
                } catch (e) {
                    throw new Error(
                        '[AcademyCascade] ' +
                        'AcademyTeachingSessions.stripGroupRefs ' +
                        'threw during discipline cascade: ' +
                        (e && e.message ? e.message : e)
                    );
                }
            }
        } else if (!Sessions) {
            warnSkipOnce(
                'academyTeachingSessions',
                'stripGroupRefs',
                'module window.AcademyTeachingSessions is not loaded'
            );
        } else if (typeof Sessions.stripGroupRefs !== 'function') {
            warnSkipOnce(
                'academyTeachingSessions',
                'stripGroupRefs',
                'module window.AcademyTeachingSessions does not ' +
                'export stripGroupRefs()'
            );
        }

        if (sessionsModuleAvailable) {
            entries.push({
                module: 'academyTeachingSessions',
                result: {
                    sessionsRemoved: sessionsRemoved,
                    groupsProcessed: sessionsGroupsProcessed
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
     * Called from AcademyLocations.delete's pipeline mutate.
     *
     * The location is nulled on every teaching session that
     * referenced it. Sessions are not deleted; the room was a
     * property of the session, not its identity.
     *
     * Instructor commitments may reference a location. The
     * commitments module does not currently expose a
     * stripLocationRefs helper. When the helper is added, this
     * function gains a second entry. Until then, a commitment
     * whose location is deleted retains a stale locationId; reads
     * fall back to the null display path when the referenced
     * location cannot be resolved.
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
     * Called from TeamCore.deleteTeam's pipeline mutate.
     *
     * The teamId is removed from every class-week assignment map.
     *
     * Instructor commitments have no teamId reference; they are
     * not part of this cascade.
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
    // SUMMARY RENDERING
    // ============================================================

    /**
     * Build a short human-readable summary of a cascade result, for
     * inclusion in an activity log message.
     *
     * @param {object} cascade
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

        // ---- Instructor commitments (this revision) ----
        //
        // Two counters are summed under one label:
        //   commitmentsRemoved  - the commitment block was deleted
        //   referencesCleared   - the subject reference was nulled
        //
        // They are both "the cascade touched this many commitment
        // records." Splitting them in the summary would be noise;
        // the details object carries both separately for
        // programmatic consumers.
        if (details.academyInstructorCommitments) {
            var ic = details.academyInstructorCommitments;
            var icTotal = (ic.commitmentsRemoved || 0) +
                          (ic.referencesCleared || 0);
            if (icTotal > 0) {
                parts.push(icTotal + ' instructor commitment(s)');
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
                         (t.matchParticipantSlotsRemoved || 0) +
                         (t.matchResultEntriesRemoved || 0);
            if (tTotal > 0) {
                parts.push(tTotal + ' tournament reference(s)');
            }
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
            console.warn(
                '[AcademyCascade] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
