/**
 * modules/academy/academy-enrolments.js - Academy Enrolments
 * SINGLE SOURCE OF TRUTH for student ↔ discipline enrolment.
 *
 * Path: js/modules/academy/academy-enrolments.js
 *
 * This module is responsible for:
 *   - Enrolment CRUD (enrol, leave, bulk replace)
 *   - Enrolment queries (by student, by class, by discipline)
 *   - Cascade cleanup on student / class / discipline deletion
 *
 * IMPORTANT:
 *   - Enrolment is CLASS-SCOPED: a student can be enrolled in
 *     different disciplines for different classes.
 *   - Storage: window.data.academy.enrolments[classId][charId] = [disciplineId]
 *   - character.disciplineIds is NOT canonical for enrolment. It is
 *     a legacy field. This module does not read it. It does not write
 *     to it.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *   - Public reads return DEEP CLONES. Internal accessors return live
 *     references for this module's own mutation paths.
 *
 * STORAGE SHAPE:
 *   academy.enrolments = {
 *     'class_789': {
 *       'char_456': ['disc_abc', 'disc_def'],
 *       'char_457': ['disc_abc']
 *     },
 *     'class_790': { ... }
 *   }
 *
 * A student enrolled in a class with no disciplines has an empty
 * array, not a missing entry. Absence of the (classId, charId) key
 * means "not enrolled in anything for this class". An empty array
 * means "enrolled, but not in any disciplines".
 *
 * In practice those two states are equivalent for reads. The module
 * normalises them by returning [] for both.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (MANDATORY)
 *   - window.ValidationUtils (MANDATORY)
 *   - window.MutationPipeline (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academyEnrolmentsLoaded) {
        return;
    }

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }
    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }
    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyEnrolments] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyEnrolmentsLoaded = true;

    var ObjectUtils = window.ObjectUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error('[AcademyEnrolments] deepClone aliased the input.');
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // INTERNAL ACCESS
    // ============================================================

    function getAcademyStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.academy || typeof window.data.academy !== 'object') {
            return null;
        }
        return window.data.academy;
    }

    function ensureEnrolmentsStore(appData) {
        if (!appData.academy || typeof appData.academy !== 'object') {
            appData.academy = {};
        }
        if (!appData.academy.enrolments ||
            typeof appData.academy.enrolments !== 'object' ||
            Array.isArray(appData.academy.enrolments)) {
            appData.academy.enrolments = {};
        }
        return appData.academy.enrolments;
    }

    /**
     * Internal read: get the live array of discipline IDs for
     * (classId, charId). Returns null if no entry.
     *
     * Does not create the entry. Does not touch window.data.
     */
    function getEnrolmentRecord(classId, charId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return null;
        }
        var academy = getAcademyStore();
        if (!academy || !academy.enrolments) {
            return null;
        }
        var byClass = academy.enrolments[String(classId)];
        if (!byClass || typeof byClass !== 'object') {
            return null;
        }
        var arr = byClass[String(charId)];
        if (!Array.isArray(arr)) {
            return null;
        }
        return arr;
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

    /**
     * Get the discipline IDs a student is enrolled in for a class.
     * Returns a fresh array. Never returns null.
     */
    function getStudentDisciplines(charId, classId) {
        var record = getEnrolmentRecord(classId, charId);
        if (!record) {
            return [];
        }
        return record.slice();
    }

    /**
     * Is the student enrolled in a specific discipline for a class?
     */
    function isEnrolled(charId, classId, disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return false;
        }
        var record = getEnrolmentRecord(classId, charId);
        if (!record) {
            return false;
        }
        var target = String(disciplineId);
        for (var i = 0; i < record.length; i++) {
            if (String(record[i]) === target) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get every student enrolled in a class, mapped to their
     * discipline IDs.
     *
     * @returns {object} { charId: [disciplineId], ... }
     */
    function getClassEnrolments(classId) {
        if (!isNonEmptyString(classId)) {
            return {};
        }
        var academy = getAcademyStore();
        if (!academy || !academy.enrolments) {
            return {};
        }
        var byClass = academy.enrolments[String(classId)];
        if (!byClass || typeof byClass !== 'object') {
            return {};
        }
        var result = {};
        var keys = Object.keys(byClass);
        for (var i = 0; i < keys.length; i++) {
            var arr = byClass[keys[i]];
            result[keys[i]] = Array.isArray(arr) ? arr.slice() : [];
        }
        return result;
    }

    /**
     * Get every student in a class who is enrolled in a given
     * discipline.
     */
    function getStudentsInDiscipline(classId, disciplineId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(disciplineId)) {
            return [];
        }
        var academy = getAcademyStore();
        if (!academy || !academy.enrolments) {
            return [];
        }
        var byClass = academy.enrolments[String(classId)];
        if (!byClass || typeof byClass !== 'object') {
            return [];
        }
        var target = String(disciplineId);
        var result = [];
        var keys = Object.keys(byClass);
        for (var i = 0; i < keys.length; i++) {
            var arr = byClass[keys[i]];
            if (!Array.isArray(arr)) { continue; }
            for (var j = 0; j < arr.length; j++) {
                if (String(arr[j]) === target) {
                    result.push(keys[i]);
                    break;
                }
            }
        }
        return result;
    }

    /**
     * Get every class a student is enrolled in.
     * Returns array of classId strings. A student is "enrolled in a
     * class" if they have an entry in that class's map, regardless of
     * whether the disciplines array is empty.
     */
    function getStudentClasses(charId) {
        if (!isNonEmptyString(charId)) {
            return [];
        }
        var academy = getAcademyStore();
        if (!academy || !academy.enrolments) {
            return [];
        }
        var target = String(charId);
        var result = [];
        var classIds = Object.keys(academy.enrolments);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = academy.enrolments[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                result.push(classIds[i]);
            }
        }
        return result;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Enrol a student in a discipline for a class.
     * Idempotent: if already enrolled, resolves with success and
     * changed: false.
     */
    function enrol(charId, classId, disciplineId) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        // Pre-flight idempotency check.
        if (isEnrolled(targetChar, targetClass, targetDiscipline)) {
            return Promise.resolve(success({ changed: false }));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureEnrolmentsStore(appData);
                if (!store[targetClass]) {
                    store[targetClass] = {};
                }
                if (!Array.isArray(store[targetClass][targetChar])) {
                    store[targetClass][targetChar] = [];
                }
                if (store[targetClass][targetChar].indexOf(targetDiscipline) === -1) {
                    store[targetClass][targetChar].push(targetDiscipline);
                    store[targetClass][targetChar].sort();
                }
                return { changed: true };
            },
            logMessage: 'Enrolled ' + targetChar + ' in ' + targetDiscipline + ' for ' + targetClass,
            successMessage: 'Enrolled successfully.',
            failureMessage: 'Failed to enrol.'
        });
    }

    /**
     * Remove a student from a discipline for a class.
     * Idempotent: if not enrolled, resolves with success and
     * changed: false.
     */
    function leave(charId, classId, disciplineId) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!isNonEmptyString(disciplineId)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        if (!isEnrolled(targetChar, targetClass, targetDiscipline)) {
            return Promise.resolve(success({ changed: false }));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureEnrolmentsStore(appData);
                if (!store[targetClass] || !Array.isArray(store[targetClass][targetChar])) {
                    return { changed: false };
                }
                store[targetClass][targetChar] = store[targetClass][targetChar].filter(function(id) {
                    return String(id) !== targetDiscipline;
                });
                return { changed: true };
            },
            logMessage: 'Removed ' + targetChar + ' from ' + targetDiscipline + ' for ' + targetClass,
            successMessage: 'Left discipline.',
            failureMessage: 'Failed to leave discipline.'
        });
    }

    /**
     * Replace the enrolment list for a student in a class.
     * Used by bulk-edit UI.
     */
    function replaceEnrolments(charId, classId, disciplineIds) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!Array.isArray(disciplineIds)) {
            return Promise.resolve(failure('Discipline IDs must be an array.'));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var cleaned = [];
        var seen = {};
        for (var i = 0; i < disciplineIds.length; i++) {
            var id = disciplineIds[i];
            if (!isNonEmptyString(id)) { continue; }
            var trimmed = String(id).trim();
            if (seen[trimmed]) { continue; }
            seen[trimmed] = true;
            cleaned.push(trimmed);
        }
        cleaned.sort();

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureEnrolmentsStore(appData);
                if (!store[targetClass]) {
                    store[targetClass] = {};
                }
                store[targetClass][targetChar] = cleaned.slice();
                return { changed: true, count: cleaned.length };
            },
            logMessage: 'Replaced enrolments for ' + targetChar + ' in ' + targetClass,
            successMessage: 'Enrolments updated.',
            failureMessage: 'Failed to update enrolments.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Strip all enrolment references to a character.
     * Pure with respect to appData. Called from CharacterCRUD.delete.
     */
    function stripCharacterRefs(appData, charId) {
        var result = { enrolmentsRemoved: 0 };
        if (!appData || !charId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(charId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                delete byClass[target];
                result.enrolmentsRemoved++;
            }
        }
        return result;
    }

    /**
     * Strip all enrolment references to a class.
     * Pure with respect to appData. Called from AcademyClasses.delete.
     */
    function stripClassRefs(appData, classId) {
        var result = { enrolmentsRemoved: 0 };
        if (!appData || !classId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(classId);
        if (store[target]) {
            result.enrolmentsRemoved = Object.keys(store[target]).length;
            delete store[target];
        }
        return result;
    }

    /**
     * Strip references to a discipline from every enrolment list.
     * Pure with respect to appData. Called from AcademyDisciplines.delete.
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = { enrolmentsRemoved: 0 };
        if (!appData || !disciplineId) { return result; }
        if (!appData.academy || typeof appData.academy !== 'object') { return result; }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object') { return result; }

        var target = String(disciplineId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!byClass || typeof byClass !== 'object') { continue; }
            var charIds = Object.keys(byClass);
            for (var j = 0; j < charIds.length; j++) {
                var arr = byClass[charIds[j]];
                if (!Array.isArray(arr)) { continue; }
                var before = arr.length;
                byClass[charIds[j]] = arr.filter(function(id) {
                    return String(id) !== target;
                });
                result.enrolmentsRemoved += before - byClass[charIds[j]].length;
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEnrolments = {
        // Reads
        getStudentDisciplines: getStudentDisciplines,
        isEnrolled: isEnrolled,
        getClassEnrolments: getClassEnrolments,
        getStudentsInDiscipline: getStudentsInDiscipline,
        getStudentClasses: getStudentClasses,

        // Mutations
        enrol: enrol,
        leave: leave,
        replaceEnrolments: replaceEnrolments,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs
    };

})();
