/**
 * js/modules/academy/academy-grades.js - Academy Grades
 * SINGLE SOURCE OF TRUTH for all academy grade data and operations
 * Path: js/modules/academy/academy-grades.js
 * 
 * This module is responsible for:
 *   - Grade CRUD operations (create, update, delete)
 *   - Grade queries (get by student, class, discipline, week)
 *   - Grade calculations (summary, averages, pass/fail)
 *   - Grade validation
 * 
 * IMPORTANT:
 *   - This module OWNS grade data - it does NOT depend on AcademyQueries
 *   - Uses AcademyClasses for class data (no circular dependency)
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 * 
 * GRADE DATA STRUCTURE:
 *   window.data.academy.grades = {
 *     'grade_123': {
 *       id: 'grade_123',
 *       studentId: 'char_456',
 *       classId: 'class_789',
 *       disciplineId: 'disc_abc',
 *       week: 5,
 *       score: 85,
 *       maxScore: 100,
 *       weight: 1.0,
 *       type: 'exam', // 'exam', 'assignment', 'participation', 'project'
 *       date: '2026-02-15',
 *       notes: 'Good work',
 *       createdAt: '2026-02-15T10:00:00Z',
 *       updatedAt: '2026-02-15T10:00:00Z'
 *     }
 *   }
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var grades = window.AcademyGrades;
 *   
 *   // Create a grade
 *   var result = grades.create({
 *     studentId: 'char_456',
 *     classId: 'class_789',
 *     disciplineId: 'disc_abc',
 *     week: 5,
 *     score: 85,
 *     maxScore: 100
 *   });
 *   
 *   // Get grades
 *   var studentGrades = grades.getStudentGrades('char_456');
 *   var classGrades = grades.getClassGrades('class_789');
 *   
 *   // Calculate summary
 *   var summary = grades.calculateSummary(studentGrades);
 *   var passing = grades.isPassing(score, maxScore);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyGradesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }

    if (!window.AcademyClasses || typeof window.AcademyClasses.getClassRecord !== 'function') {
        missing.push('AcademyClasses.getClassRecord');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyGrades] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyGradesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var AcademyClasses = window.AcademyClasses;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;
    var PASSING_THRESHOLD = 70;

    var VALID_GRADE_TYPES = ['exam', 'assignment', 'participation', 'project', 'quiz', 'final'];

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('grade');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function isPassing(score, maxScore) {
        var max = isNumber(maxScore) && maxScore > 0 ? maxScore : 100;
        var percentage = max > 0 ? (score / max) * 100 : 0;
        return percentage >= PASSING_THRESHOLD;
    }

    function calculatePercentage(score, maxScore) {
        var max = isNumber(maxScore) && maxScore > 0 ? maxScore : 100;
        return max > 0 ? Math.round((score / max) * 100) : 0;
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL (no AcademyQueries dependency)
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getAcademyStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!data.academy || typeof data.academy !== 'object') {
            data.academy = {};
        }

        return data.academy;
    }

    function ensureGradeStructures() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }

        if (!academy.grades || typeof academy.grades !== 'object') {
            academy.grades = {};
        }

        return academy;
    }

    // ============================================================
    // INTERNAL GRADE LOOKUP - PRIVATE
    // ============================================================

    /**
     * Get a grade record by ID (internal).
     * 
     * @param {string} gradeId - Grade ID
     * @returns {object|null} Grade object or null
     */
    function getGradeRecord(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.grades) {
            return null;
        }

        var target = String(gradeId);
        return academy.grades[target] || null;
    }

    /**
     * Get all grade records (internal).
     * 
     * @returns {array} Array of grade objects
     */
    function getGradeRecords() {
        var academy = getAcademyStore();
        if (!academy || !academy.grades) {
            return [];
        }

        var result = [];
        for (var id in academy.grades) {
            if (Object.prototype.hasOwnProperty.call(academy.grades, id)) {
                var grade = academy.grades[id];
                if (grade) {
                    result.push(grade);
                }
            }
        }

        return result;
    }

    // ============================================================
    // GRADE VALIDATION
    // ============================================================

    function validateGradeData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Grade data must be an object.' };
        }

        // Student ID - required for full creation
        if (!isPartial || data.studentId !== undefined) {
            if (!isNonEmptyString(data.studentId)) {
                return { valid: false, message: 'Student ID is required.' };
            }
        }

        // Class ID - required for full creation
        if (!isPartial || data.classId !== undefined) {
            if (!isNonEmptyString(data.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
        }

        // Discipline ID - required for full creation
        if (!isPartial || data.disciplineId !== undefined) {
            if (!isNonEmptyString(data.disciplineId)) {
                return { valid: false, message: 'Discipline ID is required.' };
            }
        }

        // Week - required for full creation
        if (!isPartial || data.week !== undefined) {
            var week = parseInt(data.week, 10);
            if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
            }
        }

        // Score - required for full creation
        if (!isPartial || data.score !== undefined) {
            var score = parseFloat(data.score);
            if (isNaN(score) || score < MIN_SCORE) {
                return { valid: false, message: 'Score must be a number greater than or equal to 0.' };
            }
        }

        // Max score - optional, but if provided must be valid
        if (data.maxScore !== undefined) {
            var maxScore = parseFloat(data.maxScore);
            if (isNaN(maxScore) || maxScore <= 0) {
                return { valid: false, message: 'Max score must be a number greater than 0.' };
            }
        }

        // Grade type - optional, but if provided must be valid
        if (data.type !== undefined) {
            if (VALID_GRADE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid grade type. Must be one of: ' + VALID_GRADE_TYPES.join(', ') };
            }
        }

        // Weight - optional, but if provided must be valid
        if (data.weight !== undefined) {
            var weight = parseFloat(data.weight);
            if (isNaN(weight) || weight < 0 || weight > 2) {
                return { valid: false, message: 'Weight must be between 0 and 2.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // PUBLIC API - GRADE CRUD
    // ============================================================

    /**
     * Create a new grade.
     * Candidate-based: validates, creates, commits.
     * 
     * @param {object} data - Grade data
     * @param {string} data.studentId - Student ID
     * @param {string} data.classId - Class ID
     * @param {string} data.disciplineId - Discipline ID
     * @param {number} data.week - Week number
     * @param {number} data.score - Score value
     * @param {number} data.maxScore - Maximum score (default: 100)
     * @param {string} data.type - Grade type ('exam', 'assignment', etc.)
     * @param {number} data.weight - Weight multiplier (default: 1.0)
     * @param {string} data.date - Date string
     * @param {string} data.notes - Additional notes
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateGradeData(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureGradeStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: VALIDATE CLASS EXISTS ----
        var classRecord = AcademyClasses.getClassRecord(data.classId);
        if (!classRecord) {
            return failure('Class not found.');
        }

        // ---- PHASE 4: BUILD GRADE OBJECT ----
        var now = new Date().toISOString();
        var gradeId = generateId();

        var score = parseFloat(data.score);
        var maxScore = data.maxScore !== undefined ? parseFloat(data.maxScore) : 100;
        var weight = data.weight !== undefined ? parseFloat(data.weight) : 1.0;
        var week = parseInt(data.week, 10);

        var newGrade = {
            id: gradeId,
            studentId: String(data.studentId),
            classId: String(data.classId),
            disciplineId: String(data.disciplineId),
            week: week,
            score: clamp(score, MIN_SCORE, maxScore),
            maxScore: maxScore > 0 ? maxScore : 100,
            weight: clamp(weight, 0, 2),
            type: data.type || 'assignment',
            date: data.date || now.split('T')[0],
            notes: data.notes || '',
            passing: isPassing(score, maxScore),
            percentage: calculatePercentage(score, maxScore),
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 5: COMMIT ----
        academy.grades[gradeId] = newGrade;

        return success({
            grade: newGrade
        });
    }

    /**
     * Update an existing grade.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} gradeId - Grade ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function update(gradeId, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(gradeId)) {
            return failure('Grade ID is required.');
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return failure('Updates are required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureGradeStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(gradeId);
        var existing = academy.grades[target];

        if (!existing) {
            return failure('Grade not found.');
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone grade data.');
        }

        var hasChanges = false;

        // Validate and apply updates
        var updateFields = ['studentId', 'classId', 'disciplineId', 'week', 'score', 'maxScore', 'type', 'weight', 'date', 'notes'];

        for (var i = 0; i < updateFields.length; i++) {
            var field = updateFields[i];
            if (updates[field] === undefined) {
                continue;
            }

            var value = updates[field];

            switch (field) {
                case 'studentId':
                case 'classId':
                case 'disciplineId':
                    if (!isNonEmptyString(value)) {
                        return failure(field + ' must be a non-empty string.');
                    }
                    if (candidate[field] !== String(value)) {
                        candidate[field] = String(value);
                        hasChanges = true;
                    }
                    break;

                case 'week':
                    var week = parseInt(value, 10);
                    if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                        return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
                    }
                    if (candidate.week !== week) {
                        candidate.week = week;
                        hasChanges = true;
                    }
                    break;

                case 'score':
                    var score = parseFloat(value);
                    if (isNaN(score) || score < MIN_SCORE) {
                        return failure('Score must be a number greater than or equal to 0.');
                    }
                    var maxScore = candidate.maxScore || 100;
                    if (candidate.score !== clamp(score, MIN_SCORE, maxScore)) {
                        candidate.score = clamp(score, MIN_SCORE, maxScore);
                        hasChanges = true;
                    }
                    break;

                case 'maxScore':
                    var maxScore = parseFloat(value);
                    if (isNaN(maxScore) || maxScore <= 0) {
                        return failure('Max score must be a number greater than 0.');
                    }
                    if (candidate.maxScore !== maxScore) {
                        candidate.maxScore = maxScore;
                        hasChanges = true;
                    }
                    break;

                case 'type':
                    if (VALID_GRADE_TYPES.indexOf(value) === -1) {
                        return failure('Invalid grade type. Must be one of: ' + VALID_GRADE_TYPES.join(', '));
                    }
                    if (candidate.type !== value) {
                        candidate.type = value;
                        hasChanges = true;
                    }
                    break;

                case 'weight':
                    var weight = parseFloat(value);
                    if (isNaN(weight) || weight < 0 || weight > 2) {
                        return failure('Weight must be between 0 and 2.');
                    }
                    if (candidate.weight !== weight) {
                        candidate.weight = weight;
                        hasChanges = true;
                    }
                    break;

                case 'date':
                    if (value !== null && typeof value !== 'string') {
                        return failure('Date must be a string.');
                    }
                    if (candidate.date !== value) {
                        candidate.date = value || new Date().toISOString().split('T')[0];
                        hasChanges = true;
                    }
                    break;

                case 'notes':
                    var notes = value || '';
                    if (candidate.notes !== notes) {
                        candidate.notes = notes;
                        hasChanges = true;
                    }
                    break;

                default:
                    // Unknown field, skip
                    break;
            }
        }

        if (!hasChanges) {
            return success({ grade: existing, changed: false });
        }

        // ---- PHASE 5: RECALCULATE DERIVED FIELDS ----
        candidate.percentage = calculatePercentage(candidate.score, candidate.maxScore);
        candidate.passing = isPassing(candidate.score, candidate.maxScore);
        candidate.updatedAt = new Date().toISOString();

        // ---- PHASE 6: COMMIT ----
        academy.grades[target] = candidate;

        return success({
            grade: candidate,
            changed: true
        });
    }

    /**
     * Delete a grade permanently.
     * 
     * @param {string} gradeId - Grade ID
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function deleteGrade(gradeId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(gradeId)) {
            return failure('Grade ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureGradeStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(gradeId);
        var existing = academy.grades[target];

        if (!existing) {
            return failure('Grade not found.');
        }

        var gradeInfo = {
            id: target,
            studentId: existing.studentId,
            disciplineId: existing.disciplineId,
            week: existing.week
        };

        // ---- PHASE 4: REMOVE ----
        delete academy.grades[target];

        return success({
            deleted: true,
            grade: gradeInfo
        });
    }

    /**
     * Delete all grades for a student.
     * 
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function deleteStudentGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var academy = ensureGradeStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        var targetStudent = String(studentId);
        var removed = [];
        var toRemove = [];

        for (var id in academy.grades) {
            if (Object.prototype.hasOwnProperty.call(academy.grades, id)) {
                var grade = academy.grades[id];
                if (grade && String(grade.studentId) === targetStudent) {
                    toRemove.push(id);
                    removed.push({
                        id: id,
                        disciplineId: grade.disciplineId,
                        week: grade.week
                    });
                }
            }
        }

        for (var i = 0; i < toRemove.length; i++) {
            delete academy.grades[toRemove[i]];
        }

        return success({
            studentId: targetStudent,
            removedCount: removed.length,
            removed: removed
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (internal)
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

        var all = getGradeRecords();
        var targetStudent = String(studentId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.studentId) === targetStudent) {
                if (week !== undefined) {
                    var weekNum = parseInt(week, 10);
                    if (!isNaN(weekNum) && grade.week !== weekNum) {
                        continue;
                    }
                }
                result.push(grade);
            }
        }

        // Sort by week, then by date
        result.sort(function(a, b) {
            if (a.week !== b.week) {
                return a.week - b.week;
            }
            return (a.date || '').localeCompare(b.date || '');
        });

        return result;
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

        var all = getGradeRecords();
        var targetClass = String(classId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.classId) === targetClass) {
                if (week !== undefined) {
                    var weekNum = parseInt(week, 10);
                    if (!isNaN(weekNum) && grade.week !== weekNum) {
                        continue;
                    }
                }
                result.push(grade);
            }
        }

        result.sort(function(a, b) {
            if (a.week !== b.week) {
                return a.week - b.week;
            }
            return (a.date || '').localeCompare(b.date || '');
        });

        return result;
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

        var all = getGradeRecords();
        var targetDiscipline = String(disciplineId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.disciplineId) === targetDiscipline) {
                if (week !== undefined) {
                    var weekNum = parseInt(week, 10);
                    if (!isNaN(weekNum) && grade.week !== weekNum) {
                        continue;
                    }
                }
                result.push(grade);
            }
        }

        result.sort(function(a, b) {
            if (a.week !== b.week) {
                return a.week - b.week;
            }
            return (a.date || '').localeCompare(b.date || '');
        });

        return result;
    }

    /**
     * Get grades for a specific week.
     * 
     * @param {number} week - Week number
     * @param {string} classId - Optional class filter
     * @returns {array} Array of grade objects
     */
    function getWeekGrades(week, classId) {
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        var all = getGradeRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (grade.week === weekNum) {
                if (classId !== undefined && String(grade.classId) !== String(classId)) {
                    continue;
                }
                result.push(grade);
            }
        }

        return result;
    }

    // ============================================================
    // CALCULATION FUNCTIONS - Pure
    // ============================================================

    /**
     * Calculate a summary for a list of grades.
     * 
     * @param {array} grades - Array of grade objects
     * @param {number} weightThreshold - Minimum weight to include (default: 0.5)
     * @returns {object} Summary statistics
     */
    function calculateSummary(grades, weightThreshold) {
        if (!Array.isArray(grades) || grades.length === 0) {
            return {
                count: 0,
                average: 0,
                max: 0,
                min: 0,
                passing: 0,
                failing: 0,
                passRate: 0,
                weightedAverage: 0,
                totalWeight: 0,
                gradeDistribution: {}
            };
        }

        weightThreshold = weightThreshold || 0.5;

        var count = grades.length;
        var total = 0;
        var max = -Infinity;
        var min = Infinity;
        var passing = 0;
        var failing = 0;
        var weightedTotal = 0;
        var totalWeight = 0;
        var distribution = {};

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            var score = grade.score || 0;
            var maxScore = grade.maxScore || 100;
            var percentage = grade.percentage !== undefined ? grade.percentage : calculatePercentage(score, maxScore);
            var weight = grade.weight || 1.0;

            // Only include grades with sufficient weight
            if (weight < weightThreshold) {
                continue;
            }

            total += percentage;
            if (percentage > max) max = percentage;
            if (percentage < min) min = percentage;

            weightedTotal += percentage * weight;
            totalWeight += weight;

            if (grade.passing || isPassing(score, maxScore)) {
                passing++;
            } else {
                failing++;
            }

            // Distribution bins
            var bin = Math.floor(percentage / 10) * 10;
            var binKey = bin + '-' + (bin + 9);
            if (percentage === 100) {
                binKey = '100';
            }
            if (!distribution[binKey]) {
                distribution[binKey] = 0;
            }
            distribution[binKey]++;
        }

        var avg = count > 0 ? total / count : 0;
        var weightedAvg = totalWeight > 0 ? weightedTotal / totalWeight : 0;

        return {
            count: count,
            average: Math.round(avg * 10) / 10,
            max: Math.round(max * 10) / 10,
            min: Math.round(min * 10) / 10,
            passing: passing,
            failing: failing,
            passRate: count > 0 ? Math.round((passing / count) * 100) : 0,
            weightedAverage: Math.round(weightedAvg * 10) / 10,
            totalWeight: Math.round(totalWeight * 10) / 10,
            gradeDistribution: distribution
        };
    }

    /**
     * Calculate a class summary for a specific week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} Class summary statistics
     */
    function calculateClassSummary(classId, week) {
        var grades = getClassGrades(classId, week);
        return calculateSummary(grades);
    }

    /**
     * Calculate a student's GPA across all grades.
     * 
     * @param {string} studentId - Student ID
     * @param {number} week - Optional week filter
     * @returns {object} GPA statistics
     */
    function calculateStudentGPA(studentId, week) {
        var grades = getStudentGrades(studentId, week);
        var summary = calculateSummary(grades, 0);

        // GPA conversion: 0-100 scale to 4.0 scale
        var gpa = 0;
        if (summary.count > 0) {
            var avg = summary.average;
            if (avg >= 90) gpa = 4.0;
            else if (avg >= 80) gpa = 3.0;
            else if (avg >= 70) gpa = 2.0;
            else if (avg >= 60) gpa = 1.0;
            else gpa = 0.0;
        }

        return {
            studentId: studentId,
            gradeCount: summary.count,
            average: summary.average,
            weightedAverage: summary.weightedAverage,
            passRate: summary.passRate,
            gpa: gpa,
            passing: summary.passing,
            failing: summary.failing
        };
    }

    /**
     * Calculate class ranking for a specific week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @param {function} getCharacterById - Function to get character by ID
     * @returns {array} Array of { studentId, name, average, rank }
     */
    function calculateClassRanking(classId, week, getCharacterById) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var grades = getClassGrades(classId, week);
        var studentAverages = {};

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            var studentId = grade.studentId;
            var percentage = grade.percentage !== undefined ? grade.percentage : calculatePercentage(grade.score, grade.maxScore || 100);
            var weight = grade.weight || 1.0;

            if (!studentAverages[studentId]) {
                studentAverages[studentId] = { total: 0, weight: 0, count: 0 };
            }
            studentAverages[studentId].total += percentage * weight;
            studentAverages[studentId].weight += weight;
            studentAverages[studentId].count++;
        }

        var result = [];
        for (var studentId in studentAverages) {
            if (Object.prototype.hasOwnProperty.call(studentAverages, studentId)) {
                var data = studentAverages[studentId];
                var avg = data.weight > 0 ? data.total / data.weight : 0;
                var name = 'Unknown';
                if (typeof getCharacterById === 'function') {
                    var char = getCharacterById(studentId);
                    if (char && typeof char === 'object') {
                        name = (char.firstName || '') + ' ' + (char.lastName || '');
                        if (!name.trim()) name = 'Unknown';
                    }
                }
                result.push({
                    studentId: studentId,
                    name: name,
                    average: Math.round(avg * 10) / 10,
                    gradeCount: data.count,
                    rank: 0
                });
            }
        }

        // Sort by average descending
        result.sort(function(a, b) {
            return b.average - a.average;
        });

        // Assign ranks
        for (var j = 0; j < result.length; j++) {
            result[j].rank = j + 1;
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGrades = {
        // ---- CRUD ----
        create: create,
        update: update,
        delete: deleteGrade,
        deleteStudentGrades: deleteStudentGrades,

        // ---- Queries ----
        getStudentGrades: getStudentGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        getWeekGrades: getWeekGrades,
        getGradeRecord: getGradeRecord,
        getGradeRecords: getGradeRecords,

        // ---- Calculations ----
        calculateSummary: calculateSummary,
        calculateClassSummary: calculateClassSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,

        // ---- Helpers ----
        isPassing: isPassing,
        calculatePercentage: calculatePercentage,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        PASSING_THRESHOLD: PASSING_THRESHOLD,
        VALID_GRADE_TYPES: VALID_GRADE_TYPES
    };

})();
