/**
 * js/modules/characters/index.js - Character Module Entry Point
 * Path: js/modules/characters/index.js
 * 
 * This file is the conductor for the character module:
 *   - Renders the character manager container
 *   - Orchestrates child modules (list, form, events)
 *   - Manages current character selection persistence
 *   - Registers with TabManager
 * 
 * DEPENDENCIES (must be loaded before this file):
 *   - window.CharacterList
 *   - window.CharacterForm
 *   - window.CharacterEvents
 *   - window.CharacterStats
 *   - window.CharacterCRUD
 *   - window.CharacterViews
 *   - window.CharacterClasses
 *   - window.CharacterEliminations
 *   - window.getCharacterById (from utils)
 *   - window.setCurrentEditId (from this module)
 *   - window.currentEditId (from this module)
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

    var currentEditId = null;
    var characterListOpen = false;

    // ============================================================
    // EXPOSE STATE ACCESSORS
    // ============================================================

    function getCurrentEditId() {
        return currentEditId;
    }

    function setCurrentEditId(id) {
        currentEditId = id;
    }

    window.currentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    // ============================================================
    // TOGGLE CHARACTER LIST
    // ============================================================

    function toggleCharacterList(open) {
        var panel = document.getElementById('char-list-panel');
        var toggle = document.getElementById('toggle-char-list');
        if (!panel) return;
        
        if (open === undefined) {
            characterListOpen = !characterListOpen;
        } else {
            characterListOpen = open;
        }
        
        panel.classList.toggle('open', characterListOpen);
        if (toggle) {
            toggle.classList.toggle('open', characterListOpen);
        }
    }

    // Expose toggle for other modules
    window.toggleCharacterList = toggleCharacterList;

    // ============================================================
    // SHOW CHARACTER FORM
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
    // RENDER CHARACTERS
    // ============================================================

    function renderCharacters(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        // Check dependencies
        if (!window.CharacterList || !window.CharacterForm || !window.CharacterEvents) {
            console.warn('Character module dependencies not loaded yet');
            container.innerHTML = '<p class="empty-state">Loading character module...</p>';
            return;
        }

        // Check data
        if (!window.data) {
            console.warn('No data available for characters, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        // Ensure data structures
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
        
        // Initialize form and events
        if (window.CharacterForm && typeof window.CharacterForm.init === 'function') {
            window.CharacterForm.init(container);
        }
        
        if (window.CharacterEvents && typeof window.CharacterEvents.init === 'function') {
            window.CharacterEvents.init(container);
        }
        
        // Select the current character, preserving selection
        selectCurrentCharacter();
    }

    // ============================================================
    // SELECT CURRENT CHARACTER - PRESERVES SELECTION
    // ============================================================

    function selectCurrentCharacter() {
        var data = window.data || {};
        if (!data.characters || data.characters.length === 0) {
            return;
        }

        // Try to keep the currently selected character
        var charToShow = null;
        
        if (currentEditId) {
            charToShow = window.getCharacterById ? window.getCharacterById(currentEditId) : null;
        }
        
        // If current selection is gone, fall back to first character
        if (!charToShow) {
            charToShow = data.characters[0];
            if (charToShow) {
                setCurrentEditId(charToShow.id);
            }
        }
        
        if (charToShow && window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(charToShow.id);
        }
    }

    // ============================================================
    // CHARACTERS HTML
    // ============================================================

    function getCharactersHTML() {
        // Get tab HTML from the form module
        var tabsHTML = '';
        if (window.CharacterForm && typeof window.CharacterForm.getTabsHTML === 'function') {
            tabsHTML = window.CharacterForm.getTabsHTML();
        }

        return `
            <div class="character-manager">
                <div class="char-list-toggle">
                    <button id="toggle-char-list" class="primary small">☰ Characters</button>
                    <button id="add-character-btn" class="primary small">+ New</button>
                    <span id="current-char-name" style="font-weight:600;color:var(--accent);margin-left:8px;"></span>
                </div>

                <div id="char-list-panel" class="char-list-panel">
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

                <div id="character-form" class="form-container">
                    <h3 id="form-title">Select a character</h3>
                    <form id="char-form">
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
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('characters', renderCharacters);
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-characters');
        if (container && container.style.display !== 'none') {
            renderCharacters(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'characters') {
            var container = document.getElementById('tab-characters');
            if (container) {
                renderCharacters(container);
            }
        }
    });

    // If data already loaded, render
    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container && container.style.display !== 'none') {
                renderCharacters(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderCharacters = renderCharacters;
    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;
    window.currentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    console.log('characters/index.js loaded');

})();
