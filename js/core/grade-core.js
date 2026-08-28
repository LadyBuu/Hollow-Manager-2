/**
 * core/grade-core.js - Grade Core Operations
 * Single source of truth for all grade-related data mutations
 * Path: js/core/grade-core.js
 * 
 * This module handles:
 *   - Grade CRUD (get, save, delete)
 *   - Grade summary calculation
 *   - Grade validation (0-100 range)
 *   - Discipline availability filtering
 *   - Weighted average calculation
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * GRADE SEMANTICS:
 *   - Grades are stored as: grades[studentId][week][disciplineId] = score
 *   - Scores are numbers between 0 and 100
 *   - Setting a grade to undefined deletes it
 *   - Grades are only counted for disciplines the student is scheduled in
 *   - Letter grades are calculated from the discipline's grading system
 *   - Weighted average uses discipline.weight
 *   - Undefined/empty values are treated as "no grade" (not counted)
 *   - Saving preserves existing grades and only updates changed fields
 */

(function() {
    'use strict';

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getStudentSchedule(studentId, week) {
        if (typeof window.getStudentSchedule === 'function') {
            return window.getStudentSchedule(studentId, week);
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) return {};

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) return {};

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) return {};

        return studentSchedule[weekNum];
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function ensureGradeStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        if (!data.curriculum.grades || typeof data.curriculum.grades !== 'object') {
            data.curriculum.grades = {};
        }

        return data;
    }

    // ============================================================
    // GRADE QUERIES
    // ============================================================

    function getGrades(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        if (!data.curriculum.grades[studentId]) {
            return {};
        }

        if (!data.curriculum.grades[studentId][weekNum]) {
            return {};
        }

        return data.curriculum.grades[studentId][weekNum];
    }

    function getGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        return grades[disciplineId] !== undefined ? grades[disciplineId] : null;
    }

    function getAllStudentGrades(studentId) {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        if (!data.curriculum.grades[studentId]) {
            return {};
        }

        return data.curriculum.grades[studentId];
    }

    function getWeekGrades(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        var result = {};

        for (var studentId in data.curriculum.grades) {
            if (!Object.prototype.hasOwnProperty.call(data.curriculum.grades, studentId)) continue;
            var studentGrades = data.curriculum.grades[studentId];
            if (studentGrades && studentGrades[weekNum]) {
                result[studentId] = studentGrades[weekNum];
            }
        }

        return result;
    }

    function getDisciplineGrades(disciplineId) {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        var result = {};

        for (var studentId in data.curriculum.grades) {
            if (!Object.prototype.hasOwnProperty.call(data.curriculum.grades, studentId)) continue;
            var studentGrades = data.curriculum.grades[studentId];

            for (var week in studentGrades) {
                if (!Object.prototype.hasOwnProperty.call(studentGrades, week)) continue;
                var weekGrades = studentGrades[week];
                if (weekGrades && weekGrades[disciplineId] !== undefined) {
                    if (!result[studentId]) result[studentId] = {};
                    result[studentId][week] = weekGrades[disciplineId];
                }
            }
        }

        return result;
    }

    function hasGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        return grades[disciplineId] !== undefined && grades[disciplineId] !== null && grades[disciplineId] !== '';
    }

    // ============================================================
    // GRADE SUMMARY
    // ============================================================

    function calculateGradeSummary(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var data = getDataStore();
        if (!data || !data.curriculum) {
            return null;
        }

        var grades = getGrades(studentId, weekNum);

        // Get available disciplines for this week
        var disciplines = getAvailableDisciplines(weekNum);
        if (!Array.isArray(disciplines)) disciplines = [];

        var studentSchedule = getStudentSchedule(studentId, weekNum);
        var studentDisciplineIds = getStudentDisciplineIds(studentSchedule);

        var totalWeighted = 0;
        var totalWeight = 0;
        var count = 0;
        var mandatoryCount = 0;
        var optionalCount = 0;
        var scheduledCount = 0;
        var hasGrades = false;

        disciplines.forEach(function(d) {
            var isInSchedule = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            if (!isInSchedule) return;
            scheduledCount++;

            var score = grades[d.id];
            if (score !== undefined && score !== null && score !== '' && d.weight) {
                var numericScore = Number(score);
                if (isFinite(numericScore)) {
                    totalWeighted += numericScore * d.weight;
                    totalWeight += d.weight;
                    count++;
                    hasGrades = true;
                    if (d.type === 'mandatory') mandatoryCount++;
                    else if (d.type === 'optional') optionalCount++;
                }
            }
        });

        var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;

        return {
            average: average,
            totalWeighted: totalWeighted,
            totalWeight: totalWeight,
            count: count,
            total: disciplines.length,
            scheduledCount: scheduledCount,
            mandatoryCount: mandatoryCount,
            optionalCount: optionalCount,
            hasGrades: hasGrades,
            gradeCount: count
        };
    }

    function calculateGradeLetter(studentId, week, disciplineId) {
        var score = getGrade(studentId, week, disciplineId);
        if (score === null) return null;

        var discipline = getDiscipline(disciplineId);
        if (!discipline) return null;

        return getGradeLetter(discipline, score);
    }

    function getGradeLetter(discipline, score) {
        if (!discipline || !Array.isArray(discipline.gradingSystem) || discipline.gradingSystem.length === 0) {
            return '';
        }

        var numScore = Number(score);
        if (!isFinite(numScore) || numScore < 0 || numScore > 100) {
            return '';
        }

        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return (b.min || 0) - (a.min || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);

            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                return grade.letter;
            }
        }

        return '';
    }

    function getStudentDisciplineIds(schedule) {
        var ids = [];
        if (!schedule || typeof schedule !== 'object') return ids;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var disciplineId = daySchedule[hour];
                if (disciplineId && ids.indexOf(disciplineId) === -1) {
                    ids.push(disciplineId);
                }
            }
        }
        return ids;
    }

    function getAvailableDisciplines(week) {
        if (typeof window.getAvailableDisciplines === 'function') {
            return window.getAvailableDisciplines(week);
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) return [];

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        return data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') return false;

            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);

            if (start !== null && start > weekNum) return false;
            if (end !== null && end < weekNum) return false;

            return true;
        });
    }

    function getGradeStatus(summary) {
        if (!summary) return 'unknown';

        if (!summary.hasGrades) {
            return 'ungraded';
        }

        if (summary.average >= 70) {
            return 'passing';
        }

        return 'needs_work';
    }

    function getGradeStatusLabel(status) {
        var labels = {
            'unknown': 'Unknown',
            'ungraded': 'Not Graded',
            'passing': '✓ Passing',
            'needs_work': '⚠ Needs Work'
        };
        return labels[status] || status;
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
    // GRADE MUTATIONS
    // ============================================================

    function saveGrades(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!isObject(grades)) {
            return { success: false, message: 'Grades must be an object.' };
        }

        // ---- PHASE 2: VALIDATE EACH GRADE ----
        var validatedGrades = {};
        var invalidDisciplines = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) continue;

            var value = grades[disciplineId];

            // undefined means delete this grade
            if (value === undefined) {
                continue;
            }

            // Empty string means delete this grade
            if (value === '' || value === null) {
                continue;
            }

            var numericScore = Number(value);
            if (!isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            // Round to 1 decimal place
            validatedGrades[disciplineId] = Math.round(numericScore * 10) / 10;
        }

        if (invalidDisciplines.length > 0) {
            var disciplineNames = invalidDisciplines.map(function(id) {
                var d = getDiscipline(id);
                return d ? d.name : id;
            });
            return {
                success: false,
                message: 'Invalid scores for: ' + disciplineNames.join(', ') + '. Please enter values between 0 and 100.'
            };
        }

        // ---- PHASE 3: APPLY ----
        var store = ensureGradeStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!store.curriculum.grades[studentId]) {
            store.curriculum.grades[studentId] = {};
        }

        if (!store.curriculum.grades[studentId][weekNum]) {
            store.curriculum.grades[studentId][weekNum] = {};
        }

        var existingGrades = store.curriculum.grades[studentId][weekNum];

        // Apply changes
        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) continue;

            var value = grades[disciplineId];

            if (value === undefined || value === '' || value === null) {
                delete existingGrades[disciplineId];
            } else if (validatedGrades[disciplineId] !== undefined) {
                existingGrades[disciplineId] = validatedGrades[disciplineId];
            }
        }

        // Clean up empty student/grade entries
        if (Object.keys(existingGrades).length === 0) {
            delete store.curriculum.grades[studentId][weekNum];
        }

        if (Object.keys(store.curriculum.grades[studentId]).length === 0) {
            delete store.curriculum.grades[studentId];
        }

        var count = Object.keys(existingGrades).length;
        logActivity('Saved ' + count + ' grades for student week ' + weekNum);

        return { success: true, gradeCount: count };
    }

    function saveGrade(studentId, week, disciplineId, score) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        // ---- PHASE 2: VALIDATE SCORE ----
        var numericScore = null;

        if (score !== undefined && score !== null && score !== '') {
            numericScore = Number(score);
            if (!isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
                return {
                    success: false,
                    message: 'Score must be between 0 and 100.'
                };
            }
            numericScore = Math.round(numericScore * 10) / 10;
        }

        // ---- PHASE 3: APPLY ----
        var store = ensureGradeStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        if (!store.curriculum.grades[studentId]) {
            store.curriculum.grades[studentId] = {};
        }

        if (!store.curriculum.grades[studentId][weekNum]) {
            store.curriculum.grades[studentId][weekNum] = {};
        }

        var existingGrades = store.curriculum.grades[studentId][weekNum];

        if (numericScore !== null) {
            existingGrades[disciplineId] = numericScore;
        } else {
            delete existingGrades[disciplineId];
        }

        // Clean up empty entries
        if (Object.keys(existingGrades).length === 0) {
            delete store.curriculum.grades[studentId][weekNum];
        }

        if (Object.keys(store.curriculum.grades[studentId]).length === 0) {
            delete store.curriculum.grades[studentId];
        }

        var action = numericScore !== null ? 'saved' : 'deleted';
        logActivity(action + ' grade for ' + discipline.name + ' week ' + weekNum);

        return { success: true };
    }

    function deleteGrade(studentId, week, disciplineId) {
        return saveGrade(studentId, week, disciplineId, null);
    }

    function deleteWeekGrades(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return { success: true };
        }

        if (!data.curriculum.grades[studentId] || !data.curriculum.grades[studentId][weekNum]) {
            return { success: true };
        }

        delete data.curriculum.grades[studentId][weekNum];

        if (Object.keys(data.curriculum.grades[studentId]).length === 0) {
            delete data.curriculum.grades[studentId];
        }

        logActivity('Deleted all grades for week ' + weekNum);
        return { success: true };
    }

    function deleteStudentGrades(studentId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        // ---- PHASE 2: APPLY ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return { success: true };
        }

        if (!data.curriculum.grades[studentId]) {
            return { success: true };
        }

        delete data.curriculum.grades[studentId];

        logActivity('Deleted all grades for student');
        return { success: true };
    }

    // ============================================================
    // GRADE COMPARISON HELPERS
    // ============================================================

    function getGradeChange(studentId, disciplineId, fromWeek, toWeek) {
        var fromScore = getGrade(studentId, fromWeek, disciplineId);
        var toScore = getGrade(studentId, toWeek, disciplineId);

        if (fromScore === null && toScore === null) return null;
        if (fromScore === null) return { from: null, to: toScore, change: null };
        if (toScore === null) return { from: fromScore, to: null, change: null };

        return {
            from: fromScore,
            to: toScore,
            change: toScore - fromScore
        };
    }

    function getGradeTrend(studentId, disciplineId, weeks) {
        if (!Array.isArray(weeks) || weeks.length < 2) return null;

        var scores = [];
        for (var i = 0; i < weeks.length; i++) {
            var score = getGrade(studentId, weeks[i], disciplineId);
            if (score !== null) {
                scores.push({
                    week: weeks[i],
                    score: score
                });
            }
        }

        if (scores.length < 2) return null;

        // Simple trend: average change per week
        var totalChange = 0;
        for (var i = 1; i < scores.length; i++) {
            totalChange += scores[i].score - scores[i - 1].score;
        }

        return {
            scores: scores,
            averageChange: totalChange / (scores.length - 1),
            direction: totalChange > 0 ? 'improving' : (totalChange < 0 ? 'declining' : 'stable')
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GradeCore = {
        // Queries
        getGrades: getGrades,
        getGrade: getGrade,
        getAllStudentGrades: getAllStudentGrades,
        getWeekGrades: getWeekGrades,
        getDisciplineGrades: getDisciplineGrades,
        hasGrade: hasGrade,

        // Summary
        calculateGradeSummary: calculateGradeSummary,
        calculateGradeLetter: calculateGradeLetter,
        getGradeLetter: getGradeLetter,
        getGradeStatus: getGradeStatus,
        getGradeStatusLabel: getGradeStatusLabel,
        getGradeStatusColor: getGradeStatusColor,

        // Mutations
        saveGrades: saveGrades,
        saveGrade: saveGrade,
        deleteGrade: deleteGrade,
        deleteWeekGrades: deleteWeekGrades,
        deleteStudentGrades: deleteStudentGrades,

        // Comparison
        getGradeChange: getGradeChange,
        getGradeTrend: getGradeTrend,

        // Helpers
        getStudentDisciplineIds: getStudentDisciplineIds
    };

})();
