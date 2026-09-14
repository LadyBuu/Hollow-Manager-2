/**
 * modules/academy/academy-weekly-teams.js - Academy Weekly Teams
 * SINGLE SOURCE OF TRUTH for week-scoped team assignments.
 *
 * Path: js/modules/academy/academy-weekly-teams.js
 *
 * This module is responsible for:
 *   - Assigning students to teams for a specific class + week
 *   - Clearing assignments
 *   - Querying assignments
 *   - Cascade cleanup on character / class / team deletion
 *
 * IMPORTANT:
 *   - A weekly assignment is DISTINCT from a persistent Team entity.
 *     The Team entity has a roster with join/leave periods. The
 *     weekly assignment says "for this class, this week, these
 *     students belong to this team".
 *   - Storage: window.data.academy.weeklyTeams[classId][week][teamId] = [charId]
 *   - A student can appear in at most one team per (class, week).
 *     assign() enforces this by removing prior membership in the same
 *     class + week.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *
 * STORAGE SHAPE:
 *   academy.weeklyTeams = {
 *     'class_789': {
 *       '5': {
 *         'team_a': ['char_1', 'char_2'],
 *         'team_b': ['char_3']
 *       }
 *     }
 *   }
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (MANDATORY)
 *   - window.ValidationUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.MutationPipeline (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }
    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }
    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyWeeklyTeams] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyWeeklyTeamsLoaded = true;

    var ValidationUtils = window.ValidationUtils;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // INTERNAL ACCESS
    // ============================================================

    function getAcademyStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        return window.data.academy;
    }

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
     * Get the team assignments for a class + week.
     *
     * @returns {object} { teamId: [charId], ... }
     */
    function getWeeklyTeams(classId, week) {
        var result = {};
        if (!isNonEmptyString(classId)) { return result; }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return result;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.weeklyTeams) { return result; }
        var byClass = academy.weeklyTeams[String(classId)];
        if (!byClass || typeof byClass !== 'object') { return result; }
        var byWeek = byClass[String(weekNum)];
        if (!byWeek || typeof byWeek !== 'object') { return result; }

        var teamIds = Object.keys(byWeek);
        for (var i = 0; i < teamIds.length; i++) {
            var arr = byWeek[teamIds[i]];
            result[teamIds[i]] = Array.isArray(arr) ? arr.slice() : [];
        }
        return result;
    }

    /**
     * Get the teamId a student is assigned to for a class + week,
     * or null.
     */
    function getTeamForStudent(charId, classId, week) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return null;
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) { return null; }
        var teams = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(teams);
        for (var i = 0; i < teamIds.length; i++) {
            var arr = teams[teamIds[i]];
            for (var j = 0; j < arr.length; j++) {
                if (String(arr[j]) === target) {
                    return teamIds[i];
                }
            }
        }
        return null;
    }

    /**
     * Get the character IDs assigned to a team for a class + week.
     */
    function getTeamMembers(teamId, classId, week) {
        if (!isNonEmptyString(teamId)) { return []; }
        var teams = getWeeklyTeams(classId, week);
        var arr = teams[String(teamId)];
        return Array.isArray(arr) ? arr : [];
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Assign a set of students to a team for a class + week.
     *
     * SEMANTICS:
     *   - Any student currently assigned to another team in the same
     *     (class, week) is removed from that team first.
     *   - The team's member list becomes exactly the supplied list.
     *   - Any team that ends with an empty member list is removed.
     */
    function assignStudents(teamId, classId, week, charIds) {
        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required.'));
        }
        if (!Array.isArray(charIds)) {
            return Promise.resolve(failure('Character IDs must be an array.'));
        }

        var targetTeam = String(teamId);
        var targetClass = String(classId);
        var targetWeek = String(weekNum);

        var cleaned = [];
        var seen = {};
        for (var i = 0; i < charIds.length; i++) {
            var id = charIds[i];
            if (!isNonEmptyString(id)) { continue; }
            var trimmed = String(id).trim();
            if (seen[trimmed]) { continue; }
            seen[trimmed] = true;
            cleaned.push(trimmed);
        }
        cleaned.sort();

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
                if (!store[targetClass][targetWeek]) {
                    store[targetClass][targetWeek] = {};
                }
                var byWeek = store[targetClass][targetWeek];

                // Remove each assigned student from any OTHER team
                // in this class + week.
                var assignedSet = {};
                for (var k = 0; k < cleaned.length; k++) {
                    assignedSet[cleaned[k]] = true;
                }
                var teamIds = Object.keys(byWeek);
                for (var t = 0; t < teamIds.length; t++) {
                    var tid = teamIds[t];
                    if (tid === targetTeam) { continue; }
                    var arr = byWeek[tid];
                    if (!Array.isArray(arr)) { continue; }
                    byWeek[tid] = arr.filter(function(id) {
                        return !assignedSet[String(id)];
                    });
                }

                // Set the target team's roster.
                if (cleaned.length === 0) {
                    delete byWeek[targetTeam];
                } else {
                    byWeek[targetTeam] = cleaned.slice();
                }

                // Prune any now-empty teams.
                var allTeamIds = Object.keys(byWeek);
                for (var p = 0; p < allTeamIds.length; p++) {
                    var pid = allTeamIds[p];
                    if (!Array.isArray(byWeek[pid]) || byWeek[pid].length === 0) {
                        delete byWeek[pid];
                    }
                }

                return { assigned: cleaned.length };
            },
            logMessage: 'Assigned ' + cleaned.length + ' student(s) to ' + targetTeam + ' (week ' + targetWeek + ')',
            successMessage: 'Team assignments saved.',
            failureMessage: 'Failed to save assignments.'
        });
    }

    /**
     * Clear all assignments for a class + week.
     */
    function clearWeek(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
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
                if (!store[targetClass] || !store[targetClass][targetWeek]) {
                    return { cleared: false };
                }
                delete store[targetClass][targetWeek];
                return { cleared: true };
            },
            logMessage: 'Cleared weekly teams for class ' + targetClass + ' week ' + targetWeek,
            successMessage: 'Weekly teams cleared.',
            failureMessage: 'Failed to clear weekly teams.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    function stripCharacterRefs(appData, charId) {
        var result = { assignmentsRemoved: 0 };
        if (!appData || !charId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(charId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            var weekKeys = Object.keys(byClass);
            for (var w = 0; w < weekKeys.length; w++) {
                var byWeek = byClass[weekKeys[w]];
                if (!byWeek || typeof byWeek !== 'object') { continue; }
                var teamIds = Object.keys(byWeek);
                for (var t = 0; t < teamIds.length; t++) {
                    var arr = byWeek[teamIds[t]];
                    if (!Array.isArray(arr)) { continue; }
                    var before = arr.length;
                    byWeek[teamIds[t]] = arr.filter(function(id) {
                        return String(id) !== target;
                    });
                    result.assignmentsRemoved += before - byWeek[teamIds[t]].length;
                    if (byWeek[teamIds[t]].length === 0) {
                        delete byWeek[teamIds[t]];
                    }
                }
            }
        }
        return result;
    }

    function stripClassRefs(appData, classId) {
        var result = { assignmentsRemoved: 0 };
        if (!appData || !classId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object') { return result; }
        var target = String(classId);
        if (store[target]) {
            delete store[target];
            result.assignmentsRemoved = 1;
        }
        return result;
    }

    function stripTeamRefs(appData, teamId) {
        var result = { assignmentsRemoved: 0 };
        if (!appData || !teamId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.weeklyTeams;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(teamId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            var weekKeys = Object.keys(byClass);
            for (var w = 0; w < weekKeys.length; w++) {
                var byWeek = byClass[weekKeys[w]];
                if (!byWeek || typeof byWeek !== 'object') { continue; }
                if (byWeek[target]) {
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
        getWeeklyTeams: getWeeklyTeams,
        getTeamForStudent: getTeamForStudent,
        getTeamMembers: getTeamMembers,
        assignStudents: assignStudents,
        clearWeek: clearWeek,
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripTeamRefs: stripTeamRefs
    };

})();
