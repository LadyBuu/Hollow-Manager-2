/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 *   - Uses TeamConstants for type and status validation
 *   - Returns LIVE REFERENCES to team data - do not mutate
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Year-based team types (professional, temporary, civilian)
 *     accept any integer >= 1 as a valid period.
 *   - Academic teams still use bounded weeks (1-52).
 *   - Bounds checks go through TeamConstants.getPeriodRange,
 *     which returns { min: 1, max: Infinity } for year-based types.
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var TQ = window.TeamQueries;
 *   var team = TQ.getTeamById('team_123');
 *   var teams = TQ.getTeams('professional', 'active');
 *   var members = TQ.getActiveTeamMembers(team, 5);
 *   var active = TQ.isTeamActiveAtPeriod(team, 2025);
 */

(function() {
    'use strict';

    if (window.__teamQueriesLoaded) {
        return;
    }
    window.__teamQueriesLoaded = true;

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
            console.warn('[TeamQueries] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // DATA ACCESS
    // ============================================================

    function getTeamData() {
        var data = window.data || {};
        return Array.isArray(data.teams) ? data.teams : [];
    }

    function getTeamIndex(teamId) {
        if (!teamId) {
            return -1;
        }
        var target = String(teamId);
        var teams = getTeamData();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return i;
            }
        }
        return -1;
    }

    // ============================================================
    // TEAM LOOKUP
    // ============================================================

    function getTeamById(teamId) {
        if (!teamId) {
            return null;
        }
        var target = String(teamId);
        var teams = getTeamData();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    function getTeamName(teamId) {
        if (!teamId) {
            return 'Unassigned';
        }
        var team = getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    // ============================================================
    // TEAM PREDICATES - Uses TeamConstants
    // ============================================================

    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        if (!team.status) {
            return true;
        }
        return team.status !== 'deleted';
    }

    function isTeamActive(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        return team.status === 'active';
    }

    function isValidTeamStatus(status) {
        return TeamConstants.isValidTeamStatus(status);
    }

    function normalizeTeamType(type) {
        return TeamConstants.normalizeTeamType(type);
    }

    function getTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
    }

    function isAcademicType(type) {
        return TeamConstants.isAcademicType(type);
    }

    function isValidPeriod(period, type) {
        return TeamConstants.isValidPeriod(period, type);
    }

    function getPeriodRange(type) {
        return TeamConstants.getPeriodRange(type);
    }

    /**
     * Check if a team is active at a given period.
     * This is a PURE read operation - no domain rules, just checking dates.
     * 
     * SEMANTICS:
     *   - Academic teams: period is a week (1-52).
     *   - Non-academic teams: period is a year (any integer >= 1).
     *   - Periods outside the type's range are rejected.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Period to check
     * @returns {boolean} True if active
     */
    function isTeamActiveAtPeriod(team, period) {
        if (!team || typeof team !== 'object') {
            return false;
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 0) {
            return false;
        }

        // Validate period against team type
        var range = getPeriodRange(team.type);
        if (periodNum < range.min || periodNum > range.max) {
            return false;
        }

        var start = parseInt(team.startPeriod, 10);
        var end = parseInt(team.endPeriod, 10);

        var hasStart = team.startPeriod !== undefined && team.startPeriod !== null && team.startPeriod !== '';
        var hasEnd = team.endPeriod !== undefined && team.endPeriod !== null && team.endPeriod !== '';

        if (hasStart && isNaN(start)) {
            return false;
        }
        if (hasEnd && isNaN(end)) {
            return false;
        }

        var started = !hasStart || start <= periodNum;
        var notEnded = !hasEnd || end >= periodNum;

        return started && notEnded;
    }

    // ============================================================
    // TEAM LISTS
    // ============================================================

    function getTeams(type, status, includeDeleted) {
        var teams = getTeamData();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object') {
                result.push(team);
            }
        }

        if (type) {
            var normalizedType = normalizeTeamType(type);
            if (normalizedType === null) {
                return [];
            }
            var filtered = [];
            for (var j = 0; j < result.length; j++) {
                var t = result[j];
                if (normalizeTeamType(t.type) === normalizedType) {
                    filtered.push(t);
                }
            }
            result = filtered;
        }

        if (status === 'active') {
            var filtered2 = [];
            for (var k = 0; k < result.length; k++) {
                if (isTeamActive(result[k])) {
                    filtered2.push(result[k]);
                }
            }
            result = filtered2;
        } else if (status === 'operational') {
            var filtered3 = [];
            for (var l = 0; l < result.length; l++) {
                if (isTeamOperational(result[l])) {
                    filtered3.push(result[l]);
                }
            }
            result = filtered3;
        }

        if (!includeDeleted) {
            var filtered4 = [];
            for (var m = 0; m < result.length; m++) {
                if (result[m].status !== 'deleted') {
                    filtered4.push(result[m]);
                }
            }
            result = filtered4;
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function getAllOperationalTeams() {
        return getTeams(null, 'operational', false);
    }

    function getAllActiveTeams() {
        return getTeams(null, 'active', false);
    }

    function getTeamsByType(type, status) {
        return getTeams(type, status || 'operational', false);
    }

    function getTeamsByClass(classId, status) {
        if (!classId) {
            return [];
        }
        var teams = getTeams(null, status || 'operational', false);
        var target = String(classId);
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && team.type === 'academic' && String(team.classId) === target) {
                result.push(team);
            }
        }
        return result;
    }

    /**
     * Get teams filtered by period (year/week).
     * 
     * @param {string} type - Team type filter
     * @param {number|string} period - Period to filter by
     * @param {string} status - Status filter
     * @returns {array} Filtered teams
     */
    function getTeamsByPeriod(type, period, status) {
        var teams = getTeams(type, status, false);
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (isTeamActiveAtPeriod(team, period)) {
                result.push(team);
            }
        }

        return result;
    }

    // ============================================================
    // MEMBERSHIP QUERIES
    // ============================================================

    /**
     * Get active members of a team at a given period.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Period to check
     * @returns {array} Array of active members
     */
    function getActiveTeamMembers(team, period) {
        if (!team || !Array.isArray(team.members)) {
            return [];
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 0) {
            return [];
        }

        // Validate period against team type
        var range = getPeriodRange(team.type);
        if (periodNum < range.min || periodNum > range.max) {
            return [];
        }

        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }

            var join = parseInt(member.joinPeriod, 10);
            var leave = parseInt(member.leavePeriod, 10);

            var hasJoin = member.joinPeriod !== undefined &&
                          member.joinPeriod !== null &&
                          member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined &&
                           member.leavePeriod !== null &&
                           member.leavePeriod !== '';

            if (hasJoin && isNaN(join)) {
                continue;
            }
            if (hasLeave && isNaN(leave)) {
                continue;
            }

            // Validate join/leave against team type bounds
            if (hasJoin && (join < range.min || join > range.max)) {
                continue;
            }
            if (hasLeave && (leave < range.min || leave > range.max)) {
                continue;
            }

            var joined = !hasJoin || join <= periodNum;
            var notLeft = !hasLeave || leave >= periodNum;

            if (joined && notLeft) {
                result.push(member);
            }
        }

        return result;
    }

    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    function isCharacterInTeamAtPeriod(team, characterId, period) {
        if (!team || !characterId) {
            return false;
        }
        var members = getActiveTeamMembers(team, period);
        var target = String(characterId);
        for (var i = 0; i < members.length; i++) {
            if (members[i] && String(members[i].characterId) === target) {
                return true;
            }
        }
        return false;
    }

    function getTeamMember(team, characterId) {
        if (!team || !Array.isArray(team.members)) {
            return null;
        }
        var target = String(characterId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object' && String(member.characterId) === target) {
                return member;
            }
        }
        return null;
    }

    /**
     * Get teams a character belongs to at a given period.
     * 
     * @param {string} characterId - Character ID
     * @param {number|string} period - Period to check
     * @param {string} teamType - Optional team type filter
     * @returns {array} Array of teams
     */
    function getTeamsForCharacter(characterId, period, teamType) {
        if (!characterId) {
            return [];
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 0) {
            return [];
        }

        var teams = getTeamData();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }
            if (!isTeamOperational(team)) {
                continue;
            }

            if (teamType) {
                var normalizedType = normalizeTeamType(teamType);
                if (normalizedType !== null && normalizeTeamType(team.type) !== normalizedType) {
                    continue;
                }
            }

            // Validate period against team type
            var range = getPeriodRange(team.type);
            if (periodNum < range.min || periodNum > range.max) {
                continue;
            }

            if (isCharacterInTeamAtPeriod(team, characterId, periodNum)) {
                result.push(team);
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function getCharacterTeamMembership(teamId, characterId) {
        var team = getTeamById(teamId);
        if (!team) {
            return null;
        }
        return getTeamMember(team, characterId);
    }

    // ============================================================
    // PERIOD DISPLAY
    // ============================================================

    function getTeamPeriodDisplay(team) {
        if (!team) {
            return '-';
        }

        var normalizedType = normalizeTeamType(team.type);
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (normalizedType === 'academic') {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            }
            if (start) {
                return 'From Wk ' + start;
            }
            return '-';
        } else {
            if (start && end) {
                return start + ' - ' + end;
            }
            if (start) {
                return 'From ' + start;
            }
            return '-';
        }
    }

    // ============================================================
    // FILTER HELPERS (moved from team-filters.js)
    // ============================================================

    /**
     * Filter teams by year interval overlap.
     * 
     * NOTE: The literal bounds check here (1900-2100) is retained as a
     * sanity guard on the INPUT year, not as a constraint on team data.
     * Passing a nonsense year to this filter returns the list unchanged
     * rather than silently returning an empty array. If you want to
     * remove even this guard, change the `if` to a simple isNaN check.
     * 
     * @param {array} teams - Array of team objects
     * @param {number|string} year - Year to filter by
     * @returns {array} Filtered teams
     */
    function filterTeamsByYear(teams, year) {
        if (!Array.isArray(teams)) {
            return [];
        }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            return teams.slice();
        }

        return teams.filter(function(team) {
            return isTeamActiveAtPeriod(team, yearNum);
        });
    }

    /**
     * Filter teams by status.
     * 
     * @param {array} teams - Array of team objects
     * @param {string} status - 'active' or 'inactive'
     * @returns {array} Filtered teams
     */
    function filterTeamsByStatus(teams, status) {
        if (!Array.isArray(teams)) {
            return [];
        }

        if (status === 'active') {
            return teams.filter(function(team) {
                return team.status === 'active';
            });
        }

        if (status === 'inactive') {
            return teams.filter(function(team) {
                return team.status === 'deprecated' || team.status === 'inactive';
            });
        }

        return teams.slice();
    }

    // ============================================================
    // RANKING QUERIES (moved from team-rankings.js)
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

    function getCurrentRank(team) {
        if (!team) {
            return '';
        }
        var history = getSortedRankings(team);
        return history.length > 0 ? String(history[history.length - 1].rank) : '';
    }

    function getMostRecentRanking(team) {
        if (!team) {
            return null;
        }
        var history = getSortedRankings(team);
        return history.length > 0 ? history[history.length - 1] : null;
    }

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

    function hasRankings(team) {
        if (!team) {
            return false;
        }
        return getSortedRankings(team).length > 0;
    }

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

    function getRankDisplay(team) {
        var rank = getCurrentRank(team);
        return rank || '-';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamQueries = {
        // Team lookup
        getTeamById: getTeamById,
        getTeamName: getTeamName,
        getTeamIndex: getTeamIndex,

        // Predicates
        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isValidTeamStatus: isValidTeamStatus,
        normalizeTeamType: normalizeTeamType,
        getTypeLabel: getTypeLabel,
        getPeriodLabel: getPeriodLabel,
        isAcademicType: isAcademicType,
        isValidPeriod: isValidPeriod,
        getPeriodRange: getPeriodRange,
        isTeamActiveAtPeriod: isTeamActiveAtPeriod,

        // Lists
        getTeams: getTeams,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getTeamsByType: getTeamsByType,
        getTeamsByClass: getTeamsByClass,
        getTeamsByPeriod: getTeamsByPeriod,

        // Membership
        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,
        isCharacterInTeamAtPeriod: isCharacterInTeamAtPeriod,
        getTeamMember: getTeamMember,
        getTeamsForCharacter: getTeamsForCharacter,
        getCharacterTeamMembership: getCharacterTeamMembership,

        // Display
        getTeamPeriodDisplay: getTeamPeriodDisplay,

        // Filters (from team-filters.js)
        filterTeamsByYear: filterTeamsByYear,
        filterTeamsByStatus: filterTeamsByStatus,

        // Rankings (from team-rankings.js)
        getSortedRankings: getSortedRankings,
        getCurrentRank: getCurrentRank,
        getMostRecentRanking: getMostRecentRanking,
        getRankAtPeriod: getRankAtPeriod,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary,
        getRankDisplay: getRankDisplay,
        parseNumericPeriod: parseNumericPeriod,
        parseRank: parseRank
    };

})();