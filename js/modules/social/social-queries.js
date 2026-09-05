/**
 * modules/social/social-queries.js - Social Queries
 * Read-only queries for the social/relationship domain
 * Path: js/modules/social/social-queries.js
 * 
 * This module provides:
 *   - Relationship lookup by ID
 *   - Character relationship queries
 *   - Relationship existence checks
 *   - Connected character queries
 *   - Relationship type queries (delegated to SocialConstants)
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - No DOM manipulation
 *   - No persistence
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for character data
 *   - Returns LIVE REFERENCES to relationships - do not mutate
 *   - No window.data fallbacks - data structure must exist
 * 
 * DEPENDENCIES:
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.data (must exist and have social.relationships)
 * 
 * USAGE:
 *   var SQ = window.SocialQueries;
 *   var rels = SQ.getCharacterRelationships(charId);
 *   var exists = SQ.relationshipExists(charId1, charId2, 'friendship');
 *   var connected = SQ.getConnectedCharacters(charId);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialQueriesLoaded) {
        return;
    }
    window.__socialQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialConstants = window.SocialConstants;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialConstants || typeof SocialConstants.getRelationshipType !== 'function') {
            missing.push('SocialConstants.getRelationshipType');
        }
        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            missing.push('SocialConstants.isDirectional');
        }
        if (!SocialConstants || typeof SocialConstants.getLabel !== 'function') {
            missing.push('SocialConstants.getLabel');
        }
        if (!SocialConstants || typeof SocialConstants.getColor !== 'function') {
            missing.push('SocialConstants.getColor');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (missing.length > 0) {
            console.warn('[SocialQueries] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // DATA ACCESS - Canonical source
    // ============================================================

    /**
     * Get the canonical social data from window.data.
     * Assumes data.social.relationships exists (guaranteed by database/schema).
     * 
     * @returns {object} Social data object with relationships array
     */
    function getSocialData() {
        // window.data must exist - no fallback
        return window.data.social;
    }

    /**
     * Get all relationships from the data store.
     * 
     * @returns {Array} Array of relationship objects
     */
    function getAllRelationships() {
        var social = getSocialData();
        return social.relationships || [];
    }

    // ============================================================
    // RELATIONSHIP LOOKUP
    // ============================================================

    /**
     * Get a relationship by ID.
     * 
     * @param {string|number} id - Relationship ID
     * @returns {object|null} Relationship object or null
     */
    function getRelationshipById(id) {
        if (id === undefined || id === null) {
            return null;
        }

        var target = String(id);
        var relationships = getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (rel && String(rel.id) === target) {
                return rel;
            }
        }

        return null;
    }

    /**
     * Get all relationships involving a character.
     * 
     * @param {string} charId - Character ID
     * @returns {Array} Array of relationship objects
     */
    function getCharacterRelationships(charId) {
        if (!charId) {
            return [];
        }

        var target = String(charId);
        var relationships = getAllRelationships();
        var result = [];

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (rel && (String(rel.character1) === target || String(rel.character2) === target)) {
                result.push(rel);
            }
        }

        return result;
    }

    /**
     * Get all relationships between two characters regardless of direction.
     * For directional relationships, this returns both A→B and B→A if both exist.
     * 
     * @param {string} charId1 - First character ID
     * @param {string} charId2 - Second character ID
     * @returns {Array} Array of relationship objects
     */
    function getAllRelationshipsBetween(charId1, charId2) {
        if (!charId1 || !charId2) {
            return [];
        }

        var c1 = String(charId1);
        var c2 = String(charId2);
        var relationships = getAllRelationships();
        var result = [];

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) continue;

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if ((r1 === c1 && r2 === c2) || (r1 === c2 && r2 === c1)) {
                result.push(rel);
            }
        }

        return result;
    }

    /**
     * Get relationships of a specific type for a character.
     * 
     * @param {string} charId - Character ID
     * @param {string} typeId - Relationship type ID
     * @returns {Array} Array of relationship objects
     */
    function getCharacterRelationshipsOfType(charId, typeId) {
        if (!charId || !typeId) {
            return [];
        }

        var rels = getCharacterRelationships(charId);
        var result = [];

        for (var i = 0; i < rels.length; i++) {
            if (rels[i] && rels[i].typeId === typeId) {
                result.push(rels[i]);
            }
        }

        return result;
    }

    // ============================================================
    // RELATIONSHIP EXISTENCE
    // ============================================================

    /**
     * Check if a relationship exists between two characters.
     * For directional relationships, direction matters.
     * 
     * @param {string} charId1 - First character ID
     * @param {string} charId2 - Second character ID
     * @param {string} typeId - Relationship type ID
     * @returns {boolean} True if relationship exists
     */
    function relationshipExists(charId1, charId2, typeId) {
        if (!charId1 || !charId2 || !typeId) {
            return false;
        }

        var target1 = String(charId1);
        var target2 = String(charId2);
        var isDirectional = SocialConstants.isDirectional(typeId);

        var relationships = getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel || rel.typeId !== typeId) continue;

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if (isDirectional) {
                // Directional: character1 → character2
                if (r1 === target1 && r2 === target2) {
                    return true;
                }
            } else {
                // Undirected: order doesn't matter
                if ((r1 === target1 && r2 === target2) || (r1 === target2 && r2 === target1)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if any relationship exists between two characters.
     * 
     * @param {string} charId1 - First character ID
     * @param {string} charId2 - Second character ID
     * @returns {boolean} True if any relationship exists
     */
    function hasAnyRelationship(charId1, charId2) {
        if (!charId1 || !charId2) {
            return false;
        }

        var c1 = String(charId1);
        var c2 = String(charId2);
        var relationships = getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) continue;

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if ((r1 === c1 && r2 === c2) || (r1 === c2 && r2 === c1)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a character has any relationships.
     * 
     * @param {string} charId - Character ID
     * @returns {boolean} True if character has relationships
     */
    function hasRelationships(charId) {
        if (!charId) {
            return false;
        }

        var rels = getCharacterRelationships(charId);
        return rels.length > 0;
    }

    // ============================================================
    // CONNECTED CHARACTERS
    // ============================================================

    /**
     * Get all characters connected to a given character.
     * Returns an array of objects with character and their relationships.
     * 
     * @param {string} charId - Character ID
     * @returns {Array} Array of { character, relationships: [] } objects
     */
    function getConnectedCharacters(charId) {
        if (!charId) {
            return [];
        }

        var target = String(charId);
        var rels = getCharacterRelationships(charId);
        var resultMap = Object.create(null);
        var result = [];

        for (var i = 0; i < rels.length; i++) {
            var rel = rels[i];
            if (!rel) continue;

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);
            var otherId = r1 === target ? r2 : r1;

            // Only include if character exists
            var character = CharacterQueries.getCharacterById(otherId);
            if (!character) continue;

            var key = String(otherId);
            if (!resultMap[key]) {
                resultMap[key] = {
                    character: character,
                    relationships: []
                };
                result.push(resultMap[key]);
            }

            resultMap[key].relationships.push(rel);
        }

        // Sort by character name
        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a.character) || '';
            var nameB = CharacterQueries.getDisplayName(b.character) || '';
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    /**
     * Get the count of relationships for a character.
     * 
     * @param {string} charId - Character ID
     * @returns {number} Number of relationships
     */
    function getRelationshipCount(charId) {
        if (!charId) {
            return 0;
        }

        var rels = getCharacterRelationships(charId);
        return rels.length;
    }

    /**
     * Get the total number of relationships in the system.
     * 
     * @returns {number} Total relationship count
     */
    function getTotalRelationshipCount() {
        var relationships = getAllRelationships();
        return relationships.length;
    }

    // ============================================================
    // RELATIONSHIP TYPE QUERIES (delegated to SocialConstants)
    // ============================================================

    /**
     * Get all relationship type definitions.
     * Delegated to SocialConstants.
     * 
     * @returns {Array} Array of relationship type objects
     */
    function getRelationshipTypes() {
        return SocialConstants.getRelationshipTypes();
    }

    /**
     * Get a relationship type definition by ID.
     * Delegated to SocialConstants.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {object|null} Type definition or null
     */
    function getRelationshipType(typeId) {
        return SocialConstants.getRelationshipType(typeId);
    }

    /**
     * Get the label for a relationship type.
     * Delegated to SocialConstants.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {string} Label or type ID if not found
     */
    function getRelationshipTypeLabel(typeId) {
        return SocialConstants.getLabel(typeId);
    }

    /**
     * Get the color for a relationship type.
     * Delegated to SocialConstants.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {string} CSS color value
     */
    function getRelationshipTypeColor(typeId) {
        return SocialConstants.getColor(typeId);
    }

    /**
     * Check if a relationship type is directional.
     * Delegated to SocialConstants.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {boolean} True if directional
     */
    function isRelationshipDirectional(typeId) {
        return SocialConstants.isDirectional(typeId);
    }

    /**
     * Check if a relationship type ID is valid.
     * Delegated to SocialConstants.
     * 
     * @param {string} typeId - Relationship type ID
     * @returns {boolean} True if valid
     */
    function isValidRelationshipType(typeId) {
        return SocialConstants.isValidType(typeId);
    }

    /**
     * Get valid relationship type IDs.
     * Delegated to SocialConstants.
     * 
     * @returns {string[]} Array of valid type IDs
     */
    function getValidRelationshipTypeIds() {
        return SocialConstants.getValidTypeIds();
    }

    /**
     * Get the default relationship type ID.
     * Delegated to SocialConstants.
     * 
     * @returns {string} Default type ID
     */
    function getDefaultRelationshipTypeId() {
        return SocialConstants.getDefaultTypeId();
    }

    // ============================================================
    // DISPLAY HELPERS
    // ============================================================

    /**
     * Get the other character in a relationship.
     * 
     * @param {object} relationship - Relationship object
     * @param {string} charId - Character ID to exclude
     * @returns {string|null} Other character ID or null
     */
    function getOtherCharacterId(relationship, charId) {
        if (!relationship || !charId) {
            return null;
        }

        var c1 = String(relationship.character1);
        var c2 = String(relationship.character2);
        var target = String(charId);

        if (c1 === target) {
            return c2;
        }
        if (c2 === target) {
            return c1;
        }

        return null;
    }

    /**
     * Check if a character is the source in a directional relationship.
     * 
     * @param {object} relationship - Relationship object
     * @param {string} charId - Character ID to check
     * @returns {boolean} True if character is the source
     */
    function isRelationshipSource(relationship, charId) {
        if (!relationship || !charId) {
            return false;
        }

        return String(relationship.character1) === String(charId);
    }

    /**
     * Check if a character is the target in a directional relationship.
     * 
     * @param {object} relationship - Relationship object
     * @param {string} charId - Character ID to check
     * @returns {boolean} True if character is the target
     */
    function isRelationshipTarget(relationship, charId) {
        if (!relationship || !charId) {
            return false;
        }

        return String(relationship.character2) === String(charId);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialQueries = {
        // Relationship lookup
        getRelationshipById: getRelationshipById,
        getAllRelationships: getAllRelationships,
        getCharacterRelationships: getCharacterRelationships,
        getCharacterRelationshipsOfType: getCharacterRelationshipsOfType,
        getAllRelationshipsBetween: getAllRelationshipsBetween,

        // Existence checks
        relationshipExists: relationshipExists,
        hasAnyRelationship: hasAnyRelationship,
        hasRelationships: hasRelationships,

        // Connected characters
        getConnectedCharacters: getConnectedCharacters,
        getRelationshipCount: getRelationshipCount,
        getTotalRelationshipCount: getTotalRelationshipCount,

        // Type queries (delegated to SocialConstants)
        getRelationshipTypes: getRelationshipTypes,
        getRelationshipType: getRelationshipType,
        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getRelationshipTypeColor,
        isRelationshipDirectional: isRelationshipDirectional,
        isValidRelationshipType: isValidRelationshipType,
        getValidRelationshipTypeIds: getValidRelationshipTypeIds,
        getDefaultRelationshipTypeId: getDefaultRelationshipTypeId,

        // Display helpers
        getOtherCharacterId: getOtherCharacterId,
        isRelationshipSource: isRelationshipSource,
        isRelationshipTarget: isRelationshipTarget
    };

})();