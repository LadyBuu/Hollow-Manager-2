/**
 * js/modules/characters/character-stats-view.js - Combat View
 * Renders the magical section and special moves section of the Combat tab.
 * Path: js/modules/characters/character-stats-view.js
 * 
 * IMPORTANT:
 *   - RENDER ONLY - domain logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses MagicConstants for definitions
 *   - Uses CharacterStats for derivation
 *   - Uses CharacterQueries for character data
 *   - Uses FormUtils for field operations
 *   - Uses DomUtils for escaping
 */

(function() {
    'use strict';

    if (window.__characterStatsViewLoaded) {
        return;
    }
    window.__characterStatsViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    function getMagicConstants() { return window.MagicConstants || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getFormUtils() { return window.FormUtils || null; }
    function getDomUtils() { return window.DomUtils || null; }
    function getModal() { return window.Modal || null; }

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

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];
        if (!getMagicConstants()) { missing.push('MagicConstants'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getCharacterStats()) { missing.push('CharacterStats'); }
        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getFormUtils()) { missing.push('FormUtils'); }
        if (missing.length > 0) {
            console.warn('[CharacterStatsView] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // MAGICAL SECTION HTML
    // ============================================================

    function getMagicalSectionHTML(c) {
        var MC = getMagicConstants();
        if (!MC) {
            return '<p class="empty-state">Magic constants not loaded.</p>';
        }

        var magic = c.magic || {};
        var categories = MC.getCategoryOrder ? MC.getCategoryOrder() : ['elemental', 'body', 'aether'];

        var categoriesHTML = '';

        categories.forEach(function(catId) {
            var cat = MC.getCategory(catId);
            if (!cat) { return; }
            var types = MC.getCategoryTypes(catId);

            var total = 0;
            types.forEach(function(t) { total += Number(magic[t]) || 0; });

            var typeInputs = '';
            types.forEach(function(typeKey) {
                var label = MC.getTypeLabel(typeKey);
                var value = magic[typeKey] !== undefined ? magic[typeKey] : 0;
                var levelLabel = MC.getProficiencyLevelLabel(value);

                typeInputs += `
                    <div class="magic-type-block" style="display:flex;flex-direction:column;gap:2px;align-items:center;padding:4px;background:var(--bg);border:1px solid var(--border-soft);border-radius:4px;">
                        <label style="font-size:0.55rem;color:var(--text-dim);font-weight:600;">${escapeHtml(label)}</label>
                        <input type="number" id="char-magic-${typeKey}" value="${value}" min="0" max="10" data-magic-key="${typeKey}" class="magic-input" style="width:100%;padding:3px 4px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:3px;font-size:0.8rem;text-align:center;font-weight:600;">
                        <span class="magic-level" data-magic-level="${typeKey}" style="font-size:0.5rem;color:var(--text-dim);">${escapeHtml(levelLabel)}</span>
                    </div>
                `;
            });

            categoriesHTML += `
                <div class="magic-category" style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <label style="font-size:0.7rem;color:${escapeHtml(cat.color || 'var(--accent)')};font-weight:600;">${escapeHtml(cat.label)}</label>
                        <span style="font-size:0.6rem;color:var(--text-dim);">Total: <span data-magic-total="${catId}">${total}</span></span>
                    </div>
                    <div class="magic-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
                        ${typeInputs}
                    </div>
                </div>
            `;
        });

        // Broad + fine override dropdowns
        var broadOptions = '<option value="">— Derived —</option>';
        var broadClasses = MC.getBroadClasses();
        broadClasses.forEach(function(cls) {
            broadOptions += '<option value="' + escapeHtml(cls.id) + '">' + escapeHtml(cls.label) + '</option>';
        });

        var fineOptions = '<option value="">— Derived —</option>';
        var fineClasses = MC.getFineClasses();
        fineClasses.forEach(function(cls) {
            fineOptions += '<option value="' + escapeHtml(cls.id) + '">' + escapeHtml(cls.label) + '</option>';
        });

        return `
            <div class="combat-section" style="margin-bottom:12px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                    <label style="font-size:0.8rem;color:var(--accent);font-weight:600;">Magical</label>
                    <button type="button" id="roll-magic-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">⟳ Roll Magic</button>
                </div>

                ${categoriesHTML}

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Broad Class (derived)</label>
                        <div id="derived-broad-class" style="padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--info);border-radius:4px;font-size:0.75rem;font-weight:600;">—</div>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Fine Class (derived)</label>
                        <div id="derived-fine-class" style="padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--warning);border-radius:4px;font-size:0.75rem;font-weight:600;">—</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Override Broad (display only)</label>
                        <select id="broad-class-override" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            ${broadOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Override Fine (raises proficiency to 8)</label>
                        <select id="fine-class-override" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            ${fineOptions}
                        </select>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // SPECIAL MOVES SECTION HTML
    // ============================================================

    function getMovesSectionHTML(c) {
        return `
            <div class="combat-section" style="margin-bottom:12px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);">
                <label style="font-size:0.8rem;color:var(--accent);font-weight:600;display:block;margin-bottom:8px;">Special Moves</label>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                        <label style="font-size:0.65rem;font-weight:600;color:var(--accent);">Physical</label>
                        <div id="physical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;">
                            <p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>
                        </div>
                        <div class="move-input-group" style="margin-top:4px;">
                            <input type="text" id="physical-move-name" placeholder="Move name" style="width:100%;padding:3px 5px;font-size:0.65rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;">
                            <input type="text" id="physical-move-desc" placeholder="Description (optional)" style="width:100%;padding:3px 5px;font-size:0.65rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;">
                            <button type="button" id="add-physical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                        </div>
                    </div>

                    <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                        <label style="font-size:0.65rem;font-weight:600;color:var(--info);">Magical</label>
                        <div id="magical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;">
                            <p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>
                        </div>
                        <div class="move-input-group" style="margin-top:4px;">
                            <input type="text" id="magical-move-name" placeholder="Move name" style="width:100%;padding:3px 5px;font-size:0.65rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;">
                            <input type="text" id="magical-move-desc" placeholder="Description (optional)" style="width:100%;padding:3px 5px;font-size:0.65rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;">
                            <button type="button" id="add-magical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // POPULATE MAGICAL FIELDS
    // ============================================================

    function populateMagicalFields(char) {
        if (!checkDependencies()) { return; }

        var MC = getMagicConstants();
        var FormUtils = getFormUtils();
        if (!MC || !FormUtils) { return; }

        var magic = char && char.magic ? char.magic : {};
        var types = MC.getTypeKeys();

        types.forEach(function(type) {
            var value = magic[type] !== undefined ? magic[type] : 0;
            FormUtils.setField('char-magic-' + type, value);

            // Update level label
            var levelEl = document.querySelector('[data-magic-level="' + type + '"]');
            if (levelEl) {
                levelEl.textContent = MC.getProficiencyLevelLabel(value);
            }
        });

        // Update category totals
        var order = MC.getCategoryOrder ? MC.getCategoryOrder() : ['elemental', 'body', 'aether'];
        order.forEach(function(catId) {
            var catTypes = MC.getCategoryTypes(catId);
            var total = 0;
            catTypes.forEach(function(t) { total += Number(magic[t]) || 0; });
            var totalEl = document.querySelector('[data-magic-total="' + catId + '"]');
            if (totalEl) { totalEl.textContent = String(total); }
        });
    }

    // ============================================================
    // COLLECT MAGICAL FIELDS
    // ============================================================

    function collectMagicalFields() {
        var MC = getMagicConstants();
        var FormUtils = getFormUtils();
        if (!MC || !FormUtils) { return {}; }

        var magic = {};
        var types = MC.getTypeKeys();

        types.forEach(function(type) {
            var raw = FormUtils.getField('char-magic-' + type);
            var value = parseInt(raw, 10);
            if (isNaN(value)) { value = 0; }
            magic[type] = Math.max(0, Math.min(MC.MAGIC_MAX, value));
        });

        return magic;
    }

    // ============================================================
    // CLASS DISPLAY UPDATES
    // ============================================================

    function updatePhysicalClassDisplay(char) {
        var CS = getCharacterStats();
        if (!CS) { return; }

        var el = document.getElementById('derived-physical-class');
        if (!el) { return; }

        if (!char || !char.stats) {
            el.textContent = '—';
            return;
        }

        var result = CS.derivePhysicalClass(char.stats);
        if (!result || !result.class) {
            el.textContent = '—';
            return;
        }

        el.textContent = result.class.label;
    }

    function updateMagicalClassDisplay(char) {
        var MC = getMagicConstants();
        var CS = getCharacterStats();
        if (!MC || !CS) { return; }

        var broadEl = document.getElementById('derived-broad-class');
        var fineEl = document.getElementById('derived-fine-class');

        if (!char || !char.magic) {
            if (broadEl) broadEl.textContent = '—';
            if (fineEl) fineEl.textContent = '—';
            return;
        }

        var result = CS.deriveMagicalClasses(char.magic);
        if (broadEl) {
            broadEl.textContent = result.broad ? result.broad.label : '—';
        }
        if (fineEl) {
            fineEl.textContent = result.fine ? result.fine.label : '—';
        }
    }

    // ============================================================
    // MOVES SECTION RENDERING
    // ============================================================

    function renderMovesSection(char) {
        var physicalList = document.getElementById('physical-moves-list');
        var magicalList = document.getElementById('magical-moves-list');
        if (!physicalList || !magicalList) { return; }

        var moves = char && char.specialMoves ? char.specialMoves : { physical: [], magical: [] };
        var physical = Array.isArray(moves.physical) ? moves.physical : [];
        var magical = Array.isArray(moves.magical) ? moves.magical : [];

        renderMovesInto(physicalList, physical, 'physical');
        renderMovesInto(magicalList, magical, 'magical');
    }

    function renderMovesInto(container, moves, type) {
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

        moves.forEach(function(move) {
            if (!move || typeof move !== 'object') { return; }

            var div = document.createElement('div');
            div.className = 'special-move-entry';
            div.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-left:3px solid ' + color + ';background:var(--bg);border-radius:4px;margin-bottom:3px;font-size:0.7rem;';

            var topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

            var nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight:600;color:var(--text);';
            nameSpan.textContent = move.name || 'Unnamed Move';
            topRow.appendChild(nameSpan);

            var delBtn = document.createElement('button');
            delBtn.className = 'remove-special-move small';
            delBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            delBtn.dataset.type = type;
            delBtn.dataset.moveId = move.id;
            delBtn.textContent = '✕';
            delBtn.setAttribute('aria-label', 'Delete move');
            topRow.appendChild(delBtn);

            div.appendChild(topRow);

            if (move.description) {
                var desc = document.createElement('div');
                desc.style.cssText = 'color:var(--text-dim);font-size:0.6rem;padding-left:4px;';
                desc.textContent = move.description;
                div.appendChild(desc);
            }

            container.appendChild(div);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStatsView = {
        // HTML generators
        getMagicalSectionHTML: getMagicalSectionHTML,
        getMovesSectionHTML: getMovesSectionHTML,

        // Population
        populateMagicalFields: populateMagicalFields,

        // Collection
        collectMagicalFields: collectMagicalFields,

        // Class display updates
        updatePhysicalClassDisplay: updatePhysicalClassDisplay,
        updateMagicalClassDisplay: updateMagicalClassDisplay,

        // Moves
        renderMovesSection: renderMovesSection
    };

})();
