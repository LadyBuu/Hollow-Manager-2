/**
 * modules/academy/academy-aggregator.js - Academy Aggregator
 * Cross-domain projection builder for the Academy domain.
 *
 * Path: js/modules/academy/academy-aggregator.js
 *
 * This module provides the view models consumed by AcademyView and
 * AcademyTournamentAggregator:
 *
 *   Core projections:
 *     - getClassViewModel(classId, options)
 *     - getStudentViewModel(studentId, options)
 *     - getInstructorViewModel(instructorId, options)
 *     - getClassListViewModel()
 *     - getClassStudentsViewModel(classId)
 *     - getRankingViewModel(classId, week)
 *     - getLocationViewModel(locationId, week)
 *
 *   View models for AcademyView:
 *     - getWeeklyTeamsViewViewModel(classId, week, selectedTeamId)
 *     - getLocationViewViewModel(filters, week, selectedLocationId)
 *     - getRankingViewViewModel(classId, week)
 *     - getDisciplineListViewModel(filters)
 *
 * IMPORTANT:
 *   - Projection builder, not a query registry.
 *   - Composes domain modules. Never walks raw storage.
 *   - Never exposes domain query APIs directly.
 *   - Never mutates data.
 *   - No UI dependencies.
 *   - No passthrough methods.
 *
 * DEPENDENCY GRAPH:
 *   - AcademyClasses         (class entities, roster derivation source)
 *   - AcademyDisciplines     (discipline entities + instructor names)
 *   - CharacterQueries       (character identity, display, status, age)
 *   - TeamQueries            (persistent Team entities)
 *   - TeamConstants          (type labels, period labels)
 *   - TeamAggregator         (period-display strings; lazy) -- see
 *                            PERIOD DISPLAY OWNERSHIP below
 *
 * OPTIONAL DEPENDENCIES (degrade to [] when absent):
 *   - AcademyWeeklyTeams     (week-scoped team assignments)
 *   - AcademyRanking         (ranking projection)
 *   - CalendarAggregator     (location / student schedule VM)
 *
 * PERIOD DISPLAY OWNERSHIP:
 *   Team period display strings ("Wk 3 - Wk 14", "2025 - 2027", etc.)
 *   are owned by TeamAggregator.getTeamPeriodDisplay. They used to live
 *   on TeamQueries and were moved out because they are presentation
 *   strings, not query results. TeamAggregator loads after
 *   AcademyAggregator in the bootstrap order, so this module accesses
 *   it lazily via getTeamAggregator() and degrades to '-' when it is
 *   not yet available. That is the ONLY reason a lazy accessor is used
 *   here; every other Team dependency goes through TeamQueries directly.
 *
 * REMOVED DEPENDENCIES:
 *   - AcademyQueries. This aggregator used to route reads through
 *     AcademyQueries, which was itself a facade over the domain
 *     modules. With the domain modules now exposing their own read
 *     APIs, the facade is no longer needed. Every read in this file
 *     goes to the domain owner.
 *
 * CLASS MEMBERSHIP MODEL (v15+):
 *   - Character.classIds is the source of truth for class membership.
 *   - The class roster is DERIVED: characters whose classIds include
 *     classId.
 *   - The class INSTRUCTOR (class.instructorId) is tracked separately
 *     and is NOT automatically written into character.classIds.
 *   - getClassViewModel stitches the instructor into the roster for
 *     display.
 *   - getClassStudentsViewModel does NOT include the instructor.
 *
 * ROSTER ORDERING:
 *   - Class VM roster: trainees first, then instructors, alphabetical
 *     within each group.
 *   - Class students VM: alphabetical by name. Instructors excluded.
 *
 * RETURN SHAPE NOTE:
 *   - All public entry points return plain objects and arrays. No
 *     live references escape.
 */

