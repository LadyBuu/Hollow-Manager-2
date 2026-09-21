/**
 * modules/calendar/calendar-renderer.js - Calendar Renderer
 * PURE rendering for calendar grids.
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
 *     canEdit               student-mode grids.
 *     canEditInstructorSlot instructor-mode grids.
 *
 *   A location grid (both false) emits no cell actions except
 *   the co-occupant marker's, which is separate.
 *
 * HOSTS EMITTED BELOW THE GRID:
 *   #academy-schedule-co-occupants-host
 *     Empty. The controller mounts the co-occupants panel into
 *     it. See the co-occupants slice.
 *
 *   #academy-schedule-hours-host
 *     Rendered with the discipline-hours panel when the VM
 *     carries a non-empty `disciplineHours` array. The panel is
 *     display-only for the summary rows, plus per-discipline
 *     clickable rows that open the group picker.
 *
 *   #academy-schedule-discipline-picker-host
 *     Empty. The controller mounts the picker into it when the
 *     user clicks a discipline row in the hours panel.
 *
 * CO-OCCUPANCY MARKER:
 *   Button. Emits data-action="schedule-co-occupants-open" with
 *   the cell's day and hour.
 *
 * DISCIPLINE HOURS ROW:
 *   Button. Emits data-action="schedule-discipline-picker-open"
 *   with data-discipline-id.
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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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
    // DISCIPLINE HOURS PANEL
    // ============================================================

    function renderDisciplineHoursPanel(disciplineHours) {
        if (!Array.isArray(disciplineHours) ||
            disciplineHours.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="schedule-hours-panel">';

        html += '<div class="schedule-hours-header">';
        html += '<span class="schedule-hours-title">Weekly Hours</span>';
        html += '<span class="schedule-hours-hint">' +
                    'Click a discipline to add the student to a ' +
                    'group.' +
                '</span>';
        html += '</div>';

        html += '<ul class="schedule-hours-list">';

        for (var i = 0; i < disciplineHours.length; i++) {
            html += renderDisciplineHoursRow(disciplineHours[i]);
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderDisciplineHoursRow(entry) {
        if (!entry || !entry.disciplineId) { return ''; }

        var target = isFiniteNumber(entry.targetHours)
            ? entry.targetHours
            : 0;
        var scheduled = isFiniteNumber(entry.scheduledHours)
            ? entry.scheduledHours
            : 0;
        var remaining = isFiniteNumber(entry.remainingHours)
            ? entry.remainingHours
            : (target - scheduled);

        var stateClass = 'schedule-hours-row';
        if (entry.isOver) {
            stateClass += ' schedule-hours-row-over';
        } else if (remaining === 0) {
            stateClass += ' schedule-hours-row-met';
        } else {
            stateClass += ' schedule-hours-row-under';
        }

        var remainingLabel = entry.isOver
            ? (Math.abs(remaining) + 'h over')
            : (remaining + 'h left');

        var html = '';
        html += '<li class="' + stateClass + '">';

        html += '<button type="button" ' +
                    'class="schedule-hours-row-btn" ' +
                    'data-action="schedule-discipline-picker-open" ' +
                    'data-discipline-id="' +
                        escapeAttribute(entry.disciplineId) + '">';

        html += '<span class="schedule-hours-discipline">' +
                    escapeHtml(entry.disciplineName) +
                '</span>';

        html += '<span class="schedule-hours-counts">' +
                    '<span class="schedule-hours-scheduled">' +
                        scheduled +
                    '</span>' +
                    '<span class="schedule-hours-slash">/</span>' +
                    '<span class="schedule-hours-target">' +
                        target +
                    '</span>' +
                    '<span class="schedule-hours-unit">h</span>' +
                '</span>';

        html += '<span class="schedule-hours-remaining">' +
                    escapeHtml(remainingLabel) +
                '</span>';

        html += '<span class="schedule-hours-caret">\u25b8</span>';

        html += '</button>';
        html += '</li>';
        return html;
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

        // ---- Hours panel ----
        html += renderDisciplineHoursPanel(viewModel.disciplineHours);

        // ---- Co-occupants panel host ----
        html += '<div id="academy-schedule-co-occupants-host" ' +
                    'class="schedule-co-occupants-host"></div>';

        // ---- Discipline picker host ----
        html += '<div id="academy-schedule-discipline-picker-host" ' +
                    'class="schedule-discipline-picker-host"></div>';

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
