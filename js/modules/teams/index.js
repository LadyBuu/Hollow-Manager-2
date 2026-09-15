/**
 * modules/teams/index.js - Team Module Entry Point
 * Single entry point for all team functionality.
 *
 * Path: js/modules/teams/index.js
 *
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Assembling the characterProvider and injecting it into TeamCore
 *   - Handing the container to TeamEvents for interaction wiring
 *   - Coordinating the initial render through the canonical path
 *   - Exposing the public Teams API
 *
 * ARCHITECTURE:
 *   This file is the LIFECYCLE ENTRY POINT. It does not implement
 *   team logic. It only:
 *     1. Ensures dependencies are loaded.
 *     2. Ensures TeamCore is configured.
 *     3. Ensures TeamUI is initialized.
 *     4. Ensures the application year is available.
 *     5. Hands the container to TeamEvents.
 *     6. Calls TeamEvents.refreshUI as the single render path.
 *
 *   Do not add per-feature logic here. If a modal opens, it opens
 *   from TeamEvents. If a VM is projected, it comes from
 *   TeamAggregator. If a mutation runs, it runs through TeamCore.
 *
 * LIFECYCLE:
 *   TabManager.register('teams', mountTeams)
 *     ↓
 *   mountTeams(container)
 *     ↓
 *   checkDependencies()
 *     ↓
 *   initProviders()          (TeamCore.configure)
 *     ↓
 *   TeamUI.init()
 *     ↓
 *   getEffectivePeriod()      (fast fail if year unavailable)
 *     ↓
 *   TeamEvents.init(container)
 *     ↓
 *   TeamEvents.refreshUI()    (single render path)
 *     ↓
 *   dispatchReady()
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - The current application year comes from window.data.currentYear.
 *     If it is missing or malformed, the entry point does not invent
 *     a value. getEffectivePeriod returns null, and mountTeams
 *     renders a data-unavailable message.
 *   - new Date().getFullYear() is NEVER used as a fallback. The
 *     application year is world state, not wall-clock state.
 *
 * PERSISTENCE:
 *   - The entry point does not call saveData.
 *   - All mutations go through TeamCore → MutationPipeline.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TabManager
 *   - window.CharacterQueries
 *   - window.TeamCore
 *   - window.TeamEvents
 *   - window.TeamUI
 *   - window.TeamRender
 *   - window.TeamAggregator
 *   - window.TeamQueries
 *   - window.NotificationSystem
 *
 * OPTIONAL:
 *   - window.DataLoader (readiness hook is skipped when absent)
 *
 * USAGE:
 *   The module self-registers with TabManager. External callers use:
 *     window.Teams.mount(container)
 *     window.Teams.refresh()
 *     window.Teams.unmount()
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
    var TeamQueries = window.TeamQueries;
    var NotificationSystem = window.NotificationSystem;
    var DataLoader = window.DataLoader;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================
    //
    // Only checks what THIS module invokes. Sub-modules validate
    // their own dependencies.

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }
        if (!TabManager || typeof TabManager.getCurrentTab !== 'function') {
            missing.push('TabManager.getCurrentTab');
        }
        if (!TabManager || typeof TabManager.switchTo !== 'function') {
            missing.push('TabManager.switchTo');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!TeamCore || typeof TeamCore.configure !== 'function') {
            missing.push('TeamCore.configure');
        }

        if (!TeamEvents || typeof TeamEvents.init !== 'function') {
            missing.push('TeamEvents.init');
        }
        if (!TeamEvents || typeof TeamEvents.destroy !== 'function') {
            missing.push('TeamEvents.destroy');
        }
        if (!TeamEvents || typeof TeamEvents.refreshUI !== 'function') {
            missing.push('TeamEvents.refreshUI');
        }

        if (!TeamUI || typeof TeamUI.init !== 'function') {
            missing.push('TeamUI.init');
        }
        if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
            missing.push('TeamUI.getCurrentTab');
        }
        if (!TeamUI || typeof TeamUI.getExpandedTeamId !== 'function') {
            missing.push('TeamUI.getExpandedTeamId');
        }
        if (!TeamUI || typeof TeamUI.getFilter !== 'function') {
            missing.push('TeamUI.getFilter');
        }

        if (!TeamRender || typeof TeamRender.renderContainer !== 'function') {
            missing.push('TeamRender.renderContainer');
        }

        if (!TeamAggregator || typeof TeamAggregator.getTeamPageViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamPageViewModel');
        }

        if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
            missing.push('TeamQueries.getTeams');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
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

    var _mounted = false;
    var _hasMountedOnce = false;
    var _providersInitialized = false;
    var _container = null;

    // ============================================================
    // CURRENT YEAR - STRICT
    // ============================================================

    /**
     * Get the current application year.
     *
     * STRICT: returns null when window.data.currentYear is missing
     * or malformed. Does NOT fall back to the Gregorian year.
     *
     * @returns {number|null}
     */
    function getCurrentYear() {
        var data = window.data;
        if (!data || typeof data.currentYear !== 'number' || !isFinite(data.currentYear)) {
            return null;
        }
        return data.currentYear;
    }

    /**
     * Get the effective period for a tab.
     *
     * Reads persisted filter state from TeamUI. When no explicit
     * filter is set, the current application year is used. If
     * neither is available, returns null.
     *
     * @param {string} tab
     * @returns {number|null}
     */
    function getEffectivePeriod(tab) {
        if (TeamUI && typeof TeamUI.getFilter === 'function') {
            var filter = TeamUI.getFilter(tab);
            if (filter && typeof filter.filterYear === 'number' && isFinite(filter.filterYear)) {
                return filter.filterYear;
            }
        }
        return getCurrentYear();
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================

    /**
     * Assemble and inject the character provider into TeamCore.
     * Idempotent.
     *
     * @returns {boolean}
     */
    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        var characterProvider = {
            exists: function(id) {
                if (id === null || id === undefined || id === '') {
                    return false;
                }
                var char = CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            }
        };

        var result;
        try {
            result = TeamCore.configure({ characterProvider: characterProvider });
        } catch (e) {
            console.error('[TeamsModule] TeamCore.configure threw:', e);
            return false;
        }

        if (result !== true) {
            console.error('[TeamsModule] TeamCore.configure returned non-true:', result);
            return false;
        }

        _providersInitialized = true;
        return true;
    }

    // ============================================================
    // MOUNT / UNMOUNT
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

        _container = container;

        // 1. Initialize UI state.
        TeamUI.init();

        // 2. Fast fail: the application year must be available. The
        //    Teams tab cannot decide which period's teams to show
        //    without it.
        var currentTab = TeamUI.getCurrentTab();
        if (getEffectivePeriod(currentTab) === null) {
            container.innerHTML = '<p class="empty-state">' +
                'Application year is unavailable. Please check the data.' +
            '</p>';
            return;
        }

        // 3. Bind events. TeamEvents.init attaches delegated
        //    listeners to the container; it does not render.
        TeamEvents.init(container);

        // 4. Single render path. refreshUI builds a fresh page VM,
        //    hands it to TeamRender.renderContainer, writes the
        //    container, and populates the filter bar slot.
        TeamEvents.refreshUI();

        _mounted = true;
        _hasMountedOnce = true;

        dispatchReady();
    }

    function unmountTeams() {
        if (!_mounted) {
            return;
        }

        TeamEvents.destroy();

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
        TeamEvents.refreshUI();
    }

    function goToTab() {
        TabManager.switchTo('teams', true);
    }

    function getTeamCount() {
        var teams = TeamQueries.getTeams(null, null, false);
        return teams.length;
    }

    function isMounted() {
        return _mounted;
    }

    function hasMountedOnce() {
        return _hasMountedOnce;
    }

    function getState() {
        return {
            mounted: _mounted,
            hasMountedOnce: _hasMountedOnce,
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
                    hasMountedOnce: _hasMountedOnce,
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
        TabManager.register('teams', mountTeams);
        return true;
    }

    if (!registerWithTabManager()) {
        // The only legitimate race: TabManager is not yet defined
        // during initial bootstrap. It emits 'tabManagerReady' when
        // it is.
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
    // EXPOSE
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
        hasMountedOnce: hasMountedOnce,
        getState: getState
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.Teams;
        var missing = [];

        var required = [
            'mount', 'unmount', 'refresh',
            'goToTab', 'getTeamCount',
            'isMounted', 'hasMountedOnce', 'getState',
            'initProviders'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamsModule] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
