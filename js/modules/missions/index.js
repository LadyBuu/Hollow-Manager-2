/**
 * js/modules/missions/index.js - Missions Module Entry Point
 * Single entry point for all mission functionality.
 * Registers with TabManager and delegates to sub-modules.
 * 
 * IMPORTANT:
 *   - This module is the ONLY external entry point for missions
 *   - All mission logic lives in the sub-modules
 *   - This module does NOT implement mission logic directly
 *   - It delegates to MissionUI for all operations
 *   - TabManager is the single source of truth for lifecycle
 *   - Missing dependencies fail visibly (no silent returns)
 * 
 * DEPENDENCIES:
 *   - MissionUI (from mission-ui.js)
 *   - MissionCore (from mission-core.js)
 *   - MissionQueries (from mission-queries.js)
 *   - MissionRender (from mission-render.js)
 *   - MissionSchema (from mission-schema.js)
 *   - MissionViews (from mission-views.js)
 *   - MissionAggregator (from mission-aggregator.js)
 *   - MissionId (from mission-id.js)
 * 
 * USAGE:
 *   // Mount the missions module
 *   window.renderMissions(container);
 * 
 *   // View a mission
 *   window.viewMission('miss_123');
 * 
 *   // Destroy the module (clean up event listeners)
 *   window.destroyMissions();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionsModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    // Primary dependency - MissionUI is the only required dependency
    // for the entry point to function. All other dependencies are
    // validated by MissionUI itself.
    if (!window.MissionUI || typeof window.MissionUI.render !== 'function') {
        missing.push('MissionUI');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsModule] Missing required dependencies: ' + missing.join(', '));
    }

    window.__missionsModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MissionUI = window.MissionUI;

    // Internal module access for debugging/development only.
    // These are not part of the public API and should not be used
    // by application code. They are exposed for diagnostic purposes.
    var _debugModules = {
        Core: window.MissionCore || null,
        Queries: window.MissionQueries || null,
        Render: window.MissionRender || null,
        Schema: window.MissionSchema || null,
        Views: window.MissionViews || null,
        Aggregator: window.MissionAggregator || null,
        Id: window.MissionId || null,
        UI: window.MissionUI || null
    };

    // ============================================================
    // PUBLIC API - Delegate to MissionUI
    // ============================================================

    /**
     * Render the missions module in the given container.
     * 
     * @param {HTMLElement} container - Container element
     * @returns {void}
     */
    function renderMissions(container) {
        MissionUI.render(container);
    }

    /**
     * View a mission by ID.
     * 
     * @param {string} id - Mission ID
     * @returns {void}
     */
    function viewMission(id) {
        MissionUI.viewMission(id);
    }

    /**
     * Close the mission detail modal.
     * 
     * @returns {void}
     */
    function closeMissionDetail() {
        MissionUI.closeMissionDetail();
    }

    /**
     * Show the mission form for creating or editing a mission.
     * 
     * @param {string} editId - Mission ID to edit (optional)
     * @returns {void}
     */
    function showMissionForm(editId) {
        MissionUI.showMissionForm(editId);
    }

    /**
     * Destroy the missions module (clean up event listeners).
     * 
     * @returns {void}
     */
    function destroyMissions() {
        MissionUI.destroy();
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    if (window.TabManager && typeof window.TabManager.register === 'function') {
        window.TabManager.register('missions', renderMissions);
    }

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    // Main render function
    window.renderMissions = renderMissions;

    // Lifecycle
    window.destroyMissions = destroyMissions;

    // Mission actions
    window.viewMission = viewMission;
    window.closeMissionDetail = closeMissionDetail;
    window.showMissionForm = showMissionForm;

    // Module access (for debugging and advanced use)
    // NOTE: These are for diagnostic purposes only.
    // Application code should use the public API functions above.
    window.MissionsModule = {
        render: renderMissions,
        destroy: destroyMissions,
        view: viewMission,
        closeDetail: closeMissionDetail,
        showForm: showMissionForm,

        // Debug access only - not intended for application use
        _debug: _debugModules
    };

})();
