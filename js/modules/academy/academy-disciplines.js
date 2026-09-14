/**
 * modules/academy/academy-disciplines.js - Academy Disciplines
 * SINGLE SOURCE OF TRUTH for all discipline/curriculum data and operations
 *
 * Path: js/modules/academy/academy-disciplines.js
 *
 * This module is responsible for:
 *   - Discipline CRUD operations (create, update, delete)
 *   - Discipline queries (get by ID, get all, get available)
 *   - Discipline validation
 *   - Instructor assignment for disciplines
 *   - Grade scheme ownership (stored on the discipline record)
 *   - Assessment weight ownership (stored on the discipline record)
 *
 * IMPORTANT:
 *   - This module OWNS discipline data - it does NOT depend on AcademyQueries
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging)
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * READ SAFETY (Phase 2):
 *   - getCurriculum() returns null (does NOT create curriculum.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries return DEEP CLONES with normalized gradeScheme and
 *     assessmentWeights attached. Callers cannot mutate live state.
 *   - Internal accessors (getDisciplineRecord, getDisciplineRecords,
 *     getDisciplineByNameRecord) return LIVE REFERENCES. They are consumed
 *     by this module's own mutation paths, the cascade helpers, and
 *     AcademyQueries.
 *   - Pipeline validate() callbacks read from the `appData` argument the
 *     pipeline supplies, not from window.data via the internal accessors.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone is the
 *     original reference. Aliasing is a bug, not a graceful degradation.
 *
 * WEEK SEMANTICS:
 *   - getActiveDisciplines(week) requires a valid week. It does NOT fall
 *     back to window.data.currentWeek. Callers that want "current week"
 *     must read it themselves and pass it explicitly.
 *
 * GRADE SCHEME SEMANTICS:
 *   - Each discipline carries a `gradeScheme` object.
 *   - Schemes are FULLY user-editable. Presets only seed the bands array.
 *   - The scheme is a DISPLAY layer. Grades are always stored as percentages.
 *   - Missing gradeScheme on read → normalized to the numeric default.
 *     This is a READ-TIME normalization only; nothing is written to disk
 *     until the user edits the discipline.
 *   - Validation of the scheme shape is delegated to AcademyGradeSchemes.
 *   - isNumericScheme is NOT re-exported here. Callers use
 *     AcademyGradeSchemes.isNumericScheme directly.
 *
 * ASSESSMENT WEIGHTS SEMANTICS (Phase 3):
 *   - Each discipline carries an `assessmentWeights` object: a map from
 *     assessment type to a positive weight.
 *   - Weight is a property of the ASSESSMENT TYPE within a discipline,
 *     not of the individual grade record. The performance layer reads
 *     this map to compute weighted averages.
 *   - Canonical shape:
 *       {
 *         exam:          number > 0,
 *         assignment:    number > 0,
 *         participation: number > 0,
 *         quiz:          number > 0,
 *         project:       number > 0,
 *         final:         number > 0
 *       }
 *   - All six keys are always present on a normalized map. Zero is not a
 *     valid weight - a zero-weight assessment contributes nothing.
 *   - Missing assessmentWeights on read → normalized to the default map.
 *     Read-time normalization only; nothing is written to disk until the
 *     user edits the discipline.
 *   - The set of valid keys is owned by AcademyGrades.VALID_GRADE_TYPES.
 *     It is not duplicated here.
 *
 * CASCADE SEMANTICS (deleteDiscipline):
 *   Deleting a discipline is a CASCADE. In a single transaction it:
 *     1. Deletes the discipline from curriculum.disciplines.
 *     2. Removes auto-groups whose disciplineId matches.
 *     3. Strips the discipline ID from every student weekly schedule.
 *     4. Strips the discipline ID from every location weekly schedule.
 *     5. Prunes metadata keys whose target slot no longer exists.
 *     6. Deletes grades keyed to this discipline.
 *   Rationale: after deletion, any surviving reference would be
 *   unreachable data. Cleaning in the same transaction avoids both
 *   orphaned references and partial-cascade states.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / saveDisciplines all return
 *     Promise<{ success, data?, message? }>
 *   - getDiscipline / getDisciplines / getDisciplinesByType /
 *     getDisciplinesByInstructor / getAvailableDisciplines /
 *     getActiveDisciplines stay synchronous
 *
 * YEAR SEMANTICS:
 *   - Disciplines are scoped to WEEKS (bounded 1-52), not years.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY (for
 *     VALID_GRADE_TYPES; AcademyGrades does not depend on this module,
 *     so there is no cycle)
 *
 * USAGE:
 *   var disciplines = window.AcademyDisciplines;
 *
 *   disciplines.create({
 *       name: 'Combat Training',
 *       type: 'mandatory',
 *       gradeScheme: AcademyGradeSchemes.getPreset('letter'),
 *       assessmentWeights: { exam: 2.5, final: 3.0 }
 *   }).then(function(result) { ... });
 *
 *   disciplines.delete('disc_123').then(function(result) {
 *       // result.data.cascade contains the cascade summary
 *   });
 */

