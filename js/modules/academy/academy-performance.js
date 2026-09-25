/**
 * js/modules/academy/academy-performance.js - Academy Performance
 * PURE calculation layer for academic performance.
 * Path: js/modules/academy/academy-performance.js
 *
 * This module is responsible for:
 *   - Computing a student's weighted average for a single discipline
 *   - Rolling up per-discipline averages into an academic average
 *   - Blending academic and social scores into an overall score
 *   - Returning the components (per-discipline and per-grade) that
 *     produced each aggregate, for display and debugging
 *
 * IMPORTANT:
 *   - PURE. No mutations. No persistence. No UI. No side effects.
 *   - Does NOT own grade data. Grades come from AcademyGrades.
 *   - Does NOT own discipline configuration. Weight configuration
 *     (assessmentWeights, weight) comes from AcademyDisciplines.
 *   - Does NOT own social scores. Those come from AcademySocialScore.
 *   - Does NOT own ranking settings. Those come from AcademySettings.
 *   - Does NOT own class membership. That comes from AcademyEnrolments.
 *   - Does NOT write to window.data. Ever.
 *   - Returns plain data structures. No class instances, no DOM nodes.
 *
 * RANKING IS NOT OWNED HERE:
 *   Ordering and rank assignment are owned by AcademyRanking. This
 *   module produces the per-student aggregates that ranking consumes;
 *   it does not order them and it does not assign rank numbers.
 *
 *   The `calculateRanking` function that used to live here has been
 *   removed. It returned an ordered, rank-assigned list, which is a
 *   ranking-layer concern, not a performance-layer concern. The
 *   migration was:
 *     1. AcademyRanking.autoGenerate now calls
 *        calculateClassPerformance.
 *     2. Sorting and rank assignment moved into AcademyRanking.
 *     3. calculateRanking was deleted from this module.
 *
 *   Do not reintroduce it. If a caller needs an ordered list, that
 *   caller is ranking.
 *
 * WEEK SCOPING:
 *   Academic performance is WEEK-SCOPED. A student's academic average
 *   for week W uses:
 *     - the disciplines the student is enrolled in AT WEEK W
 *     - the grades recorded for week W
 *
 *   The enrolment check is interval-aware. A student is considered
 *   enrolled in a discipline at week W when the enrolment interval
 *   for that (class, student, discipline) contains W.
 *
 * GRADE CLASS SCOPING:
 *   Grades carry a classId. When calculating a discipline average
 *   for a (student, classId, disciplineId, week), the module filters
 *   grades to those whose classId matches.
 *
 * PASSING SEMANTICS:
 *   Passing is SCHEME-DERIVED. The module does NOT trust a stored
 *   `grade.passing` field. Every pass/fail decision flows through
 *   AcademyGradeSchemes.isPassing(percentage, scheme).
 *
 * DESIGN:
 *   - Performance is a SEPARATE layer from grades and ranking.
 *   - The layer is PURE: given the same inputs, it returns the same
 *     outputs. No hidden state, no caching, no time-of-day
 *     dependence.
 *
 * WEIGHT MODEL:
 *   - A grade carries a `type` (exam, assignment, etc.) and a
 *     `score` / `maxScore` pair. It does NOT carry a weight.
 *   - The weight for a grade is a property of the discipline,
 *     keyed by the assessment type.
 *   - A missing entry for a grade's type falls back to
 *     DEFAULT_ASSESSMENT_WEIGHT (1.0). A malformed entry is
 *     REJECTED, not silently defaulted.
 *
 * DISCIPLINE ROLL-UP:
 *   - Each discipline carries a per-discipline `weight` that governs
 *     how much it contributes to the overall academic average.
 *   - A discipline the student is enrolled in but not yet graded in
 *     is EXCLUDED from the academic average, not zero-filled.
 *
 * ROUNDING:
 *   - Discipline averages are rounded to one decimal for DISPLAY.
 *   - The academic roll-up uses the UNROUNDED discipline averages.
 *
 * OVERALL SCORE:
 *   - The overall score is a weighted blend of academic average and
 *     social score.
 *   - The weights come from AcademySettings.getRankingWeights().
 *
 * QUERY FAILURE POLICY:
 *   Mandatory dependencies propagate their failures. A broken
 *   AcademyEnrolments call does NOT become "student has no
 *   disciplines". A broken AcademyGrades call does NOT become
 *   "student has no grades".
 *
 * DEPENDENCIES:
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *   - window.AcademyDisciplines (from academy-disciplines.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.AcademyEnrolments (from academy-enrolments.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.AcademySocialScore (from academy-social-score.js) - OPTIONAL
 *   - window.AcademySettings (from academy-settings.js) - OPTIONAL
 *
 * USAGE:
 *   var P = window.AcademyPerformance;
 *
 *   var disciplineAvg = P.calculateDisciplineAverage(
 *       'char_456', 'class_789', 'disc_abc', 5
 *   );
 *
 *   var academicAvg = P.calculateAcademicAverage('char_456', 'class_789', 5);
 *
 *   var overall = P.calculateOverallScore('char_456', 'class_789', 5);
 *
 *   var full = P.calculateStudentPerformance('char_456', 'class_789', 5);
 */

