/**
 * modules/social/social-views.js - Social Views
 * Rendering functions for the social/relationship domain
 * Path: js/modules/social/social-views.js
 * 
 * This module provides:
 *   - renderSocialView - Main render entry point
 *   - getSocialHTML - Static HTML shell
 *   - populateSocialSelectors - Filter dropdowns
 *   - populateFormSelectors - Form dropdowns
 *   - populateTypeSelectors - Type dropdowns
 *   - renderRelationships - Relationship list
 *   - renderCharacterDetailContent - Detail modal content
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses SocialQueries
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for character data
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No inline event binding here (delegated to SocialEvents)
 * 
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var SV = window.SocialViews;
 *   SV.renderSocialView(container);
 *   SV.renderRelationships();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialViewsLoaded) {
        return;
    }
    window.__socialViewsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialConstants = window.SocialConstants;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var CharacterConstants = window.CharacterConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getRelationshipTypes !== 'function') {
            missing.push('SocialQueries.getRelationshipTypes');
        }
        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getConnectedCharacters !== 'function') {
            missing.push('SocialQueries.getConnectedCharacters');
        }
        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }

        if (!SocialConstants || typeof SocialConstants.getLabel !== 'function') {
            missing.push('SocialConstants.getLabel');
        }
        if (!SocialConstants || typeof SocialConstants.getColor !== 'function') {
            missing.push('SocialConstants.getColor');
        }
        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            missing.push('SocialConstants.isDirectional');
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

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        if (!CharacterConstants || typeof CharacterConstants.STAT_KEYS === 'undefined') {
            missing.push('CharacterConstants.STAT_KEYS');
        }

        if (missing.length > 0) {
            console.warn('[SocialViews] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // MAIN RENDER ENTRY
    // ============================================================

    /**
     * Render the social view in the given container.
     * 
     * @param {HTMLElement} container - Container element
     */
    function renderSocialView(container) {
        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) return;

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Social view dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure data exists
        if (!window.data || !window.data.social) {
            container.innerHTML = '<p class="empty-state">Loading social data...</p>';
            return;
        }

        container.innerHTML = getSocialHTML();

        populateSocialSelectors();
        renderRelationships();

        // Graph view is hidden by default (list view shown)
        var graphView = document.getElementById('social-graph-view');
        if (graphView) {
            graphView.style.display = 'none';
        }
    }

    // ============================================================
    // SOCIAL HTML SHELL
    // ============================================================

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

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateSocialSelectors() {
        populateCharacterFilter();
        populateTypeFilter();
        populateFormSelectors();
        populateTypeSelectors();
    }

    function populateCharacterFilter() {
        var filterSelect = document.getElementById('social-character-filter');
        if (!filterSelect) return;

        var chars = getCharacters();
        var currentValue = filterSelect.value;

        filterSelect.innerHTML = '<option value="all">All Characters</option>';

        chars.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a).toLowerCase();
            var nameB = CharacterQueries.getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        chars.forEach(function(c) {
            var option = document.createElement('option');
            option.value = c.id;
            option.textContent = CharacterQueries.getDisplayName(c);
            filterSelect.appendChild(option);
        });

        if (currentValue) {
            filterSelect.value = currentValue;
        }
    }

    function populateTypeFilter() {
        var typeFilter = document.getElementById('social-type-filter');
        if (!typeFilter) return;

        var types = SocialQueries.getRelationshipTypes();
        var currentValue = typeFilter.value;

        typeFilter.innerHTML = '<option value="all">All Types</option>';

        types.forEach(function(t) {
            var option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label + (t.directional ? ' (→)' : '');
            typeFilter.appendChild(option);
        });

        if (currentValue) {
            typeFilter.value = currentValue;
        }
    }

    function populateFormSelectors() {
        var select1 = document.getElementById('rel-char1');
        var select2 = document.getElementById('rel-char2');
        if (!select1 || !select2) return;

        var chars = getCharacters();
        var current1 = select1.value;
        var current2 = select2.value;

        select1.innerHTML = '<option value="">Select character...</option>';
        select2.innerHTML = '<option value="">Select character...</option>';

        chars.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a).toLowerCase();
            var nameB = CharacterQueries.getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        chars.forEach(function(c) {
            var name = CharacterQueries.getDisplayName(c);
            var option1 = document.createElement('option');
            option1.value = c.id;
            option1.textContent = name;
            select1.appendChild(option1);

            var option2 = document.createElement('option');
            option2.value = c.id;
            option2.textContent = name;
            select2.appendChild(option2);
        });

        if (current1) {
            select1.value = current1;
        }
        if (current2) {
            select2.value = current2;
        }
    }

    function populateTypeSelectors() {
        var typeSelect = document.getElementById('rel-type');
        if (!typeSelect) return;

        var types = SocialQueries.getRelationshipTypes();
        var currentValue = typeSelect.value;

        typeSelect.innerHTML = '<option value="">Select type...</option>';

        types.forEach(function(t) {
            var option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label + (t.directional ? ' (→)' : '');
            typeSelect.appendChild(option);
        });

        // Don't auto-select - let user choose intentionally
        if (currentValue) {
            typeSelect.value = currentValue;
        }
    }

    // ============================================================
    // RELATIONSHIP LIST RENDER
    // ============================================================

    function renderRelationships() {
        var container = document.getElementById('relationships-container');
        var countDisplay = document.getElementById('relationship-count');
        if (!container) return;

        var charFilter = document.getElementById('social-character-filter');
        var typeFilter = document.getElementById('social-type-filter');

        var charId = charFilter ? charFilter.value : 'all';
        var typeId = typeFilter ? typeFilter.value : 'all';

        var relationships = SocialQueries.getAllRelationships();

        // Apply filters
        if (charId !== 'all') {
            relationships = relationships.filter(function(r) {
                return String(r.character1) === String(charId) ||
                       String(r.character2) === String(charId);
            });
        }

        if (typeId !== 'all') {
            relationships = relationships.filter(function(r) {
                return r.typeId === typeId;
            });
        }

        // Sort by creation date (newest first)
        relationships.sort(function(a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        if (countDisplay) {
            countDisplay.textContent = relationships.length;
        }

        if (relationships.length === 0) {
            container.innerHTML = '<p class="empty-state">No relationships found. Add your first relationship!</p>';
            return;
        }

        container.textContent = '';

        relationships.forEach(function(rel) {
            var char1 = CharacterQueries.getCharacterById(rel.character1);
            var char2 = CharacterQueries.getCharacterById(rel.character2);

            var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';

            var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
            var typeColor = SocialQueries.getRelationshipTypeColor(rel.typeId);
            var isDirectional = SocialQueries.isRelationshipDirectional(rel.typeId);

            var directionArrow = isDirectional ? ' → ' : ' ↔ ';

            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' - ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }

            var clarificationDisplay = rel.clarification ? ' (' + rel.clarification + ')' : '';
            var notesDisplay = rel.notes ? ' 📝' : '';

            var div = document.createElement('div');
            div.className = 'list-item';
            div.style.cssText = 'grid-template-columns:1fr 1fr 0.8fr 1.2fr 1fr;border-left:3px solid ' + typeColor + ';padding:6px 10px;background:var(--bg);border-radius:4px;margin-bottom:4px;display:grid;align-items:center;gap:8px;font-size:0.75rem;';
            div.dataset.id = rel.id;

            var name1Span = document.createElement('span');
            var strong1 = document.createElement('strong');
            strong1.textContent = name1;
            name1Span.appendChild(strong1);
            div.appendChild(name1Span);

            var name2Span = document.createElement('span');
            var strong2 = document.createElement('strong');
            strong2.textContent = name2;
            name2Span.appendChild(strong2);
            div.appendChild(name2Span);

            var typeSpan = document.createElement('span');
            typeSpan.style.cssText = 'color:' + typeColor + ';font-weight:600;';
            typeSpan.textContent = typeLabel + directionArrow + clarificationDisplay;
            div.appendChild(typeSpan);

            var metaSpan = document.createElement('span');
            metaSpan.style.cssText = 'color:var(--text-dim);font-size:0.7rem;';
            metaSpan.textContent = period + notesDisplay;
            div.appendChild(metaSpan);

            var actionsSpan = document.createElement('span');
            actionsSpan.className = 'actions';

            var editBtn = document.createElement('button');
            editBtn.className = 'small edit-relationship';
            editBtn.dataset.id = rel.id;
            editBtn.textContent = 'Edit';
            actionsSpan.appendChild(editBtn);

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'small danger delete-relationship';
            deleteBtn.dataset.id = rel.id;
            deleteBtn.textContent = 'Delete';
            actionsSpan.appendChild(deleteBtn);

            div.appendChild(actionsSpan);
            container.appendChild(div);
        });
    }

    // ============================================================
    // CHARACTER DETAIL CONTENT
    // ============================================================

    function renderCharacterDetailContent(charId, container) {
        if (!container) {
            container = document.getElementById('char-detail-content');
        }
        if (!container) return;

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            container.innerHTML = '<p class="empty-state">Character not found.</p>';
            return;
        }

        var name = CharacterQueries.getDisplayName(char);
        var title = document.getElementById('detail-char-name');
        if (title) {
            title.textContent = name;
        }

        var status = CharacterQueries.getCurrentStatus(char);
        var age = CharacterQueries.getCharacterAge(char);
        var connections = SocialQueries.getConnectedCharacters(charId);

        container.textContent = '';

        // Character info
        var infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'margin-bottom:12px;';

        var statusRow = document.createElement('div');
        statusRow.className = 'detail-row';
        statusRow.style.cssText = 'display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border-soft);';
        var statusLabel = document.createElement('span');
        statusLabel.className = 'label';
        statusLabel.style.cssText = 'color:var(--text-dim);font-size:0.8rem;';
        statusLabel.textContent = 'Status:';
        var statusValue = document.createElement('span');
        statusValue.textContent = status || '—';
        statusRow.appendChild(statusLabel);
        statusRow.appendChild(statusValue);
        infoDiv.appendChild(statusRow);

        var ageRow = document.createElement('div');
        ageRow.className = 'detail-row';
        ageRow.style.cssText = 'display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border-soft);';
        var ageLabel = document.createElement('span');
        ageLabel.className = 'label';
        ageLabel.style.cssText = 'color:var(--text-dim);font-size:0.8rem;';
        ageLabel.textContent = 'Age:';
        var ageValue = document.createElement('span');
        ageValue.textContent = age || '—';
        ageRow.appendChild(ageLabel);
        ageRow.appendChild(ageValue);
        infoDiv.appendChild(ageRow);

        if (char.deceased) {
            var deceasedRow = document.createElement('div');
            deceasedRow.className = 'detail-row';
            deceasedRow.style.cssText = 'display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border-soft);';
            var deceasedLabel = document.createElement('span');
            deceasedLabel.className = 'label';
            deceasedLabel.style.cssText = 'color:var(--text-dim);font-size:0.8rem;';
            deceasedLabel.textContent = 'Deceased:';
            var deceasedValue = document.createElement('span');
            deceasedValue.style.cssText = 'color:var(--danger);';
            deceasedValue.textContent = 'Yes';
            deceasedRow.appendChild(deceasedLabel);
            deceasedRow.appendChild(deceasedValue);
            infoDiv.appendChild(deceasedRow);
        }

        container.appendChild(infoDiv);

        // Connections
        if (connections.length > 0) {
            var connHeading = document.createElement('h4');
            connHeading.style.cssText = 'color:var(--accent);font-size:0.85rem;margin:8px 0;';
            connHeading.textContent = 'Connections (' + connections.length + ')';
            container.appendChild(connHeading);

            var connList = document.createElement('div');
            connList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

            connections.forEach(function(conn) {
                var charName = CharacterQueries.getDisplayName(conn.character);

                var connDiv = document.createElement('div');
                connDiv.style.cssText = 'background:var(--bg);border-radius:4px;padding:4px 8px;';

                var nameDiv = document.createElement('div');
                nameDiv.style.cssText = 'font-size:0.8rem;';
                var strong = document.createElement('strong');
                strong.textContent = charName;
                nameDiv.appendChild(strong);
                connDiv.appendChild(nameDiv);

                conn.relationships.forEach(function(rel) {
                    var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
                    var typeColor = SocialQueries.getRelationshipTypeColor(rel.typeId);
                    var isDirectional = SocialQueries.isRelationshipDirectional(rel.typeId);

                    var targetCharId = String(charId);
                    var isSource = String(rel.character1) === targetCharId;
                    var directionText = isDirectional ? (isSource ? ' → ' : ' ← ') : ' ↔ ';

                    var period = '';
                    if (rel.startYear && rel.endYear) {
                        period = rel.startYear + ' - ' + rel.endYear;
                    } else if (rel.startYear) {
                        period = 'From ' + rel.startYear;
                    }

                    var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';

                    var relDiv = document.createElement('div');
                    relDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 4px;margin:2px 0;border-left:2px solid ' + typeColor + ';font-size:0.7rem;';

                    var relText = document.createElement('span');
                    relText.style.cssText = 'color:' + typeColor + ';';
                    relText.textContent = directionText + typeLabel + clarification;
                    relDiv.appendChild(relText);

                    var relPeriod = document.createElement('span');
                    relPeriod.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    relPeriod.textContent = period;
                    relDiv.appendChild(relPeriod);

                    connDiv.appendChild(relDiv);
                });

                connList.appendChild(connDiv);
            });

            container.appendChild(connList);
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'No connections';
            container.appendChild(empty);
        }

        // View all relationships button
        var buttonDiv = document.createElement('div');
        buttonDiv.style.cssText = 'margin-top:12px;';

        var viewBtn = document.createElement('button');
        viewBtn.className = 'small primary';
        viewBtn.id = 'view-char-relationships';
        viewBtn.dataset.id = charId;
        viewBtn.textContent = 'View All Relationships';
        buttonDiv.appendChild(viewBtn);

        container.appendChild(buttonDiv);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getCharacters() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    function getRelationshipPeriod(rel) {
        if (rel.startYear && rel.endYear) {
            return rel.startYear + ' - ' + rel.endYear;
        }
        if (rel.startYear) {
            return 'From ' + rel.startYear;
        }
        return '';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialViews = {
        // Main render
        renderSocialView: renderSocialView,

        // HTML
        getSocialHTML: getSocialHTML,

        // Selectors
        populateSocialSelectors: populateSocialSelectors,
        populateCharacterFilter: populateCharacterFilter,
        populateTypeFilter: populateTypeFilter,
        populateFormSelectors: populateFormSelectors,
        populateTypeSelectors: populateTypeSelectors,

        // Relationship list
        renderRelationships: renderRelationships,

        // Character detail
        renderCharacterDetailContent: renderCharacterDetailContent,

        // Helpers
        getCharacters: getCharacters,
        getRelationshipPeriod: getRelationshipPeriod
    };

})();