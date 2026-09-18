/**
 * Version 25 migration — Year-scoped eliminations.
 *
 * WHY:
 *   Before v25, elimination records carried only a `week` (1-52).
 *   That was fine for tournament-internal ordering, but it was the
 *   wrong unit for the character list's "is this character
 *   eliminated?" filter. Weeks are relative to a year. Without a
 *   year, the filter either defaulted to week 1 (nothing ever
 *   filtered) or was ambiguous across year boundaries.
 *
 *   v25 adds a required integer `year` to every elimination record
 *   on every character. The year is the year the character was
 *   eliminated — the year of the class that ran the exam, or the
 *   year of the drop-out.
 *
 * SEMANTICS (going forward):
 *   An elimination at year Y means eliminated from year Y onward.
 *   A query "is this character eliminated as of year Y?" answers
 *   yes iff the character has an elimination record with
 *   `year <= Y`.
 *
 * RESOLUTION ORDER (backfill, existing records):
 *   1. If the elimination's `tournamentId` resolves to a tournament
 *      whose `graduatingClassId` resolves to a class with a numeric
 *      `year`, use that class's year.
 *   2. Otherwise, if the character is a member of exactly one class
 *      with a numeric `year`, use that class's year.
 *   3. Otherwise, fall back to `data.currentYear` (or the current
 *      calendar year if that is missing) and count the record as
 *      "unresolved".
 *
 * WHAT THIS MIGRATION DOES:
 *   - Adds `year` to every elimination record that lacks one.
 *   - Logs a summary count of resolved, unresolved, and skipped
 *     records.
 *
 * WHAT THIS MIGRATION DOES NOT DO:
 *   - It does NOT touch the `week` field. Week is retained as-is.
 *   - It does NOT re-derive eliminations from any other source.
 *   - It does NOT delete any elimination.
 *   - It does NOT touch tournament-side elimination records. Only
 *     character-side records carry a year; the tournament itself is
 *     year-scoped and its eliminations inherit that scope.
 *
 * @param {object} data
 */
function migrateToVersion25(data) {
    if (!Array.isArray(data.characters)) {
        data._dataVersion = 25;
        return;
    }

    var fallbackYear;
    if (typeof data.currentYear === 'number' &&
        isFinite(data.currentYear) &&
        data.currentYear > 0) {
        fallbackYear = Math.floor(data.currentYear);
    } else {
        fallbackYear = new Date().getFullYear();
    }

    var classes = (data.academy && data.academy.graduatingClasses)
        ? data.academy.graduatingClasses
        : {};
    var tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];

    function findClassYear(classId) {
        if (!classId) { return null; }
        var cls = classes[classId];
        if (!cls) { return null; }
        var y = parseInt(cls.year, 10);
        return isNaN(y) ? null : y;
    }

    function findTournamentYear(tournamentId) {
        if (!tournamentId) { return null; }
        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (t && String(t.id) === String(tournamentId)) {
                return findClassYear(t.graduatingClassId);
            }
        }
        return null;
    }

    function findSoleClassYearForCharacter(char) {
        var ids = Array.isArray(char.classIds) ? char.classIds : [];
        if (ids.length !== 1) { return null; }
        return findClassYear(ids[0]);
    }

    var resolvedFromTournament = 0;
    var resolvedFromSoleClass = 0;
    var resolvedFromFallback = 0;
    var alreadyPresent = 0;
    var recordsSeen = 0;

    for (var c = 0; c < data.characters.length; c++) {
        var char = data.characters[c];
        if (!char || !Array.isArray(char.eliminations)) { continue; }

        for (var e = 0; e < char.eliminations.length; e++) {
            var elim = char.eliminations[e];
            if (!elim || typeof elim !== 'object') { continue; }

            recordsSeen++;

            if (typeof elim.year === 'number' &&
                isFinite(elim.year) &&
                elim.year > 0) {
                alreadyPresent++;
                continue;
            }

            var resolved = null;
            var source = null;

            if (elim.tournamentId) {
                resolved = findTournamentYear(elim.tournamentId);
                if (resolved !== null) { source = 'tournament'; }
            }

            if (resolved === null) {
                resolved = findSoleClassYearForCharacter(char);
                if (resolved !== null) { source = 'sole-class'; }
            }

            if (resolved === null) {
                resolved = fallbackYear;
                source = 'fallback';
            }

            elim.year = resolved;

            if (source === 'tournament') { resolvedFromTournament++; }
            else if (source === 'sole-class') { resolvedFromSoleClass++; }
            else { resolvedFromFallback++; }
        }
    }

    console.log(
        '[Database] v25: year-scoped eliminations. ' +
        'Records seen: ' + recordsSeen + '. ' +
        'Already had year: ' + alreadyPresent + '. ' +
        'Resolved from tournament: ' + resolvedFromTournament + '. ' +
        'Resolved from sole class: ' + resolvedFromSoleClass + '. ' +
        'Fallback to currentYear: ' + resolvedFromFallback + '.'
    );

    if (resolvedFromFallback > 0) {
        console.warn(
            '[Database] v25: ' + resolvedFromFallback +
            ' elimination record(s) could not be resolved from their ' +
            'class context and were stamped with the fallback year (' +
            fallbackYear + '). Review if these records matter. ' +
            'The character list will filter them as eliminated for ' +
            'year ' + fallbackYear + ' and later.'
        );
    }

    data._dataVersion = 25;
}
