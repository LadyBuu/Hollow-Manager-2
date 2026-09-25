/**
 * js/import-export/schedule-export.js - Class Schedule Export
 * Exports one week of a class's schedule as readable plain text.
 *
 * Path: js/import-export/schedule-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "the class's schedule for
 *   one week". Sessions and instructor commitments are the two
 *   sources. Both are filtered to the week and grouped by day.
 *
 * WHAT "THE CLASS'S SCHEDULE" MEANS HERE:
 *   - Every teaching session whose group belongs to the class,
 *     active during the target week.
 *   - Every instructor commitment attached to the class, active
 *     during the target week.
 *
 *   Exams, tournaments, and weekly-team assignments are NOT part
 *   of this export. The export is about time slots.
 *
 * WEEK SCOPE:
 *   One week. The caller supplies it. The Academy UI passes the
 *   display week; other callers may pass any valid week.
 *
 * READING SHAPE:
 *
 *   Hollow Blades — Class Schedule Export
 *   Class of 1910
 *   Week 5 — Exported 2026-09-25
 *
 *   Overview
 *     4 sessions · 1 commitment · 2 disciplines
 *
 *   ────────────────────────────────────────────────
 *   MONDAY
 *   ────────────────────────────────────────────────
 *     09:00–10:00  Combat Training · Group 1
 *                  Instructor: Jane Smith · Room 3A
 *
 *     10:00–11:00  Combat Training · Group 2
 *                  Instructor: Jane Smith · Room 3A
 *
 *   ────────────────────────────────────────────────
 *   TUESDAY
 *   ────────────────────────────────────────────────
 *     — no sessions —
 *
 * FAIL-CLOSED:
 *   When a mandatory dependency is unavailable, the export
 *   functions return an error result. Partial output is not
 *   emitted.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyClasses
 *   - window.AcademyTeachingSessions
 *   - window.AcademyTeachingGroups
 *   - window.AcademyInstructorCommitments
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyLocations   (location display name)
 */

