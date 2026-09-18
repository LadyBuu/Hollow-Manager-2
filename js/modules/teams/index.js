/**
 * modules/teams/index.js - Team Module Entry Point
 * Single entry point for all team functionality.
 *
 * Path: js/modules/teams/index.js
 *
 * RESPONSIBILITIES:
 *   - Register with TabManager.
 *   - Assemble the character provider and inject it into TeamCore.
 *   - Hand the container to TeamEvents for interaction wiring.
 *   - Coordinate the initial render through the canonical path.
 *   - Expose the public Teams API.
 *
 * ARCHITECTURE:
 *   This file is the LIFECYCLE ENTRY POINT. It does not implement
 *   team logic. It:
 *     1. Ensures dependencies are loaded (module-load throw).
 *     2. Ensures TeamCore is configured.
 *     3. Ensures TeamUI is initialized.
 *     4. Ensures the application year is available.
 *     5. Hands the container to TeamEvents.
 *     6. Calls TeamEvents.refreshUI as the single render path.
 *
 *   Do not add per-feature logic here. Modals open from TeamEvents.
 *   VMs come from TeamAggregator. Mutations run through TeamCore.
 *
 * LIFECYCLE:
 *   TabManager.register('teams', mountTeams)
 *     -> mountTeams(container)
 *       -> check window.data
 *       -> initProviders()        (TeamCore.configure)
 *       -> TeamUI.init()
 *       -> getEffectivePeriod()   (fast fail if year unavailable)
 *       -> TeamEvents.init(container)
 *       -> TeamEvents.refreshUI() (single render path)
 *       -> dispatchReady()
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - The current application year comes from window.data.currentYear.
 *     If it is missing or malformed, the entry point does not invent
 *     a value. getEffectivePeriod returns null, and mountTeams
 *     renders a data-unavailable message.
 *   - new Date().getFullYear() is NEVER used as a fallback.
 *
 * PERSISTENCE:
 *   - The entry point does not call saveData.
 *   - All mutations go through TeamCore -> MutationPipeline.
 *
 * CHARACTER PROVIDER:
 *   TeamCore.addMember's pipeline validate() calls
 *   _characterProvider.exists(snapshot, targetChar) with a
 *   two-argument, snapshot-first signature.
 *
 *   The provider registered here MUST match that contract: it reads
 *   from appData.characters when a snapshot is supplied. It falls
 *   back to CharacterQueries.getCharacterById(id) when only an ID is
 *   given, so a legacy exists(id) call site still works.
 *
 *   This provider and the one registered by
 *   academy-weekly-teams-controller.js must agree on shape.
 *   TeamCore.configure is idempotent — first successful call wins —
 *   so if either provider is shape-incorrect, every add-member call
 *   in BOTH tabs fails. Both must be correct.
 *
 * DEPENDENCIES (MANDATORY, checked at load):
 *   - window.CharacterQueries
 *   - window.TeamCore
 *   - window.TeamEvents
 *   - window.TeamUI
 *   - window.TeamRender
 *   - window.TeamAggregator
 *   - window.TeamQueries
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (OPTIONAL, resolved at call time):
 *   - window.TabManager   (registration is deferred via 'tabManagerReady')
 *   - window.DataLoader   (readiness hook is skipped when absent)
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
    // MANDATORY DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TeamCore = window.TeamCore;
    var TeamEvents = window.TeamEvents;
    var TeamUI = window.TeamUI;
    var TeamRender = window.TeamRender;
    var TeamAggregator = window.TeamAggregator;
    var TeamQueries = window.TeamQueries;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // MANDATORY DEPENDENCY CHECK
    // ============================================================

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }

    if (!TeamCore || typeof TeamCore.configure !== 'function') {
        _missing.push('TeamCore.configure');
    }

    if (!TeamEvents || typeof TeamEvents.init !== 'function') {
        _missing.push('TeamEvents.init');
    }
    if (!TeamEvents || typeof TeamEvents.destroy !== 'function') {
        _missing.push('TeamEvents.destroy');
    }
    if (!TeamEvents || typeof TeamEvents.refreshUI !== 'function') {
        _missing.push('TeamEvents.refreshUI');
    }

    if (!TeamUI || typeof TeamUI.init !== 'function') {
        _missing.push('TeamUI.init');
    }
    if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
        _missing.push('TeamUI.getCurrentTab');
    }
    if (!TeamUI || typeof TeamUI.getExpandedTeamId !== 'function') {
        _missing.push('TeamUI.getExpandedTeamId');
    }
    if (!TeamUI || typeof TeamUI.getFilter !== 'function') {
        _missing.push('TeamUI.getFilter');
    }

    if (!TeamRender ||
        typeof TeamRender.renderContainer !== 'function') {
        _missing.push('TeamRender.renderContainer');
    }

    if (!TeamAggregator ||
        typeof TeamAggregator.getTeamPageViewModel !== 'function') {
        _missing.push('TeamAggregator.getTeamPageViewModel');
    }

    if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }

    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamsModule] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================
    //
    // TabManager is resolved lazily so this module can load before
    // TabManager does. If TabManager arrives later, the
    // 'tabManagerReady' event triggers registration.
    //
    // DataLoader is resolved lazily for the same reason.

    function getTabManager() {
        return window.TabManager || null;
    }

    function getDataLoader() {
        return window.DataLoader || null;
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _mounted = false;
    var _hasMountedOnce = false;
    var _providersInitialized = false;
    var _container = null;

    // ============================================================
    // CURRENT YEAR
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
        if (!data ||
            typeof data.currentYear !== 'number' ||
            !isFinite(data.currentYear)) {
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
            if (filter &&
                typeof filter.filterYear === 'number' &&
                isFinite(filter.filterYear)) {
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
     * Idempotent from this module's perspective.
     *
     * PROVIDER CONTRACT:
     *   exists(appData, characterId) -> boolean
     *
     *   - When appData is supplied (a pipeline snapshot), read from
     *     appData.characters. This is the authoritative, snapshot-
     *     aware path, and it is what addMember uses inside its
     *     pipeline validate() callback.
     *   - When appData is absent, fall back to live state via
     *     CharacterQueries.getCharacterById(id). Kept so a legacy
     *     call site that invokes exists(id) still works.
     *
     * WHY THE SIGNATURE MATTERS:
     *   TeamCore.configure is idempotent: the first successful call
     *   wins. Both this module and academy-weekly-teams-controller.js
     *   register providers. If either provider is shape-incorrect,
     *   the configure call that lands first may be the incorrect
     *   one, and every addMember call in BOTH tabs fails with
     *   "Character not found." The two providers must agree on
     *   shape.
     *
     * @returns {boolean}
     */
    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        var characterProvider = {
            exists: function(appData, id) {
                if (id === null || id === undefined || id === '') {
                    return false;
                }

                var target = String(id);

                // Snapshot-aware path.
                if (appData &&
                    typeof appData === 'object' &&
                    Array.isArray(appData.characters)) {
                    for (var i = 0; i < appData.characters.length; i++) {
                        var c = appData.characters[i];
                        if (c && String(c.id) === target) {
                            return true;
                        }
                    }
                    return false;
                }

                // Fallback: no snapshot supplied. Read live state.
                var char = CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            }
        };

        var result;
        try {
            result = TeamCore.configure({
                characterProvider: characterProvider
            });
        } catch (e) {
            console.error('[TeamsModule] TeamCore.configure threw:', e);
            return false;
        }

        if (result !== true) {
            console.error(
                '[TeamsModule] TeamCore.configure returned non-true:',
                result
            );
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

        if (!window.data) {
            container.innerHTML =
                '<p class="empty-state">Loading team data...</p>';
            return;
        }

        if (!Array.isArray(window.data.teams)) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Team data store is malformed. Please refresh the page.' +
                '</p>';
            return;
        }

        if (!initProviders()) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Failed to initialize team providers. ' +
                    'Please refresh the page.' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountTeams();
        }

        _container = container;

        // 1. Initialize UI state.
        TeamUI.init();

        // 2. Fast fail: the application year must be available.
        var currentTab = TeamUI.getCurrentTab();
        if (getEffectivePeriod(currentTab) === null) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Application year is unavailable. ' +
                    'Please check the data.' +
                '</p>';
            return;
        }

        // 3. Bind events. TeamEvents.init attaches delegated
        //    listeners to the container; it does not render.
        TeamEvents.init(container);

        // 4. Single render path.
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
        var TabManager = getTabManager();
        if (!TabManager || typeof TabManager.switchTo !== 'function') {
            return false;
        }
        TabManager.switchTo('teams', true);
        return true;
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

    /**
     * Register with TabManager.
     *
     * Returns false when TabManager is not yet available. The
     * caller is responsible for retrying on the 'tabManagerReady'
     * event.
     *
     * @returns {boolean}
     */
    function registerWithTabManager() {
        var TabManager = getTabManager();
        if (!TabManager || typeof TabManager.register !== 'function') {
            return false;
        }
        TabManager.register('teams', mountTeams);
        return true;
    }

    if (!registerWithTabManager()) {
        // TabManager is not yet defined. It emits 'tabManagerReady'
        // when it is.
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA READY HANDLING
    // ============================================================

    function handleDataReady() {
        var TabManager = getTabManager();
        if (TabManager &&
            typeof TabManager.getCurrentTab === 'function' &&
            TabManager.getCurrentTab() === 'teams') {
            var container = document.getElementById('tab-teams');
            if (container && !_mounted) {
                mountTeams(container);
            }
        }
    }

    var DataLoader = getDataLoader();
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

    window.Teams = Object.freeze({
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
    });

})();