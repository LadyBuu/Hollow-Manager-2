/**
 * js/modules/academia/index.js - Academia Module Entry Point
 * Single entry point for all academia functionality
 * Path: js/modules/academia/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the academia container
 *   - Managing academia lifecycle
 *   - Selecting characters for academic view
 *   - Orchestrating sub-modules
 * 
 * LIFECYCLE:
 *   TabManager registers 'academia' -> mountAcademia() ->
 *   CharacterList.render() -> AcademiaDetail.show() -> AcademiaEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for academia
 *   - All academia logic lives in the sub-modules
 *   - This module does NOT implement academia logic directly
 *   - It delegates to sub-modules for all operations
 *   - TabManager is the single source of truth for lifecycle
 *   - Reuses CharacterList for character selection
 * 
 * STATE SOURCE OF TRUTH:
 *   - _selectedCharacterId is the canonical selection state (PRIVATE)
 *   - Exposed via getSelectedAcademiaCharacter / selectAcademiaCharacter
 *   - window.data is the source of truth for persisted application data
 * 
 * DEPENDENCIES:
 *   - window.CharacterList (from character-list.js)
 *   - window.AcademiaDetail (from academia-detail.js)
 *   - window.AcademiaEvents (from academia-events.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academiaModuleLoaded) {
        return;
    }
    window.__academiaModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterList = window.CharacterList;
    var AcademiaDetail = window.AcademiaDetail;
    var AcademiaEvents = window.AcademiaEvents;
    var TabManager = window.TabManager;
    var DomUtils = window.DomUtils;

    // ============================================================
    // STATE - Single source of truth for academia selection
    // ============================================================

    var _selectedCharacterId = null;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (!AcademiaDetail || typeof AcademiaDetail.show !== 'function') {
            missing.push('AcademiaDetail.show');
        }

        if (!AcademiaEvents || typeof AcademiaEvents.init !== 'function') {
            missing.push('AcademiaEvents.init');
        }

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('AcademiaModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountAcademia(container) {
        if (!container) {
            container = document.getElementById('tab-academia');
        }

        if (!container) {
            console.warn('AcademiaModule: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academia data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academia dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum is initialised
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                console.warn('AcademiaModule: ensureCurriculum() failed:', e);
            }
        }

        // Render the academia container
        container.innerHTML = getAcademiaHTML();

        // Render character list (reuse CharacterList)
        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                console.warn('AcademiaModule: CharacterList.render failed:', e);
            }
        }

        // Show detail for selected character
        if (_selectedCharacterId && AcademiaDetail && typeof AcademiaDetail.show === 'function') {
            try {
                AcademiaDetail.show(_selectedCharacterId);
            } catch (e) {
                console.warn('AcademiaModule: AcademiaDetail.show failed:', e);
            }
        }

        // Initialize events
        if (AcademiaEvents && typeof AcademiaEvents.init === 'function') {
            try {
                AcademiaEvents.init(container);
            } catch (e) {
                console.warn('AcademiaModule: AcademiaEvents.init failed:', e);
            }
        }
    }

    // ============================================================
    // ACADEMIA HTML
    // ============================================================

    function getAcademiaHTML() {
        return [
            '<div class="academia-layout">',
                '<div class="academia-sidebar">',
                    '<div class="academia-header">',
                        '<h2>Academia</h2>',
                        '<div class="academia-header-actions">',
                            '<button id="academia-refresh-btn" class="small secondary">↻ Refresh</button>',
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
                    '<!-- Reuse character list container -->',
                    '<div id="char-list-panel">',
                        '<div id="characters-container"></div>',
                    '</div>',
                '</div>',
                '<div class="academia-detail">',
                    '<div id="academia-detail-container">',
                        '<p class="empty-state">Select a character to view academic details.</p>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // STATE MANAGEMENT - Private, exposed via controlled API
    // ============================================================

    /**
     * Get the currently selected character ID.
     * @returns {string|null} Selected character ID or null
     */
    function getSelectedAcademiaCharacter() {
        return _selectedCharacterId;
    }

    /**
     * Select a character for academic view.
     * @param {string} id - Character ID
     */
    function selectAcademiaCharacter(id) {
        // Normalise: null, undefined, empty string all become null
        if (id === undefined || id === null || id === '') {
            _selectedCharacterId = null;
            if (AcademiaDetail && typeof AcademiaDetail.show === 'function') {
                AcademiaDetail.show(null);
            }
            return;
        }

        _selectedCharacterId = String(id);

        if (AcademiaDetail && typeof AcademiaDetail.show === 'function') {
            AcademiaDetail.show(_selectedCharacterId);
        }
    }

    /**
     * Clear the current selection.
     */
    function clearAcademiaSelection() {
        _selectedCharacterId = null;
        if (AcademiaDetail && typeof AcademiaDetail.show === 'function') {
            AcademiaDetail.show(null);
        }
    }

    /**
     * Refresh the academia view.
     */
    function refreshAcademia() {
        var container = document.getElementById('tab-academia');
        if (container) {
            mountAcademia(container);
        }
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
    // ============================================================

    /**
     * Destroy the academia module (clean up event listeners).
     */
    function destroyAcademia() {
        if (AcademiaEvents && typeof AcademiaEvents.destroy === 'function') {
            AcademiaEvents.destroy();
        }
        _selectedCharacterId = null;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('academia', mountAcademia);
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
    window.mountAcademia = mountAcademia;

    // Legacy compatibility (deprecated, use mountAcademia)
    window.renderAcademia = mountAcademia;

    // State management
    window.getSelectedAcademiaCharacter = getSelectedAcademiaCharacter;
    window.selectAcademiaCharacter = selectAcademiaCharacter;
    window.clearAcademiaSelection = clearAcademiaSelection;
    window.refreshAcademia = refreshAcademia;

    // Lifecycle
    window.destroyAcademia = destroyAcademia;

    // ============================================================
    // LIFECYCLE EVENTS - TabManager is the single source of truth
    // ============================================================
    // NOTE: TabManager is now the single source of truth for lifecycle.
    // The dataReady and tabChanged listeners have been removed.
    // Data readiness is handled by TabManager before calling mountAcademia.

})();
