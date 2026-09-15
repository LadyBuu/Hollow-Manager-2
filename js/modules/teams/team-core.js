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
 *     owned by TeamQueries. Any caller that wants a team record uses
 *     TeamQueries.getTeamById.
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
 *   FULL proposed state (candidate) before applying it. Silent
 *   ignoring of invalid fields — the previous behaviour of the old
 *   updateTeam — is gone.
 *
 *   Validations run twice:
 *     1. Pre-flight against window.data. Fast fail for obvious
 *        problems. This is not authoritative; another mutation
 *        could have been queued between pre-flight and the pipeline.
 *     2. Inside the pipeline's validate() callback against the
 *        snapshot. This IS authoritative. It re-derives the
 *        candidate from the snapshot and re-validates.
 *
 * PERIOD SEMANTICS:
 *   - Periods are positive integers (or integer strings). TeamConstants
 *     owns the parser and per-type bounds.
 *   - Periods are canonicalised to numeric strings on write:
 *     period: "2025", not 2025, not "02025".
 *   - Invalid periods are rejected, not coerced.
 *
 * STATUS SEMANTICS:
 *   - Valid statuses: active, inactive, deprecated. Enforced via
 *     TeamConstants.isValidTeamStatus.
 *
 * TYPE-CHANGE SEMANTICS:
 *   - Changing a team's type revalidates its member periods and
 *     ranking history periods against the new type's bounds.
 *     A change that would produce an internally inconsistent record
 *     is rejected.
 *
 * DATA STORE CONTRACT:
 *   - window.data.teams is the canonical store.
 *   - Reads inside pipeline callbacks use the appData snapshot.
 *   - Reads inside pre-flight use window.data.
 *
 * DEFAULT ROLE:
 *   - DEFAULT_ROLE ('Member') is the fallback when a caller supplies
 *     an empty role. Role is a free-form string; TeamConstants does
 *     not enforce a closed enum.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, member records referencing that
 *   character are removed from every team. This helper is PURE with
 *   respect to appData: it mutates the snapshot but does not touch
 *   window.data. It runs inside another module's pipeline
 *   transaction. It never throws.
 *
 *   Cross-domain cleanup (weekly teams, tournament participants,
 *   etc.) is not this module's concern. A future TeamCascade
 *   coordinator will own that list.
 *
 * DEPENDENCIES:
 *   - window.TeamConstants    (from team-constants.js) - MANDATORY
 *   - window.IdUtils          (from id-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ObjectUtils      (from object-utils.js) - MANDATORY
 *     (used by MutationPipeline and by the candidate builders here)
 *
 *   characterProvider is injected via configure().
 *
 * USAGE:
 *   TeamCore.configure({
 *       characterProvider: {
 *           exists: function(id) {
 *               return CharacterQueries.getCharacterById(id) !== null;
 *           }
 *       }
 *   });
 *
 *   TeamCore.createTeam({ name: 'Valiant', type: 'professional' })
 *       .then(function(result) {
 *           if (result.success) { ... }
 *       });
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

    /**
     * Configure TeamCore with external dependencies.
     * Must be called before any mutation that touches member records.
     *
     * @param {object} deps - { characterProvider: { exists(id) -> bool } }
     * @returns {boolean} True if configured successfully
     */
    function configure(deps) {
        deps = deps || {};

        if (deps.characterProvider) {
            if (typeof deps.characterProvider.exists !== 'function') {
                console.warn('[TeamCore] characterProvider must have an exists() method.');
                return false;
            }
            _characterProvider = deps.characterProvider;
        }

        return true;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
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

        if (!_characterProvider || typeof _characterProvider.exists !== 'function') {
            missing.push('characterProvider.exists (call TeamCore.configure() first)');
        }

        if (missing.length > 0) {
            console.warn('[TeamCore] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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

    /**
     * Find a team in the given data object by ID.
     *
     * Used by both pre-flight (against window.data) and pipeline
     * callbacks (against the appData snapshot). This is the SINGLE
     * place that traverses the team array by ID.
     *
     * @param {object} data
     * @param {string} id
     * @returns {object|null} live reference, or null
     */
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
    // PERIOD HELPERS - delegate to TeamConstants
    // ============================================================

    function parsePeriod(value) {
        if (!TeamConstants || typeof TeamConstants.parsePeriod !== 'function') {
            return null;
        }
        return TeamConstants.parsePeriod(value);
    }

    function isValidPeriodForType(period, type) {
        if (period === null || period === undefined || period === '') {
            return true;
        }
        return TeamConstants.isValidPeriod(period, type);
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

    function buildValidatedNameHistory(history) {
        if (!Array.isArray(history)) {
            return null;
        }
        var result = [];
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!isObject(entry)) { continue; }
            var name = String(entry.name || '').trim();
            if (!name) { continue; }
            result.push({
                name: name,
                startPeriod: String(entry.startPeriod || '').trim(),
                endPeriod: String(entry.endPeriod || '').trim()
            });
        }
        return result;
    }

    // ============================================================
    // MEMBER HELPERS
    // ============================================================

    function buildValidatedMember(memberData) {
        if (!isObject(memberData)) {
            return null;
        }
        if (!isNonEmptyString(memberData.characterId)) {
            return null;
        }

        return {
            characterId: String(memberData.characterId).trim(),
            role: isNonEmptyString(memberData.role)
                ? String(memberData.role).trim()
                : TeamConstants.DEFAULT_ROLE,
            joinPeriod: memberData.joinPeriod !== undefined && memberData.joinPeriod !== null
                ? String(memberData.joinPeriod).trim()
                : '',
            leavePeriod: memberData.leavePeriod !== undefined && memberData.leavePeriod !== null
                ? String(memberData.leavePeriod).trim()
                : ''
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
            if (!isValidPeriodForType(join, teamType)) {
                return { valid: false, message: 'Join period is out of bounds for team type.' };
            }
        }

        if (hasLeave) {
            leave = parsePeriod(member.leavePeriod);
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period format.' };
            }
            if (!isValidPeriodForType(leave, teamType)) {
                return { valid: false, message: 'Leave period is out of bounds for team type.' };
            }
        }

        if (join !== null && leave !== null && join > leave) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }

        return { valid: true };
    }

    function validateMemberRole(member) {
        // Role is free-form. TeamConstants does not enforce an enum.
        // This validator exists as a hook for future role rules.
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

        if (!isValidPeriodForType(period, teamType)) {
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
    // This is the invariant gate for the entire team record. Every
    // mutation builds a complete candidate team and runs it through
    // this function before applying it.

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

        if (!isValidPeriodForType(team.startPeriod, team.type)) {
            return { valid: false, message: 'Invalid start period for team type.' };
        }
        if (!isValidPeriodForType(team.endPeriod, team.type)) {
            return { valid: false, message: 'Invalid end period for team type.' };
        }

        var startNum = parsePeriod(team.startPeriod);
        var endNum = parsePeriod(team.endPeriod);
        if (startNum !== null && endNum !== null && startNum > endNum) {
            return { valid: false, message: 'Start period cannot be after end period.' };
        }

        if (Array.isArray(team.nameHistory)) {
            var nameCheck = validateNameHistory(team.nameHistory);
            if (!nameCheck.valid) {
                return nameCheck;
            }
        }

        if (Array.isArray(team.members)) {
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
        }

        if (Array.isArray(team.rankingHistory)) {
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
        }

        return { valid: true };
    }

    // ============================================================
    // CANDIDATE BUILDERS
    // ============================================================

    function buildNewTeam(teamData) {
        return {
            id: generateId(),
            name: String(teamData.name).trim(),
            type: teamData.type,
            startPeriod: teamData.startPeriod !== undefined && teamData.startPeriod !== null
                ? String(teamData.startPeriod).trim()
                : '',
            endPeriod: teamData.endPeriod !== undefined && teamData.endPeriod !== null
                ? String(teamData.endPeriod).trim()
                : '',
            status: teamData.status || TeamConstants.DEFAULT_TEAM_STATUS,
            nameHistory: buildValidatedNameHistory(teamData.nameHistory) || [],
            members: [],
            rankingHistory: [],
            temporaryMission: teamData.temporaryMission !== undefined && teamData.temporaryMission !== null && teamData.temporaryMission !== ''
                ? String(teamData.temporaryMission).trim()
                : null,
            classId: teamData.classId !== undefined && teamData.classId !== null && teamData.classId !== ''
                ? String(teamData.classId).trim()
                : null,
            teamNumber: teamData.teamNumber !== undefined && teamData.teamNumber !== null
                ? String(teamData.teamNumber).trim()
                : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Build the candidate team that results from applying `updates`
     * to `existing`. Pure. Does not touch window.data.
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

        // ---- Periods ----
        if (updates.startPeriod !== undefined) {
            candidate.startPeriod = updates.startPeriod !== null
                ? String(updates.startPeriod).trim()
                : '';
        }
        if (updates.endPeriod !== undefined) {
            candidate.endPeriod = updates.endPeriod !== null
                ? String(updates.endPeriod).trim()
                : '';
        }

        // ---- Name history ----
        if (updates.nameHistory !== undefined) {
            var historyCheck = validateNameHistory(updates.nameHistory);
            if (!historyCheck.valid) {
                return historyCheck;
            }
            candidate.nameHistory = buildValidatedNameHistory(updates.nameHistory) || [];
        }

        // ---- Mission ----
        if (updates.temporaryMission !== undefined) {
            candidate.temporaryMission = updates.temporaryMission !== null && updates.temporaryMission !== ''
                ? String(updates.temporaryMission).trim()
                : null;
        }

        // ---- Class ----
        if (updates.classId !== undefined) {
            candidate.classId = updates.classId !== null && updates.classId !== ''
                ? String(updates.classId).trim()
                : null;
        }

        // ---- Team number ----
        if (updates.teamNumber !== undefined) {
            var numStr = updates.teamNumber !== null && updates.teamNumber !== ''
                ? String(updates.teamNumber).trim()
                : '';
            if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                return { valid: false, message: 'Team number contains invalid characters.' };
            }
            candidate.teamNumber = numStr;
        }

        // ---- Revalidate members and ranking history against the
        //      candidate's type. A type change can invalidate
        //      previously-valid entries. ----
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
        if (!checkDependencies()) {
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

        var nameHistory = buildValidatedNameHistory(teamData.nameHistory) || [];

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
                // ID collision check.
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
        if (!checkDependencies()) {
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

        // ---- Build candidate ----
        var buildResult = buildUpdatedTeam(current, updates);
        if (!buildResult.valid) {
            return Promise.resolve(failure(buildResult.message));
        }
        var candidate = buildResult.candidate;

        // ---- Validate candidate as a whole ----
        var completeCheck = validateCompleteTeam(candidate);
        if (!completeCheck.valid) {
            return Promise.resolve(failure(completeCheck.message));
        }

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                var currentInSnapshot = findTeamInData(snapshot, targetId);
                if (!currentInSnapshot) {
                    return { valid: false, message: 'Team no longer exists.' };
                }

                // Re-build the candidate against the snapshot, so a
                // mutation that ran between pre-flight and this
                // callback cannot produce an inconsistent result.
                var snapshotBuild = buildUpdatedTeam(currentInSnapshot, updates);
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

                // Apply the candidate field-by-field so that
                // unknown/preserved fields on the live record survive.
                // We only overwrite the fields the update touched.
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
            logMessage: 'Updated team: ' + candidate.name,
            successMessage: 'Team updated successfully!',
            failureMessage: 'Failed to update team.'
        });
    }

    function deleteTeam(id) {
        if (!checkDependencies()) {
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
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var member = buildValidatedMember(memberData);
        if (!member) {
            return Promise.resolve(failure('Invalid member data. Character ID is required.'));
        }

        if (!_characterProvider.exists(member.characterId)) {
            return Promise.resolve(failure('Character not found.'));
        }

        var targetId = String(teamId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Pre-flight: duplicate check and period validity.
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

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                if (!Array.isArray(target.members)) {
                    return { valid: false, message: 'Team members are malformed.' };
                }

                // Duplicate check against the snapshot.
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) === String(member.characterId)) {
                        return { valid: false, message: 'Character is already a member of this team.' };
                    }
                }

                var periodCheck = validateMemberPeriods(member, target.type);
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
                target.members.push(deepClone(member));
                target.updatedAt = new Date().toISOString();
                return { member: member, teamId: targetId };
            },
            logMessage: 'Added member to team: ' + (current.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        });
    }

    function removeMember(teamId, charId) {
        if (!checkDependencies()) {
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
        if (!checkDependencies()) {
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

        // ---- Build proposed member ----
        var proposed = {
            characterId: member.characterId,
            role: member.role !== undefined && member.role !== null
                ? String(member.role)
                : TeamConstants.DEFAULT_ROLE,
            joinPeriod: member.joinPeriod !== undefined && member.joinPeriod !== null
                ? String(member.joinPeriod)
                : '',
            leavePeriod: member.leavePeriod !== undefined && member.leavePeriod !== null
                ? String(member.leavePeriod)
                : ''
        };

        if (updates.role !== undefined) {
            proposed.role = updates.role !== null
                ? String(updates.role).trim()
                : TeamConstants.DEFAULT_ROLE;
        }
        if (updates.joinPeriod !== undefined) {
            proposed.joinPeriod = updates.joinPeriod !== null
                ? String(updates.joinPeriod).trim()
                : '';
        }
        if (updates.leavePeriod !== undefined) {
            proposed.leavePeriod = updates.leavePeriod !== null
                ? String(updates.leavePeriod).trim()
                : '';
        }

        // ---- Validate the proposed member against current team type ----
        var periodCheck = validateMemberPeriods(proposed, current.type);
        if (!periodCheck.valid) {
            return Promise.resolve(failure(periodCheck.message));
        }

        var roleCheck = validateMemberRole(proposed);
        if (!roleCheck.valid) {
            return Promise.resolve(failure(roleCheck.message));
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
        if (!checkDependencies()) {
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

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Canonical period string.
        var periodStr = String(periodNum);

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

                // Replace if an entry for this period exists, else push.
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

                // Sort by period ascending (numeric).
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
        if (!checkDependencies()) {
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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamCore;
        var missing = [];

        var required = [
            'configure',
            'createTeam', 'updateTeam', 'deleteTeam',
            'addMember', 'removeMember', 'updateMember',
            'addRanking', 'removeRanking',
            'stripCharacterRefs'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamCore] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
