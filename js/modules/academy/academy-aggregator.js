/**
 * modules/academy/academy-aggregator.js - Academy Aggregator
 * Cross-domain projection builder for the Academy domain
 * 
 * This module provides:
 *   - getClassViewModel - Class detail with students, teams, rankings
 *   - getStudentViewModel - Student detail with grades, ranking, schedule
 *   - getInstructorViewModel - Instructor detail with schedule, groups
 *   - getClassListViewModel - Class list with student and team counts
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes AcademyQueries + CharacterQueries + TeamQueries + CalendarQueries
 *   - Returns Academy-shaped view models
 *   - Never exposes external query APIs directly
 *   - Never mutates data
 *   - No UI dependencies
 *   - No passthrough methods
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from shared/queries/academy-queries.js) - MANDATORY
 *   - window.CharacterQueries (from shared/queries/character-queries.js) - MANDATORY
 *   - window.TeamQueries (from shared/queries/team-queries.js) - MANDATORY
 *   - window.CalendarQueries (from shared/queries/calendar-queries.js) - MANDATORY
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var vm = AcademyAggregator.getClassViewModel('class_123', { week: 5 });
 *   var list = AcademyAggregator.getClassListViewModel({ week: 5 });
 *   var student = AcademyAggregator.getStudentViewModel('char_456', { week: 5 });
 */

