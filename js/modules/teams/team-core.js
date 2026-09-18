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
 *   - Ranking mutation (add, remove)
 *   - Configuration (characterProvider injection)
 *   - Cross-domain cascade helper (stripCharacterRefs)
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
 *     interval edits. It is not regenerated unless the entry itself
 *     is deleted and a new one created.
 *   - Each interval describes one stint. `joinPeriod` is the first
 *     period the character was on the team; `leavePeriod` is the
 *     last. Both are inclusive. Blank means "unbounded."
 *   - Intervals within one member entry must NOT overlap. This is
 *     enforced on write. Overlap is a bug in the caller; the
 *     mutation rejects it rather than silently merging.
 *   - `joinPeriod` is IMMUTABLE once set. To move a stint's start,
 *     purge the interval and add a new one. This keeps the
 *     identifier stable across edits.
 *
 * MEMBER EXISTENCE:
 *   - The characterProvider.exists(appData, characterId) is
 *     snapshot-aware. It reads from the pipeline's appData snapshot,
 *     so a character deleted earlier in the same transaction cannot
 *     be added.
 *
 * ROLE SEMANTICS:
 *   - Role is a free-form string. Omission defaults to
 *     TeamConstants.DEFAULT_ROLE. A non-string role value is
 *     REJECTED, not silently coerced.
 *
 * DATA STORE CONTRACT:
 *   - window.data.teams is the canonical store.
 *   - Reads inside pipeline callbacks use the appData snapshot.
 *   - Reads inside pre-flight use window.data.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, member records referencing that
 *   character are removed from every team. PURE with respect to
 *   appData: mutates the snapshot but does not touch window.data.
 *   Runs inside another module's pipeline transaction. Never throws.
 *
 * DEPENDENCIES:
 *   - window.TeamConstants    (from team-constants.js) - MANDATORY
 *   - window.IdUtils          (from id-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ObjectUtils      (from object-utils.js) - MANDATORY
 *
 *   characterProvider is injected via configure(). Only member
 *   mutations require it.
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

    /**
     * Configure TeamCore with external dependencies.
     *
     * IDEMPOTENT. The first successful call wins. Subsequent calls
     * with a shape-valid provider return true and leave the
     * existing provider in place. This is deliberate: every caller
     * builds an equivalent `{ exists(appData, characterId) }`
     * provider, and multiple modules legitimately need to configure
     * TeamCore without coordinating. The Teams tab and Academy's
     * Weekly Teams controller are the two callers today.
     *
     * A call with a MALFORMED provider (missing exists, or exists
     * not a function) is rejected with false and a console warning.
     * Callers that only care about "is there a provider" should
     * read the return value as a boolean.
     *
     * @param {object} deps - { characterProvider: {
     *     exists(appData, characterId) -> bool } }
     * @returns {boolean}
     */
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
            // A provider is already configured. Every caller
            // constructs an equivalent provider (the shape is
            // `{ exists(appData, characterId) -> boolean }` and the
            // semantics are identical), so a second call with a
            // shape-valid provider is treated as success. The
            // existing provider stays in place; the new one is
            // discarded.
            //
            // Identity comparison was too strict: two callers
            // (Teams tab and Academy Weekly Teams) build separate
            // provider objects with the same behavior, and the
            // second one used to be rejected as "a different
            // provider", which broke team-form saves after the
            // Teams tab had been visited.
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
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
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
        return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    //
    // canonicalisePeriod(value) -> string
    //   "" if value is undefined/null/empty-string
    //   String(parsePeriod(value)) if valid
    //   null if invalid
    //
    // Used on every period field before writing.

    function parsePeriod(value) {
        if (!TeamConstants || typeof TeamConstants.parsePeriod !== 'function') {
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
        if (!data || !Array.isArray(data.teams) || !isNonEmptyString(id)) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
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
            return { valid: false, message: 'Name history must be an array.' };
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
                    message: 'Name history entry at index ' + i + ' requires a name.'
                };
            }
        }

        return { valid: true };
    }

    /**
     * Assume validated input. Produces the canonical shape.
     */
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

    /**
     * Does the interval have any bounds at all?
     * An interval with both bounds blank describes "always on the
     * team from the beginning of time to forever" — which is
     * meaningless as a stint. Reject it.
     *
     * Note: a brand-new member entry with exactly one interval and
     * both bounds blank is technically "always active." We allow
     * that for the initial creation path but reject it for subsequent
     * appends. The `isInitial` flag captures the difference.
     */
    function intervalHasAnyBound(interval) {
        var hasJoin = interval.joinPeriod !== undefined &&
                      interval.joinPeriod !== null &&
                      interval.joinPeriod !== '';
        var hasLeave = interval.leavePeriod !== undefined &&
                       interval.leavePeriod !== null &&
                       interval.leavePeriod !== '';
        return hasJoin || hasLeave;
    }

    /**
     * Effective end of an interval for overlap comparison.
     * Blank leavePeriod is treated as +Infinity.
     */
    function effectiveIntervalEnd(interval) {
        var leave = canonicalisePeriod(interval.leavePeriod);
        if (leave === '' || leave === null) {
            return Infinity;
        }
        return parseInt(leave, 10);
    }

    /**
     * Effective start of an interval for overlap comparison.
     * Blank joinPeriod is treated as 0 (i.e., always been on team).
     */
    function effectiveIntervalStart(interval) {
        var join = canonicalisePeriod(interval.joinPeriod);
        if (join === '' || join === null) {
            return 0;
        }
        return parseInt(join, 10);
    }

    /**
     * Do two intervals overlap?
     * Inclusive on both ends.
     */
    function intervalsOverlap(a, b) {
        var aStart = effectiveIntervalStart(a);
        var aEnd = effectiveIntervalEnd(a);
        var bStart = effectiveIntervalStart(b);
        var bEnd = effectiveIntervalEnd(b);
        return aStart <= bEnd && bStart <= aEnd;
    }

    /**
     * Validate one interval's shape. Does NOT check overlap against
     * siblings; that is done separately.
     *
     * Returns { valid: true, interval: { joinPeriod, leavePeriod } }
     * or { valid: false, message }.
     */
    function validateIntervalShape(raw) {
        if (!isObject(raw)) {
            return { valid: false, message: 'Interval must be an object.' };
        }

        var joinCanon = canonicalisePeriod(raw.joinPeriod);
        if (joinCanon === null) {
            return { valid: false, message: 'Invalid join period format.' };
        }

        var leaveCanon = canonicalisePeriod(raw.leavePeriod);
        if (leaveCanon === null) {
            return { valid: false, message: 'Invalid leave period format.' };
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
            interval: { joinPeriod: joinCanon, leavePeriod: leaveCanon }
        };
    }

    /**
     * Validate a whole intervals array for a member entry. Checks
     * each interval's shape, then checks pairwise non-overlap.
     *
     * Returns { valid: true, intervals: [...] } or
     * { valid: false, message }.
     */
    function validateMemberIntervals(rawIntervals, teamType, allowEmpty) {
        if (!Array.isArray(rawIntervals)) {
            return { valid: false, message: 'Intervals must be an array.' };
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

            // Team-type bounds check. Blank is valid ("unbounded").
            if (check.interval.joinPeriod !== '' &&
                !TeamConstants.isValidPeriod(check.interval.joinPeriod, teamType)) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                             ': join period is out of bounds for team type.'
                };
            }
            if (check.interval.leavePeriod !== '' &&
                !TeamConstants.isValidPeriod(check.interval.leavePeriod, teamType)) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                             ': leave period is out of bounds for team type.'
                };
            }

            cleaned.push(check.interval);
        }

        // Pairwise non-overlap check.
        for (var a = 0; a < cleaned.length; a++) {
            for (var b = a + 1; b < cleaned.length; b++) {
                if (intervalsOverlap(cleaned[a], cleaned[b])) {
                    return {
                        valid: false,
                        message: 'Intervals ' + (a + 1) + ' and ' + (b + 1) +
                                 ' overlap.'
                    };
                }
            }
        }

        return { valid: true, intervals: cleaned };
    }

    /**
     * Build a canonical interval from raw input. Assumes the input
     * has already been validated (shape + type bounds). Does NOT
     * check overlap.
     */
    function buildCanonicalInterval(raw) {
        return {
            joinPeriod: canonicalisePeriod(raw.joinPeriod),
            leavePeriod: canonicalisePeriod(raw.leavePeriod)
        };
    }

    /**
     * Build a canonical member entry from validated input.
     */
    function buildCanonicalMember(characterId, role, intervals) {
        return {
            memberId: generateMemberId(),
            characterId: String(characterId).trim(),
            role: role,
            intervals: intervals
        };
    }

    // ============================================================
    // MEMBER HELPERS - INPUT SHAPE
    // ============================================================

    /**
     * Extract intervals from member input. Accepts either:
     *   - { intervals: [...] }               (canonical form)
     *   - { joinPeriod, leavePeriod }        (legacy flat form)
     *
     * Returns { intervals: [...] } or null on malformed input.
     */
    function extractIntervalsFromMemberInput(memberData) {
        if (!isObject(memberData)) {
            return null;
        }

        if (Array.isArray(memberData.intervals)) {
            return memberData.intervals;
        }

        // Legacy flat form.
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

        // No intervals, no flat fields. Treat as a single empty
        // interval, which is valid for initial creation.
        return [{
            joinPeriod: '',
            leavePeriod: ''
        }];
    }

    /**
     * Resolve the role from member input.
     * Returns { valid: true, role } or { valid: false, message }.
     */
    function resolveRole(memberData) {
        if (!isObject(memberData)) {
            return { valid: false, message: 'Member data must be an object.' };
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
            return { valid: false, message: 'Invalid ranking entry.' };
        }

        var period = parsePeriod(entry.period);
        if (period === null) {
            return { valid: false, message: 'Invalid period format.' };
        }

        if (!TeamConstants.isValidPeriod(period, teamType)) {
            return { valid: false, message: 'Period is out of bounds for team type.' };
        }

        var rank = parsePeriod(entry.rank);
        if (rank === null) {
            return { valid: false, message: 'Invalid rank format.' };
        }

        return { valid: true, period: period, rank: rank };
    }

    /**
     * Structural invariants for a whole team. Behavioural rules
     * (like "one academic team per class per week") live in
     * TeamRules, not here.
     */
    function validateCompleteTeam(team) {
        if (!isObject(team)) {
            return { valid: false, message: 'Team must be an object.' };
        }

        if (!isNonEmptyString(team.name)) {
            return { valid: false, message: 'Team name is required.' };
        }

        if (!TeamConstants.isValidTeamType(team.type)) {
            return { valid: false, message: 'Invalid team type.' };
        }

        if (!TeamConstants.isValidTeamStatus(team.status)) {
            return { valid: false, message: 'Invalid team status.' };
        }

        // ---- Arrays must be arrays ----
        if (!Array.isArray(team.nameHistory)) {
            return { valid: false, message: 'nameHistory must be an array.' };
        }
        if (!Array.isArray(team.members)) {
            return { valid: false, message: 'members must be an array.' };
        }
        if (!Array.isArray(team.rankingHistory)) {
            return { valid: false, message: 'rankingHistory must be an array.' };
        }

        // ---- Periods ----
        if (!TeamConstants.isValidPeriod(team.startPeriod, team.type)) {
            return { valid: false, message: 'Invalid start period for team type.' };
        }
        if (!TeamConstants.isValidPeriod(team.endPeriod, team.type)) {
            return { valid: false, message: 'Invalid end period for team type.' };
        }

        var startNum = parsePeriod(team.startPeriod);
        var endNum = parsePeriod(team.endPeriod);
        if (startNum !== null && endNum !== null && startNum > endNum) {
            return { valid: false, message: 'Start period cannot be after end period.' };
        }

        // ---- Name history shape ----
        var nameCheck = validateNameHistory(team.nameHistory);
        if (!nameCheck.valid) {
            return nameCheck;
        }

        // ---- Members ----
        // Note: NO duplicate-characterId check. A character may have
        // multiple stints on the same team via one member entry with
        // multiple intervals. The interval-level non-overlap check
        // is the correct invariant now.
        var seenMemberIds = Object.create(null);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!isObject(member)) {
                return { valid: false, message: 'Invalid member record at index ' + i + '.' };
            }
            if (!isNonEmptyString(member.characterId)) {
                return { valid: false, message: 'Member at index ' + i + ' missing characterId.' };
            }

            // memberId must be present and unique within the team.
            if (!isNonEmptyString(member.memberId)) {
                return { valid: false, message: 'Member at index ' + i + ' missing memberId.' };
            }
            var memberIdKey = String(member.memberId);
            if (seenMemberIds[memberIdKey]) {
                return { valid: false, message: 'Duplicate memberId: ' + memberIdKey };
            }
            seenMemberIds[memberIdKey] = true;

            var roleCheck = validateMemberRole(member);
            if (!roleCheck.valid) {
                return roleCheck;
            }

            // Intervals. Empty arrays are permitted at rest (a
            // member entry with no intervals represents a
            // placeholder; the UI surfaces it).
            var intervalCheck = validateMemberIntervals(
                member.intervals, team.type, /* allowEmpty */ true
            );
            if (!intervalCheck.valid) {
                return intervalCheck;
            }
        }

        // ---- Ranking history ----
        var seenPeriods = Object.create(null);
        for (var j = 0; j < team.rankingHistory.length; j++) {
            var entry = team.rankingHistory[j];
            var rankCheck = validateRankingEntry(entry, team.type);
            if (!rankCheck.valid) {
                return rankCheck;
            }
            var periodKey = String(rankCheck.period);
            if (seenPeriods[periodKey]) {
                return { valid: false, message: 'Duplicate ranking entry for period ' + periodKey + '.' };
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
            return { valid: false, message: 'Member role must be a string.' };
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

    /**
     * Build the candidate team that results from applying `updates`
     * to `existing`. Pure. Does not touch window.data.
     *
     * Note: this function does NOT touch members. Member mutations
     * have their own paths.
     */
    function buildUpdatedTeam(existing, updates) {
        var candidate = deepClone(existing);

        // ---- Name ----
        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return { valid: false, message: 'Team name cannot be empty.' };
            }
            candidate.name = String(updates.name).trim();
        }

        // ---- Type ----
        if (updates.type !== undefined) {
            var normalized = TeamConstants.normalizeTeamType(updates.type);
            if (normalized === null) {
                return { valid: false, message: 'Invalid team type: ' + updates.type };
            }
            candidate.type = normalized;
        }

        // ---- Status ----
        if (updates.status !== undefined) {
            if (!TeamConstants.isValidTeamStatus(updates.status)) {
                return { valid: false, message: 'Invalid team status: ' + updates.status };
            }
            candidate.status = updates.status;
        }

        // ---- Periods (canonicalised) ----
        if (updates.startPeriod !== undefined) {
            var startCanon = canonicalisePeriod(updates.startPeriod);
            if (startCanon === null) {
                return { valid: false, message: 'Invalid start period.' };
            }
            candidate.startPeriod = startCanon;
        }
        if (updates.endPeriod !== undefined) {
            var endCanon = canonicalisePeriod(updates.endPeriod);
            if (endCanon === null) {
                return { valid: false, message: 'Invalid end period.' };
            }
            candidate.endPeriod = endCanon;
        }

        // ---- Name history ----
        if (updates.nameHistory !== undefined) {
            var historyCheck = validateNameHistory(updates.nameHistory);
            if (!historyCheck.valid) {
                return historyCheck;
            }
            candidate.nameHistory = normaliseNameHistory(updates.nameHistory);
        }

        // ---- Mission ----
        if (updates.temporaryMission !== undefined) {
            candidate.temporaryMission = updates.temporaryMission !== null &&
                updates.temporaryMission !== ''
                ? String(updates.temporaryMission).trim()
                : null;
        }

        // ---- Class ----
        if (updates.classId !== undefined) {
            candidate.classId = updates.classId !== null &&
                updates.classId !== ''
                ? String(updates.classId).trim()
                : null;
        }

        // ---- Team number ----
        if (updates.teamNumber !== undefined) {
            var numStr = updates.teamNumber !== null && updates.teamNumber !== ''
                ? String(updates.teamNumber).trim()
                : '';
            if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                return { valid: false, message: 'Team identifier contains invalid characters.' };
            }
            candidate.teamNumber = numStr;
        }

        // ---- Revalidate intervals/rankings against the CANDIDATE type ----
        if (Array.isArray(candidate.members)) {
            for (var m = 0; m < candidate.members.length; m++) {
                var member = candidate.members[m];
                if (!member || !Array.isArray(member.intervals)) continue;
                var intervalCheck = validateMemberIntervals(
                    member.intervals, candidate.type, /* allowEmpty */ true
                );
                if (!intervalCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate existing member intervals: ' +
                                 intervalCheck.message
                    };
                }
            }
        }

        if (Array.isArray(candidate.rankingHistory)) {
            for (var r = 0; r < candidate.rankingHistory.length; r++) {
                var rankCheck = validateRankingEntry(candidate.rankingHistory[r], candidate.type);
                if (!rankCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate existing ranking periods: ' +
                                 rankCheck.message
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
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            return Promise.resolve(failure('MutationPipeline is not available.'));
        }

        return MutationPipeline.performMutation({
            validate: config.validate || function() { return { valid: true }; },
            mutate: config.mutate,
            logMessage: config.logMessage,
            successMessage: config.successMessage || 'Team updated.',
            failureMessage: config.failureMessage || 'Failed to update team.'
        });
    }

    // ============================================================
    // TEAM CRUD
    // ============================================================

    function createTeam(teamData) {
        if (failIfMissing(checkBaseDependencies(), 'createTeam')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isObject(teamData)) {
            return Promise.resolve(failure('Team data must be an object.'));
        }

        if (!isNonEmptyString(teamData.name)) {
            return Promise.resolve(failure('Team name is required.'));
        }

        var normalizedType = TeamConstants.normalizeTeamType(teamData.type);
        if (normalizedType === null) {
            return Promise.resolve(failure('Invalid team type: ' + teamData.type));
        }

        var status = teamData.status || TeamConstants.DEFAULT_TEAM_STATUS;
        if (!TeamConstants.isValidTeamStatus(status)) {
            return Promise.resolve(failure('Invalid team status: ' + status));
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
                    return { valid: false, message: 'Team data store is not available.' };
                }
                if (findTeamInData(snapshot, targetId)) {
                    return { valid: false, message: 'Team ID collision.' };
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
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        if (!isObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        if (Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var targetId = String(id).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Pre-flight candidate — for early failure.
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
                    return { valid: false, message: 'Team data store is not available.' };
                }
                var currentInSnapshot = findTeamInData(snapshot, targetId);
                if (!currentInSnapshot) {
                    return { valid: false, message: 'Team no longer exists.' };
                }

                var snapshotBuild = buildUpdatedTeam(currentInSnapshot, updatesCopy);
                if (!snapshotBuild.valid) {
                    return { valid: false, message: snapshotBuild.message };
                }
                var snapshotCheck = validateCompleteTeam(snapshotBuild.candidate);
                if (!snapshotCheck.valid) {
                    return { valid: false, message: snapshotCheck.message };
                }

                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error('Team not found in data store.');
                }

                var snapshotBuild = buildUpdatedTeam(target, updatesCopy);
                if (!snapshotBuild.valid) {
                    throw new Error(snapshotBuild.message);
                }
                var snapshotCheck = validateCompleteTeam(snapshotBuild.candidate);
                if (!snapshotCheck.valid) {
                    throw new Error(snapshotCheck.message);
                }

                var candidate = snapshotBuild.candidate;

                var updateableProps = [
                    'name', 'type', 'startPeriod', 'endPeriod', 'status',
                    'classId', 'teamNumber', 'temporaryMission', 'nameHistory',
                    'updatedAt'
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
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
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
                    return { valid: false, message: 'Team data store is not available.' };
                }
                if (!findTeamInData(snapshot, targetId)) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var idx = -1;
                for (var i = 0; i < snapshot.teams.length; i++) {
                    if (snapshot.teams[i] && String(snapshot.teams[i].id) === targetId) {
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

    /**
     * Add a member to a team.
     *
     * SEMANTICS:
     *   - When the character has NO existing entry on the team:
     *     create a new entry with a fresh memberId and the provided
     *     interval(s).
     *   - When the character ALREADY has an entry on the team:
     *     append the provided interval(s) to the existing entry.
     *     Reject if any provided interval overlaps an existing one.
     *
     * Accepts either the canonical `{ intervals: [...] }` shape or
     * the legacy flat `{ joinPeriod, leavePeriod }` shape. Both are
     * normalised to intervals.
     *
     * @param {string} teamId
     * @param {object} memberData
     *   { characterId, role?, intervals? } or
     *   { characterId, role?, joinPeriod?, leavePeriod? }
     * @returns {Promise<{ success, data?, message? }>}
     */
    function addMember(teamId, memberData) {
        if (failIfMissing(checkMemberDependencies(), 'addMember')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        if (!isObject(memberData)) {
            return Promise.resolve(failure('Member data must be an object.'));
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
            return Promise.resolve(failure('Could not read intervals from member data.'));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(memberData.characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Validate the proposed intervals against the team's type.
        var incomingCheck = validateMemberIntervals(
            rawIntervals, current.type, /* allowEmpty */ false
        );
        if (!incomingCheck.valid) {
            return Promise.resolve(failure(incomingCheck.message));
        }

        // Pre-flight: are the incoming intervals compatible with any
        // existing intervals for this character?
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
                for (var b = 0; b < existingEntry.intervals.length; b++) {
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
            return { joinPeriod: iv.joinPeriod, leavePeriod: iv.leavePeriod };
        });

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                if (!Array.isArray(target.members)) {
                    return { valid: false, message: 'Team members are malformed.' };
                }

                // Snapshot-aware character existence.
                if (!_characterProvider.exists(snapshot, targetChar)) {
                    return { valid: false, message: 'Character not found.' };
                }

                // Re-check overlap against the snapshot's state.
                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (!m || String(m.characterId) !== targetChar) continue;
                    if (!Array.isArray(m.intervals)) continue;

                    for (var a = 0; a < intervalsCopy.length; a++) {
                        for (var b = 0; b < m.intervals.length; b++) {
                            if (intervalsOverlap(intervalsCopy[a], m.intervals[b])) {
                                return {
                                    valid: false,
                                    message: 'The new interval overlaps an ' +
                                             'existing one for this character ' +
                                             'on this team.'
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

                // Find existing entry for this character.
                var entry = null;
                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (m && String(m.characterId) === targetChar) {
                        entry = m;
                        break;
                    }
                }

                if (entry) {
                    // Append intervals to existing entry. Role is
                    // preserved on the existing entry; a new role on
                    // the incoming call is ignored. Role is updated
                    // through updateMember, not addMember.
                    if (!Array.isArray(entry.intervals)) {
                        entry.intervals = [];
                    }
                    for (var a = 0; a < intervalsCopy.length; a++) {
                        entry.intervals.push({
                            joinPeriod: intervalsCopy[a].joinPeriod,
                            leavePeriod: intervalsCopy[a].leavePeriod
                        });
                    }
                } else {
                    // Create a new entry.
                    var newEntry = buildCanonicalMember(
                        targetChar, roleCopy, intervalsCopy
                    );
                    target.members.push(newEntry);
                    entry = newEntry;
                }

                target.updatedAt = new Date().toISOString();
                return { memberId: entry.memberId, characterId: targetChar, teamId: targetId };
            },
            logMessage: 'Added member interval to team: ' + (current.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        });
    }

    /**
     * Append a single interval to a character's entry on a team.
     *
     * Convenience wrapper around addMember that takes flat bounds.
     * If the character has no entry, creates one. If the entry
     * exists, appends the interval (rejecting on overlap).
     *
     * @param {string} teamId
     * @param {string} characterId
     * @param {number|string} joinPeriod
     * @param {number|string} leavePeriod
     * @returns {Promise<{ success, data?, message? }>}
     */
    function addMemberInterval(teamId, characterId, joinPeriod, leavePeriod) {
        return addMember(teamId, {
            characterId: characterId,
            intervals: [{
                joinPeriod: joinPeriod,
                leavePeriod: leavePeriod
            }]
        });
    }

    /**
     * Update a member's ROLE only.
     *
     * Interval edits are separate concerns. To change when a stint
     * starts, purge the interval and add a new one. To close a
     * stint, use endMemberInterval. To reopen a stint, use
     * reopenMemberInterval.
     *
     * @param {string} teamId
     * @param {string} charId
     * @param {object} updates - { role?: string }
     * @returns {Promise<{ success, data?, message? }>}
     */
    function updateMember(teamId, charId, updates) {
        if (failIfMissing(checkBaseDependencies(), 'updateMember')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        // Reject interval edits on this path. They have their own
        // functions.
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

        // Build proposed role.
        var proposedRole;
        if (updates.role !== undefined) {
            if (updates.role !== null && typeof updates.role !== 'string') {
                return Promise.resolve(failure('Member role must be a string.'));
            }
            if (updates.role === null || updates.role.trim() === '') {
                proposedRole = TeamConstants.DEFAULT_ROLE;
            } else {
                proposedRole = updates.role.trim();
            }
        } else {
            // Nothing to change.
            return Promise.resolve(failure('No fields to update.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var liveMember = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    return {
                        valid: false,
                        message: 'Character is not a member of this team.'
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
                    if (String(target.members[i].characterId) === targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    throw new Error('Member not found in data store.');
                }

                liveMember.role = proposedRole;
                target.updatedAt = new Date().toISOString();

                return { member: liveMember, teamId: targetId };
            },
            logMessage: 'Updated member role on team: ' + (current.name || targetId),
            successMessage: 'Member updated successfully!',
            failureMessage: 'Failed to update member.'
        });
    }

    /**
     * Hard-delete a whole member entry (all intervals).
     *
     * This is the "Remove" action. To close one stint but keep the
     * entry, use endMemberInterval.
     *
     * @param {string} teamId
     * @param {string} charId
     * @returns {Promise<{ success, data?, message? }>}
     */
    function removeMember(teamId, charId) {
        if (failIfMissing(checkBaseDependencies(), 'removeMember')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
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
            if (String(current.members[i].characterId) === targetChar) {
                found = true;
                break;
            }
        }
        if (!found) {
            return Promise.resolve(failure('Character is not a member of this team.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var present = target.members.some(function(m) {
                    return m && String(m.characterId) === targetChar;
                });
                if (!present) {
                    return { valid: false, message: 'Character is no longer a member of this team.' };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error('Team not found in data store.');
                }
                target.members = target.members.filter(function(m) {
                    return !m || String(m.characterId) !== targetChar;
                });
                target.updatedAt = new Date().toISOString();
                return { characterId: targetChar, teamId: targetId };
            },
            logMessage: 'Removed member from team: ' + (current.name || targetId),
            successMessage: 'Member removed successfully!',
            failureMessage: 'Failed to remove member.'
        });
    }

    /**
     * Close one interval by setting its leavePeriod to `leaveWeek`.
     *
     * The "Leave" primitive. When the user clicks "Leave" while
     * viewing week N, the caller passes leaveWeek = N. The member
     * was active through week N and is inactive from week N+1.
     *
     * Rejects if:
     *   - The interval doesn't exist.
     *   - leaveWeek is before the interval's join.
     *   - The interval's existing leave is already at or before
     *     leaveWeek (nothing to do).
     *
     * @param {string} teamId
     * @param {string} characterId
     * @param {number|string} joinPeriod - identifies the interval
     * @param {number|string} leaveWeek
     * @returns {Promise<{ success, data?, message? }>}
     */
    function endMemberInterval(teamId, characterId, joinPeriod, leaveWeek) {
        if (failIfMissing(checkBaseDependencies(), 'endMemberInterval')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined || joinPeriod === null)
            ? ''
            : String(joinPeriod);

        var leaveCanon = canonicalisePeriod(leaveWeek);
        if (leaveCanon === null || leaveCanon === '') {
            return Promise.resolve(failure('Valid leave week is required.'));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Pre-flight: interval exists, is open, and leave is after
        // join.
        var entry = null;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) === targetChar) {
                entry = current.members[i];
                break;
            }
        }
        if (!entry || !Array.isArray(entry.intervals)) {
            return Promise.resolve(failure('Character is not a member of this team.'));
        }

        var targetInterval = null;
        for (var j = 0; j < entry.intervals.length; j++) {
            var iv = entry.intervals[j];
            if (!iv) continue;
            var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
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

        var currentLeaveCanon = canonicalisePeriod(targetInterval.leavePeriod);
        if (currentLeaveCanon !== '' && currentLeaveCanon !== null) {
            var currentLeaveNum = parseInt(currentLeaveCanon, 10);
            var newLeaveNum = parseInt(leaveCanon, 10);
            if (currentLeaveNum <= newLeaveNum) {
                return Promise.resolve(failure(
                    'Interval is already closed at or before week ' + leaveCanon + '.'
                ));
            }
        }

        // If the interval has a join, leave must be >= join.
        var joinCanon = canonicalisePeriod(targetInterval.joinPeriod);
        if (joinCanon !== '' && joinCanon !== null) {
            var joinNum = parseInt(joinCanon, 10);
            var leaveNumCheck = parseInt(leaveCanon, 10);
            if (leaveNumCheck < joinNum) {
                return Promise.resolve(failure(
                    'Leave week cannot be before the interval\'s join week.'
                ));
            }
        }

        var leaveCanonCopy = leaveCanon;

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry || !Array.isArray(liveEntry.intervals)) {
                    return { valid: false, message: 'Character is no longer a member of this team.' };
                }
                var liveIv = null;
                for (var j = 0; j < liveEntry.intervals.length; j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return { valid: false, message: 'Interval no longer exists.' };
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
                    if (String(target.members[i].characterId) === targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry || !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                var liveIv = null;
                for (var j = 0; j < liveEntry.intervals.length; j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
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
            logMessage: 'Ended member interval on team: ' + (current.name || targetId),
            successMessage: 'Member left successfully.',
            failureMessage: 'Failed to end member interval.'
        });
    }

    /**
     * Reopen a closed interval by setting its leavePeriod to ''.
     *
     * Use case: "I closed this stint too early." Does not touch
     * joinPeriod. Rejects if the interval is already open.
     *
     * @param {string} teamId
     * @param {string} characterId
     * @param {number|string} joinPeriod - identifies the interval
     * @returns {Promise<{ success, data?, message? }>}
     */
    function reopenMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(checkBaseDependencies(), 'reopenMemberInterval')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined || joinPeriod === null)
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
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry || !Array.isArray(liveEntry.intervals)) {
                    return { valid: false, message: 'Character is no longer a member of this team.' };
                }
                var liveIv = null;
                for (var j = 0; j < liveEntry.intervals.length; j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return { valid: false, message: 'Interval no longer exists.' };
                }

                var lv = canonicalisePeriod(liveIv.leavePeriod);
                if (lv === '') {
                    return { valid: false, message: 'Interval is already open.' };
                }

                // Overlap check: if we clear this interval's leave,
                // does it collide with a later interval in the same
                // entry?
                for (var k = 0; k < liveEntry.intervals.length; k++) {
                    if (liveEntry.intervals[k] === liveIv) continue;
                    var other = liveEntry.intervals[k];
                    if (!other) continue;
                    var otherStart = effectiveIntervalStart(other);
                    var thisStart = effectiveIntervalStart(liveIv);
                    // With this interval's leave cleared (Infinity),
                    // it overlaps any interval whose start is after
                    // thisStart.
                    if (thisStart <= effectiveIntervalEnd(other) &&
                        otherStart <= Infinity) {
                        // But only if they actually touch.
                        if (otherStart >= thisStart) {
                            return {
                                valid: false,
                                message: 'Reopening this interval would overlap a later interval.'
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
                    if (String(target.members[i].characterId) === targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry || !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                for (var j = 0; j < liveEntry.intervals.length; j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        iv.leavePeriod = '';
                        target.updatedAt = new Date().toISOString();
                        return {
                            teamId: targetId,
                            characterId: targetChar,
                            joinPeriod: targetJoin
                        };
                    }
                }

                throw new Error('Interval not found.');
            },
            logMessage: 'Reopened member interval on team: ' + (current.name || targetId),
            successMessage: 'Interval reopened.',
            failureMessage: 'Failed to reopen interval.'
        });
    }

    /**
     * Hard-delete ONE interval from a member's entry.
     *
     * If the member is left with zero intervals, the member entry is
     * deleted entirely. This is the "remove this specific stint"
     * primitive. For "remove the whole member," use removeMember.
     *
     * @param {string} teamId
     * @param {string} characterId
     * @param {number|string} joinPeriod - identifies the interval
     * @returns {Promise<{ success, data?, message? }>}
     */
    function purgeMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(checkBaseDependencies(), 'purgeMemberInterval')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var targetJoin = (joinPeriod === undefined || joinPeriod === null)
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
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry || !Array.isArray(liveEntry.intervals)) {
                    return { valid: false, message: 'Character is no longer a member of this team.' };
                }
                var found = false;
                for (var j = 0; j < liveEntry.intervals.length; j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === targetJoin) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return { valid: false, message: 'Interval not found.' };
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
                    if (String(target.members[i].characterId) === targetChar) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Member not found.');
                }

                var liveEntry = target.members[idx];
                if (!Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member has no intervals array.');
                }

                var before = liveEntry.intervals.length;
                liveEntry.intervals = liveEntry.intervals.filter(function(iv) {
                    if (!iv || typeof iv !== 'object') return false;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    return ivJoin !== targetJoin;
                });
                var removed = before - liveEntry.intervals.length;
                if (removed === 0) {
                    throw new Error('Interval not found.');
                }

                // If the entry has no intervals left, prune it.
                if (liveEntry.intervals.length === 0) {
                    target.members.splice(idx, 1);
                }

                target.updatedAt = new Date().toISOString();
                return {
                    teamId: targetId,
                    characterId: targetChar,
                    joinPeriod: targetJoin,
                    memberRemoved: liveEntry.intervals.length === 0
                };
            },
            logMessage: 'Purged member interval on team: ' + (current.name || targetId),
            successMessage: 'Interval removed.',
            failureMessage: 'Failed to remove interval.'
        });
    }

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function addRanking(teamId, period, rank) {
        if (failIfMissing(checkBaseDependencies(), 'addRanking')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(failure('Period must be a positive integer.'));
        }

        var rankNum = parsePeriod(rank);
        if (rankNum === null) {
            return Promise.resolve(failure('Rank must be a positive integer.'));
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
                    return { valid: false, message: 'Team no longer exists.' };
                }
                var check = validateRankingEntry(
                    { period: periodNum, rank: rankNum },
                    target.type
                );
                if (!check.valid) {
                    return { valid: false, message: check.message };
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
                for (var i = 0; i < target.rankingHistory.length; i++) {
                    var entryPeriod = parsePeriod(target.rankingHistory[i].period);
                    if (entryPeriod !== null && String(entryPeriod) === periodStr) {
                        existingIndex = i;
                        break;
                    }
                }

                var newEntry = { period: periodStr, rank: rankNum };
                if (existingIndex !== -1) {
                    target.rankingHistory[existingIndex] = newEntry;
                } else {
                    target.rankingHistory.push(newEntry);
                }

                target.rankingHistory.sort(function(a, b) {
                    var ap = parsePeriod(a.period);
                    var bp = parsePeriod(b.period);
                    return (ap || 0) - (bp || 0);
                });

                target.updatedAt = new Date().toISOString();

                return { period: periodStr, rank: rankNum, teamId: targetId };
            },
            logMessage: 'Added ranking to team: ' + (current.name || targetId),
            successMessage: 'Ranking added successfully!',
            failureMessage: 'Failed to add ranking.'
        });
    }

    function removeRanking(teamId, period) {
        if (failIfMissing(checkBaseDependencies(), 'removeRanking')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(failure('Period must be a positive integer.'));
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
                if (!target || !Array.isArray(target.rankingHistory)) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.rankingHistory)) {
                    throw new Error('Team not found in data store.');
                }

                var found = false;
                target.rankingHistory = target.rankingHistory.filter(function(entry) {
                    if (!entry) return true;
                    var entryPeriod = parsePeriod(entry.period);
                    if (entryPeriod !== null && String(entryPeriod) === periodStr) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Ranking entry not found.');
                }

                target.updatedAt = new Date().toISOString();
                return { period: periodStr, teamId: targetId };
            },
            logMessage: 'Removed ranking from team: ' + (current.name || targetId),
            successMessage: 'Ranking removed successfully!',
            failureMessage: 'Failed to remove ranking.'
        });
    }

    // ============================================================
    // CASCADE HELPER
    // ============================================================

    /**
     * Strip all references to a character from every team's members
     * array.
     *
     * PURE with respect to appData: mutates the snapshot, does not
     * touch window.data. Runs inside another module's pipeline
     * transaction. Never throws.
     *
     * Malformed entries are preserved; this helper's job is to
     * remove character references, not to repair team data.
     *
     * @param {object} appData
     * @param {string} charId
     * @returns {object} { membershipsRemoved }
     */
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
                return !m || String(m.characterId) !== target;
            });
            result.membershipsRemoved += before - team.members.length;
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
        updateMember: updateMember,
        removeMember: removeMember,
        endMemberInterval: endMemberInterval,
        reopenMemberInterval: reopenMemberInterval,
        purgeMemberInterval: purgeMemberInterval,

        // Ranking mutation
        addRanking: addRanking,
        removeRanking: removeRanking,

        // Cross-domain cascade
        stripCharacterRefs: stripCharacterRefs
    };

})();
