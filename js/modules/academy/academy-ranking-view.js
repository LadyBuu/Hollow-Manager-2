/**
 * modules/academy/academy-ranking-view.js - Academy Ranking View
 * Standalone view for browsing and editing class rankings.
 *
 * Path: js/modules/academy/academy-ranking-view.js
 *
 * WHAT THIS OWNS:
 *   - Rendering the Rankings tab body.
 *   - The class selector.
 *   - The week input.
 *   - The position-ordered ranking table (rank is POSITION,
 *     derived from the ordered list, not a user-editable field).
 *   - Draggable rows.
 *   - The drop-position indicator between rows.
 *   - The "Insert into ranking" strip for unranked students.
 *   - The per-row "remove from this ranking" clear button.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. AcademyAggregator.getRankingViewModel owns them.
 *   - Writes. AcademyRanking.setRanking / insertRankingAt /
 *     removeRankingAt / moveRanking own them.
 *   - Event binding. AcademyView's delegated container
 *     listeners own it.
 *   - The tab shell.
 *
 * VM CONTRACT (from AcademyAggregator.getRankingViewModel):
 *
 *   {
 *     classes:   [ { id, name } ],
 *     classId:   string | null,
 *     className: string | null,
 *     week:      number | null,
 *     entries:   [ <entryVM> ],
 *     total:     number,
 *     rankedCharIds: [ string ],        // ordered, rank order
 *     unrankedStudents: [ { id, name, status } ],
 *     manuallyRankedCount: number
 *   }
 *
 *   entryVM:
 *   {
 *     characterId,
 *     characterName,
 *     rank,                 // number | null
 *     rankDisplay,          // '#3' | '—'
 *     totalStudents,        // number | null
 *     totalDisplay,         // '17' | '—'
 *     percentile,           // number | null
 *     percentileDisplay,    // '82%' | '—'
 *     average,              // number | null
 *     averageDisplay,       // '82.5' | '—'
 *     averageBand,          // null (manual rankings have no band)
 *     gradeCount,           // number | null
 *     gradeCountDisplay,    // '5' | '—'
 *     manuallyRanked,       // boolean
 *     isInstructor          // boolean
 *   }
 *
 *   The renderer TRUSTS the VM. A missing required field is an
 *   aggregator bug and surfaces as a thrown error, not as a
 *   silently-empty table.
 *
 * ROW SHAPE:
 *   Each row is a .academy-ranking-row with data-character-id
 *   and data-position. The row's column layout mirrors the
 *   header:
 *
 *     .rankings-col-rank      position number + drag grip
 *     .rankings-col-name      student name (button for keyboard)
 *     .rankings-col-total     "N" (of totalStudents)
 *     .rankings-col-pct       percentile, if any
 *     .rankings-col-avg       average display
 *     .rankings-col-grades    grade count
 *     .rankings-col-actions   clear button
 *
 *   The row is draggable="true". The drag handle lives inside
 *   the rank cell; the delegated listener reads it off
 *   .rankings-drag-handle and starts the drag.
 *
 * DROP INDICATOR:
 *   The row carries a .rankings-drop-marker child that renders
 *   an empty strip. During a drag the delegated listener adds
 *   .drop-before or .drop-after to the row under the pointer;
 *   academy.css styles those classes to draw the drop line.
 *   This module renders the row with no drop class.
 *
 * INSERT STRIP:
 *   Below the table, a strip for students who have no ranking
 *   record this week. Three controls:
 *
 *     #academy-ranking-insert-student   <select>
 *     #academy-ranking-insert-position  <input type=number>
 *     #academy-ranking-insert-btn       <button data-week=...>
 *
 *   The button carries data-current-rows and data-class-id so
 *   the controller can interpret a blank position as "append"
 *   without re-reading the VM.
 *
 * CLEAR BUTTON:
 *   Per-row. Carries data-character-id and data-week. The
 *   controller calls AcademyRanking.removeRankingAt(...). The
 *   row's title text differs for manually-ranked vs generated
 *   entries; the write is the same either way.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-ranking-class-select (change)
 *   - #academy-ranking-week-input   (change / Enter)
 *   - .academy-ranking-row [data-character-id]  (click, delegated)
 *   - .academy-ranking-name-btn [data-character-id]  (click)
 *   - .academy-ranking-clear-btn [data-character-id] (click)
 *   - #academy-ranking-insert-btn   (click)
 *
 * ACCESSIBILITY:
 *   The row is not a control. The name is a real <button> so
 *   keyboard users can activate it. The drag handle is
 *   aria-hidden; keyboard users reorder via the move controls
 *   (up/down) that the delegated listener provides, or via the
 *   position input in the insert strip. Drag is an enhancement,
 *   not the only path.
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

        if (!Array.isArray(viewModel.rankedCharIds)) {
            throw new Error(
                '[AcademyRankingView] VM.rankedCharIds must be an array.'
            );
        }

        if (!Array.isArray(viewModel.unrankedStudents)) {
            throw new Error(
                '[AcademyRankingView] VM.unrankedStudents must be an array.'
            );
        }

        if (!isFiniteNumber(viewModel.manuallyRankedCount)) {
            throw new Error(
                '[AcademyRankingView] VM.manuallyRankedCount must be ' +
                'a finite number.'
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
    // TOP BAR - Class selector + Week input
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
    // BODY - Table, empty state, or no-class prompt
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
        var unrankedStudents = vm.unrankedStudents;
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
                    escapeHtml(String(vm.total)) + ' ranked' +
                    (vm.manuallyRankedCount > 0
                        ? ' (' + escapeHtml(String(vm.manuallyRankedCount)) +
                          ' manual)'
                        : '') +
                '</span>';
        html += '</div>';

        html += renderRandomiseControls(
            vm, classId, week, entries.length + unrankedStudents.length
        );

        if (entries.length === 0 && unrankedStudents.length === 0) {
            html += '<p class="empty-state small">' +
                        'No students are available to rank at this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (entries.length === 0) {
            html += '<p class="empty-state small">' +
                        'No students are ranked at this week yet.' +
                    '</p>';
            html += renderInsertStrip(
                unrankedStudents, classId, week, 0
            );
            html += '</div>';
            return html;
        }

        html += renderTable(vm);
        html += renderInsertStrip(
            unrankedStudents, classId, week, entries.length
        );
        html += '</div>';

        return html;
    }

    // ============================================================
    // RANDOMISE CONTROLS
    // ============================================================

    function renderRandomiseControls(vm, classId, week, totalStudents) {
        if (!classId || totalStudents < 2) { return ''; }

        return (
            '<div class="academy-ranking-randomise">' +
                '<div class="academy-ranking-randomise-copy">' +
                    '<strong>Randomise ranking</strong>' +
                    '<span>Keep the current occupants of selected positions; ' +
                    'shuffle everyone else.</span>' +
                '</div>' +
                '<label for="academy-ranking-keep-positions">' +
                    'Keep positions' +
                '</label>' +
                '<input type="text" ' +
                    'id="academy-ranking-keep-positions" ' +
                    'placeholder="e.g. 1, 3, 7" ' +
                    'aria-describedby="academy-ranking-keep-help">' +
                '<span id="academy-ranking-keep-help" ' +
                    'class="academy-ranking-randomise-help">' +
                    'Comma-separated positions. Leave blank to shuffle all.' +
                '</span>' +
                '<button type="button" ' +
                    'id="academy-ranking-randomise-btn" ' +
                    'class="small primary" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week)) + '">' +
                    'Shuffle ranking' +
                '</button>' +
            '</div>'
        );
    }

    // ============================================================
    // TABLE
    // ============================================================

    function renderTable(vm) {
        var rows = vm.entries;
        var classId = vm.classId;
        var week = vm.week;

        var html = '';

        html += '<div class="rankings-table academy-ranking-table">';

        // ---- Header row ----
        html += '<div class="rankings-table-header">';
        html += '<span class="rankings-col-rank">Rank</span>';
        html += '<span class="rankings-col-name">Student</span>';
        html += '<span class="rankings-col-total">Of</span>';
        html += '<span class="rankings-col-pct">Percentile</span>';
        html += '<span class="rankings-col-avg">Average</span>';
        html += '<span class="rankings-col-grades">Grades</span>';
        html += '<span class="rankings-col-actions"></span>';
        html += '</div>';

        // ---- Body ----
        for (var i = 0; i < rows.length; i++) {
            html += renderRow(rows[i], classId, week, i);
        }

        html += '</div>';

        return html;
    }

    function renderRow(entry, classId, week, index) {
        if (!entry || typeof entry !== 'object') {
            throw new Error(
                '[AcademyRankingView] VM.entries[' + index + '] ' +
                'must be an object.'
            );
        }

        var rankClass = getRankBadgeClass(entry.rank);
        var avgClass = getAverageClass(entry.averageBand);

        var rowClasses = 'rankings-table-row academy-ranking-row';
        if (entry.isInstructor) {
            rowClasses += ' academy-ranking-row-instructor';
        }
        if (entry.manuallyRanked) {
            rowClasses += ' is-manual';
        }

        var characterId = entry.characterId || '';
        var characterIdAttr = escapeAttribute(characterId);
        var weekAttr = escapeAttribute(
            isFiniteNumber(week) ? String(week) : ''
        );
        var positionAttr = escapeAttribute(
            isFiniteNumber(entry.rank) ? String(entry.rank) : ''
        );

        var html = '';

        html += '<div class="' + rowClasses + '" ' +
                    'data-character-id="' + characterIdAttr + '" ' +
                    'data-position="' + positionAttr + '">';

        // ---- Rank / drag handle ----
        html += '<span class="rankings-col-rank">';
        html += '<span class="' + rankClass + '">' +
                    escapeHtml(entry.rankDisplay) +
                '</span>';
        html += '<span class="rankings-drag-handle" ' +
                    'title="Drag to reorder" ' +
                    'draggable="true" ' +
                    'style="touch-action:none; user-select:none;" ' +
                    'aria-hidden="true">' +
                    '\u2630' +
                '</span>';
        html += '</span>';

        // ---- Name (button for keyboard activation) ----
        html += '<span class="rankings-col-name">';
        html += '<button type="button" ' +
                    'class="academy-ranking-name-btn" ' +
                    'data-character-id="' + characterIdAttr + '">' +
                    escapeHtml(entry.characterName) +
                '</button>';
        if (entry.isInstructor) {
            html += ' <span class="academy-ranking-instructor-badge">' +
                        'Instructor' +
                    '</span>';
        }
        if (entry.manuallyRanked) {
            html += ' <span class="academy-ranking-manual-badge" ' +
                        'title="This rank was set manually and will ' +
                        'survive a regenerate.">manual</span>';
        }
        html += '</span>';

        // ---- Of (totalStudents) ----
        html += '<span class="rankings-col-total">' +
                    escapeHtml(entry.totalDisplay || '\u2014') +
                '</span>';

        // ---- Percentile ----
        html += '<span class="rankings-col-pct">' +
                    escapeHtml(entry.percentileDisplay || '\u2014') +
                '</span>';

        // ---- Average ----
        html += '<span class="rankings-col-avg">';
        html += '<span class="' + avgClass + '">' +
                    escapeHtml(entry.averageDisplay || '\u2014') +
                '</span>';
        html += '</span>';

        // ---- Grades ----
        html += '<span class="rankings-col-grades">' +
                    escapeHtml(entry.gradeCountDisplay || '\u2014') +
                '</span>';

        // ---- Actions ----
        var clearTitle = entry.manuallyRanked
            ? 'Remove this manual rank. Remaining ranks will be ' +
              'renumbered.'
            : 'Remove this rank. The student can be re-ranked ' +
              'from the insert strip.';

        html += '<span class="rankings-col-actions">';
        html += '<button type="button" ' +
                    'class="small danger academy-ranking-clear-btn" ' +
                    'data-character-id="' + characterIdAttr + '" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + weekAttr + '" ' +
                    'title="' + escapeAttribute(clearTitle) + '">' +
                    '\u2715' +
                '</button>';
        html += '</span>';

        // ---- Drop marker (empty; listener adds class at drag time) ----
        html += '<span class="rankings-drop-marker" ' +
                    'aria-hidden="true"></span>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // INSERT STRIP
    // ============================================================
    //
    // Below the table. Lets the user add a student who has no
    // ranking record yet.
    //
    // When unrankedStudents is empty, the strip is rendered with
    // a disabled state and a note explaining that every roster
    // student already has a rank.

    function renderInsertStrip(unrankedStudents, classId, week, currentRows) {
        var hasUnranked = Array.isArray(unrankedStudents) &&
                          unrankedStudents.length > 0;

        var html = '';
        html += '<div class="academy-ranking-insert-strip">';

        html += '<span class="academy-ranking-insert-label">' +
                    'Add to ranking:' +
                '</span>';

        // ---- Student picker ----
        html += '<select id="academy-ranking-insert-student" ' +
                    'class="academy-ranking-insert-select"' +
                    (hasUnranked ? '' : ' disabled') + '>';

        if (hasUnranked) {
            html += '<option value="">Select a student...</option>';
            for (var i = 0; i < unrankedStudents.length; i++) {
                var s = unrankedStudents[i];
                if (!s || !s.id) { continue; }
                html += '<option value="' +
                            escapeAttribute(s.id) + '">' +
                            escapeHtml(s.name || s.id) +
                        '</option>';
            }
        } else {
            html += '<option value="" disabled selected>' +
                        'No unranked students available' +
                    '</option>';
        }

        html += '</select>';

        // ---- Position input ----
        html += '<input type="number" ' +
                    'id="academy-ranking-insert-position" ' +
                    'class="academy-ranking-insert-position" ' +
                    'min="1" ' +
                    'placeholder="Pos."' +
                    (hasUnranked ? '' : ' disabled') + '>';

        // ---- Insert button ----
        html += '<button type="button" ' +
                    'id="academy-ranking-insert-btn" ' +
                    'class="small primary"' +
                    (hasUnranked ? '' : ' disabled') + ' ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(
                        isFiniteNumber(week) ? String(week) : ''
                    ) + '" ' +
                    'data-current-rows="' +
                        escapeAttribute(String(currentRows)) + '">' +
                    'Insert' +
                '</button>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRankingView = Object.freeze({
        renderHTML: renderHTML
    });

})();
