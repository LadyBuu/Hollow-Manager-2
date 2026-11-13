/**
 * modules/teams/team-rankings-view.js - Team Rankings Tab
 *
 * Path: js/modules/teams/team-rankings-view.js
 *
 * WHAT THIS OWNS:
 *   - Rendering the Rankings tab body.
 *   - The year picker.
 *   - The Show Inactive toggle.
 *   - The position-ordered table (rank is POSITION, not a
 *     user-editable field).
 *   - Draggable rows.
 *   - The drop-position indicator between rows.
 *   - The "Insert team" strip for teams that have no position
 *     yet.
 *   - The per-row "remove from this position" clear button.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. TeamAggregator.getTeamRankingsViewModel owns them.
 *   - Writes. TeamCore.insertRankingAt / removeRankingAt /
 *     moveRanking own them.
 *   - Event binding. TeamEvents owns it.
 *   - The tab shell. TeamRender.renderContainer owns it. This
 *     module renders the BODY; the shell calls in.
 *   - The drop-before / drop-after styling. teams.css owns it;
 *     this module emits the row and the classes are applied at
 *     drag time by TeamEvents.
 *
 * VM SHAPE (from TeamAggregator, ordered-list model):
 *
 *   {
 *     year: number,
 *     rows: [
 *       {
 *         position:      integer 1..N,
 *         teamId:        string,
 *         name:          string,
 *         rank:          integer (same as position; compat),
 *         explicit:      true,
 *         sourcePeriod:  String(year),
 *         periodDisplay: string,
 *         memberCount:   integer,
 *         status:        raw stored status,
 *         activeAtYear:  boolean
 *       }
 *     ],
 *     unrankedTeams: [
 *       {
 *         teamId: string,
 *         name:   string,
 *         status: string,
 *         activeAtYear: true
 *       }
 *     ],
 *     showInactive: boolean
 *   }
 *
 *   `rows` is already position-ordered by the query layer. This
 *   renderer does not re-sort.
 *
 * ROW SHAPE:
 *   Each row is a .rankings-table-row with data-team-id and
 *   data-position. The row's column layout mirrors the header:
 *
 *     .rankings-col-rank      position number + a drag grip
 *     .rankings-col-name      team name
 *     .rankings-col-period    the team's active window
 *     .rankings-col-members   active member count
 *     .rankings-col-status    raw status
 *     .rankings-col-actions   clear button (only when explicit)
 *
 *   The row is draggable="true". The drag handle lives inside
 *   the rank cell so the user knows where to grab; TeamEvents
 *   reads it off .rankings-drag-handle and starts the drag.
 *
 * DROP INDICATOR:
 *   The row carries a data-drop-marker child that renders an
 *   empty strip. During a drag, TeamEvents adds
 *   .drop-before or .drop-after to the row under the pointer;
 *   teams.css styles those classes to draw the drop line. This
 *   module renders the row with no drop class; the drag-time
 *   state is entirely TeamEvents's.
 *
 * INSERT STRIP:
 *   Below the table, a strip for teams that do not yet have a
 *   position. Three controls:
 *
 *     #rankings-insert-team       <select> of vm.unrankedTeams
 *     #rankings-insert-position   <input type=number>
 *     #rankings-insert-btn        <button data-year=...>
 *
 *   TeamEvents (C5) wires the button to
 *   TeamCore.insertRankingAt(teamId, year, position). A blank
 *   position means "append to the end" (position N+1); the
 *   renderer does not compute this — the controller does, via
 *   the aggregation's own rows length. The strip emits the
 *   current rows length on #rankings-insert-btn as
 *   data-current-rows so the controller does not have to
 *   re-read the VM.
 *
 * CLEAR BUTTON:
 *   Per-row. Calls TeamCore.removeRankingAt(teamId, year).
 *   After a remove, the team drops out of `rows` and (if still
 *   active at the year with no inherited rank) reappears in
 *   `unrankedTeams`. The controller refreshes; the view is a
 *   pure function.
 *
 * EMPTY STATE:
 *   When `rows` is empty, an empty-state paragraph replaces the
 *   table. When `rows` is empty AND `unrankedTeams` is empty,
 *   a second paragraph explains why there is nothing to rank.
 *   The insert strip is still rendered when `rows` is empty and
 *   `unrankedTeams` is non-empty, so a first position can be
 *   assigned.
 *
 * SHOW INACTIVE:
 *   Echoed on the header toggle. Does not affect `rows`
 *   composition (the query layer already excludes inactive
 *   teams that are not explicitly ranked). Clicking the toggle
 *   re-runs the aggregator; TeamEvents owns that.
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
    //
    // Year picker, Show Inactive toggle, Export year. No sort
    // controls: position is the only order.

    function renderHeader(vm) {
        var activeCount = 0;
        var rankedCount = vm.rows.length;

        for (var i = 0; i < vm.rows.length; i++) {
            if (vm.rows[i].activeAtYear) { activeCount++; }
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
        var rows = vm.rows;
        var unrankedTeams = vm.unrankedTeams;

        if (rows.length === 0) {
            return renderEmptyState(unrankedTeams);
        }

        var html = '';

        html += '<div class="rankings-table">';

        // ---- Header row ----
        //
        // No sortable headers. The columns are static labels.
        html += '<div class="rankings-table-header">';
        html += '<span class="rankings-col-rank">Position</span>';
        html += '<span class="rankings-col-name">Team</span>';
        html += '<span class="rankings-col-period">Period</span>';
        html += '<span class="rankings-col-members">Members</span>';
        html += '<span class="rankings-col-status">Status</span>';
        html += '<span class="rankings-col-actions"></span>';
        html += '</div>';

        // ---- Body ----
        for (var i = 0; i < rows.length; i++) {
            html += renderRow(rows[i], vm.year);
        }

        html += '</div>';

        // ---- Insert strip ----
        html += renderInsertStrip(unrankedTeams, vm.year, rows.length);

        return html;
    }

    function renderRow(row, year) {
        var rowClasses = 'rankings-table-row';
        if (!row.activeAtYear) {
            rowClasses += ' is-inactive';
        }

        var teamIdAttr = escapeAttribute(row.teamId);
        var yearAttr = escapeAttribute(String(year));
        var positionAttr = escapeAttribute(String(row.position));

        var html = '';

        html += '<div class="' + rowClasses + '" ' +
                    'data-team-id="' + teamIdAttr + '" ' +
                    'data-position="' + positionAttr + '" ' +
                    'draggable="true">';

        // ---- Rank / drag handle ----
        //
        // The rank cell carries the position number and a drag
        // grip. The grip is the drag handle; TeamEvents starts
        // the drag from it. The whole row is draggable, but the
        // grip exists so the user knows where to grab.
        html += '<span class="rankings-col-rank">';
        html += '<span class="rankings-position-number">' +
                    escapeHtml(String(row.position)) +
                '</span>';
        html += '<span class="rankings-drag-handle" ' +
                    'title="Drag to reorder" ' +
                    'aria-hidden="true">' +
                    '\u2630' +
                '</span>';
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
        //
        // The clear button removes the team's explicit entry
        // at this year. After removal, the team drops out of
        // `rows` and (if still active with no inherited rank)
        // reappears in `unrankedTeams`. Idempotent on the
        // backend, but the button is only rendered on rows
        // whose entry is explicit (which is every row in the
        // ordered-list VM).
        html += '<span class="rankings-col-actions">';
        html += '<button type="button" ' +
                    'class="small danger rankings-clear-rank" ' +
                    'data-team-id="' + teamIdAttr + '" ' +
                    'data-year="' + yearAttr + '" ' +
                    'title="Remove this team from the ranking at ' +
                    'this year. The team will fall back to its ' +
                    'previous explicit ranking, if any.">' +
                    '\u2715' +
                '</button>';
        html += '</span>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // INSERT STRIP
    // ============================================================
    //
    // Below the table. Lets the user add a team that has no
    // position yet.
    //
    // Controls:
    //   #rankings-insert-team       <select> of unranked teams
    //   #rankings-insert-position   <input type=number>
    //   #rankings-insert-btn        <button data-year=...>
    //
    // The button carries the current row count as
    // data-current-rows so the controller can interpret a blank
    // position as "append to the end" without re-reading the VM.
    //
    // When unrankedTeams is empty, the strip is rendered with a
    // disabled state and a note explaining that every active
    // team already has a position.

    function renderInsertStrip(unrankedTeams, year, currentRows) {
        var hasUnranked = Array.isArray(unrankedTeams) &&
                          unrankedTeams.length > 0;

        var html = '';
        html += '<div class="rankings-insert-strip">';

        html += '<span class="rankings-insert-label">' +
                    'Add to ranking:' +
                '</span>';

        // ---- Team picker ----
        html += '<select id="rankings-insert-team" ' +
                    'class="rankings-insert-select"' +
                    (hasUnranked ? '' : ' disabled') + '>';

        if (hasUnranked) {
            html += '<option value="">Select a team...</option>';
            for (var i = 0; i < unrankedTeams.length; i++) {
                var t = unrankedTeams[i];
                if (!t || !t.teamId) { continue; }
                html += '<option value="' +
                            escapeAttribute(t.teamId) + '">' +
                            escapeHtml(t.name || t.teamId) +
                        '</option>';
            }
        } else {
            html += '<option value="" disabled selected>' +
                        'No unranked teams available' +
                    '</option>';
        }

        html += '</select>';

        // ---- Position input ----
        html += '<input type="number" ' +
                    'id="rankings-insert-position" ' +
                    'class="rankings-insert-position" ' +
                    'min="1" ' +
                    'placeholder="Pos."' +
                    (hasUnranked ? '' : ' disabled') + '>';

        // ---- Insert button ----
        html += '<button type="button" ' +
                    'id="rankings-insert-btn" ' +
                    'class="small primary"' +
                    (hasUnranked ? '' : ' disabled') + ' ' +
                    'data-year="' +
                        escapeAttribute(String(year)) + '" ' +
                    'data-current-rows="' +
                        escapeAttribute(String(currentRows)) + '">' +
                    'Insert' +
                '</button>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState(unrankedTeams) {
        var hasUnranked = Array.isArray(unrankedTeams) &&
                          unrankedTeams.length > 0;

        var html = '';
        html += '<p class="empty-state">' +
                    'No teams ranked at this year.' +
                '</p>';

        if (hasUnranked) {
            html += '<p class="empty-state small">' +
                        'Use the picker below to assign the first ' +
                        'position.' +
                    '</p>';
        } else {
            html += '<p class="empty-state small">' +
                        'No teams are active at this year to rank.' +
                    '</p>';
        }

        // The insert strip is still rendered when there is
        // something to insert, so a first position can be
        // assigned from the empty state.
        if (hasUnranked) {
            html += renderInsertStrip(
                unrankedTeams, null, 0
            );
        }

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
        if (!Array.isArray(vm.unrankedTeams)) {
            throw new Error(
                '[TeamRankingsView] VM is missing unrankedTeams ' +
                'array.'
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