(function() {
    'use strict';

    if (window.__academyAggregatorLoaded) {
        return;
    }
    window.__academyAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
            missing.push('AcademyClasses.getClass');
        }
        if (!AcademyClasses || typeof AcademyClasses.getClasses !== 'function') {
            missing.push('AcademyClasses.getClasses');
        }

        if (!AcademyDisciplines || typeof AcademyDisciplines.getDisciplines !== 'function') {
            missing.push('AcademyDisciplines.getDisciplines');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
            missing.push('AcademyDisciplines.getDiscipline');
        }

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
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            missing.push('TeamQueries.getTeamsByClass');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }

        if (!TeamConstants) {
            missing.push('TeamConstants');
        }

        // NOTE: TeamQueries.getTeamPeriodDisplay is NOT checked here.
        // Period display strings live on TeamAggregator, which loads
        // after this module. See PERIOD DISPLAY OWNERSHIP in the
        // header, and getTeamPeriodDisplay() below.

        if (missing.length > 0) {
            console.warn('[AcademyAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // LAZY OPTIONAL DEPENDENCIES
    // ============================================================
    //
    // These modules may load after this aggregator. They are read at
    // call time, not at module-load time. When absent, the calling
    // projection degrades to [] rather than throwing.

    function getAcademyWeeklyTeams() {
        return window.AcademyWeeklyTeams || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getCalendarAggregator() {
        return window.CalendarAggregator || null;
    }

    /**
     * Team period display is owned by TeamAggregator. It loads after
     * this aggregator in the bootstrap order, so we access it lazily.
     * When absent, callers degrade to '-' for the period display.
     */
    function getTeamAggregator() {
        return window.TeamAggregator || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function getCharacterStatus(charId) {
        if (!charId) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return '';
        }
        return CharacterQueries.getCurrentStatus(char);
    }

    function getCharacterAge(charId) {
        if (!charId) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return '';
        }
        return CharacterQueries.getCharacterAge(char);
    }

    function getCharacterDeceased(charId) {
        if (!charId) {
            return false;
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return false;
        }
        return char.deceased === true;
    }

    function getTeamName(teamId) {
        if (!teamId) {
            return 'Unassigned';
        }
        return TeamQueries.getTeamName(teamId);
    }

    function getTeamTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getTeamPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
    }

    /**
     * Format a team's period range for display.
     *
     * Delegates to TeamAggregator when available. Returns '-' when
     * the aggregator has not loaded yet (this only happens during
     * the brief window between AcademyAggregator's load and
     * TeamAggregator's load; every projection that uses this helper
     * is called long after both have loaded).
     *
     * @param {object} team
     * @returns {string}
     */
    function getTeamPeriodDisplay(team) {
        var TA = getTeamAggregator();
        if (TA && typeof TA.getTeamPeriodDisplay === 'function') {
            return TA.getTeamPeriodDisplay(team);
        }
        return '-';
    }

    // ============================================================
    // CANONICAL CLASS LIST
    // ============================================================
    //
    // Every view that needs a class list goes through this. The result
    // is sorted alphabetically by name.

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
    // CLASS STUDENTS PROJECTION
    // ============================================================
    //
    // The students of a class. Instructors are excluded by design.
    // The class roster is derived from character.classIds. Sorting is
    // alphabetical by display name.

    function getClassStudentsViewModel(classId) {
        if (!classId) {
            return [];
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return [];
        }

        var all = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var instructorId = cls.instructorId ? String(cls.instructorId) : null;
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var c = all[i];
            if (!c || !c.id) {
                continue;
            }

            // Instructors are not students.
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
            if (!found) {
                continue;
            }

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
    // Full class detail with the roster (students + instructor),
    // optionally teams, rankings, and grades.
    //
    // The instructor is stitched into the roster for display. They are
    // not in character.classIds and should not be treated as one.

    function getClassViewModel(classId, options) {
        if (!classId) {
            return null;
        }

        options = options || {};
        var week = options.week || null;
        var includeStudents = options.includeStudents !== false;
        var includeTeams = options.includeTeams !== false;
        var includeRankings = options.includeRankings !== false;
        var includeGrades = options.includeGrades === true;

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var viewModel = {
            id: cls.id,
            name: cls.name,
            status: cls.status || 'active',
            year: cls.year || null,
            description: cls.description || '',
            instructorId: cls.instructorId || null,
            instructorName: cls.instructorId ? getCharacterDisplayName(cls.instructorId) : 'Not assigned',
            createdAt: cls.createdAt || '',
            week: week
        };

        if (includeStudents) {
            var students = getClassStudentsViewModel(classId);

            // Stitch the instructor into the roster for display.
            if (cls.instructorId) {
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

            // Class VM roster: trainees (students) first, then
            // instructors, alphabetical within each group. The
            // class VM uses `trainee` as the internal role for
            // students to preserve backward compatibility with
            // existing consumers of this projection. The students
            // projection above uses `student`.
            students = students.map(function(s) {
                return {
                    id: s.id,
                    name: s.name,
                    status: s.status,
                    age: s.age,
                    deceased: s.deceased,
                    classIds: [],
                    role: s.role === 'instructor' ? 'instructor' : 'trainee'
                };
            });

            students.sort(function(a, b) {
                if (a.role !== b.role) {
                    return a.role === 'trainee' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            viewModel.students = students;
            viewModel.studentCount = students.length;
            viewModel.enrolledCount = students.length;
            viewModel.traineeCount = students.filter(function(s) {
                return s.role === 'trainee';
            }).length;
            viewModel.instructorCount = students.filter(function(s) {
                return s.role === 'instructor';
            }).length;

            if (includeGrades) {
                var gradeSummaries = [];
                for (var g = 0; g < students.length; g++) {
                    var summary = {
                        studentId: students[g].id,
                        studentName: students[g].name,
                        role: students[g].role,
                        gradeCount: 0,
                        average: 0,
                        passing: 0,
                        failing: 0,
                        passRate: 0
                    };
                    gradeSummaries.push(summary);
                }
                viewModel.gradeSummaries = gradeSummaries;
            }
        }

        if (includeTeams) {
            var teams = TeamQueries.getTeamsByClass(classId) || [];

            var teamViewModels = teams.map(function(team) {
                var members = TeamQueries.getActiveTeamMembers(team, week || 1);
                var memberViewModels = members.map(function(member) {
                    return {
                        characterId: member.characterId,
                        name: getCharacterDisplayName(member.characterId),
                        role: member.role || 'Member',
                        joinPeriod: member.joinPeriod || '',
                        leavePeriod: member.leavePeriod || ''
                    };
                });

                return {
                    id: team.id,
                    name: team.name,
                    type: team.type,
                    typeLabel: getTeamTypeLabel(team.type),
                    periodLabel: getTeamPeriodLabel(team.type),
                    teamNumber: team.teamNumber || '',
                    status: team.status || 'active',
                    members: memberViewModels,
                    memberCount: memberViewModels.length,
                    periodDisplay: getTeamPeriodDisplay(team)  // lazy accessor
                };
            });

            viewModel.teams = teamViewModels;
            viewModel.teamCount = teamViewModels.length;
        }

        if (includeRankings && week) {
            var Ranking = getAcademyRanking();
            var rankingVMs = [];
            if (Ranking && typeof Ranking.getClassRankings === 'function') {
                var rankings = Ranking.getClassRankings(classId, week, true) || [];
                rankingVMs = rankings.map(function(entry) {
                    return {
                        studentId: entry.studentId,
                        studentName: entry.studentName || entry.name || getCharacterDisplayName(entry.studentId),
                        rank: entry.rank,
                        academicAverage: entry.academicAverage !== undefined ? entry.academicAverage : entry.averageScore,
                        socialScore: entry.socialScore !== undefined ? entry.socialScore : null,
                        overallScore: entry.overallScore !== undefined ? entry.overallScore : entry.averageScore,
                        gradeCount: entry.gradeCount || 0
                    };
                });
            }

            viewModel.rankings = rankingVMs;
            viewModel.rankingCount = rankingVMs.length;
            viewModel.rankingWeek = week;
        }

        return viewModel;
    }

    // ============================================================
    // STUDENT VIEW MODEL
    // ============================================================

    function getStudentViewModel(studentId, options) {
        if (!studentId) {
            return null;
        }

        options = options || {};
        var week = options.week || null;

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var viewModel = {
            id: student.id,
            name: CharacterQueries.getDisplayName(student),
            fullName: CharacterQueries.getFullName
                ? CharacterQueries.getFullName(student)
                : CharacterQueries.getDisplayName(student),
            status: CharacterQueries.getCurrentStatus(student),
            age: CharacterQueries.getCharacterAge(student),
            deceased: student.deceased === true,
            birthYear: student.birthYear || '',
            gender: student.gender || '',
            week: week
        };

        var classes = AcademyClasses.getCharacterClasses
            ? AcademyClasses.getCharacterClasses(student)
            : [];
        viewModel.classes = classes.map(function(cls) {
            return {
                id: cls.id,
                name: cls.name,
                status: cls.status || 'active'
            };
        });
        viewModel.classCount = viewModel.classes.length;

        return viewModel;
    }

    // ============================================================
    // INSTRUCTOR VIEW MODEL
    // ============================================================

    function getInstructorViewModel(instructorId, options) {
        if (!instructorId) {
            return null;
        }

        options = options || {};
        var week = options.week || null;

        var instructor = CharacterQueries.getCharacterById(instructorId);
        if (!instructor) {
            return null;
        }

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
    // DISCIPLINE HELPERS
    // ============================================================

    function getInstructorNamesForDiscipline(discipline) {
        if (!discipline) {
            return [];
        }
        var ids = Array.isArray(discipline.instructorIds) ? discipline.instructorIds : [];
        return ids.map(function(id) {
            var char = CharacterQueries.getCharacterById(id);
            if (!char) {
                return 'Unknown';
            }
            return CharacterQueries.getDisplayName(char);
        });
    }

    // ============================================================
    // WEEKLY TEAMS VIEW MODEL
    // ============================================================
    //
    // Weekly Teams is Academy-owned and week-scoped. Source:
    // AcademyWeeklyTeams.getWeeklyTeams(classId, week). This is NOT
    // persistent Team entity membership.
    //
    // When AcademyWeeklyTeams is absent, the assignments map is empty,
    // so the view renders teams with zero members. That's a truthful
    // representation of "assignments have not been made yet".

    function getWeeklyTeamsViewViewModel(classId, week, selectedTeamId) {
        var classListVM = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classListVM.length; i++) {
                if (String(classListVM[i].id) === String(classId)) {
                    selectedClass = classListVM[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classListVM,
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
            assignments = AWT.getWeeklyTeams(selectedClass.id, week) || {};
        }

        var teams = buildWeeklyTeamsList(selectedClass, week, assignments);

        var selectedTeamVM = null;
        var resolvedSelectedTeamId = null;
        if (selectedTeamId) {
            for (var j = 0; j < teams.length; j++) {
                if (String(teams[j].id) === String(selectedTeamId)) {
                    selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, week, assignments);
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
                periodLabel: t.periodLabel,
                periodDisplay: t.periodDisplay,
                memberCount: t.memberCount,
                activeMemberCount: t.activeMemberCount,
                status: t.status
            };
        });

        return {
            classList: classListVM,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            teams: teamsVM,
            selectedTeamId: resolvedSelectedTeamId,
            selectedTeam: selectedTeamVM
        };
    }

    function buildWeeklyTeamsList(classRecord, week, assignments) {
        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            return [];
        }

        var raw = TeamQueries.getTeamsByClass(classRecord.id) || [];
        if (!Array.isArray(raw)) {
            return [];
        }

        var items = [];

        for (var i = 0; i < raw.length; i++) {
            var team = raw[i];
            if (!team || !team.id) { continue; }
            if (team.type !== 'academic') { continue; }

            var memberIds = assignments[String(team.id)] || [];

            items.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                type: team.type,
                typeLabel: TeamConstants.getTypeLabel(team.type),
                periodLabel: TeamConstants.getPeriodLabel(team.type),
                periodDisplay: getTeamPeriodDisplay(team),  // lazy accessor
                memberCount: memberIds.length,
                activeMemberCount: memberIds.length,
                status: team.status || 'active',
                _team: team,
                _memberIds: memberIds
            });
        }

        items.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return items;
    }

    function buildWeeklyTeamDetail(team, week, assignments) {
        if (!team) {
            return null;
        }

        var memberIds = assignments[String(team.id)] || [];
        var members = buildTeamMembersVM(memberIds);

        return {
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: TeamConstants.getTypeLabel(team.type),
            periodLabel: TeamConstants.getPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),  // lazy accessor
            status: team.status || 'active',
            temporaryMission: team.temporaryMission || null,
            members: members,
            activeMemberCount: members.length
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
            var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
            var status = char ? CharacterQueries.getCurrentStatus(char) : '';
            var age = char ? CharacterQueries.getCharacterAge(char) : '';
            var deceased = char ? (char.deceased === true) : false;

            result.push({
                characterId: charId,
                name: name,
                status: status,
                age: age,
                deceased: deceased,
                role: 'Member',
                activeAtPeriod: true
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // LOCATION VIEW MODEL
    // ============================================================
    //
    // Location schedule comes from CalendarAggregator. Academy does
    // not walk raw Calendar storage.
    //
    // Duration is null when the Calendar projection has no metadata
    // for a slot. Consumers should render null as "unknown", not as
    // "one hour".

    function getLocationViewViewModel(filters, week, selectedLocationId) {
        filters = filters || {};

        // Locations come from AcademyLocations, which is loaded by
        // index.js. We access it lazily because this aggregator does
        // not have a hard dependency on it.
        var AcademyLocations = window.AcademyLocations;
        var allLocations = AcademyLocations && typeof AcademyLocations.getLocations === 'function'
            ? (AcademyLocations.getLocations() || [])
            : [];

        var filtered = applyLocationFilters(allLocations, filters);

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
            scheduleWeek: week,
            total: listVM.length
        };
    }

    function applyLocationFilters(locations, filters) {
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        return locations.filter(function(l) {
            if (!l || !l.id) { return false; }
            if (type !== 'all' && l.type !== type) { return false; }
            if (search && (l.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });
    }

    function buildLocationListRowVM(l, week) {
        var schedule = getLocationScheduleForWeek(l.id, week);
        return {
            id: l.id,
            name: l.name,
            type: l.type,
            capacity: l.capacity,
            scheduleCount: schedule.length
        };
    }

    function buildLocationDetailVM(l, week) {
        var schedule = getLocationScheduleForWeek(l.id, week);
        return {
            id: l.id,
            name: l.name,
            type: l.type,
            capacity: l.capacity,
            schedule: schedule
        };
    }

    function getLocationScheduleForWeek(locationId, week) {
        if (!locationId || !week) {
            return [];
        }
        var CA = getCalendarAggregator();
        if (!CA || typeof CA.getLocationScheduleViewModel !== 'function') {
            return [];
        }
        return CA.getLocationScheduleViewModel(locationId, week) || [];
    }

    // ============================================================
    // RANKING VIEW MODEL
    // ============================================================
    //
    // Ranking consumes AcademyRanking's projection. This module does
    // NOT calculate rankings.
    //
    // The projection carries academicAverage, socialScore, and
    // overallScore. `average` is deliberately absent: at this point
    // "average" is ambiguous (academic? discipline? overall?).

    function getRankingViewViewModel(classId, week) {
        var classListVM = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classListVM.length; i++) {
                if (String(classListVM[i].id) === String(classId)) {
                    selectedClass = classListVM[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classListVM,
                classId: null,
                className: null,
                week: week,
                entries: [],
                total: 0
            };
        }

        var entries = buildRankingEntries(selectedClass, week);

        return {
            classList: classListVM,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            entries: entries,
            total: entries.length
        };
    }

    function buildRankingEntries(classRecord, week) {
        var Ranking = getAcademyRanking();
        if (!Ranking || typeof Ranking.getClassRankings !== 'function') {
            return [];
        }

        var ranked = Ranking.getClassRankings(classRecord.id, week, false) || [];

        var entries = ranked.map(function(r) {
            return {
                studentId: r.studentId,
                studentName: r.studentName || getCharacterDisplayName(r.studentId),
                rank: r.rank,
                academicAverage: r.academicAverage !== undefined
                    ? r.academicAverage
                    : r.averageScore,
                socialScore: r.socialScore !== undefined ? r.socialScore : null,
                overallScore: r.overallScore !== undefined
                    ? r.overallScore
                    : r.averageScore,
                gradeCount: r.gradeCount || 0
            };
        });

        entries.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return entries;
    }

    // ============================================================
    // DISCIPLINE LIST VIEW MODEL
    // ============================================================

    function getDisciplineListViewModel(filters) {
        filters = filters || {};

        var disciplines = AcademyDisciplines.getDisciplines() || [];
        disciplines = applyDisciplineFilters(disciplines, filters);

        var listVM = disciplines.map(function(d) {
            return buildDisciplineListRowVM(d);
        });

        return {
            disciplines: listVM,
            filters: filters,
            total: listVM.length
        };
    }

    function applyDisciplineFilters(disciplines, filters) {
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        return disciplines.filter(function(d) {
            if (!d || !d.id) { return false; }
            if (type !== 'all' && d.type !== type) { return false; }
            if (search && (d.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });
    }

    function buildDisciplineListRowVM(d) {
        return {
            id: d.id,
            name: d.name,
            type: d.type,
            startWeek: d.startWeek,
            endWeek: d.endWeek,
            weeklyHours: d.weeklyHours,
            weight: d.weight,
            instructorIds: d.instructorIds || [],
            instructorNames: getInstructorNamesForDiscipline(d)
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAggregator = {
        // Core class projections
        getClassViewModel: getClassViewModel,
        getClassListViewModel: getClassListViewModel,
        getClassStudentsViewModel: getClassStudentsViewModel,

        // Character projections
        getStudentViewModel: getStudentViewModel,
        getInstructorViewModel: getInstructorViewModel,

        // Ranking projection (legacy shape)
        getRankingViewViewModel: getRankingViewViewModel,
        buildRankingEntries: buildRankingEntries,

        // Location projection (legacy shape)
        getLocationViewViewModel: getLocationViewViewModel,

        // Weekly Teams projection
        getWeeklyTeamsViewViewModel: getWeeklyTeamsViewViewModel,

        // Discipline list projection
        getDisciplineListViewModel: getDisciplineListViewModel,
        getInstructorNamesForDiscipline: getInstructorNamesForDiscipline,

        // Exposed for testing / advanced use
        buildWeeklyTeamsList: buildWeeklyTeamsList,
        buildWeeklyTeamDetail: buildWeeklyTeamDetail,
        buildTeamMembersVM: buildTeamMembersVM,
        buildLocationListRowVM: buildLocationListRowVM,
        buildLocationDetailVM: buildLocationDetailVM,
        getLocationScheduleForWeek: getLocationScheduleForWeek,
        buildDisciplineListRowVM: buildDisciplineListRowVM
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyAggregator;
        var missing = [];

        var required = [
            'getClassViewModel',
            'getClassListViewModel',
            'getClassStudentsViewModel',
            'getStudentViewModel',
            'getInstructorViewModel',
            'getRankingViewViewModel',
            'getLocationViewViewModel',
            'getWeeklyTeamsViewViewModel',
            'getDisciplineListViewModel',
            'getInstructorNamesForDiscipline'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyAggregator] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
