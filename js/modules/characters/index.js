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
 *   - Ensuring CharacterAggregator is available
 *   - Mounting the relationship modal shell (used by character-views / character-events)
 * 
 * LIFECYCLE:
 *   TabManager.register('characters') -> mountCharacters() -> 
 *   CharacterList.render() -> CharacterForm.render() -> CharacterEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for characters
 *   - All character logic lives in the sub-modules
 *   - This module does NOT implement character logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountCharacters() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - CharacterAggregator is verified at initialization
 *   - The relationship modal shell (#character-relationship-modal) is mounted here ONCE
 *   - The graph modal is created on demand by CharacterEvents
 * 
 * STATE SOURCE OF TRUTH:
 *   - _currentEditId is the canonical edit state (PRIVATE)
 *   - Exposed via getCurrentEditId/setCurrentEditId (INTERNAL USE ONLY)
 *   - window.data is the source of truth for persisted application data
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.CharacterAggregator (from character-aggregator.js) - MANDATORY
 *   - window.CharacterList (from character-list.js) - MANDATORY
 *   - window.CharacterForm (from character-form.js) - MANDATORY
 *   - window.CharacterEvents (from character-events.js) - MANDATORY
 *   - window.CharacterClassView (from character-class-view.js) - MANDATORY
 *   - window.CharacterViews (from character-views.js) - MANDATORY (for Social tab)
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

    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterAggregator = window.CharacterAggregator;
    var CharacterList = window.CharacterList;
    var CharacterForm = window.CharacterForm;
    var CharacterEvents = window.CharacterEvents;
    var DataLoader = window.DataLoader;
    var CharacterClassView = window.CharacterClassView;
    var CharacterViews = window.CharacterViews;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        // CharacterAggregator is MANDATORY - verify it's loaded
        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }
        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterListViewModel !== 'function') {
            missing.push('CharacterAggregator.getCharacterListViewModel');
        }

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (!CharacterForm || typeof CharacterForm.render !== 'function') {
            missing.push('CharacterForm.render');
        }
        if (!CharacterForm || typeof CharacterForm.collect !== 'function') {
            missing.push('CharacterForm.collect');
        }

        if (!CharacterEvents || typeof CharacterEvents.init !== 'function') {
            missing.push('CharacterEvents.init');
        }
        if (!CharacterEvents || typeof CharacterEvents.destroy !== 'function') {
            missing.push('CharacterEvents.destroy');
        }

        if (!CharacterClassView || typeof CharacterClassView.populateClassFilter !== 'function') {
            missing.push('CharacterClassView.populateClassFilter');
        }

        // CharacterViews is required for the Social tab to render.
        // If it's missing, we still mount the rest of the form.
        if (!CharacterViews || typeof CharacterViews.renderCharacterSocial !== 'function') {
            console.warn('[CharactersModule] CharacterViews not loaded - Social tab will be empty.');
        }

        if (missing.length > 0) {
            console.warn('[CharactersModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _currentEditId = null;
    var _initialized = false;
    var _mounted = false;

    // ============================================================
    // MOUNT / UNMOUNT
    // ============================================================

    function mountCharacters(container) {
        if (!checkDependencies()) {
            console.warn('[CharactersModule] Dependencies not met, skipping mount');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-characters');
        }

        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading character data...</p>';
            return;
        }

        if (_mounted) {
            unmountCharacters();
        }

        container.innerHTML = getCharactersHTML();

        // Render character list - uses Aggregator internally
        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn('[CharactersModule] CharacterList.render failed:', e);
            }
        }

        // Populate class filter - uses AcademyQueries directly
        if (CharacterClassView && typeof CharacterClassView.populateClassFilter === 'function') {
            try {
                CharacterClassView.populateClassFilter();
            } catch (e) {
                console.warn('[CharactersModule] populateClassFilter failed:', e);
            }
        }

        // Initialize events - uses Aggregator for projections, Queries for simple reads
        if (CharacterEvents && typeof CharacterEvents.init === 'function') {
            try {
                CharacterEvents.init(container);
            } catch (e) {
                console.warn('[CharactersModule] CharacterEvents.init failed:', e);
            }
        }

        // Show form if there's an edit ID
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
        if (!_mounted) {
            return;
        }

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
    // HTML GENERATOR
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

            <!-- Relationship Modal Shell (used by CharacterViews / CharacterEvents) -->
            <div id="character-relationship-modal" class="modal hidden" style="display:none;">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="character-relationship-modal-title">Add Relationship</h3>
                        <button type="button" id="close-char-relationship-modal" class="close-modal" aria-label="Close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="character-relationship-form-container"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // EDIT ID MANAGEMENT
    // ============================================================

    function getCurrentEditId() {
        return _currentEditId;
    }

    function setCurrentEditId(id) {
        if (id === undefined || id === null || id === '') {
            _currentEditId = null;
            return;
        }
        _currentEditId = String(id);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function showCharacterForm(id) {
        var normalisedId = (id !== undefined && id !== null && id !== '') ? String(id) : null;
        setCurrentEditId(normalisedId);

        if (CharacterForm && typeof CharacterForm.render === 'function') {
            CharacterForm.render(normalisedId);
        }
    }

    function toggleCharacterList(forceState) {
        var panel = document.getElementById('char-list-panel');
        if (!panel) {
            return;
        }

        if (forceState !== undefined) {
            panel.classList.toggle('open', forceState);
        } else {
            panel.classList.toggle('open');
        }
    }

    function clearEditState() {
        setCurrentEditId(null);
        if (CharacterForm && typeof CharacterForm.hide === 'function') {
            CharacterForm.hide();
        }
    }

    // ============================================================
    // EVENT DISPATCH
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
    // REGISTER WITH TABMANAGER
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('characters', mountCharacters);
            return true;
        }
        return false;
    }

    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA LOADER INTEGRATION
    // ============================================================

    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data && !_mounted) {
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
    // EXPOSE - NAMESPACED API
    // ============================================================

    window.mountCharacters = mountCharacters;

    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;

    window._clearEditState = clearEditState;

})();
