/**
 * js/modules/dashboard/dashboard-render.js - Dashboard Render
 * Pure rendering functions for the dashboard
 * 
 * Path: js/modules/dashboard/dashboard-render.js
 * 
 * This module provides:
 *   - renderDashboard(viewModel) - Complete dashboard HTML
 *   - renderHeader(currentYear) - Year selector
 *   - renderStatistics(statistics) - Statistics cards
 *   - renderRecentActivity(activities) - Activity feed
 *   - renderQuickLinks() - Navigation quick links
 *   - renderEmptyState(message) - Empty state
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding
 *   - No data mutations
 *   - No persistence calls
 *   - No queries called from here - the renderer receives a view model
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 *   - The renderer returns HTML strings; it does not touch the DOM
 * 
 * WHAT BELONGS HERE:
 *   - HTML generation from the view model
 *   - Presentational decisions (card layout, labels, icons)
 *   - Relative time formatting (via FormatUtils)
 * 
 * WHAT DOES NOT BELONG HERE:
 *   - Reading window.data
 *   - Calling domain queries
 *   - Computing statistics
 *   - Resolving character names or domain references
 * 
 * RECENT ACTIVITY:
 *   Activity entries are rendered as-is from ActivityLog:
 *     { id, message, type, timestamp, metadata }
 *   The renderer uses `message`, `type`, and `timestamp` only.
 *   It does NOT reconstruct meaning from `metadata` and does NOT
 *   resolve referenced entities.
 * 
 * DEPENDENCIES:
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.FormatUtils (from format-utils.js) - MANDATORY
 *     (requires FormatUtils.formatRelativeTime)
 * 
 * USAGE:
 *   var html = DashboardRender.renderDashboard(viewModel);
 */

