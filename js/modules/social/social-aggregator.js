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
 * IMMUTABILITY OF SOURCE DATA:
 *   - SocialQueries.getAllRelationships() returns the LIVE array
 *     (window.data.social.relationships), not a copy. Any code that
 *     sorts, splices, or reorders it mutates the persisted store.
 *   - This module treats source arrays as read-only. Where ordering
 *     is needed for a projection, a shallow copy is taken first.
 *   - The slice-before-sort pattern in getSocialPageViewModel is
 *     load-bearing: without it, calling the Social tab with the
 *     default 'all'/'all' filters reorders the store on every render.
 *
 * ELIMINATION ENRICHMENT:
 *   The character VMs produced by this module carry both:
 *     - `everEliminated`  : boolean. True when the character has any
 *                            elimination record at all, any year,
 *                            any kind. Presence-based.
 *     - `eliminationYear` : number | null. The earliest elimination
 *                            year, for display.
 *     - `eliminationWeek` : number | null. The earliest elimination
 *                            week, for display.
 *     - `eliminationReason` : string. Reason from the earliest
 *                            elimination, or '' when none.
 *
 *   This is enrichment, not a re-implementation. The reads route
 *   through EliminationQueries, which owns the semantics. When that
 *   module is unavailable, all four fields fall back to the
 *   non-eliminated shape and the projection proceeds.
 *
 *   Consumers that just need "is this character eliminated?" should
 *   check `everEliminated`. It is a fact about the character record,
 *   not about the current application year.
 *
 * API:
 *   - getRelationshipViewModel(relationship, contextCharId)
 *   - getCharacterRelationshipsViewModel(characterId)
 *   - getConnectedCharactersViewModel(characterId)
 *   - getSocialPageViewModel(options)
 *   - getGroupedCharacterRelationshipsViewModel(characterId)
 *   - getAllGroupedRelationshipsViewModel(options)
 *
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *
 * DEPENDENCIES (LAZY):
 *   - window.EliminationQueries (from elimination-queries.js)
 *     Missing -> elimination fields stay in their non-eliminated
 *     shape; the projection proceeds.
 *
 * USAGE:
 *   var vm = SocialAggregator.getCharacterRelationshipsViewModel('char_123');
 *   var rel = SocialAggregator.getRelationshipViewModel(relationship);
 *   var grouped = SocialAggregator.getGroupedCharacterRelationshipsViewModel('char_123');
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
    var SocialConstants = window.SocialConstants;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

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

        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            missing.push('SocialConstants.isDirectional');
        }
        if (!SocialConstants || typeof SocialConstants.getLabel !== 'function') {
            missing.push('SocialConstants.getLabel');
        }
        if (!SocialConstants || typeof SocialConstants.getColor !== 'function') {
            missing.push('SocialConstants.getColor');
        }
        if (!SocialConstants || typeof SocialConstants.getRelationshipTypes !== 'function') {
            missing.push('SocialConstants.getRelationshipTypes');
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

    /**
     * Read elimination facts for a character.
     *
     * Returns a plain object with four fields. When
     * EliminationQueries is unavailable, all fields fall back to
     * their non-eliminated shape. When the character has no
     * eliminations, the same shape is returned.
     *
     * This function is the SINGLE place in the aggregator that
     * reads EliminationQueries. Consumers use the returned fields
     * directly; they do not reach for the query module themselves.
     *
     * @param {string|object} charIdOrObject
     * @returns {{
     *   eliminated: boolean,
     *   everEliminated: boolean,
     *   eliminationYear: number|null,
     *   eliminationWeek: number|null,
     *   eliminationReason: string
     * }}
     */
    function readEliminationFacts(charIdOrObject) {
        var result = {
            eliminated: false,
            everEliminated: false,
            eliminationYear: null,
            eliminationWeek: null,
            eliminationReason: ''
        };

        if (!charIdOrObject) { return result; }

        var EQ = getEliminationQueries();
        if (!EQ) { return result; }

        try {
            if (typeof EQ.getEliminationYear === 'function') {
                var year = EQ.getEliminationYear(charIdOrObject);
                if (year !== null && year !== undefined) {
                    result.eliminationYear = year;
                    result.everEliminated = true;
                }
            }

            if (typeof EQ.getEliminationWeek === 'function') {
                var week = EQ.getEliminationWeek(charIdOrObject);
                if (week !== null && week !== undefined) {
                    result.eliminationWeek = week;
                    // A week without a year is unusual but
                    // possible on legacy data. Treat it as an
                    // elimination for the "ever" flag.
                    if (!result.everEliminated) {
                        result.everEliminated = true;
                    }
                }
            }

            if (typeof EQ.getEliminationReason === 'function') {
                var reason = EQ.getEliminationReason(charIdOrObject);
                if (typeof reason === 'string' && reason !== 'Unknown') {
                    result.eliminationReason = reason;
                }
            }

            // `eliminated` is year-scoped: is the character eliminated
            // as of the current application year? This is distinct
            // from `everEliminated` (presence-based). Callers that
            // need the year-scoped answer check `eliminated`.
            if (typeof EQ.isCharacterEliminatedByYear === 'function') {
                var data = window.data || {};
                var currentYear = null;
                if (typeof data.currentYear === 'number' &&
                    isFinite(data.currentYear) &&
                    data.currentYear > 0) {
                    currentYear = Math.floor(data.currentYear);
                }
                if (currentYear !== null) {
                    result.eliminated = EQ.isCharacterEliminatedByYear(
                        charIdOrObject,
                        currentYear
                    ) === true;
                }
            }
        } catch (e) {
            // Fail-open: leave the default shape. Elimination is
            // enrichment, not a required fact for the projection.
        }

        return result;
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
        if (endYear) {
            return 'Until ' + endYear;
        }
        return '';
    }

    function getDirectionText(relationship, charId) {
        if (!relationship) { return ''; }
        var isDirectional = SocialConstants.isDirectional(relationship.typeId);
        if (!isDirectional) { return ' ↔ '; }

        if (!charId) {
            return ' → ';
        }

        var target = String(charId);
        var isSource = String(relationship.character1) === target;
        return isSource ? ' → ' : ' ← ';
    }

    /**
     * Is this relationship ongoing (no endYear) or ended?
     */
    function isOngoing(relationship) {
        if (!relationship) { return true; }
        var end = relationship.endYear;
        if (end === undefined || end === null) { return true; }
        if (typeof end === 'string' && end.trim() === '') { return true; }
        return false;
    }

    // ============================================================
    // PUBLIC API - Single relationship view model
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
        var ongoing = isOngoing(relationship);

        var otherCharId = contextCharId
            ? getOtherCharacterId(relationship, contextCharId)
            : null;

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
            ongoing: ongoing,
            notes: relationship.notes || '',
            createdAt: relationship.createdAt || '',

            // Computed display helpers
            displayName: name1 + directionText + name2,
            displayType: typeLabel + (relationship.clarification ? ' (' + relationship.clarification + ')' : ''),
            displayPeriod: period,

            // Context character (when a perspective is provided)
            contextCharId: contextCharId || null,
            otherCharId: otherCharId,
            otherCharName: otherCharId ? getCharacterDisplayName(otherCharId) : null
        };
    }

    // ============================================================
    // PUBLIC API - Character relationships view model
    // ============================================================

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
                byType: []
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
        var byTypeMap = Object.create(null);
        viewModels.forEach(function(vm) {
            if (!vm) { return; }
            var key = vm.typeId;
            if (!byTypeMap[key]) {
                byTypeMap[key] = {
                    typeId: key,
                    typeLabel: vm.typeLabel,
                    typeColor: vm.typeColor,
                    relationships: []
                };
            }
            byTypeMap[key].relationships.push(vm);
        });

        // Sort by type label
        var sortedByType = Object.keys(byTypeMap).map(function(k) {
            return byTypeMap[k];
        }).sort(function(a, b) {
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

    // ============================================================
    // PUBLIC API - Connected characters view model
    // ============================================================

    /**
     * Get a view model for all characters connected to a character.
     *
     * Each connection record carries the same character facts the
     * social page VM carries, under the `character*` prefix:
     * name, status, age, deceased, and the elimination fields.
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
        var connectionMap = Object.create(null);

        relationships.forEach(function(rel) {
            var otherId = getOtherCharacterId(rel, characterId);
            if (!otherId) { return; }

            if (!connectionMap[otherId]) {
                var otherChar = CharacterQueries.getCharacterById(otherId);
                var elimFacts = otherChar
                    ? readEliminationFacts(otherChar)
                    : {
                        eliminated: false,
                        everEliminated: false,
                        eliminationYear: null,
                        eliminationWeek: null,
                        eliminationReason: ''
                    };

                connectionMap[otherId] = {
                    characterId: otherId,
                    characterName: getCharacterDisplayName(otherId),
                    characterStatus: getCharacterStatus(otherId),
                    characterAge: getCharacterAge(otherId),
                    characterDeceased: getCharacterDeceased(otherId),

                    // Elimination enrichment, prefixed to match the
                    // character* naming convention on this VM.
                    characterEliminated: elimFacts.eliminated,
                    characterEverEliminated: elimFacts.everEliminated,
                    characterEliminationYear: elimFacts.eliminationYear,
                    characterEliminationWeek: elimFacts.eliminationWeek,
                    characterEliminationReason: elimFacts.eliminationReason,

                    relationships: []
                };
            }

            connectionMap[otherId].relationships.push(getRelationshipViewModel(rel, characterId));
        });

        var connections = Object.keys(connectionMap).map(function(k) {
            return connectionMap[k];
        });

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

    // ============================================================
    // PUBLIC API - Full social page view model
    // ============================================================

    /**
     * Get a complete social page view model.
     * Combines all Social data into a single projection for the main page.
     *
     * SOURCE-DATA SAFETY:
     *   SocialQueries.getAllRelationships() returns the LIVE array. The
     *   `filtered` variable starts as a shallow copy (slice()) so the
     *   final .sort() reorders the copy, not the store. Without this,
     *   the default 'all'/'all' filter path would reorder
     *   window.data.social.relationships on every render.
     *
     * CHARACTER VM SHAPE:
     *   Each character in the `characters` array carries:
     *     id, name, status, age, deceased,                       // original
     *     eliminated, everEliminated,                            // v2 addition
     *     eliminationYear, eliminationWeek, eliminationReason    // v2 addition
     *
     *   Consumers building pickers or lists check `everEliminated`
     *   for "has this character ever been eliminated?" — a fact
     *   about the record. They check `eliminated` for "is this
     *   character eliminated as of the current year?" — a fact
     *   about the current state.
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

        // ---- FIX: shallow copy before filtering/sorting ----
        // Without this, when both filters are 'all', `filtered` aliases
        // the live store and the .sort() below mutates it in place.
        var filtered = allRelationships.slice();

        // Apply filters
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
        var characterIds = Object.create(null);
        allRelationships.forEach(function(r) {
            if (r && r.character1) { characterIds[String(r.character1)] = true; }
            if (r && r.character2) { characterIds[String(r.character2)] = true; }
        });

        var characters = Object.keys(characterIds).map(function(id) {
            var char = CharacterQueries.getCharacterById(id);

            // Elimination enrichment. When the character record is
            // missing, we skip the query and return the default shape.
            var elimFacts = char
                ? readEliminationFacts(char)
                : {
                    eliminated: false,
                    everEliminated: false,
                    eliminationYear: null,
                    eliminationWeek: null,
                    eliminationReason: ''
                };

            return {
                id: id,
                name: char ? CharacterQueries.getDisplayName(char) : 'Unknown',
                status: char ? CharacterQueries.getCurrentStatus(char) : '',
                age: char ? CharacterQueries.getCharacterAge(char) : '',
                deceased: char ? (char.deceased || false) : false,

                // Elimination enrichment
                eliminated: elimFacts.eliminated,
                everEliminated: elimFacts.everEliminated,
                eliminationYear: elimFacts.eliminationYear,
                eliminationWeek: elimFacts.eliminationWeek,
                eliminationReason: elimFacts.eliminationReason
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
        var typeCounts = Object.create(null);
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
        var types = Object.keys(typeCounts).map(function(k) {
            return typeCounts[k];
        }).sort(function(a, b) {
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
    // PUBLIC API - Grouped relationships
    // ============================================================

    /**
     * Get the character's relationships grouped by type.
     * Each group has:
     *   - typeId, typeLabel, typeColor
     *   - ongoing: [] of relationship view models
     *   - ended:   [] of relationship view models
     *   - total:   number
     *
     * Groups sorted alphabetically by type label.
     * Ongoing and ended sorted by start year (ascending, empty last).
     *
     * @param {string} characterId - Character ID
     * @returns {array} Array of type-group view models
     */
    function getGroupedCharacterRelationshipsViewModel(characterId) {
        if (!characterId) {
            return [];
        }

        var relationships = SocialQueries.getCharacterRelationships(characterId);
        if (!relationships || relationships.length === 0) {
            return [];
        }

        // Map view models
        var viewModels = relationships.map(function(rel) {
            return getRelationshipViewModel(rel, characterId);
        }).filter(function(vm) { return vm !== null; });

        // Group by type
        var groupMap = Object.create(null);
        viewModels.forEach(function(vm) {
            var key = vm.typeId;
            if (!groupMap[key]) {
                groupMap[key] = {
                    typeId: key,
                    typeLabel: vm.typeLabel,
                    typeColor: vm.typeColor,
                    ongoing: [],
                    ended: [],
                    total: 0
                };
            }
            if (vm.ongoing) {
                groupMap[key].ongoing.push(vm);
            } else {
                groupMap[key].ended.push(vm);
            }
            groupMap[key].total++;
        });

        // Sort each group's relationships by start year
        function sortByStartYear(a, b) {
            var aY = parseInt(a.startYear, 10);
            var bY = parseInt(b.startYear, 10);
            var aHas = !isNaN(aY);
            var bHas = !isNaN(bY);
            if (aHas && bHas) { return aY - bY; }
            if (aHas && !bHas) { return -1; }
            if (!aHas && bHas) { return 1; }
            // Tiebreak on other char name
            return String(a.otherCharName || '').localeCompare(String(b.otherCharName || ''));
        }

        var groups = Object.keys(groupMap).map(function(k) {
            var g = groupMap[k];
            g.ongoing.sort(sortByStartYear);
            g.ended.sort(sortByStartYear);
            return g;
        });

        // Sort groups alphabetically by type label
        groups.sort(function(a, b) {
            return a.typeLabel.localeCompare(b.typeLabel);
        });

        return groups;
    }

    /**
     * Get ALL relationships grouped by type across the whole social graph.
     * Used by the top-level Social tab for the grouped view.
     *
     * SOURCE-DATA SAFETY:
     *   The `relationships` variable is reassigned to fresh arrays by
     *   the .filter() calls, so no in-place mutation of the store can
     *   occur here. The .sort() below sorts the freshly-built group
     *   arrays, not the source array. This function was already safe;
     *   the sibling getSocialPageViewModel was not.
     *
     * @param {object} options - Options
     * @param {string} options.characterFilter - Restrict to relationships involving this character
     * @param {string} options.typeFilter - Restrict to a single type
     * @returns {array} Array of type-group view models
     */
    function getAllGroupedRelationshipsViewModel(options) {
        options = options || {};
        var charFilter = options.characterFilter || 'all';
        var typeFilter = options.typeFilter || 'all';

        var relationships = SocialQueries.getAllRelationships();

        if (charFilter !== 'all') {
            relationships = relationships.filter(function(r) {
                return String(r.character1) === String(charFilter) ||
                       String(r.character2) === String(charFilter);
            });
        }
        if (typeFilter !== 'all') {
            relationships = relationships.filter(function(r) {
                return r.typeId === typeFilter;
            });
        }

        var contextCharId = charFilter !== 'all' ? charFilter : null;

        var viewModels = relationships.map(function(rel) {
            return getRelationshipViewModel(rel, contextCharId);
        }).filter(function(vm) { return vm !== null; });

        var groupMap = Object.create(null);
        viewModels.forEach(function(vm) {
            var key = vm.typeId;
            if (!groupMap[key]) {
                groupMap[key] = {
                    typeId: key,
                    typeLabel: vm.typeLabel,
                    typeColor: vm.typeColor,
                    ongoing: [],
                    ended: [],
                    total: 0
                };
            }
            if (vm.ongoing) {
                groupMap[key].ongoing.push(vm);
            } else {
                groupMap[key].ended.push(vm);
            }
            groupMap[key].total++;
        });

        function sortByStartYear(a, b) {
            var aY = parseInt(a.startYear, 10);
            var bY = parseInt(b.startYear, 10);
            var aHas = !isNaN(aY);
            var bHas = !isNaN(bY);
            if (aHas && bHas) { return aY - bY; }
            if (aHas && !bHas) { return -1; }
            if (!aHas && bHas) { return 1; }
            return String(a.displayName || '').localeCompare(String(b.displayName || ''));
        }

        var groups = Object.keys(groupMap).map(function(k) {
            var g = groupMap[k];
            g.ongoing.sort(sortByStartYear);
            g.ended.sort(sortByStartYear);
            return g;
        });

        groups.sort(function(a, b) {
            return a.typeLabel.localeCompare(b.typeLabel);
        });

        return groups;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialAggregator = {
        // Single relationship
        getRelationshipViewModel: getRelationshipViewModel,

        // Character-scoped
        getCharacterRelationshipsViewModel: getCharacterRelationshipsViewModel,
        getConnectedCharactersViewModel: getConnectedCharactersViewModel,
        getGroupedCharacterRelationshipsViewModel: getGroupedCharacterRelationshipsViewModel,

        // Global
        getSocialPageViewModel: getSocialPageViewModel,
        getAllGroupedRelationshipsViewModel: getAllGroupedRelationshipsViewModel
    };

})();
