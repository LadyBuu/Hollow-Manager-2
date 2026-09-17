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
 * WHAT THIS MODULE DOES NOT OWN (v22):
 *   Team membership. The roster lives EXCLUSIVELY on the persistent
 *   Team entity's members[] array (with joinPeriod / leavePeriod as
 *   the week range). Prior to v22, this module also carried a
 *   redundant `members` array on every weekly-team record. That
 *   array drifted from the persistent roster, producing a UI where
 *   the same team showed one roster in the Weekly Teams view and a
 *   different roster in the Tournaments view. The v22 migration
 *   collapsed the redundant array into the persistent roster and
 *   the writers here now route membership mutations through a
 *   transaction-local helper that operates on the persistent Team
 *   entity.
 *
 * READS:
 *   - getWeeklyTeams(classId, week)
 *       Returns { [teamId]: [charId, ...] } for every team active
 *       in the week. Membership comes from
 *       TeamQueries.getActiveTeamMembers. The weekly-team record
 *       gates which teams are visible at all.
 *   - getActiveMembers(classId, teamId, week)
 *       Delegates to TeamQueries.getActiveTeamMembers.
 *   - isPersistentTeamVisibleInWeek(teamId, week)
 *       The persistent Team entity's own startPeriod / endPeriod.
 *
 * WRITES (v22):
 *   - addMember(classId, teamId, charId, week)
 *       Ensures a weekly-team record exists for (classId, teamId),
 *       then delegates membership to a transaction-local helper
 *       that writes to the persistent Team entity's members[].
 *   - endMembership(classId, teamId, charId, effectiveWeek)
 *       Truncates the member's leavePeriod on the persistent roster
 *       at effectiveWeek - 1. History survives.
 *   - removeMemberRecord(classId, teamId, charId)
 *       Hard-deletes the member's entry from the persistent roster.
 *   - removeTeamRecord(classId, teamId)
 *       Deletes the weekly-team record. Does NOT touch the
 *       persistent Team entity.
 *
 * WHY TRANSACTION-LOCAL HELPERS:
 *   TeamCore's public mutations (addMember, updateMember,
 *   removeMember) each open their own MutationPipeline transaction.
 *   This module also runs through MutationPipeline. Nesting
 *   pipelines deadlocks. The helpers below operate on the appData
 *   snapshot the pipeline hands in, matching the pattern already
 *   used by TournamentEliminationCascade and AcademyCascade.
 *
 * DROP-OUT vs DELETE:
 *   - endMembership: the member's window becomes
 *     [joinPeriod, effectiveWeek - 1]. History survives.
 *   - removeMemberRecord: hard delete, no history.
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
 *   - window.TeamQueries          (getTeamById, getActiveTeamMembers)
 *   - window.TeamConstants        (parsePeriod, getPeriodRange)
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

    diag('Module loaded (v22, no local member array).');

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

    function getTeamWindow(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }
        var start = TeamConstants.parsePeriod(team.startPeriod);
        var end = TeamConstants.parsePeriod(team.endPeriod);
        return {
            team: team,
            start: start,
            end: end
        };
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
     * Is the persistent Team entity itself visible in the given week?
     * This is the TEAM's own window, not the weekly-team record's
     * window. Both must agree for a team to appear in a given week.
     *
     * A team with no startPeriod and no endPeriod is treated as
     * "always visible" — there is nothing to constrain it.
     */
    function isPersistentTeamVisibleInWeek(teamId, week) {
        var windowInfo = getTeamWindow(teamId);
        if (!windowInfo) {
            return false;
        }

        var start = windowInfo.start;
        var end = windowInfo.end;

        if (start === null && end === null) {
            return true;
        }
        if (start !== null && week < start) {
            return false;
        }
        if (end !== null && week > end) {
            return false;
        }
        return true;
    }

    /**
     * Is a member of the persistent roster active in the given week?
     * The member record uses joinPeriod / leavePeriod as the range.
     * Empty joinPeriod means "from the beginning"; empty leavePeriod
     * means "ongoing".
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
    // STORE ACCESS - weekly-team window records only
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
    //
    // These operate on the appData snapshot the pipeline hands in.
    // They mirror the write semantics of TeamCore.addMember /
    // TeamCore.updateMember / TeamCore.removeMember, but they do NOT
    // open their own transaction. They exist here because
    // AcademyWeeklyTeams.addMember / endMembership /
    // removeMemberRecord already run inside a MutationPipeline
    // transaction and cannot nest a second one.

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
     * Add a member to the persistent team's roster, or update the
     * existing entry's range if one is already present.
     *
     * Returns { added: boolean, updated: boolean }.
     */
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
            // If the existing entry is already active at this week, no-op.
            var joinNum = TeamConstants.parsePeriod(existing.joinPeriod);
            var leaveNum = TeamConstants.parsePeriod(existing.leavePeriod);
            if ((joinNum === null || startWeek >= joinNum) &&
                (leaveNum === null || startWeek <= leaveNum)) {
                return { added: false, updated: false };
            }

            // Otherwise treat this as a rejoin: the existing entry is
            // truncated at startWeek - 1 and a fresh entry is appended,
            // matching the "one interval per join" semantics of the
            // persistent roster.
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

    /**
     * Truncate the active membership of charId on the persistent
     * roster at effectiveWeek - 1.
     *
     * Returns { ended: boolean, reason?: string }.
     */
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
            // Active at the effective week?
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

    /**
     * Hard-delete the member entry from the persistent roster.
     *
     * Returns { removed: boolean }.
     */
    function syncRemoveMemberFromPersistentRoster(team, charId) {
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

    /**
     * Roster for a (classId, teamId) pair, active at the given week.
     * Delegates to the persistent Team entity. The weekly-team
     * record is NOT consulted here; callers who need the "is this
     * team scheduled this week?" gate use getWeeklyTeams.
     */
    function getActiveMembers(classId, teamId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
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

    /**
     * Full roster entries (characterId + role + join/leave) for a
     * (classId, teamId) pair. Delegates to the persistent Team entity.
     */
    function getAllMembers(classId, teamId) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team || !Array.isArray(team.members)) {
            return [];
        }
        return deepClone(team.members);
    }

    /**
     * Roster map for a class in a given week.
     *
     * Returns { [teamId]: [charId, ...] } for every team in the class
     * whose WEEKLY-TEAM RECORD is active that week AND whose
     * PERSISTENT TEAM ENTITY is also active that week.
     *
     * Membership comes from the persistent roster, not from any
     * per-week copy. This is the fix for the "same team, different
     * roster" bug: the Weekly Teams view and the Tournaments view
     * read the same array.
     */
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

            // The weekly-team record's own window.
            if (!recordActiveInWeek(record, weekNum)) {
                continue;
            }

            // The PERSISTENT Team entity's window.
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

    function hasAssignments(classId, week) {
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
            var start = record.startWeek;
            if (start === null || start === undefined) {
                continue;
            }
            var end = record.endWeek;
            var effectiveEnd = (end === null || end === undefined)
                ? MAX_WEEK
                : end;
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

    /**
     * Ensure a team is scheduled for a class in a week. Creates the
     * weekly-team window record if it does not exist; otherwise
     * widens the existing window to include the week.
     *
     * Does NOT touch membership. Membership is a separate operation.
     */
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

        var windowInfo = getTeamWindow(teamId);
        if (!windowInfo) {
            return Promise.resolve(failure('Team not found.'));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { valid: false, message: 'Team no longer exists.' };
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

                // Extend the window to include the requested week if needed.
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

                // Route the membership write to the persistent roster.
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
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { valid: false, message: 'Team no longer exists.' };
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
                    // Bump the weekly-team record's updatedAt so views
                    // that fingerprint on it invalidate.
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

    function removeMemberRecord(classId, teamId, charId) {
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
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var team = findTeamInSnapshot(appData, targetTeam);
                if (!team) {
                    return { removed: false };
                }

                var syncResult = syncRemoveMemberFromPersistentRoster(
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
            logMessage: 'Removed membership record for ' + targetChar +
                ' in team ' + targetTeam,
            successMessage: 'Membership record removed.',
            failureMessage: 'Failed to remove membership record.'
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

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    function stripCharacterRefs(appData, charId, effectiveWeek) {
        var result = { membershipsEnded: 0 };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }
        if (!Array.isArray(appData.teams)) {
            return result;
        }

        var weekNum = null;
        if (effectiveWeek !== undefined && effectiveWeek !== null) {
            weekNum = parseWeekStrict(effectiveWeek);
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
                if (weekNum !== null) {
                    if (joinNum !== null && joinNum >= weekNum) {
                        continue;
                    }
                    member.leavePeriod = String(weekNum - 1);
                } else {
                    member.leavePeriod = String(MAX_WEEK);
                }
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
        hasAssignments: hasAssignments,
        getAllAssignedTeamIds: getAllAssignedTeamIds,
        getAssignedWeeksForClass: getAssignedWeeksForClass,
        getAssignedClassesForWeek: getAssignedClassesForWeek,
        isPersistentTeamVisibleInWeek: isPersistentTeamVisibleInWeek,

        // Mutations
        addMember: addMember,
        endMembership: endMembership,
        removeMemberRecord: removeMemberRecord,
        removeTeamRecord: removeTeamRecord,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,
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
            'getAssignedTeamId', 'hasAssignments', 'getAllAssignedTeamIds',
            'getAssignedWeeksForClass', 'getAssignedClassesForWeek',
            'isPersistentTeamVisibleInWeek',
            'addMember', 'endMembership', 'removeMemberRecord',
            'removeTeamRecord',
            'stripCharacterRefs', 'stripClassRefs', 'stripTeamRefs'
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
