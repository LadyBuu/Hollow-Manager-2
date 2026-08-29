/**
 * js/modules/characters/index.js - Character Module Entry Point
 * Path: js/modules/characters/index.js
 * 
 * This file is the conductor for the character module:
 *   - Renders the character manager container
 *   - Orchestrates child modules (list, form, events)
 *   - Manages current character selection persistence
 *   - Registers with TabManager
 *   - Owns the selection state (getCurrentEditId / setCurrentEditId)
 * 
 * IMPORTANT:
 *   - This module owns selection state via getCurrentEditId() / setCurrentEditId()
 *   - All character selection changes MUST go through setCurrentEditId()
 *   - CharacterForm.show() is the only way to display a character
 *   - Events are bound by CharacterEvents after rendering
 *   - The list open state is preserved across re-renders
 *   - Can be destroyed and re-initialized for lifecycle management
 * 
 * LIFECYCLE:
 *   - renderCharacters(container) - Renders the module
 *   - destroy() - Removes all listeners and cleans up
 * 
 * DEPENDENCIES (must be loaded before this file):
 *   - window.CharacterList (from character-list.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterEvents (from character-events.js)
 *   - window.CharacterStats (from character-stats.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterViews (from character-views.js)
 *   - window.CharacterClasses (from character-classes.js)
 *   - window.CharacterEliminations (from character-eliminations.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentEditId (from this module)
 *   - window.setCurrentEditId (from this module)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__charactersIndexLoaded) {
        return;
    }
    window.__charactersIndexLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _currentEditId = null;
    var _characterListOpen = false;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'CharacterList',
            'CharacterForm',
            'CharacterEvents',
            'TabManager'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'CharacterList' || name === 'CharacterForm' || 
                name === 'CharacterEvents' || name === 'TabManager') {
                if (typeof window[name] === 'undefined' || window[name] === null) {
                    missing.push(name);
                }
            } else if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // Feature modules - required for their respective features
        var featureModules = [
            'CharacterStats',
            'CharacterCRUD',
            'CharacterViews',
            'CharacterClasses',
            'CharacterEliminations'
        ];

        var missingFeatures = [];
        featureModules.forEach(function(name) {
            if (typeof window[name] === 'undefined' || window[name] === null) {
                missingFeatures.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('Characters Index: Missing required dependencies:', missing.join(', '));
            return false;
        }

        if (missingFeatures.length > 0) {
            console.warn('Characters Index: Missing feature dependencies:', missingFeatures.join(', '));
            // Don't fail - features will be degraded
        }

        return true;
    }

    // ============================================================
    // STATE ACCESSORS - Single source of truth for selection
    // ============================================================

    function getCurrentEditId() {
        return _currentEditId;
    }

    function setCurrentEditId(id) {
        _currentEditId = id;
    }

    // Expose state accessors
    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    // ============================================================
    // TOGGLE CHARACTER LIST - Preserves state
    // ============================================================

    function toggleCharacterList(open) {
        var panel = document.getElementById('char-list-panel');
        var toggle = document.getElementById('toggle-char-list');
        if (!panel) return;
        
        if (open === undefined) {
            _characterListOpen = !_characterListOpen;
        } else {
            _characterListOpen = open;
        }
        
        panel.classList.toggle('open', _characterListOpen);
        if (toggle) {
            toggle.classList.toggle('open', _characterListOpen);
        }
    }

    // Expose toggle for other modules
    window.toggleCharacterList = toggleCharacterList;

    // ============================================================
    // SHOW CHARACTER FORM - Centralized selection
    // ============================================================

    function showCharacterForm(editId) {
        // Update the current selection state
        setCurrentEditId(editId);
        
        // Delegate to the form module
        if (window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(editId);
        } else {
            console.warn('CharacterForm.show() not available');
        }
    }

    // Expose for other modules
    window.showCharacterForm = showCharacterForm;

    // ============================================================
    // GET CHARACTERS HTML - Renders the container
    // ============================================================

    function getCharactersHTML() {
        var openClass = _characterListOpen ? ' open' : '';
        var toggleOpenClass = _characterListOpen ? ' open' : '';

        var tabsHTML = '';
        if (window.CharacterForm && typeof window.CharacterForm.getTabsHTML === 'function') {
            tabsHTML = window.CharacterForm.getTabsHTML();
        }

        return `
            <div class="character-manager">
                <div class="char-list-toggle">
                    <button id="toggle-char-list" class="primary small${toggleOpenClass}">☰ Characters</button>
                    <button id="add-character-btn" class="primary small">+ New</button>
                    <span id="current-char-name" style="font-weight:600;color:var(--accent);margin-left:8px;"></span>
                </div>

                <div id="char-list-panel" class="char-list-panel${openClass}">
                    <div class="filter-section compact">
                        <input type="text" id="char-name-filter" placeholder="Search..." style="width:120px;padding:3px 6px;font-size:0.7rem;" />
                        <select id="char-status-filter" style="padding:3px 6px;font-size:0.7rem;width:100px;">
                            <option value="all">All</option>
                            <option value="trainee">Trainee</option>
                            <option value="rookie">Rookie</option>
                            <option value="junior">Junior</option>
                            <option value="senior">Senior</option>
                            <option value="instructor">Instructor</option>
                            <option value="support">Support</option>
                            <option value="civilian">Civilian</option>
                            <option value="deceased">Deceased</option>
                            <option value="eliminated">Eliminated</option>
                        </select>
                        <select id="char-class-filter" style="padding:3px 6px;font-size:0.7rem;width:120px;">
                            <option value="all">All Classes</option>
                        </select>
                        <button id="clear-char-filter" class="small secondary" style="padding:2px 6px;">✕</button>
                    </div>
                    <div id="characters-container">
                        <p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters</p>
                    </div>
                </div>

                <div id="character-form-container" class="form-container">
                    <h3 id="form-title">Select a character</h3>
                    <form id="character-form">
                        ${tabsHTML}
                        <div class="form-actions" style="margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px;">
                            <button type="button" id="delete-char-btn" class="danger">Delete</button>
                            <button type="submit" id="save-char-btn" class="primary">Save Character</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    // ============================================================
    // RENDER CHARACTERS - Main render function
    // ============================================================

    function renderCharacters(container) {
        if (!checkDependencies()) {
            if (!container) {
                container = document.getElementById('tab-characters');
            }
            if (container) {
                container.innerHTML = '<p class="empty-state">Dependencies not loaded. Please refresh the page.</p>';
            }
            return;
        }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) {
            console.warn('Characters: Container #tab-characters not found');
            return;
        }

        if (!window.data) {
            console.warn('No data available for characters, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        // Ensure data structures (but don't mutate if not needed)
        if (!window.data.characters) {
            window.data.characters = [];
        }
        if (!window.data.classes) {
            window.data.classes = [];
        }

        // Build the container HTML
        container.innerHTML = getCharactersHTML();
        
        // Render the character list
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }
        
        // Initialize form (rendering only, no events)
        if (window.CharacterForm && typeof window.CharacterForm.init === 'function') {
            window.CharacterForm.init(container);
        }
        
        // Initialize events - this will remove any old listeners and bind new ones
        if (window.CharacterEvents && typeof window.CharacterEvents.init === 'function') {
            window.CharacterEvents.init(container);
        }
        
        // Select the current character, preserving selection
        selectCurrentCharacter();
    }

    // ============================================================
    // SELECT CURRENT CHARACTER - Preserves selection
    // ============================================================

    function selectCurrentCharacter() {
        var data = window.data || {};
        
        if (!data.characters || data.characters.length === 0) {
            setCurrentEditId(null);
            return;
        }

        var charToShow = null;
        
        if (_currentEditId) {
            charToShow = typeof window.getCharacterById === 'function' 
                ? window.getCharacterById(_currentEditId) 
                : null;
        }
        
        if (!charToShow) {
            charToShow = data.characters[0];
            if (charToShow) {
                setCurrentEditId(charToShow.id);
            }
        }
        
        if (charToShow) {
            showCharacterForm(charToShow.id);
        }
    }

    // ============================================================
    // DESTROY - Clean up for re-rendering
    // ============================================================

    function destroy() {
        if (window.CharacterEvents && typeof window.CharacterEvents.destroy === 'function') {
            window.CharacterEvents.destroy();
        }
    }

    // ============================================================
    // EVENT HANDLERS - With cleanup support
    // ============================================================

    function handleDataReady() {
        var container = document.getElementById('tab-characters');
        if (container && container.style.display !== 'none') {
            renderCharacters(container);
        }
    }

    function handleTabChanged(e) {
        if (e.detail && e.detail.tab === 'characters') {
            var container = document.getElementById('tab-characters');
            if (container) {
                renderCharacters(container);
            }
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined' && window.TabManager.register) {
        window.TabManager.register('characters', renderCharacters);
    }

    // ============================================================
    // BIND GLOBAL EVENT LISTENERS
    // ============================================================

    document.addEventListener('dataReady', handleDataReady);
    document.addEventListener('tabChanged', handleTabChanged);

    // ============================================================
    // INITIAL RENDER - If data already loaded
    // ============================================================

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container && container.style.display !== 'none') {
                renderCharacters(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE PUBLIC API
    // ============================================================

    window.renderCharacters = renderCharacters;
    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;
    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;
    window.destroyCharacters = destroy;

})();
