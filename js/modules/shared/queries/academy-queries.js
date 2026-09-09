/**
 * shared/queries/academy-queries.js - Academy Queries
 * Read-only academy domain queries
 * 
 * This module provides READ-ONLY access to all academy data:
 *   - Classes
 *   - Grades
 *   - Rankings
 *   - Auto-Groups
 *   - Student details
 *   - Class details
 * 
 * OWNERSHIP: Academy domain
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - This module COMPOSES data from AcademyClasses, AcademyGrades, etc.
 *   - Uses LAZY LOADING to break circular dependencies
 *   - It is the CONSUMER-FACING read API
 *   - Returns defensive copies where appropriate
 *   - No UI dependencies
 *   - No persistence
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.AcademyClasses (from academy-classes.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.AcademyGroups (from academy-groups.js)
 *   - window.AcademyRanking (from academy-ranking.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 * 
 * USAGE:
 *   var AQ = window.AcademyQueries;
 *   var classes = AQ.getClasses();
 *   var class = AQ.getClass('class_123');
 *   var students = AQ.getClassStudents('class_123');
 *   var grades = AQ.getStudentGrades('char_456', 5);
 *   var groups = AQ.getAllGroups();
 */

(function() {
    'use strict';

    if (window.__academyQueriesLoaded) {
        return;
    }
    window.__academyQueriesLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS - Breaks circular dependencies
    // ============================================================

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getAcademyGrades() {
        return window.AcademyGrades || null;
    }

    function getAcademyGroups() {
        return window.AcademyGroups || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getLocationQueries() {
        return window.LocationQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Check for critical dependencies but don't throw - use lazy loading
        if (!getAcademyClasses()) {
            missing.push('AcademyClasses');
        }
        if (!getAcademyGrades()) {
            missing.push('AcademyGrades');
        }
        if (!getAcademyGroups()) {
            missing.push('AcademyGroups');
        }
        if (!getAcademyRanking()) {
            missing.push('AcademyRanking');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getTeamQueries()) {
            missing.push('TeamQueries');
        }
        if (!getDisciplineQueries()) {
            missing.push('DisciplineQueries');
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Some dependencies not yet loaded (will use lazy loading):', missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function getCurrentWeek() {
        var data = window.data || {};
        return data.currentWeek || 1;
    }

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var char = getCharacterQueries() ? getCharacterQueries().getCharacterById(charId) : null;
        if (!char) {
            return 'Unknown';
        }
        return getCharacterQueries().getDisplayName(char);
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        // Fallback
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown';
        }
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return 'Unknown';
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        return discipline ? discipline.name : 'Unknown';
    }

    function safeCall(obj, method, fallback) {
        if (obj && typeof obj[method] === 'function') {
            try {
                return obj[method].apply(obj, Array.prototype.slice.call(arguments, 2));
            } catch (e) {
                // Return fallback if available
                return fallback !== undefined ? fallback : null;
            }
        }
        return fallback !== undefined ? fallback : null;
    }

    // ============================================================
    // CLASS QUERIES - DELEGATES TO ACADEMYCLASSES (lazy)
    // ============================================================

    /**
     * Get all classes.
     * 
     * @param {string} status - Optional status filter ('active', 'archived', 'graduated')
     * @returns {array} Array of class objects
     */
    function getClasses(status) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        if (status) {
            var getByStatus = AcademyClasses.getClassesByStatus || AcademyClasses.getClassesByStatusInternal;
            if (typeof getByStatus === 'function') {
                return getByStatus.call(AcademyClasses, status) || [];
            }
        }

        var getAll = AcademyClasses.getClasses || AcademyClasses.getClassesInternal;
        if (typeof getAll === 'function') {
            return getAll.call(AcademyClasses) || [];
        }

        return [];
    }

    /**
     * Get a class by ID.
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return null;
        }

        var getClassFn = AcademyClasses.getClass || AcademyClasses.getClassInternal;
        if (typeof getClassFn === 'function') {
            var result = getClassFn.call(AcademyClasses, classId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get a class by name.
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return null;
        }

        var getByName = AcademyClasses.getClassByName || AcademyClasses.getClassByNameInternal;
        if (typeof getByName === 'function') {
            var result = getByName.call(AcademyClasses, name);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get class display name.
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name
     */
    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return 'Unknown Class';
        }

        var getDisplay = AcademyClasses.getDisplayName || AcademyClasses.getClassDisplayNameInternal;
        if (typeof getDisplay === 'function') {
            return getDisplay.call(AcademyClasses, classId) || 'Unknown Class';
        }

        var cls = getClass(classId);
        return cls ? cls.name || 'Unnamed Class' : 'Unknown Class';
    }

    /**
     * Get classes for a character.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class objects
     */
    function getCharacterClasses(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        var getCharClasses = AcademyClasses.getCharacterClasses || AcademyClasses.getCharacterClassesInternal;
        if (typeof getCharClasses === 'function') {
            return getCharClasses.call(AcademyClasses, character) || [];
        }

        return [];
    }

    /**
     * Get class names for a character.
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class names
     */
    function getCharacterClassNames(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        var getClassNames = AcademyClasses.getCharacterClassNames || AcademyClasses.getCharacterClassNamesInternal;
        if (typeof getClassNames === 'function') {
            return getClassNames.call(AcademyClasses, character) || [];
        }

        return [];
    }

    /**
     * Check if a character is in a class.
     * 
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if in class
     */
    function isCharacterInClass(character, classId) {
        if (!character || typeof character !== 'object' || !isNonEmptyString(classId)) {
            return false;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return false;
        }

        var isInClass = AcademyClasses.isCharacterInClass || AcademyClasses.isCharacterInClassInternal;
        if (typeof isInClass === 'function') {
            return isInClass.call(AcademyClasses, character, classId) === true;
        }

        return false;
    }

    /**
     * Get students for a class (full character objects).
     * 
     * @param {string} classId - Class ID
     * @param {boolean} returnObjects - If true, return full character objects (default: true)
     * @returns {array} Array of student IDs or character objects
     */
    function getClassStudents(classId, returnObjects) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        returnObjects = returnObjects !== false;

        // Try the detailed version first
        if (returnObjects) {
            var getWithDetails = AcademyClasses.getClassStudentsWithDetailsInternal || AcademyClasses.getClassStudentsWithDetails;
            if (typeof getWithDetails === 'function') {
                var CharacterQueries = getCharacterQueries();
                var getCharById = CharacterQueries ? CharacterQueries.getCharacterById : null;
                return getWithDetails.call(AcademyClasses, classId, true, getCharById) || [];
            }
        }

        // Fallback to basic version
        var getStudents = AcademyClasses.getClassStudents || AcademyClasses.getClassStudentsInternal;
        if (typeof getStudents === 'function') {
            var studentIds = getStudents.call(AcademyClasses, classId) || [];

            if (!returnObjects) {
                return studentIds;
            }

            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries) {
                return studentIds;
            }

            var result = [];
            for (var i = 0; i < studentIds.length; i++) {
                var char = CharacterQueries.getCharacterById(studentIds[i]);
                if (char) {
                    result.push(char);
                }
            }
            return result;
        }

        return [];
    }

    /**
     * Get class students with their IDs only.
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of student IDs
     */
    function getClassStudentIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        var getStudents = AcademyClasses.getClassStudents || AcademyClasses.getClassStudentsInternal;
        if (typeof getStudents === 'function') {
            return getStudents.call(AcademyClasses, classId) || [];
        }

        return [];
    }

    // ============================================================
    // GRADE QUERIES - DELEGATES TO ACADEMYGRADES (lazy)
    // ============================================================

    /**
     * Get grades for a student.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getStudentGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getStudentGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, studentId, week) || [];
        }

        return [];
    }

    /**
     * Get grades for a class.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getClassGrades(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getClassGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, classId, week) || [];
        }

        return [];
    }

    /**
     * Get grades for a discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @param {number} week - Optional week filter
     * @returns {array} Array of grade objects
     */
    function getDisciplineGrades(disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getDisciplineGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, disciplineId, week) || [];
        }

        return [];
    }

    /**
     * Get grades for a specific week.
     * 
     * @param {number} week - Week number
     * @param {string} classId - Optional class filter
     * @returns {array} Array of grade objects
     */
    function getWeekGrades(week, classId) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getWeekGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, week, classId) || [];
        }

        return [];
    }

    /**
     * Get a grade by ID.
     * 
     * @param {string} gradeId - Grade ID
     * @returns {object|null} Grade object or null
     */
    function getGrade(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return null;
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return null;
        }

        var getGradeFn = AcademyGrades.getGrade;
        if (typeof getGradeFn === 'function') {
            var result = getGradeFn.call(AcademyGrades, gradeId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get all grades.
     * 
     * @returns {array} Array of grade objects
     */
    function getAllGrades() {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getAll = AcademyGrades.getAllGrades;
        if (typeof getAll === 'function') {
            return getAll.call(AcademyGrades) || [];
        }

        return [];
    }

    /**
     * Calculate a grade summary.
     * 
     * @param {array} grades - Array of grade objects
     * @param {number} weightThreshold - Minimum weight to include (default: 0.5)
     * @returns {object} Summary statistics
     */
    function calculateGradeSummary(grades, weightThreshold) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return { count: 0, average: 0, max: 0, min: 0, passing: 0, failing: 0, passRate: 0 };
        }

        var calcSummary = AcademyGrades.calculateSummary || AcademyGrades.calculateGradeSummary;
        if (typeof calcSummary === 'function') {
            return calcSummary.call(AcademyGrades, grades, weightThreshold) || { count: 0, average: 0 };
        }

        return { count: 0, average: 0 };
    }

    /**
     * Calculate a student's GPA.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Optional week filter
     * @returns {object} GPA statistics
     */
    function calculateStudentGPA(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { gradeCount: 0, average: 0, gpa: 0 };
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return { gradeCount: 0, average: 0, gpa: 0 };
        }

        var calcGPA = AcademyGrades.calculateStudentGPA;
        if (typeof calcGPA === 'function') {
            return calcGPA.call(AcademyGrades, studentId, week) || { gradeCount: 0, average: 0, gpa: 0 };
        }

        return { gradeCount: 0, average: 0, gpa: 0 };
    }

    /**
     * Calculate class ranking.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {array} Array of { studentId, name, average, rank }
     */
    function calculateClassRanking(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var calcRanking = AcademyGrades.calculateClassRanking;
        if (typeof calcRanking === 'function') {
            var CharacterQueries = getCharacterQueries();
            var getCharById = CharacterQueries ? CharacterQueries.getCharacterById : null;
            return calcRanking.call(AcademyGrades, classId, week, getCharById) || [];
        }

        return [];
    }

    /**
     * Get class students with grades.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {array} Array of { student, grades, summary }
     */
    function getClassStudentsWithGrades(classId, week) {
        var students = getClassStudents(classId);
        var weekNum = week || getCurrentWeek();
        var result = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (!student || typeof student !== 'object') {
                continue;
            }
            var grades = getStudentGrades(student.id, weekNum);
            var summary = calculateGradeSummary(grades);

            result.push({
                student: student,
                grades: grades,
                summary: summary
            });
        }
        return result;
    }

    // ============================================================
    // RANKING QUERIES - DELEGATES TO ACADEMYRANKING (lazy)
    // ============================================================

    /**
     * Get class rankings for a specific week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @param {boolean} includeStudentDetails - Include student details
     * @returns {array} Array of ranking objects
     */
    function getClassRankings(classId, week, includeStudentDetails) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return [];
        }

        var getRankings = AcademyRanking.getClassRankings;
        if (typeof getRankings === 'function') {
            return getRankings.call(AcademyRanking, classId, week, includeStudentDetails) || [];
        }

        return [];
    }

    /**
     * Get a student's ranking.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {boolean} includeDetails - Include ranking details
     * @returns {object|null} Ranking object or null
     */
    function getStudentRank(classId, studentId, week, includeDetails) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId)) {
            return null;
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return null;
        }

        var getRank = AcademyRanking.getStudentRank;
        if (typeof getRank === 'function') {
            var result = getRank.call(AcademyRanking, classId, studentId, week, includeDetails);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get rankings with details.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} { rankings, summary, distribution }
     */
    function getRankingsWithDetails(classId, week) {
        if (!isNonEmptyString(classId)) {
            return { rankings: [], summary: {}, distribution: {} };
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return { rankings: [], summary: {}, distribution: {} };
        }

        var getDetails = AcademyRanking.getRankingsWithDetails;
        if (typeof getDetails === 'function') {
            return getDetails.call(AcademyRanking, classId, week) || { rankings: [], summary: {}, distribution: {} };
        }

        return { rankings: [], summary: {}, distribution: {} };
    }

    /**
     * Get all rankings.
     * 
     * @param {string} classId - Optional class filter
     * @param {number} week - Optional week filter
     * @returns {array} Array of ranking objects
     */
    function getRankings(classId, week) {
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return [];
        }

        var getRankingsFn = AcademyRanking.getRankings;
        if (typeof getRankingsFn === 'function') {
            return getRankingsFn.call(AcademyRanking, classId, week) || [];
        }

        return [];
    }

    /**
     * Calculate ranking summary.
     * 
     * @param {array} rankings - Array of ranking objects
     * @returns {object} Summary statistics
     */
    function calculateRankingSummary(rankings) {
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return { count: 0, minRank: null, maxRank: null, averageRank: 0 };
        }

        var calcSummary = AcademyRanking.calculateRankingSummary;
        if (typeof calcSummary === 'function') {
            return calcSummary.call(AcademyRanking, rankings) || { count: 0, minRank: null, maxRank: null, averageRank: 0 };
        }

        return { count: 0, minRank: null, maxRank: null, averageRank: 0 };
    }

    // ============================================================
    // GROUP QUERIES - DELEGATES TO ACADEMYGROUPS (lazy, read-only)
    // ============================================================

    /**
     * Get all auto-groups.
     * 
     * @returns {object} Groups by key
     */
    function getAllGroups() {
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return {};
        }

        var getAll = AcademyGroups.getAllAutoGroups || AcademyGroups.getAutoGroups;
        if (typeof getAll === 'function') {
            return getAll.call(AcademyGroups) || {};
        }

        return {};
    }

    /**
     * Get an auto-group by key.
     * 
     * @param {string} key - Group key (disciplineId_instructorId)
     * @returns {object|null} Group object or null
     */
    function getGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return null;
        }

        var getGroupFn = AcademyGroups.getAutoGroup || AcademyGroups.getGroup;
        if (typeof getGroupFn === 'function') {
            var result = getGroupFn.call(AcademyGroups, key);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get auto-groups by discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {object} Groups by key
     */
    function getGroupsByDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return {};
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return {};
        }

        var getByDiscipline = AcademyGroups.getGroupsByDiscipline;
        if (typeof getByDiscipline === 'function') {
            return getByDiscipline.call(AcademyGroups, disciplineId) || {};
        }

        return {};
    }

    /**
     * Get auto-groups by instructor.
     * 
     * @param {string} instructorId - Instructor ID
     * @returns {object} Groups by key
     */
    function getGroupsByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return {};
        }

        var getByInstructor = AcademyGroups.getGroupsByInstructor;
        if (typeof getByInstructor === 'function') {
            return getByInstructor.call(AcademyGroups, instructorId) || {};
        }

        return {};
    }

    /**
     * Get students in a group.
     * 
     * @param {string} key - Group key
     * @returns {array} Array of student IDs
     */
    function getGroupStudents(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return [];
        }

        var getStudents = AcademyGroups.getGroupStudents;
        if (typeof getStudents === 'function') {
            return getStudents.call(AcademyGroups, key) || [];
        }

        return [];
    }

    /**
     * Get slots in a group.
     * 
     * @param {string} key - Group key
     * @returns {array} Array of slot objects
     */
    function getGroupSlots(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return [];
        }

        var getSlots = AcademyGroups.getGroupSlots;
        if (typeof getSlots === 'function') {
            return getSlots.call(AcademyGroups, key) || [];
        }

        return [];
    }

    /**
     * Get student count in a group.
     * 
     * @param {string} key - Group key
     * @returns {number} Number of students
     */
    function getGroupStudentCount(key) {
        if (!isNonEmptyString(key)) {
            return 0;
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return 0;
        }

        var getCount = AcademyGroups.getGroupStudentCount;
        if (typeof getCount === 'function') {
            return getCount.call(AcademyGroups, key) || 0;
        }

        var students = getGroupStudents(key);
        return students.length;
    }

    /**
     * Get slot count in a group.
     * 
     * @param {string} key - Group key
     * @returns {number} Number of slots
     */
    function getGroupSlotCount(key) {
        if (!isNonEmptyString(key)) {
            return 0;
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return 0;
        }

        var getCount = AcademyGroups.getGroupSlotCount;
        if (typeof getCount === 'function') {
            return getCount.call(AcademyGroups, key) || 0;
        }

        var slots = getGroupSlots(key);
        return slots.length;
    }

    /**
     * Check if a student is in a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {boolean} True if in group
     */
    function isStudentInGroup(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId)) {
            return false;
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return false;
        }

        var isInGroup = AcademyGroups.isStudentInGroup;
        if (typeof isInGroup === 'function') {
            return isInGroup.call(AcademyGroups, key, studentId) === true;
        }

        return false;
    }

    /**
     * Get all groups for a student.
     * 
     * @param {string} studentId - Student ID
     * @returns {object} Groups by key
     */
    function getGroupsForStudent(studentId) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return {};
        }

        var getForStudent = AcademyGroups.getGroupsForStudent;
        if (typeof getForStudent === 'function') {
            return getForStudent.call(AcademyGroups, studentId) || {};
        }

        return {};
    }

    /**
     * Get groups for a specific week.
     * 
     * @param {number} week - Week number
     * @returns {object} Groups by key
     */
    function getGroupsForWeek(week) {
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return {};
        }

        var getForWeek = AcademyGroups.getGroupsForWeek;
        if (typeof getForWeek === 'function') {
            return getForWeek.call(AcademyGroups, week) || {};
        }

        return {};
    }

    /**
     * Get slots for a group at a specific week.
     * 
     * @param {string} key - Group key
     * @param {number} week - Week number
     * @returns {array} Array of slot objects
     */
    function getGroupSlotsByWeek(key, week) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return [];
        }

        var getSlotsByWeek = AcademyGroups.getGroupSlotsByWeek;
        if (typeof getSlotsByWeek === 'function') {
            return getSlotsByWeek.call(AcademyGroups, key, week) || [];
        }

        return [];
    }

    /**
     * Get a group summary.
     * 
     * @param {string} key - Group key
     * @returns {object|null} Group summary or null
     */
    function getGroupSummary(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return null;
        }

        var getSummary = AcademyGroups.getGroupSummary;
        if (typeof getSummary === 'function') {
            var result = getSummary.call(AcademyGroups, key);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get all group summaries.
     * 
     * @returns {array} Array of group summaries
     */
    function getAllGroupSummaries() {
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return [];
        }

        var getAllSummaries = AcademyGroups.getAllGroupSummaries;
        if (typeof getAllSummaries === 'function') {
            return getAllSummaries.call(AcademyGroups) || [];
        }

        return [];
    }

    /**
     * Get group display name.
     * 
     * @param {string} key - Group key
     * @returns {string} Group display name
     */
    function getGroupDisplayName(key) {
        if (!isNonEmptyString(key)) {
            return 'Unknown Group';
        }
        var AcademyGroups = getAcademyGroups();
        if (!AcademyGroups) {
            return 'Unknown Group';
        }

        var getDisplay = AcademyGroups.getGroupDisplayName;
        if (typeof getDisplay === 'function') {
            return getDisplay.call(AcademyGroups, key) || 'Unknown Group';
        }

        return 'Unknown Group';
    }

    // ============================================================
    // AVAILABLE STUDENTS
    // ============================================================

    /**
     * Get available students for a class at a specific week.
     * Returns students who are not already in the class.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number (optional)
     * @param {string} statusFilter - Status filter for students
     * @returns {array} Array of character objects
     */
    function getAvailableStudents(classId, week, statusFilter) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var allStudents = CharacterQueries.getStudents() || [];
        var classStudentIds = getClassStudentIds(classId);
        var classStudentSet = {};

        for (var i = 0; i < classStudentIds.length; i++) {
            classStudentSet[String(classStudentIds[i])] = true;
        }

        var result = [];
        for (var j = 0; j < allStudents.length; j++) {
            var student = allStudents[j];
            if (!student) { continue; }

            if (classStudentSet[String(student.id)]) {
                continue;
            }

            if (statusFilter) {
                var status = CharacterQueries.getCurrentStatus(student);
                if (status.toLowerCase() !== statusFilter.toLowerCase()) {
                    continue;
                }
            }

            result.push(student);
        }

        result.sort(function(a, b) {
            return CharacterQueries.getDisplayName(a).localeCompare(
                CharacterQueries.getDisplayName(b)
            );
        });

        return result;
    }

    // ============================================================
    // ACADEMIC TEAM QUERIES - DELEGATES TO TEAMQUERIES (lazy)
    // ============================================================

    /**
     * Get academic teams for a class.
     * 
     * @param {string} classId - Class ID
     * @param {string} status - Status filter ('active', 'operational')
     * @returns {array} Array of team objects
     */
    function getClassTeams(classId, status) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return [];
        }

        var getTeamsByClass = TeamQueries.getTeamsByClass;
        if (typeof getTeamsByClass === 'function') {
            return getTeamsByClass.call(TeamQueries, classId, status) || [];
        }

        return [];
    }

    /**
     * Get academic team members at a specific period.
     * 
     * @param {string} teamId - Team ID
     * @param {number|string} period - Period (week for academic teams)
     * @param {boolean} includeDetails - Include character details
     * @returns {array} Array of member objects
     */
    function getAcademicTeamMembers(teamId, period, includeDetails) {
        if (!isNonEmptyString(teamId)) {
            return [];
        }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return [];
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = getCurrentWeek();
        }

        var members = TeamQueries.getActiveTeamMembers(team, periodNum);

        if (!includeDetails) {
            return members.map(function(m) {
                return {
                    characterId: m.characterId,
                    role: m.role || 'Member',
                    joinPeriod: m.joinPeriod || '',
                    leavePeriod: m.leavePeriod || ''
                };
            });
        }

        var CharacterQueries = getCharacterQueries();
        return members.map(function(m) {
            var char = CharacterQueries ? CharacterQueries.getCharacterById(m.characterId) : null;
            return {
                characterId: m.characterId,
                name: char ? CharacterQueries.getDisplayName(char) : 'Unknown',
                status: char ? CharacterQueries.getCurrentStatus(char) : '',
                age: char ? CharacterQueries.getCharacterAge(char) : '',
                deceased: char ? char.deceased || false : false,
                role: m.role || 'Member',
                joinPeriod: m.joinPeriod || '',
                leavePeriod: m.leavePeriod || ''
            };
        });
    }

    /**
     * Get academic team member count.
     * 
     * @param {string} teamId - Team ID
     * @param {number|string} period - Period (week for academic teams)
     * @returns {number} Number of members
     */
    function getAcademicTeamMemberCount(teamId, period) {
        if (!isNonEmptyString(teamId)) {
            return 0;
        }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return 0;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 0;
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = getCurrentWeek();
        }

        return TeamQueries.getActiveTeamMembers(team, periodNum).length;
    }

    // ============================================================
    // STUDENT DETAILS (Aggregate)
    // ============================================================

    /**
     * Get complete student details for a specific week.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (optional)
     * @returns {object|null} Student details or null
     */
    function getStudentDetails(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return null;
        }

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var grades = getStudentGrades(studentId, weekNum);
        var gpa = calculateStudentGPA(studentId, weekNum);
        var classes = getCharacterClasses(student);
        var gradeSummary = calculateGradeSummary(grades);
        var ranking = null;

        // Find ranking
        var classRankings = calculateClassRanking(student.classId, weekNum);
        for (var i = 0; i < classRankings.length; i++) {
            if (String(classRankings[i].studentId) === String(studentId)) {
                ranking = classRankings[i];
                break;
            }
        }

        return {
            student: student,
            classes: classes,
            grades: grades,
            gradeSummary: gradeSummary,
            gpa: gpa,
            ranking: ranking,
            week: weekNum,
            displayName: CharacterQueries.getDisplayName(student),
            classNames: classes.map(function(c) { return c.name; })
        };
    }

    // ============================================================
    // CLASS DETAILS (Aggregate)
    // ============================================================

    /**
     * Get complete class details for a specific week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number (optional)
     * @param {boolean} includeStudentDetails - Include full student objects
     * @returns {object|null} Class details or null
     */
    function getClassDetails(classId, week, includeStudentDetails) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = getClass(classId);
        if (!cls) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var studentIds = getClassStudentIds(classId);
        var students = [];

        var CharacterQueries = getCharacterQueries();
        if (includeStudentDetails !== false && CharacterQueries) {
            for (var i = 0; i < studentIds.length; i++) {
                var char = CharacterQueries.getCharacterById(studentIds[i]);
                if (char) {
                    students.push(char);
                }
            }
        }

        var grades = getClassGrades(classId, weekNum);
        var teams = getClassTeams(classId);
        var gradeSummary = calculateGradeSummary(grades);
        var ranking = calculateClassRanking(classId, weekNum);

        return {
            class: cls,
            studentCount: studentIds.length,
            students: students,
            grades: grades,
            gradeSummary: gradeSummary,
            ranking: ranking,
            teams: teams,
            week: weekNum
        };
    }

    // ============================================================
    // DISCIPLINE QUERIES - DELEGATES TO DISCIPLINEQUERIES (lazy)
    // ============================================================

    /**
     * Get discipline by ID.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return null;
        }

        var getDisciplineFn = DisciplineQueries.getDiscipline;
        if (typeof getDisciplineFn === 'function') {
            var result = getDisciplineFn.call(DisciplineQueries, disciplineId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get all disciplines.
     * 
     * @returns {array} Array of discipline objects
     */
    function getDisciplines() {
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return [];
        }

        var getDisciplinesFn = DisciplineQueries.getDisciplines;
        if (typeof getDisciplinesFn === 'function') {
            return getDisciplinesFn.call(DisciplineQueries) || [];
        }

        return [];
    }

    /**
     * Get available disciplines for a week.
     * 
     * @param {number} week - Week number
     * @returns {array} Array of discipline objects
     */
    function getAvailableDisciplines(week) {
        var weekNum = week || getCurrentWeek();
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return [];
        }

        var getAvailable = DisciplineQueries.getAvailableDisciplines;
        if (typeof getAvailable === 'function') {
            return getAvailable.call(DisciplineQueries, weekNum) || [];
        }

        return [];
    }

    /**
     * Get discipline name by ID.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {string} Discipline name
     */
    function getDisciplineName(disciplineId) {
        return getDisciplineName(disciplineId);
    }

    // ============================================================
    // LOCATION QUERIES - DELEGATES TO LOCATIONQUERIES (lazy)
    // ============================================================

    /**
     * Get all locations.
     * 
     * @returns {array} Array of location objects
     */
    function getLocations() {
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return [];
        }

        var getLocationsFn = LocationQueries.getLocations;
        if (typeof getLocationsFn === 'function') {
            return getLocationsFn.call(LocationQueries) || [];
        }

        return [];
    }

    /**
     * Get a location by ID.
     * 
     * @param {string} locationId - Location ID
     * @returns {object|null} Location object or null
     */
    function getLocation(locationId) {
        if (!isNonEmptyString(locationId)) {
            return null;
        }
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return null;
        }

        var getLocationFn = LocationQueries.getLocation;
        if (typeof getLocationFn === 'function') {
            var result = getLocationFn.call(LocationQueries, locationId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    /**
     * Get location name by ID.
     * 
     * @param {string} locationId - Location ID
     * @returns {string} Location name
     */
    function getLocationName(locationId) {
        if (!isNonEmptyString(locationId)) {
            return 'Unknown';
        }
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return 'Unknown';
        }

        var getNameFn = LocationQueries.getLocationName;
        if (typeof getNameFn === 'function') {
            return getNameFn.call(LocationQueries, locationId) || 'Unknown';
        }

        return 'Unknown';
    }

    // ============================================================
    // INSTRUCTOR/STUDENT QUERIES - DELEGATES TO CHARACTERQUERIES (lazy)
    // ============================================================

    /**
     * Get instructors for a class.
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of instructor objects
     */
    function getClassInstructors(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = getClass(classId);
        if (!cls || !cls.instructorId) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var instructor = CharacterQueries.getCharacterById(cls.instructorId);
        return instructor ? [instructor] : [];
    }

    /**
     * Get all instructors.
     * 
     * @returns {array} Array of instructor objects
     */
    function getInstructors() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var getInstructorsFn = CharacterQueries.getInstructors;
        if (typeof getInstructorsFn === 'function') {
            return getInstructorsFn.call(CharacterQueries) || [];
        }

        return [];
    }

    /**
     * Get all students.
     * 
     * @returns {array} Array of student objects
     */
    function getStudents() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var getStudentsFn = CharacterQueries.getStudents;
        if (typeof getStudentsFn === 'function') {
            return getStudentsFn.call(CharacterQueries) || [];
        }

        return [];
    }

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Get the current week from application state.
     * 
     * @returns {number} Current week
     */
    function getCurrentWeek() {
        return getCurrentWeek();
    }

    /**
     * Check if a class is active.
     * 
     * @param {object} cls - Class object
     * @returns {boolean} True if active
     */
    function isClassActive(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'active';
    }

    /**
     * Check if a class is archived.
     * 
     * @param {object} cls - Class object
     * @returns {boolean} True if archived
     */
    function isClassArchived(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'archived';
    }

    /**
     * Check if a class is graduated.
     * 
     * @param {object} cls - Class object
     * @returns {boolean} True if graduated
     */
    function isClassGraduated(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'graduated';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyQueries = {
        // ---- Class queries ----
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,
        getClassStudents: getClassStudents,
        getClassStudentIds: getClassStudentIds,

        // ---- Grade queries ----
        getStudentGrades: getStudentGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        getWeekGrades: getWeekGrades,
        getGrade: getGrade,
        getAllGrades: getAllGrades,
        calculateGradeSummary: calculateGradeSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,
        getClassStudentsWithGrades: getClassStudentsWithGrades,

        // ---- Ranking queries ----
        getClassRankings: getClassRankings,
        getStudentRank: getStudentRank,
        getRankingsWithDetails: getRankingsWithDetails,
        getRankings: getRankings,
        calculateRankingSummary: calculateRankingSummary,

        // ---- Group queries ----
        getAllGroups: getAllGroups,
        getGroup: getGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForWeek: getGroupsForWeek,
        getGroupSlotsByWeek: getGroupSlotsByWeek,
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries,
        getGroupDisplayName: getGroupDisplayName,

        // ---- Available students ----
        getAvailableStudents: getAvailableStudents,

        // ---- Academic team queries ----
        getClassTeams: getClassTeams,
        getAcademicTeamMembers: getAcademicTeamMembers,
        getAcademicTeamMemberCount: getAcademicTeamMemberCount,

        // ---- Student details (Aggregate) ----
        getStudentDetails: getStudentDetails,

        // ---- Class details (Aggregate) ----
        getClassDetails: getClassDetails,

        // ---- Discipline queries ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,
        getDisciplineName: getDisciplineName,

        // ---- Location queries ----
        getLocations: getLocations,
        getLocation: getLocation,
        getLocationName: getLocationName,

        // ---- Instructor/Student queries ----
        getInstructors: getInstructors,
        getStudents: getStudents,
        getClassInstructors: getClassInstructors,

        // ---- Helpers ----
        getCurrentWeek: getCurrentWeek,
        isClassActive: isClassActive,
        isClassArchived: isClassArchived,
        isClassGraduated: isClassGraduated
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyQueries;
        var missing = [];

        var required = [
            'getClasses', 'getClass', 'getClassByName', 'getClassDisplayName',
            'getCharacterClasses', 'getCharacterClassNames', 'isCharacterInClass',
            'getClassStudents', 'getClassStudentIds',
            'getStudentGrades', 'getClassGrades', 'getDisciplineGrades',
            'getWeekGrades', 'getGrade', 'getAllGrades',
            'calculateGradeSummary', 'calculateStudentGPA', 'calculateClassRanking',
            'getClassStudentsWithGrades',
            'getClassRankings', 'getStudentRank', 'getRankingsWithDetails',
            'getRankings', 'calculateRankingSummary',
            'getAllGroups', 'getGroup', 'getGroupsByDiscipline', 'getGroupsByInstructor',
            'getGroupStudents', 'getGroupSlots', 'getGroupStudentCount',
            'getGroupSlotCount', 'isStudentInGroup', 'getGroupsForStudent',
            'getGroupsForWeek', 'getGroupSlotsByWeek', 'getGroupSummary',
            'getAllGroupSummaries', 'getGroupDisplayName',
            'getAvailableStudents',
            'getClassTeams', 'getAcademicTeamMembers', 'getAcademicTeamMemberCount',
            'getStudentDetails', 'getClassDetails',
            'getDiscipline', 'getDisciplines', 'getAvailableDisciplines',
            'getDisciplineName',
            'getLocations', 'getLocation', 'getLocationName',
            'getInstructors', 'getStudents', 'getClassInstructors',
            'getCurrentWeek', 'isClassActive', 'isClassArchived', 'isClassGraduated'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Verification failed - missing exports:', missing.join(', '));
        } else {
            console.log('[AcademyQueries] All exports verified successfully.');
        }
    })();

})();
