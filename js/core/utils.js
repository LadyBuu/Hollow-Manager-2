/**
 * js/core/utils.js - Utility Functions
 * Shared helper functions used across the application
 * Path: js/core/utils.js
 * 
 * IMPORTANT: 
 * - All getter functions are PURE - they do NOT mutate data.
 * - Getters return LIVE REFERENCES to domain objects. Callers MUST NOT mutate
 *   returned objects directly. Use explicit setter functions for mutations.
 * - Collection getters return NEW ARRAYS containing live domain-object references.
 * - The array itself is safe to mutate (e.g., push/pop), but the objects inside
 *   are live references. Mutating them mutates window.data.
 * - Deleted/archived objects may still be returned by direct ID lookup but are
 *   excluded from all operational/list queries.
 * 
 * PERSISTENCE CONTRACT:
 * - Mutators modify window.data in memory.
 * - Callers are responsible for calling saveData() to persist changes.
 * - This gives callers control over save timing and batch operations.
 * - All mutators will initialise missing data structures as needed.
 * - Mutators do NOT show UI dialogs or confirmations. That is the caller's responsibility.
 * - All mutators return { success: boolean, changed: boolean, message?: string, ... }
 * - 'changed' indicates whether the mutation actually modified any data.
 * 
 * PERIOD PARSING SEMANTICS:
 * - Missing values (undefined, null, empty string) = "not present"
 * - Invalid values (non-numeric, malformed) = "invalid"
 * - Valid values = parsed numeric value
 * - Missing is treated differently from invalid throughout the codebase.
 * 
 * TEAM STATUS SEMANTICS:
 *   - 'active': Explicitly active (literal status === 'active')
 *   - 'inactive': Temporarily non-operational
 *   - 'deprecated': Legacy/non-operational
 *   - 'deleted': Permanently removed
 *   - undefined/null/empty: Treated as operational for legacy compatibility
 *   - unknown values: Treated as operational for legacy compatibility
 * 
 * OPERATIONAL TEAM PREDICATE:
 *   A team is "operational" if it is not deleted, inactive, or deprecated.
 *   Unknown statuses are treated as operational for backward compatibility.
 *   This is used for all list/collection queries.
 */

// ============================================================
// TYPE HELPERS
// ============================================================

function isObject(value) {
    return value !== null &&
           typeof value === 'object' &&
           !Array.isArray(value);
}

function isSafeInteger(value) {
    return Number.isSafeInteger(value);
}

function isPositiveInteger(value) {
    return isSafeInteger(value) && value >= 1;
}

// ============================================================
// PERIOD PARSING - Strict integer-string parsing
// ============================================================

/**
 * Parse an optional period value (year, week, or other numeric period).
 * Returns null for invalid or missing values.
 * Strict integer-string parsing: rejects partial matches like "12abc".
 * Rejects unsafe integers (larger than Number.MAX_SAFE_INTEGER).
 * Domain bounds (e.g., 1-52 for weeks) are NOT enforced here.
 */
function parseOptionalPeriod(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    
    var str = String(value).trim();
    if (!/^\d+$/.test(str)) {
        return null;
    }
    
    var parsed = Number(str);
    if (!isSafeInteger(parsed)) {
        return null;
    }
    
    return parsed;
}

/**
 * Parse a positive period value with a fallback.
 * Returns the fallback for invalid, zero, or negative values.
 * Strict integer-string parsing: rejects partial matches like "12abc".
 */
function parsePositivePeriod(value, fallback) {
    var parsed = parseOptionalPeriod(value);
    return (parsed !== null && parsed >= 1) ? parsed : fallback;
}

/**
 * Strict parse: returns null for invalid, zero, or negative values.
 * Strict integer-string parsing: rejects partial matches like "12abc".
 */
function parseStrictPositivePeriod(value) {
    var parsed = parseOptionalPeriod(value);
    return (parsed !== null && parsed >= 1) ? parsed : null;
}

/**
 * Check if a period value is present (not undefined, null, or empty string).
 * Use this to distinguish "missing" from "invalid" periods.
 */
function hasPeriodValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Get period information: distinguishes between missing, invalid, and valid.
 * Returns { present: boolean, valid: boolean, value: number|null }
 */
function getPeriodInfo(value) {
    if (!hasPeriodValue(value)) {
        return { present: false, valid: true, value: null };
    }
    
    var parsed = parseOptionalPeriod(value);
    return {
        present: true,
        valid: parsed !== null,
        value: parsed
    };
}

// ============================================================
// ID GENERATION
// ============================================================

function generateId(prefix) {
    prefix = prefix || 'id';
    
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return prefix + '_' + window.crypto.randomUUID();
    }
    
    return prefix + '_' +
           Date.now() + '_' +
           Math.random().toString(36).slice(2, 10);
}

// ============================================================
// WEEK / PERIOD HELPERS
// ============================================================

function getWeekBlock(weekNum) {
    var num = parsePositivePeriod(weekNum, 1);
    var start = Math.floor((num - 1) / 2) * 2 + 1;
    return {
        start: start,
        end: start + 1,
        label: start + '-' + (start + 1)
    };
}

function getRankingBlock(period) {
    var num = parseStrictPositivePeriod(period);
    if (num === null) return null;
    return getWeekBlock(num);
}

// ============================================================
// SCHEDULE KEY GENERATION - Centralised
// ============================================================

/**
 * Generate a deterministic key for schedule entries.
 * All parameters are stringified to avoid type-based collisions.
 * This function does NOT validate inputs; validation occurs at the setter boundary.
 */
function getScheduleKey(studentId, week, day, hour) {
    return JSON.stringify([
        String(studentId),
        String(week),
        String(day),
        String(hour)
    ]);
}

// ============================================================
// SCHEDULE SLOT VALIDATION - Shared setter validation
// ============================================================

/**
 * Validate a schedule slot for setters.
 * Returns normalised, validated values on success.
 * 
 * @returns { 
 *   success: boolean, 
 *   message?: string, 
 *   studentId?: string, 
 *   week?: number,
 *   day?: string,
 *   hour?: string 
 * }
 */
function validateScheduleSlot(studentId, week, day, hour) {
    if (studentId === undefined || studentId === null || String(studentId).trim() === '') {
        return { success: false, message: 'Student ID is required.' };
    }
    var normalisedStudentId = String(studentId).trim();
    
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) {
        return { success: false, message: 'Valid week is required.' };
    }
    
    if (day === undefined || day === null || String(day).trim() === '') {
        return { success: false, message: 'Day is required.' };
    }
    var normalisedDay = String(day).trim();
    
    if (hour === undefined || hour === null || String(hour).trim() === '') {
        return { success: false, message: 'Hour is required.' };
    }
    var normalisedHour = String(hour).trim();
    
    return {
        success: true,
        studentId: normalisedStudentId,
        week: weekNum,
        day: normalisedDay,
        hour: normalisedHour
    };
}

// ============================================================
// OPERATIONAL TEAM PREDICATES - Single source of truth
// ============================================================

