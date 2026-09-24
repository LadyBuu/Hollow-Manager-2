/**
 * modules/shared/queries/discipline-queries.js - Discipline Queries
 *
 * Path: js/modules/shared/queries/discipline-queries.js
 *
 * Legacy read facade for discipline data.
 *
 * WHAT THIS MODULE IS:
 *   A thin read-only wrapper over the discipline store. It exists
 *   because some callers predate AcademyDisciplines and were written
 *   against a query-shaped API rather than the domain module.
 *
 * WHAT THIS MODULE IS NOT:
 *   - A mutation module. Every write lives in AcademyDisciplines.
 *   - A cache. Every call reads live state through AcademyDisciplines.
 *   - An owner. AcademyDisciplines owns the discipline store.
 *
 * STORAGE:
 *   academy.disciplines. Not curriculum.disciplines. The `curriculum`
 *   container was retired when the last surviving store moved under
 *   academy.*.
 *
 * READ SAFETY:
 *   Every function delegates to AcademyDisciplines, which returns
 *   deep clones with normalized gradeScheme and assessmentWeights.
 *   Nothing here returns a live reference.
 *
 * MIGRATION PATH:
 *   The preferred migration is for every caller to move to
 *   AcademyDisciplines directly. When the last consumer of this
 *   module disappears, delete it. Until then, keep the surface
 *   minimal — do not add convenience wrappers.
 *
 * DEPENDENCIES:
 *   - window.AcademyDisciplines - MANDATORY
 */

(function() {
    'use strict';

    if (window.__disciplineQueriesLoaded) {
        return;
    }

    if (!window.AcademyDisciplines ||
        typeof window.AcademyDisciplines.getDisciplines !== 'function') {
        throw new Error(
            '[DisciplineQueries] AcademyDisciplines.getDisciplines is required.'
        );
    }

    window.__disciplineQueriesLoaded = true;

    var AcademyDisciplines = window.AcademyDisciplines;

    // ============================================================
    // READS
    // ============================================================

    /**
     * Get every discipline.
     * Returns a fresh array of deep clones.
     */
    function getAllDisciplines() {
        return AcademyDisciplines.getDisciplines();
    }

    /**
     * Get one discipline by ID.
     * Returns null when the discipline does not exist.
     */
    function getDiscipline(id) {
        if (!id) { return null; }
        return AcademyDisciplines.getDiscipline(id);
    }

    /**
     * Get disciplines by type ('mandatory' | 'optional').
     * Returns [] for an invalid type.
     */
    function getDisciplinesByType(type) {
        return AcademyDisciplines.getDisciplinesByType(type);
    }

    /**
     * Get disciplines active during the given week.
     * Returns [] for an invalid week.
     */
    function getDisciplinesForWeek(week) {
        return AcademyDisciplines.getActiveDisciplines(week);
    }

    /**
     * Does a discipline with this ID exist?
     */
    function disciplineExists(id) {
        if (!id) { return false; }
        return AcademyDisciplines.getDiscipline(id) !== null;
    }

    /**
     * Get the display name of a discipline. Returns 'Unknown Discipline'
     * when the discipline does not exist or has no name.
     *
     * Presentation helper. Callers that need the record read it via
     * getDiscipline().
     */
    function getDisciplineName(id) {
        if (!id) { return 'Unknown Discipline'; }
        var d = AcademyDisciplines.getDiscipline(id);
        if (!d) { return 'Unknown Discipline'; }
        if (typeof d.name !== 'string' || d.name.trim() === '') {
            return 'Unknown Discipline';
        }
        return d.name;
    }

    /**
     * Get the grade scheme for a discipline.
     *
     * Returns null when the discipline does not exist. Returns the
     * normalized scheme when it does — defaulting to numeric if the
     * stored scheme is missing or malformed.
     *
     * Callers must handle the null case explicitly.
     */
    function getDisciplineGradeScheme(id) {
        if (!id) { return null; }
        return AcademyDisciplines.getGradeScheme(id);
    }

    /**
     * Get the assessment weights for a discipline.
     *
     * Returns null when the discipline does not exist. Returns the
     * normalized weights map when it does.
     *
     * Callers must handle the null case explicitly.
     */
    function getDisciplineAssessmentWeights(id) {
        if (!id) { return null; }
        return AcademyDisciplines.getAssessmentWeights(id);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DisciplineQueries = Object.freeze({
        getAllDisciplines: getAllDisciplines,
        getDiscipline: getDiscipline,
        getDisciplinesByType: getDisciplinesByType,
        getDisciplinesForWeek: getDisciplinesForWeek,
        disciplineExists: disciplineExists,
        getDisciplineName: getDisciplineName,
        getDisciplineGradeScheme: getDisciplineGradeScheme,
        getDisciplineAssessmentWeights: getDisciplineAssessmentWeights
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DisciplineQueries;
        var missing = [];

        var required = [
            'getAllDisciplines',
            'getDiscipline',
            'getDisciplinesByType',
            'getDisciplinesForWeek',
            'disciplineExists',
            'getDisciplineName',
            'getDisciplineGradeScheme',
            'getDisciplineAssessmentWeights'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DisciplineQueries] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
