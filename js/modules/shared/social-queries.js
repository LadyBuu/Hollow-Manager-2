/**
 * shared/queries/social-queries.js - Social Queries
 * Read-only social domain queries
 */

(function() {
    'use strict';

    if (window.__socialQueriesLoaded) { return; }
    window.__socialQueriesLoaded = true;

    function getSocialData() {
        var data = window.data || {};
        if (!data.social || typeof data.social !== 'object') {
            return { relationships: [], relationshipTypes: [], nextId: 1 };
        }
        return data.social;
    }

    function getRelationships() {
        var social = getSocialData();
        return Array.isArray(social.relationships) ? social.relationships.slice() : [];
    }

    function getRelationshipTypes() {
        var social = getSocialData();
        return Array.isArray(social.relationshipTypes) ? social.relationshipTypes.slice() : [];
    }

    function getRelationshipTypeById(typeId) {
        if (!typeId) { return null; }
        var types = getRelationshipTypes();
        for (var i = 0; i < types.length; i++) {
            if (String(types[i].id) === String(typeId)) {
                return types[i];
            }
        }
        return null;
    }

    function getRelationshipTypeLabel(typeId) {
        var type = getRelationshipTypeById(typeId);
        return type ? type.label : 'Unknown';
    }

    function getRelationshipTypeColor(typeId) {
        var type = getRelationshipTypeById(typeId);
        return type ? type.color : '#7f8c8d';
    }

    function isRelationshipDirectional(typeId) {
        var type = getRelationshipTypeById(typeId);
        return type ? !!type.directional : false;
    }

    function getCharacterRelationships(charId) {
        if (!charId) { return []; }
        var relationships = getRelationships();
        var result = [];
        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (rel && (String(rel.character1) === String(charId) || String(rel.character2) === String(charId))) {
                result.push(rel);
            }
        }
        return result;
    }

    function getRelationshipBetween(charId1, charId2) {
        if (!charId1 || !charId2) { return null; }
        var relationships = getRelationships();
        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if ((String(rel.character1) === String(charId1) && String(rel.character2) === String(charId2)) ||
                (String(rel.character1) === String(charId2) && String(rel.character2) === String(charId1))) {
                return rel;
            }
        }
        return null;
    }

    window.SocialQueries = {
        getRelationships: getRelationships,
        getRelationshipTypes: getRelationshipTypes,
        getRelationshipTypeById: getRelationshipTypeById,
        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getRelationshipTypeColor,
        isRelationshipDirectional: isRelationshipDirectional,
        getCharacterRelationships: getCharacterRelationships,
        getRelationshipBetween: getRelationshipBetween
    };

})();
