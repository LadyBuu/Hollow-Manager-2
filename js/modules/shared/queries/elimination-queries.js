/**
 * shared/queries/elimination-queries.js - Elimination Queries
 * Read-only elimination domain queries
 */

(function() {
    'use strict';

    if (window.__eliminationQueriesLoaded) { return; }
    window.__eliminationQueriesLoaded = true;

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    function isCharacterEliminated(charId, week) {
        if (!charId) { return false; }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < 1) { return false; }

        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var char = chars[i];
            if (String(char.id) !== String(charId)) { continue; }
            if (!char || !Array.isArray(char.eliminations)) { return false; }

            for (var j = 0; j < char.eliminations.length; j++) {
                var elim = char.eliminations[j];
                var elimWeek = parseInt(elim.week, 10);
                if (!isNaN(elimWeek) && elimWeek >= 1 && elimWeek <= 52 && elimWeek <= weekNum) {
                    return true;
                }
            }

            if (char.deceased) {
                var deathWeek = parseInt(char.deathWeek, 10);
                if (!isNaN(deathWeek) && deathWeek >= 1 && deathWeek <= 52 && deathWeek <= weekNum) {
                    return true;
                }
                if (char.deathWeek === undefined || char.deathWeek === null || char.deathWeek === '') {
                    return true;
                }
            }

            return false;
        }

        return false;
    }

    function getEliminationWeek(charId) {
        if (!charId) { return null; }
        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var char = chars[i];
            if (String(char.id) !== String(charId)) { continue; }
            if (!char || !Array.isArray(char.eliminations)) { return null; }

            var earliestWeek = null;
            for (var j = 0; j < char.eliminations.length; j++) {
                var elim = char.eliminations[j];
                var elimWeek = parseInt(elim.week, 10);
                if (!isNaN(elimWeek) && elimWeek >= 1 && elimWeek <= 52) {
                    if (earliestWeek === null || elimWeek < earliestWeek) {
                        earliestWeek = elimWeek;
                    }
                }
            }

            if (char.deceased) {
                var deathWeek = parseInt(char.deathWeek, 10);
                if (!isNaN(deathWeek) && deathWeek >= 1 && deathWeek <= 52) {
                    if (earliestWeek === null || deathWeek < earliestWeek) {
                        earliestWeek = deathWeek;
                    }
                } else if (char.deathWeek === undefined || char.deathWeek === null || char.deathWeek === '') {
                    if (earliestWeek === null || 1 < earliestWeek) {
                        earliestWeek = 1;
                    }
                }
            }

            return earliestWeek;
        }
        return null;
    }

    function getEliminationReason(charId) {
        if (!charId) { return 'Unknown'; }
        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var char = chars[i];
            if (String(char.id) !== String(charId)) { continue; }
            if (!char || !Array.isArray(char.eliminations)) { return 'Unknown'; }

            for (var j = 0; j < char.eliminations.length; j++) {
                var elim = char.eliminations[j];
                if (elim && elim.reason) {
                    return elim.reason;
                }
            }

            if (char.deceased && char.deathCause) {
                return 'Deceased: ' + char.deathCause;
            }
            if (char.deceased) {
                return 'Deceased';
            }

            return 'Unknown';
        }
        return 'Unknown';
    }

    window.EliminationQueries = {
        isCharacterEliminated: isCharacterEliminated,
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason
    };

})();
