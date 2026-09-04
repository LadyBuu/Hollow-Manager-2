/**
 * js/modules/missions/index.js - Missions Module Entry Point
 * Single entry point for all mission functionality.
 * Registers with TabManager and delegates to sub-modules.
 * 
 * IMPORTANT:
 *   - This module is the ONLY external entry point for missions
 *   - All mission logic lives in the sub-modules
 *   - This module does NOT implement mission logic directly
 *   - It delegates to sub-modules for all operations
 *   - TabManager is the single source of truth for lifecycle
 * 
 * DEPENDENCIES:
 *   - MissionsUI (from missions-ui.js)
 *   - MissionsCore (from missions-core.js)
 *   - MissionsQueries (from missions-queries.js)
 *   - MissionsRender (from missions-render.js)
 *   - MissionsSchema (from missions-schema.js)
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

    if (!window.MissionsUI || typeof window.MissionsUI.render !== 'function') {
        return;
    }

    if (!window.MissionsCore) {
        return;
    }

    if (!window.MissionsQueries) {
        return;
    }

    if (!window.MissionsRender) {
        return;
    }

    if (!window.MissionsSchema) {
        return;
    }

    window.__missionsModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MissionsUI = window.MissionsUI;
    var MissionsCore = window.MissionsCore;
    var MissionsQueries = window.MissionsQueries;
    var MissionsRender = window.MissionsRender;
    var MissionsSchema = window.MissionsSchema;

    // ============================================================
    // PUBLIC API - Delegate to MissionsUI
    // ============================================================

    /**
     * Render the missions module in the given container.
     * @param {HTMLElement} container - Container element
     */
    function renderMissions(container) {
        MissionsUI.render(container);
    }

    /**
     * View a mission by ID.
     * @param {string} id - Mission ID
     */
    function viewMission(id) {
        MissionsUI.viewMission(id);
    }

    /**
     * Close the mission detail modal.
     */
    function closeMissionDetail() {
        MissionsUI.closeMissionDetail();
    }

    /**
     * Show the mission form for creating or editing a mission.
     * @param {string} editId - Mission ID to edit (optional)
     */
    function showMissionForm(editId) {
        MissionsUI.showMissionForm(editId);
    }

    /**
     * Destroy the missions module (clean up event listeners).
     */
    function destroyMissions() {
        MissionsUI.destroy();
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
    window.MissionsModule = {
        render: renderMissions,
        destroy: destroyMissions,
        viewMission: viewMission,
        closeMissionDetail: closeMissionDetail,
        showMissionForm: showMissionForm,

        // Sub-module access (read-only)
        Core: MissionsCore,
        Queries: MissionsQueries,
        Render: MissionsRender,
        Schema: MissionsSchema,
        UI: MissionsUI
    };

})();
