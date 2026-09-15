/**
 * modules/academy/academy-ranking-view.js - Academy Ranking View
 * Standalone view for browsing class rankings.
 *
 * Path: js/modules/academy/academy-ranking-view.js
 *
 * This module is responsible for:
 *   - Rendering the class selector for rankings
 *   - Rendering the ranking table (rank, student, average, grades)
 *   - Rendering an empty state when no class is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Does NOT call AcademyQueries or AcademyRanking.
 *   - Receives a view model from AcademyAggregator.getRankingViewModel.
 *   - Does NOT bind events. Rows emit data-* attributes that
 *     AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * INTERFACE:
 *   AcademyRankingView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       classes:   [ { id, name } ],
 *       classId:   string | null,
 *       className: string | null,
 *       week:      number | null,
 *       entries:   [ <entryVM> ],
 *       total:     number
 *     }
 *
 *   entryVM:
 *     {
 *       characterId,        // string
 *       characterName,      // string
 *       rank,               // number | null
 *       rankDisplay,        // '#3' | '—'
 *       average,            // number | null
 *       averageDisplay,     // '82.5' | '—'
 *       averageBand,        // 'excellent' | 'good' | 'passing' | 'failing' | null
 *       gradeCount,         // number | null
 *       gradeCountDisplay,  // '5' | '—'
 *       isInstructor        // boolean
 *     }
 *
 *   averageBand is a PURELY VISUAL band provided by the aggregator.
 *   It is not derived from the grade scheme and does not represent
 *   pass/fail. The renderer maps the band to a CSS class; it never
 *   recomputes the band.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-ranking-class-select (change)
 *   - #academy-ranking-week-input  (change / Enter)
 *   - .academy-ranking-row [data-character-id]  (click)
 *
 * DEPENDENCIES:
 *   - window.DomUtils         (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) — week bounds
 *
 * USAGE:
 *   var html = AcademyRankingView.renderHTML(vm);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyRankingViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyRankingView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        throw new Error(
            '[AcademyRankingView] Missing mandatory dependency: ' +
            'CalendarConstants.MIN_WEEK / MAX_WEEK'
        );
    }

    window.__academyRankingViewLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function getRankBadgeClass(rank) {
        if (!isFiniteNumber(rank) || rank < 1) {
            return 'academy-rank-badge academy-rank-unknown';
        }
        if (rank === 1) return 'academy-rank-badge academy-rank-gold';
        if (rank === 2) return 'academy-rank-badge academy-rank-silver';
        if (rank === 3) return 'academy-rank-badge academy-rank-bronze';
        return 'academy-rank-badge academy-rank-default';
    }

    // averageBand is a presentation-only category supplied by the VM.
    // This function maps the band to a CSS class. It does NOT compute
    // the band — the aggregator does.
    function getAverageClass(averageBand) {
        switch (averageBand) {
            case 'excellent':
                return 'academy-ranking-average academy-ranking-average-excellent';
            case 'good':
                return 'academy-ranking-average academy-ranking-average-good';
            case 'passing':
                return 'academy-ranking-average academy-ranking-average-passing';
            case 'failing':
                return 'academy-ranking-average academy-ranking-average-failing';
            default:
                return 'academy-ranking-average academy-ranking-average-unknown';
        }
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    /**
     * Render the ranking view.
     *
     * @param {object|null} viewModel - See INTERFACE above
     * @returns {string} HTML string
     */
    function renderHTML(viewModel) {
        var vm = viewModel || {};
        var classId = vm.classId || null;

        var html = '';
        html += '<div class="academy-body academy-ranking-layout">';
        html += renderTopBar(vm);
        html += renderBody(vm, classId);
        html += '</div>';

        return html;
    }

    // ============================================================
    // TOP BAR - Class selector + Week indicator
    // ============================================================

    function renderTopBar(vm) {
        var classes = Array.isArray(vm.classes) ? vm.classes : [];
        var classId = vm.classId || null;
        var week = vm.week;

        var html = '';
        html += '<div class="academy-ranking-top-bar">';

        html += '<div class="academy-ranking-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-ranking-class-select">Class:</label>';
        html += '<select id="academy-ranking-class-select" ' +
                    'class="academy-class-select">';
        html += '<option value="">Select a class...</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name || 'Unnamed Class') +
                    '</option>';
        }

        html += '</select>';
        html += '</div>';

        html += '<div class="academy-ranking-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-ranking-week-input">Week:</label>';
        html += '<input type="number" id="academy-ranking-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' + escapeAttribute(
                        isFiniteNumber(week) ? String(week) : ''
                    ) + '" ' +
                    'min="' + escapeAttribute(String(MIN_WEEK)) + '" ' +
                    'max="' + escapeAttribute(String(MAX_WEEK)) + '">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // BODY - Table or empty state
    // ============================================================

    function renderBody(vm, classId) {
        if (!classId) {
            return (
                '<div class="academy-ranking-empty">' +
                    '<p class="empty-state small">' +
                        'Select a class to view its rankings.' +
                    '</p>' +
                '</div>'
            );
        }

        var entries = Array.isArray(vm.entries) ? vm.entries : [];
        var className = vm.className || 'Class';
        var week = vm.week;

        var html = '';
        html += '<div class="academy-ranking-panel">';

        // Header
        html += '<div class="academy-ranking-header">';
        html += '<h3 class="academy-ranking-title">' +
                    escapeHtml(className) + ' Rankings' +
                '</h3>';
        if (isFiniteNumber(week)) {
            html += '<span class="academy-ranking-subtitle">' +
                        'Week ' + escapeHtml(String(week)) +
                    '</span>';
        }
        html += '<span class="academy-ranking-count">' +
                    entries.length + ' students' +
                '</span>';
        html += '</div>';

        if (entries.length === 0) {
            html += '<p class="empty-state small">' +
                        'No rankings recorded for this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-ranking-table-wrapper">';
        html += '<table class="academy-ranking-full-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="rank-col">Rank</th>';
        html += '<th class="name-col">Student</th>';
        html += '<th class="avg-col">Average</th>';
        html += '<th class="count-col">Grades</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < entries.length; i++) {
            html += renderRankingRow(entries[i]);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderRankingRow(entry) {
        if (!entry) {
            return '';
        }

        var rankClass = getRankBadgeClass(entry.rank);
        var avgClass = getAverageClass(entry.averageBand);

        var rowClass = 'academy-ranking-row';
        if (entry.isInstructor) {
            rowClass += ' academy-ranking-row-instructor';
        }

        var html = '';
        html += '<tr class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(entry.characterId || '') + '">';

        html += '<td class="rank-col">';
        html += '<span class="' + rankClass + '">' +
                    escapeHtml(entry.rankDisplay || '\u2014') +
                '</span>';
        html += '</td>';

        html += '<td class="name-col">';
        html += '<span class="academy-ranking-name">' +
                    escapeHtml(entry.characterName || 'Unknown') +
                '</span>';
        if (entry.isInstructor) {
            html += ' <span class="academy-ranking-instructor-badge">' +
                        'Instructor' +
                    '</span>';
        }
        html += '</td>';

        html += '<td class="avg-col">';
        html += '<span class="' + avgClass + '">' +
                    escapeHtml(entry.averageDisplay || '\u2014') +
                '</span>';
        html += '</td>';

        html += '<td class="count-col">' +
                    escapeHtml(entry.gradeCountDisplay || '\u2014') +
                '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRankingView = {
        renderHTML: renderHTML
    };

})();
