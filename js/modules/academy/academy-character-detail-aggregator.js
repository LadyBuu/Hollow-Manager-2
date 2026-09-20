/**
 * modules/academy/academy-character-detail-aggregator.js
 * Projection builder for the Academy character detail panel.
 *
 * Path: js/modules/academy/academy-character-detail-aggregator.js
 *
 * This module produces the view model consumed by AcademyCharacterDetail.
 * It is the single place where the character detail panel's domain reads
 * happen.
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
 * Domain reads composed here:
 *
 *   CharacterQueries              identity, display name, status, age, death
 *   AcademyClasses                class entity, character↔class membership
 *   AcademyClassDisciplinesQueries
 *                                 class-discipline marker reads (v27)
 *   AcademyEnrolments             student↔discipline enrolment (class-scoped)
 *   AcademyGrades                 grade records (class-scoped)
 *   AcademyDisciplines            discipline entities
 *   AcademyPerformance            academic average, overall score
 *   AcademySocialScore            social score
 *   AcademyTeachingGroups         teaching group entities + members
 *   TeamQueries                   persistent Team entities
 *   EliminationQueries            elimination week, reason, state
 *   CalendarConstants             week bounds for current-week resolution
 *   AcademyCalendarAggregator     schedule grid reads (projector-backed)
 *
 * TEACHING GROUPS (v29 + this slice):
 *   The instructor projection carries `teachingGroups` — the groups
 *   the instructor runs, grouped by discipline, scoped to the
 *   currently selected class. This replaces the retired
 *   `autoGroups` projection, which read `curriculum.autoGroups`.
 *
 *   An instructor's teaching groups are the teaching-group records
 *   whose instructorId equals the character and whose classId equals
 *   the selected class. The relationship is derived from
 *   AcademyTeachingGroups.getGroupsForInstructor and filtered to
 *   the selected class.
 *
 *   Groups are grouped by discipline. Every discipline the
 *   instructor has an instructor-mode enrolment for at the display
 *   week appears as a container, even when it has no groups yet.
 *   The container's `groups` array is empty in that case. This
 *   reflects the fact that the instructor has been assigned to
 *   teach the discipline for the class; staffing it with students
 *   is a separate step.
 *
 *   Sibling members from other active groups for the same
 *   (classId, disciplineId) are excluded from the candidate pool.
 *   A student belongs to at most one group per class-discipline at
 *   a time. This mirrors the resolver in
 *   AcademySchedule.assignStudentToSlot.
 *
 * INSTRUCTOR DISCIPLINES (v27):
 *   An instructor's "disciplines I teach" list is derived from
 *   enrolments. There is no instructor list on the discipline
 *   entity.
 *
 * SCHEDULE SOURCE (v21):
 *   buildScheduleGridViewModel reads from AcademyCalendarAggregator,
 *   which is projector-backed.
 *
 * VIEW MODEL SHAPE:
 *
 *   {
 *     character: { id, name, status, age, deceased },
 *     mode: 'student' | 'instructor',
 *     activeTab: string,
 *     tabs: [{ id, label }],
 *     classContext: null | { id, name },
 *     classes: [{ id, name }],
 *     elimination: null | { week, reason, state },
 *     performance: null | { week, academicAverage, socialScore, overallScore },
 *     student: null | {
 *       disciplines: [{ id, name, type }],
 *       grades: { average, count, hasAny },
 *       teams: [{ id, name, typeLabel }]
 *     },
 *     instructor: null | {
 *       disciplines: [{ id, name, type, classIds, classNames }],
 *       teachingGroups: [{
 *         disciplineId,
 *         disciplineName,
 *         groups: [{
 *           groupId,
 *           customName,
 *           groupNumber,
 *           displayName,
 *           memberCount,
 *           members: [{ id, name, status, age, deceased }]
 *         }]
 *       }]
 *     }
 *   }
 *
 * NULL SEMANTICS:
 *   - character is always present (aggregator returns null if not found).
 *   - instructor is null unless mode is 'instructor'.
 *   - instructor.teachingGroups is [] when the instructor has no
 *     enrolments for the selected class, or when no class is
 *     selected.
 *   - Display fields use '—' or null rather than invented values.
 *
 * WEEK SEMANTICS:
 *   - Week is required for class-scoped projections.
 *   - When week is invalid or absent, class-scoped sections return
 *     null or an empty collection rather than defaulting.
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
 *   - window.AcademyPerformance
 *   - window.AcademySocialScore
 *   - window.TeamQueries
 *   - window.EliminationQueries
 *   - window.AcademyCalendarAggregator
 *
 *   Optional dependencies degrade to null sections or empty
 *   collections, not fabricated data.
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
    // INSTRUCTOR PROJECTION (v27)
    // ============================================================
    //
    // An instructor's disciplines are DERIVED from enrolments.
    //
    // Walk:
    //   For each class the character is a member of:
    //     For each class-discipline marker:
    //       If the character has an enrolment in that discipline
    //       for that class, add (disciplineId, classId).
    //
    // Collect distinct disciplineIds. For each, capture the set of
    // classIds the instructor teaches it for.

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
    // INSTRUCTOR TEACHING GROUPS
    // ============================================================
    //
    // The groups the instructor runs for the selected class,
    // grouped by discipline. Every discipline the instructor has an
    // instructor-mode enrolment for appears as a container, even
    // when it has no groups yet.
    //
    // SCOPE:
    //   - Instructor: the character whose detail panel is open.
    //   - Class:      the currently selected class only. Groups
    //                 belonging to other classes the instructor
    //                 also teaches are not shown. The character
    //                 detail panel is class-scoped; every other tab
    //                 respects the selected class, and this one
    //                 does too.
    //   - Week:       the display week. Members and roster size are
    //                 resolved at the display week, not all-time.

    function buildInstructorTeachingGroups(char, classId, week) {
        if (!isNonEmptyString(classId) || week === null) {
            return [];
        }

        // Which disciplines does this instructor teach for this
        // class? Reuse the derived list, filtered to the selected
        // class.
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

        // Fetch this instructor's groups, then filter to the
        // selected class. getGroupsForInstructor returns every
        // group this character instructs across every class.
        var allGroups = [];
        try {
            allGroups = AcademyTeachingGroups.getGroupsForInstructor(
                char.id
            ) || [];
        } catch (e) {
            allGroups = [];
        }

        // Index by disciplineId for the container walk below.
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
            return String(a.name || '').localeCompare(String(b.name || ''));
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

        return {
            groupId: String(group.id),
            customName: customName,
            groupNumber: groupNumber,
            displayName: displayName,
            memberCount: members.length,
            members: members
        };
    }

    function buildInstructorProjection(char, classId, week) {
        return {
            disciplines: buildInstructorDisciplines(char),
            teachingGroups: buildInstructorTeachingGroups(
                char, classId, week
            )
        };
    }

    // ============================================================
    // TEACHING GROUP CANDIDATE VIEW MODEL
    // ============================================================
    //
    // The candidate pool for adding a student to a specific teaching
    // group. Called on demand by the controller when the user opens
    // the inline picker on a group row.
    //
    // The candidate set is:
    //   - students enrolled in (classId, disciplineId) at the week
    //   - MINUS students already active in THIS group at the week
    //   - MINUS students already active in any sibling group for
    //     the same (classId, disciplineId) at the week
    //   - MINUS students eliminated as of the week
    //
    // The strict exclusion of siblings mirrors the resolver in
    // AcademySchedule.assignStudentToSlot: a student belongs to at
    // most one active group per class-discipline at a time.
    //
    // Returns null when the group does not exist, or when the
    // character is not the group's instructor.
    //
    // @param {string} charId  the instructor
    // @param {string} groupId the group whose roster will grow
    // @param {object} options { week }
    // @returns {object|null} {
    //   groupId, groupDisplayName, disciplineId, disciplineName,
    //   candidates: [{ id, name, status, age, deceased }]
    // }

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

        // The caller asks for candidates for a group they instruct.
        // A caller asking for candidates for a group they don't
        // instruct is a mistake.
        if (String(group.instructorId) !== String(charId)) {
            return null;
        }

        var classId = String(group.classId);
        var disciplineId = String(group.disciplineId);

        // 1. Enrolled students for the class-discipline at the week.
        var enrolledIds = [];
        try {
            enrolledIds = AcademyEnrolments.getEnrolledStudents(
                classId, disciplineId, week
            ) || [];
        } catch (e) {
            enrolledIds = [];
        }

        // 2. Exclude students already active in this group.
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

        // 3. Exclude students active in any sibling group for the
        // same (classId, disciplineId).
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

        // 4. Build the candidate list.
        var EQ = getEliminationQueries();

        var candidates = [];
        for (var e = 0; e < enrolledIds.length; e++) {
            var candidateId = enrolledIds[e];
            if (!isNonEmptyString(candidateId)) { continue; }

            var key = String(candidateId);
            if (excluded[key]) { continue; }

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

            var c = CharacterQueries.getCharacterById(candidateId);
            if (!c) { continue; }

            candidates.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true
            });
        }

        candidates.sort(function(a, b) {
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
            candidates: candidates
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
    // The controller supplies { week, mode }. The aggregator does
    // NOT read AcademyUI for the mode; it is a pure function of its
    // inputs.
    //
    // The public wrapper normalises the two API shapes:
    //
    //   getScheduleGridViewModel(charId, 5)                    [legacy]
    //   getScheduleGridViewModel(charId, { week: 5 })          [legacy]
    //   getScheduleGridViewModel(charId, { week: 5,
    //                                      mode: 'student' }) [preferred]

    var VALID_SCHEDULE_MODES = ['student', 'instructor'];

    function getScheduleGridViewModel(charId, options) {
        var week = null;
        var mode = 'student';

        if (options !== undefined && options !== null) {
            if (typeof options === 'object') {
                week = options.week;

                if (options.mode !== undefined) {
                    mode = options.mode;
                }
            } else {
                week = options;
            }
        }

        return buildScheduleGridViewModel(charId, week, mode);
    }

    function buildScheduleGridViewModel(charId, week, mode) {
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

        var vm = null;
        try {
            if (isInstructor) {
                if (typeof ACA.getInstructorScheduleViewModel !== 'function') {
                    return null;
                }
                vm = ACA.getInstructorScheduleViewModel(charId, weekNum);
            } else {
                if (typeof ACA.getStudentScheduleViewModel !== 'function') {
                    return null;
                }
                vm = ACA.getStudentScheduleViewModel(charId, weekNum);
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

        return {
            mode: mode,
            canEdit: !isInstructor,

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

            hours: Array.isArray(vm.hours) ? vm.hours.slice() : []
        };
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