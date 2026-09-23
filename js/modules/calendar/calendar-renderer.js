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
 *     Empty. Mounted by the location controller.
 *
 *   #academy-schedule-hours-host
 *     Rendered with the discipline-hours panel when the VM
 *     carries a non-empty `disciplineHours` array.
 *
 *   #academy-schedule-discipline-picker-host
 *     Empty. Mounted by the controller when a discipline row
 *     is clicked.
 *
 * GROUP LABEL:
 *   Each occupied cell carries a groupLabel sub-line. The label
 *   is resolved by AcademyCalendarAggregator from the group's
 *   customName or, failing that, `Discipline + Letter`. When the
 *   label is empty AND the slot carries a groupId, the renderer
 *   falls back to a short id stub so two cells from the same
 *   discipline are never visually identical. The fallback is
 *   deliberately terse; a group with a broken display-name
 *   pipeline should be obvious at a glance, not silently
 *   indistinguishable.
 *
 * GROUP COLOR:
 *   Each occupied cell carries a color derived from the group's
 *   groupNumber. The color is an INDEX on the slot
 *   (`slotData.groupColorIndex`), resolved by
 *   AcademyCalendarAggregator. The renderer maps the index to a
 *   CSS class `acad-group-color-N` and appends it to the cell's
 *   class list. The palette size is fixed by the aggregator
 *   (`GROUP_COLOR_PALETTE_SIZE`); the CSS must define classes
 *   for every index in [0, PALETTE_SIZE).
 *
 *   A slot with no group, or with a color index the aggregator
 *   could not resolve, gets no color class. The cell renders
 *   with the neutral `.schedule-occupied` styling.
 *
 * HOURS PANEL — CURRENT GROUP:
 *   Each discipline-hours row optionally carries a
 *   `currentGroup` sub-block, listing the group the student is
 *   already in for that discipline:
 *
 *     English 4/6h 2h left
 *       English 1 · Ms. Chen
 *       4 classmates
 *
 *   The sub-block is display-only. It has no action; the row's
 *   button is still the only interactive element.
 *
 * DISCIPLINE HOURS ROW:
 *   Button. Emits data-action="schedule-discipline-picker-open"
 *   with data-discipline-id.
 *
 * CO-OCCUPANCY MARKER:
 *   Button. Emits data-action="schedule-co-occupants-open".
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
    // GROUP LABEL FALLBACK
    // ============================================================
    //
    // The aggregator resolves groupLabel from the group record.
    // When that lookup fails — missing group, missing
    // AcademyTeachingGroups, a malformed record — the slot's
    // groupLabel is empty. Two groups of the same discipline would
    // then render as identical cells.
    //
    // The renderer's fallback: when groupLabel is empty but the
    // slot carries a groupId, render the last six characters of
    // the id. This is ugly on purpose. It is not a display name;
    // it is a signal that the display-name pipeline is broken.
    // A developer glancing at the calendar will see the stub and
    // know to look at the aggregator, rather than assuming two
    // groups are one.

    function getGroupLabelForRender(slotData) {
        if (!slotData) { return ''; }

        if (isFiniteNumber(slotData.duration) &&
            typeof slotData.groupLabel === 'string' &&
            slotData.groupLabel.trim() !== '') {
            return slotData.groupLabel;
        }

        // Fall through to the id stub. A slot without a groupId
        // gets no label at all.
        if (typeof slotData.groupId === 'string' &&
            slotData.groupId !== '') {
            var gid = slotData.groupId;
            if (gid.length > 6) {
                return gid.slice(-6);
            }
            return gid;
        }

        return '';
    }

    // ============================================================
    // GROUP COLOR CLASS
    // ============================================================
    //
    // Maps the slot's groupColorIndex (an integer from the
    // aggregator) to a CSS class name.
    //
    // Contract:
    //   - The index is null when the slot has no group, or when
    //     the aggregator could not resolve a color for the group.
    //     In that case, no class is returned and the cell renders
    //     with the neutral .schedule-occupied styling.
    //   - The index is a non-negative integer otherwise. The CSS
    //     file defines .acad-group-color-0 through
    //     .acad-group-color-(N-1), where N is the aggregator's
    //     GROUP_COLOR_PALETTE_SIZE.
    //   - A negative or non-integer index is treated as absent.
    //     The aggregator never emits one, but the guard keeps a
    //     malformed VM from producing a bogus class like
    //     "acad-group-color-NaN".
    //
    // The class name is not validated against the palette size.
    // If the aggregator's palette grows, the CSS must grow with
    // it; the two are kept in sync by the constant the aggregator
    // exports.

    function getGroupColorClass(slotData) {
        if (!slotData) { return ''; }

        var idx = slotData.groupColorIndex;

        if (idx === null || idx === undefined) { return ''; }
        if (typeof idx !== 'number' || !isFinite(idx)) { return ''; }
        if (idx < 0) { return ''; }
        if (Math.floor(idx) !== idx) { return ''; }

        return 'acad-group-color-' + idx;
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

        html += renderCurrentGroupBlock(entry.currentGroup);

        html += '</li>';
        return html;
    }

    /**
     * The current-group sub-block, shown below the row's button
     * when the student is already a member of a group for the
     * discipline. Display-only: no action, no click target.
     *
     * Two lines:
     *   GroupName · InstructorName
     *   N classmates
     *
     * When the group has no instructor, only the group name
     * renders on the first line. When N === 0, "0 classmates"
     * still renders so the reader sees the zero explicitly.
     */
    function renderCurrentGroupBlock(currentGroup) {
        if (!currentGroup || !currentGroup.groupId) {
            return '';
        }

        var displayName;
        if (typeof currentGroup.displayName !== 'string' ||
            currentGroup.displayName === '') {
            displayName = 'Unnamed Group';
        } else {
            displayName = currentGroup.displayName;
        }

        var instructorName = (typeof currentGroup.instructorName === 'string')
            ? currentGroup.instructorName.trim()
            : '';

        var classmateCount = isFiniteNumber(currentGroup.classmateCount)
            ? currentGroup.classmateCount
            : 0;

        var classmateLabel = classmateCount === 1
            ? '1 classmate'
            : classmateCount + ' classmates';

        var html = '';
        html += '<div class="schedule-hours-current-group">';

        html += '<div class="schedule-hours-current-group-line">';
        html += '<span class="schedule-hours-current-group-name">' +
                    escapeHtml(displayName) +
                '</span>';
        if (instructorName !== '') {
            html += '<span class="schedule-hours-current-group-sep">' +
                        '\u00b7' +
                    '</span>';
            html += '<span class="schedule-hours-current-group-instructor">' +
                        escapeHtml(instructorName) +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="schedule-hours-current-group-meta">' +
                    escapeHtml(classmateLabel) +
                '</div>';

        html += '</div>';
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

                // ---- Group color class ----
                //
                // Applied only to occupied cells. An empty cell
                // has no group and no color. A blocked cell is
                // not a group either; the blocked styling wins.
                if (isOccupied && !isRestDay) {
                    var colorClass = getGroupColorClass(slotData);
                    if (colorClass !== '') {
                        classes += ' ' + colorClass;
                    }
                }

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
                    var groupLabel = getGroupLabelForRender(slotData);

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
