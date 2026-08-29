/**
 * js/core/curriculum/curriculum-grades.js - Grade Operations
 * Path: js/core/curriculum/curriculum-grades.js
 * 
 * This module provides grade CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Grades are stored as: grades[studentId][week][disciplineId] = score
 *   - Scores are numbers between 0 and 100
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumGradesLoaded) {
        return;
    }
    window.__curriculumGradesLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
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
        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });
        return discipline ? deepClone(discipline) : null;
    }

    function getAvailableDisciplines(week) {
        if (typeof window.getAvailableDisciplines === 'function') {
            return window.getAvailableDisciplines(week);
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }
        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') {
                return false;
            }
            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);
            if (start !== null && start > weekNum) {
                return false;
            }
            if (end !== null && end < weekNum) {
                return false;
            }
            return true;
        });
        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getStudentSchedule(studentId, week) {
        if (typeof window.getStudentSchedule === 'function') {
            return window.getStudentSchedule(studentId, week);
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return {};
        }
        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return {};
        }
        var weekSchedule = studentSchedule[weekNum];
        var result = {};
        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                continue;
            }
            var daySchedule = weekSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }
            result[day] = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                result[day][hour] = daySchedule[hour];
            }
        }
        return result;
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function isEmptyGradeValue(value) {
        return value === undefined ||
            value === null ||
            (typeof value === 'string' && value.trim() === '');
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumGrades: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumGrades: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithGrades(grades, operationType, count) {
        var cloned = deepClone(grades);
        if (cloned === null) {
            return failure('Failed to clone grade data.');
        }
        return {
            success: true,
            grades: cloned,
            operation: operationType || 'updated',
            count: count || 0
        };
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

        var grades = data.curriculum.grades[studentId][weekNum];
        var result = {};

        for (var key in grades) {
            if (Object.prototype.hasOwnProperty.call(grades, key)) {
                result[key] = grades[key];
            }
        }

        return result;
    }

    function getGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        if (grades[disciplineId] !== undefined) {
            return grades[disciplineId];
        }
        return null;
    }

    function hasGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        return !isEmptyGradeValue(grades[disciplineId]);
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
            if (!Object.prototype.hasOwnProperty.call(data.curriculum.grades, studentId)) {
                continue;
            }
            var studentGrades = data.curriculum.grades[studentId];
            if (studentGrades && studentGrades[weekNum]) {
                var weekGrades = studentGrades[weekNum];
                var cloned = {};
                for (var key in weekGrades) {
                    if (Object.prototype.hasOwnProperty.call(weekGrades, key)) {
                        cloned[key] = weekGrades[key];
                    }
                }
                result[studentId] = cloned;
            }
        }

        return result;
    }

    // ============================================================
    // GRADE MUTATIONS
    // ============================================================

    function saveGrades(studentId, week, grades) {
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

        var validatedGrades = {};
        var invalidDisciplines = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var value = grades[disciplineId];

            if (isEmptyGradeValue(value)) {
                validatedGrades[disciplineId] = null;
                continue;
            }

            var discipline = getDiscipline(disciplineId);
            if (!discipline) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            var numericScore = Number(value);
            if (!isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            validatedGrades[disciplineId] = Math.round(numericScore * 10) / 10;
        }

        if (invalidDisciplines.length > 0) {
            var disciplineNames = invalidDisciplines.map(function(id) {
                var d = getDiscipline(id);
                return d ? d.name : id;
            });
            return failure('Invalid disciplines: ' + disciplineNames.join(', ') + '.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.grades || {});
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        if (!candidate[studentId]) {
            candidate[studentId] = {};
        }

        if (!candidate[studentId][weekNum]) {
            candidate[studentId][weekNum] = {};
        }

        var candidateGrades = candidate[studentId][weekNum];
        var actualChanges = 0;

        for (var disciplineId in validatedGrades) {
            if (!Object.prototype.hasOwnProperty.call(validatedGrades, disciplineId)) {
                continue;
            }

            var newValue = validatedGrades[disciplineId];
            var oldValue = candidateGrades[disciplineId];

            if (newValue === null) {
                if (oldValue !== undefined) {
                    delete candidateGrades[disciplineId];
                    actualChanges++;
                }
            } else {
                if (oldValue !== newValue) {
                    candidateGrades[disciplineId] = newValue;
                    actualChanges++;
                }
            }
        }

        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        data.curriculum.grades = candidate;

        var logMessage = 'Updated grades for student week ' + weekNum;
        if (actualChanges > 0) {
            logMessage += ' (' + actualChanges + ' changes)';
        } else {
            logMessage += ' (no changes)';
        }
        logActivity(logMessage);

        return successWithGrades(
            resultGrades,
            actualChanges > 0 ? 'updated' : 'unchanged',
            actualChanges
        );
    }

    function saveGrade(studentId, week, disciplineId, score) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        if (!isEmptyGradeValue(score)) {
            var discipline = getDiscipline(disciplineId);
            if (!discipline) {
                return failure('Discipline not found.');
            }
        }

        var numericScore = null;

        if (!isEmptyGradeValue(score)) {
            numericScore = Number(score);
            if (!isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
                return failure('Score must be between 0 and 100.');
            }
            numericScore = Math.round(numericScore * 10) / 10;
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.grades || {});
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        if (!candidate[studentId]) {
            candidate[studentId] = {};
        }

        if (!candidate[studentId][weekNum]) {
            candidate[studentId][weekNum] = {};
        }

        var candidateGrades = candidate[studentId][weekNum];
        var oldValue = candidateGrades[disciplineId];
        var changed = false;

        if (numericScore !== null) {
            if (oldValue !== numericScore) {
                candidateGrades[disciplineId] = numericScore;
                changed = true;
            }
        } else {
            if (oldValue !== undefined) {
                delete candidateGrades[disciplineId];
                changed = true;
            }
        }

        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        data.curriculum.grades = candidate;

        var action = numericScore !== null ? 'saved' : 'deleted';
        if (changed) {
            logActivity(action + ' grade for ' + disciplineId + ' week ' + weekNum);
        } else {
            logActivity('No change to grade for ' + disciplineId + ' week ' + weekNum);
        }

        return successWithGrades(
            resultGrades,
            changed ? (numericScore !== null ? 'saved' : 'deleted') : 'unchanged',
            changed ? 1 : 0
        );
    }

    function deleteGrade(studentId, week, disciplineId) {
        return saveGrade(studentId, week, disciplineId, null);
    }

    function deleteWeekGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return success({ deleted: false, message: 'No grades found.' });
        }

        if (!data.curriculum.grades[studentId] || !data.curriculum.grades[studentId][weekNum]) {
            return success({ deleted: false, message: 'No grades for this week.' });
        }

        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId][weekNum];

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        data.curriculum.grades = candidate;

        logActivity('Deleted all grades for week ' + weekNum);
        return success({ deleted: true });
    }

    function deleteStudentGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return success({ deleted: false, message: 'No grades found.' });
        }

        if (!data.curriculum.grades[studentId]) {
            return success({ deleted: false, message: 'No grades for this student.' });
        }

        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId];

        data.curriculum.grades = candidate;

        logActivity('Deleted all grades for student');
        return success({ deleted: true });
    }

    // ============================================================
    // GRADE SUMMARY
    // ============================================================

    function getStudentDisciplineIds(schedule) {
        var ids = [];
        if (!schedule || typeof schedule !== 'object') {
            return ids;
        }

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
        var disciplines = getAvailableDisciplines(weekNum);
        if (!Array.isArray(disciplines)) {
            disciplines = [];
        }

        var studentSchedule = getStudentSchedule(studentId, weekNum);
        var studentDisciplineIds = getStudentDisciplineIds(studentSchedule);

        var totalWeighted = 0;
        var totalWeight = 0;
        var gradedCount = 0;
        var gradedWeightedCount = 0;
        var mandatoryScheduled = 0;
        var mandatoryGraded = 0;
        var optionalScheduled = 0;
        var optionalGraded = 0;
        var scheduledCount = 0;
        var hasGrades = false;

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var isInSchedule = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            if (!isInSchedule) {
                continue;
            }
            scheduledCount++;

            var score = grades[d.id];
            var hasValidGrade = !isEmptyGradeValue(score);

            if (hasValidGrade) {
                var numericScore = Number(score);
                if (isFinite(numericScore) && numericScore >= 0 && numericScore <= 100) {
                    gradedCount++;
                    hasGrades = true;

                    if (d.type === 'mandatory') {
                        mandatoryGraded++;
                    } else if (d.type === 'optional') {
                        optionalGraded++;
                    }

                    var weight = Number(d.weight);
                    if (isFinite(weight) && weight > 0) {
                        gradedWeightedCount++;
                        totalWeighted += numericScore * weight;
                        totalWeight += weight;
                    }
                }
            }

            if (d.type === 'mandatory') {
                mandatoryScheduled++;
            } else if (d.type === 'optional') {
                optionalScheduled++;
            }
        }

        var average = totalWeight > 0 ? totalWeighted / totalWeight : null;

        return {
            average: average,
            totalWeighted: totalWeighted,
            totalWeight: totalWeight,
            gradedCount: gradedCount,
            gradedWeightedCount: gradedWeightedCount,
            availableCount: disciplines.length,
            scheduledCount: scheduledCount,
            mandatoryScheduled: mandatoryScheduled,
            mandatoryGraded: mandatoryGraded,
            optionalScheduled: optionalScheduled,
            optionalGraded: optionalGraded,
            hasGrades: hasGrades
        };
    }

    function calculateGradeLetter(studentId, week, disciplineId) {
        var score = getGrade(studentId, week, disciplineId);
        if (score === null) {
            return null;
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        if (typeof window.getGradeLetter === 'function') {
            return window.getGradeLetter(discipline, score);
        }

        // Fallback: simple letter grade
        var numScore = Number(score);
        if (!isFinite(numScore)) {
            return '';
        }

        if (numScore >= 90) return 'A';
        if (numScore >= 80) return 'B';
        if (numScore >= 70) return 'C';
        if (numScore >= 60) return 'D';
        return 'F';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getGrades = getGrades;
    window.getGrade = getGrade;
    window.hasGrade = hasGrade;
    window.getWeekGrades = getWeekGrades;

    // Mutations
    window.saveGrades = saveGrades;
    window.saveGrade = saveGrade;
    window.deleteGrade = deleteGrade;
    window.deleteWeekGrades = deleteWeekGrades;
    window.deleteStudentGrades = deleteStudentGrades;

    // Summary
    window.calculateGradeSummary = calculateGradeSummary;
    window.calculateGradeLetter = calculateGradeLetter;
    window.getStudentDisciplineIds = getStudentDisciplineIds;

})();
