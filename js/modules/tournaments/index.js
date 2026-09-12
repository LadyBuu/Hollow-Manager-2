/**
 * modules/tournaments/index.js - Tournament Module Entry Point
 * Single entry point for all tournament functionality
 * Path: js/modules/tournaments/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the tournament container
 *   - Initializing all tournament sub-modules
 *   - Managing tournament feature lifecycle
 *   - Injecting dependencies (providers)
 *   - Exposing public API
 * 
 * LIFECYCLE:
 *   TabManager.register('tournaments') -> mountTournaments() ->
 *   TournamentsUI.init() -> TournamentEvents.setRenderFn(renderFn) ->
 *   TournamentEvents.init(container) -> renderTournamentContainer()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for tournaments
 *   - All tournament logic lives in the sub-modules
 *   - This module does NOT implement tournament logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountTournaments() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - Providers are assembled here and injected into TournamentCore
 *     (currently no injection is needed; providers exist for future use)
 * 
 * NAMING CONVENTION:
 *   - The UI, Render, and Matches modules expose themselves as
 *     Tournaments* (plural) on the window object:
 *       window.TournamentsUI
 *       window.TournamentsRender
 *       window.TournamentMatches
 *   - TournamentCore, TournamentEvents, TournamentAggregator,
 *     TournamentQueries use the singular prefix.
 * 
 * UI STATE MODEL:
 *   - activeTab:  'list' | 'detail'   — which panel is showing
 *   - viewMode:   'list' | 'grid'     — how the list panel is laid out
 *   - The two are orthogonal. Detail is reached by selecting a
 *     tournament, not by toggling a view mode.
 *   - If activeTab === 'detail' but no tournament is selected, the
 *     render function recovers by resetting to the list panel.
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.TournamentsUI (from tournaments-ui.js) - MANDATORY
 *   - window.TournamentEvents (from tournament-events.js) - MANDATORY
 *   - window.TournamentAggregator (from tournament-aggregator.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.TournamentsRender (from tournament-render.js) - MANDATORY
 *   - window.TournamentCore (from tournament-core.js) - MANDATORY
 *   - window.TournamentMatches (from tournament-matches.js) - MANDATORY
 *   - window.DataLoader (from loader.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 * 
 * USAGE:
 *   // Auto-registered with TabManager.
 *   // Or manually:
 *   window.Tournaments.mount(container);
 */

