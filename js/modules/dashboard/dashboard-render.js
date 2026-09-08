/**
 * js/modules/dashboard/dashboard-render.js - Dashboard Render
 * PURE rendering functions for the dashboard
 * Path: js/modules/dashboard/dashboard-render.js
 * 
 * This module provides:
 *   - renderDashboard() - Full dashboard HTML
 *   - renderStatistics() - Statistics cards
 *   - renderQuickLinks() - Navigation quick links
 *   - renderRecentActivity() - Recent activity feed
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
    if (!window.DashboardQueries || typeof window.DashboardQueries.getRecentActivity !== 'function') {
        missing.push('DashboardQueries.getRecentActivity');
    }
    if (!window.DashboardQueries || typeof window.DashboardQueries.getQuickStats !== 'function') {
        missing.push('DashboardQueries.getQuickStats');
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
        var recentActivity = Queries.getRecentActivity(10);

        var html = '';
        html += '<div class="dashboard">';

        // Header
        html += renderHeader(currentYear);

        // Statistics cards
        html += renderStatistics(stats);

        // Recent activity
        html += renderRecentActivity(recentActivity);

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
                sublabel: stats.activeTournaments + ' active',
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
                label: 'Classes',
                sublabel: stats.totalEnrolledStudents + ' students',
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
    // RENDER RECENT ACTIVITY
    // ============================================================

    /**
     * Render recent activity feed.
     * 
     * @param {array} activities - Array of activity items
     * @returns {string} HTML string
     */
    function renderRecentActivity(activities) {
        var html = '';
        html += '<div class="dashboard-recent-activity">';
        html += '<h3 class="section-title">Recent Activity</h3>';

        if (!activities || activities.length === 0) {
            html += '<p class="empty-state">No recent activity</p>';
        } else {
            html += '<div class="activity-feed">';

            for (var i = 0; i < activities.length; i++) {
                var activity = activities[i];
                var domainLabel = activity.domain || 'unknown';
                var typeLabel = activity.type || 'activity';
                var timestamp = formatTime(activity.timestamp);

                html += '<div class="activity-item" data-domain="' + escapeHtml(domainLabel) + '">';
                html += '<div class="activity-icon">' + getDomainIcon(domainLabel) + '</div>';
                html += '<div class="activity-content">';
                html += '<div class="activity-title">' + escapeHtml(activity.title) + '</div>';
                html += '<div class="activity-meta">' + escapeHtml(typeLabel) + ' · ' + escapeHtml(timestamp) + '</div>';
                html += '</div>';
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Get a domain icon.
     * 
     * @param {string} domain - Domain name
     * @returns {string} Icon character
     */
    function getDomainIcon(domain) {
        var icons = {
            'characters': '👤',
            'teams': '👥',
            'tournaments': '🏆',
            'missions': '📋',
            'academy': '🎓'
        };
        return icons[domain] || '📌';
    }

    /**
     * Format a timestamp for display.
     * 
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Formatted time string
     */
    function formatTime(timestamp) {
        if (!timestamp) return 'Recently';
        try {
            var date = new Date(timestamp);
            if (isNaN(date.getTime())) return 'Recently';
            var now = new Date();
            var diffMs = now - date;
            var diffMins = Math.floor(diffMs / 60000);
            var diffHours = Math.floor(diffMs / 3600000);
            var diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return diffMins + 'm ago';
            if (diffHours < 24) return diffHours + 'h ago';
            if (diffDays < 7) return diffDays + 'd ago';

            return date.toLocaleDateString();
        } catch (e) {
            return 'Recently';
        }
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
            { tab: 'characters', label: 'Characters', description: 'Manage all characters', icon: '👤' },
            { tab: 'classes', label: 'Classes', description: 'Manage graduating classes', icon: '🎓' },
            { tab: 'teams', label: 'Teams', description: 'Manage teams', icon: '👥' },
            { tab: 'curriculum', label: 'Curriculum', description: 'Disciplines & locations', icon: '📚' },
            { tab: 'calendar', label: 'Calendar', description: 'Schedules & timetables', icon: '📅' },
            { tab: 'missions', label: 'Missions', description: 'Manage missions', icon: '📋' },
            { tab: 'tournaments', label: 'Tournaments', description: 'Manage tournaments', icon: '🏆' }
        ];

        var html = '';
        html += '<div class="dashboard-quick-links">';
        html += '<h3 class="section-title">Quick Links</h3>';
        html += '<div class="quick-links-grid">';

        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            html += '<a href="#" data-tab="' + escapeHtml(link.tab) + '" class="quick-link">';
            html += '<div class="quick-link-icon">' + escapeHtml(link.icon) + '</div>';
            html += '<div class="quick-link-label">' + escapeHtml(link.label) + '</div>';
            html += '<div class="quick-link-description">' + escapeHtml(link.description) + '</div>';
            html += '</a>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER EMPTY STATE
    // ============================================================

    /**
     * Render an empty state.
     * 
     * @param {string} message - Empty state message
     * @returns {string} HTML string
     */
    function renderEmptyState(message) {
        return '<p class="empty-state">' + escapeHtml(message || 'No data available') + '</p>';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardRender = {
        renderDashboard: renderDashboard,
        renderHeader: renderHeader,
        renderStatistics: renderStatistics,
        renderRecentActivity: renderRecentActivity,
        renderQuickLinks: renderQuickLinks,
        renderEmptyState: renderEmptyState,
        formatTime: formatTime,
        getDomainIcon: getDomainIcon
    };

})();
