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
 *   - Character team count (cross-domain query)
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Uses ValidationUtils for period parsing
 *   - Uses FormatUtils for formatting
 *   - getCharacterTeamCount() is cross-domain (depends on TeamQueries)
 *   - All functions return DEEP CLONED data where appropriate
 * 
 * DEPENDENCIES:
 *   - window.ValidationUtils (from validation-utils.js)
 *   - window.FormatUtils (from format-utils.js)
 *   - window.TeamQueries (from team-queries.js) - optional, for getCharacterTeamCount
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data.characters is the source of truth for character data
 *   - No caching - always reads fresh from window.data
 *   - Results are NOT cloned by default (caller should clone if needed)
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
    // DEPENDENCY IMPORTS
    // ============================================================

    var ValidationUtils = window.ValidationUtils || window;
    var FormatUtils = window.FormatUtils || window;
    var TeamQueries = window.TeamQueries || window;

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

        // FormatUtils is MANDATORY
        if (!FormatUtils || typeof FormatUtils.formatDate !== 'function') {
            missing.push('FormatUtils.formatDate');
        }
        if (!FormatUtils || typeof FormatUtils.truncateString !== 'function') {
            missing.push('FormatUtils.truncateString');
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

    // ============================================================
    // HELPER: Get Character from window.data
    // ============================================================

    function getCharacterData() {
        var data = window.data || {};
        if (!Array.isArray(data.characters)) {
            data.characters = [];
        }
        return data.characters;
    }

    // ============================================================
    // CHARACTER LOOKUP
    // ============================================================

    /**
     * Get a character by ID.
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
        
        var currentYear = window.data
            ? parseStrictPositivePeriod(window.data.currentYear)
            : null;
        
        if (currentYear === null) {
            currentYear = new Date().getFullYear();
        }
        
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
     * @returns {Array} Array of student characters
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
     * @returns {Array} Array of instructor characters
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
     * Get all non-civilian characters.
     * @returns {Array} Array of non-civilian characters
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
    // CROSS-DOMAIN: CHARACTER TEAM COUNT
    // ============================================================

    /**
     * Get the number of teams a character belongs to at a given period.
     * NOTE: This is a cross-domain query that depends on TeamQueries.
     * 
     * @param {string} charId - Character ID
     * @param {number|string} period - Period number
     * @returns {number} Number of teams
     */
    function getCharacterTeamCount(charId, period) {
        if (!charId) return 0;
        
        var count = 0;
        var teams = window.data ? window.data.teams : [];
        if (!Array.isArray(teams)) return 0;
        
        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) return 0;
        
        // Use TeamQueries if available
        if (TeamQueries && typeof TeamQueries.getActiveTeamMembers === 'function') {
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                if (!team || typeof team !== 'object') continue;
                
                // Use TeamQueries for operational check if available
                if (TeamQueries && typeof TeamQueries.isTeamOperational === 'function') {
                    if (!TeamQueries.isTeamOperational(team)) continue;
                } else {
                    // Fallback
                    if (team.status === 'deleted' || team.status === 'inactive' || team.status === 'deprecated') {
                        continue;
                    }
                }
                
                var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
                for (var j = 0; j < activeMembers.length; j++) {
                    var member = activeMembers[j];
                    if (member && String(member.characterId) === String(charId)) {
                        count++;
                        break;
                    }
                }
            }
        } else {
            // Fallback implementation
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                if (!team || typeof team !== 'object') continue;
                if (team.status === 'deleted' || team.status === 'inactive' || team.status === 'deprecated') {
                    continue;
                }
                
                if (!team.members || !Array.isArray(team.members)) continue;
                
                for (var j = 0; j < team.members.length; j++) {
                    var member = team.members[j];
                    if (!member || typeof member !== 'object') continue;
                    if (String(member.characterId) !== String(charId)) continue;
                    
                    var join = parseStrictPositivePeriod(member.joinPeriod);
                    if (join === null) {
                        // Invalid join period - assume active
                        count++;
                        break;
                    }
                    
                    if (join <= periodNum) {
                        var leaveInfo = getPeriodInfo(member.leavePeriod);
                        if (!leaveInfo.present || leaveInfo.value >= periodNum) {
                            count++;
                            break;
                        }
                    }
                }
            }
        }
        
        return count;
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
            return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        }
        if (!char.stats || typeof char.stats !== 'object') {
            return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        }
        var stats = char.stats;
        return {
            str: typeof stats.str === 'number' ? stats.str : 10,
            dex: typeof stats.dex === 'number' ? stats.dex : 10,
            con: typeof stats.con === 'number' ? stats.con : 10,
            int: typeof stats.int === 'number' ? stats.int : 10,
            wis: typeof stats.wis === 'number' ? stats.wis : 10,
            cha: typeof stats.cha === 'number' ? stats.cha : 10
        };
    }

    /**
     * Get a character's magic proficiencies with defaults.
     * @param {object} char - Character object
     * @returns {object} Magic proficiencies object
     */
    function getCharacterMagic(char) {
        if (!char) {
            var empty = {};
            var magicTypes = getMagicTypeKeys();
            for (var i = 0; i < magicTypes.length; i++) {
                empty[magicTypes[i]] = 0;
            }
            return empty;
        }
        if (!char.magic || typeof char.magic !== 'object') {
            var empty = {};
            var magicTypes = getMagicTypeKeys();
            for (var i = 0; i < magicTypes.length; i++) {
                empty[magicTypes[i]] = 0;
            }
            return empty;
        }
        var magic = char.magic;
        var result = {};
        var magicTypes = getMagicTypeKeys();
        for (var i = 0; i < magicTypes.length; i++) {
            var key = magicTypes[i];
            result[key] = typeof magic[key] === 'number' ? magic[key] : 0;
        }
        return result;
    }

    /**
     * Get magic type keys from CharacterConstants if available.
     * @returns {Array} Array of magic type keys
     */
    function getMagicTypeKeys() {
        if (window.CharacterConstants && typeof window.CharacterConstants.MAGIC_TYPE_KEYS !== 'undefined') {
            return window.CharacterConstants.MAGIC_TYPE_KEYS.slice();
        }
        // Fallback
        return ['earth','water','fire','air','metal','wood',
                'blood','bone','mind','morphic','life','death',
                'space','time','dimension','void','reality','transference'];
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
        getCharacterSpecialMoves: getCharacterSpecialMoves,
        
        // Cross-domain (consider moving)
        getCharacterTeamCount: getCharacterTeamCount
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
    window.getCharacterTeamCount = getCharacterTeamCount;

})();
