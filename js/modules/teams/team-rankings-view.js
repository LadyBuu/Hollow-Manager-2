/**
 * modules/teams/team-rankings-view.js - Team Rankings Tab
 *
 * Path: js/modules/teams/team-rankings-view.js
 *
 * WHAT THIS OWNS:
 *   - Rendering the Rankings tab body.
 *   - The year picker.
 *   - The sortable table: rank, team, period, members, status.
 *   - The per-row rank cell, which is click-to-edit.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. TeamAggregator.getTeamRankingsViewModel owns them.
 *   - Writes. TeamCore.addRanking / removeRanking own them.
 *   - Event binding. TeamEvents owns it.
 *   - The tab shell. TeamRender.renderContainer owns it. This
 *     module renders the BODY; the shell calls in.
 *
 * VM SHAPE:
 *   {
 *     year: number,
 *     rows: [
 *       {
 *         teamId,
 *         name,
 *         rank:         number|null,
 *         explicit:     boolean,      // true when an entry exists
 *                                     // at exactly `year`
 *         sourcePeriod: string|null,  // year the rank came from
 *         effectiveDisplay: string,   // '#3' or '—'
 *         provenanceLabel:  string,   // '(from 1904)' or 'set'
 *         periodDisplay:    string,
 *         memberCount:      number,
 *         status:           'active'|'inactive'|'deprecated',
 *         activeAtYear:     boolean
 *       }
 *     ],
 *     sortMode: 'rank'|'name'|'members',
 *     sortDirection: 'asc'|'desc',
 *     showInactive: boolean
 *   }
 *
 * RANK CELL STATES:
 *   The rank cell carries one of three state classes:
 *
 *     .ranking-rank-explicit    the value was written at this year
 *     .ranking-rank-inherited   the value comes from an earlier
 *                               year; a "(from 1904)" note is
 *                               shown beneath it
 *     .ranking-rank-empty       no entry at or before this year;
 *                               the cell shows an em dash
 *
 *   Click any cell to edit in place. An input appears, focused
 *   and selected. Enter commits, Escape cancels, blur commits.
 *   The commit calls TeamCore.addRanking(teamId, year, rank) for
 *   a non-empty value, or TeamCore.removeRanking(teamId, year)
 *   for an empty value. TeamEvents owns those calls; this module
 *   only emits the DOM shape and the data attributes they read.
 *
 * CELL DOM CONTRACT:
 *   Each rank cell carries:
 *
 *     <span class="ranking-row-rank ranking-rank-explicit"
 *           data-team-id="team_x"
 *           data-year="1905"
 *           data-current-rank="3">
 *       <span class="ranking-rank-value">#3</span>
 *       <span class="ranking-rank-provenance">set</span>
 *     </span>
 *
 *   On click, TeamEvents replaces the cell contents with:
 *
 *     <input class="ranking-inline-input"
 *            data-team-id="team_x"
 *            data-year="1905"
 *            data-original-rank="3" />
 *
 *   and commits on Enter or blur, cancels on Escape.
 *
 * CLEAR BUTTON:
 *   When a row's rank is explicit at this year, a small remove
 *   button appears in the row's actions cell. It calls
 *   TeamCore.removeRanking(teamId, year). Removing the entry
 *   exposes whatever the previous explicit entry governs; if
 *   there is none, the cell becomes empty.
 *
 * EMPTY STATE:
 *   When no teams are visible at the chosen year, an empty-state
 *   paragraph is shown in place of the table.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__teamRankingsViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        throw new Error(
            '[TeamRankingsView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml'
        );
    }

    window.__teamRankingsViewLoaded = true;

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

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    // ============================================================
    // HEADER
    // ============================================================

    function renderHeader(vm) {
        var activeCount = 0;
        var rankedCount = 0;

        for (var i = 0; i < vm.rows.length; i++) {
            var r = vm.rows[i];
            if (r.activeAtYear) { activeCount++; }
            if (r.rank !== null) { rankedCount++; }
        }

        var html = '';

        html += '<div class="rankings-header">';

        // ---- Left group: year picker ----
        html += '<div class="rankings-header-group">';
        html += '<label for="rankings-year-input">Year:</label>';
        html += '<input type="number" id="rankings-year-input" ' +
                    'class="rankings-year-input" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(String(vm.year)) + '">';
        html += '<button type="button" ' +
                    'id="rankings-apply-year-btn" ' +
                    'class="small primary">Apply</button>';
        html += '</div>';

        // ---- Right group: summary, toggle, export ----
        html += '<div class="rankings-header-group">';

        html += '<span class="rankings-summary">' +
                    escapeHtml(String(activeCount)) +
                    ' active at this year, ' +
                    escapeHtml(String(rankedCount)) +
                    ' ranked' +
                '</span>';

        html += '<label class="rankings-toggle">';
        html += '<input type="checkbox" ' +
                    'id="rankings-show-inactive"' +
                    (vm.showInactive ? ' checked' : '') + '>';
        html += '<span>Show inactive</span>';
        html += '</label>';

        html += '<button type="button" ' +
                    'id="rankings-export-year-btn" ' +
                    'class="small secondary">' +
                    'Export year' +
                '</button>';

        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TABLE
    // ============================================================

    function renderTable(vm) {
        if (vm.rows.length === 0) {
            return '<p class="empty-state">' +
                        'No teams to rank at this year.' +
                    '</p>';
        }

        var html = '';

        html += '<div class="rankings-table">';

        // ---- Header row ----
        html += '<div class="rankings-table-header">';
        html += renderSortableHeader(
            'rank', 'Rank',
            vm.sortMode, vm.sortDirection
        );
        html += renderSortableHeader(
            'name', 'Team',
            vm.sortMode, vm.sortDirection
        );
        html += '<span class="rankings-col-period">Period</span>';
        html += renderSortableHeader(
            'members', 'Members',
            vm.sortMode, vm.sortDirection
        );
        html += '<span class="rankings-col-status">Status</span>';
        html += '<span class="rankings-col-actions"></span>';
        html += '</div>';

        // ---- Body ----
        for (var i = 0; i < vm.rows.length; i++) {
            html += renderRow(vm.rows[i], vm.year);
        }

        html += '</div>';
        return html;
    }

    function renderSortableHeader(
        sortKey, label, currentSort, direction
    ) {
        var isActive = currentSort === sortKey;
        var classes = 'rankings-col-' + sortKey;
        if (isActive) { classes += ' is-sorted'; }

        var arrow = '';
        if (isActive) {
            arrow = direction === 'desc' ? ' \u25be' : ' \u25b4';
        }

        return '<button type="button" class="' + classes + '" ' +
                    'data-sort-key="' +
                        escapeAttribute(sortKey) + '">' +
                    escapeHtml(label) + arrow +
                '</button>';
    }

    function renderRow(row, year) {
        var rowClasses = 'rankings-table-row';
        if (!row.activeAtYear) {
            rowClasses += ' is-inactive';
        }

        var html = '';

        html += '<div class="' + rowClasses + '" ' +
                    'data-team-id="' +
                        escapeAttribute(row.teamId) + '">';

        // ---- Rank cell (click-to-edit) ----
        html += '<span class="rankings-col-rank">';
        html += renderRankCell(row, year);
        html += '</span>';

        // ---- Name ----
        html += '<span class="rankings-col-name">' +
                    escapeHtml(row.name) +
                '</span>';

        // ---- Period ----
        html += '<span class="rankings-col-period">' +
                    escapeHtml(row.periodDisplay || '\u2014') +
                '</span>';

        // ---- Members ----
        html += '<span class="rankings-col-members">' +
                    escapeHtml(String(row.memberCount)) +
                '</span>';

        // ---- Status ----
        html += '<span class="rankings-col-status">' +
                    escapeHtml(row.status) +
                '</span>';

        // ---- Actions ----
        html += '<span class="rankings-col-actions">';
        if (row.explicit) {
            html += '<button type="button" ' +
                        'class="small danger ' +
                        'rankings-clear-rank" ' +
                        'data-team-id="' +
                            escapeAttribute(row.teamId) + '" ' +
                        'data-year="' +
                            escapeAttribute(String(year)) + '" ' +
                        'title="Remove the ranking entry at this ' +
                            'year. The team will fall back to its ' +
                            'previous explicit ranking.">' +
                        '\u2715' +
                    '</button>';
        }
        html += '</span>';

        html += '</div>';
        return html;
    }

    function renderRankCell(row, year) {
        var cellClasses = 'ranking-row-rank';
        if (row.explicit) {
            cellClasses += ' ranking-rank-explicit';
        } else if (row.rank !== null) {
            cellClasses += ' ranking-rank-inherited';
        } else {
            cellClasses += ' ranking-rank-empty';
        }

        var displayText = row.rank === null
            ? '\u2014'
            : '#' + String(row.rank);

        var provenanceText = '';
        if (row.explicit) {
            provenanceText = 'set';
        } else if (row.rank !== null &&
                   isNonEmptyString(row.sourcePeriod)) {
            provenanceText = '(from ' + row.sourcePeriod + ')';
        }

        var html = '';
        html += '<span class="' + cellClasses + '" ' +
                    'data-team-id="' +
                        escapeAttribute(row.teamId) + '" ' +
                    'data-year="' +
                        escapeAttribute(String(year)) + '" ' +
                    'data-current-rank="' +
                        escapeAttribute(
                            row.rank === null
                                ? ''
                                : String(row.rank)
                        ) + '" ' +
                    'title="Click to edit">';
        html += '<span class="ranking-rank-value">' +
                    escapeHtml(displayText) +
                '</span>';
        if (provenanceText !== '') {
            html += '<span class="ranking-rank-provenance">' +
                        escapeHtml(provenanceText) +
                    '</span>';
        }
        html += '</span>';
        return html;
    }

    // ============================================================
    // PUBLIC
    // ============================================================

    function renderRankingsTab(vm) {
        if (!vm) {
            throw new Error(
                '[TeamRankingsView] renderRankingsTab requires ' +
                'a view model.'
            );
        }
        if (!Array.isArray(vm.rows)) {
            throw new Error(
                '[TeamRankingsView] VM is missing rows array.'
            );
        }

        var html = '';
        html += renderHeader(vm);
        html += renderTable(vm);
        return html;
    }

    window.TeamRankingsView = Object.freeze({
        renderRankingsTab: renderRankingsTab
    });

})();
