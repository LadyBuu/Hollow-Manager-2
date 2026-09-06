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
 *   - Bulk grade operations (atomic candidate construction)
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for grades
 *   - All mutations are candidate-based: validate, clone, modify, return candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - Bulk operations construct a single candidate mutation
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
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
    var ClassesQueries = window.ClassesQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

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
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.isStudent !== 'function') {
            missing.push('CharacterQueries.isStudent');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }
        if (!DisciplineQueries || typeof DisciplineQueries.getAvailableDisciplines !== 'function') {
            missing.push('DisciplineQueries.getAvailableDisciplines');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            throw new Error('AcademyGrades: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - Read-only
    // ============================================================

    function getGradesStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.curriculum || typeof window.data.curriculum !== 'object') {
            return null;
        }
        return window.data.curriculum.grades;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateScore(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        // Trim whitespace from strings
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') {
                return null;
            }
            value = trimmed;
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
        if (!CharacterQueries.isStudent(student)) {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateDisciplineId(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }
        return { valid: true, discipline: discipline };
    }

    function validateGradeData(studentId, week, grades) {
        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return studentResult;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').' };
        }

        if (!isObject(grades)) {
            return { valid: false, message: 'Grades must be an object.' };
        }

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

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').' };
        }

        if (!isObject(gradeData)) {
            return { valid: false, message: 'Grade data must be an object.' };
        }

        var classStudents = ClassesQueries.getCharactersByClass(classId);
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var store = getGradesStore();
        if (!store || typeof store !== 'object') {
            return {};
        }

        var grades = store;
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
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return {};
        }

        var store = getGradesStore();
        if (!store || typeof store !== 'object') {
            return {};
        }

        var grades = store;
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

    function getStudentScheduledDisciplineIds(schedule) {
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

    function calculateSummary(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var grades = getGrades(studentId, weekNum);
        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum);
        if (!Array.isArray(disciplines)) {
            disciplines = [];
        }

        // This should use a schedule query to get the student's schedule
        // For now, we assume all available disciplines are scheduled
        var studentDisciplineIds = [];
        // Ideally: CalendarScheduleQueries.getScheduledDisciplineIds(studentId, weekNum)

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

    // ============================================================
    // CLASS GRADE SUMMARY
    // ============================================================

    function getClassSummary(classId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var students = ClassesQueries.getCharactersByClass(classId);
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
    // CANDIDATE MUTATION FUNCTIONS - No direct commit
    // ============================================================

    /**
     * Apply grade changes to a candidate object.
     * This is the shared engine for both single and bulk operations.
     */
    function applyGradeChangesToCandidate(candidate, studentId, weekNum, grades) {
        if (!candidate) {
            candidate = {};
        }

        if (!isObject(candidate[studentId])) {
            candidate[studentId] = {};
        }

        if (!isObject(candidate[studentId][weekNum])) {
            candidate[studentId][weekNum] = {};
        }

        var candidateGrades = candidate[studentId][weekNum];
        var changes = 0;

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var newValue = grades[disciplineId];
            var oldValue = candidateGrades[disciplineId];

            if (newValue === null) {
                if (oldValue !== undefined) {
                    delete candidateGrades[disciplineId];
                    changes++;
                }
            } else {
                if (oldValue !== newValue) {
                    candidateGrades[disciplineId] = newValue;
                    changes++;
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

        return changes;
    }

    /**
     * Build a candidate for saving grades for a single student.
     */
    function buildSaveGradesCandidate(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateGradeData(studentId, week, grades);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validatedGrades = validation.grades;
        var student = validation.student;

        // ---- PHASE 2: GET STORE ----
        var store = getGradesStore();
        var existingGrades = (store && isObject(store)) ? store : {};

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(existingGrades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        var changes = applyGradeChangesToCandidate(candidate, studentId, weekNum, validatedGrades);

        var studentName = CharacterQueries.getDisplayName(student);
        var resultGrades = (candidate[studentId] && candidate[studentId][weekNum])
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            data.curriculum.grades = candidate;
            return {
                result: deepClone(resultGrades),
                changed: changes > 0,
                count: changes,
                studentId: studentId,
                studentName: studentName,
                week: weekNum
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            week: weekNum,
            changes: changes,
            result: resultGrades
        });
    }

    /**
     * Build a candidate for saving a single grade.
     */
    function buildSaveGradeCandidate(studentId, week, disciplineId, score) {
        var grades = {};
        grades[disciplineId] = score;
        return buildSaveGradesCandidate(studentId, week, grades);
    }

    /**
     * Build a candidate for deleting a single grade.
     */
    function buildDeleteGradeCandidate(studentId, week, disciplineId) {
        return buildSaveGradeCandidate(studentId, week, disciplineId, null);
    }

    /**
     * Build a candidate for deleting all grades for a student in a week.
     */
    function buildDeleteWeekGradesCandidate(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var store = getGradesStore();
        var existingGrades = (store && isObject(store)) ? store : {};

        if (!existingGrades[studentId] || !existingGrades[studentId][weekNum]) {
            return success({
                mutate: function(data) {
                    return { result: {}, changed: false, count: 0 };
                },
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

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            data.curriculum.grades = candidate;
            return {
                result: {},
                changed: true,
                count: deletedCount,
                studentId: studentId,
                studentName: studentName,
                week: weekNum
            };
        }

        return success({
            mutate: mutate,
            changed: true,
            count: deletedCount,
            studentId: studentId,
            studentName: studentName,
            week: weekNum
        });
    }

    /**
     * Build a candidate for deleting all grades for a student.
     */
    function buildDeleteStudentGradesCandidate(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var store = getGradesStore();
        var existingGrades = (store && isObject(store)) ? store : {};

        if (!existingGrades[studentId]) {
            return success({
                mutate: function(data) {
                    return { result: {}, changed: false, count: 0 };
                },
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

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            data.curriculum.grades = candidate;
            return {
                result: {},
                changed: true,
                count: deletedCount,
                studentId: studentId,
                studentName: studentName
            };
        }

        return success({
            mutate: mutate,
            changed: true,
            count: deletedCount,
            studentId: studentId,
            studentName: studentName
        });
    }

    /**
     * Build a candidate for saving grades for an entire class.
     * This is a true atomic bulk operation: all changes are applied to one candidate.
     */
    function buildSaveClassGradesCandidate(classId, week, gradeData) {
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

        // ---- PHASE 2: GET STORE ----
        var store = getGradesStore();
        var existingGrades = (store && isObject(store)) ? store : {};

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(existingGrades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        var totalChanges = 0;
        var processedStudents = [];

        for (var studentId in validated) {
            if (!Object.prototype.hasOwnProperty.call(validated, studentId)) {
                continue;
            }

            var grades = validated[studentId];
            var changes = applyGradeChangesToCandidate(candidate, studentId, weekNum, grades);
            totalChanges += changes;
            processedStudents.push(studentId);
        }

        var className = 'Unknown';
        var cls = ClassesQueries.getClass(classId);
        if (cls) {
            className = cls.name;
        }

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            data.curriculum.grades = candidate;
            return {
                studentsProcessed: processedStudents.length,
                totalChanges: totalChanges,
                changed: totalChanges > 0,
                classId: classId,
                className: className,
                week: weekNum
            };
        }

        return success({
            mutate: mutate,
            studentsProcessed: processedStudents.length,
            totalChanges: totalChanges,
            changed: totalChanges > 0,
            classId: classId,
            className: className,
            week: weekNum
        });
    }

    // ============================================================
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These perform the mutation and commit directly.
    // DEPRECATED: Use build*Candidate functions with MutationPipeline.
    // ============================================================

    function saveGrades(studentId, week, grades) {
        var candidate = buildSaveGradesCandidate(studentId, week, grades);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                result: result.result,
                changed: result.changed,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to save grades.');
        }
    }

    function saveGrade(studentId, week, disciplineId, score) {
        var candidate = buildSaveGradeCandidate(studentId, week, disciplineId, score);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                result: result.result,
                changed: result.changed,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to save grade.');
        }
    }

    function deleteGrade(studentId, week, disciplineId) {
        var candidate = buildDeleteGradeCandidate(studentId, week, disciplineId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                result: result.result,
                changed: result.changed,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to delete grade.');
        }
    }

    function deleteWeekGrades(studentId, week) {
        var candidate = buildDeleteWeekGradesCandidate(studentId, week);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                result: result.result,
                changed: result.changed,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to delete week grades.');
        }
    }

    function deleteStudentGrades(studentId) {
        var candidate = buildDeleteStudentGradesCandidate(studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                result: result.result,
                changed: result.changed,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to delete student grades.');
        }
    }

    function saveClassGrades(classId, week, gradeData) {
        var candidate = buildSaveClassGradesCandidate(classId, week, gradeData);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate(window.data);
            return success({
                studentsProcessed: result.studentsProcessed,
                totalChanges: result.totalChanges,
                changed: result.changed
            });
        } catch (e) {
            return failure(e.message || 'Failed to save class grades.');
        }
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

        // Candidate builders (preferred - use with MutationPipeline)
        buildSaveGradesCandidate: buildSaveGradesCandidate,
        buildSaveGradeCandidate: buildSaveGradeCandidate,
        buildDeleteGradeCandidate: buildDeleteGradeCandidate,
        buildDeleteWeekGradesCandidate: buildDeleteWeekGradesCandidate,
        buildDeleteStudentGradesCandidate: buildDeleteStudentGradesCandidate,
        buildSaveClassGradesCandidate: buildSaveClassGradesCandidate,

        // Legacy wrappers (deprecated - use with caution)
        saveGrades: saveGrades,
        saveGrade: saveGrade,
        deleteGrade: deleteGrade,
        deleteWeekGrades: deleteWeekGrades,
        deleteStudentGrades: deleteStudentGrades,
        saveClassGrades: saveClassGrades,

        // Validation (exposed for external use)
        validateScore: validateScore,

        // Constants
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        PASSING_THRESHOLD: PASSING_THRESHOLD
    };

})();