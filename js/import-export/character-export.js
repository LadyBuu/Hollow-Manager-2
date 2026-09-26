/**
 * js/import-export/character-export.js - Character Export
 * Exports everything the application knows about a single
 * character, in a shape a human can read.
 *
 * Path: js/import-export/character-export.js
 *
 * WHAT THIS MODULE OWNS:
 *   The projection + serialization of "one character, across every
 *   domain".
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Character data              (CharacterQueries)
 *   - Class data                  (AcademyClasses)
 *   - Enrolment data              (AcademyEnrolments)
 *   - Discipline data             (AcademyDisciplines)
 *   - Grade data                  (AcademyGrades)
 *   - Group data                  (AcademyTeachingGroups)
 *   - Session data                (AcademyTeachingSessions)
 *   - Commitment data             (AcademyInstructorCommitments)
 *   - Team data                   (TeamQueries)
 *   - Social data                 (SocialAggregator)
 *   - Mission data                (MissionQueries)
 *   - Elimination data            (EliminationQueries)
 *   - Ranking data                (AcademyRanking)
 *   - File download               (ExportUtils)
 *
 *   This module reads through the domain modules only. It walks no
 *   raw storage. It mutates nothing.
 *
 * OUTPUT FORMAT:
 *   A plain-text document. Deliberately readable, deliberately
 *   sparse. A field line appears only when the field has content.
 *   Empty sections print their header and "(none)".
 *
 *   Structure, in order:
 *
 *     Banner
 *     AT A GLANCE
 *     TIMELINE
 *     IDENTITY
 *     CLASSES (as student)
 *     DISCIPLINES ENROLLED
 *     CLASSES TAUGHT (as instructor)
 *     COMMITMENTS
 *     TEAMS
 *     SOCIAL
 *     MISSIONS
 *     TOURNAMENTS / EXAMS
 *     ACADEMY HISTORY
 *     Footer
 *
 *   The TIMELINE is the narrative; the domain sections are the
 *   reference. A reader who wants "what happened?" reads the first
 *   two sections. A reader who wants "what were their grades?"
 *   skips to DISCIPLINES ENROLLED.
 *
 * TIMELINE:
 *   One line per dated fact, sorted ascending. Sourced from every
 *   domain that carries a year or a week:
 *
 *     - Career status changes   (year)
 *     - Class enrolments        (week)
 *     - Team stints             (period)
 *     - Eliminations            (year, week)
 *     - Graduation              (year)
 *
 *   Facts with no date are omitted from the timeline but still
 *   appear in their domain section.
 *
 * GRADUATION:
 *   A character graduates from a class when the class's status is
 *   'graduated' AND the character is in the class's roster. The
 *   graduation year is the class's `year` field.
 *
 *   This is the same "graduate" definition GraduatesExport uses,
 *   minus the elimination filter: GraduatesExport excludes any
 *   character with an elimination record, because it is listing
 *   people who completed the course. This report is a biography,
 *   not a roster, so it lists the graduation fact regardless of
 *   whether the character was later eliminated.
 *
 * FAIL-OPEN:
 *   Every optional domain read is wrapped in try/catch and falls
 *   back to an empty section. A missing module produces "(none)",
 *   not an error. The one exception is CharacterQueries: without
 *   it, there is no character, and the export fails with a clear
 *   message.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.ExportUtils
 *
 * DEPENDENCIES (OPTIONAL, resolved at call time):
 *   - window.AcademyClasses
 *   - window.AcademyEnrolments
 *   - window.AcademyDisciplines
 *   - window.AcademyGrades
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.AcademyInstructorCommitments
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.SocialAggregator
 *   - window.MissionQueries
 *   - window.MissionConstants
 *   - window.EliminationQueries
 *   - window.AcademyRanking
 *   - window.AcademyGradeSchemes
 *   - window.CalendarConstants
 *   - window.AcademyUI
 */

