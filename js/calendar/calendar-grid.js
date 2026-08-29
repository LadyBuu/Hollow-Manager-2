/**
 * calendar/calendar-grid.js - Shared Calendar Grid Renderer
 * Pure rendering functions for calendar grids used by all calendar views
 * Path: js/calendar/calendar-grid.js
 * 
 * This module handles:
 *   - Rendering a weekly calendar grid (days × hours)
 *   - Time slot rendering (occupied, empty, blocked)
 *   - Slot labels and metadata display
 *   - CSS class generation for slot states
 *   - Pure render functions (no event binding, no data mutation)
 * 
 * IMPORTANT:
 *   - All functions are PURE: data in, HTML/dom out
 *   - No event listeners are attached here
 *   - No data mutation occurs here
 *   - All user-controlled content is escaped
 *   - The grid is DOM-based (not string concatenation for dynamic content)
 * 
 * USAGE:
 *   var grid = CalendarGrid.render(container, data, options);
 *   // Returns a DOM element with the rendered grid
 *   // Caller is responsible for attaching events
 * 
 * OPTIONS:
 *   - mode: 'student' | 'instructor' | 'location'
 *   - days: array of day numbers (default: 1-7)
 *   - hours: array of hour numbers (default: 5-23)
 *   - onSlotClick: function(day, hour, data)
 *   - onSlotRightClick: function(day, hour, data)
 *   - formatHour: function(hour) returns string
 *   - formatDay: function(day) returns string
 *   - getSlotClass: function(slot) returns string
 *   - getSlotLabel: function(slot) returns string
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarGridLoaded) {
        return;
    }
    window.__calendarGridLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_DAYS = [1, 2, 3, 4, 5, 6, 7];
    var DEFAULT_DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    var DEFAULT_HOURS = [];
    for (var h = 5; h <= 23; h++) {
        DEFAULT_HOURS.push(h);
    }

    var DEFAULT_SELECTION_HOURS = [];
    for (var h = 8; h <= 20; h++) {
        DEFAULT_SELECTION_HOURS.push(h);
    }

    // ============================================================
    // HTML ESCAPE
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // HOUR FORMATTING
    // ============================================================

    function formatHour12(hour) {
        var h = hour;
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h === 0) { h = 12; ampm = 'AM'; }
        if (h === 12) { ampm = 'PM'; }
        if (h > 12) { h = h - 12; }
        return h + ':00 ' + ampm;
    }

    function formatHour24(hour) {
        return String(hour).padStart(2, '0') + ':00';
    }

    function formatHourShort(hour) {
        var h = hour;
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h === 0) { h = 12; ampm = 'AM'; }
        if (h === 12) { ampm = 'PM'; }
        if (h > 12) { h = h - 12; }
        return h + ampm;
    }

    function getDayName(day) {
        return DEFAULT_DAY_NAMES[day] || 'Unknown';
    }

    function getDayShort(day) {
        var names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return names[day] || 'Unknown';
    }

    // ============================================================
    // SLOT STATE HELPERS
    // ============================================================

    function isSlotOccupied(slot) {
        return slot && slot.occupied === true;
    }

    function isSlotBlocked(slot) {
        return slot && slot.blocked === true;
    }

    function isSlotEmpty(slot) {
        return !slot || (!slot.occupied && !slot.blocked);
    }

    function getSlotClass(slot, options) {
        options = options || {};
        var classes = ['time-slot'];

        if (isSlotOccupied(slot)) {
            classes.push('occupied');
            if (slot.duration && slot.duration > 1) {
                classes.push('duration-' + slot.duration);
            }
            if (slot.isTemplate) {
                classes.push('template');
            }
            if (slot.isFull) {
                classes.push('full');
            }
        } else if (isSlotBlocked(slot)) {
            classes.push('occupied');
            classes.push('blocked');
            if (slot.duration && slot.duration > 1) {
                classes.push('duration-' + slot.duration);
            }
        } else {
            classes.push('empty');
        }

        if (options.mode) {
            classes.push('mode-' + options.mode);
        }

        if (options.getSlotClass) {
            var custom = options.getSlotClass(slot);
            if (custom) {
                if (Array.isArray(custom)) {
                    classes = classes.concat(custom);
                } else {
                    classes.push(custom);
                }
            }
        }

        return classes.join(' ');
    }

    // ============================================================
    // SLOT LABEL GENERATION
    // ============================================================

    function getSlotLabel(slot, options) {
        options = options || {};

        if (isSlotEmpty(slot)) {
            return options.emptyLabel || '+';
        }

        if (isSlotBlocked(slot)) {
            var label = slot.label || 'Blocked Time';
            if (slot.groupLabel) {
                label += ' (G' + slot.groupLabel + ')';
            }
            if (slot.duration && slot.duration > 1) {
                label += ' (' + slot.duration + 'h)';
            }
            return label;
        }

        // Occupied slot
        var parts = [];

        if (slot.disciplineName) {
            parts.push(slot.disciplineName);
        } else if (slot.disciplineId) {
            parts.push('Class');
        }

        if (slot.label) {
            parts.push('[' + slot.label + ']');
        }

        if (slot.groupLabel) {
            parts.push('(G' + slot.groupLabel + ')');
        }

        if (slot.duration && slot.duration > 1) {
            parts.push('(' + slot.duration + 'h)');
        }

        if (slot.isTemplate && (!slot.students || slot.students.length === 0)) {
            parts.push('(template)');
        }

        if (slot.students && slot.students.length > 0) {
            parts.push(' - ' + slot.students.length + ' students');
        }

        if (slot.isFull) {
            parts.push('FULL');
        }

        return parts.join(' ') || options.occupiedLabel || 'Class';
    }

    // ============================================================
    // SLOT DATA NORMALISATION
    // ============================================================

    function normaliseSlot(slot, options) {
        options = options || {};

        if (!slot) {
            return {
                occupied: false,
                blocked: false,
                disciplineId: null,
                disciplineName: null,
                duration: 1,
                students: [],
                label: null,
                groupLabel: null,
                instructorId: null,
                instructorName: null,
                isTemplate: false,
                isFull: false,
                data: null
            };
        }

        return {
            occupied: slot.occupied === true,
            blocked: slot.blocked === true,
            disciplineId: slot.disciplineId || null,
            disciplineName: slot.disciplineName || null,
            duration: slot.duration || 1,
            students: Array.isArray(slot.students) ? slot.students : [],
            label: slot.label || null,
            groupLabel: slot.groupLabel || null,
            instructorId: slot.instructorId || null,
            instructorName: slot.instructorName || null,
            isTemplate: slot.isTemplate === true,
            isFull: slot.isFull === true,
            data: slot.data || null
        };
    }

    // ============================================================
    // MAIN RENDER FUNCTION
    // ============================================================

    function render(container, data, options) {
        options = options || {};

        // Validate container
        if (!container) {
            return null;
        }

        // Defaults
        var days = options.days || DEFAULT_DAYS;
        var hours = options.hours || DEFAULT_HOURS;
        var mode = options.mode || 'student';
        var dayNames = options.dayNames || DEFAULT_DAY_NAMES;

        // Formatting functions
        var formatHour = options.formatHour || formatHourShort;
        var formatDay = options.formatDay || function(day) {
            return dayNames[day] || 'Day ' + day;
        };

        // Build grid
        var grid = buildGrid(data, days, hours, options);

        // Create container
        var wrapper = document.createElement('div');
        wrapper.className = 'schedule-grid-wrapper';

        var gridEl = document.createElement('div');
        gridEl.className = 'schedule-grid' + (options.gridClass ? ' ' + options.gridClass : '');

        // Render each day column
        days.forEach(function(day) {
            var column = renderDayColumn(day, grid[day], hours, options);
            gridEl.appendChild(column);
        });

        wrapper.appendChild(gridEl);

        // Render legend if requested
        if (options.showLegend) {
            var legend = renderLegend(options);
            wrapper.appendChild(legend);
        }

        return wrapper;
    }

    // ============================================================
    // BUILD GRID DATA
    // ============================================================

    function buildGrid(data, days, hours, options) {
        var grid = {};

        days.forEach(function(day) {
            grid[day] = {};

            hours.forEach(function(hour) {
                var slot = null;

                // Get slot data from source
                if (data && data[day] && data[day][hour]) {
                    slot = data[day][hour];
                }

                // Normalise slot
                var normalised = normaliseSlot(slot, options);

                // Apply any transformations
                if (options.transformSlot) {
                    normalised = options.transformSlot(normalised, day, hour) || normalised;
                }

                grid[day][hour] = normalised;
            });
        });

        return grid;
    }

    // ============================================================
    // RENDER DAY COLUMN
    // ============================================================

    function renderDayColumn(day, dayData, hours, options) {
        var column = document.createElement('div');
        column.className = 'day-column';
        column.dataset.day = day;

        // Day header
        var header = document.createElement('div');
        header.className = 'day-header';
        var dayName = options.formatDay ? options.formatDay(day) : getDayName(day);
        header.textContent = dayName;
        column.appendChild(header);

        // Slots container
        var slotsContainer = document.createElement('div');
        slotsContainer.className = 'day-slots';

        var occupiedHours = {};

        hours.forEach(function(hour) {
            // Skip if hour is already occupied by a multi-hour class
            if (occupiedHours[hour]) {
                return;
            }

            var slot = dayData[hour];

            // Check if this slot has a duration that extends beyond this hour
            if (slot && slot.duration && slot.duration > 1) {
                var dur = slot.duration;
                for (var h = hour + 1; h < hour + dur && h <= 23; h++) {
                    occupiedHours[h] = true;
                }
            }

            var slotEl = renderSlot(day, hour, slot, options);
            slotsContainer.appendChild(slotEl);
        });

        column.appendChild(slotsContainer);

        return column;
    }

    // ============================================================
    // RENDER INDIVIDUAL SLOT
    // ============================================================

    function renderSlot(day, hour, slot, options) {
        var slotEl = document.createElement('div');
        slotEl.className = getSlotClass(slot, options);
        slotEl.dataset.day = day;
        slotEl.dataset.hour = hour;

        if (slot.data) {
            slotEl.dataset.slotData = JSON.stringify(slot.data);
        }

        // Time label
        var timeLabel = document.createElement('span');
        timeLabel.className = 'slot-time';
        var hourDisplay = options.formatHour ? options.formatHour(hour) : formatHourShort(hour);
        timeLabel.textContent = hourDisplay;
        slotEl.appendChild(timeLabel);

        // Content label
        var contentLabel = document.createElement('span');
        contentLabel.className = 'slot-label';

        if (isSlotEmpty(slot)) {
            contentLabel.textContent = options.emptyLabel || '+';
        } else {
            var labelText = getSlotLabel(slot, options);
            contentLabel.textContent = labelText;
        }

        slotEl.appendChild(contentLabel);

        // Additional metadata if provided
        if (slot.students && slot.students.length > 0 && options.showStudentCount !== false) {
            var countBadge = document.createElement('span');
            countBadge.className = 'slot-count';
            countBadge.textContent = slot.students.length;
            slotEl.appendChild(countBadge);
        }

        // Apply custom attributes
        if (options.getSlotAttributes) {
            var attrs = options.getSlotAttributes(slot, day, hour);
            if (attrs) {
                for (var key in attrs) {
                    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
                        slotEl.setAttribute(key, attrs[key]);
                    }
                }
            }
        }

        return slotEl;
    }

    // ============================================================
    // RENDER LEGEND
    // ============================================================

    function renderLegend(options) {
        var legend = document.createElement('div');
        legend.className = 'schedule-legend';

        var items = options.legendItems || [];

        if (items.length === 0) {
            // Default legend items based on mode
            if (options.mode === 'student') {
                items = [
                    { label: 'Scheduled Class', color: 'var(--accent)' },
                    { label: 'Rest Day', color: 'var(--danger-soft)' },
                    { label: 'Empty Slot', color: 'var(--border-soft)' }
                ];
            } else if (options.mode === 'instructor') {
                items = [
                    { label: 'Teaching', color: 'var(--accent)' },
                    { label: 'Template Class', color: 'var(--warning)' },
                    { label: 'Blocked Time', color: 'var(--danger)' },
                    { label: 'Empty Slot', color: 'var(--border-soft)' }
                ];
            } else if (options.mode === 'location') {
                items = [
                    { label: 'Assigned Class', color: 'var(--accent)' },
                    { label: 'Available', color: 'var(--border-soft)' }
                ];
            }
        }

        items.forEach(function(item) {
            var itemEl = document.createElement('span');
            itemEl.className = 'legend-item';

            var colorBox = document.createElement('span');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = item.color || 'var(--border)';

            var label = document.createElement('span');
            label.className = 'legend-label';
            label.textContent = item.label;

            itemEl.appendChild(colorBox);
            itemEl.appendChild(label);
            legend.appendChild(itemEl);
        });

        return legend;
    }

    // ============================================================
    // UPDATE FUNCTIONS
    // ============================================================

    function updateSlot(slotEl, slot, options) {
        if (!slotEl || !slot) return;

        // Update class
        slotEl.className = getSlotClass(slot, options);

        // Update label
        var labelEl = slotEl.querySelector('.slot-label');
        if (labelEl) {
            if (isSlotEmpty(slot)) {
                labelEl.textContent = options.emptyLabel || '+';
            } else {
                labelEl.textContent = getSlotLabel(slot, options);
            }
        }

        // Update count badge
        var countBadge = slotEl.querySelector('.slot-count');
        if (countBadge) {
            if (slot.students && slot.students.length > 0) {
                countBadge.textContent = slot.students.length;
                countBadge.style.display = '';
            } else {
                countBadge.style.display = 'none';
            }
        }

        // Update data attributes
        if (slot.data) {
            slotEl.dataset.slotData = JSON.stringify(slot.data);
        }

        // Update style for duration
        if (slot.duration && slot.duration > 1) {
            slotEl.style.minHeight = (30 * slot.duration) + 'px';
            slotEl.style.height = (30 * slot.duration) + 'px';
        } else {
            slotEl.style.minHeight = '';
            slotEl.style.height = '';
        }
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getSlotFromElement(el) {
        if (!el) return null;

        var day = parseInt(el.dataset.day, 10);
        var hour = parseInt(el.dataset.hour, 10);

        if (isNaN(day) || isNaN(hour)) {
            return null;
        }

        var slotData = el.dataset.slotData;
        if (slotData) {
            try {
                return JSON.parse(slotData);
            } catch (e) {
                // ignore
            }
        }

        return {
            day: day,
            hour: hour,
            occupied: el.classList.contains('occupied'),
            blocked: el.classList.contains('blocked'),
            empty: el.classList.contains('empty')
        };
    }

    function getSlotPosition(day, hour) {
        return {
            day: day,
            hour: hour
        };
    }

    function createEmptySlot(day, hour) {
        return {
            day: day,
            hour: hour,
            occupied: false,
            blocked: false,
            disciplineId: null,
            disciplineName: null,
            duration: 1,
            students: [],
            label: null,
            groupLabel: null,
            instructorId: null,
            instructorName: null,
            isTemplate: false,
            isFull: false,
            data: null
        };
    }

    function createOccupiedSlot(disciplineId, disciplineName, options) {
        options = options || {};
        return {
            occupied: true,
            blocked: false,
            disciplineId: disciplineId,
            disciplineName: disciplineName,
            duration: options.duration || 1,
            students: options.students || [],
            label: options.label || null,
            groupLabel: options.groupLabel || null,
            instructorId: options.instructorId || null,
            instructorName: options.instructorName || null,
            isTemplate: options.isTemplate || false,
            isFull: options.isFull || false,
            data: options.data || null
        };
    }

    function createBlockedSlot(label, options) {
        options = options || {};
        return {
            occupied: true,
            blocked: true,
            disciplineId: null,
            disciplineName: null,
            duration: options.duration || 1,
            students: [],
            label: label || 'Blocked Time',
            groupLabel: options.groupLabel || null,
            instructorId: null,
            instructorName: null,
            isTemplate: false,
            isFull: false,
            data: options.data || null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarGrid = {
        // Main render
        render: render,

        // Build helpers
        buildGrid: buildGrid,
        normaliseSlot: normaliseSlot,

        // Slot creation
        createEmptySlot: createEmptySlot,
        createOccupiedSlot: createOccupiedSlot,
        createBlockedSlot: createBlockedSlot,

        // Slot queries
        getSlotFromElement: getSlotFromElement,
        getSlotPosition: getSlotPosition,
        isSlotOccupied: isSlotOccupied,
        isSlotBlocked: isSlotBlocked,
        isSlotEmpty: isSlotEmpty,

        // Slot manipulation
        updateSlot: updateSlot,

        // Formatting
        formatHour12: formatHour12,
        formatHour24: formatHour24,
        formatHourShort: formatHourShort,
        getDayName: getDayName,
        getDayShort: getDayShort,

        // Constants
        DEFAULT_DAYS: DEFAULT_DAYS,
        DEFAULT_HOURS: DEFAULT_HOURS,
        DEFAULT_SELECTION_HOURS: DEFAULT_SELECTION_HOURS,
        DEFAULT_DAY_NAMES: DEFAULT_DAY_NAMES
    };

})();
