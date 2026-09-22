/**
 * modules/teams/team-core.js - Team Core
 * CANONICAL mutation API for teams.
 *
 * Path: js/modules/teams/team-core.js
 *
 * This module provides:
 *   - Team CRUD (create, update, delete)
 *   - Member mutations: add interval, end interval, reopen interval,
 *     purge interval, remove whole member
 *   - Batch member mutation: batchAddMembers
 *   - Ranking mutation (add, remove)
 *   - Configuration (characterProvider injection)
 *   - Cross-domain cascade helpers:
 *       stripCharacterRefs      (hard delete of a character)
 *       endStintsForCharacter   (death of a character; see below)
 *
 * IMPORTANT:
 *   - This is the CANONICAL mutation API for teams.
 *   - All mutations go through MutationPipeline. The pipeline owns
 *     persistence, rollback, and activity logging.
 *   - This module does NOT expose public read APIs. Team reads are
 *     owned by TeamQueries.
 *   - Reads performed inside this module are for pre-flight checks
 *     and pipeline validate() callbacks. They are not part of the
 *     public surface.
 *   - The characterProvider is injected via configure(). TeamCore
 *     does not know how characters are stored.
 *   - This module does NOT call saveData.
 *   - This module does NOT render, notify, or touch the DOM.
 *
 * MUTATION CONTRACT:
 *   All public mutations return a Promise that resolves to
 *   { success: boolean, data?: any, message?: string }.
 *
 *   Invalid inputs are REJECTED. The mutation validators check the
 *   FULL proposed state (candidate) before applying it.
 *
 *   Validations run twice:
 *     1. Pre-flight against window.data. Fast fail for obvious
 *        problems.
 *     2. Inside the pipeline's validate() callback against the
 *        snapshot. This IS authoritative. It re-derives the
 *        candidate from the snapshot and re-validates.
 *
 *   The mutate() callback ALSO re-derives the candidate from the
 *   snapshot, so the applied state can never diverge from what
 *   validate() saw.
 *
 * BATCH MUTATIONS:
 *   batchAddMembers is the ONLY compound mutation on this module.
 *   It adds several (team, character) intervals in one transaction.
 *   Either every pair is added, or none is. The pipeline's rollback
 *   guarantees this: if mutate() throws, the snapshot is discarded
 *   and window.data is untouched.
 *
 *   The validate() callback checks the FULL proposed set against
 *   the snapshot. The mutate() callback applies the set. If any
 *   pair fails validate, the whole batch is rejected.
 *
 * PERIOD SEMANTICS:
 *   - Periods are positive integers (or integer strings).
 *   - Periods are CANONICALISED on write: "02025" -> "2025".
 *   - Blank values ('', null, undefined) mean "unbounded on this
 *     side" and are written as ''. They are distinct from periods.
 *
 * MEMBER INTERVALS MODEL:
 *   Each team member entry is:
 *
 *     {
 *       memberId,        // stable per-entry identifier
 *       characterId,
 *       role,
 *       intervals: [
 *         { joinPeriod, leavePeriod },
 *         ...
 *       ]
 *     }
 *
 *   - `memberId` is generated once, at entry creation. It survives
 *     interval edits.
 *   - Each interval describes one stint. Both bounds are inclusive.
 *     Blank means "unbounded."
 *   - Intervals within one member entry must NOT overlap.
 *   - `joinPeriod` is IMMUTABLE once set. To move a stint's start,
 *     purge the interval and add a new one.
 *
 * ROLE SEMANTICS:
 *   - Role is a free-form string. Omission defaults to
 *     TeamConstants.DEFAULT_ROLE.
 *
 * DEATH CASCADE (endStintsForCharacter):
 *   When a character's deathYear transitions from blank to a
 *   parseable year, every active PROFESSIONAL-team stint for that
 *   character is ended at that year.
 *
 *   SCOPE:
 *     Professional teams only. Academic, temporary, and civilian
 *     teams are not touched by this cascade. Academic teams are
 *     managed by the Academy module; temporary and civilian team
 *     membership does not participate in the death cascade.
 *
 *   GRANULARITY:
 *     Year. Professional team stints use year strings; there is no
 *     week concept. The helper ends at deathYear, full stop. It
 *     does not read deathWeek.
 *
 *   NON-REVERSIBLE:
 *     Clearing deathYear does NOT restore the ended stints.
 *     Ending a stint is a fact. If the user wants to undo a death,
 *     they also reopen the stints by hand from the member manager.
 *     This matches the semantics of `leave`.
 *
 *   WHAT IT WRITES:
 *     interval.leavePeriod is set to String(deathYear) on every
 *     active stint whose joinPeriod is before deathYear.
 *
 *     - A stint whose leavePeriod is already set and <= deathYear
 *       is left alone.
 *     - A stint whose joinPeriod is >= deathYear is left alone.
 *       Ending it would create a stint with leave before join,
 *       which validateMemberIntervals would reject. A stint that
 *       starts on or after the death year is a data error for the
 *       user to fix, not something the cascade silently rewrites.
 *
 *   PURITY:
 *     Pure with respect to `appData`. Mutates the snapshot. Never
 *     touches window.data. Never throws. Runs inside another
 *     module's pipeline transaction (CharacterCRUD.save).
 *
 * DEPENDENCIES:
 *   - window.TeamConstants    (from team-constants.js) - MANDATORY
 *   - window.IdUtils          (from id-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ObjectUtils      (from object-utils.js) - MANDATORY
 *
 *   characterProvider is injected via configure(). Only member
 *   mutations require it. Cascade helpers do not.
 */

