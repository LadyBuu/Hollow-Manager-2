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
 *   - Applying class requirements to stats (using minStats from CLASS_DEFINITIONS)
 *   - Applying magic class distributions
 * 
 * IMPORTANT:
 *   - This module is for RENDERING only - all logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses CharacterConstants for definitions
 *   - Uses DomUtils for safe DOM operations
 *   - applyPhysicalClass() uses minStats as the source of truth
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CharacterStats (from character-stats.js) - for logic
 *   - window.CharacterGenerator (from character-generator.js) - for random generation
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

        if (!window.CharacterGenerator) {
            missing.push('CharacterGenerator');
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
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getStatFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return 10;
        var val = parseInt(el.value);
        if (isNaN(val)) return 10;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, val));
    }

    function getMagicFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return 0;
        var val = parseInt(el.value);
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
        if (!window.CharacterStats || typeof window.CharacterStats.suggestClass !== 'function') {
            return;
        }

        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = getStatFromDOM('char-' + key);
        });

        var suggested = window.CharacterStats.suggestClass(stats);
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
        if (!window.CharacterStats || typeof window.CharacterStats.suggestMagicClass !== 'function') {
            return;
        }

        var magic = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        var tempChar = { magic: magic };
        var suggested = window.CharacterStats.suggestMagicClass(tempChar);
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
        if (!window.CharacterStats || typeof window.CharacterStats.getMagicPowerDisplay !== 'function') {
            return;
        }

        var magic = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        var tempChar = { magic: magic };
        var display = document.getElementById('magic-power-display-text');
        if (display) {
            display.textContent = window.CharacterStats.getMagicPowerDisplay(tempChar);
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
    // APPLY PHYSICAL CLASS - FIXED: Uses minStats as source of truth
    // ============================================================

    function applyPhysicalClass() {
        var select = document.getElementById('manual-class-select');
        if (!select || !select.value) {
            showNotification('Please select a class first.', 'warning');
            return;
        }

        var classId = select.value;
        var cls = CLASS_DEFINITIONS.find(function(c) { return c.id === classId; });
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        // Start with base stats (minimum 10)
        var stats = {
            str: 10,
            dex: 10,
            con: 10,
            int: 10,
            wis: 10,
            cha: 10
        };

        // ---- USE MINSTATS AS SOURCE OF TRUTH ----
        // Apply minimum stat requirements from the class definition
        for (var stat in cls.minStats) {
            if (Object.prototype.hasOwnProperty.call(cls.minStats, stat)) {
                stats[stat] = Math.max(stats[stat], cls.minStats[stat]);
            }
        }

        // Apply secondary stats (if defined) - they get a moderate boost
        if (cls.secondaryStats && cls.secondaryStats.length > 0) {
            // Calculate the average secondary stat value from minStats
            var secondaryTotal = 0;
            var secondaryCount = 0;
            cls.secondaryStats.forEach(function(stat) {
                if (cls.minStats[stat] !== undefined) {
                    secondaryTotal += cls.minStats[stat];
                    secondaryCount++;
                }
            });
            
            var secondaryBase = secondaryCount > 0 ? Math.round(secondaryTotal / secondaryCount) : 12;
            
            // Apply to secondary stats that don't already exceed the base
            cls.secondaryStats.forEach(function(stat) {
                if (stats[stat] < secondaryBase) {
                    stats[stat] = secondaryBase;
                }
            });
        }

        // ---- DISTRIBUTE REMAINING POINTS ----
        // Calculate total invested vs target total
        var investedTotal = 0;
        STAT_KEYS.forEach(function(stat) {
            investedTotal += stats[stat];
        });

        // Target: 10 + 6 bonus points distributed
        var targetTotal = 10 * STAT_KEYS.length + 6;

        // Calculate remaining points
        var remainingPoints = Math.max(0, targetTotal - investedTotal);

        // Prioritise stat distribution: primary stats first, then secondary, then others
        var priorityStats = [];
        cls.primaryStats.forEach(function(s) {
            if (priorityStats.indexOf(s) === -1) {
                priorityStats.push(s);
            }
        });
        if (cls.secondaryStats) {
            cls.secondaryStats.forEach(function(s) {
                if (priorityStats.indexOf(s) === -1) {
                    priorityStats.push(s);
                }
            });
        }
        STAT_KEYS.forEach(function(s) {
            if (priorityStats.indexOf(s) === -1) {
                priorityStats.push(s);
            }
        });

        while (remainingPoints > 0) {
            for (var i = 0; i < priorityStats.length && remainingPoints > 0; i++) {
                var stat = priorityStats[i];
                var bonus = Math.min(remainingPoints, Math.floor(Math.random() * 2) + 1);
                stats[stat] += bonus;
                remainingPoints -= bonus;
            }
        }

        // ---- APPLY TO DOM ----
        STAT_KEYS.forEach(function(stat) {
            setFieldValue('char-' + stat, stats[stat]);
        });

        updateClassSuggestion();
        showNotification('Applied ' + cls.label + ' class requirements!', 'success');
    }

    // ============================================================
    // APPLY MAGIC CLASS
    // ============================================================

    function applyMagicClass() {
        var select = document.getElementById('manual-magic-class-select');
        if (!select || !select.value) {
            showNotification('Please select a magic class first.', 'warning');
            return;
        }

        var classType = select.value;
        var magic = {};
        var allKeys = MAGIC_TYPE_KEYS.slice();
        allKeys.forEach(function(key) {
            magic[key] = 0;
        });

        var classMap = {
            'elementalist': { category: 'elemental', primary: null, label: 'Elementalist' },
            'geomancer': { category: 'elemental', primary: 'earth', label: 'Geomancer' },
            'hydromancer': { category: 'elemental', primary: 'water', label: 'Hydromancer' },
            'pyromancer': { category: 'elemental', primary: 'fire', label: 'Pyromancer' },
            'aeromancer': { category: 'elemental', primary: 'air', label: 'Aeromancer' },
            'ferromancer': { category: 'elemental', primary: 'metal', label: 'Ferromancer' },
            'dendromancer': { category: 'elemental', primary: 'wood', label: 'Dendromancer' },
            'body_mage': { category: 'body', primary: null, label: 'Body Mage' },
            'hemomancer': { category: 'body', primary: 'blood', label: 'Hemomancer' },
            'osteomancer': { category: 'body', primary: 'bone', label: 'Osteomancer' },
            'psychomancer': { category: 'body', primary: 'mind', label: 'Psychomancer' },
            'morphomancer': { category: 'body', primary: 'morphic', label: 'Morphomancer' },
            'vitalmancer': { category: 'body', primary: 'life', label: 'Vitalmancer' },
            'necromancer': { category: 'body', primary: 'death', label: 'Necromancer' },
            'aether_mage': { category: 'aether', primary: null, label: 'Aether Mage' },
            'spatiomancer': { category: 'aether', primary: 'space', label: 'Spatiomancer' },
            'chronomancer': { category: 'aether', primary: 'time', label: 'Chronomancer' },
            'dimensionist': { category: 'aether', primary: 'dimension', label: 'Dimensionist' },
            'voidmancer': { category: 'aether', primary: 'void', label: 'Voidmancer' },
            'reality_weaver': { category: 'aether', primary: 'reality', label: 'Reality Weaver' },
            'transference_mage': { category: 'aether', primary: 'transference', label: 'Transference Mage' }
        };

        var config = classMap[classType];
        if (!config) {
            showNotification('Unknown magic class.', 'error');
            return;
        }

        var category = config.category;
        var primary = config.primary;
        var types = getMagicCategoryTypes(category);

        types.forEach(function(key) {
            magic[key] = Math.floor(Math.random() * 3) + 5;
        });

        if (primary && magic[primary] !== undefined) {
            magic[primary] = Math.floor(Math.random() * 3) + 8;
        }

        allKeys.forEach(function(key) {
            if (magic[key] === 0) {
                magic[key] = Math.floor(Math.random() * 3) + 1;
            }
        });

        allKeys.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                input.value = magic[key];
            }
        });

        updateMagicClassSuggestion();
        updateMagicPowerDisplay();
        showNotification('Applied ' + config.label + ' magic distribution!', 'success');
    }

    // ============================================================
    // EDIT SPECIAL MOVE - Opens edit modal
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

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
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

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';

        var modalContent = document.createElement('div');
        modalContent.className = 'modal-content small';

        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.textContent = 'Edit ' + type.charAt(0).toUpperCase() + type.slice(1) + ' Move';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.textContent = '×';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'var(--text-dim)';
        closeBtn.style.fontSize = '1.2rem';
        closeBtn.style.cursor = 'pointer';
        header.appendChild(closeBtn);

        var body = document.createElement('div');
        body.className = 'modal-body';

        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Move Name';
        nameLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(nameLabel);

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'edit-move-name';
        nameInput.value = moveName;
        nameInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;margin-bottom:8px;';
        body.appendChild(nameInput);

        var descLabel = document.createElement('label');
        descLabel.textContent = 'Description (optional)';
        descLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(descLabel);

        var descInput = document.createElement('textarea');
        descInput.id = 'edit-move-desc';
        descInput.value = moveDesc;
        descInput.rows = 3;
        descInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;font-family:Inter,sans-serif;resize:vertical;min-height:50px;margin-bottom:8px;';
        body.appendChild(descInput);

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

        modalContent.appendChild(header);
        modalContent.appendChild(body);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        function closeModal() {
            if (modal.parentNode) modal.remove();
        }

        function saveMove() {
            var newName = document.getElementById('edit-move-name').value;
            var newDesc = document.getElementById('edit-move-desc').value;
            
            if (!newName || newName.trim() === '') {
                showNotification('Move name is required.', 'error');
                return;
            }

            // Use the ID-based update API
            if (window.CharacterStats && typeof window.CharacterStats.updateSpecialMove === 'function') {
                window.CharacterStats.updateSpecialMove(charId, type, idx, newName, newDesc)
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

        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;
        saveBtn.onclick = saveMove;

        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });

        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') saveMove();
        });

        setTimeout(function() {
            nameInput.focus();
            nameInput.select();
        }, 50);
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

        // Apply functions
        applyPhysicalClass: applyPhysicalClass,
        applyMagicClass: applyMagicClass,

        // Edit modal
        editSpecialMove: editSpecialMove,

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
