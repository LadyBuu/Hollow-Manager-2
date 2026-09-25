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
 *   This module does not export read functions.
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
 *
 * THE MARKER RECORD:
 *
 *   academy.classDisciplines[classId][disciplineId] = {
 *     classId,
 *     disciplineId,
 *     mandatory,        // per-class: is this offering mandatory?
 *     createdAt,
 *     updatedAt
 *   }
 *
 *   Every other field that used to live on this record is gone:
 *   startWeek, endWeek, weeklyHours, weight, gradeSchemeId,
 *   assessmentWeights, instructorIds.
 *
 * WEEK SEMANTICS:
 *   The marker has no window. The window comes from the discipline.
 *
 * RANGE PREDICATES:
 *   Range containment and range overlap are owned by RangeUtils.
 *   This mutation module does not perform range math.
 *
 * MUTATION CONTRACT:
 *   - setClassDiscipline        create or replace the marker.
 *   - removeClassDiscipline     hard delete the marker.
 *
 *   Both return Promise<{ success, data?, message? }>.
 *   Both go through MutationPipeline.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the `appData` argument it is handed. It does not read window.data.
 *   Preflight reads against window.data are for early UX feedback
 *   only; the pipeline re-checks against the snapshot.
 *
 *   The pipeline validators check:
 *     - class exists in the snapshot
 *     - discipline exists in the snapshot
 *     - for remove: the target marker still exists in the snapshot
 *
 *   The preflight reference check (validateReference) does NOT
 *   replace the pipeline check. A concurrent mutation can delete the
 *   class or the discipline between preflight and commit.
 *
 * CASCADE SEMANTICS (v30):
 *   stripClassRefs and stripDisciplineRefs are PURE with respect to
 *   appData: they mutate the snapshot, never touch window.data, and
 *   never throw on absent stores.
 *
 *   Both helpers cascade into AcademyEnrolments' corresponding strip
 *   functions. An offering that is removed should not leave orphan
 *   enrolment intervals behind, and a discipline that is deleted
 *   should not leave orphan enrolment intervals behind.
 *
 *   AcademyEnrolments is MANDATORY at cascade time. A missing module
 *   or a missing helper on a present module fails the transaction.
 *   Lazy resolution solves load order; it does not make the
 *   dependency optional. A successful class-discipline delete that
 *   leaves orphan enrolments behind is worse than a failed delete.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils                 (deepClone)
 *   - window.ValidationUtils             (isNonEmptyString)
 *   - window.CalendarValidation          (parseWeek)
 *   - window.CalendarConstants           (MIN_WEEK, MAX_WEEK)
 *   - window.RangeUtils                  (containsWeek)
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
 * DEPENDENCIES (LAZY-BUT-MANDATORY, resolved at cascade time):
 *   - window.AcademyEnrolments           (stripClassRefs,
 *                                         stripDisciplineRefs)
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
        _missing.push(
            'AcademyClassDisciplinesQueries.getStoreFromSnapshot'
        );
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplines] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesLoaded = true;

    // ============================================================
    // LAZY-BUT-MANDATORY DEPENDENCY RESOLUTION
    // ============================================================
    //
    // AcademyEnrolments is used only by the cascade helpers. It is
    // resolved at call time so load order does not require the
    // enrolments module to be present before this one.
    //
    // At cascade time it is MANDATORY. A missing module or missing
    // helper fails the cascade.

    function requireAcademyEnrolments(helperName) {
        var AE = window.AcademyEnrolments;
        if (!AE) {
            throw new Error(
                '[AcademyClassDisciplines] AcademyEnrolments is ' +
                'required by ' + helperName + '. Check the script ' +
                'load order in index.html.'
            );
        }
        return AE;
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
    //
    // This is UX. The pipeline re-checks against the snapshot.

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
    // SNAPSHOT-AWARE REFERENCE CHECKS
    // ============================================================
    //
    // The pipeline validators resolve class and discipline references
    // against the transaction snapshot, not against window.data. A
    // concurrent mutation can delete the class or the discipline
    // between preflight and commit; the snapshot is the only
    // authoritative view.

    function classExistsInSnapshot(appData, classId) {
        if (!appData || !isPlainObject(appData.academy)) {
            return false;
        }
        var store = appData.academy.graduatingClasses;
        if (!isPlainObject(store)) { return false; }
        return isPlainObject(store[String(classId)]);
    }

    function disciplineExistsInSnapshot(appData, disciplineId) {
        if (!appData || typeof appData !== 'object') {
            return false;
        }
        if (!isNonEmptyString(disciplineId)) {
            return false;
        }
        var target = String(disciplineId);

        // Primary: academy.disciplines
        if (isPlainObject(appData.academy)) {
            var list = appData.academy.disciplines;
            if (Array.isArray(list)) {
                for (var a = 0; a < list.length; a++) {
                    var d = list[a];
                    if (d && String(d.id) === target) {
                        return true;
                    }
                }
            }
        }

        // Legacy fallback: curriculum.disciplines. This covers
        // pre-v28 snapshots that may still be in play mid-transaction
        // during an upgrade. The primary store always wins when both
        // are present.
        if (isPlainObject(appData.curriculum)) {
            var legacyList = appData.curriculum.disciplines;
            if (Array.isArray(legacyList)) {
                for (var l = 0; l < legacyList.length; l++) {
                    var ld = legacyList[l];
                    if (ld && String(ld.id) === target) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function markerExistsInSnapshot(appData, classId, disciplineId) {
        if (!appData || typeof appData !== 'object') {
            return false;
        }
        var store = Queries.getStoreFromSnapshot(appData);
        if (!store) { return false; }
        return Queries.getRecordInternalFromStore(
            store, classId, disciplineId
        ) !== null;
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

                if (!classExistsInSnapshot(appData, targetClass)) {
                    return {
                        valid: false,
                        message: 'Class no longer exists: ' + targetClass
                    };
                }
                if (!disciplineExistsInSnapshot(
                    appData, targetDiscipline
                )) {
                    return {
                        valid: false,
                        message: 'Discipline no longer exists: ' +
                            targetDiscipline
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
                if (!markerExistsInSnapshot(
                    appData, targetClass, targetDiscipline
                )) {
                    return {
                        valid: false,
                        message: 'Class-discipline no longer exists.'
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
    // window.data.
    //
    // AcademyEnrolments is MANDATORY at cascade time. Missing module
    // or missing helper fails the transaction.

    /**
     * Remove every class-discipline belonging to a class, and
     * cascade into enrolments for that class.
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

        var AE = requireAcademyEnrolments('stripClassRefs');
        if (typeof AE.stripClassRefs !== 'function') {
            throw new Error(
                '[AcademyClassDisciplines] AcademyEnrolments.stripClassRefs ' +
                'is required by stripClassRefs.'
            );
        }
        result.enrolmentsCascade = AE.stripClassRefs(appData, classId);

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

        var AE = requireAcademyEnrolments('stripDisciplineRefs');
        if (typeof AE.stripDisciplineRefs !== 'function') {
            throw new Error(
                '[AcademyClassDisciplines] ' +
                'AcademyEnrolments.stripDisciplineRefs is required by ' +
                'stripDisciplineRefs.'
            );
        }
        result.enrolmentsCascade =
            AE.stripDisciplineRefs(appData, disciplineId);

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
