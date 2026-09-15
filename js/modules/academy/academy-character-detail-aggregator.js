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
 *   AcademyEnrolments         student↔discipline enrolment (class-scoped)
 *   AcademyGrades             grade records (class-scoped)
 *   AcademyDisciplines        discipline entities
 *   AcademyPerformance        academic average, overall score
 *   AcademySocialScore        social score
 *   AcademyGroups             auto-group reads (delegates to AcademyAutoGroupsRead)
 *   TeamQueries               persistent Team entities
 *   EliminationQueries        elimination week, reason, state
 *   CalendarConstants         week bounds for current-week resolution
 *   AcademySchedule           week-scoped schedule reads (student classes,
 *                             rest days)
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
 *       disciplines: [{ id, name, type }],
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
 *   - schedule grid returns null when CalendarConstants is absent
 *     (week bounds are required to build the grid).
 *   - Display fields use '—' or null rather than invented numeric values.
 *
 * MODE SEMANTICS:
 *   - The mode is a display toggle from the caller (AcademyUI state).
 *   - Both student and instructor projections are NOT computed unless
 *     the mode selects them. This avoids unnecessary cross-domain reads
 *     when the user is only viewing one side.
 *
 * WEEK SEMANTICS:
 *   - Week is required for class-scoped projections (grades, performance,
 *     schedule grid).
 *   - When week is invalid or absent, class-scoped sections return null
 *     or an empty grid rather than defaulting. The renderer displays an
 *     empty state.
 *
 * ELIMINATION STATE:
 *   - 'current' when the displayed week equals the elimination week.
 *   - 'past' when the displayed week is after the elimination week.
 *   - null when the character is not eliminated by the displayed week.
 *
 * DEPENDENCIES (mandatory):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.AcademyGrades
 *   - window.CalendarConstants
 *
 * DEPENDENCIES (optional, feature-scoped):
 *   - window.AcademyEnrolments     (student disciplines)
 *   - window.AcademyPerformance    (academic average, overall score)
 *   - window.AcademySocialScore    (social score)
 *   - window.AcademyGroups         (instructor auto-groups)
 *   - window.TeamQueries           (student teams)
 *   - window.EliminationQueries    (elimination state)
 *   - window.AcademySchedule       (schedule grid reads)
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
    var AcademyDisciplines = window.AcademyDisciplines;
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

    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDisciplinesByInstructor !== 'function') {
        missing.push('AcademyDisciplines.getDisciplinesByInstructor');
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

    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademyPerformance() { return window.AcademyPerformance || null; }
    function getAcademySocialScore() { return window.AcademySocialScore || null; }
    function getAcademyGroups() { return window.AcademyGroups || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }
    function getAcademySchedule() { return window.AcademySchedule || null; }

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
     * The mode is a UI toggle. It is either 'student' or 'instructor'.
     * Anything else falls back to 'student'.
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
        var AE = getAcademyEnrolments();
        if (!AE || typeof AE.getStudentDisciplines !== 'function') {
            return null;
        }

        var ids = [];
        try {
            ids = AE.getStudentDisciplines(char.id, classId) || [];
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
    // INSTRUCTOR PROJECTION
    // ============================================================

    function buildInstructorDisciplines(char) {
        var list = AcademyDisciplines.getDisciplinesByInstructor(char.id) || [];
        var result = [];
        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            if (!d || !d.id) { continue; }
            result.push({
                id: d.id,
                name: isNonEmptyString(d.name) ? d.name : 'Unnamed Discipline',
                type: isNonEmptyString(d.type) ? d.type : ''
            });
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
    // SOURCES:
    //   - AcademySchedule.getStudentSchedule(charId, week)
    //     → { day: { hour: disciplineId } }
    //   - AcademySchedule.getStudentRestDays(charId, week)
    //     → [day, ...]
    //   - AcademySchedule.getStudentClasses(charId, week)
    //     → flattened array with disciplineName/instructorName already
    //       resolved, used to enrich each slot with display fields
    //
    // The raw schedule shape is what CalendarRenderer expects for
    // `slotData` per cell — it reads `slotData.disciplineName`,
    // `slotData.label`, `slotData.duration`, `slotData.instructorName`,
    // `slotData.groupLabel`. So we build a "flat schedule" object where
    // each occupied cell is a slot descriptor, not a bare discipline id.
    //
    // NULL SEMANTICS:
    //   Returns null when AcademySchedule is absent or the week is
    //   invalid. Returns an empty-grid VM (schedule: {}) when the
    //   student has no scheduled classes for the week — the renderer
    //   displays that as an empty week, which is truthful.

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

        var AS = getAcademySchedule();
        if (!AS || typeof AS.getStudentClasses !== 'function') {
            return null;
        }

        var char = CharacterQueries.getCharacterById(charId);
        var entityName = char ? CharacterQueries.getDisplayName(char) : 'Character';

        // Read rest days. AcademySchedule.getStudentRestDays returns
        // an array of day numbers. If the module doesn't expose it,
        // we degrade to [].
        var restDays = [];
        if (typeof AS.getStudentRestDays === 'function') {
            try {
                restDays = AS.getStudentRestDays(charId, weekNum) || [];
            } catch (e) {
                restDays = [];
            }
        }

        // getStudentClasses returns per-hour entries with display
        // fields already resolved. We pivot them into the flat
        // schedule shape CalendarRenderer expects.
        var classEntries = [];
        try {
            classEntries = AS.getStudentClasses(charId, weekNum) || [];
        } catch (e) {
            classEntries = [];
        }

        var schedule = {};

        for (var i = 0; i < classEntries.length; i++) {
            var entry = classEntries[i];
            if (!entry || entry.day === undefined || entry.hour === undefined) {
                continue;
            }

            var day = entry.day;
            var hour = entry.hour;

            if (!schedule[day]) {
                schedule[day] = {};
            }

            schedule[day][hour] = {
                disciplineId: entry.disciplineId || null,
                disciplineName: entry.disciplineName || 'Unknown',
                duration: isFiniteNumber(entry.duration) ? entry.duration : 1,
                label: isNonEmptyString(entry.label) ? entry.label : '',
                groupLabel: isNonEmptyString(entry.groupLabel) ? entry.groupLabel : '',
                instructorId: entry.instructorId || null,
                instructorName: isNonEmptyString(entry.instructorName)
                    ? entry.instructorName
                    : '',
                isContinuation: entry.isContinuation === true
            };
        }

        // Available hours: the calendar's canonical range. The renderer
        // uses this to decide which rows to draw.
        var hours = [];
        var startH = (typeof CalendarConstants.CALENDAR_START_HOUR === 'number')
            ? CalendarConstants.CALENDAR_START_HOUR
            : 5;
        var endH = (typeof CalendarConstants.CALENDAR_END_HOUR === 'number')
            ? CalendarConstants.CALENDAR_END_HOUR
            : 23;
        for (var h = startH; h <= endH; h++) {
            hours.push(h);
        }

        return {
            schedule: schedule,
            restDays: Array.isArray(restDays) ? restDays.slice() : [],
            entityName: entityName,
            modeLabel: 'Student Schedule',
            hours: hours
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

    window.AcademyCharacterDetailAggregator = {
        getViewModel: getViewModel,
        getScheduleGridViewModel: getScheduleGridViewModel
    };

})();
