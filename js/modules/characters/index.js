/**
 * modules/characters/index.js - Characters Module Entry Point
 * Single entry point for all character functionality.
 *
 * Path: js/modules/characters/index.js
 *
 * WHAT THIS OWNS:
 *   - TabManager registration.
 *   - Mount / unmount lifecycle for the characters tab.
 *   - The tab's outer HTML shell: the sidebar (buttons, filters,
 *     list) and the form container.
 *   - Current-edit-id state. Exposed as window.getCurrentEditId
 *     and window.setCurrentEditId, which CharacterList and
 *     CharacterEvents consume.
 *   - The character list toggle (mobile drawer).
 *   - The Research button. Opens window.Research.
 *   - The Bulk Add button. Opens window.CharacterBulkCreate.
 *
 * LAYOUT:
 *   Desktop (>=769px):
 *     Two columns. Sidebar on the left (300px) holding the
 *     header buttons, the filters, and the character list. The
 *     form container fills the remaining space. Everything is
 *     always visible; the toggle button is hidden.
 *
 *   Mobile (<=768px):
 *     The form container fills the tab. The sidebar is hidden and
 *     appears as an overlay drawer when the toggle button
 *     (#toggle-char-list) is tapped. Tapping outside the drawer
 *     or selecting a character closes it.
 *
 *   The toggle button is only visible on mobile.
 *
 * MOBILE BURGER ESCAPE (this revision):
 *   The toggle button lives inside .characters-sidebar in the
 *   static markup. On mobile that sidebar is `transform:
 *   translateX(-100%)` until `.open` is added, which means the
 *   button that would add `.open` is off-screen with the rest of
 *   the drawer — the classic burger-inside-the-drawer trap.
 *
 *   The tab template emits a small scoped <style> block that pins
 *   #toggle-char-list to `position: fixed` at top-left on mobile.
 *   Fixed positioning removes the element from its parent's
 *   stacking context and escapes the transform clip, so the
 *   button stays clickable while the drawer is closed. The same
 *   <style> block also guarantees the sidebar behaves as a
 *   drawer and the form container fills the tab on mobile. Those
 *   rules mirror the canonical responsive layout defined in
 *   css/characters.css; when the stylesheet loads normally they
 *   are redundant, and when it is absent or overridden they keep
 *   the tab usable.
 *
 *   No CSS file edit is required for the mobile fix.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Any domain logic. All character reads go through
 *     CharacterQueries / CharacterAggregator; all writes go
 *     through CharacterCRUD.
 *   - Rendering of the list or the form. CharacterList and
 *     CharacterForm own those.
 *   - Event binding. CharacterEvents owns it, including the
 *     Export button click.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TabManager
 *   - window.CharacterAggregator
 *   - window.CharacterList
 *   - window.CharacterForm
 *   - window.CharacterEvents
 *   - window.CharacterClassView
 *
 * DEPENDENCIES (OPTIONAL, resolved at call time):
 *   - window.DataLoader
 *   - window.CharacterViews
 *   - window.Research
 *   - window.CharacterBulkCreate
 *   - window.UI_CONSTANTS
 */

