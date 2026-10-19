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
 *   - window.showCharacterForm (the single owner).
 *   - window.toggleCharacterList (delegates to CharacterEvents).
 *   - window._clearEditState (dispatches characterCleared).
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
 *     does NOT close it (see the MOBILE DRAWER note in
 *     character-events.js); the drawer closes when a character is
 *     selected, and re-opens when the toggle is tapped again.
 *
 *     On mount, the drawer is opened immediately so the user
 *     never sees an empty tab.
 *
 *   The toggle button is only visible on mobile.
 *
 * MOBILE BURGER ESCAPE:
 *   #toggle-char-list is a SIBLING of .characters-sidebar in the
 *   markup, not a child of it.
 *
 *   WHY IT MUST BE A SIBLING:
 *     On mobile, .characters-sidebar is translated off-screen via
 *     `transform: translateX(-100%)` until `.open` is added. A
 *     fixed-positioned descendant of a transformed ancestor does
 *     NOT escape that ancestor's clip: the transformed element
 *     becomes the containing block for its fixed descendants
 *     (CSS Transforms spec). So a burger rendered inside the
 *     sidebar would be dragged off-screen with it, and no amount
 *     of `position: fixed` on the burger itself would help.
 *
 *     The only reliable fix is to place the burger outside the
 *     transformed subtree. It lives as a direct child of
 *     .characters-layout, which has no transform, so its
 *     containing block is the viewport and `position: fixed`
 *     behaves as expected.
 *
 *   Positioning and visibility live entirely in
 *   css/characters.css.
 *
 * RELATIONSHIP MODAL SHELL REMOVED:
 *   The character tab used to carry its own relationship form
 *   modal, #character-relationship-modal, with a
 *   #character-relationship-form-container that CharacterViews
 *   filled in. Both were retired when the character-tab Social
 *   section was unified with the standalone Social tab's modal.
 *
 *   The single relationship modal now lives in SocialViews and is
 *   installed into document.body on first use by
 *   SocialEvents.ensureRelationshipModalShell. Opening the modal
 *   from the character tab goes through
 *   CharacterEvents.openRelationshipModal → SocialEvents.handleAddRelationship,
 *   which handles the shell install.
 *
 *   Do NOT reintroduce #character-relationship-modal.
 *
 * WINDOW.SHOWCHARACTERFORM IS OWNED HERE:
 *   Three files used to define window.showCharacterForm:
 *   character-form.js, character-events.js, and this file. Any
 *   definition other than this one either forgot to set the
 *   current-edit-id (character-form.js) or duplicated it
 *   (character-events.js).
 *
 *   This file's definition is the single owner. The other two
 *   definitions have been removed. A programmatic
 *   window.showCharacterForm(id) call now reliably sets the edit
 *   id and renders the form.
 *
 * WINDOW.TOGGLECHARACTERLIST DELEGATES:
 *   toggleCharacterList used to toggle .open on #char-list-panel,
 *   which is not the mobile drawer. The drawer's state lives on
 *   .characters-sidebar, managed by CharacterEvents. The public
 *   function now delegates to CharacterEvents' sidebar helpers
 *   so a caller reaching for window.toggleCharacterList sees the
 *   same behaviour the burger does.
 *
 * WINDOW._CLEAREDITSTATE DISPATCHES AN EVENT:
 *   clearEditState clears the current-edit-id and hides the form.
 *   It now also dispatches a `characterCleared` CustomEvent on
 *   document, so listeners that cache per-character state (the
 *   export picker, an unsaved-changes guard, etc.) get notified.
 *   No existing listener consumes it; the dispatch is additive
 *   and safe.
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

        // ---- Shell ----
        try {
            container.innerHTML = getCharactersHTML();
        } catch (e) {
            console.warn(
                '[CharactersModule] getCharactersHTML failed:', e
            );
            container.innerHTML =
                '<p class="empty-state">' +
                    'Failed to render the characters tab. ' +
                    'Please refresh the page.' +
                '</p>';
            return;
        }

        // Restore filter state from storage.
        restoreFilterState();

        // Populate the class filter (emits the __no_class__
        // sentinel).
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

        // On mobile, open the character list drawer immediately.
        // The drawer is the ONLY way to see the list on mobile,
        // and opening it on mount means the user never lands on
        // an empty form area with no visible way to pick a
        // character. The drawer closes when a character is
        // selected and re-opens when the burger is tapped; see
        // character-events.js's MOBILE DRAWER note for the full
        // contract.
        //
        // On desktop, openSidebar() is a no-op: the sidebar is
        // always visible in the two-column layout.
        if (isMobileViewport() &&
            CharacterEvents &&
            typeof CharacterEvents.openSidebar === 'function') {
            try {
                CharacterEvents.openSidebar();
            } catch (e) {
                console.warn(
                    '[CharactersModule] openSidebar failed:', e
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

        var btn = null;
        try {
            btn = container.querySelector('#research-btn');
        } catch (e) {
            console.warn(
                '[CharactersModule] Research button lookup threw:', e
            );
            return;
        }
        if (!btn) { return; }

        try {
            btn.addEventListener('click', function(e) {
                e.preventDefault();

                var Research = window.Research || null;
                if (!Research ||
                    typeof Research.open !== 'function') {
                    console.warn(
                        '[CharactersModule] Research module is ' +
                        'not loaded.'
                    );
                    return;
                }

                try {
                    Research.open();
                } catch (err) {
                    console.warn(
                        '[CharactersModule] Research.open threw:',
                        err
                    );
                }
            });
        } catch (e) {
            console.warn(
                '[CharactersModule] Research button bind threw:', e
            );
        }
    }

    function bindBulkAddButton(container) {
        if (!container) { return; }

        var btn = null;
        try {
            btn = container.querySelector('#bulk-add-btn');
        } catch (e) {
            console.warn(
                '[CharactersModule] Bulk Add button lookup threw:', e
            );
            return;
        }
        if (!btn) { return; }

        try {
            btn.addEventListener('click', function(e) {
                e.preventDefault();

                var Bulk = window.CharacterBulkCreate || null;
                if (!Bulk || typeof Bulk.open !== 'function') {
                    console.warn(
                        '[CharactersModule] CharacterBulkCreate ' +
                        'module is not loaded.'
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
        } catch (e) {
            console.warn(
                '[CharactersModule] Bulk Add button bind threw:', e
            );
        }
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
    //
    // The shell contains:
    //   - the two-column characters layout
    //   - the mobile burger (a sibling of .characters-sidebar,
    //     see the MOBILE BURGER ESCAPE note in the file header)
    //   - the sidebar (header buttons, filters, list)
    //   - the form container
    //
    // The shell does NOT contain a relationship modal. That modal
    // is installed into document.body by SocialEvents on first use.

    function getCharactersHTML() {
        var careerStatusCollapsed = isMobileViewport();
        var careerStatusBodyDisplay =
            careerStatusCollapsed ? 'none' : 'grid';
        var careerStatusCaret =
            careerStatusCollapsed ? '\u25b8' : '\u25be';

        return `
            <div class="characters-layout">
                <button id="toggle-char-list"
                        class="secondary small"
                        title="Toggle character list"
                        aria-label="Toggle character list">\u2630</button>
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
        // Coerce to a string. A number (42) becomes '42'; an
        // object becomes '[object Object]', which is a caller bug
        // not a defensive case worth handling.
        _currentEditId = String(id);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Show the character form for a character.
     *
     * This is the single owner of window.showCharacterForm.
     * Sets the current-edit-id first, then renders. A programmatic
     * call therefore has the same effect a click on a character
     * row does.
     */
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

    /**
     * Toggle the character list drawer.
     *
     * Delegates to CharacterEvents' sidebar helpers. The drawer's
     * open state is a class on .characters-sidebar, managed by
     * those helpers. This function used to toggle `.open` on
     * #char-list-panel, which had no effect on mobile.
     *
     * forceState: true opens, false closes, undefined toggles.
     */
    function toggleCharacterList(forceState) {
        if (!CharacterEvents) { return; }

        if (forceState === true &&
            typeof CharacterEvents.openSidebar === 'function') {
            try { CharacterEvents.openSidebar(); } catch (e) {}
            return;
        }
        if (forceState === false &&
            typeof CharacterEvents.closeSidebar === 'function') {
            try { CharacterEvents.closeSidebar(); } catch (e) {}
            return;
        }
        if (typeof CharacterEvents.toggleSidebar === 'function') {
            try { CharacterEvents.toggleSidebar(); } catch (e) {}
        }
    }

    /**
     * Clear the current-edit-id and hide the form.
     *
     * Dispatches a `characterCleared` CustomEvent on document so
     * listeners that cache per-character state get notified. No
     * existing listener consumes it; the dispatch is additive.
     */
    function clearEditState() {
        setCurrentEditId(null);
        if (CharacterForm &&
            typeof CharacterForm.hide === 'function') {
            CharacterForm.hide();
        }

        try {
            var event = new CustomEvent('characterCleared', {
                detail: { timestamp: Date.now() },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors.
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
