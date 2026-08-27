/**
 * js/modules/teams/team-rankings.js - Team Ranking Management
 * Handles team ranking history
 * Path: js/modules/teams/team-rankings.js
 * 
 * This module is responsible for:
 *   - Adding ranking entries to teams
 *   - Removing ranking entries from teams
 *   - Maintaining the currentRank cache
 * 
 * IMPORTANT:
 *   rankingHistory is the AUTHORITATIVE source of truth.
 *   currentRank is a MATERIALISED CACHE maintained by TeamRankings.
 *   Consumers requiring the current ranking should use getCurrentRank().
 *   currentRank should NOT be directly modified by other modules.
 *   The cache is refreshed on every mutation; getCurrentRank() recalculates from history.
 * 
 * INVARIANTS:
 *   - There is exactly ONE ranking per period per team.
 *   - addRanking() enforces this by removing all existing entries for the period.
 *   - removeRanking() removes all entries for the period (cleanup).
 *   - Ranks must be positive integers (strict validation).
 *   - Input periods may be strings or numbers.
 *   - Stored periods are always non-empty trimmed strings.
 * 
 * PERIOD SEMANTICS:
 *   - Academic teams: periods are week numbers (e.g., "1", "14")
 *   - Non-academic teams: periods are years or arbitrary sortable strings
 *   - Periods are compared using natural ordering
 * 
 * DATA CLEANUP:
 *   - Malformed entries (null, missing period) are silently filtered out in queries.
 *   - removeRanking() may also remove malformed entries if they share the target period.
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - For team lookup
 *   - window.logActivity - For activity logging (optional)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamRankingsLoaded) {
        return;
    }
    window.__teamRankingsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.TeamCore) {
        console.error('TeamRankings: TeamCore is required but not loaded.');
        return;
    }

    // ============================================================
    // PERIOD HELPERS
    // ============================================================

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function getPeriodLabel(teamType) {
        return teamType === 'academic' ? 'Week' : 'Period';
    }

    function getPeriodDisplay(period) {
        if (!hasPeriodValue(period)) return '?';
        return String(period).trim();
    }

    function isValidAcademicPeriod(value) {
        if (!hasPeriodValue(value)) return false;
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 && num <= 52;
    }

    function isValidRank(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1;
    }

    /**
     * Compare two periods using natural ordering.
     * Academic teams: numeric week comparison.
     * Non-academic teams: natural string comparison (e.g., "2024" < "2025").
     * 
     * Note: "Arbitrary strings" are assumed to be sortable.
     * If your application supports non-sortable date formats (e.g., "Jan 2026"),
     * this comparison may not produce chronological order.
     */
    function comparePeriods(a, b, teamType) {
        var aStr = String(a).trim();
        var bStr = String(b).trim();

        if (teamType === 'academic') {
            var aNum = Number(aStr);
            var bNum = Number(bStr);
            if (Number.isInteger(aNum) && Number.isInteger(bNum)) {
                return aNum - bNum;
            }
            // Fallback to string comparison if not numeric
            return aStr.localeCompare(bStr, undefined, { numeric: true });
        }

        // Non-academic: natural string comparison
        return aStr.localeCompare(bStr, undefined, { numeric: true });
    }

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    var TeamRankings = {
        /**
         * Add a ranking entry to a team.
         * Enforces ONE ranking per period by removing all existing entries for the period.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period (week block or year)
         * @param {string|number} rank - Rank number (strict: must be a positive integer)
         * @returns {boolean} Success
         */
        addRanking: function(teamId, period, rank) {
            // Validate inputs
            if (!hasPeriodValue(period)) {
                console.warn('TeamRankings.addRanking: Period is required.');
                return false;
            }

            // Strict rank validation: must be a positive integer
            if (!isValidRank(rank)) {
                console.warn('TeamRankings.addRanking: Rank must be a positive integer.');
                return false;
            }

            var team = window.TeamCore.getTeam(teamId);
            if (!team) {
                console.warn('TeamRankings.addRanking: Team not found.');
                return false;
            }

            var periodStr = String(period).trim();

            // Validate academic periods as week numbers
            if (team.type === 'academic' && !isValidAcademicPeriod(periodStr)) {
                console.warn('TeamRankings.addRanking: Academic period must be a week number (1-52).');
                return false;
            }

            if (!team.rankingHistory) {
                team.rankingHistory = [];
            }

            // Enforce ONE ranking per period: remove ALL existing entries for this period
            var existingEntries = team.rankingHistory.filter(function(r) {
                return r && String(r.period) === periodStr;
            });

            if (existingEntries.length > 0) {
                team.rankingHistory = team.rankingHistory.filter(function(r) {
                    return r && String(r.period) !== periodStr;
                });
            }

            var oldRank = existingEntries.length > 0 ? existingEntries[0].rank : null;
            var isUpdate = existingEntries.length > 0;

            // Add the new canonical entry
            team.rankingHistory.push({
                period: periodStr,
                rank: Number(rank)
            });

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            if (typeof window.logActivity === 'function') {
                var teamName = team.name || 'Unknown Team';
                if (isUpdate) {
                    window.logActivity('Updated ranking for ' + teamName + ': #' + oldRank + ' → #' + rank + ' (' + periodStr + ')');
                } else {
                    window.logActivity('Added ranking #' + rank + ' for ' + teamName + ' (' + periodStr + ')');
                }
            }

            return true;
        },

        /**
         * Remove a ranking entry by period.
         * Removes all entries matching the period (handles duplicate cleanup).
         * May also remove malformed entries if they share the target period.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            if (!hasPeriodValue(period)) {
                console.warn('TeamRankings.removeRanking: Period is required.');
                return false;
            }

            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.rankingHistory) {
                console.warn('TeamRankings.removeRanking: Team or ranking history not found.');
                return false;
            }

            var periodStr = String(period).trim();
            var originalLength = team.rankingHistory.length;

            // Find the entry to remove for logging
            var removedEntry = team.rankingHistory.find(function(r) {
                return r && String(r.period) === periodStr;
            });

            team.rankingHistory = team.rankingHistory.filter(function(r) {
                return r && String(r.period) !== periodStr;
            });

            if (team.rankingHistory.length === originalLength) {
                console.warn('TeamRankings.removeRanking: Period "' + periodStr + '" not found.');
                return false;
            }

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            if (typeof window.logActivity === 'function') {
                var teamName = team.name || 'Unknown Team';
                var rankInfo = removedEntry ? ' #' + removedEntry.rank : '';
                window.logActivity('Removed ranking' + rankInfo + ' from ' + teamName + ' (' + periodStr + ')');
            }

            return true;
        },

        /**
         * Update the current rank cache based on the most recent ranking.
         * This is a MATERIALISED CACHE, refreshed on every mutation.
         * 
         * @param {object} team - Team object
         * @private
         */
        _updateCurrentRank: function(team) {
            if (!team) return;

            if (!team.rankingHistory || team.rankingHistory.length === 0) {
                team.currentRank = '';
                return;
            }

            var sorted = this.getSortedHistory(team);
            team.currentRank = sorted.length > 0 ? String(sorted[sorted.length - 1].rank) : '';
        },

        /**
         * Get the ranking history sorted by period.
         * Uses the canonical period comparison for the team type.
         * Malformed entries are filtered out.
         * 
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedHistory: function(team) {
            if (!team || !team.rankingHistory) return [];
            if (!Array.isArray(team.rankingHistory)) return [];

            var teamType = team.type || 'academic';
            var history = team.rankingHistory.slice().filter(function(r) {
                return r && hasPeriodValue(r.period);
            });

            return history.sort(function(a, b) {
                return comparePeriods(a.period, b.period, teamType);
            });
        },

        /**
         * Get the current rank for a team.
         * This is the CANONICAL way to retrieve the current ranking.
         * Always recalculates from history rather than trusting the cache.
         * 
         * @param {object} team - Team object
         * @returns {string} Current rank (empty string if none)
         */
        getCurrentRank: function(team) {
            if (!team) return '';
            var history = this.getSortedHistory(team);
            return history.length > 0 ? String(history[history.length - 1].rank) : '';
        },

        /**
         * Get the most recent ranking entry for a team.
         * 
         * @param {object} team - Team object
         * @returns {object|null} Most recent ranking entry or null
         */
        getMostRecentRanking: function(team) {
            if (!team) return null;
            var history = this.getSortedHistory(team);
            return history.length > 0 ? history[history.length - 1] : null;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRankings = TeamRankings;

})();
