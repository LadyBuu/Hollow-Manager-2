/**
 * modules/academy/academy-class-disciplines.js
 * Academy Class-Disciplines — MARKER-ONLY STORE
 *
 * Path: js/modules/academy/academy-class-disciplines.js
 *
 * WHAT THIS MODULE OWNS:
 *   Mutations and cascade cleanup for the class-discipline marker
 *   store. A class "offers" a discipline. That is the whole fact.
 *   There is no per-class config, no per-class window, no per-class
 *   instructor list. The class either offers the discipline or it
 *   does not.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Discipline global definitions       (AcademyDisciplines)
 *   - Student OR instructor enrolment     (AcademyEnrolments)
 *   - Teaching relationships              (AcademyTeachingGroups)
 *   - Recurring meetings                  (AcademyTeachingSessions)
 *   - Compound operations across stores   (AcademySchedule)
 *
 * READS LIVE ELSEWHERE:
 *   All reads of the marker store live in AcademyClassDisciplinesQueries.
 *   This module does not export read functions. Callers that want to
 *   ask "does this class offer English?" or "is this marker active
 *   in week W?" call the queries module directly.
 *
 *   The dependency direction is one-way:
 *
 *     callers → AcademyClassDisciplinesQueries   (reads)
 *     callers → AcademyClassDisciplines          (writes + cascades)
 *     AcademyClassDisciplines → AcademyClassDisciplinesQueries
 *                                                (preflight reads,
 *                                                 snapshot access,
 *                                                 reference validation)
 *
 *   This module never re-exports read functions and never wraps them.
 *   A delegating read wrapper would be the "public + internal variant"
 *   anti-pattern from the Teams refactor process doc §7: a thin
 *   surface that hides the real owner and drifts over time. Callers
 *   reach for the queries module by name.
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
 *   The marker has no window. The window comes from the discipline.
 *   That question — "is this offering active in week W?" — is
 *   answered by AcademyClassDisciplinesQueries.isActiveInWeek.
 *
 * RANGE PREDICATES (v27):
 *   Range containment and range overlap are owned by RangeUtils,
 *   the canonical range-predicate module. This mutation module does
 *   not perform range math; the preflight window check delegates to
 *   the queries module, which delegates to RangeUtils.
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
 *   Both helpers cascade into AcademyEnrolments' corresponding strip
 *   functions. An offering that is removed should not leave orphan
 *   enrolment intervals behind, and a discipline that is deleted
 *   should not leave orphan enrolment intervals behind. The
 *   delegations are guarded so that a missing AcademyEnrolments
 *   module is a no-op rather than a crash.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils                 (deepClone)
 *   - window.ValidationUtils             (isNonEmptyString)
 *   - window.CalendarValidation          (parseWeek)
 *   - window.CalendarConstants           (MIN_WEEK, MAX_WEEK)
 *   - window.RangeUtils                  (containsWeek — for the
 *                                         preflight window check)
 *   - window.MutationPipeline            (performMutation)
 *   - window.AcademyClasses              (class existence at mutation
 *                                         entry)
 *   - window.AcademyDisciplines          (discipline existence at
 *                                         mutation entry)
 *   - window.AcademyClassDisciplinesQueries
 *                                        (preflight reads, snapshot
 *                                         store access, reference
 *                                         validator, MIN_WEEK/MAX_WEEK)
 *
 * DEPENDENCIES (LAZY, used only by the cascade helpers):
 *   - window.AcademyEnrolments           (stripClassRefs,
 *                                         stripDisciplineRefs)
 *     When absent, the corresponding cascade step is skipped.
 *
 * USAGE:
 *   var ACD = window.AcademyClassDisciplines;
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
    var Queries = window.AcademyClassDisciplinesQueries;

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
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!Queries ||
        typeof Queries.validateReference !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.validateReference');
    }
    if (!Queries ||
        typeof Queries.getRecordInternal !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.getRecordInternal');
    }
    if (!Queries ||
        typeof Queries.getStoreFromSnapshot !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.getStoreFromSnapshot');
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
     * Ensure the classDisciplines store exists on an appData
     * snapshot. Only call from inside a pipeline mutate() callback.
     *
     * This is the ONLY place in the module that creates structure on
     * the snapshot. Reads route through the queries module, which
     * never creates.
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
    // PREFLIGHT VALIDATION
    // ============================================================
    //
    // Delegates to the queries module so that the mutation module
    // and any future caller share one implementation of "does this
    // (class, discipline) pair reference live entities?"

    function validateReference(classId, disciplineId) {
        return Queries.validateReference(classId, disciplineId);
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

        var existing = Queries.getRecordInternal(classId, disciplineId);
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

        var existing = Queries.getRecordInternal(classId, disciplineId);
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
                var store = Queries.getStoreFromSnapshot(appData);
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

        var store = Queries.getStoreFromSnapshot(appData);
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

        var store = Queries.getStoreFromSnapshot(appData);
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
        // Mutations
        setClassDiscipline: setClassDiscipline,
        removeClassDiscipline: removeClassDiscipline,

        // Cascade helpers
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs,

        // Constants (read-only; mirrored on the queries module)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyClassDisciplines;
        var required = [
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