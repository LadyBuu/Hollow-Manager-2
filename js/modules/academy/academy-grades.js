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
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module OWNS grade data - it does NOT depend on AcademyQueries
 *   - Uses AcademyClasses internal methods for class data (no circular dependency)
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging)
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * READ SAFETY (Phase 2):
 *   - getAcademyStore() returns null (does NOT create academy.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries return DEEP CLONES. Callers cannot mutate live state.
 *   - Internal accessors (getGradeRecord, getGradeRecords) return LIVE
 *     REFERENCES. They are consumed by this module's own mutation paths
 *     and by AcademyQueries.
 *   - Pipeline validate() callbacks read from the `appData` argument the
 *     pipeline supplies, not from window.data.
 *   - ObjectUtils.deepClone is used as the clone primitive. If cloning
 *     fails, the accessor throws. It does NOT fall back to returning the
 *     original reference.
 *
 * WEIGHT MODEL (Phase 3):
 *   - Grades NO LONGER carry a `weight` field. Weight is a property of
 *     the ASSESSMENT TYPE within a discipline, not of the individual
 *     grade record. It lives at discipline.assessmentWeights:
 *       discipline.assessmentWeights = {
 *         exam: 2.0,
 *         assignment: 1.0,
 *         participation: 0.5,
 *         ...
 *       }
 *   - Weighted averages are computed by the performance layer
 *     (academy-performance.js), which reads discipline.assessmentWeights
 *     and pairs it with grade.type.
 *   - This module does not compute weighted averages. It computes
 *     unweighted statistics.
 *
 * DERIVED vs STORED (Phase 3):
 *   - `percentage` and `passing` are DERIVED. They are not stored on
 *     the grade record.
 *   - `percentage` = round(score / maxScore * 100).
 *   - `passing` is SCHEME-AWARE. When a discipline grade scheme is
 *     supplied, passing is computed via AcademyGradeSchemes.isPassing.
 *     When it is absent, the default threshold applies.
 *   - Storing either field would lock in answers that go stale when the
 *     scheme changes or when the score is edited. Storing a field that
 *     is a pure function of other stored fields is redundant.
 *   - The `decorateGrade(grade, scheme)` helper attaches these fields
 *     to a cloned grade for display. Callers that want them on a read
 *     result opt in by passing a scheme.
 *
 * SCORE VALIDATION (Phase 3):
 *   - `score > maxScore` is REJECTED, not clamped. Silently clamping
 *     hides data-entry errors. A grade of 105/100 is a mistake in the
 *     input, not a grade that should be quietly rounded down.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / deleteStudentGrades / saveGrades
 *     all return Promise<{ success, data?, message? }>
 *   - getStudentGrades / getClassGrades / getDisciplineGrades /
 *     getWeekGrades / getGrade / getAllGrades / getStudentClassGrades
 *     stay synchronous
 *
 * SUMMARY SEMANTICS (Phase 3):
 *   - calculateSummary(grades, scheme) no longer accepts a weight
 *     threshold. Every grade in the input participates.
 *   - The summary returns unweighted average, min, max, pass count,
 *     fail count, pass rate, and a distribution.
 *   - `passing` is determined by the scheme when supplied. When absent,
 *     the default threshold is used.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all grade records keyed to that
 *   character are removed from academy.grades. This helper is called by
 *   CharacterCRUD.deleteCharacter from inside its pipeline mutate, so it
 *   runs in the same transaction as the character removal.
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
 *       type: 'exam',
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
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *
 * USAGE:
 *   var grades = window.AcademyGrades;
 *
 *   grades.create({ studentId, classId, disciplineId, week, score, maxScore })
 *       .then(function(result) { ... });
 *
 *   var studentGrades = grades.getStudentGrades('char_456');
 *   var classGrades = grades.getStudentClassGrades('char_456', 'class_789');
 *   var summary = grades.calculateSummary(studentGrades);
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

    if (!window.AcademyClasses) {
        missing.push('AcademyClasses');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClass !== 'function') {
        missing.push('AcademyClasses.getClass');
    }

    if (!window.AcademyGradeSchemes || typeof window.AcademyGradeSchemes.isPassing !== 'function') {
        missing.push('AcademyGradeSchemes.isPassing');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
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
    var GradeSchemes = window.AcademyGradeSchemes;
    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

    var VALID_GRADE_TYPES = ['exam', 'assignment', 'participation', 'project', 'quiz', 'final'];

    // Default passing threshold when no scheme is supplied.
    var DEFAULT_PASSING_THRESHOLD = GradeSchemes.PASSING_THRESHOLD || 70;

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

    /**
     * Deep clone a value.
     *
     * READ SAFETY: throws if cloning fails or if the clone is the
     * original reference. Aliasing is a bug, not a graceful degradation.
     */
    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyGrades] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
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

    // ============================================================
    // DERIVED FIELD HELPERS (Phase 3)
    // ============================================================
    //
    // percentage and passing are DERIVED, not stored. These helpers
    // compute them on demand. `decorateGrade` returns a CLONE of the
    // input with the derived fields attached.

    /**
     * Compute the percentage for a grade.
     *
     * @param {number} score
     * @param {number} maxScore
     * @returns {number} Rounded percentage (0-100)
     */
    function calculatePercentage(score, maxScore) {
        var max = isNumber(maxScore) && maxScore > 0 ? maxScore : 100;
        var s = isNumber(score) ? score : 0;
        return max > 0 ? Math.round((s / max) * 100) : 0;
    }

    /**
     * Compute whether a grade passes.
     *
     * SCHEME-AWARE: when a scheme is supplied, passing is determined by
     * the scheme's lowest passing band. When it is absent, the default
     * threshold applies.
     *
     * @param {number} score
     * @param {number} maxScore
     * @param {object|null} scheme - Optional grade scheme
     * @returns {boolean}
     */
    function isPassing(score, maxScore, scheme) {
        var pct = calculatePercentage(score, maxScore);
        return GradeSchemes.isPassing(pct, scheme || null) === true;
    }

    /**
     * Attach the derived fields (percentage, passing) to a grade.
     *
     * Returns a CLONE. The input record is not modified.
     *
     * @param {object} grade - Grade record
     * @param {object|null} scheme - Optional grade scheme
     * @returns {object} Decorated clone
     */
    function decorateGrade(grade, scheme) {
        if (!grade || typeof grade !== 'object') {
            return grade;
        }
        var copy = deepClone(grade);
        var pct = calculatePercentage(copy.score, copy.maxScore);
        copy.percentage = pct;
        copy.passing = GradeSchemes.isPassing(pct, scheme || null) === true;
        return copy;
    }

    /**
     * Attach derived fields to an array of grades.
     */
    function decorateGrades(grades, scheme) {
        if (!Array.isArray(grades)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < grades.length; i++) {
            result.push(decorateGrade(grades[i], scheme));
        }
        return result;
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
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
            return null;
        }

        return data.academy;
    }

    // ============================================================
    // INTERNAL GRADE LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

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
    // CLASS VALIDATION - Uses AcademyClasses (no circular dependency)
    // ============================================================

    function validateClassExists(classId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return { valid: false, message: 'Class not found.' };
        }

        return { valid: true, class: cls };
    }

    // ============================================================
    // GRADE VALIDATION
    // ============================================================

    /**
     * Validate grade data.
     *
     * SCORE VALIDATION: when both score and maxScore are present in
     * the input, score must not exceed maxScore. This is checked here
     * AND re-checked in `update` against the candidate, so a change to
     * either field cannot produce an out-of-range combination.
     */
    function validateGradeData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Grade data must be an object.' };
        }

        if (!isPartial || data.studentId !== undefined) {
            if (!isNonEmptyString(data.studentId)) {
                return { valid: false, message: 'Student ID is required.' };
            }
        }

        if (!isPartial || data.classId !== undefined) {
            if (!isNonEmptyString(data.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
        }

        if (!isPartial || data.disciplineId !== undefined) {
            if (!isNonEmptyString(data.disciplineId)) {
                return { valid: false, message: 'Discipline ID is required.' };
            }
        }

        if (!isPartial || data.week !== undefined) {
            var week = parseInt(data.week, 10);
            if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
            }
        }

        if (!isPartial || data.score !== undefined) {
            var score = parseFloat(data.score);
            if (isNaN(score) || score < MIN_SCORE) {
                return { valid: false, message: 'Score must be a number greater than or equal to 0.' };
            }
        }

        if (data.maxScore !== undefined) {
            var maxScore = parseFloat(data.maxScore);
            if (isNaN(maxScore) || maxScore <= 0) {
                return { valid: false, message: 'Max score must be a number greater than 0.' };
            }
        }

        // ---- score <= maxScore ----
        // Only check when both fields are present. Partial updates are
        // checked against the candidate in `update`.
        if (data.score !== undefined && data.maxScore !== undefined) {
            var s = parseFloat(data.score);
            var m = parseFloat(data.maxScore);
            if (!isNaN(s) && !isNaN(m) && s > m) {
                return {
                    valid: false,
                    message: 'Score (' + s + ') cannot exceed max score (' + m + ').'
                };
            }
        }

        if (data.type !== undefined) {
            if (VALID_GRADE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid grade type. Must be one of: ' + VALID_GRADE_TYPES.join(', ') };
            }
        }

        // NOTE: `weight` is not validated here. Phase 3 removed weight
        // from grade records. If a caller passes weight, it is silently
        // ignored by buildGradeRecord. The field is not part of the
        // canonical grade shape.

        return { valid: true };
    }

    /**
     * Validate a completed candidate record.
     *
     * This is the final gate before mutation. It enforces invariants
     * that the partial-update validator cannot check in isolation:
     *   - score <= maxScore
     *   - week in bounds
     *   - every required field present
     *
     * Returns { valid, message? }.
     */
    function validateCandidate(candidate) {
        if (!isObject(candidate)) {
            return { valid: false, message: 'Candidate is not an object.' };
        }

        if (!isNonEmptyString(candidate.studentId)) {
            return { valid: false, message: 'Candidate missing studentId.' };
        }
        if (!isNonEmptyString(candidate.classId)) {
            return { valid: false, message: 'Candidate missing classId.' };
        }
        if (!isNonEmptyString(candidate.disciplineId)) {
            return { valid: false, message: 'Candidate missing disciplineId.' };
        }

        var week = parseInt(candidate.week, 10);
        if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
            return { valid: false, message: 'Candidate week is out of range.' };
        }

        var score = parseFloat(candidate.score);
        if (isNaN(score) || score < MIN_SCORE) {
            return { valid: false, message: 'Candidate score is invalid.' };
        }

        var maxScore = parseFloat(candidate.maxScore);
        if (isNaN(maxScore) || maxScore <= 0) {
            return { valid: false, message: 'Candidate maxScore is invalid.' };
        }

        if (score > maxScore) {
            return {
                valid: false,
                message: 'Candidate score (' + score + ') exceeds maxScore (' + maxScore + ').'
            };
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    /**
     * Build a canonical grade record from raw data.
     *
     * Pure - does not touch window.data.
     *
     * Phase 3 changes:
     *   - No `weight` field. Weight is not a property of a grade.
     *   - No `percentage` or `passing` fields. Both are derived on read.
     *   - `score` is NOT clamped. The caller is responsible for
     *     validation; if `score > maxScore`, `validateGradeData` /
     *     `validateCandidate` reject it before we get here.
     */
    function buildGradeRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();

        var score = parseFloat(data.score);
        var maxScore = data.maxScore !== undefined ? parseFloat(data.maxScore) : 100;
        var week = parseInt(data.week, 10);

        var record = {
            id: existingId || generateId(),
            studentId: String(data.studentId),
            classId: String(data.classId),
            disciplineId: String(data.disciplineId),
            week: week,
            score: score,
            maxScore: maxScore > 0 ? maxScore : 100,
            type: data.type || 'assignment',
            date: data.date || now.split('T')[0],
            notes: data.notes || '',
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };

        return record;
    }

    // ============================================================
    // PUBLIC API - GRADE CRUD (Promise-based, via MutationPipeline)
    // ============================================================

    /**
     * Create a new grade.
     *
     * @param {object} data - Grade data
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function create(data) {
        var validation = validateGradeData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        var newGrade = buildGradeRecord(data, null, null);

        // Full candidate validation as a final gate.
        var candidateCheck = validateCandidate(newGrade);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        var targetId = newGrade.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                if (appData.academy.grades && appData.academy.grades[targetId]) {
                    return { valid: false, message: 'Grade ID collision.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.grades || typeof appData.academy.grades !== 'object') {
                    appData.academy.grades = {};
                }
                appData.academy.grades[targetId] = deepClone(newGrade);
                return { grade: newGrade, id: targetId };
            },
            logMessage: 'Created grade for student ' + newGrade.studentId,
            successMessage: 'Grade created successfully!',
            failureMessage: 'Failed to create grade.'
        });
    }

    /**
     * Update an existing grade.
     *
     * VALIDATION ORDER:
     *   1. Validate each individual field in `updates`.
     *   2. Apply the updates to a clone of the existing record.
     *   3. Validate the resulting candidate as a whole. This catches
     *      cross-field violations that field-level checks miss —
     *      e.g. lowering maxScore below the existing score, or raising
     *      score above the existing maxScore.
     *   4. Only commit if the candidate passes.
     */
    function update(gradeId, updates) {
        if (!isNonEmptyString(gradeId)) {
            return Promise.resolve(failure('Grade ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getGradeRecord(gradeId);
        if (!existing) {
            return Promise.resolve(failure('Grade not found.'));
        }

        // ---- Validate update shape ----
        var fieldValidation = validateGradeData(updates, true);
        if (!fieldValidation.valid) {
            return Promise.resolve(failure(fieldValidation.message));
        }

        // ---- Build candidate ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone grade data.'));
        }

        var hasChanges = false;
        var updateFields = ['studentId', 'classId', 'disciplineId', 'week', 'score', 'maxScore', 'type', 'date', 'notes'];

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
                        return Promise.resolve(failure(field + ' must be a non-empty string.'));
                    }
                    if (candidate[field] !== String(value)) {
                        candidate[field] = String(value);
                        hasChanges = true;
                    }
                    break;

                case 'week':
                    var week = parseInt(value, 10);
                    if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                        return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
                    }
                    if (candidate.week !== week) {
                        candidate.week = week;
                        hasChanges = true;
                    }
                    break;

                case 'score':
                    var score = parseFloat(value);
                    if (isNaN(score) || score < MIN_SCORE) {
                        return Promise.resolve(failure('Score must be a number greater than or equal to 0.'));
                    }
                    if (candidate.score !== score) {
                        candidate.score = score;
                        hasChanges = true;
                    }
                    break;

                case 'maxScore':
                    var newMax = parseFloat(value);
                    if (isNaN(newMax) || newMax <= 0) {
                        return Promise.resolve(failure('Max score must be a number greater than 0.'));
                    }
                    if (candidate.maxScore !== newMax) {
                        candidate.maxScore = newMax;
                        hasChanges = true;
                    }
                    break;

                case 'type':
                    if (VALID_GRADE_TYPES.indexOf(value) === -1) {
                        return Promise.resolve(failure('Invalid grade type. Must be one of: ' + VALID_GRADE_TYPES.join(', ')));
                    }
                    if (candidate.type !== value) {
                        candidate.type = value;
                        hasChanges = true;
                    }
                    break;

                case 'date':
                    if (value !== null && typeof value !== 'string') {
                        return Promise.resolve(failure('Date must be a string.'));
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
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ grade: decorateGrade(existing), changed: false }));
        }

        // ---- Full candidate validation ----
        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(gradeId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                if (!appData.academy.grades[targetId]) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.grades) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.grades[targetId]) {
                    throw new Error('Grade not found in data store.');
                }
                appData.academy.grades[targetId] = deepClone(candidate);
                return { grade: candidate, changed: true };
            },
            logMessage: 'Updated grade for student ' + candidate.studentId,
            successMessage: 'Grade updated successfully!',
            failureMessage: 'Failed to update grade.'
        });
    }

    /**
     * Delete a grade permanently.
     *
     * @param {string} gradeId - Grade ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function deleteGrade(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return Promise.resolve(failure('Grade ID is required.'));
        }

        var target = String(gradeId);
        var existing = getGradeRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Grade not found.'));
        }

        var gradeInfo = {
            id: target,
            studentId: existing.studentId,
            disciplineId: existing.disciplineId,
            week: existing.week
        };

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                if (!appData.academy.grades[target]) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.grades) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.grades[target]) {
                    throw new Error('Grade not found in data store.');
                }
                delete appData.academy.grades[target];
                return { deleted: true, grade: gradeInfo };
            },
            logMessage: 'Deleted grade',
            successMessage: 'Grade deleted successfully!',
            failureMessage: 'Failed to delete grade.'
        });
    }

    /**
     * Delete all grades for a student.
     *
     * @param {string} studentId - Student ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function deleteStudentGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var targetStudent = String(studentId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var grades = appData.academy.grades;
                var toRemove = [];
                var removed = [];

                for (var id in grades) {
                    if (Object.prototype.hasOwnProperty.call(grades, id)) {
                        var grade = grades[id];
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
                    delete grades[toRemove[i]];
                }

                return {
                    studentId: targetStudent,
                    removedCount: removed.length,
                    removed: removed
                };
            },
            logMessage: 'Deleted all grades for student ' + targetStudent,
            successMessage: 'Student grades deleted successfully!',
            failureMessage: 'Failed to delete student grades.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================
    //
    // Grades are returned as DEEP CLONES. The derived fields
    // (`percentage`, `passing`) are NOT attached by default. Callers
    // that need them either pass a scheme to the query helpers here,
    // or call `decorateGrade` / `decorateGrades` directly.
    //
    // Returning the raw record without derived fields is deliberate:
    // it forces callers to decide what scheme applies. `passing`
    // without a scheme is a lossy answer that can silently disagree
    // with what the UI displays.

    function sortGrades(a, b) {
        if (a.week !== b.week) {
            return a.week - b.week;
        }
        return (a.date || '').localeCompare(b.date || '');
    }

    /**
     * Get all grades for a student, optionally filtered to a week.
     *
     * @param {string} studentId - Student ID
     * @param {number|string} [week] - Optional week filter
     * @returns {array} Array of cloned grade records
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
            if (String(grade.studentId) !== targetStudent) {
                continue;
            }
            if (week !== undefined) {
                var weekNum = parseInt(week, 10);
                if (!isNaN(weekNum) && grade.week !== weekNum) {
                    continue;
                }
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    /**
     * Get all grades for a student within a specific class.
     *
     * PHASE 3 ADDITION: this is the query the inline grades editor
     * actually needs. A student's grades are class-scoped in the UI,
     * but the underlying record store is flat. This filters to the
     * requested class in one pass.
     *
     * @param {string} studentId - Student ID
     * @param {string} classId - Class ID
     * @param {number|string} [week] - Optional week filter
     * @returns {array} Array of cloned grade records
     */
    function getStudentClassGrades(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetStudent = String(studentId);
        var targetClass = String(classId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.studentId) !== targetStudent) {
                continue;
            }
            if (String(grade.classId) !== targetClass) {
                continue;
            }
            if (week !== undefined) {
                var weekNum = parseInt(week, 10);
                if (!isNaN(weekNum) && grade.week !== weekNum) {
                    continue;
                }
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getClassGrades(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetClass = String(classId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.classId) !== targetClass) {
                continue;
            }
            if (week !== undefined) {
                var weekNum = parseInt(week, 10);
                if (!isNaN(weekNum) && grade.week !== weekNum) {
                    continue;
                }
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getDisciplineGrades(disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetDiscipline = String(disciplineId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.disciplineId) !== targetDiscipline) {
                continue;
            }
            if (week !== undefined) {
                var weekNum = parseInt(week, 10);
                if (!isNaN(weekNum) && grade.week !== weekNum) {
                    continue;
                }
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getWeekGrades(week, classId) {
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        var all = getGradeRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (grade.week !== weekNum) {
                continue;
            }
            if (classId !== undefined && String(grade.classId) !== String(classId)) {
                continue;
            }
            result.push(grade);
        }

        return result.map(function(g) { return deepClone(g); });
    }

    function getGrade(gradeId) {
        var grade = getGradeRecord(gradeId);
        return grade ? deepClone(grade) : null;
    }

    function getAllGrades() {
        var records = getGradeRecords();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    // ============================================================
    // CALCULATION FUNCTIONS - Pure
    // ============================================================

    /**
     * Calculate a summary for a list of grades.
     *
     * Phase 3 changes:
     *   - No `weightThreshold`. Every grade in the input participates.
     *   - No `weightedAverage` or `totalWeight`. Weight is a property
     *     of the assessment type, not the grade, and it lives on the
     *     discipline. Weighted averages are computed by the
     *     performance layer (academy-performance.js).
     *   - `passing` is SCHEME-AWARE. When a scheme is supplied, passing
     *     is determined by the scheme's lowest passing band. When
     *     absent, the default threshold is used.
     *   - Derived fields are computed on the fly. Grades from the store
     *     do not carry `percentage` / `passing`; grades from a caller
     *     that ran `decorateGrade` do. The summary accepts either.
     *
     * @param {array} grades - Array of grade records
     * @param {object|null} [scheme] - Optional grade scheme
     * @returns {object} Summary statistics
     */
    function calculateSummary(grades, scheme) {
        var count = Array.isArray(grades) ? grades.length : 0;

        if (count === 0) {
            return {
                count: 0,
                average: 0,
                max: 0,
                min: 0,
                passing: 0,
                failing: 0,
                passRate: 0,
                gradeDistribution: {}
            };
        }

        var total = 0;
        var max = -Infinity;
        var min = Infinity;
        var passing = 0;
        var failing = 0;
        var distribution = {};

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            if (!grade || typeof grade !== 'object') {
                continue;
            }

            var pct = grade.percentage !== undefined
                ? grade.percentage
                : calculatePercentage(grade.score, grade.maxScore);

            total += pct;
            if (pct > max) max = pct;
            if (pct < min) min = pct;

            var isPass;
            if (grade.passing !== undefined) {
                isPass = grade.passing === true;
            } else {
                isPass = GradeSchemes.isPassing(pct, scheme || null) === true;
            }

            if (isPass) {
                passing++;
            } else {
                failing++;
            }

            var bin = Math.floor(pct / 10) * 10;
            var binKey = bin + '-' + (bin + 9);
            if (pct === 100) {
                binKey = '100';
            }
            if (!distribution[binKey]) {
                distribution[binKey] = 0;
            }
            distribution[binKey]++;
        }

        var avg = total / count;

        return {
            count: count,
            average: Math.round(avg * 10) / 10,
            max: Math.round(max * 10) / 10,
            min: Math.round(min * 10) / 10,
            passing: passing,
            failing: failing,
            passRate: Math.round((passing / count) * 100),
            gradeDistribution: distribution
        };
    }

    /**
     * Calculate a class summary for a specific week.
     */
    function calculateClassSummary(classId, week, scheme) {
        var grades = getClassGrades(classId, week);
        return calculateSummary(grades, scheme);
    }

    /**
     * Calculate a student's GPA across all grades.
     *
     * SCHEME-AWARE: `passing` is determined by the scheme when
     * supplied.
     */
    function calculateStudentGPA(studentId, week, scheme) {
        var grades = getStudentGrades(studentId, week);
        var summary = calculateSummary(grades, scheme);

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
            passRate: summary.passRate,
            gpa: gpa,
            passing: summary.passing,
            failing: summary.failing
        };
    }

    /**
     * Calculate class ranking for a specific week.
     *
     * NOTE: ranking by UNWEIGHTED average is a legacy path. The
     * canonical ranking calculation lives in the performance layer
     * and is consumed by AcademyRanking. This function is retained for
     * callers that want a quick unweighted ordering. It does NOT
     * consult discipline.assessmentWeights.
     *
     * @param {string} classId
     * @param {number} week
     * @param {function} [getCharacterById] - Optional name resolver
     * @param {object} [scheme] - Optional grade scheme
     * @returns {array}
     */
    function calculateClassRanking(classId, week, getCharacterById, scheme) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var grades = getClassGrades(classId, week);
        var studentAverages = {};

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            var studentId = grade.studentId;
            var pct = grade.percentage !== undefined
                ? grade.percentage
                : calculatePercentage(grade.score, grade.maxScore);

            if (!studentAverages[studentId]) {
                studentAverages[studentId] = { total: 0, count: 0 };
            }
            studentAverages[studentId].total += pct;
            studentAverages[studentId].count++;
        }

        var result = [];
        for (var sid in studentAverages) {
            if (Object.prototype.hasOwnProperty.call(studentAverages, sid)) {
                var data = studentAverages[sid];
                var avg = data.count > 0 ? data.total / data.count : 0;
                var name = 'Unknown';
                if (typeof getCharacterById === 'function') {
                    var char = getCharacterById(sid);
                    if (char && typeof char === 'object') {
                        name = (char.firstName || '') + ' ' + (char.lastName || '');
                        if (!name.trim()) name = 'Unknown';
                    }
                }
                result.push({
                    studentId: sid,
                    name: name,
                    average: Math.round(avg * 10) / 10,
                    gradeCount: data.count,
                    rank: 0
                });
            }
        }

        result.sort(function(a, b) {
            return b.average - a.average;
        });

        for (var j = 0; j < result.length; j++) {
            result[j].rank = j + 1;
        }

        return result;
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    function stripCharacterRefs(appData, charId) {
        var result = { gradesRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var grades = appData.academy.grades;
        if (!grades || typeof grades !== 'object' || Array.isArray(grades)) {
            return result;
        }

        var target = String(charId);
        var keysToRemove = [];

        Object.keys(grades).forEach(function(id) {
            var grade = grades[id];
            if (grade && String(grade.studentId) === target) {
                keysToRemove.push(id);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete grades[keysToRemove[i]];
        }

        result.gradesRemoved = keysToRemove.length;
        return result;
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Save multiple grades at once.
     *
     * PLAN / APPLY: validate each entry, decide create/update/skip,
     * apply all writes in a single transaction.
     */
    function saveGrades(gradesData, options) {
        if (!Array.isArray(gradesData) || gradesData.length === 0) {
            return Promise.resolve(failure('Grade data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var existingGrades = getGradeRecords();
        var planned = [];
        var errors = [];

        for (var i = 0; i < gradesData.length; i++) {
            var data = gradesData[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid grade data.' });
                continue;
            }

            if (!data.studentId || !data.classId || !data.disciplineId ||
                data.week === undefined || data.score === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: studentId, classId, disciplineId, week, score'
                });
                continue;
            }

            var validation = validateGradeData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, error: validation.message });
                continue;
            }

            var existing = null;
            for (var j = 0; j < existingGrades.length; j++) {
                var g = existingGrades[j];
                if (String(g.studentId) === String(data.studentId) &&
                    String(g.classId) === String(data.classId) &&
                    String(g.disciplineId) === String(data.disciplineId) &&
                    g.week === parseInt(data.week, 10)) {
                    existing = g;
                    break;
                }
            }

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildGradeRecord(data, existing.id, existing.createdAt);
                var candidateCheck = validateCandidate(candidate);
                if (!candidateCheck.valid) {
                    errors.push({ index: i, error: candidateCheck.message });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildGradeRecord(data, null, null);
                var newCheck = validateCandidate(newRecord);
                if (!newCheck.valid) {
                    errors.push({ index: i, error: newCheck.message });
                    continue;
                }
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        if (creates.length === 0 && updates.length === 0) {
            return Promise.resolve(success({
                total: gradesData.length,
                created: 0,
                updated: 0,
                skipped: skipped,
                errors: errors,
                successCount: 0
            }));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.grades || typeof appData.academy.grades !== 'object') {
                    appData.academy.grades = {};
                }

                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];
                    if (item.action === 'create') {
                        appData.academy.grades[item.record.id] = deepClone(item.record);
                        created++;
                    } else if (item.action === 'update') {
                        if (!appData.academy.grades[item.matchId]) {
                            throw new Error('Grade no longer exists: ' + item.matchId);
                        }
                        appData.academy.grades[item.matchId] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: gradesData.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' grade(s)',
            successMessage: 'Grades saved successfully!',
            failureMessage: 'Failed to save grades.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGrades = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteGrade,
        deleteStudentGrades: deleteStudentGrades,
        saveGrades: saveGrades,

        // ---- Public queries (synchronous, CLONES) ----
        getStudentGrades: getStudentGrades,
        getStudentClassGrades: getStudentClassGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        getWeekGrades: getWeekGrades,
        getGrade: getGrade,
        getAllGrades: getAllGrades,

        // ---- Calculations (synchronous, pure) ----
        calculateSummary: calculateSummary,
        calculateClassSummary: calculateClassSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,

        // ---- Derived field helpers ----
        decorateGrade: decorateGrade,
        decorateGrades: decorateGrades,
        calculatePercentage: calculatePercentage,
        isPassing: isPassing,

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

        // ---- Internal (LIVE REFERENCES - for AcademyQueries and internal use) ----
        getGradeRecord: getGradeRecord,
        getGradeRecords: getGradeRecords,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        DEFAULT_PASSING_THRESHOLD: DEFAULT_PASSING_THRESHOLD,
        VALID_GRADE_TYPES: VALID_GRADE_TYPES
    };

})();
