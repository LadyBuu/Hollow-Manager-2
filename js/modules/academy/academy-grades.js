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
 *   - Public queries (getStudentGrades, getClassGrades, getDisciplineGrades,
 *     getWeekGrades, getGrade, getAllGrades) return DEEP CLONES. Callers
 *     cannot mutate live state by writing to a returned grade.
 *   - Internal accessors (getGradeRecord, getGradeRecords) keep returning
 *     LIVE REFERENCES. They are consumed by this module's own mutation
 *     paths and by AcademyQueries.
 *   - Pipeline validate() callbacks read from the `appData` argument the
 *     pipeline supplies, not from window.data via the internal accessors.
 *     This makes validation consistent with the snapshot the mutation
 *     will be applied to.
 *   - ObjectUtils.deepClone is used as the clone primitive. If cloning
 *     fails, the accessor throws. It does NOT fall back to returning the
 *     original reference, because that would silently alias live state.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / deleteStudentGrades / saveGrades
 *     all return Promise<{ success, data?, message? }>
 *   - getStudentGrades / getClassGrades / getDisciplineGrades / getWeekGrades /
 *     getGrade / getAllGrades and all calculate* functions stay synchronous
 *
 * SUMMARY SEMANTICS:
 *   - weightThreshold is the MINIMUM weight for a grade to be included in
 *     the summary. A grade with weight below threshold does NOT participate
 *     in average, weightedAverage, passing, failing, passRate, or count.
 *   - `count` is the number of INCLUDED grades (weight >= threshold).
 *   - `totalCount` is the number of grades passed in (includes excluded).
 *   - The denominator for average / passRate is `count`, not totalCount.
 *     This is the correct reading of "minimum weight to include".
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all grade records keyed to that character
 *   are removed from academy.grades. This helper is called by
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
 *       weight: 1.0,
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
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *
 * USAGE:
 *   var grades = window.AcademyGrades;
 *
 *   // Mutations (Promise-based)
 *   grades.create({ studentId, classId, disciplineId, week, score })
 *       .then(function(result) { ... });
 *
 *   // Reads (synchronous)
 *   var studentGrades = grades.getStudentGrades('char_456');
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
    var MutationPipeline = window.MutationPipeline;
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

    /**
     * Deep clone a value.
     *
     * READ SAFETY: this primitive throws if cloning fails. It does NOT
     * fall back to returning the original reference, because that would
     * silently alias live state and let callers mutate the store by
     * writing to a "cloned" result.
     *
     * @param {*} value - Value to clone
     * @returns {*} Deep clone
     * @throws {Error} If cloning fails
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
    //
    // READ SAFETY:
    //   - getDataStore() returns null when window.data is missing.
    //   - getAcademyStore() returns null when window.data.academy is
    //     missing. It does NOT create academy.{...} as a side effect
    //     of a read.
    //
    //   Structure creation happens ONLY inside pipeline mutate()
    //   callbacks, operating on the appData snapshot the pipeline
    //   hands in. That keeps reads side-effect free.

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
    //
    // These return LIVE REFERENCES. They are consumed by this
    // module's own mutation paths and by AcademyQueries. The public
    // read surface (below) wraps them with deepClone.

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

        if (data.type !== undefined) {
            if (VALID_GRADE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid grade type. Must be one of: ' + VALID_GRADE_TYPES.join(', ') };
            }
        }

        if (data.weight !== undefined) {
            var weight = parseFloat(data.weight);
            if (isNaN(weight) || weight < 0 || weight > 2) {
                return { valid: false, message: 'Weight must be between 0 and 2.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    /**
     * Build a canonical grade record from raw data.
     * Pure - does not touch window.data.
     */
    function buildGradeRecord(data, existingId) {
        var now = new Date().toISOString();
        var score = parseFloat(data.score);
        var maxScore = data.maxScore !== undefined ? parseFloat(data.maxScore) : 100;
        var weight = data.weight !== undefined ? parseFloat(data.weight) : 1.0;
        var week = parseInt(data.week, 10);

        return {
            id: existingId || generateId(),
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
        // Pre-flight validation
        var validation = validateGradeData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        var newGrade = buildGradeRecord(data, null);
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
     * @param {string} gradeId - Grade ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
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

        // Build candidate
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone grade data.'));
        }

        var hasChanges = false;
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
                    var maxScore = candidate.maxScore || 100;
                    if (candidate.score !== clamp(score, MIN_SCORE, maxScore)) {
                        candidate.score = clamp(score, MIN_SCORE, maxScore);
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

                case 'weight':
                    var weight = parseFloat(value);
                    if (isNaN(weight) || weight < 0 || weight > 2) {
                        return Promise.resolve(failure('Weight must be between 0 and 2.'));
                    }
                    if (candidate.weight !== weight) {
                        candidate.weight = weight;
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
            return Promise.resolve(success({ grade: deepClone(existing), changed: false }));
        }

        // Recompute derived fields
        candidate.percentage = calculatePercentage(candidate.score, candidate.maxScore);
        candidate.passing = isPassing(candidate.score, candidate.maxScore);
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
    // These are the consumer-facing lookups. They return DEEP CLONES
    // (or arrays of clones) so callers cannot mutate live state by
    // writing to a returned grade. Internal code paths within this
    // module continue to use the *Internal accessors, which return
    // live references.

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

        result.sort(function(a, b) {
            if (a.week !== b.week) {
                return a.week - b.week;
            }
            return (a.date || '').localeCompare(b.date || '');
        });

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
            if (grade.week === weekNum) {
                if (classId !== undefined && String(grade.classId) !== String(classId)) {
                    continue;
                }
                result.push(grade);
            }
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
     * SEMANTICS:
     *   - weightThreshold is the MINIMUM weight for a grade to be
     *     included in the summary.
     *   - Grades with weight below threshold are excluded from ALL
     *     summary fields: average, weightedAverage, passing, failing,
     *     passRate, and count.
     *   - `count` is the number of INCLUDED grades.
     *   - `totalCount` is the raw input length, for callers that need
     *     to distinguish "grades counted" from "grades passed in".
     *
     * @param {array} grades - Array of grade objects
     * @param {number} weightThreshold - Minimum weight to include (default: 0.5)
     * @returns {object} Summary statistics
     */
    function calculateSummary(grades, weightThreshold) {
        var totalCount = Array.isArray(grades) ? grades.length : 0;

        if (totalCount === 0) {
            return {
                count: 0,
                totalCount: 0,
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

        weightThreshold = typeof weightThreshold === 'number' ? weightThreshold : 0.5;

        var count = 0;
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
            var weight = typeof grade.weight === 'number' ? grade.weight : 1.0;

            // Below-threshold grades are excluded from ALL fields.
            if (weight < weightThreshold) {
                continue;
            }

            var score = grade.score || 0;
            var maxScore = grade.maxScore || 100;
            var percentage = grade.percentage !== undefined
                ? grade.percentage
                : calculatePercentage(score, maxScore);

            count++;
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

        if (count === 0) {
            return {
                count: 0,
                totalCount: totalCount,
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

        var avg = total / count;
        var weightedAvg = totalWeight > 0 ? weightedTotal / totalWeight : 0;

        return {
            count: count,
            totalCount: totalCount,
            average: Math.round(avg * 10) / 10,
            max: Math.round(max * 10) / 10,
            min: Math.round(min * 10) / 10,
            passing: passing,
            failing: failing,
            passRate: Math.round((passing / count) * 100),
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
            totalGradeCount: summary.totalCount,
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
            var percentage = grade.percentage !== undefined
                ? grade.percentage
                : calculatePercentage(grade.score, grade.maxScore || 100);
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

    /**
     * Strip all grade records for a character from academy.grades.
     *
     * Grades are keyed by id and carry a studentId. Deleting a student
     * makes their grades unreachable.
     *
     * This helper is PURE with respect to `appData`: it mutates the
     * store, but it does not touch `window.data`. It is designed to be
     * called from inside a pipeline mutate() callback in another
     * module's transaction. It never throws.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID to strip
     * @returns {object} { gradesRemoved }
     */
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
     * @param {array} gradesData - Array of grade data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing grades
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function saveGrades(gradesData, options) {
        if (!Array.isArray(gradesData) || gradesData.length === 0) {
            return Promise.resolve(failure('Grade data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        // Pre-flight: validate each entry and build candidate records.
        // This is where we do the "find existing" pass WITHOUT touching
        // window.data — we read the live store via getGradeRecords().

        var existingGrades = getGradeRecords();
        var planned = [];   // { action: 'create'|'update'|'skip', record, matchId }
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

            // Find existing grade for the same (student, class, discipline, week)
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
                // Build updated candidate
                var candidate = buildGradeRecord(data, existing.id);
                candidate.createdAt = existing.createdAt;
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                // Build new candidate
                var newRecord = buildGradeRecord(data, null);
                planned.push({ action: 'create', record: newRecord });
            }
        }

        // Filter out skips for the mutation count
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

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

        // ---- Internal (LIVE REFERENCES - for AcademyQueries and internal use) ----
        getGradeRecord: getGradeRecord,
        getGradeRecords: getGradeRecords,

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
