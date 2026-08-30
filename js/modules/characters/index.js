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
 *   - Waits for dataReady event before rendering
 * 
 * LIFECYCLE:
 *   - renderCharacters(container) - Renders the module
 *   - destroy() - Removes all listeners and cleans up
 * 
 * REQUIRED DEPENDENCIES:
 *   - window.CharacterList (from character-list.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterEvents (from character-events.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 * 
 * OPTIONAL FEATURE MODULES:
 *   - window.CharacterStats
 *   - window.CharacterCRUD
 *   - window.CharacterViews
 *   - window.CharacterClasses
 *   - window.CharacterEliminations
 * 
 * DATA READY HANDLING:
 *   - Renders immediately if window.data exists
 *   - Waits for 'dataReady' event if data not yet loaded
 *   - Shows loading state while waiting
 *   - Handles data corruption gracefully
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
    var _listenersBound = false;
    var _isRendering = false;
    var _pendingRender = false;
    var _dataReadyFired = false;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function hasMethods(obj, methods) {
        if (!obj || typeof obj !== 'object') return false;
        for (var i = 0; i < methods.length; i++) {
            if (typeof obj[methods[i]] !== 'function') {
                return false;
            }
        }
        return true;
    }

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

        // Verify required module APIs
        if (window.CharacterList && !hasMethods(window.CharacterList, ['render'])) {
            missing.push('CharacterList.render');
        }
        if (window.CharacterForm && !hasMethods(window.CharacterForm, ['show', 'init', 'getTabsHTML'])) {
            missing.push('CharacterForm (missing required methods)');
        }
        if (window.CharacterEvents && !hasMethods(window.CharacterEvents, ['init', 'destroy'])) {
            missing.push('CharacterEvents (missing required methods)');
        }
        if (window.TabManager && !hasMethods(window.TabManager, ['register'])) {
            missing.push('TabManager.register');
        }

        if (missing.length > 0) {
            console.warn('Characters Index: Missing required dependencies:', missing.join(', '));
            return false;
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
        // Prevent concurrent renders
        if (_isRendering) {
            _pendingRender = true;
            return;
        }

        _isRendering = true;

        try {
            if (!checkDependencies()) {
                if (!container) {
                    container = document.getElementById('tab-characters');
                }
                if (container) {
                    container.innerHTML = '<p class="empty-state">Dependencies not loaded. Please refresh the page.</p>';
                }
                _isRendering = false;
                return;
            }

            if (!container) {
                container = document.getElementById('tab-characters');
            }
            if (!container) {
                console.warn('Characters: Container #tab-characters not found');
                _isRendering = false;
                return;
            }

            // Wait for data
            if (!window.data) {
                container.innerHTML = '<p class="empty-state">Loading data...</p>';
                // Listen for dataReady if not already listening
                if (!container._dataListener) {
                    container._dataListener = true;
                    document.addEventListener('dataReady', function onDataReady() {
                        document.removeEventListener('dataReady', onDataReady);
                        // Re-render when data is ready
                        if (!_isRendering) {
                            renderCharacters(container);
                        } else {
                            _pendingRender = true;
                        }
                    });
                }
                _isRendering = false;
                return;
            }

            // Validate data structures - fail closed
            if (!Array.isArray(window.data.characters)) {
                console.warn('Characters: Invalid characters data structure');
                container.innerHTML = '<p class="empty-state">Character data is corrupted. Please reload.</p>';
                _isRendering = false;
                return;
            }

            if (!Array.isArray(window.data.classes)) {
                console.warn('Characters: Invalid classes data structure');
                container.innerHTML = '<p class="empty-state">Class data is corrupted. Please reload.</p>';
                _isRendering = false;
                return;
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

            // Bind global listeners if not already bound
            bindGlobalListeners();

        } catch (err) {
            console.error('Characters: Error rendering:', err);
            if (container) {
                container.innerHTML = '<p class="empty-state" style="color:var(--danger);">Error loading characters. Please refresh the page.</p>';
            }
        } finally {
            _isRendering = false;
            // Handle any pending render requests
            if (_pendingRender) {
                _pendingRender = false;
                renderCharacters(container);
            }
        }
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
    // GLOBAL LISTENERS - With proper lifecycle management
    // ============================================================

    function bindGlobalListeners() {
        if (_listenersBound) return;
        document.addEventListener('dataReady', handleDataReady);
        document.addEventListener('tabChanged', handleTabChanged);
        _listenersBound = true;
    }

    function unbindGlobalListeners() {
        if (!_listenersBound) return;
        document.removeEventListener('dataReady', handleDataReady);
        document.removeEventListener('tabChanged', handleTabChanged);
        _listenersBound = false;
    }

    function handleDataReady(e) {
        var detail = e && e.detail;
        var status = detail ? detail.status : null;
        
        if (status === 'failed') {
            var container = document.getElementById('tab-characters');
            if (container) {
                container.innerHTML = '<p class="empty-state" style="color:var(--danger);">Failed to load character data. Please refresh the page.</p>';
            }
            return;
        }

        _dataReadyFired = true;

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
    // DESTROY - Clean up for re-rendering
    // ============================================================

    function destroy() {
        if (window.CharacterEvents && typeof window.CharacterEvents.destroy === 'function') {
            window.CharacterEvents.destroy();
        }
        unbindGlobalListeners();
        _isRendering = false;
        _pendingRender = false;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined' && window.TabManager.register) {
        window.TabManager.register('characters', renderCharacters);
    }

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
