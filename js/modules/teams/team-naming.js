/**
 * modules/teams/team-naming.js - Team Roman-Numeral Naming
 *
 * Path: js/modules/teams/team-naming.js
 *
 * WHAT THIS OWNS:
 *   - The "N-th generation" suffix rule for team names.
 *   - Regenerating a team's current period name when a member
 *     joins that crosses a suffix threshold.
 *   - Closing the current period and opening a new one on rollover.
 *   - A one-shot migrator for teams still on the legacy shape.
 *
 * THE RULE:
 *   A team's name is <baseName> [<roman>], where:
 *     - <baseName> is the team's original name, the one that was
 *       current when the very first members joined.
 *     - <roman> is a Roman numeral from II upward, computed from
 *       the number of DISTINCT characters who have ever been a
 *       member of the team.
 *
 *   The first three distinct members do not increment the
 *   suffix. The team keeps its base name while it holds those
 *   three. The fourth distinct member bumps the team to II. The
 *   fifth bumps it to III. And so on. The nth distinct member
 *   yields suffix (n - 2), or no suffix when n <= 3.
 *
 * THE PERIODS MODEL:
 *   A team carries a `periods` array. Each entry describes what
 *   the team was during a range of years. The LAST entry is the
 *   current period.
 *
 *   When the suffix changes (a new distinct member crosses a
 *   threshold), the naming module performs a ROLLOVER:
 *
 *     1. Close the current period at the year the new period opens
 *        (the trigger year). The half-open convention in
 *        team-core.js means a period that ends at year Y and
 *        another that starts at year Y do not overlap; the
 *        boundary year belongs to the LATER period.
 *     2. Open a new period at the trigger year, inheriting the
 *        previous period's tacticalStyle and specialisations.
 *     3. Set the new period's name to the recomputed suffix name.
 *
 *   This produces, for a team founded in 1900 whose fourth
 *   distinct member joined in 1905:
 *
 *     Rapid     1900–1905
 *     Rapid II  1905–present
 *
 *   And for a team founded in 1900 whose fourth distinct member
 *   joined in 1900:
 *
 *     Rapid     1900–1900
 *     Rapid II  1900–present
 *
 *   Both are legal under the half-open rule. The same-year case
 *   is not an error; it is the correct representation of "the
 *   rename happened in the same year the team was founded."
 *
 * THE TRIGGER YEAR:
 *   The year the new period opens is the EARLIEST joinPeriod
 *   across the stints of the distinct member who triggered the
 *   suffix change — the (suffixNumber + 1)-th distinct member in
 *   the sorted-by-earliest-join order.
 *
 *   A member with no parseable join period does not participate
 *   in suffix computation; they are still counted as a distinct
 *   person, but their join cannot be used to date a boundary.
 *
 *   Because the trigger year is a member's join year, it is by
 *   construction >= the team's first period's start year. If it
 *   is not — because the periods array was manually edited and
 *   the sort is wrong — the rollover refuses rather than
 *   producing an inverted range.
 *
 * WHY THE ROLLOVER IS ONE-WAY:
 *   The distinct count is over "characters who have ever been a
 *   member." A member leaving or dying does not decrement it. So
 *   the suffix only ever moves forward. The naming module is
 *   therefore only ever asked to close-and-open; it never
 *   reopens a closed period.
 *
 *   If a member is removed by mistake and the user wants to
 *   undo the rollover, that is an edit to the periods array, not
 *   a naming operation. See the team form.
 *
 * DISTINCT CHARACTERS:
 *   A character who leaves and rejoins is ONE distinct member.
 *   The count is over characterIds, not over stints.
 *
 * ORDERING:
 *   "The earliest three" are decided by the character's EARLIEST
 *   joinPeriod across all their stints on the team. Ties are
 *   broken by characterId for stability.
 *
 * MULTI-LEVEL SKIPS:
 *   A single applyTeamName call produces AT MOST ONE new period,
 *   for the current suffix level. If a rollover was missed in an
 *   earlier session (say the team is at "II" but should be at
 *   "IV"), the call produces "IV" with one new period and warns
 *   that intermediate levels were skipped. It does not backfill
 *   intermediate periods, because inventing history is not a
 *   naming decision.
 *
 * NAME PROVENANCE (nameIsAuto):
 *   applyTeamName generates a new display name. That name is by
 *   definition auto-generated, so the update it sends to
 *   TeamCore.updateTeam carries nameIsAuto: true. The flag tells
 *   team-events.js's saveTeam that the current name is not
 *   user-typed, so the periods array wins on the next save
 *   unless the user retypes the top-of-form field.
 *
 *   A user who edits the top field flips the flag to false
 *   (handled by team-events.js). This module never sets it to
 *   false.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Team reads. TeamQueries owns them.
 *   - Team writes. TeamCore owns them.
 *   - The periods shape. TeamCore owns the schema.
 *   - The naming suffix grammar. This module owns it, and it is
 *     the only place it appears.
 *
 * DEPENDENCIES:
 *   - window.TeamQueries
 *   - window.TeamCore
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.NotificationSystem  (migrator reports)
 */

