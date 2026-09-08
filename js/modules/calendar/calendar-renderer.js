/**
 * modules/calendar/calendar-renderer.js - Calendar Renderer
 * PURE rendering for calendar grids - NO event binding, NO modals, NO state
 * 
 * IMPORTANT:
 *   - PURE - no side effects, no data mutation
 *   - Input: already-prepared calendar view model
 *   - Output: HTML string
 *   - NO event binding (moved to UI layer)
 *   - NO modal creation (moved to UI layer)
 *   - NO notifications (moved to UI layer)
 *   - NO domain logic - all values already resolved
 *   - USES DomUtils.escapeHtml() - SINGLE SOURCE OF TRUTH
 * 
 * CONTRACT:
 *   - Renderer does NOT decide colours, labels, durations
 *   - Aggregator provides resolved semantic values
 *   - Renderer takes: view model -> HTML
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
            var isRestDay = showRestDays && restDays.indexOf(day) !== -1;
            var dayName = getDayName(day);
            var restClass = isRestDay ? ' schedule-rest-day' : '';
            html += '<div class="schedule-cell schedule-day schedule-header' + restClass + '">' + escapeHtml(dayName) + (isRestDay ? ' [R]' : '') + '</div>';
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

                var classes = 'schedule-cell schedule-slot';
                if (isOccupied) { classes += ' schedule-occupied'; } else { classes += ' schedule-empty'; }
                if (isRestDay) { classes += ' schedule-rest-day'; }
                if (slotData && slotData.isBlock) { classes += ' schedule-blocked'; }

                var dataAttrs = 'data-day="' + day + '" data-hour="' + hour + '"';

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
                        html += '<div class="schedule-continuation">↕</div>';
                    }

                } else if (slotData && slotData.isBlock && !isRestDay) {
                    html += '<div class="schedule-blocked-label">⛔ ' + escapeHtml(slotData.label || 'Blocked') + '</div>';

                } else if (!isRestDay && showEmptySlots) {
                    html += '<div class="schedule-empty-label">+</div>';
                }

                html += '</div>';
            }
        }

        html += '</div>';
        html += '</div>';

        // Sidebar
        if (viewModel.sidebarContent) {
            html += viewModel.sidebarContent;
        }

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
