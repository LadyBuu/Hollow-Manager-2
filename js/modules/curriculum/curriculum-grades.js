/**
 * js/core/curriculum/curriculum-grades.js - Grade Core Operations
 * Path: js/core/curriculum/curriculum-grades.js
 * 
 * This module handles:
 *   - Grade CRUD (get, save, delete)
 *   - Grade summary calculation
 *   - Grade validation (0-100 range)
 *   - Discipline availability filtering
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
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 *   - Student existence is validated for all mutations
 *   - Discipline existence is validated for all mutations (including deletion)
 *   - Grading letter calculation REQUIRES window.getGradeLetter (no fallback)
 *   - Malformed existing grade containers are normalised during candidate preparation
 *   - parseGradeScore() is the SINGLE canonical grade parser
 *   - availableCount = global number of disciplines available that week
 *   - scheduledCount = disciplines this student actually has scheduled
 *   - gradedCount = scheduled disciplines with valid grades
 * 
 * GRADE SEMANTICS:
 *   - Grades are stored as: grades[studentId][week][disciplineId] = score
 *   - Scores are numbers between 0 and 100 (rounded to 1 decimal place)
 *   - Setting a grade to undefined/null/empty/whitespace deletes it
 *   - Student IDs are validated against the character store
 *   - Discipline IDs are validated against the curriculum
 *   - Deleting a non-existent discipline is REJECTED (fail closed)
 *   - Deleting a non-existent student is REJECTED (fail closed)
 *   - Grades may be stored independently of scheduling
 *   - Summaries only count grades for disciplines the student is scheduled in that week
 * 
 * DEPENDENCY SEMANTICS:
 *   - Prefers window.getCharacterById and window.getDiscipline if available
 *   - Falls back to direct data inspection for compatibility
 *   - Callers should ensure canonical core functions are loaded
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

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
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
        return data.curriculum.disciplines.filter(function(d) {
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
        return studentSchedule[weekNum];
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

    /**
     * Parse a grade score value.
     * Returns null for invalid, non-numeric, or out-of-range values.
     * This is the SINGLE canonical grade parser.
     */
    function parseGradeScore(value) {
        // Reject non-string, non-number inputs
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value === 'string' && value.trim() !== '') {
            var num = Number(value);
            return Number.isFinite(num) ? num : null;
        }

        // Reject boolean, array, object, null, undefined
        return null;
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

    function successWithGrades(grades, operation, changed, count) {
        var cloned = deepClone(grades);
        if (cloned === null) {
            return failure('Failed to clone grade data.');
        }
        return {
            success: true,
            changed: changed || false,
            operation: operation || 'unchanged',
            count: typeof count === 'number' ? count : 0,
            data: cloned
        };
    }

    // ============================================================
    // GRADE QUERIES (with deep cloning for safety)
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
        var result = deepClone(grades);
        return result !== null ? result : {};
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
                var cloned = deepClone(weekGrades);
                if (cloned !== null) {
                    result[studentId] = cloned;
                }
            }
        }

        return result;
    }

    // ============================================================
    // GRADE MUTATIONS (candidate-based, no live mutation)
    // ============================================================

    function saveGrades(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
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

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var value = grades[disciplineId];

            // Empty value means delete this grade - but discipline must exist
            if (isEmptyGradeValue(value)) {
                var discipline = getDiscipline(disciplineId);
                if (!discipline) {
                    invalidDisciplines.push(disciplineId);
                    continue;
                }
                validatedGrades[disciplineId] = null;
                continue;
            }

            var discipline = getDiscipline(disciplineId);
            if (!discipline) {
                invalidDisciplines.push(disciplineId);
                continue;
            }

            var numericScore = parseGradeScore(value);
            if (numericScore === null || numericScore < 0 || numericScore > 100) {
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

        // ---- PHASE 3: BUILD CANDIDATE (DEEP CLONE) ----
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

        // ---- PHASE 4: NORMALISE CANDIDATE STRUCTURE ----
        if (!isObject(candidate[studentId])) {
            candidate[studentId] = {};
        }

        if (!isObject(candidate[studentId][weekNum])) {
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

        // Clean up empty entries
        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 5: GET RESULT GRADES ----
        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 6: COMMIT ----
        data.curriculum.grades = candidate;

        // ---- PHASE 7: LOG ----
        var studentName = getStudentDisplayName(student);
        var logMessage = 'Updated grades for ' + studentName + ' (' + studentId + '), week ' + weekNum;
        if (actualChanges > 0) {
            logMessage += ' (' + actualChanges + ' changes)';
        } else {
            logMessage += ' (no changes)';
        }
        logActivity(logMessage);

        return successWithGrades(
            resultGrades,
            actualChanges > 0 ? 'updated' : 'unchanged',
            actualChanges > 0,
            actualChanges
        );
    }

    function saveGrade(studentId, week, disciplineId, score) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        // ---- PHASE 2: VALIDATE SCORE ----
        var numericScore = null;

        if (!isEmptyGradeValue(score)) {
            numericScore = parseGradeScore(score);
            if (numericScore === null || numericScore < 0 || numericScore > 100) {
                return failure('Score must be between 0 and 100.');
            }
            numericScore = Math.round(numericScore * 10) / 10;
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
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

        // ---- PHASE 4: NORMALISE CANDIDATE STRUCTURE ----
        if (!isObject(candidate[studentId])) {
            candidate[studentId] = {};
        }

        if (!isObject(candidate[studentId][weekNum])) {
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

        // Clean up empty entries
        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 5: GET RESULT GRADES ----
        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 6: COMMIT ----
        data.curriculum.grades = candidate;

        // ---- PHASE 7: LOG ----
        var studentName = getStudentDisplayName(student);
        var disciplineName = discipline.name;
        var action = numericScore !== null ? 'saved' : 'deleted';
        if (changed) {
            logActivity(action + ' grade for ' + studentName + ' (' + studentId + '), ' + disciplineName + ', week ' + weekNum);
        } else {
            logActivity('No change to grade for ' + studentName + ' (' + studentId + '), ' + disciplineName + ', week ' + weekNum);
        }

        return successWithGrades(
            resultGrades,
            changed ? (numericScore !== null ? 'saved' : 'deleted') : 'unchanged',
            changed,
            changed ? 1 : 0
        );
    }

    function deleteGrade(studentId, week, disciplineId) {
        return saveGrade(studentId, week, disciplineId, null);
    }

    function deleteWeekGrades(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: CHECK EXISTS ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return successWithGrades({}, 'unchanged', false, 0);
        }

        if (!data.curriculum.grades[studentId] || !data.curriculum.grades[studentId][weekNum]) {
            return successWithGrades({}, 'unchanged', false, 0);
        }

        // ---- PHASE 3: COUNT BEFORE DELETE ----
        var existingWeekGrades = data.curriculum.grades[studentId][weekNum];
        var deletedCount = 0;
        if (isObject(existingWeekGrades)) {
            deletedCount = Object.keys(existingWeekGrades).length;
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId][weekNum];

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.grades = candidate;

        var studentName = getStudentDisplayName(student);
        logActivity('Deleted all grades for ' + studentName + ' (' + studentId + '), week ' + weekNum + ' (' + deletedCount + ' grades)');

        return successWithGrades({}, 'deleted', true, deletedCount);
    }

    function deleteStudentGrades(studentId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        // ---- PHASE 2: CHECK EXISTS ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return successWithGrades({}, 'unchanged', false, 0);
        }

        if (!data.curriculum.grades[studentId]) {
            return successWithGrades({}, 'unchanged', false, 0);
        }

        // ---- PHASE 3: COUNT BEFORE DELETE ----
        var existingStudentGrades = data.curriculum.grades[studentId];
        var deletedCount = 0;
        if (isObject(existingStudentGrades)) {
            for (var week in existingStudentGrades) {
                if (Object.prototype.hasOwnProperty.call(existingStudentGrades, week)) {
                    var weekGrades = existingStudentGrades[week];
                    if (isObject(weekGrades)) {
                        deletedCount += Object.keys(weekGrades).length;
                    }
                }
            }
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId];

        // ---- PHASE 5: COMMIT ----
        data.curriculum.grades = candidate;

        var studentName = getStudentDisplayName(student);
        logActivity('Deleted all grades for ' + studentName + ' (' + studentId + ') (' + deletedCount + ' grades)');

        return successWithGrades({}, 'deleted', true, deletedCount);
    }

    // ============================================================
    // GRADE SUMMARY
    // ============================================================

    function getStudentDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
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

    /**
     * Calculate grade summary for a student.
     * 
     * A discipline counts toward the summary only if:
     * 1. It exists and is available during the week
     * 2. It is scheduled for the student that week
     * 
     * This means historical grades for disciplines no longer scheduled
     * are excluded from the current summary.
     * 
     * availableCount = global number of disciplines available that week
     * scheduledCount = disciplines this student actually has scheduled
     * gradedCount = scheduled disciplines with valid grades
     */
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
            var hasValidGrade = false;
            var numericScore = null;

            if (!isEmptyGradeValue(score)) {
                numericScore = parseGradeScore(score);
                if (numericScore !== null && numericScore >= 0 && numericScore <= 100) {
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

    /**
     * Calculate grade letter for a student's grade in a discipline.
     * REQUIRES window.getGradeLetter - no fallback.
     * Validates the score using parseGradeScore before passing to getGradeLetter.
     */
    function calculateGradeLetter(studentId, week, disciplineId) {
        var score = getGrade(studentId, week, disciplineId);

        // Validate the score using the canonical parser
        var numericScore = parseGradeScore(score);
        if (numericScore === null || numericScore < 0 || numericScore > 100) {
            return null;
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        if (typeof window.getGradeLetter !== 'function') {
            return null;
        }

        return window.getGradeLetter(discipline, numericScore);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getGrades = getGrades;
    window.getGrade = getGrade;
    window.hasGrade = hasGrade;
    window.getWeekGrades = getWeekGrades;
    window.getStudentDisciplineIds = getStudentDisciplineIds;

    // Mutations
    window.saveGrades = saveGrades;
    window.saveGrade = saveGrade;
    window.deleteGrade = deleteGrade;
    window.deleteWeekGrades = deleteWeekGrades;
    window.deleteStudentGrades = deleteStudentGrades;

    // Summary
    window.calculateGradeSummary = calculateGradeSummary;
    window.calculateGradeLetter = calculateGradeLetter;

})();
