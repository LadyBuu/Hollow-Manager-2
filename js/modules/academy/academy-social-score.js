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
 *   - Social score is an INTEGER percentage in [0, 100].
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
 *   Week keys are stored as strings (JSON object keys).
 *
 * INTEGER SCORES:
 *   Social scores are integer percentages from 0 to 100. The
 *   validator REJECTS non-integer input. A fractional score such as
 *   82.5 is a caller error, not a value to be silently rounded.
 *
 *   The storage invariant is: the value you wrote is the value you
 *   read. Silent rounding would break that.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the `appData` argument it is handed. It does not read
 *   window.data. Preflight reads against window.data are for early
 *   UX feedback only; the pipeline re-checks against the snapshot.
 *
 * FOREIGN KEYS:
 *   A social score carries two foreign keys: classId, charId.
 *
 *   - classId MUST resolve in the transaction snapshot.
 *   - charId MUST resolve in the transaction snapshot.
 *
 *   The module does NOT require the character to be enrolled in
 *   the class at the target week. A score can legitimately be
 *   recorded for a student who has since left the class; the
 *   historical record survives. Callers that need to enforce
 *   "only currently-enrolled students" do so at their own layer.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, the
 *   canonical strict parser. No `parseInt` coercion. "5bananas"
 *   is rejected, not silently accepted as 5.
 *
 * NULL SEMANTICS ON READ:
 *   getSocialScore returns null when:
 *     - the studentId or classId is invalid
 *     - the week is invalid
 *     - no score has been recorded for this (student, class, week)
 *
 *   The null is the same in all three cases. Callers that need to
 *   distinguish "invalid input" from "no record" call the validator
 *   first or check the input themselves.
 *
 * GET-CLASS-SOCIAL-SCORES CONTRACT:
 *   Returns {} for:
 *     - an invalid classId (empty, non-string)
 *     - an invalid week
 *     - a class with no recorded scores
 *
 *   The three cases collapse to the same empty object. This is
 *   consistent with getSocialScore's null semantics. Callers that
 *   need the distinction validate their inputs first.
 *
 * CASCADE STRICTNESS:
 *   stripCharacterRefs and stripClassRefs operate on a destructive
 *   cascade. A missing store is a no-op; a malformed store is an
 *   error.
 *
 * DEPENDENCIES:
 *   - window.ValidationUtils (MANDATORY)
 *   - window.CalendarValidation (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.MutationPipeline (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academySocialScoreLoaded) {
        return;
    }

    var missing = [];

    if (!window.ValidationUtils ||
        typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!window.CalendarValidation ||
        typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }
    if (!window.CalendarConstants ||
        typeof window.CalendarConstants.MIN_WEEK !== 'number' ||
        typeof window.CalendarConstants.MAX_WEEK !== 'number') {
        missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!window.MutationPipeline ||
        typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademySocialScore] Missing dependencies: ' + missing.join(', '));
    }

    window.__academySocialScoreLoaded = true;

    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // STORE ACCESS
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

    function getStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.socialScores;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
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
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================

    function findClassInSnapshot(appData, classId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var store = appData.academy.graduatingClasses;
        if (!isPlainObject(store)) {
            return null;
        }
        if (!isNonEmptyString(classId)) {
            return null;
        }
        return store[String(classId)] || null;
    }

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        if (!isNonEmptyString(charId)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    // ============================================================
    // READS
    // ============================================================

    /**
     * Get a single social score for a (character, class, week).
     *
     * Returns null on any invalid input, and null when no score has
     * been recorded. The two cases are indistinguishable at this
     * API; callers that need the distinction validate their inputs
     * first.
     *
     * @returns {number|null}
     */
    function getSocialScore(charId, classId, week) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return null;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return null;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.socialScores) {
            return null;
        }
        var byClass = academy.socialScores[String(classId)];
        if (!isPlainObject(byClass)) {
            return null;
        }
        var byWeek = byClass[String(charId)];
        if (!isPlainObject(byWeek)) {
            return null;
        }
        var value = byWeek[String(weekNum)];
        if (typeof value !== 'number' || !isFinite(value)) {
            return null;
        }
        return value;
    }

    /**
     * Get social scores for a (class, week) as a map { charId: number }.
     *
     * Returns {} for an invalid classId, an invalid week, or a class
     * with no recorded scores. The three cases collapse to the same
     * empty object; callers that need the distinction validate their
     * inputs first.
     *
     * @returns {object} map of charId to score
     */
    function getClassSocialScores(classId, week) {
        var result = {};
        if (!isNonEmptyString(classId)) {
            return result;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return result;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.socialScores) {
            return result;
        }
        var byClass = academy.socialScores[String(classId)];
        if (!isPlainObject(byClass)) {
            return result;
        }

        var charIds = Object.keys(byClass);
        for (var i = 0; i < charIds.length; i++) {
            var byWeek = byClass[charIds[i]];
            if (!isPlainObject(byWeek)) {
                continue;
            }
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

    /**
     * Set a social score for a (character, class, week).
     *
     * VALIDATION ORDER:
     *   1. Validate the input shape preflight.
     *   2. Re-validate against the transaction snapshot, including
     *      class and character existence.
     *   3. Apply.
     *
     * SCORE INTEGER CONTRACT:
     *   The score must be an integer in [0, 100]. A fractional value
     *   is rejected, not rounded. The storage invariant is: the
     *   value you wrote is the value you read.
     *
     * @returns {Promise<{ success, data?, message? }>}
     */
    function setSocialScore(charId, classId, week, score) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        // Strict integer score. Reject fractions rather than round.
        var scoreNum = Number(score);
        if (!isFinite(scoreNum) || !Number.isInteger(scoreNum)) {
            return Promise.resolve(failure(
                'Score must be an integer between ' +
                MIN_SCORE + ' and ' + MAX_SCORE + '.'
            ));
        }
        if (scoreNum < MIN_SCORE || scoreNum > MAX_SCORE) {
            return Promise.resolve(failure(
                'Score must be between ' +
                MIN_SCORE + ' and ' + MAX_SCORE + '.'
            ));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetWeek = String(weekNum);

        // Preflight references (UX). The pipeline re-checks against
        // the snapshot.
        if (!findClassInSnapshot(window.data, targetClass)) {
            return Promise.resolve(failure('Class not found.'));
        }
        if (!findCharacterInSnapshot(window.data, targetChar)) {
            return Promise.resolve(failure('Character not found.'));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                // Authoritative reference checks against the snapshot.
                if (!findClassInSnapshot(appData, targetClass)) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }
                if (!findCharacterInSnapshot(appData, targetChar)) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureSocialScoreStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }
                if (!isPlainObject(store[targetClass][targetChar])) {
                    store[targetClass][targetChar] = {};
                }
                store[targetClass][targetChar][targetWeek] = scoreNum;
                return { value: scoreNum };
            },
            logMessage: 'Set social score for ' + targetChar +
                ' in ' + targetClass + ' week ' + targetWeek,
            successMessage: 'Social score saved.',
            failureMessage: 'Failed to save social score.'
        });
    }

    /**
     * Clear a social score for a (character, class, week).
     *
     * IDEMPOTENT: a (character, class, week) with no recorded score
     * is a successful no-op.
     *
     * @returns {Promise<{ success, data?, message? }>}
     */
    function clearSocialScore(charId, classId, week) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(classId)) {
            return Promise.resolve(failure(
                'Character ID and class ID are required.'
            ));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return Promise.resolve(failure(
                'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'
            ));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetWeek = String(weekNum);

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
                var store = ensureSocialScoreStore(appData);
                if (!isPlainObject(store[targetClass]) ||
                    !isPlainObject(store[targetClass][targetChar])) {
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
    //
    // Pure with respect to appData. Never touch window.data. Run
    // inside another module's pipeline transaction.
    //
    // STRICTNESS:
    //   - academy.socialScores absent → no-op
    //   - academy.socialScores present but malformed → throw

    function readStoreForCascade(appData, helperName) {
        if (!appData || !appData.academy) {
            return null;
        }

        var store = appData.academy.socialScores;

        if (store === undefined || store === null) {
            return null;
        }

        if (typeof store !== 'object' || Array.isArray(store)) {
            throw new Error(
                '[AcademySocialScore] ' + helperName + ' found a ' +
                'malformed academy.socialScores store on the snapshot. ' +
                'Expected a plain object; got ' +
                (Array.isArray(store) ? 'array' : typeof store) + '.'
            );
        }

        return store;
    }

    function stripCharacterRefs(appData, charId) {
        var result = { socialScoresRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        var store = readStoreForCascade(
            appData, 'stripCharacterRefs'
        );
        if (!store) {
            return result;
        }

        var target = String(charId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                delete byClass[target];
                result.socialScoresRemoved++;
            }
            if (Object.keys(byClass).length === 0) {
                delete store[classIds[i]];
            }
        }
        return result;
    }

    function stripClassRefs(appData, classId) {
        var result = { socialScoresRemoved: 0 };

        if (!appData || !classId) {
            return result;
        }

        var store = readStoreForCascade(
            appData, 'stripClassRefs'
        );
        if (!store) {
            return result;
        }

        var target = String(classId);
        if (Object.prototype.hasOwnProperty.call(store, target)) {
            var byClass = store[target];
            if (isPlainObject(byClass)) {
                result.socialScoresRemoved = Object.keys(byClass).length;
            }
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
