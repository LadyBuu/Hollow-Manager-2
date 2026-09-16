/**
 * modules/academy/academy-class-disciplines.js - Academy Class-Disciplines
 * SINGLE SOURCE OF TRUTH for a class's offering of a discipline.
 *
 * Path: js/modules/academy/academy-class-disciplines.js
 *
 * WHAT THIS MODULE OWNS:
 *   The relationship between a Graduating Class and a Discipline.
 *   A class "offers" a discipline for a bounded week range, with
 *   per-class configuration that may override the discipline's
 *   global defaults.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Discipline global definitions       (AcademyDisciplines)
 *   - Student enrolment                   (AcademyEnrolments)
 *   - Teaching relationships              (AcademyTeachingGroups)
 *   - Recurring meetings                  (AcademyTeachingSessions)
 *   - Compound operations across stores   (AcademySchedule)
 *
 * HISTORICAL-RECORD PRINCIPLE:
 *   A class-discipline is a historical fact: "Class 2026 offered
 *   English from week 1 to week 24." Ending an offering sets its
 *   endWeek; it does NOT delete the record. Deletion is reserved
 *   for administrative cleanup and for the hard delete of a class.
 *   See the "MUTATION CONTRACT" section below.
 *
 * STORAGE:
 *   window.data.academy.classDisciplines = {
 *     [classId]: {
 *       [disciplineId]: {
 *         classId,
 *         disciplineId,
 *         startWeek,
 *         endWeek,          // null = ongoing
 *         weeklyHours,
 *         weight,
 *         gradeSchemeId,
 *         assessmentWeights,
 *         mandatory,
 *         createdAt,
 *         updatedAt
 *       }
 *     }
 *   }
 *
 * EFFECTIVE CONFIG:
 *   A caller that wants "the effective weeklyHours for English in
 *   Class 2026" gets the class-discipline's value, or falls back to
 *   the discipline's default. This module owns that resolution; the
 *   discipline module owns the defaults themselves.
 *
 * WEEK SEMANTICS:
 *   - startWeek is an integer in [MIN_WEEK, MAX_WEEK].
 *   - endWeek is null (ongoing) or an integer in [MIN_WEEK, MAX_WEEK]
 *     with endWeek >= startWeek.
 *   - endWeek is INCLUSIVE: a class-discipline with endWeek = 14 is
 *     active in weeks 1-14 and inactive from week 15 onward.
 *   - No `|| 1` defaults. Invalid weeks are rejected.
 *
 * MUTATION CONTRACT:
 *   - setClassDiscipline        create or replace.
 *                               Does NOT touch enrolments.
 *   - updateClassDiscipline     partial update.
 *   - endClassDiscipline        set endWeek. Historical.
 *   - removeClassDiscipline     hard delete, single record.
 *                               Used by cascade, not by the ordinary
 *                               "drop discipline" UI.
 *
 * All mutations return Promise<{ success, data?, message? }>.
 * All mutations go through MutationPipeline.
 *
 * READ SAFETY:
 *   - Reads never create the store.
 *   - Public reads return DEEP CLONES.
 *   - Internal accessors used inside pipeline callbacks return live
 *     references from the appData snapshot.
 *
 * CASCADE SEMANTICS:
 *   stripClassRefs and stripDisciplineRefs are PURE with respect to
 *   appData: they mutate the snapshot, never touch window.data, and
 *   never throw. They run inside another module's pipeline
 *   transaction.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils          (deepClone)
 *   - window.ValidationUtils      (isNonEmptyString)
 *   - window.CalendarValidation   (parseWeek)
 *   - window.CalendarConstants    (MIN_WEEK, MAX_WEEK)
 *   - window.MutationPipeline     (performMutation)
 *   - window.AcademyClasses       (getClass)
 *   - window.AcademyDisciplines   (getDiscipline, defaults, bounds)
 *   - window.AcademyGradeSchemes  (isValidPresetId)
 *
 * USAGE:
 *   var ACD = window.AcademyClassDisciplines;
 *
 *   ACD.getClassDiscipline('class_1', 'disc_english'); // record or null
 *   ACD.getEffectiveConfig('class_1', 'disc_english');
 *
 *   ACD.setClassDiscipline('class_1', 'disc_english', {
 *       startWeek: 1, endWeek: 24, weeklyHours: 3
 *   }).then(function(r) { ... });
 */

