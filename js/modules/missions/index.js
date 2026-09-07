/**
 * js/modules/missions/index.js - Missions Module Entry Point
 * Single entry point for all mission functionality.
 * Registers with TabManager and delegates to sub-modules.
 * 
 * IMPORTANT:
 *   - This module is the ONLY external entry point for missions
 *   - All mission logic lives in the sub-modules
 *   - This module does NOT implement mission logic directly
 *   - It delegates to MissionsUI for all operations
 *   - TabManager is the single source of truth for lifecycle
 *   - Missing dependencies fail visibly (no silent returns)
 * 
 * DEPENDENCIES:
 *   - MissionsUI (from missions-ui.js)
 *   - MissionsCore (from missions-core.js)
 *   - MissionsQueries (from missions-queries.js)
 *   - MissionsRender (from missions-render.js)
 *   - MissionsSchema (from missions-schema.js)
 *   - MissionViews (from mission-views.js)
 *   - MissionRules (from mission-rules.js)
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

    // Primary dependency - MissionsUI is the only required dependency
    // for the entry point to function. All other dependencies are
    // validated by MissionsUI itself.
    if (!window.MissionsUI || typeof window.MissionsUI.render !== 'function') {
        missing.push('MissionsUI');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsModule] Missing required dependencies: ' + missing.join(', '));
    }

    window.__missionsModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MissionsUI = window.MissionsUI;

    // Internal module access for debugging/development only.
    // These are not part of the public API and should not be used
    // by application code. They are exposed for diagnostic purposes.
    var _debugModules = {
        Core: window.MissionsCore || null,
        Queries: window.MissionsQueries || null,
        Render: window.MissionsRender || null,
        Schema: window.MissionsSchema || null,
        Views: window.MissionViews || null,
        Rules: window.MissionRules || null,
        Id: window.MissionId || null,
        UI: window.MissionsUI || null
    };

    // ============================================================
    // PUBLIC API - Delegate to MissionsUI
    // ============================================================

    /**
     * Render the missions module in the given container.
     * 
     * @param {HTMLElement} container - Container element
     * @returns {void}
     */
    function renderMissions(container) {
        MissionsUI.render(container);
    }

    /**
     * View a mission by ID.
     * 
     * @param {string} id - Mission ID
     * @returns {void}
     */
    function viewMission(id) {
        MissionsUI.view(id);
    }

    /**
     * Close the mission detail modal.
     * 
     * @returns {void}
     */
    function closeMissionDetail() {
        MissionsUI.closeDetail();
    }

    /**
     * Show the mission form for creating or editing a mission.
     * 
     * @param {string} editId - Mission ID to edit (optional)
     * @returns {void}
     */
    function showMissionForm(editId) {
        MissionsUI.showForm(editId);
    }

    /**
     * Destroy the missions module (clean up event listeners).
     * 
     * @returns {void}
     */
    function destroyMissions() {
        MissionsUI.destroy();
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
