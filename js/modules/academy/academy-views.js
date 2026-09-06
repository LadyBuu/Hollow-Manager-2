/**
 * js/modules/academy/academy-views.js - Academy Views
 * UI rendering for the academy module shell
 * Path: js/modules/academy/academy-views.js
 * 
 * This module is responsible for:
 *   - Rendering the main academy container shell
 *   - Rendering academy navigation tabs
 *   - Delegating sub-tab rendering to ClassTab, StudentTab, FacultyTab
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding
 *   - No data mutations
 *   - No persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 *   - Delegates to sub-tab renderers for complex content
 *   - Consumes ACADEMY_SUBTABS from academy-constants.js
 * 
 * DEPENDENCIES:
 *   - window.AcademyConstants (from academy-constants.js)
 *   - window.ClassTab (from tabs/class-tab.js)
 *   - window.StudentTab (from tabs/student-tab.js)
 *   - window.FacultyTab (from tabs/faculty-tab.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyViewsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyConstants = window.AcademyConstants;
    var ClassTab = window.ClassTab;
    var StudentTab = window.StudentTab;
    var FacultyTab = window.FacultyTab;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyConstants || !Array.isArray(AcademyConstants.ACADEMY_SUBTABS)) {
            missing.push('AcademyConstants.ACADEMY_SUBTABS');
        }

        if (!ClassTab || typeof ClassTab.render !== 'function') {
            missing.push('ClassTab.render');
        }

        if (!StudentTab || typeof StudentTab.render !== 'function') {
            missing.push('StudentTab.render');
        }

        if (!FacultyTab || typeof FacultyTab.render !== 'function') {
            missing.push('FacultyTab.render');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            throw new Error('AcademyViews: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // ACADEMY SHELL RENDERER
    // ============================================================

    /**
     * Render the Academy shell (header + tabs + content placeholder).
     * Sub-tab content is rendered separately by renderActiveSubTab.
     * 
     * @param {object} state - Academy UI state
     * @returns {string} HTML string
     */
    function renderAcademyShell(state) {
        var activeSubTab = state.activeSubTab || 'class';

        var html = '';

        // Header
        html += '<div class="academy-header">';
        html += '<h2>Academic Year</h2>';
        html += '<div class="academy-header-actions">';
        html += '<button id="academy-refresh-btn" class="small secondary">↻ Refresh</button>';
        html += '</div>';
        html += '</div>';

        // Tabs
        html += renderAcademyTabs(activeSubTab);

        // Content container
        html += '<div id="academy-subtab-content">';
        html += '<!-- Sub-tab content will be rendered here -->';
        html += '</div>';

        return html;
    }

    // ============================================================
    // ACADEMY TABS RENDERER
    // ============================================================

    /**
     * Render Academy navigation tabs.
     * Consumes ACADEMY_SUBTABS from AcademyConstants.
     * 
     * @param {string} activeSubTab - Currently active tab ID
     * @returns {string} HTML string
     */
    function renderAcademyTabs(activeSubTab) {
        activeSubTab = activeSubTab || 'class';
        var tabs = AcademyConstants.ACADEMY_SUBTABS;

        var html = '';
        html += '<div class="academy-tab-nav">';

        for (var i = 0; i < tabs.length; i++) {
            var tab = tabs[i];
            var isActive = tab.id === activeSubTab;
            html += '<button class="tab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeHtml(tab.id) + '">' + escapeHtml(tab.label) + '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // ACTIVE SUB-TAB RENDERER
    // ============================================================

    /**
     * Render the active sub-tab content.
     * Delegates to ClassTab, StudentTab, or FacultyTab.
     * 
     * @param {object} state - Academy UI state
     * @returns {string} HTML string
     */
    function renderActiveSubTab(state) {
        var activeSubTab = state.activeSubTab || 'class';

        switch (activeSubTab) {
            case 'class':
                return ClassTab.render(state);
            case 'student':
                return StudentTab.render(state);
            case 'faculty':
                return FacultyTab.render(state);
            default:
                return '<p class="empty-state">Unknown sub-tab: ' + escapeHtml(activeSubTab) + '</p>';
        }
    }

    // ============================================================
    // COMPLETE ACADEMY RENDERER
    // ============================================================

    /**
     * Render the complete Academy UI.
     * Combines shell and active sub-tab content.
     * 
     * @param {object} state - Academy UI state
     * @returns {string} HTML string
     */
    function renderAcademy(state) {
        var html = renderAcademyShell(state);

        // Inject active sub-tab content into placeholder
        // Note: This is a string replacement, not DOM manipulation
        var subTabHtml = renderActiveSubTab(state);
        html = html.replace('<!-- Sub-tab content will be rendered here -->', subTabHtml);

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyViews = {
        // Complete render
        renderAcademy: renderAcademy,

        // Shell renderers
        renderAcademyShell: renderAcademyShell,
        renderAcademyTabs: renderAcademyTabs,

        // Sub-tab renderer
        renderActiveSubTab: renderActiveSubTab,

        // HTML utilities
        escapeHtml: escapeHtml
    };

})();