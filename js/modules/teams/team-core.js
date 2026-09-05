/**
 * js/modules/teams/team-core.js - Core Team Operations
 * Handles CRUD operations for teams with clean persistence boundaries
 * Path: js/modules/teams/team-core.js
 * 
 * IMPORTANT: This module is the CANONICAL mutation API for teams.
 * All team mutations should go through this module.
 * 
 * MUTATION PHILOSOPHY:
 *   - TeamCore provides CRUD operations for teams
 *   - Mutations modify window.data and return the result
 *   - Caller is responsible for persistence (saveData)
 *   - This keeps the module testable and the persistence contract explicit
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Malformed existing data is NOT silently repaired during updates
 *   - Legacy data migration should happen via explicit repair functions
 *   - Missing data (null/undefined) is treated as malformed, not repaired
 *   - Valid no-op updates return the existing object (idempotent)
 * 
 * DATA STORE CONTRACT:
 *   - window.data must exist and contain teams array before any mutation
 *   - If window.data or window.data.teams is missing/undefined, operations return null
 *   - This module does NOT create missing data structures
 * 
 * TEAM STATUSES:
 *   - 'active': Currently active team
 *   - 'inactive': Temporarily inactive team
 *   - 'deprecated': Legacy team, no longer in use
 *   - 'deleted': Permanently removed (NOT stored in data; teams are physically removed)
 * 
 * TEAM TYPES:
 *   - 'academic': Academic/educational teams (weeks 1-52)
 *   - 'professional': Professional/working teams (years 1900-2100)
 *   - 'temporary': Temporary or project-based teams (years 1900-2100)
 *   - 'civilian': Civilian/non-combatant teams
 *   - 'internship' is a LEGACY persisted value, explicitly migrated to 'professional'
 * 
 * MEMBERSHIP SEMANTICS:
 *   - joinPeriod: The period (week/year) when the member joined
 *   - leavePeriod: The period (week/year) when the member left
 *   - Membership is INCLUSIVE: join <= period <= leave means active
 *   - For academic teams, period is a week number (1-52)
 *   - For other teams, period is a year (1900-2100)
 *   - Invalid or out-of-range periods are REJECTED
 *   - startPeriod <= endPeriod is enforced
 *   - Missing period (empty string) means "from the beginning" or "ongoing"
 *   - Malformed period (non-numeric) is REJECTED
 * 
 * RANKING SEMANTICS:
 *   - currentRank is a MATERIALISED CACHE derived from rankingHistory
 *   - It must never be treated as authoritative
 *   - rankingHistory is the AUTHORITATIVE source of truth
 *   - rankingHistory stores period + rank pairs
 *   - Ranking periods are validated against team type
 *   - One ranking per period (canonical numeric comparison)
 *   - Duplicate periods in rankingHistory are considered malformed
 * 
 * DATA INTEGRITY:
 *   - All updates are validated before mutation
 *   - Invalid values are rejected, not silently transformed
 *   - Malformed data is rejected to prevent corruption propagation
 *   - Mutations are atomic: all or nothing
 *   - Legacy migration exceptions are explicitly documented
 *   - Existing malformed data is preserved and excluded from calculations
 *   - Missing data structures (window.data) cause operations to fail
 * 
 * DEPENDENCIES:
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.ValidationUtils (from validation-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CALENDAR_CONSTANTS) {
        console.warn('TeamCore: CALENDAR_CONSTANTS not available.');
        return;
    }
    if (!window.CharacterQueries) {
        console.warn('TeamCore: CharacterQueries not available.');
        return;
    }
    if (!window.ActivityLog) {
        console.warn('TeamCore: ActivityLog not available.');
        return;
    }
    if (!window.ObjectUtils) {
        console.warn('TeamCore: ObjectUtils not available.');
        return;
    }
    if (!window.IdUtils) {
        console.warn('TeamCore: IdUtils not available.');
        return;
    }
    if (!window.ValidationUtils) {
        console.warn('TeamCore: ValidationUtils not available.');
        return;
    }

    window.__teamCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS;
    var CharacterQueries = window.CharacterQueries;
    var ActivityLog = window.ActivityLog;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;
    var DEFAULT_YEAR = CALENDAR.DEFAULT_YEAR ? CALENDAR.DEFAULT_YEAR() : MIN_YEAR;

    var VALID_TEAM_TYPES = ['academic', 'professional', 'temporary', 'civilian'];
    var VALID_TEAM_STATUSES = ['active', 'inactive', 'deprecated'];
    var UPDATEABLE_PROPERTIES = [
        'name',
        'type',
        'startPeriod',
        'endPeriod',
        'status',
        'nameHistory',
        'temporaryMission',
        'classId',
        'teamNumber'
    ];
    // currentRank is DERIVED, not updateable directly

    // ============================================================
    // UTILITY HELPERS - Delegate to shared utilities
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

    // ============================================================
    // PERIOD PARSING - Delegate to ValidationUtils
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

    function isValidAcademicWeek(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYear(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    function isValidPeriodForType(value, type) {
        if (value === null || value === undefined || value === '') {
            return true;
        }
        var str = String(value).trim();
        if (str === '') {
            return true;
        }
        if (type === 'academic') {
            return isValidAcademicWeek(str);
        }
        return isValidYear(str);
    }

    function isValidPeriodPair(startPeriod, endPeriod) {
        var start = parseNumericPeriod(startPeriod);
        var end = parseNumericPeriod(endPeriod);

        if (start !== null && end !== null && start > end) {
            return { valid: false, message: 'Start period cannot be after end period.' };
        }

        return { valid: true };
    }

    function parseRank(value) {
        var num = parseNumericPeriod(value);
        return (num !== null && num >= 1) ? num : null;
    }

    // ============================================================
    // ACTIVITY LOGGING - Delegate to ActivityLog
    // ============================================================

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (err) {
            // Activity logging failure should not abort the mutation
        }
    }

    // ============================================================
    // CHARACTER HELPERS - Delegate to CharacterQueries
    // ============================================================

    function getCharacterName(charId) {
        var character = CharacterQueries.getCharacterById(charId);
        return character ? CharacterQueries.getDisplayName(character) : 'character';
    }

    // ============================================================
    // TEAM TYPE NORMALISATION - Canonical
    // ============================================================

    /**
     * Normalise a team type to its canonical form.
     * 'internship' is a legacy persisted value and is explicitly migrated
     * to the canonical 'professional' type.
     * Returns null for invalid types.
     * NOTE: This does NOT mutate the stored data.
     */
    function normalizeTeamType(type) {
        if (!type) {
            return null;
        }
        var normalized = String(type).toLowerCase().trim();
        if (normalized === 'internship') {
            return 'professional';
        }
        if (VALID_TEAM_TYPES.indexOf(normalized) !== -1) {
            return normalized;
        }
        return null;
    }

    /**
     * Check if a team type is valid.
     * 'internship' is accepted as a legacy value.
     */
    function isValidTeamType(type) {
        if (!type) {
            return false;
        }
        var normalized = String(type).toLowerCase().trim();
        if (normalized === 'internship') {
            return true;
        }
        return VALID_TEAM_TYPES.indexOf(normalized) !== -1;
    }

    /**
     * Check if a team status is valid.
     */
    function isValidTeamStatus(status) {
        return status && VALID_TEAM_STATUSES.indexOf(status) !== -1;
    }

    // ============================================================
    // DATA STORE ACCESS - Pure, no repair
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

    // ============================================================
    // TEAM LOOKUP HELPERS
    // ============================================================

    function getTeamData(id) {
        if (!id) {
            return null;
        }
        var data = getDataStore();
        if (!data) {
            return null;
        }
        var teams = data.teams;
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === String(id)) {
                return team;
            }
        }
        return null;
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateTeamId() {
        return IdUtils.generateId('team');
    }

    // ============================================================
    // VALIDATION - Name History
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
    // VALIDATION - Members
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
            role: isNonEmptyString(memberData.role) ? String(memberData.role).trim() : 'Member',
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
            if (teamType === 'academic' && (join < MIN_WEEK || join > MAX_WEEK)) {
                return { valid: false, message: 'Join period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams.' };
            }
            if (teamType !== 'academic' && !isValidYear(member.joinPeriod)) {
                return { valid: false, message: 'Join period must be a valid year (' + MIN_YEAR + '-' + MAX_YEAR + ').' };
            }
        }

        if (member.leavePeriod && member.leavePeriod !== '') {
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period format.' };
            }
            if (teamType === 'academic' && (leave < MIN_WEEK || leave > MAX_WEEK)) {
                return { valid: false, message: 'Leave period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams.' };
            }
            if (teamType !== 'academic' && !isValidYear(member.leavePeriod)) {
                return { valid: false, message: 'Leave period must be a valid year (' + MIN_YEAR + '-' + MAX_YEAR + ').' };
            }
        }

        if (join !== null && leave !== null && join > leave) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }

        return { valid: true };
    }

    // ============================================================
    // VALIDATION - Rankings
    // ============================================================

    function validateRankingHistory(history, teamType) {
        if (!Array.isArray(history)) {
            return { valid: false, message: 'Ranking history must be an array.' };
        }

        var seenPeriods = {};

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry || typeof entry !== 'object') {
                return {
                    valid: false,
                    message: 'Invalid ranking entry at index ' + i + '.'
                };
            }

            var period = parseNumericPeriod(entry.period);
            if (period === null) {
                return {
                    valid: false,
                    message: 'Invalid period format at index ' + i + '.'
                };
            }

            // Validate period against team type
            if (teamType === 'academic') {
                if (period < MIN_WEEK || period > MAX_WEEK) {
                    return {
                        valid: false,
                        message: 'Period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams at index ' + i + '.'
                    };
                }
            } else {
                if (period < MIN_YEAR || period > MAX_YEAR) {
                    return {
                        valid: false,
                        message: 'Period must be between ' + MIN_YEAR + ' and ' + MAX_YEAR + ' for non-academic teams at index ' + i + '.'
                    };
                }
            }

            var rank = parseRank(entry.rank);
            if (rank === null) {
                return {
                    valid: false,
                    message: 'Invalid rank format at index ' + i + '.'
                };
            }

            if (seenPeriods[period]) {
                return {
                    valid: false,
                    message: 'Duplicate period "' + period + '" found in ranking history.'
                };
            }
            seenPeriods[period] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // UPDATE CURRENT RANK CACHE
    // ============================================================

    function updateCurrentRank(team) {
        if (!team) {
            return;
        }

        if (!team.rankingHistory || team.rankingHistory.length === 0) {
            team.currentRank = '';
            return;
        }

        // Get sorted history using internal function
        var sorted = getSortedRankings(team);
        team.currentRank = sorted.length > 0 ? String(sorted[sorted.length - 1].rank) : '';
    }

    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = team.rankingHistory.slice().filter(function(entry) {
            return entry && parseNumericPeriod(entry.period) !== null && parseRank(entry.rank) !== null;
        });

        return history.sort(function(a, b) {
            var aNum = parseNumericPeriod(a.period);
            var bNum = parseNumericPeriod(b.period);
            return aNum - bNum;
        });
    }

    // ============================================================
    // VALIDATION - Team Updates
    // ============================================================

    function validateTeamUpdate(updates, team) {
        var errors = [];

        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                errors.push('Team name is required.');
            }
        }

        if (updates.type !== undefined) {
            var type = normalizeTeamType(updates.type);
            if (type === null) {
                errors.push('Invalid team type.');
            }
        }

        if (updates.status !== undefined) {
            if (!isValidTeamStatus(updates.status)) {
                errors.push('Invalid team status.');
            }
        }

        var type = updates.type !== undefined
            ? normalizeTeamType(updates.type) || (team ? team.type : 'academic')
            : (team ? team.type : 'academic');

        var startPeriod = updates.startPeriod !== undefined
            ? String(updates.startPeriod).trim()
            : (team ? team.startPeriod : '');

        var endPeriod = updates.endPeriod !== undefined
            ? String(updates.endPeriod).trim()
            : (team ? team.endPeriod : '');

        if (startPeriod && !isValidPeriodForType(startPeriod, type)) {
            errors.push('Invalid start period for team type.');
        }
        if (endPeriod && !isValidPeriodForType(endPeriod, type)) {
            errors.push('Invalid end period for team type.');
        }

        var periodPair = isValidPeriodPair(startPeriod, endPeriod);
        if (!periodPair.valid) {
            errors.push(periodPair.message);
        }

        if (updates.classId !== undefined) {
            if (updates.classId !== null && updates.classId !== '' && typeof updates.classId !== 'string') {
                errors.push('Class ID must be a string or null.');
            }
        }

        if (updates.teamNumber !== undefined) {
            if (updates.teamNumber !== null && updates.teamNumber !== '' && typeof updates.teamNumber !== 'string') {
                errors.push('Team number must be a string or empty.');
            }
            var numStr = String(updates.teamNumber).trim();
            if (numStr && !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                errors.push('Team number contains invalid characters. Use letters, numbers, hyphens, underscores, or spaces.');
            }
        }

        if (updates.temporaryMission !== undefined) {
            if (updates.temporaryMission !== null && updates.temporaryMission !== '' && typeof updates.temporaryMission !== 'string') {
                errors.push('Temporary mission must be a string or null.');
            }
        }

        if (updates.nameHistory !== undefined) {
            var nameValidation = validateNameHistory(updates.nameHistory);
            if (!nameValidation.valid) {
                errors.push(nameValidation.message);
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            type: type,
            startPeriod: startPeriod,
            endPeriod: endPeriod
        };
    }

    function validateTeamTypeChange(team, newType) {
        var errors = [];

        // Validate existing ranking history against new type
        if (Array.isArray(team.rankingHistory)) {
            var rankingValidation = validateRankingHistory(team.rankingHistory, newType);
            if (!rankingValidation.valid) {
                errors.push('Ranking history: ' + rankingValidation.message);
            }
        }

        // Validate existing members against new type
        if (Array.isArray(team.members)) {
            for (var i = 0; i < team.members.length; i++) {
                var member = team.members[i];
                if (!member || typeof member !== 'object') {
                    errors.push('Member ' + (i + 1) + ' is malformed.');
                    continue;
                }

                if (!isNonEmptyString(member.characterId)) {
                    errors.push('Member ' + (i + 1) + ' has missing character ID.');
                    continue;
                }

                var validation = validateMemberPeriods(member, newType);
                if (!validation.valid) {
                    errors.push('Member ' + (i + 1) + ': ' + validation.message);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    function buildValidatedTeam(teamData) {
        if (!isObject(teamData)) {
            return { valid: false, message: 'Team data must be an object.' };
        }

        if (!isNonEmptyString(teamData.name)) {
            return { valid: false, message: 'Team name is required.' };
        }

        var type = normalizeTeamType(teamData.type);
        if (type === null) {
            return { valid: false, message: 'Invalid team type.' };
        }

        var status = teamData.status;
        if (status && !isValidTeamStatus(status)) {
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

        var periodPair = isValidPeriodPair(startPeriod, endPeriod);
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
                return { valid: false, message: 'Team number contains invalid characters. Use letters, numbers, hyphens, underscores, or spaces.' };
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
                status: status || 'active',
                nameHistory: nameHistory,
                temporaryMission: temporaryMission,
                classId: classId,
                teamNumber: teamNumber
            }
        };
    }

    // ============================================================
    // TEAM CORE API
    // ============================================================

    var TeamCore = {
        /**
         * Normalise a team type to its canonical form.
         * 'internship' is a legacy persisted value and is explicitly migrated
         * to the canonical 'professional' type.
         * Returns null for invalid types.
         * NOTE: This does NOT mutate the stored data.
         * @param {string} type - Team type
         * @returns {string|null} Canonical type or null
         */
        normalizeTeamType: normalizeTeamType,

        /**
         * Check if a team type is valid.
         * 'internship' is accepted as a legacy value.
         * @param {string} type - Team type
         * @returns {boolean} True if valid
         */
        isValidTeamType: isValidTeamType,

        /**
         * Check if a team status is valid.
         * @param {string} status - Team status
         * @returns {boolean} True if valid
         */
        isValidTeamStatus: isValidTeamStatus,

        /**
         * Get a team by ID
         * @param {string} id - Team ID
         * @returns {object|null} Team object or null
         */
        getTeam: function(id) {
            if (!id) {
                return null;
            }
            return getTeamData(id);
        },

        /**
         * Get all teams (read-only, shallow copy)
         * @returns {array} Array of team objects
         */
        getAllTeams: function() {
            var data = getDataStore();
            if (!data) {
                return [];
            }
            return data.teams.slice();
        },

        /**
         * Get teams, optionally filtered by type and status
         * @param {string} type - Team type filter (normalised internally)
         * @param {string} status - Team status filter (active, inactive, deprecated)
         * @returns {array} Array of team objects (shallow copy of array)
         *         Team objects are live references; do not mutate them directly
         */
        getTeams: function(type, status) {
            var data = getDataStore();
            if (!data) {
                return [];
            }

            var teams = data.teams.slice();

            if (type) {
                var normalizedType = this.normalizeTeamType(type);
                if (normalizedType === null) {
                    return [];
                }
                var filtered = [];
                for (var i = 0; i < teams.length; i++) {
                    var team = teams[i];
                    if (this.normalizeTeamType(team.type) === normalizedType) {
                        filtered.push(team);
                    }
                }
                teams = filtered;
            }

            if (status) {
                if (!isValidTeamStatus(status)) {
                    return [];
                }
                var filtered2 = [];
                for (var j = 0; j < teams.length; j++) {
                    var team2 = teams[j];
                    if (team2.status === status) {
                        filtered2.push(team2);
                    }
                }
                teams = filtered2;
            }

            return teams;
        },

        /**
         * Get all active teams (status === 'active')
         * @param {string} type - Optional type filter
         * @returns {array} Array of active team objects
         */
        getActiveTeams: function(type) {
            return this.getTeams(type, 'active');
        },

        /**
         * Create a new team.
         * Atomic: validates all inputs before mutation.
         * Requires window.data and window.data.teams to exist.
         * 
         * @param {object} teamData - Team data
         * @returns {object|null} Created team or null if invalid
         */
        createTeam: function(teamData) {
            if (!isObject(teamData)) {
                return null;
            }

            var data = getDataStore();
            if (!data) {
                return null;
            }

            var built = buildValidatedTeam(teamData);
            if (!built.valid) {
                return null;
            }

            var team = built.data;

            var newTeam = {
                id: generateTeamId(),
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
            recordActivity('Created team: ' + newTeam.name + ' (' + newTeam.type + ')');

            return newTeam;
        },

        /**
         * Update an existing team.
         * Atomic: validates ALL updates before applying any.
         * If any update is invalid, nothing is changed.
         * Does NOT silently repair malformed existing data.
         * Rejects type changes that would invalidate existing members/rankings.
         * 
         * @param {string} id - Team ID
         * @param {object} updates - Updates to apply
         * @returns {object|null} Updated team or null if invalid
         */
        updateTeam: function(id, updates) {
            if (!isObject(updates)) {
                return null;
            }

            var team = this.getTeam(id);
            if (!team) {
                return null;
            }

            // Validate type change against existing data
            if (updates.type !== undefined) {
                var newType = this.normalizeTeamType(updates.type);
                if (newType !== null && newType !== team.type) {
                    var typeChangeValidation = validateTeamTypeChange(team, newType);
                    if (!typeChangeValidation.valid) {
                        return null;
                    }
                }
            }

            // Validate all updates before mutation
            var validation = validateTeamUpdate(updates, team);
            if (!validation.valid) {
                return null;
            }

            var hasChanges = false;

            // Apply validated updates only
            for (var i = 0; i < UPDATEABLE_PROPERTIES.length; i++) {
                var key = UPDATEABLE_PROPERTIES[i];
                if (updates[key] === undefined) {
                    continue;
                }

                if (key === 'type') {
                    var normalizedType = this.normalizeTeamType(updates[key]);
                    if (normalizedType !== null && team[key] !== normalizedType) {
                        team[key] = normalizedType;
                        hasChanges = true;
                    }
                    continue;
                }

                if (key === 'status') {
                    var statusValue = updates[key] || 'active';
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

                if (key === 'startPeriod' || key === 'endPeriod') {
                    var periodValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                        ? String(updates[key]).trim()
                        : '';
                    if (team[key] !== periodValue) {
                        team[key] = periodValue;
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

            if (hasChanges) {
                recordActivity('Updated team: ' + team.name);
            }

            return team;
        },

        /**
         * Delete a team permanently.
         * Physical deletion from the data store.
         * Uses findIndex + splice to remove exactly the requested team.
         * Does NOT silently discard malformed array entries.
         * 
         * @param {string} id - Team ID
         * @returns {boolean} Success
         */
        deleteTeam: function(id) {
            var team = this.getTeam(id);
            if (!team) {
                return false;
            }

            var data = getDataStore();
            if (!data) {
                return false;
            }

            var teamName = team.name;

            var index = -1;
            for (var i = 0; i < data.teams.length; i++) {
                var t = data.teams[i];
                if (t && typeof t === 'object' && String(t.id) === String(id)) {
                    index = i;
                    break;
                }
            }

            if (index === -1) {
                return false;
            }

            data.teams.splice(index, 1);

            recordActivity('Deleted team: ' + teamName);

            return true;
        },

        // ============================================================
        // MEMBER OPERATIONS
        // ============================================================

        /**
         * Add a member to a team.
         * Atomic: validates all inputs before mutation.
         * Rejects malformed existing team data instead of repairing it.
         * Validates that the character exists.
         * 
         * @param {string} teamId - Team ID
         * @param {object} memberData - { characterId, role, joinPeriod, leavePeriod }
         * @returns {object|null} Added member or null
         */
        addMember: function(teamId, memberData) {
            var team = this.getTeam(teamId);
            if (!team) {
                return null;
            }

            if (!Array.isArray(team.members)) {
                return null;
            }

            var member = buildValidatedMember(memberData);
            if (!member) {
                return null;
            }

            // Validate character exists
            var character = CharacterQueries.getCharacterById(member.characterId);
            if (!character) {
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

            var charName = getCharacterName(member.characterId);
            recordActivity('Added ' + charName + ' to team: ' + team.name);

            return newMember;
        },

        /**
         * Remove a member from a team.
         * Uses findIndex + splice to remove exactly the requested member.
         * 
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @returns {boolean} Success
         */
        removeMember: function(teamId, charId) {
            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.members)) {
                return false;
            }

            var index = -1;
            for (var i = 0; i < team.members.length; i++) {
                var m = team.members[i];
                if (m && String(m.characterId) === String(charId)) {
                    index = i;
                    break;
                }
            }

            if (index === -1) {
                return false;
            }

            var removed = team.members[index];
            team.members.splice(index, 1);

            var charName = getCharacterName(charId);
            recordActivity('Removed ' + charName + ' from team: ' + team.name);

            return true;
        },

        /**
         * Update a member's details.
         * Atomic: validates the COMPLETE proposed state before applying any changes.
         * Valid no-op updates return the existing member (idempotent).
         * 
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @param {object} updates - { role, joinPeriod, leavePeriod }
         * @returns {object|null} Updated member or null if invalid
         */
        updateMember: function(teamId, charId, updates) {
            if (!isObject(updates)) {
                return null;
            }

            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.members)) {
                return null;
            }

            var member = null;
            var memberIndex = -1;
            for (var i = 0; i < team.members.length; i++) {
                var m = team.members[i];
                if (m && String(m.characterId) === String(charId)) {
                    member = m;
                    memberIndex = i;
                    break;
                }
            }

            if (!member || memberIndex === -1) {
                return null;
            }

            var allowedMemberUpdates = ['role', 'joinPeriod', 'leavePeriod'];

            var proposedMember = {
                characterId: member.characterId,
                role: member.role,
                joinPeriod: member.joinPeriod,
                leavePeriod: member.leavePeriod
            };

            for (var j = 0; j < allowedMemberUpdates.length; j++) {
                var key = allowedMemberUpdates[j];
                if (updates[key] === undefined) {
                    continue;
                }

                if (typeof updates[key] === 'string') {
                    proposedMember[key] = updates[key].trim();
                } else if (updates[key] !== null && updates[key] !== undefined) {
                    proposedMember[key] = String(updates[key]);
                } else {
                    proposedMember[key] = '';
                }
            }

            var validation = validateMemberPeriods(proposedMember, team.type);
            if (!validation.valid) {
                return null;
            }

            var changed = false;
            var changes = [];

            for (var k = 0; k < allowedMemberUpdates.length; k++) {
                var prop = allowedMemberUpdates[k];
                if (member[prop] !== proposedMember[prop]) {
                    changed = true;
                    changes.push(prop);
                }
            }

            if (!changed) {
                return member;
            }

            for (var l = 0; l < allowedMemberUpdates.length; l++) {
                var prop2 = allowedMemberUpdates[l];
                member[prop2] = proposedMember[prop2];
            }

            var charName = getCharacterName(charId);
            recordActivity('Updated member ' + charName + ' in team: ' + team.name);

            return member;
        },

        /**
         * Get active members of a team at a given period.
         * Validates period against team type.
         * Distinguishes missing periods from malformed periods.
         * Malformed members are silently excluded.
         * 
         * @param {object} team - Team object
         * @param {number|string} period - Week (academic) or Year (other types)
         * @returns {array} Array of active members
         */
        getActiveMembers: function(team, period) {
            if (!team || !Array.isArray(team.members)) {
                return [];
            }

            if (team.type === 'academic') {
                if (!isValidAcademicWeek(period)) {
                    return [];
                }
            } else {
                if (!isValidYear(period)) {
                    return [];
                }
            }

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                return [];
            }

            var result = [];
            for (var i = 0; i < team.members.length; i++) {
                var m = team.members[i];
                if (!m || typeof m !== 'object') {
                    continue;
                }

                var join = parseNumericPeriod(m.joinPeriod);
                var leave = parseNumericPeriod(m.leavePeriod);

                var hasJoin = m.joinPeriod !== undefined && m.joinPeriod !== null && String(m.joinPeriod).trim() !== '';
                if (hasJoin && join === null) {
                    continue;
                }

                var hasLeave = m.leavePeriod !== undefined && m.leavePeriod !== null && String(m.leavePeriod).trim() !== '';
                if (hasLeave && leave === null) {
                    continue;
                }

                var joined = !hasJoin || join <= periodNum;
                var notLeft = !hasLeave || leave >= periodNum;

                if (joined && notLeft) {
                    result.push(m);
                }
            }

            return result;
        },

        // ============================================================
        // RANKING OPERATIONS
        // ============================================================

        /**
         * Compare two periods for sorting
         * @param {string} a - First period
         * @param {string} b - Second period
         * @returns {number} Comparison result
         * @private
         */
        _comparePeriods: function(a, b) {
            var aNum = parseNumericPeriod(a);
            var bNum = parseNumericPeriod(b);

            if (aNum !== null && bNum !== null) {
                return aNum - bNum;
            }

            return String(a).localeCompare(String(b));
        },

        /**
         * Add a ranking entry to a team.
         * Atomic: validates before mutation.
         * Enforces ONE ranking per period (canonical numeric comparison).
         * Rejects malformed existing ranking history.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period (week block or year)
         * @param {string|number} rank - Rank number (must be positive integer)
         * @returns {boolean} Success
         */
        addRanking: function(teamId, period, rank) {
            if (!period || String(period).trim() === '') {
                return false;
            }

            var team = this.getTeam(teamId);
            if (!team) {
                return false;
            }

            if (!Array.isArray(team.rankingHistory)) {
                return false;
            }

            var rankingValidation = validateRankingHistory(team.rankingHistory, team.type);
            if (!rankingValidation.valid) {
                return false;
            }

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                return false;
            }

            if (team.type === 'academic') {
                if (!isValidAcademicWeek(periodNum)) {
                    return false;
                }
            } else {
                if (!isValidYear(periodNum)) {
                    return false;
                }
            }

            var rankNum = parseRank(rank);
            if (rankNum === null) {
                return false;
            }

            var periodStr = String(periodNum);

            // Find existing entry for this period
            var existingIndex = -1;
            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && String(entry.period) === periodStr) {
                    existingIndex = i;
                    break;
                }
            }

            var oldRank = null;
            var isUpdate = existingIndex !== -1;

            if (isUpdate) {
                oldRank = team.rankingHistory[existingIndex].rank;
                team.rankingHistory[existingIndex] = {
                    period: periodStr,
                    rank: rankNum
                };
            } else {
                team.rankingHistory.push({
                    period: periodStr,
                    rank: rankNum
                });
            }

            updateCurrentRank(team);

            var teamName = team.name || 'Unknown Team';
            if (isUpdate) {
                recordActivity('Updated ranking for ' + teamName + ': #' + oldRank + ' -> #' + rank + ' (' + periodStr + ')');
            } else {
                recordActivity('Added ranking #' + rank + ' for ' + teamName + ' (' + periodStr + ')');
            }

            return true;
        },

        /**
         * Remove a ranking entry by period.
         * Uses findIndex + splice for exact removal.
         * Rejects malformed existing ranking history.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            if (!period || String(period).trim() === '') {
                return false;
            }

            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.rankingHistory)) {
                return false;
            }

            var rankingValidation = validateRankingHistory(team.rankingHistory, team.type);
            if (!rankingValidation.valid) {
                return false;
            }

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                return false;
            }

            var periodStr = String(periodNum);

            var index = -1;
            for (var i = 0; i < team.rankingHistory.length; i++) {
                var entry = team.rankingHistory[i];
                if (entry && String(entry.period) === periodStr) {
                    index = i;
                    break;
                }
            }

            if (index === -1) {
                return false;
            }

            var removedEntry = team.rankingHistory[index];
            team.rankingHistory.splice(index, 1);

            updateCurrentRank(team);

            var teamName = team.name || 'Unknown Team';
            var rankInfo = removedEntry ? ' #' + removedEntry.rank : '';
            recordActivity('Removed ranking' + rankInfo + ' from ' + teamName + ' (' + periodStr + ')');

            return true;
        },

        /**
         * Get sorted ranking history for a team.
         * Malformed entries are filtered out.
         * 
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedRankings: function(team) {
            return getSortedRankings(team);
        },

        /**
         * Get the current rank for a team.
         * This is the CANONICAL way to retrieve the current ranking.
         * Always recalculates from history.
         * 
         * @param {object} team - Team object
         * @returns {string} Current rank (empty string if none)
         */
        getCurrentRank: function(team) {
            if (!team) {
                return '';
            }
            var history = getSortedRankings(team);
            return history.length > 0 ? String(history[history.length - 1].rank) : '';
        },

        /**
         * Get the most recent ranking entry for a team.
         * 
         * @param {object} team - Team object
         * @returns {object|null} Most recent ranking entry or null
         */
        getMostRecentRanking: function(team) {
            if (!team) {
                return null;
            }
            var history = getSortedRankings(team);
            return history.length > 0 ? history[history.length - 1] : null;
        },

        // ============================================================
        // PERIOD HELPERS
        // ============================================================

        /**
         * Get the current period for a team type.
         * @param {string} teamType - Team type
         * @returns {number} Current period
         */
        getCurrentPeriod: function(teamType) {
            var data = window.data || {};
            if (teamType === 'academic') {
                return data.currentWeek || MIN_WEEK;
            }
            return data.currentYear || DEFAULT_YEAR;
        },

        /**
         * Get the period label for a team type.
         * @param {string} teamType - Team type
         * @returns {string} Period label
         */
        getPeriodLabel: function(teamType) {
            return teamType === 'academic' ? 'Week' : 'Year';
        },

        // ============================================================
        // MEMBER STATUS INFO - Simple status mapping
        // ============================================================

        /**
         * Get status info for a member status.
         * @param {string} status - Status string
         * @returns {object} { label, color }
         */
        getMemberStatusInfo: function(status) {
            var map = {
                'active': { label: 'Active', color: 'var(--accent)' },
                'left': { label: 'Former', color: 'var(--text-dim)' },
                'deceased': { label: 'Deceased', color: 'var(--danger)' },
                'eliminated': { label: 'Eliminated', color: 'var(--danger)' },
                'future': { label: 'Future Member', color: 'var(--warning)' },
                'unknown': { label: 'Unknown', color: 'var(--text-dim)' }
            };
            return map[status] || map['unknown'];
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamCore = TeamCore;

})();
