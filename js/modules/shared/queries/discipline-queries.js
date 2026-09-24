/**
 * shared/queries/discipline-queries.js - Discipline Queries
 * Read-only discipline domain queries.
 *
 * IMPORTANT:
 *   - READ ONLY - no mutations.
 *   - No dependencies on other modules.
 *   - Reads from window.data directly.
 *
 * STORAGE NAMESPACE (v28):
 *   Disciplines live at academy.disciplines. The legacy
 *   curriculum.disciplines location was retired when the last
 *   surviving store moved under academy.*.
 *
 *   Reads never create structure. When academy or
 *   academy.disciplines is missing, this module returns [] / null.
 *
 * DEPENDENCIES:
 *   - window.data (canonical state)
 */

(function() {
    'use strict';

    if (window.__disciplineQueriesLoaded) { return; }
    window.__disciplineQueriesLoaded = true;

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getAcademyStore() {
        var data = window.data;
        if (!data || typeof data !== 'object') {
            return null;
        }
        if (!data.academy || typeof data.academy !== 'object') {
            return null;
        }
        return data.academy;
    }

    function getDisciplinesArray() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }
        if (!Array.isArray(academy.disciplines)) {
            return null;
        }
        return academy.disciplines;
    }

    // ============================================================
    // READS
    // ============================================================

    /**
     * Get a shallow copy of every discipline record.
     * Returns [] when the store is missing.
     */
    function getDisciplines() {
        var disciplines = getDisciplinesArray();
        if (!disciplines) {
            return [];
        }
        return disciplines.slice();
    }

    /**
     * Get a discipline by ID. Returns the live record or null.
     */
    function getDiscipline(id) {
        if (!id) { return null; }
        var disciplines = getDisciplines();
        for (var i = 0; i < disciplines.length; i++) {
            if (String(disciplines[i].id) === String(id)) {
                return disciplines[i];
            }
        }
        return null;
    }

    /**
     * Get disciplines active in the given week.
     *
     * A discipline is active when its [startWeek, endWeek] range
     * contains the week. Missing bounds fall back to the canonical
     * year range: startWeek defaults to 1, endWeek defaults to 52.
     */
    function getAvailableDisciplines(week) {
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) { return []; }
        var disciplines = getDisciplines();
        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var startWeek = parseInt(d.startWeek, 10) || 1;
            var endWeek = parseInt(d.endWeek, 10) || 52;
            if (weekNum >= startWeek && weekNum <= endWeek) {
                result.push(d);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DisciplineQueries = {
        getDisciplines: getDisciplines,
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines
    };

})();
