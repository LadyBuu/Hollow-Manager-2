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
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are CLONED to prevent external mutation
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Validate inputs
 *     2. Build candidate state (deep clone)
 *     3. Apply validated changes to candidate
 *     4. Apply candidate to data store (replace, not mutate)
 *     5. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before candidate validation completes
 *   - If curriculum structure is missing, the operation fails rather than repairing
 * 
 * GRADE SEMANTICS:
 *   - Grades are stored as: grades[studentId][week][disciplineId] = score
 *   - Scores are numbers between 0 and 100 (rounded to 1 decimal place)
 *   - Setting a grade to undefined/null/empty/whitespace deletes it
 *   - Discipline IDs are validated against existing disciplines when setting grades
 *   - Deletion requests may target nonexistent/legacy discipline IDs and are treated as no-ops
 *   - Student IDs are NOT validated (supports legacy/historical/off-system students)
 *   - Grades may be stored independently of scheduling
 *   - Summaries only count grades for disciplines the student is scheduled in that week
 * 
 * GRADE SUMMARY SEMANTICS:
 *   - availableCount: Number of globally available disciplines that week
 *   - scheduledCount: Number of disciplines the student is scheduled in
 *   - gradedCount: Number of scheduled disciplines with grades (regardless of weight)
 *   - gradedWeightedCount: Number of scheduled disciplines with grades AND valid weight > 0
 *   - mandatoryScheduled: Number of mandatory disciplines scheduled
 *   - mandatoryGraded: Number of mandatory disciplines graded
 *   - optionalScheduled: Number of optional disciplines scheduled
 *   - optionalGraded: Number of optional disciplines graded
 *   - average: Weighted average of graded disciplines with valid weight > 0, or null if none
 *   - hasGrades: Whether any valid grades exist
 * 
 * GRADE STATUS SEMANTICS:
 *   - 'unknown': No summary data
 *   - 'ungraded': No grades recorded
 *   - 'unweighted': Grades exist but no valid weight configuration for average
 *   - 'passing': Weighted average >= 70
 *   - 'needs_work': Weighted average < 70
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__gradeCoreLoaded) {
        return;
    }
    window.__gradeCoreLoaded = true;

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

    /**
     * Check if a value represents an empty grade (should be deleted).
     * Handles undefined, null, empty string, and whitespace-only strings.
     */
    function isEmptyGradeValue(value) {
        return value === undefined ||
            value === null ||
            (typeof value === 'string' && value.trim() === '');
    }

    /**
     * Get a discipline, preferring DisciplineCore.
     * Clones the result to prevent external mutation.
     */
    function getDiscipline(id) {
        // Prefer DisciplineCore if available (trust its clone contract)
        if (window.DisciplineCore && typeof window.DisciplineCore.getDiscipline === 'function') {
            return window.DisciplineCore.getDiscipline(id);
        }

        // Fallback to direct data access (with clone)
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });
        return discipline ? deepClone(discipline) : null;
    }

    /**
     * Get available disciplines, preferring DisciplineCore.
     * DisciplineCore is expected to return cloned results.
     * Fallback results are cloned locally.
     * FAILS CLOSED: if any discipline cannot be cloned, returns [].
     */
    function getAvailableDisciplines(week) {
        // Prefer DisciplineCore if available (trust its clone contract)
        if (window.DisciplineCore && typeof window.DisciplineCore.getAvailableDisciplines === 'function') {
            return window.DisciplineCore.getAvailableDisciplines(week);
        }

        // Fallback to direct data access (with clone)
        var weekNum = validateWeek(week);
        if (weekNum === null) return [];

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') return false;

            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);

            if (start !== null && start > weekNum) return false;
            if (end !== null && end < weekNum) return false;

            return true;
        });

        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned === null) {
                console.error('GradeCore: Failed to clone available discipline at index ' + i);
                return [];
            }
            result.push(cloned);
        }
        return result;
    }

    /**
     * Get a student's schedule.
     * If the external getStudentSchedule exists, we clone its result to guarantee safety.
     * Fallback path also clones.
     */
    function getStudentSchedule(studentId, week) {
        var schedule;

        if (typeof window.getStudentSchedule === 'function') {
            schedule = window.getStudentSchedule(studentId, week);
            var clonedSchedule = deepClone(schedule);
            return clonedSchedule === null ? {} : clonedSchedule;
        }

        // Fallback: direct data access with clone
        var weekNum = validateWeek(week);
        if (weekNum === null) return {};

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) return {};

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) return {};

        var weekSchedule = studentSchedule[weekNum];
        var result = {};
        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
            var daySchedule = weekSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;
            result[day] = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                result[day][hour] = daySchedule[hour];
            }
        }
        return result;
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('GradeCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('GradeCore: JSON clone failed:', e);
            return null;
        }
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
    // GRADE LETTER - SINGLE SOURCE OF TRUTH
    // ============================================================

    function getMin(grade) {
        var min = Number(grade && grade.min);
        return isFinite(min) ? min : -Infinity;
    }

    /**
     * Get grade letter from a discipline's grading system.
     * Delegates to DisciplineCore if available, with fallback.
     * This is the SINGLE source of truth for grade letter calculation.
     */
    function getGradeLetter(discipline, score) {
        if (window.DisciplineCore && typeof window.DisciplineCore.getGradeLetter === 'function') {
            return window.DisciplineCore.getGradeLetter(discipline, score);
        }

        // Fallback implementation (kept in sync with DisciplineCore)
        if (!discipline || !Array.isArray(discipline.gradingSystem) || discipline.gradingSystem.length === 0) {
            return '';
        }

        var numScore = Number(score);
        if (!isFinite(numScore) || numScore < 0 || numScore > 100) {
            return '';
        }

        // Sort by min descending (highest grade first) - with safe min extraction
        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return getMin(b) - getMin(a);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);

            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                return grade.label || grade.letter || '';
            }
        }

        return '';
    }

    // ============================================================
    // GRADE QUERIES (with cloning for safety)
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

        // Return a shallow clone to prevent external mutation
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

    function getAllStudentGrades(studentId) {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return {};
        }

        if (!data.curriculum.grades[studentId]) {
            return {};
        }

        // Return a shallow clone to prevent external mutation
        var studentGrades = data.curriculum.grades[studentId];
        var result = {};
        for (var week in studentGrades) {
            if (Object.prototype.hasOwnProperty.call(studentGrades, week)) {
                var weekGrades = studentGrades[week];
                var weekResult = {};
                for (var key in weekGrades) {
                    if (Object.prototype.hasOwnProperty.call(weekGrades, key)) {
                        weekResult[key] = weekGrades[key];
                    }
                }
                result[week] = weekResult;
            }
        }
        return result;
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
                // Clone to prevent external mutation
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
                    // Clone to prevent external mutation
                    result[studentId][week] = weekGrades[disciplineId];
                }
            }
        }

        return result;
    }

    function hasGrade(studentId, week, disciplineId) {
        var grades = getGrades(studentId, week);
        return !isEmptyGradeValue(grades[disciplineId]);
    }

    // ============================================================
    // GRADE SUMMARY
    // ============================================================

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
                if (disciplineId) {
                    // Normalise to string for consistent comparison
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

        // Get available disciplines for this week
        var disciplines = getAvailableDisciplines(weekNum);
        if (!Array.isArray(disciplines)) disciplines = [];

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

        disciplines.forEach(function(d) {
            var isInSchedule = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            if (!isInSchedule) return;
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

                    // Check if this grade contributes to weighted average
                    var weight = Number(d.weight);
                    if (isFinite(weight) && weight > 0) {
                        gradedWeightedCount++;
                        totalWeighted += numericScore * weight;
                        totalWeight += weight;
                    }
                }
            }

            // Count scheduled by type regardless of whether graded
            if (d.type === 'mandatory') {
                mandatoryScheduled++;
            } else if (d.type === 'optional') {
                optionalScheduled++;
            }
        });

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
        if (score === null) return null;

        var discipline = getDiscipline(disciplineId);
        if (!discipline) return null;

        return getGradeLetter(discipline, score);
    }

    function getGradeStatus(summary) {
        if (!summary) return 'unknown';
        if (!summary.hasGrades) return 'ungraded';
        if (summary.average === null) return 'unweighted';

        return summary.average >= 70 ? 'passing' : 'needs_work';
    }

    function getGradeStatusLabel(status) {
        var labels = {
            'unknown': 'Unknown',
            'ungraded': 'Not Graded',
            'unweighted': 'No Weighted Average',
            'passing': '✓ Passing',
            'needs_work': '⚠ Needs Work'
        };
        return labels[status] || status;
    }

    function getGradeStatusColor(status) {
        var colors = {
            'unknown': 'var(--text-dim)',
            'ungraded': 'var(--text-dim)',
            'unweighted': 'var(--warning)',
            'passing': 'var(--accent)',
            'needs_work': 'var(--danger)'
        };
        return colors[status] || 'var(--text-dim)';
    }

    // ============================================================
    // GRADE MUTATIONS (candidate-based, no live mutation)
    // ============================================================

    function saveGrades(studentId, week, grades) {
        // ---- PHASE 1: VALIDATE INPUTS ----
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

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) continue;

            var value = grades[disciplineId];

            // Empty value means delete this grade
            if (isEmptyGradeValue(value)) {
                validatedGrades[disciplineId] = null;
                continue;
            }

            // Validate discipline exists when setting grades
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

        // ---- PHASE 3: GET CURRENT STATE (DO NOT MUTATE) ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 4: VALIDATE CURRICULUM STRUCTURE ----
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 5: BUILD CANDIDATE (DEEP CLONE) ----
        var candidate = deepClone(data.curriculum.grades || {});

        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        // ---- PHASE 6: APPLY CHANGES TO CANDIDATE ----
        if (!candidate[studentId]) {
            candidate[studentId] = {};
        }

        if (!candidate[studentId][weekNum]) {
            candidate[studentId][weekNum] = {};
        }

        var candidateGrades = candidate[studentId][weekNum];
        var actualChanges = 0;

        for (var disciplineId in validatedGrades) {
            if (!Object.prototype.hasOwnProperty.call(validatedGrades, disciplineId)) continue;

            var newValue = validatedGrades[disciplineId];
            var oldValue = candidateGrades[disciplineId];

            if (newValue === null) {
                // Delete
                if (oldValue !== undefined) {
                    delete candidateGrades[disciplineId];
                    actualChanges++;
                }
            } else {
                // Set
                if (oldValue !== newValue) {
                    candidateGrades[disciplineId] = newValue;
                    actualChanges++;
                }
            }
        }

        // Clean up empty entries in candidate
        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 7: GET RESULT GRADES (AFTER CLEANUP) ----
        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 8: APPLY (REPLACE, NOT MUTATE) ----
        data.curriculum.grades = candidate;

        // ---- PHASE 9: LOG ----
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
        // ---- PHASE 1: VALIDATE INPUTS ----
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

        // Validate discipline exists when setting grades
        if (!isEmptyGradeValue(score)) {
            var discipline = getDiscipline(disciplineId);
            if (!discipline) {
                return failure('Discipline not found.');
            }
        }

        // ---- PHASE 2: VALIDATE SCORE ----
        var numericScore = null;

        if (!isEmptyGradeValue(score)) {
            numericScore = Number(score);
            if (!isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
                return failure('Score must be between 0 and 100.');
            }
            numericScore = Math.round(numericScore * 10) / 10;
        }

        // ---- PHASE 3: GET CURRENT STATE (DO NOT MUTATE) ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 4: VALIDATE CURRICULUM STRUCTURE ----
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 5: BUILD CANDIDATE (DEEP CLONE) ----
        var candidate = deepClone(data.curriculum.grades || {});

        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        // ---- PHASE 6: APPLY CHANGES TO CANDIDATE ----
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

        // Clean up empty entries
        if (Object.keys(candidateGrades).length === 0) {
            delete candidate[studentId][weekNum];
        }

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 7: GET RESULT GRADES (AFTER CLEANUP) ----
        var resultGrades = candidate[studentId] && candidate[studentId][weekNum]
            ? candidate[studentId][weekNum]
            : {};

        // ---- PHASE 8: APPLY (REPLACE, NOT MUTATE) ----
        data.curriculum.grades = candidate;

        // ---- PHASE 9: LOG ----
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
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return success({ deleted: false, message: 'No grades found.' });
        }

        if (!data.curriculum || !data.curriculum.grades) {
            return success({ deleted: false, message: 'No grades found.' });
        }

        if (!data.curriculum.grades[studentId] || !data.curriculum.grades[studentId][weekNum]) {
            return success({ deleted: false, message: 'No grades for this week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId][weekNum];

        if (Object.keys(candidate[studentId]).length === 0) {
            delete candidate[studentId];
        }

        // ---- PHASE 4: APPLY ----
        data.curriculum.grades = candidate;

        logActivity('Deleted all grades for week ' + weekNum);
        return success({ deleted: true });
    }

    function deleteStudentGrades(studentId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return success({ deleted: false, message: 'No grades found.' });
        }

        if (!data.curriculum.grades[studentId]) {
            return success({ deleted: false, message: 'No grades for this student.' });
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.grades);
        if (candidate === null) {
            return failure('Failed to prepare grade data.');
        }

        delete candidate[studentId];

        // ---- PHASE 4: APPLY ----
        data.curriculum.grades = candidate;

        logActivity('Deleted all grades for student');
        return success({ deleted: true });
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

        // Validate, normalise, and deduplicate weeks
        var uniqueWeeks = {};
        var validWeeks = [];

        for (var i = 0; i < weeks.length; i++) {
            var week = validateWeek(weeks[i]);
            if (week !== null && !uniqueWeeks[week]) {
                uniqueWeeks[week] = true;
                validWeeks.push(week);
            }
        }

        if (validWeeks.length < 2) return null;

        // Sort chronologically
        validWeeks.sort(function(a, b) {
            return a - b;
        });

        var scores = [];
        for (var i = 0; i < validWeeks.length; i++) {
            var score = getGrade(studentId, validWeeks[i], disciplineId);
            if (score !== null) {
                scores.push({
                    week: validWeeks[i],
                    score: score
                });
            }
        }

        if (scores.length < 2) return null;

        // Calculate average change per recorded observation
        var totalChange = 0;
        var totalWeekDiff = 0;
        for (var i = 1; i < scores.length; i++) {
            totalChange += scores[i].score - scores[i - 1].score;
            totalWeekDiff += scores[i].week - scores[i - 1].week;
        }

        var avgChangePerObservation = totalChange / (scores.length - 1);
        var avgChangePerWeek = totalWeekDiff > 0 ? totalChange / totalWeekDiff : 0;

        // Net direction (start vs end)
        var netChange = scores[scores.length - 1].score - scores[0].score;
        var netDirection = netChange > 0 ? 'improving' : (netChange < 0 ? 'declining' : 'stable');

        return {
            scores: scores,
            netChange: netChange,
            netDirection: netDirection,
            averageChangePerObservation: avgChangePerObservation,
            averageChangePerWeek: avgChangePerWeek
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
        getStudentDisciplineIds: getStudentDisciplineIds,

        // Constants
        SUCCESS: success,
        FAILURE: failure
    };

})();