(function() {
    'use strict';

    if (window.__academyClassDisciplinesLoaded) {
        return;
    }

    // ============================================================
    // DIAGNOSTIC FLAG
    // ============================================================
    var _DIAGNOSTIC = true;

    function diag() {
        if (!_DIAGNOSTIC) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[ACD]');
        console.log.apply(console, args);
    }

    function diagWarn() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[ACD]');
        console.warn.apply(console, args);
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var MutationPipeline = window.MutationPipeline;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyGradeSchemes = window.AcademyGradeSchemes;

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
    if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyGradeSchemes || typeof AcademyGradeSchemes.isValidPresetId !== 'function') {
        _missing.push('AcademyGradeSchemes.isValidPresetId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplines] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesLoaded = true;

    diag('Module loaded.');
    diag('  AcademyClasses:', !!AcademyClasses);
    diag('  AcademyDisciplines:', !!AcademyDisciplines);
    diag('  AcademyGradeSchemes:', !!AcademyGradeSchemes);
    diag('  MutationPipeline:', !!MutationPipeline);

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // Fallbacks for bounds; the discipline module owns the canonical
    // values, but we need something to validate against if the module
    // exposes them differently.
    var FALLBACK_MIN_WEEKLY_HOURS = 0.5;
    var FALLBACK_MAX_WEEKLY_HOURS = 40;
    var FALLBACK_MIN_WEIGHT = 0.1;
    var FALLBACK_MAX_WEIGHT = 10;

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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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
     * Parse a week. Returns an integer in [MIN_WEEK, MAX_WEEK] or null.
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

    function getMinWeeklyHours() {
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.MIN_WEEKLY_HOURS === 'number') {
            return AcademyDisciplines.MIN_WEEKLY_HOURS;
        }
        return FALLBACK_MIN_WEEKLY_HOURS;
    }

    function getMaxWeeklyHours() {
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.MAX_WEEKLY_HOURS === 'number') {
            return AcademyDisciplines.MAX_WEEKLY_HOURS;
        }
        return FALLBACK_MAX_WEEKLY_HOURS;
    }

    function getMinWeight() {
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.MIN_WEIGHT === 'number') {
            return AcademyDisciplines.MIN_WEIGHT;
        }
        return FALLBACK_MIN_WEIGHT;
    }

    function getMaxWeight() {
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.MAX_WEIGHT === 'number') {
            return AcademyDisciplines.MAX_WEIGHT;
        }
        return FALLBACK_MAX_WEIGHT;
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
     * Ensure the classDisciplines store exists on an appData snapshot.
     * Only call from inside a pipeline mutate() callback.
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

    function validateWeekRange(startWeek, endWeek) {
        if (startWeek === undefined || startWeek === null) {
            return { valid: false, message: 'Start week is required.' };
        }

        var startNum = parseWeekStrict(startWeek);
        if (startNum === null) {
            return {
                valid: false,
                message: 'Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'
            };
        }

        if (endWeek === undefined || endWeek === null) {
            return { valid: true, startWeek: startNum, endWeek: null };
        }

        var endNum = parseWeekStrict(endWeek);
        if (endNum === null) {
            return {
                valid: false,
                message: 'End week must be null or between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'
            };
        }

        if (endNum < startNum) {
            return { valid: false, message: 'End week cannot be before start week.' };
        }

        return { valid: true, startWeek: startNum, endWeek: endNum };
    }

    function validateWeeklyHours(value) {
        if (!isFiniteNumber(value)) {
            return { valid: false, message: 'Weekly hours must be a number.' };
        }
        var min = getMinWeeklyHours();
        var max = getMaxWeeklyHours();
        if (value < min || value > max) {
            return {
                valid: false,
                message: 'Weekly hours must be between ' + min + ' and ' + max + '.'
            };
        }
        return { valid: true };
    }

    function validateWeight(value) {
        if (!isFiniteNumber(value)) {
            return { valid: false, message: 'Weight must be a number.' };
        }
        var min = getMinWeight();
        var max = getMaxWeight();
        if (value < min || value > max) {
            return {
                valid: false,
                message: 'Weight must be between ' + min + ' and ' + max + '.'
            };
        }
        return { valid: true };
    }

    function validateGradeSchemeId(value) {
        if (value === null || value === undefined) {
            return { valid: true };
        }
        if (!isNonEmptyString(value)) {
            return { valid: false, message: 'Grade scheme ID must be a non-empty string.' };
        }
        if (!AcademyGradeSchemes.isValidPresetId(value)) {
            return {
                valid: false,
                message: 'Unknown grade scheme preset: "' + value + '".'
            };
        }
        return { valid: true };
    }

    function validateAssessmentWeights(value) {
        if (value === undefined || value === null) {
            return { valid: true };
        }
        if (!isPlainObject(value)) {
            return { valid: false, message: 'Assessment weights must be an object.' };
        }

        var validTypes = null;
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.getValidAssessmentTypes === 'function') {
            validTypes = AcademyDisciplines.getValidAssessmentTypes();
        }

        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (validTypes && validTypes.indexOf(key) === -1) {
                return {
                    valid: false,
                    message: 'Unknown assessment type: "' + key + '".'
                };
            }
            var w = value[key];
            if (!isFiniteNumber(w) || w <= 0) {
                return {
                    valid: false,
                    message: 'Weight for "' + key + '" must be a positive number.'
                };
            }
        }
        return { valid: true };
    }

    /**
     * Validate a full config object. Used on create.
     */
    function validateFullConfig(config) {
        if (!isPlainObject(config)) {
            return { valid: false, message: 'Class-discipline config must be an object.' };
        }

        var weekCheck = validateWeekRange(config.startWeek, config.endWeek);
        if (!weekCheck.valid) {
            return weekCheck;
        }

        if (config.weeklyHours !== undefined) {
            var whCheck = validateWeeklyHours(config.weeklyHours);
            if (!whCheck.valid) return whCheck;
        }

        if (config.weight !== undefined) {
            var wCheck = validateWeight(config.weight);
            if (!wCheck.valid) return wCheck;
        }

        if (config.gradeSchemeId !== undefined) {
            var gsCheck = validateGradeSchemeId(config.gradeSchemeId);
            if (!gsCheck.valid) return gsCheck;
        }

        if (config.assessmentWeights !== undefined) {
            var awCheck = validateAssessmentWeights(config.assessmentWeights);
            if (!awCheck.valid) return awCheck;
        }

        if (config.mandatory !== undefined && typeof config.mandatory !== 'boolean') {
            return { valid: false, message: 'Mandatory must be a boolean.' };
        }

        return {
            valid: true,
            startWeek: weekCheck.startWeek,
            endWeek: weekCheck.endWeek
        };
    }

    // ============================================================
    // EFFECTIVE CONFIG RESOLUTION
    // ============================================================

    /**
     * Resolve the effective configuration for a class-discipline.
     *
     * Order of precedence:
     *   1. The class-discipline record's field (if set and valid).
     *   2. The discipline's default* field (if set and valid).
     *   3. The module's hardcoded fallback.
     *
     * @param {string} classId
     * @param {string} disciplineId
     * @returns {object|null} config, or null when either is missing
     */
    function getEffectiveConfig(classId, disciplineId) {
        var record = getRecordInternal(classId, disciplineId);
        if (!record) {
            diag('getEffectiveConfig: no record for',
                classId, disciplineId, '- returning null');
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            diagWarn('getEffectiveConfig: discipline missing for', disciplineId);
            return null;
        }

        function pick(field, disciplineDefaultField, fallback) {
            if (record[field] !== undefined && record[field] !== null) {
                return record[field];
            }
            if (discipline[disciplineDefaultField] !== undefined &&
                discipline[disciplineDefaultField] !== null) {
                return discipline[disciplineDefaultField];
            }
            return fallback;
        }

        var effective = {
            classId: String(classId),
            disciplineId: String(disciplineId),
            startWeek: record.startWeek,
            endWeek: record.endWeek,
            weeklyHours: pick('weeklyHours', 'defaultWeeklyHours', 1),
            weight: pick('weight', 'defaultWeight', 1),
            gradeSchemeId: pick('gradeSchemeId', 'defaultGradeSchemeId', 'numeric'),
            assessmentWeights:
                (record.assessmentWeights !== undefined && record.assessmentWeights !== null)
                    ? deepClone(record.assessmentWeights)
                    : (discipline.defaultAssessmentWeights !== undefined &&
                       discipline.defaultAssessmentWeights !== null
                        ? deepClone(discipline.defaultAssessmentWeights)
                        : null),
            mandatory: record.mandatory === true
        };

        diag('getEffectiveConfig:', classId, disciplineId, '=', effective);
        return effective;
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    function getClassDiscipline(classId, disciplineId) {
        var record = getRecordInternal(classId, disciplineId);
        return record ? deepClone(record) : null;
    }

    function getClassDisciplinesForClass(classId) {
        var records = getRecordsForClassInternal(classId);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

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

    function hasClassDiscipline(classId, disciplineId) {
        return getRecordInternal(classId, disciplineId) !== null;
    }

    /**
     * Is the class-discipline active in the given week?
     */
    function isActiveInWeek(classId, disciplineId, week) {
        var record = getRecordInternal(classId, disciplineId);
        if (!record) {
            return false;
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return false;
        }
        if (record.startWeek === undefined || record.startWeek === null) {
            return false;
        }
        if (weekNum < record.startWeek) {
            return false;
        }
        if (record.endWeek !== undefined && record.endWeek !== null &&
            weekNum > record.endWeek) {
            return false;
        }
        return true;
    }

    /**
     * Return every class-discipline for a class that is active in the
     * given week.
     */
    function getActiveClassDisciplinesForWeek(classId, week) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }
        var records = getRecordsForClassInternal(classId);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            var record = records[i];
            if (record.startWeek === undefined || record.startWeek === null) {
                continue;
            }
            if (weekNum < record.startWeek) {
                continue;
            }
            if (record.endWeek !== undefined && record.endWeek !== null &&
                weekNum > record.endWeek) {
                continue;
            }
            result.push(deepClone(record));
        }
        return result;
    }

    // ============================================================
    // CANDIDATE BUILDER
    // ============================================================

    function buildCandidate(classId, disciplineId, config, existingRecord) {
        var now = new Date().toISOString();
        var weekCheck = validateWeekRange(config.startWeek, config.endWeek);

        // weekCheck is validated by the caller; this is a defensive
        // re-run so the candidate builder is safe to call directly.
        if (!weekCheck.valid) {
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);

        // Resolve each field: explicit config value, else previous
        // record's value if updating, else discipline default.
        function resolve(field, disciplineDefaultField, fallback) {
            if (config[field] !== undefined && config[field] !== null) {
                return config[field];
            }
            if (existingRecord &&
                existingRecord[field] !== undefined &&
                existingRecord[field] !== null) {
                return existingRecord[field];
            }
            if (discipline &&
                discipline[disciplineDefaultField] !== undefined &&
                discipline[disciplineDefaultField] !== null) {
                return discipline[disciplineDefaultField];
            }
            return fallback;
        }

        var record = {
            classId: String(classId),
            disciplineId: String(disciplineId),
            startWeek: weekCheck.startWeek,
            endWeek: weekCheck.endWeek,
            weeklyHours: resolve('weeklyHours', 'defaultWeeklyHours', 1),
            weight: resolve('weight', 'defaultWeight', 1),
            gradeSchemeId: resolve('gradeSchemeId', 'defaultGradeSchemeId', 'numeric'),
            assessmentWeights: (function() {
                if (config.assessmentWeights !== undefined &&
                    config.assessmentWeights !== null) {
                    return deepClone(config.assessmentWeights);
                }
                if (existingRecord &&
                    existingRecord.assessmentWeights !== undefined &&
                    existingRecord.assessmentWeights !== null) {
                    return deepClone(existingRecord.assessmentWeights);
                }
                if (discipline &&
                    discipline.defaultAssessmentWeights !== undefined &&
                    discipline.defaultAssessmentWeights !== null) {
                    return deepClone(discipline.defaultAssessmentWeights);
                }
                return null;
            })(),
            mandatory: config.mandatory === true
                ? true
                : (existingRecord && existingRecord.mandatory === true),
            createdAt: existingRecord && existingRecord.createdAt
                ? existingRecord.createdAt
                : now,
            updatedAt: now
        };

        return record;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    function setClassDiscipline(classId, disciplineId, config) {
        diag('setClassDiscipline CALLED',
            { classId: classId, disciplineId: disciplineId, config: config });

        var refCheck = validateReference(classId, disciplineId);
        if (!refCheck.valid) {
            diagWarn('setClassDiscipline: reference invalid:', refCheck.message);
            return Promise.resolve(failure(refCheck.message));
        }

        if (!isPlainObject(config)) {
            return Promise.resolve(failure('Config must be an object.'));
        }

        // Caller MUST supply startWeek. No silent MIN_WEEK default.
        if (config.startWeek === undefined || config.startWeek === null) {
            return Promise.resolve(failure('startWeek is required.'));
        }

        var configCheck = validateFullConfig(config);
        if (!configCheck.valid) {
            diagWarn('setClassDiscipline: config invalid:', configCheck.message);
            return Promise.resolve(failure(configCheck.message));
        }

        var existing = getRecordInternal(classId, disciplineId);
        var candidate = buildCandidate(classId, disciplineId, config, existing);

        if (!candidate) {
            return Promise.resolve(failure('Failed to build candidate record.'));
        }

        diag('setClassDiscipline: candidate =', candidate);

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                diag('  [VALIDATE] appData === window.data?',
                    appData === window.data);
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                diag('  [MUTATE] appData === window.data?',
                    appData === window.data);
                var store = ensureStore(appData);
                diag('  [MUTATE] store BEFORE:',
                    JSON.stringify(store[targetClass] || null));

                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }
                store[targetClass][targetDiscipline] = deepClone(candidate);

                diag('  [MUTATE] store AFTER:',
                    JSON.stringify(store[targetClass]));
                diag('  [MUTATE] window.data...classDisciplines AFTER:',
                    JSON.stringify(window.data && window.data.academy &&
                                 window.data.academy.classDisciplines));

                return { record: candidate };
            },
            logMessage: 'Set class-discipline: ' +
                (refCheck.class.name || targetClass) + ' / ' +
                (refCheck.discipline.name || targetDiscipline),
            successMessage: 'Class-discipline saved.',
            failureMessage: 'Failed to save class-discipline.'
        });
    }

    function updateClassDiscipline(classId, disciplineId, updates) {
        var existing = getRecordInternal(classId, disciplineId);
        if (!existing) {
            return Promise.resolve(failure('Class-discipline not found.'));
        }

        if (!isPlainObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        // Merge existing into updates, then run as a full set.
        var merged = deepClone(existing);
        var keys = Object.keys(updates);
        for (var i = 0; i < keys.length; i++) {
            merged[keys[i]] = updates[keys[i]];
        }

        // Preserve startWeek and endWeek from the existing record
        // unless updates explicitly change them.
        if (updates.startWeek === undefined) {
            merged.startWeek = existing.startWeek;
        }
        if (updates.endWeek === undefined) {
            merged.endWeek = existing.endWeek;
        }

        return setClassDiscipline(classId, disciplineId, merged);
    }

    function endClassDiscipline(classId, disciplineId, effectiveWeek) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Class ID and discipline ID are required.'));
        }

        var weekNum = parseWeekStrict(effectiveWeek);
        if (weekNum === null) {
            return Promise.resolve(
                failure('Valid effective week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').')
            );
        }

        var existing = getRecordInternal(classId, disciplineId);
        if (!existing) {
            return Promise.resolve(failure('Class-discipline not found.'));
        }

        if (weekNum < existing.startWeek) {
            return Promise.resolve(
                failure('Effective week cannot be before the start week.')
            );
        }

        // endWeek is INCLUSIVE. If the caller says "effective in week
        // 15", the offering ran through week 14.
        var newEndWeek = weekNum - 1;
        if (newEndWeek < existing.startWeek) {
            return Promise.resolve(
                failure('Effective week would end the offering before it begins.')
            );
        }

        diag('endClassDiscipline:', classId, disciplineId,
            'effectiveWeek =', weekNum, '→ endWeek =', newEndWeek);

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = getStoreFromSnapshot(appData);
                if (!store) {
                    throw new Error('Class-disciplines store is not available.');
                }
                var record = getRecordInternalFromStore(
                    store, targetClass, targetDiscipline
                );
                if (!record) {
                    throw new Error('Class-discipline not found in snapshot.');
                }
                record.endWeek = newEndWeek;
                record.updatedAt = new Date().toISOString();
                return { record: deepClone(record) };
            },
            logMessage: 'Ended class-discipline: ' + targetClass + ' / ' + targetDiscipline,
            successMessage: 'Discipline offering ended.',
            failureMessage: 'Failed to end discipline offering.'
        });
    }

    /**
     * Hard delete a single class-discipline record. Use this only for
     * administrative cleanup. For the ordinary "drop this discipline"
     * action, use endClassDiscipline.
     */
    function removeClassDiscipline(classId, disciplineId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Class ID and discipline ID are required.'));
        }

        var existing = getRecordInternal(classId, disciplineId);
        if (!existing) {
            return Promise.resolve(failure('Class-discipline not found.'));
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
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
                if (!Object.prototype.hasOwnProperty.call(byClass, targetDiscipline)) {
                    return { removed: false };
                }
                delete byClass[targetDiscipline];
                if (Object.keys(byClass).length === 0) {
                    delete store[targetClass];
                }
                return { removed: true };
            },
            logMessage: 'Removed class-discipline: ' + targetClass + ' / ' + targetDiscipline,
            successMessage: 'Class-discipline removed.',
            failureMessage: 'Failed to remove class-discipline.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Remove every class-discipline belonging to a class.
     *
     * PURE with respect to appData. Mutates the snapshot; never
     * touches window.data. Never throws.
     *
     * @returns {object} { recordsRemoved }
     */
    function stripClassRefs(appData, classId) {
        var result = { recordsRemoved: 0 };

        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

        var target = String(classId);
        if (!Object.prototype.hasOwnProperty.call(store, target)) {
            return result;
        }

        var byClass = store[target];
        if (isPlainObject(byClass)) {
            result.recordsRemoved = Object.keys(byClass).length;
        }

        delete store[target];
        return result;
    }

    /**
     * Remove every class-discipline for a given discipline ID.
     *
     * @returns {object} { recordsRemoved }
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = { recordsRemoved: 0 };

        if (!appData || !isNonEmptyString(disciplineId)) {
            return result;
        }

        var store = getStoreFromSnapshot(appData);
        if (!store) {
            return result;
        }

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

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassDisciplines = {
        // Reads
        getClassDiscipline: getClassDiscipline,
        getClassDisciplinesForClass: getClassDisciplinesForClass,
        getClassDisciplinesForDiscipline: getClassDisciplinesForDiscipline,
        hasClassDiscipline: hasClassDiscipline,
        getEffectiveConfig: getEffectiveConfig,
        isActiveInWeek: isActiveInWeek,
        getActiveClassDisciplinesForWeek: getActiveClassDisciplinesForWeek,

        // Mutations
        setClassDiscipline: setClassDiscipline,
        updateClassDiscipline: updateClassDiscipline,
        endClassDiscipline: endClassDiscipline,
        removeClassDiscipline: removeClassDiscipline,

        // Cascade helpers
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

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
            'getEffectiveConfig',
            'isActiveInWeek',
            'getActiveClassDisciplinesForWeek',
            'setClassDiscipline',
            'updateClassDiscipline',
            'endClassDiscipline',
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
            console.warn('[AcademyClassDisciplines] Verification - missing exports:', missing.join(', '));
        } else {
            diag('Verification OK.');
        }
    })();

})();
