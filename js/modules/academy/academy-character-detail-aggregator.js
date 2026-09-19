/**
 * modules/academy/academy-character-detail-aggregator.js
 * Projection builder for the Academy character detail panel.
 *
 * Path: js/modules/academy/academy-character-detail-aggregator.js
 *
 * This module produces the view model consumed by AcademyCharacterDetail.
 * It is the single place where the character detail panel's domain reads
 * happen. The renderer receives one object and returns HTML. It does not
 * query any domain module, does not read window.data, and does not touch
 * the DOM.
 *
 * ARCHITECTURE:
 *
 *     AcademyView / controller
 *         ↓
 *     AcademyCharacterDetailAggregator.getViewModel(charId, options)
 *         ↓
 *     Character Detail VM
 *         ↓
 *     AcademyCharacterDetail.renderHTML(vm)
 *         ↓
 *     HTML
 *
 *     AcademyView / controller
 *         ↓
 *     AcademyCharacterDetailAggregator.getScheduleGridViewModel(charId, week)
 *         ↓
 *     Schedule grid VM
 *         ↓
 *     CalendarRenderer.renderGrid(state, vm)
 *         ↓
 *     HTML
 *
 * The aggregator composes the following domain reads:
 *
 *   CharacterQueries          identity, display name, status, age, death
 *   AcademyClasses            class entity, character↔class membership
 *   AcademyClassDisciplines   class-discipline markers (v27)
 *   AcademyEnrolments         student↔discipline enrolment (class-scoped)
 *   AcademyGrades             grade records (class-scoped)
 *   AcademyDisciplines        discipline entities
 *   AcademyPerformance        academic average, overall score
 *   AcademySocialScore        social score
 *   AcademyGroups             auto-group reads (delegates to AcademyAutoGroupsRead)
 *   TeamQueries               persistent Team entities
 *   EliminationQueries        elimination week, reason, state
 *   CalendarConstants         week bounds for current-week resolution
 *   AcademyCalendarAggregator schedule grid reads (projector-backed)
 *
 * INSTRUCTOR DISCIPLINES (v27):
 *   Before v27, an instructor's "disciplines I teach" list was read
 *   from `discipline.instructorIds` — a global list on each
 *   discipline. That field was retired. The relationship it
 *   expressed is class-scoped: an instructor teaches a discipline
 *   FOR A CLASS.
 *
 *   The class-scoped relationship is expressed through enrolments.
 *   An enrolment record at academy.enrolments[classId][charId]
 *   carries { disciplineId, startWeek, endWeek }. When the charId
 *   belongs to an instructor, that enrolment means "this instructor
 *   teaches this discipline for this class."
 *
 *   buildInstructorDisciplines performs the derived read: it walks
 *   the class-discipline markers, checks each for an enrolment of
 *   the given character in that discipline, and produces a
 *   deduplicated list of disciplines with the classes they're taught
 *   in. The list is presented by discipline, not by (discipline,
 *   class) pair, so an instructor teaching the same discipline for
 *   two classes sees it once.
 *
 * SCHEDULE SOURCE (v21):
 *   buildScheduleGridViewModel reads from AcademyCalendarAggregator,
 *   which is projector-backed. The retired stored-schedule map
 *   (curriculum.schedules) is no longer consulted. The AcademySchedule
 *   calendar-provider bridge has been retired.
 *
 * VIEW MODEL SHAPE:
 *
 *   {
 *     character: {
 *       id, name, status, age, deceased
 *     },
 *
 *     mode: 'student' | 'instructor',
 *     activeTab: string,
 *     tabs: [{ id, label }],
 *
 *     classContext: null | { id, name },
 *     classes: [{ id, name }],
 *
 *     elimination: null | {
 *       week,
 *       reason,
 *       state: 'current' | 'past'
 *     },
 *
 *     performance: null | {
 *       week,
 *       academicAverage,
 *       socialScore,
 *       overallScore
 *     },
 *
 *     student: null | {
 *       disciplines: [{ id, name, type }],
 *       grades: {
 *         average,
 *         count,
 *         hasAny
 *       },
 *       teams: [{ id, name, typeLabel }]
 *     },
 *
 *     instructor: null | {
 *       disciplines: [{ id, name, type, classIds, classNames }],
 *       autoGroups: [{
 *         key,
 *         disciplineId,
 *         disciplineName,
 *         studentCount,
 *         students: [{ id, name, status }]
 *       }]
 *     }
 *   }
 *
 *   Each instructor discipline entry now carries `classIds` and
 *   `classNames` — the classes the instructor teaches the discipline
 *   for. The renderer is free to display them or ignore them; the
 *   VM includes them because the data is already resolved at this
 *   layer.
 *
 * SCHEDULE GRID VIEW MODEL SHAPE:
 *
 *   {
 *     schedule: { day: { hour: disciplineId } },
 *     restDays: [number],
 *     entityName: string,
 *     modeLabel: string,
 *     hours: [number]
 *   }
 *
 *   This shape matches what CalendarRenderer.renderGrid expects. The
 *   Academy view mounts the grid into the character detail panel's
 *   Schedule tab. The renderer treats the grid as read-only; the
 *   Calendar tab owns edits.
 *
 * NULL SEMANTICS:
 *   - character is always present (aggregator returns null if not found).
 *   - performance is null when there is no class context or no data.
 *   - student is null unless mode is 'student' AND a class is selected.
 *   - instructor is null unless mode is 'instructor'.
 *   - elimination is null when there is no elimination record.
 *   - classContext is null when no class is selected.
 *   - schedule grid returns null when the week is invalid or the
 *     calendar aggregator is unavailable.
 *   - Display fields use '—' or null rather than invented numeric values.
 *
 * MODE SEMANTICS:
 *   - The mode is read by the caller from AcademyUI.getCharacterMode,
 *     which reads the character record. Both student and instructor
 *     projections are NOT computed unless the mode selects them.
 *     This avoids unnecessary cross-domain reads when the user is
 *     only viewing one side.
 *
 * WEEK SEMANTICS:
 *   - Week is required for class-scoped projections (grades, performance,
 *     schedule grid).
 *   - When week is invalid or absent, class-scoped sections return null
 *     or an empty grid rather than defaulting.
 *
 * ELIMINATION STATE:
 *   - 'current' when the displayed week equals the elimination week.
 *   - 'past' when the displayed week is after the elimination week.
 *   - null when the character is not eliminated by the displayed week.
 *
 * DEPENDENCIES (mandatory):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyClassDisciplines
 *   - window.AcademyDisciplines
 *   - window.AcademyEnrolments
 *   - window.AcademyGrades
 *   - window.CalendarConstants
 *
 * DEPENDENCIES (optional, feature-scoped):
 *   - window.AcademyPerformance          (academic average, overall score)
 *   - window.AcademySocialScore          (social score)
 *   - window.AcademyGroups               (instructor auto-groups)
 *   - window.TeamQueries                 (student teams)
 *   - window.EliminationQueries          (elimination state)
 *   - window.AcademyCalendarAggregator   (schedule grid reads)
 *
 *   Optional dependencies degrade to null sections or empty grids, not
 *   fabricated data. When a section's domain module is absent, the
 *   aggregator reports the section as null. The renderer displays an
 *   explicit "not available" state, which is truthful.
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
    var AcademyClassDisciplines = window.AcademyClassDisciplines;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyGrades = window.AcademyGrades;
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

    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.getClassDisciplinesForClass !== 'function') {
        missing.push('AcademyClassDisciplines.getClassDisciplinesForClass');
    }

    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        missing.push('AcademyDisciplines.getDiscipline');
    }

    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
        missing.push('AcademyEnrolments.getStudentDisciplines');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.isEnrolled !== 'function') {
        missing.push('AcademyEnrolments.isEnrolled');
    }

    if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
        missing.push('AcademyGrades.getStudentClassGrades');
    }
    if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
        missing.push('AcademyGrades.calculateSummary');
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
    function getAcademyGroups() { return window.AcademyGroups || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }

    // v21: schedule reads go through the projector-backed aggregator.
    // The old AcademySchedule calendar-provider bridge is retired.
    function getAcademyCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
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

    /**
     * Resolve the effective week.
     *
     * PRECEDENCE:
     *   1. options.week if it's a valid integer in [MIN_WEEK, MAX_WEEK]
     *   2. null otherwise
     *
     * No fallback to window.data.currentWeek. No fallback to MIN_WEEK.
     * The caller (AcademyView) is expected to pass AcademyUI.getDisplayWeek()
     * which already canonicalizes to a valid week. When the caller passes
     * nothing valid, we return null and the caller decides what to render.
     */
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

    /**
     * Resolve the effective mode.
     *
     * The mode is provided by the caller (the controller reads it from
     * AcademyUI.getCharacterMode, which reads the character record).
     * It is either 'student' or 'instructor'. Anything else falls back
     * to 'student'.
     */
    function resolveMode(options) {
        if (options && options.mode === 'instructor') {
            return 'instructor';
        }
        return 'student';
    }

    /**
     * Resolve the active tab for the mode.
     *
     * If the requested tab is not valid for the mode, fall back to 'main'.
     * This mirrors the renderer's own validation but keeps the VM
     * self-consistent.
     */
    function resolveActiveTab(options, mode) {
        var requested = options && options.tab ? String(options.tab) : 'main';

        var STUDENT_TABS = ['main', 'disciplines', 'grades', 'schedule', 'teams'];
        var INSTRUCTOR_TABS = ['main', 'disciplines', 'schedule', 'autoGroups'];
        var valid = mode === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;

        return valid.indexOf(requested) !== -1 ? requested : 'main';
    }

    function getTabsForMode(mode) {
        if (mode === 'instructor') {
            return [
                { id: 'main',        label: 'Main' },
                { id: 'disciplines', label: 'Disciplines' },
                { id: 'schedule',    label: 'Schedule' },
                { id: 'autoGroups',  label: 'Auto-Groups' }
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

        // Not yet eliminated by the displayed week: no banner.
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
                // Leave null
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
                // Leave null
            }
        }

        if (typeof AP.calculateOverallScore === 'function') {
            try {
                var o = AP.calculateOverallScore(char.id, classId, week);
                if (isFiniteNumber(o)) {
                    overall = o;
                }
            } catch (e) {
                // Leave null
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
            ids = AcademyEnrolments.getStudentDisciplines(char.id, classId) || [];
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
    // INSTRUCTOR PROJECTION (v27)
    // ============================================================
    //
    // An instructor's disciplines are DERIVED from enrolments. There
    // is no instructor list on the discipline entity anymore.
    //
    // Walk:
    //   For each class the character is a member of:
    //     For each class-discipline marker:
    //       If the character has an enrolment in that discipline
    //       for that class, add (disciplineId, classId).
    //
    // Collect distinct disciplineIds. For each, capture the set of
    // classIds the instructor teaches it for. The result is a list
    // of disciplines, each with the classes it's taught in.
    //
    // The instructor's member-of-class check is done via
    // AcademyClasses.getCharacterClasses(char), which reads
    // character.classIds. There is no separate "which classes does
    // this instructor belong to" store; membership is classIds.

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
                markers = AcademyClassDisciplines
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

    function buildInstructorAutoGroups(char) {
        var AG = getAcademyGroups();
        if (!AG || typeof AG.getGroupsByInstructor !== 'function') {
            return null;
        }

        var groupsMap = {};
        try {
            groupsMap = AG.getGroupsByInstructor(char.id) || {};
        } catch (e) {
            groupsMap = {};
        }

        var result = [];
        var keys = Object.keys(groupsMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var group = groupsMap[key];
            if (!group) { continue; }

            var students = [];
            if (Array.isArray(group.students)) {
                for (var j = 0; j < group.students.length; j++) {
                    var sid = group.students[j];
                    if (!isNonEmptyString(sid)) { continue; }
                    var s = CharacterQueries.getCharacterById(sid);
                    if (!s) {
                        students.push({
                            id: sid,
                            name: 'Unknown',
                            status: ''
                        });
                        continue;
                    }
                    students.push({
                        id: s.id,
                        name: CharacterQueries.getDisplayName(s),
                        status: CharacterQueries.getCurrentStatus(s)
                    });
                }
            }

            students.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            result.push({
                key: key,
                disciplineId: isNonEmptyString(group.disciplineId) ? group.disciplineId : '',
                disciplineName: getDisciplineName(group.disciplineId),
                studentCount: students.length,
                students: students
            });
        }

        result.sort(function(a, b) {
            return a.disciplineName.localeCompare(b.disciplineName);
        });

        return result;
    }

    function buildInstructorProjection(char) {
        return {
            disciplines: buildInstructorDisciplines(char),
            autoGroups: buildInstructorAutoGroups(char)
        };
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    /**
     * Build the complete view model for the character detail panel.
     *
     * @param {string} charId
     * @param {object} [options]
     * @param {string} [options.classId]  - Currently selected class, or null
     * @param {number} [options.week]     - Currently displayed week
     * @param {string} [options.mode]     - 'student' | 'instructor'
     * @param {string} [options.tab]      - Active tab id
     * @returns {object|null}
     */
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

        // Only the projection for the current mode is built. The other
        // side stays null to avoid unnecessary cross-domain reads.
        var student = mode === 'student'
            ? buildStudentProjection(char, classId, week)
            : null;

        var instructor = mode === 'instructor'
            ? buildInstructorProjection(char)
            : null;

        return {
            character: characterHeader,

            mode: mode,
            activeTab: activeTab,
            tabs: getTabsForMode(mode),

            classContext: classContext,
            classes: classes,

            elimination: elimination,
            performance: performance,

            student: student,
            instructor: instructor
        };
    }

    // ============================================================
    // SCHEDULE GRID VIEW MODEL
    // ============================================================
    //
    // Produces a VM shaped for CalendarRenderer.renderGrid. The Academy
    // view mounts the grid read-only into the character detail panel's
    // Schedule tab.
    //
    // v21 SOURCE:
    //   AcademyCalendarAggregator.getStudentScheduleViewModel(charId, week)
    //   which reads the teaching projector. The old AcademySchedule
    //   calendar-provider bridge is retired.
    //
    // NULL SEMANTICS:
    //   Returns null when the week is invalid or the calendar aggregator
    //   is unavailable. Returns an empty-grid VM (schedule: {}) when the
    //   student has no scheduled classes for the week — the renderer
    //   displays that as an empty week, which is truthful.

    /**
     * Build the schedule grid VM for a (charId, week) pair.
     *
     * @param {string} charId
     * @param {number|string} week
     * @returns {object|null}
     */
    function buildScheduleGridViewModel(charId, week) {
        if (!isNonEmptyString(charId)) {
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
        if (!ACA || typeof ACA.getStudentScheduleViewModel !== 'function') {
            return null;
        }

        var vm;
        try {
            vm = ACA.getStudentScheduleViewModel(charId, weekNum);
        } catch (e) {
            console.warn(
                '[AcademyCharacterDetailAggregator] ' +
                'getStudentScheduleViewModel failed:', e
            );
            return null;
        }

        if (!vm) {
            return null;
        }

        return {
            schedule: vm.schedule || {},
            restDays: Array.isArray(vm.restDays) ? vm.restDays.slice() : [],
            entityName: isNonEmptyString(vm.entityName)
                ? vm.entityName
                : 'Character',
            modeLabel: isNonEmptyString(vm.modeLabel)
                ? vm.modeLabel
                : 'Student Schedule',
            hours: Array.isArray(vm.hours) ? vm.hours.slice() : []
        };
    }

    /**
     * Convenience wrapper: build the schedule grid VM for a (charId, week)
     * pair with a single options object. Matches the argument shape
     * used by getViewModel.
     *
     * @param {string} charId
     * @param {object} [options]
     * @param {number} [options.week]
     * @returns {object|null}
     */
    function getScheduleGridViewModel(charId, options) {
        // Support both `getScheduleGridViewModel(charId, week)` and
        // `getScheduleGridViewModel(charId, { week })` for caller
        // convenience. The Academy view uses the object form.
        var week = null;
        if (options !== undefined && options !== null) {
            if (typeof options === 'object') {
                week = options.week;
            } else {
                week = options;
            }
        }
        return buildScheduleGridViewModel(charId, week);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetailAggregator = Object.freeze({
        getViewModel: getViewModel,
        getScheduleGridViewModel: getScheduleGridViewModel
    });

})();