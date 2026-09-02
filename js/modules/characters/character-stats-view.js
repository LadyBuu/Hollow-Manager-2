/**
 * modules/characters/character-stats-view.js - Character Stats View
 * Renders stats, magic, and special moves UI for the character form
 * Path: js/modules/characters/character-stats-view.js
 * 
 * This module is responsible for:
 *   - Rendering the stats tab HTML
 *   - Rendering magic proficiency inputs
 *   - Rendering special moves lists
 *   - Updating class suggestions in the UI
 *   - Updating magic class suggestions in the UI
 *   - Updating magic power display
 * 
 * IMPORTANT:
 *   - This module is for RENDERING only - all logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses CharacterConstants for definitions
 *   - Uses DomUtils for safe DOM operations
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CharacterStats (from character-stats.js) - for logic
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsViewLoaded) {
        return;
    }
    window.__characterStatsViewLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!window.CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!window.DomUtils || typeof window.DomUtils.createElement !== 'function') {
            missing.push('DomUtils');
        }

        if (!window.CharacterStats) {
            missing.push('CharacterStats');
        }

        if (missing.length > 0) {
            console.warn('CharacterStatsView: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // CONSTANTS - From CharacterConstants
    // ============================================================

    var MAGIC_MAX = window.CharacterConstants ? window.CharacterConstants.MAGIC_MAX : 10;
    var STAT_MIN = window.CharacterConstants ? window.CharacterConstants.STAT_MIN : 1;
    var STAT_MAX = window.CharacterConstants ? window.CharacterConstants.STAT_MAX : 50;
    var STAT_KEYS = window.CharacterConstants ? window.CharacterConstants.STAT_KEYS : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var MAGIC_TYPE_KEYS = window.CharacterConstants ? window.CharacterConstants.MAGIC_TYPE_KEYS : [];
    var MAGIC_CATEGORIES = window.CharacterConstants ? window.CharacterConstants.MAGIC_CATEGORIES : {};
    var CLASS_DEFINITIONS = window.CharacterConstants ? window.CharacterConstants.CLASS_DEFINITIONS : [];

    // ============================================================
    // STATS TAB HTML
    // ============================================================

    function getStatsTabHTML() {
        if (!checkDependencies()) {
            return '<p class="empty-state">Stats view dependencies not loaded.</p>';
        }

        return `
            <div class="stat-input-group" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
                ${STAT_KEYS.map(function(stat) {
                    return `
                        <div class="form-group">
                            <label style="font-size:0.55rem;text-align:center;display:block;">${stat.toUpperCase()}</label>
                            <input type="number" id="char-${stat}" min="${STAT_MIN}" max="${STAT_MAX}" value="10" 
                                   style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" />
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="stat-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1;">
                    <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Class:</label>
                    <span id="suggested-class" class="suggested-class empty" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:0.7rem;color:var(--text-dim);font-weight:600;">—</span>
                    <select id="manual-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                        <option value="">Auto-suggest</option>
                    </select>
                    <button type="button" id="apply-class-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">Apply Class</button>
                    <button type="button" id="recalculate-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
                    <button type="button" id="random-stats-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Random</button>
                </div>
            </div>
            <div id="class-description-display" style="margin-top:6px;padding:6px 10px;background:var(--panel-alt);border-radius:4px;font-size:0.7rem;color:var(--text-dim);border-left:3px solid var(--accent);">
                Select a class to see its description here.
            </div>
            ${getMagicTabHTML()}
        `;
    }

    // ============================================================
    // MAGIC TAB HTML
    // ============================================================

    function getMagicTabHTML() {
        var magicHTML = '';
        var categories = ['elemental', 'body', 'aether'];
        var categoryLabels = {
            'elemental': { label: 'Elemental', color: 'var(--accent)' },
            'body': { label: 'Body', color: 'var(--danger)' },
            'aether': { label: 'Aether', color: 'var(--info)' }
        };
        var categoryButtons = {
            'elemental': 'random-elemental-btn',
            'body': 'random-body-btn',
            'aether': 'random-aether-btn'
        };

        magicHTML += '<div class="magic-stats-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px;">';

        categories.forEach(function(cat) {
            var types = getMagicCategoryTypes(cat);
            magicHTML += '<div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">';
            magicHTML += '<label style="color:' + categoryLabels[cat].color + ';font-weight:600;font-size:0.7rem;">' + categoryLabels[cat].label + '</label>';
            magicHTML += '<button type="button" id="' + categoryButtons[cat] + '" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>';
            magicHTML += '</div>';

            types.forEach(function(key) {
                var label = key.charAt(0).toUpperCase() + key.slice(1);
                magicHTML += `
                    <div class="form-group">
                        <label style="font-size:0.55rem;text-align:center;display:block;">${label}</label>
                        <input type="number" id="magic-${key}" min="0" max="${MAGIC_MAX}" value="0" 
                               style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" />
                    </div>
                `;
            });
        });

        magicHTML += '</div>';

        magicHTML += `
            <div class="magic-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Magic Class:</label>
                <span id="suggested-magic-class" class="suggested-class empty" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:0.7rem;color:var(--text-dim);font-weight:600;">—</span>
                <select id="manual-magic-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                    <option value="">Auto-suggest</option>
                    ${getMagicClassOptionsHTML()}
                </select>
                <button type="button" id="apply-magic-class-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">Apply Class</button>
                <button type="button" id="recalculate-magic-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
            </div>
            <div class="magic-power-display" style="margin-top:6px;font-size:0.7rem;color:var(--text-dim);">
                Magic Power: <span id="magic-power-display-text">☆☆☆☆☆ (0/100) - Untrained</span>
            </div>
            ${getSpecialMovesHTML()}
        `;

        return magicHTML;
    }

    // ============================================================
    // MAGIC CLASS OPTIONS
    // ============================================================

    function getMagicClassOptionsHTML() {
        return `
            <optgroup label="Elemental Magic">
                <option value="elementalist">Elementalist (General)</option>
                <option value="geomancer">Geomancer (Earth)</option>
                <option value="hydromancer">Hydromancer (Water)</option>
                <option value="pyromancer">Pyromancer (Fire)</option>
                <option value="aeromancer">Aeromancer (Air)</option>
                <option value="ferromancer">Ferromancer (Metal)</option>
                <option value="dendromancer">Dendromancer (Wood)</option>
            </optgroup>
            <optgroup label="Body Magic">
                <option value="body_mage">Body Mage (General)</option>
                <option value="hemomancer">Hemomancer (Blood)</option>
                <option value="osteomancer">Osteomancer (Bone)</option>
                <option value="psychomancer">Psychomancer (Mind)</option>
                <option value="morphomancer">Morphomancer (Morphic)</option>
                <option value="vitalmancer">Vitalmancer (Life)</option>
                <option value="necromancer">Necromancer (Death)</option>
            </optgroup>
            <optgroup label="Aether Magic">
                <option value="aether_mage">Aether Mage (General)</option>
                <option value="spatiomancer">Spatiomancer (Space)</option>
                <option value="chronomancer">Chronomancer (Time)</option>
                <option value="dimensionist">Dimensionist (Dimension)</option>
                <option value="voidmancer">Voidmancer (Void)</option>
                <option value="reality_weaver">Reality Weaver (Reality)</option>
                <option value="transference_mage">Transference Mage (Transference)</option>
            </optgroup>
        `;
    }

    // ============================================================
    // SPECIAL MOVES HTML
    // ============================================================

    function getSpecialMovesHTML() {
        return `
            <div class="moves-grid" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                    <label class="move-label physical" style="font-size:0.65rem;font-weight:600;color:var(--accent);">Physical Moves</label>
                    <div id="physical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="physical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="physical-move-desc" placeholder="Description (optional)" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-physical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                    <label class="move-label magical" style="font-size:0.65rem;font-weight:600;color:var(--info);">Magical Moves</label>
                    <div id="magical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="magical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="magical-move-desc" placeholder="Description (optional)" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-magical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // CLASS SELECT POPULATION
    // ============================================================

    function populateClassSelect() {
        var select = document.getElementById('manual-class-select');
        if (!select) return;
        
        var currentValue = select.value || '';
        select.innerHTML = '<option value="">Auto-suggest</option>';
        
        var sorted = CLASS_DEFINITIONS.slice().sort(function(a, b) {
            var priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.label || '').localeCompare(b.label || '');
        });
        
        sorted.forEach(function(cls) {
            if (cls && cls.id) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = (cls.icon || '') + ' ' + (cls.label || cls.id);
                select.appendChild(option);
            }
        });
        
        if (currentValue) {
            var optionExists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentValue) {
                    optionExists = true;
                    break;
                }
            }
            if (optionExists) {
                select.value = currentValue;
            }
        }
    }

    // ============================================================
    // UI UPDATE FUNCTIONS
    // ============================================================

    /**
     * Update the class suggestion display.
     * Delegates to CharacterStats for the actual suggestion logic.
     */
    function updateClassSuggestion() {
        if (!window.CharacterStats || typeof window.CharacterStats.updateClassSuggestion !== 'function') {
            return;
        }
        window.CharacterStats.updateClassSuggestion();
    }

    /**
     * Update the magic class suggestion display.
     * Delegates to CharacterStats for the actual suggestion logic.
     */
    function updateMagicClassSuggestion() {
        if (!window.CharacterStats || typeof window.CharacterStats.updateMagicClassSuggestion !== 'function') {
            return;
        }
        window.CharacterStats.updateMagicClassSuggestion();
    }

    /**
     * Update the magic power display.
     * Delegates to CharacterStats for the actual calculation logic.
     */
    function updateMagicPowerDisplay() {
        if (!window.CharacterStats || typeof window.CharacterStats.updateMagicPowerDisplay !== 'function') {
            return;
        }
        window.CharacterStats.updateMagicPowerDisplay();
    }

    // ============================================================
    // SPECIAL MOVES RENDERING
    // ============================================================

    /**
     * Render special moves list.
     * Uses DomUtils for safe DOM creation.
     */
    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

        // Clear container
        container.textContent = '';

        if (!moves || moves.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'None';
            container.appendChild(empty);
            return;
        }

        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';

        moves.forEach(function(move, index) {
            move = move || {};
            if (typeof move !== 'object' || Array.isArray(move)) {
                move = { name: 'Invalid Move', description: '' };
            }

            var div = document.createElement('div');
            div.className = 'special-move-entry';
            div.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-left:3px solid ' + color + ';background:var(--bg);border-radius:4px;margin-bottom:3px;font-size:0.7rem;';

            var topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'move-name';
            nameSpan.style.cssText = 'font-weight:600;color:var(--text);';
            nameSpan.textContent = move.name || 'Unnamed Move';
            topRow.appendChild(nameSpan);

            var actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display:flex;gap:4px;';

            var editBtn = document.createElement('button');
            editBtn.className = 'edit-special-move small secondary';
            editBtn.style.cssText = 'font-size:0.5rem;padding:1px 6px;';
            editBtn.dataset.type = type;
            editBtn.dataset.index = index;
            editBtn.textContent = '✎';
            editBtn.setAttribute('aria-label', 'Edit move');
            actionsDiv.appendChild(editBtn);

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'remove-special-move small';
            deleteBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            deleteBtn.dataset.type = type;
            deleteBtn.dataset.index = index;
            deleteBtn.textContent = '✕';
            deleteBtn.setAttribute('aria-label', 'Delete move');
            actionsDiv.appendChild(deleteBtn);

            topRow.appendChild(actionsDiv);
            div.appendChild(topRow);

            if (move.description) {
                var descDiv = document.createElement('div');
                descDiv.className = 'move-desc';
                descDiv.style.cssText = 'color:var(--text-dim);font-size:0.6rem;padding-left:4px;';
                descDiv.textContent = move.description;
                div.appendChild(descDiv);
            }

            container.appendChild(div);
        });
    }

    // ============================================================
    // MAGIC TYPE HELPERS (delegate to constants)
    // ============================================================

    function getMagicTypeKeys() {
        if (window.CharacterConstants && typeof window.CharacterConstants.getMagicTypeKeys === 'function') {
            return window.CharacterConstants.getMagicTypeKeys();
        }
        return MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        if (window.CharacterConstants && typeof window.CharacterConstants.getMagicCategoryTypes === 'function') {
            return window.CharacterConstants.getMagicCategoryTypes(category);
        }
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.types.slice() : [];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStatsView = {
        // HTML generation
        getStatsTabHTML: getStatsTabHTML,
        getMagicTabHTML: getMagicTabHTML,
        getSpecialMovesHTML: getSpecialMovesHTML,
        getMagicClassOptionsHTML: getMagicClassOptionsHTML,

        // Class select
        populateClassSelect: populateClassSelect,

        // UI updates
        updateClassSuggestion: updateClassSuggestion,
        updateMagicClassSuggestion: updateMagicClassSuggestion,
        updateMagicPowerDisplay: updateMagicPowerDisplay,

        // Special moves rendering
        renderSpecialMoves: renderSpecialMoves,

        // Magic type helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,

        // Constants
        STAT_KEYS: STAT_KEYS,
        MAGIC_MAX: MAGIC_MAX,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX
    };

})();
