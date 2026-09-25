/**
 * modules/academy/academy-class-disciplines-queries.js
 * Academy Class-Disciplines Queries
 *
 * Path: js/modules/academy/academy-class-disciplines-queries.js
 *
 * READ-ONLY surface for the class-discipline marker store.
 *
 * The marker store is:
 *
 *   data.academy.classDisciplines[classId][disciplineId] = {
 *     classId,
 *     disciplineId,
 *     mandatory,
 *     createdAt,
 *     updatedAt
 *   }
 *
 * The marker has no window. The discipline owns startWeek / endWeek.
 * Every window question in this module reads the DISCIPLINE, not the
 * marker. `isActiveInWeek` and `getActiveClassDisciplinesForWeek`
 * both delegate to RangeUtils.containsWeek, which is the canonical
 * range-containment predicate for the whole application.
 *
 * WHY THIS MODULE EXISTS:
 *   The class-discipline store is read by aggregators, the teaching
 *   projector, the teaching validator, the class-disciplines picker,
 *   the enrollment modal, and the schedule coordinator. It is written
 *   by exactly one module: AcademyClassDisciplines. Before this
 *   split, reads and mutations lived in the same file, and callers
 *   that only wanted to ask "does this class offer English?" had to
 *   import a module that also exposed MutationPipeline calls. The
 *   split makes the read surface importable in isolation.
 *
 * DEPENDENCY DIRECTION:
 *   This module has no dependency on AcademyClassDisciplines.
 *   AcademyClassDisciplines depends on THIS module for preflight
 *   reads (`hasClassDiscipline`, `getClassDiscipline`) and for the
 *   reference validator used at mutation entry.
 *
 *   The direction is one-way:
 *
 *     callers → AcademyClassDisciplinesQueries  (reads)
 *     callers → AcademyClassDisciplines         (writes)
 *     AcademyClassDisciplines → AcademyClassDisciplinesQueries
 *                                              (preflight reads)
 *
 *   This module never reads from, calls into, or references the
 *   mutation module. Do not add such a reference; it would create
 *   a load-order cycle.
 *
 * READ SAFETY:
 *   - Reads never create the store. `getStore()` and
 *     `getStoreFromSnapshot()` return null when the store is
 *     missing. Neither creates structure.
 *   - Public reads return DEEP CLONES.
 *   - Internal reads (the `*Internal` accessors, exposed for the
 *     mutation module's preflight and cascade helpers) return LIVE
 *     REFERENCES from the store.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input. No silent fallback.
 *
 * RANGE PREDICATES:
 *   The week-in-range question delegates to RangeUtils.containsWeek.
 *   This module does not reimplement range math; the canonical
 *   predicate lives in one place on purpose.
 *
 * DISCIPLINE ACCESSOR — LIVE REFERENCE IN getDisciplineWindow:
 *   getDisciplineWindow reads exactly two scalar fields
 *   (startWeek, endWeek) and returns a fresh two-field object. It
 *   uses AcademyDisciplines.getDisciplineRecord (live reference),
 *   NOT AcademyDisciplines.getDiscipline (deep clone).
 *
 *   Using getDiscipline here would clone the entire discipline
 *   record — including its gradeScheme bands array and its
 *   assessmentWeights object — on every call. isActiveInWeek is
 *   called once per (student, offering) in several Academy render
 *   paths. Each call would pay that clone cost for two numbers.
 *
 *   The live reference is safe: getDisciplineWindow does not
 *   mutate the record, does not return it, and does not hold it
 *   past the function. Every caller receives a fresh object with
 *   two copied numbers.
 *
 *   Do not "helpfully" change this back to getDiscipline without
 *   understanding the cost. The header comment on the function
 *   states the same thing locally.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils          (deepClone)
 *   - window.ValidationUtils      (isNonEmptyString)
 *   - window.CalendarValidation   (parseWeek)
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)
 *   - window.RangeUtils           (containsWeek)
 *   - window.AcademyClasses       (class existence, class reads)
 *   - window.AcademyDisciplines   (discipline existence, config)
 *
 * USAGE:
 *   var Q = window.AcademyClassDisciplinesQueries;
 *
 *   Q.getClassDiscipline('class_1', 'disc_english');   // marker or null
 *   Q.getAllOfferedDisciplineIds('class_1');           // ['disc_english', ...]
 *   Q.hasClassDiscipline('class_1', 'disc_english');   // boolean
 *   Q.isActiveInWeek('class_1', 'disc_english', 5);    // discipline window check
 *   Q.getEffectiveConfig('class_1', 'disc_english');   // discipline config
 */