(function() {
    'use strict';

    if (window.__characterExportLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[CharacterExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__characterExportLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getAcademyEnrolments() {
        return window.AcademyEnrolments || null;
    }

    function getAcademyDisciplines() {
        return window.AcademyDisciplines || null;
    }

    function getAcademyGrades() {
        return window.AcademyGrades || null;
    }

    function getAcademyTeachingGroups() {
        return window.AcademyTeachingGroups || null;
    }

    function getAcademyTeachingSessions() {
        return window.AcademyTeachingSessions || null;
    }

    function getAcademyInstructorCommitments() {
        return window.AcademyInstructorCommitments || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getTeamConstants() {
        return window.TeamConstants || null;
    }

    function getSocialAggregator() {
        return window.SocialAggregator || null;
    }

    function getMissionQueries() {
        return window.MissionQueries || null;
    }

    function getMissionConstants() {
        return window.MissionConstants || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getGradeSchemes() {
        return window.AcademyGradeSchemes || null;
    }

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var BANNER_WIDTH = 61;
    var BANNER = new Array(BANNER_WIDTH + 1).join('=');
    var LABEL_WIDTH = 18;
    var FILENAME_PREFIX = 'character';

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function hasText(value) {
        if (value === undefined || value === null) { return false; }
        if (typeof value === 'string') { return value.trim() !== ''; }
        if (typeof value === 'number') { return isFinite(value); }
        if (typeof value === 'boolean') { return true; }
        if (Array.isArray(value)) { return value.length > 0; }
        if (typeof value === 'object') {
            return Object.keys(value).length > 0;
        }
        return false;
    }

    /**
     * Sanitise a display name for use in a filename.
     * Strips characters illegal on Windows and macOS, collapses
     * runs of separators, and trims leading/trailing separators.
     */
    function sanitiseForFilename(value) {
        var str = safeString(value);
        str = str.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '');
        str = str.replace(/\s+/g, '-');
        str = str.replace(/-+/g, '-');
        str = str.replace(/^[-.]+|[-.]+$/g, '');
        if (str === '') { return 'character'; }
        if (str.length > 60) {
            str = str.substring(0, 60).replace(/-+$/, '');
        }
        return str;
    }

    /**
     * Left-pad a label to LABEL_WIDTH, then a colon and a space.
     * Multi-line values are collapsed to single spaces so a notes
     * field cannot break the block layout.
     */
    function line(label, value) {
        if (!hasText(value)) { return ''; }
        var v = String(value).replace(/\s+/g, ' ').trim();
        if (v === '') { return ''; }
        var lbl = String(label);
        while (lbl.length < LABEL_WIDTH) { lbl += ' '; }
        return lbl + ': ' + v + '\n';
    }

    /**
     * A section header:
     *   IDENTITY
     *   --------
     */
    function sectionHeader(title) {
        var underlineLen = Math.min(title.length, 60);
        var underline = new Array(underlineLen + 1).join('-');
        return title + '\n' + underline + '\n';
    }

    function emptySectionBody() {
        return '(none)\n';
    }

    /**
     * An indented line. Two spaces of indent, then the label/value
     * pair. Used for anything that sits under a sub-header.
     */
    function indentedLine(label, value) {
        var inner = line(label, value);
        if (inner === '') { return ''; }
        return '  ' + inner;
    }

    /**
     * Emit a multi-line text block, indented. Used for notes and
     * free-form fields.
     */
    function indentBlock(label, text) {
        if (!hasText(text)) { return ''; }
        var out = '  ' + label + ':\n';
        var lines = String(text).replace(/\r\n/g, '\n').split('\n');
        for (var i = 0; i < lines.length; i++) {
            out += '    ' + lines[i] + '\n';
        }
        return out;
    }

    // ============================================================
    // DATE / PERIOD FORMATTING
    // ============================================================

    function formatWeekRange(startWeek, endWeek) {
        var s = (startWeek !== undefined && startWeek !== null &&
                 startWeek !== '')
            ? String(startWeek)
            : '';
        var e = (endWeek !== undefined && endWeek !== null &&
                 endWeek !== '')
            ? String(endWeek)
            : '';

        if (s && e) { return 'Week ' + s + ' \u2013 Week ' + e; }
        if (s) { return 'Week ' + s + ' \u2013 present'; }
        if (e) { return 'until Week ' + e; }
        return '';
    }

    function formatYearRange(startYear, endYear) {
        var s = (startYear !== undefined && startYear !== null &&
                 startYear !== '')
            ? String(startYear)
            : '';
        var e = (endYear !== undefined && endYear !== null &&
                 endYear !== '')
            ? String(endYear)
            : '';

        if (s && e) { return s + ' \u2013 ' + e; }
        if (s) { return s + ' \u2013 present'; }
        if (e) { return 'until ' + e; }
        return '';
    }

    function isAcademicTeamType(teamType) {
        var TC = getTeamConstants();
        if (!TC || typeof TC.normalizeTeamType !== 'function') {
            return false;
        }
        return TC.normalizeTeamType(teamType) === 'academic';
    }

    function formatTeamPeriod(team) {
        if (!team) { return ''; }
        var isAcademic = isAcademicTeamType(team.type);
        if (isAcademic) {
            return formatWeekRange(team.startPeriod, team.endPeriod);
        }
        return formatYearRange(team.startPeriod, team.endPeriod);
    }

    // ============================================================
    // TIMELINE
    // ============================================================
    //
    // A timeline entry is { sortKey, display }.
    //
    // sortKey is a zero-padded string that sorts lexicographically
    // in chronological order. Years are padded to four digits;
    // weeks to two. Entries with no year fall to the top.

    function makeTimelineEntry(year, week, display) {
        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            return null;
        }

        var yearStr = String(yearNum);
        while (yearStr.length < 4) { yearStr = '0' + yearStr; }

        var weekStr = '00';
        if (week !== undefined && week !== null && week !== '') {
            var weekNum = parseInt(week, 10);
            if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 99) {
                weekStr = String(weekNum);
                if (weekStr.length < 2) { weekStr = '0' + weekStr; }
            }
        }

        return {
            sortKey: yearStr + '-' + weekStr,
            display: display
        };
    }

    function collectTimelineEntries(char, charId) {
        var entries = [];

        // ---- Career status changes (year-dated) ----
        if (Array.isArray(char.careerStatus)) {
            for (var i = 0; i < char.careerStatus.length; i++) {
                var status = char.careerStatus[i];
                if (!isObject(status)) { continue; }
                var entry = makeTimelineEntry(
                    status.startYear,
                    null,
                    'Became ' + (status.status || 'Unknown')
                );
                if (entry) { entries.push(entry); }
            }
        }

        // ---- Team stints (period-dated) ----
        //
        // Professional and temporary teams use year periods.
        // Academic teams use week periods, which cannot be placed
        // in a year-sorted timeline without a year — so academic
        // stints are skipped in the timeline and appear only in
        // the TEAMS section.
        var TeamQueries = getTeamQueries();
        if (TeamQueries &&
            typeof TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated ===
                'function') {
            var teams = [];
            try {
                teams = TeamQueries
                    .getTeamsForCharacterAllTimeIncludingDeprecated(charId)
                    || [];
            } catch (e) { teams = []; }

            for (var t = 0; t < teams.length; t++) {
                var team = teams[t];
                if (!team) { continue; }
                if (isAcademicTeamType(team.type)) { continue; }

                var teamName = isNonEmptyString(team.name)
                    ? team.name
                    : 'Unnamed Team';

                var records = [];
                try {
                    records = TeamQueries.getAllTeamMemberRecords(team) || [];
                } catch (e) { records = []; }

                for (var r = 0; r < records.length; r++) {
                    var rec = records[r];
                    if (!rec ||
                        String(rec.characterId) !== String(charId)) {
                        continue;
                    }
                    if (!Array.isArray(rec.intervals)) { continue; }
                    for (var iv = 0; iv < rec.intervals.length; iv++) {
                        var interval = rec.intervals[iv];
                        if (!interval) { continue; }
                        var entry = makeTimelineEntry(
                            interval.joinPeriod,
                            null,
                            'Joined ' + teamName
                        );
                        if (entry) { entries.push(entry); }
                    }
                }
            }
        }

        // ---- Eliminations (year, week) ----
        var EQ = getEliminationQueries();
        if (EQ && typeof EQ.getEliminationYear === 'function') {
            var elimYear = null;
            var elimWeek = null;
            var elimReason = '';
            try {
                elimYear = EQ.getEliminationYear(charId);
                if (typeof EQ.getEliminationWeek === 'function') {
                    elimWeek = EQ.getEliminationWeek(charId);
                }
                if (typeof EQ.getEliminationReason === 'function') {
                    elimReason = EQ.getEliminationReason(charId) || '';
                }
            } catch (e) { /* leave nulls */ }

            if (elimYear !== null && elimYear !== undefined) {
                var reasonText = elimReason && elimReason !== 'Unknown'
                    ? ' \u2014 ' + elimReason
                    : '';
                var entry = makeTimelineEntry(
                    elimYear,
                    elimWeek,
                    'Eliminated' + reasonText
                );
                if (entry) { entries.push(entry); }
            }
        }

        // ---- Graduation (year) ----
        var Classes = getAcademyClasses();
        if (Classes && typeof Classes.getClasses === 'function') {
            var allClasses = [];
            try {
                allClasses = Classes.getClasses() || [];
            } catch (e) { allClasses = []; }

            for (var g = 0; g < allClasses.length; g++) {
                var gClass = allClasses[g];
                if (!gClass || gClass.status !== 'graduated') { continue; }
                if (!isFiniteNumber(gClass.year) &&
                    !isNonEmptyString(gClass.year)) {
                    continue;
                }

                var belongs = false;
                if (Array.isArray(char.classIds)) {
                    for (var cc = 0; cc < char.classIds.length; cc++) {
                        if (String(char.classIds[cc]) ===
                            String(gClass.id)) {
                            belongs = true;
                            break;
                        }
                    }
                }
                if (!belongs) { continue; }

                var entry = makeTimelineEntry(
                    gClass.year,
                    null,
                    'Graduated from ' + (gClass.name || 'Unknown Class')
                );
                if (entry) { entries.push(entry); }
            }
        }

        // ---- Sort and dedupe ----
        entries.sort(function(a, b) {
            var keyCmp = a.sortKey.localeCompare(b.sortKey);
            if (keyCmp !== 0) { return keyCmp; }
            return a.display.localeCompare(b.display);
        });

        var seen = Object.create(null);
        var deduped = [];
        for (var d = 0; d < entries.length; d++) {
            var key = entries[d].sortKey + '::' + entries[d].display;
            if (seen[key]) { continue; }
            seen[key] = true;
            deduped.push(entries[d]);
        }

        return deduped;
    }

    function buildTimelineSection(char, charId) {
        var entries = collectTimelineEntries(char, charId);

        if (entries.length === 0) {
            return emptySectionBody();
        }

        var out = '';
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var yearStr = e.sortKey.substring(0, 4).replace(/^0+/, '');
            var weekStr = e.sortKey.substring(5);
            var weekNum = parseInt(weekStr, 10);

            var dateLabel;
            if (weekNum > 0) {
                dateLabel = 'Y' + yearStr + ' W' + weekNum;
            } else {
                dateLabel = 'Y' + yearStr;
            }

            var lbl = dateLabel;
            while (lbl.length < 10) { lbl += ' '; }

            out += lbl + '  ' + e.display + '\n';
        }
        return out;
    }

    // ============================================================
    // AT A GLANCE
    // ============================================================

    function buildAtAGlanceSection(char, charId) {
        var out = '';

        out += line('Character ID', String(charId));

        var status = '';
        try {
            status = CharacterQueries.getCurrentStatus(char) || '';
        } catch (e) { status = ''; }
        out += line('Current status', status);

        var age = '';
        try {
            age = CharacterQueries.getCharacterAge(char) || '';
        } catch (e) { age = ''; }
        out += line('Age', age);

        var deceased = false;
        try {
            if (typeof CharacterQueries.isDeceased === 'function') {
                deceased = CharacterQueries.isDeceased(char) === true;
            }
        } catch (e) { deceased = false; }
        out += line('Deceased', deceased ? 'yes' : 'no');

        var mode = isNonEmptyString(char.mode) ? char.mode : '';
        out += line('Mode', mode);

        // Current teams (year-scoped)
        var TeamQueries = getTeamQueries();
        var teamNames = [];
        if (TeamQueries &&
            typeof TeamQueries.getTeamsForCharacter === 'function') {
            var currentYear = null;
            if (window.data &&
                isFiniteNumber(window.data.currentYear) &&
                window.data.currentYear > 0) {
                currentYear = Math.floor(window.data.currentYear);
            }
            if (currentYear !== null) {
                var teams = [];
                try {
                    teams = TeamQueries.getTeamsForCharacter(
                        charId, currentYear
                    ) || [];
                } catch (e) { teams = []; }
                for (var i = 0; i < teams.length; i++) {
                    if (teams[i] && isNonEmptyString(teams[i].name)) {
                        teamNames.push(teams[i].name);
                    }
                }
            }
        }
        if (teamNames.length > 0) {
            out += line('On teams', teamNames.join(', '));
        }

        // Current classes (by name)
        var Classes = getAcademyClasses();
        if (Classes &&
            typeof Classes.getCharacterClassNames === 'function') {
            var classNames = [];
            try {
                classNames = Classes.getCharacterClassNames(char) || [];
            } catch (e) { classNames = []; }
            if (classNames.length > 0) {
                out += line('In classes', classNames.join(', '));
            }
        }

        if (out === '') {
            return emptySectionBody();
        }
        return out;
    }

    // ============================================================
    // IDENTITY
    // ============================================================

    function buildIdentitySection(char, charId) {
        var out = '';

        out += line('Character ID', String(charId));

        var fullName = '';
        if (typeof CharacterQueries.getFullName === 'function') {
            try {
                fullName = CharacterQueries.getFullName(char) || '';
            } catch (e) { fullName = ''; }
        }
        out += line('Full name', fullName);

        var displayName = '';
        try {
            displayName = CharacterQueries.getDisplayName(char) || '';
        } catch (e) { displayName = ''; }
        out += line('Display name', displayName);

        if (isNonEmptyString(char.nickname)) {
            out += line('Nickname', char.nickname);
        }
        if (isNonEmptyString(char.alias)) {
            out += line('Alias', char.alias);
        }
        if (Array.isArray(char.previousNames) &&
            char.previousNames.length > 0) {
            out += line('Also known as', char.previousNames.join(', '));
        }

        // ---- Physical ----
        var physicalParts = [];
        if (isNonEmptyString(char.build)) {
            physicalParts.push(String(char.build));
        }
        if (isNonEmptyString(char.height)) {
            physicalParts.push(String(char.height));
        }
        if (isNonEmptyString(char.weight)) {
            physicalParts.push(String(char.weight));
        }
        if (physicalParts.length > 0) {
            out += line('Physical', physicalParts.join(' \u00b7 '));
        }

        var colourParts = [];
        if (isNonEmptyString(char.eyes)) { colourParts.push(String(char.eyes)); }
        if (isNonEmptyString(char.hair)) { colourParts.push(String(char.hair)); }
        if (isNonEmptyString(char.skin)) { colourParts.push(String(char.skin)); }
        if (colourParts.length > 0) {
            out += line('Eyes / hair / skin', colourParts.join(' / '));
        }

        if (isNonEmptyString(char.gender)) {
            out += line('Gender', char.gender);
        }
        if (isNonEmptyString(char.attraction)) {
            out += line('Attraction', char.attraction);
        }
        if (isNonEmptyString(char.sexuality)) {
            out += line('Sexuality', char.sexuality);
        }

        // ---- Dates ----
        if (isNonEmptyString(char.birthYear)) {
            out += line('Birth year', char.birthYear);
        }
        if (isNonEmptyString(char.deathYear)) {
            out += line('Death year', char.deathYear);
        }
        if (isNonEmptyString(char.deathWeek)) {
            out += line('Death week', char.deathWeek);
        }
        if (isNonEmptyString(char.deathCause)) {
            out += line('Death cause', char.deathCause);
        }
        if (isNonEmptyString(char.deathAge)) {
            out += line('Age at death', char.deathAge);
        }

        // ---- Career ----
        if (isNonEmptyString(char.specialty)) {
            out += line('Specialty', char.specialty);
        }

        // ---- Long-form text ----
        if (isNonEmptyString(char.notes)) {
            out += '\n';
            out += indentBlock('Notes', char.notes);
        }
        if (isNonEmptyString(char.appearanceNotes)) {
            out += '\n';
            out += indentBlock('Appearance notes', char.appearanceNotes);
        }

        if (out === '') {
            return emptySectionBody();
        }
        return out;
    }

    // ============================================================
    // CLASSES (as student)
    // ============================================================

    function buildClassesAsStudentSection(char, charId) {
        var Enrol = getAcademyEnrolments();
        var Classes = getAcademyClasses();

        if (!Enrol ||
            typeof Enrol.getStudentClasses !== 'function' ||
            !Classes ||
            typeof Classes.getClass !== 'function') {
            return emptySectionBody();
        }

        var classIds = [];
        try {
            classIds = Enrol.getStudentClasses(charId) || [];
        } catch (e) { classIds = []; }

        if (classIds.length === 0) {
            return emptySectionBody();
        }

        // Sort classes by name
        var classEntries = [];
        for (var i = 0; i < classIds.length; i++) {
            var cls = null;
            try {
                cls = Classes.getClass(classIds[i]);
            } catch (e) { cls = null; }
            if (!cls) { continue; }
            classEntries.push(cls);
        }

        classEntries.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = '';

        for (var c = 0; c < classEntries.length; c++) {
            var cls2 = classEntries[c];
            var name = isNonEmptyString(cls2.name)
                ? cls2.name
                : 'Unnamed Class';
            var status = isNonEmptyString(cls2.status)
                ? cls2.status
                : 'active';
            var year = isFiniteNumber(cls2.year)
                ? String(cls2.year)
                : '';

            out += name +
                (year ? ' (' + year + ')' : '') +
                ' [' + cls2.id + ']\n';

            out += indentedLine('Status', status);

            // Aggregate enrolment window from the intervals
            var intervals = [];
            try {
                intervals = Enrol.getStudentDisciplines(
                    charId, cls2.id
                ) || [];
            } catch (e) { intervals = []; }

            if (intervals.length > 0) {
                var earliest = null;
                var latest = null;
                for (var iv = 0; iv < intervals.length; iv++) {
                    var interval = intervals[iv];
                    if (!interval) { continue; }
                    var s = parseInt(interval.startWeek, 10);
                    var e = parseInt(interval.endWeek, 10);

                    if (!isNaN(s) &&
                        (earliest === null || s < earliest)) {
                        earliest = s;
                    }
                    if (isNaN(e)) {
                        // Ongoing interval. Leave latest null so
                        // formatWeekRange prints "present".
                        latest = null;
                    } else if (latest !== null &&
                               !isNaN(e) && e > latest) {
                        latest = e;
                    }
                }

                if (earliest !== null) {
                    out += indentedLine(
                        'Enrolled',
                        formatWeekRange(earliest, latest)
                    );
                }
            }

            out += '\n';
        }

        return out;
    }

    // ============================================================
    // DISCIPLINES ENROLLED
    // ============================================================

    function getGradeSchemeName(discipline) {
        if (!discipline) { return ''; }
        var GS = getGradeSchemes();
        if (!GS) { return ''; }
        if (typeof GS.getRangeLabel === 'function') {
            try {
                var label = GS.getRangeLabel(discipline.gradeScheme);
                if (isNonEmptyString(label)) { return label; }
            } catch (e) { /* fall through */ }
        }
        if (discipline.gradeScheme &&
            isNonEmptyString(discipline.gradeScheme.id)) {
            return discipline.gradeScheme.id;
        }
        return '';
    }

    function buildDisciplinesEnrolledSection(char, charId) {
        var Enrol = getAcademyEnrolments();
        var Classes = getAcademyClasses();
        var Disciplines = getAcademyDisciplines();
        var Grades = getAcademyGrades();

        if (!Enrol ||
            typeof Enrol.getStudentClasses !== 'function' ||
            typeof Enrol.getStudentDisciplines !== 'function') {
            return emptySectionBody();
        }

        var classIds = [];
        try {
            classIds = Enrol.getStudentClasses(charId) || [];
        } catch (e) { classIds = []; }

        if (classIds.length === 0) {
            return emptySectionBody();
        }

        // Sort classes by name
        var classEntries = [];
        for (var i = 0; i < classIds.length; i++) {
            var cls = null;
            if (Classes && typeof Classes.getClass === 'function') {
                try {
                    cls = Classes.getClass(classIds[i]);
                } catch (e) { cls = null; }
            }
            if (!cls) { continue; }
            classEntries.push(cls);
        }

        classEntries.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = '';

        for (var c = 0; c < classEntries.length; c++) {
            var cls2 = classEntries[c];
            var className = isNonEmptyString(cls2.name)
                ? cls2.name
                : 'Unnamed Class';

            var intervals = [];
            try {
                intervals = Enrol.getStudentDisciplines(
                    charId, cls2.id
                ) || [];
            } catch (e) { intervals = []; }

            if (intervals.length === 0) { continue; }

            // Group intervals by disciplineId
            var byDiscipline = Object.create(null);
            var disciplineOrder = [];
            for (var iv = 0; iv < intervals.length; iv++) {
                var interval = intervals[iv];
                if (!interval || !interval.disciplineId) { continue; }
                var key = String(interval.disciplineId);
                if (!byDiscipline[key]) {
                    byDiscipline[key] = [];
                    disciplineOrder.push(key);
                }
                byDiscipline[key].push(interval);
            }

            // Sort disciplines alphabetically by resolved name
            var disciplineEntries = [];
            for (var d = 0; d < disciplineOrder.length; d++) {
                var did = disciplineOrder[d];
                var disc = null;
                if (Disciplines &&
                    typeof Disciplines.getDiscipline === 'function') {
                    try {
                        disc = Disciplines.getDiscipline(did);
                    } catch (e) { disc = null; }
                }
                disciplineEntries.push({
                    disciplineId: did,
                    discipline: disc,
                    intervals: byDiscipline[did]
                });
            }

            disciplineEntries.sort(function(a, b) {
                var an = a.discipline && a.discipline.name
                    ? a.discipline.name
                    : 'Unknown';
                var bn = b.discipline && b.discipline.name
                    ? b.discipline.name
                    : 'Unknown';
                return an.localeCompare(bn);
            });

            out += className + ' [' + cls2.id + ']\n';

            for (var de = 0; de < disciplineEntries.length; de++) {
                var entry = disciplineEntries[de];
                var discName = entry.discipline &&
                    isNonEmptyString(entry.discipline.name)
                    ? entry.discipline.name
                    : 'Unknown Discipline';

                out += '  ' + discName + '\n';

                // Enrolment intervals for this discipline
                for (var ii = 0; ii < entry.intervals.length; ii++) {
                    var intv = entry.intervals[ii];
                    out += indentedLine(
                        'Enrolled',
                        formatWeekRange(
                            intv.startWeek, intv.endWeek
                        )
                    );
                    out = '  ' + out.substring(0);
                }

                // Grade scheme
                var schemeName = getGradeSchemeName(entry.discipline);
                if (schemeName) {
                    out += '    ' + 'Scheme'.padEnd(LABEL_WIDTH) +
                        ': ' + schemeName + '\n';
                }

                // Grades for this discipline in this class
                if (Grades &&
                    typeof Grades.getStudentClassGrades === 'function') {
                    var rawGrades = [];
                    try {
                        rawGrades = Grades.getStudentClassGrades(
                            charId, cls2.id
                        ) || [];
                    } catch (e) { rawGrades = []; }

                    var relevantGrades = [];
                    for (var g = 0; g < rawGrades.length; g++) {
                        var gr = rawGrades[g];
                        if (!gr) { continue; }
                        if (String(gr.disciplineId) !==
                            String(entry.disciplineId)) {
                            continue;
                        }
                        relevantGrades.push(gr);
                    }

                    if (relevantGrades.length > 0) {
                        out += '    Grades:\n';
                        for (var rg = 0; rg < relevantGrades.length; rg++) {
                            var grade = relevantGrades[rg];
                            out += buildGradeLine(grade);
                        }

                        if (typeof Grades.calculateSummary === 'function') {
                            var summary = null;
                            try {
                                summary = Grades.calculateSummary(
                                    relevantGrades,
                                    entry.discipline
                                        ? entry.discipline.gradeScheme
                                        : null
                                );
                            } catch (e) { summary = null; }
                            if (summary &&
                                isFiniteNumber(summary.average)) {
                                out += '    ' +
                                    'Average'.padEnd(LABEL_WIDTH) +
                                    ': ' + summary.average +
                                    ' (' + summary.passing +
                                    ' pass / ' + summary.failing +
                                    ' fail)\n';
                            }
                        }
                    }
                }

                out += '\n';
            }
        }

        if (out === '') {
            return emptySectionBody();
        }
        return out;
    }

    function buildGradeLine(grade) {
        if (!grade) { return ''; }

        var weekLabel = isFiniteNumber(grade.week) ||
            isNonEmptyString(grade.week)
            ? 'Wk ' + String(grade.week)
            : 'Wk ?';

        var typeLabel = isNonEmptyString(grade.type)
            ? grade.type
            : 'grade';

        var scoreStr = '';
        var pct = null;
        if (isFiniteNumber(grade.score) &&
            isFiniteNumber(grade.maxScore) &&
            grade.maxScore > 0) {
            scoreStr = grade.score + '/' + grade.maxScore;
            pct = Math.round(
                (grade.score / grade.maxScore) * 100
            );
        }

        var parts = [weekLabel, typeLabel, scoreStr];
        if (pct !== null) {
            parts.push('(' + pct + '%)');
        }

        var line = '      ' + parts.join('  ');
        if (isNonEmptyString(grade.notes)) {
            line += ' \u2014 ' + String(grade.notes)
                .replace(/\s+/g, ' ').trim();
        }

        return line + '\n';
    }

    // ============================================================
    // CLASSES TAUGHT
    // ============================================================

    function buildClassesTaughtSection(char, charId) {
        var Classes = getAcademyClasses();
        if (!Classes ||
            typeof Classes.getClassInstructorIdsAllTime !== 'function') {
            return emptySectionBody();
        }

        if (char.mode !== 'instructor') {
            return emptySectionBody();
        }

        var classIds = [];
        if (Classes && typeof Classes.getClasses === 'function') {
            var all = [];
            try {
                all = Classes.getClasses() || [];
            } catch (e) { all = []; }
            for (var i = 0; i < all.length; i++) {
                if (!all[i] || !all[i].id) { continue; }
                var instructors = [];
                try {
                    instructors = Classes.getClassInstructorIdsAllTime(
                        all[i].id
                    ) || [];
                } catch (e) { instructors = []; }

                for (var ii = 0; ii < instructors.length; ii++) {
                    if (String(instructors[ii]) === String(charId)) {
                        classIds.push(all[i].id);
                        break;
                    }
                }
            }
        }

        if (classIds.length === 0) {
            return emptySectionBody();
        }

        var out = '';

        for (var c = 0; c < classIds.length; c++) {
            var cls = null;
            try {
                cls = Classes.getClass(classIds[c]);
            } catch (e) { cls = null; }
            if (!cls) { continue; }

            var className = isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class';

            out += className + ' [' + cls.id + ']\n';

            // Disciplines taught
            out += buildInstructorDisciplinesBlock(cls.id, charId);

            // Commitments
            out += buildCommitmentsBlock(cls.id, charId);

            out += '\n';
        }

        return out;
    }

    function buildInstructorDisciplinesBlock(classId, charId) {
        var Enrol = getAcademyEnrolments();
        var Disciplines = getAcademyDisciplines();
        var TG = getAcademyTeachingGroups();
        var TS = getAcademyTeachingSessions();

        if (!Enrol ||
            typeof Enrol.getStudentDisciplineIds !== 'function') {
            return indentedLine('Disciplines', '(enrolment module unavailable)');
        }

        var disciplineIds = [];
        try {
            disciplineIds = Enrol.getStudentDisciplineIds(
                charId, classId
            ) || [];
        } catch (e) { disciplineIds = []; }

        if (disciplineIds.length === 0) {
            return indentedLine('Disciplines', '(none)');
        }

        var out = '  ' + 'Disciplines:' + '\n';

        var sortedDisciplines = disciplineIds.slice().sort();

        for (var i = 0; i < sortedDisciplines.length; i++) {
            var did = sortedDisciplines[i];
            var disc = null;
            if (Disciplines &&
                typeof Disciplines.getDiscipline === 'function') {
                try {
                    disc = Disciplines.getDiscipline(did);
                } catch (e) { disc = null; }
            }
            var discName = disc && isNonEmptyString(disc.name)
                ? disc.name
                : 'Unknown Discipline';

            out += '    ' + discName + '\n';

            // Groups this instructor runs for this discipline
            if (TG &&
                typeof TG.getGroupsForClassDisciplineInstructor ===
                    'function') {
                var groups = [];
                try {
                    groups = TG.getGroupsForClassDisciplineInstructor(
                        classId, did, charId
                    ) || [];
                } catch (e) { groups = []; }

                if (groups.length === 0) {
                    out += '      Groups: (none)\n';
                } else {
                    out += '      Groups:\n';
                    for (var g = 0; g < groups.length; g++) {
                        var group = groups[g];
                        if (!group) { continue; }
                        out += '        ' +
                            buildInstructorGroupHeading(group, disc) +
                            '\n';

                        // Members
                        var members = [];
                        try {
                            members = TG.getActiveMembers(
                                group.id, null
                            ) || [];
                        } catch (e) { members = []; }

                        if (Array.isArray(members) &&
                            members.length > 0) {
                            out += '          Members: ' +
                                members.map(function(id) {
                                    return resolveCharName(id);
                                }).join(', ') + '\n';
                        }

                        // Sessions
                        if (TS &&
                            typeof TS.getSessionsForGroup ===
                                'function') {
                            var sessions = [];
                            try {
                                sessions = TS.getSessionsForGroup(
                                    group.id
                                ) || [];
                            } catch (e) { sessions = []; }

                            if (sessions.length > 0) {
                                out += '          Sessions:\n';
                                for (var s = 0; s < sessions.length; s++) {
                                    out +=
                                        '            ' +
                                        buildSessionLine(sessions[s]) +
                                        '\n';
                                }
                            }
                        }
                    }
                }
            } else {
                out += '      Groups: (groups module unavailable)\n';
            }
        }

        return out;
    }

    function buildInstructorGroupHeading(group, discipline) {
        var name = '';
        if (isNonEmptyString(group.customName)) {
            name = String(group.customName);
        } else {
            var discName = discipline && isNonEmptyString(discipline.name)
                ? discipline.name
                : 'Group';
            if (isFiniteNumber(group.groupNumber)) {
                name = discName + ' ' + group.groupNumber;
            } else {
                name = discName;
            }
        }

        var bits = [name];
        if (isNonEmptyString(group.id)) {
            bits.push('[' + group.id + ']');
        }
        return bits.join(' ');
    }

    function buildSessionLine(session) {
        if (!session) { return '(invalid session)'; }

        var AC = getCalendarConstants();
        var dayLabel = 'Day ' + String(session.day || '?');
        if (AC && typeof AC.getDayName === 'function') {
            var dn = AC.getDayName(session.day);
            if (isNonEmptyString(dn)) { dayLabel = dn; }
        }

        var timeLabel = '';
        if (isFiniteNumber(session.startTime)) {
            var start = String(session.startTime).padStart(2, '0');
            var duration = isFiniteNumber(session.duration)
                ? session.duration
                : 1;
            var endHour = session.startTime + duration;
            var end = String(endHour).padStart(2, '0');
            timeLabel = start + ':00\u2013' + end + ':00';
        }

        var locLabel = '';
        if (isNonEmptyString(session.locationId)) {
            var Loc = window.LocationQueries;
            if (Loc && typeof Loc.getLocationName === 'function') {
                var name = Loc.getLocationName(session.locationId);
                if (isNonEmptyString(name) && name !== 'Unknown') {
                    locLabel = name;
                }
            }
        }

        var bits = [dayLabel];
        if (timeLabel) { bits.push(timeLabel); }
        if (locLabel) { bits.push(locLabel); }
        return bits.join(' ');
    }

    function resolveCharName(charId) {
        if (!isNonEmptyString(charId)) { return 'Unknown'; }
        var c = null;
        try {
            c = CharacterQueries.getCharacterById(charId);
        } catch (e) { c = null; }
        if (!c) { return String(charId); }
        try {
            return CharacterQueries.getDisplayName(c) || String(charId);
        } catch (e) {
            return String(charId);
        }
    }

    // ============================================================
    // COMMITMENTS
    // ============================================================

    function buildCommitmentsSection(char, charId) {
        var Commit = getAcademyInstructorCommitments();
        if (!Commit ||
            typeof Commit.getCommitmentsForInstructor !== 'function') {
            return emptySectionBody();
        }

        var commitments = [];
        try {
            commitments = Commit.getCommitmentsForInstructor(charId) || [];
        } catch (e) { commitments = []; }

        if (commitments.length === 0) {
            return emptySectionBody();
        }

        var out = '';

        for (var i = 0; i < commitments.length; i++) {
            var c = commitments[i];
            if (!c) { continue; }

            var kind = isNonEmptyString(c.kind) ? c.kind : 'commitment';
            var kindLabel = kind === 'officeHours'
                ? 'Office hours'
                : (kind === 'tutoring' ? 'Tutoring' : kind);

            var dayLabel = 'Day ' + String(c.day || '?');
            var AC = getCalendarConstants();
            if (AC && typeof AC.getDayName === 'function') {
                var dn = AC.getDayName(c.day);
                if (isNonEmptyString(dn)) { dayLabel = dn; }
            }

            var timeLabel = '';
            if (isFiniteNumber(c.startTime)) {
                var start = String(c.startTime).padStart(2, '0');
                var duration = isFiniteNumber(c.duration)
                    ? c.duration
                    : 1;
                var end = String(c.startTime + duration)
                    .padStart(2, '0');
                timeLabel = start + ':00\u2013' + end + ':00';
            }

            var lineLabel = kindLabel + ': ' + dayLabel;
            if (timeLabel) { lineLabel += ' ' + timeLabel; }

            out += lineLabel + '\n';

            if (isNonEmptyString(c.characterId)) {
                out += indentedLine(
                    'With',
                    resolveCharName(c.characterId)
                );
            }
            if (isNonEmptyString(c.label)) {
                out += indentedLine('Label', c.label);
            }
            if (isNonEmptyString(c.locationId)) {
                var Loc = window.LocationQueries;
                if (Loc &&
                    typeof Loc.getLocationName === 'function') {
                    out += indentedLine(
                        'Location',
                        Loc.getLocationName(c.locationId)
                    );
                }
            }
            out += indentedLine(
                'Period',
                formatWeekRange(c.startWeek, c.endWeek)
            );
        }

        return out;
    }

    // ============================================================
    // TEAMS
    // ============================================================

    function buildTeamsSection(char, charId) {
        var TeamQueries = getTeamQueries();
        if (!TeamQueries ||
            typeof TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated !==
                'function') {
            return emptySectionBody();
        }

        var teams = [];
        try {
            teams = TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated(charId)
                || [];
        } catch (e) { teams = []; }

        if (teams.length === 0) {
            return emptySectionBody();
        }

        // Group by type
        var byType = Object.create(null);
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) { continue; }
            var type = isNonEmptyString(team.type) ? team.type : 'other';
            if (!byType[type]) { byType[type] = []; }
            byType[type].push(team);
        }

        var out = '';

        var typeOrder = ['academic', 'professional', 'temporary', 'civilian'];
        var emittedTypes = Object.create(null);

        for (var to = 0; to < typeOrder.length; to++) {
            var t = typeOrder[to];
            if (byType[t]) {
                out += emitTeamGroup(t, byType[t], charId);
                emittedTypes[t] = true;
            }
        }

        // Any other types not in the canonical order
        var allTypes = Object.keys(byType);
        for (var at = 0; at < allTypes.length; at++) {
            var otherType = allTypes[at];
            if (emittedTypes[otherType]) { continue; }
            out += emitTeamGroup(otherType, byType[otherType], charId);
        }

        if (out === '') {
            return emptySectionBody();
        }
        return out;
    }

    function emitTeamGroup(typeLabel, teams, charId) {
        var displayType = isNonEmptyString(typeLabel)
            ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
            : 'Other';

        teams.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = '';
        out += displayType + ':\n';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var name = isNonEmptyString(team.name)
                ? team.name
                : 'Unnamed Team';

            out += '  ' + name + ' [' + team.id + ']\n';

            // Member record
            var TeamQueries = getTeamQueries();
            var records = [];
            if (TeamQueries &&
                typeof TeamQueries.getAllTeamMemberRecords ===
                    'function') {
                try {
                    records = TeamQueries.getAllTeamMemberRecords(
                        team
                    ) || [];
                } catch (e) { records = []; }
            }

            for (var r = 0; r < records.length; r++) {
                var rec = records[r];
                if (!rec) { continue; }
                if (String(rec.characterId) !== String(charId)) {
                    continue;
                }

                if (isNonEmptyString(rec.role) &&
                    rec.role !== 'Member') {
                    out += indentedLine('Role', rec.role);
                }

                if (Array.isArray(rec.intervals)) {
                    for (var iv = 0; iv < rec.intervals.length; iv++) {
                        var interval = rec.intervals[iv];
                        if (!interval) { continue; }

                        var range = isAcademicTeamType(team.type)
                            ? formatWeekRange(
                                interval.joinPeriod,
                                interval.leavePeriod
                            )
                            : formatYearRange(
                                interval.joinPeriod,
                                interval.leavePeriod
                            );

                        out += indentedLine('Stint', range);
                    }
                }
            }

            if (isNonEmptyString(team.status) &&
                team.status !== 'active') {
                out += indentedLine('Status', team.status);
            }
        }

        return out;
    }

    // ============================================================
    // SOCIAL
    // ============================================================

    function buildSocialSection(char, charId) {
        var SA = getSocialAggregator();
        if (!SA ||
            typeof SA.getCharacterRelationshipsViewModel !== 'function') {
            return emptySectionBody();
        }

        var vm = null;
        try {
            vm = SA.getCharacterRelationshipsViewModel(charId);
        } catch (e) {
            console.warn(
                '[CharacterExport] getCharacterRelationshipsViewModel ' +
                'threw:', e
            );
            vm = null;
        }

        if (!vm || !Array.isArray(vm.relationships) ||
            vm.relationships.length === 0) {
            return emptySectionBody();
        }

        var out = '';

        out += 'Relationships:\n';
        for (var i = 0; i < vm.relationships.length; i++) {
            var rel = vm.relationships[i];
            if (!rel) { continue; }

            var line = '  ' + (rel.otherCharName || 'Unknown');

            if (isNonEmptyString(rel.typeLabel)) {
                line += ' \u2014 ' + rel.typeLabel;
            }
            if (isNonEmptyString(rel.clarification)) {
                line += ' (' + rel.clarification + ')';
            }
            if (isNonEmptyString(rel.period)) {
                line += ' \u00b7 ' + rel.period;
            }
            out += line + '\n';

            if (isNonEmptyString(rel.notes)) {
                out += '      ' + String(rel.notes)
                    .replace(/\s+/g, ' ').trim() + '\n';
            }
        }

        return out;
    }

    // ============================================================
    // MISSIONS
    // ============================================================

    function buildMissionsSection(char, charId) {
        var MQ = getMissionQueries();
        if (!MQ ||
            typeof MQ.getMissionsForCharacter !== 'function') {
            return emptySectionBody();
        }

        var entries = [];
        try {
            entries = MQ.getMissionsForCharacter(charId) || [];
        } catch (e) {
            console.warn(
                '[CharacterExport] getMissionsForCharacter threw:', e
            );
            entries = [];
        }

        if (entries.length === 0) {
            return emptySectionBody();
        }

        // Group by team
        var byTeam = Object.create(null);
        var teamOrder = [];
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry) { continue; }
            var tid = entry.teamId || 'unknown';
            if (!byTeam[tid]) {
                byTeam[tid] = {
                    teamName: entry.teamName || 'Unnamed Team',
                    missions: []
                };
                teamOrder.push(tid);
            }
            byTeam[tid].missions.push(entry.mission);
        }

        var out = '';
        var MC = getMissionConstants();

        for (var t = 0; t < teamOrder.length; t++) {
            var tid = teamOrder[t];
            var group = byTeam[tid];

            out += 'Via ' + group.teamName + ':\n';

            for (var m = 0; m < group.missions.length; m++) {
                var mission = group.missions[m];
                if (!mission) { continue; }

                var title = isNonEmptyString(mission.title)
                    ? mission.title
                    : 'Untitled';

                var status = isNonEmptyString(mission.status)
                    ? mission.status
                    : '';

                var statusLabel = status;
                if (MC &&
                    typeof MC.getStatusLabel === 'function' &&
                    status) {
                    var sl = MC.getStatusLabel(status);
                    if (isNonEmptyString(sl)) { statusLabel = sl; }
                }

                var bits = [title];
                if (statusLabel) {
                    bits.push('[' + statusLabel + ']');
                }
                if (mission.archivedAt) {
                    bits.push('(archived)');
                }

                out += '  ' + bits.join(' ') + '\n';

                if (isNonEmptyString(mission.location)) {
                    out += indentedLine('Location', mission.location);
                }
                if (isNonEmptyString(mission.description)) {
                    out += '      ' + String(mission.description)
                        .replace(/\s+/g, ' ').trim() + '\n';
                }
            }

            out += '\n';
        }

        return out;
    }

    // ============================================================
    // TOURNAMENTS / EXAMS
    // ============================================================

    function buildTournamentsSection(char, charId) {
        var out = '';

        // ---- Eliminations ----
        var EQ = getEliminationQueries();
        var eliminationLines = [];

        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elim = char.eliminations[i];
                if (!elim) { continue; }

                var year = isNonEmptyString(elim.year)
                    ? String(elim.year)
                    : '';
                var week = isFiniteNumber(elim.week) ||
                    isNonEmptyString(elim.week)
                    ? String(elim.week)
                    : '';
                var reason = isNonEmptyString(elim.reason)
                    ? String(elim.reason)
                    : '';

                var bits = [];
                if (year) { bits.push('Year ' + year); }
                if (week) { bits.push('Week ' + week); }

                var source = '';
                if (elim.standalone) {
                    source = 'standalone';
                } else if (elim.fromMatch) {
                    source = 'tournament';
                }

                var lineText = bits.join(', ') || '(undated)';
                if (source) {
                    lineText += ' \u2014 ' + source;
                }
                if (reason) {
                    lineText += ': ' + reason;
                }

                eliminationLines.push(lineText);
            }
        }

        if (eliminationLines.length > 0) {
            out += 'Eliminations:\n';
            for (var el = 0; el < eliminationLines.length; el++) {
                out += '  ' + eliminationLines[el] + '\n';
            }
        }

        // ---- Rankings ----
        var Ranking = getAcademyRanking();
        var Classes = getAcademyClasses();
        var rankLines = [];

        if (Ranking &&
            typeof Ranking.getClassRankings === 'function' &&
            Classes &&
            typeof Classes.getCharacterClasses === 'function') {

            var classes = [];
            try {
                classes = Classes.getCharacterClasses(char) || [];
            } catch (e) { classes = []; }

            for (var c = 0; c < classes.length; c++) {
                var cls = classes[c];
                if (!cls || !cls.id) { continue; }
                var className = isNonEmptyString(cls.name)
                    ? cls.name
                    : 'Unnamed Class';

                var rankings = [];
                try {
                    rankings = Ranking.getClassRankings(
                        cls.id, null, false
                    ) || [];
                } catch (e) { rankings = []; }

                for (var r = 0; r < rankings.length; r++) {
                    var ranking = rankings[r];
                    if (!ranking) { continue; }
                    if (String(ranking.studentId) !== String(charId)) {
                        continue;
                    }

                    var week = isFiniteNumber(ranking.week)
                        ? String(ranking.week)
                        : '?';

                    var lineText = '  ' + className +
                        ', Week ' + week + ': ' +
                        'rank ' + String(ranking.rank || '?');

                    if (isFiniteNumber(ranking.totalStudents) &&
                        ranking.totalStudents > 0) {
                        lineText += ' of ' + ranking.totalStudents;
                    }
                    if (isFiniteNumber(ranking.average)) {
                        lineText += ', average ' + ranking.average;
                    }

                    rankLines.push(lineText);
                }
            }
        }

        if (rankLines.length > 0) {
            out += '\n';
            out += 'Rankings:\n';
            out += rankLines.join('\n') + '\n';
        }

        if (out === '') {
            return emptySectionBody();
        }
        return out;
    }

    // ============================================================
    // ACADEMY HISTORY
    // ============================================================

    function buildAcademyHistorySection(char, charId) {
        var Classes = getAcademyClasses();
        if (!Classes || typeof Classes.getClasses !== 'function') {
            return emptySectionBody();
        }

        var all = [];
        try {
            all = Classes.getClasses() || [];
        } catch (e) { all = []; }

        var out = '';
        var any = false;

        for (var i = 0; i < all.length; i++) {
            var cls = all[i];
            if (!cls) { continue; }
            if (cls.status !== 'graduated') { continue; }

            var belongs = false;
            if (Array.isArray(char.classIds)) {
                for (var cc = 0; cc < char.classIds.length; cc++) {
                    if (String(char.classIds[cc]) ===
                        String(cls.id)) {
                        belongs = true;
                        break;
                    }
                }
            }
            if (!belongs) { continue; }

            any = true;

            var className = isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class';

            var year = isFiniteNumber(cls.year)
                ? String(cls.year)
                : (isNonEmptyString(cls.year) ? cls.year : '');

            var heading = 'Graduated from ' + className;
            if (year) {
                heading += ' in ' + year;
            }

            out += heading + '\n';
            out += indentedLine('Class ID', cls.id);
            out += indentedLine('Status', cls.status);
        }

        if (!any) {
            return emptySectionBody();
        }
        return out;
    }

    // ============================================================
    // REPORT BUILDER
    // ============================================================

    function buildCharacterReport(charId) {
        var char = null;
        try {
            char = CharacterQueries.getCharacterById(charId);
        } catch (e) { char = null; }

        if (!char) { return null; }

        var displayName = '';
        try {
            displayName = CharacterQueries.getDisplayName(char) || '';
        } catch (e) { displayName = ''; }

        var out = '';

        // ---- Banner ----
        out += BANNER + '\n';
        out += 'CHARACTER REPORT \u2014 ' +
            (displayName || 'Unknown') + '\n';
        out += 'Generated: ' + new Date().toISOString() + '\n';
        out += BANNER + '\n\n';

        // ---- AT A GLANCE ----
        out += sectionHeader('AT A GLANCE');
        out += buildAtAGlanceSection(char, charId);
        out += '\n';

        // ---- TIMELINE ----
        out += sectionHeader('TIMELINE');
        out += buildTimelineSection(char, charId);
        out += '\n';

        // ---- IDENTITY ----
        out += sectionHeader('IDENTITY');
        out += buildIdentitySection(char, charId);
        out += '\n';

        // ---- CLASSES (as student) ----
        out += sectionHeader('CLASSES (as student)');
        out += buildClassesAsStudentSection(char, charId);
        out += '\n';

        // ---- DISCIPLINES ENROLLED ----
        out += sectionHeader('DISCIPLINES ENROLLED');
        out += buildDisciplinesEnrolledSection(char, charId);
        out += '\n';

        // ---- CLASSES TAUGHT ----
        out += sectionHeader('CLASSES TAUGHT (as instructor)');
        out += buildClassesTaughtSection(char, charId);
        out += '\n';

        // ---- COMMITMENTS ----
        out += sectionHeader('COMMITMENTS');
        out += buildCommitmentsSection(char, charId);
        out += '\n';

        // ---- TEAMS ----
        out += sectionHeader('TEAMS');
        out += buildTeamsSection(char, charId);
        out += '\n';

        // ---- SOCIAL ----
        out += sectionHeader('SOCIAL');
        out += buildSocialSection(char, charId);
        out += '\n';

        // ---- MISSIONS ----
        out += sectionHeader('MISSIONS');
        out += buildMissionsSection(char, charId);
        out += '\n';

        // ---- TOURNAMENTS / EXAMS ----
        out += sectionHeader('TOURNAMENTS / EXAMS');
        out += buildTournamentsSection(char, charId);
        out += '\n';

        // ---- ACADEMY HISTORY ----
        out += sectionHeader('ACADEMY HISTORY');
        out += buildAcademyHistorySection(char, charId);
        out += '\n';

        // ---- Footer ----
        out += BANNER + '\n';
        out += 'END OF REPORT\n';
        out += 'Character ID: ' + String(charId) + '\n';
        out += 'File generated by Hollow Manager 2\n';
        out += BANNER + '\n';

        return {
            char: char,
            displayName: displayName,
            text: out
        };
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Get the full report as a plain string. No download.
     *
     * @param {string} charId
     * @returns {string} Empty string when the character is missing.
     */
    function getCharacterReportText(charId) {
        if (!isNonEmptyString(charId)) { return ''; }
        var built = buildCharacterReport(charId);
        if (!built) { return ''; }
        return built.text;
    }

    /**
     * Export the report to a .txt file and trigger a download.
     *
     * @param {string} charId
     * @param {object} [options]
     * @param {string} [options.filename]
     * @returns {{
     *   exported: boolean,
     *   filename: string|null,
     *   error: string|null
     * }}
     */
    function exportCharacterText(charId, options) {
        options = options || {};

        if (!isNonEmptyString(charId)) {
            return {
                exported: false,
                filename: null,
                error: 'Character ID is required.'
            };
        }

        var built = null;
        try {
            built = buildCharacterReport(String(charId));
        } catch (e) {
            return {
                exported: false,
                filename: null,
                error: 'Failed to build report: ' + e.message
            };
        }

        if (!built) {
            return {
                exported: false,
                filename: null,
                error: 'Character not found.'
            };
        }

        var slug = sanitiseForFilename(built.displayName);
        var filename = options.filename ||
            FILENAME_PREFIX + '-' + slug + '-' +
            String(charId) + '.txt';

        // No BOM. Plain text does not need it, and it produces a
        // phantom character in most Unix tooling.
        var blob;
        try {
            blob = new Blob([built.text], {
                type: 'text/plain;charset=utf-8'
            });
        } catch (e) {
            return {
                exported: false,
                filename: null,
                error: 'Failed to build file blob: ' + e.message
            };
        }

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                filename: null,
                error: 'Failed to download: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            error: null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterExport = Object.freeze({
        getCharacterReportText: getCharacterReportText,
        exportCharacterText: exportCharacterText
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterExport;
        var missing = [];

        var required = [
            'getCharacterReportText',
            'exportCharacterText'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterExport] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
