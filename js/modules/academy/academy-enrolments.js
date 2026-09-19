/**
 * modules/academy/academy-enrolments.js - Academy Enrolments
 *
 * Path: js/modules/academy/academy-enrolments.js
 *
 * SINGLE SOURCE OF TRUTH for student ↔ class-discipline enrolment.
 *
 * WHAT THIS MODULE OWNS:
 *   The historical record that a student participated in a class's
 *   offering of a discipline for a bounded week range.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Class entities            (AcademyClasses)
 *   - Discipline entities       (AcademyDisciplines)
 *   - Class-discipline windows  (AcademyClassDisciplines)
 *   - Teaching group membership (AcademyTeachingGroups)
 *   - Recurring meetings        (AcademyTeachingSessions)
 *   - Compound operations that touch several stores
 *                               (AcademySchedule)
 *
 * HISTORICAL-RECORD PRINCIPLE:
 *   An enrolment is a historical fact. Leaving a discipline sets
 *   the enrolment's endWeek; it does NOT delete the record. The
 *   record survives, so a rejoin produces a second, non-overlapping
 *   interval.
 *
 * STORAGE:
 *   window.data.academy.enrolments[classId][charId] = [
 *     {
 *       disciplineId,
 *       startWeek,
 *       endWeek      // null = ongoing; endWeek is INCLUSIVE
 *     }
 *   ]
 *
 *   The array holds one entry per enrolment INTERVAL. A student can
 *   have multiple entries for the same disciplineId if they left
 *   and rejoined. Overlapping intervals for the same
 *   (classId, charId, disciplineId) are invalid.
 *
 * WEEK SEMANTICS:
 *   - Weeks are integers bounded by [MIN_WEEK, MAX_WEEK].
 *   - endWeek === null means "ongoing".
 *   - endWeek is INCLUSIVE. An enrolment with
 *     startWeek = 1 and endWeek = 14 covers weeks 1 through 14.
 *     Leaving effective week 15 sets endWeek = 14.
 *   - No silent coercion. Invalid weeks are rejected with a
 *     message; they are never defaulted to 1 or MAX_WEEK.
 *
 * RANGE PREDICATES:
 *   The week-containment question ("does [start, end] contain this
 *   week") is owned by window.RangeUtils, which is the canonical
 *   range-predicate module for the whole application. The
 *   interval-overlap question ("do these two intervals intersect")
 *   is also owned by RangeUtils. The two local helpers
 *   `intervalContainsWeek` and `intervalsOverlap` are delegating
 *   wrappers; they do the interval-shape null checks and then call
 *   RangeUtils. Do not reimplement the range math here.
 *
 * MUTATION CONTRACT:
 *   - enrol / leave / replaceEnrolments return
 *     Promise<{ success, data?, message? }>.
 *   - All mutations go through MutationPipeline.
 *   - Mutations are atomic. If persistence fails, everything rolls
 *     back.
 *
 * READ SAFETY:
 *   - Reads never create the store.
 *   - Public reads return fresh arrays / deep clones.
 *   - Internal accessors (used by the mutation callbacks) read the
 *     live snapshot.
 *
 * CASCADE SEMANTICS:
 *   stripCharacterRefs, stripClassRefs, stripDisciplineRefs are
 *   PURE with respect to appData: they mutate the given snapshot,
 *   never touch window.data, and never throw. They run inside
 *   another module's pipeline transaction.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils           (deepClone)
 *   - window.ValidationUtils       (isNonEmptyString)
 *   - window.CalendarValidation    (parseWeek)
 *   - window.CalendarConstants     (MIN_WEEK, MAX_WEEK)
 *   - window.RangeUtils            (containsWeek, weeksOverlap)
 *   - window.MutationPipeline      (performMutation)
 *
 * USAGE:
 *   var AE = window.AcademyEnrolments;
 *
 *   // Full, ordered interval list for a student in a class.
 *   var list = AE.getStudentDisciplines('char_1', 'class_1');
 *
 *   // Is the student currently enrolled in a specific discipline?
 *   var inEnglish = AE.isEnrolled('char_1', 'class_1', 'disc_en');
 *
 *   // Was the student enrolled in that discipline in week 5?
 *   var inWeek5 = AE.isEnrolledInWeek(
 *       'char_1', 'class_1', 'disc_en', 5
 *   );
 *
 *   // Enrol with an explicit start week.
 *   AE.enrol('char_1', 'class_1', 'disc_en', 1).then(...);
 *
 *   // Leave effective week 15 (endWeek becomes 14).
 *   AE.leave('char_1', 'class_1', 'disc_en', 15).then(...);
 */

