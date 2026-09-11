/**
 * shared/constants/character-constants.js - Character Constants
 * Single source of truth for all character-related constants
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 */

(function() {
    'use strict';

    if (window.__characterConstantsLoaded) { return; }
    window.__characterConstantsLoaded = true;

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) { return obj; }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') { deepFreeze(value); }
        }
        return Object.freeze(obj);
    }

    // ============================================================
    // PHYSICAL STATS
    // ============================================================

    var STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_MIN = 1;
    var STAT_MAX = 30;
    var STAT_DEFAULT = 10;

    // Random generation range for physical stats
    var STAT_RANDOM_MIN = 6;
    var STAT_RANDOM_MAX = 18;

    var STAT_DEFINITIONS = {
        str: { label: 'Strength',     abbreviation: 'STR', description: 'Physical power and athletic ability' },
        dex: { label: 'Dexterity',    abbreviation: 'DEX', description: 'Agility, reflexes, and coordination' },
        con: { label: 'Constitution', abbreviation: 'CON', description: 'Endurance, health, and vitality' },
        int: { label: 'Intelligence', abbreviation: 'INT', description: 'Reasoning, memory, and logical thinking' },
        wis: { label: 'Wisdom',       abbreviation: 'WIS', description: 'Perception, intuition, and insight' },
        cha: { label: 'Charisma',     abbreviation: 'CHA', description: 'Force of personality and social influence' }
    };

    // ============================================================
    // PHYSICAL CLASSES
    // ============================================================
    // Classes are DERIVED from physical stats via weighted scoring.
    // Weights sum to ~1.0 per class. Higher weight = stat matters more.
    // hpBonus is added on top of the random HP roll.

    var PHYSICAL_CLASSES = [
        {
            id: 'barbarian', label: 'Barbarian', icon: '⚔',
            description: 'Raw physical power, toughness, aggression',
            weights: { str: 0.40, con: 0.30, dex: 0.20, wis: 0.10, int: 0.00, cha: 0.00 },
            hpBonus: 8
        },
        {
            id: 'fighter', label: 'Fighter', icon: '⚔',
            description: 'Versatile trained combatant',
            weights: { str: 0.30, dex: 0.30, con: 0.20, int: 0.10, wis: 0.10, cha: 0.00 },
            hpBonus: 5
        },
        {
            id: 'guardian', label: 'Guardian', icon: '🛡',
            description: 'Defensive fighter, protects others, holds ground',
            weights: { con: 0.35, str: 0.25, wis: 0.25, dex: 0.05, int: 0.05, cha: 0.05 },
            hpBonus: 10
        },
        {
            id: 'rogue', label: 'Rogue', icon: '🗡',
            description: 'Agility, precision, opportunism, clever tactics',
            weights: { dex: 0.35, int: 0.30, cha: 0.20, str: 0.05, con: 0.05, wis: 0.05 },
            hpBonus: 2
        },
        {
            id: 'ranger', label: 'Ranger', icon: '🏹',
            description: 'Mobility, awareness, ranged combat, survival',
            weights: { wis: 0.35, dex: 0.30, con: 0.20, str: 0.10, int: 0.05, cha: 0.00 },
            hpBonus: 4
        },
        {
            id: 'martialist', label: 'Martialist', icon: '✋',
            description: 'Discipline, speed, control and unarmed combat',
            weights: { dex: 0.35, con: 0.30, wis: 0.25, str: 0.10, int: 0.00, cha: 0.00 },
            hpBonus: 5
        },
        {
            id: 'brawler', label: 'Brawler', icon: '👊',
            description: 'Close-range fighter relying on physical skill',
            weights: { str: 0.35, dex: 0.30, con: 0.25, wis: 0.10, int: 0.00, cha: 0.00 },
            hpBonus: 6
        },
        {
            id: 'duelist', label: 'Duelist', icon: '🗡',
            description: 'Precision fighter, confidence, reading opponents',
            weights: { dex: 0.35, cha: 0.30, int: 0.20, str: 0.10, wis: 0.05, con: 0.00 },
            hpBonus: 2
        },
        {
            id: 'scout', label: 'Scout', icon: '👁',
            description: 'Reconnaissance, stealth and situational awareness',
            weights: { wis: 0.30, dex: 0.30, int: 0.25, con: 0.15, str: 0.00, cha: 0.00 },
            hpBonus: 3
        },
        {
            id: 'tactician', label: 'Tactician', icon: '♟',
            description: 'Strategic combatant, planning and battlefield control',
            weights: { int: 0.40, wis: 0.30, cha: 0.20, con: 0.10, str: 0.00, dex: 0.00 },
            hpBonus: 2
        },
        {
            id: 'leader', label: 'Leader', icon: '★',
            description: 'Inspires, commands and coordinates others',
            weights: { cha: 0.40, wis: 0.25, int: 0.20, con: 0.15, str: 0.00, dex: 0.00 },
            hpBonus: 3
        },
        {
            id: 'scholar', label: 'Scholar', icon: '📖',
            description: 'Knowledge-focused, analytical and academically capable',
            weights: { int: 0.45, wis: 0.35, cha: 0.20, con: 0.00, str: 0.00, dex: 0.00 },
            hpBonus: 1
        }
    ];

    // ============================================================
    // WEAPON TYPES
    // ============================================================

    var WEAPON_TYPES = [
        { id: 'blunt',          label: 'Blunt' },
        { id: 'sharp',          label: 'Sharp' },
        { id: 'polearm',        label: 'Polearm' },
        { id: 'ranged',         label: 'Ranged' },
        { id: 'thrown',         label: 'Thrown' },
        { id: 'firearm',        label: 'Firearm' },
        { id: 'automagic_wand', label: 'Automagic Wand' },
        { id: 'shield',         label: 'Shield' },
        { id: 'unarmed',        label: 'Unarmed' }
    ];

    var DEFAULT_WEAPON_TYPE = 'sharp';

    // ============================================================
    // HP / MP
    // ============================================================

    var HP_MIN = 0;
    var HP_MAX = 100;   // Base cap; class + CON modifiers can push higher
    var HP_BASE_MIN = 20;
    var HP_BASE_MAX = 40;

    var MP_MIN = 0;
    var MP_MAX = 200;
    var MP_BASE_DIVISOR = 5;         // totalMagic / 5 as base
    var MP_AETHER_MULTIPLIER = 2;    // aether total × this
    var MP_BODY_MULTIPLIER = 0.5;    // body total × this
    var MP_RANDOM_MAX = 10;

    // ============================================================
    // SPECIAL MOVES
    // ============================================================

    var MAX_SPECIAL_MOVES = 20;
    var MAX_MOVE_NAME_LENGTH = 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    // ============================================================
    // WEAPONS
    // ============================================================

    var MAX_WEAPONS = 50;
    var MAX_WEAPON_NAME_LENGTH = 100;
    var MAX_WEAPON_NOTES_LENGTH = 300;

    // ============================================================
    // CAREER STATUS
    // ============================================================

    var CAREER_STATUS_OPTIONS = [
        { value: '', label: 'Select status...' },
        { value: 'civilian',   label: 'Civilian' },
        { value: 'trainee',    label: 'Trainee' },
        { value: 'rookie',     label: 'Rookie' },
        { value: 'junior',     label: 'Junior' },
        { value: 'senior',     label: 'Senior' },
        { value: 'instructor', label: 'Instructor' },
        { value: 'support',    label: 'Support' }
    ];

    var STUDENT_STATUSES = ['trainee', 'rookie', 'junior'];
    var INSTRUCTOR_STATUSES = ['instructor', 'teacher', 'professor', 'senior'];

    // ============================================================
    // NAME FORMATS
    // ============================================================

    var NAME_FORMATS = ['firstlast', 'lastfirst', 'nicklast', 'firstnick', 'alias'];
    var DEFAULT_NAME_FORMAT = 'firstlast';
    var MAX_PREVIOUS_NAMES = 10;
    var MAX_CAREER_STATUS = 20;

    // ============================================================
    // SOCIAL FIELDS
    // ============================================================

    var ATTRACTION_VALUES = ['', 'Women', 'Men', 'All', 'None', 'Other'];
    var SEXUALITY_VALUES = ['', 'Heterosexual', 'Homosexual', 'Bisexual', 'Pansexual', 'Asexual', 'Questioning', 'Other'];

    // ============================================================
    // LOOKUP FUNCTIONS - Physical classes
    // ============================================================

    function getStatKeys() { return STAT_KEYS.slice(); }
    function getStatDefinitions() { return Object.assign({}, STAT_DEFINITIONS); }
    function getStatDefinition(key) { return STAT_DEFINITIONS[key] || null; }

    function getPhysicalClasses() { return PHYSICAL_CLASSES.slice(); }

    function getPhysicalClass(classId) {
        if (!classId || typeof classId !== 'string') { return null; }
        for (var i = 0; i < PHYSICAL_CLASSES.length; i++) {
            if (PHYSICAL_CLASSES[i].id === classId) {
                return PHYSICAL_CLASSES[i];
            }
        }
        return null;
    }

    function isValidPhysicalClass(classId) {
        return getPhysicalClass(classId) !== null;
    }

    // ============================================================
    // LOOKUP FUNCTIONS - Weapons
    // ============================================================

    function getWeaponTypes() { return WEAPON_TYPES.slice(); }

    function getWeaponType(typeId) {
        if (!typeId || typeof typeId !== 'string') { return null; }
        for (var i = 0; i < WEAPON_TYPES.length; i++) {
            if (WEAPON_TYPES[i].id === typeId) {
                return WEAPON_TYPES[i];
            }
        }
        return null;
    }

    function isValidWeaponType(typeId) {
        return getWeaponType(typeId) !== null;
    }

    function getWeaponTypeLabel(typeId) {
        var type = getWeaponType(typeId);
        return type ? type.label : 'Unknown';
    }

    function getDefaultWeaponType() {
        return DEFAULT_WEAPON_TYPE;
    }

    // ============================================================
    // LOOKUP FUNCTIONS - Career
    // ============================================================

    function getCareerStatusOptions() { return CAREER_STATUS_OPTIONS.slice(); }

    function getCareerStatusLabels() {
        var labels = {};
        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            if (opt.value) { labels[opt.value] = opt.label; }
        });
        return labels;
    }

    function isStudentStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        return STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function isInstructorStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        return INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function getAttractionValues() { return ATTRACTION_VALUES.slice(); }
    function getSexualityValues() { return SEXUALITY_VALUES.slice(); }

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
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (!Array.isArray(PHYSICAL_CLASSES) || PHYSICAL_CLASSES.length === 0) {
            errors.push('PHYSICAL_CLASSES must be a non-empty array.');
        }

        var classIds = Object.create(null);
        PHYSICAL_CLASSES.forEach(function(cls, index) {
            if (!cls.id || typeof cls.id !== 'string') {
                errors.push('Physical class at index ' + index + ' missing id.');
                return;
            }
            if (classIds[cls.id]) {
                errors.push('Duplicate physical class id "' + cls.id + '".');
            }
            classIds[cls.id] = true;

            if (!cls.label || typeof cls.label !== 'string') {
                errors.push('Physical class "' + cls.id + '" missing label.');
            }
            if (!cls.weights || typeof cls.weights !== 'object') {
                errors.push('Physical class "' + cls.id + '" missing weights.');
                return;
            }

            var weightSum = 0;
            STAT_KEYS.forEach(function(key) {
                var w = cls.weights[key];
                if (typeof w !== 'number' || w < 0 || w > 1) {
                    errors.push('Physical class "' + cls.id + '" weight for "' + key + '" must be between 0 and 1.');
                } else {
                    weightSum += w;
                }
            });
            if (Math.abs(weightSum - 1.0) > 0.01) {
                errors.push('Physical class "' + cls.id + '" weights must sum to ~1.0 (got ' + weightSum.toFixed(2) + ').');
            }

            if (typeof cls.hpBonus !== 'number' || cls.hpBonus < 0) {
                errors.push('Physical class "' + cls.id + '" invalid hpBonus.');
            }
        });

        if (!Array.isArray(WEAPON_TYPES) || WEAPON_TYPES.length === 0) {
            errors.push('WEAPON_TYPES must be a non-empty array.');
        }

        var typeIds = Object.create(null);
        WEAPON_TYPES.forEach(function(t, index) {
            if (!t.id || typeof t.id !== 'string') {
                errors.push('Weapon type at index ' + index + ' missing id.');
                return;
            }
            if (typeIds[t.id]) {
                errors.push('Duplicate weapon type id "' + t.id + '".');
            }
            typeIds[t.id] = true;
            if (!t.label || typeof t.label !== 'string') {
                errors.push('Weapon type "' + t.id + '" missing label.');
            }
        });

        if (STAT_MIN >= STAT_MAX) {
            errors.push('STAT_MIN must be less than STAT_MAX.');
        }
        if (STAT_DEFAULT < STAT_MIN || STAT_DEFAULT > STAT_MAX) {
            errors.push('STAT_DEFAULT must be between STAT_MIN and STAT_MAX.');
        }
        if (STAT_RANDOM_MIN < STAT_MIN || STAT_RANDOM_MAX > STAT_MAX) {
            errors.push('STAT_RANDOM bounds must be within STAT_MIN and STAT_MAX.');
        }

        if (HP_MIN < 0 || HP_MAX <= HP_MIN) {
            errors.push('HP bounds invalid.');
        }
        if (MP_MIN < 0 || MP_MAX <= MP_MIN) {
            errors.push('MP bounds invalid.');
        }

        if (errors.length > 0) {
            console.warn('[CharacterConstants] Validation errors:', errors);
        }
        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // FREEZE
    // ============================================================

    deepFreeze(STAT_KEYS);
    deepFreeze(STAT_DEFINITIONS);
    deepFreeze(PHYSICAL_CLASSES);
    deepFreeze(WEAPON_TYPES);
    deepFreeze(CAREER_STATUS_OPTIONS);
    deepFreeze(STUDENT_STATUSES);
    deepFreeze(INSTRUCTOR_STATUSES);
    deepFreeze(NAME_FORMATS);
    deepFreeze(ATTRACTION_VALUES);
    deepFreeze(SEXUALITY_VALUES);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterConstants = Object.freeze({
        // Stats
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_RANDOM_MIN: STAT_RANDOM_MIN,
        STAT_RANDOM_MAX: STAT_RANDOM_MAX,
        STAT_DEFINITIONS: STAT_DEFINITIONS,

        // Physical classes
        PHYSICAL_CLASSES: PHYSICAL_CLASSES,

        // Weapons
        WEAPON_TYPES: WEAPON_TYPES,
        DEFAULT_WEAPON_TYPE: DEFAULT_WEAPON_TYPE,
        MAX_WEAPONS: MAX_WEAPONS,
        MAX_WEAPON_NAME_LENGTH: MAX_WEAPON_NAME_LENGTH,
        MAX_WEAPON_NOTES_LENGTH: MAX_WEAPON_NOTES_LENGTH,

        // HP / MP
        HP_MIN: HP_MIN,
        HP_MAX: HP_MAX,
        HP_BASE_MIN: HP_BASE_MIN,
        HP_BASE_MAX: HP_BASE_MAX,
        MP_MIN: MP_MIN,
        MP_MAX: MP_MAX,
        MP_BASE_DIVISOR: MP_BASE_DIVISOR,
        MP_AETHER_MULTIPLIER: MP_AETHER_MULTIPLIER,
        MP_BODY_MULTIPLIER: MP_BODY_MULTIPLIER,
        MP_RANDOM_MAX: MP_RANDOM_MAX,

        // Special moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Career
        CAREER_STATUS_OPTIONS: CAREER_STATUS_OPTIONS,
        STUDENT_STATUSES: STUDENT_STATUSES,
        INSTRUCTOR_STATUSES: INSTRUCTOR_STATUSES,

        // Names
        NAME_FORMATS: NAME_FORMATS,
        DEFAULT_NAME_FORMAT: DEFAULT_NAME_FORMAT,
        MAX_PREVIOUS_NAMES: MAX_PREVIOUS_NAMES,
        MAX_CAREER_STATUS: MAX_CAREER_STATUS,

        // Social
        ATTRACTION_VALUES: ATTRACTION_VALUES,
        SEXUALITY_VALUES: SEXUALITY_VALUES,

        // Lookup functions
        getStatKeys: getStatKeys,
        getStatDefinitions: getStatDefinitions,
        getStatDefinition: getStatDefinition,

        getPhysicalClasses: getPhysicalClasses,
        getPhysicalClass: getPhysicalClass,
        isValidPhysicalClass: isValidPhysicalClass,

        getWeaponTypes: getWeaponTypes,
        getWeaponType: getWeaponType,
        getWeaponTypeLabel: getWeaponTypeLabel,
        isValidWeaponType: isValidWeaponType,
        getDefaultWeaponType: getDefaultWeaponType,

        getCareerStatusOptions: getCareerStatusOptions,
        getCareerStatusLabels: getCareerStatusLabels,
        isStudentStatus: isStudentStatus,
        isInstructorStatus: isInstructorStatus,

        getAttractionValues: getAttractionValues,
        getSexualityValues: getSexualityValues,
        isValidNameFormat: isValidNameFormat,
        getNameFormatLabels: getNameFormatLabels,

        validateConstants: validateConstants
    });

})();
