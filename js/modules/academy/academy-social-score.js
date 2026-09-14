/**
 * modules/academy/academy-social-score.js - Academy Social Score
 * SINGLE SOURCE OF TRUTH for per-student social scores.
 *
 * Path: js/modules/academy/academy-social-score.js
 *
 * This module is responsible for:
 *   - Social score CRUD (set, clear, bulk set)
 *   - Social score queries (by class + week, by student)
 *   - Cascade cleanup on character / class deletion
 *
 * IMPORTANT:
 *   - Social score is CLASS-SCOPED and WEEK-SCOPED.
 *   - Storage: window.data.academy.socialScores[classId][charId][week] = number
 *   - Social score is a percentage-like value in 0..100.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *
 * STORAGE SHAPE:
 *   academy.socialScores = {
 *     'class_789': {
 *       'char_456': { '5': 82, '6': 88 },
 *       'char_457': { '5': 75 }
 *     }
 *   }
 *
 * Week keys are stored as strings (JSON object keys).
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (MANDATORY)
 *   - window.ValidationUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.MutationPipeline (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academySocialScoreLoaded) {
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
        throw new Error('[AcademySocialScore] Missing dependencies: ' + missing.join(', '));
    }

    window.__academySocialScoreLoaded = true;

    var ValidationUtils = window.ValidationUtils;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

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

    function ensureSocialScoreStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.socialScores ||
            typeof appData.academy.socialScores !== 'object' ||
            Array.isArray(appData.academy.socialScores)) {
            appData.academy.socialScores = {};
        }
        return appData.academy.socialScores;
    }

    // ============================================================
    // READS
    // ============================================================

    function getSocialScore(charId, classId, week) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return null;
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return null;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.socialScores) { return null; }
        var byClass = academy.socialScores[String(classId)];
        if (!byClass || typeof byClass !== 'object') { return null; }
        var byWeek = byClass[String(charId)];
        if (!byWeek || typeof byWeek !== 'object') { return null; }
        var value = byWeek[String(weekNum)];
        if (typeof value !== 'number' || !isFinite(value)) { return null; }
        return value;
    }

    /**
     * Get social scores for a class + week as a map { charId: number }.
     * Only students with a set score appear in the map.
     */
    function getClassSocialScores(classId, week) {
        var result = {};
        if (!isNonEmptyString(classId)) { return result; }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return result;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.socialScores) { return result; }
        var byClass = academy.socialScores[String(classId)];
        if (!byClass || typeof byClass !== 'object') { return result; }

        var charIds = Object.keys(byClass);
        for (var i = 0; i < charIds.length; i++) {
            var byWeek = byClass[charIds[i]];
            if (!byWeek || typeof byWeek !== 'object') { continue; }
            var value = byWeek[String(weekNum)];
            if (typeof value === 'number' && isFinite(value)) {
                result[charIds[i]] = value;
            }
        }
        return result;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    function setSocialScore(charId, classId, week, score) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }
        var scoreNum = Number(score);
        if (isNaN(scoreNum) || scoreNum < MIN_SCORE || scoreNum > MAX_SCORE) {
            return Promise.resolve(failure('Score must be between ' + MIN_SCORE + ' and ' + MAX_SCORE + '.'));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetWeek = String(weekNum);
        var clamped = Math.round(scoreNum);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureSocialScoreStore(appData);
                if (!store[targetClass]) {
                    store[targetClass] = {};
                }
                if (!store[targetClass][targetChar] ||
                    typeof store[targetClass][targetChar] !== 'object') {
                    store[targetClass][targetChar] = {};
                }
                store[targetClass][targetChar][targetWeek] = clamped;
                return { value: clamped };
            },
            logMessage: 'Set social score for ' + targetChar + ' in ' + targetClass + ' week ' + targetWeek,
            successMessage: 'Social score saved.',
            failureMessage: 'Failed to save social score.'
        });
    }

    function clearSocialScore(charId, classId, week) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return Promise.resolve(failure('Character ID and class ID are required.'));
        }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required.'));
        }

        var targetChar = String(charId);
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
                var store = ensureSocialScoreStore(appData);
                if (!store[targetClass] || !store[targetClass][targetChar]) {
                    return { cleared: false };
                }
                if (store[targetClass][targetChar][targetWeek] !== undefined) {
                    delete store[targetClass][targetChar][targetWeek];
                    return { cleared: true };
                }
                return { cleared: false };
            },
            logMessage: 'Cleared social score for ' + targetChar,
            successMessage: 'Social score cleared.',
            failureMessage: 'Failed to clear social score.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    function stripCharacterRefs(appData, charId) {
        var result = { socialScoresRemoved: 0 };
        if (!appData || !charId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.socialScores;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(charId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                delete byClass[target];
                result.socialScoresRemoved++;
            }
        }
        return result;
    }

    function stripClassRefs(appData, classId) {
        var result = { socialScoresRemoved: 0 };
        if (!appData || !classId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.socialScores;
        if (!store || typeof store !== 'object') { return result; }
        var target = String(classId);
        if (store[target]) {
            result.socialScoresRemoved = Object.keys(store[target]).length;
            delete store[target];
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySocialScore = {
        getSocialScore: getSocialScore,
        getClassSocialScores: getClassSocialScores,
        setSocialScore: setSocialScore,
        clearSocialScore: clearSocialScore,
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE
    };

})();
