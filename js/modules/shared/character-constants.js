/**
 * modules/shared/character-constants.js - Character Constants
 * Centralised definitions for magic, stats, and classes
 * Path: js/modules/shared/character-constants.js
 * 
 * This module provides:
 *   - MAGIC_TYPES - All magic types with metadata (category, color, label)
 *   - MAGIC_CATEGORIES - Magic categories with labels and colors
 *   - STAT_DEFINITIONS - Stat keys with labels and abbreviations
 *   - CLASS_DEFINITIONS - Physical class definitions with stat weights and requirements
 *   - BALANCED_MAGE_THRESHOLD - Threshold for balanced mage detection
 *   - Helper functions for accessing these constants
 * 
 * IMPORTANT:
 *   - THIS IS THE SINGLE SOURCE OF TRUTH for all character constants
 *   - All modules MUST import from here - do NOT duplicate
 *   - Constants are READ-ONLY - do not modify at runtime
 *   - Class definitions include all fields needed for suggestion and application
 * 
 * DEPENDENCIES:
 *   - None (standalone module)
 * 
 * USAGE:
 *   var magicTypes = window.CharacterConstants.MAGIC_TYPES;
 *   var classDefs = window.CharacterConstants.CLASS_DEFINITIONS;
 *   var stats = window.CharacterConstants.STAT_DEFINITIONS;
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterConstantsLoaded) {
        return;
    }
    window.__characterConstantsLoaded = true;

    // ============================================================
    // MAGIC DEFINITIONS
    // ============================================================

    /**
     * Magic type metadata.
     * Each type has: id, label, category, color
     * Categories: 'elemental', 'body', 'aether'
     */
    var MAGIC_TYPES = {
        // Elemental Magic
        earth: { id: 'earth', label: 'Earth Magic', category: 'elemental', color: '#8B7355' },
        water: { id: 'water', label: 'Water Magic', category: 'elemental', color: '#4A9BC7' },
        fire: { id: 'fire', label: 'Fire Magic', category: 'elemental', color: '#E67E22' },
        air: { id: 'air', label: 'Air Magic', category: 'elemental', color: '#A8D5E2' },
        metal: { id: 'metal', label: 'Metal Magic', category: 'elemental', color: '#95A5A6' },
        wood: { id: 'wood', label: 'Wood Magic', category: 'elemental', color: '#27AE60' },

        // Body Magic
        blood: { id: 'blood', label: 'Blood Magic', category: 'body', color: '#C0392B' },
        bone: { id: 'bone', label: 'Bone Magic', category: 'body', color: '#F5F5DC' },
        mind: { id: 'mind', label: 'Mind Magic', category: 'body', color: '#8E44AD' },
        morphic: { id: 'morphic', label: 'Morphic Magic', category: 'body', color: '#1ABC9C' },
        life: { id: 'life', label: 'Life Magic', category: 'body', color: '#2ECC71' },
        death: { id: 'death', label: 'Death Magic', category: 'body', color: '#2C3E50' },

        // Aether Magic
        space: { id: 'space', label: 'Space Magic', category: 'aether', color: '#3498DB' },
        time: { id: 'time', label: 'Time Magic', category: 'aether', color: '#F39C12' },
        dimension: { id: 'dimension', label: 'Dimension Magic', category: 'aether', color: '#9B59B6' },
        void: { id: 'void', label: 'Void Magic', category: 'aether', color: '#1A1A2E' },
        reality: { id: 'reality', label: 'Reality Magic', category: 'aether', color: '#F1C40F' },
        transference: { id: 'transference', label: 'Transference Magic', category: 'aether', color: '#E74C3C' }
    };

    /**
     * Magic type keys in display order.
     */
    var MAGIC_TYPE_KEYS = [
        'earth', 'water', 'fire', 'air', 'metal', 'wood',
        'blood', 'bone', 'mind', 'morphic', 'life', 'death',
        'space', 'time', 'dimension', 'void', 'reality', 'transference'
    ];

    /**
     * Magic categories.
     * Each category has: label, color, types (array of type keys)
     */
    var MAGIC_CATEGORIES = {
        elemental: {
            label: 'Elemental Magic',
            color: '#8cbb3a',
            types: ['earth', 'water', 'fire', 'air', 'metal', 'wood']
        },
        body: {
            label: 'Body Magic',
            color: '#c1453c',
            types: ['blood', 'bone', 'mind', 'morphic', 'life', 'death']
        },
        aether: {
            label: 'Aether Magic',
            color: '#4a9bc7',
            types: ['space', 'time', 'dimension', 'void', 'reality', 'transference']
        }
    };

    /**
     * Magic category keys in display order.
     */
    var MAGIC_CATEGORY_KEYS = ['elemental', 'body', 'aether'];

    /**
     * Balanced mage threshold.
     * A character is considered "balanced" in a category if all types
     * in that category are at least this value.
     */
    var BALANCED_MAGE_THRESHOLD = 3;

    /**
     * Maximum magic proficiency value (0-10 scale).
     */
    var MAGIC_MAX = 10;

    // ============================================================
    // STAT DEFINITIONS
    // ============================================================

    /**
     * Stat definitions.
     * Each stat has: label, abbr (abbreviation)
     */
    var STAT_DEFINITIONS = {
        str: { label: 'Strength', abbr: 'STR' },
        dex: { label: 'Dexterity', abbr: 'DEX' },
        con: { label: 'Constitution', abbr: 'CON' },
        int: { label: 'Intelligence', abbr: 'INT' },
        wis: { label: 'Wisdom', abbr: 'WIS' },
        cha: { label: 'Charisma', abbr: 'CHA' }
    };

    /**
     * Stat keys in display order.
     */
    var STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    /**
     * Stat range constants.
     */
    var STAT_MIN = 1;
    var STAT_MAX = 50;
    var STAT_DEFAULT = 10;

    // ============================================================
    // CLASS DEFINITIONS
    // ============================================================

    /**
     * Physical class definitions.
     * Each class has:
     *   - id: Unique identifier
     *   - label: Display name
     *   - icon: Emoji icon
     *   - primaryStats: Primary stat keys (used for suggestion and application)
     *   - secondaryStats: Secondary stat keys (used for application)
     *   - statWeights: Weighting for suggestion algorithm
     *   - minStats: Minimum stat requirements (used for suggestion filtering)
     *   - priority: Tie-breaker priority (higher = more likely to be suggested)
     *   - description: Human-readable description
     */
    var CLASS_DEFINITIONS = [
        {
            id: 'warrior',
            label: 'Warrior',
            icon: '⚔',
            primaryStats: ['str', 'con'],
            secondaryStats: ['dex'],
            statWeights: { str: 0.5, con: 0.3, dex: 0.15, wis: 0.05 },
            minStats: { str: 14, con: 12 },
            priority: 5,
            description: 'Masters of combat who rely on strength and endurance to overpower their foes.'
        },
        {
            id: 'skirmisher',
            label: 'Skirmisher',
            icon: '🏹',
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            statWeights: { dex: 0.45, wis: 0.25, con: 0.15, str: 0.1, int: 0.05 },
            minStats: { dex: 14, wis: 12 },
            priority: 4,
            description: 'Agile fighters who excel at ranged combat and hit-and-run tactics.'
        },
        {
            id: 'protector',
            label: 'Protector',
            icon: '🛡',
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'cha'],
            statWeights: { str: 0.35, con: 0.35, wis: 0.15, cha: 0.1, dex: 0.05 },
            minStats: { str: 14, con: 14 },
            priority: 4,
            description: 'Defenders who shield others from harm and stand firm against any threat.'
        },
        {
            id: 'sage',
            label: 'Sage',
            icon: '📚',
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.4, wis: 0.3, con: 0.15, dex: 0.1, cha: 0.05 },
            minStats: { int: 14, wis: 12 },
            priority: 4,
            description: 'Scholars and keepers of ancient knowledge who wield intellect as their weapon.'
        },
        {
            id: 'mystic',
            label: 'Mystic',
            icon: '✦',
            primaryStats: ['wis', 'cha'],
            secondaryStats: ['con', 'int'],
            statWeights: { wis: 0.4, cha: 0.3, con: 0.15, int: 0.1, dex: 0.05 },
            minStats: { wis: 14, cha: 12 },
            priority: 4,
            description: 'Channelers of spiritual and arcane forces who draw power from within.'
        },
        {
            id: 'stalker',
            label: 'Stalker',
            icon: '🗡',
            primaryStats: ['dex', 'int'],
            secondaryStats: ['cha', 'wis'],
            statWeights: { dex: 0.4, int: 0.25, cha: 0.2, wis: 0.1, str: 0.05 },
            minStats: { dex: 14, int: 12 },
            priority: 4,
            description: 'Masters of stealth and subterfuge who strike from the shadows.'
        },
        {
            id: 'spellblade',
            label: 'Spellblade',
            icon: '⚡',
            primaryStats: ['str', 'int'],
            secondaryStats: ['dex', 'con'],
            statWeights: { str: 0.35, int: 0.35, dex: 0.15, con: 0.1, wis: 0.05 },
            minStats: { str: 13, int: 13 },
            priority: 4,
            description: 'Warriors who weave magic into combat, blending steel and sorcery.'
        },
        {
            id: 'channeler',
            label: 'Channeler',
            icon: '✦',
            primaryStats: ['cha', 'con'],
            secondaryStats: ['dex', 'int'],
            statWeights: { cha: 0.4, con: 0.25, dex: 0.2, int: 0.1, wis: 0.05 },
            minStats: { cha: 14, con: 12 },
            priority: 4,
            description: 'Mages who channel raw magical energy through force of personality.'
        },
        {
            id: 'warden',
            label: 'Warden',
            icon: '⚔',
            primaryStats: ['str', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { str: 0.35, wis: 0.3, con: 0.2, dex: 0.1, cha: 0.05 },
            minStats: { str: 13, wis: 13 },
            priority: 4,
            description: 'Guardians of nature and natural order who protect the wild places.'
        },
        {
            id: 'adept',
            label: 'Adept',
            icon: '✦',
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            statWeights: { dex: 0.4, wis: 0.35, con: 0.15, str: 0.1, int: 0.05 },
            minStats: { dex: 14, wis: 14 },
            priority: 5,
            description: 'Masters of mind-body discipline who achieve perfection through training.'
        },
        {
            id: 'artificer',
            label: 'Artificer',
            icon: '⚙',
            primaryStats: ['int', 'dex'],
            secondaryStats: ['con', 'wis'],
            statWeights: { int: 0.4, dex: 0.25, con: 0.2, wis: 0.1, cha: 0.05 },
            minStats: { int: 14, dex: 12 },
            priority: 4,
            description: 'Inventors and creators of wondrous devices who blend magic with craft.'
        },
        {
            id: 'occultist',
            label: 'Occultist',
            icon: '✦',
            primaryStats: ['int', 'cha'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.35, cha: 0.35, con: 0.15, dex: 0.1, wis: 0.05 },
            minStats: { int: 14, cha: 14 },
            priority: 5,
            description: 'Seekers of forbidden and hidden knowledge who bargain with dark powers.'
        },
        {
            id: 'blade_dancer',
            label: 'Blade Dancer',
            icon: '🗡',
            primaryStats: ['dex', 'cha'],
            secondaryStats: ['str', 'con'],
            statWeights: { dex: 0.4, cha: 0.3, str: 0.15, con: 0.1, wis: 0.05 },
            minStats: { dex: 14, cha: 12 },
            priority: 4,
            description: 'Graceful warriors who move like the wind, turning combat into art.'
        },
        {
            id: 'elementalist',
            label: 'Elementalist',
            icon: '✦',
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.45, wis: 0.25, con: 0.15, dex: 0.1, cha: 0.05 },
            minStats: { int: 14, wis: 12 },
            priority: 4,
            description: 'Masters of the primal elements who command fire, water, earth, and air.'
        },
        {
            id: 'sentinel',
            label: 'Sentinel',
            icon: '🛡',
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'dex'],
            statWeights: { str: 0.3, con: 0.35, wis: 0.2, dex: 0.1, cha: 0.05 },
            minStats: { str: 14, con: 14 },
            priority: 5,
            description: 'Unyielding guardians and protectors who never retreat from their duty.'
        }
    ];

    /**
     * Class ID list for validation.
     */
    var CLASS_IDS = CLASS_DEFINITIONS.map(function(c) { return c.id; });

    // ============================================================
    // SPECIAL MOVES CONSTANTS
    // ============================================================

    /**
     * Maximum number of special moves per type.
     */
    var MAX_SPECIAL_MOVES = 20;

    /**
     * Maximum length of a move name.
     */
    var MAX_MOVE_NAME_LENGTH = 100;

    /**
     * Maximum length of a move description.
     */
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    // ============================================================
    // HELPER FUNCTIONS - Derived from constants
    // ============================================================

    /**
     * Get all magic type keys.
     * @returns {string[]} Array of magic type keys
     */
    function getMagicTypeKeys() {
        return MAGIC_TYPE_KEYS.slice();
    }

    /**
     * Get magic type metadata for a specific type.
     * @param {string} key - Magic type key
     * @returns {object|null} Magic type metadata or null if not found
     */
    function getMagicTypeMetadata(key) {
        return MAGIC_TYPES[key] || null;
    }

    /**
     * Get magic types for a category.
     * @param {string} category - 'elemental' | 'body' | 'aether'
     * @returns {string[]} Array of magic type keys for the category
     */
    function getMagicCategoryTypes(category) {
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.types.slice() : [];
    }

    /**
     * Get magic category metadata.
     * @param {string} category - 'elemental' | 'body' | 'aether'
     * @returns {object|null} Category metadata or null if not found
     */
    function getMagicCategory(category) {
        return MAGIC_CATEGORIES[category] || null;
    }

    /**
     * Get all magic categories.
     * @returns {object} All magic categories
     */
    function getMagicCategories() {
        var result = {};
        for (var key in MAGIC_CATEGORIES) {
            if (Object.prototype.hasOwnProperty.call(MAGIC_CATEGORIES, key)) {
                result[key] = {
                    label: MAGIC_CATEGORIES[key].label,
                    color: MAGIC_CATEGORIES[key].color,
                    types: MAGIC_CATEGORIES[key].types.slice()
                };
            }
        }
        return result;
    }

    /**
     * Get all stat keys.
     * @returns {string[]} Array of stat keys
     */
    function getStatKeys() {
        return STAT_KEYS.slice();
    }

    /**
     * Get stat definition.
     * @param {string} key - Stat key
     * @returns {object|null} Stat definition or null if not found
     */
    function getStatDefinition(key) {
        return STAT_DEFINITIONS[key] || null;
    }

    /**
     * Get stat label.
     * @param {string} key - Stat key
     * @returns {string} Stat label or the key if not found
     */
    function getStatLabel(key) {
        var def = STAT_DEFINITIONS[key];
        return def ? def.label : key.toUpperCase();
    }

    /**
     * Get stat abbreviation.
     * @param {string} key - Stat key
     * @returns {string} Stat abbreviation or the key if not found
     */
    function getStatAbbr(key) {
        var def = STAT_DEFINITIONS[key];
        return def ? def.abbr : key.toUpperCase();
    }

    /**
     * Get a class definition by ID.
     * @param {string} id - Class ID
     * @returns {object|null} Class definition or null if not found
     */
    function getClassDefinition(id) {
        for (var i = 0; i < CLASS_DEFINITIONS.length; i++) {
            if (CLASS_DEFINITIONS[i].id === id) {
                return CLASS_DEFINITIONS[i];
            }
        }
        return null;
    }

    /**
     * Check if a class ID is valid.
     * @param {string} id - Class ID
     * @returns {boolean} True if valid
     */
    function isValidClassId(id) {
        return CLASS_IDS.indexOf(id) !== -1;
    }

    /**
     * Get all class definitions.
     * @returns {object[]} Array of class definitions
     */
    function getClassDefinitions() {
        return CLASS_DEFINITIONS.slice();
    }

    /**
     * Get class definitions sorted by priority.
     * @returns {object[]} Array of class definitions sorted by priority
     */
    function getClassDefinitionsByPriority() {
        return CLASS_DEFINITIONS.slice().sort(function(a, b) {
            var priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.label || '').localeCompare(b.label || '');
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterConstants = {
        // Magic
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_TYPE_KEYS: MAGIC_TYPE_KEYS,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,
        MAGIC_CATEGORY_KEYS: MAGIC_CATEGORY_KEYS,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,
        MAGIC_MAX: MAGIC_MAX,

        // Stats
        STAT_DEFINITIONS: STAT_DEFINITIONS,
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,

        // Classes
        CLASS_DEFINITIONS: CLASS_DEFINITIONS,
        CLASS_IDS: CLASS_IDS,

        // Special Moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Helpers - Magic
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicTypeMetadata: getMagicTypeMetadata,
        getMagicCategoryTypes: getMagicCategoryTypes,
        getMagicCategory: getMagicCategory,
        getMagicCategories: getMagicCategories,

        // Helpers - Stats
        getStatKeys: getStatKeys,
        getStatDefinition: getStatDefinition,
        getStatLabel: getStatLabel,
        getStatAbbr: getStatAbbr,

        // Helpers - Classes
        getClassDefinition: getClassDefinition,
        isValidClassId: isValidClassId,
        getClassDefinitions: getClassDefinitions,
        getClassDefinitionsByPriority: getClassDefinitionsByPriority
    };

    // Also expose individual constants globally for backward compatibility
    window.MAGIC_TYPES = MAGIC_TYPES;
    window.MAGIC_TYPE_KEYS = MAGIC_TYPE_KEYS;
    window.MAGIC_CATEGORIES = MAGIC_CATEGORIES;
    window.MAGIC_CATEGORY_KEYS = MAGIC_CATEGORY_KEYS;
    window.BALANCED_MAGE_THRESHOLD = BALANCED_MAGE_THRESHOLD;
    window.MAGIC_MAX = MAGIC_MAX;
    window.STAT_DEFINITIONS = STAT_DEFINITIONS;
    window.STAT_KEYS = STAT_KEYS;
    window.STAT_MIN = STAT_MIN;
    window.STAT_MAX = STAT_MAX;
    window.STAT_DEFAULT = STAT_DEFAULT;
    window.CLASS_DEFINITIONS = CLASS_DEFINITIONS;
    window.CLASS_IDS = CLASS_IDS;
    window.MAX_SPECIAL_MOVES = MAX_SPECIAL_MOVES;
    window.MAX_MOVE_NAME_LENGTH = MAX_MOVE_NAME_LENGTH;
    window.MAX_MOVE_DESCRIPTION_LENGTH = MAX_MOVE_DESCRIPTION_LENGTH;

})();
