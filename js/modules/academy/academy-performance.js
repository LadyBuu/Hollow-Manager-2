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
 *   - Does NOT write to window.data. Ever.
 *   - Returns plain data structures. No class instances, no DOM nodes.
 *
 * DESIGN:
 *   - Performance is a SEPARATE layer from grades and ranking.
 *     Grades store scores. Performance computes aggregates. Ranking
 *     consumes aggregates and produces ordered lists.
 *   - The layer is PURE: given the same inputs, it returns the same
 *     outputs. No hidden state, no caching, no time-of-day dependence.
 *     Time-of-day dependence is handled by the caller (which passes in
 *     the week).
 *
 * WEIGHT MODEL:
 *   - A grade carries a `type` (exam, assignment, etc.) and a
 *     `score` / `maxScore` pair. It does NOT carry a weight.
 *   - The weight for a grade is a property of the discipline, keyed
 *     by the assessment type:
 *       discipline.assessmentWeights = { exam: 2.0, assignment: 1.0, ... }
 *   - A missing entry for a grade's type falls back to
 *     DEFAULT_ASSESSMENT_WEIGHT (1.0). This is deliberate: a missing
 *     weight means "count this once", not "ignore this grade".
 *
 * DISCIPLINE ROLL-UP:
 *   - Each discipline carries a per-discipline `weight` that governs
 *     how much it contributes to the overall academic average.
 *   - A discipline the student is enrolled in but not yet graded in
 *     is EXCLUDED from the academic average, not zero-filled. A
 *     student in five disciplines graded in three has their academic
 *     average computed from the three that have grades.
 *
 * OVERALL SCORE:
 *   - The overall score is a weighted blend of academic average and
 *     social score:
 *       overall = academicWeight * academic + socialWeight * social
 *   - The weights come from AcademySettings.getRankingWeights(), which
 *     reads academy.settings.ranking. The defaults are 85/15
 *     (academic/social).
 *   - Missing components are handled explicitly:
 *       both present  → weighted blend
 *       only academic → academic is used as the overall
 *       only social   → social is used as the overall
 *       neither       → null
 *     Partial data does not silently zero-fill.
 *
 * FALLBACK RANKING WEIGHTS:
 *   The constant exported by this module is named
 *   FALLBACK_RANKING_WEIGHTS. It used to be called
 *   DEFAULT_RANKING_WEIGHTS, which was misleading: the canonical
 *   weights come from AcademySettings, and this constant is only
 *   consulted when AcademySettings is absent or returns malformed
 *   data. The old name is recorded in MIGRATION.md.
 *
 *   Callers that were importing DEFAULT_RANKING_WEIGHTS must switch to
 *   FALLBACK_RANKING_WEIGHTS. If they wanted the CURRENT weights,
 *   they should be calling AcademySettings.getRankingWeights() or
 *   this module's getRankingWeights(), both of which return the live
 *   values.
 *
 * NULL vs ZERO:
 *   - A discipline average is `null` when there is nothing to average.
 *     It is `0` when grades exist and the weighted percentage sums
 *     to zero.
 *   - The academic average is `null` when no discipline contributed.
 *   - The overall score is `null` when neither academic nor social is
 *     available.
 *   - Callers MUST distinguish null from zero. Rendering null as "0%"
 *     is a UI bug.
 *
 * SCHEME-AWARENESS:
 *   - Passing is scheme-aware. Each discipline carries a gradeScheme.
 *     When a discipline's scheme is supplied, passing is determined by
 *     the scheme's lowest passing band. Otherwise the default threshold
 *     applies.
 *   - Performance uses passing only for the passRate / passing fields
 *     in its output. The average itself is a percentage; it does not
 *     depend on the scheme.
 *
 * DEPENDENCIES:
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *   - window.AcademyDisciplines (from academy-disciplines.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.AcademySocialScore (from academy-social-score.js) - OPTIONAL
 *   - window.AcademySettings (from academy-settings.js) - OPTIONAL
 *
 * EXPECTED AcademySettings API:
 *   AcademySettings.getRankingWeights() -> { academic: number, social: number }
 *   The values are expected to sum to 1.0. When the module is absent or
 *   returns malformed data, FALLBACK_RANKING_WEIGHTS is used.
 *
 * USAGE:
 *   var P = window.AcademyPerformance;
 *
 *   var disciplineAvg = P.calculateDisciplineAverage(
 *       'char_456', 'disc_abc', 5
 *   );
 *   // → { average: 82.5, gradeCount: 4, passing: 3, failing: 1, ... }
 *   //   or null if no grades
 *
 *   var academicAvg = P.calculateAcademicAverage('char_456', 'class_789', 5);
 *   // → { average: 78.2, disciplineCount: 3, ... } or null
 *
 *   var overall = P.calculateOverallScore('char_456', 'class_789', 5);
 *   // → 79.6 (number) or null
 *
 *   var full = P.calculateStudentPerformance('char_456', 'class_789', 5);
 *   // → detailed breakdown with per-discipline contributions
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

    if (!window.AcademyGrades || typeof window.AcademyGrades.getStudentGrades !== 'function') {
        missing.push('AcademyGrades.getStudentGrades');
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
    var DEFAULT_PASSING_THRESHOLD = GradeSchemes.PASSING_THRESHOLD || 70;

    /**
     * Fallback ranking weights. Used when AcademySettings is absent
     * or returns malformed data. Matches the plan's locked decision
     * (85/15 academic/social).
     *
     * RENAMED: previously DEFAULT_RANKING_WEIGHTS. The new name
     * reflects that these are a fallback, not the canonical weights.
     * See MIGRATION.md.
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

    function getAssessmentWeight(discipline, type) {
        if (!discipline || !isObject(discipline.assessmentWeights)) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        if (!isNonEmptyString(type)) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        var weight = discipline.assessmentWeights[type];

        if (!isFiniteNumber(weight) || weight < 0) {
            return DEFAULT_ASSESSMENT_WEIGHT;
        }

        return weight;
    }

    function getDisciplineWeight(discipline) {
        if (!discipline) {
            return DEFAULT_DISCIPLINE_WEIGHT;
        }

        var weight = discipline.weight;

        if (!isFiniteNumber(weight) || weight < 0) {
            return DEFAULT_DISCIPLINE_WEIGHT;
        }

        return weight;
    }

    /**
     * Get the ranking weights.
     *
     * Reads from AcademySettings.getRankingWeights() when available.
     * Falls back to FALLBACK_RANKING_WEIGHTS when:
     *   - AcademySettings is absent
     *   - the returned object is malformed
     *   - the weights do not sum to a positive value
     *
     * The returned object is always a fresh copy. Callers can mutate
     * it without affecting the default.
     */
    function getRankingWeights() {
        var Settings = getAcademySettings();
        if (Settings && typeof Settings.getRankingWeights === 'function') {
            try {
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
            } catch (e) {
                console.warn('[AcademyPerformance] getRankingWeights failed:', e);
            }
        }

        return {
            academic: FALLBACK_RANKING_WEIGHTS.academic,
            social: FALLBACK_RANKING_WEIGHTS.social
        };
    }

    function getGradePercentage(grade) {
        if (!grade || typeof grade !== 'object') {
            return 0;
        }

        if (isFiniteNumber(grade.percentage)) {
            return grade.percentage;
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

    function countPassFail(grades, scheme) {
        var passing = 0;
        var failing = 0;

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            var pct = getGradePercentage(grade);

            var isPass;
            if (grade && grade.passing !== undefined) {
                isPass = grade.passing === true;
            } else {
                isPass = GradeSchemes.isPassing(pct, scheme || null) === true;
            }

            if (isPass) {
                passing++;
            } else {
                failing++;
            }
        }

        return { passing: passing, failing: failing };
    }

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
    // PUBLIC API - Discipline Average
    // ============================================================

    /**
     * Calculate a student's average within a single discipline.
     *
     * @param {string} studentId
     * @param {string} disciplineId
     * @param {number|string} [week]
     * @returns {object|null} Detailed average, or null
     */
    function calculateDisciplineAverage(studentId, disciplineId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(disciplineId)) {
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        var allGrades = AcademyGrades.getStudentGrades(studentId, week);
        var grades = filterGradesByDiscipline(allGrades, disciplineId);

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
            disciplineId: String(disciplineId),
            disciplineName: discipline.name || 'Unknown',
            week: week !== undefined ? (parseInt(week, 10) || null) : null,

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

    /**
     * Calculate a student's academic average across all disciplines
     * they are enrolled in for a class.
     *
     * @param {string} studentId
     * @param {string} classId
     * @param {number|string} [week]
     * @returns {object|null} Detailed academic average, or null
     */
    function calculateAcademicAverage(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        // Determine the set of disciplines to consider.
        var disciplineIds = getEnrolledDisciplineIds(studentId, classId);
        if (disciplineIds.length === 0) {
            return null;
        }

        var contributions = [];
        var weightedSum = 0;
        var totalWeight = 0;

        for (var i = 0; i < disciplineIds.length; i++) {
            var disciplineId = disciplineIds[i];
            var disciplineAvg = calculateDisciplineAverage(studentId, disciplineId, week);

            if (!disciplineAvg || !isFiniteNumber(disciplineAvg.average)) {
                continue;
            }

            var discipline = AcademyDisciplines.getDiscipline(disciplineId);
            var rollupWeight = getDisciplineWeight(discipline);

            contributions.push({
                disciplineId: disciplineId,
                disciplineName: disciplineAvg.disciplineName,
                average: disciplineAvg.average,
                weight: round1(rollupWeight),
                weightedValue: round1(disciplineAvg.average * rollupWeight),
                gradeCount: disciplineAvg.gradeCount,
                passing: disciplineAvg.passing,
                failing: disciplineAvg.failing
            });

            weightedSum += disciplineAvg.average * rollupWeight;
            totalWeight += rollupWeight;
        }

        if (totalWeight === 0) {
            return null;
        }

        return {
            studentId: String(studentId),
            classId: String(classId),
            week: week !== undefined ? (parseInt(week, 10) || null) : null,

            average: round1(weightedSum / totalWeight),
            disciplineCount: contributions.length,
            totalWeight: round1(totalWeight),

            contributions: contributions
        };
    }

    // ============================================================
    // PUBLIC API - Overall Score (Phase 5)
    // ============================================================
    //
    // The overall score blends the academic average and the social
    // score using the configured ranking weights.
    //
    // When only one component is available, the other is NOT treated
    // as zero. The available component becomes the overall score.

    /**
     * Calculate a student's overall score for a class + week.
     *
     * @param {string} studentId
     * @param {string} classId
     * @param {number|string} [week]
     * @returns {number|null} Overall score (0-100) or null
     */
    function calculateOverallScore(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        var academic = getAcademicValue(studentId, classId, week);
        var social = getSocialValue(studentId, classId, week);

        // Neither available: no score.
        if (academic === null && social === null) {
            return null;
        }

        // Only one available: use it directly.
        if (academic === null) {
            return round1(social);
        }
        if (social === null) {
            return round1(academic);
        }

        // Both available: weighted blend.
        var weights = getRankingWeights();
        var total = weights.academic + weights.social;
        if (total <= 0) {
            // Defensive: weights that sum to zero. Fall back to the
            // fallback weights. This shouldn't be reachable given the
            // guard in getRankingWeights, but we don't want to divide
            // by zero.
            weights = {
                academic: FALLBACK_RANKING_WEIGHTS.academic,
                social: FALLBACK_RANKING_WEIGHTS.social
            };
            total = weights.academic + weights.social;
        }

        var blended = (academic * weights.academic + social * weights.social) / total;
        return round1(blended);
    }

    function getAcademicValue(studentId, classId, week) {
        var academic = calculateAcademicAverage(studentId, classId, week);
        if (!academic || !isFiniteNumber(academic.average)) {
            return null;
        }
        return academic.average;
    }

    function getSocialValue(studentId, classId, week) {
        var ASS = getAcademySocialScore();
        if (!ASS || typeof ASS.getSocialScore !== 'function') {
            return null;
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) {
            return null;
        }

        try {
            var value = ASS.getSocialScore(studentId, classId, weekNum);
            if (isFiniteNumber(value)) {
                return value;
            }
            return null;
        } catch (e) {
            console.warn('[AcademyPerformance] getSocialScore failed:', e);
            return null;
        }
    }

    // ============================================================
    // PUBLIC API - Full Performance Breakdown
    // ============================================================

    /**
     * Calculate a full performance breakdown for a student in a class.
     *
     * @param {string} studentId
     * @param {string} classId
     * @param {number|string} [week]
     * @returns {object|null}
     */
    function calculateStudentPerformance(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = week !== undefined ? (parseInt(week, 10) || null) : null;

        var academic = calculateAcademicAverage(studentId, classId, weekNum);
        var social = getSocialValue(studentId, classId, weekNum);
        var overall = calculateOverallScore(studentId, classId, weekNum);

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

    // ============================================================
    // PUBLIC API - Class-Wide Performance
    // ============================================================

    /**
     * Calculate the academic average for every student in a class.
     *
     * @param {array} studentIds
     * @param {string} classId
     * @param {number|string} [week]
     * @returns {array}
     */
    function calculateClassPerformance(studentIds, classId, week) {
        if (!Array.isArray(studentIds) || !isNonEmptyString(classId)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            if (!isNonEmptyString(studentId)) {
                continue;
            }

            var academic = calculateAcademicAverage(studentId, classId, week);

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

        result.sort(function(a, b) {
            var aHasAvg = a.average !== null;
            var bHasAvg = b.average !== null;

            if (aHasAvg && bHasAvg) {
                if (b.average !== a.average) {
                    return b.average - a.average;
                }
                return a.studentId.localeCompare(b.studentId);
            }
            if (aHasAvg && !bHasAvg) { return -1; }
            if (!aHasAvg && bHasAvg) { return 1; }
            return a.studentId.localeCompare(b.studentId);
        });

        return result;
    }

    // ============================================================
    // PUBLIC API - Ranking-Ready Output
    // ============================================================

    /**
     * Calculate a ranking-ready list for a class.
     *
     * Ranks by the overall score. Falls back to academic average
     * when overall is not available for any student.
     *
     * @param {array} studentIds
     * @param {string} classId
     * @param {number|string} [week]
     * @param {function} [getCharacterById]
     * @returns {array}
     */
    function calculateRanking(studentIds, classId, week, getCharacterById) {
        if (!Array.isArray(studentIds) || !isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = week !== undefined ? (parseInt(week, 10) || null) : null;

        var entries = [];

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            if (!isNonEmptyString(studentId)) {
                continue;
            }

            var academic = calculateAcademicAverage(studentId, classId, weekNum);
            var social = getSocialValue(studentId, classId, weekNum);
            var overall = calculateOverallScore(studentId, classId, weekNum);

            var name = 'Unknown';
            if (typeof getCharacterById === 'function') {
                var char = getCharacterById(studentId);
                if (char && typeof char === 'object') {
                    name = (char.firstName || '') + ' ' + (char.lastName || '');
                    if (!name.trim()) {
                        name = 'Unknown';
                    }
                }
            }

            entries.push({
                studentId: String(studentId),
                name: name,
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

        // Rank by overall, falling back to academic when overall is
        // missing.
        entries.sort(function(a, b) {
            var aVal = a.overallScore !== null ? a.overallScore : a.academicAverage;
            var bVal = b.overallScore !== null ? b.overallScore : b.academicAverage;

            if (aVal === null && bVal === null) {
                return a.studentId.localeCompare(b.studentId);
            }
            if (aVal === null) { return 1; }
            if (bVal === null) { return -1; }
            if (bVal !== aVal) { return bVal - aVal; }
            return a.studentId.localeCompare(b.studentId);
        });

        // Assign ranks. Students with no score are unranked (rank: null).
        var rankCounter = 0;
        for (var j = 0; j < entries.length; j++) {
            var e = entries[j];
            var hasScore = e.overallScore !== null || e.academicAverage !== null;
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
    // INTERNAL - Enrollment lookup
    // ============================================================

    function getEnrolledDisciplineIds(studentId, classId) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var AE = window.AcademyEnrolments;
        if (AE && typeof AE.getStudentDisciplines === 'function') {
            var result = AE.getStudentDisciplines(studentId, classId);
            if (Array.isArray(result)) {
                return result;
            }
            return [];
        }

        return [];
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

        // Overall score (Phase 5)
        calculateOverallScore: calculateOverallScore,

        // Class-wide
        calculateClassPerformance: calculateClassPerformance,

        // Ranking-ready
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
