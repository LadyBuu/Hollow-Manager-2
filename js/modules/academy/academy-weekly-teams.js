/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams (data)
 * SINGLE SOURCE OF TRUTH for week-scoped team assignments.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * WHAT THIS OWNS:
 *   The assignment of characters to teams for a specific class week.
 *   NOT the Team entity itself. Team identity (name, type, status,
 *   persistent members, ranking history) lives in window.data.teams
 *   and is owned by the Team domain.
 *
 *   The relationship is:
 *     academy.weeklyTeams[classId][week][teamId] = [charId, ...]
 *
 *   This is a separate axis from persistent Team membership. A team's
 *   roster (TeamQueries.getActiveTeamMembers) is "who is on this team
 *   in general". A weekly assignment is "who is grouped with whom for
 *   this specific class week". They can and do diverge: the Weekly
 *   Teams view shows the week-scoped grouping, not the persistent
 *   roster.
 *
 * CONSUMERS:
 *   - AcademyAggregator.getWeeklyTeamsViewViewModel reads via
 *     getWeeklyTeams().
 *   - AcademyCascade.characterDeleted / classDeleted / teamDeleted
 *     call the strip*Refs helpers.
 *   - AcademyWeeklyTeamsView renders the VM produced by the aggregator.
 *   - (Future) AcademyDistribution, when the auto-distribute feature
 *     learns to write week-scoped assignments.
 *
 * IMPORTANT:
 *   - This module OWNS mutations on academy.weeklyTeams.
 *   - Public reads return DEEP COPIES. No live reference escapes.
 *   - All MUTATIONS go through MutationPipeline.
 *   - Cascade helpers are PURE with respect to appData. They mutate
 *     the snapshot they are given and never touch window.data. They
 *     run inside another module's pipeline transaction.
 *   - The store is NOT auto-created on read. Reads return empty
 *     results when the store is absent, which is the correct answer
 *     for "assignments have not been made yet".
 *
 * STORE SHAPE:
 *   academy.weeklyTeams = {
 *     'class_789': {
 *       '5': {
 *         'team_abc': ['char_1', 'char_2'],
 *         'team_def': ['char_3', 'char_4']
 *       },
 *       '6': { ... }
 *     }
 *   }
 *
 *   Week keys are stored as strings (JSON object keys). Team IDs and
 *   character IDs are stored as strings. The store is a plain object
 *   of plain objects — no Maps, no Sets, no Dates.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils      (MANDATORY) — deep cloning
 *   - window.ValidationUtils  (MANDATORY) — string / type checks
 *   - window.CalendarValidation (MANDATORY) — week parsing
 *   - window.MutationPipeline (MANDATORY) — persistence
 *
 * USAGE:
 *   var AWT = window.AcademyWeeklyTeams;
 *
 *   var assignments = AWT.getWeeklyTeams('class_789', 5);
 *   // → { 'team_abc': ['char_1', 'char_2'], 'team_def': ['char_3'] }
 *
 *   AWT.setWeeklyTeams('class_789', 5, {
 *       'team_abc': ['char_1', 'char_2'],
 *       'team_def': ['char_3', 'char_4']
 *   }).then(function(result) { ... });
 *
 *   AWT.setTeamMembers('class_789', 5, 'team_abc', ['char_1', 'char_2'])
 *       .then(function(result) { ... });
 *
 *   AWT.clearWeek('class_789', 5).then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }
    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }
    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyWeeklyTeams] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyWeeklyTeamsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyWeeklyTeams] deepClone returned the original reference. ' +
                'Read safety is broken.'
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

    // ============================================================
    // STORE ACCESS
    // ============================================================

    /**
     * Read the live weekly-teams store from window.data.
     *
     * READ SAFETY: returns null when the store is missing. Does NOT
     * create academy.weeklyTeams as a side effect of a read.
     *
     * @returns {object|null}
     */
    function getWeeklyTeamsStore() {
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

    /**
     * Ensure the store exists on the given appData snapshot.
     *
     * Called exclusively from inside pipeline mutate() callbacks,
     * operating on the appData snapshot the pipeline hands in.
     * Never called from a read path.
     */
    function ensureWeeklyTeamsStore(appData) {
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

    // ============================================================
    // NORMALISATION HELPERS
    // ============================================================

    /**
     * Normalise a raw assignment map into canonical form.
     *
     * - teamId keys are trimmed strings
     * - member arrays are arrays of trimmed non-empty strings
     * - duplicates within a member array are removed
     * - member arrays are sorted for stable output
     * - non-array team values are dropped
     *
     * @param {object} raw
     * @returns {object} canonical map
     */
    function normaliseAssignments(raw) {
        var cleaned = {};

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return cleaned;
        }

        var teamIds = Object.keys(raw);
        for (var i = 0; i < teamIds.length; i++) {
            var rawTeamId = teamIds[i];
            if (!isNonEmptyString(rawTeamId)) {
                continue;
            }
            var teamId = String(rawTeamId).trim();

            var members = raw[rawTeamId];
            if (!Array.isArray(members)) {
                continue;
            }

            var seen = Object.create(null);
            var clean = [];
            for (var j = 0; j < members.length; j++) {
                var id = String(members[j] === undefined || members[j] === null
                    ? ''
                    : members[j]
                ).trim();
                if (id === '' || seen[id]) {
                    continue;
                }
                seen[id] = true;
                clean.push(id);
            }
            clean.sort();
            cleaned[teamId] = clean;
        }

        return cleaned;
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    /**
     * Get the weekly team assignments for a class + week.
     *
     * Returns a DEEP CLONE. Never returns a live reference.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object} Map of { teamId: [charId, ...] }
     */
    function getWeeklyTeams(classId, week) {
        if (!isNonEmptyString(classId)) {
            return {};
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var store = getWeeklyTeamsStore();
        if (!store) {
            return {};
        }

        var byClass = store[String(classId)];
        if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
            return {};
        }

        var byWeek = byClass[String(weekNum)];
        if (!byWeek || typeof byWeek !== 'object' || Array.isArray(byWeek)) {
            return {};
        }

        return deepClone(byWeek);
    }

    /**
     * Get the character IDs assigned to a specific team for a
     * specific class + week. Returns a fresh array.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {string} teamId
     * @returns {array}
     */
    function getTeamMembers(classId, week, teamId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return [];
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var assignments = getWeeklyTeams(classId, weekNum);
        var members = assignments[String(teamId)];
        if (!Array.isArray(members)) {
            return [];
        }
        return members.slice();
    }

    /**
     * Is the given character assigned to ANY team for this class week?
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {string} charId
     * @returns {boolean}
     */
    function isCharacterAssigned(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return false;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return false;
        }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);

        for (var i = 0; i < teamIds.length; i++) {
            var members = assignments[teamIds[i]];
            if (!Array.isArray(members)) { continue; }
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the team ID a character is assigned to for a class week.
     * Returns null when the character is not assigned.
     *
     * Assumes a character appears in at most one team per class week.
     * That invariant is enforced by setWeeklyTeams (see below); if
     * the store is malformed and contains duplicates, this returns
     * the first match it finds.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {string} charId
     * @returns {string|null}
     */
    function getAssignedTeamId(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return null;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);

        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = assignments[teamId];
            if (!Array.isArray(members)) { continue; }
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) {
                    return teamId;
                }
            }
        }
        return null;
    }

    /**
     * Does this class have ANY assignments for this week?
     * A more efficient check than inspecting getWeeklyTeams when
     * the caller only needs a boolean.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {boolean}
     */
    function hasAssignments(classId, week) {
        if (!isNonEmptyString(classId)) {
            return false;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return false;
        }
        var assignments = getWeeklyTeams(classId, weekNum);
        return Object.keys(assignments).length > 0;
    }

    /**
     * Get all weeks that have at least one assignment for a class.
     * Returns weeks sorted ascending as numbers.
     *
     * @param {string} classId
     * @returns {array}
     */
    function getAssignedWeeksForClass(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var store = getWeeklyTeamsStore();
        if (!store) {
            return [];
        }

        var byClass = store[String(classId)];
        if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
            return [];
        }

        var weeks = [];
        var weekKeys = Object.keys(byClass);
        for (var i = 0; i < weekKeys.length; i++) {
            var weekNum = CalendarValidation.parseWeek(weekKeys[i]);
            if (weekNum !== null) {
                weeks.push(weekNum);
            }
        }

        weeks.sort(function(a, b) { return a - b; });
        return weeks;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Replace the entire weekly assignment map for a class + week.
     *
     * The `assignments` argument is a map of { teamId: [charId, ...] }.
     * It is normalised before storage (see normaliseAssignments).
     *
     * INVARIANT: after this call, no character appears in more than
     * one team for the same class week. If the input contains a
     * character in two teams, the FIRST team (by insertion order in
     * the input object) wins and the character is removed from the
     * later team. The caller is expected to have deduplicated already;
     * this is defensive.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} assignments
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function setWeeklyTeams(classId, week, assignments) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return Promise.resolve(failure('Valid week is required.'));
        }

        if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
            return Promise.resolve(failure('Assignments must be an object.'));
        }

        var targetClass = String(classId);
        var targetWeek = String(weekNum);

        // ---- Normalise + enforce single-team-per-character ----
        var cleaned = normaliseAssignments(assignments);

        var seenCharacters = Object.create(null);
        var finalAssignments = {};
        var teamIds = Object.keys(cleaned);

        // Deterministic iteration order: sort team IDs so the
        // "first wins" rule is stable across calls.
        teamIds.sort();

        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = cleaned[teamId];
            var filtered = [];

            for (var j = 0; j < members.length; j++) {
                var memberId = members[j];
                if (seenCharacters[memberId]) {
                    continue;
                }
                seenCharacters[memberId] = true;
                filtered.push(memberId);
            }

            finalAssignments[teamId] = filtered;
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureWeeklyTeamsStore(appData);
                if (!store[targetClass]) {
                    store[targetClass] = {};
                }
                store[targetClass][targetWeek] = deepClone(finalAssignments);

                return {
                    classId: targetClass,
                    week: weekNum,
                    teamCount: Object.keys(finalAssignments).length
                };
            },
            logMessage: 'Set weekly teams for class ' + targetClass +
                        ', week ' + targetWeek,
            successMessage: 'Weekly teams saved.',
            failureMessage: 'Failed to save weekly teams.'
        });
    }

    /**
     * Set the members of a single team for a class + week, leaving
     * other teams' assignments untouched.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {string} teamId
     * @param {array} memberIds
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function setTeamMembers(classId, week, teamId, memberIds) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return Promise.resolve(failure('Valid week is required.'));
        }

        if (!Array.isArray(memberIds)) {
            return Promise.resolve(failure('Member IDs must be an array.'));
        }

        var targetClass = String(classId);
        var targetTeam = String(teamId);
        var targetWeek = String(weekNum);

        // Build the new map by layering on top of the current week.
        // Because setWeeklyTeams enforces single-team-per-character,
        // we must remove the given characters from any OTHER team
        // before writing the new member list.
        var current = getWeeklyTeams(targetClass, weekNum);
        var members = memberIds.slice();

        var memberSet = Object.create(null);
        for (var m = 0; m < members.length; m++) {
            var id = String(members[m] === undefined || members[m] === null
                ? ''
                : members[m]
            ).trim();
            if (id === '') { continue; }
            memberSet[id] = true;
        }

        var next = {};
        var otherTeamIds = Object.keys(current);
        for (var i = 0; i < otherTeamIds.length; i++) {
            var otherTeamId = otherTeamIds[i];
            if (otherTeamId === targetTeam) { continue; }

            var otherMembers = current[otherTeamId];
            if (!Array.isArray(otherMembers)) {
                next[otherTeamId] = [];
                continue;
            }

            var keptMembers = [];
            for (var j = 0; j < otherMembers.length; j++) {
                if (!memberSet[String(otherMembers[j])]) {
                    keptMembers.push(otherMembers[j]);
                }
            }
            next[otherTeamId] = keptMembers;
        }

        next[targetTeam] = members;

        return setWeeklyTeams(targetClass, weekNum, next);
    }

    /**
     * Remove all assignments for a class + week.
     *
     * Idempotent: succeeds with changed:false when nothing was there.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function clearWeek(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return Promise.resolve(failure('Valid week is required.'));
        }

        var targetClass = String(classId);
        var targetWeek = String(weekNum);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureWeeklyTeamsStore(appData);

                if (!store[targetClass] ||
                    typeof store[targetClass] !== 'object' ||
                    !store[targetClass][targetWeek]) {
                    return { changed: false };
                }

                delete store[targetClass][targetWeek];

                // Prune the class bucket when it becomes empty. Keeps
                // the store tidy and avoids leaving behind a class
                // entry with zero weeks.
                if (Object.keys(store[targetClass]).length === 0) {
                    delete store[targetClass];
                }

                return { changed: true };
            },
            logMessage: 'Cleared weekly teams for class ' + targetClass +
                        ', week ' + targetWeek,
            successMessage: 'Weekly teams cleared.',
            failureMessage: 'Failed to clear weekly teams.'
        });
    }

    /**
     * Remove ALL assignments for a class, across every week.
     *
     * @param {string} classId
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function clearClass(classId) {
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
                var store = ensureWeeklyTeamsStore(appData);

                if (!store[targetClass]) {
                    return { changed: false, weeksRemoved: 0 };
                }

                var weeksRemoved = Object.keys(store[targetClass]).length;
                delete store[targetClass];

                return { changed: true, weeksRemoved: weeksRemoved };
            },
            logMessage: 'Cleared all weekly teams for class ' + targetClass,
            successMessage: 'Class weekly teams cleared.',
            failureMessage: 'Failed to clear class weekly teams.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================
    //
    // These are PURE with respect to appData: they mutate the snapshot
    // they are given and never touch window.data. They are designed
    // to run inside another module's pipeline mutate() callback. They
    // never throw and never return Promise rejections.
    //
    // They are called by AcademyCascade:
    //   - characterDeleted -> stripCharacterRefs
    //   - classDeleted     -> stripClassRefs
    //   - teamDeleted      -> stripTeamRefs

    /**
     * Remove all references to a character from every weekly
     * assignment in every class and week.
     *
     * @param {object} appData - pipeline snapshot
     * @param {string} charId
     * @returns {object} { assignmentsRemoved: number }
     */
    function stripCharacterRefs(appData, charId) {
        var result = { assignmentsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(charId);
        var classIds = Object.keys(store);

        for (var c = 0; c < classIds.length; c++) {
            var byClass = store[classIds[c]];
            if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                continue;
            }

            var weekKeys = Object.keys(byClass);
            for (var w = 0; w < weekKeys.length; w++) {
                var byWeek = byClass[weekKeys[w]];
                if (!byWeek || typeof byWeek !== 'object' || Array.isArray(byWeek)) {
                    continue;
                }

                var teamIds = Object.keys(byWeek);
                for (var t = 0; t < teamIds.length; t++) {
                    var teamId = teamIds[t];
                    var members = byWeek[teamId];
                    if (!Array.isArray(members)) {
                        continue;
                    }

                    var before = members.length;
                    var filtered = [];
                    for (var i = 0; i < members.length; i++) {
                        if (String(members[i]) !== target) {
                            filtered.push(members[i]);
                        }
                    }

                    if (filtered.length !== before) {
                        result.assignmentsRemoved += (before - filtered.length);
                        byWeek[teamId] = filtered;
                    }
                }
            }
        }

        return result;
    }

    /**
     * Remove all weekly assignments for a class.
     *
     * @param {object} appData
     * @param {string} classId
     * @returns {object} { weeksRemoved: number }
     */
    function stripClassRefs(appData, classId) {
        var result = { weeksRemoved: 0 };

        if (!appData || !classId) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(classId);
        if (store[target]) {
            result.weeksRemoved = Object.keys(store[target]).length;
            delete store[target];
        }

        return result;
    }

    /**
     * Remove all references to a team from every weekly assignment
     * in every class and week.
     *
     * @param {object} appData
     * @param {string} teamId
     * @returns {object} { assignmentsRemoved: number }
     */
    function stripTeamRefs(appData, teamId) {
        var result = { assignmentsRemoved: 0 };

        if (!appData || !teamId) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(teamId);
        var classIds = Object.keys(store);

        for (var c = 0; c < classIds.length; c++) {
            var byClass = store[classIds[c]];
            if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                continue;
            }

            var weekKeys = Object.keys(byClass);
            for (var w = 0; w < weekKeys.length; w++) {
                var byWeek = byClass[weekKeys[w]];
                if (!byWeek || typeof byWeek !== 'object' || Array.isArray(byWeek)) {
                    continue;
                }

                if (Object.prototype.hasOwnProperty.call(byWeek, target)) {
                    delete byWeek[target];
                    result.assignmentsRemoved++;
                }
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeams = {
        // Reads
        getWeeklyTeams: getWeeklyTeams,
        getTeamMembers: getTeamMembers,
        isCharacterAssigned: isCharacterAssigned,
        getAssignedTeamId: getAssignedTeamId,
        hasAssignments: hasAssignments,
        getAssignedWeeksForClass: getAssignedWeeksForClass,

        // Mutations
        setWeeklyTeams: setWeeklyTeams,
        setTeamMembers: setTeamMembers,
        clearWeek: clearWeek,
        clearClass: clearClass,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripTeamRefs: stripTeamRefs
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyWeeklyTeams;
        var missing = [];

        var required = [
            'getWeeklyTeams',
            'getTeamMembers',
            'isCharacterAssigned',
            'getAssignedTeamId',
            'hasAssignments',
            'getAssignedWeeksForClass',
            'setWeeklyTeams',
            'setTeamMembers',
            'clearWeek',
            'clearClass',
            'stripCharacterRefs',
            'stripClassRefs',
            'stripTeamRefs'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyWeeklyTeams] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
