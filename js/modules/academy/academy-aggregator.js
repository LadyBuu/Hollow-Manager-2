/**
 * modules/academy/academy-aggregator.js - Academy Aggregator
 * Cross-domain projection builder for the Academy domain.
 *
 * Path: js/modules/academy/academy-aggregator.js
 *
 * PROJECTIONS:
 *   Classes:
 *     getClassListViewModel()
 *     getClassViewModel(classId)
 *     getClassStudentsViewModel(classId)
 *
 *   People:
 *     getPeopleViewModel(classId, options)
 *
 *   Characters:
 *     getStudentViewModel(studentId, options)
 *     getInstructorViewModel(instructorId, options)
 *
 *   Disciplines:
 *     getDisciplineListViewModel(filters)
 *     getDisciplineEditorViewModel(options)
 *     getInstructorNamesForDiscipline(discipline)
 *
 *   Rankings:
 *     getRankingViewModel(classId, week)
 *
 *   Locations:
 *     getLocationViewModel(filters, week, selectedLocationId)
 *
 *   Weekly Teams:
 *     getWeeklyTeamsViewModel(classId, week, selectedTeamId)
 *
 * IMPORTANT:
 *   - Projection builder. Never mutates. No UI dependencies.
 *   - Composes domain modules. Never walks raw storage.
 *   - No fallback values for missing domain data. When a source is
 *     absent, the projection returns null or an empty collection.
 *     Never invents a default (no `week || 1`, no `totalRounds || 1`).
 *   - The class VM is deliberately small (header fields only).
 *     Rosters, teams, and rankings live in their own projections.
 *
 * ROLE VOCABULARY:
 *   Canonical role values are 'student' and 'instructor'. There is no
 *   'trainee' anywhere in this module.
 *
 * DEPENDENCIES:
 *   - AcademyClasses       (class entities)
 *   - AcademyDisciplines   (discipline entities)
 *   - CharacterQueries     (character identity)
 *   - TeamQueries          (persistent Team entities)
 *   - TeamConstants        (team type/period labels)
 *
 *   - TeamAggregator       (period-display strings; lazy)
 *   - AcademyWeeklyTeams   (week-scoped assignments; lazy)
 *   - AcademyRanking       (ranking projection; lazy)
 *   - CalendarAggregator   (schedule projections; lazy)
 *   - AcademyEnrolments    (enrolment read for discipline editor VM; lazy)
 *   - AcademyGrades        (grade read for discipline editor VM; lazy)
 */

