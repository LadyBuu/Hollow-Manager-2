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
 *   - This module OWNS grade data - it does NOT depend on AcademyQueries.
 *   - Uses AcademyClasses internal methods for class data (no circular dependency).
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging).
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *   - This module does NOT call saveData() directly - the pipeline does.
 *   - AcademyQueries is the PUBLIC read facade that uses these internal
 *     lookups.
 *
 * STORAGE NAMESPACE (v28):
 *   Grade records live at academy.grades (unchanged).
 *
 *   Discipline records live at academy.disciplines. The legacy
 *   curriculum.disciplines location was retired. The snapshot
 *   validator reads from academy.disciplines and falls back to
 *   curriculum.disciplines only for pre-v28 snapshots loaded
 *   mid-transaction.
 *
 * READ SAFETY:
 *   - getAcademyStore() returns null (does NOT create academy.{...})
 *     when the store is missing. Reads are side-effect free.
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
 * GRADE IDENTITY:
 *   A grade's identity is the five-field tuple:
 *
 *     (studentId, classId, disciplineId, week, type)
 *
 *   A student can have an exam and an assignment in the same week of
 *   the same discipline; both are legitimate records. Identity
 *   includes `type` for that reason.
 *
 *   `create` does not enforce the tuple (two grades with different
 *   IDs may coexist), because a caller that genuinely wants two
 *   records of the same tuple is allowed to write them. The tuple is
 *   the OVERWRITE MATCHING KEY in `saveGrades`: an input record whose
 *   tuple matches an existing grade updates that grade in place.
 *
 *   Callers that want "exactly one grade per tuple" enforce it
 *   themselves.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the `appData` argument it is handed. It does not read
 *   window.data. Preflight reads against window.data are for early
 *   UX feedback only; the pipeline re-checks against the snapshot.
 *
 *   This applies to create, update, delete, and saveGrades.
 *   Foreign keys (classId, studentId, disciplineId) are validated
 *   against the snapshot, not against AcademyClasses or
 *   CharacterQueries.
 *
 * FOREIGN KEYS:
 *   A grade carries three foreign keys: classId, studentId,
 *   disciplineId.
 *
 *   - classId MUST resolve in the transaction snapshot. This is the
 *     module's oldest invariant and is enforced at every mutation.
 *
 *   - studentId MUST resolve in the transaction snapshot. A grade
 *     whose student no longer exists is orphaned state.
 *
 *   - disciplineId MUST resolve in the transaction snapshot. A
 *     grade whose discipline no longer exists is orphaned state.
 *
 *   The cascade path handles the "student or discipline removed"
 *   case: stripCharacterRefs removes the student's grades, and
 *   AcademyCascade.disciplineDeleted removes a discipline's grades.
 *   So a grade that survives a cascade is one whose references
 *   were live at the moment it was written.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, the
 *   canonical strict parser. No `parseInt` coercion. "5bananas"
 *   is rejected, not silently accepted as 5.
 *
 * NUMERIC PARSING:
 *   Numeric fields (score, maxScore) accept numbers and numeric
 *   strings. A numeric string is parsed strictly: the full string
 *   must be a valid finite number after trimming. "85" parses to
 *   85. "85abc" is rejected. "" is rejected. NaN and Infinity are
 *   rejected.
 *
 *   This is stricter than `parseFloat`, which accepts "85abc" as
 *   85. The strict parser exists because loose parsing silently
 *   turns malformed input into plausible data, which is the exact
 *   failure mode this module's validation layer exists to prevent.
 *
 * WEIGHT MODEL:
 *   Grades do NOT carry a `weight` field. Weight is a property of
 *   the ASSESSMENT TYPE within a discipline, not of the individual
 *   grade record. It lives at discipline.assessmentWeights.
 *
 *   Weighted averages are computed by the performance layer
 *   (academy-performance.js). This module does not compute them.
 *
 * DERIVED vs STORED:
 *   `percentage` and `passing` are DERIVED. They are not stored on
 *   the grade record.
 *
 *   `percentage` = round(score / maxScore * 100).
 *   `passing` is SCHEME-AWARE. When a discipline grade scheme is
 *   supplied, passing is computed via AcademyGradeSchemes.isPassing.
 *
 *   `decorateGrade(grade, scheme)` attaches these fields to a
 *   cloned grade for display. Callers that want them on a read
 *   result opt in by passing a scheme.
 *
 *   CALCULATION FUNCTIONS DERIVE, THEY DO NOT TRUST:
 *     calculateSummary, calculatePercentage, isPassing, and
 *     decorateGrade all DERIVE their results from score /
 *     maxScore / scheme. If a caller passes an object with a
 *     pre-computed `percentage` or `passing` field, that field is
 *     IGNORED.
 *
 * SCORE VALIDATION:
 *   `score > maxScore` is REJECTED, not clamped.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / deleteStudentGrades / saveGrades
 *     all return Promise<{ success, data?, message? }>
 *   - getStudentGrades / getClassGrades / getDisciplineGrades /
 *     getWeekGrades / getGrade / getAllGrades / getStudentClassGrades
 *     stay synchronous
 *
 * SUMMARY SEMANTICS:
 *   - calculateSummary(grades, scheme) — every grade in the input
 *     participates. Malformed input (a non-object entry) is
 *     REJECTED with a throw, not silently skipped.
 *   - The summary returns unweighted average, min, max, pass count,
 *     fail count, pass rate, and a distribution.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all grade records keyed to that
 *   character are removed from academy.grades. This helper is called
 *   by CharacterCRUD.deleteCharacter from inside its pipeline mutate,
 *   so it runs in the same transaction as the character removal.
 *
 *   A missing grades store is a no-op. A store that is present but
 *   malformed (not a plain object, or an array) is an ERROR. The
 *   stricter rule prevents a corrupted store from masquerading as
 *   "nothing to remove".
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
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
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

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
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
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var AcademyClasses = window.AcademyClasses;
    var GradeSchemes = window.AcademyGradeSchemes;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

    var VALID_GRADE_TYPES = ['exam', 'assignment', 'participation', 'project', 'quiz', 'final'];

    var DEFAULT_PASSING_THRESHOLD =
        (GradeSchemes.PASSING_THRESHOLD !== undefined &&
         GradeSchemes.PASSING_THRESHOLD !== null)
            ? GradeSchemes.PASSING_THRESHOLD
            : 70;

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

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    /**
     * Parse a finite number strictly.
     *
     * Accepts a number that is finite, or a numeric string whose
     * trimmed form is a valid finite decimal number. Rejects
     * trailing characters, empty strings, NaN, Infinity.
     */
    function parseFiniteNumberStrict(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            return isFinite(value) ? value : null;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') {
                return null;
            }
            if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return isFinite(n) ? n : null;
        }

        return null;
    }

    // ============================================================
    // DERIVED FIELD HELPERS
    // ============================================================

    function calculatePercentage(score, maxScore) {
        if (!isNumber(score)) {
            throw new Error(
                '[AcademyGrades] calculatePercentage requires a finite ' +
                'score. Got ' + String(score) + '.'
            );
        }
        if (!isNumber(maxScore) || maxScore <= 0) {
            throw new Error(
                '[AcademyGrades] calculatePercentage requires a positive ' +
                'finite maxScore. Got ' + String(maxScore) + '.'
            );
        }
        return Math.round((score / maxScore) * 100);
    }

    function isPassing(score, maxScore, scheme) {
        var pct = calculatePercentage(score, maxScore);
        return GradeSchemes.isPassing(pct, scheme || null) === true;
    }

    function decorateGrade(grade, scheme) {
        if (!isObject(grade)) {
            throw new Error(
                '[AcademyGrades] decorateGrade requires a grade object. ' +
                'Got ' + (grade === null ? 'null' : typeof grade) + '.'
            );
        }
        var copy = deepClone(grade);
        var pct = calculatePercentage(copy.score, copy.maxScore);
        copy.percentage = pct;
        copy.passing = GradeSchemes.isPassing(pct, scheme || null) === true;
        return copy;
    }

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
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================
    //
    // Used by pipeline validate() callbacks. Read from the appData
    // snapshot, not window.data.

    function findGradeInSnapshot(appData, gradeId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var grades = appData.academy.grades;
        if (!isObject(grades)) {
            return null;
        }
        var record = grades[String(gradeId)];
        if (!isObject(record)) {
            return null;
        }
        return record;
    }

    function findClassInSnapshot(appData, classId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var store = appData.academy.graduatingClasses;
        if (!isObject(store)) {
            return null;
        }
        if (!isNonEmptyString(classId)) {
            return null;
        }
        return store[String(classId)] || null;
    }

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        if (!isNonEmptyString(charId)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    /**
     * Resolve a discipline reference against the transaction
     * snapshot.
     *
     * Disciplines live at academy.disciplines. The legacy
     * curriculum.disciplines location is checked as a fallback for
     * pre-v28 snapshots that may still be in play mid-transaction
     * (an old save loaded into memory, a mid-upgrade window). The
     * primary store always wins when both are present.
     */
    function findDisciplineInSnapshot(appData, disciplineId) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var target = String(disciplineId);

        // Primary: academy.disciplines
        if (appData.academy && typeof appData.academy === 'object') {
            var academyList = appData.academy.disciplines;
            if (Array.isArray(academyList)) {
                for (var a = 0; a < academyList.length; a++) {
                    var ad = academyList[a];
                    if (ad && String(ad.id) === target) {
                        return ad;
                    }
                }
            }
        }

        // Legacy fallback: curriculum.disciplines
        if (appData.curriculum && typeof appData.curriculum === 'object') {
            var legacyList = appData.curriculum.disciplines;
            if (Array.isArray(legacyList)) {
                for (var l = 0; l < legacyList.length; l++) {
                    var ld = legacyList[l];
                    if (ld && String(ld.id) === target) {
                        return ld;
                    }
                }
            }
        }

        return null;
    }

    // ============================================================
    // CLASS VALIDATION - Preflight (live reads, UX only)
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
            var week = parseWeekStrict(data.week);
            if (week === null) {
                return {
                    valid: false,
                    message: 'Valid week is required (' +
                        MIN_WEEK + '-' + MAX_WEEK + ').'
                };
            }
        }

        if (!isPartial || data.score !== undefined) {
            var score = parseFiniteNumberStrict(data.score);
            if (score === null || score < MIN_SCORE) {
                return { valid: false, message: 'Score must be a finite number greater than or equal to 0.' };
            }
        }

        if (data.maxScore !== undefined) {
            var maxScore = parseFiniteNumberStrict(data.maxScore);
            if (maxScore === null || maxScore <= 0) {
                return { valid: false, message: 'Max score must be a finite number greater than 0.' };
            }
        }

        if (data.score !== undefined && data.maxScore !== undefined) {
            var s = parseFiniteNumberStrict(data.score);
            var m = parseFiniteNumberStrict(data.maxScore);
            if (s !== null && m !== null && s > m) {
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

        return { valid: true };
    }

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

        var week = parseWeekStrict(candidate.week);
        if (week === null) {
            return { valid: false, message: 'Candidate week is out of range.' };
        }

        var score = parseFiniteNumberStrict(candidate.score);
        if (score === null || score < MIN_SCORE) {
            return { valid: false, message: 'Candidate score is invalid.' };
        }

        var maxScore = parseFiniteNumberStrict(candidate.maxScore);
        if (maxScore === null || maxScore <= 0) {
            return { valid: false, message: 'Candidate maxScore is invalid.' };
        }

        if (score > maxScore) {
            return {
                valid: false,
                message: 'Candidate score (' + score + ') exceeds maxScore (' + maxScore + ').'
            };
        }

        if (candidate.type !== undefined &&
            VALID_GRADE_TYPES.indexOf(candidate.type) === -1) {
            return { valid: false, message: 'Candidate type is invalid.' };
        }

        return { valid: true };
    }

    function validateCandidateAgainstSnapshot(candidate, appData) {
        var structural = validateCandidate(candidate);
        if (!structural.valid) {
            return structural;
        }

        if (!findClassInSnapshot(appData, candidate.classId)) {
            return {
                valid: false,
                message: 'Class no longer exists: ' + candidate.classId
            };
        }

        if (!findCharacterInSnapshot(appData, candidate.studentId)) {
            return {
                valid: false,
                message: 'Student no longer exists: ' + candidate.studentId
            };
        }

        if (!findDisciplineInSnapshot(appData, candidate.disciplineId)) {
            return {
                valid: false,
                message: 'Discipline no longer exists: ' + candidate.disciplineId
            };
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    function buildGradeRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();

        var score = parseFiniteNumberStrict(data.score);
        if (score === null) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received a malformed score.'
            );
        }

        var maxScore = data.maxScore !== undefined
            ? parseFiniteNumberStrict(data.maxScore)
            : 100;
        if (maxScore === null || maxScore <= 0) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received a malformed maxScore.'
            );
        }

        var week = parseWeekStrict(data.week);
        if (week === null) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received an invalid week.'
            );
        }

        return {
            id: existingId || generateId(),
            studentId: String(data.studentId),
            classId: String(data.classId),
            disciplineId: String(data.disciplineId),
            week: week,
            score: score,
            maxScore: maxScore,
            type: data.type || 'assignment',
            date: data.date || now.split('T')[0],
            notes: data.notes || '',
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // PUBLIC API - GRADE CRUD
    // ============================================================

    function create(data) {
        var validation = validateGradeData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        var newGrade;
        try {
            newGrade = buildGradeRecord(data, null, null);
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

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
                if (findGradeInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Grade ID collision.' };
                }
                return validateCandidateAgainstSnapshot(newGrade, appData);
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

        var fieldValidation = validateGradeData(updates, true);
        if (!fieldValidation.valid) {
            return Promise.resolve(failure(fieldValidation.message));
        }

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
                    var week = parseWeekStrict(value);
                    if (week === null) {
                        return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
                    }
                    if (candidate.week !== week) {
                        candidate.week = week;
                        hasChanges = true;
                    }
                    break;

                case 'score':
                    var score = parseFiniteNumberStrict(value);
                    if (score === null || score < MIN_SCORE) {
                        return Promise.resolve(failure('Score must be a finite number greater than or equal to 0.'));
                    }
                    if (candidate.score !== score) {
                        candidate.score = score;
                        hasChanges = true;
                    }
                    break;

                case 'maxScore':
                    var newMax = parseFiniteNumberStrict(value);
                    if (newMax === null || newMax <= 0) {
                        return Promise.resolve(failure('Max score must be a finite number greater than 0.'));
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
                if (!findGradeInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                return validateCandidateAgainstSnapshot(candidate, appData);
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
                if (!findGradeInSnapshot(appData, target)) {
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
    // WEEK FILTER:
    //   A provided-but-invalid week is a filter that matches
    //   nothing, not "no filter".

    function sortGrades(a, b) {
        if (a.week !== b.week) {
            return a.week - b.week;
        }
        return (a.date || '').localeCompare(b.date || '');
    }

    function filterGradesByStudentAndClass(all, studentId, classId) {
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
            result.push(grade);
        }

        return result;
    }

    function getStudentGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetStudent = String(studentId);
        var result = [];

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.studentId) !== targetStudent) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getStudentClassGrades(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var all = getGradeRecords();

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        var result = filterGradesByStudentAndClass(
            all, studentId, classId
        );

        if (weekFilter !== null) {
            var filtered = [];
            for (var i = 0; i < result.length; i++) {
                if (result[i].week === weekFilter) {
                    filtered.push(result[i]);
                }
            }
            result = filtered;
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

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.classId) !== targetClass) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
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

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.disciplineId) !== targetDiscipline) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getWeekGrades(week, classId) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var all = getGradeRecords();
        var targetClass = isNonEmptyString(classId) ? String(classId) : null;
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (grade.week !== weekNum) {
                continue;
            }
            if (targetClass !== null &&
                String(grade.classId) !== targetClass) {
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

    function calculateSummary(grades, scheme) {
        if (!Array.isArray(grades)) {
            throw new Error(
                '[AcademyGrades] calculateSummary requires an array of grades.'
            );
        }

        var count = grades.length;

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
            if (!isObject(grade)) {
                throw new Error(
                    '[AcademyGrades] calculateSummary received a ' +
                    'malformed grade at index ' + i + '. A summary ' +
                    'must include every entry it was given.'
                );
            }

            var pct = calculatePercentage(grade.score, grade.maxScore);

            total += pct;
            if (pct > max) max = pct;
            if (pct < min) min = pct;

            var isPass = GradeSchemes.isPassing(pct, scheme || null) === true;

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

    function calculateClassSummary(classId, week, scheme) {
        var grades = getClassGrades(classId, week);
        return calculateSummary(grades, scheme);
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

        if (grades === undefined || grades === null) {
            return result;
        }

        if (typeof grades !== 'object' || Array.isArray(grades)) {
            throw new Error(
                '[AcademyGrades] stripCharacterRefs found a malformed ' +
                'academy.grades store on the snapshot. Expected a ' +
                'plain object; got ' +
                (Array.isArray(grades) ? 'array' : typeof grades) + '.'
            );
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

    function saveGrades(gradesData, options) {
        if (!Array.isArray(gradesData) || gradesData.length === 0) {
            return Promise.resolve(failure('Grade data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var existingGrades = getGradeRecords();
        var planned = [];
        var errors = [];
        var seenTuples = Object.create(null);

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

            var effectiveType = data.type || 'assignment';
            var tupleKey = String(data.studentId) + '::' +
                           String(data.classId) + '::' +
                           String(data.disciplineId) + '::' +
                           String(parseWeekStrict(data.week)) + '::' +
                           String(effectiveType);
            if (seenTuples[tupleKey]) {
                errors.push({
                    index: i,
                    error: 'Duplicate entry for the same (student, class, discipline, week, type).'
                });
                continue;
            }
            seenTuples[tupleKey] = true;

            var existing = null;
            for (var j = 0; j < existingGrades.length; j++) {
                var g = existingGrades[j];
                if (String(g.studentId) === String(data.studentId) &&
                    String(g.classId) === String(data.classId) &&
                    String(g.disciplineId) === String(data.disciplineId) &&
                    parseWeekStrict(g.week) === parseWeekStrict(data.week) &&
                    String(g.type || 'assignment') === String(effectiveType)) {
                    existing = g;
                    break;
                }
            }

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate;
                try {
                    candidate = buildGradeRecord(data, existing.id, existing.createdAt);
                } catch (e) {
                    errors.push({ index: i, error: e.message });
                    continue;
                }
                var candidateCheck = validateCandidate(candidate);
                if (!candidateCheck.valid) {
                    errors.push({ index: i, error: candidateCheck.message });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord;
                try {
                    newRecord = buildGradeRecord(data, null, null);
                } catch (e) {
                    errors.push({ index: i, error: e.message });
                    continue;
                }
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

                for (var i = 0; i < planned.length; i++) {
                    var item = planned[i];

                    if (item.action === 'create') {
                        if (findGradeInSnapshot(appData, item.record.id)) {
                            return {
                                valid: false,
                                message: 'Grade ID collision during ' +
                                    'save: ' + item.record.id
                            };
                        }
                        var createCheck = validateCandidateAgainstSnapshot(
                            item.record, appData
                        );
                        if (!createCheck.valid) {
                            return createCheck;
                        }
                    } else if (item.action === 'update') {
                        if (!findGradeInSnapshot(appData, item.matchId)) {
                            return {
                                valid: false,
                                message: 'Grade no longer exists: ' +
                                    item.matchId
                            };
                        }
                        var updateCheck = validateCandidateAgainstSnapshot(
                            item.record, appData
                        );
                        if (!updateCheck.valid) {
                            return updateCheck;
                        }
                    }
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
