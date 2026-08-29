/**
 * utils/calendar-utils.js - Calendar Utility Functions
 * Shared helper functions for calendar operations
 * Path: js/utils/calendar-utils.js
 * 
 * This module provides:
 *   - Day and hour formatting
 *   - Week calculations (based on a consistent day-of-year model)
 *   - Time slot utilities
 *   - Date comparison helpers
 *   - Schedule validation helpers
 * 
 * IMPORTANT:
 *   - All functions are PURE: no side effects, no data mutation
 *   - No DOM manipulation
 *   - No dependencies on window.data or CoreUtils
 *   - Safe for use in any context
 * 
 * WEEK MODEL:
 *   - Week 1 = days 1-7 of the year
 *   - Week 2 = days 8-14
 *   - ... Week N = days ((N-1)*7 + 1) through min(N*7, daysInYear)
 *   - Number of weeks in a year varies (52 or 53 depending on the year)
 *   - getWeekFromDate() and getWeekStartDate() are inverses in the sense that
 *     getWeekStartDate(getWeekFromDate(date)) returns the first day of the week
 *   - All week functions take an optional year parameter
 *   - year defaults to current year if not provided
 * 
 * SCHEDULE OCCUPANCY CONVENTION:
 *   - undefined, null, or '' = empty/unoccupied
 *   - Any other value (including 0, false, "0") = occupied
 *   - This applies to all schedule-related functions
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarUtilsLoaded) {
        return;
    }
    window.__calendarUtilsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var DAY_NAMES_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    var DAY_NAMES_1_INDEXED = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DAY_NAMES_SHORT_1_INDEXED = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var DAY_NAMES_MIN_1_INDEXED = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    var MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var HOUR_FORMAT_12 = '12h';
    var HOUR_FORMAT_24 = '24h';
    var HOUR_FORMAT_SHORT = 'short';

    var DAYS_IN_WEEK = 7;
    var CALENDAR_START_HOUR = 5;
    var CALENDAR_END_HOUR = 23;

    // ============================================================
    // HELPER: Canonical year normalisation
    // ============================================================

    function _normaliseYear(year) {
        if (year === undefined || year === null) {
            return new Date().getFullYear();
        }

        // Try to convert to number
        var num = Number(year);

        // Reject NaN, Infinity, or out-of-range years
        if (!Number.isFinite(num) || num < 0 || num > 9999) {
            return new Date().getFullYear();
        }

        // Floor to integer (e.g., 2026.9 → 2026)
        return Math.floor(num);
    }

    // ============================================================
    // HELPER: Days in year (calendar-date based)
    // ============================================================

    function getDaysInYear(year) {
        var y = _normaliseYear(year);

        // February 29 exists if the month after February is still February
        // i.e., new Date(y, 1, 29).getMonth() === 1 means it exists
        return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
    }

    function getWeeksInYear(year) {
        var y = _normaliseYear(year);
        return Math.ceil(getDaysInYear(y) / DAYS_IN_WEEK);
    }

    // ============================================================
    // DAY HELPERS (1-INDEXED: Monday = 1, Sunday = 7)
    // ============================================================

    function getDayName(day, format) {
        format = format || 'full';

        if (!Number.isInteger(day) || day < 1 || day > 7) {
            return 'Unknown';
        }

        switch (format) {
            case 'full':
                return DAY_NAMES_1_INDEXED[day] || 'Unknown';
            case 'short':
                return DAY_NAMES_SHORT_1_INDEXED[day] || 'Unknown';
            case 'min':
                return DAY_NAMES_MIN_1_INDEXED[day] || 'Unknown';
            default:
                return DAY_NAMES_1_INDEXED[day] || 'Unknown';
        }
    }

    function getDayName0(day, format) {
        format = format || 'full';

        if (!Number.isInteger(day) || day < 0 || day > 6) {
            return 'Unknown';
        }

        switch (format) {
            case 'full':
                return DAY_NAMES[day] || 'Unknown';
            case 'short':
                return DAY_NAMES_SHORT[day] || 'Unknown';
            case 'min':
                return DAY_NAMES_MIN[day] || 'Unknown';
            default:
                return DAY_NAMES[day] || 'Unknown';
        }
    }

    function getDayNumber(dayName) {
        if (typeof dayName !== 'string') return null;

        var normalized = dayName.trim().toLowerCase();
        var map = {
            'monday': 1, 'mon': 1,
            'tuesday': 2, 'tue': 2,
            'wednesday': 3, 'wed': 3,
            'thursday': 4, 'thu': 4,
            'friday': 5, 'fri': 5,
            'saturday': 6, 'sat': 6,
            'sunday': 7, 'sun': 7
        };

        return map[normalized] || null;
    }

    function isWeekend(day) {
        return day === 6 || day === 7;
    }

    function isWeekday(day) {
        return day >= 1 && day <= 5;
    }

    function getDayRange(startDay, endDay) {
        if (!Number.isInteger(startDay) || !Number.isInteger(endDay) ||
            startDay < 1 || endDay > 7 || startDay > endDay) {
            return [];
        }

        var days = [];
        for (var d = startDay; d <= endDay; d++) {
            days.push(d);
        }
        return days;
    }

    function getWeekDays() {
        return [1, 2, 3, 4, 5, 6, 7];
    }

    function getWeekdays() {
        return [1, 2, 3, 4, 5];
    }

    function getWeekendDays() {
        return [6, 7];
    }

    // ============================================================
    // HOUR HELPERS
    // ============================================================

    function formatHour(hour, format) {
        format = format || HOUR_FORMAT_SHORT;

        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return '?';
        }

        switch (format) {
            case HOUR_FORMAT_12: {
                var h12 = hour % 12 || 12;
                var ampm = hour >= 12 ? 'PM' : 'AM';
                return h12 + ':00 ' + ampm;
            }
            case HOUR_FORMAT_24: {
                var h24 = String(hour).padStart(2, '0');
                return h24 + ':00';
            }
            case HOUR_FORMAT_SHORT: {
                var h = hour % 12 || 12;
                var a = hour >= 12 ? 'PM' : 'AM';
                return h + a;
            }
            default:
                return String(hour);
        }
    }

    function formatHourRange(startHour, endHour, format) {
        var start = formatHour(startHour, format);
        var end = formatHour(endHour, format);
        return start + ' - ' + end;
    }

    function getHourDisplay(hour) {
        return formatHour(hour, HOUR_FORMAT_SHORT);
    }

    function getHour12(hour) {
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return null;
        }
        return hour % 12 || 12;
    }

    function getAmPm(hour) {
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return null;
        }
        return hour >= 12 ? 'PM' : 'AM';
    }

    function getHourRange(startHour, endHour) {
        if (!Number.isInteger(startHour) || !Number.isInteger(endHour) ||
            startHour < 0 || endHour > 23 || startHour > endHour) {
            return [];
        }

        var hours = [];
        for (var h = startHour; h <= endHour; h++) {
            hours.push(h);
        }
        return hours;
    }

    function getDefaultHours() {
        return getHourRange(CALENDAR_START_HOUR, CALENDAR_END_HOUR);
    }

    function getSelectionHours() {
        return getHourRange(8, 20);
    }

    function getMorningHours() {
        return getHourRange(5, 12);
    }

    function getAfternoonHours() {
        return getHourRange(13, 17);
    }

    function getEveningHours() {
        return getHourRange(18, 23);
    }

    function isBusinessHour(hour) {
        return hour >= 8 && hour <= 20;
    }

    function isMorning(hour) {
        return hour >= 5 && hour < 12;
    }

    function isAfternoon(hour) {
        return hour >= 12 && hour < 18;
    }

    function isEvening(hour) {
        return hour >= 18 && hour <= 23;
    }

    // ============================================================
    // WEEK HELPERS - Consistent day-of-year model
    // ============================================================

    function validateWeek(week) {
        var num = Number(week);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getWeekLabel(week) {
        var w = validateWeek(week);
        return w !== null ? 'Week ' + w : 'Invalid Week';
    }

    function getWeekRange(week, year) {
        var w = validateWeek(week);
        if (w === null) return null;

        year = _normaliseYear(year);
        var daysInYear = getDaysInYear(year);
        var start = (w - 1) * 7 + 1;

        if (start > daysInYear) return null;

        return {
            start: start,
            end: Math.min(start + 6, daysInYear)
        };
    }

    /**
     * Get the block number for a week (pair grouping).
     * Blocks are 1-indexed: weeks 1-2 = block 1, weeks 3-4 = block 2, etc.
     * This is used for UI grouping, not a universal calendar concept.
     * 
     * Note: For weeks beyond the year's actual week count, this still returns
     * a block value. Callers should validate the week exists first if needed.
     */
    function getWeekBlock(week) {
        var w = validateWeek(week);
        if (w === null) return null;

        var start = Math.floor((w - 1) / 2) * 2 + 1;
        var end = start + 1;
        return {
            start: start,
            end: end,
            label: start + '-' + end
        };
    }

    /**
     * Get the week number from a date.
     * Uses calendar day-of-year (UTC-based) to avoid DST issues.
     * 
     * Note: getWeekStartDate(getWeekFromDate(date)) returns the first day
     * of the week containing the given date, not necessarily the date itself.
     */
    function getWeekFromDate(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return null;

        var year = date.getFullYear();
        var dayOfYear = Math.floor(
            (Date.UTC(year, date.getMonth(), date.getDate()) -
             Date.UTC(year, 0, 1)) / 86400000
        ) + 1;

        return Math.floor((dayOfYear - 1) / 7) + 1;
    }

    /**
     * Get the start date for a week.
     * Returns the first day of the week (day-of-year calculation).
     * 
     * Note: getWeekFromDate(getWeekStartDate(week, year)) returns week
     * for any date in that week, not necessarily week itself for the first day.
     */
    function getWeekStartDate(week, year) {
        var w = validateWeek(week);
        if (w === null) return null;

        year = _normaliseYear(year);
        var dayOfYear = (w - 1) * 7 + 1;
        var daysInYear = getDaysInYear(year);

        if (dayOfYear > daysInYear) return null;

        return new Date(year, 0, dayOfYear);
    }

    function getWeekDisplay(week, year) {
        var w = validateWeek(week);
        if (w === null) return 'Week ?';

        year = _normaliseYear(year);

        var range = getWeekRange(w, year);
        if (!range) return 'Week ' + w;

        var startDate = new Date(year, 0, range.start);
        var endDate = new Date(year, 0, range.end);

        var startMonth = MONTH_NAMES_SHORT[startDate.getMonth()];
        var endMonth = MONTH_NAMES_SHORT[endDate.getMonth()];

        if (startMonth === endMonth) {
            return 'Week ' + w + ' (' + startMonth + ' ' + startDate.getDate() + '-' + endDate.getDate() + ')';
        }

        return 'Week ' + w + ' (' + startMonth + ' ' + startDate.getDate() + ' - ' + endMonth + ' ' + endDate.getDate() + ')';
    }

    function getWeekNavigation(week, year) {
        var w = validateWeek(week);

        if (w === null) {
            var defaultMax = getWeeksInYear(year);
            return {
                current: 1,
                prev: null,
                next: defaultMax > 1 ? 2 : null,
                hasPrev: false,
                hasNext: defaultMax > 1
            };
        }

        year = _normaliseYear(year);
        var maxWeek = getWeeksInYear(year);

        // Clamp to valid range
        var current = Math.min(w, maxWeek);

        return {
            current: current,
            prev: current > 1 ? current - 1 : null,
            next: current < maxWeek ? current + 1 : null,
            hasPrev: current > 1,
            hasNext: current < maxWeek,
            maxWeek: maxWeek
        };
    }

    // ============================================================
    // TIME SLOT HELPERS
    // ============================================================

    function getSlotKey(day, hour) {
        if (!isValidSlot(day, hour)) return null;
        return day + '_' + hour;
    }

    function parseSlotKey(key) {
        if (typeof key !== 'string') return null;

        var parts = key.split('_');
        if (parts.length !== 2) return null;

        var day = Number(parts[0]);
        var hour = Number(parts[1]);

        if (!Number.isInteger(day) || !Number.isInteger(hour)) {
            return null;
        }

        if (day < 1 || day > 7) return null;
        if (hour < 0 || hour > 23) return null;

        return { day: day, hour: hour };
    }

    function getSlotDurationKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function getSlotLabel(day, hour, duration, label) {
        var parts = [];
        parts.push(getDayName(day, 'short'));
        parts.push(formatHour(hour, HOUR_FORMAT_SHORT));

        var dur = Number(duration);
        if (Number.isInteger(dur) && dur > 1) {
            parts.push('(' + dur + 'h)');
        }

        if (label !== undefined && label !== null && String(label).trim() !== '') {
            parts.push('[' + String(label).trim() + ']');
        }

        return parts.join(' ');
    }

    function getSlotDisplay(day, hour, duration) {
        var dayName = getDayName(day, 'short');
        var hourDisplay = formatHour(hour, HOUR_FORMAT_SHORT);

        var dur = Number(duration);
        if (Number.isInteger(dur) && dur > 1) {
            return dayName + ' ' + hourDisplay + ' (' + dur + 'h)';
        }
        return dayName + ' ' + hourDisplay;
    }

    /**
     * Get continuous occupied hours of the same discipline.
     * Uses string comparison for discipline IDs to handle numeric/string mix.
     * Returns null if the slot is empty.
     */
    function getContinuousSlots(schedule, day, hour) {
        if (!schedule || !schedule[day]) {
            return null;
        }

        var slot = schedule[day][hour];
        if (slot === undefined || slot === null || slot === '') {
            return null;
        }

        var disciplineId = slot;
        var startHour = hour;

        while (startHour > 0) {
            var prev = schedule[day][startHour - 1];
            if (prev === undefined || prev === null || prev === '') {
                break;
            }
            if (String(prev) !== String(disciplineId)) {
                break;
            }
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23) {
            var next = schedule[day][endHour + 1];
            if (next === undefined || next === null || next === '') {
                break;
            }
            if (String(next) !== String(disciplineId)) {
                break;
            }
            endHour++;
        }

        return {
            disciplineId: disciplineId,
            startHour: startHour,
            endHour: endHour,
            duration: endHour - startHour + 1
        };
    }

    /**
     * Get available (empty) slots in a day.
     * Uses the occupancy convention: undefined, null, '' = empty.
     */
    function getAvailableSlots(schedule, day, startHour, endHour) {
        if (startHour === undefined || startHour === null) {
            startHour = CALENDAR_START_HOUR;
        }
        if (endHour === undefined || endHour === null) {
            endHour = CALENDAR_END_HOUR;
        }

        if (!Number.isInteger(startHour) || !Number.isInteger(endHour) ||
            startHour < 0 || endHour > 23 || startHour > endHour) {
            return [];
        }

        var available = [];
        if (!schedule || !schedule[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            var slot = schedule[day][h];
            if (slot === undefined || slot === null || slot === '') {
                available.push(h);
            }
        }
        return available;
    }

    /**
     * Check if a slot has a conflict (overlaps with existing occupied slots).
     * Returns true if any hour in the range is occupied.
     * Returns true if the requested range extends beyond the calendar boundary.
     */
    function hasSlotConflict(schedule, day, hour, duration) {
        if (duration === undefined || duration === null) {
            duration = 1;
        }

        if (!isValidDay(day) || !isValidHour(hour)) {
            return true;
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return true;
        }

        // Check if the range extends beyond the calendar boundary
        if (hour + durationNum - 1 > CALENDAR_END_HOUR) {
            return true;
        }

        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + durationNum; h++) {
            var slot = schedule[day][h];
            if (slot !== undefined && slot !== null && slot !== '') {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a slot range is valid (within calendar bounds).
     */
    function isValidSlotRange(day, hour, duration) {
        if (!isValidDay(day)) return false;
        if (!isValidHour(hour)) return false;

        var durationNum = validateDuration(duration);
        if (durationNum === null) return false;

        return hour + durationNum - 1 <= CALENDAR_END_HOUR;
    }

    // ============================================================
    // DATE HELPERS
    // ============================================================

    function getMonthName(month, format) {
        format = format || 'full';

        if (!Number.isInteger(month) || month < 0 || month > 11) {
            return 'Unknown';
        }

        switch (format) {
            case 'full':
                return MONTH_NAMES[month] || 'Unknown';
            case 'short':
                return MONTH_NAMES_SHORT[month] || 'Unknown';
            default:
                return MONTH_NAMES[month] || 'Unknown';
        }
    }

    function getDateDisplay(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return 'Invalid Date';

        var month = getMonthName(date.getMonth(), 'short');
        var day = date.getDate();
        var year = date.getFullYear();
        return month + ' ' + day + ', ' + year;
    }

    function getTimeDisplay(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return 'Invalid Time';

        var hours = date.getHours();
        var minutes = date.getMinutes();
        var ampm = hours >= 12 ? 'PM' : 'AM';
        var h12 = hours % 12 || 12;
        var m = String(minutes).padStart(2, '0');
        return h12 + ':' + m + ' ' + ampm;
    }

    function getDateTimeDisplay(date) {
        return getDateDisplay(date) + ' at ' + getTimeDisplay(date);
    }

    function getRelativeTime(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return 'Invalid Date';

        var now = new Date();
        var diff = Math.floor((now - date) / 1000);

        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';

        return getDateDisplay(date);
    }

    // ============================================================
    // PERIOD HELPERS
    // ============================================================

    function parsePeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function formatPeriod(start, end, prefix) {
        prefix = prefix || '';

        var s = (start !== undefined && start !== null && start !== '')
            ? String(start)
            : '?';
        var e = (end !== undefined && end !== null && end !== '')
            ? String(end)
            : '';

        if (s !== '?' && e) return prefix + s + ' → ' + prefix + e;
        if (s !== '?') return prefix + s + ' → Present';
        if (e) return prefix + e;
        return '?';
    }

    function getPeriodInfo(value) {
        var parsed = parsePeriod(value);
        return {
            present: value !== undefined && value !== null && String(value).trim() !== '',
            valid: parsed !== null,
            value: parsed
        };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isValidDay(day) {
        return Number.isInteger(day) && day >= 1 && day <= 7;
    }

    function isValidHour(hour) {
        return Number.isInteger(hour) && hour >= 0 && hour <= 23;
    }

    function isValidDuration(duration) {
        return Number.isInteger(duration) && duration >= 1 && duration <= 4;
    }

    function isValidSlot(day, hour) {
        return isValidDay(day) && isValidHour(hour);
    }

    function isValidWeekRange(startWeek, endWeek, year) {
        var start = validateWeek(startWeek);
        var end = validateWeek(endWeek);
        if (start === null || end === null || start > end) return false;

        // Check against actual year bounds if year is provided
        if (year !== undefined && year !== null) {
            var maxWeek = getWeeksInYear(year);
            return end <= maxWeek;
        }

        return true;
    }

    function normalizeSlot(day, hour) {
        if (!isValidSlot(day, hour)) return null;
        return { day: day, hour: hour };
    }

    function validateDuration(value) {
        var num = parsePeriod(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    function isSlotEmpty(value) {
        return value === undefined || value === null || value === '';
    }

    function isSlotOccupied(value) {
        return !isSlotEmpty(value);
    }

    // ============================================================
    // SORT HELPERS
    // ============================================================

    function sortByDay(a, b) {
        return a.day - b.day;
    }

    function sortByHour(a, b) {
        return a.hour - b.hour;
    }

    function sortByDayHour(a, b) {
        if (a.day !== b.day) return a.day - b.day;
        return a.hour - b.hour;
    }

    function sortByWeek(a, b) {
        return a.week - b.week;
    }

    function sortByDateTime(a, b) {
        if (a.week !== b.week) return a.week - b.week;
        if (a.day !== b.day) return a.day - b.day;
        return a.hour - b.hour;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarUtils = {
        // Day helpers
        getDayName: getDayName,
        getDayName0: getDayName0,
        getDayNumber: getDayNumber,
        isWeekend: isWeekend,
        isWeekday: isWeekday,
        getDayRange: getDayRange,
        getWeekDays: getWeekDays,
        getWeekdays: getWeekdays,
        getWeekendDays: getWeekendDays,

        // Hour helpers
        formatHour: formatHour,
        formatHourRange: formatHourRange,
        getHourDisplay: getHourDisplay,
        getHour12: getHour12,
        getAmPm: getAmPm,
        getHourRange: getHourRange,
        getDefaultHours: getDefaultHours,
        getSelectionHours: getSelectionHours,
        getMorningHours: getMorningHours,
        getAfternoonHours: getAfternoonHours,
        getEveningHours: getEveningHours,
        isBusinessHour: isBusinessHour,
        isMorning: isMorning,
        isAfternoon: isAfternoon,
        isEvening: isEvening,

        // Week helpers
        validateWeek: validateWeek,
        getWeekLabel: getWeekLabel,
        getWeekRange: getWeekRange,
        getWeekBlock: getWeekBlock,
        getWeekFromDate: getWeekFromDate,
        getWeekStartDate: getWeekStartDate,
        getWeekDisplay: getWeekDisplay,
        getWeekNavigation: getWeekNavigation,
        getDaysInYear: getDaysInYear,
        getWeeksInYear: getWeeksInYear,

        // Time slot helpers
        getSlotKey: getSlotKey,
        parseSlotKey: parseSlotKey,
        getSlotDurationKey: getSlotDurationKey,
        getSlotLabel: getSlotLabel,
        getSlotDisplay: getSlotDisplay,
        getContinuousSlots: getContinuousSlots,
        getAvailableSlots: getAvailableSlots,
        hasSlotConflict: hasSlotConflict,
        isValidSlotRange: isValidSlotRange,

        // Date helpers
        getMonthName: getMonthName,
        getDateDisplay: getDateDisplay,
        getTimeDisplay: getTimeDisplay,
        getDateTimeDisplay: getDateTimeDisplay,
        getRelativeTime: getRelativeTime,

        // Period helpers
        parsePeriod: parsePeriod,
        formatPeriod: formatPeriod,
        getPeriodInfo: getPeriodInfo,

        // Validation
        isValidDay: isValidDay,
        isValidHour: isValidHour,
        isValidDuration: isValidDuration,
        isValidSlot: isValidSlot,
        isValidWeekRange: isValidWeekRange,
        normalizeSlot: normalizeSlot,
        validateDuration: validateDuration,
        isSlotEmpty: isSlotEmpty,
        isSlotOccupied: isSlotOccupied,

        // Sort helpers
        sortByDay: sortByDay,
        sortByHour: sortByHour,
        sortByDayHour: sortByDayHour,
        sortByWeek: sortByWeek,
        sortByDateTime: sortByDateTime,

        // Constants
        HOUR_FORMAT_12: HOUR_FORMAT_12,
        HOUR_FORMAT_24: HOUR_FORMAT_24,
        HOUR_FORMAT_SHORT: HOUR_FORMAT_SHORT,
        DAYS_IN_WEEK: DAYS_IN_WEEK,
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR
    };

})();
