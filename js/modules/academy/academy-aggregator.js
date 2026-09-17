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
 *     getWeeklyTeamMemberManagerViewModel({ classId, teamId, week })
 *     getUnassignedTeamsViewModel({ classId })
 *
 * IMPORTANT:
 *   - Projection builder. Never mutates. No UI dependencies.
 *   - Composes domain modules. Never walks raw storage.
 *   - No fallback values for missing domain data. When a source is
 *     absent, the projection returns null or an empty collection.
 *   - The class VM is deliberately small (header fields only).
 *
 * WEEKLY TEAMS WEEK FILTER:
 *   The team list for a given (class, week) is filtered by the
 *   PERSISTENT Team entity's own startPeriod / endPeriod AND by the
 *   weekly-team window record. Both must contain the week.
 *
 * WEEKLY TEAMS ROSTER (v22):
 *   The roster for a team comes from the PERSISTENT Team entity's
 *   members[] array, filtered by week through
 *   TeamQueries.getActiveTeamMembers. The weekly-team record carries
 *   ONLY the week window.
 *
 * ORPHAN TEAMS:
 *   Academic Teams with classId === null are surfaced by
 *   getUnassignedTeamsViewModel and by the orphanTeams field on the
 *   Weekly Teams VM. The Weekly Teams view shows them in a
 *   compact section until every orphan is assigned. Once assigned,
 *   the section disappears.
 *
 * CLASS VM SHAPE:
 *   {
 *     id,
 *     name,
 *     status,
 *     year,
 *     description,
 *     instructorId,
 *     instructorName,
 *     studentCount,
 *     createdAt
 *   }
 *
 * SCHEDULE SOURCE (v21):
 *   Location schedule projections read from
 *   AcademyCalendarAggregator, which is projector-backed.
 *
 * DEPENDENCIES:
 *   - AcademyClasses       (class entities)
 *   - AcademyDisciplines   (discipline entities)
 *   - CharacterQueries     (character identity)
 *   - TeamQueries          (persistent Team entities)
 *   - TeamConstants        (team type/period labels)
 *   - CalendarConstants    (week bounds for week resolution)
 *
 *   - TeamAggregator       (period-display strings; lazy)
 *   - AcademyWeeklyTeams   (week-window + orphan reads; lazy)
 *   - AcademyRanking       (ranking projection; lazy)
 *   - AcademyCalendarAggregator (schedule projections; lazy)
 *   - AcademyEnrolments    (enrolment read for discipline editor VM; lazy)
 *   - AcademyGrades        (grade read for discipline editor VM; lazy)
 */

