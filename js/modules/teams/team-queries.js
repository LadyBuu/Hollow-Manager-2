/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries.
 *
 * Path: js/modules/teams/team-queries.js
 *
 * WHAT THIS OWNS:
 *   - Team lookup by id, type, class, period.
 *   - Membership predicates (interval, active, former).
 *   - Team-scoped membership reads.
 *   - Character membership reads (all-time, current).
 *   - Ranking queries, including the read-time inheritance
 *     model described below, AND the ordered-list reads that
 *     back the Rankings tab (this revision).
 *   - Period-scoped readers: getPeriods, getCurrentPeriod,
 *     getPeriodForYear, getActiveTeamMembersForPeriod,
 *     getRankingsForPeriod.
 *   - The half-open period overlap predicate
 *     (intervalOverlapsPeriod) used by every period-scoped read.
 *   - The professional personnel query:
 *     getProfessionalPersonnelAtPeriod.
 *   - Shortage history: getTeamShortagePeriods.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Mutations. TeamCore owns those.
 *   - Domain rules. TeamRules (where applicable) owns those.
 *   - Structural validation. TeamCore's schema block owns that.
 *   - The periods array itself. TeamCore writes it; this module
 *     reads it. The shape is documented in team-core.js.
 *
 * TYPE AND STATUS COMPARISONS:
 *   Every comparison of a team's `type` or `status` field routes
 *   through TeamConstants.normalizeTeamType / normalizeTeamStatus.
 *   A legacy 'temporary' or 'internship' record matches
 *   'professional' the moment it hits any query in this file; a
 *   stored 'Active' matches 'active'. There is no raw string
 *   comparison of either field in this module.
 *
 *   The one exception is `isOperationalStatus`, which is an
 *   internal helper that classifies an already-normalised status
 *   into the {active, inactive} bucket. It normalises internally
 *   and is called only from getTeams and isTeamOperational.
 *
 * PERIOD PREDICATE OWNERSHIP:
 *   teamWindowContains(team, period)
 *   intervalContains(interval, period)
 *   windowContains(start, end, period)
 *
 * MEMBER PREDICATE OWNERSHIP:
 *   isMemberActive(member, period)
 *   isMemberFormer(member, period)
 *
 * PERIODS MODEL:
 *   A team carries a `periods` array. Each entry is a self-
 *   contained description of what the team was during a range of
 *   years:
 *
 *     {
 *       startPeriod: '1900',
 *       endPeriod: '1905',       // '' means open-ended
 *       name: 'Rapid',
 *       tacticalStyle: '',
 *       specialisations: []
 *     }
 *
 *   The LAST entry is "the current period." Every reader that
 *   wants the team's display name, tactical style, or
 *   specialisations without a period context reads the last entry.
 *
 *   Periods are ordered by startPeriod ascending. Only the last
 *   entry may carry an empty endPeriod. The canonicaliser and
 *   validator in team-core.js enforce both invariants; this
 *   module trusts the array and does not re-check.
 *
 * PERIOD MEMBERSHIP RULE (the "half-open on the upper bound"
 * contract):
 *
 *   A stint is included in a period iff:
 *
 *     stint.join  <  period.end    (strict)
 *     stint.leave >= period.start  (inclusive)
 *
 *   Where a blank period.end means infinity, and a blank
 *   stint.leave means infinity. A blank stint.join is never
 *   legal in the data model — every stint has a join — but the
 *   predicate treats it as -Infinity defensively.
 *
 * RANKING STORAGE AND THE INHERITANCE MODEL:
 *   `rankingHistory` on each team holds EXPLICIT entries only —
 *   the values the user actually wrote:
 *
 *     { period: '1905', rank: 3 }
 *
 *   The rank in effect for a team at year Y is the rank of the
 *   most recent explicit entry at or before Y. If no entry is at
 *   or before Y, the rank is null.
 *
 *   getRankAtPeriod returns the EFFECTIVE rank; it does not
 *   distinguish explicit from inherited. Callers that need the
 *   distinction use getEffectiveRanking, which returns
 *   { rank, explicit, sourcePeriod }.
 *
 * RANKINGS — CASCADING SNAPSHOT MODEL (this revision):
 *   The Rankings tab does not render per-team effective ranks in
 *   arbitrary order. It renders a POSITION-ORDERED list per
 *   year: position 1, position 2, ..., position N, one team per
 *   position, no gaps, no duplicates.
 *
 *   Three reads:
 *
 *     getExplicitRankingOrderForYear(year)
 *       Raw ordered list of explicit entries at the year.
 *
 *     getRankedTeamsForYear(year, options)
 *       Display-facing list the Rankings tab consumes. It looks
 *       at the effective rank for every team, filters out anyone
 *       with no rank at all, and sorts by rank.
 *
 *     getUnrankedTeamsForYear(year, options)
 *       Teams active at the year that have NO explicit entry at
 *       the year and NO inherited effective rank from an earlier
 *       year.
 *
 * SHORTAGE HISTORY:
 *   getTeamShortagePeriods(team, targetSize, toYear) walks every
 *   interval on every member entry of a team, builds a year-by-year
 *   population curve, and returns the runs where the active member
 *   count is strictly below targetSize.
 *
 * PROFESSIONAL PERSONNEL QUERY:
 *   getProfessionalPersonnelAtPeriod(period) returns domain facts
 *   about every character relevant to professional staffing.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamConstants
 *   - window.ObjectUtils
 *
 * DEPENDENCIES (MANDATORY AT CALL TIME):
 *   - window.CharacterQueries
 *   - window.CharacterConstants
 *   - window.EliminationQueries
 */

