/**
 * js/modules/teams/team-rankings.js - Team Ranking Management
 * Handles team ranking history
 * Path: js/modules/teams/team-rankings.js
 * 
 * This module is responsible for:
 *   - Adding ranking entries to teams
 *   - Removing ranking entries from teams
 *   - Maintaining the currentRank cache
 *   - Rendering ranking lists (returns HTML)
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
 *   - "Arbitrary sortable strings" are NOT supported - periods must be numeric
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
 *   - window.CALENDAR_CONSTANTS - Week/year constants (from constants.js)
 *   - window.DomUtils - HTML escaping (from dom-utils.js)
 *   - window.ValidationUtils - Period parsing (from validation-utils.js)
 *   - window.ActivityLog - Activity logging (from activity-log.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamRankingsLoaded) {
        return;
    }

    if (!window.TeamCore) {
        console.error('TeamRankings: TeamCore is required but not loaded.');
        return;
    }

    if (!window.TeamQueries) {
        console.error('TeamRankings: TeamQueries is required but not loaded.');
        return;
    }

    window.__teamRankingsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var DomUtils = window.DomUtils || window;
    var ValidationUtils = window.ValidationUtils || window;
    var ActivityLog = window.ActivityLog || window;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
    var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // ACTIVITY LOGGING - Uses ActivityLog
    // ============================================================

    function recordActivity(message) {
        try {
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (err) {
            // Swallow logging errors
        }
    }

    // ============================================================
    // PERIOD HELPERS - Delegate to ValidationUtils
    // ============================================================

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function getPeriodLabel(teamType) {
        return teamType === 'academic' ? 'Week' : 'Year';
    }

    function getPeriodDisplay(period) {
        if (!hasPeriodValue(period)) return '?';
        return String(period).trim();
    }

    function parseNumericPeriod(value) {
        if (ValidationUtils && typeof ValidationUtils.parseStrictPositivePeriod === 'function') {
            return ValidationUtils.parseStrictPositivePeriod(value);
        }
        // Fallback
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
        if (!hasPeriodValue(value)) return false;
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYearPeriod(value) {
        if (!hasPeriodValue(value)) return false;
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    function isValidRank(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= 1;
    }

    /**
     * Compare two periods for sorting.
     * Both academic (weeks) and non-academic (years) use numeric comparison.
     * 
     * @param {string} a - First period
     * @param {string} b - Second period
     * @returns {number} Comparison result
     */
    function comparePeriods(a, b) {
        var aNum = parseNumericPeriod(a);
        var bNum = parseNumericPeriod(b);

        if (aNum !== null && bNum !== null) {
            return aNum - bNum;
        }

        // Fallback to string comparison if not numeric
        return String(a).localeCompare(String(b), undefined, { numeric: true });
    }

    /**
     * Validate a period for a team type.
     * Academic: must be 1-52
     * Non-academic: must be 1900-2100
     * 
     * @param {string|number} period - Period to validate
     * @param {string} teamType - Team type
     * @returns {boolean} True if valid
     */
    function isValidPeriod(period, teamType) {
        if (!hasPeriodValue(period)) return false;

        if (teamType === 'academic') {
            return isValidAcademicPeriod(period);
        }

        return isValidYearPeriod(period);
    }

    /**
     * Get the valid period range for a team type.
     * 
     * @param {string} teamType - Team type
     * @returns {object} { min, max, label }
     */
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

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    var TeamRankings = {
        /**
         * Add a ranking entry to a team.
         * Enforces ONE ranking per period by removing all existing entries for the period.
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
                console.warn('TeamRankings.addRanking: Period is required.');
                return false;
            }

            // Strict rank validation: must be a positive integer
            if (!isValidRank(rank)) {
                console.warn('TeamRankings.addRanking: Rank must be a positive integer.');
                return false;
            }

            var team = TeamCore.getTeam(teamId);
            if (!team) {
                console.warn('TeamRankings.addRanking: Team not found.');
                return false;
            }

            // Validate period against team type
            if (!isValidPeriod(period, team.type)) {
                var range = getPeriodRange(team.type);
                console.warn('TeamRankings.addRanking: Period must be ' + range.minLabel + '-' + range.maxLabel + ' for ' + range.label + ' (' + team.type + ').');
                return false;
            }

            // Reject malformed existing data
            if (!Array.isArray(team.rankingHistory)) {
                console.warn('TeamRankings.addRanking: Ranking history data is malformed.');
                return false;
            }

            // Validate existing ranking entries are well-formed
            var rankingValidation = this._validateRankingHistory(team.rankingHistory);
            if (!rankingValidation.valid) {
                console.warn('TeamRankings.addRanking: Ranking history contains malformed entries:', rankingValidation.message);
                return false;
            }

            var periodStr = String(period).trim();
            var rankNum = parsePositivePeriod(rank);

            // Enforce ONE ranking per period: remove ALL existing entries for this period
            var existingEntries = team.rankingHistory.filter(function(r) {
                return r && String(r.period) === periodStr;
            });

            // Use findIndex to remove exactly the matching entries (should be 0 or 1)
            for (var i = team.rankingHistory.length - 1; i >= 0; i--) {
                var r = team.rankingHistory[i];
                if (r && String(r.period) === periodStr) {
                    team.rankingHistory.splice(i, 1);
                }
            }

            var oldRank = existingEntries.length > 0 ? existingEntries[0].rank : null;
            var isUpdate = existingEntries.length > 0;

            // Add the new canonical entry
            team.rankingHistory.push({
                period: periodStr,
                rank: rankNum
            });

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            var teamName = team.name || 'Unknown Team';
            if (isUpdate) {
                recordActivity('Updated ranking for ' + teamName + ': #' + oldRank + ' → #' + rank + ' (' + periodStr + ')');
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
                console.warn('TeamRankings.removeRanking: Period is required.');
                return false;
            }

            var team = TeamCore.getTeam(teamId);
            if (!team || !team.rankingHistory) {
                console.warn('TeamRankings.removeRanking: Team or ranking history not found.');
                return false;
            }

            // Validate existing ranking entries are well-formed (same as addRanking)
            var rankingValidation = this._validateRankingHistory(team.rankingHistory);
            if (!rankingValidation.valid) {
                console.warn('TeamRankings.removeRanking: Ranking history contains malformed entries:', rankingValidation.message);
                return false;
            }

            var periodStr = String(period).trim();

            // Find exact entry using findIndex
            var index = team.rankingHistory.findIndex(function(r) {
                return r && String(r.period) === periodStr;
            });

            if (index === -1) {
                console.warn('TeamRankings.removeRanking: Period "' + periodStr + '" not found.');
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
         * @returns {object} Validation result
         * @private
         */
        _validateRankingHistory: function(history) {
            if (!Array.isArray(history)) {
                return { valid: false, message: 'Ranking history must be an array.' };
            }

            var seenPeriods = {};

            for (var i = 0; i < history.length; i++) {
                var r = history[i];
                if (!r || typeof r !== 'object') {
                    return {
                        valid: false,
                        message: 'Invalid ranking entry at index ' + i + '.'
                    };
                }

                var period = parseNumericPeriod(r.period);
                if (period === null) {
                    return {
                        valid: false,
                        message: 'Invalid period format at index ' + i + '.'
                    };
                }

                var rank = parseNumericPeriod(r.rank);
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
         * Uses canonical period comparison.
         * Malformed entries are filtered out.
         * 
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedHistory: function(team) {
            if (!team || !team.rankingHistory) return [];
            if (!Array.isArray(team.rankingHistory)) return [];

            var history = team.rankingHistory.slice().filter(function(r) {
                return r && hasPeriodValue(r.period) && parsePositivePeriod(r.rank) !== null;
            });

            return history.sort(function(a, b) {
                return comparePeriods(a.period, b.period);
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
            if (!team) return false;
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
            if (!team || !team.rankingHistory) return null;
            if (!hasPeriodValue(period)) return null;

            var periodStr = String(period).trim();
            var entries = team.rankingHistory.filter(function(r) {
                return r && String(r.period) === periodStr && parsePositivePeriod(r.rank) !== null;
            });

            if (entries.length === 0) return null;
            if (entries.length > 1) {
                console.warn('TeamRankings.getRankAtPeriod: Duplicate periods found for "' + periodStr + '". Using first entry.');
            }
            return entries[0].rank;
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
        getPeriodLabel: getPeriodLabel,

        // ============================================================
        // RENDERING - Returns HTML string
        // ============================================================

        /**
         * Render ranking list for a team.
         * PURE: Returns HTML string. Does NOT mutate data or DOM.
         * 
         * @param {object} team - Team object
         * @returns {string} HTML string
         */
        renderList: function(team) {
            if (!team) {
                return '<p class="empty-state">No team provided.</p>';
            }

            var rankings = this.getSortedHistory(team);

            if (rankings.length === 0) {
                return '<p class="empty-state">No ranking history</p>';
            }

            var html = '';
            var periodLabel = getPeriodLabel(team.type);

            rankings.forEach(function(entry) {
                var periodDisplay = entry.period;
                var rankDisplay = entry.rank;

                html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
                html += '<span><strong>#' + escapeHtml(rankDisplay) + '</strong> - ' + escapeHtml(periodLabel) + ' ' + escapeHtml(periodDisplay) + '</span>';
                html += '<button class="small danger remove-ranking" data-period="' + escapeHtml(entry.period) + '" style="padding:2px 8px;font-size:0.65rem;">Remove</button>';
                html += '</div>';
            });

            return html;
        },

        /**
         * Render a ranking summary for a team (compact view).
         * 
         * @param {object} team - Team object
         * @returns {string} HTML string
         */
        renderSummary: function(team) {
            if (!team) {
                return '<span class="ranking-summary">No team</span>';
            }

            var summary = this.getSummary(team);

            if (summary.total === 0) {
                return '<span class="ranking-summary no-rankings">No rankings</span>';
            }

            var periodLabel = getPeriodLabel(team.type);

            return '<span class="ranking-summary">#' + escapeHtml(summary.current) + ' (last ' + escapeHtml(periodLabel) + ' ' + escapeHtml(summary.mostRecent ? summary.mostRecent.period : '') + ')</span>';
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRankings = TeamRankings;

})();
