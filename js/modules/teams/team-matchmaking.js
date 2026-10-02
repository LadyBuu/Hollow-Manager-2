/**
 * modules/teams/team-matchmaking.js - Team Matchmaking
 * Pure auto-matcher for professional-team matchmaking.
 *
 * Path: js/modules/teams/team-matchmaking.js
 *
 * WHAT THIS IS:
 *   One public function: buildProposal(inputs). A pure,
 *   deterministic, greedy matcher.
 *
 * WHAT THIS IS NOT:
 *   - A query module. Inputs arrive from the caller.
 *   - A mutation module. Returns a proposal, commits nothing.
 *   - A render module. No DOM.
 *   - A rule engine. Does not validate team type, team window,
 *     character existence, deceased state, or eligibility. The
 *     caller supplies a pool already filtered to eligible
 *     candidates and a list of targets already filtered to
 *     eligible teams. TeamAggregator owns that filtering.
 *
 * WHY PURE:
 *   Determinism is a property of the algorithm, not of the
 *   surrounding system. Same inputs produce the same output.
 *
 * ALGORITHM:
 *   1. Sort targets by currentMemberCount ascending; ties by
 *      name ascending.
 *   2. Sort candidates by name ascending.
 *   3. Walk candidates. For each, walk targets. Place in the
 *      FIRST target that still has a free slot:
 *
 *          target.currentMemberCount
 *        + target.plannedAdditions
 *        < targetSize
 *
 *      If no target has a slot, stop.
 *   4. Emit the proposal.
 *
 *   Deterministic. Greedy. No randomness. No role bias. No
 *   history bias.
 *
 *   The algorithm does not consult candidate availability. A
 *   candidate with a future assignment is still placed if a
 *   target slot is free. This is intentional: availability is a
 *   UI concern, and the commit path (TeamCore.batchAddMembers)
 *   re-validates every assignment against the snapshot, so an
 *   invalid placement is rejected at commit time rather than
 *   silently filtered here.
 *
 * INPUT SHAPE:
 *   {
 *     year:        number,   // echoed back; not read
 *     targetSize:  number,   // >= 1
 *     candidates:  [ { id, name } ],
 *     targets:     [ {
 *                      teamId,
 *                      teamName,
 *                      currentMemberCount
 *                  } ]
 *   }
 *
 *   Additional candidate fields (availability, assignment,
 *   ageDisplay) are ignored. Additional target fields
 *   (remainingCapacity, classDisplay, periodDisplay) are ignored.
 *
 * OUTPUT SHAPE:
 *   {
 *     year,
 *     targetSize,
 *     assignments: [ {
 *       teamId,
 *       teamName,
 *       additions: [ { id, name } ]
 *     } ]
 *   }
 *
 *   Teams that receive no additions are omitted from
 *   `assignments`.
 *
 * DEPENDENCIES:
 *   None.
 */

