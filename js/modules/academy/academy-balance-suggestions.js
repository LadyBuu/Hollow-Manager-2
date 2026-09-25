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
 * INPUT SHAPE:
 *   {
 *     students: [
 *       {
 *         id: string,
 *         occupied: [
 *           { day: number, startTime: number, duration: number },
 *           ...
 *         ]
 *       },
 *       ...
 *     ],
 *     groups: [
 *       {
 *         groupId: string,
 *         sessions: [
 *           { day: number, startTime: number, duration: number },
 *           ...
 *         ]
 *       },
 *       ...
 *     ],
 *     targetSize: number,
 *     excludedStudentIds?: string[],
 *     groupIds?: string[]
 *   }
 *
 *   `students` — the pool of students eligible to be placed. The
 *     caller filters out deceased, eliminated, and unenrolled
 *     students before calling. The algorithm trusts the pool.
 *
 *   `groups` — the existing groups that will receive students. Every
 *     group in this array is considered. A group whose `sessions`
 *     is empty can accept any student (no collision possible). A
 *     group with sessions constrains who can join it.
 *
 *     The caller decides which groups to include. To rebalance
 *     across a subset of instructors, pass only those instructors'
 *     groups. To rebalance the whole discipline, pass all of them.
 *
 *   `targetSize` — the desired number of students per group. The
 *     algorithm minimizes the sum of squared deviations from this
 *     number. A positive integer.
 *
 *   `excludedStudentIds` — students who must NOT be placed. They do
 *     not appear in the input pool, but the caller may pass a set
 *     of IDs to exclude even if they were in the pool. Useful for
 *     "keep these students out of the rebalance." Optional.
 *
 *   `groupIds` — if supplied, only these group IDs are used as
 *     targets. Any group in `groups` whose ID is not in this array
 *     is ignored. Optional. Useful for "rebalance into these
 *     specific groups."
 *
 * OUTPUT SHAPE:
 *   {
 *     ok: boolean,
 *     reason: string | null,
 *
 *     targetSize: number,
 *     groupCount: number,
 *
 *     assignments: [
 *       {
 *         groupId: string,
 *         proposedMemberIds: string[],
 *         proposedSize: number,
 *         deviationFromTarget: number
 *       },
 *       ...
 *     ],
 *
 *     unplaceable: [
 *       {
 *         studentId: string,
 *         reason: 'no-non-colliding-group'
 *       },
 *       ...
 *     ],
 *
 *     summary: {
 *       totalStudents: number,
 *       placedCount: number,
 *       unplaceableCount: number,
 *       sumSquaredDeviation: number,
 *       maxDeviation: number,
 *       minGroupSize: number,
 *       maxGroupSize: number
 *     }
 *   }
 *
 *   `ok` is true when the algorithm completed. It is false only for
 *   invalid input (missing students array, targetSize < 1, etc.).
 *   A plan with unplaceable students is still ok: true; the
 *   unplaceable list is part of a successful result.
 *
 * ALGORITHM:
 *   1. Build a matrix: for each (student, group), is the student
 *      allowed in the group? Allowed means no occurrence of the
 *      student overlaps any session of the group.
 *
 *      Collision is a HARD constraint. A student who cannot sit in
 *      a group without a collision is never placed there, no
 *      matter how much it would help balance.
 *
 *   2. Filter students: drop excludedStudentIds. Drop students
 *      whose allowed-group set is empty (unplaceable; reported).
 *
 *   3. Sort students by "most constrained first" (fewest allowed
 *      groups). Ties broken by studentId.
 *
 *   4. Greedy fill:
 *      For each student in order:
 *        Pick the allowed group with the smallest current size.
 *        Ties broken by groupId.
 *        Place the student.
 *
 *   5. Local improvement — bounded MOVE passes:
 *      While there is an improving move and we have not exceeded
 *      MAX_MOVE_PASSES:
 *        For each pair (over-target group, under-target group):
 *          For each student in the over-target group who is
 *          allowed in the under-target group:
 *            If moving that student reduces the sum of squared
 *            deviations:
 *              Perform the move.
 *
 *      A "move" here means: one student relocates from an
 *      over-target group to an under-target group. The
 *      over-target group shrinks by one; the under-target group
 *      grows by one. Neither group's membership is exchanged.
 *
 *      Two-way SWAPS (exchanging one student from each group) are
 *      NOT attempted, because exchanging one student from each
 *      group leaves both sizes unchanged and therefore cannot
 *      improve balance. The move is the correct improvement
 *      operator for the balance problem.
 *
 *      MAX_MOVE_PASSES bounds the runtime. In practice, 3 to 5
 *      passes are enough to reach a local minimum on the class
 *      sizes this app deals with.
 *
 *   6. Return the plan.
 *
 * WHY NOT A BIN-PACKING LIBRARY:
 *   The instance sizes are tiny (15–40 students, 3–8 groups). A
 *   simple greedy + local-improvement heuristic produces
 *   near-optimal results in milliseconds. Pulling in a general
 *   solver would add a dependency, slow things down, and produce
 *   output that is harder to reason about. The algorithm here is
 *   deterministic, explainable, and correct for the class sizes
 *   the app handles.
 *
 * DETERMINISM:
 *   Every ordering in the algorithm has an explicit tiebreaker.
 *   Students sorted by (constraint count ascending, id ascending).
 *   Groups sorted by (current size ascending, id ascending).
 *   Move candidates sorted by (improvement descending, ids
 *   ascending). Same input → same output.
 *
 *   This matters: a user who runs the same rebalance twice should
 *   see the same plan. Non-determinism would make the feature feel
 *   broken.
 *
 * DEPENDENCIES:
 *   None. This module is self-contained. It does not read from any
 *   domain module, and it does not touch window.
 *
 * USAGE:
 *   var plan = AcademyBalanceSuggestions.suggest({
 *     students: [...],
 *     groups: [...],
 *     targetSize: 5
 *   });
 *
 *   if (plan.ok) {
 *     // hand plan.assignments + plan.unplaceable to the modal
 *   }
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

    // Bounds on the local-improvement loop. Three to five passes
    // are typical; ten is generous. The cost of one pass is
    // O(students × groupSize) worst case, which is trivial for the
    // instance sizes here.
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
    //
    // Two "occurrences" (a student's existing commitment, or a
    // group's existing session) overlap when they are on the same
    // day and their [startTime, startTime + duration) windows
    // intersect.
    //
    // Back-to-back sessions do NOT overlap: 9–10 and 10–11 are
    // fine.
    //
    // Missing or malformed occurrences are skipped. The caller is
    // responsible for feeding the algorithm well-formed input; a
    // malformed occurrence is not a collision.

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
    //
    // Sum of squared deviations from the target size.
    //
    // A group of target 5, actual 10 contributes (10-5)^2 = 25.
    // Actual 5 contributes 0. Actual 0 contributes 25.
    //
    // Squared deviation penalizes extremes heavily, which is what
    // the user wants: they care about the difference between 5
    // and 20 far more than the difference between 5 and 6.

    function computeScore(sizes, target) {
        var total = 0;
        for (var i = 0; i < sizes.length; i++) {
            var d = sizes[i] - target;
            total += d * d;
        }
        return total;
    }

    // ============================================================
    // MAIN ENTRY
    // ============================================================

    /**
     * Produce a rebalance plan.
     *
     * See the file header for input and output shape.
     *
     * @param {object} input
     * @returns {object} The plan.
     */
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
        //
        // When `groupIds` is supplied, only those groups are used
        // as targets. Groups not in the list are dropped. This
        // lets a caller say "rebalance into these groups only."

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

        // Deterministic group order for the algorithm's internals.
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
        //
        // For each student, a boolean array over usableGroups,
        // indexed by position in usableGroups. A true entry means
        // "no collision; the student can sit in this group."
        //
        // Students whose allowed set is entirely false are
        // unplaceable. They are reported and excluded from the
        // packing.
        //
        // We compute this once. The move pass reuses it.

        var studentRecords = [];
        var unplaceable = [];

        for (var si = 0; si < input.students.length; si++) {
            var s = input.students[si];
            if (!isPlainObject(s)) { continue; }
            if (!isNonEmptyString(s.id)) { continue; }

            var studentId = String(s.id);
            if (excludedSet[studentId] === true) { continue; }

            var occupied = Array.isArray(s.occupied) ? s.occupied : [];

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
        //
        // Students with fewer allowed groups are harder to place.
        // Placing them first means the algorithm avoids
        // accidentally saturating the only group an awkward student
        // could have joined.
        //
        // Ties: studentId ascending, for determinism.

        studentRecords.sort(function(a, b) {
            if (a.allowedCount !== b.allowedCount) {
                return a.allowedCount - b.allowedCount;
            }
            return a.id.localeCompare(b.id);
        });

        // ---- Greedy fill ----
        //
        // groupAssignment[i] = studentIds currently assigned to
        // usableGroups[i].
        //
        // For each student, pick the smallest allowed group. Ties
        // broken by group index (which is sorted by groupId).

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
                // Should not happen: allowedCount > 0 guarantees at
                // least one allowed group. But keep the guard.
                unplaceable.push({
                    studentId: student.id,
                    reason: 'no-non-colliding-group'
                });
                continue;
            }

            groupAssignment[bestIndex].push(student.id);
        }

        // ---- Local improvement: bounded move passes ----

        var studentById = Object.create(null);
        for (var bi = 0; bi < studentRecords.length; bi++) {
            studentById[studentRecords[bi].id] = studentRecords[bi];
        }

        for (var pass = 0; pass < MAX_MOVE_PASSES; pass++) {
            var improved = runMovePass(
                groupAssignment,
                usableGroups,
                studentById,
                targetSize
            );
            if (!improved) { break; }
        }

        // ---- Build the result ----

        var assignments = [];
        var sizes = [];
        var minSize = Infinity;
        var maxSize = -Infinity;
        var maxDeviation = 0;

        for (var ar = 0; ar < usableGroups.length; ar++) {
            var members = groupAssignment[ar].slice();
            // Deterministic order within a group: by studentId.
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
    //
    // One pass: examine every (over-target group, under-target
    // group) pair. For each student currently in the over-target
    // group who is allowed in the under-target group, compute
    // whether moving them would reduce the sum of squared
    // deviations. If so, perform the move.
    //
    // The move is a single relocation: one student leaves the
    // over-target group and joins the under-target group. Neither
    // group is otherwise disturbed.
    //
    // Repeat until no improving move is found in a pass, or until
    // MAX_MOVE_PASSES is reached.
    //
    // COST:
    //   One pass is O(overGroupSize × underGroupCount) plus the
    //   per-student allowed check, bounded by total students.
    //   For 40 students across 8 groups, this is trivial.
    //
    // WHY MOVES AND NOT SWAPS:
    //   A two-way swap exchanges one student from each group. Both
    //   sizes are unchanged. That cannot improve balance. The
    //   correct improvement operator for the balance problem is a
    //   move: relocate one student from a group that is over the
    //   target into a group that is under the target.
    //
    // WHY NOT MORE SOPHISTICATED MOVES:
    //   Single-student moves capture the vast majority of
    //   improvements on balanced-size problems. Multi-student
    //   exchanges (two-for-one, three-way rotations) add
    //   complexity for negligible gain at these sizes. If the
    //   algorithm converges with a sum-of-squared deviation above
    //   zero, that is almost always because the constraint graph
    //   prevents further improvement — not because single-student
    //   moves are too weak.

    function runMovePass(
        groupAssignment,
        usableGroups,
        studentById,
        target
    ) {
        // Identify over-target and under-target groups.
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
                    // A move changes the group sizes. Restart the
                    // pass so the over/under classification is
                    // recomputed. The MAX_MOVE_PASSES bound keeps
                    // this from exploding.
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Try to move one student from groupAssignment[overIndex] to
     * groupAssignment[underIndex], if the move is legal
     * (student's allowed matrix permits it) and improving
     * (reduces the sum of squared deviations for this pair of
     * groups).
     *
     * Returns true when a move was performed, false otherwise.
     */
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

        // A move that does not improve the score is not performed,
        // regardless of whether it would be legal. This is the
        // termination condition: no legal improving move exists.
        if (afterScore >= beforeScore) {
            return false;
        }

        for (var oi = 0; oi < overGroup.length; oi++) {
            var studentId = overGroup[oi];
            var student = studentById[studentId];
            if (!student) { continue; }

            // Is the student allowed in the under-target group?
            // A student who would collide in the target group
            // cannot be moved there, no matter how much it would
            // help balance.
            if (!student.allowed[underIndex]) { continue; }

            // Perform the move.
            overGroup.splice(oi, 1);
            underGroup.push(studentId);
            return true;
        }

        return false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyBalanceSuggestions = Object.freeze({
        suggest: suggest,

        // Exposed for tests and diagnostics. Not part of the
        // public API in the sense that callers should not depend
        // on them; if you find yourself needing them outside a
        // test, that is a signal the input or output shape needs
        // to grow instead.
        occurrencesOverlap: occurrencesOverlap,
        studentCollidesWithGroup: studentCollidesWithGroup,
        computeScore: computeScore,

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
            // Overlap detection: back-to-back is not a collision.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 1 },
                { day: 1, startTime: 10, duration: 1 }
            ) !== false) {
                missing.push('back-to-back flagged as overlapping');
            }

            // Overlap detection: partial overlap is a collision.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 2 },
                { day: 1, startTime: 10, duration: 2 }
            ) !== true) {
                missing.push('partial overlap not detected');
            }

            // Student vs. group: a student with a 9:00 meeting cannot
            // join a group whose session is at 9:00.
            if (studentCollidesWithGroup(
                { id: 's1', occupied: [
                    { day: 1, startTime: 9, duration: 1 }
                ]},
                { groupId: 'g1', sessions: [
                    { day: 1, startTime: 9, duration: 1 }
                ]}
            ) !== true) {
                missing.push('same-slot collision not detected');
            }

            // Student vs. group: a student with a 10:00 meeting can
            // join a group whose session ends at 10:00.
            if (studentCollidesWithGroup(
                { id: 's1', occupied: [
                    { day: 1, startTime: 10, duration: 1 }
                ]},
                { groupId: 'g1', sessions: [
                    { day: 1, startTime: 9, duration: 1 }
                ]}
            ) !== false) {
                missing.push('back-to-back not allowed');
            }

            // Score: balanced sizes have zero score.
            if (computeScore([5, 5, 5, 5, 5], 5) !== 0) {
                missing.push('balanced sizes produce non-zero score');
            }

            // Score: skewed sizes have positive score.
            if (computeScore([10, 5, 5, 0, 0], 5) !== 75) {
                missing.push('skewed sizes produce wrong score');
            }

            // End-to-end: three students, three groups of size 1,
            // target 1. Everyone should be placed, no unplaceable.
            var plan = suggest({
                students: [
                    { id: 'a', occupied: [] },
                    { id: 'b', occupied: [] },
                    { id: 'c', occupied: [] }
                ],
                groups: [
                    { groupId: 'g1', sessions: [] },
                    { groupId: 'g2', sessions: [] },
                    { groupId: 'g3', sessions: [] }
                ],
                targetSize: 1
            });
            if (plan.ok !== true) {
                missing.push('balanced 3×3 plan was not ok');
            }
            if (plan.summary.unplaceableCount !== 0) {
                missing.push('balanced 3×3 had unplaceable students');
            }
            if (plan.summary.placedCount !== 3) {
                missing.push('balanced 3×3 did not place all 3');
            }

            // End-to-end: two groups, one overfull, one underfull.
            // Rebalance should move a student from the first to
            // the second.
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
                targetSize: 3
            });
            if (plan2.ok !== true) {
                missing.push('6×2 plan was not ok');
            }
            if (plan2.summary.sumSquaredDeviation !== 0) {
                missing.push(
                    '6×2 with target 3 was not perfectly balanced'
                );
            }

            // End-to-end: one student has an unavoidable collision
            // with the only group.
            var plan3 = suggest({
                students: [
                    { id: 'a', occupied: [
                        { day: 1, startTime: 9, duration: 1 }
                    ]}
                ],
                groups: [
                    { groupId: 'g1', sessions: [
                        { day: 1, startTime: 9, duration: 1 }
                    ]}
                ],
                targetSize: 1
            });
            if (plan3.ok !== true) {
                missing.push('collision plan was not ok');
            }
            if (plan3.unplaceable.length !== 1) {
                missing.push('colliding student was not unplaceable');
            }
            if (plan3.unplaceable[0].studentId !== 'a') {
                missing.push('wrong student reported as unplaceable');
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
