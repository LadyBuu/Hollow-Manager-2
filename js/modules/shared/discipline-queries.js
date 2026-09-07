/**
 * js/modules/shared/discipline-queries.js - Discipline Queries
 * Read-only discipline queries
 */

(function() {
    'use strict';

    if (window.__disciplineQueriesLoaded) return;
    window.__disciplineQueriesLoaded = true;

    function getDisciplines() {
        var data = window.data;
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }
        return data.curriculum.disciplines.slice();
    }

    function getDiscipline(id) {
        if (!id) return null;
        var disciplines = getDisciplines();
        for (var i = 0; i < disciplines.length; i++) {
            if (String(disciplines[i].id) === String(id)) {
                return disciplines[i];
            }
        }
        return null;
    }

    function getAvailableDisciplines(week) {
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) return [];
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

    window.DisciplineQueries = {
        getDisciplines: getDisciplines,
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines
    };
})();
