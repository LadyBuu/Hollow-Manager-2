/**
 * js/modules/dashboard/index.js - Dashboard Module Entry Point
 * Single entry point for the Dashboard module
 * 
 * Path: js/modules/dashboard/index.js
 * 
 * This module provides:
 *   - TabManager registration
 *   - Public API for dashboard mounting/refresh
 * 
 * IMPORTANT:
 *   - This is the only external entry point for the Dashboard
 *   - It delegates all logic to DashboardUI
 *   - It does NOT implement dashboard logic directly
 *   - TabManager is the single source of truth for lifecycle
 * 
 * LIFECYCLE:
 *   - On load, this module registers the 'dashboard' tab with TabManager
 *   - TabManager calls DashboardUI.render(container) when the tab is shown
 *   - TabManager does not automatically call DashboardUI.destroy();
 *     the UI cleans up its own listeners on every render
 * 
 * DEPENDENCIES:
 *   - window.DashboardUI (from dashboard-ui.js)
 *   - window.TabManager (from tab-manager.js)
 * 
 * PUBLIC API:
 *   window.renderDashboard(container) - Render the dashboard
 *   window.destroyDashboard() - Tear down the dashboard
 *   window.DashboardModule - Module namespace with the same operations
 */

(function() {
    'use strict';

    if (window.__dashboardModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - FAIL LOUDLY
    // ============================================================

    var missing = [];

    if (!window.DashboardUI || typeof window.DashboardUI.render !== 'function') {
        missing.push('DashboardUI.render');
    }
    if (!window.DashboardUI || typeof window.DashboardUI.destroy !== 'function') {
        missing.push('DashboardUI.destroy');
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
     * Render the dashboard into the given container.
     * If no container is provided, DashboardUI will look up
     * the canonical '#tab-dashboard' element.
     * 
     * @param {HTMLElement} [container] - Container element
     */
    function renderDashboard(container) {
        DashboardUI.render(container);
    }

    /**
     * Tear down the dashboard.
     * Removes event listeners and clears state.
     */
    function destroyDashboard() {
        DashboardUI.destroy();
    }

    /**
     * Check whether the dashboard is currently mounted.
     * 
     * @returns {boolean} True if mounted
     */
    function isDashboardMounted() {
        return DashboardUI.isMounted();
    }

    /**
     * Get the current dashboard container.
     * 
     * @returns {HTMLElement|null} Container or null
     */
    function getDashboardContainer() {
        return DashboardUI.getContainer();
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

    window.DashboardModule = {
        render: renderDashboard,
        destroy: destroyDashboard,
        isMounted: isDashboardMounted,
        getContainer: getDashboardContainer
    };

})();
