/**
 * modules/classes/classes-queries.js - Class Queries
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
 *   - All functions return DEEP CLONED data where appropriate
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
 *   - Results are NOT cloned by default (caller should clone if needed)
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
    window.__classesQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ValidationUtils = window.ValidationUtils || window;
    var CharacterQueries = window.CharacterQueries || window;
    var TeamQueries = window.TeamQueries || window;
    var Elimination = window.Elimination || window;
    var CalendarConstants = window.CALENDAR_CONSTANTS || {};

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;

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

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // TeamQueries is MANDATORY
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.isTeamOperational !== 'function') {
            missing.push('TeamQueries.isTeamOperational');
        }

        if (missing.length > 0) {
            console.warn('ClassesQueries: Missing dependencies:', missing.join(', '));
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
    // HELPER: Get Class Data from window.data
    // ============================================================

    function getClassData() {
        var data = window.data || {};
        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }
        return data.classes;
    }

    function getCharacterData() {
        var data = window.data || {};
        if (!Array.isArray(data.characters)) {
            data.characters = [];
        }
        return data.characters;
    }

    function getTeamData() {
        var data = window.data || {};
        if (!Array.isArray(data.teams)) {
            data.teams = [];
        }
        return data.teams;
    }

    // ============================================================
    // CLASS LOOKUP
    // ============================================================

    /**
     * Get all classes.
     * @returns {Array} Array of class objects (shallow copy)
     */
    function getClasses() {
        var classes = getClassData();
        return classes.slice().filter(function(c) {
            return c && typeof c === 'object';
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
        if (!id) return null;
        var target = String(id);
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (c && typeof c === 'object' && String(c.id) === target) {
                return c;
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
        if (!name) return null;
        var target = String(name).toLowerCase().trim();
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (c && typeof c === 'object') {
                var className = String(c.name || '').toLowerCase().trim();
                if (className === target) {
                    return c;
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
            var c = classes[i];
            var count = getCharactersByClass(c.id).length;
            options.push({
                id: c.id,
                name: c.name,
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
     * @returns {Array} Array of character objects
     */
    function getCharactersByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' && Array.isArray(c.classIds) &&
                c.classIds.some(function(cid) { return String(cid) === target; })) {
                result.push(c);
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
     * @param {object} char - Character object
     * @returns {Array} Array of class objects
     */
    function getCharacterClasses(char) {
        if (!char) return [];
        var classIds = Array.isArray(char.classIds) ? char.classIds : [];
        if (classIds.length === 0) return [];

        var classes = getClasses();
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (c && classIds.some(function(cid) { return String(cid) === String(c.id); })) {
                result.push(c);
            }
        }
        return result;
    }

    /**
     * Get all class names a character belongs to.
     * @param {object} char - Character object
     * @returns {Array} Array of class names
     */
    function getCharacterClassNames(char) {
        var classes = getCharacterClasses(char);
        var names = [];
        for (var i = 0; i < classes.length; i++) {
            names.push(classes[i].name);
        }
        return names;
    }

    /**
     * Check if a character is in a class.
     * @param {object} char - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if character is in the class
     */
    function isCharacterInClass(char, classId) {
        if (!char || !classId) return false;
        var classIds = Array.isArray(char.classIds) ? char.classIds : [];
        return classIds.some(function(cid) { return String(cid) === String(classId); });
    }

    // ============================================================
    // TEAM-CLASS RELATIONSHIPS
    // ============================================================

    /**
     * Get all academic teams in a class.
     * @param {string} classId - Class ID
     * @returns {Array} Array of team objects
     */
    function getTeamsByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var teams = getTeamData();
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var t = teams[i];
            if (t && typeof t === 'object' && 
                t.type === 'academic' && 
                String(t.classId) === target &&
                TeamQueries.isTeamOperational(t)) {
                result.push(t);
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
        if (!team || team.type !== 'academic' || !team.classId) return null;
        return getClass(team.classId);
    }

    /**
     * Get the class name for a team.
     * @param {object} team - Team object
     * @returns {string} Class name or 'Unassigned'
     */
    function getClassForTeamDisplay(team) {
        var cls = getClassForTeam(team);
        return cls ? cls.name : 'Unassigned';
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
     * @returns {Array} Array of available character objects
     */
    function getAvailableStudentsForClass(classId, week) {
        if (!classId) return [];

        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        var classChars = getCharactersByClass(classId);
        var teams = getTeamsByClass(classId);

        var result = [];

        for (var i = 0; i < classChars.length; i++) {
            var char = classChars[i];
            if (!char || typeof char !== 'object') continue;

            // Check deceased
            if (char.deceased) continue;

            // Check eliminated - use Elimination module
            if (Elimination && typeof Elimination.isCharacterEliminated === 'function') {
                if (Elimination.isCharacterEliminated(char.id, weekNum)) {
                    continue;
                }
            }

            // Check if character is in an active team for this class
            var isOccupied = false;
            for (var j = 0; j < teams.length; j++) {
                var team = teams[j];
                if (!team || typeof team !== 'object') continue;

                var members = TeamQueries.getActiveTeamMembers(team, weekNum);
                for (var k = 0; k < members.length; k++) {
                    var member = members[k];
                    if (member && String(member.characterId) === String(char.id)) {
                        isOccupied = true;
                        break;
                    }
                }
                if (isOccupied) break;
            }

            if (!isOccupied) {
                result.push(char);
            }
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
        if (!classId || !studentId) return false;

        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return false;
        }

        var char = CharacterQueries.getCharacterById(studentId);
        if (!char) return false;

        // Check if character is in this class
        if (!isCharacterInClass(char, classId)) return false;

        // Check deceased
        if (char.deceased) return false;

        // Check eliminated
        if (Elimination && typeof Elimination.isCharacterEliminated === 'function') {
            if (Elimination.isCharacterEliminated(studentId, weekNum)) {
                return false;
            }
        }

        // Check if character is in an active team for this class
        var teams = getTeamsByClass(classId);
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') continue;

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
                availableStudents: 0,
                classExists: false,
                className: null
            };
        }

        var cls = getClass(classId);
        if (!cls) {
            return {
                totalStudents: 0,
                totalTeams: 0,
                availableStudents: 0,
                classExists: false,
                className: null
            };
        }

        var totalStudents = getCharacterCountByClass(classId);
        var totalTeams = getTeamCountByClass(classId);
        var availableStudents = 0;

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
            var c = classes[i];
            var stats = getClassStats(c.id, week);
            result.push({
                id: c.id,
                name: c.name,
                totalStudents: stats.totalStudents,
                totalTeams: stats.totalTeams,
                availableStudents: stats.availableStudents
            });
        }

        return result;
    }

    // ============================================================
    // CLASS VALIDATION HELPERS
    // ============================================================

    /**
     * Validate a class name.
     * @param {string} name - Class name to validate
     * @param {string} excludeId - Optional class ID to exclude from duplicate check
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateClassName(name, excludeId) {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return { valid: false, message: 'Class name is required.' };
        }

        var trimmed = String(name).trim();
        var classes = getClassData();

        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (!c || typeof c !== 'object') continue;
            if (excludeId && String(c.id) === String(excludeId)) continue;
            if (String(c.name || '').toLowerCase().trim() === trimmed.toLowerCase()) {
                return { valid: false, message: 'A class with this name already exists.' };
            }
        }

        return { valid: true };
    }

    /**
     * Check if a class name is valid.
     * @param {string} name - Class name to check
     * @param {string} excludeId - Optional class ID to exclude
     * @returns {boolean} True if valid
     */
    function isValidClassName(name, excludeId) {
        return validateClassName(name, excludeId).valid;
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
        getClassForTeamDisplay: getClassForTeamDisplay,

        // Available students
        getAvailableStudentsForClass: getAvailableStudentsForClass,
        getAvailableStudentCount: getAvailableStudentCount,
        isStudentAvailableForClass: isStudentAvailableForClass,

        // Statistics
        getClassStats: getClassStats,
        getClassesWithStats: getClassesWithStats,

        // Validation
        validateClassName: validateClassName,
        isValidClassName: isValidClassName,

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
