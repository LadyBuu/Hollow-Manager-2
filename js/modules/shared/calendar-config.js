/**
 * js/modules/shared/calendar-config.js - Custom Calendar Config
 *
 * Path: js/modules/shared/calendar-config.js
 *
 * Reads and validates the custom calendar block that lives on a
 * project record (`window.data.projects[active].calendar`), and
 * exposes the primitives the date pickers and the schema need:
 *
 *   getMonthsForYear(year)         → [{ id, name, days }]
 *   getDaysInMonth(year, monthId)  → number | 0
 *   getMonthName(year, monthId)    → string | ''
 *   isValidCalendarDate(y, m, d)   → boolean
 *
 * plus:
 *
 *   parseCalendarBlock(raw)              pure validator/canonicaliser
 *   getActiveProject()                   read the live project
 *   getActiveCalendar()                  read its calendar or null
 *   setActiveCalendar(calendar)          write it in memory
 *   clearActiveCalendar()                revert to Gregorian
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - The calendar grid, the preset catalogue, school terms, the
 *     paint UI, the leap-month editor. This module is data only.
 *   - Mutations to missions. It only describes what a valid date
 *     looks like.
 *   - Caching. Live reads on every call so switching projects or
 *     importing a new calendar takes effect immediately.
 *
 * THE CALENDAR SHAPE (from the project JSON):
 *
 *   {
 *     preset:       'hebrew',          // optional, informational
 *     name:         'Lunisolar · 7-in-19',
 *     months: [                         // REQUIRED, non-empty
 *       { name: 'First Moon',  days: 30, leapDays: 0, leapOnly: false },
 *       ...
 *     ],
 *     weekdays:     ['Sunday', ...],    // REQUIRED, non-empty
 *     startWeekday: 0,                  // optional
 *     leapC:        19,                 // optional; 0 = no leap rule
 *     leapK:        7,
 *     leapOff:      1,
 *     ins: {                            // optional; per-year insertions
 *       "1919": [{ id: 101, after: 7, name: 'Leap Seventh Month', days: 30 }],
 *       "1922": [{ id: 102, after: 5, name: 'Leap Fifth Moon',   days: 30 }]
 *     }
 *   }
 *
 * MONTH IDS ARE ORDINALS WITHIN THE YEAR:
 *   getMonthsForYear(1919) returns 13 entries (12 base + 1
 *   insertion), numbered 1..13 in the order they occur that year.
 *   getMonthsForYear(1920) returns 12 entries, numbered 1..12.
 *   A mission stored as { year: 1919, month: 8 } refers to the
 *   8th month of 1919 — the leap month. In 1920, month 8 is the
 *   ordinary 8th month. This is what keeps `month` an integer.
 *
 * DEPENDENCIES: None.
 */

