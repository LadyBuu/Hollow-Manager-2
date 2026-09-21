/**
 * modules/calendar/calendar-renderer.js - Calendar Renderer
 * PURE rendering for calendar grids - NO event binding, NO modals, NO state.
 *
 * Path: js/modules/calendar/calendar-renderer.js
 *
 * CONTRACT:
 *   - PURE. No side effects, no data mutation.
 *   - Input: an already-prepared calendar view model.
 *   - Output: HTML string.
 *   - No event binding, no modal creation, no notifications.
 *   - Uses DomUtils.escapeHtml() as the single escaping source.
 *
 * GRID EDITABILITY:
 *   The renderer reads two flags on the view model:
 *
 *     canEdit               student-mode grids. Empty cells emit
 *                           data-action="schedule-assign"; occupied
 *                           cells emit data-action="schedule-slot-open".
 *
 *     canEditInstructorSlot instructor-mode grids. Empty cells emit
 *                           data-action="schedule-assign-instructor".
 *
 *   A location grid (canEdit === false, canEditInstructorSlot ===
 *   false) emits no cell actions except the co-occupant marker's,
 *   which is separate and always active.
 *
 * CO-OCCUPANCY MARKER:
 *   When the slot descriptor carries a non-empty `coOccupants`
 *   array, the cell renders a small "+N" marker. The marker is a
 *   BUTTON; it emits data-action="schedule-co-occupants-open"
 *   with the cell's day and hour. Clicking the marker opens the
 *   co-occupants panel below the grid.
 *
 *   The marker is a sibling action to the cell's own action.
 *   On an editable grid, clicking the marker opens the panel;
 *   clicking anywhere else on the cell fires the cell's action.
 *   On a read-only grid, the marker is the only interactive
 *   element in the cell.
 *
 * CO-OCCUPANTS PANEL HOST:
 *   The grid emits an empty #academy-schedule-co-occupants-host
 *   below itself. The controller mounts the panel into it.
 *
 * DEPENDENCIES:
 *   - CalendarConstants
 *   - DomUtils
 */

