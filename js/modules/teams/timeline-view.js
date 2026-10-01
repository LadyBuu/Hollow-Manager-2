/**
 * modules/teams/timeline-view.js - Timeline View
 * Pure renderer for the Teams tab's Timeline mode.
 *
 * Path: js/modules/teams/timeline-view.js
 *
 * IMPORTANT:
 *   - RENDER ONLY. No queries, no state, no mutations.
 *   - The VM arrives fully assembled from TimelineQueries,
 *     via TeamAggregator's delegation.
 *   - Uses DomUtils for escaping.
 *
 * VM SHAPE:
 *   {
 *     range: { start: number|null, end: number|null },
 *     years: [
 *       {
 *         year: number,
 *         left: [
 *           { type, characterId, characterName, label }
 *         ],
 *         right: [
 *           {
 *             teamId, teamName,
 *             formedThisYear: boolean,
 *             departures: [
 *               { characterId, characterName, diedAtYear, label }
 *             ],
 *             remainingMembers: [name, ...] | null
 *           }
 *         ]
 *       }
 *     ],
 *     totalEvents: number
 *   }
 *
 * EXPANDED YEARS:
 *   The caller passes an `expandedYears` object: { [year]: true }
 *   for every year the user has expanded. Years not present are
 *   collapsed.
 *
 * HEADER:
 *   The header carries the year-range inputs and the
 *   expand-all / collapse-all buttons. Click handlers live in
 *   team-events.js.
 *
 * SPINE:
 *   A continuous vertical line runs through the timeline behind
 *   the circles.
 *
 * CLICK TARGETS:
 *   - .timeline-circle[data-year]      toggle that year
 *   - .timeline-team-name[data-team-id] open member manager
 *   - #timeline-apply-btn              apply range
 *   - #timeline-expand-all-btn         expand all years
 *   - #timeline-collapse-all-btn       collapse all years
 *
 * DEPENDENCIES:
 *   - window.DomUtils   (escaping)
 */

