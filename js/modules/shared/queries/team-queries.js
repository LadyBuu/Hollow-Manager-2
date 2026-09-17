/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries.
 *
 * Path: js/modules/shared/queries/team-queries.js
 *
 * This module provides the canonical read surface for the Team
 * domain:
 *   - Team lookup (by ID, by type, by class, by period)
 *   - Membership queries (active members at a period, character
 *     membership, character's teams)
 *   - Ranking queries (sorted history, current rank, rank at period,
 *     summary)
 *
 * IMPORTANT:
 *   - READ ONLY. This module never mutates.
 *   - Public reads return DEEP CLONES. No live reference escapes.
 *   - Period input goes through TeamConstants.parsePeriod. Invalid
 *     periods are rejected, not coerced.
 *   - Status and type semantics are owned by TeamConstants. This
 *     module validates against TeamConstants, it does not
 *     reimplement.
 *   - No presentation strings. Display text (type labels, period
 *     ranges, rank displays) belongs to TeamAggregator.
 *   - No mutations, no persistence, no UI dependencies, no DOM.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - Academic teams use bounded weeks (1-52), sourced from
 *     CalendarConstants via TeamConstants.
 *   - Non-academic teams accept any integer >= 1.
 *
 * OPERATIONAL SEMANTICS:
 *   A team is "operational" when it can still be operated on.
 *   Deprecated teams are excluded. Inactive teams are included,
 *   because inactive means "temporarily not running", not "retired".
 *   The distinction matters: inactive teams can be reactivated,
 *   deprecated teams cannot.
 *
 *       status === 'active'   -> operational
 *       status === 'inactive' -> operational
 *       status === 'deprecated' -> NOT operational
 *
 *   `getActiveTeams()` and `getAllActiveTeams()` filter to
 *   status === 'active' only.
 *
 *   `getOperationalTeams()` and `getAllOperationalTeams()` filter to
 *   active + inactive.
 *
 * RANKING SEMANTICS:
 *   Ranking history lives on the team entity as `rankingHistory`,
 *   an array of { period, rank }. This is Team-domain ranking, not
 *   Academy student ranking. They are separate concepts and are not
 *   merged.
 *
 *   The canonical form of a period is a numeric string
 *   ('1', '2', '42'). Persisted records may contain legacy formats;
 *   reads parse them, writes canonicalise them (via TeamCore).
 *
 *   `getCurrentRank()` is derived from `rankingHistory`. It is NOT
 *   a persisted field. Persisting it would create two sources of
 *   truth, and one of them would go stale.
 *
 * MEMBERSHIP SEMANTICS (v24):
 *   [FIX-Q1] getActiveTeamMembers now checks the team's OWN window
 *   (startPeriod / endPeriod) in addition to the member's window
 *   (joinPeriod / leavePeriod). A team whose own window does not
 *   contain the queried period has NO active members at that
 *   period, regardless of what the member entries say.
 *
 *   This is the "team ends, members are freed" rule. Without this
 *   check, a member of a team that ran weeks 1-10 was still
 *   reported active at week 11, and the Academy aggregator's
 *   sibling scan would incorrectly exclude them from the candidate
 *   pool of any other team.
 *
 *   The change is a pure subtraction: it can only remove members
 *   from the returned list, never add them. Every caller that
 *   previously got "member is active at week N" for a closed team
 *   is now corrected.
 *
 * DEPENDENCIES:
 *   - window.data          (canonical state) - reads directly
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 *   - window.ObjectUtils   (from object-utils.js) - MANDATORY
 *     (for deepClone)
 *
 * USAGE:
 *   var TQ = window.TeamQueries;
 *   var team = TQ.getTeamById('team_123');
 *   var teams = TQ.getTeams('professional', 'active');
 *   var members = TQ.getActiveTeamMembers(team, 5);
 *   var active = TQ.isTeamActiveAtPeriod(team, 2025);
 *   var rank = TQ.getCurrentRank(team);
 */

(function() {
    'use strict';

    if (window.__teamQueriesLoaded) {
        return;
    }
    window.__teamQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamConstants = window.TeamConstants;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamConstants) {
            missing.push('TeamConstants');
        } else {
            var requiredConstants = [
                'parsePeriod',
                'isValidTeamStatus',
                'isValidTeamType',
                'normalizeTeamType',
                'getPeriodRange'
            ];
            for (var i = 0; i < requiredConstants.length; i++) {
                if (typeof TeamConstants[requiredConstants[i]] !== 'function') {
                    missing.push('TeamConstants.' + requiredConstants[i]);
                }
            }
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('[TeamQueries] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Deep-clone a value for return to the caller.
     *
     * Wraps ObjectUtils.deepClone with an aliasing guard. If the
     * clone aliases the input, that is a bug in ObjectUtils and we
     * surface it here rather than silently returning a live
     * reference.
     */
    function clone(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        var result = ObjectUtils.deepClone(value);
        if (result === value) {
            throw new Error(
                '[TeamQueries] ObjectUtils.deepClone returned the original reference. ' +
                'Read safety is broken.'
            );
        }
        return result;
    }

    /**
     * Parse a period value via the canonical parser.
     * Returns a positive integer or null.
     */
    function parsePeriod(value) {
        if (typeof TeamConstants.parsePeriod !== 'function') {
            return null;
        }
        return TeamConstants.parsePeriod(value);
    }

    /**
     * Is the given status one of the operational statuses?
     */
    function isOperationalStatus(status) {
        return status === 'active' || status === 'inactive';
    }

    /**
     * Does the team's own window contain the given period?
     *
     * The team window is startPeriod (inclusive) to endPeriod
     * (inclusive). Absent bounds are unbounded on that side.
     *
     * Returns true when either bound is missing/invalid in a way
     * that would make containment undecidable — the caller of this
     * helper has already established the period itself is valid.
     *
     * @param {object} team
     * @param {number} periodNum - already-parsed integer
     * @returns {boolean}
     */
    function teamWindowContains(team, periodNum) {
        if (!team || typeof team !== 'object') {
            return false;
        }

        var hasStart = team.startPeriod !== undefined &&
                       team.startPeriod !== null &&
                       team.startPeriod !== '';
        var hasEnd = team.endPeriod !== undefined &&
                     team.endPeriod !== null &&
                     team.endPeriod !== '';

        if (hasStart) {
            var start = parsePeriod(team.startPeriod);
            if (start === null) { return false; }
            if (start > periodNum) { return false; }
        }

        if (hasEnd) {
            var end = parsePeriod(team.endPeriod);
            if (end === null) { return false; }
            if (end < periodNum) { return false; }
        }

        return true;
    }

    // ============================================================
    // DATA ACCESS
    // ============================================================

    /**
     * Get the raw teams array from window.data.
     *
     * Internal only. Public reads do not expose this array.
     *
     * @returns {array}
     */
    function getTeamArray() {
        var data = window.data || {};
        return Array.isArray(data.teams) ? data.teams : [];
    }

    // ============================================================
    // TEAM LOOKUP - SINGLE
    // ============================================================

    /**
     * Get a team by ID. Returns a deep clone, or null.
     *
     * @param {string} teamId
     * @returns {object|null}
     */
    function getTeamById(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
        var target = String(teamId);
        var teams = getTeamArray();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return clone(team);
            }
        }
        return null;
    }

    /**
     * Get the display name of a team by ID. Convenience only.
     * Returns 'Unassigned' when teamId is empty, 'Unknown Team'
     * when the team does not exist.
     *
     * @param {string} teamId
     * @returns {string}
     */
    function getTeamName(teamId) {
        if (!isNonEmptyString(teamId)) {
            return 'Unassigned';
        }
        var team = getTeamByIdInternal(teamId);
        return team ? (team.name || 'Unknown Team') : 'Unknown Team';
    }

    /**
     * Internal non-cloning lookup. Used by helper functions that
     * only read a subset of fields. Public callers must use
     * getTeamById.
     *
     * @param {string} teamId
     * @returns {object|null} live reference
     */
    function getTeamByIdInternal(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
        var target = String(teamId);
        var teams = getTeamArray();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    /**
     * Get the index of a team in the array. Internal use only.
     *
     * @param {string} teamId
     * @returns {number} index or -1
     */
    function getTeamIndex(teamId) {
        if (!isNonEmptyString(teamId)) {
            return -1;
        }
        var target = String(teamId);
        var teams = getTeamArray();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return i;
            }
        }
        return -1;
    }

    // ============================================================
    // TEAM STATUS PREDICATES
    // ============================================================

    /**
     * Is the team operational?
     *
     * Operational means active OR inactive. Deprecated teams are
     * excluded. Missing status is treated as not operational —
     * malformed records should not silently count as live teams.
     *
     * @param {object} team
     * @returns {boolean}
     */
    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        return isOperationalStatus(team.status);
    }

    /**
     * Is the team active?
     *
     * @param {object} team
     * @returns {boolean}
     */
    function isTeamActive(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        return team.status === 'active';
    }

    /**
     * Is the team active at a given period?
     *
     * SEMANTICS:
     *   - The team's startPeriod / endPeriod define its lifespan.
     *   - Academic teams: period is a bounded week (from
     *     CalendarConstants).
     *   - Non-academic teams: period is any positive integer.
     *   - Invalid period or type returns false.
     *
     * @param {object} team
     * @param {number|string} period
     * @returns {boolean}
     */
    function isTeamActiveAtPeriod(team, period) {
        if (!team || typeof team !== 'object') {
            return false;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }

        var range = TeamConstants.getPeriodRange(team.type);
        if (!range) {
            return false;
        }

        if (periodNum < range.min || periodNum > range.max) {
            return false;
        }

        return teamWindowContains(team, periodNum);
    }

    // ============================================================
    // TEAM LISTS
    // ============================================================

    /**
     * Get teams with optional filters.
     *
     * @param {string} type - Team type filter (null for all)
     * @param {string} status - 'active' | 'inactive' | 'operational' | null
     *                          'operational' means active OR inactive.
     * @param {boolean} includeDeleted - If true, includes deprecated teams.
     *                                   (Named for historical reasons;
     *                                   there is no 'deleted' status —
     *                                   deprecated is what this excludes.)
     * @returns {array} Array of cloned team objects
     */
    function getTeams(type, status, includeDeleted) {
        var teams = getTeamArray();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object') {
                result.push(team);
            }
        }

        // ---- Type filter ----
        if (type) {
            var normalizedType = TeamConstants.normalizeTeamType(type);
            if (normalizedType === null) {
                return [];
            }
            var typeFiltered = [];
            for (var j = 0; j < result.length; j++) {
                if (TeamConstants.normalizeTeamType(result[j].type) === normalizedType) {
                    typeFiltered.push(result[j]);
                }
            }
            result = typeFiltered;
        }

        // ---- Status filter ----
        if (status === 'active') {
            result = result.filter(function(t) { return t.status === 'active'; });
        } else if (status === 'inactive') {
            result = result.filter(function(t) { return t.status === 'inactive'; });
        } else if (status === 'operational') {
            result = result.filter(function(t) { return isOperationalStatus(t.status); });
        } else if (status) {
            // Unknown status filter -> empty result, not "no filter".
            return [];
        }

        // ---- Deprecated filter ----
        if (!includeDeleted) {
            result = result.filter(function(t) {
                return t.status !== 'deprecated';
            });
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        // Return clones.
        var out = [];
        for (var k = 0; k < result.length; k++) {
            out.push(clone(result[k]));
        }
        return out;
    }

    /**
     * Get all operational teams (active + inactive, not deprecated).
     * Returns clones.
     */
    function getAllOperationalTeams() {
        return getTeams(null, 'operational', false);
    }

    /**
     * Get all active teams. Returns clones.
     */
    function getAllActiveTeams() {
        return getTeams(null, 'active', false);
    }

    /**
     * Get teams by type. Defaults to operational status. Returns clones.
     */
    function getTeamsByType(type, status) {
        return getTeams(type, status || 'operational', false);
    }

    /**
     * Get teams that belong to an academic class. Returns clones.
     */
    function getTeamsByClass(classId, status) {
        if (!isNonEmptyString(classId)) {
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
     * Get teams active at a given period. Returns clones.
     */
    function getTeamsByPeriod(type, period, status) {
        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return [];
        }

        var teams = getTeams(type, status, false);
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            if (isTeamActiveAtPeriod(teams[i], periodNum)) {
                result.push(teams[i]);
            }
        }

        return result;
    }

    // ============================================================
    // MEMBERSHIP QUERIES
    // ============================================================

    /**
     * Get members of a team who are active at a given period.
     *
     * Returns clones.
     *
     * A member is active at period P when ALL of the following hold:
     *
     *   [FIX-Q1] The team itself is active at P. A team whose own
     *   startPeriod / endPeriod does not contain P has no active
     *   members at P, regardless of member-level windows. This is
     *   the "team ends, members are freed" rule.
     *
     *   - joinPeriod is absent or <= P.
     *   - leavePeriod is absent or >= P.
     *   - joinPeriod / leavePeriod (if present) are valid for the
     *     team type's period range.
     *
     * The team-window check can only REMOVE members from the
     * returned list. It can never add them. Every caller that
     * previously received "member is active at week N" for a team
     * whose own window has closed at N is now corrected.
     *
     * @param {object} team
     * @param {number|string} period
     * @returns {array} Array of cloned member objects
     */
    function getActiveTeamMembers(team, period) {
        if (!team || !Array.isArray(team.members)) {
            return [];
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return [];
        }

        var range = TeamConstants.getPeriodRange(team.type);
        if (!range) {
            return [];
        }

        if (periodNum < range.min || periodNum > range.max) {
            return [];
        }

        // [FIX-Q1] Team window check. If the team's own lifespan
        // does not contain the queried period, the team has no
        // active members at that period.
        if (!teamWindowContains(team, periodNum)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }

            var hasJoin = member.joinPeriod !== undefined &&
                          member.joinPeriod !== null &&
                          member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined &&
                           member.leavePeriod !== null &&
                           member.leavePeriod !== '';

            var join = hasJoin ? parsePeriod(member.joinPeriod) : null;
            var leave = hasLeave ? parsePeriod(member.leavePeriod) : null;

            if (hasJoin && join === null) {
                continue;
            }
            if (hasLeave && leave === null) {
                continue;
            }

            if (hasJoin && (join < range.min || join > range.max)) {
                continue;
            }
            if (hasLeave && (leave < range.min || leave > range.max)) {
                continue;
            }

            var joined = !hasJoin || join <= periodNum;
            var notLeft = !hasLeave || leave >= periodNum;

            if (joined && notLeft) {
                result.push(clone(member));
            }
        }

        return result;
    }

    /**
     * Count of active members at a period.
     */
    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    /**
     * Is a character an active member of a team at a period?
     */
    function isCharacterInTeamAtPeriod(team, characterId, period) {
        if (!team || !isNonEmptyString(characterId)) {
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

    /**
     * Get a team's member record for a character, regardless of period.
     * Returns a clone, or null.
     */
    function getTeamMember(team, characterId) {
        if (!team || !Array.isArray(team.members) || !isNonEmptyString(characterId)) {
            return null;
        }
        var target = String(characterId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object' && String(member.characterId) === target) {
                return clone(member);
            }
        }
        return null;
    }

    /**
     * Get teams a character belongs to at a period. Returns clones.
     *
     * @param {string} characterId
     * @param {number|string} period
     * @param {string} teamType - Optional type filter. Invalid type
     *                            returns [] (not "no filter").
     * @returns {array}
     */
    function getTeamsForCharacter(characterId, period, teamType) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return [];
        }

        var normalizedFilter = null;
        if (teamType !== undefined && teamType !== null && teamType !== '') {
            normalizedFilter = TeamConstants.normalizeTeamType(teamType);
            if (normalizedFilter === null) {
                return [];
            }
        }

        var teams = getTeamArray();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }
            if (!isTeamOperational(team)) {
                continue;
            }

            if (normalizedFilter !== null) {
                if (TeamConstants.normalizeTeamType(team.type) !== normalizedFilter) {
                    continue;
                }
            }

            if (isCharacterInTeamAtPeriod(team, characterId, periodNum)) {
                result.push(team);
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = [];
        for (var k = 0; k < result.length; k++) {
            out.push(clone(result[k]));
        }
        return out;
    }

    /**
     * Get a character's membership record for a team. Returns a clone,
     * or null.
     */
    function getCharacterTeamMembership(teamId, characterId) {
        var team = getTeamByIdInternal(teamId);
        if (!team) {
            return null;
        }
        return getTeamMember(team, characterId);
    }

    // ============================================================
    // RANKING QUERIES
    // ============================================================
    //
    // Ranking history lives on the team as `rankingHistory`, an
    // array of { period, rank }. This is Team-domain ranking.
    //
    // `getCurrentRank()` is DERIVED from rankingHistory. It is not a
    // persisted field. Persisting it would create two sources of
    // truth.

    /**
     * Get the sorted ranking history for a team.
     *
     * Malformed entries (invalid period or rank) are filtered out.
     * Returns clones. Sorted ascending by period.
     *
     * @param {object} team
     * @returns {array} Array of { period, rank }
     */
    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            var periodNum = parsePeriod(entry.period);
            if (periodNum === null) {
                continue;
            }
            var rank = parsePeriod(entry.rank);
            if (rank === null) {
                continue;
            }
            history.push({
                period: String(periodNum),
                rank: rank
            });
        }

        history.sort(function(a, b) {
            return Number(a.period) - Number(b.period);
        });

        return history;
    }

    /**
     * Get the most recent ranking entry for a team. Returns a clone,
     * or null.
     */
    function getMostRecentRanking(team) {
        var history = getSortedRankings(team);
        return history.length > 0 ? history[history.length - 1] : null;
    }

    /**
     * Get the current rank for a team. Derived from sorted history.
     * Returns a string (numeric), or '' when the team has no
     * rankings.
     *
     * @param {object} team
     * @returns {string}
     */
    function getCurrentRank(team) {
        var most = getMostRecentRanking(team);
        return most ? String(most.rank) : '';
    }

    /**
     * Get the rank at a specific period. Returns a number or null.
     */
    function getRankAtPeriod(team, period) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return null;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return null;
        }

        var target = String(periodNum);
        var history = team.rankingHistory;

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) { continue; }
            var entryPeriod = parsePeriod(entry.period);
            if (entryPeriod !== null && String(entryPeriod) === target) {
                var rank = parsePeriod(entry.rank);
                if (rank !== null) {
                    return rank;
                }
            }
        }

        return null;
    }

    /**
     * Get the rank change between two periods.
     *
     * @returns {object|null} { from, to, change } or null when either
     *                        period has no ranking entry
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
     * Does the team have any ranking history?
     */
    function hasRankings(team) {
        if (!team) {
            return false;
        }
        return getSortedRankings(team).length > 0;
    }

    /**
     * Get a summary of a team's ranking history.
     *
     * @returns {object} { total, current, mostRecent, history }
     */
    function getRankingSummary(team) {
        if (!team) {
            return { total: 0, current: '', mostRecent: null, history: [] };
        }

        var history = getSortedRankings(team);
        var total = history.length;
        var current = total > 0 ? String(history[total - 1].rank) : '';
        var mostRecent = total > 0 ? history[total - 1] : null;

        return {
            total: total,
            current: current,
            mostRecent: mostRecent,
            history: history
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamQueries = {
        // ---- Team lookup ----
        getTeamById: getTeamById,
        getTeamName: getTeamName,
        getTeamIndex: getTeamIndex,

        // ---- Status / period predicates ----
        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isTeamActiveAtPeriod: isTeamActiveAtPeriod,

        // ---- Team lists ----
        getTeams: getTeams,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getTeamsByType: getTeamsByType,
        getTeamsByClass: getTeamsByClass,
        getTeamsByPeriod: getTeamsByPeriod,

        // ---- Membership ----
        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,
        isCharacterInTeamAtPeriod: isCharacterInTeamAtPeriod,
        getTeamMember: getTeamMember,
        getTeamsForCharacter: getTeamsForCharacter,
        getCharacterTeamMembership: getCharacterTeamMembership,

        // ---- Rankings ----
        getSortedRankings: getSortedRankings,
        getMostRecentRanking: getMostRecentRanking,
        getCurrentRank: getCurrentRank,
        getRankAtPeriod: getRankAtPeriod,
        getRankChange: getRankChange,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamQueries;
        var missing = [];

        var required = [
            'getTeamById', 'getTeamName', 'getTeamIndex',
            'isTeamOperational', 'isTeamActive', 'isTeamActiveAtPeriod',
            'getTeams', 'getAllOperationalTeams', 'getAllActiveTeams',
            'getTeamsByType', 'getTeamsByClass', 'getTeamsByPeriod',
            'getActiveTeamMembers', 'getActiveTeamMemberCount',
            'isCharacterInTeamAtPeriod', 'getTeamMember',
            'getTeamsForCharacter', 'getCharacterTeamMembership',
            'getSortedRankings', 'getMostRecentRanking', 'getCurrentRank',
            'getRankAtPeriod', 'getRankChange', 'hasRankings',
            'getRankingSummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamQueries] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
