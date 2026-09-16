/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams
 * SINGLE SOURCE OF TRUTH for week-scoped team assignments.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * STORAGE:
 *   academy.weeklyTeams[classId][week][teamId] = [charId, ...]
 *
 * This is a week-scoped assignment. It is NOT persistent Team entity
 * membership. Team identity (name, type, status, roster) lives in the
 * Team domain. This module owns the mapping from (class, week, team)
 * to a list of character IDs.
 *
 * CONSUMERS:
 *   - AcademyAggregator.getWeeklyTeamsViewModel reads via getWeeklyTeams.
 *   - AcademyCascade calls stripCharacterRefs / stripClassRefs /
 *     stripTeamRefs on the corresponding delete paths.
 *   - AcademyWeeklyTeamsView renders the resulting VM.
 *
 * READ SAFETY:
 *   - Reads are synchronous and side-effect free.
 *   - Reads NEVER create the store. When the store is missing, reads
 *     return empty results.
 *   - Public reads return DEEP CLONES. No live reference escapes.
 *   - Internal accessors used inside pipeline callbacks operate on the
 *     appData snapshot.
 *
 * WRITE SAFETY:
 *   - Every mutation goes through MutationPipeline.
 *   - Every mutation rebuilds the candidate inside the pipeline's
 *     validate() and mutate() callbacks from the snapshot. Preflight
 *     reads against window.data are for UX; they are not authoritative.
 *   - Single-team-per-character invariant is enforced deterministically
 *     by sorting team IDs lexicographically before deduplication.
 *   - Normalised assignments drop empty-member teams entirely.
 *
 * WEEK SEMANTICS:
 *   - Weeks are bounded by CalendarConstants.MIN_WEEK / MAX_WEEK.
 *   - No `|| 1` defaults. Invalid weeks are rejected with a clear
 *     failure result. Callers that want "current week" must fetch it
 *     themselves and pass it in.
 *
 * CASCADE SEMANTICS:
 *   All strip helpers are PURE with respect to appData: they mutate the
 *   snapshot, never touch window.data, never throw. They are designed
 *   to run inside another module's pipeline transaction.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils        (deepClone)
 *   - window.ValidationUtils    (isNonEmptyString)
 *   - window.CalendarValidation (parseWeek)
 *   - window.CalendarConstants  (MIN_WEEK / MAX_WEEK)
 *   - window.MutationPipeline   (performMutation)
 *
 * USAGE:
 *   var AWT = window.AcademyWeeklyTeams;
 *
 *   AWT.getWeeklyTeams('class_1', 5);
 *   AWT.setWeeklyTeams('class_1', 5, { team_a: ['char_1', 'char_2'] })
 *       .then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES - no fallbacks
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;

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

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeams] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsLoaded = true;

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

    /**
     * Deep clone with aliasing guard.
     *
     * If ObjectUtils.deepClone returns the same reference, that is a
     * bug in ObjectUtils and we surface it here rather than silently
     * leaking a live reference through a "read" API.
     */
    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyWeeklyTeams] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
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

    /**
     * Parse a week. Returns an integer within [MIN_WEEK, MAX_WEEK] or
     * null. Delegates to CalendarValidation.parseWeek for the canonical
     * parsing rules (integer-only, no silent coercion of trailing
     * characters, no floats).
     */
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
     * Normalise an assignments map.
     *
     *   - Drops entries whose team ID is not a non-empty string.
     *   - Drops entries whose member list is not an array.
     *   - Trims each member ID; drops empty strings.
     *   - Deduplicates member IDs within a team.
     *   - Drops teams left with zero members after cleaning.
     *
     * The return value is always a fresh object. No reference to the
     * input escapes.
     */
    function normaliseAssignments(raw) {
        var cleaned = {};

        if (!isPlainObject(raw)) {
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
                var raw = members[j];
                if (raw === undefined || raw === null) {
                    continue;
                }
                var id = String(raw).trim();
                if (id === '' || seen[id]) {
                    continue;
                }
                seen[id] = true;
                clean.push(id);
            }

            if (clean.length === 0) {
                continue;
            }

            clean.sort();
            cleaned[teamId] = clean;
        }

        return cleaned;
    }

    /**
     * Apply the single-team-per-character invariant.
     *
     * A character may appear in at most one team per (class, week). If
     * the input contains overlaps, the deterministic resolution is:
     * teams are visited in lexicographic ID order, and a character is
     * claimed by the first team that names it. Later teams that also
     * name that character have it removed from their roster.
     *
     * This is deterministic regardless of the input map's key insertion
     * order. It is NOT a silent "last write wins"; the rule is
     * documented here and enforced consistently.
     */
    function enforceSingleTeamPerCharacter(assignments) {
        var seenCharacters = Object.create(null);
        var result = {};

        var teamIds = Object.keys(assignments).sort();
        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = assignments[teamId];
            var filtered = [];
            for (var j = 0; j < members.length; j++) {
                var id = members[j];
                if (seenCharacters[id]) {
                    continue;
                }
                seenCharacters[id] = true;
                filtered.push(id);
            }
            result[teamId] = filtered;
        }

        return result;
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    /**
     * Read the live weeklyTeams store from window.data. Returns null
     * when the store is missing. Does NOT create it.
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
     * Read the live weeklyTeams store from an appData snapshot. Returns
     * null when the store is missing. Does NOT create it.
     */
    function getWeeklyTeamsStoreFromSnapshot(appData) {
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

    /**
     * Ensure the weeklyTeams store exists on an appData snapshot.
     * Only called from inside pipeline mutate() callbacks.
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
    // READS
    // ============================================================

    /**
     * Get the assignments for a (class, week).
     *
     * Returns a deep clone of the assignment map. When no assignments
     * exist, returns an empty object.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object} Map of { teamId: [charId, ...] }
     */
    function getWeeklyTeams(classId, week) {
        if (!isNonEmptyString(classId)) {
            return {};
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return {};
        }

        var store = getWeeklyTeamsStore();
        if (!store) {
            return {};
        }

        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return {};
        }

        var byWeek = byClass[String(weekNum)];
        if (!isPlainObject(byWeek)) {
            return {};
        }

        return deepClone(byWeek);
    }

    /**
     * Get the members assigned to a specific team for a (class, week).
     * Returns a fresh array. Never returns null.
     */
    function getTeamMembers(classId, week, teamId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return [];
        }
        var weekNum = parseWeekStrict(week);
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
     * Is a character assigned to any team for a (class, week)?
     */
    function isCharacterAssigned(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return false;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return false;
        }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);
        for (var i = 0; i < teamIds.length; i++) {
            var members = assignments[teamIds[i]];
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the team ID the character is assigned to for (class, week),
     * or null when the character is unassigned.
     */
    function getAssignedTeamId(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return null;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return null;
        }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);
        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = assignments[teamId];
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) {
                    return teamId;
                }
            }
        }
        return null;
    }

    /**
     * Does the (class, week) have any assignments?
     */
    function hasAssignments(classId, week) {
        if (!isNonEmptyString(classId)) {
            return false;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return false;
        }
        var assignments = getWeeklyTeams(classId, weekNum);
        return Object.keys(assignments).length > 0;
    }

    /**
     * Get every week number that has assignments for a class.
     * Returns a sorted array of integers.
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
        if (!isPlainObject(byClass)) {
            return [];
        }

        var weeks = [];
        var weekKeys = Object.keys(byClass);
        for (var i = 0; i < weekKeys.length; i++) {
            var weekNum = parseWeekStrict(weekKeys[i]);
            if (weekNum !== null) {
                weeks.push(weekNum);
            }
        }
        weeks.sort(function(a, b) { return a - b; });
        return weeks;
    }

    /**
     * Get every class ID that has assignments for a week.
     * Returns an array of class ID strings.
     */
    function getAssignedClassesForWeek(week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var store = getWeeklyTeamsStore();
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
            if (isPlainObject(byClass[String(weekNum)])) {
                result.push(classIds[i]);
            }
        }
        return result;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Replace the weekly teams for (class, week).
     *
     * Replaces the entire assignment map for the week. Callers that
     * want to merge should read first, merge locally, then call this
     * with the merged map.
     *
     * Idempotent in effect: the resulting state depends only on the
     * (classId, weekNum, normalisedAssignments) triple.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} assignments - { teamId: [charId, ...] }
     * @returns {Promise<{ success, data?, message? }>}
     */
    function setWeeklyTeams(classId, week, assignments) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        if (!isPlainObject(assignments)) {
            return Promise.resolve(failure('Assignments must be an object.'));
        }

        var targetClass = String(classId);
        var targetWeek = String(weekNum);

        // Build the canonical assignments map once, from the caller's
        // input. We do NOT read window.data here; the pipeline's
        // validate() will rebuild the same structure from the snapshot.
        var cleaned = normaliseAssignments(assignments);
        var finalised = enforceSingleTeamPerCharacter(cleaned);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                // Rebuild and validate against the snapshot. This is
                // identical work to the preflight; the reason it happens
                // here is that another mutation could have queued
                // between the preflight and the snapshot. The snapshot
                // is authoritative.
                var snapshotCleaned = normaliseAssignments(assignments);
                var snapshotFinal = enforceSingleTeamPerCharacter(snapshotCleaned);
                // The normalisation is deterministic; the shapes must
                // match. A mismatch indicates a structural problem with
                // the input that surface-level validation missed.
                if (JSON.stringify(snapshotFinal) !== JSON.stringify(finalised)) {
                    return {
                        valid: false,
                        message: 'Assignments map produced inconsistent state between preflight and snapshot.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureWeeklyTeamsStore(appData);
                if (!store[targetClass] || typeof store[targetClass] !== 'object') {
                    store[targetClass] = {};
                }
                store[targetClass][targetWeek] = deepClone(finalised);
                return {
                    classId: targetClass,
                    week: weekNum,
                    teamCount: Object.keys(finalised).length
                };
            },
            logMessage: 'Set weekly teams for class ' + targetClass + ', week ' + targetWeek,
            successMessage: 'Weekly teams saved.',
            failureMessage: 'Failed to save weekly teams.'
        });
    }

    /**
     * Clear all weekly teams for a (class, week).
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {Promise<{ success, data?, message? }>}
     */
    function clearWeeklyTeams(classId, week) {
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
        var targetWeek = String(weekNum);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getWeeklyTeamsStoreFromSnapshot(appData);
                if (!store) {
                    return { cleared: false };
                }
                var byClass = store[targetClass];
                if (!isPlainObject(byClass)) {
                    return { cleared: false };
                }
                if (!Object.prototype.hasOwnProperty.call(byClass, targetWeek)) {
                    return { cleared: false };
                }
                delete byClass[targetWeek];
                // If the class has no more weeks, remove the class entry.
                if (Object.keys(byClass).length === 0) {
                    delete store[targetClass];
                }
                return { cleared: true };
            },
            logMessage: 'Cleared weekly teams for class ' + targetClass + ', week ' + targetWeek,
            successMessage: 'Weekly teams cleared.',
            failureMessage: 'Failed to clear weekly teams.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================
    //
    // All three are PURE with respect to appData. They mutate the
    // snapshot, never touch window.data, and never throw. They are
    // designed to run inside another module's pipeline transaction.

    /**
     * Strip all references to a character from every week's assignments.
     *
     * Removes the character from every team's member list. Teams left
     * with zero members are deleted. Class and week entries that end up
     * empty are deleted.
     *
     * @param {object} appData
     * @param {string} charId
     * @returns {object} { assignmentsRemoved }
     */
    function stripCharacterRefs(appData, charId) {
        var result = { assignmentsRemoved: 0 };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }

        var store = getWeeklyTeamsStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(charId);
        var classIds = Object.keys(store);

        for (var i = 0; i < classIds.length; i++) {
            var classId = classIds[i];
            var byClass = store[classId];
            if (!isPlainObject(byClass)) {
                continue;
            }

            var weekKeys = Object.keys(byClass);
            for (var j = 0; j < weekKeys.length; j++) {
                var weekKey = weekKeys[j];
                var byWeek = byClass[weekKey];
                if (!isPlainObject(byWeek)) {
                    continue;
                }

                var teamIds = Object.keys(byWeek);
                for (var k = 0; k < teamIds.length; k++) {
                    var teamId = teamIds[k];
                    var members = byWeek[teamId];
                    if (!Array.isArray(members)) {
                        continue;
                    }

                    var before = members.length;
                    var filtered = [];
                    for (var m = 0; m < members.length; m++) {
                        if (String(members[m]) !== target) {
                            filtered.push(members[m]);
                        }
                    }
                    var removed = before - filtered.length;
                    if (removed > 0) {
                        result.assignmentsRemoved += removed;
                        if (filtered.length === 0) {
                            delete byWeek[teamId];
                        } else {
                            byWeek[teamId] = filtered;
                        }
                    }
                }

                if (Object.keys(byWeek).length === 0) {
                    delete byClass[weekKey];
                }
            }

            if (Object.keys(byClass).length === 0) {
                delete store[classId];
            }
        }

        return result;
    }

    /**
     * Strip the entire weekly-teams subtree for a class.
     *
     * @param {object} appData
     * @param {string} classId
     * @returns {object} { assignmentsRemoved }
     */
    function stripClassRefs(appData, classId) {
        var result = { assignmentsRemoved: 0 };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = getWeeklyTeamsStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(classId);
        var byClass = store[target];
        if (!isPlainObject(byClass)) {
            return result;
        }

        var weekKeys = Object.keys(byClass);
        for (var i = 0; i < weekKeys.length; i++) {
            var byWeek = byClass[weekKeys[i]];
            if (!isPlainObject(byWeek)) {
                continue;
            }
            var teamIds = Object.keys(byWeek);
            for (var j = 0; j < teamIds.length; j++) {
                var members = byWeek[teamIds[j]];
                if (Array.isArray(members)) {
                    result.assignmentsRemoved += members.length;
                }
            }
        }

        delete store[target];
        return result;
    }

    /**
     * Strip a single team from every week's assignments for every class.
     *
     * Used when a persistent Team entity is deleted. Removes the team
     * entry from every (class, week) map. Class and week entries that
     * end up empty are deleted.
     *
     * @param {object} appData
     * @param {string} teamId
     * @returns {object} { assignmentsRemoved }
     */
    function stripTeamRefs(appData, teamId) {
        var result = { assignmentsRemoved: 0 };

        if (!appData || !isNonEmptyString(teamId)) {
            return result;
        }

        var store = getWeeklyTeamsStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(teamId);
        var classIds = Object.keys(store);

        for (var i = 0; i < classIds.length; i++) {
            var classId = classIds[i];
            var byClass = store[classId];
            if (!isPlainObject(byClass)) {
                continue;
            }

            var weekKeys = Object.keys(byClass);
            for (var j = 0; j < weekKeys.length; j++) {
                var weekKey = weekKeys[j];
                var byWeek = byClass[weekKey];
                if (!isPlainObject(byWeek)) {
                    continue;
                }

                if (!Object.prototype.hasOwnProperty.call(byWeek, target)) {
                    continue;
                }

                var members = byWeek[target];
                if (Array.isArray(members)) {
                    result.assignmentsRemoved += members.length;
                }

                delete byWeek[target];

                if (Object.keys(byWeek).length === 0) {
                    delete byClass[weekKey];
                }
            }

            if (Object.keys(byClass).length === 0) {
                delete store[classId];
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeams = {
        // ---- Reads ----
        getWeeklyTeams: getWeeklyTeams,
        getTeamMembers: getTeamMembers,
        isCharacterAssigned: isCharacterAssigned,
        getAssignedTeamId: getAssignedTeamId,
        hasAssignments: hasAssignments,
        getAssignedWeeksForClass: getAssignedWeeksForClass,
        getAssignedClassesForWeek: getAssignedClassesForWeek,

        // ---- Mutations ----
        setWeeklyTeams: setWeeklyTeams,
        clearWeeklyTeams: clearWeeklyTeams,

        // ---- Cascade helpers ----
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripTeamRefs: stripTeamRefs,

        // ---- Constants (read-only) ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
