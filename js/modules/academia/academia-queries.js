/**
 * js/modules/academia/academia-queries.js - Academia Queries
 * Read-only academia domain queries
 * Path: js/modules/academia/academia-queries.js
 * 
 * This module provides:
 *   - Character academic queries
 *   - Grade queries (delegated to GradeCore)
 *   - Ranking queries (delegated to RankingCore)
 *   - Schedule queries (delegated to Calendar core)
 *   - Academic summary queries
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Uses CharacterQueries for character data
 *   - Uses GradeCore for grade data
 *   - Uses RankingCore for ranking data
 *   - Uses Calendar core for schedule data
 *   - All functions return live references into window.data.
 *     Callers must not mutate returned objects.
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.GradeCore (from curriculum-grades.js)
 *   - window.RankingCore (from curriculum-ranking.js)
 *   - window.CalendarCore (from calendar-core.js)
 *   - window.DisciplineCore (from discipline-core.js)
 * 
 * USAGE:
 *   var queries = window.AcademiaQueries;
 *   var student = queries.getCharacter('char_123');
 *   var grades = queries.getGrades('char_123', 1);
 *   var rank = queries.getStudentRank(1, 'char_123');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academiaQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var GradeCore = window.GradeCore;
    var RankingCore = window.RankingCore;
    var CalendarCore = window.CalendarCore;
    var DisciplineCore = window.DisciplineCore;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.isStudent !== 'function') {
            missing.push('CharacterQueries.isStudent');
        }
        if (!CharacterQueries || typeof CharacterQueries.isInstructor !== 'function') {
            missing.push('CharacterQueries.isInstructor');
        }

        // GradeCore is MANDATORY
        if (!GradeCore || typeof GradeCore.getGrades !== 'function') {
            missing.push('GradeCore.getGrades');
        }
        if (!GradeCore || typeof GradeCore.calculateGradeSummary !== 'function') {
            missing.push('GradeCore.calculateGradeSummary');
        }
        if (!GradeCore || typeof GradeCore.getGradeLetter !== 'function') {
            missing.push('GradeCore.getGradeLetter');
        }
        if (!GradeCore || typeof GradeCore.hasGrade !== 'function') {
            missing.push('GradeCore.hasGrade');
        }

        // RankingCore is MANDATORY
        if (!RankingCore || typeof RankingCore.getRankings !== 'function') {
            missing.push('RankingCore.getRankings');
        }
        if (!RankingCore || typeof RankingCore.getStudentRank !== 'function') {
            missing.push('RankingCore.getStudentRank');
        }
        if (!RankingCore || typeof RankingCore.getRankingCount !== 'function') {
            missing.push('RankingCore.getRankingCount');
        }
        if (!RankingCore || typeof RankingCore.hasRankings !== 'function') {
            missing.push('RankingCore.hasRankings');
        }

        // CalendarCore is MANDATORY
        if (!CalendarCore || typeof CalendarCore.getStudentSchedule !== 'function') {
            missing.push('CalendarCore.getStudentSchedule');
        }

        // DisciplineCore is MANDATORY
        if (!DisciplineCore || typeof DisciplineCore.getDiscipline !== 'function') {
            missing.push('DisciplineCore.getDiscipline');
        }
        if (!DisciplineCore || typeof DisciplineCore.getAvailableDisciplines !== 'function') {
            missing.push('DisciplineCore.getAvailableDisciplines');
        }

        if (missing.length > 0) {
            console.warn('AcademiaQueries: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academiaQueriesLoaded = true;

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    // ============================================================
    // CHARACTER QUERIES - Delegated to CharacterQueries
    // ============================================================

    /**
     * Get a character by ID.
     * Returns a LIVE REFERENCE - do not mutate.
     * @param {string} charId - Character ID
     * @returns {object|null} Character object or null
     */
    function getCharacter(charId) {
        return CharacterQueries.getCharacterById(charId);
    }

    /**
     * Get all students.
     * Returns LIVE REFERENCES - do not mutate.
     * @returns {array} Array of student characters
     */
    function getStudents() {
        return CharacterQueries.getStudents();
    }

    /**
     * Get all instructors.
     * Returns LIVE REFERENCES - do not mutate.
     * @returns {array} Array of instructor characters
     */
    function getInstructors() {
        return CharacterQueries.getInstructors();
    }

    /**
     * Get a character's display name.
     * @param {object} character - Character object
     * @returns {string} Display name
     */
    function getDisplayName(character) {
        return CharacterQueries.getDisplayName(character);
    }

    /**
     * Get a character's current status.
     * @param {object} character - Character object
     * @returns {string} Current status
     */
    function getCurrentStatus(character) {
        return CharacterQueries.getCurrentStatus(character);
    }

    /**
     * Check if a character is a student.
     * @param {object} character - Character object
     * @returns {boolean} True if student
     */
    function isStudent(character) {
        return CharacterQueries.isStudent(character);
    }

    /**
     * Check if a character is an instructor.
     * @param {object} character - Character object
     * @returns {boolean} True if instructor
     */
    function isInstructor(character) {
        return CharacterQueries.isInstructor(character);
    }

    /**
     * Get a character's academic role (student/instructor/both/other).
     * @param {object} character - Character object
     * @returns {string} 'student' | 'instructor' | 'both' | 'other'
     */
    function getAcademicRole(character) {
        if (!character) return 'other';
        var isStudent = CharacterQueries.isStudent(character);
        var isInstructor = CharacterQueries.isInstructor(character);
        if (isStudent && isInstructor) return 'both';
        if (isStudent) return 'student';
        if (isInstructor) return 'instructor';
        return 'other';
    }

    /**
     * Get the default academic view mode for a character.
     * @param {object} character - Character object
     * @returns {string} 'student' | 'instructor'
     */
    function getDefaultViewMode(character) {
        var role = getAcademicRole(character);
        if (role === 'both' || role === 'student') {
            return 'student';
        }
        if (role === 'instructor') {
            return 'instructor';
        }
        return 'student';
    }

    // ============================================================
    // GRADE QUERIES - Delegated to GradeCore
    // ============================================================

    /**
     * Get grades for a student in a specific week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {object} Grades object { disciplineId: score }
     */
    function getGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        return GradeCore.getGrades(studentId, weekNum);
    }

    /**
     * Get all grades for a student across all weeks.
     * @param {string} studentId - Student ID
     * @returns {object} Grades object { week: { disciplineId: score } }
     */
    function getAllGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }

        return GradeCore.getAllStudentGrades(studentId);
    }

    /**
     * Get all grades for a specific week across all students.
     * @param {number} week - Week number (1-52)
     * @returns {object} Grades object { studentId: { disciplineId: score } }
     */
    function getWeekGrades(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        return GradeCore.getWeekGrades(weekNum);
    }

    /**
     * Check if a student has a grade for a specific discipline in a week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @param {string} disciplineId - Discipline ID
     * @returns {boolean} True if grade exists
     */
    function hasGrade(studentId, week, disciplineId) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(disciplineId)) {
            return false;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }

        return GradeCore.hasGrade(studentId, weekNum, disciplineId);
    }

    /**
     * Calculate grade summary for a student in a week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {object|null} Grade summary or null
     */
    function calculateGradeSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        return GradeCore.calculateGradeSummary(studentId, weekNum);
    }

    /**
     * Get grade letter for a score in a discipline.
     * @param {object} discipline - Discipline object
     * @param {number} score - Score (0-100)
     * @returns {string} Grade letter or empty string
     */
    function getGradeLetter(discipline, score) {
        return GradeCore.getGradeLetter(discipline, score);
    }

    /**
     * Get a student's discipline IDs from their schedule for a week.
     * @param {object} schedule - Schedule object
     * @returns {array} Array of discipline IDs
     */
    function getStudentDisciplineIds(schedule) {
        if (!schedule || typeof schedule !== 'object') {
            return [];
        }

        var ids = [];
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var disciplineId = daySchedule[hour];
                if (disciplineId) {
                    var normalizedId = String(disciplineId);
                    if (ids.indexOf(normalizedId) === -1) {
                        ids.push(normalizedId);
                    }
                }
            }
        }

        return ids;
    }

    // ============================================================
    // RANKING QUERIES - Delegated to RankingCore
    // ============================================================

    /**
     * Get rankings for a specific week.
     * @param {number} week - Week number (1-52)
     * @returns {array} Rankings array [{ studentId, rank }]
     */
    function getRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        return RankingCore.getRankings(weekNum);
    }

    /**
     * Get the rank of a student in a specific week.
     * @param {number} week - Week number (1-52)
     * @param {string} studentId - Student ID
     * @returns {number|null} Rank or null if not ranked
     */
    function getStudentRank(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        if (!isNonEmptyString(studentId)) {
            return null;
        }

        return RankingCore.getStudentRank(weekNum, studentId);
    }

    /**
     * Get ranking count for a week.
     * @param {number} week - Week number (1-52)
     * @returns {number} Number of ranked students
     */
    function getRankingCount(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return 0;
        }

        return RankingCore.getRankingCount(weekNum);
    }

    /**
     * Check if rankings exist for a week.
     * @param {number} week - Week number (1-52)
     * @returns {boolean} True if rankings exist
     */
    function hasRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }

        return RankingCore.hasRankings(weekNum);
    }

    /**
     * Get ranked students with character data for a week.
     * @param {number} week - Week number (1-52)
     * @returns {array} Array of { studentId, rank, name, character }
     */
    function getRankedStudents(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var rankings = RankingCore.getRankings(weekNum);
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var character = CharacterQueries.getCharacterById(r.studentId);
            if (character) {
                result.push({
                    studentId: r.studentId,
                    rank: r.rank,
                    name: CharacterQueries.getDisplayName(character),
                    character: character
                });
            }
        }

        return result;
    }

    /**
     * Get rank changes between two weeks.
     * @param {number} fromWeek - Source week
     * @param {number} toWeek - Target week
     * @returns {array} Array of changes { studentId, fromRank, toRank, change, changeType }
     */
    function getRankChanges(fromWeek, toWeek) {
        var fromWeekNum = validateWeek(fromWeek);
        var toWeekNum = validateWeek(toWeek);

        if (fromWeekNum === null || toWeekNum === null) {
            return [];
        }

        var fromRankings = RankingCore.getRankings(fromWeekNum);
        var toRankings = RankingCore.getRankings(toWeekNum);

        var result = [];

        // Students in current ranking
        for (var i = 0; i < toRankings.length; i++) {
            var toR = toRankings[i];
            var fromR = null;

            for (var j = 0; j < fromRankings.length; j++) {
                if (String(fromRankings[j].studentId) === String(toR.studentId)) {
                    fromR = fromRankings[j];
                    break;
                }
            }

            var changeType = fromR ? 'changed' : 'new';
            var change = fromR ? fromR.rank - toR.rank : null;
            var fromRank = fromR ? fromR.rank : null;

            if (fromR && fromR.rank === toR.rank) {
                changeType = 'unchanged';
            }

            result.push({
                studentId: toR.studentId,
                fromRank: fromRank,
                toRank: toR.rank,
                change: change,
                changeType: changeType
            });
        }

        // Students who were ranked before but not now
        for (var i = 0; i < fromRankings.length; i++) {
            var fromR = fromRankings[i];
            var exists = false;

            for (var j = 0; j < toRankings.length; j++) {
                if (String(toRankings[j].studentId) === String(fromR.studentId)) {
                    exists = true;
                    break;
                }
            }

            if (!exists) {
                result.push({
                    studentId: fromR.studentId,
                    fromRank: fromR.rank,
                    toRank: null,
                    change: null,
                    changeType: 'removed'
                });
            }
        }

        return result;
    }

    // ============================================================
    // SCHEDULE QUERIES - Delegated to CalendarCore
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {object} Schedule object { day: { hour: disciplineId } }
     */
    function getStudentSchedule(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        return CalendarCore.getStudentSchedule(studentId, weekNum);
    }

    /**
     * Get a student's rest days for a week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {array} Array of rest day numbers (1-7)
     */
    function getStudentRestDays(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        return CalendarCore.getStudentRestDays(studentId, weekNum);
    }

    /**
     * Get the discipline ID for a class at a specific slot.
     * @param {object} schedule - Schedule object
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {string|null} Discipline ID or null
     */
    function getScheduleClass(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return null;
        }

        return schedule[day][hour];
    }

    // ============================================================
    // DISCIPLINE QUERIES - Delegated to DisciplineCore
    // ============================================================

    /**
     * Get a discipline by ID.
     * @param {string} disciplineId - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDiscipline(disciplineId) {
        return DisciplineCore.getDiscipline(disciplineId);
    }

    /**
     * Get all disciplines available in a specific week.
     * @param {number} week - Week number (1-52)
     * @returns {array} Array of discipline objects
     */
    function getAvailableDisciplines(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        return DisciplineCore.getAvailableDisciplines(weekNum);
    }

    /**
     * Get all disciplines.
     * @returns {array} Array of discipline objects
     */
    function getDisciplines() {
        return DisciplineCore.getDisciplines();
    }

    // ============================================================
    // ACADEMIC SUMMARY QUERIES
    // ============================================================

    /**
     * Get a complete academic summary for a student in a week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {object} Academic summary
     */
    function getAcademicSummary(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null || !isNonEmptyString(studentId)) {
            return {
                studentId: studentId,
                week: week,
                grades: null,
                schedule: null,
                ranking: null,
                summary: null
            };
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var schedule = CalendarCore.getStudentSchedule(studentId, weekNum);
        var grades = GradeCore.getGrades(studentId, weekNum);
        var summary = GradeCore.calculateGradeSummary(studentId, weekNum);
        var rank = RankingCore.getStudentRank(weekNum, studentId);

        return {
            studentId: studentId,
            week: weekNum,
            student: student,
            schedule: schedule,
            grades: grades,
            gradeSummary: summary,
            rank: rank,
            isRanked: rank !== null
        };
    }

    /**
     * Get academic summaries for all students in a week.
     * @param {number} week - Week number (1-52)
     * @returns {array} Array of academic summaries
     */
    function getAllStudentSummaries(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var students = CharacterQueries.getStudents();
        var result = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = getAcademicSummary(student.id, weekNum);
            result.push(summary);
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademiaQueries = {
        // Character queries
        getCharacter: getCharacter,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getDisplayName: getDisplayName,
        getCurrentStatus: getCurrentStatus,
        isStudent: isStudent,
        isInstructor: isInstructor,
        getAcademicRole: getAcademicRole,
        getDefaultViewMode: getDefaultViewMode,

        // Grade queries
        getGrades: getGrades,
        getAllGrades: getAllGrades,
        getWeekGrades: getWeekGrades,
        hasGrade: hasGrade,
        calculateGradeSummary: calculateGradeSummary,
        getGradeLetter: getGradeLetter,
        getStudentDisciplineIds: getStudentDisciplineIds,

        // Ranking queries
        getRankings: getRankings,
        getStudentRank: getStudentRank,
        getRankingCount: getRankingCount,
        hasRankings: hasRankings,
        getRankedStudents: getRankedStudents,
        getRankChanges: getRankChanges,

        // Schedule queries
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        getScheduleClass: getScheduleClass,

        // Discipline queries
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines,
        getDisciplines: getDisciplines,

        // Academic summary
        getAcademicSummary: getAcademicSummary,
        getAllStudentSummaries: getAllStudentSummaries,

        // Utilities
        validateWeek: validateWeek
    };

})();
