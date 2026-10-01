/**
 * modules/teams/timeline-queries.js - Timeline View Model Builder
 * Pure projection. Produces a year-indexed timeline of team and
 * career events.
 *
 * Path: js/modules/teams/timeline-queries.js
 *
 * WHAT THIS MODULE DOES:
 *   Given a year range and the current data store, produces a
 *   sorted list of year rows. Each row carries the events that
 *   happened in that year, split into two sides:
 *
 *     LEFT   career transitions
 *              became Junior
 *              became Senior
 *              became Support
 *              became Instructor
 *
 *     RIGHT  team events
 *              team formed
 *              member left a professional team
 *
 *   The "left ... (died)" annotation is a suffix on a departure,
 *   not a separate event. A character who dies on no teams
 *   produces no event at all.
 *
 *   Each right-side event is grouped by team. Within a group, the
 *   order is:
 *
 *     1. "Team X formed"   (only when the team formed this year)
 *     2. one line per departure
 *     3. "Team X now: ..."  (only when the team has a departure
 *                            this year and is still active next
 *                            year)
 *
 *   The roster on the "now" line is `getActiveTeamMembers(team, Y)`
 *   minus every character who left that team in year Y. `null`
 *   means the "now" line is not rendered — either the team ended,
 *   or the group has no departures this year (a formation-only
 *   row).
 *
 *   Empty years are skipped. Only years with at least one event
 *   (left or right) are emitted.
 *
 * IMPORTANT:
 *   - Pure. No DOM. No mutations. No persistence.
 *   - Reads CharacterQueries and TeamQueries only.
 *   - The VM is a plain object; the caller owns lifetime.
 *
 * YEAR SEMANTICS:
 *   - Years are unbounded positive integers.
 *   - The range is inclusive: [start, end].
 *   - When start > end, the range is normalised by swapping.
 *   - Invalid inputs (missing range) produce an empty VM with the
 *     given range echoed back, so the renderer can still draw the
 *     range header.
 *
 * DEATH ANNOTATION:
 *   `char.deathYear` is parsed with parseInt. When it is a valid
 *   integer >= 1 and equals the leave year, the departure is
 *   annotated as '(died)'. When it is missing or malformed, no
 *   annotation is added.
 *
 * FORMATION:
 *   `team.startPeriod` is parsed with TeamConstants.parsePeriod.
 *   A valid year in range produces a "Team X formed" event on the
 *   right side, above that team's departures for the same year
 *   (if any).
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.TeamConstants
 */

