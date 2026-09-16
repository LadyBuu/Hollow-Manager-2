/**
 * js/modules/missions/index.js - Missions Module Entry Point
 *
 * Path: js/modules/missions/index.js
 *
 * Registration and lifecycle entry point for the missions module.
 *
 * WHAT THIS MODULE OWNS:
 *   - Registering the missions tab with TabManager.
 *   - Delegating every public API call to MissionUI.
 *   - Exposing a small, stable public surface on window.Missions
 *     and legacy global functions for callers that still use them.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - Any mission logic. That lives in MissionUI and below.
 *   - Any rendering. That lives in MissionRender.
 *   - Any state. That lives in MissionUI.
 *   - Any domain reads or writes. That lives in MissionQueries and
 *     MissionCore.
 *
 * DESIGN NOTES:
 *   - MissionUI is the single mandatory dependency. Every other
 *     module in the missions stack is validated at its own load
 *     time and would have already thrown if it were missing. This
 *     entry point does not attempt to re-validate the whole graph.
 *   - TabManager is mandatory here. The missions tab cannot
 *     function without a tab to register with, and hiding the
 *     failure would mean the tab silently never appears.
 *   - The public API is deliberately small: mount, destroy, and
 *     the four actions that the rest of the application calls
 *     (view, close, showForm, refresh). Anything else is reachable
 *     through MissionUI.
 *
 * LIFECYCLE:
 *   - On load, this module registers with TabManager.
 *   - TabManager calls the registered render function when the
 *     user switches to the missions tab.
 *   - destroy() is called by TabManager (or by the caller) when the
 *     tab is torn down. It delegates to MissionUI.destroy(), which
 *     removes listeners and clears UI state.
 *
 * LOAD ORDER:
 *   - mission-constants.js
 *   - mission-id.js
 *   - mission-schema.js
 *   - mission-rules.js
 *   - mission-queries.js
 *   - mission-cascade.js
 *   - mission-core.js
 *   - mission-views.js
 *   - mission-render.js
 *   - mission-aggregator.js
 *   - mission-ui.js
 *   - index.js   (this file)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TabManager
 *   - window.MissionUI
 */

(function() {
    'use strict';

    if (window.__missionsModuleLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCY CHECK
    // ============================================================

    var missing = [];

    if (!window.TabManager ||
        typeof window.TabManager.register !== 'function') {
        missing.push('TabManager.register');
    }

    if (!window.MissionUI) {
        missing.push('MissionUI (module)');
    } else {
        if (typeof window.MissionUI.render !== 'function') {
            missing.push('MissionUI.render');
        }
        if (typeof window.MissionUI.destroy !== 'function') {
            missing.push('MissionUI.destroy');
        }
    }

    if (missing.length > 0) {
        throw new Error(
            '[MissionsModule] Missing mandatory dependencies: ' +
            missing.join(', ')
        );
    }

    window.__missionsModuleLoaded = true;

    // ============================================================
    // SHORTHAND IMPORTS
    // ============================================================

    var TabManager = window.TabManager;
    var MissionUI = window.MissionUI;

    // ============================================================
    // PUBLIC API - delegates to MissionUI
    // ============================================================

    /**
     * Mount the missions view into the given container. Called by
     * TabManager when the missions tab is activated, and callable
     * directly by callers that want to render the view into a
     * different host.
     *
     * @param {HTMLElement} container
     */
    function renderMissions(container) {
        MissionUI.render(container);
    }

    /**
     * Tear down the missions view. Removes listeners and clears
     * controller state. Called by TabManager when the tab is torn
     * down, and callable directly.
     */
    function destroyMissions() {
        MissionUI.destroy();
    }

    /**
     * Refresh the missions list from current data.
     *
     * The controller does not expose an explicit refresh on its
     * public surface; the standard pattern is to re-render the tab.
     * This is a thin re-render for callers that need to force it.
     */
    function refreshMissions() {
        var container = document.getElementById('tab-missions');
        if (container) {
            MissionUI.render(container);
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================
    //
    // Single lifecycle path. The application shell activates the
    // tab; TabManager calls renderMissions with the tab container.

    TabManager.register('missions', renderMissions);

    // ============================================================
    // EXPOSE
    // ============================================================
    //
    // Two surfaces:
    //
    //   window.Missions
    //     The forward-looking namespace. New callers use this.
    //
    //   window.renderMissions / destroyMissions
    //     Legacy globals. Kept because existing callers use them.
    //     Both delegate to the same functions as window.Missions.
    //
    // The two surfaces are intentionally identical. When legacy
    // callers are migrated, the globals can be removed.

    window.Missions = Object.freeze({
        mount: renderMissions,
        destroy: destroyMissions,
        refresh: refreshMissions
    });

    // Legacy globals.
    window.renderMissions = renderMissions;
    window.destroyMissions = destroyMissions;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.Missions;
        var missing = [];

        var required = ['mount', 'destroy', 'refresh'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push('Missions.' + required[i]);
            }
        }

        if (typeof window.renderMissions !== 'function') {
            missing.push('window.renderMissions');
        }
        if (typeof window.destroyMissions !== 'function') {
            missing.push('window.destroyMissions');
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionsModule] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
