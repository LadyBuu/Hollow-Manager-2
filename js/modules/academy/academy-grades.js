/**
 * js/modules/academy/academy-grades.js - Academy Grade Domain
 * Single source of truth for all grade operations within the Academy
 * Path: js/modules/academy/academy-grades.js
 * 
 * This module handles:
 *   - Grade CRUD operations
 *   - Grade validation (0-100 range)
 *   - Grade summary calculation
 *   - Class grade summaries
 *   - Bulk grade operations (atomic)
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for grades
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - Bulk operations are ATOMIC: all or nothing
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.ActivityLog (from activity-log.js)
 * 
 * USAGE:
 *   var grades = window.AcademyGrades;
 *   var result = grades.saveGrades(studentId, week, gradeData);
 *   var summary = grades.calculateSummary(studentId, week);
 *   var classSummary = grades.getClassSummary(classId, week);
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

    var ObjectUtils = window.ObjectUtils;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
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
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;
    var PASSING_THRESHOLD = 70;

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // VALIDATION HELPERS - Strict validation
    // ============================================================

    function validateWeek(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    function validateScore(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || num < MIN_SCORE || num > MAX_SCORE) {
            return null;
        }
        return Math.round(num * 10) / 10;
    }

    function validateStudentId(studentId) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return { valid: false, message: 'Student not found.' };
        }
        return { valid: true, student: student };
    }

    function validateDisciplineId(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, discipline: discipline };
    }

    function validateGradeData(studentId, week, grades) {
        // Validate student
        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return studentResult;
        }

        // Validate week
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        // Validate grades object
        if (!isObject(grades)) {
            return { valid: false, message: 'Grades must be an object.' };
        }

        // Validate each discipline and score
        var validatedGrades = {};
        var errors = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var value = grades[disciplineId];
            var discResult = validateDisciplineId(disciplineId);
            if (!discResult.valid) {
                errors.push(discResult.message);
                continue;
            }

            // Empty value means delete this grade
            if (value === undefined || value === null || value === '') {
                validatedGrades[disciplineId] = null;
                continue;
            }

            var score = validateScore(value);
            if (score === null) {
                errors.push('Invalid score for ' + discResult.discipline.name + ': must be between ' + MIN_SCORE + ' and ' + MAX_SCORE + '.');
                continue;
            }

            validatedGrades[disciplineId] = score;
        }

        if (errors.length > 0) {
            return { valid: false, message: errors.join(' ') };
        }

        return {
            valid: true,
            studentId: studentId,
            student: studentResult.student,
            week: weekNum,
            grades: validatedGrades
        };
    }

    function validateBulkGradeData(classId, week, gradeData) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
        }

        if (!isObject(gradeData)) {
            return { valid: false, message: 'Grade data must be an object.' };
        }

        var classStudents = AcademyQueries.getClassStudents(classId);
        if (classStudents.length === 0) {
            return { valid: false, message: 'No students in this class.' };
        }

        var studentMap = {};
        for (var i = 0; i < classStudents.length; i++) {
            studentMap[classStudents[i].id] = classStudents[i];
        }

        var validated = {};
        var errors = [];

        for (var studentId in gradeData) {
            if (!Object.prototype.hasOwnProperty.call(gradeData, studentId)) {
                continue;
            }

            // Check if student is in the class
            if (!studentMap[studentId]) {
                errors.push('Student ' + studentId + ' is not in this class.');
                continue;
            }

            var studentGrades = gradeData[studentId];
            if (!isObject(studentGrades)) {
                errors.push('Invalid grade data for student ' + studentId + '.');
                continue;
            }

            var result = validateGradeData(studentId, weekNum, studentGrades);
            if (!result.valid) {
                errors.push('Student ' + (studentMap[studentId].firstName || studentId) + ': ' + result.message);
                continue;
            }

            validated[studentId] = result.grades;
        }

        if (errors.length > 0) {
            return { valid: false, message: errors.join('; ') };
        }

        if (Object.keys(validated).length === 0) {
            return { valid: false, message: 'No valid grade data provided.' };
        }

        return {
            valid: true,
            classId: classId,
            week: weekNum,
            validated: validated,
            studentMap: studentMap
        };
    }

    // ============================================================
    // GRADE QUERIES
    // ============================================================

    function getGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        var grades = data.curriculum.grades;
        if (!grades[studentId] || !grades[studentId][weekNum]) {
            return {};
        }

        return deepClone(grades[studentId][weekNum]) || {};
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

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        var grades = data.curriculum.grades;
        if (!isObject(grades)) {
            return {};
        }

        var result = {};
        for (var studentId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, studentId)) {
                continue;
            }
            var studentGrades = grades[studentId];
            if (isObject(studentGrades) && studentGrades[weekNum]) {
                result[studentId] = deepClone(studentGrades[weekNum]);
            }
        }

        return result;
    }

    // ============================================================
    // GRADE SUMMARY
    // ============================================================

    function calculateSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var grades = getGrades(studentId, weekNum);
        var disciplines = AcademyQueries.getAvailableDisciplines(weekNum);
        if (!Array.isArray(disciplines)) {
            disciplines = [];
        }

        var schedule = AcademyQueries.getStudentSchedule(studentId, weekNum);
        var studentDisciplineIds = getStudentDisciplineIds(schedule);

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
            var isInSchedule = false;
            for (var j = 0; j < studentDisciplineIds.length; j++) {
                if (String(studentDisciplineIds[j]) === String(d.id)) {
                    isInSchedule = true;
                    break;
                }
            }

            if (!isInSchedule) {
                continue;
            }
            scheduledCount++;

            var score = grades[d.id];
            var hasValidGrade = false;
            var numericScore = null;

            if (score !== undefined && score !== null && score !== '') {
                numericScore = validateScore(score);
                if (numericScore !== null) {
                    hasValidGrade = true;
                }
            }

            if (hasValidGrade) {
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

    // ============================================================
    // CLASS GRADE SUMMARY
    // ============================================================

    function getClassSummary(classId, week) {
        if (!isNonEmptyString(classId)) {
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
            var summary = calculateSummary(student.id, weekNum);
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
    // GRADE MUTATIONS - Candidate-based
    // ============================================================

    function saveGrades(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateGradeData(studentId, week, grades);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validatedGrades = validation.grades;

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingGrades = data.curriculum.grades;
        if (!isObject(existingGrades)) {
            return failure('Grade data store is corrupted.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(existingGrades || {});
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        if (!isObject(candidate[studentId])) {
            candidate[studentId] = {};
        }

        if (!isObject(candidate[studentId][weekNum])) {
            candidate[studentId][weekNum] = {};
        }

        var candidateGrades = candidate[studentId][weekNum];
        var actualChanges = 0;

        // ---- PHASE 4: APPLY CHANGES ----
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

        // Clean up empty entries
        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 5: GET RESULT ----
        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 6: COMMIT ----
        data.curriculum.grades = candidate;

        // ---- PHASE 7: LOG ----
        var studentName = CharacterQueries.getDisplayName(validation.student);
        var logMessage = 'Saved grades for ' + studentName + ' (' + studentId + '), week ' + weekNum;
        if (actualChanges > 0) {
            logMessage += ' (' + actualChanges + ' changes)';
        } else {
            logMessage += ' (no changes)';
        }
        recordActivity(logMessage);

        return success({
            result: resultGrades,
            changed: actualChanges > 0,
            count: actualChanges
        });
    }

    function saveGrade(studentId, week, disciplineId, score) {
        var grades = {};
        grades[disciplineId] = score;
        return saveGrades(studentId, week, grades);
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
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var data = getDataStore();
        if (!data || !data.curriculum) {
            return failure('Data store is not available.');
        }

        var existingGrades = data.curriculum.grades;
        if (!isObject(existingGrades)) {
            return failure('Grade data store is corrupted.');
        }

        if (!existingGrades[studentId] || !existingGrades[studentId][weekNum]) {
            return success({
                result: {},
                changed: false,
                count: 0
            });
        }

        var candidate = deepClone(existingGrades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        var weekGrades = candidate[studentId][weekNum];
        var deletedCount = Object.keys(weekGrades).length;

        delete candidate[studentId][weekNum];

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        data.curriculum.grades = candidate;

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Deleted all grades for ' + studentName + ' week ' + weekNum + ' (' + deletedCount + ' grades)');

        return success({
            result: {},
            changed: true,
            count: deletedCount
        });
    }

    function deleteStudentGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data || !data.curriculum) {
            return failure('Data store is not available.');
        }

        var existingGrades = data.curriculum.grades;
        if (!isObject(existingGrades)) {
            return failure('Grade data store is corrupted.');
        }

        if (!existingGrades[studentId]) {
            return success({
                result: {},
                changed: false,
                count: 0
            });
        }

        var candidate = deepClone(existingGrades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        var studentGrades = candidate[studentId];
        var deletedCount = 0;
        for (var week in studentGrades) {
            if (Object.prototype.hasOwnProperty.call(studentGrades, week)) {
                var weekGrades = studentGrades[week];
                if (isObject(weekGrades)) {
                    deletedCount += Object.keys(weekGrades).length;
                }
            }
        }

        delete candidate[studentId];

        data.curriculum.grades = candidate;

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Deleted all grades for ' + studentName + ' (' + deletedCount + ' grades)');

        return success({
            result: {},
            changed: true,
            count: deletedCount
        });
    }

    // ============================================================
    // BULK GRADE OPERATIONS - ATOMIC
    // ============================================================

    function saveClassGrades(classId, week, gradeData) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateBulkGradeData(classId, week, gradeData);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validated = validation.validated;
        var studentMap = validation.studentMap;

        if (Object.keys(validated).length === 0) {
            return failure('No valid grade data to save.');
        }

        // ---- PHASE 2: BUILD COMPLETE MUTATION PLAN ----
        var plan = [];
        for (var studentId in validated) {
            if (!Object.prototype.hasOwnProperty.call(validated, studentId)) {
                continue;
            }
            plan.push({
                studentId: studentId,
                student: studentMap[studentId],
                grades: validated[studentId]
            });
        }

        // ---- PHASE 3: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingGrades = data.curriculum.grades;
        if (!isObject(existingGrades)) {
            return failure('Grade data store is corrupted.');
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existingGrades || {});
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        // ---- PHASE 5: APPLY ALL CHANGES TO CANDIDATE ----
        var totalChanges = 0;
        var processedStudents = [];

        for (var i = 0; i < plan.length; i++) {
            var item = plan[i];
            var studentId = item.studentId;
            var grades = item.grades;

            if (!isObject(candidate[studentId])) {
                candidate[studentId] = {};
            }

            if (!isObject(candidate[studentId][weekNum])) {
                candidate[studentId][weekNum] = {};
            }

            var candidateGrades = candidate[studentId][weekNum];

            for (var disciplineId in grades) {
                if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                    continue;
                }

                var newValue = grades[disciplineId];
                var oldValue = candidateGrades[disciplineId];

                if (newValue === null) {
                    if (oldValue !== undefined) {
                        delete candidateGrades[disciplineId];
                        totalChanges++;
                    }
                } else {
                    if (oldValue !== newValue) {
                        candidateGrades[disciplineId] = newValue;
                        totalChanges++;
                    }
                }
            }

            // Clean up empty entries
            if (Object.keys(candidateGrades).length === 0) {
                delete candidate[studentId][weekNum];
            }

            if (Object.keys(candidate[studentId]).length === 0) {
                delete candidate[studentId];
            }

            processedStudents.push(studentId);
        }

        // ---- PHASE 6: GET RESULT ----
        var result = {};
        for (var i = 0; i < processedStudents.length; i++) {
            var sid = processedStudents[i];
            if (candidate[sid] && candidate[sid][weekNum]) {
                result[sid] = candidate[sid][weekNum];
            } else {
                result[sid] = {};
            }
        }

        // ---- PHASE 7: COMMIT ----
        data.curriculum.grades = candidate;

        // ---- PHASE 8: LOG ----
        var className = 'Unknown';
        var cls = AcademyQueries.getClass(classId);
        if (cls) {
            className = cls.name;
        }
        recordActivity('Saved grades for class ' + className + ' week ' + weekNum + ' (' + processedStudents.length + ' students, ' + totalChanges + ' changes)');

        return success({
            result: result,
            studentsProcessed: processedStudents.length,
            totalChanges: totalChanges,
            changed: totalChanges > 0
        });
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

        // Summary
        calculateSummary: calculateSummary,
        getClassSummary: getClassSummary,

        // Mutations
        saveGrades: saveGrades,
        saveGrade: saveGrade,
        deleteGrade: deleteGrade,
        deleteWeekGrades: deleteWeekGrades,
        deleteStudentGrades: deleteStudentGrades,
        saveClassGrades: saveClassGrades,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validateScore: validateScore,

        // Constants
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        PASSING_THRESHOLD: PASSING_THRESHOLD
    };

})();