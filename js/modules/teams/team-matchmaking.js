/**
 * modules/teams/team-matchmaking.js - Team Matchmaking
 * Pure auto-matcher for professional-team matchmaking.
 *
 * Path: js/modules/teams/team-matchmaking.js
 *
 * WHAT THIS MODULE IS:
 *   - One public function: buildProposal(inputs).
 *   - A pure, deterministic, greedy matcher.
 *
 * WHAT THIS MODULE IS NOT:
 *   - A query module. It receives its inputs from the caller.
 *   - A mutation module. It returns a proposal; it does not
 *     commit anything.
 *   - A render module. It has no DOM dependencies.
 *   - A rule engine. It does not validate team type, team
 *     window, character existence, deceased state, or anything
 *     else. The caller supplies a pool that has already been
 *     filtered to eligible candidates, and a list of targets
 *     that have already been filtered to eligible teams.
 *
 * WHY IT IS PURE:
 *   Determinism is a property of the algorithm, not of the
 *   surrounding system. Keeping this module free of reads makes
 *   the algorithm testable in isolation and makes the proposal
 *   reproducible: the same inputs always produce the same
 *   output. The aggregator (MM2) does the reading; this module
 *   does the math.
 *
 * ALGORITHM:
 *   1. Sort targets by currentMemberCount ascending; ties by
 *      name ascending. (The caller supplies the sort order; we
 *      re-sort defensively.)
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
 *   Deterministic. Greedy. No randomness. No history bias. No
 *   role bias.
 *
 * INPUT SHAPE:
 *   {
 *     year:        number,   // for the caller's convenience;
 *                            // this module does not read it
 *     targetSize:  number,   // >= 1
 *     candidates:  [ { id, name } ],
 *     targets:     [ {
 *                      teamId,
 *                      teamName,
 *                      currentMemberCount
 *                  } ]
 *   }
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
 *   `assignments`. A caller that wants the full target list can
 *   read it from the input.
 *
 * EDITABILITY:
 *   The proposal is returned as plain data. The UI is
 *   responsible for letting the user edit it before commit. This
 *   module has no concept of "the committed proposal."
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

    /**
     * Parse a positive integer. Accepts numbers and pure-digit
     * strings. Returns null for anything else. Never coerces.
     */
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

    function getName(candidateOrTarget) {
        if (!isObject(candidateOrTarget)) { return ''; }
        var name = candidateOrTarget.name;
        if (typeof name === 'string') { return name; }
        var teamName = candidateOrTarget.teamName;
        if (typeof teamName === 'string') { return teamName; }
        return '';
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

        // ---- Normalise the candidate pool. ----
        //
        // Drop entries without an id. Keep the order stable for
        // the tie-break sort below.
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

        // ---- Normalise the target list. ----
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

        // ---- Sort targets: least-full first, ties by name. ----
        cleanTargets.sort(function(a, b) {
            if (a.currentMemberCount !== b.currentMemberCount) {
                return a.currentMemberCount - b.currentMemberCount;
            }
            return a.teamName.localeCompare(b.teamName);
        });

        // ---- Sort candidates: by name ascending. ----
        cleanCandidates.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        // ---- Greedy placement. ----
        //
        // For each candidate, walk the targets in order and place
        // them in the FIRST target with a free slot. If no target
        // has a slot, stop. This is the spec's step 3 verbatim.
        for (var i = 0; i < cleanCandidates.length; i++) {
            var placed = false;
            for (var j = 0; j < cleanTargets.length; j++) {
                var candidateTarget = cleanTargets[j];
                var total =
                    candidateTarget.currentMemberCount +
                    candidateTarget.plannedAdditions;
                if (total >= targetSize) {
                    continue;
                }
                candidateTarget.plannedAdditions++;
                // Attach the candidate to the target's additions
                // list. We lazily create the additions array on the
                // target so teams with no additions do not carry
                // an empty array.
                if (!candidateTarget.additions) {
                    candidateTarget.additions = [];
                }
                candidateTarget.additions.push({
                    id: cleanCandidates[i].id,
                    name: cleanCandidates[i].name
                });
                placed = true;
                break;
            }
            if (!placed) {
                // No target has a slot. Stop.
                break;
            }
        }

        // ---- Emit the proposal. ----
        //
        // Only teams that received at least one addition are
        // included. Order is the sorted target order.
        var assignments = [];
        for (var k = 0; k < cleanTargets.length; k++) {
            var ct = cleanTargets[k];
            if (!ct.additions || ct.additions.length === 0) {
                continue;
            }
            assignments.push({
                teamId: ct.teamId,
                teamName: ct.teamName,
                additions: ct.additions
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

        if (missing.length > 0) {
            console.warn(
                '[TeamMatchmaking] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();