(function() {
    'use strict';

    if (window.__academyAggregatorLoaded) {
        return;
    }
    window.__academyAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarQueries = window.CalendarQueries;
    var TeamConstants = window.TeamConstants;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getStudentGrades !== 'function') {
            missing.push('AcademyQueries.getStudentGrades');
        }
        if (!AcademyQueries || typeof AcademyQueries.calculateClassRanking !== 'function') {
            missing.push('AcademyQueries.calculateClassRanking');
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

        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            missing.push('TeamQueries.getTeamsByClass');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }

        if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
            missing.push('CalendarQueries.getStudentSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getStudentClasses !== 'function') {
            missing.push('CalendarQueries.getStudentClasses');
        }

        if (!TeamConstants || typeof TeamConstants.getTypeLabel !== 'function') {
            missing.push('TeamConstants.getTypeLabel');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            console.warn('[AcademyAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_WEEK = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurrentWeek() {
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= MIN_WEEK && week <= MAX_WEEK) {
            return week;
        }
        return DEFAULT_WEEK;
    }

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
        return char.deceased || false;
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

    function getTeamPeriodBounds(type) {
        return TeamConstants.getPeriodBounds(type);
    }

    // ============================================================
    // CLASS VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for a class.
     * Combines class data with students, teams, and rankings.
     * 
     * @param {string} classId - Class ID
     * @param {object} options - Options
     * @param {number} options.week - Week number (default: current)
     * @param {boolean} options.includeStudents - Include student details (default: true)
     * @param {boolean} options.includeTeams - Include team details (default: true)
     * @param {boolean} options.includeRankings - Include ranking details (default: true)
     * @param {boolean} options.includeGrades - Include grade summaries (default: false)
     * @returns {object|null} Class view model or null
     */
    function getClassViewModel(classId, options) {
        if (!classId) {
            return null;
        }

        options = options || {};
        var week = options.week || getCurrentWeek();
        var includeStudents = options.includeStudents !== false;
        var includeTeams = options.includeTeams !== false;
        var includeRankings = options.includeRankings !== false;
        var includeGrades = options.includeGrades === true;

        var cls = AcademyQueries.getClass(classId);
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

        // ---- Students ----
        if (includeStudents) {
            var studentIds = AcademyQueries.getClassStudents(classId);
            var students = [];
            var enrolledCount = studentIds.length;

            for (var i = 0; i < studentIds.length; i++) {
                var char = CharacterQueries.getCharacterById(studentIds[i]);
                if (char) {
                    students.push({
                        id: char.id,
                        name: CharacterQueries.getDisplayName(char),
                        status: CharacterQueries.getCurrentStatus(char),
                        age: CharacterQueries.getCharacterAge(char),
                        deceased: char.deceased || false,
                        classIds: char.classIds || []
                    });
                }
            }

            // Sort by name
            students.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            viewModel.students = students;
            viewModel.studentCount = students.length;
            viewModel.enrolledCount = enrolledCount;

            // ---- Grades ----
            if (includeGrades) {
                var gradeSummaries = [];
                for (var j = 0; j < students.length; j++) {
                    var grades = AcademyQueries.getStudentGrades(students[j].id, week);
                    var summary = AcademyQueries.calculateGradeSummary(grades);
                    gradeSummaries.push({
                        studentId: students[j].id,
                        studentName: students[j].name,
                        gradeCount: grades.length,
                        average: summary.average,
                        passing: summary.passing,
                        failing: summary.failing,
                        passRate: summary.passRate
                    });
                }
                viewModel.gradeSummaries = gradeSummaries;
            }
        }

        // ---- Teams ----
        if (includeTeams) {
            var teams = TeamQueries.getTeamsByClass(classId);

            var teamViewModels = teams.map(function(team) {
                var members = TeamQueries.getActiveTeamMembers(team, week);
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
                    periodDisplay: TeamQueries.getTeamPeriodDisplay(team)
                };
            });

            viewModel.teams = teamViewModels;
            viewModel.teamCount = teamViewModels.length;
        }

        // ---- Rankings ----
        if (includeRankings) {
            var rankingData = AcademyQueries.calculateClassRanking(classId, week);

            var rankingViewModels = rankingData.map(function(entry) {
                return {
                    studentId: entry.studentId,
                    studentName: entry.name || getCharacterDisplayName(entry.studentId),
                    rank: entry.rank,
                    average: entry.average,
                    gradeCount: entry.gradeCount || 0
                };
            });

            viewModel.rankings = rankingViewModels;
            viewModel.rankingCount = rankingViewModels.length;
            viewModel.rankingWeek = week;
        }

        return viewModel;
    }

    // ============================================================
    // STUDENT VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for a student.
     * Combines student data with grades, ranking, and schedule.
     * 
     * @param {string} studentId - Student ID
     * @param {object} options - Options
     * @param {number} options.week - Week number (default: current)
     * @param {boolean} options.includeGrades - Include grades (default: true)
     * @param {boolean} options.includeRanking - Include ranking (default: true)
     * @param {boolean} options.includeSchedule - Include schedule (default: true)
     * @param {boolean} options.includeClasses - Include classes (default: true)
     * @returns {object|null} Student view model or null
     */
    function getStudentViewModel(studentId, options) {
        if (!studentId) {
            return null;
        }

        options = options || {};
        var week = options.week || getCurrentWeek();
        var includeGrades = options.includeGrades !== false;
        var includeRanking = options.includeRanking !== false;
        var includeSchedule = options.includeSchedule !== false;
        var includeClasses = options.includeClasses !== false;

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var viewModel = {
            id: student.id,
            name: CharacterQueries.getDisplayName(student),
            fullName: CharacterQueries.getFullName(student),
            status: CharacterQueries.getCurrentStatus(student),
            age: CharacterQueries.getCharacterAge(student),
            deceased: student.deceased || false,
            birthYear: student.birthYear || '',
            gender: student.gender || '',
            week: week
        };

        // ---- Classes ----
        if (includeClasses) {
            var classes = AcademyQueries.getCharacterClasses(student);
            viewModel.classes = classes.map(function(cls) {
                return {
                    id: cls.id,
                    name: cls.name,
                    status: cls.status || 'active'
                };
            });
            viewModel.classNames = classes.map(function(cls) {
                return cls.name;
            });
            viewModel.classCount = classes.length;
        }

        // ---- Grades ----
        if (includeGrades) {
            var grades = AcademyQueries.getStudentGrades(studentId, week);
            var gradeSummary = AcademyQueries.calculateGradeSummary(grades);
            var gpa = AcademyQueries.calculateStudentGPA(studentId, week);

            viewModel.grades = grades.map(function(g) {
                return {
                    disciplineId: g.disciplineId,
                    disciplineName: g.disciplineName || 'Unknown',
                    week: g.week,
                    score: g.score,
                    maxScore: g.maxScore || 100,
                    percentage: g.percentage || 0,
                    passing: g.passing || false,
                    type: g.type || 'assignment',
                    weight: g.weight || 1.0,
                    notes: g.notes || ''
                };
            });

            viewModel.gradeCount = grades.length;
            viewModel.gradeSummary = {
                average: gradeSummary.average,
                weightedAverage: gradeSummary.weightedAverage,
                passRate: gradeSummary.passRate,
                passing: gradeSummary.passing,
                failing: gradeSummary.failing
            };
            viewModel.gpa = gpa;
        }

        // ---- Ranking ----
        if (includeRanking) {
            // Find which class this student belongs to
            var studentClasses = AcademyQueries.getCharacterClasses(student);
            var ranking = null;
            var classRanking = null;

            for (var i = 0; i < studentClasses.length; i++) {
                var cls = studentClasses[i];
                var classRankings = AcademyQueries.calculateClassRanking(cls.id, week);
                for (var j = 0; j < classRankings.length; j++) {
                    if (String(classRankings[j].studentId) === String(studentId)) {
                        ranking = classRankings[j];
                        classRanking = {
                            classId: cls.id,
                            className: cls.name,
                            totalStudents: classRankings.length
                        };
                        break;
                    }
                }
                if (ranking) {
                    break;
                }
            }

            viewModel.ranking = ranking ? {
                rank: ranking.rank,
                average: ranking.average,
                gradeCount: ranking.gradeCount || 0,
                classId: classRanking ? classRanking.classId : null,
                className: classRanking ? classRanking.className : null,
                totalStudents: classRanking ? classRanking.totalStudents : 0
            } : null;
        }

        // ---- Schedule ----
        if (includeSchedule) {
            var schedule = CalendarQueries.getStudentSchedule(studentId, week);
            var classes = CalendarQueries.getStudentClasses(studentId, week);

            var scheduleEntries = [];
            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                    continue;
                }
                var dayNum = parseInt(day, 10);
                if (isNaN(dayNum)) {
                    continue;
                }
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var hourNum = parseInt(hour, 10);
                    if (isNaN(hourNum)) {
                        continue;
                    }
                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) {
                        continue;
                    }

                    var details = null;
                    for (var k = 0; k < classes.length; k++) {
                        if (classes[k].day === dayNum && classes[k].hour === hourNum) {
                            details = classes[k];
                            break;
                        }
                    }

                    scheduleEntries.push({
                        day: dayNum,
                        hour: hourNum,
                        disciplineId: disciplineId,
                        disciplineName: details ? details.disciplineName : 'Unknown',
                        duration: details ? details.duration || 1 : 1,
                        label: details ? details.label || '' : '',
                        groupLabel: details ? details.groupLabel || '' : '',
                        instructorId: details ? details.instructorId : null,
                        instructorName: details ? details.instructorName : ''
                    });
                }
            }

            scheduleEntries.sort(function(a, b) {
                if (a.day !== b.day) {
                    return a.day - b.day;
                }
                return a.hour - b.hour;
            });

            viewModel.schedule = scheduleEntries;
            viewModel.scheduleCount = scheduleEntries.length;
            viewModel.scheduleWeek = week;
        }

        return viewModel;
    }

    // ============================================================
    // INSTRUCTOR VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for an instructor.
     * Combines instructor data with schedule and groups.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {object} options - Options
     * @param {number} options.week - Week number (default: current)
     * @param {boolean} options.includeSchedule - Include schedule (default: true)
     * @param {boolean} options.includeGroups - Include auto-groups (default: false)
     * @returns {object|null} Instructor view model or null
     */
    function getInstructorViewModel(instructorId, options) {
        if (!instructorId) {
            return null;
        }

        options = options || {};
        var week = options.week || getCurrentWeek();
        var includeSchedule = options.includeSchedule !== false;
        var includeGroups = options.includeGroups === true;

        var instructor = CharacterQueries.getCharacterById(instructorId);
        if (!instructor) {
            return null;
        }

        var viewModel = {
            id: instructor.id,
            name: CharacterQueries.getDisplayName(instructor),
            fullName: CharacterQueries.getFullName(instructor),
            status: CharacterQueries.getCurrentStatus(instructor),
            age: CharacterQueries.getCharacterAge(instructor),
            deceased: instructor.deceased || false,
            week: week
        };

        // ---- Schedule ----
        if (includeSchedule) {
            // Get instructor schedule via CalendarQueries
            var schedule = CalendarQueries.getInstructorSchedule ? 
                CalendarQueries.getInstructorSchedule(instructorId, week) : {};

            var scheduleEntries = [];
            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                    continue;
                }
                var dayNum = parseInt(day, 10);
                if (isNaN(dayNum)) {
                    continue;
                }
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var hourNum = parseInt(hour, 10);
                    if (isNaN(hourNum)) {
                        continue;
                    }
                    var slot = daySchedule[hour];
                    if (!slot) {
                        continue;
                    }

                    scheduleEntries.push({
                        day: dayNum,
                        hour: hourNum,
                        disciplineId: slot.disciplineId || null,
                        disciplineName: slot.disciplineName || 'Unknown',
                        duration: slot.duration || 1,
                        label: slot.label || '',
                        groupLabel: slot.groupLabel || '',
                        students: slot.students ? slot.students.length : 0
                    });
                }
            }

            scheduleEntries.sort(function(a, b) {
                if (a.day !== b.day) {
                    return a.day - b.day;
                }
                return a.hour - b.hour;
            });

            viewModel.schedule = scheduleEntries;
            viewModel.scheduleCount = scheduleEntries.length;
            viewModel.scheduleWeek = week;
        }

        // ---- Auto-Groups ----
        if (includeGroups) {
            // Try to get auto-groups from AcademyGroups if available
            var groups = [];
            if (window.AcademyGroups && typeof window.AcademyGroups.getGroupsByInstructor === 'function') {
                var groupData = window.AcademyGroups.getGroupsByInstructor(instructorId);
                for (var key in groupData) {
                    if (Object.prototype.hasOwnProperty.call(groupData, key)) {
                        var group = groupData[key];
                        groups.push({
                            key: key,
                            disciplineId: group.disciplineId || null,
                            disciplineName: group.disciplineName || 'Unknown',
                            students: group.students || [],
                            studentCount: (group.students || []).length,
                            slots: group.slots || [],
                            slotCount: (group.slots || []).length
                        });
                    }
                }
            }

            viewModel.groups = groups;
            viewModel.groupCount = groups.length;
        }

        return viewModel;
    }

    // ============================================================
    // CLASS LIST VIEW MODEL
    // ============================================================

    /**
     * Get a view model for a list of classes.
     * Collection-level projection with student and team counts.
     * 
     * @param {object} options - Options
     * @param {string} options.status - Status filter ('active', 'archived', 'graduated')
     * @param {number} options.week - Week number (default: current)
     * @param {string} options.search - Search by name
     * @param {string} options.sort - Sort field ('name', 'studentCount', 'teamCount')
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @returns {object} { classes: Array, total: number, filtered: number }
     */
    function getClassListViewModel(options) {
        options = options || {};
        var status = options.status || null;
        var week = options.week || getCurrentWeek();
        var search = options.search || '';
        var sort = options.sort || 'name';
        var sortDirection = options.sortDirection || 'asc';

        // Get classes from AcademyQueries
        var classes = AcademyQueries.getClasses(status);

        // Apply search filter
        if (search) {
            var lowerSearch = search.toLowerCase();
            classes = classes.filter(function(cls) {
                return cls.name && cls.name.toLowerCase().indexOf(lowerSearch) !== -1;
            });
        }

        // Build list items
        var listItems = classes.map(function(cls) {
            var studentCount = AcademyQueries.getClassStudents(cls.id).length;
            var teams = TeamQueries.getTeamsByClass(cls.id);
            var teamCount = teams.length;

            return {
                id: cls.id,
                name: cls.name,
                status: cls.status || 'active',
                year: cls.year || null,
                studentCount: studentCount,
                teamCount: teamCount,
                instructorId: cls.instructorId || null,
                instructorName: cls.instructorId ? getCharacterDisplayName(cls.instructorId) : 'Not assigned',
                createdAt: cls.createdAt || '',
                _class: cls
            };
        });

        // Sort
        var total = listItems.length;

        listItems.sort(function(a, b) {
            var aVal, bVal;

            switch (sort) {
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'studentCount':
                    aVal = a.studentCount;
                    bVal = b.studentCount;
                    break;
                case 'teamCount':
                    aVal = a.teamCount;
                    bVal = b.teamCount;
                    break;
                case 'status':
                    var statusOrder = { 'active': 0, 'archived': 1, 'graduated': 2 };
                    aVal = statusOrder[a.status] || 999;
                    bVal = statusOrder[b.status] || 999;
                    break;
                default:
                    aVal = a.name || '';
                    bVal = b.name || '';
            }

            if (typeof aVal === 'string') {
                var result = aVal.localeCompare(bVal);
                return sortDirection === 'desc' ? -result : result;
            }

            if (aVal < bVal) {
                return sortDirection === 'desc' ? 1 : -1;
            }
            if (aVal > bVal) {
                return sortDirection === 'desc' ? -1 : 1;
            }
            return 0;
        });

        return {
            classes: listItems,
            total: total,
            filtered: listItems.length
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAggregator = {
        // Projections
        getClassViewModel: getClassViewModel,
        getStudentViewModel: getStudentViewModel,
        getInstructorViewModel: getInstructorViewModel,
        getClassListViewModel: getClassListViewModel
    };

})();