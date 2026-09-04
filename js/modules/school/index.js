/**
 * js/modules/school/index.js - School Module Entry Point
 * Single entry point for all school structure functionality
 * Path: js/modules/school/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the school container
 *   - Managing school lifecycle
 *   - Orchestrating sub-modules
 * 
 * LIFECYCLE:
 *   TabManager registers 'school' -> mountSchool() ->
 *   SchoolTabs.init() -> render discipline/location views
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for school
 *   - All school logic lives in the sub-modules
 *   - This module does NOT implement school logic directly
 *   - It delegates to sub-modules for all operations
 *   - TabManager is the single source of truth for lifecycle
 * 
 * DEPENDENCIES:
 *   - window.SchoolTabs (from tabs/school-tabs.js)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__schoolModuleLoaded) {
        return;
    }
    window.__schoolModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var SchoolTabs = window.SchoolTabs;
    var TabManager = window.TabManager;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SchoolTabs || typeof SchoolTabs.init !== 'function') {
            missing.push('SchoolTabs.init');
        }

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (missing.length > 0) {
            console.warn('SchoolModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountSchool(container) {
        if (!container) {
            container = document.getElementById('tab-school');
        }

        if (!container) {
            console.warn('SchoolModule: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading school data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">School dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum is initialised (for disciplines and locations)
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                console.warn('SchoolModule: ensureCurriculum() failed:', e);
            }
        }

        // Initialize tabs
        SchoolTabs.init(container);
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('school', mountSchool);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    window.mountSchool = mountSchool;
    window.renderSchool = mountSchool;

})();
