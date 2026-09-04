/**
 * modules/characters/character-queries.js - Character Queries
 * Read-only character domain queries
 * Path: js/modules/characters/character-queries.js
 * 
 * This module provides:
 *   - Character lookup (by ID, by name)
 *   - Character display name formatting (getDisplayName, getFullName, etc.)
 *   - Age calculation
 *   - Current status determination
 *   - Student/instructor classification
 *   - Character lists (students, instructors, non-civilian)
 *   - Character stats and magic (read-only)
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Uses ValidationUtils for period parsing
 *   - Uses CharacterConstants for stat/magic definitions
 *   - Returns LIVE REFERENCES to characters (no cloning by default)
 *   - Callers should NOT mutate returned objects
 *   - getCharacterTeamCount() has been MOVED to TeamQueries
 * 
 * DEPENDENCIES:
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CALENDAR_CONSTANTS (from constants.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - OPTIONAL
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data.characters is the source of truth for character data
 *   - No caching - always reads fresh from window.data
 *   - Results are live references (not cloned)
 * 
 * USAGE:
 *   var queries = window.CharacterQueries;
 *   var char = queries.getCharacterById('char_123');
 *   var name = queries.getDisplayName(char);
 *   var students = queries.getStudents();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterQueriesLoaded) {
        return;
    }
    window.__characterQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ValidationUtils = window.ValidationUtils;
    var CharacterConstants = window.CharacterConstants;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_KEYS = CharacterConstants ? CharacterConstants.STAT_KEYS : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_DEFAULT = CharacterConstants ? CharacterConstants.STAT_DEFAULT : 10;
    var MAGIC_TYPE_KEYS = CharacterConstants ? CharacterConstants.MAGIC_TYPE_KEYS : [];

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;

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

        // CharacterConstants is MANDATORY
        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }
        if (CharacterConstants && typeof CharacterConstants.STAT_KEYS === 'undefined') {
            missing.push('CharacterConstants.STAT_KEYS');
        }

        // CalendarConstants is MANDATORY
        if (!CalendarConstants) {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            console.warn('CharacterQueries: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS - Delegate to ValidationUtils
    // ============================================================

    function parseStrictPositivePeriod(value) {
        return ValidationUtils.parseStrictPositivePeriod(value);
    }

    function getPeriodInfo(value) {
        return ValidationUtils.getPeriodInfo(value);
    }

    // ============================================================
    // HELPER: Get Character Data from window.data
    // ============================================================

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    // ============================================================
    // CHARACTER LOOKUP
    // ============================================================

    /**
     * Get a character by ID.
     * Returns a LIVE REFERENCE - do not mutate.
     * @param {string} charId - Character ID
     * @returns {object|null} Character object or null
     */
    function getCharacterById(charId) {
        if (!charId) return null;
        var target = String(charId);
        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    /**
     * Get a character's display name by ID.
     * @param {string} charId - Character ID
     * @returns {string} Display name or 'Unknown'
     */
    function getCharacterNameById(charId) {
        if (!charId) return 'Unknown';
        var char = getCharacterById(charId);
        if (char) return getDisplayName(char);
        return 'Unknown';
    }

    // ============================================================
    // DISPLAY NAME FORMATTING
    // ============================================================

    /**
     * Get the display name for a character based on their nameFormat.
     * @param {object} char - Character object
     * @returns {string} Display name
     */
    function getDisplayName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var firstName = String(char.firstName || '').trim();
        var lastName = String(char.lastName || '').trim();
        var middleName = String(char.middleName || '').trim();
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

    /**
     * Get the full legal name for a character.
     * @param {object} char - Character object
     * @returns {string} Full legal name
     */
    function getFullName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var parts = [
            char.firstName,
            char.middleName,
            char.lastName
        ].filter(function(part) {
            return part !== undefined && part !== null && String(part).trim() !== '';
        }).map(function(part) {
            return String(part).trim();
        });
        
        return parts.length ? parts.join(' ') : 'Unknown';
    }

    /**
     * Get the nickname or first name for a character.
     * @param {object} char - Character object
     * @returns {string} Nickname or first name
     */
    function getNicknameOrFirstName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var nickname = String(char.nickname || '').trim();
        var firstName = String(char.firstName || '').trim();
        
        return nickname || firstName || 'Unknown';
    }

    // ============================================================
    // AGE CALCULATION
    // ============================================================

    /**
     * Calculate a character's age.
     * @param {object} char - Character object
     * @returns {number|null} Age in years or null
     */
    function calculateAge(char) {
        if (!char || typeof char !== 'object') return null;
        
        var birthYear = parseStrictPositivePeriod(char.birthYear);
        if (birthYear === null) return null;
        
        var currentYear = getCurrentYear();
        if (currentYear === null) return null;
        
        if (birthYear > currentYear) return null;
        
        if (char.deceased) {
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

    /**
     * Get a formatted age string for a character.
     * @param {object} char - Character object
     * @returns {string} Formatted age string (e.g., '25 yrs' or '-')
     */
    function getCharacterAge(char) {
        var age = calculateAge(char);
        return age !== null ? age + ' yrs' : '-';
    }

    /**
     * Get the application's current year.
     * @returns {number|null} Current year or null
     */
    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        // No fallback to real-world year - fail closed
        return null;
    }

    // ============================================================
    // CURRENT STATUS
    // ============================================================

    /**
     * Get the current career status for a character.
     * @param {object} char - Character object
     * @returns {string} Status string (e.g., 'Trainee', 'Instructor', 'Civilian')
     */
    function getCurrentStatus(char) {
        if (!char || !char.careerStatus || char.careerStatus.length === 0) {
            return 'Civilian';
        }
        
        var currentYear = getCurrentYear();
        if (currentYear === null) {
            // Fail closed - no valid year means no valid status
            return 'Unknown';
        }
        
        var bestStatus = 'Civilian';
        var bestScore = {
            isActive: false,
            endYear: -Infinity,
            startYear: -Infinity,
            index: Infinity
        };

        char.careerStatus.forEach(function(status, index) {
            if (!status || !status.status) return;
            
            var start = parseStrictPositivePeriod(status.startYear);
            if (start === null || start > currentYear) return;
            
            var endInfo = getPeriodInfo(status.endYear);
            if (endInfo.present && !endInfo.valid) return;
            
            var isActive = (!endInfo.present || currentYear <= endInfo.value);
            var endYear = endInfo.present ? endInfo.value : Infinity;
            
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
        
        if (bestScore.isActive) {
            return bestStatus;
        }
        
        if (bestScore.endYear > -Infinity) {
            return bestStatus + ' (Former)';
        }
        
        return 'Civilian';
    }

    // ============================================================
    // STUDENT / INSTRUCTOR CLASSIFICATION
    // ============================================================

    /**
     * Check if a character is a student.
     * @param {object} char - Character object
     * @returns {boolean} True if student
     */
    function isStudent(char) {
        if (!char || typeof char !== 'object') return false;
        if (char.deceased) return false;
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'trainee' ||
               status === 'rookie' ||
               status === 'junior' ||
               status === 'student';
    }

    /**
     * Check if a character is an instructor.
     * @param {object} char - Character object
     * @returns {boolean} True if instructor
     */
    function isInstructor(char) {
        if (!char || typeof char !== 'object') return false;
        if (char.deceased) return false;
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'instructor' ||
               status === 'teacher' ||
               status === 'professor' ||
               status === 'senior';
    }

    /**
     * Check if a character is a civilian.
     * @param {object} char - Character object
     * @returns {boolean} True if civilian
     */
    function isCivilian(char) {
        if (!char || typeof char !== 'object') return false;
        if (char.deceased) return false;
        return getCurrentStatus(char).toLowerCase() === 'civilian';
    }

    // ============================================================
    // CHARACTER LISTS
    // ============================================================

    /**
     * Get all student characters.
     * @returns {Array} Array of student characters (live references)
     */
    function getStudents() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (isStudent(c)) {
                result.push(c);
            }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    /**
     * Get all instructor characters.
     * @returns {Array} Array of instructor characters (live references)
     */
    function getInstructors() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (isInstructor(c)) {
                result.push(c);
            }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    /**
     * Get all non-civilian characters (living, non-civilian).
     * @returns {Array} Array of non-civilian characters (live references)
     */
    function getNonCivilianCharacters() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' && !c.deceased && !isCivilian(c)) {
                result.push(c);
            }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    // ============================================================
    // CHARACTER STATS - Read-only
    // ============================================================

    /**
     * Get a character's stats with defaults.
     * @param {object} char - Character object
     * @returns {object} Stats object with all keys
     */
    function getCharacterStats(char) {
        if (!char) {
            return createDefaultStats();
        }
        if (!char.stats || typeof char.stats !== 'object') {
            return createDefaultStats();
        }
        var stats = char.stats;
        var result = {};
        STAT_KEYS.forEach(function(key) {
            var val = stats[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = val;
            } else {
                result[key] = STAT_DEFAULT;
            }
        });
        return result;
    }

    /**
     * Create a default stats object.
     * @returns {object} Default stats
     */
    function createDefaultStats() {
        var result = {};
        STAT_KEYS.forEach(function(key) {
            result[key] = STAT_DEFAULT;
        });
        return result;
    }

    /**
     * Get a character's magic proficiencies with defaults.
     * @param {object} char - Character object
     * @returns {object} Magic proficiencies object
     */
    function getCharacterMagic(char) {
        if (!char) {
            return createDefaultMagic();
        }
        if (!char.magic || typeof char.magic !== 'object') {
            return createDefaultMagic();
        }
        var magic = char.magic;
        var result = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            var val = magic[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = val;
            } else {
                result[key] = 0;
            }
        });
        return result;
    }

    /**
     * Create a default magic proficiencies object.
     * @returns {object} Default magic
     */
    function createDefaultMagic() {
        var result = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            result[key] = 0;
        });
        return result;
    }

    /**
     * Get a character's special moves.
     * @param {object} char - Character object
     * @returns {object} { physical: [], magical: [] }
     */
    function getCharacterSpecialMoves(char) {
        if (!char || !char.specialMoves || typeof char.specialMoves !== 'object') {
            return { physical: [], magical: [] };
        }
        return {
            physical: Array.isArray(char.specialMoves.physical)
                ? char.specialMoves.physical.slice()
                : [],
            magical: Array.isArray(char.specialMoves.magical)
                ? char.specialMoves.magical.slice()
                : []
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterQueries = {
        // Lookup
        getCharacterById: getCharacterById,
        getCharacterNameById: getCharacterNameById,
        
        // Display names
        getDisplayName: getDisplayName,
        getFullName: getFullName,
        getNicknameOrFirstName: getNicknameOrFirstName,
        
        // Age
        calculateAge: calculateAge,
        getCharacterAge: getCharacterAge,
        getCurrentYear: getCurrentYear,
        
        // Status
        getCurrentStatus: getCurrentStatus,
        isStudent: isStudent,
        isInstructor: isInstructor,
        isCivilian: isCivilian,
        
        // Lists
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,
        
        // Stats (read-only)
        getCharacterStats: getCharacterStats,
        getCharacterMagic: getCharacterMagic,
        getCharacterSpecialMoves: getCharacterSpecialMoves
    };

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from CoreUtils to CharacterQueries.
    // They will be removed in a future version.

    window.getCharacterById = getCharacterById;
    window.getCharacterNameById = getCharacterNameById;
    window.getDisplayName = getDisplayName;
    window.getFullName = getFullName;
    window.getNicknameOrFirstName = getNicknameOrFirstName;
    window.calculateAge = calculateAge;
    window.getCharacterAge = getCharacterAge;
    window.getCurrentStatus = getCurrentStatus;
    window.isStudent = isStudent;
    window.isInstructor = isInstructor;
    window.isCivilian = isCivilian;
    window.getStudents = getStudents;
    window.getInstructors = getInstructors;
    window.getNonCivilianCharacters = getNonCivilianCharacters;

})();
