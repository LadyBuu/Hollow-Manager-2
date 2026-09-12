/**
 * modules/teams/index.js - Team Module Entry Point
 * Single entry point for all team functionality
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the team container
 *   - Initializing all team sub-modules
 *   - Managing team feature lifecycle
 *   - Injecting dependencies (characterProvider)
 *   - Exposing public API
 * 
 * LIFECYCLE:
 *   TabManager.register('teams') -> mountTeams() -> 
 *   TeamCore.configure(characterProvider) -> TeamUI.init() -> 
 *   TeamRender.renderContainer() -> TeamEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for teams
 *   - All team logic lives in the sub-modules
 *   - This module does NOT implement team logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountTeams() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - characterProvider is assembled here and injected into TeamCore
 *   - No direct CharacterQueries usage - only via provider
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Initial render uses the current application year
 *     (window.data.currentYear) as the period for year-based
 *     team tabs, matching what TeamEvents.refreshUI will use
 *     after any user interaction.
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js)
 *   - window.CharacterQueries (from character-queries.js) - for provider only
 *   - window.TeamCore (from team-core.js)
 *   - window.TeamEvents (from team-events.js)
 *   - window.TeamUI (from team-ui.js)
 *   - window.TeamRender (from team-render.js)
 *   - window.TeamAggregator (from team-aggregator.js)
 *   - window.DataLoader (from loader.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.Modal (from modal.js)
 */

(function() {
    'use strict';

    if (window.__teamsModuleLoaded) {
        return;
    }
    window.__teamsModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterQueries = window.CharacterQueries;
    var TeamCore = window.TeamCore;
    var TeamEvents = window.TeamEvents;
    var TeamUI = window.TeamUI;
    var TeamRender = window.TeamRender;
    var TeamAggregator = window.TeamAggregator;
    var DataLoader = window.DataLoader;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!TeamCore || typeof TeamCore.configure !== 'function') {
            missing.push('TeamCore.configure');
        }
        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            missing.push('TeamCore.createTeam');
        }

        if (!TeamEvents || typeof TeamEvents.init !== 'function') {
            missing.push('TeamEvents.init');
        }
        if (!TeamEvents || typeof TeamEvents.destroy !== 'function') {
            missing.push('TeamEvents.destroy');
        }

        if (!TeamUI || typeof TeamUI.init !== 'function') {
            missing.push('TeamUI.init');
        }
        if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
            missing.push('TeamUI.getCurrentTab');
        }

        if (!TeamRender || typeof TeamRender.renderContainer !== 'function') {
            missing.push('TeamRender.renderContainer');
        }

        if (!TeamAggregator || typeof TeamAggregator.getTeamPageViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamPageViewModel');
        }

        if (missing.length > 0) {
            console.warn('[TeamsModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _mounted = false;
    var _providersInitialized = false;

    // ============================================================
    // PERIOD DEFAULT
    // ============================================================

    /**
     * Get the current application year.
     * Used as the default period for year-based team tabs.
     * 
     * @returns {number} Current year
     */
    function getCurrentYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' && isFinite(data.currentYear)) {
            return data.currentYear;
        }
        return new Date().getFullYear();
    }

    /**
     * Get the effective period for a tab.
     * 
     * SEMANTICS:
     *   - Academic teams use weeks; not reachable from the current
     *     tab nav (professional / temporary / civilian only).
     *   - Year-based tabs use the current application year unless
     *     the user has set an explicit filter.
     * 
     * @param {string} tab - Tab ID
     * @returns {number} Period (week or year)
     */
    function getEffectivePeriod(tab) {
        if (tab === 'academic') {
            return 1;
        }

        if (TeamUI && typeof TeamUI.getFilter === 'function') {
            var filter = TeamUI.getFilter(tab);
            if (filter && filter.filterYear) {
                return filter.filterYear;
            }
        }

        return getCurrentYear();
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================

    /**
     * Initialize providers and inject dependencies into TeamCore.
     * Must be called before mounting.
     */
    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        if (!CharacterQueries) {
            console.warn('[TeamsModule] CharacterQueries not available for provider.');
            return false;
        }

        var characterProvider = {
            /**
             * Check if a character exists by ID.
             * This is the only Character capability TeamCore needs.
             */
            exists: function(id) {
                if (!id) {
                    return false;
                }
                var char = CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            }
        };

        // Inject into TeamCore
        var initResult = TeamCore.configure({
            characterProvider: characterProvider
        });

        if (initResult) {
            _providersInitialized = true;
            return true;
        }

        return false;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountTeams(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }

        if (!container) {
            console.warn('[TeamsModule] Container not found');
            return;
        }

        if (!window.data || !Array.isArray(window.data.teams)) {
            container.innerHTML = '<p class="empty-state">Loading team data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Team dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        if (!initProviders()) {
            container.innerHTML = '<p class="empty-state">Failed to initialize team providers. Please refresh the page.</p>';
            return;
        }

        if (_mounted) {
            unmountTeams();
        }

        // Initialize UI state (loads persisted state from sessionStorage)
        TeamUI.init();

        // Render the container with the correct period for the current tab.
        // Initial period matches what TeamEvents.refreshUI will use, so
        // the list renders with the same member counts as subsequent
        // refreshes.
        var currentTab = TeamUI.getCurrentTab();
        var period = getEffectivePeriod(currentTab);
        var viewModel = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period
        });
        container.innerHTML = TeamRender.renderContainer(currentTab, viewModel);

        // Initialize events
        TeamEvents.init(container);

        // One refresh pass to guarantee the list, tab counts, and stat
        // cards are all built from the same view model. This is
        // idempotent and cheap.
        TeamEvents.refreshUI();

        _mounted = true;
        _initialized = true;

        dispatchReady();
    }

    function unmountTeams() {
        if (!_mounted) {
            return;
        }

        TeamEvents.destroy();
        _mounted = false;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function refresh() {
        if (!_mounted) {
            return;
        }

        TeamEvents.refreshUI();
    }

    function goToTab() {
        if (TabManager && typeof TabManager.switchTo === 'function') {
            TabManager.switchTo('teams', true);
        }
    }

    function getTeamCount() {
        var data = window.data || {};
        if (!Array.isArray(data.teams)) {
            return 0;
        }
        return data.teams.length;
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
            teamCount: getTeamCount(),
            currentTab: TeamUI.getCurrentTab(),
            expandedTeamId: TeamUI.getExpandedTeamId()
        };
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('teamsReady', {
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
            TabManager.register('teams', mountTeams);
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
        if (TabManager && TabManager.getCurrentTab() === 'teams') {
            var container = document.getElementById('tab-teams');
            if (container && !_mounted) {
                mountTeams(container);
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
        if (e.detail && e.detail.tab === 'teams') {
            var container = document.getElementById('tab-teams');
            if (container && !_mounted) {
                mountTeams(container);
            }
        }
    });

    // ============================================================
    // EXPOSE - Controlled public API
    // ============================================================

    window.Teams = {
        // Initialization
        initProviders: initProviders,

        // Mount
        mount: mountTeams,
        unmount: unmountTeams,

        // Refresh
        refresh: refresh,

        // Navigation
        goToTab: goToTab,

        // Queries
        getTeamCount: getTeamCount,

        // State
        isMounted: isMounted,
        isInitialized: isInitialized,
        getState: getState
    };

    // Legacy compatibility
    window.renderTeamManager = mountTeams;

})();