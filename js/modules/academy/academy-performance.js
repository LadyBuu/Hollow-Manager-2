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
 * WEEK SCOPING:
 *   Academic performance is WEEK-SCOPED. A student's academic average
 *   for week W uses:
 *     - the disciplines the student is enrolled in AT WEEK W
 *     - the grades recorded for week W
 *
 *   A discipline the student was enrolled in during weeks 1-10 but
 *   dropped at week 11 does NOT contribute to their week-20 academic
 *   average. This is the correct reading for a week-scoped query:
 *   "what is this student's performance this week?" is not the same
 *   question as "what has this student's performance been across the
 *   year?".
 *
 *   The enrolment check is interval-aware. A student is considered
 *   enrolled in a discipline at week W when the enrolment interval
 *   for that (class, student, discipline) contains W. The ID-only
 *   query used previously (getStudentDisciplineIds) reports the
 *   disciplines the student has EVER been enrolled in for the class,
 *   which is the wrong answer for a week-scoped calculation.
 *
 * GRADE CLASS SCOPING:
 *   Grades carry a classId. When calculating a discipline average
 *   for a (student, classId, disciplineId, week), the module filters
 *   grades to those whose classId matches. This closes the
 *   ambiguity that the review flagged: a student who has the same
 *   discipline in two classes cannot accidentally contribute the
 *   other class's grades to this class's average.
 *
 * PASSING SEMANTICS:
 *   Passing is SCHEME-DERIVED. The module does NOT trust a stored
 *   `grade.passing` field. Every pass/fail decision flows through
 *   AcademyGradeSchemes.isPassing(percentage, scheme).
 *
 *   This closes the review's §6 issue: a scheme change from
 *   Pass >= 50 to Pass >= 70 now retroactively reclassifies grades.
 *   That is the correct behaviour — the scheme is a display/
 *   interpretation layer, not a persisted decision.
 *
 * DESIGN:
 *   - Performance is a SEPARATE layer from grades and ranking.
 *     Grades store scores. Performance computes aggregates.
 *     Ranking (AcademyRanking) consumes aggregates and produces
 *     ordered lists.
 *   - The layer is PURE: given the same inputs, it returns the same
 *     outputs. No hidden state, no caching, no time-of-day
 *     dependence. Time-of-day dependence is handled by the caller
 *     (which passes in the week).
 *
 * WEIGHT MODEL:
 *   - A grade carries a `type` (exam, assignment, etc.) and a
 *     `score` / `maxScore` pair. It does NOT carry a weight.
 *   - The weight for a grade is a property of the discipline,
 *     keyed by the assessment type:
 *       discipline.assessmentWeights = { exam: 2.0, assignment: 1.0, ... }
 *   - A missing entry for a grade's type falls back to
 *     DEFAULT_ASSESSMENT_WEIGHT (1.0). A malformed entry (negative,
 *     non-numeric) is REJECTED, not silently defaulted. The
 *     distinction matters: a missing weight means "count this
 *     once", a malformed weight is a configuration error.
 *
 * DISCIPLINE ROLL-UP:
 *   - Each discipline carries a per-discipline `weight` that governs
 *     how much it contributes to the overall academic average.
 *   - A discipline the student is enrolled in but not yet graded in
 *     is EXCLUDED from the academic average, not zero-filled. A
 *     student in five disciplines graded in three has their academic
 *     average computed from the three that have grades.
 *
 * ROUNDING:
 *   - Discipline averages are rounded to one decimal for DISPLAY.
 *   - The academic roll-up uses the UNROUNDED discipline averages.
 *     Rounding is applied to the final academic average only.
 *   - This closes the review's §11: cumulative rounding error is
 *     eliminated by keeping the internal arithmetic unrounded.
 *
 * OVERALL SCORE:
 *   - The overall score is a weighted blend of academic average and
 *     social score:
 *       overall = academicWeight * academic + socialWeight * social
 *   - The weights come from AcademySettings.getRankingWeights(),
 *     which reads academy.settings.ranking. The defaults are 85/15
 *     (academic/social).
 *   - The weights are RATIOS, not normalised values. Two weights of
 *     17 and 3 produce the same blend as 0.85 and 0.15. Callers that
 *     supply weights summing to anything other than 1.0 are
 *     supported; the arithmetic normalises by the sum.
 *   - Missing components are handled explicitly:
 *       both present  → weighted blend
 *       only academic → academic is used as the overall
 *       only social   → social is used as the overall
 *       neither       → null
 *     Partial data does not silently zero-fill.
 *
 * QUERY FAILURE POLICY:
 *   Mandatory dependencies propagate their failures. A broken
 *   AcademyEnrolments call does NOT become "student has no
 *   disciplines". A broken AcademyGrades call does NOT become
 *   "student has no grades".
 *
 *   Optional dependencies (AcademySocialScore, AcademySettings)
 *   can be absent. A dependency that is present but whose call
 *   FAILS is a different case: the failure propagates. The presence
 *   of the module is consent to use it; its failure is a bug.
 *
 * DEPRECATED:
 *   calculateRanking() is DEPRECATED in this module. Ranking
 *   ordering and rank assignment belong to AcademyRanking. This
 *   function is retained because AcademyRanking.autoGenerate
 *   currently consumes it; migrate that caller to
 *   calculateClassPerformance + ranking-layer sorting, then delete
 *   this function.
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
 * EXPECTED AcademySettings API:
 *   AcademySettings.getRankingWeights() -> { academic: number, social: number }
 *   The values are treated as arbitrary non-negative ratios, not
 *   normalised weights. When the module is absent, or returns
 *   malformed data, FALLBACK_RANKING_WEIGHTS is used. When the
 *   module is present but its call THROWS, the throw propagates.
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
     * or returns malformed data. Matches the plan's locked decision
     * (85/15 academic/social).
     *
     * These are FALLBACKS, not canonical weights. The canonical
     * weights come from AcademySettings.
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
     *
     * MISSING vs MALFORMED:
     *   - No discipline, no weight map, or no entry for the type →
     *     DEFAULT_ASSESSMENT_WEIGHT (1.0).
     *   - An entry that is present but not a non-negative finite
     *     number → throw. A malformed weight is a configuration
     *     error, not a default.
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
     *
     * MISSING vs MALFORMED: same distinction as
     * getAssessmentWeight.
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
     *
     * ABSENT vs FAILING:
     *   - AcademySettings module absent → fallback.
     *   - AcademySettings present but getRankingWeights returns
     *     malformed data → fallback.
     *   - AcademySettings present but getRankingWeights THROWS →
     *     propagate. The module is loaded, so the caller expects
     *     it to work; a throw is a bug, not a "not configured"
     *     signal.
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
     *
     * ALWAYS delegates to AcademyGrades.calculatePercentage. Does
     * NOT prefer a stored `percentage` field. Phase 3 rule:
     * percentage is derived, not stored.
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
    //
    // Returns the set of discipline IDs the student is enrolled in
    // at the given week, for the given class.
    //
    // The check goes through AcademyEnrolments.isEnrolledInWeek for
    // each discipline the student has any enrolment for. This is
    // interval-aware: a student who was enrolled in weeks 1-10 and
    // dropped at week 11 is NOT enrolled in week 20.
    //
    // MANDATORY DEPENDENCY FAILURES PROPAGATE. A broken
    // AcademyEnrolments call is a bug, not "student has no
    // disciplines". The failure is not converted to an empty array.
    //
    // Returns an array of distinct discipline IDs.

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
    //
    // calculateDisciplineAverage is deliberately LOWER-LEVEL than
    // calculateAcademicAverage.
    //
    //   calculateDisciplineAverage(studentId, classId, disciplineId, week)
    //     Computes the weighted average for one discipline's grades
    //     for one student in one class at one week. Does NOT verify
    //     that the student is enrolled in the discipline.
    //
    //   calculateAcademicAverage(studentId, classId, week)
    //     Computes the academic roll-up over the disciplines the
    //     student is enrolled in AT the given week. Uses
    //     calculateDisciplineAverage per discipline.

    function calculateDisciplineAverage(studentId, classId, disciplineId, week) {
        if (!isNonEmptyString(studentId)) { return null; }
        if (!isNonEmptyString(classId)) { return null; }
        if (!isNonEmptyString(disciplineId)) { return null; }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return null; }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) { return null; }

        // Class-scoped grade read. Uses the classId-carrying grade
        // query, so a student with the same discipline in two
        // classes cannot accidentally contribute the other class's
        // grades to this class's average.
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

        // Week-scoped enrolment. A discipline the student dropped
        // before this week does NOT contribute.
        var disciplineIds = getEnrolledDisciplineIdsForWeek(
            studentId, classId, weekNum
        );

        if (disciplineIds.length === 0) {
            return null;
        }

        var contributions = [];
        var weightedSum = 0;
        var totalWeight = 0;

        // The roll-up uses UNROUNDED discipline averages. Rounding
        // is applied to the final academic average only.
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

            // The unrounded average is used for the roll-up. The
            // rounded value is carried in the contribution for
            // display.
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

        var blended = (academic * weights.academic + social * weights.social) / total;
        return round1(blended);
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
     *
     * ABSENT vs FAILING:
     *   - AcademySocialScore module absent → null (the social
     *     component is unavailable).
     *   - Module present but getSocialScore returns a non-number
     *     → null (no usable score for this student/week).
     *   - Module present but getSocialScore THROWS → propagate.
     *     The module is loaded; a throw is a bug, not "no score".
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

        // Compose the overall from the already-computed values
        // instead of recomputing them via calculateOverallScore.
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
    // Returns records for every studentId in the input. The order
    // of the output matches the order of the input. Callers that
    // want an ordering sort the returned array themselves.

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

            if (academic) {
                result.push({
                    studentId: academic.studentId,
                    average: academic.average,
                    disciplineCount: academic.disciplineCount,
                    totalWeight: academic.totalWeight
                });
            } else {
                result.push({
                    studentId: String(studentId),
                    average: null,
                    disciplineCount: 0,
                    totalWeight: 0
                });
            }
        }

        return result;
    }

    // ============================================================
    // PUBLIC API - Ranking-Ready Output (DEPRECATED)
    // ============================================================
    //
    // DEPRECATED. calculateRanking returns an ordered list with
    // rank numbers. Ranking is a separate concern owned by
    // AcademyRanking.
    //
    // This function is retained because AcademyRanking.autoGenerate
    // currently calls it. The migration path is:
    //   1. Change autoGenerate to call calculateClassPerformance.
    //   2. Move the sorting and rank assignment into
    //      AcademyRanking's own code.
    //   3. Delete this function.
    //
    // The function does NOT take a getCharacterById callback for
    // name resolution. Names belong to the aggregator layer, not to
    // performance.

    function calculateRanking(studentIds, classId, week) {
        if (!Array.isArray(studentIds) || !isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return []; }

        var entries = [];

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

            entries.push({
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

        entries.sort(function(a, b) {
            var aVal = a.overallScore !== null
                ? a.overallScore
                : a.academicAverage;
            var bVal = b.overallScore !== null
                ? b.overallScore
                : b.academicAverage;

            if (aVal === null && bVal === null) {
                return a.studentId.localeCompare(b.studentId);
            }
            if (aVal === null) { return 1; }
            if (bVal === null) { return -1; }
            if (bVal !== aVal) { return bVal - aVal; }
            return a.studentId.localeCompare(b.studentId);
        });

        var rankCounter = 0;
        for (var j = 0; j < entries.length; j++) {
            var e = entries[j];
            var hasScore = e.overallScore !== null ||
                e.academicAverage !== null;
            if (hasScore) {
                rankCounter++;
                e.rank = rankCounter;
            } else {
                e.rank = null;
            }
        }

        return entries;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyPerformance = {
        // Discipline-level
        calculateDisciplineAverage: calculateDisciplineAverage,

        // Academic roll-up
        calculateAcademicAverage: calculateAcademicAverage,
        calculateStudentPerformance: calculateStudentPerformance,

        // Overall score
        calculateOverallScore: calculateOverallScore,

        // Class-wide
        calculateClassPerformance: calculateClassPerformance,

        // DEPRECATED — ranking belongs to AcademyRanking.
        // Retained because AcademyRanking.autoGenerate calls it.
        // Migrate the caller, then delete.
        calculateRanking: calculateRanking,

        // Helpers exposed for callers that need the same rules
        getAssessmentWeight: getAssessmentWeight,
        getDisciplineWeight: getDisciplineWeight,
        getRankingWeights: getRankingWeights,

        // Constants
        DEFAULT_ASSESSMENT_WEIGHT: DEFAULT_ASSESSMENT_WEIGHT,
        DEFAULT_DISCIPLINE_WEIGHT: DEFAULT_DISCIPLINE_WEIGHT,
        DEFAULT_PASSING_THRESHOLD: DEFAULT_PASSING_THRESHOLD,
        FALLBACK_RANKING_WEIGHTS: FALLBACK_RANKING_WEIGHTS
    };

})();
