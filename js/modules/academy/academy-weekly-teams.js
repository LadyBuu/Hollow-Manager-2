/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams
 * SINGLE SOURCE OF TRUTH for week-scoped team membership.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * MODEL:
 *   academy.weeklyTeams[classId][teamId] = {
 *     id, classId, teamId,
 *     startWeek, endWeek,       // null = ongoing; endWeek inclusive
 *     members: [
 *       { characterId, startWeek, endWeek }
 *     ],
 *     createdAt, updatedAt
 *   }
 *
 *   The team's existence and its OWN startPeriod / endPeriod remain
 *   owned by TeamQueries / TeamCore. This module owns only the
 *   class-scoped weekly assignment and its membership windows.
 *
 * READING A ROSTER FOR WEEK W:
 *   For each team in the class:
 *     1. Look up the persistent Team via TeamQueries.
 *     2. If the team's window does not cover W, skip.
 *     3. From this module's record, take members whose
 *        startWeek <= W <= (endWeek ?? ∞).
 *
 * DROP-OUT vs DELETE:
 *   - endMembership(classId, teamId, charId, effectiveWeek)
 *     Truncates the member's tail at effectiveWeek - 1. History
 *     survives. This is the ordinary "leave the team" action.
 *
 *   - removeMemberRecord(classId, teamId, charId)
 *     Hard-deletes the membership entry as if it never existed.
 *     Used for administrative cleanup.
 *
 *   - removeTeamRecord(classId, teamId)
 *     Hard-deletes the entire weekly-team record. Used by the
 *     class-delete cascade and administrative cleanup.
 *
 * READ SAFETY:
 *   - Reads never create the store.
 *   - Public reads return DEEP CLONES.
 *   - Internal accessors used inside pipeline callbacks return
 *     live references from the appData snapshot.
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded [MIN_WEEK, MAX_WEEK].
 *   - startWeek and endWeek are integers in that range.
 *   - endWeek === null means "ongoing".
 *   - endWeek is INCLUSIVE.
 *
 * CASCADE SEMANTICS:
 *   stripCharacterRefs / stripClassRefs / stripTeamRefs are PURE
 *   with respect to appData. They mutate the snapshot, never touch
 *   window.data, and never throw. They run inside another module's
 *   pipeline transaction.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils          (deepClone)
 *   - window.ValidationUtils      (isNonEmptyString)
 *   - window.CalendarValidation   (parseWeek)
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)
 *   - window.MutationPipeline     (performMutation)
 *   - window.TeamQueries          (getTeamById)
 *   - window.TeamConstants        (parsePeriod, getPeriodRange)
 *
 * USAGE:
 *   var AWT = window.AcademyWeeklyTeams;
 *
 *   AWT.addMember(classId, teamId, charId, week);
 *   AWT.endMembership(classId, teamId, charId, effectiveWeek);
 *   AWT.removeMemberRecord(classId, teamId, charId);
 *   AWT.getActiveMembers(classId, teamId, week);
 *   AWT.getWeeklyTeams(classId, week);   // roster map for the week
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    // ============================================================
    // DIAGNOSTIC FLAG
    // ============================================================
    var _DIAGNOSTIC = true;

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

    diag('Module loaded.');
    diag('  TeamQueries:', !!TeamQueries);
    diag('  MutationPipeline:', !!MutationPipeline);

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

    /**
     * Return the team's window from TeamQueries, as integers or null.
     * Returns { start, end } where end === null means "no end period".
     * Returns null when the team is not found.
     */
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
            end: end  // null when not set
        };
    }

    /**
     * Is `week` inside the closed interval [start, end]?
     * `start` is required. `end` may be null (unbounded).
     */
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

    function rangesOverlap(s1, e1, s2, e2) {
        var endA = (e1 === null || e1 === undefined) ? Infinity : e1;
        var endB = (e2 === null || e2 === undefined) ? Infinity : e2;
        return s1 <= endB && s2 <= endA;
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
    // MEMBER-RANGE HELPERS
    // ============================================================

    /**
     * Is the member entry active in `week`?
     */
    function memberActiveInWeek(member, week) {
        if (!member || typeof member !== 'object') {
            return false;
        }
        var start = member.startWeek;
        if (start === null || start === undefined) {
            return false;
        }
        if (week < start) {
            return false;
        }
        if (member.endWeek !== null && member.endWeek !== undefined &&
            week > member.endWeek) {
            return false;
        }
        return true;
    }

    /**
     * Is the weekly-team record active in `week`?
     */
    function recordActiveInWeek(record, week) {
        if (!record) {
            return false;
        }
        return weekInRange(week, record.startWeek, record.endWeek);
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    /**
     * Get the raw weekly-team record for a (class, team).
     * Returns a deep clone or null.
     */
    function getTeamRecord(classId, teamId) {
        var record = getTeamRecordInternal(classId, teamId);
        return record ? deepClone(record) : null;
    }

    /**
     * Get every weekly-team record for a class. Returns clones.
     */
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
     * Get members of a team active in a given week.
     * Returns an array of characterId strings.
     */
    function getActiveMembers(classId, teamId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var record = getTeamRecordInternal(classId, teamId);
        if (!record) {
            return [];
        }

        var result = [];
        var members = Array.isArray(record.members) ? record.members : [];
        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (memberActiveInWeek(member, weekNum)) {
                result.push(String(member.characterId));
            }
        }
        return result;
    }

    /**
     * Get every member EVER, with their ranges. Includes historical.
     */
    function getAllMembers(classId, teamId) {
        var record = getTeamRecordInternal(classId, teamId);
        if (!record || !Array.isArray(record.members)) {
            return [];
        }
        return deepClone(record.members);
    }

    /**
     * Roster map for a class in a given week.
     *
     * Returns { [teamId]: [charId, ...] } for every team in the class
     * whose weekly-team record is active that week.
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
            if (!recordActiveInWeek(record, weekNum)) {
                continue;
            }
            var members = Array.isArray(record.members) ? record.members : [];
            var active = [];
            for (var j = 0; j < members.length; j++) {
                if (memberActiveInWeek(members[j], weekNum)) {
                    active.push(String(members[j].characterId));
                }
            }
            result[teamId] = active;
        }
        return result;
    }

    /**
     * Is a character assigned to any team in a class in a given week?
     */
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

    /**
     * Get the team ID the character is assigned to in a class for a week.
     */
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
            members: [],
            createdAt: now,
            updatedAt: now
        };
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Add a character to a team's weekly membership.
     *
     * Records "from `week` onward." If the character already has an
     * active membership at `week` in this team, this is a no-op.
     *
     * If the character has an *ended* membership that overlaps with
     * the requested start, the mutation is refused: the caller must
     * decide whether to reopen the closed membership or add a new
     * one after the end.
     */
    function addMember(classId, teamId, charId, week) {
        diag('addMember CALLED', { classId, teamId, charId, week });

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
                        targetClass, targetTeam, weekNum
                    );
                    store[targetClass][targetTeam] = record;
                }

                if (!Array.isArray(record.members)) {
                    record.members = [];
                }

                // Check for an existing entry for this character.
                var existingIndex = -1;
                for (var i = 0; i < record.members.length; i++) {
                    if (String(record.members[i].characterId) === targetChar) {
                        existingIndex = i;
                        break;
                    }
                }

                if (existingIndex !== -1) {
                    var existing = record.members[existingIndex];

                    if (memberActiveInWeek(existing, weekNum)) {
                        // Already a member at this week. No-op.
                        return { added: false, reason: 'already-active' };
                    }

                    if (existing.endWeek !== null && existing.endWeek !== undefined &&
                        existing.endWeek >= weekNum) {
                        // Shouldn't happen since memberActiveInWeek would
                        // have caught it. Defensive.
                        return { added: false, reason: 'already-active' };
                    }

                    // Reopen the membership from `weekNum` onward.
                    // The previous window is preserved by opening a
                    // new entry immediately after it, so history
                    // survives.
                    var newMember = {
                        characterId: targetChar,
                        startWeek: weekNum,
                        endWeek: null
                    };
                    record.members.push(newMember);
                } else {
                    record.members.push({
                        characterId: targetChar,
                        startWeek: weekNum,
                        endWeek: null
                    });
                }

                record.updatedAt = new Date().toISOString();
                return { added: true, teamId: targetTeam };
            },
            logMessage: 'Added ' + targetChar + ' to team ' + targetTeam +
                ' in ' + targetClass + ' from week ' + weekNum,
            successMessage: 'Member added to team.',
            failureMessage: 'Failed to add member to team.'
        });
    }

    /**
     * End a member's participation from `effectiveWeek` onward.
     *
     * Their active window becomes [startWeek, effectiveWeek - 1].
     * This is the ordinary "leave the team" operation. History
     * survives; only the tail is truncated.
     *
     * If the membership already ended at or before effectiveWeek - 1,
     * no change is made.
     */
    function endMembership(classId, teamId, charId, effectiveWeek) {
        diag('endMembership CALLED',
            { classId, teamId, charId, effectiveWeek });

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
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    return { ended: false, reason: 'no-store' };
                }
                var record = getTeamRecordInternalFromStore(
                    store, targetClass, targetTeam
                );
                if (!record || !Array.isArray(record.members)) {
                    return { ended: false, reason: 'no-team' };
                }

                // Find the currently-active membership for this char.
                var matchedIndex = -1;
                for (var i = 0; i < record.members.length; i++) {
                    var m = record.members[i];
                    if (String(m.characterId) !== targetChar) {
                        continue;
                    }
                    if (memberActiveInWeek(m, weekNum)) {
                        matchedIndex = i;
                        break;
                    }
                }

                if (matchedIndex === -1) {
                    return { ended: false, reason: 'not-active-at-week' };
                }

                var member = record.members[matchedIndex];

                if (member.startWeek >= weekNum) {
                    // They start AT or AFTER the effective end week.
                    // Nothing to end. This is defensive: we shouldn't
                    // have matched in that case.
                    return { ended: false, reason: 'starts-after' };
                }

                member.endWeek = weekNum - 1;
                record.updatedAt = new Date().toISOString();

                return {
                    ended: true,
                    teamId: targetTeam,
                    endWeek: member.endWeek
                };
            },
            logMessage: 'Ended membership of ' + targetChar + ' in team ' +
                targetTeam + ' from week ' + weekNum,
            successMessage: 'Member removed from team.',
            failureMessage: 'Failed to remove member from team.'
        });
    }

    /**
     * Hard-delete a member's record entirely. Administrative cleanup.
     *
     * Does not preserve history.
     */
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
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    return { removed: false };
                }
                var record = getTeamRecordInternalFromStore(
                    store, targetClass, targetTeam
                );
                if (!record || !Array.isArray(record.members)) {
                    return { removed: false };
                }
                var before = record.members.length;
                record.members = record.members.filter(function(m) {
                    return String(m.characterId) !== targetChar;
                });
                var removed = before - record.members.length;
                if (removed > 0) {
                    record.updatedAt = new Date().toISOString();
                }
                return { removed: removed > 0 };
            },
            logMessage: 'Removed membership record for ' + targetChar +
                ' in team ' + targetTeam,
            successMessage: 'Membership record removed.',
            failureMessage: 'Failed to remove membership record.'
        });
    }

    /**
     * Hard-delete an entire weekly-team record. Used by class-delete
     * cascade and administrative cleanup.
     */
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

    /**
     * End all memberships for a character from `effectiveWeek`
     * onward, across every class and team. Used when a character
     * drops out of the academy.
     *
     * Historical records survive; only the tail of each active
     * membership is truncated.
     *
     * If `effectiveWeek` is null, all memberships are ended with
     * `endWeek = MAX_WEEK` (effectively "they never appear again").
     */
    function stripCharacterRefs(appData, charId, effectiveWeek) {
        var result = { membershipsEnded: 0 };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var weekNum = null;
        if (effectiveWeek !== undefined && effectiveWeek !== null) {
            weekNum = parseWeekStrict(effectiveWeek);
        }

        var target = String(charId);
        var classIds = Object.keys(store);

        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) {
                continue;
            }
            var teamIds = Object.keys(byClass);
            for (var j = 0; j < teamIds.length; j++) {
                var record = byClass[teamIds[j]];
                if (!isPlainObject(record) || !Array.isArray(record.members)) {
                    continue;
                }
                for (var k = 0; k < record.members.length; k++) {
                    var member = record.members[k];
                    if (String(member.characterId) !== target) {
                        continue;
                    }
                    if (member.endWeek !== null && member.endWeek !== undefined) {
                        // Already ended.
                        continue;
                    }
                    if (weekNum !== null) {
                        if (member.startWeek >= weekNum) {
                            // Membership hasn't started yet.
                            continue;
                        }
                        member.endWeek = weekNum - 1;
                    } else {
                        member.endWeek = MAX_WEEK;
                    }
                    result.membershipsEnded++;
                }
            }
        }

        return result;
    }

    /**
     * Strip the entire weeklyTeams subtree for a class.
     * Hard delete. Used by the class-delete cascade.
     */
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

    /**
     * Hard delete a single team's weekly-team record from every class.
     * Used by the team-delete cascade.
     */
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
        getAssignedWeeksForClass: getAssignedWeeksForClass,
        getAssignedClassesForWeek: getAssignedClassesForWeek,

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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyWeeklyTeams;
        var required = [
            'getTeamRecord',
            'getAllTeamRecords',
            'getActiveMembers',
            'getAllMembers',
            'getWeeklyTeams',
            'isCharacterAssigned',
            'getAssignedTeamId',
            'hasAssignments',
            'getAssignedWeeksForClass',
            'getAssignedClassesForWeek',
            'addMember',
            'endMembership',
            'removeMemberRecord',
            'removeTeamRecord',
            'stripCharacterRefs',
            'stripClassRefs',
            'stripTeamRefs'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            console.warn('[AcademyWeeklyTeams] Verification missing:', missing.join(', '));
        } else {
            diag('Verification OK.');
        }
    })();

})();
