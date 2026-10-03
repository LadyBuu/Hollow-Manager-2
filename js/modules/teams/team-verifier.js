/**
 * modules/teams/team-verifier.js - Team Verifier
 * Read-only consistency checks for professional and temporary
 * teams.
 *
 * Path: js/modules/teams/team-verifier.js
 *
 * WHAT THIS OWNS:
 *   - The list of consistency checks.
 *   - Walking the team store and running every check.
 *   - Returning findings grouped by team and by severity.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Rendering. TeamVerifierView owns the modal.
 *   - Mutations. The verifier never writes. Fixes happen through
 *     the normal team edit and member manager flows.
 *   - Reads beyond window.data.teams and CharacterQueries. No
 *     aggregator, no UI, no pipeline.
 *
 * SCOPE:
 *   Professional and temporary teams only. Civilian and academic
 *   teams are skipped because their timing semantics differ
 *   (academic uses weeks, not years) and their invariants are
 *   enforced by the academy modules.
 *
 * CHECKS:
 *   Each check has an id, a severity, a human-readable title,
 *   and a message template. Findings carry the check id plus
 *   enough context for the view to render a useful row.
 *
 *   Severity 'error' means the record is internally inconsistent
 *   and cannot be reconciled: leave before join, leave after
 *   death, missing character, etc.
 *
 *   Severity 'warning' means the record is odd but not
 *   necessarily wrong: team start period disagrees with member
 *   joins, member joins before the team's start period, etc.
 *
 *   Checks:
 *
 *     1. leave-before-join
 *          An interval whose leavePeriod is strictly before its
 *          joinPeriod.
 *
 *     2. join-after-death
 *          An interval whose joinPeriod is strictly after the
 *          member character's deathYear.
 *
 *     3. leave-after-death
 *          An interval whose leavePeriod is strictly after the
 *          member character's deathYear.
 *
 *     4. open-stint-after-death
 *          An interval with a blank leavePeriod on a character
 *          who has a deathYear set.
 *
 *     5. missing-character
 *          A member whose characterId does not resolve to a live
 *          character.
 *
 *     6. team-start-mismatch  (warning)
 *          The team's startPeriod is set, the team has at least
 *          one member with a parseable joinPeriod, and the
 *          earliest joinPeriod differs from the team's
 *          startPeriod.
 *
 *     7. member-join-before-team-start  (warning)
 *          A member interval whose joinPeriod is strictly before
 *          the team's startPeriod.
 *
 *     8. member-leave-after-team-end  (warning)
 *          A member interval whose leavePeriod is strictly after
 *          the team's endPeriod.
 *
 * PERIOD SEMANTICS:
 *   All comparisons use integer years. A blank leavePeriod is
 *   treated as Infinity where a comparison requires it. A blank
 *   joinPeriod is treated as -Infinity. Malformed values are
 *   ignored (the interval is skipped for that check).
 *
 *   The `team.startPeriod` and `team.endPeriod` are parsed via
 *   TeamConstants.parsePeriod, same as everything else. Blank
 *   values mean "not set" and skip the corresponding checks.
 *
 * DEATH YEAR:
 *   Parsed via parseInt on char.deathYear. A blank or malformed
 *   value means the character is not known to be dead and the
 *   death-related checks skip them.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 */

