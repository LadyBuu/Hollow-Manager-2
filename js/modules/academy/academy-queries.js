/**
 * js/modules/academy/academy-queries.js - Academy Queries
 * Read-only queries for the academy module
 * Path: js/modules/academy/academy-queries.js
 * 
 * This module provides:
 *   - Class queries (delegates to ClassesQueries)
 *   - Student queries (delegates to CharacterQueries)
 *   - Faculty queries (delegates to CharacterQueries)
 *   - Academic team queries (delegates to TeamQueries)
 *   - Tournament queries (delegates to TournamentCore)
 *   - Discipline queries (delegates to AcademyCore)
 *   - Location queries (delegates to AcademyCore)
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Delegates to domain-specific query modules
 *   - Returns live references - callers must not mutate
 * 
 * DEPENDENCIES:
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.AcademyCore (from academy-core.js)
 *   - window.TournamentCore (from tournament-core.js) - optional
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

    var ClassesQueries = window.ClassesQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var AcademyCore = window.AcademyCore;
    var TournamentCore = window.TournamentCore;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getTeamsByClass !== 'function') {
            missing.push('ClassesQueries.getTeamsByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClassDisplayName !== 'function') {
            missing.push('ClassesQueries.getClassDisplayName');
        }
        if (!ClassesQueries || typeof ClassesQueries.getAvailableStudentsForClass !== 'function') {
            missing.push('ClassesQueries.getAvailableStudentsForClass');
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
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByType !== 'function') {
            missing.push('TeamQueries.getTeamsByType');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }

        if (!AcademyCore || typeof AcademyCore.getDisciplines !== 'function') {
            missing.push('AcademyCore.getDisciplines');
        }
        if (!AcademyCore || typeof AcademyCore.getLocations !== 'function') {
            missing.push('AcademyCore.getLocations');
        }
        if (!AcademyCore || typeof AcademyCore.getAvailableDisciplines !== 'function') {
            missing.push('AcademyCore.getAvailableDisciplines');
        }

        // TournamentCore is optional
        if (!TournamentCore) {
            // Missing TournamentCore is acceptable - tournaments are optional
        }

        if (missing.length > 0) {
            console.warn('AcademyQueries: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyQueriesLoaded = true;

    // ============================================================
    // CLASS QUERIES - Delegates to ClassesQueries
    // ============================================================

    function getClasses() {
        return ClassesQueries.getClasses();
    }

    function getClass(id) {
        return ClassesQueries.getClass(id);
    }

    function getClassByName(name) {
        return ClassesQueries.getClassByName(name);
    }

    function getClassDisplayName(classId) {
        return ClassesQueries.getClassDisplayName(classId);
    }

    function classExists(id) {
        return ClassesQueries.classExists(id);
    }

    function getClassOptions() {
        return ClassesQueries.getClassOptions();
    }

    function getClassStudents(classId) {
        return ClassesQueries.getCharactersByClass(classId);
    }

    function getClassStudentCount(classId) {
        return ClassesQueries.getCharacterCountByClass(classId);
    }

    function getClassTeams(classId) {
        return ClassesQueries.getTeamsByClass(classId);
    }

    function getClassTeamCount(classId) {
        return ClassesQueries.getTeamCountByClass(classId);
    }

    function getAvailableStudents(classId, week) {
        return ClassesQueries.getAvailableStudentsForClass(classId, week);
    }

    function getAvailableStudentCount(classId, week) {
        return ClassesQueries.getAvailableStudentCount(classId, week);
    }

    function getClassStats(classId, week) {
        return ClassesQueries.getClassStats(classId, week);
    }

    function getClassesWithStats(week) {
        return ClassesQueries.getClassesWithStats(week);
    }

    // ============================================================
    // CHARACTER QUERIES - Delegates to CharacterQueries
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
        return CharacterQueries.getCharacterAge(char);
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
    // ACADEMIC TEAM QUERIES - Delegates to TeamQueries
    // ============================================================

    function getAcademicTeams(classId) {
        if (!classId) {
            return [];
        }
        var teams = TeamQueries.getTeamsByType('academic', 'operational');
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (String(teams[i].classId) === String(classId)) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    function getAcademicTeam(id) {
        return TeamQueries.getTeamById(id);
    }

    function getAcademicTeamName(id) {
        return TeamQueries.getTeamName(id);
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
    // TOURNAMENT QUERIES - Delegates to TournamentCore
    // ============================================================

    function getTournaments(classId) {
        if (!classId) {
            return [];
        }

        if (TournamentCore && typeof TournamentCore.getTournamentsByClass === 'function') {
            return TournamentCore.getTournamentsByClass(classId);
        }

        // Fallback to direct data access
        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && String(t.classId) === String(classId)) {
                result.push(t);
            }
        }

        return result;
    }

    function getTournament(id) {
        if (!id) {
            return null;
        }

        if (TournamentCore && typeof TournamentCore.getTournament === 'function') {
            return TournamentCore.getTournament(id);
        }

        var data = window.data || {};
        var tournaments = data.tournaments || [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && String(t.id) === String(id)) {
                return t;
            }
        }

        return null;
    }

    function getTournamentTeams(tournamentId) {
        var tournament = getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.teams)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < tournament.teams.length; i++) {
            var team = TeamQueries.getTeamById(tournament.teams[i]);
            if (team) {
                result.push(team);
            }
        }
        return result;
    }

    function getTournamentsForTeam(teamId) {
        if (!teamId) {
            return [];
        }

        var data = window.data || {};
        var tournaments = data.tournaments || [];
        var result = [];

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && Array.isArray(t.teams)) {
                for (var j = 0; j < t.teams.length; j++) {
                    if (String(t.teams[j]) === String(teamId)) {
                        result.push(t);
                        break;
                    }
                }
            }
        }

        return result;
    }

    // ============================================================
    // DISCIPLINE QUERIES - Delegates to AcademyCore
    // ============================================================

    function getDiscipline(id) {
        return AcademyCore.getDiscipline(id);
    }

    function getDisciplines() {
        return AcademyCore.getDisciplines();
    }

    function getAvailableDisciplines(week) {
        return AcademyCore.getAvailableDisciplines(week);
    }

    function getDisciplineTypeLabel(type) {
        var labels = {
            'mandatory': 'Mandatory',
            'optional': 'Optional'
        };
        return labels[type] || type || 'Unknown';
    }

    function getDisciplineTypeColor(type) {
        var colors = {
            'mandatory': 'var(--accent)',
            'optional': 'var(--warning)'
        };
        return colors[type] || 'var(--text-dim)';
    }

    // ============================================================
    // LOCATION QUERIES - Delegates to AcademyCore
    // ============================================================

    function getLocation(id) {
        return AcademyCore.getLocation(id);
    }

    function getLocations() {
        return AcademyCore.getLocations();
    }

    function getLocationSchedule(locationId, week) {
        return AcademyCore.getLocationSchedule(locationId, week);
    }

    function getLocationTypeLabel(type) {
        var labels = {
            'indoor': 'Indoor',
            'outdoor': 'Outdoor',
            'pool': 'Pool',
            'classroom': 'Classroom',
            'lab': 'Lab',
            'field': 'Field',
            'other': 'Other'
        };
        return labels[type] || type || 'Other';
    }

    function getLocationTypeIcon(type) {
        var icons = {
            'indoor': '🏠',
            'outdoor': '🌳',
            'pool': '🏊',
            'classroom': '📚',
            'lab': '🔬',
            'field': '🏟️',
            'other': '📍'
        };
        return icons[type] || '📍';
    }

    // ============================================================
    // INSTRUCTOR QUERIES - Class-specific
    // ============================================================

    function getClassInstructors(classId) {
        if (!classId) {
            return [];
        }
        var students = getClassStudents(classId);
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

    function getClassDisciplines(classId) {
        // Get disciplines taught by instructors in this class
        var instructors = getClassInstructors(classId);
        var disciplines = [];
        var seen = {};

        for (var i = 0; i < instructors.length; i++) {
            var instructor = instructors[i];
            // This would need to check instructor's assigned disciplines
            // For now, return empty array
        }

        return disciplines;
    }

    // ============================================================
    // AUTO-GROUP QUERIES - Delegates to AcademyCore
    // ============================================================

    function getAllAutoGroups() {
        return AcademyCore.getAllAutoGroups();
    }

    function getAutoGroup(key) {
        return AcademyCore.getAutoGroup(key);
    }

    function getGroupsByDiscipline(disciplineId) {
        return AcademyCore.getGroupsByDiscipline(disciplineId);
    }

    function getGroupsByInstructor(instructorId) {
        return AcademyCore.getGroupsByInstructor(instructorId);
    }

    // ============================================================
    // WEEK UTILITIES
    // ============================================================

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function getCurrentWeek() {
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= 1 && week <= 52) {
            return week;
        }
        return 1;
    }

    function getWeekRange() {
        return { min: 1, max: 52 };
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

        // Academic team queries
        getAcademicTeams: getAcademicTeams,
        getAcademicTeam: getAcademicTeam,
        getAcademicTeamName: getAcademicTeamName,
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
        getDisciplineTypeLabel: getDisciplineTypeLabel,
        getDisciplineTypeColor: getDisciplineTypeColor,

        // Location queries
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationSchedule: getLocationSchedule,
        getLocationTypeLabel: getLocationTypeLabel,
        getLocationTypeIcon: getLocationTypeIcon,

        // Instructor queries
        getClassInstructors: getClassInstructors,
        getClassDisciplines: getClassDisciplines,

        // Auto-group queries
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,

        // Week utilities
        validateWeek: validateWeek,
        getCurrentWeek: getCurrentWeek,
        getWeekRange: getWeekRange,

        // Constants
        MIN_WEEK: 1,
        MAX_WEEK: 52
    };

})();