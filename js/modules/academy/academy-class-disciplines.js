/**
 * modules/academy/academy-class-disciplines.js
 * Academy Class-Disciplines — MARKER-ONLY STORE
 *
 * Path: js/modules/academy/academy-class-disciplines.js
 *
 * WHAT THIS MODULE OWNS:
 *   The relationship between a Graduating Class and a Discipline.
 *   A class "offers" a discipline. That is the whole fact. There is
 *   no per-class config, no per-class window, no per-class instructor
 *   list. The class either offers the discipline or it does not.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Discipline global definitions       (AcademyDisciplines)
 *   - Student OR instructor enrolment     (AcademyEnrolments)
 *   - Teaching relationships              (AcademyTeachingGroups)
 *   - Recurring meetings                  (AcademyTeachingSessions)
 *   - Compound operations across stores   (AcademySchedule)
 *
 * THE MARKER RECORD:
 *
 *   data.academy.classDisciplines[classId][disciplineId] = {
 *     classId,
 *     disciplineId,
 *     mandatory,        // per-class: is this offering mandatory?
 *     createdAt,
 *     updatedAt
 *   }
 *
 *   Every other field that used to live on this record is gone:
 *   startWeek, endWeek, weeklyHours, weight, gradeSchemeId,
 *   assessmentWeights, instructorIds. The discipline entity carries
 *   startWeek, endWeek, weeklyHours, weight, gradeScheme, and
 *   assessmentWeights. Instructor assignment is expressed through
 *   AcademyEnrolments, not through this record.
 *
 * WHY MARKER-ONLY:
 *   Disciplines are GLOBAL. One "English", one grade scheme, one set
 *   of assessment weights. Config lives on the discipline. A class
 *   that offers English does not get to redefine what English is;
 *   it only says "we teach this."
 *
 * WEEK SEMANTICS (v27):
 *   The marker has no window. `isActiveInWeek(classId, disciplineId,
 *   week)` reads the DISCIPLINE's startWeek / endWeek. A discipline
 *   with startWeek 1 and endWeek 24 is active in weeks 1–24 for every
 *   class that offers it.
 *
 *   `getActiveClassDisciplinesForWeek(classId, week)` filters the
 *   class's offered disciplines by the same rule.
 *
 * RANGE PREDICATES (v27):
 *   The window-containment check delegates to
 *   `RangeUtils.containsWeek`, which is the canonical
 *   "does this range contain this week" predicate for the whole
 *   application. This module does not reimplement range math.
 *
 * EFFECTIVE CONFIG (v27):
 *   `getEffectiveConfig(classId, disciplineId)` returns the
 *   discipline's config. There is no per-class override. Callers
 *   that used to read `weeklyHours` off the merged config still read
 *   `weeklyHours` — only the source changed, from "merge" to "read
 *   the discipline."
 *
 * MUTATION CONTRACT:
 *   - setClassDiscipline        create or replace the marker.
 *   - removeClassDiscipline     hard delete the marker.
 *
 *   Both return Promise<{ success, data?, message? }>.
 *   Both go through MutationPipeline.
 *
 *   Update and end are gone. A marker has nothing to update beyond
 *   `mandatory`, and there is no window to end. Changing `mandatory`
 *   is a setClassDiscipline call with the new value. "Stopping the
 *   offering" is a removeClassDiscipline call, optionally preceded
 *   by ending every downstream enrolment, teaching group, and
 *   session — which is what AcademySchedule.removeClassDiscipline
 *   does.
 *
 * CASCADE SEMANTICS:
 *   stripClassRefs and stripDisciplineRefs are PURE with respect to
 *   appData: they mutate the snapshot, never touch window.data, and
 *   never throw. They run inside another module's pipeline
 *   transaction (AcademyCascade).
 *
 *   Both helpers now also cascade into AcademyEnrolments'
 *   corresponding strip functions. An offering that is removed
 *   should not leave orphan enrolment intervals behind, and a
 *   discipline that is deleted should not leave orphan enrolment
 *   intervals behind. The delegations are guarded so that a missing
 *   AcademyEnrolments module is a no-op rather than a crash.
 *
 * READ SAFETY:
 *   - Reads never create the store.
 *   - Public reads return DEEP CLONES.
 *   - Internal accessors used inside pipeline callbacks return live
 *     references from the appData snapshot.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils          (deepClone)
 *   - window.ValidationUtils      (isNonEmptyString)
 *   - window.CalendarValidation   (parseWeek)
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)
 *   - window.RangeUtils           (containsWeek)
 *   - window.MutationPipeline     (performMutation)
 *   - window.AcademyClasses       (getClass)
 *   - window.AcademyDisciplines   (getDiscipline)
 *
 * DEPENDENCIES (LAZY, used only by the cascade helpers):
 *   - window.AcademyEnrolments    (stripClassRefs, stripDisciplineRefs)
 *     When absent, the corresponding cascade step is skipped.
 *
 * USAGE:
 *   var ACD = window.AcademyClassDisciplines;
 *
 *   ACD.getClassDiscipline('class_1', 'disc_english');  // marker or null
 *   ACD.getAllOfferedDisciplineIds('class_1');          // ['disc_english', ...]
 *   ACD.isClassOffering('class_1', 'disc_english');     // boolean
 *   ACD.isActiveInWeek('class_1', 'disc_english', 5);   // discipline window check
 *   ACD.getEffectiveConfig('class_1', 'disc_english');  // discipline config
 *
 *   ACD.setClassDiscipline('class_1', 'disc_english', {
 *       mandatory: true
 *   }).then(function(r) { ... });
 *
 *   ACD.removeClassDiscipline('class_1', 'disc_english')
 *       .then(function(r) { ... });
 */

