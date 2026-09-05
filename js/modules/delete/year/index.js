/**
 * js/modules/year/index.js - Year Module Entry Point
 * Single entry point for all academic year functionality
 * Path: js/modules/year/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the year container
 *   - Managing year lifecycle
 *   - Orchestrating sub-modules
 * 
 * LIFECYCLE:
 *   TabManager registers 'year' -> mountYear() ->
 *   YearTabs.init() -> render character list, detail, etc.
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for year
 *   - All year logic lives in the sub-modules
 *   - TabManager is the single source of truth for lifecycle
 *   - Uses CharacterList for character selection
 * 
 * DEPENDENCIES:
 *   - window.YearTabs (from tabs/year-tabs.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.CharacterList (from character-list.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__yearModuleLoaded) {
        return;
    }
    window.__yearModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var YearTabs = window.YearTabs;
    var TabManager = window.TabManager;
    var CharacterList = window.CharacterList;

    // ============================================================
    // STATE - Single source of truth for year selection
    // ============================================================

    var _selectedCharacterId = null;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!YearTabs || typeof YearTabs.init !== 'function') {
            missing.push('YearTabs.init');
        }

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (missing.length > 0) {
            console.warn('YearModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountYear(container) {
        if (!container) {
            container = document.getElementById('tab-year');
        }

        if (!container) {
            console.warn('YearModule: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading year data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Year dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum is initialised (for disciplines and locations)
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                console.warn('YearModule: ensureCurriculum() failed:', e);
            }
        }

        // Render the year container with tabs
        container.innerHTML = getYearHTML();

        // Initialize tabs
        YearTabs.init(container);

        // Render character list (reuse CharacterList)
        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn('YearModule: CharacterList.render failed:', e);
            }
        }

        // Show detail for selected character
        if (_selectedCharacterId && window.YearDetail && typeof window.YearDetail.show === 'function') {
            try {
                window.YearDetail.show(_selectedCharacterId);
            } catch (e) {
                console.warn('YearModule: YearDetail.show failed:', e);
            }
        }

        // Initialize events
        if (window.YearEvents && typeof window.YearEvents.init === 'function') {
            try {
                window.YearEvents.init(container);
            } catch (e) {
                console.warn('YearModule: YearEvents.init failed:', e);
            }
        }
    }

    // ============================================================
    // YEAR HTML
    // ============================================================

    function getYearHTML() {
        return [
            '<div class="year-layout">',
                '<div class="year-sidebar">',
                    '<div class="year-header">',
                        '<h2>Academic Year</h2>',
                        '<div class="year-header-actions">',
                            '<button id="year-refresh-btn" class="small secondary">↻ Refresh</button>',
                        '</div>',
                    '</div>',
                    '<!-- Reuse character list filters -->',
                    '<div class="characters-filters">',
                        '<input type="text" id="char-name-filter" placeholder="Filter by name...">',
                        '<select id="char-class-filter">',
                            '<option value="all">All Classes</option>',
                        '</select>',
                        '<div class="filter-checkboxes">',
                            '<label class="filter-check">',
                                '<input type="checkbox" id="hide-deceased" checked>',
                                'Hide Deceased',
                            '</label>',
                            '<label class="filter-check">',
                                '<input type="checkbox" id="hide-eliminated" checked>',
                                'Hide Eliminated',
                            '</label>',
                            '<button id="clear-char-filter" class="small secondary">Clear</button>',
                        '</div>',
                    '</div>',
                    '<div id="char-list-panel">',
                        '<div id="characters-container"></div>',
                    '</div>',
                '</div>',
                '<div class="year-detail">',
                    '<div id="year-detail-container">',
                        '<p class="empty-state">Select a character to view academic details.</p>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function getSelectedCharacter() {
        return _selectedCharacterId;
    }

    function selectCharacter(id) {
        if (id === undefined || id === null || id === '') {
            _selectedCharacterId = null;
            if (window.YearDetail && typeof window.YearDetail.show === 'function') {
                window.YearDetail.show(null);
            }
            return;
        }

        _selectedCharacterId = String(id);

        if (window.YearDetail && typeof window.YearDetail.show === 'function') {
            window.YearDetail.show(_selectedCharacterId);
        }
    }

    function clearSelection() {
        _selectedCharacterId = null;
        if (window.YearDetail && typeof window.YearDetail.show === 'function') {
            window.YearDetail.show(null);
        }
    }

    function refreshYear() {
        var container = document.getElementById('tab-year');
        if (container) {
            mountYear(container);
        }
    }

    // ============================================================
    // DESTROY
    // ============================================================

    function destroyYear() {
        if (window.YearEvents && typeof window.YearEvents.destroy === 'function') {
            window.YearEvents.destroy();
        }
        _selectedCharacterId = null;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('year', mountYear);
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
    // EXPOSE
    // ============================================================

    window.mountYear = mountYear;
    window.renderYear = mountYear;
    window.getSelectedYearCharacter = getSelectedCharacter;
    window.selectYearCharacter = selectCharacter;
    window.clearYearSelection = clearSelection;
    window.refreshYear = refreshYear;
    window.destroyYear = destroyYear;

})();