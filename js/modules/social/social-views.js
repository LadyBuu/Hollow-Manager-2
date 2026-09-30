/**
 * modules/social/social-views.js - Social Views
 * Rendering functions for the standalone Social tab
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses SocialQueries + SocialAggregator
 *   - Uses SocialConstants for type definitions
 *   - Uses SocialAggregator for character data
 *   - Uses DomUtils for safe DOM operations
 *   - No inline event binding here (delegated to SocialEvents)
 *
 * CLARIFICATIONS (two-sided):
 *   Each row shows:
 *     - One chip with `displayClarification` when the two sides are
 *       equal or only one is set.
 *     - Two chips ("A / B") when the two sides differ.
 *
 *   The relationship form carries two clarification inputs:
 *     #rel-clarification-1   character1's role toward character2
 *     #rel-clarification-2   character2's role toward character1
 *
 * DIRECTIONAL ARROW (this revision):
 *   The standalone Social list renders every row in STORED
 *   orientation: character1 on the left, character2 on the right.
 *   The arrow therefore describes the stored direction, not the
 *   viewer's perspective:
 *
 *     directional  -> ' → '   (character1 → character2)
 *     undirected   -> ' ↔ '
 *
 *   The aggregator still exposes `directionText`, computed from a
 *   context character id, for surfaces that render from one
 *   character's point of view (the character form's Social tab).
 *   The standalone list ignores `directionText` because the row
 *   always shows both endpoints in stored order.
 *
 *   Do NOT reintroduce a context-sensitive arrow here. If a row
 *   renders both endpoints, the arrow must be orientation-stable
 *   or it disagrees with the names it sits between.
 *
 * ELIMINATED CHARACTERS:
 *   Two modal surfaces hide eliminated characters by default:
 *
 *     Relationship form  #rel-include-eliminated (unchecked)
 *     Suggest Pairs      #suggest-pairs-include-eliminated
 *                        (unchecked)
 *
 *   When a checkbox is unchecked, characters with any elimination
 *   on record are excluded from the character selects (relationship
 *   form) or from the pool and seed list (Suggest Pairs).
 *
 *   The relationship form carries a per-side exception: on edit,
 *   the currently-selected value of each side is always offered,
 *   even if that character is eliminated. This lets the user edit
 *   a relationship involving an eliminated character without
 *   losing the value. The exception is per-side, not global.
 *
 *   When a checkbox is checked, the filter is off entirely and
 *   every character is offered.
 *
 *   The elimination read routes through SocialMatcher.hasAnyElimination
 *   when available, and falls back to a direct EliminationQueries
 *   read. Both are presence-based, not year-scoped.
 *
 * CHILD BUTTON:
 *   A clover button appears on every relationship row between two
 *   opposite-sex characters. Clicking it opens the child modal.
 *
 * DEPENDENCIES:
 *   - window.SocialQueries
 *   - window.SocialAggregator
 *   - window.SocialConstants
 *   - window.CharacterQueries
 *   - window.DomUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.SocialMatcher       (elimination read)
 *   - window.EliminationQueries  (fallback elimination read)
 */

