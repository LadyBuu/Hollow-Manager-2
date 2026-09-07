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
 *   - window.ClassesQueries (from classes-queries.js)
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

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

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

    if (!window.ClassesQueries || typeof window.ClassesQueries.getGraduatingClasses !== 'function') {
        missing.push('ClassesQueries.getGraduatingClasses');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var MissionsQueries = window.MissionsQueries;
    var ClassesQueries = window.ClassesQueries;

    // ============================================================
    // HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // CURRENT YEAR
    // ============================================================

    /**
     * Get the current application year.
     * Returns a default if not set.
     * 
     * @returns {number} Current year
     */
    function getCurrentYear() {
        var data = getDataStore();
        if (data && typeof data.currentYear === 'number') {
            return data.currentYear;
        }
        return new Date().getFullYear();
    }

    // ============================================================
    // STATISTICS
    // ============================================================

    /**
     * Get complete dashboard statistics.
     * Composes data from all canonical domain queries.
     * 
     * @returns {object} Statistics object
     */
    function getStatistics() {
        // Get characters
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

        // Get students and instructors using canonical queries
        var students = CharacterQueries.getStudents() || [];
        var instructors = CharacterQueries.getInstructors() || [];

        // Get teams
        var allTeams = TeamQueries.getTeams ? TeamQueries.getTeams() : [];
        var activeTeams = TeamQueries.getActiveTeams ? TeamQueries.getActiveTeams() : [];

        // Get tournaments
        var tournaments = TournamentQueries.getTournaments ? TournamentQueries.getTournaments() : [];

        // Get missions
        var allMissions = MissionsQueries.getMissions ? MissionsQueries.getMissions('all') : [];
        var activeMissions = MissionsQueries.getMissions ? MissionsQueries.getMissions('active') : [];

        // Get graduating classes
        var graduatingClasses = ClassesQueries.getGraduatingClasses ? ClassesQueries.getGraduatingClasses() : [];

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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardQueries = {
        getCurrentYear: getCurrentYear,
        getStatistics: getStatistics
    };

})();