/**
 * Determines if a team is operational (active and not deleted/inactive/deprecated).
 * Missing status is treated as operational for backward compatibility.
 * Unknown statuses are treated as operational (fail-open for legacy data).
 * 
 * This is a DELIBERATE "fail open" policy. Any unrecognised status is
 * considered operational. This preserves legacy data but means typos
 * (e.g., "actve") will not be detected. If you need strict validation,
 * use isTeamStatusActive() for literal checks.
 * 
 * Note: This is for READING data. Writing/importing data should use
 * strict validation to prevent new garbage from entering the system.
 */
function isTeamOperational(team) {
    if (!team || typeof team !== 'object') return false;
    
    // If status is undefined/null/empty, treat as active (legacy data)
    if (!team.status) return true;
    
    // Known non-operational statuses
    if (team.status === 'deleted' || 
        team.status === 'inactive' || 
        team.status === 'deprecated') {
        return false;
    }
    
    // Any other status (including unknown) is treated as operational
    // This is a fail-open policy for backward compatibility
    return true;
}

/**
 * Determines if a team is active according to current compatibility semantics.
 * Treats missing status as active for backward compatibility.
 * For literal status === 'active' checks, use isTeamStatusActive().
 */
function isTeamActiveCompat(team) {
    if (!team || typeof team !== 'object') return false;
    if (!team.status) return true;
    return team.status === 'active';
}

/**
 * Literal status check: returns true only for status === 'active'.
 * Use this when you need the literal status value, not the compatibility semantics.
 */
function isTeamStatusActive(team) {
    if (!team || typeof team !== 'object') return false;
    return team.status === 'active';
}

/**
 * Strict validation for team status values when writing/importing.
 * This is fail-closed: unknown values are rejected.
 */
function isValidTeamStatus(status) {
    if (status === undefined || status === null) return false;
    var validStatuses = ['active', 'inactive', 'deprecated', 'deleted'];
    return validStatuses.indexOf(String(status)) !== -1;
}

/**
 * Filter teams to only operational ones.
 */
function filterOperationalTeams(teams) {
    if (!Array.isArray(teams)) return [];
    return teams.filter(isTeamOperational);
}

// ============================================================
// ACTIVITY LOGGING - Internal helper
// ============================================================

/**
 * Internal activity logging. This is a side effect of mutations.
 * The caller is still responsible for saveData().
 * Exposed as window._logActivity to avoid conflict with any external logActivity.
 */
function logActivity(message, type) {
    type = type || 'info';
    
    if (message === undefined || message === null) {
        return;
    }
    
    message = String(message);
    
    if (!window.data || typeof window.data !== 'object') {
        window.data = {};
    }
    
    if (!Array.isArray(window.data.activities)) {
        window.data.activities = [];
    }
    
    window.data.activities.unshift({
        id: generateId(),
        message: message,
        type: type,
        timestamp: new Date().toISOString()
    });
    
    if (window.data.activities.length > 100) {
        window.data.activities.length = 100;
    }
    
    console.log('[' + type + ']', message);
}

function recordActivity(message, type) {
    if (typeof window._logActivity !== 'function') return;
    
    try {
        window._logActivity(message, type);
    } catch (error) {
        console.error('Activity logging failed:', error);
    }
}

// ============================================================
// CHARACTER QUERIES - PURE GETTERS (no mutation)
// ============================================================

function calculateAge(char) {
    if (!char || typeof char !== 'object') return null;
    
    var birthYear = parseStrictPositivePeriod(char.birthYear);
    if (birthYear === null) return null;
    
    var currentYear = window.data
        ? parseStrictPositivePeriod(window.data.currentYear)
        : null;
    
    if (currentYear === null) {
        currentYear = new Date().getFullYear();
    }
    
    if (birthYear > currentYear) return null;
    
    if (char.deceased) {
        // Validate deathAge before using it
        var deathAge = parseStrictPositivePeriod(char.deathAge);
        if (deathAge !== null) return deathAge;
        
        var deathYear = parseStrictPositivePeriod(char.deathYear);
        if (deathYear !== null) {
            if (deathYear < birthYear) return null;
            return deathYear - birthYear;
        }
        
        return null;
    }
    
    return currentYear - birthYear;
}

function getCharacterAge(char) {
    var age = calculateAge(char);
    return age !== null ? age + ' yrs' : '-';
}

