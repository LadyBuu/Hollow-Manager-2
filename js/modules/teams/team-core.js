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
 *   - Membership is inclusive: join <= period <= leave means active
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
 *   - window.STATUS_CONSTANTS (from constants.js)
 *   - window.ID_CONSTANTS (from constants.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.logActivity (from app.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamCoreLoaded) {
        return;
    }
    window.__teamCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var STATUS = window.STATUS_CONSTANTS || {};
    var ID = window.ID_CONSTANTS || {};

    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
    var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;
    var DEFAULT_YEAR = CALENDAR.DEFAULT_YEAR ? CALENDAR.DEFAULT_YEAR() : new Date().getFullYear();

    var VALID_TEAM_TYPES = ['academic', 'professional', 'temporary', 'civilian'];
    var VALID_TEAM_STATUSES = STATUS.VALID_TEAM_STATUSES || ['active', 'inactive', 'deprecated'];
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
    // UTILITY HELPERS - Use shared utilities when available
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

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function deepClone(value) {
        if (window.CoreUtils && typeof window.CoreUtils.deepClone === 'function') {
            return window.CoreUtils.deepClone(value);
        }
        // Fallback
        if (value === null || typeof value !== 'object') return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.warn('TeamCore: Failed to clone:', e);
            return null;
        }
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
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Check if a team type is valid.
     * 'internship' is accepted as a legacy value.
     */
    function isValidTeamType(type) {
        if (!type) return false;
        if (type === 'internship') return true;
        return VALID_TEAM_TYPES.indexOf(type) !== -1;
    }

    /**
     * Normalise a team type to its canonical form.
     * 'internship' is a legacy persisted value and is explicitly migrated
     * to the canonical 'professional' type.
     * Returns null for invalid types.
     * NOTE: This does NOT mutate the stored data.
     */
    function normalizeTeamType(type) {
        if (type === 'internship') {
            return 'professional';
        }
        if (isValidTeamType(type)) {
            return type;
        }
        return null;
    }

    function isValidTeamStatus(status) {
        return status && VALID_TEAM_STATUSES.indexOf(status) !== -1;
    }

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
            return true; // Empty is allowed (optional field)
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

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

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

    function sanitizeNameHistory(history) {
        if (!Array.isArray(history)) return null;
        var result = [];
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!isObject(entry)) continue;
            var name = String(entry.name || '').trim();
            if (!name) continue;
            result.push({
                name: name,
                startPeriod: String(entry.startPeriod || '').trim(),
                endPeriod: String(entry.endPeriod || '').trim()
            });
        }
        return result;
    }

    function sanitizeMemberData(memberData) {
        if (!isObject(memberData)) return null;
        if (!isNonEmptyString(memberData.characterId)) return null;

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

        // If join is provided, validate it
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

        // If leave is provided, validate it
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

        // If both are provided, join must be <= leave
        if (join !== null && leave !== null && join > leave) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }

        return { valid: true };
    }

    function validateRankingHistory(history) {
        if (!Array.isArray(history)) {
            return { valid: false, message: 'Ranking history must be an array.' };
        }

        var seenPeriods = {};

        for (var i = 0; i < history.length; i++) {
            var r = history[i];
            if (!r || typeof r !== 'object') {
                return {
                    valid: false,
                    message: 'Invalid ranking entry at index ' + i + '.'
                };
            }

            var period = parseNumericPeriod(r.period);
            if (period === null) {
                return {
                    valid: false,
                    message: 'Invalid period format at index ' + i + '.'
                };
            }

            var rank = parseRank(r.rank);
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

    function validateTeamUpdate(updates, team) {
        var errors = [];

        // Validate name
        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                errors.push('Team name is required.');
            }
        }

        // Validate type
        if (updates.type !== undefined) {
            var type = normalizeTeamType(updates.type);
            if (type === null) {
                errors.push('Invalid team type.');
            }
        }

        // Validate status
        if (updates.status !== undefined) {
            if (!isValidTeamStatus(updates.status)) {
                errors.push('Invalid team status.');
            }
        }

        // Validate periods (using current type or update type)
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

        // Validate classId if present
        if (updates.classId !== undefined) {
            if (updates.classId !== null && updates.classId !== '' && typeof updates.classId !== 'string') {
                errors.push('Class ID must be a string or null.');
            }
        }

        // Validate nameHistory if present
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

        // Validate existing members against new type
        if (Array.isArray(team.members)) {
            team.members.forEach(function(member, index) {
                if (!member || typeof member !== 'object') return;

                var join = parseNumericPeriod(member.joinPeriod);
                var leave = parseNumericPeriod(member.leavePeriod);

                if (member.joinPeriod && member.joinPeriod !== '') {
                    if (join === null) {
                        errors.push('Member ' + (index + 1) + ' has invalid join period format.');
                    } else if (newType !== 'academic' && !isValidYear(member.joinPeriod)) {
                        errors.push('Member ' + (index + 1) + ' join period must be a valid year (' + MIN_YEAR + '-' + MAX_YEAR + ').');
                    } else if (newType === 'academic' && (join < MIN_WEEK || join > MAX_WEEK)) {
                        errors.push('Member ' + (index + 1) + ' join period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams.');
                    }
                }

                if (member.leavePeriod && member.leavePeriod !== '') {
                    if (leave === null) {
                        errors.push('Member ' + (index + 1) + ' has invalid leave period format.');
                    } else if (newType !== 'academic' && !isValidYear(member.leavePeriod)) {
                        errors.push('Member ' + (index + 1) + ' leave period must be a valid year (' + MIN_YEAR + '-' + MAX_YEAR + ').');
                    } else if (newType === 'academic' && (leave < MIN_WEEK || leave > MAX_WEEK)) {
                        errors.push('Member ' + (index + 1) + ' leave period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams.');
                    }
                }

                if (join !== null && leave !== null && join > leave) {
                    errors.push('Member ' + (index + 1) + ' join period cannot be after leave period.');
                }
            });
        }

        // Validate existing rankings against new type
        if (Array.isArray(team.rankingHistory)) {
            team.rankingHistory.forEach(function(r, index) {
                if (!r || typeof r !== 'object') return;

                var period = parseNumericPeriod(r.period);
                if (period === null) {
                    errors.push('Ranking ' + (index + 1) + ' has invalid period format.');
                } else if (newType === 'academic' && (period < MIN_WEEK || period > MAX_WEEK)) {
                    errors.push('Ranking ' + (index + 1) + ' period must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + ' for academic teams.');
                } else if (newType !== 'academic' && !isValidYear(period)) {
                    errors.push('Ranking ' + (index + 1) + ' period must be a valid year (' + MIN_YEAR + '-' + MAX_YEAR + ').');
                }
            });
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    function sanitizeTeamData(teamData) {
        if (!isObject(teamData)) return null;

        // Validate name
        if (!isNonEmptyString(teamData.name)) {
            return { valid: false, message: 'Team name is required.' };
        }

        // Validate type
        var type = normalizeTeamType(teamData.type);
        if (type === null) {
            return { valid: false, message: 'Invalid team type.' };
        }

        // Validate status
        var status = teamData.status;
        if (status && !isValidTeamStatus(status)) {
            return { valid: false, message: 'Invalid team status.' };
        }

        // Validate periods
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

        // Validate classId if present
        var classId = teamData.classId !== undefined && teamData.classId !== null && teamData.classId !== ''
            ? String(teamData.classId).trim()
            : null;

        // Validate nameHistory
        if (teamData.nameHistory !== undefined) {
            var nameValidation = validateNameHistory(teamData.nameHistory);
            if (!nameValidation.valid) {
                return { valid: false, message: nameValidation.message };
            }
        }
        var nameHistory = sanitizeNameHistory(teamData.nameHistory) || [];

        return {
            valid: true,
            data: {
                name: String(teamData.name).trim(),
                type: type,
                startPeriod: startPeriod,
                endPeriod: endPeriod,
                status: status || 'active',
                nameHistory: nameHistory,
                temporaryMission: teamData.temporaryMission !== undefined && teamData.temporaryMission !== null && teamData.temporaryMission !== ''
                    ? String(teamData.temporaryMission).trim()
                    : null,
                classId: classId,
                teamNumber: isNonEmptyString(teamData.teamNumber) ? String(teamData.teamNumber).trim() : ''
            }
        };
    }

    // ============================================================
    // TEAM LOOKUP HELPERS
    // ============================================================

    function getTeamData(id) {
        if (!id) return null;
        var data = getDataStore();
        if (!data) return null;
        return data.teams.find(function(t) {
            return t && typeof t === 'object' && String(t.id) === String(id);
        }) || null;
    }

    // ============================================================
    // ACTIVITY LOGGING HELPER
    // ============================================================

    function recordActivity(message) {
        try {
            if (typeof window.logActivity === 'function') {
                window.logActivity(message);
            }
        } catch (err) {
            // Swallow logging errors
        }
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateTeamId() {
        var prefix = ID.PREFIXES ? ID.PREFIXES.TEAM : 'team';
        if (typeof window.generateId === 'function') {
            return window.generateId(prefix);
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
         * Get a team by ID
         * @param {string} id - Team ID
         * @returns {object|null} Team object or null
         */
        getTeam: function(id) {
            if (!id) return null;
            return getTeamData(id);
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
            if (!data) return [];

            var teams = data.teams.slice();

            if (type) {
                var normalizedType = this.normalizeTeamType(type);
                if (normalizedType === null) {
                    return [];
                }
                teams = teams.filter(function(t) {
                    return this.normalizeTeamType(t.type) === normalizedType;
                }.bind(this));
            }

            if (status) {
                if (!isValidTeamStatus(status)) {
                    return [];
                }
                teams = teams.filter(function(t) { return t.status === status; });
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
                console.warn('TeamCore.createTeam: Team data must be an object.');
                return null;
            }

            var data = getDataStore();
            if (!data) {
                console.warn('TeamCore.createTeam: Data store is not available.');
                return null;
            }

            var sanitized = sanitizeTeamData(teamData);
            if (!sanitized.valid) {
                console.warn('TeamCore.createTeam:', sanitized.message);
                return null;
            }

            var team = sanitized.data;

            var newTeam = {
                id: generateTeamId(),
                name: team.name,
                type: team.type,
                startPeriod: team.startPeriod,
                endPeriod: team.endPeriod,
                currentRank: '', // Materialised cache, derived from rankingHistory
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
                console.warn('TeamCore.updateTeam: Updates must be an object.');
                return null;
            }

            var team = this.getTeam(id);
            if (!team) return null;

            // Validate type change against existing data
            if (updates.type !== undefined) {
                var newType = this.normalizeTeamType(updates.type);
                if (newType !== null && newType !== team.type) {
                    var typeChangeValidation = validateTeamTypeChange(team, newType);
                    if (!typeChangeValidation.valid) {
                        console.warn('TeamCore.updateTeam: Type change would invalidate existing data:', typeChangeValidation.errors.join(', '));
                        return null;
                    }
                }
            }

            // Validate all updates before mutation
            var validation = validateTeamUpdate(updates, team);
            if (!validation.valid) {
                console.warn('TeamCore.updateTeam: Validation failed:', validation.errors.join(', '));
                return null;
            }

            var changes = [];
            var hasChanges = false;

            // Apply validated updates only
            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] === undefined) return;

                // Handle type - already validated
                if (key === 'type') {
                    var normalizedType = this.normalizeTeamType(updates[key]);
                    if (normalizedType !== null && team[key] !== normalizedType) {
                        team[key] = normalizedType;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Handle status - already validated
                if (key === 'status') {
                    var statusValue = updates[key] || 'active';
                    if (team[key] !== statusValue) {
                        team[key] = statusValue;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Handle nameHistory - already validated
                if (key === 'nameHistory') {
                    var sanitized = sanitizeNameHistory(updates[key]);
                    if (sanitized !== null && JSON.stringify(team[key]) !== JSON.stringify(sanitized)) {
                        team[key] = sanitized;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Handle classId - must be string or null
                if (key === 'classId') {
                    var classIdValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                        ? String(updates[key]).trim()
                        : null;
                    if (team[key] !== classIdValue) {
                        team[key] = classIdValue;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Handle temporaryMission - must be string or null
                if (key === 'temporaryMission') {
                    var missionValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                        ? String(updates[key]).trim()
                        : null;
                    if (team[key] !== missionValue) {
                        team[key] = missionValue;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Handle period fields - already validated
                if (key === 'startPeriod' || key === 'endPeriod') {
                    var periodValue = updates[key] !== undefined && updates[key] !== null && updates[key] !== ''
                        ? String(updates[key]).trim()
                        : '';
                    if (team[key] !== periodValue) {
                        team[key] = periodValue;
                        changes.push(key);
                        hasChanges = true;
                    }
                    return;
                }

                // Generic string value
                if (typeof updates[key] === 'string') {
                    var trimmed = updates[key].trim();
                    if (team[key] !== trimmed) {
                        team[key] = trimmed;
                        changes.push(key);
                        hasChanges = true;
                    }
                } else if (team[key] !== updates[key]) {
                    team[key] = updates[key];
                    changes.push(key);
                    hasChanges = true;
                }
            }.bind(this));

            if (hasChanges && changes.length > 0) {
                recordActivity('Updated team: ' + team.name + ' (' + changes.join(', ') + ')');
            }

            return team;
        },

        /**
         * Delete a team permanently.
         * Physical deletion from the data store.
         * 
         * @param {string} id - Team ID
         * @returns {boolean} Success
         */
        deleteTeam: function(id) {
            var team = this.getTeam(id);
            if (!team) return false;

            var data = getDataStore();
            if (!data) return false;

            var teamName = team.name;
            data.teams = data.teams.filter(function(t) {
                return t && typeof t === 'object' && String(t.id) !== String(id);
            });

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
         * 
         * @param {string} teamId - Team ID
         * @param {object} memberData - { characterId, role, joinPeriod, leavePeriod }
         * @returns {object|null} Added member or null
         */
        addMember: function(teamId, memberData) {
            var team = this.getTeam(teamId);
            if (!team) return null;

            // Reject malformed existing data
            if (!Array.isArray(team.members)) {
                console.warn('TeamCore.addMember: Team members data is malformed.');
                return null;
            }

            var member = sanitizeMemberData(memberData);
            if (!member) {
                console.warn('TeamCore.addMember: Invalid member data');
                return null;
            }

            // Validate member periods against team type
            var periodValidation = validateMemberPeriods(member, team.type);
            if (!periodValidation.valid) {
                console.warn('TeamCore.addMember:', periodValidation.message);
                return null;
            }

            // Check for duplicate
            if (team.members.some(function(m) {
                return m && String(m.characterId) === String(member.characterId);
            })) {
                console.warn('TeamCore.addMember: Character already in team');
                return null;
            }

            var newMember = {
                characterId: member.characterId,
                role: member.role,
                joinPeriod: member.joinPeriod,
                leavePeriod: member.leavePeriod
            };

            team.members.push(newMember);

            var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
            var charName = char ? window.getDisplayName ? window.getDisplayName(char) : 'character' : 'character';
            recordActivity('Added ' + charName + ' to team: ' + team.name);

            return newMember;
        },

        /**
         * Remove a member from a team.
         * 
         * @param {string} teamId - Team ID
         * @param {string} charId - Character ID
         * @returns {boolean} Success
         */
        removeMember: function(teamId, charId) {
            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.members)) return false;

            var index = team.members.findIndex(function(m) {
                return m && String(m.characterId) === String(charId);
            });

            if (index === -1) return false;

            team.members.splice(index, 1);

            var char = window.getCharacterById ? window.getCharacterById(charId) : null;
            var charName = char ? window.getDisplayName ? window.getDisplayName(char) : 'character' : 'character';
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
                console.warn('TeamCore.updateMember: Updates must be an object.');
                return null;
            }

            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.members)) return null;

            var member = team.members.find(function(m) {
                return m && String(m.characterId) === String(charId);
            });

            if (!member) return null;

            var allowedMemberUpdates = ['role', 'joinPeriod', 'leavePeriod'];

            // Build complete proposed member state
            var proposedMember = Object.assign({}, member);

            allowedMemberUpdates.forEach(function(key) {
                if (updates[key] === undefined) return;

                if (typeof updates[key] === 'string') {
                    proposedMember[key] = updates[key].trim();
                } else if (updates[key] !== null && updates[key] !== undefined) {
                    proposedMember[key] = String(updates[key]);
                } else {
                    proposedMember[key] = '';
                }
            });

            // Validate the complete proposed state
            var validation = validateMemberPeriods(proposedMember, team.type);
            if (!validation.valid) {
                console.warn('TeamCore.updateMember:', validation.message);
                return null;
            }

            // Check if anything actually changed
            var changed = false;
            var changes = [];

            allowedMemberUpdates.forEach(function(key) {
                if (member[key] !== proposedMember[key]) {
                    changed = true;
                    changes.push(key);
                }
            });

            if (!changed) {
                return member; // Idempotent: return existing member
            }

            // Apply the validated changes
            allowedMemberUpdates.forEach(function(key) {
                member[key] = proposedMember[key];
            });

            var char = window.getCharacterById ? window.getCharacterById(charId) : null;
            var charName = char ? window.getDisplayName ? window.getDisplayName(char) : 'character' : 'character';
            recordActivity('Updated member ' + charName + ' in team: ' + team.name + ' (' + changes.join(', ') + ')');

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
            if (!team || !Array.isArray(team.members)) return [];

            // Validate period against team type
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

            return team.members.filter(function(m) {
                if (!m || typeof m !== 'object') return false;

                var join = parseNumericPeriod(m.joinPeriod);
                var leave = parseNumericPeriod(m.leavePeriod);

                // Check if join is present but malformed
                var hasJoin = hasValue(m.joinPeriod);
                if (hasJoin && join === null) {
                    return false; // Malformed member, exclude
                }

                // Check if leave is present but malformed
                var hasLeave = hasValue(m.leavePeriod);
                if (hasLeave && leave === null) {
                    return false; // Malformed member, exclude
                }

                // Active if joined (or no join) and not left (or no leave)
                var joined = !hasJoin || join <= periodNum;
                var notLeft = !hasLeave || leave >= periodNum;

                return joined && notLeft;
            });
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
            // Validate inputs
            if (!period || String(period).trim() === '') {
                console.warn('TeamCore.addRanking: Period is required.');
                return false;
            }

            var team = this.getTeam(teamId);
            if (!team) {
                console.warn('TeamCore.addRanking: Team not found.');
                return false;
            }

            // Reject malformed existing data
            if (!Array.isArray(team.rankingHistory)) {
                console.warn('TeamCore.addRanking: Ranking history data is malformed.');
                return false;
            }

            // Validate existing ranking entries are well-formed
            var rankingValidation = validateRankingHistory(team.rankingHistory);
            if (!rankingValidation.valid) {
                console.warn('TeamCore.addRanking: Ranking history contains malformed entries:', rankingValidation.message);
                return false;
            }

            // Validate period against team type
            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                console.warn('TeamCore.addRanking: Invalid period.');
                return false;
            }

            if (team.type === 'academic') {
                if (!isValidAcademicWeek(periodNum)) {
                    console.warn('TeamCore.addRanking: Academic period must be a week number (' + MIN_WEEK + '-' + MAX_WEEK + ').');
                    return false;
                }
            } else {
                if (!isValidYear(periodNum)) {
                    console.warn('TeamCore.addRanking: Non-academic period must be a year (' + MIN_YEAR + '-' + MAX_YEAR + ').');
                    return false;
                }
            }

            // Validate rank (strict integer)
            var rankNum = parseRank(rank);
            if (rankNum === null) {
                console.warn('TeamCore.addRanking: Rank must be a positive integer.');
                return false;
            }

            // Check for duplicate period (canonical numeric comparison)
            var existingEntries = team.rankingHistory.filter(function(r) {
                return r && parseNumericPeriod(r.period) === periodNum;
            });

            if (existingEntries.length > 0) {
                team.rankingHistory = team.rankingHistory.filter(function(r) {
                    return r && parseNumericPeriod(r.period) !== periodNum;
                });
            }

            var oldRank = existingEntries.length > 0 ? existingEntries[0].rank : null;
            var isUpdate = existingEntries.length > 0;

            // Add the new entry
            team.rankingHistory.push({
                period: String(periodNum),
                rank: rankNum
            });

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            if (typeof window.logActivity === 'function') {
                var teamName = team.name || 'Unknown Team';
                if (isUpdate) {
                    window.logActivity('Updated ranking for ' + teamName + ': #' + oldRank + ' → #' + rank + ' (' + periodNum + ')');
                } else {
                    window.logActivity('Added ranking #' + rank + ' for ' + teamName + ' (' + periodNum + ')');
                }
            }

            return true;
        },

        /**
         * Remove a ranking entry by period.
         * Uses canonical numeric comparison.
         * 
         * @param {string} teamId - Team ID
         * @param {string|number} period - Period to remove
         * @returns {boolean} Success
         */
        removeRanking: function(teamId, period) {
            if (!period || String(period).trim() === '') {
                console.warn('TeamCore.removeRanking: Period is required.');
                return false;
            }

            var team = this.getTeam(teamId);
            if (!team || !Array.isArray(team.rankingHistory)) {
                console.warn('TeamCore.removeRanking: Team or ranking history not found.');
                return false;
            }

            var periodNum = parseNumericPeriod(period);
            if (periodNum === null) {
                console.warn('TeamCore.removeRanking: Invalid period.');
                return false;
            }

            var originalLength = team.rankingHistory.length;

            // Find the entry to remove for logging
            var removedEntry = team.rankingHistory.find(function(r) {
                return r && parseNumericPeriod(r.period) === periodNum;
            });

            team.rankingHistory = team.rankingHistory.filter(function(r) {
                return r && parseNumericPeriod(r.period) !== periodNum;
            });

            if (team.rankingHistory.length === originalLength) {
                console.warn('TeamCore.removeRanking: Period "' + period + '" not found.');
                return false;
            }

            // Update current rank cache
            this._updateCurrentRank(team);

            // Activity logging
            if (typeof window.logActivity === 'function') {
                var teamName = team.name || 'Unknown Team';
                var rankInfo = removedEntry ? ' #' + removedEntry.rank : '';
                window.logActivity('Removed ranking' + rankInfo + ' from ' + teamName + ' (' + periodNum + ')');
            }

            return true;
        },

        /**
         * Update the current rank cache based on the most recent ranking.
         * This is a MATERIALISED CACHE, refreshed on every mutation.
         * 
         * @param {object} team - Team object
         * @private
         */
        _updateCurrentRank: function(team) {
            if (!team) return;

            if (!team.rankingHistory || team.rankingHistory.length === 0) {
                team.currentRank = '';
                return;
            }

            var sorted = this.getSortedRankings(team);
            team.currentRank = sorted.length > 0 ? String(sorted[sorted.length - 1].rank) : '';
        },

        /**
         * Get sorted ranking history for a team.
         * Malformed entries are filtered out.
         * 
         * @param {object} team - Team object
         * @returns {array} Sorted ranking history
         */
        getSortedRankings: function(team) {
            if (!team || !Array.isArray(team.rankingHistory)) return [];

            var history = team.rankingHistory.slice().filter(function(r) {
                return r &&
                    parseNumericPeriod(r.period) !== null &&
                    parseRank(r.rank) !== null;
            });

            return history.sort(function(a, b) {
                return this._comparePeriods(a.period, b.period);
            }.bind(this));
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
            if (!team) return '';
            var history = this.getSortedRankings(team);
            return history.length > 0 ? String(history[history.length - 1].rank) : '';
        },

        /**
         * Get the most recent ranking entry for a team.
         * 
         * @param {object} team - Team object
         * @returns {object|null} Most recent ranking entry or null
         */
        getMostRecentRanking: function(team) {
            if (!team) return null;
            var history = this.getSortedRankings(team);
            return history.length > 0 ? history[history.length - 1] : null;
        },

        // ============================================================
        // DISPLAY HELPERS
        // ============================================================

        /**
         * Get team period display string
         * @param {object} team - Team object
         * @returns {string} Formatted period display
         */
        getPeriodDisplay: function(team) {
            if (!team) return '-';

            if (team.type === 'academic') {
                if (team.startPeriod && team.endPeriod) {
                    return 'Wk ' + team.startPeriod + ' - Wk ' + team.endPeriod;
                } else if (team.startPeriod) {
                    return 'From Wk ' + team.startPeriod;
                }
                return '-';
            } else {
                if (team.startPeriod && team.endPeriod) {
                    return team.startPeriod + ' - ' + team.endPeriod;
                } else if (team.startPeriod) {
                    return 'From ' + team.startPeriod;
                }
                return '-';
            }
        },

        /**
         * Get team type label
         * @param {string} type - Team type
         * @returns {string} Human-readable label
         */
        getTypeLabel: function(type) {
            var normalized = normalizeTeamType(type);
            var labels = {
                'academic': 'Academic',
                'professional': 'Professional',
                'temporary': 'Temporary',
                'civilian': 'Civilian'
            };
            return labels[normalized] || type || 'Unknown';
        },

        /**
         * Get status info for a member
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
        },

        /**
         * Get the current period for a team type
         * @param {string} teamType - Team type
         * @returns {number} Current period
         */
        getCurrentPeriod: function(teamType) {
            var data = window.data || {};
            if (teamType === 'academic') {
                if (window.teamState && window.teamState.filters && window.teamState.filters.academic) {
                    return window.teamState.filters.academic.filterWeek || 1;
                }
                return 1;
            }
            return data.currentYear || DEFAULT_YEAR;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamCore = TeamCore;

})();
