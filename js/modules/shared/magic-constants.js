/**
 * modules/shared/magic-constants.js - Magic Constants
 * Single source of truth for all magic-related constants
 * Path: js/modules/shared/magic-constants.js
 *
 * COLOR TOKENS:
 *   Each magic type carries a CSS custom property REFERENCE as its
 *   `color` field — a string of the form "var(--magic-<type>)".
 *   The actual color values are declared in css/shared.css, with
 *   separate values for dark and light mode. Consumers that read
 *   getTypeColor(key) get a var() string and can drop it straight
 *   into an inline style or SVG presentation attribute.
 *
 *   Do NOT reintroduce hex literals here. If a new type is added,
 *   add its token to css/shared.css in both :root and
 *   [data-theme="light"] and reference it by name.
 *
 *   The category colors (elemental / body / aether) reference
 *   existing app tokens (--accent / --danger / --info) and do not
 *   need their own declarations.
 */

(function() {
    'use strict';

    if (window.__magicConstantsLoaded) {
        return;
    }
    window.__magicConstantsLoaded = true;

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
    // MAGIC TYPE DEFINITIONS
    // ============================================================

    var MAGIC_TYPES = {
        // Elemental
        earth: { id: 'earth', label: 'Earth', category: 'elemental', color: 'var(--magic-earth)',
                 description: 'Control over stone, soil, and metal' },
        water: { id: 'water', label: 'Water', category: 'elemental', color: 'var(--magic-water)',
                 description: 'Control over water, ice, and fluids' },
        fire:  { id: 'fire',  label: 'Fire',  category: 'elemental', color: 'var(--magic-fire)',
                 description: 'Control over fire, heat, and combustion' },
        air:   { id: 'air',   label: 'Air',   category: 'elemental', color: 'var(--magic-air)',
                 description: 'Control over air, wind, and weather' },
        metal: { id: 'metal', label: 'Metal', category: 'elemental', color: 'var(--magic-metal)',
                 description: 'Control over refined metals and alloys' },
        wood:  { id: 'wood',  label: 'Wood',  category: 'elemental', color: 'var(--magic-wood)',
                 description: 'Control over wood, plants, and growth' },

        // Body
        blood:   { id: 'blood',   label: 'Blood',   category: 'body', color: 'var(--magic-blood)',
                   description: 'Control over blood, circulation, and vitality' },
        bone:    { id: 'bone',    label: 'Bone',    category: 'body', color: 'var(--magic-bone)',
                   description: 'Control over bone, structure, and skeleton' },
        mind:    { id: 'mind',    label: 'Mind',    category: 'body', color: 'var(--magic-mind)',
                   description: 'Control over thoughts, memory, and consciousness' },
        morphic: { id: 'morphic', label: 'Morphic', category: 'body', color: 'var(--magic-morphic)',
                   description: 'Control over shape, form, and transformation' },
        life:    { id: 'life',    label: 'Life',    category: 'body', color: 'var(--magic-life)',
                   description: 'Control over growth, healing, and vitality' },
        death:   { id: 'death',   label: 'Death',   category: 'body', color: 'var(--magic-death)',
                   description: 'Control over decay, entropy, and mortality' },

        // Aether
        space:        { id: 'space',        label: 'Space',        category: 'aether', color: 'var(--magic-space)',
                        description: 'Control over distance, position, and dimensions' },
        time:         { id: 'time',         label: 'Time',         category: 'aether', color: 'var(--magic-time)',
                        description: 'Control over temporal flow and causality' },
        dimension:    { id: 'dimension',    label: 'Dimension',    category: 'aether', color: 'var(--magic-dimension)',
                        description: 'Control over alternate realities and planes' },
        void:         { id: 'void',         label: 'Void',         category: 'aether', color: 'var(--magic-void)',
                        description: 'Control over nothingness and absence' },
        reality:      { id: 'reality',      label: 'Reality',      category: 'aether', color: 'var(--magic-reality)',
                        description: 'Control over fundamental existence' },
        transference: { id: 'transference', label: 'Transference', category: 'aether', color: 'var(--magic-transference)',
                        description: 'Control over energy, matter, and essence transfer' }
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

    // Deterministic order for tiebreaks (elemental → body → aether)
    var MAGIC_CATEGORY_ORDER = ['elemental', 'body', 'aether'];

    // ============================================================
    // BROAD MAGICAL CLASSES (3)
    // ============================================================

    var MAGIC_BROAD_CLASSES = [
        {
            id: 'elementalist',
            label: 'Elementalist',
            category: 'elemental',
            description: 'Master of the natural elements'
        },
        {
            id: 'biomancer',
            label: 'Biomancer',
            category: 'body',
            description: 'Master of flesh, life, and death'
        },
        {
            id: 'occultist',
            label: 'Occultist',
            category: 'aether',
            description: 'Master of the veils of reality'
        }
    ];

    // ============================================================
    // FINE MAGICAL CLASSES (18)
    // ============================================================

    var MAGIC_FINE_CLASSES = {
        // Elemental
        earth: { id: 'geomancer',      label: 'Geomancer',      type: 'earth' },
        water: { id: 'hydromancer',    label: 'Hydromancer',    type: 'water' },
        fire:  { id: 'pyromancer',     label: 'Pyromancer',     type: 'fire' },
        air:   { id: 'aeromancer',     label: 'Aeromancer',     type: 'air' },
        metal: { id: 'metallurgist',   label: 'Metallurgist',   type: 'metal' },
        wood:  { id: 'dendromancer',   label: 'Dendromancer',   type: 'wood' },

        // Body
        blood:   { id: 'hemomancer',   label: 'Hemomancer',     type: 'blood' },
        bone:    { id: 'osteomancer',  label: 'Osteomancer',    type: 'bone' },
        mind:    { id: 'mentalist',    label: 'Mentalist',      type: 'mind' },
        morphic: { id: 'shaper',       label: 'Shaper',         type: 'morphic' },
        life:    { id: 'vitalist',     label: 'Vitalist',       type: 'life' },
        death:   { id: 'necromancer',  label: 'Necromancer',    type: 'death' },

        // Aether
        space:        { id: 'spatiomancer',   label: 'Spatiomancer',   type: 'space' },
        time:         { id: 'chronomancer',   label: 'Chronomancer',   type: 'time' },
        dimension:    { id: 'dimensionalist', label: 'Dimensionalist', type: 'dimension' },
        void:         { id: 'voidcaller',     label: 'Voidcaller',     type: 'void' },
        reality:      { id: 'reality_shaper', label: 'Reality Shaper', type: 'reality' },
        transference: { id: 'transmuter',     label: 'Transmuter',     type: 'transference' }
    };

    // ============================================================
    // MAGIC CONFIGURATION
    // ============================================================

    var MAGIC_MAX = 10;
    var BALANCED_MAGE_THRESHOLD = 3;
    var MAGIC_FINE_CLASS_MIN = 3;

    var MAGIC_CATEGORY_MULTIPLIERS = {
        'elemental': 1.0,
        'body': 1.2,
        'aether': 1.5
    };

    // ============================================================
    // PROFICIENCY LEVELS
    // ============================================================

    var MAGIC_PROFICIENCY_LEVELS = [
        { id: 'master',     label: 'Master',     min: 9, max: 10 },
        { id: 'expert',     label: 'Expert',     min: 7, max: 8  },
        { id: 'adept',      label: 'Adept',      min: 5, max: 6  },
        { id: 'apprentice', label: 'Apprentice', min: 3, max: 4  },
        { id: 'novice',     label: 'Novice',     min: 1, max: 2  },
        { id: 'untrained',  label: 'Untrained',  min: 0, max: 0  }
    ];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    var MAGIC_TYPE_KEYS = Object.keys(MAGIC_TYPES);

    var _typeMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeMap[key] = MAGIC_TYPES[key];
    });

    var _categoryMap = Object.create(null);
    var categoryKeys = Object.keys(MAGIC_CATEGORIES);
    categoryKeys.forEach(function(key) {
        _categoryMap[key] = MAGIC_CATEGORIES[key];
    });

    var _typeCategoryMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeCategoryMap[key] = MAGIC_TYPES[key].category;
    });

    var _typeLabelMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeLabelMap[key] = MAGIC_TYPES[key].label;
    });

    var _typeColorMap = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(key) {
        _typeColorMap[key] = MAGIC_TYPES[key].color;
    });

    var _broadClassByCategory = Object.create(null);
    MAGIC_BROAD_CLASSES.forEach(function(cls) {
        _broadClassByCategory[cls.category] = cls;
    });

    var _fineClassByType = Object.create(null);
    MAGIC_TYPE_KEYS.forEach(function(typeKey) {
        if (MAGIC_FINE_CLASSES[typeKey]) {
            _fineClassByType[typeKey] = MAGIC_FINE_CLASSES[typeKey];
        }
    });

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    function getTypeKeys() { return MAGIC_TYPE_KEYS.slice(); }

    function getType(key) {
        if (!key || typeof key !== 'string') { return null; }
        return _typeMap[key] || null;
    }

    function getTypeLabel(key) {
        if (!key || typeof key !== 'string') { return ''; }
        return _typeLabelMap[key] || key;
    }

    /**
     * Get the color for a magic type.
     *
     * Returns a CSS custom property reference (e.g. "var(--magic-fire)")
     * for known types. Returns a var() for the "other" fallback when
     * the key is unknown, so a caller can drop the result straight
     * into an inline style without a broken value.
     */
    function getTypeColor(key) {
        if (!key || typeof key !== 'string') { return 'var(--text-dim)'; }
        return _typeColorMap[key] || 'var(--text-dim)';
    }

    function getTypeCategory(key) {
        if (!key || typeof key !== 'string') { return null; }
        return _typeCategoryMap[key] || null;
    }

    function getCategories() { return Object.assign({}, MAGIC_CATEGORIES); }

    function getCategory(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') { return null; }
        return _categoryMap[categoryId] || null;
    }

    function getCategoryLabel(categoryId) {
        var category = getCategory(categoryId);
        return category ? category.label : (categoryId || '');
    }

    function getCategoryTypes(categoryId) {
        var category = getCategory(categoryId);
        return category ? category.types.slice() : [];
    }

    function getCategoryMultiplier(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') { return 1.0; }
        return MAGIC_CATEGORY_MULTIPLIERS[categoryId] || 1.0;
    }

    function getCategoryOrder() {
        return MAGIC_CATEGORY_ORDER.slice();
    }

    // ============================================================
    // CLASS LOOKUP
    // ============================================================

    function getBroadClasses() { return MAGIC_BROAD_CLASSES.slice(); }

    function getBroadClass(classId) {
        if (!classId || typeof classId !== 'string') { return null; }
        for (var i = 0; i < MAGIC_BROAD_CLASSES.length; i++) {
            if (MAGIC_BROAD_CLASSES[i].id === classId) {
                return MAGIC_BROAD_CLASSES[i];
            }
        }
        return null;
    }

    function getBroadClassForCategory(categoryId) {
        if (!categoryId || typeof categoryId !== 'string') { return null; }
        return _broadClassByCategory[categoryId] || null;
    }

    function getFineClasses() {
        var result = [];
        MAGIC_TYPE_KEYS.forEach(function(typeKey) {
            if (MAGIC_FINE_CLASSES[typeKey]) {
                result.push(MAGIC_FINE_CLASSES[typeKey]);
            }
        });
        return result;
    }

    function getFineClass(classId) {
        if (!classId || typeof classId !== 'string') { return null; }
        for (var i = 0; i < MAGIC_TYPE_KEYS.length; i++) {
            var typeKey = MAGIC_TYPE_KEYS[i];
            var fine = MAGIC_FINE_CLASSES[typeKey];
            if (fine && fine.id === classId) {
                return fine;
            }
        }
        return null;
    }

    function getFineClassForType(typeKey) {
        if (!typeKey || typeof typeKey !== 'string') { return null; }
        return _fineClassByType[typeKey] || null;
    }

    // ============================================================
    // PROFICIENCY LEVEL
    // ============================================================

    function getProficiencyLevel(value) {
        var num = Number(value);
        if (isNaN(num) || num < 0) { num = 0; }
        if (num > MAGIC_MAX) { num = MAGIC_MAX; }

        for (var i = 0; i < MAGIC_PROFICIENCY_LEVELS.length; i++) {
            var level = MAGIC_PROFICIENCY_LEVELS[i];
            if (num >= level.min && num <= level.max) {
                return level;
            }
        }
        return MAGIC_PROFICIENCY_LEVELS[MAGIC_PROFICIENCY_LEVELS.length - 1];
    }

    function getProficiencyLevelLabel(value) {
        return getProficiencyLevel(value).label;
    }

    function getProficiencyLevels() {
        return MAGIC_PROFICIENCY_LEVELS.slice();
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (!MAGIC_TYPES || typeof MAGIC_TYPES !== 'object') {
            errors.push('MAGIC_TYPES is missing or invalid.');
        }

        if (!MAGIC_TYPE_KEYS || !Array.isArray(MAGIC_TYPE_KEYS) || MAGIC_TYPE_KEYS.length === 0) {
            errors.push('MAGIC_TYPE_KEYS is missing or empty.');
        }

        MAGIC_TYPE_KEYS.forEach(function(key) {
            var type = MAGIC_TYPES[key];
            if (!type) {
                errors.push('Magic type "' + key + '" has no definition.');
                return;
            }
            if (type.id !== key) {
                errors.push('Magic type "' + key + '" has mismatched id.');
            }
            if (!type.label || typeof type.label !== 'string') {
                errors.push('Magic type "' + key + '" missing label.');
            }
            if (!type.category || typeof type.category !== 'string') {
                errors.push('Magic type "' + key + '" missing category.');
            }
            // Color must be a var() reference now, not a hex literal.
            if (typeof type.color !== 'string' ||
                type.color.indexOf('var(--') !== 0) {
                errors.push(
                    'Magic type "' + key + '" color must be a CSS ' +
                    'custom property reference (e.g. "var(--magic-' + key + ')"); ' +
                    'got "' + type.color + '".'
                );
            }
        });

        if (!MAGIC_CATEGORIES || typeof MAGIC_CATEGORIES !== 'object') {
            errors.push('MAGIC_CATEGORIES is missing or invalid.');
        }

        var categoryKeysLocal = Object.keys(MAGIC_CATEGORIES);
        if (categoryKeysLocal.length === 0) {
            errors.push('MAGIC_CATEGORIES is empty.');
        }

        categoryKeysLocal.forEach(function(key) {
            var cat = MAGIC_CATEGORIES[key];
            if (!cat) {
                errors.push('Category "' + key + '" has no definition.');
                return;
            }
            if (cat.id !== key) {
                errors.push('Category "' + key + '" has mismatched id.');
            }
            if (!Array.isArray(cat.types)) {
                errors.push('Category "' + key + '" missing types array.');
            }
        });

        if (!Array.isArray(MAGIC_BROAD_CLASSES) || MAGIC_BROAD_CLASSES.length !== 3) {
            errors.push('MAGIC_BROAD_CLASSES must contain exactly 3 entries.');
        }

        MAGIC_BROAD_CLASSES.forEach(function(cls) {
            if (!cls.id || typeof cls.id !== 'string') {
                errors.push('Broad class missing id.');
            }
            if (!cls.label || typeof cls.label !== 'string') {
                errors.push('Broad class "' + cls.id + '" missing label.');
            }
            if (!cls.category || typeof cls.category !== 'string') {
                errors.push('Broad class "' + cls.id + '" missing category.');
            } else if (!MAGIC_CATEGORIES[cls.category]) {
                errors.push('Broad class "' + cls.id + '" references unknown category "' + cls.category + '".');
            }
        });

        MAGIC_TYPE_KEYS.forEach(function(typeKey) {
            if (!MAGIC_FINE_CLASSES[typeKey]) {
                errors.push('Fine class missing for type "' + typeKey + '".');
                return;
            }
            var fine = MAGIC_FINE_CLASSES[typeKey];
            if (!fine.id || typeof fine.id !== 'string') {
                errors.push('Fine class for "' + typeKey + '" missing id.');
            }
            if (!fine.label || typeof fine.label !== 'string') {
                errors.push('Fine class for "' + typeKey + '" missing label.');
            }
            if (fine.type !== typeKey) {
                errors.push('Fine class "' + fine.id + '" has mismatched type (expected "' + typeKey + '").');
            }
        });

        categoryKeysLocal.forEach(function(key) {
            if (MAGIC_CATEGORY_MULTIPLIERS[key] === undefined) {
                errors.push('MAGIC_CATEGORY_MULTIPLIERS missing key "' + key + '".');
            } else if (typeof MAGIC_CATEGORY_MULTIPLIERS[key] !== 'number' || MAGIC_CATEGORY_MULTIPLIERS[key] <= 0) {
                errors.push('MAGIC_CATEGORY_MULTIPLIERS["' + key + '"] must be positive.');
            }
        });

        if (!Array.isArray(MAGIC_PROFICIENCY_LEVELS) || MAGIC_PROFICIENCY_LEVELS.length === 0) {
            errors.push('MAGIC_PROFICIENCY_LEVELS must be a non-empty array.');
        }

        var covered = new Array(MAGIC_MAX + 1).fill(0);
        MAGIC_PROFICIENCY_LEVELS.forEach(function(level) {
            for (var v = level.min; v <= level.max; v++) {
                if (v < 0 || v > MAGIC_MAX) {
                    errors.push('Proficiency level "' + level.id + '" covers out-of-range value ' + v + '.');
                    continue;
                }
                covered[v]++;
            }
        });
        for (var vv = 0; vv <= MAGIC_MAX; vv++) {
            if (covered[vv] === 0) {
                errors.push('Proficiency value ' + vv + ' not covered by any level.');
            } else if (covered[vv] > 1) {
                errors.push('Proficiency value ' + vv + ' covered by multiple levels.');
            }
        }

        if (typeof MAGIC_MAX !== 'number' || MAGIC_MAX < 0) {
            errors.push('MAGIC_MAX must be a non-negative number.');
        }
        if (typeof BALANCED_MAGE_THRESHOLD !== 'number' || BALANCED_MAGE_THRESHOLD < 0) {
            errors.push('BALANCED_MAGE_THRESHOLD must be a non-negative number.');
        }
        if (typeof MAGIC_FINE_CLASS_MIN !== 'number' || MAGIC_FINE_CLASS_MIN < 0) {
            errors.push('MAGIC_FINE_CLASS_MIN must be a non-negative number.');
        }

        if (errors.length > 0) {
            throw new Error('MagicConstants validation failed:\n  ' + errors.join('\n  '));
        }

        return true;
    }

    try {
        validateConstants();
    } catch (e) {
        console.error('[MagicConstants] Validation failed:', e.message);
        throw e;
    }

    // ============================================================
    // FREEZE
    // ============================================================

    deepFreeze(MAGIC_TYPES);
    deepFreeze(MAGIC_CATEGORIES);
    deepFreeze(MAGIC_TYPE_KEYS);
    deepFreeze(MAGIC_CATEGORY_ORDER);
    deepFreeze(MAGIC_BROAD_CLASSES);
    deepFreeze(MAGIC_FINE_CLASSES);
    deepFreeze(MAGIC_CATEGORY_MULTIPLIERS);
    deepFreeze(MAGIC_PROFICIENCY_LEVELS);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MagicConstants = Object.freeze({
        // Raw definitions
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,
        MAGIC_TYPE_KEYS: MAGIC_TYPE_KEYS,
        MAGIC_CATEGORY_ORDER: MAGIC_CATEGORY_ORDER,
        MAGIC_BROAD_CLASSES: MAGIC_BROAD_CLASSES,
        MAGIC_FINE_CLASSES: MAGIC_FINE_CLASSES,
        MAGIC_PROFICIENCY_LEVELS: MAGIC_PROFICIENCY_LEVELS,

        // Configuration
        MAGIC_MAX: MAGIC_MAX,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,
        MAGIC_FINE_CLASS_MIN: MAGIC_FINE_CLASS_MIN,
        MAGIC_CATEGORY_MULTIPLIERS: MAGIC_CATEGORY_MULTIPLIERS,

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
        getCategoryMultiplier: getCategoryMultiplier,
        getCategoryOrder: getCategoryOrder,

        // Broad class lookup
        getBroadClasses: getBroadClasses,
        getBroadClass: getBroadClass,
        getBroadClassForCategory: getBroadClassForCategory,

        // Fine class lookup
        getFineClasses: getFineClasses,
        getFineClass: getFineClass,
        getFineClassForType: getFineClassForType,

        // Proficiency level
        getProficiencyLevel: getProficiencyLevel,
        getProficiencyLevelLabel: getProficiencyLevelLabel,
        getProficiencyLevels: getProficiencyLevels,

        // Validation
        validateConstants: validateConstants
    });



})();