(function() {
    'use strict';

    if (window.__academyAggregatorLoaded) {
        return;
    }
    window.__academyAggregatorLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;

    // ============================================================
    // MANDATORY DEPENDENCY CHECK
    // ============================================================

    var _missing = [];

    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClasses !== 'function') {
        _missing.push('AcademyClasses.getClasses');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDisciplines !== 'function') {
        _missing.push('AcademyDisciplines.getDisciplines');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
        _missing.push('CharacterQueries.getCurrentStatus');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
        _missing.push('TeamQueries.getTeamsByClass');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
        _missing.push('TeamQueries.getTeamName');
    }
    if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamConstants) {
        _missing.push('TeamConstants');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // LAZY OPTIONAL DEPENDENCIES
    // ============================================================

    function getTeamAggregator() {
        return window.TeamAggregator || null;
    }

    function getAcademyWeeklyTeams() {
        return window.AcademyWeeklyTeams || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getCalendarAggregator() {
        return window.CalendarAggregator || null;
    }

    function getAcademyEnrolments() {
        return window.AcademyEnrolments || null;
    }

    function getAcademyGrades() {
        return window.AcademyGrades || null;
    }

    function getGradeSchemes() {
        return window.AcademyGradeSchemes || null;
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

    function getCharacterDisplayName(charId) {
        if (!charId) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char);
    }

    function getTeamTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getTeamPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
    }

    function getTeamPeriodDisplay(team) {
        var TA = getTeamAggregator();
        if (TA && typeof TA.getTeamPeriodDisplay === 'function') {
            return TA.getTeamPeriodDisplay(team);
        }
        return '-';
    }

    // ============================================================
    // CLASS LIST
    // ============================================================

    function getClassListViewModel() {
        var classes = AcademyClasses.getClasses() || [];
        classes = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return classes.map(function(c) {
            return {
                id: c.id,
                name: c.name || 'Unnamed Class',
                status: c.status || 'active',
                year: c.year || null
            };
        });
    }

    // ============================================================
    // CLASS STUDENTS
    // ============================================================
    //
    // Roster derivation: characters whose classIds include classId.
    // The class INSTRUCTOR is excluded by design.

    function getClassStudentsViewModel(classId) {
        if (!classId) { return []; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return []; }

        var all = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var instructorId = cls.instructorId ? String(cls.instructorId) : null;
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var c = all[i];
            if (!c || !c.id) { continue; }

            if (instructorId && String(c.id) === instructorId) {
                continue;
            }

            var classIds = Array.isArray(c.classIds) ? c.classIds : [];
            var found = false;
            for (var j = 0; j < classIds.length; j++) {
                if (String(classIds[j]) === target) {
                    found = true;
                    break;
                }
            }
            if (!found) { continue; }

            result.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true,
                role: 'student'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // CLASS VIEW MODEL
    // ============================================================
    //
    // Deliberately small. Header fields only. Rosters, teams, and
    // rankings are separate projections.

    function getClassViewModel(classId) {
        if (!classId) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        return {
            id: cls.id,
            name: cls.name || 'Unnamed Class',
            status: cls.status || 'active',
            year: cls.year || null,
            description: cls.description || '',
            instructorId: cls.instructorId || null,
            instructorName: cls.instructorId
                ? getCharacterDisplayName(cls.instructorId)
                : 'Not assigned',
            createdAt: cls.createdAt || ''
        };
    }

    // ============================================================
    // PEOPLE VIEW MODEL
    // ============================================================
    //
    // Composes the class roster and applies People filters.
    //
    // The People layout uses the class VM's roster (students +
    // instructor) and filters it by search, role, and status.
    //
    // ROLE VOCABULARY: 'student' | 'instructor'.

    function getPeopleViewModel(classId, options) {
        options = options || {};

        var filters = options.filters && typeof options.filters === 'object'
            ? options.filters
            : { search: '', role: 'all', status: 'active' };

        var selectedCharacterId = isNonEmptyString(options.selectedCharacterId)
            ? String(options.selectedCharacterId)
            : null;

        var classList = getClassListViewModel();

        var selectedClass = null;
        if (isNonEmptyString(classId)) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classList,
                classId: null,
                className: null,
                filters: filters,
                people: [],
                totalCount: 0,
                filteredCount: 0
            };
        }

        // Build the roster: students from classIds, then instructor
        // stitched in for display.
        var students = getClassStudentsViewModel(selectedClass.id);

        var cls = AcademyClasses.getClass(selectedClass.id);
        if (cls && cls.instructorId) {
            var alreadyPresent = false;
            for (var s = 0; s < students.length; s++) {
                if (String(students[s].id) === String(cls.instructorId)) {
                    alreadyPresent = true;
                    break;
                }
            }
            if (!alreadyPresent) {
                var instructorChar = CharacterQueries.getCharacterById(cls.instructorId);
                if (instructorChar) {
                    students = students.concat([{
                        id: instructorChar.id,
                        name: CharacterQueries.getDisplayName(instructorChar),
                        status: CharacterQueries.getCurrentStatus(instructorChar),
                        age: CharacterQueries.getCharacterAge(instructorChar),
                        deceased: instructorChar.deceased === true,
                        role: 'instructor'
                    }]);
                }
            }
        }

        var search = (filters.search || '').toLowerCase().trim();
        var roleFilter = filters.role || 'all';
        var statusFilter = filters.status || 'active';

        var filtered = students.filter(function(person) {
            if (search && person.name.toLowerCase().indexOf(search) === -1) {
                return false;
            }
            if (roleFilter !== 'all' && person.role !== roleFilter) {
                return false;
            }
            if (statusFilter !== 'all') {
                var isDeceased = person.deceased === true;
                if (statusFilter === 'deceased' && !isDeceased) { return false; }
                if (statusFilter === 'active' && isDeceased) { return false; }
            }
            return true;
        });

        filtered.sort(function(a, b) {
            if (a.role !== b.role) {
                return a.role === 'student' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        var people = filtered.map(function(person) {
            return {
                id: person.id,
                name: person.name,
                status: person.status,
                role: person.role,
                deceased: person.deceased === true,
                isSelected: selectedCharacterId !== null &&
                    String(person.id) === selectedCharacterId
            };
        });

        return {
            classList: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            filters: filters,
            people: people,
            totalCount: students.length,
            filteredCount: people.length
        };
    }

    // ============================================================
    // CHARACTER PROJECTIONS
    // ============================================================

    function getStudentViewModel(studentId, options) {
        if (!studentId) { return null; }

        options = options || {};
        var week = options.week !== undefined ? options.week : null;

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) { return null; }

        var classes = AcademyClasses.getCharacterClasses(student) || [];

        return {
            id: student.id,
            name: CharacterQueries.getDisplayName(student),
            fullName: typeof CharacterQueries.getFullName === 'function'
                ? CharacterQueries.getFullName(student)
                : CharacterQueries.getDisplayName(student),
            status: CharacterQueries.getCurrentStatus(student),
            age: CharacterQueries.getCharacterAge(student),
            deceased: student.deceased === true,
            birthYear: student.birthYear || '',
            gender: student.gender || '',
            week: week,
            classes: classes.map(function(cls) {
                return {
                    id: cls.id,
                    name: cls.name || 'Unnamed Class',
                    status: cls.status || 'active'
                };
            }),
            classCount: classes.length
        };
    }

    function getInstructorViewModel(instructorId, options) {
        if (!instructorId) { return null; }

        options = options || {};
        var week = options.week !== undefined ? options.week : null;

        var instructor = CharacterQueries.getCharacterById(instructorId);
        if (!instructor) { return null; }

        return {
            id: instructor.id,
            name: CharacterQueries.getDisplayName(instructor),
            status: CharacterQueries.getCurrentStatus(instructor),
            age: CharacterQueries.getCharacterAge(instructor),
            deceased: instructor.deceased === true,
            week: week
        };
    }

    // ============================================================
    // DISCIPLINE LIST
    // ============================================================

    function getInstructorNamesForDiscipline(discipline) {
        if (!discipline) { return []; }
        var ids = Array.isArray(discipline.instructorIds) ? discipline.instructorIds : [];
        return ids.map(function(id) {
            return getCharacterDisplayName(id);
        });
    }

    function getDisciplineListViewModel(filters) {
        filters = filters || {};

        var disciplines = AcademyDisciplines.getDisciplines() || [];
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        var filtered = disciplines.filter(function(d) {
            if (!d || !d.id) { return false; }
            if (type !== 'all' && d.type !== type) { return false; }
            if (search && (d.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });

        var listVM = filtered.map(function(d) {
            return {
                id: d.id,
                name: d.name,
                type: d.type,
                startWeek: d.startWeek,
                endWeek: d.endWeek,
                weeklyHours: d.weeklyHours,
                weight: d.weight,
                instructorIds: Array.isArray(d.instructorIds) ? d.instructorIds.slice() : [],
                instructorNames: getInstructorNamesForDiscipline(d)
            };
        });

        return {
            disciplines: listVM,
            filters: filters,
            total: listVM.length
        };
    }

    // ============================================================
    // DISCIPLINE EDITOR VIEW MODEL
    // ============================================================
    //
    // Builds the editor VM for the inline discipline editor. Consumes:
    //   - the current draft (owned by AcademyView)
    //   - the instructor list from CharacterQueries
    //   - the grade scheme presets and validators from AcademyGradeSchemes
    //   - the assessment type list and defaults from AcademyDisciplines
    //
    // The renderer (AcademyDisciplineView) consumes the result directly.
    // AcademyView does not perform domain reads.

    function getDisciplineEditorViewModel(options) {
        options = options || {};

        var draft = options.draft;
        if (!draft) {
            return null;
        }

        var isNew = options.isNew === true;
        var errors = options.errors && typeof options.errors === 'object'
            ? options.errors
            : {};

        // Instructors for the picker.
        var availableInstructors = [];
        if (typeof CharacterQueries.getInstructors === 'function') {
            var instructors = CharacterQueries.getInstructors() || [];
            availableInstructors = instructors.map(function(c) {
                return {
                    id: c.id,
                    name: CharacterQueries.getDisplayName(c)
                };
            });
        }

        // Grade scheme preview and preset id.
        var GradeSchemes = getGradeSchemes();
        var schemePreview = '';
        var schemePresetId = 'numeric';
        var schemePresets = [
            { id: 'letter',    label: 'Letter Grade' },
            { id: 'pass_fail', label: 'Pass / Fail' },
            { id: 'numeric',   label: 'Numeric' },
            { id: 'custom',    label: 'Custom' }
        ];

        if (GradeSchemes) {
            if (typeof GradeSchemes.getRangeLabel === 'function') {
                schemePreview = GradeSchemes.getRangeLabel(draft.gradeScheme) || '';
            }
            if (typeof GradeSchemes.getPresets === 'function') {
                var presets = GradeSchemes.getPresets() || [];
                schemePresets = presets.map(function(p) {
                    return { id: p.id, label: p.label };
                });
            }
        }

        if (draft.gradeScheme && typeof draft.gradeScheme.id === 'string') {
            schemePresetId = draft.gradeScheme.id;
        }

        // Assessment types and weights.
        var assessmentTypes = [];
        var defaultAssessmentWeights = {};
        if (typeof AcademyDisciplines.getValidAssessmentTypes === 'function') {
            assessmentTypes = AcademyDisciplines.getValidAssessmentTypes() || [];
        }
        if (typeof AcademyDisciplines.getDefaultAssessmentWeights === 'function') {
            defaultAssessmentWeights = AcademyDisciplines.getDefaultAssessmentWeights() || {};
        }

        var assessmentWeights = draft.assessmentWeights && typeof draft.assessmentWeights === 'object'
            ? draft.assessmentWeights
            : defaultAssessmentWeights;

        // Instructor names for the currently selected instructors.
        var instructorNames = getInstructorNamesForDiscipline({
            instructorIds: Array.isArray(draft.instructorIds) ? draft.instructorIds : []
        });

        return {
            id: isNew ? null : draft.id,
            name: draft.name || '',
            type: draft.type || 'mandatory',
            startWeek: typeof draft.startWeek === 'number' ? draft.startWeek : 1,
            endWeek: typeof draft.endWeek === 'number' ? draft.endWeek : 52,
            weeklyHours: typeof draft.weeklyHours === 'number' ? draft.weeklyHours : 1,
            weight: typeof draft.weight === 'number' ? draft.weight : 1,
            instructorIds: Array.isArray(draft.instructorIds) ? draft.instructorIds.slice() : [],
            instructorNames: instructorNames,
            availableInstructors: availableInstructors,
            gradeScheme: draft.gradeScheme || null,
            schemePresetId: schemePresetId,
            schemePreview: schemePreview,
            schemePresets: schemePresets,
            assessmentTypes: assessmentTypes,
            assessmentWeights: assessmentWeights,
            defaultAssessmentWeights: defaultAssessmentWeights,
            fieldErrors: errors,
            isNew: isNew
        };
    }

    // ============================================================
    // RANKING VIEW MODEL
    // ============================================================

    function getRankingViewModel(classId, week) {
        var classList = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classes: classList,
                classId: null,
                className: null,
                week: week,
                entries: [],
                total: 0
            };
        }

        var entries = buildRankingEntries(selectedClass.id, week);

        return {
            classes: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            entries: entries,
            total: entries.length
        };
    }

    function buildRankingEntries(classId, week) {
        var Ranking = getAcademyRanking();
        if (!Ranking || typeof Ranking.getClassRankings !== 'function') {
            return [];
        }

        var ranked;
        try {
            ranked = Ranking.getClassRankings(classId, week, false) || [];
        } catch (e) {
            return [];
        }

        var entries = ranked.map(function(r) {
            return {
                studentId: r.studentId,
                studentName: r.studentName || getCharacterDisplayName(r.studentId),
                rank: r.rank,
                academicAverage: r.academicAverage !== undefined ? r.academicAverage : null,
                socialScore: r.socialScore !== undefined ? r.socialScore : null,
                overallScore: r.overallScore !== undefined ? r.overallScore : null,
                average: isFiniteNumber(r.overallScore)
                    ? r.overallScore
                    : (isFiniteNumber(r.academicAverage) ? r.academicAverage : null),
                gradeCount: typeof r.gradeCount === 'number' ? r.gradeCount : 0
            };
        });

        entries.sort(function(a, b) {
            return (a.rank || 999999) - (b.rank || 999999);
        });

        return entries;
    }

    // ============================================================
    // LOCATION VIEW MODEL
    // ============================================================

    function getLocationViewModel(filters, week, selectedLocationId) {
        filters = filters || {};

        var AcademyLocations = window.AcademyLocations;
        var allLocations = AcademyLocations && typeof AcademyLocations.getLocations === 'function'
            ? (AcademyLocations.getLocations() || [])
            : [];

        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        var filtered = allLocations.filter(function(l) {
            if (!l || !l.id) { return false; }
            if (type !== 'all' && l.type !== type) { return false; }
            if (search && (l.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });

        var selected = null;
        if (selectedLocationId) {
            for (var i = 0; i < filtered.length; i++) {
                if (String(filtered[i].id) === String(selectedLocationId)) {
                    selected = buildLocationDetailVM(filtered[i], week);
                    break;
                }
            }
        }

        var listVM = filtered.map(function(l) {
            return buildLocationListRowVM(l, week);
        });

        return {
            locations: listVM,
            selected: selected,
            filters: filters,
            week: week,
            total: listVM.length
        };
    }

    function buildLocationListRowVM(location, week) {
        var schedule = getLocationScheduleForWeek(location.id, week);
        return {
            id: location.id,
            name: location.name,
            type: location.type,
            capacity: location.capacity !== undefined ? location.capacity : null,
            scheduleCount: schedule.length
        };
    }

    function buildLocationDetailVM(location, week) {
        var schedule = getLocationScheduleForWeek(location.id, week);
        return {
            id: location.id,
            name: location.name,
            type: location.type,
            capacity: location.capacity !== undefined ? location.capacity : null,
            schedule: schedule
        };
    }

    function getLocationScheduleForWeek(locationId, week) {
        if (!locationId || week === undefined || week === null) {
            return [];
        }
        var CA = getCalendarAggregator();
        if (!CA || typeof CA.getLocationScheduleViewModel !== 'function') {
            return [];
        }
        try {
            return CA.getLocationScheduleViewModel(locationId, week) || [];
        } catch (e) {
            return [];
        }
    }

    // ============================================================
    // WEEKLY TEAMS VIEW MODEL
    // ============================================================

    function getWeeklyTeamsViewModel(classId, week, selectedTeamId) {
        var classList = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classes: classList,
                classId: null,
                className: null,
                week: week,
                teams: [],
                selectedTeamId: null,
                selectedTeam: null
            };
        }

        var assignments = {};
        var AWT = getAcademyWeeklyTeams();
        if (AWT && typeof AWT.getWeeklyTeams === 'function') {
            try {
                assignments = AWT.getWeeklyTeams(selectedClass.id, week) || {};
            } catch (e) {
                assignments = {};
            }
        }

        var teams = buildWeeklyTeamsList(selectedClass.id, week, assignments);

        var selectedTeamVM = null;
        var resolvedSelectedTeamId = null;
        if (selectedTeamId) {
            for (var j = 0; j < teams.length; j++) {
                if (String(teams[j].id) === String(selectedTeamId)) {
                    selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, assignments);
                    resolvedSelectedTeamId = teams[j].id;
                    break;
                }
            }
        }

        var teamsVM = teams.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                type: t.type,
                typeLabel: t.typeLabel,
                status: t.status,
                periodLabel: t.periodLabel,
                periodDisplay: t.periodDisplay,
                memberCount: t.memberCount
            };
        });

        return {
            classes: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            teams: teamsVM,
            selectedTeamId: resolvedSelectedTeamId,
            selectedTeam: selectedTeamVM
        };
    }

    function buildWeeklyTeamsList(classId, week, assignments) {
        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            return [];
        }

        var raw = TeamQueries.getTeamsByClass(classId) || [];
        if (!Array.isArray(raw)) {
            return [];
        }

        var items = [];

        for (var i = 0; i < raw.length; i++) {
            var team = raw[i];
            if (!team || !team.id) { continue; }
            if (team.type !== 'academic') { continue; }

            var memberIds = Array.isArray(assignments[String(team.id)])
                ? assignments[String(team.id)]
                : [];

            items.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                type: team.type,
                typeLabel: TeamConstants.getTypeLabel(team.type),
                status: team.status || 'active',
                periodLabel: TeamConstants.getPeriodLabel(team.type),
                periodDisplay: getTeamPeriodDisplay(team),
                memberCount: memberIds.length,
                _team: team,
                _memberIds: memberIds
            });
        }

        items.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return items;
    }

    function buildWeeklyTeamDetail(team, assignments) {
        if (!team) { return null; }

        var memberIds = Array.isArray(assignments[String(team.id)])
            ? assignments[String(team.id)]
            : [];

        var members = buildTeamMembersVM(memberIds);

        return {
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: TeamConstants.getTypeLabel(team.type),
            status: team.status || 'active',
            periodLabel: TeamConstants.getPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),
            temporaryMission: team.temporaryMission || null,
            memberCount: members.length,
            members: members
        };
    }

    function buildTeamMembersVM(memberIds) {
        if (!Array.isArray(memberIds)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < memberIds.length; i++) {
            var charId = memberIds[i];
            if (!charId) { continue; }

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) {
                result.push({
                    characterId: charId,
                    name: 'Unknown',
                    role: 'Member',
                    age: '',
                    statusLabel: ''
                });
                continue;
            }

            result.push({
                characterId: charId,
                name: CharacterQueries.getDisplayName(char),
                role: 'Member',
                age: CharacterQueries.getCharacterAge(char),
                statusLabel: char.deceased === true ? 'Deceased' : 'Active'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAggregator = {
        // Class projections
        getClassListViewModel: getClassListViewModel,
        getClassViewModel: getClassViewModel,
        getClassStudentsViewModel: getClassStudentsViewModel,

        // People
        getPeopleViewModel: getPeopleViewModel,

        // Character projections
        getStudentViewModel: getStudentViewModel,
        getInstructorViewModel: getInstructorViewModel,

        // Discipline projections
        getDisciplineListViewModel: getDisciplineListViewModel,
        getDisciplineEditorViewModel: getDisciplineEditorViewModel,
        getInstructorNamesForDiscipline: getInstructorNamesForDiscipline,

        // Ranking
        getRankingViewModel: getRankingViewModel,

        // Location
        getLocationViewModel: getLocationViewModel,

        // Weekly teams
        getWeeklyTeamsViewModel: getWeeklyTeamsViewModel
    };

})();
