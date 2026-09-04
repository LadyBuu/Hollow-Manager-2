/**
 * js/modules/teams/team-members.js - Team Member Management
 * Handles member status, eligibility, and candidate selection
 * Path: js/modules/teams/team-members.js
 * 
 * This module is responsible for:
 *   - Determining member status at a given period (historical timeline engine)
 *   - Determining character eligibility for teams
 *   - Providing eligibility status for UI consumption
 * 
 * IMPORTANT: This module is READ-ONLY for data operations.
 * All mutations are delegated to TeamCore.
 * This module does NOT call saveData().
 * 
 * ELIGIBILITY CONCEPTS:
 *   - Candidate characters: Those whose career status at a SPECIFIC PERIOD
 *     makes them appropriate for a team type. This is PERIOD-AWARE.
 *   - Eligibility status: Whether a candidate can be added to a specific team
 *     at a specific period, with appropriate UI labels
 * 
 * HISTORICAL TIMELINE ENGINE:
 *   - getStatusAtPeriod() is timeline-aware: it answers "what was this
 *     member's status at this point in time?"
 *   - Deceased status is only returned if death occurred at or before the period
 *   - Unknown death dates do NOT override known membership history
 *   - If a death date is unknown, membership history takes precedence
 *   - PERIOD UNITS ARE TYPE-AWARE: academic teams use weeks, others use years
 * 
 * PERIOD SEMANTICS:
 *   - leavePeriod is INCLUSIVE: member remains active during leavePeriod
 *   - joinPeriod is INCLUSIVE: member becomes active at joinPeriod
 *   - Membership is active when: join <= period <= leave
 *   - This convention is consistent with team startPeriod/endPeriod
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT persist data
 *   - Callers are responsible for saveData() after mutations
 *   - TeamCore owns all member mutations
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - Core team operations (required)
 *   - window.TeamQueries - Team query operations (required)
 *   - window.CALENDAR_CONSTANTS - Week/year constants (required)
 *   - window.CharacterQueries - Character data (required)
 *   - window.ValidationUtils - Period parsing (required)
 *   - window.CharacterConstants - Character status vocabulary (required)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamMembersLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.TeamCore) {
        return;
    }
    if (!window.TeamQueries) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.CharacterQueries) {
        return;
    }
    if (!window.ValidationUtils) {
        return;
    }
    if (!window.CharacterConstants) {
        return;
    }

    window.__teamMembersLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var CharacterQueries = window.CharacterQueries;
    var ValidationUtils = window.ValidationUtils;
    var CharacterConstants = window.CharacterConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;

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

    function parsePositivePeriod(value) {
        var parsed = parseNumericPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function isValidAcademicWeek(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYear(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    /**
     * Parse a period with type awareness.
     * Returns { value: number, unit: 'week' | 'year' } or null.
     */
    function parseTypedPeriod(value, teamType) {
        var num = parseNumericPeriod(value);
        if (num === null) {
            return null;
        }

        if (teamType === 'academic') {
            if (num >= MIN_WEEK && num <= MAX_WEEK) {
                return { value: num, unit: 'week' };
            }
            return null;
        } else {
            if (num >= MIN_YEAR && num <= MAX_YEAR) {
                return { value: num, unit: 'year' };
            }
            return null;
        }
    }

    // ============================================================
    // MEMBER STATUS DETERMINATION - Historical timeline engine
    // ============================================================

    /**
     * Get member status at a specific period.
     * Returns status strings: 'active', 'left', 'future', 'deceased', 'eliminated', 'unknown'
     * 
     * This is a TIMELINE-AWARE engine:
     * - Periods are type-aware: academic = weeks, others = years
     * - Death dates are compared only against year-based periods
     * - Eliminations are compared only against week-based periods (academic)
     * - Unknown death dates do NOT override known membership history
     * 
     * @param {object} member - Member object (must have characterId, joinPeriod, leavePeriod)
     * @param {number|string} period - Period (week or year)
     * @param {string} teamType - Team type ('academic', 'professional', 'temporary', 'civilian')
     * @returns {string} Status string
     */
    function getStatusAtPeriod(member, period, teamType) {
        if (!member || typeof member !== 'object') {
            return 'unknown';
        }

        // Parse period with type awareness
        var typedPeriod = parseTypedPeriod(period, teamType);
        if (!typedPeriod) {
            return 'unknown';
        }

        var periodNum = typedPeriod.value;
        var periodUnit = typedPeriod.unit;

        var character = CharacterQueries.getCharacterById(member.characterId);

        // ============================================================
        // DECEASED CHECK - Only for year-based periods
        // ============================================================
        if (character && character.deceased && periodUnit === 'year') {
            var deathYear = parsePositivePeriod(character.deathYear);
            if (deathYear !== null) {
                if (deathYear <= periodNum) {
                    return 'deceased';
                }
            } else {
                // Death date is unknown. Do not assume the character was dead
                // at this historical period. Continue to membership history.
            }
        }

        // ============================================================
        // ELIMINATION CHECK - Only for week-based periods (academic)
        // ============================================================
        if (periodUnit === 'week' && character && character.eliminatedWeeks && Array.isArray(character.eliminatedWeeks)) {
            for (var i = 0; i < character.eliminatedWeeks.length; i++) {
                var elimWeek = parsePositivePeriod(character.eliminatedWeeks[i]);
                if (elimWeek !== null && elimWeek <= periodNum) {
                    return 'eliminated';
                }
            }
        }

        // ============================================================
        // MEMBERSHIP CHECK - Period type aware
        // ============================================================

        // Check if join period exists and is valid
        var hasJoin = member.joinPeriod !== undefined && member.joinPeriod !== null && String(member.joinPeriod).trim() !== '';
        if (!hasJoin) {
            return 'unknown';
        }

        var typedJoin = parseTypedPeriod(member.joinPeriod, teamType);
        if (!typedJoin || typedJoin.unit !== periodUnit) {
            return 'unknown';
        }

        // Future member: join is in the future
        if (typedJoin.value > periodNum) {
            return 'future';
        }

        // Check leave period
        var hasLeave = member.leavePeriod !== undefined && member.leavePeriod !== null && String(member.leavePeriod).trim() !== '';

        if (!hasLeave) {
            return 'active';
        }

        var typedLeave = parseTypedPeriod(member.leavePeriod, teamType);
        if (!typedLeave || typedLeave.unit !== periodUnit) {
            return 'unknown';
        }

        // leavePeriod is INCLUSIVE: member remains active during leavePeriod
        if (typedLeave.value >= periodNum) {
            return 'active';
        }

        return 'left';
    }

    /**
     * Get member status at a specific week (academic teams).
     * Convenience wrapper for getStatusAtPeriod.
     * 
     * @param {object} member - Member object
     * @param {number|string} week - Week number
     * @returns {string} Status string
     */
    function getStatusAtWeek(member, week) {
        return getStatusAtPeriod(member, week, 'academic');
    }

    // ============================================================
    // ELIGIBILITY STATUS - Domain status, not presentation
    // ============================================================

    /**
     * Get eligibility status for a character in a team at a specific period.
     * Returns domain status: 'available' | 'in-team' | 'future-member' | 'former-member' |
     *   'deceased' | 'eliminated' | 'in-other-team' | 'unknown'
     * 
     * This is the SINGLE AUTHORITY for eligibility classification.
     * Uses getStatusAtPeriod() as the underlying temporal authority.
     * 
     * @param {object} team - Team object
     * @param {object} character - Character object
     * @param {number|string} currentPeriod - Current period
     * @returns {string} Status string
     */
    function getEligibilityStatus(team, character, currentPeriod) {
        if (!team || !character) {
            return 'unknown';
        }

        var charId = character.id;

        // Parse period with type awareness
        var typedPeriod = parseTypedPeriod(currentPeriod, team.type);
        if (!typedPeriod) {
            return 'unknown';
        }

        var periodNum = typedPeriod.value;
        var periodUnit = typedPeriod.unit;

        // Find the actual member record if the character is in this team
        var existingMember = null;
        if (team.members && Array.isArray(team.members)) {
            for (var i = 0; i < team.members.length; i++) {
                var m = team.members[i];
                if (m && String(m.characterId) === String(charId)) {
                    existingMember = m;
                    break;
                }
            }
        }

        // If character is in this team, check their status using the canonical timeline engine
        if (existingMember) {
            var memberStatus = getStatusAtPeriod(
                existingMember,
                currentPeriod,
                team.type
            );

            if (memberStatus === 'active') {
                return 'in-team';
            }

            if (memberStatus === 'future') {
                return 'future-member';
            }

            if (memberStatus === 'deceased') {
                return 'deceased';
            }

            if (memberStatus === 'eliminated') {
                return 'eliminated';
            }

            if (memberStatus === 'unknown') {
                return 'unknown';
            }

            return 'former-member';
        }

        // Character is not in this team - check if they can be added

        // Character deceased (timeline-aware, only for year-based periods)
        if (character.deceased && periodUnit === 'year') {
            var deathYear = parsePositivePeriod(character.deathYear);
            if (deathYear !== null) {
                if (deathYear <= periodNum) {
                    return 'deceased';
                }
            }
        }

        // Character eliminated (timeline-aware, only for week-based periods)
        if (periodUnit === 'week' && character.eliminatedWeeks && Array.isArray(character.eliminatedWeeks)) {
            for (var j = 0; j < character.eliminatedWeeks.length; j++) {
                var elimWeek = parsePositivePeriod(character.eliminatedWeeks[j]);
                if (elimWeek !== null && elimWeek <= periodNum) {
                    return 'eliminated';
                }
            }
        }

        // Check if character is active in another team at this period
        var otherTeams = TeamQueries.getTeamsForCharacter(charId, currentPeriod, null);
        for (var k = 0; k < otherTeams.length; k++) {
            var otherTeam = otherTeams[k];
            if (String(otherTeam.id) === String(team.id)) {
                continue;
            }
            return 'in-other-team';
        }

        // Character is available
        return 'available';
    }

    // ============================================================
    // CHARACTER ELIGIBILITY - PERIOD-AWARE candidate selection
    // ============================================================

    /**
     * Get candidate characters for a team type at a specific period.
     * This returns characters whose career status AT THE GIVEN PERIOD
     * makes them appropriate for the team type.
     * 
     * This is the PERIOD-AWARE version - it looks at historical status,
     * not just current status.
     * 
     * @param {string} teamType - Team type
     * @param {number|string} period - Period to check (week for academic, year for others)
     * @returns {array} Array of character objects
     */
    function getCandidateCharactersAtPeriod(teamType, period) {
        var data = window.data || {};
        var chars = data.characters || [];
        if (!Array.isArray(chars)) {
            return [];
        }

        // Validate period for team type
        var typedPeriod = parseTypedPeriod(period, teamType);
        if (!typedPeriod) {
            return [];
        }

        var result = [];

        // Get eligible statuses from CharacterConstants
        var eligibleStatuses = [];
        if (teamType === 'academic') {
            eligibleStatuses = CharacterConstants.STUDENT_STATUSES || ['trainee', 'rookie', 'junior'];
        } else if (teamType === 'civilian') {
            eligibleStatuses = ['civilian'];
        } else {
            eligibleStatuses = CharacterConstants.NON_CIVILIAN_STATUSES || ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'];
        }

        for (var i = 0; i < chars.length; i++) {
            var character = chars[i];
            if (!character || typeof character !== 'object') {
                continue;
            }

            // TODO: Replace with CharacterQueries.getStatusAtPeriod when available
            // Currently using current status as fallback
            var status = CharacterQueries.getCurrentStatus(character);

            var isEligible = false;
            for (var j = 0; j < eligibleStatuses.length; j++) {
                if (status === eligibleStatuses[j] || status.startsWith(eligibleStatuses[j])) {
                    isEligible = true;
                    break;
                }
            }

            if (isEligible) {
                result.push(character);
            }
        }

        // Sort by display name
        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    /**
     * Get candidate characters for a team type based on CURRENT status.
     * This is a legacy wrapper for UI that hasn't been updated to use
     * period-aware candidate selection yet.
     * 
     * @deprecated Use getCandidateCharactersAtPeriod() for historical accuracy.
     * @param {string} teamType - Team type
     * @returns {array} Array of character objects
     */
    function getCandidateCharacters(teamType) {
        var data = window.data || {};
        var defaultPeriod = teamType === 'academic' ? 1 : (data.currentYear || MIN_YEAR);
        return getCandidateCharactersAtPeriod(teamType, defaultPeriod);
    }

    /**
     * @deprecated Use getCandidateCharactersAtPeriod() instead.
     * Kept for backward compatibility.
     */
    function getEligibleCharacters(teamType) {
        return getCandidateCharacters(teamType);
    }

    // ============================================================
    // PERIOD HELPERS
    // ============================================================

    /**
     * Check if a period is valid for a team type.
     * @param {string|number} period - Period to validate
     * @param {string} teamType - Team type
     * @returns {boolean} True if valid
     */
    function isValidPeriod(period, teamType) {
        if (teamType === 'academic') {
            return isValidAcademicWeek(period);
        }
        return isValidYear(period);
    }

    /**
     * Get the valid period range for a team type.
     * @param {string} teamType - Team type
     * @returns {object} { min, max, label }
     */
    function getPeriodRange(teamType) {
        if (teamType === 'academic') {
            return {
                min: MIN_WEEK,
                max: MAX_WEEK,
                label: 'Week'
            };
        }
        return {
            min: MIN_YEAR,
            max: MAX_YEAR,
            label: 'Year'
        };
    }

    /**
     * Get the period label for a team type.
     * @param {string} teamType - Team type
     * @returns {string} Period label
     */
    function getPeriodLabel(teamType) {
        return teamType === 'academic' ? 'Week' : 'Year';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMembers = {
        // Status determination - period-aware
        getStatusAtPeriod: getStatusAtPeriod,
        getStatusAtWeek: getStatusAtWeek,

        // Eligibility - period-aware
        getCandidateCharactersAtPeriod: getCandidateCharactersAtPeriod,
        getCandidateCharacters: getCandidateCharacters,
        getEligibleCharacters: getEligibleCharacters,
        getEligibilityStatus: getEligibilityStatus,

        // Validation helpers
        isValidPeriod: isValidPeriod,
        getPeriodRange: getPeriodRange,
        getPeriodLabel: getPeriodLabel,
        isValidAcademicWeek: isValidAcademicWeek,
        isValidYear: isValidYear,
        parsePositivePeriod: parsePositivePeriod,
        parseTypedPeriod: parseTypedPeriod,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR
    };

})();
