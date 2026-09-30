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
 *     RIGHT  team departures
 *              left a professional team
 *              left a professional team (died)
 *
 *   The "died" annotation is a suffix, not a separate event. It
 *   is emitted when the leave year equals the character's
 *   deathYear. A character who dies on no teams produces no event
 *   at all.
 *
 *   For each team that lost at least one member in a given year,
 *   the row also carries the team's remaining roster AFTER the
 *   year's departures are applied:
 *
 *     remainingMembers: [ 'Bob Jones', 'Carol Danvers' ] | null
 *
 *   The roster is `getActiveTeamMembers(team, Y)` minus every
 *   character who left that team in year Y. `null` means the
 *   team is not active in year Y+1 (the team ended); the
 *   renderer skips the "now" line entirely.
 *
 *   Empty years are skipped. Only years with at least one event
 *   are emitted.
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
 * COMPOSITION SEMANTICS:
 *   The remaining roster for a team at year Y is computed as
 *   follows:
 *
 *     1. Read `getActiveTeamMembers(team, Y)`.
 *     2. Build a set of characterIds that left team X in year Y
 *        from the departure list.
 *     3. Remove every member whose characterId is in that set.
 *     4. If `isTeamActiveAtPeriod(team, Y+1)` is false, the
 *        remainingMembers value is null. The team ended; the
 *        renderer will not draw a "now" line.
 *
 *   The subtraction in step 3 is required because interval
 *   containment is inclusive: a member with `leavePeriod === Y`
 *   is still active at Y. Without the subtraction, a "now" line
 *   would show the character who just left.
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
     * Build the right-side events for one team.
     *
     * For each member, walk its intervals. A non-blank leavePeriod
     * in the range produces a departure event.
     *
     * Returns an array of departure events:
     *
     *   {
     *     year:           number,
     *     characterId:    string,
     *     characterName:  string,
     *     diedAtYear:     boolean,
     *     label:          string
     *   }
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

    // ============================================================
    // COMPOSITION
    // ============================================================

    /**
     * Compute the remaining roster for a team at year Y.
     *
     * Returns either:
     *   null   the team is not active in year Y+1, so there is no
     *          "now" line to render.
     *   []     the team is active but has no remaining members.
     *   [name, ...]  the remaining members, alphabetically sorted.
     *
     * @param {object} team
     * @param {number} year
     * @param {object} departingCharIds - set of characterIds that
     *                                    left THIS team in year
     * @returns {array|null}
     */
    function computeRemainingMembers(team, year, departingCharIds) {
        if (!team || !team.id) { return null; }

        // Is the team still active the year after? If not, skip
        // the "now" line entirely.
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

    /**
     * Build the timeline view model.
     *
     * @param {object} options
     * @param {number|string} options.start   inclusive range start
     * @param {number|string} options.end     inclusive range end
     * @returns {object} the VM
     */
    function buildTimelineViewModel(options) {
        options = options || {};

        var rawStart = parseYear(options.start);
        var rawEnd = parseYear(options.end);

        // Normalise a missing or inverted range to an empty one.
        // The renderer shows the range header regardless, so an
        // empty VM still carries the range it was asked for.
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

        // ---- Collect events, keyed by year. ----
        //
        // Two buckets: leftEvents by year, rightEvents by year.
        // Right-side events are grouped by team within each year,
        // later.
        var leftEvents = Object.create(null);
        var rightEventsByYear = Object.create(null);

        // Career transitions: one pass over every character.
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

        // Team departures: one pass over every professional team.
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

            var departures = collectTeamDepartures(
                team, rangeStart, rangeEnd
            );

            for (var d = 0; d < departures.length; d++) {
                var dep = departures[d];
                var y = dep.year;

                if (!rightEventsByYear[y]) {
                    rightEventsByYear[y] = Object.create(null);
                }
                var teamKey = String(team.id);
                if (!rightEventsByYear[y][teamKey]) {
                    rightEventsByYear[y][teamKey] = {
                        teamId: teamKey,
                        teamName: team.name || 'Unnamed Team',
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
                // Sort teams alphabetically by name for stable
                // output.
                teamKeys.sort(function(ka, kb) {
                    var na = teamGroupsRaw[ka].teamName || '';
                    var nb = teamGroupsRaw[kb].teamName || '';
                    return na.localeCompare(nb);
                });

                for (var tk = 0; tk < teamKeys.length; tk++) {
                    var group = teamGroupsRaw[teamKeys[tk]];

                    // Sort departures alphabetically by character
                    // name.
                    group.departures.sort(function(a, b) {
                        return a.characterName.localeCompare(
                            b.characterName
                        );
                    });

                    // Find the team object once, for the roster
                    // computation. It's the same team we saw during
                    // the departure walk.
                    var teamObj = null;
                    for (var ft = 0; ft < teams.length; ft++) {
                        if (String(teams[ft].id) === group.teamId) {
                            teamObj = teams[ft];
                            break;
                        }
                    }

                    var remaining = null;
                    if (teamObj) {
                        remaining = computeRemainingMembers(
                            teamObj, year, group.departingCharIds
                        );
                    }

                    teamGroups.push({
                        teamId: group.teamId,
                        teamName: group.teamName,
                        departures: group.departures,
                        remainingMembers: remaining
                    });

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
