/**
 * modules/characters/index.js - Characters Module Entry Point
 * Single entry point for all character functionality
 * Path: js/modules/characters/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the character container
 *   - Initializing all character sub-modules
 *   - Managing character lifecycle
 *   - Coordinating character state
 * 
 * LIFECYCLE:
 *   TabManager.register('characters') → mountCharacters() → 
 *   CharacterList.render() → CharacterForm.render() → CharacterEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for characters
 *   - All character logic lives in the sub-modules
 *   - This module does NOT implement character logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountCharacters() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - No dataReady/tabChanged listeners - TabManager handles lifecycle
 * 
 * STATE SOURCE OF TRUTH:
 *   - _currentEditId is the canonical edit state (PRIVATE)
 *   - Exposed via getCurrentEditId/setCurrentEditId (INTERNAL USE ONLY)
 *   - window.data is the source of truth for persisted application data
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.CharacterList (from character-list.js) - MANDATORY
 *   - window.CharacterForm (from character-form.js) - MANDATORY
 *   - window.CharacterEvents (from character-events.js) - MANDATORY
 *   - window.DataLoader (from loader.js) - OPTIONAL (for compatibility)
 * 
 * EXPOSED API:
 *   - window.mountCharacters(container) - Mount the character feature
 *   - window.showCharacterForm(id) - Show character form
 *   - window.toggleCharacterList(forceState) - Toggle character list
 *   - window.getCurrentEditId() - Get current edit ID (internal)
 *   - window.setCurrentEditId(id) - Set current edit ID (internal)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterList = window.CharacterList;
    var CharacterForm = window.CharacterForm;
    var CharacterEvents = window.CharacterEvents;
    var DataLoader = window.DataLoader;
    var CharacterClassView = window.CharacterClassView;

    // ============================================================
    // STATE - Single source of truth for character edit state
    // ============================================================
    
    // Private module-scoped variable - NOT exposed directly
    var _currentEditId = null;
    var _initialized = false;
    var _mounted = false;

    // ============================================================
    // DEPENDENCY CHECK - Only immediate collaborators
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // TabManager is MANDATORY
        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        // CharacterList is MANDATORY
        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        // CharacterForm is MANDATORY
        if (!CharacterForm || typeof CharacterForm.render !== 'function') {
            missing.push('CharacterForm.render');
        }
        if (!CharacterForm || typeof CharacterForm.collect !== 'function') {
            missing.push('CharacterForm.collect');
        }

        // CharacterEvents is MANDATORY
        if (!CharacterEvents || typeof CharacterEvents.init !== 'function') {
            missing.push('CharacterEvents.init');
        }
        if (!CharacterEvents || typeof CharacterEvents.destroy !== 'function') {
            missing.push('CharacterEvents.destroy');
        }

        if (missing.length > 0) {
            console.warn('[CharactersModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountCharacters(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }

        if (!container) {
            console.warn('[CharactersModule] Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading character data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Character dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // If already mounted, clean up first
        if (_mounted) {
            unmountCharacters();
        }

        // Render the character container
        container.innerHTML = getCharactersHTML();

        // Initialize character list
        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn('[CharactersModule] CharacterList.render failed:', e);
            }
        }

        // Populate class filter
        if (CharacterClassView && typeof CharacterClassView.populateClassFilter === 'function') {
            try {
                CharacterClassView.populateClassFilter();
            } catch (e) {
                console.warn('[CharactersModule] CharacterClassView.populateClassFilter failed:', e);
            }
        }

        // Initialize character events (binds all listeners)
        if (CharacterEvents && typeof CharacterEvents.init === 'function') {
            try {
                CharacterEvents.init(container);
            } catch (e) {
                console.warn('[CharactersModule] CharacterEvents.init failed:', e);
            }
        }

        // Show the current character if any
        var editId = getCurrentEditId();
        if (editId && CharacterForm && typeof CharacterForm.render === 'function') {
            try {
                CharacterForm.render(editId);
            } catch (e) {
                console.warn('[CharactersModule] CharacterForm.render failed:', e);
            }
        }

        _mounted = true;
        _initialized = true;

        dispatchReady();
    }

    function unmountCharacters() {
        if (!_mounted) return;

        // Destroy events (removes all listeners)
        if (CharacterEvents && typeof CharacterEvents.destroy === 'function') {
            try {
                CharacterEvents.destroy();
            } catch (e) {
                // Ignore destroy errors
            }
        }

        _mounted = false;
        _initialized = false;
    }

    // ============================================================
    // CHARACTERS HTML
    // ============================================================

    function getCharactersHTML() {
        return `
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="toggle-char-list" class="secondary small" aria-label="Toggle character list">☰</button>
                            <button id="add-character-btn" class="primary small">+ Add</button>
                        </div>
                    </div>
                    <div class="characters-filters">
                        <input type="text" id="char-name-filter" placeholder="Filter by name..." />
                        <select id="char-class-filter">
                            <option value="all">All Classes</option>
                        </select>
                        <div class="filter-checkboxes" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:4px 0;">
                            <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                <input type="checkbox" id="hide-deceased" checked />
                                Hide Deceased
                            </label>
                            <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                <input type="checkbox" id="hide-eliminated" checked />
                                Hide Eliminated
                            </label>
                            <button id="clear-char-filter" class="small secondary" style="font-size:0.55rem;padding:2px 8px;">Clear</button>
                        </div>
                    </div>
                    <div id="char-list-panel">
                        <div id="characters-container"></div>
                    </div>
                </div>
                <div class="characters-form-container">
                    <div id="character-form-container">
                        <form id="character-form" style="display:none;">
                            <div class="form-header">
                                <h3 id="form-title">No Character Selected</h3>
                                <span id="current-char-name" class="char-name-display" style="display:none;"></span>
                                <div class="form-actions">
                                    <button type="button" id="delete-char-btn" class="danger small">Delete</button>
                                    <button type="submit" id="save-char-btn" class="primary">Save</button>
                                </div>
                            </div>
                            <div id="character-form-content">
                                <p class="empty-state">Select a character from the list to view and edit details.</p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // STATE MANAGEMENT - Private, exposed via controlled API
    // ============================================================

    /**
     * Get the current edit ID from the module state.
     * INTERNAL USE ONLY - exposed for sub-modules.
     */
    function getCurrentEditId() {
        return _currentEditId;
    }

    /**
     * Set the current edit ID in the module state.
     * INTERNAL USE ONLY - exposed for sub-modules.
     */
    function setCurrentEditId(id) {
        // Normalise: null, undefined, empty string all become null
        if (id === undefined || id === null || id === '') {
            _currentEditId = null;
            return;
        }
        _currentEditId = String(id);
    }

    /**
     * Show the character form for a specific character.
     * Public API - the primary way to open a character.
     */
    function showCharacterForm(id) {
        // Normalise the ID
        var normalisedId = (id !== undefined && id !== null && id !== '') ? String(id) : null;
        setCurrentEditId(normalisedId);

        if (CharacterForm && typeof CharacterForm.render === 'function') {
            CharacterForm.render(normalisedId);
        }
    }

    /**
     * Toggle the character list panel.
     */
    function toggleCharacterList(forceState) {
        var panel = document.getElementById('char-list-panel');
        if (!panel) return;

        if (forceState !== undefined) {
            panel.classList.toggle('open', forceState);
        } else {
            panel.classList.toggle('open');
        }
    }

    /**
     * Clear the current edit state (e.g., after deletion).
     * Internal use only.
     */
    function clearEditState() {
        setCurrentEditId(null);
        if (CharacterForm && typeof CharacterForm.hide === 'function') {
            CharacterForm.hide();
        }
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('charactersReady', {
                detail: {
                    mounted: _mounted,
                    initialized: _initialized,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    // ============================================================
    // TAB MANAGER REGISTRATION
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('characters', mountCharacters);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        // TabManager not ready - wait for it via event
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA READY HANDLING (minimal - TabManager owns lifecycle)
    // ============================================================

    // Listen for data ready to handle initial mount if needed
    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data && !_mounted) {
                // If the characters tab is currently active, mount it
                if (TabManager && TabManager.getCurrentTab() === 'characters') {
                    var container = document.getElementById('tab-characters');
                    if (container) {
                        mountCharacters(container);
                    }
                }
            }
        });
    }

    // ============================================================
    // EXPOSE - Controlled public API
    // ============================================================

    // Main mount function
    window.mountCharacters = mountCharacters;

    // State management (internal use only, exposed for sub-modules)
    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    // Public API
    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;

    // Internal API (for sub-modules)
    window._clearEditState = clearEditState;

    // ============================================================
    // LIFECYCLE EVENTS - REMOVED redundant triggers
    // ============================================================
    // NOTE: TabManager is now the single source of truth for lifecycle.
    // The dataReady and tabChanged listeners have been removed.
    // Data readiness is handled by TabManager before calling mountCharacters.

})();