(function() {
    'use strict';

    if (window.__calendarConfigLoaded) {
        return;
    }
    window.__calendarConfigLoaded = true;

    // ============================================================
    // GREGORIAN FALLBACK
    // ============================================================

    var GREG_MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    var GREG_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    function isGregorianLeapYear(y) {
        return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    }

    function gregorianMonthsForYear(year) {
        var lp = isGregorianLeapYear(year);
        var out = [];
        for (var i = 0; i < 12; i++) {
            out.push({
                id: i + 1,
                name: GREG_MONTHS[i],
                days: i === 1 && lp ? 29 : GREG_DAYS[i]
            });
        }
        return out;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }
    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim() !== '';
    }
    function parseIntSafe(v) {
        if (typeof v === 'number') {
            return Number.isFinite(v) ? Math.floor(v) : null;
        }
        if (typeof v === 'string') {
            var t = v.trim();
            if (!/^\d+$/.test(t)) { return null; }
            var n = parseInt(t, 10);
            return isNaN(n) ? null : n;
        }
        return null;
    }

    // ============================================================
    // CALENDAR PARSING (PURE)
    // ============================================================

    function parseCalendarBlock(raw) {
        if (!isPlainObject(raw)) {
            return { ok: false, error: 'Calendar block must be an object.' };
        }
        if (!Array.isArray(raw.months) || raw.months.length === 0) {
            return {
                ok: false,
                error: 'Calendar block must contain a non-empty `months` array.'
            };
        }

        var months = [];
        for (var i = 0; i < raw.months.length; i++) {
            var m = raw.months[i];
            if (!isPlainObject(m)) {
                return { ok: false, error: 'Month ' + (i + 1) + ' is not an object.' };
            }
            if (!isNonEmptyString(m.name)) {
                return { ok: false, error: 'Month ' + (i + 1) + ' has no name.' };
            }
            var days = parseIntSafe(m.days);
            if (days === null || days < 1) {
                return {
                    ok: false,
                    error: 'Month "' + m.name + '" has invalid `days`.'
                };
            }
            var leapDays = parseIntSafe(m.leapDays);
            if (leapDays === null) { leapDays = 0; }
            if (leapDays < 0) { leapDays = 0; }
            months.push({
                name: String(m.name).trim(),
                days: days,
                leapDays: leapDays,
                leapOnly: m.leapOnly === true
            });
        }

        if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) {
            return {
                ok: false,
                error: 'Calendar block must contain a non-empty `weekdays` array.'
            };
        }
        var weekdays = [];
        for (var w = 0; w < raw.weekdays.length; w++) {
            if (!isNonEmptyString(raw.weekdays[w])) {
                return { ok: false, error: 'Weekday ' + (w + 1) + ' has no name.' };
            }
            weekdays.push(String(raw.weekdays[w]).trim());
        }

        var leapC = parseIntSafe(raw.leapC) || 0;
        var leapK = parseIntSafe(raw.leapK) || 0;
        var leapOff = parseIntSafe(raw.leapOff) || 0;
        if (leapC < 0) { leapC = 0; }
        if (leapK < 0) { leapK = 0; }
        if (leapK > leapC) { leapK = leapC; }

        var ins = {};
        if (isPlainObject(raw.ins)) {
            var years = Object.keys(raw.ins);
            for (var yi = 0; yi < years.length; yi++) {
                var yNum = parseIntSafe(years[yi]);
                if (yNum === null || yNum < 1) { continue; }
                var list = raw.ins[years[yi]];
                if (!Array.isArray(list)) { continue; }
                var clean = [];
                for (var li = 0; li < list.length; li++) {
                    var x = list[li];
                    if (!isPlainObject(x)) { continue; }
                    var id = parseIntSafe(x.id);
                    if (id === null) { continue; }
                    var after = parseIntSafe(x.after) || 0;
                    if (after < 0) { after = 0; }
                    var name = isNonEmptyString(x.name)
                        ? String(x.name).trim()
                        : 'Leap month';
                    var insDays = parseIntSafe(x.days);
                    if (insDays === null || insDays < 1) { insDays = 30; }
                    clean.push({ id: id, after: after, name: name, days: insDays });
                }
                if (clean.length > 0) { ins[String(yNum)] = clean; }
            }
        }

        var calendar = {
            name: isNonEmptyString(raw.name)
                ? String(raw.name).trim()
                : 'Custom calendar',
            preset: isNonEmptyString(raw.preset)
                ? String(raw.preset).trim()
                : 'custom',
            months: months,
            weekdays: weekdays,
            startWeekday: parseIntSafe(raw.startWeekday) || 0,
            leapC: leapC,
            leapK: leapK,
            leapOff: leapOff,
            ins: ins
        };

        return { ok: true, calendar: calendar };
    }

    // ============================================================
    // ACTIVE PROJECT / CALENDAR ACCESS
    // ============================================================

    function getActiveProject() {
        var data = window.data;
        if (!data || !Array.isArray(data.projects) || data.projects.length === 0) {
            return null;
        }
        var pid = null;
        try {
            if (window.MissionUI &&
                typeof window.MissionUI.activeProjectId === 'function') {
                pid = window.MissionUI.activeProjectId();
            }
        } catch (e) { pid = null; }

        if (pid) {
            for (var i = 0; i < data.projects.length; i++) {
                if (data.projects[i] &&
                    String(data.projects[i].id) === String(pid)) {
                    return data.projects[i];
                }
            }
        }
        for (var j = 0; j < data.projects.length; j++) {
            if (data.projects[j] &&
                isPlainObject(data.projects[j].calendar) &&
                Array.isArray(data.projects[j].calendar.months) &&
                data.projects[j].calendar.months.length) {
                return data.projects[j];
            }
        }
        return data.projects[0] || null;
    }

    function getActiveCalendar() {
        var project = getActiveProject();
        if (!project) { return null; }
        if (!isPlainObject(project.calendar)) { return null; }
        var parsed = parseCalendarBlock(project.calendar);
        if (!parsed.ok) { return null; }
        return parsed.calendar;
    }

    function setActiveCalendar(calendar) {
        var project = getActiveProject();
        if (!project) {
            return { ok: false, error: 'No active project.' };
        }
        var parsed = parseCalendarBlock(calendar);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error };
        }
        project.calendar = parsed.calendar;
        return { ok: true, calendar: parsed.calendar };
    }

    function clearActiveCalendar() {
        var project = getActiveProject();
        if (!project) {
            return { ok: false, error: 'No active project.' };
        }
        if (project.calendar !== undefined) {
            delete project.calendar;
        }
        return { ok: true };
    }

    // ============================================================
    // LEAP RULE
    // ============================================================

    function isLeapYear(year, calendar) {
        if (!calendar) {
            return isGregorianLeapYear(year);
        }
        var c = calendar.leapC | 0;
        var k = calendar.leapK | 0;
        var o = calendar.leapOff | 0;
        if (c <= 0 || k <= 0) { return false; }
        var m = (((k * year + o) % c) + c) % c;
        return m < k;
    }

    // ============================================================
    // MONTHS OF A YEAR
    // ============================================================

    function getMonthsForYear(year) {
        var y = parseIntSafe(year);
        if (y === null || y < 1) { return []; }

        var calendar = getActiveCalendar();
        if (!calendar) {
            return gregorianMonthsForYear(y);
        }

        var leap = isLeapYear(y, calendar);
        var list = [];
        for (var i = 0; i < calendar.months.length; i++) {
            var m = calendar.months[i];
            if (m.leapOnly && !leap) { continue; }
            list.push({
                id: list.length + 1,
                name: m.name,
                days: Math.max(1, m.days + (leap ? m.leapDays : 0))
            });
        }

        var insertions = calendar.ins[String(y)] || [];
        if (insertions.length > 0) {
            var sortedIns = insertions.slice().sort(function(a, b) {
                return (a.after | 0) - (b.after | 0);
            });
            for (var k = 0; k < sortedIns.length; k++) {
                var x = sortedIns[k];
                var at = (x.after | 0) > 0 ? (x.after | 0) : list.length;
                if (at > list.length) { at = list.length; }
                if (at < 0) { at = 0; }
                list.splice(at, 0, {
                    id: list.length + 1,
                    name: x.name,
                    days: Math.max(1, x.days | 0),
                    inserted: true
                });
            }
            for (var n = 0; n < list.length; n++) { list[n].id = n + 1; }
        }

        return list;
    }

    function getDaysInMonth(year, monthId) {
        var y = parseIntSafe(year);
        var m = parseIntSafe(monthId);
        if (y === null || y < 1 || m === null || m < 1) { return 0; }
        var list = getMonthsForYear(y);
        if (m > list.length) { return 0; }
        return list[m - 1].days;
    }

    function getMonthName(year, monthId) {
        var y = parseIntSafe(year);
        var m = parseIntSafe(monthId);
        if (y === null || y < 1 || m === null || m < 1) { return ''; }
        var list = getMonthsForYear(y);
        if (m > list.length) { return ''; }
        return list[m - 1].name;
    }

    function isValidCalendarDate(year, month, day) {
        var y = parseIntSafe(year);
        var m = parseIntSafe(month);
        var d = parseIntSafe(day);
        if (y === null || y < 1) { return false; }
        if (m === null || m < 1) { return false; }
        if (d === null || d < 1) { return false; }
        var days = getDaysInMonth(y, m);
        if (days === 0) { return false; }
        return d <= days;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarConfig = Object.freeze({
        getMonthsForYear: getMonthsForYear,
        getDaysInMonth: getDaysInMonth,
        getMonthName: getMonthName,
        isValidCalendarDate: isValidCalendarDate,
        getActiveProject: getActiveProject,
        getActiveCalendar: getActiveCalendar,
        setActiveCalendar: setActiveCalendar,
        clearActiveCalendar: clearActiveCalendar,
        parseCalendarBlock: parseCalendarBlock,
        isLeapYear: isLeapYear
    });

})();
