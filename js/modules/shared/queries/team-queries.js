/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries.
 *
 * Path: js/modules/shared/queries/team-queries.js
 *
 * The canonical read surface for the Team domain:
 *   - Team lookup (by ID, by type, by class, by period)
 *   - Membership queries (active members at a period, character
 *     membership, character's teams)
 *   - Member predicates (is-member-active, is-member-former)
 *   - Period predicates (team-window, interval, bounds-based)
 *   - Ranking queries (sorted history, current rank, rank at
 *     period, summary)
 *   - Professional-team-eligible roster (with classification)
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
 *
 * PERIOD PREDICATE OWNERSHIP:
 *   The three predicates below are the canonical answers to "does
 *   this window/interval contain this period?" Every consumer
 *   delegates to them:
 *
 *     teamWindowContains(team, period)
 *       reads team.startPeriod / team.endPeriod
 *
 *     intervalContains(interval, period)
 *       reads interval.joinPeriod / interval.leavePeriod
 *
 *     windowContains(start, end, period)
 *       reads a bare pair of bounds
 *
 *   The bounds-based variant exists for callers that hold a pair of
 *   values without an enclosing object — most notably the
 *   academy.weeklyTeams window record, which stores startWeek /
 *   endWeek. AcademyWeeklyTeams uses it directly.
 *
 * MEMBER PREDICATE OWNERSHIP:
 *   isMemberActive(member, period) and isMemberFormer(member, period)
 *   are the canonical answers to "is this member entry active or
 *   former at this period?" They wrap the interval predicate.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - Academic teams use bounded weeks (1-52) from CalendarConstants
 *     via TeamConstants.
 *   - Non-academic teams accept any integer >= 1.
 *
 * OPERATIONAL SEMANTICS:
 *   A team is operational when it can still be operated on.
 *   Deprecated teams are excluded. Inactive teams are included.
 *
 *       status === 'active'     -> operational
 *       status === 'inactive'   -> operational
 *       status === 'deprecated' -> NOT operational
 *
 * RANKING SEMANTICS:
 *   Ranking history lives on the team entity as `rankingHistory`,
 *   an array of { period, rank }. Team-domain ranking, not Academy
 *   student ranking. `getCurrentRank()` is derived from
 *   `rankingHistory`; it is not a persisted field.
 *
 * MEMBER SEMANTICS:
 *   A team's members live in `team.members[]`. Each member entry is:
 *
 *     {
 *       memberId,
 *       characterId,
 *       role,
 *       intervals: [{ joinPeriod, leavePeriod }, ...]
 *     }
 *
 *   Each interval describes one stint. Both bounds are inclusive.
 *   A blank bound means "unbounded on that side."
 *
 *   A member entry is ACTIVE at period P when at least one of its
 *   intervals contains P. It is FORMER at period P when no interval
 *   contains P and at least one interval has a leavePeriod strictly
 *   before P. The two predicates are mutually exclusive; an entry
 *   with no intervals or with only future intervals is neither.
 *
 * PROFESSIONAL-TEAM-ELIGIBLE ROSTER:
 *   getProfessionalTeamEligibleRoster(year) is the read behind the
 *   Teams tab's Unassigned view. It answers "who is a candidate for
 *   a professional team at year Y, and who is staff instead?"
 *
 *   A character is a CANDIDATE when all of:
 *     - They have reached junior OR senior status by year Y.
 *       (isJuniorOrSeniorByYear)
 *     - They are not deceased as of year Y. (isDeceased)
 *     - They have no elimination record of any kind, any year, any
 *       week. Presence-based. (getEliminationWeek returns non-null)
 *
 *   A character is STAFF when they are an instructor or support
 *   member AT YEAR Y. This is evaluated via getStatusAtYear, so it
 *   is year-scoped: a character who becomes an instructor in 1910
 *   is a candidate for the 1905 roster and staff for the 1915
 *   roster. Same character, two answers.
 *
 *   Every character who passes the candidate filters is returned,
 *   with exactly ONE of:
 *
 *     classification:  'active' | 'future' | 'former' | 'available'
 *
 *   And OPTIONALLY a staff tag:
 *
 *     staffRole:  'instructor' | 'support' | null
 *     staffSince: year | null  (earliest year the character held
 *                               the staff role; may predate year Y)
 *
 *   The consumer decides whether to split the roster into
 *   candidates and staff. The Unassigned view does; other callers
 *   may not.
 *
 *   CLASSIFICATION PRIORITY: active > future > former > available.
 *
 *   The 'future' case exists so the Unassigned view can indicate
 *   that a character is already committed to a professional team
 *   at a later year. This is the "future stint" indicator.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.data          (canonical state)
 *   - window.TeamConstants (mandatory)
 *   - window.ObjectUtils   (mandatory; for deepClone)
 *
 * DEPENDENCIES (LAZY, read at call time):
 *   - window.CharacterQueries    (junior/senior predicate, status at
 *                                 year, career status year, display
 *                                 name, deceased predicate)
 *   - window.CharacterConstants  (staff tier classifier)
 *   - window.EliminationQueries  (elimination presence)
 *
 *   When a lazy dependency is absent, the corresponding filter or
 *   tag is skipped rather than failing closed. The roster query
 *   still returns results; the staff tag is simply null.
 *
 * USAGE:
 *   var TQ = window.TeamQueries;
 *   var team = TQ.getTeamById('team_123');
 *   var teams = TQ.getTeams('professional', 'active');
 *   var members = TQ.getActiveTeamMembers(team, 5);
 *   var isActive = TQ.isTeamActiveAtPeriod(team, 2025);
 *   var rank = TQ.getCurrentRank(team);
 *   var isFormer = TQ.isMemberFormer(memberEntry, 5);
 *   var inWindow = TQ.windowContains(1, 20, 5);
 *   var everOnTeam = TQ.getTeamsForCharacterAllTime('char_1', 'professional');
 *   var roster = TQ.getProfessionalTeamEligibleRoster(1926);
 */

(function() {
    'use strict';

    if (window.__teamQueriesLoaded) {
        return;
    }

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
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

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
                '[TeamQueries] ObjectUtils.deepClone returned the ' +
                'original reference. Read safety is broken.'
            );
        }
        return result;
    }

    function parsePeriod(value) {
        if (typeof TeamConstants.parsePeriod !== 'function') {
            return null;
        }
        return TeamConstants.parsePeriod(value);
    }

    function isOperationalStatus(status) {
        return status === 'active' || status === 'inactive';
    }

    function teamWindowContainsNum(team, periodNum) {
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
        if (!team || typeof team !== 'object') {
            return false;
        }
        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }
        return teamWindowContainsNum(team, periodNum);
    }

    function intervalContains(interval, period) {
        if (!interval || typeof interval !== 'object') {
            return false;
        }
        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }
        return intervalContainsNum(interval, periodNum);
    }

    function windowContains(start, end, period) {
        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }

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
    // MEMBER PREDICATES
    // ============================================================

    function isMemberActive(member, period) {
        if (!member || typeof member !== 'object') {
            return false;
        }
        if (!Array.isArray(member.intervals)) {
            return false;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }

        for (var i = 0; i < member.intervals.length; i++) {
            if (intervalContainsNum(member.intervals[i], periodNum)) {
                return true;
            }
        }
        return false;
    }

    function isMemberFormer(member, period) {
        if (!member || typeof member !== 'object') {
            return false;
        }
        if (!Array.isArray(member.intervals)) {
            return false;
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return false;
        }

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
            if (!hasLeave) {
                continue;
            }

            var leave = parsePeriod(interval.leavePeriod);
            if (leave === null) {
                continue;
            }

            if (leave < periodNum) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // TEAM LOOKUP
    // ============================================================

    function getTeamById(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
        var target = String(teamId);
        var teams = getTeamArray();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' &&
                String(team.id) === target) {
                return clone(team);
            }
        }
        return null;
    }

    function getTeamByIdInternal(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
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

    function getTeamName(teamId) {
        if (!isNonEmptyString(teamId)) {
            return 'Unassigned';
        }
        var team = getTeamByIdInternal(teamId);
        return team ? (team.name || 'Unknown Team') : 'Unknown Team';
    }

    // ============================================================
    // STATUS PREDICATES
    // ============================================================

    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        return isOperationalStatus(team.status);
    }

    function isTeamActive(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }
        return team.status === 'active';
    }

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
            var normalizedType = TeamConstants.normalizeTeamType(type);
            if (normalizedType === null) {
                return [];
            }
            var typeFiltered = [];
            for (var j = 0; j < result.length; j++) {
                if (TeamConstants.normalizeTeamType(result[j].type) ===
                    normalizedType) {
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
        if (!isNonEmptyString(classId)) {
            return [];
        }

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
    // MEMBERSHIP — TEAM-SCOPED READS
    // ============================================================

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

        if (!teamWindowContainsNum(team, periodNum)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }
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
            if (!member || typeof member !== 'object') {
                continue;
            }
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
        var targetJoin = (joinPeriod === undefined || joinPeriod === null)
            ? ''
            : String(joinPeriod);

        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }
            if (String(member.characterId) !== targetChar) {
                continue;
            }
            if (!Array.isArray(member.intervals)) {
                continue;
            }

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
        if (!team || !Array.isArray(team.members)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object') {
                result.push(clone(member));
            }
        }
        return result;
    }

    function getTeamsForCharacter(characterId, period, teamType) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return [];
        }

        var normalizedFilter = null;
        if (teamType !== undefined &&
            teamType !== null &&
            teamType !== '') {
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
                if (TeamConstants.normalizeTeamType(team.type) !==
                    normalizedFilter) {
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
     * Get every team a character has EVER been a member of, by
     * their presence in the team's members array.
     *
     * ALL-TIME, not period-scoped. This does not consult team
     * windows or member interval containment. A character is a
     * member of a team if the team's members array contains any
     * entry with their characterId.
     *
     * The all-time variant exists because the character detail
     * panel needs the full history, not just the current period.
     * It mirrors AcademyClasses.getClassInstructorIds vs
     * getClassInstructorIdsAllTime: two queries, two questions.
     *
     * Deprecated teams are excluded, matching getTeamsForCharacter.
     *
     * @param {string} characterId
     * @param {string} [teamType] - optional type filter
     * @returns {array} Array of cloned team objects
     */
    function getTeamsForCharacterAllTime(characterId, teamType) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var normalizedFilter = null;
        if (teamType !== undefined &&
            teamType !== null &&
            teamType !== '') {
            normalizedFilter = TeamConstants.normalizeTeamType(teamType);
            if (normalizedFilter === null) {
                return [];
            }
        }

        var teams = getTeamArray();
        var target = String(characterId);
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
                if (TeamConstants.normalizeTeamType(team.type) !==
                    normalizedFilter) {
                    continue;
                }
            }

            if (!Array.isArray(team.members)) {
                continue;
            }

            var found = false;
            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (String(member.characterId) === target) {
                    found = true;
                    break;
                }
            }

            if (found) {
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

    function getCharacterTeamMembership(teamId, characterId) {
        var team = getTeamByIdInternal(teamId);
        if (!team) {
            return null;
        }
        return getTeamMember(team, characterId);
    }

    // ============================================================
    // PROFESSIONAL-TEAM-ELIGIBLE ROSTER
    // ============================================================

    /**
     * Classify a character's professional-team state at year Y.
     *
     * Returns one of: 'active', 'future', 'former', 'available'.
     *
     * Priority order (highest first): active, future, former,
     * available. A character with entries on multiple professional
     * teams takes the highest classification, and the returned
     * team name / join year correspond to that highest entry.
     *
     * @param {string} charId
     * @param {number} yearNum
     * @returns {{
     *   classification: string,
     *   activeTeamName: string|null,
     *   futureTeamName: string|null,
     *   futureJoinYear: number|null,
     *   formerTeamName: string|null
     * }}
     */
    function classifyProfessionalState(charId, yearNum) {
        var result = {
            classification: 'available',
            activeTeamName: null,
            futureTeamName: null,
            futureJoinYear: null,
            formerTeamName: null
        };

        var teams = getTeamArray();
        var target = String(charId);

        var earliestFutureYear = null;
        var earliestFutureTeamName = null;

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (team.type !== 'professional') { continue; }
            if (!isTeamOperational(team)) { continue; }
            if (!Array.isArray(team.members)) { continue; }

            var member = null;
            for (var m = 0; m < team.members.length; m++) {
                var entry = team.members[m];
                if (entry && typeof entry === 'object' &&
                    String(entry.characterId) === target) {
                    member = entry;
                    break;
                }
            }
            if (!member) { continue; }
            if (!Array.isArray(member.intervals)) { continue; }

            var teamName = team.name || 'Unnamed Team';

            if (isMemberActive(member, yearNum)) {
                result.classification = 'active';
                result.activeTeamName = teamName;
                return result;
            }

            for (var iv = 0; iv < member.intervals.length; iv++) {
                var interval = member.intervals[iv];
                if (!interval || typeof interval !== 'object') {
                    continue;
                }
                var joinRaw = interval.joinPeriod;
                if (joinRaw === undefined || joinRaw === null ||
                    String(joinRaw).trim() === '') {
                    continue;
                }
                var joinNum = parsePeriod(joinRaw);
                if (joinNum === null) { continue; }
                if (joinNum <= yearNum) { continue; }

                if (earliestFutureYear === null ||
                    joinNum < earliestFutureYear) {
                    earliestFutureYear = joinNum;
                    earliestFutureTeamName = teamName;
                }
            }

            if (isMemberFormer(member, yearNum)) {
                if (result.formerTeamName === null) {
                    result.formerTeamName = teamName;
                }
            }
        }

        if (earliestFutureYear !== null) {
            result.classification = 'future';
            result.futureTeamName = earliestFutureTeamName;
            result.futureJoinYear = earliestFutureYear;
            return result;
        }

        if (result.formerTeamName !== null) {
            result.classification = 'former';
            return result;
        }

        return result;
    }

    /**
     * Is this character staff (instructor or support) as of the
     * given year?
     *
     * Reads CharacterQueries.getStatusAtYear, then routes the
     * result through CharacterConstants.classifyStatus to get the
     * tier. The status-at-year read is year-scoped — a character
     * who becomes an instructor in 1910 is not staff in 1905.
     *
     * Fail-open: when CharacterQueries or CharacterConstants is
     * unavailable, returns false.
     *
     * @param {object} char
     * @param {number} yearNum
     * @returns {boolean}
     */
    function isCharacterStaffAtYear(char, yearNum) {
        var info = getStaffInfoAtYear(char, yearNum);
        return info.role !== null;
    }

    /**
     * Get the character's staff classification at the given year.
     *
     * Returns:
     *   { role: 'instructor' | 'support' | null, since: year | null }
     *
     * `role` is null when the character is not staff at the query
     * year. `since` is the earliest year the character held that
     * role (from getCareerStatusYear), or null when unavailable.
     *
     * Fail-open: when the year-scoped status query or the tier
     * classifier is unavailable, returns { role: null, since: null }.
     *
     * @param {object} char
     * @param {number} yearNum
     * @returns {{ role: string|null, since: number|null }}
     */
    function getStaffInfoAtYear(char, yearNum) {
        var result = { role: null, since: null };

        if (!char || typeof char !== 'object') {
            return result;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries ||
            typeof CharacterQueries.getStatusAtYear !== 'function') {
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

        var CC = getCharacterConstants();
        var tier = null;

        if (CC && typeof CC.classifyStatus === 'function') {
            try {
                tier = CC.classifyStatus(statusAtYear);
            } catch (e) {
                tier = null;
            }
        }

        // Fallback when CharacterConstants is missing: string match.
        if (tier === null) {
            var lowered = statusAtYear.toLowerCase();
            if (lowered.indexOf('instructor') !== -1 ||
                lowered.indexOf('teacher') !== -1 ||
                lowered.indexOf('professor') !== -1) {
                tier = 'instructor';
            } else if (lowered.indexOf('support') !== -1) {
                tier = 'support';
            }
        }

        if (tier !== 'instructor' && tier !== 'support') {
            return result;
        }

        result.role = tier;

        // Earliest year the character held this role, if the
        // query is available.
        if (typeof CharacterQueries.getCareerStatusYear === 'function') {
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

    /**
     * Get every character eligible for a professional team at the
     * given year, with their professional-team state and staff
     * classification.
     *
     * The roster returns EVERY candidate: characters who pass the
     * eligibility filters, plus characters who are staff at the
     * query year but would otherwise be candidates. Staff are
     * tagged with `staffRole` and `staffSince` so the consumer can
     * split the list.
     *
     * ELIGIBILITY (candidate filters — same for everyone):
     *   - Has reached junior OR senior status by year Y.
     *   - Not deceased as of year Y.
     *   - No elimination record of any kind, any year, any week.
     *
     * ADDITIONAL TAGS:
     *   - staffRole:  'instructor' | 'support' | null
     *   - staffSince: year | null
     *
     * See the file header for the full contract.
     *
     * @param {number|string} year
     * @returns {array} Sorted by name ascending
     */
    function getProfessionalTeamEligibleRoster(year) {
        var yearNum = parsePeriod(year);
        if (yearNum === null) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacters !== 'function') {
            return [];
        }

        var EliminationQueries = getEliminationQueries();
        var canCheckElimination = EliminationQueries &&
            typeof EliminationQueries.getEliminationWeek === 'function';

        var canCheckJuniorOrSenior =
            typeof CharacterQueries.isJuniorOrSeniorByYear === 'function';
        var canCheckDeceased =
            typeof CharacterQueries.isDeceased === 'function';
        var canGetJuniorYear =
            typeof CharacterQueries.getJuniorYear === 'function';
        var canGetSeniorYear =
            typeof CharacterQueries.getSeniorYear === 'function';
        var canGetDisplayName =
            typeof CharacterQueries.getDisplayName === 'function';
        var canGetCurrentStatus =
            typeof CharacterQueries.getCurrentStatus === 'function';

        var allChars = CharacterQueries.getCharacters() || [];
        var rows = [];

        for (var i = 0; i < allChars.length; i++) {
            var char = allChars[i];
            if (!char || !char.id) { continue; }
            var cid = String(char.id);

            // 1. Junior or senior by year.
            if (canCheckJuniorOrSenior) {
                var isEligibleStatus = false;
                try {
                    isEligibleStatus =
                        CharacterQueries.isJuniorOrSeniorByYear(
                            char, yearNum
                        ) === true;
                } catch (e) {
                    isEligibleStatus = false;
                }
                if (!isEligibleStatus) { continue; }
            }

            // 2. Deceased.
            if (canCheckDeceased) {
                var deceased = false;
                try {
                    deceased =
                        CharacterQueries.isDeceased(char, yearNum) === true;
                } catch (e) {
                    deceased = char.deceased === true;
                }
                if (deceased) { continue; }
            }

            // 3. Elimination (any year, any week, any kind).
            if (canCheckElimination) {
                var elimWeek = null;
                try {
                    elimWeek = EliminationQueries.getEliminationWeek(cid);
                } catch (e) {
                    elimWeek = null;
                }
                if (elimWeek !== null && elimWeek !== undefined) {
                    continue;
                }
            }

            // 4. Classification.
            var state = classifyProfessionalState(cid, yearNum);

            // 5. Staff classification.
            //
            //    Year-scoped: a character who becomes an instructor
            //    in 1910 is a candidate for the 1905 roster and
            //    staff for the 1915 roster.
            //
            //    Staff are NOT excluded. They are returned with the
            //    staffRole / staffSince fields populated. The
            //    consumer decides whether to split the list.
            var staffInfo = getStaffInfoAtYear(char, yearNum);

            var juniorYear = null;
            if (canGetJuniorYear) {
                try { juniorYear = CharacterQueries.getJuniorYear(char); }
                catch (e) { juniorYear = null; }
            }

            var seniorYear = null;
            if (canGetSeniorYear) {
                try { seniorYear = CharacterQueries.getSeniorYear(char); }
                catch (e) { seniorYear = null; }
            }

            var displayName = 'Unknown';
            if (canGetDisplayName) {
                try { displayName = CharacterQueries.getDisplayName(char); }
                catch (e) { displayName = 'Unknown'; }
            }

            var status = '';
            if (canGetCurrentStatus) {
                try { status = CharacterQueries.getCurrentStatus(char); }
                catch (e) { status = ''; }
            }

            rows.push({
                characterId: cid,
                name: displayName,
                status: status,
                juniorYear: juniorYear,
                seniorYear: seniorYear,
                classification: state.classification,
                activeTeamName: state.activeTeamName,
                futureTeamName: state.futureTeamName,
                futureJoinYear: state.futureJoinYear,
                formerTeamName: state.formerTeamName,

                // Staff tag. Null when the character is not staff
                // at the query year.
                staffRole: staffInfo.role,
                staffSince: staffInfo.since
            });
        }

        rows.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return rows;
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

    function getMostRecentRanking(team) {
        var history = getSortedRankings(team);
        return history.length > 0 ? history[history.length - 1] : null;
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
        if (periodNum === null) {
            return null;
        }

        var target = String(periodNum);
        var history = team.rankingHistory;

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) {
                continue;
            }
            var entryPeriod = parsePeriod(entry.period);
            if (entryPeriod !== null &&
                String(entryPeriod) === target) {
                var rank = parsePeriod(entry.rank);
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

    window.TeamQueries = Object.freeze({
        // Team lookup
        getTeamById: getTeamById,
        getTeamName: getTeamName,

        // Status predicates
        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isTeamActiveAtPeriod: isTeamActiveAtPeriod,

        // Period predicates
        teamWindowContains: teamWindowContains,
        intervalContains: intervalContains,
        windowContains: windowContains,

        // Member predicates
        isMemberActive: isMemberActive,
        isMemberFormer: isMemberFormer,

        // Team lists
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
        getTeamMemberByMemberId: getTeamMemberByMemberId,
        getTeamMemberByComposite: getTeamMemberByComposite,
        getAllTeamMemberRecords: getAllTeamMemberRecords,
        getTeamsForCharacter: getTeamsForCharacter,
        getTeamsForCharacterAllTime: getTeamsForCharacterAllTime,
        getCharacterTeamMembership: getCharacterTeamMembership,

        // Professional-team-eligible roster
        getProfessionalTeamEligibleRoster: getProfessionalTeamEligibleRoster,

        // Staff classification helpers (exposed for consumers)
        isCharacterStaffAtYear: isCharacterStaffAtYear,
        getStaffInfoAtYear: getStaffInfoAtYear,

        // Rankings
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
            'getCharacterTeamMembership',
            'getProfessionalTeamEligibleRoster',
            'isCharacterStaffAtYear', 'getStaffInfoAtYear',
            'getSortedRankings', 'getMostRecentRanking', 'getCurrentRank',
            'getRankAtPeriod', 'hasRankings', 'getRankingSummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamQueries] Verification — some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
