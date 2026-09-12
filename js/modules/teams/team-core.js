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
 *   - All team mutations should go through this module
 *   - Uses TeamConstants for type/status validation
 *   - Uses injected characterProvider for character existence
 *   - Does NOT call saveData() - caller owns persistence
 *   - Does NOT depend on TeamQueries (no circular dependency)
 *   - Internally organized by domain (CRUD, Members, Rankings)
 * 
 * MUTATION PHILOSOPHY:
 *   - Mutations modify window.data and return the result
 *   - Caller is responsible for persistence (saveData)
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Validation completes BEFORE any mutation is applied, so
 *     structurally-invalid inputs never reach the mutation stage
 *   - Mutations are NOT transactional: if a mutation applies
 *     multiple changes and one fails, earlier changes remain.
 *     For atomic semantics, use MutationPipeline.
 *   - Valid no-op updates return the existing object (idempotent)
 * 
 * DATA STORE CONTRACT:
 *   - window.data must exist and contain teams array
 *   - If window.data or window.data.teams is missing, operations return null
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
 * 
 * USAGE:
 *   // Initialize with character provider
 *   TeamCore.configure({
 *       characterProvider: {
 *           exists: function(id) {
 *               return CharacterQueries.getCharacterById(id) !== null;
 *           }
 *       }
 *   });
 * 
 *   // Create team
 *   var team = TeamCore.createTeam({ name: 'Valiant', type: 'professional' });
 * 
 *   // Add member
 *   var member = TeamCore.addMember(teamId, { characterId: 'char_123' });
 * 
 *   // Read team (live reference — do not mutate)
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
    // CRUD OPERATIONS
    // ============================================================

    /**
     * Create a new team.
     * 
     * @param {object} teamData - Team data
     * @returns {object|null} Created team or null if invalid
     */
    function createTeam(teamData) {
        if (!checkDependencies()) {
            return null;
        }

        var validation = validateTeamData(teamData);
        if (!validation.valid) {
            return null;
        }

        var data = getDataStore();
        if (!data) {
            return null;
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

        data.teams.push(newTeam);

        return newTeam;
    }

    /**
     * Update an existing team.
     * 
     * NOTE: This mutates the team object in place. There is no
     * snapshot or rollback. Validation completes before any mutation
     * is applied, so structurally-invalid inputs never partially
     * apply. For atomic multi-step semantics, use MutationPipeline.
     * 
     * @param {string} id - Team ID
     * @param {object} updates - Updates to apply
     * @returns {object|null} Updated team or null if invalid
     */
    function updateTeam(id, updates) {
        if (!checkDependencies()) {
            return null;
        }

        var index = getTeamIndex(id);
        if (index === -1) {
            return null;
        }

        var data = getDataStore();
        if (!data) {
            return null;
        }

        var team = data.teams[index];
        if (!team) {
            return null;
        }

        // Determine final type for validation
        var finalType = updates.type !== undefined
            ? TeamConstants.normalizeTeamType(updates.type) || team.type
            : team.type;

        var finalStartPeriod = updates.startPeriod !== undefined
            ? String(updates.startPeriod).trim()
            : team.startPeriod || '';

        var finalEndPeriod = updates.endPeriod !== undefined
            ? String(updates.endPeriod).trim()
            : team.endPeriod || '';

        // Validate period pair
        var periodPair = isValidPeriodPair(finalStartPeriod, finalEndPeriod, finalType);
        if (!periodPair.valid) {
            return null;
        }

        // Apply updates
        var hasChanges = false;

        var updateableProps = ['name', 'type', 'startPeriod', 'endPeriod', 'status', 'classId', 'teamNumber', 'temporaryMission', 'nameHistory'];

        for (var i = 0; i < updateableProps.length; i++) {
            var key = updateableProps[i];
            if (updates[key] === undefined) {
                continue;
            }

            if (key === 'type') {
                var normalizedType = TeamConstants.normalizeTeamType(updates[key]);
                if (normalizedType !== null && team[key] !== normalizedType) {
                    team[key] = normalizedType;
                    hasChanges = true;
                }
                continue;
            }

            if (key === 'status') {
                var statusValue = updates[key] || DEFAULT_TEAM_STATUS;
                if (team[key] !== statusValue) {
                    team[key] = statusValue;
                    hasChanges = true;
                }
                continue;
            }

            if (key === 'nameHistory') {
                var sanitized = buildValidatedNameHistory(updates[key]);
                if (sanitized !== null && JSON.stringify(team[key]) !== JSON.stringify(sanitized)) {
                    team[key] = sanitized;
                    hasChanges = true;
                }
                continue;
            }

            if (key === 'classId') {
                var classIdValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                    ? String(updates[key]).trim()
                    : null;
                if (team[key] !== classIdValue) {
                    team[key] = classIdValue;
                    hasChanges = true;
                }
                continue;
            }

            if (key === 'temporaryMission') {
                var missionValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                    ? String(updates[key]).trim()
                    : null;
                if (team[key] !== missionValue) {
                    team[key] = missionValue;
                    hasChanges = true;
                }
                continue;
            }

            if (key === 'teamNumber') {
                var numStr = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                    ? String(updates[key]).trim()
                    : '';
                if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                    continue;
                }
                if (team[key] !== numStr) {
                    team[key] = numStr;
                    hasChanges = true;
                }
                continue;
            }

            if (typeof updates[key] === 'string') {
                var trimmed = updates[key].trim();
                if (team[key] !== trimmed) {
                    team[key] = trimmed;
                    hasChanges = true;
                }
            } else if (team[key] !== updates[key]) {
                team[key] = updates[key];
                hasChanges = true;
            }
        }

        // Update current rank cache if rankings changed
        if (updates.rankingHistory !== undefined) {
            var rankValidation = validateRankingEntry(updates.rankingHistory, team.type);
            if (rankValidation.valid) {
                team.rankingHistory = updates.rankingHistory;
                updateCurrentRank(team);
                hasChanges = true;
            }
        }

        return team;
    }

    /**
     * Delete a team permanently.
     * 
     * @param {string} id - Team ID
     * @returns {boolean} Success
     */
    function deleteTeam(id) {
        if (!checkDependencies()) {
            return false;
        }

        var index = getTeamIndex(id);
        if (index === -1) {
            return false;
        }

        var data = getDataStore();
        if (!data) {
            return false;
        }

        data.teams.splice(index, 1);
        return true;
    }

    // ============================================================
    // MEMBER OPERATIONS
    // ============================================================

    /**
     * Add a member to a team.
     * 
     * @param {string} teamId - Team ID
     * @param {object} memberData - { characterId, role, joinPeriod, leavePeriod }
     * @returns {object|null} Added member or null
     */
    function addMember(teamId, memberData) {
        if (!checkDependencies()) {
            return null;
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return null;
        }

        var member = buildValidatedMember(memberData);
        if (!member) {
            return null;
        }

        // Validate character exists via injected provider.
        // _characterProvider is guaranteed non-null by checkDependencies().
        if (!_characterProvider.exists(member.characterId)) {
            return null;
        }

        // Validate member periods against team type
        var periodValidation = validateMemberPeriods(member, team.type);
        if (!periodValidation.valid) {
            return null;
        }

        // Check for duplicate
        for (var i = 0; i < team.members.length; i++) {
            var existingMember = team.members[i];
            if (existingMember && String(existingMember.characterId) === String(member.characterId)) {
                return null;
            }
        }

        var newMember = {
            characterId: member.characterId,
            role: member.role,
            joinPeriod: member.joinPeriod,
            leavePeriod: member.leavePeriod
        };

        team.members.push(newMember);
        return newMember;
    }

    /**
     * Remove a member from a team.
     * 
     * @param {string} teamId - Team ID
     * @param {string} charId - Character ID
     * @returns {boolean} Success
     */
    function removeMember(teamId, charId) {
        if (!checkDependencies()) {
            return false;
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return false;
        }

        var target = String(charId);
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === target) {
                team.members.splice(i, 1);
                return true;
            }
        }

        return false;
    }

    /**
     * Update a member's details.
     * 
     * @param {string} teamId - Team ID
     * @param {string} charId - Character ID
     * @param {object} updates - { role, joinPeriod, leavePeriod }
     * @returns {object|null} Updated member or null
     */
    function updateMember(teamId, charId, updates) {
        if (!checkDependencies()) {
            return null;
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.members)) {
            return null;
        }

        var target = String(charId);
        var member = null;
        var memberIndex = -1;

        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === target) {
                member = m;
                memberIndex = i;
                break;
            }
        }

        if (!member || memberIndex === -1) {
            return null;
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

        // Validate periods
        var periodValidation = validateMemberPeriods(proposedMember, team.type);
        if (!periodValidation.valid) {
            return null;
        }

        // Apply changes
        var changed = false;
        var allowedProps = ['role', 'joinPeriod', 'leavePeriod'];

        for (var j = 0; j < allowedProps.length; j++) {
            var key = allowedProps[j];
            if (member[key] !== proposedMember[key]) {
                member[key] = proposedMember[key];
                changed = true;
            }
        }

        return member;
    }

    // ============================================================
    // RANKING OPERATIONS
    // ============================================================

    /**
     * Add a ranking entry to a team.
     * 
     * @param {string} teamId - Team ID
     * @param {string|number} period - Period (week or year)
     * @param {string|number} rank - Rank number (must be positive integer)
     * @returns {boolean} Success
     */
    function addRanking(teamId, period, rank) {
        if (!checkDependencies()) {
            return false;
        }

        if (!period || String(period).trim() === '') {
            return false;
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.rankingHistory)) {
            return false;
        }

        var periodStr = String(period).trim();
        var rankNum = parseRank(rank);
        if (rankNum === null) {
            return false;
        }

        var rankValidation = validateRankingEntry({ period: periodStr, rank: rankNum }, team.type);
        if (!rankValidation.valid) {
            return false;
        }

        // Check for existing entry
        var existingIndex = -1;
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (entry && String(entry.period) === periodStr) {
                existingIndex = i;
                break;
            }
        }

        if (existingIndex !== -1) {
            team.rankingHistory[existingIndex] = { period: periodStr, rank: rankNum };
        } else {
            team.rankingHistory.push({ period: periodStr, rank: rankNum });
        }

        updateCurrentRank(team);
        return true;
    }

    /**
     * Remove a ranking entry by period.
     * 
     * @param {string} teamId - Team ID
     * @param {string|number} period - Period to remove
     * @returns {boolean} Success
     */
    function removeRanking(teamId, period) {
        if (!checkDependencies()) {
            return false;
        }

        if (!period || String(period).trim() === '') {
            return false;
        }

        var team = getTeam(teamId);
        if (!team || !Array.isArray(team.rankingHistory)) {
            return false;
        }

        var periodStr = String(period).trim();

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (entry && String(entry.period) === periodStr) {
                team.rankingHistory.splice(i, 1);
                updateCurrentRank(team);
                return true;
            }
        }

        return false;
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
        // These are provided for read-only consumption by events/rendering.
        // All mutations must go through createTeam/updateTeam/deleteTeam.
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