(function() {
    'use strict';

    if (window.__academyPerformanceLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.AcademyGrades || typeof window.AcademyGrades.getStudentClassGrades !== 'function') {
        missing.push('AcademyGrades.getStudentClassGrades');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculatePercentage !== 'function') {
        missing.push('AcademyGrades.calculatePercentage');
    }

    if (!window.AcademyDisciplines || typeof window.AcademyDisciplines.getDiscipline !== 'function') {
        missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!window.AcademyDisciplines || typeof window.AcademyDisciplines.getGradeScheme !== 'function') {
        missing.push('AcademyDisciplines.getGradeScheme');
    }

    if (!window.AcademyGradeSchemes || typeof window.AcademyGradeSchemes.isPassing !== 'function') {
        missing.push('AcademyGradeSchemes.isPassing');
    }

    if (!window.AcademyEnrolments ||
        typeof window.AcademyEnrolments.isEnrolledInWeek !== 'function') {
        missing.push('AcademyEnrolments.isEnrolledInWeek');
    }
    if (!window.AcademyEnrolments ||
        typeof window.AcademyEnrolments.getStudentDisciplines !== 'function') {
        missing.push('AcademyEnrolments.getStudentDisciplines');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.CalendarConstants ||
        typeof window.CalendarConstants.MIN_WEEK !== 'number' ||
        typeof window.CalendarConstants.MAX_WEEK !== 'number') {
        missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyPerformance] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyPerformanceLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyGrades = window.AcademyGrades;
    var AcademyDisciplines = window.AcademyDisciplines;
    var GradeSchemes = window.AcademyGradeSchemes;
    var AcademyEnrolments = window.AcademyEnrolments;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // LAZY OPTIONAL DEPENDENCIES
    // ============================================================

    function getAcademySocialScore() {
        return window.AcademySocialScore || null;
    }

    function getAcademySettings() {
        return window.AcademySettings || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    /**
     * Default weight for an assessment type that has no explicit
     * entry in the discipline's assessmentWeights map.
     */
    var DEFAULT_ASSESSMENT_WEIGHT = 1.0;

    /**
     * Default weight for a discipline that has no explicit `weight`
     * field.
     */
    var DEFAULT_DISCIPLINE_WEIGHT = 1.0;

    /**
     * Default passing threshold when no scheme is supplied. Mirrors
     * the default in AcademyGradeSchemes.
     */
    var DEFAULT_PASSING_THRESHOLD = GradeSchemes.PASSING_THRESHOLD !== undefined &&
        GradeSchemes.PASSING_THRESHOLD !== null
            ? GradeSchemes.PASSING_THRESHOLD
            : 70;

    /**
     * Fallback ranking weights. Used when AcademySettings is absent
     * or returns malformed data.
     */
    var FALLBACK_RANKING_WEIGHTS = Object.freeze({
        academic: 0.85,
        social: 0.15
    });

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) { return null; }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) { return null; }
        return parsed;
    }

    /**
     * Resolve the assessment weight for a grade's type within a
     * discipline.
     */
    function getAssessmentWeight(discipline, type) {
        if (!discipline || !isObject(discipline.assessmentWeights)) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        if (!isNonEmptyString(type)) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        if (!Object.prototype.hasOwnProperty.call(
            discipline.assessmentWeights, type
        )) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        var weight = discipline.assessmentWeights[type];

        if (!isFiniteNumber(weight) || weight < 0) {
            throw new Error(
                '[AcademyPerformance] Discipline "' +
                (discipline.id || '?') + '" has a malformed ' +
                'assessment weight for type "' + type + '": ' +
                String(weight) + '. Fix the discipline configuration.'
            );
        }

        return weight;
    }

    /**
     * Resolve the roll-up weight for a discipline.
     */
    function getDisciplineWeight(discipline) {
        if (!discipline) {
            return DEFAULT_DISCIPLINE_WEIGHT;
        }

        if (discipline.weight === undefined || discipline.weight === null) {
            return DEFAULT_DISCIPLINE_WEIGHT;
        }

        var weight = discipline.weight;

        if (!isFiniteNumber(weight) || weight < 0) {
            throw new Error(
                '[AcademyPerformance] Discipline "' +
                (discipline.id || '?') + '" has a malformed roll-up ' +
                'weight: ' + String(weight) + '. Fix the discipline ' +
                'configuration.'
            );
        }

        return weight;
    }

    /**
     * Read the ranking weights from AcademySettings, or fall back.
     */
    function getRankingWeights() {
        var Settings = getAcademySettings();
        if (!Settings || typeof Settings.getRankingWeights !== 'function') {
            return {
                academic: FALLBACK_RANKING_WEIGHTS.academic,
                social: FALLBACK_RANKING_WEIGHTS.social
            };
        }

        var result = Settings.getRankingWeights();

        if (isObject(result) &&
            isFiniteNumber(result.academic) &&
            isFiniteNumber(result.social) &&
            result.academic >= 0 &&
            result.social >= 0 &&
            (result.academic + result.social) > 0) {
            return {
                academic: result.academic,
                social: result.social
            };
        }

        return {
            academic: FALLBACK_RANKING_WEIGHTS.academic,
            social: FALLBACK_RANKING_WEIGHTS.social
        };
    }

    /**
     * Get the percentage for a grade.
     */
    function getGradePercentage(grade) {
        if (!grade || typeof grade !== 'object') {
            throw new Error(
                '[AcademyPerformance] getGradePercentage received a ' +
                'non-object grade.'
            );
        }
        return AcademyGrades.calculatePercentage(grade.score, grade.maxScore);
    }

    function filterGradesByDiscipline(grades, disciplineId) {
        if (!Array.isArray(grades) || !isNonEmptyString(disciplineId)) {
            return [];
        }

        var target = String(disciplineId);
        var result = [];

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            if (grade && String(grade.disciplineId) === target) {
                result.push(grade);
            }
        }

        return result;
    }

    function round1(value) {
        if (!isFiniteNumber(value)) {
            return 0;
        }
        return Math.round(value * 10) / 10;
    }

    /**
     * Count passes and fails for a set of grades.
     *
     * PASSING IS SCHEME-DERIVED. The stored `grade.passing` field is
     * ignored.
     */
    function countPassFail(grades, scheme) {
        var passing = 0;
        var failing = 0;

        for (var i = 0; i < grades.length; i++) {
            var pct = getGradePercentage(grades[i]);
            var isPass = GradeSchemes.isPassing(pct, scheme || null) === true;

            if (isPass) {
                passing++;
            } else {
                failing++;
            }
        }

        return { passing: passing, failing: failing };
    }

    /**
     * Compute the weighted average for a set of grades within a
     * discipline. Returns the UNROUNDED average.
     */
    function computeWeightedAverage(grades, discipline) {
        var weightedSum = 0;
        var totalWeight = 0;

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            if (!grade || typeof grade !== 'object') {
                continue;
            }

            var pct = getGradePercentage(grade);
            var weight = getAssessmentWeight(discipline, grade.type);

            weightedSum += pct * weight;
            totalWeight += weight;
        }

        return {
            average: totalWeight > 0 ? weightedSum / totalWeight : null,
            totalWeight: totalWeight,
            weightedSum: weightedSum
        };
    }

    // ============================================================
    // ENROLLMENT — WEEK-SCOPED, INTERVAL-AWARE
    // ============================================================

    function getEnrolledDisciplineIdsForWeek(studentId, classId, weekNum) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var intervals = AcademyEnrolments.getStudentDisciplines(
            studentId, classId
        );

        if (!Array.isArray(intervals)) {
            throw new Error(
                '[AcademyPerformance] AcademyEnrolments.' +
                'getStudentDisciplines returned a non-array for ' +
                'student ' + studentId + ' / class ' + classId + '.'
            );
        }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < intervals.length; i++) {
            var entry = intervals[i];
            if (!entry || !isNonEmptyString(entry.disciplineId)) {
                continue;
            }

            var disciplineId = String(entry.disciplineId);
            if (seen[disciplineId]) { continue; }

            var enrolled = AcademyEnrolments.isEnrolledInWeek(
                studentId, classId, disciplineId, weekNum
            ) === true;

            if (!enrolled) { continue; }

            seen[disciplineId] = true;
            result.push(disciplineId);
        }

        result.sort();
        return result;
    }

    // ============================================================
    // PUBLIC API - Discipline Average
    // ============================================================

    function calculateDisciplineAverage(studentId, classId, disciplineId, week) {
        if (!isNonEmptyString(studentId)) { return null; }
        if (!isNonEmptyString(classId)) { return null; }
        if (!isNonEmptyString(disciplineId)) { return null; }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return null; }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) { return null; }

        var classGrades = AcademyGrades.getStudentClassGrades(
            studentId, classId, weekNum
        );

        if (!Array.isArray(classGrades)) {
            throw new Error(
                '[AcademyPerformance] AcademyGrades.getStudentClassGrades ' +
                'returned a non-array.'
            );
        }

        var grades = filterGradesByDiscipline(classGrades, disciplineId);

        if (grades.length === 0) {
            return null;
        }

        var weighted = computeWeightedAverage(grades, discipline);
        if (weighted.average === null) {
            return null;
        }

        var scheme = AcademyDisciplines.getGradeScheme(disciplineId);
        var passFail = countPassFail(grades, scheme);

        return {
            studentId: String(studentId),
            classId: String(classId),
            disciplineId: String(disciplineId),
            disciplineName: discipline.name || 'Unknown',
            week: weekNum,

            average: round1(weighted.average),
            gradeCount: grades.length,
            totalWeight: round1(weighted.totalWeight),

            passing: passFail.passing,
            failing: passFail.failing,
            passRate: grades.length > 0
                ? Math.round((passFail.passing / grades.length) * 100)
                : 0,

            hasScheme: !!scheme,
            assessmentWeights: isObject(discipline.assessmentWeights)
                ? discipline.assessmentWeights
                : null
        };
    }

    // ============================================================
    // PUBLIC API - Academic Average
    // ============================================================

    function calculateAcademicAverage(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return null; }

        var disciplineIds = getEnrolledDisciplineIdsForWeek(
            studentId, classId, weekNum
        );

        if (disciplineIds.length === 0) {
            return null;
        }

        var contributions = [];
        var weightedSum = 0;
        var totalWeight = 0;

        for (var i = 0; i < disciplineIds.length; i++) {
            var disciplineId = disciplineIds[i];
            var disciplineAvg = calculateDisciplineAverage(
                studentId, classId, disciplineId, weekNum
            );

            if (!disciplineAvg || !isFiniteNumber(disciplineAvg.average)) {
                continue;
            }

            var discipline = AcademyDisciplines.getDiscipline(disciplineId);
            var rollupWeight = getDisciplineWeight(discipline);

            var pctForRollup = computeRawDisciplineAverage(
                studentId, classId, disciplineId, weekNum, discipline
            );

            if (pctForRollup === null) { continue; }

            contributions.push({
                disciplineId: disciplineId,
                disciplineName: disciplineAvg.disciplineName,
                average: disciplineAvg.average,
                weight: round1(rollupWeight),
                weightedValue: round1(pctForRollup * rollupWeight),
                gradeCount: disciplineAvg.gradeCount,
                passing: disciplineAvg.passing,
                failing: disciplineAvg.failing
            });

            weightedSum += pctForRollup * rollupWeight;
            totalWeight += rollupWeight;
        }

        if (totalWeight === 0) {
            return null;
        }

        return {
            studentId: String(studentId),
            classId: String(classId),
            week: weekNum,

            average: round1(weightedSum / totalWeight),
            disciplineCount: contributions.length,
            totalWeight: round1(totalWeight),

            contributions: contributions
        };
    }

    /**
     * Compute the raw (unrounded) discipline average for the
     * roll-up path. Returns null when there are no grades.
     */
    function computeRawDisciplineAverage(
        studentId, classId, disciplineId, weekNum, discipline
    ) {
        if (!discipline) { return null; }

        var classGrades = AcademyGrades.getStudentClassGrades(
            studentId, classId, weekNum
        );
        if (!Array.isArray(classGrades)) {
            throw new Error(
                '[AcademyPerformance] AcademyGrades.getStudentClassGrades ' +
                'returned a non-array.'
            );
        }

        var grades = filterGradesByDiscipline(classGrades, disciplineId);
        if (grades.length === 0) { return null; }

        var weighted = computeWeightedAverage(grades, discipline);
        return weighted.average;
    }

    // ============================================================
    // PUBLIC API - Overall Score
    // ============================================================

    function calculateOverallScore(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return null; }

        var academic = getAcademicValue(studentId, classId, weekNum);
        var social = getSocialValue(studentId, classId, weekNum);

        return calculateOverallFromValues(academic, social);
    }

    function getAcademicValue(studentId, classId, weekNum) {
        var academic = calculateAcademicAverage(studentId, classId, weekNum);
        if (!academic || !isFiniteNumber(academic.average)) {
            return null;
        }
        return academic.average;
    }

    /**
     * Read the social score.
     */
    function getSocialValue(studentId, classId, weekNum) {
        var ASS = getAcademySocialScore();
        if (!ASS || typeof ASS.getSocialScore !== 'function') {
            return null;
        }

        var value = ASS.getSocialScore(studentId, classId, weekNum);

        if (isFiniteNumber(value)) {
            return value;
        }
        return null;
    }

    // ============================================================
    // PUBLIC API - Full Performance Breakdown
    // ============================================================

    function calculateStudentPerformance(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return null; }

        var academic = calculateAcademicAverage(studentId, classId, weekNum);
        var social = getSocialValue(studentId, classId, weekNum);

        var overall = calculateOverallFromValues(academic, social);

        var disciplines = [];
        if (academic) {
            for (var i = 0; i < academic.contributions.length; i++) {
                var c = academic.contributions[i];
                disciplines.push({
                    disciplineId: c.disciplineId,
                    disciplineName: c.disciplineName,
                    average: c.average,
                    weight: c.weight,
                    gradeCount: c.gradeCount,
                    passing: c.passing,
                    failing: c.failing
                });
            }
        }

        return {
            studentId: String(studentId),
            classId: String(classId),
            week: weekNum,

            academicAverage: academic ? academic.average : null,
            academicDisciplineCount: academic ? academic.disciplineCount : 0,

            socialScore: social,

            overallScore: overall,

            disciplines: disciplines
        };
    }

    /**
     * Blend an academic average and a social score into an overall
     * score. Handles the partial-data cases explicitly.
     */
    function calculateOverallFromValues(academic, social) {
        if (academic === null && social === null) {
            return null;
        }
        if (academic === null) {
            return round1(social);
        }
        if (social === null) {
            return round1(academic);
        }

        var weights = getRankingWeights();
        var total = weights.academic + weights.social;
        if (total <= 0) {
            weights = {
                academic: FALLBACK_RANKING_WEIGHTS.academic,
                social: FALLBACK_RANKING_WEIGHTS.social
            };
            total = weights.academic + weights.social;
        }

        return round1(
            (academic * weights.academic + social * weights.social) / total
        );
    }

    // ============================================================
    // PUBLIC API - Class-Wide Performance
    // ============================================================
    //
    // Returns records for every studentId in the input. The order of
    // the output matches the order of the input. Callers that want
    // an ordering sort the returned array themselves.
    //
    // This is the entry point that AcademyRanking.autoGenerate uses.
    // The performance layer produces per-student aggregates; the
    // ranking layer orders them and assigns rank numbers.

    function calculateClassPerformance(studentIds, classId, week) {
        if (!Array.isArray(studentIds) || !isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return []; }

        var result = [];

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            if (!isNonEmptyString(studentId)) {
                continue;
            }

            var academic = calculateAcademicAverage(
                studentId, classId, weekNum
            );
            var social = getSocialValue(studentId, classId, weekNum);
            var overall = calculateOverallFromValues(academic, social);

            result.push({
                studentId: String(studentId),
                academicAverage: academic ? academic.average : null,
                socialScore: social,
                overallScore: overall,
                disciplineCount: academic ? academic.disciplineCount : 0,
                gradeCount: academic
                    ? academic.contributions.reduce(function(sum, c) {
                        return sum + (c.gradeCount || 0);
                    }, 0)
                    : 0
            });
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyPerformance = {
        calculateDisciplineAverage: calculateDisciplineAverage,

        calculateAcademicAverage: calculateAcademicAverage,
        calculateStudentPerformance: calculateStudentPerformance,

        calculateOverallScore: calculateOverallScore,

        calculateClassPerformance: calculateClassPerformance,

        getAssessmentWeight: getAssessmentWeight,
        getDisciplineWeight: getDisciplineWeight,
        getRankingWeights: getRankingWeights,

        DEFAULT_ASSESSMENT_WEIGHT: DEFAULT_ASSESSMENT_WEIGHT,
        DEFAULT_DISCIPLINE_WEIGHT: DEFAULT_DISCIPLINE_WEIGHT,
        DEFAULT_PASSING_THRESHOLD: DEFAULT_PASSING_THRESHOLD,
        FALLBACK_RANKING_WEIGHTS: FALLBACK_RANKING_WEIGHTS
    };

})();
