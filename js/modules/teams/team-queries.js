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
 *   - Ranking queries.
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
 * PERIOD PREDICATE OWNERSHIP:
 *   teamWindowContains(team, period)
 *   intervalContains(interval, period)
 *   windowContains(start, end, period)
 *
 * MEMBER PREDICATE OWNERSHIP:
 *   isMemberActive(member, period)
 *   isMemberFormer(member, period)
 *
 * PERIODS MODEL (this revision):
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
 *   WORKED EXAMPLE — Rapid (1900–1905) and Rapid II (1905–):
 *
 *     stint         Rapid        Rapid II
 *     1898–present yes          yes
 *     1900–1904    yes          no
 *     1904–1908    yes          yes
 *     1905–present no           yes
 *     1906–1910    no           yes
 *
 *   The 1905-joiner appears only in Rapid II. The 1904–1908
 *   stint appears in both because it spans the boundary. This is
 *   the rule the split exists to enforce: a new joiner in the
 *   year the identity changed belongs to the NEW period, not the
 *   old one.
 *
 * RANKING RULE:
 *
 *   A ranking entry is included in a period iff:
 *
 *     period.start <= ranking.year < period.end
 *
 *   Same strict upper bound, same infinity for a blank
 *   period.end. A 1905 ranking belongs to Rapid II, not Rapid.
 *
 * SHORTAGE HISTORY:
 *   getTeamShortagePeriods(team, targetSize, toYear) walks every
 *   interval on every member entry of a team, builds a year-by-year
 *   population curve, and returns the runs where the active member
 *   count is strictly below targetSize.
 *
 *   The lower bound of the scan is the team's startPeriod when set,
 *   otherwise the earliest parseable member join period. When
 *   neither is available, the function returns [] — it does not
 *   invent a starting point.
 *
 *   The upper bound is `toYear`. The returned periods are inclusive
 *   on both ends. A period that is still short at `toYear` carries
 *   `to: null`.
 *
 * PROFESSIONAL PERSONNEL QUERY:
 *   getProfessionalPersonnelAtPeriod(period) returns domain facts
 *   about every character relevant to professional staffing.
 *
 *   INCLUSION RULES (all applied here, before the aggregator):
 *     - not deceased at the period
 *     - not eliminated
 *     - not retired (latest career status normalises to 'retired')
 *     - has a junior-or-senior phase in careerStatus
 *     - their student window does NOT overlap any professional
 *       team stint they held. A character whose student phase
 *       was 1895-1897 and who was never placed on a professional
 *       team during those years is a pool candidate FOREVER,
 *       not only when the query period falls inside 1895-1897.
 *
 *   The query period is used for:
 *     - the deceased check
 *     - assignment.status (active / future / available) at the
 *       period
 *     - statusAtPeriod and age for display
 *
 *   The query period is NOT used to filter who appears. Pool
 *   membership is a fact about the character, not about the year
 *   you are looking at.
 *
 *   availability.from / availability.to describe the student
 *   window. They do not depend on the query period.
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
        return status === 'active' || status === 'inactive';
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

    /**
     * Normalise a career status string: lowercase, strip a
     * trailing ' (Former)' suffix, trim.
     */
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

    /**
     * Latest careerStatus entry's normalised status key.
     */
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
    //
    // The canonical predicate for the periods model. Every
    // period-scoped read in this module goes through it.
    //
    // SEMANTICS:
    //
    //   A stint is included in a period iff:
    //
    //     stint.join  <  period.end    (strict)
    //     stint.leave >= period.start  (inclusive)
    //
    //   Where:
    //     - a blank period.end means Infinity
    //     - a blank stint.leave means Infinity
    //     - a blank stint.join is defensive: never legal in the
    //       data model, treated as -Infinity so the predicate
    //       still resolves to a boolean rather than NaN.
    //
    // WHY STRICT ON JOIN:
    //
    //   The whole point of the period split is that a member who
    //   joins in the year the identity changed belongs to the NEW
    //   period, not the old one. Rapid runs 1900–1905; a member
    //   joining in 1905 belongs to Rapid II, not Rapid. A loose
    //   `join <= period.end` check would place them in both, which
    //   is exactly the failure the split exists to prevent.
    //
    // WHY INCLUSIVE ON LEAVE:
    //
    //   A stint's leavePeriod is the member's LAST ACTIVE year
    //   (inclusive). A member who leaves in 1904 was on the team
    //   during 1904. A loose `leave < period.start` check would
    //   wrongly exclude them from a period that starts in 1904.
    //
    // WORKED TABLE (Rapid 1900–1905, Rapid II 1905–):
    //
    //   stint         Rapid   Rapid II
    //   1898–present yes     yes
    //   1900–1904    yes     no
    //   1904–1908    yes     yes
    //   1905–present no      yes
    //   1906–1910    no      yes
    //
    // @param {string|number} join  Stint join year. Never blank in
    //   practice; blank is treated as -Infinity.
    // @param {string|number} leave Stint leave year. Blank means
    //   the stint is open-ended.
    // @param {string|number} start Period start year.
    // @param {string|number} end   Period end year. Blank means
    //   the period is open-ended.
    // @returns {boolean}
    function intervalOverlapsPeriod(join, leave, start, end) {
        var joinNum = parseYear(join);
        var leaveNum = parseYear(leave);
        var startNum = parseYear(start);
        var endNum = parseYear(end);

        // Blank join is defensive only. Never legal in the data
        // model; if it appears, treat it as -Infinity so the
        // predicate still returns a boolean.
        var joinYear = joinNum === null ? -Infinity : joinNum;
        var leaveYear = leaveNum === null ? Infinity : leaveNum;
        var startYear = startNum === null ? -Infinity : startNum;
        var endYear = endNum === null ? Infinity : endNum;

        return joinYear < endYear && leaveYear >= startYear;
    }

    /**
     * The ranking predicate. Same strict-upper-bound contract as
     * intervalOverlapsPeriod, applied to a single year.
     *
     *   period.start <= year < period.end
     *
     * A blank period.end means infinity. A blank period.start
     * (never legal — every period has a start) means -Infinity.
     *
     * @param {string|number} year  The ranking entry's year.
     * @param {string|number} start Period start.
     * @param {string|number} end   Period end; blank means open.
     * @returns {boolean}
     */
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
    //
    // These read the team's `periods` array. The array is written
    // by TeamCore; its shape is documented in team-core.js.
    //
    // Every reader here is defensive: a malformed team (no
    // periods, a period missing its name, etc.) returns a
    // sensible default rather than throwing. The reads are pure
    // projections; they do not validate.

    /**
     * Get every period on the team, in array order. Returns [] for
     * a team with no periods array.
     *
     * The returned array is a shallow copy of the array itself
     * (the entries are shared). A caller that wants to mutate
     * should clone the entries first.
     */
    function getPeriods(team) {
        if (!team || !Array.isArray(team.periods)) {
            return [];
        }
        return team.periods.slice();
    }

    /**
     * Get the current (last) period, or null.
     *
     * "Current" means "the last entry in the array." The periods
     * array is guaranteed by the canonicaliser to be sorted by
     * startPeriod ascending, and only the last entry may carry an
     * empty endPeriod. So the last entry is the open-ended period,
     * which is the team's present.
     *
     * Returns a clone. A caller cannot mutate the live period by
     * mutating the returned object.
     */
    function getCurrentPeriod(team) {
        if (!team || !Array.isArray(team.periods)) {
            return null;
        }
        if (team.periods.length === 0) {
            return null;
        }
        return clone(team.periods[team.periods.length - 1]);
    }

    /**
     * Get the team's current display name.
     *
     * Prefers periods[last].name when the periods array is
     * present and the last entry has a non-empty name. Falls back
     * to team.name, which TeamCore keeps as a denormalised cache
     * of exactly that value. The fallback exists for a team
     * record that somehow reached a reader before canonicalisation
     * ran (an old export mid-import, for example).
     *
     * Returns 'Unknown Team' when neither is available.
     */
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

    /**
     * Find the period whose year range contains the given year.
     *
     * A year is "contained" by a period when:
     *
     *   period.start <= year < period.end    (or period.end is blank)
     *
     * Same half-open contract as intervalOverlapsPeriod and
     * rankingInPeriod. The boundary year belongs to the period
     * that STARTS there.
     *
     * Returns a clone, or null.
     */
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

    /**
     * Get every member entry whose stints overlap the given
     * period.
     *
     * A member is included when ANY of their stints overlaps the
     * period, per intervalOverlapsPeriod. The member is returned
     * whole — every stint, not just the overlapping one. That is
     * deliberate: the reader wants the member, not a filtered
     * view of them. A caller that wants only the stints relevant
     * to the period filters the returned records itself.
     *
     * The returned array is freshly allocated; the entries are
     * clones.
     *
     * @param {object} team
     * @param {object} period  A period entry (as returned by
     *   getCurrentPeriod / getPeriodForYear, or read directly
     *   off the team).
     * @returns {array}
     */
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

    /**
     * Get every ranking entry whose period falls within the given
     * period.
     *
     * Uses rankingInPeriod, the same half-open contract. The
     * returned array is freshly allocated; the entries are
     * clones. Order is the same as the source array (which
     * TeamCore keeps sorted by period).
     *
     * @param {object} team
     * @param {object} period
     * @returns {array}
     */
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

    /**
     * The team's current display name. Reads periods[last].name
     * via getCurrentTeamName; falls back to team.name for a
     * record that predates the periods model. The fallback path
     * is a safety net, not a supported shape.
     */
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
        return team.status === 'active';
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
                return t.status === 'active';
            });
        } else if (status === 'inactive') {
            result = result.filter(function(t) {
                return t.status === 'inactive';
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
                return t.status !== 'deprecated';
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
            if (team && team.type === 'academic' &&
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
            var m = team.members[mr];
            if (!m || !Array.isArray(m.intervals)) { continue; }

            var ranges = [];
            for (var ri = 0; ri < m.intervals.length; ri++) {
                var raw = m.intervals[ri];
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
            if (team.type !== 'professional') { continue; }
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
    // RANKINGS
    // ============================================================

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

    function getMostRecentRanking(team) {
        var history = getSortedRankings(team);
        return history.length > 0
            ? history[history.length - 1]
            : null;
    }

    function getCurrentRank(team) {
        var most = getMostRecentRanking(team);
        return most ? String(most.rank) : '';
    }

    function getRankAtPeriod(team, period) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return null;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) { return null; }

        var target = String(periodNum);
        var history = team.rankingHistory;

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) { continue; }
            var entryPeriod = parsePeriod(entry.period);
            if (entryPeriod !== null &&
                String(entryPeriod) === target) {
                var rank = parsePeriod(entry.rank);
                if (rank !== null) { return rank; }
            }
        }

        return null;
    }

    function hasRankings(team) {
        if (!team) { return false; }
        return getSortedRankings(team).length > 0;
    }

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

        getSortedRankings: getSortedRankings,
        getMostRecentRanking: getMostRecentRanking,
        getCurrentRank: getCurrentRank,
        getRankAtPeriod: getRankAtPeriod,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary
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
            'getSortedRankings', 'getMostRecentRanking',
            'getCurrentRank', 'getRankAtPeriod', 'hasRankings',
            'getRankingSummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // ---- Period predicate smoke test ----
        //
        // The table from the file header. Rapid 1900–1905,
        // Rapid II 1905–''.
        try {
            var RAPID_START = '1900';
            var RAPID_END = '1905';
            var RII_START = '1905';
            var RII_END = '';

            // 1898–present: in both.
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

            // 1900–1904: in Rapid only.
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

            // 1904–1908: in both.
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

            // 1905–present: in Rapid II only.
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

            // 1906–1910: in Rapid II only.
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

            // 1898–1899: in neither.
            if (intervalOverlapsPeriod(
                '1898', '1899', RAPID_START, RAPID_END
            )) {
                missing.push(
                    'predicate: 1898–1899 should NOT be in Rapid'
                );
            }

            // ---- Ranking predicate smoke test ----
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
