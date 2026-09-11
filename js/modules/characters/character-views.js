/**
 * js/modules/characters/character-views.js - Character Views
 * Renders the Social tab inside the Character form.
 * Path: js/modules/characters/character-views.js
 * 
 * This module is responsible for:
 *   - Rendering the character's relationships grouped by type
 *   - Collapsible group sections (state kept per render session)
 *   - Ongoing / Ended subsections within each type
 *   - Inline directional arrows for directional relationship types
 *   - The "Add / Edit Relationship" modal form
 *   - The character SVG network graph modal
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no data mutation
 *   - No direct window.data access - uses SocialQueries
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for display names
 *   - Uses DomUtils for safe escaping
 *   - Uses SocialCore only for reading the relationship-by-id (read path)
 */

(function() {
    'use strict';

    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getSocialConstants() { return window.SocialConstants || null; }
    function getSocialGraph() { return window.SocialGraph || null; }
    function getDomUtils() { return window.DomUtils || null; }

    // ============================================================
    // STATE - collapse state per (charId, typeId)
    // ============================================================

    var _collapsedGroups = Object.create(null);  // key = charId + '|' + typeId

    function getGroupKey(charId, typeId) {
        return String(charId) + '|' + String(typeId);
    }

    function isGroupCollapsed(charId, typeId) {
        return _collapsedGroups[getGroupKey(charId, typeId)] === true;
    }

    function setGroupCollapsed(charId, typeId, collapsed) {
        var key = getGroupKey(charId, typeId);
        if (collapsed) {
            _collapsedGroups[key] = true;
        } else {
            delete _collapsedGroups[key];
        }
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // HELPERS - Relationship display
    // ============================================================

    function getCharacterName(charId) {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || !charId) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        return char ? CharacterQueries.getDisplayName(char) : 'Unknown';
    }

    /**
     * Determine the "other" character in a relationship relative to the context char.
     */
    function getOtherCharacterId(relationship, charId) {
        if (!relationship || !charId) { return null; }
        var target = String(charId);
        if (String(relationship.character1) === target) {
            return relationship.character2;
        }
        if (String(relationship.character2) === target) {
            return relationship.character1;
        }
        return null;
    }

    /**
     * Determine the direction glyph to show next to the other character.
     * - Undirected: ↔
     * - Directional: → if the context character is the source
     *                ← if the context character is the target
     */
    function getDirectionGlyph(relationship, charId) {
        var SocialConstants = getSocialConstants();
        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            return '↔';
        }
        if (!SocialConstants.isDirectional(relationship.typeId)) {
            return '↔';
        }
        if (String(relationship.character1) === String(charId)) {
            return '→';
        }
        return '←';
    }

    // ============================================================
    // RENDER - Main entry point for the character Social tab
    // ============================================================

    /**
     * Render the character's social relationships into #character-social-view.
     * 
     * @param {object|null} char - Character object, or null for empty state
     */
    function renderCharacterSocial(char) {
        var container = document.getElementById('character-social-view');
        if (!container) { return; }

        container.textContent = '';

        if (!char || !char.id) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Select a character to view relationships.</p>';
            return;
        }

        var SocialQueries = getSocialQueries();
        var SocialConstants = getSocialConstants();

        if (!SocialQueries || !SocialConstants) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Social module not loaded.</p>';
            return;
        }

        var relationships = SocialQueries.getCharacterRelationships(char.id) || [];

        if (relationships.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No relationships recorded yet. Use <strong>+ Add Relationship</strong> to create one.</p>';
            return;
        }

        // ---- Group by type ----
        var byType = Object.create(null);
        relationships.forEach(function(rel) {
            if (!rel || !rel.typeId) { return; }
            if (!byType[rel.typeId]) {
                byType[rel.typeId] = [];
            }
            byType[rel.typeId].push(rel);
        });

        // ---- Sort types alphabetically by label ----
        var typeIds = Object.keys(byType).sort(function(a, b) {
            var la = SocialConstants.getLabel(a) || a;
            var lb = SocialConstants.getLabel(b) || b;
            return la.localeCompare(lb);
        });

        // ---- Build HTML ----
        var html = '<div class="relationship-groups" style="display:flex;flex-direction:column;gap:8px;">';

        typeIds.forEach(function(typeId) {
            html += renderTypeGroup(char.id, typeId, byType[typeId]);
        });

        html += '</div>';

        container.innerHTML = html;
    }

    /**
     * Render one relationship type group (collapsible).
     */
    function renderTypeGroup(charId, typeId, relationships) {
        var SocialConstants = getSocialConstants();
        var label = SocialConstants && typeof SocialConstants.getLabel === 'function'
            ? SocialConstants.getLabel(typeId)
            : typeId;
        var color = SocialConstants && typeof SocialConstants.getColor === 'function'
            ? SocialConstants.getColor(typeId)
            : '#7f8c8d';

        // Split into ongoing and ended
        var ongoing = [];
        var ended = [];
        relationships.forEach(function(rel) {
            if (rel && rel.endYear !== undefined && rel.endYear !== null && String(rel.endYear).trim() !== '') {
                ended.push(rel);
            } else {
                ongoing.push(rel);
            }
        });

        var isCollapsed = isGroupCollapsed(charId, typeId);
        var caret = isCollapsed ? '▸' : '▾';
        var bodyDisplay = isCollapsed ? 'none' : 'block';

        var count = relationships.length;

        var html = '';
        html += '<div class="relationship-group" data-type="' + escapeAttribute(typeId) + '" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:6px;overflow:hidden;">';

        // Header
        html += '<div class="relationship-group-header" style="display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;background:var(--panel);border-left:3px solid ' + escapeAttribute(color) + ';">';
        html += '<span class="relationship-group-caret" style="font-size:0.7rem;color:var(--text-dim);width:12px;display:inline-block;">' + caret + '</span>';
        html += '<span style="font-size:0.75rem;font-weight:600;color:' + escapeAttribute(color) + ';">' + escapeHtml(label) + '</span>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">(' + count + ')</span>';
        html += '</div>';

        // Body
        html += '<div class="relationship-group-body" style="display:' + bodyDisplay + ';padding:6px 10px;">';

        if (ongoing.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;">Ongoing</div>';
            ongoing.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        if (ended.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0 4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;margin-top:6px;">Ended</div>';
            ended.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        html += '</div>';  // body
        html += '</div>';  // group

        return html;
    }

    /**
     * Render a single relationship row.
     */
    function renderRelationshipRow(charId, rel, color) {
        var otherId = getOtherCharacterId(rel, charId);
        var otherName = getCharacterName(otherId);
        var arrow = getDirectionGlyph(rel, charId);

        var title = rel.clarification ? String(rel.clarification) : '';

        // Period display
        var startYear = rel.startYear ? String(rel.startYear) : '';
        var endYear = rel.endYear ? String(rel.endYear) : '';
        var periodDisplay = '';
        if (startYear && endYear) {
            periodDisplay = startYear + ' – ' + endYear;
        } else if (startYear) {
            periodDisplay = 'from ' + startYear;
        } else if (endYear) {
            periodDisplay = 'until ' + endYear;
        }

        var html = '';
        html += '<div class="relationship-row" style="display:flex;align-items:center;gap:6px;padding:4px 0 4px 18px;font-size:0.72rem;">';

        // Other character + arrow + title
        html += '<span style="flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
        html += '<span style="font-weight:600;">' + escapeHtml(otherName) + '</span>';
        html += '<span style="color:var(--text-dim);font-size:0.9rem;">' + arrow + '</span>';
        if (title) {
            html += '<span style="color:' + escapeAttribute(color) + ';font-size:0.7rem;">' + escapeHtml(title) + '</span>';
        }
        html += '</span>';

        // Period
        if (periodDisplay) {
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(periodDisplay) + '</span>';
        }

        // Actions
        html += '<span style="display:flex;gap:4px;">';
        html += '<button type="button" class="edit-char-relationship small" data-rel-id="' + escapeAttribute(rel.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Edit">✎</button>';
        html += '<button type="button" class="delete-char-relationship small danger" data-rel-id="' + escapeAttribute(rel.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Delete">✕</button>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // RELATIONSHIP FORM (Modal contents)
    // ============================================================

    /**
     * Build the relationship form HTML.
     * 
     * @param {string} charId - The current character id (locked as one side)
     * @param {object|null} existingRel - Existing relationship for edit mode
     * @returns {string} Form HTML
     */
    function buildRelationshipFormHTML(charId, existingRel) {
        var CharacterQueries = getCharacterQueries();
        var SocialConstants = getSocialConstants();

        if (!CharacterQueries || !SocialConstants) {
            return '<p class="empty-state">Dependencies not loaded.</p>';
        }

        var characters = CharacterQueries.getCharacters() || [];
        var currentChar = CharacterQueries.getCharacterById(charId);
        var currentCharName = currentChar ? CharacterQueries.getDisplayName(currentChar) : 'Unknown';

        // Sort characters alphabetically
        var sortedChars = characters.slice().sort(function(a, b) {
            return CharacterQueries.getDisplayName(a).localeCompare(
                CharacterQueries.getDisplayName(b)
            );
        });

        // Determine current values
        var char1Value = existingRel ? String(existingRel.character1) : String(charId);
        var char2Value = existingRel ? String(existingRel.character2) : '';
        var typeValue = existingRel ? existingRel.typeId : '';
        var titleValue = existingRel ? (existingRel.clarification || '') : '';
        var startValue = existingRel ? (existingRel.startYear || '') : '';
        var endValue = existingRel ? (existingRel.endYear || '') : '';
        var notesValue = existingRel ? (existingRel.notes || '') : '';

        // Build character option lists
        var char1Options = buildCharacterOptions(sortedChars, char1Value, currentCharName, false);
        var char2Options = buildCharacterOptions(sortedChars, char2Value, null, true);

        // Build type options
        var types = SocialConstants.getRelationshipTypes ? SocialConstants.getRelationshipTypes() : [];
        var typeOptions = '<option value="">Select type...</option>';
        types.forEach(function(t) {
            var sel = t.id === typeValue ? ' selected' : '';
            var dirIndicator = t.directional ? ' (→)' : '';
            typeOptions += '<option value="' + escapeAttribute(t.id) + '"' + sel + '>' + escapeHtml(t.label + dirIndicator) + '</option>';
        });

        // Build the form
        var html = '';
        html += '<form id="character-relationship-form">';

        // Character 1 (search + select)
        html += '<div class="form-group" style="margin-bottom:8px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Character 1 *</label>';
        html += '<input type="text" id="rel-char1-search" placeholder="Type to filter..." style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;margin-bottom:4px;">';
        html += '<select id="rel-char1" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += char1Options;
        html += '</select>';
        html += '</div>';

        // Character 2 (search + select)
        html += '<div class="form-group" style="margin-bottom:8px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Character 2 *</label>';
        html += '<input type="text" id="rel-char2-search" placeholder="Type to filter..." style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;margin-bottom:4px;">';
        html += '<select id="rel-char2" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += char2Options;
        html += '</select>';
        html += '</div>';

        // Type
        html += '<div class="form-group" style="margin-bottom:8px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Relationship Type *</label>';
        html += '<select id="rel-type" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += typeOptions;
        html += '</select>';
        html += '</div>';

        // Title
        html += '<div class="form-group" style="margin-bottom:8px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Title</label>';
        html += '<input type="text" id="rel-title" placeholder="e.g., mother, best friend, boss" value="' + escapeAttribute(titleValue) + '" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '</div>';

        // Years (start / end)
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">';
        html += '<div class="form-group">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Start Year</label>';
        html += '<input type="number" id="rel-start-year" placeholder="e.g., 1900" value="' + escapeAttribute(startValue) + '" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">End Year (optional)</label>';
        html += '<input type="number" id="rel-end-year" placeholder="Leave empty if ongoing" value="' + escapeAttribute(endValue) + '" style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '</div>';
        html += '</div>';

        // Notes
        html += '<div class="form-group" style="margin-bottom:12px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Notes</label>';
        html += '<textarea id="rel-notes" rows="3" placeholder="Additional context..." style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;resize:vertical;">' + escapeHtml(notesValue) + '</textarea>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;">';
        html += '<button type="button" id="cancel-char-relationship-modal" class="secondary" style="font-size:0.7rem;padding:4px 12px;">Cancel</button>';
        html += '<button type="submit" class="primary" style="font-size:0.7rem;padding:4px 12px;">Save</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    /**
     * Build the <option> list for a character select.
     */
    function buildCharacterOptions(sortedChars, selectedId, lockedName, includeEmpty) {
        var html = '';
        if (includeEmpty) {
            html += '<option value="">Select character...</option>';
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) { return html; }

        var foundSelected = false;
        sortedChars.forEach(function(c) {
            if (!c || !c.id) { return; }
            var name = CharacterQueries.getDisplayName(c);
            var isSelected = String(c.id) === String(selectedId);
            if (isSelected) { foundSelected = true; }
            html += '<option value="' + escapeAttribute(c.id) + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(name) + '</option>';
        });

        // If a locked name was requested but no match (e.g. self not in list), add manually
        if (!foundSelected && selectedId) {
            var name = lockedName || 'Unknown';
            html += '<option value="' + escapeAttribute(selectedId) + '" selected>' + escapeHtml(name) + '</option>';
        }

        return html;
    }

    // ============================================================
    // GRAPH MODAL
    // ============================================================

    /**
     * Build the graph modal shell HTML.
     * Returned as a single root element string.
     */
    function buildGraphModalHTML() {
        var html = '';
        html += '<div id="character-graph-modal" class="modal hidden" style="display:none;">';
        html += '<div class="modal-content wide" style="max-width:900px;">';
        html += '<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<h3 style="margin:0;color:var(--accent);font-size:0.95rem;">Character Network</h3>';
        html += '<button type="button" id="close-char-graph-modal" class="close-modal" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer;">×</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<div id="character-graph-container" style="width:100%;height:500px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;position:relative;">';
        html += '<svg id="character-graph-svg" width="100%" height="100%" style="display:block;background:var(--bg);">';
        html += '<g id="character-graph-transform"></g>';
        html += '</svg>';
        html += '</div>';
        html += '<div id="character-graph-legend" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--panel-alt);border-radius:var(--radius);border:1px solid var(--border);">';
        html += '<span style="font-size:0.7rem;color:var(--text-dim);font-weight:600;">Legend:</span>';
        html += '<span id="character-graph-legend-items"></span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    /**
     * Render the character's network graph.
     * Delegates to SocialGraph if it supports a char-scoped render.
     * Otherwise renders an inline scoped graph here.
     */
    function renderCharacterGraph(charId) {
        var svg = document.getElementById('character-graph-svg');
        var transformGroup = document.getElementById('character-graph-transform');
        var container = document.getElementById('character-graph-container');
        if (!svg || !transformGroup || !container) { return; }

        var SocialQueries = getSocialQueries();
        var SocialConstants = getSocialConstants();
        var CharacterQueries = getCharacterQueries();
        if (!SocialQueries || !SocialConstants || !CharacterQueries) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">Dependencies not loaded</text>';
            return;
        }

        var relationships = SocialQueries.getCharacterRelationships(charId) || [];
        if (relationships.length === 0) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">No relationships to display</text>';
            renderGraphLegend([], null);
            return;
        }

        // ---- Build node set (this char + everyone connected to them) ----
        var nodeSet = Object.create(null);
        nodeSet[String(charId)] = true;
        relationships.forEach(function(rel) {
            if (!rel) { return; }
            nodeSet[String(rel.character1)] = true;
            nodeSet[String(rel.character2)] = true;
        });

        var nodeIds = Object.keys(nodeSet);
        if (nodeIds.length < 2) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">No connections yet</text>';
            renderGraphLegend([], charId);
            return;
        }

        // ---- Compute positions on a circle ----
        var width = container.clientWidth || 800;
        var height = container.clientHeight || 500;
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        var centerX = width / 2;
        var centerY = height / 2;

        // Context char is at center; other nodes on circle
        var others = nodeIds.filter(function(id) { return id !== String(charId); });
        var radius = Math.min(width, height) * 0.35;

        var positions = Object.create(null);
        positions[String(charId)] = { x: centerX, y: centerY };

        others.forEach(function(id, i) {
            var angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
            positions[id] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        });

        // ---- Build SVG content ----
        var html = '';

        // Edges
        relationships.forEach(function(rel) {
            if (!rel) { return; }
            var p1 = positions[String(rel.character1)];
            var p2 = positions[String(rel.character2)];
            if (!p1 || !p2) { return; }

            var color = SocialConstants.getColor(rel.typeId) || '#7f8c8d';
            var isDir = SocialConstants.isDirectional(rel.typeId);

            html += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y + '" stroke="' + escapeAttribute(color) + '" stroke-width="2" opacity="0.6" />';

            // Directional arrowhead
            if (isDir) {
                var dx = p2.x - p1.x;
                var dy = p2.y - p1.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;
                var angle = Math.atan2(dy, dx);
                var arrowSize = 9;
                var arrowDist = Math.max(0, dist - 22);
                var ratio = Math.min(1, arrowDist / dist);
                var ax = p1.x + (p2.x - p1.x) * ratio;
                var ay = p1.y + (p2.y - p1.y) * ratio;

                html += '<polygon points="' +
                    (ax + arrowSize * Math.cos(angle - 0.4)) + ',' + (ay + arrowSize * Math.sin(angle - 0.4)) + ' ' +
                    (ax + arrowSize * Math.cos(angle + 0.4)) + ',' + (ay + arrowSize * Math.sin(angle + 0.4)) + ' ' +
                    (ax + arrowSize * 1.4 * Math.cos(angle)) + ',' + (ay + arrowSize * 1.4 * Math.sin(angle)) +
                    '" fill="' + escapeAttribute(color) + '" opacity="0.8" />';
            }
        });

        // Nodes
        nodeIds.forEach(function(id) {
            var pos = positions[id];
            if (!pos) { return; }
            var char = CharacterQueries.getCharacterById(id);
            var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
            var isCenter = String(id) === String(charId);

            // Count connections
            var connCount = 0;
            relationships.forEach(function(rel) {
                if (!rel) { return; }
                if (String(rel.character1) === id || String(rel.character2) === id) {
                    connCount++;
                }
            });

            var r = isCenter
                ? Math.max(28, Math.min(40, 28 + connCount * 2))
                : Math.max(20, Math.min(32, 20 + connCount * 2));

            var fill = isCenter ? '#8cbb3a' : '#4a9bc7';
            var stroke = isCenter ? '#6a9b2a' : '#3a7ba7';

            // Short label
            var label = name;
            if (label.length > 12) {
                var parts = label.split(' ');
                if (parts.length >= 2) {
                    var first = parts[0];
                    var last = parts[parts.length - 1];
                    label = (first.length > 6 ? first.charAt(0) + '. ' + last : first + ' ' + last.charAt(0) + '.');
                } else {
                    label = label.substring(0, 10) + '...';
                }
            }

            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + (r + 3) + '" fill="rgba(0,0,0,0.3)" />';
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" />';
            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" fill="var(--text)" font-size="' + Math.max(9, r * 0.5) + '" font-weight="600" pointer-events="none">' + escapeHtml(label) + '</text>';
        });

        transformGroup.innerHTML = html;

        // ---- Legend ----
        var usedTypeIds = Object.create(null);
        relationships.forEach(function(rel) {
            if (rel && rel.typeId) { usedTypeIds[rel.typeId] = true; }
        });
        renderGraphLegend(Object.keys(usedTypeIds), charId);
    }

    function renderGraphLegend(typeIds, charId) {
        var legendItems = document.getElementById('character-graph-legend-items');
        if (!legendItems) { return; }
        legendItems.textContent = '';

        var SocialConstants = getSocialConstants();
        if (!SocialConstants) { return; }

        typeIds.forEach(function(typeId) {
            var label = SocialConstants.getLabel(typeId);
            var color = SocialConstants.getColor(typeId);
            var isDir = SocialConstants.isDirectional(typeId);

            var span = document.createElement('span');
            span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;';

            var swatch = document.createElement('span');
            swatch.style.cssText = 'display:inline-block;width:12px;height:4px;background:' + color + ';border-radius:2px;';
            span.appendChild(swatch);

            var text = document.createElement('span');
            text.textContent = label + (isDir ? ' →' : '');
            span.appendChild(text);

            legendItems.appendChild(span);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterViews = {
        // Social tab
        renderCharacterSocial: renderCharacterSocial,

        // Modal contents
        buildRelationshipFormHTML: buildRelationshipFormHTML,
        buildGraphModalHTML: buildGraphModalHTML,

        // Graph
        renderCharacterGraph: renderCharacterGraph,

        // Utilities (exposed for testing)
        clearCollapseState: function() {
            _collapsedGroups = Object.create(null);
        }
    };

    console.log('[CharacterViews] Loaded.');

})();
