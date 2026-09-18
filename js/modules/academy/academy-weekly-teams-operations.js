/**
 * modules/academy/academy-weekly-teams-operations.js
 * Academy Weekly Teams Operations
 *
 * Path: js/modules/academy/academy-weekly-teams-operations.js
 *
 * The auto-distribute algorithm for Weekly Teams, extracted from
 * AcademyWeeklyTeamsController. The controller becomes a thin
 * application layer that opens the modal, collects the settings,
 * and delegates the algorithm to this module.
 *
 * WHAT THIS MODULE IS:
 *   - One public function: runAutoDistribute(ctx, deps).
 *   - The algorithm itself, unchanged from the version that lived
 *     inline in the controller through S1.2–S1.8.
 *
 * WHAT THIS MODULE IS NOT:
 *   - A UI module. It never touches the DOM, never opens or closes
 *     a modal, never reads a form. The caller collects settings and
 *     passes them in.
 *   - A stateful module. It holds nothing across calls. Every input
 *     arrives as an argument on every invocation.
 *   - A domain module. It coordinates TeamCore, AcademyWeeklyTeams,
 *     TeamQueries, and the aggregator; it does not own any of their
 *     storage.
 *   - A load-time dependency capture. All dependencies arrive via
 *     the deps argument. This module can be loaded in any order
 *     relative to the rest of the Academy graph.
 *
 * INVOCATION CONTRACT:
 *   runAutoDistribute(ctx, deps) is the only public entry.
 *
 *   ctx:
 *     {
 *       classId:        string,   required
 *       className:      string,   optional; used only for messaging
 *       week:           number,   required
 *       groupSize:      number,   required; >= 2
 *       namePrefix:     string,   optional; defaults to "Team "
 *       clearExisting:  boolean,  optional; defaults to false
 *     }
 *
 *   deps:
 *     {
 *       AcademyAggregator,
 *       AcademyWeeklyTeams,
 *       TeamCore,
 *       TeamQueries,
 *       TeamConstants,
 *       NotificationSystem
 *     }
 *
 *   Returns a Promise resolving to:
 *     { success: true,  data: { existingTeamsFilled,
 *                                newTeamsCreated,
 *                                studentsPlaced } }
 *     or
 *     { success: false, message: string }
 *
 *   The return value mirrors the shape the controller used to
 *   produce inline. Nothing about the caller's contract changes.
 *
 * ELIGIBILITY:
 *   The distribution pool excludes:
 *     - students deceased at any point (deceased === true)
 *     - students eliminated as of the display week (eliminated ===
 *       true)
 *
 *   Elimination is week-scoped. A student eliminated at exactly the
 *   display week is still eligible. The aggregator produces the
 *   `eliminated` flag with the correct boundary; this module trusts
 *   it.
 *
 * ALGORITHM SHAPE (unchanged since S1.2):
 *   - Existing academic teams active this week are ranked by member
 *     count ascending. Ties broken by name.
 *   - Every unassigned eligible student is placed into the
 *     least-full existing team with room, or into a new team when
 *     every existing team has reached groupSize.
 *   - New teams are named prefix + number, where number starts one
 *     above the highest existing prefix-matching name.
 *   - Placement is performed by AcademyWeeklyTeams.addMember. New
 *     teams are created by TeamCore.createTeam, then given a
 *     weekly-team window by AcademyWeeklyTeams.setWindow (falling
 *     back to ensureWindow when setWindow is absent).
 *
 * IDEMPOTENCY:
 *   The operation is not idempotent. Running it twice will place
 *   students twice (each into the least-full team that moment). The
 *   clearExisting flag exists so a user can wipe the week's
 *   assignments and re-run.
 *
 * FAILURE SEMANTICS:
 *   The algorithm stops on the first failed placement or team
 *   creation. Partial state is committed (the successful placements
 *   before the failure). The caller's refreshView will show whatever
 *   state was reached. This is the same behavior the controller had
 *   inline.
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsOperationsLoaded) {
        return;
    }
    window.__academyWeeklyTeamsOperationsLoaded = true;

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    // ============================================================
    // DEPENDENCY BAG VALIDATION
    // ============================================================

    /**
     * Validate that the deps bag carries everything the algorithm
     * needs. Returns null when valid, or a message string when not.
     *
     * This check is best-effort: it verifies the shapes the module
     * actually calls. A missing optional method (like
     * AcademyWeeklyTeams.setWindow) is not an error; the algorithm
     * falls back to ensureWindow. A missing required method is an
     * error.
     */
    function validateDeps(deps) {
        if (!isObject(deps)) {
            return 'deps must be an object.';
        }

        if (!deps.AcademyAggregator ||
            typeof deps.AcademyAggregator.getClassStudentsViewModel !==
                'function') {
            return 'deps.AcademyAggregator.getClassStudentsViewModel ' +
                'is required.';
        }

        if (!deps.AcademyWeeklyTeams ||
            typeof deps.AcademyWeeklyTeams.addMember !== 'function') {
            return 'deps.AcademyWeeklyTeams.addMember is required.';
        }
        if (typeof deps.AcademyWeeklyTeams.ensureWindow !== 'function') {
            return 'deps.AcademyWeeklyTeams.ensureWindow is required.';
        }

        if (!deps.TeamCore ||
            typeof deps.TeamCore.createTeam !== 'function') {
            return 'deps.TeamCore.createTeam is required.';
        }

        if (!deps.TeamQueries ||
            typeof deps.TeamQueries.getTeamsByClass !== 'function' ||
            typeof deps.TeamQueries.getActiveTeamMembers !== 'function' ||
            typeof deps.TeamQueries.isTeamActiveAtPeriod !== 'function') {
            return 'deps.TeamQueries (getTeamsByClass, ' +
                'getActiveTeamMembers, isTeamActiveAtPeriod) is required.';
        }

        if (!deps.TeamConstants ||
            typeof deps.TeamConstants.normalizeTeamType !== 'function') {
            return 'deps.TeamConstants.normalizeTeamType is required.';
        }

        if (!deps.NotificationSystem ||
            typeof deps.NotificationSystem.notify !== 'function') {
            return 'deps.NotificationSystem.notify is required.';
        }

        return null;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function runAutoDistribute(ctx, deps) {
        if (!isObject(ctx)) {
            return Promise.resolve({
                success: false,
                message: 'Distribution context is required.'
            });
        }

        var depsError = validateDeps(deps);
        if (depsError !== null) {
            return Promise.resolve({
                success: false,
                message: depsError
            });
        }

        var NS = deps.NotificationSystem;
        var AWT = deps.AcademyWeeklyTeams;

        var groupSize = parseInt(ctx.groupSize, 10);
        if (isNaN(groupSize) || groupSize < 2) {
            NS.notify(
                'Group size must be at least 2.',
                'error'
            );
            return Promise.resolve({
                success: false,
                message: 'Invalid group size.'
            });
        }

        if (!isNonEmptyString(ctx.classId)) {
            NS.notify('Select a class first.', 'error');
            return Promise.resolve({
                success: false,
                message: 'classId is required.'
            });
        }

        var week = parseInt(ctx.week, 10);
        if (isNaN(week)) {
            NS.notify('Valid week is required.', 'error');
            return Promise.resolve({
                success: false,
                message: 'week is required.'
            });
        }

        var preChain = Promise.resolve();
        if (ctx.clearExisting === true &&
            typeof AWT.clearClassWindows === 'function') {
            preChain = AWT.clearClassWindows(ctx.classId)
                .then(function() { return null; })
                .catch(function(err) {
                    console.warn(
                        '[AcademyWeeklyTeamsOperations] ' +
                        'clearClassWindows failed during ' +
                        'Auto-Distribute:', err
                    );
                    return null;
                });
        }

        return preChain.then(function() {
            return runAutoDistributeCore(ctx, groupSize, week, deps);
        });
    }

    // ============================================================
    // CORE ALGORITHM
    // ============================================================
    //
    // This is the algorithm lifted verbatim from the controller. The
    // only structural changes are:
    //   - Dependencies arrive via `deps`, not via captured globals.
    //   - `week` is passed as a parsed integer, not re-parsed here.
    //   - The final success/failure handling returns a Promise-shaped
    //     result instead of calling context.onChange (which was the
    //     controller's job).

    function runAutoDistributeCore(ctx, groupSize, week, deps) {
        var NS = deps.NotificationSystem;
        var Aggregator = deps.AcademyAggregator;
        var AWT = deps.AcademyWeeklyTeams;
        var TeamCore = deps.TeamCore;
        var TeamQueries = deps.TeamQueries;
        var TeamConstants = deps.TeamConstants;

        // ---- Roster (filtered) ----
        var rawRoster = Aggregator.getClassStudentsViewModel(
            ctx.classId,
            week
        ) || [];

        var roster = rawRoster.filter(function(s) {
            if (!s) return false;
            if (s.deceased === true) return false;
            if (s.eliminated === true) return false;
            return true;
        });

        if (roster.length === 0) {
            NS.notify(
                'The class has no eligible students for this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No eligible students.'
            });
        }

        var allTeams = TeamQueries.getTeamsByClass(
            ctx.classId, 'operational'
        ) || [];
        var activeThisWeek = [];
        for (var i = 0; i < allTeams.length; i++) {
            var t = allTeams[i];
            if (!t) { continue; }
            if (TeamConstants.normalizeTeamType(t.type) !== 'academic') {
                continue;
            }
            if (!TeamQueries.isTeamActiveAtPeriod(t, week)) {
                continue;
            }
            activeThisWeek.push(t);
        }

        var assignedIds = Object.create(null);
        var teamCounts = Object.create(null);
        for (var a = 0; a < activeThisWeek.length; a++) {
            var team = activeThisWeek[a];
            var activeMembers = TeamQueries.getActiveTeamMembers(
                team, week
            );
            teamCounts[String(team.id)] = activeMembers.length;
            for (var b = 0; b < activeMembers.length; b++) {
                var m = activeMembers[b];
                if (m && m.characterId) {
                    assignedIds[String(m.characterId)] = true;
                }
            }
        }

        var unassigned = [];
        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) { continue; }
            if (assignedIds[String(student.id)]) { continue; }
            unassigned.push(student);
        }
        unassigned.sort(function(a2, b2) {
            return String(a2.name || '').localeCompare(
                String(b2.name || '')
            );
        });

        if (unassigned.length === 0) {
            NS.notify(
                'All eligible students are already assigned to a team ' +
                'this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No unassigned students.'
            });
        }

        var rankedExisting = activeThisWeek.slice().sort(function(a2, b2) {
            var ca = teamCounts[String(a2.id)] || 0;
            var cb = teamCounts[String(b2.id)] || 0;
            if (ca !== cb) { return ca - cb; }
            return String(a2.name || '').localeCompare(
                String(b2.name || '')
            );
        });

        var namePrefix = ctx.namePrefix || 'Team ';
        var highestExistingNumber = findHighestTeamNumber(
            activeThisWeek, namePrefix
        );
        var nextNumber = highestExistingNumber + 1;

        var existingPlans = [];
        for (var e = 0; e < rankedExisting.length; e++) {
            existingPlans.push({
                type: 'existing',
                teamId: String(rankedExisting[e].id),
                teamName: rankedExisting[e].name || 'Unnamed Team',
                charIds: []
            });
        }
        var newPlans = [];

        for (var u = 0; u < unassigned.length; u++) {
            var studentId = String(unassigned[u].id);

            var bestPlan = null;
            var bestCount = Infinity;
            for (var p = 0; p < existingPlans.length; p++) {
                var plan = existingPlans[p];
                var existingCount = teamCounts[plan.teamId] || 0;
                var plannedCount = plan.charIds.length;
                var total = existingCount + plannedCount;
                if (total >= groupSize) { continue; }
                if (total < bestCount) {
                    bestCount = total;
                    bestPlan = plan;
                }
            }

            if (bestPlan) {
                bestPlan.charIds.push(studentId);
                continue;
            }

            var newName = namePrefix + nextNumber;
            nextNumber++;
            var newPlan = {
                type: 'create',
                teamName: newName,
                charIds: [studentId]
            };
            newPlans.push(newPlan);
        }

        var failed = false;
        var failureMessage = null;
        var addedToExisting = 0;
        var createdNewTeams = 0;
        var chain = Promise.resolve();

        existingPlans.forEach(function(plan) {
            if (plan.charIds.length === 0) { return; }
            plan.charIds.forEach(function(charId) {
                chain = chain.then(function() {
                    if (failed) { return; }
                    return AWT.addMember(
                        ctx.classId,
                        plan.teamId,
                        charId,
                        week
                    ).then(function(res) {
                        if (!res || !res.success) {
                            failed = true;
                            failureMessage =
                                'Could not add a student to ' +
                                plan.teamName + ': ' +
                                (res && res.message
                                    ? res.message
                                    : 'unknown error');
                            console.warn(
                                '[AcademyWeeklyTeamsOperations] ' +
                                'addMember rejected:',
                                res && res.message
                            );
                            return;
                        }
                        addedToExisting++;
                    });
                });
            });
        });

        newPlans.forEach(function(plan) {
            chain = chain.then(function() {
                if (failed) { return; }
                return TeamCore.createTeam({
                    name: plan.teamName,
                    type: 'academic',
                    classId: ctx.classId,
                    startPeriod: String(week),
                    endPeriod: '',
                    status: 'active'
                }).then(function(res) {
                    if (!res || !res.success) {
                        failed = true;
                        failureMessage =
                            'Could not create team ' + plan.teamName +
                            ': ' +
                            (res && res.message
                                ? res.message
                                : 'unknown error');
                        console.warn(
                            '[AcademyWeeklyTeamsOperations] ' +
                            'createTeam rejected:',
                            res && res.message
                        );
                        return;
                    }

                    var newTeamId = extractCreatedTeamId(res);
                    if (!newTeamId) {
                        failed = true;
                        failureMessage =
                            'Newly-created team ' + plan.teamName +
                            ' has no id.';
                        return;
                    }

                    createdNewTeams++;

                    var windowPromise;
                    if (typeof AWT.setWindow === 'function') {
                        windowPromise = AWT.setWindow(
                            ctx.classId, newTeamId, week, null
                        );
                    } else {
                        windowPromise = AWT.ensureWindow(
                            ctx.classId, newTeamId, week
                        );
                    }

                    return windowPromise.then(function() {
                        var memberChain = Promise.resolve();
                        plan.charIds.forEach(function(charId) {
                            memberChain = memberChain.then(function() {
                                if (failed) { return; }
                                return AWT.addMember(
                                    ctx.classId,
                                    newTeamId,
                                    charId,
                                    week
                                ).then(function(inner) {
                                    if (!inner || !inner.success) {
                                        failed = true;
                                        failureMessage =
                                            'Could not add a student to ' +
                                            plan.teamName + ': ' +
                                            (inner && inner.message
                                                ? inner.message
                                                : 'unknown error');
                                        console.warn(
                                            '[AcademyWeeklyTeamsOperations] ' +
                                            'addMember rejected:',
                                            inner && inner.message
                                        );
                                    }
                                });
                            });
                        });
                        return memberChain;
                    });
                });
            });
        });

        return chain.then(function() {
            if (failed) {
                NS.notify(
                    failureMessage || 'Auto-Distribute failed.',
                    'error'
                );
                return {
                    success: false,
                    message: failureMessage
                };
            }

            var existingCount = existingPlans.filter(function(en) {
                return en.charIds.length > 0;
            }).length;
            var newCount = newPlans.length;
            var totalStudents = addedToExisting;
            for (var n = 0; n < newPlans.length; n++) {
                totalStudents += newPlans[n].charIds.length;
            }

            var parts = [];
            parts.push('Placed ' + totalStudents +
                ' student' + (totalStudents === 1 ? '' : 's'));
            if (existingCount > 0) {
                parts.push('into ' + existingCount +
                    ' existing team' +
                    (existingCount === 1 ? '' : 's'));
            }
            if (newCount > 0) {
                parts.push('and ' + newCount +
                    ' new team' + (newCount === 1 ? '' : 's'));
            }
            NS.notify(parts.join(' ') + '.', 'success');

            return {
                success: true,
                data: {
                    existingTeamsFilled: existingCount,
                    newTeamsCreated: newCount,
                    studentsPlaced: totalStudents
                }
            };
        });
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function extractCreatedTeamId(result) {
        if (!result || !result.data) { return null; }
        if (result.data.id) { return String(result.data.id); }
        if (result.data.team && result.data.team.id) {
            return String(result.data.team.id);
        }
        return null;
    }

    function findHighestTeamNumber(teams, prefix) {
        var highest = 0;
        if (!Array.isArray(teams) || !isNonEmptyString(prefix)) {
            return highest;
        }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !isNonEmptyString(team.name)) { continue; }
            var name = team.name;
            if (name.indexOf(prefix) !== 0) { continue; }
            var suffix = name.substring(prefix.length).trim();
            if (!/^\d+$/.test(suffix)) { continue; }
            var num = parseInt(suffix, 10);
            if (!isNaN(num) && num > highest) {
                highest = num;
            }
        }

        return highest;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsOperations = Object.freeze({
        runAutoDistribute: runAutoDistribute
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyWeeklyTeamsOperations;
        var missing = [];

        if (typeof exports.runAutoDistribute !== 'function') {
            missing.push('runAutoDistribute');
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyWeeklyTeamsOperations] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
