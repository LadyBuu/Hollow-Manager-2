/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams
 * WEEK-SCOPED TEAM VISIBILITY for the Academy Weekly Teams view.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * WHAT THIS MODULE OWNS:
 *   The week window during which a persistent Team entity appears in
 *   the Weekly Teams view for a class. A weekly-team record is a
 *   thin wrapper:
 *
 *     academy.weeklyTeams[classId][teamId] = {
 *       id, classId, teamId,
 *       startWeek, endWeek,       // null = ongoing; endWeek inclusive
 *       createdAt, updatedAt
 *     }
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   Team membership. The roster lives EXCLUSIVELY on the persistent
 *   Team entity's members[] array (with joinPeriod / leavePeriod as
 *   the week range). v22 collapsed the redundant local array that
 *   used to live on weekly-team records. The writers here route
 *   membership mutations through transaction-local helpers that
 *   operate on the persistent Team entity.
 *
 * READS:
 *   - getWeeklyTeams(classId, week)
 *       Returns { [teamId]: [charId, ...] } for every team active
 *       in the week. Membership comes from
 *       TeamQueries.getActiveTeamMembers. The weekly-team record
 *       gates which teams are visible at all.
 *   - getActiveMembers(classId, teamId, week)
 *   - getOrphanAcademicTeams()
 *   - suggestClassForTeam(teamId)
 *
 * WRITES (v24):
 *   - ensureWindow(classId, teamId, week)
 *       Creates the weekly-team window record if it does not exist;
 *       otherwise widens it to include the week. Does NOT shrink.
 *   - setWindow(classId, teamId, startWeek, endWeek)
 *       REPLACES the window for (classId, teamId). Used when a team's
 *       own startPeriod / endPeriod changes: the window is re-synced
 *       to match the persistent Team entity. Removes any existing
 *       window for this team from every class bucket first.
 *   - addMember(classId, teamId, charId, week)
 *   - endMembership(classId, teamId, charId, effectiveWeek)
 *   - [FIX-W1] updateMemberWindow(classId, teamId, charId, updates)
 *       Edit the member's own joinPeriod / leavePeriod fields
 *       directly. Accepts either field as undefined (leave alone),
 *       empty (unbounded), or a week value. Used by the weekly-team
 *       member manager's editable period inputs.
 *   - purgeMemberRecords(classId, teamId, charId)
 *   - removeTeamRecord(classId, teamId)
 *   - clearClassWindows(classId)
 *   - clearAllMembershipsForClass(classId, week)
 *   - assignTeamToClass(classId, teamId)
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded [MIN_WEEK, MAX_WEEK].
 *   - startWeek and endWeek are integers in that range.
 *   - endWeek === null means "ongoing".
 *   - endWeek is INCLUSIVE.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils          (deepClone)
 *   - window.ValidationUtils      (isNonEmptyString)
 *   - window.CalendarValidation   (parseWeek)
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)
 *   - window.MutationPipeline     (performMutation)
 *   - window.TeamQueries          (getTeamById, getActiveTeamMembers,
 *                                  getTeamsByClass, isTeamActiveAtPeriod)
 *   - window.TeamConstants        (parsePeriod, normalizeTeamType)
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

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils || typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
        _missing.push('TeamQueries.getTeamsByClass');
    }
    if (!TeamQueries || typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries.isTeamActiveAtPeriod');
    }
    if (!TeamConstants || typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeams] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsLoaded = true;

    diag('Module loaded (v24, no local member array, class-validated, editable windows).');

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
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyWeeklyTeams] deepClone returned the original reference.'
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

    function weekInRange(week, start, end) {
        if (start === null || start === undefined) {
            return false;
        }
        if (week < start) {
            return false;
        }
        if (end !== null && end !== undefined && week > end) {
            return false;
        }
        return true;
    }

    /**
     * Transaction-local membership window predicate.
     */
    function memberActiveInWeek(member, week) {
        if (!member || typeof member !== 'object') {
            return false;
        }
        var join = TeamConstants.parsePeriod(member.joinPeriod);
        var leave = TeamConstants.parsePeriod(member.leavePeriod);

        if (join !== null && week < join) {
            return false;
        }
        if (leave !== null && week > leave) {
            return false;
        }
        return true;
    }

    function recordActiveInWeek(record, week) {
        if (!record) {
            return false;
        }
        return weekInRange(week, record.startWeek, record.endWeek);
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
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
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function ensureStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
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
        if (!store || !isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
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

    function getTeamRecordInternal(classId, teamId) {
        return getTeamRecordInternalFromStore(getStore(), classId, teamId);
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

    /**
     * Validate inside a transaction that the team exists and belongs
     * to the given class. Returns null on success, or an error
     * message string on failure.
     */
    function validateTeamClassInSnapshot(appData, teamId, classId) {
        var team = findTeamInSnapshot(appData, teamId);
        if (!team) {
            return 'Team no longer exists.';
        }
        if (team.classId === null || team.classId === undefined || team.classId === '') {
            return 'Team is not assigned to a class. Assign a class first.';
        }
        if (String(team.classId) !== String(classId)) {
            return 'Team does not belong to this class.';
        }
        return null;
    }

    function syncAddMemberToPersistentRoster(team, charId, startWeek, role) {
        if (!team) {
            return { added: false, updated: false };
        }
        if (!Array.isArray(team.members)) {
            team.members = [];
        }

        var target = String(charId);
        var startStr = String(startWeek);
        var roleStr = isNonEmptyString(role) ? String(role) : 'Member';

        var existing = findMemberInTeam(team, target);

        if (existing) {
            var joinNum = TeamConstants.parsePeriod(existing.joinPeriod);
            var leaveNum = TeamConstants.parsePeriod(existing.leavePeriod);

            if ((joinNum === null || startWeek >= joinNum) &&
                (leaveNum === null || startWeek <= leaveNum)) {
                return { added: false, updated: false };
            }

            if (leaveNum === null || leaveNum >= startWeek) {
                existing.leavePeriod = String(startWeek - 1);
            }

            team.members.push({
                characterId: target,
                role: roleStr,
                joinPeriod: startStr,
                leavePeriod: ''
            });
            return { added: true, updated: false };
        }

        team.members.push({
            characterId: target,
            role: roleStr,
            joinPeriod: startStr,
            leavePeriod: ''
        });
        return { added: true, updated: false };
    }

    function syncEndMembershipOnPersistentRoster(team, charId, effectiveWeek) {
        if (!team || !Array.isArray(team.members)) {
            return { ended: false, reason: 'no-team' };
        }
        var target = String(charId);
        var matched = null;
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (!m) { continue; }
            if (String(m.characterId) !== target) { continue; }
            var join = TeamConstants.parsePeriod(m.joinPeriod);
            var leave = TeamConstants.parsePeriod(m.leavePeriod);
            var activeAtWeek = true;
            if (join !== null && effectiveWeek < join) { activeAtWeek = false; }
            if (leave !== null && effectiveWeek > leave) { activeAtWeek = false; }
            if (activeAtWeek) {
                matched = m;
                break;
            }
        }

        if (!matched) {
            return { ended: false, reason: 'not-active' };
        }

        var matchedJoin = TeamConstants.parsePeriod(matched.joinPeriod);
        if (matchedJoin !== null && matchedJoin >= effectiveWeek) {
            return { ended: false, reason: 'starts-after' };
        }

        matched.leavePeriod = String(effectiveWeek - 1);
        return { ended: true };
    }

    function syncPurgeMemberFromPersistentRoster(team, charId) {
        if (!team || !Array.isArray(team.members)) {
            return { removed: false };
        }
        var target = String(charId);
        var before = team.members.length;
        team.members = team.members.filter(function(m) {
            return !m || String(m.characterId) !== target;
        });
        return { removed: before !== team.members.length };
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getTeamRecord(classId, teamId) {
        var record = getTeamRecordInternal(classId, teamId);
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
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return [];
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }
        if (team.classId === null || team.classId === undefined || team.classId === '') {
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
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return [];
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }
        if (team.classId === null || team.classId === undefined || team.classId === '') {
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
            if (!recordActiveInWeek(record, weekNum)) {
                continue;
            }
            if (!isPersistentTeamVisibleInWeek(teamId, weekNum)) {
                continue;
            }
            result[teamId] = getActiveMembers(classId, teamId, weekNum);
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
            var end = record.endWeek === null || record.endWeek === undefined
                ? null
                : parseWeekStrict(record.endWeek);
            var effectiveEnd = (end === null) ? MAX_WEEK : end;

            for (var w = start; w <= effectiveEnd; w++) {
                weeks[w] = true;
            }
        }
        var result = Object.keys(weeks).map(function(k) { return parseInt(k, 10); });
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
                if (isPlainObject(record) && recordActiveInWeek(record, weekNum)) {
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
        if (!Array.isArray(window.data && window.data.teams)) {
            return [];
        }
        var result = [];
        var teams = window.data.teams;
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') continue;
            if (TeamConstants.normalizeTeamType(team.type) !== 'academic') continue;
            if (team.classId !== null &&
                team.classId !== undefined &&
                team.classId !== '') {
                continue;
            }
            var memberCount = Array.isArray(team.members) ? team.members.length : 0;
            result.push({
                id: String(team.id),
                name: isNonEmptyString(team.name) ? team.name : 'Unnamed Team',
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

    function suggestClassForTeam(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
        if (!window.data || !Array.isArray(window.data.teams) ||
            !Array.isArray(window.data.characters)) {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        var classes = window.data.academy.graduatingClasses;
        if (!classes || typeof classes !== 'object') {
            return null;
        }

        var team = null;
        for (var t = 0; t < window.data.teams.length; t++) {
            if (String(window.data.teams[t].id) === String(teamId)) {
                team = window.data.teams[t];
                break;
            }
        }
        if (!team || !Array.isArray(team.members) || team.members.length === 0) {
            return null;
        }

        var counts = Object.create(null);
        for (var m = 0; m < team.members.length; m++) {
            var member = team.members[m];
            if (!member || !member.characterId) continue;
            var charId = String(member.characterId);
            var char = null;
            for (var c = 0; c < window.data.characters.length; c++) {
                if (String(window.data.characters[c].id) === charId) {
                    char = window.data.characters[c];
                    break;
                }
            }
            if (!char || !Array.isArray(char.classIds)) continue;
            for (var ci = 0; ci < char.classIds.length; ci++) {
                var classId = String(char.classIds[ci]);
                if (!classes[classId]) continue;
                counts[classId] = (counts[classId] || 0) + 1;
            }
        }

        var keys = Object.keys(counts);
        if (keys.length === 0) return null;

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

        if (tie) return null;
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

    // ============================================================
    // MUTATIONS
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
            return Promise.resolve(
                failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
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
                    record = buildNewTeamRecord(targetClass, targetTeam, weekNum);
                    store[targetClass][targetTeam] = record;
                    return { created: true, record: deepClone(record) };
                }

                var changed = false;
                if (typeof record.startWeek !== 'number' || weekNum < record.startWeek) {
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

                return { created: false, changed: changed, record: deepClone(record) };
            },
            logMessage: 'Opened weekly-team window for team ' + targetTeam +
                ' in class ' + targetClass + ' at week ' + weekNum,
            successMessage: 'Team opened for this week.',
            failureMessage: 'Failed to open team for this week.'
        });
    }

    /**
     * REPLACE the weekly-team window for (classId, teamId) with the
     * given range. Removes any existing window for this team from
     * every class bucket first, so a re-range cannot leave a stale
     * duplicate behind.
     *
     * Used when a team's own startPeriod / endPeriod changes: the
     * window is re-synced to match the persistent Team entity.
     *
     * endWeek === null means ongoing.
     */
    function setWindow(classId, teamId, startWeek, endWeek) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var startNum = parseWeekStrict(startWeek);
        if (startNum === null) {
            return Promise.resolve(
                failure('Valid start week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var endNum = null;
        if (endWeek !== undefined && endWeek !== null && endWeek !== '') {
            endNum = parseWeekStrict(endWeek);
            if (endNum === null) {
                return Promise.resolve(
                    failure('Valid end week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
                );
            }
            if (endNum < startNum) {
                return Promise.resolve(
                    failure('End week cannot be before start week.')
                );
            }
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);

                // Purge any existing window for this team across all
                // class buckets.
                var classIds = Object.keys(store);
                for (var c = 0; c < classIds.length; c++) {
                    var bucket = store[classIds[c]];
                    if (bucket && typeof bucket === 'object' && bucket[targetTeam]) {
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
            logMessage: 'Re-ranged weekly-team window for team ' + targetTeam +
                ' in class ' + targetClass +
                ' (weeks ' + startNum + '-' +
                (endNum === null ? 'ongoing' : endNum) + ')',
            successMessage: 'Team window updated.',
            failureMessage: 'Failed to update team window.'
        });
    }

    /**
     * Assign an orphan academic team to a class.
     */
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
                    return { valid: false, message: 'Application data is not available.' };
                }
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                if (TeamConstants.normalizeTeamType(team.type) !== 'academic') {
                    return { valid: false, message: 'Only academic teams can be assigned to a class.' };
                }
                if (team.classId !== null &&
                    team.classId !== undefined &&
                    team.classId !== '') {
                    if (String(team.classId) === targetClass) {
                        return { valid: true };
                    }
                    return {
                        valid: false,
                        message: 'Team is already assigned to a different class.'
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

                var startWeek = TeamConstants.parsePeriod(team.startPeriod);
                var endWeek = TeamConstants.parsePeriod(team.endPeriod);

                if (startWeek !== null && !store[targetClass][targetTeam]) {
                    var now = new Date().toISOString();
                    store[targetClass][targetTeam] = {
                        id: targetTeam,
                        classId: targetClass,
                        teamId: targetTeam,
                        startWeek: startWeek,
                        endWeek: endWeek,
                        createdAt: (typeof team.createdAt === 'string' && team.createdAt)
                            ? team.createdAt
                            : now,
                        updatedAt: now
                    };
                }

                return { teamId: targetTeam, classId: targetClass };
            },
            logMessage: 'Assigned team ' + targetTeam + ' to class ' + targetClass,
            successMessage: 'Team assigned to class.',
            failureMessage: 'Failed to assign team to class.'
        });
    }

    function addMember(classId, teamId, charId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
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
                    record = buildNewTeamRecord(targetClass, targetTeam, weekNum);
                    store[targetClass][targetTeam] = record;
                }

                var windowStart = record.startWeek;
                var windowEnd = record.endWeek;

                if (typeof windowStart !== 'number' || weekNum < windowStart) {
                    record.startWeek = weekNum;
                }
                if (windowEnd !== null && windowEnd !== undefined &&
                    weekNum > windowEnd) {
                    record.endWeek = null;
                }
                record.updatedAt = new Date().toISOString();

                var team = findTeamInSnapshot(appData, targetTeam);
                var syncResult = syncAddMemberToPersistentRoster(
                    team, targetChar, weekNum, 'Member'
                );

                if (team) {
                    team.updatedAt = new Date().toISOString();
                }

                return {
                    added: syncResult.added,
                    updated: syncResult.updated,
                    teamId: targetTeam
                };
            },
            logMessage: 'Added ' + targetChar + ' to team ' + targetTeam +
                ' in ' + targetClass + ' from week ' + weekNum,
            successMessage: 'Member added to team.',
            failureMessage: 'Failed to add member to team.'
        });
    }

    function endMembership(classId, teamId, charId, effectiveWeek) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId) ||
            !isNonEmptyString(charId)) {
            return Promise.resolve(failure('Class, team, and character IDs are required.'));
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid effective week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
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

                var syncResult = syncEndMembershipOnPersistentRoster(
                    team, targetChar, weekNum
                );

                if (syncResult.ended) {
                    team.updatedAt = new Date().toISOString();
                    var store = getStoreFromSnapshot(appData);
                    var record = getTeamRecordInternalFromStore(
                        store, targetClass, targetTeam
                    );
                    if (record) {
                        record.updatedAt = new Date().toISOString();
                    }
                }

                return {
                    ended: syncResult.ended,
                    reason: syncResult.reason,
                    teamId: targetTeam,
                    endWeek: syncResult.ended ? (weekNum - 1) : null
                };
            },
            logMessage: 'Ended membership of ' + targetChar + ' in team ' +
                targetTeam + ' from week ' + weekNum,
            successMessage: 'Member removed from team.',
            failureMessage: 'Failed to remove member from team.'
        });
    }

    // ============================================================
    // [FIX-W1] updateMemberWindow
    // ============================================================
    //
    // Direct edit of a member entry's joinPeriod / leavePeriod.
    //
    // CONTRACT:
    //   updates.joinPeriod / updates.leavePeriod are each:
    //     undefined — leave that field alone.
    //     null or '' — clear it (unbounded on that side).
    //     number or numeric string in [MIN_WEEK, MAX_WEEK] — set it,
    //       canonicalised to a string.
    //
    //   If both are undefined, this is a no-op (success: true with
    //   { changed: false }). No write is performed.
    //
    //   If, after applying the updates, BOTH fields are empty, the
    //   mutation is rejected: a member entry with no bounds at all
    //   is meaningless. The caller must supply at least one bound.
    //
    //   If leavePeriod < joinPeriod with both present, the mutation
    //   is rejected.
    //
    // The mutation is class-scoped: the team must belong to the
    // given class.

    function updateMemberWindow(classId, teamId, charId, updates) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isPlainObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        var joinProvided = updates.joinPeriod !== undefined;
        var leaveProvided = updates.leavePeriod !== undefined;

        if (!joinProvided && !leaveProvided) {
            // No-op. Report success without a write.
            return Promise.resolve(success({
                changed: false,
                teamId: String(teamId),
                characterId: String(charId)
            }));
        }

        // Canonicalise each provided field.
        // '' or null → '' (unbounded).
        // Anything else → must parse as a valid week.
        var canonicalJoin;
        var canonicalLeave;

        if (joinProvided) {
            canonicalJoin = canonicaliseMemberBound(updates.joinPeriod);
            if (canonicalJoin === null) {
                return Promise.resolve(
                    failure('Join week must be blank or between ' +
                        MIN_WEEK + ' and ' + MAX_WEEK + '.')
                );
            }
        }

        if (leaveProvided) {
            canonicalLeave = canonicaliseMemberBound(updates.leavePeriod);
            if (canonicalLeave === null) {
                return Promise.resolve(
                    failure('Leave week must be blank or between ' +
                        MIN_WEEK + ' and ' + MAX_WEEK + '.')
                );
            }
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }

                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { valid: false, message: 'Team no longer exists.' };
                }

                var member = findMemberInTeam(team, targetChar);
                if (!member) {
                    return { valid: false, message: 'Member not found on this team.' };
                }

                // Proposed state after applying the updates.
                var proposedJoin = joinProvided
                    ? canonicalJoin
                    : (member.joinPeriod === undefined ||
                       member.joinPeriod === null
                        ? ''
                        : String(member.joinPeriod));

                var proposedLeave = leaveProvided
                    ? canonicalLeave
                    : (member.leavePeriod === undefined ||
                       member.leavePeriod === null
                        ? ''
                        : String(member.leavePeriod));

                if (proposedJoin === '' && proposedLeave === '') {
                    return {
                        valid: false,
                        message: 'Set at least one of Join or Leave.'
                    };
                }

                if (proposedJoin !== '' && proposedLeave !== '') {
                    var jn = parseInt(proposedJoin, 10);
                    var lv = parseInt(proposedLeave, 10);
                    if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                        return {
                            valid: false,
                            message: 'Leave week cannot be before join week.'
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

                var member = findMemberInTeam(team, targetChar);
                if (!member) {
                    throw new Error('Member not found on team.');
                }

                var changed = false;

                if (joinProvided && member.joinPeriod !== canonicalJoin) {
                    member.joinPeriod = canonicalJoin;
                    changed = true;
                }
                if (leaveProvided && member.leavePeriod !== canonicalLeave) {
                    member.leavePeriod = canonicalLeave;
                    changed = true;
                }

                if (changed) {
                    team.updatedAt = new Date().toISOString();

                    var store = getStoreFromSnapshot(appData);
                    var record = getTeamRecordInternalFromStore(
                        store, targetClass, targetTeam
                    );
                    if (record) {
                        record.updatedAt = new Date().toISOString();
                    }
                }

                return {
                    changed: changed,
                    teamId: targetTeam,
                    characterId: targetChar,
                    joinPeriod: member.joinPeriod,
                    leavePeriod: member.leavePeriod
                };
            },
            logMessage: 'Updated member window on team ' + targetTeam +
                ' for ' + targetChar,
            successMessage: 'Member period updated.',
            failureMessage: 'Failed to update member period.'
        });
    }

    /**
     * Canonicalise a member bound value.
     * undefined/null/'' → '' (unbounded).
     * Number or numeric string → canonical string in bounds.
     * Invalid → null.
     */
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

    function purgeMemberRecords(classId, teamId, charId) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(teamId) ||
            !isNonEmptyString(charId)) {
            return Promise.resolve(failure('Class, team, and character IDs are required.'));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var classError = validateTeamClassInSnapshot(
                    appData, targetTeam, targetClass
                );
                if (classError) {
                    return { valid: false, message: classError };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { removed: false };
                }

                var syncResult = syncPurgeMemberFromPersistentRoster(
                    team, targetChar
                );

                if (syncResult.removed) {
                    team.updatedAt = new Date().toISOString();
                    var store = getStoreFromSnapshot(appData);
                    var record = getTeamRecordInternalFromStore(
                        store, targetClass, targetTeam
                    );
                    if (record) {
                        record.updatedAt = new Date().toISOString();
                    }
                }

                return { removed: syncResult.removed };
            },
            logMessage: 'Purged membership records for ' + targetChar +
                ' in team ' + targetTeam,
            successMessage: 'Membership records removed.',
            failureMessage: 'Failed to remove membership records.'
        });
    }

    function removeTeamRecord(classId, teamId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Class and team IDs are required.'));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
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
                    !Object.prototype.hasOwnProperty.call(byClass, targetTeam)) {
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
                    return { valid: false, message: 'Application data is not available.' };
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
                return 'Cleared ' + (result && result.cleared ? result.cleared : 0) +
                    ' weekly-team window(s) for class ' + targetClass;
            },
            successMessage: function(result) {
                var n = result && result.cleared ? result.cleared : 0;
                if (n === 0) {
                    return 'No teams were scheduled.';
                }
                return 'Cleared ' + n + ' team' + (n === 1 ? '' : 's') +
                    ' from the schedule.';
            },
            failureMessage: 'Failed to clear schedule.'
        });
    }

    function clearAllMembershipsForClass(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                if (!Array.isArray(appData.teams)) {
                    return { valid: false, message: 'Team store is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var teamsProcessed = 0;
                var membershipsRemoved = 0;
                var teams = appData.teams;

                for (var i = 0; i < teams.length; i++) {
                    var team = teams[i];
                    if (!team || typeof team !== 'object') continue;

                    if (TeamConstants.normalizeTeamType(team.type) !== 'academic') continue;

                    if (team.classId === null ||
                        team.classId === undefined ||
                        team.classId === '') continue;
                    if (String(team.classId) !== targetClass) continue;

                    var teamStart = TeamConstants.parsePeriod(team.startPeriod);
                    var teamEnd = TeamConstants.parsePeriod(team.endPeriod);
                    if (teamStart !== null && weekNum < teamStart) continue;
                    if (teamEnd !== null && weekNum > teamEnd) continue;

                    if (!Array.isArray(team.members)) continue;

                    var before = team.members.length;
                    team.members = team.members.filter(function(m) {
                        if (!m) return true;
                        return !memberActiveInWeek(m, weekNum);
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
                return 'Cleared ' + (result && result.membershipsRemoved
                        ? result.membershipsRemoved : 0) +
                    ' membership(s) across ' +
                    (result && result.teamsProcessed
                        ? result.teamsProcessed : 0) +
                    ' team(s) for class ' + targetClass +
                    ' at week ' + weekNum;
            },
            successMessage: function(result) {
                var n = result && result.membershipsRemoved
                    ? result.membershipsRemoved : 0;
                var t = result && result.teamsProcessed
                    ? result.teamsProcessed : 0;
                if (n === 0) {
                    return 'No memberships to clear for this week.';
                }
                return 'Cleared ' + n + ' membership' + (n === 1 ? '' : 's') +
                    ' across ' + t + ' team' + (t === 1 ? '' : 's') + '.';
            },
            failureMessage: 'Failed to clear memberships.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    function endCharacterMemberships(appData, charId, effectiveWeek) {
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
                var member = team.members[j];
                if (!member) { continue; }
                if (String(member.characterId) !== target) { continue; }
                if (member.leavePeriod !== null &&
                    member.leavePeriod !== undefined &&
                    member.leavePeriod !== '') {
                    continue;
                }
                var joinNum = TeamConstants.parsePeriod(member.joinPeriod);
                if (joinNum !== null && joinNum >= weekNum) {
                    continue;
                }
                member.leavePeriod = String(weekNum - 1);
                result.membershipsEnded++;
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
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
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

    window.AcademyWeeklyTeams = {
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

        // Mutations
        ensureWindow: ensureWindow,
        setWindow: setWindow,
        assignTeamToClass: assignTeamToClass,
        addMember: addMember,
        endMembership: endMembership,
        updateMemberWindow: updateMemberWindow,
        purgeMemberRecords: purgeMemberRecords,
        removeTeamRecord: removeTeamRecord,
        clearClassWindows: clearClassWindows,
        clearAllMembershipsForClass: clearAllMembershipsForClass,

        // Cascade helpers
        endCharacterMemberships: endCharacterMemberships,
        stripClassRefs: stripClassRefs,
        stripTeamRefs: stripTeamRefs,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

    (function verify() {
        var exports = window.AcademyWeeklyTeams;
        var required = [
            'getTeamRecord', 'getAllTeamRecords', 'getActiveMembers',
            'getAllMembers', 'getWeeklyTeams', 'isCharacterAssigned',
            'getAssignedTeamId', 'hasScheduledTeams', 'getAllAssignedTeamIds',
            'getAssignedWeeksForClass', 'getAssignedClassesForWeek',
            'isPersistentTeamVisibleInWeek',
            'getOrphanAcademicTeams', 'suggestClassForTeam',
            'ensureWindow', 'setWindow', 'assignTeamToClass',
            'addMember', 'endMembership', 'updateMemberWindow',
            'purgeMemberRecords', 'removeTeamRecord', 'clearClassWindows',
            'clearAllMembershipsForClass',
            'endCharacterMemberships', 'stripClassRefs', 'stripTeamRefs'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            diagWarn('Verification missing:', missing.join(', '));
        } else {
            diag('Verification OK.');
        }
    })();

})();
