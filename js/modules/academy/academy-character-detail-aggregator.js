/**
 * modules/academy/academy-character-detail-aggregator.js
 * Projection builder for the Academy character detail panel.
 *
 * Path: js/modules/academy/academy-character-detail-aggregator.js
 *
 * Produces the view model consumed by AcademyCharacterDetail.
 *
 * TEACHING GROUP CANDIDATE VIEW MODEL:
 *   The candidate picker for "add a student to this group" returns
 *   two lists:
 *
 *     candidates  — students who can be added.
 *     blocked     — students who would collide if added, i.e.
 *                   adding them to this group's sessions would
 *                   put them in two places at once.
 *
 *   The blocked list is not excluded from the picker; it is
 *   shown below the eligible list so the user can see who they
 *   cannot add and why. Blocked rows are not selectable.
 *
 * DISCIPLINE-HOURS VIEW MODEL:
 *   Each discipline row carries:
 *
 *     currentGroup       — the group the student is already in
 *                          for this discipline, or null.
 *     groups             — the OTHER groups of this discipline,
 *                          each with a status of 'green' or 'red'
 *                          and (when red) a conflictingGroups list.
 *
 *   When currentGroup is non-null:
 *     - `groups` is [] (the picker offers no other groups)
 *     - `hasCurrentGroup` is true
 *   The picker renders a single "leave this group?" affordance
 *   instead of a group list.
 *
 *   When currentGroup is null:
 *     - `groups` is populated
 *     - `hasCurrentGroup` is false
 *
 * CONFLICT DETECTION:
 *   A candidate group's session conflicts with the student's
 *   current schedule if ANY occupied cell — start OR continuation
 *   — of the student's schedule falls inside the candidate
 *   session's [start, start+duration) window.
 *
 *   Continuation cells are occupied time. Skipping them was the
 *   bug that let a candidate whose session overlapped the second
 *   half of an existing session report as "green".
 *
 *   The conflict is REPORTED at the existing session's start hour.
 *   When the colliding cell is a continuation, the collector walks
 *   back through the student's schedule to find the session start,
 *   and reports the conflict against the start (day, hour) — the
 *   hour the student, or a reader, thinks of as "when the session
 *   is".
 *
 *   Each red candidate carries `conflictingGroups[]`: one entry per
 *   distinct group of the student's that collides, deduped by
 *   groupId. The user sees every conflict and picks which to
 *   leave.
 *
 * DEPENDENCIES (mandatory):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyDisciplines
 *   - window.AcademyEnrolments
 *   - window.AcademyGrades
 *   - window.AcademyTeachingGroups
 *   - window.CalendarConstants
 *
 * DEPENDENCIES (optional, feature-scoped):
 *   - window.AcademyTeachingSessions
 *   - window.AcademyLocations
 *   - window.AcademyPerformance
 *   - window.AcademySocialScore
 *   - window.TeamQueries
 *   - window.EliminationQueries
 *   - window.AcademyCalendarAggregator
 *   - window.AcademyTeachingProjector
 *   - window.RangeUtils
 */

