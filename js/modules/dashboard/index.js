/**
 * js/modules/dashboard/index.js - Dashboard Module Entry Point
 * Single entry point for all dashboard functionality
 * Path: js/modules/dashboard/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the dashboard container
 *   - Managing dashboard lifecycle
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for dashboard
 *   - All dashboard logic lives in the sub-modules
 *   - This module does NOT implement dashboard logic directly
 *   - It delegates to DashboardUI for all operations
 *   - TabManager is the single source of truth for lifecycle
 *   - Dashboard is the LAST module to load - all upstream domains must be available
 * 
 * DEPENDENCIES:
 *   - window.DashboardUI (from dashboard-ui.js)
 *   - window.TabManager (from tab-manager.js)
 * 
 * USAGE:
 *   // Mount the dashboard module
 *   window.renderDashboard(container);
 * 
 *   // Destroy the module (clean up event listeners)
 *   window.destroyDashboard();
 */

(function() {
    'use strict';

    if (window.__dashboardModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.DashboardUI || typeof window.DashboardUI.render !== 'function') {
        missing.push('DashboardUI');
    }

    if (!window.TabManager || typeof window.TabManager.register !== 'function') {
        missing.push('TabManager.register');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardModule] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DashboardUI = window.DashboardUI;
    var TabManager = window.TabManager;

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Render the dashboard module in the given container.
     * 
     * @param {HTMLElement} container - Container element
     * @returns {void}
     */
    function renderDashboard(container) {
        DashboardUI.render(container);
    }

    /**
     * Destroy the dashboard module (clean up event listeners).
     * 
     * @returns {void}
     */
    function destroyDashboard() {
        DashboardUI.destroy();
    }

    /**
     * Update the dashboard statistics.
     * 
     * @returns {void}
     */
    function updateDashboardStats() {
        if (DashboardUI.isMounted && DashboardUI.isMounted()) {
            renderDashboard(DashboardUI.getContainer());
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    TabManager.register('dashboard', renderDashboard);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderDashboard = renderDashboard;
    window.destroyDashboard = destroyDashboard;
    window.updateDashboardStats = updateDashboardStats;

    // Module access
    window.DashboardModule = {
        render: renderDashboard,
        destroy: destroyDashboard,
        updateStats: updateDashboardStats
    };

})();
