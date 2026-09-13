/**
 * modules/academy/academy-ranking-view.js - Academy Ranking View
 * Standalone view for browsing class rankings
 *
 * Path: js/modules/academy/academy-ranking-view.js
 *
 * This module is responsible for:
 *   - Rendering the class selector for rankings
 *   - Rendering the ranking table (rank, student, average, grades)
 *   - Rendering an empty state when no class is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Does NOT call AcademyQueries or AcademyRanking.
 *   - Receives a view model from AcademyView
 *   - Does NOT bind events. Rows emit data-* attributes that
 *     AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * INTERFACE:
 *   AcademyRankingView.renderHTML(viewModel) -> string
 *
 *   viewModel is the shape produced by
 *   AcademyView.renderRankingView():
 *     {
 *       classes:   [ { id, name } ],       // for the class dropdown
 *       classId:   string | null,          // currently selected class
 *       className: string | null,
 *       week:      number,
 *       entries:   [ { studentId, studentName, rank, average,
 *                      gradeCount, isInstructor } ],
 *       total:     number
 *     }
 *
 *   If classId is null, an empty state renders.
 *
 * EVENTS EMITTED (via data-* attributes, for AcademyView to bind):
 *   - #academy-ranking-class-select (change)
 *   - #academy-ranking-week-input  (change)
 *   - .academy-ranking-row [data-character-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
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
    window.__academyRankingViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[AcademyRankingView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

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

    function getAverageClass(average) {
        if (!isFiniteNumber(average)) {
            return 'academy-ranking-average academy-ranking-average-unknown';
        }
        if (average >= 90) return 'academy-ranking-average academy-ranking-average-excellent';
        if (average >= 80) return 'academy-ranking-average academy-ranking-average-good';
        if (average >= 70) return 'academy-ranking-average academy-ranking-average-passing';
        return 'academy-ranking-average academy-ranking-average-failing';
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
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Ranking view dependencies not loaded.</p>' +
                '</div>'
            );
        }

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
        html += '<label class="academy-top-label">Class:</label>';
        html += '<select id="academy-ranking-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var selected = classId && String(classId) === String(cls.id) ? ' selected' : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' + selected + '>' +
                escapeHtml(cls.name || 'Unnamed Class') +
                '</option>';
        }

        html += '</select>';
        html += '</div>';

        html += '<div class="academy-ranking-top-right">';
        html += '<label class="academy-top-label">Week:</label>';
        html += '<input type="number" id="academy-ranking-week-input" ' +
            'class="academy-week-input" ' +
            'value="' + escapeAttribute(String(week || 1)) + '" ' +
            'min="1" max="52">';
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
                    '<p class="empty-state small">Select a class to view its rankings.</p>' +
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
        html += '<h3 class="academy-ranking-title">' + escapeHtml(className) + ' Rankings</h3>';
        html += '<span class="academy-ranking-subtitle">Week ' + escapeHtml(String(week || 1)) + '</span>';
        html += '<span class="academy-ranking-count">' + entries.length + ' students</span>';
        html += '</div>';

        if (entries.length === 0) {
            html += '<p class="empty-state small">No rankings recorded for this week.</p>';
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

        var rank = isFiniteNumber(entry.rank) ? entry.rank : null;
        var rankDisplay = rank !== null ? '#' + rank : '\u2014';
        var rankClass = getRankBadgeClass(rank);
        var avgClass = getAverageClass(entry.average);
        var avgDisplay = isFiniteNumber(entry.average) ? String(entry.average) : '\u2014';
        var gradeCount = isFiniteNumber(entry.gradeCount) ? entry.gradeCount : 0;

        var rowClass = 'academy-ranking-row';
        if (entry.isInstructor) {
            rowClass += ' academy-ranking-row-instructor';
        }

        var html = '';
        html += '<tr class="' + rowClass + '" ' +
                    'data-character-id="' + escapeAttribute(entry.studentId || '') + '">';

        html += '<td class="rank-col">';
        html += '<span class="' + rankClass + '">' + escapeHtml(rankDisplay) + '</span>';
        html += '</td>';

        html += '<td class="name-col">';
        html += '<span class="academy-ranking-name">' + escapeHtml(entry.studentName || 'Unknown') + '</span>';
        if (entry.isInstructor) {
            html += ' <span class="academy-ranking-instructor-badge">Instructor</span>';
        }
        html += '</td>';

        html += '<td class="avg-col">';
        html += '<span class="' + avgClass + '">' + escapeHtml(avgDisplay) + '</span>';
        html += '</td>';

        html += '<td class="count-col">' + escapeHtml(String(gradeCount)) + '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRankingView = {
        renderHTML: renderHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyRankingView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyRankingView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();