(function() {
    'use strict';

    if (window.__calendarRendererLoaded) { return; }
    window.__calendarRendererLoaded = true;

    var CC = window.CalendarConstants;
    var DomUtils = window.DomUtils;

    function escapeHtml(value) { return DomUtils.escapeHtml(value); }
    function escapeAttribute(value) {
        if (typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function formatHour(hour, includeMinutes) {
        return CC.formatHour(hour, includeMinutes);
    }

    function getDayName(day) {
        return CC.getDayName(day) || 'Unknown';
    }

    function getAvailableHours() {
        var hours = [];
        for (var h = CC.CALENDAR_START_HOUR; h <= CC.CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }
        return hours;
    }

    // ============================================================
    // MODE -> ACTION MODE
    // ============================================================

    function getOccupiedCellMode(gridMode) {
        if (gridMode === 'instructor') {
            return 'remove-group';
        }
        return 'remove-student';
    }

    // ============================================================
    // BUILD OCCUPIED MAP
    // ============================================================

    function buildOccupiedMap(schedule, getDuration) {
        var occupied = {};
        if (!schedule) { return occupied; }

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) { continue; }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) { continue; }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) { continue; }
                if (!daySchedule[hour]) { continue; }

                var startHour = parseInt(hour, 10);
                if (isNaN(startHour)) { continue; }
                var duration = getDuration ? getDuration(dayNum, startHour) : 1;

                if (!occupied[day]) { occupied[day] = {}; }

                var endHour = Math.min(startHour + duration, CC.CALENDAR_END_HOUR + 1);
                for (var h = startHour; h < endHour; h++) {
                    occupied[day][h] = true;
                }
            }
        }

        return occupied;
    }

    function hasOverlap(occupiedMap, day, startHour, duration) {
        var dayNum = parseInt(day, 10);
        if (isNaN(dayNum)) { return true; }
        if (!occupiedMap[dayNum]) { return false; }

        var requestedEnd = Math.min(startHour + duration, CC.CALENDAR_END_HOUR + 1);
        for (var h = startHour; h < requestedEnd; h++) {
            if (occupiedMap[dayNum][h]) { return true; }
        }
        return false;
    }

    function getAvailableSlots(occupiedMap, day, duration, startHour, endHour) {
        startHour = startHour || CC.CALENDAR_START_HOUR;
        endHour = endHour || CC.CALENDAR_END_HOUR;

        var available = [];
        var dayNum = parseInt(day, 10);
        if (isNaN(dayNum)) { return available; }

        var durationNum = parseInt(duration, 10);
        if (isNaN(durationNum) || durationNum < 1) { return available; }

        if (!occupiedMap[dayNum]) {
            for (var h = startHour; h <= endHour - durationNum + 1; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour - durationNum + 1; h++) {
            var hasConflict = false;
            for (var d = 0; d < durationNum; d++) {
                if (occupiedMap[dayNum][h + d]) { hasConflict = true; break; }
            }
            if (!hasConflict) { available.push(h); }
        }

        return available;
    }

    // ============================================================
    // CO-OCCUPANCY MARKER
    // ============================================================
    //
    // The marker is a BUTTON. It emits
    // data-action="schedule-co-occupants-open" with the cell's
    // day and hour. Clicking it opens the co-occupants panel
    // below the grid.
    //
    // The marker is INSIDE the cell, so clicking it also triggers
    // the cell's :hover. On an editable grid the cell has its
    // own data-action; the controller's click handler dispatches
    // to the marker first because the marker is the innermost
    // element with a data-action.
    //
    // The marker does NOT carry a `title` attribute any more.
    // The tooltip was a desktop affordance; the panel replaces
    // it on every input mode.

    function renderCoOccupantMarker(slotData, day, hour) {
        if (!slotData || !Array.isArray(slotData.coOccupants)) {
            return '';
        }
        var count = slotData.coOccupants.length;
        if (count === 0) {
            return '';
        }

        return '<button type="button" ' +
                    'class="schedule-co-occupant-marker" ' +
                    'data-action="schedule-co-occupants-open" ' +
                    'data-day="' + escapeAttribute(String(day)) + '" ' +
                    'data-hour="' + escapeAttribute(String(hour)) + '" ' +
                    'aria-label="' +
                        escapeAttribute(
                            count + ' group' +
                            (count === 1 ? '' : 's') +
                            ' share this slot; open the list'
                        ) + '">' +
                    '+' + count +
                '</button>';
    }

    // ============================================================
    // RENDER GRID
    // ============================================================

    function renderGrid(state, viewModel) {
        if (!state || !state.selectedId) {
            return '<div class="empty-state">Select an entity to view its schedule</div>';
        }

        var schedule = viewModel.schedule || {};
        var restDays = viewModel.restDays || [];
        var entityName = viewModel.entityName || 'Entity';
        var modeLabel = viewModel.modeLabel || 'Schedule';
        var showEmptySlots = viewModel.showEmptySlots !== false;
        var showRestDays = viewModel.showRestDays !== false;

        var canEdit = viewModel.canEdit === true;
        var canEditInstructorSlot =
            viewModel.canEditInstructorSlot === true;

        var occupiedCellMode = getOccupiedCellMode(viewModel.mode);

        var hours = viewModel.hours || getAvailableHours();

        var html = '';
        html += '<div class="calendar-grid-container">';
        html += '<div class="calendar-grid-wrapper">';
        html += '<div class="calendar-header">';
        html += '<h3 class="calendar-title">' + escapeHtml(entityName) + ' - ' + modeLabel + ' (Week ' + state.week + ')</h3>';
        html += '</div>';

        html += '<div class="schedule-grid">';

        // Header row
        html += '<div class="schedule-cell schedule-time schedule-header">Time</div>';
        for (var day = CC.MIN_DAY; day <= CC.MAX_DAY; day++) {
            var isRestDayHeader = showRestDays && restDays.indexOf(day) !== -1;
            var dayName = getDayName(day);
            var restClassHeader = isRestDayHeader ? ' schedule-rest-day' : '';
            html += '<div class="schedule-cell schedule-day schedule-header' + restClassHeader + '">' + escapeHtml(dayName) + (isRestDayHeader ? ' [R]' : '') + '</div>';
        }

        // Body rows
        for (var row = 0; row < hours.length; row++) {
            var hour = hours[row];
            var hourDisplay = formatHour(hour);

            html += '<div class="schedule-cell schedule-time">' + escapeHtml(hourDisplay) + '</div>';

            for (var day = CC.MIN_DAY; day <= CC.MAX_DAY; day++) {
                var isRestDay = showRestDays && restDays.indexOf(day) !== -1;
                var slotData = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                var isOccupied = !!slotData && !slotData.isBlock;
                var isBlock = !!slotData && slotData.isBlock === true;

                var classes = 'schedule-cell schedule-slot';
                if (isOccupied) { classes += ' schedule-occupied'; } else { classes += ' schedule-empty'; }
                if (isRestDay) { classes += ' schedule-rest-day'; }
                if (isBlock) { classes += ' schedule-blocked'; }

                // ---- Cell action ----
                //
                // The cell's own action is separate from the
                // marker's action. The marker sits inside the
                // cell; clicking it fires the marker's action.
                // Clicking anywhere else in the cell fires the
                // cell's action.
                var cellAction = null;
                if (!isRestDay && !isBlock) {
                    if (isOccupied) {
                        if (canEdit || canEditInstructorSlot) {
                            cellAction = 'schedule-slot-open';
                        }
                    } else if (canEditInstructorSlot) {
                        cellAction = 'schedule-assign-instructor';
                    } else if (canEdit) {
                        cellAction = 'schedule-assign';
                    }
                }

                var dataAttrs = 'data-day="' + day + '" data-hour="' + hour + '"';
                if (cellAction === 'schedule-assign') {
                    dataAttrs += ' data-action="schedule-assign"';
                } else if (cellAction === 'schedule-assign-instructor') {
                    dataAttrs += ' data-action="schedule-assign-instructor"';
                } else if (cellAction === 'schedule-slot-open') {
                    dataAttrs += ' data-action="schedule-slot-open"';
                    if (slotData && slotData.groupId) {
                        dataAttrs += ' data-group-id="' +
                            escapeAttribute(slotData.groupId) + '"';
                    }
                    if (slotData && slotData.sessionId) {
                        dataAttrs += ' data-session-id="' +
                            escapeAttribute(slotData.sessionId) + '"';
                    }
                    dataAttrs += ' data-mode="' +
                        escapeAttribute(occupiedCellMode) + '"';
                }

                html += '<div class="' + classes + '" ' + dataAttrs + '>';

                if (isOccupied && !isRestDay) {
                    var disciplineName = slotData.disciplineName || 'Unknown';
                    var label = slotData.label || '';
                    var duration = slotData.duration || 1;
                    var instructorName = slotData.instructorName || '';
                    var groupLabel = slotData.groupLabel || '';

                    html += '<div class="schedule-discipline-name">' + escapeHtml(disciplineName) + '</div>';
                    if (label) { html += '<div class="schedule-label">[' + escapeHtml(label) + ']</div>'; }
                    if (groupLabel) { html += '<div class="schedule-group-label">' + escapeHtml(groupLabel) + '</div>'; }
                    if (instructorName) { html += '<div class="schedule-instructor">' + escapeHtml(instructorName) + '</div>'; }
                    if (duration > 1) { html += '<div class="schedule-duration">' + duration + 'h</div>'; }
                    if (slotData && slotData.isContinuation) {
                        html += '<div class="schedule-continuation">\u2195</div>';
                    }
                    html += renderCoOccupantMarker(slotData, day, hour);

                } else if (isBlock && !isRestDay) {
                    html += '<div class="schedule-blocked-label">\u25a0 ' + escapeHtml(slotData.label || 'Blocked') + '</div>';

                } else if (!isRestDay && showEmptySlots) {
                    html += '<div class="schedule-empty-label">+</div>';
                }

                html += '</div>';
            }
        }

        html += '</div>';
        html += '</div>';

        if (viewModel.sidebarContent) {
            html += viewModel.sidebarContent;
        }

        // ---- Co-occupants panel host ----
        //
        // Empty on render. The controller mounts the panel into
        // it when the user clicks a co-occupant marker. The host
        // is always emitted, even when no cell carries a marker,
        // so the controller's mount path is unconditional.
        html += '<div id="academy-schedule-co-occupants-host" ' +
                    'class="schedule-co-occupants-host"></div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER LEGEND
    // ============================================================

    function renderLegend(options) {
        options = options || {};
        var items = options.items || [];

        if (items.length === 0) { return ''; }

        var html = '<div class="calendar-legend">';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            html += '<div class="legend-item">';
            html += '<span class="legend-color ' + escapeAttribute(item.className || '') + '"></span>';
            html += '<span class="legend-label">' + escapeHtml(item.label || '') + '</span>';
            html += '</div>';
        }
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER EMPTY STATE
    // ============================================================

    function renderEmptyState(message) {
        return '<div class="empty-state">' + escapeHtml(message || 'No data available') + '</div>';
    }

    function renderLoading(message) {
        return '<div class="loading-state">' + escapeHtml(message || 'Loading...') + '</div>';
    }

    window.CalendarRenderer = {
        renderGrid: renderGrid,
        renderLegend: renderLegend,
        renderEmptyState: renderEmptyState,
        renderLoading: renderLoading,
        buildOccupiedMap: buildOccupiedMap,
        hasOverlap: hasOverlap,
        getAvailableSlots: getAvailableSlots,
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,
        formatHour: formatHour,
        getDayName: getDayName,
        CC: CC
    };

})();
