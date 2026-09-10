/**
 * js/modules/dashboard/dashboard-aggregator.js - Dashboard Aggregator
 * Composes canonical domain queries into dashboard view models
 * 
 * Path: js/modules/dashboard/dashboard-aggregator.js
 * 
 * This module provides:
 *   - getDashboardViewModel() - Complete dashboard view model
 * 
 * IMPORTANT:
 *   - READ-ONLY - no mutations
 *   - PURE - no side effects, no DOM, no persistence
 *   - Calls CANONICAL domain queries directly
 *   - No "DashboardQueries" facade - that layer does not exist
 *   - No safeCall() - if a required query is missing or fails, that is
 *     an application wiring error and should be visible
 *   - Statistics calculated ONCE and shared across derived views
 *   - Recent activity sourced from ActivityLog, not createdAt fields
 * 
 * SEMANTIC DEFINITIONS:
 *   The Dashboard is an aggregation surface, not a domain definition
 *   surface. Where a "count" requires interpretation, we either use
 *   the domain's canonical query, or we do not display the concept
 *   at all. Specifically:
 * 
 *   - "Total characters"   = all characters
 *   - "Deceased characters" = characters where `deceased === true`
 *   - "Students"           = CharacterQueries.getStudents() (status-based)
 *   - "Instructors"        = CharacterQueries.getInstructors() (status-based)
 *   - "Active characters"  is NOT displayed because "active" has no
 *     canonical definition (deceased vs eliminated vs career status
 *     are all possible interpretations)
 * 
 *   - "Active teams"       = teams where `status === 'active'`
 *   - "Active tournaments" = tournaments where `status === 'active'`
 *   - "Active missions"    = missions where `status === 'active'`
 *     (canonical statuses from each domain's constants)
 * 
 *   - "Total classes"      = AcademyQueries.getClasses().length
 *   - "Enrolled students"  is NOT displayed because there is no canonical
 *     aggregate and the semantics (unique students vs sum of class sizes)
 *     are ambiguous. Academy must decide before Dashboard displays it.
 * 
 *   - "Recent activity" is read directly from ActivityLog.getHistory().
 *     ActivityLog entries are rendered as-is: { message, type, timestamp }.
 *     The Dashboard does NOT reconstruct meaning from createdAt fields,
 *     and does NOT resolve characters from metadata.
 * 
 * DEPENDENCIES (all required):
 *   - window.ApplicationSettingsQueries
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.TournamentQueries
 *   - window.MissionQueries
 *   - window.AcademyQueries
 *   - window.ActivityLog
 * 
 * USAGE:
 *   var agg = window.DashboardAggregator;
 *   var viewModel = agg.getDashboardViewModel();
 */

