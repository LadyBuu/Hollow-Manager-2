/**
 * modules/characters/index.js - Characters Module Entry Point
 * Single entry point for all character functionality.
 *
 * Path: js/modules/characters/index.js
 *
 * WHAT THIS OWNS:
 *   - TabManager registration.
 *   - Mount / unmount lifecycle for the characters tab.
 *   - The tab's outer HTML shell: sidebar, filter bar, form
 *     container, and the two modal shells the tab uses.
 *   - Current-edit-id state. Exposed as window.getCurrentEditId
 *     and window.setCurrentEditId, which CharacterList and
 *     CharacterEvents consume.
 *   - The character list toggle (mobile sidebar).
 *   - The Research button. Opens window.Research (the profile
 *     search modal).
 *   - The Bulk Add button. Opens window.CharacterBulkCreate
 *     (the bulk character creation modal).
 *
 * WHAT THIS DOES NOT OWN:
 *   - Any domain logic. All character reads go through
 *     CharacterQueries / CharacterAggregator; all writes go
 *     through CharacterCRUD.
 *   - Rendering of the list or the form. CharacterList and
 *     CharacterForm own those.
 *   - Event binding. CharacterEvents owns it.
 *   - The research feature. ResearchQueries / ResearchView /
 *     ResearchEvents own it.
 *   - The bulk-create feature. CharacterBulkCreate owns it.
 *
 * FILTER BAR:
 *   The filter bar carries:
 *     #char-name-filter
 *     #char-class-filter
 *     #char-sort              (options: name-asc, name-desc,
 *                              age-asc, age-desc)
 *     #char-status-filter     (checkbox group, collapsible)
 *     #hide-deceased
 *     #hide-eliminated
 *     #hide-filler
 *     #clear-char-filter
 *     #research-btn           (opens the research modal)
 *     #bulk-add-btn           (opens the bulk-create modal)
 *
 *   The sort select's persisted value is restored at mount from
 *   CharacterList.getSort(). When the character list is not yet
 *   loaded, the select defaults to 'name-asc'.
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

        if (isMobileViewport()) {
            var listPanel =
                document.getElementById('char-list-panel');
            if (listPanel) { listPanel.classList.add('open'); }
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

    /**
     * Restore the two persistence-backed controls from storage
     * before the first render. Reads through CharacterList so the
     * storage keys and validation live in one place.
     */
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
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="import-characters-csv-btn"
                                    class="small secondary"
                                    title="Import Characters from CSV"
                                    aria-label="Import Characters CSV">Import</button>
                            <input type="file"
                                   id="characters-csv-file-input"
                                   accept=".csv"
                                   style="display:none;">
                            <button id="export-characters-btn"
                                    class="small secondary"
                                    title="Export Characters"
                                    aria-label="Export Characters">Export</button>
                            <button id="manage-fillers-btn"
                                    class="small secondary"
                                    title="Manage Filler Characters"
                                    aria-label="Manage Filler Characters">Fillers</button>
                            <button id="research-btn"
                                    class="small secondary"
                                    title="Search character profiles"
                                    aria-label="Search character profiles">Research</button>
                            <button id="bulk-add-btn"
                                    class="small secondary"
                                    title="Bulk create characters"
                                    aria-label="Bulk create characters">Bulk Add</button>
                            <button id="toggle-char-list"
                                    class="secondary small"
                                    aria-label="Toggle character list">\u2630</button>
                            <button id="add-character-btn"
                                    class="primary small">+ Add</button>
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
