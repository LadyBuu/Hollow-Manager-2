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

    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    var TabManager = window.TabManager;
    var CharacterList = window.CharacterList;
    var CharacterForm = window.CharacterForm;
    var CharacterEvents = window.CharacterEvents;
    var DataLoader = window.DataLoader;
    var CharacterClassView = window.CharacterClassView;

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
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

        if (missing.length > 0) {
            throw new Error('CharactersModule: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    var _currentEditId = null;
    var _initialized = false;
    var _mounted = false;

    function mountCharacters(container) {
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

        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
            }
        }

        if (CharacterClassView && typeof CharacterClassView.populateClassFilter === 'function') {
            try {
                CharacterClassView.populateClassFilter();
            } catch (e) {
            }
        }

        if (CharacterEvents && typeof CharacterEvents.init === 'function') {
            try {
                CharacterEvents.init(container);
            } catch (e) {
            }
        }

        var editId = getCurrentEditId();
        if (editId && CharacterForm && typeof CharacterForm.render === 'function') {
            try {
                CharacterForm.render(editId);
            } catch (e) {
            }
        }

        _mounted = true;
        _initialized = true;

        dispatchReady();
    }

    function unmountCharacters() {
        if (!_mounted) return;

        if (CharacterEvents && typeof CharacterEvents.destroy === 'function') {
            try {
                CharacterEvents.destroy();
            } catch (e) {
            }
        }

        _mounted = false;
        _initialized = false;
    }

    function getCharactersHTML() {
        return `
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="toggle-char-list" class="secondary small" aria-label="Toggle character list">\u2630</button>
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

    function showCharacterForm(id) {
        var normalisedId = (id !== undefined && id !== null && id !== '') ? String(id) : null;
        setCurrentEditId(normalisedId);

        if (CharacterForm && typeof CharacterForm.render === 'function') {
            CharacterForm.render(normalisedId);
        }
    }

    function toggleCharacterList(forceState) {
        var panel = document.getElementById('char-list-panel');
        if (!panel) return;

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
        }
    }

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

    window.mountCharacters = mountCharacters;

    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;

    window._clearEditState = clearEditState;

})();