(function() {
    'use strict';

    if (window.__dashboardRenderLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - FAIL LOUDLY
    // ============================================================

    var missing = [];

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }
    if (!window.FormatUtils || typeof window.FormatUtils.formatRelativeTime !== 'function') {
        missing.push('FormatUtils.formatRelativeTime');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardRender] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var FormatUtils = window.FormatUtils;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Escape a value for safe insertion into HTML.
     * Delegates to DomUtils.escapeHtml for consistency across the app.
     * 
     * @param {*} value - Value to escape
     * @returns {string} Escaped string
     */
    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    /**
     * Format an ISO timestamp as a relative time string.
     * Delegates to FormatUtils.formatRelativeTime.
     * 
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Relative time string
     */
    function formatTime(timestamp) {
        return FormatUtils.formatRelativeTime(timestamp);
    }

    /**
     * Get an icon for an activity log entry type.
     * 
     * ActivityLog types are the standard notification types:
     *   'info', 'success', 'warning', 'error'
     * 
     * @param {string} type - Activity type
     * @returns {string} Icon character
     */
    function getActivityIcon(type) {
        var icons = {
            'success': '✓',
            'error': '✕',
            'warning': '⚠',
            'info': 'ℹ'
        };
        return icons[type] || '📌';
    }

    // ============================================================
    // TOP-LEVEL RENDER
    // ============================================================

    /**
     * Render the complete dashboard.
     * 
     * @param {object} viewModel - Dashboard view model from DashboardAggregator
     * @returns {string} HTML string
     */
    function renderDashboard(viewModel) {
        if (!viewModel) {
            return renderEmptyState('No dashboard data available');
        }

        var html = '';
        html += '<div class="dashboard">';
        html += renderHeader(viewModel.currentYear);
        html += renderStatistics(viewModel.statistics);
        html += renderRecentActivity(viewModel.recentActivity);
        html += renderQuickLinks();
        html += '</div>';
        return html;
    }

    // ============================================================
    // HEADER
    // ============================================================

    /**
     * Render the dashboard header with year selector.
     * 
     * @param {number} currentYear - Current application year
     * @returns {string} HTML string
     */
    function renderHeader(currentYear) {
        var html = '';
        html += '<div class="dashboard-header">';
        html += '<h2 class="dashboard-title">Dashboard</h2>';
        html += '<div class="dashboard-year-control">';
        html += '<label for="dashboard-year-input" class="dashboard-year-label">Current Year:</label>';
        html += '<input type="number" id="dashboard-year-input" ';
        html += 'value="' + escapeHtml(currentYear) + '" ';
        html += 'class="dashboard-year-input" ';
        html += 'min="1900" max="2100" ';
        html += 'aria-label="Current application year">';
        html += '<button id="dashboard-update-year-btn" class="dashboard-year-btn small primary">Update</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // STATISTICS
    // ============================================================

    /**
     * Render statistics cards.
     * 
     * Cards reflect the view model's statistics object. If a value is
     * missing, the card shows '--' rather than a fabricated zero.
     * 
     * @param {object} stats - Statistics object from the aggregator
     * @returns {string} HTML string
     */
    function renderStatistics(stats) {
        if (!stats) {
            return '';
        }

        var cards = [
            {
                value: stats.totalCharacters,
                label: 'Total Characters',
                sublabel: stats.deceasedCharacters + ' deceased',
                cssClass: 'stat-characters'
            },
            {
                value: stats.students,
                label: 'Students',
                sublabel: null,
                cssClass: 'stat-students'
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
                value: stats.totalClasses,
                label: 'Classes',
                sublabel: null,
                cssClass: 'stat-classes'
            }
        ];

        var html = '';
        html += '<div class="dashboard-stats">';

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            html += '<div class="stat-card ' + card.cssClass + '">';
            html += '<div class="stat-value">' + formatStatValue(card.value) + '</div>';
            html += '<div class="stat-label">' + escapeHtml(card.label) + '</div>';
            if (card.sublabel) {
                html += '<div class="stat-sublabel">' + escapeHtml(card.sublabel) + '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Format a statistic value for display.
     * Handles undefined/null by returning '--'.
     * 
     * @param {*} value - Statistic value
     * @returns {string} Formatted value
     */
    function formatStatValue(value) {
        if (value === undefined || value === null) {
            return '--';
        }
        if (typeof value === 'number' && !isFinite(value)) {
            return '--';
        }
        return escapeHtml(value);
    }

    // ============================================================
    // RECENT ACTIVITY
    // ============================================================

    /**
     * Render the recent activity feed.
     * 
     * Activity entries are rendered as-is from ActivityLog:
     *   - `message` is the human-readable text
     *   - `type` drives the icon
     *   - `timestamp` is formatted via FormatUtils.formatRelativeTime
     * 
     * The renderer does NOT:
     *   - Reconstruct titles from metadata
     *   - Resolve referenced characters/teams/tournaments
     *   - Interpret activity beyond its message and type
     * 
     * @param {array} activities - Array of ActivityLog entries
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
                if (!activity || typeof activity !== 'object') {
                    continue;
                }

                var type = activity.type || 'info';
                var message = activity.message || '';
                var timestamp = activity.timestamp ? formatTime(activity.timestamp) : '';
                var icon = getActivityIcon(type);

                html += '<div class="activity-item activity-type-' + escapeHtml(type) + '">';
                html += '<div class="activity-icon" aria-hidden="true">' + icon + '</div>';
                html += '<div class="activity-content">';
                html += '<div class="activity-message">' + escapeHtml(message) + '</div>';
                if (timestamp) {
                    html += '<div class="activity-timestamp">' + escapeHtml(timestamp) + '</div>';
                }
                html += '</div>';
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // QUICK LINKS
    // ============================================================

    /**
     * Render quick navigation links.
     * 
     * The link list is Dashboard presentation configuration.
     * It is not derived from data, so it lives here rather than
     * in the aggregator.
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
            html += '<div class="quick-link-icon" aria-hidden="true">' + escapeHtml(link.icon) + '</div>';
            html += '<div class="quick-link-label">' + escapeHtml(link.label) + '</div>';
            html += '<div class="quick-link-description">' + escapeHtml(link.description) + '</div>';
            html += '</a>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    /**
     * Render an empty state message.
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
        formatStatValue: formatStatValue,
        getActivityIcon: getActivityIcon
    };

})();