(function() {
    'use strict';

    if (window.__tournamentsModuleLoaded) {
        return;
    }
    window.__tournamentsModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TabManager = window.TabManager;
    var TournamentsUI = window.TournamentsUI;
    var TournamentEvents = window.TournamentEvents;
    var TournamentAggregator = window.TournamentAggregator;
    var TournamentQueries = window.TournamentQueries;
    var TournamentsRender = window.TournamentsRender;
    var TournamentCore = window.TournamentCore;
    var TournamentMatches = window.TournamentMatches;
    var DataLoader = window.DataLoader;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var AcademyQueries = window.AcademyQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!TournamentsUI || typeof TournamentsUI.init !== 'function') {
            missing.push('TournamentsUI.init');
        }
        if (!TournamentsUI || typeof TournamentsUI.getState !== 'function') {
            missing.push('TournamentsUI.getState');
        }
        if (!TournamentsUI || typeof TournamentsUI.getActiveTab !== 'function') {
            missing.push('TournamentsUI.getActiveTab');
        }
        if (!TournamentsUI || typeof TournamentsUI.getViewMode !== 'function') {
            missing.push('TournamentsUI.getViewMode');
        }
        if (!TournamentsUI || typeof TournamentsUI.showTournamentList !== 'function') {
            missing.push('TournamentsUI.showTournamentList');
        }

        if (!TournamentEvents || typeof TournamentEvents.init !== 'function') {
            missing.push('TournamentEvents.init');
        }
        if (!TournamentEvents || typeof TournamentEvents.destroy !== 'function') {
            missing.push('TournamentEvents.destroy');
        }
        if (!TournamentEvents || typeof TournamentEvents.setRenderFn !== 'function') {
            missing.push('TournamentEvents.setRenderFn');
        }

        if (!TournamentAggregator || typeof TournamentAggregator.getTournamentListViewModel !== 'function') {
            missing.push('TournamentAggregator.getTournamentListViewModel');
        }
        if (!TournamentAggregator || typeof TournamentAggregator.getTournamentViewModel !== 'function') {
            missing.push('TournamentAggregator.getTournamentViewModel');
        }

        if (!TournamentQueries || typeof TournamentQueries.getTournament !== 'function') {
            missing.push('TournamentQueries.getTournament');
        }
        if (!TournamentQueries || typeof TournamentQueries.getTournaments !== 'function') {
            missing.push('TournamentQueries.getTournaments');
        }

        if (!TournamentsRender || typeof TournamentsRender.renderList !== 'function') {
            missing.push('TournamentsRender.renderList');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderDetail !== 'function') {
            missing.push('TournamentsRender.renderDetail');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderFilterBar !== 'function') {
            missing.push('TournamentsRender.renderFilterBar');
        }

        if (!TournamentCore || typeof TournamentCore.createTournament !== 'function') {
            missing.push('TournamentCore.createTournament');
        }
        if (!TournamentCore || typeof TournamentCore.getTournament !== 'function') {
            missing.push('TournamentCore.getTournament');
        }
        if (!TournamentCore || typeof TournamentCore.getAllowedTransitions !== 'function') {
            missing.push('TournamentCore.getAllowedTransitions');
        }

        if (!TournamentMatches || typeof TournamentMatches.createMatch !== 'function') {
            missing.push('TournamentMatches.createMatch');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn('[TournamentsModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================
    // 
    // The tournament subsystem currently does not use dependency
    // injection. Sub-modules resolve their dependencies from the
    // window object at call time. This section is reserved for the
    // case where that changes (e.g. TournamentCore gains a provider
    // contract like TeamCore's characterProvider).

    var _providersInitialized = false;

    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        // No providers to inject currently. When they're needed,
        // this is where they're assembled and passed to whichever
        // sub-module requires them.

        _providersInitialized = true;
        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _mounted = false;
    var _container = null;

    // ============================================================
    // RENDER
    // ============================================================

    /**
     * Main render function for the tournament module.
     * Registered with TournamentEvents.setRenderFn().
     * 
     * RENDER CONTRACT:
     *   activeTab === 'detail' → render detail panel (or recover)
     *   activeTab === 'list'   → render list panel (list or grid)
     * 
     *   Recovery: if activeTab is 'detail' but no tournament is
     *   selected (or the selected tournament no longer exists),
     *   reset to the list panel and render that instead. This keeps
     *   UI state and rendered output consistent.
     */
    function renderTournamentContainer() {
        if (!_container) {
            return;
        }

        if (!window.data || !Array.isArray(window.data.tournaments)) {
            _container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        if (!checkDependencies()) {
            _container.innerHTML = '<p class="empty-state">Tournament dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // ---- Read UI state ----
        var selectedId = TournamentsUI.getSelectedTournamentId();
        var activeTab = TournamentsUI.getActiveTab();
        var viewMode = TournamentsUI.getViewMode();
        var filters = TournamentsUI.getFilters();

        // ---- Build list view model ----
        var listVM = TournamentAggregator.getTournamentListViewModel({
            filter: filters.status !== 'all' ? filters.status : null,
            search: filters.search || '',
            sort: 'createdAt',
            sortDirection: 'desc'
        });

        // ---- Resolve detail view model if requested ----
        var detailVM = null;
        if (selectedId) {
            detailVM = TournamentAggregator.getTournamentViewModel(selectedId);
        }

        // ---- Recovery: detail requested but not resolvable ----
        if (activeTab === 'detail' && !detailVM) {
            // The selected tournament is gone (deleted) or was never
            // selected. Reset UI state to the list panel and fall
            // through to the list render path.
            TournamentsUI.showTournamentList();
            activeTab = 'list';
            selectedId = null;
        }

        // ---- Render ----
        var html = '';
        html += renderHeader(activeTab, viewMode, selectedId);
        html += TournamentsRender.renderFilterBar(filters);

        if (activeTab === 'detail' && detailVM) {
            html += TournamentsRender.renderDetail(detailVM);
        } else {
            if (viewMode === 'grid') {
                html += TournamentsRender.renderGrid(listVM);
            } else {
                html += TournamentsRender.renderList(listVM);
            }
        }

        _container.innerHTML = html;

        // Re-bind events after innerHTML replacement.
        // TournamentEvents uses document-level delegation for most
        // handlers, so this is mostly a no-op, but it keeps the
        // contract explicit.
        TournamentEvents.refreshUI();
    }

    // ============================================================
    // RENDER HELPERS
    // ============================================================

    /**
     * Render the header bar.
     * 
     * VIEW MODE BUTTONS:
     *   - List and Grid buttons always shown.
     *   - Detail is NOT a view mode. It's reached by selecting a
     *     tournament. No Detail toggle is offered.
     *   - The buttons emit data-view="list" or data-view="grid".
     *     TournamentEvents handles the click and calls
     *     TournamentsUI.setViewMode().
     * 
     * @param {string} activeTab - 'list' or 'detail'
     * @param {string} viewMode - 'list' or 'grid'
     * @param {string|null} selectedId - Currently selected tournament ID
     * @returns {string} HTML string
     */
    function renderHeader(activeTab, viewMode, selectedId) {
        var isDetail = activeTab === 'detail';

        return [
            '<div class="tournament-header">',
                '<div class="tournament-header-left">',
                    '<h2>Tournaments</h2>',
                    '<span class="tournament-count">' + getTournamentCount() + '</span>',
                    (isDetail ? '<button class="close-tournament-detail small secondary" type="button">← Back to List</button>' : ''),
                '</div>',
                '<div class="tournament-header-right">',
                    '<div class="view-controls">',
                        '<button class="view-btn ' + (!isDetail && viewMode === 'list' ? 'active' : '') + '" data-view="list" title="List View" type="button">☰</button>',
                        '<button class="view-btn ' + (!isDetail && viewMode === 'grid' ? 'active' : '') + '" data-view="grid" title="Grid View" type="button">⊞</button>',
                    '</div>',
                    '<button id="add-tournament-btn" class="primary" type="button">+ Add Tournament</button>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // MOUNT / UNMOUNT
    // ============================================================

    function mountTournaments(container) {
        if (!container) {
            container = document.getElementById('tab-tournaments');
        }

        if (!container) {
            console.warn('[TournamentsModule] Container not found');
            return;
        }

        if (!window.data || !Array.isArray(window.data.tournaments)) {
            container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Tournament dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        if (!initProviders()) {
            container.innerHTML = '<p class="empty-state">Failed to initialize tournament providers. Please refresh the page.</p>';
            return;
        }

        if (_mounted) {
            unmountTournaments();
        }

        _container = container;

        // Initialize UI state (loads persisted state from sessionStorage)
        TournamentsUI.init();

        // Register the render function with Events, then initialize Events.
        // Ordering matters: Events needs the render function set before
        // init, because init calls back into render in some paths.
        TournamentEvents.setRenderFn(renderTournamentContainer);
        TournamentEvents.init(container);

        // Initial render
        renderTournamentContainer();

        _mounted = true;
        _initialized = true;

        dispatchReady();
    }

    function unmountTournaments() {
        if (!_mounted) {
            return;
        }

        TournamentEvents.destroy();
        _mounted = false;
        _container = null;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function refresh() {
        if (!_mounted) {
            return;
        }
        renderTournamentContainer();
    }

    function goToTab() {
        if (TabManager && typeof TabManager.switchTo === 'function') {
            TabManager.switchTo('tournaments', true);
        }
    }

    function isMounted() {
        return _mounted;
    }

    function isInitialized() {
        return _initialized;
    }

    function getState() {
        return {
            mounted: _mounted,
            initialized: _initialized,
            providersInitialized: _providersInitialized,
            tournamentCount: getTournamentCount(),
            selectedTournamentId: TournamentsUI.getSelectedTournamentId(),
            activeTab: TournamentsUI.getActiveTab(),
            viewMode: TournamentsUI.getViewMode(),
            filters: TournamentsUI.getFilters()
        };
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('tournamentsReady', {
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
            TabManager.register('tournaments', mountTournaments);
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
    // DATA READY HANDLING
    // ============================================================

    function handleDataReady() {
        if (TabManager && TabManager.getCurrentTab() === 'tournaments') {
            var container = document.getElementById('tab-tournaments');
            if (container && !_mounted) {
                mountTournaments(container);
            }
        }
    }

    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data) {
                handleDataReady();
            }
        });
    }

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'tournaments') {
            var container = document.getElementById('tab-tournaments');
            if (container && !_mounted) {
                mountTournaments(container);
            }
        }
    });

    // ============================================================
    // HELPERS
    // ============================================================

    function getTournamentCount() {
        var data = window.data || {};
        if (!Array.isArray(data.tournaments)) {
            return 0;
        }
        return data.tournaments.length;
    }

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy function for backwards compatibility.
     * @deprecated Use window.Tournaments.mount() instead.
     */
    window.renderTournaments = mountTournaments;

    // ============================================================
    // EXPOSE
    // ============================================================

    window.Tournaments = {
        // Initialization
        initProviders: initProviders,

        // Mount
        mount: mountTournaments,
        unmount: unmountTournaments,

        // Refresh
        refresh: refresh,

        // Navigation
        goToTab: goToTab,

        // Queries
        getTournamentCount: getTournamentCount,

        // State
        isMounted: isMounted,
        isInitialized: isInitialized,
        getState: getState,

        // Render function (for external use)
        render: renderTournamentContainer
    };

    // Legacy compatibility
    window.TournamentsModule = {
        init: mountTournaments,
        destroy: unmountTournaments,
        render: renderTournamentContainer,
        getState: getState
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.Tournaments;
        var missing = [];

        var required = [
            'mount', 'unmount', 'refresh',
            'goToTab', 'getTournamentCount',
            'isMounted', 'isInitialized', 'getState'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentsModule] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentsModule] All exports verified successfully.');
        }
    })();

})();