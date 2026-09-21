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
 *
 * WHAT DOES NOT BELONG HERE:
 *   - Reading window.data
 *   - Calling domain queries
 *   - Computing statistics
 *   - Resolving character names or domain references
 *
 * ICON VOCABULARY:
 *   Icons in this module are monochrome Unicode glyphs, not emoji.
 *   Emoji do not render consistently across platforms, cannot be
 *   styled with a single color, and lose meaning in text contexts
 *   (console, activity log, tooltip). The glyphs chosen here are
 *   from the Miscellaneous Symbols, Miscellaneous Technical, and
 *   Arrows blocks — the same blocks already used elsewhere in the
 *   application for decorative glyphs (▸ ▾ ✓ ✕ † ⚑).
 *
 * QUICK LINKS:
 *   The link list is Dashboard presentation configuration. It is
 *   not derived from data, so it lives here rather than in the
 *   aggregator. Every link must point at a tab that exists in the
 *   application's main navigation. The list is:
 *
 *     Characters   characters
 *     Teams        teams
 *     Social       social
 *     Academy      academy
 *     Missions     missions
 *
 *   Adding a link for a tab that does not exist produces a dead
 *   navigation target. The renderer does not validate the tab id;
 *   the caller (or the test suite) is responsible for keeping the
 *   list in sync with the navigation.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
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

    if (missing.length > 0) {
        throw new Error('[DashboardRender] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

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

    // ============================================================
    // ICON VOCABULARY
    // ============================================================
    //
    // Monochrome Unicode glyphs. See the module header for the
    // rationale and the block each glyph is drawn from.
    //
    // Every glyph here renders as a single-color mark in the
    // application's font stack and does not fall back to a color
    // emoji on any platform.

    var ICONS = Object.freeze({
        characters: '\u263A',   // ☺  white smiling face (U+263A)
        teams:      '\u2637',   // ☷  trigram for earth  (U+2637)
        social:     '\u221E',   // ∞  infinity           (U+221E)
        academy:    '\u2630',   // ☰  trigram for heaven (U+2630)
        missions:   '\u2691'    // ⚑  black flag         (U+2691)
    });

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
    // QUICK LINKS
    // ============================================================
    //
    // The link list is Dashboard presentation configuration. It is
    // not derived from data, so it lives here rather than in the
    // aggregator.
    //
    // Every link's `tab` must be the id of a tab that exists in the
    // application's main navigation. The current navigation has
    // six tabs:
    //
    //     dashboard    characters    teams
    //     social       academy       missions
    //
    // The dashboard does not link to itself, so the quick-link
    // list is the other five. This list is the single source of
    // truth for dashboard navigation; adding a link for a tab that
    // does not exist produces a dead navigation target.

    function renderQuickLinks() {
        var links = [
            {
                tab: 'characters',
                label: 'Characters',
                description: 'Manage all characters',
                icon: ICONS.characters
            },
            {
                tab: 'teams',
                label: 'Teams',
                description: 'Manage teams',
                icon: ICONS.teams
            },
            {
                tab: 'social',
                label: 'Social',
                description: 'Manage relationships',
                icon: ICONS.social
            },
            {
                tab: 'academy',
                label: 'Academy',
                description: 'Classes, disciplines, exams',
                icon: ICONS.academy
            },
            {
                tab: 'missions',
                label: 'Missions',
                description: 'Manage missions',
                icon: ICONS.missions
            }
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
        renderQuickLinks: renderQuickLinks,
        renderEmptyState: renderEmptyState,
        formatStatValue: formatStatValue
    };

})();
