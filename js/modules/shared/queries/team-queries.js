/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries.
 *
 * Path: js/modules/shared/queries/team-queries.js
 *
 * WHAT THIS OWNS:
 *   - Team lookup by id, type, class, period.
 *   - Membership predicates (interval, active, former).
 *   - Team-scoped membership reads.
 *   - Character membership reads (all-time, current).
 *   - Ranking queries.
 *   - The professional personnel query: getProfessionalPersonnelAtPeriod.
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

    function getTeamName(teamId) {
        if (!isNonEmptyString(teamId)) { return 'Unassigned'; }
        var team = getTeamByIdInternal(teamId);
        return team ? (team.name || 'Unknown Team') : 'Unknown Team';
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

    // ============================================================
    // STUDENT WINDOW
    // ============================================================
    //
    // The student window is derived from the character's own
    // careerStatus entries. It is the span from the earliest
    // junior-or-senior start to the latest junior-or-senior end
    // (or open when any junior-or-senior entry has a blank end).
    //
    // Returns { from, to, hasPhase }:
    //   hasPhase false when the character has no junior or senior
    //     entry at all. from and to are null.
    //   hasPhase true with from = a year, to = a year or null
    //     (null means still open).

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

    /**
     * Does any professional-team stint for this character overlap
     * the given student window?
     *
     * "Overlap" is inclusive: a stint 1890-1897 overlaps a window
     * 1895-1897. A stint 1890-1894 does NOT overlap 1895-1897.
     *
     * A window with from=null (no parseable start) is treated as
     * unbounded on the left. A window with to=null is unbounded on
     * the right. In both cases, "overlap" is decided by the side
     * that is bounded.
     */
    function stintOverlapsStudentWindow(historyEntry, window) {
        if (!historyEntry ||
            !Array.isArray(historyEntry.teams)) {
            return false;
        }

        var windowFrom = window.from;   // number or null
        var windowTo = window.to;       // number or null (open)

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
                        activeTeam.name || 'Unnamed Team';
                }
            } else if (historyEntry.futureFrom !== null) {
                assignmentStatus = 'future';
                nextTeamId = historyEntry.futureTeamId;
                nextJoinYear = historyEntry.futureFrom;
                var futureTeam = getTeamByIdInternal(nextTeamId);
                if (futureTeam) {
                    nextTeamName =
                        futureTeam.name || 'Unnamed Team';
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
            //
            // The student window is computed from careerStatus.
            // A character with no junior or senior entry at all
            // is not a professional candidate ever: pure support
            // staff, pure instructors, pure civilians.
            var studentWindow = computeStudentWindow(char);
            if (!studentWindow.hasPhase) { continue; }

            // ---- 5. Student window must not overlap any
            //         professional stint. ----
            //
            // A character who was actually on a professional
            // team during their student years is not "available
            // for assignment" during those years. They are
            // excluded entirely.
            //
            // A character whose student phase is untouched by
            // any professional stint is a candidate forever,
            // not only when the query period falls inside the
            // window. The window is a fact about the character,
            // not about the year you are looking at.
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

        if (missing.length > 0) {
            console.warn(
                '[TeamQueries] Verification — some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