function getDisplayName(char) {
    if (!char || typeof char !== 'object') return 'Unknown';
    
    var firstName = String(char.firstName || '').trim();
    var lastName = String(char.lastName || '').trim();
    var nickname = String(char.nickname || '').trim();
    var alias = String(char.alias || '').trim();
    var format = char.nameFormat || 'firstlast';
    
    switch (format) {
        case 'lastfirst':
            if (lastName && firstName) return lastName + ', ' + firstName;
            return lastName || firstName || 'Unknown';
        
        case 'nicklast':
            return [nickname || firstName, lastName]
                .filter(Boolean)
                .join(' ') || 'Unknown';
        
        case 'firstnick':
            if (!firstName && !nickname) {
                return lastName || 'Unknown';
            }
            
            if (!nickname) {
                return [firstName, lastName].filter(Boolean).join(' ');
            }
            
            return firstName
                ? firstName + ' "' + nickname + '"' + (lastName ? ' ' + lastName : '')
                : '"' + nickname + '"' + (lastName ? ' ' + lastName : '');
        
        case 'alias':
            return alias || [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
        
        case 'firstlast':
        default:
            return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
    }
}

function getFullName(char) {
    if (!char || typeof char !== 'object') return 'Unknown';
    
    var parts = [
        char.firstName,
        char.middleName,
        char.lastName
    ].filter(function(part) {
        return part !== undefined &&
               part !== null &&
               String(part).trim() !== '';
    }).map(function(part) {
        return String(part).trim();
    });
    
    return parts.length ? parts.join(' ') : 'Unknown';
}

function getNicknameOrFirstName(char) {
    if (!char || typeof char !== 'object') return 'Unknown';
    
    var nickname = String(char.nickname || '').trim();
    var firstName = String(char.firstName || '').trim();
    
    return nickname || firstName || 'Unknown';
}

/**
 * Get the current status of a character at the current year.
 * DETERMINISTIC: Statuses are ranked by:
 * 1. Active statuses (covering current year) beat inactive (past) statuses
 * 2. Among active statuses, latest endYear wins (ongoing = Infinity)
 * 3. If endYear ties, latest startYear wins
 * 4. If still tied, first in array order wins
 * 
 * STATUS SEMANTICS:
 * - If a status has no endYear, it is considered current (ongoing, endYear = Infinity)
 * - Invalid endYear values are treated as errors (skipped)
 * - Invalid startYear values are skipped
 * - If no status covers the current year, the most recent past status is used (with " (Former)" suffix)
 * - If no status exists at all, returns 'Civilian'
 * - Malformed status entries (missing 'status' field) are silently skipped
 */
function getCurrentStatus(char) {
    if (!char || !char.careerStatus || char.careerStatus.length === 0) {
        return 'Civilian';
    }
    
    var currentYear = window.data
        ? parseStrictPositivePeriod(window.data.currentYear)
        : null;
    
    if (currentYear === null) {
        currentYear = new Date().getFullYear();
    }
    
    var bestStatus = 'Civilian';
    var bestScore = {
        isActive: false,
        endYear: -Infinity,
        startYear: -Infinity,
        index: Infinity
    };

    char.careerStatus.forEach(function(status, index) {
        // Skip malformed entries
        if (!status || !status.status) return;
        
        var start = parseStrictPositivePeriod(status.startYear);
        if (start === null || start > currentYear) return;
        
        var endInfo = getPeriodInfo(status.endYear);
        
        // Invalid endYear means "we don't know what this record says"
        // Skip it rather than treating as ongoing
        if (endInfo.present && !endInfo.valid) return;
        
        var isActive = (!endInfo.present || currentYear <= endInfo.value);
        var endYear = endInfo.present ? endInfo.value : Infinity;
        
        // Score comparison: active > inactive, then endYear desc, then startYear desc, then index asc
        var isBetter = false;
        
        if (isActive !== bestScore.isActive) {
            isBetter = isActive;
        } else if (endYear !== bestScore.endYear) {
            isBetter = endYear > bestScore.endYear;
        } else if (start !== bestScore.startYear) {
            isBetter = start > bestScore.startYear;
        } else {
            isBetter = index < bestScore.index;
        }
        
        if (isBetter) {
            bestScore = {
                isActive: isActive,
                endYear: endYear,
                startYear: start,
                index: index
            };
            var statusName = String(status.status);
            bestStatus = statusName.charAt(0).toUpperCase() + statusName.slice(1);
        }
    });
    
    // If we found an active status, return it
    if (bestScore.isActive) {
        return bestStatus;
    }
    
    // If we found a past status (inactive), return it with "(Former)" suffix
    if (bestScore.endYear > -Infinity) {
        return bestStatus + ' (Former)';
    }
    
    // No status found at all
    return 'Civilian';
}

/**
 * Get count of teams a character is currently active in at a given period.
 * Uses canonical getActiveTeamMembers() for consistent membership semantics.
 * 
 * @param {string} charId - Character ID
 * @param {number|string} period - Week (academic) or Year (other types)
 * @returns {number} Count of active teams (0 if none or invalid)
 */
function getCharacterTeamCount(charId, period) {
    var count = 0;
    var teams = window.data ? window.data.teams : [];
    if (!Array.isArray(teams)) return 0;
    
    var periodNum = parseStrictPositivePeriod(period);
    if (periodNum === null) {
        return 0;
    }
    
    teams.forEach(function(team) {
        if (!team || typeof team !== 'object') return;
        
        // Only count operational teams
        if (!isTeamOperational(team)) return;
        
        var activeMembers = getActiveTeamMembers(team, periodNum);
        if (activeMembers.some(function(member) {
            return member && String(member.characterId) === String(charId);
        })) {
            count++;
        }
    });
    
    return count;
}

function getCharacterNameById(charId) {
    if (!charId) return 'Unknown';
    var chars = window.data ? window.data.characters : [];
    if (!Array.isArray(chars)) return 'Unknown';
    var char = chars.find(function(c) {
        return c && String(c.id) === String(charId);
    });
    if (char) {
        return getDisplayName(char);
    }
    return 'Unknown';
}

function getCharacterById(charId) {
    if (!charId) return null;
    var target = String(charId);
    var chars = window.data ? window.data.characters : [];
    if (!Array.isArray(chars)) return null;
    return chars.find(function(c) {
        return c && typeof c === 'object' && String(c.id) === target;
    }) || null;
}

// ============================================================
// TEAM QUERIES - PURE GETTERS (no mutation)
// ============================================================

/**
 * Get a team by ID. Returns deleted teams as well (for data integrity).
 * Operational queries should use getTeams() with filtering.
 */
function getTeamById(teamId) {
    if (!teamId) return null;
    var target = String(teamId);
    var teams = window.data ? window.data.teams : [];
    if (!Array.isArray(teams)) return null;
    return teams.find(function(t) {
        return t && typeof t === 'object' && String(t.id) === target;
    }) || null;
}

/**
 * Get a team's name. Returns name even for deleted teams.
 */
function getTeamName(teamId) {
    if (!teamId) return 'Unassigned';
    var team = getTeamById(teamId);
    return team ? team.name : 'Unknown Team';
}

/**
 * Get teams filtered by type and status.
 * 
 * @param {string} type - Team type (academic, professional, temporary, civilian)
 * @param {string} status - Filter mode:
 *   - 'active': Only teams with status === 'active' (literal active)
 *   - 'operational': Teams that are not deleted/inactive/deprecated (compatibility active)
 *   - 'all': All non-deleted teams (regardless of status)
 * @param {boolean} includeDeleted - If true, deleted teams are not excluded by the
 *        final deleted-team filter. Status filters may still exclude them.
 * @returns {array} New array containing live team references, sorted by name
 */
function getTeams(type, status, includeDeleted) {
    var teams = window.data ? window.data.teams : [];
    if (!Array.isArray(teams)) return [];
    
    var result = teams.slice().filter(function(t) {
        return t && typeof t === 'object';
    });
    
    // Filter by type
    if (type) {
        result = result.filter(function(t) { return t.type === type; });
    }
    
    // Filter by status
    if (status === 'active') {
        // Literal status === 'active'
        result = result.filter(isTeamStatusActive);
    } else if (status === 'operational') {
        // Compatibility: not deleted/inactive/deprecated
        result = result.filter(isTeamOperational);
    } else if (status === 'all') {
        // No additional filtering (but deleted may still be excluded below)
    }
    
    // Optionally exclude deleted
    if (!includeDeleted) {
        result = result.filter(function(t) { return t.status !== 'deleted'; });
    }
    
    // Hardened sort: handle malformed records
    return result.sort(function(a, b) {
        var nameA = String(a.name || '');
        var nameB = String(b.name || '');
        return nameA.localeCompare(nameB);
    });
}

/**
 * Get operational teams (not deleted, inactive, or deprecated).
 * Note: "operational" means not deleted/inactive/deprecated, NOT literal status === 'active'.
 * For literal status === 'active', use getTeams(type, 'active', false).
 */
function getAllOperationalTeams() {
    return getTeams(null, 'operational', false);
}

/**
 * @deprecated Use getAllOperationalTeams() for clarity, or getTeams(type, 'active', false)
 * for literal status === 'active'. This name is preserved for backward compatibility.
 */
function getAllActiveTeams() {
    return getAllOperationalTeams();
}

/**
 * Get teams active during a specific week (academic teams only).
 * This checks exact week membership, not week blocks.
 * Invalid endPeriod values are treated as errors (team is excluded).
 * Missing endPeriod values are treated as ongoing.
 */
function getActiveTeamsForWeek(week) {
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) return [];
    
    var teams = getTeams('academic', 'operational', false);
    
    return teams.filter(function(team) {
        if (!team || typeof team !== 'object') return false;
        
        var start = parseStrictPositivePeriod(team.startPeriod);
        if (start === null) return false;
        
        // Team hasn't started yet
        if (start > weekNum) return false;
        
        var endInfo = getPeriodInfo(team.endPeriod);
        
        // If end is provided but invalid, exclude the team
        if (endInfo.present && !endInfo.valid) return false;
        
        // Missing end = ongoing
        if (!endInfo.present) return true;
        
        // Valid end = bounded
        return endInfo.value >= weekNum;
    });
}