(function() {
    'use strict';

    if (window.__academyCharacterDetailAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyGrades = window.AcademyGrades;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // MANDATORY DEPENDENCY CHECK
    // ============================================================

    var missing = [];

    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
        missing.push('CharacterQueries.getCurrentStatus');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
        missing.push('CharacterQueries.getCharacterAge');
    }

    if (!AcademyClasses || typeof AcademyClasses.getCharacterClasses !== 'function') {
        missing.push('AcademyClasses.getCharacterClasses');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        missing.push('AcademyClasses.getClass');
    }

    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDisciplinesForClass !== 'function') {
        missing.push(
            'AcademyClassDisciplinesQueries.getClassDisciplinesForClass'
        );
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.isActiveInWeek !== 'function') {
        missing.push(
            'AcademyClassDisciplinesQueries.isActiveInWeek'
        );
    }

    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        missing.push('AcademyDisciplines.getDiscipline');
    }

    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getStudentDisciplineIds !== 'function') {
        missing.push('AcademyEnrolments.getStudentDisciplineIds');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.isEnrolled !== 'function') {
        missing.push('AcademyEnrolments.isEnrolled');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.isEnrolledInWeek !== 'function') {
        missing.push('AcademyEnrolments.isEnrolledInWeek');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getEnrolledStudents !== 'function') {
        missing.push('AcademyEnrolments.getEnrolledStudents');
    }

    if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
        missing.push('AcademyGrades.getStudentClassGrades');
    }
    if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
        missing.push('AcademyGrades.calculateSummary');
    }

    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupsForInstructor !== 'function') {
        missing.push('AcademyTeachingGroups.getGroupsForInstructor');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getActiveMembers !== 'function') {
        missing.push('AcademyTeachingGroups.getActiveMembers');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupsForDiscipline !== 'function') {
        missing.push('AcademyTeachingGroups.getGroupsForDiscipline');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupForStudentInClassDiscipline !== 'function') {
        missing.push(
            'AcademyTeachingGroups.getGroupForStudentInClassDiscipline'
        );
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.isMemberOfGroup !== 'function') {
        missing.push('AcademyTeachingGroups.isMemberOfGroup');
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (missing.length > 0) {
        throw new Error(
            '[AcademyCharacterDetailAggregator] Missing mandatory dependencies: ' +
            missing.join(', ')
        );
    }

    window.__academyCharacterDetailAggregatorLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyPerformance() { return window.AcademyPerformance || null; }
    function getAcademySocialScore() { return window.AcademySocialScore || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }
    function getAcademyTeachingSessions() {
        return window.AcademyTeachingSessions || null;
    }
    function getAcademyLocations() {
        return window.AcademyLocations || null;
    }
    function getAcademyCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
    }
    function getAcademyTeachingProjector() {
        return window.AcademyTeachingProjector || null;
    }
    function getRangeUtils() {
        return window.RangeUtils || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown Discipline';
        }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        return d && isNonEmptyString(d.name) ? d.name : 'Unknown Discipline';
    }

    function getDisciplineType(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return '';
        }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        return d && isNonEmptyString(d.type) ? d.type : '';
    }

    function getDisciplineWeeklyHours(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 0;
        }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        if (!d) { return 0; }
        return isFiniteNumber(d.weeklyHours) ? d.weeklyHours : 0;
    }

    function resolveWeek(options) {
        if (!options || options.week === undefined || options.week === null) {
            return null;
        }
        var n = Number(options.week);
        if (!Number.isInteger(n)) {
            return null;
        }
        if (n < CalendarConstants.MIN_WEEK || n > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return n;
    }

    function resolveMode(options) {
        if (options && options.mode === 'instructor') {
            return 'instructor';
        }
        return 'student';
    }

    function resolveActiveTab(options, mode) {
        var requested = options && options.tab ? String(options.tab) : 'main';

        var STUDENT_TABS = ['main', 'disciplines', 'grades', 'schedule', 'teams'];
        var INSTRUCTOR_TABS = ['main', 'disciplines', 'schedule', 'teachingGroups'];
        var valid = mode === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;

        return valid.indexOf(requested) !== -1 ? requested : 'main';
    }

    function getTabsForMode(mode) {
        if (mode === 'instructor') {
            return [
                { id: 'main',           label: 'Main' },
                { id: 'disciplines',    label: 'Disciplines' },
                { id: 'schedule',       label: 'Schedule' },
                { id: 'teachingGroups', label: 'Teaching Groups' }
            ];
        }
        return [
            { id: 'main',        label: 'Main' },
            { id: 'disciplines', label: 'Disciplines' },
            { id: 'grades',      label: 'Grades' },
            { id: 'schedule',    label: 'Schedule' },
            { id: 'teams',       label: 'Teams' }
        ];
    }

    // ============================================================
    // HEADER PROJECTION
    // ============================================================

    function buildCharacterHeader(char) {
        return {
            id: char.id,
            name: CharacterQueries.getDisplayName(char),
            status: CharacterQueries.getCurrentStatus(char),
            age: CharacterQueries.getCharacterAge(char),
            deceased: char.deceased === true
        };
    }

    // ============================================================
    // CLASS CONTEXT
    // ============================================================

    function buildClassContext(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }
        return {
            id: cls.id,
            name: isNonEmptyString(cls.name) ? cls.name : 'Unnamed Class'
        };
    }

    function buildCharacterClasses(char) {
        var classes = AcademyClasses.getCharacterClasses(char) || [];
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (!c || !c.id) { continue; }
            result.push({
                id: c.id,
                name: isNonEmptyString(c.name) ? c.name : 'Unnamed Class'
            });
        }
        return result;
    }

    // ============================================================
    // ELIMINATION PROJECTION
    // ============================================================

    function buildElimination(char, week) {
        if (week === null) {
            return null;
        }
        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.getEliminationWeek !== 'function') {
            return null;
        }

        var eliminationWeek = null;
        try {
            eliminationWeek = EQ.getEliminationWeek(char);
        } catch (e) {
            return null;
        }

        if (!isFiniteNumber(eliminationWeek)) {
            return null;
        }

        if (week < eliminationWeek) {
            return null;
        }

        var reason = '';
        if (typeof EQ.getEliminationReason === 'function') {
            try {
                var r = EQ.getEliminationReason(char);
                if (isNonEmptyString(r) && r !== 'Unknown') {
                    reason = r;
                }
            } catch (e) {
                reason = '';
            }
        }

        return {
            week: eliminationWeek,
            reason: reason,
            state: week === eliminationWeek ? 'current' : 'past'
        };
    }

    // ============================================================
    // PERFORMANCE PROJECTION
    // ============================================================

    function buildPerformance(char, classId, week) {
        if (!isNonEmptyString(classId) || week === null) {
            return null;
        }

        var AP = getAcademyPerformance();
        if (!AP) {
            return null;
        }

        var academic = null;
        var social = null;
        var overall = null;

        if (typeof AP.calculateAcademicAverage === 'function') {
            try {
                var academicResult = AP.calculateAcademicAverage(char.id, classId, week);
                if (academicResult && isFiniteNumber(academicResult.average)) {
                    academic = academicResult.average;
                }
            } catch (e) {
                // Leave null.
            }
        }

        var ASS = getAcademySocialScore();
        if (ASS && typeof ASS.getSocialScore === 'function') {
            try {
                var s = ASS.getSocialScore(char.id, classId, week);
                if (isFiniteNumber(s)) {
                    social = s;
                }
            } catch (e) {
                // Leave null.
            }
        }

        if (typeof AP.calculateOverallScore === 'function') {
            try {
                var o = AP.calculateOverallScore(char.id, classId, week);
                if (isFiniteNumber(o)) {
                    overall = o;
                }
            } catch (e) {
                // Leave null.
            }
        }

        return {
            week: week,
            academicAverage: academic,
            socialScore: social,
            overallScore: overall
        };
    }

    // ============================================================
    // STUDENT PROJECTION
    // ============================================================

    function buildStudentDisciplines(char, classId) {
        var ids = [];
        try {
            ids = AcademyEnrolments.getStudentDisciplineIds(
                char.id, classId
            ) || [];
        } catch (e) {
            ids = [];
        }

        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (!isNonEmptyString(id)) { continue; }
            result.push({
                id: id,
                name: getDisciplineName(id),
                type: getDisciplineType(id)
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function buildStudentGrades(char, classId) {
        var grades = [];
        try {
            grades = AcademyGrades.getStudentClassGrades(char.id, classId) || [];
        } catch (e) {
            grades = [];
        }

        var summary = AcademyGrades.calculateSummary(grades);

        return {
            average: summary && isFiniteNumber(summary.average) && summary.count > 0
                ? summary.average
                : null,
            count: summary && isFiniteNumber(summary.count) ? summary.count : 0,
            hasAny: summary && summary.count > 0
        };
    }

    function buildStudentTeams(char, week) {
        var TeamQ = getTeamQueries();
        if (!TeamQ || typeof TeamQ.getTeamsForCharacter !== 'function') {
            return null;
        }

        var teams = [];
        try {
            teams = TeamQ.getTeamsForCharacter(char.id, week) || [];
        } catch (e) {
            teams = [];
        }

        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            result.push({
                id: team.id,
                name: isNonEmptyString(team.name) ? team.name : 'Unnamed Team',
                typeLabel: isNonEmptyString(team.type) ? team.type : 'team'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function buildStudentProjection(char, classId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        return {
            disciplines: buildStudentDisciplines(char, classId),
            grades: buildStudentGrades(char, classId),
            teams: week !== null ? buildStudentTeams(char, week) : null
        };
    }

    // ============================================================
    // INSTRUCTOR DISCIPLINES
    // ============================================================

    function buildInstructorDisciplines(char) {
        var charClasses = AcademyClasses.getCharacterClasses(char) || [];
        if (!Array.isArray(charClasses) || charClasses.length === 0) {
            return [];
        }

        var classById = Object.create(null);
        for (var c = 0; c < charClasses.length; c++) {
            var cls = charClasses[c];
            if (!cls || !cls.id) { continue; }
            classById[String(cls.id)] = {
                id: cls.id,
                name: isNonEmptyString(cls.name) ? cls.name : 'Unnamed Class'
            };
        }

        var classIds = Object.keys(classById);
        var disciplinesById = Object.create(null);

        for (var ci = 0; ci < classIds.length; ci++) {
            var classId = classIds[ci];

            var markers = [];
            try {
                markers = AcademyClassDisciplinesQueries
                    .getClassDisciplinesForClass(classId) || [];
            } catch (e) {
                markers = [];
            }

            for (var m = 0; m < markers.length; m++) {
                var marker = markers[m];
                if (!marker || !marker.disciplineId) { continue; }

                var disciplineId = String(marker.disciplineId);

                var enrolled = false;
                try {
                    enrolled = AcademyEnrolments.isEnrolled(
                        char.id, classId, disciplineId
                    ) === true;
                } catch (e) {
                    enrolled = false;
                }

                if (!enrolled) { continue; }

                if (!disciplinesById[disciplineId]) {
                    disciplinesById[disciplineId] = {
                        id: disciplineId,
                        name: getDisciplineName(disciplineId),
                        type: getDisciplineType(disciplineId),
                        classIds: [],
                        classNames: []
                    };
                }

                var entry = disciplinesById[disciplineId];
                if (entry.classIds.indexOf(classId) === -1) {
                    entry.classIds.push(classId);
                    entry.classNames.push(classById[classId].name);
                }
            }
        }

        var result = [];
        var keys = Object.keys(disciplinesById);
        for (var k = 0; k < keys.length; k++) {
            var d = disciplinesById[keys[k]];
            d.classIds.sort();
            d.classNames.sort();
            result.push(d);
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // TEACHING GROUPS — SESSION VMs
    // ============================================================

    function buildTeachingGroupSessionsVM(group) {
        if (!group || !group.id) { return []; }

        var TS = getAcademyTeachingSessions();
        if (!TS || typeof TS.getSessionsForGroup !== 'function') {
            return [];
        }

        var rawSessions = [];
        try {
            rawSessions = TS.getSessionsForGroup(group.id) || [];
        } catch (e) {
            rawSessions = [];
        }

        if (!Array.isArray(rawSessions)) { return []; }

        var disciplineStart = null;
        var disciplineEnd = null;
        if (isNonEmptyString(group.disciplineId)) {
            var disc = AcademyDisciplines.getDiscipline(
                group.disciplineId
            );
            if (disc) {
                if (isFiniteNumber(disc.startWeek)) {
                    disciplineStart = disc.startWeek;
                }
                if (disc.endWeek !== undefined &&
                    disc.endWeek !== null) {
                    disciplineEnd = disc.endWeek;
                }
            }
        }

        var result = [];

        for (var i = 0; i < rawSessions.length; i++) {
            var s = rawSessions[i];
            if (!s || !s.id) { continue; }

            var startWeek = isFiniteNumber(s.startWeek)
                ? s.startWeek
                : disciplineStart;
            var endWeek = (s.endWeek !== undefined && s.endWeek !== null)
                ? s.endWeek
                : disciplineEnd;

            var dayLabel = '';
            if (isFiniteNumber(s.day) &&
                typeof CalendarConstants.getDayName === 'function') {
                try {
                    dayLabel = CalendarConstants.getDayName(s.day) || '';
                } catch (e) {
                    dayLabel = '';
                }
            }

            var startTimeLabel = '';
            if (isFiniteNumber(s.startTime) &&
                typeof CalendarConstants.formatHour === 'function') {
                try {
                    startTimeLabel =
                        CalendarConstants.formatHour(s.startTime) || '';
                } catch (e) {
                    startTimeLabel = '';
                }
            }

            var durationNum = isFiniteNumber(s.duration)
                ? s.duration
                : 1;
            var durationLabel = durationNum + 'h';

            var locationId = isNonEmptyString(s.locationId)
                ? String(s.locationId)
                : null;

            var locationName = '';
            if (locationId) {
                var AL = getAcademyLocations();
                if (AL && typeof AL.getLocationName === 'function') {
                    try {
                        var n = AL.getLocationName(locationId);
                        if (isNonEmptyString(n) && n !== 'Unknown') {
                            locationName = n;
                        }
                    } catch (e) {
                        locationName = '';
                    }
                }
            }

            var periodDisplay = '';
            if (isFiniteNumber(startWeek)) {
                if (isFiniteNumber(endWeek)) {
                    periodDisplay = 'Wk ' + startWeek +
                        '\u2013' + endWeek;
                } else {
                    periodDisplay = 'From wk ' + startWeek;
                }
            }

            result.push({
                sessionId: String(s.id),
                day: s.day,
                dayLabel: dayLabel,
                startTime: s.startTime,
                startTimeLabel: startTimeLabel,
                duration: durationNum,
                durationLabel: durationLabel,
                locationId: locationId,
                locationName: locationName,
                startWeek: startWeek,
                endWeek: endWeek,
                periodDisplay: periodDisplay
            });
        }

        result.sort(function(a, b) {
            if (a.day !== b.day) { return (a.day || 0) - (b.day || 0); }
            if (a.startTime !== b.startTime) {
                return (a.startTime || 0) - (b.startTime || 0);
            }
            return String(a.sessionId).localeCompare(
                String(b.sessionId)
            );
        });

        return result;
    }

    // ============================================================
    // TEACHING GROUPS — GROUP VMs
    // ============================================================

    function buildInstructorTeachingGroups(char, classId, week) {
        if (!isNonEmptyString(classId) || week === null) {
            return [];
        }

        var disciplines = buildInstructorDisciplines(char);
        var teachesForClass = [];
        for (var d = 0; d < disciplines.length; d++) {
            var disc = disciplines[d];
            if (disc.classIds.indexOf(String(classId)) !== -1) {
                teachesForClass.push(disc);
            }
        }

        if (teachesForClass.length === 0) {
            return [];
        }

        var allGroups = [];
        try {
            allGroups = AcademyTeachingGroups.getGroupsForInstructor(
                char.id
            ) || [];
        } catch (e) {
            allGroups = [];
        }

        var groupsByDiscipline = Object.create(null);
        for (var g = 0; g < allGroups.length; g++) {
            var group = allGroups[g];
            if (!group || !group.id) { continue; }
            if (String(group.classId) !== String(classId)) { continue; }

            var discId = String(group.disciplineId || '');
            if (discId === '') { continue; }

            if (!groupsByDiscipline[discId]) {
                groupsByDiscipline[discId] = [];
            }
            groupsByDiscipline[discId].push(group);
        }

        var result = [];

        for (var t = 0; t < teachesForClass.length; t++) {
            var taught = teachesForClass[t];
            var rawGroups = groupsByDiscipline[taught.id] || [];

            rawGroups.sort(function(a, b) {
                var an = isFiniteNumber(a.groupNumber) ? a.groupNumber : 0;
                var bn = isFiniteNumber(b.groupNumber) ? b.groupNumber : 0;
                if (an !== bn) { return an - bn; }
                return String(a.id).localeCompare(String(b.id));
            });

            var groupVMs = [];
            for (var r = 0; r < rawGroups.length; r++) {
                var groupVM = buildTeachingGroupVM(rawGroups[r], week);
                if (groupVM) { groupVMs.push(groupVM); }
            }

            result.push({
                disciplineId: taught.id,
                disciplineName: taught.name,
                groups: groupVMs
            });
        }

        return result;
    }

    function buildTeachingGroupVM(group, week) {
        if (!group || !group.id) { return null; }

        var memberIds = [];
        try {
            memberIds = AcademyTeachingGroups.getActiveMembers(
                group.id, week
            ) || [];
        } catch (e) {
            memberIds = [];
        }

        var members = [];
        for (var i = 0; i < memberIds.length; i++) {
            var charId = memberIds[i];
            if (!isNonEmptyString(charId)) { continue; }
            var c = CharacterQueries.getCharacterById(charId);
            if (!c) {
                members.push({
                    id: charId,
                    name: 'Unknown',
                    status: '',
                    age: '',
                    deceased: false
                });
                continue;
            }
            members.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true
            });
        }

        members.sort(function(a, b) {
            return String(a.name || '').localeCompare(
                String(b.name || '')
            );
        });

        var customName = isNonEmptyString(group.customName)
            ? String(group.customName).trim()
            : null;

        var groupNumber = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;

        var disciplineName = getDisciplineName(group.disciplineId);

        var displayName = customName !== null
            ? customName
            : (disciplineName + (groupNumber > 0
                ? ' ' + groupNumber
                : ''));

        var sessions = buildTeachingGroupSessionsVM(group);

        return {
            groupId: String(group.id),
            customName: customName,
            groupNumber: groupNumber,
            displayName: displayName,
            memberCount: members.length,
            members: members,
            sessionCount: sessions.length,
            sessions: sessions
        };
    }

    function buildInstructorProjection(char, classId, week) {
        return {
            disciplines: buildInstructorDisciplines(char),
            teachingGroups: buildInstructorTeachingGroups(
                char, classId, week
            ),
            week: week
        };
    }

    // ============================================================
    // TEACHING GROUP CANDIDATE VIEW MODEL
    // ============================================================
    //
    // See the file header for the shape. Two lists are returned:
    // candidates (selectable) and blocked (visible, not
    // selectable, with a conflict reason).

    function buildInstructorExclusionSet(classId, disciplineId, week) {
        var set = Object.create(null);

        if (!isNonEmptyString(classId) || week === null) {
            return set;
        }

        if (typeof AcademyClasses.getClassInstructorIds !== 'function') {
            return set;
        }

        var options = isNonEmptyString(disciplineId)
            ? { disciplineId: String(disciplineId) }
            : null;

        var instructorIds = [];
        try {
            instructorIds = AcademyClasses.getClassInstructorIds(
                classId, week, options
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyCharacterDetailAggregator] ' +
                'getClassInstructorIds failed:', e
            );
            return set;
        }

        if (!Array.isArray(instructorIds)) {
            return set;
        }

        for (var i = 0; i < instructorIds.length; i++) {
            if (instructorIds[i] === undefined ||
                instructorIds[i] === null) {
                continue;
            }
            set[String(instructorIds[i])] = true;
        }

        return set;
    }

    /**
     * Build the schedule map for a whole week in one projector
     * call. The map is charId → occurrences[].
     *
     * Used by the candidate picker to check collisions for every
     * candidate at once. The projector walks the whole teaching
     * model once; the per-candidate comparison is then a small
     * in-memory loop.
     *
     * Returns an empty object when the projector is unavailable or
     * the call throws.
     */
    function buildWeekScheduleMapForCandidates(week) {
        var Projector = getAcademyTeachingProjector();
        if (!Projector || typeof Projector.projectWeek !== 'function') {
            return Object.create(null);
        }

        var occurrences = [];
        try {
            occurrences = Projector.projectWeek(week) || [];
        } catch (e) {
            console.warn(
                '[AcademyCharacterDetailAggregator] ' +
                'projectWeek failed while building candidate map:', e
            );
            return Object.create(null);
        }

        var map = Object.create(null);

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ || typeof occ !== 'object') { continue; }
            if (!Array.isArray(occ.studentIds)) { continue; }

            for (var s = 0; s < occ.studentIds.length; s++) {
                var id = occ.studentIds[s];
                if (!isNonEmptyString(id)) { continue; }
                var key = String(id);
                if (!map[key]) { map[key] = []; }
                map[key].push(occ);
            }
        }

        return map;
    }

    /**
     * Return the target group's sessions, filtered to those active
     * in the display week.
     *
     * The session records are the raw ones from the sessions
     * store; the picker only needs day, startTime, duration.
     * Session startWeek / endWeek is checked against the query
     * week before the session is included.
     */
    function readTargetGroupSessions(group, week) {
        if (!group || !group.id) { return []; }

        var TS = getAcademyTeachingSessions();
        if (!TS || typeof TS.getSessionsForGroup !== 'function') {
            return [];
        }

        var raw = [];
        try {
            raw = TS.getSessionsForGroup(group.id) || [];
        } catch (e) {
            raw = [];
        }

        if (!Array.isArray(raw)) { return []; }

        // Discipline window: when a session does not carry its own
        // week range, the discipline's range is the fallback.
        var discStart = null;
        var discEnd = null;
        if (isNonEmptyString(group.disciplineId)) {
            var disc = AcademyDisciplines.getDiscipline(
                group.disciplineId
            );
            if (disc) {
                if (isFiniteNumber(disc.startWeek)) {
                    discStart = disc.startWeek;
                }
                if (disc.endWeek !== undefined && disc.endWeek !== null) {
                    discEnd = disc.endWeek;
                }
            }
        }

        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var s = raw[i];
            if (!s || typeof s !== 'object') { continue; }
            if (!isFiniteNumber(s.day)) { continue; }
            if (!isFiniteNumber(s.startTime)) { continue; }

            var startWeek = isFiniteNumber(s.startWeek)
                ? s.startWeek : discStart;
            var endWeek = (s.endWeek !== undefined && s.endWeek !== null)
                ? s.endWeek : discEnd;

            if (startWeek !== null &&
                startWeek !== undefined &&
                week < startWeek) {
                continue;
            }
            if (endWeek !== null &&
                endWeek !== undefined &&
                week > endWeek) {
                continue;
            }

            result.push({
                sessionId: s.id || null,
                day: s.day,
                startTime: s.startTime,
                duration: isFiniteNumber(s.duration) ? s.duration : 1
            });
        }

        return result;
    }

    /**
     * Does any of the candidate's occurrences overlap any of the
     * target group's sessions?
     *
     * Time overlap: same day, and [start, start + duration)
     * intersect. Back-to-back sessions do not overlap.
     *
     * Returns the first collision found, or null.
     */
    function findCandidateConflict(
        candidateOccurrences,
        targetSessions
    ) {
        if (!Array.isArray(candidateOccurrences) ||
            !Array.isArray(targetSessions)) {
            return null;
        }

        for (var i = 0; i < candidateOccurrences.length; i++) {
            var occ = candidateOccurrences[i];
            if (!occ) { continue; }
            if (!isFiniteNumber(occ.day)) { continue; }
            if (!isFiniteNumber(occ.startTime)) { continue; }

            var occStart = occ.startTime;
            var occEnd = occ.startTime +
                (isFiniteNumber(occ.duration) ? occ.duration : 1);

            for (var j = 0; j < targetSessions.length; j++) {
                var s = targetSessions[j];
                if (!s) { continue; }
                if (s.day !== occ.day) { continue; }

                var sStart = s.startTime;
                var sEnd = s.startTime +
                    (isFiniteNumber(s.duration) ? s.duration : 1);

                if (occStart < sEnd && sStart < occEnd) {
                    return {
                        day: occ.day,
                        startTime: occ.startTime,
                        endTime: occEnd,
                        conflictingSessionId: occ.sessionId || null,
                        conflictingGroupId: occ.groupId || null,
                        conflictingDisciplineId: occ.disciplineId || null
                    };
                }
            }
        }

        return null;
    }

    function getTeachingGroupCandidateViewModel(charId, groupId, options) {
        if (!isNonEmptyString(charId) || !isNonEmptyString(groupId)) {
            return null;
        }

        options = options || {};
        var week = resolveWeek(options);
        if (week === null) {
            return null;
        }

        var group = null;
        try {
            group = AcademyTeachingGroups.getGroup(groupId);
        } catch (e) {
            group = null;
        }
        if (!group) {
            return null;
        }

        if (String(group.instructorId) !== String(charId)) {
            return null;
        }

        var classId = String(group.classId);
        var disciplineId = String(group.disciplineId);

        var enrolledIds = [];
        try {
            enrolledIds = AcademyEnrolments.getEnrolledStudents(
                classId, disciplineId, week
            ) || [];
        } catch (e) {
            enrolledIds = [];
        }

        var excluded = Object.create(null);

        var thisGroupMembers = [];
        try {
            thisGroupMembers = AcademyTeachingGroups.getActiveMembers(
                groupId, week
            ) || [];
        } catch (e) {
            thisGroupMembers = [];
        }
        for (var a = 0; a < thisGroupMembers.length; a++) {
            if (thisGroupMembers[a]) {
                excluded[String(thisGroupMembers[a])] = true;
            }
        }

        var siblingGroups = [];
        try {
            siblingGroups = AcademyTeachingGroups.getGroupsForDiscipline(
                classId, disciplineId
            ) || [];
        } catch (e) {
            siblingGroups = [];
        }
        for (var s = 0; s < siblingGroups.length; s++) {
            var sg = siblingGroups[s];
            if (!sg || !sg.id) { continue; }
            if (String(sg.id) === String(groupId)) { continue; }

            var siblingMembers = [];
            try {
                siblingMembers = AcademyTeachingGroups.getActiveMembers(
                    sg.id, week
                ) || [];
            } catch (e) {
                siblingMembers = [];
            }
            for (var sm = 0; sm < siblingMembers.length; sm++) {
                if (siblingMembers[sm]) {
                    excluded[String(siblingMembers[sm])] = true;
                }
            }
        }

        var instructorSet = buildInstructorExclusionSet(
            classId, disciplineId, week
        );

        // ---- Collision context ----
        //
        // One projector call, one schedule map. Then per candidate
        // a small in-memory overlap check.
        var scheduleMap = buildWeekScheduleMapForCandidates(week);
        var targetSessions = readTargetGroupSessions(group, week);

        var EQ = getEliminationQueries();

        var candidates = [];
        var blocked = [];

        for (var e = 0; e < enrolledIds.length; e++) {
            var candidateId = enrolledIds[e];
            if (!isNonEmptyString(candidateId)) { continue; }

            var key = String(candidateId);

            if (excluded[key]) { continue; }
            if (instructorSet[key]) { continue; }

            var c = CharacterQueries.getCharacterById(candidateId);
            if (!c) { continue; }

            if (c.mode === 'instructor') { continue; }

            if (EQ && typeof EQ.isCharacterEliminatedByWeek === 'function') {
                var eliminated = false;
                try {
                    eliminated = EQ.isCharacterEliminatedByWeek(
                        candidateId, week
                    ) === true;
                } catch (err) {
                    eliminated = false;
                }
                if (eliminated) { continue; }
            }

            var baseEntry = {
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true
            };

            // ---- Collision check ----
            //
            // The candidate's occurrences for the display week,
            // cross-checked against the target group's sessions.
            //
            // targetSessions is empty when the group has no
            // sessions yet — in that case there is nothing to
            // collide with and the candidate goes straight into
            // candidates.
            var candidateOccurrences = scheduleMap[key] || [];
            var conflict = findCandidateConflict(
                candidateOccurrences, targetSessions
            );

            if (conflict) {
                blocked.push({
                    id: baseEntry.id,
                    name: baseEntry.name,
                    status: baseEntry.status,
                    age: baseEntry.age,
                    deceased: baseEntry.deceased,
                    conflict: conflict
                });
                continue;
            }

            candidates.push(baseEntry);
        }

        candidates.sort(function(a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        blocked.sort(function(a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        var disciplineName = getDisciplineName(disciplineId);
        var groupNumber = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;
        var customName = isNonEmptyString(group.customName)
            ? String(group.customName).trim()
            : null;

        var groupDisplayName = customName !== null
            ? customName
            : (disciplineName + (groupNumber > 0
                ? ' ' + groupNumber
                : ''));

        return {
            groupId: String(group.id),
            groupDisplayName: groupDisplayName,
            disciplineId: disciplineId,
            disciplineName: disciplineName,
            candidates: candidates,
            blocked: blocked
        };
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function getViewModel(charId, options) {
        if (!isNonEmptyString(charId)) {
            return null;
        }

        options = options || {};
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return null;
        }

        var week = resolveWeek(options);
        var mode = resolveMode(options);
        var activeTab = resolveActiveTab(options, mode);

        var classId = isNonEmptyString(options.classId)
            ? String(options.classId)
            : null;

        var classContext = buildClassContext(classId);
        var characterHeader = buildCharacterHeader(char);
        var classes = buildCharacterClasses(char);
        var elimination = buildElimination(char, week);
        var performance = buildPerformance(char, classId, week);

        var student = mode === 'student'
            ? buildStudentProjection(char, classId, week)
            : null;

        var instructor = mode === 'instructor'
            ? buildInstructorProjection(char, classId, week)
            : null;

        return {
            character: characterHeader,

            mode: mode,
            activeTab: activeTab,
            tabs: getTabsForMode(mode),

            classContext: classContext,
            classes: classes,

            week: week,

            elimination: elimination,
            performance: performance,

            student: student,
            instructor: instructor
        };
    }

    // ============================================================
    // SCHEDULE GRID VIEW MODEL
    // ============================================================

    var VALID_SCHEDULE_MODES = ['student', 'instructor'];

    function getScheduleGridViewModel(charId, options) {
        var week = null;
        var mode = 'student';
        var classId = null;

        if (options !== undefined && options !== null) {
            if (typeof options === 'object') {
                week = options.week;

                if (options.mode !== undefined) {
                    mode = options.mode;
                }
                if (isNonEmptyString(options.classId)) {
                    classId = String(options.classId);
                }
            } else {
                week = options;
            }
        }

        return buildScheduleGridViewModel(charId, week, mode, classId);
    }

    function buildScheduleGridViewModel(charId, week, mode, classId) {
        if (!isNonEmptyString(charId)) {
            return null;
        }

        if (VALID_SCHEDULE_MODES.indexOf(mode) === -1) {
            console.warn(
                '[AcademyCharacterDetailAggregator] ' +
                'getScheduleGridViewModel received an unknown mode:',
                mode
            );
            return null;
        }

        var weekNum = null;
        if (week !== undefined && week !== null) {
            var n = Number(week);
            if (Number.isInteger(n) &&
                n >= CalendarConstants.MIN_WEEK &&
                n <= CalendarConstants.MAX_WEEK) {
                weekNum = n;
            }
        }

        if (weekNum === null) {
            return null;
        }

        var ACA = getAcademyCalendarAggregator();
        if (!ACA) {
            return null;
        }

        var isInstructor = mode === 'instructor';

        var options = {
            week: weekNum,
            classId: isNonEmptyString(classId) ? String(classId) : null
        };

        var vm = null;
        try {
            if (isInstructor) {
                if (typeof ACA.getInstructorScheduleViewModel !== 'function') {
                    return null;
                }
                vm = ACA.getInstructorScheduleViewModel(
                    charId, options
                );
            } else {
                if (typeof ACA.getStudentScheduleViewModel !== 'function') {
                    return null;
                }
                vm = ACA.getStudentScheduleViewModel(
                    charId, options
                );
            }
        } catch (e) {
            console.warn(
                '[AcademyCharacterDetailAggregator] ' +
                (isInstructor
                    ? 'getInstructorScheduleViewModel'
                    : 'getStudentScheduleViewModel') +
                ' failed:', e
            );
            return null;
        }

        if (!vm) {
            return null;
        }

        var disciplineHours = [];

        if (!isInstructor && isNonEmptyString(classId)) {
            disciplineHours = buildDisciplineHoursVM(
                charId,
                classId,
                weekNum,
                vm
            );
        }

        return {
            mode: mode,
            canEdit: !isInstructor,
            canEditInstructorSlot: isInstructor,

            schedule: vm.schedule || {},
            restDays: Array.isArray(vm.restDays) ? vm.restDays.slice() : [],

            entityName: isNonEmptyString(vm.entityName)
                ? vm.entityName
                : (isInstructor ? 'Instructor' : 'Student'),

            modeLabel: isNonEmptyString(vm.modeLabel)
                ? vm.modeLabel
                : (isInstructor
                    ? 'Instructor Schedule'
                    : 'Student Schedule'),

            hours: Array.isArray(vm.hours) ? vm.hours.slice() : [],

            disciplineHours: disciplineHours
        };
    }

    // ============================================================
    // DISCIPLINE HOURS VM
    // ============================================================

    function buildDisciplineHoursVM(charId, classId, week, gridVM) {
        var enrolledIds = [];
        try {
            enrolledIds = AcademyEnrolments.getStudentDisciplineIds(
                charId, classId
            ) || [];
        } catch (e) {
            enrolledIds = [];
        }

        if (!Array.isArray(enrolledIds) || enrolledIds.length === 0) {
            return [];
        }

        var studentSchedule = gridVM && gridVM.schedule
            ? gridVM.schedule
            : {};

        var result = [];

        for (var i = 0; i < enrolledIds.length; i++) {
            var disciplineId = String(enrolledIds[i]);
            if (!isNonEmptyString(disciplineId)) { continue; }

            var isActive = false;
            try {
                isActive = AcademyClassDisciplinesQueries
                    .isActiveInWeek(
                        classId, disciplineId, week
                    ) === true;
            } catch (e) {
                isActive = false;
            }

            if (!isActive) {
                continue;
            }

            var targetHours = getDisciplineWeeklyHours(disciplineId);
            var scheduledHours = countScheduledHoursForDiscipline(
                studentSchedule, disciplineId
            );
            var remainingHours = targetHours - scheduledHours;

            var currentGroup = buildCurrentGroupForDiscipline(
                charId,
                classId,
                disciplineId,
                week
            );

            // When the student is already in a group for this
            // discipline, the picker does NOT offer other groups.
            // It offers a "leave this group?" prompt.
            //
            // So `groups` stays empty in that case. The picker
            // reads `hasCurrentGroup` and renders the leave
            // affordance instead of the group list.
            var hasCurrentGroup = currentGroup !== null;

            var groups = [];
            if (!hasCurrentGroup) {
                groups = buildDisciplineGroupsForPicker(
                    charId,
                    classId,
                    disciplineId,
                    week,
                    studentSchedule
                );
            }

            result.push({
                disciplineId: disciplineId,
                disciplineName: getDisciplineName(disciplineId),
                disciplineType: getDisciplineType(disciplineId),
                targetHours: targetHours,
                scheduledHours: scheduledHours,
                remainingHours: remainingHours,
                isOver: remainingHours < 0,
                currentGroup: currentGroup,
                hasCurrentGroup: hasCurrentGroup,
                groups: groups
            });
        }

        result.sort(function(a, b) {
            return a.disciplineName.localeCompare(b.disciplineName);
        });

        return result;
    }

    function buildCurrentGroupForDiscipline(
        charId,
        classId,
        disciplineId,
        week
    ) {
        if (!isNonEmptyString(charId) ||
            !isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return null;
        }
        if (week === null) { return null; }

        var group = null;
        try {
            group = AcademyTeachingGroups.getGroupForStudentInClassDiscipline(
                classId,
                disciplineId,
                charId,
                week
            );
        } catch (e) {
            group = null;
        }
        if (!group || !group.id) { return null; }

        var memberIds = [];
        try {
            memberIds = AcademyTeachingGroups.getActiveMembers(
                group.id, week
            ) || [];
        } catch (e) {
            memberIds = [];
        }

        var targetChar = String(charId);
        var classmateCount = 0;
        for (var i = 0; i < memberIds.length; i++) {
            if (memberIds[i] === undefined || memberIds[i] === null) {
                continue;
            }
            if (String(memberIds[i]) === targetChar) { continue; }
            classmateCount++;
        }

        var instructorId = isNonEmptyString(group.instructorId)
            ? String(group.instructorId)
            : null;
        var instructorName = getCharacterDisplayName(instructorId);

        return {
            groupId: String(group.id),
            displayName: buildGroupDisplayName(group),
            instructorId: instructorId,
            instructorName: instructorName,
            classmateCount: classmateCount
        };
    }

    function countScheduledHoursForDiscipline(schedule, disciplineId) {
        if (!schedule || !isNonEmptyString(disciplineId)) { return 0; }

        var seen = Object.create(null);
        var total = 0;

        var dayKeys = Object.keys(schedule);
        for (var d = 0; d < dayKeys.length; d++) {
            var daySchedule = schedule[dayKeys[d]];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            var hourKeys = Object.keys(daySchedule);
            for (var h = 0; h < hourKeys.length; h++) {
                var slot = daySchedule[hourKeys[h]];
                if (!slot || typeof slot !== 'object') { continue; }
                if (slot.isContinuation) { continue; }
                if (String(slot.disciplineId) !== disciplineId) {
                    continue;
                }

                var key = slot.sessionId
                    ? 'sid:' + String(slot.sessionId)
                    : 'cell:' + dayKeys[d] + ':' + hourKeys[h];
                if (seen[key]) { continue; }
                seen[key] = true;

                var dur = isFiniteNumber(slot.duration)
                    ? slot.duration
                    : 1;
                total += dur;
            }
        }

        return total;
    }

    function buildDisciplineGroupsForPicker(
        charId,
        classId,
        disciplineId,
        week,
        studentSchedule
    ) {
        var allGroups = [];
        try {
            allGroups = AcademyTeachingGroups.getGroupsForDiscipline(
                classId, disciplineId
            ) || [];
        } catch (e) {
            allGroups = [];
        }

        if (!Array.isArray(allGroups) || allGroups.length === 0) {
            return [];
        }

        var result = [];

        for (var i = 0; i < allGroups.length; i++) {
            var group = allGroups[i];
            if (!group || !group.id) { continue; }

            // Any group the student is already a member of is
            // skipped. The caller decides whether to show the
            // "current group" prompt; the picker's job is only to
            // list alternative groups.
            var isMember = false;
            try {
                isMember = AcademyTeachingGroups.isMemberOfGroup(
                    group.id, charId, week
                ) === true;
            } catch (e) {
                isMember = false;
            }
            if (isMember) { continue; }

            var sessionVMs = buildTeachingGroupSessionsVM(group);

            var activeSessions = [];
            for (var s = 0; s < sessionVMs.length; s++) {
                var sv = sessionVMs[s];
                if (!sessionInWeek(sv, week)) { continue; }
                activeSessions.push(sv);
            }

            if (activeSessions.length === 0) {
                continue;
            }

            // Collect EVERY conflict across every active session.
            // Each conflict is deduped by groupId; two conflicts
            // against the same group are one entry.
            var conflictingGroups = [];
            var seenGroupIds = Object.create(null);

            for (var c = 0; c < activeSessions.length; c++) {
                var sessionConflicts = collectConflictsForSession(
                    activeSessions[c],
                    group,
                    studentSchedule
                );
                for (var cf = 0; cf < sessionConflicts.length; cf++) {
                    var conflict = sessionConflicts[cf];
                    var key = conflict.conflictingGroupId !== null
                        ? String(conflict.conflictingGroupId)
                        : ('sid:' + String(conflict.conflictingSessionId));
                    if (seenGroupIds[key]) { continue; }
                    seenGroupIds[key] = true;
                    conflictingGroups.push(conflict);
                }
            }

            var status = conflictingGroups.length > 0 ? 'red' : 'green';

            result.push({
                groupId: String(group.id),
                displayName: buildGroupDisplayName(group),
                memberCount: getActiveMemberCount(group.id, week),
                instructorName: getCharacterDisplayName(
                    group.instructorId
                ),
                sessions: activeSessions,
                status: status,
                conflictingGroups: conflictingGroups
            });
        }

        result.sort(function(a, b) {
            if (a.status !== b.status) {
                return a.status === 'green' ? -1 : 1;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        return result;
    }

    function sessionInWeek(sessionVM, week) {
        if (!sessionVM) { return false; }
        var s = sessionVM.startWeek;
        var e = sessionVM.endWeek;
        if (!isFiniteNumber(s)) { return false; }

        var RU = getRangeUtils();
        if (RU && typeof RU.containsWeek === 'function') {
            return RU.containsWeek(week, s, e) === true;
        }
        if (week < s) { return false; }
        if (e !== null && e !== undefined && week > e) { return false; }
        return true;
    }

    function getActiveMemberCount(groupId, week) {
        try {
            var ids = AcademyTeachingGroups.getActiveMembers(
                groupId, week
            );
            return Array.isArray(ids) ? ids.length : 0;
        } catch (e) {
            return 0;
        }
    }

    function getCharacterDisplayName(charId) {
        if (!isNonEmptyString(charId)) { return ''; }
        var c = CharacterQueries.getCharacterById(charId);
        if (!c) { return ''; }
        return CharacterQueries.getDisplayName(c);
    }

    function buildGroupDisplayName(group) {
        if (!group) { return 'Unnamed Group'; }
        var customName = isNonEmptyString(group.customName)
            ? String(group.customName).trim()
            : null;
        if (customName !== null) { return customName; }
        var disciplineName = getDisciplineName(group.disciplineId);
        var num = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;
        return disciplineName + (num > 0 ? ' ' + num : '');
    }

    // ============================================================
    // CONFLICT COLLECTION — PURE PER SESSION
    // ============================================================
    //
    // A candidate session S conflicts with the student's schedule
    // when any occupied cell in the student's schedule falls inside
    // S's [start, start + duration) window.
    //
    // "Occupied" means: a slot descriptor exists at that (day, hour),
    // whether it is a session START or a CONTINUATION.
    //
    // THE BUG THAT THIS FUNCTION FIXES:
    //   The previous implementation skipped any cell with
    //   `isContinuation: true`. Continuation cells are real
    //   occupied time — the second and subsequent hours of a
    //   multi-hour session. Skipping them meant a candidate whose
    //   session overlapped only the SECOND half of an existing
    //   session (e.g. 10:00-11:00 against a 9:00-11:00 existing
    //   session) reported as green, and only became visibly red
    //   after the assignment landed and the grid re-rendered.
    //
    // THE FIX:
    //   Do not skip continuation cells. Every occupied cell counts.
    //
    // THE REPORTING:
    //   When a conflict is found at hour H of the student's
    //   schedule and that cell is a continuation, walk backwards
    //   through the student's schedule until a non-continuation
    //   cell is found. That earlier cell is the session's START.
    //   The conflict is reported against the start (day, hour) —
    //   the hour a reader thinks of as "when the session is" —
    //   and carries the start cell's groupId / disciplineName.
    //
    // SELF-EXCLUSION:
    //   The candidate group is never the student's own group here,
    //   because buildDisciplineGroupsForPicker filters member
    //   groups out before calling this function. So a candidate
    //   cannot collide with itself, and no self-exclusion is
    //   needed.

    function collectConflictsForSession(sessionVM, group, studentSchedule) {
        if (!sessionVM) { return []; }

        var day = sessionVM.day;
        var startTime = sessionVM.startTime;
        var duration = isFiniteNumber(sessionVM.duration)
            ? sessionVM.duration
            : 1;

        if (!isFiniteNumber(day) || !isFiniteNumber(startTime)) {
            return [];
        }

        var daySchedule = studentSchedule[day];
        if (!daySchedule || typeof daySchedule !== 'object') {
            return [];
        }

        var groupId = String(group.id);
        var conflicts = [];
        var seenAtCell = Object.create(null);

        for (var h = 0; h < duration; h++) {
            var hour = startTime + h;
            var slot = daySchedule[hour];
            if (!slot || typeof slot !== 'object') { continue; }

            // A candidate group cannot be the student's own group
            // here (filtered upstream), so the cell we are looking
            // at belongs to some other group. Any occupied cell
            // counts as a conflict, continuation or not.
            //
            // Guard against double-reporting the same underlying
            // session across consecutive hours: the key is the
            // sessionId if present, else the groupId, else the
            // (day, hour) pair.
            var cellKey = slot.sessionId
                ? 'sid:' + String(slot.sessionId)
                : (slot.groupId
                    ? 'gid:' + String(slot.groupId)
                    : 'cell:' + day + ':' + hour);
            if (seenAtCell[cellKey]) { continue; }
            seenAtCell[cellKey] = true;

            // Find the session's START cell. Walk backwards while
            // the previous cell is a continuation.
            var startHour = hour;
            var startSlot = slot;
            var walk = hour - 1;
            while (walk >= 0) {
                var prev = daySchedule[walk];
                if (!prev || typeof prev !== 'object') { break; }
                if (!prev.isContinuation) { break; }
                // The continuation belongs to the same session.
                // Prefer session-id equality; fall back to
                // group-id equality when session ids are absent.
                var sameSession = false;
                if (slot.sessionId && prev.sessionId) {
                    sameSession =
                        String(slot.sessionId) ===
                        String(prev.sessionId);
                } else if (slot.groupId && prev.groupId) {
                    sameSession =
                        String(slot.groupId) ===
                        String(prev.groupId);
                }
                if (!sameSession) { break; }
                startHour = walk;
                startSlot = prev;
                walk--;
            }

            var conflictingGroupId = startSlot.groupId !== undefined &&
                                     startSlot.groupId !== null
                ? String(startSlot.groupId)
                : null;

            if (conflictingGroupId !== null &&
                conflictingGroupId === groupId) {
                // Defensive: a candidate group that somehow was not
                // filtered upstream should not report itself. This
                // branch is unreachable via the picker, but is
                // correct if the caller is ever different.
                continue;
            }

            conflicts.push({
                conflictingSessionId: startSlot.sessionId !== undefined &&
                                      startSlot.sessionId !== null
                    ? String(startSlot.sessionId)
                    : null,
                conflictingGroupId: conflictingGroupId,
                conflictingDisciplineId: startSlot.disciplineId !== undefined &&
                                         startSlot.disciplineId !== null
                    ? String(startSlot.disciplineId)
                    : null,
                conflictingDisciplineName:
                    startSlot.disciplineName || 'Unknown',
                conflictDay: day,
                conflictStartTime: startHour,
                conflictEndTime: startHour +
                    (isFiniteNumber(startSlot.duration)
                        ? startSlot.duration
                        : 1),
                // Where on the candidate session the collision was
                // first noticed. Kept for diagnostics; the UI
                // surfaces conflictStartTime (the existing session's
                // start), which is what the reader understands.
                detectedAtDay: day,
                detectedAtHour: hour,
                detectedSessionId: sessionVM.sessionId
            });
        }

        return conflicts;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetailAggregator = Object.freeze({
        getViewModel: getViewModel,
        getScheduleGridViewModel: getScheduleGridViewModel,
        getTeachingGroupCandidateViewModel: getTeachingGroupCandidateViewModel
    });

})();
