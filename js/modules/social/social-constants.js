/**
 * modules/social/social-constants.js - Social Constants
 * Single source of truth for all social/relationship constants
 * Path: js/modules/social/social-constants.js
 * 
 * This module provides:
 *   - Relationship type definitions (id, label, color, directionality)
 *   - Relationship type lookup functions
 *   - Relationship type validation
 *   - Default relationship types (for bootstrapping)
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for relationship types
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Colors are trusted application configuration (not user input)
 *   - Directional relationships have character1 → character2 semantics
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - No DOM, no state, no persistence - pure constants only
 * 
 * RELATIONSHIP SEMANTICS:
 *   - Directional relationships (mentor): character1 is the source, character2 is the target
 *   - Undirected relationships: order of characters doesn't matter
 *   - Clarification field provides context (e.g., "aunt", "boss", "sibling")
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var SC = window.SocialConstants;
 *   var types = SC.getRelationshipTypes();
 *   var isDirectional = SC.isDirectional('mentor');
 *   var color = SC.getColor('friendship');
 *   var valid = SC.isValidType('romantic');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialConstantsLoaded) {
        return;
    }
    window.__socialConstantsLoaded = true;

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
    // RELATIONSHIP TYPE DEFINITIONS - CANONICAL SOURCE OF TRUTH
    // ============================================================

    /**
     * Canonical relationship type definitions.
     * 
     * Properties:
     *   - id: Unique identifier (used in data storage)
     *   - label: Human-readable display name
     *   - color: CSS color value (trusted application configuration)
     *   - directional: If true, relationship has direction (character1 → character2)
     *   - description: Optional description of the relationship type
     * 
     * Directional relationships:
     *   - mentor: character1 mentors character2
     * 
     * Undirected relationships:
     *   - familial: Family connection
     *   - professional: Work/professional connection
     *   - romantic: Romantic/partnership connection
     *   - friendship: Friendship connection
     *   - rivalry: Competitive/adversarial connection
     *   - alliance: Strategic/cooperative connection
     *   - other: Catch-all for custom relationships
     */
    var RELATIONSHIP_TYPES = [
        {
            id: 'familial',
            label: 'Familial',
            color: '#8cbb3a',
            directional: false,
            description: 'Family members and relatives'
        },
        {
            id: 'professional',
            label: 'Professional',
            color: '#c9a24b',
            directional: false,
            description: 'Work or professional connections'
        },
        {
            id: 'romantic',
            label: 'Romantic',
            color: '#c1453c',
            directional: false,
            description: 'Romantic or intimate partners'
        },
        {
            id: 'friendship',
            label: 'Friendship',
            color: '#4a9bc7',
            directional: false,
            description: 'Friends and close companions'
        },
        {
            id: 'mentor',
            label: 'Mentor',
            color: '#9b59b6',
            directional: true,
            description: 'Mentor/mentee relationship (direction: mentor → mentee)'
        },
        {
            id: 'rivalry',
            label: 'Rivalry',
            color: '#e67e22',
            directional: false,
            description: 'Competitive or adversarial relationship'
        },
        {
            id: 'alliance',
            label: 'Alliance',
            color: '#27ae60',
            directional: false,
            description: 'Strategic or cooperative alliance'
        },
        {
            id: 'other',
            label: 'Other',
            color: '#7f8c8d',
            directional: false,
            description: 'Custom or unspecified relationship'
        }
    ];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    // Map of type ID to type definition
    var _typeMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _typeMap[type.id] = type;
    });

    // Array of valid type IDs
    var VALID_TYPE_IDS = RELATIONSHIP_TYPES.map(function(type) {
        return type.id;
    });

    // Map of type ID to color
    var _colorMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _colorMap[type.id] = type.color;
    });

    // Map of type ID to label
    var _labelMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _labelMap[type.id] = type.label;
    });

    // Map of type ID to directionality
    var _directionalMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _directionalMap[type.id] = type.directional === true;
    });

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    /**
     * Get all relationship type definitions.
     * 
     * @returns {Array} Array of relationship type objects
     */
    function getRelationshipTypes() {
        return RELATIONSHIP_TYPES.slice();
    }

    /**
     * Get a relationship type definition by ID.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {object|null} Type definition or null if not found
     */
    function getRelationshipType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return null;
        }
        return _typeMap[typeId] || null;
    }

    /**
     * Get the label for a relationship type.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {string} Label or the type ID if not found
     */
    function getLabel(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return 'Other';
        }
        return _labelMap[typeId] || typeId;
    }

    /**
     * Get the colour for a relationship type.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {string} CSS color value or default '#7f8c8d'
     */
    function getColor(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return '#7f8c8d';
        }
        return _colorMap[typeId] || '#7f8c8d';
    }

    /**
     * Check if a relationship type is directional.
     * Directional means character1 → character2 (source → target).
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {boolean} True if directional
     */
    function isDirectional(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        return _directionalMap[typeId] === true;
    }

    /**
     * Check if a relationship type ID is valid.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {boolean} True if valid
     */
    function isValidType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        return _typeMap[typeId] !== undefined;
    }

    /**
     * Get all valid relationship type IDs.
     * 
     * @returns {string[]} Array of valid type IDs
     */
    function getValidTypeIds() {
        return VALID_TYPE_IDS.slice();
    }

    /**
     * Get only directional relationship types.
     * 
     * @returns {Array} Array of directional type definitions
     */
    function getDirectionalTypes() {
        return RELATIONSHIP_TYPES.filter(function(type) {
            return type.directional === true;
        });
    }

    /**
     * Get only undirected relationship types.
     * 
     * @returns {Array} Array of undirected type definitions
     */
    function getUndirectedTypes() {
        return RELATIONSHIP_TYPES.filter(function(type) {
            return type.directional !== true;
        });
    }

    /**
     * Get the default relationship type (used for new relationships).
     * 
     * @returns {object} Default relationship type definition
     */
    function getDefaultType() {
        return _typeMap['other'] || RELATIONSHIP_TYPES[0];
    }

    /**
     * Get the default relationship type ID.
     * 
     * @returns {string} Default relationship type ID
     */
    function getDefaultTypeId() {
        var defaultType = getDefaultType();
        return defaultType ? defaultType.id : 'other';
    }

    /**
     * Get a safe colour for a relationship type.
     * Always returns a valid colour even if the type ID is invalid.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {string} Safe CSS color value
     */
    function getSafeColor(typeId) {
        return getColor(typeId);
    }

    /**
     * Get default colour for unknown types.
     * 
     * @returns {string} Default CSS color value
     */
    function getDefaultColor() {
        return '#7f8c8d';
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate the relationship type definitions.
     * 
     * Invariants:
     *   - All types must have id, label, color
     *   - IDs must be unique
     *   - Colors must be valid CSS color values (basic check)
     * 
     * @returns {boolean} True if validation passes
     * @throws {Error} If validation fails
     */
    function validateConstants() {
        var errors = [];

        if (!Array.isArray(RELATIONSHIP_TYPES) || RELATIONSHIP_TYPES.length === 0) {
            errors.push('RELATIONSHIP_TYPES must be a non-empty array.');
        }

        var ids = Object.create(null);

        RELATIONSHIP_TYPES.forEach(function(type, index) {
            var prefix = 'Type at index ' + index + ':';

            if (!type.id || typeof type.id !== 'string') {
                errors.push(prefix + ' Missing or invalid id.');
                return;
            }

            if (ids[type.id]) {
                errors.push(prefix + ' Duplicate id "' + type.id + '".');
            }
            ids[type.id] = true;

            if (!type.label || typeof type.label !== 'string') {
                errors.push(prefix + ' Missing or invalid label for "' + type.id + '".');
            }

            if (typeof type.color !== 'string' || !type.color) {
                errors.push(prefix + ' Missing or invalid color for "' + type.id + '".');
            } else {
                // Basic color validation (hex, rgb, rgba, hsl, hsla)
                var color = type.color;
                var isValid = false;

                if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
                    isValid = true;
                } else if (/^rgb(a)?\([\d\s.,%]+\)$/.test(color)) {
                    isValid = true;
                } else if (/^hsl(a)?\([\d\s.,%]+\)$/.test(color)) {
                    isValid = true;
                }

                if (!isValid) {
                    errors.push(prefix + ' Invalid CSS color value "' + color + '" for "' + type.id + '".');
                }
            }

            if (typeof type.directional !== 'boolean') {
                errors.push(prefix + ' Directional must be a boolean for "' + type.id + '".');
            }

            // Description is optional
            if (type.description !== undefined && typeof type.description !== 'string') {
                errors.push(prefix + ' Description must be a string for "' + type.id + '".');
            }
        });

        // Check derived maps are consistent
        var typeKeys = Object.keys(_typeMap);
        var labelKeys = Object.keys(_labelMap);
        var colorKeys = Object.keys(_colorMap);
        var directionalKeys = Object.keys(_directionalMap);

        if (typeKeys.length !== RELATIONSHIP_TYPES.length) {
            errors.push('Type map size does not match RELATIONSHIP_TYPES length.');
        }

        if (labelKeys.length !== RELATIONSHIP_TYPES.length) {
            errors.push('Label map size does not match RELATIONSHIP_TYPES length.');
        }

        if (colorKeys.length !== RELATIONSHIP_TYPES.length) {
            errors.push('Color map size does not match RELATIONSHIP_TYPES length.');
        }

        if (directionalKeys.length !== RELATIONSHIP_TYPES.length) {
            errors.push('Directional map size does not match RELATIONSHIP_TYPES length.');
        }

        if (errors.length > 0) {
            throw new Error('SocialConstants validation failed:\n  ' + errors.join('\n  '));
        }

        return true;
    }

    // ============================================================
    // VALIDATE BEFORE PUBLISHING
    // ============================================================

    try {
        validateConstants();
        console.log('[SocialConstants] Validation passed successfully.');
    } catch (e) {
        console.error('[SocialConstants] Validation failed:', e.message);
        throw e;
    }

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(RELATIONSHIP_TYPES);
    deepFreeze(_typeMap);
    deepFreeze(VALID_TYPE_IDS);
    deepFreeze(_colorMap);
    deepFreeze(_labelMap);
    deepFreeze(_directionalMap);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialConstants = Object.freeze({
        // Raw definitions (read-only)
        RELATIONSHIP_TYPES: RELATIONSHIP_TYPES,

        // Lookup functions
        getRelationshipTypes: getRelationshipTypes,
        getRelationshipType: getRelationshipType,
        getLabel: getLabel,
        getColor: getColor,
        getSafeColor: getSafeColor,
        isDirectional: isDirectional,
        isValidType: isValidType,
        getValidTypeIds: getValidTypeIds,

        // Filtered lists
        getDirectionalTypes: getDirectionalTypes,
        getUndirectedTypes: getUndirectedTypes,

        // Defaults
        getDefaultType: getDefaultType,
        getDefaultTypeId: getDefaultTypeId,
        getDefaultColor: getDefaultColor,

        // Constants
        DEFAULT_COLOR: '#7f8c8d',

        // Validation
        validateConstants: validateConstants
    });

})();