(function() {
    'use strict';

    if (window.__academyClassDisciplinesQueriesLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var RangeUtils = window.RangeUtils;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils ||
        typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!RangeUtils ||
        typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDisciplineRecord !== 'function') {
        _missing.push('AcademyDisciplines.getDisciplineRecord');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplinesQueries] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesQueriesLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[AcademyClassDisciplinesQueries] deepClone returned ' +
                'the original reference.'
            );
        }
        return result;
    }

    /**
     * Parse a week strictly. Returns an integer in [MIN_WEEK, MAX_WEEK]
     * or null. Used only by isActiveInWeek and the active-filter
     * helper; the marker itself has no window.
     */
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

    // ============================================================
    // STORE ACCESS
    // ============================================================
    //
    // READ SAFETY: neither accessor creates structure. A missing
    // store returns null; every caller below handles null.

    /**
     * Return the live classDisciplines store from window.data, or
     * null when absent. Never creates it.
     */
    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy ||
            typeof window.data.academy !== 'object') {
            return null;
        }
        var store = window.data.academy.classDisciplines;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    /**
     * Same as getStore, but reads from an appData snapshot.
     */
    function getStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.classDisciplines;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    // ============================================================
    // INTERNAL READS — LIVE REFERENCES
    // ============================================================
    //
    // These are the accessors the mutation module uses for preflight
    // reads and for its cascade helpers. They return LIVE references
    // from the store; the caller is expected to clone or to operate
    // on them directly as a mutation-context read.

    function getRecordInternalFromStore(store, classId, disciplineId) {
        if (!store ||
            !isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return null;
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return null;
        }
        var record = byClass[String(disciplineId)];
        if (!isPlainObject(record)) {
            return null;
        }
        return record;
    }

    function getRecordInternal(classId, disciplineId) {
        return getRecordInternalFromStore(
            getStore(),
            classId,
            disciplineId
        );
    }

    function getRecordsForClassInternalFromStore(store, classId) {
        var result = [];
        if (!store || !isNonEmptyString(classId)) {
            return result;
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) {
            return result;
        }
        var keys = Object.keys(byClass);
        for (var i = 0; i < keys.length; i++) {
            var record = byClass[keys[i]];
            if (isPlainObject(record)) {
                result.push(record);
            }
        }
        return result;
    }

    function getRecordsForClassInternal(classId) {
        return getRecordsForClassInternalFromStore(
            getStore(),
            classId
        );
    }

    // ============================================================
    // DISCIPLINE WINDOW HELPERS
    // ============================================================
    //
    // The marker has no window. The discipline does. This helper
    // reads the discipline's startWeek / endWeek and returns a
    // { startWeek, endWeek } pair, or null when the discipline
    // cannot supply one.
    //
    // LIVE REFERENCE, NOT A CLONE:
    //   AcademyDisciplines exposes two accessors: getDiscipline
    //   (public, returns a deep clone with normalized gradeScheme
    //   and assessmentWeights) and getDisciplineRecord (internal,
    //   returns the live record). This helper reads exactly two
    //   scalar fields — startWeek, endWeek — and returns a fresh
    //   two-field object. It never returns the discipline, never
    //   mutates it, and never holds the reference past the function.
    //
    //   Using getDiscipline here would clone the entire record
    //   (gradeScheme bands, assessmentWeights, timestamps) on every
    //   call. isActiveInWeek is called once per (student, offering)
    //   in several Academy render paths, and each call would pay
    //   that clone cost for two numbers. The clone is not just
    //   wasteful; it is a measurable per-call allocation on the
    //   discipline-view render path.
    //
    //   getDisciplineRecord is the correct accessor for a read of
    //   this shape. It is exposed by AcademyDisciplines for exactly
    //   this purpose.
    //
    // The containment check itself is not performed here; callers
    // pass the returned window to RangeUtils.containsWeek.

    function getDisciplineWindow(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }
        var discipline = AcademyDisciplines.getDisciplineRecord(
            disciplineId
        );
        if (!discipline) {
            return null;
        }

        var startWeek = parseWeekStrict(discipline.startWeek);
        var endWeek = null;
        if (discipline.endWeek !== undefined &&
            discipline.endWeek !== null &&
            discipline.endWeek !== '') {
            endWeek = parseWeekStrict(discipline.endWeek);
        }

        if (startWeek === null) {
            return null;
        }

        return { startWeek: startWeek, endWeek: endWeek };
    }

    // ============================================================
    // VALIDATION
    // ============================================================
    //
    // Preflight validation used by the mutation module at its
    // entry points. This module does not perform validation on the
    // write path; it exposes the check so the mutation module and
    // any future callers can share one implementation.

    function validateReference(classId, disciplineId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return { valid: false, message: 'Class not found.' };
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return { valid: false, message: 'Discipline not found.' };
        }

        return { valid: true, class: cls, discipline: discipline };
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    /**
     * Get the marker record for a (classId, disciplineId) pair, or
     * null if the class does not offer the discipline.
     *
     * @returns {object|null} { classId, disciplineId, mandatory,
     *   createdAt, updatedAt } or null
     */
    function getClassDiscipline(classId, disciplineId) {
        var record = getRecordInternal(classId, disciplineId);
        return record ? deepClone(record) : null;
    }

    /**
     * Get every marker the class owns.
     *
     * @returns {array} Array of marker records (clones). Empty when
     *   the class offers nothing or does not exist.
     */
    function getClassDisciplinesForClass(classId) {
        var records = getRecordsForClassInternal(classId);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    /**
     * Get every marker across every class for a given discipline.
     * Useful for "which classes offer English?"
     *
     * @returns {array} Array of marker records (clones). Empty when
     *   no class offers the discipline.
     */
    function getClassDisciplinesForDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }
        var store = getStore();
        if (!store) {
            return [];
        }
        var result = [];
        var target = String(disciplineId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) {
                continue;
            }
            var record = byClass[target];
            if (isPlainObject(record)) {
                result.push(deepClone(record));
            }
        }
        return result;
    }

    /**
     * Does the class offer the discipline?
     */
    function hasClassDiscipline(classId, disciplineId) {
        return getRecordInternal(classId, disciplineId) !== null;
    }

    /**
     * Alias of hasClassDiscipline with a name that reads better at
     * the picker's call sites. "Is this class offering English?" is
     * clearer than "does this class-discipline exist?"
     */
    function isClassOffering(classId, disciplineId) {
        return getRecordInternal(classId, disciplineId) !== null;
    }

    /**
     * Get the discipline IDs this class offers. Deduplicated, but the
     * store is keyed by disciplineId so there is nothing to
     * deduplicate. Returned in insertion order (the order keys were
     * added to the class bucket).
     *
     * @returns {array} Array of discipline ID strings
     */
    function getAllOfferedDisciplineIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var byClass = null;
        var store = getStore();
        if (store) {
            byClass = store[String(classId)];
        }
        if (!isPlainObject(byClass)) {
            return [];
        }
        return Object.keys(byClass);
    }

    /**
     * Is this class-discipline active in the given week?
     *
     * Under v27 the window comes from the DISCIPLINE, not from the
     * marker. A marker with no discipline behind it is inactive, and
     * a marker whose discipline has no valid startWeek is inactive.
     *
     * The containment check itself delegates to
     * RangeUtils.containsWeek, which is the canonical
     * "is this week in this range" predicate.
     *
     * @returns {boolean}
     */
    function isActiveInWeek(classId, disciplineId, week) {
        if (!getRecordInternal(classId, disciplineId)) {
            return false;
        }

        var window = getDisciplineWindow(disciplineId);
        if (!window) {
            return false;
        }

        return RangeUtils.containsWeek(
            week,
            window.startWeek,
            window.endWeek
        );
    }

    /**
     * Return every class-discipline for a class that is active in
     * the given week.
     *
     * @returns {array} Array of marker records (clones)
     */
    function getActiveClassDisciplinesForWeek(classId, week) {
        var records = getRecordsForClassInternal(classId);
        var result = [];

        for (var i = 0; i < records.length; i++) {
            var record = records[i];
            var window = getDisciplineWindow(record.disciplineId);
            if (!window) {
                continue;
            }
            if (!RangeUtils.containsWeek(
                week,
                window.startWeek,
                window.endWeek
            )) {
                continue;
            }
            result.push(deepClone(record));
        }

        return result;
    }

    /**
     * Resolve the effective configuration for a class-discipline.
     *
     * Under v27 there is no per-class override. The effective config
     * IS the discipline's config. This function exists so that
     * callers which previously relied on the merge still work
     * unchanged; the return shape is preserved for the fields those
     * callers read.
     *
     * The returned object carries the discipline's startWeek,
     * endWeek, weeklyHours, weight, gradeSchemeId, and
     * assessmentWeights, plus the marker's classId, disciplineId,
     * and mandatory flag.
     *
     * @returns {object|null} config, or null when the marker or the
     *   discipline is missing
     */
    function getEffectiveConfig(classId, disciplineId) {
        var record = getRecordInternal(classId, disciplineId);
        if (!record) {
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        // Normalised read path. AcademyDisciplines.getDiscipline
        // already normalises gradeScheme and assessmentWeights on
        // read, so we pass them through. The other fields are read
        // directly.

        return {
            classId: String(classId),
            disciplineId: String(disciplineId),
            mandatory: record.mandatory === true,

            // From the discipline:
            startWeek: discipline.startWeek,
            endWeek: discipline.endWeek,
            weeklyHours: discipline.weeklyHours,
            weight: discipline.weight,
            gradeSchemeId: isNonEmptyString(discipline.gradeSchemeId)
                ? discipline.gradeSchemeId
                : (discipline.gradeScheme && isNonEmptyString(discipline.gradeScheme.id)
                    ? discipline.gradeScheme.id
                    : 'numeric'),
            assessmentWeights: discipline.assessmentWeights
                ? deepClone(discipline.assessmentWeights)
                : null,
            gradeScheme: discipline.gradeScheme
                ? deepClone(discipline.gradeScheme)
                : null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassDisciplinesQueries = Object.freeze({
        // Public reads
        getClassDiscipline: getClassDiscipline,
        getClassDisciplinesForClass: getClassDisciplinesForClass,
        getClassDisciplinesForDiscipline: getClassDisciplinesForDiscipline,
        hasClassDiscipline: hasClassDiscipline,
        isClassOffering: isClassOffering,
        getAllOfferedDisciplineIds: getAllOfferedDisciplineIds,
        getEffectiveConfig: getEffectiveConfig,
        isActiveInWeek: isActiveInWeek,
        getActiveClassDisciplinesForWeek: getActiveClassDisciplinesForWeek,

        // Store accessors (read-only; never create)
        getStore: getStore,
        getStoreFromSnapshot: getStoreFromSnapshot,

        // Internal reads (LIVE REFERENCES — for the mutation module
        // and cascade helpers)
        getRecordInternal: getRecordInternal,
        getRecordInternalFromStore: getRecordInternalFromStore,
        getRecordsForClassInternal: getRecordsForClassInternal,
        getRecordsForClassInternalFromStore: getRecordsForClassInternalFromStore,

        // Reference validator (shared with the mutation module)
        validateReference: validateReference,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyClassDisciplinesQueries;
        var missing = [];

        var required = [
            'getClassDiscipline',
            'getClassDisciplinesForClass',
            'getClassDisciplinesForDiscipline',
            'hasClassDiscipline',
            'isClassOffering',
            'getAllOfferedDisciplineIds',
            'getEffectiveConfig',
            'isActiveInWeek',
            'getActiveClassDisciplinesForWeek',
            'getStore',
            'getStoreFromSnapshot',
            'getRecordInternal',
            'getRecordInternalFromStore',
            'getRecordsForClassInternal',
            'getRecordsForClassInternalFromStore',
            'validateReference'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test the RangeUtils delegation via the same
        // semantics the module depends on. A failure here means the
        // delegation is broken or RangeUtils is not loaded.
        try {
            if (RangeUtils.containsWeek(5, 1, 10) !== true) {
                missing.push('RangeUtils.containsWeek active-in-range failed');
            }
            if (RangeUtils.containsWeek(10, 1, 10) !== true) {
                missing.push('RangeUtils.containsWeek inclusive end failed');
            }
            if (RangeUtils.containsWeek(11, 1, 10) !== false) {
                missing.push('RangeUtils.containsWeek past-end failed');
            }
            if (RangeUtils.containsWeek(52, 1, null) !== true) {
                missing.push('RangeUtils.containsWeek open end failed');
            }
        } catch (e) {
            missing.push('range-delegation smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyClassDisciplinesQueries] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