(function() {
    'use strict';

    if (window.__academyEnrolmentsLoaded) {
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
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }
    if (!RangeUtils ||
        typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }
    if (!RangeUtils ||
        typeof RangeUtils.weeksOverlap !== 'function') {
        _missing.push('RangeUtils.weeksOverlap');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyEnrolments] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyEnrolmentsLoaded = true;

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
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[AcademyEnrolments] deepClone returned the original reference.'
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
     * Parse a week via CalendarValidation. Returns an integer in
     * [MIN_WEEK, MAX_WEEK] or null.
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
    // RANGE PREDICATES — DELEGATE TO RangeUtils
    // ============================================================
    //
    // RangeUtils owns the "does this range contain this week" and
    // "do these two ranges overlap" questions. The two helpers
    // below add the interval-shape null checks that RangeUtils
    // cannot know about (an interval here is
    // { startWeek, endWeek }, not a bare pair), and then delegate.
    //
    // Do not reimplement the range math here. It lives in one
    // place, on purpose.

    /**
     * Does the interval [startWeek, endWeek] contain the given
     * week? endWeek === null means "ongoing".
     *
     * The interval-array callers pass plain numbers; the caller
     * has already validated them. This wrapper's only job is the
     * RangeUtils delegation.
     */
    function intervalContainsWeek(startWeek, endWeek, week) {
        return RangeUtils.containsWeek(week, startWeek, endWeek);
    }

    /**
     * Do two intervals overlap?
     * end === null is treated as +infinity.
     *
     * Delegates to RangeUtils.weeksOverlap. The wrapper exists
     * because the call sites read more naturally as
     * `intervalsOverlap(a, b)` than as an argument-flipped call to
     * a four-argument function.
     */
    function intervalsOverlap(startA, endA, startB, endB) {
        return RangeUtils.weeksOverlap(startA, endA, startB, endB);
    }

    // ============================================================
    // STORE ACCESS
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

    function getEnrolmentsStore() {
        var academy = getAcademyStore();
        if (!academy) { return null; }
        var store = academy.enrolments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
    }

    function getEnrolmentsStoreFromSnapshot(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return null;
        }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return null;
        }
        return store;
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

    // ============================================================
    // INTERNAL READ HELPERS - LIVE REFERENCES
    // ============================================================

    /**
     * Return the live interval array for (classId, charId), or null.
     * Never creates the entry.
     */
    function getIntervalArrayFromStore(store, classId, charId) {
        if (!store || !isNonEmptyString(classId) || !isNonEmptyString(charId)) {
            return null;
        }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) { return null; }
        var arr = byClass[String(charId)];
        if (!Array.isArray(arr)) { return null; }
        return arr;
    }

    function getIntervalArray(classId, charId) {
        return getIntervalArrayFromStore(
            getEnrolmentsStore(), classId, charId
        );
    }

    /**
     * Filter the interval array to those matching a disciplineId.
     * Preserves order (which is kept chronological, see normalizeIntervals).
     */
    function getIntervalsForDiscipline(intervals, disciplineId) {
        if (!Array.isArray(intervals) || !isNonEmptyString(disciplineId)) {
            return [];
        }
        var target = String(disciplineId);
        var result = [];
        for (var i = 0; i < intervals.length; i++) {
            var entry = intervals[i];
            if (entry && String(entry.disciplineId) === target) {
                result.push(entry);
            }
        }
        return result;
    }

    /**
     * Sort intervals by (disciplineId, startWeek). Keeps the stored
     * array deterministic for diffing and display.
     */
    function sortIntervals(intervals) {
        intervals.sort(function(a, b) {
            var da = String(a.disciplineId);
            var db = String(b.disciplineId);
            if (da !== db) { return da < db ? -1 : 1; }
            return a.startWeek - b.startWeek;
        });
    }

    // ============================================================
    // PUBLIC READS
    // ============================================================

    /**
     * Get every enrolment interval for a student in a class.
     *
     * The returned array is sorted by (disciplineId, startWeek).
     * Empty when there is no entry or no data.
     *
     * @param {string} charId
     * @param {string} classId
     * @returns {array} Array of cloned interval objects
     */
    function getStudentDisciplines(charId, classId) {
        var arr = getIntervalArray(classId, charId);
        if (!arr) { return []; }
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            result.push(deepClone(arr[i]));
        }
        result.sort(function(a, b) {
            var da = String(a.disciplineId);
            var db = String(b.disciplineId);
            if (da !== db) { return da < db ? -1 : 1; }
            return a.startWeek - b.startWeek;
        });
        return result;
    }

    /**
     * Distinct discipline IDs for a student in a class.
     * A discipline appears once even if the student has rejoined.
     *
     * @param {string} charId
     * @param {string} classId
     * @returns {array} Array of unique disciplineId strings
     */
    function getStudentDisciplineIds(charId, classId) {
        var intervals = getStudentDisciplines(charId, classId);
        var seen = Object.create(null);
        var result = [];
        for (var i = 0; i < intervals.length; i++) {
            var id = intervals[i].disciplineId;
            if (!id) { continue; }
            var key = String(id);
            if (seen[key]) { continue; }
            seen[key] = true;
            result.push(key);
        }
        return result;
    }

    /**
     * Is the student enrolled in a discipline in any week of the
     * class's window? A "yes" here does not imply an active current
     * enrolment; use isEnrolledInWeek for that.
     *
     * @param {string} charId
     * @param {string} classId
     * @param {string} disciplineId
     * @returns {boolean}
     */
    function isEnrolled(charId, classId, disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return false; }
        var arr = getIntervalArray(classId, charId);
        if (!arr) { return false; }
        var matches = getIntervalsForDiscipline(arr, disciplineId);
        return matches.length > 0;
    }

    /**
     * Is the student enrolled in a discipline during a specific week?
     *
     * @param {string} charId
     * @param {string} classId
     * @param {string} disciplineId
     * @param {number|string} week
     * @returns {boolean}
     */
    function isEnrolledInWeek(charId, classId, disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) { return false; }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return false; }

        var arr = getIntervalArray(classId, charId);
        if (!arr) { return false; }

        var matches = getIntervalsForDiscipline(arr, disciplineId);
        for (var i = 0; i < matches.length; i++) {
            var entry = matches[i];
            if (intervalContainsWeek(
                entry.startWeek, entry.endWeek, weekNum
            )) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get every enrolled student in a class, mapped to a deduplicated
     * list of disciplineIds.
     *
     * @param {string} classId
     * @returns {object} { charId: [disciplineId, ...] }
     */
    function getClassEnrolments(classId) {
        if (!isNonEmptyString(classId)) { return {}; }
        var store = getEnrolmentsStore();
        if (!store) { return {}; }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) { return {}; }

        var result = {};
        var charIds = Object.keys(byClass);
        for (var i = 0; i < charIds.length; i++) {
            var arr = byClass[charIds[i]];
            if (!Array.isArray(arr)) {
                result[charIds[i]] = [];
                continue;
            }
            var seen = Object.create(null);
            var ids = [];
            for (var j = 0; j < arr.length; j++) {
                var entry = arr[j];
                if (!entry || !entry.disciplineId) { continue; }
                var id = String(entry.disciplineId);
                if (seen[id]) { continue; }
                seen[id] = true;
                ids.push(id);
            }
            result[charIds[i]] = ids;
        }
        return result;
    }

    /**
     * Get every student in a class who is enrolled in a given
     * discipline for a given week.
     *
     * @param {string} classId
     * @param {string} disciplineId
     * @param {number|string} week
     * @returns {array} Array of charIds
     */
    function getEnrolledStudents(classId, disciplineId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return [];
        }
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) { return []; }

        var store = getEnrolmentsStore();
        if (!store) { return []; }
        var byClass = store[String(classId)];
        if (!isPlainObject(byClass)) { return []; }

        var target = String(disciplineId);
        var result = [];
        var charIds = Object.keys(byClass);
        for (var i = 0; i < charIds.length; i++) {
            var charId = charIds[i];
            var arr = byClass[charId];
            if (!Array.isArray(arr)) { continue; }

            var matched = false;
            for (var j = 0; j < arr.length; j++) {
                var entry = arr[j];
                if (!entry || String(entry.disciplineId) !== target) {
                    continue;
                }
                if (intervalContainsWeek(
                    entry.startWeek, entry.endWeek, weekNum
                )) {
                    matched = true;
                    break;
                }
            }
            if (matched) {
                result.push(charId);
            }
        }
        return result;
    }

    /**
     * Get every class a student has any enrolment in.
     *
     * @param {string} charId
     * @returns {array} Array of classIds
     */
    function getStudentClasses(charId) {
        if (!isNonEmptyString(charId)) { return []; }
        var store = getEnrolmentsStore();
        if (!store) { return []; }

        var target = String(charId);
        var result = [];
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var byClass = store[classIds[i]];
            if (!isPlainObject(byClass)) { continue; }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                result.push(classIds[i]);
            }
        }
        return result;
    }

    // ============================================================
    // VALIDATION FOR MUTATIONS
    // ============================================================

    function validateIds(charId, classId, disciplineId) {
        if (!isNonEmptyString(charId)) {
            return { valid: false, message: 'Character ID is required.' };
        }
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }
        if (!isNonEmptyString(disciplineId)) {
            return { valid: false, message: 'Discipline ID is required.' };
        }
        return { valid: true };
    }

    function validateStartWeek(week) {
        var parsed = parseWeekStrict(week);
        if (parsed === null) {
            return {
                valid: false,
                message:
                    'Start week must be between ' + MIN_WEEK +
                    ' and ' + MAX_WEEK + '.'
            };
        }
        return { valid: true, value: parsed };
    }

    function validateEffectiveWeek(week) {
        var parsed = parseWeekStrict(week);
        if (parsed === null) {
            return {
                valid: false,
                message:
                    'Effective week must be between ' + MIN_WEEK +
                    ' and ' + MAX_WEEK + '.'
            };
        }
        return { valid: true, value: parsed };
    }

    /**
     * Would adding [start, end] to `existingIntervals` create an
     * overlap with another interval of the same discipline?
     *
     * `existingIntervals` should contain only entries matching the
     * discipline in question.
     *
     * Returns the conflicting entry, or null.
     */
    function findOverlappingInterval(
        existingIntervals,
        newStartWeek,
        newEndWeek
    ) {
        for (var i = 0; i < existingIntervals.length; i++) {
            var entry = existingIntervals[i];
            if (intervalsOverlap(
                entry.startWeek, entry.endWeek,
                newStartWeek, newEndWeek
            )) {
                return entry;
            }
        }
        return null;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Enrol a student in a discipline for a class, from a given week.
     *
     * The enrolment is open-ended: endWeek is null. To end it later,
     * call leave() with an effective week.
     *
     * Overlapping intervals for the same (classId, charId,
     * disciplineId) are rejected.
     *
     * @param {string} charId
     * @param {string} classId
     * @param {string} disciplineId
     * @param {number|string} startWeek
     * @returns {Promise<{success, data?, message?}>}
     */
    function enrol(charId, classId, disciplineId, startWeek) {
        var idCheck = validateIds(charId, classId, disciplineId);
        if (!idCheck.valid) {
            return Promise.resolve(failure(idCheck.message));
        }

        var weekCheck = validateStartWeek(startWeek);
        if (!weekCheck.valid) {
            return Promise.resolve(failure(weekCheck.message));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var startNum = weekCheck.value;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var store = getEnrolmentsStoreFromSnapshot(appData);
                var intervals = getIntervalArrayFromStore(
                    store, targetClass, targetChar
                );

                if (!intervals) {
                    return { valid: true };
                }

                var sameDiscipline = getIntervalsForDiscipline(
                    intervals, targetDiscipline
                );
                var conflict = findOverlappingInterval(
                    sameDiscipline, startNum, null
                );
                if (conflict) {
                    return {
                        valid: false,
                        message:
                            'Student already has an enrolment in this ' +
                            'discipline from week ' +
                            conflict.startWeek + '.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureEnrolmentsStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }
                if (!Array.isArray(store[targetClass][targetChar])) {
                    store[targetClass][targetChar] = [];
                }

                var entry = {
                    disciplineId: targetDiscipline,
                    startWeek: startNum,
                    endWeek: null
                };
                store[targetClass][targetChar].push(entry);
                sortIntervals(store[targetClass][targetChar]);

                return {
                    charId: targetChar,
                    classId: targetClass,
                    disciplineId: targetDiscipline,
                    startWeek: startNum
                };
            },
            logMessage:
                'Enrolled ' + targetChar + ' in ' + targetDiscipline +
                ' for ' + targetClass + ' from week ' + startNum,
            successMessage: 'Enrolled successfully.',
            failureMessage: 'Failed to enrol.'
        });
    }

    /**
     * End a student's enrolment in a discipline effective from a
     * given week. History survives.
     *
     * SEMANTICS:
     *   leave(charId, classId, discId, 15) sets endWeek = 14 on the
     *   interval that contains week 15. If the active interval
     *   already ended before week 15, the mutation is a no-op.
     *
     *   If the interval starts on or after the effective week, it is
     *   removed entirely — leaving effective week N means the
     *   student was never enrolled at N, and an interval that starts
     *   at N is inconsistent with that. This case is unusual but
     *   well-defined.
     *
     * @returns {Promise<{success, data?, message?}>}
     */
    function leave(charId, classId, disciplineId, effectiveWeek) {
        var idCheck = validateIds(charId, classId, disciplineId);
        if (!idCheck.valid) {
            return Promise.resolve(failure(idCheck.message));
        }

        var weekCheck = validateEffectiveWeek(effectiveWeek);
        if (!weekCheck.valid) {
            return Promise.resolve(failure(weekCheck.message));
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);
        var effectiveNum = weekCheck.value;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var store = getEnrolmentsStoreFromSnapshot(appData);
                var intervals = getIntervalArrayFromStore(
                    store, targetClass, targetChar
                );

                if (!intervals) {
                    return {
                        valid: false,
                        message: 'Student is not enrolled in this class.'
                    };
                }

                var sameDiscipline = getIntervalsForDiscipline(
                    intervals, targetDiscipline
                );
                if (sameDiscipline.length === 0) {
                    return {
                        valid: false,
                        message:
                            'Student is not enrolled in this discipline.'
                    };
                }

                // Find an interval that would be affected.
                var affected = false;
                for (var i = 0; i < sameDiscipline.length; i++) {
                    var entry = sameDiscipline[i];

                    // An ongoing interval starting at or before the
                    // effective week is always affected. Any bounded
                    // interval that contains the effective week is
                    // affected. An interval that starts at or after
                    // the effective week is affected (it gets
                    // dropped).
                    if (entry.startWeek >= effectiveNum) {
                        affected = true;
                        break;
                    }
                    if (intervalContainsWeek(
                        entry.startWeek, entry.endWeek, effectiveNum
                    )) {
                        affected = true;
                        break;
                    }
                    if (entry.endWeek === null && entry.startWeek <= effectiveNum) {
                        affected = true;
                        break;
                    }
                }

                if (!affected) {
                    return {
                        valid: false,
                        message:
                            'No active enrolment to end at week ' +
                            effectiveNum + '.'
                    };
                }

                return { valid: true };
            },
            mutate: function(appData) {
                var store = ensureEnrolmentsStore(appData);
                if (!store ||
                    !isPlainObject(store[targetClass]) ||
                    !Array.isArray(store[targetClass][targetChar])) {
                    return { changed: false };
                }

                var intervals = store[targetClass][targetChar];
                var newIntervals = [];
                var changed = false;

                for (var i = 0; i < intervals.length; i++) {
                    var entry = intervals[i];
                    if (!entry ||
                        String(entry.disciplineId) !== targetDiscipline) {
                        newIntervals.push(entry);
                        continue;
                    }

                    // Case 1: interval already ended before the
                    // effective week. Leave it alone.
                    if (entry.endWeek !== null &&
                        entry.endWeek !== undefined &&
                        entry.endWeek < effectiveNum) {
                        newIntervals.push(entry);
                        continue;
                    }

                    // Case 2: interval starts at or after the
                    // effective week. Drop it. The student was never
                    // enrolled at effectiveNum, so leaving at
                    // effectiveNum removes this interval entirely.
                    if (entry.startWeek >= effectiveNum) {
                        changed = true;
                        continue;
                    }

                    // Case 3: interval contains the effective week.
                    // Truncate it to effectiveNum - 1.
                    entry.endWeek = effectiveNum - 1;
                    changed = true;
                    newIntervals.push(entry);
                }

                if (changed) {
                    store[targetClass][targetChar] = newIntervals;
                    sortIntervals(store[targetClass][targetChar]);

                    // Prune empty class / char records so the store
                    // does not accumulate dead branches.
                    if (store[targetClass][targetChar].length === 0) {
                        delete store[targetClass][targetChar];
                    }
                    if (Object.keys(store[targetClass]).length === 0) {
                        delete store[targetClass];
                    }
                }

                return {
                    charId: targetChar,
                    classId: targetClass,
                    disciplineId: targetDiscipline,
                    effectiveWeek: effectiveNum,
                    changed: changed
                };
            },
            logMessage:
                'Ended enrolment of ' + targetChar + ' in ' +
                targetDiscipline + ' for ' + targetClass +
                ' effective week ' + effectiveNum,
            successMessage: 'Left discipline.',
            failureMessage: 'Failed to leave discipline.'
        });
    }

    /**
     * Replace the entire enrolment list for a student in a class.
     *
     * `entries` is an array of { disciplineId, startWeek, endWeek? }.
     * Uniqueness and non-overlap are enforced per disciplineId.
     *
     * This is a bulk operation used by import and by admin tools. It
     * does NOT go through enrol/leave; it rebuilds the list wholesale
     * for the (classId, charId) pair.
     *
     * @param {string} charId
     * @param {string} classId
     * @param {array} entries
     * @returns {Promise<{success, data?, message?}>}
     */
    function replaceEnrolments(charId, classId, entries) {
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }
        if (!Array.isArray(entries)) {
            return Promise.resolve(
                failure('Enrolments must be an array.')
            );
        }

        var targetChar = String(charId);
        var targetClass = String(classId);
        var cleaned = [];
        var seenDisciplineStart = Object.create(null);

        for (var i = 0; i < entries.length; i++) {
            var raw = entries[i];
            if (!isPlainObject(raw)) {
                return Promise.resolve(failure(
                    'Entry ' + (i + 1) + ' must be an object.'
                ));
            }
            if (!isNonEmptyString(raw.disciplineId)) {
                return Promise.resolve(failure(
                    'Entry ' + (i + 1) + ' requires a disciplineId.'
                ));
            }

            var startCheck = validateStartWeek(raw.startWeek);
            if (!startCheck.valid) {
                return Promise.resolve(failure(
                    'Entry ' + (i + 1) + ': ' + startCheck.message
                ));
            }

            var endNum = null;
            if (raw.endWeek !== undefined && raw.endWeek !== null) {
                var endCheck = validateEffectiveWeek(raw.endWeek);
                if (!endCheck.valid) {
                    return Promise.resolve(failure(
                        'Entry ' + (i + 1) + ': ' + endCheck.message
                    ));
                }
                if (endCheck.value < startCheck.value) {
                    return Promise.resolve(failure(
                        'Entry ' + (i + 1) +
                        ': endWeek cannot be before startWeek.'
                    ));
                }
                endNum = endCheck.value;
            }

            var disciplineKey = String(raw.disciplineId);
            var startKey = disciplineKey + '::' + startCheck.value;
            if (seenDisciplineStart[startKey]) {
                return Promise.resolve(failure(
                    'Entry ' + (i + 1) +
                    ': duplicate (disciplineId, startWeek).'
                ));
            }
            seenDisciplineStart[startKey] = true;

            cleaned.push({
                disciplineId: disciplineKey,
                startWeek: startCheck.value,
                endWeek: endNum
            });
        }

        // Overlap check per discipline.
        var byDiscipline = {};
        for (var k = 0; k < cleaned.length; k++) {
            var entry = cleaned[k];
            if (!byDiscipline[entry.disciplineId]) {
                byDiscipline[entry.disciplineId] = [];
            }
            byDiscipline[entry.disciplineId].push(entry);
        }

        var disciplineIds = Object.keys(byDiscipline);
        for (var d = 0; d < disciplineIds.length; d++) {
            var list = byDiscipline[disciplineIds[d]];
            for (var a = 0; a < list.length; a++) {
                for (var b = a + 1; b < list.length; b++) {
                    if (intervalsOverlap(
                        list[a].startWeek, list[a].endWeek,
                        list[b].startWeek, list[b].endWeek
                    )) {
                        return Promise.resolve(failure(
                            'Overlapping intervals for discipline ' +
                            disciplineIds[d] + '.'
                        ));
                    }
                }
            }
        }

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
                var store = ensureEnrolmentsStore(appData);
                if (!isPlainObject(store[targetClass])) {
                    store[targetClass] = {};
                }

                if (cleaned.length === 0) {
                    delete store[targetClass][targetChar];
                    if (Object.keys(store[targetClass]).length === 0) {
                        delete store[targetClass];
                    }
                } else {
                    store[targetClass][targetChar] =
                        cleaned.map(function(e) { return deepClone(e); });
                    sortIntervals(store[targetClass][targetChar]);
                }

                return {
                    charId: targetChar,
                    classId: targetClass,
                    count: cleaned.length
                };
            },
            logMessage:
                'Replaced enrolments for ' + targetChar +
                ' in ' + targetClass,
            successMessage: 'Enrolments updated.',
            failureMessage: 'Failed to update enrolments.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Strip all enrolment references to a character.
     *
     * PURE with respect to appData. Does not touch window.data.
     * Never throws.
     *
     * @returns {object} { enrolmentsRemoved }
     */
    function stripCharacterRefs(appData, charId) {
        var result = { enrolmentsRemoved: 0 };
        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(charId);
        var classIds = Object.keys(store);
        for (var i = 0; i < classIds.length; i++) {
            var classId = classIds[i];
            var byClass = store[classId];
            if (!isPlainObject(byClass)) { continue; }
            if (Object.prototype.hasOwnProperty.call(byClass, target)) {
                delete byClass[target];
                result.enrolmentsRemoved++;
            }
            if (Object.keys(byClass).length === 0) {
                delete store[classId];
            }
        }
        return result;
    }

    /**
     * Strip all enrolment references to a class.
     *
     * @returns {object} { enrolmentsRemoved }
     */
    function stripClassRefs(appData, classId) {
        var result = { enrolmentsRemoved: 0 };
        if (!appData || !isNonEmptyString(classId)) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(classId);
        var byClass = store[target];
        if (isPlainObject(byClass)) {
            result.enrolmentsRemoved = Object.keys(byClass).length;
            delete store[target];
        }
        return result;
    }

    /**
     * Strip references to a discipline from every enrolment.
     * Intervals that only referenced the deleted discipline are
     * removed; the containing char / class entries are pruned when
     * they become empty.
     *
     * @returns {object} { intervalsRemoved }
     */
    function stripDisciplineRefs(appData, disciplineId) {
        var result = { intervalsRemoved: 0 };
        if (!appData || !isNonEmptyString(disciplineId)) {
            return result;
        }
        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }
        var store = appData.academy.enrolments;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return result;
        }

        var target = String(disciplineId);
        var classIds = Object.keys(store);

        for (var i = 0; i < classIds.length; i++) {
            var classId = classIds[i];
            var byClass = store[classId];
            if (!isPlainObject(byClass)) { continue; }

            var charIds = Object.keys(byClass);
            for (var j = 0; j < charIds.length; j++) {
                var charId = charIds[j];
                var arr = byClass[charId];
                if (!Array.isArray(arr)) { continue; }

                var before = arr.length;
                var filtered = arr.filter(function(entry) {
                    return !(entry &&
                             String(entry.disciplineId) === target);
                });
                var removed = before - filtered.length;

                if (removed > 0) {
                    result.intervalsRemoved += removed;
                    if (filtered.length === 0) {
                        delete byClass[charId];
                    } else {
                        byClass[charId] = filtered;
                    }
                }
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

    window.AcademyEnrolments = Object.freeze({
        // Reads
        getStudentDisciplines: getStudentDisciplines,
        getStudentDisciplineIds: getStudentDisciplineIds,
        isEnrolled: isEnrolled,
        isEnrolledInWeek: isEnrolledInWeek,
        getClassEnrolments: getClassEnrolments,
        getEnrolledStudents: getEnrolledStudents,
        getStudentClasses: getStudentClasses,

        // Mutations
        enrol: enrol,
        leave: leave,
        replaceEnrolments: replaceEnrolments,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,
        stripClassRefs: stripClassRefs,
        stripDisciplineRefs: stripDisciplineRefs
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyEnrolments;
        var missing = [];

        var required = [
            'getStudentDisciplines',
            'getStudentDisciplineIds',
            'isEnrolled',
            'isEnrolledInWeek',
            'getClassEnrolments',
            'getEnrolledStudents',
            'getStudentClasses',
            'enrol',
            'leave',
            'replaceEnrolments',
            'stripCharacterRefs',
            'stripClassRefs',
            'stripDisciplineRefs'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke tests on the two delegating range helpers. These
        // exercise the RangeUtils delegation directly; a failure
        // here means the semantics the rest of the module depends
        // on are broken.
        try {
            // intervalContainsWeek — inclusive bounds, null end ongoing.
            if (intervalContainsWeek(1, 10, 5) !== true) {
                missing.push('intervalContainsWeek(1,10,5) !== true');
            }
            if (intervalContainsWeek(1, 10, 10) !== true) {
                missing.push('intervalContainsWeek inclusive end not honoured');
            }
            if (intervalContainsWeek(1, 10, 11) !== false) {
                missing.push('intervalContainsWeek(1,10,11) !== false');
            }
            if (intervalContainsWeek(1, null, 52) !== true) {
                missing.push('intervalContainsWeek null end not ongoing');
            }

            // intervalsOverlap — inclusive endpoints, null end ongoing.
            if (intervalsOverlap(1, 10, 5, 15) !== true) {
                missing.push('intervalsOverlap missed a simple overlap');
            }
            if (intervalsOverlap(1, 10, 11, 20) !== false) {
                missing.push('intervalsOverlap found a false overlap');
            }
            if (intervalsOverlap(1, 10, 10, 20) !== true) {
                missing.push('intervalsOverlap missed inclusive endpoint');
            }
            if (intervalsOverlap(1, null, 30, 40) !== true) {
                missing.push('intervalsOverlap missed open-ended overlap');
            }
            if (intervalsOverlap(1, 5, 6, 10) !== false) {
                missing.push('intervalsOverlap flagged disjoint ranges');
            }
        } catch (e) {
            missing.push('range-helper smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyEnrolments] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();