(function() {
    'use strict';

    if (window.__teamNamingLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamCore = window.TeamCore;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamCore ||
        typeof TeamCore.updateTeam !== 'function') {
        _missing.push('TeamCore.updateTeam');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamNaming] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamNamingLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    var ROMAN_VALUES = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
        [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ];

    function toRoman(n) {
        if (typeof n !== 'number' || !isFinite(n) || n < 1) {
            return '';
        }
        n = Math.floor(n);
        var result = '';
        for (var i = 0; i < ROMAN_VALUES.length; i++) {
            var value = ROMAN_VALUES[i][0];
            var symbol = ROMAN_VALUES[i][1];
            while (n >= value) {
                result += symbol;
                n -= value;
            }
        }
        return result;
    }

    function parsePeriodNum(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Strip a trailing Roman-numeral suffix from a team name.
     *
     *   "Rapid"        -> { base: "Rapid", suffix: null }
     *   "Rapid II"     -> { base: "Rapid", suffix: 2 }
     *   "Rapid III"    -> { base: "Rapid", suffix: 3 }
     *   "Rapid XL"     -> { base: "Rapid", suffix: 40 }
     *
     * The suffix must be a valid Roman numeral preceded by a
     * single space, at the very end of the string. "Rapid I"
     * (single I) is treated as a base name.
     */
    function splitTeamName(name) {
        var raw = String(name || '');
        if (raw === '') { return { base: '', suffix: null }; }

        var trimmed = raw.trim();

        var match = trimmed.match(
            /\s+(M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))$/
        );
        if (!match) {
            return { base: trimmed, suffix: null };
        }

        var roman = match[1];
        if (roman === '') {
            return { base: trimmed, suffix: null };
        }

        if (roman === 'I') {
            return { base: trimmed, suffix: null };
        }

        var value = romanToNumber(roman);
        if (value === null || value < 2) {
            return { base: trimmed, suffix: null };
        }

        var base = trimmed.substring(
            0, trimmed.length - match[0].length
        ).trim();
        if (base === '') {
            return { base: trimmed, suffix: null };
        }

        return { base: base, suffix: value };
    }

    function romanToNumber(roman) {
        if (!roman || typeof roman !== 'string') { return null; }
        var map = {
            I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000
        };
        var total = 0;
        var prev = 0;
        for (var i = roman.length - 1; i >= 0; i--) {
            var c = roman.charAt(i);
            var v = map[c];
            if (v === undefined) { return null; }
            if (v < prev) {
                total -= v;
            } else {
                total += v;
                prev = v;
            }
        }
        return total;
    }

    // ============================================================
    // DISTINCT MEMBER SET
    // ============================================================
    //
    // Returns an array of { characterId, earliestJoin }. Sorted
    // by earliestJoin ascending; ties by characterId.

    function getDistinctMembers(team) {
        var seen = Object.create(null);

        if (!team || !Array.isArray(team.members)) {
            return [];
        }

        for (var m = 0; m < team.members.length; m++) {
            var member = team.members[m];
            if (!member || !isNonEmptyString(member.characterId)) {
                continue;
            }

            var charId = String(member.characterId);
            var intervals = Array.isArray(member.intervals)
                ? member.intervals
                : [];

            var earliest = null;

            for (var i = 0; i < intervals.length; i++) {
                var iv = intervals[i];
                if (!iv || typeof iv !== 'object') { continue; }
                var join = parsePeriodNum(iv.joinPeriod);
                if (join === null) { continue; }
                if (earliest === null || join < earliest) {
                    earliest = join;
                }
            }

            if (!seen[charId]) {
                seen[charId] = {
                    characterId: charId,
                    earliestJoin: earliest
                };
            } else if (earliest !== null) {
                var existing = seen[charId].earliestJoin;
                if (existing === null || earliest < existing) {
                    seen[charId].earliestJoin = earliest;
                }
            }
        }

        var result = [];
        for (var key in seen) {
            if (Object.prototype.hasOwnProperty.call(seen, key)) {
                result.push(seen[key]);
            }
        }

        result.sort(function(a, b) {
            var aJ = a.earliestJoin;
            var bJ = b.earliestJoin;
            if (aJ === null && bJ === null) {
                return a.characterId.localeCompare(b.characterId);
            }
            if (aJ === null) { return 1; }
            if (bJ === null) { return -1; }
            if (aJ !== bJ) { return aJ - bJ; }
            return a.characterId.localeCompare(b.characterId);
        });

        return result;
    }

    // ============================================================
    // SUFFIX COMPUTATION
    // ============================================================

    /**
     * Compute the current suffix from the distinct member count.
     *
     *   n <= 3  ->  0  (no suffix; roman is '')
     *   n == 4  ->  2  ("II")
     *   n == 5  ->  3  ("III")
     *   n       ->  n - 2
     *
     * Returns { suffixNumber, roman }.
     */
    function computeSuffix(distinctCount) {
        if (typeof distinctCount !== 'number' ||
            distinctCount < 1) {
            return { suffixNumber: 0, roman: '' };
        }
        if (distinctCount <= 3) {
            return { suffixNumber: 0, roman: '' };
        }
        var n = distinctCount - 2;
        return { suffixNumber: n, roman: toRoman(n) };
    }

    // ============================================================
    // BASE NAME
    // ============================================================
    //
    // The base name is the name of the FIRST period, with any
    // trailing Roman suffix stripped. It is the name the team was
    // founded under, before any suffix generation existed.

    function getBaseName(team) {
        if (!team || typeof team !== 'object') { return ''; }

        if (Array.isArray(team.periods) && team.periods.length > 0) {
            var first = team.periods[0];
            if (first && isNonEmptyString(first.name)) {
                var split = splitTeamName(first.name);
                if (split.base !== '') { return split.base; }
            }
        }

        var currentSplit = splitTeamName(team.name || '');
        return currentSplit.base || String(team.name || 'Unnamed Team');
    }

    // ============================================================
    // NAME RECOMPUTATION
    // ============================================================

    /**
     * Compute what a team's current display name should be.
     *
     * Returns a plain object; writes nothing.
     *
     *   {
     *     displayName,     // 'Rapid', 'Rapid II', ...
     *     baseName,
     *     suffixNumber,    // 0 when no suffix
     *     roman,           // '' when no suffix
     *     distinctCount,
     *     changed,         // true when displayName differs from
     *                      // periods[last].name
     *     triggerJoinYear  // the earliest join of the distinct
     *                      // member whose addition crossed the
     *                      // current threshold, or null
     *   }
     *
     * `triggerJoinYear` is the year the new period should open
     * at, when a rollover is due. It is the earliest join of the
     * (suffixNumber + 1)-th distinct member — the member whose
     * arrival produced the current suffix.
     *
     * For a team at suffix 0 (n <= 3), `triggerJoinYear` is null:
     * there is no threshold crossing yet.
     */
    function computeTeamName(team) {
        if (!team || typeof team !== 'object') {
            return {
                displayName: '',
                baseName: '',
                suffixNumber: 0,
                roman: '',
                distinctCount: 0,
                changed: false,
                triggerJoinYear: null
            };
        }

        var baseName = getBaseName(team);
        var distinctMembers = getDistinctMembers(team);
        var distinctCount = distinctMembers.length;
        var suffix = computeSuffix(distinctCount);

        var displayName = suffix.roman === ''
            ? baseName
            : baseName + ' ' + suffix.roman;

        // ---- Trigger join year ----
        //
        // The member whose arrival pushed the team into the
        // current suffix is at index (suffixNumber + 1) in the
        // sorted-by-earliest-join list. For suffix 2 (II), that is
        // index 3 (the 4th distinct member). For suffix 3 (III),
        // index 4.
        var triggerJoinYear = null;
        if (suffix.suffixNumber >= 2 &&
            distinctMembers.length > suffix.suffixNumber) {
            var triggerIndex = suffix.suffixNumber + 1;
            if (triggerIndex < distinctMembers.length) {
                triggerJoinYear =
                    distinctMembers[triggerIndex].earliestJoin;
            }
        }

        // ---- Changed? ----
        //
        // A change is due when the current period's name does not
        // match the recomputed name. That is the only condition
        // the naming module acts on; if the name already matches,
        // nothing needs to happen.
        var currentName = '';
        if (Array.isArray(team.periods) && team.periods.length > 0) {
            var last = team.periods[team.periods.length - 1];
            if (last && isNonEmptyString(last.name)) {
                currentName = String(last.name);
            }
        }
        if (currentName === '' && isNonEmptyString(team.name)) {
            currentName = String(team.name);
        }

        var changed = (currentName !== displayName);

        return {
            displayName: displayName,
            baseName: baseName,
            suffixNumber: suffix.suffixNumber,
            roman: suffix.roman,
            distinctCount: distinctCount,
            changed: changed,
            triggerJoinYear: triggerJoinYear
        };
    }

    // ============================================================
    // PERIOD ROLLOVER
    // ============================================================
    //
    // Build the next periods array.
    //
    // The current (last) period closes at the trigger year. A new
    // period opens at the same trigger year, inheriting the
    // previous period's tacticalStyle and specialisations and
    // taking the recomputed name.
    //
    // The half-open convention in team-core.js means a period
    // ending at year Y and another starting at year Y do NOT
    // overlap: the boundary year belongs to the LATER period.
    // That is what makes the same-year rollover legal:
    //
    //   Rapid     1900–1900
    //   Rapid II  1900–present
    //
    // The same year sees both the founding and the rename. Both
    // periods name it. Under the half-open rule, 1900 belongs to
    // Rapid II.
    //
    // THREE CASES:
    //
    //   1. lastStart < triggerYear
    //        Normal case. The current period closes at
    //        (triggerYear - 1). The gap between the end and the
    //        new start is zero.
    //
    //   2. lastStart === triggerYear
    //        Same-year rollover. The current period closes AT
    //        the trigger year. Under the half-open rule, the
    //        current period ends 1900, the new period starts
    //        1900, and 1900 belongs to the new period.
    //
    //   3. lastStart > triggerYear
    //        Data inconsistency. The periods array is sorted
    //        ascending, so the last period's start should be the
    //        latest. If it is not, closing at (triggerYear - 1)
    //        would produce an inverted range that the
    //        canonicaliser rejects. Refuse and log; the caller
    //        falls back to a rewrite-in-place.
    //
    // WHAT THIS FUNCTION DOES NOT DO:
    //   It does not backfill intermediate suffix levels. If a
    //   rollover was missed and the computed suffix is more than
    //   one above the current one, a single new period is
    //   produced for the current level. The caller logs the
    //   skip. Inventing intermediate periods would be inventing
    //   history.

    function buildRolloverPeriods(team, computed) {
        if (!Array.isArray(team.periods) ||
            team.periods.length === 0) {
            return null;
        }
        if (computed.triggerJoinYear === null) {
            return null;
        }

        var triggerYear = computed.triggerJoinYear;
        var triggerStr = String(triggerYear);

        var periods = [];
        for (var i = 0; i < team.periods.length; i++) {
            periods.push({
                startPeriod: team.periods[i].startPeriod,
                endPeriod: team.periods[i].endPeriod,
                name: team.periods[i].name,
                tacticalStyle: team.periods[i].tacticalStyle,
                specialisations: Array.isArray(
                    team.periods[i].specialisations
                )
                    ? team.periods[i].specialisations.slice()
                    : []
            });
        }

        var last = periods[periods.length - 1];
        var lastStartNum = parsePeriodNum(last.startPeriod);

        if (lastStartNum === null) {
            console.warn(
                '[TeamNaming] Cannot rollover: current period has ' +
                'no parseable start period.'
            );
            return null;
        }

        if (lastStartNum > triggerYear) {
            console.warn(
                '[TeamNaming] Cannot rollover: current period ' +
                'starts in ' + last.startPeriod +
                ' but trigger year is ' + triggerYear + '. The ' +
                'periods array may be unsorted or manually edited. ' +
                'The current period name will be rewritten in ' +
                'place instead.'
            );
            return null;
        }

        if (lastStartNum === triggerYear) {
            last.endPeriod = triggerStr;
        } else {
            if (triggerYear <= 1) {
                periods.pop();
            } else {
                last.endPeriod = String(triggerYear - 1);
            }
        }

        var inheritFrom = periods.length > 0
            ? periods[periods.length - 1]
            : null;

        periods.push({
            startPeriod: triggerStr,
            endPeriod: '',
            name: computed.displayName,
            tacticalStyle: inheritFrom
                ? (inheritFrom.tacticalStyle || '')
                : '',
            specialisations: inheritFrom &&
                Array.isArray(inheritFrom.specialisations)
                ? inheritFrom.specialisations.slice()
                : []
        });

        return periods;
    }

    // ============================================================
    // APPLY
    // ============================================================

    /**
     * Recompute a team's current name and, if a rollover is due,
     * persist the new periods array through TeamCore.updateTeam.
     *
     * Returns a promise resolving to:
     *
     *   {
     *     updated: boolean,
     *     previousName,
     *     newName,
     *     rolledOver: boolean,   // true when a new period was
     *                            // opened
     *     error?: string
     *   }
     */
    function applyTeamName(teamId) {
        if (!teamId) {
            return Promise.resolve({
                updated: false,
                error: 'No team id.'
            });
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return Promise.resolve({
                updated: false,
                error: 'Team not found.'
            });
        }

        var computed = computeTeamName(team);
        if (!computed.changed) {
            return Promise.resolve({
                updated: false,
                previousName: team.name,
                newName: computed.displayName,
                rolledOver: false
            });
        }

        // ---- Does the change require a rollover? ----
        //
        // A rollover happens when the current period's name is
        // being replaced by a name whose suffix number is one
        // higher than the current one, AND we have a trigger
        // year to open the new period at.
        //
        // A jump of more than one suffix level (say from "II"
        // directly to "IV") still produces ONE new period, at
        // the current computed level. The caller logs the skip.
        var currentSuffix = 0;
        if (Array.isArray(team.periods) && team.periods.length > 0) {
            var currentName = team.periods[team.periods.length - 1].name;
            var split = splitTeamName(currentName || '');
            if (split.suffix !== null) {
                currentSuffix = split.suffix;
            }
        }
        if (currentSuffix === 0 && isNonEmptyString(team.name)) {
            var splitTop = splitTeamName(team.name);
            if (splitTop.suffix !== null) {
                currentSuffix = splitTop.suffix;
            }
        }

        var requiresRollover =
            computed.suffixNumber > currentSuffix &&
            computed.triggerJoinYear !== null;

        // ---- Warn on skipped levels ----
        //
        // The rollover below produces a single new period, for
        // the current computed suffix. If the jump is more than
        // one level, intermediate periods are not created.
        // Surface that so the user can add them manually.
        if (requiresRollover &&
            computed.suffixNumber > currentSuffix + 1) {
            console.warn(
                '[TeamNaming] Skipped suffix levels on team ' +
                teamId + ': current name is "' +
                (team.name || '') + '", computed is "' +
                computed.displayName + '". A single new period ' +
                'will be produced. Add intervening periods ' +
                'manually in the team form if needed.'
            );
        }

        var newPeriods = null;
        if (requiresRollover) {
            newPeriods = buildRolloverPeriods(team, computed);
        }

        // ---- Build the update ----
        //
        // Every successful applyTeamName writes an auto-
        // generated name. Set nameIsAuto: true so the next
        // save's top-field dirty-check knows the period name is
        // authoritative.
        var update = {
            nameIsAuto: true
        };
        if (newPeriods !== null) {
            update.periods = newPeriods;
        } else {
            update.name = computed.displayName;
        }

        return TeamCore.updateTeam(teamId, update)
            .then(function(result) {
                if (!result || !result.success) {
                    return {
                        updated: false,
                        previousName: team.name,
                        newName: computed.displayName,
                        rolledOver: false,
                        error: (result && result.message) ||
                            'Update failed.'
                    };
                }
                return {
                    updated: true,
                    previousName: team.name,
                    newName: computed.displayName,
                    rolledOver: newPeriods !== null
                };
            })
            .catch(function(err) {
                return {
                    updated: false,
                    previousName: team.name,
                    newName: computed.displayName,
                    rolledOver: false,
                    error: err && err.message
                        ? err.message
                        : String(err)
                };
            });
    }

    // ============================================================
    // ONE-SHOT MIGRATOR
    // ============================================================
    //
    // Walks every team and applies the naming rule. On the
    // periods model, this is a no-op for a team already on the
    // current shape (its last period's name is already correct,
    // or its distinct count has not crossed a new threshold).
    //
    // The migrator is most useful for a store that was migrated
    // from the legacy shape but whose teams accumulated
    // members before the periods model existed. For those, the
    // last period's name may not reflect the current distinct
    // count, and the migrator closes-and-opens as needed.

    function previewAllTeams() {
        var teams = getTeamsArrayForMigration();
        var report = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            var computed = computeTeamName(team);
            report.push({
                teamId: String(team.id),
                currentName: team.name,
                computedName: computed.displayName,
                distinctCount: computed.distinctCount,
                changed: computed.changed
            });
        }

        return report;
    }

    function getTeamsArrayForMigration() {
        var data = window.data || {};
        return Array.isArray(data.teams) ? data.teams : [];
    }

    function recomputeAllTeams() {
        var teams = getTeamsArrayForMigration();
        var total = teams.length;

        var updated = 0;
        var rolled = 0;
        var unchanged = 0;
        var failed = 0;

        var chain = Promise.resolve();

        teams.forEach(function(team) {
            chain = chain.then(function() {
                if (!team || !team.id) {
                    return;
                }
                return applyTeamName(team.id)
                    .then(function(result) {
                        if (result.updated) {
                            updated++;
                            if (result.rolledOver) {
                                rolled++;
                            }
                            console.log(
                                '[TeamNaming] Renamed "' +
                                result.previousName + '" -> "' +
                                result.newName +
                                '"' +
                                (result.rolledOver
                                    ? ' (new period)'
                                    : '') + ''
                            );
                        } else if (result.error) {
                            failed++;
                            console.warn(
                                '[TeamNaming] Failed on team ' +
                                team.id + ': ' + result.error
                            );
                        } else {
                            unchanged++;
                        }
                    });
            });
        });

        return chain.then(function() {
            var summary = {
                total: total,
                updated: updated,
                rolledOver: rolled,
                unchanged: unchanged,
                failed: failed
            };
            console.log(
                '[TeamNaming] Migration complete:',
                summary
            );

            var NS = window.NotificationSystem;
            if (NS && typeof NS.notify === 'function') {
                var parts = [];
                if (updated > 0) {
                    parts.push('updated ' + updated +
                        (rolled > 0
                            ? ' (' + rolled + ' new periods)'
                            : ''));
                }
                if (unchanged > 0) {
                    parts.push('unchanged ' + unchanged);
                }
                if (failed > 0) {
                    parts.push('failed ' + failed);
                }
                NS.notify(
                    'Team naming migration: ' +
                    (parts.length > 0
                        ? parts.join(', ')
                        : 'nothing to do') + '.',
                    failed > 0 ? 'warning' : 'success'
                );
            }

            return summary;
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamNaming = Object.freeze({
        // Pure computation
        computeTeamName: computeTeamName,
        getDistinctMembers: getDistinctMembers,
        getBaseName: getBaseName,
        computeSuffix: computeSuffix,
        buildRolloverPeriods: buildRolloverPeriods,

        // Mutation
        applyTeamName: applyTeamName,

        // Migration
        previewAllTeams: previewAllTeams,
        recomputeAllTeams: recomputeAllTeams,

        // Exposed for tests
        toRoman: toRoman,
        splitTeamName: splitTeamName
    });

})();