(function() {
    'use strict';

    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterAggregator = window.CharacterAggregator;
    var CharacterList = window.CharacterList;
    var CharacterForm = window.CharacterForm;
    var CharacterEvents = window.CharacterEvents;
    var DataLoader = window.DataLoader;
    var CharacterClassView = window.CharacterClassView;
    var CharacterViews = window.CharacterViews;

    function getUI_CONSTANTS() { return window.UI_CONSTANTS || null; }

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
        if (!CharacterAggregator ||
            typeof CharacterAggregator.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }
        if (!CharacterAggregator ||
            typeof CharacterAggregator.getCharacterListViewModel !==
            'function') {
            missing.push('CharacterAggregator.getCharacterListViewModel');
        }
        if (!CharacterList ||
            typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }
        if (!CharacterForm ||
            typeof CharacterForm.render !== 'function') {
            missing.push('CharacterForm.render');
        }
        if (!CharacterForm ||
            typeof CharacterForm.collect !== 'function') {
            missing.push('CharacterForm.collect');
        }
        if (!CharacterEvents ||
            typeof CharacterEvents.init !== 'function') {
            missing.push('CharacterEvents.init');
        }
        if (!CharacterEvents ||
            typeof CharacterEvents.destroy !== 'function') {
            missing.push('CharacterEvents.destroy');
        }
        if (!CharacterClassView ||
            typeof CharacterClassView.populateClassFilter !==
            'function') {
            missing.push('CharacterClassView.populateClassFilter');
        }

        if (!CharacterViews ||
            typeof CharacterViews.renderCharacterSocial !== 'function') {
            console.warn(
                '[CharactersModule] CharacterViews not loaded — ' +
                'Social tab will be empty.'
            );
        }

        if (!window.Research ||
            typeof window.Research.open !== 'function') {
            console.warn(
                '[CharactersModule] Research module not loaded — ' +
                'Research button will be inactive.'
            );
        }

        if (!window.CharacterBulkCreate ||
            typeof window.CharacterBulkCreate.open !== 'function') {
            console.warn(
                '[CharactersModule] CharacterBulkCreate module not ' +
                'loaded — Bulk Add button will be inactive.'
            );
        }

        if (missing.length > 0) {
            console.warn(
                '[CharactersModule] Missing dependencies:',
                missing.join(', ')
            );
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
            console.warn(
                '[CharactersModule] Dependencies not met, ' +
                'skipping mount'
            );
            return;
        }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) { return; }

        if (!window.data) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Loading character data...' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountCharacters();
        }

        container.innerHTML = getCharactersHTML();

        // Restore filter state from storage.
        restoreFilterState();

        // Populate the class filter (emits the __no_class__ sentinel).
        if (CharacterClassView &&
            typeof CharacterClassView.populateClassFilter ===
            'function') {
            try {
                CharacterClassView.populateClassFilter();
            } catch (e) {
                console.warn(
                    '[CharactersModule] populateClassFilter ' +
                    'failed:', e
                );
            }
        }

        // First render.
        if (CharacterList &&
            typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn(
                    '[CharactersModule] CharacterList.render ' +
                    'failed:', e
                );
            }
        }

        // Event wiring.
        if (CharacterEvents &&
            typeof CharacterEvents.init === 'function') {
            try {
                CharacterEvents.init(container);
            } catch (e) {
                console.warn(
                    '[CharactersModule] CharacterEvents.init ' +
                    'failed:', e
                );
            }
        }

        // Research button: opens the research modal.
        bindResearchButton(container);

        // Bulk Add button: opens the bulk-create modal.
        bindBulkAddButton(container);

        // Re-render the form if an edit id is already set.
        var editId = getCurrentEditId();
        if (editId &&
            CharacterForm &&
            typeof CharacterForm.render === 'function') {
            try {
                CharacterForm.render(editId);
            } catch (e) {
                console.warn(
                    '[CharactersModule] CharacterForm.render ' +
                    'failed:', e
                );
            }
        }

        // NOTE: the character list drawer is NOT opened at mount.
        // It opens when the user taps the toggle button, and
        // closes when they tap outside it or select a character.

        _mounted = true;
        _initialized = true;

        dispatchReady();
    }

    function unmountCharacters() {
        if (!_mounted) { return; }

        if (CharacterEvents &&
            typeof CharacterEvents.destroy === 'function') {
            try { CharacterEvents.destroy(); } catch (e) {}
        }

        _mounted = false;
        _initialized = false;
    }

    // ============================================================
    // HEADER BUTTON HANDLERS
    // ============================================================

    function bindResearchButton(container) {
        if (!container) { return; }

        var btn = container.querySelector('#research-btn');
        if (!btn) { return; }

        btn.addEventListener('click', function(e) {
            e.preventDefault();

            var Research = window.Research || null;
            if (!Research ||
                typeof Research.open !== 'function') {
                console.warn(
                    '[CharactersModule] Research module is not ' +
                    'loaded.'
                );
                return;
            }

            try {
                Research.open();
            } catch (err) {
                console.warn(
                    '[CharactersModule] Research.open threw:', err
                );
            }
        });
    }

    function bindBulkAddButton(container) {
        if (!container) { return; }

        var btn = container.querySelector('#bulk-add-btn');
        if (!btn) { return; }

        btn.addEventListener('click', function(e) {
            e.preventDefault();

            var Bulk = window.CharacterBulkCreate || null;
            if (!Bulk || typeof Bulk.open !== 'function') {
                console.warn(
                    '[CharactersModule] CharacterBulkCreate module ' +
                    'is not loaded.'
                );
                return;
            }

            try {
                Bulk.open();
            } catch (err) {
                console.warn(
                    '[CharactersModule] CharacterBulkCreate.open ' +
                    'threw:', err
                );
            }
        });
    }

    // ============================================================
    // FILTER STATE RESTORE
    // ============================================================

    function restoreFilterState() {
        if (!CharacterList) { return; }

        // Hide filler checkbox.
        if (typeof CharacterList.getHideFiller === 'function') {
            try {
                var hideFillerCb =
                    document.getElementById('hide-filler');
                if (hideFillerCb) {
                    hideFillerCb.checked =
                        CharacterList.getHideFiller();
                }
            } catch (e) {
                // Non-fatal.
            }
        }

        // Sort select.
        if (typeof CharacterList.getSort === 'function') {
            try {
                var sortEl =
                    document.getElementById('char-sort');
                if (sortEl) {
                    sortEl.value = CharacterList.getSort();
                }
            } catch (e) {
                // Non-fatal.
            }
        }
    }

    // ============================================================
    // HTML SHELL
    // ============================================================

    function getCharactersHTML() {
        var careerStatusCollapsed = isMobileViewport();
        var careerStatusBodyDisplay =
            careerStatusCollapsed ? 'none' : 'grid';
        var careerStatusCaret =
            careerStatusCollapsed ? '\u25b8' : '\u25be';

        return `
            <style>
                /* Defensive mobile rules for the Characters tab.

                   The external stylesheet (css/characters.css)
                   owns the canonical responsive layout. These
                   rules exist for two reasons:

                   1. THE BURGER TRAP. #toggle-char-list lives
                      inside .characters-sidebar in the markup.
                      On mobile the sidebar is transform:
                      translateX(-100%) until .open is added —
                      which means the button that adds .open is
                      off-screen with the rest of the drawer.
                      Pinning the button to position: fixed
                      takes it out of the sidebar's stacking
                      context and out of the transform clip, so
                      it stays clickable while the drawer is
                      closed. This is the whole mobile fix.

                   2. A fallback shell. The .characters-layout
                      block and drawer rules below mirror what
                      css/characters.css already does. When the
                      stylesheet loads normally they are
                      redundant; when it is absent or overridden
                      they keep the tab usable.

                   The matching @media (min-width: 769px) rule
                   in css/characters.css hides the button on
                   desktop, so no extra hide rule is needed here. */

                @media (max-width: 768px) {
                    #toggle-char-list {
                        position: fixed;
                        top: 8px;
                        left: 8px;
                        z-index: 200;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 34px;
                        height: 34px;
                        padding: 0;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                    }

                    .characters-layout {
                        display: block;
                    }

                    .characters-form-container {
                        display: block;
                        width: 100%;
                        min-width: 0;
                    }

                    .characters-sidebar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        bottom: 0;
                        width: min(340px, 88vw);
                        z-index: 150;
                        transform: translateX(-100%);
                        transition: transform 0.22s ease;
                    }

                    .characters-sidebar.open {
                        transform: translateX(0);
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    .characters-sidebar {
                        transition: none;
                    }
                }
            </style>
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="import-characters-csv-btn"
                                    class="small secondary"
                                    title="Import characters from CSV"
                                    aria-label="Import characters from CSV">\u2191</button>
                            <input type="file"
                                   id="characters-csv-file-input"
                                   accept=".csv"
                                   style="display:none;">
                            <button id="export-characters-btn"
                                    class="small secondary"
                                    title="Export characters"
                                    aria-label="Export characters">\u2193</button>
                            <button id="manage-fillers-btn"
                                    class="small secondary"
                                    title="Manage filler characters"
                                    aria-label="Manage filler characters">\u2691</button>
                            <button id="research-btn"
                                    class="small secondary"
                                    title="Search character profiles"
                                    aria-label="Search character profiles">\u2315</button>
                            <button id="bulk-add-btn"
                                    class="small secondary"
                                    title="Bulk create characters"
                                    aria-label="Bulk create characters">\u2726</button>
                            <button id="toggle-char-list"
                                    class="secondary small"
                                    title="Toggle character list"
                                    aria-label="Toggle character list">\u2630</button>
                            <button id="add-character-btn"
                                    class="primary small"
                                    title="Add character"
                                    aria-label="Add character">+</button>
                        </div>
                    </div>
                    <div class="characters-filters">
                        <input type="text" id="char-name-filter" placeholder="Filter by name..." />
                        <select id="char-class-filter">
                            <option value="all">All Classes</option>
                        </select>

                        <select id="char-sort">
                            <option value="name-asc">Name (A\u2013Z)</option>
                            <option value="name-desc">Name (Z\u2013A)</option>
                            <option value="age-asc">Age (youngest)</option>
                            <option value="age-desc">Age (oldest)</option>
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
        var normalisedId = (id !== undefined &&
            id !== null &&
            id !== '')
            ? String(id)
            : null;
        setCurrentEditId(normalisedId);

        if (CharacterForm &&
            typeof CharacterForm.render === 'function') {
            CharacterForm.render(normalisedId);
        }
    }

    function toggleCharacterList(forceState) {
        var panel = document.getElementById('char-list-panel');
        if (!panel) { return; }

        if (forceState !== undefined) {
            panel.classList.toggle('open', forceState);
        } else {
            panel.classList.toggle('open');
        }
    }

    function clearEditState() {
        setCurrentEditId(null);
        if (CharacterForm &&
            typeof CharacterForm.hide === 'function') {
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
            // Ignore event dispatch errors.
        }
    }

    // ============================================================
    // TABMANAGER REGISTRATION
    // ============================================================

    function registerWithTabManager() {
        if (TabManager &&
            typeof TabManager.register === 'function') {
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

    if (DataLoader &&
        typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data && !_mounted) {
                if (TabManager &&
                    TabManager.getCurrentTab() === 'characters') {
                    var container =
                        document.getElementById('tab-characters');
                    if (container) {
                        mountCharacters(container);
                    }
                }
            }
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.mountCharacters = mountCharacters;

    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;

    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;

    window._clearEditState = clearEditState;

})();
