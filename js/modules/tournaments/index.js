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
 *   TournamentsUI.init() -> TournamentEvents.init(container) ->
 *   renderTournamentContainer() -> render list/detail
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for tournaments
 *   - All tournament logic lives in the sub-modules
 *   - This module does NOT implement tournament logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountTournaments() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - Providers are assembled here and injected into TournamentCore
 *   - No direct CharacterQueries usage - only via providers
 * 
 * NAMING CONVENTION:
 *   - The UI, Render, and Matches modules expose themselves as
 *     Tournaments* (plural) on the window object:
 *       window.TournamentsUI
 *       window.TournamentsRender
 *       window.TournamentsMatches
 *   - Earlier versions of this file referenced singular names
 *     (TournamentUI, TournamentRender, TournamentMatches). Those
 *     references have been corrected.
 * 
 * EXTERNAL PROVIDERS:
 *   - characterProvider: { exists: function(id) { ... } }
 *   - teamProvider: { exists: function(id) { ... } }
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.TournamentsUI (from tournament-ui.js) - MANDATORY
 *   - window.TournamentEvents (from tournament-events.js) - MANDATORY
 *   - window.TournamentAggregator (from tournament-aggregator.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.TournamentsRender (from tournament-render.js) - MANDATORY
 *   - window.TournamentCore (from tournament-core.js) - MANDATORY
 *   - window.TournamentsMatches (from tournament-matches.js) - MANDATORY
 *   - window.DataLoader (from loader.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 * 
 * USAGE:
 *   // Auto-registered with TabManager
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
    var TournamentsMatches = window.TournamentsMatches;
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

        if (!TournamentCore || typeof TournamentCore.createTournament !== 'function') {
            missing.push('TournamentCore.createTournament');
        }
        if (!TournamentCore || typeof TournamentCore.getTournament !== 'function') {
            missing.push('TournamentCore.getTournament');
        }

        if (!TournamentsMatches || typeof TournamentsMatches.createMatch !== 'function') {
            missing.push('TournamentsMatches.createMatch');
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

    var _providersInitialized = false;

    /**
     * Initialize providers and inject dependencies into Tournament modules.
     * Must be called before mounting.
     */
    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        // ---- Character Provider ----
        var characterProvider = {
            exists: function(id) {
                if (!id) { return false; }
                var char = CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            },
            getCharacterById: function(id) {
                return CharacterQueries.getCharacterById(id);
            },
            getDisplayName: function(id) {
                return CharacterQueries.getCharacterNameById(id);
            },
            getCurrentStatus: function(char) {
                return CharacterQueries.getCurrentStatus(char);
            },
            isStudent: function(char) {
                return CharacterQueries.isStudent(char);
            },
            isInstructor: function(char) {
                return CharacterQueries.isInstructor(char);
            }
        };

        // ---- Team Provider ----
        var teamProvider = {
            exists: function(id) {
                if (!id) { return false; }
                var team = TeamQueries.getTeamById(id);
                return team !== null && team !== undefined;
            },
            getTeamById: function(id) {
                return TeamQueries.getTeamById(id);
            },
            getTeamName: function(id) {
                return TeamQueries.getTeamName(id);
            },
            getActiveMembers: function(team) {
                return TeamQueries.getActiveTeamMembers ? TeamQueries.getActiveTeamMembers(team, 1) : [];
            }
        };

        // ---- Academy Provider ----
        var academyProvider = {
            getClass: function(classId) {
                return AcademyQueries.getClass(classId);
            },
            getClassDisplayName: function(classId) {
                return AcademyQueries.getClassDisplayName(classId);
            },
            getClasses: function() {
                return AcademyQueries.getClasses();
            }
        };

        // ---- Calendar Provider ----
        var calendarProvider = {
            getWeekRange: function() {
                return { min: 1, max: 52 };
            },
            isValidWeek: function(week) {
                var num = parseInt(week, 10);
                return !isNaN(num) && num >= 1 && num <= 52;
            }
        };

        // NOTE: TournamentCore and TournamentsMatches do not need providers
        // injected since they use lazy loading for dependencies.
        // This is consistent with the other modules.

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
    // RENDER FUNCTION
    // ============================================================

    /**
     * Main render function for the tournament module.
     * This is set as the render function for TournamentEvents.
     */
    function renderTournamentContainer() {
        if (!_container) {
            return;
        }

        if (!window.data || !Array.isArray(window.data.tournaments)) {
            _container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        var UI = TournamentsUI;
        var Aggregator = TournamentAggregator;
        var Render = TournamentsRender;

        if (!UI || !Aggregator || !Render) {
            _container.innerHTML = '<p class="empty-state">Tournament dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Get UI state
        var selectedId = UI.getSelectedTournamentId();
        var activeTab = UI.getActiveTab();
        var filters = UI.getFilters();
        var viewMode = UI.getViewMode();

        // Get data via Aggregator
        var listVM = Aggregator.getTournamentListViewModel({
            filter: filters.status !== 'all' ? filters.status : null,
            search: filters.search || '',
            sort: 'createdAt',
            sortDirection: 'desc'
        });

        // Get detail if selected
        var detailVM = null;
        if (selectedId) {
            detailVM = Aggregator.getTournamentViewModel(selectedId);
        }

        // Render using TournamentsRender
        var html = '';
        
        // Header with controls
        html += renderHeader(UI);

        // Filter bar
        html += renderFilterBar(filters);

        // Main content
        if (activeTab === 'detail' && detailVM) {
            html += Render.renderDetail(detailVM);
        } else {
            // List or grid view
            if (viewMode === 'grid') {
                html += renderGridView(listVM);
            } else {
                html += Render.renderList(listVM.tournaments);
            }
        }

        _container.innerHTML = html;

        // Re-bind events (TournamentEvents handles this)
        TournamentEvents.refreshUI();
    }

    // ============================================================
    // RENDER HELPERS
    // ============================================================

    function renderHeader(UI) {
        var viewMode = UI.getViewMode() || 'list';
        var selectedId = UI.getSelectedTournamentId();

        return [
            '<div class="tournament-header">',
                '<div class="tournament-header-left">',
                    '<h2>Tournaments</h2>',
                    '<span class="tournament-count">' + getTournamentCount() + '</span>',
                '</div>',
                '<div class="tournament-header-right">',
                    '<div class="view-controls">',
                        '<button class="view-btn ' + (viewMode === 'list' ? 'active' : '') + '" data-view="list" title="List View">☰</button>',
                        '<button class="view-btn ' + (viewMode === 'grid' ? 'active' : '') + '" data-view="grid" title="Grid View">⊞</button>',
                        (selectedId ? '<button class="view-btn active" data-view="detail" title="Detail View">◉</button>' : ''),
                    '</div>',
                    '<button id="add-tournament-btn" class="primary">+ Add Tournament</button>',
                '</div>',
            '</div>'
        ].join('');
    }

    function renderFilterBar(filters) {
        var status = filters.status || 'all';
        var search = filters.search || '';
        var mode = filters.mode || 'all';

        return [
            '<div class="tournament-filters">',
                '<div class="filter-group">',
                    '<select id="tournament-status-filter" class="tournament-status-filter">',
                        '<option value="all"' + (status === 'all' ? ' selected' : '') + '>All Statuses</option>',
                        '<option value="draft"' + (status === 'draft' ? ' selected' : '') + '>Draft</option>',
                        '<option value="active"' + (status === 'active' ? ' selected' : '') + '>Active</option>',
                        '<option value="completed"' + (status === 'completed' ? ' selected' : '') + '>Completed</option>',
                    '</select>',
                '</div>',
                '<div class="filter-group">',
                    '<select id="tournament-mode-filter" class="tournament-mode-filter">',
                        '<option value="all"' + (mode === 'all' ? ' selected' : '') + '>All Modes</option>',
                        '<option value="teams"' + (mode === 'teams' ? ' selected' : '') + '>Teams</option>',
                        '<option value="individuals"' + (mode === 'individuals' ? ' selected' : '') + '>Individuals</option>',
                    '</select>',
                '</div>',
                '<div class="filter-group search-group">',
                    '<input type="text" id="tournament-search-filter" class="tournament-search-filter" placeholder="Search tournaments..." value="' + escapeHtml(search) + '">',
                '</div>',
                '<button id="clear-tournament-filters" class="clear-tournament-filters small secondary">Clear</button>',
            '</div>'
        ].join('');
    }

    function renderGridView(listVM) {
        var tournaments = listVM.tournaments || [];

        if (tournaments.length === 0) {
            return '<p class="empty-state">No tournaments found. Create your first tournament!</p>';
        }

        var html = '<div class="tournament-grid">';
        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            html += renderGridCard(t);
        }
        html += '</div>';

        return html;
    }

    function renderGridCard(tournament) {
        var statusClass = tournament.status || 'draft';
        var statusLabel = tournament.statusDisplay ? tournament.statusDisplay.text : tournament.status;

        return [
            '<div class="tournament-card" data-id="' + escapeHtml(tournament.id) + '">',
                '<div class="tournament-card-header">',
                    '<span class="tournament-card-name">' + escapeHtml(tournament.name) + '</span>',
                    '<span class="tournament-card-status ' + escapeHtml(statusClass) + '">' + escapeHtml(statusLabel) + '</span>',
                '</div>',
                '<div class="tournament-card-body">',
                    '<div class="tournament-card-stats">',
                        '<span class="stat">' + tournament.participantCount + ' participants</span>',
                        '<span class="stat">' + tournament.roundCount + ' rounds</span>',
                        (tournament.hasWinner ? '<span class="stat winner">★ ' + escapeHtml(tournament.winnerName || 'Winner') + '</span>' : ''),
                    '</div>',
                    '<div class="tournament-card-meta">',
                        '<span class="mode">' + escapeHtml(tournament.modeLabel || tournament.mode) + '</span>',
                        (tournament.graduatingClassName ? '<span class="class">' + escapeHtml(tournament.graduatingClassName) + '</span>' : ''),
                    '</div>',
                '</div>',
                '<div class="tournament-card-actions">',
                    '<button class="view-tournament-btn small" data-id="' + escapeHtml(tournament.id) + '">View</button>',
                    '<button class="edit-tournament-btn small" data-id="' + escapeHtml(tournament.id) + '">Edit</button>',
                    '<button class="delete-tournament-btn small danger" data-id="' + escapeHtml(tournament.id) + '">Delete</button>',
                '</div>',
            '</div>'
        ].join('');
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function getTournamentCount() {
        var data = window.data || {};
        if (!Array.isArray(data.tournaments)) {
            return 0;
        }
        return data.tournaments.length;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
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

        // Initialize UI state
        TournamentsUI.init();

        // Set render function for Events
        TournamentEvents.setRenderFn(renderTournamentContainer);

        // Initialize events
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
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy function for backwards compatibility.
     * @deprecated Use window.Tournaments.mount() instead.
     */
    window.renderTournaments = mountTournaments;

    // ============================================================
    // EXPOSE - Controlled public API
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
