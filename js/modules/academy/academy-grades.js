/**
 * js/modules/academy/academy-grades.js - Academy Grade Operations
 * Centralized grade management for the academy module
 * Path: js/modules/academy/academy-grades.js
 * 
 * This module handles:
 *   - Grade CRUD operations (delegates to GradeCore)
 *   - Grade summary calculation (delegates to GradeCore)
 *   - Grade validation (0-100 range)
 *   - Grade letter calculation (delegates to GradeCore)
 *   - Weighted average calculation
 * 
 * IMPORTANT:
 *   - All MUTATION operations return:
 *     { success: true, changed: boolean, operation: string, data: object, count: number }
 *     or { success: false, message: string }
 *   - Query functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * DEPENDENCIES:
 *   - window.GradeCore (from curriculum-grades.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 * 
 * USAGE:
 *   var grades = window.AcademyGrades;
 *   var result = grades.saveGrades(studentId, week, gradeData);
 *   var summary = grades.calculateSummary(studentId, week);
 *   var letter = grades.getLetter(discipline, score);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyGradesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var GradeCore = window.GradeCore;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!GradeCore || typeof GradeCore.getGrades !== 'function') {
            missing.push('GradeCore.getGrades');
        }
        if (!GradeCore || typeof GradeCore.saveGrades !== 'function') {
            missing.push('GradeCore.saveGrades');
        }
        if (!GradeCore || typeof GradeCore.calculateGradeSummary !== 'function') {
            missing.push('GradeCore.calculateGradeSummary');
        }
        if (!GradeCore || typeof GradeCore.getGradeLetter !== 'function') {
            missing.push('GradeCore.getGradeLetter');
        }

        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('AcademyGrades: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyGradesLoaded = true;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

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

    function isValidScore(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        return Number.isFinite(num) && num >= 0 && num <= 100;
    }

    function normalizeScore(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
            return null;
        }
        return Math.round(num * 10) / 10;
    }

    // ============================================================
    // GRADE QUERIES
    // ============================================================

    function getGrades(studentId, week) {
        if (!studentId) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return GradeCore.getGrades(studentId, weekNum);
    }

    function getGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        return grades[disciplineId] !== undefined ? grades[disciplineId] : null;
    }

    function hasGrade(studentId, week, disciplineId) {
        var grade = getGrade(studentId, week, disciplineId);
        return grade !== null && grade !== undefined && grade !== '';
    }

    function getWeekGrades(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        return GradeCore.getWeekGrades(weekNum);
    }

    function getStudentGradeSummary(studentId, week) {
        if (!studentId) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        return GradeCore.calculateGradeSummary(studentId, weekNum);
    }

    function getGradeLetter(discipline, score) {
        if (GradeCore && typeof GradeCore.getGradeLetter === 'function') {
            return GradeCore.getGradeLetter(discipline, score);
        }
        return '';
    }

    // ============================================================
    // GRADE MUTATIONS
    // ============================================================

    function saveGrades(studentId, week, grades) {
        if (!studentId) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!grades || typeof grades !== 'object') {
            return { success: false, message: 'Grades must be an object.' };
        }

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
                var discipline = AcademyQueries.getDiscipline(disciplineId);
                if (!discipline) {
                    invalidDisciplines.push(disciplineId);
                    continue;
                }
                validatedGrades[disciplineId] = null;
                continue;
            }

            var discipline = AcademyQueries.getDiscipline(disciplineId);
            if (!discipline) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            var numericScore = normalizeScore(value);
            if (numericScore === null) {
                invalidScores.push(disciplineId);
                continue;
            }

            validatedGrades[disciplineId] = numericScore;
        }

        if (invalidDisciplines.length > 0) {
            var disciplineNames = invalidDisciplines.map(function(id) {
                var d = AcademyQueries.getDiscipline(id);
                return d ? d.name : id;
            });
            return { success: false, message: 'Invalid disciplines: ' + disciplineNames.join(', ') + '.' };
        }

        if (invalidScores.length > 0) {
            return { success: false, message: 'Invalid scores for: ' + invalidScores.join(', ') + '. Scores must be between 0 and 100.' };
        }

        var result = GradeCore.saveGrades(studentId, weekNum, validatedGrades);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to save grades.' };
        }

        return result;
    }

    function saveGrade(studentId, week, disciplineId, score) {
        if (!studentId) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!disciplineId) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var numericScore = normalizeScore(score);
        if (score !== undefined && score !== null && score !== '' && numericScore === null) {
            return { success: false, message: 'Score must be between 0 and 100.' };
        }

        var result = GradeCore.saveGrade(studentId, weekNum, disciplineId, numericScore);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to save grade.' };
        }

        return result;
    }

    function deleteGrade(studentId, week, disciplineId) {
        return saveGrade(studentId, week, disciplineId, null);
    }

    function deleteWeekGrades(studentId, week) {
        if (!studentId) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var result = GradeCore.deleteWeekGrades(studentId, weekNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to delete grades.' };
        }

        return result;
    }

    function deleteStudentGrades(studentId) {
        if (!studentId) {
            return { success: false, message: 'Student ID is required.' };
        }

        var result = GradeCore.deleteStudentGrades(studentId);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to delete grades.' };
        }

        return result;
    }

    // ============================================================
    // BULK GRADE OPERATIONS
    // ============================================================

    function saveClassGrades(classId, week, gradeData) {
        if (!classId) {
            return { success: false, message: 'Class ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!gradeData || typeof gradeData !== 'object') {
            return { success: false, message: 'Grade data must be an object.' };
        }

        var results = {
            success: true,
            total: 0,
            saved: 0,
            failed: 0,
            errors: []
        };

        var classStudents = AcademyQueries.getClassStudents(classId);
        if (classStudents.length === 0) {
            return { success: false, message: 'No students in this class.' };
        }

        for (var i = 0; i < classStudents.length; i++) {
            var student = classStudents[i];
            var studentGrades = gradeData[student.id];

            if (!studentGrades || typeof studentGrades !== 'object') {
                continue;
            }

            results.total++;

            var result = saveGrades(student.id, weekNum, studentGrades);
            if (result && result.success) {
                results.saved++;
            } else {
                results.failed++;
                var name = CharacterQueries.getDisplayName(student);
                results.errors.push(name + ': ' + (result ? result.message : 'Unknown error'));
            }
        }

        if (results.failed > 0) {
            results.message = 'Saved ' + results.saved + ' of ' + results.total + ' students. Errors: ' + results.errors.join('; ');
        } else {
            results.message = 'Saved grades for ' + results.saved + ' students.';
        }

        return results;
    }

    // ============================================================
    // GRADE SUMMARY HELPERS
    // ============================================================

    function getClassGradeSummary(classId, week) {
        if (!classId) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var students = AcademyQueries.getClassStudents(classId);
        var summaries = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = getStudentGradeSummary(student.id, weekNum);
            if (summary && summary.hasGrades) {
                summaries.push({
                    studentId: student.id,
                    name: CharacterQueries.getDisplayName(student),
                    average: summary.average,
                    gradedCount: summary.gradedCount,
                    scheduledCount: summary.scheduledCount
                });
            }
        }

        // Sort by average descending
        summaries.sort(function(a, b) {
            if (b.average !== null && a.average !== null) {
                return b.average - a.average;
            }
            if (b.average !== null) {
                return 1;
            }
            if (a.average !== null) {
                return -1;
            }
            return 0;
        });

        return {
            totalStudents: students.length,
            gradedStudents: summaries.length,
            summaries: summaries,
            classAverage: calculateClassAverage(summaries)
        };
    }

    function calculateClassAverage(summaries) {
        if (!summaries || summaries.length === 0) {
            return null;
        }

        var total = 0;
        var count = 0;

        for (var i = 0; i < summaries.length; i++) {
            var s = summaries[i];
            if (s.average !== null) {
                total += s.average;
                count++;
            }
        }

        return count > 0 ? total / count : null;
    }

    // ============================================================
    // GRADE DISPLAY HELPERS
    // ============================================================

    function formatGrade(score) {
        if (score === undefined || score === null || score === '') {
            return '--';
        }
        var num = Number(score);
        if (!Number.isFinite(num)) {
            return '--';
        }
        return Math.round(num) + '%';
    }

    function formatWeightedScore(score, weight) {
        if (score === undefined || score === null || score === '') {
            return '--';
        }
        var num = Number(score);
        if (!Number.isFinite(num)) {
            return '--';
        }
        var w = Number(weight) || 1;
        return (num * w).toFixed(1);
    }

    function getGradeColor(score) {
        if (score === undefined || score === null || score === '') {
            return 'var(--text-dim)';
        }
        var num = Number(score);
        if (!Number.isFinite(num)) {
            return 'var(--text-dim)';
        }
        if (num >= 90) {
            return 'var(--accent)';
        }
        if (num >= 70) {
            return 'var(--info)';
        }
        if (num >= 50) {
            return 'var(--warning)';
        }
        return 'var(--danger)';
    }

    function getGradeStatus(score) {
        if (score === undefined || score === null || score === '') {
            return 'ungraded';
        }
        var num = Number(score);
        if (!Number.isFinite(num)) {
            return 'unknown';
        }
        if (num >= 70) {
            return 'passing';
        }
        return 'needs_work';
    }

    function getGradeStatusLabel(status) {
        var labels = {
            'unknown': 'Unknown',
            'ungraded': 'Ungraded',
            'passing': 'Passing',
            'needs_work': 'Needs Work'
        };
        return labels[status] || 'Unknown';
    }

    function getGradeStatusColor(status) {
        var colors = {
            'unknown': 'var(--text-dim)',
            'ungraded': 'var(--text-dim)',
            'passing': 'var(--accent)',
            'needs_work': 'var(--danger)'
        };
        return colors[status] || 'var(--text-dim)';
    }

    // ============================================================
    // GRADE VALIDATION
    // ============================================================

    function validateGradeInput(value) {
        if (value === undefined || value === null || value === '') {
            return { valid: true, value: null };
        }

        var num = Number(value);
        if (!Number.isFinite(num)) {
            return { valid: false, message: 'Must be a number.' };
        }

        if (num < 0 || num > 100) {
            return { valid: false, message: 'Must be between 0 and 100.' };
        }

        return { valid: true, value: Math.round(num * 10) / 10 };
    }

    function validateGradeInputs(inputs) {
        var errors = [];
        var validated = {};

        for (var disciplineId in inputs) {
            if (!Object.prototype.hasOwnProperty.call(inputs, disciplineId)) {
                continue;
            }

            var value = inputs[disciplineId];
            var result = validateGradeInput(value);

            if (!result.valid) {
                var d = AcademyQueries.getDiscipline(disciplineId);
                errors.push({
                    disciplineId: disciplineId,
                    disciplineName: d ? d.name : disciplineId,
                    message: result.message
                });
            } else {
                validated[disciplineId] = result.value;
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            validated: validated
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGrades = {
        // Queries
        getGrades: getGrades,
        getGrade: getGrade,
        hasGrade: hasGrade,
        getWeekGrades: getWeekGrades,
        getStudentGradeSummary: getStudentGradeSummary,
        getClassGradeSummary: getClassGradeSummary,
        getGradeLetter: getGradeLetter,

        // Mutations
        saveGrades: saveGrades,
        saveGrade: saveGrade,
        deleteGrade: deleteGrade,
        deleteWeekGrades: deleteWeekGrades,
        deleteStudentGrades: deleteStudentGrades,
        saveClassGrades: saveClassGrades,

        // Display helpers
        formatGrade: formatGrade,
        formatWeightedScore: formatWeightedScore,
        getGradeColor: getGradeColor,
        getGradeStatus: getGradeStatus,
        getGradeStatusLabel: getGradeStatusLabel,
        getGradeStatusColor: getGradeStatusColor,

        // Validation
        validateWeek: validateWeek,
        validateScore: validateScore,
        isValidScore: isValidScore,
        normalizeScore: normalizeScore,
        validateGradeInput: validateGradeInput,
        validateGradeInputs: validateGradeInputs,

        // Constants
        MIN_SCORE: 0,
        MAX_SCORE: 100,
        PASSING_THRESHOLD: 70
    };

})();