(function() {
    'use strict';

    if (window.__scheduleExportLoaded) {
        return;
    }
    window.__scheduleExportLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyInstructorCommitments = window.AcademyInstructorCommitments;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyTeachingSessions ||
        typeof AcademyTeachingSessions.getAllSessions !== 'function') {
        _missing.push('AcademyTeachingSessions.getAllSessions');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyInstructorCommitments ||
        typeof AcademyInstructorCommitments.getActiveCommitmentsForClass !== 'function') {
        _missing.push(
            'AcademyInstructorCommitments.getActiveCommitmentsForClass'
        );
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants day/hour helpers');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!ExportUtils || typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[ScheduleExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyLocations() {
        return window.AcademyLocations || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;

    // Fixed layout constants. The banner width matches the team
    // exporter's convention so the two exports read consistently.
    var BANNER_WIDTH = 64;
    var DAY_BANNER_WIDTH = 48;

    // Kind labels for commitments.
    var KIND_LABEL = {
        officeHours: 'Office Hours',
        tutoring: 'Tutoring'
    };

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function padRight(str, width) {
        var s = String(str);
        while (s.length < width) {
            s += ' ';
        }
        return s;
    }

    function repeat(ch, n) {
        var out = '';
        for (var i = 0; i < n; i++) {
            out += ch;
        }
        return out;
    }

    function slugifyClassName(name) {
        var s = String(name || 'class').toLowerCase();
        s = s.replace(/[^a-z0-9]+/g, '-');
        s = s.replace(/^-+|-+$/g, '');
        if (s === '') { s = 'class'; }
        return s;
    }

    function formatHourRange(startTime, duration) {
        var end = startTime + duration;
        var startLabel = CalendarConstants.formatHour(startTime);
        var endLabel = CalendarConstants.formatHour(end);
        return startLabel + '\u2013' + endLabel;
    }

    function formatDayName(day) {
        if (!isFiniteNumber(day)) { return 'Day ?'; }
        try {
            var name = CalendarConstants.getDayName(day);
            return isNonEmptyString(name) ? name : ('Day ' + day);
        } catch (e) {
            return 'Day ' + day;
        }
    }

    // ============================================================
    // CLASS RESOLUTION
    // ============================================================

    function resolveClass(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }
        return cls;
    }

    function resolveWeek(week) {
        return CalendarValidation.parseWeek(week);
    }

    // ============================================================
    // DOMAIN RESOLUTION HELPERS
    // ============================================================

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown Discipline';
        }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        if (!d || !isNonEmptyString(d.name)) {
            return 'Unknown Discipline';
        }
        return d.name;
    }

    function getInstructorName(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(instructorId);
        if (!char) {
            return '';
        }
        try {
            return CharacterQueries.getDisplayName(char) || '';
        } catch (e) {
            return '';
        }
    }

    function getLocationName(locationId) {
        if (!isNonEmptyString(locationId)) {
            return '';
        }
        var AL = getAcademyLocations();
        if (!AL || typeof AL.getLocationName !== 'function') {
            return '';
        }
        try {
            var name = AL.getLocationName(locationId);
            if (isNonEmptyString(name) && name !== 'Unknown') {
                return name;
            }
        } catch (e) {
            // Fall through
        }
        return '';
    }

    /**
     * Display label for a teaching group.
     *
     * customName when set; otherwise "<discipline> <groupNumber>".
     * A group with neither a custom name nor a group number gets
     * just the discipline name.
     */
    function getGroupDisplayName(group) {
        if (!group) { return 'Unnamed Group'; }

        if (isNonEmptyString(group.customName)) {
            return String(group.customName).trim();
        }

        var disciplineName = getDisciplineName(group.disciplineId);
        var groupNumber = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;

        if (groupNumber > 0) {
            return disciplineName + ' ' + groupNumber;
        }
        return disciplineName;
    }

    // ============================================================
    // COLLECTION
    // ============================================================

    /**
     * Gather every teaching session of every group in the class
     * that is active during the target week.
     *
     * "Active" means the session's [startWeek, endWeek] contains
     * the week. Group membership and the group's own window are
     * NOT checked here; those are the projector's job. The export
     * is a schedule dump, not a projected occurrence list.
     *
     * @returns {array} session rows
     */
    function collectSessionsForWeek(classId, weekNum) {
        var allSessions = AcademyTeachingSessions.getAllSessions() || [];
        var result = [];

        for (var i = 0; i < allSessions.length; i++) {
            var session = allSessions[i];
            if (!session || !session.id) { continue; }
            if (!isFiniteNumber(session.day)) { continue; }
            if (!isFiniteNumber(session.startTime)) { continue; }

            var group = null;
            try {
                group = AcademyTeachingGroups.getGroup(session.groupId);
            } catch (e) {
                group = null;
            }
            if (!group) { continue; }
            if (String(group.classId) !== String(classId)) { continue; }

            // Session window: skip sessions whose own range does
            // not include the target week. A session with a null
            // endWeek is open-ended.
            if (!weekInRange(
                weekNum, session.startWeek, session.endWeek
            )) {
                continue;
            }

            var duration = isFiniteNumber(session.duration)
                ? session.duration
                : 1;

            result.push({
                source: 'session',
                id: session.id,
                groupId: group.id,
                day: session.day,
                startTime: session.startTime,
                duration: duration,
                endTime: session.startTime + duration,
                disciplineId: group.disciplineId,
                disciplineName: getDisciplineName(group.disciplineId),
                groupDisplayName: getGroupDisplayName(group),
                instructorId: group.instructorId,
                instructorName: getInstructorName(group.instructorId),
                locationId: isNonEmptyString(session.locationId)
                    ? String(session.locationId)
                    : null,
                locationName: getLocationName(session.locationId),
                kindLabel: ''
            });
        }

        return result;
    }

    /**
     * Gather every instructor commitment attached to the class
     * that is active during the target week.
     *
     * @returns {array} commitment rows
     */
    function collectCommitmentsForWeek(classId, weekNum) {
        var raw;
        try {
            raw = AcademyInstructorCommitments
                .getActiveCommitmentsForClass(classId, weekNum) || [];
        } catch (e) {
            console.warn(
                '[ScheduleExport] getActiveCommitmentsForClass ' +
                'threw:', e
            );
            raw = [];
        }

        if (!Array.isArray(raw)) { return []; }

        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var c = raw[i];
            if (!c || !c.id) { continue; }
            if (!isFiniteNumber(c.day)) { continue; }
            if (!isFiniteNumber(c.startTime)) { continue; }

            var duration = isFiniteNumber(c.duration)
                ? c.duration
                : 1;

            var kindLabel = KIND_LABEL[c.kind] || 'Commitment';

            result.push({
                source: 'commitment',
                id: c.id,
                commitmentId: c.id,
                day: c.day,
                startTime: c.startTime,
                duration: duration,
                endTime: c.startTime + duration,
                instructorId: c.instructorId,
                instructorName: getInstructorName(c.instructorId),
                locationId: isNonEmptyString(c.locationId)
                    ? String(c.locationId)
                    : null,
                locationName: getLocationName(c.locationId),
                kindLabel: kindLabel,
                label: isNonEmptyString(c.label)
                    ? String(c.label)
                    : '',
                characterId: isNonEmptyString(c.characterId)
                    ? String(c.characterId)
                    : null,
                characterName: isNonEmptyString(c.characterId)
                    ? getInstructorName(c.characterId)
                    : ''
            });
        }

        return result;
    }

    /**
     * Does [startWeek, endWeek] contain week?
     * endWeek === null means "ongoing".
     * endWeek === undefined is treated the same as null.
     */
    function weekInRange(week, startWeek, endWeek) {
        if (!isFiniteNumber(week)) { return false; }
        if (!isFiniteNumber(startWeek)) { return false; }
        if (week < startWeek) { return false; }
        if (endWeek === null || endWeek === undefined) {
            return true;
        }
        if (!isFiniteNumber(endWeek)) { return true; }
        return week <= endWeek;
    }

    // ============================================================
    // PUBLIC PROJECTION
    // ============================================================

    /**
     * Build the export view model for one (class, week) pair.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object|null}
     *   null when the class does not exist or the week is invalid.
     *   Otherwise:
     *   {
     *     classId, className,
     *     week,
     *     rows: [ combined row, ... ],   // sorted by day, then time
     *     days: [ { day, dayName, rows: [...] }, ... ],
     *     sessionCount, commitmentCount,
     *     disciplineCount
     *   }
     */
    function getClassScheduleExport(classId, week) {
        var cls = resolveClass(classId);
        if (!cls) { return null; }

        var weekNum = resolveWeek(week);
        if (weekNum === null) { return null; }

        var sessions = collectSessionsForWeek(cls.id, weekNum);
        var commitments = collectCommitmentsForWeek(cls.id, weekNum);

        var rows = sessions.concat(commitments);

        rows.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            // Sessions before commitments at the same start time.
            // Deterministic, readable.
            if (a.source !== b.source) {
                return a.source === 'session' ? -1 : 1;
            }
            return String(a.id).localeCompare(String(b.id));
        });

        var days = groupRowsByDay(rows);

        var disciplineSet = Object.create(null);
        for (var i = 0; i < sessions.length; i++) {
            var did = sessions[i].disciplineId;
            if (isNonEmptyString(did)) {
                disciplineSet[String(did)] = true;
            }
        }

        return {
            classId: cls.id,
            className: isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class',
            week: weekNum,
            rows: rows,
            days: days,
            sessionCount: sessions.length,
            commitmentCount: commitments.length,
            disciplineCount: Object.keys(disciplineSet).length
        };
    }

    /**
     * Group sorted rows into day buckets, one per day in
     * [MIN_DAY, MAX_DAY]. Days with no rows are still returned, so
     * the text output can print "no sessions" for them.
     */
    function groupRowsByDay(rows) {
        var buckets = Object.create(null);
        for (var d = MIN_DAY; d <= MAX_DAY; d++) {
            buckets[d] = [];
        }

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!isFiniteNumber(r.day)) { continue; }
            if (buckets[r.day]) {
                buckets[r.day].push(r);
            }
        }

        var result = [];
        for (var day = MIN_DAY; day <= MAX_DAY; day++) {
            result.push({
                day: day,
                dayName: formatDayName(day),
                rows: buckets[day]
            });
        }
        return result;
    }

    // ============================================================
    // TEXT FORMAT
    // ============================================================

    function buildBanner() {
        return repeat('\u2500', BANNER_WIDTH);
    }

    function buildDayBanner(dayName) {
        var label = dayName.toUpperCase();
        var prefix = '\u2500\u2500\u2500 ' + label + ' ';
        if (prefix.length >= DAY_BANNER_WIDTH) {
            return prefix;
        }
        return prefix + repeat('\u2500', DAY_BANNER_WIDTH - prefix.length);
    }

    function emitHeader(vm) {
        var today = new Date().toISOString().slice(0, 10);

        var lines = [];
        lines.push('Hollow Blades \u2014 Class Schedule Export');
        lines.push(vm.className);
        lines.push('Week ' + vm.week + ' \u2014 Exported ' + today);
        lines.push('');
        lines.push('Overview');
        lines.push('  ' +
            vm.sessionCount + ' session' +
            (vm.sessionCount === 1 ? '' : 's') + ' \u00b7 ' +
            vm.commitmentCount + ' commitment' +
            (vm.commitmentCount === 1 ? '' : 's') + ' \u00b7 ' +
            vm.disciplineCount + ' discipline' +
            (vm.disciplineCount === 1 ? '' : 's'));

        return lines.join('\n') + '\n';
    }

    /**
     * Emit a single schedule row:
     *
     *   09:00–10:00  Combat Training · Group 1
     *                Instructor: Jane Smith · Room 3A
     *
     * Continuation lines are indented by 13 characters, aligning
     * with the text after the time range column.
     */
    function emitRow(row) {
        var timeLabel = formatHourRange(row.startTime, row.duration);
        var timeCol = padRight(timeLabel, 13);

        var lines = [];

        if (row.source === 'session') {
            lines.push(timeCol + row.disciplineName +
                ' \u00b7 ' + row.groupDisplayName);

            var details = [];
            if (row.instructorName) {
                details.push('Instructor: ' + row.instructorName);
            }
            if (row.locationName) {
                details.push(row.locationName);
            }
            if (details.length > 0) {
                lines.push(repeat(' ', 13) + details.join(' \u00b7 '));
            }
            return lines.join('\n');
        }

        // Commitment row
        var label = row.kindLabel;
        if (row.label) {
            label += ' \u00b7 ' + row.label;
        }
        lines.push(timeCol + label);

        var commitmentDetails = [];
        if (row.instructorName) {
            commitmentDetails.push('Instructor: ' + row.instructorName);
        }
        if (row.characterName) {
            commitmentDetails.push('With: ' + row.characterName);
        }
        if (row.locationName) {
            commitmentDetails.push(row.locationName);
        }
        if (commitmentDetails.length > 0) {
            lines.push(repeat(' ', 13) +
                commitmentDetails.join(' \u00b7 '));
        }

        return lines.join('\n');
    }

    function buildClassScheduleText(vm) {
        var out = '';

        out += emitHeader(vm);
        out += '\n';

        if (vm.rows.length === 0) {
            out += buildBanner() + '\n';
            out += 'No sessions or commitments this week.\n';
            out += buildBanner() + '\n';
            return out;
        }

        for (var d = 0; d < vm.days.length; d++) {
            var day = vm.days[d];

            out += '\n';
            out += buildDayBanner(day.dayName) + '\n';

            if (day.rows.length === 0) {
                out += '  \u2014 no sessions \u2014\n';
                continue;
            }

            for (var r = 0; r < day.rows.length; r++) {
                if (r > 0) { out += '\n'; }
                out += emitRow(day.rows[r]) + '\n';
            }
        }

        return out;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Get the plain-text content as a string. No download.
     */
    function getClassScheduleTextContent(classId, week) {
        var vm = getClassScheduleExport(classId, week);
        if (!vm) { return ''; }
        return buildClassScheduleText(vm);
    }

    /**
     * Export the class schedule as a .txt file.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} [options] { filename? }
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   sessionCount: number,
     *   commitmentCount: number,
     *   error: string|null
     * }}
     */
    function exportClassScheduleText(classId, week, options) {
        options = options || {};

        var vm = getClassScheduleExport(classId, week);

        if (!vm) {
            return {
                exported: false,
                filename: null,
                sessionCount: 0,
                commitmentCount: 0,
                error: 'Class or week not found.'
            };
        }

        var content = buildClassScheduleText(vm);

        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var slug = slugifyClassName(vm.className);
        var today = new Date().toISOString().slice(0, 10);
        var filename = options.filename ||
            'class-' + slug + '-schedule-' + today + '.txt';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                sessionCount: vm.sessionCount,
                commitmentCount: vm.commitmentCount,
                error: 'Failed to download: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            sessionCount: vm.sessionCount,
            commitmentCount: vm.commitmentCount,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleExport = Object.freeze({
        getClassScheduleExport: getClassScheduleExport,
        getClassScheduleTextContent: getClassScheduleTextContent,
        exportClassScheduleText: exportClassScheduleText
    });

    (function verify() {
        var exports = window.ScheduleExport;
        var missing = [];

        var required = [
            'getClassScheduleExport',
            'getClassScheduleTextContent',
            'exportClassScheduleText'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[ScheduleExport] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
