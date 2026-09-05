/**
 * js/modules/characters/character-stats-view.js - Character Stats View
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
 *   - Opening the special move editor modal
 * 
 * IMPORTANT:
 *   - RENDER ONLY - all domain logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses CharacterConstants for definitions
 *   - Uses CharacterQueries for character data
 *   - Uses CharacterStats for domain logic
 *   - Uses FormUtils for form field operations
 *   - Uses DomUtils for safe DOM operations
 *   - Uses Modal for modal lifecycle
 *   - All callbacks are delegated to CharacterEvents
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CharacterStats (from character-stats.js) - MANDATORY
 *   - window.FormUtils (from form-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 *   - window.MagicConstants (from magic-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var CSV = window.CharacterStatsView;
 *   CSV.renderStatsTab(char);
 *   CSV.renderSpecialMoves('physical-moves-list', moves, 'physical');
 *   CSV.openEditModal(charId, 'physical', index);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsViewLoaded) {
        return;
    }
    window.__characterStatsViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var CharacterQueries = window.CharacterQueries;
    var CharacterStats = window.CharacterStats;
    var MagicConstants = window.MagicConstants;
    var FormUtils = window.FormUtils;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // CONSTANTS - From CharacterConstants (MANDATORY)
    // ============================================================

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;
    var STAT_DEFINITIONS = CharacterConstants.STAT_DEFINITIONS;
    var MAGIC_MAX = CharacterConstants.MAGIC_MAX;
    var MAGIC_TYPES = CharacterConstants.MAGIC_TYPES;
    var MAGIC_CATEGORIES = CharacterConstants.MAGIC_CATEGORIES;
    var CLASS_DEFINITIONS = CharacterConstants.CLASS_DEFINITIONS;
    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!CharacterStats) {
            missing.push('CharacterStats');
        }

        if (!FormUtils || typeof FormUtils.setField !== 'function') {
            missing.push('FormUtils.setField');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (!MagicConstants) {
            missing.push('MagicConstants');
        }

        if (missing.length > 0) {
            console.warn('CharacterStatsView: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HELPER - Get values from DOM using FormUtils
    // ============================================================

    function getStatValue(key) {
        var val = FormUtils.getField('char-' + key);
        if (val === null || val === undefined) return STAT_DEFAULT;
        var num = Number(val);
        if (isNaN(num)) return STAT_DEFAULT;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, num));
    }

    function getMagicValue(key) {
        var val = FormUtils.getField('magic-' + key);
        if (val === null || val === undefined) return 0;
        var num = Number(val);
        if (isNaN(num)) return 0;
        return Math.max(0, Math.min(MAGIC_MAX, num));
    }

    // ============================================================
    // STATS TAB HTML
    // ============================================================

    function getStatsTabHTML() {
        if (!checkDependencies()) {
            return '<p class="empty-state">Stats view dependencies not loaded.</p>';
        }

        return `
            <div class="stat-input-group" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
                ${STAT_KEYS.map(function(key) {
                    var def = STAT_DEFINITIONS[key] || {};
                    return `
                        <div class="form-group">
                            <label style="font-size:0.55rem;text-align:center;display:block;">${def.abbreviation || key.toUpperCase()}</label>
                            <input type="number" id="char-${key}" min="${STAT_MIN}" max="${STAT_MAX}" value="10" 
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
        var categoryColors = {
            'elemental': 'var(--accent)',
            'body': 'var(--danger)',
            'aether': 'var(--info)'
        };

        magicHTML += '<div class="magic-stats-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px;">';

        categories.forEach(function(cat) {
            var types = MagicConstants.getCategoryTypes(cat) || [];
            var catLabel = MagicConstants.getCategoryLabel(cat) || cat;

            magicHTML += '<div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">';
            magicHTML += '<label style="color:' + categoryColors[cat] + ';font-weight:600;font-size:0.7rem;">' + catLabel + '</label>';
            magicHTML += '<button type="button" id="random-' + cat + '-btn" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>';
            magicHTML += '</div>';

            types.forEach(function(key) {
                var label = MagicConstants.getTypeLabel(key) || key;
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
            </div>
            <div class="magic-power-display" style="margin-top:6px;font-size:0.7rem;color:var(--text-dim);">
                Magic Power: <span id="magic-power-display-text">☆☆☆☆☆ (0/100) - Untrained</span>
            </div>
            ${getSpecialMovesHTML()}
        `;

        return magicHTML;
    }

    // ============================================================
    // MAGIC CLASS OPTIONS HTML
    // ============================================================

    function getMagicClassOptionsHTML() {
        return `
            <optgroup label="Elemental Magic">
                <option value="Elementalist">Elementalist (General)</option>
                <option value="Geomancer">Geomancer (Earth)</option>
                <option value="Hydromancer">Hydromancer (Water)</option>
                <option value="Pyromancer">Pyromancer (Fire)</option>
                <option value="Aeromancer">Aeromancer (Air)</option>
                <option value="Ferromancer">Ferromancer (Metal)</option>
                <option value="Dendromancer">Dendromancer (Wood)</option>
            </optgroup>
            <optgroup label="Body Magic">
                <option value="Body Mage">Body Mage (General)</option>
                <option value="Hemomancer">Hemomancer (Blood)</option>
                <option value="Osteomancer">Osteomancer (Bone)</option>
                <option value="Psychomancer">Psychomancer (Mind)</option>
                <option value="Morphomancer">Morphomancer (Morphic)</option>
                <option value="Vitalmancer">Vitalmancer (Life)</option>
                <option value="Necromancer">Necromancer (Death)</option>
            </optgroup>
            <optgroup label="Aether Magic">
                <option value="Aether Mage">Aether Mage (General)</option>
                <option value="Spatiomancer">Spatiomancer (Space)</option>
                <option value="Chronomancer">Chronomancer (Time)</option>
                <option value="Dimensionist">Dimensionist (Dimension)</option>
                <option value="Voidmancer">Voidmancer (Void)</option>
                <option value="Reality Weaver">Reality Weaver (Reality)</option>
                <option value="Transference Mage">Transference Mage (Transference)</option>
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
    // UI UPDATE FUNCTIONS - Render only, no domain logic
    // ============================================================

    function updateClassSuggestion() {
        if (!CharacterStats || typeof CharacterStats.suggestClass !== 'function') {
            return;
        }

        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = getStatValue(key);
        });

        var suggested = CharacterStats.suggestClass(stats);
        var display = document.getElementById('suggested-class');
        var descDisplay = document.getElementById('class-description-display');

        if (display) {
            if (suggested) {
                display.textContent = (suggested.icon || '') + ' ' + (suggested.label || '');
                display.style.color = 'var(--accent)';
                display.style.background = 'var(--accent-soft)';
                display.style.borderColor = 'var(--accent)';
                if (descDisplay && suggested.description) {
                    descDisplay.textContent = suggested.description;
                    descDisplay.style.borderLeftColor = 'var(--accent)';
                    descDisplay.style.color = 'var(--text)';
                }
            } else {
                display.textContent = '—';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
                if (descDisplay) {
                    descDisplay.textContent = 'No class suggested based on current stats.';
                    descDisplay.style.borderLeftColor = 'var(--border)';
                    descDisplay.style.color = 'var(--text-dim)';
                }
            }
        }
    }

    function updateMagicClassSuggestion() {
        if (!CharacterStats || typeof CharacterStats.suggestMagicClass !== 'function') {
            return;
        }

        var magic = {};
        MagicConstants.getTypeKeys().forEach(function(key) {
            magic[key] = getMagicValue(key);
        });

        // Create temporary character for suggestion
        var tempChar = { magic: magic };
        var suggested = CharacterStats.suggestMagicClass(tempChar);
        var display = document.getElementById('suggested-magic-class');

        if (display) {
            if (suggested) {
                display.textContent = suggested.name;
                display.style.color = 'var(--info)';
                display.style.background = 'var(--info-soft)';
                display.style.borderColor = 'var(--info)';
            } else {
                display.textContent = '—';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
            }
        }
    }

    function updateMagicPowerDisplay() {
        if (!CharacterStats || typeof CharacterStats.calculateMagicPower !== 'function') {
            return;
        }

        var magic = {};
        MagicConstants.getTypeKeys().forEach(function(key) {
            magic[key] = getMagicValue(key);
        });

        var tempChar = { magic: magic };
        var power = CharacterStats.calculateMagicPower(tempChar);
        var display = document.getElementById('magic-power-display-text');
        var rank = CharacterStats.getMagicRank(power);

        if (display) {
            var stars = '';
            var maxStars = 5;
            var filledStars = Math.round(power / 20);
            for (var i = 0; i < maxStars; i++) {
                stars += (i < filledStars) ? '★' : '☆';
            }
            display.textContent = stars + ' (' + Math.round(power) + '/100) - ' + rank;
        }
    }

    // ============================================================
    // SPECIAL MOVES RENDERING
    // ============================================================

    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

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
            move = move || {};
            if (typeof move !== 'object' || Array.isArray(move)) {
                move = { id: 'invalid', name: 'Invalid Move', description: '' };
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
            editBtn.dataset.moveId = move.id;
            editBtn.textContent = '✎';
            editBtn.setAttribute('aria-label', 'Edit move');
            actionsDiv.appendChild(editBtn);

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'remove-special-move small';
            deleteBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            deleteBtn.dataset.type = type;
            deleteBtn.dataset.moveId = move.id;
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
    // EDIT SPECIAL MOVE MODAL
    // ============================================================

    function openEditModal(charId, type, moveId, name, description) {
        if (!checkDependencies()) {
            return;
        }

        if (!charId) {
            console.warn('CharacterStatsView: charId is required');
            return;
        }

        if (type !== 'physical' && type !== 'magical') {
            console.warn('CharacterStatsView: invalid move type');
            return;
        }

        if (!moveId) {
            console.warn('CharacterStatsView: moveId is required');
            return;
        }

        var modal = Modal.createModal('modal-edit-special-move');

        // Build modal content
        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.textContent = 'Edit ' + type.charAt(0).toUpperCase() + type.slice(1) + ' Move';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close');
        header.appendChild(closeBtn);

        var body = document.createElement('div');
        body.className = 'modal-body';

        // Name field
        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Move Name';
        nameLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(nameLabel);

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'edit-move-name';
        nameInput.value = name || '';
        nameInput.placeholder = 'Enter move name';
        nameInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;margin-bottom:8px;';
        body.appendChild(nameInput);

        // Description field
        var descLabel = document.createElement('label');
        descLabel.textContent = 'Description (optional)';
        descLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(descLabel);

        var descInput = document.createElement('textarea');
        descInput.id = 'edit-move-desc';
        descInput.value = description || '';
        descInput.placeholder = 'Enter move description';
        descInput.rows = 3;
        descInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;font-family:Inter,sans-serif;resize:vertical;min-height:50px;margin-bottom:8px;';
        body.appendChild(descInput);

        // Actions
        var actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:4px 12px;font-size:0.7rem;';
        actions.appendChild(cancelBtn);

        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'primary';
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'padding:4px 12px;font-size:0.7rem;';
        actions.appendChild(saveBtn);

        body.appendChild(actions);

        var content = document.createElement('div');
        content.className = 'modal-content small';
        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);

        // Setup modal behavior
        Modal.modalSetup(modal);

        // Show modal
        Modal.showModal(modal);

        // Focus name input after render
        setTimeout(function() {
            nameInput.focus();
            nameInput.select();
        }, 50);

        // ---- Event Handlers ----
        function closeModal() {
            Modal.closeModal(modal);
        }

        function saveMove() {
            var newName = document.getElementById('edit-move-name').value;
            var newDesc = document.getElementById('edit-move-desc').value;

            if (!newName || newName.trim() === '') {
                // Notification is caller responsibility
                return;
            }

            // Dispatch event for CharacterEvents to handle
            var event = new CustomEvent('specialMoveEdit', {
                detail: {
                    charId: charId,
                    type: type,
                    moveId: moveId,
                    name: newName.trim(),
                    description: newDesc.trim()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);

            closeModal();
        }

        // Close button
        closeBtn.addEventListener('click', closeModal);

        // Cancel button
        cancelBtn.addEventListener('click', closeModal);

        // Save button
        saveBtn.addEventListener('click', saveMove);

        // Enter key on name input
        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveMove();
            }
        });

        // Escape key is handled by Modal.modalSetup
    }

    // ============================================================
    // EXPOSE
    ============================================================

    window.CharacterStatsView = {
        // HTML generation
        getStatsTabHTML: getStatsTabHTML,
        getMagicTabHTML: getMagicTabHTML,
        getSpecialMovesHTML: getSpecialMovesHTML,
        getMagicClassOptionsHTML: getMagicClassOptionsHTML,

        // Class select
        populateClassSelect: populateClassSelect,

        // UI updates (render only)
        updateClassSuggestion: updateClassSuggestion,
        updateMagicClassSuggestion: updateMagicClassSuggestion,
        updateMagicPowerDisplay: updateMagicPowerDisplay,

        // Special moves rendering
        renderSpecialMoves: renderSpecialMoves,

        // Edit modal
        openEditModal: openEditModal,

        // Constants (read-only)
        STAT_KEYS: STAT_KEYS,
        MAGIC_MAX: MAGIC_MAX,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH
    };

})();