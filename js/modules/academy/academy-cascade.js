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
 * DEPENDENCY POLICY — MANDATORY AT CALL TIME:
 *   Domain modules that a cascade function needs are MANDATORY at
 *   the moment that function runs. Missing module → throw. Missing
 *   helper on a present module → throw. A helper that throws →
 *   propagate. A helper whose return value is not a plain object
 *   → throw.
 *
 *   This is deliberate and is a correction of an earlier policy
 *   that treated missing helpers as warnings. That policy produced
 *   silent cross-domain leaks: a delete would commit while
 *   references in a domain that had not been loaded survived.
 *   The MissionCore.stripCharacterRefs and
 *   TournamentCore.stripCharacterRefs gaps went undetected for
 *   exactly that reason.
 *
 *   The right failure mode for a cascade is:
 *
 *     delete requested
 *         ↓
 *     cascade
 *         ↓
 *     missing dependency
 *         ↓
 *     throw
 *         ↓
 *     pipeline rolls back
 *         ↓
 *     developer fixes the load order
 *
 *   The wrong failure mode is:
 *
 *     delete requested
 *         ↓
 *     cascade
 *         ↓
 *     missing dependency
 *         ↓
 *     warning
 *         ↓
 *     delete commits with orphan references
 *
 *   Load order is solved by lazy lookup at call time — the
 *   functions below read window.X each time they run, so a module
 *   loaded after this one still resolves. That solves ordering.
 *   Optionality is a different question, and the answer for a
 *   cascade is no.
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
 *   Every module that participated appears in `modules` and
 *   contributes a plain object to `details`. A helper that returns
 *   null or undefined is a contract violation and fails the
 *   transaction.
 *
 * ORDERING RULES:
 *   The cascade functions respect two ordering constraints:
 *
 *     classDeleted and disciplineDeleted:
 *       Sessions are stripped BEFORE groups, because the session
 *       strip resolves the class or discipline via the group
 *       store. Once the groups are gone, the session strip has
 *       nothing to resolve against.
 *
 *     disciplineDeleted:
 *       The discipline-scoped session strip is a single call to
 *       AcademyTeachingSessions.stripDisciplineRefs. That helper
 *       owns the discipline→group→session resolution internally.
 *       This coordinator does not walk the group store.
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
 *     Instructor commitments:
 *       academyInstructorCommitments.stripCharacterRefs is called
 *       for the deleted character. It handles two distinct roles
 *       in one pass:
 *
 *         - Commitments the character OWNED as instructor are
 *           deleted. The block was theirs; it goes with them.
 *
 *         - Commitments where the character was the SUBJECT of a
 *           tutoring block are kept, with characterId nulled.
 *
 *   classDeleted(appData, classId):
 *     Hard-deletes enrolments, grades, rankings, social scores,
 *     weekly-team windows, teaching sessions, teaching groups,
 *     and instructor commitments attached to the class.
 *
 *   disciplineDeleted(appData, disciplineId):
 *     Hard-deletes enrolments, teaching sessions for the
 *     discipline's groups, and the groups themselves. The session
 *     strip is delegated to
 *     AcademyTeachingSessions.stripDisciplineRefs, which resolves
 *     the discipline's groups internally.
 *
 *   locationDeleted(appData, locationId):
 *     Nulls the locationId on every teaching session and every
 *     instructor commitment that referenced it. Records survive,
 *     unassigned. A decommissioned room does not end the class;
 *     it needs a new room.
 *
 *   teamDeleted(appData, teamId):
 *     Removes the teamId from every class-week assignment map.
 *
 * DEPENDENCIES:
 *   None at module load. All helpers are resolved lazily at call
 *   time, and are MANDATORY at call time.
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
    // STRIP HELPER DISPATCH — STRICT
    // ============================================================
    //
    // A missing module, a missing helper, a thrown error, or a
    // non-object return value all fail the enclosing transaction.
    //
    // There is no skip path. If a cascade function is invoked, it
    // is because an entity is being deleted, and every reference to
    // that entity must be cleaned up in the same transaction.

    function runStripHelper(
        moduleName,
        modulePath,
        helperName,
        appData,
        entityId
    ) {
        var mod = window[modulePath];

        if (!mod) {
            throw new Error(
                '[AcademyCascade] Required module window.' + modulePath +
                ' is not loaded. The ' + moduleName + ' domain must be ' +
                'present before a cascade that touches it can run. ' +
                'Check the script load order in index.html.'
            );
        }

        if (typeof mod[helperName] !== 'function') {
            throw new Error(
                '[AcademyCascade] Module window.' + modulePath +
                ' does not export ' + helperName + '(). The ' +
                moduleName + ' domain must implement this strip helper ' +
                'before a cascade that touches it can run.'
            );
        }

        var result;
        try {
            result = mod[helperName](appData, entityId);
        } catch (e) {
            throw new Error(
                '[AcademyCascade] ' + moduleName + '.' + helperName +
                ' threw during cascade: ' +
                (e && e.message ? e.message : e)
            );
        }

        if (!isPlainObject(result)) {
            throw new Error(
                '[AcademyCascade] ' + moduleName + '.' + helperName +
                '() must return a plain result object, got ' +
                (result === null ? 'null' :
                 result === undefined ? 'undefined' :
                 typeof result) + '.'
            );
        }

        return result;
    }

    /**
     * Build a cascade summary from a set of helper results.
     *
     * Every entry that arrives here has already passed the strict
     * contract (plain object). No filtering is needed.
     */
    function summarise(entries) {
        var modules = [];
        var details = {};

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry) { continue; }
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
    //
    // ORDERING: sessions are stripped BEFORE groups. The session
    // strip resolves the class via the group store; if the groups
    // are gone, the session strip has nothing to resolve against.

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
    //
    // ORDERING: sessions are stripped BEFORE groups, because
    // AcademyTeachingSessions.stripDisciplineRefs resolves the
    // discipline's groups via the group store. The sessions helper
    // owns that resolution; this coordinator does not walk groups.

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

        // Sessions first. The sessions domain resolves the
        // discipline's groups internally.
        entries.push({
            module: 'academyTeachingSessions',
            result: runStripHelper(
                'academyTeachingSessions', 'AcademyTeachingSessions',
                'stripDisciplineRefs', appData, target
            )
        });

        // Then groups.
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

        entries.push({
            module: 'academyInstructorCommitments',
            result: runStripHelper(
                'academyInstructorCommitments',
                'AcademyInstructorCommitments',
                'stripLocationRefs', appData, target
            )
        });

        return summarise(entries);
    }

    // ============================================================
    // TEAM DELETION CASCADE
    // ============================================================

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
    //
    // Wording: "changes" is used for counts that mix entity
    // removals, membership endings, and state updates. Splitting
    // them into per-category counts would be more precise, but the
    // summary is activity-log prose; "changes" is honest and short.

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
            if (agTotal > 0) {
                parts.push(agTotal + ' auto-group change(s)');
            }
        }

        if (details.academyTeachingGroups) {
            var tg = details.academyTeachingGroups;
            var tgTotal = (tg.groupsRemoved || 0) +
                          (tg.membershipsEnded || 0) +
                          (tg.groupsEndedAsInstructor || 0);
            if (tgTotal > 0) {
                parts.push(tgTotal + ' teaching-group change(s)');
            }
        }
        if (details.academyTeachingSessions) {
            var ts = details.academyTeachingSessions;
            var tsTotal = (ts.sessionsRemoved || 0) +
                          (ts.sessionsCleared || 0);
            if (tsTotal > 0) {
                parts.push(tsTotal + ' teaching-session change(s)');
            }
        }

        if (details.academyInstructorCommitments) {
            var ic = details.academyInstructorCommitments;
            var icTotal = (ic.commitmentsRemoved || 0) +
                          (ic.referencesCleared || 0);
            if (icTotal > 0) {
                parts.push(icTotal + ' instructor-commitment change(s)');
            }
        }

        if (details.socialCore) {
            var sc = details.socialCore.relationshipsRemoved || 0;
            if (sc > 0) { parts.push(sc + ' relationship(s)'); }
        }
        if (details.missionCore) {
            var mc = details.missionCore.supportEntriesRemoved || 0;
            if (mc > 0) { parts.push(mc + ' mission change(s)'); }
        }
        if (details.tournamentCore) {
            var t = details.tournamentCore;
            var tTotal = (t.participantRecordsRemoved || 0) +
                         (t.eliminationRecordsRemoved || 0) +
                         (t.matchParticipantSlotsRemoved || 0) +
                         (t.matchResultEntriesRemoved || 0);
            if (tTotal > 0) {
                parts.push(tTotal + ' tournament change(s)');
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
