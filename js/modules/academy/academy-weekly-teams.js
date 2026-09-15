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
 *   - AcademyCascade calls strip*Refs on delete.
 *   - AcademyWeeklyTeamsView renders the resulting VM.
 *
 * DEPENDENCIES:
 *   - ObjectUtils.deepClone
 *   - ValidationUtils.isNonEmptyString
 *   - CalendarValidation.parseWeek
 *   - MutationPipeline.performMutation
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsLoaded) {
        return;
    }

    var _missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeams] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsLoaded = true;

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var MutationPipeline = window.MutationPipeline;

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
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

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getWeeklyTeamsStore() {
        if (!window.data || typeof window.data !== 'object') { return null; }
        if (!window.data.academy || typeof window.data.academy !== 'object') { return null; }
        var store = window.data.academy.weeklyTeams;
        if (!store || typeof store !== 'object' || Array.isArray(store)) { return null; }
        return store;
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
    // NORMALISATION
    // ============================================================

    function normaliseAssignments(raw) {
        var cleaned = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return cleaned;
        }

        var teamIds = Object.keys(raw);
        for (var i = 0; i < teamIds.length; i++) {
            var rawTeamId = teamIds[i];
            if (!isNonEmptyString(rawTeamId)) { continue; }
            var teamId = String(rawTeamId).trim();

            var members = raw[rawTeamId];
            if (!Array.isArray(members)) { continue; }

            var seen = Object.create(null);
            var clean = [];
            for (var j = 0; j < members.length; j++) {
                var id = String(
                    members[j] === undefined || members[j] === null
                        ? ''
                        : members[j]
                ).trim();
                if (id === '' || seen[id]) { continue; }
                seen[id] = true;
                clean.push(id);
            }
            clean.sort();
            cleaned[teamId] = clean;
        }

        return cleaned;
    }

    // ============================================================
    // READS
    // ============================================================

    function getWeeklyTeams(classId, week) {
        if (!isNonEmptyString(classId)) { return {}; }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) { return {}; }

        var store = getWeeklyTeamsStore();
        if (!store) { return {}; }

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

    function getTeamMembers(classId, week, teamId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) { return []; }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) { return []; }

        var assignments = getWeeklyTeams(classId, weekNum);
        var members = assignments[String(teamId)];
        if (!Array.isArray(members)) { return []; }
        return members.slice();
    }

    function isCharacterAssigned(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) { return false; }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) { return false; }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);
        for (var i = 0; i < teamIds.length; i++) {
            var members = assignments[teamIds[i]];
            if (!Array.isArray(members)) { continue; }
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) { return true; }
            }
        }
        return false;
    }

    function getAssignedTeamId(classId, week, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) { return null; }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) { return null; }

        var assignments = getWeeklyTeams(classId, weekNum);
        var target = String(charId);
        var teamIds = Object.keys(assignments);
        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = assignments[teamId];
            if (!Array.isArray(members)) { continue; }
            for (var j = 0; j < members.length; j++) {
                if (String(members[j]) === target) { return teamId; }
            }
        }
        return null;
    }

    function hasAssignments(classId, week) {
        if (!isNonEmptyString(classId)) { return false; }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) { return false; }
        var assignments = getWeeklyTeams(classId, weekNum);
        return Object.keys(assignments).length > 0;
    }

    function getAssignedWeeksForClass(classId) {
        if (!isNonEmptyString(classId)) { return []; }

        var store = getWeeklyTeamsStore();
        if (!store) { return []; }

        var byClass = store[String(classId)];
        if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
            return [];
        }

        var weeks = [];
        var weekKeys = Object.keys(byClass);
        for (var i = 0; i < weekKeys.length; i++) {
            var weekNum = CalendarValidation.parseWeek(weekKeys[i]);
            if (weekNum !== null) { weeks.push(weekNum); }
        }
        weeks.sort(function(a, b) { return a - b; });
        return weeks;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

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
        var cleaned = normaliseAssignments(assignments);

        // Enforce single-team-per-character. Deterministic resolution
        // by lexicographic team ID so the outcome is stable regardless
        // of the input object's key order.
        var seenCharacters = Object.create(null);
        var finalAssignments = {};
        var teamIds = Object.keys(cleaned).sort();

        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            var members = cleaned[teamId];
            var filtered = [];
            for (var j = 0; j < members.length; j++) {
                var memberId = members[j];
                if (seenCharacters[memberId]) { continue; }
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
                if (!store[targetClass]) { store[targetClass] = {}; }
                store[targetClass][targetWeek] = deepClone(finalAssignments);
                return {
                    classId: targetClass,
                    week: weekNum,
                    teamCount: Object.keys(finalAssignments).length
                };
            },
            logMessage: 'Set weekly teams for class ' + targetClass + ', week ' + targetWeek,
            successMessage: 'Weekly teams saved.',
            failureMessage: 'Failed to save weekly teams.'
        });
   