(function() {
    'use strict';

    if (window.__academyAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CalendarConstants = window.CalendarConstants;

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
    if (!TeamQueries || typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries.isTeamActiveAtPeriod');
    }
    if (!TeamConstants) {
        _missing.push('TeamConstants');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
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

    function getAcademyCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
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

    function getEliminationQueries() {
        return window.EliminationQueries || null;
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

    function getTeamPeriodDisplay(team) {
        var TA = getTeamAggregator();
        if (TA && typeof TA.getTeamPeriodDisplay === 'function') {
            return TA.getTeamPeriodDisplay(team);
        }
        return '-';
    }

    // ============================================================
    // ROSTER DERIVATION
    // ============================================================

    function deriveClassRoster(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return [];
        }

        var all = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var instructorId = cls.instructorId
            ? String(cls.instructorId)
            : null;
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
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
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

    function getClassStudentsViewModel(classId) {
        return deriveClassRoster(classId);
    }

    // ============================================================
    // CLASS VIEW MODEL
    // ============================================================

    function getClassViewModel(classId) {
        if (!classId) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var roster = deriveClassRoster(classId);
        var studentCount = roster.length;

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
            studentCount: studentCount,
            createdAt: cls.createdAt || ''
        };
    }

    // ============================================================
    // PEOPLE VIEW MODEL
    // ============================================================

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
                typeLabel: getDisciplineTypeLabel(d.type),
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

    function getDisciplineTypeLabel(type) {
        if (type === 'mandatory') { return 'Mandatory'; }
        if (type === 'optional') { return 'Optional'; }
        return 'Unknown';
    }

    // ============================================================
    // DISCIPLINE EDITOR VIEW MODEL
    // ============================================================

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
            var studentId = r.studentId || r.characterId;
            var name = r.studentName || getCharacterDisplayName(studentId);

            var average = null;
            if (isFiniteNumber(r.average)) {
                average = r.average;
            } else if (isFiniteNumber(r.academicAverage)) {
                average = r.academicAverage;
            } else if (isFiniteNumber(r.overallScore)) {
                average = r.overallScore;
            }

            var rank = isFiniteNumber(r.rank) ? r.rank : null;
            var gradeCount = isFiniteNumber(r.gradeCount) ? r.gradeCount : null;

            return {
                characterId: studentId,
                characterName: name,
                rank: rank,
                rankDisplay: rank !== null ? '#' + rank : '\u2014',
                average: average,
                averageDisplay: average !== null ? String(average) : '\u2014',
                gradeCount: gradeCount,
                gradeCountDisplay: gradeCount !== null ? String(gradeCount) : '\u2014',
                isInstructor: r.isInstructor === true
            };
        });

        entries.sort(function(a, b) {
            var ar = a.rank !== null ? a.rank : 999999;
            var br = b.rank !== null ? b.rank : 999999;
            return ar - br;
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
            typeLabel: getLocationTypeLabel(location.type),
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
            typeLabel: getLocationTypeLabel(location.type),
            capacity: location.capacity !== undefined ? location.capacity : null,
            schedule: schedule
        };
    }

    function getLocationTypeLabel(type) {
        if (!isNonEmptyString(type)) { return 'Other'; }
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function getLocationScheduleForWeek(locationId, week) {
        if (!locationId || week === undefined || week === null) {
            return [];
        }

        var ACA = getAcademyCalendarAggregator();
        if (!ACA || typeof ACA.getLocationScheduleViewModel !== 'function') {
            return [];
        }

        var vm;
        try {
            vm = ACA.getLocationScheduleViewModel(locationId, week);
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getLocationScheduleViewModel failed:',
                e
            );
            return [];
        }

        if (!vm || !vm.schedule) {
            return [];
        }

        return flattenScheduleMap(vm.schedule);
    }

    function flattenScheduleMap(scheduleMap) {
        var result = [];
        if (!scheduleMap || typeof scheduleMap !== 'object') {
            return result;
        }

        var dayKeys = Object.keys(scheduleMap);
        for (var i = 0; i < dayKeys.length; i++) {
            var dayKey = dayKeys[i];
            var dayNum = parseInt(dayKey, 10);
            if (isNaN(dayNum)) { continue; }

            var daySchedule = scheduleMap[dayKey];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            var hourKeys = Object.keys(daySchedule);
            for (var j = 0; j < hourKeys.length; j++) {
                var hourKey = hourKeys[j];
                var hourNum = parseInt(hourKey, 10);
                if (isNaN(hourNum)) { continue; }

                var slot = daySchedule[hourKey];
                if (!slot) { continue; }

                result.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: slot.disciplineId || null,
                    disciplineName: slot.disciplineName || 'Unknown',
                    duration: isFiniteNumber(slot.duration) ? slot.duration : 1,
                    label: isNonEmptyString(slot.label) ? slot.label : ''
                });
            }
        }

        result.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.hour - b.hour;
        });

        return result;
    }

    // ============================================================
    // WEEKLY TEAMS VIEW MODEL
    // ============================================================
    //
    // The team list is filtered by both the PERSISTENT Team entity's
    // own startPeriod / endPeriod AND the weekly-team window record.
    //
    // ROSTER SOURCE (v22):
    //   Member count and selected-team roster come from the
    //   persistent Team entity's members[] array, filtered by week.
    //
    // ORPHAN TEAMS:
    //   Academic teams with classId null appear in `orphanTeams` so
    //   the view can surface them for assignment.

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

        // Orphans are class-agnostic. Compute once.
        var orphanTeams = getUnassignedTeamsViewModel().orphanTeams;

        // Class filter for the orphan picker: every class.
        var orphanClasses = classList.map(function(c) {
            return { id: c.id, name: c.name };
        });

        if (!selectedClass) {
            return {
                classes: classList,
                classId: null,
                className: null,
                week: week,
                teams: [],
                selectedTeamId: null,
                selectedTeam: null,
                orphanTeams: orphanTeams,
                orphanClasses: orphanClasses
            };
        }

        var AWT = getAcademyWeeklyTeams();
        var scheduledTeamIds = Object.create(null);
        if (AWT && typeof AWT.getWeeklyTeams === 'function') {
            var assignments;
            try {
                assignments = AWT.getWeeklyTeams(selectedClass.id, week) || {};
            } catch (e) {
                assignments = {};
            }
            var scheduledKeys = Object.keys(assignments);
            for (var k = 0; k < scheduledKeys.length; k++) {
                scheduledTeamIds[String(scheduledKeys[k])] = true;
            }
        }

        var teams = buildWeeklyTeamsList(
            selectedClass.id,
            week,
            scheduledTeamIds
        );

        var selectedTeamVM = null;
        var resolvedSelectedTeamId = null;
        if (selectedTeamId) {
            for (var j = 0; j < teams.length; j++) {
                if (String(teams[j].id) === String(selectedTeamId)) {
                    selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, week);
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
                statusLabel: t.statusLabel,
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
            selectedTeam: selectedTeamVM,
            orphanTeams: orphanTeams,
            orphanClasses: orphanClasses
        };
    }

    function buildWeeklyTeamsList(classId, week, scheduledTeamIds) {
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

            // WEEK FILTER: persistent Team window.
            if (typeof TeamQueries.isTeamActiveAtPeriod === 'function') {
                if (!TeamQueries.isTeamActiveAtPeriod(team, week)) {
                    continue;
                }
            }

            // SCHEDULING GATE: must have a weekly-team window
            // covering the requested week.
            if (scheduledTeamIds &&
                scheduledTeamIds[String(team.id)] !== true) {
                continue;
            }

            // ROSTER SOURCE (v22): persistent Team entity.
            var activeMembers = TeamQueries.getActiveTeamMembers(
                team,
                week
            ) || [];

            items.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                type: team.type,
                typeLabel: TeamConstants.getTypeLabel(team.type),
                status: team.status || 'active',
                statusLabel: getTeamStatusLabel(team.status),
                periodLabel: TeamConstants.getPeriodLabel(team.type),
                periodDisplay: getTeamPeriodDisplay(team),
                memberCount: activeMembers.length,
                _team: team
            });
        }

        items.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return items;
    }

    function getTeamStatusLabel(status) {
        if (!isNonEmptyString(status)) { return 'Active'; }
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function buildWeeklyTeamDetail(team, week) {
        if (!team) { return null; }

        var activeMembers = TeamQueries.getActiveTeamMembers(
            team,
            week
        ) || [];

        var members = buildTeamMembersVM(activeMembers);

        return {
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: TeamConstants.getTypeLabel(team.type),
            status: team.status || 'active',
            statusLabel: getTeamStatusLabel(team.status),
            periodLabel: TeamConstants.getPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),
            temporaryMission: team.temporaryMission || null,
            memberCount: members.length,
            members: members
        };
    }

    function buildTeamMembersVM(activeMemberRecords) {
        if (!Array.isArray(activeMemberRecords)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < activeMemberRecords.length; i++) {
            var record = activeMemberRecords[i];
            if (!record) { continue; }

            var charId = record.characterId;
            if (!charId) { continue; }

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) {
                result.push({
                    characterId: charId,
                    name: 'Unknown',
                    role: record.role || 'Member',
                    roleLabel: '',
                    age: '',
                    statusLabel: '',
                    deceased: false
                });
                continue;
            }

            result.push({
                characterId: charId,
                name: CharacterQueries.getDisplayName(char),
                role: record.role || 'Member',
                roleLabel: '',
                age: CharacterQueries.getCharacterAge(char),
                statusLabel: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased === true
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // UNASSIGNED (ORPHAN) ACADEMIC TEAMS
    // ============================================================
    //
    // Academic teams with classId null. The Weekly Teams view
    // surfaces them so the user can assign a class. When the array
    // is empty, the section does not render.

    function getUnassignedTeamsViewModel(options) {
        options = options || {};

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.getOrphanAcademicTeams !== 'function') {
            return { orphanTeams: [] };
        }

        var orphans = [];
        try {
            orphans = AWT.getOrphanAcademicTeams() || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getOrphanAcademicTeams failed:', e
            );
            return { orphanTeams: [] };
        }

        var result = orphans.map(function(o) {
            return {
                id: o.id,
                name: o.name || 'Unnamed Team',
                memberCount: isFiniteNumber(o.memberCount) ? o.memberCount : 0,
                suggestedClassId: isNonEmptyString(o.suggestedClassId)
                    ? o.suggestedClassId
                    : null
            };
        });

        return { orphanTeams: result };
    }

    // ============================================================
    // WEEKLY TEAM MEMBER MANAGER VIEW MODEL
    // ============================================================
    //
    // Consumed by academy-weekly-teams-members.js. Builds:
    //   - members: currently active members (persistent roster,
    //     filtered by week)
    //   - candidates: class roster minus instructor minus current
    //     members minus characters assigned elsewhere this week
    //     minus eliminated characters
    //
    // Team must belong to the class; if not, returns null.

    function getWeeklyTeamMemberManagerViewModel(options) {
        if (!options || typeof options !== 'object') {
            return null;
        }

        var classId = isNonEmptyString(options.classId)
            ? String(options.classId)
            : null;
        var teamId = isNonEmptyString(options.teamId)
            ? String(options.teamId)
            : null;
        var week = isFiniteNumber(options.week)
            ? options.week
            : (typeof options.week === 'string'
                ? parseInt(options.week, 10)
                : null);

        if (!classId || !teamId || !isFiniteNumber(week)) {
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return null;
        }
        if (String(team.classId) !== classId) {
            return null;
        }

        // ---- Members ----
        var activeMembers = TeamQueries.getActiveTeamMembers(
            team, week
        ) || [];

        var members = buildTeamMembersVM(activeMembers);

        // ---- Candidate pool ----
        var activeIds = Object.create(null);
        for (var i = 0; i < activeMembers.length; i++) {
            if (activeMembers[i] && activeMembers[i].characterId) {
                activeIds[String(activeMembers[i].characterId)] = true;
            }
        }

        // Current member IDs (all history, not just active) so a
        // rejoining character is not offered as a candidate.
        var allCurrentIds = Object.create(null);
        if (Array.isArray(team.members)) {
            for (var c = 0; c < team.members.length; c++) {
                var m = team.members[c];
                if (m && m.characterId) {
                    allCurrentIds[String(m.characterId)] = true;
                }
            }
        }

        // Assigned elsewhere = active in another academic team of
        // the same class this week.
        var assignedElsewhere = Object.create(null);
        var classTeams = TeamQueries.getTeamsByClass(classId, 'operational') || [];
        for (var t = 0; t < classTeams.length; t++) {
            var sibling = classTeams[t];
            if (!sibling || String(sibling.id) === teamId) continue;
            if (TeamConstants.normalizeTeamType(sibling.type) !== 'academic') continue;
            var siblingMembers = TeamQueries.getActiveTeamMembers(sibling, week) || [];
            for (var s = 0; s < siblingMembers.length; s++) {
                var sm = siblingMembers[s];
                if (sm && sm.characterId) {
                    assignedElsewhere[String(sm.characterId)] = true;
                }
            }
        }

        var cls = AcademyClasses.getClass(classId);
        var instructorId = cls && cls.instructorId
            ? String(cls.instructorId)
            : null;

        var roster = deriveClassRoster(classId);

        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByWeek === 'function';

        var candidates = [];

        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) continue;

            var studentId = String(student.id);

            if (instructorId !== null && studentId === instructorId) {
                continue;
            }
            if (allCurrentIds[studentId]) {
                continue;
            }
            if (assignedElsewhere[studentId]) {
                continue;
            }

            if (canCheckElimination) {
                var eliminated = false;
                try {
                    eliminated = EQ.isCharacterEliminatedByWeek(studentId, week) === true;
                } catch (e) {
                    console.warn(
                        '[AcademyAggregator] isCharacterEliminatedByWeek threw for ' +
                        studentId + ':', e
                    );
                    eliminated = false;
                }
                if (eliminated) {
                    continue;
                }
            }

            candidates.push({
                id: studentId,
                name: student.name,
                status: student.status || ''
            });
        }

        candidates.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return {
            teamId: teamId,
            teamName: team.name || 'Unnamed Team',
            week: week,
            members: members,
            candidates: candidates
        };
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
        getWeeklyTeamsViewModel: getWeeklyTeamsViewModel,
        getWeeklyTeamMemberManagerViewModel: getWeeklyTeamMemberManagerViewModel,
        getUnassignedTeamsViewModel: getUnassignedTeamsViewModel
    };

})();