(function() {
    'use strict';

    if (window.__socialViewsLoaded) {
        return;
    }
    window.__socialViewsLoaded = true;

    var SocialQueries = window.SocialQueries;
    var SocialAggregator = window.SocialAggregator;
    var SocialConstants = window.SocialConstants;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;

    // ============================================================
    // STATE
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

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
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
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function isOppositeSex(genderA, genderB) {
        function norm(g) {
            if (!g) { return null; }
            var s = String(g).trim().toLowerCase();
            if (s === 'male' || s === 'm' || s === 'man' || s === 'boy') {
                return 'male';
            }
            if (s === 'female' || s === 'f' || s === 'woman' || s === 'girl') {
                return 'female';
            }
            return null;
        }
        var a = norm(genderA);
        var b = norm(genderB);
        if (!a || !b) { return false; }
        return a !== b;
    }

    /**
     * Does this character have any elimination on record?
     *
     * Delegates to SocialMatcher.hasAnyElimination when available;
     * falls back to a direct EliminationQueries read. Returns false
     * when neither is available.
     */
    function hasAnyElimination(charId) {
        if (!charId) { return false; }

        var Matcher = window.SocialMatcher;
        if (Matcher && typeof Matcher.hasAnyElimination === 'function') {
            return Matcher.hasAnyElimination(charId);
        }

        var EQ = window.EliminationQueries;
        if (!EQ) { return false; }

        try {
            if (typeof EQ.getEliminationWeek === 'function') {
                var week = EQ.getEliminationWeek(charId);
                if (week !== null && week !== undefined) {
                    return true;
                }
            }
            if (typeof EQ.getEliminationYear === 'function') {
                var year = EQ.getEliminationYear(charId);
                if (year !== null && year !== undefined) {
                    return true;
                }
            }
        } catch (e) {
            return false;
        }

        return false;
    }

    /**
     * Read the "include eliminated" checkbox in the relationship
     * modal. Returns false when the checkbox is absent.
     */
    function isRelIncludeEliminatedChecked() {
        var cb = document.getElementById('rel-include-eliminated');
        return cb ? cb.checked === true : false;
    }

    /**
     * Read the "include eliminated" checkbox in the Suggest Pairs
     * modal. Returns false when the checkbox is absent.
     */
    function isSuggestIncludeEliminatedChecked() {
        var cb = document.getElementById('suggest-pairs-include-eliminated');
        return cb ? cb.checked === true : false;
    }

    // ============================================================
    // MAIN RENDER
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

        var graphView = document.getElementById('social-graph-view');
        if (graphView) { graphView.style.display = 'none'; }
    }

    // ============================================================
    // HTML SHELL
    // ============================================================

    function getSocialHTML() {
        return `
            <div class="page-header">
                <h2>Social Network</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="add-relationship-btn" class="primary">+ Add Relationship</button>
                    <button id="suggest-pairs-btn" class="secondary" title="Suggest Pairs">\u2665 Suggest Pairs</button>
                    <button id="view-graph-btn" class="secondary">\u25ca View Network</button>
                    <button id="view-list-btn" class="secondary">\u2630 View List</button>
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
                        <button id="clear-social-filters" class="small secondary">\u2715 Clear</button>
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
                        <button id="reset-zoom-btn" class="small secondary">\u27f2</button>
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
                                    <label id="rel-clarification-1-label">Character 1's role toward Character 2</label>
                                    <input type="text" id="rel-clarification-1" placeholder="e.g., mother, boss, best friend" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group">
                                    <label id="rel-clarification-2-label">Character 2's role toward Character 1</label>
                                    <input type="text" id="rel-clarification-2" placeholder="e.g., daughter, employee, best friend" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
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
                                <div class="form-group full-width">
                                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8rem;">
                                        <input type="checkbox" id="rel-include-eliminated">
                                        <span>Include eliminated characters</span>
                                    </label>
                                    <p class="field-hint" style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">
                                        When unchecked, characters with any elimination on record are hidden from the selects, except the current value on each side.
                                    </p>
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

            <!-- Suggest Pairs Modal -->
            ${getSuggestPairsModalHTML()}

            <!-- Create Child Modal -->
            ${getChildModalHTML()}
        `;
    }

    // ============================================================
    // SELECTORS
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

        if (currentValue) { filterSelect.value = currentValue; }
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
            option.textContent = t.label + (t.directional ? ' (\u2192)' : '');
            typeFilter.appendChild(option);
        });

        if (currentValue) { typeFilter.value = currentValue; }
    }

    /**
     * Populate the relationship form's two character selects.
     *
     * Options:
     *   includeEliminated  when true, no filter is applied.
     *   preserve1          character id to keep on side 1 even if
     *                      eliminated. Read from the current select
     *                      value when not supplied.
     *   preserve2          same for side 2.
     *
     * On a create flow, the caller passes no options and the current
     * select values (usually empty) are read off the DOM.
     *
     * On an edit flow, the caller passes preserve1 / preserve2 so the
     * current values on each side survive the filter even when they
     * are eliminated. This lets the user edit a relationship
     * involving an eliminated character without losing the value.
     */
    function populateFormSelectors(options) {
        options = options || {};

        var select1 = document.getElementById('rel-char1');
        var select2 = document.getElementById('rel-char2');
        if (!select1 || !select2) { return; }

        var includeEliminated = options.includeEliminated === true;

        var preserve1 = (options.preserve1 !== undefined && options.preserve1 !== null)
            ? String(options.preserve1)
            : String(select1.value || '');
        var preserve2 = (options.preserve2 !== undefined && options.preserve2 !== null)
            ? String(options.preserve2)
            : String(select2.value || '');

        var all = CharacterQueries.getCharacters() || [];

        var sorted = all.slice().sort(function(a, b) {
            var na = CharacterQueries.getDisplayName(a) || '';
            var nb = CharacterQueries.getDisplayName(b) || '';
            return na.localeCompare(nb);
        });

        select1.innerHTML = '<option value="">Select character...</option>';
        select2.innerHTML = '<option value="">Select character...</option>';

        for (var i = 0; i < sorted.length; i++) {
            var c = sorted[i];
            if (!c || !c.id) { continue; }

            var charIdStr = String(c.id);
            var name = CharacterQueries.getDisplayName(c) || 'Unknown';
            var isEliminated = hasAnyElimination(charIdStr);

            // Side 1
            if (includeEliminated || !isEliminated || charIdStr === preserve1) {
                var opt1 = document.createElement('option');
                opt1.value = charIdStr;
                opt1.textContent = name;
                if (charIdStr === preserve1) { opt1.selected = true; }
                select1.appendChild(opt1);
            }

            // Side 2
            if (includeEliminated || !isEliminated || charIdStr === preserve2) {
                var opt2 = document.createElement('option');
                opt2.value = charIdStr;
                opt2.textContent = name;
                if (charIdStr === preserve2) { opt2.selected = true; }
                select2.appendChild(opt2);
            }
        }

        if (preserve1) { select1.value = preserve1; }
        if (preserve2) { select2.value = preserve2; }
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
            option.textContent = t.label + (t.directional ? ' (\u2192)' : '');
            typeSelect.appendChild(option);
        });

        if (currentValue) { typeSelect.value = currentValue; }
    }

    function refreshClarificationLabels() {
        var c1 = document.getElementById('rel-char1');
        var c2 = document.getElementById('rel-char2');
        var label1 = document.getElementById('rel-clarification-1-label');
        var label2 = document.getElementById('rel-clarification-2-label');

        if (!label1 || !label2) { return; }

        function nameFor(sel) {
            if (!sel || !sel.value) { return 'Character'; }
            if (!CharacterQueries) { return 'Character'; }
            var c = CharacterQueries.getCharacterById(sel.value);
            if (!c) { return 'Character'; }
            return CharacterQueries.getDisplayName(c) || 'Character';
        }

        var n1 = nameFor(c1);
        var n2 = nameFor(c2);

        label1.textContent = n1 + "'s role toward " + n2;
        label2.textContent = n2 + "'s role toward " + n1;
    }

    // ============================================================
    // RELATIONSHIP LIST
    // ============================================================

    function renderRelationships() {
        var container = document.getElementById('relationships-container');
        var countDisplay = document.getElementById('relationship-count');
        if (!container) { return; }

        var charFilter = document.getElementById('social-character-filter');
        var typeFilter = document.getElementById('social-type-filter');

        var charId = charFilter ? charFilter.value : 'all';
        var typeId = typeFilter ? typeFilter.value : 'all';

        var groups = SocialAggregator.getAllGroupedRelationshipsViewModel({
            characterFilter: charId,
            typeFilter: typeId
        }) || [];

        var totalCount = 0;
        groups.forEach(function(g) { totalCount += g.total; });

        if (countDisplay) { countDisplay.textContent = totalCount; }

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

    function renderTypeGroup(group, contextCharId) {
        var typeId = group.typeId;
        var label = group.typeLabel;
        var color = group.typeColor || 'var(--relationship-other)';

        var isCollapsed = isTypeCollapsed(typeId);
        var caret = isCollapsed ? '\u25b8' : '\u25be';
        var bodyDisplay = isCollapsed ? 'none' : 'block';

        var html = '';
        html += '<div class="relationship-group" data-type="' + escapeHtml(typeId) + '" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:6px;overflow:hidden;">';

        html += '<div class="relationship-group-header" data-type="' + escapeHtml(typeId) + '" style="display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;background:var(--panel);border-left:3px solid ' + escapeHtml(color) + ';">';
        html += '<span class="relationship-group-caret" style="font-size:0.7rem;color:var(--text-dim);width:12px;display:inline-block;">' + caret + '</span>';
        html += '<span style="font-size:0.75rem;font-weight:600;color:' + escapeHtml(color) + ';">' + escapeHtml(label) + '</span>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">(' + group.total + ')</span>';
        html += '</div>';

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

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderRelationshipRow(vm, color, contextCharId) {
        if (!vm) { return ''; }

        // ---- Arrow describes STORED orientation ----
        //
        // The row always renders character1 on the left and
        // character2 on the right, in stored order. The arrow must
        // therefore describe the stored direction, NOT the viewer's
        // perspective:
        //
        //   directional -> ' → '   (character1 → character2)
        //   undirected  -> ' ↔ '
        //
        // We deliberately ignore vm.directionText here. That field
        // is context-sensitive (computed from a context character
        // id) and belongs to surfaces that render from one
        // character's point of view — the character form's Social
        // tab, for instance. Rendering it here would make the arrow
        // disagree with the names it sits between.
        var arrow = vm.isDirectional ? '\u2192' : '\u2194';
        var period = vm.period || '';

        var chipsHtml = '';
        var clar1 = vm.clarification1 || '';
        var clar2 = vm.clarification2 || '';

        if (clar1 && clar2 && clar1.toLowerCase() !== clar2.toLowerCase()) {
            chipsHtml += '<span style="color:' + escapeHtml(color) + ';font-size:0.7rem;background:var(--chip-bg-subtle);padding:1px 6px;border-radius:4px;">' + escapeHtml(clar1) + '</span>';
            chipsHtml += '<span style="color:var(--text-dim);font-size:0.7rem;">/</span>';
            chipsHtml += '<span style="color:' + escapeHtml(color) + ';font-size:0.7rem;background:var(--chip-bg-subtle);padding:1px 6px;border-radius:4px;">' + escapeHtml(clar2) + '</span>';
        } else if (vm.displayClarification) {
            chipsHtml += '<span style="color:' + escapeHtml(color) + ';font-size:0.7rem;background:var(--chip-bg-subtle);padding:1px 6px;border-radius:4px;">' + escapeHtml(vm.displayClarification) + '</span>';
        }

        var childBtnHtml = '';
        if (CharacterQueries) {
            var c1 = CharacterQueries.getCharacterById(vm.character1);
            var c2 = CharacterQueries.getCharacterById(vm.character2);
            if (c1 && c2 && isOppositeSex(c1.gender, c2.gender)) {
                childBtnHtml = '<button type="button" class="create-child-btn small" ' +
                    'data-char1="' + escapeHtml(vm.character1) + '" ' +
                    'data-char2="' + escapeHtml(vm.character2) + '" ' +
                    'style="font-size:0.55rem;padding:1px 6px;" ' +
                    'title="Create Child">\u2618</button>';
            }
        }

        var html = '';
        html += '<div class="relationship-row" data-rel-id="' + escapeHtml(vm.id) + '" style="display:flex;align-items:center;gap:6px;padding:4px 0 4px 18px;font-size:0.72rem;">';

        html += '<span style="flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
        html += '<span style="font-weight:600;">' + escapeHtml(vm.name1) + '</span>';
        html += '<span style="color:var(--text-dim);font-size:0.9rem;">' + escapeHtml(arrow) + '</span>';
        html += '<span style="font-weight:600;">' + escapeHtml(vm.name2) + '</span>';
        html += chipsHtml;
        html += '</span>';

        if (period) {
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(period) + '</span>';
        }

        html += '<span style="display:flex;gap:4px;">';
        html += childBtnHtml;
        html += '<button type="button" class="edit-relationship small" data-id="' + escapeHtml(vm.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Edit">\u270e</button>';
        html += '<button type="button" class="delete-relationship small danger" data-id="' + escapeHtml(vm.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Delete">\u2715</button>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // CHARACTER DETAIL MODAL CONTENT
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
        if (title) { title.textContent = name; }

        container.textContent = '';

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
        statusValue.textContent = connectedVM.characterStatus || '\u2014';
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
        ageValue.textContent = connectedVM.characterAge || '\u2014';
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

                    var relColor = rel.typeColor || 'var(--relationship-other)';

                    var relDiv = document.createElement('div');
                    relDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 4px;margin:2px 0;border-left:2px solid ' + relColor + ';font-size:0.7rem;';

                    var relText = document.createElement('span');
                    relText.style.cssText = 'color:' + relColor + ';';
                    var dirText = rel.isDirectional ? (rel.directionText || ' \u2192 ') : ' \u2194 ';
                    var clarText = rel.displayClarification ? ' (' + rel.displayClarification + ')' : '';
                    relText.textContent = dirText + rel.typeLabel + clarText;
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
    // SUGGEST PAIRS MODAL
    // ============================================================

    function getSuggestPairsModalHTML() {
        return `
            <div id="suggest-pairs-modal" class="modal hidden">
                <div class="modal-content" style="max-width:720px;">
                    <div class="modal-header">
                        <h3>Suggest Pairs</h3>
                        <button class="close-modal" id="close-suggest-pairs">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group" style="margin-bottom:12px;">
                            <label for="suggest-pairs-year">Target Year</label>
                            <input type="number" id="suggest-pairs-year" min="1" value=""
                                style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;">
                            <p class="field-hint" style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">
                                Ages are computed at this year. Suggestions are filtered to males and females within six years, both alive at that year, neither currently in an ongoing romantic relationship, neither closely related.
                            </p>
                        </div>

                        <div class="form-group" style="margin-bottom:12px;">
                            <label for="suggest-pairs-mode">Suggestions</label>
                            <select id="suggest-pairs-mode"
                                style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;">
                                <option value="top">Top pairs across the pool</option>
                                <option value="seed">Suggest for a specific character</option>
                            </select>
                        </div>

                        <div class="form-group" style="margin-bottom:12px;">
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8rem;">
                                <input type="checkbox" id="suggest-pairs-include-eliminated">
                                <span>Include eliminated characters</span>
                            </label>
                            <p class="field-hint" style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">
                                When unchecked, characters with any elimination on record are excluded from the pool and from the seed list.
                            </p>
                        </div>

                        <div class="form-group" id="suggest-pairs-seed-group" style="margin-bottom:12px;display:none;">
                            <label for="suggest-pairs-seed">Character</label>
                            <select id="suggest-pairs-seed"
                                style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;">
                                <option value="">Select character...</option>
                            </select>
                        </div>

                        <div id="suggest-pairs-results">
                            <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderSuggestPairsContent(container, options) {
        if (!container) { return; }
        options = options || {};

        var Matcher = window.SocialMatcher;
        if (!Matcher || typeof Matcher.suggestTopPairs !== 'function') {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Matcher not available.</p>';
            return;
        }

        var year = parseInt(options.year, 10);
        if (isNaN(year) || year < 1) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Enter a valid year.</p>';
            return;
        }

        var includeEliminated = options.includeEliminated === true;

        var results;
        if (options.mode === 'seed' && options.seedCharId) {
            results = Matcher.suggestForCharacter(options.seedCharId, year, {
                limit: 30,
                includeEliminated: includeEliminated
            });
        } else {
            results = Matcher.suggestTopPairs(year, {
                limit: 40,
                includeEliminated: includeEliminated
            });
        }

        if (!results || results.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No eligible pairs found for that year.</p>';
            return;
        }

        var html = '';
        html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:6px;">';
        html += results.length + ' suggestion' + (results.length === 1 ? '' : 's');
        html += '</div>';

        html += '<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto;">';

        results.forEach(function(sug) {
            var a = sug.a;
            var b = sug.b;

            var aName = escapeHtml(a.name || 'Unknown');
            var bName = escapeHtml(b.name || 'Unknown');
            var gap = escapeHtml(String(sug.ageGap));
            var classBadge = sug.sameClass
                ? '<span style="color:var(--accent);font-size:0.6rem;background:var(--chip-bg-subtle);padding:1px 6px;border-radius:4px;">same class</span>'
                : '';

            html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);font-size:0.75rem;">';
            html += '<span style="flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
            html += '<strong>' + aName + '</strong>';
            html += '<span style="color:var(--text-dim);">(' + a.age + ')</span>';
            html += '<span style="color:var(--text-dim);">+</span>';
            html += '<strong>' + bName + '</strong>';
            html += '<span style="color:var(--text-dim);">(' + b.age + ')</span>';
            html += classBadge;
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">gap ' + gap + '</span>';
            html += '</span>';
            html += '<button type="button" class="small primary pair-suggest-btn"';
            html += ' data-char1="' + escapeHtml(a.id) + '"';
            html += ' data-char2="' + escapeHtml(b.id) + '"';
            html += ' style="font-size:0.65rem;padding:2px 10px;">Pair</button>';
            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ============================================================
    // CHILD MODAL
    // ============================================================

    function getChildModalHTML() {
        return `
            <div id="create-child-modal" class="modal hidden">
                <div class="modal-content" style="max-width:640px;">
                    <div class="modal-header">
                        <h3 id="create-child-title">Create Child</h3>
                        <button class="close-modal" id="close-create-child">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="create-child-parents-info" style="font-size:0.8rem;color:var(--text-dim);margin-bottom:12px;"></div>
                        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <div class="form-group">
                                <label for="child-birth-year">Birth Year *</label>
                                <input type="number" id="child-birth-year" min="1"
                                    style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            </div>
                            <div class="form-group">
                                <label for="child-sex">Sex</label>
                                <select id="child-sex"
                                    style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                                    <option value="">Random</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="child-first-name">First Name</label>
                                <input type="text" id="child-first-name" placeholder="(auto)"
                                    style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            </div>
                            <div class="form-group">
                                <label for="child-last-name">Last Name</label>
                                <input type="text" id="child-last-name" placeholder="(father's surname)"
                                    style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            </div>
                        </div>

                        <div id="child-preview" style="margin-top:12px;padding:10px;background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:6px;font-size:0.75rem;"></div>

                        <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                            <button type="button" id="cancel-create-child" class="secondary">Cancel</button>
                            <button type="button" id="confirm-create-child" class="primary">Create Child</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderChildModalContent(container, parentAId, parentBId) {
        if (!container) { return; }

        if (!CharacterQueries) { return; }

        var a = CharacterQueries.getCharacterById(parentAId);
        var b = CharacterQueries.getCharacterById(parentBId);
        if (!a || !b) { return; }

        var aName = CharacterQueries.getDisplayName(a) || 'Unknown';
        var bName = CharacterQueries.getDisplayName(b) || 'Unknown';

        var titleEl = container.querySelector('#create-child-title');
        if (titleEl) {
            titleEl.textContent = 'Create Child \u2014 ' + aName + ' + ' + bName;
        }

        var infoEl = container.querySelector('#create-child-parents-info');
        if (infoEl) {
            var currentYear = (window.data && typeof window.data.currentYear === 'number')
                ? window.data.currentYear : new Date().getFullYear();
            infoEl.textContent = 'Birth year defaults to the current application year (' + currentYear + ').';
        }

        var yearInput = container.querySelector('#child-birth-year');
        if (yearInput) {
            var currentYear2 = (window.data && typeof window.data.currentYear === 'number')
                ? window.data.currentYear : new Date().getFullYear();
            yearInput.value = String(currentYear2);
        }

        container.dataset.parentAId = String(a.id);
        container.dataset.parentBId = String(b.id);

        refreshChildPreview(container);
    }

    function refreshChildPreview(container) {
        if (!container) { return; }

        var previewEl = container.querySelector('#child-preview');
        if (!previewEl) { return; }

        var ChildFactory = window.SocialChildFactory;
        if (!CharacterQueries || !ChildFactory) { return; }

        var aId = container.dataset.parentAId;
        var bId = container.dataset.parentBId;
        if (!aId || !bId) { return; }

        var a = CharacterQueries.getCharacterById(aId);
        var b = CharacterQueries.getCharacterById(bId);
        if (!a || !b) { return; }

        var yearVal = container.querySelector('#child-birth-year').value;
        var sexVal = container.querySelector('#child-sex').value;
        var firstVal = container.querySelector('#child-first-name').value;
        var lastVal = container.querySelector('#child-last-name').value;

        var preview = ChildFactory.previewChild(a, b, {
            birthYear: yearVal,
            gender: sexVal,
            firstName: firstVal,
            lastName: lastVal
        });

        if (!preview) {
            previewEl.innerHTML = '<span style="color:var(--danger);">Enter a birth year to preview.</span>';
            return;
        }

        var html = '';
        html += '<div style="font-weight:600;color:var(--accent);margin-bottom:4px;">' + escapeHtml(preview.fullName) + '</div>';
        html += '<div style="color:var(--text-dim);font-size:0.7rem;margin-bottom:6px;">';
        html += 'Born ' + escapeHtml(preview.birthYear) + ' \u00b7 ' + escapeHtml(preview.sex);
        html += '</div>';

        if (preview.physical) {
            html += '<div style="color:var(--text-dim);font-size:0.7rem;margin-bottom:4px;">' + escapeHtml(preview.physical) + '</div>';
        }
        if (preview.statsSummary) {
            html += '<div style="font-size:0.7rem;margin-bottom:4px;"><strong>Stats:</strong> ' + escapeHtml(preview.statsSummary) + '</div>';
        }
        if (preview.personalitySummary) {
            html += '<div style="font-size:0.7rem;margin-bottom:4px;"><strong>Personality:</strong> ' + escapeHtml(preview.personalitySummary) + '</div>';
        }
        html += '<div style="color:var(--text-dim);font-size:0.7rem;">HP ' + preview.hp + ' \u00b7 MP ' + preview.mp + '</div>';

        previewEl.innerHTML = html;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getRelationshipPeriod(rel) {
        if (rel.startYear && rel.endYear) {
            return rel.startYear + ' - ' + rel.endYear;
        }
        if (rel.startYear) { return 'From ' + rel.startYear; }
        if (rel.endYear) { return 'Until ' + rel.endYear; }
        return '';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialViews = {
        renderSocialView: renderSocialView,
        getSocialHTML: getSocialHTML,

        populateSocialSelectors: populateSocialSelectors,
        populateCharacterFilter: populateCharacterFilter,
        populateTypeFilter: populateTypeFilter,
        populateFormSelectors: populateFormSelectors,
        populateTypeSelectors: populateTypeSelectors,
        refreshClarificationLabels: refreshClarificationLabels,

        renderRelationships: renderRelationships,
        renderCharacterDetailContent: renderCharacterDetailContent,

        getSuggestPairsModalHTML: getSuggestPairsModalHTML,
        renderSuggestPairsContent: renderSuggestPairsContent,

        getChildModalHTML: getChildModalHTML,
        renderChildModalContent: renderChildModalContent,
        refreshChildPreview: refreshChildPreview,

        getRelationshipPeriod: getRelationshipPeriod,

        // Exposed for use by SocialEvents
        hasAnyElimination: hasAnyElimination,
        isRelIncludeEliminatedChecked: isRelIncludeEliminatedChecked
    };

})();
