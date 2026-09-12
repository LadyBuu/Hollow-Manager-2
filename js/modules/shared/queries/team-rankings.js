/**
 * shared/queries/team-rankings.js - Team Ranking Queries
 * Read-only team ranking queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 *   - Uses TeamConstants for type/period validation
 *   - Returns LIVE REFERENCES to ranking data - do not mutate
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Year-based team types (professional, temporary, civilian)
 *     accept any integer >= 1 as a valid period.
 *   - Academic teams still use bounded weeks (1-52).
 *   - Bounds checks go through TeamConstants.getPeriodBounds,
 *     which returns { min: 1, max: Infinity } for year-based types.
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var TR = window.TeamRankings;
 *   var history = TR.getSortedRankings(team);
 *   var rank = TR.getCurrentRank(team);
 *   var summary = TR.getRankingSummary(team);
 */

(function() {
    'use strict';

    if (window.__teamRankingsLoaded) {
        return;
    }
    window.__teamRankingsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TeamConstants = window.TeamConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamConstants) {
            missing.push('TeamConstants');
        }

        if (missing.length > 0) {
            console.warn('[TeamRankings] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // DATA ACCESS
    // ============================================================

    function getTeamById(teamId) {
        if (!teamId) {
            return null;
        }
        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];
        var target = String(teamId);

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    // ============================================================
    // PERIOD HELPERS
    // ============================================================

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

    function parseRank(value) {
        var num = parseNumericPeriod(value);
        return (num !== null && num >= 1) ? num : null;
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    /**
     * Validate a ranking entry.
     * 
     * SEMANTICS:
     *   - period must be a positive integer, and in bounds for the
     *     team type (weeks 1-52 for academic, any integer >= 1 for
     *     year-based types).
     *   - rank must be a positive integer >= 1.
     * 
     * @param {object} entry - Ranking entry
     * @param {string} teamType - Team type for validation
     * @returns {object} { valid: boolean, message: string, period: number|null, rank: number|null }
     */
    function validateRankingEntry(entry, teamType) {
        if (!entry || typeof entry !== 'object') {
            return { valid: false, message: 'Invalid ranking entry.', period: null, rank: null };
        }

        var period = parseNumericPeriod(entry.period);
        if (period === null) {
            return { valid: false, message: 'Invalid period format.', period: null, rank: null };
        }

        var rank = parseRank(entry.rank);
        if (rank === null || rank < 1) {
            return { valid: false, message: 'Invalid rank format.', period: null, rank: null };
        }

        // Validate period against team type
        var range = TeamConstants.getPeriodBounds(teamType);
        if (period < range.min || period > range.max) {
            return {
                valid: false,
                message: 'Period is out of bounds for team type.',
                period: period,
                rank: rank
            };
        }

        return { valid: true, message: '', period: period, rank: rank };
    }

    // ============================================================
    // RANKING QUERIES
    // ============================================================

    /**
     * Get sorted ranking history for a team.
     * Malformed entries are filtered out.
     * 
     * @param {object} team - Team object
     * @returns {array} Sorted ranking history
     */
    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (entry && parseNumericPeriod(entry.period) !== null && parseRank(entry.rank) !== null) {
                history.push(entry);
            }
        }

        history.sort(function(a, b) {
            var aNum = parseNumericPeriod(a.period);
            var bNum = parseNumericPeriod(b.period);
            return aNum - bNum;
        });

        return history;
    }

    /**
     * Get the current rank for a team.
     * Recalculates from history rather than trusting cache.
     * 
     * @param {object} team - Team object
     * @returns {string} Current rank (empty string if none)
     */
    function getCurrentRank(team) {
        if (!team) {
            return '';
        }
        var history = getSortedRankings(team);
        return history.length > 0 ? String(history[history.length - 1].rank) : '';
    }

    /**
     * Get the most recent ranking entry for a team.
     * 
     * @param {object} team - Team object
     * @returns {object|null} Most recent ranking entry or null
     */
    function getMostRecentRanking(team) {
        if (!team) {
            return null;
        }
        var history = getSortedRankings(team);
        return history.length > 0 ? history[history.length - 1] : null;
    }

    /**
     * Get the rank at a specific period.
     * 
     * @param {object} team - Team object
     * @param {string|number} period - Period to look up
     * @returns {number|null} Rank at that period, or null if not found
     */
    function getRankAtPeriod(team, period) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return null;
        }

        var periodNum = parseNumericPeriod(period);
        if (periodNum === null) {
            return null;
        }

        var periodStr = String(periodNum);

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (entry && String(entry.period) === periodStr) {
                var rank = parseRank(entry.rank);
                if (rank !== null) {
                    return rank;
                }
            }
        }

        return null;
    }

    /**
     * Get the change in rank between two periods.
     * 
     * @param {object} team - Team object
     * @param {string|number} fromPeriod - Starting period
     * @param {string|number} toPeriod - Ending period
     * @returns {object|null} { from, to, change } or null if either period not found
     */
    function getRankChange(team, fromPeriod, toPeriod) {
        var from = getRankAtPeriod(team, fromPeriod);
        var to = getRankAtPeriod(team, toPeriod);

        if (from === null || to === null) {
            return null;
        }

        return {
            from: from,
            to: to,
            change: to - from
        };
    }

    /**
     * Check if a team has any ranking entries.
     * 
     * @param {object} team - Team object
     * @returns {boolean} True if the team has rankings
     */
    function hasRankings(team) {
        if (!team) {
            return false;
        }
        return getSortedRankings(team).length > 0;
    }

    /**
     * Get ranking summary for a team.
     * 
     * @param {object} team - Team object
     * @returns {object} { total, current, mostRecent, history }
     */
    function getRankingSummary(team) {
        if (!team) {
            return { total: 0, current: '', mostRecent: null, history: [] };
        }

        var history = getSortedRankings(team);
        var total = history.length;
        var current = total > 0 ? String(history[history.length - 1].rank) : '';
        var mostRecent = total > 0 ? history[history.length - 1] : null;

        return {
            total: total,
            current: current,
            mostRecent: mostRecent,
            history: history
        };
    }

    /**
     * Get team rank display string.
     * 
     * @param {object} team - Team object
     * @returns {string} Rank display string
     */
    function getRankDisplay(team) {
        var rank = getCurrentRank(team);
        return rank || '-';
    }

    /**
     * Get ranking history as a formatted list.
     * 
     * @param {object} team - Team object
     * @returns {string} Formatted ranking history string
     */
    function getRankingHistoryDisplay(team) {
        if (!team || !hasRankings(team)) {
            return 'No ranking history';
        }

        var history = getSortedRankings(team);
        var parts = [];

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            parts.push(entry.period + ': #' + entry.rank);
        }

        return parts.join(' → ');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRankings = {
        // Queries
        getSortedRankings: getSortedRankings,
        getCurrentRank: getCurrentRank,
        getMostRecentRanking: getMostRecentRanking,
        getRankAtPeriod: getRankAtPeriod,
        getRankChange: getRankChange,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary,

        // Display helpers
        getRankDisplay: getRankDisplay,
        getRankingHistoryDisplay: getRankingHistoryDisplay,

        // Validation
        validateRankingEntry: validateRankingEntry,

        // Period helpers
        parseNumericPeriod: parseNumericPeriod,
        parseRank: parseRank,

        // Constants
        MIN_WEEK: TeamConstants.MIN_WEEK,
        MAX_WEEK: TeamConstants.MAX_WEEK
    };

})();