(function() {
    'use strict';

    if (window.__teamQueriesLoaded) { return; }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamConstants = window.TeamConstants;
    var ObjectUtils = window.ObjectUtils;

    var _missing = [];

    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }
    if (!TeamConstants ||
        typeof TeamConstants.isValidTeamStatus !== 'function') {
        _missing.push('TeamConstants.isValidTeamStatus');
    }
    if (!TeamConstants ||
        typeof TeamConstants.isValidTeamType !== 'function') {
        _missing.push('TeamConstants.isValidTeamType');
    }
    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
    }
    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamStatus !== 'function') {
        _missing.push('TeamConstants.normalizeTeamStatus');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getPeriodRange !== 'function') {
        _missing.push('TeamConstants.getPeriodRange');
    }
    if (!ObjectUtils ||
        typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamQueries] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamQueriesLoaded = true;

    // ============================================================
    // LAZY ACCESSORS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function clone(value) {
        if (value === null || value === undefined) { return value; }
        if (typeof value !== 'object') { return value; }
        var result = ObjectUtils.deepClone(value);
        if (result === value) {
            throw new Error(
                '[TeamQueries] ObjectUtils.deepClone returned the ' +
                'original reference. Read safety is broken.'
            );
        }
        return result;
    }

    function parsePeriod(value) {
        return TeamConstants.parsePeriod(value);
    }

    function parseYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) { return null; }
            return value;
        }
        var trimmed = String(value).trim();
        if (trimmed === '' || !/^\d+$/.test(trimmed)) { return null; }
        var n = Number(trimmed);
        if (!Number.isInteger(n) || n < 1) { return null; }
        return n;
    }

    function isOperationalStatus(status) {
        var normalized = TeamConstants.normalizeTeamStatus(status);
        return normalized === 'active' || normalized === 'inactive';
    }

    function isActiveStatus(status) {
        return TeamConstants.normalizeTeamStatus(status) === 'active';
    }

    function isInactiveStatus(status) {
        return TeamConstants.normalizeTeamStatus(status) === 'inactive';
    }

    function isProfessionalType(type) {
        return TeamConstants.normalizeTeamType(type) === 'professional';
    }

    function isAcademicType(type) {
        return TeamConstants.normalizeTeamType(type) === 'academic';
    }

    function teamWindowContainsNum(team, periodNum) {
        if (!team || typeof team !== 'object') { return false; }

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

    function intervalContainsNum(interval, periodNum) {
        if (!interval || typeof interval !== 'object') {
            return false;
        }

        var hasJoin = interval.joinPeriod !== undefined &&
                      interval.joinPeriod !== null &&
                      interval.joinPeriod !== '';
        var hasLeave = interval.leavePeriod !== undefined &&
                       interval.leavePeriod !== null &&
                       interval.leavePeriod !== '';

        if (hasJoin) {
            var join = parsePeriod(interval.joinPeriod);
            if (join === null) { return false; }
            if (join > periodNum) { return false; }
        }

        if (hasLeave) {
            var leave = parsePeriod(interval.leavePeriod);
            if (leave === null) { return false; }
            if (leave < periodNum) { return false; }
        }

        return true;
    }

    function normaliseCareerStatusKey(status) {
        if (status === undefined || status === null) { return ''; }
        var raw = String(status).trim().toLowerCase();
        if (raw === '') { return ''; }
        var formerIdx = raw.indexOf(' (former)');
        if (formerIdx !== -1) {
            raw = raw.substring(0, formerIdx).trim();
        }
        return raw;
    }

    function getLatestCareerStatusKey(char) {
        if (!char || !Array.isArray(char.careerStatus) ||
            char.careerStatus.length === 0) {
            return '';
        }

        var latestKey = '';
        var latestYear = -Infinity;
        var latestIndex = -1;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var key = normaliseCareerStatusKey(entry.status);
            if (key === '') { continue; }

            var year = parseInt(entry.startYear, 10);
            if (isNaN(year)) { year = -Infinity; }

            if (year > latestYear ||
                (year === latestYear && i > latestIndex)) {
                latestKey = key;
                latestYear = year;
                latestIndex = i;
            }
        }

        return latestKey;
    }

    // ============================================================
    // DATA ACCESS
    // ============================================================

    function getTeamArray() {
        var data = window.data || {};
        return Array.isArray(data.teams) ? data.teams : [];
    }

    function getTeamByIdInternal(teamId) {
        if (!isNonEmptyString(teamId)) { return null; }
        var target = String(teamId);
        var teams = getTeamArray();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' &&
                String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    // ============================================================
    // PERIOD PREDICATES
    // ============================================================

    function teamWindowContains(team, period) {
        if (!team || typeof team !== 'object') { return false; }
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }
        return teamWindowContainsNum(team, periodNum);
    }

    function intervalContains(interval, period) {
        if (!interval || typeof interval !== 'object') {
            return false;
        }
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }
        return intervalContainsNum(interval, periodNum);
    }

    function windowContains(start, end, period) {
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }

        var hasStart = start !== undefined &&
                       start !== null &&
                       start !== '';
        var hasEnd = end !== undefined &&
                     end !== null &&
                     end !== '';

        if (hasStart) {
            var startNum = parsePeriod(start);
            if (startNum === null) { return false; }
            if (startNum > periodNum) { return false; }
        }

        if (hasEnd) {
            var endNum = parsePeriod(end);
            if (endNum === null) { return false; }
            if (endNum < periodNum) { return false; }
        }

        return true;
    }

    // ============================================================
    // PERIOD OVERLAP PREDICATE
    // ============================================================

    function intervalOverlapsPeriod(join, leave, start, end) {
        var joinNum = parseYear(join);
        var leaveNum = parseYear(leave);
        var startNum = parseYear(start);
        var endNum = parseYear(end);

        var joinYear = joinNum === null ? -Infinity : joinNum;
        var leaveYear = leaveNum === null ? Infinity : leaveNum;
        var startYear = startNum === null ? -Infinity : startNum;
        var endYear = endNum === null ? Infinity : endNum;

        return joinYear < endYear && leaveYear >= startYear;
    }

    function rankingInPeriod(year, start, end) {
        var yearNum = parseYear(year);
        var startNum = parseYear(start);
        var endNum = parseYear(end);

        if (yearNum === null) { return false; }
        if (startNum === null) { return false; }

        var startYear = startNum;
        var endYear = endNum === null ? Infinity : endNum;

        return yearNum >= startYear && yearNum < endYear;
    }

    // ============================================================
    // PERIODS MODEL READERS
    // ============================================================

    function getPeriods(team) {
        if (!team || !Array.isArray(team.periods)) {
            return [];
        }
        return team.periods.slice();
    }

    function getCurrentPeriod(team) {
        if (!team || !Array.isArray(team.periods)) {
            return null;
        }
        if (team.periods.length === 0) {
            return null;
        }
        return clone(team.periods[team.periods.length - 1]);
    }

    function getCurrentTeamName(team) {
        var period = getCurrentPeriod(team);
        if (period && isNonEmptyString(period.name)) {
            return String(period.name);
        }
        if (team && isNonEmptyString(team.name)) {
            return String(team.name);
        }
        return 'Unknown Team';
    }

    function getPeriodForYear(team, year) {
        if (!team || !Array.isArray(team.periods)) {
            return null;
        }
        var yearNum = parseYear(year);
        if (yearNum === null) { return null; }

        for (var i = 0; i < team.periods.length; i++) {
            var period = team.periods[i];
            if (!period || typeof period !== 'object') { continue; }

            var startNum = parseYear(period.startPeriod);
            if (startNum === null) { continue; }

            var endNum = parseYear(period.endPeriod);
            var endYear = endNum === null ? Infinity : endNum;

            if (yearNum >= startNum && yearNum < endYear) {
                return clone(period);
            }
        }

        return null;
    }

    function getActiveTeamMembersForPeriod(team, period) {
        if (!team || !Array.isArray(team.members)) { return []; }
        if (!period || typeof period !== 'object') { return []; }

        var start = period.startPeriod;
        var end = period.endPeriod;

        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (!Array.isArray(member.intervals)) { continue; }

            var included = false;
            for (var j = 0; j < member.intervals.length; j++) {
                var iv = member.intervals[j];
                if (!iv || typeof iv !== 'object') { continue; }

                if (intervalOverlapsPeriod(
                    iv.joinPeriod,
                    iv.leavePeriod,
                    start,
                    end
                )) {
                    included = true;
                    break;
                }
            }

            if (included) {
                result.push(clone(member));
            }
        }

        return result;
    }

    function getRankingsForPeriod(team, period) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }
        if (!period || typeof period !== 'object') { return []; }

        var start = period.startPeriod;
        var end = period.endPeriod;

        var result = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!entry || typeof entry !== 'object') { continue; }

            if (rankingInPeriod(entry.period, start, end)) {
                result.push(clone(entry));
            }
        }

        return result;
    }

    // ============================================================
    // MEMBER PREDICATES
    // ============================================================

    function isMemberActive(member, period) {
        if (!member || !Array.isArray(member.intervals)) {
            return false;
        }
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }

        for (var i = 0; i < member.intervals.length; i++) {
            if (intervalContainsNum(member.intervals[i], periodNum)) {
                return true;
            }
        }
        return false;
    }

    function isMemberFormer(member, period) {
        if (!member || !Array.isArray(member.intervals)) {
            return false;
        }
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }

        for (var i = 0; i < member.intervals.length; i++) {
            if (intervalContainsNum(member.intervals[i], periodNum)) {
                return false;
            }
        }

        for (var j = 0; j < member.intervals.length; j++) {
            var interval = member.intervals[j];
            if (!interval || typeof interval !== 'object') {
                continue;
            }

            var hasLeave = interval.leavePeriod !== undefined &&
                           interval.leavePeriod !== null &&
                           interval.leavePeriod !== '';
            if (!hasLeave) { continue; }

            var leave = parsePeriod(interval.leavePeriod);
            if (leave === null) { continue; }

            if (leave < periodNum) { return true; }
        }

        return false;
    }

    // ============================================================
    // TEAM LOOKUP
    // ============================================================

    function getTeamById(teamId) {
        var team = getTeamByIdInternal(teamId);
        return team ? clone(team) : null;
    }

    function getTeamName(teamId) {
        if (!isNonEmptyString(teamId)) { return 'Unassigned'; }
        var team = getTeamByIdInternal(teamId);
        if (!team) { return 'Unknown Team'; }
        return getCurrentTeamName(team);
    }

    // ============================================================
    // STATUS PREDICATES
    // ============================================================

    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') { return false; }
        return isOperationalStatus(team.status);
    }

    function isTeamActive(team) {
        if (!team || typeof team !== 'object') { return false; }
        return isActiveStatus(team.status);
    }

    function isTeamActiveAtPeriod(team, period) {
        if (!team || typeof team !== 'object') { return false; }

        var periodNum = parsePeriod(period);
        if (periodNum === null) { return false; }

        var range = TeamConstants.getPeriodRange(team.type);
        if (!range) { return false; }

        if (periodNum < range.min || periodNum > range.max) {
            return false;
        }

        return teamWindowContainsNum(team, periodNum);
    }

    // ============================================================
    // TEAM LISTS
    // ============================================================

    function getTeams(type, status, includeDeprecated) {
        var teams = getTeamArray();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object') {
                result.push(team);
            }
        }

        if (type) {
            var normalizedType =
                TeamConstants.normalizeTeamType(type);
            if (normalizedType === null) { return []; }
            var typeFiltered = [];
            for (var j = 0; j < result.length; j++) {
                if (TeamConstants.normalizeTeamType(
                    result[j].type
                ) === normalizedType) {
                    typeFiltered.push(result[j]);
                }
            }
            result = typeFiltered;
        }

        if (status === 'active') {
            result = result.filter(function(t) {
                return isActiveStatus(t.status);
            });
        } else if (status === 'inactive') {
            result = result.filter(function(t) {
                return isInactiveStatus(t.status);
            });
        } else if (status === 'operational') {
            result = result.filter(function(t) {
                return isOperationalStatus(t.status);
            });
        } else if (status) {
            return [];
        }

        if (!includeDeprecated) {
            result = result.filter(function(t) {
                var normalized =
                    TeamConstants.normalizeTeamStatus(t.status);
                return normalized !== 'deprecated';
            });
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
        if (!isNonEmptyString(classId)) { return []; }

        var teams = getTeams(null, status || 'operational', false);
        var target = String(classId);
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && isAcademicType(team.type) &&
                String(team.classId) === target) {
                result.push(team);
            }
        }

        return result;
    }

    function getTeamsByPeriod(type, period, status) {
        var periodNum = parsePeriod(period);
        if (periodNum === null) { return []; }

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
    // TEAM-SCOPED MEMBERSHIP
    // ============================================================

    function getActiveTeamMembers(team, period) {
        if (!team || !Array.isArray(team.members)) { return []; }

        var periodNum = parsePeriod(period);
        if (periodNum === null) { return []; }

        var range = TeamConstants.getPeriodRange(team.type);
        if (!range) { return []; }

        if (periodNum < range.min || periodNum > range.max) {
            return [];
        }

        if (!teamWindowContainsNum(team, periodNum)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (isMemberActive(member, periodNum)) {
                result.push(clone(member));
            }
        }

        return result;
    }

    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    function isCharacterInTeamAtPeriod(team, characterId, period) {
        if (!team || !isNonEmptyString(characterId)) {
            return false;
        }
        var members = getActiveTeamMembers(team, period);
        var target = String(characterId);
        for (var i = 0; i < members.length; i++) {
            if (members[i] &&
                String(members[i].characterId) === target) {
                return true;
            }
        }
        return false;
    }

    function getTeamMember(team, characterId) {
        if (!team || !Array.isArray(team.members) ||
            !isNonEmptyString(characterId)) {
            return null;
        }
        var target = String(characterId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object' &&
                String(member.characterId) === target) {
                return clone(member);
            }
        }
        return null;
    }

    function getTeamMemberByMemberId(team, memberId) {
        if (!team || !Array.isArray(team.members) ||
            !isNonEmptyString(memberId)) {
            return null;
        }
        var target = String(memberId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (member.memberId !== undefined &&
                member.memberId !== null &&
                String(member.memberId) === target) {
                return clone(member);
            }
        }
        return null;
    }

    function getTeamMemberByComposite(team, characterId, joinPeriod) {
        if (!team || !Array.isArray(team.members) ||
            !isNonEmptyString(characterId)) {
            return null;
        }
        var targetChar = String(characterId);
        var targetJoin = (joinPeriod === undefined ||
                          joinPeriod === null)
            ? ''
            : String(joinPeriod);

        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (String(member.characterId) !== targetChar) {
                continue;
            }
            if (!Array.isArray(member.intervals)) { continue; }

            for (var j = 0; j < member.intervals.length; j++) {
                var interval = member.intervals[j];
                if (!interval || typeof interval !== 'object') {
                    continue;
                }
                var intervalJoin =
                    (interval.joinPeriod === undefined ||
                     interval.joinPeriod === null)
                        ? ''
                        : String(interval.joinPeriod);
                if (intervalJoin === targetJoin) {
                    return clone(member);
                }
            }
        }
        return null;
    }

    function getAllTeamMemberRecords(team) {
        if (!team || !Array.isArray(team.members)) { return []; }
        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object') {
                result.push(clone(member));
            }
        }
        return result;
    }

    // ============================================================
    // CHARACTER-CENTRIC MEMBERSHIP
    // ============================================================

    function getTeamsForCharacter(characterId, period, teamType) {
        if (!isNonEmptyString(characterId)) { return []; }

        var periodNum = parsePeriod(period);
        if (periodNum === null) { return []; }

        var normalizedFilter = null;
        if (teamType !== undefined &&
            teamType !== null &&
            teamType !== '') {
            normalizedFilter =
                TeamConstants.normalizeTeamType(teamType);
            if (normalizedFilter === null) { return []; }
        }

        var teams = getTeamArray();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (!isTeamOperational(team)) { continue; }

            if (normalizedFilter !== null) {
                if (TeamConstants.normalizeTeamType(team.type) !==
                    normalizedFilter) {
                    continue;
                }
            }

            if (isCharacterInTeamAtPeriod(
                team, characterId, periodNum
            )) {
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

    function getTeamsForCharacterAllTime(characterId, teamType) {
        return _getTeamsForCharacterAllTime(
            characterId, teamType, /* includeDeprecated */ false
        );
    }

    function getTeamsForCharacterAllTimeIncludingDeprecated(
        characterId,
        teamType
    ) {
        return _getTeamsForCharacterAllTime(
            characterId, teamType, /* includeDeprecated */ true
        );
    }

    function _getTeamsForCharacterAllTime(
        characterId,
        teamType,
        includeDeprecated
    ) {
        if (!isNonEmptyString(characterId)) { return []; }

        var normalizedFilter = null;
        if (teamType !== undefined &&
            teamType !== null &&
            teamType !== '') {
            normalizedFilter =
                TeamConstants.normalizeTeamType(teamType);
            if (normalizedFilter === null) { return []; }
        }

        var teams = getTeamArray();
        var target = String(characterId);
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (!includeDeprecated && !isTeamOperational(team)) {
                continue;
            }

            if (normalizedFilter !== null) {
                if (TeamConstants.normalizeTeamType(team.type) !==
                    normalizedFilter) {
                    continue;
                }
            }

            if (!Array.isArray(team.members)) { continue; }

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (String(member.characterId) === target) {
                    result.push(team);
                    break;
                }
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

    function hasCharacterBeenOnTeamAllTime(characterId, teamType) {
        if (!isNonEmptyString(characterId)) { return false; }

        var normalizedFilter = null;
        if (teamType !== undefined &&
            teamType !== null &&
            teamType !== '') {
            normalizedFilter =
                TeamConstants.normalizeTeamType(teamType);
            if (normalizedFilter === null) { return false; }
        }

        var teams = getTeamArray();
        var target = String(characterId);

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }

            if (normalizedFilter !== null) {
                if (TeamConstants.normalizeTeamType(team.type) !==
                    normalizedFilter) {
                    continue;
                }
            }

            if (!Array.isArray(team.members)) { continue; }

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (String(member.characterId) === target) {
                    return true;
                }
            }
        }

        return false;
    }

    function getCharacterTeamMembership(teamId, characterId) {
        var team = getTeamByIdInternal(teamId);
        if (!team) { return null; }
        return getTeamMember(team, characterId);
    }

    // ============================================================
    // SHORTAGE HISTORY
    // ============================================================

    function getTeamShortagePeriods(team, targetSize, toYear) {
        var periods = [];

        if (!team || typeof team !== 'object') { return periods; }

        var target = parsePeriod(targetSize);
        if (target === null || target < 1) { return periods; }

        var upper = parsePeriod(toYear);
        if (upper === null) { return periods; }

        // ---- Determine the lower scan bound. ----
        var lower = parsePeriod(team.startPeriod);

        if (lower === null) {
            var earliest = null;
            if (Array.isArray(team.members)) {
                for (var m = 0; m < team.members.length; m++) {
                    var member = team.members[m];
                    if (!member ||
                        !Array.isArray(member.intervals)) {
                        continue;
                    }
                    for (var i = 0;
                         i < member.intervals.length;
                         i++) {
                        var iv = member.intervals[i];
                        if (!iv || typeof iv !== 'object') {
                            continue;
                        }
                        var join = parsePeriod(iv.joinPeriod);
                        if (join === null) { continue; }
                        if (earliest === null || join < earliest) {
                            earliest = join;
                        }
                    }
                }
            }
            lower = earliest;
        }

        if (lower === null) { return periods; }

        if (lower > upper) { return periods; }

        if (!Array.isArray(team.members) || team.members.length === 0) {
            return periods;
        }

        // ---- Precompute each member's interval bounds once. ----
        var memberRanges = [];
        for (var mr = 0; mr < team.members.length; mr++) {
            var m2 = team.members[mr];
            if (!m2 || !Array.isArray(m2.intervals)) { continue; }

            var ranges = [];
            for (var ri = 0; ri < m2.intervals.length; ri++) {
                var raw = m2.intervals[ri];
                if (!raw || typeof raw !== 'object') { continue; }

                var joinNum = parsePeriod(raw.joinPeriod);
                if (joinNum === null) { continue; }

                var leaveNum = parsePeriod(raw.leavePeriod);
                var endNum = leaveNum === null ? Infinity : leaveNum;

                if (endNum < joinNum) { continue; }

                ranges.push({ start: joinNum, end: endNum });
            }

            if (ranges.length > 0) {
                memberRanges.push(ranges);
            }
        }

        if (memberRanges.length === 0) { return periods; }

        // ---- Walk year by year and slice out the runs. ----
        var currentStart = null;

        for (var y = lower; y <= upper; y++) {
            var count = 0;

            for (var n = 0; n < memberRanges.length; n++) {
                var intervals = memberRanges[n];
                var isActiveThisYear = false;

                for (var k = 0; k < intervals.length; k++) {
                    var r = intervals[k];
                    if (y >= r.start && y <= r.end) {
                        isActiveThisYear = true;
                        break;
                    }
                }
                if (isActiveThisYear) { count++; }
            }

            var isShort = count < target;

            if (isShort && currentStart === null) {
                currentStart = y;
            } else if (!isShort && currentStart !== null) {
                periods.push({
                    from: currentStart,
                    to: y - 1
                });
                currentStart = null;
            }
        }

        // Close any run still open at upper.
        if (currentStart !== null) {
            periods.push({
                from: currentStart,
                to: upper
            });
        }

        // ---- Mark the last period as open when it reaches
        //      toYear. ----
        if (periods.length > 0) {
            var last = periods[periods.length - 1];
            if (last.to === upper) {
                last.to = null;
            }
        }

        return periods;
    }

    // ============================================================
    // PROFESSIONAL PERSONNEL QUERY
    // ============================================================

    function requirePersonnelDependencies() {
        var CharacterQueries = getCharacterQueries();
        var CharacterConstants = getCharacterConstants();
        var EliminationQueries = getEliminationQueries();

        var missing = [];

        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getStatusAtYear !== 'function') {
            missing.push('CharacterQueries.getStatusAtYear');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.isDeceased !== 'function') {
            missing.push('CharacterQueries.isDeceased');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.calculateAge !== 'function') {
            missing.push('CharacterQueries.calculateAge');
        }
        if (!CharacterConstants ||
            typeof CharacterConstants.classifyStatus !== 'function') {
            missing.push('CharacterConstants.classifyStatus');
        }
        if (!EliminationQueries ||
            typeof EliminationQueries.getEliminationWeek !==
            'function') {
            missing.push('EliminationQueries.getEliminationWeek');
        }

        if (missing.length > 0) {
            throw new Error(
                '[TeamQueries] getProfessionalPersonnelAtPeriod ' +
                'requires: ' + missing.join(', ')
            );
        }

        return {
            CharacterQueries: CharacterQueries,
            CharacterConstants: CharacterConstants,
            EliminationQueries: EliminationQueries
        };
    }

    function computeStudentWindow(char) {
        var result = {
            hasPhase: false,
            from: null,
            to: null
        };

        if (!char || !Array.isArray(char.careerStatus) ||
            char.careerStatus.length === 0) {
            return result;
        }

        var earliestStart = null;
        var latestEnd = null;
        var anyOpenEnded = false;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var key = normaliseCareerStatusKey(entry.status);
            if (key !== 'junior' && key !== 'senior') { continue; }

            result.hasPhase = true;

            var start = parseYear(entry.startYear);
            if (start !== null) {
                if (earliestStart === null ||
                    start < earliestStart) {
                    earliestStart = start;
                }
            }

            var endRaw = entry.endYear;
            if (endRaw === undefined ||
                endRaw === null ||
                String(endRaw).trim() === '') {
                anyOpenEnded = true;
            } else {
                var end = parseYear(endRaw);
                if (end !== null) {
                    if (latestEnd === null || end > latestEnd) {
                        latestEnd = end;
                    }
                }
            }
        }

        result.from = earliestStart;
        result.to = anyOpenEnded ? null : latestEnd;
        return result;
    }

    function stintOverlapsStudentWindow(historyEntry, window) {
        if (!historyEntry ||
            !Array.isArray(historyEntry.teams)) {
            return false;
        }

        var windowFrom = window.from;
        var windowTo = window.to;

        for (var i = 0; i < historyEntry.teams.length; i++) {
            var member = historyEntry.teams[i].member;
            if (!member || !Array.isArray(member.intervals)) {
                continue;
            }

            for (var j = 0; j < member.intervals.length; j++) {
                var interval = member.intervals[j];
                if (!interval || typeof interval !== 'object') {
                    continue;
                }

                var stintFrom = parsePeriod(interval.joinPeriod);
                if (stintFrom === null) { stintFrom = 0; }

                var stintTo = parsePeriod(interval.leavePeriod);
                if (stintTo === null) { stintTo = Infinity; }

                var windowFromEff =
                    windowFrom === null ? -Infinity : windowFrom;
                var windowToEff =
                    windowTo === null ? Infinity : windowTo;

                if (stintFrom <= windowToEff &&
                    windowFromEff <= stintTo) {
                    return true;
                }
            }
        }

        return false;
    }

    function buildProfessionalHistoryIndex(periodNum) {
        var teams = getTeamArray();
        var index = Object.create(null);

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            // Route through normalizeTeamType: a legacy 'temporary'
            // or 'internship' record still counts as a professional
            // team. Without this, a character with pre-v31 history
            // looks like they have none, and re-enters the staffing
            // pool.
            if (!isProfessionalType(team.type)) { continue; }
            if (!Array.isArray(team.members)) { continue; }

            var teamId = String(team.id);

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (!isNonEmptyString(member.characterId)) {
                    continue;
                }
                var charId = String(member.characterId);

                if (!index[charId]) {
                    index[charId] = {
                        hasAnyEntry: false,
                        teams: [],
                        activeAtPeriod: null,
                        currentOpenStint: false,
                        futureFrom: null,
                        futureTeamId: null,
                        formerTeams: []
                    };
                }

                var entry = index[charId];
                entry.hasAnyEntry = true;
                entry.teams.push({ team: team, member: member });

                var active = isMemberActive(member, periodNum);
                var former = !active &&
                    isMemberFormer(member, periodNum);

                if (active) {
                    entry.activeAtPeriod = teamId;
                } else if (former) {
                    if (entry.formerTeams.indexOf(teamId) === -1) {
                        entry.formerTeams.push(teamId);
                    }
                }

                if (!Array.isArray(member.intervals)) { continue; }

                for (var iv = 0; iv < member.intervals.length; iv++) {
                    var interval = member.intervals[iv];
                    if (!interval ||
                        typeof interval !== 'object') {
                        continue;
                    }

                    var leaveRaw = interval.leavePeriod;
                    var hasLeave = leaveRaw !== undefined &&
                                   leaveRaw !== null &&
                                   leaveRaw !== '';
                    if (!hasLeave) {
                        entry.currentOpenStint = true;
                    }

                    var joinNum = parsePeriod(interval.joinPeriod);
                    if (joinNum === null) { continue; }
                    if (joinNum <= periodNum) { continue; }

                    if (entry.futureFrom === null ||
                        joinNum < entry.futureFrom) {
                        entry.futureFrom = joinNum;
                        entry.futureTeamId = teamId;
                    }
                }
            }
        }

        return index;
    }

    function buildPersonnelRecord(
        char,
        periodNum,
        deps,
        historyEntry,
        studentWindow
    ) {
        var CharacterQueries = deps.CharacterQueries;

        var charId = String(char.id);
        var name = CharacterQueries.getDisplayName(char);
        var age = CharacterQueries.calculateAge(char, periodNum);
        var statusAtPeriod =
            CharacterQueries.getStatusAtYear(char, periodNum);
        var deceased =
            CharacterQueries.isDeceased(char, periodNum) === true;

        var juniorYear = null;
        var seniorYear = null;
        var supportYear = null;
        var instructorYear = null;

        if (typeof CharacterQueries.getJuniorYear === 'function') {
            juniorYear = CharacterQueries.getJuniorYear(char);
        }
        if (typeof CharacterQueries.getSeniorYear === 'function') {
            seniorYear = CharacterQueries.getSeniorYear(char);
        }
        if (typeof CharacterQueries.getSupportYear === 'function') {
            supportYear = CharacterQueries.getSupportYear(char);
        }
        if (typeof CharacterQueries.getInstructorYear === 'function') {
            instructorYear =
                CharacterQueries.getInstructorYear(char);
        }

        var hasProfessionalHistory = historyEntry &&
            historyEntry.hasAnyEntry === true;

        var isRetired =
            getLatestCareerStatusKey(char) === 'retired';

        var assignmentStatus = 'available';
        var currentTeamId = null;
        var currentTeamName = null;
        var nextTeamId = null;
        var nextTeamName = null;
        var nextJoinYear = null;

        if (historyEntry) {
            if (historyEntry.activeAtPeriod) {
                assignmentStatus = 'active';
                currentTeamId = historyEntry.activeAtPeriod;
                var activeTeam = getTeamByIdInternal(currentTeamId);
                if (activeTeam) {
                    currentTeamName =
                        getCurrentTeamName(activeTeam);
                }
            } else if (historyEntry.futureFrom !== null) {
                assignmentStatus = 'future';
                nextTeamId = historyEntry.futureTeamId;
                nextJoinYear = historyEntry.futureFrom;
                var futureTeam = getTeamByIdInternal(nextTeamId);
                if (futureTeam) {
                    nextTeamName =
                        getCurrentTeamName(futureTeam);
                }
            }
        }

        return {
            characterId: charId,
            name: name,
            age: age,
            statusAtPeriod: statusAtPeriod,

            deceased: deceased,
            retired: isRetired,

            assignment: {
                status: assignmentStatus,
                currentTeamId: currentTeamId,
                currentTeamName: currentTeamName,
                nextTeamId: nextTeamId,
                nextTeamName: nextTeamName,
                nextJoinYear: nextJoinYear
            },

            availability: {
                from: studentWindow ? studentWindow.from : null,
                to: studentWindow ? studentWindow.to : null
            },

            career: {
                juniorYear: juniorYear,
                seniorYear: seniorYear,
                supportYear: supportYear,
                instructorYear: instructorYear
            },

            history: {
                hasProfessionalHistory: hasProfessionalHistory,
                formerTeamCount: historyEntry
                    ? historyEntry.formerTeams.length
                    : 0
            }
        };
    }

    function getProfessionalPersonnelAtPeriod(period) {
        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            throw new Error(
                '[TeamQueries] getProfessionalPersonnelAtPeriod ' +
                'requires a valid period.'
            );
        }

        var deps = requirePersonnelDependencies();
        var CharacterQueries = deps.CharacterQueries;
        var EliminationQueries = deps.EliminationQueries;

        var allChars = CharacterQueries.getCharacters() || [];
        var historyIndex =
            buildProfessionalHistoryIndex(periodNum);

        var records = [];

        for (var i = 0; i < allChars.length; i++) {
            var char = allChars[i];
            if (!char || !char.id) { continue; }

            var charId = String(char.id);

            // ---- 1. Deceased at period: exclude. ----
            var deceased = false;
            try {
                deceased =
                    CharacterQueries.isDeceased(char, periodNum) ===
                    true;
            } catch (e) {
                deceased = char.deceased === true;
            }
            if (deceased) { continue; }

            // ---- 2. Eliminated: exclude (presence-based). ----
            var elimWeek = null;
            try {
                elimWeek =
                    EliminationQueries.getEliminationWeek(charId);
            } catch (e) {
                throw new Error(
                    '[TeamQueries] getEliminationWeek failed for ' +
                    charId + ': ' + e.message
                );
            }
            if (elimWeek !== null && elimWeek !== undefined) {
                continue;
            }

            // ---- 3. Retired: exclude. ----
            if (getLatestCareerStatusKey(char) === 'retired') {
                continue;
            }

            // ---- 4. Student phase must exist. ----
            var studentWindow = computeStudentWindow(char);
            if (!studentWindow.hasPhase) { continue; }

            // ---- 5. Student window must not overlap any
            //         professional stint. ----
            var historyEntry = historyIndex[charId] || null;
            if (stintOverlapsStudentWindow(
                historyEntry, studentWindow
            )) {
                continue;
            }

            records.push(
                buildPersonnelRecord(
                    char,
                    periodNum,
                    deps,
                    historyEntry,
                    studentWindow
                )
            );
        }

        records.sort(function(a, b) {
            var aFrom = a.availability
                ? a.availability.from
                : null;
            var bFrom = b.availability
                ? b.availability.from
                : null;

            if (aFrom === null && bFrom === null) {
                return a.name.localeCompare(b.name);
            }
            if (aFrom === null) { return 1; }
            if (bFrom === null) { return -1; }
            if (aFrom !== bFrom) { return aFrom - bFrom; }
            return a.name.localeCompare(b.name);
        });

        return records;
    }

    // ============================================================
    // RANKINGS — ORDERED-LIST READS (this revision)
    // ============================================================
    //
    // The write path (TeamCore.insertRankingAt / moveRanking)
    // writes a FULL SNAPSHOT for any year that is edited. If you
    // drag and drop in 1920, every team in the list gets a 1920
    // entry. If you do not touch 1945, 1944's exact order
    // cascades into 1945. If you reorder in 1945, a new snapshot
    // is written for 1945.
    //
    // The reads below consume that guarantee by looking at the
    // EFFECTIVE rank for every team at or before the target year.
    //
    // Three reads:
    //
    //   getExplicitRankingOrderForYear(year)
    //     Raw ordered list. [{ teamId, team, rank }], sorted
    //     ascending by rank.
    //
    //   getRankedTeamsForYear(year, options)
    //     Display-facing. Determines the effective rank for
    //     every team, filters out anyone with no rank at all,
    //     and sorts by rank.
    //
    //     SHOWINACTIVE:
    //       options.showInactive gates whether rows whose team
    //       is NOT active in that year are returned.
    //
    //   getUnrankedTeamsForYear(year, options)
    //     Candidates a "fill a slot" picker offers: teams
    //     active at the year with no explicit entry at the year
    //     and no inherited effective rank from an earlier year.

    function collectExplicitEntriesAtYearInternal(targetYear) {
        var targetStr = String(parseInt(targetYear, 10));
        var teams = getTeamArray();
        var entries = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (!Array.isArray(team.rankingHistory)) { continue; }

            for (var j = 0; j < team.rankingHistory.length; j++) {
                var entry = team.rankingHistory[j];
                if (!entry || typeof entry !== 'object') { continue; }

                var entryYear = parsePeriod(entry.period);
                if (entryYear === null) { continue; }
                if (String(entryYear) !== targetStr) { continue; }

                var rank = parsePeriod(entry.rank);
                if (rank === null) { continue; }

                entries.push({
                    teamId: String(team.id),
                    team: team,
                    rank: rank
                });
            }
        }

        entries.sort(function(a, b) {
            return a.rank - b.rank;
        });

        return entries;
    }

    /**
     * The raw ordered list of explicit entries at a year.
     *
     * @param {string|number} year
     * @returns {array} [{ teamId, team, rank }]
     */
    function getExplicitRankingOrderForYear(year) {
        var yearNum = parsePeriod(year);
        if (yearNum === null) { return []; }
        return collectExplicitEntriesAtYearInternal(yearNum);
    }

    /**
     * Display-facing ordered list for the Rankings tab.
     *
     * Uses getEffectiveRanking for every team. If a team has an
     * explicit entry at year Y, that is their rank. If they do
     * not, their rank is inherited from the most recent explicit
     * entry before Y. Sorts all teams with a non-null rank.
     *
     * Each entry:
     *
     *   {
     *     position:      integer 1..N, the display position
     *     teamId:        string
     *     name:          string (resolved via getCurrentTeamName)
     *     rank:          integer (same as position)
     *     explicit:      boolean
     *     sourcePeriod:  String  (the year the rank was written)
     *     periodDisplay: string  ('1900-1904', 'From 1900', ...)
     *     memberCount:   integer (active members at `year`)
     *     status:        raw stored status
     *     activeAtYear:  boolean
     *   }
     *
     * SHOWINACTIVE:
     *   When options.showInactive !== true, inactive rows are dropped.
     *
     * Returns [] when no team has a rank at the year.
     *
     * @param {string|number} year
     * @param {object} [options] - { showInactive: boolean }
     * @returns {array}
     */
    function getRankedTeamsForYear(year, options) {
        options = options || {};
        var showInactive = options.showInactive === true;

        var yearNum = parsePeriod(year);
        if (yearNum === null) { return []; }

        var teams = getTeamArray();
        var effectiveRanks = [];
        var seenRanks = Object.create(null);

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            
            // getEffectiveRanking looks at the explicit entry at this year, 
            // or inherits from the most recent explicit entry before it.
            var effective = getEffectiveRanking(team, yearNum);
            if (effective.rank === null) { continue; }

            var activeAtYear = isTeamActiveAtPeriod(team, yearNum);
            if (!showInactive && !activeAtYear) { continue; }

            // Ensure uniqueness (if two teams tie, take the more recent source)
            var rankKey = String(effective.rank);
            if (seenRanks[rankKey]) {
                var existing = seenRanks[rankKey];
                if (effective.sourcePeriod > existing.effective.sourcePeriod) {
                    existing.team = team;
                    existing.effective = effective;
                    existing.activeAtYear = activeAtYear;
                }
            } else {
                seenRanks[rankKey] = {
                    team: team,
                    effective: effective,
                    activeAtYear: activeAtYear
                };
            }
        }

        var result = [];
        var rankKeys = Object.keys(seenRanks);
        for (var k = 0; k < rankKeys.length; k++) {
            var item = seenRanks[rankKeys[k]];
            var t = item.team;
            var e = item.effective;
            
            var memberCount = 0;
            try {
                memberCount = getActiveTeamMemberCount(t, yearNum);
            } catch (err) {
                memberCount = 0;
            }

            result.push({
                position: e.rank,
                teamId: String(t.id),
                name: getCurrentTeamName(t),
                rank: e.rank,
                explicit: e.explicit,
                sourcePeriod: e.sourcePeriod,
                periodDisplay: buildTeamPeriodDisplay(t),
                memberCount: memberCount,
                status: t.status || 'active',
                activeAtYear: item.activeAtYear
            });
        }

        result.sort(function(a, b) {
            return a.position - b.position;
        });

        return result;
    }

    /**
     * Teams active at `year` that have no explicit entry at the
     * year and no inherited effective rank from an earlier year.
     *
     * These are the candidates a "fill a slot" picker offers, and
     * what a drag-to-empty-position drop would target. A team
     * with an inherited rank is excluded: including them would
     * double-rank them.
     *
     * Only professional teams are considered. Academic and
     * civilian teams never carry a mission-style ranking.
     *
     * SHOWINACTIVE:
     *   The options object is accepted for signature symmetry
     *   with getRankedTeamsForYear, but showInactive has NO
     *   effect here. This list is always active-only. See the
     *   section header comment.
     *
     * @param {string|number} year
     * @param {object} [options] - accepted for symmetry; unused.
     * @returns {array} [{ teamId, name, status, activeAtYear }]
     */
    function getUnrankedTeamsForYear(year, options) {
        // options is intentionally unused. The signature accepts
        // it so the aggregator can pass the same options object
        // to both reads without a special case.
        void options;

        var yearNum = parsePeriod(year);
        if (yearNum === null) { return []; }

        // Which teams already have an explicit entry at the year?
        var explicitSet = Object.create(null);
        var raw = collectExplicitEntriesAtYearInternal(yearNum);
        for (var r = 0; r < raw.length; r++) {
            explicitSet[raw[r].teamId] = true;
        }

        var teams = getTeamArray();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (!team.id) { continue; }
            if (!isProfessionalType(team.type)) { continue; }

            var teamId = String(team.id);
            if (explicitSet[teamId]) { continue; }

            // A team that has an inherited rank at the year is
            // already in the display list implicitly; the user
            // should not be offered it for double-ranking.
            var effective = getEffectiveRanking(team, yearNum);
            if (effective.rank !== null) { continue; }

            // Only include teams that were actually active at the
            // year. A disbanded team cannot take a new position.
            var activeAtYear = false;
            try {
                activeAtYear = isTeamActiveAtPeriod(team, yearNum);
            } catch (e) {
                activeAtYear = false;
            }
            if (!activeAtYear) { continue; }

            result.push({
                teamId: teamId,
                name: getCurrentTeamName(team),
                status: team.status || 'active',
                activeAtYear: true
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // PERIOD DISPLAY (internal helper for the rankings reads)
    // ============================================================
    //
    // Mirrors TeamAggregator.getTeamPeriodDisplay. It lives here
    // because getRankedTeamsForYear needs a period display and it
    // would be wrong for the query layer to depend on the
    // aggregator. The aggregator still owns its own copy; the two
    // are kept in sync by convention. If they ever diverge, this
    // one wins for the rankings tab (it is the one the rankings
    // VM reads from).

    function buildTeamPeriodDisplay(team) {
        if (!team || typeof team !== 'object') { return '-'; }

        var normalizedType = TeamConstants.normalizeTeamType(
            team.type
        );
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (normalizedType === 'academic') {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            }
            if (start) { return 'From Wk ' + start; }
            if (end) { return 'Until Wk ' + end; }
            return '-';
        }

        if (start && end) { return start + ' - ' + end; }
        if (start) { return 'From ' + start; }
        if (end) { return 'Until ' + end; }
        return '-';
    }

    // ============================================================
    // RANKINGS — INHERITANCE MODEL (unchanged)
    // ============================================================
    //
    // RANKING MODEL:
    //   A team carries a `rankingHistory` array of EXPLICIT
    //   entries — the values the user actually wrote:
    //
    //     { period: '1905', rank: 3 }
    //
    //   The array describes the years on which the user acted,
    //   not every year.
    //
    // READ-TIME INHERITANCE:
    //   The rank in effect for a team at year Y is the rank of
    //   the most recent explicit entry at or before Y. If no
    //   entry is at or before Y, the rank is null.
    //
    //   A team ranked #3 at 1904 and #5 at 1907 reads:
    //
    //     1903  null      (no entry at or before 1903)
    //     1904  #3        (explicit)
    //     1905  #3        (inherited from 1904)
    //     1906  #3        (inherited from 1904)
    //     1907  #5        (explicit)
    //     1908  #5        (inherited from 1907)
    //
    //   Writing a new entry at 1905 (#4, say) shadows 1904 for
    //   1905–1906 without touching 1907:
    //
    //     1904  #3        (explicit)
    //     1905  #4        (explicit, written)
    //     1906  #4        (inherited from 1905)
    //     1907  #5        (explicit)
    //
    //   That is "change it in time and keep the previous records."
    //   The 1904 entry survives untouched; it just stops governing
    //   1905.
    //
    // getRankAtPeriod RETURNS THE EFFECTIVE RANK. It does not
    // distinguish explicit from inherited. Callers that need the
    // distinction use getEffectiveRanking.

    /**
     * Get the rank in effect for a team at a given year.
     *
     * Read-time inheritance: returns the most recent entry at
     * or before `year`. Returns null when the team has no entry
     * at or before the year, or when the year is invalid.
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {number|null}
     */
    function getRankAtPeriod(team, period) {
        var effective = getEffectiveRanking(team, period);
        return effective.rank;
    }

    /**
     * Get the effective ranking at a year, with the provenance
     * of the value.
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {object} {
     *   rank: number|null,
     *   explicit: boolean,
     *   sourcePeriod: string|null
     * }
     */
    function getEffectiveRanking(team, period) {
        var result = {
            rank: null,
            explicit: false,
            sourcePeriod: null
        };

        if (!team || !Array.isArray(team.rankingHistory)) {
            return result;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return result;
        }

        var bestYear = -Infinity;
        var bestRank = null;

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var entryPeriod = parsePeriod(entry.period);
            if (entryPeriod === null) { continue; }
            if (entryPeriod > periodNum) { continue; }

            var rank = parsePeriod(entry.rank);
            if (rank === null) { continue; }

            if (entryPeriod > bestYear) {
                bestYear = entryPeriod;
                bestRank = rank;
            }
        }

        if (bestRank === null) {
            return result;
        }

        result.rank = bestRank;
        result.sourcePeriod = String(bestYear);
        result.explicit = (bestYear === periodNum);

        return result;
    }

    /**
     * Does the team have an explicit entry at exactly this year?
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {boolean}
     */
    function hasExplicitRankingAt(team, period) {
        return getEffectiveRanking(team, period).explicit === true;
    }

    /**
     * Get the team's explicit ranking entries, each tagged with
     * the range of years it governs.
     *
     * The range of an entry is [entry.period, nextEntry.period).
     * The last entry's range extends to Infinity. This is the
     * same half-open rule the periods model uses.
     *
     * @param {object} team
     * @returns {array} [ { period, rank, governsFrom, governsTo } ]
     */
    function getRankingHistoryWithRanges(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var cleaned = [];
        var seenYears = Object.create(null);

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var year = parsePeriod(entry.period);
            if (year === null) { continue; }

            var rank = parsePeriod(entry.rank);
            if (rank === null) { continue; }

            if (seenYears[year]) { continue; }
            seenYears[year] = true;

            cleaned.push({
                period: String(year),
                rank: rank,
                yearNum: year
            });
        }

        cleaned.sort(function(a, b) {
            return a.yearNum - b.yearNum;
        });

        var result = [];
        for (var j = 0; j < cleaned.length; j++) {
            var current = cleaned[j];
            var next = cleaned[j + 1];

            result.push({
                period: current.period,
                rank: current.rank,
                governsFrom: current.yearNum,
                governsTo: next ? next.yearNum : null
            });
        }

        return result;
    }

    /**
     * Get the team's explicit ranking entries, sorted ascending
     * by year. Returns [{ period, rank }, ...].
     */
    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var periodNum = parsePeriod(entry.period);
            if (periodNum === null) { continue; }

            var rank = parsePeriod(entry.rank);
            if (rank === null) { continue; }

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
     * Get the most recent explicit entry, or null.
     */
    function getMostRecentRanking(team) {
        var history = getSortedRankings(team);
        return history.length > 0
            ? history[history.length - 1]
            : null;
    }

    /**
     * The most recent explicit rank, as a display string, or ''
     * when the team has no ranking history.
     */
    function getCurrentRank(team) {
        var most = getMostRecentRanking(team);
        return most ? String(most.rank) : '';
    }

    function hasRankings(team) {
        if (!team) { return false; }
        return getSortedRankings(team).length > 0;
    }

    /**
     * A summary of the team's ranking state.
     */
    function getRankingSummary(team) {
        if (!team) {
            return {
                total: 0,
                current: '',
                mostRecent: null,
                history: []
            };
        }

        var history = getSortedRankings(team);
        var total = history.length;
        var current = total > 0
            ? String(history[total - 1].rank)
            : '';
        var mostRecent = total > 0
            ? history[total - 1]
            : null;

        return {
            total: total,
            current: current,
            mostRecent: mostRecent,
            history: history
        };
    }

    // ============================================================
    // STAFF CLASSIFICATION
    // ============================================================

    function isCharacterStaffAtYear(char, yearNum) {
        var info = getStaffInfoAtYear(char, yearNum);
        return info.role !== null;
    }

    function getStaffInfoAtYear(char, yearNum) {
        var result = { role: null, since: null };
        if (!char || typeof char !== 'object') { return result; }

        var CharacterQueries = getCharacterQueries();
        var CharacterConstants = getCharacterConstants();
        if (!CharacterQueries ||
            !CharacterConstants) {
            return result;
        }

        var statusAtYear = null;
        try {
            statusAtYear = CharacterQueries.getStatusAtYear(
                char, yearNum
            );
        } catch (e) {
            return result;
        }

        if (typeof statusAtYear !== 'string' ||
            statusAtYear.trim() === '') {
            return result;
        }

        var tier = null;
        try {
            tier = CharacterConstants.classifyStatus(statusAtYear);
        } catch (e) {
            tier = null;
        }

        if (tier !== 'instructor' && tier !== 'support') {
            return result;
        }

        result.role = tier;

        if (typeof CharacterQueries.getCareerStatusYear ===
            'function') {
            var statusName = tier === 'instructor'
                ? 'instructor'
                : 'support';
            try {
                var since = CharacterQueries.getCareerStatusYear(
                    char, statusName
                );
                if (since !== null && since !== undefined) {
                    result.since = since;
                }
            } catch (e) {
                // Leave since null.
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamQueries = Object.freeze({
        getTeamById: getTeamById,
        getTeamName: getTeamName,

        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isTeamActiveAtPeriod: isTeamActiveAtPeriod,

        teamWindowContains: teamWindowContains,
        intervalContains: intervalContains,
        windowContains: windowContains,

        isMemberActive: isMemberActive,
        isMemberFormer: isMemberFormer,

        getTeams: getTeams,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getTeamsByType: getTeamsByType,
        getTeamsByClass: getTeamsByClass,
        getTeamsByPeriod: getTeamsByPeriod,

        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,
        isCharacterInTeamAtPeriod: isCharacterInTeamAtPeriod,
        getTeamMember: getTeamMember,
        getTeamMemberByMemberId: getTeamMemberByMemberId,
        getTeamMemberByComposite: getTeamMemberByComposite,
        getAllTeamMemberRecords: getAllTeamMemberRecords,
        getTeamsForCharacter: getTeamsForCharacter,
        getTeamsForCharacterAllTime: getTeamsForCharacterAllTime,
        getTeamsForCharacterAllTimeIncludingDeprecated:
            getTeamsForCharacterAllTimeIncludingDeprecated,
        hasCharacterBeenOnTeamAllTime:
            hasCharacterBeenOnTeamAllTime,
        getCharacterTeamMembership: getCharacterTeamMembership,

        // ---- Periods model ----
        getPeriods: getPeriods,
        getCurrentPeriod: getCurrentPeriod,
        getCurrentTeamName: getCurrentTeamName,
        getPeriodForYear: getPeriodForYear,
        getActiveTeamMembersForPeriod: getActiveTeamMembersForPeriod,
        getRankingsForPeriod: getRankingsForPeriod,
        intervalOverlapsPeriod: intervalOverlapsPeriod,
        rankingInPeriod: rankingInPeriod,

        getTeamShortagePeriods: getTeamShortagePeriods,

        getProfessionalPersonnelAtPeriod:
            getProfessionalPersonnelAtPeriod,

        isCharacterStaffAtYear: isCharacterStaffAtYear,
        getStaffInfoAtYear: getStaffInfoAtYear,

        // ---- Rankings — ordered-list model (this revision) ----
        getExplicitRankingOrderForYear:
            getExplicitRankingOrderForYear,
        getRankedTeamsForYear: getRankedTeamsForYear,
        getUnrankedTeamsForYear: getUnrankedTeamsForYear,

        // ---- Rankings — inheritance model (unchanged) ----
        getSortedRankings: getSortedRankings,
        getMostRecentRanking: getMostRecentRanking,
        getCurrentRank: getCurrentRank,
        getRankAtPeriod: getRankAtPeriod,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary,

        // Read-time inheritance
        getEffectiveRanking: getEffectiveRanking,
        hasExplicitRankingAt: hasExplicitRankingAt,
        getRankingHistoryWithRanges: getRankingHistoryWithRanges
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamQueries;
        var missing = [];

        var required = [
            'getTeamById', 'getTeamName',
            'isTeamOperational', 'isTeamActive', 'isTeamActiveAtPeriod',
            'teamWindowContains', 'intervalContains', 'windowContains',
            'isMemberActive', 'isMemberFormer',
            'getTeams', 'getAllOperationalTeams', 'getAllActiveTeams',
            'getTeamsByType', 'getTeamsByClass', 'getTeamsByPeriod',
            'getActiveTeamMembers', 'getActiveTeamMemberCount',
            'isCharacterInTeamAtPeriod', 'getTeamMember',
            'getTeamMemberByMemberId', 'getTeamMemberByComposite',
            'getAllTeamMemberRecords',
            'getTeamsForCharacter', 'getTeamsForCharacterAllTime',
            'getTeamsForCharacterAllTimeIncludingDeprecated',
            'hasCharacterBeenOnTeamAllTime',
            'getCharacterTeamMembership',
            'getPeriods', 'getCurrentPeriod', 'getCurrentTeamName',
            'getPeriodForYear', 'getActiveTeamMembersForPeriod',
            'getRankingsForPeriod',
            'intervalOverlapsPeriod', 'rankingInPeriod',
            'getTeamShortagePeriods',
            'getProfessionalPersonnelAtPeriod',
            'isCharacterStaffAtYear', 'getStaffInfoAtYear',
            'getExplicitRankingOrderForYear', 'getRankedTeamsForYear',
            'getUnrankedTeamsForYear',
            'getSortedRankings', 'getMostRecentRanking',
            'getCurrentRank', 'getRankAtPeriod', 'hasRankings',
            'getRankingSummary',
            'getEffectiveRanking', 'hasExplicitRankingAt',
            'getRankingHistoryWithRanges'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            var RAPID_START = '1900';
            var RAPID_END = '1905';
            var RII_START = '1905';
            var RII_END = '';

            if (!intervalOverlapsPeriod(
                '1898', '', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1898–present should be in Rapid'
                );
            }
            if (!intervalOverlapsPeriod(
                '1898', '', RII_START, RII_END
            )) {
                missing.push(
                    'predicate: 1898–present should be in Rapid II'
                );
            }
            if (!intervalOverlapsPeriod(
                '1900', '1904', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1900–1904 should be in Rapid'
                );
            }
            if (intervalOverlapsPeriod(
                '1900', '1904', RII_START, RII_END
            )) {
                missing.push(
                    'predicate: 1900–1904 should NOT be in Rapid II'
                );
            }
            if (!intervalOverlapsPeriod(
                '1904', '1908', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1904–1908 should be in Rapid'
                );
            }
            if (!intervalOverlapsPeriod(
                '1904', '1908', RII_START, RII_END
            )) {
                missing.push(
                    'predicate: 1904–1908 should be in Rapid II'
                );
            }
            if (intervalOverlapsPeriod(
                '1905', '', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1905–present should NOT be in Rapid'
                );
            }
            if (!intervalOverlapsPeriod(
                '1905', '', RII_START, RII_END
            )) {
                missing.push(
                    'predicate: 1905–present should be in Rapid II'
                );
            }
            if (intervalOverlapsPeriod(
                '1906', '1910', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1906–1910 should NOT be in Rapid'
                );
            }
            if (!intervalOverlapsPeriod(
                '1906', '1910', RII_START, RII_END
            )) {
                missing.push(
                    'predicate: 1906–1910 should be in Rapid II'
                );
            }
            if (intervalOverlapsPeriod(
                '1898', '1899', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1898–1899 should NOT be in Rapid'
                );
            }

            if (rankingInPeriod('1904', RAPID_START, RAPID_END) !== true) {
                missing.push(
                    'ranking: 1904 should be in Rapid'
                );
            }
            if (rankingInPeriod('1905', RAPID_START, RAPID_END) !== false) {
                missing.push(
                    'ranking: 1905 should NOT be in Rapid'
                );
            }
            if (rankingInPeriod('1905', RII_START, RII_END) !== true) {
                missing.push(
                    'ranking: 1905 should be in Rapid II'
                );
            }
            if (rankingInPeriod('1904', RII_START, RII_END) !== false) {
                missing.push(
                    'ranking: 1904 should NOT be in Rapid II'
                );
            }

            var mockTeam = {
                rankingHistory: [
                    { period: '1904', rank: 3 },
                    { period: '1907', rank: 5 }
                ]
            };

            var e1903 = getEffectiveRanking(mockTeam, '1903');
            if (e1903.rank !== null) {
                missing.push(
                    'inheritance: 1903 should be null, got ' +
                    e1903.rank
                );
            }

            var e1904 = getEffectiveRanking(mockTeam, '1904');
            if (e1904.rank !== 3 || e1904.explicit !== true) {
                missing.push(
                    'inheritance: 1904 should be explicit #3'
                );
            }

            var e1905 = getEffectiveRanking(mockTeam, '1905');
            if (e1905.rank !== 3 || e1905.explicit !== false) {
                missing.push(
                    'inheritance: 1905 should inherit #3'
                );
            }

            if (getEffectiveRanking(mockTeam, '1906').rank !== 3) {
                missing.push(
                    'inheritance: 1906 should inherit #3'
                );
            }

            var e1907 = getEffectiveRanking(mockTeam, '1907');
            if (e1907.rank !== 5 || e1907.explicit !== true) {
                missing.push(
                    'inheritance: 1907 should be explicit #5'
                );
            }

            if (getEffectiveRanking(mockTeam, '1908').rank !== 5) {
                missing.push(
                    'inheritance: 1908 should inherit #5'
                );
            }

            if (getRankAtPeriod(mockTeam, '1905') !== 3) {
                missing.push(
                    'getRankAtPeriod(1905) should be 3'
                );
            }
            if (getRankAtPeriod(mockTeam, '1907') !== 5) {
                missing.push(
                    'getRankAtPeriod(1907) should be 5'
                );
            }

            if (hasExplicitRankingAt(mockTeam, '1904') !== true) {
                missing.push(
                    'hasExplicitRankingAt(1904) should be true'
                );
            }
            if (hasExplicitRankingAt(mockTeam, '1905') !== false) {
                missing.push(
                    'hasExplicitRankingAt(1905) should be false'
                );
            }

            var ranges = getRankingHistoryWithRanges(mockTeam);
            if (ranges.length !== 2 ||
                ranges[0].governsFrom !== 1904 ||
                ranges[0].governsTo !== 1907 ||
                ranges[1].governsFrom !== 1907 ||
                ranges[1].governsTo !== null) {
                missing.push(
                    'ranking ranges: expected [1904->1907, ' +
                    '1907->null], got ' + JSON.stringify(ranges)
                );
            }

            // ---- Ordered-list smoke test: empty year. ----
            var emptyOrder = getExplicitRankingOrderForYear('1999');
            if (!Array.isArray(emptyOrder) || emptyOrder.length !== 0) {
                missing.push(
                    'getExplicitRankingOrderForYear: empty year ' +
                    'should return []'
                );
            }

            var emptyRanked = getRankedTeamsForYear('1999');
            if (!Array.isArray(emptyRanked) || emptyRanked.length !== 0) {
                missing.push(
                    'getRankedTeamsForYear: empty year should ' +
                    'return []'
                );
            }

            var emptyUnranked = getUnrankedTeamsForYear('1999');
            if (!Array.isArray(emptyUnranked)) {
                missing.push(
                    'getUnrankedTeamsForYear: should return an array'
                );
            }

            // ---- Ordered-list smoke test: invalid year. ----
            var badOrder = getExplicitRankingOrderForYear('not-a-year');
            if (!Array.isArray(badOrder) || badOrder.length !== 0) {
                missing.push(
                    'getExplicitRankingOrderForYear: invalid year ' +
                    'should return []'
                );
            }

            var badRanked = getRankedTeamsForYear(null);
            if (!Array.isArray(badRanked) || badRanked.length !== 0) {
                missing.push(
                    'getRankedTeamsForYear: null year should ' +
                    'return []'
                );
            }

            var badUnranked = getUnrankedTeamsForYear(undefined);
            if (!Array.isArray(badUnranked) || badUnranked.length !== 0) {
                missing.push(
                    'getUnrankedTeamsForYear: undefined year ' +
                    'should return []'
                );
            }

            // ---- showInactive smoke test (this revision). ----
            try {
                // Accepts options without throwing.
                var withOpts = getRankedTeamsForYear('1999', {
                    showInactive: true
                });
                if (!Array.isArray(withOpts)) {
                    missing.push(
                        'getRankedTeamsForYear: options arg broke ' +
                        'the return type'
                    );
                }

                var unrankedWithOpts = getUnrankedTeamsForYear(
                    '1999', { showInactive: true }
                );
                if (!Array.isArray(unrankedWithOpts)) {
                    missing.push(
                        'getUnrankedTeamsForYear: options arg broke ' +
                        'the return type'
                    );
                }
            } catch (e) {
                missing.push(
                    'showInactive smoke test threw: ' + e.message
                );
            }
        } catch (e) {
            missing.push('predicate smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamQueries] Verification — some exports may be ' +
                'missing or broken:', missing.join(', ')
            );
        }
    })();

})();
