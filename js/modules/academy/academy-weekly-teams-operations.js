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
 *   - The algorithm: fill existing teams, create new teams,
 *     overflow the remainder.
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
 *                                studentsPlaced,
 *                                overflowed } }
 *     or
 *     { success: false, message: string }
 *
 *   The return value mirrors the shape the controller used to
 *   produce inline. `overflowed` is a new key; the others are
 *   unchanged.
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
 * ALGORITHM SHAPE (three phases):
 *
 *   Phase 1 — fill existing teams.
 *     Every unassigned eligible student is placed into the
 *     least-full existing team with room below groupSize.
 *
 *   Phase 2 — create new teams while the remainder supports a
 *     full one.
 *     While at least groupSize students remain unplaced, create a
 *     new team, name it prefix + number, and fill it to groupSize.
 *     A partial team is never created in this phase.
 *
 *   Phase 3 — overflow the remainder.
 *     After Phases 1 and 2, fewer than groupSize students remain.
 *     Distribute them one per team, cycling through the teams in
 *     ascending current-size order. When every team has received
 *     one overflow, loop back to the smallest.
 *
 *     Reading (a), sub-shape (a1): there is NO per-team overflow
 *     cap. A team may grow to groupSize + 2, + 3, ... when there
 *     are not enough teams to spread across. The "no partial team"
 *     constraint wins over the "one overflow per team" preference.
 *
 *     Phase 3 exists because the pinboard rule is:
 *       "A new team is only created when R >= N."
 *       "A partial team is never created."
 *     Those two constraints together force the overflow to land
 *     on existing teams, however many students remain.
 *
 *   The three phases are sequential and independent. Phase 3 runs
 *   only if Phase 1 and Phase 2 are exhausted.
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

        // ---- Phase 1 — fill existing teams to groupSize. ----
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

            // Phase 1 could not place this student. Everything from
            // here is Phase 2 and Phase 3 territory, which are
            // handled below with the full unassigned remainder.
            break;
        }

        // ---- Phase 2 — create new teams while the remainder
        //      supports a full one. ----
        //
        // We compute the remainder as "students not placed by
        // Phase 1." A student is "placed by Phase 1" when they
        // appear in some existingPlans[].charIds.
        var placedByPhase1 = countPlannedCharIds(existingPlans);
        var remainder = unassigned.slice(placedByPhase1);

        while (remainder.length >= groupSize) {
            var newName = namePrefix + nextNumber;
            nextNumber++;
            var newPlan = {
                type: 'create',
                teamName: newName,
                charIds: []
            };
            // Fill to groupSize from the front of the remainder.
            for (var f = 0; f < groupSize; f++) {
                newPlan.charIds.push(String(remainder[f].id));
            }
            remainder = remainder.slice(groupSize);
            newPlans.push(newPlan);
        }

        // ---- Phase 3 — overflow the remainder. ----
        //
        // Reading (a), sub-shape (a1):
        //   - No partial team.
        //   - No per-team overflow cap.
        //   - Cycle through the teams in ascending current-size
        //     order. When every team has received one overflow,
        //     loop back to the smallest.
        //
        // At this point all teams (existing + newly planned) are
        // exactly groupSize by construction. The "ascending order"
        // is therefore the stable order the plans were built in:
        // existing plans first (ranked by pre-fill count), then
        // new plans in creation order.
        //
        // We attach the overflow directly to the plans, so the
        // commit loop below sees a single coherent plan list.
        var overflowAssignments = [];
        if (remainder.length > 0) {
            var allPlans = existingPlans.concat(newPlans);
            if (allPlans.length === 0) {
                // Degenerate: no existing teams and remainder <
                // groupSize. Nothing to cycle onto. The pinboard
                // rule says "a new team is only created when
                // R >= N" and "a partial team is never created."
                // Both forbid creating a team here.
                //
                // This is a real corner: it can happen only when
                // there are zero existing active teams AND fewer
                // than groupSize unassigned students. The correct
                // resolution is out of scope for this file; we
                // surface it rather than silently swallowing the
                // students.
                var tail = remainder.length;
                NS.notify(
                    'Cannot place ' + tail + ' student' +
                    (tail === 1 ? '' : 's') +
                    ': no existing teams to overflow and fewer ' +
                    'than ' + groupSize + ' to form a new one.',
                    'warning'
                );
                remainder = [];
            } else {
                var cursor = 0;
                while (remainder.length > 0) {
                    var targetPlan = allPlans[cursor];
                    var nextStudent = remainder.shift();
                    var nextCharId = String(nextStudent.id);
                    targetPlan.charIds.push(nextCharId);
                    overflowAssignments.push({
                        teamId: targetPlan.teamId || null,
                        teamName: targetPlan.teamName,
                        characterId: nextCharId
                    });
                    cursor = (cursor + 1) % allPlans.length;
                }
            }
        }

        // ---- Commit ----
        var failed = false;
        var failureMessage = null;
        var addedToExisting = 0;
        var createdNewTeams = 0;
        var overflowed = overflowAssignments.length;
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

                    // Backfill the plan's teamId so the overflow
                    // assignments above can find it.
                    plan.teamId = newTeamId;

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
            if (overflowed > 0) {
                parts.push('(' + overflowed + ' overflow' +
                    (overflowed === 1 ? '' : 's') + ')');
            }
            NS.notify(parts.join(' ') + '.', 'success');

            return {
                success: true,
                data: {
                    existingTeamsFilled: existingCount,
                    newTeamsCreated: newCount,
                    studentsPlaced: totalStudents,
                    overflowed: overflowed
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

    /**
     * Count how many character IDs appear in the charIds arrays of
     * a list of plans. Used to slice the unassigned pool after
     * Phase 1, without having to track a parallel index.
     */
    function countPlannedCharIds(plans) {
        var n = 0;
        if (!Array.isArray(plans)) { return 0; }
        for (var i = 0; i < plans.length; i++) {
            var plan = plans[i];
            if (plan && Array.isArray(plan.charIds)) {
                n += plan.charIds.length;
            }
        }
        return n;
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
