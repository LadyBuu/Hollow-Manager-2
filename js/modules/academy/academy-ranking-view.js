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
 * VM CONTRACT:
 *   The renderer TRUSTS the VM. It does not defend against a
 *   malformed VM by silently substituting defaults; a broken VM is
 *   a bug in the aggregator and should surface as a thrown error,
 *   not as a table that quietly claims fewer students than exist.
 *
 *   {{
 *     classes:   [ { id, name } ],      // guaranteed array
 *     classId:   string | null,
 *     className: string | null,
 *     week:      number | null,
 *     entries:   [ <entryVM> ],         // guaranteed array
 *     total:     number                 // guaranteed integer
 *   }}
 *
 *   entryVM:
 *   {
 *     characterId,        // string
 *     characterName,      // string
 *     rank,               // number | null
 *     rankDisplay,        // string ('#3' | '—')
 *     average,            // number | null
 *     averageDisplay,     // string ('82.5' | '—')
 *     averageBand,        // 'excellent' | 'good' | 'passing' | 'failing' | null
 *     gradeCount,         // number | null
 *     gradeCountDisplay,  // string ('5' | '—')
 *     isInstructor        // boolean
 *   }
 *
 *   `averageBand` is a PURELY VISUAL band provided by the aggregator.
 *   It is not derived from the grade scheme and does not represent
 *   pass/fail. The renderer maps the band to a CSS class; it never
 *   recomputes the band. When the aggregator supplies a band that is
 *   not one of the four known values, the renderer THROWS. Unknown
 *   values are not silently styled as neutral.
 *
 * STABILITY OF THE VM SHAPE:
 *   If the aggregator is changed to emit a VM missing a required
 *   field, this renderer will throw with a message naming the
 *   field. That is the intended failure mode. A renderer that
 *   substitutes `[]` for a missing array turns "the aggregator is
 *   broken" into "there are no classes", which is the exact bug
 *   this contract exists to prevent.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-ranking-class-select (change)
 *   - #academy-ranking-week-input  (change / Enter)
 *   - .academy-ranking-row [data-character-id]  (click, delegated)
 *   - .academy-ranking-name-btn [data-character-id]  (click; also
 *     the keyboard-accessible entry point for the same action)
 *
 * ACCESSIBILITY:
 *   The row is not a control. It does not carry role="button" or
 *   tabindex. The character's name is rendered as a real <button>
 *   inside the name cell; keyboard users can Tab to it and press
 *   Enter or Space to open the character in the People view. The
 *   row's delegated click handler continues to catch clicks
 *   anywhere on the row for mouse users.
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

    var VALID_AVERAGE_BANDS = ['excellent', 'good', 'passing', 'failing'];

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

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
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

    /**
     * Map a presentation-only average band to a CSS class.
     *
     * STRICT: `null` is valid and returns the neutral class.
     * Anything else that is not one of the four known bands THROWS.
     * A typo in the aggregator must not be silently styled as
     * "unknown"; it must surface.
     */
    function getAverageClass(averageBand) {
        if (averageBand === null || averageBand === undefined) {
            return 'academy-ranking-average academy-ranking-average-unknown';
        }

        if (VALID_AVERAGE_BANDS.indexOf(averageBand) === -1) {
            throw new Error(
                '[AcademyRankingView] Invalid averageBand: ' +
                JSON.stringify(averageBand) +
                '. Expected null or one of: ' +
                VALID_AVERAGE_BANDS.join(', ') + '.'
            );
        }

        return 'academy-ranking-average academy-ranking-average-' +
            averageBand;
    }

    // ============================================================
    // VM VALIDATION
    // ============================================================
    //
    // Strict. The renderer trusts the VM's shape. A missing field is
    // an aggregator bug, not a request for a default value.

    function validateVM(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademyRankingView] renderHTML requires a view model.'
            );
        }

        if (!Array.isArray(viewModel.classes)) {
            throw new Error(
                '[AcademyRankingView] VM.classes must be an array.'
            );
        }

        if (!Array.isArray(viewModel.entries)) {
            throw new Error(
                '[AcademyRankingView] VM.entries must be an array.'
            );
        }

        if (!isFiniteNumber(viewModel.total)) {
            throw new Error(
                '[AcademyRankingView] VM.total must be a finite number.'
            );
        }

        return viewModel;
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        var vm = validateVM(viewModel);
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
        var classes = vm.classes;
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
                throw new Error(
                    '[AcademyRankingView] VM.classes[' + i + '] ' +
                    'must be an object with an id.'
                );
            }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name || '') +
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

        var entries = vm.entries;
        var className = isNonEmptyString(vm.className)
            ? vm.className
            : null;
        var week = vm.week;

        var html = '';
        html += '<div class="academy-ranking-panel">';

        // ---- Header ----
        html += '<div class="academy-ranking-header">';
        html += '<h3 class="academy-ranking-title">' +
                    escapeHtml(className !== null ? className : 'Class') +
                    ' Rankings' +
                '</h3>';
        if (isFiniteNumber(week)) {
            html += '<span class="academy-ranking-subtitle">' +
                        'Week ' + escapeHtml(String(week)) +
                    '</span>';
        }
        html += '<span class="academy-ranking-count">' +
                    escapeHtml(String(vm.total)) + ' students' +
                '</span>';
        html += '</div>';

        if (entries.length === 0) {
            // Wording note: the ranking data is derived from
            // performance, not persisted as a table of "records".
            // "No ranking data is available" is the honest phrasing.
            html += '<p class="empty-state small">' +
                        'No ranking data is available for this week.' +
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
            html += renderRankingRow(entries[i], i);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderRankingRow(entry, index) {
        if (!entry || typeof entry !== 'object') {
            throw new Error(
                '[AcademyRankingView] VM.entries[' + index + '] ' +
                'must be an object.'
            );
        }

        var rankClass = getRankBadgeClass(entry.rank);
        var avgClass = getAverageClass(entry.averageBand);

        var rowClass = 'academy-ranking-row';
        if (entry.isInstructor) {
            rowClass += ' academy-ranking-row-instructor';
        }

        var characterId = entry.characterId || '';

        var html = '';
        html += '<tr class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(characterId) + '">';

        html += '<td class="rank-col">';
        html += '<span class="' + rankClass + '">' +
                    escapeHtml(entry.rankDisplay) +
                '</span>';
        html += '</td>';

        // Name is rendered as a real <button> so keyboard users can
        // activate the row. The row itself is not a control.
        html += '<td class="name-col">';
        html += '<button type="button" ' +
                    'class="academy-ranking-name-btn" ' +
                    'data-character-id="' +
                        escapeAttribute(characterId) + '">' +
                    escapeHtml(entry.characterName) +
                '</button>';
        if (entry.isInstructor) {
            html += ' <span class="academy-ranking-instructor-badge">' +
                        'Instructor' +
                    '</span>';
        }
        html += '</td>';

        html += '<td class="avg-col">';
        html += '<span class="' + avgClass + '">' +
                    escapeHtml(entry.averageDisplay) +
                '</span>';
        html += '</td>';

        html += '<td class="count-col">' +
                    escapeHtml(entry.gradeCountDisplay) +
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
