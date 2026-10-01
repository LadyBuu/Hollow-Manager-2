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
 * HEADER CONTROLS:
 *   The character page header carries, in order:
 *
 *     #export-characters-csv-btn        CSV export
 *     #import-characters-csv-btn        CSV import (opens picker)
 *     #template-characters-csv-btn      CSV template
 *     #manage-fillers-btn               Filler manager
 *     #export-character-roster-btn      Roster text export
 *     #characters-csv-file-input        hidden file input
 *     #toggle-char-list                 mobile list toggle
 *     #add-character-btn                create a new character
 *
 *   The report-export button (#export-character-report-btn) is
 *   not in this header. It lives in the character form's actions
 *   row.
 *
 * FILTERS:
 *   The sidebar carries three hide-checkboxes:
 *
 *     #hide-deceased      Hide Deceased     (default checked)
 *     #hide-eliminated    Hide Eliminated   (default checked)
 *     #hide-filler        Hide Filler       (default checked,
 *                                              persisted)
 *
 *   The filler checkbox's state is persisted to sessionStorage by
 *   CharacterList. On mount, mountCharacters() syncs the checkbox
 *   with the persisted value BEFORE the first render, so the user
 *   does not see a flash of the wrong state.
 *
 * FILLER MANAGER:
 *   The Manage Fillers button opens the FillerManagerModal, a
 *   maintenance modal that lists every character and lets the
 *   user flag some as filler. The flag drives the strip on save;
 *   see character-strip.js and character-crud.js.
 *
 * ROSTER EXPORT:
 *   The Export Character Roster button produces a tab-separated
 *   plain-text file of every character's Name, Gender, Birth Year,
 *   and Eliminated marker. The export is not filtered by the
 *   character-list filters; it always includes the full store.
 *   See character-roster-export.js.
 *
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.CharacterAggregator (from character-aggregator.js) - MANDATORY
 *   - window.CharacterList (from character-list.js) - MANDATORY
 *   - window.CharacterForm (from character-form.js) - MANDATORY
 *   - window.CharacterEvents (from character-events.js) - MANDATORY
 *   - window.CharacterClassView (from character-class-view.js) - MANDATORY
 *   - window.CharacterViews (from character-views.js) - MANDATORY (for Social tab)
 *   - window.UI_CONSTANTS (from ui-constants.js) - MANDATORY (for MOBILE_BREAKPOINT)
 *   - window.DataLoader (from loader.js) - OPTIONAL (for compatibility)
 *   - window.FillerManagerModal (from filler-manager-modal.js) - LAZY
 *   - window.CharacterRosterExport (from character-roster-export.js) - LAZY
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
    // LAZY ACCESSORS
    // ============================================================

    function getUI_CONSTANTS() {
        return window.UI_CONSTANTS || null;
    }

    function getMobileBreakpoint() {
        var UI = getUI_CONSTANTS();
        if (UI && typeof UI.MOBILE_BREAKPOINT === 'number') {
            return UI.MOBILE_BREAKPOINT;
        }
        return 768;
    }

    function isMobileViewport() {
        return window.innerWidth < getMobileBreakpoint();
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

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

        // ---- Sync the filler checkbox with its persisted state ----
        //
        // The HTML default is `checked`, but the user may have
        // unchecked it in a previous session. CharacterList stores
        // the persisted value; we sync the checkbox to it before
        // the first render so the visible state matches reality.
        if (CharacterList &&
            typeof CharacterList.getHideFiller === 'function') {
            try {
                var hideFillerCb = document.getElementById('hide-filler');
                if (hideFillerCb) {
                    hideFillerCb.checked = CharacterList.getHideFiller();
                }
            } catch (e) {
                // Non-fatal. The HTML default (checked) is safe;
                // the user's next interaction corrects it.
            }
        }

        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn('[CharactersModule] CharacterList.render failed:', e);
            }
        }

        if (CharacterClassView && typeof CharacterClassView.populateClassFilter === 'function') {
            try {
                CharacterClassView.populateClassFilter();
            } catch (e) {
                console.warn('[CharactersModule] populateClassFilter failed:', e);
            }
        }

        if (CharacterEvents && typeof CharacterEvents.init === 'function') {
            try {
                CharacterEvents.init(container);
            } catch (e) {
                console.warn('[CharactersModule] CharacterEvents.init failed:', e);
            }
        }

        var editId = getCurrentEditId();
        if (editId && CharacterForm && typeof CharacterForm.render === 'function') {
            try {
                CharacterForm.render(editId);
            } catch (e) {
                console.warn('[CharactersModule] CharacterForm.render failed:', e);
            }
        }

        if (isMobileViewport()) {
            var listPanel = document.getElementById('char-list-panel');
            if (listPanel) {
                listPanel.classList.add('open');
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
        var careerStatusCollapsed = isMobileViewport();
        var careerStatusBodyDisplay = careerStatusCollapsed ? 'none' : 'grid';
        var careerStatusCaret = careerStatusCollapsed ? '\u25b8' : '\u25be';

        return `
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="export-characters-csv-btn"
                                    class="small secondary"
                                    title="Export Characters (CSV)"
                                    aria-label="Export Characters CSV">↓</button>
                            <button id="import-characters-csv-btn"
                                    class="small secondary"
                                    title="Import Characters (CSV)"
                                    aria-label="Import Characters CSV">↑</button>
                            <button id="template-characters-csv-btn"
                                    class="small secondary"
                                    title="Character CSV Template"
                                    aria-label="Character CSV Template">▤</button>
                            <button id="manage-fillers-btn"
                                    class="small secondary"
                                    title="Manage Filler Characters"
                                    aria-label="Manage Filler Characters">✦</button>
                            <button id="export-character-roster-btn"
                                    class="small secondary"
                                    title="Export Character Roster (Text)"
                                    aria-label="Export Character Roster Text">☰</button>
                            <input type="file"
                                   id="characters-csv-file-input"
                                   accept=".csv"
                                   style="display:none;">
                            <button id="toggle-char-list"
                                    class="secondary small"
                                    aria-label="Toggle character list">☰</button>
                            <button id="add-character-btn"
                                    class="primary small">+ Add</button>
                        </div>
                    </div>
                    <div class="characters-filters">
                        <input type="text" id="char-name-filter" placeholder="Filter by name..." />
                        <select id="char-class-filter">
                            <option value="all">All Classes</option>
                        </select>

                        <div id="career-status-filter-group"
                             class="status-filter-group"
                             data-collapsed="${careerStatusCollapsed ? 'true' : 'false'}"
                             style="margin-top:6px;">

                            <button type="button"
                                    id="career-status-filter-toggle"
                                    class="status-filter-header"
                                    aria-expanded="${careerStatusCollapsed ? 'false' : 'true'}"
                                    aria-controls="char-status-filter"
                                    style="display:flex;align-items:center;gap:6px;width:100%;background:transparent;border:none;padding:4px 0;cursor:pointer;font-size:0.6rem;color:var(--text-dim);font-weight:600;text-align:left;">
                                <span class="status-filter-caret"
                                      style="display:inline-block;width:10px;font-size:0.7rem;">${careerStatusCaret}</span>
                                <span>Career Status</span>
                            </button>

                            <div id="char-status-filter"
                                 class="status-filter-body"
                                 style="display:${careerStatusBodyDisplay};grid-template-columns:1fr 1fr;gap:2px 8px;">
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="civilian" />
                                    Civilian
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="trainee" />
                                    Trainee
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="rookie" />
                                    Rookie
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="junior" />
                                    Junior
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="senior" />
                                    Senior
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="instructor" />
                                    Instructor
                                </label>
                                <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                    <input type="checkbox" data-status="support" />
                                    Support
                                </label>
                            </div>
                        </div>

                        <div class="filter-checkboxes" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:4px 0;margin-top:4px;">
                            <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                <input type="checkbox" id="hide-deceased" checked />
                                Hide Deceased
                            </label>
                            <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                <input type="checkbox" id="hide-eliminated" checked />
                                Hide Eliminated
                            </label>
                            <label class="filter-check" style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:var(--text-dim);cursor:pointer;">
                                <input type="checkbox" id="hide-filler" checked />
                                Hide Filler
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
