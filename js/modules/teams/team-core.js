/**
 * modules/teams/team-core.js - Team Core
 * CANONICAL mutation API for teams.
 *
 * Path: js/modules/teams/team-core.js
 *
 * This module provides:
 *   - Team CRUD (create, update, delete)
 *   - Member mutation (add, remove, update)
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
 *   - Invalid periods are rejected, not coerced.
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
     * Idempotent on the same provider identity. A second call with a
     * DIFFERENT provider object is rejected: swapping character
     * stores at runtime is never correct, and silently accepting it
     * hides bugs.
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
            if (deps.characterProvider === _characterProvider) {
                return true;
            }
            console.warn(
                '[TeamCore] configure() called with a different provider. ' +
                'The existing provider is kept; the new provider is ignored.'
            );
            return false;
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
    // Public: canonicalisePeriod(value) -> string
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
     * Callers that might receive malformed input must run
     * validateNameHistory first.
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
    // MEMBER HELPERS
    // ============================================================

    /**
     * Build a canonical member record from raw input.
     *
     * Returns null on invalid input. A "malformed role" (present but
     * not a string) is invalid; omission is fine.
     */
    function buildValidatedMember(memberData) {
        if (!isObject(memberData)) {
            return null;
        }
        if (!isNonEmptyString(memberData.characterId)) {
            return null;
        }

        var role;
        if (memberData.role === undefined || memberData.role === null) {
            role = TeamConstants.DEFAULT_ROLE;
        } else if (typeof memberData.role === 'string') {
            role = memberData.role.trim() === ''
                ? TeamConstants.DEFAULT_ROLE
                : memberData.role.trim();
        } else {
            // Malformed role value. Reject.
            return null;
        }

        var joinPeriod = canonicalisePeriod(memberData.joinPeriod);
        if (joinPeriod === null) {
            return null;
        }

        var leavePeriod = canonicalisePeriod(memberData.leavePeriod);
        if (leavePeriod === null) {
            return null;
        }

        return {
            characterId: String(memberData.characterId).trim(),
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        };
    }

    function validateMemberPeriods(member, teamType) {
        var hasJoin = member.joinPeriod !== undefined &&
                      member.joinPeriod !== null &&
                      member.joinPeriod !== '';
        var hasLeave = member.leavePeriod !== undefined &&
                       member.leavePeriod !== null &&
                       member.leavePeriod !== '';

        var join = null;
        var leave = null;

        if (hasJoin) {
            join = parsePeriod(member.joinPeriod);
            if (join === null) {
                return { valid: false, message: 'Invalid join period format.' };
            }
            if (!TeamConstants.isValidPeriod(join, teamType)) {
                return { valid: false, message: 'Join period is out of bounds for team type.' };
            }
        }

        if (hasLeave) {
            leave = parsePeriod(member.leavePeriod);
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period format.' };
            }
            if (!TeamConstants.isValidPeriod(leave, teamType)) {
                return { valid: false, message: 'Leave period is out of bounds for team type.' };
            }
        }

        if (join !== null && leave !== null && join > leave) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
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
    // RANKING HELPERS
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

    // ============================================================
    // COMPLETE TEAM VALIDATION
    // ============================================================
    //
    // Structural invariants enforced here. Behavioural rules (like
    // "one academic team per class per week") live in TeamRules, not
    // here.

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
        var seenChars = Object.create(null);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!isObject(member)) {
                return { valid: false, message: 'Invalid member record at index ' + i + '.' };
            }
            if (!isNonEmptyString(member.characterId)) {
                return { valid: false, message: 'Member at index ' + i + ' missing characterId.' };
            }
            var charKey = String(member.characterId);
            if (seenChars[charKey]) {
                return { valid: false, message: 'Duplicate member: ' + charKey };
            }
            seenChars[charKey] = true;

            var periodCheck = validateMemberPeriods(member, team.type);
            if (!periodCheck.valid) {
                return periodCheck;
            }

            var roleCheck = validateMemberRole(member);
            if (!roleCheck.valid) {
                return roleCheck;
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
     * Returns { valid: true, candidate } or { valid: false, message }.
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

        // ---- Revalidate members/rankings against the CANDIDATE type ----
        if (Array.isArray(candidate.members)) {
            for (var m = 0; m < candidate.members.length; m++) {
                var periodCheck = validateMemberPeriods(candidate.members[m], candidate.type);
                if (!periodCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate existing member periods: ' +
                                 periodCheck.message
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

                // Authoritative rebuild against the snapshot.
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

                // Re-derive from the snapshot. This is what actually
                // gets applied, so validate() and mutate() cannot
                // diverge.
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

    function addMember(teamId, memberData) {
        if (failIfMissing(checkMemberDependencies(), 'addMember')) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var member = buildValidatedMember(memberData);
        if (!member) {
            return Promise.resolve(failure('Invalid member data.'));
        }

        var targetId = String(teamId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        if (Array.isArray(current.members)) {
            for (var i = 0; i < current.members.length; i++) {
                if (String(current.members[i].characterId) === String(member.characterId)) {
                    return Promise.resolve(failure('Character is already a member of this team.'));
                }
            }
        }

        var periodCheck = validateMemberPeriods(member, current.type);
        if (!periodCheck.valid) {
            return Promise.resolve(failure(periodCheck.message));
        }

        var memberCopy = deepClone(member);

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
                if (!_characterProvider.exists(snapshot, memberCopy.characterId)) {
                    return { valid: false, message: 'Character not found.' };
                }

                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === String(memberCopy.characterId)) {
                        return { valid: false, message: 'Character is already a member of this team.' };
                    }
                }

                var periodCheck = validateMemberPeriods(memberCopy, target.type);
                if (!periodCheck.valid) {
                    return { valid: false, message: periodCheck.message };
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
                target.members.push(deepClone(memberCopy));
                target.updatedAt = new Date().toISOString();
                return { member: memberCopy, teamId: targetId };
            },
            logMessage: 'Added member to team: ' + (current.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        });
    }

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

        var targetId = String(teamId).trim();
        var targetChar = String(charId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var member = null;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) === targetChar) {
                member = current.members[i];
                break;
            }
        }
        if (!member) {
            return Promise.resolve(failure('Character is not a member of this team.'));
        }

        // Build proposed member (characterId immutable).
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
        } else if (typeof member.role === 'string') {
            proposedRole = member.role;
        } else {
            proposedRole = TeamConstants.DEFAULT_ROLE;
        }

        var proposedJoin;
        if (updates.joinPeriod !== undefined) {
            var jc = canonicalisePeriod(updates.joinPeriod);
            if (jc === null) {
                return Promise.resolve(failure('Invalid join period.'));
            }
            proposedJoin = jc;
        } else {
            proposedJoin = typeof member.joinPeriod === 'string' ? member.joinPeriod : '';
        }

        var proposedLeave;
        if (updates.leavePeriod !== undefined) {
            var lc = canonicalisePeriod(updates.leavePeriod);
            if (lc === null) {
                return Promise.resolve(failure('Invalid leave period.'));
            }
            proposedLeave = lc;
        } else {
            proposedLeave = typeof member.leavePeriod === 'string' ? member.leavePeriod : '';
        }

        var proposed = {
            characterId: member.characterId,
            role: proposedRole,
            joinPeriod: proposedJoin,
            leavePeriod: proposedLeave
        };

        var periodCheck = validateMemberPeriods(proposed, current.type);
        if (!periodCheck.valid) {
            return Promise.resolve(failure(periodCheck.message));
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
                    return { valid: false, message: 'Character is no longer a member of this team.' };
                }

                var periodCheck = validateMemberPeriods(proposed, target.type);
                if (!periodCheck.valid) {
                    return { valid: false, message: periodCheck.message };
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

                liveMember.role = proposed.role;
                liveMember.joinPeriod = proposed.joinPeriod;
                liveMember.leavePeriod = proposed.leavePeriod;

                target.updatedAt = new Date().toISOString();

                return { member: liveMember, teamId: targetId };
            },
            logMessage: 'Updated member on team: ' + (current.name || targetId),
            successMessage: 'Member updated successfully!',
            failureMessage: 'Failed to update member.'
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
                // Re-validate against the snapshot's type.
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

        // Member mutation
        addMember: addMember,
        removeMember: removeMember,
        updateMember: updateMember,

        // Ranking mutation
        addRanking: addRanking,
        removeRanking: removeRanking,

        // Cross-domain cascade
        stripCharacterRefs: stripCharacterRefs
    };

})();
