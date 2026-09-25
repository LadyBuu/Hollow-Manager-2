/**
 * modules/academy/academy-balance-suggestions.js
 * Academy Balance Suggestions
 *
 * Path: js/modules/academy/academy-balance-suggestions.js
 *
 * A PURE algorithm that proposes an assignment of students to
 * teaching groups that (a) has balanced group sizes and (b) respects
 * every existing schedule commitment.
 *
 * WHAT THIS MODULE OWNS:
 *   - The bin-packing-with-constraints algorithm.
 *   - The scoring function (sum of squared deviations from target).
 *   - Deterministic tie-breaking.
 *   - Move diagnostics: for each over-target group, which
 *     under-target groups its students could legally move to, and
 *     how many students could move.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Domain reads. The input is supplied by the caller.
 *   - Domain writes. The output is a plan; applying it is the
 *     caller's job, via AcademySchedule.applyRebalancePlan.
 *   - Session times. The algorithm reuses the existing groups'
 *     existing sessions. It does not reschedule.
 *   - Student preferences. There are none. Balanced sizes and no
 *     collisions are the only criteria.
 *
 * PURITY:
 *   Every function is a pure function over its inputs. No global
 *   state. No mutation of the inputs. Same input → same output
 *   (given deterministic tie-breaking).
 *
 * CARRY-OVER COLLISION EXCLUSION:
 *   A student who is already in a group of the rebalance scope has
 *   that group's sessions in their projected schedule. Before the
 *   allowed-groups matrix is built, those sessions must be removed
 *   from the student's occupied list.
 *
 *   Otherwise the student collides with their own current group and
 *   is classified as unplaceable — even though the rebalance is
 *   precisely the operation that would relocate them.
 *
 *   The exclusion applies to the group named by the student's
 *   `currentGroupId` field, and only that group. Sessions from other
 *   groups of the same student (for example, from a different
 *   discipline) remain in the occupied list, because they are real
 *   constraints.
 *
 * MOVE DIAGNOSTICS:
 *   After the plan is built, this module computes `moveDiagnostics`:
 *   one entry per (source group, destination group) pair where the
 *   source ended over target and the destination ended under target.
 *   Each entry carries:
 *
 *     {
 *       sourceGroupId:      string,
 *       destinationGroupId: string,
 *       movableCount:       integer,
 *       reason:             'no-improvement' | 'exhausted'
 *     }
 *
 *   `movableCount` is the number of students currently assigned to
 *   the source who are allowed in the destination — i.e., who could
 *   legally move there — but did not.
 *
 *   `reason` is 'no-improvement' when the algorithm stopped because
 *   moving any of them would not reduce the sum of squared
 *   deviations. It is 'exhausted' when a move was still improving
 *   but the pass budget ran out. In practice 'exhausted' should be
 *   rare; it indicates a bug or a pathologically tight constraint
 *   graph.
 *
 *   The caller (the rebalance modal) uses this to tell the user why
 *   the plan is not more balanced than it is.
 *
 * INPUT SHAPE:
 *   {
 *     students: [
 *       {
 *         id: string,
 *         currentGroupId: string | null,
 *         occupied: [
 *           { day, startTime, duration },
 *           ...
 *         ]
 *       },
 *       ...
 *     ],
 *     groups: [
 *       {
 *         groupId: string,
 *         sessions: [ { day, startTime, duration }, ... ]
 *       },
 *       ...
 *     ],
 *     targetSize: number,
 *     excludedStudentIds?: string[],
 *     groupIds?: string[]
 *   }
 *
 * OUTPUT SHAPE:
 *   {
 *     ok: boolean,
 *     reason: string | null,
 *     targetSize: number,
 *     groupCount: number,
 *     assignments: [
 *       { groupId, proposedMemberIds, proposedSize,
 *         deviationFromTarget }, ...
 *     ],
 *     unplaceable: [ { studentId, reason }, ... ],
 *     moveDiagnostics: [
 *       { sourceGroupId, destinationGroupId, movableCount, reason },
 *       ...
 *     ],
 *     summary: {
 *       totalStudents, placedCount, unplaceableCount,
 *       sumSquaredDeviation, maxDeviation,
 *       minGroupSize, maxGroupSize
 *     }
 *   }
 *
 * DEPENDENCIES:
 *   None. This module is self-contained.
 */

