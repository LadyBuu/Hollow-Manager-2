/**
 * js/modules/calendar/calendar-renderer.js - Calendar Renderer
 * Pure rendering for calendar grids - NO event binding, NO modals, NO state
 * Path: js/modules/calendar/calendar-renderer.js
 * 
 * This module provides:
 *   - Calendar grid HTML generation
 *   - Schedule visualization
 *   - Occupancy mapping
 *   - Duration-aware rendering
 *   - PURE rendering - no event listeners, no DOM manipulation beyond setting innerHTML
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no data mutation
 *   - All rendering is based on provided data
 *   - NO event binding (moved to UI layer)
 *   - NO modal creation (moved to UI layer)
 *   - NO notifications (moved to UI layer)
 *   - No direct window.data access
 *   - No hardcoded dependencies on specific entity types
 *   - USES DomUtils.escapeHtml() - SINGLE SOURCE OF TRUTH
 *   - USES CalendarConstants for bounds and day names
 *   - USES CalendarValidation for validation
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var renderer = window.CalendarRenderer;
 *   var html = renderer.renderGrid(state, data);
 *   container.innerHTML = html;
 *   var occupied = renderer.buildOccupiedMap(schedule);
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarRendererLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarRenderer] Missing dependencies: ' + missing.join(', '));
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var DomUtils = window.DomUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var DAY_NAMES = CalendarConstants.DAY_NAMES;
    var MIN_CLASS_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_CLASS_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // FORMAT HELPERS
    // ============================================================

    function formatHour(hour, includeMinutes) {
        return CalendarConstants.formatHour(hour, includeMinutes);
    }

    function getDayName(day) {
        return CalendarConstants.getDayName(day) || 'Unknown';
    }

    function parseHour(value) {
        return CalendarValidation.parseHour(value);
    }

    function parseDay(value) {
        return CalendarValidation.parseDay(value);
    }

    // ============================================================
    // GET AVAILABLE HOURS
    // ============================================================

    function getAvailableHours() {
        var hours = [];
        for (var h = CALENDAR_START_HOUR; h <= CALENDAR_END_HOUR; h++) {
            hours.push(h);
        }
        return hours;
    }

    // ============================================================
    // BUILD OCCUPIED MAP
    // ============================================================

    /**
     * Build an occupied hour map from a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {function} getDuration - Function to get class duration (day, hour) => number
     * @returns {object} Occupied map { day: { hour: true } }
     */
    function buildOccupiedMap(schedule, getDuration) {
        var occupied = {};

        if (!schedule) {
            return occupied;
        }

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseDay(day);
            if (dayNum === null) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                if (!daySchedule[hour]) {
                    continue;
                }

                var startHour = parseInt(hour, 10);
                if (isNaN(startHour)) {
                    continue;
                }
                var duration = getDuration ? getDuration(dayNum, startHour) : 1;

                if (!occupied[day]) {
                    occupied[day] = {};
                }

                var endHour = Math.min(startHour + duration, CALENDAR_END_HOUR + 1);
                for (var h = startHour; h < endHour; h++) {
                    occupied[day][h] = true;
                }
            }
        }

        return occupied;
    }

    /**
     * Check if a range overlaps with an occupied map.
     * 
     * @param {object} occupiedMap - Occupied map { day: { hour: true } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour
     * @param {number} duration - Duration in hours
     * @returns {boolean} True if there is an overlap
     */
    function hasOverlap(occupiedMap, day, startHour, duration) {
        var dayNum = parseDay(day);
        if (dayNum === null) {
            return true;
        }

        if (!occupiedMap[dayNum]) {
            return false;
        }

        var requestedEnd = Math.min(startHour + duration, CALENDAR_END_HOUR + 1);

        for (var h = startHour; h < requestedEnd; h++) {
            if (occupiedMap[dayNum][h]) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get a list of available hours for a day.
     * 
     * @param {object} occupiedMap - Occupied map { day: { hour: true } }
     * @param {number} day - Day number (1-7)
     * @param {number} startHour - Start hour (optional)
     * @param {number} endHour - End hour (optional)
     * @returns {array} Array of available hours
     */
    function getAvailableHours(occupiedMap, day, startHour, endHour) {
        startHour = startHour || CALENDAR_START_HOUR;
        endHour = endHour || CALENDAR_END_HOUR;

        var available = [];
        var dayNum = parseDay(day);
        if (dayNum === null) {
            return available;
        }

        if (!occupiedMap[dayNum]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!occupiedMap[dayNum][h]) {
                available.push(h);
            }
        }

        return available;
    }

    /**
     * Get available start hours for a given duration.
     * 
     * @param {object} occupiedMap - Occupied map { day: { hour: true } }
     * @param {number} day - Day number (1-7)
     * @param {number} duration - Duration in hours
     * @param {number} startHour - Start hour (optional)
     * @param {number} endHour - End hour (optional)
     * @returns {array} Array of available start hours
     */
    function getAvailableStartHours(occupiedMap, day, duration, startHour, endHour) {
        startHour = startHour || CALENDAR_START_HOUR;
        endHour = endHour || CALENDAR_END_HOUR;

        var available = [];
        var dayNum = parseDay(day);
        var durationNum = parseInt(duration, 10);

        if (dayNum === null || isNaN(durationNum) || durationNum < 1) {
            return available;
        }

        if (!occupiedMap[dayNum]) {
            for (var h = startHour; h <= endHour - durationNum + 1; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour - durationNum + 1; h++) {
            var hasConflict = false;
            for (var d = 0; d < durationNum; d++) {
                if (occupiedMap[dayNum][h + d]) {
                    hasConflict = true;
                    break;
                }
            }
            if (!hasConflict) {
                available.push(h);
            }
        }

        return available;
    }

    // ============================================================
    // RENDER CALENDAR GRID - PURE HTML GENERATION
    // ============================================================

    /**
     * Render a calendar grid as HTML string.
     * PURE function - no side effects.
     * 
     * @param {object} state - Calendar state { mode, week, selectedId }
     * @param {object} data - Calendar data
     * @param {object} data.schedule - Schedule data { day: { hour: disciplineId } }
     * @param {array} data.restDays - Array of rest day numbers (1-7)
     * @param {function} data.getDiscipline - Function to get discipline by ID
     * @param {function} data.getDuration - Function to get class duration (day, hour) => number
     * @param {function} data.getLabel - Function to get class label (day, hour) => string
     * @param {function} data.getInstructorName - Function to get instructor name (day, hour) => string
     * @param {function} data.getEntityDisplayName - Function to get entity display name
     * @param {string} data.entityName - Entity name for display
     * @param {array} data.availableItems - Available items for sidebar (optional)
     * @param {string} data.availableLabel - Label for available items (optional)
     * @param {array} data.hours - Custom hours array (optional)
     * @param {function} data.isBlock - Function to check if slot is blocked (day, hour) => boolean
     * @param {function} data.slotMetadata - Function to get slot metadata (day, hour) => string
     * @param {object} data.extraSidebar - Extra sidebar content (optional)
     * @param {string} data.modeLabel - Mode label for header
     * @param {boolean} data.showEmptySlots - Show empty slots (default: true)
     * @param {boolean} data.showRestDays - Show rest days (default: true)
     * @returns {string} HTML string
     */
    function renderGrid(state, data) {
        if (!state || !state.selectedId) {
            return '<div class="empty-state">Select an entity to view its schedule</div>';
        }

        var schedule = data.schedule || {};
        var restDays = data.restDays || [];
        var entityName = data.entityName || 'Entity';
        var modeLabel = data.modeLabel || 'Schedule';
        var showEmptySlots = data.showEmptySlots !== false;
        var showRestDays = data.showRestDays !== false;

        var hours = data.hours || getAvailableHours();

        var html = '';

        // Header
        html += '<div class="calendar-grid-container">';
        html += '<div class="calendar-grid-wrapper">';
        html += '<div class="calendar-header">';
        html += '<h3 class="calendar-title">' + escapeHtml(entityName) + ' - ' + modeLabel + ' (Week ' + state.week + ')</h3>';
        html += '</div>';

        // Grid
        html += '<div class="schedule-grid">';

        // Header row
        html += '<div class="schedule-cell schedule-time schedule-header">Time</div>';
        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
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

            for (var day = MIN_DAY; day <= MAX_DAY; day++) {
                var isRestDay = showRestDays && restDays.indexOf(day) !== -1;
                var disciplineId = schedule[day] && schedule[day][hour] ? schedule[day][hour] : null;
                var isOccupied = !!disciplineId;

                var classes = 'schedule-cell schedule-slot';
                if (isOccupied) {
                    classes += ' schedule-occupied';
                } else {
                    classes += ' schedule-empty';
                }
                if (isRestDay) {
                    classes += ' schedule-rest-day';
                }
                if (data.isBlock && data.isBlock(day, hour)) {
                    classes += ' schedule-blocked';
                }

                var dataAttrs = 'data-day="' + day + '" data-hour="' + hour + '"';
                if (isOccupied) {
                    dataAttrs += ' data-discipline="' + escapeAttribute(disciplineId) + '"';
                    var duration = data.getDuration ? data.getDuration(day, hour) : 1;
                    dataAttrs += ' data-duration="' + duration + '"';
                }

                html += '<div class="' + classes + '" ' + dataAttrs + '>';

                if (isOccupied && !isRestDay) {
                    var discipline = data.getDiscipline ? data.getDiscipline(disciplineId) : null;
                    var disciplineName = discipline ? discipline.name : 'Unknown';
                    var label = data.getLabel ? data.getLabel(day, hour) : '';
                    var duration = data.getDuration ? data.getDuration(day, hour) : 1;
                    var instructorName = data.getInstructorName ? data.getInstructorName(day, hour) : '';
                    var isBlock = data.isBlock ? data.isBlock(day, hour) : false;

                    html += '<div class="schedule-discipline-name">' + escapeHtml(disciplineName) + '</div>';
                    if (label) {
                        html += '<div class="schedule-label">[' + escapeHtml(label) + ']</div>';
                    }
                    if (instructorName) {
                        html += '<div class="schedule-instructor">' + escapeHtml(instructorName) + '</div>';
                    }
                    if (duration > 1) {
                        html += '<div class="schedule-duration">' + duration + 'h</div>';
                    }
                    if (isBlock) {
                        html += '<div class="schedule-blocked-label">[BLOCKED]</div>';
                    }

                    if (data.slotMetadata) {
                        var meta = data.slotMetadata(day, hour);
                        if (meta) {
                            html += '<div class="schedule-metadata">' + escapeHtml(meta) + '</div>';
                        }
                    }

                } else if (!isRestDay && showEmptySlots) {
                    html += '<div class="schedule-empty-label">+</div>';
                }

                html += '</div>';
            }
        }

        html += '</div>'; // end schedule-grid
        html += '</div>'; // end calendar-grid-wrapper

        // Sidebar
        html += getSidebarHTML(data);

        html += '</div>'; // end calendar-grid-container

        return html;
    }

    // ============================================================
    // SIDEBAR RENDERER
    // ============================================================

    /**
     * Render sidebar HTML.
     * 
     * @param {object} data - Calendar data
     * @returns {string} HTML string
     */
    function getSidebarHTML(data) {
        var html = '';
        html += '<div class="schedule-sidebar">';

        // Rest Days
        if (data.restDays !== undefined && data.restDays !== null) {
            html += '<div class="sidebar-section">';
            html += '<h4 class="sidebar-section-title">Rest Days</h4>';
            html += '<div class="rest-day-controls">';
            for (var d = MIN_DAY; d <= MAX_DAY; d++) {
                var checked = data.restDays.indexOf(d) !== -1 ? 'checked' : '';
                html += '<label class="rest-day-label">';
                html += '<input type="checkbox" class="rest-day-check" data-day="' + d + '" ' + checked + '>';
                html += getDayName(d);
                html += '</label>';
            }
            html += '</div>';
            html += '</div>';
        }

        // Available Items
        if (data.availableItems && data.availableItems.length > 0) {
            html += '<div class="sidebar-section">';
            html += '<h4 class="sidebar-section-title">' + (data.availableLabel || 'Available Items') + '</h4>';
            html += '<div id="available-items" class="available-items-list">';
            for (var i = 0; i < data.availableItems.length; i++) {
                var item = data.availableItems[i];
                html += '<div class="available-item" data-id="' + escapeAttribute(item.id) + '">';
                html += escapeHtml(item.label);
                if (item.subtitle) {
                    html += ' <span class="available-item-subtitle">' + escapeHtml(item.subtitle) + '</span>';
                }
                html += '</div>';
            }
            html += '</div>';
            html += '</div>';
        }

        // Extra sidebar content
        if (data.extraSidebar) {
            html += data.extraSidebar;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER EMPTY STATE
    // ============================================================

    /**
     * Render an empty state for the calendar.
     * 
     * @param {string} message - Empty state message
     * @returns {string} HTML string
     */
    function renderEmptyState(message) {
        return '<div class="empty-state">' + escapeHtml(message || 'No data available') + '</div>';
    }

    /**
     * Render a loading state.
     * 
     * @param {string} message - Loading message
     * @returns {string} HTML string
     */
    function renderLoading(message) {
        return '<div class="loading-state">' + escapeHtml(message || 'Loading...') + '</div>';
    }

    // ============================================================
    // RENDER LEGEND
    // ============================================================

    /**
     * Render a calendar legend.
     * 
     * @param {object} options - Legend options
     * @param {array} options.items - Array of { label, className } legend items
     * @returns {string} HTML string
     */
    function renderLegend(options) {
        options = options || {};
        var items = options.items || [];

        if (items.length === 0) {
            return '';
        }

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
    // EXPOSE
    // ============================================================

    window.__calendarRendererLoaded = true;

    window.CalendarRenderer = {
        // Rendering
        renderGrid: renderGrid,
        getSidebarHTML: getSidebarHTML,
        renderEmptyState: renderEmptyState,
        renderLoading: renderLoading,
        renderLegend: renderLegend,

        // Utilities
        buildOccupiedMap: buildOccupiedMap,
        hasOverlap: hasOverlap,
        getAvailableHours: getAvailableHours,
        getAvailableStartHours: getAvailableStartHours,
        getAvailableHoursList: getAvailableHours,
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,
        formatHour: formatHour,
        getDayName: getDayName,
        parseHour: parseHour,
        parseDay: parseDay,

        // Constants
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        DAY_NAMES: DAY_NAMES,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        MIN_CLASS_DURATION: MIN_CLASS_DURATION,
        MAX_CLASS_DURATION: MAX_CLASS_DURATION
    };

})();