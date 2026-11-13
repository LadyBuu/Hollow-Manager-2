/**
 * js/modules/dashboard/dashboard-render.js - Dashboard Render
 *
 * Path: js/modules/dashboard/dashboard-render.js
 *
 * RENDER ONLY. No event binding, no mutations, no queries.
 *
 * E1 addition: renderHeader now optionally emits a
 * "Import calendar…" / "Replace calendar…" button and a hidden
 * file input, when the view model says `canImportCalendar` is
 * true. DashboardUI wires the button; the renderer just emits
 * the markup. When the flag is false the button is absent and
 * the header is exactly as before.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
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

    var DomUtils = window.DomUtils;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // ICON VOCABULARY
    // ============================================================

    var ICONS = Object.freeze({
        characters: '\u263A',
        teams:      '\u2637',
        social:     '\u221E',
        academy:    '\u2630',
        missions:   '\u2691'
    });

    // ============================================================
    // TOP-LEVEL RENDER
    // ============================================================

    function renderDashboard(viewModel) {
        if (!viewModel) {
            return renderEmptyState('No dashboard data available');
        }

        var html = '';
        html += '<div class="dashboard">';
        html += renderHeader(
            viewModel.currentYear,
            viewModel.canImportCalendar === true,
            viewModel.hasCustomCalendar === true
        );
        html += renderStatistics(viewModel.statistics);
        html += renderQuickLinks();
        html += '</div>';
        return html;
    }

    // ============================================================
    // HEADER
    // ============================================================

    function renderHeader(currentYear, canImportCalendar, hasCustomCalendar) {
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

        if (canImportCalendar === true) {
            // Sits beside the year control on the same row. The
            // label flips when a calendar is already set, so the
            // user can tell whether they're importing for the
            // first time or replacing.
            var label = hasCustomCalendar
                ? 'Replace calendar\u2026'
                : 'Import calendar\u2026';
            html += '<button id="dashboard-import-calendar-btn" ' +
                        'class="small secondary dashboard-calendar-btn" ' +
                        'type="button" ' +
                        'title="Import a project calendar from a ' +
                            'Story Organiser JSON export">' +
                        escapeHtml(label) +
                    '</button>';
            html += '<input type="file" id="dashboard-calendar-input" ' +
                        'accept=".json,application/json" hidden>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // STATISTICS (unchanged)
    // ============================================================

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
    // QUICK LINKS (unchanged)
    // ============================================================

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
    // EMPTY STATE (unchanged)
    // ============================================================

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
