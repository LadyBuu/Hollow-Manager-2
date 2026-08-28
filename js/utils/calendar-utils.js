/**
 * utils/calendar-utils.js - Calendar Utility Functions
 * Shared helper functions for calendar operations
 * Path: js/utils/calendar-utils.js
 * 
 * This module provides:
 *   - Day and hour formatting
 *   - Week calculations
 *   - Time slot utilities
 *   - Date comparison helpers
 *   - Schedule validation helpers
 * 
 * IMPORTANT:
 *   - All functions are PURE: no side effects, no data mutation
 *   - No DOM manipulation
 *   - No dependencies on window.data
 *   - Safe for use in any context
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
    var WEEKS_IN_YEAR = 52;

    // ============================================================
    // DAY HELPERS (1-INDEXED: Monday = 1, Sunday = 7)
    // ============================================================

    function getDayName(day, format) {
        format = format || 'full';

        if (typeof day !== 'number' || day < 1 || day > 7) {
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

        if (typeof day !== 'number' || day < 0 || day > 6) {
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

        if (typeof hour !== 'number' || hour < 0 || hour > 23) {
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
        return hour % 12 || 12;
    }

    function getAmPm(hour) {
        return hour >= 12 ? 'PM' : 'AM';
    }

    function getHourRange(startHour, endHour) {
        var hours = [];
        for (var h = startHour; h <= endHour; h++) {
            hours.push(h);
        }
        return hours;
    }

    function getDefaultHours() {
        return getHourRange(5, 23);
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
    // WEEK HELPERS
    // ============================================================

    function validateWeek(week) {
        if (typeof week !== 'number') {
            week = parseInt(week);
        }
        return Number.isInteger(week) && week >= 1 && week <= WEEKS_IN_YEAR ? week : null;
    }

    function getWeekLabel(week) {
        var w = validateWeek(week);
        return w !== null ? 'Week ' + w : 'Invalid Week';
    }

    function getWeekRange(week) {
        var w = validateWeek(week);
        if (w === null) return null;

        var start = (w - 1) * 7 + 1;
        var end = Math.min(start + 6, 365);
        return { start: start, end: end };
    }

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

    function getWeekFromDate(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return null;

        var startOfYear = new Date(date.getFullYear(), 0, 1);
        var diff = (date - startOfYear + (startOfYear.getTimezoneOffset() - date.getTimezoneOffset()) * 60000) / 86400000;
        return Math.floor(diff / 7) + 1;
    }

    function getWeekStartDate(week, year) {
        var w = validateWeek(week);
        if (w === null) return null;

        year = year || new Date().getFullYear();
        var startOfYear = new Date(year, 0, 1);
        var dayOffset = startOfYear.getDay() === 0 ? 1 : 8 - startOfYear.getDay();
        var days = (w - 1) * 7 + dayOffset - 1;
        return new Date(year, 0, days);
    }

    function getWeekDisplay(week) {
        var w = validateWeek(week);
        if (w === null) return 'Week ?';

        var range = getWeekRange(w);
        if (!range) return 'Week ' + w;

        var startDate = new Date(2024, 0, range.start);
        var endDate = new Date(2024, 0, range.end);

        var startMonth = MONTH_NAMES_SHORT[startDate.getMonth()];
        var endMonth = MONTH_NAMES_SHORT[endDate.getMonth()];

        if (startMonth === endMonth) {
            return 'Week ' + w + ' (' + startMonth + ' ' + startDate.getDate() + '-' + endDate.getDate() + ')';
        }

        return 'Week ' + w + ' (' + startMonth + ' ' + startDate.getDate() + ' - ' + endMonth + ' ' + endDate.getDate() + ')';
    }

    function getWeekNavigation(week) {
        var w = validateWeek(week);
        if (w === null) {
            return {
                current: 1,
                prev: null,
                next: 2,
                hasPrev: false,
                hasNext: true
            };
        }

        return {
            current: w,
            prev: w > 1 ? w - 1 : null,
            next: w < WEEKS_IN_YEAR ? w + 1 : null,
            hasPrev: w > 1,
            hasNext: w < WEEKS_IN_YEAR
        };
    }

    // ============================================================
    // TIME SLOT HELPERS
    // ============================================================

    function getSlotKey(day, hour) {
        return day + '_' + hour;
    }

    function parseSlotKey(key) {
        if (typeof key !== 'string') return null;
        var parts = key.split('_');
        if (parts.length !== 2) return null;

        var day = parseInt(parts[0]);
        var hour = parseInt(parts[1]);

        if (isNaN(day) || isNaN(hour)) return null;
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
        if (duration && duration > 1) {
            parts.push('(' + duration + 'h)');
        }
        if (label) {
            parts.push('[' + label + ']');
        }
        return parts.join(' ');
    }

    function getSlotDisplay(day, hour, duration) {
        var dayName = getDayName(day, 'short');
        var hourDisplay = formatHour(hour, HOUR_FORMAT_SHORT);
        if (duration && duration > 1) {
            return dayName + ' ' + hourDisplay + ' (' + duration + 'h)';
        }
        return dayName + ' ' + hourDisplay;
    }

    function getContinuousSlots(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return null;
        }

        var disciplineId = schedule[day][hour];
        var startHour = hour;

        while (startHour > 0 && schedule[day][startHour - 1] === disciplineId) {
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23 && schedule[day][endHour + 1] === disciplineId) {
            endHour++;
        }

        return {
            disciplineId: disciplineId,
            startHour: startHour,
            endHour: endHour,
            duration: endHour - startHour + 1
        };
    }

    function getAvailableSlots(schedule, day, startHour, endHour) {
        startHour = startHour || 5;
        endHour = endHour || 23;

        var available = [];
        if (!schedule || !schedule[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!schedule[day][h]) {
                available.push(h);
            }
        }
        return available;
    }

    function hasSlotConflict(schedule, day, hour, duration) {
        duration = duration || 1;

        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // DATE HELPERS
    // ============================================================

    function getMonthName(month, format) {
        format = format || 'full';

        if (typeof month !== 'number' || month < 0 || month > 11) {
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
        var s = start || '?';
        var e = end || '';

        if (s && e) return prefix + s + ' → ' + prefix + e;
        if (s) return prefix + s + ' → Present';
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
        return typeof day === 'number' && day >= 1 && day <= 7;
    }

    function isValidHour(hour) {
        return typeof hour === 'number' && hour >= 0 && hour <= 23;
    }

    function isValidDuration(duration) {
        return typeof duration === 'number' && duration >= 1 && duration <= 4;
    }

    function isValidSlot(day, hour) {
        return isValidDay(day) && isValidHour(hour);
    }

    function isValidWeekRange(startWeek, endWeek) {
        var start = validateWeek(startWeek);
        var end = validateWeek(endWeek);
        return start !== null && end !== null && start <= end;
    }

    function normalizeSlot(day, hour) {
        if (!isValidSlot(day, hour)) return null;
        return { day: day, hour: hour };
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

        // Time slot helpers
        getSlotKey: getSlotKey,
        parseSlotKey: parseSlotKey,
        getSlotDurationKey: getSlotDurationKey,
        getSlotLabel: getSlotLabel,
        getSlotDisplay: getSlotDisplay,
        getContinuousSlots: getContinuousSlots,
        getAvailableSlots: getAvailableSlots,
        hasSlotConflict: hasSlotConflict,

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
        WEEKS_IN_YEAR: WEEKS_IN_YEAR
    };

})();
