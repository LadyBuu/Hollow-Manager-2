/**
 * modules/teams/team-naming.js - Team Roman-Numeral Naming
 *
 * Path: js/modules/teams/team-naming.js
 *
 * WHAT THIS OWNS:
 *   - The "N-th generation" suffix rule for team names.
 *   - Regenerating a team's display name and name history
 *     whenever a member joins after the first three.
 *   - A one-shot migrator for already-existing teams.
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
 *   The suffix is derived. It is NOT stored as a separate field.
 *   The stored artifacts are:
 *     team.name        — the current display name
 *     team.nameHistory — a list of every distinct display name
 *                        the team has carried, with start and
 *                        end periods
 *
 *   The base name is recovered by scanning nameHistory for the
 *   earliest entry. When nameHistory is empty, the team's current
 *   name is used and treated as the base.
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
 * NAME HISTORY REGENERATION:
 *   Every time the suffix changes, nameHistory is rebuilt from
 *   scratch. The rebuild contains one entry per suffix the team
 *   has passed through, with:
 *     - name         the display name at that generation
 *     - startPeriod  the year of the join that produced it
 *     - endPeriod    the year of the next join that superseded
 *                    it, or '' for the current entry
 *
 *   This OVERRIDES whatever the user manually entered in the
 *   team form. The automatic naming and the manual naming would
 *   otherwise fight. If you want manual control, do not use
 *   member joins to drive the suffix.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Team reads. TeamQueries owns them.
 *   - Team writes. TeamCore owns them.
 *   - The modal. TeamKillModal owns it.
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
     *   "Rapid IV"     -> { base: "Rapid", suffix: 4 }
     *   "Rapid XL"     -> { base: "Rapid", suffix: 40 }
     *
     * The suffix must be a valid Roman numeral preceded by a
     * single space, at the very end of the string. "Rapid I"
     * (single I) is treated as a base name, because a suffix of
     * I is never produced by the naming rule.
     */
    function splitTeamName(name) {
        var raw = String(name || '');
        if (raw === '') { return { base: '', suffix: null }; }

        var trimmed = raw.trim();

        // Match " <roman>" at end.
        var match = trimmed.match(/\s+(M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))$/);
        if (!match) {
            return { base: trimmed, suffix: null };
        }

        var roman = match[1];
        if (roman === '') {
            return { base: trimmed, suffix: null };
        }

        // A single I is never a suffix. Treat it as part of the
        // base name.
        if (roman === 'I') {
            return { base: trimmed, suffix: null };
        }

        var value = romanToNumber(roman);
        if (value === null || value < 2) {
            return { base: trimmed, suffix: null };
        }

        var base = trimmed.substring(0, trimmed.length - match[0].length).trim();
        if (base === '') {
            // "II" on its own is not a base name.
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
    // Returns an array of { characterId, earliestJoin }.
    // Sorted by earliestJoin ascending; ties by characterId.
    // A character who has multiple stints appears once, carrying
    // their earliest joinPeriod.

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

            // A member with no parseable joinPeriod still counts
            // as a distinct person, but sorts to the end.
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
    // The base name is:
    //   1. The name field on the earliest nameHistory entry, if
    //      nameHistory is populated.
    //   2. Otherwise, the team's current name, with any trailing
    //      roman suffix stripped.
    //
    // Step 2 handles a team that has never had its nameHistory
    // managed. The current name may or may not carry a suffix;
    // splitTeamName removes it if present.

    function getBaseName(team) {
        if (!team || typeof team !== 'object') { return ''; }

        if (Array.isArray(team.nameHistory) &&
            team.nameHistory.length > 0) {
            // Find the entry with the earliest startPeriod, or
            // fall back to the first entry.
            var earliest = null;
            var earliestNum = Infinity;

            for (var i = 0; i < team.nameHistory.length; i++) {
                var entry = team.nameHistory[i];
                if (!entry || !isNonEmptyString(entry.name)) {
                    continue;
                }
                var startNum = parsePeriodNum(entry.startPeriod);
                var order = startNum === null ? i : startNum;
                if (order < earliestNum) {
                    earliestNum = order;
                    earliest = entry;
                }
            }

            if (earliest) {
                var split = splitTeamName(earliest.name);
                return split.base;
            }
        }

        // No usable nameHistory. Derive from current name.
        var currentSplit = splitTeamName(team.name || '');
        return currentSplit.base || String(team.name || 'Unnamed Team');
    }

    // ============================================================
    // NAME HISTORY REGENERATION
    // ============================================================
    //
    // Rebuild nameHistory from the distinct-member set.
    //
    // For each threshold crossing in chronological order, one
    // entry is emitted:
    //
    //   entry[0] = { name: baseName,          startPeriod: Y0, endPeriod: Y3 }
    //   entry[1] = { name: baseName + ' II',  startPeriod: Y4, endPeriod: Y5 }
    //   entry[2] = { name: baseName + ' III', startPeriod: Y6, endPeriod: ''   }
    //
    // Y0  = team.startPeriod, or the earliest member join, or ''
    // Y3  = the join year of the 4th distinct member
    // Y4  = same as Y3
    // Y5  = the join year of the 5th distinct member
    // Y6  = same as Y5
    // ...
    //
    // The current entry's endPeriod is always ''.

    function rebuildNameHistory(team, baseName) {
        var distinctMembers = getDistinctMembers(team);
        var distinctCount = distinctMembers.length;

        if (distinctCount === 0) {
            // No members. The team carries only its base name.
            var startOnly = parsePeriodNum(team.startPeriod);
            return [{
                name: baseName,
                startPeriod: startOnly === null
                    ? ''
                    : String(startOnly),
                endPeriod: ''
            }];
        }

        // Determine the start of the first entry.
        var teamStart = parsePeriodNum(team.startPeriod);
        var firstJoin = distinctMembers[0].earliestJoin;
        var firstStart = teamStart !== null
            ? teamStart
            : (firstJoin !== null ? firstJoin : null);

        var history = [{
            name: baseName,
            startPeriod: firstStart === null
                ? ''
                : String(firstStart),
            endPeriod: ''
        }];

        // For each index past 3 in the distinct array, the join
        // year of that member is a threshold crossing.
        //   distinct[3]  ->  suffix II starts
        //   distinct[4]  ->  suffix III starts
        //   distinct[i]  ->  suffix (i - 1) starts
        for (var i = 3; i < distinctMembers.length; i++) {
            var joinYear = distinctMembers[i].earliestJoin;
            if (joinYear === null) { continue; }

            var suffixNum = (i + 1) - 2;  // i=3 -> 2 (II); i=4 -> 3 (III)
            var roman = toRoman(suffixNum);
            var displayName = baseName + ' ' + roman;

            // Close the previous entry at joinYear - 1.
            var prev = history[history.length - 1];
            if (joinYear > 1) {
                prev.endPeriod = String(joinYear - 1);
            } else {
                prev.endPeriod = '';
            }

            history.push({
                name: displayName,
                startPeriod: String(joinYear),
                endPeriod: ''
            });
        }

        return history;
    }

    // ============================================================
    // NAME RECOMPUTATION
    // ============================================================

    /**
     * Compute what a team's name and history SHOULD be, given its
     * current member set. Returns a plain object; it does not
     * write anything.
     *
     * Returns:
     *   {
     *     displayName: string,
     *     baseName: string,
     *     suffixNumber: number,   // 0 when no suffix
     *     roman: string,          // '' when no suffix
     *     nameHistory: array,
     *     distinctCount: number,
     *     changed: boolean        // true when displayName differs
     *                             // from team.name OR nameHistory
     *                             // differs from team.nameHistory
     *   }
     */
    function computeTeamName(team) {
        if (!team || typeof team !== 'object') {
            return {
                displayName: '',
                baseName: '',
                suffixNumber: 0,
                roman: '',
                nameHistory: [],
                distinctCount: 0,
                changed: false
            };
        }

        var baseName = getBaseName(team);
        var distinctMembers = getDistinctMembers(team);
        var distinctCount = distinctMembers.length;
        var suffix = computeSuffix(distinctCount);

        var displayName = suffix.roman === ''
            ? baseName
            : baseName + ' ' + suffix.roman;

        var nameHistory = rebuildNameHistory(team, baseName);

        // Compare with the current state to decide "changed".
        var changed = (team.name !== displayName);

        if (!changed) {
            var currentHistory = Array.isArray(team.nameHistory)
                ? team.nameHistory
                : [];
            if (currentHistory.length !== nameHistory.length) {
                changed = true;
            } else {
                for (var i = 0; i < currentHistory.length; i++) {
                    var a = currentHistory[i];
                    var b = nameHistory[i];
                    if (!a || !b) { changed = true; break; }
                    if (a.name !== b.name ||
                        String(a.startPeriod || '') !==
                            String(b.startPeriod || '') ||
                        String(a.endPeriod || '') !==
                            String(b.endPeriod || '')) {
                        changed = true;
                        break;
                    }
                }
            }
        }

        return {
            displayName: displayName,
            baseName: baseName,
            suffixNumber: suffix.suffixNumber,
            roman: suffix.roman,
            nameHistory: nameHistory,
            distinctCount: distinctCount,
            changed: changed
        };
    }

    /**
     * Recompute a team's name and history and, if the result
     * differs from the current state, persist it via
     * TeamCore.updateTeam.
     *
     * Returns a promise resolving to { updated: boolean,
     * previousName, newName, error? }.
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
                newName: computed.displayName
            });
        }

        return TeamCore.updateTeam(teamId, {
            name: computed.displayName,
            nameHistory: computed.nameHistory
        }).then(function(result) {
            if (!result || !result.success) {
                return {
                    updated: false,
                    previousName: team.name,
                    newName: computed.displayName,
                    error: (result && result.message) ||
                        'Update failed.'
                };
            }
            return {
                updated: true,
                previousName: team.name,
                newName: computed.displayName
            };
        }).catch(function(err) {
            return {
                updated: false,
                previousName: team.name,
                newName: computed.displayName,
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
    // Walks every team, computes what its name and history should
    // be, and applies the change through TeamCore.updateTeam.
    //
    // Runs sequentially so a single failure does not derail the
    // whole migration and so the console log is readable.
    //
    // Usage from the console:
    //   await TeamNaming.recomputeAllTeams();
    //
    // Or to just see what would change:
    //   TeamNaming.previewAllTeams();

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
                            console.log(
                                '[TeamNaming] Renamed "' +
                                result.previousName + '" -> "' +
                                result.newName + '"'
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
                    parts.push('updated ' + updated);
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
        rebuildNameHistory: rebuildNameHistory,

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
