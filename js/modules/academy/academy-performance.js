/**
 * js/modules/academy/academy-performance.js - Academy Performance
 * PURE calculation layer for academic performance.
 * Path: js/modules/academy/academy-performance.js
 *
 * This module is responsible for:
 *   - Computing a student's weighted average for a single discipline
 *   - Rolling up per-discipline averages into an academic average
 *   - Returning the components (per-discipline and per-grade) that
 *     produced each aggregate, for display and debugging
 *
 * IMPORTANT:
 *   - PURE. No mutations. No persistence. No UI. No side effects.
 *   - Does NOT own grade data. Grades come from AcademyGrades.
 *   - Does NOT own discipline configuration. Weight configuration
 *     (assessmentWeights, weight) comes from AcademyDisciplines.
 *   - Does NOT write to window.data. Ever.
 *   - Returns plain data structures. No class instances, no DOM nodes.
 *
 * DESIGN:
 *   - Performance is a SEPARATE layer from grades and ranking.
 *     Grades store scores. Performance computes aggregates. Ranking
 *     consumes aggregates and produces ordered lists. Each layer has
 *     a single responsibility.
 *   - The layer is PURE: given the same inputs, it returns the same
 *     outputs. There is no hidden state, no caching, no time-of-day
 *     dependence. Time-of-day dependence is handled by the caller
 *     (which passes in the week).
 *
 * WEIGHT MODEL:
 *   - A grade record carries a `type` (exam, assignment, etc.) and
 *     a `score` / `maxScore` pair. It does NOT carry a weight.
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
 * NULL vs ZERO:
 *   - A discipline average is `null` when there is nothing to average
 *     (no grades, or all weights are zero). It is `0` when the student
 *     has grades and their weighted percentage sums to zero.
 *   - The academic average is `null` when no discipline contributed.
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
    // CONSTANTS
    // ============================================================

    /**
     * Default weight for an assessment type that has no explicit
     * entry in the discipline's assessmentWeights map.
     *
     * Rationale: a missing weight means "count this once". Ignoring
     * the grade would silently drop it from the average, which is
     * worse than counting it at a neutral weight.
     */
    var DEFAULT_ASSESSMENT_WEIGHT = 1.0;

    /**
     * Default weight for a discipline that has no explicit `weight`
     * field. Same rationale as DEFAULT_ASSESSMENT_WEIGHT.
     */
    var DEFAULT_DISCIPLINE_WEIGHT = 1.0;

    /**
     * Default passing threshold when no scheme is supplied. Mirrors
     * the default in AcademyGradeSchemes.
     */
    var DEFAULT_PASSING_THRESHOLD = GradeSchemes.PASSING_THRESHOLD || 70;

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

    /**
     * Get the weight for an assessment type from a discipline's
     * assessmentWeights map. Falls back to DEFAULT_ASSESSMENT_WEIGHT
     * when the map is missing, malformed, or has no entry for the
     * requested type.
     *
     * @param {object|null} discipline - Discipline record
     * @param {string} type - Assessment type
     * @returns {number} Weight (always a positive finite number)
     */
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

    /**
     * Get a discipline's roll-up weight. Falls back to
     * DEFAULT_DISCIPLINE_WEIGHT when the field is missing or invalid.
     *
     * @param {object|null} discipline - Discipline record
     * @returns {number} Weight (always a positive finite number)
     */
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
     * Compute the percentage for a grade. Prefers the derived
     * `percentage` field when present; falls back to computing from
     * score / maxScore.
     *
     * @param {object} grade
     * @returns {number} Percentage
     */
    function getGradePercentage(grade) {
        if (!grade || typeof grade !== 'object') {
            return 0;
        }

        if (isFiniteNumber(grade.percentage)) {
            return grade.percentage;
        }

        return AcademyGrades.calculatePercentage(grade.score, grade.maxScore);
    }

    /**
     * Filter a list of grades to those that belong to a discipline.
     *
     * @param {array} grades
     * @param {string} disciplineId
     * @returns {array} Filtered grades
     */
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

    /**
     * Round to one decimal place. Used for every numeric output of
     * this module so displays are consistent.
     */
    function round1(value) {
        if (!isFiniteNumber(value)) {
            return 0;
        }
        return Math.round(value * 10) / 10;
    }

    /**
     * Compute the pass / fail counts for a set of grades under a
     * scheme.
     *
     * @param {array} grades
     * @param {object|null} scheme
     * @returns {object} { passing, failing }
     */
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

    /**
     * Compute the weighted average of a list of grades against a
     * discipline's assessmentWeights.
     *
     * @param {array} grades - Grades within a single discipline
     * @param {object|null} discipline
     * @returns {object} { average, totalWeight, weightedSum }
     *   `average` is null when totalWeight is 0.
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
    // PUBLIC API - Discipline Average
    // ============================================================

    /**
     * Calculate a student's average within a single discipline.
     *
     * WEIGHTING:
     *   - Each grade's percentage is weighted by the discipline's
     *     assessmentWeights entry for that grade's `type`.
     *   - Grades of a type with no explicit weight fall back to
     *     DEFAULT_ASSESSMENT_WEIGHT (1.0).
     *
     * FILTERING:
     *   - When `week` is supplied, only grades from that week are used.
     *   - When `week` is absent, all weeks participate.
     *
     * NULL RETURN:
     *   - Returns null when there are no grades for the discipline
     *     (or all weights are 0, which cannot happen given the
     *     default fallback, but is checked for safety).
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
            week: week !== undefined ? parseInt(week, 10) || null : null,

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
     * ENROLLMENT SOURCE:
     *   - The set of disciplines a student is enrolled in is read
     *     from the student's `disciplineIds` array. This is the
     *     canonical enrollment source (see CharacterCRUD's docstring).
     *   - Grades only exist for disciplines the student is enrolled
     *     in. If enrollment is out of sync with grades, grades for
     *     unenrolled disciplines are still considered if the student
     *     has them; enrollment is the guiding list, not a hard filter.
     *     This is deliberate: a student temporarily unenrolled should
     *     not have their grades erased from their average.
     *
     * ROLL-UP WEIGHTING:
     *   - Each discipline contributes its disciplineAverage × the
     *     discipline's `weight` field.
     *   - Disciplines with no grades (disciplineAverage is null)
     *     are EXCLUDED from the roll-up. Zero-filling them would
     *     drag the academic average down for a student who is
     *     enrolled in many disciplines but graded in few.
     *
     * NULL RETURN:
     *   - Returns null when no discipline contributed a finite
     *     average (i.e., the student has no grades at all).
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

        var student = getStudentRecord(studentId);
        if (!student) {
            return null;
        }

        // Determine the set of disciplines to consider.
        var disciplineIds = getEnrolledDisciplineIds(student);
        if (disciplineIds.length === 0) {
            return null;
        }

        // For each enrolled discipline, compute its discipline average.
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
            week: week !== undefined ? parseInt(week, 10) || null : null,

            average: round1(weightedSum / totalWeight),
            disciplineCount: contributions.length,
            totalWeight: round1(totalWeight),

            contributions: contributions
        };
    }

    // ============================================================
    // PUBLIC API - Full Performance Breakdown
    // ============================================================

    /**
     * Calculate a full performance breakdown for a student in a class.
     *
     * Returns both the per-discipline averages and the rolled-up
     * academic average in one call. This is the shape the character
     * detail panel and the ranking view will consume.
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

        var academic = calculateAcademicAverage(studentId, classId, week);
        if (!academic) {
            return {
                studentId: String(studentId),
                classId: String(classId),
                week: week !== undefined ? parseInt(week, 10) || null : null,
                average: null,
                disciplineCount: 0,
                totalWeight: 0,
                disciplines: []
            };
        }

        var disciplines = [];
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

        return {
            studentId: academic.studentId,
            classId: academic.classId,
            week: academic.week,
            average: academic.average,
            disciplineCount: academic.disciplineCount,
            totalWeight: academic.totalWeight,
            disciplines: disciplines
        };
    }

    // ============================================================
    // PUBLIC API - Class-Wide Performance
    // ============================================================

    /**
     * Calculate the academic average for every student in a class.
     *
     * The class roster is derived from character.classIds. The
     * caller supplies a list of student IDs (typically obtained via
     * AcademyQueries.getClassStudents).
     *
     * Students with no grades are included in the output with
     * average: null, so callers can render an empty state rather
     * than omit the row.
     *
     * SORTING:
     *   - Students with a finite average are sorted descending.
     *   - Students with a null average are placed at the end, sorted
     *     by studentId for stability.
     *
     * @param {array} studentIds - Array of student IDs
     * @param {string} classId
     * @param {number|string} [week]
     * @returns {array} Array of { studentId, average, disciplineCount, ... }
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
     * This is the shape AcademyRanking.autoGenerate consumes. It
     * contains, per student:
     *   - studentId
     *   - name (resolved via the supplied resolver, if any)
     *   - average (academic average, or null)
     *   - rank (1-based position among students with a finite average)
     *
     * Students with a null average are NOT ranked. They appear in the
     * output with rank: null and are placed at the end. The caller
     * (AcademyRanking) decides whether to store them.
     *
     * @param {array} studentIds
     * @param {string} classId
     * @param {number|string} [week]
     * @param {function} [getCharacterById] - Optional name resolver
     * @returns {array}
     */
    function calculateRanking(studentIds, classId, week, getCharacterById) {
        var performance = calculateClassPerformance(studentIds, classId, week);

        var ranked = [];
        var rankCounter = 0;

        for (var i = 0; i < performance.length; i++) {
            var entry = performance[i];
            var name = 'Unknown';

            if (typeof getCharacterById === 'function') {
                var char = getCharacterById(entry.studentId);
                if (char && typeof char === 'object') {
                    name = (char.firstName || '') + ' ' + (char.lastName || '');
                    if (!name.trim()) {
                        name = 'Unknown';
                    }
                }
            }

            var rank = null;
            if (entry.average !== null) {
                rankCounter++;
                rank = rankCounter;
            }

            ranked.push({
                studentId: entry.studentId,
                name: name,
                average: entry.average,
                rank: rank,
                disciplineCount: entry.disciplineCount
            });
        }

        return ranked;
    }

    // ============================================================
    // INTERNAL - Student record lookup
    // ============================================================
    //
    // The student's enrolled-discipline list lives on the character
    // record (character.disciplineIds). CharacterQueries exposes the
    // canonical accessor. This module reads it via a lazy lookup so
    // it does not have to add a hard dependency on CharacterQueries
    // if a caller wants to feed student IDs in from elsewhere.

    function getStudentRecord(studentId) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var CQ = window.CharacterQueries;
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return null;
        }

        return CQ.getCharacterById(studentId);
    }

    function getEnrolledDisciplineIds(student) {
        if (!student || typeof student !== 'object') {
            return [];
        }

        if (!Array.isArray(student.disciplineIds)) {
            return [];
        }

        // Deduplicate while preserving order.
        var seen = {};
        var result = [];

        for (var i = 0; i < student.disciplineIds.length; i++) {
            var raw = student.disciplineIds[i];
            if (typeof raw !== 'string') {
                continue;
            }
            var trimmed = raw.trim();
            if (trimmed === '') {
                continue;
            }
            if (seen[trimmed]) {
                continue;
            }
            seen[trimmed] = true;
            result.push(trimmed);
        }

        return result;
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

        // Class-wide
        calculateClassPerformance: calculateClassPerformance,

        // Ranking-ready
        calculateRanking: calculateRanking,

        // Helpers exposed for callers that need the same rules
        getAssessmentWeight: getAssessmentWeight,
        getDisciplineWeight: getDisciplineWeight,

        // Constants
        DEFAULT_ASSESSMENT_WEIGHT: DEFAULT_ASSESSMENT_WEIGHT,
        DEFAULT_DISCIPLINE_WEIGHT: DEFAULT_DISCIPLINE_WEIGHT,
        DEFAULT_PASSING_THRESHOLD: DEFAULT_PASSING_THRESHOLD
    };

})();
