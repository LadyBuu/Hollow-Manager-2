/**
 * modules/shared/social-constants.js - Social Constants
 * Single source of truth for all social/relationship constants
 * Path: js/modules/social/social-constants.js
 *
 * This module provides:
 *   - Relationship type definitions (id, label, color, directionality)
 *   - Relationship type lookup functions
 *   - Relationship type validation
 *   - Default relationship types (for bootstrapping)
 *
 * COLOR TOKENS:
 *   Each relationship type carries a CSS custom property REFERENCE
 *   as its `color` field — a string of the form
 *   "var(--relationship-<id>)". The actual color values are declared
 *   in css/shared.css, with separate values for dark and light mode.
 *   Consumers that read getColor(typeId) get a var() string and can
 *   drop it straight into an inline style or SVG presentation
 *   attribute.
 *
 *   Do NOT reintroduce hex literals here. If a new relationship type
 *   is added, add its token to css/shared.css in both :root and
 *   [data-theme="light"] and reference it by name.
 *
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for relationship types
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Directional relationships have character1 → character2 semantics
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - No DOM, no state, no persistence - pure constants only
 *
 * RELATIONSHIP SEMANTICS:
 *   - Directional relationships (mentor): character1 is the source,
 *     character2 is the target
 *   - Undirected relationships: order of characters doesn't matter
 *   - Clarification field provides context ("aunt", "boss", "sibling")
 *
 * DEPENDENCIES:
 *   - None (self-contained)
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
     *   - color: CSS custom property reference (var(--relationship-<id>))
     *   - directional: If true, relationship has direction
     *                  (character1 → character2)
     *   - description: Optional description of the relationship type
     *
     * Directional relationships:
     *   - mentor: character1 mentors character2
     *
     * Undirected relationships:
     *   - familial, professional, romantic, friendship, rivalry,
     *     alliance, other
     */
    var RELATIONSHIP_TYPES = [
        {
            id: 'familial',
            label: 'Familial',
            color: 'var(--relationship-familial)',
            directional: false,
            description: 'Family members and relatives'
        },
        {
            id: 'professional',
            label: 'Professional',
            color: 'var(--relationship-professional)',
            directional: false,
            description: 'Work or professional connections'
        },
        {
            id: 'romantic',
            label: 'Romantic',
            color: 'var(--relationship-romantic)',
            directional: false,
            description: 'Romantic or intimate partners'
        },
        {
            id: 'friendship',
            label: 'Friendship',
            color: 'var(--relationship-friendship)',
            directional: false,
            description: 'Friends and close companions'
        },
        {
            id: 'mentor',
            label: 'Mentor',
            color: 'var(--relationship-mentor)',
            directional: true,
            description: 'Mentor/mentee relationship (direction: mentor → mentee)'
        },
        {
            id: 'rivalry',
            label: 'Rivalry',
            color: 'var(--relationship-rivalry)',
            directional: false,
            description: 'Competitive or adversarial relationship'
        },
        {
            id: 'alliance',
            label: 'Alliance',
            color: 'var(--relationship-alliance)',
            directional: false,
            description: 'Strategic or cooperative alliance'
        },
        {
            id: 'other',
            label: 'Other',
            color: 'var(--relationship-other)',
            directional: false,
            description: 'Custom or unspecified relationship'
        }
    ];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    var _typeMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _typeMap[type.id] = type;
    });

    var VALID_TYPE_IDS = RELATIONSHIP_TYPES.map(function(type) {
        return type.id;
    });

    var _colorMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _colorMap[type.id] = type.color;
    });

    var _labelMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _labelMap[type.id] = type.label;
    });

    var _directionalMap = Object.create(null);
    RELATIONSHIP_TYPES.forEach(function(type) {
        _directionalMap[type.id] = type.directional === true;
    });

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    function getRelationshipTypes() {
        return RELATIONSHIP_TYPES.slice();
    }

    function getRelationshipType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return null;
        }
        return _typeMap[typeId] || null;
    }

    function getLabel(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return 'Other';
        }
        return _labelMap[typeId] || typeId;
    }

    /**
     * Get the color for a relationship type.
     *
     * Returns a CSS custom property reference (e.g.
     * "var(--relationship-friendship)") for known types. Returns
     * var(--relationship-other) for an unknown type, so a caller
     * can drop the result straight into an inline style or SVG
     * attribute without a broken value.
     */
    function getColor(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return 'var(--relationship-other)';
        }
        return _colorMap[typeId] || 'var(--relationship-other)';
    }

    function isDirectional(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        return _directionalMap[typeId] === true;
    }

    function isValidType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        return _typeMap[typeId] !== undefined;
    }

    function getValidTypeIds() {
        return VALID_TYPE_IDS.slice();
    }

    function getDirectionalTypes() {
        return RELATIONSHIP_TYPES.filter(function(type) {
            return type.directional === true;
        });
    }

    function getUndirectedTypes() {
        return RELATIONSHIP_TYPES.filter(function(type) {
            return type.directional !== true;
        });
    }

    function getDefaultType() {
        return _typeMap['other'] || RELATIONSHIP_TYPES[0];
    }

    function getDefaultTypeId() {
        var defaultType = getDefaultType();
        return defaultType ? defaultType.id : 'other';
    }

    function getSafeColor(typeId) {
        return getColor(typeId);
    }

    function getDefaultColor() {
        return 'var(--relationship-other)';
    }

    // ============================================================
    // VALIDATION
    // ============================================================

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

            // Color must be a var() reference now, not a hex literal.
            if (typeof type.color !== 'string' ||
                type.color.indexOf('var(--') !== 0) {
                errors.push(
                    prefix + ' color must be a CSS custom property ' +
                    'reference (e.g. "var(--relationship-' + type.id + ')"); ' +
                    'got "' + type.color + '".'
                );
            }

            if (typeof type.directional !== 'boolean') {
                errors.push(prefix + ' Directional must be a boolean for "' + type.id + '".');
            }

            if (type.description !== undefined && typeof type.description !== 'string') {
                errors.push(prefix + ' Description must be a string for "' + type.id + '".');
            }
        });

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

    try {
        validateConstants();
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
        DEFAULT_COLOR: 'var(--relationship-other)',

        // Validation
        validateConstants: validateConstants
    });

})();