(function() {
    'use strict';

    if (window.__teamVerifierLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamVerifier] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamVerifierLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    // Scanned team types. Everything else is skipped.
    var SCANNED_TYPES = {
        'professional': true,
        'temporary': true
    };

    // Severity levels. Order matters for sorting.
    var SEVERITY_ORDER = {
        error: 0,
        warning: 1,
        info: 2
    };

    var CHECK_DEFINITIONS = {
        'leave-before-join': {
            id: 'leave-before-join',
            severity: 'error',
            title: 'Leave before join',
            description:
                'A stint ends before it starts.'
        },
        'join-after-death': {
            id: 'join-after-death',
            severity: 'error',
            title: 'Joined after death',
            description:
                'A character was added to the team after their ' +
                'death year.'
        },
        'leave-after-death': {
            id: 'leave-after-death',
            severity: 'error',
            title: 'Left after death',
            description:
                'A character left the team after their death year.'
        },
        'open-stint-after-death': {
            id: 'open-stint-after-death',
            severity: 'error',
            title: 'Open stint on deceased character',
            description:
                'A character with a death year has an open stint.'
        },
        'missing-character': {
            id: 'missing-character',
            severity: 'error',
            title: 'Missing character',
            description:
                'The member references a character that does not ' +
                'exist.'
        },
        'team-start-mismatch': {
            id: 'team-start-mismatch',
            severity: 'warning',
            title: 'Team start does not match earliest join',
            description:
                'The team startPeriod differs from the earliest ' +
                'member join period.'
        },
        'member-join-before-team-start': {
            id: 'member-join-before-team-start',
            severity: 'warning',
            title: 'Member joined before team start',
            description:
                'A member joined the team before the team\'s ' +
                'startPeriod.'
        },
        'member-leave-after-team-end': {
            id: 'member-leave-after-team-end',
            severity: 'warning',
            title: 'Member left after team end',
            description:
                'A member left the team after the team\'s ' +
                'endPeriod.'
        }
    };

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    /**
     * Parse a period value the same way the rest of the team
     * domain does. Returns null for blank or malformed values.
     */
    function parsePeriod(value) {
        return TeamConstants.parsePeriod(value);
    }

    /**
     * Read a raw period string from an interval. Blank fields
     * become ''.
     */
    function readRawPeriod(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).trim();
    }

    /**
     * Parse a death year off a character. Returns null when the
     * value is blank or malformed.
     */
    function parseDeathYear(char) {
        if (!char || typeof char !== 'object') { return null; }
        var raw = char.deathYear;
        if (raw === undefined || raw === null) { return null; }
        var s = String(raw).trim();
        if (s === '') { return null; }
        var n = parseInt(s, 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function getDisplayName(char) {
        if (!char) { return 'Unknown'; }
        try {
            var name = CharacterQueries.getDisplayName(char);
            return name || 'Unknown';
        } catch (e) {
            return 'Unknown';
        }
    }

    function getCharacterById(charId) {
        if (!isNonEmptyString(charId)) { return null; }
        try {
            return CharacterQueries.getCharacterById(charId) || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Comparison helper: is `a` strictly before `b`?
     * Blank values are treated as ±Infinity where appropriate.
     */
    function isStrictlyBefore(a, b) {
        if (a === null || b === null) { return false; }
        return a < b;
    }

    function isStrictlyAfter(a, b) {
        if (a === null || b === null) { return false; }
        return a > b;
    }

    // ============================================================
    // CHECK DEFINITIONS ACCESS
    // ============================================================

    function getCheckDefinition(id) {
        return CHECK_DEFINITIONS[id] || null;
    }

    function getCheckIds() {
        return Object.keys(CHECK_DEFINITIONS);
    }

    // ============================================================
    // FINDING BUILDERS
    // ============================================================
    //
    // Every finding carries enough context for the view to render
    // one row per finding with the character name, the team name,
    // the specific interval involved, and a human sentence.
    //
    // Findings are plain objects. The view does not assume any
    // particular subtype beyond the fields documented here.

    function makeFinding(checkId, team, extra) {
        var def = getCheckDefinition(checkId);
        if (!def) { return null; }

        var base = {
            checkId: checkId,
            severity: def.severity,
            title: def.title,
            message: '',           // filled by caller
            teamId: team && team.id ? String(team.id) : null,
            teamName: team && team.name ? team.name : 'Unnamed Team',
            teamType: team && team.type ? team.type : '',

            characterId: null,
            characterName: '',
            memberId: null,

            joinPeriod: '',
            leavePeriod: '',
            deathYear: null,

            context: ''
        };

        if (extra && typeof extra === 'object') {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) {
                    base[k] = extra[k];
                }
            }
        }

        return base;
    }

    // ============================================================
    // INTERVAL WALK
    // ============================================================
    //
    // Iterate every interval on every member of a team. The
    // callback receives:
    //   member       the raw member entry
    //   memberIdx    its index in team.members
    //   interval     the raw interval
    //   intervalIdx  its index in member.intervals
    //   char         the resolved character record, or null
    //   charId       the member's characterId as a string

    function walkIntervals(team, callback) {
        if (!team || !Array.isArray(team.members)) { return; }

        for (var m = 0; m < team.members.length; m++) {
            var member = team.members[m];
            if (!isPlainObject(member)) { continue; }

            var charId = isNonEmptyString(member.characterId)
                ? String(member.characterId)
                : null;
            var char = charId ? getCharacterById(charId) : null;

            if (!Array.isArray(member.intervals)) {
                // No intervals to walk. Still emit the member so
                // the missing-character check can fire.
                callback(member, m, null, -1, char, charId);
                continue;
            }

            for (var i = 0; i < member.intervals.length; i++) {
                callback(
                    member, m, member.intervals[i], i, char, charId
                );
            }
        }
    }

    // ============================================================
    // INDIVIDUAL CHECKS
    // ============================================================

    /**
     * Check 5 (missing character). Runs once per member entry,
     * not per interval.
     */
    function checkMissingCharacter(team, findings) {
        if (!team || !Array.isArray(team.members)) { return; }

        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!isPlainObject(member)) { continue; }

            var charId = isNonEmptyString(member.characterId)
                ? String(member.characterId)
                : null;
            if (!charId) { continue; }

            var char = getCharacterById(charId);
            if (char) { continue; }

            var finding = makeFinding(
                'missing-character',
                team,
                {
                    characterId: charId,
                    characterName: charId,
                    memberId: isNonEmptyString(member.memberId)
                        ? String(member.memberId) : null,
                    message:
                        'Member "' + charId + '" has no matching ' +
                        'character record.'
                }
            );
            if (finding) { findings.push(finding); }
        }
    }

    /**
     * Checks 1, 2, 3, 4 (interval-level). Runs once per interval.
     */
    function checkIntervals(team, findings) {
        if (!team || !Array.isArray(team.members)) { return; }

        walkIntervals(team, function(
            member, memberIdx, interval, intervalIdx, char, charId
        ) {
            if (!interval) { return; }

            var joinRaw = readRawPeriod(interval.joinPeriod);
            var leaveRaw = readRawPeriod(interval.leavePeriod);

            var joinNum = parsePeriod(joinRaw);
            var leaveNum = parsePeriod(leaveRaw);

            var charName = char ? getDisplayName(char) : charId;
            var memberId = isNonEmptyString(member.memberId)
                ? String(member.memberId) : null;

            var deathYear = parseDeathYear(char);

            var common = {
                characterId: charId,
                characterName: charName,
                memberId: memberId,
                joinPeriod: joinRaw,
                leavePeriod: leaveRaw,
                deathYear: deathYear
            };

            // ---- 1. leave before join ----
            if (joinNum !== null && leaveNum !== null &&
                leaveNum < joinNum) {
                var f1 = makeFinding('leave-before-join', team, {
                    characterId: charId,
                    characterName: charName,
                    memberId: memberId,
                    joinPeriod: joinRaw,
                    leavePeriod: leaveRaw,
                    deathYear: deathYear,
                    message:
                        charName + '\'s stint ends in ' + leaveRaw +
                        ' but starts in ' + joinRaw + '.'
                });
                if (f1) { findings.push(f1); }
            }

            // ---- 2. join after death ----
            if (joinNum !== null && deathYear !== null &&
                joinNum > deathYear) {
                var f2 = makeFinding('join-after-death', team, {
                    characterId: charId,
                    characterName: charName,
                    memberId: memberId,
                    joinPeriod: joinRaw,
                    leavePeriod: leaveRaw,
                    deathYear: deathYear,
                    message:
                        charName + ' joined in ' + joinRaw +
                        ' but died in ' + String(deathYear) + '.'
                });
                if (f2) { findings.push(f2); }
            }

            // ---- 3. leave after death ----
            if (leaveNum !== null && deathYear !== null &&
                leaveNum > deathYear) {
                var f3 = makeFinding('leave-after-death', team, {
                    characterId: charId,
                    characterName: charName,
                    memberId: memberId,
                    joinPeriod: joinRaw,
                    leavePeriod: leaveRaw,
                    deathYear: deathYear,
                    message:
                        charName + ' left in ' + leaveRaw +
                        ' but died in ' + String(deathYear) + '.'
                });
                if (f3) { findings.push(f3); }
            }

            // ---- 4. open stint after death ----
            if (leaveNum === null && deathYear !== null) {
                var f4 = makeFinding(
                    'open-stint-after-death',
                    team,
                    {
                        characterId: charId,
                        characterName: charName,
                        memberId: memberId,
                        joinPeriod: joinRaw,
                        leavePeriod: leaveRaw,
                        deathYear: deathYear,
                        message:
                            charName + ' died in ' +
                            String(deathYear) + ' but still has an ' +
                            'open stint on this team.'
                    }
                );
                if (f4) { findings.push(f4); }
            }
        });
    }

    /**
     * Checks 6, 7, 8 (team-window vs. member-interval alignment).
     * Runs once per team, then once per interval where needed.
     */
    function checkTeamWindow(team, findings) {
        if (!team || !Array.isArray(team.members)) { return; }

        var startRaw = readRawPeriod(team.startPeriod);
        var endRaw = readRawPeriod(team.endPeriod);

        var startNum = parsePeriod(startRaw);
        var endNum = parsePeriod(endRaw);

        // ---- 6. team-start-mismatch (warning) ----
        //
        // Only runs when the team has a startPeriod and at least
        // one member has a parseable join. Fires when the earliest
        // join across all members differs from the team's start.
        if (startNum !== null) {
            var earliestJoin = null;
            var earliestJoinRaw = '';

            walkIntervals(team, function(
                member, memberIdx, interval, intervalIdx,
                char, charId
            ) {
                if (!interval) { return; }
                var jn = parsePeriod(interval.joinPeriod);
                if (jn === null) { return; }
                if (earliestJoin === null || jn < earliestJoin) {
                    earliestJoin = jn;
                    earliestJoinRaw = readRawPeriod(
                        interval.joinPeriod
                    );
                }
            });

            if (earliestJoin !== null &&
                earliestJoin !== startNum) {
                var f6 = makeFinding('team-start-mismatch', team, {
                    joinPeriod: earliestJoinRaw,
                    message:
                        'Team starts in ' + startRaw +
                        ' but the earliest member joined in ' +
                        earliestJoinRaw + '.'
                });
                if (f6) { findings.push(f6); }
            }
        }

        // ---- 7. member-join-before-team-start (warning) ----
        if (startNum !== null) {
            walkIntervals(team, function(
                member, memberIdx, interval, intervalIdx,
                char, charId
            ) {
                if (!interval) { return; }

                var joinRaw = readRawPeriod(interval.joinPeriod);
                var joinNum = parsePeriod(joinRaw);
                if (joinNum === null) { return; }
                if (joinNum >= startNum) { return; }

                var charName = char ? getDisplayName(char) : charId;
                var memberId = isNonEmptyString(member.memberId)
                    ? String(member.memberId) : null;

                var f7 = makeFinding(
                    'member-join-before-team-start',
                    team,
                    {
                        characterId: charId,
                        characterName: charName,
                        memberId: memberId,
                        joinPeriod: joinRaw,
                        leavePeriod: readRawPeriod(
                            interval.leavePeriod
                        ),
                        deathYear: parseDeathYear(char),
                        message:
                            charName + ' joined in ' + joinRaw +
                            ' before the team started in ' +
                            startRaw + '.'
                    }
                );
                if (f7) { findings.push(f7); }
            });
        }

        // ---- 8. member-leave-after-team-end (warning) ----
        if (endNum !== null) {
            walkIntervals(team, function(
                member, memberIdx, interval, intervalIdx,
                char, charId
            ) {
                if (!interval) { return; }

                var leaveRaw = readRawPeriod(interval.leavePeriod);
                var leaveNum = parsePeriod(leaveRaw);
                if (leaveNum === null) { return; }
                if (leaveNum <= endNum) { return; }

                var charName = char ? getDisplayName(char) : charId;
                var memberId = isNonEmptyString(member.memberId)
                    ? String(member.memberId) : null;

                var f8 = makeFinding(
                    'member-leave-after-team-end',
                    team,
                    {
                        characterId: charId,
                        characterName: charName,
                        memberId: memberId,
                        joinPeriod: readRawPeriod(
                            interval.joinPeriod
                        ),
                        leavePeriod: leaveRaw,
                        deathYear: parseDeathYear(char),
                        message:
                            charName + ' left in ' + leaveRaw +
                            ' after the team ended in ' +
                            endRaw + '.'
                    }
                );
                if (f8) { findings.push(f8); }
            });
        }
    }

    // ============================================================
    // TOP-LEVEL WALK
    // ============================================================

    /**
     * Walk every professional and temporary team and collect
     * findings. Returns a result object:
     *
     *   {
     *     scannedTeams:      number,
     *     scannedMembers:    number,
     *     scannedIntervals:  number,
     *     findings:          [ finding, ... ],
     *     summary: {
     *       total:    number,
     *       errors:   number,
     *       warnings: number,
     *       byCheck:  { [checkId]: count }
     *     }
     *   }
     */
    function runChecks(options) {
        options = options || {};

        var result = {
            scannedTeams: 0,
            scannedMembers: 0,
            scannedIntervals: 0,
            findings: [],
            summary: {
                total: 0,
                errors: 0,
                warnings: 0,
                byCheck: {}
            }
        };

        var allTeams;
        try {
            allTeams = TeamQueries.getTeams(null, null, true) || [];
        } catch (e) {
            console.warn(
                '[TeamVerifier] getTeams threw:', e
            );
            allTeams = [];
        }

        for (var t = 0; t < allTeams.length; t++) {
            var team = allTeams[t];
            if (!isPlainObject(team)) { continue; }
            if (!team.id) { continue; }

            var normalizedType = team.type;
            try {
                var nt = TeamConstants.normalizeTeamType(team.type);
                if (nt !== null) { normalizedType = nt; }
            } catch (e) {
                // Fall back to raw type.
            }

            if (!SCANNED_TYPES[normalizedType]) { continue; }

            result.scannedTeams++;

            if (Array.isArray(team.members)) {
                result.scannedMembers += team.members.length;
                for (var m = 0; m < team.members.length; m++) {
                    var member = team.members[m];
                    if (!isPlainObject(member)) { continue; }
                    if (Array.isArray(member.intervals)) {
                        result.scannedIntervals +=
                            member.intervals.length;
                    }
                }
            }

            checkMissingCharacter(team, result.findings);
            checkIntervals(team, result.findings);
            checkTeamWindow(team, result.findings);
        }

        // Sort findings. Errors first, then warnings, then by
        // team name, then by character name.
        result.findings.sort(function(a, b) {
            var sa = SEVERITY_ORDER[a.severity] !== undefined
                ? SEVERITY_ORDER[a.severity] : 99;
            var sb = SEVERITY_ORDER[b.severity] !== undefined
                ? SEVERITY_ORDER[b.severity] : 99;
            if (sa !== sb) { return sa - sb; }

            var ta = (a.teamName || '').localeCompare(
                b.teamName || ''
            );
            if (ta !== 0) { return ta; }

            return (a.characterName || '').localeCompare(
                b.characterName || ''
            );
        });

        // Summary.
        for (var i = 0; i < result.findings.length; i++) {
            var f = result.findings[i];
            result.summary.total++;
            if (f.severity === 'error') {
                result.summary.errors++;
            } else if (f.severity === 'warning') {
                result.summary.warnings++;
            }
            if (f.checkId) {
                if (!result.summary.byCheck[f.checkId]) {
                    result.summary.byCheck[f.checkId] = 0;
                }
                result.summary.byCheck[f.checkId]++;
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamVerifier = Object.freeze({
        runChecks: runChecks,

        // Exposed so the view can look up titles, descriptions,
        // and severities without duplicating them.
        getCheckDefinition: getCheckDefinition,
        getCheckIds: getCheckIds,
        CHECK_DEFINITIONS: CHECK_DEFINITIONS
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamVerifier;
        var missing = [];

        if (typeof exports.runChecks !== 'function') {
            missing.push('runChecks');
        }
        if (typeof exports.getCheckDefinition !== 'function') {
            missing.push('getCheckDefinition');
        }
        if (typeof exports.getCheckIds !== 'function') {
            missing.push('getCheckIds');
        }

        try {
            var result = runChecks();
            if (!result ||
                typeof result.scannedTeams !== 'number' ||
                !Array.isArray(result.findings) ||
                !result.summary) {
                missing.push('runChecks returned an unexpected shape');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamVerifier] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
