/**
 * js/modules/classes/classes-queries.js - Class Queries
 * Read-only class domain queries
 * Path: js/modules/classes/classes-queries.js
 * 
 * This module provides:
 *   - Class lookup (by ID, by name)
 *   - Class listing with options
 *   - Character-class relationships
 *   - Team-class relationships
 *   - Available students for a class at a given week
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Uses ValidationUtils for period parsing
 *   - Uses CharacterQueries for character data (when needed)
 *   - Uses TeamQueries for team data (when needed)
 *   - Uses Elimination for elimination status (when needed)
 *   - All functions return live references into window.data.
 *     Callers must not mutate returned objects.
 * 
 * DEPENDENCIES:
 *   - window.ValidationUtils (from validation-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.Elimination (from elimination.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data.classes is the source of truth for class data
 *   - window.data.characters is the source of truth for character data
 *   - window.data.teams is the source of truth for team data
 *   - No caching - always reads fresh from window.data
 *   - Results are live references - callers must not mutate
 * 
 * USAGE:
 *   var queries = window.ClassesQueries;
 *   var classes = queries.getClasses();
 *   var cls = queries.getClass('class_123');
 *   var students = queries.getCharactersByClass('class_123');
 *   var available = queries.getAvailableStudentsForClass('class_123', 5);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ValidationUtils = window.ValidationUtils;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var Elimination = window.Elimination;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ValidationUtils || typeof ValidationUtils.parseStrictPositivePeriod !== 'function') {
            missing.push('ValidationUtils.parseStrictPositivePeriod');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }

        if (!Elimination || typeof Elimination.isCharacterEliminated !== 'function') {
            missing.push('Elimination.isCharacterEliminated');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__classesQueriesLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // PERIOD PARSING - Delegate to ValidationUtils
    // ============================================================

    function parseStrictPositivePeriod(value) {
        return ValidationUtils.parseStrictPositivePeriod(value);
    }

    // ============================================================
    // HELPER: Get Class Data from window.data (READ-ONLY)
    // ============================================================

    function getClassData() {
        var data = window.data;
        return data && Array.isArray(data.classes) ? data.classes : [];
    }

    function getCharacterData() {
        var data = window.data;
        return data && Array.isArray(data.characters) ? data.characters : [];
    }

    function getTeamData() {
        var data = window.data;
        return data && Array.isArray(data.teams) ? data.teams : [];
    }

    // ============================================================
    // CLASS LOOKUP
    // ============================================================

    /**
     * Get all classes.
     * @returns {Array} Array of class objects (shallow copy of array, live class objects)
     */
    function getClasses() {
        var classes = getClassData();
        return classes.slice().filter(function(cls) {
            return cls && typeof cls === 'object';
        }).sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Get a class by ID.
     * @param {string} id - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(id) {
        if (!id) {
            return null;
        }
        var target = String(id);
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && typeof cls === 'object' && String(cls.id) === target) {
                return cls;
            }
        }
        return null;
    }

    /**
     * Get a class by name (exact match, case-insensitive).
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        if (!name) {
            return null;
        }
        var target = String(name).toLowerCase().trim();
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && typeof cls === 'object') {
                var className = String(cls.name || '').toLowerCase().trim();
                if (className === target) {
                    return cls;
                }
            }
        }
        return null;
    }

    /**
     * Get the display name for a class.
     * @param {string} classId - Class ID
     * @returns {string} Class name or 'Unassigned'
     */
    function getClassDisplayName(classId) {
        var cls = getClass(classId);
        return cls ? cls.name : 'Unassigned';
    }

    /**
     * Get class options for dropdowns.
     * @returns {Array} Array of { id, name, count }
     */
    function getClassOptions() {
        var classes = getClasses();
        var options = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = getCharactersByClass(cls.id).length;
            options.push({
                id: cls.id,
                name: cls.name,
                count: count
            });
        }
        return options;
    }

    /**
     * Check if a class exists.
     * @param {string} id - Class ID
     * @returns {boolean} True if class exists
     */
    function classExists(id) {
        return getClass(id) !== null;
    }

    // ============================================================
    // CHARACTER-CLASS RELATIONSHIPS
    // ============================================================

    /**
     * Get all characters in a class.
     * @param {string} classId - Class ID
     * @returns {Array} Array of character objects (live references)
     */
    function getCharactersByClass(classId) {
        if (!classId) {
            return [];
        }
        var target = String(classId);
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var character = chars[i];
            if (character && typeof character === 'object' && Array.isArray(character.classIds)) {
                for (var j = 0; j < character.classIds.length; j++) {
                    if (String(character.classIds[j]) === target) {
                        result.push(character);
                        break;
                    }
                }
            }
        }
        return result;
    }

    /**
     * Get the count of characters in a class.
     * @param {string} classId - Class ID
     * @returns {number} Count of characters
     */
    function getCharacterCountByClass(classId) {
        return getCharactersByClass(classId).length;
    }

    /**
     * Get all classes a character belongs to.
     * @param {object} character - Character object
     * @returns {Array} Array of class objects (live references)
     */
    function getCharacterClasses(character) {
        if (!character) {
            return [];
        }
        var classIds = Array.isArray(character.classIds) ? character.classIds : [];
        if (classIds.length === 0) {
            return [];
        }

        var classes = getClasses();
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls) {
                continue;
            }
            for (var j = 0; j < classIds.length; j++) {
                if (String(classIds[j]) === String(cls.id)) {
                    result.push(cls);
                    break;
                }
            }
        }
        return result;
    }

    /**
     * Get all class names a character belongs to.
     * @param {object} character - Character object
     * @returns {Array} Array of class names
     */
    function getCharacterClassNames(character) {
        var classes = getCharacterClasses(character);
        var names = [];
        for (var i = 0; i < classes.length; i++) {
            names.push(classes[i].name);
        }
        return names;
    }

    /**
     * Check if a character is in a class.
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if character is in the class
     */
    function isCharacterInClass(character, classId) {
        if (!character || !classId) {
            return false;
        }
        var classIds = Array.isArray(character.classIds) ? character.classIds : [];
        var target = String(classId);
        for (var i = 0; i < classIds.length; i++) {
            if (String(classIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // TEAM-CLASS RELATIONSHIPS
    // ============================================================

    /**
     * Get all academic teams in a class.
     * @param {string} classId - Class ID
     * @returns {Array} Array of team objects (live references)
     */
    function getTeamsByClass(classId) {
        if (!classId) {
            return [];
        }
        var target = String(classId);
        var teams = getTeamData();
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && team.type === 'academic' && String(team.classId) === target) {
                if (TeamQueries.isTeamOperational(team)) {
                    result.push(team);
                }
            }
        }
        return result;
    }

    /**
     * Get the count of teams in a class.
     * @param {string} classId - Class ID
     * @returns {number} Count of teams
     */
    function getTeamCountByClass(classId) {
        return getTeamsByClass(classId).length;
    }

    /**
     * Get the class of a team.
     * @param {object} team - Team object
     * @returns {object|null} Class object or null
     */
    function getClassForTeam(team) {
        if (!team || team.type !== 'academic' || !team.classId) {
            return null;
        }
        return getClass(team.classId);
    }

    // ============================================================
    // AVAILABLE STUDENTS FOR CLASS
    // ============================================================

    /**
     * Get available students for a class at a given week.
     * A student is available if they:
     * 1. Are in the class
     * 2. Are not deceased
     * 3. Are not eliminated by the given week
     * 4. Are not in an active academic team for this class
     * 
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @returns {Array} Array of available character objects (live references)
     */
    function getAvailableStudentsForClass(classId, week) {
        if (!classId) {
            return [];
        }

        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        var classChars = getCharactersByClass(classId);
        var teams = getTeamsByClass(classId);

        // Build occupied character set from all teams
        var occupiedIds = {};
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }

            var members = TeamQueries.getActiveTeamMembers(team, weekNum);
            for (var j = 0; j < members.length; j++) {
                var member = members[j];
                if (member && member.characterId) {
                    occupiedIds[String(member.characterId)] = true;
                }
            }
        }

        var result = [];
        for (var k = 0; k < classChars.length; k++) {
            var character = classChars[k];
            if (!character || typeof character !== 'object') {
                continue;
            }

            // Check deceased
            if (character.deceased) {
                continue;
            }

            // Check eliminated
            if (Elimination.isCharacterEliminated(character.id, weekNum)) {
                continue;
            }

            // Check if character is in an occupied set
            if (occupiedIds[String(character.id)]) {
                continue;
            }

            result.push(character);
        }

        return result;
    }

    /**
     * Get the count of available students for a class at a given week.
     * @param {string} classId - Class ID
     * @param {number|string} week - Week number
     * @returns {number} Count of available students
     */
    function getAvailableStudentCount(classId, week) {
        return getAvailableStudentsForClass(classId, week).length;
    }

    /**
     * Check if a student is available for a class at a given week.
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @returns {boolean} True if available
     */
    function isStudentAvailableForClass(classId, studentId, week) {
        if (!classId || !studentId) {
            return false;
        }

        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return false;
        }

        var character = CharacterQueries.getCharacterById(studentId);
        if (!character) {
            return false;
        }

        // Check if character is in this class
        if (!isCharacterInClass(character, classId)) {
            return false;
        }

        // Check deceased
        if (character.deceased) {
            return false;
        }

        // Check eliminated
        if (Elimination.isCharacterEliminated(studentId, weekNum)) {
            return false;
        }

        // Check if character is in an active team for this class
        var teams = getTeamsByClass(classId);
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }

            var members = TeamQueries.getActiveTeamMembers(team, weekNum);
            for (var j = 0; j < members.length; j++) {
                var member = members[j];
                if (member && String(member.characterId) === String(studentId)) {
                    return false;
                }
            }
        }

        return true;
    }

    // ============================================================
    // CLASS STATISTICS
    // ============================================================

    /**
     * Get statistics for a class.
     * @param {string} classId - Class ID
     * @param {number|string} week - Optional week for availability
     * @returns {object} Statistics object
     */
    function getClassStats(classId, week) {
        if (!classId) {
            return {
                totalStudents: 0,
                totalTeams: 0,
                availableStudents: null,
                classExists: false,
                className: null
            };
        }

        var cls = getClass(classId);
        if (!cls) {
            return {
                totalStudents: 0,
                totalTeams: 0,
                availableStudents: null,
                classExists: false,
                className: null
            };
        }

        var totalStudents = getCharacterCountByClass(classId);
        var totalTeams = getTeamCountByClass(classId);
        var availableStudents = null;

        if (week !== undefined && week !== null) {
            availableStudents = getAvailableStudentCount(classId, week);
        }

        return {
            totalStudents: totalStudents,
            totalTeams: totalTeams,
            availableStudents: availableStudents,
            classExists: true,
            className: cls.name
        };
    }

    /**
     * Get all classes with statistics.
     * @param {number|string} week - Optional week for availability
     * @returns {Array} Array of class objects with stats
     */
    function getClassesWithStats(week) {
        var classes = getClasses();
        var result = [];

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var stats = getClassStats(cls.id, week);
            result.push({
                id: cls.id,
                name: cls.name,
                totalStudents: stats.totalStudents,
                totalTeams: stats.totalTeams,
                availableStudents: stats.availableStudents
            });
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesQueries = {
        // Class lookup
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getClassOptions: getClassOptions,
        classExists: classExists,

        // Character-class relationships
        getCharactersByClass: getCharactersByClass,
        getCharacterCountByClass: getCharacterCountByClass,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,

        // Team-class relationships
        getTeamsByClass: getTeamsByClass,
        getTeamCountByClass: getTeamCountByClass,
        getClassForTeam: getClassForTeam,

        // Available students
        getAvailableStudentsForClass: getAvailableStudentsForClass,
        getAvailableStudentCount: getAvailableStudentCount,
        isStudentAvailableForClass: isStudentAvailableForClass,

        // Statistics
        getClassStats: getClassStats,
        getClassesWithStats: getClassesWithStats,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from CoreUtils to ClassesQueries.
    // They will be removed in a future version.

    window.getClasses = getClasses;
    window.getClass = getClass;
    window.getClassByName = getClassByName;
    window.getClassDisplayName = getClassDisplayName;
    window.getClassOptions = getClassOptions;
    window.getCharactersByClass = getCharactersByClass;
    window.getCharacterCountByClass = getCharacterCountByClass;
    window.getTeamsByClass = getTeamsByClass;
    window.getTeamCountByClass = getTeamCountByClass;
    window.getAvailableStudentsForClass = getAvailableStudentsForClass;
    window.getCharacterClasses = getCharacterClasses;
    window.getCharacterClassNames = getCharacterClassNames;
    window.classExists = classExists;

})();