/**
 * Get teams by type with optional status filter.
 * 
 * WARNING: For backward compatibility, 'active' is mapped to 'operational',
 * NOT literal status === 'active'. If you need literal status filtering,
 * use getTeams(type, 'active', false) directly.
 * Unknown status values return empty array (fail-closed).
 * 
 * @deprecated Use getTeams(type, 'operational', false) or getTeams(type, 'active', false)
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
    
    // Unknown status: fail closed rather than returning all
    return [];
}

/**
 * Get active members of a team at a given period.
 * PURE: Does not mutate the team or any data.
 * Invalid leavePeriod values exclude the member (fail-closed).
 * Missing leavePeriod means ongoing.
 * 
 * @param {object} team - Team object
 * @param {number|string} period - Week (academic) or Year (other types)
 * @returns {array} Array of active members (references to original members)
 */
function getActiveTeamMembers(team, period) {
    if (!team || !team.members) return [];
    if (!Array.isArray(team.members)) return [];
    
    var periodNum = parseStrictPositivePeriod(period);
    if (periodNum === null) {
        return [];
    }
    
    return team.members.filter(function(member) {
        if (!member || typeof member !== 'object') return false;
        
        var join = parseStrictPositivePeriod(member.joinPeriod);
        if (join === null) return false;
        
        var leaveInfo = getPeriodInfo(member.leavePeriod);
        
        // Invalid leave = exclude (we don't know what it means)
        if (leaveInfo.present && !leaveInfo.valid) return false;
        
        // Missing leave = ongoing
        if (!leaveInfo.present) return join <= periodNum;
        
        // Valid leave = bounded
        return join <= periodNum && leaveInfo.value >= periodNum;
    });
}

/**
 * Get active member count for a team at a given period.
 * 
 * @param {object} team - Team object
 * @param {number|string} period - Week (academic) or Year (other types)
 * @returns {number} Count of active members
 */
function getActiveTeamMemberCount(team, period) {
    return getActiveTeamMembers(team, period).length;
}

// ============================================================
// STUDENT / INSTRUCTOR QUERIES - PURE GETTERS (no mutation)
// ============================================================

/**
 * Get current students (trainees, rookies, juniors).
 * Uses exact status matching to exclude former statuses like "Trainee (Former)".
 */
function getStudents() {
    if (!window.data || !window.data.characters) return [];
    if (!Array.isArray(window.data.characters)) return [];
    return window.data.characters.filter(function(c) {
        if (!c || typeof c !== 'object') return false;
        if (c.deceased) return false;
        
        var status = getCurrentStatus(c).toLowerCase();
        
        // Exact matching: "Trainee (Former)" does NOT match
        return status === 'trainee' ||
               status === 'rookie' ||
               status === 'junior' ||
               status === 'student';
    }).sort(function(a, b) {
        return getDisplayName(a).localeCompare(getDisplayName(b));
    });
}

/**
 * Get current instructors.
 * Uses exact status matching to exclude former statuses like "Instructor (Former)".
 */
function getInstructors() {
    if (!window.data || !window.data.characters) return [];
    if (!Array.isArray(window.data.characters)) return [];
    return window.data.characters.filter(function(c) {
        if (!c || typeof c !== 'object') return false;
        if (c.deceased) return false;
        
        var status = getCurrentStatus(c).toLowerCase();
        
        // Exact matching: "Instructor (Former)" does NOT match
        // 'senior' is intentionally included here as an instructor rank.
        // If your domain uses 'senior' for other roles, adjust this filter.
        return status === 'instructor' ||
               status === 'teacher' ||
               status === 'professor' ||
               status === 'senior';
    }).sort(function(a, b) {
        return getDisplayName(a).localeCompare(getDisplayName(b));
    });
}

function getNonCivilianCharacters() {
    if (!window.data || !window.data.characters) return [];
    if (!Array.isArray(window.data.characters)) return [];
    return window.data.characters.filter(function(c) {
        if (!c || typeof c !== 'object') return false;
        if (c.deceased) return false;
        var status = getCurrentStatus(c).toLowerCase();
        return status !== 'civilian';
    }).sort(function(a, b) {
        return getDisplayName(a).localeCompare(getDisplayName(b));
    });
}

// ============================================================
// SCHEDULE QUERIES - PURE GETTERS (no mutation)
// ============================================================

/**
 * Get a student's schedule for a specific week.
 * PURE: Returns an empty object if no schedule exists.
 * Does NOT create any data structures.
 * 
 * Returns the existing live schedule object if one exists.
 * If no schedule exists, returns a new empty object that is NOT attached to window.data.
 * 
 * Use setStudentSchedule() for schedule mutations.
 * 
 * @param {string} studentId - Character ID
 * @param {number|string} week - Week number (strict: must be a valid positive integer)
 * @returns {object} Schedule object (empty if none exists or week is invalid)
 */
function getStudentSchedule(studentId, week) {
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) {
        return {};
    }
    
    var data = window.data || {};
    if (!data.curriculum || !data.curriculum.schedules) {
        return {};
    }
    
    var studentSchedule = data.curriculum.schedules[studentId];
    if (!studentSchedule) {
        return {};
    }
    
    var weekSchedule = studentSchedule[weekNum];
    if (!weekSchedule) {
        return {};
    }
    
    return weekSchedule;
}

/**
 * Set a student's schedule for a specific week.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Initialises missing data structures using ensureCurriculumStructure().
 * 
 * @param {string} studentId - Character ID
 * @param {number|string} week - Week number (strict: must be a valid positive integer)
 * @param {object} scheduleData - Schedule data to set (must be a plain object)
 * @returns {object} { success: boolean, changed: boolean, message?: string }
 */
function setStudentSchedule(studentId, week, scheduleData) {
    if (studentId === undefined || studentId === null || String(studentId).trim() === '') {
        return { success: false, changed: false, message: 'Student ID is required.' };
    }
    var studentKey = String(studentId).trim();
    
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) {
        return { success: false, changed: false, message: 'Valid week is required.' };
    }
    
    if (!isObject(scheduleData)) {
        return { success: false, changed: false, message: 'Schedule data must be an object.' };
    }
    
    var data = ensureCurriculumStructure();
    
    if (!data.curriculum.schedules[studentKey]) {
        data.curriculum.schedules[studentKey] = {};
    }
    
    var existing = data.curriculum.schedules[studentKey][weekNum];
    
    // Check if anything actually changed
    var changed = true;
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(scheduleData)) {
        changed = false;
    }
    
    data.curriculum.schedules[studentKey][weekNum] = scheduleData;
    window.data = data;
    
    return { success: true, changed: changed };
}

