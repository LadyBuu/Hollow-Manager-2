/**
 * modules/teams/team-core.js - Team Core
 * CANONICAL mutation API for teams
 *
 * This module provides:
 *   - Team CRUD operations (create, update, delete)
 *   - Member management (add, remove, update)
 *   - Ranking management (add, remove)
 *   - Team read access (getTeam, getTeamIndex)
 *
 * IMPORTANT:
 *   - This is the CANONICAL mutation API for teams
 *   - All team mutations go through MutationPipeline
 *   - Uses TeamConstants for type/status validation
 *   - Uses injected characterProvider for character existence
 *   - Pipeline owns persistence, activity logging, and rollback
 *   - Does NOT depend on TeamQueries (no circular dependency)
 *   - Internally organised by domain (CRUD, Members, Rankings)
 *
 * MUTATION CONTRACT:
 *   - All mutations return a Promise that resolves to
 *     { success: boolean, data?: any, message?: string }
 *   - Invalid inputs are REJECTED (resolve with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is
 *     restored from the pipeline's snapshot
 *   - Valid no-op updates resolve with { success: true, data: existing }
 *
 * DATA STORE CONTRACT:
 *   - window.data must exist and contain a teams array
 *   - If window.data or window.data.teams is missing, mutations
 *     resolve with { success: false }
 *   - window.saveData must be a function (MutationPipeline calls it)
 *
 * TEAM TYPES & STATUSES:
 *   - Types: academic, professional, temporary, civilian
 *   - Statuses: active, inactive, deprecated
 *   - 'deleted' is NOT stored - teams are physically removed
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Year-based team types (professional, temporary, civilian)
 *     accept any integer >= 1 as a valid period.
 *   - Academic teams still use bounded weeks (1-52).
 *
 * EXTERNAL DEPENDENCIES (INJECTED):
 *   - characterProvider: { exists: function(id) { return true/false } }
 *
 * DEPENDENCIES:
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
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
 *   var result = await TeamCore.createTeam({ name: 'Valiant', type: 'professional' });
 *   if (result.success) {
 *       var team = result.data;
 *   }
 *
 *   // Reads stay synchronous
 *   var team = TeamCore.getTeam(teamId);
 */

