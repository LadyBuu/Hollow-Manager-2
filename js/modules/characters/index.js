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
 * 
 * LIFECYCLE:
 *   TabManager registers 'characters' → mountCharacters() → 
 *   CharacterList.render() → CharacterForm.init() → CharacterEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for characters
 *   - All character logic lives in the sub-modules
 *   - This module does NOT implement character logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountCharacters() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 * 
 * STATE SOURCE OF TRUTH:
 *   - _currentEditId is the canonical edit state (PRIVATE)
 *   - Exposed via getCurrentEditId/setCurrentEditId (INTERNAL USE ONLY)
 *   - window.data is the source of truth for persisted application data
 * 
 * DEPENDENCIES:
 *   - window.CharacterList (from character-list.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterEvents (from character-events.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterClasses (from character-classes.js)
 *   - window.CharacterEliminations (from character-eliminations.js)
 *   - window.CharacterViews (from character-views.js)
 *   - window.CharacterStats (from character-stats.js)
 *   - window.CharacterDetail (from character-detail.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.MutationUtils (from mutation-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    // ============================================================
    // STATE - Single source of truth for character edit state
    // ============================================================
    
    // Private module-scoped variable - NOT exposed directly
    var _currentEditId = null;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'CharacterList',
            'CharacterForm',
            'CharacterEvents',
            'CharacterCRUD',
            'CharacterClasses',
            'CharacterEliminations',
            'CharacterViews',
            'CharacterStats',
            'CharacterDetail'
        ];

        required.forEach(function(name) {
            if (typeof window[name] === 'undefined' || window[name] === null) {
                missing.push(name);
            }
        });

        // Check for MutationUtils
        if (!window.MutationUtils || typeof window.MutationUtils.refreshUI !== 'function') {
            missing.push('MutationUtils.refreshUI');
        }

        // Check for DomUtils
        if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('CharactersModule: Missing dependencies:', missing.join(', '));
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
            console.warn('CharactersModule: Container not found');
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

        // Render the character container
        container.innerHTML = getCharactersHTML();

        // Initialize character list
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }

        // Initialize character form
        if (window.CharacterForm && typeof window.CharacterForm.init === 'function') {
            window.CharacterForm.init(container);
        }

        // Initialize character events
        if (window.CharacterEvents && typeof window.CharacterEvents.init === 'function') {
            window.CharacterEvents.init(container);
        }

        // Show the current character if any
        var editId = getCurrentEditId();
        if (editId && window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(editId);
        }
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
                        ${getCharacterFormHTML()}
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // CHARACTER FORM HTML - Delegates to sub-modules
    // ============================================================

    function getCharacterFormHTML() {
        // Build tabs HTML from sub-modules
        var tabsHTML = '';
        if (window.CharacterForm && typeof window.CharacterForm.getTabsHTML === 'function') {
            tabsHTML = window.CharacterForm.getTabsHTML();
        } else {
            tabsHTML = getFallbackTabsHTML();
        }

        return `
            <form id="character-form" style="display:none;">
                <div class="form-header">
                    <h3 id="form-title">New Character</h3>
                    <span id="current-char-name" class="char-name-display"></span>
                    <div class="form-actions">
                        <button type="button" id="delete-char-btn" class="danger small">Delete</button>
                        <button type="submit" id="save-char-btn" class="primary">Save</button>
                    </div>
                </div>
                
                <!-- Tabs rendered by CharacterForm -->
                ${tabsHTML}
            </form>
        `;
    }

    function getFallbackTabsHTML() {
        return `
            <div class="char-tabs">
                <button type="button" class="char-tab-btn active" data-tab="name">Name</button>
                <button type="button" class="char-tab-btn" data-tab="physical">Physical</button>
                <button type="button" class="char-tab-btn" data-tab="personality">Personality</button>
                <button type="button" class="char-tab-btn" data-tab="academic">Academic</button>
                <button type="button" class="char-tab-btn" data-tab="professional">Professional</button>
                <button type="button" class="char-tab-btn" data-tab="stats">Stats</button>
                <button type="button" class="char-tab-btn" data-tab="social">Social</button>
                <button type="button" class="char-tab-btn" data-tab="notes">Notes</button>
            </div>
            <div id="char-tab-name" class="char-tab-panel active">
                <p class="empty-state">Character form module not loaded.</p>
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

        if (window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(normalisedId);
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
        _currentEditId = null;
        if (window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(null);
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (window.TabManager && typeof window.TabManager.register === 'function') {
            window.TabManager.register('characters', mountCharacters);
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
    // EXPOSE - Controlled public API only
    // ============================================================

    // Main mount function
    window.mountCharacters = mountCharacters;

    // Legacy compatibility (deprecated, use mountCharacters)
    window.renderCharacters = mountCharacters;

    // State management (internal use only, but exposed for sub-modules)
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