function isCharacterEliminated(charId, week) {
    var char = getCharacterById(charId);
    if (!char) return false;
    if (char.deceased) return true;
    
    if (char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks) && char.eliminatedWeeks.length > 0) {
        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null) return false;
        for (var i = 0; i < char.eliminatedWeeks.length; i++) {
            var elimWeek = parseStrictPositivePeriod(char.eliminatedWeeks[i]);
            if (elimWeek !== null && elimWeek <= weekNum) {
                return true;
            }
        }
    }
    return false;
}

function getEliminatedCharacters(week) {
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) return [];
    
    var result = [];
    var chars = window.data ? window.data.characters : [];
    if (!Array.isArray(chars)) return result;
    chars.forEach(function(char) {
        if (isCharacterEliminated(char.id, weekNum)) {
            result.push(char.id);
        }
    });
    return result;
}

// ============================================================
// DISCIPLINE QUERIES - PURE GETTERS (no mutation)
// ============================================================

function getDiscipline(id) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.disciplines) return null;
    if (!Array.isArray(window.data.curriculum.disciplines)) return null;
    return window.data.curriculum.disciplines.find(function(d) {
        return d && String(d.id) === String(id);
    }) || null;
}

function getAvailableDisciplines(week) {
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) return [];
    
    if (!window.data || !window.data.curriculum || !Array.isArray(window.data.curriculum.disciplines)) {
        return [];
    }
    
    return window.data.curriculum.disciplines.filter(function(d) {
        if (!d || typeof d !== 'object') return false;
        
        var start = parseStrictPositivePeriod(d.startWeek);
        if (start === null) return false;
        
        var endInfo = getPeriodInfo(d.endWeek);
        
        // Invalid end = exclude
        if (endInfo.present && !endInfo.valid) return false;
        
        // Missing end = ongoing
        if (!endInfo.present) return start <= weekNum;
        
        // Valid end = bounded
        return start <= weekNum && endInfo.value >= weekNum;
    });
}

// ============================================================
// TOURNAMENT HELPERS
// ============================================================

/**
 * Get a participant's display name.
 * Uses canonical lookup functions for consistency.
 * IDs are normalised to strings before lookup.
 */
function getParticipantName(participant) {
    if (!participant) return 'Unknown';

    // Simple string ID lookup
    if (typeof participant === 'string') {
        var team = getTeamById(participant);
        if (team) return team.name;

        var char = getCharacterById(participant);
        if (char) return getDisplayName(char);

        return participant;
    }

    // Object with type and id
    if (participant.type === 'char' || participant.type === 'character') {
        var char = getCharacterById(participant.id);
        return char ? getDisplayName(char) : 'Unknown Character';
    }

    if (participant.type === 'team') {
        var team = getTeamById(participant.id);
        return team ? team.name : 'Unknown Team';
    }

    return 'Unknown';
}

// ============================================================
// CLASS FUNCTIONS - PURE GETTERS (no mutation)
// ============================================================

function getClasses() {
    var data = window.data || {};
    if (!data.classes) {
        return [];
    }
    if (!Array.isArray(data.classes)) {
        return [];
    }
    // Hardened: handle malformed records
    return data.classes.slice().filter(function(c) {
        return c && typeof c === 'object';
    }).sort(function(a, b) {
        var nameA = String(a.name || '');
        var nameB = String(b.name || '');
        return nameA.localeCompare(nameB);
    });
}

function getClass(id) {
    if (!id) return null;
    var target = String(id);
    var data = window.data || {};
    if (!data.classes) return null;
    if (!Array.isArray(data.classes)) return null;
    return data.classes.find(function(c) {
        return c && typeof c === 'object' && String(c.id) === target;
    }) || null;
}

function getClassByName(name) {
    if (!name) return null;
    var data = window.data || {};
    if (!data.classes) return null;
    if (!Array.isArray(data.classes)) return null;
    var target = String(name).toLowerCase();
    return data.classes.find(function(c) {
        if (!c || typeof c !== 'object') return false;
        var className = String(c.name || '');
        return className.toLowerCase() === target;
    }) || null;
}

function getCharactersByClass(classId) {
    if (!classId) return [];
    var target = String(classId);
    var data = window.data || {};
    if (!data.characters) return [];
    if (!Array.isArray(data.characters)) return [];
    return data.characters.filter(function(c) {
        return c &&
               typeof c === 'object' &&
               Array.isArray(c.classIds) &&
               c.classIds.some(function(cid) {
                   return String(cid) === target;
               });
    });
}

function getTeamsByClass(classId) {
    if (!classId) return [];
    var target = String(classId);
    var data = window.data || {};
    if (!data.teams) return [];
    if (!Array.isArray(data.teams)) return [];
    return data.teams.filter(function(t) {
        return t &&
               typeof t === 'object' &&
               t.type === 'academic' &&
               String(t.classId) === target &&
               isTeamOperational(t);
    });
}

function getAvailableStudentsForClass(classId, week) {
    if (!classId) return [];
    var weekNum = parseStrictPositivePeriod(week);
    if (weekNum === null) return [];
    
    var data = window.data || {};
    
    var classChars = getCharactersByClass(classId);
    
    var available = classChars.filter(function(char) {
        if (!char || typeof char !== 'object') return false;
        if (char.deceased) return false;
        
        // Check if already eliminated
        if (isCharacterEliminated(char.id, weekNum)) {
            return false;
        }
        
        // Check if already in a team - use canonical active member logic
        if (data.teams && Array.isArray(data.teams)) {
            var occupied = data.teams.some(function(team) {
                if (!team || typeof team !== 'object') return false;
                if (team.type !== 'academic') return false;
                if (!isTeamOperational(team)) return false;
                if (String(team.classId) !== String(classId)) return false;
                
                return getActiveTeamMembers(team, weekNum).some(function(member) {
                    return member && String(member.characterId) === String(char.id);
                });
            });
            
            if (occupied) return false;
        }
        
        return true;
    });
    
    return available;
}

function getClassOptions() {
    var classes = getClasses();
    var options = [];
    classes.forEach(function(c) {
        var count = getCharactersByClass(c.id).length;
        options.push({
            id: c.id,
            name: c.name,
            count: count
        });
    });
    return options;
}

function getClassDisplayName(classId) {
    var cls = getClass(classId);
    return cls ? cls.name : 'Unassigned';
}

function getCharacterClasses(char) {
    if (!char || !char.classIds) return [];
    if (!Array.isArray(char.classIds)) return [];
    var classes = getClasses();
    return classes.filter(function(c) {
        return char.classIds.some(function(cid) { return String(cid) === String(c.id); });
    });
}

function getCharacterClassNames(char) {
    var classes = getCharacterClasses(char);
    return classes.map(function(c) { return c.name; });
}

