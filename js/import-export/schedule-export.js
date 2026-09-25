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
 * SESSION ROSTERS:
 *   Each teaching session lists the students of its group who are
 *   active at the exported week. Roster source:
 *   AcademyTeachingGroups.getActiveMembers(groupId, week), which
 *   returns the character IDs whose membership interval for the
 *   group contains the week. Names come from CharacterQueries.
 *
 *   The roster is printed as a header line followed by one name
 *   per line, indented under the session block. This layout never
 *   overflows regardless of roster size, at the cost of vertical
 *   space. Chosen over the comma-wrapped variant because roster
 *   sizes vary widely and vertical readability matters more than
 *   compactness for a document meant to be read by humans.
 *
 *   A session whose group has no active members at the week emits
 *   no roster block at all. The absence is the answer.
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
 *                  Students (3):
 *                    Aldric Blackwood
 *                    Cassia Vane
 *                    Marco Thrace
 *
 *     10:00–11:00  Combat Training · Group 2
 *                  Instructor: Jane Smith · Room 3A
 *                  Students (2):
 *                    Nyla Pemberton
 *                    Osric Wren
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

    // Continuation lines align under the text after the time-range
    // column. A time label such as "09:00–10:00" is 11 characters;
    // padding to 13 leaves two spaces before the discipline name.
    var CONTINUATION_INDENT = 13;

    // Roster lines indent one level deeper than the session
    // details, so the header reads as belonging to the session and
    // the names read as belonging to the header.
    var ROSTER_INDENT = 15;

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

    /**
     * Display label for a teaching group.
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

    /**
     * Build the roster list for a group at a given week.
     *
     * Returns an array of { id, name }. Sorted alphabetically by
     * name, with a fallback to id for stability when two students
     * share a name.
     *
     * A student whose character record no longer exists is
     * included with name '(missing character)'. The roster is a
     * fact about the group, not about whether the character still
     * resolves; dropping the entry would under-report the roster.
     */
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

    // ============================================================
    // COLLECTION
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
     * Emit a Students block, one name per line.
     *
     *   <CONTINUATION_INDENT spaces>Students (N):
     *   <ROSTER_INDENT spaces><name>
     *   <ROSTER_INDENT spaces><name>
     *   ...
     *
     * Every name occupies its own line, indented one level deeper
     * than the header. Never wraps. Any roster size renders
     * identically except for the number of lines.
     *
     * Returns '' when the roster is empty.
     */
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
