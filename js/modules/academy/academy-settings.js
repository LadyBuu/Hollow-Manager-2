/**
 * js/modules/academy/academy-settings.js - Academy Settings
 * SINGLE SOURCE OF TRUTH for academy-scoped settings.
 *
 * Path: js/modules/academy/academy-settings.js
 *
 * This module is responsible for:
 *   - Owning academy.settings on window.data
 *   - Providing read access to settings (synchronous, side-effect free)
 *   - Providing write access to settings (Promise-based, via MutationPipeline)
 *   - Validating settings values
 *   - Providing default values for every setting
 *
 * IMPORTANT:
 *   - This module OWNS the settings subtree. No other module writes
 *     to window.data.academy.settings.
 *   - All MUTATIONS go through MutationPipeline. The pipeline owns
 *     persistence, rollback, and activity logging.
 *   - All READS are synchronous and side-effect free.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input. No silent fallbacks.
 *   - Public reads return DEEP CLONES. No live references escape.
 *
 * READ SAFETY:
 *   - getAcademyStore() returns null (does NOT create academy.{...})
 *     when the store is missing. Reads never mutate.
 *   - getSettingsStore() returns a plain object view of the live
 *     settings. It does NOT create the subtree on read.
 *   - Structure creation happens only inside pipeline mutate()
 *     callbacks, operating on the appData snapshot.
 *
 * SETTINGS SHAPE:
 *   window.data.academy.settings = {
 *     ranking: {
 *       academic: 0.85,
 *       social: 0.15
 *     }
 *   }
 *
 * RANKING WEIGHTS:
 *   - academic + social are the blend weights used by
 *     AcademyPerformance.calculateOverallScore.
 *   - Both must be finite non-negative numbers.
 *   - Their sum must be strictly positive (> 0). A sum of zero would
 *     make the blend undefined.
 *   - They do NOT have to sum to exactly 1.0. The performance layer
 *     normalises by the sum. Allowing e.g. 17/3 preserves intent when
 *     a caller wants to think in integer ratios.
 *   - When the stored values are malformed or missing, reads return
 *     the defaults.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *
 * USAGE:
 *   var S = window.AcademySettings;
 *
 *   var weights = S.getRankingWeights();
 *   // → { academic: 0.85, social: 0.15 }
 *
 *   S.setRankingWeights({ academic: 0.7, social: 0.3 }).then(function(result) {
 *       if (result.success) { ... }
 *   });
 *
 *   S.resetRankingWeights().then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__academySettingsLoaded) {
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

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademySettings] Missing dependencies: ' + missing.join(', '));
    }

    window.__academySettingsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // CONSTANTS
    // ============================================================

    /**
     * The default academic/social split. Matches the plan's locked
     * decision.
     */
    var DEFAULT_RANKING_WEIGHTS = Object.freeze({
        academic: 0.85,
        social: 0.15
    });

    /**
     * Rounding precision for weight values. One decimal is enough for
     * any human-meaningful weight (0.1 granularity). This matches the
     * rounding the discipline editor uses for assessment weights.
     */
    var WEIGHT_PRECISION = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademySettings] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
    }

    function round(value) {
        if (!isFiniteNumber(value)) { return 0; }
        var factor = Math.pow(10, WEIGHT_PRECISION);
        return Math.round(value * factor) / factor;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================
    //
    // READ SAFETY:
    //   - getDataStore returns null when window.data is missing.
    //   - getAcademyStore returns null when window.data.academy is
    //     missing. It does NOT create the academy subtree on read.
    //   - getSettingsStore returns null when academy.settings is
    //     missing. It does NOT create the settings subtree on read.

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getAcademyStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }
        if (!data.academy || typeof data.academy !== 'object') {
            return null;
        }
        return data.academy;
    }

    function getSettingsStore() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }
        if (!academy.settings || typeof academy.settings !== 'object') {
            return null;
        }
        return academy.settings;
    }

    /**
     * Ensure the settings store exists on the given appData snapshot.
     * Only called from inside pipeline mutate() callbacks.
     */
    function ensureSettingsStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.settings || typeof appData.academy.settings !== 'object' || Array.isArray(appData.academy.settings)) {
            appData.academy.settings = {};
        }
        return appData.academy.settings;
    }

    // ============================================================
    // RANKING WEIGHTS - READ
    // ============================================================

    /**
     * Get a fresh copy of the default ranking weights.
     * Callers can mutate the result without affecting the frozen
     * canonical default.
     */
    function getDefaultRankingWeights() {
        return {
            academic: DEFAULT_RANKING_WEIGHTS.academic,
            social: DEFAULT_RANKING_WEIGHTS.social
        };
    }

    /**
     * Get the current ranking weights.
     *
     * Reads from academy.settings.ranking. When any of the following
     * is true, returns the default weights:
     *   - academy.settings is missing
     *   - academy.settings.ranking is missing
     *   - ranking.academic or ranking.social is not a finite number
     *   - either weight is negative
     *   - both weights are zero (sum is not positive)
     *
     * The returned object is always a fresh copy.
     *
     * @returns {object} { academic: number, social: number }
     */
    function getRankingWeights() {
        var settings = getSettingsStore();
        if (!settings || !settings.ranking || typeof settings.ranking !== 'object') {
            return getDefaultRankingWeights();
        }

        var ranking = settings.ranking;
        var academic = ranking.academic;
        var social = ranking.social;

        if (!isFiniteNumber(academic) || !isFiniteNumber(social)) {
            return getDefaultRankingWeights();
        }

        if (academic < 0 || social < 0) {
            return getDefaultRankingWeights();
        }

        if ((academic + social) <= 0) {
            return getDefaultRankingWeights();
        }

        return {
            academic: academic,
            social: social
        };
    }

    // ============================================================
    // RANKING WEIGHTS - VALIDATION
    // ============================================================

    /**
     * Validate a ranking weights input.
     *
     * @param {object} weights
     * @returns {object} { valid: boolean, message?: string, value?: object }
     */
    function validateRankingWeights(weights) {
        if (!isObject(weights)) {
            return { valid: false, message: 'Ranking weights must be an object.' };
        }

        if (!isFiniteNumber(weights.academic)) {
            return { valid: false, message: 'Academic weight must be a finite number.' };
        }
        if (!isFiniteNumber(weights.social)) {
            return { valid: false, message: 'Social weight must be a finite number.' };
        }
        if (weights.academic < 0) {
            return { valid: false, message: 'Academic weight must be non-negative.' };
        }
        if (weights.social < 0) {
            return { valid: false, message: 'Social weight must be non-negative.' };
        }
        if ((weights.academic + weights.social) <= 0) {
            return { valid: false, message: 'At least one weight must be greater than zero.' };
        }

        return {
            valid: true,
            value: {
                academic: round(weights.academic),
                social: round(weights.social)
            }
        };
    }

    // ============================================================
    // RANKING WEIGHTS - WRITE
    // ============================================================

    /**
     * Set the ranking weights.
     *
     * @param {object} weights - { academic, social }
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function setRankingWeights(weights) {
        var validation = validateRankingWeights(weights);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var value = validation.value;

        // Pre-flight: identical to current state? No-op.
        var current = getRankingWeights();
        if (current.academic === value.academic && current.social === value.social) {
            return Promise.resolve(success({
                weights: value,
                changed: false
            }));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var settings = ensureSettingsStore(appData);
                if (!settings.ranking || typeof settings.ranking !== 'object') {
                    settings.ranking = {};
                }
                settings.ranking.academic = value.academic;
                settings.ranking.social = value.social;
                return { weights: value, changed: true };
            },
            logMessage: 'Updated ranking weights to ' +
                value.academic + ' / ' + value.social,
            successMessage: 'Ranking weights updated.',
            failureMessage: 'Failed to update ranking weights.'
        });
    }

    /**
     * Reset the ranking weights to the defaults.
     *
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function resetRankingWeights() {
        return setRankingWeights({
            academic: DEFAULT_RANKING_WEIGHTS.academic,
            social: DEFAULT_RANKING_WEIGHTS.social
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySettings = {
        // Ranking weights — read
        getRankingWeights: getRankingWeights,
        getDefaultRankingWeights: getDefaultRankingWeights,

        // Ranking weights — write
        setRankingWeights: setRankingWeights,
        resetRankingWeights: resetRankingWeights,

        // Validation
        validateRankingWeights: validateRankingWeights,

        // Constants (read-only)
        DEFAULT_RANKING_WEIGHTS: DEFAULT_RANKING_WEIGHTS
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySettings;
        var missing = [];

        var required = [
            'getRankingWeights',
            'getDefaultRankingWeights',
            'setRankingWeights',
            'resetRankingWeights',
            'validateRankingWeights'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademySettings] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
