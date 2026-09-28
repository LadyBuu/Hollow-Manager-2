/**
 * js/import-export/schedule-export.js - Class and Character Schedule Export
 * Exports one week of a schedule as readable plain text.
 *
 * Path: js/import-export/schedule-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of schedule data for a single
 *   week. Three views over the same stores:
 *
 *     CLASS VIEW
 *       exportClassScheduleText(classId, week)
 *         Every session of every group in the class, plus every
 *         instructor commitment attached to the class. A day-by-day
 *         LIST: each session is a block with a time label, a
 *         discipline/group header, an instructor line, and a roster.
 *
 *     CHARACTER WEEKLY VIEW
 *       exportStudentScheduleText(charId, week)
 *         Every session the CHARACTER is in during the week, plus
 *         every instructor commitment the character OWNS during the
 *         week. A GRID: days across the top, hours down the left,
 *         one cell per (day, hour) showing discipline and instructor.
 *
 *     CHARACTER DAY VIEW (this revision)
 *       exportStudentDayScheduleText(charId, week, day)
 *         Every session and commitment the character has on ONE day,
 *         as a three-row strip: Time, Discipline, Instructor, one
 *         column per meeting.
 *
 *   The three views serve different questions:
 *     "What is my class doing this week?"  -> class view (list)
 *     "What is my character doing when?"   -> character weekly (grid)
 *     "What does Tuesday look like?"       -> character day (strip)
 *
 * CHARACTER GRID — WHAT IT SHOWS:
 *   Days across the top (Monday..Sunday). Hours down the left, from
 *   CalendarConstants.CALENDAR_START_HOUR to CALENDAR_END_HOUR.
 *
 *   Each cell is two lines:
 *     line 1   the discipline name
 *     line 2   the instructor name
 *
 *   An empty cell carries an em dash on line 1 and a blank on line 2.
 *
 *   A session that runs for multiple hours repeats the discipline
 *   and instructor in every hour it occupies. A reader does not have
 *   to know a "continuation" convention; the cell is self-contained.
 *
 *   Multiple sessions in one cell (a double-booking) are joined with
 *   a semicolon on each line. This is rare; the reader sees both.
 *
 *   Commitments appear in the grid as well, with a kind label as the
 *   discipline line ("Office Hours", "Tutoring"), and either the
 *   "with <character>" name (for tutoring) or the instructor name on
 *   line 2.
 *
 * CHARACTER GRID — WHAT IT DOES NOT SHOW:
 *   Groups, classmates, session rosters, location. The character
 *   cares about what they are doing, not what their cohort is doing.
 *
 * CHARACTER DAY STRIP — WHAT IT SHOWS:
 *   Three rows: Time, Discipline, Instructor. One column per
 *   meeting, in chronological order.
 *
 *     Time        08:00 – 09:00   10:00 – 11:00   13:00 – 14:00
 *     Discipline  Combat Training History         Office Hours
 *     Instructor  Alice Example   Bob Smith       —
 *
 *   Multi-hour sessions are ONE column, not one per hour. The strip
 *   is a schedule, not a calendar.
 *
 *   Column gap is three spaces. Trailing whitespace is trimmed from
 *   each line. Empty day: three blank lines. No header, no footer,
 *   no title.
 *
 * SESSION SOURCES:
 *   The character's sessions come from
 *   AcademyTeachingProjector.projectForStudent(charId, week), which
 *   already returns the occurrences the character is a member of,
 *   filtered to the week.
 *
 *   The character's commitments come from
 *   AcademyInstructorCommitments.getActiveCommitmentsForInstructor(
 *   charId, week).
 *
 *   Both sources are optional at the module-load level. Missing at
 *   call time is a hard failure: an export that silently omitted
 *   sessions would be worse than no export.
 *
 * WEEK SCOPE:
 *   One week. The caller supplies it.
 *
 * CLASS VIEW READING SHAPE:
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
 *                  Students (3):
 *                    Aldric Blackwood
 *                    Cassia Vane
 *                    Marco Thrace
 *   ...
 *
 * CHARACTER WEEKLY VIEW READING SHAPE:
 *
 *   Hollow Blades — Character Schedule Export
 *   Alice Example
 *   Week 5 — Exported 2026-09-25
 *
 *   Overview
 *     6 sessions · 2 commitments
 *
 *   ────────────────────────────────────────────────
 *          Mon             Tue             Wed             Thu             Fri             Sat             Sun
 *   08:00  Maths           —               Maths           —               Maths           —               —
 *          Mr. Reyes                       Mr. Reyes                       Mr. Reyes
 *   09:00  Maths           History         Maths           History         Maths           —               —
 *          Mr. Reyes       Ms. Chen        Mr. Reyes       Ms. Chen        Mr. Reyes
 *   10:00  —               History         —               History         —               —               —
 *                          Ms. Chen                        Ms. Chen
 *   ...
 *
 * CHARACTER DAY VIEW READING SHAPE:
 *
 *   Time        08:00 – 09:00   10:00 – 11:00   13:00 – 14:00
 *   Discipline  Combat Training History         Office Hours
 *   Instructor  Alice Example   Bob Smith       —
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
 * DEPENDENCIES (LAZY, mandatory at call time for the character views):
 *   - window.AcademyTeachingProjector   (character grid + day — sessions)
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyLocations   (location display name in the class view)
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
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getActiveMembers !== 'function') {
        _missing.push('AcademyTeachingGroups.getActiveMembers');
    }
    if (!AcademyInstructorCommitments ||
        typeof AcademyInstructorCommitments.getActiveCommitmentsForClass !== 'function') {
        _missing.push(
            'AcademyInstructorCommitments.getActiveCommitmentsForClass'
        );
    }
    if (!AcademyInstructorCommitments ||
        typeof AcademyInstructorCommitments.getActiveCommitmentsForInstructor !== 'function') {
        _missing.push(
            'AcademyInstructorCommitments.getActiveCommitmentsForInstructor'
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
        typeof CalendarConstants.MIN_HOUR !== 'number' ||
        typeof CalendarConstants.MAX_HOUR !== 'number' ||
        typeof CalendarConstants.CALENDAR_START_HOUR !== 'number' ||
        typeof CalendarConstants.CALENDAR_END_HOUR !== 'number' ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants day/hour helpers');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseDay !== 'function') {
        _missing.push('CalendarValidation.parseDay');
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
    // LAZY-BUT-MANDATORY DEPENDENCIES
    // ============================================================

    function requireAcademyTeachingProjector(contextLabel) {
        var ATP = window.AcademyTeachingProjector;
        if (!ATP ||
            typeof ATP.projectForStudent !== 'function') {
            throw new Error(
                '[ScheduleExport] AcademyTeachingProjector is required ' +
                'by ' + contextLabel + '. Check the script load order ' +
                'in index.html.'
            );
        }
        return ATP;
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
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var END_HOUR = CalendarConstants.CALENDAR_END_HOUR;

    // Fixed layout constants. The banner width matches the team
    // exporter's convention so the two exports read consistently.
    var BANNER_WIDTH = 64;
    var DAY_BANNER_WIDTH = 48;

    // Continuation lines align under the text after the time-range
    // column. A time label such as "09:00–10:00" is 11 characters;
    // padding to 13 leaves two spaces before the discipline name.
    var CONTINUATION_INDENT = 13;

    // Roster lines indent one level deeper than the session
    // details.
    var ROSTER_INDENT = 15;

    // Kind labels for commitments.
    var KIND_LABEL = {
        officeHours: 'Office Hours',
        tutoring: 'Tutoring'
    };

    // ---- Character weekly grid layout constants ----

    // Width of the hour column (the "08:00" label on the left).
    var GRID_HOUR_COL_WIDTH = 7;

    // Width of each day column. Two lines per cell: discipline then
    // instructor. The width caps the length of a single line; longer
    // content is truncated with an ellipsis.
    var GRID_DAY_COL_WIDTH = 15;

    // Width of the gap between day columns.
    var GRID_COL_GAP = 1;

    // The character glyph used for an empty cell's first line.
    var EMPTY_CELL_LINE = '\u2014';

    // Truncation glyph.
    var ELLIPSIS = '\u2026';

    // ---- Character day strip layout constants ----

    // Width of the label column: "Discipline " padded to fit.
    var STRIP_ROW_LABEL_WIDTH = 11;

    // Gap between columns in the strip.
    var STRIP_COLUMN_GAP = '   ';

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

    function slugifyName(name, fallback) {
        var s = String(name || fallback).toLowerCase();
        s = s.replace(/[^a-z0-9]+/g, '-');
        s = s.replace(/^-+|-+$/g, '');
        if (s === '') { s = fallback; }
        return s;
    }

    function truncateForColumn(text, width) {
        var s = String(text === undefined || text === null ? '' : text);
        if (s.length <= width) { return s; }
        if (width <= 1) { return s.slice(0, width); }
        return s.slice(0, width - 1) + ELLIPSIS;
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

    function formatDayShort(day) {
        var full = formatDayName(day);
        if (full.length <= 3) { return full; }
        return full.slice(0, 3);
    }

    function formatHourLabel(hour) {
        try {
            var label = CalendarConstants.formatHour(hour);
            return isNonEmptyString(label)
                ? label
                : (String(hour) + ':00');
        } catch (e) {
            return String(hour) + ':00';
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

    function resolveCharacter(charId) {
        if (!isNonEmptyString(charId)) { return null; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return null; }
        return char;
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

    function getCharacterName(charId) {
        if (!isNonEmptyString(charId)) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
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

    function buildSessionRoster(groupId, weekNum) {
        var raw = [];
        try {
            raw = AcademyTeachingGroups.getActiveMembers(
                groupId, weekNum
            ) || [];
        } catch (e) {
            raw = [];
        }

        if (!Array.isArray(raw)) { return []; }

        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var charId = raw[i];
            if (!isNonEmptyString(charId)) { continue; }

            var name = getCharacterName(charId);
            if (name === '') {
                name = '(missing character)';
            }

            result.push({
                id: String(charId),
                name: name
            });
        }

        result.sort(function(a, b) {
            var cmp = a.name.localeCompare(b.name);
            if (cmp !== 0) { return cmp; }
            return a.id.localeCompare(b.id);
        });

        return result;
    }

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
    // CLASS VIEW — COLLECTION
    // ============================================================

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

            if (!weekInRange(
                weekNum, session.startWeek, session.endWeek
            )) {
                continue;
            }

            var duration = isFiniteNumber(session.duration)
                ? session.duration
                : 1;

            var roster = buildSessionRoster(group.id, weekNum);

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
                instructorName: getCharacterName(group.instructorId),
                locationId: isNonEmptyString(session.locationId)
                    ? String(session.locationId)
                    : null,
                locationName: getLocationName(session.locationId),
                kindLabel: '',
                students: roster
            });
        }

        return result;
    }

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
                instructorName: getCharacterName(c.instructorId),
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
                    ? getCharacterName(c.characterId)
                    : '',
                students: []
            });
        }

        return result;
    }

    // ============================================================
    // CLASS VIEW — PUBLIC PROJECTION
    // ============================================================

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
    // CLASS VIEW — TEXT FORMAT
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

    function emitStudentsBlock(students) {
        if (!Array.isArray(students) || students.length === 0) {
            return '';
        }

        var headerIndent = repeat(' ', CONTINUATION_INDENT);
        var nameIndent = repeat(' ', ROSTER_INDENT);

        var lines = [];
        lines.push(headerIndent + 'Students (' + students.length + '):');

        for (var i = 0; i < students.length; i++) {
            var s = students[i];
            if (!s) { continue; }
            var name = isNonEmptyString(s.name)
                ? s.name
                : '(unknown)';
            lines.push(nameIndent + name);
        }

        return lines.join('\n');
    }

    function emitRow(row) {
        var timeLabel = formatHourRange(row.startTime, row.duration);
        var timeCol = padRight(timeLabel, CONTINUATION_INDENT);

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
                lines.push(repeat(' ', CONTINUATION_INDENT) +
                    details.join(' \u00b7 '));
            }

            var studentsBlock = emitStudentsBlock(row.students);
            if (studentsBlock !== '') {
                lines.push(studentsBlock);
            }

            return lines.join('\n');
        }

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
            lines.push(repeat(' ', CONTINUATION_INDENT) +
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
    // CHARACTER VIEW — COLLECTION
    // ============================================================
    //
    // Sessions come from the teaching projector, filtered to
    // occurrences whose studentIds array contains the character.
    // The projector's projectForStudent already does the filter,
    // so the caller does not walk groups itself.
    //
    // Commitments come from the commitments module's
    // getActiveCommitmentsForInstructor.
    //
    // Both sources are reduced to the shape the grid and strip
    // renderers consume:
    //
    //   {
    //     id, day, startTime, duration,
    //     line1,   // discipline name (or kind label for a commitment)
    //     line2    // instructor name (or "with <name>" / "" for a commitment)
    //   }

    function collectStudentSessionsForWeek(charId, weekNum) {
        var Projector = requireAcademyTeachingProjector(
            'getStudentScheduleExport'
        );

        var occurrences;
        try {
            occurrences = Projector.projectForStudent(
                charId, weekNum
            ) || [];
        } catch (e) {
            console.warn(
                '[ScheduleExport] projectForStudent threw:', e
            );
            return [];
        }

        if (!Array.isArray(occurrences)) { return []; }

        var result = [];

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ) { continue; }
            if (!isFiniteNumber(occ.day)) { continue; }
            if (!isFiniteNumber(occ.startTime)) { continue; }

            var duration = isFiniteNumber(occ.duration) &&
                           occ.duration > 0
                ? occ.duration
                : 1;

            var disciplineName = getDisciplineName(occ.disciplineId);
            var instructorName = getCharacterName(occ.instructorId);

            result.push({
                id: isNonEmptyString(occ.sessionId)
                    ? String(occ.sessionId)
                    : '',
                day: occ.day,
                startTime: occ.startTime,
                duration: duration,
                line1: disciplineName,
                line2: instructorName,
                source: 'session'
            });
        }

        return result;
    }

    function collectStudentCommitmentsForWeek(charId, weekNum) {
        var raw;
        try {
            raw = AcademyInstructorCommitments
                .getActiveCommitmentsForInstructor(
                    charId, weekNum
                ) || [];
        } catch (e) {
            console.warn(
                '[ScheduleExport] ' +
                'getActiveCommitmentsForInstructor threw:', e
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
            if (isNonEmptyString(c.label)) {
                kindLabel += ' \u00b7 ' + String(c.label);
            }

            var line2 = '';
            if (isNonEmptyString(c.characterId)) {
                var otherName = getCharacterName(c.characterId);
                if (isNonEmptyString(otherName)) {
                    line2 = 'with ' + otherName;
                }
            }

            result.push({
                id: String(c.id),
                day: c.day,
                startTime: c.startTime,
                duration: duration,
                line1: kindLabel,
                line2: line2,
                source: 'commitment'
            });
        }

        return result;
    }

    // ============================================================
    // CHARACTER WEEKLY VIEW — PUBLIC PROJECTION
    // ============================================================

    function getStudentScheduleExport(charId, week) {
        var char = resolveCharacter(charId);
        if (!char) { return null; }

        var weekNum = resolveWeek(week);
        if (weekNum === null) { return null; }

        var sessions = collectStudentSessionsForWeek(
            char.id, weekNum
        );
        var commitments = collectStudentCommitmentsForWeek(
            char.id, weekNum
        );

        var allBlocks = sessions.concat(commitments);

        // Group blocks by (day, hour), keeping the cell content
        // structured for the renderer.
        var cells = buildGridCells(allBlocks, weekNum);

        return {
            characterId: String(char.id),
            characterName: getCharacterName(char.id) || 'Unnamed Character',
            week: weekNum,
            cells: cells,
            sessionCount: sessions.length,
            commitmentCount: commitments.length,
            totalBlocks: allBlocks.length
        };
    }

    /**
     * Bucket blocks into (day, hour) cells. A block that runs for N
     * hours appears in N cells — its start hour and each
     * continuation hour. This makes the grid self-explanatory: a
     * reader never has to know a continuation convention.
     *
     * Cells that receive more than one block collect them into an
     * array. The renderer joins the line1s and line2s with
     * semicolons.
     */
    function buildGridCells(blocks, weekNum) {
        var cells = Object.create(null);

        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (!b) { continue; }

            var duration = isFiniteNumber(b.duration) && b.duration > 0
                ? Math.round(b.duration)
                : 1;

            for (var h = 0; h < duration; h++) {
                var hour = b.startTime + h;
                if (hour < START_HOUR) { continue; }
                if (hour > END_HOUR) { break; }

                var key = String(b.day) + ':' + String(hour);
                if (!cells[key]) {
                    cells[key] = [];
                }
                cells[key].push(b);
            }
        }

        // Sort each cell's blocks deterministically. Sessions before
        // commitments; then by id.
        var keys = Object.keys(cells);
        for (var k = 0; k < keys.length; k++) {
            cells[keys[k]].sort(function(a, b) {
                if (a.source !== b.source) {
                    return a.source === 'session' ? -1 : 1;
                }
                return String(a.id).localeCompare(String(b.id));
            });
        }

        return cells;
    }

    // ============================================================
    // CHARACTER WEEKLY VIEW — TEXT FORMAT
    // ============================================================

    function emitStudentHeader(vm) {
        var today = new Date().toISOString().slice(0, 10);

        var lines = [];
        lines.push('Hollow Blades \u2014 Character Schedule Export');
        lines.push(vm.characterName);
        lines.push('Week ' + vm.week + ' \u2014 Exported ' + today);
        lines.push('');
        lines.push('Overview');
        lines.push('  ' +
            vm.sessionCount + ' session' +
            (vm.sessionCount === 1 ? '' : 's') + ' \u00b7 ' +
            vm.commitmentCount + ' commitment' +
            (vm.commitmentCount === 1 ? '' : 's'));

        return lines.join('\n') + '\n';
    }

    /**
     * Emit one cell's two lines.
     *
     * The cell is a bucket of one or more blocks. Each block has a
     * line1 (discipline or kind label) and a line2 (instructor or
     * "with <name>"). Multiple blocks in one cell join their lines
     * with "; ".
     *
     * The result is padded to GRID_DAY_COL_WIDTH. Lines longer than
     * that width are truncated with an ellipsis.
     */
    function emitCell(blocks) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return {
                line1: padRight(EMPTY_CELL_LINE, GRID_DAY_COL_WIDTH),
                line2: padRight('', GRID_DAY_COL_WIDTH)
            };
        }

        var line1Parts = [];
        var line2Parts = [];

        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (!b) { continue; }

            if (isNonEmptyString(b.line1)) {
                line1Parts.push(b.line1);
            }
            if (isNonEmptyString(b.line2)) {
                line2Parts.push(b.line2);
            }
        }

        var line1 = line1Parts.length > 0
            ? line1Parts.join('; ')
            : EMPTY_CELL_LINE;
        var line2 = line2Parts.length > 0
            ? line2Parts.join('; ')
            : '';

        return {
            line1: padRight(
                truncateForColumn(line1, GRID_DAY_COL_WIDTH),
                GRID_DAY_COL_WIDTH
            ),
            line2: padRight(
                truncateForColumn(line2, GRID_DAY_COL_WIDTH),
                GRID_DAY_COL_WIDTH
            )
        };
    }

    /**
     * Emit the grid.
     *
     * The first row is the day-name header. Subsequent rows are the
     * hours. Each row is two physical lines (discipline line, then
     * instructor line), because every cell is two lines tall.
     */
    function buildStudentScheduleText(vm) {
        var out = '';

        out += emitStudentHeader(vm);
        out += '\n';

        if (vm.totalBlocks === 0) {
            out += buildBanner() + '\n';
            out += 'No sessions or commitments this week.\n';
            out += buildBanner() + '\n';
            return out;
        }

        // ---- Day header ----
        //
        // The hour column is blank on the header row. Each day column
        // carries the short day name, padded to the day column width.

        var headerLine = padRight('', GRID_HOUR_COL_WIDTH);
        for (var d = MIN_DAY; d <= MAX_DAY; d++) {
            var dayLabel = formatDayShort(d);
            headerLine += padRight(
                truncateForColumn(dayLabel, GRID_DAY_COL_WIDTH),
                GRID_DAY_COL_WIDTH
            );
            if (d < MAX_DAY) {
                headerLine += repeat(' ', GRID_COL_GAP);
            }
        }
        out += headerLine + '\n';

        // ---- Hour rows ----
        //
        // One logical row per hour. Each row renders as two physical
        // lines: line1 across all days, then line2 across all days.

        for (var hour = START_HOUR; hour <= END_HOUR; hour++) {
            var hourLabel = formatHourLabel(hour);
            var hourCol = padRight(hourLabel, GRID_HOUR_COL_WIDTH);

            var rowLine1 = hourCol;
            var rowLine2 = padRight('', GRID_HOUR_COL_WIDTH);

            for (var day = MIN_DAY; day <= MAX_DAY; day++) {
                var key = String(day) + ':' + String(hour);
                var blocks = vm.cells[key] || [];
                var cell = emitCell(blocks);

                rowLine1 += cell.line1;
                rowLine2 += cell.line2;

                if (day < MAX_DAY) {
                    rowLine1 += repeat(' ', GRID_COL_GAP);
                    rowLine2 += repeat(' ', GRID_COL_GAP);
                }
            }

            out += rowLine1 + '\n';
            out += rowLine2 + '\n';
        }

        return out;
    }

    // ============================================================
    // CHARACTER DAY VIEW — COLLECTION
    // ============================================================
    //
    // The day strip is a narrower view of the same two sources the
    // weekly grid reads (projector sessions + instructor
    // commitments). It restricts to a single day and emits a
    // chronological column list rather than a grid.
    //
    // The shape the strip renderer consumes:
    //
    //   {
    //     startTime, endTime,
    //     line1,   // discipline name (or kind label for a commitment)
    //     line2    // instructor name (or "with <name>" / "" for a commitment)
    //   }
    //
    // The day strip does NOT expand multi-hour blocks into one
    // column per hour. A session that runs 08:00–10:00 is one
    // column, not two. That is the difference between the grid and
    // the strip: the grid is a calendar, the strip is a schedule.

    function collectStudentDayBlocksForWeek(charId, weekNum, dayNum) {
        if (!isFiniteNumber(dayNum)) { return []; }
        if (dayNum < MIN_DAY || dayNum > MAX_DAY) { return []; }

        var sessions = collectStudentSessionsForWeek(charId, weekNum);
        var commitments = collectStudentCommitmentsForWeek(
            charId, weekNum
        );

        var merged = sessions.concat(commitments);
        var result = [];

        for (var i = 0; i < merged.length; i++) {
            var b = merged[i];
            if (!b) { continue; }
            if (b.day !== dayNum) { continue; }

            var duration = isFiniteNumber(b.duration) && b.duration > 0
                ? b.duration
                : 1;

            result.push({
                startTime: b.startTime,
                endTime: b.startTime + duration,
                duration: duration,
                line1: isNonEmptyString(b.line1)
                    ? b.line1
                    : EMPTY_CELL_LINE,
                line2: isNonEmptyString(b.line2)
                    ? b.line2
                    : EMPTY_CELL_LINE
            });
        }

        result.sort(function(a, b) {
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return a.line1.localeCompare(b.line1);
        });

        return result;
    }

    // ============================================================
    // CHARACTER DAY VIEW — PUBLIC PROJECTION
    // ============================================================

    function getStudentDayScheduleExport(charId, week, day) {
        var char = resolveCharacter(charId);
        if (!char) { return null; }

        var weekNum = resolveWeek(week);
        if (weekNum === null) { return null; }

        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) { return null; }
        if (dayNum < MIN_DAY || dayNum > MAX_DAY) { return null; }

        var blocks = collectStudentDayBlocksForWeek(
            char.id, weekNum, dayNum
        );

        return {
            characterId: String(char.id),
            characterName: getCharacterName(char.id) || 'Unnamed Character',
            week: weekNum,
            day: dayNum,
            dayName: formatDayName(dayNum),
            blocks: blocks,
            blockCount: blocks.length
        };
    }

    // ============================================================
    // CHARACTER DAY VIEW — TEXT FORMAT
    // ============================================================
    //
    // Three rows, no header, no footer, no title.
    //
    //   Time        08:00 – 09:00   10:00 – 11:00
    //   Discipline  Combat Training History
    //   Instructor  Alice Example   Bob Smith
    //
    // One column per meeting, chronological. Column gap is three
    // spaces. Trailing whitespace is trimmed from each line. An
    // empty day emits three blank lines.

    function buildStripRow(label, values) {
        var labelCol = padRight(label, STRIP_ROW_LABEL_WIDTH);
        var parts = [];

        for (var i = 0; i < values.length; i++) {
            parts.push(String(values[i]));
        }

        var joined = parts.join(STRIP_COLUMN_GAP);
        var line = labelCol + joined;

        // Trim trailing spaces only. Leading spaces (the label
        // column) are preserved.
        return line.replace(/\s+$/, '');
    }

    function buildStudentDayScheduleText(vm) {
        if (!vm) { return ''; }

        if (!Array.isArray(vm.blocks) || vm.blocks.length === 0) {
            return '\n\n';
        }

        var times = [];
        var disciplines = [];
        var instructors = [];

        for (var i = 0; i < vm.blocks.length; i++) {
            var b = vm.blocks[i];
            if (!b) { continue; }

            var startLabel = formatHourLabel(b.startTime);
            var endLabel = formatHourLabel(b.endTime);
            times.push(startLabel + ' \u2013 ' + endLabel);

            disciplines.push(b.line1);
            instructors.push(b.line2);
        }

        var rows = [];
        rows.push(buildStripRow('Time', times));
        rows.push(buildStripRow('Discipline', disciplines));
        rows.push(buildStripRow('Instructor', instructors));

        return rows.join('\n');
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function getClassScheduleTextContent(classId, week) {
        var vm = getClassScheduleExport(classId, week);
        if (!vm) { return ''; }
        return buildClassScheduleText(vm);
    }

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

        var slug = slugifyName(vm.className, 'class');
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

    function getStudentScheduleTextContent(charId, week) {
        var vm = getStudentScheduleExport(charId, week);
        if (!vm) { return ''; }
        return buildStudentScheduleText(vm);
    }

    function exportStudentScheduleText(charId, week, options) {
        options = options || {};

        var vm = getStudentScheduleExport(charId, week);

        if (!vm) {
            return {
                exported: false,
                filename: null,
                sessionCount: 0,
                commitmentCount: 0,
                error: 'Character or week not found.'
            };
        }

        var content = buildStudentScheduleText(vm);

        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var slug = slugifyName(vm.characterName, 'character');
        var today = new Date().toISOString().slice(0, 10);
        var filename = options.filename ||
            'character-' + slug + '-schedule-week-' +
            String(vm.week) + '.txt';

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

    function getStudentDayScheduleTextContent(charId, week, day) {
        var vm = getStudentDayScheduleExport(charId, week, day);
        if (!vm) { return ''; }
        return buildStudentDayScheduleText(vm);
    }

    function exportStudentDayScheduleText(charId, week, day, options) {
        options = options || {};

        var vm = getStudentDayScheduleExport(charId, week, day);

        if (!vm) {
            return {
                exported: false,
                filename: null,
                blockCount: 0,
                error: 'Character, week, or day not found.'
            };
        }

        var content = buildStudentDayScheduleText(vm);

        var blob = new Blob([content], {
            type: 'text/plain;charset=utf-8'
        });

        var slug = slugifyName(vm.characterName, 'character');
        var daySlug = slugifyName(vm.dayName, 'day');
        var today = new Date().toISOString().slice(0, 10);
        var filename = options.filename ||
            'character-' + slug + '-schedule-week-' +
            String(vm.week) + '-' + daySlug + '-' + today + '.txt';

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                blockCount: vm.blockCount,
                error: 'Failed to download: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            blockCount: vm.blockCount,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ScheduleExport = Object.freeze({
        // Class view
        getClassScheduleExport: getClassScheduleExport,
        getClassScheduleTextContent: getClassScheduleTextContent,
        exportClassScheduleText: exportClassScheduleText,

        // Character view — weekly grid
        getStudentScheduleExport: getStudentScheduleExport,
        getStudentScheduleTextContent: getStudentScheduleTextContent,
        exportStudentScheduleText: exportStudentScheduleText,

        // Character view — day strip
        getStudentDayScheduleExport: getStudentDayScheduleExport,
        getStudentDayScheduleTextContent: getStudentDayScheduleTextContent,
        exportStudentDayScheduleText: exportStudentDayScheduleText
    });

    (function verify() {
        var exports = window.ScheduleExport;
        var missing = [];

        var required = [
            'getClassScheduleExport',
            'getClassScheduleTextContent',
            'exportClassScheduleText',
            'getStudentScheduleExport',
            'getStudentScheduleTextContent',
            'exportStudentScheduleText',
            'getStudentDayScheduleExport',
            'getStudentDayScheduleTextContent',
            'exportStudentDayScheduleText'
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
