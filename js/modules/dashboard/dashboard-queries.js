/**
 * js/modules/dashboard/dashboard-queries.js - Dashboard Queries
 * Cross-domain read model for the dashboard
 * Path: js/modules/dashboard/dashboard-queries.js
 * 
 * This module provides:
 *   - getStatistics() - Complete dashboard statistics
 *   - getCurrentYear() - Get the current application year
 *   - getRecentActivity() - Recent activity across domains
 *   - getQuickStats() - Quick statistics for dashboard cards
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects
 *   - Delegates to canonical domain queries
 *   - Composes results from multiple domains
 *   - Returns DEFENSIVE COPIES where appropriate
 *   - This is a CROSS-DOMAIN READ MODEL - it depends on all upstream domains
 *   - Dashboard is the LAST module to load - all upstream domains must be available
 * 
 * DEPENDENCIES (ALL MANDATORY):
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
 *   var recent = queries.getRecentActivity();
 */

(function() {
    'use strict';

    if (window.__dashboardQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS - ALL MANDATORY
    // ============================================================

    var missing = [];

    // CharacterQueries
    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacters !== 'function') {
        missing.push('CharacterQueries.getCharacters');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    // TeamQueries
    if (!window.TeamQueries || typeof window.TeamQueries.getActiveTeams !== 'function') {
        missing.push('TeamQueries.getActiveTeams');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeams !== 'function') {
        missing.push('TeamQueries.getTeams');
    }

    // TournamentQueries
    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournaments !== 'function') {
        missing.push('TournamentQueries.getTournaments');
    }

    // MissionsQueries
    if (!window.MissionsQueries || typeof window.MissionsQueries.getMissions !== 'function') {
        missing.push('MissionsQueries.getMissions');
    }
    if (!window.MissionsQueries || typeof window.MissionsQueries.getActiveCount !== 'function') {
        missing.push('MissionsQueries.getActiveCount');
    }
    if (!window.MissionsQueries || typeof window.MissionsQueries.getCompletedCount !== 'function') {
        missing.push('MissionsQueries.getCompletedCount');
    }
    if (!window.MissionsQueries || typeof window.MissionsQueries.getCancelledCount !== 'function') {
        missing.push('MissionsQueries.getCancelledCount');
    }

    // AcademyQueries
    if (!window.AcademyQueries || typeof window.AcademyQueries.getClasses !== 'function') {
        missing.push('AcademyQueries.getClasses');
    }
    if (!window.AcademyQueries || typeof window.AcademyQueries.getClassStudents !== 'function') {
        missing.push('AcademyQueries.getClassStudents');
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
    var AcademyQueries = window.AcademyQueries;

    // ============================================================
    // HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function deepClone(value) {
        if (window.ObjectUtils && typeof window.ObjectUtils.deepClone === 'function') {
            return window.ObjectUtils.deepClone(value);
        }
        // Fallback
        if (value === null || typeof value !== 'object') {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    // ============================================================
    // PUBLIC QUERIES
    // ============================================================

    /**
     * Get the current application year.
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

    /**
     * Get complete dashboard statistics.
     * Composes data from all upstream domains.
     * 
     * @returns {object} Complete statistics object
     */
    function getStatistics() {
        // ---- Characters ----
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

        // ---- Teams ----
        var allTeams = TeamQueries.getTeams ? TeamQueries.getTeams() : [];
        var activeTeams = TeamQueries.getActiveTeams ? TeamQueries.getActiveTeams() : [];

        // Count teams by type
        var professionalTeams = 0;
        var temporaryTeams = 0;
        var civilianTeams = 0;
        var academicTeams = 0;

        for (var j = 0; j < allTeams.length; j++) {
            var team = allTeams[j];
            if (!team) continue;
            var type = team.type || '';
            if (type === 'professional') professionalTeams++;
            else if (type === 'temporary') temporaryTeams++;
            else if (type === 'civilian') civilianTeams++;
            else if (type === 'academic') academicTeams++;
        }

        // ---- Tournaments ----
        var tournaments = TournamentQueries.getTournaments ? TournamentQueries.getTournaments() : [];
        var activeTournaments = 0;
        var completedTournaments = 0;
        var draftTournaments = 0;

        for (var k = 0; k < tournaments.length; k++) {
            var t = tournaments[k];
            if (!t) continue;
            var status = t.status || '';
            if (status === 'active') activeTournaments++;
            else if (status === 'completed') completedTournaments++;
            else if (status === 'draft') draftTournaments++;
        }

        // ---- Missions ----
        var allMissions = MissionsQueries.getMissions ? MissionsQueries.getMissions('all') : [];
        var activeMissions = MissionsQueries.getActiveCount ? MissionsQueries.getActiveCount() : 0;
        var completedMissions = MissionsQueries.getCompletedCount ? MissionsQueries.getCompletedCount() : 0;
        var cancelledMissions = MissionsQueries.getCancelledCount ? MissionsQueries.getCancelledCount() : 0;

        // ---- Academy ----
        var graduatingClasses = AcademyQueries.getClasses ? AcademyQueries.getClasses() : [];
        var totalStudents = 0;
        for (var l = 0; l < graduatingClasses.length; l++) {
            var cls = graduatingClasses[l];
            if (!cls) continue;
            var studentsInClass = AcademyQueries.getClassStudents ? AcademyQueries.getClassStudents(cls.id) : [];
            totalStudents += Array.isArray(studentsInClass) ? studentsInClass.length : 0;
        }

        return {
            // Characters
            totalCharacters: totalCharacters,
            activeCharacters: activeCharacters,
            deceasedCharacters: deceasedCharacters,
            trainees: students.length,
            instructors: instructors.length,

            // Teams
            totalTeams: allTeams.length,
            activeTeams: activeTeams.length,
            professionalTeams: professionalTeams,
            temporaryTeams: temporaryTeams,
            civilianTeams: civilianTeams,
            academicTeams: academicTeams,

            // Tournaments
            totalTournaments: tournaments.length,
            activeTournaments: activeTournaments,
            completedTournaments: completedTournaments,
            draftTournaments: draftTournaments,

            // Missions
            totalMissions: allMissions.length,
            activeMissions: activeMissions,
            completedMissions: completedMissions,
            cancelledMissions: cancelledMissions,

            // Academy
            totalGraduatingClasses: graduatingClasses.length,
            totalEnrolledStudents: totalStudents
        };
    }

    /**
     * Get quick statistics for dashboard cards.
     * Lightweight version of getStatistics().
     * 
     * @returns {object} Quick statistics object
     */
    function getQuickStats() {
        var stats = getStatistics();

        return {
            characters: stats.totalCharacters,
            activeCharacters: stats.activeCharacters,
            teams: stats.totalTeams,
            activeTeams: stats.activeTeams,
            tournaments: stats.totalTournaments,
            missions: stats.totalMissions,
            activeMissions: stats.activeMissions,
            classes: stats.totalGraduatingClasses
        };
    }

    /**
     * Get recent activity across domains.
     * 
     * @param {number} limit - Maximum number of activities to return
     * @returns {array} Array of recent activity items
     */
    function getRecentActivity(limit) {
        limit = limit || 10;
        var activities = [];

        // Get recent characters
        var characters = CharacterQueries.getCharacters() || [];
        var recentChars = characters
            .filter(function(c) { return c && c.createdAt; })
            .sort(function(a, b) {
                return new Date(b.createdAt) - new Date(a.createdAt);
            })
            .slice(0, limit);

        for (var i = 0; i < recentChars.length; i++) {
            var c = recentChars[i];
            activities.push({
                type: 'character_created',
                id: c.id,
                title: CharacterQueries.getDisplayName(c),
                timestamp: c.createdAt,
                domain: 'characters'
            });
        }

        // Get recent tournaments
        var tournaments = TournamentQueries.getTournaments ? TournamentQueries.getTournaments() : [];
        var recentTourns = tournaments
            .filter(function(t) { return t && t.createdAt; })
            .sort(function(a, b) {
                return new Date(b.createdAt) - new Date(a.createdAt);
            })
            .slice(0, limit);

        for (var j = 0; j < recentTourns.length; j++) {
            var t = recentTourns[j];
            activities.push({
                type: 'tournament_created',
                id: t.id,
                title: t.name || 'Unknown Tournament',
                timestamp: t.createdAt,
                domain: 'tournaments'
            });
        }

        // Get recent missions
        var missions = MissionsQueries.getMissions ? MissionsQueries.getMissions('all') : [];
        var recentMissions = missions
            .filter(function(m) { return m && m.createdAt; })
            .sort(function(a, b) {
                return new Date(b.createdAt) - new Date(a.createdAt);
            })
            .slice(0, limit);

        for (var k = 0; k < recentMissions.length; k++) {
            var m = recentMissions[k];
            activities.push({
                type: 'mission_created',
                id: m.id,
                title: m.title || 'Unknown Mission',
                timestamp: m.createdAt,
                domain: 'missions'
            });
        }

        // Sort all activities by timestamp descending
        activities.sort(function(a, b) {
            return new Date(b.timestamp) - new Date(a.timestamp);
        });

        return activities.slice(0, limit);
    }

    /**
     * Get counts by domain for the dashboard.
     * 
     * @returns {object} Domain counts
     */
    function getDomainCounts() {
        var stats = getStatistics();

        return {
            characters: {
                total: stats.totalCharacters,
                active: stats.activeCharacters,
                deceased: stats.deceasedCharacters
            },
            teams: {
                total: stats.totalTeams,
                active: stats.activeTeams,
                professional: stats.professionalTeams,
                temporary: stats.temporaryTeams,
                civilian: stats.civilianTeams,
                academic: stats.academicTeams
            },
            tournaments: {
                total: stats.totalTournaments,
                active: stats.activeTournaments,
                completed: stats.completedTournaments,
                draft: stats.draftTournaments
            },
            missions: {
                total: stats.totalMissions,
                active: stats.activeMissions,
                completed: stats.completedMissions,
                cancelled: stats.cancelledMissions
            },
            academy: {
                classes: stats.totalGraduatingClasses,
                students: stats.totalEnrolledStudents,
                instructors: stats.instructors
            }
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardQueries = {
        getCurrentYear: getCurrentYear,
        getStatistics: getStatistics,
        getQuickStats: getQuickStats,
        getRecentActivity: getRecentActivity,
        getDomainCounts: getDomainCounts
    };

})();
