/**
 * modules/shared/character-constants.js - Character Constants
 * Single source of truth for all character-related constants
 * Path: js/modules/shared/character-constants.js
 * 
 * This module provides:
 *   - Character class definitions with stat requirements
 *   - Magic type definitions and categories
 *   - Stat constants (min, max, default)
 *   - Magic constants (max, types, categories)
 *   - Special moves constants (max, name/description limits)
 *   - Career status options
 *   - Validation functions for all constants
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for all character constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - statWeights for each class MUST sum to exactly 1.0
 *   - Classes are validated on load; invalid classes will block loading
 *   - Magic types are organised into categories (elemental, body, aether)
 *   - All constants are DEEP FROZEN to prevent mutation
 *   - STAT_MIN, STAT_MAX, STAT_DEFAULT are used throughout the application
 *   - CharacterConstants is MANDATORY for character operations
 *   - Validation runs BEFORE publishing to ensure integrity
 * 
 * USAGE:
 *   var CC = window.CharacterConstants;
 *   var stats = CC.STAT_KEYS;
 *   var magic = CC.MAGIC_TYPES;
 *   var classes = CC.CLASS_DEFINITIONS;
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 */

(function() {
    'use strict';

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    /**
     * Deep freeze an object to prevent mutation.
     * Recursively freezes all nested objects and arrays.
     * 
     * @param {*} obj - Object to freeze
     * @returns {*} Frozen object
     */
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
    // STAT CONSTANTS
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
    // MAGIC CONSTANTS - SINGLE SOURCE OF TRUTH
    // ============================================================

    var MAGIC_MAX = 10;
    var BALANCED_MAGE_THRESHOLD = 3;

    // Magic type definitions - SINGLE SOURCE OF TRUTH
    // Each type's category determines which MAGIC_CATEGORY it belongs to
    var MAGIC_TYPES = {
        // Elemental Magic
        earth: { label: 'Earth', category: 'elemental', description: 'Control over stone, soil, and metal' },
        water: { label: 'Water', category: 'elemental', description: 'Control over water, ice, and fluids' },
        fire: { label: 'Fire', category: 'elemental', description: 'Control over fire, heat, and combustion' },
        air: { label: 'Air', category: 'elemental', description: 'Control over air, wind, and weather' },
        metal: { label: 'Metal', category: 'elemental', description: 'Control over refined metals and alloys' },
        wood: { label: 'Wood', category: 'elemental', description: 'Control over wood, plants, and growth' },

        // Body Magic
        blood: { label: 'Blood', category: 'body', description: 'Control over blood, circulation, and vitality' },
        bone: { label: 'Bone', category: 'body', description: 'Control over bone, structure, and skeleton' },
        mind: { label: 'Mind', category: 'body', description: 'Control over thoughts, memory, and consciousness' },
        morphic: { label: 'Morphic', category: 'body', description: 'Control over shape, form, and transformation' },
        life: { label: 'Life', category: 'body', description: 'Control over growth, healing, and vitality' },
        death: { label: 'Death', category: 'body', description: 'Control over decay, entropy, and mortality' },

        // Aether Magic
        space: { label: 'Space', category: 'aether', description: 'Control over distance, position, and dimensions' },
        time: { label: 'Time', category: 'aether', description: 'Control over temporal flow and causality' },
        dimension: { label: 'Dimension', category: 'aether', description: 'Control over alternate realities and planes' },
        void: { label: 'Void', category: 'aether', description: 'Control over nothingness and absence' },
        reality: { label: 'Reality', category: 'aether', description: 'Control over fundamental existence' },
        transference: { label: 'Transference', category: 'aether', description: 'Control over energy, matter, and essence transfer' }
    };

    // Magic categories - derived from MAGIC_TYPES
    // Category metadata is defined separately; types array is generated
    var MAGIC_CATEGORIES = {
        elemental: {
            label: 'Elemental',
            description: 'Magic derived from the natural elements',
            icon: '🔥',
            color: 'var(--accent)',
            types: [] // Will be built from MAGIC_TYPES
        },
        body: {
            label: 'Body',
            description: 'Magic derived from living organisms and physiology',
            icon: '🧬',
            color: 'var(--danger)',
            types: [] // Will be built from MAGIC_TYPES
        },
        aether: {
            label: 'Aether',
            description: 'Magic derived from the fabric of reality itself',
            icon: '✦',
            color: 'var(--info)',
            types: [] // Will be built from MAGIC_TYPES
        }
    };

    // Build category types from MAGIC_TYPES
    function buildMagicCategories() {
        var categories = {
            elemental: { types: [] },
            body: { types: [] },
            aether: { types: [] }
        };

        Object.keys(MAGIC_TYPES).forEach(function(key) {
            var category = MAGIC_TYPES[key].category;
            if (categories[category]) {
                categories[category].types.push(key);
            }
        });

        // Assign to MAGIC_CATEGORIES
        Object.keys(categories).forEach(function(cat) {
            if (MAGIC_CATEGORIES[cat]) {
                MAGIC_CATEGORIES[cat].types = categories[cat].types;
            }
        });
    }

    // Build the categories
    buildMagicCategories();

    // Derived magic type keys
    var MAGIC_TYPE_KEYS = Object.keys(MAGIC_TYPES);

    // ============================================================
    // MAGIC POWER CONFIGURATION
    // ============================================================

    var MAGIC_CATEGORY_MULTIPLIERS = {
        'elemental': 1.0,
        'body': 1.2,
        'aether': 1.5
    };

    var MAGIC_CLASS_MAP = {
        elemental: {
            earth: 'Geomancer',
            water: 'Hydromancer',
            fire: 'Pyromancer',
            air: 'Aeromancer',
            metal: 'Ferromancer',
            wood: 'Dendromancer'
        },
        body: {
            blood: 'Hemomancer',
            bone: 'Osteomancer',
            mind: 'Psychomancer',
            morphic: 'Morphomancer',
            life: 'Vitalmancer',
            death: 'Necromancer'
        },
        aether: {
            space: 'Spatiomancer',
            time: 'Chronomancer',
            dimension: 'Dimensionist',
            void: 'Voidmancer',
            reality: 'Reality Weaver',
            transference: 'Transference Mage'
        }
    };

    // Magic power thresholds
    var MAGIC_POWER_THRESHOLDS = {
        'ARCHMAGE': 90,
        'MASTER': 70,
        'ADEPT': 50,
        'APPRENTICE': 30,
        'NOVICE': 10
    };

    // ============================================================
    // CLASS DEFINITIONS - statWeights MUST sum to exactly 1.0
    // ============================================================

    var CLASS_DEFINITIONS = [
        {
            id: 'warrior',
            label: 'Warrior',
            icon: '⚔',
            description: 'Masters of direct combat who rely on strength and endurance to overwhelm their foes.',
            priority: 10,
            statWeights: { str: 0.4, dex: 0.2, con: 0.3, int: 0, wis: 0.1, cha: 0 },
            primaryStats: ['str', 'con'],
            secondaryStats: ['dex'],
            minStats: { str: 13, con: 12 }
        },
        {
            id: 'skirmisher',
            label: 'Skirmisher',
            icon: '🏹',
            description: 'Agile combatants who use speed and precision to outmanoeuvre their opponents.',
            priority: 9,
            statWeights: { str: 0.15, dex: 0.35, con: 0.2, int: 0.05, wis: 0.25, cha: 0 },
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            minStats: { dex: 13, wis: 12 }
        },
        {
            id: 'protector',
            label: 'Protector',
            icon: '🛡',
            description: 'Stalwart defenders who shield their allies and stand firm against overwhelming odds.',
            priority: 8,
            statWeights: { str: 0.3, dex: 0.05, con: 0.3, int: 0, wis: 0.2, cha: 0.15 },
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'cha'],
            minStats: { str: 13, con: 12 }
        },
        {
            id: 'sage',
            label: 'Sage',
            icon: '📚',
            description: 'Scholars and academics who seek knowledge and understanding of the arcane.',
            priority: 8,
            statWeights: { str: 0, dex: 0.15, con: 0.2, int: 0.35, wis: 0.25, cha: 0.05 },
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            minStats: { int: 13, wis: 12 }
        },
        {
            id: 'mystic',
            label: 'Mystic',
            icon: '✦',
            description: 'Intuitive magic-users who channel power through force of personality.',
            priority: 8,
            statWeights: { str: 0, dex: 0.05, con: 0.2, int: 0.15, wis: 0.35, cha: 0.25 },
            primaryStats: ['wis', 'cha'],
            secondaryStats: ['con', 'int'],
            minStats: { wis: 13, cha: 12 }
        },
        {
            id: 'stalker',
            label: 'Stalker',
            icon: '🗡',
            description: 'Shadowy operatives who strike from concealment and excel at infiltration.',
            priority: 8,
            statWeights: { str: 0.05, dex: 0.35, con: 0, int: 0.25, wis: 0.15, cha: 0.2 },
            primaryStats: ['dex', 'int'],
            secondaryStats: ['cha', 'wis'],
            minStats: { dex: 13, int: 12 }
        },
        {
            id: 'spellblade',
            label: 'Spellblade',
            icon: '⚡',
            description: 'Battle-mages who seamlessly blend martial prowess with arcane might.',
            priority: 7,
            statWeights: { str: 0.3, dex: 0.2, con: 0.15, int: 0.3, wis: 0.05, cha: 0 },
            primaryStats: ['str', 'int'],
            secondaryStats: ['dex', 'con'],
            minStats: { str: 13, int: 12 }
        },
        {
            id: 'channeler',
            label: 'Channeler',
            icon: '✦',
            description: 'Mystics who channel cosmic energies through force of personality and endurance.',
            priority: 7,
            statWeights: { str: 0, dex: 0.2, con: 0.25, int: 0.15, wis: 0.05, cha: 0.35 },
            primaryStats: ['cha', 'con'],
            secondaryStats: ['dex', 'int'],
            minStats: { cha: 13, con: 12 }
        },
        {
            id: 'warden',
            label: 'Warden',
            icon: '⚔',
            description: 'Guardians of sacred places who combine martial skill with spiritual awareness.',
            priority: 7,
            statWeights: { str: 0.3, dex: 0.2, con: 0.2, int: 0, wis: 0.25, cha: 0.05 },
            primaryStats: ['str', 'wis'],
            secondaryStats: ['con', 'dex'],
            minStats: { str: 13, wis: 12 }
        },
        {
            id: 'adept',
            label: 'Adept',
            icon: '✦',
            description: 'Balanced warrior-mages who blend combat with minor arcane abilities.',
            priority: 6,
            statWeights: { str: 0.15, dex: 0.3, con: 0.2, int: 0.05, wis: 0.3, cha: 0 },
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            minStats: { dex: 13, wis: 13 }
        },
        {
            id: 'artificer',
            label: 'Artificer',
            icon: '⚙',
            description: 'Inventors and craftsmen who create magical items and constructs.',
            priority: 6,
            statWeights: { str: 0, dex: 0.25, con: 0.2, int: 0.35, wis: 0.15, cha: 0.05 },
            primaryStats: ['int', 'dex'],
            secondaryStats: ['con', 'wis'],
            minStats: { int: 13, dex: 12 }
        },
        {
            id: 'occultist',
            label: 'Occultist',
            icon: '✦',
            description: 'Practitioners of forbidden arts who channel dark powers through intellect and charisma.',
            priority: 6,
            statWeights: { str: 0, dex: 0.15, con: 0.2, int: 0.3, wis: 0.05, cha: 0.3 },
            primaryStats: ['int', 'cha'],
            secondaryStats: ['con', 'dex'],
            minStats: { int: 13, cha: 13 }
        },
        {
            id: 'blade_dancer',
            label: 'Blade Dancer',
            icon: '🗡',
            description: 'Graceful warriors who fight with fluid, dance-like movements and deadly precision.',
            priority: 6,
            statWeights: { str: 0.2, dex: 0.35, con: 0.15, int: 0, wis: 0.05, cha: 0.25 },
            primaryStats: ['dex', 'cha'],
            secondaryStats: ['str', 'con'],
            minStats: { dex: 13, cha: 12 }
        },
        {
            id: 'elementalist',
            label: 'Elementalist',
            icon: '✦',
            description: 'Mages who specialise in commanding the forces of nature and the elements.',
            priority: 6,
            statWeights: { str: 0, dex: 0.15, con: 0.2, int: 0.35, wis: 0.25, cha: 0.05 },
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            minStats: { int: 13, wis: 12 }
        },
        {
            id: 'sentinel',
            label: 'Sentinel',
            icon: '🛡',
            description: 'Vigilant protectors who stand guard against supernatural threats.',
            priority: 6,
            statWeights: { str: 0.3, dex: 0.15, con: 0.3, int: 0, wis: 0.2, cha: 0.05 },
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'dex'],
            minStats: { str: 13, con: 12 }
        }
    ];

    // ============================================================
    // CAREER STATUS OPTIONS
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

    // ============================================================
    // SPECIAL MOVES CONSTANTS
    // ============================================================

    var MAX_SPECIAL_MOVES = 20;
    var MAX_MOVE_NAME_LENGTH = 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    // ============================================================
    // GETTER HELPERS
    // ============================================================

    function getMagicTypeKeys() {
        return MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.types.slice() : [];
    }

    function getMagicTypeLabel(key) {
        var type = MAGIC_TYPES[key];
        return type ? type.label : key;
    }

    function getMagicCategoryLabel(category) {
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.label : category;
    }

    function getMagicCategoryMultiplier(category) {
        return MAGIC_CATEGORY_MULTIPLIERS[category] || 1.0;
    }

    function getMagicClassForType(category, type) {
        if (MAGIC_CLASS_MAP[category] && MAGIC_CLASS_MAP[category][type]) {
            return MAGIC_CLASS_MAP[category][type];
        }
        return null;
    }

    function getMagicPowerThreshold(rank) {
        return MAGIC_POWER_THRESHOLDS[rank] || 0;
    }

    function getClassDefinition(id) {
        for (var i = 0; i < CLASS_DEFINITIONS.length; i++) {
            if (CLASS_DEFINITIONS[i].id === id) {
                return CLASS_DEFINITIONS[i];
            }
        }
        return null;
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

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // ---- STAT KEYS VALIDATION ----
        if (!Array.isArray(STAT_KEYS) || STAT_KEYS.length === 0) {
            errors.push('STAT_KEYS must be a non-empty array.');
        }

        // ---- CLASS VALIDATION ----
        CLASS_DEFINITIONS.forEach(function(cls, index) {
            var prefix = 'Class "' + cls.id + '" at index ' + index + ':';

            // Check required fields
            if (!cls.id) {
                errors.push(prefix + ' Missing id.');
            }
            if (!cls.label) {
                errors.push(prefix + ' Missing label.');
            }
            if (typeof cls.priority !== 'number') {
                errors.push(prefix + ' Missing or invalid priority.');
            }

            // Validate statWeights
            if (!cls.statWeights || typeof cls.statWeights !== 'object') {
                errors.push(prefix + ' Missing statWeights.');
                return;
            }

            // Check all stat keys are valid
            var weightKeys = Object.keys(cls.statWeights);
            for (var i = 0; i < weightKeys.length; i++) {
                if (STAT_KEYS.indexOf(weightKeys[i]) === -1) {
                    errors.push(prefix + ' Invalid stat key "' + weightKeys[i] + '" in statWeights.');
                }
            }

            // Check all stat keys are present
            for (var i = 0; i < STAT_KEYS.length; i++) {
                if (cls.statWeights[STAT_KEYS[i]] === undefined) {
                    errors.push(prefix + ' Missing stat "' + STAT_KEYS[i] + '" in statWeights.');
                }
            }

            // Check sum to 1.0 with tolerance
            var sum = 0;
            for (var key in cls.statWeights) {
                if (Object.prototype.hasOwnProperty.call(cls.statWeights, key)) {
                    sum += cls.statWeights[key];
                }
            }
            if (Math.abs(sum - 1) > 0.001) {
                errors.push(prefix + ' statWeights sum to ' + sum.toFixed(2) + ', expected 1.');
            }

            // Validate primaryStats
            if (!Array.isArray(cls.primaryStats) || cls.primaryStats.length === 0) {
                errors.push(prefix + ' Missing primaryStats.');
            } else {
                for (var i = 0; i < cls.primaryStats.length; i++) {
                    if (STAT_KEYS.indexOf(cls.primaryStats[i]) === -1) {
                        errors.push(prefix + ' Invalid primary stat "' + cls.primaryStats[i] + '".');
                    }
                }
            }

            // Validate secondaryStats
            if (cls.secondaryStats && !Array.isArray(cls.secondaryStats)) {
                errors.push(prefix + ' secondaryStats must be an array.');
            } else if (cls.secondaryStats) {
                for (var i = 0; i < cls.secondaryStats.length; i++) {
                    if (STAT_KEYS.indexOf(cls.secondaryStats[i]) === -1) {
                        errors.push(prefix + ' Invalid secondary stat "' + cls.secondaryStats[i] + '".');
                    }
                }
            }

            // Validate minStats
            if (!cls.minStats || typeof cls.minStats !== 'object') {
                errors.push(prefix + ' Missing minStats.');
            } else {
                for (var stat in cls.minStats) {
                    if (Object.prototype.hasOwnProperty.call(cls.minStats, stat)) {
                        if (STAT_KEYS.indexOf(stat) === -1) {
                            errors.push(prefix + ' Invalid min stat "' + stat + '".');
                        }
                        var val = cls.minStats[stat];
                        if (typeof val !== 'number' || val < STAT_MIN || val > STAT_MAX) {
                            errors.push(prefix + ' minStats "' + stat + '" must be between ' + STAT_MIN + ' and ' + STAT_MAX + '.');
                        }
                    }
                }
            }

            // Primary and secondary stats should not overlap
            if (cls.primaryStats && cls.secondaryStats) {
                for (var i = 0; i < cls.primaryStats.length; i++) {
                    if (cls.secondaryStats.indexOf(cls.primaryStats[i]) !== -1) {
                        errors.push(prefix + ' Primary stat "' + cls.primaryStats[i] + '" overlaps with secondaryStats.');
                    }
                }
            }
        });

        // ---- MAGIC TYPE VALIDATION ----
        if (!MAGIC_TYPES || typeof MAGIC_TYPES !== 'object') {
            errors.push('MAGIC_TYPES is missing or invalid.');
        }

        if (!MAGIC_CATEGORIES || typeof MAGIC_CATEGORIES !== 'object') {
            errors.push('MAGIC_CATEGORIES is missing or invalid.');
        }

        if (!MAGIC_TYPE_KEYS || !Array.isArray(MAGIC_TYPE_KEYS)) {
            errors.push('MAGIC_TYPE_KEYS is missing or invalid.');
        }

        // Validate magic types have valid categories
        var categoryKeys = Object.keys(MAGIC_CATEGORIES);
        var categoryTypeCount = {};

        MAGIC_TYPE_KEYS.forEach(function(key) {
            var type = MAGIC_TYPES[key];
            if (!type) {
                errors.push('Magic type "' + key + '" has no definition.');
                return;
            }

            if (!type.category) {
                errors.push('Magic type "' + key + '" has no category.');
                return;
            }

            if (categoryKeys.indexOf(type.category) === -1) {
                errors.push('Magic type "' + key + '" references unknown category "' + type.category + '".');
                return;
            }

            // Count category types
            if (!categoryTypeCount[type.category]) {
                categoryTypeCount[type.category] = 0;
            }
            categoryTypeCount[type.category]++;
        });

        // Validate each category's types match MAGIC_TYPES
        categoryKeys.forEach(function(cat) {
            var category = MAGIC_CATEGORIES[cat];
            if (!category) return;

            if (!Array.isArray(category.types)) {
                errors.push('Category "' + cat + '" has invalid types array.');
                return;
            }

            // Check each type in the category exists in MAGIC_TYPES
            category.types.forEach(function(typeKey) {
                if (!MAGIC_TYPES[typeKey]) {
                    errors.push('Category "' + cat + '" references unknown magic type "' + typeKey + '".');
                    return;
                }
                if (MAGIC_TYPES[typeKey].category !== cat) {
                    errors.push('Magic type "' + typeKey + '" is in category "' + cat + '" but declares category "' + MAGIC_TYPES[typeKey].category + '".');
                }
            });
        });

        // Check that every magic type appears in exactly one category
        var typeCount = {};
        categoryKeys.forEach(function(cat) {
            var category = MAGIC_CATEGORIES[cat];
            if (!category || !Array.isArray(category.types)) return;
            category.types.forEach(function(typeKey) {
                if (!typeCount[typeKey]) {
                    typeCount[typeKey] = 0;
                }
                typeCount[typeKey]++;
            });
        });

        MAGIC_TYPE_KEYS.forEach(function(key) {
            if (!typeCount[key]) {
                errors.push('Magic type "' + key + '" is not in any category.');
            } else if (typeCount[key] > 1) {
                errors.push('Magic type "' + key + '" appears in multiple categories.');
            }
        });

        // ---- MAGIC POWER THRESHOLDS ----
        var validRanks = ['ARCHMAGE', 'MASTER', 'ADEPT', 'APPRENTICE', 'NOVICE'];
        for (var rank in MAGIC_POWER_THRESHOLDS) {
            if (Object.prototype.hasOwnProperty.call(MAGIC_POWER_THRESHOLDS, rank)) {
                if (validRanks.indexOf(rank) === -1) {
                    errors.push('Unknown magic power rank "' + rank + '".');
                }
                var val = MAGIC_POWER_THRESHOLDS[rank];
                if (typeof val !== 'number' || val < 0 || val > 100) {
                    errors.push('Magic power threshold "' + rank + '" must be between 0 and 100.');
                }
            }
        }

        // Check thresholds are in descending order
        var ranks = ['ARCHMAGE', 'MASTER', 'ADEPT', 'APPRENTICE', 'NOVICE'];
        var prev = 101;
        for (var i = 0; i < ranks.length; i++) {
            var val = MAGIC_POWER_THRESHOLDS[ranks[i]];
            if (val !== undefined && val >= prev) {
                errors.push('Magic power thresholds must be in descending order. "' + ranks[i] + '" is ' + val + ', expected < ' + prev);
            }
            if (val !== undefined) {
                prev = val;
            }
        }

        // ---- CAREER STATUS OPTIONS ----
        if (!Array.isArray(CAREER_STATUS_OPTIONS) || CAREER_STATUS_OPTIONS.length === 0) {
            errors.push('CAREER_STATUS_OPTIONS must be a non-empty array.');
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

        if (errors.length > 0) {
            throw new Error('CharacterConstants validation failed:\n  ' + errors.join('\n  ') +
                '\n\nPlease fix the constant definitions before loading the application.');
        }

        return true;
    }

    // ============================================================
    // BUILD AND VALIDATE BEFORE PUBLISHING
    // ============================================================

    // 1. Build magic categories from MAGIC_TYPES
    buildMagicCategories();

    // 2. Validate all constants
    try {
        validateConstants();
        console.log('[CharacterConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[CharacterConstants] Validation failed:', e.message);
        // Re-throw to prevent application loading with invalid constants
        throw e;
    }

    // 3. Deep freeze all constants
    deepFreeze(STAT_KEYS);
    deepFreeze(STAT_DEFINITIONS);
    deepFreeze(MAGIC_TYPES);
    deepFreeze(MAGIC_CATEGORIES);
    deepFreeze(MAGIC_TYPE_KEYS);
    deepFreeze(MAGIC_CATEGORY_MULTIPLIERS);
    deepFreeze(MAGIC_CLASS_MAP);
    deepFreeze(MAGIC_POWER_THRESHOLDS);
    deepFreeze(CLASS_DEFINITIONS);
    deepFreeze(CAREER_STATUS_OPTIONS);

    // ============================================================
    // EXPOSE - ONLY AFTER VALIDATION
    // ============================================================

    window.CharacterConstants = Object.freeze({
        // Stats
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_DEFINITIONS: STAT_DEFINITIONS,

        // Magic
        MAGIC_MAX: MAGIC_MAX,
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,
        MAGIC_TYPE_KEYS: MAGIC_TYPE_KEYS,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,

        // Magic configuration
        MAGIC_CATEGORY_MULTIPLIERS: MAGIC_CATEGORY_MULTIPLIERS,
        MAGIC_CLASS_MAP: MAGIC_CLASS_MAP,
        MAGIC_POWER_THRESHOLDS: MAGIC_POWER_THRESHOLDS,

        // Magic getters
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,
        getMagicTypeLabel: getMagicTypeLabel,
        getMagicCategoryLabel: getMagicCategoryLabel,
        getMagicCategoryMultiplier: getMagicCategoryMultiplier,
        getMagicClassForType: getMagicClassForType,
        getMagicPowerThreshold: getMagicPowerThreshold,

        // Classes
        CLASS_DEFINITIONS: CLASS_DEFINITIONS,
        getClassDefinition: getClassDefinition,

        // Career status
        CAREER_STATUS_OPTIONS: CAREER_STATUS_OPTIONS,
        getCareerStatusOptions: getCareerStatusOptions,
        getCareerStatusLabels: getCareerStatusLabels,

        // Special moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Validation
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
    window.MAGIC_MAX = MAGIC_MAX;
    window.MAGIC_TYPES = MAGIC_TYPES;
    window.MAGIC_CATEGORIES = MAGIC_CATEGORIES;
    window.MAGIC_TYPE_KEYS = MAGIC_TYPE_KEYS;
    window.CLASS_DEFINITIONS = CLASS_DEFINITIONS;
    window.MAX_SPECIAL_MOVES = MAX_SPECIAL_MOVES;
    window.MAX_MOVE_NAME_LENGTH = MAX_MOVE_NAME_LENGTH;
    window.MAX_MOVE_DESCRIPTION_LENGTH = MAX_MOVE_DESCRIPTION_LENGTH;
    window.getMagicTypeKeys = getMagicTypeKeys;
    window.getMagicCategoryTypes = getMagicCategoryTypes;
    window.getClassDefinition = getClassDefinition;
    window.CAREER_STATUS_OPTIONS = CAREER_STATUS_OPTIONS;

})();
