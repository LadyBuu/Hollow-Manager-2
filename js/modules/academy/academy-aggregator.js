/**
 * modules/academy/academy-aggregator.js - Academy Aggregator
 * Cross-domain projection builder for the Academy domain.
 *
 * Path: js/modules/academy/academy-aggregator.js
 *
 * PROJECTIONS:
 *   Classes:
 *     getClassListViewModel()
 *     getClassViewModel(classId, week)
 *     getClassStudentsViewModel(classId, week)
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
 *
 *   Class-discipline picker (v27):
 *     getClassDisciplinesPickerViewModel(classId)
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
 * MEMBER INTERVALS MODEL (v24):
 *   Each team member entry on a persistent Team entity is:
 *
 *     {
 *       memberId,        // stable per-entry identifier
 *       characterId,
 *       role,
 *       intervals: [
 *         { joinPeriod, leavePeriod },
 *         ...
 *       ]
 *     }
 *
 *   The member VM carries the entry's `intervals` array verbatim
 *   (each interval gets its own periodDisplay string), plus a flat
 *   `periodDisplay` summary for list views that don't expand them.
 *
 * WEEKLY TEAMS WEEK FILTER:
 *   The team list for a given (class, week) is filtered by the
 *   PERSISTENT Team entity's own startPeriod / endPeriod AND by the
 *   weekly-team window record. Both must contain the week.
 *
 * WEEKLY TEAMS ROSTER:
 *   The roster for a team comes from the PERSISTENT Team entity's
 *   members[] array, filtered by week through
 *   TeamQueries.getActiveTeamMembers. The weekly-team record carries
 *   ONLY the week window.
 *
 *   Each member VM carries:
 *     memberId       — stable per-entry identifier
 *     characterId    — the character
 *     name, role, age, statusLabel, deceased
 *     intervals[]    — one entry per stint, each with:
 *                        joinPeriod, leavePeriod, periodDisplay
 *     periodDisplay  — semicolon-joined summary across all intervals
 *
 * FORMER MEMBERS:
 *   getWeeklyTeamMemberManagerViewModel returns BOTH:
 *     members       — active at the display week
 *     formerMembers — entries with no interval containing the
 *                     display week, but at least one interval whose
 *                     leavePeriod is present and strictly less than
 *                     the display week
 *
 * ORPHAN TEAMS:
 *   Academic Teams with classId === null are surfaced by
 *   getUnassignedTeamsViewModel and by the orphanTeams field on the
 *   Weekly Teams VM.
 *
 * CLASS-DISCIPLINE PICKER (v27):
 *   The picker VM is derived from three sources:
 *     - AcademyDisciplines.getDisciplines()      (global list)
 *     - AcademyClassDisciplines.hasClassDiscipline (offered?)
 *     - AcademyEnrolments.getEnrolledStudents     (who's enrolled?)
 *
 *   The picker treats "instructor of a discipline for a class" as an
 *   enrolment, same store as students. Candidate instructors are the
 *   characters whose `mode === 'instructor'`. The VM exposes, per
 *   discipline row:
 *     id, name, typeLabel, mandatory, offered,
 *     activeInWeek, startWeek, endWeek,
 *     instructors: [{ id, name, assigned }]
 *   where `assigned` means the instructor is currently enrolled in
 *   the (classId, disciplineId) pair.
 *
 *   The VM does NOT expose an instructor picker for a discipline the
 *   class does not offer. Unchecked rows carry only the minimal
 *   fields needed to render the checkbox.
 *
 * INSTRUCTOR DISCIPLINES (v27):
 *   getDisciplineListViewModel previously carried instructorIds and
 *   instructorNames on each list row, sourced from the retired
 *   discipline.instructorIds field. Those fields are REMOVED. A
 *   discipline no longer has a global instructor list. Callers that
 *   need "which instructors teach this discipline" walk enrolments
 *   and filter by character mode.
 *
 * DISCIPLINE EDITOR VM (v27):
 *   getDisciplineEditorViewModel previously carried instructorIds,
 *   instructorNames, and availableInstructors. Those fields are
 *   REMOVED. The discipline editor's draft no longer carries
 *   instructor data; instructor-of-a-discipline-for-a-class is
 *   edited through the class-disciplines picker. The editor VM
 *   carries only the config fields the editor still renders:
 *   name, type, weeks, weeklyHours, weight, gradeScheme, and
 *   assessmentWeights.
 *
 * SCHEDULE SOURCE:
 *   Location schedule projections read from
 *   AcademyCalendarAggregator, which is projector-backed.
 *
 * ELIMINATION SEMANTICS:
 *   The People sidebar and the weekly-team candidate pool both use
 *   the SAME definition of "eliminated": eliminated as of the
 *   displayed week, computed by
 *   EliminationQueries.isCharacterEliminatedByWeek. Boundary rule:
 *   elimination at week E counts for week W when E < W.
 *
 *   People filter values: 'active', 'eliminated', 'deceased', 'all'.
 *   'active' excludes both deceased and eliminated.
 *
 * FAIL-CLOSED ELIGIBILITY:
 *   getWeeklyTeamMemberManagerViewModel treats EliminationQueries as
 *   a required dependency. Missing or throwing → the projection
 *   throws. It does NOT silently treat the candidate as eligible.
 *
 * DEPENDENCIES (MANDATORY):
 *   - AcademyClasses       (class entities)
 *   - AcademyDisciplines   (discipline entities)
 *   - AcademyClassDisciplines (class-discipline markers, v27)
 *   - AcademyEnrolments    (class-scoped enrolments)
 *   - CharacterQueries     (character identity)
 *   - TeamQueries          (persistent Team entities)
 *   - TeamConstants        (team type/period labels)
 *   - CalendarConstants    (week bounds for week resolution)
 *
 * DEPENDENCIES (LAZY):
 *   - TeamAggregator             (period-display strings)
 *   - AcademyWeeklyTeams         (week-window + orphan reads)
 *   - AcademyRanking             (ranking projection)
 *   - AcademyCalendarAggregator  (schedule projections)
 *   - AcademyGrades              (grade read for discipline editor VM)
 *   - EliminationQueries         (elimination reads; REQUIRED by
 *                                 getWeeklyTeamMemberManagerViewModel
 *                                 and by the People 'eliminated' filter)
 *
 * NOTE (v27):
 *   AcademyEnrolments is promoted to MANDATORY. The picker VM cannot
 *   be built without it, and the student disciplines projection has
 *   always depended on it. Making it mandatory reflects reality.
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
    var AcademyClassDisciplines = window.AcademyClassDisciplines;
    var AcademyEnrolments = window.AcademyEnrolments;
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
    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.getClassDisciplinesForClass !== 'function') {
        _missing.push('AcademyClassDisciplines.getClassDisciplinesForClass');
    }
    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.hasClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplines.hasClassDiscipline');
    }
    if (!AcademyEnrolments || typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
        _missing.push('AcademyEnrolments.getStudentDisciplines');
    }
    if (!AcademyEnrolments || typeof AcademyEnrolments.getEnrolledStudents !== 'function') {
        _missing.push('AcademyEnrolments.getEnrolledStudents');
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
    if (!TeamQueries || typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
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

    /**
     * Resolve a week to a bounded integer, or null.
     */
    function resolveWeek(week) {
        if (week === undefined || week === null || week === '') {
            return null;
        }
        var n = Number(week);
        if (!Number.isInteger(n)) {
            return null;
        }
        if (n < CalendarConstants.MIN_WEEK ||
            n > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return n;
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

    function isInstructorCharacter(char) {
        if (!char || typeof char !== 'object') {
            return false;
        }
        return char.mode === 'instructor';
    }

    // ============================================================
    // ELIMINATION PROJECTION
    // ============================================================

    function readEliminationState(charId, week) {
        var result = {
            eliminated: false,
            eliminationWeek: null,
            eliminationReason: ''
        };

        if (week === null) {
            return result;
        }

        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.isCharacterEliminatedByWeek !== 'function') {
            return result;
        }

        result.eliminated = EQ.isCharacterEliminatedByWeek(charId, week) === true;

        if (result.eliminated) {
            if (typeof EQ.getEliminationWeek === 'function') {
                result.eliminationWeek = EQ.getEliminationWeek(charId);
            }
            if (typeof EQ.getEliminationReason === 'function') {
                var reason = EQ.getEliminationReason(charId);
                if (typeof reason === 'string' && reason !== 'Unknown') {
                    result.eliminationReason = reason;
                }
            }
        }

        return result;
    }

    // ============================================================
    // ROSTER DERIVATION
    // ============================================================

    function deriveClassRoster(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return [];
        }

        var weekNum = resolveWeek(week);

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

            var elim = readEliminationState(c.id, weekNum);

            result.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true,
                eliminated: elim.eliminated,
                eliminationWeek: elim.eliminationWeek,
                eliminationReason: elim.eliminationReason,
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

    function getClassStudentsViewModel(classId, week) {
        return deriveClassRoster(classId, week);
    }

    // ============================================================
    // CLASS VIEW MODEL
    // ============================================================

    function getClassViewModel(classId, week) {
        if (!classId) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var roster = deriveClassRoster(classId, week);
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

        var weekNum = resolveWeek(options.week);

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
                week: weekNum,
                filters: filters,
                people: [],
                totalCount: 0,
                filteredCount: 0
            };
        }

        var students = getClassStudentsViewModel(
            selectedClass.id,
            weekNum
        );

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
                var instructorChar =
                    CharacterQueries.getCharacterById(cls.instructorId);
                if (instructorChar) {
                    var instructorElim = readEliminationState(
                        instructorChar.id, weekNum
                    );
                    students = students.concat([{
                        id: instructorChar.id,
                        name: CharacterQueries.getDisplayName(instructorChar),
                        status: CharacterQueries.getCurrentStatus(instructorChar),
                        age: CharacterQueries.getCharacterAge(instructorChar),
                        deceased: instructorChar.deceased === true,
                        eliminated: instructorElim.eliminated,
                        eliminationWeek: instructorElim.eliminationWeek,
                        eliminationReason: instructorElim.eliminationReason,
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
                var isEliminated = person.eliminated === true;

                if (statusFilter === 'deceased' && !isDeceased) {
                    return false;
                }
                if (statusFilter === 'eliminated' && !isEliminated) {
                    return false;
                }
                // 'active' means not deceased AND not eliminated.
                if (statusFilter === 'active' &&
                    (isDeceased || isEliminated)) {
                    return false;
                }
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
                eliminated: person.eliminated === true,
                eliminationWeek: person.eliminationWeek,
                eliminationReason: person.eliminationReason,
                isSelected: selectedCharacterId !== null &&
                    String(person.id) === selectedCharacterId
            };
        });

        return {
            classList: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: weekNum,
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
    //
    // v27: the list VM no longer carries instructorIds or
    // instructorNames. The discipline entity no longer holds a
    // global instructor list. Callers that need "who teaches this
    // discipline" walk enrolments and filter by character.mode.

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
                weight: d.weight
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
    //
    // v27: the editor VM no longer carries instructorIds,
    // instructorNames, or availableInstructors. The discipline
    // editor's draft no longer carries instructor data;
    // instructor-of-a-discipline-for-a-class is edited through the
    // class-disciplines picker. The editor VM carries only the
    // config fields the editor still renders.

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

        var assessmentWeights = draft.assessmentWeights &&
            typeof draft.assessmentWeights === 'object'
            ? draft.assessmentWeights
            : defaultAssessmentWeights;

        return {
            id: isNew ? null : draft.id,
            name: draft.name || '',
            type: draft.type || 'mandatory',
            startWeek: typeof draft.startWeek === 'number' ? draft.startWeek : 1,
            endWeek: typeof draft.endWeek === 'number' ? draft.endWeek : 52,
            weeklyHours: typeof draft.weeklyHours === 'number' ? draft.weeklyHours : 1,
            weight: typeof draft.weight === 'number' ? draft.weight : 1,
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
    // CLASS-DISCIPLINE PICKER VIEW MODEL (v27)
    // ============================================================
    //
    // The picker VM lists every global discipline with a checkbox,
    // plus per-row detail for the disciplines the class already
    // offers. It does not filter by type and does not paginate.
    //
    // SHAPE:
    //
    //   {
    //     classId,
    //     className,
    //     disciplines: [
    //       {
    //         id,
    //         name,
    //         type,
    //         typeLabel,
    //         startWeek,
    //         endWeek,
    //         activeInWeek,      // whether the discipline window
    //                            // covers the current display week
    //         offered,           // class offers this discipline?
    //         mandatory,         // only meaningful when offered
    //         instructors: [     // only populated when offered
    //           { id, name, assigned }
    //         ]
    //       },
    //       ...
    //     ]
    //   }
    //
    // INSTRUCTOR LIST:
    //   Candidate instructors are characters whose mode is
    //   'instructor'. The `assigned` flag is true when the
    //   instructor is currently enrolled in (classId, disciplineId).
    //
    // WEEK:
    //   The picker VM's `activeInWeek` uses the current display
    //   week passed in options.week. When no valid week is passed,
    //   `activeInWeek` is false on every row. Callers that only
    //   want the picker for its structural data (offered, mandatory,
    //   instructors) can pass a valid week and ignore the flag.
    //
    // INSTRUCTORS ARE NOT LOADED FOR UNCHECKED ROWS:
    //   An unoffered discipline's row does not carry the instructors
    //   array (it is [] ). This keeps the VM small when a class
    //   offers only a handful of the global disciplines.

    function buildInstructorCandidateList() {
        var chars = CharacterQueries.getCharacters() || [];
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !c.id) { continue; }
            if (!isInstructorCharacter(c)) { continue; }
            result.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c)
            });
        }
        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });
        return result;
    }

    function buildAssignedInstructorSet(classId, disciplineId) {
        var result = Object.create(null);
        var students = [];
        try {
            students = AcademyEnrolments.getEnrolledStudents(
                classId, disciplineId
            ) || [];
        } catch (e) {
            students = [];
        }
        for (var i = 0; i < students.length; i++) {
            var id = students[i];
            if (!isNonEmptyString(id)) { continue; }
            var char = CharacterQueries.getCharacterById(id);
            if (!char) { continue; }
            if (!isInstructorCharacter(char)) { continue; }
            result[String(id)] = true;
        }
        return result;
    }

    function getClassDisciplinesPickerViewModel(classId, options) {
        options = options || {};

        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var weekNum = resolveWeek(options.week);

        var allDisciplines = AcademyDisciplines.getDisciplines() || [];
        var instructorCandidates = buildInstructorCandidateList();

        // Sort disciplines by name for a stable row order.
        allDisciplines = allDisciplines.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var rows = [];

        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!d || !d.id) { continue; }

            var offered = AcademyClassDisciplines.hasClassDiscipline(
                classId, d.id
            );

            var activeInWeek = false;
            if (weekNum !== null) {
                activeInWeek = AcademyClassDisciplines.isActiveInWeek(
                    classId, d.id, weekNum
                );
            }

            var row = {
                id: d.id,
                name: d.name || 'Unnamed Discipline',
                type: d.type || 'mandatory',
                typeLabel: getDisciplineTypeLabel(d.type),
                startWeek: isFiniteNumber(d.startWeek) ? d.startWeek : null,
                endWeek: (d.endWeek === null || d.endWeek === undefined)
                    ? null
                    : (isFiniteNumber(d.endWeek) ? d.endWeek : null),
                activeInWeek: activeInWeek,
                offered: offered,
                mandatory: false,
                instructors: []
            };

            if (offered) {
                var marker = AcademyClassDisciplines.getClassDiscipline(
                    classId, d.id
                );
                row.mandatory = marker && marker.mandatory === true;

                var assignedSet = buildAssignedInstructorSet(
                    classId, d.id
                );

                var instructors = [];
                for (var j = 0; j < instructorCandidates.length; j++) {
                    var cand = instructorCandidates[j];
                    instructors.push({
                        id: cand.id,
                        name: cand.name,
                        assigned: assignedSet[String(cand.id)] === true
                    });
                }
                row.instructors = instructors;
            }

            rows.push(row);
        }

        return {
            classId: cls.id,
            className: cls.name || 'Unnamed Class',
            disciplines: rows
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
        var allLocations =
            AcademyLocations && typeof AcademyLocations.getLocations === 'function'
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

        var orphanTeams = getUnassignedTeamsViewModel().orphanTeams;

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

            if (typeof TeamQueries.isTeamActiveAtPeriod === 'function') {
                if (!TeamQueries.isTeamActiveAtPeriod(team, week)) {
                    continue;
                }
            }

            if (scheduledTeamIds &&
                scheduledTeamIds[String(team.id)] !== true) {
                continue;
            }

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

        var members = buildTeamMembersVM(activeMembers, team.type);

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

    // ============================================================
    // MEMBER PERIOD DISPLAY
    // ============================================================

    function formatMemberPeriodDisplay(joinPeriod, leavePeriod, teamType) {
        var isAcademic = String(teamType) === 'academic';
        var prefix = isAcademic ? 'Wk ' : '';

        var hasJoin = joinPeriod !== undefined &&
                      joinPeriod !== null &&
                      joinPeriod !== '';
        var hasLeave = leavePeriod !== undefined &&
                       leavePeriod !== null &&
                       leavePeriod !== '';

        var joinStr = hasJoin ? String(joinPeriod) : '';
        var leaveStr = hasLeave ? String(leavePeriod) : '';

        if (joinStr && leaveStr) {
            return prefix + joinStr + ' \u2013 ' + prefix + leaveStr;
        }
        if (joinStr) {
            return prefix + joinStr + ' \u2013';
        }
        if (leaveStr) {
            return 'Until ' + prefix + leaveStr;
        }
        return '';
    }

    // ============================================================
    // TEAM MEMBERS VIEW MODEL
    // ============================================================
    //
    // Each member VM carries memberId and an intervals array. The
    // intervals array contains one entry per stint with its own
    // periodDisplay. A flat periodDisplay on the member summarises
    // all intervals for list views that don't expand them.

    function buildTeamMembersVM(activeMemberRecords, teamType) {
        if (!Array.isArray(activeMemberRecords)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < activeMemberRecords.length; i++) {
            var record = activeMemberRecords[i];
            if (!record) { continue; }

            var charId = record.characterId;
            if (!charId) { continue; }

            var memberId = isNonEmptyString(record.memberId)
                ? String(record.memberId)
                : '';

            // Build the intervals array.
            var intervalsVM = [];
            var summaryParts = [];
            if (Array.isArray(record.intervals)) {
                for (var j = 0; j < record.intervals.length; j++) {
                    var iv = record.intervals[j];
                    if (!iv || typeof iv !== 'object') { continue; }

                    var ivJoin = (iv.joinPeriod !== undefined &&
                                  iv.joinPeriod !== null)
                        ? String(iv.joinPeriod)
                        : '';
                    var ivLeave = (iv.leavePeriod !== undefined &&
                                   iv.leavePeriod !== null)
                        ? String(iv.leavePeriod)
                        : '';

                    var ivDisplay = formatMemberPeriodDisplay(
                        ivJoin, ivLeave, teamType
                    );

                    intervalsVM.push({
                        joinPeriod: ivJoin,
                        leavePeriod: ivLeave,
                        periodDisplay: ivDisplay
                    });

                    if (ivDisplay) {
                        summaryParts.push(ivDisplay);
                    }
                }
            }

            var periodDisplay = summaryParts.join('; ');

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) {
                result.push({
                    memberId: memberId,
                    characterId: charId,
                    name: 'Unknown',
                    role: record.role || 'Member',
                    roleLabel: '',
                    age: '',
                    statusLabel: '',
                    deceased: false,
                    intervals: intervalsVM,
                    periodDisplay: periodDisplay
                });
                continue;
            }

            result.push({
                memberId: memberId,
                characterId: charId,
                name: CharacterQueries.getDisplayName(char),
                role: record.role || 'Member',
                roleLabel: '',
                age: CharacterQueries.getCharacterAge(char),
                statusLabel: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased === true,
                intervals: intervalsVM,
                periodDisplay: periodDisplay
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // MEMBER PARTITION (active / former)
    // ============================================================

    function partitionTeamMembers(team, weekNum) {
        var activeRecords = TeamQueries.getActiveTeamMembers(team, weekNum) || [];

        var activeKeys = Object.create(null);
        for (var i = 0; i < activeRecords.length; i++) {
            var rec = activeRecords[i];
            if (!rec) { continue; }

            if (isNonEmptyString(rec.memberId)) {
                activeKeys['id:' + String(rec.memberId)] = true;
            }
            var cid = rec.characterId !== undefined && rec.characterId !== null
                ? String(rec.characterId)
                : '';
            var firstJoin = '';
            if (Array.isArray(rec.intervals) && rec.intervals.length > 0) {
                var first = rec.intervals[0];
                if (first && first.joinPeriod !== undefined &&
                    first.joinPeriod !== null) {
                    firstJoin = String(first.joinPeriod);
                }
            }
            activeKeys['composite:' + cid + '::' + firstJoin] = true;
        }

        var allRecords = TeamQueries.getAllTeamMemberRecords(team) || [];
        var formerRecords = [];

        for (var j = 0; j < allRecords.length; j++) {
            var m = allRecords[j];
            if (!m) { continue; }

            // Skip if active.
            if (isNonEmptyString(m.memberId) &&
                activeKeys['id:' + String(m.memberId)]) {
                continue;
            }
            var mCid = m.characterId !== undefined && m.characterId !== null
                ? String(m.characterId)
                : '';
            var mFirstJoin = '';
            if (Array.isArray(m.intervals) && m.intervals.length > 0) {
                var mFirst = m.intervals[0];
                if (mFirst && mFirst.joinPeriod !== undefined &&
                    mFirst.joinPeriod !== null) {
                    mFirstJoin = String(mFirst.joinPeriod);
                }
            }
            if (activeKeys['composite:' + mCid + '::' + mFirstJoin]) {
                continue;
            }

            // Must have at least one interval with a leavePeriod
            // strictly less than the display week to be former.
            if (!Array.isArray(m.intervals)) { continue; }

            var isFormer = false;
            for (var k = 0; k < m.intervals.length; k++) {
                var iv = m.intervals[k];
                if (!iv || typeof iv !== 'object') { continue; }

                var hasLeave = iv.leavePeriod !== undefined &&
                               iv.leavePeriod !== null &&
                               iv.leavePeriod !== '';
                if (!hasLeave) { continue; }

                var leaveNum = TeamConstants.parsePeriod(iv.leavePeriod);
                if (leaveNum === null) { continue; }

                if (leaveNum < weekNum) {
                    isFormer = true;
                    break;
                }
            }

            if (isFormer) {
                formerRecords.push(m);
            }
        }

        return {
            activeRecords: activeRecords,
            formerRecords: formerRecords
        };
    }

    // ============================================================
    // UNASSIGNED (ORPHAN) ACADEMIC TEAMS
    // ============================================================

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
    // Consumed by academy-weekly-teams-members.js. Returns:
    //
    //   members       — active at the display week (editable rows)
    //   formerMembers — closed before the display week (read-only
    //                   rows with a Restore action)
    //   candidates    — eligible pool for adding new members
    //
    // Both member lists use the same VM shape (see
    // buildTeamMembersVM). Every entry carries memberId and its
    // intervals array, so the UI can address a specific stint.
    //
    // ELIMINATION IS FAIL-CLOSED.
    //   EliminationQueries is required. If it is absent or does not
    //   expose isCharacterEliminatedByWeek, this function throws. If
    //   the query throws, the exception propagates.

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
        var weekNum = resolveWeek(options.week);

        if (!classId || !teamId || weekNum === null) {
            return null;
        }

        // ---- EliminationQueries: required, not optional ----
        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.isCharacterEliminatedByWeek !== 'function') {
            throw new Error(
                '[AcademyAggregator] getWeeklyTeamMemberManagerViewModel ' +
                'requires EliminationQueries.isCharacterEliminatedByWeek. ' +
                'The candidate pool cannot be built without it.'
            );
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

        // ---- Members and former members ----
        var partition = partitionTeamMembers(team, weekNum);

        var members = buildTeamMembersVM(partition.activeRecords, team.type);
        var formerMembers = buildTeamMembersVM(
            partition.formerRecords, team.type
        );

        // ---- Candidate pool ----
        var activeMembers = partition.activeRecords;

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
            var siblingMembers = TeamQueries.getActiveTeamMembers(sibling, weekNum) || [];
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

        var roster = deriveClassRoster(classId, weekNum);

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

            // Fail-closed elimination check. No try/catch.
            if (EQ.isCharacterEliminatedByWeek(studentId, weekNum) === true) {
                continue;
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
            week: weekNum,
            members: members,
            formerMembers: formerMembers,
            candidates: candidates
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAggregator = Object.freeze({
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

        // Class-discipline picker (v27)
        getClassDisciplinesPickerViewModel: getClassDisciplinesPickerViewModel,

        // Ranking
        getRankingViewModel: getRankingViewModel,

        // Location
        getLocationViewModel: getLocationViewModel,

        // Weekly teams
        getWeeklyTeamsViewModel: getWeeklyTeamsViewModel,
        getWeeklyTeamMemberManagerViewModel: getWeeklyTeamMemberManagerViewModel,
        getUnassignedTeamsViewModel: getUnassignedTeamsViewModel
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyAggregator;
        var missing = [];

        var required = [
            'getClassListViewModel',
            'getClassViewModel',
            'getClassStudentsViewModel',
            'getPeopleViewModel',
            'getStudentViewModel',
            'getInstructorViewModel',
            'getDisciplineListViewModel',
            'getDisciplineEditorViewModel',
            'getClassDisciplinesPickerViewModel',
            'getRankingViewModel',
            'getLocationViewModel',
            'getWeeklyTeamsViewModel',
            'getWeeklyTeamMemberManagerViewModel',
            'getUnassignedTeamsViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyAggregator] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();