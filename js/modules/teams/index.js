/**
 * modules/teams/index.js - Team Module Entry Point
 * Single entry point for all team functionality.
 *
 * Path: js/modules/teams/index.js
 *
 * WHAT THIS OWNS:
 *   - TabManager registration.
 *   - Mount / unmount lifecycle for the teams tab.
 *   - TeamCore provider injection (characterProvider).
 *   - Data readiness handling.
 *   - The public Teams API.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Any team logic. TeamEvents owns interaction; TeamCore owns
 *     mutations; TeamAggregator owns projections; TeamQueries owns
 *     reads.
 *   - Feature wiring. Do not add feature-specific handlers here.
 *
 * YEAR SEMANTICS:
 *   Years are unbounded positive integers. Every period read goes
 *   through TeamConstants.parsePeriod. No fallback to the Gregorian
 *   year. When the application year is unavailable, mount fails
 *   visibly.
 *
 * CHARACTER PROVIDER:
 *   Provider contract: exists(appData, characterId) -> boolean.
 *
 *   - When appData is supplied (a pipeline snapshot), read from
 *     appData.characters. This is the authoritative, snapshot-aware
 *     path used by addMember's pipeline validate().
 *   - When appData is absent, fall back to live state via
 *     CharacterQueries.getCharacterById(id).
 *
 *   This module and academy-weekly-teams-controller.js both call
 *   TeamCore.configure. Configure is first-wins. Both providers
 *   must agree on shape or addMember will fail in one tab and work
 *   in the other depending on load order.
 *
 * DEPENDENCIES (MANDATORY, checked at load):
 *   - window.CharacterQueries
 *   - window.TeamCore
 *   - window.TeamEvents
 *   - window.TeamUI
 *   - window.TeamConstants
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, resolved at call time):
 *   - window.TabManager
 *   - window.DataLoader
 */

(function() {
    'use strict';

    if (window.__teamsModuleLoaded) { return; }
    window.__teamsModuleLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TeamCore = window.TeamCore;
    var TeamEvents = window.TeamEvents;
    var TeamUI = window.TeamUI;
    var TeamConstants = window.TeamConstants;
    var NotificationSystem = window.NotificationSystem;

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
    if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
        _missing.push('TeamUI.getCurrentTab');
    }
    if (!TeamUI || typeof TeamUI.getFilter !== 'function') {
        _missing.push('TeamUI.getFilter');
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
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
    // OPTIONAL DEPENDENCIES (lazy)
    // ============================================================

    function getTabManager() {
        return window.TabManager || null;
    }

    function getDataLoader() {
        return window.DataLoader || null;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _mounted = false;
    var _hasMountedOnce = false;
    var _providersInitialized = false;

    // ============================================================
    // PERIOD RESOLUTION
    // ============================================================

    /**
     * Current application year, or null when unavailable.
     * Uses TeamConstants.parsePeriod — the same canonical parser
     * used everywhere else in the Team domain.
     */
    function getCurrentYear() {
        var data = window.data;
        if (!data) { return null; }
        return TeamConstants.parsePeriod(data.currentYear);
    }

    /**
     * Effective period for a tab. Persisted filter year first, then
     * application year. Returns null when neither is available.
     */
    function getEffectivePeriod(tab) {
        var filter = TeamUI.getFilter(tab);
        var filtered = filter
            ? TeamConstants.parsePeriod(filter.filterYear)
            : null;
        if (filtered !== null) { return filtered; }
        return getCurrentYear();
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================

    /**
     * Assemble and inject the character provider into TeamCore.
     *
     * Idempotent from this module's perspective. TeamCore.configure
     * is first-wins globally; if another module already configured
     * it, this function returns true without doing anything.
     *
     * The provider reads from the pipeline snapshot when one is
     * supplied (the authoritative path for addMember's validate),
     * and from live state otherwise.
     */
    function initProviders() {
        if (_providersInitialized) { return true; }

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
                    for (var i = 0;
                         i < appData.characters.length; i++) {
                        var c = appData.characters[i];
                        if (c && String(c.id) === target) {
                            return true;
                        }
                    }
                    return false;
                }

                // Live fallback for callers that don't supply a
                // snapshot.
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
            console.error(
                '[TeamsModule] TeamCore.configure threw:', e
            );
            return false;
        }

        if (result !== true) {
            console.error(
                '[TeamsModule] TeamCore.configure returned ' +
                'non-true:', result
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
                    'Team data store is malformed. Please refresh.' +
                '</p>';
            return;
        }

        if (!initProviders()) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Failed to initialize team providers. ' +
                    'Please refresh.' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountTeams();
        }

        // Initialize UI state before the year check so
        // getEffectivePeriod can read the persisted filter.
        TeamUI.init();

        var currentTab = TeamUI.getCurrentTab();
        if (getEffectivePeriod(currentTab) === null) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Application year is unavailable. ' +
                    'Please check the data.' +
                '</p>';
            return;
        }

        // Bind events, then render. If either throws, tear down
        // cleanly so a partial init does not leave orphaned
        // listeners behind.
        try {
            TeamEvents.init(container);
            TeamEvents.refreshUI();
        } catch (error) {
            try { TeamEvents.destroy(); } catch (e) {}
            throw error;
        }

        _mounted = true;
        _hasMountedOnce = true;

        dispatchReady();
    }

    function unmountTeams() {
        if (!_mounted) { return; }

        TeamEvents.destroy();

        _mounted = false;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function refresh() {
        if (!_mounted) { return; }
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
            currentTab: TeamUI.getCurrentTab()
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
        var TabManager = getTabManager();
        if (!TabManager ||
            typeof TabManager.register !== 'function') {
            return false;
        }
        TabManager.register('teams', mountTeams);
        return true;
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
        var TabManager = getTabManager();
        if (!TabManager ||
            typeof TabManager.getCurrentTab !== 'function') {
            return;
        }
        if (TabManager.getCurrentTab() !== 'teams') { return; }

        var container = document.getElementById('tab-teams');
        if (container && !_mounted) {
            mountTeams(container);
        }
    }

    var DataLoader = getDataLoader();
    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data) { handleDataReady(); }
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
        initProviders: initProviders,
        mount: mountTeams,
        unmount: unmountTeams,
        refresh: refresh,
        goToTab: goToTab,
        isMounted: isMounted,
        hasMountedOnce: hasMountedOnce,
        getState: getState
    });

})();
