/**
 * modules/teams/team-queries.js - Team Queries
 * Read-only team domain queries
 * Path: js/modules/teams/team-queries.js
 * 
 * This module provides:
 *   - Team lookup (by ID, by name)
 *   - Team listing with filters (type, status, period)
 *   - Active team members at a given period
 *   - Team membership queries
 *   - Team period validation
 *   - Team type normalisation
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Uses ValidationUtils for period parsing
 *   - Uses CharacterQueries for character data (when needed)
 *   - All functions return DEEP CLONED data where appropriate
 * 
 * DEPENDENCIES:
 *   - window.ValidationUtils (from validation-utils.js)
 *   - window.CharacterQueries (from character-queries.js) - optional
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data.teams is the source of truth for team data
 *   - No caching - always reads fresh from window.data
 *   - Results are NOT cloned by default (caller should clone if needed)
 * 
 * USAGE:
 *   var queries = window.TeamQueries;
 *   var team = queries.getTeamById('team_123');
 *   var teams = queries.getTeams('academic', 'operational');
 *   var members = queries.getActiveTeamMembers(team, 1);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__teamQueriesLoaded) {
        return;
    }
    window.__teamQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ValidationUtils = window.ValidationUtils || window;
    var CharacterQueries = window.CharacterQueries || window;
    var CalendarConstants = window.CALENDAR_CONSTANTS || {};

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;
    var MIN_YEAR = CalendarConstants.MIN_YEAR || 1900;
    var MAX_YEAR = CalendarConstants.MAX_YEAR || 2100;
    var DEFAULT_YEAR = CalendarConstants.DEFAULT_YEAR ? CalendarConstants.DEFAULT_YEAR() : new Date().getFullYear();

    var VALID_TEAM_TYPES = ['academic', 'professional', 'temporary', 'civilian'];
    var VALID_TEAM_STATUSES = ['active', 'inactive', 'deprecated', 'deleted'];
    var OPERATIONAL_STATUSES = ['active', 'inactive', 'deprecated'];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // ValidationUtils is MANDATORY
        if (!ValidationUtils || typeof ValidationUtils.parseStrictPositivePeriod !== 'function') {
            missing.push('ValidationUtils.parseStrictPositivePeriod');
        }
        if (!ValidationUtils || typeof ValidationUtils.getPeriodInfo !== 'function') {
            missing.push('ValidationUtils.getPeriodInfo');
        }

        if (missing.length > 0) {
            console.warn('TeamQueries: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS - Delegate to ValidationUtils
    // ============================================================

    function parseStrictPositivePeriod(value) {
        if (ValidationUtils && typeof ValidationUtils.parseStrictPositivePeriod === 'function') {
            return ValidationUtils.parseStrictPositivePeriod(value);
        }
        // Emergency fallback
        if (value === undefined || value === null || value === '') return null;
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1) ? num : null;
    }

    function getPeriodInfo(value) {
        if (ValidationUtils && typeof ValidationUtils.getPeriodInfo === 'function') {
            return ValidationUtils.getPeriodInfo(value);
        }
        // Emergency fallback
        if (value === undefined || value === null || value === '') {
            return { present: false, valid: true, value: null };
        }
        var num = parseInt(value, 10);
        return {
            present: true,
            valid: !isNaN(num),
            value: !isNaN(num) ? num : null
        };
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

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    // ============================================================
    // HELPER: Get Team Data from window.data
    // ============================================================

    function getTeamData() {
        var data = window.data || {};
        if (!Array.isArray(data.teams)) {
            data.teams = [];
        }
        return data.teams;
    }

    // ============================================================
    // TEAM TYPE NORMALISATION
    // ============================================================

    /**
     * Normalise a team type to its canonical form.
     * 'internship' is a legacy persisted value and is explicitly migrated
     * to the canonical 'professional' type.
     * Returns null for invalid types.
     * 
     * @param {string} type - Team type
     * @returns {string|null} Canonical type or null
     */
    function normalizeTeamType(type) {
        if (!type) return null;
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
     * 
     * @param {string} type - Team type
     * @returns {boolean} True if valid
     */
    function isValidTeamType(type) {
        if (!type) return false;
        var normalized = String(type).toLowerCase().trim();
        if (normalized === 'internship') return true;
        return VALID_TEAM_TYPES.indexOf(normalized) !== -1;
    }

    /**
     * Get the display label for a team type.
     * 
     * @param {string} type - Team type
     * @returns {string} Human-readable label
     */
    function getTypeLabel(type) {
        var normalized = normalizeTeamType(type);
        var labels = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'civilian': 'Civilian'
        };
        return labels[normalized] || String(type || 'Unknown');
    }

    // ============================================================
    // TEAM PREDICATES
    // ============================================================

    /**
     * Check if a team is operational (not deleted).
     * 
     * @param {object} team - Team object
     * @returns {boolean} True if operational
     */
    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') return false;
        if (!team.status) return true;
        return OPERATIONAL_STATUSES.indexOf(team.status) !== -1;
    }

    /**
     * Check if a team is active.
     * 
     * @param {object} team - Team object
     * @returns {boolean} True if active
     */
    function isTeamActive(team) {
        if (!team || typeof team !== 'object') return false;
        return team.status === 'active';
    }

    /**
     * Check if a team status is valid.
     * 
     * @param {string} status - Team status
     * @returns {boolean} True if valid
     */
    function isValidTeamStatus(status) {
        if (status === undefined || status === null) return false;
        return VALID_TEAM_STATUSES.indexOf(String(status)) !== -1;
    }

    /**
     * Filter an array of teams to only operational teams.
     * 
     * @param {array} teams - Array of team objects
     * @returns {array} Filtered array
     */
    function filterOperationalTeams(teams) {
        if (!Array.isArray(teams)) return [];
        return teams.filter(isTeamOperational);
    }

    // ============================================================
    // TEAM LOOKUP
    // ============================================================

    /**
     * Get a team by ID.
     * 
     * @param {string} teamId - Team ID
     * @returns {object|null} Team object or null
     */
    function getTeamById(teamId) {
        if (!teamId) return null;
        var target = String(teamId);
        var teams = getTeamData();
        for (var i = 0; i < teams.length; i++) {
            var t = teams[i];
            if (t && typeof t === 'object' && String(t.id) === target) {
                return t;
            }
        }
        return null;
    }

    /**
     * Get a team name by ID.
     * 
     * @param {string} teamId - Team ID
     * @returns {string} Team name or 'Unknown Team'
     */
    function getTeamName(teamId) {
        if (!teamId) return 'Unassigned';
        var team = getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    /**
     * Get a team by name (exact match, case-insensitive).
     * 
     * @param {string} name - Team name
     * @returns {object|null} Team object or null
     */
    function getTeamByName(name) {
        if (!name) return null;
        var target = String(name).toLowerCase().trim();
        var teams = getTeamData();
        for (var i = 0; i < teams.length; i++) {
            var t = teams[i];
            if (t && typeof t === 'object') {
                var teamName = String(t.name || '').toLowerCase().trim();
                if (teamName === target) {
                    return t;
                }
            }
        }
        return null;
    }

    // ============================================================
    // TEAM LISTING
    // ============================================================

    /**
     * Get teams, optionally filtered by type and status.
     * 
     * @param {string} type - Team type filter (normalised internally)
     * @param {string} status - Team status filter ('active', 'operational', 'all')
     * @param {boolean} includeDeleted - Include deleted teams (default: false)
     * @returns {array} Array of team objects
     */
    function getTeams(type, status, includeDeleted) {
        var teams = getTeamData();
        var result = teams.slice().filter(function(t) {
            return t && typeof t === 'object';
        });

        // Type filter
        if (type) {
            var normalizedType = normalizeTeamType(type);
            if (normalizedType === null) {
                return [];
            }
            result = result.filter(function(t) {
                return normalizeTeamType(t.type) === normalizedType;
            });
        }

        // Status filter
        if (status === 'active') {
            result = result.filter(isTeamActive);
        } else if (status === 'operational') {
            result = result.filter(isTeamOperational);
        } else if (status === 'all') {
            // No status filter
        }

        // Deleted filter
        if (!includeDeleted) {
            result = result.filter(function(t) {
                return t.status !== 'deleted';
            });
        }

        // Sort by name
        return result.sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Get all operational teams.
     * 
     * @returns {array} Array of operational team objects
     */
    function getAllOperationalTeams() {
        return getTeams(null, 'operational', false);
    }

    /**
     * Get all active teams.
     * 
     * @returns {array} Array of active team objects
     */
    function getAllActiveTeams() {
        return getTeams(null, 'active', false);
    }

    /**
     * Get teams by type with optional status filter.
     * 
     * @param {string} type - Team type
     * @param {string} status - Status filter ('active', 'operational', 'all')
     * @returns {array} Array of team objects
     */
    function getTeamsByType(type, status) {
        if (status === 'active') {
            return getTeams(type, 'operational', false);
        }
        if (status === undefined || status === null || status === '') {
            return getTeams(type, 'all', false);
        }
        if (status === 'operational' || status === 'all') {
            return getTeams(type, status, false);
        }
        return [];
    }

    /**
     * Get teams active during a specific week (academic teams only).
     * 
     * @param {number|string} week - Week number
     * @returns {array} Array of academic team objects active during that week
     */
    function getActiveTeamsForWeek(week) {
        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null) return [];

        var teams = getTeams('academic', 'operational', false);

        return teams.filter(function(team) {
            if (!team || typeof team !== 'object') return false;

            var start = parseStrictPositivePeriod(team.startPeriod);
            if (start === null) return false;
            if (start > weekNum) return false;

            var endInfo = getPeriodInfo(team.endPeriod);
            if (endInfo.present && !endInfo.valid) return false;
            if (!endInfo.present) return true;
            return endInfo.value >= weekNum;
        });
    }

    // ============================================================
    // PERIOD VALIDATION
    // ============================================================

    /**
     * Validate a period for a team type.
     * 
     * @param {string|number} period - Period to validate
     * @param {string} teamType - Team type
     * @returns {boolean} True if valid
     */
    function isValidPeriod(period, teamType) {
        if (!hasPeriodValue(period)) return false;

        var num = parseNumericPeriod(period);
        if (num === null) return false;

        var normalizedType = normalizeTeamType(teamType);
        if (normalizedType === 'academic') {
            return num >= MIN_WEEK && num <= MAX_WEEK;
        }
        return num >= MIN_YEAR && num <= MAX_YEAR;
    }

    /**
     * Get the valid period range for a team type.
     * 
     * @param {string} teamType - Team type
     * @returns {object} { min, max, label }
     */
    function getPeriodRange(teamType) {
        var normalizedType = normalizeTeamType(teamType);
        if (normalizedType === 'academic') {
            return {
                min: MIN_WEEK,
                max: MAX_WEEK,
                label: 'Week',
                minLabel: String(MIN_WEEK),
                maxLabel: String(MAX_WEEK)
            };
        }
        return {
            min: MIN_YEAR,
            max: MAX_YEAR,
            label: 'Year',
            minLabel: String(MIN_YEAR),
            maxLabel: String(MAX_YEAR)
        };
    }

    /**
     * Get the current period for a team type.
     * 
     * @param {string} teamType - Team type
     * @returns {number} Current period
     */
    function getCurrentPeriod(teamType) {
        var data = window.data || {};
        var normalizedType = normalizeTeamType(teamType);
        if (normalizedType === 'academic') {
            return data.currentWeek || 1;
        }
        return data.currentYear || DEFAULT_YEAR;
    }

    /**
     * Get the period label for a team type.
     * 
     * @param {string} teamType - Team type
     * @returns {string} Period label
     */
    function getPeriodLabel(teamType) {
        var normalizedType = normalizeTeamType(teamType);
        return normalizedType === 'academic' ? 'Week' : 'Year';
    }

    // ============================================================
    // TEAM MEMBERSHIP
    // ============================================================

    /**
     * Get active members of a team at a given period.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Period (week for academic, year for others)
     * @returns {array} Array of active member objects
     */
    function getActiveTeamMembers(team, period) {
        if (!team || !team.members) return [];
        if (!Array.isArray(team.members)) return [];

        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) return [];

        // Validate period against team type
        if (!isValidPeriod(periodNum, team.type)) {
            return [];
        }

        return team.members.filter(function(member) {
            if (!member || typeof member !== 'object') return false;

            var join = parseStrictPositivePeriod(member.joinPeriod);
            if (join === null) {
                // If join period is invalid, member cannot be considered active
                return false;
            }

            var leaveInfo = getPeriodInfo(member.leavePeriod);
            if (leaveInfo.present && !leaveInfo.valid) {
                // Malformed leave period - exclude
                return false;
            }

            // Member is active if:
            // 1. Joined at or before the period
            // 2. No leave period, or leave period is at or after the period
            if (join > periodNum) return false;
            if (leaveInfo.present && leaveInfo.value < periodNum) return false;

            return true;
        });
    }

    /**
     * Get the count of active members of a team at a given period.
     * 
     * @param {object} team - Team object
     * @param {number|string} period - Period (week for academic, year for others)
     * @returns {number} Count of active members
     */
    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    /**
     * Check if a character is a member of a team at a given period.
     * 
     * @param {object} team - Team object
     * @param {string} characterId - Character ID
     * @param {number|string} period - Period (week for academic, year for others)
     * @returns {boolean} True if the character is an active member
     */
    function isCharacterInTeamAtPeriod(team, characterId, period) {
        if (!team || !characterId) return false;
        var members = getActiveTeamMembers(team, period);
        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (member && String(member.characterId) === String(characterId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get a specific member of a team by character ID.
     * 
     * @param {object} team - Team object
     * @param {string} characterId - Character ID
     * @returns {object|null} Member object or null
     */
    function getTeamMember(team, characterId) {
        if (!team || !team.members || !Array.isArray(team.members)) return null;
        var target = String(characterId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object' && String(member.characterId) === target) {
                return member;
            }
        }
        return null;
    }

    /**
     * Get all teams a character is a member of at a given period.
     * 
     * @param {string} characterId - Character ID
     * @param {number|string} period - Period (week for academic, year for others)
     * @param {string} teamType - Optional team type filter
     * @returns {array} Array of team objects
     */
    function getTeamsForCharacter(characterId, period, teamType) {
        if (!characterId) return [];

        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) return [];

        var teams = getTeamData();
        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') continue;
            if (!isTeamOperational(team)) continue;

            if (teamType) {
                var normalizedType = normalizeTeamType(teamType);
                if (normalizedType !== null && normalizeTeamType(team.type) !== normalizedType) {
                    continue;
                }
            }

            if (isCharacterInTeamAtPeriod(team, characterId, periodNum)) {
                result.push(team);
            }
        }

        return result.sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Get the number of teams a character is a member of at a given period.
     * 
     * @param {string} characterId - Character ID
     * @param {number|string} period - Period (week for academic, year for others)
     * @param {string} teamType - Optional team type filter
     * @returns {number} Count of teams
     */
    function getTeamCountForCharacter(characterId, period, teamType) {
        return getTeamsForCharacter(characterId, period, teamType).length;
    }

    // ============================================================
    // MEMBER STATUS - Historical timeline
    // ============================================================

    /**
     * Get the status of a member at a given period.
     * Returns: 'active', 'future', 'left', 'deceased', 'eliminated', 'unknown'
     * 
     * @param {object} member - Member object
     * @param {number|string} period - Period (week for academic, year for others)
     * @param {string} teamType - Team type
     * @returns {string} Status string
     */
    function getMemberStatusAtPeriod(member, period, teamType) {
        if (!member || typeof member !== 'object') return 'unknown';

        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) return 'unknown';

        // Check if member has a valid join period
        var join = parseStrictPositivePeriod(member.joinPeriod);
        if (join === null) return 'unknown';

        // Future member: join is in the future
        if (join > periodNum) return 'future';

        // Check leave period
        var leaveInfo = getPeriodInfo(member.leavePeriod);
        if (leaveInfo.present && !leaveInfo.valid) return 'unknown';

        // If no leave period, member is active
        if (!leaveInfo.present) return 'active';

        // leavePeriod is INCLUSIVE: member remains active during leavePeriod
        if (leaveInfo.value >= periodNum) return 'active';

        // Otherwise, they've left
        return 'left';
    }

    /**
     * Get the status info for UI display.
     * 
     * @param {string} status - Status string
     * @returns {object} { label, color }
     */
    function getMemberStatusInfo(status) {
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

    // ============================================================
    // TEAM PERIOD DISPLAY
    // ============================================================

    /**
     * Get a formatted period display string for a team.
     * 
     * @param {object} team - Team object
     * @returns {string} Formatted period display
     */
    function getTeamPeriodDisplay(team) {
        if (!team) return '-';

        var normalizedType = normalizeTeamType(team.type);
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (normalizedType === 'academic') {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            } else if (start) {
                return 'From Wk ' + start;
            }
            return '-';
        } else {
            if (start && end) {
                return start + ' - ' + end;
            } else if (start) {
                return 'From ' + start;
            }
            return '-';
        }
    }

    // ============================================================
    // TEAM CLASS HELPERS
    // ============================================================

    /**
     * Get the class display name for an academic team.
     * 
     * @param {object} team - Team object
     * @returns {string|null} Class display name or null
     */
    function getTeamClassDisplayName(team) {
        if (!team || team.type !== 'academic') return null;
        if (!team.classId) return null;

        if (window.ClassesQueries && typeof window.ClassesQueries.getClassDisplayName === 'function') {
            return window.ClassesQueries.getClassDisplayName(team.classId);
        }
        return null;
    }

    /**
     * Get all teams for a class.
     * 
     * @param {string} classId - Class ID
     * @param {string} status - Status filter ('active', 'operational', 'all')
     * @returns {array} Array of team objects
     */
    function getTeamsByClass(classId, status) {
        if (!classId) return [];

        var teams = getTeams(null, status || 'operational', false);
        var target = String(classId);

        return teams.filter(function(team) {
            return team && team.type === 'academic' && String(team.classId) === target;
        }).sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    // ============================================================
    // MISSION HELPERS
    // ============================================================

    /**
     * Get the mission name for a team's temporary mission.
     * 
     * @param {object} team - Team object
     * @returns {string|null} Mission name or null
     */
    function getTeamMissionName(team) {
        if (!team || !team.temporaryMission) return null;

        var data = window.data || {};
        var missions = Array.isArray(data.missions) ? data.missions : [];
        var target = String(team.temporaryMission);

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m && typeof m === 'object' && String(m.id) === target) {
                return m.title || 'Unknown Mission';
            }
        }
        return null;
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    /**
     * Get the current rank for a team.
     * 
     * @param {object} team - Team object
     * @returns {string} Current rank (empty string if none)
     */
    function getTeamCurrentRank(team) {
        if (!team) return '';
        if (team.rankingHistory && Array.isArray(team.rankingHistory) && team.rankingHistory.length > 0) {
            // Sort by period and get the latest
            var sorted = team.rankingHistory.slice().sort(function(a, b) {
                var aPeriod = parseNumericPeriod(a.period);
                var bPeriod = parseNumericPeriod(b.period);
                if (aPeriod !== null && bPeriod !== null) return aPeriod - bPeriod;
                return String(a.period).localeCompare(String(b.period));
            });
            var latest = sorted[sorted.length - 1];
            return latest ? String(latest.rank) : '';
        }
        return team.currentRank || '';
    }

    /**
     * Get the sorted ranking history for a team.
     * 
     * @param {object} team - Team object
     * @returns {array} Sorted ranking history
     */
    function getSortedRankings(team) {
        if (!team || !team.rankingHistory || !Array.isArray(team.rankingHistory)) return [];

        return team.rankingHistory.slice().filter(function(r) {
            return r && r.period && r.rank && parseNumericPeriod(r.rank) !== null;
        }).sort(function(a, b) {
            var aPeriod = parseNumericPeriod(a.period);
            var bPeriod = parseNumericPeriod(b.period);
            if (aPeriod !== null && bPeriod !== null) return aPeriod - bPeriod;
            return String(a.period).localeCompare(String(b.period));
        });
    }

    /**
     * Get the ranking at a specific period.
     * 
     * @param {object} team - Team object
     * @param {string|number} period - Period
     * @returns {number|null} Rank at that period, or null if not found
     */
    function getTeamRankAtPeriod(team, period) {
        if (!team || !team.rankingHistory || !Array.isArray(team.rankingHistory)) return null;
        var periodStr = String(period).trim();
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var r = team.rankingHistory[i];
            if (r && String(r.period) === periodStr) {
                var rank = parseNumericPeriod(r.rank);
                return rank !== null ? rank : null;
            }
        }
        return null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamQueries = {
        // Type normalisation
        normalizeTeamType: normalizeTeamType,
        isValidTeamType: isValidTeamType,
        getTypeLabel: getTypeLabel,

        // Predicates
        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isValidTeamStatus: isValidTeamStatus,
        filterOperationalTeams: filterOperationalTeams,

        // Lookup
        getTeamById: getTeamById,
        getTeamName: getTeamName,
        getTeamByName: getTeamByName,

        // Listing
        getTeams: getTeams,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getTeamsByType: getTeamsByType,
        getActiveTeamsForWeek: getActiveTeamsForWeek,

        // Period validation
        isValidPeriod: isValidPeriod,
        getPeriodRange: getPeriodRange,
        getCurrentPeriod: getCurrentPeriod,
        getPeriodLabel: getPeriodLabel,
        getTeamPeriodDisplay: getTeamPeriodDisplay,

        // Membership
        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,
        isCharacterInTeamAtPeriod: isCharacterInTeamAtPeriod,
        getTeamMember: getTeamMember,
        getTeamsForCharacter: getTeamsForCharacter,
        getTeamCountForCharacter: getTeamCountForCharacter,
        getMemberStatusAtPeriod: getMemberStatusAtPeriod,
        getMemberStatusInfo: getMemberStatusInfo,

        // Class helpers
        getTeamClassDisplayName: getTeamClassDisplayName,
        getTeamsByClass: getTeamsByClass,

        // Mission helpers
        getTeamMissionName: getTeamMissionName,

        // Ranking helpers
        getTeamCurrentRank: getTeamCurrentRank,
        getSortedRankings: getSortedRankings,
        getTeamRankAtPeriod: getTeamRankAtPeriod,

        // Constants
        VALID_TEAM_TYPES: VALID_TEAM_TYPES,
        VALID_TEAM_STATUSES: VALID_TEAM_STATUSES,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR
    };

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from CoreUtils to TeamQueries.
    // They will be removed in a future version.

    window.getTeamById = getTeamById;
    window.getTeamName = getTeamName;
    window.getTeams = getTeams;
    window.getActiveTeamsForWeek = getActiveTeamsForWeek;
    window.getAllOperationalTeams = getAllOperationalTeams;
    window.getAllActiveTeams = getAllActiveTeams;
    window.getTeamsByType = getTeamsByType;
    window.getActiveTeamMembers = getActiveTeamMembers;
    window.getActiveTeamMemberCount = getActiveTeamMemberCount;
    window.isTeamOperational = isTeamOperational;
    window.isTeamActiveCompat = isTeamActive;
    window.isTeamStatusActive = isTeamActive;
    window.isValidTeamStatus = isValidTeamStatus;
    window.filterOperationalTeams = filterOperationalTeams;

})();
