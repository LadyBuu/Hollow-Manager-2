/**
 * calendar-import.js - Calendar Import
 *
 * Path: js/import-export/calendar-import.js
 *
 * Import the calendar block from a Story Organiser JSON export,
 * and set it on the active project. Everything else in the file
 * is ignored.
 *
 * INPUT SHAPE ACCEPTED:
 *   - Full Story Organiser export: { projects: [ { calendar: {...} } ] }
 *   - A bare project block:        { calendar: {...} }
 *   - A bare calendar block:       { months: [...], weekdays: [...] }
 *
 * WHICH CALENDAR IS IMPORTED:
 *   From { projects: [...] }, the first project that has a
 *   calendar is used. If no project has a calendar, the import
 *   fails with a clear error.
 *
 * PERSISTENCE:
 *   Writes the calendar into the active project via
 *   CalendarConfig.setActiveCalendar. If a saveData-like function
 *   is available on window, it is called to persist. If not, the
 *   calendar is set in memory and the caller is responsible for
 *   persisting the project record.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarConfig
 */

(function() {
    'use strict';

    if (window.__calendarImportLoaded) {
        return;
    }
    window.__calendarImportLoaded = true;

    var CalendarConfig = window.CalendarConfig;
    if (!CalendarConfig) {
        throw new Error(
            '[CalendarImport] Missing mandatory dependency: CalendarConfig'
        );
    }

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function findCalendarBlock(parsed) {
        if (!isPlainObject(parsed)) { return null; }

        if (Array.isArray(parsed.projects)) {
            for (var i = 0; i < parsed.projects.length; i++) {
                var p = parsed.projects[i];
                if (isPlainObject(p) && isPlainObject(p.calendar)) {
                    return p.calendar;
                }
            }
            return null;
        }

        if (isPlainObject(parsed.calendar)) {
            return parsed.calendar;
        }

        if (Array.isArray(parsed.months) && Array.isArray(parsed.weekdays)) {
            return parsed;
        }

        return null;
    }

    function importFromText(text) {
        if (typeof text !== 'string' || text.trim() === '') {
            return { ok: false, error: 'No JSON text provided.' };
        }
        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return { ok: false, error: 'Invalid JSON: ' + e.message };
        }
        return importFromObject(parsed);
    }

    function importFromObject(parsed) {
        var raw = findCalendarBlock(parsed);
        if (!raw) {
            return {
                ok: false,
                error: 'No calendar block found. Expected ' +
                    'projects[0].calendar, a top-level `calendar`, ' +
                    'or a bare `{months, weekdays}` object.'
            };
        }

        var check = CalendarConfig.parseCalendarBlock(raw);
        if (!check.ok) {
            return { ok: false, error: check.error };
        }

        var set = CalendarConfig.setActiveCalendar(check.calendar);
        if (!set.ok) {
            return { ok: false, error: set.error };
        }

        // Best-effort persistence. If the caller has a saveData
        // function, invoke it. If not, leave persistence to the
        // caller.
        if (typeof window.saveData === 'function') {
            try {
                window.saveData('projects', window.data, true);
            } catch (e) {
                // Persistence failure is not fatal for the
                // in-memory calendar; the caller can retry.
            }
        }

        return { ok: true, calendar: check.calendar };
    }

    window.CalendarImport = Object.freeze({
        importFromText: importFromText,
        importFromObject: importFromObject
    });

})();
