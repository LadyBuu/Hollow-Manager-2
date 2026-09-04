/**
 * js/modules/academia/academia-core.js - Academia Core Operations
 * Single source of truth for all academia-related data mutations
 * Path: js/modules/academia/academia-core.js
 * 
 * This module handles:
 *   - Grade mutations (candidate-based)
 *   - Ranking mutations (candidate-based)
 *   - Tournament participation mutations
 *   - All operations delegate to existing core modules
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - USES GradeCore for grade operations
 *   - USES RankingCore for ranking operations
 *   - USES MutationUtils for backup and persistence
 *   - USES NotificationSystem for notifications
 *   - USES ActivityLog for activity logging
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Validate inputs
 *     2. Build candidate state (deep clone)
 *     3. Apply validated changes to candidate
 *     4. Apply candidate to data store (replace, not mutate)
 *     5. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before candidate validation completes
 * 
 * DEPENDENCIES:
 *   - window.GradeCore (from curriculum-grades.js)
 *   - window.RankingCore (from curriculum-ranking.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.ObjectUtils (from object-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academiaCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var GradeCore = window.GradeCore;
    var RankingCore = window.RankingCore;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // GradeCore is MANDATORY
        if (!GradeCore || typeof GradeCore.saveGrades !== 'function') {
            missing.push('GradeCore.saveGrades');
        }
        if (!GradeCore || typeof GradeCore.getGrades !== 'function') {
            missing.push('GradeCore.getGrades');
        }
        if (!GradeCore || typeof GradeCore.calculateGradeSummary !== 'function') {
            missing.push('GradeCore.calculateGradeSummary');
        }
        if (!GradeCore || typeof GradeCore.getGradeLetter !== 'function') {
            missing.push('GradeCore.getGradeLetter');
        }

        // RankingCore is MANDATORY
        if (!RankingCore || typeof RankingCore.getRankings !== 'function') {
            missing.push('RankingCore.getRankings');
        }
        if (!RankingCore || typeof RankingCore.setRankings !== 'function') {
            missing.push('RankingCore.setRankings');
        }
        if (!RankingCore || typeof RankingCore.autoGenerateRankings !== 'function') {
            missing.push('RankingCore.autoGenerateRankings');
        }
        if (!RankingCore || typeof RankingCore.updateStudentRank !== 'function') {
            missing.push('RankingCore.updateStudentRank');
        }
        if (!RankingCore || typeof RankingCore.removeStudentFromRankings !== 'function') {
            missing.push('RankingCore.removeStudentFromRankings');
        }

        // MutationUtils is MANDATORY
        if (!MutationUtils || typeof MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (!MutationUtils || typeof MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // ObjectUtils is MANDATORY
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('AcademiaCore: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academiaCoreLoaded = true;

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateScore(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        return Number.isFinite(num) && num >= 0 && num <= 100;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    // ============================================================
    // GRADE OPERATIONS
    // ============================================================

    /**
     * Get grades for a student in a specific week.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @returns {object} Grades object { disciplineId: score }
     */
    function getStudentGrades(studentId, week) {
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
     * Save grades for a student in a week.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Week number (1-52)
     * @param {object} grades - Grades object { disciplineId: score }
     * @returns {object} { success: boolean, message?: string, changed?: boolean, count?: number }
     */
    function saveGrades(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isObject(grades)) {
            return failure('Grades must be an object.');
        }

        // ---- PHASE 2: VALIDATE EACH GRADE ----
        var validatedGrades = {};
        var invalidDisciplines = [];
        var invalidScores = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var value = grades[disciplineId];

            // Empty value means delete this grade
            if (value === undefined || value === null || value === '') {
                validatedGrades[disciplineId] = null;
                continue;
            }

            // Validate discipline exists (use GradeCore's validation)
            if (typeof GradeCore.validateDiscipline === 'function') {
                var discipline = window.getDiscipline(disciplineId);
                if (!discipline) {
                    invalidDisciplines.push(disciplineId);
                    continue;
                }
            }

            // Validate score
            if (!validateScore(value)) {
                invalidScores.push(disciplineId);
                continue;
            }

            validatedGrades[disciplineId] = Math.round(Number(value) * 10) / 10;
        }

        if (invalidDisciplines.length > 0) {
            var disciplineNames = invalidDisciplines.map(function(id) {
                var d = window.getDiscipline ? window.getDiscipline(id) : null;
                return d ? d.name : id;
            });
            return failure('Invalid disciplines: ' + disciplineNames.join(', ') + '.');
        }

        if (invalidScores.length > 0) {
            return failure('Invalid scores for: ' + invalidScores.join(', ') + '. Scores must be between 0 and 100.');
        }

        // ---- PHASE 3: DELEGATE TO GRADECORE ----
        var result = GradeCore.saveGrades(studentId, weekNum, validatedGrades);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to save grades.');
        }

        // ---- PHASE 4: LOG ----
        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var changed = result.changed || false;
        var count = result.count || 0;

        if (changed) {
            recordActivity('Saved grades for ' + studentName + ' week ' + weekNum + ' (' + count + ' changes)');
        }

        return {
            success: true,
            changed: changed,
            count: count,
            data: result.data
        };
    }

    // ============================================================
    // RANKING OPERATIONS
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
     * Set rankings for a specific week.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {number} week - Week number (1-52)
     * @param {array} rankings - Rankings array [{ studentId, rank }]
     * @returns {object} { success: boolean, message?: string, count?: number }
     */
    function setRankings(week, rankings) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        // Validate each entry
        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (!entry || typeof entry !== 'object') {
                return failure('Invalid ranking entry at index ' + i + '.');
            }
            if (!isNonEmptyString(entry.studentId)) {
                return failure('Student ID is required at index ' + i + '.');
            }
            var rankNum = parseInt(entry.rank, 10);
            if (isNaN(rankNum) || rankNum < 1) {
                return failure('Valid rank is required at index ' + i + '.');
            }
        }

        // ---- PHASE 2: DELEGATE TO RANKINGCORE ----
        var result = RankingCore.setRankings(weekNum, rankings);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to set rankings.');
        }

        // ---- PHASE 3: LOG ----
        var count = result.count || 0;
        recordActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    /**
     * Auto-generate rankings for a week from grade data.
     * @param {number} week - Week number (1-52)
     * @returns {object} { success: boolean, message?: string, count?: number }
     */
    function autoGenerateRankings(week) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: DELEGATE TO RANKINGCORE ----
        var result = RankingCore.autoGenerateRankings(weekNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to auto-generate rankings.');
        }

        // ---- PHASE 3: LOG ----
        var count = result.count || 0;
        recordActivity('Auto-generated rankings for week ' + weekNum + ' (' + count + ' students)');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    /**
     * Update a student's rank in a specific week.
     * @param {number} week - Week number (1-52)
     * @param {string} studentId - Student ID
     * @param {number} newRank - New rank position
     * @returns {object} { success: boolean, message?: string, count?: number }
     */
    function updateStudentRank(week, studentId, newRank) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var rankNum = parseInt(newRank, 10);
        if (isNaN(rankNum) || rankNum < 1) {
            return failure('Valid rank is required.');
        }

        // ---- PHASE 2: DELEGATE TO RANKINGCORE ----
        var result = RankingCore.updateStudentRank(weekNum, studentId, rankNum);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to update student rank.');
        }

        // ---- PHASE 3: LOG ----
        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var count = result.count || 0;

        var operation = result.operation || 'updated';
        recordActivity('Updated rank for ' + studentName + ' (' + operation + ', week ' + weekNum + ')');

        return {
            success: true,
            operation: operation,
            count: count,
            data: result.rankings
        };
    }

    /**
     * Remove a student from rankings in a specific week.
     * @param {number} week - Week number (1-52)
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, message?: string, count?: number }
     */
    function removeStudentFromRankings(week, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: DELEGATE TO RANKINGCORE ----
        var result = RankingCore.removeStudentFromRankings(weekNum, studentId);

        if (!result || !result.success) {
            return failure(result ? result.message : 'Failed to remove student from rankings.');
        }

        // ---- PHASE 3: LOG ----
        var student = typeof window.getCharacterById === 'function'
            ? window.getCharacterById(studentId)
            : null;
        var studentName = student
            ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(student) : student.name || 'Unknown')
            : 'Unknown';
        var count = result.count || 0;

        recordActivity('Removed ' + studentName + ' from rankings (week ' + weekNum + ')');

        return {
            success: true,
            count: count,
            data: result.rankings
        };
    }

    // ============================================================
    // RANKING QUERIES
    // ============================================================

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

    // ============================================================
    // GRADE QUERIES (Delegated to GradeCore)
    // ============================================================

    /**
     * Get all grades for a student across all weeks.
     * @param {string} studentId - Student ID
     * @returns {object} Grades object { week: { disciplineId: score } }
     */
    function getAllStudentGrades(studentId) {
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademiaCore = {
        // Grade operations
        getStudentGrades: getStudentGrades,
        getAllStudentGrades: getAllStudentGrades,
        getWeekGrades: getWeekGrades,
        hasGrade: hasGrade,
        calculateGradeSummary: calculateGradeSummary,
        getGradeLetter: getGradeLetter,
        saveGrades: saveGrades,

        // Ranking operations
        getRankings: getRankings,
        getStudentRank: getStudentRank,
        getRankingCount: getRankingCount,
        hasRankings: hasRankings,
        setRankings: setRankings,
        autoGenerateRankings: autoGenerateRankings,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,

        // Utilities
        validateWeek: validateWeek,
        validateScore: validateScore
    };

})();