(function() {
    'use strict';

    if (window.__timelineQueriesLoaded) {
        return;
    }
    window.__timelineQueriesLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamConstants = window.TeamConstants;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamQueries ||
        typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries.isTeamActiveAtPeriod');
    }

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getJuniorYear !== 'function') {
        _missing.push('CharacterQueries.getJuniorYear');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getSeniorYear !== 'function') {
        _missing.push('CharacterQueries.getSeniorYear');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getSupportYear !== 'function') {
        _missing.push('CharacterQueries.getSupportYear');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getInstructorYear !== 'function') {
        _missing.push('CharacterQueries.getInstructorYear');
    }

    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TimelineQueries] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function parseYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function getDisplayName(char) {
        try {
            return CharacterQueries.getDisplayName(char) || 'Unknown';
        } catch (e) {
            return 'Unknown';
        }
    }

    // ============================================================
    // EVENT BUILDERS
    // ============================================================

    /**
     * Build the left-side events for a single character.
     *
     * Four event types, each keyed off a career-year getter. A
     * character can produce more than one event (junior in 1910,
     * senior in 1912, instructor in 1920), and each event goes
     * into the year bucket it belongs to.
     *
     * Events outside the range are dropped.
     */
    function collectCareerEvents(char, rangeStart, rangeEnd, bucket) {
        if (!char || !char.id) { return; }

        var charId = String(char.id);
        var name = getDisplayName(char);

        var careerEvents = [
            { year: CharacterQueries.getJuniorYear(char), type: 'junior', label: 'became Junior' },
            { year: CharacterQueries.getSeniorYear(char), type: 'senior', label: 'became Senior' },
            { year: CharacterQueries.getSupportYear(char), type: 'support', label: 'became Support' },
            { year: CharacterQueries.getInstructorYear(char), type: 'instructor', label: 'became Instructor' }
        ];

        for (var i = 0; i < careerEvents.length; i++) {
            var ev = careerEvents[i];
            var y = ev.year;
            if (y === null || y === undefined) { continue; }
            if (y < rangeStart || y > rangeEnd) { continue; }

            if (!bucket[y]) { bucket[y] = []; }
            bucket[y].push({
                type: ev.type,
                characterId: charId,
                characterName: name,
                label: name + ' ' + ev.label
            });
        }
    }

    /**
     * Build the right-side departure events for one team.
     *
     * For each member, walk its intervals. A non-blank leavePeriod
     * in the range produces a departure event.
     */
    function collectTeamDepartures(team, rangeStart, rangeEnd) {
        var departures = [];

        if (!team || !Array.isArray(team.members)) {
            return departures;
        }

        var teamName = team.name || 'Unnamed Team';

        for (var m = 0; m < team.members.length; m++) {
            var member = team.members[m];
            if (!member || !member.characterId) { continue; }
            if (!Array.isArray(member.intervals)) { continue; }

            var charId = String(member.characterId);
            var char = CharacterQueries.getCharacterById
                ? CharacterQueries.getCharacterById(charId)
                : null;
            var charName = char ? getDisplayName(char) : 'Unknown';
            var deathYear = char ? parseYear(char.deathYear) : null;

            for (var i = 0; i < member.intervals.length; i++) {
                var iv = member.intervals[i];
                if (!iv || typeof iv !== 'object') { continue; }

                var leaveYear = parseYear(iv.leavePeriod);
                if (leaveYear === null) { continue; }
                if (leaveYear < rangeStart || leaveYear > rangeEnd) {
                    continue;
                }

                var diedHere = (deathYear !== null &&
                                deathYear === leaveYear);

                var label = charName + ' left ' + teamName +
                    (diedHere ? ' (died)' : '');

                departures.push({
                    year: leaveYear,
                    characterId: charId,
                    characterName: charName,
                    diedAtYear: diedHere,
                    label: label
                });
            }
        }

        return departures;
    }

    /**
     * Return the year a team was formed, or null.
     *
     * Reads team.startPeriod via TeamConstants.parsePeriod. Blank
     * and malformed values return null.
     */
    function getTeamFormationYear(team) {
        if (!team || typeof team !== 'object') { return null; }
        var raw = team.startPeriod;
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        var n = TeamConstants.parsePeriod(raw);
        if (n === null) { return null; }
        return n;
    }

    // ============================================================
    // COMPOSITION
    // ============================================================

    /**
     * Compute the remaining roster for a team at year Y.
     *
     * Returns either:
     *   null   the team is not active in year Y+1, or the group
     *          has no departures this year (formation-only row).
     *   []     the team is active but has no remaining members.
     *   [name, ...]  the remaining members, alphabetically sorted.
     */
    function computeRemainingMembers(team, year, departingCharIds) {
        if (!team || !team.id) { return null; }

        var stillActive = false;
        try {
            stillActive = TeamQueries.isTeamActiveAtPeriod(
                team, year + 1
            ) === true;
        } catch (e) {
            stillActive = false;
        }

        if (!stillActive) {
            return null;
        }

        var members = [];
        try {
            members = TeamQueries.getActiveTeamMembers(team, year) || [];
        } catch (e) {
            members = [];
        }

        var remaining = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            if (!m || !m.characterId) { continue; }

            var cid = String(m.characterId);
            if (departingCharIds[cid]) { continue; }

            var char = CharacterQueries.getCharacterById
                ? CharacterQueries.getCharacterById(cid)
                : null;
            if (char) {
                remaining.push(getDisplayName(char));
            } else {
                remaining.push('Unknown');
            }
        }

        remaining.sort(function(a, b) {
            return a.localeCompare(b);
        });

        return remaining;
    }

    // ============================================================
    // BUILD
    // ============================================================

    function buildTimelineViewModel(options) {
        options = options || {};

        var rawStart = parseYear(options.start);
        var rawEnd = parseYear(options.end);

        if (rawStart === null) {
            return {
                range: { start: null, end: rawEnd },
                years: [],
                totalEvents: 0
            };
        }
        if (rawEnd === null) {
            return {
                range: { start: rawStart, end: null },
                years: [],
                totalEvents: 0
            };
        }

        var rangeStart = Math.min(rawStart, rawEnd);
        var rangeEnd = Math.max(rawStart, rawEnd);

        // ---- Buckets. ----
        var leftEvents = Object.create(null);
        var rightEventsByYear = Object.create(null);

        // ---- Career transitions: one pass over every character. ----
        var allChars = [];
        try {
            allChars = CharacterQueries.getCharacters() || [];
        } catch (e) {
            allChars = [];
        }
        for (var c = 0; c < allChars.length; c++) {
            collectCareerEvents(
                allChars[c], rangeStart, rangeEnd, leftEvents
            );
        }

        // ---- Teams: one pass over every professional team. ----
        var teams = [];
        try {
            teams = TeamQueries.getTeams(
                'professional', null, false
            ) || [];
        } catch (e) {
            teams = [];
        }

        for (var t = 0; t < teams.length; t++) {
            var team = teams[t];
            if (!team || !team.id) { continue; }

            var teamKey = String(team.id);
            var teamName = team.name || 'Unnamed Team';

            // ---- Formation event. ----
            var formedYear = getTeamFormationYear(team);
            if (formedYear !== null &&
                formedYear >= rangeStart &&
                formedYear <= rangeEnd) {

                if (!rightEventsByYear[formedYear]) {
                    rightEventsByYear[formedYear] = Object.create(null);
                }
                if (!rightEventsByYear[formedYear][teamKey]) {
                    rightEventsByYear[formedYear][teamKey] = {
                        teamId: teamKey,
                        teamName: teamName,
                        formedThisYear: false,
                        departures: [],
                        departingCharIds: Object.create(null)
                    };
                }
                rightEventsByYear[formedYear][teamKey].formedThisYear = true;
            }

            // ---- Departure events. ----
            var departures = collectTeamDepartures(
                team, rangeStart, rangeEnd
            );

            for (var d = 0; d < departures.length; d++) {
                var dep = departures[d];
                var y = dep.year;

                if (!rightEventsByYear[y]) {
                    rightEventsByYear[y] = Object.create(null);
                }
                if (!rightEventsByYear[y][teamKey]) {
                    rightEventsByYear[y][teamKey] = {
                        teamId: teamKey,
                        teamName: teamName,
                        formedThisYear: false,
                        departures: [],
                        departingCharIds: Object.create(null)
                    };
                }
                rightEventsByYear[y][teamKey].departures.push({
                    characterId: dep.characterId,
                    characterName: dep.characterName,
                    diedAtYear: dep.diedAtYear,
                    label: dep.label
                });
                rightEventsByYear[y][teamKey]
                    .departingCharIds[dep.characterId] = true;
            }
        }

        // ---- Collect every year that has at least one event. ----
        var yearSet = Object.create(null);
        var yk;

        for (yk in leftEvents) {
            if (Object.prototype.hasOwnProperty.call(leftEvents, yk)) {
                yearSet[yk] = true;
            }
        }
        for (yk in rightEventsByYear) {
            if (Object.prototype.hasOwnProperty.call(
                rightEventsByYear, yk
            )) {
                yearSet[yk] = true;
            }
        }

        var years = Object.keys(yearSet)
            .map(function(k) { return parseInt(k, 10); })
            .filter(function(n) { return !isNaN(n); })
            .sort(function(a, b) { return a - b; });

        // ---- Build the year rows. ----
        var rows = [];
        var totalEvents = 0;

        for (var yi = 0; yi < years.length; yi++) {
            var year = years[yi];

            // -- Left side: career transitions. --
            var leftList = leftEvents[year] || [];
            leftList.sort(function(a, b) {
                return a.characterName.localeCompare(b.characterName);
            });

            // -- Right side: team groups. --
            var teamGroupsRaw = rightEventsByYear[year];
            var teamGroups = [];

            if (teamGroupsRaw) {
                var teamKeys = Object.keys(teamGroupsRaw);

                teamKeys.sort(function(ka, kb) {
                    var na = teamGroupsRaw[ka].teamName || '';
                    var nb = teamGroupsRaw[kb].teamName || '';
                    return na.localeCompare(nb);
                });

                for (var tk = 0; tk < teamKeys.length; tk++) {
                    var group = teamGroupsRaw[teamKeys[tk]];
                    var hasDepartures = group.departures.length > 0;

                    // Sort departures alphabetically by name.
                    group.departures.sort(function(a, b) {
                        return a.characterName.localeCompare(
                            b.characterName
                        );
                    });

                    // Composition: only meaningful when there are
                    // departures this year. A formation-only group
                    // carries remainingMembers = null.
                    var remaining = null;
                    if (hasDepartures) {
                        var teamObj = null;
                        for (var ft = 0; ft < teams.length; ft++) {
                            if (String(teams[ft].id) === group.teamId) {
                                teamObj = teams[ft];
                                break;
                            }
                        }
                        if (teamObj) {
                            remaining = computeRemainingMembers(
                                teamObj, year,
                                group.departingCharIds
                            );
                        }
                    }

                    teamGroups.push({
                        teamId: group.teamId,
                        teamName: group.teamName,
                        formedThisYear: group.formedThisYear === true,
                        departures: group.departures,
                        remainingMembers: remaining
                    });

                    // Count.
                    if (group.formedThisYear) { totalEvents++; }
                    totalEvents += group.departures.length;
                }
            }

            totalEvents += leftList.length;

            rows.push({
                year: year,
                left: leftList,
                right: teamGroups
            });
        }

        return {
            range: { start: rangeStart, end: rangeEnd },
            years: rows,
            totalEvents: totalEvents
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TimelineQueries = Object.freeze({
        buildTimelineViewModel: buildTimelineViewModel
    });

})();