// ============================================================
// CURRICULUM STRUCTURE INITIALISATION - Internal helper
// ============================================================

/**
 * Ensure curriculum data structures exist and are the correct type.
 * Internal helper used by all setters.
 */
function ensureCurriculumStructure() {
    var data = window.data || {};
    
    if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
        data.curriculum = {};
    }
    
    if (!data.curriculum.classInstructors ||
        typeof data.curriculum.classInstructors !== 'object' ||
        Array.isArray(data.curriculum.classInstructors)) {
        data.curriculum.classInstructors = Object.create(null);
    }
    
    if (!data.curriculum.classLabels ||
        typeof data.curriculum.classLabels !== 'object' ||
        Array.isArray(data.curriculum.classLabels)) {
        data.curriculum.classLabels = Object.create(null);
    }
    
    if (!data.curriculum.classGroupLabels ||
        typeof data.curriculum.classGroupLabels !== 'object' ||
        Array.isArray(data.curriculum.classGroupLabels)) {
        data.curriculum.classGroupLabels = Object.create(null);
    }
    
    if (!data.curriculum.classDurations ||
        typeof data.curriculum.classDurations !== 'object' ||
        Array.isArray(data.curriculum.classDurations)) {
        data.curriculum.classDurations = Object.create(null);
    }
    
    if (!data.curriculum.schedules ||
        typeof data.curriculum.schedules !== 'object' ||
        Array.isArray(data.curriculum.schedules)) {
        data.curriculum.schedules = {};
    }
    
    window.data = data;
    return data;
}

// ============================================================
// CLASS MUTATIONS - Explicit setters (memory only, caller saves)
// ============================================================

/**
 * Create a new class.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Does NOT show UI confirmations. Caller is responsible for confirmation.
 * 
 * @param {string} name - Class name (will be normalised to string)
 * @returns {object} { success: boolean, changed: boolean, message: string, class: object }
 */
function createClass(name) {
    // Normalise and validate input
    if (name === undefined || name === null || String(name).trim() === '') {
        return { success: false, changed: false, message: 'Class name is required.' };
    }
    var target = String(name).trim();
    
    var data = window.data || {};
    if (!data.classes) data.classes = [];
    if (!Array.isArray(data.classes)) {
        return { success: false, changed: false, message: 'Classes data is corrupted.' };
    }
    
    var existing = data.classes.find(function(c) {
        if (!c || typeof c !== 'object') return false;
        var className = String(c.name || '');
        return className.toLowerCase() === target.toLowerCase();
    });
    if (existing) {
        return { success: false, changed: false, message: 'A class with this name already exists.' };
    }
    
    var newClass = {
        id: generateId('class'),
        name: target,
        createdAt: new Date().toISOString()
    };
    
    data.classes.push(newClass);
    window.data = data;
    
    recordActivity('Created class: ' + newClass.name);
    
    return { success: true, changed: true, class: newClass };
}

/**
 * Delete a class permanently.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Does NOT show UI confirmations. Caller is responsible for confirmation.
 * 
 * This function returns detailed information about affected entities.
 * If affected entities exist and confirmed is false, it returns without mutating.
 * 
 * Note: Malformed/null class records are preserved in the collection.
 * 
 * @param {string} id - Class ID
 * @param {boolean} confirmed - Whether the caller has confirmed the deletion
 * @returns {object} {
 *   success: boolean,
 *   changed: boolean,
 *   message: string,
 *   affectedCharacters: array,
 *   affectedTeams: array,
 *   needsConfirmation: boolean
 * }
 */
function deleteClass(id, confirmed) {
    confirmed = confirmed === true;
    
    if (!id) return { 
        success: false, 
        changed: false,
        message: 'Class ID is required.',
        affectedCharacters: [],
        affectedTeams: [],
        needsConfirmation: false
    };
    
    var data = window.data || {};
    if (!data.classes) return { 
        success: false, 
        changed: false,
        message: 'No classes found.',
        affectedCharacters: [],
        affectedTeams: [],
        needsConfirmation: false
    };
    if (!Array.isArray(data.classes)) {
        return { 
            success: false, 
            changed: false,
            message: 'Classes data is corrupted.',
            affectedCharacters: [],
            affectedTeams: [],
            needsConfirmation: false
        };
    }
    
    var target = String(id);
    var cls = data.classes.find(function(c) {
        return c && typeof c === 'object' && String(c.id) === target;
    });
    if (!cls) {
        return { 
            success: false, 
            changed: false,
            message: 'Class not found.',
            affectedCharacters: [],
            affectedTeams: [],
            needsConfirmation: false
        };
    }
    
    var affectedCharacters = data.characters && Array.isArray(data.characters) 
        ? data.characters.filter(function(c) {
            return c &&
                   typeof c === 'object' &&
                   Array.isArray(c.classIds) &&
                   c.classIds.some(function(cid) { return String(cid) === target; });
        }).map(function(c) {
            return { id: c.id, name: getDisplayName(c) };
        })
        : [];
    
    var affectedTeams = data.teams && Array.isArray(data.teams) 
        ? data.teams.filter(function(t) {
            return t &&
                   typeof t === 'object' &&
                   t.type === 'academic' &&
                   String(t.classId) === target;
        }).map(function(t) {
            return { id: t.id, name: t.name || 'Unknown' };
        })
        : [];
    
    var hasAffectedEntities = affectedCharacters.length > 0 || affectedTeams.length > 0;
    
    // If there are affected entities and deletion is not confirmed, return without mutating
    if (hasAffectedEntities && !confirmed) {
        return {
            success: false,
            changed: false,
            message: 'Confirmation required. This class has ' + 
                     affectedCharacters.length + ' characters and ' + 
                     affectedTeams.length + ' teams assigned.',
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams,
            needsConfirmation: true
        };
    }
    
    // Perform the mutation
    // Clean up references
    affectedCharacters.forEach(function(char) {
        var fullChar = data.characters.find(function(c) {
            return c &&
                   typeof c === 'object' &&
                   String(c.id) === String(char.id);
        });
        if (fullChar) {
            fullChar.classIds = fullChar.classIds.filter(function(cid) { return String(cid) !== target; });
        }
    });
    
    affectedTeams.forEach(function(team) {
        var fullTeam = data.teams.find(function(t) {
            return t &&
                   typeof t === 'object' &&
                   String(t.id) === String(team.id);
        });
        if (fullTeam) {
            fullTeam.classId = null;
        }
    });
    
    // Preserve malformed records rather than silently destroying unrelated data
    data.classes = data.classes.filter(function(c) {
        return !c || String(c.id) !== target;
    });
    window.data = data;
    
    recordActivity('Deleted class: ' + cls.name);
    
    return {
        success: true,
        changed: true,
        message: 'Class deleted successfully.',
        affectedCharacters: affectedCharacters,
        affectedTeams: affectedTeams,
        needsConfirmation: false
    };
}

/**
 * Add a character to a class.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * 
 * @param {string} charId - Character ID
 * @param {string} classId - Class ID
 * @returns {object} { success: boolean, changed: boolean, message: string }
 */
