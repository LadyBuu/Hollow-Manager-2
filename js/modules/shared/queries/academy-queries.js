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
 *   - It does NOT depend on AcademyQueries (no circular dependency)
 *   - It is the CONSUMER-FACING read API
 *   - Returns defensive copies where appropriate
 *   - No UI dependencies
 *   - No persistence
 * 
 * DEPENDENCIES:
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *   - window.AcademyGroups (from academy-groups.js) - MANDATORY
 *   - window.AcademyRanking (from academy-ranking.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
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
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.AcademyClasses) {
        missing.push('AcademyClasses');
    }
    if (!window.AcademyGrades) {
        missing.push('AcademyGrades');
    }
    if (!window.AcademyGroups) {
        missing.push('AcademyGroups');
    }
    if (!window.AcademyRanking) {
        missing.push('AcademyRanking');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getCurrentStatus !== 'function') {
        missing.push('CharacterQueries.getCurrentStatus');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamsByClass !== 'function') {
        missing.push('TeamQueries.getTeamsByClass');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }

    if (missing.length > 0) {
        console.warn('[AcademyQueries] Missing dependencies:', missing.join(', '));
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyGrades = window.AcademyGrades;
    var AcademyGroups = window.AcademyGroups;
    var AcademyRanking = window.AcademyRanking;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var DisciplineQueries = window.DisciplineQueries;

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
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function deepClone(value) {
        if (window.ObjectUtils && typeof window.ObjectUtils.deepClone === 'function') {
            return window.ObjectUtils.deepClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown';
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        return discipline ? discipline.name : 'Unknown';
    }

    // ============================================================
    // CLASS QUERIES - DELEGATES TO ACADEMYCLASSES
    // ============================================================

    /**
     * Get all classes.
     * 
     * @param {string} status - Optional status filter ('active', 'archived', 'graduated')
     * @returns {array} Array of class objects
     */
    function getClasses(status) {
        if (status) {
            return AcademyClasses.getClassesByStatus(status);
        }
        return AcademyClasses.getAllClasses();
    }

    /**
     * Get a class by ID.
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(classId) {
        return AcademyClasses.getClass(classId);
    }

    /**
     * Get a class by name.
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        return AcademyClasses.getClassByName(name);
    }

    /**
     * Get class display name.
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name
     */
    function getClassDisplayName(classId) {
        return AcademyClasses.getDisplayName(classId);
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
        return AcademyClasses.getCharacterClasses(character);
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
        return AcademyClasses.getCharacterClassNames(character);
    }

    /**
     * Check if a character is in a class.
     * 
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if in class
     */
    function isCharacterInClass(character, classId) {
        if (!character || typeof character !== 'object') {
            return false;
        }
        return AcademyClasses.isCharacterInClass(character, classId);
    }

    /**
     * Get students for a class (full character objects).
     * 
     * @param {string} classId - Class ID
     * @param {boolean} returnObjects - If true, return full character objects (default: true)
     * @returns {array} Array of student IDs or character objects
     */
    function getClassStudents(classId, returnObjects) {
        returnObjects = returnObjects !== false;
        return AcademyClasses.getClassStudentsWithDetails(classId, returnObjects, CharacterQueries.getCharacterById);
    }

    /**
     * Get class students with their IDs only.
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of student IDs
     */
    function getClassStudentIds(classId) {
        return AcademyClasses.getClassStudents(classId);
    }

    // ============================================================
    // GRADE QUERIES - DELEGATES TO ACADEMYGRADES
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
        return AcademyGrades.getStudentGrades(studentId, week);
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
        return AcademyGrades.getClassGrades(classId, week);
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
        return AcademyGrades.getDisciplineGrades(disciplineId, week);
    }

    /**
     * Get grades for a specific week.
     * 
     * @param {number} week - Week number
     * @param {string} classId - Optional class filter
     * @returns {array} Array of grade objects
     */
    function getWeekGrades(week, classId) {
        return AcademyGrades.getWeekGrades(week, classId);
    }

    /**
     * Get a grade by ID.
     * 
     * @param {string} gradeId - Grade ID
     * @returns {object|null} Grade object or null
     */
    function getGrade(gradeId) {
        return AcademyGrades.getGrade(gradeId);
    }

    /**
     * Get all grades.
     * 
     * @returns {array} Array of grade objects
     */
    function getAllGrades() {
        return AcademyGrades.getAllGrades();
    }

    /**
     * Calculate a grade summary.
     * 
     * @param {array} grades - Array of grade objects
     * @param {number} weightThreshold - Minimum weight to include (default: 0.5)
     * @returns {object} Summary statistics
     */
    function calculateGradeSummary(grades, weightThreshold) {
        return AcademyGrades.calculateSummary(grades, weightThreshold);
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
        return AcademyGrades.calculateStudentGPA(studentId, week);
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
        return AcademyGrades.calculateClassRanking(classId, week, CharacterQueries.getCharacterById);
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
            var grades = AcademyGrades.getStudentGrades(student.id, weekNum);
            var summary = AcademyGrades.calculateSummary(grades);

            result.push({
                student: student,
                grades: grades,
                summary: summary
            });
        }
        return result;
    }

    // ============================================================
    // RANKING QUERIES - DELEGATES TO ACADEMYRANKING
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
        if (!isNonEmptyString(classId) || !AcademyRanking) {
            return [];
        }
        return AcademyRanking.getClassRankings(classId, week, includeStudentDetails);
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
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId) || !AcademyRanking) {
            return null;
        }
        return AcademyRanking.getStudentRank(classId, studentId, week, includeDetails);
    }

    /**
     * Get rankings with details.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} { rankings, summary, distribution }
     */
    function getRankingsWithDetails(classId, week) {
        if (!isNonEmptyString(classId) || !AcademyRanking) {
            return { rankings: [], summary: {}, distribution: {} };
        }
        return AcademyRanking.getRankingsWithDetails(classId, week);
    }

    /**
     * Get all rankings.
     * 
     * @param {string} classId - Optional class filter
     * @param {number} week - Optional week filter
     * @returns {array} Array of ranking objects
     */
    function getRankings(classId, week) {
        if (!AcademyRanking) {
            return [];
        }
        return AcademyRanking.getRankings(classId, week);
    }

    /**
     * Calculate ranking summary.
     * 
     * @param {array} rankings - Array of ranking objects
     * @returns {object} Summary statistics
     */
    function calculateRankingSummary(rankings) {
        if (!AcademyRanking) {
            return { count: 0, minRank: null, maxRank: null, averageRank: 0 };
        }
        return AcademyRanking.calculateRankingSummary(rankings);
    }

    // ============================================================
    // GROUP QUERIES - DELEGATES TO ACADEMYGROUPS (READ-ONLY)
    // ============================================================

    /**
     * Get all auto-groups.
     * 
     * @returns {object} Groups by key
     */
    function getAllGroups() {
        if (!AcademyGroups) {
            return {};
        }
        return AcademyGroups.getAllAutoGroups();
    }

    /**
     * Get an auto-group by key.
     * 
     * @param {string} key - Group key (disciplineId_instructorId)
     * @returns {object|null} Group object or null
     */
    function getGroup(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return null;
        }
        return AcademyGroups.getAutoGroup(key);
    }

    /**
     * Get auto-groups by discipline.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {object} Groups by key
     */
    function getGroupsByDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId) || !AcademyGroups) {
            return {};
        }
        return AcademyGroups.getGroupsByDiscipline(disciplineId);
    }

    /**
     * Get auto-groups by instructor.
     * 
     * @param {string} instructorId - Instructor ID
     * @returns {object} Groups by key
     */
    function getGroupsByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId) || !AcademyGroups) {
            return {};
        }
        return AcademyGroups.getGroupsByInstructor(instructorId);
    }

    /**
     * Get students in a group.
     * 
     * @param {string} key - Group key
     * @returns {array} Array of student IDs
     */
    function getGroupStudents(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return [];
        }
        return AcademyGroups.getGroupStudents(key);
    }

    /**
     * Get slots in a group.
     * 
     * @param {string} key - Group key
     * @returns {array} Array of slot objects
     */
    function getGroupSlots(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return [];
        }
        return AcademyGroups.getGroupSlots(key);
    }

    /**
     * Get student count in a group.
     * 
     * @param {string} key - Group key
     * @returns {number} Number of students
     */
    function getGroupStudentCount(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return 0;
        }
        return AcademyGroups.getGroupStudentCount(key);
    }

    /**
     * Get slot count in a group.
     * 
     * @param {string} key - Group key
     * @returns {number} Number of slots
     */
    function getGroupSlotCount(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return 0;
        }
        return AcademyGroups.getGroupSlotCount(key);
    }

    /**
     * Check if a student is in a group.
     * 
     * @param {string} key - Group key
     * @param {string} studentId - Student ID
     * @returns {boolean} True if in group
     */
    function isStudentInGroup(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId) || !AcademyGroups) {
            return false;
        }
        return AcademyGroups.isStudentInGroup(key, studentId);
    }

    /**
     * Get all groups for a student.
     * 
     * @param {string} studentId - Student ID
     * @returns {object} Groups by key
     */
    function getGroupsForStudent(studentId) {
        if (!isNonEmptyString(studentId) || !AcademyGroups) {
            return {};
        }
        return AcademyGroups.getGroupsForStudent(studentId);
    }

    /**
     * Get groups for a specific week.
     * 
     * @param {number} week - Week number
     * @returns {object} Groups by key
     */
    function getGroupsForWeek(week) {
        if (!AcademyGroups) {
            return {};
        }
        return AcademyGroups.getGroupsForWeek(week);
    }

    /**
     * Get slots for a group at a specific week.
     * 
     * @param {string} key - Group key
     * @param {number} week - Week number
     * @returns {array} Array of slot objects
     */
    function getGroupSlotsByWeek(key, week) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return [];
        }
        return AcademyGroups.getGroupSlotsByWeek(key, week);
    }

    /**
     * Get a group summary.
     * 
     * @param {string} key - Group key
     * @returns {object|null} Group summary or null
     */
    function getGroupSummary(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return null;
        }
        return AcademyGroups.getGroupSummary(key);
    }

    /**
     * Get all group summaries.
     * 
     * @returns {array} Array of group summaries
     */
    function getAllGroupSummaries() {
        if (!AcademyGroups) {
            return [];
        }
        return AcademyGroups.getAllGroupSummaries();
    }

    /**
     * Get group display name.
     * 
     * @param {string} key - Group key
     * @returns {string} Group display name
     */
    function getGroupDisplayName(key) {
        if (!isNonEmptyString(key) || !AcademyGroups) {
            return 'Unknown Group';
        }
        return AcademyGroups.getGroupDisplayName(key);
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

        var allStudents = CharacterQueries.getStudents() || [];
        var classStudents = AcademyClasses.getClassStudents(classId);
        var classStudentSet = {};

        for (var i = 0; i < classStudents.length; i++) {
            classStudentSet[String(classStudents[i])] = true;
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
    // ACADEMIC TEAM QUERIES - DELEGATES TO TEAMQUERIES
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
        return TeamQueries.getTeamsByClass(classId, status);
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

        return members.map(function(m) {
            var char = CharacterQueries.getCharacterById(m.characterId);
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

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var grades = AcademyGrades.getStudentGrades(studentId, weekNum);
        var gpa = AcademyGrades.calculateStudentGPA(studentId, weekNum);
        var classes = AcademyClasses.getCharacterClasses(student);
        var gradeSummary = AcademyGrades.calculateSummary(grades);
        var ranking = null;

        // Find ranking
        var classRankings = AcademyGrades.calculateClassRanking(student.classId, weekNum);
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

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var studentIds = AcademyClasses.getClassStudents(classId);
        var students = [];

        if (includeStudentDetails !== false) {
            for (var i = 0; i < studentIds.length; i++) {
                var char = CharacterQueries.getCharacterById(studentIds[i]);
                if (char) {
                    students.push(char);
                }
            }
        }

        var grades = AcademyGrades.getClassGrades(classId, weekNum);
        var teams = TeamQueries.getTeamsByClass(classId);
        var gradeSummary = AcademyGrades.calculateSummary(grades);
        var ranking = AcademyGrades.calculateClassRanking(classId, weekNum, CharacterQueries.getCharacterById);

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

    /**
     * Get discipline name by ID.
     * 
     * @param {string} disciplineId - Discipline ID
     * @returns {string} Discipline name
     */
    function getDisciplineName(disciplineId) {
        return getDisciplineName(disciplineId);
    }

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
        return DisciplineQueries.getDiscipline(disciplineId);
    }

    /**
     * Get available disciplines for a week.
     * 
     * @param {number} week - Week number
     * @returns {array} Array of discipline objects
     */
    function getAvailableDisciplines(week) {
        var weekNum = week || getCurrentWeek();
        return DisciplineQueries.getAvailableDisciplines(weekNum);
    }

    /**
     * Get all disciplines.
     * 
     * @returns {array} Array of discipline objects
     */
    function getDisciplines() {
        return DisciplineQueries.getDisciplines();
    }

    /**
     * Get all locations.
     * 
     * @returns {array} Array of location objects
     */
    function getLocations() {
        if (window.LocationQueries && typeof window.LocationQueries.getLocations === 'function') {
            return window.LocationQueries.getLocations();
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
        if (window.LocationQueries && typeof window.LocationQueries.getLocation === 'function') {
            return window.LocationQueries.getLocation(locationId);
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
        if (window.LocationQueries && typeof window.LocationQueries.getLocationName === 'function') {
            return window.LocationQueries.getLocationName(locationId);
        }
        return 'Unknown';
    }

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

        var cls = AcademyClasses.getClass(classId);
        if (!cls || !cls.instructorId) {
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
        return CharacterQueries.getInstructors();
    }

    /**
     * Get all students.
     * 
     * @returns {array} Array of student objects
     */
    function getStudents() {
        return CharacterQueries.getStudents();
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

})();