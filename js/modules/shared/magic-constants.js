/**
 * modules/shared/magic-constants.js - Magic Constants
 * Single source of truth for all magic-related constants
 * Path: js/modules/shared/magic-constants.js
 * 
 * This module provides:
 *   - Magic type definitions and categories
 *   - Magic type metadata (labels, colors, categories)
 *   - Magic class mapping
 *   - Magic power thresholds
 *   - Magic category multipliers
 *   - Balanced mage threshold
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for magic constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Validation runs BEFORE publishing to ensure integrity
 *   - No character-specific constants (stats, moves, etc.)
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var MC = window.MagicConstants;
 *   var types = MC.getTypeKeys();
 *   var categories = MC.getCategories();
 *   var label = MC.getTypeLabel('fire');
 *   var power = MC.calculatePower(magic);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__magicConstantsLoaded) {
        return;
    }
    window.__magicConstantsLoaded = true;

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
    // MAGIC TYPE DEFINITIONS - CANONICAL SOURCE OF TRUTH
    // ============================================================

    /**
     * Magic type definitions.
     * 
     * Each type has:
     *   - id: Unique identifier (used in data storage)
     *   - label: Human-readable display name
     *   - category: 'elemental' | 'body' | 'aether'
     *   - color: CSS color value (trusted application configuration)
     *   - description: Optional description of the magic type
     */
    var MAGIC_TYPES = {
        // Elemental Magic
        earth: {
            id: 'earth',
            label: 'Earth',
            category: 'elemental',
            color: '#8B7355',
            description: 'Control over stone, soil, and metal'
        },
        water: {
            id: 'water',
            label: 'Water',
            category: 'elemental',
            color: '#4A9BC7',
            description: 'Control over water, ice, and fluids'
        },
        fire: {
            id: 'fire',
            label: 'Fire',
            category: 'elemental',
            color: '#E67E22',
            description: 'Control over fire, heat, and combustion'
        },
        air: {
            id: 'air',
            label: 'Air',
            category: 'elemental',
            color: '#A8D5E2',
            description: 'Control over air, wind, and weather'
        },
        metal: {
            id: 'metal',
            label: 'Metal',
            category: 'elemental',
            color: '#95A5A6',
            description: 'Control over refined metals and alloys'
        },
        wood: {
            id: 'wood',
            label: 'Wood',
            category: 'elemental',
            color: '#27AE60',
            description: 'Control over wood, plants, and growth'
        },

        // Body Magic
        blood: {
            id: 'blood',
            label: 'Blood',
            category: 'body',
            color: '#C0392B',
            description: 'Control over blood, circulation, and vitality'
        },
        bone: {
            id: 'bone',
            label: 'Bone',
            category: 'body',
            color: '#F5F5DC',
            description: 'Control over bone, structure, and skeleton'
        },
        mind: {
            id: 'mind',
            label: 'Mind',
            category: 'body',
            color: '#8E44AD',
            description: 'Control over thoughts, memory, and consciousness'
        },
        morphic: {
            id: 'morphic',
            label: 'Morphic',
            category: 'body',
            color: '#1ABC9C',
            description: 'Control over shape, form, and transformation'
        },
        life: {
            id: 'life',
            label: 'Life',
            category: 'body',
            color: '#2ECC71',
            description: 'Control over growth, healing, and vitality'
        },
        death: {
            id: 'death',
            label: 'Death',
            category: 'body',
            color: '#2C3E50',
            description: 'Control over decay, entropy, and mortality'
        },

        // Aether Magic
        space: {
            id: 'space',
            label: 'Space',
            category: 'aether',
            color: '#3498DB',
            description: 'Control over distance, position, and dimensions'
        },
        time: {
            id: 'time',
            label: 'Time',
            category: 'aether',
            color: '#F39C12',
            description: 'Control over temporal flow and causality'
        },
        dimension: {
            id: 'dimension',
            label: 'Dimension',
            category: 'aether',
            color: '#9B59B6',
            description: 'Control over alternate realities and planes'
        },
        void: {
            id: 'void',
            label: 'Void',
            category: 'aether',
            color: '#1A1A2E',
            description: 'Control over nothingness and absence'
        },
        reality: {
            id: 'reality',
            label: 'Reality',
            category: 'aether',
            color: '#F1C40F',
            description: 'Control over fundamental existence'
        },
        transference: {
            id: 'transference',
            label: 'Transference',
            category: 'aether',
            color: '#E74C3C',
            description: 'Control over energy, matter, and essence transfer'
        }
    };

    // ============================================================
    // MAGIC CATEGORIES
    // ============================================================

    var MAGIC_CATEGORIES = {
        elemental: {
            id: 'elemental',
            label: 'Elemental',
            description: 'Magic derived from the natural elements',
            icon: '🔥',
            color: 'var(--accent)',
            types: ['earth', 'water', 'fire', 'air', 'metal', 'wood']
        },
        body: {
            id: 'body',
            label: 'Body',
            description: 'Magic derived from living organisms and physiology',
            icon: '🧬',
            color: 'var(--danger)',
            types: ['blood', 'bone', 'mind', 'morphic', 'life', 'death']
        },
        aether: {
            id: 'aether',
            label: 'Aether',
            description: 'Magic derived from the fabric of reality itself',
            icon: '✦',
            color: 'var(--info)',
            types: ['space', 'time', 'dimension', 'void', 'reality', 'transference']
        }
    };

    // ============================================================
    // MAGIC CONFIGURATION
    // ============================================================

    /** Maximum magic proficiency (0-10 scale) */
    var MAGIC_MAX = 10;

    /** Balanced mage threshold (minimum proficiency in each type of a category) */
    var BALANCED_MAGE_THRESHOLD = 3;

    /** Magic category multipliers for power calculation */
    var MAGIC_CATEGORY_MULTIPLIERS = {
        'elemental': 1.0,
        'body': 1.2,
        'aether': 1.5
    };

    /**
     * Magic class mapping.
     * Maps category + type to a magic class name.
     * Used for suggestions and display.
     */
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

    /**
     * Magic power thresholds.
     * Used to determine rank from power score.
     */
    var MAGIC_POWER_THRESHOLDS = {
        'ARCHMAGE': 90,
        'MASTER': 70,
        'ADEPT': 50,
        'APPRENTICE': 30,
        'NOVICE': 10
    };

    // ============================================================
    // DERIVED DATA
    // ============================================================

    /** Array of all magic type keys */
    var MAGIC_TYPE_KEYS = Object.keys(MAGIC_TYPES);

    /** Map of type ID to type definition */
    var _typeMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeMap[key] = MAGIC_TYPES[key];
    });

    /** Map of category ID to category definition */
    var _categoryMap = Object.create(null);
    var categoryKeys = Object.keys(MAGIC_CATEGORIES);
    categoryKeys.forEach(function(key) {
        _categoryMap[key] = MAGIC_CATEGORIES[key];
    });

    /** Map of type ID to category */
    var _typeCategoryMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeCategoryMap[key] = MAGIC_TYPES[key].category;
    });

    /** Map of type ID to label */
    var _typeLabelMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeLabelMap[key] = MAGIC_TYPES[key].label;
    });

    /** Map of type ID to color */
    var _typeColorMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeColorMap[key] = MAGIC_TYPES[key].color;
    });

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    /**
     * Get all magic type keys.
     * 
     * @returns {string[]} Array of magic type keys
     */
    function getTypeKeys() {
        return MAGIC_TYPE_KEYS.slice();
    }

    /**
     * Get a magic type definition by key.
     * 
     * @param {string} key - Magic type key
     * @returns {object|null} Type definition or null
     */
    function getType(key) {
        if (!key || typeof key !== 'string') {
            return null;
        }
        return _typeMap[key] || null;
    }

    /**
     * Get the label for a magic type.
     * 
     * @param {string} key - Magic type key
     * @returns {string} Label or the key if not found
     */
    function getTypeLabel(key) {
        if (!key || typeof key !== 'string') {
            return '';
        }
        return _typeLabelMap[key] || key;
    }

    /**
     * Get the color for a magic type.
     * 
     * @param {string} key - Magic type key
     * @returns {string} CSS color value or default
     */
    function getTypeColor(key) {
        if (!key || typeof key !== 'string') {
            return '#7f8c8d';
        }
        return _typeColorMap[key] || '#7f8c8d';
    }

    /**
     * Get the category for a magic type.
     * 
     * @param {string} key - Magic type key
     * @returns {string|null} Category ID or null
     */
    function getTypeCategory(key) {
        if (!key || typeof key !== 'string') {
            return null;
        }
        return _typeCategoryMap[key] || null;
    }

    /**
     * Get all magic category definitions.
     * 
     * @returns {object} Category definitions
     */
    function getCategories() {
        return Object.assign({}, MAGIC_CATEGORIES);
    }

    /**
     * Get a magic category definition by ID.
     * 
     * @param {string} categoryId - Category ID
     * @returns {object|null} Category definition or null
     */
    function getCategory(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') {
            return null;
        }
        return _categoryMap[categoryId] || null;
    }

    /**
     * Get the label for a magic category.
     * 
     * @param {string} categoryId - Category ID
     * @returns {string} Label or the ID if not found
     */
    function getCategoryLabel(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') {
            return '';
        }
        var category = getCategory(categoryId);
        return category ? category.label : categoryId;
    }

    /**
     * Get the types for a magic category.
     * 
     * @param {string} categoryId - Category ID
     * @returns {string[]} Array of type keys
     */
    function getCategoryTypes(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') {
            return [];
        }
        var category = getCategory(categoryId);
        return category ? category.types.slice() : [];
    }

    /**
     * Get the multiplier for a magic category.
     * 
     * @param {string} categoryId - Category ID
     * @returns {number} Multiplier or 1.0
     */
    function getCategoryMultiplier(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') {
            return 1.0;
        }
        return MAGIC_CATEGORY_MULTIPLIERS[categoryId] || 1.0;
    }

    /**
     * Get the magic class name for a type.
     * 
     * @param {string} categoryId - Category ID
     * @param {string} typeKey - Magic type key
     * @returns {string|null} Magic class name or null
     */
    function getMagicClass(categoryId, typeKey) {
        if (!categoryId || !typeKey) {
            return null;
        }
        if (MAGIC_CLASS_MAP[categoryId] && MAGIC_CLASS_MAP[categoryId][typeKey]) {
            return MAGIC_CLASS_MAP[categoryId][typeKey];
        }
        return null;
    }

    /**
     * Get the magic power threshold for a rank.
     * 
     * @param {string} rank - Rank name (ARCHMAGE, MASTER, etc.)
     * @returns {number} Threshold or 0
     */
    function getPowerThreshold(rank) {
        if (!rank || typeof rank !== 'string') {
            return 0;
        }
        return MAGIC_POWER_THRESHOLDS[rank] || 0;
    }

    /**
     * Get all magic power thresholds.
     * 
     * @returns {object} Power thresholds
     */
    function getPowerThresholds() {
        return Object.assign({}, MAGIC_POWER_THRESHOLDS);
    }

    /**
     * Get the magic class map.
     * 
     * @returns {object} Magic class map
     */
    function getMagicClassMap() {
        return Object.assign({}, MAGIC_CLASS_MAP);
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        // ---- MAGIC TYPES ----
        if (!MAGIC_TYPES || typeof MAGIC_TYPES !== 'object') {
            errors.push('MAGIC_TYPES is missing or invalid.');
        }

        if (!MAGIC_TYPE_KEYS || !Array.isArray(MAGIC_TYPE_KEYS) || MAGIC_TYPE_KEYS.length === 0) {
            errors.push('MAGIC_TYPE_KEYS is missing or empty.');
        }

        // Validate each magic type
        MAGIC_TYPE_KEYS.forEach(function(key) {
            var type = MAGIC_TYPES[key];
            if (!type) {
                errors.push('Magic type "' + key + '" has no definition.');
                return;
            }

            if (!type.id || type.id !== key) {
                errors.push('Magic type "' + key + '" has mismatched id.');
            }
            if (!type.label || typeof type.label !== 'string') {
                errors.push('Magic type "' + key + '" missing label.');
            }
            if (!type.category || typeof type.category !== 'string') {
                errors.push('Magic type "' + key + '" missing category.');
            }
            if (!type.color || typeof type.color !== 'string') {
                errors.push('Magic type "' + key + '" missing color.');
            }
        });

        // ---- MAGIC CATEGORIES ----
        if (!MAGIC_CATEGORIES || typeof MAGIC_CATEGORIES !== 'object') {
            errors.push('MAGIC_CATEGORIES is missing or invalid.');
        }

        var categoryKeys = Object.keys(MAGIC_CATEGORIES);
        if (categoryKeys.length === 0) {
            errors.push('MAGIC_CATEGORIES is empty.');
        }

        categoryKeys.forEach(function(key) {
            var cat = MAGIC_CATEGORIES[key];
            if (!cat) {
                errors.push('Category "' + key + '" has no definition.');
                return;
            }

            if (!cat.id || cat.id !== key) {
                errors.push('Category "' + key + '" has mismatched id.');
            }
            if (!cat.label || typeof cat.label !== 'string') {
                errors.push('Category "' + key + '" missing label.');
            }
            if (!Array.isArray(cat.types)) {
                errors.push('Category "' + key + '" missing types array.');
            }
        });

        // ---- MAGIC CONFIGURATION ----
        if (typeof MAGIC_MAX !== 'number' || MAGIC_MAX < 0) {
            errors.push('MAGIC_MAX must be a non-negative number.');
        }

        if (typeof BALANCED_MAGE_THRESHOLD !== 'number' || BALANCED_MAGE_THRESHOLD < 0) {
            errors.push('BALANCED_MAGE_THRESHOLD must be a non-negative number.');
        }

        // ---- MAGIC CATEGORY MULTIPLIERS ----
        if (!MAGIC_CATEGORY_MULTIPLIERS || typeof MAGIC_CATEGORY_MULTIPLIERS !== 'object') {
            errors.push('MAGIC_CATEGORY_MULTIPLIERS is missing or invalid.');
        }

        categoryKeys.forEach(function(key) {
            if (MAGIC_CATEGORY_MULTIPLIERS[key] === undefined) {
                errors.push('MAGIC_CATEGORY_MULTIPLIERS missing key "' + key + '".');
            } else if (typeof MAGIC_CATEGORY_MULTIPLIERS[key] !== 'number' || MAGIC_CATEGORY_MULTIPLIERS[key] <= 0) {
                errors.push('MAGIC_CATEGORY_MULTIPLIERS["' + key + '"] must be a positive number.');
            }
        });

        // ---- MAGIC CLASS MAP ----
        if (!MAGIC_CLASS_MAP || typeof MAGIC_CLASS_MAP !== 'object') {
            errors.push('MAGIC_CLASS_MAP is missing or invalid.');
        }

        categoryKeys.forEach(function(key) {
            var category = MAGIC_CATEGORIES[key];
            if (!category) return;

            if (!MAGIC_CLASS_MAP[key]) {
                errors.push('MAGIC_CLASS_MAP missing key "' + key + '".');
                return;
            }

            var typeMap = MAGIC_CLASS_MAP[key];
            category.types.forEach(function(typeKey) {
                if (!typeMap[typeKey]) {
                    errors.push('MAGIC_CLASS_MAP["' + key + '"] missing type "' + typeKey + '".');
                }
            });
        });

        // ---- MAGIC POWER THRESHOLDS ----
        var validRanks = ['ARCHMAGE', 'MASTER', 'ADEPT', 'APPRENTICE', 'NOVICE'];
        validRanks.forEach(function(rank) {
            if (MAGIC_POWER_THRESHOLDS[rank] === undefined) {
                errors.push('MAGIC_POWER_THRESHOLDS missing key "' + rank + '".');
            } else if (typeof MAGIC_POWER_THRESHOLDS[rank] !== 'number' || MAGIC_POWER_THRESHOLDS[rank] < 0 || MAGIC_POWER_THRESHOLDS[rank] > 100) {
                errors.push('MAGIC_POWER_THRESHOLDS["' + rank + '"] must be between 0 and 100.');
            }
        });

        // Check thresholds are in descending order
        var prev = 101;
        validRanks.forEach(function(rank) {
            var val = MAGIC_POWER_THRESHOLDS[rank];
            if (val !== undefined && val >= prev) {
                errors.push('Magic power thresholds must be in descending order. "' + rank + '" is ' + val + ', expected < ' + prev);
            }
            if (val !== undefined) {
                prev = val;
            }
        });

        if (errors.length > 0) {
            throw new Error('MagicConstants validation failed:\n  ' + errors.join('\n  '));
        }

        return true;
    }

    // ============================================================
    // VALIDATE BEFORE PUBLISHING
    // ============================================================

    try {
        validateConstants();
        console.log('[MagicConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[MagicConstants] Validation failed:', e.message);
        throw e;
    }

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(MAGIC_TYPES);
    deepFreeze(MAGIC_CATEGORIES);
    deepFreeze(MAGIC_TYPE_KEYS);
    deepFreeze(MAGIC_CATEGORY_MULTIPLIERS);
    deepFreeze(MAGIC_CLASS_MAP);
    deepFreeze(MAGIC_POWER_THRESHOLDS);
    deepFreeze(_typeMap);
    deepFreeze(_categoryMap);
    deepFreeze(_typeCategoryMap);
    deepFreeze(_typeLabelMap);
    deepFreeze(_typeColorMap);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MagicConstants = Object.freeze({
        // Raw definitions (read-only)
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,
        MAGIC_TYPE_KEYS: MAGIC_TYPE_KEYS,

        // Configuration
        MAGIC_MAX: MAGIC_MAX,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,
        MAGIC_CATEGORY_MULTIPLIERS: MAGIC_CATEGORY_MULTIPLIERS,
        MAGIC_CLASS_MAP: MAGIC_CLASS_MAP,
        MAGIC_POWER_THRESHOLDS: MAGIC_POWER_THRESHOLDS,

        // Type lookup
        getTypeKeys: getTypeKeys,
        getType: getType,
        getTypeLabel: getTypeLabel,
        getTypeColor: getTypeColor,
        getTypeCategory: getTypeCategory,

        // Category lookup
        getCategories: getCategories,
        getCategory: getCategory,
        getCategoryLabel: getCategoryLabel,
        getCategoryTypes: getCategoryTypes,

        // Configuration lookup
        getCategoryMultiplier: getCategoryMultiplier,
        getMagicClass: getMagicClass,
        getPowerThreshold: getPowerThreshold,
        getPowerThresholds: getPowerThresholds,
        getMagicClassMap: getMagicClassMap,

        // Validation (public for testing)
        validateConstants: validateConstants
    });

    // ============================================================
    // LEGACY COMPATIBILITY (DEPRECATED - Will be removed)
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from old constants structure.
    // They will be removed in a future version.

    window.MAGIC_MAX = MAGIC_MAX;
    window.MAGIC_TYPES = MAGIC_TYPES;
    window.MAGIC_CATEGORIES = MAGIC_CATEGORIES;
    window.MAGIC_TYPE_KEYS = MAGIC_TYPE_KEYS;
    window.MAGIC_CATEGORY_MULTIPLIERS = MAGIC_CATEGORY_MULTIPLIERS;
    window.MAGIC_CLASS_MAP = MAGIC_CLASS_MAP;
    window.MAGIC_POWER_THRESHOLDS = MAGIC_POWER_THRESHOLDS;
    window.BALANCED_MAGE_THRESHOLD = BALANCED_MAGE_THRESHOLD;

})();