function addCharacterToClass(charId, classId) {
    if (!charId || !classId) return { success: false, changed: false, message: 'Character and class are required.' };
    
    var data = window.data || {};
    if (!data.characters || !Array.isArray(data.characters)) {
        return { success: false, changed: false, message: 'No characters found.' };
    }
    
    var char = data.characters.find(function(c) {
        return c && typeof c === 'object' && String(c.id) === String(charId);
    });
    if (!char) {
        return { success: false, changed: false, message: 'Character not found.' };
    }
    
    var cls = getClass(classId);
    if (!cls) {
        return { success: false, changed: false, message: 'Class not found.' };
    }
    
    // Handle classIds carefully: missing = initialise, malformed = reject
    if (char.classIds === undefined || char.classIds === null) {
        char.classIds = [];
    } else if (!Array.isArray(char.classIds)) {
        return { success: false, changed: false, message: 'Character class data is corrupted.' };
    }
    
    if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
        return { success: false, changed: false, message: 'Character is already in this class.' };
    }
    
    char.classIds.push(classId);
    window.data = data;
    
    recordActivity('Added ' + getDisplayName(char) + ' to class: ' + cls.name);
    
    return { success: true, changed: true, message: 'Character added to class.' };
}

/**
 * Remove a character from a class.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * 
 * Note: This does NOT initialise missing classIds. Missing means "not in any class".
 * 
 * @param {string} charId - Character ID
 * @param {string} classId - Class ID
 * @returns {object} { success: boolean, changed: boolean, message: string }
 */
function removeCharacterFromClass(charId, classId) {
    if (!charId || !classId) return { success: false, changed: false, message: 'Character and class are required.' };
    
    var data = window.data || {};
    if (!data.characters || !Array.isArray(data.characters)) {
        return { success: false, changed: false, message: 'No characters found.' };
    }
    
    var char = data.characters.find(function(c) {
        return c && typeof c === 'object' && String(c.id) === String(charId);
    });
    if (!char) {
        return { success: false, changed: false, message: 'Character not found.' };
    }
    
    // Missing classIds means the character is not in any class
    if (char.classIds === undefined || char.classIds === null) {
        return { success: false, changed: false, message: 'Character is not in this class.' };
    }
    
    if (!Array.isArray(char.classIds)) {
        return { success: false, changed: false, message: 'Character class data is corrupted.' };
    }
    
    if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
        return { success: false, changed: false, message: 'Character is not in this class.' };
    }
    
    char.classIds = char.classIds.filter(function(cid) { return String(cid) !== String(classId); });
    window.data = data;
    
    recordActivity('Removed ' + getDisplayName(char) + ' from class: ' + getClassDisplayName(classId));
    
    return { success: true, changed: true, message: 'Character removed from class.' };
}

// ============================================================
// CLASS SCHEDULE HELPERS - PURE GETTERS (no mutation)
// ============================================================

function getClassInstructor(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classInstructors) return null;
    var key = getScheduleKey(studentId, week, day, hour);
    var value = window.data.curriculum.classInstructors[key];
    return value !== undefined ? value : null;
}

/**
 * Set class instructor.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Initialises missing data structures as needed.
 * 
 * @returns {object} { success: boolean, changed: boolean, message?: string }
 */
function setClassInstructor(studentId, week, day, hour, instructorId) {
    var validation = validateScheduleSlot(studentId, week, day, hour);
    if (!validation.success) {
        return { success: false, changed: false, message: validation.message };
    }
    
    var data = ensureCurriculumStructure();
    var key = getScheduleKey(
        validation.studentId,
        validation.week,
        validation.day,
        validation.hour
    );
    
    var existing = data.curriculum.classInstructors[key];
    var newValue = instructorId || null;
    
    if (existing === newValue) {
        return { success: true, changed: false };
    }
    
    if (newValue) {
        data.curriculum.classInstructors[key] = newValue;
    } else {
        delete data.curriculum.classInstructors[key];
    }
    
    window.data = data;
    return { success: true, changed: true };
}

function getClassLabel(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classLabels) return null;
    var key = getScheduleKey(studentId, week, day, hour);
    var value = window.data.curriculum.classLabels[key];
    return value !== undefined ? value : null;
}

/**
 * Set class label.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Initialises missing data structures as needed.
 * 
 * @returns {object} { success: boolean, changed: boolean, message?: string }
 */
function setClassLabel(studentId, week, day, hour, label) {
    var validation = validateScheduleSlot(studentId, week, day, hour);
    if (!validation.success) {
        return { success: false, changed: false, message: validation.message };
    }
    
    var data = ensureCurriculumStructure();
    var key = getScheduleKey(
        validation.studentId,
        validation.week,
        validation.day,
        validation.hour
    );
    
    var existing = data.curriculum.classLabels[key];
    var newValue = (label !== undefined && label !== null && String(label).trim() !== '')
        ? String(label)
        : null;
    
    if (existing === newValue) {
        return { success: true, changed: false };
    }
    
    if (newValue !== null) {
        data.curriculum.classLabels[key] = newValue;
    } else {
        delete data.curriculum.classLabels[key];
    }
    
    window.data = data;
    return { success: true, changed: true };
}

function getClassGroupLabel(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classGroupLabels) return null;
    var key = getScheduleKey(studentId, week, day, hour);
    var value = window.data.curriculum.classGroupLabels[key];
    return value !== undefined ? value : null;
}

/**
 * Set class group label.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Initialises missing data structures as needed.
 * 
 * @returns {object} { success: boolean, changed: boolean, message?: string }
 */
function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
    var validation = validateScheduleSlot(studentId, week, day, hour);
    if (!validation.success) {
        return { success: false, changed: false, message: validation.message };
    }
    
    var data = ensureCurriculumStructure();
    var key = getScheduleKey(
        validation.studentId,
        validation.week,
        validation.day,
        validation.hour
    );
    
    var existing = data.curriculum.classGroupLabels[key];
    var newValue = (groupLabel !== undefined && groupLabel !== null && String(groupLabel).trim() !== '')
        ? String(groupLabel)
        : null;
    
    if (existing === newValue) {
        return { success: true, changed: false };
    }
    
    if (newValue !== null) {
        data.curriculum.classGroupLabels[key] = newValue;
    } else {
        delete data.curriculum.classGroupLabels[key];
    }
    
    window.data = data;
    return { success: true, changed: true };
}

function getClassDuration(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classDurations) return null;
    var key = getScheduleKey(studentId, week, day, hour);
    var value = window.data.curriculum.classDurations[key];
    return value !== undefined ? value : null;
}

/**
 * Set class duration.
 * Mutator: Modifies window.data in memory. Caller must saveData() to persist.
 * Initialises missing data structures as needed.
 * Duration must be a positive number (integer or decimal).
 * 
 * @returns {object} { success: boolean, changed: boolean, message?: string }
 */
