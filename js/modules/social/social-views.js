/**
 * modules/social/social-views.js - Social Views
 * Rendering functions for the standalone Social tab
 * 
 * This module provides:
 *   - renderSocialView - Main render entry point
 *   - getSocialHTML - Static HTML shell
 *   - populateSocialSelectors - Filter dropdowns
 *   - populateFormSelectors - Form dropdowns
 *   - populateTypeSelectors - Type dropdowns
 *   - renderRelationships - Grouped, collapsible relationship list
 *   - renderCharacterDetailContent - Detail modal content
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses SocialQueries + SocialAggregator
 *   - Uses SocialConstants for type definitions
 *   - Uses SocialAggregator for character data (names, status, etc.)
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No inline event binding here (delegated to SocialEvents)
 * 
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialAggregator (from social-aggregator.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 */

(function() {
    'use strict';

    if (window.__socialViewsLoaded) {
        return;
    }
    window.__socialViewsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialAggregator = window.SocialAggregator;
    var SocialConstants = window.SocialConstants;
    var DomUtils = window.DomUtils;

    // ============================================================
    // STATE - collapse state per typeId
    // ============================================================

    var _collapsedTypes = Object.create(null);

    function isTypeCollapsed(typeId) {
        return _collapsedTypes[String(typeId)] === true;
    }

    function toggleTypeCollapsed(typeId) {
        var key = String(typeId);
        if (_collapsedTypes[key]) {
            delete _collapsedTypes[key];
            return false;
        }
        _collapsedTypes[key] = true;
        return true;
    }

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
        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }

        if (!SocialAggregator || typeof SocialAggregator.getRelationshipViewModel !== 'function') {
            missing.push('SocialAggregator.getRelationshipViewModel');
        }
        if (!SocialAggregator || typeof SocialAggregator.getCharacterRelationshipsViewModel !== 'function') {
            missing.push('SocialAggregator.getCharacterRelationshipsViewModel');
        }
        if (!SocialAggregator || typeof SocialAggregator.getConnectedCharactersViewModel !== 'function') {
            missing.push('SocialAggregator.getConnectedCharactersViewModel');
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

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('[SocialViews] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // MAIN RENDER ENTRY
    // ============================================================

    function renderSocialView(container) {
        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) { return; }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Social view dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        if (!window.data || !window.data.social) {
            container.innerHTML = '<p class="empty-state">Loading social data...</p>';
            return;
        }

        container.innerHTML = getSocialHTML();

        populateSocialSelectors();
        renderRelationships();

        // Graph view hidden by default
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
                                    <label>Title (e.g., mother, best friend, boss)</label>
                                    <input type="text" id="rel-clarification" placeholder="e.g., mother, sibling, boss" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
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
        if (!filterSelect) { return; }

        var pageVM = SocialAggregator.getSocialPageViewModel({});
        var characters = pageVM.characters || [];
        var currentValue = filterSelect.value;

        filterSelect.innerHTML = '<option value="all">All Characters</option>';

        characters.forEach(function(c) {
            var option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.name || 'Unknown';
            filterSelect.appendChild(option);
        });

        if (currentValue) {
            filterSelect.value = currentValue;
        }
    }

    function populateTypeFilter() {
        var typeFilter = document.getElementById('social-type-filter');
        if (!typeFilter) { return; }

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
        if (!select1 || !select2) { return; }

        var pageVM = SocialAggregator.getSocialPageViewModel({});
        var characters = pageVM.characters || [];
        var current1 = select1.value;
        var current2 = select2.value;

        select1.innerHTML = '<option value="">Select character...</option>';
        select2.innerHTML = '<option value="">Select character...</option>';

        characters.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        characters.forEach(function(c) {
            var name = c.name || 'Unknown';
            var option1 = document.createElement('option');
            option1.value = c.id;
            option1.textContent = name;
            select1.appendChild(option1);

            var option2 = document.createElement('option');
            option2.value = c.id;
            option2.textContent = name;
            select2.appendChild(option2);
        });

        if (current1) { select1.value = current1; }
        if (current2) { select2.value = current2; }
    }

    function populateTypeSelectors() {
        var typeSelect = document.getElementById('rel-type');
        if (!typeSelect) { return; }

        var types = SocialQueries.getRelationshipTypes();
        var currentValue = typeSelect.value;

        typeSelect.innerHTML = '<option value="">Select type...</option>';

        types.forEach(function(t) {
            var option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label + (t.directional ? ' (→)' : '');
            typeSelect.appendChild(option);
        });

        if (currentValue) {
            typeSelect.value = currentValue;
        }
    }

    // ============================================================
    // RELATIONSHIP LIST RENDER (grouped + collapsible)
    // ============================================================

    function renderRelationships() {
        var container = document.getElementById('relationships-container');
        var countDisplay = document.getElementById('relationship-count');
        if (!container) { return; }

        var charFilter = document.getElementById('social-character-filter');
        var typeFilter = document.getElementById('social-type-filter');

        var charId = charFilter ? charFilter.value : 'all';
        var typeId = typeFilter ? typeFilter.value : 'all';

        // Use grouped aggregator
        var groups = SocialAggregator.getAllGroupedRelationshipsViewModel({
            characterFilter: charId,
            typeFilter: typeId
        }) || [];

        // Count total relationships
        var totalCount = 0;
        groups.forEach(function(g) { totalCount += g.total; });

        if (countDisplay) {
            countDisplay.textContent = totalCount;
        }

        if (totalCount === 0) {
            container.innerHTML = '<p class="empty-state">No relationships found. Add your first relationship!</p>';
            return;
        }

        var html = '<div class="relationship-groups" style="display:flex;flex-direction:column;gap:8px;">';

        groups.forEach(function(group) {
            html += renderTypeGroup(group, charId);
        });

        html += '</div>';

        container.innerHTML = html;
    }

    /**
     * Render one relationship type group (collapsible).
     */
    function renderTypeGroup(group, contextCharId) {
        var typeId = group.typeId;
        var label = group.typeLabel;
        var color = group.typeColor || '#7f8c8d';

        var isCollapsed = isTypeCollapsed(typeId);
        var caret = isCollapsed ? '▸' : '▾';
        var bodyDisplay = isCollapsed ? 'none' : 'block';

        var html = '';
        html += '<div class="relationship-group" data-type="' + escapeHtml(typeId) + '" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:6px;overflow:hidden;">';

        // Header
        html += '<div class="relationship-group-header" data-type="' + escapeHtml(typeId) + '" style="display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;background:var(--panel);border-left:3px solid ' + escapeHtml(color) + ';">';
        html += '<span class="relationship-group-caret" style="font-size:0.7rem;color:var(--text-dim);width:12px;display:inline-block;">' + caret + '</span>';
        html += '<span style="font-size:0.75rem;font-weight:600;color:' + escapeHtml(color) + ';">' + escapeHtml(label) + '</span>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">(' + group.total + ')</span>';
        html += '</div>';

        // Body
        html += '<div class="relationship-group-body" style="display:' + bodyDisplay + ';padding:6px 10px;">';

        if (group.ongoing.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;">Ongoing</div>';
            group.ongoing.forEach(function(vm) {
                html += renderRelationshipRow(vm, color, contextCharId);
            });
        }

        if (group.ended.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;margin-top:6px;">Ended</div>';
            group.ended.forEach(function(vm) {
                html += renderRelationshipRow(vm, color, contextCharId);
            });
        }

        html += '</div>'; // body
        html += '</div>'; // group

        return html;
    }

    /**
     * Render a single relationship row (from view model).
     * 
     * Displays:
     *   name1 →/↔/← name2   [Title]     period     [Edit] [Delete]
     */
    function renderRelationshipRow(vm, color, contextCharId) {
        if (!vm) { return ''; }

        var title = vm.clarification ? String(vm.clarification) : '';
        var arrow = vm.isDirectional ? (vm.directionText || ' → ').trim() : '↔';
        var period = vm.period || '';

        var html = '';
        html += '<div class="relationship-row" data-rel-id="' + escapeHtml(vm.id) + '" style="display:flex;align-items:center;gap:6px;padding:4px 0 4px 18px;font-size:0.72rem;">';

        // Names + arrow + title
        html += '<span style="flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
        html += '<span style="font-weight:600;">' + escapeHtml(vm.name1) + '</span>';
        html += '<span style="color:var(--text-dim);font-size:0.9rem;">' + escapeHtml(arrow) + '</span>';
        html += '<span style="font-weight:600;">' + escapeHtml(vm.name2) + '</span>';
        if (title) {
            html += '<span style="color:' + escapeHtml(color) + ';font-size:0.7rem;background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:4px;">' + escapeHtml(title) + '</span>';
        }
        html += '</span>';

        // Period
        if (period) {
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(period) + '</span>';
        }

        // Actions
        html += '<span style="display:flex;gap:4px;">';
        html += '<button type="button" class="edit-relationship small" data-id="' + escapeHtml(vm.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Edit">✎</button>';
        html += '<button type="button" class="delete-relationship small danger" data-id="' + escapeHtml(vm.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Delete">✕</button>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // CHARACTER DETAIL CONTENT (graph node click)
    // ============================================================

    function renderCharacterDetailContent(charId, container) {
        if (!container) {
            container = document.getElementById('char-detail-content');
        }
        if (!container) { return; }

        var connectedVM = SocialAggregator.getConnectedCharactersViewModel(charId);
        var relVM = SocialAggregator.getCharacterRelationshipsViewModel(charId);

        if (!connectedVM || !relVM) {
            container.innerHTML = '<p class="empty-state">Character not found.</p>';
            return;
        }

        var name = connectedVM.characterName || 'Unknown';
        var title = document.getElementById('detail-char-name');
        if (title) {
            title.textContent = name;
        }

        container.textContent = '';

        // ---- Info block ----
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
        statusValue.textContent = connectedVM.characterStatus || '—';
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
        ageValue.textContent = connectedVM.characterAge || '—';
        ageRow.appendChild(ageLabel);
        ageRow.appendChild(ageValue);
        infoDiv.appendChild(ageRow);

        if (connectedVM.characterDeceased) {
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

        // ---- Connections ----
        var connections = connectedVM.connections || [];
        if (connections.length > 0) {
            var connHeading = document.createElement('h4');
            connHeading.style.cssText = 'color:var(--accent);font-size:0.85rem;margin:8px 0;';
            connHeading.textContent = 'Connections (' + connections.length + ')';
            container.appendChild(connHeading);

            var connList = document.createElement('div');
            connList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

            connections.forEach(function(conn) {
                var connDiv = document.createElement('div');
                connDiv.style.cssText = 'background:var(--bg);border-radius:4px;padding:4px 8px;';

                var nameDiv = document.createElement('div');
                nameDiv.style.cssText = 'font-size:0.8rem;';
                var strong = document.createElement('strong');
                strong.textContent = conn.characterName || 'Unknown';
                nameDiv.appendChild(strong);
                connDiv.appendChild(nameDiv);

                (conn.relationships || []).forEach(function(rel) {
                    if (!rel) { return; }

                    var relDiv = document.createElement('div');
                    relDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 4px;margin:2px 0;border-left:2px solid ' + (rel.typeColor || '#7f8c8d') + ';font-size:0.7rem;';

                    var relText = document.createElement('span');
                    relText.style.cssText = 'color:' + (rel.typeColor || '#7f8c8d') + ';';
                    var dirText = rel.isDirectional ? (rel.directionText || ' → ') : ' ↔ ';
                    relText.textContent = dirText + rel.typeLabel + (rel.clarification ? ' (' + rel.clarification + ')' : '');
                    relDiv.appendChild(relText);

                    var relPeriod = document.createElement('span');
                    relPeriod.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    relPeriod.textContent = rel.period || '';
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

        // ---- View all relationships button ----
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

    function getRelationshipPeriod(rel) {
        if (rel.startYear && rel.endYear) {
            return rel.startYear + ' - ' + rel.endYear;
        }
        if (rel.startYear) {
            return 'From ' + rel.startYear;
        }
        if (rel.endYear) {
            return 'Until ' + rel.endYear;
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
        getRelationshipPeriod: getRelationshipPeriod
    };

})();
