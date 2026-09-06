/**
 * modules/shared/character-constants.js - Character Constants
 * Single source of truth for all character-related constants
 * Path: js/modules/shared/character-constants.js
 * 
 * This module provides:
 *   - Stat constants (min, max, default, definitions)
 *   - Special moves constants (max, name/description limits)
 *   - Career status options
 *   - Character field constants (name formats, etc.)
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for character constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - STAT_MIN, STAT_MAX, STAT_DEFAULT are used throughout the application
 *   - Class definitions moved to Academy domain
 *   - Magic definitions moved to Magic domain
 *   - CharacterConstants is MANDATORY for character operations
 *   - Validation runs BEFORE publishing to ensure integrity
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var CC = window.CharacterConstants;
 *   var stats = CC.STAT_KEYS;
 *   var maxMoves = CC.MAX_SPECIAL_MOVES;
 *   var statuses = CC.CAREER_STATUS_OPTIONS;
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterConstantsLoaded) {
        return;
    }
    window.__characterConstantsLoaded = true;

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // STAT CONSTANTS - Character-specific
    // ============================================================

    var STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_MIN = 1;
    var STAT_MAX = 50;
    var STAT_DEFAULT = 10;

    var STAT_DEFINITIONS = {
        str: { label: 'Strength', abbreviation: 'STR', description: 'Physical power and athletic ability' },
        dex: { label: 'Dexterity', abbreviation: 'DEX', description: 'Agility, reflexes, and coordination' },
        con: { label: 'Constitution', abbreviation: 'CON', description: 'Endurance, health, and vitality' },
        int: { label: 'Intelligence', abbreviation: 'INT', description: 'Reasoning, memory, and logical thinking' },
        wis: { label: 'Wisdom', abbreviation: 'WIS', description: 'Perception, intuition, and insight' },
        cha: { label: 'Charisma', abbreviation: 'CHA', description: 'Force of personality and social influence' }
    };

    // ============================================================
    // SPECIAL MOVES CONSTANTS - Character-specific
    // ============================================================

    var MAX_SPECIAL_MOVES = 20;
    var MAX_MOVE_NAME_LENGTH = 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    // ============================================================
    // CAREER STATUS OPTIONS - Character-specific
    // ============================================================

    var CAREER_STATUS_OPTIONS = [
        { value: '', label: 'Select status...' },
        { value: 'civilian', label: 'Civilian' },
        { value: 'trainee', label: 'Trainee' },
        { value: 'rookie', label: 'Rookie' },
        { value: 'junior', label: 'Junior' },
        { value: 'senior', label: 'Senior' },
        { value: 'instructor', label: 'Instructor' },
        { value: 'support', label: 'Support' }
    ];

    // Career status groups (derived from options)
    var STUDENT_STATUSES = ['trainee', 'rookie', 'junior'];
    var INSTRUCTOR_STATUSES = ['instructor', 'teacher', 'professor', 'senior'];

    // ============================================================
    // CHARACTER FIELD CONSTANTS - Character-specific
    // ============================================================

    var NAME_FORMATS = ['firstlast', 'lastfirst', 'nicklast', 'firstnick', 'alias'];
    var DEFAULT_NAME_FORMAT = 'firstlast';
    var MAX_PREVIOUS_NAMES = 10;
    var MAX_CAREER_STATUS = 20;

    var ATTRACTION_VALUES = ['', 'Women', 'Men', 'All', 'None', 'Other'];
    var SEXUALITY_VALUES = ['', 'Heterosexual', 'Homosexual', 'Bisexual', 'Pansexual', 'Asexual', 'Questioning', 'Other'];

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // ---- STAT KEYS VALIDATION ----
        if (!Array.isArray(STAT_KEYS) || STAT_KEYS.length === 0) {
            errors.push('STAT_KEYS must be a non-empty array.');
        }

        // ---- STAT DEFINITIONS ----
        STAT_KEYS.forEach(function(key) {
            if (!STAT_DEFINITIONS[key]) {
                errors.push('STAT_DEFINITIONS missing key "' + key + '".');
            } else {
                var def = STAT_DEFINITIONS[key];
                if (!def.label) {
                    errors.push('STAT_DEFINITIONS for "' + key + '" missing label.');
                }
                if (!def.abbreviation) {
                    errors.push('STAT_DEFINITIONS for "' + key + '" missing abbreviation.');
                }
            }
        });

        // ---- STAT BOUNDS ----
        if (typeof STAT_MIN !== 'number' || STAT_MIN < 0) {
            errors.push('STAT_MIN must be a non-negative number.');
        }
        if (typeof STAT_MAX !== 'number' || STAT_MAX <= STAT_MIN) {
            errors.push('STAT_MAX must be greater than STAT_MIN.');
        }
        if (typeof STAT_DEFAULT !== 'number' || STAT_DEFAULT < STAT_MIN || STAT_DEFAULT > STAT_MAX) {
            errors.push('STAT_DEFAULT must be between STAT_MIN and STAT_MAX.');
        }

        // ---- SPECIAL MOVES CONSTANTS ----
        if (typeof MAX_SPECIAL_MOVES !== 'number' || MAX_SPECIAL_MOVES < 1) {
            errors.push('MAX_SPECIAL_MOVES must be a positive number.');
        }
        if (typeof MAX_MOVE_NAME_LENGTH !== 'number' || MAX_MOVE_NAME_LENGTH < 1) {
            errors.push('MAX_MOVE_NAME_LENGTH must be a positive number.');
        }
        if (typeof MAX_MOVE_DESCRIPTION_LENGTH !== 'number' || MAX_MOVE_DESCRIPTION_LENGTH < 1) {
            errors.push('MAX_MOVE_DESCRIPTION_LENGTH must be a positive number.');
        }

        // ---- CAREER STATUS OPTIONS ----
        if (!Array.isArray(CAREER_STATUS_OPTIONS) || CAREER_STATUS_OPTIONS.length === 0) {
            errors.push('CAREER_STATUS_OPTIONS must be a non-empty array.');
        } else {
            var hasEmpty = false;
            CAREER_STATUS_OPTIONS.forEach(function(opt) {
                if (opt.value === '') {
                    hasEmpty = true;
                }
                if (!opt.label) {
                    errors.push('Career status option "' + opt.value + '" missing label.');
                }
            });
            if (!hasEmpty) {
                errors.push('CAREER_STATUS_OPTIONS must have an empty value option.');
            }
        }

        // ---- NAME FORMATS ----
        if (!Array.isArray(NAME_FORMATS) || NAME_FORMATS.length === 0) {
            errors.push('NAME_FORMATS must be a non-empty array.');
        }
        if (NAME_FORMATS.indexOf(DEFAULT_NAME_FORMAT) === -1) {
            errors.push('DEFAULT_NAME_FORMAT must be in NAME_FORMATS.');
        }

        // ---- ATTRACTION/SEXUALITY ----
        if (!Array.isArray(ATTRACTION_VALUES) || ATTRACTION_VALUES.length === 0) {
            errors.push('ATTRACTION_VALUES must be a non-empty array.');
        }
        if (!Array.isArray(SEXUALITY_VALUES) || SEXUALITY_VALUES.length === 0) {
            errors.push('SEXUALITY_VALUES must be a non-empty array.');
        }

        if (errors.length > 0) {
            throw new Error('CharacterConstants validation failed:\n  ' + errors.join('\n  '));
        }

        return true;
    }

    // ============================================================
    // GETTER HELPERS
    // ============================================================

    function getStatKeys() {
        return STAT_KEYS.slice();
    }

    function getStatDefinitions() {
        return Object.assign({}, STAT_DEFINITIONS);
    }

    function getStatDefinition(key) {
        return STAT_DEFINITIONS[key] || null;
    }

    function getCareerStatusOptions() {
        return CAREER_STATUS_OPTIONS.slice();
    }

    function getCareerStatusLabels() {
        var labels = {};
        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            if (opt.value) {
                labels[opt.value] = opt.label;
            }
        });
        return labels;
    }

    function isStudentStatus(status) {
        if (!status || typeof status !== 'string') return false;
        return STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function isInstructorStatus(status) {
        if (!status || typeof status !== 'string') return false;
        return INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function getAttractionValues() {
        return ATTRACTION_VALUES.slice();
    }

    function getSexualityValues() {
        return SEXUALITY_VALUES.slice();
    }

    function isValidNameFormat(format) {
        return NAME_FORMATS.indexOf(format) !== -1;
    }

    function getNameFormatLabels() {
        return {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast': 'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias': 'Alias'
        };
    }

    // ============================================================
    // VALIDATE BEFORE PUBLISHING
    // ============================================================

    try {
        validateConstants();
        console.log('[CharacterConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[CharacterConstants] Validation failed:', e.message);
        throw e;
    }

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(STAT_KEYS);
    deepFreeze(STAT_DEFINITIONS);
    deepFreeze(CAREER_STATUS_OPTIONS);
    deepFreeze(STUDENT_STATUSES);
    deepFreeze(INSTRUCTOR_STATUSES);
    deepFreeze(NAME_FORMATS);
    deepFreeze(ATTRACTION_VALUES);
    deepFreeze(SEXUALITY_VALUES);

    // ============================================================
    // EXPOSE - ONLY CHARACTER-SPECIFIC CONSTANTS
    // ============================================================

    window.CharacterConstants = Object.freeze({
        // Stats
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_DEFINITIONS: STAT_DEFINITIONS,

        // Stat getters
        getStatKeys: getStatKeys,
        getStatDefinitions: getStatDefinitions,
        getStatDefinition: getStatDefinition,

        // Special moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Career status
        CAREER_STATUS_OPTIONS: CAREER_STATUS_OPTIONS,
        STUDENT_STATUSES: STUDENT_STATUSES,
        INSTRUCTOR_STATUSES: INSTRUCTOR_STATUSES,

        getCareerStatusOptions: getCareerStatusOptions,
        getCareerStatusLabels: getCareerStatusLabels,
        isStudentStatus: isStudentStatus,
        isInstructorStatus: isInstructorStatus,

        // Character fields
        NAME_FORMATS: NAME_FORMATS,
        DEFAULT_NAME_FORMAT: DEFAULT_NAME_FORMAT,
        MAX_PREVIOUS_NAMES: MAX_PREVIOUS_NAMES,
        MAX_CAREER_STATUS: MAX_CAREER_STATUS,

        ATTRACTION_VALUES: ATTRACTION_VALUES,
        SEXUALITY_VALUES: SEXUALITY_VALUES,

        getAttractionValues: getAttractionValues,
        getSexualityValues: getSexualityValues,
        isValidNameFormat: isValidNameFormat,
        getNameFormatLabels: getNameFormatLabels,

        // Validation (public for testing)
        validateConstants: validateConstants
    });

    // ============================================================
    // LEGACY COMPATIBILITY (DEPRECATED - Will be removed)
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from old constants structure.
    // They will be removed in a future version.

    window.STAT_KEYS = STAT_KEYS;
    window.STAT_MIN = STAT_MIN;
    window.STAT_MAX = STAT_MAX;
    window.STAT_DEFAULT = STAT_DEFAULT;
    window.MAX_SPECIAL_MOVES = MAX_SPECIAL_MOVES;
    window.MAX_MOVE_NAME_LENGTH = MAX_MOVE_NAME_LENGTH;
    window.MAX_MOVE_DESCRIPTION_LENGTH = MAX_MOVE_DESCRIPTION_LENGTH;
    window.CAREER_STATUS_OPTIONS = CAREER_STATUS_OPTIONS;

})();