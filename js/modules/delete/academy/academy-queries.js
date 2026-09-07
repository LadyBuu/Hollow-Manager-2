/**
 * js/modules/academy/academy-queries.js - Academy Queries
 * Academy-specific composite read models
 * Path: js/modules/academy/academy-queries.js
 * 
 * This module provides:
 *   - Academy-specific composite queries combining multiple domains
 *   - Read-only projections for Academy UI needs
 *   - Thin facade over domain query modules
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Delegates to domain-specific query modules
 *   - Returns clones of data where appropriate
 * 
 * DEPENDENCIES:
 *   - window.AcademyClassQueries (from academy-class-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.TournamentQueries (from tournament-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 *   - window.AcademyGroups (from academy-groups.js)
 * 
 * USAGE:
 *   var queries = window.AcademyQueries;
 *   var classes = queries.getClasses();
 *   var students = queries.getClassStudents('class_123');
 *   var teams = queries.getClassTeams('class_123');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyClassQueries = window.AcademyClassQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;
    var AcademyGroups = window.AcademyGroups;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // AcademyClassQueries
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClasses !== 'function') {
            missing.push('AcademyClassQueries.getClasses');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClass !== 'function') {
            missing.push('AcademyClassQueries.getClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClassByName !== 'function') {
            missing.push('AcademyClassQueries.getClassByName');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyClassQueries.getClassDisplayName');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.classExists !== 'function') {
            missing.push('AcademyClassQueries.classExists');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClassOptions !== 'function') {
            missing.push('AcademyClassQueries.getClassOptions');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getCharactersByClass !== 'function') {
            missing.push('AcademyClassQueries.getCharactersByClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getCharacterCountByClass !== 'function') {
            missing.push('AcademyClassQueries.getCharacterCountByClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getTeamsByClass !== 'function') {
            missing.push('AcademyClassQueries.getTeamsByClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getTeamCountByClass !== 'function') {
            missing.push('AcademyClassQueries.getTeamCountByClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getAvailableStudentsForClass !== 'function') {
            missing.push('AcademyClassQueries.getAvailableStudentsForClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getAvailableStudentCount !== 'function') {
            missing.push('AcademyClassQueries.getAvailableStudentCount');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClassStats !== 'function') {
            missing.push('AcademyClassQueries.getClassStats');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getClassesWithStats !== 'function') {
            missing.push('AcademyClassQueries.getClassesWithStats');
        }

        // CharacterQueries
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterNameById !== 'function') {
            missing.push('CharacterQueries.getCharacterNameById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getFullName !== 'function') {
            missing.push('CharacterQueries.getFullName');
        }
        if (!CharacterQueries || typeof CharacterQueries.calculateAge !== 'function') {
            missing.push('CharacterQueries.calculateAge');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.isStudent !== 'function') {
            missing.push('CharacterQueries.isStudent');
        }
        if (!CharacterQueries || typeof CharacterQueries.isInstructor !== 'function') {
            missing.push('CharacterQueries.isInstructor');
        }
        if (!CharacterQueries || typeof CharacterQueries.isCivilian !== 'function') {
            missing.push('CharacterQueries.isCivilian');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }
        if (!CharacterQueries || typeof CharacterQueries.getNonCivilianCharacters !== 'function') {
            missing.push('CharacterQueries.getNonCivilianCharacters');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterStats !== 'function') {
            missing.push('CharacterQueries.getCharacterStats');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterMagic !== 'function') {
            missing.push('CharacterQueries.getCharacterMagic');
        }

        // TeamQueries
        if (!TeamQueries || typeof TeamQueries.getTeamsByType !== 'function') {
            missing.push('TeamQueries.getTeamsByType');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMemberCount !== 'function') {
            missing.push('TeamQueries.getActiveTeamMemberCount');
        }

        // TournamentQueries
        if (!TournamentQueries || typeof TournamentQueries.getTournamentsByClass !== 'function') {
            missing.push('TournamentQueries.getTournamentsByClass');
        }
        if (!TournamentQueries || typeof TournamentQueries.getTournament !== 'function') {
            missing.push('TournamentQueries.getTournament');
        }
        if (!TournamentQueries || typeof TournamentQueries.getTournamentTeams !== 'function') {
            missing.push('TournamentQueries.getTournamentTeams');
        }

        // DisciplineQueries
        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }
        if (!DisciplineQueries || typeof DisciplineQueries.getDisciplines !== 'function') {
            missing.push('DisciplineQueries.getDisciplines');
        }
        if (!DisciplineQueries || typeof DisciplineQueries.getAvailableDisciplines !== 'function') {
            missing.push('DisciplineQueries.getAvailableDisciplines');
        }

        // LocationQueries
        if (!LocationQueries || typeof LocationQueries.getLocation !== 'function') {
            missing.push('LocationQueries.getLocation');
        }
        if (!LocationQueries || typeof LocationQueries.getLocations !== 'function') {
            missing.push('LocationQueries.getLocations');
        }
        if (!LocationQueries || typeof LocationQueries.getLocationSchedule !== 'function') {
            missing.push('LocationQueries.getLocationSchedule');
        }

        // AcademyGroups
        if (!AcademyGroups || typeof AcademyGroups.getAllAutoGroups !== 'function') {
            missing.push('AcademyGroups.getAllAutoGroups');
        }
        if (!AcademyGroups || typeof AcademyGroups.getAutoGroup !== 'function') {
            missing.push('AcademyGroups.getAutoGroup');
        }
        if (!AcademyGroups || typeof AcademyGroups.getGroupsByDiscipline !== 'function') {
            missing.push('AcademyGroups.getGroupsByDiscipline');
        }
        if (!AcademyGroups || typeof AcademyGroups.getGroupsByInstructor !== 'function') {
            missing.push('AcademyGroups.getGroupsByInstructor');
        }

        if (missing.length > 0) {
            throw new Error('AcademyQueries: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // CLASS QUERIES - Delegates to AcademyClassQueries
    // ============================================================

    function getClasses() {
        return AcademyClassQueries.getClasses();
    }

    function getClass(id) {
        return AcademyClassQueries.getClass(id);
    }

    function getClassByName(name) {
        return AcademyClassQueries.getClassByName(name);
    }

    function getClassDisplayName(classId) {
        return AcademyClassQueries.getClassDisplayName(classId);
    }

    function classExists(id) {
        return AcademyClassQueries.classExists(id);
    }

    function getClassOptions() {
        return AcademyClassQueries.getClassOptions();
    }

    function getClassStudents(classId) {
        return AcademyClassQueries.getCharactersByClass(classId);
    }

    function getClassStudentCount(classId) {
        return AcademyClassQueries.getCharacterCountByClass(classId);
    }

    function getClassTeams(classId) {
        return AcademyClassQueries.getTeamsByClass(classId);
    }

    function getClassTeamCount(classId) {
        return AcademyClassQueries.getTeamCountByClass(classId);
    }

    function getAvailableStudents(classId, week) {
        return AcademyClassQueries.getAvailableStudentsForClass(classId, week);
    }

    function getAvailableStudentCount(classId, week) {
        return AcademyClassQueries.getAvailableStudentCount(classId, week);
    }

    function getClassStats(classId, week) {
        return AcademyClassQueries.getClassStats(classId, week);
    }

    function getClassesWithStats(week) {
        return AcademyClassQueries.getClassesWithStats(week);
    }

    // ============================================================
    // CHARACTER QUERIES - Direct delegation
    // ============================================================

    function getCharacterById(id) {
        return CharacterQueries.getCharacterById(id);
    }

    function getCharacterNameById(id) {
        return CharacterQueries.getCharacterNameById(id);
    }

    function getDisplayName(char) {
        return CharacterQueries.getDisplayName(char);
    }

    function getFullName(char) {
        return CharacterQueries.getFullName(char);
    }

    function getCharacterAge(char) {
        return CharacterQueries.calculateAge(char);
    }

    function getCurrentStatus(char) {
        return CharacterQueries.getCurrentStatus(char);
    }

    function isStudent(char) {
        return CharacterQueries.isStudent(char);
    }

    function isInstructor(char) {
        return CharacterQueries.isInstructor(char);
    }

    function isCivilian(char) {
        return CharacterQueries.isCivilian(char);
    }

    function getStudents() {
        return CharacterQueries.getStudents();
    }

    function getInstructors() {
        return CharacterQueries.getInstructors();
    }

    function getNonCivilianCharacters() {
        return CharacterQueries.getNonCivilianCharacters();
    }

    function getCharacterStats(char) {
        return CharacterQueries.getCharacterStats(char);
    }

    function getCharacterMagic(char) {
        return CharacterQueries.getCharacterMagic(char);
    }

    // ============================================================
    // ACADEMIC TEAM QUERIES - Academy-specific composite
    // ============================================================

    function getAcademicTeams(classId) {
        if (!classId) {
            return [];
        }
        return AcademyClassQueries.getTeamsByClass(classId);
    }

    function getAcademicTeamMembers(teamId, week) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }
        return TeamQueries.getActiveTeamMembers(team, week);
    }

    function getAcademicTeamMemberCount(teamId, week) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 0;
        }
        return TeamQueries.getActiveTeamMemberCount(team, week);
    }

    // ============================================================
    // TOURNAMENT QUERIES - Delegates to TournamentQueries
    // ============================================================

    function getTournaments(classId) {
        if (!classId) {
            return [];
        }
        return TournamentQueries.getTournamentsByClass(classId);
    }

    function getTournament(id) {
        if (!id) {
            return null;
        }
        return TournamentQueries.getTournament(id);
    }

    function getTournamentTeams(tournamentId) {
        return TournamentQueries.getTournamentTeams(tournamentId);
    }

    function getTournamentsForTeam(teamId) {
        if (!teamId) {
            return [];
        }
        return TournamentQueries.getTournamentsForTeam(teamId);
    }

    // ============================================================
    // DISCIPLINE QUERIES - Delegates to DisciplineQueries
    // ============================================================

    function getDiscipline(id) {
        return DisciplineQueries.getDiscipline(id);
    }

    function getDisciplines() {
        return DisciplineQueries.getDisciplines();
    }

    function getAvailableDisciplines(week) {
        return DisciplineQueries.getAvailableDisciplines(week);
    }

    // ============================================================
    // LOCATION QUERIES - Delegates to LocationQueries
    // ============================================================

    function getLocation(id) {
        return LocationQueries.getLocation(id);
    }

    function getLocations() {
        return LocationQueries.getLocations();
    }

    function getLocationSchedule(locationId, week) {
        return LocationQueries.getLocationSchedule(locationId, week);
    }

    // ============================================================
    // INSTRUCTOR QUERIES - Academy-specific composite
    // ============================================================

    function getClassInstructors(classId) {
        if (!classId) {
            return [];
        }
        var students = AcademyClassQueries.getCharactersByClass(classId);
        var instructors = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var status = CharacterQueries.getCurrentStatus(student);
            if (status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior') {
                instructors.push(student);
            }
        }

        return instructors;
    }

    // ============================================================
    // AUTO-GROUP QUERIES - Delegates to AcademyGroups
    // ============================================================

    function getAllAutoGroups() {
        return AcademyGroups.getAllAutoGroups();
    }

    function getAutoGroup(key) {
        return AcademyGroups.getAutoGroup(key);
    }

    function getGroupsByDiscipline(disciplineId) {
        return AcademyGroups.getGroupsByDiscipline(disciplineId);
    }

    function getGroupsByInstructor(instructorId) {
        return AcademyGroups.getGroupsByInstructor(instructorId);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyQueries = {
        // Class queries
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        classExists: classExists,
        getClassOptions: getClassOptions,
        getClassStudents: getClassStudents,
        getClassStudentCount: getClassStudentCount,
        getClassTeams: getClassTeams,
        getClassTeamCount: getClassTeamCount,
        getAvailableStudents: getAvailableStudents,
        getAvailableStudentCount: getAvailableStudentCount,
        getClassStats: getClassStats,
        getClassesWithStats: getClassesWithStats,

        // Character queries
        getCharacterById: getCharacterById,
        getCharacterNameById: getCharacterNameById,
        getDisplayName: getDisplayName,
        getFullName: getFullName,
        getCharacterAge: getCharacterAge,
        getCurrentStatus: getCurrentStatus,
        isStudent: isStudent,
        isInstructor: isInstructor,
        isCivilian: isCivilian,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,
        getCharacterStats: getCharacterStats,
        getCharacterMagic: getCharacterMagic,

        // Academic team queries (Academy-specific composite)
        getAcademicTeams: getAcademicTeams,
        getAcademicTeamMembers: getAcademicTeamMembers,
        getAcademicTeamMemberCount: getAcademicTeamMemberCount,

        // Tournament queries
        getTournaments: getTournaments,
        getTournament: getTournament,
        getTournamentTeams: getTournamentTeams,
        getTournamentsForTeam: getTournamentsForTeam,

        // Discipline queries
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,

        // Location queries
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationSchedule: getLocationSchedule,

        // Instructor queries (Academy-specific composite)
        getClassInstructors: getClassInstructors,

        // Auto-group queries
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor
    };

})();