(function() {
    'use strict';

    if (window.__teamMatchmakingLoaded) {
        return;
    }
    window.__teamMatchmakingLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1) {
                return null;
            }
            return n;
        }
        return null;
    }

    // ============================================================
    // PUBLIC ENTRY
    // ============================================================

    /**
     * Build a matchmaking proposal.
     *
     * @param {object} inputs - { year, targetSize, candidates,
     *                            targets }
     * @returns {object} { year, targetSize, assignments }
     */
    function buildProposal(inputs) {
        if (!isObject(inputs)) {
            return {
                year: null,
                targetSize: null,
                assignments: []
            };
        }

        var year = parsePositiveInteger(inputs.year);
        var targetSize = parsePositiveInteger(inputs.targetSize);
        var candidates = Array.isArray(inputs.candidates)
            ? inputs.candidates
            : [];
        var targets = Array.isArray(inputs.targets)
            ? inputs.targets
            : [];

        if (targetSize === null) {
            return {
                year: year,
                targetSize: null,
                assignments: []
            };
        }

        // ---- Normalise candidates ----
        var cleanCandidates = [];
        for (var c = 0; c < candidates.length; c++) {
            var candidate = candidates[c];
            if (!isObject(candidate)) { continue; }
            if (!isNonEmptyString(candidate.id)) { continue; }

            cleanCandidates.push({
                id: String(candidate.id),
                name: isNonEmptyString(candidate.name)
                    ? candidate.name
                    : 'Unknown'
            });
        }

        // ---- Normalise targets ----
        var cleanTargets = [];
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            if (!isObject(target)) { continue; }
            if (!isNonEmptyString(target.teamId)) { continue; }

            var count = parseInt(target.currentMemberCount, 10);
            if (isNaN(count) || count < 0) { count = 0; }

            cleanTargets.push({
                teamId: String(target.teamId),
                teamName: isNonEmptyString(target.teamName)
                    ? target.teamName
                    : 'Unnamed Team',
                currentMemberCount: count,
                plannedAdditions: 0
            });
        }

        // ---- Sort ----
        cleanTargets.sort(function(a, b) {
            if (a.currentMemberCount !== b.currentMemberCount) {
                return a.currentMemberCount - b.currentMemberCount;
            }
            return a.teamName.localeCompare(b.teamName);
        });

        cleanCandidates.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        // ---- Greedy placement ----
        for (var i = 0; i < cleanCandidates.length; i++) {
            var placed = false;

            for (var j = 0; j < cleanTargets.length; j++) {
                var ct = cleanTargets[j];
                var total =
                    ct.currentMemberCount +
                    ct.plannedAdditions;

                if (total >= targetSize) { continue; }

                ct.plannedAdditions++;

                if (!ct.additions) {
                    ct.additions = [];
                }
                ct.additions.push({
                    id: cleanCandidates[i].id,
                    name: cleanCandidates[i].name
                });

                placed = true;
                break;
            }

            if (!placed) { break; }
        }

        // ---- Emit proposal ----
        var assignments = [];
        for (var k = 0; k < cleanTargets.length; k++) {
            var target2 = cleanTargets[k];
            if (!target2.additions ||
                target2.additions.length === 0) {
                continue;
            }
            assignments.push({
                teamId: target2.teamId,
                teamName: target2.teamName,
                additions: target2.additions
            });
        }

        return {
            year: year,
            targetSize: targetSize,
            assignments: assignments
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMatchmaking = Object.freeze({
        buildProposal: buildProposal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamMatchmaking;
        var missing = [];

        if (typeof exports.buildProposal !== 'function') {
            missing.push('buildProposal');
        }

        try {
            // Empty inputs.
            var empty = buildProposal({});
            if (!empty ||
                empty.targetSize !== null ||
                !Array.isArray(empty.assignments) ||
                empty.assignments.length !== 0) {
                missing.push(
                    'buildProposal({}) did not return empty shape'
                );
            }

            // Two targets, three candidates, capacity 1.
            // Expected: A gets 1, B gets 1, third candidate
            // unplaced.
            var two = buildProposal({
                year: 1902,
                targetSize: 3,
                candidates: [
                    { id: 'c1', name: 'Anne' },
                    { id: 'c2', name: 'Beth' },
                    { id: 'c3', name: 'Cara' }
                ],
                targets: [
                    {
                        teamId: 't1',
                        teamName: 'Alpha',
                        currentMemberCount: 2
                    },
                    {
                        teamId: 't2',
                        teamName: 'Beta',
                        currentMemberCount: 2
                    }
                ]
            });
            if (two.assignments.length !== 2) {
                missing.push(
                    'two-target smoke: expected 2 assignments, got ' +
                    two.assignments.length
                );
            } else {
                var totalAdds = two.assignments[0].additions.length +
                    two.assignments[1].additions.length;
                if (totalAdds !== 2) {
                    missing.push(
                        'two-target smoke: expected 2 total additions, ' +
                        'got ' + totalAdds
                    );
                }
            }

            // Least-full target picked first.
            var least = buildProposal({
                year: 1902,
                targetSize: 4,
                candidates: [{ id: 'c1', name: 'Anne' }],
                targets: [
                    {
                        teamId: 'busy',
                        teamName: 'Busy',
                        currentMemberCount: 3
                    },
                    {
                        teamId: 'empty',
                        teamName: 'Empty',
                        currentMemberCount: 0
                    }
                ]
            });
            if (least.assignments.length !== 1 ||
                least.assignments[0].teamId !== 'empty') {
                missing.push(
                    'least-full smoke: expected "empty" picked first'
                );
            }

            // Determinism: same input, same output.
            var input = {
                year: 1902,
                targetSize: 3,
                candidates: [
                    { id: 'c2', name: 'Beth' },
                    { id: 'c1', name: 'Anne' }
                ],
                targets: [{
                    teamId: 't1',
                    teamName: 'Alpha',
                    currentMemberCount: 0
                }]
            };
            var runA = buildProposal(input);
            var runB = buildProposal(input);
            if (runA.assignments[0].additions[0].id !==
                runB.assignments[0].additions[0].id) {
                missing.push('determinism smoke: outputs differ');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamMatchmaking] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
