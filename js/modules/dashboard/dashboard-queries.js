/**
 * js/modules/dashboard/dashboard-queries.js - Dashboard Queries
 * Cross-domain read model for the dashboard
 * Path: js/modules/dashboard/dashboard-queries.js
 * 
 * This module provides:
 *   - getStatistics() - Complete dashboard statistics
 *   - getCurrentYear() - Get the current application year
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects
 *   - Delegates to canonical domain queries
 *   - Composes results from multiple domains
 *   - Returns DEFENSIVE COPIES where appropriate
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.TournamentQueries (from tournament-queries.js)
 *   - window.MissionsQueries (from missions-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 * 
 * USAGE:
 *   var queries = window.DashboardQueries;
 *   var stats = queries.getStatistics();
 *   var year = queries.getCurrentYear();
 */

(function() {
    'use strict';

    if (window.__dashboardQueriesLoaded) {
        return;
    }

    var missing = [];

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacters !== 'function') {
        missing.push('CharacterQueries.getCharacters');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getActiveTeams !== 'function') {
        missing.push('TeamQueries.getActiveTeams');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeams !== 'function') {
        missing.push('TeamQueries.getTeams');
    }

    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournaments !== 'function') {
        missing.push('TournamentQueries.getTournaments');
    }

    if (!window.MissionsQueries || typeof window.MissionsQueries.getMissions !== 'function') {
        missing.push('MissionsQueries.getMissions');
    }

    if (!window.AcademyQueries || typeof window.AcademyQueries.getClasses !== 'function') {
        missing.push('AcademyQueries.getClasses');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardQueriesLoaded = true;

    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var MissionsQueries = window.MissionsQueries;
    var AcademyQueries = window.AcademyQueries;

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurrentYear() {
        var data = getDataStore();
        if (data && typeof data.currentYear === 'number') {
            return data.currentYear;
        }
        return new Date().getFullYear();
    }

    function getStatistics() {
        var characters = CharacterQueries.getCharacters() || [];
        var totalCharacters = characters.length;
        var activeCharacters = 0;
        var deceasedCharacters = 0;

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (char.deceased) {
                deceasedCharacters++;
            } else {
                activeCharacters++;
            }
        }

        var students = CharacterQueries.getStudents() || [];
        var instructors = CharacterQueries.getInstructors() || [];

        var allTeams = TeamQueries.getTeams ? TeamQueries.getTeams() : [];
        var activeTeams = TeamQueries.getActiveTeams ? TeamQueries.getActiveTeams() : [];

        var tournaments = TournamentQueries.getTournaments ? TournamentQueries.getTournaments() : [];

        var allMissions = MissionsQueries.getMissions ? MissionsQueries.getMissions('all') : [];
        var activeMissions = MissionsQueries.getMissions ? MissionsQueries.getMissions('active') : [];

        var graduatingClasses = AcademyQueries.getClasses ? AcademyQueries.getClasses() : [];

        return {
            totalCharacters: totalCharacters,
            activeCharacters: activeCharacters,
            deceasedCharacters: deceasedCharacters,
            trainees: students.length,
            instructors: instructors.length,
            totalTeams: allTeams.length,
            activeTeams: activeTeams.length,
            totalTournaments: tournaments.length,
            totalMissions: allMissions.length,
            activeMissions: activeMissions.length,
            totalGraduatingClasses: graduatingClasses.length
        };
    }

    window.DashboardQueries = {
        getCurrentYear: getCurrentYear,
        getStatistics: getStatistics
    };

})();