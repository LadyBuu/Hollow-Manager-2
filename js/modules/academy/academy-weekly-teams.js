/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams
 * WEEK-SCOPED TEAM VISIBILITY for the Academy Weekly Teams view.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * WHAT THIS MODULE OWNS:
 *   The week window during which a persistent Team entity appears
 *   in the Weekly Teams view for a class:
 *
 *     academy.weeklyTeams[classId][teamId] = {
 *       id, classId, teamId,
 *       startWeek, endWeek,
 *       createdAt, updatedAt
 *     }
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   Team membership. The roster lives on the persistent Team entity's
 *   members[] array, where each entry carries an intervals array.
 *   Membership mutations route through transaction-local helpers
 *   that operate on the persistent Team entity.
 *
 * PREDICATE OWNERSHIP:
 *   Interval and period containment are owned by TeamQueries. This
 *   module does not reimplement them. Specifically:
 *     - "Does this interval contain this week?"
 *         -> TeamQueries.intervalContains
 *     - "Is this member active at this week?"
 *         -> TeamQueries.isMemberActive
 *     - "Does this window contain this week?"
 *         -> TeamQueries.windowContains
 *
 * READS:
 *   - getWeeklyTeams(classId, week)
 *   - getActiveMembers(classId, teamId, week)
 *   - getAllMembers(classId, teamId)
 *   - getOrphanAcademicTeams()
 *   - suggestClassForTeam(teamId)
 *
 * WRITES:
 *   - Window operations: ensureWindow, setWindow, removeTeamRecord,
 *     clearClassWindows, assignTeamToClass.
 *   - Member operations (interval-aware): addMember, addMemberInterval,
 *     endMembership, setLeaveAtWeek, updateMemberWindow,
 *     updateMemberWindows, purgeMemberRecords, removeMemberEntry,
 *     clearAllMembershipsForClass.
 *
 * MEMBER IDENTITY:
 *   Every entry carries a memberId. Mutation entry points accept
 *   either a memberId string or a { characterId, joinPeriod }
 *   composite.
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded [MIN_WEEK, MAX_WEEK].
 *   - Both bounds are inclusive.
 *   - Blank bounds mean "ongoing".
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.MutationPipeline
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.AcademyQueries
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    var _DIAGNOSTIC = false;

    function diag() {
        if (!_DIAGNOSTIC) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[AWT]');
        console.log.apply(console, args);
    }

    function diagWarn() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[AWT]');
        console.warn.apply(console, args);
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils ||
        typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamsByClass !== 'function') {
        _missing.push('TeamQueries.getTeamsByClass');
    }
    if (!TeamQueries ||
        typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries.isTeamActiveAtPeriod');
    }
    if (!TeamQueries ||
        typeof TeamQueries.intervalContains !== 'function') {
        _missing.push('TeamQueries.intervalContains');
    }
    if (!TeamQueries ||
        typeof TeamQueries.isMemberActive !== 'function') {
        _missing.push('TeamQueries.isMemberActive');
    }
    if (!TeamQueries ||
        typeof TeamQueries.windowContains !== 'function') {
        _missing.push('TeamQueries.windowContains');
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!AcademyQueries ||
        typeof AcademyQueries.getClasses !== 'function') {
        _missing.push('AcademyQueries.getClasses');
    }
    if (!AcademyQueries ||
        typeof AcademyQueries.getClass !== 'function') {
        _missing.push('AcademyQueries.getClass');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeams] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsLoaded = true;

    diag('Module loaded (v24, interval-aware, delegate predicates).');

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[AcademyWeeklyTeams] deepClone returned the original ' +
                'reference.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    function canonicaliseMemberBound(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var n = parseWeekStrict(value);
        if (n === null) {
            return null;
        }
        return String(n);
    }

    // ============================================================
    // MEMBER INTERVAL HELPERS — DELEGATE TO TeamQueries
    // ============================================================
    //
    // The canonical implementations live in TeamQueries:
    //   - intervalContains(interval, week)
    //   - isMemberActive(member, week)
    //
    // This module calls them. Do not reimplement them here.

    function findMemberEntryByCharacterId(team, charId) {
        if (!team || !Array.isArray(team.members)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && typeof m === 'object' &&
                String(m.characterId) === target) {
                return m;
            }
        }
        return null;
    }

    function findIntervalInEntry(entry, joinPeriod) {
        if (!entry || !Array.isArray(entry.intervals)) {
            return null;
        }
        var target = (joinPeriod === undefined || joinPeriod === null)
            ? ''
            : String(joinPeriod);
        for (var i = 0; i < entry.intervals.length; i++) {
            var iv = entry.intervals[i];
            if (!iv || typeof iv !== 'object') {
                continue;
            }
            var ivJoin = (iv.joinPeriod === undefined ||
                          iv.joinPeriod === null)
                ? ''
                : String(iv.joinPeriod);
            if (ivJoin === target) {
                return iv;
            }
        }
        return null;
    }

    function resolveMemberByIdentifier(team, identifier) {
        if (!team || !Array.isArray(team.members) || !identifier) {
            return null;
        }

        if (typeof identifier === 'object') {
            var charId =
                identifier.characterId !== undefined &&
                identifier.characterId !== null
                    ? String(identifier.characterId)
                    : null;
            if (charId === null) {
                return null;
            }

            var entry = findMemberEntryByCharacterId(team, charId);
            if (!entry) {
                return null;
            }

            var interval = findIntervalInEntry(
                entry,
                identifier.joinPeriod
            );

            return { entry: entry, interval: interval };
        }

        var targetId = String(identifier);
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (!m || typeof m !== 'object') {
                continue;
            }
            if (m.memberId !== undefined &&
                m.memberId !== null &&
                String(m.memberId) === targetId) {
                return { entry: m, interval: null };
            }
        }
        return null;
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy ||
            typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy ||
            typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function ensureStore(appData) {
        if (!appData.academy ||
            typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.weeklyTeams ||
            typeof appData.academy.weeklyTeams !== 'object' ||
            Array.isArray(appData.academy.weeklyTeams)) {
            appData.academy.weeklyTeams = {};
        }
        return appData.academy.weeklyTeams;
    }

    function getTeamRecordInternalFromStore(store, classId, teamId) {
        if (!store ||
            !isNonEmptyString(classId) ||
            !isNonEmptyString(teamId)) {
            return null;
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return null;
        }
        var record = byClass[String(teamId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    // ============================================================
    // TRANSACTION-LOCAL PERSISTENT-ROSTER HELPERS
    // ============================================================

    function findTeamInSnapshot(appData, teamId) {
        if (!appData || !Array.isArray(appData.teams)) {
            return null;
        }
        var target = String(teamId);
        for (var i = 0; i < appData.teams.length; i++) {
            var t = appData.teams[i];
            if (t && String(t.id) === target) {
                return t;
            }
        }
        return null;
    }

    function findMemberInTeam(team, charId) {
        if (!team || !Array.isArray(team.members)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === target) {
                return m;
            }
        }
        return null;
    }

    function validateTeamClassInSnapshot(appData, teamId, classId) {
        var team = findTeamInSnapshot(appData, teamId);
        if (!team) {
            return 'Team no longer exists.';
        }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return 'Team is not assigned to a class. Assign a class first.';
        }
        if (String(team.classId) !== String(classId)) {
            return 'Team does not belong to this class.';
        }
        return null;
    }

    function generateMemberId() {
        return 'mem_' + Date.now() + '_' +
            Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // INTERVAL OVERLAP — LOCAL, SPECIFIC TO INTERVAL BOUNDS
    // ============================================================
    //
    // TeamQueries does not expose interval-to-interval overlap; it
    // exposes containment. Overlap is a different question and its
    // implementation stays here. The bounds-comparison semantics
    // (blank = unbounded) are the same as everywhere else.

    function effectiveIntervalStart(interval) {
        if (!interval) return 0;
        var v = interval.joinPeriod;
        if (v === undefined || v === null || v === '') return 0;
        var n = TeamConstants.parsePeriod(v);
        return n === null ? 0 : n;
    }

    function effectiveIntervalEnd(interval) {
        if (!interval) return Infinity;
        var v = interval.leavePeriod;
        if (v === undefined || v === null || v === '') return Infinity;
        var n = TeamConstants.parsePeriod(v);
        return n === null ? Infinity : n;
    }

    function intervalsOverlap(a, b) {
        if (!a || !b) {
            return false;
        }
        var aStart = effectiveIntervalStart(a);
        var aEnd = effectiveIntervalEnd(a);
        var bStart = effectiveIntervalStart(b);
        var bEnd = effectiveIntervalEnd(b);
        return aStart <= bEnd && bStart <= aEnd;
    }

    function findSiblingOverlap(entry, proposed, excludeJoin) {
        if (!entry || !Array.isArray(entry.intervals)) {
            return null;
        }

        var exclude = (excludeJoin === undefined || excludeJoin === null)
            ? null
            : String(excludeJoin);

        for (var i = 0; i < entry.intervals.length; i++) {
            var iv = entry.intervals[i];
            if (!iv || typeof iv !== 'object') {
                continue;
            }

            if (exclude !== null) {
                var ivJoin =
                    (iv.joinPeriod === undefined ||
                     iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                if (ivJoin === exclude) {
                    continue;
                }
            }

            if (intervalsOverlap(proposed, iv)) {
                return iv;
            }
        }
        return null;
    }

    /**
     * Add a member interval to the persistent roster.
     *
     * - If no entry exists for the character: create one with a
     *   fresh memberId and a single interval.
     * - If an entry exists: append a new interval after an overlap
     *   check against the entry's other intervals.
     */
    function syncAddMemberIntervalToPersistentRoster(
        team,
        charId,
        joinPeriod,
        leavePeriod,
        role
    ) {
        if (!team) {
            return { added: false, entry: null, reason: 'no-team' };
        }
        if (!Array.isArray(team.members)) {
            team.members = [];
        }

        var target = String(charId);
        var joinStr = canonicaliseMemberBound(joinPeriod);
        var leaveStr = canonicaliseMemberBound(leavePeriod);
        if (joinStr === null || leaveStr === null) {
            return {
                added: false,
                entry: null,
                reason: 'invalid-period'
            };
        }

        var roleStr = isNonEmptyString(role) ? String(role) : 'Member';

        var entry = findMemberInTeam(team, target);
        if (!entry) {
            entry = {
                memberId: generateMemberId(),
                characterId: target,
                role: roleStr,
                intervals: [{
                    joinPeriod: joinStr,
                    leavePeriod: leaveStr
                }]
            };
            team.members.push(entry);
            return { added: true, entry: entry };
        }

        if (!Array.isArray(entry.intervals)) {
            entry.intervals = [];
        }

        var newInterval = {
            joinPeriod: joinStr,
            leavePeriod: leaveStr
        };

        var conflict = findSiblingOverlap(entry, newInterval, null);
        if (conflict) {
            return {
                added: false,
                entry: entry,
                reason: 'overlap',
                conflict: conflict
            };
        }

        entry.intervals.push(newInterval);
        return { added: true, entry: entry };
    }

    /**
     * Close the currently-active interval of a member entry.
     * `effectiveWeek` is the first week the member is NOT on the
     * team.
     */
    function syncEndMembershipOnPersistentRoster(
        team,
        charId,
        effectiveWeek
    ) {
        if (!team || !Array.isArray(team.members)) {
            return { ended: false, reason: 'no-team' };
        }

        var entry = findMemberInTeam(team, String(charId));
        if (!entry || !Array.isArray(entry.intervals)) {
            return { ended: false, reason: 'no-entry' };
        }

        var lastActiveWeek = effectiveWeek - 1;

        var matched = null;
        for (var i = 0; i < entry.intervals.length; i++) {
            if (TeamQueries.intervalContains(
                entry.intervals[i],
                lastActiveWeek
            )) {
                matched = entry.intervals[i];
                break;
            }
        }

        if (!matched) {
            return { ended: false, reason: 'not-active' };
        }

        if (matched.leavePeriod !== undefined &&
            matched.leavePeriod !== null &&
            matched.leavePeriod !== '') {
            var currentLeave =
                TeamConstants.parsePeriod(matched.leavePeriod);
            if (currentLeave !== null &&
                currentLeave <= lastActiveWeek) {
                return { ended: false, reason: 'already-closed' };
            }
        }

        matched.leavePeriod = String(lastActiveWeek);
        return { ended: true, interval: matched };
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getTeamRecord(classId, teamId) {
        var record = getTeamRecordInternalFromStore(
            getStore(),
            classId,
            teamId
        );
        return record ? deepClone(record) : null;
    }

    function getAllTeamRecords(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var store = getStore();
        if (!store) {
            return [];
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return [];
        }
        var result = [];
        var keys = Object.keys(byClass);
        for (var i = 0; i < keys.length; i++) {
            var record = byClass[keys[i]];
            if (isPlainObject(record)) {
                result.push(deepClone(record));
            }
        }
        return result;
    }

    function getActiveMembers(classId, teamId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId)) {
            return [];
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return [];
        }
        if (String(team.classId) !== String(classId)) {
            return [];
        }

        var members = TeamQueries.getActiveTeamMembers(team, weekNum) || [];
        var result = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            if (m && m.characterId) {
                result.push(String(m.characterId));
            }
        }
        return result;
    }

    function getAllMembers(classId, teamId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId)) {
            return [];
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return [];
        }
        if (String(team.classId) !== String(classId)) {
            return [];
        }
        if (!Array.isArray(team.members)) {
            return [];
        }
        return deepClone(team.members);
    }

    function getWeeklyTeams(classId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return {};
        }
        var store = getStore();
        if (!store) {
            return {};
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return {};
        }

        var result = {};
        var teamIds = Object.keys(byClass);
        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var record = byClass[teamId];
            if (!isPlainObject(record)) {
                continue;
            }
            if (!TeamQueries.windowContains(
                record.startWeek,
                record.endWeek,
                weekNum
            )) {
                continue;
            }
            if (!isPersistentTeamVisibleInWeek(teamId, weekNum)) {
                continue;
            }
            result[teamId] = getActiveMembers(
                classId,
                teamId,
                weekNum
            );
        }
        return result;
    }

    function isCharacterAssigned(classId, week, charId) {
        if (!isNonEmptyString(charId)) {
            return false;
        }
        var rosters = getWeeklyTeams(classId, week);
        var target = String(charId);
        var teamIds = Object.keys(rosters);
        for (var i = 0; i < teamIds.length; i++) {
            var members = rosters[teamIds[i]];
            for (var j = 0; j < members.length; j++) {
                if (members[j] === target) {
                    return true;
                }
            }
        }
        return false;
    }

    function getAssignedTeamId(classId, week, charId) {
        if (!isNonEmptyString(charId)) {
            return null;
        }
        var rosters = getWeeklyTeams(classId, week);
        var target = String(charId);
        var teamIds = Object.keys(rosters);
        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = rosters[teamId];
            for (var j = 0; j < members.length; j++) {
                if (members[j] === target) {
                    return teamId;
                }
            }
        }
        return null;
    }

    function hasScheduledTeams(classId, week) {
        var rosters = getWeeklyTeams(classId, week);
        return Object.keys(rosters).length > 0;
    }

    function getAllAssignedTeamIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var store = getStore();
        if (!store) {
            return [];
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return [];
        }
        return Object.keys(byClass);
    }

    function getAssignedWeeksForClass(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var store = getStore();
        if (!store) {
            return [];
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return [];
        }

        var weeks = Object.create(null);
        var teamIds = Object.keys(byClass);
        for (var i = 0; i < teamIds.length; i++) {
            var record = byClass[teamIds[i]];
            if (!isPlainObject(record)) {
                continue;
            }
            var start = parseWeekStrict(record.startWeek);
            if (start === null) {
                continue;
            }
            var end = record.endWeek === null ||
                      record.endWeek === undefined
                ? null
                : parseWeekStrict(record.endWeek);
            var effectiveEnd = (end === null) ? MAX_WEEK : end;

            for (var w = start; w <= effectiveEnd; w++) {
                weeks[w] = true;
            }
        }
        var result = Object.keys(weeks).map(function(k) {
            return parseInt(k, 10);
        });
        result.sort(function(a, b) { return a - b; });
        return result;
    }

    function getAssignedClassesForWeek(week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }
        var store = getStore();
        if (!store) {
            return [];
        }
        var result = [];
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) {
                continue;
            }
            var hasAny = false;
            var teamIds = Object.keys(byClass);
            for (var j = 0; j < teamIds.length; j++) {
                var record = byClass[teamIds[j]];
                if (isPlainObject(record) &&
                    TeamQueries.windowContains(
                        record.startWeek,
                        record.endWeek,
                        weekNum
                    )) {
                    hasAny = true;
                    break;
                }
            }
            if (hasAny) {
                result.push(classIds[i]);
            }
        }
        return result;
    }

    function isPersistentTeamVisibleInWeek(teamId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return false;
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return false;
        }
        return TeamQueries.isTeamActiveAtPeriod(team, weekNum) === true;
    }

    // ============================================================
    // ORPHAN ACADEMIC TEAMS
    // ============================================================

    function getOrphanAcademicTeams() {
        var teams = TeamQueries.getTeams('academic', null, true);
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) {
                continue;
            }
            if (team.classId !== null &&
                team.classId !== undefined &&
                team.classId !== '') {
                continue;
            }
            var memberCount = Array.isArray(team.members)
                ? team.members.length
                : 0;
            result.push({
                id: String(team.id),
                name: isNonEmptyString(team.name)
                    ? team.name
                    : 'Unnamed Team',
                memberCount: memberCount,
                startPeriod: team.startPeriod || '',
                endPeriod: team.endPeriod || '',
                suggestedClassId: suggestClassForTeam(team.id)
            });
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });
        return result;
    }

    /**
     * Suggest a class for a team based on its members' class
     * memberships.
     *
     * The majority class wins; a tie returns null. Reads route
     * through TeamQueries and CharacterQueries — this module does
     * not walk raw storage.
     */
    function suggestClassForTeam(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team ||
            !Array.isArray(team.members) ||
            team.members.length === 0) {
            return null;
        }

        var classes = AcademyQueries.getClasses() || [];
        if (classes.length === 0) {
            return null;
        }

        var validClassIds = Object.create(null);
        for (var c = 0; c < classes.length; c++) {
            var cls = classes[c];
            if (cls && cls.id) {
                validClassIds[String(cls.id)] = true;
            }
        }

        var counts = Object.create(null);

        for (var m = 0; m < team.members.length; m++) {
            var member = team.members[m];
            if (!member || !member.characterId) {
                continue;
            }
            var char = CharacterQueries.getCharacterById(
                member.characterId
            );
            if (!char || !Array.isArray(char.classIds)) {
                continue;
            }
            for (var ci = 0; ci < char.classIds.length; ci++) {
                var classId = String(char.classIds[ci]);
                if (!validClassIds[classId]) {
                    continue;
                }
                counts[classId] = (counts[classId] || 0) + 1;
            }
        }

        var keys = Object.keys(counts);
        if (keys.length === 0) {
            return null;
        }

        var bestClassId = null;
        var bestCount = 0;
        var tie = false;
        for (var k = 0; k < keys.length; k++) {
            var count = counts[keys[k]];
            if (count > bestCount) {
                bestCount = count;
                bestClassId = keys[k];
                tie = false;
            } else if (count === bestCount && bestCount > 0) {
                tie = true;
            }
        }

        if (tie) {
            return null;
        }
        return bestClassId;
    }

    // ============================================================
    // WRITE HELPERS
    // ============================================================

    function buildNewTeamRecord(classId, teamId, week) {
        var now = new Date().toISOString();
        return {
            id: String(teamId),
            classId: String(classId),
            teamId: String(teamId),
            startWeek: week,
            endWeek: null,
            createdAt: now,
            updatedAt: now
        };
    }

    function touchTeamRecord(appData, classId, teamId) {
        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return;
        }
        var record = getTeamRecordInternalFromStore(
            store,
            classId,
            teamId
        );
        if (record) {
            record.updatedAt = new Date().toISOString();
        }
    }

    // ============================================================
    // CHANGE APPLICATION
    // ============================================================
    //
    // applyMemberChange validates and applies a single member
    // interval edit. It reads only from the `team` argument it is
    // given — never from window.data. This is what allows the
    // pipeline's validate() and mutate() phases to call it and
    // guarantee they see identical state: the caller supplies the
    // same `team` reference to both.
    //
    // INVARIANT: do not add any read of window.data or any other
    // global inside this function. Doing so would let the two
    // phases diverge.

    function applyMemberChange(team, change) {
        if (!change || typeof change !== 'object') {
            return { ok: false, message: 'Change must be an object.' };
        }

        var identifier = change.identifier;
        if (!identifier) {
            return {
                ok: false,
                message: 'Change is missing an identifier.'
            };
        }

        var resolved = resolveMemberByIdentifier(team, identifier);
        if (!resolved) {
            return {
                ok: false,
                message: 'Member not found on this team.'
            };
        }

        var entry = resolved.entry;
        var interval = resolved.interval;

        if (change.joinPeriod !== undefined) {
            return {
                ok: false,
                message: 'joinPeriod is immutable; remove the interval ' +
                    'and add a new one.'
            };
        }

        if (change.leavePeriod === undefined) {
            return { ok: true, changed: false };
        }

        if (!interval) {
            return {
                ok: false,
                message: 'A specific interval is required; use ' +
                    '{ characterId, joinPeriod }.'
            };
        }

        var canonicalLeave = canonicaliseMemberBound(
            change.leavePeriod
        );
        if (canonicalLeave === null) {
            return {
                ok: false,
                message: 'Leave week must be blank or between ' +
                    MIN_WEEK + ' and ' + MAX_WEEK + '.'
            };
        }

        var proposedJoin =
            (interval.joinPeriod === undefined ||
             interval.joinPeriod === null)
                ? ''
                : String(interval.joinPeriod);
        var proposedLeave = canonicalLeave;

        if (proposedJoin === '' && proposedLeave === '') {
            return {
                ok: false,
                message: 'Set at least one of Join or Leave.'
            };
        }

        if (proposedJoin !== '' && proposedLeave !== '') {
            var jn = parseInt(proposedJoin, 10);
            var lv = parseInt(proposedLeave, 10);
            if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                return {
                    ok: false,
                    message: 'Leave week cannot be before join week.'
                };
            }
        }

        var proposed = {
            joinPeriod: proposedJoin,
            leavePeriod: proposedLeave
        };
        var conflict = findSiblingOverlap(
            entry,
            proposed,
            proposedJoin
        );
        if (conflict) {
            return {
                ok: false,
                message: 'Leave week ' +
                    (proposedLeave || '(ongoing)') +
                    ' would overlap another stint of the same member ' +
                    '(join ' + (conflict.joinPeriod || '\u2014') +
                    ', leave ' + (conflict.leavePeriod || '\u2014') + ').'
            };
        }

        var changed = false;
        var currentLeave =
            (interval.leavePeriod === undefined ||
             interval.leavePeriod === null)
                ? ''
                : String(interval.leavePeriod);

        if (currentLeave !== canonicalLeave) {
            interval.leavePeriod = canonicalLeave;
            changed = true;
        }

        return { ok: true, changed: changed };
    }

    // ============================================================
    // MUTATIONS — WINDOW
    // ============================================================

    function ensureWindow(classId, teamId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                var record = store[targetClass][targetTeam];
                if (!isPlainObject(record)) {
                    record = buildNewTeamRecord(
                        targetClass,
                        targetTeam,
                        weekNum
                    );
                    store[targetClass][targetTeam] = record;
                    return {
                        created: true,
                        record: deepClone(record)
                    };
                }

                var changed = false;
                if (typeof record.startWeek !== 'number' ||
                    weekNum < record.startWeek) {
                    record.startWeek = weekNum;
                    changed = true;
                }
                if (record.endWeek !== null &&
                    record.endWeek !== undefined &&
                    weekNum > record.endWeek) {
                    record.endWeek = null;
                    changed = true;
                }
                if (changed) {
                    record.updatedAt = new Date().toISOString();
                }

                return {
                    created: false,
                    changed: changed,
                    record: deepClone(record)
                };
            },
            logMessage: 'Opened weekly-team window for team ' +
                targetTeam + ' in class ' + targetClass +
                ' at week ' + weekNum,
            successMessage: 'Team opened for this week.',
            failureMessage: 'Failed to open team for this week.'
        });
    }

    function setWindow(classId, teamId, startWeek, endWeek) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var startNum = parseWeekStrict(startWeek);
        if (startNum === null) {
            return Promise.resolve(failure(
                'Valid start week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var endNum = null;
        if (endWeek !== undefined &&
            endWeek !== null &&
            endWeek !== '') {
            endNum = parseWeekStrict(endWeek);
            if (endNum === null) {
                return Promise.resolve(failure(
                    'Valid end week is required (' +
                    MIN_WEEK + '-' + MAX_WEEK + ').'
                ));
            }
            if (endNum < startNum) {
                return Promise.resolve(failure(
                    'End week cannot be before start week.'
                ));
            }
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);

                var classIds = Object.keys(store);
                for (var c = 0; c < classIds.length; c++) {
                    var bucket = store[classIds[c]];
                    if (bucket && typeof bucket === 'object' &&
                        bucket[targetTeam]) {
                        delete bucket[targetTeam];
                        if (Object.keys(bucket).length === 0) {
                            delete store[classIds[c]];
                        }
                    }
                }

                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                var now = new Date().toISOString();
                store[targetClass][targetTeam] = {
                    id: targetTeam,
                    classId: targetClass,
                    teamId: targetTeam,
                    startWeek: startNum,
                    endWeek: endNum,
                    createdAt: now,
                    updatedAt: now
                };

                return {
                    teamId: targetTeam,
                    classId: targetClass,
                    startWeek: startNum,
                    endWeek: endNum
                };
            },
            logMessage: 'Re-ranged weekly-team window for team ' +
                targetTeam + ' in class ' + targetClass +
                ' (weeks ' + startNum + '-' +
                (endNum === null ? 'ongoing' : endNum) + ')',
            successMessage: 'Team window updated.',
            failureMessage: 'Failed to update team window.'
        });
    }

    function assignTeamToClass(classId, teamId) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                if (TeamConstants.normalizeTeamType(team.type) !==
                    'academic') {
                    return {
                        valid: false,
                        message: 'Only academic teams can be assigned ' +
                            'to a class.'
                    };
                }
                if (team.classId !== null &&
                    team.classId !== undefined &&
                    team.classId !== '') {
                    if (String(team.classId) === targetClass) {
                        return { valid: true };
                    }
                    return {
                        valid: false,
                        message: 'Team is already assigned to a ' +
                            'different class.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    throw new Error('Team not found in data store.');
                }

                team.classId = targetClass;
                team.updatedAt = new Date().toISOString();

                var store = ensureStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                var startWeek =
                    TeamConstants.parsePeriod(team.startPeriod);
                var endWeek =
                    TeamConstants.parsePeriod(team.endPeriod);

                if (startWeek !== null &&
                    !store[targetClass][targetTeam]) {
                    var now = new Date().toISOString();
                    store[targetClass][targetTeam] = {
                        id: targetTeam,
                        classId: targetClass,
                        teamId: targetTeam,
                        startWeek: startWeek,
                        endWeek: endWeek,
                        createdAt: (typeof team.createdAt === 'string' &&
                                    team.createdAt)
                            ? team.createdAt
                            : now,
                        updatedAt: now
                    };
                }

                return {
                    teamId: targetTeam,
                    classId: targetClass
                };
            },
            logMessage: 'Assigned team ' + targetTeam +
                ' to class ' + targetClass,
            successMessage: 'Team assigned to class.',
            failureMessage: 'Failed to assign team to class.'
        });
    }

    // ============================================================
    // MUTATIONS — MEMBER
    // ============================================================

    function addMember(classId, teamId, charId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                var record = store[targetClass][targetTeam];
                if (!isPlainObject(record)) {
                    record = buildNewTeamRecord(
                        targetClass,
                        targetTeam,
                        weekNum
                    );
                    store[targetClass][targetTeam] = record;
                }

                var windowStart = record.startWeek;
                var windowEnd = record.endWeek;

                if (typeof windowStart !== 'number' ||
                    weekNum < windowStart) {
                    record.startWeek = weekNum;
                }
                if (windowEnd !== null &&
                    windowEnd !== undefined &&
                    weekNum > windowEnd) {
                    record.endWeek = null;
                }
                record.updatedAt = new Date().toISOString();

                var team = findTeamInSnapshot(appData, targetTeam);
                var syncResult =
                    syncAddMemberIntervalToPersistentRoster(
                        team,
                        targetChar,
                        String(weekNum),
                        '',
                        'Member'
                    );

                if (syncResult.reason === 'overlap') {
                    throw new Error(
                        'The new interval overlaps an existing one ' +
                        'for this character.'
                    );
                }
                if (syncResult.reason === 'invalid-period') {
                    throw new Error('Invalid period.');
                }

                if (team) {
                    team.updatedAt = new Date().toISOString();
                }

                return {
                    added: syncResult.added,
                    teamId: targetTeam
                };
            },
            logMessage: 'Added ' + targetChar + ' to team ' +
                targetTeam + ' in ' + targetClass +
                ' from week ' + weekNum,
            successMessage: 'Member added to team.',
            failureMessage: 'Failed to add member to team.'
        });
    }

    function addMemberInterval(
        classId,
        teamId,
        charId,
        joinPeriod,
        leavePeriod
    ) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var joinCanon = canonicaliseMemberBound(joinPeriod);
        if (joinCanon === null) {
            return Promise.resolve(failure('Invalid join period.'));
        }
        var leaveCanon = canonicaliseMemberBound(leavePeriod);
        if (leaveCanon === null) {
            return Promise.resolve(failure('Invalid leave period.'));
        }

        if (joinCanon === '' && leaveCanon === '') {
            return Promise.resolve(failure(
                'Set at least one of Join or Leave.'
            ));
        }

        if (joinCanon !== '' && leaveCanon !== '') {
            var jn = parseInt(joinCanon, 10);
            var lv = parseInt(leaveCanon, 10);
            if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                return Promise.resolve(failure(
                    'Leave cannot be before join.'
                ));
            }
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                var record = store[targetClass][targetTeam];
                if (!isPlainObject(record)) {
                    var initialWeek = joinCanon !== ''
                        ? parseInt(joinCanon, 10)
                        : MIN_WEEK;
                    record = buildNewTeamRecord(
                        targetClass,
                        targetTeam,
                        initialWeek
                    );
                    store[targetClass][targetTeam] = record;
                }
                record.updatedAt = new Date().toISOString();

                var team = findTeamInSnapshot(appData, targetTeam);
                var syncResult =
                    syncAddMemberIntervalToPersistentRoster(
                        team,
                        targetChar,
                        joinCanon,
                        leaveCanon,
                        'Member'
                    );

                if (syncResult.reason === 'overlap') {
                    throw new Error(
                        'The new interval overlaps an existing one ' +
                        'for this character.'
                    );
                }
                if (syncResult.reason === 'invalid-period') {
                    throw new Error('Invalid period.');
                }

                if (team) {
                    team.updatedAt = new Date().toISOString();
                }

                return {
                    added: syncResult.added,
                    teamId: targetTeam
                };
            },
            logMessage: 'Added interval to ' + targetChar +
                ' on team ' + targetTeam,
            successMessage: 'Interval added.',
            failureMessage: 'Failed to add interval.'
        });
    }

    function endMembership(classId, teamId, charId, effectiveWeek) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId) ||
            !isNonEmptyString(charId)) {
            return Promise.resolve(failure(
                'Class, team, and character IDs are required.'
            ));
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid effective week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { ended: false, reason: 'no-team' };
                }

                var syncResult =
                    syncEndMembershipOnPersistentRoster(
                        team,
                        targetChar,
                        weekNum
                    );

                if (syncResult.ended) {
                    team.updatedAt = new Date().toISOString();
                    touchTeamRecord(
                        appData,
                        targetClass,
                        targetTeam
                    );
                }

                return {
                    ended: syncResult.ended,
                    reason: syncResult.reason,
                    teamId: targetTeam,
                    endWeek: syncResult.ended
                        ? (weekNum - 1)
                        : null
                };
            },
            logMessage: 'Ended membership of ' + targetChar +
                ' in team ' + targetTeam +
                ' effective week ' + weekNum,
            successMessage: 'Member removed from team.',
            failureMessage: 'Failed to remove member from team.'
        });
    }

    function setLeaveAtWeek(classId, teamId, identifier, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!identifier) {
            return Promise.resolve(failure(
                'Member identifier is required.'
            ));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }

                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }

                var resolved = resolveMemberByIdentifier(
                    team,
                    identifier
                );
                if (!resolved) {
                    return {
                        valid: false,
                        message: 'Member not found on this team.'
                    };
                }
                if (!resolved.interval) {
                    return {
                        valid: false,
                        message: 'A specific interval is required; ' +
                            'use { characterId, joinPeriod }.'
                    };
                }

                var interval = resolved.interval;
                var hasJoin = interval.joinPeriod !== undefined &&
                              interval.joinPeriod !== null &&
                              interval.joinPeriod !== '';
                if (hasJoin) {
                    var join = TeamConstants.parsePeriod(
                        interval.joinPeriod
                    );
                    if (join !== null && weekNum < join) {
                        return {
                            valid: false,
                            message: 'Leave week cannot be before the ' +
                                'interval\'s join week.'
                        };
                    }
                }

                var proposed = {
                    joinPeriod: interval.joinPeriod || '',
                    leavePeriod: String(weekNum)
                };
                var conflict = findSiblingOverlap(
                    resolved.entry,
                    proposed,
                    interval.joinPeriod
                );
                if (conflict) {
                    return {
                        valid: false,
                        message: 'Leave week ' + weekNum +
                            ' would overlap another stint of the ' +
                            'same member.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    throw new Error('Team not found in data store.');
                }

                var resolved = resolveMemberByIdentifier(
                    team,
                    identifier
                );
                if (!resolved || !resolved.interval) {
                    throw new Error('Interval not found.');
                }

                resolved.interval.leavePeriod = String(weekNum);
                team.updatedAt = new Date().toISOString();
                touchTeamRecord(appData, targetClass, targetTeam);

                return {
                    teamId: targetTeam,
                    characterId: resolved.entry.characterId,
                    joinPeriod: resolved.interval.joinPeriod,
                    leavePeriod: resolved.interval.leavePeriod
                };
            },
            logMessage: 'Set leave at week ' + weekNum +
                ' for a member of team ' + targetTeam,
            successMessage: 'Member left successfully.',
            failureMessage: 'Failed to set leave.'
        });
    }

    // ============================================================
    // BULK MEMBER WINDOW UPDATES
    // ============================================================

    function updateMemberWindows(classId, teamId, changes) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!Array.isArray(changes)) {
            return Promise.resolve(failure(
                'Changes must be an array.'
            ));
        }
        if (changes.length === 0) {
            return Promise.resolve(success({
                changed: false,
                count: 0
            }));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }

                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }

                for (var i = 0; i < changes.length; i++) {
                    var probe = applyMemberChange(team, changes[i]);
                    if (!probe.ok) {
                        return {
                            valid: false,
                            message: 'Change ' + (i + 1) + ': ' +
                                probe.message
                        };
                    }
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    throw new Error('Team not found in data store.');
                }

                var changedCount = 0;
                for (var i = 0; i < changes.length; i++) {
                    var result = applyMemberChange(team, changes[i]);
                    if (!result.ok) {
                        throw new Error(result.message);
                    }
                    if (result.changed) {
                        changedCount++;
                    }
                }

                if (changedCount > 0) {
                    team.updatedAt = new Date().toISOString();
                    touchTeamRecord(
                        appData,
                        targetClass,
                        targetTeam
                    );
                }

                return {
                    changed: changedCount > 0,
                    count: changedCount
                };
            },
            logMessage: function(result) {
                if (result && result.count > 0) {
                    return 'Updated ' + result.count +
                        ' member window(s) on team ' + targetTeam;
                }
                return 'No member window changes on team ' + targetTeam;
            },
            successMessage: function(result) {
                if (result && result.count > 0) {
                    return 'Member periods updated.';
                }
                return 'No changes to save.';
            },
            failureMessage: 'Failed to update member periods.'
        });
    }

    function updateMemberWindow(
        classId,
        teamId,
        identifier,
        updates
    ) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!identifier) {
            return Promise.resolve(failure(
                'Member identifier is required.'
            ));
        }
        if (!updates || typeof updates !== 'object') {
            return Promise.resolve(failure(
                'Updates must be an object.'
            ));
        }

        var change = {
            identifier: identifier,
            leavePeriod: updates.leavePeriod
        };

        return updateMemberWindows(classId, teamId, [change]);
    }

    function purgeMemberRecords(classId, teamId, identifier) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId)) {
            return Promise.resolve(failure(
                'Class and team IDs are required.'
            ));
        }
        if (!identifier) {
            return Promise.resolve(failure(
                'Member identifier is required.'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var resolved = resolveMemberByIdentifier(
                    team,
                    identifier
                );
                if (!resolved) {
                    return {
                        valid: false,
                        message: 'Member not found on this team.'
                    };
                }
                if (!resolved.interval &&
                    typeof identifier === 'string') {
                    if (Array.isArray(resolved.entry.intervals) &&
                        resolved.entry.intervals.length > 1) {
                        return {
                            valid: false,
                            message: 'Entry has multiple intervals; ' +
                                'specify which one with ' +
                                '{ characterId, joinPeriod }.'
                        };
                    }
                }
                if (!resolved.interval &&
                    typeof identifier !== 'string') {
                    return {
                        valid: false,
                        message: 'Interval not found.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team || !Array.isArray(team.members)) {
                    return { removed: false };
                }

                var resolved = resolveMemberByIdentifier(
                    team,
                    identifier
                );
                if (!resolved) {
                    throw new Error('Member not found on team.');
                }

                var entry = resolved.entry;
                var interval = resolved.interval;

                if (!interval) {
                    if (Array.isArray(entry.intervals) &&
                        entry.intervals.length === 1) {
                        interval = entry.intervals[0];
                    } else {
                        throw new Error('Interval not specified.');
                    }
                }

                var before = entry.intervals.length;
                entry.intervals = entry.intervals.filter(function(iv) {
                    return iv !== interval;
                });
                var removed = before - entry.intervals.length;

                if (removed === 0) {
                    throw new Error('Interval not found.');
                }

                var entryPruned = false;
                if (entry.intervals.length === 0) {
                    var idx = team.members.indexOf(entry);
                    if (idx !== -1) {
                        team.members.splice(idx, 1);
                        entryPruned = true;
                    }
                }

                team.updatedAt = new Date().toISOString();
                touchTeamRecord(appData, targetClass, targetTeam);

                return {
                    removed: true,
                    entryPruned: entryPruned
                };
            },
            logMessage: 'Purged a member interval from team ' +
                targetTeam,
            successMessage: 'Interval removed.',
            failureMessage: 'Failed to remove interval.'
        });
    }

    function removeMemberEntry(classId, teamId, charId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId) ||
            !isNonEmptyString(charId)) {
            return Promise.resolve(failure(
                'Class, team, and character IDs are required.'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                var classError = validateTeamClassInSnapshot(
                    appData,
                    targetTeam,
                    targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                if (!Array.isArray(team.members)) {
                    return {
                        valid: false,
                        message: 'Team has no members array.'
                    };
                }
                var found = false;
                for (var i = 0; i < team.members.length; i++) {
                    if (String(team.members[i].characterId) ===
                        targetChar) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Character is not a member of this ' +
                            'team.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team || !Array.isArray(team.members)) {
                    throw new Error('Team not found in data store.');
                }

                var before = team.members.length;
                team.members = team.members.filter(function(m) {
                    return !m ||
                        String(m.characterId) !== targetChar;
                });
                var removed = before - team.members.length;

                if (removed === 0) {
                    throw new Error(
                        'Character not found in team members.'
                    );
                }

                team.updatedAt = new Date().toISOString();
                touchTeamRecord(appData, targetClass, targetTeam);

                return { removed: removed };
            },
            logMessage: 'Removed whole member entry from team ' +
                targetTeam,
            successMessage: 'Member removed.',
            failureMessage: 'Failed to remove member.'
        });
    }

    function removeTeamRecord(classId, teamId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId)) {
            return Promise.resolve(failure(
                'Class and team IDs are required.'
            ));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    return { removed: false };
                }
                var byClass = store[targetClass];
                if (!isPlainObject(byClass) ||
                    !Object.prototype.hasOwnProperty.call(
                        byClass,
                        targetTeam
                    )) {
                    return { removed: false };
                }
                delete byClass[targetTeam];
                if (Object.keys(byClass).length === 0) {
                    delete store[targetClass];
                }
                return { removed: true };
            },
            logMessage: 'Removed weekly-team record ' + targetTeam +
                ' from class ' + targetClass,
            successMessage: 'Weekly team record removed.',
            failureMessage: 'Failed to remove weekly team record.'
        });
    }

    function clearClassWindows(classId) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    return { cleared: 0 };
                }
                var byClass = store[targetClass];
                if (!isPlainObject(byClass)) {
                    return { cleared: 0 };
                }
                var count = Object.keys(byClass).length;
                delete store[targetClass];
                return { cleared: count };
            },
            logMessage: function(result) {
                return 'Cleared ' +
                    (result && result.cleared ? result.cleared : 0) +
                    ' weekly-team window(s) for class ' + targetClass;
            },
            successMessage: function(result) {
                var n = result && result.cleared ? result.cleared : 0;
                if (n === 0) {
                    return 'No teams were scheduled.';
                }
                return 'Cleared ' + n + ' team' +
                    (n === 1 ? '' : 's') + ' from the schedule.';
            },
            failureMessage: 'Failed to clear schedule.'
        });
    }

    /**
     * Remove every member whose active window covers `week` across
     * every academic team of the class. Past and future stints are
     * untouched.
     */
    function clearAllMembershipsForClass(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' +
                MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!Array.isArray(appData.teams)) {
                    return {
                        valid: false,
                        message: 'Team store is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var teamsProcessed = 0;
                var membershipsRemoved = 0;
                var teams = appData.teams;

                for (var i = 0; i < teams.length; i++) {
                    var team = teams[i];
                    if (!team || typeof team !== 'object') {
                        continue;
                    }

                    if (TeamConstants.normalizeTeamType(team.type) !==
                        'academic') {
                        continue;
                    }

                    if (team.classId === null ||
                        team.classId === undefined ||
                        team.classId === '') {
                        continue;
                    }
                    if (String(team.classId) !== targetClass) {
                        continue;
                    }

                    var teamStart =
                        TeamConstants.parsePeriod(team.startPeriod);
                    var teamEnd =
                        TeamConstants.parsePeriod(team.endPeriod);
                    if (teamStart !== null && weekNum < teamStart) {
                        continue;
                    }
                    if (teamEnd !== null && weekNum > teamEnd) {
                        continue;
                    }

                    if (!Array.isArray(team.members)) {
                        continue;
                    }

                    var before = team.members.length;
                    team.members = team.members.filter(function(m) {
                        if (!m) {
                            return true;
                        }
                        return !TeamQueries.isMemberActive(m, weekNum);
                    });
                    var removed = before - team.members.length;

                    if (removed > 0) {
                        membershipsRemoved += removed;
                        team.updatedAt = new Date().toISOString();
                        teamsProcessed++;
                    }
                }

                return {
                    teamsProcessed: teamsProcessed,
                    membershipsRemoved: membershipsRemoved
                };
            },
            logMessage: function(result) {
                return 'Cleared ' +
                    (result && result.membershipsRemoved
                        ? result.membershipsRemoved
                        : 0) +
                    ' membership(s) across ' +
                    (result && result.teamsProcessed
                        ? result.teamsProcessed
                        : 0) +
                    ' team(s) for class ' + targetClass +
                    ' at week ' + weekNum;
            },
            successMessage: function(result) {
                var n = result && result.membershipsRemoved
                    ? result.membershipsRemoved
                    : 0;
                var t = result && result.teamsProcessed
                    ? result.teamsProcessed
                    : 0;
                if (n === 0) {
                    return 'No memberships to clear for this week.';
                }
                return 'Cleared ' + n + ' membership' +
                    (n === 1 ? '' : 's') +
                    ' across ' + t + ' team' +
                    (t === 1 ? '' : 's') + '.';
            },
            failureMessage: 'Failed to clear memberships.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    function endCharacterMemberships(
        appData,
        charId,
        effectiveWeek
    ) {
        var result = { membershipsEnded: 0 };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }
        if (!Array.isArray(appData.teams)) {
            return result;
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return result;
        }

        var target = String(charId);

        for (var i = 0; i < appData.teams.length; i++) {
            var team = appData.teams[i];
            if (!team || !Array.isArray(team.members)) {
                continue;
            }
            for (var j = 0; j < team.members.length; j++) {
                var entry = team.members[j];
                if (!entry) {
                    continue;
                }
                if (String(entry.characterId) !== target) {
                    continue;
                }
                if (!Array.isArray(entry.intervals)) {
                    continue;
                }

                for (var k = 0; k < entry.intervals.length; k++) {
                    var iv = entry.intervals[k];
                    if (!iv) {
                        continue;
                    }

                    var hasLeave = iv.leavePeriod !== undefined &&
                                   iv.leavePeriod !== null &&
                                   iv.leavePeriod !== '';
                    if (hasLeave) {
                        continue;
                    }

                    var hasJoin = iv.joinPeriod !== undefined &&
                                  iv.joinPeriod !== null &&
                                  iv.joinPeriod !== '';
                    if (hasJoin) {
                        var join =
                            TeamConstants.parsePeriod(iv.joinPeriod);
                        if (join !== null && join >= weekNum) {
                            continue;
                        }
                    }

                    iv.leavePeriod = String(weekNum - 1);
                    result.membershipsEnded++;
                }
            }
        }

        return result;
    }

    function stripClassRefs(appData, classId) {
        var result = { recordsRemoved: 0 };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(classId);
        if (!Object.prototype.hasOwnProperty.call(store, target)) {
            return result;
        }

        var byClass = store[target];
        if (isPlainObject(byClass)) {
            result.recordsRemoved = Object.keys(byClass).length;
        }

        delete store[target];
        return result;
    }

    function stripTeamRefs(appData, teamId) {
        var result = { recordsRemoved: 0 };

        if (!appData || !isNonEmptyString(teamId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(teamId);
        var classIds = Object.keys(store);

        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(
                byClass,
                target
            )) {
                delete byClass[target];
                result.recordsRemoved++;
            }
            if (Object.keys(byClass).length === 0) {
                delete store[classIds[i]];
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeams = Object.freeze({
        // Reads
        getTeamRecord: getTeamRecord,
        getAllTeamRecords: getAllTeamRecords,
        getActiveMembers: getActiveMembers,
        getAllMembers: getAllMembers,
        getWeeklyTeams: getWeeklyTeams,
        isCharacterAssigned: isCharacterAssigned,
        getAssignedTeamId: getAssignedTeamId,
        hasScheduledTeams: hasScheduledTeams,
        getAllAssignedTeamIds: getAllAssignedTeamIds,
        getAssignedWeeksForClass: getAssignedWeeksForClass,
        getAssignedClassesForWeek: getAssignedClassesForWeek,
        isPersistentTeamVisibleInWeek: isPersistentTeamVisibleInWeek,

        // Orphan / assignment
        getOrphanAcademicTeams: getOrphanAcademicTeams,
        suggestClassForTeam: suggestClassForTeam,

        // Window mutations
        ensureWindow: ensureWindow,
        setWindow: setWindow,
        assignTeamToClass: assignTeamToClass,
        removeTeamRecord: removeTeamRecord,
        clearClassWindows: clearClassWindows,

        // Member mutations (interval-aware)
        addMember: addMember,
        addMemberInterval: addMemberInterval,
        endMembership: endMembership,
        setLeaveAtWeek: setLeaveAtWeek,
        updateMemberWindow: updateMemberWindow,
        updateMemberWindows: updateMemberWindows,
        purgeMemberRecords: purgeMemberRecords,
        removeMemberEntry: removeMemberEntry,
        clearAllMembershipsForClass: clearAllMembershipsForClass,

        // Cascade helpers
        endCharacterMemberships: endCharacterMemberships,
        stripClassRefs: stripClassRefs,
        stripTeamRefs: stripTeamRefs,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

})();