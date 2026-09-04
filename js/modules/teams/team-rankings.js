/**
 * js/modules/teams/team-rankings.js - Team Ranking Management
 * Handles team ranking history
 * Path: js/modules/teams/team-rankings.js
 * 
 * This module is responsible for:
 *   - Adding ranking entries to teams
 *   - Removing ranking entries from teams
 *   - Maintaining the currentRank cache
 *   - Providing ranking queries (getRankAtPeriod, getRankChange, etc.)
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
 *   - removeRanking() removes exactly the requested entry (using findIndex + splice).
 *   - Ranks must be positive integers (strict validation).
 *   - Input periods must be valid for the team type.
 *   - Stored periods are always non-empty trimmed strings.
 * 
 * PERIOD SEMANTICS:
 *   - Academic teams: periods are week numbers (e.g., "1", "14")
 *   - Non-academic teams: periods are years (e.g., "2025")
 *   - Periods are compared using natural ordering (numeric for both types)
 * 
 * MUTATION VALIDATION:
 *   - addRanking() validates the entire ranking history before mutation
 *   - removeRanking() validates the entire ranking history before mutation
 *   - Malformed entries cause the operation to fail (fail-closed)
 *   - No silent repair of malformed data during mutation
 * 
 * DATA CLEANUP:
 *   - Malformed entries (null, missing period) are SILENTLY FILTERED in queries.
 *   - This is a QUERY-TIME concern, not a MUTATION-TIME concern.
 *   - getSortedHistory() filters malformed entries.
 *   - hasRankings() uses getSortedHistory() for consistency.
 *   - Mutations reject malformed history rather than repairing it.
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - For team lookup (required)
 *   - window.TeamQueries - For team queries (required)
 *   - window.CALENDAR_CONSTANTS - Week/year constants (required)
 *   - window.ValidationUtils - Period parsing (required)
 *   - window.ActivityLog - Activity logging (required)
 * 
 * PERSISTENCE:
 *   - Mutations update in-memory domain state only.
 *   - The caller owns saveData() / persistence.
 *   - This module does NOT call saveData().
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamRankingsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.TeamCore) {
        return;
    }
    if (!window.TeamQueries) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.ValidationUtils) {
        return;
    }
    if (!window.ActivityLog) {
        return;
    }

    window.__teamRankingsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var ValidationUtils = window.ValidationUtils;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;

    // ============================================================
    // ACTIVITY LOGGING - Uses ActivityLog
    // ============================================================

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (err) {
            // Activity logging failure should not abort the mutation
        }
    }

    // ============================================================
    // PERIOD HELPERS - Delegate to ValidationUtils
    // ============================================================

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function parseNumericPeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        var parsed = Number(str);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    function parsePositivePeriod(value) {
        var parsed = parseNumericPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function isValidAcademicPeriod(value) {
        if (!hasPeriodValue(value)) {
            return false;
        }
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYearPeriod(value) {
        if (!hasPeriodValue(value)) {
            return false;
        }
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    function isValidRank(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= 1;
    }

    function isValidPeriod(period, teamType) {
        if (!hasPeriodValue(period)) {
            return false;
        }

        if (teamType === 'academic') {
            return isValidAcademicPeriod(period);
        }

        return isValidYearPeriod(period);
    }

    function getPeriodRange(teamType) {
        if (teamType === 'academic') {
            return {
                min: MIN_WEEK,
                max: MAX_WEEK,
                label: 'Week',
                minLabel: String(MIN_WEEK),
                maxLabel: String(MAX_WEEK)
            };
        }
        return {
            min: MIN_YEAR,
            max: MAX_YEAR,
            label: 'Year',
            minLabel: String(MIN_YEAR),
            maxLabel: String(MAX_YEAR)
        };
    }

    function getPeriodLabel(teamType) {
        return teamType === 'academic' ? 'Week' : 'Year';
    }

    /**
     * Compare two periods for sorting.
     * Both academic (weeks) and non-academic (years) use numeric comparison.
     * Malformed periods are filtered out before calling this function.
     * 
     * @param {string} a - First period
     * @param {string} b - Second period
     * @returns {number} Comparison result
     */
    function comparePeriods(a, b) {
        var aNum = parsePositivePeriod(a);
        var bNum = parsePositivePeriod(b);
        return aNum - bNum;
    }

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    var TeamRankings = {
        /**
         * Add a ranking entry to a team.
         * Enforces ONE ranking per period by replacing the existing entry.
         * Validates the entire ranking history before mutation.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period (week number or year)
         * @param {string|number} rank - Rank number (strict: must be a positive integer)
         * @returns {boolean} Success
         */
        addRanking: function(teamId, period, rank) {
            // Validate inputs
            if (!hasPeriodValue(period)) {
                return false;
            }

            // Strict rank validation: must be a positive integer
            if (!isValidRank(rank)) {
                return false;
            }

            var team = TeamCore.getTeam(teamId);
            if (!team) {
                return false;
            }

            // Validate period against team type
            if (!isValidPeriod(period, team.type)) {
                var range = getPeriodRange(team.type);
                return false;
            }

            // Reject malformed existing data
            if (!Array.isArray(team.rankingHistory)) {
                return false;
            }

            // Validate existing ranking entries are well-formed
            var rankingValidation = this._validateRankingHistory(team.rankingHistory, team.type);
            if (!rankingValidation.valid) {
                return false;
            }

            var periodStr = String(period).trim();
            var rankNum = parsePositivePeriod(rank);

            // Find existing entry for this period
            var existingIndex = -1;
            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && String(entry.period) === periodStr) {
                    existingIndex = i;
                    break;
                }
            }

            var oldRank = null;
            var isUpdate = existingIndex !== -1;

            if (isUpdate) {
                oldRank = team.rankingHistory[existingIndex].rank;
                team.rankingHistory[existingIndex] = {
                    period: periodStr,
                    rank: rankNum
                };
            } else {
                team.rankingHistory.push({
                    period: periodStr,
                    rank: rankNum
                });
            }

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            var teamName = team.name || 'Unknown Team';
            if (isUpdate) {
                recordActivity('Updated ranking for ' + teamName + ': #' + oldRank + ' -> #' + rank + ' (' + periodStr + ')');
            } else {
                recordActivity('Added ranking #' + rank + ' for ' + teamName + ' (' + periodStr + ')');
            }

            return true;
        },

        /**
         * Remove a ranking entry by period.
         * Removes exactly the matching entry using findIndex.
         * Validates the entire ranking history before mutation.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            if (!hasPeriodValue(period)) {
                return false;
            }

            var team = TeamCore.getTeam(teamId);
            if (!team || !team.rankingHistory) {
                return false;
            }

            // Validate existing ranking entries are well-formed (same as addRanking)
            var rankingValidation = this._validateRankingHistory(team.rankingHistory, team.type);
            if (!rankingValidation.valid) {
                return false;
            }

            var periodStr = String(period).trim();

            // Find exact entry using findIndex
            var index = -1;
            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && String(entry.period) === periodStr) {
                    index = i;
                    break;
                }
            }

            if (index === -1) {
                return false;
            }

            var removedEntry = team.rankingHistory[index];
            team.rankingHistory.splice(index, 1);

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            var teamName = team.name || 'Unknown Team';
            var rankInfo = removedEntry ? ' #' + removedEntry.rank : '';
            recordActivity('Removed ranking' + rankInfo + ' from ' + teamName + ' (' + periodStr + ')');

            return true;
        },

        /**
         * Validate ranking history entries.
         * Returns { valid: boolean, message: string }
         * 
         * @param {array} history - Ranking history array
         * @param {string} teamType - Team type for period validation
         * @returns {object} Validation result
         * @private
         */
        _validateRankingHistory: function(history, teamType) {
            if (!Array.isArray(history)) {
                return { valid: false, message: 'Ranking history must be an array.' };
            }

            var seenPeriods = {};

            for (var i = 0; i < history.length; i++) {
                var entry = history[i];
                if (!entry || typeof entry !== 'object') {
                    return {
                        valid: false,
                        message: 'Invalid ranking entry at index ' + i + '.'
                    };
                }

                var period = parsePositivePeriod(entry.period);
                if (period === null) {
                    return {
                        valid: false,
                        message: 'Invalid period format at index ' + i + '.'
                    };
                }

                // Validate period against team type
                if (teamType === 'academic') {
                    if (period < MIN_WEEK || period > MAX_WEEK) {
                        return {
                            valid: false,
                            message: 'Period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams at index ' + i + '.'
                        };
                    }
                } else {
                    if (period < MIN_YEAR || period > MAX_YEAR) {
                        return {
                            valid: false,
                            message: 'Period must be between ' + MIN_YEAR + ' and ' + MAX_YEAR + ' for non-academic teams at index ' + i + '.'
                        };
                    }
                }

                var rank = parsePositivePeriod(entry.rank);
                if (rank === null || rank < 1) {
                    return {
                        valid: false,
                        message: 'Invalid rank format at index ' + i + '.'
                    };
                }

                if (seenPeriods[period]) {
                    return {
                        valid: false,
                        message: 'Duplicate period "' + period + '" found in ranking history.'
                    };
                }
                seenPeriods[period] = true;
            }

            return { valid: true };
        },

        /**
         * Update the current rank cache based on the most recent ranking.
         * This is a MATERIALISED CACHE, refreshed on every mutation.
         * 
         * @param {object} team - Team object
         * @private
         */
        _updateCurrentRank: function(team) {
            if (!team) {
                return;
            }

            if (!team.rankingHistory || team.rankingHistory.length === 0) {
                team.currentRank = '';
                return;
            }

            var sorted = this.getSortedHistory(team);
            team.currentRank = sorted.length > 0 ? String(sorted[sorted.length - 1].rank) : '';
        },

        /**
         * Get the ranking history sorted by period.
         * Uses canonical period comparison.
         * Malformed entries are filtered out.
         * 
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedHistory: function(team) {
            if (!team || !team.rankingHistory) {
                return [];
            }
            if (!Array.isArray(team.rankingHistory)) {
                return [];
            }

            var history = [];
            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && hasPeriodValue(entry.period) && parsePositivePeriod(entry.rank) !== null) {
                    history.push(entry);
                }
            }

            history.sort(function(a, b) {
                return comparePeriods(a.period, b.period);
            });

            return history;
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
            if (!team) {
                return '';
            }
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
            if (!team) {
                return null;
            }
            var history = this.getSortedHistory(team);
            return history.length > 0 ? history[history.length - 1] : null;
        },

        /**
         * Get ranking summary for a team.
         * Returns an object with summary information.
         * 
         * @param {object} team - Team object
         * @returns {object} { total, current, mostRecent, history }
         */
        getSummary: function(team) {
            if (!team) {
                return { total: 0, current: '', mostRecent: null, history: [] };
            }

            var history = this.getSortedHistory(team);
            var total = history.length;
            var current = total > 0 ? String(history[history.length - 1].rank) : '';
            var mostRecent = total > 0 ? history[history.length - 1] : null;

            return {
                total: total,
                current: current,
                mostRecent: mostRecent,
                history: history
            };
        },

        /**
         * Check if a team has any ranking entries.
         * Uses getSortedHistory() for consistency.
         * 
         * @param {object} team - Team object
         * @returns {boolean} True if the team has rankings
         */
        hasRankings: function(team) {
            if (!team) {
                return false;
            }
            return this.getSortedHistory(team).length > 0;
        },

        /**
         * Get the rank at a specific period.
         * Returns the first matching entry if duplicates exist (should not happen).
         * 
         * @param {object} team - Team object
         * @param {string|number} period - Period to look up
         * @returns {number|null} Rank at that period, or null if not found
         */
        getRankAtPeriod: function(team, period) {
            if (!team || !team.rankingHistory) {
                return null;
            }
            if (!hasPeriodValue(period)) {
                return null;
            }

            // Validate requested period against team type
            if (!isValidPeriod(period, team.type)) {
                return null;
            }

            var periodStr = String(period).trim();

            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && String(entry.period) === periodStr && parsePositivePeriod(entry.rank) !== null) {
                    return entry.rank;
                }
            }

            return null;
        },

        /**
         * Get the change in rank between two periods.
         * 
         * @param {object} team - Team object
         * @param {string|number} fromPeriod - Starting period
         * @param {string|number} toPeriod - Ending period
         * @returns {object|null} { from, to, change } or null if either period not found
         */
        getRankChange: function(team, fromPeriod, toPeriod) {
            var from = this.getRankAtPeriod(team, fromPeriod);
            var to = this.getRankAtPeriod(team, toPeriod);

            if (from === null || to === null) {
                return null;
            }

            return {
                from: from,
                to: to,
                change: to - from
            };
        },

        /**
         * Check if a period is valid for a team type.
         * 
         * @param {string|number} period - Period to validate
         * @param {string} teamType - Team type
         * @returns {boolean} True if valid
         */
        isValidPeriod: isValidPeriod,

        /**
         * Get the valid period range for a team type.
         * 
         * @param {string} teamType - Team type
         * @returns {object} { min, max, label }
         */
        getPeriodRange: getPeriodRange,

        /**
         * Get the period label for a team type.
         * 
         * @param {string} teamType - Team type
         * @returns {string} Period label
         */
        getPeriodLabel: getPeriodLabel
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRankings = TeamRankings;

})();
