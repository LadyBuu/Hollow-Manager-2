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
 *   - This module is for RENDERING only - all domain logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses CharacterConstants for definitions
 *   - Uses CharacterQueries for character data
 *   - Uses CharacterStats for domain logic
 *   - Uses CharacterGenerator for random generation
 *   - Uses DomUtils for safe DOM operations
 *   - USES NotificationSystem for notifications
 *   - USES Modal for modal lifecycle management
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CharacterStats (from character-stats.js) - MANDATORY
 *   - window.CharacterGenerator (from character-generator.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var CharacterQueries = window.CharacterQueries;
    var CharacterStats = window.CharacterStats;
    var CharacterGenerator = window.CharacterGenerator;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;

    // ============================================================
    // CONSTANTS - From CharacterConstants
    // ============================================================

    var MAGIC_MAX = CharacterConstants ? CharacterConstants.MAGIC_MAX : 10;
    var STAT_MIN = CharacterConstants ? CharacterConstants.STAT_MIN : 1;
    var STAT_MAX = CharacterConstants ? CharacterConstants.STAT_MAX : 50;
    var STAT_DEFAULT = CharacterConstants ? CharacterConstants.STAT_DEFAULT : 10;
    var STAT_KEYS = CharacterConstants ? CharacterConstants.STAT_KEYS : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var MAGIC_TYPE_KEYS = CharacterConstants ? CharacterConstants.MAGIC_TYPE_KEYS : [];
    var MAGIC_CATEGORIES = CharacterConstants ? CharacterConstants.MAGIC_CATEGORIES : {};
    var CLASS_DEFINITIONS = CharacterConstants ? CharacterConstants.CLASS_DEFINITIONS : [];

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

        if (!CharacterGenerator) {
            missing.push('CharacterGenerator');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal');
        }

        if (missing.length > 0) {
            console.warn('CharacterStatsView: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getStatFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return STAT_DEFAULT;
        var val = parseInt(el.value, 10);
        if (isNaN(val)) return STAT_DEFAULT;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, val));
    }

    function getMagicFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return 0;
        var val = parseInt(el.value, 10);
        if (isNaN(val)) return 0;
        return Math.max(0, Math.min(MAGIC_MAX, val));
    }

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? value : '';
        }
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

    function updateClassSuggestion() {
        if (!CharacterStats || typeof CharacterStats.suggestClass !== 'function') {
            return;
        }

        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = getStatFromDOM('char-' + key);
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
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        // CharacterStats.suggestMagicClass expects a character object
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
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
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

    function applyPhysicalClass() {
        var select = document.getElementById('manual-class-select');
        var display = document.getElementById('suggested-class');
        
        if (!select || !select.value) {
            showNotification('Please select a class from the dropdown.', 'error');
            return;
        }

        var charId = CharacterStats.getCurrentEditId ? CharacterStats.getCurrentEditId() : null;
        if (!charId) {
            showNotification('No character selected.', 'error');
            return;
        }

        // The physical class is determined by stats, not stored directly
        // This applies the selected class by adjusting stats to match requirements
        var selectedId = select.value;
        var classDef = CLASS_DEFINITIONS.find(function(c) { return c.id === selectedId; });
        
        if (!classDef) {
            showNotification('Class definition not found.', 'error');
            return;
        }

        // Suggest stat adjustments based on class requirements
        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = getStatFromDOM('char-' + key);
        });

        // Apply minimum stat requirements
        var changed = false;
        var changes = [];

        if (classDef.minStats) {
            for (var stat in classDef.minStats) {
                if (Object.prototype.hasOwnProperty.call(classDef.minStats, stat)) {
                    var min = classDef.minStats[stat];
                    if (stats[stat] < min) {
                        stats[stat] = min;
                        changed = true;
                        changes.push(stat.toUpperCase() + ' -> ' + min);
                    }
                }
            }
        }

        if (!changed) {
            showNotification('Stats already meet the requirements for ' + classDef.label + '.', 'info');
            return;
        }

        // Apply stats to DOM
        for (var key in stats) {
            if (Object.prototype.hasOwnProperty.call(stats, key)) {
                setFieldValue('char-' + key, stats[key]);
            }
        }

        showNotification('Applied ' + classDef.label + ' requirements: ' + changes.join(', '), 'success');
        updateClassSuggestion();
    }

    function applyMagicClass() {
        var select = document.getElementById('manual-magic-class-select');
        var display = document.getElementById('suggested-magic-class');
        
        if (!select || !select.value) {
            showNotification('Please select a magic class from the dropdown.', 'error');
            return;
        }

        var charId = CharacterStats.getCurrentEditId ? CharacterStats.getCurrentEditId() : null;
        if (!charId) {
            showNotification('No character selected.', 'error');
            return;
        }

        var magicClass = select.value;
        var magic = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        // Apply magic class by setting minimum proficiency values
        var classMap = {
            'elementalist': { types: ['earth', 'water', 'fire', 'air', 'metal', 'wood'], min: 4 },
            'geomancer': { types: ['earth'], min: 7 },
            'hydromancer': { types: ['water'], min: 7 },
            'pyromancer': { types: ['fire'], min: 7 },
            'aeromancer': { types: ['air'], min: 7 },
            'ferromancer': { types: ['metal'], min: 7 },
            'dendromancer': { types: ['wood'], min: 7 },
            'body_mage': { types: ['blood', 'bone', 'mind', 'morphic', 'life', 'death'], min: 4 },
            'hemomancer': { types: ['blood'], min: 7 },
            'osteomancer': { types: ['bone'], min: 7 },
            'psychomancer': { types: ['mind'], min: 7 },
            'morphomancer': { types: ['morphic'], min: 7 },
            'vitalmancer': { types: ['life'], min: 7 },
            'necromancer': { types: ['death'], min: 7 },
            'aether_mage': { types: ['space', 'time', 'dimension', 'void', 'reality', 'transference'], min: 4 },
            'spatiomancer': { types: ['space'], min: 7 },
            'chronomancer': { types: ['time'], min: 7 },
            'dimensionist': { types: ['dimension'], min: 7 },
            'voidmancer': { types: ['void'], min: 7 },
            'reality_weaver': { types: ['reality'], min: 7 },
            'transference_mage': { types: ['transference'], min: 7 }
        };

        var config = classMap[magicClass];
        if (!config) {
            showNotification('Magic class configuration not found.', 'error');
            return;
        }

        var changed = false;
        var changes = [];

        config.types.forEach(function(type) {
            if (magic[type] < config.min) {
                magic[type] = config.min;
                changed = true;
                changes.push(type + ' -> ' + config.min);
            }
        });

        if (!changed) {
            showNotification('Magic proficiencies already meet the requirements.', 'info');
            return;
        }

        // Apply magic to DOM
        for (var key in magic) {
            if (Object.prototype.hasOwnProperty.call(magic, key)) {
                setFieldValue('magic-' + key, magic[key]);
            }
        }

        showNotification('Applied magic class requirements: ' + changes.join(', '), 'success');
        updateMagicClassSuggestion();
        updateMagicPowerDisplay();
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
    // EDIT SPECIAL MOVE - Opens edit modal using Modal utility
    // ============================================================

    function editSpecialMove(charId, type, index) {
        if (!charId) {
            showNotification('Character ID is required.', 'error');
            return;
        }

        if (type !== 'physical' && type !== 'magical') {
            showNotification('Invalid move type.', 'error');
            return;
        }

        var idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0) {
            showNotification('Invalid move index.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            showNotification('No special moves found.', 'error');
            return;
        }

        if (!Array.isArray(char.specialMoves.physical) || !Array.isArray(char.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return;
        }

        if (!char.specialMoves[type] || !Array.isArray(char.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return;
        }

        if (idx < 0 || idx >= char.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return;
        }

        var move = char.specialMoves[type][idx];
        var moveName = move && move.name ? move.name : '';
        var moveDesc = move && move.description ? move.description : '';

        // Use Modal utility for lifecycle management
        var modal = Modal.createModal('modal-edit-special-move');

        // Build modal content using DomUtils for safety
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
        nameInput.value = moveName;
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
        descInput.value = moveDesc;
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
                showNotification('Move name is required.', 'error');
                return;
            }

            if (CharacterStats && typeof CharacterStats.updateSpecialMove === 'function') {
                CharacterStats.updateSpecialMove(charId, type, idx, newName, newDesc)
                    .then(function(success) {
                        if (success) {
                            closeModal();
                        }
                    })
                    .catch(function() {
                        // Error already shown by updateSpecialMove
                    });
            }
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
    // MAGIC TYPE HELPERS (delegate to constants)
    // ============================================================

    function getMagicTypeKeys() {
        if (CharacterConstants && typeof CharacterConstants.getMagicTypeKeys === 'function') {
            return CharacterConstants.getMagicTypeKeys();
        }
        return MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        if (CharacterConstants && typeof CharacterConstants.getMagicCategoryTypes === 'function') {
            return CharacterConstants.getMagicCategoryTypes(category);
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

        // Apply class
        applyPhysicalClass: applyPhysicalClass,
        applyMagicClass: applyMagicClass,

        // Special moves rendering
        renderSpecialMoves: renderSpecialMoves,

        // Edit modal
        editSpecialMove: editSpecialMove,

        // Magic type helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,

        // Constants
        STAT_KEYS: STAT_KEYS,
        MAGIC_MAX: MAGIC_MAX,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT
    };

})();