(function() {
    'use strict';

    if (window.__teamCoreLoaded) {
        return;
    }
    window.__teamCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TeamConstants = window.TeamConstants;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // CONSTANTS - From TeamConstants
    // ============================================================

    var DEFAULT_TEAM_TYPE = TeamConstants.DEFAULT_TEAM_TYPE;
    var DEFAULT_TEAM_STATUS = TeamConstants.DEFAULT_TEAM_STATUS;
    var DEFAULT_ROLE = TeamConstants.DEFAULT_ROLE;
    var LEGACY_TYPE_MAP = TeamConstants.LEGACY_TYPE_MAP;

    // ============================================================
    // INJECTED DEPENDENCIES
    // ============================================================

    var _characterProvider = null;

    /**
     * Configure TeamCore with external dependencies.
     * Must be called before any mutation operations.
     *
     * @param {object} deps - Dependency injection object
     * @param {object} deps.characterProvider - Character provider with exists() method
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
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
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
    // UTILITY HELPERS
    // ============================================================

    function isString(value) {
        return typeof value === 'string';
    }

    function isNonEmptyString(value) {
        return isString(value) && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    // DATA STORE ACCESS
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

    function getTeamIndex(id) {
        if (!id) {
            return -1;
        }
        var data = getDataStore();
        if (!data) {
            return -1;
        }
        var target = String(id);
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return i;
            }
        }
        return -1;
    }

    function getTeam(id) {
        var index = getTeamIndex(id);
        if (index === -1) {
            return null;
        }
        var data = getDataStore();
        return data.teams[index] || null;
    }

    // ============================================================
    // PERIOD HELPERS - Uses TeamConstants
    // ============================================================

    function parseNumericPeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        var parsed = Number(str);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    function parsePositivePeriod(value) {
        var parsed = parseNumericPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function isValidPeriodForType(period, type) {
        if (period === null || period === undefined || period === '') {
            return true;
        }
        return TeamConstants.isValidPeriod(period, type);
    }

    function isValidPeriodPair(startPeriod, endPeriod, type) {
        var start = parseNumericPeriod(startPeriod);
        var end = parseNumericPeriod(endPeriod);

        if (start !== null && end !== null && start > end) {
            return { valid: false, message: 'Start period cannot be after end period.' };
        }

        return { valid: true };
    }

    function parseRank(value) {
        var num = parsePositivePeriod(value);
        return (num !== null && num >= 1) ? num : null;
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
            if (!isObject(entry)) {
                continue;
            }
            var name = String(entry.name || '').trim();
            if (!name) {
                continue;
            }
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
            role: isNonEmptyString(memberData.role) ? String(memberData.role).trim() : DEFAULT_ROLE,
            joinPeriod: memberData.joinPeriod !== undefined && memberData.joinPeriod !== null
                ? String(memberData.joinPeriod).trim()
                : '',
            leavePeriod: memberData.leavePeriod !== undefined && memberData.leavePeriod !== null
                ? String(memberData.leavePeriod).trim()
                : ''
        };
    }

    function validateMemberPeriods(member, teamType) {
        var join = parseNumericPeriod(member.joinPeriod);
        var leave = parseNumericPeriod(member.leavePeriod);

        if (member.joinPeriod && member.joinPeriod !== '') {
            if (join === null) {
                return { valid: false, message: 'Invalid join period format.' };
            }
            if (!isValidPeriodForType(member.joinPeriod, teamType)) {
                return { valid: false, message: 'Join period is out of bounds for team type.' };
            }
        }

        if (member.leavePeriod && member.leavePeriod !== '') {
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period format.' };
            }
            if (!isValidPeriodForType(member.leavePeriod, teamType)) {
                return { valid: false, message: 'Leave period is out of bounds for team type.' };
            }
        }

        if (join !== null && leave !== null && join > leave) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }

        return { valid: true };
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    function validateRankingEntry(entry, teamType) {
        if (!entry || typeof entry !== 'object') {
            return { valid: false, message: 'Invalid ranking entry.' };
        }

        var period = parsePositivePeriod(entry.period);
        if (period === null) {
            return { valid: false, message: 'Invalid period format.' };
        }

        if (!isValidPeriodForType(entry.period, teamType)) {
            return { valid: false, message: 'Period is out of bounds for team type.' };
        }

        var rank = parseRank(entry.rank);
        if (rank === null || rank < 1) {
            return { valid: false, message: 'Invalid rank format.' };
        }

        return { valid: true, period: period, rank: rank };
    }

    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (entry && parseNumericPeriod(entry.period) !== null && parseRank(entry.rank) !== null) {
                history.push(entry);
            }
        }

        history.sort(function(a, b) {
            var aNum = parseNumericPeriod(a.period);
            var bNum = parseNumericPeriod(b.period);
            return aNum - bNum;
        });

        return history;
    }

    function updateCurrentRank(team) {
        if (!team) {
            return;
        }

        var history = getSortedRankings(team);
        team.currentRank = history.length > 0 ? String(history[history.length - 1].rank) : '';
    }

    // ============================================================
    // VALIDATION - Team Creation/Update
    // ============================================================

    function validateTeamData(teamData) {
        if (!isObject(teamData)) {
            return { valid: false, message: 'Team data must be an object.' };
        }

        if (!isNonEmptyString(teamData.name)) {
            return { valid: false, message: 'Team name is required.' };
        }

        var type = TeamConstants.normalizeTeamType(teamData.type);
        if (type === null) {
            return { valid: false, message: 'Invalid team type.' };
        }

        var status = teamData.status || DEFAULT_TEAM_STATUS;
        if (!TeamConstants.isValidTeamStatus(status)) {
            return { valid: false, message: 'Invalid team status.' };
        }

        var startPeriod = teamData.startPeriod !== undefined && teamData.startPeriod !== null
            ? String(teamData.startPeriod).trim()
            : '';
        var endPeriod = teamData.endPeriod !== undefined && teamData.endPeriod !== null
            ? String(teamData.endPeriod).trim()
            : '';

        if (startPeriod && !isValidPeriodForType(startPeriod, type)) {
            return { valid: false, message: 'Invalid start period for team type.' };
        }
        if (endPeriod && !isValidPeriodForType(endPeriod, type)) {
            return { valid: false, message: 'Invalid end period for team type.' };
        }

        var periodPair = isValidPeriodPair(startPeriod, endPeriod, type);
        if (!periodPair.valid) {
            return { valid: false, message: periodPair.message };
        }

        var classId = teamData.classId !== undefined && teamData.classId !== null && teamData.classId !== ''
            ? String(teamData.classId).trim()
            : null;

        var teamNumber = '';
        if (teamData.teamNumber !== undefined && teamData.teamNumber !== null) {
            var numStr = String(teamData.teamNumber).trim();
            if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                return { valid: false, message: 'Team number contains invalid characters.' };
            }
            teamNumber = numStr;
        }

        var temporaryMission = null;
        if (teamData.temporaryMission !== undefined && teamData.temporaryMission !== null && teamData.temporaryMission !== '') {
            temporaryMission = String(teamData.temporaryMission).trim();
        }

        if (teamData.nameHistory !== undefined) {
            var nameValidation = validateNameHistory(teamData.nameHistory);
            if (!nameValidation.valid) {
                return { valid: false, message: nameValidation.message };
            }
        }
        var nameHistory = buildValidatedNameHistory(teamData.nameHistory) || [];

        return {
            valid: true,
            data: {
                name: String(teamData.name).trim(),
                type: type,
                startPeriod: startPeriod,
                endPeriod: endPeriod,
                status: status,
                nameHistory: nameHistory,
                temporaryMission: temporaryMission,
                classId: classId,
                teamNumber: teamNumber
            }
        };
    }

    // ============================================================
    // CRUD OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Create a new team.
     *
     * @param {object} teamData - Team data
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function createTeam(teamData) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        var validation = validateTeamData(teamData);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var team = validation.data;
        var newTeam = {
            id: generateId(),
            name: team.name,
            type: team.type,
            startPeriod: team.startPeriod,
            endPeriod: team.endPeriod,
            currentRank: '',
            status: team.status,
            nameHistory: team.nameHistory,
            members: [],
            rankingHistory: [],
            temporaryMission: team.temporaryMission,
            classId: team.classId,
            teamNumber: team.teamNumber,
            createdAt: new Date().toISOString()
        };

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                data.teams.push(newTeam);
                return { team: newTeam, id: newTeam.id };
            },

            logMessage: 'Created team: ' + newTeam.name,
            successMessage: 'Team created successfully!',
            failureMessage: 'Failed to create team.'
        });
    }

    /**
     * Update an existing team.
     *
     * @param {string} id - Team ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
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

        var targetId = String(id).trim();

        // Pre-flight: verify team exists
        var existing = getTeam(targetId);
        if (!existing) {
            return Promise.resolve(failure('Team not found.'));
        }

        // Determine final type for validation
        var finalType = updates.type !== undefined
            ? TeamConstants.normalizeTeamType(updates.type) || existing.type
            : existing.type;

        var finalStartPeriod = updates.startPeriod !== undefined
            ? String(updates.startPeriod).trim()
            : existing.startPeriod || '';

        var finalEndPeriod = updates.endPeriod !== undefined
            ? String(updates.endPeriod).trim()
            : existing.endPeriod || '';

        var periodPair = isValidPeriodPair(finalStartPeriod, finalEndPeriod, finalType);
        if (!periodPair.valid) {
            return Promise.resolve(failure(periodPair.message));
        }

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                var idx = -1;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var team = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        team = data.teams[i];
                        break;
                    }
                }
                if (!team) {
                    throw new Error('Team not found in data store.');
                }

                var updateableProps = ['name', 'type', 'startPeriod', 'endPeriod', 'status', 'classId', 'teamNumber', 'temporaryMission', 'nameHistory'];

                for (var j = 0; j < updateableProps.length; j++) {
                    var key = updateableProps[j];
                    if (updates[key] === undefined) {
                        continue;
                    }

                    if (key === 'type') {
                        var normalizedType = TeamConstants.normalizeTeamType(updates[key]);
                        if (normalizedType !== null) {
                            team[key] = normalizedType;
                        }
                        continue;
                    }

                    if (key === 'status') {
                        team[key] = updates[key] || DEFAULT_TEAM_STATUS;
                        continue;
                    }

                    if (key === 'nameHistory') {
                        var sanitized = buildValidatedNameHistory(updates[key]);
                        if (sanitized !== null) {
                            team[key] = sanitized;
                        }
                        continue;
                    }

                    if (key === 'classId') {
                        team[key] = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                            ? String(updates[key]).trim()
                            : null;
                        continue;
                    }

                    if (key === 'temporaryMission') {
                        team[key] = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                            ? String(updates[key]).trim()
                            : null;
                        continue;
                    }

                    if (key === 'teamNumber') {
                        var numStr = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                            ? String(updates[key]).trim()
                            : '';
                        if (!numStr || /^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                            team[key] = numStr;
                        }
                        continue;
                    }

                    if (typeof updates[key] === 'string') {
                        team[key] = updates[key].trim();
                    } else {
                        team[key] = updates[key];
                    }
                }

                // Ranking history update is not part of updateTeam's
                // public contract — use addRanking/removeRanking for that.

                return { team: team, id: targetId };
            },

            logMessage: 'Updated team: ' + (existing.name || targetId),
            successMessage: 'Team updated successfully!',
            failureMessage: 'Failed to update team.'
        });
    }

    /**
     * Delete a team permanently.
     *
     * @param {string} id - Team ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function deleteTeam(id) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var targetId = String(id).trim();
        var existing = getTeam(targetId);
        if (!existing) {
            return Promise.resolve(failure('Team not found.'));
        }

        var teamName = existing.name || 'Unknown Team';

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var idx = -1;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Team not found in data store.');
                }
                data.teams.splice(idx, 1);
                return { id: targetId };
            },

            logMessage: 'Deleted team: ' + teamName,
            successMessage: 'Team deleted successfully!',
            failureMessage: 'Failed to delete team.'
        });
    }

    // ============================================================
    // MEMBER OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Add a member to a team.
     *
     * @param {string} teamId - Team ID
     * @param {object} memberData - { characterId, role, joinPeriod, leavePeriod }
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addMember(teamId, memberData) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var member = buildValidatedMember(memberData);
        if (!member) {
            return Promise.resolve(failure('Invalid member data. Character ID is required.'));
        }

        if (!_characterProvider.exists(member.characterId)) {
            return Promise.resolve(failure('Character not found.'));
        }

        var periodValidation = validateMemberPeriods(member, team.type);
        if (!periodValidation.valid) {
            return Promise.resolve(failure(periodValidation.message));
        }

        // Duplicate check (pre-flight)
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === String(member.characterId)) {
                return Promise.resolve(failure('Character is already a member of this team.'));
            }
        }

        var targetId = String(teamId).trim();
        var newMember = {
            characterId: member.characterId,
            role: member.role,
            joinPeriod: member.joinPeriod,
            leavePeriod: member.leavePeriod
        };

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam) {
                    return { valid: false, message: 'Team no longer exists.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam) {
                    throw new Error('Team not found in data store.');
                }
                if (!Array.isArray(currentTeam.members)) {
                    currentTeam.members = [];
                }
                currentTeam.members.push(newMember);
                return { member: newMember, teamId: targetId };
            },

            logMessage: 'Added member to team: ' + (team.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        });
    }

    /**
     * Remove a member from a team.
     *
     * @param {string} teamId - Team ID
     * @param {string} charId - Character ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeMember(teamId, charId) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var targetChar = String(charId);
        var found = false;
        for (var i = 0; i < team.members.length; i++) {
            if (team.members[i] && String(team.members[i].characterId) === targetChar) {
                found = true;
                break;
            }
        }
        if (!found) {
            return Promise.resolve(failure('Character is not a member of this team.'));
        }

        var targetId = String(teamId).trim();

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam || !Array.isArray(currentTeam.members)) {
                    throw new Error('Team not found in data store.');
                }
                currentTeam.members = currentTeam.members.filter(function(m) {
                    return !m || String(m.characterId) !== targetChar;
                });
                return { characterId: targetChar, teamId: targetId };
            },

            logMessage: 'Removed member from team: ' + (team.name || targetId),
            successMessage: 'Member removed successfully!',
            failureMessage: 'Failed to remove member.'
        });
    }

    /**
     * Update a member's details.
     *
     * @param {string} teamId - Team ID
     * @param {string} charId - Character ID
     * @param {object} updates - { role, joinPeriod, leavePeriod }
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function updateMember(teamId, charId, updates) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        if (!isObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        var targetChar = String(charId);
        var member = null;
        for (var i = 0; i < team.members.length; i++) {
            if (team.members[i] && String(team.members[i].characterId) === targetChar) {
                member = team.members[i];
                break;
            }
        }

        if (!member) {
            return Promise.resolve(failure('Character is not a member of this team.'));
        }

        var proposedMember = {
            characterId: member.characterId,
            role: member.role || DEFAULT_ROLE,
            joinPeriod: member.joinPeriod || '',
            leavePeriod: member.leavePeriod || ''
        };

        if (updates.role !== undefined) {
            proposedMember.role = typeof updates.role === 'string' ? updates.role.trim() : DEFAULT_ROLE;
        }
        if (updates.joinPeriod !== undefined) {
            proposedMember.joinPeriod = updates.joinPeriod !== null ? String(updates.joinPeriod).trim() : '';
        }
        if (updates.leavePeriod !== undefined) {
            proposedMember.leavePeriod = updates.leavePeriod !== null ? String(updates.leavePeriod).trim() : '';
        }

        var periodValidation = validateMemberPeriods(proposedMember, team.type);
        if (!periodValidation.valid) {
            return Promise.resolve(failure(periodValidation.message));
        }

        var targetId = String(teamId).trim();

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam || !Array.isArray(currentTeam.members)) {
                    throw new Error('Team not found in data store.');
                }

                var target = null;
                for (var j = 0; j < currentTeam.members.length; j++) {
                    if (currentTeam.members[j] && String(currentTeam.members[j].characterId) === targetChar) {
                        target = currentTeam.members[j];
                        break;
                    }
                }

                if (!target) {
                    throw new Error('Member not found in data store.');
                }

                if (updates.role !== undefined) {
                    target.role = proposedMember.role;
                }
                if (updates.joinPeriod !== undefined) {
                    target.joinPeriod = proposedMember.joinPeriod;
                }
                if (updates.leavePeriod !== undefined) {
                    target.leavePeriod = proposedMember.leavePeriod;
                }

                return { member: target, teamId: targetId };
            },

            logMessage: 'Updated member on team: ' + (team.name || targetId),
            successMessage: 'Member updated successfully!',
            failureMessage: 'Failed to update member.'
        });
    }

    // ============================================================
    // RANKING OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Add a ranking entry to a team.
     *
     * @param {string} teamId - Team ID
     * @param {string|number} period - Period (week or year)
     * @param {string|number} rank - Rank number (must be positive integer)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addRanking(teamId, period, rank) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!period || String(period).trim() === '') {
            return Promise.resolve(failure('Period is required.'));
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.rankingHistory)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var periodStr = String(period).trim();
        var rankNum = parseRank(rank);
        if (rankNum === null) {
            return Promise.resolve(failure('Rank must be a positive integer.'));
        }

        var rankValidation = validateRankingEntry({ period: periodStr, rank: rankNum }, team.type);
        if (!rankValidation.valid) {
            return Promise.resolve(failure(rankValidation.message));
        }

        var targetId = String(teamId).trim();

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam) {
                    throw new Error('Team not found in data store.');
                }
                if (!Array.isArray(currentTeam.rankingHistory)) {
                    currentTeam.rankingHistory = [];
                }

                var existingIndex = -1;
                for (var j = 0; j < currentTeam.rankingHistory.length; j++) {
                    var entry = currentTeam.rankingHistory[j];
                    if (entry && String(entry.period) === periodStr) {
                        existingIndex = j;
                        break;
                    }
                }

                if (existingIndex !== -1) {
                    currentTeam.rankingHistory[existingIndex] = { period: periodStr, rank: rankNum };
                } else {
                    currentTeam.rankingHistory.push({ period: periodStr, rank: rankNum });
                }

                updateCurrentRank(currentTeam);

                return { period: periodStr, rank: rankNum, teamId: targetId };
            },

            logMessage: 'Added ranking to team: ' + (team.name || targetId),
            successMessage: 'Ranking added successfully!',
            failureMessage: 'Failed to add ranking.'
        });
    }

    /**
     * Remove a ranking entry by period.
     *
     * @param {string} teamId - Team ID
     * @param {string|number} period - Period to remove
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeRanking(teamId, period) {
        if (!checkDependencies()) {
            return Promise.resolve(failure('Dependencies not loaded. Please refresh the page.'));
        }

        if (!period || String(period).trim() === '') {
            return Promise.resolve(failure('Period is required.'));
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.rankingHistory)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var periodStr = String(period).trim();
        var targetId = String(teamId).trim();

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.teams)) {
                    return { valid: false, message: 'Team data store is not available.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentTeam = null;
                for (var i = 0; i < data.teams.length; i++) {
                    if (data.teams[i] && String(data.teams[i].id) === targetId) {
                        currentTeam = data.teams[i];
                        break;
                    }
                }
                if (!currentTeam || !Array.isArray(currentTeam.rankingHistory)) {
                    throw new Error('Team not found in data store.');
                }

                var found = false;
                currentTeam.rankingHistory = currentTeam.rankingHistory.filter(function(entry) {
                    if (entry && String(entry.period) === periodStr) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Ranking entry not found.');
                }

                updateCurrentRank(currentTeam);

                return { period: periodStr, teamId: targetId };
            },

            logMessage: 'Removed ranking from team: ' + (team.name || targetId),
            successMessage: 'Ranking removed successfully!',
            failureMessage: 'Failed to remove ranking.'
        });
    }

    /**
     * Get sorted ranking history for a team.
     *
     * @param {object} team - Team object
     * @returns {array} Sorted ranking history
     */
    function getSortedRankingsPublic(team) {
        return getSortedRankings(team);
    }

    /**
     * Get the current rank for a team.
     *
     * @param {object} team - Team object
     * @returns {string} Current rank (empty string if none)
     */
    function getCurrentRank(team) {
        if (!team) {
            return '';
        }
        var history = getSortedRankings(team);
        return history.length > 0 ? String(history[history.length - 1].rank) : '';
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

        // Team reads (LIVE REFERENCES — do not mutate directly)
        getTeam: getTeam,
        getTeamIndex: getTeamIndex,

        // Members
        addMember: addMember,
        removeMember: removeMember,
        updateMember: updateMember,

        // Rankings
        addRanking: addRanking,
        removeRanking: removeRanking,
        getSortedRankings: getSortedRankingsPublic,
        getCurrentRank: getCurrentRank,

        // Utilities (exposed for testing)
        parseNumericPeriod: parseNumericPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseRank: parseRank,
        isValidPeriodForType: isValidPeriodForType
    };

})();