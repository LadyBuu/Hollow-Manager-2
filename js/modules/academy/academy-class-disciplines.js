/**
 * modules/academy/academy-disciplines.js - Academy Disciplines
 * SINGLE SOURCE OF TRUTH for all discipline data and operations
 *
 * Path: js/modules/academy/academy-disciplines.js
 *
 * This module is responsible for:
 *   - Discipline CRUD operations (create, update, delete)
 *   - Discipline queries (get by ID, get all, get available)
 *   - Discipline validation
 *   - Grade scheme ownership (stored on the discipline record)
 *   - Assessment weight ownership (stored on the discipline record)
 *
 * IMPORTANT:
 *   - This module OWNS discipline data - it does NOT depend on AcademyQueries.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *   - This module does NOT call saveData() directly - the pipeline does.
 *
 * STORAGE NAMESPACE (v28):
 *   Disciplines are stored at academy.disciplines, NOT curriculum.disciplines.
 *   The `curriculum` container was retired when the last surviving store
 *   moved under `academy.*`. This module owns the new location.
 *
 *   Reads never create the store. `getAcademyStore()` returns null when
 *   the academy container is missing. `ensureDisciplineStore` creates
 *   structure only inside pipeline mutate() callbacks, on the snapshot.
 *
 * INSTRUCTORS ARE NOT OWNED HERE (v27):
 *   A discipline does not carry `instructorIds`. Instructor-of-a-discipline
 *   is a class-scoped fact expressed through AcademyEnrolments. Callers
 *   that pass `instructorIds` in a create or update payload get a
 *   REJECTION, not a silent drop. Silent acceptance of a retired field
 *   keeps stale callers alive.
 *
 * READ SAFETY:
 *   - Public queries return DEEP CLONES with normalized gradeScheme
 *     and assessmentWeights attached.
 *   - Internal accessors return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData` argument.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input.
 *
 * WEEK SEMANTICS:
 *   - getActiveDisciplines(week) requires a valid week. It does NOT
 *     fall back to window.data.currentWeek.
 *
 * GRADE SCHEME SEMANTICS:
 *   - Each discipline carries a `gradeScheme` object.
 *   - Schemes are FULLY user-editable. Presets only seed the bands.
 *   - A discipline record whose stored gradeScheme is malformed falls
 *     back to the numeric default on read. The fallback is deliberate:
 *     a discipline with no valid scheme is still a discipline, and the
 *     numeric scheme is the safe default. The repair does NOT write to
 *     disk; it only affects what readers see.
 *
 * ASSESSMENT WEIGHTS SEMANTICS:
 *   - Each discipline carries an `assessmentWeights` object: a map
 *     from assessment type to a positive weight.
 *   - Weight is a property of the ASSESSMENT TYPE within a discipline,
 *     not of the individual grade record.
 *   - Canonical shape:
 *       {
 *         exam:          number > 0,
 *         assignment:    number > 0,
 *         participation: number > 0,
 *         quiz:          number > 0,
 *         project:       number > 0,
 *         final:         number > 0
 *       }
 *   - All six keys are always present on a normalized map.
 *   - Malformed persisted values are NOT silently clamped. A weight
 *     that is present but non-numeric, non-finite, or <= 0 causes the
 *     entire map to fall back to the default. Clamping invents a
 *     plausible value for corrupt data, which is worse than falling
 *     back to a scheme the user can see and fix.
 *   - The set of valid keys is owned by AcademyGrades.VALID_GRADE_TYPES.
 *
 * DISPLAY-VS-STORAGE DISTINCTION FOR getGradeScheme / getAssessmentWeights:
 *   Both functions return null when the discipline does not exist:
 *
 *     getGradeScheme('nonexistent')      → null
 *     getAssessmentWeights('nonexistent') → null
 *
 *   A discipline that exists but has no stored scheme returns the
 *   numeric default. A discipline that exists with a malformed stored
 *   scheme also returns the numeric default. The two are distinct from
 *   "discipline missing".
 *
 *   Callers MUST check for null. AcademyPerformance and the grades
 *   editor are the primary consumers; both must handle a missing
 *   discipline explicitly.
 *
 * DELETE CASCADE:
 *   Deleting a discipline is a CASCADE. In a single transaction it:
 *     1. Deletes the discipline from academy.disciplines.
 *     2. Deletes grades keyed to this discipline.
 *     3. Cross-domain cleanup via AcademyCascade.disciplineDeleted,
 *        which handles enrolments, teaching groups, and teaching
 *        sessions.
 *
 *   AcademyCascade is MANDATORY at deletion time. Lazy lookup solves
 *   load order; it does not make the dependency optional. A missing
 *   cascade fails the transaction, because a successful discipline
 *   delete that leaves orphan enrolments, groups, or sessions is worse
 *   than a failed one.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / saveDisciplines all return
 *     Promise<{ success, data?, message? }>
 *   - getDiscipline / getDisciplines / getDisciplinesByType /
 *     getAvailableDisciplines / getActiveDisciplines stay synchronous
 *
 * YEAR SEMANTICS:
 *   - Disciplines are scoped to WEEKS (bounded 1-52), not years.
 *
 * NAME UNIQUENESS (the module's strongest invariant):
 *   Two disciplines may not share a name under normaliseDisciplineName().
 *   This is enforced at:
 *     - create: preflight and pipeline validator
 *     - update: preflight and pipeline validator (when name changes)
 *     - saveDisciplines: preflight and pipeline validator
 *
 *   The pipeline validator is authoritative. The preflight checks exist
 *   for better error messages, not for correctness.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *     (for VALID_GRADE_TYPES; AcademyGrades does not depend on this
 *     module, so there is no cycle)
 *   - window.AcademyCascade (from academy-cascade.js) - LAZY-BUT-MANDATORY
 *     at deletion time
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
    // LAZY DEPENDENCIES
    // ============================================================

    /**
     * Resolve AcademyCascade at call time. The cascade is MANDATORY
     * at deletion time; a missing module fails the transaction.
     */
    function requireAcademyCascade() {
        var Cascade = window.AcademyCascade;
        if (!Cascade || typeof Cascade.disciplineDeleted !== 'function') {
            throw new Error(
                '[AcademyDisciplines] AcademyCascade.disciplineDeleted is ' +
                'required for discipline deletion. Check the script load ' +
                'order in index.html.'
            );
        }
        return Cascade;
    }

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

    // ---- Assessment weights ----

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

    /**
     * Normalise a discipline name for comparison.
     * Trims and lowercases. Empty/invalid input returns ''.
     *
     * This is the SINGLE authority for name comparison in this module.
     * Every uniqueness check goes through it, in preflight and in every
     * pipeline validator.
     */
    function normaliseDisciplineName(name) {
        if (name === null || name === undefined) {
            return '';
        }
        return String(name).trim().toLowerCase();
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

    // ============================================================
    // ASSESSMENT WEIGHT HELPERS
    // ============================================================

    function getValidAssessmentTypes() {
        return AcademyGrades.VALID_GRADE_TYPES.slice();
    }

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
     * Normalise an assessment-weights map.
     *
     * POLICY:
     *   - Missing field (undefined / null / not an object) → defaults.
     *   - Present field that is a valid map → preserved values merged
     *     over the defaults, with each supplied value validated.
     *   - Present field with a MALFORMED value → the whole map falls
     *     back to the defaults. Corrupt persisted data is not silently
     *     clamped into a plausible-looking value.
     *
     *   "Malformed value" means: not a finite number, or <= 0, or
     *   outside [MIN_ASSESSMENT_WEIGHT, MAX_ASSESSMENT_WEIGHT].
     *
     *   This is read-time normalization. The stored record is not
     *   modified. A caller who reads a discipline with a corrupt weight
     *   sees the default; a caller who wants to know the stored value
     *   reads the raw record directly.
     */
    function normalizeAssessmentWeights(raw) {
        var result = {};
        var types = AcademyGrades.VALID_GRADE_TYPES;

        for (var i = 0; i < types.length; i++) {
            result[types[i]] = DEFAULT_ASSESSMENT_WEIGHTS[types[i]];
        }

        if (raw === undefined || raw === null) {
            return result;
        }

        if (typeof raw !== 'object' || Array.isArray(raw)) {
            return result;
        }

        for (var j = 0; j < types.length; j++) {
            var validType = types[j];
            if (!Object.prototype.hasOwnProperty.call(raw, validType)) {
                continue;
            }

            var value = raw[validType];

            if (typeof value !== 'number' ||
                !isFinite(value) ||
                value < MIN_ASSESSMENT_WEIGHT ||
                value > MAX_ASSESSMENT_WEIGHT) {
                // Malformed value on a supplied key. Fall back the
                // whole map rather than silently clamping.
                return getDefaultAssessmentWeights();
            }

            result[validType] = Math.round(value * 10) / 10;
        }

        return result;
    }

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

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    /**
     * Return the live academy store, or null when absent.
     * Reads never create structure.
     */
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

    /**
     * Read the live disciplines array from academy.disciplines, or
     * null when absent. Never creates.
     */
    function getDisciplinesArray() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }
        if (!Array.isArray(academy.disciplines)) {
            return null;
        }
        return academy.disciplines;
    }

    /**
     * Ensure academy.disciplines exists on the given appData snapshot.
     * Only called from inside pipeline mutate() callbacks.
     */
    function ensureDisciplineStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!Array.isArray(appData.academy.disciplines)) {
            appData.academy.disciplines = [];
        }
        return appData.academy.disciplines;
    }

    function getDisciplinesArrayFromSnapshot(appData) {
        if (!appData || !appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        if (!Array.isArray(appData.academy.disciplines)) {
            return null;
        }
        return appData.academy.disciplines;
    }

    // ============================================================
    // INTERNAL DISCIPLINE LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

    function getDisciplineRecord(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var disciplines = getDisciplinesArray();
        if (!disciplines) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && String(d.id) === target) {
                return d;
            }
        }

        return null;
    }

    function getDisciplineRecords() {
        var disciplines = getDisciplinesArray();
        if (!disciplines) {
            return [];
        }

        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d) {
                result.push(d);
            }
        }

        return result;
    }

    function getDisciplineByNameRecord(name) {
        var target = normaliseDisciplineName(name);
        if (target === '') {
            return null;
        }

        var disciplines = getDisciplineRecords();

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && normaliseDisciplineName(d.name) === target) {
                return d;
            }
        }

        return null;
    }

    // ============================================================
    // SNAPSHOT-AWARE LOOKUPS - for pipeline validate() callbacks
    // ============================================================
    //
    // These read from an appData snapshot, not window.data. They are
    // what pipeline validators must use.

    function findDisciplineInSnapshot(appData, id) {
        var disciplines = getDisciplinesArrayFromSnapshot(appData);
        if (!disciplines) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && String(d.id) === target) {
                return d;
            }
        }
        return null;
    }

    /**
     * Does any discipline OTHER than `excludeId` carry the given
     * normalised name in the snapshot?
     *
     * Returns the conflicting record or null.
     */
    function findNameConflictInSnapshot(appData, normalisedName, excludeId) {
        var disciplines = getDisciplinesArrayFromSnapshot(appData);
        if (!disciplines) {
            return null;
        }
        if (normalisedName === '') {
            return null;
        }
        var exclude = (excludeId === undefined || excludeId === null)
            ? null
            : String(excludeId);

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) { continue; }
            if (exclude !== null && String(d.id) === exclude) {
                continue;
            }
            if (normaliseDisciplineName(d.name) === normalisedName) {
                return d;
            }
        }
        return null;
    }

    /**
     * Internal normalization for reads.
     * Ensures `gradeScheme` and `assessmentWeights` are present and
     * canonical on the returned copy. The live record is not modified.
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
    // INSTRUCTOR-FIELD REJECTION
    // ============================================================
    //
    // `instructorIds` was retired in v27. It is not a valid payload
    // field on create or update. Callers that pass it receive a
    // rejection. Silent acceptance keeps stale callers alive.

    var RETIRED_INSTRUCTOR_FIELD_MESSAGE =
        'instructorIds is not a discipline field. Instructor ' +
        'assignment is per-class, expressed through enrolments. ' +
        'Open the character in instructor mode and use the ' +
        'Disciplines tab to assign a discipline to teach.';

    function rejectInstructorIdsField(payload) {
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'instructorIds')) {
            return RETIRED_INSTRUCTOR_FIELD_MESSAGE;
        }
        return null;
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    function validateDisciplineData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        var instructorError = rejectInstructorIdsField(data);
        if (instructorError !== null) {
            return { valid: false, message: instructorError };
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
    //
    // buildDisciplineRecord does NOT read `instructorIds` from data.
    // If a caller passed it, the payload validators rejected the
    // call before we get here.

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

        var scheme;
        if (data.gradeScheme !== undefined && data.gradeScheme !== null) {
            scheme = normalizeGradeScheme(data.gradeScheme);
        } else if (existingScheme !== undefined && existingScheme !== null) {
            scheme = normalizeGradeScheme(existingScheme);
        } else {
            scheme = normalizeGradeScheme(null);
        }

        var weights;
        if (data.assessmentWeights !== undefined && data.assessmentWeights !== null) {
            weights = normalizeAssessmentWeights(data.assessmentWeights);
        } else if (existingWeights !== undefined && existingWeights !== null) {
            weights = normalizeAssessmentWeights(existingWeights);
        } else {
            weights = normalizeAssessmentWeights(null);
        }

        return {
            id: existingId || generateId(),
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
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
    // CASCADE HELPERS - Academy-internal cleanup
    // ============================================================

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
    // PUBLIC API - DISCIPLINE CRUD
    // ============================================================

    /**
     * Create a new discipline.
     *
     * `instructorIds` is NOT accepted. A payload that carries the
     * field is rejected.
     */
    function create(data) {
        var validation = validateDisciplineData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var existing = getDisciplineByNameRecord(data.name);
        if (existing) {
            return Promise.resolve(failure('A discipline with this name already exists.'));
        }

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
        var normalisedNewName = normaliseDisciplineName(newDiscipline.name);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }

                var disciplines = getDisciplinesArrayFromSnapshot(appData);
                if (disciplines) {
                    for (var i = 0; i < disciplines.length; i++) {
                        var d = disciplines[i];
                        if (d && normaliseDisciplineName(d.name) === normalisedNewName) {
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
     *
     * `instructorIds` is NOT accepted.
     */
    function update(id, updates) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var instructorError = rejectInstructorIdsField(updates);
        if (instructorError !== null) {
            return Promise.resolve(failure(instructorError));
        }

        var existing = getDisciplineRecord(id);
        if (!existing) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        var validation = validateDisciplineData(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

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
            if (normaliseDisciplineName(newName) !==
                normaliseDisciplineName(existing.name)) {
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
        var normalisedCandidateName = normaliseDisciplineName(candidate.name);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }

                var disciplines = getDisciplinesArrayFromSnapshot(appData);
                if (!disciplines) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }

                var found = false;
                for (var i = 0; i < disciplines.length; i++) {
                    if (String(disciplines[i].id) === targetId) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }

                var conflict = findNameConflictInSnapshot(
                    appData, normalisedCandidateName, targetId
                );
                if (conflict) {
                    return {
                        valid: false,
                        message: 'A discipline with this name already exists.'
                    };
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
     * CASCADE. In a single transaction it:
     *   1. Deletes the discipline entity.
     *   2. Deletes grades keyed to this discipline.
     *   3. Cross-domain cleanup via AcademyCascade.disciplineDeleted,
     *      which handles enrolments, teaching groups, and teaching
     *      sessions.
     *
     * AcademyCascade is MANDATORY at deletion time. A missing module
     * fails the transaction.
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
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                if (!findDisciplineInSnapshot(appData, target)) {
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

                // ---- 2. Ensure academy structure exists ----
                if (!appData.academy || typeof appData.academy !== 'object') {
                    appData.academy = {};
                }

                // ---- 3. Academy-internal cleanup ----
                var gradesRemoved = stripDisciplineFromGrades(appData, target);

                // ---- 4. Cross-domain cascade (MANDATORY) ----
                var Cascade = requireAcademyCascade();
                var cascade = Cascade.disciplineDeleted(appData, target);

                return {
                    deleted: true,
                    discipline: disciplineInfo,
                    academy: {
                        gradesRemoved: gradesRemoved
                    },
                    academyCascade: cascade
                };
            },
            logMessage: function(result) {
                var parts = [];

                var a = result.academy || {};
                if (a.gradesRemoved > 0) parts.push(a.gradesRemoved + ' grade(s)');

                if (result.academyCascade) {
                    var Cascade = requireAcademyCascade();
                    if (typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(result.academyCascade);
                        if (summary) {
                            parts.push(summary.replace(/^\(|\)$/g, ''));
                        }
                    }
                }

                var suffix = parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
                return 'Deleted discipline: ' + existing.name + suffix;
            },
            successMessage: 'Discipline deleted successfully!',
            failureMessage: 'Failed to delete discipline.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

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
     * window.data.currentWeek.
     */
    function getActiveDisciplines(currentWeek) {
        var week = CalendarValidation.parseWeek(currentWeek);
        if (week === null) {
            return [];
        }

        return getAvailableDisciplines(week);
    }

    /**
     * Get the grade scheme for a discipline.
     *
     * Returns:
     *   null                  when the discipline does not exist
     *   normalized scheme     when the discipline exists (defaulting
     *                          to numeric if the stored scheme is
     *                          missing or malformed)
     *
     * The distinction matters: a missing discipline is not the same
     * as a discipline that deliberately uses the default scheme.
     * Callers must check for null.
     */
    function getGradeScheme(id) {
        var record = getDisciplineRecord(id);
        if (!record) {
            return null;
        }
        return normalizeGradeScheme(record.gradeScheme);
    }

    /**
     * Get the assessment weights for a discipline.
     *
     * Returns:
     *   null              when the discipline does not exist
     *   normalized map    when the discipline exists (defaulting
     *                      to the default map if the stored map is
     *                      missing or malformed)
     *
     * Same distinction as getGradeScheme.
     */
    function getAssessmentWeights(id) {
        var record = getDisciplineRecord(id);
        if (!record) {
            return null;
        }
        return normalizeAssessmentWeights(record.assessmentWeights);
    }

    function getDefaultAssessmentWeightsPublic() {
        return getDefaultAssessmentWeights();
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================
    //
    // PLAN / APPLY:
    //   1. Preflight. Validate each entry. Detect within-batch
    //      duplicates. Detect collisions with existing disciplines.
    //      Build a plan of create/update/skip.
    //   2. Pipeline validate. Verify the plan against the snapshot:
    //        - every update target still exists
    //        - every create ID is still free
    //        - the POST-MUTATION name set is unique
    //   3. Pipeline mutate. Apply the plan.

    function saveDisciplines(disciplinesData, options) {
        if (!Array.isArray(disciplinesData) || disciplinesData.length === 0) {
            return Promise.resolve(failure('Discipline data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var planned = [];
        var errors = [];
        var batchNames = Object.create(null);

        for (var i = 0; i < disciplinesData.length; i++) {
            var data = disciplinesData[i];

            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid discipline data.' });
                continue;
            }

            // Reject the retired instructor field at the batch level
            // too, so the whole call fails rather than silently
            // skipping the offending entry.
            var instructorError = rejectInstructorIdsField(data);
            if (instructorError !== null) {
                return Promise.resolve(failure(instructorError));
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

            var normalised = normaliseDisciplineName(data.name);
            if (batchNames[normalised]) {
                errors.push({
                    index: i,
                    error: 'Duplicate name within batch: "' +
                        data.name + '" (first seen at index ' +
                        batchNames[normalised].index + ').'
                });
                continue;
            }
            batchNames[normalised] = { index: i };

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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }

                var snapshotDisciplines = getDisciplinesArrayFromSnapshot(appData);
                if (!snapshotDisciplines) {
                    snapshotDisciplines = [];
                }

                // ---- 1. Update targets must exist ----
                for (var u = 0; u < updates.length; u++) {
                    var updateItem = updates[u];
                    if (!findDisciplineInSnapshot(appData, updateItem.matchId)) {
                        return {
                            valid: false,
                            message: 'Discipline no longer exists: ' +
                                updateItem.matchId
                        };
                    }
                }

                // ---- 2. Create IDs must not collide ----
                for (var c = 0; c < creates.length; c++) {
                    if (findDisciplineInSnapshot(appData, creates[c].record.id)) {
                        return {
                            valid: false,
                            message: 'Discipline ID collision: ' +
                                creates[c].record.id
                        };
                    }
                }

                // ---- 3. Post-mutation name set must be unique ----
                var updateIds = Object.create(null);
                for (var ui = 0; ui < updates.length; ui++) {
                    updateIds[String(updates[ui].matchId)] = true;
                }

                var seenNames = Object.create(null);

                for (var s = 0; s < snapshotDisciplines.length; s++) {
                    var d = snapshotDisciplines[s];
                    if (!d) { continue; }
                    if (updateIds[String(d.id)]) { continue; }

                    var key = normaliseDisciplineName(d.name);
                    if (key === '') { continue; }
                    if (seenNames[key]) {
                        return {
                            valid: false,
                            message: 'Duplicate discipline name in ' +
                                'resulting store: "' + d.name + '".'
                        };
                    }
                    seenNames[key] = true;
                }

                for (var ui2 = 0; ui2 < updates.length; ui2++) {
                    var uRec = updates[ui2].record;
                    var uKey = normaliseDisciplineName(uRec.name);
                    if (uKey === '') { continue; }
                    if (seenNames[uKey]) {
                        return {
                            valid: false,
                            message: 'Duplicate discipline name in ' +
                                'resulting store: "' + uRec.name + '".'
                        };
                    }
                    seenNames[uKey] = true;
                }

                for (var ci = 0; ci < creates.length; ci++) {
                    var cRec = creates[ci].record;
                    var cKey = normaliseDisciplineName(cRec.name);
                    if (cKey === '') { continue; }
                    if (seenNames[cKey]) {
                        return {
                            valid: false,
                            message: 'Duplicate discipline name in ' +
                                'resulting store: "' + cRec.name + '".'
                        };
                    }
                    seenNames[cKey] = true;
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

    window.AcademyDisciplines = Object.freeze({
        // ---- Mutations ----
        create: create,
        update: update,
        delete: deleteDiscipline,
        saveDisciplines: saveDisciplines,

        // ---- Public queries ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getDisciplinesByType: getDisciplinesByType,
        getAvailableDisciplines: getAvailableDisciplines,
        getActiveDisciplines: getActiveDisciplines,

        // ---- Grade scheme helpers ----
        getGradeScheme: getGradeScheme,

        // ---- Assessment weight helpers ----
        getAssessmentWeights: getAssessmentWeights,
        getDefaultAssessmentWeights: getDefaultAssessmentWeightsPublic,
        isDefaultAssessmentWeights: isDefaultAssessmentWeights,
        getValidAssessmentTypes: getValidAssessmentTypes,

        // ---- Internal ----
        getDisciplineRecord: getDisciplineRecord,
        getDisciplineRecords: getDisciplineRecords,
        getDisciplineByNameRecord: getDisciplineByNameRecord,

        // ---- Name comparison authority ----
        normaliseDisciplineName: normaliseDisciplineName,

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
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplines;
        var missing = [];

        var required = [
            'create', 'update', 'delete', 'saveDisciplines',
            'getDiscipline', 'getDisciplines', 'getDisciplinesByType',
            'getAvailableDisciplines',
            'getActiveDisciplines',
            'getGradeScheme',
            'getAssessmentWeights', 'getDefaultAssessmentWeights',
            'isDefaultAssessmentWeights', 'getValidAssessmentTypes',
            'getDisciplineRecord', 'getDisciplineRecords', 'getDisciplineByNameRecord',
            'normaliseDisciplineName'
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