function setClassDuration(studentId, week, day, hour, duration) {
    var validation = validateScheduleSlot(studentId, week, day, hour);
    if (!validation.success) {
        return { success: false, changed: false, message: validation.message };
    }
    
    // Validate duration - strict, rejects "12abc"
    var numDuration;
    var hasValue = duration !== undefined && duration !== null && String(duration).trim() !== '';
    
    if (hasValue) {
        numDuration = Number(duration);
        
        if (!Number.isFinite(numDuration) || numDuration <= 0) {
            return {
                success: false,
                changed: false,
                message: 'Duration must be a positive number.'
            };
        }
    }
    
    var data = ensureCurriculumStructure();
    var key = getScheduleKey(
        validation.studentId,
        validation.week,
        validation.day,
        validation.hour
    );
    
    var existing = data.curriculum.classDurations[key];
    var newValue = hasValue && numDuration > 0 ? numDuration : null;
    
    if (existing === newValue) {
        return { success: true, changed: false };
    }
    
    if (newValue !== null) {
        data.curriculum.classDurations[key] = newValue;
    } else {
        delete data.curriculum.classDurations[key];
    }
    
    window.data = data;
    return { success: true, changed: true };
}

// ============================================================
// RANDOM GENERATORS
// ============================================================

function generateRandomStats() {
    return {
        str: Math.floor(Math.random() * 13) + 6,
        dex: Math.floor(Math.random() * 13) + 6,
        con: Math.floor(Math.random() * 13) + 6,
        int: Math.floor(Math.random() * 13) + 6,
        wis: Math.floor(Math.random() * 13) + 6,
        cha: Math.floor(Math.random() * 13) + 6
    };
}

function generateRandomMagic() {
    var magic = {};
    var types = ['earth','water','fire','air','metal','wood',
                 'blood','bone','mind','morphic','life','death',
                 'space','time','dimension','void','reality','transference'];
    types.forEach(function(key) {
        var roll = Math.random();
        if (roll < 0.4) {
            magic[key] = 0;
        } else if (roll < 0.7) {
            magic[key] = Math.floor(Math.random() * 4) + 1;
        } else if (roll < 0.9) {
            magic[key] = Math.floor(Math.random() * 4) + 5;
        } else {
            magic[key] = Math.floor(Math.random() * 3) + 9; // 9-11
        }
    });
    return magic;
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    var date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return 'N/A';
    }
    
    return date.toLocaleDateString();
}

function truncateString(str, length) {
    if (str === undefined || str === null) return '';
    
    str = String(str);
    
    if (!Number.isFinite(length) || length < 0) {
        return str;
    }
    
    if (str.length <= length) return str;
    
    return str.substring(0, length) + '...';
}

function debounce(func, wait) {
    var timeout;
    
    var debounced = function() {
        var context = this;
        var args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(context, args);
        }, wait);
    };
    
    debounced.cancel = function() {
        clearTimeout(timeout);
        timeout = null;
    };
    
    return debounced;
}

// ============================================================
// EXPOSE ALL FUNCTIONS
// ============================================================

// Type helpers
window.isObject = isObject;
window.isSafeInteger = isSafeInteger;
window.isPositiveInteger = isPositiveInteger;

// ID & Period
window.generateId = generateId;
window.parseOptionalPeriod = parseOptionalPeriod;
window.parsePositivePeriod = parsePositivePeriod;
window.parseStrictPositivePeriod = parseStrictPositivePeriod;
window.hasPeriodValue = hasPeriodValue;
window.getPeriodInfo = getPeriodInfo;
window.getWeekBlock = getWeekBlock;
window.getRankingBlock = getRankingBlock;

// Schedule keys and validation
window.getScheduleKey = getScheduleKey;
window.validateScheduleSlot = validateScheduleSlot;

// Team predicates
window.isTeamOperational = isTeamOperational;
window.isTeamActiveCompat = isTeamActiveCompat;
window.isTeamStatusActive = isTeamStatusActive;
window.isValidTeamStatus = isValidTeamStatus;
window.filterOperationalTeams = filterOperationalTeams;

// Activity logging
window._logActivity = logActivity;
window.recordActivity = recordActivity;

// Character queries
window.calculateAge = calculateAge;
window.getCharacterAge = getCharacterAge;
window.getDisplayName = getDisplayName;
window.getFullName = getFullName;
window.getNicknameOrFirstName = getNicknameOrFirstName;
window.getCurrentStatus = getCurrentStatus;
window.getCharacterTeamCount = getCharacterTeamCount;
window.getCharacterNameById = getCharacterNameById;
window.getCharacterById = getCharacterById;

// Team queries
window.getTeamById = getTeamById;
window.getTeamName = getTeamName;
window.getTeams = getTeams;
window.getActiveTeamsForWeek = getActiveTeamsForWeek;
window.getAllOperationalTeams = getAllOperationalTeams;
window.getAllActiveTeams = getAllActiveTeams; // Deprecated alias
window.getTeamsByType = getTeamsByType; // Deprecated
window.getActiveTeamMembers = getActiveTeamMembers;
window.getActiveTeamMemberCount = getActiveTeamMemberCount;

// Discipline queries
window.getDiscipline = getDiscipline;
window.getAvailableDisciplines = getAvailableDisciplines;

// Student/Instructor queries
window.getStudents = getStudents;
window.getInstructors = getInstructors;
window.getNonCivilianCharacters = getNonCivilianCharacters;

// Schedule queries
window.getStudentSchedule = getStudentSchedule;
window.setStudentSchedule = setStudentSchedule;

// Elimination queries
window.isCharacterEliminated = isCharacterEliminated;
window.getEliminatedCharacters = getEliminatedCharacters;

// Tournament helpers
window.getParticipantName = getParticipantName;

// Class functions
window.getClasses = getClasses;
window.getClass = getClass;
window.getClassByName = getClassByName;
window.getCharactersByClass = getCharactersByClass;
window.getTeamsByClass = getTeamsByClass;
window.getAvailableStudentsForClass = getAvailableStudentsForClass;
window.getClassOptions = getClassOptions;
window.getClassDisplayName = getClassDisplayName;
window.getCharacterClasses = getCharacterClasses;
window.getCharacterClassNames = getCharacterClassNames;

// Class mutations (memory only, caller saves)
window.createClass = createClass;
window.deleteClass = deleteClass;
window.addCharacterToClass = addCharacterToClass;
window.removeCharacterFromClass = removeCharacterFromClass;

// Class schedule functions
window.getClassInstructor = getClassInstructor;
window.setClassInstructor = setClassInstructor;
window.getClassLabel = getClassLabel;
window.setClassLabel = setClassLabel;
window.getClassGroupLabel = getClassGroupLabel;
window.setClassGroupLabel = setClassGroupLabel;
window.getClassDuration = getClassDuration;
window.setClassDuration = setClassDuration;

// Random generators
window.generateRandomStats = generateRandomStats;
window.generateRandomMagic = generateRandomMagic;

// Formatting
window.formatDate = formatDate;
window.truncateString = truncateString;
window.debounce = debounce;
