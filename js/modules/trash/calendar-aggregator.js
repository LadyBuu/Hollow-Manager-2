/**
 * modules/calendar/calendar-aggregator.js - Calendar Aggregator
 * Cross-domain projection builder for calendar schedules.
 *
 * Path: js/modules/calendar/calendar-aggregator.js
 *
 * This module provides:
 *   - getLocationScheduleViewModel(locationId, week)
 *   - getStudentScheduleViewModel(studentId, week)
 *   - getInstructorScheduleViewModel(instructorId, week)
 *
 * IMPORTANT:
 *   - The Academy location VM consumes getLocationScheduleViewModel.
 *     Academy no longer walks raw Curriculum storage.
 *   - All projections are PURE. They read; they do not write.
 *   - Discipline names are resolved here (via DisciplineQueries) so
 *     consumers do not have to.
 *
 * DEPENDENCIES:
 *   - window.CalendarQueries (MANDATORY)
 *   - window.DisciplineQueries (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__calendarAggregatorLoaded) {
        return;
    }
    window.__calendarAggregatorLoaded = true;

    var CalendarQueries = window.CalendarQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CharacterQueries = window.CharacterQueries;
    var CalendarConstants = window.CalendarConstants;

    function checkDependencies() {
        var missing = [];
        if (!CalendarQueries || typeof CalendarQueries.getLocationSchedule !== 'function') {
            missing.push('CalendarQueries.getLocationSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
            missing.push('CalendarQueries.getStudentSchedule');
        }
        if (!CalendarConstants) {
            missing.push('CalendarConstants');
        }
        if (missing.length > 0) {
            console.warn('[CalendarAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    function resolveDisciplineName(disciplineId) {
        if (!disciplineId) { return 'Unknown'; }
        if (DisciplineQueries && typeof DisciplineQueries.getDiscipline === 'function') {
            var d = DisciplineQueries.getDiscipline(disciplineId);
            if (d && d.name) { return d.name; }
        }
        return 'Unknown';
    }

    /**
     * Convert raw { day: { hour: disciplineId } } into a sorted array
     * of schedule entries with discipline names and metadata.
     *
     * Duration: uses metadata.duration when present. When absent, the
     * entry's duration is null (NOT 1). Consumers are expected to
     * render duration == null as "unknown", not as "one hour".
     */
    function flattenSchedule(raw, metadataResolver) {
        var entries = [];
        if (!raw || typeof raw !== 'object') { return entries; }

        for (var dayKey in raw) {
            if (!Object.prototype.hasOwnProperty.call(raw, dayKey)) { continue; }
            var dayNum = parseInt(dayKey, 10);
            if (isNaN(dayNum)) { continue; }
            var daySchedule = raw[dayKey];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            for (var hourKey in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hourKey)) {
                    continue;
                }
                var hourNum = parseInt(hourKey, 10);
                if (isNaN(hourNum)) { continue; }
                var disciplineId = daySchedule[hourKey];
                if (!disciplineId) { continue; }

                var meta = metadataResolver ? metadataResolver(dayNum, hourNum) : null;

                entries.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: disciplineId,
                    disciplineName: resolveDisciplineName(disciplineId),
                    duration: meta && typeof meta.duration === 'number' ? meta.duration : null,
                    label: meta && typeof meta.label === 'string' ? meta.label : '',
                    groupLabel: meta && typeof meta.groupLabel === 'string' ? meta.groupLabel : ''
                });
            }
        }

        entries.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.hour - b.hour;
        });

        return entries;
    }

    /**
     * Get a location's schedule projection for a week.
     */
    function getLocationScheduleViewModel(locationId, week) {
        if (!checkDependencies()) { return []; }
        if (!locationId) { return []; }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < CalendarConstants.MIN_WEEK || weekNum > CalendarConstants.MAX_WEEK) {
            return [];
        }

        var raw = CalendarQueries.getLocationSchedule(locationId, weekNum);
        return flattenSchedule(raw, function(day, hour) {
            if (typeof CalendarQueries.getSlotMetadata !== 'function') { return null; }
            return CalendarQueries.getSlotMetadata(locationId, weekNum, day, hour);
        });
    }

    /**
     * Get a student's schedule projection for a week.
     */
    function getStudentScheduleViewModel(studentId, week) {
        if (!checkDependencies()) { return []; }
        if (!studentId) { return []; }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < CalendarConstants.MIN_WEEK || weekNum > CalendarConstants.MAX_WEEK) {
            return [];
        }

        var raw = CalendarQueries.getStudentSchedule(studentId, weekNum);
        var entries = flattenSchedule(raw, function(day, hour) {
            if (typeof CalendarQueries.getSlotMetadata !== 'function') { return null; }
            return CalendarQueries.getSlotMetadata(studentId, weekNum, day, hour);
        });

        // Enrich with instructor names when metadata carries them.
        for (var i = 0; i < entries.length; i++) {
            var meta = null;
            if (typeof CalendarQueries.getSlotMetadata === 'function') {
                meta = CalendarQueries.getSlotMetadata(studentId, weekNum, entries[i].day, entries[i].hour);
            }
            entries[i].instructorId = meta && meta.instructorId ? meta.instructorId : null;
            if (entries[i].instructorId && CharacterQueries) {
                var char = CharacterQueries.getCharacterById(entries[i].instructorId);
                entries[i].instructorName = char ? CharacterQueries.getDisplayName(char) : '';
            } else {
                entries[i].instructorName = '';
            }
        }

        return entries;
    }

    /**
     * Get an instructor's schedule projection for a week. Currently
     * returns [] — instructor schedule VM is not yet implemented.
     * Academy does not consume it yet.
     */
    function getInstructorScheduleViewModel(instructorId, week) {
        return [];
    }

    window.CalendarAggregator = {
        getLocationScheduleViewModel: getLocationScheduleViewModel,
        getStudentScheduleViewModel: getStudentScheduleViewModel,
        getInstructorScheduleViewModel: getInstructorScheduleViewModel
    };

})();