(function() {
    'use strict';

    if (window.__teamCoreLoaded) {
        return;
    }
    window.__teamCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamConstants = window.TeamConstants;
    var IdUtils = window.IdUtils;
    var MutationPipeline = window.MutationPipeline;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // INJECTED DEPENDENCIES
    // ============================================================

    var _characterProvider = null;
    var _characterProviderConfigured = false;

    function configure(deps) {
        deps = deps || {};

        if (!deps.characterProvider) {
            return _characterProviderConfigured;
        }

        if (typeof deps.characterProvider.exists !== 'function') {
            console.warn(
                '[TeamCore] characterProvider must have an exists() method.'
            );
            return false;
        }

        if (_characterProviderConfigured) {
            return true;
        }

        _characterProvider = deps.characterProvider;
        _characterProviderConfigured = true;
        return true;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkBaseDependencies() {
        var missing = [];

        if (!TeamConstants) {
            missing.push('TeamConstants');
        }
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }
        if (!MutationPipeline ||
            typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        return missing;
    }

    function checkMemberDependencies() {
        var missing = checkBaseDependencies();
        if (!_characterProvider ||
            typeof _characterProvider.exists !== 'function') {
            missing.push(
                'characterProvider.exists (call TeamCore.configure() first)'
            );
        }
        return missing;
    }

    function failIfMissing(missing, operationName) {
        if (missing.length > 0) {
            console.warn(
                '[TeamCore] ' + operationName + ' missing dependencies: ' +
                missing.join(', ')
            );
            return true;
        }
        return false;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('team');
    }

    function generateMemberId() {
        return 'mem_' + Date.now() + '_' +
            Math.random().toString(36).slice(2, 8);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // PERIOD CANONICALISATION
    // ============================================================

    function parsePeriod(value) {
        if (!TeamConstants ||
            typeof TeamConstants.parsePeriod !== 'function') {
            return null;
        }
        return TeamConstants.parsePeriod(value);
    }

    function canonicalisePeriod(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = parsePeriod(value);
        if (parsed === null) {
            return null;
        }
        return String(parsed);
    }

    // ============================================================
    // STORE ACCESS - PRIVATE
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!Array.isArray(window.data.teams)) {
            return null;
        }
        return window.data;
    }

    function findTeamInData(data, id) {
        if (!data || !Array.isArray(data.teams) ||
            !isNonEmptyString(id)) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && typeof team === 'object' &&
                String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    // ============================================================
    // NAME HISTORY HELPERS
    // ============================================================

    function validateNameHistory(history) {
        if (!Array.isArray(history)) {
            return {
                valid: false,
                message: 'Name history must be an array.'
            };
        }

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!isObject(entry)) {
                return {
                    valid: false,
                    message: 'Invalid name history entry at index ' + i + '.'
                };
            }
            if (!isNonEmptyString(entry.name)) {
                return {
                    valid: false,
                    message: 'Name history entry at index ' + i +
                             ' requires a name.'
                };
            }
        }

        return { valid: true };
    }

    function normaliseNameHistory(history) {
        if (!Array.isArray(history)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            result.push({
                name: String(entry.name).trim(),
                startPeriod: canonicalisePeriod(entry.startPeriod) || '',
                endPeriod: canonicalisePeriod(entry.endPeriod) || ''
            });
        }
        return result;
    }

    // ============================================================
    // INTERVAL HELPERS
    // ============================================================

    function intervalHasAnyBound(interval) {
        var hasJoin = interval.joinPeriod !== undefined &&
                      interval.joinPeriod !== null &&
                      interval.joinPeriod !== '';
        var hasLeave = interval.leavePeriod !== undefined &&
                       interval.leavePeriod !== null &&
                       interval.leavePeriod !== '';
        return hasJoin || hasLeave;
    }

    function effectiveIntervalEnd(interval) {
        var leave = canonicalisePeriod(interval.leavePeriod);
        if (leave === '' || leave === null) {
            return Infinity;
        }
        return parseInt(leave, 10);
    }

    function effectiveIntervalStart(interval) {
        var join = canonicalisePeriod(interval.joinPeriod);
        if (join === '' || join === null) {
            return 0;
        }
        return parseInt(join, 10);
    }

    function intervalsOverlap(a, b) {
        var aStart = effectiveIntervalStart(a);
        var aEnd = effectiveIntervalEnd(a);
        var bStart = effectiveIntervalStart(b);
        var bEnd = effectiveIntervalEnd(b);
        return aStart <= bEnd && bStart <= aEnd;
    }

    function validateIntervalShape(raw) {
        if (!isObject(raw)) {
            return {
                valid: false,
                message: 'Interval must be an object.'
            };
        }

        var joinCanon = canonicalisePeriod(raw.joinPeriod);
        if (joinCanon === null) {
            return {
                valid: false,
                message: 'Invalid join period format.'
            };
        }

        var leaveCanon = canonicalisePeriod(raw.leavePeriod);
        if (leaveCanon === null) {
            return {
                valid: false,
                message: 'Invalid leave period format.'
            };
        }

        if (joinCanon !== '' && leaveCanon !== '') {
            var j = parseInt(joinCanon, 10);
            var l = parseInt(leaveCanon, 10);
            if (l < j) {
                return {
                    valid: false,
                    message: 'Leave period cannot be before join period.'
                };
            }
        }

        return {
            valid: true,
            interval: {
                joinPeriod: joinCanon,
                leavePeriod: leaveCanon
            }
        };
    }

    function validateMemberIntervals(rawIntervals, teamType, allowEmpty) {
        if (!Array.isArray(rawIntervals)) {
            return {
                valid: false,
                message: 'Intervals must be an array.'
            };
        }

        if (rawIntervals.length === 0) {
            if (allowEmpty) {
                return { valid: true, intervals: [] };
            }
            return {
                valid: false,
                message: 'A member entry must contain at least one interval.'
            };
        }

        var cleaned = [];
        for (var i = 0; i < rawIntervals.length; i++) {
            var check = validateIntervalShape(rawIntervals[i]);
            if (!check.valid) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) + ': ' + check.message
                };
            }

            if (check.interval.joinPeriod !== '' &&
                !TeamConstants.isValidPeriod(
                    check.interval.joinPeriod, teamType
                )) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                        ': join period is out of bounds for team type.'
                };
            }
            if (check.interval.leavePeriod !== '' &&
                !TeamConstants.isValidPeriod(
                    check.interval.leavePeriod, teamType
                )) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                        ': leave period is out of bounds for team type.'
                };
            }

            cleaned.push(check.interval);
        }

        for (var a = 0; a < cleaned.length; a++) {
            for (var b = a + 1; b < cleaned.length; b++) {
                if (intervalsOverlap(cleaned[a], cleaned[b])) {
                    return {
                        valid: false,
                        message: 'Intervals ' + (a + 1) +
                            ' and ' + (b + 1) + ' overlap.'
                    };
                }
            }
        }

        return { valid: true, intervals: cleaned };
    }

    function buildCanonicalInterval(raw) {
        return {
            joinPeriod: canonicalisePeriod(raw.joinPeriod),
            leavePeriod: canonicalisePeriod(raw.leavePeriod)
        };
    }

    function buildCanonicalMember(characterId, role, intervals) {
        return {
            memberId: generateMemberId(),
            characterId: String(characterId).trim(),
            role: role,
            intervals: intervals
        };
    }

    // ============================================================
    // MEMBER INPUT HELPERS
    // ============================================================

    function extractIntervalsFromMemberInput(memberData) {
        if (!isObject(memberData)) {
            return null;
        }

        if (Array.isArray(memberData.intervals)) {
            return memberData.intervals;
        }

        var hasJoin = memberData.joinPeriod !== undefined &&
                      memberData.joinPeriod !== null;
        var hasLeave = memberData.leavePeriod !== undefined &&
                       memberData.leavePeriod !== null;

        if (hasJoin || hasLeave) {
            return [{
                joinPeriod: memberData.joinPeriod,
                leavePeriod: memberData.leavePeriod
            }];
        }

        return [{
            joinPeriod: '',
            leavePeriod: ''
        }];
    }

    function resolveRole(memberData) {
        if (!isObject(memberData)) {
            return {
                valid: false,
                message: 'Member data must be an object.'
            };
        }

        if (memberData.role === undefined || memberData.role === null) {
            return { valid: true, role: TeamConstants.DEFAULT_ROLE };
        }

        if (typeof memberData.role !== 'string') {
            return {
                valid: false,
                message: 'Member role must be a string.'
            };
        }

        var trimmed = memberData.role.trim();
        if (trimmed === '') {
            return { valid: true, role: TeamConstants.DEFAULT_ROLE };
        }

        return { valid: true, role: trimmed };
    }

    // ============================================================
    // TEAM VALIDATION
    // ============================================================

    function validateRankingEntry(entry, teamType) {
        if (!isObject(entry)) {
            return {
                valid: false,
                message: 'Invalid ranking entry.'
            };
        }

        var period = parsePeriod(entry.period);
        if (period === null) {
            return {
                valid: false,
                message: 'Invalid period format.'
            };
        }

        if (!TeamConstants.isValidPeriod(period, teamType)) {
            return {
                valid: false,
                message: 'Period is out of bounds for team type.'
            };
        }

        var rank = parsePeriod(entry.rank);
        if (rank === null) {
            return {
                valid: false,
                message: 'Invalid rank format.'
            };
        }

        return { valid: true, period: period, rank: rank };
    }

    function validateCompleteTeam(team) {
        if (!isObject(team)) {
            return {
                valid: false,
                message: 'Team must be an object.'
            };
        }

        if (!isNonEmptyString(team.name)) {
            return {
                valid: false,
                message: 'Team name is required.'
            };
        }

        if (!TeamConstants.isValidTeamType(team.type)) {
            return {
                valid: false,
                message: 'Invalid team type.'
            };
        }

        if (!TeamConstants.isValidTeamStatus(team.status)) {
            return {
                valid: false,
                message: 'Invalid team status.'
            };
        }

        if (!Array.isArray(team.nameHistory)) {
            return {
                valid: false,
                message: 'nameHistory must be an array.'
            };
        }
        if (!Array.isArray(team.members)) {
            return {
                valid: false,
                message: 'members must be an array.'
            };
        }
        if (!Array.isArray(team.rankingHistory)) {
            return {
                valid: false,
                message: 'rankingHistory must be an array.'
            };
        }

        if (!TeamConstants.isValidPeriod(team.startPeriod, team.type)) {
            return {
                valid: false,
                message: 'Invalid start period for team type.'
            };
        }
        if (!TeamConstants.isValidPeriod(team.endPeriod, team.type)) {
            return {
                valid: false,
                message: 'Invalid end period for team type.'
            };
        }

        var startNum = parsePeriod(team.startPeriod);
        var endNum = parsePeriod(team.endPeriod);
        if (startNum !== null && endNum !== null && startNum > endNum) {
            return {
                valid: false,
                message: 'Start period cannot be after end period.'
            };
        }

        var nameCheck = validateNameHistory(team.nameHistory);
        if (!nameCheck.valid) {
            return nameCheck;
        }

        var seenMemberIds = Object.create(null);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!isObject(member)) {
                return {
                    valid: false,
                    message: 'Invalid member record at index ' + i + '.'
                };
            }
            if (!isNonEmptyString(member.characterId)) {
                return {
                    valid: false,
                    message: 'Member at index ' + i +
                             ' missing characterId.'
                };
            }

            if (!isNonEmptyString(member.memberId)) {
                return {
                    valid: false,
                    message: 'Member at index ' + i + ' missing memberId.'
                };
            }
            var memberIdKey = String(member.memberId);
            if (seenMemberIds[memberIdKey]) {
                return {
                    valid: false,
                    message: 'Duplicate memberId: ' + memberIdKey
                };
            }
            seenMemberIds[memberIdKey] = true;

            var roleCheck = validateMemberRole(member);
            if (!roleCheck.valid) {
                return roleCheck;
            }

            var intervalCheck = validateMemberIntervals(
                member.intervals, team.type, /* allowEmpty */ true
            );
            if (!intervalCheck.valid) {
                return intervalCheck;
            }
        }

        var seenPeriods = Object.create(null);
        for (var j = 0; j < team.rankingHistory.length; j++) {
            var entry = team.rankingHistory[j];
            var rankCheck = validateRankingEntry(entry, team.type);
            if (!rankCheck.valid) {
                return rankCheck;
            }
            var periodKey = String(rankCheck.period);
            if (seenPeriods[periodKey]) {
                return {
                    valid: false,
                    message: 'Duplicate ranking entry for period ' +
                             periodKey + '.'
                };
            }
            seenPeriods[periodKey] = true;
        }

        return { valid: true };
    }

    function validateMemberRole(member) {
        if (!member || member.role === undefined) {
            return { valid: true };
        }
        if (typeof member.role !== 'string') {
            return {
                valid: false,
                message: 'Member role must be a string.'
            };
        }
        return { valid: true };
    }

    // ============================================================
    // CANDIDATE BUILDERS
    // ============================================================

    function buildNewTeam(teamData) {
        var startCanon = canonicalisePeriod(teamData.startPeriod);
        var endCanon = canonicalisePeriod(teamData.endPeriod);

        return {
            id: generateId(),
            name: String(teamData.name).trim(),
            type: teamData.type,
            startPeriod: startCanon === null ? '' : startCanon,
            endPeriod: endCanon === null ? '' : endCanon,
            status: teamData.status || TeamConstants.DEFAULT_TEAM_STATUS,
            nameHistory: normaliseNameHistory(teamData.nameHistory),
            members: [],
            rankingHistory: [],
            temporaryMission: teamData.temporaryMission !== undefined &&
                teamData.temporaryMission !== null &&
                teamData.temporaryMission !== ''
                ? String(teamData.temporaryMission).trim()
                : null,
            classId: teamData.classId !== undefined &&
                teamData.classId !== null &&
                teamData.classId !== ''
                ? String(teamData.classId).trim()
                : null,
            teamNumber: teamData.teamNumber !== undefined &&
                teamData.teamNumber !== null
                ? String(teamData.teamNumber).trim()
                : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    function buildUpdatedTeam(existing, updates) {
        var candidate = deepClone(existing);

        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return {
                    valid: false,
                    message: 'Team name cannot be empty.'
                };
            }
            candidate.name = String(updates.name).trim();
        }

        if (updates.type !== undefined) {
            var normalized = TeamConstants.normalizeTeamType(updates.type);
            if (normalized === null) {
                return {
                    valid: false,
                    message: 'Invalid team type: ' + updates.type
                };
            }
            candidate.type = normalized;
        }

        if (updates.status !== undefined) {
            if (!TeamConstants.isValidTeamStatus(updates.status)) {
                return {
                    valid: false,
                    message: 'Invalid team status: ' + updates.status
                };
            }
            candidate.status = updates.status;
        }

        if (updates.startPeriod !== undefined) {
            var startCanon = canonicalisePeriod(updates.startPeriod);
            if (startCanon === null) {
                return {
                    valid: false,
                    message: 'Invalid start period.'
                };
            }
            candidate.startPeriod = startCanon;
        }
        if (updates.endPeriod !== undefined) {
            var endCanon = canonicalisePeriod(updates.endPeriod);
            if (endCanon === null) {
                return {
                    valid: false,
                    message: 'Invalid end period.'
                };
            }
            candidate.endPeriod = endCanon;
        }

        if (updates.nameHistory !== undefined) {
            var historyCheck = validateNameHistory(updates.nameHistory);
            if (!historyCheck.valid) {
                return historyCheck;
            }
            candidate.nameHistory = normaliseNameHistory(
                updates.nameHistory
            );
        }

        if (updates.temporaryMission !== undefined) {
            candidate.temporaryMission =
                updates.temporaryMission !== null &&
                updates.temporaryMission !== ''
                ? String(updates.temporaryMission).trim()
                : null;
        }

        if (updates.classId !== undefined) {
            candidate.classId = updates.classId !== null &&
                updates.classId !== ''
                ? String(updates.classId).trim()
                : null;
        }

        if (updates.teamNumber !== undefined) {
            var numStr = updates.teamNumber !== null &&
                         updates.teamNumber !== ''
                ? String(updates.teamNumber).trim()
                : '';
            if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                return {
                    valid: false,
                    message: 'Team identifier contains invalid characters.'
                };
            }
            candidate.teamNumber = numStr;
        }

        if (Array.isArray(candidate.members)) {
            for (var m = 0; m < candidate.members.length; m++) {
                var member = candidate.members[m];
                if (!member || !Array.isArray(member.intervals)) {
                    continue;
                }
                var intervalCheck = validateMemberIntervals(
                    member.intervals, candidate.type, true
                );
                if (!intervalCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate existing ' +
                            'member intervals: ' + intervalCheck.message
                    };
                }
            }
        }

        if (Array.isArray(candidate.rankingHistory)) {
            for (var r = 0; r < candidate.rankingHistory.length; r++) {
                var rankCheck = validateRankingEntry(
                    candidate.rankingHistory[r], candidate.type
                );
                if (!rankCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate existing ' +
                            'ranking periods: ' + rankCheck.message
                    };
                }
            }
        }

        candidate.updatedAt = new Date().toISOString();

        return { valid: true, candidate: candidate };
    }

    // ============================================================
    // MUTATION WRAPPER
    // ============================================================

    function runMutation(config) {
        if (!MutationPipeline ||
            typeof MutationPipeline.performMutation !== 'function') {
            return Promise.resolve(
                failure('MutationPipeline is not available.')
            );
        }

        return MutationPipeline.performMutation({
            validate: config.validate ||
                function() { return { valid: true }; },
            mutate: config.mutate,
            logMessage: config.logMessage,
            successMessage: config.successMessage || 'Team updated.',
            failureMessage: config.failureMessage ||
                'Failed to update team.'
        });
    }

    // ============================================================
    // TEAM CRUD
    // ============================================================

    function createTeam(teamData) {
        if (failIfMissing(checkBaseDependencies(), 'createTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isObject(teamData)) {
            return Promise.resolve(
                failure('Team data must be an object.')
            );
        }

        if (!isNonEmptyString(teamData.name)) {
            return Promise.resolve(failure('Team name is required.'));
        }

        var normalizedType = TeamConstants.normalizeTeamType(teamData.type);
        if (normalizedType === null) {
            return Promise.resolve(
                failure('Invalid team type: ' + teamData.type)
            );
        }

        var status = teamData.status || TeamConstants.DEFAULT_TEAM_STATUS;
        if (!TeamConstants.isValidTeamStatus(status)) {
            return Promise.resolve(
                failure('Invalid team status: ' + status)
            );
        }

        var nameHistory = [];
        if (teamData.nameHistory !== undefined) {
            var historyCheck = validateNameHistory(teamData.nameHistory);
            if (!historyCheck.valid) {
                return Promise.resolve(failure(historyCheck.message));
            }
            nameHistory = normaliseNameHistory(teamData.nameHistory);
        }

        var candidate = buildNewTeam({
            name: teamData.name,
            type: normalizedType,
            startPeriod: teamData.startPeriod,
            endPeriod: teamData.endPeriod,
            status: status,
            nameHistory: nameHistory,
            temporaryMission: teamData.temporaryMission,
            classId: teamData.classId,
            teamNumber: teamData.teamNumber
        });

        var completeCheck = validateCompleteTeam(candidate);
        if (!completeCheck.valid) {
            return Promise.resolve(failure(completeCheck.message));
        }

        var targetId = candidate.id;

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                if (findTeamInData(snapshot, targetId)) {
                    return {
                        valid: false,
                        message: 'Team ID collision.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                if (!Array.isArray(snapshot.teams)) {
                    snapshot.teams = [];
                }
                snapshot.teams.push(deepClone(candidate));
                return { team: candidate, id: targetId };
            },
            logMessage: 'Created team: ' + candidate.name,
            successMessage: 'Team created successfully!',
            failureMessage: 'Failed to create team.'
        });
    }

    function updateTeam(id, updates) {
        if (failIfMissing(checkBaseDependencies(), 'updateTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        if (!isObject(updates)) {
            return Promise.resolve(
                failure('Updates must be an object.')
            );
        }

        if (Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var targetId = String(id).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var preflight = buildUpdatedTeam(current, updates);
        if (!preflight.valid) {
            return Promise.resolve(failure(preflight.message));
        }
        var preflightCheck = validateCompleteTeam(preflight.candidate);
        if (!preflightCheck.valid) {
            return Promise.resolve(failure(preflightCheck.message));
        }

        var updatesCopy = deepClone(updates);

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                var currentInSnapshot = findTeamInData(
                    snapshot, targetId
                );
                if (!currentInSnapshot) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }

                var snapshotBuild = buildUpdatedTeam(
                    currentInSnapshot, updatesCopy
                );
                if (!snapshotBuild.valid) {
                    return {
                        valid: false,
                        message: snapshotBuild.message
                    };
                }
                var snapshotCheck = validateCompleteTeam(
                    snapshotBuild.candidate
                );
                if (!snapshotCheck.valid) {
                    return {
                        valid: false,
                        message: snapshotCheck.message
                    };
                }

                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error('Team not found in data store.');
                }

                var snapshotBuild = buildUpdatedTeam(
                    target, updatesCopy
                );
                if (!snapshotBuild.valid) {
                    throw new Error(snapshotBuild.message);
                }
                var snapshotCheck = validateCompleteTeam(
                    snapshotBuild.candidate
                );
                if (!snapshotCheck.valid) {
                    throw new Error(snapshotCheck.message);
                }

                var candidate = snapshotBuild.candidate;

                var updateableProps = [
                    'name', 'type', 'startPeriod', 'endPeriod', 'status',
                    'classId', 'teamNumber', 'temporaryMission',
                    'nameHistory', 'updatedAt'
                ];
                for (var i = 0; i < updateableProps.length; i++) {
                    var key = updateableProps[i];
                    if (candidate[key] !== undefined) {
                        target[key] = candidate[key];
                    }
                }

                return { team: target, id: targetId };
            },
            logMessage: 'Updated team: ' + preflight.candidate.name,
            successMessage: 'Team updated successfully!',
            failureMessage: 'Failed to update team.'
        });
    }

    function deleteTeam(id) {
        if (failIfMissing(checkBaseDependencies(), 'deleteTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var targetId = String(id).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var teamName = current.name || 'Unknown Team';

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                if (!findTeamInData(snapshot, targetId)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var idx = -1;
                for (var i = 0; i < snapshot.teams.length; i++) {
                    if (snapshot.teams[i] &&
                        String(snapshot.teams[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Team not found in data store.');
                }
                snapshot.teams.splice(idx, 1);
                return { id: targetId };
            },
            logMessage: 'Deleted team: ' + teamName,
            successMessage: 'Team deleted successfully!',
            failureMessage: 'Failed to delete team.'
        });
    }

    // ============================================================
    // MEMBER MUTATIONS
    // ============================================================

    function addMember(teamId, memberData) {
        if (failIfMissing(checkMemberDependencies(), 'addMember')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        if (!isObject(memberData)) {
            return Promise.resolve(
                failure('Member data must be an object.')
            );
        }

        if (!isNonEmptyString(memberData.characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var roleRes = resolveRole(memberData);
        if (!roleRes.valid) {
            return Promise.resolve(failure(roleRes.message));
        }

        var rawIntervals = extractIntervalsFromMemberInput(memberData);
        if (rawIntervals === null) {
            return Promise.resolve(
                failure('Could not read intervals from member data.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(memberData.characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var incomingCheck = validateMemberIntervals(
            rawIntervals, current.type, /* allowEmpty */ false
        );
        if (!incomingCheck.valid) {
            return Promise.resolve(failure(incomingCheck.message));
        }

        var existingEntry = null;
        if (Array.isArray(current.members)) {
            for (var i = 0; i < current.members.length; i++) {
                var m = current.members[i];
                if (m && String(m.characterId) === targetChar) {
                    existingEntry = m;
                    break;
                }
            }
        }

        if (existingEntry && Array.isArray(existingEntry.intervals)) {
            for (var a = 0; a < incomingCheck.intervals.length; a++) {
                for (var b = 0;
                     b < existingEntry.intervals.length;
                     b++) {
                    if (intervalsOverlap(
                        incomingCheck.intervals[a],
                        existingEntry.intervals[b]
                    )) {
                        return Promise.resolve(failure(
                            'The new interval overlaps an existing one ' +
                            'for this character on this team.'
                        ));
                    }
                }
            }
        }

        var roleCopy = roleRes.role;
        var intervalsCopy = incomingCheck.intervals.map(function(iv) {
            return {
                joinPeriod: iv.joinPeriod,
                leavePeriod: iv.leavePeriod
            };
        });

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                if (!Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team members are malformed.'
                    };
                }

                if (!_characterProvider.exists(snapshot, targetChar)) {
                    return {
                        valid: false,
                        message: 'Character not found.'
                    };
                }

                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (!m ||
                        String(m.characterId) !== targetChar) {
                        continue;
                    }
                    if (!Array.isArray(m.intervals)) { continue; }

                    for (var a = 0; a < intervalsCopy.length; a++) {
                        for (var b = 0;
                             b < m.intervals.length;
                             b++) {
                            if (intervalsOverlap(
                                intervalsCopy[a],
                                m.intervals[b]
                            )) {
                                return {
                                    valid: false,
                                    message: 'The new interval ' +
                                        'overlaps an existing one ' +
                                        'for this character on this ' +
                                        'team.'
                                };
                            }
                        }
                    }
                }

                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error('Team not found in data store.');
                }
                if (!Array.isArray(target.members)) {
                    target.members = [];
                }

                var entry = null;
                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (m && String(m.characterId) === targetChar) {
                        entry = m;
                        break;
                    }
                }

                if (entry) {
                    if (!Array.isArray(entry.intervals)) {
                        entry.intervals = [];
                    }
                    for (var a = 0;
                         a < intervalsCopy.length;
                         a++) {
                        entry.intervals.push({
                            joinPeriod: intervalsCopy[a].joinPeriod,
                            leavePeriod: intervalsCopy[a].leavePeriod
                        });
                    }
                } else {
                    var newEntry = buildCanonicalMember(
                        targetChar, roleCopy, intervalsCopy
                    );
                    target.members.push(newEntry);
                    entry = newEntry;
                }

                target.updatedAt = new Date().toISOString();
                return {
                    memberId: entry.memberId,
                    characterId: targetChar,
                    teamId: targetId
                };
            },
            logMessage: 'Added member interval to team: ' +
                (current.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        });
    }

    function addMemberInterval(
        teamId,
        characterId,
        joinPeriod,
        leavePeriod
    ) {
        return addMember(teamId, {
            characterId: characterId,
            intervals: [{
                joinPeriod: joinPeriod,
                leavePeriod: leavePeriod
            }]
        });
    }

    /**
     * Add several (team, character) intervals in ONE transaction.
     *
     * Either every assignment lands or none does. The pipeline
     * rollback guarantees atomicity: if the mutate() callback
     * throws, the snapshot is discarded and window.data is
     * untouched.
     *
     * assignments: [ { teamId, charId, joinPeriod, leavePeriod,
     *                  role? } ]
     *
     * VALIDATION (pre-flight + snapshot):
     *   - Every entry must be an object with teamId and charId.
     *   - Every teamId must resolve to a live team.
     *   - Every charId must exist (via characterProvider).
     *   - No (teamId, charId) pair may appear twice.
     *   - No incoming interval may overlap an existing interval
     *     for the same (team, character) pair.
     *   - No incoming interval may overlap another incoming
     *     interval for the same (team, character) pair (i.e. two
     *     assignments to the same team and character in one
     *     batch).
     *
     * The error messages name the offending row so a caller can
     * surface a useful message.
     */
    function batchAddMembers(assignments) {
        if (failIfMissing(checkMemberDependencies(), 'batchAddMembers')) {
            return Promise.resolve(failure(
                'Dependencies not loaded. Please refresh the page.'
            ));
        }

        if (!Array.isArray(assignments)) {
            return Promise.resolve(
                failure('Assignments must be an array.')
            );
        }

        if (assignments.length === 0) {
            return Promise.resolve(success({
                added: 0,
                teamsTouched: 0
            }));
        }

        // ---- Normalise and pre-validate each row. ----
        var cleanRows = [];
        var seenPairs = Object.create(null);

        for (var i = 0; i < assignments.length; i++) {
            var row = assignments[i];
            var rowLabel = 'Assignment ' + (i + 1);

            if (!isObject(row)) {
                return Promise.resolve(
                    failure(rowLabel + ': must be an object.')
                );
            }
            if (!isNonEmptyString(row.teamId)) {
                return Promise.resolve(
                    failure(rowLabel + ': teamId is required.')
                );
            }
            if (!isNonEmptyString(row.charId)) {
                return Promise.resolve(
                    failure(rowLabel + ': charId is required.')
                );
            }

            var teamId = String(row.teamId).trim();
            var charId = String(row.charId).trim();
            var pairKey = teamId + '::' + charId;

            if (seenPairs[pairKey]) {
                return Promise.resolve(failure(
                    rowLabel + ': duplicate (team, character) pair.'
                ));
            }
            seenPairs[pairKey] = true;

            var joinCanon = canonicalisePeriod(row.joinPeriod);
            if (joinCanon === null) {
                return Promise.resolve(failure(
                    rowLabel + ': invalid join period.'
                ));
            }
            var leaveCanon = canonicalisePeriod(row.leavePeriod);
            if (leaveCanon === null) {
                return Promise.resolve(failure(
                    rowLabel + ': invalid leave period.'
                ));
            }

            var role = TeamConstants.DEFAULT_ROLE;
            if (row.role !== undefined && row.role !== null) {
                if (typeof row.role !== 'string') {
                    return Promise.resolve(failure(
                        rowLabel + ': role must be a string.'
                    ));
                }
                var trimmedRole = row.role.trim();
                if (trimmedRole !== '') {
                    role = trimmedRole;
                }
            }

            cleanRows.push({
                index: i,
                teamId: teamId,
                charId: charId,
                joinPeriod: joinCanon,
                leavePeriod: leaveCanon,
                role: role
            });
        }

        // ---- Pre-flight against window.data. ----
        var preflightStore = getDataStore();
        if (!preflightStore) {
            return Promise.resolve(failure(
                'Team data store is not available.'
            ));
        }

        var preflightByTeam = Object.create(null);
        for (var p = 0; p < cleanRows.length; p++) {
            var pr = cleanRows[p];
            var preflightTeam = findTeamInData(
                preflightStore, pr.teamId
            );
            if (!preflightTeam) {
                return Promise.resolve(failure(
                    'Assignment ' + (pr.index + 1) +
                    ': team no longer exists.'
                ));
            }
            if (!preflightByTeam[pr.teamId]) {
                preflightByTeam[pr.teamId] = preflightTeam;
            }
        }

        // ---- Validation + mutation, snapshot-scoped. ----
        var rowsCopy = deepClone(cleanRows);

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }

                var pendingByPair = Object.create(null);

                for (var v = 0; v < rowsCopy.length; v++) {
                    var row = rowsCopy[v];
                    var rowLabel = 'Assignment ' + (row.index + 1);

                    var team = findTeamInData(snapshot, row.teamId);
                    if (!team) {
                        return {
                            valid: false,
                            message: rowLabel +
                                ': team no longer exists.'
                        };
                    }

                    if (!_characterProvider.exists(
                        snapshot, row.charId
                    )) {
                        return {
                            valid: false,
                            message: rowLabel +
                                ': character not found.'
                        };
                    }

                    var incoming = {
                        joinPeriod: row.joinPeriod,
                        leavePeriod: row.leavePeriod
                    };

                    if (Array.isArray(team.members)) {
                        for (var m = 0;
                             m < team.members.length;
                             m++) {
                            var member = team.members[m];
                            if (!member) { continue; }
                            if (String(member.characterId) !==
                                row.charId) {
                                continue;
                            }
                            if (!Array.isArray(member.intervals)) {
                                continue;
                            }
                            for (var iv = 0;
                                 iv < member.intervals.length;
                                 iv++) {
                                if (intervalsOverlap(
                                    incoming,
                                    member.intervals[iv]
                                )) {
                                    return {
                                        valid: false,
                                        message: rowLabel +
                                            ': interval ' +
                                            'overlaps an existing ' +
                                            'one for this character ' +
                                            'on this team.'
                                    };
                                }
                            }
                        }
                    }

                    var pairKey = row.teamId + '::' + row.charId;
                    var prior = pendingByPair[pairKey];
                    if (prior) {
                        for (var q = 0; q < prior.length; q++) {
                            if (intervalsOverlap(
                                incoming, prior[q]
                            )) {
                                return {
                                    valid: false,
                                    message: rowLabel +
                                        ': interval overlaps ' +
                                        'another assignment in ' +
                                        'this batch for the same ' +
                                        '(team, character) pair.'
                                };
                            }
                        }
                        prior.push(incoming);
                    } else {
                        pendingByPair[pairKey] = [incoming];
                    }
                }

                return { valid: true };
            },
            mutate: function(snapshot) {
                if (!Array.isArray(snapshot.teams)) {
                    throw new Error('Team store is malformed.');
                }

                var teamsTouched = Object.create(null);
                var added = 0;

                for (var i = 0; i < rowsCopy.length; i++) {
                    var row = rowsCopy[i];

                    var team = findTeamInData(snapshot, row.teamId);
                    if (!team) {
                        throw new Error(
                            'Team not found in data store: ' +
                            row.teamId
                        );
                    }

                    if (!Array.isArray(team.members)) {
                        team.members = [];
                    }

                    var entry = null;
                    for (var m = 0; m < team.members.length; m++) {
                        var candidateEntry = team.members[m];
                        if (!candidateEntry) { continue; }
                        if (String(candidateEntry.characterId) ===
                            row.charId) {
                            entry = candidateEntry;
                            break;
                        }
                    }

                    if (entry) {
                        if (!Array.isArray(entry.intervals)) {
                            entry.intervals = [];
                        }
                        entry.intervals.push({
                            joinPeriod: row.joinPeriod,
                            leavePeriod: row.leavePeriod
                        });
                    } else {
                        var newEntry = buildCanonicalMember(
                            row.charId,
                            row.role,
                            [{
                                joinPeriod: row.joinPeriod,
                                leavePeriod: row.leavePeriod
                            }]
                        );
                        team.members.push(newEntry);
                    }

                    team.updatedAt = new Date().toISOString();
                    teamsTouched[row.teamId] = true;
                    added++;
                }

                return {
                    added: added,
                    teamsTouched: Object.keys(teamsTouched).length
                };
            },
            logMessage: function(result) {
                var n = result && typeof result.added === 'number'
                    ? result.added
                    : rowsCopy.length;
                var t = result &&
                        typeof result.teamsTouched === 'number'
                    ? result.teamsTouched
                    : 0;
                return 'Added ' + n + ' member interval' +
                    (n === 1 ? '' : 's') +
                    ' across ' + t + ' team' +
                    (t === 1 ? '' : 's') + ' (batch).';
            },
            successMessage: function(result) {
                var n = result && typeof result.added === 'number'
                    ? result.added
                    : rowsCopy.length;
                return 'Added ' + n + ' member' +
                    (n === 1 ? '' : 's') + ' to ' +
                    (result &&
                     typeof result.teamsTouched === 'number'
                        ? result.teamsTouched
                        : 0) +
                    ' team' +
                    ((result &&
                      typeof result.teamsTouched === 'number'
                        ? result.teamsTouched
                        : 0) === 1 ? '' : 's') +
                    '.';
            },
            failureMessage: 'Failed to add members.'
        });
    }

    function updateMember(teamId, charId, updates) {
        if (failIfMissing(checkBaseDependencies(), 'updateMember')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isObject(updates)) {
            return Promise.resolve(
                failure('Updates must be an object.')
            );
        }

        if (updates.joinPeriod !== undefined ||
            updates.leavePeriod !== undefined ||
            updates.intervals !== undefined) {
            return Promise.resolve(failure(
                'updateMember does not accept interval edits. Use ' +
                'endMemberInterval, reopenMemberInterval, or ' +
                'addMemberInterval instead.'
            ));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(charId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var proposedRole;
        if (updates.role !== undefined) {
            if (updates.role !== null &&
                typeof updates.role !== 'string') {
                return Promise.resolve(
                    failure('Member role must be a string.')
                );
            }
            if (updates.role === null ||
                updates.role.trim() === '') {
                proposedRole = TeamConstants.DEFAULT_ROLE;
            } else {
                proposedRole = updates.role.trim();
            }
        } else {
            return Promise.resolve(
                failure('No fields to update.')
            );
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveMember = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    return {
                        valid: false,
                        message: 'Character is not a member of ' +
                            'this team.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }

                var liveMember = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    throw new Error(
                        'Member not found in data store.'
                    );
                }

                liveMember.role = proposedRole;
                target.updatedAt = new Date().toISOString();

                return { member: liveMember, teamId: targetId };
            },
            logMessage: 'Updated member role on team: ' +
                (current.name || targetId),
            successMessage: 'Member updated successfully!',
            failureMessage: 'Failed to update member.'
        });
    }

    function removeMember(teamId, charId) {
        if (failIfMissing(checkBaseDependencies(), 'removeMember')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(charId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var found = false;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) ===
                targetChar) {
                found = true;
                break;
            }
        }
        if (!found) {
            return Promise.resolve(failure(
                'Character is not a member of this team.'
            ));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var present = target.members.some(function(m) {
                    return m &&
                        String(m.characterId) === targetChar;
                });
                if (!present) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }
                target.members = target.members.filter(function(m) {
                    return !m ||
                        String(m.characterId) !== targetChar;
                });
                target.updatedAt = new Date().toISOString();
                return { characterId: targetChar, teamId: targetId };
            },
            logMessage: 'Removed member from team: ' +
                (current.name || targetId),
            successMessage: 'Member removed successfully!',
            failureMessage: 'Failed to remove member.'
        });
    }

    function endMemberInterval(
        teamId,
        characterId,
        joinPeriod,
        leaveWeek
    ) {
        if (failIfMissing(
            checkBaseDependencies(), 'endMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined ||
                          joinPeriod === null)
            ? ''
            : String(joinPeriod);

        var leaveCanon = canonicalisePeriod(leaveWeek);
        if (leaveCanon === null || leaveCanon === '') {
            return Promise.resolve(
                failure('Valid leave week is required.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var entry = null;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) ===
                targetChar) {
                entry = current.members[i];
                break;
            }
        }
        if (!entry || !Array.isArray(entry.intervals)) {
            return Promise.resolve(failure(
                'Character is not a member of this team.'
            ));
        }

        var targetInterval = null;
        for (var j = 0; j < entry.intervals.length; j++) {
            var iv = entry.intervals[j];
            if (!iv) { continue; }
            var ivJoin = (iv.joinPeriod === undefined ||
                          iv.joinPeriod === null)
                ? ''
                : String(iv.joinPeriod);
            if (ivJoin === targetJoin) {
                targetInterval = iv;
                break;
            }
        }
        if (!targetInterval) {
            return Promise.resolve(failure('Interval not found.'));
        }

        var currentLeaveCanon = canonicalisePeriod(
            targetInterval.leavePeriod
        );
        if (currentLeaveCanon !== '' &&
            currentLeaveCanon !== null) {
            var currentLeaveNum = parseInt(currentLeaveCanon, 10);
            var newLeaveNum = parseInt(leaveCanon, 10);
            if (currentLeaveNum <= newLeaveNum) {
                return Promise.resolve(failure(
                    'Interval is already closed at or before ' +
                    'week ' + leaveCanon + '.'
                ));
            }
        }

        var joinCanon = canonicalisePeriod(targetInterval.joinPeriod);
        if (joinCanon !== '' && joinCanon !== null) {
            var joinNum = parseInt(joinCanon, 10);
            var leaveNumCheck = parseInt(leaveCanon, 10);
            if (leaveNumCheck < joinNum) {
                return Promise.resolve(failure(
                    'Leave week cannot be before the interval\'s ' +
                    'join week.'
                ));
            }
        }

        var leaveCanonCopy = leaveCanon;

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = (iv.joinPeriod === undefined ||
                                  iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return {
                        valid: false,
                        message: 'Interval no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }

                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = (iv.joinPeriod === undefined ||
                                  iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    throw new Error('Interval not found.');
                }

                liveIv.leavePeriod = leaveCanonCopy;
                target.updatedAt = new Date().toISOString();

                return {
                    teamId: targetId,
                    characterId: targetChar,
                    joinPeriod: targetJoin,
                    leavePeriod: leaveCanonCopy
                };
            },
            logMessage: 'Ended member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Member left successfully.',
            failureMessage: 'Failed to end member interval.'
        });
    }

    function reopenMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(
            checkBaseDependencies(), 'reopenMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined ||
                          joinPeriod === null)
            ? ''
            : String(joinPeriod);

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = (iv.joinPeriod === undefined ||
                                  iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return {
                        valid: false,
                        message: 'Interval no longer exists.'
                    };
                }

                var lv = canonicalisePeriod(liveIv.leavePeriod);
                if (lv === '') {
                    return {
                        valid: false,
                        message: 'Interval is already open.'
                    };
                }

                for (var k = 0;
                     k < liveEntry.intervals.length;
                     k++) {
                    if (liveEntry.intervals[k] === liveIv) {
                        continue;
                    }
                    var other = liveEntry.intervals[k];
                    if (!other) { continue; }
                    var otherStart = effectiveIntervalStart(other);
                    var thisStart = effectiveIntervalStart(liveIv);
                    if (thisStart <= effectiveIntervalEnd(other) &&
                        otherStart <= Infinity) {
                        if (otherStart >= thisStart) {
                            return {
                                valid: false,
                                message: 'Reopening this interval ' +
                                    'would overlap a later ' +
                                    'interval.'
                            };
                        }
                    }
                }

                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }

                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = (iv.joinPeriod === undefined ||
                                  iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        iv.leavePeriod = '';
                        target.updatedAt =
                            new Date().toISOString();
                        return {
                            teamId: targetId,
                            characterId: targetChar,
                            joinPeriod: targetJoin
                        };
                    }
                }

                throw new Error('Interval not found.');
            },
            logMessage: 'Reopened member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Interval reopened.',
            failureMessage: 'Failed to reopen interval.'
        });
    }

    function purgeMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(
            checkBaseDependencies(), 'purgeMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined ||
                          joinPeriod === null)
            ? ''
            : String(joinPeriod);

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                var found = false;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = (iv.joinPeriod === undefined ||
                                  iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Interval not found.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }

                var idx = -1;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Member not found.');
                }

                var liveEntry = target.members[idx];
                if (!Array.isArray(liveEntry.intervals)) {
                    throw new Error(
                        'Member has no intervals array.'
                    );
                }

                var before = liveEntry.intervals.length;
                liveEntry.intervals = liveEntry.intervals.filter(
                    function(iv) {
                        if (!iv || typeof iv !== 'object') {
                            return false;
                        }
                        var ivJoin = (iv.joinPeriod === undefined ||
                                      iv.joinPeriod === null)
                            ? ''
                            : String(iv.joinPeriod);
                        return ivJoin !== targetJoin;
                    }
                );
                var removed =
                    before - liveEntry.intervals.length;
                if (removed === 0) {
                    throw new Error('Interval not found.');
                }

                if (liveEntry.intervals.length === 0) {
                    target.members.splice(idx, 1);
                }

                target.updatedAt = new Date().toISOString();
                return {
                    teamId: targetId,
                    characterId: targetChar,
                    joinPeriod: targetJoin,
                    memberRemoved:
                        liveEntry.intervals.length === 0
                };
            },
            logMessage: 'Purged member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Interval removed.',
            failureMessage: 'Failed to remove interval.'
        });
    }

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function addRanking(teamId, period, rank) {
        if (failIfMissing(checkBaseDependencies(), 'addRanking')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(
                failure('Period must be a positive integer.')
            );
        }

        var rankNum = parsePeriod(rank);
        if (rankNum === null) {
            return Promise.resolve(
                failure('Rank must be a positive integer.')
            );
        }

        var targetId = String(teamId).trim();
        var periodStr = String(periodNum);

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var entryCheck = validateRankingEntry(
            { period: periodNum, rank: rankNum },
            current.type
        );
        if (!entryCheck.valid) {
            return Promise.resolve(failure(entryCheck.message));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var check = validateRankingEntry(
                    { period: periodNum, rank: rankNum },
                    target.type
                );
                if (!check.valid) {
                    return {
                        valid: false,
                        message: check.message
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error('Team not found in data store.');
                }
                if (!Array.isArray(target.rankingHistory)) {
                    target.rankingHistory = [];
                }

                var existingIndex = -1;
                for (var i = 0;
                     i < target.rankingHistory.length;
                     i++) {
                    var entryPeriod = parsePeriod(
                        target.rankingHistory[i].period
                    );
                    if (entryPeriod !== null &&
                        String(entryPeriod) === periodStr) {
                        existingIndex = i;
                        break;
                    }
                }

                var newEntry = {
                    period: periodStr,
                    rank: rankNum
                };
                if (existingIndex !== -1) {
                    target.rankingHistory[existingIndex] =
                        newEntry;
                } else {
                    target.rankingHistory.push(newEntry);
                }

                target.rankingHistory.sort(function(a, b) {
                    var ap = parsePeriod(a.period);
                    var bp = parsePeriod(b.period);
                    return (ap || 0) - (bp || 0);
                });

                target.updatedAt = new Date().toISOString();

                return {
                    period: periodStr,
                    rank: rankNum,
                    teamId: targetId
                };
            },
            logMessage: 'Added ranking to team: ' +
                (current.name || targetId),
            successMessage: 'Ranking added successfully!',
            failureMessage: 'Failed to add ranking.'
        });
    }

    function removeRanking(teamId, period) {
        if (failIfMissing(checkBaseDependencies(), 'removeRanking')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh the page.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(
                failure('Period must be a positive integer.')
            );
        }

        var targetId = String(teamId).trim();
        var periodStr = String(periodNum);

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target ||
                    !Array.isArray(target.rankingHistory)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target ||
                    !Array.isArray(target.rankingHistory)) {
                    throw new Error('Team not found in data store.');
                }

                var found = false;
                target.rankingHistory =
                    target.rankingHistory.filter(function(entry) {
                        if (!entry) return true;
                        var entryPeriod =
                            parsePeriod(entry.period);
                        if (entryPeriod !== null &&
                            String(entryPeriod) === periodStr) {
                            found = true;
                            return false;
                        }
                        return true;
                    });

                if (!found) {
                    throw new Error(
                        'Ranking entry not found.'
                    );
                }

                target.updatedAt = new Date().toISOString();
                return { period: periodStr, teamId: targetId };
            },
            logMessage: 'Removed ranking from team: ' +
                (current.name || targetId),
            successMessage: 'Ranking removed successfully!',
            failureMessage: 'Failed to remove ranking.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * End every active PROFESSIONAL-team stint for a character at
     * the given year. Called from CharacterCRUD when a character's
     * deathYear transitions from blank to a parseable year.
     *
     * SCOPE:
     *   Professional teams only. Academic teams are managed by the
     *   Academy module; temporary and civilian team membership
     *   does not participate in the death cascade.
     *
     * GRANULARITY:
     *   Year. Professional team stints use year strings. There is
     *   no week concept on this side. deathWeek is NOT read.
     *
     * NON-REVERSIBLE:
     *   Clearing deathYear does NOT restore the ended stints.
     *   Ending a stint is a fact, matching the semantics of
     *   `leave`. The user reopens stints by hand if they want to
     *   undo a death.
     *
     * SEMANTICS:
     *   For each professional team:
     *     For each member entry with characterId === charId:
     *       For each interval:
     *         - Skip if leavePeriod is already set and <= deathYear.
     *         - Skip if joinPeriod is >= deathYear. Ending it would
     *           produce leave < join, which is invalid; a stint
     *           starting at or after the death year is a data error
     *           for the user to fix, not something this cascade
     *           silently rewrites.
     *         - Otherwise, set leavePeriod = String(deathYear).
     *
     * PURE with respect to `appData`:
     *   - Mutates the snapshot.
     *   - Never touches window.data.
     *   - Never throws.
     *
     * @param {object} appData
     * @param {string} charId
     * @param {number|string} deathYear
     * @returns {object} {
     *   stintsEnded: number,
     *   teamsTouched: number,
     *   skippedAlreadyEnded: number,
     *   skippedStartsAfterDeath: number
     * }
     */
    function endStintsForCharacter(appData, charId, deathYear) {
        var result = {
            stintsEnded: 0,
            teamsTouched: 0,
            skippedAlreadyEnded: 0,
            skippedStartsAfterDeath: 0
        };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }
        if (!Array.isArray(appData.teams)) {
            return result;
        }

        var deathNum = parsePeriod(deathYear);
        if (deathNum === null) {
            return result;
        }

        var target = String(charId);
        var deathStr = String(deathNum);

        var teamsTouchedSet = Object.create(null);

        for (var t = 0; t < appData.teams.length; t++) {
            var team = appData.teams[t];
            if (!team || typeof team !== 'object') {
                continue;
            }
            if (team.type !== 'professional') {
                continue;
            }
            if (!Array.isArray(team.members)) {
                continue;
            }

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (String(member.characterId) !== target) {
                    continue;
                }
                if (!Array.isArray(member.intervals)) {
                    continue;
                }

                for (var i = 0; i < member.intervals.length; i++) {
                    var iv = member.intervals[i];
                    if (!iv || typeof iv !== 'object') {
                        continue;
                    }

                    var leaveRaw = (iv.leavePeriod === undefined ||
                                    iv.leavePeriod === null)
                        ? ''
                        : String(iv.leavePeriod);
                    var leaveNum = parsePeriod(leaveRaw);

                    // Already ended at or before the death year.
                    if (leaveNum !== null && leaveNum <= deathNum) {
                        result.skippedAlreadyEnded++;
                        continue;
                    }

                    var joinRaw = (iv.joinPeriod === undefined ||
                                   iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    var joinNum = parsePeriod(joinRaw);

                    // Stint starts at or after the death year.
                    // Ending it would be leave < join.
                    if (joinNum !== null && joinNum >= deathNum) {
                        result.skippedStartsAfterDeath++;
                        continue;
                    }

                    iv.leavePeriod = deathStr;
                    result.stintsEnded++;
                    teamsTouchedSet[String(team.id)] = true;
                }

                // Touch the team's updatedAt only if we changed
                // something on it.
                if (teamsTouchedSet[String(team.id)]) {
                    team.updatedAt = new Date().toISOString();
                }
            }
        }

        result.teamsTouched = Object.keys(teamsTouchedSet).length;
        return result;
    }

    function stripCharacterRefs(appData, charId) {
        var result = { membershipsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }
        if (!Array.isArray(appData.teams)) {
            return result;
        }

        var target = String(charId);

        for (var i = 0; i < appData.teams.length; i++) {
            var team = appData.teams[i];
            if (!team || !Array.isArray(team.members)) {
                continue;
            }
            var before = team.members.length;
            team.members = team.members.filter(function(m) {
                return !m ||
                    String(m.characterId) !== target;
            });
            result.membershipsRemoved +=
                before - team.members.length;
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamCore = {
        // Configuration
        configure: configure,

        // Team CRUD
        createTeam: createTeam,
        updateTeam: updateTeam,
        deleteTeam: deleteTeam,

        // Member mutations
        addMember: addMember,
        addMemberInterval: addMemberInterval,
        batchAddMembers: batchAddMembers,
        updateMember: updateMember,
        removeMember: removeMember,
        endMemberInterval: endMemberInterval,
        reopenMemberInterval: reopenMemberInterval,
        purgeMemberInterval: purgeMemberInterval,

        // Ranking mutation
        addRanking: addRanking,
        removeRanking: removeRanking,

        // Cross-domain cascade
        stripCharacterRefs: stripCharacterRefs,
        endStintsForCharacter: endStintsForCharacter
    };

})();
