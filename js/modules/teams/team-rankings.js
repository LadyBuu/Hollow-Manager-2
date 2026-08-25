/**
 * js/modules/teams/team-rankings.js - Team Ranking Management
 * Handles team ranking history
 * Path: js/modules/teams/team-rankings.js
 */

(function() {
    'use strict';

    var TeamRankings = {
        /**
         * Add a ranking entry to a team
         * @param {string} teamId - Team ID
         * @param {string} period - Period (week block or year)
         * @param {string} rank - Rank number
         * @returns {boolean} Success
         */
        addRanking: function(teamId, period, rank) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team) return false;

            if (!team.rankingHistory) team.rankingHistory = [];

            // Check for duplicate period
            var existing = team.rankingHistory.findIndex(function(r) {
                return String(r.period) === String(period);
            });

            if (existing !== -1) {
                team.rankingHistory[existing] = { period: period, rank: rank };
            } else {
                team.rankingHistory.push({ period: period, rank: rank });
            }

            // Sort and update current rank
            this.updateCurrentRank(team);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added ranking #' + rank + ' for team: ' + team.name);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return true;
        },

        /**
         * Remove a ranking entry by period
         * @param {string} teamId - Team ID
         * @param {string} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            var team = window.TeamCore.getTeam(teamId);
            if (!team || !team.rankingHistory) return false;

            team.rankingHistory = team.rankingHistory.filter(function(r) {
                return String(r.period) !== String(period);
            });

            this.updateCurrentRank(team);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed ranking from team: ' + team.name);
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }

            return true;
        },

        /**
         * Update the current rank based on the most recent ranking
         * @param {object} team - Team object
         */
        updateCurrentRank: function(team) {
            if (!team || !team.rankingHistory || team.rankingHistory.length === 0) {
                team.currentRank = '';
                return;
            }

            var sorted = team.rankingHistory.slice().sort(function(a, b) {
                if (team.type === 'academic') {
                    return parseInt(a.period) - parseInt(b.period);
                }
                return String(a.period).localeCompare(String(b.period));
            });

            team.currentRank = sorted[sorted.length - 1].rank;
        },

        /**
         * Render ranking history for a team
         * @param {object} team - Team object
         * @returns {string} HTML string
         */
        renderList: function(team) {
            if (!team || !team.rankingHistory || team.rankingHistory.length === 0) {
                return '<p class="empty-state">No ranking history</p>';
            }

            var periodLabel = team.type === 'academic' ? 'Weeks' : 'Period';
            var html = '';
            var sorted = team.rankingHistory.slice().sort(function(a, b) {
                return parseInt(a.period) - parseInt(b.period);
            });

            sorted.forEach(function(entry) {
                var blockDisplay = '';
                if (team.type === 'academic') {
                    var block = window.getRankingBlock(entry.period);
                    if (block) blockDisplay = ' (Wk ' + block.label + ')';
                    else blockDisplay = ' (Wk ' + entry.period + ')';
                } else {
                    blockDisplay = ' (' + entry.period + ')';
                }
                html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">' +
                    '<span><strong>#' + entry.rank + '</strong> - ' + periodLabel + blockDisplay + '</span>' +
                    '<button class="small danger remove-ranking" data-period="' + entry.period + '">Remove</button>' +
                    '</div>';
            });

            return html;
        },

        /**
         * Get the ranking history sorted
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedHistory: function(team) {
            if (!team || !team.rankingHistory) return [];
            return team.rankingHistory.slice().sort(function(a, b) {
                return parseInt(a.period) - parseInt(b.period);
            });
        }
    };

    window.TeamRankings = TeamRankings;

})();
