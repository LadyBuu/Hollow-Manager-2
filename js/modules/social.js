/**
 * js/modules/social.js - Social Network Manager
 * Manages relationships between characters with types, dates, and notes
 * Includes SVG visualization of the social network
 * Path: js/modules/social.js
 * 
 * ARCHITECTURE NOTE:
 * This module has been refactored to follow the same validation-first
 * philosophy as the tournament system. All mutations go through validation
 * before modifying state.
 * 
 * RELATIONSHIP SEMANTICS:
 * - Multiple relationships between the same two characters are allowed
 * - Each relationship has a single type (friendship, professional, etc.)
 * - A character pair can have multiple relationships of different types
 * - Duplicate relationships (same pair + same type) are prevented
 * - Mentor relationships are directional: character1 mentors character2
 * - Direction is always from character1 to character2
 * - All other relationship types are undirected
 * 
 * PERSISTENCE SEMANTICS:
 * - This module uses optimistic persistence: memory first, then save
 * - If save fails, the user is notified but the UI remains consistent
 * - This is deliberate: the user's work is preserved in memory
 * - A failed save does NOT roll back the in-memory state
 */

(function() {
    'use strict';

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var state = {
        selectedCharacterId: null,
        viewMode: 'list',
        zoomLevel: 1
    };

    var _resizeListenerAttached = false;

    // ============================================================
    // DEFAULT RELATIONSHIP TYPES
    // ============================================================

    var DEFAULT_RELATIONSHIP_TYPES = [
        { id: 'familial', label: 'Familial', color: '#8cbb3a' },
        { id: 'professional', label: 'Professional', color: '#c9a24b' },
        { id: 'romantic', label: 'Romantic', color: '#c1453c' },
        { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
        { id: 'mentor', label: 'Mentor', color: '#9b59b6', directional: true },
        { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
        { id: 'alliance', label: 'Alliance', color: '#27ae60' },
        { id: 'other', label: 'Other', color: '#7f8c8d' }
    ];

    // ============================================================
    // HTML ESCAPE
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // COLOUR SAFETY
    // ============================================================

    function getSafeColor(color) {
        if (typeof color !== 'string') {
            return '#7f8c8d';
        }

        var trimmed = color.trim();

        // Hex colours: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
        if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
            return trimmed;
        }

        // RGB/RGBA
        if (/^rgb(a)?\([\d\s.,%]+\)$/.test(trimmed)) {
            return trimmed;
        }

        // HSL/HSLA
        if (/^hsl(a)?\([\d\s.,%]+\)$/.test(trimmed)) {
            return trimmed;
        }

        // CSS named colours (basic set)
        var namedColors = [
            'black', 'white', 'red', 'green', 'blue', 'yellow',
            'orange', 'purple', 'pink', 'brown', 'gray', 'grey',
            'cyan', 'magenta', 'lime', 'olive', 'navy', 'teal',
            'aqua', 'fuchsia', 'maroon', 'silver', 'gold', 'coral'
        ];
        if (namedColors.indexOf(trimmed.toLowerCase()) !== -1) {
            return trimmed;
        }

        return '#7f8c8d';
    }

    function getSafeRelationshipColor(typeId) {
        var color = getRelationshipTypeColor(typeId);
        return getSafeColor(color);
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }
        console.log('[' + type + ']', message);
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistSocialChange(errorMessage) {
        if (typeof window.saveData !== 'function') {
            return;
        }

        try {
            var result = window.saveData();

            if (result && typeof result.catch === 'function') {
                result.catch(function(err) {
                    console.error(errorMessage, err);
                    showNotification(errorMessage, 'error');
                });
            }
        } catch (err) {
            console.error(errorMessage, err);
            showNotification(errorMessage, 'error');
        }
    }

    // ============================================================
    // GRAPH VIEW VISIBILITY
    // ============================================================

    function isGraphViewVisible() {
        var graphView = document.getElementById('social-graph-view');
        return graphView && graphView.style.display !== 'none';
    }

    // ============================================================
    // QUERIES
    // ============================================================

    function getCharacterById(id) {
        if (!id) return null;
        var data = window.data || {};
        if (!Array.isArray(data.characters)) return null;
        var target = String(id);
        return data.characters.find(function(c) {
            return c && String(c.id) === target;
        }) || null;
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
    }

    function getRelationshipTypes() {
        var data = window.data || {};
        if (data.social && Array.isArray(data.social.relationshipTypes)) {
            return data.social.relationshipTypes;
        }
        return DEFAULT_RELATIONSHIP_TYPES.slice();
    }

    function getRelationshipType(typeId) {
        var types = getRelationshipTypes();
        return types.find(function(t) { return t.id === typeId; }) || null;
    }

    function getRelationshipTypeLabel(typeId) {
        var type = getRelationshipType(typeId);
        return type ? type.label : typeId || 'Other';
    }

    function getRelationshipTypeColor(typeId) {
        var type = getRelationshipType(typeId);
        return type ? type.color : '#7f8c8d';
    }

    function isRelationshipDirectional(typeId) {
        var type = getRelationshipType(typeId);
        return type ? type.directional === true : false;
    }

    function getCharacterRelationships(charId) {
        var data = window.data || {};
        if (!data.social || !Array.isArray(data.social.relationships)) return [];
        var target = String(charId);
        return data.social.relationships.filter(function(r) {
            return r && (String(r.character1) === target || String(r.character2) === target);
        });
    }

    /**
     * Get all relationships between two characters regardless of direction.
     * For directional relationships, this returns both A→B and B→A if both exist.
     */
    function getAllRelationshipsBetween(charId1, charId2) {
        var data = window.data || {};
        if (!data.social || !Array.isArray(data.social.relationships)) return [];
        var c1 = String(charId1);
        var c2 = String(charId2);
        return data.social.relationships.filter(function(r) {
            if (!r) return false;
            var r1 = String(r.character1);
            var r2 = String(r.character2);
            return (r1 === c1 && r2 === c2) || (r1 === c2 && r2 === c1);
        });
    }

    function relationshipExists(charId1, charId2, typeId) {
        var target1 = String(charId1);
        var target2 = String(charId2);
        var directional = isRelationshipDirectional(typeId);

        var rels = getCharacterRelationships(charId1);
        return rels.some(function(r) {
            if (!r || r.typeId !== typeId) return false;

            var r1 = String(r.character1);
            var r2 = String(r.character2);

            if (directional) {
                return r1 === target1 && r2 === target2;
            }

            return (r1 === target1 && r2 === target2) ||
                   (r1 === target2 && r2 === target1);
        });
    }

    function getConnectedCharacters(charId) {
        var rels = getCharacterRelationships(charId);
        var connected = [];
        var target = String(charId);
        var seen = {};

        rels.forEach(function(r) {
            if (!r) return;
            var r1 = String(r.character1);
            var r2 = String(r.character2);
            var otherId = r1 === target ? r2 : r1;

            var char = getCharacterById(otherId);
            if (char) {
                var key = String(otherId);
                if (!seen[key]) {
                    seen[key] = true;
                    connected.push({
                        character: char,
                        relationships: []
                    });
                }
                var entry = connected.find(function(c) { return String(c.character.id) === key; });
                if (entry) {
                    entry.relationships.push(r);
                }
            }
        });

        return connected;
    }

    // ============================================================
    // STRUCTURE INITIALISATION
    // ============================================================

    function getDefaultRelationshipTypes() {
        return DEFAULT_RELATIONSHIP_TYPES.slice();
    }

    function ensureSocialStructure() {
        var data = window.data || {};

        if (!data.social || typeof data.social !== 'object') {
            data.social = {};
        }

        if (!Array.isArray(data.social.relationships)) {
            data.social.relationships = [];
        }

        if (!Array.isArray(data.social.relationshipTypes)) {
            data.social.relationshipTypes = getDefaultRelationshipTypes();
        }

        // Repair nextId if it's missing or too low
        var maxId = 0;
        data.social.relationships.forEach(function(r) {
            var id = Number(r && r.id);
            if (Number.isInteger(id) && id > maxId) {
                maxId = id;
            }
        });

        if (!Number.isInteger(data.social.nextId) || data.social.nextId <= maxId) {
            data.social.nextId = maxId + 1;
        }

        if (data.social.nextId < 1) {
            data.social.nextId = 1;
        }

        return data;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function isValidYear(value) {
        if (value === undefined || value === null || value === '') return true;
        var num = Number(value);
        return Number.isInteger(num) && num > 0 && num < 10000;
    }

    function isValidRelationshipType(typeId) {
        if (!typeId) return false;
        var types = getRelationshipTypes();
        return types.some(function(t) { return t.id === typeId; });
    }

    function validateRelationshipData(data) {
        var errors = [];

        var char1 = data.character1;
        var char2 = data.character2;

        if (!char1 || String(char1).trim() === '') {
            errors.push('Character 1 is required.');
        }
        if (!char2 || String(char2).trim() === '') {
            errors.push('Character 2 is required.');
        }

        if (char1 && char2 && String(char1) === String(char2)) {
            errors.push('Cannot create a relationship between the same character.');
        }

        if (char1) {
            var c1 = getCharacterById(char1);
            if (!c1) errors.push('Character 1 does not exist.');
        }
        if (char2) {
            var c2 = getCharacterById(char2);
            if (!c2) errors.push('Character 2 does not exist.');
        }

        if (!data.typeId) {
            errors.push('Relationship type is required.');
        } else if (!isValidRelationshipType(data.typeId)) {
            errors.push('Invalid relationship type.');
        }

        if (data.startYear !== undefined && data.startYear !== null && data.startYear !== '') {
            if (!isValidYear(data.startYear)) {
                errors.push('Start year must be a valid year.');
            }
        }
        if (data.endYear !== undefined && data.endYear !== null && data.endYear !== '') {
            if (!isValidYear(data.endYear)) {
                errors.push('End year must be a valid year.');
            }
        }

        var startNum = Number(data.startYear);
        var endNum = Number(data.endYear);
        if (isValidYear(data.startYear) && isValidYear(data.endYear) &&
            data.startYear && data.endYear && endNum < startNum) {
            errors.push('End year must be after start year.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // CORE OPERATIONS (VALIDATION-FIRST)
    // ============================================================

    function createRelationship(charId1, charId2, typeId, startYear, endYear, clarification, notes) {
        var validation = validateRelationshipData({
            character1: charId1,
            character2: charId2,
            typeId: typeId,
            startYear: startYear,
            endYear: endYear,
            clarification: clarification,
            notes: notes
        });

        if (!validation.valid) {
            return { success: false, message: validation.errors.join(' ') };
        }

        var data = ensureSocialStructure();

        var target1 = String(charId1);
        var target2 = String(charId2);
        var isDirectional = isRelationshipDirectional(typeId);

        var existing = data.social.relationships.find(function(r) {
            if (!r || r.typeId !== typeId) return false;
            var r1 = String(r.character1);
            var r2 = String(r.character2);

            if (isDirectional) {
                return r1 === target1 && r2 === target2;
            }
            return (r1 === target1 && r2 === target2) ||
                   (r1 === target2 && r2 === target1);
        });

        if (existing) {
            var typeLabel = getRelationshipTypeLabel(typeId);
            return {
                success: false,
                message: 'A ' + typeLabel + ' relationship already exists between these characters.'
            };
        }

        var relationship = {
            id: data.social.nextId++,
            character1: target1,
            character2: target2,
            typeId: typeId,
            startYear: startYear || '',
            endYear: endYear || '',
            clarification: clarification || '',
            notes: notes || '',
            createdAt: new Date().toISOString()
        };

        data.social.relationships.push(relationship);

        if (typeof window.logActivity === 'function') {
            var char1 = getCharacterById(target1);
            var char2 = getCharacterById(target2);
            var name1 = char1 ? getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? getDisplayName(char2) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(typeId);
            window.logActivity('Created ' + typeLabel + ' relationship between ' + name1 + ' and ' + name2);
        }

        persistSocialChange('Relationship created but could not be saved.');

        return { success: true, relationship: relationship };
    }

    function updateRelationship(id, updates) {
        var data = window.data || {};
        if (!data.social || !Array.isArray(data.social.relationships)) {
            return { success: false, message: 'No relationships found.' };
        }

        var rel = data.social.relationships.find(function(r) {
            return r && String(r.id) === String(id);
        });

        if (!rel) {
            return { success: false, message: 'Relationship not found.' };
        }

        var proposed = {
            character1: updates.character1 !== undefined ? updates.character1 : rel.character1,
            character2: updates.character2 !== undefined ? updates.character2 : rel.character2,
            typeId: updates.typeId !== undefined ? updates.typeId : rel.typeId,
            startYear: updates.startYear !== undefined ? updates.startYear : rel.startYear,
            endYear: updates.endYear !== undefined ? updates.endYear : rel.endYear,
            clarification: updates.clarification !== undefined ? updates.clarification : rel.clarification,
            notes: updates.notes !== undefined ? updates.notes : rel.notes
        };

        var validation = validateRelationshipData(proposed);
        if (!validation.valid) {
            return { success: false, message: validation.errors.join(' ') };
        }

        var target1 = String(proposed.character1);
        var target2 = String(proposed.character2);
        var isDirectional = isRelationshipDirectional(proposed.typeId);

        var existing = data.social.relationships.find(function(r) {
            if (!r || String(r.id) === String(id)) return false;
            if (r.typeId !== proposed.typeId) return false;

            var r1 = String(r.character1);
            var r2 = String(r.character2);

            if (isDirectional) {
                return r1 === target1 && r2 === target2;
            }
            return (r1 === target1 && r2 === target2) ||
                   (r1 === target2 && r2 === target1);
        });

        if (existing) {
            var typeLabel = getRelationshipTypeLabel(proposed.typeId);
            return {
                success: false,
                message: 'This would create a duplicate ' + typeLabel + ' relationship.'
            };
        }

        var changed = false;
        var allowedKeys = ['character1', 'character2', 'typeId', 'startYear', 'endYear', 'clarification', 'notes'];
        allowedKeys.forEach(function(key) {
            if (updates[key] !== undefined && String(rel[key]) !== String(updates[key])) {
                rel[key] = updates[key];
                changed = true;
            }
        });

        if (changed && typeof window.logActivity === 'function') {
            var char1 = getCharacterById(rel.character1);
            var char2 = getCharacterById(rel.character2);
            var name1 = char1 ? getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? getDisplayName(char2) : 'Unknown';
            window.logActivity('Updated relationship between ' + name1 + ' and ' + name2);
        }

        if (changed) {
            persistSocialChange('Relationship updated but could not be saved.');
        }

        return { success: true, relationship: rel, changed: changed };
    }

    function deleteRelationship(id) {
        var data = window.data || {};
        if (!data.social || !Array.isArray(data.social.relationships)) {
            return { success: false, message: 'No relationships found.' };
        }

        var rel = data.social.relationships.find(function(r) {
            return r && String(r.id) === String(id);
        });

        if (!rel) {
            return { success: false, message: 'Relationship not found.' };
        }

        var char1 = getCharacterById(rel.character1);
        var char2 = getCharacterById(rel.character2);
        var name1 = char1 ? getDisplayName(char1) : 'Unknown';
        var name2 = char2 ? getDisplayName(char2) : 'Unknown';

        data.social.relationships = data.social.relationships.filter(function(r) {
            return r && String(r.id) !== String(id);
        });

        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted relationship between ' + name1 + ' and ' + name2);
        }

        persistSocialChange('Relationship deleted but changes could not be saved.');

        return { success: true };
    }

    // ============================================================
    // RENDER FUNCTIONS
    // ============================================================

    function renderSocialView(container) {
        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading social data...</p>';
            return;
        }

        ensureSocialStructure();

        container.innerHTML = getSocialHTML();

        populateSocialSelectors();
        renderRelationships();
        initSocialEvents();
    }

    function getSocialHTML() {
        return `
            <div class="page-header">
                <h2>Social Network</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="add-relationship-btn" class="primary">+ Add Relationship</button>
                    <button id="view-graph-btn" class="secondary">◊ View Network</button>
                    <button id="view-list-btn" class="secondary">☰ View List</button>
                </div>
            </div>
            <div id="social-content">
                <div id="social-list-view">
                    <div class="filter-section">
                        <label for="social-character-filter">Character:</label>
                        <select id="social-character-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;min-width:150px;">
                            <option value="all">All Characters</option>
                        </select>
                        <label for="social-type-filter" style="margin-left:8px;">Type:</label>
                        <select id="social-type-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                            <option value="all">All Types</option>
                        </select>
                        <button id="clear-social-filters" class="small secondary">✕ Clear</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Relationships: <span id="relationship-count">0</span></span>
                    </div>
                    <div id="relationships-container">
                        <p class="empty-state">No relationships created yet. Add your first relationship!</p>
                    </div>
                </div>
                <div id="social-graph-view" style="display:none;">
                    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <span style="font-size:0.75rem;color:var(--text-dim);">Zoom: <span id="zoom-display">100%</span></span>
                        <button id="zoom-in-btn" class="small secondary">+</button>
                        <button id="zoom-out-btn" class="small secondary">-</button>
                        <button id="reset-zoom-btn" class="small secondary">⟲</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Click a node to view character details</span>
                    </div>
                    <div id="graph-container" style="width:100%;height:600px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;position:relative;cursor:grab;">
                        <svg id="social-svg" width="100%" height="100%" style="display:block;background:var(--bg);">
                            <g id="social-graph-transform"></g>
                        </svg>
                    </div>
                    <div id="graph-legend" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--panel-alt);border-radius:var(--radius);border:1px solid var(--border);">
                        <span style="font-size:0.7rem;color:var(--text-dim);font-weight:600;">Legend:</span>
                        <span id="legend-items"></span>
                    </div>
                </div>
            </div>

            <!-- Relationship Form Modal -->
            <div id="relationship-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="relationship-form-title">Add Relationship</h3>
                        <button class="close-modal" id="close-relationship-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="relationship-form-inner">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Character 1 *</label>
                                    <select id="rel-char1" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select character...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Character 2 *</label>
                                    <select id="rel-char2" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select character...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Relationship Type *</label>
                                    <select id="rel-type" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select type...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Clarification (e.g., aunt, sibling, boss)</label>
                                    <input type="text" id="rel-clarification" placeholder="e.g., aunt, sibling, boss" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group">
                                    <label>Start Year</label>
                                    <input type="number" id="rel-start-year" placeholder="e.g., 1920" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group">
                                    <label>End Year (optional)</label>
                                    <input type="number" id="rel-end-year" placeholder="e.g., 1930" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group full-width">
                                    <label>Notes</label>
                                    <textarea id="rel-notes" rows="3" placeholder="Additional notes about this relationship..." style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;resize:vertical;"></textarea>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-relationship-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-relationship-btn" class="primary">Save Relationship</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Character Detail Modal -->
            <div id="character-detail-modal" class="modal hidden">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h3 id="detail-char-name">Character</h3>
                        <button class="close-modal" id="close-char-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="char-detail-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function populateSocialSelectors() {
        var filterSelect = document.getElementById('social-character-filter');
        if (filterSelect) {
            var data = window.data || {};
            var chars = (data.characters || []).slice();
            var currentValue = filterSelect.value;
            filterSelect.innerHTML = '<option value="all">All Characters</option>';
            chars.sort(function(a, b) {
                var nameA = getDisplayName(a).toLowerCase();
                var nameB = getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            chars.forEach(function(c) {
                var name = getDisplayName(c);
                var option = document.createElement('option');
                option.value = c.id;
                option.textContent = name;
                filterSelect.appendChild(option);
            });
            if (currentValue) filterSelect.value = currentValue;
        }

        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter) {
            var types = getRelationshipTypes();
            var currentValue = typeFilter.value;
            typeFilter.innerHTML = '<option value="all">All Types</option>';
            types.forEach(function(t) {
                var option = document.createElement('option');
                option.value = t.id;
                option.textContent = t.label;
                typeFilter.appendChild(option);
            });
            if (currentValue) typeFilter.value = currentValue;
        }

        populateFormSelectors();
        populateTypeSelectors();
    }

    function populateFormSelectors() {
        var select1 = document.getElementById('rel-char1');
        var select2 = document.getElementById('rel-char2');
        if (!select1 || !select2) return;

        var data = window.data || {};
        var chars = (data.characters || []).slice();
        var current1 = select1.value;
        var current2 = select2.value;

        select1.innerHTML = '<option value="">Select character...</option>';
        select2.innerHTML = '<option value="">Select character...</option>';

        chars.sort(function(a, b) {
            var nameA = getDisplayName(a).toLowerCase();
            var nameB = getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        chars.forEach(function(c) {
            var name = getDisplayName(c);
            var option1 = document.createElement('option');
            option1.value = c.id;
            option1.textContent = name;
            select1.appendChild(option1);

            var option2 = document.createElement('option');
            option2.value = c.id;
            option2.textContent = name;
            select2.appendChild(option2);
        });

        if (current1) select1.value = current1;
        if (current2) select2.value = current2;
    }

    function populateTypeSelectors() {
        var typeSelect = document.getElementById('rel-type');
        if (!typeSelect) return;

        var types = getRelationshipTypes();
        var currentValue = typeSelect.value;
        typeSelect.innerHTML = '<option value="">Select type...</option>';
        types.forEach(function(t) {
            var option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label + (t.directional ? ' (→)' : '');
            typeSelect.appendChild(option);
        });
        // Don't auto-select - let the user choose intentionally
        if (currentValue) typeSelect.value = currentValue;
    }

    function renderRelationships() {
        var container = document.getElementById('relationships-container');
        var count = document.getElementById('relationship-count');
        if (!container) return;

        var charFilter = document.getElementById('social-character-filter') ? document.getElementById('social-character-filter').value : 'all';
        var typeFilter = document.getElementById('social-type-filter') ? document.getElementById('social-type-filter').value : 'all';

        var data = window.data || {};
        var relationships = data.social && data.social.relationships ? data.social.relationships.slice() : [];

        if (charFilter !== 'all') {
            relationships = relationships.filter(function(r) {
                return String(r.character1) === String(charFilter) || String(r.character2) === String(charFilter);
            });
        }
        if (typeFilter !== 'all') {
            relationships = relationships.filter(function(r) { return r.typeId === typeFilter; });
        }

        relationships.sort(function(a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        if (count) count.textContent = relationships.length;

        if (relationships.length === 0) {
            container.innerHTML = '<p class="empty-state">No relationships found. Add your first relationship!</p>';
            return;
        }

        var html = '';
        relationships.forEach(function(rel) {
            var char1 = getCharacterById(rel.character1);
            var char2 = getCharacterById(rel.character2);
            var name1 = char1 ? getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? getDisplayName(char2) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getSafeRelationshipColor(rel.typeId);
            var isDirectional = isRelationshipDirectional(rel.typeId);
            var directionArrow = isDirectional ? ' → ' : ' ↔ ';

            var period = '';
            if (rel.startYear && rel.endYear) {
                period = escapeHtml(rel.startYear) + ' - ' + escapeHtml(rel.endYear);
            } else if (rel.startYear) {
                period = 'From ' + escapeHtml(rel.startYear);
            }

            var clarificationDisplay = rel.clarification ? ' (' + escapeHtml(rel.clarification) + ')' : '';
            var notesDisplay = rel.notes ? ' 📝' : '';

            html += '<div class="list-item" style="grid-template-columns:1fr 1fr 0.8fr 1.2fr 1fr;border-left:3px solid ' + escapeHtml(typeColor) + ';" data-id="' + escapeHtml(rel.id) + '">';
            html += '<span><strong>' + escapeHtml(name1) + '</strong></span>';
            html += '<span><strong>' + escapeHtml(name2) + '</strong></span>';
            html += '<span style="color:' + escapeHtml(typeColor) + ';font-size:0.75rem;font-weight:600;">' + escapeHtml(typeLabel) + directionArrow + clarificationDisplay + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">' + period + notesDisplay + '</span>';
            html += '<span class="actions">' +
                '<button class="small edit-relationship" data-id="' + escapeHtml(rel.id) + '">Edit</button>' +
                '<button class="small danger delete-relationship" data-id="' + escapeHtml(rel.id) + '">Delete</button>' +
            '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.edit-relationship').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                showRelationshipForm(this.dataset.id);
            });
        });
        container.querySelectorAll('.delete-relationship').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.dataset.id;
                if (confirm('Delete this relationship permanently?')) {
                    var result = deleteRelationship(id);
                    if (result.success) {
                        renderRelationships();
                        if (isGraphViewVisible()) {
                            renderGraph();
                        }
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    } else {
                        showNotification(result.message, 'error');
                    }
                }
            });
        });
    }

    // ============================================================
    // GRAPH RENDERING    // ============================================================

    function renderGraph() {
        var svg = document.getElementById('social-svg');
        if (!svg) return;

        var transformGroup = svg.querySelector('#social-graph-transform');
        if (!transformGroup) {
            transformGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            transformGroup.id = 'social-graph-transform';
            svg.appendChild(transformGroup);
        }

        var container = document.getElementById('graph-container');
        if (!container) return;

        var width = container.clientWidth || 800;
        var height = container.clientHeight || 600;

        var data = window.data || {};
        var relationships = data.social && data.social.relationships ? data.social.relationships : [];

        if (relationships.length === 0) {
            transformGroup.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">No relationships to display</text>';
            return;
        }

        var nodeMap = Object.create(null);
        var nodes = [];
        relationships.forEach(function(r) {
            if (!nodeMap[r.character1]) {
                nodeMap[r.character1] = { id: r.character1, connections: 0 };
                nodes.push(nodeMap[r.character1]);
            }
            if (!nodeMap[r.character2]) {
                nodeMap[r.character2] = { id: r.character2, connections: 0 };
                nodes.push(nodeMap[r.character2]);
            }
            nodeMap[r.character1].connections++;
            nodeMap[r.character2].connections++;
        });

        if (nodes.length < 2) {
            transformGroup.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">Need at least 2 characters with relationships</text>';
            return;
        }

        var positions = calculatePositions(nodes, width, height);

        // Group relationships by pair to offset parallel edges
        var pairGroups = {};
        relationships.forEach(function(r) {
            var key1 = String(r.character1);
            var key2 = String(r.character2);
            var pairKey = key1 < key2 ? key1 + '|' + key2 : key2 + '|' + key1;
            if (!pairGroups[pairKey]) {
                pairGroups[pairKey] = [];
            }
            pairGroups[pairKey].push(r);
        });

        var html = '';

        // Draw relationship lines with offsets for parallel edges
        Object.keys(pairGroups).forEach(function(pairKey) {
            var rels = pairGroups[pairKey];
            var firstRel = rels[0];
            var pos1 = positions[firstRel.character1];
            var pos2 = positions[firstRel.character2];
            if (!pos1 || !pos2) return;

            var total = rels.length;

            rels.forEach(function(r, index) {
                var color = getSafeRelationshipColor(r.typeId);
                var typeLabel = getRelationshipTypeLabel(r.typeId);
                var clarification = r.clarification ? ' (' + r.clarification + ')' : '';
                var isDirectional = isRelationshipDirectional(r.typeId);

                // Calculate offset for parallel edges
                var offset = 0;
                if (total > 1) {
                    var offsetAmount = 8;
                    var midIndex = (total - 1) / 2;
                    offset = (index - midIndex) * offsetAmount;
                }

                var dx = pos2.x - pos1.x;
                var dy = pos2.y - pos1.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;

                // Perpendicular unit vector for offset
                var perpX = -dy / dist;
                var perpY = dx / dist;

                var x1 = pos1.x + perpX * offset;
                var y1 = pos1.y + perpY * offset;
                var x2 = pos2.x + perpX * offset;
                var y2 = pos2.y + perpY * offset;

                // Draw relationship line with offset
                html += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" ';
                html += 'stroke="' + escapeHtml(color) + '" stroke-width="2" opacity="0.6" />';

                // Direction arrow for directional relationships
                if (isDirectional) {
                    var angle = Math.atan2(y2 - y1, x2 - x1);
                    var nodeRadius = Math.max(20, Math.min(35, 20 + (nodeMap[r.character2] ? nodeMap[r.character2].connections * 3 : 20)));
                    var arrowDist = Math.max(0, dist - nodeRadius - 4);
                    var ratio = arrowDist / dist;

                    var arrowX = x1 + (x2 - x1) * ratio;
                    var arrowY = y1 + (y2 - y1) * ratio;

                    var arrowSize = 8;
                    html += '<polygon points="' +
                        (arrowX + arrowSize * Math.cos(angle - 0.4)) + ',' + (arrowY + arrowSize * Math.sin(angle - 0.4)) + ' ' +
                        (arrowX + arrowSize * Math.cos(angle + 0.4)) + ',' + (arrowY + arrowSize * Math.sin(angle + 0.4)) + ' ' +
                        (arrowX + arrowSize * 1.4 * Math.cos(angle)) + ',' + (arrowY + arrowSize * 1.4 * Math.sin(angle)) +
                        '" fill="' + escapeHtml(color) + '" opacity="0.8" />';
                }

                // Relationship label (only if visible, offset accordingly)
                var midX = (x1 + x2) / 2 + perpX * offset * 1.5;
                var midY = (y1 + y2) / 2 + perpY * offset * 1.5;
                var labelY = midY - 5 - (total > 1 ? (index - (total - 1) / 2) * 6 : 0);
                html += '<text x="' + midX + '" y="' + labelY + '" text-anchor="middle" fill="' + escapeHtml(color) + '" font-size="9" opacity="0.7">' + escapeHtml(typeLabel + clarification) + '</text>';
            });
        });

        nodes.forEach(function(node) {
            var pos = positions[node.id];
            if (!pos) return;

            var char = getCharacterById(node.id);
            var name = char ? getDisplayName(char) : 'Unknown';
            var status = char ? (typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '') : '';
            var radius = Math.max(20, Math.min(35, 20 + node.connections * 3));
            var color = getNodeColor(char);

            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="rgba(0,0,0,0.3)" opacity="0.3" />';
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="' + escapeHtml(color) + '" stroke="var(--border)" stroke-width="2" cursor="pointer" class="graph-node" data-id="' + escapeHtml(node.id) + '" />';

            var fontSize = Math.max(9, Math.min(13, radius * 0.6));
            var displayName = getGraphLabel(name);
            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" fill="var(--text)" font-size="' + fontSize + '" font-weight="600" pointer-events="none" class="graph-label">' + escapeHtml(displayName) + '</text>';

            if (status) {
                var statusColor = status === 'Deceased' ? 'var(--danger)' : 'var(--text-dim)';
                html += '<text x="' + pos.x + '" y="' + (pos.y + radius + 14) + '" text-anchor="middle" fill="' + statusColor + '" font-size="8" pointer-events="none">' + escapeHtml(status) + '</text>';
            }
        });

        transformGroup.innerHTML = html;

        transformGroup.querySelectorAll('.graph-node').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showCharacterDetail(id);
            });
        });

        updateLegend();

        applyGraphTransform(transformGroup, width, height);
    }

    function getGraphLabel(name) {
        if (!name) return '?';
        if (name.length <= 12) return name;

        // Try to create a short name with initials
        var parts = name.split(' ');
        if (parts.length >= 2) {
            var first = parts[0];
            var last = parts[parts.length - 1];
            // If first name is long, use initial
            if (first.length > 6) {
                var initial = first.charAt(0);
                return initial + '. ' + last;
            }
            return first + ' ' + last.charAt(0) + '.';
        }

        // Fallback: truncate
        return name.substring(0, 10) + '...';
    }

    function applyGraphTransform(transformGroup, width, height) {
        if (!transformGroup) {
            transformGroup = document.querySelector('#social-graph-transform');
            if (!transformGroup) return;
        }

        var scale = state.zoomLevel;
        var centerX = (width || 800) / 2;
        var centerY = (height || 600) / 2;

        transformGroup.setAttribute(
            'transform',
            'translate(' + centerX + ',' + centerY + ') ' +
            'scale(' + scale + ') ' +
            'translate(' + (-centerX) + ',' + (-centerY) + ')'
        );
    }

    function calculatePositions(nodes, width, height) {
        var positions = Object.create(null);
        var centerX = width / 2;
        var centerY = height / 2;
        var radius = Math.min(width, height) * 0.35;

        if (nodes.length === 2) {
            positions[nodes[0].id] = { x: centerX - radius * 0.6, y: centerY };
            positions[nodes[1].id] = { x: centerX + radius * 0.6, y: centerY };
            return positions;
        }

        var angleStep = (2 * Math.PI) / nodes.length;
        nodes.forEach(function(node, index) {
            var angle = angleStep * index - Math.PI / 2;
            var dist = radius * (0.6 + 0.4 * (1 - node.connections / (nodes.length + 5)));
            positions[node.id] = {
                x: centerX + dist * Math.cos(angle),
                y: centerY + dist * Math.sin(angle)
            };
        });

        return positions;
    }

    function getNodeColor(char) {
        if (!char) return '#7f8c8d';
        if (char.deceased) return '#666666';

        var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char).toLowerCase() : '';
        var colorMap = {
            'instructor': '#9b59b6',
            'senior': '#c9a24b',
            'junior': '#4a9bc7',
            'rookie': '#27ae60',
            'trainee': '#8cbb3a',
            'support': '#e67e22',
            'civilian': '#7f8c8d'
        };
        return colorMap[status] || '#7f8c8d';
    }

    function updateLegend() {
        var container = document.getElementById('legend-items');
        if (!container) return;

        var types = getRelationshipTypes();
        var html = '';
        types.forEach(function(t) {
            var safeColor = getSafeColor(t.color);
            html += '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;">';
            html += '<span style="display:inline-block;width:12px;height:4px;background:' + escapeHtml(safeColor) + ';border-radius:2px;"></span>';
            html += escapeHtml(t.label) + (t.directional ? ' →' : '');
            html += '</span>';
        });
        container.innerHTML = html;
    }

    // ============================================================
    // CHARACTER DETAIL
    // ============================================================

    function showCharacterDetail(charId) {
        var char = getCharacterById(charId);
        if (!char) return;

        var modal = document.getElementById('character-detail-modal');
        if (!modal) return;

        var content = document.getElementById('char-detail-content');
        var title = document.getElementById('detail-char-name');

        if (!content || !title) return;

        var name = getDisplayName(char);
        title.textContent = name;

        var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
        var age = typeof window.getCharacterAge === 'function' ? window.getCharacterAge(char) : '-';
        var connections = getConnectedCharacters(charId);

        var html = '<div style="margin-bottom:12px;">';
        html += '<div class="detail-row"><span class="label">Status:</span> <span>' + escapeHtml(status) + '</span></div>';
        html += '<div class="detail-row"><span class="label">Age:</span> <span>' + escapeHtml(age) + '</span></div>';
        if (char.deceased) {
            html += '<div class="detail-row"><span class="label">Deceased:</span> <span style="color:var(--danger);">Yes</span></div>';
        }
        html += '</div>';

        if (connections.length > 0) {
            html += '<h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Connections (' + connections.length + ')</h4>';
            html += '<div style="display:flex;flex-direction:column;gap:4px;">';

            var targetCharId = String(charId);

            connections.forEach(function(conn) {
                var charName = getDisplayName(conn.character);
                html += '<div style="background:var(--bg);border-radius:4px;padding:4px 8px;">';
                html += '<div style="font-size:0.8rem;"><strong>' + escapeHtml(charName) + '</strong></div>';

                conn.relationships.forEach(function(rel) {
                    var typeLabel = getRelationshipTypeLabel(rel.typeId);
                    var typeColor = getSafeRelationshipColor(rel.typeId);
                    var isDirectional = isRelationshipDirectional(rel.typeId);

                    // Calculate direction relative to the selected character
                    var isSource = String(rel.character1) === targetCharId;
                    var directionText;
                    if (isDirectional) {
                        directionText = isSource ? ' → ' : ' ← ';
                    } else {
                        directionText = ' ↔ ';
                    }

                    var period = '';
                    if (rel.startYear && rel.endYear) {
                        period = escapeHtml(rel.startYear) + ' - ' + escapeHtml(rel.endYear);
                    } else if (rel.startYear) {
                        period = 'From ' + escapeHtml(rel.startYear);
                    }
                    var clarification = rel.clarification ? ' (' + escapeHtml(rel.clarification) + ')' : '';

                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px;margin:2px 0;border-left:2px solid ' + escapeHtml(typeColor) + ';font-size:0.7rem;">';
                    html += '<span style="color:' + escapeHtml(typeColor) + ';">' + directionText + escapeHtml(typeLabel) + clarification + '</span>';
                    html += '<span style="color:var(--text-dim);">' + period + '</span>';
                    html += '</div>';
                });

                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No connections</p>';
        }

        html += '<div style="margin-top:12px;">';
        html += '<button id="view-char-relationships" class="small primary" data-id="' + escapeHtml(charId) + '">View All Relationships</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');

        var viewBtn = content.querySelector('#view-char-relationships');
        if (viewBtn) {
            viewBtn.addEventListener('click', function() {
                var id = this.dataset.id;
                closeCharacterDetail();
                var filter = document.getElementById('social-character-filter');
                if (filter) filter.value = id;
                renderRelationships();
            });
        }
    }

    function closeCharacterDetail() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // VIEW MODE
    // ============================================================

    function setViewMode(mode) {
        var listView = document.getElementById('social-list-view');
        var graphView = document.getElementById('social-graph-view');

        if (!listView || !graphView) return;

        state.viewMode = mode;

        if (mode === 'list') {
            listView.style.display = 'block';
            graphView.style.display = 'none';
        } else {
            listView.style.display = 'none';
            graphView.style.display = 'block';
            setTimeout(renderGraph, 100);
        }
    }

    // ============================================================
    // FORM HANDLING
    // ============================================================

    function showRelationshipForm(editId, characterId) {
        var modal = document.getElementById('relationship-form-modal');
        var title = document.getElementById('relationship-form-title');
        var form = document.getElementById('relationship-form-inner');

        if (!modal || !title || !form) return;

        delete form.dataset.editId;

        populateFormSelectors();
        populateTypeSelectors();

        // Don't auto-select type - let user choose intentionally
        var typeSelect = document.getElementById('rel-type');
        if (typeSelect) {
            typeSelect.value = '';
        }

        if (editId) {
            title.textContent = 'Edit Relationship';

            var data = window.data || {};
            var rel = data.social && Array.isArray(data.social.relationships)
                ? data.social.relationships.find(function(r) {
                    return r && String(r.id) === String(editId);
                })
                : null;

            if (!rel) {
                showNotification('Relationship not found.', 'error');
                return;
            }

            document.getElementById('rel-char1').value = rel.character1 || '';
            document.getElementById('rel-char2').value = rel.character2 || '';
            document.getElementById('rel-type').value = rel.typeId || '';
            document.getElementById('rel-clarification').value = rel.clarification || '';
            document.getElementById('rel-start-year').value = rel.startYear || '';
            document.getElementById('rel-end-year').value = rel.endYear || '';
            document.getElementById('rel-notes').value = rel.notes || '';

            form.dataset.editId = editId;
        } else {
            title.textContent = 'Add Relationship';
            form.reset();

            if (characterId) {
                document.getElementById('rel-char1').value = characterId;
            }
        }

        modal.classList.remove('hidden');
    }

    function saveRelationship(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var char1 = document.getElementById('rel-char1').value;
        var char2 = document.getElementById('rel-char2').value;
        var typeId = document.getElementById('rel-type').value;
        var clarification = document.getElementById('rel-clarification').value.trim();
        var startYear = document.getElementById('rel-start-year').value;
        var endYear = document.getElementById('rel-end-year').value;
        var notes = document.getElementById('rel-notes').value.trim();

        if (editId) {
            var result = updateRelationship(editId, {
                character1: char1,
                character2: char2,
                typeId: typeId,
                clarification: clarification,
                startYear: startYear,
                endYear: endYear,
                notes: notes
            });

            if (result.success) {
                closeRelationshipForm();
                renderRelationships();
                if (isGraphViewVisible()) {
                    renderGraph();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            } else {
                showNotification(result.message, 'error');
            }
        } else {
            var result = createRelationship(char1, char2, typeId, startYear, endYear, clarification, notes);
            if (result.success) {
                closeRelationshipForm();
                renderRelationships();
                if (isGraphViewVisible()) {
                    renderGraph();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            } else {
                showNotification(result.message, 'error');
            }
        }
    }

    function closeRelationshipForm() {
        var modal = document.getElementById('relationship-form-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initSocialEvents() {
        var addBtn = document.getElementById('add-relationship-btn');
        if (addBtn && !addBtn._listener) {
            addBtn._listener = true;
            addBtn.addEventListener('click', function() { showRelationshipForm(); });
        }

        var graphBtn = document.getElementById('view-graph-btn');
        if (graphBtn && !graphBtn._listener) {
            graphBtn._listener = true;
            graphBtn.addEventListener('click', function() { setViewMode('graph'); });
        }

        var listBtn = document.getElementById('view-list-btn');
        if (listBtn && !listBtn._listener) {
            listBtn._listener = true;
            listBtn.addEventListener('click', function() { setViewMode('list'); });
        }

        var closeFormBtn = document.getElementById('close-relationship-form');
        if (closeFormBtn && !closeFormBtn._listener) {
            closeFormBtn._listener = true;
            closeFormBtn.addEventListener('click', closeRelationshipForm);
        }

        var cancelFormBtn = document.getElementById('cancel-relationship-form');
        if (cancelFormBtn && !cancelFormBtn._listener) {
            cancelFormBtn._listener = true;
            cancelFormBtn.addEventListener('click', closeRelationshipForm);
        }

        var formModal = document.getElementById('relationship-form-modal');
        if (formModal && !formModal._outsideListener) {
            formModal._outsideListener = true;
            formModal.addEventListener('click', function(e) {
                if (e.target === this) closeRelationshipForm();
            });
        }

        var form = document.getElementById('relationship-form-inner');
        if (form && !form._listener) {
            form._listener = true;
            form.addEventListener('submit', saveRelationship);
        }

        var charFilter = document.getElementById('social-character-filter');
        if (charFilter && !charFilter._listener) {
            charFilter._listener = true;
            charFilter.addEventListener('change', renderRelationships);
        }

        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter && !typeFilter._listener) {
            typeFilter._listener = true;
            typeFilter.addEventListener('change', renderRelationships);
        }

        var clearFilters = document.getElementById('clear-social-filters');
        if (clearFilters && !clearFilters._listener) {
            clearFilters._listener = true;
            clearFilters.addEventListener('click', function() {
                var filter = document.getElementById('social-character-filter');
                if (filter) filter.value = 'all';
                var type = document.getElementById('social-type-filter');
                if (type) type.value = 'all';
                renderRelationships();
            });
        }

        var zoomInBtn = document.getElementById('zoom-in-btn');
        if (zoomInBtn && !zoomInBtn._listener) {
            zoomInBtn._listener = true;
            zoomInBtn.addEventListener('click', function() {
                state.zoomLevel = Math.min(2, state.zoomLevel + 0.1);
                updateZoomDisplay();
                renderGraph();
            });
        }

        var zoomOutBtn = document.getElementById('zoom-out-btn');
        if (zoomOutBtn && !zoomOutBtn._listener) {
            zoomOutBtn._listener = true;
            zoomOutBtn.addEventListener('click', function() {
                state.zoomLevel = Math.max(0.5, state.zoomLevel - 0.1);
                updateZoomDisplay();
                renderGraph();
            });
        }

        var resetZoomBtn = document.getElementById('reset-zoom-btn');
        if (resetZoomBtn && !resetZoomBtn._listener) {
            resetZoomBtn._listener = true;
            resetZoomBtn.addEventListener('click', function() {
                state.zoomLevel = 1;
                updateZoomDisplay();
                renderGraph();
            });
        }

        var closeDetailBtn = document.getElementById('close-char-detail');
        if (closeDetailBtn && !closeDetailBtn._listener) {
            closeDetailBtn._listener = true;
            closeDetailBtn.addEventListener('click', closeCharacterDetail);
        }

        var detailModal = document.getElementById('character-detail-modal');
        if (detailModal && !detailModal._outsideListener) {
            detailModal._outsideListener = true;
            detailModal.addEventListener('click', function(e) {
                if (e.target === this) closeCharacterDetail();
            });
        }

        if (!_resizeListenerAttached) {
            _resizeListenerAttached = true;
            window.addEventListener('resize', function() {
                if (isGraphViewVisible()) {
                    var svg = document.getElementById('social-svg');
                    if (svg) {
                        var container = document.getElementById('graph-container');
                        if (container) {
                            svg.setAttribute('width', container.clientWidth);
                            svg.setAttribute('height', container.clientHeight);
                        }
                    }
                    setTimeout(renderGraph, 200);
                }
            });
        }
    }

    function updateZoomDisplay() {
        var display = document.getElementById('zoom-display');
        if (display) display.textContent = Math.round(state.zoomLevel * 100) + '%';
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('social', renderSocialView);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-social');
        if (container && container.style.display !== 'none') {
            renderSocialView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'social') {
            var container = document.getElementById('tab-social');
            if (container) {
                renderSocialView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-social');
            if (container && container.style.display !== 'none') {
                renderSocialView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderSocialView = renderSocialView;
    window.populateSocialSelectors = populateSocialSelectors;
    window.populateFormSelectors = populateFormSelectors;
    window.populateTypeSelectors = populateTypeSelectors;
    window.getRelationshipTypes = getRelationshipTypes;
    window.getRelationshipTypeLabel = getRelationshipTypeLabel;
    window.getRelationshipTypeColor = getRelationshipTypeColor;
    window.getCharacterRelationships = getCharacterRelationships;
    window.getConnectedCharacters = getConnectedCharacters;
    window.getAllRelationshipsBetween = getAllRelationshipsBetween;
    window.relationshipExists = relationshipExists;
    window.createRelationship = createRelationship;
    window.updateRelationship = updateRelationship;
    window.deleteRelationship = deleteRelationship;
    window.renderRelationships = renderRelationships;
    window.renderGraph = renderGraph;
    window.showCharacterDetail = showCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.setViewMode = setViewMode;
    window.showRelationshipForm = showRelationshipForm;
    window.saveRelationship = saveRelationship;
    window.closeRelationshipForm = closeRelationshipForm;
    window.initSocialEvents = initSocialEvents;
    window.socialState = state;
    window.escapeHtml = escapeHtml;
    window.getSafeColor = getSafeColor;
    window.getSafeRelationshipColor = getSafeRelationshipColor;

})();