(function() {
    'use strict';

    if (window.__dashboardAggregatorLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - FAIL LOUDLY
    // ============================================================

    var missing = [];

    // ---- Application settings ----
    if (!window.ApplicationSettingsQueries ||
        typeof window.ApplicationSettingsQueries.getCurrentYear !== 'function') {
        missing.push('ApplicationSettingsQueries.getCurrentYear');
    }

    // ---- Character ----
    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacters !== 'function') {
        missing.push('CharacterQueries.getCharacters');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    // ---- Team ----
    if (!window.TeamQueries || typeof window.TeamQueries.getTeams !== 'function') {
        missing.push('TeamQueries.getTeams');
    }

    // ---- Tournament ----
    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournaments !== 'function') {
        missing.push('TournamentQueries.getTournaments');
    }

    // ---- Mission ----
    if (!window.MissionQueries || typeof window.MissionQueries.getMissions !== 'function') {
        missing.push('MissionQueries.getMissions');
    }

    // ---- Academy ----
    if (!window.AcademyQueries || typeof window.AcademyQueries.getClasses !== 'function') {
        missing.push('AcademyQueries.getClasses');
    }

    // ---- Activity log ----
    if (!window.ActivityLog || typeof window.ActivityLog.getHistory !== 'function') {
        missing.push('ActivityLog.getHistory');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardAggregator] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AppSettingsQueries = window.ApplicationSettingsQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var MissionQueries = window.MissionQueries;
    var AcademyQueries = window.AcademyQueries;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var RECENT_ACTIVITY_LIMIT = 10;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Count items in an array matching a predicate.
     * 
     * @param {array} items - Array of items
     * @param {function} predicate - Predicate function
     * @returns {number} Count of matching items
     */
    function countBy(items, predicate) {
        var count = 0;
        for (var i = 0; i < items.length; i++) {
            if (predicate(items[i])) {
                count++;
            }
        }
        return count;
    }

    // ============================================================
    // STATISTICS - calculated once per view model
    // ============================================================

    /**
     * Calculate all dashboard statistics.
     * This function is called exactly once per getDashboardViewModel() call.
     * All derived views (quickStats, domainCounts) use its return value.
     * 
     * @returns {object} Statistics object
     */
    function calculateStatistics() {
        // ---- Characters ----
        var characters = CharacterQueries.getCharacters();
        var totalCharacters = characters.length;
        var deceasedCharacters = countBy(characters, function(c) {
            return c && c.deceased === true;
        });

        var students = CharacterQueries.getStudents();
        var instructors = CharacterQueries.getInstructors();

        // ---- Teams ----
        var teams = TeamQueries.getTeams();
        var activeTeams = countBy(teams, function(t) {
            return t && t.status === 'active';
        });
        var professionalTeams = countBy(teams, function(t) { return t && t.type === 'professional'; });
        var temporaryTeams = countBy(teams, function(t) { return t && t.type === 'temporary'; });
        var civilianTeams = countBy(teams, function(t) { return t && t.type === 'civilian'; });
        var academicTeams = countBy(teams, function(t) { return t && t.type === 'academic'; });

        // ---- Tournaments ----
        var tournaments = TournamentQueries.getTournaments();
        var activeTournaments = countBy(tournaments, function(t) { return t && t.status === 'active'; });
        var completedTournaments = countBy(tournaments, function(t) { return t && t.status === 'completed'; });
        var draftTournaments = countBy(tournaments, function(t) { return t && t.status === 'draft'; });

        // ---- Missions ----
        var missions = MissionQueries.getMissions();
        var activeMissions = countBy(missions, function(m) { return m && m.status === 'active'; });
        var completedMissions = countBy(missions, function(m) { return m && m.status === 'completed'; });
        var cancelledMissions = countBy(missions, function(m) { return m && m.status === 'cancelled'; });

        // ---- Academy ----
        var classes = AcademyQueries.getClasses();

        return {
            // Characters
            totalCharacters: totalCharacters,
            deceasedCharacters: deceasedCharacters,
            students: students.length,
            instructors: instructors.length,

            // Teams
            totalTeams: teams.length,
            activeTeams: activeTeams,
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
            totalMissions: missions.length,
            activeMissions: activeMissions,
            completedMissions: completedMissions,
            cancelledMissions: cancelledMissions,

            // Academy
            totalClasses: classes.length
        };
    }

    // ============================================================
    // DERIVED VIEWS
    // ============================================================

    /**
     * Build a compact quick-stats projection from the full statistics.
     * 
     * @param {object} stats - Statistics from calculateStatistics()
     * @returns {object} Quick stats
     */
    function buildQuickStats(stats) {
        return {
            characters: stats.totalCharacters,
            students: stats.students,
            teams: stats.totalTeams,
            activeTeams: stats.activeTeams,
            tournaments: stats.totalTournaments,
            missions: stats.totalMissions,
            activeMissions: stats.activeMissions,
            classes: stats.totalClasses
        };
    }

    /**
     * Build a grouped domain-counts projection from the full statistics.
     * 
     * @param {object} stats - Statistics from calculateStatistics()
     * @returns {object} Domain-grouped counts
     */
    function buildDomainCounts(stats) {
        return {
            characters: {
                total: stats.totalCharacters,
                deceased: stats.deceasedCharacters,
                students: stats.students,
                instructors: stats.instructors
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
                classes: stats.totalClasses
            }
        };
    }

    // ============================================================
    // RECENT ACTIVITY
    // ============================================================

    /**
     * Get recent activity from ActivityLog.
     * 
     * ActivityLog.getHistory() returns entries newest-first (via unshift).
     * Entries are rendered as-is. The Dashboard does NOT:
     *   - invent activity from createdAt fields
     *   - resolve characters from metadata
     *   - reshape entries into a presentation model
     * 
     * The renderer decides how to display each entry.
     * 
     * @param {number} limit - Maximum entries to return
     * @returns {array} Array of activity log entries
     */
    function getRecentActivity(limit) {
        limit = limit || RECENT_ACTIVITY_LIMIT;

        var history = ActivityLog.getHistory();

        if (!Array.isArray(history)) {
            return [];
        }

        return history.slice(0, limit);
    }

    // ============================================================
    // DASHBOARD VIEW MODEL
    // ============================================================

    /**
     * Get the complete dashboard view model.
     * 
     * This is the single entry point for the Dashboard renderer.
     * Everything the Dashboard needs is returned from here.
     * 
     * @returns {object} Dashboard view model
     */
    function getDashboardViewModel() {
        // Calculate statistics once - all derived views use this value
        var statistics = calculateStatistics();

        return {
            // Application state
            currentYear: AppSettingsQueries.getCurrentYear(),

            // Statistics (full + derived)
            statistics: statistics,
            quickStats: buildQuickStats(statistics),
            domainCounts: buildDomainCounts(statistics),

            // Recent activity (raw ActivityLog entries)
            recentActivity: getRecentActivity(RECENT_ACTIVITY_LIMIT)
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardAggregator = {
        getDashboardViewModel: getDashboardViewModel
    };

})();