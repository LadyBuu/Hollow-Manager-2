/**
 * js/modules/dashboard/dashboard-render.js - Dashboard Render
 * PURE rendering functions for the dashboard
 * Path: js/modules/dashboard/dashboard-render.js
 * 
 * This module provides:
 *   - renderDashboard() - Full dashboard HTML
 *   - renderStatistics() - Statistics cards
 *   - renderQuickLinks() - Navigation quick links
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding
 *   - No data mutations
 *   - No persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 * 
 * DEPENDENCIES:
 *   - window.DashboardQueries (from dashboard-queries.js)
 *   - window.DomUtils (from dom-utils.js)
 * 
 * USAGE:
 *   var render = window.DashboardRender;
 *   var html = render.renderDashboard();
 */

(function() {
    'use strict';

    if (window.__dashboardRenderLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.DashboardQueries || typeof window.DashboardQueries.getStatistics !== 'function') {
        missing.push('DashboardQueries.getStatistics');
    }
    if (!window.DashboardQueries || typeof window.DashboardQueries.getCurrentYear !== 'function') {
        missing.push('DashboardQueries.getCurrentYear');
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardRender] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Queries = window.DashboardQueries;
    var DomUtils = window.DomUtils;

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // RENDER DASHBOARD
    // ============================================================

    /**
     * Render the complete dashboard.
     * 
     * @returns {string} HTML string
     */
    function renderDashboard() {
        var stats = Queries.getStatistics();
        var currentYear = Queries.getCurrentYear();

        var html = '';
        html += '<div class="dashboard">';

        // Header
        html += renderHeader(currentYear);

        // Statistics cards
        html += renderStatistics(stats);

        // Quick links
        html += renderQuickLinks();

        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER HEADER
    // ============================================================

    /**
     * Render the dashboard header with year selector.
     * 
     * @param {number} currentYear - Current year
     * @returns {string} HTML string
     */
    function renderHeader(currentYear) {
        var html = '';
        html += '<div class="dashboard-header">';
        html += '<h2 class="dashboard-title">Dashboard</h2>';
        html += '<div class="dashboard-year-control">';
        html += '<label class="dashboard-year-label">Current Year:</label>';
        html += '<input type="number" id="dashboard-year-input" value="' + escapeHtml(currentYear) + '" class="dashboard-year-input" min="1900" max="2100">';
        html += '<button id="dashboard-update-year-btn" class="dashboard-year-btn small primary">Update</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER STATISTICS
    // ============================================================

    /**
     * Render statistics cards.
     * 
     * @param {object} stats - Statistics object
     * @returns {string} HTML string
     */
    function renderStatistics(stats) {
        var cards = [
            {
                value: stats.totalCharacters,
                label: 'Total Characters',
                sublabel: stats.activeCharacters + ' active, ' + stats.deceasedCharacters + ' deceased',
                cssClass: 'stat-characters'
            },
            {
                value: stats.trainees,
                label: 'Trainees',
                sublabel: null,
                cssClass: 'stat-trainees'
            },
            {
                value: stats.instructors,
                label: 'Instructors',
                sublabel: null,
                cssClass: 'stat-instructors'
            },
            {
                value: stats.totalTeams,
                label: 'Teams',
                sublabel: stats.activeTeams + ' active',
                cssClass: 'stat-teams'
            },
            {
                value: stats.totalTournaments,
                label: 'Tournaments',
                sublabel: null,
                cssClass: 'stat-tournaments'
            },
            {
                value: stats.totalMissions,
                label: 'Missions',
                sublabel: stats.activeMissions + ' active',
                cssClass: 'stat-missions'
            },
            {
                value: stats.totalGraduatingClasses,
                label: 'Graduating Classes',
                sublabel: null,
                cssClass: 'stat-classes'
            }
        ];

        var html = '';
        html += '<div class="dashboard-stats">';

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            html += '<div class="stat-card ' + card.cssClass + '">';
            html += '<div class="stat-value">' + escapeHtml(card.value) + '</div>';
            html += '<div class="stat-label">' + escapeHtml(card.label) + '</div>';
            if (card.sublabel) {
                html += '<div class="stat-sublabel">' + escapeHtml(card.sublabel) + '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER QUICK LINKS
    // ============================================================

    /**
     * Render quick navigation links.
     * 
     * @returns {string} HTML string
     */
    function renderQuickLinks() {
        var links = [
            { tab: 'characters', label: 'Characters', description: 'Manage all characters' },
            { tab: 'classes', label: 'Classes', description: 'Manage graduating classes' },
            { tab: 'teams', label: 'Teams', description: 'Manage teams' },
            { tab: 'curriculum', label: 'Curriculum', description: 'Disciplines & locations' },
            { tab: 'calendar', label: 'Calendar', description: 'Schedules & timetables' },
            { tab: 'missions', label: 'Missions', description: 'Manage missions' }
        ];

        var html = '';
        html += '<div class="dashboard-quick-links">';

        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            html += '<a href="#" data-tab="' + escapeHtml(link.tab) + '" class="quick-link">';
            html += '<div class="quick-link-icon">◆</div>';
            html += '<div class="quick-link-label">' + escapeHtml(link.label) + '</div>';
            html += '<div class="quick-link-description">' + escapeHtml(link.description) + '</div>';
            html += '</a>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardRender = {
        renderDashboard: renderDashboard,
        renderHeader: renderHeader,
        renderStatistics: renderStatistics,
        renderQuickLinks: renderQuickLinks
    };

})();