(function() {
    'use strict';

    if (window.__academyClassDisciplinesLoaded) {
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
    var MutationPipeline = window.MutationPipeline;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!ValidationUtils || typeof ValidationUtils.isNonEmptyString !== 'function') {
        _missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
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
    if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplines] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESSOR
    // ============================================================
    //
    // AcademyEnrolments is used only by the cascade helpers. It is
    // resolved at call time so that load order does not require the
    // enrolments module to be present before this one.

    function getAcademyEnrolments() {
        return window.AcademyEnrolments || null;
    }

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
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyClassDisciplines] deepClone returned the original reference.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
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

    /**
     * Return the live classDisciplines store from window.data, or
     * null when absent. Never creates it.
     */
    function getStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
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

    /**
     * Ensure the classDisciplines store exists on an appData
     * snapshot. Only call from inside a pipeline mutate() callback.
     */
    function ensureStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.classDisciplines ||
            typeof appData.academy.classDisciplines !== 'object' ||
            Array.isArray(appData.academy.classDisciplines)) {
            appData.academy.classDisciplines = {};
        }
        return appData.academy.classDisciplines;
    }

    // ============================================================
    // INTERNAL READS - LIVE REFERENCES
    // ============================================================

    function getRecordInternalFromStore(store, classId, disciplineId) {
        if (!store || !isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
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
        return getRecordInternalFromStore(getStore(), classId, disciplineId);
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
        return getRecordsForClassInternalFromStore(getStore(), classId);
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
    // The containment check itself is not performed here; callers
    // pass the returned window to RangeUtils.containsWeek. That
    // keeps the range math in one place.

    function getDisciplineWindow(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }
        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
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
    // MARKER CANDIDATE BUILDER
    // ============================================================

    function buildMarker(classId, disciplineId, config, existingRecord) {
        var now = new Date().toISOString();
        var discipline = AcademyDisciplines.getDiscipline(disciplineId);

        var mandatory;
        if (config && typeof config.mandatory === 'boolean') {
            mandatory = config.mandatory;
        } else if (existingRecord && typeof existingRecord.mandatory === 'boolean') {
            mandatory = existingRecord.mandatory;
        } else if (discipline && discipline.type === 'mandatory') {
            mandatory = true;
        } else {
            mandatory = false;
        }

        return {
            classId: String(classId),
            disciplineId: String(disciplineId),
            mandatory: mandatory,
            createdAt: (existingRecord && isNonEmptyString(existingRecord.createdAt))
                ? existingRecord.createdAt
                : now,
            updatedAt: now
        };
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Create or replace the marker for a (classId, disciplineId)
     * pair.
     *
     * The marker has two meaningful fields: `mandatory` and the
     * identity pair. Calling setClassDiscipline on an existing
     * marker updates its `mandatory` flag and its `updatedAt`. It
     * does NOT touch enrolments, teaching groups, or teaching
     * sessions. Those are separate concerns.
     *
     * @param {string} classId
     * @param {string} disciplineId
     * @param {object} [config] { mandatory?: boolean }
     * @returns {Promise<{success, data?, message?}>}
     */
    function setClassDiscipline(classId, disciplineId, config) {
        var refCheck = validateReference(classId, disciplineId);
        if (!refCheck.valid) {
            return Promise.resolve(failure(refCheck.message));
        }

        config = isPlainObject(config) ? config : {};

        if (config.mandatory !== undefined &&
            typeof config.mandatory !== 'boolean') {
            return Promise.resolve(failure('Mandatory must be a boolean.'));
        }

        var existing = getRecordInternal(classId, disciplineId);
        var candidate = buildMarker(
            classId, disciplineId, config, existing
        );

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }
                store[targetClass][targetDiscipline] = deepClone(candidate);
                return { record: candidate };
            },
            logMessage: 'Set class-discipline: ' +
                (refCheck.class.name || targetClass) + ' / ' +
                (refCheck.discipline.name || targetDiscipline),
            successMessage: 'Class-discipline saved.',
            failureMessage: 'Failed to save class-discipline.'
        });
    }

    /**
     * Hard delete the marker for a (classId, disciplineId) pair.
     *
     * Does not touch enrolments, teaching groups, or teaching
     * sessions. Callers that want a compound teardown use
     * AcademySchedule.removeClassDiscipline, which does all of the
     * above in one transaction.
     *
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeClassDiscipline(classId, disciplineId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure(
                'Class ID and discipline ID are required.'
            ));
        }

        var existing = getRecordInternal(classId, disciplineId);
        if (!existing) {
            return Promise.resolve(failure(
                'Class-discipline not found.'
            ));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    return { removed: false };
                }
                var byClass = store[targetClass];
                if (!isPlainObject(byClass)) {
                    return { removed: false };
                }
                if (!Object.prototype.hasOwnProperty.call(
                    byClass, targetDiscipline
                )) {
                    return { removed: false };
                }
                delete byClass[targetDiscipline];
                if (Object.keys(byClass).length === 0) {
                    delete store[targetClass];
                }
                return { removed: true };
            },
            logMessage: 'Removed class-discipline: ' +
                targetClass + ' / ' + targetDiscipline,
            successMessage: 'Class-discipline removed.',
            failureMessage: 'Failed to remove class-discipline.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================
    //
    // Pure with respect to appData. Mutate the snapshot. Never touch
    // window.data. Never throw. Run inside another module's pipeline
    // transaction (AcademyCascade).

    /**
     * Remove every class-discipline belonging to a class, and
     * cascade into enrolments for that class.
     *
     * The enrolment cascade is delegated to
     * AcademyEnrolments.stripClassRefs. When AcademyEnrolments is
     * not loaded, the enrolment step is skipped and only the marker
     * store is cleaned.
     *
     * @returns {object} { recordsRemoved, enrolmentsCascade }
     */
    function stripClassRefs(appData, classId) {
        var result = {
            recordsRemoved: 0,
            enrolmentsCascade: null
        };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (store) {
            var target = String(classId);
            if (Object.prototype.hasOwnProperty.call(store, target)) {
                var byClass = store[target];
                if (isPlainObject(byClass)) {
                    result.recordsRemoved = Object.keys(byClass).length;
                }
                delete store[target];
            }
        }

        // Cascade into enrolments. The enrolments module owns its
        // own strip helper; we delegate rather than reimplement.
        var AE = getAcademyEnrolments();
        if (AE && typeof AE.stripClassRefs === 'function') {
            try {
                result.enrolmentsCascade = AE.stripClassRefs(appData, classId);
            } catch (e) {
                // Never propagate from a cascade helper.
                result.enrolmentsCascade = {
                    error: String(e && e.message || e)
                };
            }
        }

        return result;
    }

    /**
     * Remove every class-discipline for a given discipline ID, and
     * cascade into enrolments for that discipline.
     *
     * @returns {object} { recordsRemoved, enrolmentsCascade }
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = {
            recordsRemoved: 0,
            enrolmentsCascade: null
        };

        if (!appData || !isNonEmptyString(disciplineId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (store) {
            var target = String(disciplineId);
            var classIds = Object.keys(store);
            for (var i = 0; i < classIds.length; i++) {
                var classId = classIds[i];
                var byClass = store[classId];
                if (!isPlainObject(byClass)) {
                    continue;
                }
                if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                    delete byClass[target];
                    result.recordsRemoved++;
                }
                if (Object.keys(byClass).length === 0) {
                    delete store[classId];
                }
            }
        }

        var AE = getAcademyEnrolments();
        if (AE && typeof AE.stripDisciplineRefs === 'function') {
            try {
                result.enrolmentsCascade =
                    AE.stripDisciplineRefs(appData, disciplineId);
            } catch (e) {
                result.enrolmentsCascade = {
                    error: String(e && e.message || e)
                };
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassDisciplines = Object.freeze({
        // Reads
        getClassDiscipline: getClassDiscipline,
        getClassDisciplinesForClass: getClassDisciplinesForClass,
        getClassDisciplinesForDiscipline: getClassDisciplinesForDiscipline,
        hasClassDiscipline: hasClassDiscipline,
        isClassOffering: isClassOffering,
        getAllOfferedDisciplineIds: getAllOfferedDisciplineIds,
        getEffectiveConfig: getEffectiveConfig,
        isActiveInWeek: isActiveInWeek,
        getActiveClassDisciplinesForWeek: getActiveClassDisciplinesForWeek,

        // Mutations
        setClassDiscipline: setClassDiscipline,
        removeClassDiscipline: removeClassDiscipline,

        // Cascade helpers
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyClassDisciplines;
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
            'setClassDiscipline',
            'removeClassDiscipline',
            'stripClassRefs',
            'stripDisciplineRefs'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            console.warn(
                '[AcademyClassDisciplines] Verification - missing exports:',
                missing.join(', ')
            );
        }
    })();

})();