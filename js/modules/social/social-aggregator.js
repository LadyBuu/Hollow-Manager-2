/**
 * modules/social/social-aggregator.js - Social Aggregator
 * Social's integration boundary with external domains
 * 
 * This module provides Social-specific projections by composing
 * data from SocialQueries and CharacterQueries.
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes SocialQueries + CharacterQueries
 *   - Returns Social-specific view models
 *   - Never exposes CharacterQueries API directly
 *   - Never mutates data
 *   - No UI dependencies
 *   - No passthrough methods
 * 
 * API:
 *   - getRelationshipViewModel(relationship)
 *   - getCharacterRelationshipsViewModel(characterId)
 *   - getConnectedCharactersViewModel(characterId)
 *   - getSocialPageViewModel(options)
 * 
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var vm = SocialAggregator.getCharacterRelationshipsViewModel('char_123');
 *   var rel = SocialAggregator.getRelationshipViewModel(relationship);
 */

(function() {
    'use strict';

    if (window.__socialAggregatorLoaded) {
        return;
    }
    window.__socialAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getRelationshipById !== 'function') {
            missing.push('SocialQueries.getRelationshipById');
        }
        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeLabel !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeLabel');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeColor !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeColor');
        }
        if (!SocialQueries || typeof SocialQueries.isRelationshipDirectional !== 'function') {
            missing.push('SocialQueries.isRelationshipDirectional');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
            missing.push('CharacterQueries.getCharacterAge');
        }

        if (missing.length > 0) {
            console.warn('[SocialAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function getCharacterDisplayName(charId) {
        if (!charId) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char);
    }

    function getCharacterStatus(charId) {
        if (!charId) { return ''; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return ''; }
        return CharacterQueries.getCurrentStatus(char);
    }

    function getCharacterAge(charId) {
        if (!charId) { return ''; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return ''; }
        return CharacterQueries.getCharacterAge(char);
    }

    function getCharacterDeceased(charId) {
        if (!charId) { return false; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return false; }
        return char.deceased || false;
    }

    function getOtherCharacterId(relationship, charId) {
        if (!relationship || !charId) { return null; }
        var c1 = String(relationship.character1);
        var c2 = String(relationship.character2);
        var target = String(charId);
        if (c1 === target) { return c2; }
        if (c2 === target) { return c1; }
        return null;
    }

    function formatPeriod(startYear, endYear) {
        if (startYear && endYear) {
            return startYear + ' - ' + endYear;
        }
        if (startYear) {
            return 'From ' + startYear;
        }
        return '';
    }

    function getDirectionText(relationship, charId) {
        var isDirectional = SocialQueries.isRelationshipDirectional(relationship.typeId);
        if (!isDirectional) { return ' ↔ '; }

        if (!charId) { return ' → '; }

        var target = String(charId);
        var isSource = String(relationship.character1) === target;
        return isSource ? ' → ' : ' ← ';
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Get a view model for a single relationship.
     * 
     * @param {object} relationship - Relationship object from SocialQueries
     * @param {string} contextCharId - Optional character ID for context
     * @returns {object} Relationship view model
     */
    function getRelationshipViewModel(relationship, contextCharId) {
        if (!relationship) {
            return null;
        }

        var char1 = CharacterQueries.getCharacterById(relationship.character1);
        var char2 = CharacterQueries.getCharacterById(relationship.character2);

        var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
        var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';

        var typeLabel = SocialQueries.getRelationshipTypeLabel(relationship.typeId);
        var typeColor = SocialQueries.getRelationshipTypeColor(relationship.typeId);
        var isDirectional = SocialQueries.isRelationshipDirectional(relationship.typeId);

        var directionText = getDirectionText(relationship, contextCharId);

        var period = formatPeriod(relationship.startYear, relationship.endYear);

        return {
            id: relationship.id,
            character1: relationship.character1,
            character2: relationship.character2,
            name1: name1,
            name2: name2,
            typeId: relationship.typeId,
            typeLabel: typeLabel,
            typeColor: typeColor,
            isDirectional: isDirectional,
            directionText: directionText,
            clarification: relationship.clarification || '',
            startYear: relationship.startYear || '',
            endYear: relationship.endYear || '',
            period: period,
            notes: relationship.notes || '',
            createdAt: relationship.createdAt || '',
            // Computed display
            displayName: name1 + directionText + name2,
            displayType: typeLabel + (relationship.clarification ? ' (' + relationship.clarification + ')' : ''),
            displayPeriod: period,
            // Context character
            contextCharId: contextCharId || null,
            otherCharId: contextCharId ? getOtherCharacterId(relationship, contextCharId) : null,
            otherCharName: contextCharId ? getCharacterDisplayName(getOtherCharacterId(relationship, contextCharId)) : null
        };
    }

    /**
     * Get a view model for all relationships of a character.
     * 
     * @param {string} characterId - Character ID
     * @returns {object} Character relationships view model
     */
    function getCharacterRelationshipsViewModel(characterId) {
        if (!characterId) {
            return {
                characterId: null,
                characterName: null,
                relationships: [],
                relationshipCount: 0,
                byType: {}
            };
        }

        var char = CharacterQueries.getCharacterById(characterId);
        var characterName = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
        var status = char ? CharacterQueries.getCurrentStatus(char) : '';
        var age = char ? CharacterQueries.getCharacterAge(char) : '';
        var deceased = char ? (char.deceased || false) : false;

        var relationships = SocialQueries.getCharacterRelationships(characterId);
        var viewModels = relationships.map(function(rel) {
            return getRelationshipViewModel(rel, characterId);
        });

        // Group by type
        var byType = {};
        viewModels.forEach(function(vm) {
            if (!vm) { return; }
            var key = vm.typeId;
            if (!byType[key]) {
                byType[key] = {
                    typeId: key,
                    typeLabel: vm.typeLabel,
                    typeColor: vm.typeColor,
                    relationships: []
                };
            }
            byType[key].relationships.push(vm);
        });

        // Sort by type label
        var sortedByType = Object.values(byType).sort(function(a, b) {
            return a.typeLabel.localeCompare(b.typeLabel);
        });

        // Sort relationships by creation date (newest first)
        viewModels.sort(function(a, b) {
            if (!a || !b) { return 0; }
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        return {
            characterId: characterId,
            characterName: characterName,
            characterStatus: status,
            characterAge: age,
            characterDeceased: deceased,
            relationships: viewModels,
            relationshipCount: viewModels.length,
            byType: sortedByType
        };
    }

    /**
     * Get a view model for all characters connected to a character.
     * 
     * @param {string} characterId - Character ID
     * @returns {object} Connected characters view model
     */
    function getConnectedCharactersViewModel(characterId) {
        if (!characterId) {
            return {
                characterId: null,
                characterName: null,
                connections: [],
                connectionCount: 0
            };
        }

        var char = CharacterQueries.getCharacterById(characterId);
        var characterName = char ? CharacterQueries.getDisplayName(char) : 'Unknown';

        var relationships = SocialQueries.getCharacterRelationships(characterId);
        var connectionMap = {};

        relationships.forEach(function(rel) {
            var otherId = getOtherCharacterId(rel, characterId);
            if (!otherId) { return; }

            if (!connectionMap[otherId]) {
                connectionMap[otherId] = {
                    characterId: otherId,
                    characterName: getCharacterDisplayName(otherId),
                    characterStatus: getCharacterStatus(otherId),
                    characterAge: getCharacterAge(otherId),
                    characterDeceased: getCharacterDeceased(otherId),
                    relationships: []
                };
            }

            connectionMap[otherId].relationships.push(getRelationshipViewModel(rel, characterId));
        });

        var connections = Object.values(connectionMap);

        // Sort by character name
        connections.sort(function(a, b) {
            return a.characterName.localeCompare(b.characterName);
        });

        return {
            characterId: characterId,
            characterName: characterName,
            connections: connections,
            connectionCount: connections.length
        };
    }

    /**
     * Get a complete social page view model.
     * Combines all Social data into a single projection for the main page.
     * 
     * @param {object} options - Options
     * @param {string} options.characterFilter - Filter by character ID
     * @param {string} options.typeFilter - Filter by type ID
     * @param {boolean} options.includeConnectedCharacters - Include connected characters
     * @returns {object} Social page view model
     */
    function getSocialPageViewModel(options) {
        options = options || {};
        var charFilter = options.characterFilter || 'all';
        var typeFilter = options.typeFilter || 'all';
        var includeConnected = options.includeConnectedCharacters !== false;

        var allRelationships = SocialQueries.getAllRelationships();

        // Apply filters
        var filtered = allRelationships;
        if (charFilter !== 'all') {
            filtered = filtered.filter(function(r) {
                return String(r.character1) === String(charFilter) ||
                       String(r.character2) === String(charFilter);
            });
        }
        if (typeFilter !== 'all') {
            filtered = filtered.filter(function(r) {
                return r.typeId === typeFilter;
            });
        }

        // Sort by creation date (newest first)
        filtered.sort(function(a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        var relationshipViewModels = filtered.map(function(rel) {
            return getRelationshipViewModel(rel, charFilter !== 'all' ? charFilter : null);
        });

        // Get all characters with relationships
        var characterIds = {};
        allRelationships.forEach(function(r) {
            if (r && r.character1) { characterIds[String(r.character1)] = true; }
            if (r && r.character2) { characterIds[String(r.character2)] = true; }
        });

        var characters = Object.keys(characterIds).map(function(id) {
            var char = CharacterQueries.getCharacterById(id);
            return {
                id: id,
                name: char ? CharacterQueries.getDisplayName(char) : 'Unknown',
                status: char ? CharacterQueries.getCurrentStatus(char) : '',
                age: char ? CharacterQueries.getCharacterAge(char) : '',
                deceased: char ? (char.deceased || false) : false
            };
        }).sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        // Connected characters for the selected character
        var connected = null;
        if (includeConnected && charFilter !== 'all') {
            connected = getConnectedCharactersViewModel(charFilter);
        }

        // Types with counts
        var typeCounts = {};
        allRelationships.forEach(function(r) {
            if (!r || !r.typeId) { return; }
            var key = r.typeId;
            if (!typeCounts[key]) {
                typeCounts[key] = {
                    typeId: key,
                    typeLabel: SocialQueries.getRelationshipTypeLabel(key),
                    typeColor: SocialQueries.getRelationshipTypeColor(key),
                    count: 0
                };
            }
            typeCounts[key].count++;
        });
        var types = Object.values(typeCounts).sort(function(a, b) {
            return a.typeLabel.localeCompare(b.typeLabel);
        });

        return {
            relationships: relationshipViewModels,
            relationshipCount: relationshipViewModels.length,
            totalRelationshipCount: allRelationships.length,
            characters: characters,
            characterCount: characters.length,
            types: types,
            typeCount: types.length,
            selectedCharacterId: charFilter !== 'all' ? charFilter : null,
            selectedTypeId: typeFilter !== 'all' ? typeFilter : null,
            connected: connected
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialAggregator = {
        // Projections
        getRelationshipViewModel: getRelationshipViewModel,
        getCharacterRelationshipsViewModel: getCharacterRelationshipsViewModel,
        getConnectedCharactersViewModel: getConnectedCharactersViewModel,
        getSocialPageViewModel: getSocialPageViewModel
    };

})();