(function() {
    'use strict';

    if (window.__timelineViewLoaded) {
        return;
    }
    window.__timelineViewLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;

    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        throw new Error(
            '[TimelineView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml'
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // HEADER
    // ============================================================

    function renderHeader(vm) {
        var html = '';

        html += '<div class="timeline-header">';

        html += '<div class="timeline-header-group">';
        html += '<label for="timeline-start-year">Range:</label>';
        html += '<input type="number" id="timeline-start-year" ' +
                    'class="timeline-year-input" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(
                            safeString(vm.range.start || '')
                        ) + '">';
        html += '<span class="timeline-range-sep">&ndash;</span>';
        html += '<input type="number" id="timeline-end-year" ' +
                    'class="timeline-year-input" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(
                            safeString(vm.range.end || '')
                        ) + '">';
        html += '<button type="button" id="timeline-apply-btn" ' +
                    'class="small primary">Apply</button>';
        html += '</div>';

        html += '<div class="timeline-header-group">';
        html += '<span class="timeline-event-count">' +
                    vm.totalEvents +
                    ' event' + (vm.totalEvents === 1 ? '' : 's') +
                    ' across ' +
                    vm.years.length +
                    ' year' + (vm.years.length === 1 ? '' : 's') +
                '</span>';
        html += '<button type="button" ' +
                    'id="timeline-expand-all-btn" ' +
                    'class="small secondary">Expand all</button>';
        html += '<button type="button" ' +
                    'id="timeline-collapse-all-btn" ' +
                    'class="small secondary">Collapse all</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // YEAR ROWS
    // ============================================================

    function renderYearRow(row, isExpanded) {
        var year = row.year;
        var rowClass = 'timeline-year' +
            (isExpanded ? ' expanded' : ' collapsed');

        var html = '';

        html += '<div class="' + rowClass + '" ' +
                    'data-year="' + escapeAttribute(year) + '">';

        // ---- Left column ----
        html += '<div class="timeline-left">';
        if (isExpanded) {
            if (row.left.length === 0) {
                html += '<span class="timeline-empty-side">&mdash;</span>';
            } else {
                for (var i = 0; i < row.left.length; i++) {
                    html += renderLeftEvent(row.left[i]);
                }
            }
        }
        html += '</div>';

        // ---- Circle ----
        html += '<div class="timeline-center">';
        html += '<button type="button" ' +
                    'class="timeline-circle" ' +
                    'data-year="' + escapeAttribute(year) + '" ' +
                    'aria-expanded="' +
                        (isExpanded ? 'true' : 'false') + '" ' +
                    'aria-label="Toggle events for year ' +
                        escapeAttribute(year) + '">' +
                    escapeHtml(String(year)) +
                '</button>';
        html += '</div>';

        // ---- Right column ----
        html += '<div class="timeline-right">';
        if (isExpanded) {
            if (row.right.length === 0) {
                html += '<span class="timeline-empty-side">&mdash;</span>';
            } else {
                for (var j = 0; j < row.right.length; j++) {
                    html += renderTeamGroup(row.right[j], year);
                }
            }
        }
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderLeftEvent(event) {
        var typeClass = 'timeline-event-' +
            escapeAttribute(event.type || 'other');

        return '<div class="timeline-event ' + typeClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(event.characterId || '') +
                    '">' +
                    escapeHtml(event.label || '') +
                '</div>';
    }

    function renderTeamGroup(group, year) {
        var html = '';

        html += '<div class="timeline-team-group" ' +
                    'data-team-id="' +
                        escapeAttribute(group.teamId || '') + '">';

        // ---- Formation line (only when the team formed this year) ----
        if (group.formedThisYear === true) {
            html += '<div class="timeline-event timeline-event-formed">' +
                        escapeHtml(group.teamName || 'Team') +
                        ' formed' +
                    '</div>';
        }

        // ---- Departure lines ----
        for (var i = 0; i < group.departures.length; i++) {
            var dep = group.departures[i];
            var labelClass = 'timeline-event timeline-event-leave';
            if (dep.diedAtYear) {
                labelClass += ' timeline-event-died';
            }

            html += '<div class="' + labelClass + '" ' +
                        'data-character-id="' +
                            escapeAttribute(dep.characterId || '') +
                        '">' +
                        escapeHtml(dep.label || '') +
                    '</div>';
        }

        // ---- "Team X now: ..." line ----
        //
        // remainingMembers is an array only when the group had at
        // least one departure this year AND the team is still
        // active the year after. Formation-only groups carry null,
        // so nothing is drawn.
        if (Array.isArray(group.remainingMembers)) {
            var count = group.remainingMembers.length;
            var membersText = count === 0
                ? '(no remaining members)'
                : group.remainingMembers.join(', ');

            html += '<div class="timeline-composition">' +
                        '<span class="timeline-team-name" ' +
                            'data-team-id="' +
                                escapeAttribute(group.teamId || '') +
                            '" ' +
                            'title="Open team members">' +
                            escapeHtml(group.teamName || 'Team') +
                        '</span>' +
                        ' now: ' +
                        '<span class="timeline-composition-members">' +
                            escapeHtml(membersText) +
                        '</span>' +
                    '</div>';
        }

        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState(vm) {
        var html = '';
        html += '<div class="timeline-empty">';
        html += '<p class="empty-state">' +
                    'No events in the selected range.' +
                '</p>';
        html += '<p class="timeline-empty-hint">' +
                    'Try widening the year range above.' +
                '</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // PUBLIC
    // ============================================================

    function renderTimeline(vm, expandedYears) {
        if (!vm) {
            throw new Error(
                '[TimelineView] renderTimeline requires a view model.'
            );
        }

        expandedYears = expandedYears || Object.create(null);

        var html = '';

        html += '<div class="timeline-view" ' +
                    'data-total-events="' +
                        escapeAttribute(vm.totalEvents) + '">';

        html += renderHeader(vm);

        if (!vm.years || vm.years.length === 0) {
            html += renderEmptyState(vm);
            html += '</div>';
            return html;
        }

        html += '<div class="timeline-rows">';
        html += '<div class="timeline-spine" aria-hidden="true"></div>';

        for (var i = 0; i < vm.years.length; i++) {
            var row = vm.years[i];
            var isExpanded = expandedYears[row.year] === true;
            html += renderYearRow(row, isExpanded);
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TimelineView = Object.freeze({
        renderTimeline: renderTimeline
    });

})();
