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
 *   - Validation functions for all constants
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for all character constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - statWeights for each class MUST sum to exactly 1.0
 *   - Classes are validated on load; invalid classes will block loading
 *   - Magic types are organised into categories (elemental, body, aether)
 *   - All constants are frozen to prevent mutation
 *   - STAT_MIN, STAT_MAX, STAT_DEFAULT are used throughout the application
 *   - CharacterConstants is MANDATORY for character operations
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

    // Guard against duplicate loading
    if (window.__characterConstantsLoaded) {
        return;
    }
    window.__characterConstantsLoaded = true;

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
    // MAGIC CONSTANTS
    // ============================================================

    var MAGIC_MAX = 10;
    var BALANCED_MAGE_THRESHOLD = 3;

    // Magic type definitions - SINGLE SOURCE OF TRUTH
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
    var MAGIC_CATEGORIES = {
        elemental: {
            label: 'Elemental',
            description: 'Magic derived from the natural elements',
            icon: '🔥',
            color: 'var(--accent)',
            types: ['earth', 'water', 'fire', 'air', 'metal', 'wood']
        },
        body: {
            label: 'Body',
            description: 'Magic derived from living organisms and physiology',
            icon: '🧬',
            color: 'var(--danger)',
            types: ['blood', 'bone', 'mind', 'morphic', 'life', 'death']
        },
        aether: {
            label: 'Aether',
            description: 'Magic derived from the fabric of reality itself',
            icon: '✦',
            color: 'var(--info)',
            types: ['space', 'time', 'dimension', 'void', 'reality', 'transference']
        }
    };

    // Derived magic type keys
    var MAGIC_TYPE_KEYS = Object.keys(MAGIC_TYPES);

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
            statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1, int: 0, cha: 0 },
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
            statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05, cha: 0 },
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
            statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05, int: 0 },
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
            statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05, str: 0 },
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
            statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05, str: 0 },
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
            statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05, con: 0 },
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
            statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05, cha: 0 },
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
            statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05, str: 0 },
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
            statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05, int: 0 },
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
            statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05, cha: 0 },
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
            statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05, str: 0 },
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
            statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05, str: 0 },
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
            statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05, int: 0 },
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
            statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05, str: 0 },
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
            statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05, int: 0 },
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'dex'],
            minStats: { str: 13, con: 12 }
        }
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

    function getClassDefinition(id) {
        return CLASS_DEFINITIONS.find(function(c) {
            return c.id === id;
        }) || null;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // Validate class statWeights sum to 1.0
        CLASS_DEFINITIONS.forEach(function(cls) {
            var sum = 0;
            for (var key in cls.statWeights) {
                if (Object.prototype.hasOwnProperty.call(cls.statWeights, key)) {
                    sum += cls.statWeights[key];
                }
            }
            // Allow small floating-point tolerance
            if (Math.abs(sum - 1) > 0.001) {
                errors.push(cls.id + ': statWeights sum to ' + sum.toFixed(2) + ', expected 1');
            }
        });

        // Validate magic type keys match categories
        var allMagicKeys = Object.keys(MAGIC_TYPES);
        var allCategoryKeys = [];

        for (var cat in MAGIC_CATEGORIES) {
            if (Object.prototype.hasOwnProperty.call(MAGIC_CATEGORIES, cat)) {
                var types = MAGIC_CATEGORIES[cat].types;
                allCategoryKeys = allCategoryKeys.concat(types);
            }
        }

        // Check for magic types not in any category
        allMagicKeys.forEach(function(key) {
            if (allCategoryKeys.indexOf(key) === -1) {
                errors.push('Magic type "' + key + '" is not in any category');
            }
        });

        // Check for category types that don't exist
        allCategoryKeys.forEach(function(key) {
            if (allMagicKeys.indexOf(key) === -1) {
                errors.push('Category references non-existent magic type "' + key + '"');
            }
        });

        if (errors.length > 0) {
            throw new Error('CharacterConstants validation failed:\n  ' + errors.join('\n  ') +
                '\n\nPlease fix the constant definitions before loading the application.');
        }

        return true;
    }

    // ============================================================
    // FREEZE ALL CONSTANTS
    // ============================================================

    Object.freeze(STAT_KEYS);
    Object.freeze(STAT_DEFINITIONS);
    Object.freeze(MAGIC_TYPES);
    Object.freeze(MAGIC_CATEGORIES);
    Object.freeze(MAGIC_TYPE_KEYS);
    Object.freeze(CLASS_DEFINITIONS);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterConstants = {
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

        // Magic getters
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,
        getMagicTypeLabel: getMagicTypeLabel,
        getMagicCategoryLabel: getMagicCategoryLabel,

        // Classes
        CLASS_DEFINITIONS: CLASS_DEFINITIONS,
        getClassDefinition: getClassDefinition,

        // Special moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Validation
        validateConstants: validateConstants
    };

    // ============================================================
    // LEGACY COMPATIBILITY
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

    // ============================================================
    // VALIDATE ON LOAD
    // ============================================================

    try {
        validateConstants();
        console.log('[CharacterConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[CharacterConstants] Validation failed:', e.message);
        // Re-throw to prevent application loading with invalid constants
        throw e;
    }

})();
