/**
 * js/modules/dashboard/dashboard-aggregator.js - Dashboard Aggregator
 *
 * Path: js/modules/dashboard/dashboard-aggregator.js
 *
 * READ-ONLY, PURE. No mutations, no DOM, no persistence.
 *
 * E1 addition: the returned view model now carries
 * `hasCustomCalendar`, a boolean the dashboard header uses to
 * decide whether the calendar-import button says "Import
 * calendar…" or "Replace calendar…". The value is read lazily
 * from CalendarConfig; when CalendarConfig is absent the field
 * is false and the button is not rendered.
 *
 * DEPENDENCIES (all required):
 *   - window.ApplicationSettingsQueries
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.TournamentQueries
 *   - window.MissionQueries
 *   - window.AcademyClasses
 *
 * DEPENDENCIES (lazy, optional):
 *   - window.CalendarConfig  (hasCustomCalendar flag)
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

    if (!window.ApplicationSettingsQueries ||
        typeof window.ApplicationSettingsQueries.getCurrentYear !== 'function') {
        missing.push('ApplicationSettingsQueries.getCurrentYear');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacters !== 'function') {
        missing.push('CharacterQueries.getCharacters');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeams !== 'function') {
        missing.push('TeamQueries.getTeams');
    }

    if (!window.TournamentQueries || typeof window.TournamentQueries.getTournaments !== 'function') {
        missing.push('TournamentQueries.getTournaments');
    }

    if (!window.MissionQueries || typeof window.MissionQueries.getMissions !== 'function') {
        missing.push('MissionQueries.getMissions');
    }

    if (!window.AcademyClasses || typeof window.AcademyClasses.getClasses !== 'function') {
        missing.push('AcademyClasses.getClasses');
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
    var AcademyClasses = window.AcademyClasses;

    // ============================================================
    // HELPERS
    // ============================================================

    function countBy(items, predicate) {
        var count = 0;
        for (var i = 0; i < items.length; i++) {
            if (predicate(items[i])) {
                count++;
            }
        }
        return count;
    }

    /**
     * Does the active project carry a custom calendar? Used only by
     * the dashboard header to choose the calendar-import button
     * label. Lazy: no hard dependency on CalendarConfig.
     */
    function hasCustomCalendar() {
        var cfg = window.CalendarConfig;
        if (!cfg || typeof cfg.getActiveCalendar !== 'function') {
            return false;
        }
        try {
            var cal = cfg.getActiveCalendar();
            return cal !== null && cal !== undefined;
        } catch (e) {
            return false;
        }
    }

    /**
     * Is the calendar-import button available at all? It is only
     * meaningful when both CalendarConfig and CalendarImport are
     * loaded. The renderer checks this before emitting the button.
     */
    function isCalendarImportAvailable() {
        return !!(window.CalendarConfig && window.CalendarImport);
    }

    // ============================================================
    // STATISTICS - calculated once per view model
    // ============================================================

    function calculateStatistics() {
        var characters = CharacterQueries.getCharacters();
        var totalCharacters = characters.length;
        var deceasedCharacters = countBy(characters, function(c) {
            return c && c.deceased === true;
        });

        var students = CharacterQueries.getStudents();
        var instructors = CharacterQueries.getInstructors();

        var teams = TeamQueries.getTeams();
        var activeTeams = countBy(teams, function(t) {
            return t && t.status === 'active';
        });
        var professionalTeams = countBy(teams, function(t) { return t && t.type === 'professional'; });
        var temporaryTeams = countBy(teams, function(t) { return t && t.type === 'temporary'; });
        var civilianTeams = countBy(teams, function(t) { return t && t.type === 'civilian'; });
        var academicTeams = countBy(teams, function(t) { return t && t.type === 'academic'; });

        var tournaments = TournamentQueries.getTournaments();
        var activeTournaments = countBy(tournaments, function(t) { return t && t.status === 'active'; });
        var completedTournaments = countBy(tournaments, function(t) { return t && t.status === 'completed'; });
        var draftTournaments = countBy(tournaments, function(t) { return t && t.status === 'draft'; });

        var missions = MissionQueries.getMissions();
        var activeMissions = countBy(missions, function(m) { return m && m.status === 'active'; });
        var completedMissions = countBy(missions, function(m) { return m && m.status === 'completed'; });
        var cancelledMissions = countBy(missions, function(m) { return m && m.status === 'cancelled'; });

        var classes = AcademyClasses.getClasses();

        return {
            totalCharacters: totalCharacters,
            deceasedCharacters: deceasedCharacters,
            students: students.length,
            instructors: instructors.length,

            totalTeams: teams.length,
            activeTeams: activeTeams,
            professionalTeams: professionalTeams,
            temporaryTeams: temporaryTeams,
            civilianTeams: civilianTeams,
            academicTeams: academicTeams,

            totalTournaments: tournaments.length,
            activeTournaments: activeTournaments,
            completedTournaments: completedTournaments,
            draftTournaments: draftTournaments,

            totalMissions: missions.length,
            activeMissions: activeMissions,
            completedMissions: completedMissions,
            cancelledMissions: cancelledMissions,

            totalClasses: classes.length
        };
    }

    // ============================================================
    // DERIVED VIEWS
    // ============================================================

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
    // DASHBOARD VIEW MODEL
    // ============================================================

    function getDashboardViewModel() {
        var statistics = calculateStatistics();

        return {
            currentYear: AppSettingsQueries.getCurrentYear(),
            statistics: statistics,
            quickStats: buildQuickStats(statistics),
            domainCounts: buildDomainCounts(statistics),

            // E1: calendar-import affordance.
            hasCustomCalendar: hasCustomCalendar(),
            canImportCalendar: isCalendarImportAvailable()
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardAggregator = {
        getDashboardViewModel: getDashboardViewModel
    };

})();
