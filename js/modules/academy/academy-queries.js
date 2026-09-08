/**
 * js/modules/academy/academy-queries.js - Academy Queries
 * PURE READ FACADE for all academy data
 * Path: js/modules/academy/academy-queries.js
 * 
 * This module is responsible for:
 *   - Read-only access to academy data
 *   - Composing data from multiple academy domains
 *   - Providing view-ready data for UI components
 *   - Defensive cloning of all returned data
 * 
 * IMPORTANT:
 *   - This is a PURE READ FACADE - NO MUTATIONS
 *   - All mutations go through domain modules (AcademyClasses, AcademyGrades, etc.)
 *   - This module DEPENDS ON domain modules, NOT the other way around
 *   - Returns DEFENSIVE COPIES of all data (deep clones)
 *   - No direct data store mutation
 *   - No saveData() calls
 *   - No circular dependencies
 *   - USES AcademyClasses for class data (delegates)
 *   - USES AcademyGrades for grade data (delegates)
 *   - USES AcademyGroups for group data (delegates)
 *   - USES CharacterQueries for character data
 *   - USES TeamQueries for team data
 *   - USES TournamentQueries for tournament data
 * 
 * DEPENDENCY GRAPH:
 *   AcademyQueries (read facade)
 *        ↓
 *   ┌─────┼─────┐
 *   ↓     ↓     ↓
 * AcademyClasses AcademyGrades AcademyGroups
 *   ↓     ↓     ↓
 *   └─────┼─────┘
 *         ↓
 *   Internal Data Store
 * 
 * DEPENDENCIES:
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *   - window.AcademyGroups (from academy-groups.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var queries = window.AcademyQueries;
 *   
 *   // Class queries
 *   var classes = queries.getClasses();
 *   var cls = queries.getClass('class_123');
 *   var name = queries.getClassDisplayName('class_123');
 *   
 *   // Student queries
 *   var students = queries.getClassStudents('class_123');
 *   var available = queries.getAvailableStudents('class_123', 5);
 *   
 *   // Grade queries
 *   var grades = queries.getStudentGrades('char_456');
 *   var summary = queries.getStudentGradeSummary('char_456');
 *   
 *   // Team queries
 *   var teams = queries.getAcademicTeams();
 *   var teamMembers = queries.getAcademicTeamMembers('team_789');
 *   
 *   // Tournament queries
 *   var tournaments = queries.getTournamentsByClass('class_123');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassRecords !== 'function') {
        missing.push('AcademyClasses.getClassRecords');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassRecord !== 'function') {
        missing.push('AcademyClasses.getClassRecord');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassRecordByName !== 'function') {
        missing.push('AcademyClasses.getClassRecordByName');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassStudentsInternal !== 'function') {
        missing.push('AcademyClasses.getClassStudentsInternal');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.isStudentInClassInternal !== 'function') {
        missing.push('AcademyClasses.isStudentInClassInternal');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassDisplayNameInternal !== 'function') {
        missing.push('AcademyClasses.getClassDisplayNameInternal');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getCharacterClassNamesInternal !== 'function') {
        missing.push('AcademyClasses.getCharacterClassNamesInternal');
    }

    if (!window.AcademyGrades || typeof window.AcademyGrades.getStudentGrades !== 'function') {
        missing.push('AcademyGrades.getStudentGrades');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.getClassGrades !== 'function') {
        missing.push('AcademyGrades.getClassGrades');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculateSummary !== 'function') {
        missing.push('AcademyGrades.calculateSummary');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculateClassRanking !== 'function') {
        missing.push('AcademyGrades.calculateClassRanking');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculateStudentGPA !== 'function') {
        missing.push('AcademyGrades.calculateStudentGPA');
    }

    if (!window.AcademyGroups || typeof window.AcademyGroups.getGroups !== 'function') {
        missing.push('AcademyGroups.getGroups');
    }
    if (!window.AcademyGroups || typeof window.AcademyGroups.getGroup !== 'function') {
        missing.push('AcademyGroups.getGroup');
    }
    if (!window.AcademyGroups || typeof window.AcademyGroups.getGroupsByDiscipline !== 'function') {
        missing.push('AcademyGroups.getGroupsByDiscipline');
    }
    if (!window.AcademyGroups || typeof window.AcademyGroups.getGroupsByInstructor !== 'function') {
        missing.push('AcademyGroups.getGroupsByInstructor');
    }
    if (!window.AcademyGroups || typeof window.AcademyGroups.getAllAutoGroups !== 'function') {
        missing.push('AcademyGroups.getAllAutoGroups');
    }
    if (!window.AcademyGroups || typeof window.AcademyGroups.getAutoGroup !== 'function') {
        missing.push('AcademyGroups.getAutoGroup');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamsByClass !== 'function') {
        missing.push('TeamQueries.getTeamsByClass');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeamName !== 'function') {
        missing.push('TeamQueries.getTeamName');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getActiveTeamMembers !== 'function') {
        missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getActiveTeamMemberCount !== 'function') {
        missing.push('TeamQueries.getActiveTeamMemberCount');
    }

    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournamentsByClass !== 'function') {
        missing.push('TournamentQueries.getTournamentsByClass');
    }
    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournament !== 'function') {
        missing.push('TournamentQueries.getTournament');
    }
    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournamentTeams !== 'function') {
        missing.push('TournamentQueries.getTournamentTeams');
    }
    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournamentsForTeam !== 'function') {
        missing.push('TournamentQueries.getTournamentsForTeam');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyGrades = window.AcademyGrades;
    var AcademyGroups = window.AcademyGroups;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var ObjectUtils = window.ObjectUtils;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_WEEK = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function getCharacterById(charId) {
        return CharacterQueries.getCharacterById(charId);
    }

    function getCharacterDisplayName(char) {
        return CharacterQueries.getDisplayName(char);
    }

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return DEFAULT_WEEK;
    }

    // ============================================================
    // CLASS QUERIES - Delegates to AcademyClasses
    // ============================================================

    /**
     * Get all classes (defensive copy).
     * 
     * @param {string} status - Optional status filter ('active', 'archived', 'graduated')
     * @returns {array} Array of class objects
     */
    function getClasses(status) {
        var records = status 
            ? AcademyClasses.getClassRecordsByStatus(status) 
            : AcademyClasses.getClassRecords();
        
        // Return defensive copies
        return records.map(function(cls) {
            return deepClone(cls);
        }).filter(function(cls) {
            return cls !== null;
        });
    }

    /**
     * Get a class by ID (defensive copy).
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(classId) {
        var cls = AcademyClasses.getClassRecord(classId);
        return cls ? deepClone(cls) : null;
    }

    /**
     * Get a class by name (defensive copy).
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        var cls = AcademyClasses.getClassRecordByName(name);
        return cls ? deepClone(cls) : null;
    }

    /**
     * Get a class display name.
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name or 'Unknown Class'
     */
    function getClassDisplayName(classId) {
        return AcademyClasses.getClassDisplayNameInternal(classId);
    }

    /**
     * Get character class names.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class names
     */
    function getCharacterClassNames(character) {
        return AcademyClasses.getCharacterClassNamesInternal(character);
    }

    /**
     * Get classes for a character.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class objects (defensive copies)
     */
    function getCharacterClasses(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var result = [];
        for (var i = 0; i < classIds.length; i++) {
            var cls = AcademyClasses.getClassRecord(classIds[i]);
            if (cls) {
                result.push(deepClone(cls));
            }
        }

        return result;
    }

    /**
     * Check if a character is in a class.
     * 
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if character is in class
     */
    function isCharacterInClass(character, classId) {
        if (!character || typeof character !== 'object') {
            return false;
        }

        return AcademyClasses.isStudentInClassInternal(classId, character.id);
    }

    // ============================================================
    // STUDENT QUERIES - Composes from AcademyClasses + CharacterQueries
    // ============================================================

    /**
     * Get students for a class (defensive copies).
     * 
     * @param {string} classId - Class ID
     * @param {string} statusFilter - Optional character status filter
     * @returns {array} Array of character objects
     */
    function getClassStudents(classId, statusFilter) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var studentIds = AcademyClasses.getClassStudentsInternal(classId);
        var result = [];

        for (var i = 0; i < studentIds.length; i++) {
            var char = CharacterQueries.getCharacterById(studentIds[i]);
            if (!char) {
                continue;
            }

            // Apply status filter if provided
            if (statusFilter) {
                var status = CharacterQueries.getCurrentStatus(char);
                if (status.toLowerCase() !== statusFilter.toLowerCase()) {
                    continue;
                }
            }

            result.push(deepClone(char));
        }

        // Sort by display name
        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    /**
     * Get students for a class with their grades.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of { student, grades, summary }
     */
    function getClassStudentsWithGrades(classId, week) {
        var students = getClassStudents(classId);
        var result = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var grades = AcademyGrades.getStudentGrades(student.id, week);
            var summary = AcademyGrades.calculateSummary(grades);

            result.push({
                student: student,
                grades: grades,
                summary: summary
            });
        }

        return result;
    }

    /**
     * Get available students for a class (not already in the class).
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week to check availability
     * @param {string} statusFilter - Optional character status filter
     * @returns {array} Array of available character objects
     */
    function getAvailableStudents(classId, week, statusFilter) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var allStudents = CharacterQueries.getStudents() || [];
        var classStudents = AcademyClasses.getClassStudentsInternal(classId);
        var classStudentSet = {};

        for (var i = 0; i < classStudents.length; i++) {
            classStudentSet[String(classStudents[i])] = true;
        }

        var result = [];

        for (var j = 0; j < allStudents.length; j++) {
            var student = allStudents[j];
            if (!student) {
                continue;
            }

            // Skip if already in class
            if (classStudentSet[String(student.id)]) {
                continue;
            }

            // Apply status filter if provided
            if (statusFilter) {
                var status = CharacterQueries.getCurrentStatus(student);
                if (status.toLowerCase() !== statusFilter.toLowerCase()) {
                    continue;
                }
            }

            result.push(deepClone(student));
        }

        // Sort by display name
        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    /**
     * Get students for a discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Week to check
     * @returns {array} Array of character objects
     */
    function getStudentsByDiscipline(disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }

        var weekNum = week || getCurrentWeek();
        var allStudents = CharacterQueries.getStudents() || [];
        var result = [];

        for (var i = 0; i < allStudents.length; i++) {
            var student = allStudents[i];
            if (!student) {
                continue;
            }

            // Check if student has grades in this discipline
            var grades = AcademyGrades.getStudentGrades(student.id, weekNum);
            var hasDiscipline = false;

            for (var j = 0; j < grades.length; j++) {
                if (String(grades[j].disciplineId) === String(disciplineId)) {
                    hasDiscipline = true;
                    break;
                }
            }

            if (hasDiscipline) {
                result.push(deepClone(student));
            }
        }

        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    // ============================================================
    // GRADE QUERIES - Delegates to AcademyGrades
    // ============================================================

    /**
     * Get grades for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getStudentGrades(studentId, week) {
        return AcademyGrades.getStudentGrades(studentId, week);
    }

    /**
     * Get grades for a class.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getClassGrades(classId, week) {
        return AcademyGrades.getClassGrades(classId, week);
    }

    /**
     * Get grades for a discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getDisciplineGrades(disciplineId, week) {
        return AcademyGrades.getDisciplineGrades(disciplineId, week);
    }

    /**
     * Calculate a grade summary.
     * 
     * @param {array} grades - Array of grade objects
     * @param {number} weightThreshold - Minimum weight to include
     * @returns {object} Summary statistics
     */
    function calculateGradeSummary(grades, weightThreshold) {
        return AcademyGrades.calculateSummary(grades, weightThreshold);
    }

    /**
     * Calculate student GPA.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Optional week filter
     * @returns {object} GPA statistics
     */
    function calculateStudentGPA(studentId, week) {
        return AcademyGrades.calculateStudentGPA(studentId, week);
    }

    /**
     * Calculate class ranking.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {array} Array of { studentId, name, average, rank }
     */
    function calculateClassRanking(classId, week) {
        return AcademyGrades.calculateClassRanking(classId, week, CharacterQueries.getCharacterById);
    }

    // ============================================================
    // GROUP QUERIES - Delegates to AcademyGroups
    // ============================================================

    /**
     * Get all groups.
     * 
     * @param {string} type - Optional group type filter
     * @returns {array} Array of group objects
     */
    function getGroups(type) {
        return AcademyGroups.getGroups(type);
    }

    /**
     * Get a group by ID.
     * 
     * @param {string} groupId - Group ID
     * @returns {object|null} Group object or null
     */
    function getGroup(groupId) {
        return AcademyGroups.getGroup(groupId);
    }

    /**
     * Get groups by discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Week number
     * @returns {array} Array of group objects
     */
    function getGroupsByDiscipline(disciplineId, week) {
        return AcademyGroups.getGroupsByDiscipline(disciplineId, week);
    }

    /**
     * Get groups by instructor.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {array} Array of group objects
     */
    function getGroupsByInstructor(instructorId, week) {
        return AcademyGroups.getGroupsByInstructor(instructorId, week);
    }

    /**
     * Get all auto-groups.
     * 
     * @param {number} week - Week number
     * @returns {array} Array of auto-group objects
     */
    function getAllAutoGroups(week) {
        return AcademyGroups.getAllAutoGroups(week);
    }

    /**
     * Get an auto-group.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Week number
     * @param {string} groupIndex - Group index
     * @returns {object|null} Auto-group object or null
     */
    function getAutoGroup(disciplineId, week, groupIndex) {
        return AcademyGroups.getAutoGroup(disciplineId, week, groupIndex);
    }

    // ============================================================
    // TEAM QUERIES - Delegates to TeamQueries
    // ============================================================

    /**
     * Get academic teams for a class.
     * 
     * @param {string} classId - Class ID
     * @param {string} status - Optional status filter
     * @returns {array} Array of team objects
     */
    function getAcademicTeams(classId, status) {
        var teams = TeamQueries.getTeamsByClass(classId, status);
        return teams.map(function(team) {
            return deepClone(team);
        });
    }

    /**
     * Get academic team members.
     * 
     * @param {string} teamId - Team ID
     * @param {number} week - Week to check membership
     * @returns {array} Array of member objects
     */
    function getAcademicTeamMembers(teamId, week) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }

        var weekNum = week || getCurrentWeek();
        return TeamQueries.getActiveTeamMembers(team, weekNum);
    }

    /**
     * Get academic team member count.
     * 
     * @param {string} teamId - Team ID
     * @param {number} week - Week to check membership
     * @returns {number} Member count
     */
    function getAcademicTeamMemberCount(teamId, week) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 0;
        }

        var weekNum = week || getCurrentWeek();
        return TeamQueries.getActiveTeamMemberCount(team, weekNum);
    }

    // ============================================================
    // TOURNAMENT QUERIES - Delegates to TournamentQueries
    // ============================================================

    /**
     * Get tournaments for a class.
     * 
     * @param {string} classId - Class ID
     * @param {string} status - Optional status filter
     * @returns {array} Array of tournament objects
     */
    function getTournamentsByClass(classId, status) {
        return TournamentQueries.getTournamentsByClass(classId, status);
    }

    /**
     * Get a tournament by ID.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object|null} Tournament object or null
     */
    function getTournament(tournamentId) {
        return TournamentQueries.getTournament(tournamentId);
    }

    /**
     * Get tournament teams.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of team objects
     */
    function getTournamentTeams(tournamentId) {
        return TournamentQueries.getTournamentTeams(tournamentId);
    }

    /**
     * Get tournaments for a team.
     * 
     * @param {string} teamId - Team ID
     * @param {string} status - Optional status filter
     * @returns {array} Array of tournament objects
     */
    function getTournamentsForTeam(teamId, status) {
        return TournamentQueries.getTournamentsForTeam(teamId, status);
    }

    // ============================================================
    // DISCIPLINE QUERIES - Composes from various sources
    // ============================================================

    /**
     * Get available disciplines for a week.
     * 
     * @param {number} week - Week number
     * @returns {array} Array of discipline objects
     */
    function getAvailableDisciplines(week) {
        // This would typically come from a discipline store
        // For now, use the window.data.curriculum.disciplines
        var weekNum = week || getCurrentWeek();
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var disciplines = curriculum.disciplines || [];

        if (!Array.isArray(disciplines)) {
            return [];
        }

        return disciplines.filter(function(d) {
            if (!d) return false;
            // Check if discipline is available for this week
            if (d.availableWeeks && Array.isArray(d.availableWeeks)) {
                return d.availableWeeks.indexOf(weekNum) !== -1;
            }
            return true;
        }).map(function(d) {
            return deepClone(d);
        });
    }

    /**
     * Get a discipline by ID.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var disciplines = curriculum.disciplines || [];

        if (!Array.isArray(disciplines)) {
            return null;
        }

        for (var i = 0; i < disciplines.length; i++) {
            if (disciplines[i] && String(disciplines[i].id) === String(disciplineId)) {
                return deepClone(disciplines[i]);
            }
        }

        return null;
    }

    /**
     * Get instructors for a discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Week number
     * @returns {array} Array of instructor objects
     */
    function getDisciplineInstructors(disciplineId, week) {
        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return [];
        }

        var instructorIds = discipline.instructorIds || [];
        var result = [];

        for (var i = 0; i < instructorIds.length; i++) {
            var instructor = CharacterQueries.getCharacterById(instructorIds[i]);
            if (instructor) {
                result.push(deepClone(instructor));
            }
        }

        return result;
    }

    /**
     * Get locations for a discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Week number
     * @returns {array} Array of location objects
     */
    function getDisciplineLocations(disciplineId, week) {
        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return [];
        }

        var locationIds = discipline.locationIds || [];
        var result = [];

        for (var i = 0; i < locationIds.length; i++) {
            var data = window.data || {};
            var curriculum = data.curriculum || {};
            var locations = curriculum.locations || [];

            for (var j = 0; j < locations.length; j++) {
                if (locations[j] && String(locations[j].id) === String(locationIds[i])) {
                    result.push(deepClone(locations[j]));
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // INSTRUCTOR QUERIES - Composes from CharacterQueries
    // ============================================================

    /**
     * Get instructors for a class.
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of instructor objects
     */
    function getClassInstructors(classId) {
        var cls = AcademyClasses.getClassRecord(classId);
        if (!cls) {
            return [];
        }

        var instructorId = cls.instructorId;
        if (!instructorId) {
            return [];
        }

        var instructor = CharacterQueries.getCharacterById(instructorId);
        return instructor ? [deepClone(instructor)] : [];
    }

    /**
     * Get all instructors.
     * 
     * @returns {array} Array of instructor objects
     */
    function getInstructors() {
        return CharacterQueries.getInstructors().map(function(instructor) {
            return deepClone(instructor);
        });
    }

    /**
     * Get instructor by ID.
     * 
     * @param {string} instructorId - Instructor ID
     * @returns {object|null} Instructor object or null
     */
    function getInstructor(instructorId) {
        var instructor = CharacterQueries.getCharacterById(instructorId);
        return instructor ? deepClone(instructor) : null;
    }

    // ============================================================
    // LOCATION QUERIES - Composes from curriculum data
    // ============================================================

    /**
     * Get all locations.
     * 
     * @returns {array} Array of location objects
     */
    function getLocations() {
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var locations = curriculum.locations || [];

        if (!Array.isArray(locations)) {
            return [];
        }

        return locations.map(function(location) {
            return deepClone(location);
        }).filter(function(location) {
            return location !== null;
        });
    }

    /**
     * Get a location by ID.
     * 
     * @param {string} locationId - Location ID
     * @returns {object|null} Location object or null
     */
    function getLocation(locationId) {
        if (!isNonEmptyString(locationId)) {
            return null;
        }

        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var locations = curriculum.locations || [];

        for (var i = 0; i < locations.length; i++) {
            if (locations[i] && String(locations[i].id) === String(locationId)) {
                return deepClone(locations[i]);
            }
        }

        return null;
    }

    // ============================================================
    // AGGREGATE QUERIES - Cross-domain compositions
    // ============================================================

    /**
     * Get comprehensive class details.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} Comprehensive class details
     */
    function getClassDetails(classId, week) {
        var cls = AcademyClasses.getClassRecord(classId);
        if (!cls) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var students = getClassStudents(classId);
        var grades = AcademyGrades.getClassGrades(classId, weekNum);
        var teams = TeamQueries.getTeamsByClass(classId);
        var tournaments = TournamentQueries.getTournamentsByClass(classId);
        var instructors = getClassInstructors(classId);

        var gradeSummary = AcademyGrades.calculateSummary(grades);
        var ranking = AcademyGrades.calculateClassRanking(classId, weekNum, CharacterQueries.getCharacterById);

        return {
            class: deepClone(cls),
            studentCount: students.length,
            students: students,
            grades: grades,
            gradeSummary: gradeSummary,
            ranking: ranking,
            teams: teams.map(function(team) { return deepClone(team); }),
            tournamentCount: tournaments.length,
            tournaments: tournaments,
            instructors: instructors,
            week: weekNum
        };
    }

    /**
     * Get comprehensive student details.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @returns {object} Comprehensive student details
     */
    function getStudentDetails(studentId, week) {
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var grades = AcademyGrades.getStudentGrades(studentId, weekNum);
        var gpa = AcademyGrades.calculateStudentGPA(studentId, weekNum);
        var classes = getCharacterClasses(student);
        var gradeSummary = AcademyGrades.calculateSummary(grades);

        return {
            student: deepClone(student),
            classes: classes,
            grades: grades,
            gradeSummary: gradeSummary,
            gpa: gpa,
            week: weekNum,
            displayName: CharacterQueries.getDisplayName(student)
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyQueries = {
        // ---- Class Queries ----
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,

        // ---- Student Queries ----
        getClassStudents: getClassStudents,
        getClassStudentsWithGrades: getClassStudentsWithGrades,
        getAvailableStudents: getAvailableStudents,
        getStudentsByDiscipline: getStudentsByDiscipline,

        // ---- Grade Queries ----
        getStudentGrades: getStudentGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        calculateGradeSummary: calculateGradeSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,

        // ---- Group Queries ----
        getGroups: getGroups,
        getGroup: getGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,

        // ---- Team Queries ----
        getAcademicTeams: getAcademicTeams,
        getAcademicTeamMembers: getAcademicTeamMembers,
        getAcademicTeamMemberCount: getAcademicTeamMemberCount,

        // ---- Tournament Queries ----
        getTournamentsByClass: getTournamentsByClass,
        getTournament: getTournament,
        getTournamentTeams: getTournamentTeams,
        getTournamentsForTeam: getTournamentsForTeam,

        // ---- Discipline Queries ----
        getAvailableDisciplines: getAvailableDisciplines,
        getDiscipline: getDiscipline,
        getDisciplineInstructors: getDisciplineInstructors,
        getDisciplineLocations: getDisciplineLocations,

        // ---- Instructor Queries ----
        getClassInstructors: getClassInstructors,
        getInstructors: getInstructors,
        getInstructor: getInstructor,

        // ---- Location Queries ----
        getLocations: getLocations,
        getLocation: getLocation,

        // ---- Aggregate Queries ----
        getClassDetails: getClassDetails,
        getStudentDetails: getStudentDetails,

        // ---- Helpers ----
        getCurrentWeek: getCurrentWeek,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