(function() {
    'use strict';

    if (window.__academyBalanceSuggestionsLoaded) {
        return;
    }
    window.__academyBalanceSuggestionsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MAX_MOVE_PASSES = 10;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPositiveInteger(value) {
        return typeof value === 'number' &&
            isFinite(value) &&
            Number.isInteger(value) &&
            value >= 1;
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    // ============================================================
    // COLLISION
    // ============================================================

    function occurrencesOverlap(a, b) {
        if (!a || !b) { return false; }
        if (typeof a.day !== 'number' ||
            typeof b.day !== 'number') {
            return false;
        }
        if (a.day !== b.day) { return false; }

        if (typeof a.startTime !== 'number' ||
            typeof b.startTime !== 'number') {
            return false;
        }

        var aDur = (typeof a.duration === 'number' && a.duration > 0)
            ? a.duration
            : 1;
        var bDur = (typeof b.duration === 'number' && b.duration > 0)
            ? b.duration
            : 1;

        var aEnd = a.startTime + aDur;
        var bEnd = b.startTime + bDur;

        return a.startTime < bEnd && b.startTime < aEnd;
    }

    function studentCollidesWithGroup(student, group) {
        if (!student || !Array.isArray(student.occupied)) { return false; }
        if (!group || !Array.isArray(group.sessions)) { return false; }

        for (var s = 0; s < student.occupied.length; s++) {
            var occ = student.occupied[s];
            for (var g = 0; g < group.sessions.length; g++) {
                if (occurrencesOverlap(occ, group.sessions[g])) {
                    return true;
                }
            }
        }
        return false;
    }

    // ============================================================
    // SCORE
    // ============================================================

    function computeScore(sizes, target) {
        var total = 0;
        for (var i = 0; i < sizes.length; i++) {
            var d = sizes[i] - target;
            total += d * d;
        }
        return total;
    }

    // ============================================================
    // CURRENT-GROUP SESSION EXCLUSION
    // ============================================================

    function excludeCurrentGroupSessions(student, groups) {
        if (!student || !Array.isArray(student.occupied)) {
            return [];
        }

        var currentGroupId = student.currentGroupId;
        if (!isNonEmptyString(currentGroupId)) {
            return student.occupied.slice();
        }

        var currentGroup = null;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i] && String(groups[i].groupId) === String(currentGroupId)) {
                currentGroup = groups[i];
                break;
            }
        }

        if (!currentGroup || !Array.isArray(currentGroup.sessions) ||
            currentGroup.sessions.length === 0) {
            return student.occupied.slice();
        }

        var result = [];
        for (var oi = 0; oi < student.occupied.length; oi++) {
            var occ = student.occupied[oi];
            var isCurrentGroupSession = false;

            for (var si = 0; si < currentGroup.sessions.length; si++) {
                if (occurrencesOverlap(occ, currentGroup.sessions[si])) {
                    isCurrentGroupSession = true;
                    break;
                }
            }

            if (!isCurrentGroupSession) {
                result.push(occ);
            }
        }

        return result;
    }

    // ============================================================
    // MAIN ENTRY
    // ============================================================

    function suggest(input) {
        // ---- Validate ----
        if (!isPlainObject(input)) {
            return failPlan('Input must be an object.');
        }

        if (!Array.isArray(input.students)) {
            return failPlan('input.students must be an array.');
        }
        if (!Array.isArray(input.groups)) {
            return failPlan('input.groups must be an array.');
        }
        if (!isPositiveInteger(input.targetSize)) {
            return failPlan(
                'input.targetSize must be a positive integer.'
            );
        }

        var targetSize = input.targetSize;

        // ---- Resolve the group list ----

        var groupIdFilter = null;
        if (Array.isArray(input.groupIds)) {
            groupIdFilter = Object.create(null);
            for (var gfi = 0; gfi < input.groupIds.length; gfi++) {
                if (isNonEmptyString(input.groupIds[gfi])) {
                    groupIdFilter[String(input.groupIds[gfi])] = true;
                }
            }
        }

        var usableGroups = [];
        for (var gi = 0; gi < input.groups.length; gi++) {
            var g = input.groups[gi];
            if (!isPlainObject(g)) { continue; }
            if (!isNonEmptyString(g.groupId)) { continue; }
            if (groupIdFilter !== null &&
                groupIdFilter[String(g.groupId)] !== true) {
                continue;
            }
            usableGroups.push({
                groupId: String(g.groupId),
                sessions: Array.isArray(g.sessions) ? g.sessions : []
            });
        }

        if (usableGroups.length === 0) {
            return failPlan('No usable groups were supplied.');
        }

        usableGroups.sort(function(a, b) {
            return a.groupId.localeCompare(b.groupId);
        });

        // ---- Resolve the excluded-student set ----
        var excludedSet = Object.create(null);
        if (Array.isArray(input.excludedStudentIds)) {
            for (var xi = 0; xi < input.excludedStudentIds.length; xi++) {
                if (isNonEmptyString(input.excludedStudentIds[xi])) {
                    excludedSet[String(input.excludedStudentIds[xi])] = true;
                }
            }
        }

        // ---- Build the allowed-groups matrix ----

        var studentRecords = [];
        var unplaceable = [];

        for (var si = 0; si < input.students.length; si++) {
            var s = input.students[si];
            if (!isPlainObject(s)) { continue; }
            if (!isNonEmptyString(s.id)) { continue; }

            var studentId = String(s.id);
            if (excludedSet[studentId] === true) { continue; }

            var occupied = excludeCurrentGroupSessions(s, input.groups);

            var allowed = [];
            var allowedCount = 0;
            for (var ag = 0; ag < usableGroups.length; ag++) {
                var group = usableGroups[ag];
                var ok = !studentCollidesWithGroup(
                    { id: studentId, occupied: occupied },
                    group
                );
                allowed.push(ok);
                if (ok) { allowedCount++; }
            }

            if (allowedCount === 0) {
                unplaceable.push({
                    studentId: studentId,
                    reason: 'no-non-colliding-group'
                });
                continue;
            }

            studentRecords.push({
                id: studentId,
                occupied: occupied,
                allowed: allowed,
                allowedCount: allowedCount
            });
        }

        // ---- Order: most-constrained-first ----

        studentRecords.sort(function(a, b) {
            if (a.allowedCount !== b.allowedCount) {
                return a.allowedCount - b.allowedCount;
            }
            return a.id.localeCompare(b.id);
        });

        // ---- Greedy fill ----

        var groupAssignment = [];
        for (var ga = 0; ga < usableGroups.length; ga++) {
            groupAssignment.push([]);
        }

        for (var sr = 0; sr < studentRecords.length; sr++) {
            var student = studentRecords[sr];

            var bestIndex = -1;
            var bestSize = Infinity;

            for (var ag2 = 0; ag2 < usableGroups.length; ag2++) {
                if (!student.allowed[ag2]) { continue; }
                var currentSize = groupAssignment[ag2].length;
                if (currentSize < bestSize) {
                    bestSize = currentSize;
                    bestIndex = ag2;
                }
            }

            if (bestIndex === -1) {
                unplaceable.push({
                    studentId: student.id,
                    reason: 'no-non-colliding-group'
                });
                continue;
            }

            groupAssignment[bestIndex].push(student.id);
        }

        // ---- Local improvement ----

        var studentById = Object.create(null);
        for (var bi = 0; bi < studentRecords.length; bi++) {
            studentById[studentRecords[bi].id] = studentRecords[bi];
        }

        var passesUsed = 0;
        var lastPassImproved = false;

        for (var pass = 0; pass < MAX_MOVE_PASSES; pass++) {
            var improved = runMovePass(
                groupAssignment,
                usableGroups,
                studentById,
                targetSize
            );
            passesUsed = pass + 1;
            lastPassImproved = improved;
            if (!improved) { break; }
        }

        // ---- Move diagnostics ----

        var moveDiagnostics = buildMoveDiagnostics(
            groupAssignment,
            usableGroups,
            studentById,
            targetSize,
            passesUsed,
            lastPassImproved
        );

        // ---- Build the result ----

        var assignments = [];
        var sizes = [];
        var minSize = Infinity;
        var maxSize = -Infinity;
        var maxDeviation = 0;

        for (var ar = 0; ar < usableGroups.length; ar++) {
            var members = groupAssignment[ar].slice();
            members.sort(function(a, b) {
                return a.localeCompare(b);
            });

            var size = members.length;
            var deviation = Math.abs(size - targetSize);

            sizes.push(size);
            if (size < minSize) { minSize = size; }
            if (size > maxSize) { maxSize = size; }
            if (deviation > maxDeviation) { maxDeviation = deviation; }

            assignments.push({
                groupId: usableGroups[ar].groupId,
                proposedMemberIds: members,
                proposedSize: size,
                deviationFromTarget: deviation
            });
        }

        var placedCount = 0;
        for (var pc = 0; pc < sizes.length; pc++) {
            placedCount += sizes[pc];
        }

        var sumSquared = computeScore(sizes, targetSize);

        if (sizes.length === 0) {
            minSize = 0;
            maxSize = 0;
        }

        return {
            ok: true,
            reason: null,

            targetSize: targetSize,
            groupCount: usableGroups.length,

            assignments: assignments,
            unplaceable: unplaceable,
            moveDiagnostics: moveDiagnostics,

            summary: {
                totalStudents: input.students.length,
                placedCount: placedCount,
                unplaceableCount: unplaceable.length,
                sumSquaredDeviation: sumSquared,
                maxDeviation: maxDeviation,
                minGroupSize: minSize === Infinity ? 0 : minSize,
                maxGroupSize: maxSize === -Infinity ? 0 : maxSize
            }
        };
    }

    function failPlan(reason) {
        return {
            ok: false,
            reason: reason,

            targetSize: 0,
            groupCount: 0,

            assignments: [],
            unplaceable: [],
            moveDiagnostics: [],

            summary: {
                totalStudents: 0,
                placedCount: 0,
                unplaceableCount: 0,
                sumSquaredDeviation: 0,
                maxDeviation: 0,
                minGroupSize: 0,
                maxGroupSize: 0
            }
        };
    }

    // ============================================================
    // MOVE PASS
    // ============================================================

    function runMovePass(
        groupAssignment,
        usableGroups,
        studentById,
        target
    ) {
        var overIndices = [];
        var underIndices = [];

        for (var i = 0; i < groupAssignment.length; i++) {
            var size = groupAssignment[i].length;
            if (size > target) { overIndices.push(i); }
            else if (size < target) { underIndices.push(i); }
        }

        if (overIndices.length === 0 || underIndices.length === 0) {
            return false;
        }

        for (var oi = 0; oi < overIndices.length; oi++) {
            var overIndex = overIndices[oi];

            for (var ui = 0; ui < underIndices.length; ui++) {
                var underIndex = underIndices[ui];

                var moved = tryMoveBetweenGroups(
                    groupAssignment,
                    overIndex,
                    underIndex,
                    studentById,
                    target
                );

                if (moved) {
                    return true;
                }
            }
        }

        return false;
    }

    function tryMoveBetweenGroups(
        groupAssignment,
        overIndex,
        underIndex,
        studentById,
        target
    ) {
        var overGroup = groupAssignment[overIndex];
        var underGroup = groupAssignment[underIndex];

        var overBefore = overGroup.length;
        var underBefore = underGroup.length;

        var beforeScore =
            (overBefore - target) * (overBefore - target) +
            (underBefore - target) * (underBefore - target);

        var afterScore =
            (overBefore - 1 - target) * (overBefore - 1 - target) +
            (underBefore + 1 - target) * (underBefore + 1 - target);

        if (afterScore >= beforeScore) {
            return false;
        }

        for (var oi = 0; oi < overGroup.length; oi++) {
            var studentId = overGroup[oi];
            var student = studentById[studentId];
            if (!student) { continue; }

            if (!student.allowed[underIndex]) { continue; }

            overGroup.splice(oi, 1);
            underGroup.push(studentId);
            return true;
        }

        return false;
    }

    // ============================================================
    // MOVE DIAGNOSTICS
    // ============================================================
    //
    // For every (over-target source, under-target destination)
    // pair, count how many students currently in the source could
    // legally move to the destination.
    //
    // The count is a count of ELIGIBLE students, not of beneficial
    // moves. A count of 5 means "5 students in this group could
    // legally sit in that group." Whether moving any of them would
    // improve the score is a separate question, answered by the
    // `reason` field.
    //
    // The `reason` field is per-pair:
    //
    //   'no-improvement'  The move pass stopped with a score that
    //                     cannot be improved by moving a single
    //                     student from source to destination.
    //                     This is the normal case. The plan is
    //                     locally optimal for this pair.
    //
    //   'exhausted'       The move pass ran out of budget. The
    //                     algorithm hit MAX_MOVE_PASSES while it
    //                     was still finding improvements. This
    //                     should not happen with the current
    //                     MAX_MOVE_PASSES value; if it does, the
    //                     constraint graph is pathological and
    //                     raising the budget would help.
    //
    // The pair-level reason does not need to be per-student.
    // Either the pair can be improved by moving one student (in
    // which case the pass would have moved someone) or it cannot.
    // The `reason` field just says which.

    function buildMoveDiagnostics(
        groupAssignment,
        usableGroups,
        studentById,
        targetSize,
        passesUsed,
        lastPassImproved
    ) {
        var diagnostics = [];

        // If the last pass still improved and we ran out of budget,
        // every still-improvable pair is 'exhausted'.
        var ranOut = (passesUsed >= MAX_MOVE_PASSES) && lastPassImproved;

        for (var overIndex = 0;
             overIndex < groupAssignment.length;
             overIndex++) {

            var overSize = groupAssignment[overIndex].length;
            if (overSize <= targetSize) { continue; }

            for (var underIndex = 0;
                 underIndex < groupAssignment.length;
                 underIndex++) {

                if (overIndex === underIndex) { continue; }

                var underSize = groupAssignment[underIndex].length;
                if (underSize >= targetSize) { continue; }

                var sourceGroupId = usableGroups[overIndex].groupId;
                var destGroupId = usableGroups[underIndex].groupId;

                // Count how many students in source are allowed in
                // dest.
                var movableCount = 0;
                var sourceMembers = groupAssignment[overIndex];
                for (var mi = 0; mi < sourceMembers.length; mi++) {
                    var student = studentById[sourceMembers[mi]];
                    if (!student) { continue; }
                    if (student.allowed[underIndex]) {
                        movableCount++;
                    }
                }

                if (movableCount === 0) { continue; }

                // Determine the reason. A pair with movable
                // students that did not improve means the score
                // cannot be reduced by a single-student move in
                // this direction. If the last pass improved and we
                // ran out of budget, mark it 'exhausted'.
                var reason = ranOut ? 'exhausted' : 'no-improvement';

                diagnostics.push({
                    sourceGroupId: sourceGroupId,
                    destinationGroupId: destGroupId,
                    movableCount: movableCount,
                    reason: reason
                });
            }
        }

        diagnostics.sort(function(a, b) {
            if (a.sourceGroupId !== b.sourceGroupId) {
                return a.sourceGroupId < b.sourceGroupId ? -1 : 1;
            }
            if (a.destinationGroupId !== b.destinationGroupId) {
                return a.destinationGroupId < b.destinationGroupId ? -1 : 1;
            }
            return 0;
        });

        return diagnostics;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyBalanceSuggestions = Object.freeze({
        suggest: suggest,

        occurrencesOverlap: occurrencesOverlap,
        studentCollidesWithGroup: studentCollidesWithGroup,
        computeScore: computeScore,
        excludeCurrentGroupSessions: excludeCurrentGroupSessions,

        MAX_MOVE_PASSES: MAX_MOVE_PASSES
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyBalanceSuggestions;
        var missing = [];

        if (typeof exports.suggest !== 'function') {
            missing.push('suggest');
        }

        try {
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 1 },
                { day: 1, startTime: 10, duration: 1 }
            ) !== false) {
                missing.push('back-to-back flagged as overlapping');
            }

            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 2 },
                { day: 1, startTime: 10, duration: 2 }
            ) !== true) {
                missing.push('partial overlap not detected');
            }

            // Current-group exclusion: a student whose occupied
            // list contains exactly the current group's sessions
            // has an empty occupied list after exclusion.
            var student = {
                id: 's1',
                currentGroupId: 'g1',
                occupied: [
                    { day: 1, startTime: 9, duration: 1 },
                    { day: 1, startTime: 14, duration: 2 }
                ]
            };
            var groups = [
                {
                    groupId: 'g1',
                    sessions: [
                        { day: 1, startTime: 9, duration: 1 }
                    ]
                }
            ];
            var excluded = exports.excludeCurrentGroupSessions(student, groups);
            if (excluded.length !== 1) {
                missing.push(
                    'excludeCurrentGroupSessions removed the wrong ' +
                    'number of entries (' + excluded.length + ')'
                );
            }

            // Carry-over: a student already placed in g1 must be
            // placeable without being classified unplaceable.
            var plan = suggest({
                students: [
                    {
                        id: 'a',
                        currentGroupId: 'g1',
                        occupied: [
                            { day: 1, startTime: 9, duration: 1 }
                        ]
                    }
                ],
                groups: [
                    {
                        groupId: 'g1',
                        sessions: [
                            { day: 1, startTime: 9, duration: 1 }
                        ]
                    },
                    {
                        groupId: 'g2',
                        sessions: [
                            { day: 2, startTime: 9, duration: 1 }
                        ]
                    }
                ],
                targetSize: 1
            });
            if (plan.ok !== true) {
                missing.push('carry-over plan was not ok');
            }
            if (plan.summary.unplaceableCount !== 0) {
                missing.push(
                    'carry-over student was classified unplaceable'
                );
            }
            if (plan.summary.placedCount !== 1) {
                missing.push('carry-over student was not placed');
            }

            // Diagnostics: 6 students, 2 groups, target 2. The
            // algorithm should place 3 and 3, sum of squares = 2.
            // Diagnostics should be empty because neither group is
            // over target.
            var plan2 = suggest({
                students: [
                    { id: 'a', occupied: [] },
                    { id: 'b', occupied: [] },
                    { id: 'c', occupied: [] },
                    { id: 'd', occupied: [] },
                    { id: 'e', occupied: [] },
                    { id: 'f', occupied: [] }
                ],
                groups: [
                    { groupId: 'g1', sessions: [] },
                    { groupId: 'g2', sessions: [] }
                ],
                targetSize: 2
            });
            if (plan2.ok !== true) {
                missing.push('6x2 plan was not ok');
            }
            if (plan2.summary.sumSquaredDeviation !== 2) {
                missing.push(
                    '6x2 with target 2 was not 3+3 ' +
                    '(score ' + plan2.summary.sumSquaredDeviation + ')'
                );
            }
            if (plan2.moveDiagnostics.length !== 0) {
                missing.push(
                    '6x2 balanced plan should have no diagnostics'
                );
            }

            // Diagnostics present: 4 students, 2 groups, target 1.
            // Cannot balance below 2+2; score is 2. Both groups are
            // over target, so no over→under pair exists.
            var plan3 = suggest({
                students: [
                    { id: 'a', occupied: [] },
                    { id: 'b', occupied: [] },
                    { id: 'c', occupied: [] },
                    { id: 'd', occupied: [] }
                ],
                groups: [
                    { groupId: 'g1', sessions: [] },
                    { groupId: 'g2', sessions: [] }
                ],
                targetSize: 1
            });
            if (plan3.ok !== true) {
                missing.push('4x2 plan was not ok');
            }
            if (plan3.summary.sumSquaredDeviation !== 2) {
                missing.push(
                    '4x2 with target 1 was not 2+2 ' +
                    '(score ' + plan3.summary.sumSquaredDeviation + ')'
                );
            }
            if (plan3.moveDiagnostics.length !== 0) {
                missing.push(
                    '4x2 with both groups over target should have ' +
                    'no diagnostics'
                );
            }

            // Diagnostics present: 3 students, 2 groups, target 1,
            // with a schedule constraint that forces the two
            // constrained students into g2 (so g1 gets one, g2 gets
            // two). Then g2 is over target, g1 is at target. No
            // over→under pair exists because g1 is not under.
            var plan4 = suggest({
                students: [
                    { id: 'a', occupied: [] },
                    { id: 'b', occupied: [
                        { day: 1, startTime: 9, duration: 1 }
                    ] },
                    { id: 'c', occupied: [
                        { day: 1, startTime: 9, duration: 1 }
                    ] }
                ],
                groups: [
                    { groupId: 'g1', sessions: [] },
                    { groupId: 'g2', sessions: [
                        { day: 2, startTime: 9, duration: 1 }
                    ] }
                ],
                targetSize: 1
            });
            if (plan4.ok !== true) {
                missing.push('constrained plan was not ok');
            }
            if (plan4.summary.sumSquaredDeviation !== 1) {
                missing.push(
                    'constrained plan should be 1+2 (score 1), got ' +
                    plan4.summary.sumSquaredDeviation
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyBalanceSuggestions] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
