/**
 * js/shared/queries/social-queries.js - Social Queries
 * Read-only queries for the social/relationship domain
 *
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - No DOM manipulation
 *   - No persistence
 *   - No CharacterQueries dependency
 *   - Uses SocialConstants for type definitions
 *   - Returns LIVE REFERENCES to relationships - do not mutate
 *   - No window.data fallbacks - data structure must exist
 *
 * CLARIFICATION (two-sided):
 *   Each relationship carries clarification1 (character1's role
 *   toward character2) and clarification2 (character2's role toward
 *   character1). Older records carry a single legacy `clarification`
 *   field; readClarification applies the fallback so every consumer
 *   sees a consistent shape.
 *
 * DEPENDENCIES:
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.data (must exist and have social.relationships)
 */

(function() {
    'use strict';

    if (window.__socialQueriesLoaded) {
        return;
    }
    window.__socialQueriesLoaded = true;

    var SocialConstants = window.SocialConstants;

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

        if (missing.length > 0) {
            console.warn('[SocialQueries] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    checkDependencies();

    // ============================================================
    // DATA ACCESS
    // ============================================================

    function getSocialData() {
        return window.data.social;
    }

    function getAllRelationships() {
        var social = getSocialData();
        return social.relationships || [];
    }

    // ============================================================
    // CLARIFICATION HELPERS
    // ============================================================

    /**
     * Read the clarification string for one side of a relationship,
     * applying the legacy fallback.
     *
     * side === 1 -> clarification1, falling back to legacy
     *               `clarification`.
     * side === 2 -> clarification2 (no legacy fallback).
     *
     * @param {object} rel
     * @param {number} side
     * @returns {string}
     */
    function readClarification(rel, side) {
        if (!rel || typeof rel !== 'object') { return ''; }

        if (side === 2) {
            if (rel.clarification2 !== undefined && rel.clarification2 !== null) {
                return String(rel.clarification2);
            }
            return '';
        }

        if (rel.clarification1 !== undefined && rel.clarification1 !== null) {
            return String(rel.clarification1);
        }
        if (rel.clarification !== undefined && rel.clarification !== null) {
            return String(rel.clarification);
        }
        return '';
    }

    /**
     * Read the clarification that applies to a specific character in
     * the relationship. Returns the OTHER side's clarification when
     * charId is character1, and the primary clarification when charId
     * is character2 (matching the "what is this character toward
     * that one" reading).
     *
     * Actually: the returned string is the role THAT charId plays
     * toward the other. So:
     *   - charId === character1 -> clarification1
     *   - charId === character2 -> clarification2
     *
     * @param {object} rel
     * @param {string} charId
     * @returns {string}
     */
    function getClarificationForCharacter(rel, charId) {
        if (!rel || !charId) { return ''; }
        var c1 = String(rel.character1);
        var target = String(charId);
        if (c1 === target) {
            return readClarification(rel, 1);
        }
        return readClarification(rel, 2);
    }

    // ============================================================
    // RELATIONSHIP LOOKUP
    // ============================================================

    function getRelationshipById(id) {
        if (id === undefined || id === null) { return null; }

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

    function getCharacterRelationships(charId) {
        if (!charId) { return []; }

        var target = String(charId);
        var relationships = getAllRelationships();
        var result = [];

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (rel &&
                (String(rel.character1) === target ||
                 String(rel.character2) === target)) {
                result.push(rel);
            }
        }
        return result;
    }

    function getAllRelationshipsBetween(charId1, charId2) {
        if (!charId1 || !charId2) { return []; }

        var c1 = String(charId1);
        var c2 = String(charId2);
        var relationships = getAllRelationships();
        var result = [];

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if ((r1 === c1 && r2 === c2) || (r1 === c2 && r2 === c1)) {
                result.push(rel);
            }
        }
        return result;
    }

    function getCharacterRelationshipsOfType(charId, typeId) {
        if (!charId || !typeId) { return []; }

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
    // ROMANTIC STATUS
    // ============================================================

    function isCharacterRomanticallyInvolved(charId) {
        if (!charId) { return false; }

        var rels = getCharacterRelationships(charId);
        for (var i = 0; i < rels.length; i++) {
            var rel = rels[i];
            if (!rel) { continue; }
            if (rel.typeId !== 'romantic') { continue; }

            var end = rel.endYear;
            var isOngoing =
                end === undefined ||
                end === null ||
                (typeof end === 'string' && end.trim() === '');

            if (isOngoing) { return true; }
        }
        return false;
    }

    // ============================================================
    // RELATIONSHIP EXISTENCE
    // ============================================================

    function relationshipExists(charId1, charId2, typeId) {
        if (!charId1 || !charId2 || !typeId) { return false; }

        var target1 = String(charId1);
        var target2 = String(charId2);
        var isDirectional = SocialConstants.isDirectional(typeId);

        var relationships = getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel || rel.typeId !== typeId) { continue; }

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if (isDirectional) {
                if (r1 === target1 && r2 === target2) { return true; }
            } else {
                if ((r1 === target1 && r2 === target2) ||
                    (r1 === target2 && r2 === target1)) {
                    return true;
                }
            }
        }
        return false;
    }

    function hasAnyRelationship(charId1, charId2) {
        if (!charId1 || !charId2) { return false; }

        var c1 = String(charId1);
        var c2 = String(charId2);
        var relationships = getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if ((r1 === c1 && r2 === c2) || (r1 === c2 && r2 === c1)) {
                return true;
            }
        }
        return false;
    }

    function hasRelationships(charId) {
        if (!charId) { return false; }
        return getCharacterRelationships(charId).length > 0;
    }

    // ============================================================
    // TYPE QUERIES (delegated to SocialConstants)
    // ============================================================

    function getRelationshipTypes() {
        return SocialConstants.getRelationshipTypes();
    }

    function getRelationshipType(typeId) {
        return SocialConstants.getRelationshipType(typeId);
    }

    function getRelationshipTypeLabel(typeId) {
        return SocialConstants.getLabel(typeId);
    }

    function getRelationshipTypeColor(typeId) {
        return SocialConstants.getColor(typeId);
    }

    function isRelationshipDirectional(typeId) {
        return SocialConstants.isDirectional(typeId);
    }

    function isValidRelationshipType(typeId) {
        return SocialConstants.isValidType(typeId);
    }

    function getValidRelationshipTypeIds() {
        return SocialConstants.getValidTypeIds();
    }

    function getDefaultRelationshipTypeId() {
        return SocialConstants.getDefaultTypeId();
    }

    // ============================================================
    // DISPLAY HELPERS
    // ============================================================

    function getOtherCharacterId(relationship, charId) {
        if (!relationship || !charId) { return null; }

        var c1 = String(relationship.character1);
        var c2 = String(relationship.character2);
        var target = String(charId);

        if (c1 === target) { return c2; }
        if (c2 === target) { return c1; }
        return null;
    }

    function isRelationshipSource(relationship, charId) {
        if (!relationship || !charId) { return false; }
        return String(relationship.character1) === String(charId);
    }

    function isRelationshipTarget(relationship, charId) {
        if (!relationship || !charId) { return false; }
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

        // Clarifications
        readClarification: readClarification,
        getClarificationForCharacter: getClarificationForCharacter,

        // Existence checks
        relationshipExists: relationshipExists,
        hasAnyRelationship: hasAnyRelationship,
        hasRelationships: hasRelationships,

        // Romantic status
        isCharacterRomanticallyInvolved: isCharacterRomanticallyInvolved,

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
