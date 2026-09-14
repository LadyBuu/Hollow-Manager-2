/**
 * modules/shared/academy-constants.js - Academy Constants
 * Academy-wide constants.
 * 
 * Path: js/modules/shared/academy-constants.js
 * 
 * This module provides:
 *   - Score bounds for Academy assessments (MIN_SCORE, MAX_SCORE)
 *   - Class lifecycle statuses and their default
 *   - Minimum ranking position
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for genuinely Academy-wide constants.
 *   - Do NOT add domain-specific constants here. They belong in their
 *     respective domain modules:
 *         Grade type definitions           → AcademyGrades / assessments
 *         Grade scheme bands, passing,
 *           letter-grade semantics          → AcademyGradeSchemes
 *         Student/instructor statuses       → CharacterConstants
 *         Team types, team sizes            → TeamConstants
 *         Academy group distribution sizes  → AcademyDistribute
 *         View labels, icons, descriptions  → AcademyView
 *         Ranking presentation bins         → AcademyRanking / view
 *   - Constants are DEEP FROZEN.
 *   - Validation runs before publishing; errors are logged, not thrown.
 *   - No DOM, no state, no persistence - pure constants only.
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var AC = window.AcademyConstants;
 *   AC.MIN_SCORE;
 *   AC.MAX_SCORE;
 *   AC.CLASS_STATUSES;
 *   AC.DEFAULT_CLASS_STATUS;
 *   AC.MIN_RANK;
 *   AC.getClassStatuses();
 *   AC.getClassStatusLabel('active');
 *   AC.isValidClassStatus('active');
 */

(function() {
    'use strict';

    if (window.__academyConstantsLoaded) {
        return;
    }
    window.__academyConstantsLoaded = true;

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var value = obj[keys[i]];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // SCORE BOUNDS
    // ============================================================

    /**
     * Structural bounds on an Academy assessment score.
     * These define the valid RANGE of a score, not its meaning.
     * 
     * Score meaning (what 70 means, what counts as passing, what
     * letter grade a score maps to) belongs to AcademyGradeSchemes.
     */
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

    // ============================================================
    // CLASS STATUSES
    // ============================================================

    /**
     * Lifecycle statuses for a graduating class.
     * 
     * - active:    the class is currently running
     * - archived:  the class is historical, not currently running
     * - graduated: the class has graduated
     */
    var CLASS_STATUSES = [
        { id: 'active',    label: 'Active',    description: 'Currently active class' },
        { id: 'archived',  label: 'Archived',  description: 'Archived class (historical)' },
        { id: 'graduated', label: 'Graduated', description: 'Graduated class' }
    ];

    var CLASS_STATUS_IDS = CLASS_STATUSES.map(function(s) {
        return s.id;
    });

    var CLASS_STATUS_LABELS = {};
    CLASS_STATUSES.forEach(function(s) {
        CLASS_STATUS_LABELS[s.id] = s.label;
    });

    var DEFAULT_CLASS_STATUS = 'active';

    // ============================================================
    // RANKING BOUNDS
    // ============================================================

    /**
     * Lowest valid rank position.
     * Rank 1 is the top of the class.
     */
    var MIN_RANK = 1;

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    function getClassStatuses() {
        return CLASS_STATUSES.slice();
    }

    function getClassStatusLabel(id) {
        return CLASS_STATUS_LABELS[id] || id;
    }

    function isValidClassStatus(id) {
        return CLASS_STATUS_IDS.indexOf(id) !== -1;
    }

    function getDefaultClassStatus() {
        return DEFAULT_CLASS_STATUS;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // ---- Score bounds ----
        if (typeof MIN_SCORE !== 'number' || MIN_SCORE < 0) {
            errors.push('MIN_SCORE must be a non-negative number.');
        }
        if (typeof MAX_SCORE !== 'number' || MAX_SCORE <= MIN_SCORE) {
            errors.push('MAX_SCORE must be greater than MIN_SCORE.');
        }

        // ---- Class statuses ----
        if (!Array.isArray(CLASS_STATUSES) || CLASS_STATUSES.length === 0) {
            errors.push('CLASS_STATUSES must be a non-empty array.');
        }

        var statusIds = Object.create(null);
        CLASS_STATUSES.forEach(function(status, index) {
            if (!status.id || typeof status.id !== 'string') {
                errors.push('Status at index ' + index + ' missing id.');
                return;
            }
            if (statusIds[status.id]) {
                errors.push('Duplicate status id "' + status.id + '".');
            }
            statusIds[status.id] = true;

            if (!status.label || typeof status.label !== 'string') {
                errors.push('Status "' + status.id + '" missing label.');
            }
        });

        if (typeof DEFAULT_CLASS_STATUS !== 'string' ||
            CLASS_STATUS_IDS.indexOf(DEFAULT_CLASS_STATUS) === -1) {
            errors.push('DEFAULT_CLASS_STATUS must reference a valid class status. Got: "' +
                DEFAULT_CLASS_STATUS + '".');
        }

        // ---- Rank ----
        if (typeof MIN_RANK !== 'number' || MIN_RANK < 1 || !Number.isInteger(MIN_RANK)) {
            errors.push('MIN_RANK must be a positive integer.');
        }

        if (errors.length > 0) {
            console.warn('[AcademyConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(CLASS_STATUSES);
    deepFreeze(CLASS_STATUS_IDS);
    deepFreeze(CLASS_STATUS_LABELS);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyConstants = Object.freeze({
        // Score bounds
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,

        // Class statuses
        CLASS_STATUSES: CLASS_STATUSES,
        CLASS_STATUS_IDS: CLASS_STATUS_IDS,
        CLASS_STATUS_LABELS: CLASS_STATUS_LABELS,
        DEFAULT_CLASS_STATUS: DEFAULT_CLASS_STATUS,

        getClassStatuses: getClassStatuses,
        getClassStatusLabel: getClassStatusLabel,
        isValidClassStatus: isValidClassStatus,
        getDefaultClassStatus: getDefaultClassStatus,

        // Rank
        MIN_RANK: MIN_RANK,

        // Validation
        validateConstants: validateConstants
    });

})();