(function() {
    'use strict';

    if (window.__academyDisciplinesLoaded) {
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

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.AcademyGradeSchemes || typeof window.AcademyGradeSchemes.normalizeScheme !== 'function') {
        missing.push('AcademyGradeSchemes.normalizeScheme');
    }

    if (!window.AcademyGrades || !Array.isArray(window.AcademyGrades.VALID_GRADE_TYPES)) {
        missing.push('AcademyGrades.VALID_GRADE_TYPES');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyDisciplines] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyDisciplinesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var GradeSchemes = window.AcademyGradeSchemes;
    var AcademyGrades = window.AcademyGrades;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_START_WEEK = MIN_WEEK;
    var DEFAULT_END_WEEK = MAX_WEEK;

    var VALID_DISCIPLINE_TYPES = ['mandatory', 'optional'];
    var DEFAULT_TYPE = 'mandatory';

    var MIN_WEEKLY_HOURS = 0.5;
    var MAX_WEEKLY_HOURS = 40;
    var DEFAULT_WEEKLY_HOURS = 1;

    var MIN_WEIGHT = 0.1;
    var MAX_WEIGHT = 10;
    var DEFAULT_WEIGHT = 1;

    // ---- Assessment weights (Phase 3) ----

    var MIN_ASSESSMENT_WEIGHT = 0.1;
    var MAX_ASSESSMENT_WEIGHT = 10;

    var DEFAULT_ASSESSMENT_WEIGHTS = Object.freeze({
        exam: 2.0,
        assignment: 1.0,
        participation: 1.0,
        quiz: 1.0,
        project: 1.5,
        final: 3.0
    });

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
                '[AcademyDisciplines] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
    }

    function generateId() {
        return IdUtils.generateId('disc');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // GRADE SCHEME HELPERS
    // ============================================================

    function normalizeGradeScheme(raw) {
        return GradeSchemes.normalizeScheme(raw);
    }

    function validateGradeScheme(raw) {
        if (raw === undefined || raw === null) {
            return { valid: true };
        }

        var result = GradeSchemes.validateScheme(raw);
        if (result.valid) {
            return { valid: true };
        }

        var messages = [];
        for (var i = 0; i < result.errors.length; i++) {
            if (result.errors[i] && result.errors[i].message) {
                messages.push(result.errors[i].message);
            }
        }

        return {
            valid: false,
            message: messages.length > 0
                ? messages.join(' ')
                : 'Grade scheme is invalid.'
        };
    }

    // NOTE: isNumericScheme is deliberately NOT re-exported here.
    // Callers use AcademyGradeSchemes.isNumericScheme directly.

    // ============================================================
    // ASSESSMENT WEIGHT HELPERS (Phase 3)
    // ============================================================

    function getValidAssessmentTypes() {
        return AcademyGrades.VALID_GRADE_TYPES.slice();
    }

    /**
     * Get a fresh, unfrozen copy of the default assessment weights map.
     */
    function getDefaultAssessmentWeights() {
        var copy = {};
        var types = AcademyGrades.VALID_GRADE_TYPES;
        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            copy[type] = DEFAULT_ASSESSMENT_WEIGHTS[type];
        }
        return copy;
    }

    /**
     * Normalize an assessmentWeights map to canonical shape.
     *
     * SEMANTICS:
     *   - Missing or malformed input -> returns the default map.
     *   - Missing keys -> filled with the default value for that key.
     *   - Unknown keys -> dropped silently. The strict validator is
     *     what rejects typos; this normalizer only produces a usable
     *     shape.
     *   - Invalid values (NaN, Infinity, non-number, <= 0) -> replaced
     *     with the default for that key.
     *   - Values outside [MIN, MAX] -> clamped.
     *   - Values are rounded to one decimal place.
     *
     * Returns a fresh plain object (not frozen).
     */
    function normalizeAssessmentWeights(raw) {
        var result = {};
        var types = AcademyGrades.VALID_GRADE_TYPES;

        // Seed with defaults for every valid type.
        for (var i = 0; i < types.length; i++) {
            result[types[i]] = DEFAULT_ASSESSMENT_WEIGHTS[types[i]];
        }

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return result;
        }

        for (var j = 0; j < types.length; j++) {
            var validType = types[j];
            if (!Object.prototype.hasOwnProperty.call(raw, validType)) {
                continue;
            }

            var value = Number(raw[validType]);
            if (!isFinite(value) || value <= 0) {
                continue;  // keep the default
            }

            if (value < MIN_ASSESSMENT_WEIGHT) value = MIN_ASSESSMENT_WEIGHT;
            if (value > MAX_ASSESSMENT_WEIGHT) value = MAX_ASSESSMENT_WEIGHT;

            result[validType] = Math.round(value * 10) / 10;
        }

        return result;
    }

    /**
     * Validate an assessmentWeights map as supplied by a caller.
     *
     * STRICTER than normalizeAssessmentWeights:
     *   - Unknown keys are REJECTED (catches typos like "exams").
     *   - Out-of-range values are REJECTED, not clamped.
     *
     * Missing keys are NOT rejected. A partial map like { exam: 2.5 }
     * is valid; missing keys fill with defaults during normalization.
     */
    function validateAssessmentWeights(raw) {
        if (raw === undefined || raw === null) {
            return { valid: true };
        }

        if (typeof raw !== 'object' || Array.isArray(raw)) {
            return { valid: false, message: 'Assessment weights must be an object.' };
        }

        var validTypes = AcademyGrades.VALID_GRADE_TYPES;
        var keys = Object.keys(raw);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];

            if (validTypes.indexOf(key) === -1) {
                return {
                    valid: false,
                    message: 'Unknown assessment type: "' + key + '". ' +
                        'Valid types are: ' + validTypes.join(', ') + '.'
                };
            }

            var value = raw[key];

            if (typeof value !== 'number' || !isFinite(value)) {
                return {
                    valid: false,
                    message: 'Weight for "' + key + '" must be a finite number.'
                };
            }

            if (value < MIN_ASSESSMENT_WEIGHT || value > MAX_ASSESSMENT_WEIGHT) {
                return {
                    valid: false,
                    message: 'Weight for "' + key + '" must be between ' +
                        MIN_ASSESSMENT_WEIGHT + ' and ' + MAX_ASSESSMENT_WEIGHT + '.'
                };
            }
        }

        return { valid: true };
    }

    /**
     * Does a discipline's assessmentWeights map equal the default?
     */
    function isDefaultAssessmentWeights(weights) {
        if (!weights || typeof weights !== 'object') {
            return true;
        }

        var types = AcademyGrades.VALID_GRADE_TYPES;
        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            if (weights[type] !== DEFAULT_ASSESSMENT_WEIGHTS[type]) {
                return false;
            }
        }

        return true;
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================
    //
    // READ SAFETY:
    //   - getDataStore() returns null when window.data is missing.
    //   - getCurriculum() returns null when window.data.curriculum is
    //     missing. It does NOT create curriculum.{...} as a side effect
    //     of a read.
    //
    //   Structure creation happens ONLY inside pipeline mutate()
    //   callbacks via ensureDisciplineStore, which operates on the
    //   appData snapshot the pipeline hands in.

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

    /**
     * Ensure the discipline store exists on the given appData snapshot.
     * Only called from inside pipeline mutate() callbacks.
     */
    function ensureDisciplineStore(appData) {
        if (!appData.curriculum || typeof appData.curriculum !== 'object') {
            appData.curriculum = {};
        }
        if (!Array.isArray(appData.curriculum.disciplines)) {
            appData.curriculum.disciplines = [];
        }
        return appData.curriculum.disciplines;
    }

    // ============================================================
    // INTERNAL DISCIPLINE LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================
    //
    // These return LIVE REFERENCES. They are consumed by this module's
    // own mutation paths, the cascade helpers, and AcademyQueries.
    // The public read surface (below) wraps them with deepClone.

    function getDisciplineRecord(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d && String(d.id) === target) {
                return d;
            }
        }

        return null;
    }

    function getDisciplineRecords() {
        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d) {
                result.push(d);
            }
        }

        return result;
    }

    function getDisciplineByNameRecord(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var disciplines = getDisciplineRecords();

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && d.name && String(d.name).toLowerCase().trim() === target) {
                return d;
            }
        }

        return null;
    }

    /**
     * Internal normalization for reads.
     *
     * Ensures `gradeScheme` and `assessmentWeights` are present and
     * canonical on the returned copy. The live record itself is NOT
     * modified here. Only the clone returned to the caller gains the
     * normalized fields.
     *
     * Name is a historical artifact: this function used to only
     * attach a normalized scheme. It now attaches both, but the name
     * is retained to avoid churn in the call sites.
     */
    function attachNormalizedConfig(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        var copy = deepClone(record);
        copy.gradeScheme = normalizeGradeScheme(record.gradeScheme);
        copy.assessmentWeights = normalizeAssessmentWeights(record.assessmentWeights);
        return copy;
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    function validateDisciplineData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        if (!isPartial || data.name !== undefined) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
        }

        if (data.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', ') };
            }
        }

        if (data.instructorIds !== undefined) {
            if (!Array.isArray(data.instructorIds)) {
                return { valid: false, message: 'Instructor IDs must be an array.' };
            }
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!isNonEmptyString(data.instructorIds[i])) {
                    return { valid: false, message: 'Invalid instructor ID at index ' + i + '.' };
                }
            }
        }

        if (data.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(data.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return { valid: false, message: 'Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        if (data.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(data.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return { valid: false, message: 'End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        if (data.weeklyHours !== undefined) {
            var weeklyHours = Number(data.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return { valid: false, message: 'Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.' };
            }
        }

        if (data.weight !== undefined) {
            var weight = Number(data.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return { valid: false, message: 'Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.' };
            }
        }

        if (data.gradeScheme !== undefined) {
            var schemeCheck = validateGradeScheme(data.gradeScheme);
            if (!schemeCheck.valid) {
                return { valid: false, message: schemeCheck.message };
            }
        }

        if (data.assessmentWeights !== undefined) {
            var weightsCheck = validateAssessmentWeights(data.assessmentWeights);
            if (!weightsCheck.valid) {
                return { valid: false, message: weightsCheck.message };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    /**
     * Build a canonical discipline record from raw data.
     *
     * `gradeScheme` and `assessmentWeights` are always present on the
     * output. If the caller did not supply one, the existing one (on
     * update) or the default (on create) is used.
     *
     * @param {object} data                    - Raw input
     * @param {string|null} existingId         - ID to reuse (update path)
     * @param {string|null} existingCreatedAt  - createdAt to preserve
     * @param {object|null} existingScheme     - Scheme fallback (update path)
     * @param {object|null} existingWeights    - Weights fallback (update path)
     */
    function buildDisciplineRecord(data, existingId, existingCreatedAt, existingScheme, existingWeights) {
        var now = new Date().toISOString();

        var startWeek = data.startWeek !== undefined
            ? CalendarValidation.parseWeek(data.startWeek)
            : DEFAULT_START_WEEK;
        var endWeek = data.endWeek !== undefined
            ? CalendarValidation.parseWeek(data.endWeek)
            : DEFAULT_END_WEEK;

        var weeklyHours = data.weeklyHours !== undefined
            ? Number(data.weeklyHours)
            : DEFAULT_WEEKLY_HOURS;
        var weight = data.weight !== undefined
            ? Number(data.weight)
            : DEFAULT_WEIGHT;

        var instructorIds = Array.isArray(data.instructorIds)
            ? data.instructorIds.map(function(id) { return String(id).trim(); })
            : [];

        // ---- Resolve grade scheme ----
        var scheme;
        if (data.gradeScheme !== undefined && data.gradeScheme !== null) {
            scheme = normalizeGradeScheme(data.gradeScheme);
        } else if (existingScheme !== undefined && existingScheme !== null) {
            scheme = normalizeGradeScheme(existingScheme);
        } else {
            scheme = normalizeGradeScheme(null); // numeric default
        }

        // ---- Resolve assessment weights ----
        var weights;
        if (data.assessmentWeights !== undefined && data.assessmentWeights !== null) {
            weights = normalizeAssessmentWeights(data.assessmentWeights);
        } else if (existingWeights !== undefined && existingWeights !== null) {
            weights = normalizeAssessmentWeights(existingWeights);
        } else {
            weights = normalizeAssessmentWeights(null); // default map
        }

        return {
            id: existingId || generateId(),
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
            instructorIds: instructorIds,
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            weight: weight,
            gradeScheme: scheme,
            assessmentWeights: weights,
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a discipline ID
    // ============================================================

    function stripDisciplineFromSchedules(curriculum, disciplineId) {
        var schedules = curriculum.schedules;
        if (!schedules || typeof schedules !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var removedCount = 0;

        Object.keys(schedules).forEach(function(studentId) {
            var byWeek = schedules[studentId];
            if (!byWeek || typeof byWeek !== 'object') {
                return;
            }

            Object.keys(byWeek).forEach(function(weekKey) {
                var byDay = byWeek[weekKey];
                if (!byDay || typeof byDay !== 'object') {
                    return;
                }

                Object.keys(byDay).forEach(function(dayKey) {
                    var byHour = byDay[dayKey];
                    if (!byHour || typeof byHour !== 'object') {
                        return;
                    }

                    Object.keys(byHour).forEach(function(hourKey) {
                        if (String(byHour[hourKey]) === target) {
                            delete byHour[hourKey];
                            removedCount++;
                        }
                    });

                    if (Object.keys(byHour).length === 0) {
                        delete byDay[dayKey];
                    }
                });

                if (Object.keys(byDay).length === 0) {
                    delete byWeek[weekKey];
                }
            });

            if (Object.keys(byWeek).length === 0) {
                delete schedules[studentId];
            }
        });

        return removedCount;
    }

    function stripDisciplineFromLocationSchedules(curriculum, disciplineId) {
        var schedules = curriculum.locationSchedules;
        if (!schedules || typeof schedules !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var removedCount = 0;

        Object.keys(schedules).forEach(function(locationId) {
            var byWeek = schedules[locationId];
            if (!byWeek || typeof byWeek !== 'object') {
                return;
            }

            Object.keys(byWeek).forEach(function(weekKey) {
                var byDay = byWeek[weekKey];
                if (!byDay || typeof byDay !== 'object') {
                    return;
                }

                Object.keys(byDay).forEach(function(dayKey) {
                    var byHour = byDay[dayKey];
                    if (!byHour || typeof byHour !== 'object') {
                        return;
                    }

                    Object.keys(byHour).forEach(function(hourKey) {
                        if (String(byHour[hourKey]) === target) {
                            delete byHour[hourKey];
                            removedCount++;
                        }
                    });

                    if (Object.keys(byHour).length === 0) {
                        delete byDay[dayKey];
                    }
                });

                if (Object.keys(byDay).length === 0) {
                    delete byWeek[weekKey];
                }
            });

            if (Object.keys(byWeek).length === 0) {
                delete schedules[locationId];
            }
        });

        return removedCount;
    }

    function stripDisciplineFromAutoGroups(curriculum, disciplineId) {
        var store = curriculum.autoGroups;
        if (!store || typeof store !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var keysToRemove = [];

        Object.keys(store).forEach(function(key) {
            var group = store[key];
            if (group && String(group.disciplineId) === target) {
                keysToRemove.push(key);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete store[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    function pruneOrphanedMetadata(curriculum) {
        var metadata = curriculum.metadata;
        if (!metadata || typeof metadata !== 'object') {
            return 0;
        }

        var schedules = curriculum.schedules || {};
        var locationSchedules = curriculum.locationSchedules || {};
        var keysToRemove = [];

        Object.keys(metadata).forEach(function(key) {
            var parts = String(key).split('_');
            if (parts.length < 4) {
                return;
            }

            var hour = parts[parts.length - 1];
            var day = parts[parts.length - 2];
            var week = parts[parts.length - 3];
            var entityId = parts.slice(0, parts.length - 3).join('_');

            var slotExists = false;

            if (schedules[entityId] &&
                schedules[entityId][week] &&
                schedules[entityId][week][day] &&
                schedules[entityId][week][day][hour] !== undefined) {
                slotExists = true;
            }

            if (!slotExists &&
                locationSchedules[entityId] &&
                locationSchedules[entityId][week] &&
                locationSchedules[entityId][week][day] &&
                locationSchedules[entityId][week][day][hour] !== undefined) {
                slotExists = true;
            }

            if (!slotExists) {
                keysToRemove.push(key);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete metadata[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    function stripDisciplineFromGrades(appData, disciplineId) {
        if (!appData.academy || !appData.academy.grades ||
            typeof appData.academy.grades !== 'object') {
            return 0;
        }

        var grades = appData.academy.grades;
        var target = String(disciplineId);
        var keysToRemove = [];

        Object.keys(grades).forEach(function(id) {
            var grade = grades[id];
            if (grade && String(grade.disciplineId) === target) {
                keysToRemove.push(id);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete grades[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    // ============================================================
    // PUBLIC API - DISCIPLINE CRUD (Promise-based)
    // ============================================================

    /**
     * Create a new discipline.
     */
    function create(data) {
        // ---- VALIDATE INPUT ----
        var validation = validateDisciplineData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- CHECK FOR DUPLICATE NAME (pre-flight) ----
        var existing = getDisciplineByNameRecord(data.name);
        if (existing) {
            return Promise.resolve(failure('A discipline with this name already exists.'));
        }

        // ---- BUILD CANDIDATE ----
        var newDiscipline;
        try {
            newDiscipline = buildDisciplineRecord(data, null, null, null, null);
        } catch (e) {
            return Promise.resolve(failure(e.message || 'Failed to build discipline record.'));
        }

        if (newDiscipline.startWeek > newDiscipline.endWeek) {
            return Promise.resolve(failure('Start week cannot be after end week.'));
        }

        var targetId = newDiscipline.id;

        // ---- PIPELINE MUTATION ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var curriculum = appData.curriculum;
                if (curriculum && Array.isArray(curriculum.disciplines)) {
                    var nameLower = newDiscipline.name.toLowerCase();
                    for (var i = 0; i < curriculum.disciplines.length; i++) {
                        var d = curriculum.disciplines[i];
                        if (d && d.name && String(d.name).toLowerCase() === nameLower) {
                            return { valid: false, message: 'A discipline with this name already exists.' };
                        }
                    }
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                disciplines.push(deepClone(newDiscipline));
                return { discipline: newDiscipline, id: targetId };
            },
            logMessage: 'Created discipline: ' + newDiscipline.name,
            successMessage: 'Discipline created successfully!',
            failureMessage: 'Failed to create discipline.'
        });
    }

    /**
     * Update an existing discipline.
     */
    function update(id, updates) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getDisciplineRecord(id);
        if (!existing) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        // ---- VALIDATE UPDATES ----
        var validation = validateDisciplineData(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone discipline data.'));
        }

        var hasChanges = false;

        // Name
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return Promise.resolve(failure('Discipline name cannot be empty.'));
            }
            if (newName !== candidate.name) {
                var duplicate = getDisciplineByNameRecord(newName);
                if (duplicate && String(duplicate.id) !== String(id)) {
                    return Promise.resolve(failure('A discipline with this name already exists.'));
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Type
        if (updates.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(updates.type) === -1) {
                return Promise.resolve(failure('Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', ')));
            }
            if (candidate.type !== updates.type) {
                candidate.type = updates.type;
                hasChanges = true;
            }
        }

        // Instructors
        if (updates.instructorIds !== undefined) {
            if (!Array.isArray(updates.instructorIds)) {
                return Promise.resolve(failure('Instructor IDs must be an array.'));
            }
            var newInstructors = [];
            for (var j = 0; j < updates.instructorIds.length; j++) {
                if (isNonEmptyString(updates.instructorIds[j])) {
                    newInstructors.push(String(updates.instructorIds[j]).trim());
                }
            }
            var currentSorted = (candidate.instructorIds || []).slice().sort();
            var newSorted = newInstructors.slice().sort();
            var changed = currentSorted.length !== newSorted.length ||
                currentSorted.some(function(v, idx) { return v !== newSorted[idx]; });
            if (changed) {
                candidate.instructorIds = newInstructors;
                hasChanges = true;
            }
        }

        // Start week
        if (updates.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(updates.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return Promise.resolve(failure('Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'));
            }
            if (candidate.startWeek !== startWeek) {
                candidate.startWeek = startWeek;
                hasChanges = true;
            }
        }

        // End week
        if (updates.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(updates.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return Promise.resolve(failure('End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'));
            }
            if (candidate.endWeek !== endWeek) {
                candidate.endWeek = endWeek;
                hasChanges = true;
            }
        }

        // Weekly hours
        if (updates.weeklyHours !== undefined) {
            var weeklyHours = Number(updates.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return Promise.resolve(failure('Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.'));
            }
            if (candidate.weeklyHours !== weeklyHours) {
                candidate.weeklyHours = weeklyHours;
                hasChanges = true;
            }
        }

        // Weight
        if (updates.weight !== undefined) {
            var weight = Number(updates.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return Promise.resolve(failure('Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.'));
            }
            if (candidate.weight !== weight) {
                candidate.weight = weight;
                hasChanges = true;
            }
        }

        // Grade scheme
        if (updates.gradeScheme !== undefined) {
            var schemeCheck = validateGradeScheme(updates.gradeScheme);
            if (!schemeCheck.valid) {
                return Promise.resolve(failure(schemeCheck.message));
            }

            var newScheme = normalizeGradeScheme(updates.gradeScheme);
            var oldSchemeJson = JSON.stringify(candidate.gradeScheme || null);
            var newSchemeJson = JSON.stringify(newScheme);
            if (oldSchemeJson !== newSchemeJson) {
                candidate.gradeScheme = newScheme;
                hasChanges = true;
            }
        }

        // Assessment weights
        if (updates.assessmentWeights !== undefined) {
            var weightsCheck = validateAssessmentWeights(updates.assessmentWeights);
            if (!weightsCheck.valid) {
                return Promise.resolve(failure(weightsCheck.message));
            }

            var newWeights = normalizeAssessmentWeights(updates.assessmentWeights);
            var oldWeightsJson = JSON.stringify(candidate.assessmentWeights || null);
            var newWeightsJson = JSON.stringify(newWeights);
            if (oldWeightsJson !== newWeightsJson) {
                candidate.assessmentWeights = newWeights;
                hasChanges = true;
            }
        }

        if (candidate.startWeek > candidate.endWeek) {
            return Promise.resolve(failure('Start week cannot be after end week.'));
        }

        if (!hasChanges) {
            return Promise.resolve(success({
                discipline: attachNormalizedConfig(candidate),
                changed: false
            }));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(id);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.curriculum || !Array.isArray(appData.curriculum.disciplines)) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                var found = false;
                for (var i = 0; i < appData.curriculum.disciplines.length; i++) {
                    if (String(appData.curriculum.disciplines[i].id) === targetId) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                var idx = -1;
                for (var i = 0; i < disciplines.length; i++) {
                    if (String(disciplines[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Discipline not found in data store.');
                }
                disciplines[idx] = deepClone(candidate);
                return { discipline: candidate, changed: true };
            },
            logMessage: 'Updated discipline: ' + candidate.name,
            successMessage: 'Discipline updated successfully!',
            failureMessage: 'Failed to update discipline.'
        });
    }

    /**
     * Delete a discipline permanently.
     *
     * CASCADE: removes all references to the discipline in one transaction.
     */
    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var target = String(id);
        var existing = getDisciplineRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        var disciplineInfo = {
            id: target,
            name: existing.name
        };

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.curriculum || !Array.isArray(appData.curriculum.disciplines)) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                var found = false;
                for (var i = 0; i < appData.curriculum.disciplines.length; i++) {
                    if (String(appData.curriculum.disciplines[i].id) === target) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                // ---- 1. Delete the discipline entity ----
                var disciplines = ensureDisciplineStore(appData);
                var idx = -1;
                for (var i = 0; i < disciplines.length; i++) {
                    if (String(disciplines[i].id) === target) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Discipline not found in data store.');
                }
                disciplines.splice(idx, 1);

                // ---- 2. Ensure curriculum structure exists for cascade ----
                if (!appData.curriculum || typeof appData.curriculum !== 'object') {
                    appData.curriculum = {};
                }
                var curriculum = appData.curriculum;

                // ---- 3. Cascade: strip discipline from schedules ----
                var scheduleSlotsRemoved = stripDisciplineFromSchedules(curriculum, target);
                var locationSlotsRemoved = stripDisciplineFromLocationSchedules(curriculum, target);

                // ---- 4. Cascade: remove matching auto-groups ----
                var groupsRemoved = stripDisciplineFromAutoGroups(curriculum, target);

                // ---- 5. Cascade: prune orphaned metadata ----
                var metadataPruned = pruneOrphanedMetadata(curriculum);

                // ---- 6. Cascade: remove grades keyed to this discipline ----
                var gradesRemoved = stripDisciplineFromGrades(appData, target);

                return {
                    deleted: true,
                    discipline: disciplineInfo,
                    cascade: {
                        scheduleSlotsRemoved: scheduleSlotsRemoved,
                        locationSlotsRemoved: locationSlotsRemoved,
                        autoGroupsRemoved: groupsRemoved,
                        metadataEntriesPruned: metadataPruned,
                        gradesRemoved: gradesRemoved
                    }
                };
            },
            logMessage: function(result) {
                var c = result.cascade;
                var extra = [];
                if (c.scheduleSlotsRemoved > 0) extra.push(c.scheduleSlotsRemoved + ' slot(s)');
                if (c.locationSlotsRemoved > 0) extra.push(c.locationSlotsRemoved + ' location slot(s)');
                if (c.autoGroupsRemoved > 0) extra.push(c.autoGroupsRemoved + ' group(s)');
                if (c.gradesRemoved > 0) extra.push(c.gradesRemoved + ' grade(s)');
                var suffix = extra.length > 0 ? ' (' + extra.join(', ') + ')' : '';
                return 'Deleted discipline: ' + existing.name + suffix;
            },
            successMessage: 'Discipline deleted successfully!',
            failureMessage: 'Failed to delete discipline.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================
    //
    // These are the consumer-facing lookups. They return DEEP CLONES
    // with a normalized gradeScheme AND a normalized assessmentWeights
    // attached. Internal code paths within this module continue to use
    // the *Internal accessors, which return live references.

    function getDiscipline(id) {
        var record = getDisciplineRecord(id);
        return record ? attachNormalizedConfig(record) : null;
    }

    function getDisciplines() {
        var records = getDisciplineRecords();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(attachNormalizedConfig(records[i]));
        }
        return result;
    }

    function getDisciplinesByType(type) {
        if (VALID_DISCIPLINE_TYPES.indexOf(type) === -1) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].type === type) {
                result.push(attachNormalizedConfig(all[i]));
            }
        }

        return result;
    }

    function getDisciplinesByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];
        var target = String(instructorId);

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.instructorIds && Array.isArray(d.instructorIds)) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === target) {
                        result.push(attachNormalizedConfig(d));
                        break;
                    }
                }
            }
        }

        return result;
    }

    function getAvailableDisciplines(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.startWeek <= weekNum && d.endWeek >= weekNum) {
                result.push(attachNormalizedConfig(d));
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    /**
     * Get disciplines active in the specified week.
     *
     * WEEK SEMANTICS: `currentWeek` is REQUIRED. No fallback to
     * window.data.currentWeek. An invalid or missing week returns [].
     */
    function getActiveDisciplines(currentWeek) {
        var week = CalendarValidation.parseWeek(currentWeek);
        if (week === null) {
            return [];
        }

        return getAvailableDisciplines(week);
    }

    /**
     * Get a discipline's grade scheme, normalized.
     * Returns the numeric default if the discipline has no scheme or
     * does not exist.
     */
    function getGradeScheme(id) {
        var record = getDisciplineRecord(id);
        if (!record) {
            return normalizeGradeScheme(null);
        }
        return normalizeGradeScheme(record.gradeScheme);
    }

    /**
     * Get a discipline's assessment weights, normalized.
     * Returns a fresh copy of the default map if the discipline does
     * not exist or has no weights.
     */
    function getAssessmentWeights(id) {
        var record = getDisciplineRecord(id);
        if (!record) {
            return getDefaultAssessmentWeights();
        }
        return normalizeAssessmentWeights(record.assessmentWeights);
    }

    /**
     * Get the default assessment weights map.
     * Fresh copy; safe to mutate.
     */
    function getDefaultAssessmentWeightsPublic() {
        return getDefaultAssessmentWeights();
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Save multiple disciplines at once.
     */
    function saveDisciplines(disciplinesData, options) {
        if (!Array.isArray(disciplinesData) || disciplinesData.length === 0) {
            return Promise.resolve(failure('Discipline data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        // ---- PLAN ----
        var planned = [];
        var errors = [];

        for (var i = 0; i < disciplinesData.length; i++) {
            var data = disciplinesData[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid discipline data.' });
                continue;
            }

            if (!isNonEmptyString(data.name)) {
                errors.push({ index: i, error: 'Missing required field: name' });
                continue;
            }

            var validation = validateDisciplineData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, error: validation.message });
                continue;
            }

            var existing = getDisciplineByNameRecord(data.name);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildDisciplineRecord(
                    data,
                    existing.id,
                    existing.createdAt,
                    existing.gradeScheme,
                    existing.assessmentWeights
                );
                if (candidate.startWeek > candidate.endWeek) {
                    errors.push({ index: i, error: 'Start week cannot be after end week.' });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildDisciplineRecord(data, null, null, null, null);
                if (newRecord.startWeek > newRecord.endWeek) {
                    errors.push({ index: i, error: 'Start week cannot be after end week.' });
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
                total: disciplinesData.length,
                created: 0,
                updated: 0,
                skipped: skipped,
                errors: errors,
                successCount: 0
            }));
        }

        // ---- APPLY ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];

                    if (item.action === 'create') {
                        var nameLower = item.record.name.toLowerCase();
                        var collision = false;
                        for (var c = 0; c < disciplines.length; c++) {
                            if (disciplines[c].name &&
                                String(disciplines[c].name).toLowerCase() === nameLower) {
                                collision = true;
                                break;
                            }
                        }
                        if (collision) {
                            throw new Error('Discipline already exists: ' + item.record.name);
                        }
                        disciplines.push(deepClone(item.record));
                        created++;

                    } else if (item.action === 'update') {
                        var idx = -1;
                        for (var u = 0; u < disciplines.length; u++) {
                            if (String(disciplines[u].id) === String(item.matchId)) {
                                idx = u;
                                break;
                            }
                        }
                        if (idx === -1) {
                            throw new Error('Discipline no longer exists: ' + item.matchId);
                        }
                        disciplines[idx] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: disciplinesData.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' discipline(s)',
            successMessage: 'Disciplines saved successfully!',
            failureMessage: 'Failed to save disciplines.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplines = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteDiscipline,
        saveDisciplines: saveDisciplines,

        // ---- Public queries (synchronous, CLONES) ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getDisciplinesByType: getDisciplinesByType,
        getDisciplinesByInstructor: getDisciplinesByInstructor,
        getAvailableDisciplines: getAvailableDisciplines,
        getActiveDisciplines: getActiveDisciplines,

        // ---- Grade scheme helpers ----
        getGradeScheme: getGradeScheme,
        // isNumericScheme is NOT exported here. Callers use
        // AcademyGradeSchemes.isNumericScheme directly.

        // ---- Assessment weight helpers (Phase 3) ----
        getAssessmentWeights: getAssessmentWeights,
        getDefaultAssessmentWeights: getDefaultAssessmentWeightsPublic,
        isDefaultAssessmentWeights: isDefaultAssessmentWeights,
        getValidAssessmentTypes: getValidAssessmentTypes,

        // ---- Internal (LIVE REFERENCES - for AcademyQueries and internal use) ----
        getDisciplineRecord: getDisciplineRecord,
        getDisciplineRecords: getDisciplineRecords,
        getDisciplineByNameRecord: getDisciplineByNameRecord,

        // ---- Constants ----
        VALID_DISCIPLINE_TYPES: VALID_DISCIPLINE_TYPES,
        DEFAULT_TYPE: DEFAULT_TYPE,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_WEEKLY_HOURS: MIN_WEEKLY_HOURS,
        MAX_WEEKLY_HOURS: MAX_WEEKLY_HOURS,
        MIN_WEIGHT: MIN_WEIGHT,
        MAX_WEIGHT: MAX_WEIGHT,
        DEFAULT_WEEKLY_HOURS: DEFAULT_WEEKLY_HOURS,
        DEFAULT_WEIGHT: DEFAULT_WEIGHT,
        DEFAULT_ASSESSMENT_WEIGHTS: DEFAULT_ASSESSMENT_WEIGHTS,
        MIN_ASSESSMENT_WEIGHT: MIN_ASSESSMENT_WEIGHT,
        MAX_ASSESSMENT_WEIGHT: MAX_ASSESSMENT_WEIGHT
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplines;
        var missing = [];

        var required = [
            'create', 'update', 'delete', 'saveDisciplines',
            'getDiscipline', 'getDisciplines', 'getDisciplinesByType',
            'getDisciplinesByInstructor', 'getAvailableDisciplines',
            'getActiveDisciplines',
            'getGradeScheme',
            'getAssessmentWeights', 'getDefaultAssessmentWeights',
            'isDefaultAssessmentWeights', 'getValidAssessmentTypes',
            'getDisciplineRecord', 'getDisciplineRecords', 'getDisciplineByNameRecord'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyDisciplines] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
